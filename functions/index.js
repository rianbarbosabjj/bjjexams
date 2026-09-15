const crypto = require('crypto');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const { logger } = require('firebase-functions');
const { AsaasHelper } = require('./asaas-helpers');
const { assertAsaasEnvironment } = require('./src/config/environment');
const { createGlobalClaimsService } = require('./src/auth/global-claims-service');
const { canApplyOfficialExam, canManageOrganization, isActiveMembership, membershipRole, normalizeMembershipStatus } = require('./src/auth/organization-membership');

initializeApp();
const db = getFirestore();
const auth = getAuth();
const globalClaimsService = createGlobalClaimsService({ db, auth });

const ASAAS_API_KEY = defineSecret('ASAAS_API_KEY');
const ASAAS_WEBHOOK_TOKEN = defineSecret('ASAAS_WEBHOOK_TOKEN');
const ASAAS_ENV = defineString('ASAAS_ENV', { default: 'sandbox' });

const REGION = 'southamerica-east1';
const PAID_EVENTS = new Set(['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED']);
const CREDIT_PACKAGES = new Map([[10, 25], [20, 50], [50, 125]]);

function requireAuth(request) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Faça login para continuar.');
  return request.auth.uid;
}

async function finalizeResolvedProfile(uid, payload) {
  try {
    const result =
      await globalClaimsService.synchronizeUserGlobalClaims(uid);

    if (result.updated) {
      logger.info('Global claims sincronizadas.', {
        uid,
        fonte: payload.fonte || null,
        papel: payload.papel || null
      });
    }
  } catch (error) {
    // Durante a transicao, Firestore permanece como fonte autoritativa.
    // Uma falha de sincronizacao nao pode interromper o login legado.
    logger.error('Falha ao sincronizar Global Claims.', {
      uid,
      fonte: payload.fonte || null,
      papel: payload.papel || null,
      code: error?.code || null,
      message: String(error?.message || error)
    });
  }

  return payload;
}

function asaas() {
  const key = ASAAS_API_KEY.value();
  const env = ASAAS_ENV.value();

  assertAsaasEnvironment({
    asaasEnv: env,
    apiKey: key
  });

  return new AsaasHelper(key, env);
}

function cleanDigits(value = '') {
  return String(value).replace(/\D/g, '');
}

function publicQuestion(id, data) {
  return {
    id,
    pergunta: data.pergunta || '',
    alternativas: data.alternativas || {},
    url_video: data.url_video || null,
    url_imagem: data.url_imagem || null
  };
}

function certificateCode() {
  return `BJJEX-${new Date().getUTCFullYear()}-${crypto.randomBytes(7).toString('hex').toUpperCase()}`;
}

async function getProfile(uid) {
  const [user, student] = await Promise.all([
    db.doc(`usuarios/${uid}`).get(),
    db.doc(`alunos/${uid}`).get()
  ]);
  if (user.exists) return { collection: 'usuarios', ...user.data() };
  if (student.exists) return { collection: 'alunos', ...student.data() };
  throw new HttpsError('failed-precondition', 'Perfil não encontrado. Complete seu cadastro.');
}

function canonicalRole(data = {}) {
  const tipo = String(data.tipo_usuario || data.tipoUsuario || data.papel_principal || '').trim().toLowerCase();
  if (['professor', 'instrutor'].includes(tipo)) return 'professor';
  if (['aluno', 'student'].includes(tipo)) return 'aluno';
  return tipo || null;
}

function membershipId(organizacaoId, uid) {
  return `${organizacaoId}__${uid}`;
}

async function getOrganization(organizacaoId) {
  if (!organizacaoId) return null;
  const [canonical, legacy] = await Promise.all([
    db.doc(`organizacoes/${organizacaoId}`).get(),
    db.doc(`equipes/${organizacaoId}`).get()
  ]);
  if (canonical.exists) return { id: canonical.id, ...canonical.data(), fonte: 'organizacoes' };
  if (legacy.exists) return { id: legacy.id, ...legacy.data(), fonte: 'equipes' };
  return null;
}

async function getActiveMemberships(uid) {
  const snap = await db.collection('vinculos_organizacao')
    .where('usuario_id', '==', uid)
    .limit(100)
    .get();

  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(isActiveMembership);
}

async function getOrCreateCustomer(profile) {
  const api = asaas();
  const cpf = cleanDigits(profile.cpf);
  let customer = null;
  if (cpf) customer = await api.findCustomerByCpf(cpf);
  if (!customer && profile.email) customer = await api.findCustomerByEmail(profile.email);
  if (customer) return customer;

  const created = await api.createCustomer({
    name: profile.nome || profile.name || 'Cliente BJJ Exams',
    email: profile.email,
    cpf,
    phone: cleanDigits(profile.telefone)
  });
  if (!created.success) throw new HttpsError('internal', 'Não foi possível iniciar o pagamento.');
  return created.data;
}

async function buildCourseSplit(course) {
  if (!course.professor_id) return [];
  const [profDoc, finDoc] = await Promise.all([
    db.doc(`usuarios/${course.professor_id}`).get(),
    db.doc('config_plataforma/financeiro').get()
  ]);
  const prof = profDoc.exists ? profDoc.data() : {};
  const walletId = ASAAS_ENV.value() === 'production' ? prof.asaas_wallet_id : prof.asaas_wallet_id_sandbox;
  const percentual = finDoc.exists ? Number(finDoc.data().percentual_professor || 0) : 0;
  if (!walletId || !Number.isFinite(percentual) || percentual <= 0 || percentual > 100) return [];
  return [{ walletId, percentualValue: percentual }];
}


async function findEnrollment(uid, courseId) {
  const deterministic = await db.doc(`matriculas/${uid}_${courseId}`).get();
  if (deterministic.exists) return deterministic;
  const snap = await db.collection('matriculas')
    .where('aluno_id', '==', uid)
    .where('curso_id', '==', courseId)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0];
}

async function getProfessorContext(uid) {
  const [userDoc, legacyProfDoc, memberships] = await Promise.all([
    db.doc(`usuarios/${uid}`).get(),
    db.doc(`professores/${uid}`).get(),
    getActiveMemberships(uid)
  ]);

  const user = userDoc.exists ? userDoc.data() : {};
  const role = canonicalRole(user);
  if (role !== 'professor') {
    throw new HttpsError('permission-denied', 'Ação disponível apenas para instrutores.');
  }

  const activeExamMemberships = memberships.filter(v =>
    ['owner', 'manager', 'instructor'].includes(
      membershipRole(v)
    )
  );

  // Compatibilidade temporária com vínculos legados ainda não migrados.
  if (!activeExamMemberships.length && legacyProfDoc.exists && legacyProfDoc.data().status_vinculo === 'ativo' && legacyProfDoc.data().equipe_id) {
    const p = legacyProfDoc.data();
    activeExamMemberships.push({
      id: `legacy_${uid}`,
      usuario_id: uid,
      organizacao_id: p.equipe_id,
      papel: p.eh_responsavel ? 'gestor' : 'professor',
      status: 'ativo',
      pode_aplicar_exames: Boolean(p.eh_responsavel || p.pode_aprovar),
      legado: true
    });
  }

  const membershipsWithExamPermission =
    activeExamMemberships.filter(
      canApplyOfficialExam
    );

  return {
    user,
    memberships: activeExamMemberships,
    examMemberships: membershipsWithExamPermission,
    canAuthorizeExam: membershipsWithExamPermission.length > 0
  };
}


function textField(value, max = 160) {
  return String(value ?? '').trim().slice(0, max);
}

function validateCpfLike(value) {
  const digits = cleanDigits(value);
  if (digits && digits.length !== 11) throw new HttpsError('invalid-argument', 'CPF inválido.');
  return digits;
}

