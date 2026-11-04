---
sourceHash: dfb1bbaa122356f7
title: Autenticación
sidebar_label: Autenticación
description: Autenticación del lado del cliente con el SDK de Rebase — inicio de sesión con correo electrónico/contraseña, proveedores OAuth, gestión de sesiones y escuchadores de estado de autenticación.
---

## Descripción general

El módulo `client.auth` gestiona la autenticación de usuarios, la administración de tokens y la persistencia de sesiones. Una vez que un usuario inicia sesión, todas las solicitudes de datos posteriores incluyen automáticamente el JWT.

El SDK persiste las sesiones en `localStorage` de forma predeterminada y actualiza automáticamente los tokens antes de que expiren.

:::note[Cada método de inicio de sesión se resuelve en una sesión aplanada]
`signInWithEmail`, `signUp` y cada método `signInWith*` devuelven **`{ user, accessToken, refreshToken }`** — el SDK ya ha desempaquetado la respuesta por ti.

La API REST subyacente devuelve el token anidado en su lugar, como `{ user, tokens: { accessToken, … } }`. Esa diferencia solo importa si también llamas a `/api/auth/*` directamente con `fetch`, donde `body.accessToken` es `undefined` y el token está en `body.tokens.accessToken`. Consulta [el formato de conexión](/docs/backend/auth-endpoints/#response-format).
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
no hay sesión hasta que la dirección sea confirmada: `confirmationRequired` es `true` y `user` es `null`, así que indícale a la persona que revise su correo. De lo contrario, `confirmationRequired` es `false` y `user` es la cuenta con la sesión iniciada. En 0.23, `signUp` resuelve `{ user, accessToken, refreshToken }` y siempre inicia sesión.

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

Twitter también requiere el verificador de código PKCE:

```typescript
await client.auth.signInWithTwitter(code, redirectUri, codeVerifier);
```

### Apple

En un navegador, `signInWithApplePopup()` abre la ventana emergente de Apple, verifica el `state` e
inicia sesión con el código. Llámalo desde un controlador de clics. Llama a `preloadAppleSignIn()`
al montar el componente, ya que Safari bloquea las ventanas emergentes que esperan a que se descargue un script:

```typescript
import { preloadAppleSignIn } from "@rebasepro/client";

void preloadAppleSignIn();                                          // on mount
await client.auth.signInWithApplePopup({ clientId: "com.example.web" }); // on click
```

Sin `clientId`, el SDK lee el Services ID desde `/auth/config`, lo que
retrasa la ventana emergente. La URI de redirección se establece de forma predeterminada en el origen de la página más `/`, y
debe ser una Return URL en el Services ID (HTTPS, nunca `localhost`). Una ventana
emergente cerrada rechaza la promesa con el código `APPLE_SIGN_IN_CANCELLED`.

Una aplicación nativa de iOS o macOS envía el código de autorización desde el
inicio de sesión nativo de Apple junto con su bundle id. El bundle id debe estar listado en `APPLE_BUNDLE_IDS`:

```typescript
await client.auth.signInWithApple({
    code: credential.authorizationCode,
    bundleId: "com.example.ios",
    user: { name: { firstName: "Jane" } } // sent by Apple on the first sign-in only
});
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

Un enlace de inicio de sesión con un solo clic por correo electrónico. El enlace siempre es `<base>/auth/magic-link?token=…`, donde `<base>` es `email.magicLinkUrl` del backend, o su base para restablecer contraseña (`FRONTEND_URL` en el runtime) cuando este no esté configurado. No hay un `redirectTo` por solicitud. Sirve esa ruta en tu frontend y devuelve el token para canjearlo por una sesión. El CMS lo sirve, iniciando sesión (a través del paso del código cuando hay un segundo factor); otros frontends necesitan una página de aterrizaje (landing page).

```typescript
// 1. Ask for the link.
await client.auth.sendMagicLink("user@example.com");

// 2. On the landing page, trade the token for a session.
const token = new URLSearchParams(location.search).get("token")!;
const { user } = await client.auth.verifyMagicLink(token);
```

`sendMagicLink` responde lo mismo independientemente de si la dirección tiene o no
una cuenta. Esto es deliberado: un endpoint que dijera "no existe tal usuario" sería un oráculo
de enumeración de cuentas, así que no uses el resultado para decirle a una persona si está
registrada — no lo sabe.

Enviar uno requiere un servicio de correo electrónico configurado en el backend, o de lo contrario
`sendMagicLink` responderá con 503 `EMAIL_NOT_CONFIGURED`.

## Códigos de un solo uso

Un código de seis dígitos por correo electrónico, para la misma tarea en situaciones donde un enlace resulta incómodo — una aplicación
nativa, un segundo dispositivo o un navegador que altera los enlaces.

```typescript
const { expiresInSeconds } = await client.auth.sendEmailOtp("user@example.com");

// The address goes back with the code, because the code is only valid for it.
const { user } = await client.auth.verifyEmailOtp("user@example.com", "418293");
```

Enviar la dirección con el código es lo que hace que un intento de adivinanza de seis dígitos sea un intento
contra *una* cuenta en lugar de contra todas las cuentas a la vez.

## Sesiones anónimas

Inicia la sesión de un visitante sin ninguna credencial, para que pueda comenzar a usar la aplicación
antes de tener un motivo para registrarse:

```typescript
const { user } = await client.auth.signInAnonymously();
user.isAnonymous;   // true
```

La cuenta es real: tiene un id, roles y una sesión, por lo que la seguridad a nivel de fila (row-level security)
limita sus filas exactamente igual que lo haría con un usuario registrado. Lo que no tiene es
una forma de volver: nadie puede volver a iniciar sesión *como* ella una segunda vez, por lo que todo lo que posee se
pierde con la sesión.

`linkAnonymous` es la forma de hacer que deje de ser desechable. El usuario **conserva su id**, por lo que
todo lo que creó mientras era anónimo sigue siendo suyo:

```typescript
await client.auth.linkAnonymous("user@example.com", "correct-horse-battery");
```

| Error | Significado |
|---------|-------|
| `ANONYMOUS_AUTH_DISABLED` (403) | El backend no ha habilitado la autenticación anónima, o la desactivó desde que este invitado inició sesión: un invitado solo se convierte en una cuenta mientras `allowAnonymous` esté activado |
| `REGISTRATION_DISABLED` (403) | El registro está deshabilitado en el backend, y convertirse en cuenta cuenta como registro |
| `NOT_ANONYMOUS` (400) | La sesión actual pertenece a una cuenta ordinaria |
| `EMAIL_EXISTS` (409) | La dirección ya tiene una cuenta — inicia sesión en esa en su lugar |

Un invitado que nunca regresa permanece como una fila. Un administrador los
elimina con `client.admin.listGuests()`, `client.admin.deleteGuest(uid)` y
`client.admin.deleteGuests({ lastSeenBefore })`, o en Rebase Cloud con
[`rebase cloud guests`](/docs/cli/cloud/#guests). Estos métodos solo afectan a los invitados,
y `deleteGuests` funciona por lotes: repítelo mientras `remaining` no sea 0, con
`offset` establecido en la cantidad que se ha omitido hasta el momento.

## Vincular un proveedor a una cuenta existente

`signInWithGoogle` y métodos similares *inician sesión*. `linkProvider` asocia la
identidad de un proveedor a la cuenta que ya tiene la sesión iniciada, de modo que la misma persona pueda
volver a través de cualquiera de las vías:

```typescript
await client.auth.linkProvider("google", { idToken });
```

La sesión ya demuestra la propiedad de la cuenta, por lo que, a diferencia del inicio de sesión, esto no
requiere que el proveedor haya verificado el correo electrónico, y las dos direcciones no necesitan
coincidir. Se ejecuta con éxito de manera idempotente (`alreadyLinked: true`) cuando esa identidad ya
está en esta cuenta, y rechaza con `IDENTITY_ALREADY_LINKED` (409) cuando
pertenece a una diferente.

## Buscar un usuario por correo electrónico

```typescript
const profile = await client.auth.findUserByEmail("user@example.com");
// { uid, displayName, photoURL } | null
```

Tres campos no sensibles y nada más — lo suficiente para mostrar "estás invitando
a Jane" antes de enviar una invitación. Opcional (opt-in): solo para un invocador con sesión iniciada, y un error 404
a menos que el backend configure `AUTH_ALLOW_USER_LOOKUP=true` (`auth.allowUserLookup`).

## Autenticación multifactor

Registro de un factor, el segundo paso de un inicio de sesión, códigos de recuperación y eliminación de un factor: [Autenticación multifactor](/docs/sdk/multi-factor-authentication/).

## Cerrar sesión

```typescript
await client.auth.signOut();
```

Esto revoca el refresh token en el servidor, limpia la sesión local y emite un evento `SIGNED_OUT`.

## Gestión de sesiones

### Obtener la sesión actual

```typescript
const session = client.auth.getSession();
// { accessToken, refreshToken, expiresAt, user } | null
```

**Nunca guardes el objeto de sesión.** `getSession()` es una instantánea. Cada renovación
del access token, aproximadamente una vez por hora, reemplaza la sesión con un nuevo
objeto, por lo que una sesión conservada desde la carga de la página contiene un token que el servidor rechazará
una vez que expire, y la aplicación parecerá haber cerrado sesión. Lee la sesión en el momento en que la
necesites.

### Enviar el token a tus propias rutas

Llamar a una función en `backend/functions/` no requiere gestionar el token:
`client.functions.invoke` renueva el token antes de enviarlo y reintenta una vez en caso de
un error 401.

```typescript
const saved = await client.functions.invoke("progress", { level: 3 }, { path: "save" });
```

Para cualquier otra solicitud, solicita el token cada vez con `getAccessToken()`.
Este renueva un token que ha caducado o está a punto de hacerlo, espera a que se restaure
la sesión en la carga inicial y devuelve `null` cuando no hay ningún usuario con sesión iniciada.

```typescript
const token = await client.auth.getAccessToken();
await fetch("https://other.example.com/upload", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: file
});
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

