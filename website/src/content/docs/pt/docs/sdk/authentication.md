---
sourceHash: dfb1bbaa122356f7
title: Autenticação
sidebar_label: Autenticação
description: Autenticação do lado do cliente com o Rebase SDK — login com e-mail/senha, provedores OAuth, gerenciamento de sessão e listeners de estado de autenticação.
---

## Visão Geral

O módulo `client.auth` lida com autenticação de usuário, gerenciamento de tokens e persistência de sessão. Assim que um usuário faz login, todas as requisições de dados subsequentes incluem o JWT automaticamente.

O SDK persiste sessões no `localStorage` por padrão e atualiza tokens automaticamente antes que eles expirem.

:::note[Todo método de login resolve para uma sessão nivelada]
`signInWithEmail`, `signUp` e cada método `signInWith*` retornam **`{ user, accessToken, refreshToken }`** — o SDK já desembrulhou o envelope para você.

A API REST subjacente retorna o token aninhado, como `{ user, tokens: { accessToken, … } }`. Essa diferença só importa se você também chamar `/api/auth/*` diretamente com `fetch`, onde `body.accessToken` é `undefined` e o token está em `body.tokens.accessToken`. Veja [o formato de transmissão](/docs/backend/auth-endpoints/#response-format).
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
não há sessão até que o endereço seja confirmado: `confirmationRequired` é `true` e `user` é `null`, portanto oriente a pessoa a abrir o e-mail. Caso contrário, `confirmationRequired` é `false` e `user` é a conta conectada. Na versão 0.23, `signUp` resolve `{ user, accessToken, refreshToken }` e sempre faz o login.

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

Cada provedor segue o fluxo de authorization code com `(code, redirectUri)` :

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

Em um navegador, `signInWithApplePopup()` abre o popup da Apple, verifica o `state` e
faz login com o código. Chame-o a partir de um manipulador de clique. Chame `preloadAppleSignIn()`
na montagem, porque o Safari bloqueia um popup que espera o download de um script:

```typescript
import { preloadAppleSignIn } from "@rebasepro/client";

void preloadAppleSignIn();                                          // on mount
await client.auth.signInWithApplePopup({ clientId: "com.example.web" }); // on click
```

Sem `clientId`, o SDK lê o Services ID de `/auth/config`, o que
atrasa o popup. O URI de redirecionamento tem como padrão a origem da página mais `/`, e
deve ser uma Return URL no Services ID (HTTPS, nunca `localhost`). Um popup
fechado rejeita com o código `APPLE_SIGN_IN_CANCELLED`.

Um aplicativo nativo de iOS ou macOS envia o authorization code do
login nativo da Apple com seu bundle id. O bundle id deve estar listado em `APPLE_BUNDLE_IDS`:

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

Um link de login de um clique por e-mail. O link é sempre `<base>/auth/magic-link?token=…`, onde `<base>` é o `email.magicLinkUrl` do backend, ou sua base de redefinição de senha (`FRONTEND_URL` no runtime) quando isso não estiver definido. Não há `redirectTo` por requisição. Disponibilize esse caminho no seu frontend e passe o token de volta para trocá-lo por uma sessão. O CMS o disponibiliza, fazendo o login (passando pela etapa de código quando houver um segundo fator); outros frontends precisam de uma landing page.

```typescript
// 1. Ask for the link.
await client.auth.sendMagicLink("user@example.com");

// 2. On the landing page, trade the token for a session.
const token = new URLSearchParams(location.search).get("token")!;
const { user } = await client.auth.verifyMagicLink(token);
```

`sendMagicLink` responde a mesma coisa quer o endereço tenha ou não uma
conta. Isso é deliberado: um endpoint que dissesse "usuário inexistente" seria um oráculo
de enumeração de contas, portanto, não use o resultado para informar a uma pessoa se ela
está registrada — ele não sabe.

O envio requer um serviço de e-mail configurado no backend, caso contrário
`sendMagicLink` responde 503 `EMAIL_NOT_CONFIGURED`.

## Códigos de Uso Único

Um código de seis dígitos por e-mail, para os mesmos casos em que um link é inconveniente — um
aplicativo nativo, um segundo dispositivo, um navegador que corrompe links.

```typescript
const { expiresInSeconds } = await client.auth.sendEmailOtp("user@example.com");

// The address goes back with the code, because the code is only valid for it.
const { user } = await client.auth.verifyEmailOtp("user@example.com", "418293");
```

Enviar o endereço junto com o código é o que garante que a tentativa de adivinhar seis dígitos seja feita
contra *uma* conta, em vez de todas as contas de uma só vez.

## Sessões Anônimas

Autentique um visitante sem nenhuma credencial, para que ele possa começar a usar o aplicativo
antes de ter um motivo para se cadastrar:

```typescript
const { user } = await client.auth.signInAnonymously();
user.isAnonymous;   // true
```

A conta é real: ela possui um id, roles e uma sessão, de modo que a segurança em nível de linha
(row-level security) restringe suas linhas exatamente como faria com um usuário cadastrado. O que ela não possui é
um caminho de volta — ninguém pode fazer login *como* ela uma segunda vez, portanto tudo o que pertence a ela é
perdido com a sessão.

`linkAnonymous` é como ela deixa de ser descartável. O usuário **mantém seu id**, de modo
que tudo o que ele criou enquanto anônimo continua sendo dele:

```typescript
await client.auth.linkAnonymous("user@example.com", "correct-horse-battery");
```

| Falha | Significado |
|---|---|
| `ANONYMOUS_AUTH_DISABLED` (403) | O backend não habilitou a autenticação anônima ou a desativou desde que este convidado fez login: um convidado se torna uma conta apenas enquanto `allowAnonymous` estiver ativado |
| `REGISTRATION_DISABLED` (403) | O cadastro está desativado no backend, e tornar-se uma conta é um cadastro |
| `NOT_ANONYMOUS` (400) | A sessão atual pertence a uma conta comum |
| `EMAIL_EXISTS` (409) | O endereço já possui uma conta — faça login nela em vez disso |

Um convidado que nunca mais retorna permanece como uma linha. Um administrador os
remove com `client.admin.listGuests()`, `client.admin.deleteGuest(uid)` e
`client.admin.deleteGuests({ lastSeenBefore })`, ou no Rebase Cloud com
[`rebase cloud guests`](/docs/cli/cloud/#guests). Eles afetam apenas convidados,
e `deleteGuests` funciona em lotes: repita enquanto `remaining` não for 0, com
`offset` definido para quantos já foram ignorados até o momento.

## Vinculando um Provedor a uma Conta Existente

`signInWithGoogle` e métodos semelhantes autenticam um usuário (*sign in*). `linkProvider` vincula a
identidade de um provedor à conta que já está conectada, para que a mesma pessoa possa
retornar por qualquer uma das opções:

```typescript
await client.auth.linkProvider("google", { idToken });
```

A sessão já comprova a propriedade da conta, portanto, ao contrário do login, isso não
exige que o provedor tenha verificado o e-mail, e os dois endereços não precisam
coincidir. A operação tem sucesso de forma idempotente (`alreadyLinked: true`) quando essa identidade já
está associada a essa conta, e recusa com `IDENTITY_ALREADY_LINKED` (409) quando
pertence a uma conta diferente.

## Consultando um Usuário por E-mail

```typescript
const profile = await client.auth.findUserByEmail("user@example.com");
// { uid, displayName, photoURL } | null
```

Três campos não confidenciais e nada mais — o suficiente para exibir "você está convidando
Jane" antes que um convite seja enviado. Requer ativação: permitido apenas para chamadores autenticados e resulta em 404
a menos que o backend defina `AUTH_ALLOW_USER_LOOKUP=true` (`auth.allowUserLookup`).

## Autenticação Multifator

Registro de um fator, o segundo passo de um login, códigos de recuperação e remoção de um fator: [Autenticação Multifator](/docs/sdk/multi-factor-authentication/).

## Logout

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

**Nunca guarde o objeto de sessão.** `getSession()` é um snapshot. Cada renovação
do access token, aproximadamente uma vez por hora, substitui a sessão por um novo
objeto, portanto, uma sessão mantida desde o carregamento da página carrega um token que o servidor rejeitará
assim que ele expirar, fazendo a aplicação parecer desconectada. Leia a sessão quando precisar
dela.

### Enviar o Token para Suas Próprias Rotas

Chamar uma função em `backend/functions/` não requer manipulação de tokens:
`client.functions.invoke` renova o token antes do envio e tenta novamente uma vez
em caso de 401.

```typescript
const saved = await client.functions.invoke("progress", { level: 3 }, { path: "save" });
```

Para qualquer outra requisição, solicite o token a cada chamada com `getAccessToken()`.
Ele renova um token que expirou ou está prestes a expirar, aguarda a sessão
restaurada no carregamento e retorna `null` quando ninguém estiver conectado.

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

A atualização do token acontece automaticamente, mas você pode acioná-la manualmente:

```typescript
const session = await client.auth.refreshSession();
```

Uma requisição nunca é enviada com um token que o cliente sabe que expirou: requisições
compartilham uma única atualização e são enviadas uma vez, com o novo token. Um token que o servidor
rejeita antecipadamente ainda recebe uma atualização e depois uma nova tentativa por requisição.

## Onde a Sessão Fica Armazenada: `authFlowMode`

```typescript
const client = createRebaseClient({
    baseUrl: API_URL,
    auth: { authFlowMode: "cookie" }
});
```

| Modo | Onde o refresh token fica | Padrão |
|---|---|---|
| `"cookie"` | Um cookie **HttpOnly** que o backend define. Scripts em execução na sua página não podem lê-lo, o que o torna protegido contra XSS | No navegador |
| `"json"` | Retornado no corpo da resposta, mantido em `storage` (`localStorage` por padrão) | Fora do navegador (Node, workers, React Native) e no navegador quando você passa seu próprio `storage` |

Os dois lados precisam concordar. O modo cookie requer `auth.cookieAuth` no
backend, e o runtime do Rebase, executado pelo Rebase Cloud, sempre o ativa.
O modo json requer um backend sem isso: contra um backend com `cookieAuth`, um cliente
json não recebe nenhum refresh token e sua sessão termina quando o access token
expira, cerca de uma hora após o login. Quando a resposta de um login mostra
divergência de modos, o cliente registra um erro indicando qual modo usar.

Passar seu próprio `storage` mantém o cliente no navegador em modo json. Isso serve para um
segundo cliente na página que mantém seu próprio login separado do
cookie da página: no modo cookie, nada seria mantido nesse storage.

## Aguardando a Restauração da Sessão

**Uma sessão restaurada não está disponível na primeira renderização.** `getSession()` é
síncrono, portanto, no carregamento da página ele retorna `null` enquanto a restauração ainda está
em andamento — e no modo cookie uma restauração está *sempre* em andamento, porque o refresh
token está em um cookie que a página não consegue ler, logo o cliente precisa solicitar ao servidor
um novo access token.

Lê-lo de forma síncrona é o que produz um flash de "desconectado" a cada recarregamento:

```typescript no-verify
// Wrong: renders the signed-out view for one round trip, every reload.
const session = client.auth.getSession();
if (!session) return <SignIn />;
```

`isInitialized()` resolve assim que o cliente termina a tentativa — quer
tenha encontrado uma sessão ou não:

```typescript
async function currentUser() {
    await client.auth.isInitialized();
    return client.auth.getSession()?.user ?? null;
}
```

No React, isso se resume a um efeito:

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

`useRebaseAuthController` no `@rebasepro/app` já faz isso, portanto um aplicativo construído
sobre o template gerado obtém esse comportamento gratuitamente. Requisições de dados não precisam esperar: uma requisição feita
no meio da restauração é enviada assim que ela se estabiliza — como o usuário restaurado, ou anonimamente — para que uma
primeira renderização nunca leia uma listagem pública no lugar dos dados do próprio usuário.

Uma restauração que faz refresh (um token armazenado expirado ou no modo cookie) chega ao
`onAuthStateChange` como `TOKEN_REFRESHED`; um token armazenado que ainda seja válido é adotado
silenciosamente. Portanto, um listener não pode avisar se a restauração terminou: uma inicialização que não
emite nada é indistinguível de uma ainda em andamento. Aguarde (`await`) `isInitialized()`
para responder a essa questão e use o listener para alterações posteriores a ela.

`restoreOutcome()` informa como a restauração terminou, após `isInitialized()` ter
sido resolvido: `"restored"`, `"none"` (nada a restaurar), `"refused"` (o servidor
recusou a sessão) ou `"unreachable"` (o servidor não pôde ser alcançado, portanto
a sessão não foi confirmada nem recusada). No modo cookie, `"unreachable"`
sem sessão é o único caso em que o estado "desconectado" não é garantidamente verdadeiro:

```typescript
await client.auth.isInitialized();
if (!client.auth.getSession() && client.auth.restoreOutcome() === "unreachable") {
    console.log("Offline: could not check the session.");
}
```

## Listener de Estado de Autenticação

Reaja a mudanças de autenticação em toda a sua aplicação:

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
|---|---|
| `SIGNED_IN` | Um login ou cadastro foi concluído |
| `TOKEN_REFRESHED` | O access token foi renovado — incluindo a renovação silenciosa que restaura uma sessão no carregamento da página |
| `USER_UPDATED` | `updateUser()` alterou o perfil, `linkAnonymous()` converteu um convidado em conta, `changeEmail()` iniciou uma alteração de endereço ou `confirmEmailChange()` migrou esta conta para o novo endereço |
| `SIGNED_OUT` | Um logout, `revokeAllSessions()` ou uma atualização que falhou em definitivo |

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

Todas as outras sessões da conta são encerradas: qualquer outra pessoa com uma sessão ativa precisará fazer login
com a nova senha. Este dispositivo permanece conectado. O servidor responde com uma
nova sessão e o cliente a adota (emitindo `TOKEN_REFRESHED`).

## Verificação de E-mail

O cadastro envia por e-mail à nova conta o link de verificação quando o e-mail está
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

O link comprova a caixa de entrada, não quem registrou o endereço; portanto, uma senha
que nem a sessão nem a chamada comprovem é removida em vez de mantida — veja
[Verificação de e-mail](/docs/backend/email-verification/).

Em um backend com `requireEmailVerification`, `signUp()` resolve com
`{ confirmationRequired: true, user: null }` e sem sessão: a conta
faz login assim que o link é acessado com a sua senha.

## Alterando o Endereço de E-mail

Um usuário conectado transfere sua própria conta para outro endereço. Nada
muda até que o novo endereço responda:

```typescript
// Mails a link to the new address, and a notice to the current one
const { pendingEmail, expiresAt } = await client.auth.changeEmail("jane@new.example");

// On the page the link opens (<frontend>/confirm-email-change?token=…):
const { email, removedProviders } = await client.auth.confirmEmailChange(token);
```

O link expira em 24 horas; `getUser()` reporta o endereço pendente como
`pendingEmail`. A confirmação não precisa de sessão, e um cliente conectado como essa
conta assume o novo endereço e emite `USER_UPDATED`. As recusas estão listadas
em [Alterando um endereço de e-mail](/docs/backend/auth-endpoints/#changing-an-email-address).

## Gerenciamento de Sessão (Multi-Dispositivo)

```typescript
// List all active sessions, one per sign-in
const sessions = await client.auth.getSessions();
// [{ id, userAgent, ipAddress, createdAt, isCurrentSession }, …]

// Revoke a specific session
await client.auth.revokeSession(sessionId);

// Revoke ALL sessions (logs out everywhere)
await client.auth.revokeAllSessions();
```

Cada access token identifica o login ao qual pertence; portanto, exatamente uma entrada possui
`isCurrentSession: true`: o dispositivo solicitante. Revogar uma sessão encerra simultaneamente o
refresh token e o access token daquele dispositivo, a partir da próxima requisição,
via HTTP e por um socket realtime aberto. Fazer logout (`signOut()`) faz
o mesmo para o dispositivo que realiza a ação. Um access token emitido antes desta versão
não identifica nenhuma sessão; ele continua funcionando até expirar, dentro de uma hora.

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

Clerk, Firebase Auth ou uma sessão que sua aplicação já possui, usando um getter de token
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

- **[Consultando Dados](/docs/sdk/querying)** — Operações de CRUD e query builder
- **[Assinaturas em Tempo Real](/docs/sdk/realtime)** — Dados em tempo real com WebSockets
- **[Backend de Autenticação](/docs/backend/authentication)** — Configuração de autenticação no servidor
