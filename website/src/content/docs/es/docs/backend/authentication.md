---
title: Autenticación
sidebar_label: Autenticación
description: Configure la autenticación JWT, los proveedores OAuth, el email SMTP, los hooks de autenticación y los adaptadores de autenticación personalizados en el backend.
---

## Resumen

Rebase incluye un sistema de autenticación de backend completo:

- **Tokens JWT** — Flujo de token de acceso y de refresco con expiración configurable
- **Proveedores OAuth** — Google, LinkedIn, GitHub, Microsoft, Apple y más
- **Email SMTP** — Flujos de restablecimiento de contraseña y verificación de email
- **Hooks de autenticación** — Hooks de ciclo de vida para la creación de usuarios y más
- **Adaptadores de autenticación personalizados** — Conecte Firebase Auth, Auth0, Clerk o cualquier proveedor externo
- **Clave de servicio** — Clave estática para autenticación de servidor a servidor
- **Auto-bootstrapping** — El primer usuario obtiene automáticamente el rol de administrador

## Configuración

El bloque `auth` en `initializeRebaseBackend` controla toda la autenticación del backend:

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

:::caution[Los callbacks de colección no se disparan para los usuarios de autenticación]
La creación y actualización de usuarios a través del sistema de autenticación — registro, gestión
de usuarios por parte del administrador y OAuth — escriben **directamente** en el almacén de usuarios y omiten el
pipeline de guardado de colecciones. Un callback `beforeSave`/`afterSave`/`beforeDelete`/`afterDelete`
en la colección de autenticación (usuarios) **no** se ejecutará para estas rutas. Para
efectos secundarios como aprovisionar un equipo personal al registrarse, use los hooks del ciclo de vida
de autenticación (`afterUserCreate`, `beforeUserCreate`, `afterUserDelete`, …), que
reciben el registro de usuario completamente poblado.
:::

### Proveedores OAuth

Cada proveedor OAuth se configura con al menos un `clientId`. Algunos proveedores requieren un `clientSecret`:

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

### Vinculación de Cuentas entre Métodos de Inicio de Sesión

¿Qué ocurre cuando alguien se registra con email/contraseña como
`ada@example.com` y más tarde pulsa "Iniciar sesión con Google" en una cuenta de
Google con esa misma dirección? Rebase **vincula ambas en una sola cuenta**,
pero solo cuando el proveedor afirma que el email está verificado. Nunca crea en
silencio una segunda cuenta para la misma dirección.

En `POST /api/auth/<provider>` el orden de resolución es:

1. **Identidad de proveedor ya conocida**: si esa identidad exacta del proveedor
   ya ha iniciado sesión antes, se devuelve ese usuario. El email no se consulta.
2. **Cuenta existente con el mismo email y el proveedor lo ha verificado**: la
   identidad se adjunta a la cuenta existente y el usuario inicia sesión en ella.
   Una cuenta, dos formas de entrar.
3. **Cuenta existente con el mismo email pero el proveedor NO lo ha
   verificado**: se rechaza con `403 EMAIL_NOT_VERIFIED`. No se crea ni se
   modifica nada.
4. **No hay ninguna cuenta con ese email**: se crea una cuenta nueva.

El paso 3 es el caso crítico para la seguridad. Si bastara con un email no
verificado del proveedor, cualquiera que lograra que un proveedor emitiera una
dirección que no le pertenece podría apoderarse de la cuenta de Rebase
correspondiente. Google siempre afirma `email_verified` para las cuentas de
Google reales, por lo que el paso 2 es la vía habitual del inicio de sesión con
Google; el paso 3 afecta sobre todo a proveedores que permiten al usuario
indicar una dirección arbitraria sin confirmar.

Este comportamiento no es configurable: deliberadamente no existe ninguna opción
para vincular con emails no verificados.

Para recuperarse de un rechazo del paso 3, el usuario inicia sesión con su
método existente y llama al endpoint de vinculación explícito:

```http
POST /api/auth/link/google
Authorization: Bearer <access token>

{ "idToken": "..." }
```

