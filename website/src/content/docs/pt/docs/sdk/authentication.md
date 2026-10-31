---
sourceHash: e886a47c056f9c06
title: Autenticação
sidebar_label: Autenticação
description: Autenticação do lado do cliente com o Rebase SDK — login por e-mail/senha, provedores OAuth, gerenciamento de sessões e ouvintes de estado de autenticação.
---

## Visão Geral

O módulo `client.auth` gerencia a autenticação de usuários, o gerenciamento de tokens e a persistência de sessão. Assim que um usuário faz login, todas as requisições de dados subsequentes incluem o JWT automaticamente.

O SDK persiste as sessões no `localStorage` por padrão e renova automaticamente os tokens antes que eles expirem.

:::note[Todo método de login resolve para uma sessão simplificada]
`signInWithEmail`, `signUp` e todos os métodos `signInWith*` retornam **`{ user, accessToken, refreshToken }`** — o SDK já desembrulhou o envelope para você.

A API REST subjacente retorna o token aninhado, como `{ user, tokens: { accessToken, … } }`. Essa diferença só importa se você também chamar `/api/auth/*` diretamente com `fetch`, onde `body.accessToken` é `undefined` e o token está em `body.tokens.accessToken`. Consulte [o formato de transmissão](/docs/backend/auth-endpoints/#response-format).
:::

## E-mail / Senha

### Entrar (Sign In)

```typescript
const { user, accessToken, refreshToken } = await client.auth.signInWithEmail(
    "user@example.com",
    "password"
);
console.log(user.uid, user.email);
```

### Cadastrar-se (Sign Up)

```typescript
const { user, confirmationRequired } = await client.auth.signUp(
    "user@example.com",
    "password",
    "Jane Doe"   // optional displayName
);
```

Com [`requireEmailVerification`](/docs/backend/email-verification/) ativado,
não há sessão até que o endereço seja confirmado: `confirmationRequired` é `true` e `user` é `null`, portanto, avise a pessoa para verificar o e-mail. Caso contrário, `confirmationRequired` é `false` e `user` é a conta autenticada. Na versão 0.23, `signUp` resolve `{ user, accessToken, refreshToken }` e sempre inicia a sessão.

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

## Magic Links

Um link de login de um clique por e-mail. O link é sempre `<base>/auth/magic-link?token=…`, onde `<base>` é o `email.magicLinkUrl` do backend, ou sua base de redefinição de senha (`FRONTEND_URL` no runtime) quando este não estiver configurado. Não há `redirectTo` por requisição. Disponibilize esse caminho no seu frontend e envie o token de volta para trocá-lo por uma sessão. O CMS faz isso, autenticando (passando pela etapa de código quando há um segundo fator); outros frontends precisam de uma landing page.

```typescript
// 1. Ask for the link.
await client.auth.sendMagicLink("user@example.com");

// 2. On the landing page, trade the token for a session.
const token = new URLSearchParams(location.search).get("token")!;
const { user } = await client.auth.verifyMagicLink(token);
```

`sendMagicLink` responde a mesma coisa independentemente de o endereço possuir
uma conta ou não. Isso é intencional: um endpoint que respondesse "usuário inexistente" seria um
oráculo de enumeração de contas; portanto, não use o resultado para informar a alguém se ela está
cadastrada — ele não sabe.

O envio requer um serviço de e-mail configurado no backend, caso contrário
o `sendMagicLink` responderá 503 `EMAIL_NOT_CONFIGURED`.

## Códigos de Uso Único (One-Time Codes)

Um código de seis dígitos por e-mail, para os casos em que um link é inconveniente — um
aplicativo nativo, um segundo dispositivo, um navegador que corrompe links.

```typescript
const { expiresInSeconds } = await client.auth.sendEmailOtp("user@example.com");

// The address goes back with the code, because the code is only valid for it.
const { user } = await client.auth.verifyEmailOtp("user@example.com", "418293");
```

Enviar o endereço junto com o código é o que garante que uma tentativa de adivinhar os seis dígitos
seja direcionada a *uma* conta específica, em vez de a todas as contas de uma só vez.

## Sessões Anônimas

Autentique um visitante sem nenhuma credencial, permitindo que ele comece a usar o app
antes de precisar se cadastrar:

```typescript
const { user } = await client.auth.signInAnonymously();
user.isAnonymous;   // true
```

A conta é real: ela possui um ID, funções e uma sessão, de modo que a segurança em nível de
linha (row-level security) restringe suas linhas exatamente como faria com um usuário cadastrado. O que ela não tem é
uma forma de retorno — ninguém pode fazer login *como* ela uma segunda vez; portanto, tudo o que ela possui é
perdido com a sessão.

`linkAnonymous` é a maneira de torná-la permanente. O usuário **mantém seu ID**, garantindo que
tudo o que ele criou enquanto anônimo continue sendo dele:

```typescript
await client.auth.linkAnonymous("user@example.com", "correct-horse-battery");
```

| Falha | Significado |
|-------|-------------|
| `ANONYMOUS_AUTH_DISABLED` (403) | O backend não habilitou a autenticação anônima ou a desativou desde que este convidado entrou: um convidado só se torna uma conta enquanto `allowAnonymous` estiver ativado |
| `REGISTRATION_DISABLED` (403) | O cadastro está fechado no backend, e transformar-se em uma conta é um cadastro |
| `NOT_ANONYMOUS` (400) | A sessão atual pertence a uma conta comum |
| `EMAIL_EXISTS` (409) | O endereço já possui uma conta — faça login nela em vez disso |

<span class="since-badge" data-since="0.27">Desde a 0.27</span> Um convidado que nunca retorna permanece como uma linha. Um administrador pode
limpá-los com `client.admin.listGuests()`, `client.admin.deleteGuest(uid)` e
`client.admin.deleteGuests({ lastSeenBefore })`, ou no Rebase Cloud com
[`rebase cloud guests`](/docs/cli/cloud/#guests). Estes afetam exclusivamente convidados,
e `deleteGuests` funciona em lotes: repita enquanto `remaining` não for 0, com
`offset` definido para quantos ele já pulou até o momento.

## Vinculando um Provedor a uma Conta Existente

`signInWithGoogle` e métodos semelhantes autenticam o usuário (*sign in*). `linkProvider` vincula uma
identidade de provedor à conta que já está conectada, permitindo que a mesma pessoa possa
retornar por qualquer uma das opções:

```typescript
await client.auth.linkProvider("google", { idToken });
```

A sessão já comprova a posse da conta; portanto, ao contrário do login, isso não
exige que o provedor tenha verificado o e-mail, e os dois endereços não precisam
coincidir. A operação tem êxito de forma idempotente (`alreadyLinked: true`) quando essa identidade já
estiver nesta conta, e recusa com `IDENTITY_ALREADY_LINKED` (409) quando
pertencer a outra conta.

## Buscando um Usuário por E-mail

```typescript
const profile = await client.auth.findUserByEmail("user@example.com");
// { uid, displayName, photoURL } | null
```

Três campos não confidenciais e nada mais — o suficiente para exibir "você está convidando
a Jane" antes de um convite ser enviado. Opcional (opt-in): restrito a chamadores autenticados e resulta em 404
a menos que o backend defina `AUTH_ALLOW_USER_LOOKUP=true` (`auth.allowUserLookup`).

## Autenticação Multifator

Inscrição de um fator, o segundo passo de um login, códigos de recuperação e remoção de um fator: [Autenticação Multifator](/docs/sdk/multi-factor-authentication/).

## Encerrar Sessão (Sign Out)

```typescript
await client.auth.signOut();
```

Isso revoga o refresh token no servidor, limpa a sessão local e emite um evento `SIGNED_OUT`.

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

### Renovar Token (Refresh Token)

A renovação do token ocorre automaticamente, mas você pode acioná-la manualmente:

```typescript
const session = await client.auth.refreshSession();
```

Uma requisição nunca é enviada com um token que o cliente sabe que expirou: as requisições
compartilham uma única renovação e são enviadas uma vez, com o novo token. Um token que o servidor
recusar prematuramente ainda passa por uma renovação e, em seguida, uma nova tentativa por requisição.

## Onde a Sessão Fica: `authFlowMode`

```typescript
const client = createRebaseClient({
    baseUrl: API_URL,
    auth: { authFlowMode: "cookie" }
});
```

| Modo | Onde o refresh token fica | Quando usar |
|------|---------------------------|-------------|
| `"json"` *(padrão)* | Retornado no corpo da resposta, mantido no `localStorage` | Um app nativo, um script, qualquer coisa sem o armazenamento de cookies de um navegador |
| `"cookie"` | Um cookie **HttpOnly** que o backend define | Uma aplicação web no navegador. Scripts em execução na página não podem lê-lo, tornando-o seguro contra XSS |

O modo cookie requer `auth.cookieAuth` no backend, e é o que o template de
frontend gerado utiliza.

## Aguardando a Sessão Ser Restaurada

**Uma sessão restaurada não está disponível na primeira renderização.** O método `getSession()` é
síncrono; portanto, ao carregar a página ele retorna `null` enquanto a restauração ainda está
em andamento — e no modo cookie uma restauração está *sempre* em andamento, porque o refresh
token está em um cookie que a página não pode ler, exigindo que o cliente solicite ao servidor
um novo access token.

Lê-lo de forma síncrona é o que produz uma piscada de desconectado (logged-out flash) a cada recarregamento:

```typescript no-verify
// Wrong: renders the signed-out view for one round trip, every reload.
const session = client.auth.getSession();
if (!session) return <SignIn />;
```

`isInitialized()` resolve assim que o cliente termina a tentativa — tenha ele
encontrado uma sessão ou não:

```typescript
async function currentUser() {
    await client.auth.isInitialized();
    return client.auth.getSession()?.user ?? null;
}
```

No React, isso se resume a um effect:

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

`useRebaseAuthController` no `@rebasepro/app` já faz isso, portanto, um app construído
com o template gerado já obtém isso por padrão. Requisições de dados não precisam esperar: uma requisição feita
no meio da restauração é enviada assim que ela se define — como o usuário restaurado ou anonimamente —,
evitando que a primeira renderização leia uma listagem pública no lugar dos dados do próprio usuário.

Uma restauração que renova o token (um token armazenado expirado ou no modo cookie) chega ao
`onAuthStateChange` como `TOKEN_REFRESHED`; um token armazenado ainda válido é adotado
silenciosamente. Portanto, um listener não pode informar se a restauração terminou: uma inicialização que não emite
nada é indistinguível de uma que ainda está em andamento. Aguarde `isInitialized()`
para responder a essa questão e use o listener para alterações posteriores.

`restoreOutcome()` informa como a restauração terminou, uma vez que `isInitialized()` tenha
resolvido: `"restored"`, `"none"` (nada para restaurar), `"refused"` (o servidor
recusou a sessão) ou `"unreachable"` (o servidor não pôde ser alcançado, de modo
que a sessão não foi confirmada nem recusada). No modo cookie, `"unreachable"`
sem nenhuma sessão é o único caso em que o estado "desconectado" não é garantidamente verdadeiro:

```typescript
await client.auth.isInitialized();
if (!client.auth.getSession() && client.auth.restoreOutcome() === "unreachable") {
    console.log("Offline: could not check the session.");
}
```

## Ouvinte de Estado de Autenticação (Auth State Listener)

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
|--------|--------|
| `SIGNED_IN` | Um login ou cadastro foi concluído |
| `TOKEN_REFRESHED` | O access token foi renovado — incluindo a renovação silenciosa que restaura uma sessão no carregamento da página |
| `USER_UPDATED` | `updateUser()` alterou o perfil, `linkAnonymous()` transformou um convidado em conta, `changeEmail()` iniciou uma alteração de endereço ou `confirmEmailChange()` transferiu esta conta para seu novo endereço |
| `SIGNED_OUT` | Um encerramento de sessão (sign-out), `revokeAllSessions()`, ou uma renovação que falhou em definitivo |

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

Todas as outras sessões da conta são encerradas: qualquer outra pessoa que possuía uma sessão terá que entrar
com a nova senha. Este dispositivo permanece conectado. O servidor responde com
uma nova sessão e o cliente a adota (emitindo `TOKEN_REFRESHED`).

## Verificação de E-mail

O cadastro envia por e-mail o link de verificação para a nova conta quando o serviço de e-mail está
configurado. `sendVerificationEmail()` o envia novamente.

```typescript
// Send verification email to the current user
await client.auth.sendVerificationEmail();

// Verify with the token from the email link. Signed in as that account, this
// keeps everything on it.
const { passwordRemoved } = await client.auth.verifyEmail(token);

// Signed out, an account that holds a password answers PROOF_REQUIRED:
try {
    await client.auth.verifyEmail(token);
} catch (e) {
    if (e instanceof Error && "code" in e && e.code === "PROOF_REQUIRED") {
        // Keep the password, and sign in:
        await client.auth.verifyEmail(token, { password });
        // …or verify without it, which removes it:
        // await client.auth.verifyEmail(token, { removeUnproven: true });
    }
}
```

O link comprova a caixa de entrada, e não quem cadastrou o endereço; portanto, uma senha
que nem a sessão nem a chamada consiga comprovar é removida em vez de mantida — consulte
[Verificação de e-mail](/docs/backend/email-verification/).

Em um backend com `requireEmailVerification`, `signUp()` resolve com
`{ confirmationRequired: true, user: null }` e nenhuma sessão: a conta
é autenticada assim que o link for acessado com sua senha.

## Alterando o Endereço de E-mail

Um usuário autenticado transfere sua própria conta para outro endereço. Nada
é alterado até que o novo endereço responda:

```typescript
// Mails a link to the new address, and a notice to the current one
const { pendingEmail, expiresAt } = await client.auth.changeEmail("jane@new.example");

// On the page the link opens (<frontend>/confirm-email-change?token=…):
const { email, removedProviders } = await client.auth.confirmEmailChange(token);
```

O link é válido por 24 horas; `getUser()` informa o endereço pendente como
`pendingEmail`. A confirmação não necessita de sessão, e um cliente conectado com essa
conta assume o novo endereço e emite `USER_UPDATED`. As recusas estão listadas
em [Alterando um endereço de e-mail](/docs/backend/auth-endpoints/#changing-an-email-address).

## Gerenciamento de Sessões (Multidispositivo)

```typescript
// List all active sessions, one per sign-in
const sessions = await client.auth.getSessions();
// [{ id, userAgent, ipAddress, createdAt, isCurrentSession }, …]

// Revoke a specific session
await client.auth.revokeSession(sessionId);

// Revoke ALL sessions (logs out everywhere)
await client.auth.revokeAllSessions();
```

Cada access token identifica o login ao qual pertence; assim, exatamente uma entrada possui
`isCurrentSession: true`: o dispositivo solicitante. Revogar uma sessão encerra simultaneamente
o refresh token e o access token desse dispositivo a partir da próxima requisição,
tanto via HTTP quanto por um socket realtime aberto. Fazer logout (`signOut()`) faz o
mesmo para o dispositivo que está saindo. Um access token emitido antes desta versão
não identifica nenhuma sessão; ele continua funcionando até expirar, dentro do período de uma hora.

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
//   magicLink: boolean, emailOtp?: boolean,
//   anonymousLogin: boolean, enabledProviders: string[],
//   externalLoginUrl?: string, needsSetup?: boolean, storage?: boolean
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

## Usando seu próprio provedor de autenticação

Na versão 0.24, um getter de token
autentica apenas requisições HTTP, e o socket realtime permanece
anônimo.

Quando os usuários entram usando um provedor próprio (Clerk, Firebase Auth ou uma
sessão que seu app já possui), o `client.auth` não é envolvido. Em vez disso, forneça ao cliente um
getter para o token do provedor. Ele é consultado sempre que um token é
necessário: para cada requisição HTTP e sempre que o socket realtime
autentica.

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: import.meta.env.VITE_API_URL });

client.setAuthTokenGetter(() => clerk.session?.getToken() ?? Promise.resolve(null));

// Optional: let Clerk recover a refused token, on HTTP and the socket alike.
client.setOnUnauthorized(async () => {
    await clerk.session?.reload();
    return true;
});

// The socket authenticates as the Clerk user.
client.data.posts.listen({}, (response) => render(response.data));
```

- O getter tem precedência sobre a própria sessão do cliente. Quando ele responde `null` ou
  lança um erro, o cliente envia o token que possui, se houver: o da sua sessão, um definido
  com `client.setToken()` ou a opção `token`.
- A opção `token` é lida a cada vez que um token é necessário, até que `setToken()` ou
  um login a substitua, podendo ser declarada como um getter
  (`get token() { return currentToken; }`).
- `setOnUnauthorized` cobre erros 401 via HTTP e erros de autenticação no socket,
  substituindo a renovação de sessão nativa do cliente.

O backend precisa verificar o token do provedor: consulte
[Adaptadores de autenticação personalizados](/docs/backend/auth-adapters). No painel de administração, configure
o getter no cliente que você passa para `<Rebase client>`
([Seu Próprio Provedor de Autenticação](/docs/frontend/authentication#your-own-auth-provider)).

## Formato do Objeto de Usuário

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
    pendingEmail?: string | null; // an address change waiting for its link
    roles?: string[];          // text[] from the users table
    metadata?: Record<string, unknown>;
}
```

## Próximos Passos

- **[Consultando Dados](/docs/sdk/querying)** — Operações CRUD e query builder
- **[Assinaturas em Tempo Real](/docs/sdk/realtime)** — Dados ao vivo com WebSockets
- **[Backend de Autenticação](/docs/backend/authentication)** — Configuração de autenticação no servidor