### Actualizar el token

La actualización del token ocurre automáticamente, pero puedes activarla manualmente:

```typescript
const session = await client.auth.refreshSession();
```

Una solicitud nunca se envía con un token que el cliente sabe que ha expirado: las solicitudes
comparten una única actualización y se envían una vez, con el nuevo token. Un token que el servidor
rechace anticipadamente aún obtiene una actualización y luego un reintento por solicitud.

## Dónde reside la sesión: `authFlowMode`

```typescript
const client = createRebaseClient({
    baseUrl: API_URL,
    auth: { authFlowMode: "cookie" }
});
```

| Modo | Dónde está el refresh token | Predeterminado |
|------|----------------------------|---------|
| `"cookie"` | Una cookie **HttpOnly** que establece el backend. Los scripts que se ejecutan en tu página no pueden leerla, lo que la hace segura frente a ataques XSS | En un navegador |
| `"json"` | Se devuelve en el cuerpo de la respuesta, se guarda en `storage` (`localStorage` por defecto) | Fuera del navegador (Node, workers, React Native), y en un navegador cuando pasas tu propio `storage` |

Ambas partes deben coincidir. El modo cookie necesita `auth.cookieAuth` en el
backend, y el runtime de Rebase, que ejecuta Rebase Cloud, siempre lo activa.
El modo json necesita un backend sin él: contra un backend con `cookieAuth`, a un cliente
json no se le entrega ningún refresh token, y su sesión finaliza cuando expira el access token,
aproximadamente una hora después del inicio de sesión. Cuando la respuesta a un inicio de sesión muestra que
los modos no coinciden, el cliente registra un error indicando qué modo utilizar.

