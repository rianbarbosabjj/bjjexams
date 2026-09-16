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
   - O registro deve incluir modo, decisão, códigos de motivo, nível de risco, versão da política e versão/modelo do provedor quando aplicável.

## Decisões de moderação

A camada canônica trabalha com quatro resultados:

- `approved`: conformidade suficiente para publicação automática.
- `needs_changes`: problema objetivo e corrigível; retorna ao rascunho com feedback.
- `manual_review`: dúvida, risco relevante, denúncia, falha de automação, sinalização ou baixa confiança; entra na fila humana.
- `blocked`: violação grave sinalizada pela automação ou confirmada administrativamente; permanece fora do catálogo e exige tratamento humano.

O provedor nunca recebe autoridade direta para publicar. A resposta é normalizada e passa pela política canônica do BJJ Exams antes de qualquer transição de estado.

## Metadados recomendados no curso

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
    "checkedAt": "server timestamp",
    "checkedBy": "system"
  },
  "contentResponsibility": {
    "accepted": true,
    "termsVersion": "course-content-responsibility-v1",
    "acceptedBy": "uid",
    "acceptedAt": "server timestamp"
  }
}
```

## Fluxo pretendido

```text
draft
  |
  | instrutor solicita publicação + aceita termo
  v
review
  |
  | validações locais + triagem automática
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
```

A transição `review -> published` por automação acontece apenas no backend. O cliente do instrutor nunca recebe permissão direta para autopublicar.

## Escopo inicial da automação

A primeira versão envia ao provedor somente o mínimo necessário:

- título;
- descrição;
- instruções fixas de política e contexto esportivo do BJJ Exams.

Não são enviados UID, e-mail, academia, preço, dados financeiros ou outros identificadores do professor.

Futuramente, o Marco 4A.5 poderá ampliar a triagem para módulos, aulas, transcrições e imagens quando houver justificativa de produto e tratamento adequado de privacidade.

A automação não decide se uma técnica de jiu-jitsu é tecnicamente correta, eficiente ou adequada para graduação.

## Provedor inicial: Google Gemini

O MVP usa `gemini-3.6-flash` na Gemini Developer API, por meio da Interactions API com saída JSON estruturada.

Características do desenho:

- uso compatível com o Free Tier do Gemini para o volume inicial do projeto;
- saída estruturada no mesmo contrato canônico usado pelo backend;
- contexto explícito de jiu-jitsu/grappling para reduzir falsos positivos de linguagem esportiva;
- somente título e descrição do curso são enviados como dados variáveis;
- `approved` de risco baixo/médio e confiança suficiente pode seguir para publicação;
- `needs_changes`, `manual_review` e `blocked` seguem a política canônica de destino;
- resposta ausente/inválida, timeout ou erro do provedor falham fechado para revisão humana.

A confiança retornada pelo modelo é tratada como sinal auxiliar de triagem, não como certeza estatística. Valores abaixo do limiar definido pela política canônica impedem autopublicação.

## Limites e privacidade do Free Tier

O Free Tier da Gemini Developer API possui limites de taxa próprios e pode não ser adequado para volume de produção elevado.

Além disso, o nível gratuito pode permitir que o conteúdo enviado seja usado pelo Google para melhorar seus produtos. Por isso, o MVP limita deliberadamente o payload a título e descrição do curso e exclui identificadores pessoais, dados financeiros e dados internos de conta.

Antes de produção em escala, a equipe deve revisar:

- termos e política de tratamento de dados vigentes do provedor;
- necessidade de migrar para um nível pago em que o conteúdo não seja usado para melhoria dos produtos;
- volume real de solicitações e limites de taxa;
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

O override nunca apaga o resultado automático; cria novo evento de auditoria.

## Segurança operacional

- Segredo/API key somente no backend e via Secret Manager.
- Nunca expor credenciais no frontend.
- O secret de staging é `GEMINI_COURSE_MODERATION_API_KEY` e produção deverá usar uma versão/ambiente separado.
- Timeout e erro do provedor resultam em `manual_review`.
- Produção e staging usam segredos separados.
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
