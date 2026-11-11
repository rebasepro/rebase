---
sourceHash: 3c34341487182d4a
title: Autenticación
sidebar_label: Autenticación
description: Configura autenticación JWT, proveedores OAuth, correo SMTP, protección contra bots y la colección de usuarios en el backend de Rebase.
---

La autenticación abarca tres páginas porque comprende tres tareas. Esta trata sobre la **configuración**: qué va en el bloque `auth` y en el entorno.

- [Endpoints and tokens](/docs/backend/auth-endpoints/) — las rutas que monta el backend, las formas de las respuestas, MFA, el contexto de base de datos que ve una política, JWKS y claves de servicio.
- [Custom auth adapters](/docs/backend/auth-adapters/) — reemplazar el proveedor integrado con Clerk, Firebase Auth o el tuyo propio.

## Descripción general

Rebase incluye un sistema completo de autenticación en el backend:

- **Tokens JWT** — Flujo de tokens de acceso (access token) y actualización (refresh token) con expiración configurable
- **Proveedores OAuth** — Google, LinkedIn, GitHub, Microsoft, Apple y más
- **Correo SMTP** — Flujos de restablecimiento de contraseña y verificación de correo electrónico
- **Hooks de autenticación** — Hooks del ciclo de vida para la creación de usuarios y más
- **Adaptadores de autenticación personalizados** — Conecta Firebase Auth, Auth0, Clerk o cualquier proveedor externo
- **Clave de servicio (Service key)** — Clave estática para autenticación de servidor a servidor
- **Inicialización automática (Auto-bootstrapping)** — Fuera de producción, el primer usuario obtiene automáticamente el rol de administrador; un despliegue en producción define a su administrador mediante `REBASE_ADMIN_EMAIL` / `REBASE_ADMIN_PASSWORD`

## Configuración

