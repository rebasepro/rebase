---
sourceHash: 3c34341487182d4a
title: Autenticação
sidebar_label: Autenticação
description: Configure autenticação JWT, provedores OAuth, e-mail SMTP, proteção contra bots e a coleção de usuários no backend do Rebase.
---

A autenticação é dividida em três páginas, pois envolve três tarefas. Esta trata da **configuração**: o que vai no bloco `auth` e no ambiente.

- [Endpoints and tokens](/docs/backend/auth-endpoints/) — as rotas que o backend monta, os formatos de resposta, MFA, o contexto de banco de dados que uma política enxerga, JWKS e chaves de serviço.
- [Custom auth adapters](/docs/backend/auth-adapters/) — substituindo o provedor integrado por Clerk, Firebase Auth ou pelo seu próprio.

## Visão geral

O Rebase inclui um sistema completo de autenticação de backend:

- **Tokens JWT** — Fluxo de access token e refresh token com expiração configurável
- **Provedores OAuth** — Google, LinkedIn, GitHub, Microsoft, Apple e mais
- **E-mail SMTP** — Fluxos de redefinição de senha e verificação de e-mail
- **Hooks de autenticação** — Hooks de ciclo de vida para criação de usuários e mais
- **Adaptadores de autenticação personalizados** — Conecte Firebase Auth, Auth0, Clerk ou qualquer provedor externo
- **Chave de serviço (Service key)** — Chave estática para autenticação server-to-server
- **Auto-bootstrapping** — Fora de produção, o primeiro usuário recebe automaticamente a role admin; uma implantação em produção define seu admin via `REBASE_ADMIN_EMAIL` / `REBASE_ADMIN_PASSWORD`

## Configuração

