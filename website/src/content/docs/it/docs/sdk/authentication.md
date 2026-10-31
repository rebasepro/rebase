---
sourceHash: e886a47c056f9c06
title: Autenticazione
sidebar_label: Autenticazione
description: Autenticazione lato client con l'SDK Rebase — accesso tramite email/password, provider OAuth, gestione della sessione e listener dello stato di autenticazione.
---

## Panoramica

Il modulo `client.auth` gestisce l'autenticazione degli utenti, la gestione dei token e la persistenza della sessione. Una volta effettuato l'accesso, tutte le successive richieste di dati includono automaticamente il JWT.

L'SDK rende persistenti le sessioni in `localStorage` per impostazione predefinita e aggiorna automaticamente i token prima della loro scadenza.

:::note[Ogni metodo di accesso si risolve in una sessione appiattita]
`signInWithEmail`, `signUp` e ogni metodo `signInWith*` restituiscono **`{ user, accessToken, refreshToken }`**: l'SDK ha già spacchettato il contenitore per te.

L'API REST sottostante restituisce invece il token annidato, come `{ user, tokens: { accessToken, … } }`. Questa differenza è rilevante solo se chiami direttamente `/api/auth/*` con `fetch`, dove `body.accessToken` è `undefined` e il token si trova in `body.tokens.accessToken`. Consulta [il formato di trasmissione](/docs/backend/auth-endpoints/#response-format).
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

Con [`requireEmailVerification`](/docs/backend/email-verification/) abilitato,
non c'è alcuna sessione finché l'indirizzo non viene confermato: `confirmationRequired` è `true` e `user` è `null`, quindi invita l'utente ad aprire l'email. In caso contrario, `confirmationRequired` è `false` e `user` è l'account autenticato. Nella versione 0.23 `signUp` restituisce `{ user, accessToken, refreshToken }` ed effettua sempre l'accesso.

## Provider OAuth

L'SDK include metodi dedicati per i provider OAuth più diffusi, oltre a un generico `signInWithOAuth()` per qualsiasi provider personalizzato.

### Google

Supporta tre modalità di chiamata:

```typescript
// ID-token flow (One Tap / Sign In With Google button)
await client.auth.signInWithGoogle({ idToken: googleIdToken });

// Access-token flow (popup)
await client.auth.signInWithGoogle({ accessToken: googleAccessToken });

// Authorization code flow (most secure, server-side exchange)
await client.auth.signInWithGoogle({ code: authCode, redirectUri: "https://..." });
```

### Altri provider

Ciascun provider segue il flusso con codice di autorizzazione con `(code, redirectUri)`:

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

Per qualsiasi provider registrato nel backend:

```typescript
await client.auth.signInWithOAuth("custom-provider", {
    code: authCode,
    redirectUri: "https://myapp.com/callback"
});
```

## Magic link

Un link di accesso in un solo clic inviato via email. Il link è sempre `<base>/auth/magic-link?token=…`, dove `<base>` corrisponde a `email.magicLinkUrl` del backend, oppure alla sua base per il ripristino password (`FRONTEND_URL` nel runtime) quando non è impostata. Non esiste un parametro `redirectTo` per singola richiesta. Gestisci quel percorso nel tuo frontend e reinvia il token per scambiarlo con una sessione. Il CMS lo gestisce automaticamente, effettuando l'accesso (attraverso il passaggio del codice quando è presente un secondo fattore); gli altri frontend necessitano di una landing page.

```typescript
// 1. Ask for the link.
await client.auth.sendMagicLink("user@example.com");

// 2. On the landing page, trade the token for a session.
const token = new URLSearchParams(location.search).get("token")!;
const { user } = await client.auth.verifyMagicLink(token);
```

`sendMagicLink` risponde allo stesso modo indipendentemente dal fatto che l'indirizzo abbia o meno un account. Questo è intenzionale: un endpoint che rispondesse "utente non trovato" sarebbe un oracolo per l'enumerazione degli account, quindi non utilizzare il risultato per comunicare a una persona se è registrata: non è possibile saperlo.

L'invio richiede un servizio email configurato nel backend, altrimenti `sendMagicLink` risponde con 503 `EMAIL_NOT_CONFIGURED`.

## Codici monouso (OTP)

Un codice a sei cifre inviato via email, utile per lo stesso scopo nei casi in cui un link risulti scomodo: un'app nativa, un secondo dispositivo o un browser che altera i link.