La vinculación estando autenticado **no** exige intencionadamente un email
verificado, y tampoco exige que los emails coincidan: la dirección de Google de
un usuario a menudo no es la que usa en la aplicación. La asimetría es
deliberada: en el inicio de sesión, el email del proveedor es la única prueba
que liga la identidad entrante con una cuenta, mientras que aquí quien llama ya
ha demostrado ser el propietario al disponer de una sesión válida. Devuelve
`409 IDENTITY_ALREADY_LINKED` si esa identidad de proveedor pertenece a otro
usuario, y es idempotente si ya está vinculada a quien llama.

#### La dirección inversa

Un usuario que se registró con Google y no tiene contraseña:

- **Registrarse con el mismo email** se rechaza con `409 EMAIL_EXISTS`.
- **`POST /api/auth/change-password`** devuelve `400 INVALID_ACCOUNT`: no hay
  ninguna contraseña previa contra la que verificar.
- **`forgot-password` → `reset-password` es la vía admitida para añadir una.**
  Vuelve a demostrar la propiedad de la dirección por email, tras lo cual la
  cuenta dispone de ambos métodos de inicio de sesión.

## Endpoints de Autenticación

Todos los endpoints de autenticación se montan en `/api/auth/`:

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Crear una nueva cuenta |
| `POST` | `/api/auth/login` | Iniciar sesión con email/contraseña |
| `POST` | `/api/auth/refresh` | Refrescar el token de acceso |
| `POST` | `/api/auth/<provider>` | Inicio de sesión OAuth (p. ej., `/api/auth/google`, `/api/auth/linkedin`) |
| `POST` | `/api/auth/link/<provider>` | Vincular un proveedor OAuth a la cuenta autenticada |
| `POST` | `/api/auth/logout` | Revocar el token de refresco |
| `POST` | `/api/auth/forgot-password` | Enviar email de restablecimiento de contraseña |
| `POST` | `/api/auth/reset-password` | Restablecer la contraseña con un token |
| `POST` | `/api/auth/find-user` | Resolver un email a un perfil público mínimo (opt-in) |

Todos los endpoints de la API de datos requieren una cabecera `Authorization: Bearer <token>` válida cuando `requireAuth: true` (el valor predeterminado).

### Invitar a compañeros por email

Los flujos de invitación necesitan convertir una dirección de email en un ID de usuario, pero la colección `users`
está protegida por RLS frente al cliente. En lugar de crear a mano una función de servidor de
administrador, active la búsqueda integrada:

```typescript no-verify
await initializeRebaseBackend({
    auth: {
        // ...
        allowUserLookup: true,   // enables POST /api/auth/find-user
    },
});
```

Luego, desde el cliente:

```typescript
const profile = await rebase.auth.findUserByEmail("teammate@example.com");
// → { uid, displayName, photoURL } | null   (never email/roles/metadata)
if (profile) {
    await rebase.data.team_members.create({ team_id, user_id: profile.uid });
}
```

El endpoint es **solo para autenticados** y devuelve únicamente `uid`, `displayName`
y `photoURL` — nunca el email, los roles o los metadatos del usuario consultado. Está
**desactivado de forma predeterminada** porque permite a cualquier usuario con sesión iniciada sondear qué emails tienen
cuentas; actívelo solo cuando su UX de invitaciones lo necesite.

## Tablas Autocreadas

En el primer inicio, Rebase aprovisiona automáticamente el esquema `auth` y las siguientes tablas en la base de datos (vinculadas al esquema definido en su colección, p. ej., `rebase`):

- **`rebase.users`** — Cuentas de usuario con email, hash de contraseña, metadatos y una columna `roles` text[] (los roles se almacenan como arrays de texto en línea para optimizar las consultas y evitar joins).
- **`rebase.refresh_tokens`** — Sesiones de larga duración que llevan tokens de refresco hasheados, agentes de usuario y direcciones IP. Incluye un índice único en `token_hash` y una restricción única en `(user_id, user_agent, ip_address)` para rastrear las sesiones de dispositivos activas.
- **`rebase.password_reset_tokens`** — Tokens de un solo uso y caducables para los flujos de recuperación de contraseña.
- **`rebase.mfa_factors`** — Métodos de autenticación multifactor inscritos (p. ej., secretos TOTP cifrados con AES-256).
- **`rebase.mfa_challenges`** — Registros de verificación que rastrean los intentos de verificación MFA activos.
- **`rebase.recovery_codes`** — Códigos de respaldo/recuperación multifactor hasheados.
- **`rebase.app_config`** — Almacén clave-valor para configuraciones del sistema.

