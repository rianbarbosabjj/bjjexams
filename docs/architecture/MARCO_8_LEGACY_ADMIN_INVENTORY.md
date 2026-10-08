# Marco 8 â€” InventÃ¡rio do legado administrativo

> RelatÃ³rio gerado automaticamente por `scripts/inventory-marco8-admin-legacy-v1_2.js`.

Este inventÃ¡rio Ã© estÃ¡tico e serve para orientar a migraÃ§Ã£o gradual do Marco 8. Ele nÃ£o altera Firestore, Auth, Functions, Hosting ou dados.

## 1. Baseline

- Branch analisada: `feature/marco8-ops-console`
- Commit analisado: `59a0b917f021772ca3332f00779a7acc9ed849b6`
- Commit curto: `59a0b91`
- Escopo frontend: pÃ¡ginas HTML na raiz + mÃ³dulos JavaScript em `js/`.
- Escopo backend: `functions/index.js`, `functions/main.js` e mÃ³dulos JavaScript em `functions/src/`.

## 2. Resumo

- Arquivos frontend analisados: **38**
- Arquivos classificados como superfÃ­cie administrativa: **8**
- Arquivos com leitura Firestore direta detectada: **8**
- Arquivos com mutation Firestore direta detectada: **5**
- SuperfÃ­cies administrativas com mutation direta: **3**
- OcorrÃªncias de leitura direta detectadas: **94**
- OcorrÃªncias de mutation direta detectadas: **68**
- Collections literais detectadas no frontend: **18**
- Callables/endpoints literais referenciados pelo frontend: **28**
- MÃ³dulos backend com superfÃ­cie de Functions detectada: **23**

## 3. SuperfÃ­cies administrativas

| Risco | Arquivo | Reads diretos | Mutations diretas | Collections literais | Callables literais |
| --- | --- | ---: | ---: | --- | --- |
| HIGH | `login.html` | 4 | 4 | `alunos`, `equipes`, `professores`, `super_admins`, `usuarios` | â€” |
| HIGH | `painel_admin.html` | 24 | 14 | `alunos`, `certificados`, `config_exames`, `professores`, `questoes`, `resultados`, `super_admins`, `usuarios`, `vendas_cursos` | â€” |
| HIGH | `painel_superadmin.html` | 11 | 14 | `admins`, `alunos`, `config_exames`, `professores`, `questoes`, `super_admins`, `usuarios` | â€” |
| NONE | `js/admin-financial-ops-entry-v1_2.js` | 0 | 0 | â€” | â€” |
| NONE | `js/course-admin-api-v1_2.js` | 0 | 0 | â€” | â€” |
| NONE | `js/course-exception-review-ui-v1_2.js` | 0 | 0 | â€” | â€” |
| NONE | `js/course-moderation-ui-v1_2.js` | 0 | 0 | â€” | â€” |
| NONE | `js/financial-ops-admin-bootstrap-v1_2.js` | 0 | 0 | â€” | â€” |

## 4. Mutations Firestore diretas no frontend

Esses pontos sÃ£o candidatos prioritÃ¡rios para encapsulamento por commands server-side.

