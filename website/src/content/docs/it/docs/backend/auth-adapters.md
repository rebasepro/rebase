---
sourceHash: 939f091d469cc389
title: Adapter di autenticazione personalizzati
sidebar_label: Adapter di autenticazione personalizzati
description: Sostituisci l'autenticazione integrata di Rebase con Clerk, Firebase Auth o il tuo provider di identità implementando il contratto AuthAdapter.
---

Rebase include una propria autenticazione — [configurala qui](/docs/backend/authentication/). Questa pagina tratta l'altro caso: un identity provider già in uso o a pagamento.

## Adapter di autenticazione personalizzati

Rebase consente la sostituzione completa del sistema di autenticazione integrato tramite un'architettura di autenticazione modulare. Ciò disaccoppia la verifica dell'autenticazione dal database e dai livelli REST/WebSocket, consentendo un'integrazione trasparente con provider esterni quali **Clerk**, **Auth0**, **Firebase Auth** o servizi di identità JWT personalizzati.

### Il contratto AuthAdapter

È possibile implementare direttamente l'interfaccia `AuthAdapter` per ottenere il pieno controllo. L'interfaccia, in forma abbreviata (la definizione completa, con gli hook opzionali per l'amministrazione degli utenti e `transformAuthResponse`, corrisponde a `AuthAdapter` in `@rebasepro/types`):

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

  /**
   * The identity an account would carry right now, with no credential.
   * Without it, a request that impersonates another user is refused.
   */
  resolveUser?(uid: string): Promise<AuthenticatedUser | null>;

  /** Optional user management operations (CRUD) for the panel */
  userManagement?: UserManagementAdapter;

  /** Optional: Mount adapter-specific custom public routes (e.g. callback paths) */
  createAuthRoutes?(): Hono<any, any, any> | undefined;

  /** Optional: Mount adapter-specific admin-only routes */
  createAdminRoutes?(): Hono<any, any, any> | undefined;

  /** Advertise supported capabilities (to customize what the panel shows) */
  getCapabilities(): AuthAdapterCapabilities | Promise<AuthAdapterCapabilities>;

  /** Lifecycle hooks called during backend start and graceful shutdown */
  initialize?(): Promise<void>;
  destroy?(): Promise<void>;

  /** Custom user lifecycle hooks (e.g., hash passwords before users-table writes) */
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

### L'adapter determina il chiamante ovunque

<span class="since-badge" data-since="0.31">Da 0.31</span>

`verifyRequest` è l'unico punto in cui il backend verifica chi ha inviato una richiesta. Le route di dati e funzioni lo interrogano, così come `GET /api/schema/tables`, il documento OpenAPI su `/api/docs` e ogni interfaccia di amministrazione sotto `/api/admin` (preferenze dell'interfaccia utente, modifica dello schema in tempo reale, editor dello schema, cron, log, backup e il resto). Una chiave API (`rk_`) o un token di piattaforma (`rpt_`) viene comunque risolto da Rebase prima di interrogare l'adapter. Una credenziale non riconosciuta dall'adapter genera un `401`, non viene mai interpretata come utente anonimo; una richiesta priva di credenziali è considerata anonima, a cui l'endpoint dello schema e il documento rispondono con `401` (a meno che non sia impostato `schemaTables.public`) e le interfacce di amministrazione rispondono sempre con `401`. I ruoli restituiti dall'adapter determinano la descrizione del chiamante e se un'interfaccia di amministrazione ne consente l'accesso (`403` quando manca lo scope richiesto). Un adapter che genera un errore corrisponde al rifiuto del chiamante, mai a un `500`. Consulta [Schema](/docs/backend/endpoints/#schema).

Prima della versione 0.31, l'endpoint dello schema, il documento e le interfacce di amministrazione verificavano esclusivamente il JWT del framework, pertanto un backend con un proprio adapter rispondeva con `500` e il relativo pannello di amministrazione non veniva caricato.

### Il payload dell'utente autenticato

Indipendentemente dal provider di autenticazione esterno scelto, l'adapter deve convertire le verifiche dei token riuscite in un oggetto `AuthenticatedUser` uniforme. L'RLS Scope Injector di Rebase mappa direttamente questi valori nelle variabili di sessione di PostgreSQL all'interno delle transazioni:

```typescript
export interface AuthenticatedUser {
  uid: string;                    // Maps to pg local 'app.uid' -> rebase.uid()
  email: string;                  // User email address
  displayName?: string | null;    // Optional display name
  photoUrl?: string | null;        // Optional avatar URL
  roles: string[];                // Maps to pg local 'app.user_roles' -> rebase.roles()
  isAdmin: boolean;               // Informational: authorization reads `roles` (give the `admin` role)
  isAnonymous?: boolean;          // A guest session. Maps to 'app.is_anonymous' -> rebase.is_anonymous()
  rawToken?: string;              // The original token string (for downstream forwarding)
  claims?: Record<string, any>;   // Custom claims/metadata (available in rebase.jwt())
  scopes?: string[];              // Narrower than the user's roles (set for an API key)
}
```

---

### Integrazione rapida tramite `createCustomAuthAdapter`

Per gli scenari standard (come la convalida di JWT provenienti da un servizio di terze parti), è possibile utilizzare l'utility `createCustomAuthAdapter`. Questa utility gestisce i valori predefiniti delle funzionalità e implementa la convalida dei token WebSocket out-of-the-box eseguendo il wrapping dell'implementazione di `verifyRequest`.

#### Esempio: integrazione con Clerk

Per connettere un backend Rebase con **Clerk**, è possibile verificare i token JWT di Clerk utilizzando il JSON Web Key Set (JWKS) di Clerk:

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

#### Esempio: integrazione con Firebase Auth

Per verificare i token di Firebase Auth utilizzando i certificati pubblici di Firebase:

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

#### La parte client

L'adapter verifica il token del provider; il client deve inviarlo. Fornisci al client Rebase un getter per ottenerlo, una sola volta:

```typescript
client.setAuthTokenGetter(() => clerk.session?.getToken() ?? Promise.resolve(null));
```

Con Firebase Auth il getter è `() => auth.currentUser?.getIdToken() ?? Promise.resolve(null)`. Il client lo richiede per ogni richiesta HTTP e ogni volta che il socket in tempo reale esegue l'autenticazione, in modo che le live query vengano eseguite con lo stesso utente delle chiamate REST. Nel pannello di amministrazione, impostalo sul client passato a `<Rebase client>`. Consulta [Il tuo provider di autenticazione](/docs/sdk/your-own-auth-provider/).

---

### Montaggio delle route di autenticazione e azioni del pannello

Se il tuo provider di autenticazione personalizzato richiede il montaggio di endpoint di reindirizzamento (come route di callback OAuth o flussi di login SAML), implementa il metodo `createAuthRoutes` sul tuo adapter:

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

Se desideri consentire le operazioni CRUD sugli utenti direttamente all'interno del pannello, implementa l'helper `userManagement` nelle opzioni dell'adapter, che fornisce hook per `listUsers`, `getUserById`, `createUser`, `updateUser`, `deleteUser`, `getUserRoles` e `setUserRoles`.

## Passaggi successivi

- **[Autenticazione](/docs/backend/authentication/)** — la configurazione del provider integrato
- **[Endpoint e token](/docs/backend/auth-endpoints/)** — le route che un adapter deve soddisfare
- **[Regole di sicurezza (RLS)](/docs/collections/security-rules/)** — a cosa servono i claim restituiti da un adapter
