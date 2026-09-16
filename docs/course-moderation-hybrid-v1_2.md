# BJJ Exams v1.2 — Moderação híbrida de cursos

## Objetivo

Substituir a revisão manual obrigatória de todos os cursos por um fluxo escalável, auditável e baseado em risco.

O instrutor continua responsável pelo conteúdo que submete. A plataforma executa uma triagem automatizada antes da publicação e envia para revisão humana apenas exceções, incertezas, denúncias e conteúdos de maior risco.

## Princípios

1. **Responsabilidade do instrutor**
   - Antes de solicitar publicação, o instrutor precisa aceitar uma versão identificável do Termo de Responsabilidade de Conteúdo.
   - O aceite deve ser gravado com versão do termo, UID, data/hora e curso.
   - O aceite não transfere para a IA nem para a plataforma a autoria do conteúdo.

2. **Automação como primeira linha**
   - A triagem automatizada avalia conformidade da plataforma, não qualidade técnica de jiu-jitsu.
   - Conteúdo esportivo legítimo de combate não deve ser tratado como violação apenas por descrever técnicas de grappling, competição ou treinamento.

3. **Revisão humana por exceção**
   - O administrador não deve revisar curso por curso.
   - A fila administrativa deve priorizar apenas casos sinalizados, denúncias, falhas de automação, conteúdo suspenso e decisões contestadas.

4. **Fail-safe**
   - Falha do provedor de IA nunca gera publicação automática.
   - Em erro, timeout, resposta inválida ou baixa confiança, o curso permanece fora do catálogo e entra em revisão humana.

5. **Auditoria e explicabilidade**
   - Toda decisão deve gerar registro em `audit_logs` e snapshot de moderação.
   - O registro deve incluir modo, decisão, códigos de motivo, nível de risco, versão da política e versão/modelo do provedor quando aplicável.

## Decisões de moderação

A camada de moderação trabalha com quatro resultados canônicos:

- `approved`: conformidade suficiente para publicação automática.
- `needs_changes`: problema objetivo e corrigível; retorna ao rascunho com feedback.
- `manual_review`: dúvida, risco relevante, denúncia, falha de automação ou baixa confiança; entra na fila humana.
- `blocked`: violação grave que não deve ser publicada automaticamente e requer tratamento administrativo.

## Metadados recomendados no curso

```json
{
  "moderation": {
    "mode": "ai",
    "status": "approved",
    "riskLevel": "low",
    "requiresHumanReview": false,
    "reasonCodes": [],
    "summary": null,
    "policyVersion": "course-content-v1",
    "provider": "openai",
    "model": "configured-at-runtime",
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
  | triagem automatizada
  |
  +-- approved -------> published
  |
  +-- needs_changes --> draft
  |
  +-- manual_review --> review (fila humana)
  |
  +-- blocked --------> review/suspended (fila humana)
```

A transição `review -> published` por automação deve acontecer apenas no backend. O cliente do instrutor nunca recebe permissão direta para autopublicar.

## Escopo inicial da IA

A primeira versão analisa os metadados textuais disponíveis no momento da submissão:

- título;
- descrição;
- informações comerciais básicas do curso;
- futuramente: módulos, aulas, transcrições, imagens e vídeos quando o Marco 4A.5 disponibilizar esse conteúdo.

A IA não deve decidir se uma técnica de jiu-jitsu é tecnicamente correta, eficiente ou adequada para graduação. O escopo é conformidade de plataforma.

## Categorias de atenção

A política pode sinalizar, entre outros:

- conteúdo sexual ou exploração;
- assédio, ódio ou discriminação;
- incentivo a violência fora de contexto esportivo legítimo;
- instruções claramente ilícitas;
- golpes, fraude ou práticas enganosas;
- alegações médicas ou terapêuticas não compatíveis com um curso esportivo;
- spam, links ou chamadas suspeitas;
- tentativa de burlar regras da plataforma;
- conteúdo potencialmente incompatível com direitos autorais quando houver indícios textuais claros;
- qualquer caso ambíguo em que a IA não tenha confiança suficiente.

## Fila administrativa

A atual tela `Moderação de Cursos` deve evoluir para `Revisão de Conteúdo`.

A visão padrão deve mostrar somente exceções:

- `manual_review`;
- `blocked`;
- falha de automação;
- denúncias;
- cursos suspensos;
- decisões contestadas.

Uma visão secundária pode permitir consulta de todos os cursos para auditoria, sem transformar todos em tarefas manuais.

## Override humano

Ações de aprovação, devolução, suspensão ou arquivamento feitas por moderador devem exigir motivo quando alterarem uma decisão automatizada ou quando atuarem em um caso sinalizado.

O override nunca apaga o resultado da IA; cria novo evento de auditoria.

## Provedor de IA

A implementação deve manter um contrato de provedor desacoplado. A primeira integração poderá usar OpenAI, mas os dados persistidos não devem depender do formato proprietário do fornecedor.

O backend deve normalizar a resposta para o contrato canônico de decisão acima.

## Segurança operacional

- Segredo/API key somente no backend e via secret manager.
- Nunca expor credenciais no frontend.
- Timeout e erro do provedor resultam em `manual_review`.
- Produção e staging usam segredos separados.
- Nenhum teste de staging pode acessar produção.
- O conteúdo enviado ao provedor deve ser o mínimo necessário para a análise.

## Critério de conclusão do Marco 4A.4c

O Marco 4A.4c fica concluído quando:

- a fila administrativa for tratada como fila de exceções;
- o contrato de responsabilidade do instrutor estiver definido e testado;
- o contrato canônico de decisão automatizada estiver implementado;
- houver fallback seguro para revisão humana;
- auditoria das decisões estiver preservada;
- nenhuma publicação automática puder ocorrer sem aceite de responsabilidade e decisão automatizada válida;
- staging estiver validado sem acesso à produção.