| Arquivo | Linha | OperaÃ§Ã£o | Trecho |
| --- | ---: | --- | --- |
| `login.html` | 437 | `addDoc` | `const novaEqRef = await addDoc(collection(db, "equipes"), {` |
| `login.html` | 477 | `setDoc` | `await setDoc(doc(db, "alunos", uid), perfilData);` |
| `login.html` | 481 | `setDoc` | `await setDoc(doc(db, "usuarios", uid), perfilData);` |
| `login.html` | 482 | `setDoc` | `await setDoc(doc(db, "professores", uid), {` |
| `painel_admin.html` | 1107 | `updateDoc` | `await updateDoc(doc(db, "alunos", uid), { status_vinculo: status });` |
| `painel_admin.html` | 1109 | `updateDoc` | `await updateDoc(doc(db, "professores", uid), { status_vinculo: status });` |
| `painel_admin.html` | 1110 | `updateDoc` | `await updateDoc(doc(db, "usuarios", uid), { status_vinculo: status });` |
| `painel_admin.html` | 1179 | `updateDoc` | `await updateDoc(doc(db, u.coleção, editUserId), dadosAt);` |
| `painel_admin.html` | 1200 | `deleteDoc` | `await deleteDoc(doc(db, u.coleção, editUserId));` |
| `painel_admin.html` | 1300 | `setDoc` | `await setDoc(doc(db, "config_exames", faixa), {` |
| `painel_admin.html` | 1420 | `deleteDoc` | `await deleteDoc(doc(db, "config_exames", faixaId));` |
| `painel_admin.html` | 1501 | `updateDoc` | `await updateDoc(doc(db, "alunos", id), payload);` |
| `painel_admin.html` | 1599 | `updateDoc` | `await updateDoc(doc(db, "questoes", editQuestaoId), dadosAt);` |
| `painel_admin.html` | 1611 | `updateDoc` | `await updateDoc(doc(db, "questoes", id), { status: acao });` |
| `painel_admin.html` | 1631 | `deleteDoc` | `await deleteDoc(doc(db, "questoes", id));` |
| `painel_admin.html` | 1645 | `addDoc` | `await addDoc(collection(db, "questoes"), {` |
| `painel_admin.html` | 1695 | `addDoc` | `await addDoc(collection(db, "questoes"), {` |
| `painel_admin.html` | 1797 | `updateDoc` | `await updateDoc(ref, { nome: novoNome }, { merge: true });` |
| `painel_aluno.html` | 623 | `addDoc` | `try { await addDoc(collection(db, "notificacoes"), { usuario_id: usuarioId, titulo, mensagem, tipo, lida: false, link, criada_em: serverTimestamp() }); }` |
| `painel_aluno.html` | 667 | `updateDoc` | `window.marcarNotificacaoLida = async (notifId) => { try { await updateDoc(doc(db, "notificacoes", notifId), { lida: true }); window.carregarNotificacoes(); } catch(e) {} };` |
| `painel_aluno.html` | 668 | `deleteDoc` | `window.excluirNotificacao = async (notifId) => { try { await deleteDoc(doc(db, "notificacoes", notifId)); window.carregarNotificacoes(); } catch(e) {} };` |
| `painel_aluno.html` | 674 | `updateDoc` | `const batch = []; snap.forEach(docNotif => { batch.push(updateDoc(doc(db, "notificacoes", docNotif.id), { lida: true })); });` |
| `painel_aluno.html` | 763 | `updateDoc` | `if (acertou) { pontosGanhosNestaSessao += ptsValendo; document.getElementById('rola-pontos-sessao').innerText = pontosGanhosNestaSessao; alunoGlobal.pontos_rola = (alunoGlobal.pont` |
| `painel_aluno.html` | 764 | `updateDoc` | `try { await updateDoc(doc(db, "questoes", q.id), { vezes_utilizada: increment(1) }); } catch(e) {}` |
| `painel_aluno.html` | 915 | `addDoc` | `await addDoc(collection(db, "resultados"), { aluno_id: alunoGlobal.id, aluno_nome: alunoGlobal.nome, exame_nome: cursoAssistindo.titulo, equipe_id: alunoGlobal.equipe_id, data_exec` |
| `painel_aluno.html` | 918 | `setDoc` | `await setDoc(doc(db, "certificados", hashUnico), { hash: hashUnico, aluno_id: alunoGlobal.id, nome_aluno: alunoGlobal.nome, faixa_alvo: cursoAssistindo.titulo, nota_final: nota, em` |
| `painel_aluno.html` | 933 | `updateDoc` | `const tempoInicio = new Date().getTime(); await updateDoc(doc(db, "alunos", alunoGlobal.id), { status_exame_em_andamento: true, timestamp_inicio_exame: tempoInicio });` |
| `painel_aluno.html` | 969 | `addDoc` | `await addDoc(collection(db, "resultados"), { aluno_id: alunoGlobal.id, aluno_nome: alunoGlobal.nome, exame_nome: alunoGlobal.faixa_exame, equipe_id: alunoGlobal.equipe_id, data_exe` |
| `painel_aluno.html` | 972 | `setDoc` | `await setDoc(doc(db, "certificados", hashUnico), { hash: hashUnico, aluno_id: alunoGlobal.id, nome_aluno: alunoGlobal.nome, faixa_alvo: alunoGlobal.faixa_exame, nota_final: notaPer` |
| `painel_aluno.html` | 973 | `updateDoc` | `await updateDoc(doc(db, "alunos", alunoGlobal.id), { status_exame_em_andamento: false, exame_habilitado: false, status_exame: 'aprovado', faixa_atual: alunoGlobal.faixa_exame });` |
| `painel_aluno.html` | 978 | `updateDoc` | `await updateDoc(doc(db, "alunos", alunoGlobal.id), { status_exame_em_andamento: false, exame_habilitado: false, status_exame: 'reprovado' });` |
| `painel_aluno.html` | 1035 | `setDoc` | `await setDoc(doc(db, "certificados", hashUnico), { hash: hashUnico, aluno_id: alunoGlobal.id, nome_aluno: alunoGlobal.nome, faixa_alvo: \`Curso: ${curso.titulo}\`, exame_nome: curso.` |
| `painel_aluno.html` | 1077 | `updateDoc` | `window.salvarMeuPerfil = async (e) => { e.preventDefault(); const btn = document.getElementById('btn-save-profile'); btn.innerText = "A guardar..."; btn.disabled = true; try { awai` |
| `painel_professor.html` | 466 | `addDoc` | `await addDoc(collection(db, "transacoes_creditos"), { professor_id: profGlobal.id, tipo: 'compra', quantidade: pacoteSelecionado, valor_total: valorTotal, data: serverTimestamp(), ` |
| `painel_professor.html` | 468 | `updateDoc` | `if (saldoDoc.exists()) { await updateDoc(saldoRef, { saldo: (saldoDoc.data().saldo \|\| 0) + pacoteSelecionado, atualizado_em: serverTimestamp() }); }` |
| `painel_professor.html` | 469 | `setDoc` | `else { await setDoc(saldoRef, { professor_id: profGlobal.id, saldo: pacoteSelecionado, criado_em: serverTimestamp(), atualizado_em: serverTimestamp() }); }` |
| `painel_professor.html` | 517 | `updateDoc` | `await updateDoc(saldoRef, { saldo: (saldoDoc.data().saldo \|\| 0) - 1, atualizado_em: serverTimestamp() });` |
| `painel_professor.html` | 518 | `addDoc` | `await addDoc(collection(db, "transacoes_creditos"), { professor_id: profGlobal.id, tipo: 'consumo', quantidade: 1, aluno: alunoNome, faixa: faixaExame, data: serverTimestamp(), sta` |
| `painel_professor.html` | 671 | `updateDoc` | `if(colecao === 'alunos') { await updateDoc(doc(db, "alunos", uid), { status_vinculo: status }); }` |
| `painel_professor.html` | 672 | `updateDoc` | `else if (colecao === 'professores') { await updateDoc(doc(db, "professores", uid), { status_vinculo: status }); await updateDoc(doc(db, "usuarios", uid), { status_vinculo: status }` |
| `painel_professor.html` | 672 | `updateDoc` | `else if (colecao === 'professores') { await updateDoc(doc(db, "professores", uid), { status_vinculo: status }); await updateDoc(doc(db, "usuarios", uid), { status_vinculo: status }` |
| `painel_professor.html` | 804 | `setDoc` | `await setDoc(doc(db, "config_exames", faixa), {` |
| `painel_professor.html` | 878 | `deleteDoc` | `if (result.isConfirmed) { await deleteDoc(doc(db, "config_exames", faixaId)); renderizarVisualizacaoExames(); swalDark.fire('Excluído!', 'A configuração foi removida.', 'success');` |
| `painel_professor.html` | 927 | `updateDoc` | `await updateDoc(doc(db, "alunos", id), payload);` |
| `painel_professor.html` | 1017 | `addDoc` | `const docRef = await addDoc(collection(db, "cursos_teoricos"), novoCurso);` |
| `painel_professor.html` | 1151 | `deleteDoc` | `window.removerQuestaoUI = async (qIndex) => { const q = questoesState[qIndex]; if(q.id_banco) { await deleteDoc(doc(db, "questoes_exames", q.id_banco)); } questoesState.splice(qInd` |
| `painel_professor.html` | 1187 | `updateDoc` | `await updateDoc(doc(db, "cursos_teoricos", cursoEditandoId), { status: statusFinal, modulos: modulosState, config_exame: { nota_corte: parseInt(nota), tempo_limite: parseInt(tempo)` |
| `painel_professor.html` | 1191 | `updateDoc` | `if (q.id_banco) { await updateDoc(doc(db, "questoes_exames", q.id_banco), dadosQ); idsQuestoes.push(q.id_banco); }` |
| `painel_professor.html` | 1192 | `addDoc` | `else { const nQ = await addDoc(collection(db, "questoes_exames"), dadosQ); q.id_banco = nQ.id; idsQuestoes.push(nQ.id); }` |
| `painel_professor.html` | 1194 | `updateDoc` | `await updateDoc(doc(db, "cursos_teoricos", cursoEditandoId), { questoes_ids: idsQuestoes });` |
| `painel_professor.html` | 1215 | `addDoc` | `await addDoc(collection(db, "questoes"), { pergunta: document.getElementById('nova-q-pergunta').value.trim(), alternativas: { A: document.getElementById('nova-q-optA').value.trim()` |
| `painel_professor.html` | 1243 | `addDoc` | `const novaEqRef = await addDoc(collection(db, "equipes"), { nome_equipe: nomeEquipeFinal, criado_em: serverTimestamp(), criado_por_uid: profGlobal.id });` |
| `painel_professor.html` | 1248 | `setDoc` | `await setDoc(doc(db, "usuarios", profGlobal.id), { nome: novoNome, asaas_wallet_id: asaasWallet, equipe_id: idEquipeFinal, equipe_origem: nomeEquipeFinal, status_vinculo: trocouEqu` |
| `painel_professor.html` | 1249 | `setDoc` | `await setDoc(doc(db, "professores", profGlobal.id), { usuario_id: profGlobal.id, equipe_id: idEquipeFinal, status_vinculo: trocouEquipe && !isNovaEq ? "pendente" : "ativo", eh_resp` |
| `painel_superadmin.html` | 462 | `updateDoc` | `await updateDoc(doc(db, "alunos", uid), { status_vinculo: status });` |
| `painel_superadmin.html` | 464 | `updateDoc` | `await updateDoc(doc(db, "professores", uid), { status_vinculo: status });` |
| `painel_superadmin.html` | 465 | `updateDoc` | `await updateDoc(doc(db, "usuarios", uid), { status_vinculo: status });` |
| `painel_superadmin.html` | 539 | `updateDoc` | `await updateDoc(doc(db, u.coleção, editUserId), dadosAt);` |
| `painel_superadmin.html` | 549 | `deleteDoc` | `await deleteDoc(doc(db, u.coleção, editUserId));` |
| `painel_superadmin.html` | 638 | `updateDoc` | `await updateDoc(doc(db, "questoes", editQuestaoId), dadosAt);` |
| `painel_superadmin.html` | 645 | `deleteDoc` | `if(status === 'rejeitada') { await deleteDoc(doc(db, "questoes", id)); } else { await updateDoc(doc(db, "questoes", id), { status: status, feedback_admin: feedback }); }` |
| `painel_superadmin.html` | 645 | `updateDoc` | `if(status === 'rejeitada') { await deleteDoc(doc(db, "questoes", id)); } else { await updateDoc(doc(db, "questoes", id), { status: status, feedback_admin: feedback }); }` |
| `painel_superadmin.html` | 649 | `deleteDoc` | `window.deletarQuestaoBanco = async (id) => { if(confirm("Certeza que deseja remover?")) { await deleteDoc(doc(db, "questoes", id)); carregarBancoQuestoes(); } };` |
| `painel_superadmin.html` | 654 | `addDoc` | `await addDoc(collection(db, "questoes"), { pergunta: document.getElementById('nova-q-pergunta').value.trim(), alternativas: { A: document.getElementById('nova-q-optA').value.trim()` |
| `painel_superadmin.html` | 670 | `addDoc` | `await addDoc(collection(db, "questoes"), { pergunta: cols[0].trim(), alternativas: { A: cols[1].trim(), B: cols[2].trim(), C: cols[3]?cols[3].trim():'', D: cols[4]?cols[4].trim():'` |
| `painel_superadmin.html` | 686 | `setDoc` | `await setDoc(doc(db, "config_exames", faixa), { faixa: faixa, questoes_ids: Array.from(questoesSelecionadas), tempo_limite: tempo, aprovacao_minima: corte, atualizado_em: serverTim` |
| `painel_superadmin.html` | 738 | `updateDoc` | `await updateDoc(doc(db, "alunos", id), {` |
| `painel_superadmin.html` | 760 | `updateDoc` | `await updateDoc(ref, { nome: novoNome }, { merge: true });` |

