---
sourceHash: a133531cc94e5855
title: Benutzerdefinierte Auth-Adapter
sidebar_label: Benutzerdefinierte Auth-Adapter
description: Ersetzen Sie die integrierte Authentifizierung von Rebase durch Clerk, Firebase Auth oder Ihren eigenen Identitätsanbieter, indem Sie den AuthAdapter-Vertrag implementieren.
---

Rebase bringt eine eigene Authentifizierung mit – [konfigurieren Sie sie hier](/docs/backend/authentication/). Diese Seite behandelt den anderen Fall: einen Identitätsanbieter, den Sie bereits betreiben oder für den Sie bereits bezahlen.

## Benutzerdefinierte Auth-Adapter

Rebase ermöglicht das vollständige Ersetzen des integrierten Authentifizierungssystems über eine modulare Authentifizierungsarchitektur. Dies entkoppelt die Authentifizierungsprüfung von der Datenbank und den REST/WebSocket-Schichten und ermöglicht eine nahtlose Integration mit externen Anbietern wie **Clerk**, **Auth0**, **Firebase Auth** oder benutzerdefinierten JWT-Identitätsdiensten.

### Der AuthAdapter-Vertrag

Sie können die `AuthAdapter`-Schnittstelle für vollständige Kontrolle direkt implementieren. Die Schnittstellendefinition lautet wie folgt:

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

### Die AuthenticatedUser-Payload

Unabhängig vom gewählten externen Authentifizierungsanbieter muss Ihr Adapter erfolgreiche Token-Verifizierungen in ein einheitliches `AuthenticatedUser`-Objekt auflösen. Der Rebase RLS Scope Injector bildet diese Werte innerhalb von Transaktionen direkt auf PostgreSQL-Sitzungsvariablen ab:

```typescript
export interface AuthenticatedUser {
  uid: string;                    // Maps to pg local 'app.user_id' -> rebase.uid()
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

### Schnelle Integration über `createCustomAuthAdapter`

Für Standardszenarien (wie die Validierung von JWTs eines Drittanbieterdienstes) können Sie das Hilfsprogramm `createCustomAuthAdapter` verwenden. Dieses Dienstprogramm verwaltet Standardwerte für Funktionen (Capabilities) und implementiert die WebSocket-Token-Validierung standardmäßig, indem es Ihre `verifyRequest`-Implementierung umschließt.

#### Beispiel: Integration mit Clerk

Um ein Rebase-Backend mit **Clerk** zu verbinden, können Sie Clerk-JWT-Tokens mithilfe des JSON Web Key Sets (JWKS) von Clerk verifizieren:

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

#### Beispiel: Integration mit Firebase Auth

So verifizieren Sie Firebase Auth-Tokens mit den öffentlichen Zertifikaten von Firebase:

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

### Einbinden von Auth-Routen und Admin-UI-Aktionen

Wenn Ihr benutzerdefinierter Auth-Anbieter das Einbinden von Weiterleitungsendpunkten erfordert (wie OAuth-Callback-Routen oder SAML-Login-Schleifen), implementieren Sie die Methode `createAuthRoutes` in Ihrem Adapter:

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

Wenn Sie CRUD-Operationen für Benutzer direkt im Rebase-Admin-Dashboard zulassen möchten, implementieren Sie den `userManagement`-Helper innerhalb der Adapter-Optionen, der Hooks für `listUsers`, `createUser`, `updateUser` und `deleteUser` bereitstellt.

## Nächste Schritte

- **[Authentifizierung](/docs/backend/authentication/)** – die Konfiguration des integrierten Anbieters
- **[Endpunkte und Tokens](/docs/backend/auth-endpoints/)** – die Routen, die ein Adapter erfüllen muss
- **[Sicherheitsregeln (RLS)](/docs/collections/security-rules/)** – wofür die von einem Adapter zurückgegebenen Claims verwendet werden

---
