---
title: Autenticação
sidebar_label: Autenticação
description: Configure autenticação JWT, provedores OAuth, e-mail SMTP, hooks de autenticação e adaptadores de autenticação personalizados no backend.
---

## Visão Geral

A Rebase inclui um sistema de autenticação de backend completo:

- **Tokens JWT** — Fluxo de token de acesso e de atualização com expiração configurável
- **Provedores OAuth** — Google, LinkedIn, GitHub, Microsoft, Apple e mais
- **E-mail SMTP** — Fluxos de redefinição de senha e verificação de e-mail
- **Hooks de autenticação** — Hooks de ciclo de vida para criação de usuários e mais
- **Adaptadores de autenticação personalizados** — Conecte Firebase Auth, Auth0, Clerk ou qualquer provedor externo
- **Chave de serviço** — Chave estática para autenticação de servidor para servidor
- **Auto-bootstrapping** — O primeiro usuário obtém automaticamente o papel de administrador

## Configuração

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

:::caution[Os callbacks de coleção não disparam para usuários de autenticação]
A criação e as atualizações de usuários através do sistema de autenticação — registro, gerenciamento
de usuários pelo administrador e OAuth — escrevem **diretamente** no armazenamento de usuários e ignoram o
pipeline de salvamento de coleções. Um callback `beforeSave`/`afterSave`/`beforeDelete`/`afterDelete`
na coleção de autenticação (usuários) **não** será executado para esses caminhos. Para
efeitos colaterais como provisionar uma equipe pessoal no cadastro, use os hooks do ciclo de vida
de autenticação (`afterUserCreate`, `beforeUserCreate`, `afterUserDelete`, …), que
recebem o registro de usuário totalmente preenchido.
:::

### Provedores OAuth

Cada provedor OAuth é configurado com no mínimo um `clientId`. Alguns provedores exigem um `clientSecret`:

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

### Vinculação de Contas entre Métodos de Login

O que acontece quando alguém se registra com e-mail/senha como
`ada@example.com` e mais tarde clica em "Entrar com o Google" numa conta Google
com esse mesmo endereço? O Rebase **vincula as duas numa única conta** — mas
apenas quando o provedor afirma que o e-mail está verificado. Ele nunca cria
silenciosamente uma segunda conta para o mesmo endereço.

Em `POST /api/auth/<provider>` a ordem de resolução é:

1. **Identidade de provedor já conhecida** — se essa identidade exata do
   provedor já fez login antes, esse usuário é retornado. O e-mail não é
   consultado.
2. **Conta existente com o mesmo e-mail, verificado pelo provedor** — a
   identidade é anexada à conta existente e o usuário entra nela. Uma conta,
   duas formas de entrar.
3. **Conta existente com o mesmo e-mail, NÃO verificado pelo provedor** —
   rejeitado com `403 EMAIL_NOT_VERIFIED`. Nada é criado nem modificado.
4. **Nenhuma conta com esse e-mail** — uma nova conta é criada.

O passo 3 é o caso crítico para a segurança. Se um e-mail não verificado do
provedor bastasse para vincular, qualquer pessoa capaz de fazer um provedor
emitir um endereço que não lhe pertence poderia assumir o controle da conta
Rebase correspondente. O Google sempre afirma `email_verified` para contas
Google reais, portanto o passo 2 é o caminho normal do login com o Google; o
passo 3 atinge sobretudo provedores que deixam o usuário informar um endereço
arbitrário e não confirmado.

Esse comportamento não é configurável — deliberadamente não existe opção para
vincular com e-mails não verificados.

Para se recuperar de uma rejeição do passo 3, o usuário entra com o seu método
existente e chama o endpoint de vinculação explícito:

```http
POST /api/auth/link/google
Authorization: Bearer <access token>

{ "idToken": "..." }
```

A vinculação feita já autenticado intencionalmente **não** exige um e-mail
verificado, nem exige que os e-mails coincidam — o endereço do Google de um
usuário muitas vezes não é o endereço que ele usa no aplicativo. A assimetria é
deliberada: no login, o e-mail do provedor é a única evidência que liga a
identidade recebida a uma conta, ao passo que aqui quem chama já provou ser o
proprietário por possuir uma sessão válida. Retorna
`409 IDENTITY_ALREADY_LINKED` se essa identidade de provedor pertencer a outro
usuário, e é idempotente se ela já estiver vinculada a quem chama.

