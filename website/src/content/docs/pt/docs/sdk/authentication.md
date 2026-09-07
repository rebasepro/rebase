---
sourceHash: 9268d903ba4bf874
title: Autenticação
sidebar_label: Autenticação
description: Autenticação do lado do cliente com o SDK da Rebase — login com e-mail/senha, provedores OAuth, gerenciamento de sessões e listeners do estado de autenticação.
---

## Visão Geral

O módulo `client.auth` cuida da autenticação de usuários, do gerenciamento de tokens e da persistência de sessões. Depois que um usuário faz login, todas as requisições de dados subsequentes incluem automaticamente o JWT.

O SDK persiste as sessões no `localStorage` por padrão e atualiza os tokens automaticamente antes de expirarem.

:::note[Todo método de login resolve para uma sessão achatada]
`signInWithEmail`, `signUp` e todos os métodos `signInWith*` retornam
**`{ user, accessToken, refreshToken }`** — o SDK já desembrulhou o envelope para
você.

A API REST subjacente retorna o token aninhado, como
`{ user, tokens: { accessToken, … } }`. Essa diferença só importa se você também
chamar `/api/auth/*` diretamente com `fetch`, onde `body.accessToken` é
`undefined` e o token está em `body.tokens.accessToken`. Veja
[o formato da API REST](/docs/backend/authentication).
:::

## E-mail / Senha

### Entrar

```typescript
const { user, accessToken, refreshToken } = await client.auth.signInWithEmail(
    "user@example.com",
    "password"
);
console.log(user.uid, user.email);
```

### Cadastrar

```typescript
const { user } = await client.auth.signUp(
    "user@example.com",
    "password",
    "Jane Doe"   // optional displayName
);
```

## Provedores OAuth

O SDK inclui métodos dedicados para provedores OAuth populares, além de um `signInWithOAuth()` genérico para qualquer provedor personalizado.

### Google

Suporta três estilos de invocação:

```typescript
// ID-token flow (One Tap / Sign In With Google button)
await client.auth.signInWithGoogle({ idToken: googleIdToken });

// Access-token flow (popup)
await client.auth.signInWithGoogle({ accessToken: googleAccessToken });

// Authorization code flow (most secure, server-side exchange)
await client.auth.signInWithGoogle({ code: authCode, redirectUri: "https://..." });
```

### Outros Provedores

Cada provedor segue o fluxo de código de autorização com `(code, redirectUri)`:

```typescript
await client.auth.signInWithGitHub(code, redirectUri);
await client.auth.signInWithMicrosoft(code, redirectUri);
await client.auth.signInWithFacebook(code, redirectUri);
await client.auth.signInWithLinkedin(code, redirectUri);
await client.auth.signInWithDiscord(code, redirectUri);
await client.auth.signInWithGitLab(code, redirectUri);
await client.auth.signInWithBitbucket(code, redirectUri);
await client.auth.signInWithSlack(code, redirectUri);
await client.auth.signInWithSpotify(code, redirectUri);
```

Apple e Twitter exigem parâmetros adicionais:

```typescript
// Apple — optional user info from first sign-in
await client.auth.signInWithApple(code, redirectUri, {
    name: { firstName: "Jane", lastName: "Doe" },
    email: "jane@example.com"
});

// Twitter — requires PKCE code verifier
await client.auth.signInWithTwitter(code, redirectUri, codeVerifier);
```

### OAuth Genérico

Para qualquer provedor registrado no backend:

```typescript
await client.auth.signInWithOAuth("custom-provider", {
    code: authCode,
    redirectUri: "https://myapp.com/callback"
});
```

## Sair

```typescript
await client.auth.signOut();
```

Isso revoga o refresh token no servidor, limpa a sessão local e emite um evento `SIGNED_OUT`.

## Gerenciamento de Sessões

### Obter a Sessão Atual

```typescript
const session = client.auth.getSession();
// { accessToken, refreshToken, expiresAt, user } | null
```

