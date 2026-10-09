# Marco 9 — Gate 9.3A: inventário de CSP em Hosting staging

**Status: STATIC_INVENTORY_READY / NO_ENFORCEMENT / NO_DEPLOY.** Esta entrega não edita `firebase.staging-hosting.json`, não configura `Content-Security-Policy-Report-Only`, não aplica CSP e não acessa sites reais. Os 52 arquivos da allowlist de staging permanecem intocados.

## Objetivo

Preparar a segurança contra injeção de scripts e conteúdo externo antes de qualquer cabeçalho restritivo. O projeto `bjj-exams-staging` tem páginas HTML legadas com JavaScript e CSS inline, Firebase modular e bibliotecas de terceiros. Uma CSP com `script-src 'self'` / `style-src 'self'` **aplicada agora** pode interromper autenticação, cursos, exames, certificado e o console.

## Gate 9.3A — inventário estático dos 52 arquivos

`node scripts/inventory-csp-staging-v1_2.js` lê exclusivamente os arquivos definidos em `scripts/build-staging-hosting-v1_2.js` e devolve somente contagens agregadas e domínios candidatos — **não publica código fonte, trechos inline, URLs completas, query strings, tokens, e-mails, CPF, IDs de aluno ou outros dados pessoais**.

Ele conta `<script>` inline/externos e módulos, `<style>`, atributos `style=`, handlers HTML `on...=`, `<iframe>` e padrões de uso de eval/new Function. Lista páginas com scripts ou estilos inline e extrai **origens candidatas** (esquema + host) de literais HTTP(S) no HTML e JS. Essa extração inclui comentários, exemplos, templates e URLs de terceiros, portanto **não comprova carregamento efetivo, nem garante capturar chamadas construídas dinamicamente**. Não confundir contagens estáticas com um relatório de navegador.

### Referências observadas para investigação, NÃO autorização de rede

| Categoria | Candidatos vistos em arquivos HTML/JS | Verificação pendente |
| --- | --- | --- |
| Firebase Web SDK | `https://www.gstatic.com/firebasejs/` | import de módulos, bootstrap de Auth/Firestore/App Check |
| Framework visual | `https://cdn.tailwindcss.com` | execução de Tailwind CDN e uso de estilos gerados |
| Ícones | `https://unpkg.com` | scripts Phosphor e PDF libs no aluno |
| UI/alertas e PDF | `https://cdn.jsdelivr.net`, `https://cdnjs.cloudflare.com` | SweetAlert, HTML2PDF e outras bibliotecas |
| Fontes | `https://fonts.googleapis.com`, `https://fonts.gstatic.com` | CSS remoto e fontes reais em style/font |
| reCAPTCHA Enterprise | `https://www.google.com`, `https://www.gstatic.com`, `https://recaptcha.google.com` | avaliar uso real apenas após Gate 9.1C2B, sem antecipar domínios |
| Firebase Functions | origem regional gerada a partir do projeto | `connect-src` específico no navegador |

Esses candidatos são ponto de partida, não uma allowlist final de CSP. Também conferir images, QR code externo, links de pagamento Sandbox, `blob:`/`data:` para PDF e certificado, e políticas de frames/redirects.

## Limites de compatibilidade conhecidos

- O HTML legado contém scripts inline, módulo inline, styles e atributos style; aplicar hoje a proibição de `unsafe-inline` interromperia partes do produto até migrar inline JS/CSS ou adotar hashes/nonces testados.
- `unsafe-eval` não deve ser usado como solução definitiva. O Tailwind CDN de desenvolvimento e outras bibliotecas precisam ser avaliados antes de uma CSP final.
- Domínios definidos em `script-src` não são automaticamente autorizados por `connect-src`, `frame-src`, `img-src` ou `font-src`; avaliar diretiva por diretiva.
- App Check com reCAPTCHA Enterprise pode requerer scripts, frames e rede Google. Não inventar domínios definitivos antes de validar o provedor em staging.
- A configuração `firebase.staging-hosting.json` já possui cabeçalhos de cache e **não** possui CSP. `firebase.json` principal continua SEM Hosting; produção `bjj-exams` permanece fora de escopo.
- Política de envio de violações não pode mandar dados de endereço, usuário ou token para serviços externos sem revisão de proteção de dados. Report-only pode gerar relatórios contendo documentURI e outros metadados. Não incluir `report-uri` / `report-to` com endpoint inventado.

## Gate 9.3B — Report-only exclusivo do staging (PENDENTE)

1. Gerar proposta `Content-Security-Policy-Report-Only` somente para páginas HTML de `bjj-exams-staging`, preservando os cabeçalhos Cache-Control e evitando qualquer `Content-Security-Policy` de enforcement.
2. Criar testes de contrato para diretivas e URLs, com foco em `default-src`, `script-src`, `style-src`, `connect-src`, `img-src`, `font-src`, `frame-src`, `object-src`, `base-uri` e `form-action`.
3. Não usar uma política com `unsafe-inline`/`unsafe-eval` de forma permanente sem justificativa. Como há inline scripts, testes de console/browser e refatorações graduais são necessários antes de enforcement.
4. Só coletar relatórios de violação em ambiente autorizado, com sanitização, controle de acesso, retenção e sem dados pessoais. Antes, testar manualmente no DevTools sem endpoint de coleta remoto.
5. Validar Auth, catálogo público, aluno/exame, professor, compra Asaas Sandbox, certificados, painéis e App Check quando disponível. Não realizar deploy real sem autorização específica de staging.
6. Documentar exceções justificadas, hashes/nonces, impacto visual, rollback e versão da política após observar violações reais. Somente depois considerar Gate 9.3C de enforcement seletivo.

## Rastreabilidade

- Firebase Hosting headers: https://firebase.google.com/docs/hosting/full-config#configure_headers
- ReCAPTCHA CSP: https://developers.google.com/recaptcha/docs/faq#im-using-content-security-policy-csp-on-my-website-how-can-i-configure-it-to-work-with-recaptcha
- Firebase App Check Enterprise: https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider

**Gate 9.3A aceito:** 52 arquivos inventariados no CI, contagens e origens sanitizadas, riscos de inline script/style registrados, sem alteração de configuração Hosting e sem enforcement.