## Contexto de Base de Datos de Seguridad a Nivel de Fila (RLS)

Rebase conecta la autenticación de la petición directamente con la seguridad a nivel de fila (RLS) de PostgreSQL. Cada consulta de base de datos ejecutada a través de un driver con alcance de usuario se ejecuta dentro de una transacción de base de datos (`db.transaction()`) que configura parámetros de configuración locales a la transacción:

*   `app.user_id` — El ID único (`uid`) del usuario autenticado. Por defecto es `'anon'` para las peticiones no autenticadas.
*   `app.user_roles` — Una cadena separada por comas que lista los roles asignados al usuario.
*   `app.jwt` — Una cadena JSON que contiene la carga completa de claims del JWT (`{"sub": "<uid>", "roles": [...]}`).

Estos parámetros se configuran localmente durante la duración de la transacción usando la función `set_config` de Postgres:
```sql
SELECT 
    set_config('app.user_id', $1, true),
    set_config('app.user_roles', $2, true),
    set_config('app.jwt', $3, true);
```

### Funciones Auxiliares de Políticas de PostgreSQL

Para facilitar la escritura de políticas de seguridad a nivel de fila, Rebase crea funciones auxiliares bajo el esquema `auth` durante el bootstrapping de la base de datos:

*   **`rebase.uid()`** — Devuelve el ID del usuario autenticado como `text`, o `NULL` si no está establecido:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.uid() RETURNS text AS $$
        SELECT NULLIF(current_setting('app.user_id', true), '');
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.roles()`** — Devuelve la cadena de roles separada por comas:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.roles() RETURNS text AS $$
        SELECT COALESCE(NULLIF(current_setting('app.user_roles', true), ''), '');
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.jwt()`** — Devuelve la carga completa del JWT como un objeto `jsonb`:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.jwt() RETURNS jsonb AS $$
        SELECT COALESCE(NULLIF(current_setting('app.jwt', true), ''), '{}')::jsonb;
    $$ LANGUAGE sql STABLE;
    ```

Puede usar estos auxiliares directamente en sus reglas de seguridad personalizadas o migraciones de base de datos:
```sql
CREATE POLICY owner_access ON posts
    FOR ALL
    TO public
    USING (author_id = rebase.uid() OR string_to_array(rebase.roles(), ',') && ARRAY['admin']);
```

## Bootstrap del Primer Usuario

Cuando no existen usuarios en la base de datos, la primera persona que se registra se convierte automáticamente en administrador. Después de eso, el registro se controla mediante el ajuste `allowRegistration`.

Esto garantiza que siempre pueda inicializar un despliegue nuevo sin necesidad de sembrar la base de datos manualmente. Para evitar ejecuciones concurrentes y condiciones de carrera en la generación del esquema durante la recarga en caliente (HMR) o el inicio, las operaciones de bootstrapping se sincronizan mediante un bloqueo consultivo de Postgres:
```sql
SELECT pg_advisory_xact_lock(hashtext('rebase_auth_functions_init'));
```

## Configuración de Autenticación a Nivel de Colección

En lugar de depender únicamente de las reglas de autenticación predeterminadas de la base de datos, puede marcar cualquier colección de Postgres (como `users.ts` o una colección personalizada `members.ts`) como la colección de autenticación. Esto se configura mediante la propiedad `auth` en la colección misma:

```typescript
import { defineCollection } from "@rebasepro/admin-types";

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

Cuando se llaman los hooks personalizados (`onCreateUser`, `onResetPassword`), reciben una fachada `AuthCollectionContext` que contiene:
- `hashPassword(password: string): Promise<string>` — Hashea la contraseña usando el algoritmo de hashing configurado (p. ej., scrypt).
- `sendEmail?: (options) => Promise<void>` — Envía un email (solo disponible cuando el servicio de email está configurado).
- `emailConfigured: boolean` — Si el servicio de email está configurado.
- `appName: string` — El nombre de la app de la configuración de email.
- `resetPasswordUrl: string` — La URL base del enlace de restablecimiento de contraseña.

