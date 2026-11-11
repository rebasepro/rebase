---
sourceHash: 3ef13c31e76183aa
title: Autenticazione
sidebar_label: Autenticazione
description: Autenticazione lato client con Rebase SDK — accesso con email/password, provider OAuth, gestione delle sessioni e listener dello stato di autenticazione.
---

## Panoramica

Il modulo `client.auth` gestisce l'autenticazione degli utenti, la gestione dei token e la persistenza della sessione. Una volta effettuato l'accesso, tutte le richieste di dati successive includono automaticamente il JWT.

L'SDK rende persistenti le sessioni in `localStorage` per impostazione predefinita e aggiorna automaticamente i token prima della loro scadenza.

:::note[Ogni metodo di accesso restituisce una sessione appiattita]
`signInWithEmail`, `signUp` e ogni metodo `signInWith*` restituiscono **`{ user, accessToken, refreshToken }`** — l'SDK ha già spacchettato il contenitore per te.

L'API REST sottostante restituisce invece il token annidato, come `{ user, tokens: { accessToken, … } }`. Tale differenza è rilevante solo se si chiama `/api/auth/*` direttamente con `fetch`, dove `body.accessToken` è `undefined` e il token si trova in `body.tokens.accessToken`. Consulta [il formato wire](/docs/backend/auth-endpoints/#response-format).
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

Con [`requireEmailVerification`](/docs/backend/email-verification/) abilitato, non c'è alcuna sessione finché l'indirizzo non viene confermato: `confirmationRequired` è `true` e `user` è `null`, quindi invita l'utente a controllare la posta elettronica. Altrimenti `confirmationRequired` è `false` e `user` rappresenta l'account che ha effettuato l'accesso.

## Provider OAuth

L'SDK include metodi dedicati per i provider OAuth più diffusi, oltre a un `signInWithOAuth()` generico per qualsiasi provider personalizzato.

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

Ogni provider segue il flusso con authorization code con `(code, redirectUri)`:

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

Twitter richiede anche il code verifier PKCE:

```typescript
await client.auth.signInWithTwitter(code, redirectUri, codeVerifier);
```

### Apple

In un browser, `signInWithApplePopup()` apre il popup di Apple, verifica lo `state` ed effettua l'accesso con il codice. Chiamalo da un gestore del clic (click handler). Chiama `preloadAppleSignIn()` al montaggio (on mount), poiché Safari blocca i popup che attendono il download di uno script:

```typescript
import { preloadAppleSignIn } from "@rebasepro/client";

void preloadAppleSignIn();                                          // on mount
await client.auth.signInWithApplePopup({ clientId: "com.example.web" }); // on click
```

Senza `clientId`, l'SDK legge il Services ID da `/auth/config`, ritardando l'apertura del popup. Il redirect URI predefinito corrisponde all'origine della pagina seguita da `/`, e deve essere un Return URL configurato nel Services ID (HTTPS, mai `localhost`). Se il popup viene chiuso, la promise viene rifiutata con il codice `APPLE_SIGN_IN_CANCELLED`.

Un'app nativa iOS o macOS invia il codice di autorizzazione dall'accesso nativo di Apple insieme al proprio bundle id. Il bundle id deve essere elencato in `APPLE_BUNDLE_IDS`:

```typescript
await client.auth.signInWithApple({
    code: credential.authorizationCode,
    bundleId: "com.example.ios",
    user: { name: { firstName: "Jane" } } // sent by Apple on the first sign-in only
});
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

Un link di accesso con un clic inviato via email. Il link è sempre `<base>/auth/magic-link?token=…`, dove `<base>` è il parametro `email.magicLinkUrl` del backend, oppure la base per il ripristino della password (`FRONTEND_URL` sul runtime) quando non impostata. Non è disponibile un `redirectTo` per singola richiesta. Servi questo percorso nel tuo frontend e reinvia il token per scambiarlo con una sessione. Il CMS lo gestisce effettuando l'accesso (passando per la fase del codice se è presente un secondo fattore); altri frontend richiedono una landing page.

```typescript
// 1. Ask for the link.
await client.auth.sendMagicLink("user@example.com");