:::note[Onde isso se aplica]
**Runtime gerenciado:** ambiente — `JWT_SECRET`, `AUTH_*`, `SMTP_*`, `CAPTCHA_*` e os pares `*_CLIENT_ID` / `*_CLIENT_SECRET` dos provedores, um para cada um dos doze provedores ([as variáveis](#as-variáveis-de-ambiente); no caso da Apple são quatro chaves, e não um par). A coleção de usuários é aquela designada pelo bundle (`collections/users` por convenção).
**Sem rota gerenciada:** `auth.hooks`. São funções; faça eject para passá-las.
**Ejetado:** `initializeRebaseBackend({ auth })` em `backend/src/index.ts`.
:::

O bloco `auth` em `initializeRebaseBackend` controla toda a autenticação do backend:

```typescript no-verify
const backend = await initializeRebaseBackend({
    // ...
    auth: {
        collection: usersCollection,         // Your users collection definition
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

### O bloco `auth`, em detalhes

| Chave | Tipo | Padrão | O que faz |
|-----|------|---------|--------------|
| `collection` | `CollectionConfig` | — | A coleção de usuários. Consulte [Configuração de autenticação no nível de coleção](#configuração-de-autenticação-no-nível-de-coleção) |
| `jwtSecret` | `string` | — | Segredo de assinatura HS256. Obrigatório em produção |
| `signingKeys` | `JwtSigningKeyConfig[]` | — | Chaves de assinatura assimétrica — consulte [Asymmetric Tokens and JWKS](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) |
| `activeKid` | `string` | primeira chave | Qual das `signingKeys` gera novos tokens |
| `accessExpiresIn` | `string` | `1h` | Tempo de vida do access token |
| `refreshExpiresIn` | `string` | `30d` | Tempo de vida do refresh token. Deslizante: cada rotação o renova, portanto, este é o tempo que uma sessão sobrevive à **inatividade**. O runtime passa `JWT_REFRESH_EXPIRES_IN`, que também tem como padrão `30d`. Os navegadores limitam o cookie de refresh a 400 dias, portanto um valor maior não traz vantagens no modo de cookie |
| `refreshTokenReuseIntervalSeconds` | `number` | `10` | Por quanto tempo um refresh token que foi rotacionado ainda gera um irmão da sua sessão, para que um cliente que perdeu uma resposta de refresh não seja desconectado |
| `refreshTokenReuse` | `"reject" \| "revoke-session"` | `"reject"` | O que um refresh token apresentado após esse intervalo faz. `"reject"` o recusa (`TOKEN_ALREADY_USED`) e registra em log, e a sessão é mantida: isso não é detecção de reutilização, já que quem atualizou primeiro mantém a sessão. `"revoke-session"` encerra toda a sessão em tal repetição (`SESSION_REVOKED`), como faz o GoTrue, e o proprietário precisa fazer login novamente. `AUTH_REFRESH_TOKEN_REUSE` |
| `requireAuth` | `boolean` | `true` | Exige uma sessão para a API de dados |
| `allowRegistration` | `boolean` | `false` | Abre `POST /api/auth/register`. Fora de produção, o primeiro usuário em uma tabela vazia é aceito de qualquer forma; em produção, o admin é definido com `REBASE_ADMIN_EMAIL` |
| `disableSelfRegistration` | `boolean` | `false` | Kill switch: também fecha a janela de bootstrap do primeiro usuário que `allowRegistration: false` deixa aberta |
| `allowAnonymous` | `boolean` | `false` | Habilita `POST /api/auth/anonymous`. Deliberadamente não condicionado a `allowRegistration` — um aplicativo público predominantemente de leitura pode querer sessões sem contas. Transformar um convidado em uma conta (`POST /api/auth/anonymous/link`) é um registro e também exige `allowRegistration` — e `allowAnonymous` ainda ativado: se desativado, também recusa os convidados já logados, impedindo que qualquer um se torne uma conta (`403 ANONYMOUS_AUTH_DISABLED`) |
| `allowUserLookup` | `boolean` | `false` | Monta `POST /api/auth/find-user` para fluxos de convite por e-mail |
| `captcha` | `CaptchaConfig` | — | Proteção contra bots nas rotas que enviam e-mails — consulte [Proteção contra bots](#proteção-contra-bots) |
| `defaultRole` | `string` | — | Role atribuída a um usuário recém-registrado quando nenhuma for especificada. Não pode ser `admin`, nem uma role declarada que contenha escopo do plano administrativo: a inicialização recusa ambos |
| `serviceKey` | `string` | — | Chave estática para chamadas server-to-server — consulte [Service Key Authentication](/docs/backend/auth-endpoints/#service-key-authentication) |
| `email` | `EmailConfig` | — | SMTP, para redefinição de senha, verificação, convites e magic links |
| `magicLink` | `boolean` | `false` | Habilita login por e-mail sem senha (passwordless). Requer `email` configurado; sem isso, as rotas respondem `503 EMAIL_NOT_CONFIGURED` |
| `emailOtp` | `boolean` | `false` | Habilita códigos de login de seis dígitos por e-mail — consulte [Códigos de uso único](#códigos-de-uso-único-por-e-mail). O mesmo requisito de e-mail se aplica |
| `deviceLogin` | `{ verificationUrl: string }` | — | Permite que um terminal ou outro dispositivo sem navegador faça login por meio de um — consulte [Device sign-in](/docs/backend/device-sign-in/). Requer um banco de dados SQL |
| `magicLinkCreatesUsers` | `boolean` | `false` | Cadastro sem senha: uma solicitação de magic link ou código por e-mail para um endereço sem conta cria uma (sem senha, não verificada até que o link ou código seja usado), enquanto `allowRegistration` estiver ativado. Executa `beforeUserCreate` e atribui a role padrão. Desativado, essas solicitações não criam nada e respondem a um endereço desconhecido da mesma forma que responderiam a um conhecido. `AUTH_MAGIC_LINK_CREATES_USERS` |
| `requireEmailVerification` | `boolean` | `false` | Recusa login por senha até que o endereço seja verificado, e registra como confirmação primeiro — consulte [Verificação de e-mail](/docs/backend/email-verification/). Requer `email`; a inicialização falha sem ele |
| `cookieAuth` | `CookieAuthConfig \| false` | ativado | Entrega o refresh token como um cookie `httpOnly`, `Secure` e `SameSite` em vez de no corpo JSON; `false` o retorna no corpo — veja abaixo |
| `providers` | `OAuthProvider[]` | `[]` | O array OAuth canônico; os campos nomeados de provedor são resolvidos dentro dele |
| `allowedRedirectUris` | `string[]` | — | Restringe quais URIs de redirecionamento as rotas OAuth aceitam |
| `hooks` | `AuthHooks` | — | `beforeUserCreate`, `afterUserCreate`, `afterUserDelete`, … |

#### Refresh tokens em um cookie `httpOnly`

```typescript no-verify
auth: { cookieAuth: { sameSite: "Lax" } }
```

O refresh token é uma credencial de longa duração e, no corpo da resposta, qualquer XSS na página pode lê-lo. O `cookieAuth` o mantém em um cookie que os scripts da página não conseguem acessar: ativado por padrão a menos que configurado o contrário, sempre presente no runtime e, desde a versão 0.30, em `initializeRebaseBackend`. O token de **acesso** (access token) permanece no corpo, para o cabeçalho `Authorization`. Uma requisição com `x-rebase-auth-flow: json` recebe o refresh token no corpo; com `cookieAuth: false`, todas as requisições o recebem dessa forma, e um cliente no navegador precisa de `authFlowMode: "json"`.

Duas configurações são obrigatórias, caso contrário o login falhará completamente: as chamadas do cliente para os endpoints de autenticação precisam de `credentials: "include"`, e o CORS precisa permitir credenciais — o que significa uma lista explícita de origens, nunca `origin: "*"`. `AUTH_COOKIE_SAME_SITE` é a variável de ambiente correspondente a `sameSite`, e `AUTH_COOKIE_SECURE` a `secure`.

O cookie inclui `Secure` a menos que seja desativado, e nada na requisição pode determinar isso: lido a partir do protocolo da requisição, que é `http` atrás de qualquer proxy de terminação TLS, o token seria enviado em texto simples. `AUTH_COOKIE_SECURE=false` é a única saída para uma implantação servida em http simples (um endereço de LAN, um appliance), e gera um aviso na inicialização. `http://localhost` não precisa disso.

| Chave | Padrão | |
|-----|---------|--|
| `cookieName` | `__rb_refresh` | |
| `domain` | domínio atual | |
| `path` | `/` | |
| `sameSite` | `Lax` | `None` é apenas para um frontend genuinamente cross-site |
| `secure` | `true` | Seguro por padrão; `AUTH_COOKIE_SECURE=false` para http simples |

:::caution[Callbacks de coleção não são acionados para usuários de autenticação]
A criação e atualização de usuários por meio do sistema de autenticação — registro, gerenciamento de usuários pelo admin e OAuth — gravam **diretamente** no repositório de usuários e ignoram o pipeline de salvamento da coleção. Um callback de `beforeSave`/`afterSave`/`beforeDelete`/`afterDelete` na coleção de autenticação (usuários) **não** será executado para esses fluxos. Para efeitos colaterais como provisionar uma equipe pessoal no cadastro, use os hooks de ciclo de vida de autenticação (`afterUserCreate`, `beforeUserCreate`, `afterUserDelete`, …), que recebem o registro de usuário totalmente preenchido.

O OAuth executa os mesmos hooks que as outras formas de login: `beforeLogin` (com o endereço do provedor e `"oauth"`), `beforeUserCreate` quando o login cria a conta, `afterUserCreate` e `onAuthenticated`. O `onAuthenticated` também é disparado na renovação de token (`"refresh"`), na redefinição de senha (`"password-reset"`) e no segundo fator (`"mfa"`). O `beforeLogin` não é executado em uma renovação, pois esta não é um login. Para bloquear uma conta que já está logada, desative-a com `PUT /api/admin/users/:uid { disabled: true }`: isso recusa qualquer login e renovação e encerra todas as sessões e tokens associados a ela.

`beforeEmailChange(user, newEmail)` é executado quando um usuário autenticado solicita a troca de sua conta para outro endereço. Uma regra de endereço aplicada no cadastro em `beforeUserCreate` (apenas o domínio da sua empresa, por exemplo) também deve ser aplicada aqui; caso contrário, um membro pode se cadastrar com um endereço permitido e depois migrar para qualquer outro.

Um hook que recusa a operação (`beforeUserCreate`, `beforeLogin`, `beforeUserDelete`, `beforeEmailChange`) lança um erro. O chamador recebe `400 HOOK_REJECTED` com a mensagem do erro, ou com o status retornado pelo erro: um `ApiError` ou qualquer erro com um `status` 4xx.
:::

### Proteção contra bots

O rate limiting limita um único chamador. Mil endereços enviando uma requisição cada nunca atingem uma janela por IP — e `/auth/register`, `/auth/forgot-password` e `/auth/magic-link` enviam e-mails, de modo que o preço de um formulário desprotegido é pago na reputação do seu domínio de envio.

```ts
auth: {
    captcha: {
        enabled: true,
        provider: "turnstile",              // or "hcaptcha"
        secret: process.env.CAPTCHA_SECRET
    }
}
```

Ou pelo ambiente, que é o caso de uma implantação gerenciada:

```bash
CAPTCHA_PROVIDER=turnstile
CAPTCHA_SECRET=...
CAPTCHA_ROUTES=register,forgotPassword,magicLink,emailOtp   # optional; this is the default
```

O cliente envia o token do widget como `captchaToken` no corpo JSON, ou no próprio cabeçalho `cf-turnstile-response` / `h-captcha-response` do widget. Ambos são aceitos; defina `tokenField` para usar uma chave de corpo diferente.

**`login` não é protegido por padrão.** Um desafio a cada login sobrecarrega todos os usuários reais, e credential stuffing é exatamente o que o rate limiter e o bloqueio de conta resolvem. Adicione-o a `routes` caso queira protegê-lo.

`POST /auth/anonymous/link`, onde um convidado recebe um e-mail e uma senha, conta como registro: ele exige o desafio de `register` e executa `beforeUserCreate`, da mesma forma que `/auth/register`. O login de convidado em si (`POST /auth/anonymous`) não exige nenhum desafio.

#### Falha de forma fechada (Fail-closed)

Se o provedor não puder ser alcançado, a verificação falha e a requisição é recusada. De outro modo, um invasor capaz de causar essa indisponibilidade conseguiria desativar a proteção, algo que um desafio de verificação jamais deve permitir.

O custo é que uma indisponibilidade do provedor bloqueia novos cadastros. Isso é visível, imediato e revertido com a remoção de uma única chave de configuração — uma falha preferível a uma falha silenciosa notada apenas quando o domínio de e-mail entrar em uma lista de bloqueio.

#### Uma configuração incorreta impede a inicialização

`enabled: true` sem nenhum provedor, com um provedor desconhecido ou sem segredo configurado impedirá a inicialização. Um desafio silenciosamente ausente quando a configuração diz que ele deveria estar ativo é a falha que este sistema não pode admitir.

O chamador é informado apenas de que o desafio falhou — nunca se o token estava ausente, malformado, já utilizado ou não verificável. O motivo real é registrado no log, pois informar um script indica como ele pode contornar a validação.

### E-mail em desenvolvimento

Sem `SMTP_HOST`, o e-mail de autenticação não tem para onde ir. Em vez de recusar a requisição, o servidor de desenvolvimento captura a mensagem e imprime seus links:

```
⚠️  No SMTP is configured, so auth email is being captured here instead of sent.
ℹ️  [email] Sign in to Acme → you@example.com
             http://localhost:5173/auth/magic-link?token=…
```

Acesse o link e o fluxo será concluído, em qualquer página que atenda a essa rota: o CMS serve `/reset-password`, `/verify-email`, `/confirm-email-change` e o `/auth/magic-link` de um magic link; outro frontend precisará de uma página própria para cada uma (consulte [Magic Links](/docs/sdk/authentication/#magic-links) no SDK). Nada no token muda — ele é gerado, armazenado e validado exatamente como seria a partir de uma caixa de entrada real; apenas a entrega é diferente.

Isso fica ativado sempre que as três condições forem atendidas, e nenhuma configuração altera isso:

- `SMTP_HOST` não está definido — um servidor de e-mail configurado sempre tem precedência;
- `NODE_ENV` não é `production`. Um e-mail capturado de redefinição de senha carrega um token de redefinição funcional, de modo que o buffer de captura se torna um repositório de credenciais e não deve existir em produção;
- `FRONTEND_URL` é uma URL `http(s)` absoluta, caso contrário o link enviado por e-mail não terá base e será inválido na chegada.

Se qualquer uma delas não for atendida, `POST /auth/magic-link` e `POST /auth/forgot-password` responderão com `503 EMAIL_NOT_CONFIGURED` como antes. Em produção, configure `SMTP_HOST` (ou `auth.email.sendEmail`) para enviar e-mails de fato.

#### Lendo os e-mails capturados sem um terminal

O log só é útil para quem está monitorando-o ativamente. Um servidor no Docker, uma segunda janela ou uma linha perdida na rolagem deixam para trás um link que foi impresso e não pode ser encontrado — portanto, a mesma captura é servida via HTTP:

```
GET    /api/admin/dev/emails      → { enabled: true, messages: [ … ] }
DELETE /api/admin/dev/emails      → empties the mailbox
```

Cada mensagem contém `to`, `subject`, `at`, as partes `html` e `text`, e `links` — as URLs absolutas encontradas no corpo, na ordem do documento, que é a parte que realmente interessa.

Ele requer o escopo `users:write`, por meio do mesmo controle de acesso que o cron, logs e backups utilizam, e responde `501 DEV_MAILBOX_UNAVAILABLE` quando não há nada a servir — com o SMTP configurado, os e-mails são entregues em vez de retidos. `NODE_ENV=production` recusa a requisição independentemente de qualquer outra coisa: o conteúdo dessas mensagens é um acesso funcional ao sistema.

### Códigos de uso único por e-mail

Um magic link abre a sessão no dispositivo onde a caixa de entrada está aberta. Esse é o dispositivo correto em um laptop, mas o incorreto em qualquer outro lugar — uma televisão, um terminal, um segundo navegador, um quiosque. Um código supera essa barreira, pois a própria pessoa o transporta.

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

O endereço é enviado novamente junto com o código, e isso não é apenas por conveniência. O que é armazenado é um hash do endereço *e* do código juntos, de modo que uma tentativa de adivinhação é feita contra uma conta específica — e não contra todas as contas da tabela simultaneamente, o que seria o caso em uma busca apenas por código entre um milhão de possibilidades.

Os outros fatores que tornam seis dígitos suficientes:

- **Dez minutos**, e uso único.
- **Cinco tentativas de verificação por endereço por janela**, indexadas pelo endereço e não pelo IP do chamador: o IP pode ser rotacionado pelo invasor, enquanto a conta atacada não. Os contadores residem onde estiver o repositório de rate limit da implantação — por réplica por padrão, compartilhado com `REBASE_RATE_LIMIT_STORE=sql`.
- **Dígitos uniformes**, gerados a partir de `randomInt` em vez de uma operação de módulo sobre bytes aleatórios.
- `POST /auth/otp` responde de forma idêntica para um endereço sem conta cadastrada, de modo que não pode ser usado para descobrir se alguém é cliente.

Ler um código da caixa de entrada comprova a posse do endereço, portanto um login bem-sucedido o marca como verificado — exatamente como o clique em um magic link faz. Em uma conta que ainda não havia sido verificada, essa primeira comprovação também remove o que ninguém havia provado: a senha e todas as identidades vinculadas cujo provedor não verificou o endereço. Consulte [Vinculação de contas](#vinculação-de-contas-entre-métodos-de-login).

### Personalização visual dos e-mails padrão

Os modelos integrados de redefinição de senha, verificação, convite, boas-vindas, magic link e alteração de e-mail renderizam um logotipo acima do cartão. Ele é definido em `email.logoUrl`:

```ts
email: {
    // …
    appName: "Acme",
    logoUrl: "https://acme.example/logo.png"   // 48×48, absolute https URL
}
```

Deve ser um **PNG ou JPG em uma URL `http(s)` absoluta**. Clientes de e-mail não renderizam SVG e bloqueiam URIs `data:`, e a imagem é buscada pelo cliente do destinatário em vez do seu servidor — portanto, um caminho relativo, uma URI de dados ou um arquivo local resultará na ausência do logotipo em vez de uma imagem quebrada. `appName` é usado como texto `alt`, de modo que um cliente com imagens desativadas ainda exibirá o nome.

O fallback é deliberadamente assimétrico. `appName` adota `Rebase` como padrão, mas o logotipo só adota a marca do Rebase enquanto a instalação **não** tiver sido renomeada. Defina `appName` com qualquer outro nome e você não terá logotipo até configurar `logoUrl` — caso contrário, os usuários da Acme receberiam a marca do Rebase em um e-mail assinado pelo domínio da Acme.

Se você substituir um modelo por meio de `email.templates`, nada disso se aplica: sua função gerencia o corpo inteiro. `templates.emailChange(confirmUrl, user, newEmail)` é o link enviado para o novo endereço quando um usuário altera o seu, e `templates.emailChangeNotice(user, newEmail)` é o aviso enviado para o endereço antigo; `user.email` é o endereço atual em ambos.

### Provedores OAuth

Cada provedor OAuth é configurado no mínimo com um `clientId`. Alguns provedores exigem um `clientSecret`:

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

O `gitlab` também aceita um `baseUrl` opcional, para instâncias auto-hospedadas do GitLab.

#### As variáveis de ambiente

Uma implantação gerenciada ou baseada em bundle não tem um bloco `auth` para edição — ela configura o servidor inteiramente por meio do ambiente —, portanto, cada provedor acima possui um par `<PROVIDER>_CLIENT_ID` / `<PROVIDER>_CLIENT_SECRET`, e ambas as partes devem ser definidas para que o provedor seja devidamente configurado:

```bash
DISCORD_CLIENT_ID=…
DISCORD_CLIENT_SECRET=…
```

O endpoint `GET /api/auth/config` listará então `discord` em `enabledProviders`, que é a forma de verificar se o par de credenciais foi reconhecido.

O Google é configurado apenas com `GOOGLE_CLIENT_ID`: seu fluxo de ID-token não precisa de segredo, portanto `GOOGLE_CLIENT_SECRET` é opcional.

A Apple não usa client secret: o Rebase assina um JWT ES256 por troca. Ela requer `APPLE_TEAM_ID`, `APPLE_KEY_ID` e `APPLE_PRIVATE_KEY` (o conteúdo do arquivo `.p8`, incluindo quebras de linha), além de `APPLE_CLIENT_ID` (o Services ID, para a web), `APPLE_BUNDLE_IDS` (IDs separados por vírgula dos seus aplicativos nativos para iOS e macOS) ou ambos. O Services ID é público, de modo que `/auth/config` o publica para o botão **Sign in with Apple** do admin.

Duas opções não possuem variáveis de ambiente correspondentes e requerem o bloco `auth` (ou seja, um backend ejetado ou configurado via código): `microsoft.tenantId`, cujo padrão é `common` e aceita qualquer tenant do Entra (com qualquer tenant, um endereço só é considerado verificado quando o registro do app emite a claim `xms_edov`), e `gitlab.baseUrl`, para uma instância auto-hospedada.

Cada campo nomeado é resolvido na inicialização em `auth.providers`, que é o array canônico e o ponto de extensão para qualquer funcionalidade que os campos nomeados não cubram. As entradas são criadas com as factories `create*Provider`, e os dois formatos se fundem — campos nomeados são anexados após as entradas explícitas:

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

Se deixado indefinido, a única validação em um redirecionamento OAuth é a correspondência de URI registrada no próprio provedor — o que autoriza **todas** as URIs registradas naquele cliente OAuth, incluindo a entrada `localhost` que alguém adicionou para desenvolvimento e o host de staging que ninguém removeu. Listar as origens que este backend realmente atende restringe a apenas essas. As URIs são comparadas por origem mais caminho; query strings, fragmentos e barras finais são ignorados.

### Vinculação de contas entre métodos de login

O que acontece quando alguém se registra com e-mail/senha como `ada@example.com` e, mais tarde, clica em "Sign in with Google" em uma conta Google com esse mesmo endereço? O Rebase **vincula os dois em uma única conta**, mas somente quando o provedor atestar que o e-mail foi verificado. Ele nunca cria silenciosamente uma segunda conta para o mesmo endereço.

Em `POST /api/auth/<provider>`, a ordem de resolução é:

1. **Identidade de provedor conhecida**: se essa identidade de provedor exata já realizou login anteriormente, esse usuário é retornado. O e-mail não é consultado.
2. **Conta existente com o mesmo e-mail, e o provedor verificou o e-mail**: a identidade é vinculada e o usuário é conectado a ela. Uma conta, duas formas de entrada. Uma conta não verificada é verificada primeiro (veja abaixo).
3. **Conta existente com o mesmo e-mail, mas o provedor não o verificou**: rejeitado com `403 EMAIL_NOT_VERIFIED` e `details.reason` definido como `provider-email-unverified`. Nada é criado ou modificado.
4. **Nenhuma conta com esse e-mail**: uma nova conta é criada, já verificada se o provedor tiver verificado o e-mail.

A etapa 3 é o caso crítico para a segurança. Se um e-mail não verificado pelo provedor fosse suficiente para vincular a conta, qualquer pessoa capaz de fazer um provedor emitir um endereço que ela não possui poderia assumir o controle da conta correspondente no Rebase. O Google sempre afirma `email_verified` para contas reais do Google, portanto a etapa 2 é o caminho habitual para o login com o Google; a etapa 3 intercepta principalmente provedores que permitem que os usuários forneçam um endereço arbitrário não confirmado.

O lado da conta também importa. Nada verifica o endereço fornecido em `POST /auth/register`, de modo que qualquer pessoa pode registrar o endereço de outra com uma senha, ou fazer login com ele através de um provedor que não o comprove, e esperar. Vincular o login do Google do legítimo proprietário a essa conta não pode deixar ativa a via de acesso da outra pessoa.

Um provedor que verificou o endereço, um link de verificação, um magic link, um código por e-mail ou uma redefinição de senha: todos comprovam o endereço e verificam a conta. Em uma conta que ainda não havia sido verificada, a primeira comprovação desse tipo remove a senha (uma redefinição define a nova) e todas as identidades vinculadas cujo provedor não verificou o endereço, encerrando todas as sessões antes de marcar a conta como verificada: uma senha que ninguém verificou é eliminada após o primeiro login com o Google.

Um link de verificação mantém o que a pessoa que o acessa também comprova: uma sessão ativa da conta ou sua senha. Consulte [Verificação de e-mail](/docs/backend/email-verification/). Contas criadas por um admin via `POST /api/admin/users` são armazenadas como verificadas, de modo que um convidado pode usar "Sign in with Google" imediatamente. Um repositório de autenticação personalizado sem `unlinkUserIdentity` recusa essa comprovação com `409 UNVERIFIED_IDENTITIES` quando houver uma identidade para remover.

Esse comportamento não é configurável — deliberadamente não existe opção para vincular contas com e-mails não verificados.

### Verificação de e-mail

O registro envia um link de verificação para a nova conta, e acessá-lo mantém apenas o que a pessoa acessando também comprova. `requireEmailVerification` torna o registro baseado em confirmação prévia. Consulte [Verificação de e-mail](/docs/backend/email-verification/).

## Tabelas criadas automaticamente

Na primeira inicialização, o Rebase provisiona automaticamente o schema `rebase` e as seguintes tabelas no banco de dados (vinculadas ao schema definido na sua coleção, por exemplo, `rebase`):

- **`rebase.users`** — Contas de usuários com e-mail, hash de senha, metadados e uma coluna `roles` text[] (as roles são armazenadas como arrays de texto inline para otimizar consultas e evitar joins).
- **`rebase.user_identities`** — As identidades OAuth vinculadas a cada conta, uma linha por identidade de provedor.
- **`rebase.refresh_tokens`** — Sessões de longa duração contendo refresh tokens com hash, user agents e endereços IP. Inclui um índice exclusivo em `token_hash`. Cada login gera um `session_id`, compartilhado por todos os tokens rotacionados a partir dele; não há restrição por dispositivo, portanto dois navegadores atrás do mesmo endereço contam como duas sessões. Cada token de uma sessão também carrega seu nível de garantia (`aal`) e como o login foi feito (`method`, reportado por `providerId`).
- **`rebase.password_reset_tokens`** — Tokens expiráveis de uso único para fluxos de recuperação de senha.
- **`rebase.magic_link_tokens`** — Tokens expiráveis de uso único para login via magic link.
- **`rebase.mfa_factors`** — Métodos de autenticação multifator cadastrados (ex.: segredos TOTP criptografados com AES-256).
- **`rebase.mfa_challenges`** — Logs de verificação que rastreiam tentativas ativas de verificação de MFA.
- **`rebase.recovery_codes`** — Códigos de backup/recuperação multifator com hash.
- **`rebase.app_config`** — Armazenamento chave-valor para configurações do sistema.

Tokens que expiram — links de redefinição, magic links e códigos por e-mail, refresh tokens, desafios MFA — são excluídos uma vez por hora após expirarem. A varredura é executada nos processos que gerenciam os timers (todas as roles, exceto `functions` em uma implantação dividida, a menos que `REBASE_CRON_SCHEDULER=false` os remova da `api`) e em uma instância da frota: cada hora é reivindicada em `rebase.cron_claims` sob o id de tarefa `rebase:auth:expired-tokens`, assim como um slot de cron. Com `cronPersistence: false`, não há tabela de reivindicações, e todas essas instâncias realizam a varredura. Um token expirado é recusado ao ser apresentado, independentemente de a varredura ter sido executada ou não; a varredura serve apenas para evitar o crescimento das tabelas.

## Bootstrap do primeiro usuário

Quando não existem usuários no banco de dados e o servidor **não** está sendo executado com `NODE_ENV=production`, a primeira pessoa a se registrar torna-se automaticamente um administrador. Depois disso, o registro passa a ser controlado pela configuração `allowRegistration`.

Em produção, essa janela fica fechada, pois um host com nome público fica acessível antes que o operador tenha se registrado, e quem chegasse primeiro se tornaria o proprietário. Em vez disso, uma implantação de produção define seu primeiro admin nas variáveis de ambiente — `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD`, criados na inicialização enquanto a tabela ainda estiver vazia — ou atribui a role usando a chave de serviço (service key). Com a janela fechada, uma tabela vazia recusa o registro de bootstrap com `SETUP_REQUIRED` (informando o motivo), uma primeira conta criada por meio de registro aberto torna-se uma conta comum, `GET /api/auth/config` nunca relata `needsSetup`, `POST /api/admin/bootstrap` recusa a solicitação e o log de inicialização emite um aviso quando a tabela está vazia e nenhum admin foi especificado.

Em um ambiente local, isso significa que você sempre pode inicializar um banco de dados novo sem precisar alimentá-lo (seed) manualmente. Para evitar execuções concorrentes e condições de corrida na geração de schema durante o hot reloading (HMR) ou na inicialização, as operações de bootstrap são sincronizadas por meio de um advisory lock do Postgres:
```sql
SELECT pg_advisory_xact_lock(hashtext('rebase_auth_functions_init'));
```

## Configuração de autenticação no nível de coleção

Em vez de depender apenas das regras de autenticação padrão do banco de dados, você pode marcar qualquer coleção Postgres (como `users.ts` ou uma coleção customizada `members.ts`) como a coleção de autenticação. Isso é configurado por meio da propriedade `auth` na própria coleção:

```typescript
import { randomBytes } from "node:crypto";
import { defineCollection } from "@rebasepro/cms-types";

const membersCollection = defineCollection({
  name: "Members",
  slug: "members",
  table: "members",
  auth: {
    enabled: true,
    
    // Customize what happens when an admin creates a user via the REST API
    onCreateUser: async (values, ctx) => {
      const hash = await ctx.hashPassword("welcome123");
      return {
        values: { ...values, passwordHash: hash, emailVerified: true },
        temporaryPassword: "welcome123"
      };
    },

    // Customize what happens when an admin resets a user's password in the admin panel
    onResetPassword: async (userId, ctx) => {
      const tempPassword = randomBytes(12).toString("base64url");
      return {
        temporaryPassword: tempPassword, // saved as the new password, then shown to the admin
        invitationSent: false
      };
    },

    // Inject/override auth-specific actions (e.g. show/hide the reset password button)
    actions: {
      resetPassword: true // Or false to disable, or a custom EntityAction
    },

    // What each role may do beyond its rows, the app's own scopes,
    // and whether accounts may create personal API keys
    roles: {
      support: { name: "Support", scopes: ["users:read", "users:write", "logs:read"] }
    },
    scopes: {
      "project:deploy": { label: "Deploy projects", target: "project" }
    },
    personalKeys: true
  },
  properties: { ... }
});
```

`roles`, `scopes` e `personalKeys` declaram o modelo de acesso: quais escopos do plano administrativo cada role possui, os escopos que o app define para suas próprias operações e se cada conta pode gerar [chaves de API pessoais](/docs/backend/api-keys/#personal-keys). Consulte [Roles e escopos](/docs/backend/roles-and-scopes/).

Um `temporaryPassword` retornado de `onResetPassword` torna-se a senha da conta. O Rebase calcula seu hash com o algoritmo configurado, salva-a, desconecta o usuário de todas as sessões existentes e a exibe para o admin para que possa ser repassada. O hook não armazena a senha e não tem como fazê-lo. Não retorne nenhum `temporaryPassword` caso o hook envie seu próprio link de redefinição por e-mail: a senha permanecerá como está até que o usuário defina uma nova, embora suas sessões ainda sejam encerradas.

Quando hooks personalizados (`onCreateUser`, `onResetPassword`) são chamados, eles recebem uma facade `AuthCollectionContext` contendo:
- `hashPassword(password: string): Promise<string>` — Gera o hash da senha usando o algoritmo configurado (ex.: scrypt).
- `sendEmail?: (options) => Promise<EmailSendResult>` — Envia um e-mail (disponível apenas quando o serviço de e-mail estiver configurado). Resolve com os dados reportados pelo provedor — `messageId`, `accepted`, `rejected` — para que um hook possa armazenar o id e posteriormente encadear uma resposta a ele.
- `emailConfigured: boolean` — Se o serviço de e-mail está configurado.
- `appName: string` — O nome do aplicativo extraído da configuração de e-mail.
- `resetPasswordUrl: string` — A URL base do link de redefinição de senha.

## Próximos passos

- **[Endpoints and tokens](/docs/backend/auth-endpoints/)** — cada rota que esta configuração monta
- **[Roles and scopes](/docs/backend/roles-and-scopes/)** — o que cada role pode fazer e como chaves e tokens a restringem
- **[Custom auth adapters](/docs/backend/auth-adapters/)** — trazendo seu próprio provedor de identidade
- **[Frontend Authentication](/docs/frontend/authentication/)** — interface de login, controller de autenticação, gerenciamento de usuários
- **[Security Rules (RLS)](/docs/collections/security-rules/)** — controle de acesso a nível de linha (row-level security)
- **[Typed SDK Authentication](/docs/sdk/authentication/)** — métodos de autenticação no SDK tipado