exports.concluirOnboarding = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const data = request.data || {};
  const tipo = textField(data.tipoUsuario, 20).toLowerCase();
  if (!['aluno', 'professor'].includes(tipo)) throw new HttpsError('invalid-argument', 'Perfil inválido.');

  const faixa = textField(data.faixa, 40);
  const faixasProfessor = new Set(['Marrom', 'Preta']);
  if (!faixa) throw new HttpsError('invalid-argument', 'Selecione a graduação.');
  if (tipo === 'professor' && !faixasProfessor.has(faixa)) {
    throw new HttpsError('invalid-argument', 'Cadastro de instrutor disponível para faixas marrom e preta.');
  }

  // v1.1: academia é opcional para cursos. O vínculo só é necessário para exames oficiais de faixa.
  const equipeSolicitada = textField(data.equipeId, 128);
  const novaEquipe = equipeSolicitada === 'nova_equipe';
  if (novaEquipe && tipo !== 'professor') throw new HttpsError('permission-denied', 'Somente instrutores podem criar uma nova academia.');

  const nome = textField(data.nome, 140).toUpperCase();
  if (nome.length < 3) throw new HttpsError('invalid-argument', 'Informe seu nome completo.');
  const cpf = validateCpfLike(data.cpf);
  const emailAuth = textField(request.auth?.token?.email, 180).toLowerCase();
  if (!emailAuth) throw new HttpsError('failed-precondition', 'Sua conta precisa ter um e-mail válido.');

  const profile = {
    nome,
    email: emailAuth,
    cpf,
    nascimento: textField(data.nascimento, 20),
    telefone: cleanDigits(data.telefone).slice(0, 20),
    cep: cleanDigits(data.cep).slice(0, 8),
    logradouro: textField(data.logradouro, 160),
    numero: textField(data.numero, 30),
    complemento: textField(data.complemento, 100),
    bairro: textField(data.bairro, 100),
    cidade: textField(data.cidade, 100),
    estado: textField(data.estado, 2).toUpperCase(),
    faixa,
    faixa_atual: faixa,
    auth_provider: textField(data.authProvider, 30) || 'firebase',
    sistema_origem: 'bjj_exams',
    tipo_usuario: tipo,
    papel_principal: tipo === 'professor' ? 'instrutor' : 'aluno',
    papeis: tipo === 'professor' ? ['instrutor'] : ['aluno'],
    status_conta: 'ativo',
    onboarding_concluido: true
  };

  const userRef = db.doc(`usuarios/${uid}`);
  const alunoRef = db.doc(`alunos/${uid}`); // projeção legada temporária
  const profRef = db.doc(`professores/${uid}`); // projeção legada temporária
  let equipeIdFinal = equipeSolicitada || null;
  let nomeEquipeFinal = '';
  let vinculoStatus = null;
  let vinculoPapel = null;

  await db.runTransaction(async (tx) => {
    const refsToRead = [userRef, alunoRef, profRef];
    let legacyEquipeRef = null;
    let orgRef = null;

    if (equipeSolicitada && !novaEquipe) {
      legacyEquipeRef = db.doc(`equipes/${equipeSolicitada}`);
      orgRef = db.doc(`organizacoes/${equipeSolicitada}`);
      refsToRead.push(legacyEquipeRef, orgRef);
    }

    const snaps = await Promise.all(refsToRead.map(ref => tx.get(ref)));
    const [userSnap, alunoSnap, profSnap] = snaps;
    if (userSnap.exists || alunoSnap.exists || profSnap.exists) {
      throw new HttpsError('already-exists', 'Seu perfil já foi criado. Faça login novamente.');
    }

    if (novaEquipe) {
      nomeEquipeFinal = textField(data.novaEquipeNome, 140).toUpperCase();
      if (nomeEquipeFinal.length < 3) throw new HttpsError('invalid-argument', 'Informe o nome da nova academia.');
      orgRef = db.collection('organizacoes').doc();
      equipeIdFinal = orgRef.id;
      tx.create(orgRef, {
        nome: nomeEquipeFinal,
        nome_equipe: nomeEquipeFinal,
        tipo: 'academia',
        status: 'ativa',
        criado_por_uid: uid,
        criado_em: FieldValue.serverTimestamp()
      });
      // Compatibilidade com telas legadas durante a transição.
      tx.set(db.doc(`equipes/${equipeIdFinal}`), {
        nome: nomeEquipeFinal,
        nome_equipe: nomeEquipeFinal,
        status: 'ativa',
        criado_por_uid: uid,
        arquitetura_v11: true,
        criado_em: FieldValue.serverTimestamp()
      }, { merge: true });
      vinculoStatus = 'ativo';
      vinculoPapel = 'gestor';
    } else if (equipeSolicitada) {
      const legacySnap = snaps[3];
      const orgSnap = snaps[4];
      if (!legacySnap.exists && !orgSnap.exists) {
        throw new HttpsError('not-found', 'Academia não encontrada. Atualize a página e tente novamente.');
      }
      const eq = orgSnap.exists ? orgSnap.data() : legacySnap.data();
      nomeEquipeFinal = textField(eq.nome_equipe || eq.nome || 'Academia', 140);
      if (!orgSnap.exists) {
        tx.set(orgRef, {
          nome: nomeEquipeFinal,
          nome_equipe: nomeEquipeFinal,
          tipo: 'academia',
          status: eq.status || 'ativa',
          migrado_de_equipes: true,
          migrado_em: FieldValue.serverTimestamp()
        }, { merge: true });
      }
      vinculoStatus = 'pendente';
      vinculoPapel = tipo === 'professor' ? 'professor' : 'aluno';
    }

    const canonicalProfile = {
      ...profile,
      academia_principal_id: equipeIdFinal,
      academia_principal_nome: nomeEquipeFinal || null,
      equipe_id: equipeIdFinal, // compatibilidade temporária com painéis v1.0
      equipe_origem: nomeEquipeFinal || null,
      status_vinculo: 'ativo', // status da conta; vínculo institucional fica em vinculos_organizacao
      data_cadastro: FieldValue.serverTimestamp()
    };
    tx.create(userRef, canonicalProfile);

    if (equipeIdFinal) {
      const vinculoRef = db.doc(`vinculos_organizacao/${membershipId(equipeIdFinal, uid)}`);
      tx.set(vinculoRef, {
        usuario_id: uid,
        organizacao_id: equipeIdFinal,
        papel: vinculoPapel,
        status: vinculoStatus,
        principal: true,
        pode_aplicar_exames: vinculoPapel === 'gestor',
        criado_em: FieldValue.serverTimestamp(),
        atualizado_em: FieldValue.serverTimestamp()
      }, { merge: true });
    }

    // Projeções de compatibilidade: mantêm os painéis v1.0 funcionando enquanto
    // cada tela é migrada para usuarios + vinculos_organizacao.
    if (tipo === 'aluno') {
      tx.create(alunoRef, {
        ...profile,
        tipo_usuario: 'aluno',
        equipe_id: equipeIdFinal,
        equipe_origem: nomeEquipeFinal || null,
        exame_habilitado: false,
        status_exame_em_andamento: false,
        status_vinculo: equipeIdFinal ? vinculoStatus : 'ativo',
        pontos_rola: 0,
        arquitetura_v11: true,
        data_cadastro: FieldValue.serverTimestamp()
      });
    } else {
      tx.create(profRef, {
        usuario_id: uid,
        equipe_id: equipeIdFinal,
        status_vinculo: equipeIdFinal ? vinculoStatus : 'independente',
        eh_responsavel: vinculoPapel === 'gestor',
        pode_aprovar: vinculoPapel === 'gestor',
        arquitetura_v11: true,
        criado_em: FieldValue.serverTimestamp()
      });
    }
  });

  return {
    ok: true,
    tipoUsuario: tipo,
    equipeId: equipeIdFinal,
    equipeNome: nomeEquipeFinal || null,
    vinculoAcademia: Boolean(equipeIdFinal),
    statusVinculo: vinculoStatus
  };
});

exports.configurarAutorizacaoExame = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const alunoId = String(request.data?.alunoId || '').trim();
  const autorizar = Boolean(request.data?.autorizar);
  const faixa = String(request.data?.faixa || '').trim();
  const inicio = request.data?.inicio ? String(request.data.inicio) : null;
  const fim = request.data?.fim ? String(request.data.fim) : null;
  if (!alunoId) throw new HttpsError('invalid-argument', 'Aluno inválido.');
  if (autorizar && !faixa) throw new HttpsError('invalid-argument', 'Selecione a faixa do exame.');

  const ctx = await getProfessorContext(uid);
  if (!ctx.canAuthorizeExam) {
    throw new HttpsError('permission-denied', 'Para aplicar exames oficiais, o instrutor precisa estar vinculado a uma academia com permissão de exames.');
  }

  const [alunoUserDoc, alunoLegacyDoc, alunoMembershipsSnap] = await Promise.all([
    db.doc(`usuarios/${alunoId}`).get(),
    db.doc(`alunos/${alunoId}`).get(),
    db.collection('vinculos_organizacao').where('usuario_id', '==', alunoId).limit(30).get()
  ]);
  if (!alunoUserDoc.exists && !alunoLegacyDoc.exists) throw new HttpsError('not-found', 'Aluno não encontrado.');

  const studentOrgIds = new Set(
    alunoMembershipsSnap.docs
      .map(d => ({
        id: d.id,
        ...d.data()
      }))
      .filter(v =>
        isActiveMembership(v) &&
        membershipRole(v) === 'student'
      )
      .map(v => v.organizacao_id)
      .filter(Boolean)
  );
  if (!studentOrgIds.size && alunoLegacyDoc.exists && alunoLegacyDoc.data().equipe_id && alunoLegacyDoc.data().status_vinculo === 'ativo') {
    studentOrgIds.add(alunoLegacyDoc.data().equipe_id);
  }

  const commonMemberships = ctx.examMemberships.filter(v => studentOrgIds.has(v.organizacao_id));
  if (!commonMemberships.length) {
    throw new HttpsError('permission-denied', 'O aluno precisa ter vínculo ativo com a mesma academia do instrutor para realizar exame oficial de faixa.');
  }
  if (commonMemberships.length > 1) {
    throw new HttpsError('failed-precondition', 'Há mais de uma academia em comum. A seleção da academia será exigida nesta situação.');
  }

  const orgId = commonMemberships[0].organizacao_id;
  const org = await getOrganization(orgId);
  const orgName = textField(org?.nome_equipe || org?.nome || 'Academia', 140);
  const authorizationRef = db.doc(`autorizacoes_exame/${alunoId}`);

  const update = {
    aluno_id: alunoId,
    professor_autorizador_id: uid,
    organizacao_id: orgId,
    organizacao_nome: orgName,
    faixa_alvo: autorizar ? faixa : null,
    status: autorizar ? 'autorizada' : 'revogada',
    inicio: autorizar ? inicio : null,
    fim: autorizar ? fim : null,
    credito_consumido: false,
    atualizado_em: FieldValue.serverTimestamp()
  };
  if (autorizar) update.criado_em = FieldValue.serverTimestamp();
  await authorizationRef.set(update, { merge: true });

  // Compatibilidade com o painel do aluno v1.0 durante a migração visual.
  if (alunoLegacyDoc.exists) {
    await db.doc(`alunos/${alunoId}`).set({
      exame_habilitado: autorizar,
      status_exame_em_andamento: false,
      faixa_exame: autorizar ? faixa : null,
      status_exame: autorizar ? 'pendente' : null,
      professor_autorizador_id: autorizar ? uid : null,
      credito_consumido: false,
      exame_inicio: autorizar ? inicio : null,
      exame_fim: autorizar ? fim : null,
      atualizado_em: FieldValue.serverTimestamp()
    }, { merge: true });
  }

  return { ok: true, organizacaoId: orgId, organizacaoNome: orgName };
});


