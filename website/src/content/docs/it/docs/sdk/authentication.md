---
sourceHash: 65085708df65a92e
title: Autenticazione
sidebar_label: Autenticazione
description: Autenticazione lato client con l'SDK di Rebase — accesso con email/password, provider OAuth, gestione delle sessioni e listener dello stato di autenticazione.
---

## Panoramica

Il modulo `client.auth` gestisce l'autenticazione degli utenti, la gestione dei token e la persistenza delle sessioni. Una volta che un utente ha effettuato l'accesso, tutte le richieste di dati successive includono automaticamente il JWT.

L'SDK rende persistenti le sessioni in `localStorage` per impostazione predefinita e aggiorna automaticamente i token prima della loro scadenza.

:::note[Ogni metodo di accesso restituisce una sessione appiattita]
`signInWithEmail`, `signUp` e ogni metodo `signInWith*` restituiscono
**`{ user, accessToken, refreshToken }`** — l'SDK ha già scartato l'involucro
per te.

L'API REST sottostante restituisce invece il token nidificato, come
`{ user, tokens: { accessToken, … } }`. Questa differenza ha importanza solo se
chiami direttamente anche `/api/auth/*` con `fetch`, dove `body.accessToken` è `undefined`
e il token si trova in `body.tokens.accessToken`. Consulta
[il wire format](/docs/backend/auth-endpoints/#response-format).
:::

## Email / Password

### Accesso

```typescript
const { user, accessToken, refreshToken } = await client.auth.signInWithEmail(
    "user@example.com",
    "password"
);
console.log(user.uid, user.email);
```

### Registrazione

```typescript
const { user, confirmationRequired } = await client.auth.signUp(
    "user@example.com",
    "password",
    "Jane Doe"   // optional displayName
);
```

Con [`requireEmailVerification`](/docs/backend/email-verification/) attivo,
non esiste alcuna sessione finché l'indirizzo non viene confermato:
`confirmationRequired` è `true` e `user` è `null`, quindi avvisa la persona di
aprire l'email. Altrimenti `confirmationRequired` è `false` e `user` è
l'account autenticato. Sulla 0.23 `signUp` risolve
`{ user, accessToken, refreshToken }` ed effettua sempre l'accesso.

## Provider OAuth

L'SDK include metodi dedicati per i provider OAuth più diffusi, oltre a un metodo generico `signInWithOAuth()` per qualsiasi provider personalizzato.

### Google

Supporta tre stili di invocazione:

```typescript
// ID-token flow (One Tap / Sign In With Google button)
await client.auth.signInWithGoogle({ idToken: googleIdToken });

// Access-token flow (popup)
await client.auth.signInWithGoogle({ accessToken: googleAccessToken });

// Authorization code flow (most secure, server-side exchange)
await client.auth.signInWithGoogle({ code: authCode, redirectUri: "https://..." });
```

### Altri provider

Ogni provider segue il flusso del codice di autorizzazione con `(code, redirectUri)`:

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

Apple e Twitter richiedono parametri aggiuntivi:

```typescript
// Apple — optional user info from first sign-in
await client.auth.signInWithApple(code, redirectUri, {
    name: { firstName: "Jane", lastName: "Doe" },
    email: "jane@example.com"
});

// Twitter — requires PKCE code verifier
await client.auth.signInWithTwitter(code, redirectUri, codeVerifier);
```

### OAuth generico

Per qualsiasi provider registrato sul backend:

```typescript
await client.auth.signInWithOAuth("custom-provider", {
    code: authCode,
    redirectUri: "https://myapp.com/callback"
});
```

## Magic Link

Un link di accesso con un clic inviato via email. Il link è sempre
`<base>/auth/magic-link?token=…`, dove `<base>` è `email.magicLinkUrl` del
backend, oppure la sua base per il reset della password (`FRONTEND_URL` sul
runtime) quando quella non è impostata. Non esiste un `redirectTo` per singola
richiesta. Servi quel percorso nel tuo frontend, e restituisci il token per
scambiarlo con una sessione. Il CMS lo serve, effettuando l'accesso (tramite il
passaggio del codice quando è presente un secondo fattore); altri frontend
hanno bisogno di una pagina di destinazione propria.

```typescript
// 1. Ask for the link.
await client.auth.sendMagicLink("user@example.com");

// 2. On the landing page, trade the token for a session.
const token = new URLSearchParams(location.search).get("token")!;
const { user } = await client.auth.verifyMagicLink(token);
```

`sendMagicLink` risponde allo stesso modo indipendentemente dal fatto che l'indirizzo abbia o meno un account. Questo è intenzionale: un endpoint che rispondesse "nessun utente trovato" costituirebbe un oracolo per l'enumerazione degli account, quindi non usare il risultato per comunicare a una persona se è registrata o meno — non è possibile saperlo.