// 2. On the landing page, trade the token for a session.
const token = new URLSearchParams(location.search).get("token")!;
const { user } = await client.auth.verifyMagicLink(token);
```

`sendMagicLink` risponde allo stesso modo indipendentemente dal fatto che l'indirizzo sia associato a un account o meno. È una scelta intenzionale: un endpoint che rispondesse "utente inesistente" fungerebbe da oracolo per l'enumerazione degli account; non utilizzare quindi il risultato per informare l'utente se è registrato o meno, poiché non è possibile saperlo.

L'invio richiede un servizio email configurato sul backend, altrimenti `sendMagicLink` risponde con 503 `EMAIL_NOT_CONFIGURED`.

## Codici monouso

Un codice a sei cifre inviato via email, ideale nei casi in cui un link risulti scomodo: un'app nativa, un secondo dispositivo o un browser che altera i link.

```typescript
const { expiresInSeconds } = await client.auth.sendEmailOtp("user@example.com");

// The address goes back with the code, because the code is only valid for it.
const { user } = await client.auth.verifyEmailOtp("user@example.com", "418293");
```

L'invio dell'indirizzo insieme al codice garantisce che un tentativo di indovinare le sei cifre sia mirato a *un solo* account anziché a tutti gli account contemporaneamente.

## Sessioni anonime

Effettua l'accesso per un visitatore senza alcuna credenziale, in modo che possa iniziare a usare l'app prima ancora di avere un motivo per registrarsi:

```typescript
const { user } = await client.auth.signInAnonymously();
user.isAnonymous;   // true
```

L'account è reale: dispone di un ID, di ruoli e di una sessione, quindi la row-level security delimita le sue righe esattamente come farebbe per un utente registrato. Ciò che non ha è una via di ritorno: nessuno può effettuare nuovamente l'accesso con tale identità, quindi tutto ciò che possiede va perso con la sessione.

`linkAnonymous` è il metodo per renderlo permanente. L'utente **mantiene il proprio ID**, quindi tutto ciò che ha creato da anonimo rimane suo:

```typescript
await client.auth.linkAnonymous("user@example.com", "correct-horse-battery");
```

| Errore | Significato |
|---------|-------|
| `ANONYMOUS_AUTH_DISABLED` (403) | Il backend non ha abilitato l'autenticazione anonima, oppure l'ha disattivata dopo l'accesso dell'ospite: un ospite diventa un account solo finché `allowAnonymous` è attivo |
| `REGISTRATION_DISABLED` (403) | La registrazione è disattivata sul backend, e convertire un ospite in account equivale a una registrazione |
| `NOT_ANONYMOUS` (400) | La sessione corrente appartiene a un account normale |
| `EMAIL_EXISTS` (409) | L'indirizzo ha già un account associato — effettua l'accesso con quello |

Un ospite che non torna più rimane memorizzato come riga. Un amministratore può ripulire questi record con `client.admin.listGuests()`, `client.admin.deleteGuest(uid)` e `client.admin.deleteGuests({ lastSeenBefore })`, oppure su Rebase Cloud con [`rebase cloud guests`](/docs/cli/cloud/#guests). Questi metodi agiscono esclusivamente sugli ospiti, e `deleteGuests` funziona a lotti: ripetilo finché `remaining` non è 0, impostando `offset` sul numero di record saltati finora.

## Collegamento di un provider a un account esistente

`signInWithGoogle` e i metodi analoghi effettuano l'*accesso* dell'utente. `linkProvider` associa l'identità di un provider all'account già autenticato, consentendo alla stessa persona di accedere tramite una qualsiasi delle modalità configurate:

```typescript
await client.auth.linkProvider("google", { idToken });
```

La sessione certifica già la titolarità dell'account, pertanto, a differenza dell'accesso, non richiede che il provider abbia verificato l'email e i due indirizzi non devono necessariamente coincidere. L'operazione ha esito positivo in modo idempotente (`alreadyLinked: true`) se quell'identità è già presente su questo account, mentre viene rifiutata con `IDENTITY_ALREADY_LINKED` (409) se appartiene a un altro account.

## Ricerca di un utente tramite email

```typescript
const profile = await client.auth.findUserByEmail("user@example.com");
// { uid, displayName, photoURL } | null
```

Tre campi non sensibili e nient'altro — sufficienti per mostrare "Stai invitando Jane" prima dell'invio di un invito. Funzionalità opt-in: accessibile solo a un chiamante autenticato, restituisce 404 a meno che il backend non imposti `AUTH_ALLOW_USER_LOOKUP=true` (`auth.allowUserLookup`).

## Autenticazione a più fattori

Registrazione di un fattore, secondo passaggio dell'accesso, codici di ripristino e rimozione di un fattore: [Autenticazione a più fattori](/docs/sdk/multi-factor-authentication/).

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

**Non conservare mai l'oggetto session.** `getSession()` è uno snapshot. Ogni rinnovo dell'access token, circa una volta all'ora, sostituisce la sessione con un nuovo oggetto; pertanto, una sessione memorizzata al caricamento della pagina conterrà un token che il server rifiuterà una volta scaduto, facendo apparire l'app come disconnessa. Leggi la sessione al momento del bisogno.

### Inviare il token alle tue route

La chiamata a una funzione in `backend/functions/` non richiede alcuna gestione manuale del token: `client.functions.invoke` rinnova il token prima dell'invio ed esegue un nuovo tentativo in caso di 401.

```typescript
const saved = await client.functions.invoke("progress", { level: 3 }, { path: "save" });
```

Per qualsiasi altra richiesta, richiedi il token ogni volta con `getAccessToken()`. Questo metodo rinnova un token scaduto o in scadenza, attende il ripristino della sessione al caricamento e restituisce `null` quando nessun utente è autenticato.

```typescript
const token = await client.auth.getAccessToken();
await fetch("https://other.example.com/upload", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: file
});
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

