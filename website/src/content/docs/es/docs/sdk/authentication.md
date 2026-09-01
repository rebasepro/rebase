---
title: Autenticación
sidebar_label: Autenticación
description: Autenticación del lado del cliente con el SDK de Rebase — inicio de sesión con email/contraseña, proveedores OAuth, gestión de sesiones y listeners del estado de autenticación.
---

## Resumen

El módulo `client.auth` gestiona la autenticación de usuarios, la gestión de tokens y la persistencia de sesiones. Una vez que un usuario inicia sesión, todas las peticiones de datos posteriores incluyen automáticamente el JWT.

El SDK persiste las sesiones en `localStorage` de forma predeterminada y refresca automáticamente los tokens antes de que caduquen.

:::note[Todos los métodos de inicio de sesión devuelven una sesión aplanada]
`signInWithEmail`, `signUp` y todos los métodos `signInWith*` devuelven
**`{ user, accessToken, refreshToken }`**: el SDK ya ha desenvuelto el envoltorio
por ti.

La API REST subyacente devuelve el token anidado, como
`{ user, tokens: { accessToken, … } }`. Esa diferencia solo importa si además
llamas a `/api/auth/*` directamente con `fetch`, donde `body.accessToken` es
`undefined` y el token está en `body.tokens.accessToken`. Consulta
[el formato de la API REST](/docs/backend/authentication).
:::

## Email / Contraseña

### Iniciar Sesión

```typescript
const { user, accessToken, refreshToken } = await client.auth.signInWithEmail(
    "user@example.com",
    "password"
);
console.log(user.uid, user.email);
```

### Registrarse

```typescript
const { user } = await client.auth.signUp(
    "user@example.com",
    "password",
    "Jane Doe"   // optional displayName
);
```

## Proveedores OAuth

El SDK incluye métodos dedicados para los proveedores OAuth más populares, además de un `signInWithOAuth()` genérico para cualquier proveedor personalizado.

### Google

Admite tres estilos de invocación:

```typescript
// ID-token flow (One Tap / Sign In With Google button)
await client.auth.signInWithGoogle({ idToken: googleIdToken });

// Access-token flow (popup)
await client.auth.signInWithGoogle({ accessToken: googleAccessToken });

// Authorization code flow (most secure, server-side exchange)
await client.auth.signInWithGoogle({ code: authCode, redirectUri: "https://..." });
```

### Otros Proveedores

Cada proveedor sigue el flujo de código de autorización con `(code, redirectUri)`:

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

Apple y Twitter requieren parámetros adicionales:

```typescript
// Apple — optional user info from first sign-in
await client.auth.signInWithApple(code, redirectUri, {
    name: { firstName: "Jane", lastName: "Doe" },
    email: "jane@example.com"
});

// Twitter — requires PKCE code verifier
await client.auth.signInWithTwitter(code, redirectUri, codeVerifier);
```

### OAuth Genérico

Para cualquier proveedor registrado en el backend:

```typescript
await client.auth.signInWithOAuth("custom-provider", {
    code: authCode,
    redirectUri: "https://myapp.com/callback"
});
```

## Cerrar Sesión

```typescript
await client.auth.signOut();
```

Esto revoca el refresh token en el servidor, borra la sesión local y emite un evento `SIGNED_OUT`.

## Gestión de Sesiones

### Obtener la Sesión Actual

```typescript
const session = client.auth.getSession();
// { accessToken, refreshToken, expiresAt, user } | null
```

### Obtener el Usuario Actual (Verificado por el Servidor)

```typescript
const user = await client.auth.getUser();
// Fetches the user from the backend (GET /auth/me)
```

### Actualizar el Perfil del Usuario

```typescript
const updatedUser = await client.auth.updateUser({
    displayName: "Jane Doe",
    photoURL: "https://example.com/avatar.jpg"
});
```

### Refrescar el Token

El refresco del token ocurre automáticamente, pero puede activarlo manualmente:

```typescript
const session = await client.auth.refreshSession();
```

## Listener del Estado de Autenticación

Reaccione a los cambios de autenticación en toda su aplicación:

```typescript
const unsubscribe = client.auth.onAuthStateChange((event, session) => {
    // event: "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED" | "USER_UPDATED"
    console.log("Auth event:", event);
    console.log("Session:", session?.user?.email);
});

// Stop listening
unsubscribe();
```

## Gestión de Contraseñas

### Contraseña Olvidada

```typescript
const { success, message } = await client.auth.resetPasswordForEmail(
    "user@example.com"
);
```

### Restablecer Contraseña (con Token)

```typescript
const { success, message } = await client.auth.resetPassword(
    resetToken,
    "newSecurePassword"
);
```

### Cambiar Contraseña (Autenticado)

```typescript
const { success, message } = await client.auth.changePassword(
    "oldPassword",
    "newPassword"
);
```

## Verificación de Email

```typescript
// Send verification email to the current user
await client.auth.sendVerificationEmail();

// Verify with the token from the email link
await client.auth.verifyEmail(token);
```

## Gestión de Sesiones (Multidispositivo)

```typescript
// List all active sessions
const sessions = await client.auth.getSessions();

// Revoke a specific session
await client.auth.revokeSession(sessionId);

// Revoke ALL sessions (logs out everywhere)
await client.auth.revokeAllSessions();
```

## Configuración de Autenticación

Consulte la configuración de autenticación del backend:

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

## Almacenamiento de Sesión Personalizado

De forma predeterminada, las sesiones se almacenan en `localStorage`. Puede personalizarlo con la opción `auth`:

```typescript
import { createRebaseClient, createCookieStorage } from "@rebasepro/client";

// Use cookies instead of localStorage
const client = createRebaseClient({
    baseUrl: "http://localhost:3001",
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

## Forma del Objeto User

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

## Próximos Pasos

- **[Consultar Datos](/docs/sdk/querying)** — Operaciones CRUD y constructor de consultas
- **[Suscripciones en Tiempo Real](/docs/sdk/realtime)** — Datos en vivo con WebSockets
- **[Backend de Autenticación](/docs/backend/authentication)** — Configuración de autenticación del lado del servidor
