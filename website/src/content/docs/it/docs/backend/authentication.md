---
title: Autenticazione
sidebar_label: Autenticazione
description: Configura l'autenticazione JWT, i provider OAuth, l'email SMTP, gli hook di autenticazione e gli adattatori di autenticazione personalizzati sul backend.
---

## Panoramica

Rebase include un sistema di autenticazione backend completo:

- **Token JWT** — Flusso di token di accesso e di refresh con scadenza configurabile
- **Provider OAuth** — Google, LinkedIn, GitHub, Microsoft, Apple e altri
- **Email SMTP** — Flussi di reimpostazione password e verifica email
- **Hook di autenticazione** — Hook del ciclo di vita per la creazione degli utenti e altro
- **Adattatori di autenticazione personalizzati** — Collega Firebase Auth, Auth0, Clerk o qualsiasi provider esterno
- **Chiave di servizio** — Chiave statica per l'autenticazione server-to-server
- **Auto-bootstrapping** — Il primo utente ottiene automaticamente il ruolo di amministratore

## Configurazione

Il blocco `auth` in `initializeRebaseBackend` controlla tutta l'autenticazione del backend:

```typescript no-verify
const backend = await initializeRebaseBackend({
    // ...
    auth: {
        collection: usersCollection,         // Your users collection definition
        jwtSecret: env.JWT_SECRET,           // Required — signing secret
        accessExpiresIn: "1h",               // Access token lifetime (default: 1h)
        refreshExpiresIn: "30d",             // Refresh token lifetime (default: 30d)
        serviceKey: env.REBASE_SERVICE_KEY,  // Optional — for server-to-server calls
        allowRegistration: true,             // Allow new signups (default: false)

        // OAuth providers
        google: env.GOOGLE_CLIENT_ID
            ? { clientId: env.GOOGLE_CLIENT_ID }
            : undefined,

        // SMTP email (for password reset, email verification)
        email: env.SMTP_HOST
            ? {
                from: env.SMTP_FROM || `${env.APP_NAME} <noreply@example.com>`,
                smtp: {
                    host: env.SMTP_HOST,
                    port: env.SMTP_PORT,              // 587 for TLS, 465 for SSL
                    secure: env.SMTP_SECURE,           // true for port 465
                    auth: env.SMTP_USER
                        ? { user: env.SMTP_USER, pass: env.SMTP_PASS! }
                        : undefined,
                    name: env.SMTP_NAME,               // Optional EHLO/HELO hostname
                },
                appName: env.APP_NAME,
                resetPasswordUrl: env.FRONTEND_URL,    // URL for password reset page
            }
            : undefined,

        // Lifecycle hooks
        hooks: {
            afterUserCreate: async (user) => {
                console.log(`New user registered: ${user.email}`);
            }
        }
    }
});
```

:::caution[I callback di collezione non si attivano per gli utenti di autenticazione]
La creazione e gli aggiornamenti degli utenti tramite il sistema di autenticazione — registrazione, gestione
degli utenti da parte dell'amministratore e OAuth — scrivono **direttamente** nell'archivio utenti e bypassano la
pipeline di salvataggio delle collezioni. Un callback `beforeSave`/`afterSave`/`beforeDelete`/`afterDelete`
sulla collezione di autenticazione (utenti) **non** verrà eseguito per questi percorsi. Per
effetti collaterali come il provisioning di un team personale alla registrazione, usa gli hook del ciclo di vita
di autenticazione (`afterUserCreate`, `beforeUserCreate`, `afterUserDelete`, …), che
ricevono il record utente completamente popolato.
:::

### Provider OAuth

Ogni provider OAuth viene configurato con almeno un `clientId`. Alcuni provider richiedono un `clientSecret`:

```typescript
auth: {
    google:    { clientId: "..." },
    linkedin:  { clientId: "...", clientSecret: "..." },
    github:    { clientId: "...", clientSecret: "..." },
    microsoft: { clientId: "...", clientSecret: "...", tenantId: "..." },
    apple:     { clientId: "...", teamId: "...", keyId: "...", privateKey: "..." },
    facebook:  { clientId: "...", clientSecret: "..." },
    twitter:   { clientId: "...", clientSecret: "..." },
    discord:   { clientId: "...", clientSecret: "..." },
    gitlab:    { clientId: "...", clientSecret: "..." },
    bitbucket: { clientId: "...", clientSecret: "..." },
    slack:     { clientId: "...", clientSecret: "..." },
    spotify:   { clientId: "...", clientSecret: "..." },
}
```

