---
sourceHash: 71a134ba2ec7ae97
title: Autenticação
sidebar_label: Autenticação
description: Configure autenticação JWT, provedores OAuth, e-mail SMTP, proteção contra bots e a tabela de usuários no backend Rebase.
---

A autenticação é dividida em três páginas, pois envolve três tarefas. Esta trata da **configuração**: o que vai no bloco `auth` e no ambiente.

- [Endpoints e tokens](/docs/backend/auth-endpoints/) — as rotas que o backend disponibiliza, os formatos de resposta, MFA, o contexto do banco de dados visto por uma política, JWKS e chaves de serviço.
- [Adaptadores de autenticação customizados](/docs/backend/auth-adapters/) — substituindo o provedor integrado por Clerk, Firebase Auth ou pelo seu próprio.

## Visão geral

O Rebase inclui um sistema completo de autenticação de backend:

- **Tokens JWT** — Fluxo de access e refresh token com expiração configurável
- **Provedores OAuth** — Google, LinkedIn, GitHub, Microsoft, Apple e mais
- **E-mail SMTP** — Fluxos de redefinição de senha e verificação de e-mail
- **Hooks de autenticação** — Hooks de ciclo de vida para criação de usuários e mais
- **Adaptadores de autenticação customizados** — Conecte Firebase Auth, Auth0, Clerk ou qualquer provedor externo
- **Chave de serviço** — Chave estática para autenticação server-to-server
- **Auto-bootstrapping** — Fora de produção, o primeiro usuário recebe automaticamente a role de admin; uma implantação de produção define seu admin com `REBASE_ADMIN_EMAIL` / `REBASE_ADMIN_PASSWORD`

## Configuração

<span class="since-badge" data-since="0.31">Desde 0.31</span>