Entrambi richiedono un servizio email configurato sul backend, altrimenti restituiscono 503 `EMAIL_NOT_CONFIGURED`.

## Codici monouso

Un codice a sei cifre inviato via email, ideale per i casi in cui l'uso di un link risulta disagevole — un'app nativa, un secondo dispositivo, un browser che altera i link.

```typescript
const { expiresInSeconds } = await client.auth.sendEmailOtp("user@example.com");

// The address goes back with the code, because the code is only valid for it.
const { user } = await client.auth.verifyEmailOtp("user@example.com", "418293");
```

L'invio dell'indirizzo insieme al codice è ciò che limita il tentativo di indovinare le sei cifre a *un solo* account, anziché a tutti gli account contemporaneamente.

## Sessioni anonime

Consente a un visitatore di accedere senza credenziali, così da poter iniziare a utilizzare l'app prima ancora di avere un motivo per registrarsi:

```typescript
const { user } = await client.auth.signInAnonymously();
user.isAnonymous;   // true
```

L'account è reale: possiede un ID, ruoli e una sessione, quindi la sicurezza a livello di riga (row-level security) limita l'accesso alle sue righe esattamente come farebbe per un utente registrato. Ciò che non possiede è un modo per tornare indietro — nessuno può accedere nuovamente *con quell'identità*, quindi tutto ciò che possiede va perso con la sessione.

`linkAnonymous` è il modo per non renderlo usa e getta. L'utente **mantiene il proprio ID**, quindi tutto ciò che ha creato da anonimo rimane di sua proprietà:

```typescript
await client.auth.linkAnonymous("user@example.com", "correct-horse-battery");
```

| Errore | Significato |
|--------|-------------|
| `ANONYMOUS_AUTH_DISABLED` (403) | Il backend non ha abilitato l'autenticazione anonima, oppure l'ha disattivata dopo l'accesso di questo guest: un guest diventa un account solo finché `allowAnonymous` è attivo |
| `REGISTRATION_DISABLED` (403) | La registrazione è chiusa sul backend, e diventare un account è una registrazione |
| `NOT_ANONYMOUS` (400) | La sessione corrente appartiene a un account ordinario |
| `EMAIL_EXISTS` (409) | L'indirizzo ha già un account — accedi invece a quello |

## Collegamento di un provider a un account esistente

`signInWithGoogle` e metodi simili fanno *accedere* un utente. `linkProvider` associa un'identità del provider all'account attualmente connesso, in modo che la stessa persona possa rientrare da entrambi gli accessi:

```typescript
await client.auth.linkProvider("google", { idToken });
```

La sessione dimostra già la proprietà dell'account, quindi, a differenza dell'accesso, questo non richiede che il provider abbia verificato l'email e i due indirizzi non devono necessariamente coincidere. Ha successo in modo idempotente (`alreadyLinked: true`) quando quell'identità è già associata a questo account, e rifiuta con `IDENTITY_ALREADY_LINKED` (409) quando appartiene a un account diverso.

## Ricerca di un utente tramite email

```typescript
const profile = await client.auth.findUserByEmail("user@example.com");
// { uid, displayName, photoURL } | null
```

Tre campi non sensibili e nient'altro — sufficienti per mostrare "stai invitando Jane" prima che venga inviato un invito. Opt-in: solo per un chiamante autenticato, e un 404
a meno che il backend imposti `AUTH_ALLOW_USER_LOOKUP=true` (`auth.allowUserLookup`).

## Autenticazione a più fattori (MFA)

Registrare un fattore, il secondo passo dell'accesso, i codici di recupero e la rimozione di un fattore: [Autenticazione a più fattori](/docs/sdk/multi-factor-authentication/).

## Disconnessione

```typescript
await client.auth.signOut();
```

Questo revoca il refresh token sul server, cancella la sessione locale ed emette un evento `SIGNED_OUT`.

## Gestione della sessione

### Ottenere la sessione corrente

```typescript
const session = client.auth.getSession();
// { accessToken, refreshToken, expiresAt, user } | null
```

### Ottenere l'utente corrente (verificato dal server)

```typescript
const user = await client.auth.getUser();
// Fetches the user from the backend (GET /auth/me)
```

### Aggiornare il profilo utente

```typescript
const updatedUser = await client.auth.updateUser({
    displayName: "Jane Doe",
    photoURL: "https://example.com/avatar.jpg"
});
```

### Aggiornare il token

L'aggiornamento del token avviene automaticamente, ma puoi avviarlo manualmente:

```typescript
const session = await client.auth.refreshSession();
```