### Collegamento degli Account tra Metodi di Accesso

Cosa succede quando qualcuno si registra con email/password come
`ada@example.com` e in seguito fa clic su "Accedi con Google" con un account
Google che ha lo stesso indirizzo? Rebase **collega i due in un unico account**,
ma solo quando il provider dichiara l'email come verificata. Non crea mai in
silenzio un secondo account per lo stesso indirizzo.

Su `POST /api/auth/<provider>` l'ordine di risoluzione è:

1. **Identità del provider già nota**: se questa esatta identità del provider ha
   già effettuato l'accesso in precedenza, viene restituito quell'utente.
   L'email non viene consultata.
2. **Account esistente con la stessa email, verificata dal provider**:
   l'identità viene associata all'account esistente e l'utente vi accede. Un
   solo account, due modi per entrarci.
3. **Account esistente con la stessa email, NON verificata dal provider**:
   rifiutato con `403 EMAIL_NOT_VERIFIED`. Nulla viene creato o modificato.
4. **Nessun account con quell'email**: viene creato un nuovo account.

Il passo 3 è il caso critico per la sicurezza. Se un'email non verificata del
provider bastasse per il collegamento, chiunque riuscisse a far emettere a un
provider un indirizzo non suo potrebbe impossessarsi del corrispondente account
Rebase. Google dichiara sempre `email_verified` per gli account Google reali,
quindi il passo 2 è il percorso normale per l'accesso con Google; il passo 3
riguarda soprattutto i provider che consentono all'utente di indicare un
indirizzo arbitrario non confermato.

Questo comportamento non è configurabile: deliberatamente non esiste alcuna
opzione per collegare account su email non verificate.

Per rimediare a un rifiuto del passo 3, l'utente accede con il proprio metodo
esistente e chiama l'endpoint di collegamento esplicito:

```http
POST /api/auth/link/google
Authorization: Bearer <access token>

{ "idToken": "..." }
```

Il collegamento effettuato da autenticati intenzionalmente **non** richiede
un'email verificata, e non richiede nemmeno che le email coincidano: l'indirizzo
Google di un utente spesso non è quello che usa nell'applicazione. L'asimmetria
è voluta: in fase di accesso l'email del provider è l'unica prova che lega
l'identità in arrivo a un account, mentre qui il chiamante ha già dimostrato di
esserne il proprietario possedendo una sessione valida. Restituisce
`409 IDENTITY_ALREADY_LINKED` se quell'identità del provider appartiene a un
altro utente, ed è idempotente se è già collegata al chiamante.

#### La direzione inversa

Un utente che si è registrato con Google e non ha una password:

- **La registrazione con la stessa email** viene rifiutata con
  `409 EMAIL_EXISTS`.
- **`POST /api/auth/change-password`** restituisce `400 INVALID_ACCOUNT`: non
  esiste alcuna password precedente con cui effettuare la verifica.
- **`forgot-password` → `reset-password` è il modo supportato per aggiungerne
  una.** Dimostra nuovamente via email la proprietà dell'indirizzo, dopodiché
  l'account dispone di entrambi i metodi di accesso.

## Endpoint di Autenticazione

Tutti gli endpoint di autenticazione sono montati su `/api/auth/`:

| Metodo | Percorso | Descrizione |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Creare un nuovo account |
| `POST` | `/api/auth/login` | Accedere con email/password |
| `POST` | `/api/auth/refresh` | Aggiornare il token di accesso |
| `POST` | `/api/auth/<provider>` | Accesso OAuth (ad es. `/api/auth/google`, `/api/auth/linkedin`) |
| `POST` | `/api/auth/link/<provider>` | Collegare un provider OAuth all'account autenticato |
| `POST` | `/api/auth/logout` | Revocare il refresh token |
| `POST` | `/api/auth/forgot-password` | Inviare l'email di reimpostazione password |
| `POST` | `/api/auth/reset-password` | Reimpostare la password con un token |
| `POST` | `/api/auth/find-user` | Risolvere un'email in un profilo pubblico minimo (opt-in) |