:::note[Onde isso é configurado]
**Runtime gerenciado:** ambiente — `JWT_SECRET`, `AUTH_*`, `SMTP_*`, `CAPTCHA_*` e os pares `*_CLIENT_ID` / `*_CLIENT_SECRET` dos provedores, um para cada um dos doze provedores ([as variáveis](#as-variáveis-de-ambiente-the-environment-spellings); o da Apple usa quatro chaves, não um par). A tabela de usuários é o [`defineAuthTable`](#a-tabela-de-usuários-the-users-table) exportado de `backend/schema/index.ts`.
**Sem rota gerenciada:** `auth.hooks`. São funções; faça eject para passá-las.
**Ejetado:** `initializeRebaseBackend({ auth })` em `backend/src/index.ts`.
:::

O bloco `auth` em `initializeRebaseBackend` controla toda a autenticação do backend:

```typescript no-verify
const backend = await initializeRebaseBackend({
    // ...
    auth: {
        jwtSecret: env.JWT_SECRET,           // Required — signing secret
        accessExpiresIn: "1h",               // Access token lifetime (default: 1h)
        refreshExpiresIn: "30d",             // Refresh token lifetime (default: 30d)
        serviceKey: env.REBASE_SERVICE_KEY,  // Optional — for server-to-server calls
        allowRegistration: true,             // Allow new signups (default: false)

        // OAuth providers
        google: env.GOOGLE_CLIENT_ID
            ? { clientId: env.GOOGLE_CLIENT_ID }
            : undefined,

        // SMTP email (for password reset, email verification)
        email: env.SMTP_HOST
            ? {
                from: env.SMTP_FROM || `${env.APP_NAME} <noreply@example.com>`,
                smtp: {
                    host: env.SMTP_HOST,
                    port: env.SMTP_PORT,              // 587 for TLS, 465 for SSL
                    secure: env.SMTP_SECURE,           // true for port 465
                    auth: env.SMTP_USER
                        ? { user: env.SMTP_USER, pass: env.SMTP_PASS! }
                        : undefined,
                    name: env.SMTP_NAME,               // Optional EHLO/HELO hostname
                    timeoutMs: 30_000,                 // Connect, greeting and silence limit (the default)
                },
                appName: env.APP_NAME,
                logoUrl: env.EMAIL_LOGO_URL,           // Logo shown atop the default templates
                resetPasswordUrl: env.FRONTEND_URL,    // URL for password reset page
            }
            : undefined,

        // Lifecycle hooks
        hooks: {
            afterUserCreate: async (user) => {
                console.log(`New user registered: ${user.email}`);
            }
        }
    }
});
```

### O bloco `auth`, na íntegra

| Chave | Tipo | Padrão | O que faz |
|-----|------|---------|--------------|
| `jwtSecret` | `string` | — | Segredo de assinatura HS256. Obrigatório em produção |
| `signingKeys` | `JwtSigningKeyConfig[]` | — | Chaves de assinatura assimétrica — consulte [Tokens assimétricos e JWKS](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) |
| `activeKid` | `string` | primeira chave | Qual das `signingKeys` emite novos tokens |
| `accessExpiresIn` | `string` | `1h` | Tempo de vida do access token |
| `refreshExpiresIn` | `string` | `30d` | Tempo de vida do refresh token. Deslizante: cada rotação o renova, portanto, esse é o tempo que uma sessão sobrevive à **inatividade**. O runtime passa `JWT_REFRESH_EXPIRES_IN`, cujo padrão também é `30d`. Os navegadores limitam o cookie de refresh a 400 dias, portanto um valor maior não traz benefícios no modo cookie |
| `refreshTokenReuseIntervalSeconds` | `number` | `10` | Por quanto tempo um refresh token que foi rotacionado ainda gera um token irmão para a sua sessão, garantindo que um cliente que perdeu a resposta de atualização não seja desconectado |
| `refreshTokenReuse` | `"reject" \| "revoke-session"` | `"reject"` | O que acontece quando um refresh token é apresentado após essa janela. `"reject"` o recusa (`TOKEN_ALREADY_USED`) e registra no log, mantendo a sessão: isso não é detecção de reutilização, já que quem atualizou primeiro mantém a sessão. `"revoke-session"` encerra toda a sessão em tal repetição (`SESSION_REVOKED`), como o GoTrue faz, e o proprietário precisa fazer login novamente. `AUTH_REFRESH_TOKEN_REUSE` |
| `requireAuth` | `boolean` | `true` | Exige uma sessão para a API de dados |
| `allowRegistration` | `boolean` | `false` | Abre `POST /api/auth/register`. Fora de produção, o primeiro usuário em uma tabela vazia é aceito de qualquer forma; em produção, o admin é definido com `REBASE_ADMIN_EMAIL` |
| `disableSelfRegistration` | `boolean` | `false` | Mecanismo de desativação emergencial (kill switch): também fecha a janela de bootstrap do primeiro usuário que `allowRegistration: false` deixa aberta |
| `allowAnonymous` | `boolean` | `false` | Habilita `POST /api/auth/anonymous`. Deliberadamente não condicionado a `allowRegistration` — uma aplicação pública predominantemente de leitura pode querer sessões sem contas. Transformar um convidado em uma conta (`POST /api/auth/anonymous/link`) é um registro e também requer `allowRegistration` — e `allowAnonymous` ainda ativado: desativado, também recusa os convidados já autenticados, de modo que nenhum possa virar uma conta (`403 ANONYMOUS_AUTH_DISABLED`) |
| `allowUserLookup` | `boolean` | `false` | Monta `POST /api/auth/find-user` para fluxos de convite por e-mail |
| `captcha` | `CaptchaConfig` | — | Proteção contra bots nas rotas que enviam e-mail — consulte [Proteção contra bots](#proteção-contra-bots-bot-protection) |
| `defaultRole` | `string` | — | Role atribuída a um usuário recém-registrado quando nenhuma é especificada. Não pode ser `admin`, nem uma role declarada que possua um escopo de nível admin: a inicialização recusa ambos |
| `serviceKey` | `string` | — | Chave estática para chamadas server-to-server — consulte [Autenticação por Service Key](/docs/backend/auth-endpoints/#service-key-authentication) |
| `email` | `EmailConfig` | — | SMTP, para redefinição de senha, verificação, convites e magic links |
| `magicLink` | `boolean` | `false` | Habilita login por e-mail sem senha (passwordless). Requer `email` configurado; sem isso, as rotas respondem `503 EMAIL_NOT_CONFIGURED` |
| `emailOtp` | `boolean` | `false` | Habilita códigos de login de seis dígitos por e-mail — consulte [Códigos de uso único](#códigos-de-uso-único-por-e-mail-one-time-codes-by-email). Mesmo requisito de e-mail |
| `deviceLogin` | `{ verificationUrl: string }` | — | Permite que um terminal ou outro dispositivo sem navegador faça login por meio de um — consulte [Login por dispositivo](/docs/backend/device-sign-in/). Requer um banco de dados SQL |
| `magicLinkCreatesUsers` | `boolean` | `false` | Cadastro sem senha: uma solicitação de magic link ou código por e-mail para um endereço sem conta cria uma conta (sem senha, não verificada até que o link ou código seja utilizado), enquanto `allowRegistration` estiver ativado. Executa `beforeUserCreate` e atribui a role padrão. Desativado, essas solicitações não criam nada e respondem a um endereço desconhecido da mesma forma que responderiam a um conhecido. `AUTH_MAGIC_LINK_CREATES_USERS` |
| `requireEmailVerification` | `boolean` | `false` | Recusa login por senha até que o endereço seja verificado, e registra exigindo confirmação prévia — consulte [Verificação de e-mail](/docs/backend/email-verification/). Requer `email`; a inicialização falha sem ele |
| `cookieAuth` | `CookieAuthConfig \| false` | ativado | Entrega o refresh token como um cookie `httpOnly`, `Secure` e `SameSite` em vez de no corpo JSON; `false` o retorna no corpo — veja abaixo |
| `providers` | `OAuthProvider[]` | `[]` | O array canônico de OAuth; os campos de provedores nomeados resolvem nele |
| `allowedRedirectUris` | `string[]` | — | Restringe quais URIs de redirecionamento as rotas OAuth aceitam |
| `hooks` | `AuthHooks` | — | `beforeUserCreate`, `afterUserCreate`, `afterUserDelete`, … |

#### Refresh tokens em um cookie `httpOnly`

```typescript no-verify
auth: { cookieAuth: { sameSite: "Lax" } }
```

O refresh token é a credencial de longa duração e, quando enviado no corpo da resposta,
qualquer vulnerabilidade de XSS na página pode lê-lo. O `cookieAuth` o mantém em um cookie
inacessível a scripts da página: ativado a menos que você o desative, sempre no runtime
e, desde a versão 0.30, no `initializeRebaseBackend`.
O token de **acesso** (access token) permanece no corpo, para ser usado no cabeçalho
`Authorization`. Uma requisição com `x-rebase-auth-flow: json` recebe o refresh token no
corpo; com `cookieAuth: false`, todas as requisições o recebem, e um cliente no navegador
precisa de `authFlowMode: "json"`.

Duas configurações precisam acompanhar isso, caso contrário o login falhará em vez de
degradar suavemente: as requisições de fetch do cliente para os endpoints de autenticação
precisam de `credentials: "include"`, e o CORS deve permitir credenciais — o que significa
uma lista explícita de origens, nunca `origin: "*"`.
`AUTH_COOKIE_SAME_SITE` é a variável de ambiente correspondente a `sameSite`, e
`AUTH_COOKIE_SECURE` corresponde a `secure`.

O cookie recebe a diretiva `Secure` a menos que você a desative, e nada sobre a requisição
pode alterar isso: se lido do protocolo da requisição, que é `http` atrás de qualquer proxy
que encerra TLS, ele enviaria o token em texto puro. `AUTH_COOKIE_SECURE=false` é a única
saída para uma implantação servida em http puro (um endereço LAN, um appliance), e gera
um aviso na inicialização. O endereço `http://localhost` não precisa disso.

| Chave | Padrão | |
|-----|---------|--|
| `cookieName` | `__rb_refresh` | |
| `domain` | domínio atual | |
| `path` | `/` | |
| `sameSite` | `Lax` | `None` é apenas para um frontend genuinamente cross-site |
| `secure` | `true` | Seguro por padrão; `AUTH_COOKIE_SECURE=false` para http simples |

:::caution[Hooks de tabela não são acionados para usuários de auth]
A criação e atualização de usuários por meio do sistema de autenticação — registro,
gerenciamento de usuários pelo admin e OAuth — gravam **diretamente** no repositório de
usuários e ignoram o pipeline de salvamento da tabela. Um hook de
`beforeSave`/`afterSave`/`beforeDelete`/`afterDelete` na tabela de usuários **não**
será executado nesses fluxos. Para efeitos colaterais como provisionar um time pessoal
no cadastro, use os hooks de ciclo de vida de autenticação (`afterUserCreate`,
`beforeUserCreate`, `afterUserDelete`, …), que recebem o registro completo do usuário.

O OAuth executa os mesmos hooks que os outros logins: `beforeLogin` (com o endereço
do provedor e `"oauth"`), `beforeUserCreate` quando o login cria a conta, `afterUserCreate`,
e `onAuthenticated`. O `onAuthenticated` também é disparado na renovação de token
(`"refresh"`), na redefinição de senha (`"password-reset"`) e no segundo fator
(`"mfa"`). O `beforeLogin` não é executado em um refresh, pois este não é um login.
Para interromper uma conta que já está conectada, desative-a com
`PUT /api/admin/users/:uid { disabled: true }`: isso recusa cada tentativa de login e
refresh e encerra todas as sessões e tokens associados a ela.

`beforeEmailChange(user, newEmail)` é executado quando um usuário autenticado solicita
a troca de sua conta para outro endereço. Uma regra de endereço aplicada no cadastro
em `beforeUserCreate` (apenas o domínio da sua empresa, por exemplo) deve ser aplicada
aqui também; caso contrário, um membro poderia se cadastrar com um endereço permitido
e depois mudar para qualquer outro.

Um hook que recusa a operação (`beforeUserCreate`, `beforeLogin`, `beforeUserDelete`,
`beforeEmailChange`) lança um erro. O chamador recebe `400 HOOK_REJECTED` com a mensagem
do erro, ou o status que o erro contém: um `ApiError` ou qualquer erro com status 4xx.
:::

### Proteção contra bots {#bot-protection}

O rate limiting limita um único chamador. Mil endereços enviando uma requisição cada
nunca atingirão uma janela por IP — e `/auth/register`, `/auth/forgot-password` e
`/auth/magic-link` enviam e-mails, de modo que o preço de um formulário desprotegido
é pago na reputação do seu domínio de envio.

```ts
auth: {
    captcha: {
        enabled: true,
        provider: "turnstile",              // or "hcaptcha"
        secret: process.env.CAPTCHA_SECRET
    }
}
```

Ou pelo ambiente, que é como uma implantação gerenciada opera:

```bash
CAPTCHA_PROVIDER=turnstile
CAPTCHA_SECRET=...
CAPTCHA_ROUTES=register,forgotPassword,magicLink,emailOtp   # optional; this is the default
```

O cliente envia o token do widget como `captchaToken` no corpo JSON, ou no
próprio cabeçalho `cf-turnstile-response` / `h-captcha-response` do widget. Ambos são
aceitos; defina `tokenField` para usar uma chave diferente no corpo.

**O `login` não é protegido por padrão.** Um desafio a cada login sobrecarrega todos
os usuários legítimos, e o rate limiter e o bloqueio de conta existem justamente
para mitigar ataques de credential stuffing. Adicione-o a `routes` se desejar.

`POST /auth/anonymous/link`, onde um convidado recebe um e-mail e uma senha, conta
como registro: ele exige o desafio de `register` e executa `beforeUserCreate`,
assim como `/auth/register` faz. O login de convidado em si (`POST /auth/anonymous`)
não exige nenhum desafio.

#### Falha segura (fail-closed)

Se o provedor não puder ser alcançado, a verificação falha e a requisição é
recusada. Um invasor capaz de provocar essa indisponibilidade poderia, de outra forma,
desativar a proteção, o que é exatamente o que um desafio não pode permitir.

O custo disso é que uma falha no provedor bloqueia novos cadastros. Isso é ruidoso, visível
e reversível com a remoção de uma única chave de configuração — uma falha muito melhor
do que uma silenciosa, percebida apenas quando o domínio de e-mail entrar em uma blocklist.

#### Uma configuração incorreta impede a inicialização

Configurar `enabled: true` sem provedor, com um provedor desconhecido ou sem segredo
impede a inicialização do servidor. A ausência silenciosa de um desafio enquanto a
configuração diz que ele está presente é uma falha inaceitável.

O chamador é informado apenas de que o desafio falhou — nunca se o token estava
ausente, malformado, já utilizado ou impossível de verificar. O motivo exato é registrado
no log, pois informar um script dá a ele pistas de como contornar a segurança.

### E-mail em desenvolvimento

Sem `SMTP_HOST`, o e-mail de autenticação não tem para onde ir. Em vez de recusar a
requisição, o servidor de desenvolvimento captura a mensagem e exibe seus links no terminal:

```
⚠️  No SMTP is configured, so auth email is being captured here instead of sent.
ℹ️  [email] Sign in to Acme → you@example.com
             http://localhost:5173/auth/magic-link?token=…
```

Siga o link e o fluxo será concluído na página que atende a esse caminho: o
CMS atende a `/reset-password`, `/verify-email`, `/confirm-email-change` e ao
`/auth/magic-link` do magic link; outro frontend precisará de uma página própria para
cada um (consulte [Magic Links](/docs/sdk/authentication/#magic-links) no SDK). Nada no token
muda — ele é emitido, armazenado e validado exatamente como seria a partir de uma
caixa de entrada real; apenas a entrega é diferente.

Isso fica ativo sempre que as três condições forem atendidas, e nenhuma configuração altera isso:

- `SMTP_HOST` não está definido — um servidor de e-mail configurado sempre tem precedência;
- `NODE_ENV` não é `production`. Um e-mail de redefinição de senha capturado contém um
  token de redefinição válido, portanto o buffer de captura é um repositório de credenciais
  e não deve existir em produção;
- `FRONTEND_URL` é uma URL `http(s)` absoluta, caso contrário o link enviado por
  e-mail não terá base e estará quebrado na chegada.

Se alguma delas não for atendida, `POST /auth/magic-link` e
`POST /auth/forgot-password` responderão `503 EMAIL_NOT_CONFIGURED` como antes. Em
produção, configure `SMTP_HOST` (ou `auth.email.sendEmail`) para enviar e-mails de verdade.

#### Lendo os e-mails capturados sem um terminal

O log só é útil para quem o está observando. Um servidor no Docker, uma segunda
janela ou uma linha rolada deixam para trás um link que foi impresso e não pode mais
ser encontrado — por isso, a mesma captura é disponibilizada via HTTP:

```
GET    /api/admin/dev/emails      → { enabled: true, messages: [ … ] }
DELETE /api/admin/dev/emails      → empties the mailbox
```

Cada mensagem traz `to`, `subject`, `at`, as partes `html` e `text`, e
`links` — as URLs absolutas encontradas no corpo, em ordem no documento, que é a
parte que realmente interessa.

Esse endpoint requer o escopo `users:write`, protegido pelo mesmo gate usado por cron,
logs e backups, e responde `501 DEV_MAILBOX_UNAVAILABLE` quando não há nada a servir — com o
SMTP configurado, os e-mails são entregues em vez de retidos. `NODE_ENV=production` recusa
a chamada independentemente de qualquer outra coisa: essas mensagens contêm logins válidos.

### Códigos de uso único por e-mail {#one-time-codes-by-email}

Um magic link abre a sessão no dispositivo que acessa a caixa de entrada. Esse é
o dispositivo correto em um laptop, mas errado em quase todos os outros casos — uma televisão,
um terminal, um segundo navegador, um quiosque. Um código supera essa barreira, pois uma
pessoa o transporta consigo.

```ts
auth: {
    emailOtp: true,   // or AUTH_EMAIL_OTP=true
    email: { /* … */ }
}
```

```ts
await rebase.auth.sendEmailOtp("someone@example.com");
// …the person reads six digits out of their inbox…
const { user } = await rebase.auth.verifyEmailOtp("someone@example.com", "384102");
```

O endereço é enviado novamente junto com o código, e isso não é por conveniência. O que
fica armazenado é um hash do endereço *e* do código juntos, portanto uma tentativa de
adivinhação é contra uma conta nominal específica — não contra todas as contas da tabela
ao mesmo tempo, que é o que uma busca apenas por código faria com um milhão de possibilidades.

Os demais fatores que tornam seis dígitos suficientes:

- **Dez minutos**, e uso único.
- **Cinco tentativas de verificação por endereço por janela**, vinculadas ao endereço
  e não ao IP do chamador: o IP fica sob controle do invasor para rotacionar, mas a conta
  sob ataque não. As contagens ficam armazenadas onde o repositório de rate limit da implantação
  estiver — por réplica por padrão, compartilhado com `REBASE_RATE_LIMIT_STORE=sql`.
- **Dígitos uniformes**, gerados a partir de `randomInt` e não de um módulo de bytes aleatórios.
- `POST /auth/otp` responde de forma idêntica para um endereço sem conta, de modo que não
  pode ser usado para descobrir se alguém é cliente.

A leitura do código na caixa de entrada comprova a posse do endereço, de modo que um login
bem-sucedido o marca como verificado — exatamente como acessar um magic link faz. Em uma conta
que ainda não havia sido verificada, essa primeira comprovação também remove o que ninguém
comprovou: a senha e todas as identidades vinculadas cujo provedor não verificou o endereço.
Consulte [Vinculação de contas](#vinculação-de-contas-entre-métodos-de-login-account-linking-across-sign-in-methods).

### Personalização da marca nos e-mails padrão

Os templates integrados de redefinição de senha, verificação, convite, boas-vindas, magic link
e troca de e-mail exibem um logotipo acima do card. Ele vem de `email.logoUrl`:

```ts
email: {
    // …
    appName: "Acme",
    logoUrl: "https://acme.example/logo.png"   // 48×48, absolute https URL
}
```

Deve ser um arquivo **PNG ou JPG em uma URL `http(s)` absoluta**. Clientes de e-mail
não renderizam SVG e bloqueiam URIs `data:`, e a imagem é buscada pelo cliente do
destinatário em vez do seu servidor — portanto, um caminho relativo, uma URI data ou um
arquivo local resultarão na ausência de logotipo em vez de uma imagem quebrada. `appName` é
usado como texto `alt`, de modo que clientes com imagens desativadas ainda exibam o nome.

O fallback é deliberadamente assimétrico. `appName` tem como fallback `Rebase`, mas o
logotipo só usa a marca Rebase como fallback enquanto a instalação **não** tiver sido
renomeada. Defina `appName` com qualquer outro valor e você não terá logotipo até configurar
`logoUrl` — caso contrário, os usuários da Acme receberiam uma marca Rebase em e-mails
assinados pelo domínio da Acme.

Se você substituir um template por meio de `email.templates`, nada disso se aplica: sua
função assume o controle de todo o corpo do e-mail. `templates.emailChange(confirmUrl, user, newEmail)`
é o link enviado ao novo endereço quando um usuário altera o seu, e
`templates.emailChangeNotice(user, newEmail)` é o aviso enviado ao endereço antigo;
`user.email` representa o endereço atual em ambos.

### Provedores OAuth

Cada provedor OAuth é configurado com, no mínimo, um `clientId`. Alguns provedores exigem um `clientSecret`:

```typescript
auth: {
    google:    { clientId: "..." },
    linkedin:  { clientId: "...", clientSecret: "..." },
    github:    { clientId: "...", clientSecret: "..." },
    microsoft: { clientId: "...", clientSecret: "...", tenantId: "..." },
    apple:     { clientId: "...", bundleIds: ["..."], teamId: "...", keyId: "...", privateKey: "..." },
    facebook:  { clientId: "...", clientSecret: "..." },
    twitter:   { clientId: "...", clientSecret: "..." },
    discord:   { clientId: "...", clientSecret: "..." },
    gitlab:    { clientId: "...", clientSecret: "..." },
    bitbucket: { clientId: "...", clientSecret: "..." },
    slack:     { clientId: "...", clientSecret: "..." },
    spotify:   { clientId: "...", clientSecret: "..." },
}
```

`gitlab` também aceita um `baseUrl` opcional, para uma instância auto-hospedada do GitLab.

#### As variáveis de ambiente {#the-environment-spellings}

Uma implantação gerenciada ou em bundle não tem um bloco `auth` para edição — ela configura
o servidor inteiramente por meio do ambiente —, portanto, cada provedor acima possui um
par `<PROVIDER>_CLIENT_ID` / `<PROVIDER>_CLIENT_SECRET`, e ambas as partes devem ser
definidas para que o provedor seja configurado:

```bash
DISCORD_CLIENT_ID=…
DISCORD_CLIENT_SECRET=…
```

Em seguida, `GET /api/auth/config` lista `discord` em `enabledProviders`, que é como
se verifica se o par foi carregado.

O Google é configurado apenas com `GOOGLE_CLIENT_ID`: seu fluxo de ID token não requer segredo,
portanto `GOOGLE_CLIENT_SECRET` é opcional.

A Apple não possui segredo de cliente: o Rebase assina um JWT ES256 por troca. Ela exige `APPLE_TEAM_ID`,
`APPLE_KEY_ID` e `APPLE_PRIVATE_KEY` (o conteúdo do arquivo `.p8`, incluindo quebras de linha),
além de `APPLE_CLIENT_ID` (o Services ID, para a web), `APPLE_BUNDLE_IDS`
(IDs separados por vírgula dos seus aplicativos nativos iOS e macOS) ou ambos. O Services ID
é público, então `/auth/config` o publica para o botão **Iniciar sessão com a Apple** do admin.

Duas opções não possuem variáveis de ambiente correspondentes e exigem o bloco `auth` (ou seja,
um backend ejetado ou configurado via código): `microsoft.tenantId`, cujo padrão é
`common` e aceita qualquer tenant do Entra (com qualquer tenant, um endereço só conta como verificado quando o registro do aplicativo emite a declaração `xms_edov`), e
`gitlab.baseUrl`, para uma instância auto-hospedada.

Cada campo nomeado é resolvido na inicialização dentro de `auth.providers`, que é o
array canônico e o ponto de extensão para qualquer recurso não coberto pelos campos nomeados.
As entradas são construídas com as factories `create*Provider`, e os dois formatos se
combinam — campos nomeados são anexados após as entradas explícitas:

```typescript no-verify
import { createGoogleProvider, createGitHubProvider } from "@rebasepro/server";

auth: {
    providers: [
        createGoogleProvider({ clientId: "…", clientSecret: "…" }),
        createGitHubProvider({ clientId: "…", clientSecret: "…" })
    ]
}
```

#### Restringindo as URIs de redirecionamento

```typescript no-verify
auth: { allowedRedirectUris: ["https://admin.example.com/"] }
```

Se deixado indefinido, a única verificação em um redirecionamento OAuth será a correspondência
de URI registrada no próprio provedor — o que autoriza **todas** as URIs registradas naquele
cliente OAuth, incluindo a entrada `localhost` adicionada para desenvolvimento e o host de
staging que ninguém removeu. Listar as origens que este backend realmente atende restringe
a operação a elas. As URIs são comparadas com base na origem mais o caminho; query, fragment
e barras finais são ignorados.

### Vinculação de contas entre métodos de login {#account-linking-across-sign-in-methods}

O que acontece quando alguém se registra com e-mail/senha como `ada@example.com`
e mais tarde clica em "Fazer login com o Google" em uma conta Google com esse mesmo
endereço? O Rebase **vincula as duas em uma única conta**, mas apenas se o provedor
declarar o e-mail como verificado. Ele nunca cria silenciosamente uma segunda conta para
o mesmo endereço.

Em `POST /api/auth/<provider>`, a ordem de resolução é:

1. **Identidade de provedor conhecida**: se essa identidade exata do provedor já fez login
   anteriormente, esse usuário é retornado. O e-mail não é consultado.
2. **Conta existente com o mesmo e-mail, e o provedor verificou o e-mail**: a identidade
   é vinculada e o usuário faz login nela. Uma conta, duas formas de acesso. Uma conta
   não verificada é verificada primeiro (veja abaixo).
3. **Conta existente com o mesmo e-mail, mas o provedor não o verificou**: a requisição
   é rejeitada com `403 EMAIL_NOT_VERIFIED` e `details.reason` com valor
   `provider-email-unverified`. Nada é criado ou modificado.
4. **Nenhuma conta com esse e-mail**: uma nova conta é criada, já verificada se o
   provedor tiver verificado o e-mail.

O passo 3 é o cenário crítico para a segurança. Se um e-mail não verificado pelo provedor
bastasse para vincular a conta, qualquer pessoa que conseguisse fazer um provedor emitir um
endereço que não lhe pertence poderia assumir o controle da conta correspondente no Rebase.
O Google sempre declara `email_verified` para contas Google reais, portanto o passo 2 é o caminho
normal para o login com Google; o passo 3 serve principalmente para barrar provedores que permitem
que os usuários forneçam endereços arbitrários não confirmados.

O estado da conta existente também importa. Nada valida o endereço fornecido em
`POST /auth/register`, de modo que qualquer pessoa pode registrar o endereço de outra com uma
senha, ou fazer login com ele através de um provedor que não o comprove, e aguardar. Vincular
o login do Google do legítimo proprietário a essa conta não pode manter o acesso da outra pessoa ativo.

Um provedor que verificou o endereço, um link de verificação, um magic link, um código por
e-mail ou uma redefinição de senha comprovam a titularidade do endereço e verificam a conta. Em
uma conta que ainda não havia sido verificada, a primeira prova dessa natureza remove a senha
(uma redefinição define a nova) e todas as identidades vinculadas cujos provedores não
verificaram o endereço, além de encerrar todas as sessões, antes de marcar a conta como
verificada: uma senha que ninguém comprovou desaparece após o primeiro login com o Google.

Um link de verificação mantém o que a pessoa que o seguiu também comprova: uma sessão ativa
da conta ou a sua senha. Consulte [Verificação de e-mail](/docs/backend/email-verification/). Contas criadas por um
administrador via `POST /api/admin/users` são salvas como verificadas, de modo que um convidado
pode usar "Fazer login com o Google" imediatamente. Um repositório de autenticação customizado
sem `unlinkUserIdentity` recusa essa comprovação com `409 UNVERIFIED_IDENTITIES` quando houver
uma identidade a remover.

Esse comportamento não é configurável — deliberadamente não existe opção para vincular contas
com e-mails não verificados.

### Verificação de e-mail

O cadastro envia um link de verificação para a nova conta, e acessá-lo mantém
apenas o que a pessoa que o seguiu também comprova. `requireEmailVerification` torna o
cadastro condicionado a confirmação prévia. Consulte
[Verificação de e-mail](/docs/backend/email-verification/).

## Tabelas criadas automaticamente

Na primeira inicialização, o Rebase provisiona automaticamente o schema `rebase` e as seguintes tabelas no banco de dados:

- **`rebase.users`** — Contas de usuários com e-mail, hash de senha, metadados e uma coluna `roles` do tipo text[] (as roles são armazenadas como arrays de texto inline para otimizar consultas e evitar joins).
- **`rebase.user_identities`** — As identidades OAuth vinculadas a cada conta, com uma linha por identidade de provedor.
- **`rebase.refresh_tokens`** — Sessões de longa duração contendo hashes dos refresh tokens, user agents e endereços IP. Inclui um índice exclusivo em `token_hash`. Um login equivale a um `session_id`, compartilhado por todos os tokens rotacionados a partir dele; não há restrição por dispositivo, logo dois navegadores sob o mesmo endereço IP representam duas sessões. Cada token de uma sessão também armazena seu nível de garantia (`aal`) e como foi autenticado (`method`, relatado por `providerId`).
- **`rebase.password_reset_tokens`** — Tokens descartáveis com expiração para fluxos de recuperação de senha.
- **`rebase.magic_link_tokens`** — Tokens descartáveis com expiração para login por magic link.
- **`rebase.mfa_factors`** — Métodos de autenticação multifator cadastrados (ex.: segredos TOTP criptografados com AES-256).
- **`rebase.mfa_challenges`** — Registros de verificação monitorando tentativas ativas de verificação de MFA.
- **`rebase.recovery_codes`** — Códigos de backup/recuperação multifator armazenados como hash.
- **`rebase.app_config`** — Repositório chave-valor para configurações do sistema.

Tokens expiráveis — links de redefinição, magic links, códigos de e-mail, refresh tokens
e desafios MFA — são excluídos uma vez por hora após expirarem. Essa limpeza é executada
nos processos responsáveis pelos timers (todas as roles, exceto `functions`, em uma implantação distribuída, a menos que `REBASE_CRON_SCHEDULER=false` os remova da `api`) e
em uma única instância do cluster: cada hora é registrada em `rebase.cron_claims`
sob o id de job `rebase:auth:expired-tokens`, assim como ocorre em um slot de cron. Com
`cronPersistence: false`, não existe tabela de claims e todas as instâncias realizam
a limpeza. Um token expirado é recusado se apresentado, independentemente de a limpeza ter
sido executada ou não; o processo periódico serve apenas para impedir o crescimento indefinido das tabelas.

## Bootstrap do primeiro usuário

Quando não há usuários no banco de dados e o servidor **não** está rodando com `NODE_ENV=production`, a primeira pessoa a se registrar recebe automaticamente o papel de admin. Depois disso, os registros passam a ser controlados pela configuração `allowRegistration`.

Em produção, essa janela permanece fechada, pois um host com endereço público fica acessível antes que seu operador tenha se registrado, e quem chegasse primeiro assumiria o controle. Uma implantação de produção define seu primeiro admin diretamente nas variáveis de ambiente — `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD`, criados na inicialização enquanto a tabela ainda estiver vazia — ou atribui o papel usando a service key. Com a janela fechada, uma tabela vazia recusa o registro de bootstrap com `SETUP_REQUIRED` (e indica isso explicitamente), uma primeira conta criada com o registro aberto é tratada como comum, `GET /api/auth/config` nunca reporta `needsSetup`, `POST /api/admin/bootstrap` recusa a requisição e o log de inicialização avisa quando a tabela está vazia e nenhum admin foi definido.

Em um ambiente local, isso significa que você sempre pode inicializar um banco de dados novo sem precisar alimentá-lo manualmente. Para evitar execuções concorrentes e condições de corrida na geração de schemas durante hot reloading (HMR) ou inicialização, as operações de bootstrap são sincronizadas por meio de um advisory lock do Postgres:
```sql
SELECT pg_advisory_xact_lock(hashtext('rebase_auth_functions_init'));
```

## A tabela de usuários {#the-users-table}

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Os usuários são armazenados na tabela declarada com `defineAuthTable` em
`backend/schema`. Trata-se de uma tabela comum com as colunas que a autenticação exige,
uma política que permite a cada usuário ler seu próprio registro e uma restrição exclusiva
para administradores na coluna `roles`. Seu bloco `auth` declara os papéis, os escopos da aplicação,
chaves de API pessoais e os hooks executados quando um admin cria um usuário ou redefine uma
senha:

```ts
import { defineAuthTable, col } from "@rebasepro/server/schema";

export const users = defineAuthTable("users", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().unique(),
    },
    rls: "admin-only",
    auth: {
        roles: { support: { name: "Support", scopes: ["users:read", "users:write", "logs:read"] } },
        personalKeys: true,
    },
});
```

[A tabela de usuários](/docs/schema/auth-table/) detalha as colunas, as políticas
injetadas, `onCreateUser` e `onResetPassword`; [Roles e escopos](/docs/backend/roles-and-scopes/)
explica o que cada papel e escopo concede.

## Próximos passos

- **[Endpoints e tokens](/docs/backend/auth-endpoints/)** — todas as rotas disponibilizadas por esta configuração
- **[Roles e escopos](/docs/backend/roles-and-scopes/)** — o que cada papel pode fazer e como chaves e tokens os restringem
- **[Adaptadores de autenticação customizados](/docs/backend/auth-adapters/)** — integrando seu próprio provedor de identidade
- **[Autenticação no Frontend](/docs/frontend/authentication/)** — interface de login, controller de auth e gerenciamento de usuários
- **[Segurança a nível de linha (RLS)](/docs/collections/security-rules/)** — controle de acesso a nível de linha
- **[Autenticação no SDK Tipado](/docs/sdk/authentication/)** — métodos de autenticação no SDK tipado