```typescript
const { expiresInSeconds } = await client.auth.sendEmailOtp("user@example.com");

// The address goes back with the code, because the code is only valid for it.
const { user } = await client.auth.verifyEmailOtp("user@example.com", "418293");
```

L'invio dell'indirizzo insieme al codice è ciò che limita i tentativi di indovinare le sei cifre a *un solo* account, anziché a tutti gli account contemporaneamente.

## Sessioni anonime

Consenti a un visitatore di accedere senza alcuna credenziale, in modo che possa iniziare a usare l'app prima ancora di avere un motivo per registrarsi:

```typescript
const { user } = await client.auth.signInAnonymously();
user.isAnonymous;   // true
```

L'account è reale: ha un id, ruoli e una sessione, quindi la sicurezza a livello di riga (row-level security) ne delimita le righe esattamente come farebbe per un utente registrato. Ciò che non ha è una via di ritorno: nessuno può effettuare di nuovo l'accesso *come* quell'utente, quindi tutto ciò che possiede va perso insieme alla sessione.

`linkAnonymous` è il modo per evitare che l'account sia usa e getta. L'utente **mantiene il proprio id**, così tutto ciò che ha creato da anonimo rimane suo:

```typescript
await client.auth.linkAnonymous("user@example.com", "correct-horse-battery");
```

| Errore | Significato |
|---------|-------|
| `ANONYMOUS_AUTH_DISABLED` (403) | Il backend non ha abilitato l'autenticazione anonima o l'ha disattivata dopo l'accesso di questo ospite: un ospite diventa un account solo quando `allowAnonymous` è attivo |
| `REGISTRATION_DISABLED` (403) | Le registrazioni sono chiuse sul backend, e la conversione in account equivale a una registrazione |
| `NOT_ANONYMOUS` (400) | La sessione corrente appartiene a un account ordinario |
| `EMAIL_EXISTS` (409) | L'indirizzo ha già un account associato: accedi a quello |