:::note[Dónde va esto]
**Entorno de ejecución administrado:** variables de entorno — `JWT_SECRET`, `AUTH_*`, `SMTP_*`, `CAPTCHA_*` y los pares `*_CLIENT_ID` / `*_CLIENT_SECRET` de los proveedores, uno para cada uno de los doce proveedores ([los nombres en variables](#nombres-en-variables-de-entorno); el de Apple consta de cuatro claves, no de un par). La colección de usuarios es la que defina el bundle (`collections/users` por convención).
**Sin ruta administrada:** `auth.hooks`. Son funciones; haga un eject para pasarlas.
**Ejected:** `initializeRebaseBackend({ auth })` en `backend/src/index.ts`.
:::

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
                    timeoutMs: 30_000,                 // Connect, greeting and silence limit (the default)
                },
                appName: env.APP_NAME,
                logoUrl: env.EMAIL_LOGO_URL,           // Logo shown atop the default templates
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

### El bloque `auth`, al completo

| Clave | Tipo | Por defecto | Qué hace |
|-----|------|---------|--------------|
| `collection` | `CollectionConfig` | — | La colección de usuarios. Consulta [Configuración de autenticación a nivel de colección](#configuración-de-autenticación-a-nivel-de-colección) |
| `jwtSecret` | `string` | — | Secreto de firma HS256. Requerido en producción |
| `signingKeys` | `JwtSigningKeyConfig[]` | — | Claves de firma asimétricas — consulta [Tokens asimétricos y JWKS](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) |
| `activeKid` | `string` | primera clave | Cuál de las `signingKeys` emite nuevos tokens |
| `accessExpiresIn` | `string` | `1h` | Tiempo de vida del token de acceso |
| `refreshExpiresIn` | `string` | `30d` | Tiempo de vida del token de actualización. Deslizante: cada rotación lo renueva, por lo que este es el tiempo que sobrevive una sesión a la **inactividad**. El entorno de ejecución pasa `JWT_REFRESH_EXPIRES_IN`, cuyo valor por defecto también es `30d`. Los navegadores limitan la cookie de actualización a 400 días, por lo que un valor mayor no aporta nada en el modo de cookies |
| `refreshTokenReuseIntervalSeconds` | `number` | `10` | Cuánto tiempo un token de actualización que ya fue rotado sigue emitiendo un hermano de su sesión, para que un cliente que perdió una respuesta de actualización no cierre sesión |
| `refreshTokenReuse` | `"reject" \| "revoke-session"` | `"reject"` | Qué hace un token de actualización presentado después de esa ventana. `"reject"` lo rechaza (`TOKEN_ALREADY_USED`) y lo registra, manteniendo la sesión: esto no es detección de reutilización, ya que quien actualizó primero conserva la sesión. `"revoke-session"` finaliza todo el inicio de sesión ante dicha repetición (`SESSION_REVOKED`), tal como hace GoTrue, y el propietario vuelve a iniciar sesión. `AUTH_REFRESH_TOKEN_REUSE` |
| `requireAuth` | `boolean` | `true` | Requiere una sesión para la API de datos |
| `allowRegistration` | `boolean` | `false` | Habilita `POST /api/auth/register`. Fuera de producción, el primer usuario en una tabla vacía se admite de cualquier manera; en producción, el administrador se define con `REBASE_ADMIN_EMAIL` |
| `disableSelfRegistration` | `boolean` | `false` | Interruptor de apagado de emergencia (kill switch): también cierra la ventana de inicialización del primer usuario que `allowRegistration: false` deja abierta |
| `allowAnonymous` | `boolean` | `false` | Habilita `POST /api/auth/anonymous`. Deliberadamente no está condicionado por `allowRegistration` — una aplicación pública mayormente de lectura puede requerir sesiones sin cuentas. Convertir a un invitado en una cuenta (`POST /api/auth/anonymous/link`) es un registro y también requiere `allowRegistration` — y que `allowAnonymous` siga activo: desactivado, también rechaza a los invitados que ya han iniciado sesión, por lo que ninguno puede convertirse en cuenta (`403 ANONYMOUS_AUTH_DISABLED`) |
| `allowUserLookup` | `boolean` | `false` | Monta `POST /api/auth/find-user` para flujos de invitación por correo electrónico |
| `captcha` | `CaptchaConfig` | — | Protección contra bots en las rutas que envían correos — consulta [Protección contra bots](#protección-contra-bots) |
| `defaultRole` | `string` | — | Rol asignado a un usuario recién registrado cuando no se especifica ninguno. No puede ser `admin` ni un rol declarado que posea un ámbito (scope) del plano de administración: el arranque rechazará ambos |
| `serviceKey` | `string` | — | Clave estática para llamadas de servidor a servidor — consulta [Autenticación con clave de servicio](/docs/backend/auth-endpoints/#service-key-authentication) |
| `email` | `EmailConfig` | — | SMTP, para restablecimiento de contraseña, verificación, invitaciones y enlaces mágicos (magic links) |
| `magicLink` | `boolean` | `false` | Habilita el inicio de sesión sin contraseña por correo electrónico. Requiere configurar `email`; de lo contrario, las rutas responderán con `503 EMAIL_NOT_CONFIGURED` |
| `emailOtp` | `boolean` | `false` | Habilita códigos de inicio de sesión de seis dígitos por correo — consulta [Códigos de un solo uso](#códigos-de-un-solo-uso-por-correo-electrónico). Mismo requisito de correo |
| `deviceLogin` | `{ verificationUrl: string }` | — | Permite que una terminal u otro dispositivo sin navegador inicie sesión mediante uno — consulta [Device sign-in](/docs/backend/device-sign-in/). Requiere una base de datos SQL |
| `magicLinkCreatesUsers` | `boolean` | `false` | Registro sin contraseña: una solicitud de enlace mágico o código por correo para una dirección sin cuenta creará una (sin contraseña, no verificada hasta que se use el enlace o código), mientras `allowRegistration` esté activo. Ejecuta `beforeUserCreate` y asigna el rol por defecto. Desactivado, esas solicitudes no crean nada y responden a una dirección desconocida de la misma manera que a una conocida. `AUTH_MAGIC_LINK_CREATES_USERS` |
| `requireEmailVerification` | `boolean` | `false` | Rechaza el inicio de sesión con contraseña hasta que la dirección sea verificada, y registra confirmando primero — consulta [Verificación de correo electrónico](/docs/backend/email-verification/). Requiere `email`; el arranque lo rechazará si no está presente |
| `cookieAuth` | `CookieAuthConfig \| false` | activo | Entrega el token de actualización como una cookie `httpOnly` `Secure` `SameSite` en lugar de incluirlo en el cuerpo JSON; `false` lo responde en el cuerpo — ver a continuación |
| `providers` | `OAuthProvider[]` | `[]` | El array canónico de OAuth; los campos de proveedores nombrados se resuelven en él |
| `allowedRedirectUris` | `string[]` | — | Restringe qué URIs de redirección aceptan las rutas de OAuth |
| `hooks` | `AuthHooks` | — | `beforeUserCreate`, `afterUserCreate`, `afterUserDelete`, … |

#### Tokens de actualización en una cookie `httpOnly`

```typescript no-verify
auth: { cookieAuth: { sameSite: "Lax" } }
```

El token de actualización es la credencial de larga duración y, si se encuentra en el cuerpo, cualquier vulnerabilidad XSS en la página podría leerlo. `cookieAuth` lo guarda en una cookie que los scripts de la página no pueden tocar: está habilitado a menos que lo desactives, siempre en el entorno de ejecución y desde la versión 0.30 en `initializeRebaseBackend`. El token de **acceso** permanece en el cuerpo para usarse en la cabecera `Authorization`. Una solicitud con `x-rebase-auth-flow: json` recibe el token de actualización en el cuerpo; con `cookieAuth: false` lo hacen todas las solicitudes, y un cliente de navegador necesitará `authFlowMode: "json"`.

Deben cumplirse dos requisitos o, de lo contrario, el inicio de sesión fallará en lugar de degradarse con gracia: las peticiones `fetch` del cliente a los endpoints de autenticación requieren `credentials: "include"`, y CORS debe permitir credenciales — lo que significa una lista explícita de orígenes, nunca `origin: "*"`. `AUTH_COOKIE_SAME_SITE` es el nombre de la variable de entorno para `sameSite`, y `AUTH_COOKIE_SECURE` para `secure`.

La cookie incluye `Secure` a menos que se desactive expresamente, y nada en la solicitud puede inferirlo: si se lee desde el protocolo de la solicitud, que es `http` detrás de cualquier proxy de terminación TLS, el token se enviaría en texto plano. `AUTH_COOKIE_SECURE=false` es la única alternativa para un despliegue servido a través de http simple (una dirección de red local LAN, un appliance), y emitirá una advertencia durante el arranque. `http://localhost` no lo necesita.

| Clave | Por defecto | |
|-----|---------|--|
| `cookieName` | `__rb_refresh` | |
| `domain` | dominio actual | |
| `path` | `/` | |
| `sameSite` | `Lax` | `None` es solo para un frontend genuinamente cross-site |
| `secure` | `true` | Seguro por defecto; `AUTH_COOKIE_SECURE=false` para http simple |

:::caution[Los callbacks de colección no se ejecutan para usuarios de autenticación]
La creación y actualización de usuarios a través del sistema de autenticación — registro, administración de usuarios y OAuth — escriben **directamente** en el almacén de usuarios y omiten el flujo de guardado de la colección. Los callbacks `beforeSave`/`afterSave`/`beforeDelete`/`afterDelete` en la colección de autenticación (usuarios) **no** se ejecutarán para estas rutas. Para efectos secundarios como aprovisionar un equipo personal en el registro, utiliza los hooks del ciclo de vida de autenticación (`afterUserCreate`, `beforeUserCreate`, `afterUserDelete`, …), los cuales reciben el registro de usuario completamente poblado.

OAuth ejecuta los mismos hooks que los demás inicios de sesión: `beforeLogin` (con la dirección del proveedor y `"oauth"`), `beforeUserCreate` cuando el inicio de sesión crea la cuenta, `afterUserCreate` y `onAuthenticated`. `onAuthenticated` también se activa al refrescar un token (`"refresh"`), al restablecer la contraseña (`"password-reset"`) y con un segundo factor (`"mfa"`). `beforeLogin` no se ejecuta en una actualización de token, ya que no constituye un inicio de sesión. Para suspender una cuenta que ya ha iniciado sesión, deshabilítala con `PUT /api/admin/users/:uid { disabled: true }`: esto rechazará cada inicio de sesión y actualización de token, cerrando todas las sesiones y revocando todos los tokens asociados.

`beforeEmailChange(user, newEmail)` se ejecuta cuando un usuario autenticado solicita cambiar su cuenta a otra dirección. Cualquier regla de validación de dirección aplicada en el registro mediante `beforeUserCreate` (por ejemplo, permitir solo tu propio dominio) debe aplicarse aquí también, o de lo contrario un miembro podría registrarse con una dirección permitida y luego cambiarla a cualquier otra.

Un hook que rechaza una operación (`beforeUserCreate`, `beforeLogin`, `beforeUserDelete`, `beforeEmailChange`) lanza un error. Quien llama recibe `400 HOOK_REJECTED` con el mensaje del error o con el código de estado asociado al error: un `ApiError` o cualquier error con un `status` 4xx.
:::

### Protección contra bots

El límite de peticiones (rate limiting) restringe a un solo emisor. Mil direcciones enviando una petición cada una nunca superarán una ventana basada en IP — y `/auth/register`, `/auth/forgot-password` y `/auth/magic-link` envían correos, por lo que el costo de un formulario desprotegido se cobra en la reputación del dominio de envío.

```ts
auth: {
    captcha: {
        enabled: true,
        provider: "turnstile",              // or "hcaptcha"
        secret: process.env.CAPTCHA_SECRET
    }
}
```

O desde las variables de entorno, que es lo que tiene un despliegue administrado:

```bash
CAPTCHA_PROVIDER=turnstile
CAPTCHA_SECRET=...
CAPTCHA_ROUTES=register,forgotPassword,magicLink,emailOtp   # optional; this is the default
```

El cliente envía el token del widget como `captchaToken` en el cuerpo JSON, o en la cabecera correspondiente del propio widget (`cf-turnstile-response` / `h-captcha-response`). Se aceptan ambas opciones; configura `tokenField` para usar una clave diferente en el cuerpo.

**`login` no está protegido por defecto.** Presentar un desafío (challenge) en cada inicio de sesión penaliza a todos los usuarios reales, y el relleno de credenciales (credential stuffing) es precisamente lo que previenen el limitador de tasa y el bloqueo de cuentas. Añádelo a `routes` si lo deseas.

`POST /auth/anonymous/link`, donde un invitado adquiere un correo electrónico y una contraseña, cuenta como registro: requiere el desafío de `register` y ejecuta `beforeUserCreate`, igual que `/auth/register`. El inicio de sesión de invitado en sí (`POST /auth/anonymous`) no requiere ningún desafío.

#### Falla en modo cerrado (fail-closed)

Si no se puede contactar al proveedor, la verificación falla y la solicitud es rechazada. Un atacante capaz de provocar dicha interrupción podría, de lo contrario, desactivar la protección, lo cual es justo lo que un desafío nunca debe permitir.

La contrapartida es que una interrupción del proveedor bloquea los registros. Esto es evidente, visible y se revierte eliminando una sola clave de configuración — un fallo preferible a uno silencioso del que solo te percatas cuando tu dominio de correo entra en una lista negra.

#### Una configuración errónea impide el arranque

`enabled: true` sin un proveedor, con un proveedor desconocido o sin clave secreta impedirá que el sistema inicie. Un desafío ausente de forma silenciosa mientras la configuración indica que está presente es el único fallo inadmisible aquí.

A quien realiza la petición solo se le informa que el desafío falló — nunca si el token no fue proporcionado, era inválido, ya se había utilizado o no se pudo verificar. El motivo exacto queda en los registros, ya que darle pistas a un script automatizado le ayuda a sortear la seguridad.

### Correo electrónico en desarrollo

Sin `SMTP_HOST`, los correos de autenticación no tienen adónde ir. En lugar de rechazar la solicitud, un servidor en desarrollo captura el mensaje e imprime sus enlaces:

```
⚠️  No SMTP is configured, so auth email is being captured here instead of sent.
ℹ️  [email] Sign in to Acme → you@example.com
             http://localhost:5173/auth/magic-link?token=…
```

Al abrir el enlace, el flujo se completa en la página que atienda dicha ruta: el CMS sirve `/reset-password`, `/verify-email`, `/confirm-email-change` y el enlace mágico en `/auth/magic-link`; un frontend diferente requerirá una página propia para cada uno (consulta [Magic Links](/docs/sdk/authentication/#magic-links) en el SDK). Nada en el token cambia — se genera, almacena y valida exactamente igual que si viniera de una bandeja de entrada real; solo la entrega es diferente.

Esto permanece activo siempre que se cumplan las tres condiciones siguientes, y no hay ningún ajuste que modifique esto:

- `SMTP_HOST` no está configurado — un servidor de correo configurado siempre tiene prioridad;
- `NODE_ENV` no es `production`. Un correo de restablecimiento de contraseña capturado contiene un token funcional, por lo que el búfer de captura actúa como un almacén de credenciales y no debe existir en producción;
- `FRONTEND_URL` es una URL absoluta `http(s)`, ya que de lo contrario el enlace enviado por correo no tendría base y quedaría inservible.

Si alguna de estas condiciones no se cumple, `POST /auth/magic-link` y `POST /auth/forgot-password` responderán con `503 EMAIL_NOT_CONFIGURED` como de costumbre. En producción, define `SMTP_HOST` (o `auth.email.sendEmail`) para enviar correos reales.

#### Leer el correo capturado sin una terminal

El registro solo es útil si alguien lo está observando. Un servidor en Docker, una ventana secundaria o una línea que se perdió en el scroll pueden hacer que el enlace impreso sea inalcanzable — por ello, la misma captura se expone mediante HTTP:

```
GET    /api/admin/dev/emails      → { enabled: true, messages: [ … ] }
DELETE /api/admin/dev/emails      → empties the mailbox
```

Cada mensaje incluye `to`, `subject`, `at`, las partes en `html` y `text`, y `links` — las URLs absolutas encontradas en el cuerpo, en el orden del documento, que es lo que realmente suele necesitarse.

Requiere el alcance `users:write`, a través del mismo mecanismo de control que utilizan cron, los registros y las copias de seguridad, y responde `501 DEV_MAILBOX_UNAVAILABLE` cuando no hay nada que entregar — si SMTP está configurado, el correo se envió en lugar de retenerse. `NODE_ENV=production` lo rechaza sin importar ninguna otra variable: lo que contienen estos mensajes es un inicio de sesión completamente funcional.

### Códigos de un solo uso por correo electrónico

Un enlace mágico inicia la sesión en el dispositivo donde se consulta el buzón. Ese suele ser el dispositivo adecuado en una laptop, pero el equivocado en cualquier otro lugar — un televisor, una terminal, un navegador secundario o un quiosco. Un código supera esa limitación, ya que la propia persona lo traslada de un sitio a otro.

```ts
auth: {
    emailOtp: true,   // or AUTH_EMAIL_OTP=true
    email: { /* … */ }
}
```

```ts
await rebase.auth.sendEmailOtp("someone@example.com");
// …the person reads six digits out of their inbox…
const { user } = await rebase.auth.verifyEmailOtp("someone@example.com", "384102");
```

La dirección se envía de nuevo junto con el código, y esto no es por mera conveniencia. Lo que se almacena es un hash de la dirección *junto con* el código combinados, de modo que cualquier intento de adivinarlo es un intento contra una sola cuenta específica — no contra todas las cuentas de la tabla a la vez, que es lo que sucedería si se buscara solo por código entre un millón de posibilidades.

El resto de medidas que hacen que seis dígitos sean suficientes:

- **Diez minutos** y un solo uso.
- **Cinco intentos de verificación por dirección por ventana temporal**, indexados por la dirección en lugar de la IP de quien hace la petición: el atacante puede rotar la IP a voluntad, pero la cuenta bajo ataque no cambia. Los contadores residen donde esté el almacén de rate-limiting del despliegue — por réplica por defecto, o compartido si se usa `REBASE_RATE_LIMIT_STORE=sql`.
- **Dígitos uniformes**, generados con `randomInt` en lugar de un módulo de bytes aleatorios.
- `POST /auth/otp` responde de forma idéntica si la dirección no tiene una cuenta asociada, por lo que no puede utilizarse para averiguar si alguien es usuario o cliente.

Leer un código de la bandeja de entrada valida la dirección, por lo que un inicio de sesión exitoso la marca como verificada — exactamente igual que si se usara un enlace mágico. En una cuenta que aún no estaba verificada, esa primera validación también elimina lo que nadie había demostrado previamente: la contraseña y cualquier identidad vinculada cuyo proveedor no haya verificado la dirección. Consulta [Vinculación de cuentas entre métodos de inicio de sesión](#vinculación-de-cuentas-entre-métodos-de-inicio-de-sesión).

### Personalización de la marca en los correos por defecto

Las plantillas integradas de restablecimiento de contraseña, verificación, invitación, bienvenida, enlaces mágicos y cambio de correo muestran un logotipo sobre la tarjeta. Este se define en `email.logoUrl`:

```ts
email: {
    // …
    appName: "Acme",
    logoUrl: "https://acme.example/logo.png"   // 48×48, absolute https URL
}
```

Debe ser un **PNG o JPG en una URL `http(s)` absoluta**. Los clientes de correo no renderizan SVG y bloquean URIs con prefijo `data:`, y la imagen es descargada por el cliente del destinatario en lugar de tu servidor — de modo que una ruta relativa, un data URI o un archivo local no mostrará ningún logo en lugar de una imagen rota. `appName` se utiliza como texto `alt`, por lo que un cliente con imágenes desactivadas mostrará el nombre.

El comportamiento por defecto es deliberadamente asimétrico. Si no se indica, `appName` pasa a ser `Rebase`, pero el logotipo solo utiliza el símbolo de Rebase mientras la instalación **no** haya sido renombrada. Si estableces `appName` con otro nombre, no aparecerá ningún logotipo hasta que especifiques `logoUrl` — de lo contrario, los usuarios de Acme recibirían el imagotipo de Rebase en correos firmados por el dominio de Acme.

Si reemplazas una plantilla mediante `email.templates`, nada de esto aplica: tu función tiene el control absoluto del cuerpo. `templates.emailChange(confirmUrl, user, newEmail)` es el enlace enviado a la nueva dirección cuando un usuario la modifica, y `templates.emailChangeNotice(user, newEmail)` es la notificación que se envía a la anterior; `user.email` representa la dirección actual en ambos casos.

### Proveedores OAuth

Cada proveedor OAuth se configura, como mínimo, con un `clientId`. Algunos proveedores requieren además un `clientSecret`:

```typescript
auth: {
    google:    { clientId: "..." },
    linkedin:  { clientId: "...", clientSecret: "..." },
    github:    { clientId: "...", clientSecret: "..." },
    microsoft: { clientId: "...", clientSecret: "...", tenantId: "..." },
    apple:     { clientId: "...", bundleIds: ["..."], teamId: "...", keyId: "...", privateKey: "..." },
    facebook:  { clientId: "...", clientSecret: "..." },
    twitter:   { clientId: "...", clientSecret: "..." },
    discord:   { clientId: "...", clientSecret: "..." },
    gitlab:    { clientId: "...", clientSecret: "..." },
    bitbucket: { clientId: "...", clientSecret: "..." },
    slack:     { clientId: "...", clientSecret: "..." },
    spotify:   { clientId: "...", clientSecret: "..." },
}
```

`gitlab` también acepta una `baseUrl` opcional, pensada para instancias de GitLab autoalojadas.

#### Nombres en variables de entorno

Un despliegue administrado o en bundle no dispone de un bloque `auth` para editar — configura el servidor en su totalidad mediante variables de entorno —, por lo que cada uno de los proveedores anteriores dispone de un par `<PROVIDER>_CLIENT_ID` / `<PROVIDER>_CLIENT_SECRET`, y ambas partes deben definirse para que el proveedor quede configurado:

```bash
DISCORD_CLIENT_ID=…
DISCORD_CLIENT_SECRET=…
```

`GET /api/auth/config` incluirá entonces `discord` en `enabledProviders`, que es la forma de verificar que el par fue reconocido.

Google se configura únicamente con `GOOGLE_CLIENT_ID`: su flujo basado en tokens de ID no requiere clave secreta, por lo que `GOOGLE_CLIENT_SECRET` es opcional.

Apple no utiliza un secreto de cliente: Rebase firma un JWT con algoritmo ES256 en cada intercambio. Requiere `APPLE_TEAM_ID`, `APPLE_KEY_ID` y `APPLE_PRIVATE_KEY` (el contenido del archivo `.p8`, saltos de línea incluidos), además de `APPLE_CLIENT_ID` (el Services ID, para la web), `APPLE_BUNDLE_IDS` (los identificadores separados por comas de tus apps nativas de iOS y macOS), o ambos. El Services ID es público, por lo que `/auth/config` lo expone para el botón **Iniciar sesión con Apple** del panel de administración.

Dos opciones carecen de equivalente en variables de entorno y requieren el bloque `auth` (es decir, un backend con eject o configurado por código): `microsoft.tenantId`, que por defecto asume el valor `common` y acepta cualquier tenant de Entra (con cualquier tenant, una dirección se considera verificada únicamente si el registro de la aplicación emite el claim `xms_edov`), y `gitlab.baseUrl`, para instancias autoalojadas.

Cada campo nombrado se resuelve durante el inicio en `auth.providers`, que constituye el array canónico y el punto de extensión para cualquier caso que los campos con nombre no cubran. Las entradas se construyen con las funciones factoría `create*Provider`, y ambos formatos se combinan — los campos con nombre se añaden después de las entradas explícitas:

```typescript no-verify
import { createGoogleProvider, createGitHubProvider } from "@rebasepro/server";

auth: {
    providers: [
        createGoogleProvider({ clientId: "…", clientSecret: "…" }),
        createGitHubProvider({ clientId: "…", clientSecret: "…" })
    ]
}
```

#### Restringir las URIs de redirección

```typescript no-verify
auth: { allowedRedirectUris: ["https://admin.example.com/"] }
```

Si no se define, la única verificación en una redirección OAuth es la validación de URIs registradas del propio proveedor — lo que autoriza **cualquier** URI configurada en ese cliente OAuth, incluida la entrada `localhost` que alguien añadió para desarrollo y el host de staging que nadie eliminó. Listar los orígenes que este backend realmente atiende restringe el acceso solo a ellos. Las URIs se comparan por origen y ruta; los parámetros de consulta (query), el fragmento y la barra diagonal final se ignoran.

### Vinculación de cuentas entre métodos de inicio de sesión

¿Qué sucede cuando alguien se registra con correo/contraseña como `ada@example.com` y más adelante hace clic en «Iniciar sesión con Google» con una cuenta de Google que tiene esa misma dirección? Rebase **vincula ambas en una sola cuenta**, pero solo cuando el proveedor certifica que el correo electrónico está verificado. Nunca crea silenciosamente una segunda cuenta para la misma dirección.

En `POST /api/auth/<provider>`, el orden de resolución es:

1. **Identidad de proveedor conocida**: si esta identidad exacta del proveedor ya ha iniciado sesión antes, se devuelve dicho usuario. No se consulta el correo.
2. **Cuenta existente con el mismo correo, proveedor verificó el correo**: la identidad se asocia y el usuario inicia sesión en ella. Una sola cuenta, dos vías de acceso. Si la cuenta no estaba verificada, se verifica primero (ver abajo).
3. **Cuenta existente con el mismo correo, proveedor no lo verificó**: se rechaza con `403 EMAIL_NOT_VERIFIED` y `details.reason` `provider-email-unverified`. No se crea ni modifica nada.
4. **No existe cuenta con ese correo**: se crea una nueva cuenta, verificada si el proveedor verificó el correo.

El paso 3 es el caso crítico a nivel de seguridad. Si un correo de proveedor sin verificar bastara para vincular cuentas, cualquiera que lograra que un proveedor emitiera una dirección que no le pertenece podría apoderarse de la cuenta de Rebase coincidente. Google siempre confirma `email_verified` para cuentas de Google reales, por lo que el paso 2 es la vía habitual para el inicio de sesión con Google; el paso 3 intercepta principalmente a proveedores que permiten a los usuarios registrar direcciones arbitrarias sin confirmar.

El estado previo de la cuenta también importa. Nada valida de inmediato la dirección proporcionada a `POST /auth/register`, por lo que cualquiera podría registrar la dirección de otra persona con una contraseña, o identificarse con ella mediante un proveedor que no la valide, y esperar. Vincular el inicio de sesión de Google del dueño legítimo a esa cuenta no debe dejar abierta la vía de acceso que el atacante creó.

Un proveedor que haya verificado la dirección, un enlace de verificación, un enlace mágico, un código por correo o un restablecimiento de contraseña validan la dirección y confirman la cuenta. En una cuenta que aún no estaba verificada, la primera demostración de este tipo elimina la contraseña (un restablecimiento asigna la nueva) y cualquier identidad vinculada cuyo proveedor no haya verificado esa dirección, finalizando todas las sesiones antes de marcar la cuenta como verificada: una contraseña que nadie verificó desaparece tras el primer inicio de sesión con Google.

Un enlace de verificación conserva aquello que la persona que lo sigue también demuestra: una sesión activa de la cuenta o su contraseña. Consulta [Email verification](/docs/backend/email-verification/). Las cuentas creadas por un administrador mediante `POST /api/admin/users` se guardan como verificadas, de modo que un invitado puede usar «Iniciar sesión con Google» de inmediato. Un repositorio de autenticación personalizado sin `unlinkUserIdentity` rechazará dicha validación con `409 UNVERIFIED_IDENTITIES` si hay alguna identidad que deba ser eliminada.

Este comportamiento no es configurable — deliberadamente no existe opción para vincular cuentas basándose en correos electrónicos no verificados.

### Verificación de correo electrónico

El proceso de registro envía un enlace de verificación a la nueva cuenta, y acceder a él conserva únicamente lo que la persona que lo abre demuestre. `requireEmailVerification` exige la confirmación antes de completar el acceso. Consulta [Email verification](/docs/backend/email-verification/).

## Tablas creadas automáticamente

En el primer arranque, Rebase aprovisiona automáticamente el esquema `rebase` y las siguientes tablas en la base de datos (vinculadas al esquema definido en tu colección, por ejemplo, `rebase`):

- **`rebase.users`** — Cuentas de usuario con correo electrónico, hash de contraseña, metadatos y una columna `roles` de tipo text[] (los roles se almacenan como arrays de texto en línea para optimizar las consultas y evitar joins).
- **`rebase.user_identities`** — Las identidades de OAuth vinculadas a cada cuenta, una fila por identidad de proveedor.
- **`rebase.refresh_tokens`** — Sesiones de larga duración que contienen tokens de actualización hasheados, user agents y direcciones IP. Incluye un índice único en `token_hash`. Cada inicio de sesión constituye un `session_id`, compartido por todos los tokens rotados a partir de él; no hay restricciones por dispositivo, por lo que dos navegadores detrás de la misma dirección IP representan dos sesiones. Cada token de una sesión almacena también su nivel de seguridad (`aal`) y el método de inicio de sesión (`method`, que reporta `providerId`).
- **`rebase.password_reset_tokens`** — Tokens de un solo uso con fecha de expiración para flujos de recuperación de contraseña.
- **`rebase.magic_link_tokens`** — Tokens de un solo uso con fecha de expiración para inicios de sesión con enlaces mágicos.
- **`rebase.mfa_factors`** — Métodos de autenticación multifactor registrados (por ejemplo, secretos TOTP cifrados con AES-256).
- **`rebase.mfa_challenges`** — Registros de verificación que rastrean los intentos activos de validación de MFA.
- **`rebase.recovery_codes`** — Códigos de recuperación/respaldo multifactor hasheados.
- **`rebase.app_config`** — Almacén clave-valor para configuraciones del sistema.

Los tokens que expiran — enlaces de restablecimiento, enlaces mágicos y códigos de correo, tokens de actualización, desafíos MFA — se eliminan una vez por hora tras haber expirado. La limpieza se ejecuta en los procesos que gestionan los temporizadores (todos los roles excepto `functions` en un despliegue dividido, a menos que `REBASE_CRON_SCHEDULER=false` los retire de la `api`) y en una única instancia de la flota: cada hora se reclama en `rebase.cron_claims` bajo el ID de trabajo `rebase:auth:expired-tokens`, como si fuera una franja de cron. Con `cronPersistence: false` no existe la tabla de reclamaciones y cada una de esas instancias ejecuta la limpieza. Un token expirado se rechaza al presentarse, se haya ejecutado o no la limpieza; el barrido simplemente evita el crecimiento indefinido de las tablas.

## Inicialización del primer usuario (Bootstrap)

Cuando no existen usuarios en la base de datos y el servidor **no** se está ejecutando con `NODE_ENV=production`, la primera persona que se registre se convierte automáticamente en administrador. A partir de entonces, el registro pasa a ser controlado por el ajuste `allowRegistration`.

En producción, esa ventana de oportunidad está cerrada, ya que un host con dominio público es accesible antes de que su operador haya podido registrarse, y quien llegara primero tomaría el control. En su lugar, un despliegue en producción define a su primer administrador mediante variables de entorno — `REBASE_ADMIN_EMAIL` y `REBASE_ADMIN_PASSWORD`, creados en el arranque mientras la tabla aún está vacía — o asigna el rol mediante la clave de servicio. Con la ventana cerrada, una tabla vacía rechazará el registro de bootstrap con `SETUP_REQUIRED` (y así lo indicará), una primera cuenta creada mediante registro abierto será una cuenta normal, `GET /api/auth/config` nunca reportará `needsSetup`, `POST /api/admin/bootstrap` será rechazado y el registro de arranque advertirá si la tabla está vacía y no se ha definido ningún administrador.

En una computadora de desarrollo, esto significa que siempre puedes inicializar una base de datos limpia sin tener que poblarla manualmente. Para evitar ejecuciones concurrentes y condiciones de carrera en la generación del esquema durante el hot reloading (HMR) o el inicio, las operaciones de bootstrapping se sincronizan mediante un bloqueo de asesoría (advisory lock) de Postgres:
```sql
SELECT pg_advisory_xact_lock(hashtext('rebase_auth_functions_init'));
```

## Configuración de autenticación a nivel de colección

En lugar de depender exclusivamente de las reglas de autenticación por defecto de la base de datos, puedes marcar cualquier colección de Postgres (como `users.ts` o una colección personalizada `members.ts`) como la colección de autenticación. Esto se configura a través de la propiedad `auth` en la propia definición de la colección:

```typescript
import { randomBytes } from "node:crypto";
import { defineCollection } from "@rebasepro/cms-types";

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
      const tempPassword = randomBytes(12).toString("base64url");
      return {
        temporaryPassword: tempPassword, // saved as the new password, then shown to the admin
        invitationSent: false
      };
    },

    // Inject/override auth-specific actions (e.g. show/hide the reset password button)
    actions: {
      resetPassword: true // Or false to disable, or a custom EntityAction
    },

    // What each role may do beyond its rows, the app's own scopes,
    // and whether accounts may create personal API keys
    roles: {
      support: { name: "Support", scopes: ["users:read", "users:write", "logs:read"] }
    },
    scopes: {
      "project:deploy": { label: "Deploy projects", target: "project" }
    },
    personalKeys: true
  },
  properties: { ... }
});
```

`roles`, `scopes` y `personalKeys` definen el modelo de acceso: qué ámbitos (scopes) del plano de administración posee cada rol, los ámbitos que la aplicación define para sus propias operaciones y si cada cuenta puede emitir [claves API personales](/docs/backend/api-keys/#personal-keys). Consulta [Roles and scopes](/docs/backend/roles-and-scopes/).

El valor `temporaryPassword` devuelto por `onResetPassword` se convierte en la contraseña de la cuenta. Rebase le aplica hash con el algoritmo configurado, la almacena, cierra todas las sesiones activas del usuario y se la muestra al administrador para que se la entregue. El hook no la almacena, ni tiene forma de hacerlo. No devuelvas ningún `temporaryPassword` si el hook envía su propio enlace de restablecimiento por correo: en ese caso, la contraseña permanece intacta hasta que el usuario establezca una nueva, aunque sus sesiones seguirán cerrándose.

Cuando se invocan hooks personalizados (`onCreateUser`, `onResetPassword`), reciben una fachada `AuthCollectionContext` que contiene:
- `hashPassword(password: string): Promise<string>` — Genera el hash de la contraseña usando el algoritmo de hash configurado (por ejemplo, scrypt).
- `sendEmail?: (options) => Promise<EmailSendResult>` — Envía un correo electrónico (disponible solo cuando el servicio de correo está configurado). Se resuelve con lo que el proveedor reportó — `messageId`, `accepted`, `rejected` —, de modo que un hook pueda guardar el id y más adelante asociar una respuesta al mismo.
- `emailConfigured: boolean` — Indica si el servicio de correo está configurado.
- `appName: string` — El nombre de la aplicación configurado en el correo.
- `resetPasswordUrl: string` — La URL base del enlace para restablecer la contraseña.

## Siguientes pasos

- **[Endpoints and tokens](/docs/backend/auth-endpoints/)** — cada ruta que monta esta configuración
- **[Roles and scopes](/docs/backend/roles-and-scopes/)** — qué puede hacer cada rol y cómo las claves y tokens lo restringen
- **[Custom auth adapters](/docs/backend/auth-adapters/)** — integrar tu propio proveedor de identidad
- **[Frontend Authentication](/docs/frontend/authentication/)** — interfaz de inicio de sesión, controlador de autenticación y gestión de usuarios
- **[Security Rules (RLS)](/docs/collections/security-rules/)** — control de acceso a nivel de fila
- **[Typed SDK Authentication](/docs/sdk/authentication/)** — métodos de autenticación en el SDK tipado
