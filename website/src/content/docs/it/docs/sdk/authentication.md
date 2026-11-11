---
sourceHash: c67662e33d3a979a
title: Autenticazione
sidebar_label: Autenticazione
description: Autenticazione lato client con il Rebase SDK — accesso con email/password, provider OAuth, gestione delle sessioni e listener dello stato di autenticazione.
---

## Panoramica

Il modulo `client.auth` gestisce l'autenticazione degli utenti, la gestione dei token e la persistenza della sessione. Una volta che un utente ha effettuato l'accesso, tutte le richieste di dati successive includono automaticamente il JWT.

L'SDK mantiene persistenti le sessioni in `localStorage` per impostazione predefinita e aggiorna automaticamente i token prima della loro scadenza.

:::note[Ogni metodo di accesso restituisce una sessione appiattita]
`signInWithEmail`, `signUp` e ogni metodo `signInWith*` restituiscono **`{ user, accessToken, refreshToken }`** — l'SDK ha già spacchettato il payload per te.

L'API REST sottostante restituisce invece il token annidato, come `{ user, tokens: { accessToken, … } }`. Questa differenza è rilevante solo se chiami direttamente `/api/auth/*` con `fetch`, dove `body.accessToken` è `undefined` e il token si trova in `body.tokens.accessToken`. Consulta [il formato wire](/docs/backend/auth-endpoints/#response-format).
:::

## Email / Password

### Accesso (Sign In)

```typescript
const { user, accessToken, refreshToken } = await client.auth.signInWithEmail(
    "user@example.com",
    "password"
);
console.log(user.uid, user.email);
```

### Registrazione (Sign Up)

```typescript
const { user, confirmationRequired } = await client.auth.signUp(
    "user@example.com",
    "password",
    "Jane Doe"   // optional displayName
);
```

Con [`requireEmailVerification`](/docs/backend/email-verification/) abilitato,
non c'è alcuna sessione finché l'indirizzo non viene confermato: `confirmationRequired` è `true` e `user` è `null`, quindi invita l'utente a controllare la posta. Altrimenti, `confirmationRequired` è `false` e `user` è l'account autenticato.

## Provider OAuth

L'SDK include metodi dedicati per i provider OAuth più comuni, oltre a un `signInWithOAuth()` generico per qualsiasi provider personalizzato.

### Google

Supporta tre modalità di invocazione:

```typescript
// ID-token flow (One Tap / Sign In With Google button)
await client.auth.signInWithGoogle({ idToken: googleIdToken });

// Access-token flow (popup)
await client.auth.signInWithGoogle({ accessToken: googleAccessToken });

// Authorization code flow (most secure, server-side exchange)
await client.auth.signInWithGoogle({ code: authCode, redirectUri: "https://..." });
```

### Altri Provider

Ogni provider segue il flusso con codice di autorizzazione con `(code, redirectUri)`:

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

Twitter richiede anche il verifier del codice PKCE:

```typescript
await client.auth.signInWithTwitter(code, redirectUri, codeVerifier);
```

### Apple

In un browser, `signInWithApplePopup()` apre il popup di Apple, verifica lo `state` ed
esegue l'accesso con il codice. Va chiamato da un gestore di clic. Chiama `preloadAppleSignIn()`
al montaggio del componente, poiché Safari blocca i popup in attesa del download di uno script:

```typescript
import { preloadAppleSignIn } from "@rebasepro/client";

void preloadAppleSignIn();                                          // on mount
await client.auth.signInWithApplePopup({ clientId: "com.example.web" }); // on click
```

Senza `clientId`, l'SDK legge il Services ID da `/auth/config`, il che
ritarda l'apertura del popup. Il redirect URI predefinito corrisponde all'origine della pagina più `/`, e
deve essere configurato come Return URL nel Services ID (HTTPS, mai `localhost`). Se l'utente
chiude il popup, la promessa viene rifiutata con il codice `APPLE_SIGN_IN_CANCELLED`.

Un'app nativa iOS o macOS invia il codice di autorizzazione ottenuto dall'accesso nativo
Apple insieme al proprio bundle id. Il bundle id deve essere elencato in `APPLE_BUNDLE_IDS`:

```typescript
await client.auth.signInWithApple({
    code: credential.authorizationCode,
    bundleId: "com.example.ios",
    user: { name: { firstName: "Jane" } } // sent by Apple on the first sign-in only
});
```

