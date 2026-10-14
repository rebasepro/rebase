---
sourceHash: 65085708df65a92e
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
const { user, confirmationRequired } = await client.auth.signUp(
    "user@example.com",
    "password",
    "Jane Doe"   // optional displayName
);
```

Con [`requireEmailVerification`](/docs/backend/email-verification/) activado,
no hay sesión hasta que se confirma la dirección: `confirmationRequired` es
`true` y `user` es `null`, así que indícale a la persona que abra el correo. En caso contrario,
`confirmationRequired` es `false` y `user` es la cuenta que inició sesión. En 0.23
`signUp` resuelve `{ user, accessToken, refreshToken }` y siempre inicia sesión.

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

Un enlace de inicio de sesión de un solo clic por correo electrónico. El enlace siempre es
`<base>/auth/magic-link?token=…`, donde `<base>` es el `email.magicLinkUrl` del
backend, o su base de restablecimiento de contraseña (`FRONTEND_URL` en el
runtime) cuando eso no está establecido. No hay un `redirectTo` por solicitud.
Sirve esa ruta en tu frontend, y devuelve el token para canjearlo por una
sesión. El CMS lo sirve, iniciando sesión (a través del paso de
código cuando hay un segundo factor); otros frontends necesitan una página de
aterrizaje.

```typescript
// 1. Ask for the link.
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
| `ANONYMOUS_AUTH_DISABLED` (403) | El backend no ha habilitado la autenticación anónima, o la desactivó después de que este invitado iniciara sesión: un invitado se convierte en cuenta solo mientras `allowAnonymous` está activado |
| `REGISTRATION_DISABLED` (403) | El registro está cerrado en el backend, y convertirse en cuenta es registrarse |
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

Tres campos no sensibles y nada más — lo suficiente para mostrar "estás invitando a Jane" antes de enviar una invitación. Opcional: solo para quien llama con sesión iniciada, y un 404
a menos que el backend defina `AUTH_ALLOW_USER_LOOKUP=true` (`auth.allowUserLookup`).

## Autenticación multifactor

Registrar un factor, el segundo paso del inicio de sesión, los códigos de recuperación y quitar un factor: [Autenticación multifactor](/docs/sdk/multi-factor-authentication/).

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

Una solicitud nunca sale con un token que el cliente sabe que ha caducado: las solicitudes
comparten una única actualización y se envían una sola vez, con el token nuevo. Un token que el
servidor rechaza antes de tiempo recibe igualmente una actualización, y después un reintento por
solicitud.

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

`useRebaseAuthController` en `@rebasepro/app` ya hace esto, por lo que una aplicación construida sobre la plantilla generada lo obtiene de forma automática. Las solicitudes de datos no tienen que esperar: una hecha a mitad de la restauración se envía en cuanto esta termina —como el usuario restaurado, o de forma anónima—, de modo que un primer renderizado nunca lee un listado público en lugar del propio del usuario.

Una restauración que actualiza (un token almacenado caducado, o el modo cookie) llega a
`onAuthStateChange` como `TOKEN_REFRESHED`; un token almacenado todavía válido se adopta
silenciosamente. Así que un escuchador no puede indicarte que la restauración ha finalizado: un arranque que no emite
nada es indistinguible de uno que aún está en curso. Espera con `await isInitialized()`
para esa comprobación y utiliza el escuchador para los cambios posteriores.

`restoreOutcome()` indica cómo terminó la restauración, una vez que `isInitialized()` se
ha resuelto: `"restored"`, `"none"` (nada que restaurar), `"refused"` (el servidor
rechazó la sesión) o `"unreachable"` (no se pudo contactar con el servidor, así que
la sesión no se confirmó ni se rechazó). En modo cookie, `"unreachable"`
sin sesión es el único caso en que no se sabe que «sin sesión iniciada» sea cierto:

```typescript
await client.auth.isInitialized();
if (!client.auth.getSession() && client.auth.restoreOutcome() === "unreachable") {
    console.log("Offline: could not check the session.");
}
```

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
| `USER_UPDATED` | `updateUser()` modificó el perfil, o `confirmEmailChange()` trasladó esta cuenta a su nueva dirección |
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

Toda otra sesión de la cuenta termina: quien tuviera otra tiene que iniciar
sesión de nuevo con la nueva contraseña. Este dispositivo permanece conectado.
El servidor responde con una sesión nueva, y el cliente la adopta (emitiendo
`TOKEN_REFRESHED`).

## Verificación de correo electrónico

El registro envía por correo a la nueva cuenta su enlace de verificación
cuando el correo electrónico está configurado. `sendVerificationEmail()` lo
envía de nuevo.

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

El enlace demuestra el acceso a la bandeja de entrada, no quién registró la
dirección, por lo que una contraseña que ni la sesión ni la llamada demuestran
se elimina en lugar de conservarse — consulta [Verificación de correo
electrónico](/docs/backend/email-verification/).

