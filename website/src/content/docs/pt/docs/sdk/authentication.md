---
sourceHash: 468b0d48039a8127
title: Autenticação
sidebar_label: Autenticação
description: Autenticação no lado do cliente com o Rebase SDK — login com e-mail/senha, provedores OAuth, gerenciamento de sessão e listeners de estado de autenticação.
---

## Visão Geral

O módulo `client.auth` gerencia a autenticação do usuário, o gerenciamento de tokens e a persistência de sessões. Assim que um usuário faz login, todas as requisições de dados subsequentes incluem automaticamente o JWT.

O SDK persiste sessões no `localStorage` por padrão e atualiza automaticamente os tokens antes que expirem.

:::note[Todo método de login resolve para uma sessão simplificada]
`signInWithEmail`, `signUp` e todos os métodos `signInWith*` retornam **`{ user, accessToken, refreshToken }`** — o SDK já desempacotou o envelope para você.

A API REST por baixo retorna o token aninhado, como `{ user, tokens: { accessToken, … } }`. Essa diferença só importa se você também chamar `/api/auth/*` diretamente com `fetch`, onde `body.accessToken` é `undefined` e o token está em `body.tokens.accessToken`. Consulte [o formato de transmissão](/docs/backend/auth-endpoints/#response-format).
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
const { user, confirmationRequired } = await client.auth.signUp(
    "user@example.com",
    "password",
    "Jane Doe"   // optional displayName
);
```

Com o [`requireEmailVerification`](/docs/backend/email-verification/) ativado,
não há sessão até que o endereço seja confirmado: `confirmationRequired` é `true` e `user` é `null`, portanto, instrua a pessoa a abrir o e-mail. Caso contrário, `confirmationRequired` é `false` e `user` é a conta autenticada. Na versão 0.23, `signUp` resolve `{ user, accessToken, refreshToken }` e sempre realiza o login.

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

O Twitter também exige o code verifier do PKCE:

```typescript
await client.auth.signInWithTwitter(code, redirectUri, codeVerifier);
```

### Apple

No navegador, `signInWithApplePopup()` abre o pop-up da Apple, verifica o `state` e
faz login com o código. Chame-o a partir de um manipulador de clique. Chame `preloadAppleSignIn()`
na montagem do componente, pois o Safari bloqueia pop-ups que aguardam o download de um script:

```typescript
import { preloadAppleSignIn } from "@rebasepro/client";

void preloadAppleSignIn();                                          // on mount
await client.auth.signInWithApplePopup({ clientId: "com.example.web" }); // on click
```

Sem o `clientId`, o SDK lê o Services ID de `/auth/config`, o que
atrasa o pop-up. O URI de redirecionamento assume como padrão a origem da página mais `/`, e ele
deve ser uma Return URL no Services ID (HTTPS, nunca `localhost`). Um pop-up fechado
rejeita com o código `APPLE_SIGN_IN_CANCELLED`.

Um aplicativo nativo para iOS ou macOS envia o código de autorização do login nativo da Apple
com seu bundle id. O bundle id deve estar listado em `APPLE_BUNDLE_IDS`:

```typescript
await client.auth.signInWithApple({
    code: credential.authorizationCode,
    bundleId: "com.example.ios",
    user: { name: { firstName: "Jane" } } // sent by Apple on the first sign-in only
});
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

Um link de login de um clique por e-mail. O link é sempre `<base>/auth/magic-link?token=…`, onde `<base>` é o `email.magicLinkUrl` do backend, ou sua base de redefinição de senha (`FRONTEND_URL` no runtime) quando este não estiver configurado. Não há um `redirectTo` por requisição. Disponibilize esse caminho no seu frontend e envie o token de volta para trocá-lo por uma sessão. O CMS faz isso, realizando o login (passando pela etapa de código quando há um segundo fator); outros frontends precisam de uma landing page.

```typescript
// 1. Ask for the link.
await client.auth.sendMagicLink("user@example.com");

// 2. On the landing page, trade the token for a session.
const token = new URLSearchParams(location.search).get("token")!;
const { user } = await client.auth.verifyMagicLink(token);
```

O `sendMagicLink` responde a mesma coisa independentemente de o endereço possuir ou não
uma conta. Isso é intencional: um endpoint que respondesse "usuário inexistente" seria um oráculo
para enumeração de contas, portanto, não use o resultado para informar à pessoa se ela está
registrada — ele não sabe.

O envio requer um serviço de e-mail configurado no backend, caso contrário
o `sendMagicLink` responde com 503 `EMAIL_NOT_CONFIGURED`.

## Códigos de Uso Único

Um código de seis dígitos por e-mail, para os mesmos casos em que um link é inconveniente — um
aplicativo nativo, um segundo dispositivo, um navegador que corrompe links.

```typescript
const { expiresInSeconds } = await client.auth.sendEmailOtp("user@example.com");

// The address goes back with the code, because the code is only valid for it.
const { user } = await client.auth.verifyEmailOtp("user@example.com", "418293");
```

Enviar o endereço junto com o código é o que garante que a tentativa de adivinhar os seis dígitos
seja restrita a *uma* conta, em vez de atingir todas as contas de uma só vez.

## Sessões Anônimas

Autentique um visitante sem nenhuma credencial, para que ele possa começar a usar o aplicativo
antes de ter um motivo para se cadastrar:

```typescript
const { user } = await client.auth.signInAnonymously();
user.isAnonymous;   // true
```

A conta é real: ela possui um id, papéis e uma sessão, de modo que a segurança em nível de linha
restringe suas linhas exatamente como faria com um usuário cadastrado. O que ela não tem é
uma forma de retorno — ninguém pode fazer login *como* ela uma segunda vez, então tudo o que ela
possui é perdido com a sessão.

`linkAnonymous` é como ela deixa de ser descartável. O usuário **mantém seu id**, garantindo que
tudo o que ele criou enquanto anônimo continue sendo dele:

```typescript
await client.auth.linkAnonymous("user@example.com", "correct-horse-battery");
```

| Falha | Significado |
|-------|-------------|
| `ANONYMOUS_AUTH_DISABLED` (403) | O backend não habilitou a autenticação anônima ou a desativou após a entrada deste convidado: um convidado só se torna uma conta enquanto `allowAnonymous` estiver ativado |
| `REGISTRATION_DISABLED` (403) | O cadastro está desativado no backend, e transformar-se em uma conta é um cadastro |
| `NOT_ANONYMOUS` (400) | A sessão atual pertence a uma conta comum |
| `EMAIL_EXISTS` (409) | O endereço já possui uma conta — faça login nela |

Um convidado que nunca mais retorna permanece como uma linha no banco. Um administrador pode
removê-los com `client.admin.listGuests()`, `client.admin.deleteGuest(uid)` e
`client.admin.deleteGuests({ lastSeenBefore })`, ou no Rebase Cloud com
[`rebase cloud guests`](/docs/cli/cloud/#guests). Estes métodos afetam apenas convidados,
e `deleteGuests` opera em lotes: repita-o enquanto `remaining` for diferente de 0, com
`offset` definido para a quantidade já ignorada até então.

## Vinculando um Provedor a uma Conta Existente

`signInWithGoogle` e métodos similares realizam o *login* do usuário. `linkProvider` vincula a
identidade de um provedor à conta que já está autenticada, para que a mesma pessoa possa retornar
por qualquer uma das opções:

```typescript
await client.auth.linkProvider("google", { idToken });
```

A sessão já comprova a posse da conta, portanto, ao contrário do login, isso não
exige que o provedor tenha verificado o e-mail, e os dois endereços não precisam
coincidir. A operação é bem-sucedida de forma idempotente (`alreadyLinked: true`) quando essa identidade já
está associada a esta conta, e recusa com `IDENTITY_ALREADY_LINKED` (409) quando
pertence a uma conta diferente.

## Buscando um Usuário por E-mail

```typescript
const profile = await client.auth.findUserByEmail("user@example.com");
// { uid, displayName, photoURL } | null
```

Três campos não confidenciais e nada mais — o suficiente para exibir "você está convidando
Jane" antes do envio do convite. Opcional: disponível apenas para chamadores autenticados e retorna 404,
a menos que o backend defina `AUTH_ALLOW_USER_LOOKUP=true` (`auth.allowUserLookup`).

## Autenticação Multifator

Registro de um fator, a segunda etapa de um login, códigos de recuperação e remoção de um fator: [Autenticação Multifator](/docs/sdk/multi-factor-authentication/).

## Logout

```typescript
await client.auth.signOut();
```

Isso revoga o token de atualização no servidor, limpa a sessão local e emite um evento `SIGNED_OUT`.

## Gerenciamento de Sessão

### Obter Sessão Atual

```typescript
const session = client.auth.getSession();
// { accessToken, refreshToken, expiresAt, user } | null
```

**Nunca armazene o objeto de sessão.** `getSession()` é um snapshot. Cada renovação
do token de acesso, aproximadamente uma vez por hora, substitui a sessão por um novo
objeto. Portanto, uma sessão mantida desde o carregamento da página carregará um token que o servidor recusa
assim que expirar, e a aplicação parecerá desconectada. Leia a sessão somente quando precisar
dela.

### Enviar o Token para Suas Próprias Rotas

Chamar uma função em `backend/functions/` não exige manipulação de token:
`client.functions.invoke` renova o token antes do envio e tenta novamente uma vez em
caso de erro 401.

```typescript
const saved = await client.functions.invoke("progress", { level: 3 }, { path: "save" });
```

Para qualquer outra requisição, solicite o token a cada chamada com `getAccessToken()`.
Ele renova um token que expirou ou está prestes a expirar, aguarda a restauração da sessão
no carregamento e retorna `null` quando ninguém estiver autenticado.

```typescript
const token = await client.auth.getAccessToken();
await fetch("https://other.example.com/upload", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: file
});
```

### Obter Usuário Atual (Verificado pelo Servidor)

```typescript
const user = await client.auth.getUser();
// Fetches the user from the backend (GET /auth/me)
```

### Atualizar Perfil do Usuário

```typescript
const updatedUser = await client.auth.updateUser({
    displayName: "Jane Doe",
    photoURL: "https://example.com/avatar.jpg"
});
```

### Atualizar Token (Refresh Token)

A atualização do token ocorre automaticamente, mas você pode dispará-la manualmente:

```typescript
const session = await client.auth.refreshSession();
```

Uma requisição nunca é enviada com um token que o cliente sabe estar expirado: as requisições
compartilham uma única atualização e são enviadas uma vez, com o novo token. Um token que o servidor
recusa antecipadamente ainda recebe uma atualização e, em seguida, uma nova tentativa por requisição.

## Onde a Sessão Fica Armazenada: `authFlowMode`

```typescript
const client = createRebaseClient({
    baseUrl: API_URL,
    auth: { authFlowMode: "cookie" }
});
```

| Modo | Onde o refresh token fica | Padrão |
|------|---------------------------|--------|
| `"cookie"` | Um cookie **HttpOnly** definido pelo backend. Scripts executados na sua página não podem lê-lo, tornando-o protegido contra XSS | No navegador |
| `"json"` | Retornado no corpo da resposta, mantido no `storage` (`localStorage` por padrão) | Fora do navegador (Node, workers, React Native) e no navegador quando você passa seu próprio `storage` |

O modo de cookie requer `auth.cookieAuth` no backend, o qual o runtime do Rebase —
e, portanto, o Rebase Cloud — sempre ativa. O modo JSON funciona com ambos: suas requisições
de autenticação incluem `x-rebase-auth-flow: json`, e o backend as responde com o
refresh token no corpo. Um backend mais antigo não entrega nenhum refresh token a um cliente
JSON, de modo que sua sessão termina cerca de uma hora após o login, e o cliente registra
nos logs qual modo usar (a menos que tenha passado seu próprio `storage`).

Passar seu próprio `storage` mantém um cliente de navegador no modo JSON, ideal para um segundo
cliente que mantém seu próprio login separado do cookie da página, como uma conta de convidado
ao lado da conta autenticada. Seu refresh token fica nesse storage, onde scripts da página podem
lê-lo, portanto mantenha a conta principal da página no modo de cookie.

## Aguardando a Restauração da Sessão

**Uma sessão restaurada não fica disponível na primeira renderização.** O método `getSession()` é
síncrono, portanto, no carregamento da página ele retorna `null` enquanto a restauração ainda está
em andamento — e no modo de cookie uma restauração *sempre* está em andamento, pois o token de
atualização está em um cookie que a página não consegue ler, exigindo que o cliente solicite ao servidor
um novo token de acesso.

Lê-lo de forma síncrona é o que gera um flash de estado deslogado a cada recarregamento:

```typescript no-verify
// Wrong: renders the signed-out view for one round trip, every reload.
const session = client.auth.getSession();
if (!session) return <SignIn />;
```

`isInitialized()` resolve quando o cliente termina a tentativa — quer tenha
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

O hook `useRebaseAuthController` em `@rebasepro/app` já faz isso, portanto, um aplicativo construído
sobre o template gerado obtém esse comportamento automaticamente. Requisições de dados não precisam esperar: uma
requisição feita no meio da restauração é enviada assim que ela se estabiliza — como o usuário restaurado ou
anonimamente —, garantindo que uma primeira renderização nunca leia uma listagem pública no lugar dos dados do próprio usuário.

Uma restauração que faz refresh (um token armazenado expirado ou no modo de cookie) alcança o
`onAuthStateChange` como `TOKEN_REFRESHED`; um token armazenado ainda válido é adotado
silenciosamente. Por isso, um listener não pode informar quando a restauração terminou: uma inicialização que não
emite nada é indistinguível de uma ainda em andamento. Aguarde com `await isInitialized()`
para essa finalidade e use o listener para alterações posteriores.

`restoreOutcome()` informa como a restauração terminou, uma vez que `isInitialized()` tenha
sido resolvido: `"restored"`, `"none"` (nada para restaurar), `"refused"` (o servidor
recusou a sessão) ou `"unreachable"` (o servidor não pôde ser alcançado, portanto a
sessão não foi nem confirmada nem recusada). No modo de cookie, `"unreachable"`
sem sessão é o único caso em que o estado "desconectado" não é garantidamente verdadeiro:

```typescript
await client.auth.isInitialized();
if (!client.auth.getSession() && client.auth.restoreOutcome() === "unreachable") {
    console.log("Offline: could not check the session.");
}
```

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
|--------|--------|
| `SIGNED_IN` | Um login ou cadastro foi concluído |
| `TOKEN_REFRESHED` | O token de acesso foi renovado — incluindo a renovação silenciosa que restaura uma sessão no carregamento da página |
| `USER_UPDATED` | `updateUser()` alterou o perfil, `linkAnonymous()` converteu um convidado em conta, `changeEmail()` iniciou uma alteração de endereço ou `confirmEmailChange()` migrou esta conta para seu novo endereço |
| `SIGNED_OUT` | Um logout, `revokeAllSessions()` ou uma atualização de token que falhou definitivamente |

## Gerenciamento de Senha

### Esqueci Minha Senha

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

Todas as outras sessões da conta são encerradas: qualquer outra pessoa ou dispositivo conectado precisará fazer
login com a nova senha. Este dispositivo permanece conectado. O servidor responde com uma nova
sessão, e o cliente a adota (emitindo `TOKEN_REFRESHED`).

## Verificação de E-mail

O cadastro envia à nova conta seu link de verificação quando o serviço de e-mail estiver
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

O link comprova o acesso à caixa de entrada, e não quem cadastrou o endereço; portanto, uma senha
que nem a sessão nem a chamada conseguem comprovar é removida em vez de mantida — consulte
[Verificação de e-mail](/docs/backend/email-verification/).

Em um backend com `requireEmailVerification`, `signUp()` resolve com
`{ confirmationRequired: true, user: null }` e sem sessão: a conta é
autenticada assim que o link for acessado com a sua senha.

## Alterando o Endereço de E-mail

Um usuário autenticado transfere sua própria conta para outro endereço. Nada
é alterado até que o novo endereço confirme:

```typescript
// Mails a link to the new address, and a notice to the current one
const { pendingEmail, expiresAt } = await client.auth.changeEmail("jane@new.example");

// On the page the link opens (<frontend>/confirm-email-change?token=…):
const { email, removedProviders } = await client.auth.confirmEmailChange(token);
```

O link é válido por 24 horas; `getUser()` informa o endereço pendente como
`pendingEmail`. A confirmação não exige uma sessão, e um cliente autenticado como essa
conta assume o novo endereço e emite `USER_UPDATED`. Os motivos de recusa estão listados
em [Alterando um endereço de e-mail](/docs/backend/auth-endpoints/#changing-an-email-address).

## Gerenciamento de Sessão (Múltiplos Dispositivos)

```typescript
// List all active sessions, one per sign-in
const sessions = await client.auth.getSessions();
// [{ id, userAgent, ipAddress, createdAt, isCurrentSession }, …]

// Revoke a specific session
await client.auth.revokeSession(sessionId);

// Revoke ALL sessions (logs out everywhere)
await client.auth.revokeAllSessions();
```

Cada token de acesso especifica a qual login pertence, de modo que exatamente uma entrada possui
`isCurrentSession: true`: o dispositivo que faz a requisição. Revogar uma sessão encerra simultaneamente o
token de atualização e o token de acesso daquele dispositivo a partir da próxima requisição,
tanto via HTTP quanto por um socket realtime aberto. O logout (`signOut()`) faz o
mesmo para o dispositivo que sai. Um token de acesso emitido antes desta versão
não possui sessão associada; ele continuará funcionando até expirar, dentro de uma hora.

## Configuração de Autenticação

Consulte as configurações de autenticação do backend:

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
//   providerClientIds?: Record<string, string>,   // public ids, e.g. { apple: Services ID }
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

Clerk, Firebase Auth ou uma sessão que sua aplicação já possui, usando um capturador de token
em vez de `client.auth`: [Seu Próprio Provedor de Autenticação](/docs/sdk/your-own-auth-provider/).

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
    pendingEmail?: string | null; // an address change waiting for its link
    roles?: string[];          // text[] from the users table
    metadata?: Record<string, unknown>;
}
```

## Próximos Passos

- **[Consultando Dados](/docs/sdk/querying)** — Operações CRUD e construtor de consultas
- **[Assinaturas em Tempo Real](/docs/sdk/realtime)** — Dados em tempo real com WebSockets
- **[Backend de Autenticação](/docs/backend/authentication)** — Configuração de autenticação no servidor