Tutti gli endpoint dell'API dati richiedono un header `Authorization: Bearer <token>` valido quando `requireAuth: true` (il valore predefinito).

### Formato della risposta

Ogni endpoint che emette una sessione risponde con lo stesso involucro:
`register`, `login`, ogni provider OAuth, `magic-link/verify`, `otp/verify`,
`anonymous`, `anonymous/link` e `mfa/challenge/verify`.

```json
{
  "user": {
    "uid": "8f1c2a6e-…",
    "email": "jane@example.com",
    "displayName": "Jane Doe",
    "photoURL": null,
    "providerId": "password",
    "isAnonymous": false,
    "emailVerified": true,
    "roles": ["editor"],
    "metadata": {}
  },
  "tokens": {
    "accessToken": "eyJhbGciOi…",
    "refreshToken": "9b2e…",
    "accessTokenExpiresAt": 1700000000000
  }
}
```

Rimanda indietro il token di accesso come `Authorization: Bearer <accessToken>`.
`accessTokenExpiresAt` è espresso in millisecondi dall'epoch.

`POST /api/auth/refresh` risponde con lo stesso involucro, con due avvertenze:
`user` viene omesso del tutto quando l'account non può essere riletto, quindi lì
va trattato come opzionale, e `providerId` è sempre `password`, qualunque sia il
metodo con cui la sessione è stata creata.

:::caution[L'SDK client appiattisce questo involucro — l'HTTP grezzo no]
Il JSON qui sopra è il formato che viaggia sulla rete, ed è ciò che restituisce
`fetch("/api/auth/login")`: il token si trova in **`body.tokens.accessToken`**.

L'[SDK client](/docs/sdk/authentication) scarta `tokens` prima di restituirti la
sessione, così `auth.signInWithEmail()` risolve invece un
**`{ user, accessToken, refreshToken }`** appiattito.

Entrambe le forme sono reali: appartengono a due livelli diversi. Leggere la
forma dell'SDK da un `fetch` grezzo produce `undefined`, che si manifesta come
«l'accesso è riuscito ma non c'è alcun token di accesso»: l'accesso era corretto,
il token era un livello più in basso.
:::

Con `cookieAuth` abilitato il refresh token viaggia come cookie `httpOnly` e
`tokens.refreshToken` è una stringa vuota nel corpo. Il token di accesso non è
influenzato.

### Invitare i compagni di team via email

I flussi di invito devono trasformare un indirizzo email in un ID utente, ma la collezione `users`
è protetta da RLS dal client. Invece di creare a mano una funzione server di
amministrazione, attiva la ricerca integrata:

```typescript no-verify
await initializeRebaseBackend({
    auth: {
        // ...
        allowUserLookup: true,   // enables POST /api/auth/find-user
    },
});
```

Poi, dal client:

```typescript
const profile = await client.auth.findUserByEmail("teammate@example.com");
// → { uid, displayName, photoURL } | null   (never email/roles/metadata)
if (profile) {
    await client.data.team_members.create({ team_id, userId: profile.uid });
}
```

L'endpoint è **solo per utenti autenticati** e restituisce solo `uid`, `displayName`
e `photoURL` — mai l'email, i ruoli o i metadati dell'utente cercato. È
**disattivato per impostazione predefinita** perché consente a qualsiasi utente autenticato di sondare quali email hanno
account; abilitalo solo quando la tua UX di invito lo richiede.

## Tabelle Create Automaticamente

Al primo avvio, Rebase provisiona automaticamente lo schema `auth` e le seguenti tabelle nel database (legate allo schema definito nella tua collezione, ad es. `rebase`):

