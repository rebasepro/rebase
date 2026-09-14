---
sourceHash: cd5be95034e39df6
title: Autenticação
sidebar_label: Autenticação
description: Configure a autenticação JWT, provedores OAuth, e-mail SMTP, proteção contra bots e a coleção de usuários no backend do Rebase.
---

A autenticação é dividida em três páginas, pois envolve três funções. Esta página trata da **configuração**: o que vai no bloco `auth` e no ambiente.

- [Endpoints e tokens](/docs/backend/auth-endpoints/) — as rotas que o backend disponibiliza, os formatos de resposta, MFA, o contexto de banco de dados que uma política enxerga, JWKS e chaves de serviço.
- [Adaptadores de autenticação personalizados](/docs/backend/auth-adapters/) — substituindo o provedor integrado por Clerk, Firebase Auth ou o seu próprio.

## Visão Geral

O Rebase inclui um sistema completo de autenticação de backend:

- **Tokens JWT** — Fluxo de access e refresh token com expiração configurável
- **Provedores OAuth** — Google, LinkedIn, GitHub, Microsoft, Apple e mais
- **E-mail SMTP** — Fluxos de redefinição de senha e verificação de e-mail
- **Hooks de autenticação** — Hooks de ciclo de vida para criação de usuários e mais
- **Adaptadores de autenticação personalizados** — Conecte Firebase Auth, Auth0, Clerk ou qualquer provedor externo
- **Chave de serviço** — Chave estática para autenticação servidor para servidor (server-to-server)
- **Auto-bootstrapping** — Fora de produção, o primeiro usuário recebe automaticamente a role de admin; uma implantação de produção define seu admin com `REBASE_ADMIN_EMAIL` / `REBASE_ADMIN_PASSWORD`

## Configuração

