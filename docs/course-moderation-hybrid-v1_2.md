# BJJ Exams v1.2 — Moderação híbrida de cursos

## Objetivo

Substituir a revisão manual obrigatória de todos os cursos por um fluxo escalável, auditável e baseado em risco.

O instrutor continua responsável pelo conteúdo que submete. A plataforma executa uma triagem automatizada antes da publicação e envia para revisão humana apenas exceções, incertezas, denúncias e conteúdos de maior risco.

## Princípios

1. **Responsabilidade do instrutor**
   - Antes de solicitar publicação, o instrutor precisa aceitar uma versão identificável do Termo de Responsabilidade de Conteúdo.
   - O aceite deve ser gravado com versão do termo, UID, data/hora e curso.
   - O aceite não transfere para a automação nem para a plataforma a autoria do conteúdo.

2. **Automação como primeira linha**
   - A triagem automatizada avalia segurança/conformidade de plataforma, não qualidade técnica de jiu-jitsu.
   - Conteúdo esportivo legítimo de combate não deve ser tratado como violação apenas por descrever técnicas de grappling, competição ou treinamento.

3. **Revisão humana por exceção**
   - O administrador não deve revisar curso por curso.
   - A fila administrativa deve priorizar apenas casos sinalizados, denúncias, falhas de automação, conteúdo suspenso e decisões contestadas.

4. **Fail-safe**
   - Falha do provedor nunca gera publicação automática.
   - Em erro, timeout, resposta inválida, sinalização ou baixa confiança, o curso permanece fora do catálogo e entra em revisão humana.

5. **Auditoria e explicabilidade**
   - Toda decisão deve gerar registro em `audit_logs` e snapshot de moderação.
   - O registro deve incluir modo, decisão, códigos de motivo, nível de risco, versão da política, fingerprint da versão submetida e versão/modelo do provedor quando aplicável.

## Decisões de moderação

A camada canônica trabalha com quatro resultados:

- `approved`: conformidade suficiente para publicação automática.
- `needs_changes`: problema objetivo e corrigível; retorna ao rascunho com feedback.
- `manual_review`: dúvida, risco relevante, denúncia, falha de automação, sinalização ou baixa confiança; entra na fila humana.
- `blocked`: violação grave sinalizada pela automação ou confirmada administrativamente; permanece fora do catálogo e exige tratamento humano.

O provedor nunca recebe autoridade direta para publicar. A resposta é normalizada e passa pela política canônica do BJJ Exams antes de qualquer transição de estado.

## Metadados de integridade no curso

A partir do Marco 4A.5c, a versão de conteúdo submetida é vinculada à moderação por hash, versão do snapshot e `contentRevision`.

Exemplo simplificado:

```json
{
  "moderation": {
    "mode": "ai",
    "status": "approved",
    "riskLevel": "low",
    "confidence": 0.95,
    "requiresHumanReview": false,
    "reasonCodes": [],
    "summary": null,
    "policyVersion": "course-content-v1",
    "provider": "google-gemini",
    "model": "gemini-3.6-flash",
    "submissionId": "uuid",
    "contentHash": "sha256",
    "contentHashVersion": "course-publication-v2",
    "contentRevision": 7,
    "moderationScopeVersion": "course-structural-text-v1",
    "checkedAt": "server timestamp",
    "checkedBy": "system:course-moderation"
  },
  "contentResponsibility": {
    "accepted": true,
    "termsVersion": "course-content-responsibility-v1",
    "acceptedBy": "uid",
    "acceptedAt": "server timestamp",
    "submissionId": "uuid",
    "contentHash": "sha256",
    "contentHashVersion": "course-publication-v2",
    "contentRevision": 7,
    "moderationScopeVersion": "course-structural-text-v1"
  }
}
```

## Fluxo

```text
draft
  |
  | instrutor solicita publicação + aceita termo
  | backend captura snapshot canônico de curso + módulos + aulas
  v
review
  |
  | triagem automática do payload estrutural minimizado
  | backend recalcula fingerprint antes da decisão
  |
  +-- approved -------> published
  |
  +-- needs_changes --> draft
  |
  +-- manual_review --> review (fila humana)
  |
  +-- blocked --------> review (fila humana)
  |
  +-- erro/timeout ---> review (fila humana)
  |
  +-- conteúdo mudou -> review (fila humana)
```

A transição `review -> published` por automação acontece apenas no backend. O cliente do instrutor nunca recebe permissão direta para autopublicar.

## Fingerprint de publicação — Marco 4A.5c

O backend usa um snapshot canônico versionado (`course-publication-v2`) para identificar exatamente a versão submetida.

O fingerprint inclui:

- metadados publicáveis do curso;
- módulos, seus títulos, descrições e ordem;
- aulas, módulo de origem, títulos, descrições, ordem, tipo, duração e flag de prévia;
- URLs de vídeo/documento;
- corpo persistido das aulas textuais.

O fingerprint não inclui timestamps nem contadores denormalizados. A ordem de leitura do Firestore não altera o hash porque módulos e aulas são ordenados deterministicamente antes do SHA-256.

A submissão armazena `contentHash`, `contentHashVersion`, `contentRevision` e `moderationScopeVersion`. Antes de concluir a triagem automática, o backend recalcula o fingerprint dentro da transação e falha fechado para revisão humana se a versão tiver mudado.

