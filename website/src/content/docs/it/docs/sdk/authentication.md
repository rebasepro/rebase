---
sourceHash: 08f462e8a9e1a008
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
const { user } = await client.auth.signUp(
    "user@example.com",
    "password",
    "Jane Doe"   // optional displayName
);
```

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

Un link di accesso con un clic inviato via email. Il link reindirizza a una tua pagina che trasporta un token; restituisci il token per scambiarlo con una sessione.

```typescript
// 1. Ask for the link. `redirectTo` is where the link points.
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
| `ANONYMOUS_AUTH_DISABLED` (403) | Il backend non ha abilitato l'autenticazione anonima |
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

Tre campi non sensibili e nient'altro — sufficienti per mostrare "stai invitando Jane" prima che venga inviato un invito.

## Autenticazione a più fattori (MFA)

Fattori TOTP — un'app di autenticazione — più la richiesta di verifica (challenge) che eleva una sessione da `aal1` a `aal2`.

### Registrazione di un fattore

```typescript
const { factor, totp, recoveryCodes } = await client.auth.mfa.enroll({
    friendlyName: "Phone"
});

showQrCode(totp.uri);        // otpauth://… — what the authenticator scans
showRecoveryCodes(recoveryCodes);
```

**Mostra i codici di recupero una sola volta e mai più.** Vengono memorizzati solo i relativi hash, quindi nulla potrà mostrarli in seguito.

Il fattore non è utilizzabile finché l'utente non dimostra che il proprio autenticatore ha generato un codice a partire da quel segreto:

```typescript
await client.auth.mfa.verify(factor.id, "418293");
```

### Accesso con MFA

L'accesso a un account con MFA registrata non restituisce alcuna sessione. Viene rifiutato con `401 MFA_REQUIRED`, e i `details` dell'errore contengono un `mfaToken` e i `factors` verificati dell'account. Passa quel token a `challenge` e `verifyChallenge` per ottenere la sessione:

```typescript
import { RebaseApiError } from "@rebasepro/client";

type MfaRequired = {
    mfaToken: string;
    factors: { id: string; factorType: string; friendlyName?: string }[];
};

try {
    await client.auth.signInWithEmail(email, password);
} catch (e) {
    if (!(e instanceof RebaseApiError) || e.code !== "MFA_REQUIRED") throw e;
    const { mfaToken, factors } = e.details as MfaRequired;

    const { challengeId } = await client.auth.mfa.challenge(factors[0].id, { mfaToken });

    // A TOTP code, or one of the recovery codes.
    const { user } = await client.auth.mfa.verifyChallenge(challengeId, "418293", { mfaToken });
}
```

Il `mfaToken` viene inviato solo con queste due richieste e non viene mai installato sul client. `verifyChallenge` genera la sessione `aal2`, questo client la adotta ed emette `SIGNED_IN` come per qualsiasi altro accesso. Il `mfaToken` scade cinque minuti dopo l'accesso che lo ha restituito, e un challenge cinque minuti dopo la sua apertura. Un challenge che ha raggiunto il limite massimo di tentativi rimane esaurito per il resto della sua validità — altrimenti un challenge aperto consentirebbe tentativi illimitati di indovinare le sei cifre.

Senza `mfaToken`, le due chiamate elevano la sessione che questo client possiede già da `aal1` ad `aal2`.

### Rimozione di un fattore

```typescript
await client.auth.mfa.unenroll(factorId);
```

Richiede una sessione `aal2` — ovvero una sessione che ha già risposto a un challenge — in modo che un token `aal1` sottratto non possa disattivare l'MFA. La rimozione dell'ultimo fattore verificato elimina anche i codici di recupero.

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

`useRebaseAuthController` in `@rebasepro/app` esegue già questa operazione, quindi un'applicazione creata sul template generato ne dispone automaticamente.

Un ripristino riuscito raggiunge anche `onAuthStateChange` come `TOKEN_REFRESHED` — *è* a tutti gli effetti un refresh — ma un listener da solo non può indicare che il ripristino è terminato: un avvio senza sessione non emette alcunché, risultando indistinguibile da un avvio ancora in corso. Attendi `isInitialized()` per verificare questo stato e usa il listener per le modifiche successive.

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
| `USER_UPDATED` | `updateUser()` ha modificato il profilo |
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

## Verifica dell'email

```typescript
// Send verification email to the current user
await client.auth.sendVerificationEmail();

// Verify with the token from the email link
await client.auth.verifyEmail(token);
```

## Gestione delle sessioni (multi-dispositivo)

```typescript
// List all active sessions
const sessions = await client.auth.getSessions();

// Revoke a specific session
await client.auth.revokeSession(sessionId);

// Revoke ALL sessions (logs out everywhere)
await client.auth.revokeAllSessions();
```

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
//   magicLink: boolean,
//   anonymousLogin: boolean,
//   enabledProviders: string[],
//   needsSetup: boolean
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
    roles?: string[];          // text[] from the users table
    metadata?: Record<string, unknown>;
}
```

## Passaggi successivi

- **[Interrogazione dei dati](/docs/sdk/querying)** — Operazioni CRUD e query builder
- **[Sottoscrizioni in tempo reale](/docs/sdk/realtime)** — Dati in tempo reale con WebSocket
- **[Backend di autenticazione](/docs/backend/authentication)** — Configurazione dell'autenticazione lato server