- **`rebase.users`** — Account utente con email, hash della password, metadati e una colonna `roles` text[] (i ruoli sono archiviati come array di testo inline per ottimizzare le query ed evitare join).
- **`rebase.refresh_tokens`** — Sessioni di lunga durata che trasportano refresh token hashati, user agent e indirizzi IP. Include un indice univoco su `token_hash` e un vincolo univoco su `(userId, user_agent, ip_address)` per tracciare le sessioni dei dispositivi attive.
- **`rebase.password_reset_tokens`** — Token monouso scadibili per i flussi di recupero password.
- **`rebase.mfa_factors`** — Metodi di autenticazione a più fattori registrati (ad es. segreti TOTP cifrati con AES-256).
- **`rebase.mfa_challenges`** — Log di verifica che tracciano i tentativi di verifica MFA attivi.
- **`rebase.recovery_codes`** — Codici di backup/recupero a più fattori hashati.
- **`rebase.app_config`** — Archivio chiave-valore per le configurazioni di sistema.

## Contesto Database della Sicurezza a Livello di Riga (RLS)

Rebase collega l'autenticazione della richiesta direttamente fino alla sicurezza a livello di riga (RLS) di PostgreSQL. Ogni query del database eseguita tramite un driver con ambito utente viene eseguita all'interno di una transazione del database (`db.transaction()`) che configura parametri di configurazione locali alla transazione:

*   `app.userId` — L'ID univoco (`uid`) dell'utente autenticato. Il valore predefinito è `'anon'` per le richieste non autenticate.
*   `app.user_roles` — Una stringa separata da virgole che elenca i ruoli assegnati all'utente.
*   `app.jwt` — Una stringa JSON contenente il payload completo dei claim del JWT (`{"sub": "<uid>", "roles": [...]}`).

Questi parametri vengono configurati localmente per la durata della transazione usando la funzione `set_config` di Postgres:
```sql
SELECT 
    set_config('app.userId', $1, true),
    set_config('app.user_roles', $2, true),
    set_config('app.jwt', $3, true);
```

### Funzioni di Supporto per le Politiche PostgreSQL

Per rendere semplice la scrittura delle politiche di sicurezza a livello di riga, Rebase crea funzioni di supporto sotto lo schema `auth` durante il bootstrapping del database:

*   **`rebase.uid()`** — Restituisce l'ID dell'utente autenticato come `text`, o `NULL` se non impostato:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.uid() RETURNS text AS $$
        SELECT NULLIF(current_setting('app.user_id', true), '');
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.roles()`** — Restituisce la stringa dei ruoli separata da virgole:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.roles() RETURNS text AS $$
        SELECT COALESCE(NULLIF(current_setting('app.user_roles', true), ''), '');
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.jwt()`** — Restituisce il payload completo del JWT come oggetto `jsonb`:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.jwt() RETURNS jsonb AS $$
        SELECT COALESCE(NULLIF(current_setting('app.jwt', true), ''), '{}')::jsonb;
    $$ LANGUAGE sql STABLE;
    ```

Puoi usare questi helper direttamente nelle tue regole di sicurezza personalizzate o nelle migrazioni del database:
```sql
CREATE POLICY owner_access ON posts
    FOR ALL
    TO public
    USING (author_id = rebase.uid() OR string_to_array(rebase.roles(), ',') && ARRAY['admin']);
```

## Bootstrap del Primo Utente

Quando non esistono utenti nel database, la prima persona che si registra diventa automaticamente un amministratore. Dopodiché, la registrazione è controllata dall'impostazione `allowRegistration`.

Questo garantisce che tu possa sempre inizializzare un nuovo deployment senza dover popolare manualmente il database. Per prevenire esecuzioni concorrenti e race condition nella generazione dello schema durante l'hot reloading (HMR) o l'avvio, le operazioni di bootstrapping vengono sincronizzate usando un advisory lock di Postgres:
```sql
SELECT pg_advisory_xact_lock(hashtext('rebase_auth_functions_init'));
```

## Configurazione dell'Autenticazione a Livello di Collezione

Invece di affidarti esclusivamente alle regole di autenticazione predefinite del database, puoi contrassegnare qualsiasi collezione Postgres (come `users.ts` o una collezione personalizzata `members.ts`) come collezione di autenticazione. Questo viene configurato tramite la proprietà `auth` sulla collezione stessa:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const membersCollection = defineCollection({
  name: "Members",
  slug: "members",
  table: "members",
  auth: {
    enabled: true,
    
    // Customize what happens when an admin creates a user via the REST API
    onCreateUser: async (values, ctx) => {
      const hash = await ctx.hashPassword("welcome123");
      return {
        values: { ...values, passwordHash: hash, emailVerified: true },
        temporaryPassword: "welcome123"
      };
    },

    // Customize what happens when an admin resets a user's password in the admin panel
    onResetPassword: async (userId, ctx) => {
      const tempPassword = "reset_" + Math.random().toString(36).substring(2, 8);
      return {
        temporaryPassword: tempPassword,
        invitationSent: false
      };
    },

    // Inject/override auth-specific actions (e.g. show/hide the reset password button)
    actions: {
      resetPassword: true // Or false to disable, or a custom EntityAction
    }
  },
  properties: { ... }
});
```

