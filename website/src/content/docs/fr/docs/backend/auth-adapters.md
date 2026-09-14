---
sourceHash: 2e616bc4a3ea133c
title: Adaptateurs d'authentification personnalisés
sidebar_label: Adaptateurs d'authentification personnalisés
description: Remplacez l'authentification intégrée de Rebase par Clerk, Firebase Auth ou votre propre fournisseur d'identité en implémentant le contrat AuthAdapter.
---

Rebase intègre sa propre authentification — [configurez-la ici](/docs/backend/authentication/). Cette page traite de l'autre cas de figure : un fournisseur d'identité que vous utilisez déjà, ou pour lequel vous payez déjà.

## Adaptateurs d'authentification personnalisés

Rebase permet le remplacement complet du système d'authentification intégré via une architecture d'authentification modulable. Cela découple la vérification de l'authentification de la base de données et des couches REST/WebSocket, permettant une intégration fluide avec des fournisseurs externes tels que **Clerk**, **Auth0**, **Firebase Auth** ou des services d'identité JWT personnalisés.

### Le contrat AuthAdapter

Vous pouvez implémenter directement l'interface `AuthAdapter` pour un contrôle total. La définition de l'interface est la suivante :

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

### Le payload de l'utilisateur authentifié

Quel que soit le fournisseur d'authentification externe choisi, votre adaptateur doit résoudre les vérifications de jeton réussies en un objet `AuthenticatedUser` uniforme. L'injecteur de portée RLS (RLS Scope Injector) de Rebase mappe directement ces valeurs vers des variables de session PostgreSQL au sein des transactions :

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

### Intégration rapide via `createCustomAuthAdapter`

Pour les scénarios standards (tels que la validation de JWT provenant d'un service tiers), vous pouvez utiliser l'utilitaire `createCustomAuthAdapter`. Cet utilitaire gère les valeurs par défaut des fonctionnalités (`capabilities`) et implémente la validation des jetons WebSocket clé en main en encapsulant votre implémentation de `verifyRequest`.

#### Exemple : Intégration avec Clerk

Pour connecter un backend Rebase avec **Clerk**, vous pouvez vérifier les jetons JWT Clerk à l'aide du JSON Web Key Set (JWKS) de Clerk :

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

#### Exemple : Intégration avec Firebase Auth

Pour vérifier les jetons Firebase Auth à l'aide des certificats publics de Firebase :

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

### Montage des routes d'authentification et actions du panneau

Si votre fournisseur d'authentification personnalisé nécessite le montage de points de terminaison de redirection (comme des routes de callback OAuth ou des boucles de connexion SAML), implémentez la méthode `createAuthRoutes` sur votre adaptateur :

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

Si vous souhaitez autoriser les opérations CRUD sur les utilisateurs directement depuis le panneau d'administration, implémentez l'assistant `userManagement` au sein des options de l'adaptateur, qui fournit des hooks pour `listUsers`, `createUser`, `updateUser` et `deleteUser`.

## Prochaines étapes

- **[Authentification](/docs/backend/authentication/)** — la configuration du fournisseur intégré
- **[Endpoints et tokens](/docs/backend/auth-endpoints/)** — les routes qu'un adaptateur doit satisfaire
- **[Règles de sécurité (RLS)](/docs/collections/security-rules/)** — l'usage fait des revendications (claims) renvoyées par un adaptateur