Una richiesta non parte mai con un token che il client sa essere scaduto: le richieste condividono un singolo aggiornamento e vengono inviate una sola volta con il nuovo token. Un token che il server rifiuta prima del previsto ottiene comunque un aggiornamento e un successivo tentativo per richiesta.

## Dove risiede la sessione: `authFlowMode`

```typescript
const client = createRebaseClient({
    baseUrl: API_URL,
    auth: { authFlowMode: "cookie" }
});
```

| Modalità | Posizione del refresh token | Predefinito |
|------|----------------------------|---------|
| `"cookie"` | Un cookie **HttpOnly** impostato dal backend. Gli script in esecuzione sulla pagina non possono leggerlo, il che lo rende protetto da XSS | In un browser |
| `"json"` | Restituito nel corpo della risposta, conservato in `storage` (`localStorage` per impostazione predefinita) | Fuori dal browser (Node, worker, React Native) e in un browser quando passi un tuo `storage` |

La modalità cookie richiede `auth.cookieAuth` sul backend: il runtime di Rebase (e quindi Rebase Cloud) la attiva sempre, e dalla versione 0.30 lo fa anche `initializeRebaseBackend` a meno che non sia impostato `cookieAuth: false`. La modalità json funziona con entrambi: le sue richieste di autenticazione includono `x-rebase-auth-flow: json`, a cui si risponde con il refresh token nel body. Un backend precedente alla versione 0.29 non ne fornisce alcuno a un client json, provocando la terminazione della sessione dopo circa un'ora, e il client registra nei log quale modalità utilizzare (a meno che non sia stato passato uno `storage`).

Passare uno `storage` personalizzato mantiene un client browser in modalità json, utile per un secondo client che gestisce un proprio accesso separato dal cookie della pagina, come un ospite accanto all'account autenticato. Il suo refresh token risiede in tale storage, dove gli script della pagina possono leggerlo; si consiglia quindi di mantenere l'account principale della pagina in modalità cookie.

## Attendere il ripristino della sessione

**Una sessione ripristinata non è disponibile al primo render.** `getSession()` è sincrono, quindi al caricamento della pagina restituisce `null` mentre il ripristino è ancora in corso — e in modalità cookie un ripristino è *sempre* in corso, poiché il refresh token si trova in un cookie che la pagina non può leggere, obbligando il client a richiedere al server un nuovo access token.

Leggerlo in modo sincrono è ciò che produce un lampeggio di stato disconnesso a ogni ricaricamento:

```typescript no-verify
// Wrong: renders the signed-out view for one round trip, every reload.
const session = client.auth.getSession();
if (!session) return <SignIn />;
```

`isInitialized()` si risolve quando il client ha completato il tentativo — indipendentemente dal fatto che abbia trovato una sessione o meno:

```typescript
async function currentUser() {
    await client.auth.isInitialized();
    return client.auth.getSession()?.user ?? null;
}
```

In React, questo si traduce in un unico effect:

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

`useRebaseAuthController` in `@rebasepro/app` esegue già questa operazione, quindi un'app creata sul template generato la include nativamente. Le richieste di dati non devono attendere: una richiesta eseguita durante il ripristino viene inviata una volta che questo si è stabilizzato — come utente ripristinato o in modo anonimo — evitando che un primo render legga un elenco pubblico al posto dei dati riservati dell'utente.

Un ripristino che comporta un aggiornamento (un token memorizzato scaduto o la modalità cookie) viene notificato a `onAuthStateChange` come `TOKEN_REFRESHED`; un token memorizzato ancora valido viene adottato in modo trasparente. Di conseguenza, un listener non può segnalare quando il ripristino è terminato: un avvio che non emette eventi è indistinguibile da uno ancora in corso. Attendi `isInitialized()` per accertarlo e usa il listener per i cambiamenti successivi.