Quando vengono chiamati gli hook personalizzati (`onCreateUser`, `onResetPassword`), ricevono una facciata `AuthCollectionContext` contenente:
- `hashPassword(password: string): Promise<string>` — Esegue l'hash della password usando l'algoritmo di hashing configurato (ad es. scrypt).
- `sendEmail?: (options) => Promise<void>` — Invia un'email (disponibile solo quando il servizio email è configurato).
- `emailConfigured: boolean` — Se il servizio email è configurato.
- `appName: string` — Il nome dell'app dalla configurazione email.
- `resetPasswordUrl: string` — L'URL di base del link di reimpostazione password.

## Autenticazione con Chiave di Servizio

Per la comunicazione server-to-server (ad es. cron job, servizi esterni), configura una chiave di servizio statica:

```typescript
auth: {
    serviceKey: process.env.REBASE_SERVICE_KEY,
    // ...
}
```

I client si autenticano con l'header `Authorization: Bearer <service-key>`. 

### Chiave Interna Per-Avvio

Se `REBASE_SERVICE_KEY` non è fornito nella tua configurazione, Rebase genera automaticamente una **chiave interna per-avvio** casuale. 

Questa chiave non viene mai registrata nei log e non lascia mai il processo. Viene usata dal singleton `rebase` per autenticarsi contro le API del control-plane del server stesso (auth, storage, ecc.). Questo garantisce che le attività amministrative (come l'invio di un'email di benvenuto o la generazione di un URL di archiviazione) funzionino sempre immediatamente in sviluppo e produzione senza richiedere una gestione manuale delle chiavi.

### Protezione dagli Attacchi Temporali e Requisiti della Chiave

Per prevenire attacchi temporali, Rebase valida sia la chiave di servizio configurata dall'utente sia la chiave interna usando un confronto di stringhe a tempo costante (`safeCompare`). La chiave di servizio configurata dall'utente **deve essere lunga almeno 32 caratteri**; se viene configurata una chiave più corta di 32 caratteri, Rebase genererà un errore di configurazione all'avvio e fallirà in modo chiuso (fail-closed).


## Adattatori di Autenticazione Personalizzati

Rebase consente la sostituzione completa del sistema di autenticazione integrato tramite un'architettura di autenticazione collegabile. Questo disaccoppia la verifica dell'autenticazione dai livelli database e REST/WebSocket, consentendo un'integrazione fluida con provider esterni come **Clerk**, **Auth0**, **Firebase Auth** o servizi di identità JWT personalizzati.

### Il Contratto AuthAdapter

Puoi implementare direttamente l'interfaccia `AuthAdapter` per un controllo completo. La definizione dell'interfaccia è la seguente:

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";
import { AuthenticatedUser, AuthAdapterCapabilities, UserManagementAdapter, UserCreationPrepareResult, UserCreationFinalizeResult } from "@rebasepro/types";

export interface AuthAdapter {
  /** Unique identifier for this auth adapter (e.g., "clerk", "custom") */
  readonly id: string;

  /**
   * Verifies an incoming HTTP request and returns the authenticated user payload.
   * Called by Hono authentication middleware on every REST endpoint.
   */
  verifyRequest(request: Request): Promise<AuthenticatedUser | null>;

  /**
   * Verifies a raw token string (e.g. for WebSocket connection handshake phase 1).
   * If omitted, a synthetic request is automatically constructed.
   */
  verifyToken?(token: string): Promise<AuthenticatedUser | null>;

