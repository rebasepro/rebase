---
sourceHash: 9268d903ba4bf874
title: Autenticação
sidebar_label: Autenticação
description: Autenticação no lado do cliente com o SDK Rebase — login com e-mail/senha, provedores OAuth, gerenciamento de sessão e listeners de estado de autenticação.
---

## Visão Geral

O módulo `client.auth` gerencia a autenticação de usuários, o gerenciamento de tokens e a persistência de sessão. Depois que um usuário faz login, todas as requisições de dados subsequentes incluem automaticamente o JWT.

O SDK persiste sessões no `localStorage` por padrão e atualiza automaticamente os tokens antes que expirem.

:::note[Todo método de login resulta em uma sessão nivelada]
`signInWithEmail`, `signUp` e todos os métodos `signInWith*` retornam
**`{ user, accessToken, refreshToken }`** — o SDK já desempacotou a
resposta para você.

A API REST por baixo retorna o token aninhado, como
`{ user, tokens: { accessToken, … } }`. Essa diferença só importa se você também
chamar `/api/auth/*` diretamente com `fetch`, onde `body.accessToken` é `undefined`
e o token fica em `body.tokens.accessToken`. Veja
[o formato de transmissão](/docs/backend/auth-endpoints/#response-format).
:::

## E-mail / Senha

### Login

```typescript
const { user, accessToken, refreshToken } = await client.auth.signInWithEmail(
    "user@example.com",
    "password"
);
console.log(user.uid, user.email);
```

### Cadastro

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

Oferece suporte a três estilos de invocação:

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

A Apple e o Twitter exigem parâmetros adicionais:

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

## Magic Links

Um link de login de um clique enviado por e-mail. O link direciona para uma página sua carregando um
token; envie o token de volta para trocá-lo por uma sessão.

```typescript
// 1. Ask for the link. `redirectTo` is where the link points.
await client.auth.sendMagicLink("user@example.com");

// 2. On the landing page, trade the token for a session.
const token = new URLSearchParams(location.search).get("token")!;
const { user } = await client.auth.verifyMagicLink(token);
```

`sendMagicLink` responde a mesma coisa independentemente de o endereço ter ou
não uma conta. Isso é deliberado: um endpoint que dissesse "usuário inexistente" é um
oráculo de enumeração de contas, portanto não use o resultado para informar a uma pessoa se ela está
cadastrada — ele não sabe.

Ambos precisam de um serviço de e-mail configurado no backend, caso contrário responderão com 503
`EMAIL_NOT_CONFIGURED`.

## Códigos de Uso Único

Um código de seis dígitos por e-mail, para os mesmos casos em que um link é inconveniente — um
aplicativo nativo, um segundo dispositivo, um navegador que corrompe links.

```typescript
const { expiresInSeconds } = await client.auth.sendEmailOtp("user@example.com");

// The address goes back with the code, because the code is only valid for it.
const { user } = await client.auth.verifyEmailOtp("user@example.com", "418293");
```

Enviar o endereço junto com o código é o que garante que uma tentativa de seis dígitos seja uma tentativa
contra *uma* conta em vez de contra todas as contas de uma vez só.

## Sessões Anônimas

Faça o login de um visitante sem credenciais para que ele possa começar a usar o aplicativo
antes de ter um motivo para se cadastrar:

```typescript
const { user } = await client.auth.signInAnonymously();
user.isAnonymous;   // true
```

A conta é real: ela tem um ID, papéis (roles) e uma sessão, de modo que a segurança em nível de linha (row-level security)
restringe suas linhas exatamente como faria com a de um usuário cadastrado. O que ela não tem é
um caminho de volta — ninguém pode fazer login *como* ela uma segunda vez, portanto tudo o que ela possui é
perdido com a sessão.

`linkAnonymous` é como ela deixa de ser descartável. O usuário **mantém seu ID**, garantindo
que tudo o que criou enquanto anônimo continue sendo dele:

```typescript
await client.auth.linkAnonymous("user@example.com", "correct-horse-battery");
```

| Falha | Significado |
|---------|-------|
| `ANONYMOUS_AUTH_DISABLED` (403) | O backend não habilitou a autenticação anônima |
| `NOT_ANONYMOUS` (400) | A sessão atual pertence a uma conta comum |
| `EMAIL_EXISTS` (409) | O endereço já possui uma conta — faça login nela |

## Vinculando um Provedor a uma Conta Existente

`signInWithGoogle` e similares realizam o *login* do usuário. `linkProvider` vincula a
identidade de um provedor à conta já conectada, para que a mesma pessoa possa retornar
por qualquer uma das opções:

```typescript
await client.auth.linkProvider("google", { idToken });
```

A sessão já comprova a propriedade da conta, portanto, diferentemente do login, isso não
exige que o provedor tenha verificado o e-mail, e os dois endereços não precisam coincidir.
A operação é bem-sucedida de forma idempotente (`alreadyLinked: true`) quando essa identidade já
está vinculada a essa conta, e recusa com `IDENTITY_ALREADY_LINKED` (409) quando pertence a uma conta diferente.

## Buscando um Usuário por E-mail

```typescript
const profile = await client.auth.findUserByEmail("user@example.com");
// { uid, displayName, photoURL } | null
```

Três campos não sensíveis e nada mais — o suficiente para exibir "você está convidando
Jane" antes que um convite seja enviado.

## Autenticação Multifator

Fatores TOTP — um aplicativo autenticador — mais o desafio que eleva uma sessão
de `aal1` para `aal2`.

### Cadastrando um fator

```typescript
const { factor, totp, recoveryCodes } = await client.auth.mfa.enroll({
    friendlyName: "Phone"
});

showQrCode(totp.uri);        // otpauth://… — what the authenticator scans
showRecoveryCodes(recoveryCodes);
```

**Exiba os códigos de recuperação uma única vez e nunca mais.** Apenas os hashes são armazenados,
portanto nada poderá exibi-los mais tarde.

O fator não pode ser usado até que o usuário comprove que seu autenticador gerou um
código a partir desse segredo:

```typescript
await client.auth.mfa.verify(factor.id, "418293");
```

### Fazendo login com MFA

Um login em uma conta com MFA cadastrado retorna uma sessão em `aal1`. Abra um
desafio e responda a ele para obter a sessão definitiva:

```typescript
const factors = await client.auth.mfa.listFactors();
const { challengeId } = await client.auth.mfa.challenge(factors[0].id);

// A TOTP code, or one of the recovery codes.
const { user } = await client.auth.mfa.verifyChallenge(challengeId, "418293");
```

`verifyChallenge` emite a sessão `aal2` e este cliente a adota, substituindo
os tokens que o login retornou. Um desafio expira após cinco minutos, e
um desafio cujas tentativas atingiram o limite é invalidado pelo resto de sua
duração — caso contrário, um desafio aberto permitiria tentativas ilimitadas para adivinhar os seis dígitos.

### Removendo um fator

```typescript
await client.auth.mfa.unenroll(factorId);
```

Requer uma sessão `aal2` — que já tenha respondido a um desafio — para que um
token `aal1` roubado não possa desativar o MFA. Remover o último fator verificado também
descarta os códigos de recuperação.

## Logout

```typescript
await client.auth.signOut();
```

Isso revoga o token de atualização no servidor, limpa a sessão local e emite um evento `SIGNED_OUT`.

## Gerenciamento de Sessão

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

### Atualizar Token

A atualização de token acontece automaticamente, mas você pode acioná-la manualmente:

```typescript
const session = await client.auth.refreshSession();
```

## Onde a Sessão Fica Armazenada: `authFlowMode`

```typescript
const client = createRebaseClient({
    baseUrl: API_URL,
    auth: { authFlowMode: "cookie" }
});
```

| Modo | Onde o token de atualização fica | Quando usar |
|------|----------------------------|----------------|
| `"json"` *(padrão)* | Retornado no corpo da resposta, mantido no `localStorage` | Um aplicativo nativo, um script, qualquer coisa sem o armazenamento de cookies de um navegador |
| `"cookie"` | Um cookie **HttpOnly** que o backend define | Uma aplicação de navegador. Scripts em execução na sua página não podem lê-lo, o que o torna protegido contra XSS |

O modo cookie precisa de `auth.cookieAuth` no backend, e é o que o template de
frontend gerado utiliza.

## Aguardando a Restauração da Sessão

**Uma sessão restaurada não está disponível na primeira renderização.** `getSession()` é
síncrono, portanto, ao carregar a página, ele retorna `null` enquanto a restauração ainda está
em andamento — e, no modo cookie, uma restauração está *sempre* em andamento, porque o token de
atualização fica em um cookie que a página não pode ler, de modo que o cliente precisa solicitar ao servidor
um novo token de acesso.

Lê-lo de forma síncrona é o que causa o efeito visual de flash de logout a cada recarregamento:

```typescript no-verify
// Wrong: renders the signed-out view for one round trip, every reload.
const session = client.auth.getSession();
if (!session) return <SignIn />;
```

`isInitialized()` é resolvido assim que o cliente termina a tentativa — quer
tenha encontrado uma sessão ou não:

```typescript
async function currentUser() {
    await client.auth.isInitialized();
    return client.auth.getSession()?.user ?? null;
}
```

No React, isso equivale a um effect:

```tsx
import { useEffect, useState } from "react";

function useCurrentUser() {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        client.auth.isInitialized().then(() => {
            if (cancelled) return;
            setUser(client.auth.getSession()?.user ?? null);
            setLoading(false);
        });
        return () => { cancelled = true; };
    }, []);

    return { user, loading };
}
```

O `useRebaseAuthController` no `@rebasepro/app` já faz isso, portanto um aplicativo construído
no template gerado recebe isso automaticamente.

Uma restauração bem-sucedida também aciona `onAuthStateChange` como `TOKEN_REFRESHED` — afinal,
*é* uma atualização —, mas um listener sozinho não consegue informar se a restauração terminou:
uma inicialização sem sessão não emite absolutamente nada, o que é indistinguível de uma
ainda em andamento. Aguarde `isInitialized()` para essa confirmação e use o
listener para alterações posteriores.

## Listener de Estado de Autenticação

Reaja a alterações de autenticação em toda a sua aplicação:

```typescript
const unsubscribe = client.auth.onAuthStateChange((event, session) => {
    // event: "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED" | "USER_UPDATED"
    console.log("Auth event:", event);
    console.log("Session:", session?.user?.email);
});

// Stop listening
unsubscribe();
```

| Evento | Quando |
|-------|------|
| `SIGNED_IN` | Um login ou cadastro foi concluído |
| `TOKEN_REFRESHED` | O token de acesso foi renovado — incluindo a renovação silenciosa que restaura uma sessão no carregamento da página |
| `USER_UPDATED` | `updateUser()` alterou o perfil |
| `SIGNED_OUT` | Um logout ou uma atualização que falhou definitivamente |

## Gerenciamento de Senha

### Esqueci a Senha

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

## Gerenciamento de Sessão (Multi-dispositivo)

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

## Estrutura do Objeto User

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

- **[Consultando Dados](/docs/sdk/querying)** — Operações CRUD e construtor de consultas
- **[Assinaturas em Tempo Real](/docs/sdk/realtime)** — Dados ao vivo com WebSockets
- **[Backend de Autenticação](/docs/backend/authentication)** — Configuração de autenticação no servidor
