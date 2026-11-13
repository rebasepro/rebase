---
sourceHash: 939f091d469cc389
title: Adaptadores de autenticación personalizados
sidebar_label: Adaptadores de autenticación personalizados
description: Reemplaza la autenticación integrada de Rebase con Clerk, Firebase Auth o tu propio proveedor de identidad implementando el contrato AuthAdapter.
---

Rebase incluye su propia autenticación — [configúrala aquí](/docs/backend/authentication/). Esta página aborda el otro caso: un proveedor de identidad que ya utilizas o por el que ya pagas.

## Adaptadores de autenticación personalizados

Rebase permite el reemplazo completo del sistema de autenticación integrado mediante una arquitectura de autenticación conectable. Esto desacopla la verificación de autenticación de la base de datos y de las capas REST/WebSocket, lo que permite una integración perfecta con proveedores externos como **Clerk**, **Auth0**, **Firebase Auth** o servicios de identidad JWT personalizados.

### El contrato AuthAdapter

Puedes implementar la interfaz `AuthAdapter` directamente para tener un control total. La interfaz, de forma resumida (la definición completa, con los hooks opcionales de administración de usuarios y `transformAuthResponse`, es `AuthAdapter` en `@rebasepro/types`):

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

### El adaptador decide quién realiza la llamada en todas partes

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`verifyRequest` es el único lugar donde el backend pregunta quién envió una solicitud. Las rutas de datos y funciones lo consultan, al igual que `GET /api/schema/tables`, el documento OpenAPI en `/api/docs` y cada superficie de administración bajo `/api/admin` (preferencias de interfaz de usuario, edición de esquemas en vivo, el editor de esquemas, cron, registros, copias de seguridad y demás). Una clave de API (`rk_`) o un token de plataforma (`rpt_`) siguen siendo resueltos por Rebase antes de consultar al adaptador. Una credencial que el adaptador no reconoce genera un `401`, nunca se interpreta como nadie; una solicitud sin credencial se considera nadie, ante lo cual el endpoint de esquema y el documento responden `401` (a menos que esté `schemaTables.public`) y las superficies de administración siempre responden `401`. Los roles que devuelve el adaptador determinan cómo se describe a quien realiza la llamada y si una superficie de administración lo admite (`403` cuando carece de su alcance). Un adaptador que lanza una excepción equivale al rechazo de quien realiza la llamada, nunca a un `500`. Consulta [Schema](/docs/backend/endpoints/#schema).

Antes de la versión 0.31, el endpoint de esquema, el documento y las superficies de administración solo verificaban el JWT del framework, por lo que un backend con su propio adaptador respondía con `500` y su panel de administración no se cargaba.

### El payload del usuario autenticado

Independientemente del proveedor de autenticación externo elegido, tu adaptador debe resolver las verificaciones de token exitosas en un objeto `AuthenticatedUser` uniforme. El inyector de alcance RLS (RLS Scope Injector) de Rebase mapea estos valores directamente a variables de sesión de PostgreSQL dentro de las transacciones:

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

### Integración rápida mediante `createCustomAuthAdapter`

Para escenarios estándar (como validar JWT de un servicio de terceros), puedes utilizar la utilidad `createCustomAuthAdapter`. Esta utilidad maneja los valores predeterminados de las capacidades e implementa la validación de tokens de WebSocket de forma predeterminada envolviendo tu implementación de `verifyRequest`.

#### Ejemplo: Integración con Clerk

Para conectar un backend de Rebase con **Clerk**, puedes verificar los tokens JWT de Clerk utilizando el JSON Web Key Set (JWKS) de Clerk:

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

#### Ejemplo: Integración con Firebase Auth

Para verificar tokens de Firebase Auth utilizando los certificados públicos de Firebase:

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

#### La parte del cliente

El adaptador verifica el token del proveedor; el cliente debe enviarlo. Proporciona al cliente de Rebase una función getter para ello, una sola vez:

```typescript
client.setAuthTokenGetter(() => clerk.session?.getToken() ?? Promise.resolve(null));
```

Con Firebase Auth el getter es `() => auth.currentUser?.getIdToken() ?? Promise.resolve(null)`. El cliente lo consulta en cada solicitud HTTP y cada vez que el socket en tiempo real se autentica, de modo que las live queries se ejecutan como el mismo usuario que las llamadas REST. En el panel de administración, configúralo en el cliente que pasas a `<Rebase client>`. Consulta [Tu propio proveedor de autenticación](/docs/sdk/your-own-auth-provider/).

---

### Montaje de rutas de autenticación y acciones del panel

Si tu proveedor de autenticación personalizado requiere montar endpoints de redirección (como rutas de callback OAuth o bucles de inicio de sesión SAML), implementa el método `createAuthRoutes` en tu adaptador:

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

Si deseas permitir operaciones CRUD de usuarios directamente dentro del panel, implementa el asistente `userManagement` dentro de las opciones del adaptador, el cual proporciona hooks para `listUsers`, `getUserById`, `createUser`, `updateUser`, `deleteUser`, `getUserRoles` y `setUserRoles`.

## Próximos pasos

- **[Autenticación](/docs/backend/authentication/)** — la configuración del proveedor integrado
- **[Endpoints y tokens](/docs/backend/auth-endpoints/)** — las rutas que debe satisfacer un adaptador
- **[Reglas de seguridad (RLS)](/docs/collections/security-rules/)** — para qué se utilizan los claims que devuelve un adaptador