Una richiesta non parte mai con un token che il client sa essere scaduto: le richieste condividono un
unico refresh e vengono inviate una sola volta, con il nuovo token. Un token che il server rifiuta in
anticipo ottiene comunque un refresh, poi un solo nuovo tentativo per richiesta.

## Dove risiede la sessione: `authFlowMode`

```typescript
const client = createRebaseClient({
    baseUrl: API_URL,
    auth: { authFlowMode: "cookie" }
});
```

| Modalità | Dove si trova il refresh token | Quando usarla |
|----------|--------------------------------|---------------|
| `"json"` *(predefinito)* | Restituito nel corpo della risposta, conservato in `localStorage` | Un'app nativa, uno script, qualsiasi contesto privo del gestore di cookie di un browser |
| `"cookie"` | Un cookie **HttpOnly** impostato dal backend | Un'applicazione browser. Lo script in esecuzione sulla pagina non può leggerlo, il che lo rende sicuro contro gli attacchi XSS |

La modalità cookie richiede `auth.cookieAuth` sul backend ed è quella utilizzata dal template frontend generato.

## Attesa del ripristino della sessione

**Una sessione ripristinata non è disponibile al primo rendering.** `getSession()` è sincrono, quindi al caricamento della pagina restituisce `null` mentre il ripristino è ancora in corso — e in modalità cookie un ripristino è *sempre* in corso, poiché il refresh token si trova in un cookie che la pagina non può leggere, costringendo il client a richiedere al server un nuovo access token.

Leggerlo in modo sincrono è ciò che produce un flash di stato disconnesso a ogni ricaricamento:

```typescript no-verify
// Wrong: renders the signed-out view for one round trip, every reload.
const session = client.auth.getSession();
if (!session) return <SignIn />;
```

`isInitialized()` si risolve una volta che il client ha completato il tentativo — sia che abbia trovato una sessione o meno:

```typescript
async function currentUser() {
    await client.auth.isInitialized();
    return client.auth.getSession()?.user ?? null;
}
```

In React, questo corrisponde a un singolo effetto:

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

`useRebaseAuthController` in `@rebasepro/app` esegue già questa operazione, quindi un'applicazione creata sul template generato ne dispone automaticamente. Le richieste di dati non devono attendere: una effettuata durante il ripristino viene inviata non appena questo si assesta — come utente ripristinato, oppure in forma anonima — così un primo render non legge mai un elenco pubblico al posto di quello dell'utente.

Un ripristino che esegue un refresh (un token memorizzato scaduto, o la modalità cookie) raggiunge `onAuthStateChange` come `TOKEN_REFRESHED`; un token memorizzato ancora valido viene adottato in silenzio. Quindi un listener non può indicare che il ripristino è terminato: un avvio che non emette nulla è indistinguibile da uno ancora in corso. Attendi `isInitialized()` per verificare questo stato e usa il listener per le modifiche successive.

`restoreOutcome()` dice come si è conclusa la ripresa, una volta che `isInitialized()` si è
risolta: `"restored"`, `"none"` (nulla da ripristinare), `"refused"` (il server ha
rifiutato la sessione), oppure `"unreachable"` (il server non era raggiungibile, quindi
la sessione non è stata né confermata né rifiutata). In modalità cookie, `"unreachable"`
senza sessione è l'unico caso in cui non si sa con certezza che l'utente sia disconnesso:

```typescript
await client.auth.isInitialized();
if (!client.auth.getSession() && client.auth.restoreOutcome() === "unreachable") {
    console.log("Offline: could not check the session.");
}
```

## Listener dello stato di autenticazione

Reagisci ai cambiamenti di autenticazione all'interno dell'applicazione:

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
| `SIGNED_IN` | Un accesso o una registrazione sono stati completati |
| `TOKEN_REFRESHED` | L'access token è stato rinnovato — compreso il rinnovo silenzioso che ripristina una sessione al caricamento della pagina |
| `USER_UPDATED` | `updateUser()` ha modificato il profilo, oppure `confirmEmailChange()` ha spostato questo account sul suo nuovo indirizzo |
| `SIGNED_OUT` | Una disconnessione, o un aggiornamento del token fallito definitivamente |

## Gestione delle password

### Password dimenticata

```typescript
const { success, message } = await client.auth.resetPasswordForEmail(
    "user@example.com"
);
```

### Reimpostazione della password (con token)

```typescript
const { success, message } = await client.auth.resetPassword(
    resetToken,
    "newSecurePassword"
);
```

### Modifica della password (autenticato)

```typescript
const { success, message } = await client.auth.changePassword(
    "oldPassword",
    "newPassword"
);
```