#### O sentido inverso

Um usuário que se cadastrou com o Google e não tem senha:

- **Registrar-se com o mesmo e-mail** é recusado com `409 EMAIL_EXISTS`.
- **`POST /api/auth/change-password`** retorna `400 INVALID_ACCOUNT` — não há
  senha anterior contra a qual verificar.
- **`forgot-password` → `reset-password` é a forma suportada de adicionar
  uma.** Ela comprova novamente por e-mail a posse do endereço, após o que a
  conta passa a ter ambos os métodos de login.

## Endpoints de Autenticação

Todos os endpoints de autenticação são montados em `/api/auth/`:

| Método | Caminho | Descrição |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Criar uma nova conta |
| `POST` | `/api/auth/login` | Entrar com e-mail/senha |
| `POST` | `/api/auth/refresh` | Atualizar o token de acesso |
| `POST` | `/api/auth/<provider>` | Login OAuth (por ex., `/api/auth/google`, `/api/auth/linkedin`) |
| `POST` | `/api/auth/link/<provider>` | Vincular um provedor OAuth à conta autenticada |
| `POST` | `/api/auth/logout` | Revogar o refresh token |
| `POST` | `/api/auth/forgot-password` | Enviar e-mail de redefinição de senha |
| `POST` | `/api/auth/reset-password` | Redefinir a senha com um token |
| `POST` | `/api/auth/find-user` | Resolver um e-mail para um perfil público mínimo (opt-in) |

Todos os endpoints da API de dados exigem um cabeçalho `Authorization: Bearer <token>` válido quando `requireAuth: true` (o padrão).

### Formato da resposta

Todo endpoint que emite uma sessão responde com o mesmo envelope: `register`,
`login`, cada provedor OAuth, `magic-link/verify`, `otp/verify`, `anonymous`,
`anonymous/link` e `mfa/challenge/verify`.

```json
{
  "user": {
    "uid": "8f1c2a6e-…",
    "email": "jane@example.com",
    "displayName": "Jane Doe",
    "photoURL": null,
    "providerId": "password",
    "isAnonymous": false,
    "emailVerified": true,
    "roles": ["editor"],
    "metadata": {}
  },
  "tokens": {
    "accessToken": "eyJhbGciOi…",
    "refreshToken": "9b2e…",
    "accessTokenExpiresAt": 1700000000000
  }
}
```

Devolva o token de acesso como `Authorization: Bearer <accessToken>`.
`accessTokenExpiresAt` está em milissegundos desde a época.

`POST /api/auth/refresh` responde com o mesmo envelope, com duas ressalvas:
`user` é omitido por completo quando a conta não pode ser relida, então trate-o
como opcional ali, e `providerId` é sempre `password`, qualquer que tenha sido o
método de criação original da sessão.

:::caution[O SDK cliente achata este envelope — o HTTP direto não]
O JSON acima é o formato que trafega na rede, e é o que
`fetch("/api/auth/login")` retorna: o token fica em
**`body.tokens.accessToken`**.

O [SDK cliente](/docs/sdk/authentication) desembrulha `tokens` antes de devolver
a sessão, de modo que `auth.signInWithEmail()` resolve para um
**`{ user, accessToken, refreshToken }`** achatado.

Ambas as formas são reais; pertencem a duas camadas diferentes. Ler a forma do
SDK a partir de um `fetch` direto produz `undefined`, o que aparece como “o login
funcionou mas não há token de acesso”: o login estava certo, o token estava um
nível abaixo.
:::

Com `cookieAuth` habilitado, o refresh token viaja como um cookie `httpOnly` e
`tokens.refreshToken` é uma string vazia no corpo. O token de acesso não é
afetado.

### Convidar colegas de equipe por e-mail

Os fluxos de convite precisam transformar um endereço de e-mail em um ID de usuário, mas a coleção `users`
é protegida por RLS em relação ao cliente. Em vez de criar manualmente uma função de servidor de
administrador, ative a busca integrada:

```typescript no-verify
await initializeRebaseBackend({
    auth: {
        // ...
        allowUserLookup: true,   // enables POST /api/auth/find-user
    },
});
```

