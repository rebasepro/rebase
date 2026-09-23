---
sourceHash: 9268d903ba4bf874
title: Autenticación
sidebar_label: Autenticación
description: Autenticación del lado del cliente con el SDK de Rebase — inicio de sesión con correo electrónico/contraseña, proveedores OAuth, gestión de sesiones y escuchadores de estado de autenticación.
---

## Descripción general

El módulo `client.auth` gestiona la autenticación de usuarios, la administración de tokens y la persistencia de sesiones. Una vez que un usuario inicia sesión, todas las solicitudes de datos posteriores incluyen automáticamente el JWT.

El SDK persiste las sesiones en `localStorage` de forma predeterminada y actualiza automáticamente los tokens antes de que expiren.

:::note[Cada método de inicio de sesión se resuelve en una sesión aplanada]
`signInWithEmail`, `signUp` y cada método `signInWith*` devuelven
**`{ user, accessToken, refreshToken }`** — el SDK ya ha desenvuelto el
envoltorio por ti.

La API REST subyacente devuelve el token anidado en su lugar, como
`{ user, tokens: { accessToken, … } }`. Esa diferencia solo importa si también
llamas a `/api/auth/*` directamente con `fetch`, donde `body.accessToken` es `undefined`
y el token se encuentra en `body.tokens.accessToken`. Consulta
[el formato de conexión](/docs/backend/auth-endpoints/#response-format).
:::

## Correo electrónico / Contraseña

### Iniciar sesión

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

El SDK incluye métodos dedicados para proveedores OAuth populares, además de un `signInWithOAuth()` genérico para cualquier proveedor personalizado.

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

### Otros proveedores

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

### OAuth genérico

Para cualquier proveedor registrado en el backend:

```typescript
await client.auth.signInWithOAuth("custom-provider", {
    code: authCode,
    redirectUri: "https://myapp.com/callback"
});
```

## Enlaces mágicos (Magic Links)

Un enlace de inicio de sesión de un solo clic por correo electrónico. El enlace dirige a una página de tu aplicación que contiene un token; devuélvelo para canjearlo por una sesión.

```typescript
// 1. Ask for the link. `redirectTo` is where the link points.
await client.auth.sendMagicLink("user@example.com");

// 2. On the landing page, trade the token for a session.
const token = new URLSearchParams(location.search).get("token")!;
const { user } = await client.auth.verifyMagicLink(token);
```

`sendMagicLink` responde lo mismo independientemente de si la dirección tiene o no una cuenta. Esto es deliberado: un endpoint que respondiera "no existe dicho usuario" sería un oráculo de enumeración de cuentas, así que no uses el resultado para decirle a una persona si está registrada — no lo sabe.

Ambos necesitan un servicio de correo electrónico configurado en el backend, o responderán 503 `EMAIL_NOT_CONFIGURED`.

## Códigos de un solo uso

Un código de seis dígitos por correo electrónico, para los casos en los que un enlace resulta incómodo: una aplicación nativa, un segundo dispositivo o un navegador que altere los enlaces.

```typescript
const { expiresInSeconds } = await client.auth.sendEmailOtp("user@example.com");

// The address goes back with the code, because the code is only valid for it.
const { user } = await client.auth.verifyEmailOtp("user@example.com", "418293");
```

Enviar la dirección junto con el código es lo que hace que un intento de adivinar los seis dígitos sea contra *una* sola cuenta en lugar de contra todas las cuentas a la vez.

## Sesiones anónimas

Inicia la sesión de un visitante sin ninguna credencial, para que pueda comenzar a usar la aplicación antes de tener un motivo para registrarse:

```typescript
const { user } = await client.auth.signInAnonymously();
user.isAnonymous;   // true
```

La cuenta es real: tiene un id, roles y una sesión, por lo que la seguridad a nivel de fila (row-level security) delimita sus filas exactamente como lo haría con las de un usuario registrado. Lo que no tiene es una forma de volver: nadie puede iniciar sesión *como* esa cuenta por segunda vez, por lo que todo lo que le pertenece se pierde con la sesión.

`linkAnonymous` es la forma en que deja de ser desechable. El usuario **conserva su id**, por lo que todo lo que creó mientras era anónimo sigue siendo suyo:

```typescript
await client.auth.linkAnonymous("user@example.com", "correct-horse-battery");
```

| Fallo | Significado |
|-------|-------------|
| `ANONYMOUS_AUTH_DISABLED` (403) | El backend no ha habilitado la autenticación anónima |
| `NOT_ANONYMOUS` (400) | La sesión actual pertenece a una cuenta ordinaria |
| `EMAIL_EXISTS` (409) | La dirección ya tiene una cuenta — inicia sesión en esa en su lugar |

## Vincular un proveedor a una cuenta existente

`signInWithGoogle` y métodos similares *inician* la sesión de un usuario. `linkProvider` vincula una identidad de proveedor a la cuenta que ya ha iniciado sesión, para que la misma persona pueda volver a través de cualquiera de las dos vías:

```typescript
await client.auth.linkProvider("google", { idToken });
```

La sesión ya demuestra la propiedad de la cuenta, por lo que, a diferencia del inicio de sesión, esto no requiere que el proveedor haya verificado el correo electrónico y las dos direcciones no necesitan coincidir. Tiene éxito de forma idempotente (`alreadyLinked: true`) cuando esa identidad ya está en esta cuenta, y rechaza con `IDENTITY_ALREADY_LINKED` (409) cuando pertenece a una diferente.

## Buscar un usuario por correo electrónico

```typescript
const profile = await client.auth.findUserByEmail("user@example.com");
// { uid, displayName, photoURL } | null
```

Tres campos no sensibles y nada más — lo suficiente para mostrar "estás invitando a Jane" antes de enviar una invitación.

## Autenticación multifactor

Factores TOTP — una aplicación de autenticación — más el desafío que eleva una sesión de `aal1` a `aal2`.

### Registrar un factor

```typescript
const { factor, totp, recoveryCodes } = await client.auth.mfa.enroll({
    friendlyName: "Phone"
});

showQrCode(totp.uri);        // otpauth://… — what the authenticator scans
showRecoveryCodes(recoveryCodes);
```

**Muestra los códigos de recuperación una sola vez y nunca más.** Solo se almacenan sus hashes, por lo que nada podrá mostrarlos más tarde.

El factor no se puede utilizar hasta que el usuario demuestre que su aplicación de autenticación produjo un código a partir de ese secreto:

```typescript
await client.auth.mfa.verify(factor.id, "418293");
```

### Iniciar sesión con MFA

Un inicio de sesión contra una cuenta con MFA registrado no devuelve ninguna sesión. Se rechaza con `401 MFA_REQUIRED`, y los `details` del error incluyen un `mfaToken` y los `factors` verificados de la cuenta. Pasa ese token a `challenge` y `verifyChallenge` para obtener la sesión:

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

El `mfaToken` se envía solo en esas dos peticiones y nunca se instala en el cliente. `verifyChallenge` genera la sesión `aal2`, este cliente la adopta y emite `SIGNED_IN` como en cualquier otro inicio de sesión. El `mfaToken` expira cinco minutos después del inicio de sesión que lo devolvió, y un desafío cinco minutos después de abrirse. Un desafío que ha alcanzado su límite de intentos permanece inhabilitado durante el resto de su vida útil; de lo contrario, un desafío abierto permitiría intentos ilimitados para adivinar los seis dígitos.

Sin `mfaToken`, las dos llamadas elevan la sesión que este cliente ya tiene de `aal1` a `aal2`.

### Eliminar un factor

```typescript
await client.auth.mfa.unenroll(factorId);
```

Requiere una sesión `aal2` — una que ya haya respondido a un desafío —, de modo que un token `aal1` robado no pueda desactivar MFA. Eliminar el último factor verificado también descarta los códigos de recuperación.

## Cerrar sesión

```typescript
await client.auth.signOut();
```

Esto revoca el token de actualización en el servidor, borra la sesión local y emite un evento `SIGNED_OUT`.

## Gestión de sesiones

### Obtener la sesión actual

```typescript
const session = client.auth.getSession();
// { accessToken, refreshToken, expiresAt, user } | null
```

### Obtener el usuario actual (verificado por el servidor)

```typescript
const user = await client.auth.getUser();
// Fetches the user from the backend (GET /auth/me)
```

### Actualizar el perfil del usuario

```typescript
const updatedUser = await client.auth.updateUser({
    displayName: "Jane Doe",
    photoURL: "https://example.com/avatar.jpg"
});
```

### Actualizar token

La actualización del token se realiza automáticamente, pero puedes activarla manualmente:

```typescript
const session = await client.auth.refreshSession();
```

## Dónde reside la sesión: `authFlowMode`

```typescript
const client = createRebaseClient({
    baseUrl: API_URL,
    auth: { authFlowMode: "cookie" }
});
```

| Modo | Dónde está el refresh token | Cuándo usarlo |
|------|-----------------------------|---------------|
| `"json"` *(predeterminado)* | Devuelto en el cuerpo de la respuesta, conservado en `localStorage` | Una aplicación nativa, un script, cualquier cosa sin el almacén de cookies de un navegador |
| `"cookie"` | Una cookie **HttpOnly** establecida por el backend | Una aplicación de navegador. Los scripts que se ejecutan en tu página no pueden leerla, lo que la hace segura contra ataques XSS |

El modo cookie necesita `auth.cookieAuth` en el backend, y es el que utiliza la plantilla de frontend generada.

## Esperar a que la sesión se restaure

**Una sesión restaurada no está disponible en el primer renderizado.** `getSession()` es síncrono, por lo que al cargar la página devuelve `null` mientras la restauración aún está en curso — y en el modo cookie una restauración *siempre* está en curso, porque el token de actualización está en una cookie que la página no puede leer, por lo que el cliente tiene que pedirle al servidor un nuevo token de acceso.

Leerlo sincrónicamente es lo que produce un parpadeo de sesión cerrada en cada recarga:

```typescript no-verify
// Wrong: renders the signed-out view for one round trip, every reload.
const session = client.auth.getSession();
if (!session) return <SignIn />;
```

`isInitialized()` se resuelve una vez que el cliente ha terminado de intentarlo, haya encontrado una sesión o no:

```typescript
async function currentUser() {
    await client.auth.isInitialized();
    return client.auth.getSession()?.user ?? null;
}
```

En React, esto es un efecto:

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

`useRebaseAuthController` en `@rebasepro/app` ya hace esto, por lo que una aplicación construida sobre la plantilla generada lo obtiene de forma automática.

Una restauración exitosa también llega a `onAuthStateChange` como `TOKEN_REFRESHED` — *es* una actualización —, pero un escuchador por sí solo no puede indicarte que la restauración ha finalizado: un arranque sin sesión no emite absolutamente nada, lo cual es indistinguible de uno que aún está en curso. Espera con `await isInitialized()` para esa comprobación y utiliza el escuchador para los cambios posteriores.

## Escuchador del estado de autenticación

Reacciona a los cambios de autenticación en toda tu aplicación:

```typescript
const unsubscribe = client.auth.onAuthStateChange((event, session) => {
    // event: "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED" | "USER_UPDATED"
    console.log("Auth event:", event);
    console.log("Session:", session?.user?.email);
});

// Stop listening
unsubscribe();
```

| Evento | Cuándo |
|--------|--------|
| `SIGNED_IN` | Se completó un inicio de sesión o registro |
| `TOKEN_REFRESHED` | El token de acceso fue renovado — incluida la renovación silenciosa que restaura una sesión al cargar la página |
| `USER_UPDATED` | `updateUser()` modificó el perfil |
| `SIGNED_OUT` | Un cierre de sesión, o una actualización que falló definitivamente |

## Gestión de contraseñas

### Olvidé mi contraseña

```typescript
const { success, message } = await client.auth.resetPasswordForEmail(
    "user@example.com"
);
```

### Restablecer contraseña (con token)

```typescript
const { success, message } = await client.auth.resetPassword(
    resetToken,
    "newSecurePassword"
);
```

### Cambiar contraseña (autenticado)

```typescript
const { success, message } = await client.auth.changePassword(
    "oldPassword",
    "newPassword"
);
```

## Verificación de correo electrónico

```typescript
// Send verification email to the current user
await client.auth.sendVerificationEmail();

// Verify with the token from the email link
await client.auth.verifyEmail(token);
```

## Gestión de sesiones (multidispositivo)

```typescript
// List all active sessions
const sessions = await client.auth.getSessions();

// Revoke a specific session
await client.auth.revokeSession(sessionId);

// Revoke ALL sessions (logs out everywhere)
await client.auth.revokeAllSessions();
```

## Configuración de autenticación

Consulta la configuración de autenticación del backend:

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

## Almacenamiento de sesión personalizado

De forma predeterminada, las sesiones se almacenan en `localStorage`. Puedes personalizar esto con la opción `auth`:

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

## Estructura del objeto de usuario

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

## Próximos pasos

- **[Consulta de datos](/docs/sdk/querying)** — Operaciones CRUD y constructor de consultas
- **[Suscripciones en tiempo real](/docs/sdk/realtime)** — Datos en vivo con WebSockets
- **[Backend de autenticación](/docs/backend/authentication)** — Configuración de autenticación del lado del servidor