## 5. Leituras Firestore diretas no frontend

| Arquivo | Reads | OperaÃ§Ãµes detectadas |
| --- | ---: | --- |
| `index_2.html` | 1 | `getDocs` |
| `login.html` | 4 | `getDoc`, `getDocs` |
| `painel_admin.html` | 24 | `getDoc`, `getDocs`, `onSnapshot` |
| `painel_aluno.html` | 14 | `getDoc`, `getDocs`, `onSnapshot` |
| `painel_professor.html` | 29 | `getDoc`, `getDocs`, `onSnapshot` |
| `painel_superadmin.html` | 11 | `getDoc`, `getDocs`, `onSnapshot` |
| `sala_aula.html` | 2 | `getDoc`, `getDocs` |
| `validar.html` | 9 | `getDoc`, `getDocs` |

## 6. Collections literais referenciadas no frontend

| Collection / primeiro segmento | Arquivos |
| --- | --- |
| `admins` | `painel_superadmin.html` |
| `alunos` | `login.html`, `painel_admin.html`, `painel_aluno.html`, `painel_professor.html`, `painel_superadmin.html` |
| `certificados` | `painel_admin.html`, `painel_aluno.html`, `painel_professor.html` |
| `config_exames` | `painel_admin.html`, `painel_aluno.html`, `painel_professor.html`, `painel_superadmin.html` |
| `creditos_professor` | `painel_professor.html` |
| `cursos` | `sala_aula.html` |
| `cursos_teoricos` | `index_2.html`, `painel_professor.html` |
| `cursos/${cursoId}/modulos` | `sala_aula.html` |
| `equipes` | `login.html`, `painel_professor.html` |
| `notificacoes` | `painel_aluno.html` |
| `professores` | `login.html`, `painel_admin.html`, `painel_professor.html`, `painel_superadmin.html` |
| `questoes` | `painel_admin.html`, `painel_aluno.html`, `painel_professor.html`, `painel_superadmin.html` |
| `questoes_exames` | `painel_aluno.html`, `painel_professor.html` |
| `resultados` | `painel_admin.html`, `painel_aluno.html`, `painel_professor.html` |
| `super_admins` | `login.html`, `painel_admin.html`, `painel_superadmin.html` |
| `transacoes_creditos` | `painel_professor.html` |
| `usuarios` | `login.html`, `painel_admin.html`, `painel_professor.html`, `painel_superadmin.html` |
| `vendas_cursos` | `painel_admin.html`, `painel_professor.html` |