`restoreOutcome()` indica l'esito del ripristino una volta risolto `isInitialized()`: `"restored"`, `"none"` (nulla da ripristinare), `"refused"` (il server ha rifiutato la sessione) o `"unreachable"` (il server non è stato raggiunto, quindi la sessione non è stata né confermata né rifiutata). In modalità cookie, `"unreachable"` senza alcuna sessione è l'unico caso in cui lo stato di "disconnesso" non può essere considerato certo:

```typescript
await client.auth.isInitialized();
if (!client.auth.getSession() && client.auth.restoreOutcome() === "unreachable") {
    console.log("Offline: could not check the session.");
}
```

## Listener dello stato di autenticazione

Reagisci ai cambiamenti di autenticazione nell'intera applicazione:

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
| `TOKEN_REFRESHED` | L'access token è stato rinnovato — compreso il rinnovo automatico che ripristina una sessione al caricamento della pagina |
| `USER_UPDATED` | `updateUser()` ha modificato il profilo, `linkAnonymous()` ha convertito un ospite in un account, `changeEmail()` ha avviato la modifica dell'indirizzo o `confirmEmailChange()` ha trasferito questo account al nuovo indirizzo |
| `SIGNED_OUT` | Una disconnessione, `revokeAllSessions()` o un aggiornamento che è fallito definitivamente |

## Gestione della password

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

Tutte le altre sessioni dell'account vengono terminate: chiunque ne possedesse una dovrà effettuare nuovamente l'accesso con la nuova password. Questo dispositivo rimane autenticato. Il server risponde con una nuova sessione e il client la acquisisce (emettendo `TOKEN_REFRESHED`).

## Verifica dell'email

Se il servizio email è configurato, la registrazione invia al nuovo account un link di verifica. `sendVerificationEmail()` lo invia nuovamente.

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

Il link certifica l'accesso alla casella di posta, non chi ha registrato l'indirizzo; pertanto, una password non convalidata né dalla sessione né dalla chiamata viene rimossa anziché mantenuta — consulta [Verifica dell'email](/docs/backend/email-verification/).

Su un backend con `requireEmailVerification`, `signUp()` si risolve con `{ confirmationRequired: true, user: null }` e nessuna sessione: l'accesso all'account viene effettuato una volta aperto il link e inserita la password.

## Modifica dell'indirizzo email

Un utente autenticato trasferisce il proprio account a un altro indirizzo. Nulla cambia finché il nuovo indirizzo non risponde:

```typescript
// Mails a link to the new address, and a notice to the current one
const { pendingEmail, expiresAt } = await client.auth.changeEmail("jane@new.example");

// On the page the link opens (<frontend>/confirm-email-change?token=…):
const { email, removedProviders } = await client.auth.confirmEmailChange(token);
```

Il link è valido per 24 ore; `getUser()` segnala l'indirizzo in attesa come `pendingEmail`. La conferma non richiede alcuna sessione e un client autenticato con quell'account adotta il nuovo indirizzo emettendo `USER_UPDATED`. I motivi di rifiuto sono elencati in [Modifica di un indirizzo email](/docs/backend/auth-endpoints/#changing-an-email-address).

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

Ogni access token specifica l'accesso a cui appartiene, pertanto esattamente una voce presenta `isCurrentSession: true`: quella del dispositivo richiedente. La revoca di una sessione termina contemporaneamente il refresh token e l'access token di quel dispositivo a partire dalla richiesta successiva, sia via HTTP che su una connessione socket realtime aperta. La disconnessione (`signOut()`) esegue la stessa operazione per il dispositivo che si disconnette. Un access token emesso prima di questa versione non identifica alcuna sessione e continua a funzionare fino alla sua scadenza, entro un'ora.

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
//   magicLink: boolean, emailOtp?: boolean, deviceLogin?: boolean,
//   anonymousLogin: boolean, enabledProviders: string[],
//   providerClientIds?: Record<string, string>,   // public ids, e.g. { apple: Services ID }
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

## Utilizzo del proprio provider di autenticazione

Clerk, Firebase Auth o una sessione già presente nella tua app, con un getter di token al posto di `client.auth`: [Il tuo provider di autenticazione](/docs/sdk/your-own-auth-provider/).

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
- **[Sottoscrizioni in tempo reale](/docs/sdk/realtime)** — Dati in tempo reale tramite WebSocket
- **[Backend di autenticazione](/docs/backend/authentication)** — Configurazione dell'autenticazione lato server