function courseCatalogView(id, course, includeContent = false, includeOutline = false) {
  const base = {
    id_curso: id,
    titulo: textField(course.titulo || 'Curso BJJ Exams', 180),
    descricao_curta: textField(course.descricao_curta || '', 600),
    preco: Number(course.preco || 0),
    professor_nome: textField(course.professor_nome || 'Professor BJJ Exams', 140),
    professor_bio: textField(course.professor_bio || '', 1200),
    url_capa: textField(course.url_capa || '', 1200),
    topicos: Array.isArray(course.topicos) ? course.topicos.slice(0, 12).map(v => textField(v, 180)) : [],
    total_alunos: Number(course.total_alunos || 0),
    status: course.status || 'publicado'
  };

  if (includeContent) {
    base.professor_id = course.professor_id || null;
    base.modulos = Array.isArray(course.modulos) ? course.modulos : [];
    base.questoes_ids = Array.isArray(course.questoes_ids) ? course.questoes_ids : [];
    base.config_exame = course.config_exame || null;
    base.pre_requisitos = Array.isArray(course.pre_requisitos) ? course.pre_requisitos : [];
    base.descricao = course.descricao || course.descricao_longa || '';
  } else if (includeOutline) {
    base.modulos = (Array.isArray(course.modulos) ? course.modulos : []).map(mod => ({
      titulo: textField(mod?.titulo || 'Módulo', 180),
      aulas: (Array.isArray(mod?.aulas) ? mod.aulas : []).map(aula => ({
        titulo: textField(aula?.titulo || 'Aula', 180),
        url_video: Boolean(aula?.url_video),
        url_pdf: Boolean(aula?.url_pdf)
      }))
    }));
  }
  return base;
}

exports.listarCatalogoCursos = onCall({ region: REGION }, async (request) => {
  const cursoId = textField(request.data?.cursoId, 128);
  if (cursoId) {
    const snap = await db.doc(`cursos_teoricos/${cursoId}`).get();
    if (!snap.exists || snap.data().status !== 'publicado') throw new HttpsError('not-found', 'Curso não encontrado.');
    return { curso: courseCatalogView(snap.id, snap.data(), false, true) };
  }
  const snap = await db.collection('cursos_teoricos').where('status', '==', 'publicado').limit(60).get();
  return { cursos: snap.docs.map(d => courseCatalogView(d.id, d.data(), false, false)) };
});

exports.listarCursosAluno = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const [coursesSnap, enrollmentSnap] = await Promise.all([
    db.collection('cursos_teoricos').where('status', '==', 'publicado').limit(100).get(),
    db.collection('matriculas').where('aluno_id', '==', uid).get()
  ]);
  const enrolled = new Set(enrollmentSnap.docs.map(d => d.data().curso_id).filter(Boolean));
  const cursos = coursesSnap.docs.map(d => courseCatalogView(d.id, d.data(), enrolled.has(d.id), false));
  return { cursos };
});

exports.matricularCursoGratuito = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const cursoId = String(request.data?.cursoId || '').trim();
  if (!cursoId) throw new HttpsError('invalid-argument', 'Curso inválido.');

  const cursoRef = db.doc(`cursos_teoricos/${cursoId}`);
  const cursoDoc = await cursoRef.get();
  if (!cursoDoc.exists || cursoDoc.data().status !== 'publicado') throw new HttpsError('not-found', 'Curso indisponível.');
  if (Number(cursoDoc.data().preco || 0) > 0) throw new HttpsError('failed-precondition', 'Este curso exige pagamento.');

  const existingEnrollment = await findEnrollment(uid, cursoId);
  if (existingEnrollment) return { ok: true, matriculaId: existingEnrollment.id, alreadyEnrolled: true };

  const matriculaRef = db.doc(`matriculas/${uid}_${cursoId}`);
  await matriculaRef.set({
    aluno_id: uid,
    curso_id: cursoId,
    data_inscricao: FieldValue.serverTimestamp(),
    progresso: 0,
    aulas_concluidas: [],
    origem: 'gratuito',
    status_pagamento: 'gratuito'
  }, { merge: true });

  return { ok: true, matriculaId: matriculaRef.id };
});


exports.concluirAulaCurso = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const cursoId = String(request.data?.cursoId || '').trim();
  const aulaId = String(request.data?.aulaId || '').trim();
  if (!cursoId || !aulaId) throw new HttpsError('invalid-argument', 'Curso ou aula inválidos.');

  const [cursoDoc, matriculaDoc] = await Promise.all([
    db.doc(`cursos_teoricos/${cursoId}`).get(),
    findEnrollment(uid, cursoId)
  ]);
  if (!cursoDoc.exists || cursoDoc.data().status !== 'publicado') throw new HttpsError('not-found', 'Curso indisponível.');
  if (!matriculaDoc) throw new HttpsError('permission-denied', 'Você não está matriculado neste curso.');

  const curso = cursoDoc.data();
  const aulas = [];
  for (const modulo of (Array.isArray(curso.modulos) ? curso.modulos : [])) {
    for (const aula of (Array.isArray(modulo.aulas) ? modulo.aulas : [])) {
      if (!aula?.titulo) continue;
      aulas.push(`${cursoId}_${aula.titulo}`);
    }
  }
  if (!aulas.includes(aulaId)) throw new HttpsError('invalid-argument', 'Aula não pertence a este curso.');

  let progressoFinal = 0;
  let concluidasFinal = [];
  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(matriculaDoc.ref);
    if (!fresh.exists || fresh.data().aluno_id !== uid || fresh.data().curso_id !== cursoId) {
      throw new HttpsError('permission-denied', 'Matrícula inválida.');
    }
    const atuais = Array.isArray(fresh.data().aulas_concluidas) ? fresh.data().aulas_concluidas : [];
    concluidasFinal = [...new Set([...atuais.filter(id => aulas.includes(id)), aulaId])];
    progressoFinal = aulas.length ? Math.round((concluidasFinal.length / aulas.length) * 100) : 0;
    tx.set(matriculaDoc.ref, {
      aulas_concluidas: concluidasFinal,
      progresso: Math.min(100, progressoFinal),
      atualizado_em: FieldValue.serverTimestamp()
    }, { merge: true });
  });

  return { ok: true, progresso: Math.min(100, progressoFinal), aulasConcluidas: concluidasFinal };
});

exports.criarCheckoutCurso = onCall({ region: REGION, secrets: [ASAAS_API_KEY] }, async (request) => {
  const uid = requireAuth(request);
  const cursoId = String(request.data?.cursoId || '').trim();
  if (!cursoId) throw new HttpsError('invalid-argument', 'Curso inválido.');

  const [cursoDoc, profile] = await Promise.all([
    db.doc(`cursos_teoricos/${cursoId}`).get(),
    getProfile(uid)
  ]);
  if (!cursoDoc.exists || cursoDoc.data().status !== 'publicado') throw new HttpsError('not-found', 'Curso indisponível.');

  const course = cursoDoc.data();
  const value = Number(course.preco || 0);
  if (!(value > 0)) throw new HttpsError('failed-precondition', 'Use a matrícula gratuita para este curso.');

  const existing = await findEnrollment(uid, cursoId);
  if (existing) return { ok: true, alreadyEnrolled: true };

  const customer = await getOrCreateCustomer(profile);
  const orderRef = db.collection('pedidos').doc();
  const split = await buildCourseSplit(course);
  const payment = await asaas().createPayment({
    customerId: customer.id,
    billingType: 'PIX',
    value,
    dueDate: new Date().toISOString().slice(0, 10),
    description: `BJJ Exams - ${course.titulo || 'Curso'}`,
    externalReference: `course:${orderRef.id}`,
    split
  });
  if (!payment.success) throw new HttpsError('internal', 'Falha ao gerar cobrança Pix.');

  const qr = await asaas().getPixQrCode(payment.data.id);
  if (!qr.success) throw new HttpsError('internal', 'Cobrança criada, mas o QR Code não pôde ser carregado.');

  await orderRef.set({
    tipo: 'curso',
    aluno_id: uid,
    curso_id: cursoId,
    professor_id: course.professor_id || null,
    professor_nome: course.professor_nome || null,
    titulo: course.titulo || 'Curso',
    valor: value,
    status: 'aguardando_pagamento',
    asaas_payment_id: payment.data.id,
    asaas_customer_id: customer.id,
    criado_em: FieldValue.serverTimestamp(),
    atualizado_em: FieldValue.serverTimestamp()
  });

  return {
    ok: true,
    pedidoId: orderRef.id,
    paymentId: payment.data.id,
    pix: {
      encodedImage: qr.data.encodedImage,
      payload: qr.data.payload,
      expirationDate: qr.data.expirationDate
    }
  };
});

exports.criarCheckoutCreditos = onCall({ region: REGION, secrets: [ASAAS_API_KEY] }, async (request) => {
  const uid = requireAuth(request);
  const quantidade = Number(request.data?.quantidade);
  const value = CREDIT_PACKAGES.get(quantidade);
  if (!value) throw new HttpsError('invalid-argument', 'Pacote de créditos inválido.');

  const profile = await getProfile(uid);
  if (profile.tipo_usuario !== 'professor') throw new HttpsError('permission-denied', 'Disponível apenas para professores.');
  const customer = await getOrCreateCustomer(profile);
  const orderRef = db.collection('pedidos').doc();
  const payment = await asaas().createPayment({
    customerId: customer.id,
    billingType: 'PIX',
    value,
    dueDate: new Date().toISOString().slice(0, 10),
    description: `BJJ Exams - ${quantidade} créditos de exame`,
    externalReference: `credits:${orderRef.id}`
  });
  if (!payment.success) throw new HttpsError('internal', 'Falha ao gerar cobrança Pix.');
  const qr = await asaas().getPixQrCode(payment.data.id);
  if (!qr.success) throw new HttpsError('internal', 'Cobrança criada, mas o QR Code não pôde ser carregado.');

  await orderRef.set({
    tipo: 'creditos', professor_id: uid, quantidade, valor: value,
    status: 'aguardando_pagamento', asaas_payment_id: payment.data.id,
    criado_em: FieldValue.serverTimestamp(), atualizado_em: FieldValue.serverTimestamp()
  });
  return { ok: true, pedidoId: orderRef.id, paymentId: payment.data.id, pix: qr.data };
});