### OAuth Generico

Per qualsiasi provider registrato nel backend:

```typescript
await client.auth.signInWithOAuth("custom-provider", {
    code: authCode,
    redirectUri: "https://myapp.com/callback"
});
```

## Magic Link

Un link inviato via email per accedere con un clic. Il link è sempre `<base>/auth/magic-link?token=…`, dove `<base>` è `email.magicLinkUrl` configurato nel backend, oppure la sua base per il reset della password (`FRONTEND_URL` nel runtime) quando il primo non è impostato. Non esiste un parametro `redirectTo` per singola richiesta. Servi questo percorso nel tuo frontend e reinvia il token per riscattare una sessione. Il CMS lo gestisce già effettuando l'accesso (passando per la richiesta del codice se è presente un secondo fattore); gli altri frontend necessitano di una landing page.

```typescript
// 1. Richiedi il link.
await client.auth.sendMagicLink("user@example.com");

// 2. Nella landing page, scambia il token con una sessione.
const token = new URLSearchParams(location.search).get("token")!;
const { user } = await client.auth.verifyMagicLink(token);
```

`sendMagicLink` risponde allo stesso modo indipendentemente dal fatto che l'indirizzo email sia
associato o meno a un account. Questo comportamento è intenzionale: un endpoint che rispondesse "utente non trovato" costituirebbe un oracolo per l'enumerazione degli account; pertanto non usare il risultato per comunicare all'utente se è registrato o meno — la funzione non fornisce questo dato.

L'invio richiede che un servizio email sia configurato nel backend, altrimenti
`sendMagicLink` restituirà l'errore 503 `EMAIL_NOT_CONFIGURED`.

## Codici Monouso (OTP)

Un codice a sei cifre inviato via email, ideale per i casi d'uso in cui un link risulterebbe poco pratico: un'app nativa, un secondo dispositivo o un browser che altera i link.

```typescript
const { expiresInSeconds } = await client.auth.sendEmailOtp("user@example.com");

// L'indirizzo viene reinviato con il codice, poiché quest'ultimo è valido esclusivamente per esso.
const { user } = await client.auth.verifyEmailOtp("user@example.com", "418293");
```

Inviare l'indirizzo insieme al codice è ciò che limita i tentativi di indovinare le sei cifre a *un solo* account, anziché a tutti gli account contemporaneamente.

## Sessioni Anonime

Effettua l'accesso di un visitatore senza alcuna credenziale, permettendogli di iniziare a usare l'app prima ancora che abbia motivo di registrarsi:

```typescript
const { user } = await client.auth.signInAnonymously();
user.isAnonymous;   // true
```

L'account è reale: dispone di un ID, di ruoli e di una sessione, per cui la sicurezza a livello di riga (RLS) gestisce i permessi sui suoi record esattamente come farebbe per un utente registrato. Ciò che non ha è una via di ritorno: nessuno può effettuare nuovamente l'accesso *come* quell'utente, quindi tutto ciò che gli appartiene andrà perso al termine della sessione.

`linkAnonymous` serve per trasformarlo in un account permanente. L'utente **mantiene il proprio ID**, perciò tutto ciò che ha creato da anonimo rimane di sua proprietà:

```typescript
await client.auth.linkAnonymous("user@example.com", "correct-horse-battery");
```

| Errore | Significato |
|---------|-------|
| `ANONYMOUS_AUTH_DISABLED` (403) | Il backend non ha abilitato l'autenticazione anonima, oppure è stata disattivata dopo l'accesso dell'ospite: un ospite può diventare un account solo finché `allowAnonymous` è attivo |
| `REGISTRATION_DISABLED` (403) | Le registrazioni sono disabilitate nel backend, e convertire un ospite equivale a una registrazione |
| `NOT_ANONYMOUS` (400) | La sessione corrente appartiene già a un account standard |
| `EMAIL_EXISTS` (409) | L'indirizzo è già associato a un account — effettua invece l'accesso a quello |