  /** Optional user management operations (CRUD) for the Admin Dashboard panel */
  userManagement?: UserManagementAdapter;

  /** Optional: Mount adapter-specific custom public routes (e.g. callback paths) */
  createAuthRoutes?(): Hono<any, any, any> | undefined;

  /** Optional: Mount adapter-specific admin-only routes */
  createAdminRoutes?(): Hono<any, any, any> | undefined;

  /** Advertise supported capabilities (to customize Admin Dashboard UI visibility) */
  getCapabilities(): AuthAdapterCapabilities | Promise<AuthAdapterCapabilities>;

  /** Lifecycle hooks called during backend start and graceful shutdown */
  initialize?(): Promise<void>;
  destroy?(): Promise<void>;

  /** Custom user lifecycle hooks (e.g., hash passwords before collection writes) */
  prepareUserCreation?(
    values: Record<string, unknown>,
    collectionAuth?: unknown
  ): Promise<UserCreationPrepareResult>;

  finalizeUserCreation?(
    entity: { id: string; values: Record<string, unknown> },
    clearPassword?: string
  ): Promise<UserCreationFinalizeResult>;

  /** Static service key to bypass checks for server-to-server calls */
  serviceKey?: string;
}
```

### Il Payload dell'Utente Autenticato

Indipendentemente dal provider di autenticazione esterno scelto, il tuo adattatore deve risolvere le verifiche di token riuscite in un oggetto `AuthenticatedUser` uniforme. Il Rebase RLS Scope Injector mappa questi valori direttamente alle variabili di sessione di PostgreSQL all'interno delle transazioni:

```typescript
export interface AuthenticatedUser {
  uid: string;                    // Maps to pg local 'app.userId' -> rebase.uid()
  email: string;                  // User email address
  displayName?: string | null;    // Optional display name
  photoUrl?: string | null;        // Optional avatar URL
  roles: string[];                // Maps to pg local 'app.user_roles' -> rebase.roles()
  isAdmin: boolean;               // Grants global superuser privileges if true
  rawToken?: string;              // The original token string (for downstream forwarding)
  claims?: Record<string, any>;   // Custom claims/metadata (available in rebase.jwt())
}
```

---

### Integrazione Rapida tramite `createCustomAuthAdapter`

Per scenari standard (come la validazione di JWT da un servizio di terze parti), puoi usare l'utility `createCustomAuthAdapter`. Questa utility gestisce i valori predefiniti delle capabilities e implementa la validazione dei token WebSocket immediatamente, avvolgendo la tua implementazione di `verifyRequest`.

#### Esempio: Integrazione con Clerk

Per connettere un backend Rebase con **Clerk**, puoi verificare i token JWT di Clerk usando il JSON Web Key Set (JWKS) di Clerk:

```typescript no-verify
import { initializeRebaseBackend } from "@rebasepro/server";
import { createCustomAuthAdapter } from "@rebasepro/server";
import { createRemoteJWKSet, jwtVerify } from "jose";

// Clerk JWKS URL
const CLERK_JWKS_URL = "https://clerk.your-domain.com/.well-known/jwks.json";
const JWKS = createRemoteJWKSet(new URL(CLERK_JWKS_URL));

const clerkAuthAdapter = createCustomAuthAdapter({
    serviceKey: process.env.REBASE_SERVICE_KEY,
    verifyRequest: async (request) => {
        const authHeader = request.headers.get("Authorization");
        const token = authHeader?.replace("Bearer ", "");
        if (!token) return null;

        try {
            // Verify Clerk JWT token against JWKS
            const { payload } = await jwtVerify(token, JWKS);
            
            const metadata = payload.metadata as Record<string, unknown> | undefined;
            const roles = Array.isArray(metadata?.roles) ? metadata.roles as string[] : [];
            
            return {
                uid: payload.sub!,
                email: (payload as Record<string, unknown>).email as string || "",
                displayName: (payload as Record<string, unknown>).name as string || null,
                roles: roles,
                isAdmin: roles.includes("admin"),
                claims: payload as Record<string, unknown>
            };
        } catch (error) {
            console.error("Clerk token verification failed:", error);
            return null; // Fail-closed
        }
    },
    capabilities: {
        hasBuiltInAuthRoutes: false, // Login is managed by Clerk UI
        emailPasswordLogin: false,
        registrationEnabled: false,
        passwordReset: false,
        profileUpdate: false,
        sessionManagement: false
    }
});