## Autenticación con Clave de Servicio

Para la comunicación de servidor a servidor (p. ej., cron jobs, servicios externos), configure una clave de servicio estática:

```typescript
auth: {
    serviceKey: process.env.REBASE_SERVICE_KEY,
    // ...
}
```

Los clientes se autentican con la cabecera `Authorization: Bearer <service-key>`. 

### Clave Interna por Arranque

Si no se proporciona `REBASE_SERVICE_KEY` en su configuración, Rebase genera automáticamente una **clave interna por arranque** aleatoria. 

Esta clave nunca se registra y nunca sale del proceso. La usa el singleton `rebase` para autenticarse contra las propias APIs del plano de control del servidor (auth, storage, etc.). Esto garantiza que las tareas administrativas (como enviar un email de bienvenida o generar una URL de almacenamiento) siempre funcionen de forma inmediata en desarrollo y producción sin requerir una gestión manual de claves.

### Protección Contra Ataques de Temporización y Requisitos de la Clave

Para prevenir ataques de temporización, Rebase valida tanto la clave de servicio configurada por el usuario como la clave interna usando una comparación de cadenas de tiempo constante (`safeCompare`). La clave de servicio configurada por el usuario **debe tener al menos 32 caracteres de longitud**; si se configura una clave de menos de 32 caracteres, Rebase lanzará un error de configuración al iniciar y fallará de forma cerrada (fail-closed).


## Adaptadores de Autenticación Personalizados

Rebase permite el reemplazo completo del sistema de autenticación integrado mediante una arquitectura de autenticación conectable. Esto desacopla la verificación de autenticación de las capas de base de datos y REST/WebSocket, permitiendo una integración fluida con proveedores externos como **Clerk**, **Auth0**, **Firebase Auth** o servicios de identidad JWT personalizados.

### El Contrato AuthAdapter

Puede implementar la interfaz `AuthAdapter` directamente para un control completo. La definición de la interfaz es la siguiente:

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

### La Carga del Usuario Autenticado

Independientemente del proveedor de autenticación externo elegido, su adaptador debe resolver las verificaciones de token exitosas a un objeto `AuthenticatedUser` uniforme. El Inyector de Alcance RLS de Rebase mapea estos valores directamente a variables de sesión de PostgreSQL dentro de las transacciones:

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

### Integración Rápida vía `createCustomAuthAdapter`

Para escenarios estándar (como validar JWTs de un servicio de terceros), puede usar la utilidad `createCustomAuthAdapter`. Esta utilidad gestiona los valores predeterminados de capabilities e implementa la validación de tokens WebSocket de forma inmediata, envolviendo su implementación de `verifyRequest`.

#### Ejemplo: Integración con Clerk

Para conectar un backend de Rebase con **Clerk**, puede verificar los tokens JWT de Clerk usando el conjunto de claves web JSON (JWKS) de Clerk:

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
        registration: false,
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

Para verificar los tokens de Firebase Auth usando los certificados públicos de Firebase:

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

### Montaje de Rutas de Autenticación y Acciones de la UI de Administración

Si su proveedor de autenticación personalizado requiere montar endpoints de redirección (como rutas de callback OAuth o bucles de inicio de sesión SAML), implemente el método `createAuthRoutes` en su adaptador:

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
        registration: false,
        passwordReset: false,
        adminPasswordReset: false,
        sessionManagement: false,
        profileUpdate: false,
        emailVerification: false,
        magicLink: false,
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

Si desea permitir operaciones CRUD de usuarios directamente dentro del Panel de Administración de Rebase, implemente el helper `userManagement` dentro de las opciones del adaptador, que proporciona hooks para `listUsers`, `createUser`, `updateUser` y `deleteUser`.


## Próximos Pasos

- **[Autenticación del Frontend](/docs/frontend/authentication)** — UI de inicio de sesión, controlador de autenticación, gestión de usuarios
- **[Reglas de Seguridad (RLS)](/docs/collections/security-rules)** — Control de acceso a nivel de fila
- **[Autenticación del SDK del Cliente](/docs/sdk/authentication)** — Métodos de autenticación en el SDK del cliente