exports.consultarCheckout = onCall({ region: REGION, secrets: [ASAAS_API_KEY] }, async (request) => {
  const uid = requireAuth(request);
  const pedidoId = String(request.data?.pedidoId || '').trim();
  if (!pedidoId) throw new HttpsError('invalid-argument', 'Pedido inválido.');
  const ref = db.doc(`pedidos/${pedidoId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Pedido não encontrado.');
  const p = snap.data();
  const ownerOk = p.aluno_id === uid || p.professor_id === uid;
  if (!ownerOk) throw new HttpsError('permission-denied', 'Sem acesso a este pedido.');

  if (p.status !== 'pago' && p.asaas_payment_id) {
    const payment = await asaas().getPayment(p.asaas_payment_id);
    if (payment.success && ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(payment.data.status)) {
      await fulfillOrder(ref, p, payment.data);
      return { ok: true, status: 'pago' };
    }
  }
  return { ok: true, status: p.status };
});

async function fulfillOrder(orderRef, order, payment) {
  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(orderRef);
    if (!fresh.exists) return;
    const data = fresh.data();
    if (data.status === 'pago') return;

    let saldoAtual = 0;
    let saldoRef = null;
    if (data.tipo === 'creditos') {
      saldoRef = db.doc(`creditos_professor/${data.professor_id}`);
      const saldoDoc = await tx.get(saldoRef);
      saldoAtual = saldoDoc.exists ? Number(saldoDoc.data().saldo || 0) : 0;
    }

    tx.set(orderRef, {
      status: 'pago',
      pago_em: FieldValue.serverTimestamp(),
      atualizado_em: FieldValue.serverTimestamp(),
      asaas_status: payment?.status || null
    }, { merge: true });

    if (data.tipo === 'curso') {
      const matriculaRef = db.doc(`matriculas/${data.aluno_id}_${data.curso_id}`);
      tx.set(matriculaRef, {
        aluno_id: data.aluno_id,
        curso_id: data.curso_id,
        data_inscricao: FieldValue.serverTimestamp(),
        progresso: 0,
        aulas_concluidas: [],
        origem: 'compra',
        pedido_id: orderRef.id,
        status_pagamento: 'pago'
      }, { merge: true });
      const vendaRef = db.doc(`vendas_cursos/${orderRef.id}`);
      tx.set(vendaRef, {
        pedido_id: orderRef.id,
        aluno_id: data.aluno_id,
        curso_id: data.curso_id,
        titulo_curso: data.titulo,
        professor_id: data.professor_id || null,
        professor_nome: data.professor_nome || null,
        valor: Number(data.valor || 0),
        data_venda: FieldValue.serverTimestamp(),
        status: 'pago'
      }, { merge: true });
    }

    if (data.tipo === 'creditos' && saldoRef) {
      tx.set(saldoRef, {
        professor_id: data.professor_id,
        saldo: saldoAtual + Number(data.quantidade || 0),
        atualizado_em: FieldValue.serverTimestamp()
      }, { merge: true });
      tx.set(db.doc(`transacoes_creditos/${orderRef.id}`), {
        professor_id: data.professor_id,
        tipo: 'compra',
        quantidade: Number(data.quantidade || 0),
        valor_total: Number(data.valor || 0),
        data: FieldValue.serverTimestamp(),
        status: 'aprovado',
        pedido_id: orderRef.id
      }, { merge: true });
    }
  });
}

exports.asaasWebhook = onRequest({ region: REGION, secrets: [ASAAS_WEBHOOK_TOKEN] }, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  const receivedToken = req.get('asaas-access-token');
  if (!receivedToken || receivedToken !== ASAAS_WEBHOOK_TOKEN.value()) return res.status(401).send('Unauthorized');

  const event = req.body?.event;
  const payment = req.body?.payment;
  if (!event || !payment?.id) return res.status(400).send('Invalid payload');

  const eventId = String(req.body?.id || `${event}_${payment.id}`);
  const eventRef = db.doc(`webhook_eventos/${eventId}`);
  const eventSnap = await eventRef.get();
  if (eventSnap.exists && eventSnap.data().status === 'processado') return res.status(200).send('OK');

  try {
    await eventRef.set({
      event,
      payment_id: payment.id,
      status: 'processando',
      tentativas: FieldValue.increment(1),
      recebido_em: FieldValue.serverTimestamp()
    }, { merge: true });

    if (PAID_EVENTS.has(event)) {
      let orderRef = null;
      const ext = String(payment.externalReference || '');
      const match = ext.match(/^(course|credits):(.+)$/);
      if (match) orderRef = db.doc(`pedidos/${match[2]}`);
      if (!orderRef) {
        const snap = await db.collection('pedidos').where('asaas_payment_id', '==', payment.id).limit(1).get();
        if (!snap.empty) orderRef = snap.docs[0].ref;
      }
      if (orderRef) {
        const orderDoc = await orderRef.get();
        if (orderDoc.exists) await fulfillOrder(orderRef, orderDoc.data(), payment);
      }
    }
    await eventRef.set({ status: 'processado', processado_em: FieldValue.serverTimestamp() }, { merge: true });
    return res.status(200).send('OK');
  } catch (error) {
    logger.error('Erro no webhook Asaas', error);
    await eventRef.set({ status: 'erro', erro_em: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {});
    return res.status(500).send('Webhook processing failed');
  }
});


exports.obterPreviaExame = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const [authorizationDoc, legacyAlunoDoc] = await Promise.all([
    db.doc(`autorizacoes_exame/${uid}`).get(),
    db.doc(`alunos/${uid}`).get()
  ]);

  let faixa = '';
  let disponivelPorAutorizacao = false;
  if (authorizationDoc.exists && authorizationDoc.data().status === 'autorizada') {
    faixa = textField(authorizationDoc.data().faixa_alvo, 60);
    disponivelPorAutorizacao = true;
  } else if (legacyAlunoDoc.exists && legacyAlunoDoc.data().exame_habilitado) {
    // Compatibilidade temporária para autorizações criadas antes da v1.1.
    faixa = textField(legacyAlunoDoc.data().faixa_exame, 60);
    disponivelPorAutorizacao = true;
  }

  if (!faixa || !disponivelPorAutorizacao) {
    return { disponivel: false, tempoLimite: null, notaCorte: null };
  }
  const cfg = await db.doc(`config_exames/${faixa}`).get();
  if (!cfg.exists) return { disponivel: false, tempoLimite: null, notaCorte: null };
  const d = cfg.data();
  return {
    disponivel: Array.isArray(d.questoes_ids) && d.questoes_ids.length > 0,
    tempoLimite: Number(d.tempo_limite || 60),
    notaCorte: Number(d.nota_corte || d.aprovacao_minima || 70)
  };
});

exports.iniciarExameSeguro = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const tipo = String(request.data?.tipo || 'faixa');
  if (!['faixa', 'curso'].includes(tipo)) throw new HttpsError('invalid-argument', 'Tipo de exame inválido.');

  const [userDoc, legacyAlunoDoc] = await Promise.all([
    db.doc(`usuarios/${uid}`).get(),
    db.doc(`alunos/${uid}`).get()
  ]);
  if (!userDoc.exists && !legacyAlunoDoc.exists) throw new HttpsError('permission-denied', 'Perfil de aluno não encontrado.');
  const aluno = userDoc.exists ? userDoc.data() : legacyAlunoDoc.data();

  let titulo, targetId, questionIds, tempoLimite, notaCorte, questionCollection;
  let authorization = null;
  if (tipo === 'faixa') {
    const authorizationDoc = await db.doc(`autorizacoes_exame/${uid}`).get();
    if (authorizationDoc.exists && authorizationDoc.data().status === 'autorizada') {
      authorization = { ref: authorizationDoc.ref, ...authorizationDoc.data() };
    } else if (legacyAlunoDoc.exists && legacyAlunoDoc.data().exame_habilitado) {
      const a = legacyAlunoDoc.data();
      authorization = {
        ref: null,
        aluno_id: uid,
        professor_autorizador_id: a.professor_autorizador_id,
        organizacao_id: a.equipe_id || null,
        organizacao_nome: a.equipe_origem || null,
        faixa_alvo: a.faixa_exame,
        inicio: a.exame_inicio || null,
        fim: a.exame_fim || null,
        credito_consumido: Boolean(a.credito_consumido),
        legado: true
      };
    }
    if (!authorization) throw new HttpsError('permission-denied', 'Seu exame ainda não foi liberado.');

    targetId = authorization.faixa_alvo;
    if (!targetId) throw new HttpsError('failed-precondition', 'Faixa do exame não definida.');
    const configDoc = await db.doc(`config_exames/${targetId}`).get();
    if (!configDoc.exists) throw new HttpsError('not-found', 'Configuração de exame indisponível.');
    const cfg = configDoc.data();
    questionIds = cfg.questoes_ids || [];
    tempoLimite = Number(cfg.tempo_limite || 60);
    notaCorte = Number(cfg.nota_corte || cfg.aprovacao_minima || 70);
    titulo = `Exame de ${targetId}`;
    questionCollection = 'questoes';

    const nowIso = Date.now();
    if (authorization.inicio && nowIso < Date.parse(authorization.inicio)) {
      throw new HttpsError('failed-precondition', 'A janela deste exame ainda não foi iniciada.');
    }
    if (authorization.fim && nowIso > Date.parse(authorization.fim)) {
      throw new HttpsError('deadline-exceeded', 'A janela deste exame foi encerrada.');
    }
    if (!authorization.professor_autorizador_id || !authorization.organizacao_id) {
      throw new HttpsError('failed-precondition', 'O exame oficial precisa estar vinculado a um instrutor e uma academia.');
    }

    if (!authorization.credito_consumido) {
      const profId = authorization.professor_autorizador_id;
      const saldoRef = db.doc(`creditos_professor/${profId}`);
      const authRef = authorization.ref || db.doc(`autorizacoes_exame/${uid}`);
      await db.runTransaction(async (tx) => {
        const [saldoDoc, authFresh, legacyFresh] = await Promise.all([
          tx.get(saldoRef),
          tx.get(authRef),
          tx.get(db.doc(`alunos/${uid}`))
        ]);
        const authData = authFresh.exists ? authFresh.data() : authorization;
        if (authData.credito_consumido) return;
        const saldo = saldoDoc.exists ? Number(saldoDoc.data().saldo || 0) : 0;
        if (saldo <= 0) throw new HttpsError('failed-precondition', 'O instrutor responsável está sem créditos disponíveis.');
        tx.set(saldoRef, { saldo: saldo - 1, atualizado_em: FieldValue.serverTimestamp() }, { merge: true });
        const transRef = db.collection('transacoes_creditos').doc();
        tx.set(transRef, {
          professor_id: profId,
          tipo: 'consumo',
          quantidade: 1,
          aluno: aluno.nome || '',
          aluno_id: uid,
          faixa: targetId,
          organizacao_id: authorization.organizacao_id,
          data: FieldValue.serverTimestamp(),
          status: 'consumido'
        });
        tx.set(authRef, { credito_consumido: true, atualizado_em: FieldValue.serverTimestamp() }, { merge: true });
        if (legacyFresh.exists) tx.set(legacyFresh.ref, { credito_consumido: true }, { merge: true });
      });
      authorization.credito_consumido = true;
    }
  } else {
    targetId = String(request.data?.cursoId || '').trim();
    const [cursoDoc, matriculaDoc] = await Promise.all([
      db.doc(`cursos_teoricos/${targetId}`).get(),
      findEnrollment(uid, targetId)
    ]);
    if (!cursoDoc.exists || cursoDoc.data().status !== 'publicado') throw new HttpsError('not-found', 'Curso indisponível.');
    if (!matriculaDoc || Number(matriculaDoc.data().progresso || 0) < 100) throw new HttpsError('permission-denied', 'Conclua 100% do curso antes do exame.');
    const course = cursoDoc.data();
    questionIds = course.questoes_ids || [];
    tempoLimite = Number(course.config_exame?.tempo_limite || 60);
    notaCorte = Number(course.config_exame?.nota_corte || 70);
    titulo = `Exame final — ${course.titulo || 'Curso'}`;
    questionCollection = 'questoes_exames';
  }

  if (!questionIds.length) throw new HttpsError('failed-precondition', 'Este exame ainda não possui questões.');

  const refs = questionIds.map(id => db.doc(`${questionCollection}/${id}`));
  const docs = await db.getAll(...refs);
  const questions = docs.filter(d => d.exists).map(d => publicQuestion(d.id, d.data()));
  if (!questions.length) throw new HttpsError('failed-precondition', 'Não foi possível montar a prova.');

  for (let i = questions.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [questions[i], questions[j]] = [questions[j], questions[i]];
  }

  const now = Date.now();
  const expiresAt = Timestamp.fromMillis(now + tempoLimite * 60 * 1000);
  const attemptRef = db.collection('tentativas_exame').doc();
  await attemptRef.set({
    aluno_id: uid,
    tipo,
    alvo_id: targetId,
    titulo,
    question_collection: questionCollection,
    question_ids: questions.map(q => q.id),
    nota_corte: notaCorte,
    tempo_limite: tempoLimite,
    professor_autorizador_id: authorization?.professor_autorizador_id || null,
    organizacao_id: authorization?.organizacao_id || null,
    organizacao_nome: authorization?.organizacao_nome || null,
    status: 'em_andamento',
    iniciado_em: FieldValue.serverTimestamp(),
    expira_em: expiresAt
  });

  if (tipo === 'faixa' && legacyAlunoDoc.exists) {
    await legacyAlunoDoc.ref.set({ status_exame_em_andamento: true, timestamp_inicio_exame: now }, { merge: true });
  }

  return { attemptId: attemptRef.id, tipo, titulo, tempoLimite, notaCorte, questions };
});

exports.finalizarExameSeguro = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const attemptId = String(request.data?.attemptId || '').trim();
  const respostas = request.data?.respostas || {};
  const anuladaPorCola = Boolean(request.data?.anuladaPorCola);
  if (!attemptId) throw new HttpsError('invalid-argument', 'Tentativa inválida.');

  const attemptRef = db.doc(`tentativas_exame/${attemptId}`);
  const attemptDoc = await attemptRef.get();
  if (!attemptDoc.exists) throw new HttpsError('not-found', 'Tentativa não encontrada.');
  const attempt = attemptDoc.data();
  if (attempt.aluno_id !== uid) throw new HttpsError('permission-denied', 'Esta prova não pertence ao usuário atual.');
  if (attempt.status !== 'em_andamento') throw new HttpsError('failed-precondition', 'Esta prova já foi finalizada.');

  const expiryMs = attempt.expira_em?.toMillis ? attempt.expira_em.toMillis() : 0;
  const expired = expiryMs && Date.now() > expiryMs + 30000;
  const refs = (attempt.question_ids || []).map(id => db.doc(`${attempt.question_collection}/${id}`));
  const docs = refs.length ? await db.getAll(...refs) : [];
  let acertos = 0;
  if (!anuladaPorCola && !expired) {
    for (const d of docs) {
      if (d.exists && respostas[d.id] === d.data().resposta_correta) acertos++;
    }
  }
  const total = docs.filter(d => d.exists).length;
  const nota = total ? Math.round((acertos / total) * 100) : 0;
  const passou = !anuladaPorCola && !expired && nota >= Number(attempt.nota_corte || 70);
  const resultRef = db.collection('resultados').doc();
  let certCode = null;
  let orgName = attempt.organizacao_nome || null;
  if (!orgName && attempt.organizacao_id) {
    const org = await getOrganization(attempt.organizacao_id);
    orgName = org ? textField(org.nome_equipe || org.nome || '', 140) : null;
  }

  await db.runTransaction(async (tx) => {
    const userRef = db.doc(`usuarios/${uid}`);
    const legacyAlunoRef = db.doc(`alunos/${uid}`);
    const authorizationRef = db.doc(`autorizacoes_exame/${uid}`);
    const [fresh, userSnap, legacyAlunoSnap, authSnap] = await Promise.all([
      tx.get(attemptRef), tx.get(userRef), tx.get(legacyAlunoRef), tx.get(authorizationRef)
    ]);
    if (!fresh.exists || fresh.data().status !== 'em_andamento') throw new HttpsError('failed-precondition', 'Esta prova já foi finalizada.');
    if (!userSnap.exists && !legacyAlunoSnap.exists) throw new HttpsError('not-found', 'Aluno não encontrado.');
    const alunoData = userSnap.exists ? userSnap.data() : legacyAlunoSnap.data();

    tx.set(resultRef, {
      aluno_id: uid,
      aluno_nome: alunoData.nome || '',
      exame_nome: attempt.titulo,
      faixa_alvo: attempt.tipo === 'faixa' ? attempt.alvo_id : null,
      curso_id: attempt.tipo === 'curso' ? attempt.alvo_id : null,
      organizacao_id: attempt.organizacao_id || null,
      organizacao_nome: orgName,
      professor_autorizador_id: attempt.professor_autorizador_id || null,
      equipe_id: attempt.organizacao_id || null, // compatibilidade de relatórios legados
      data_execucao: FieldValue.serverTimestamp(),
      nota, acertos, total_questoes: total,
      status: passou ? 'aprovado' : 'reprovado',
      anulada_por_cola: anuladaPorCola,
      tempo_esgotado: Boolean(expired),
      tentativa_id: attemptId
    });

    tx.set(attemptRef, {
      status: passou ? 'aprovado' : 'reprovado',
      finalizado_em: FieldValue.serverTimestamp(),
      nota,
      resultado_id: resultRef.id
    }, { merge: true });

    if (passou) {
      certCode = certificateCode();
      tx.set(db.doc(`certificados/${certCode}`), {
        hash: certCode,
        aluno_id: uid,
        nome_aluno: alunoData.nome || '',
        faixa_alvo: attempt.tipo === 'faixa' ? attempt.alvo_id : `Curso: ${attempt.titulo.replace(/^Exame final — /, '')}`,
        exame_nome: attempt.titulo,
        curso_id: attempt.tipo === 'curso' ? attempt.alvo_id : null,
        tipo: attempt.tipo,
        nota_final: nota,
        emitido_em: FieldValue.serverTimestamp(),
        organizacao_id: attempt.organizacao_id || null,
        organizacao_nome: orgName,
        equipe_origem: orgName,
        equipe_id: attempt.organizacao_id || null,
        professor_autorizador_id: attempt.professor_autorizador_id || null,
        resultado_id: resultRef.id,
        status: 'valido'
      });
    }

    if (attempt.tipo === 'faixa') {
      if (userSnap.exists) {
        const userUpdate = { atualizado_em: FieldValue.serverTimestamp() };
        if (passou) userUpdate.faixa_atual = attempt.alvo_id;
        tx.set(userRef, userUpdate, { merge: true });
      }
      if (legacyAlunoSnap.exists) {
        const legacyUpdate = {
          status_exame_em_andamento: false,
          exame_habilitado: false,
          status_exame: passou ? 'aprovado' : 'reprovado'
        };
        if (passou) legacyUpdate.faixa_atual = attempt.alvo_id;
        tx.set(legacyAlunoRef, legacyUpdate, { merge: true });
      }
      if (authSnap.exists) {
        tx.set(authorizationRef, {
          status: passou ? 'concluida_aprovada' : 'concluida_reprovada',
          resultado_id: resultRef.id,
          finalizado_em: FieldValue.serverTimestamp()
        }, { merge: true });
      }
    }
  });

  return {
    ok: true,
    passou,
    nota,
    acertos,
    total,
    notaCorte: Number(attempt.nota_corte || 70),
    certificado: certCode,
    motivo: expired ? 'tempo_esgotado' : (anuladaPorCola ? 'anulada_por_seguranca' : null)
  };
});



exports.solicitarVinculoOrganizacao = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);

  const organizacaoId =
    textField(
      request.data?.organizacaoId,
      128
    );

  if (!organizacaoId) {
    throw new HttpsError(
      'invalid-argument',
      'Selecione uma academia.'
    );
  }

  const userRef =
    db.doc(`usuarios/${uid}`);

  const legacyAlunoRef =
    db.doc(`alunos/${uid}`);

  const orgRef =
    db.doc(`organizacoes/${organizacaoId}`);

  const legacyOrgRef =
    db.doc(`equipes/${organizacaoId}`);

  const vinculoRef =
    db.doc(
      `vinculos_organizacao/${membershipId(
        organizacaoId,
        uid
      )}`
    );

  const membershipsQuery =
    db.collection('vinculos_organizacao')
      .where('usuario_id', '==', uid);

  let result = null;

  await db.runTransaction(async (tx) => {
    const [
      userDoc,
      legacyAlunoDoc,
      orgDoc,
      legacyOrgDoc,
      vinculoSnap,
      membershipsSnap
    ] = await Promise.all([
      tx.get(userRef),
      tx.get(legacyAlunoRef),
      tx.get(orgRef),
      tx.get(legacyOrgRef),
      tx.get(vinculoRef),
      tx.get(membershipsQuery)
    ]);

    if (
      !userDoc.exists &&
      !legacyAlunoDoc.exists
    ) {
      throw new HttpsError(
        'not-found',
        'Perfil de aluno não encontrado.'
      );
    }

    if (
      userDoc.exists &&
      canonicalRole(userDoc.data()) !== 'aluno'
    ) {
      throw new HttpsError(
        'permission-denied',
        'Este fluxo é destinado a alunos.'
      );
    }

    if (
      !orgDoc.exists &&
      !legacyOrgDoc.exists
    ) {
      throw new HttpsError(
        'not-found',
        'Academia não encontrada.'
      );
    }

    const orgData =
      orgDoc.exists
        ? orgDoc.data()
        : legacyOrgDoc.data();

    const statusOrg =
      textField(
        orgData.status || 'ativa',
        30
      ).toLowerCase();

    const blockedStatuses =
      new Set([
        'inativa',
        'suspensa',
        'bloqueada',
        'arquivada',
        'inactive',
        'suspended',
        'blocked',
        'archived'
      ]);

    if (blockedStatuses.has(statusOrg)) {
      throw new HttpsError(
        'failed-precondition',
        'Esta academia não está disponível para novos vínculos.'
      );
    }

    const organizacaoNome =
      textField(
        orgData.nome_equipe ||
        orgData.nome ||
        'Academia',
        140
      );

    // ==========================================================
    // VÍNCULO COM A ORGANIZAÇÃO ALVO JÁ EXISTE
    // ==========================================================

    if (vinculoSnap.exists) {
      const existing =
        vinculoSnap.data();

      if (
        existing.usuario_id &&
        existing.usuario_id !== uid
      ) {
        throw new HttpsError(
          'failed-precondition',
          'Vínculo incompatível com o usuário autenticado.'
        );
      }

      if (
        existing.organizacao_id &&
        existing.organizacao_id !==
          organizacaoId
      ) {
        throw new HttpsError(
          'failed-precondition',
          'Vínculo incompatível com a academia informada.'
        );
      }

      const role =
        membershipRole(existing);

      const currentStatus =
        normalizeMembershipStatus(
          existing.status
        );

      if (role !== 'student') {
        throw new HttpsError(
          'failed-precondition',
          'Já existe um vínculo institucional incompatível nesta academia.'
        );
      }

      if (currentStatus === 'active') {
        result = {
          ok: true,
          status: 'ativo',
          organizacaoId,
          organizacaoNome,
          alreadyLinked: true
        };

        return;
      }

      if (currentStatus === 'pending') {
        result = {
          ok: true,
          status: 'pendente',
          organizacaoId,
          organizacaoNome,
          alreadyPending: true
        };

        return;
      }

      throw new HttpsError(
        'failed-precondition',
        'Este vínculo não pode ser reaberto por esta operação.'
      );
    }

    // ==========================================================
    // GARANTIA TRANSITÓRIA:
    // apenas um vínculo ativo ou solicitação pendente de aluno.
    // A leitura está DENTRO da transação para evitar corrida.
    // ==========================================================

    const memberships =
      membershipsSnap.docs.map(
        doc => ({
          id: doc.id,
          ...doc.data()
        })
      );

    const active =
      memberships.find(v =>
        membershipRole(v) === 'student' &&
        normalizeMembershipStatus(
          v.status
        ) === 'active'
      );

    if (active) {
      throw new HttpsError(
        'failed-precondition',
        'Você já possui uma academia vinculada. A troca de academia será feita em um fluxo específico para preservar seu histórico.'
      );
    }

    const pending =
      memberships.find(v =>
        membershipRole(v) === 'student' &&
        normalizeMembershipStatus(
          v.status
        ) === 'pending'
      );

    if (pending) {
      throw new HttpsError(
        'failed-precondition',
        'Você já possui uma solicitação de vínculo pendente. Aguarde a resposta antes de solicitar outra academia.'
      );
    }

    // ==========================================================
    // PROJEÇÃO TRANSITÓRIA DE ORGANIZAÇÃO LEGADA
    // ==========================================================

    if (!orgDoc.exists) {
      tx.set(
        orgRef,
        {
          nome: organizacaoNome,
          nome_equipe:
            organizacaoNome,
          tipo: 'academia',
          status:
            orgData.status || 'ativa',
          migrado_de_equipes: true,
          migrado_em:
            FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    }

    // ==========================================================
    // NOVA SOLICITAÇÃO
    // ==========================================================

    tx.create(
      vinculoRef,
      {
        usuario_id: uid,
        organizacao_id:
          organizacaoId,
        papel: 'aluno',
        status: 'pendente',
        principal: true,
        pode_aplicar_exames: false,
        solicitado_em:
          FieldValue.serverTimestamp(),
        criado_em:
          FieldValue.serverTimestamp(),
        atualizado_em:
          FieldValue.serverTimestamp()
      }
    );

    if (userDoc.exists) {
      tx.set(
        userRef,
        {
          academia_pendente_id:
            organizacaoId,
          academia_pendente_nome:
            organizacaoNome,
          atualizado_em:
            FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    }

    // Compatibilidade temporária com painel v1.1.
    if (legacyAlunoDoc.exists) {
      tx.set(
        legacyAlunoRef,
        {
          equipe_id:
            organizacaoId,
          equipe_origem:
            organizacaoNome,
          status_vinculo:
            'pendente',
          atualizado_em:
            FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    }

    result = {
      ok: true,
      status: 'pendente',
      organizacaoId,
      organizacaoNome
    };
  });

  return result;
});

exports.responderVinculoOrganizacao = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const usuarioId = textField(request.data?.usuarioId, 128);
  const organizacaoId = textField(request.data?.organizacaoId, 128);
  const tipo = textField(request.data?.tipo, 20).toLowerCase();
  const status = textField(request.data?.status, 20).toLowerCase();
  if (!usuarioId || !organizacaoId) throw new HttpsError('invalid-argument', 'Vínculo inválido.');
  if (!['aluno', 'professor'].includes(tipo)) throw new HttpsError('invalid-argument', 'Tipo de vínculo inválido.');
  if (!['ativo', 'rejeitado'].includes(status)) throw new HttpsError('invalid-argument', 'Status inválido.');

  const ctx = await getProfessorContext(uid);
  const manager = ctx.memberships.find(v => v.organizacao_id === organizacaoId && canManageOrganization(v));
  if (!manager) throw new HttpsError('permission-denied', 'Somente o gestor da academia pode aprovar vínculos.');

  const vinculoRef = db.doc(`vinculos_organizacao/${membershipId(organizacaoId, usuarioId)}`);
  const legacyRef = db.doc(`${tipo === 'aluno' ? 'alunos' : 'professores'}/${usuarioId}`);
  const userRef = db.doc(`usuarios/${usuarioId}`);
  const orgRef = db.doc(`organizacoes/${organizacaoId}`);
  const legacyOrgRef = db.doc(`equipes/${organizacaoId}`);

  await db.runTransaction(async (tx) => {
    const [vinculoSnap, legacySnap, userSnap, orgSnap, legacyOrgSnap] = await Promise.all([
      tx.get(vinculoRef), tx.get(legacyRef), tx.get(userRef), tx.get(orgRef), tx.get(legacyOrgRef)
    ]);
    if (!legacySnap.exists && !userSnap.exists) throw new HttpsError('not-found', 'Usuário não encontrado.');

    const orgData = orgSnap.exists ? orgSnap.data() : (legacyOrgSnap.exists ? legacyOrgSnap.data() : {});
    const organizacaoNome = textField(orgData.nome_equipe || orgData.nome || 'Academia', 140);
    if (!vinculoSnap.exists) {
      throw new HttpsError('failed-precondition', 'Solicitação de vínculo não encontrada.');
    }

    const existing = vinculoSnap.data();

    if (existing.usuario_id && existing.usuario_id !== usuarioId) {
      throw new HttpsError('failed-precondition', 'Vínculo incompatível com o usuário informado.');
    }

    if (existing.organizacao_id && existing.organizacao_id !== organizacaoId) {
      throw new HttpsError('failed-precondition', 'Vínculo incompatível com a academia informada.');
    }

    const expectedRole = tipo === 'aluno' ? 'student' : 'instructor';
    if (membershipRole(existing) !== expectedRole) {
      throw new HttpsError('failed-precondition', 'Tipo informado não corresponde ao vínculo existente.');
    }

    const currentStatus = normalizeMembershipStatus(existing.status);
    const requestedStatus = normalizeMembershipStatus(status);

    if (currentStatus !== 'pending' && currentStatus !== requestedStatus) {
      throw new HttpsError('failed-precondition', 'Este vínculo já foi processado com outro status.');
    }

    tx.set(vinculoRef, {
      usuario_id: usuarioId,
      organizacao_id: organizacaoId,
      papel: existing.papel || (tipo === 'aluno' ? 'aluno' : 'professor'),
      status,
      principal: existing.principal !== false,
      pode_aplicar_exames: existing.pode_aplicar_exames === true,
      aprovado_por_uid: uid,
      atualizado_em: FieldValue.serverTimestamp()
    }, { merge: true });

    if (legacySnap.exists) {
      if (tipo === 'aluno') {
        tx.set(legacyRef, status === 'ativo' ? {
          equipe_id: organizacaoId,
          equipe_origem: organizacaoNome,
          status_vinculo: 'ativo',
          atualizado_em: FieldValue.serverTimestamp()
        } : {
          equipe_id: null,
          equipe_origem: null,
          status_vinculo: 'ativo',
          atualizado_em: FieldValue.serverTimestamp()
        }, { merge: true });
      } else {
        tx.set(legacyRef, { status_vinculo: status, atualizado_em: FieldValue.serverTimestamp() }, { merge: true });
      }
    }

    if (userSnap.exists) {
      const userUpdate = {
        academia_pendente_id: null,
        academia_pendente_nome: null,
        atualizado_em: FieldValue.serverTimestamp()
      };
      if (status === 'ativo') {
        userUpdate.academia_principal_id = organizacaoId;
        userUpdate.academia_principal_nome = organizacaoNome;
        userUpdate.equipe_id = organizacaoId; // compatibilidade temporária
        userUpdate.equipe_origem = organizacaoNome;
      }
      tx.set(userRef, userUpdate, { merge: true });
    }
  });
  return { ok: true, status };
});


exports.gerenciarMeuVinculoOrganizacao = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const data = request.data || {};

  const userRef = db.doc(`usuarios/${uid}`);
  const userDoc = await userRef.get();

  if (!userDoc.exists || canonicalRole(userDoc.data()) !== 'professor') {
    throw new HttpsError(
      'permission-denied',
      'Ação disponível apenas para instrutores.'
    );
  }

  const userData = userDoc.data();

  const organizacaoIdSolicitada =
    textField(data.organizacaoId, 128);

  const novaOrganizacao =
    organizacaoIdSolicitada === 'nova_equipe';

  const nomeNovo =
    textField(data.novaOrganizacaoNome, 140)
      .toUpperCase();

  const nomePerfil =
    textField(data.nome, 140)
      .toUpperCase();

  // Mantido apenas por compatibilidade nesta etapa.
  // A governança de recebedores será tratada no domínio financeiro.
  const wallet =
    textField(data.asaasWalletId, 180);

  if (nomePerfil && nomePerfil.length < 3) {
    throw new HttpsError(
      'invalid-argument',
      'Informe um nome válido.'
    );
  }

  if (novaOrganizacao && nomeNovo.length < 3) {
    throw new HttpsError(
      'invalid-argument',
      'Informe o nome da nova academia.'
    );
  }

  let organizacaoIdFinal =
    organizacaoIdSolicitada || null;

  let organizacaoNome = null;
  let statusVinculo = null;
  let papelVinculo = null;

  await db.runTransaction(async (tx) => {
    const userUpdate = {
      atualizado_em:
        FieldValue.serverTimestamp()
    };

    if (nomePerfil) {
      userUpdate.nome = nomePerfil;
    }

    if (wallet) {
      userUpdate.asaas_wallet_id = wallet;
    }

    // Atualização simples de perfil, sem operação institucional.
    if (!organizacaoIdSolicitada) {
      tx.set(
        userRef,
        userUpdate,
        { merge: true }
      );

      return;
    }

    // ==========================================================
    // NOVA ORGANIZAÇÃO
    // ==========================================================

    if (novaOrganizacao) {
      const orgRef =
        db.collection('organizacoes').doc();

      organizacaoIdFinal = orgRef.id;
      organizacaoNome = nomeNovo;
      statusVinculo = 'ativo';
      papelVinculo = 'gestor';

      tx.create(orgRef, {
        nome: organizacaoNome,
        nome_equipe: organizacaoNome,
        tipo: 'academia',
        status: 'ativa',
        criado_por_uid: uid,
        criado_em:
          FieldValue.serverTimestamp()
      });

      tx.set(
        db.doc(
          `equipes/${organizacaoIdFinal}`
        ),
        {
          nome: organizacaoNome,
          nome_equipe: organizacaoNome,
          status: 'ativa',
          criado_por_uid: uid,
          arquitetura_v11: true,
          criado_em:
            FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      const vinculoRef =
        db.doc(
          `vinculos_organizacao/${membershipId(
            organizacaoIdFinal,
            uid
          )}`
        );

      tx.create(vinculoRef, {
        usuario_id: uid,
        organizacao_id:
          organizacaoIdFinal,
        papel: 'gestor',
        status: 'ativo',
        principal: true,
        pode_aplicar_exames: true,
        criado_em:
          FieldValue.serverTimestamp(),
        atualizado_em:
          FieldValue.serverTimestamp()
      });

      tx.set(
        db.doc(`professores/${uid}`),
        {
          usuario_id: uid,
          equipe_id:
            organizacaoIdFinal,
          status_vinculo: 'ativo',
          eh_responsavel: true,
          pode_aprovar: true,
          arquitetura_v11: true,
          atualizado_em:
            FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      userUpdate.academia_principal_id =
        organizacaoIdFinal;

      userUpdate.academia_principal_nome =
        organizacaoNome;

      userUpdate.equipe_id =
        organizacaoIdFinal;

      userUpdate.equipe_origem =
        organizacaoNome;

      userUpdate.academia_pendente_id =
        null;

      userUpdate.academia_pendente_nome =
        null;

      tx.set(
        userRef,
        userUpdate,
        { merge: true }
      );

      return;
    }

    // ==========================================================
    // ORGANIZAÇÃO EXISTENTE
    // ==========================================================

    const orgRef =
      db.doc(
        `organizacoes/${organizacaoIdSolicitada}`
      );

    const legacyOrgRef =
      db.doc(
        `equipes/${organizacaoIdSolicitada}`
      );

    const vinculoRef =
      db.doc(
        `vinculos_organizacao/${membershipId(
          organizacaoIdSolicitada,
          uid
        )}`
      );

    const [
      orgSnap,
      legacyOrgSnap,
      vinculoSnap
    ] = await Promise.all([
      tx.get(orgRef),
      tx.get(legacyOrgRef),
      tx.get(vinculoRef)
    ]);

    if (!orgSnap.exists && !legacyOrgSnap.exists) {
      throw new HttpsError(
        'not-found',
        'Academia não encontrada.'
      );
    }

    const orgData =
      orgSnap.exists
        ? orgSnap.data()
        : legacyOrgSnap.data();

    const statusOrg =
      textField(
        orgData.status || 'ativa',
        30
      ).toLowerCase();

    const blockedStatuses =
      new Set([
        'inativa',
        'suspensa',
        'bloqueada',
        'arquivada',
        'inactive',
        'suspended',
        'blocked',
        'archived'
      ]);

    if (blockedStatuses.has(statusOrg)) {
      throw new HttpsError(
        'failed-precondition',
        'Esta academia não está disponível para novos vínculos.'
      );
    }

    organizacaoNome =
      textField(
        orgData.nome_equipe ||
        orgData.nome ||
        'Academia',
        140
      );

    // Projeção transitória: legado -> coleção institucional.
    if (!orgSnap.exists) {
      tx.set(
        orgRef,
        {
          nome: organizacaoNome,
          nome_equipe:
            organizacaoNome,
          tipo: 'academia',
          status:
            orgData.status || 'ativa',
          migrado_de_equipes: true,
          migrado_em:
            FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    }

    // ==========================================================
    // VÍNCULO JÁ EXISTENTE
    // ==========================================================

    if (vinculoSnap.exists) {
      const existing =
        vinculoSnap.data();

      if (
        existing.usuario_id &&
        existing.usuario_id !== uid
      ) {
        throw new HttpsError(
          'failed-precondition',
          'Vínculo incompatível com o usuário autenticado.'
        );
      }

      if (
        existing.organizacao_id &&
        existing.organizacao_id !==
          organizacaoIdSolicitada
      ) {
        throw new HttpsError(
          'failed-precondition',
          'Vínculo incompatível com a academia informada.'
        );
      }

      const role =
        membershipRole(existing);

      const currentStatus =
        normalizeMembershipStatus(
          existing.status
        );

      // Vínculo ativo nunca pode ser rebaixado para pendente
      // por esta ação.
      if (currentStatus === 'active') {
        if (
          ![
            'owner',
            'manager',
            'instructor'
          ].includes(role)
        ) {
          throw new HttpsError(
            'failed-precondition',
            'Papel institucional incompatível com o perfil de instrutor.'
          );
        }

        statusVinculo = 'ativo';

        papelVinculo =
          role === 'instructor'
            ? 'professor'
            : 'gestor';

        userUpdate.academia_principal_id =
          organizacaoIdSolicitada;

        userUpdate.academia_principal_nome =
          organizacaoNome;

        userUpdate.equipe_id =
          organizacaoIdSolicitada;

        userUpdate.equipe_origem =
          organizacaoNome;

        if (
          userData.academia_pendente_id ===
          organizacaoIdSolicitada
        ) {
          userUpdate.academia_pendente_id =
            null;

          userUpdate.academia_pendente_nome =
            null;
        }

        const managerLike =
          role === 'owner' ||
          role === 'manager';

        tx.set(
          db.doc(`professores/${uid}`),
          {
            usuario_id: uid,
            equipe_id:
              organizacaoIdSolicitada,
            status_vinculo: 'ativo',
            eh_responsavel:
              managerLike,
            pode_aprovar:
              managerLike,
            arquitetura_v11: true,
            atualizado_em:
              FieldValue.serverTimestamp()
          },
          { merge: true }
        );

        tx.set(
          userRef,
          userUpdate,
          { merge: true }
        );

        return;
      }

      // Retry de uma solicitação pendente:
      // não recria nem altera semanticamente o vínculo.
      if (currentStatus === 'pending') {
        if (role !== 'instructor') {
          throw new HttpsError(
            'failed-precondition',
            'Solicitação pendente possui papel institucional incompatível.'
          );
        }

        statusVinculo = 'pendente';
        papelVinculo = 'professor';

        userUpdate.academia_pendente_id =
          organizacaoIdSolicitada;

        userUpdate.academia_pendente_nome =
          organizacaoNome;

        tx.set(
          db.doc(`professores/${uid}`),
          {
            usuario_id: uid,
            equipe_id:
              organizacaoIdSolicitada,
            status_vinculo:
              'pendente',
            eh_responsavel: false,
            pode_aprovar: false,
            arquitetura_v11: true,
            atualizado_em:
              FieldValue.serverTimestamp()
          },
          { merge: true }
        );

        tx.set(
          userRef,
          userUpdate,
          { merge: true }
        );

        return;
      }

      // Rejeitado/suspenso/encerrado não é ressuscitado
      // implicitamente. Exigirá fluxo explícito posterior.
      throw new HttpsError(
        'failed-precondition',
        'Este vínculo não pode ser reativado por esta operação.'
      );
    }

    // ==========================================================
    // NOVA SOLICITAÇÃO PARA ORGANIZAÇÃO EXISTENTE
    // ==========================================================

    statusVinculo = 'pendente';
    papelVinculo = 'professor';

    tx.create(vinculoRef, {
      usuario_id: uid,
      organizacao_id:
        organizacaoIdSolicitada,
      papel: 'professor',
      status: 'pendente',
      principal: true,
      pode_aplicar_exames: false,
      solicitado_em:
        FieldValue.serverTimestamp(),
      criado_em:
        FieldValue.serverTimestamp(),
      atualizado_em:
        FieldValue.serverTimestamp()
    });

    // Importante: vínculo pendente NÃO altera
    // academia_principal_id/equipe_id do usuário.
    userUpdate.academia_pendente_id =
      organizacaoIdSolicitada;

    userUpdate.academia_pendente_nome =
      organizacaoNome;

    tx.set(
      db.doc(`professores/${uid}`),
      {
        usuario_id: uid,
        equipe_id:
          organizacaoIdSolicitada,
        status_vinculo: 'pendente',
        eh_responsavel: false,
        pode_aprovar: false,
        arquitetura_v11: true,
        atualizado_em:
          FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    tx.set(
      userRef,
      userUpdate,
      { merge: true }
    );
  });

  return {
    ok: true,
    organizacaoId:
      organizacaoIdFinal,
    organizacaoNome,
    statusVinculo,
    papel: papelVinculo
  };
});

exports.listarMinhasOrganizacoes = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const memberships = await getActiveMemberships(uid);
  const itens = [];
  for (const vinculo of memberships) {
    const org = await getOrganization(vinculo.organizacao_id);
    if (!org) continue;
    itens.push({
      id: vinculo.organizacao_id,
      nome: textField(org.nome_equipe || org.nome || 'Academia', 140),
      papel: vinculo.papel || vinculo.role || membershipRole(vinculo) || 'membro',
      status: vinculo.status || 'ativo',
      principal: Boolean(vinculo.principal),
      podeAplicarExames: canApplyOfficialExam(vinculo)
    });
  }
  return { organizacoes: itens };
});


// HOTFIX LOGIN V3 -----------------------------------------------------------
// Resolve perfis antigos no servidor, sem depender das regras Firestore do
// navegador. Tambem repara, de forma conservadora, perfis cujo documento ficou
// vinculado a um UID antigo mas possui o mesmo e-mail autenticado e verificado.
function normalizeLegacyRole(collectionName, data = {}) {
  if (collectionName === 'super_admins') return 'superadmin';
  if (collectionName === 'admins') return 'admin';
  if (collectionName === 'alunos') return 'aluno';
  if (collectionName === 'professores') return 'professor';
  const raw = String(data.tipo_usuario || data.tipoUsuario || data.perfil || data.role || '').trim().toLowerCase();
  if (['superadmin', 'super_admin'].includes(raw)) return 'superadmin';
  if (['admin', 'administrador'].includes(raw)) return 'admin';
  if (['professor', 'instrutor'].includes(raw)) return 'professor';
  if (['aluno', 'student'].includes(raw)) return 'aluno';
  return null;
}

async function directLegacyProfile(uid) {
  const refs = [
    ['super_admins', db.doc(`super_admins/${uid}`)],
    ['admins', db.doc(`admins/${uid}`)],
    ['usuarios', db.doc(`usuarios/${uid}`)],
    ['professores', db.doc(`professores/${uid}`)],
    ['alunos', db.doc(`alunos/${uid}`)]
  ];
  const snaps = await db.getAll(...refs.map(([, ref]) => ref));
  for (let i = 0; i < snaps.length; i++) {
    const snap = snaps[i];
    if (!snap.exists) continue;
    const collectionName = refs[i][0];
    const role = normalizeLegacyRole(collectionName, snap.data());
    if (role) return { role, collectionName, docId: uid, data: snap.data() };
  }

  const link = await db.collection('professores').where('usuario_id', '==', uid).limit(1).get();
  if (!link.empty) {
    return { role: 'professor', collectionName: 'professores', docId: link.docs[0].id, data: link.docs[0].data(), linkedOnly: true };
  }
  return null;
}

async function legacyProfilesByEmail(email) {
  if (!email) return [];
  const collections = ['super_admins', 'admins', 'usuarios', 'alunos'];
  const results = [];
  for (const collectionName of collections) {
    const snap = await db.collection(collectionName).where('email', '==', email).limit(3).get();
    for (const docSnap of snap.docs) {
      const role = normalizeLegacyRole(collectionName, docSnap.data());
      if (role) results.push({ role, collectionName, docId: docSnap.id, data: docSnap.data() });
    }
  }
  return results;
}

async function copyProfessorLink(oldUid, newUid) {
  let profSnap = await db.doc(`professores/${oldUid}`).get();
  if (!profSnap.exists) {
    const querySnap = await db.collection('professores').where('usuario_id', '==', oldUid).limit(1).get();
    if (!querySnap.empty) profSnap = querySnap.docs[0];
  }
  if (profSnap?.exists) {
    await db.doc(`professores/${newUid}`).set({
      ...profSnap.data(),
      usuario_id: newUid,
      migrado_de_uid: oldUid,
      migrado_em: FieldValue.serverTimestamp()
    }, { merge: true });
  }
}

async function relinkLegacyProfile(match, newUid) {
  const oldUid = match.docId;
  if (!oldUid || oldUid === newUid) return;

  if (match.collectionName === 'alunos') {
    await db.doc(`alunos/${newUid}`).set({
      ...match.data,
      migrado_de_uid: oldUid,
      migrado_em: FieldValue.serverTimestamp()
    }, { merge: true });
    return;
  }

  if (match.collectionName === 'usuarios') {
    await db.doc(`usuarios/${newUid}`).set({
      ...match.data,
      migrado_de_uid: oldUid,
      migrado_em: FieldValue.serverTimestamp()
    }, { merge: true });
    if (match.role === 'professor') await copyProfessorLink(oldUid, newUid);
    return;
  }

  if (match.collectionName === 'admins' || match.collectionName === 'super_admins') {
    await db.doc(`${match.collectionName}/${newUid}`).set({
      ...match.data,
      migrado_de_uid: oldUid,
      migrado_em: FieldValue.serverTimestamp()
    }, { merge: true });
  }
}

exports.resolverPerfilUsuario = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const authUser = await auth.getUser(uid);
  const email = String(authUser.email || request.auth?.token?.email || '').trim().toLowerCase();

  const direct = await directLegacyProfile(uid);
  if (direct && !direct.linkedOnly) {
    return finalizeResolvedProfile(uid, {
      encontrado: true,
      papel: direct.role,
      fonte: direct.collectionName,
      migrado: false
    });
  }

  // Um vinculo em professores sem usuarios/{uid} e um estado legado incompleto.
  // Tentamos recuperar pelo e-mail antes de encaminhar para revisao manual.
  const matches = await legacyProfilesByEmail(email);
  const grouped = new Map();
  for (const m of matches) {
    if (!grouped.has(m.docId)) grouped.set(m.docId, []);
    grouped.get(m.docId).push(m);
  }

  if (grouped.size === 1) {
    const [oldUid, items] = [...grouped.entries()][0];
    const preferred = items.find(x => x.collectionName === 'super_admins') ||
      items.find(x => x.collectionName === 'admins') ||
      items.find(x => x.collectionName === 'usuarios') ||
      items.find(x => x.collectionName === 'alunos') || items[0];

    if (oldUid === uid) {
      return finalizeResolvedProfile(uid, {
        encontrado: true,
        papel: preferred.role,
        fonte: preferred.collectionName,
        migrado: false
      });
    }

    const verified = authUser.emailVerified === true || request.auth?.token?.email_verified === true;
    if (!verified) {
      return {
        encontrado: false,
        perfilLegado: true,
        motivo: 'email_nao_verificado',
        fonte: preferred.collectionName
      };
    }

    await relinkLegacyProfile(preferred, uid);
    const repaired = await directLegacyProfile(uid);
    if (repaired && !repaired.linkedOnly) {
      logger.info('Perfil legado relincado ao UID autenticado.', {
        uid,
        oldUid,
        fonte: preferred.collectionName,
        papel: repaired.role
      });
      return finalizeResolvedProfile(uid, {
        encontrado: true,
        papel: repaired.role,
        fonte: repaired.collectionName,
        migrado: true
      });
    }
  }

  if (grouped.size > 1) {
    logger.warn('Conflito de perfis legados por e-mail.', { uid, quantidade: grouped.size });
    return { encontrado: false, perfilLegado: true, motivo: 'conflito_perfis' };
  }

  if (direct?.linkedOnly) {
    return { encontrado: false, perfilLegado: true, motivo: 'vinculo_professor_incompleto' };
  }

  return { encontrado: false, motivo: 'perfil_nao_encontrado' };
});
