---
sourceHash: 468b0d48039a8127
title: Autenticación
sidebar_label: Autenticación
description: Autenticación en el lado del cliente con el SDK de Rebase — inicio de sesión con correo electrónico/contraseña, proveedores OAuth, gestión de sesiones y escuchadores del estado de autenticación.
---

## Descripción general

El módulo `client.auth` gestiona la autenticación de usuarios, la administración de tokens y la persistencia de sesiones. Una vez que un usuario inicia sesión, todas las solicitudes de datos posteriores incluyen automáticamente el JWT.

El SDK persiste las sesiones en `localStorage` por defecto y renueva automáticamente los tokens antes de que expiren.

:::note[Cada método de inicio de sesión se resuelve en una sesión aplanada]
`signInWithEmail`, `signUp` y cada método `signInWith*` devuelven **`{ user, accessToken, refreshToken }`**; el SDK ya ha desempaquetado la respuesta por ti.

La API REST subyacente devuelve el token anidado en su lugar, como `{ user, tokens: { accessToken, … } }`. Esa diferencia solo importa si también llamas a `/api/auth/*` directamente con `fetch`, donde `body.accessToken` es `undefined` y el token se encuentra en `body.tokens.accessToken`. Consulta [el formato de conexión](/docs/backend/auth-endpoints/#response-format).
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
no hay sesión hasta que se confirme la dirección: `confirmationRequired` es `true` y `user` es `null`, por lo que debes indicarle a la persona que revise su correo. De lo contrario, `confirmationRequired` es `false` y `user` es la cuenta con la sesión iniciada. En 0.23 `signUp` resuelve `{ user, accessToken, refreshToken }` y siempre inicia sesión.

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
al montar el componente, ya que Safari bloquea cualquier ventana emergente que espere a que se descargue un script:

```typescript
import { preloadAppleSignIn } from "@rebasepro/client";

void preloadAppleSignIn();                                          // on mount
await client.auth.signInWithApplePopup({ clientId: "com.example.web" }); // on click
```

Sin `clientId`, el SDK lee el Services ID desde `/auth/config`, lo cual
retrasa la ventana emergente. El URI de redirección se establece por defecto en el origen de la página más `/`, y
debe ser una Return URL en el Services ID (HTTPS, nunca `localhost`). Si se cierra la ventana emergente,
la promesa se rechaza con el código `APPLE_SIGN_IN_CANCELLED`.

Una aplicación nativa de iOS o macOS envía el código de autorización desde el inicio de sesión
nativo de Apple junto con su bundle id. El bundle id debe estar registrado en `APPLE_BUNDLE_IDS`:

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

## Magic Links

Un enlace de inicio de sesión con un solo clic enviado por correo electrónico. El enlace siempre tiene el formato `<base>/auth/magic-link?token=…`, donde `<base>` es el valor de `email.magicLinkUrl` del backend, o su base para restablecer contraseñas (`FRONTEND_URL` en el runtime) cuando no esté configurado. No existe un parámetro `redirectTo` por solicitud. Sirve esa ruta en tu frontend y devuelve el token para canjearlo por una sesión. El CMS ya se encarga de servirlo e iniciar sesión (pasando por el paso del código cuando hay un segundo factor); otros frontends requieren una página de destino.

```typescript
// 1. Ask for the link.
await client.auth.sendMagicLink("user@example.com");

// 2. On the landing page, trade the token for a session.
const token = new URLSearchParams(location.search).get("token")!;
const { user } = await client.auth.verifyMagicLink(token);
```

`sendMagicLink` responde lo mismo independientemente de si la dirección de correo
pertenece a una cuenta o no. Esto es intencional: un endpoint que respondiera "no existe tal usuario" sería un
oráculo de enumeración de cuentas, así que no utilices la respuesta para indicarle a una persona si está
registrada; el servicio no lo revela.

Para poder enviarlo, se requiere un servicio de correo electrónico configurado en el backend; de lo contrario,
`sendMagicLink` responderá con un error 503 `EMAIL_NOT_CONFIGURED`.

## Códigos de un solo uso

Un código de seis dígitos enviado por correo electrónico, útil para el mismo propósito cuando un enlace resulta poco práctico: una
aplicación nativa, un segundo dispositivo o un navegador que altere los enlaces.

```typescript
const { expiresInSeconds } = await client.auth.sendEmailOtp("user@example.com");

// The address goes back with the code, because the code is only valid for it.
const { user } = await client.auth.verifyEmailOtp("user@example.com", "418293");
```

Enviar la dirección junto con el código es lo que garantiza que un intento de adivinanza de seis dígitos se realice contra *una* cuenta específica y no contra todas las cuentas simultáneamente.

## Sesiones anónimas

Inicia la sesión de un visitante sin credenciales, permitiéndole comenzar a usar la aplicación
antes de que tenga motivos para registrarse:

```typescript
const { user } = await client.auth.signInAnonymously();
user.isAnonymous;   // true
```

La cuenta es real: cuenta con un id, roles y una sesión, por lo que la seguridad a nivel de fila
delimita sus registros exactamente como lo haría con los de un usuario registrado. Lo que no tiene es
una vía de retorno: nadie puede volver a iniciar sesión *como* esa cuenta por segunda vez, de modo que todo lo que le pertenece
se pierde junto con la sesión.

`linkAnonymous` permite que la cuenta deje de ser desechable. El usuario **conserva su id**, de modo
que todo lo creado de forma anónima sigue perteneciendo a su cuenta:

```typescript
await client.auth.linkAnonymous("user@example.com", "correct-horse-battery");
```

| Fallo | Significado |
|-------|-------------|
| `ANONYMOUS_AUTH_DISABLED` (403) | El backend no tiene habilitada la autenticación anónima o la desactivó después de que este invitado iniciara sesión: un invitado solo puede convertirse en cuenta si `allowAnonymous` está activo |
| `REGISTRATION_DISABLED` (403) | El registro está deshabilitado en el backend, y convertirse en cuenta implica registrarse |
| `NOT_ANONYMOUS` (400) | La sesión actual pertenece a una cuenta estándar |
| `EMAIL_EXISTS` (409) | La dirección ya está asociada a una cuenta; inicia sesión en ella en su lugar |

Un invitado que no regresa permanece como una fila en la base de datos. Un administrador puede
eliminarlos mediante `client.admin.listGuests()`, `client.admin.deleteGuest(uid)` y
`client.admin.deleteGuests({ lastSeenBefore })`, o en Rebase Cloud con
[`rebase cloud guests`](/docs/cli/cloud/#guests). Estos métodos solo interactúan con invitados,
y `deleteGuests` opera por lotes: repítelo mientras `remaining` no sea 0, configurando
`offset` con la cantidad de registros omitidos hasta el momento.

## Vincular un proveedor a una cuenta existente

`signInWithGoogle` y sus variantes *inician sesión* para un usuario. `linkProvider` asocia la
identidad de un proveedor a la cuenta que ya tiene la sesión iniciada, de modo que la misma persona pueda
acceder mediante cualquiera de los métodos:

```typescript
await client.auth.linkProvider("google", { idToken });
```

Dado que la sesión ya valida la propiedad de la cuenta, a diferencia del inicio de sesión esto no
requiere que el proveedor haya verificado el correo electrónico, y las dos direcciones no necesitan
coincidir. La operación se completa de forma idempotente (`alreadyLinked: true`) si la identidad ya
está asociada a esta cuenta, y se rechaza con `IDENTITY_ALREADY_LINKED` (409) si
pertenece a otra diferente.

## Buscar un usuario por correo electrónico

```typescript
const profile = await client.auth.findUserByEmail("user@example.com");
// { uid, displayName, photoURL } | null
```

Tres campos no confidenciales y nada más, suficiente para mostrar "estás invitando a
Jane" antes de enviar una invitación. Requiere activación explícita (opt-in): solo está disponible para usuarios con sesión iniciada y devuelve un 404
a menos que el backend configure `AUTH_ALLOW_USER_LOOKUP=true` (`auth.allowUserLookup`).

## Autenticación multifactor

Inscripción de un factor, el segundo paso de un inicio de sesión, códigos de recuperación y eliminación de factores: [Autenticación multifactor](/docs/sdk/multi-factor-authentication/).

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

**Nunca conserves la referencia al objeto de sesión.** `getSession()` devuelve una instantánea. Cada renovación
del token de acceso (aproximadamente una vez por hora) reemplaza la sesión con un nuevo
objeto; por tanto, una sesión retenida desde la carga de la página portará un token que el servidor rechazará
una vez expirado, haciendo que la aplicación parezca haber cerrado sesión. Consulta la sesión únicamente cuando la necesites.

### Enviar el token a tus propias rutas

Llamar a una función en `backend/functions/` no requiere gestionar el token manualmente:
`client.functions.invoke` renueva el token antes de enviar la solicitud y la reintenta una vez si recibe un código 401.

```typescript
const saved = await client.functions.invoke("progress", { level: 3 }, { path: "save" });
```

Para cualquier otra solicitud, solicita el token en cada ocasión mediante `getAccessToken()`.
Este método renueva tokens expirados o a punto de expirar, aguarda a que se complete la restauración de la sesión
al cargar la página y devuelve `null` si no hay ningún usuario autenticado.

```typescript
const token = await client.auth.getAccessToken();
await fetch("https://other.example.com/upload", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: file
});
```

### Obtener el usuario actual (verificado en el servidor)

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

### Renovar el token

La renovación del token se ejecuta de forma automática, pero puedes desencadenarla manualmente:

```typescript
const session = await client.auth.refreshSession();
```

Una solicitud nunca se despacha con un token que el cliente ya sabe vencido: las solicitudes
en curso comparten una única renovación y se envían una sola vez con el nuevo token. Un token rechazado
prematuramente por el servidor recibe igualmente una renovación y un reintento por solicitud.

## Dónde reside la sesión: `authFlowMode`

```typescript
const client = createRebaseClient({
    baseUrl: API_URL,
    auth: { authFlowMode: "cookie" }
});
```

| Modo | Ubicación del token de actualización | Por defecto |
|------|--------------------------------------|-------------|
| `"cookie"` | Una cookie **HttpOnly** establecida por el backend. Los scripts ejecutados en tu página no pueden leerla, lo que la protege contra ataques XSS | En el navegador |
| `"json"` | Devuelto en el cuerpo de la respuesta, almacenado en `storage` (`localStorage` por defecto) | Fuera del navegador (Node, workers, React Native), y en el navegador al proporcionar un `storage` personalizado |

El modo cookie requiere `auth.cookieAuth` en el backend, opción que el entorno de ejecución de Rebase
(y por extensión Rebase Cloud) mantiene siempre habilitada. El modo json funciona con ambos esquemas: sus solicitudes de autenticación incluyen `x-rebase-auth-flow: json`, y el backend responde con el
token de actualización en el cuerpo. Un backend desactualizado no entregará un token de actualización a un cliente json, por lo que la sesión finalizará cerca de una hora después del inicio de sesión, y el cliente registrará en los logs el modo correspondiente a utilizar (a menos que se haya provisto un `storage` personalizado).

Pasar tu propio `storage` mantiene el cliente del navegador en modo json; esto resulta útil para instanciar un segundo
cliente que conserve su propia autenticación al margen de la cookie de la página (por ejemplo, un invitado
en paralelo a la cuenta principal). Dado que su token de actualización se almacena allí y los scripts de la página pueden leerlo, es recomendable mantener la cuenta principal en modo cookie.

## Esperar a que se restaure la sesión

**Una sesión restaurada no se encuentra disponible durante el primer renderizado.** `getSession()` es
síncrono, por lo que al cargar la página devuelve `null` mientras el proceso de restauración continúa en
curso —y en modo cookie siempre se encuentra *en curso*, puesto que el token de actualización
reside en una cookie ilegible por la página, obligando al cliente a solicitar al servidor un nuevo token de acceso.

Leer el estado de forma sincrónica provoca un parpadeo visual de sesión cerrada en cada recarga:

```typescript no-verify
// Wrong: renders the signed-out view for one round trip, every reload.
const session = client.auth.getSession();
if (!session) return <SignIn />;
```

`isInitialized()` se resuelve una vez que el cliente concluye el intento de inicialización,
tanto si localizó una sesión como si no:

```typescript
async function currentUser() {
    await client.auth.isInitialized();
    return client.auth.getSession()?.user ?? null;
}
```

En React, esto se gestiona mediante un hook de efecto:

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

`useRebaseAuthController` en `@rebasepro/app` implementa este patrón por defecto, por lo que las aplicaciones basadas
en la plantilla generada ya disponen de él. Las solicitudes de datos no necesitan esperar: una petición emitida
durante la restauración se envía una vez que esta concluye —actuando como el usuario restaurado o de forma anónima—, impidiendo que el primer renderizado lea accidentalmente listados públicos en lugar de la información propia del usuario.

Una restauración que realiza una renovación (por un token almacenado expirado o bajo modo cookie) emite el evento
`TOKEN_REFRESHED` hacia `onAuthStateChange`; un token almacenado aún vigente se adopta
silenciosamente. Debido a esto, un listener no permite discernir si la restauración ha concluido: un arranque que no emite eventos es indistinguible de uno que aún está procesándose. Utiliza `await isInitialized()`
para determinar este estado y emplea el listener exclusivamente para registrar cambios posteriores.

`restoreOutcome()` describe el resultado de la restauración una vez que `isInitialized()`
ha resuelto: `"restored"`, `"none"` (no había nada que restaurar), `"refused"` (el servidor
rechazó la sesión) o `"unreachable"` (no fue posible contactar al servidor, por lo que
la sesión no pudo ser confirmada ni rechazada). En modo cookie, un estado `"unreachable"`
sin sesión representa el único caso en el que no puede asegurarse que la sesión esté verdaderamente cerrada:

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

| Evento | Cuándo ocurre |
|--------|---------------|
| `SIGNED_IN` | Se completó un inicio de sesión o un registro |
| `TOKEN_REFRESHED` | Se renovó el token de acceso —incluida la renovación silenciosa que restaura la sesión al cargar la página |
| `USER_UPDATED` | `updateUser()` modificó el perfil, `linkAnonymous()` vinculó un invitado a una cuenta, `changeEmail()` inició una solicitud de cambio de dirección o `confirmEmailChange()` completó la migración de la cuenta a su nueva dirección |
| `SIGNED_OUT` | Un cierre de sesión explícito, la invocación de `revokeAllSessions()` o un intento de renovación que falló de forma irrecuperable |

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

Todas las demás sesiones de la cuenta se cerrarán: cualquier otra persona que tuviese una sesión abierta deberá iniciar sesión
utilizando la nueva contraseña. El dispositivo actual permanecerá autenticado. El servidor responderá con una
nueva sesión y el cliente la adoptará (emitiendo `TOKEN_REFRESHED`).

## Verificación de correo electrónico

Al registrarse una nueva cuenta, se le envía por correo su enlace de verificación si el servicio de correo está configurado. `sendVerificationEmail()` permite reenviarlo.

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

El enlace acredita el control sobre la bandeja de entrada, no la identidad de quien registró la dirección; por consiguiente, una contraseña que no quede validada ni por la sesión ni por los parámetros de la invocación será eliminada en lugar de preservarse —consulta [Verificación de correo electrónico](/docs/backend/email-verification/).

En un backend con `requireEmailVerification`, `signUp()` se resuelve devolviendo
`{ confirmationRequired: true, user: null }` y sin sesión: el usuario inicia
sesión únicamente tras acceder al enlace provisto ingresando su contraseña.

## Cambiar la dirección de correo electrónico

Un usuario autenticado puede transferir su cuenta hacia otra dirección. Ninguna modificación
se aplica hasta que la nueva dirección confirme la solicitud:

```typescript
// Mails a link to the new address, and a notice to the current one
const { pendingEmail, expiresAt } = await client.auth.changeEmail("jane@new.example");

// On the page the link opens (<frontend>/confirm-email-change?token=…):
const { email, removedProviders } = await client.auth.confirmEmailChange(token);
```

El enlace tiene una validez de 24 horas; `getUser()` reporta la dirección pendiente bajo el campo
`pendingEmail`. El proceso de confirmación no requiere una sesión activa, y cualquier cliente autenticado
en dicha cuenta adoptará la nueva dirección y emitirá el evento `USER_UPDATED`. Los posibles motivos de rechazo se detallan en [Cambio de dirección de correo electrónico](/docs/backend/auth-endpoints/#changing-an-email-address).

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

Cada token de acceso identifica el inicio de sesión al que pertenece; por lo tanto, únicamente un elemento contendrá
`isCurrentSession: true`: el dispositivo emisor de la consulta. Revocar una sesión invalida concurrentemente tanto el token de actualización como el token de acceso de ese dispositivo a partir de la siguiente petición, tanto a través de HTTP como sobre conexiones WebSocket en tiempo real. Cerrar sesión (`signOut()`) aplica el mismo comportamiento para el dispositivo saliente. Un token de acceso generado con anterioridad a esta funcionalidad carece de asignación de sesión y continuará operativo hasta su expiración, dentro del término de una hora.

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

## Almacenamiento de sesiones personalizado

Por defecto, las sesiones se almacenan en `localStorage`. Puedes personalizar este comportamiento mediante la opción `auth`:

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

Clerk, Firebase Auth o una sesión preexistente en tu aplicación integrada mediante una función de obtención de tokens en lugar de `client.auth`: [Tu propio proveedor de autenticación](/docs/sdk/your-own-auth-provider/).

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

- **[Consultar datos](/docs/sdk/querying)** — Operaciones CRUD y constructor de consultas
- **[Suscripciones en tiempo real](/docs/sdk/realtime)** — Datos en tiempo real mediante WebSockets
- **[Backend de autenticación](/docs/backend/authentication)** — Configuración de autenticación en el servidor
