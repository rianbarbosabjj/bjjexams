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
- `blocked`: violação grave confirmada no fluxo administrativo; não deve ser publicada automaticamente.

O provedor gratuito inicial produz, na prática, `approved` ou `manual_review`. `needs_changes` fica reservado às validações determinísticas da própria plataforma e a regras futuras. Nenhum conteúdo é automaticamente classificado como `blocked` apenas pelo endpoint de moderação.

## Metadados recomendados no curso

```json
{
  "moderation": {
    "mode": "ai",
    "status": "approved",
    "riskLevel": "low",
    "confidence": 0.99,
    "requiresHumanReview": false,
    "reasonCodes": [],
    "summary": null,
    "policyVersion": "course-content-v1",
    "provider": "openai-moderation",
    "model": "omni-moderation-latest",
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
  | validações locais + moderação automática
  |
  +-- approved -------> published
  |
  +-- needs_changes --> draft
  |
  +-- manual_review --> review (fila humana)
  |
  +-- erro/timeout ---> review (fila humana)
```

A transição `review -> published` por automação acontece apenas no backend. O cliente do instrutor nunca recebe permissão direta para autopublicar.

## Escopo inicial da automação

A primeira versão envia ao provedor somente o mínimo necessário:

- título;
- descrição;
- uma indicação fixa de que o contexto é um curso esportivo de jiu-jitsu/grappling.

Não são enviados UID, e-mail, academia, preço, dados financeiros ou outros identificadores do professor.

Futuramente, o Marco 4A.5 poderá ampliar a triagem para módulos, aulas, transcrições e imagens quando houver justificativa de produto e tratamento adequado de privacidade.

A automação não decide se uma técnica de jiu-jitsu é tecnicamente correta, eficiente ou adequada para graduação.

## Provedor inicial: OpenAI Moderation

O MVP usa o endpoint `POST /v1/moderations` com `omni-moderation-latest`.

Características do desenho:

- o endpoint de moderação é a camada automática gratuita inicial;
- resultado não sinalizado e com confiança interna suficiente pode seguir para publicação;
- qualquer resultado sinalizado segue para revisão humana;
- categorias de violência não causam bloqueio automático, porque o domínio do BJJ contém linguagem legítima de combate esportivo;
- categorias graves elevam o nível de risco, mas continuam exigindo decisão humana;
- resposta ausente/inválida, timeout ou erro do provedor falham fechado para revisão humana.

A `confidence` persistida é uma métrica conservadora derivada dos `category_scores`: para conteúdo não sinalizado, quanto maior o maior score de categoria, menor a confiança de autopublicação.

## Limites do endpoint gratuito

O endpoint de moderação é especializado em conteúdo potencialmente nocivo. Ele **não substitui** uma política completa de marketplace.

Assuntos como fraude comercial, spam sofisticado, violação de direitos autorais, plágio, qualidade pedagógica, promessas comerciais e autenticidade do instrutor não devem ser inferidos como cobertos pelo endpoint gratuito.

Esses itens serão tratados por uma combinação de:

- Termo de Responsabilidade do instrutor;
- validações determinísticas do BJJ Exams;
- denúncias pós-publicação;
- revisão humana por exceção;
- camada contextual adicional futura, caso os dados reais demonstrem necessidade.

## Fila administrativa

A tela administrativa é `Revisão de Conteúdo` e deve mostrar somente exceções operacionais:

- `manual_review`;
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
- Timeout e erro do provedor resultam em `manual_review`.
- Produção e staging usam segredos separados.
- Nenhum teste de staging pode acessar produção.
- O conteúdo enviado ao provedor deve ser o mínimo necessário para a análise.
- A integração do MVP não usa um modelo GPT pago para a triagem de cursos.

## Critério de conclusão do Marco 4A.4c

O Marco 4A.4c fica concluído quando:

- a fila administrativa for tratada como fila de exceções;
- o contrato de responsabilidade do instrutor estiver definido e testado;
- o contrato canônico de decisão automatizada estiver implementado;
- houver fallback seguro para revisão humana;
- auditoria das decisões estiver preservada;
- nenhuma publicação automática puder ocorrer sem aceite de responsabilidade e decisão automatizada válida;
- staging estiver validado sem acesso à produção.