Un ospite che non torna più rimane memorizzato come riga nel database. Un amministratore può eliminarlo tramite `client.admin.listGuests()`, `client.admin.deleteGuest(uid)` e `client.admin.deleteGuests({ lastSeenBefore })`, oppure su Rebase Cloud con [`rebase cloud guests`](/docs/cli/cloud/#guests). Questi comandi hanno effetto esclusivamente sugli ospiti, e `deleteGuests` opera a lotti: ripetilo finché `remaining` non è 0, impostando `offset` sul numero di record saltati finora.

## Collegare un Provider a un Account Esistente

`signInWithGoogle` e simili effettuano l'*accesso* dell'utente. `linkProvider` associa l'identità di un provider all'account attualmente autenticato, consentendo alla stessa persona di riaccedere tramite entrambi i metodi:

```typescript
await client.auth.linkProvider("google", { idToken });
```

La sessione dimostra già la titolarità dell'account; pertanto, a differenza del normale accesso, questo non richiede che il provider abbia verificato l'email, e i due indirizzi possono non coincidere. L'operazione ha esito positivo in modo idempotente (`alreadyLinked: true`) se quell'identità è già collegata a questo account, mentre viene rifiutata con `IDENTITY_ALREADY_LINKED` (409) se appartiene a un altro account.

## Ricerca di un Utente tramite Email

```typescript
const profile = await client.auth.findUserByEmail("user@example.com");
// { uid, displayName, photoURL } | null
```

Tre campi non sensibili e nient'altro — sufficienti per mostrare "Stai invitando Jane" prima che l'invito venga inviato. Richiede consenso esplicito: è accessibile solo da chiamanti autenticati e restituisce 404 a meno che il backend non abbia impostato `AUTH_ALLOW_USER_LOOKUP=true` (`auth.allowUserLookup`).

## Autenticazione a Più Fattori (MFA)

Registrazione di un fattore, secondo passaggio dell'accesso, codici di recupero e rimozione di un fattore: consulta [Autenticazione a Più Fattori](/docs/sdk/multi-factor-authentication/).

## Disconnessione (Sign Out)

```typescript
await client.auth.signOut();
```

Questa operazione revoca il refresh token sul server, cancella la sessione locale ed emette un evento `SIGNED_OUT`.

## Gestione della Sessione

### Ottenere la Sessione Corrente

```typescript
const session = client.auth.getSession();
// { accessToken, refreshToken, expiresAt, user } | null
```

**Non conservare mai l'oggetto sessione in memoria.** `getSession()` restituisce uno snapshot. A ogni rinnovo dell'access token, circa una volta all'ora, la sessione viene sostituita con un nuovo oggetto; quindi, una sessione mantenuta dal caricamento della pagina conterrà un token che il server rifiuterà una volta scaduto, facendo apparire l'app come disconnessa. Leggi la sessione al momento del bisogno.

### Inviare il Token alle Tue Route

Chiamare una funzione in `backend/functions/` non richiede la gestione manuale del token:
`client.functions.invoke` rinnova il token prima dell'invio ed effettua un nuovo tentativo in caso di errore 401.

```typescript
const saved = await client.functions.invoke("progress", { level: 3 }, { path: "save" });
```

Per qualsiasi altra richiesta, richiedi il token volta per volta con `getAccessToken()`.
Questa funzione rinnova un token scaduto o in scadenza, attende il ripristino della sessione al caricamento della pagina e restituisce `null` quando nessun utente è autenticato.

```typescript
const token = await client.auth.getAccessToken();
await fetch("https://other.example.com/upload", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: file
});
```

### Ottenere l'Utente Corrente (Verificato dal Server)

```typescript
const user = await client.auth.getUser();
// Fetches the user from the backend (GET /auth/me)
```

### Aggiornare il Profilo Utente

```typescript
const updatedUser = await client.auth.updateUser({
    displayName: "Jane Doe",
    photoURL: "https://example.com/avatar.jpg"
});
```

### Rinnovare il Token

Il rinnovo del token avviene automaticamente, ma puoi avviarlo manualmente:

```typescript
const session = await client.auth.refreshSession();
```

Una richiesta non parte mai con un token che il client sa essere già scaduto: le richieste condividono un unico ciclo di refresh e vengono inviate una sola volta, con il nuovo token. Un token che il server rifiuta anticipatamente ottiene comunque un tentativo di rinnovo, seguito da un singolo retry per ciascuna richiesta.

## Dove Risiede la Sessione: `authFlowMode`

```typescript
const client = createRebaseClient({
    baseUrl: API_URL,
    auth: { authFlowMode: "cookie" }
});
```

| Modalità | Dove si trova il refresh token | Predefinito |
|------|----------------------------|---------|
| `"cookie"` | Un cookie **HttpOnly** impostato dal backend. Gli script eseguiti nella tua pagina non possono leggerlo, il che lo rende protetto da attacchi XSS | Nel browser |
| `"json"` | Restituito nel corpo della risposta, conservato in `storage` (`localStorage` per impostazione predefinita) | Fuori dal browser (Node, worker, React Native) e nel browser quando passi un tuo `storage` personalizzato |

La modalità cookie richiede `auth.cookieAuth` nel backend: il runtime di Rebase (e quindi Rebase Cloud) lo attiva sempre e, dalla 0.30, anche `initializeRebaseBackend`, a meno che non imposti `cookieAuth: false`. La modalità json funziona con entrambi: le sue richieste di autenticazione includono l'header `x-rebase-auth-flow: json`, a cui si risponde con il refresh token nel body. Un backend precedente alla 0.29 non ne fornisce alcuno a un client json, quindi la sua sessione scade circa un'ora dopo e il client registra nei log quale modalità utilizzare (a meno che non sia stato passato uno `storage`).

Passare un tuo `storage` mantiene un client browser in modalità json, utile ad esempio per un secondo client che gestisce un accesso separato rispetto al cookie della pagina (come un ospite a fianco dell'account autenticato). Il suo refresh token risiede in tale storage, dove gli script della pagina possono leggerlo: mantieni quindi l'account principale della pagina in modalità cookie.

## Attendere il Ripristino della Sessione

**Una sessione ripristinata non è disponibile al primo rendering.** `getSession()` è sincrono, per cui al caricamento della pagina restituirà `null` finché il ripristino è in corso — e in modalità cookie un ripristino è *sempre* in corso, poiché il refresh token risiede in un cookie inaccessibile alla pagina, costringendo il client a richiedere al server un nuovo access token.

Leggerlo in modo sincrono è la causa del fastidioso sfarfallio ("logged-out flash") a ogni ricaricamento:

```typescript no-verify
// Wrong: renders the signed-out view for one round trip, every reload.
const session = client.auth.getSession();
if (!session) return <SignIn />;
```

`isInitialized()` si risolve una volta che il client ha terminato il tentativo — a prescindere dal fatto che abbia trovato una sessione o meno:

```typescript
async function currentUser() {
    await client.auth.isInitialized();
    return client.auth.getSession()?.user ?? null;
}
```

In React, si traduce in un semplice effetto:

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

`useRebaseAuthController` in `@rebasepro/app` esegue già questa logica, quindi le app create a partire dal template generato ne beneficiano automaticamente. Le richieste di dati non devono attendere: una richiesta inviata durante il ripristino viene spedita non appena questo si stabilizza — come utente ripristinato o come anonimo — evitando così che un primo rendering legga un elenco pubblico al posto dei dati riservati dell'utente.

Un ripristino che comporta un rinnovo (un token memorizzato scaduto o in modalità cookie) attiva l'evento `TOKEN_REFRESHED` in `onAuthStateChange`; un token memorizzato ancora valido viene adottato in modo trasparente. Di conseguenza, un listener non può segnalare la conclusione del ripristino: un avvio che non emette alcun evento è indistinguibile da uno ancora in esecuzione. Usa `await isInitialized()` per verificare l'inizializzazione e usa il listener per monitorare le variazioni successive.

`restoreOutcome()` indica come si è concluso il ripristino una volta che `isInitialized()` è stato risolto: `"restored"`, `"none"` (nulla da ripristinare), `"refused"` (il server ha rifiutato la sessione) o `"unreachable"` (il server non è stato raggiunto, quindi la sessione non è stata né confermata né rifiutata). In modalità cookie, il valore `"unreachable"` in assenza di sessione rappresenta l'unico caso in cui lo stato di "disconnesso" non è accertato:

```typescript
await client.auth.isInitialized();
if (!client.auth.getSession() && client.auth.restoreOutcome() === "unreachable") {
    console.log("Offline: could not check the session.");
}
```

## Listener dello Stato di Autenticazione

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

| Evento | Quando si verifica |
|-------|------|
| `SIGNED_IN` | È stato completato un accesso o una registrazione |
| `TOKEN_REFRESHED` | L'access token è stato rinnovato — compreso il rinnovo trasparente che ripristina la sessione al caricamento della pagina |
| `USER_UPDATED` | `updateUser()` ha modificato il profilo, `linkAnonymous()` ha promosso un ospite ad account, `changeEmail()` ha avviato un cambio di indirizzo oppure `confirmEmailChange()` ha trasferito questo account al nuovo indirizzo |
| `SIGNED_OUT` | Una disconnessione, una chiamata a `revokeAllSessions()` o un rinnovo fallito definitivamente |

## Gestione della Password

### Password Dimenticata

```typescript
const { success, message } = await client.auth.resetPasswordForEmail(
    "user@example.com"
);
```

### Reimposta Password (con Token)

```typescript
const { success, message } = await client.auth.resetPassword(
    resetToken,
    "newSecurePassword"
);
```

### Modifica Password (Autenticato)

```typescript
const { success, message } = await client.auth.changePassword(
    "oldPassword",
    "newPassword"
);
```

Tutte le altre sessioni dell'account vengono terminate: chiunque disponesse di una sessione attiva dovrà effettuare nuovamente l'accesso con la nuova password. Il dispositivo corrente rimane autenticato. Il server risponde fornendo una nuova sessione e il client la adotta (emettendo `TOKEN_REFRESHED`).

## Verifica dell'Email

Al momento della registrazione, se il servizio email è configurato, viene inviato all'account il link di verifica. `sendVerificationEmail()` lo invia nuovamente.

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

Il link certifica l'accesso alla casella di posta, non chi ha registrato l'indirizzo; pertanto, una password che né la sessione né la chiamata provano di conoscere viene rimossa anziché mantenuta — consulta [Verifica dell'email](/docs/backend/email-verification/).

Su un backend con `requireEmailVerification` attivo, `signUp()` restituisce `{ confirmationRequired: true, user: null }` e nessuna sessione: l'account potrà accedere una volta aperto il link inserendo la password.

## Modifica dell'Indirizzo Email

Un utente autenticato può trasferire il proprio account su un altro indirizzo email. Nessuna modifica ha effetto finché il nuovo indirizzo non conferma:

```typescript
// Mails a link to the new address, and a notice to the current one
const { pendingEmail, expiresAt } = await client.auth.changeEmail("jane@new.example");

// On the page the link opens (<frontend>/confirm-email-change?token=…):
const { email, removedProviders } = await client.auth.confirmEmailChange(token);
```

Il link ha una validità di 24 ore; `getUser()` riporta l'indirizzo in attesa di conferma come `pendingEmail`. La conferma non richiede una sessione attiva, e un client autenticato con quell'account adotta il nuovo indirizzo emettendo `USER_UPDATED`. I possibili motivi di rifiuto sono elencati in [Modifica di un indirizzo email](/docs/backend/auth-endpoints/#changing-an-email-address).

## Gestione della Sessione (Multi-Dispositivo)

```typescript
// List all active sessions, one per sign-in
const sessions = await client.auth.getSessions();
// [{ id, userAgent, ipAddress, createdAt, isCurrentSession }, …]

// Revoke a specific session
await client.auth.revokeSession(sessionId);

// Revoke ALL sessions (logs out everywhere)
await client.auth.revokeAllSessions();
```

Ogni access token identifica l'accesso a cui appartiene, pertanto esattamente una voce avrà `isCurrentSession: true`: il dispositivo che effettua la richiesta. Revocare una sessione invalida istantaneamente il refresh token e l'access token di quel dispositivo a partire dalla richiesta successiva, sia via HTTP che su connessioni socket realtime aperte. La disconnessione (`signOut()`) produce il medesimo effetto per il dispositivo che la esegue. Un access token emesso prima di questa versione non identifica alcuna sessione specifica: continuerà a funzionare fino alla sua scadenza naturale, entro l'ora.

## Configurazione di Autenticazione

Verifica la configurazione di autenticazione del backend:

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

## Storage della Sessione Personalizzato

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

## Utilizzo di un Proprio Provider di Autenticazione

Clerk, Firebase Auth o una sessione già presente nella tua applicazione, utilizzando un getter per i token al posto di `client.auth`: consulta [Un Proprio Provider di Autenticazione](/docs/sdk/your-own-auth-provider/).

## Struttura dell'Oggetto User

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

## Passaggi Successivi

- **[Interrogare i Dati](/docs/sdk/querying)** — Operazioni CRUD e query builder
- **[Sottoscrizioni Realtime](/docs/sdk/realtime)** — Dati in tempo reale tramite WebSocket
- **[Backend di Autenticazione](/docs/backend/authentication)** — Configurazione dell'autenticazione lato server