Pasar tu propio `storage` mantiene un cliente de navegador en modo json. Esto es útil para un
segundo cliente en la página que mantiene su propio inicio de sesión separado de la cookie
de la página: en modo cookie no se guardaría nada en ese almacenamiento.

## Esperar a que se restaure la sesión

**Una sesión restaurada no está disponible en el primer renderizado.** `getSession()` es
síncrono, por lo que al cargar la página devuelve `null` mientras la restauración aún está
en curso — y en modo cookie, una restauración *siempre* está en curso, porque el refresh
token se encuentra en una cookie que la página no puede leer, por lo que el cliente tiene que solicitar al servidor
un access token nuevo.

Leerlo de forma síncrona es lo que produce un parpadeo de "sesión cerrada" en cada recarga:

```typescript no-verify
// Wrong: renders the signed-out view for one round trip, every reload.
const session = client.auth.getSession();
if (!session) return <SignIn />;
```

`isInitialized()` se resuelve una vez que el cliente ha terminado de intentarlo — haya
encontrado o no una sesión:

```typescript
async function currentUser() {
    await client.auth.isInitialized();
    return client.auth.getSession()?.user ?? null;
}
```

En React, esto es un solo effect:

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

`useRebaseAuthController` en `@rebasepro/app` ya hace esto, por lo que una aplicación creada
a partir de la plantilla generada lo obtiene de forma automática. Las solicitudes de datos no necesitan esperar: una realizada
a mitad de la restauración se envía una vez que esta se completa — como el usuario restaurado, o de forma anónima — de modo que un
primer renderizado nunca lee un listado público en lugar del propio del usuario.

Una restauración que renueva el token (un token almacenado expirado o en modo cookie) llega a
`onAuthStateChange` como `TOKEN_REFRESHED`; un token almacenado que todavía es válido se adopta
silenciosamente. Por lo tanto, un escuchador no puede indicarte si la restauración ha finalizado: un arranque que no emite
nada es indistinguible de uno que aún está en curso. Espera con `await isInitialized()`
para esa comprobación y utiliza el escuchador para los cambios posteriores.