### Obter o Usuário Atual (Verificado pelo Servidor)

```typescript
const user = await client.auth.getUser();
// Fetches the user from the backend (GET /auth/me)
```

### Atualizar o Perfil do Usuário

```typescript
const updatedUser = await client.auth.updateUser({
    displayName: "Jane Doe",
    photoURL: "https://example.com/avatar.jpg"
});
```

### Atualizar o Token

A atualização do token acontece automaticamente, mas você pode acioná-la manualmente:

```typescript
const session = await client.auth.refreshSession();
```

## Listener do Estado de Autenticação

Reaja às mudanças de autenticação em toda a sua aplicação:

```typescript
const unsubscribe = client.auth.onAuthStateChange((event, session) => {
    // event: "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED" | "USER_UPDATED"
    console.log("Auth event:", event);
    console.log("Session:", session?.user?.email);
});

// Stop listening
unsubscribe();
```

## Gerenciamento de Senhas

### Senha Esquecida

```typescript
const { success, message } = await client.auth.resetPasswordForEmail(
    "user@example.com"
);
```

### Redefinir Senha (com Token)

```typescript
const { success, message } = await client.auth.resetPassword(
    resetToken,
    "newSecurePassword"
);
```

### Alterar Senha (Autenticado)

```typescript
const { success, message } = await client.auth.changePassword(
    "oldPassword",
    "newPassword"
);
```

## Verificação de E-mail

```typescript
// Send verification email to the current user
await client.auth.sendVerificationEmail();

// Verify with the token from the email link
await client.auth.verifyEmail(token);
```

## Gerenciamento de Sessões (Múltiplos Dispositivos)

```typescript
// List all active sessions
const sessions = await client.auth.getSessions();

// Revoke a specific session
await client.auth.revokeSession(sessionId);

// Revoke ALL sessions (logs out everywhere)
await client.auth.revokeAllSessions();
```

## Configuração de Autenticação

Consulte a configuração de autenticação do backend:

```typescript
const config = await client.auth.getAuthConfig();
// {
//   hasBuiltInAuthRoutes: boolean,
//   emailPasswordLogin: boolean,
//   registrationEnabled: boolean,   // open right now, bootstrap window included
//   passwordReset: boolean,         // needs an email service
//   adminPasswordReset: boolean,
//   sessionManagement: boolean,
//   profileUpdate: boolean,
//   emailVerification: boolean,
//   magicLink: boolean,
//   anonymousLogin: boolean,
//   enabledProviders: string[],
//   needsSetup: boolean
// }
```

## Armazenamento de Sessão Personalizado

Por padrão, as sessões são armazenadas no `localStorage`. Você pode personalizar isso com a opção `auth`:

```typescript
import { createRebaseClient, createCookieStorage } from "@rebasepro/client";

// Use cookies instead of localStorage
const client = createRebaseClient({
    baseUrl: import.meta.env.VITE_API_URL,
    auth: {
        storage: createCookieStorage({
            path: "/",
            sameSite: "Lax",
            secure: true
        }),
        autoRefresh: true,       // default: true
        persistSession: true     // default: true
    }
});
```

## Forma do Objeto User

```typescript
// Canonical type — import from @rebasepro/types
interface User {
    uid: string;
    email: string | null;
    displayName: string | null;
    photoURL: string | null;
    providerId: string;
    isAnonymous: boolean;
    emailVerified?: boolean;
    roles?: string[];          // text[] from the users table
    metadata?: Record<string, unknown>;
}
```

## Próximos Passos

- **[Consultar Dados](/docs/sdk/querying)** — Operações CRUD e construtor de consultas
- **[Assinaturas em Tempo Real](/docs/sdk/realtime)** — Dados ao vivo com WebSockets
- **[Backend de Autenticação](/docs/backend/authentication)** — Configuração de autenticação do lado do servidor