<span class="since-badge" data-since="0.27">Dalla versione 0.27</span> Un ospite che non torna più rimane salvato come riga. Un amministratore può eliminarli con `client.admin.listGuests()`, `client.admin.deleteGuest(uid)` e `client.admin.deleteGuests({ lastSeenBefore })`, oppure su Rebase Cloud con [`rebase cloud guests`](/docs/cli/cloud/#guests). Questi comandi agiscono esclusivamente sugli ospiti e `deleteGuests` opera in batch: ripetilo finché `remaining` non è 0, impostando `offset` sul numero di record saltati finora.

## Collegare un provider a un account esistente

`signInWithGoogle` e simili effettuano l'*accesso* di un utente. `linkProvider` associa l'identità di un provider all'account che ha già effettuato l'accesso, consentendo alla stessa persona di rientrare da entrambi gli accessi:

```typescript
await client.auth.linkProvider("google", { idToken });
```

La sessione prova già la proprietà dell'account, quindi, a differenza dell'accesso, non richiede che il provider abbia verificato l'email, e i due indirizzi non devono necessariamente coincidere. Ha successo in modo idempotente (`alreadyLinked: true`) se quell'identità è già associata a questo account, e rifiuta con `IDENTITY_ALREADY_LINKED` (409) se appartiene a un altro account.

## Cercare un utente tramite email

```typescript
const profile = await client.auth.findUserByEmail("user@example.com");
// { uid, displayName, photoURL } | null
```

Tre campi non sensibili e null'altro: sufficienti per mostrare "stai invitando Jane" prima che l'invito venga inviato. Funzionalità opt-in: consentita solo a chiamanti autenticati, e restituisce un 404 a meno che il backend non imposti `AUTH_ALLOW_USER_LOOKUP=true` (`auth.allowUserLookup`).

## Autenticazione a più fattori (MFA)

Registrazione di un fattore, secondo passaggio di un accesso, codici di recupero e rimozione di un fattore: [Autenticazione a più fattori](/docs/sdk/multi-factor-authentication/).

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

Una richiesta non parte mai con un token che il client sa essere scaduto: le richieste condividono un unico refresh e vengono inviate una sola volta, con il nuovo token. Un token che il server rifiuta anticipatamente ottiene comunque un refresh, seguito da un nuovo tentativo per richiesta.

## Dove risiede la sessione: `authFlowMode`

```typescript
const client = createRebaseClient({
    baseUrl: API_URL,
    auth: { authFlowMode: "cookie" }
});
```

| Modalità | Dove si trova il refresh token | Quando usarla |
|------|----------------------------|----------------|
| `"json"` *(predefinita)* | Restituito nel corpo della risposta, conservato in `localStorage` | Un'app nativa, uno script, qualsiasi contesto privo del gestore di cookie del browser |
| `"cookie"` | Un cookie **HttpOnly** impostato dal backend | Un'app per browser. Gli script in esecuzione sulla pagina non possono leggerlo, rendendolo sicuro contro attacchi XSS |

La modalità cookie richiede `auth.cookieAuth` nel backend ed è quella utilizzata dal template frontend generato.

## Attendere il ripristino della sessione

**Una sessione ripristinata non è disponibile al primo render.** `getSession()` è sincrono, quindi al caricamento della pagina restituisce `null` mentre il ripristino è ancora in corso — e in modalità cookie un ripristino è *sempre* in corso, poiché il refresh token si trova in un cookie non leggibile dalla pagina, costringendo il client a richiedere al server un nuovo access token.

Leggerlo in modo sincrono è ciò che produce un lampeggio di stato disconnesso (logged-out flash) a ogni ricaricamento:

```typescript no-verify
// Wrong: renders the signed-out view for one round trip, every reload.
const session = client.auth.getSession();
if (!session) return <SignIn />;
```

`isInitialized()` si risolve una volta che il client ha terminato il tentativo, indipendentemente dal fatto che abbia trovato una sessione o meno:

```typescript
async function currentUser() {
    await client.auth.isInitialized();
    return client.auth.getSession()?.user ?? null;
}
```

In React, corrisponde a un singolo effetto:

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

`useRebaseAuthController` in `@rebasepro/app` esegue già questa operazione, quindi un'app creata sul template generato la ottiene automaticamente. Le richieste di dati non devono attendere: una richiesta effettuata a metà ripristino viene inviata non appena questo si stabilizza — come utente ripristinato o in modo anonimo — così il primo render non legge mai un elenco pubblico al posto dei dati riservati dell'utente.

Un ripristino che effettua un refresh (un token memorizzato scaduto, o la modalità cookie) arriva a `onAuthStateChange` come `TOKEN_REFRESHED`; un token memorizzato ancora valido viene adottato in modo trasparente. Pertanto, un listener non può segnalare la fine del ripristino: un avvio che non emette nulla è indistinguibile da uno ancora in corso. Attendi `isInitialized()` per questa verifica e usa il listener per i cambiamenti successivi.

`restoreOutcome()` indica l'esito del ripristino una volta risolto `isInitialized()`: `"restored"`, `"none"` (nulla da ripristinare), `"refused"` (il server ha rifiutato la sessione) o `"unreachable"` (il server non è raggiungibile, quindi la sessione non è stata né confermata né rifiutata). In modalità cookie, `"unreachable"` in assenza di sessione è l'unico caso in cui non si ha la certezza che l'utente sia disconnesso:

```typescript
await client.auth.isInitialized();
if (!client.auth.getSession() && client.auth.restoreOutcome() === "unreachable") {
    console.log("Offline: could not check the session.");
}
```

## Listener dello stato di autenticazione

Reagisci ai cambiamenti di autenticazione in tutta l'applicazione:

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
| `SIGNED_IN` | Un accesso o una registrazione sono stati completati |
| `TOKEN_REFRESHED` | L'access token è stato rinnovato, incluso il rinnovo trasparente che ripristina la sessione al caricamento della pagina |
| `USER_UPDATED` | `updateUser()` ha modificato il profilo, `linkAnonymous()` ha trasformato un ospite in un account, `changeEmail()` ha avviato un cambio di indirizzo oppure `confirmEmailChange()` ha trasferito questo account al nuovo indirizzo |
| `SIGNED_OUT` | Una disconnessione, `revokeAllSessions()` o un refresh fallito definitivamente |

## Gestione delle password

### Password dimenticata

```typescript
const { success, message } = await client.auth.resetPasswordForEmail(
    "user@example.com"
);
```

### Reimpostare la password (con token)

```typescript
const { success, message } = await client.auth.resetPassword(
    resetToken,
    "newSecurePassword"
);
```

### Modificare la password (autenticato)

```typescript
const { success, message } = await client.auth.changePassword(
    "oldPassword",
    "newPassword"
);
```

Tutte le altre sessioni dell'account vengono terminate: chiunque ne possedesse una dovrà accedere nuovamente con la nuova password. Questo dispositivo rimane connesso. Il server risponde con una nuova sessione e il client la acquisisce (emettendo `TOKEN_REFRESHED`).

## Verifica dell'email

La registrazione invia al nuovo account un link di verifica se il servizio email è configurato. `sendVerificationEmail()` lo invia nuovamente.

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

Il link dimostra il possesso della casella di posta, non chi ha registrato l'indirizzo, pertanto una password non confermata né dalla sessione né dalla chiamata viene rimossa anziché mantenuta — consulta [Verifica dell'email](/docs/backend/email-verification/).