## 7. ReferÃªncias literais a Functions no frontend

| Callable / endpoint | Arquivos |
| --- | --- |
| `cancelarCobrancaPendenteV12` | `js/course-purchase-api-v1_2.js` |
| `concluirAulaCursoV12` | `js/course-student-api-v1_2.js` |
| `criarSessaoExameFaixaV12` | `js/belt-exam-api-v1_2.js` |
| `emitirMeuCertificadoExameV12` | `js/belt-exam-api-v1_2.js` |
| `finalizarExameOficialV12` | `js/belt-exam-api-v1_2.js` |
| `iniciarCheckoutCursoV12` | `js/course-purchase-api-v1_2.js` |
| `iniciarCheckoutExameFaixaV12` | `js/belt-exam-api-v1_2.js` |
| `iniciarExameOficialV12` | `js/belt-exam-api-v1_2.js` |
| `listarAlunosElegiveisExameFaixaV12` | `js/belt-exam-api-v1_2.js` |
| `listarCatalogoCursosV12` | `js/course-public-api-v1_2.js` |
| `listarComprasCursosAlunoV12` | `js/course-student-api-v1_2.js` |
| `listarMeusCursosV12` | `js/course-student-api-v1_2.js` |
| `listarMeusExamesFaixaV12` | `js/belt-exam-api-v1_2.js` |
| `listarMinhasOrganizacoes` | `js/belt-exam-api-v1_2.js` |
| `listarOperacoesFinanceirasV12` | `js/course-purchase-api-v1_2.js` |
| `listarSessoesExameFaixaV12` | `js/belt-exam-api-v1_2.js` |
| `matricularCursoGratuitoV12` | `js/course-student-api-v1_2.js` |
| `obterAulaConsumoCursoV12` | `js/course-student-api-v1_2.js` |
| `obterCursoPublicoV12` | `js/course-public-api-v1_2.js` |
| `obterEntitlementCursoV12` | `js/course-student-api-v1_2.js` |
| `obterEstruturaConsumoCursoV12` | `js/course-student-api-v1_2.js` |
| `obterProgressoCursoV12` | `js/course-student-api-v1_2.js` |
| `obterSessaoExameFaixaV12` | `js/belt-exam-api-v1_2.js` |
| `obterStatusCompraCursoV12` | `js/course-purchase-api-v1_2.js` |
| `obterTentativaExameOficialV12` | `js/belt-exam-api-v1_2.js` |
| `retomarCheckoutExameFaixaV12` | `js/belt-exam-api-v1_2.js` |
| `selecionarAlunoExameFaixaV12` | `js/belt-exam-api-v1_2.js` |
| `solicitarEstornoIntegralV12` | `js/course-purchase-api-v1_2.js` |