`restoreOutcome()` indica cómo finalizó la restauración una vez que `isInitialized()` se ha
resuelto: `"restored"`, `"none"` (nada que restaurar), `"refused"` (el servidor
rechazó la sesión) o `"unreachable"` (no se pudo acceder al servidor, por lo que
la sesión no fue confirmada ni rechazada). En modo cookie, `"unreachable"`
sin sesión es el único caso en el que no se sabe a ciencia cierta si el estado es "sesión cerrada":

```typescript
await client.auth.isInitialized();
if (!client.auth.getSession() && client.auth.restoreOutcome() === "unreachable") {
    console.log("Offline: could not check the session.");
}
```

## Escuchador de estado de autenticación

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
|-------|------|
| `SIGNED_IN` | Se completó un inicio de sesión o un registro |
| `TOKEN_REFRESHED` | El access token fue renovado — incluida la renovación silenciosa que restaura una sesión al cargar la página |
| `USER_UPDATED` | `updateUser()` cambió el perfil, `linkAnonymous()` convirtió un invitado en cuenta, `changeEmail()` inició un cambio de dirección o `confirmEmailChange()` trasladó esta cuenta a su nueva dirección |
| `SIGNED_OUT` | Un cierre de sesión, `revokeAllSessions()` o una actualización que falló definitivamente |

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

Todas las demás sesiones de la cuenta se cierran: cualquier otra persona que tuviera una deberá iniciar sesión
con la nueva contraseña. Este dispositivo permanece con la sesión iniciada. El servidor responde con una
sesión nueva y el cliente la adopta (emitiendo `TOKEN_REFRESHED`).

## Verificación de correo electrónico

Al registrarse, se envía por correo el enlace de verificación a la nueva cuenta cuando el correo electrónico está
configurado. `sendVerificationEmail()` lo envía nuevamente.

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

El enlace demuestra el acceso a la bandeja de entrada, no quién registró la dirección, por lo que una contraseña
que ni la sesión ni la llamada demuestren se elimina en lugar de conservarse — consulta
[Verificación de correo electrónico](/docs/backend/email-verification/).

En un backend con `requireEmailVerification`, `signUp()` se resuelve con
`{ confirmationRequired: true, user: null }` y sin sesión: la cuenta
inicia sesión una vez que se sigue el enlace con su contraseña.

## Cambiar la dirección de correo electrónico

Un usuario con sesión iniciada traslada su propia cuenta a otra dirección. Nada
cambia hasta que se responda desde la nueva dirección:

```typescript
// Mails a link to the new address, and a notice to the current one
const { pendingEmail, expiresAt } = await client.auth.changeEmail("jane@new.example");

// On the page the link opens (<frontend>/confirm-email-change?token=…):
const { email, removedProviders } = await client.auth.confirmEmailChange(token);
```

El enlace tiene una validez de 24 horas; `getUser()` reporta la dirección en espera como
`pendingEmail`. Confirmar no requiere sesión, y un cliente con sesión iniciada como esa
cuenta adopta la nueva dirección y emite `USER_UPDATED`. Los motivos de rechazo se enumeran
en [Cambiar una dirección de correo electrónico](/docs/backend/auth-endpoints/#changing-an-email-address).

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

Cada access token indica el inicio de sesión al que pertenece, por lo que exactamente una entrada tiene
`isCurrentSession: true`: el dispositivo que hace la consulta. Revocar una sesión invalida el
refresh token de ese dispositivo y su access token juntos, a partir de la siguiente solicitud,
a través de HTTP y a través de un socket en tiempo real abierto. Cerrar sesión (`signOut()`) hace lo
mismo para el dispositivo que cierra sesión. Un access token emitido antes de esta versión
no nombra ninguna sesión; sigue funcionando hasta que expira, dentro de un plazo de una hora.

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
//   providerClientIds?: Record<string, string>,   // public ids, e.g. { apple: Services ID }
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

Clerk, Firebase Auth o una sesión que tu aplicación ya tenga, con un captador de tokens (token getter)
en lugar de `client.auth`: [Tu propio proveedor de autenticación](/docs/sdk/your-own-auth-provider/).

## Estructura del objeto User

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

- **[Querying Data](/docs/sdk/querying)** — Operaciones CRUD y generador de consultas
- **[Realtime Subscriptions](/docs/sdk/realtime)** — Datos en vivo con WebSockets
- **[Authentication Backend](/docs/backend/authentication)** — Configuración de autenticación del lado del servidor