Quando um moderador tenta publicar uma exceção manualmente, o backend também recalcula o fingerprint. Se o conteúdo atual não corresponder à versão registrada em `moderation`, o override para `published` é recusado e o curso deve voltar a rascunho para nova submissão.

## Escopo atual enviado ao Gemini

O Marco 4A.5c amplia a triagem para textos estruturais, mas continua usando minimização de dados.

O provedor recebe apenas:

- título e descrição do curso;
- título e descrição dos módulos;
- título, descrição e `contentType` das aulas;
- `scopeVersion` do contrato de moderação;
- instruções fixas de política e contexto esportivo do BJJ Exams.

Não são enviados ao Gemini:

- UID, e-mail, academia/equipe ou outros identificadores de conta;
- preço ou dados financeiros;
- `videoUrl` ou `documentUrl`;
- corpo integral das aulas textuais;
- posições internas, timestamps ou contadores.

O fingerprint é deliberadamente mais abrangente que o payload de moderação: ele garante integridade da versão publicada sem ampliar desnecessariamente os dados compartilhados com o provedor.

A automação não decide se uma técnica de jiu-jitsu é tecnicamente correta, eficiente ou adequada para graduação.

## Provedor inicial: Google Gemini

O MVP usa `gemini-3.6-flash` na Gemini Developer API, por meio da Interactions API com saída JSON estruturada.

Características do desenho:

- saída estruturada no mesmo contrato canônico usado pelo backend;
- contexto explícito de jiu-jitsu/grappling para reduzir falsos positivos de linguagem esportiva;
- payload variável limitado ao escopo estrutural descrito acima;
- `store: false` para a interação;
- `approved` de risco baixo/médio e confiança suficiente pode seguir para publicação;
- `needs_changes`, `manual_review` e `blocked` seguem a política canônica de destino;
- resposta ausente/inválida, timeout ou erro do provedor falham fechado para revisão humana.

A confiança retornada pelo modelo é tratada como sinal auxiliar de triagem, não como certeza estatística. Valores abaixo do limiar definido pela política canônica impedem autopublicação.

## Privacidade e operação do provedor

O conteúdo enviado ao provedor deve permanecer limitado ao necessário para a análise. O desenho atual exclui identificadores pessoais, dados financeiros, URLs externas e o corpo integral das aulas textuais do payload Gemini.

Antes de produção em escala, a equipe deve revisar:

- termos e política de tratamento de dados vigentes do provedor;
- plano/nível contratado e condições de uso de dados vigentes;
- volume real de solicitações, limites de taxa e custo;
- necessidade de retenção, consentimento ou comunicação adicional ao instrutor.

A automação também **não substitui** uma política completa de marketplace. Fraude comercial, spam sofisticado, violação de direitos autorais, plágio, qualidade pedagógica, promessas comerciais e autenticidade do instrutor continuam dependentes de Termo de Responsabilidade, regras determinísticas, denúncias e revisão humana quando necessário.

## Fila administrativa

A tela administrativa é `Revisão de Conteúdo` e deve mostrar somente exceções operacionais:

- `manual_review`;
- `blocked`;
- falha de automação;
- denúncias;
- cursos suspensos;
- decisões contestadas.

Uma visão secundária pode permitir consulta de todos os cursos para auditoria, sem transformar todos em tarefas manuais.

## Override humano

Ações de aprovação, devolução, suspensão ou arquivamento feitas por moderador devem exigir motivo quando alterarem uma decisão automatizada ou quando atuarem em um caso sinalizado.

O override nunca apaga o resultado automático; cria novo evento de auditoria. Para publicar, a versão atual do conteúdo também precisa corresponder ao fingerprint da moderação registrada.

## Segurança operacional

- Segredo/API key somente no backend e via Secret Manager.
- Nunca expor credenciais no frontend.
- O secret de staging é `GEMINI_COURSE_MODERATION_API_KEY`; produção deve usar configuração de ambiente separada.
- Timeout e erro do provedor resultam em `manual_review`.
- Produção e staging usam segredos/configurações separados.
- Nenhum teste de staging pode acessar produção.
- O conteúdo enviado ao provedor deve ser o mínimo necessário para a análise.
- O backend permanece desacoplado do formato proprietário do fornecedor por meio do contrato canônico de moderação.

## Critério de conclusão do Marco 4A.4c

O Marco 4A.4c fica concluído quando:

- a fila administrativa for tratada como fila de exceções;
- o contrato de responsabilidade do instrutor estiver definido e testado;
- o contrato canônico de decisão automatizada estiver implementado;
- houver fallback seguro para revisão humana;
- auditoria das decisões estiver preservada;
- nenhuma publicação automática puder ocorrer sem aceite de responsabilidade e decisão automatizada válida;
- staging estiver validado com Gemini sem acesso à produção.

## Critério de conclusão do Marco 4A.5c

O Marco 4A.5c fica concluído quando:

- curso, módulos e aulas compuserem um snapshot canônico e determinístico de publicação;
- o fingerprint persistido incluir versão do hash e `contentRevision`;
- a triagem usar somente o payload estrutural minimizado;
- uma alteração de conteúdo durante a moderação impedir publicação automática;
- um override humano não puder publicar uma versão diferente da triada;
- testes unitários e regressão dos cursos estiverem limpos;
- smoke de staging comprovar o fingerprint estrutural e o bloqueio de override stale;
- cleanup remover integralmente os artefatos temporários de staging;
- nenhuma ação de teste/deploy ocorrer em produção.