## 8. MÃ³dulos backend com superfÃ­cie de Functions

Este bloco identifica superfÃ­cies existentes potencialmente reutilizÃ¡veis. A presenÃ§a no inventÃ¡rio nÃ£o significa que o contrato jÃ¡ seja adequado ao Painel Operacional ou Console.

| Arquivo | Factories detectadas | SÃ­mbolos callable/request detectados |
| --- | --- | --- |
| `functions/index.js` | â€” | `alterarStatusCursoV12`, `asaasWebhook`, `atualizarCursoV12`, `concluirAulaCurso`, `concluirOnboarding`, `configurarAutorizacaoExame`, `consultarCheckout`, `convidarUsuarioOrganizacao`, `criarCheckoutCreditos`, `criarCheckoutCurso`, `criarCursoV12`, `finalizarExameSeguro`, `gerenciarMeuVinculoOrganizacao`, `iniciarExameSeguro`, `listarCatalogoCursos`, `listarCursosAdministraveisV12`, `listarCursosAluno`, `listarMeusConvitesOrganizacao`, `listarMinhasOrganizacoes`, `matricularCursoGratuito`, `obterPreviaExame`, `resolverPerfilUsuario`, `responderConviteOrganizacao`, `responderVinculoOrganizacao`, `solicitarVinculoOrganizacao` |
| `functions/main.js` | â€” | â€” |
| `functions/src/auth/organization-invitations.js` | `createOrganizationInvitationFunctions` | `convidarUsuarioOrganizacao`, `listarMeusConvitesOrganizacao`, `responderConviteOrganizacao` |
| `functions/src/compatibility/legacy-index.v1_1.js` | â€” | `asaasWebhook`, `concluirAulaCurso`, `concluirOnboarding`, `configurarAutorizacaoExame`, `consultarCheckout`, `criarCheckoutCreditos`, `criarCheckoutCurso`, `finalizarExameSeguro`, `gerenciarMeuVinculoOrganizacao`, `iniciarExameSeguro`, `listarCatalogoCursos`, `listarCursosAluno`, `listarMinhasOrganizacoes`, `matricularCursoGratuito`, `obterPreviaExame`, `resolverPerfilUsuario`, `responderVinculoOrganizacao`, `solicitarVinculoOrganizacao` |
| `functions/src/courses/course-consumption-functions.js` | `createCourseConsumptionFunctions` | `listarPreviewsCursoV12`, `obterAulaConsumoCursoV12`, `obterEstruturaConsumoCursoV12` |
| `functions/src/courses/course-content-functions.js` | `createCourseContentFunctions` | `atualizarAulaCursoV12`, `atualizarModuloCursoV12`, `criarAulaCursoV12`, `criarModuloCursoV12`, `excluirAulaCursoV12`, `excluirModuloCursoV12`, `listarConteudoCursoV12`, `reordenarConteudoCursoV12` |
| `functions/src/courses/course-enrollment-functions.js` | `createCourseEnrollmentFunctions` | `listarMeusCursosV12`, `matricularCursoGratuitoV12`, `obterEntitlementCursoV12` |
| `functions/src/courses/course-functions.js` | `createCourseFunctions` | `alterarStatusCursoV12`, `atualizarCursoV12`, `criarCursoV12`, `listarCursosAdministraveisV12` |
| `functions/src/courses/course-moderation-submission-functions.js` | `createCourseModerationSubmissionFunctions` | `listarExcecoesModeracaoV12`, `registrarDecisaoModeracaoV12`, `solicitarPublicacaoCursoV12` |
| `functions/src/courses/course-progress-functions.js` | `createCourseProgressFunctions` | `concluirAulaCursoV12`, `obterProgressoCursoV12` |
| `functions/src/courses/course-public-functions.js` | `createPublicCourseFunctions` | `listarCatalogoCursosV12`, `obterCursoPublicoV12` |
| `functions/src/exams/exam-attempt-functions.js` | `createExamAttemptFunctions` | `finalizarExameOficialV12`, `iniciarExameOficialV12`, `obterTentativaExameOficialV12` |
| `functions/src/exams/exam-certificate-functions.js` | `createExamCertificateFunctions` | `emitirMeuCertificadoExameV12`, `revogarCertificadoExameV12`, `validarCertificadoExamePublicoV12` |
| `functions/src/exams/exam-read-functions.js` | `createExamReadFunctions` | `listarMeusExamesFaixaV12`, `listarSessoesExameFaixaV12`, `obterSessaoExameFaixaV12` |
| `functions/src/exams/exam-selection-functions.js` | `createExamSelectionFunctions` | `criarSessaoExameFaixaV12`, `selecionarAlunoExameFaixaV12`, `vincularTemplateSessaoExameFaixaV12` |
| `functions/src/exams/exam-ui-support-functions.js` | `createExamUiSupportFunctions` | `listarAlunosElegiveisExameFaixaV12` |
| `functions/src/finance/financial-admin-functions.js` | `createFinancialAdminFunctions` | `atualizarTaxaPadraoFinanceiraV12`, `configurarContaRecebedorFinanceiroV12`, `obterConfiguracaoFinanceiraV12`, `obterRegraFinanceiraCursoV12`, `salvarRegraFinanceiraCursoV12` |
| `functions/src/finance/financial-belt-exam-checkout-functions.js` | `createFinancialBeltExamCheckoutFunctions` | `iniciarCheckoutExameFaixaV12` |
| `functions/src/finance/financial-belt-exam-checkout-resume-functions.js` | `createFinancialBeltExamCheckoutResumeFunctions` | `retomarCheckoutExameFaixaV12` |
| `functions/src/finance/financial-checkout-functions.js` | `createFinancialCheckoutFunctions` | `iniciarCheckoutCursoV12` |
| `functions/src/finance/financial-purchase-read-functions.js` | `createFinancialPurchaseReadFunctions` | `listarComprasCursosAlunoV12`, `listarOperacoesFinanceirasCursosV12`, `listarOperacoesFinanceirasV12`, `obterStatusCompraCursoV12` |
| `functions/src/finance/financial-reversal-admin-functions.js` | `createFinancialReversalAdminFunctions` | `cancelarCobrancaPendenteV12`, `solicitarEstornoIntegralV12` |
| `functions/src/finance/financial-webhook-functions.js` | `createFinancialWebhookFunctions` | `webhookAsaasPagamentosV12` |