const backend = await initializeRebaseBackend({
    auth: clerkAuthAdapter,
    // ...
});
```

#### Esempio: Integrazione con Firebase Auth

Per verificare i token di Firebase Auth usando i certificati pubblici di Firebase:

```typescript no-verify
import { initializeRebaseBackend } from "@rebasepro/server";
import { createCustomAuthAdapter } from "@rebasepro/server";
import { createRemoteJWKSet, jwtVerify } from "jose";

const FIREBASE_JWKS_URL = "https://www.googleapis.com/robot/v1/metadata/jwk/securetoken@system.gserviceaccount.com";
const JWKS = createRemoteJWKSet(new URL(FIREBASE_JWKS_URL));
const FIREBASE_PROJECT_ID = "my-firebase-project-id";

const firebaseAuthAdapter = createCustomAuthAdapter({
    serviceKey: process.env.REBASE_SERVICE_KEY,
    verifyRequest: async (request) => {
        const authHeader = request.headers.get("Authorization");
        const token = authHeader?.replace("Bearer ", "");
        if (!token) return null;

        try {
            const { payload } = await jwtVerify(token, JWKS, {
                issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
                audience: FIREBASE_PROJECT_ID
            });

            const roles = Array.isArray((payload as Record<string, unknown>).roles) ? (payload as Record<string, unknown>).roles as string[] : [];

            return {
                uid: payload.sub!,
                email: (payload as Record<string, unknown>).email as string || "",
                displayName: (payload as Record<string, unknown>).name as string || null,
                photoUrl: (payload as Record<string, unknown>).picture as string || null,
                roles: roles,
                isAdmin: roles.includes("admin"),
                claims: payload as Record<string, unknown>
            };
        } catch (error) {
            console.error("Firebase token verification failed:", error);
            return null;
        }
    }
});

const backend = await initializeRebaseBackend({
    auth: firebaseAuthAdapter,
    // ...
});
```

---

### Montaggio delle Route di Autenticazione e delle Azioni della UI Admin

Se il tuo provider di autenticazione personalizzato richiede il montaggio di endpoint di reindirizzamento (come route di callback OAuth o loop di login SAML), implementa il metodo `createAuthRoutes` sul tuo adattatore:

```typescript
const myOauthAdapter: AuthAdapter = {
    id: "custom-oauth",
    verifyRequest: async (req) => ({
        // validate the token, then return the caller
        uid: "…",
        email: "user@example.com",
        roles: [],
        isAdmin: false
    }),
    getCapabilities: () => ({
        hasBuiltInAuthRoutes: true,
        emailPasswordLogin: false,
        registrationEnabled: false,
        passwordReset: false,
        adminPasswordReset: false,
        sessionManagement: false,
        profileUpdate: false,
        emailVerification: false,
        magicLink: false,
        anonymousLogin: false,
        enabledProviders: []
    }),
    createAuthRoutes: () => {
        const app = new Hono<HonoEnv>();
        
        // Mounted automatically under /api/auth/callback
        app.get("/callback", async (c) => {
            const code = c.req.query("code");
            // Exchange code for provider tokens and set cookies/redirect
            return c.redirect("/dashboard");
        });
        
        return app;
    }
};
```

Se desideri consentire operazioni CRUD sugli utenti direttamente all'interno della Rebase Admin Dashboard, implementa l'helper `userManagement` all'interno delle opzioni dell'adattatore, che fornisce hook per `listUsers`, `createUser`, `updateUser` e `deleteUser`.


## Prossimi Passi

- **[Autenticazione Frontend](/docs/frontend/authentication)** — UI di login, controller di autenticazione, gestione utenti
- **[Regole di Sicurezza (RLS)](/docs/collections/security-rules)** — Controllo dell'accesso a livello di riga
- **[Autenticazione del SDK Client](/docs/sdk/authentication)** — Metodi di autenticazione nel SDK client