:::note[Onde isso vai]
**Runtime gerenciado:** ambiente — `JWT_SECRET`, `AUTH_*`, `SMTP_*`, `CAPTCHA_*` e os pares `*_CLIENT_ID` / `*_CLIENT_SECRET` dos provedores, um para cada um dos doze provedores ([as grafias](#as-variáveis-de-ambiente-correspondentes); o da Apple utiliza quatro chaves, não um par). A coleção de usuários é aquela definida no pacote (`collections/users` por convenção).
**Sem rota gerenciada:** `auth.hooks`. Eles são funções; execute o eject para passá-los.
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
| `collection` | `CollectionConfig` | — | A coleção de usuários. Consulte [Configuração de Autenticação no Nível da Coleção](#configuração-de-autenticação-no-nível-da-coleção) |
| `jwtSecret` | `string` | — | Segredo de assinatura HS256. Obrigatório em produção |
| `signingKeys` | `JwtSigningKeyConfig[]` | — | Chaves de assinatura assimétricas — consulte [Tokens Assimétricos e JWKS](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) |
| `activeKid` | `string` | primeira chave | Qual chave de `signingKeys` emite novos tokens |
| `accessExpiresIn` | `string` | `1h` | Tempo de vida do token de acesso |
| `refreshExpiresIn` | `string` | `30d` | Tempo de vida do refresh token. Deslizante: cada rotação o renova. O runtime passa `JWT_REFRESH_EXPIRES_IN`, cujo padrão próprio é `400d` |
| `requireAuth` | `boolean` | `true` | Exigir uma sessão para a API de dados |
| `allowRegistration` | `boolean` | `false` | Libera `POST /api/auth/register`. Fora de produção, o primeiro usuário em uma tabela vazia é admitido de qualquer forma; em produção, o admin é definido com `REBASE_ADMIN_EMAIL` |
| `disableSelfRegistration` | `boolean` | `false` | Kill switch: também fecha a janela de bootstrap do primeiro usuário que `allowRegistration: false` deixa aberta |
| `allowAnonymous` | `boolean` | `false` | Habilita `POST /api/auth/anonymous`. Deliberadamente não restrito por `allowRegistration` — um aplicativo público predominantemente de leitura pode querer sessões sem contas |
| `allowUserLookup` | `boolean` | `false` | Disponibiliza `POST /api/auth/find-user` para fluxos de convite por e-mail |
| `defaultRole` | `string` | — | Role atribuída a um usuário recém-registrado quando nenhuma for especificada |
| `serviceKey` | `string` | — | Chave estática para chamadas servidor para servidor — consulte [Autenticação por Chave de Serviço](/docs/backend/auth-endpoints/#service-key-authentication) |
| `email` | `EmailConfig` | — | SMTP, para redefinição de senha, verificação, convites e magic links |
| `magicLink` | `boolean` | `false` | Habilita login por e-mail sem senha (passwordless). Requer `email` configurado; sem isso, as rotas respondem com `503 EMAIL_NOT_CONFIGURED` |
| `emailOtp` | `boolean` | `false` | Habilita códigos de login de seis dígitos por e-mail — consulte [Códigos de uso único](#códigos-de-uso-único-por-e-mail). Mesma exigência de e-mail |
| `cookieAuth` | `CookieAuthConfig` | — | Entrega o refresh token como um cookie `httpOnly` `Secure` `SameSite` em vez de no corpo JSON — veja abaixo |
| `providers` | `OAuthProvider[]` | `[]` | O array canônico de OAuth; os campos de provedores nomeados são resolvidos nele |
| `allowedRedirectUris` | `string[]` | — | Restringe quais URIs de redirecionamento as rotas OAuth aceitam |
| `hooks` | `AuthHooks` | — | `beforeUserCreate`, `afterUserCreate`, `afterUserDelete`, … |

#### Refresh tokens em um cookie `httpOnly`

```typescript no-verify
auth: { cookieAuth: { sameSite: "Lax" } }
```

O refresh token é a credencial de longa duração e, no modo padrão de corpo
JSON, qualquer XSS na página pode lê-lo. O `cookieAuth` o move para um cookie
que o próprio JavaScript da página não pode tocar. O token de **acesso**
permanece no corpo JSON, pois o cliente precisa colocá-lo em um cabeçalho
`Authorization`.

Duas coisas devem ser seguidas, caso contrário o login falhará em vez de
degradar suavemente: as requisições do cliente para os endpoints de autenticação
precisam de `credentials: "include"`, e o CORS precisa permitir credenciais — o
que significa uma lista explícita de origens, nunca `origin: "*"`.
`AUTH_COOKIE_SAME_SITE` é a variável de ambiente para `sameSite`, e
`AUTH_COOKIE_SECURE` para `secure`.

O cookie recebe `Secure` a menos que você o desative, e nada sobre a requisição
pode alterar isso: a flag costumava ser lida a partir do protocolo da
requisição, que é `http` atrás de qualquer proxy com terminação TLS, fazendo com
que o refresh token trafegasse em texto simples na topologia de produção mais
comum. `AUTH_COOKIE_SECURE=false` é a única saída para uma implantação
genuinamente servida sob http puro — um endereço de rede local, um appliance — e
ela emite um aviso na inicialização. `http://localhost` não precisa disso: os
navegadores o tratam como uma origem confiável e aceitam cookies `Secure` nele.

| Chave | Padrão | |
|-----|---------|--|
| `cookieName` | `__rb_refresh` | |
| `domain` | domínio atual | |
| `path` | `/` | |
| `sameSite` | `Lax` | `None` é apenas para um frontend genuinamente cross-site |
| `secure` | `true` | Seguro por padrão; `AUTH_COOKIE_SECURE=false` para http simples |

:::caution[Callbacks de coleção não são acionados para usuários de autenticação]
A criação e atualização de usuários através do sistema de autenticação —
registro, gerenciamento de usuários pelo admin e OAuth — gravam **diretamente**
no armazenamento de usuários e ignoram o pipeline de salvamento da coleção. Um
callback `beforeSave`/`afterSave`/`beforeDelete`/`afterDelete` na coleção de
autenticação (usuários) **não** será executado para esses fluxos. Para efeitos
colaterais como provisionar uma equipe pessoal no cadastro, utilize os hooks de
ciclo de vida de autenticação (`afterUserCreate`, `beforeUserCreate`,
`afterUserDelete`, …), que recebem o registro de usuário totalmente preenchido.

O OAuth executa menos hooks do que o registro convencional. O login por um
provedor dispara `afterUserCreate` quando cria a conta, e nenhum outro hook de
ciclo de vida: `beforeUserCreate`, `beforeLogin` e `onAuthenticated` não são
executados na rota OAuth, portanto uma validação ou trilha de auditoria vinculada
a eles nunca verá um usuário de OAuth.
:::

### Proteção contra bots

O rate limiting limita um único emissor de requisições. Mil endereços enviando
uma requisição cada nunca atingem uma janela por IP — e `/auth/register`,
`/auth/forgot-password` e `/auth/magic-link` enviam e-mails, de modo que o preço
de um formulário desprotegido é pago com a reputação do seu domínio de envio.

```ts
auth: {
    captcha: {
        enabled: true,
        provider: "turnstile",              // or "hcaptcha"
        secret: process.env.CAPTCHA_SECRET
    }
}
```

Ou através do ambiente, que é a forma utilizada em uma implantação gerenciada:

```bash
CAPTCHA_PROVIDER=turnstile
CAPTCHA_SECRET=...
CAPTCHA_ROUTES=register,forgotPassword,magicLink,emailOtp   # optional; this is the default
```

O cliente envia o token do widget como `captchaToken` no corpo JSON, ou no
próprio cabeçalho `cf-turnstile-response` / `h-captcha-response` do widget. Ambos
são aceitos; defina `tokenField` para usar uma chave de corpo diferente.

**`login` não é protegido por padrão.** Um desafio a cada login penaliza todos os
usuários reais, e credential stuffing é combatido pelo limitador de taxa e pelo
bloqueio de conta. Adicione-o a `routes` se desejar.

#### Falha em modo seguro (fail-closed)

Se o provedor não puder ser alcançado, a verificação falha e a requisição é
recusada. Um invasor capaz de causar essa indisponibilidade poderia, de outra
forma, desligar a proteção, que é a única coisa que um desafio não pode permitir.

O custo é que uma interrupção no provedor bloqueia os cadastros. Isso é ruidoso,
visível e reversível removendo uma única chave de configuração — uma falha
melhor do que uma silenciosa, notada apenas quando o domínio de e-mail entra em
uma lista de bloqueio (blocklist).

#### Uma configuração incorreta impede a inicialização

`enabled: true` sem nenhum provedor, com um provedor desconhecido ou sem segredo
recusará a inicialização. Um desafio silenciosamente ausente enquanto a
configuração diz que ele existe é a única falha inadmissível neste caso.

O solicitante é informado apenas de que o desafio falhou — nunca se o token
estava ausente, malformado, já utilizado ou se era inverificável. O motivo exato
vai para o log, pois informar isso a um script é mostrar como se aproximar do
sucesso.

### E-mail em desenvolvimento

Sem `SMTP_HOST`, o e-mail de autenticação não tem para onde ir. Em vez de recusar
a requisição, um servidor de desenvolvimento captura a mensagem e exibe seus
links no console:

```
⚠️  No SMTP is configured, so auth email is being captured here instead of sent.
ℹ️  [email] Sign in to Acme → you@example.com
             http://localhost:5173/auth/magic-link?token=…
```

Acesse o link e o fluxo será concluído. Nada sobre o token muda — ele é
gerado, armazenado e validado exatamente como seria a partir de uma caixa de
entrada real; apenas a entrega é diferente.

Isso fica ativo sempre que as três condições forem atendidas, e nenhuma
configuração altera isso:

- `SMTP_HOST` não está definido — um servidor de e-mail configurado sempre tem
  precedência;
- `NODE_ENV` não é `production`. Um e-mail de redefinição de senha capturado
  contém um token de redefinição funcional, portanto o buffer de captura é um
  armazenamento de credenciais e não deve existir em produção;
- `FRONTEND_URL` é uma URL `http(s)` absoluta, pois caso contrário o link
  enviado por e-mail não terá uma base e estará quebrado na chegada.

Se qualquer uma delas não for atendida, `POST /auth/magic-link` e
`POST /auth/forgot-password` responderão com `503 EMAIL_NOT_CONFIGURED` como
antes. Em produção, defina `SMTP_HOST` (ou `auth.email.sendEmail`) para enviar
e-mails de fato.

#### Lendo o e-mail capturado sem um terminal

O log só é útil para quem o está observando. Um servidor no Docker, uma segunda
janela ou uma linha rolada para longe deixam um link que foi exibido e não pode
ser encontrado — por isso, a mesma captura é disponibilizada via HTTP:

```
GET    /api/admin/dev/emails      → { enabled: true, messages: [ … ] }
DELETE /api/admin/dev/emails      → empties the mailbox
```

Cada mensagem traz `to`, `subject`, `at`, as partes em `html` e `text`, e
`links` — as URLs absolutas encontradas no corpo, na ordem do documento, que é o
que realmente interessa.

O acesso é restrito a administradores, através do mesmo controle usado por cron,
logs e backups, e responde com `501 DEV_MAILBOX_UNAVAILABLE` quando não há nada a
exibir — com o SMTP configurado, o e-mail é entregue em vez de retido.
`NODE_ENV=production` recusa o acesso independentemente de qualquer outra coisa: o
que essas mensagens contêm é um login funcional.

### Códigos de uso único por e-mail

Um magic link abre a sessão no dispositivo que detém a caixa de entrada. Esse é
o dispositivo correto em um laptop e o errado em qualquer outro lugar — uma
televisão, um terminal, um segundo navegador, um quiosque. Um código transpõe
essa lacuna, porque a própria pessoa o carrega consigo.

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

O endereço é enviado novamente com o código, e isso não é por mera conveniência.
O que é armazenado é um hash do endereço *juntamente* com o código, de forma que
uma tentativa de adivinhação é feita contra uma conta específica — não contra
todas as contas da tabela de uma vez, o que transformaria um milhão de
possibilidades em uma busca baseada apenas no código.

O restante do que torna seis dígitos suficientes:

- **Dez minutos** e uso único.
- **Cinco tentativas de verificação por endereço por janela**, baseadas no
  endereço e não no IP do solicitante: o IP pode ser alternado pelo invasor, mas
  a conta sob ataque não. As contagens residem onde quer que esteja o
  armazenamento de limite de taxa da implantação — por réplica por padrão,
  compartilhado com `REBASE_RATE_LIMIT_STORE=sql`.
- **Dígitos uniformes**, provenientes de `randomInt` em vez do módulo de bytes
  aleatórios.
- `POST /auth/otp` responde de forma idêntica para um endereço sem conta, de modo
  que não pode ser usado para descobrir se alguém é cliente.

Ler um código da caixa de entrada comprova a titularidade do endereço, portanto um
login bem-sucedido o marca como verificado — exatamente como ocorre ao clicar em
um magic link.

### Personalizando a marca dos e-mails padrão

Os templates integrados de redefinição de senha, verificação, convite,
boas-vindas e magic link renderizam um logotipo acima do card. Ele é obtido de
`email.logoUrl`:

```ts
email: {
    // …
    appName: "Acme",
    logoUrl: "https://acme.example/logo.png"   // 48×48, absolute https URL
}
```

Deve ser um **PNG ou JPG em uma URL `http(s)` absoluta**. Clientes de e-mail não
renderizam SVG e bloqueiam URIs `data:`, e a imagem é buscada pelo cliente do
destinatário e não pelo seu servidor — portanto, um caminho relativo, uma URI data
ou um arquivo local não renderizarão nenhum logotipo em vez de uma imagem quebrada.
`appName` é usado como texto `alt`, para que um cliente com imagens desativadas
ainda mostre o nome.

O fallback é deliberadamente assimétrico. `appName` tem como fallback `Rebase`,
mas o logotipo só usa a marca do Rebase como fallback enquanto a instalação
**não** tiver alterado o próprio nome. Defina `appName` para qualquer outro valor
e você não terá logotipo até configurar `logoUrl` — caso contrário, os usuários
da Acme receberiam a marca do Rebase em e-mails assinados pelo domínio da Acme.

Se você substituir um template através de `email.templates`, nada disso se
aplica: sua função controla todo o corpo do e-mail.

### Provedores OAuth

Cada provedor OAuth é configurado no mínimo com um `clientId`. Alguns provedores exigem um `clientSecret`:

```typescript
auth: {
    google:    { clientId: "..." },
    linkedin:  { clientId: "...", clientSecret: "..." },
    github:    { clientId: "...", clientSecret: "..." },
    microsoft: { clientId: "...", clientSecret: "...", tenantId: "..." },
    apple:     { clientId: "...", teamId: "...", keyId: "...", privateKey: "..." },
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

#### As variáveis de ambiente correspondentes

Uma implantação gerenciada ou em pacote não possui um bloco `auth` para edição —
ela configura o servidor inteiramente através do ambiente — portanto, cada
provedor acima possui um par `<PROVIDER>_CLIENT_ID` / `<PROVIDER>_CLIENT_SECRET`,
e ambas as partes precisam ser definidas para que o provedor seja configurado:

```bash
DISCORD_CLIENT_ID=…
DISCORD_CLIENT_SECRET=…
```

O endpoint `GET /api/auth/config` lista então `discord` em `enabledProviders`, que
é a forma de verificar se o par foi reconhecido.

A Apple é a exceção: ela não possui um client secret estático, porque o Rebase
assina um JWT ES256 de curta duração para cada troca de token. Ela requer todas as
quatro variáveis: `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID` e
`APPLE_PRIVATE_KEY` — o conteúdo do arquivo `.p8`, incluindo quebras de linha e
tudo mais.

Duas opções não possuem correspondência em variáveis de ambiente e exigem o bloco
`auth` (ou seja, um backend ejetado ou configurado via código):
`microsoft.tenantId`, cujo padrão é `common` e relata todos os endereços como
não verificados, e `gitlab.baseUrl`, para uma instância auto-hospedada.

Cada campo nomeado é resolvido na inicialização dentro de `auth.providers`, que é
o array canônico e o ponto de extensão para qualquer coisa não coberta pelos
campos nomeados. As entradas são criadas com as fábricas `create*Provider`, e os
dois formatos são mesclados — campos nomeados são anexados após as entradas
explícitas:

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

Se deixado em branco, a única validação no redirecionamento OAuth será a
correspondência da URI registrada no próprio provedor — o que autoriza **toda**
URI registrada naquele cliente OAuth, incluindo a entrada `localhost` que alguém
adicionou para desenvolvimento e o host de staging que ninguém removeu. Listar as
origens que este backend realmente atende restringe o redirecionamento a elas.
As URIs são comparadas considerando origem mais caminho; query, fragmento e barra
final são ignorados.

### Vinculação de Contas Entre Métodos de Login

O que acontece quando alguém se registra com e-mail/senha como `ada@example.com`
e, mais tarde, clica em "Entrar com o Google" em uma conta do Google com esse
mesmo endereço? O Rebase **vincula as duas em uma única conta** — mas somente
quando o provedor confirmar que o e-mail está verificado. Ele nunca cria
silenciosamente uma segunda conta para o mesmo endereço.

Em `POST /api/auth/<provider>`, a ordem de resolução é:

1. **Identidade do provedor conhecida** — se essa identidade exata do provedor já
   tiver feito login antes, esse usuário é retornado. O e-mail não é consultado.
2. **Conta existente com o mesmo e-mail, verificada pelo provedor** — a
   identidade é vinculada à conta existente e a sessão do usuário é iniciada nela.
   Uma conta, duas formas de acesso.
3. **Conta existente com o mesmo e-mail, NÃO verificada pelo provedor** —
   rejeitada com `403 EMAIL_NOT_VERIFIED`. Nada é criado ou modificado.
4. **Nenhuma conta com esse e-mail** — uma nova conta é criada.

O passo 3 é o caso crítico para a segurança. Se um e-mail de provedor não
verificado fosse suficiente para a vinculação, qualquer um que conseguisse fazer
um provedor emitir um endereço que não lhe pertence poderia assumir o controle da
conta correspondente no Rebase. O Google sempre afirma `email_verified` para
contas reais do Google, portanto o passo 2 é o caminho normal para o login do
Google; o passo 3 captura principalmente provedores que permitem aos usuários
fornecer um endereço arbitrário não confirmado.

Esse comportamento não é configurável — deliberadamente não existe opção para
vincular contas com e-mails não verificados.

Para se recuperar de uma rejeição do passo 3, o usuário entra com seu método
existente e chama o endpoint explícito de vinculação:

```http
POST /api/auth/link/google
Authorization: Bearer <access token>

{ "idToken": "..." }
```

A vinculação enquanto autenticado intencionalmente **não** exige um e-mail
verificado, e não exige que os e-mails coincidam — o endereço do Google de um
usuário frequentemente não é o endereço dele no aplicativo. A assimetria é
deliberada: no login, o e-mail do provedor é a única evidência que vincula a
identidade recebida a uma conta, enquanto aqui o solicitante já comprovou a posse
da conta por possuir uma sessão válida. Retorna `409 IDENTITY_ALREADY_LINKED` se
essa identidade do provedor pertencer a outro usuário, e é idempotente se já
estiver vinculada ao solicitante.

#### A direção inversa

Um usuário que se cadastrou com o Google e não possui senha:

- **Registrar-se com o mesmo e-mail** é recusado com `409 EMAIL_EXISTS`.
- **`POST /api/auth/change-password`** retorna `400 INVALID_ACCOUNT` — não há
  senha existente para validação.
- **`forgot-password` → `reset-password` é a forma suportada de adicionar uma.**
  Ela comprova novamente a titularidade do endereço por e-mail, após o que a
  conta passa a ter ambos os métodos de login.

## Tabelas Criadas Automaticamente

Na primeira inicialização, o Rebase provisiona automaticamente o schema `auth` e
as seguintes tabelas no banco de dados (vinculadas ao schema definido na sua
coleção, por exemplo, `rebase`):

- **`rebase.users`** — Contas de usuário com e-mail, hash de senha, metadados e
  uma coluna `roles` do tipo text[] (as roles são armazenadas como arrays de texto
  inline para otimizar consultas e evitar joins).
- **`rebase.refresh_tokens`** — Sessões de longa duração contendo refresh tokens
  hasheados, user agents e endereços IP. Inclui um índice único em `token_hash` e
  uma restrição única em `(user_id, user_agent, ip_address)` para rastrear
  sessões ativas de dispositivos.
- **`rebase.password_reset_tokens`** — Tokens de uso único com expiração para
  fluxos de recuperação de senha.
- **`rebase.mfa_factors`** — Métodos de autenticação multifator cadastrados (por
  exemplo, segredos TOTP criptografados com AES-256).
- **`rebase.mfa_challenges`** — Logs de verificação rastreando tentativas ativas
  de verificação MFA.
- **`rebase.recovery_codes`** — Códigos de backup/recuperação multifator
  hasheados.
- **`rebase.app_config`** — Armazenamento chave-valor para configurações do
  sistema.

## Bootstrap do Primeiro Usuário

Quando nenhum usuário existe no banco de dados e o servidor **não** está sendo
executado com `NODE_ENV=production`, a primeira pessoa a se registrar torna-se
automaticamente um administrador. Depois disso, o registro é controlado pela
configuração `allowRegistration`.

Em produção essa janela é fechada, pois um host com um nome público fica acessível
antes que seu operador tenha se registrado, e quem chegasse primeiro se tornaria
o proprietário. Uma implantação de produção define seu primeiro admin no ambiente
— `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD`, criados na inicialização
enquanto a tabela ainda está vazia — ou atribui a role com a chave de serviço.
Com a janela fechada, uma tabela vazia recusa o registro de bootstrap com
`SETUP_REQUIRED` (e avisa sobre isso), uma primeira conta criada através de
registro aberto é uma conta comum, `GET /api/auth/config` nunca reporta
`needsSetup`, `POST /api/admin/bootstrap` recusa, e o log de inicialização emite
um aviso quando a tabela estiver vazia e nenhum administrador for especificado.

Em um computador pessoal, isso significa que você sempre pode inicializar um
banco de dados novo sem precisar alimentá-lo manualmente. Para evitar execuções
concorrentes e condições de corrida na geração do schema durante o hot reloading
(HMR) ou inicialização, as operações de bootstrap são sincronizadas usando um lock
consultivo do Postgres:
```sql
SELECT pg_advisory_xact_lock(hashtext('rebase_auth_functions_init'));
```

## Configuração de Autenticação no Nível da Coleção

Em vez de depender apenas das regras padrão de autenticação do banco de dados,
você pode marcar qualquer coleção do Postgres (como `users.ts` ou uma coleção
personalizada `members.ts`) como a coleção de autenticação. Isso é configurado
através da propriedade `auth` na própria coleção:

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
    }
  },
  properties: { ... }
});
```

Um `temporaryPassword` retornado por `onResetPassword` se torna a senha da conta. O Rebase gera o hash dele com o algoritmo configurado, o salva, desconecta o usuário de todas as sessões existentes e o exibe ao administrador para que ele o repasse. O hook não o armazena, nem tem como fazer isso. Não retorne nenhum `temporaryPassword` quando o hook enviar, em vez disso, seu próprio link de redefinição por e-mail: nesse caso, a senha continua a mesma até que o usuário defina uma nova, embora as sessões dele sejam encerradas mesmo assim.

Quando hooks personalizados (`onCreateUser`, `onResetPassword`) são chamados,
eles recebem uma fachada `AuthCollectionContext` contendo:
- `hashPassword(password: string): Promise<string>` — Gera o hash da senha usando o algoritmo configurado (por exemplo, scrypt).
- `sendEmail?: (options) => Promise<EmailSendResult>` — Envia um e-mail (disponível apenas quando o serviço de e-mail estiver configurado). Resolve com o retorno informado pelo provedor — `messageId`, `accepted`, `rejected` — permitindo que um hook salve o id e posteriormente encadeie uma resposta a ele.
- `emailConfigured: boolean` — Se o serviço de e-mail está configurado.
- `appName: string` — O nome do aplicativo extraído da configuração de e-mail.
- `resetPasswordUrl: string` — A URL base do link de redefinição de senha.

## Próximos Passos

- **[Endpoints e tokens](/docs/backend/auth-endpoints/)** — cada rota que esta configuração disponibiliza
- **[Adaptadores de autenticação personalizados](/docs/backend/auth-adapters/)** — trazendo seu próprio provedor de identidade
- **[Autenticação no Frontend](/docs/frontend/authentication/)** — interface de login, controlador de autenticação, gerenciamento de usuários
- **[Regras de Segurança (RLS)](/docs/collections/security-rules/)** — controle de acesso a nível de linha
- **[Autenticação no SDK do Cliente](/docs/sdk/authentication/)** — métodos de autenticação no SDK do cliente