Su un backend con `requireEmailVerification`, `signUp()` si risolve con `{ confirmationRequired: true, user: null }` e nessuna sessione: l'accesso dell'account avviene solo dopo aver aperto il link e inserito la password.

## Modificare l'indirizzo email

Un utente autenticato trasferisce il proprio account a un altro indirizzo. Nulla cambia finché il nuovo indirizzo non risponde:

```typescript
// Mails a link to the new address, and a notice to the current one
const { pendingEmail, expiresAt } = await client.auth.changeEmail("jane@new.example");

// On the page the link opens (<frontend>/confirm-email-change?token=…):
const { email, removedProviders } = await client.auth.confirmEmailChange(token);
```

Il link è valido per 24 ore; `getUser()` segnala l'indirizzo in attesa come `pendingEmail`. La conferma non richiede alcuna sessione e un client autenticato con quell'account adotta il nuovo indirizzo ed emette `USER_UPDATED`. I possibili motivi di rifiuto sono elencati in [Modifica di un indirizzo email](/docs/backend/auth-endpoints/#changing-an-email-address).

## Gestione della sessione (multidispositivo)

```typescript
// List all active sessions, one per sign-in
const sessions = await client.auth.getSessions();
// [{ id, userAgent, ipAddress, createdAt, isCurrentSession }, …]

// Revoke a specific session
await client.auth.revokeSession(sessionId);

// Revoke ALL sessions (logs out everywhere)
await client.auth.revokeAllSessions();
```

Ogni access token identifica l'accesso a cui appartiene, quindi esattamente una voce presenta `isCurrentSession: true`: il dispositivo che effettua la richiesta. La revoca di una sessione termina sia il refresh token sia l'access token di quel dispositivo, a partire dalla richiesta successiva, sia via HTTP che su una connessione socket realtime aperta. La disconnessione (`signOut()`) fa lo stesso per il dispositivo che si disconnette. Un access token emesso prima di questa versione non identifica alcuna sessione; continuerà a funzionare fino alla sua scadenza, entro un'ora.

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

## Storage di sessione personalizzato

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

## Utilizzare un provider di autenticazione personalizzato

Nella versione 0.24 un getter del token autentica solo le richieste HTTP, mentre il socket realtime rimane anonimo.

Quando gli utenti effettuano l'accesso tramite un provider personalizzato (Clerk, Firebase Auth o una sessione già presente nell'app), `client.auth` non viene coinvolto. Fornisci invece al client un getter per il token del provider. Questo verrà chiamato ogni volta che serve un token: per ogni richiesta HTTP e ogni volta che il socket realtime esegue l'autenticazione.

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

- Il getter ha la priorità sulla sessione del client. Quando restituisce `null` o genera un'eccezione, il client invia il token in suo possesso, se presente: quello della sua sessione, uno impostato con `client.setToken()` o quello dell'opzione `token`.
- L'opzione `token` viene letta ogni volta che un token è necessario, finché `setToken()` o un accesso non la sostituiscono; può quindi essere dichiarata come un getter (`get token() { return currentToken; }`).
- `setOnUnauthorized` gestisce gli errori 401 su HTTP e gli errori di autenticazione sul socket, sostituendo il refresh di sessione interno del client.

Il backend deve verificare il token del provider: consulta [Adapter di autenticazione personalizzati](/docs/backend/auth-adapters). Nel pannello di amministrazione, imposta il getter sul client che passi a `<Rebase client>` ([Il tuo provider di autenticazione](/docs/frontend/authentication#your-own-auth-provider)).

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

- **[Interrogare i dati](/docs/sdk/querying)** — Operazioni CRUD e query builder
- **[Sottoscrizioni in tempo reale](/docs/sdk/realtime)** — Dati in tempo reale con WebSocket
- **[Backend di autenticazione](/docs/backend/authentication)** — Configurazione dell'autenticazione lato server