## 9. Prioridade de migraÃ§Ã£o

### P0 â€” Remover autoridade privilegiada do browser

Todos os arquivos administrativos classificados como `HIGH` devem ser tratados antes que a nova interface replique ou amplie sua funcionalidade.

- `login.html` â€” 4 mutation(s) direta(s).
- `painel_admin.html` â€” 14 mutation(s) direta(s).
- `painel_superadmin.html` â€” 14 mutation(s) direta(s).

### P1 â€” Substituir leituras administrativas cruas por read models

SuperfÃ­cies administrativas com Firestore direto devem migrar para read models sanitizados, paginados e autorizados no backend.

- `login.html`
- `painel_admin.html`
- `painel_superadmin.html`

### P2 â€” Reutilizar contratos canÃ´nicos existentes

Antes de criar novas Functions, o Gate 8.0C deve confrontar cada necessidade administrativa com os mÃ³dulos backend inventariados acima, evitando duplicaÃ§Ã£o de regras de cursos, financeiro, exames e certificados.

## 10. LimitaÃ§Ãµes desta anÃ¡lise

- Ã‰ uma anÃ¡lise estÃ¡tica baseada em padrÃµes de cÃ³digo.
- Collections montadas dinamicamente podem nÃ£o ser identificadas.
- Callables cujo nome Ã© construÃ­do dinamicamente podem nÃ£o aparecer.
- Um arquivo listado como administrativo pode conter tambÃ©m comportamento legado nÃ£o administrativo.
- A anÃ¡lise nÃ£o executa o frontend nem valida autorizaÃ§Ã£o em runtime.
- O Gate 8.0C deverÃ¡ transformar este inventÃ¡rio em matriz RBAC e contratos formais.

## 11. CritÃ©rio para o prÃ³ximo gate

O Gate 8.0C sÃ³ deve iniciar depois que este inventÃ¡rio estiver versionado e revisado. O prÃ³ximo gate definirÃ¡ capacidades RBAC, read models, commands e boundaries com base nos pontos concretos encontrados aqui.