En un backend con `requireEmailVerification`, `signUp()` se resuelve con
`{ confirmationRequired: true, user: null }` y sin sesión: la cuenta inicia
sesión una vez que se sigue el enlace con su contraseña.

## Cambiar la dirección de correo electrónico

Un usuario que ha iniciado sesión traslada su propia cuenta a otra
dirección. Nada cambia hasta que la nueva dirección responde:

```typescript
// Mails a link to the new address, and a notice to the current one
const { pendingEmail, expiresAt } = await client.auth.changeEmail("jane@new.example");

// On the page the link opens (<frontend>/confirm-email-change?token=…):
const { email, removedProviders } = await client.auth.confirmEmailChange(token);
```

El enlace vive 24 horas; `getUser()` informa la dirección en espera como
`pendingEmail`. Confirmar no necesita sesión, y un cliente que ha iniciado
sesión como esa cuenta adopta la nueva dirección y emite `USER_UPDATED`. Los
rechazos se enumeran en [Cambiar una dirección de correo
electrónico](/docs/backend/auth-endpoints/#changing-an-email-address).

## Gestión de sesiones (multidispositivo)

```typescript
// List all active sessions, one per sign-in
const sessions = await client.auth.getSessions();
// [{ id, userAgent, ipAddress, createdAt, isCurrentSession }, …]

// Revoke a specific session
await client.auth.revokeSession(sessionId);

// Revoke ALL sessions (logs out everywhere)
await client.auth.revokeAllSessions();
```

Cada token de acceso nombra la sesión a la que pertenece, de modo que
exactamente una entrada tiene `isCurrentSession: true`: el dispositivo que
pregunta. Revocar una sesión termina el refresh token de ese dispositivo y su
token de acceso juntos, a partir de la siguiente solicitud, tanto por HTTP
como por un socket de tiempo real abierto. Cerrar sesión (`signOut()`) hace lo
mismo para el dispositivo que cierra sesión. Un token de acceso emitido antes
de esta versión no nombra ninguna sesión; sigue funcionando hasta que expira,
dentro de la hora.

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
//   magicLink: boolean, emailOtp?: boolean,
//   anonymousLogin: boolean, enabledProviders: string[],
//   externalLoginUrl?: string, needsSetup?: boolean, storage?: boolean
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

## Usar tu propio proveedor de autenticación

En 0.24 un getter de
token autentica solo las solicitudes HTTP, y el socket de tiempo real sigue siendo
anónimo.

Cuando los usuarios inician sesión con un proveedor propio (Clerk, Firebase Auth, o una
sesión que tu aplicación ya tiene), `client.auth` no interviene. Dale en su lugar al cliente un
getter para el token del proveedor. Se le pregunta cada vez que se
necesita un token: en cada solicitud HTTP, y cada vez que el socket de tiempo real
se autentica.

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: import.meta.env.VITE_API_URL });

client.setAuthTokenGetter(() => clerk.session?.getToken() ?? Promise.resolve(null));

// Optional: let Clerk recover a refused token, on HTTP and the socket alike.
client.setOnUnauthorized(async () => {
    await clerk.session?.reload();
    return true;
});

// The socket authenticates as the Clerk user.
client.data.posts.listen({}, (response) => render(response.data));
```

- El getter tiene prioridad sobre la sesión propia del cliente. Cuando responde `null` o
  lanza un error, el cliente envía el token que tenga, si lo hay: el de su sesión, uno
  definido con `client.setToken()`, o la opción `token`.
- La opción `token` se lee cada vez que se necesita un token, hasta que `setToken()` o
  un inicio de sesión la reemplaza, así que puede declararse como un getter
  (`get token() { return currentToken; }`).
- `setOnUnauthorized` cubre un 401 por HTTP y un error de autenticación en el socket,
  y reemplaza la renovación de sesión propia del cliente.

El backend tiene que verificar el token del proveedor: consulta
[Adaptadores de autenticación personalizados](/docs/backend/auth-adapters). En el panel de administración, define
el getter en el cliente que pasas a `<Rebase client>`
([Tu propio proveedor de autenticación](/docs/frontend/authentication#your-own-auth-provider)).

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
    pendingEmail?: string | null; // an address change waiting for its link
    roles?: string[];          // text[] from the users table
    metadata?: Record<string, unknown>;
}
```

## Próximos pasos

- **[Consulta de datos](/docs/sdk/querying)** — Operaciones CRUD y constructor de consultas
- **[Suscripciones en tiempo real](/docs/sdk/realtime)** — Datos en vivo con WebSockets
- **[Backend de autenticación](/docs/backend/authentication)** — Configuración de autenticación del lado del servidor