Ogni altra sessione dell'account termina: chiunque altro la possedesse deve
accedere di nuovo con la nuova password. Questo dispositivo resta autenticato.
Il server risponde con una sessione nuova, e il client la adotta (emettendo
`TOKEN_REFRESHED`).

## Verifica dell'email

La registrazione invia al nuovo account il suo link di verifica quando l'email
è configurata. `sendVerificationEmail()` lo invia di nuovo.

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

Il link dimostra la casella di posta, non chi ha registrato l'indirizzo, quindi
una password che né la sessione né la chiamata dimostrano viene rimossa invece
che mantenuta — vedi [Verifica email](/docs/backend/email-verification/).

Su un backend con `requireEmailVerification`, `signUp()` risolve con
`{ confirmationRequired: true, user: null }` e nessuna sessione: l'account
accede una volta che il link viene seguito con la sua password.

## Cambiare l'indirizzo email

Un utente autenticato sposta il proprio account su un altro indirizzo.
Nulla cambia finché il nuovo indirizzo non risponde:

```typescript
// Mails a link to the new address, and a notice to the current one
const { pendingEmail, expiresAt } = await client.auth.changeEmail("jane@new.example");

// On the page the link opens (<frontend>/confirm-email-change?token=…):
const { email, removedProviders } = await client.auth.confirmEmailChange(token);
```

Il link vive 24 ore; `getUser()` segnala l'indirizzo in attesa come
`pendingEmail`. La conferma non richiede alcuna sessione, e un client
autenticato come quell'account adotta il nuovo indirizzo ed emette
`USER_UPDATED`. I rifiuti sono elencati in
[Cambiare un indirizzo email](/docs/backend/auth-endpoints/#changing-an-email-address).

## Gestione delle sessioni (multi-dispositivo)

```typescript
// List all active sessions, one per sign-in
const sessions = await client.auth.getSessions();
// [{ id, userAgent, ipAddress, createdAt, isCurrentSession }, …]

// Revoke a specific session
await client.auth.revokeSession(sessionId);

// Revoke ALL sessions (logs out everywhere)
await client.auth.revokeAllSessions();
```

Ogni access token indica a quale accesso appartiene, quindi esattamente una
voce ha `isCurrentSession: true`: il dispositivo che chiede. Revocare una
sessione termina insieme il refresh token e l'access token di quel
dispositivo, dalla richiesta successiva, sia via HTTP sia su un socket
realtime aperto. Il logout (`signOut()`) fa lo stesso per il dispositivo che
si disconnette. Un access token emesso prima di questa release non indica
alcuna sessione; continua a funzionare finché non scade, entro l'ora.

## Configurazione dell'autenticazione

Interroga la configurazione di autenticazione del backend:

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

## Storage personalizzato della sessione

Per impostazione predefinita, le sessioni sono memorizzate in `localStorage`. Puoi personalizzare questo comportamento con l'opzione `auth`:

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

## Usare il tuo provider di autenticazione

Su 0.24 un getter del
token autentica solo le richieste HTTP, e il socket realtime resta
anonimo.

Quando gli utenti accedono con un provider tuo (Clerk, Firebase Auth, o una
sessione che la tua app ha già), `client.auth` non è coinvolto. Dai invece al client un
getter per il token del provider. Viene interrogato ogni volta che serve un token:
a ogni richiesta HTTP, e ogni volta che il socket realtime si
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

- Il getter prevale sulla sessione propria del client. Quando risponde `null` o
  lancia un errore, il client invia il token che possiede, se ne ha uno: quello della sua
  sessione, uno impostato con `client.setToken()`, o l'opzione `token`.
- L'opzione `token` viene letta ogni volta che serve un token, finché `setToken()` o
  un accesso non la sostituiscono, quindi può essere dichiarata come getter
  (`get token() { return currentToken; }`).
- `setOnUnauthorized` copre un 401 via HTTP e un errore di autenticazione sul socket,
  e sostituisce il refresh della sessione proprio del client.

Il backend deve verificare il token del provider: vedi
[Adapter di autenticazione personalizzati](/docs/backend/auth-adapters). Nel pannello di
amministrazione, imposta il getter sul client che passi a `<Rebase client>`
([Il tuo provider di autenticazione](/docs/frontend/authentication#your-own-auth-provider)).

## Struttura dell'oggetto User

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

## Passaggi successivi

- **[Interrogazione dei dati](/docs/sdk/querying)** — Operazioni CRUD e query builder
- **[Sottoscrizioni in tempo reale](/docs/sdk/realtime)** — Dati in tempo reale con WebSocket
- **[Backend di autenticazione](/docs/backend/authentication)** — Configurazione dell'autenticazione lato server