Depois, a partir do cliente:

```typescript
const profile = await client.auth.findUserByEmail("teammate@example.com");
// → { uid, displayName, photoURL } | null   (never email/roles/metadata)
if (profile) {
    await client.data.team_members.create({ team_id, userId: profile.uid });
}
```

O endpoint é **somente para autenticados** e retorna apenas `uid`, `displayName`
e `photoURL` — nunca o e-mail, os papéis ou os metadados do usuário consultado. Ele está
**desativado por padrão** porque permite que qualquer usuário logado sonde quais e-mails têm
contas; ative-o apenas quando sua UX de convite precisar.

## Tabelas Criadas Automaticamente

Na primeira inicialização, a Rebase provisiona automaticamente o esquema `auth` e as seguintes tabelas no banco de dados (vinculadas ao esquema definido na sua coleção, por ex., `rebase`):

- **`rebase.users`** — Contas de usuário com e-mail, hash de senha, metadados e uma coluna `roles` text[] (os papéis são armazenados como arrays de texto inline para otimizar as consultas e evitar joins).
- **`rebase.refresh_tokens`** — Sessões de longa duração carregando refresh tokens com hash, user agents e endereços IP. Inclui um índice único em `token_hash` e uma restrição única em `(userId, user_agent, ip_address)` para rastrear as sessões de dispositivos ativas.
- **`rebase.password_reset_tokens`** — Tokens de uso único expiráveis para os fluxos de recuperação de senha.
- **`rebase.mfa_factors`** — Métodos de autenticação multifator inscritos (por ex., segredos TOTP criptografados com AES-256).
- **`rebase.mfa_challenges`** — Logs de verificação rastreando as tentativas de verificação MFA ativas.
- **`rebase.recovery_codes`** — Códigos de backup/recuperação multifator com hash.
- **`rebase.app_config`** — Armazenamento chave-valor para configurações do sistema.

## Contexto de Banco de Dados da Segurança em Nível de Linha (RLS)

A Rebase conecta a autenticação da requisição diretamente até a segurança em nível de linha (RLS) do PostgreSQL. Cada consulta de banco de dados executada através de um driver com escopo de usuário é executada dentro de uma transação de banco de dados (`db.transaction()`) que configura parâmetros de configuração locais da transação:

*   `app.userId` — O ID único (`uid`) do usuário autenticado. O padrão é `'anon'` para requisições não autenticadas.
*   `app.user_roles` — Uma string separada por vírgulas listando os papéis atribuídos ao usuário.
*   `app.jwt` — Uma string JSON contendo o payload completo de claims do JWT (`{"sub": "<uid>", "roles": [...]}`).

Esses parâmetros são configurados localmente durante a duração da transação usando a função `set_config` do Postgres:
```sql
SELECT 
    set_config('app.userId', $1, true),
    set_config('app.user_roles', $2, true),
    set_config('app.jwt', $3, true);
```

### Funções Auxiliares de Políticas do PostgreSQL

Para tornar a escrita de políticas de segurança em nível de linha simples, a Rebase cria funções auxiliares sob o esquema `auth` durante o bootstrapping do banco de dados:

*   **`rebase.uid()`** — Retorna o ID do usuário autenticado como `text`, ou `NULL` se não definido:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.uid() RETURNS text AS $$
        SELECT NULLIF(current_setting('app.user_id', true), '');
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.roles()`** — Retorna a string de papéis separada por vírgulas:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.roles() RETURNS text AS $$
        SELECT COALESCE(NULLIF(current_setting('app.user_roles', true), ''), '');
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.jwt()`** — Retorna o payload completo do JWT como um objeto `jsonb`:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.jwt() RETURNS jsonb AS $$
        SELECT COALESCE(NULLIF(current_setting('app.jwt', true), ''), '{}')::jsonb;
    $$ LANGUAGE sql STABLE;
    ```

Você pode usar esses auxiliares diretamente em suas regras de segurança personalizadas ou migrações de banco de dados:
```sql
CREATE POLICY owner_access ON posts
    FOR ALL
    TO public
    USING (author_id = rebase.uid() OR string_to_array(rebase.roles(), ',') && ARRAY['admin']);
