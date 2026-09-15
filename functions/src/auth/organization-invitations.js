"use strict";

const {
  onCall,
  HttpsError
} = require("firebase-functions/v2/https");

const {
  FieldValue
} = require("firebase-admin/firestore");

function createOrganizationInvitationFunctions(
  dependencies = {}
) {
  const {
    REGION,
    db,
    auth,
    requireAuth,
    textField,
    getProfessorContext,
    canManageOrganization,
    getOrganization,
    getProfile,
    canonicalRole,
    membershipId,
    membershipRole,
    normalizeMembershipStatus
  } = dependencies;

  if (
    !REGION ||
    !db ||
    !auth
  ) {
    throw new Error(
      "Organization invitations: infraestrutura obrigatoria ausente."
    );
  }

  const requiredFunctions = {
    requireAuth,
    textField,
    getProfessorContext,
    canManageOrganization,
    getOrganization,
    getProfile,
    canonicalRole,
    membershipId,
    membershipRole,
    normalizeMembershipStatus
  };

  for (
    const [
      name,
      fn
    ]
    of Object.entries(
      requiredFunctions
    )
  ) {
    if (
      typeof fn !==
      "function"
    ) {
      throw new Error(
        `Organization invitations: dependencia invalida=${name}`
      );
    }
  }

  const convidarUsuarioOrganizacao = onCall({ region: REGION }, async (request) => {
    const uid = requireAuth(request);

    const organizacaoId =
      textField(
        request.data?.organizacaoId,
        128
      );

    const email =
      textField(
        request.data?.email,
        180
      ).toLowerCase();

    const tipo =
      textField(
        request.data?.tipo,
        20
      ).toLowerCase();

    if (!organizacaoId) {
      throw new HttpsError(
        'invalid-argument',
        'Organização inválida.'
      );
    }

    if (
      !email ||
      !email.includes('@')
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Informe um e-mail válido.'
      );
    }

    if (
      !['aluno', 'professor']
        .includes(tipo)
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Tipo de convite inválido.'
      );
    }

    const ctx =
      await getProfessorContext(uid);

    const manager =
      ctx.memberships.find(
        vinculo =>
          vinculo.organizacao_id ===
            organizacaoId &&
          canManageOrganization(
            vinculo
          )
      );

    if (!manager) {
      throw new HttpsError(
        'permission-denied',
        'Somente gestores da academia podem enviar convites.'
      );
    }

    const organizacao =
      await getOrganization(
        organizacaoId
      );

    if (!organizacao) {
      throw new HttpsError(
        'not-found',
        'Academia não encontrada.'
      );
    }

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

    const organizationStatus =
      String(
        organizacao.status ||
        'ativa'
      )
        .trim()
        .toLowerCase();

    if (
      blockedStatuses.has(
        organizationStatus
      )
    ) {
      throw new HttpsError(
        'failed-precondition',
        'A academia não está disponível para novos vínculos.'
      );
    }

    let targetAuth;

    try {
      targetAuth =
        await auth.getUserByEmail(
          email
        );
    } catch (error) {
      if (
        error?.code ===
        'auth/user-not-found'
      ) {
        throw new HttpsError(
          'not-found',
          'Nenhum usuário cadastrado foi encontrado com este e-mail.'
        );
      }

      throw error;
    }

    const targetUid =
      targetAuth.uid;

    if (targetUid === uid) {
      throw new HttpsError(
        'failed-precondition',
        'Você não pode convidar a si mesmo.'
      );
    }

    const targetProfile =
      await getProfile(
        targetUid
      );

    const targetProfileRole =
      canonicalRole(
        targetProfile
      );

    if (
      targetProfileRole !== tipo
    ) {
      throw new HttpsError(
        'failed-precondition',
        'O tipo do convite não corresponde ao perfil cadastrado do usuário.'
      );
    }

    const expectedRole =
      tipo === 'aluno'
        ? 'student'
        : 'instructor';

    const legacyRole =
      tipo === 'aluno'
        ? 'aluno'
        : 'professor';

    const vinculoRef =
      db.doc(
        `vinculos_organizacao/${membershipId(
          organizacaoId,
          targetUid
        )}`
      );

    const membershipsQuery =
      db.collection(
        'vinculos_organizacao'
      )
        .where(
          'usuario_id',
          '==',
          targetUid
        )
        .limit(100);

    const result =
      await db.runTransaction(
        async tx => {
          const [
            existingSnap,
            allMembershipsSnap
          ] =
            await Promise.all([
              tx.get(
                vinculoRef
              ),

              tx.get(
                membershipsQuery
              )
            ]);

          if (
            existingSnap.exists
          ) {
            const existing =
              existingSnap.data();

            if (
              existing.usuario_id &&
              existing.usuario_id !==
                targetUid
            ) {
              throw new HttpsError(
                'failed-precondition',
                'Vínculo institucional inconsistente.'
              );
            }

            if (
              existing.organizacao_id &&
              existing.organizacao_id !==
                organizacaoId
            ) {
              throw new HttpsError(
                'failed-precondition',
                'Vínculo institucional inconsistente.'
              );
            }

            const existingRole =
              membershipRole(
                existing
              );

            if (
              existingRole !==
              expectedRole
            ) {
              throw new HttpsError(
                'failed-precondition',
                'Já existe um vínculo institucional de outro tipo para este usuário.'
              );
            }

            const existingStatus =
              normalizeMembershipStatus(
                existing.status
              );

            if (
              existingStatus ===
              'active'
            ) {
              return {
                ok: true,
                status: 'active',
                alreadyLinked: true,
                usuarioId: targetUid,
                organizacaoId
              };
            }

            if (
              existingStatus ===
              'pending'
            ) {
              const origem =
                String(
                  existing.origem_vinculo ||
                  existing.source ||
                  ''
                )
                  .trim()
                  .toLowerCase();

              if (
                origem ===
                  'convite' ||
                origem ===
                  'invite'
              ) {
                return {
                  ok: true,
                  status: 'pending',
                  alreadyPending: true,
                  usuarioId: targetUid,
                  organizacaoId
                };
              }

              throw new HttpsError(
                'failed-precondition',
                'O usuário já possui uma solicitação pendente para esta academia. Utilize o fluxo de aprovação.'
              );
            }

            throw new HttpsError(
              'failed-precondition',
              'O vínculo existente não pode ser reaberto automaticamente.'
            );
          }

          if (
            expectedRole ===
            'student'
          ) {
            for (
              const doc
              of allMembershipsSnap.docs
            ) {
              const membership =
                doc.data();

              if (
                membershipRole(
                  membership
                ) !==
                'student'
              ) {
                continue;
              }

              const status =
                normalizeMembershipStatus(
                  membership.status
                );

              if (
                status === 'active' ||
                status === 'pending'
              ) {
                throw new HttpsError(
                  'failed-precondition',
                  'O aluno já possui vínculo ativo ou pendente com outra academia.'
                );
              }
            }
          }

          tx.create(
            vinculoRef,
            {
              usuario_id:
                targetUid,

              organizacao_id:
                organizacaoId,

              papel:
                legacyRole,

              status:
                'pendente',

              principal:
                false,

              pode_aplicar_exames:
                false,

              origem_vinculo:
                'convite',

              convidado_por_uid:
                uid,

              convidado_em:
                FieldValue
                  .serverTimestamp(),

              solicitado_em:
                FieldValue
                  .serverTimestamp(),

              criado_em:
                FieldValue
                  .serverTimestamp(),

              atualizado_em:
                FieldValue
                  .serverTimestamp()
            }
          );

          return {
            ok: true,
            status: 'pending',
            usuarioId:
              targetUid,
            organizacaoId
          };
        }
      );

    return result;
  });


  const listarMeusConvitesOrganizacao = onCall({ region: REGION }, async (request) => {
    const uid =
      requireAuth(
        request
      );

    const snap =
      await db.collection(
        'vinculos_organizacao'
      )
        .where(
          'usuario_id',
          '==',
          uid
        )
        .limit(100)
        .get();

    const memberships =
      snap.docs
        .map(
          doc => ({
            id:
              doc.id,
            ...doc.data()
          })
        )
        .filter(
          membership => {
            const status =
              normalizeMembershipStatus(
                membership.status
              );

            const role =
              membershipRole(
                membership
              );

            const origem =
              String(
                membership.origem_vinculo ||
                membership.source ||
                ''
              )
                .trim()
                .toLowerCase();

            return (
              status ===
                'pending' &&
              (
                role ===
                  'student' ||
                role ===
                  'instructor'
              ) &&
              (
                origem ===
                  'convite' ||
                origem ===
                  'invite'
              )
            );
          }
        );

    const convites = [];

    for (
      const membership
      of memberships
    ) {
      const organizacao =
        await getOrganization(
          membership.organizacao_id
        );

      if (!organizacao) {
        continue;
      }

      convites.push({
        organizacaoId:
          membership.organizacao_id,

        nome:
          textField(
            organizacao.nome_equipe ||
            organizacao.nome ||
            'Academia',
            140
          ),

        role:
          membershipRole(
            membership
          ),

        status:
          'pending'
      });
    }

    return {
      convites
    };
  });


  const responderConviteOrganizacao = onCall({ region: REGION }, async (request) => {
    const uid =
      requireAuth(
        request
      );

    const organizacaoId =
      textField(
        request.data?.organizacaoId,
        128
      );

    const desiredStatus =
      normalizeMembershipStatus(
        request.data?.status
      );

    if (!organizacaoId) {
      throw new HttpsError(
        'invalid-argument',
        'Organização inválida.'
      );
    }

    if (
      ![
        'active',
        'rejected'
      ].includes(
        desiredStatus
      )
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Resposta do convite inválida.'
      );
    }

    const targetProfile =
      await getProfile(
        uid
      );

    const canonicalOrgRef =
      db.doc(
        `organizacoes/${organizacaoId}`
      );

    const legacyOrgRef =
      db.doc(
        `equipes/${organizacaoId}`
      );

    const vinculoRef =
      db.doc(
        `vinculos_organizacao/${membershipId(
          organizacaoId,
          uid
        )}`
      );

    const userRef =
      db.doc(
        `usuarios/${uid}`
      );

    const alunoRef =
      db.doc(
        `alunos/${uid}`
      );

    const professorRef =
      db.doc(
        `professores/${uid}`
      );

    const membershipsQuery =
      db.collection(
        'vinculos_organizacao'
      )
        .where(
          'usuario_id',
          '==',
          uid
        )
        .limit(100);

    const result =
      await db.runTransaction(
        async tx => {
          const [
            vinculoSnap,
            allMembershipsSnap,
            userSnap,
            alunoSnap,
            professorSnap,
            canonicalOrgSnap,
            legacyOrgSnap
          ] =
            await Promise.all([
              tx.get(
                vinculoRef
              ),

              tx.get(
                membershipsQuery
              ),

              tx.get(
                userRef
              ),

              tx.get(
                alunoRef
              ),

              tx.get(
                professorRef
              ),

              tx.get(
                canonicalOrgRef
              ),

              tx.get(
                legacyOrgRef
              )
            ]);

          let organizacao =
            null;

          if (
            desiredStatus ===
            'active'
          ) {
            if (
              !canonicalOrgSnap.exists &&
              !legacyOrgSnap.exists
            ) {
              throw new HttpsError(
                'not-found',
                'Academia não encontrada.'
              );
            }

            organizacao =
              canonicalOrgSnap.exists
                ? canonicalOrgSnap.data()
                : legacyOrgSnap.data();

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

            const organizationStatus =
              String(
                organizacao.status ||
                'ativa'
              )
                .trim()
                .toLowerCase();

            if (
              blockedStatuses.has(
                organizationStatus
              )
            ) {
              throw new HttpsError(
                'failed-precondition',
                'A academia não está disponível para novos vínculos.'
              );
            }
          }

          if (
            !vinculoSnap.exists
          ) {
            throw new HttpsError(
              'not-found',
              'Convite não encontrado.'
            );
          }

          const existing =
            vinculoSnap.data();

          if (
            existing.usuario_id &&
            existing.usuario_id !==
              uid
          ) {
            throw new HttpsError(
              'failed-precondition',
              'Convite inconsistente.'
            );
          }

          if (
            existing.organizacao_id &&
            existing.organizacao_id !==
              organizacaoId
          ) {
            throw new HttpsError(
              'failed-precondition',
              'Convite inconsistente.'
            );
          }

          const role =
            membershipRole(
              existing
            );

          if (
            role !== 'student' &&
            role !== 'instructor'
          ) {
            throw new HttpsError(
              'failed-precondition',
              'Este vínculo não pode ser respondido como convite.'
            );
          }

          const expectedProfileRole =
            role === 'student'
              ? 'aluno'
              : 'professor';

          if (
            canonicalRole(
              targetProfile
            ) !==
            expectedProfileRole
          ) {
            throw new HttpsError(
              'failed-precondition',
              'O convite não corresponde ao perfil atual do usuário.'
            );
          }

          const origem =
            String(
              existing.origem_vinculo ||
              existing.source ||
              ''
            )
              .trim()
              .toLowerCase();

          if (
            origem !== 'convite' &&
            origem !== 'invite'
          ) {
            throw new HttpsError(
              'failed-precondition',
              'Este vínculo não foi criado por convite.'
            );
          }

          const currentStatus =
            normalizeMembershipStatus(
              existing.status
            );

          if (
            currentStatus ===
            desiredStatus
          ) {
            return {
              ok: true,
              status:
                desiredStatus,
              alreadyResolved:
                true,
              organizacaoId
            };
          }

          if (
            currentStatus !==
            'pending'
          ) {
            throw new HttpsError(
              'failed-precondition',
              'Este convite já foi encerrado.'
            );
          }

          if (
            desiredStatus ===
            'rejected'
          ) {
            tx.set(
              vinculoRef,
              {
                status:
                  'rejeitado',

                principal:
                  false,

                respondido_por_uid:
                  uid,

                respondido_em:
                  FieldValue
                    .serverTimestamp(),

                atualizado_em:
                  FieldValue
                    .serverTimestamp()
              },
              {
                merge: true
              }
            );

            return {
              ok: true,
              status:
                'rejected',
              organizacaoId
            };
          }

          if (
            role ===
            'student'
          ) {
            for (
              const doc
              of allMembershipsSnap.docs
            ) {
              if (
                doc.id ===
                vinculoSnap.id
              ) {
                continue;
              }

              const membership =
                doc.data();

              if (
                membershipRole(
                  membership
                ) !==
                'student'
              ) {
                continue;
              }

              const status =
                normalizeMembershipStatus(
                  membership.status
                );

              if (
                status ===
                  'active' ||
                status ===
                  'pending'
              ) {
                throw new HttpsError(
                  'failed-precondition',
                  'Você já possui vínculo ativo ou pendente com outra academia.'
                );
              }
            }
          }

          let principal =
            false;

          if (
            role ===
            'student'
          ) {
            principal =
              true;
          } else {
            const hasOtherPrimaryLikeMembership =
              allMembershipsSnap.docs.some(
                doc => {
                  if (
                    doc.id ===
                    vinculoSnap.id
                  ) {
                    return false;
                  }

                  const membership =
                    doc.data();

                  const otherRole =
                    membershipRole(
                      membership
                    );

                  return (
                    normalizeMembershipStatus(
                      membership.status
                    ) ===
                      'active' &&
                    (
                      otherRole ===
                        'owner' ||
                      otherRole ===
                        'manager' ||
                      otherRole ===
                        'instructor'
                    )
                  );
                }
              );

            principal =
              !hasOtherPrimaryLikeMembership;
          }

          tx.set(
            vinculoRef,
            {
              status:
                'ativo',

              principal,

              respondido_por_uid:
                uid,

              respondido_em:
                FieldValue
                  .serverTimestamp(),

              aceito_em:
                FieldValue
                  .serverTimestamp(),

              atualizado_em:
                FieldValue
                  .serverTimestamp()
            },
            {
              merge: true
            }
          );

          const organizacaoNome =
            textField(
              organizacao?.nome_equipe ||
              organizacao?.nome ||
              'Academia',
              140
            );

          if (
            role ===
            'student'
          ) {
            if (
              userSnap.exists
            ) {
              tx.set(
                userRef,
                {
                  academia_principal_id:
                    organizacaoId,

                  academia_principal_nome:
                    organizacaoNome,

                  academia_pendente_id:
                    null,

                  academia_pendente_nome:
                    null,

                  equipe_id:
                    organizacaoId,

                  equipe_origem:
                    organizacaoNome,

                  status_vinculo:
                    'ativo',

                  atualizado_em:
                    FieldValue
                      .serverTimestamp()
                },
                {
                  merge: true
                }
              );
            }

            tx.set(
              alunoRef,
              {
                usuario_id:
                  uid,

                equipe_id:
                  organizacaoId,

                equipe_origem:
                  organizacaoNome,

                status_vinculo:
                  'ativo'
              },
              {
                merge: true
              }
            );
          }

          if (
            role ===
            'instructor'
          ) {
            if (
              userSnap.exists &&
              (
                principal ||
                !userSnap.data()
                  .academia_principal_id
              )
            ) {
              tx.set(
                userRef,
                {
                  academia_principal_id:
                    organizacaoId,

                  academia_principal_nome:
                    organizacaoNome,

                  equipe_id:
                    organizacaoId,

                  equipe_origem:
                    organizacaoNome,

                  atualizado_em:
                    FieldValue
                      .serverTimestamp()
                },
                {
                  merge: true
                }
              );
            }

            const legacyProfessor =
              professorSnap.exists
                ? professorSnap.data()
                : {};

            const legacyAlreadyActive =
              legacyProfessor
                .status_vinculo ===
                  'ativo' &&
              Boolean(
                legacyProfessor
                  .equipe_id
              );

            if (
              !legacyAlreadyActive
            ) {
              tx.set(
                professorRef,
                {
                  usuario_id:
                    uid,

                  equipe_id:
                    organizacaoId,

                  status_vinculo:
                    'ativo',

                  eh_responsavel:
                    false,

                  pode_aprovar:
                    false
                },
                {
                  merge: true
                }
              );
            }
          }

          return {
            ok: true,
            status:
              'active',
            organizacaoId
          };
        }
      );

    return result;
  });

  return {
    convidarUsuarioOrganizacao,
    listarMeusConvitesOrganizacao,
    responderConviteOrganizacao
  };
}

module.exports = {
  createOrganizationInvitationFunctions
};