```

## Bootstrap do Primeiro Usuário

Quando não existem usuários no banco de dados, a primeira pessoa a se registrar torna-se automaticamente um administrador. Depois disso, o registro é controlado pela configuração `allowRegistration`.

Isso garante que você sempre possa inicializar uma nova implantação sem precisar semear o banco de dados manualmente. Para evitar execuções concorrentes e condições de corrida na geração do esquema durante o hot reloading (HMR) ou a inicialização, as operações de bootstrapping são sincronizadas usando um advisory lock do Postgres:
```sql
SELECT pg_advisory_xact_lock(hashtext('rebase_auth_functions_init'));
```

## Configuração de Autenticação em Nível de Coleção

Em vez de depender exclusivamente das regras de autenticação padrão do banco de dados, você pode marcar qualquer coleção Postgres (como `users.ts` ou uma coleção personalizada `members.ts`) como a coleção de autenticação. Isso é configurado através da propriedade `auth` na própria coleção:

```typescript
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
      const tempPassword = "reset_" + Math.random().toString(36).substring(2, 8);
      return {
        temporaryPassword: tempPassword,
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

Quando os hooks personalizados (`onCreateUser`, `onResetPassword`) são chamados, eles recebem uma fachada `AuthCollectionContext` contendo:
- `hashPassword(password: string): Promise<string>` — Gera o hash da senha usando o algoritmo de hashing configurado (por ex., scrypt).
- `sendEmail?: (options) => Promise<void>` — Envia um e-mail (disponível apenas quando o serviço de e-mail está configurado).
- `emailConfigured: boolean` — Se o serviço de e-mail está configurado.
- `appName: string` — O nome do app da configuração de e-mail.
- `resetPasswordUrl: string` — A URL base do link de redefinição de senha.

## Autenticação com Chave de Serviço

Para comunicação de servidor para servidor (por ex., cron jobs, serviços externos), configure uma chave de serviço estática:

```typescript
auth: {
    serviceKey: process.env.REBASE_SERVICE_KEY,
    // ...
}
```

Os clientes se autenticam com o cabeçalho `Authorization: Bearer <service-key>`. 

### Chave Interna por Inicialização

Se `REBASE_SERVICE_KEY` não for fornecida na sua configuração, a Rebase gera automaticamente uma **chave interna por inicialização** aleatória. 

Essa chave nunca é registrada em log e nunca sai do processo. Ela é usada pelo singleton `rebase` para se autenticar contra as próprias APIs do plano de controle do servidor (auth, storage, etc.). Isso garante que tarefas administrativas (como enviar um e-mail de boas-vindas ou gerar uma URL de armazenamento) sempre funcionem imediatamente em desenvolvimento e produção sem exigir gerenciamento manual de chaves.

### Proteção Contra Ataques de Temporização e Requisitos da Chave

Para evitar ataques de temporização, a Rebase valida tanto a chave de serviço configurada pelo usuário quanto a chave interna usando uma comparação de strings de tempo constante (`safeCompare`). A chave de serviço configurada pelo usuário **deve ter pelo menos 32 caracteres**; se uma chave com menos de 32 caracteres for configurada, a Rebase lançará um erro de configuração na inicialização e falhará de forma fechada (fail-closed).


## Adaptadores de Autenticação Personalizados

A Rebase permite a substituição completa do sistema de autenticação integrado por meio de uma arquitetura de autenticação plugável. Isso desacopla a verificação de autenticação das camadas de banco de dados e REST/WebSocket, permitindo uma integração perfeita com provedores externos como **Clerk**, **Auth0**, **Firebase Auth** ou serviços de identidade JWT personalizados.

### O Contrato AuthAdapter

Você pode implementar a interface `AuthAdapter` diretamente para controle completo. A definição da interface é a seguinte:

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";
import { AuthenticatedUser, AuthAdapterCapabilities, UserManagementAdapter, UserCreationPrepareResult, UserCreationFinalizeResult } from "@rebasepro/types";

export interface AuthAdapter {
  /** Unique identifier for this auth adapter (e.g., "clerk", "custom") */
  readonly id: string;

  /**
   * Verifies an incoming HTTP request and returns the authenticated user payload.
   * Called by Hono authentication middleware on every REST endpoint.
   */
  verifyRequest(request: Request): Promise<AuthenticatedUser | null>;

  /**
   * Verifies a raw token string (e.g. for WebSocket connection handshake phase 1).
   * If omitted, a synthetic request is automatically constructed.
   */
  verifyToken?(token: string): Promise<AuthenticatedUser | null>;

  /** Optional user management operations (CRUD) for the Admin Dashboard panel */
  userManagement?: UserManagementAdapter;

  /** Optional: Mount adapter-specific custom public routes (e.g. callback paths) */
  createAuthRoutes?(): Hono<any, any, any> | undefined;

  /** Optional: Mount adapter-specific admin-only routes */
  createAdminRoutes?(): Hono<any, any, any> | undefined;

  /** Advertise supported capabilities (to customize Admin Dashboard UI visibility) */
  getCapabilities(): AuthAdapterCapabilities | Promise<AuthAdapterCapabilities>;

  /** Lifecycle hooks called during backend start and graceful shutdown */
  initialize?(): Promise<void>;
  destroy?(): Promise<void>;

  /** Custom user lifecycle hooks (e.g., hash passwords before collection writes) */
  prepareUserCreation?(
    values: Record<string, unknown>,
    collectionAuth?: unknown
  ): Promise<UserCreationPrepareResult>;

  finalizeUserCreation?(
    entity: { id: string; values: Record<string, unknown> },
    clearPassword?: string
  ): Promise<UserCreationFinalizeResult>;

  /** Static service key to bypass checks for server-to-server calls */
  serviceKey?: string;
}
```

### O Payload do Usuário Autenticado

Independentemente do provedor de autenticação externo escolhido, seu adaptador deve resolver as verificações de token bem-sucedidas em um objeto `AuthenticatedUser` uniforme. O Rebase RLS Scope Injector mapeia esses valores diretamente para variáveis de sessão do PostgreSQL dentro das transações:

```typescript
export interface AuthenticatedUser {
  uid: string;                    // Maps to pg local 'app.userId' -> rebase.uid()
  email: string;                  // User email address
  displayName?: string | null;    // Optional display name
  photoUrl?: string | null;        // Optional avatar URL
  roles: string[];                // Maps to pg local 'app.user_roles' -> rebase.roles()
  isAdmin: boolean;               // Grants global superuser privileges if true
  rawToken?: string;              // The original token string (for downstream forwarding)
  claims?: Record<string, any>;   // Custom claims/metadata (available in rebase.jwt())
}
```

---

### Integração Rápida via `createCustomAuthAdapter`

Para cenários padrão (como validar JWTs de um serviço de terceiros), você pode usar o utilitário `createCustomAuthAdapter`. Esse utilitário lida com os padrões de capabilities e implementa a validação de token WebSocket imediatamente, envolvendo sua implementação de `verifyRequest`.

#### Exemplo: Integração com Clerk

Para conectar um backend Rebase com **Clerk**, você pode verificar os tokens JWT do Clerk usando o JSON Web Key Set (JWKS) do Clerk:

```typescript no-verify
import { initializeRebaseBackend } from "@rebasepro/server";
import { createCustomAuthAdapter } from "@rebasepro/server";
import { createRemoteJWKSet, jwtVerify } from "jose";

// Clerk JWKS URL
const CLERK_JWKS_URL = "https://clerk.your-domain.com/.well-known/jwks.json";
const JWKS = createRemoteJWKSet(new URL(CLERK_JWKS_URL));

const clerkAuthAdapter = createCustomAuthAdapter({
    serviceKey: process.env.REBASE_SERVICE_KEY,
    verifyRequest: async (request) => {
        const authHeader = request.headers.get("Authorization");
        const token = authHeader?.replace("Bearer ", "");
        if (!token) return null;

        try {
            // Verify Clerk JWT token against JWKS
            const { payload } = await jwtVerify(token, JWKS);
            
            const metadata = payload.metadata as Record<string, unknown> | undefined;
            const roles = Array.isArray(metadata?.roles) ? metadata.roles as string[] : [];
            
            return {
                uid: payload.sub!,
                email: (payload as Record<string, unknown>).email as string || "",
                displayName: (payload as Record<string, unknown>).name as string || null,
                roles: roles,
                isAdmin: roles.includes("admin"),
                claims: payload as Record<string, unknown>
            };
        } catch (error) {
            console.error("Clerk token verification failed:", error);
            return null; // Fail-closed
        }
    },
    capabilities: {
        hasBuiltInAuthRoutes: false, // Login is managed by Clerk UI
        emailPasswordLogin: false,
        registrationEnabled: false,
        passwordReset: false,
        profileUpdate: false,
        sessionManagement: false
    }
});

const backend = await initializeRebaseBackend({
    auth: clerkAuthAdapter,
    // ...
});
```

#### Exemplo: Integração com Firebase Auth

Para verificar os tokens do Firebase Auth usando os certificados públicos do Firebase:

```typescript no-verify
import { initializeRebaseBackend } from "@rebasepro/server";
import { createCustomAuthAdapter } from "@rebasepro/server";
import { createRemoteJWKSet, jwtVerify } from "jose";

const FIREBASE_JWKS_URL = "https://www.googleapis.com/robot/v1/metadata/jwk/securetoken@system.gserviceaccount.com";
const JWKS = createRemoteJWKSet(new URL(FIREBASE_JWKS_URL));
const FIREBASE_PROJECT_ID = "my-firebase-project-id";

const firebaseAuthAdapter = createCustomAuthAdapter({
    serviceKey: process.env.REBASE_SERVICE_KEY,
    verifyRequest: async (request) => {
        const authHeader = request.headers.get("Authorization");
        const token = authHeader?.replace("Bearer ", "");
        if (!token) return null;

        try {
            const { payload } = await jwtVerify(token, JWKS, {
                issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
                audience: FIREBASE_PROJECT_ID
            });

            const roles = Array.isArray((payload as Record<string, unknown>).roles) ? (payload as Record<string, unknown>).roles as string[] : [];

            return {
                uid: payload.sub!,
                email: (payload as Record<string, unknown>).email as string || "",
                displayName: (payload as Record<string, unknown>).name as string || null,
                photoUrl: (payload as Record<string, unknown>).picture as string || null,
                roles: roles,
                isAdmin: roles.includes("admin"),
                claims: payload as Record<string, unknown>
            };
        } catch (error) {
            console.error("Firebase token verification failed:", error);
            return null;
        }
    }
});

const backend = await initializeRebaseBackend({
    auth: firebaseAuthAdapter,
    // ...
});
```

---

### Montando as Rotas de Autenticação e Ações da UI de Administração

Se o seu provedor de autenticação personalizado exigir a montagem de endpoints de redirecionamento (como rotas de callback OAuth ou loops de login SAML), implemente o método `createAuthRoutes` no seu adaptador:

```typescript
const myOauthAdapter: AuthAdapter = {
    id: "custom-oauth",
    verifyRequest: async (req) => ({
        // validate the token, then return the caller
        uid: "…",
        email: "user@example.com",
        roles: [],
        isAdmin: false
    }),
    getCapabilities: () => ({
        hasBuiltInAuthRoutes: true,
        emailPasswordLogin: false,
        registrationEnabled: false,
        passwordReset: false,
        adminPasswordReset: false,
        sessionManagement: false,
        profileUpdate: false,
        emailVerification: false,
        magicLink: false,
        anonymousLogin: false,
        enabledProviders: []
    }),
    createAuthRoutes: () => {
        const app = new Hono<HonoEnv>();
        
        // Mounted automatically under /api/auth/callback
        app.get("/callback", async (c) => {
            const code = c.req.query("code");
            // Exchange code for provider tokens and set cookies/redirect
            return c.redirect("/dashboard");
        });
        
        return app;
    }
};
```

Se você deseja permitir operações CRUD de usuários diretamente dentro da Rebase Admin Dashboard, implemente o auxiliar `userManagement` dentro das opções do adaptador, que fornece hooks para `listUsers`, `createUser`, `updateUser` e `deleteUser`.


## Próximos Passos

- **[Autenticação no Frontend](/docs/frontend/authentication)** — UI de login, controlador de autenticação, gerenciamento de usuários
- **[Regras de Segurança (RLS)](/docs/collections/security-rules)** — Controle de acesso em nível de linha
- **[Autenticação do SDK Cliente](/docs/sdk/authentication)** — Métodos de autenticação no SDK cliente
