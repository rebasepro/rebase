---
sourceHash: 71a134ba2ec7ae97
title: Autenticación
sidebar_label: Autenticación
description: Configura la autenticación JWT, proveedores de OAuth, correo SMTP, protección contra bots y la tabla de usuarios en el backend de Rebase.
---

La autenticación abarca tres páginas, porque son tres tareas distintas. Esta se centra en la **configuración**: lo que va en el bloque `auth` y en el entorno.

- [Endpoints y tokens](/docs/backend/auth-endpoints/) — las rutas que monta el backend, las estructuras de respuesta, MFA, el contexto de base de datos que ve una directiva (policy), JWKS y claves de servicio.
- [Adaptadores de autenticación personalizados](/docs/backend/auth-adapters/) — reemplazar el proveedor integrado por Clerk, Firebase Auth o el tuyo propio.

## Descripción general

Rebase incluye un sistema completo de autenticación de backend:

- **Tokens JWT** — Flujo de tokens de acceso y actualización con expiración configurable
- **Proveedores de OAuth** — Google, LinkedIn, GitHub, Microsoft, Apple y más
- **Correo electrónico SMTP** — Flujos de restablecimiento de contraseña y verificación de correo
- **Hooks de autenticación** — Hooks del ciclo de vida para la creación de usuarios y más
- **Adaptadores de autenticación personalizados** — Conecta Firebase Auth, Auth0, Clerk o cualquier proveedor externo
- **Clave de servicio** — Clave estática para autenticación de servidor a servidor
- **Auto-bootstrapping** — Fuera de producción, el primer usuario obtiene automáticamente el rol de administrador; un despliegue en producción define a su administrador con `REBASE_ADMIN_EMAIL` / `REBASE_ADMIN_PASSWORD`

## Configuración

<span class="since-badge" data-since="0.31">Desde 0.31</span>

:::note[Dónde va esto]
**Entorno de ejecución administrado:** entorno — `JWT_SECRET`, `AUTH_*`, `SMTP_*`, `CAPTCHA_*` y los pares `*_CLIENT_ID` / `*_CLIENT_SECRET` de proveedores, uno para cada uno de los doce proveedores ([las nomenclaturas](#las-nomenclaturas-de-entorno); el de Apple consta de cuatro claves, no de un par). La tabla de usuarios es el [`defineAuthTable`](#la-tabla-de-usuarios) exportado desde `backend/schema/index.ts`.
**Sin ruta administrada:** `auth.hooks`. Son funciones; expulsa (eject) para pasarlas.
**Expulsado (Ejected):** `initializeRebaseBackend({ auth })` en `backend/src/index.ts`.
:::

El bloque `auth` en `initializeRebaseBackend` controla toda la autenticación del backend:

```typescript no-verify
const backend = await initializeRebaseBackend({
    // ...
    auth: {
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

### El bloque `auth`, en detalle

| Clave | Tipo | Por defecto | Qué hace |
|-----|------|---------|--------------|
| `jwtSecret` | `string` | — | Secreto de firma HS256. Requerido en producción |
| `signingKeys` | `JwtSigningKeyConfig[]` | — | Claves de firma asimétricas — consulta [Tokens asimétricos y JWKS](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) |
| `activeKid` | `string` | primer clave | Cuál de las `signingKeys` emite nuevos tokens |
| `accessExpiresIn` | `string` | `1h` | Tiempo de vida del token de acceso |
| `refreshExpiresIn` | `string` | `30d` | Tiempo de vida del token de actualización. Deslizante: cada rotación lo renueva, por lo que este es el tiempo que sobrevive una sesión ante la **inactividad**. El entorno de ejecución pasa `JWT_REFRESH_EXPIRES_IN`, cuyo valor por defecto también es `30d`. Los navegadores limitan la cookie de actualización a 400 días, por lo que un valor mayor no aporta nada en el modo de cookie |
| `refreshTokenReuseIntervalSeconds` | `number` | `10` | Cuánto tiempo un token de actualización que ya fue rotado aún puede emitir un hermano de su sesión, de modo que un cliente que perdió una respuesta de actualización no cierre sesión |
| `refreshTokenReuse` | `"reject" \| "revoke-session"` | `"reject"` | Lo que hace un token de actualización presentado después de esa ventana de tiempo. `"reject"` lo rechaza (`TOKEN_ALREADY_USED`) y lo registra, manteniendo la sesión: esto no es detección de reutilización, ya que quien actualizó primero conserva la sesión. `"revoke-session"` finaliza todo el inicio de sesión ante dicha repetición (`SESSION_REVOKED`), como hace GoTrue, y el propietario vuelve a iniciar sesión. `AUTH_REFRESH_TOKEN_REUSE` |
| `requireAuth` | `boolean` | `true` | Requiere una sesión para la API de datos |
| `allowRegistration` | `boolean` | `false` | Abre `POST /api/auth/register`. Fuera de producción, el primer usuario en una tabla vacía es admitido en cualquier caso; en producción, el administrador se especifica con `REBASE_ADMIN_EMAIL` |
| `disableSelfRegistration` | `boolean` | `false` | Interruptor de apagado de emergencia (kill switch): también cierra la ventana de bootstrap del primer usuario que `allowRegistration: false` deja abierta |
| `allowAnonymous` | `boolean` | `false` | Habilita `POST /api/auth/anonymous`. Deliberadamente no está restringido por `allowRegistration`: una aplicación pública principalmente de lectura puede requerir sesiones sin cuentas. Convertir a un invitado en una cuenta (`POST /api/auth/anonymous/link`) es un registro y también requiere `allowRegistration` — y que `allowAnonymous` siga activado: si se desactiva, también rechaza a los invitados que ya han iniciado sesión, de modo que ninguno pueda convertirse en una cuenta (`403 ANONYMOUS_AUTH_DISABLED`) |
| `allowUserLookup` | `boolean` | `false` | Monta `POST /api/auth/find-user` para flujos de invitación por correo electrónico |
| `captcha` | `CaptchaConfig` | — | Protección contra bots en las rutas que envían correos — consulta [Protección contra bots](#protección-contra-bots) |
| `defaultRole` | `string` | — | Rol otorgado a un usuario recién registrado cuando no se especifica ninguno. No puede ser `admin` ni un rol declarado que posea un ámbito (scope) del plano de administración: el inicio del sistema rechazará ambos casos |
| `serviceKey` | `string` | — | Clave estática para llamadas de servidor a servidor — consulta [Autenticación mediante clave de servicio](/docs/backend/auth-endpoints/#service-key-authentication) |
| `email` | `EmailConfig` | — | SMTP, para restablecimiento de contraseña, verificación, invitaciones y magic links |
| `magicLink` | `boolean` | `false` | Habilita el inicio de sesión por correo sin contraseña. Requiere configurar `email`; sin él, las rutas responden `503 EMAIL_NOT_CONFIGURED` |
| `emailOtp` | `boolean` | `false` | Habilita códigos de inicio de sesión de seis dígitos por correo electrónico — consulta [Códigos de un solo uso](#códigos-de-un-solo-uso-por-correo-electrónico). Mismo requisito de correo electrónico |
| `deviceLogin` | `{ verificationUrl: string }` | — | Permite que una terminal u otro dispositivo sin navegador inicie sesión a través de uno — consulta [Inicio de sesión en dispositivos](/docs/backend/device-sign-in/). Requiere una base de datos SQL |
| `magicLinkCreatesUsers` | `boolean` | `false` | Registro sin contraseña: una solicitud de magic-link o código por correo para una dirección sin cuenta crea una (sin contraseña, sin verificar hasta que se use el enlace o código), mientras `allowRegistration` esté activo. Ejecuta `beforeUserCreate` y asigna el rol predeterminado. Desactivado, esas solicitudes no crean nada y responden a una dirección desconocida de la misma manera que a una conocida. `AUTH_MAGIC_LINK_CREATES_USERS` |
| `requireEmailVerification` | `boolean` | `false` | Rechaza el inicio de sesión con contraseña hasta que la dirección sea verificada, y registra con confirmación previa — consulta [Verificación de correo electrónico](/docs/backend/email-verification/). Requiere `email`; el inicio del sistema lo rechazará si falta |
| `cookieAuth` | `CookieAuthConfig \| false` | on | Entrega el token de actualización como una cookie `httpOnly`, `Secure` y `SameSite` en lugar de en el cuerpo JSON; `false` lo devuelve en el cuerpo — consulta más abajo |
| `providers` | `OAuthProvider[]` | `[]` | El array canónico de OAuth; los campos de proveedores nombrados se resuelven en él |
| `allowedRedirectUris` | `string[]` | — | Restringe qué URIs de redirección aceptan las rutas de OAuth |
| `hooks` | `AuthHooks` | — | `beforeUserCreate`, `afterUserCreate`, `afterUserDelete`, … |

#### Tokens de actualización en una cookie `httpOnly`

```typescript no-verify
auth: { cookieAuth: { sameSite: "Lax" } }
```

El token de actualización es la credencial de larga duración, y en el cuerpo de la respuesta cualquier XSS en la página podría leerlo. `cookieAuth` lo mantiene en una cookie que los scripts de la página no pueden tocar: está activo a menos que se configure lo contrario, siempre en el entorno de ejecución y desde la versión 0.30 en `initializeRebaseBackend`. El token de **acceso** permanece en el cuerpo, para la cabecera `Authorization`. Una solicitud con `x-rebase-auth-flow: json` recibe el token de actualización en el cuerpo; con `cookieAuth: false` todas las solicitudes lo hacen, y un cliente de navegador necesita `authFlowMode: "json"`.

Deben cumplirse dos requisitos o, de lo contrario, el inicio de sesión fallará por completo en lugar de degradarse: las peticiones fetch del cliente a los endpoints de autenticación necesitan `credentials: "include"`, y CORS debe permitir credenciales — lo que significa una lista explícita de orígenes, nunca `origin: "*"`. `AUTH_COOKIE_SAME_SITE` es la nomenclatura de entorno para `sameSite`, y `AUTH_COOKIE_SECURE` para `secure`.

La cookie incluye `Secure` a menos que se desactive, y nada de la solicitud puede cambiarlo: si se leyera del protocolo de la solicitud, que es `http` detrás de cualquier proxy de terminación TLS, enviaría el token en texto plano. `AUTH_COOKIE_SECURE=false` es la única salida para un despliegue servido sobre HTTP sin cifrar (una dirección LAN, un appliance), y emitirá una advertencia al arrancar. `http://localhost` no lo necesita.

| Clave | Por defecto | |
|-----|---------|--|
| `cookieName` | `__rb_refresh` | |
| `domain` | dominio actual | |
| `path` | `/` | |
| `sameSite` | `Lax` | `None` es solo para un frontend genuinamente cross-site |
| `secure` | `true` | Seguro por defecto; `AUTH_COOKIE_SECURE=false` para HTTP sin cifrar |

:::caution[Los hooks de tabla no se ejecutan para usuarios de autenticación]
La creación y actualización de usuarios a través del sistema de autenticación (registro, gestión de usuarios por el administrador y OAuth) escriben **directamente** en el almacén de usuarios y omiten el flujo de guardado de la tabla. Un hook `beforeSave`/`afterSave`/`beforeDelete`/`afterDelete` en la tabla de usuarios **no** se ejecutará para estas rutas. Para efectos secundarios como aprovisionar un equipo personal en el registro, utiliza los hooks del ciclo de vida de autenticación (`afterUserCreate`, `beforeUserCreate`, `afterUserDelete`, …), que reciben el registro de usuario completamente poblado.

OAuth ejecuta los mismos hooks que los demás inicios de sesión: `beforeLogin` (con la dirección del proveedor y `"oauth"`), `beforeUserCreate` cuando el inicio de sesión crea la cuenta, `afterUserCreate` y `onAuthenticated`. `onAuthenticated` también se activa en una actualización de token (`"refresh"`), un restablecimiento de contraseña (`"password-reset"`) y un segundo factor (`"mfa"`). `beforeLogin` no se ejecuta en una actualización de token, ya que no es un inicio de sesión. Para detener una cuenta que ya ha iniciado sesión, deshabilítala con `PUT /api/admin/users/:uid { disabled: true }`: eso rechazará cada inicio de sesión y actualización de token, y finalizará cada sesión y token que posea.

`beforeEmailChange(user, newEmail)` se ejecuta cuando un usuario autenticado solicita cambiar su cuenta a otra dirección. Cualquier regla de validación de dirección que apliques en el registro dentro de `beforeUserCreate` (por ejemplo, permitir solo tu propio dominio) también debe incluirse aquí; de lo contrario, un miembro podría registrarse con una dirección permitida y luego cambiarla a cualquier otra.

Un hook que rechaza una acción (`beforeUserCreate`, `beforeLogin`, `beforeUserDelete`, `beforeEmailChange`) lanza un error (throws). Quien llama recibe `400 HOOK_REJECTED` con el mensaje del error, o el estado que transporte el error: un `ApiError` o cualquier error con un `status` 4xx.
:::

### Protección contra bots

El límite de tasa (rate limiting) acota a un solo emisor. Mil direcciones enviando una solicitud cada una nunca superarán una ventana por IP — y `/auth/register`, `/auth/forgot-password` y `/auth/magic-link` envían correos, por lo que el coste de un formulario desprotegido se paga con la reputación de tu dominio de envío.

```ts
auth: {
    captcha: {
        enabled: true,
        provider: "turnstile",              // or "hcaptcha"
        secret: process.env.CAPTCHA_SECRET
    }
}
```

O desde el entorno, que es lo que tiene un despliegue administrado:

```bash
CAPTCHA_PROVIDER=turnstile
CAPTCHA_SECRET=...
CAPTCHA_ROUTES=register,forgotPassword,magicLink,emailOtp   # optional; this is the default
```

El cliente envía el token del widget como `captchaToken` en el cuerpo JSON, o en la cabecera propia del widget `cf-turnstile-response` / `h-captcha-response`. Se aceptan ambos; configura `tokenField` para usar una clave de cuerpo diferente.

**`login` no está protegido por defecto.** Un desafío (challenge) en cada inicio de sesión penaliza a todos los usuarios reales, y el credential stuffing es para lo que están pensados el limitador de tasa y el bloqueo de cuenta. Agrégalo a `routes` si lo deseas.

`POST /auth/anonymous/link`, donde un invitado obtiene un correo electrónico y una contraseña, cuenta como registro: requiere el desafío de `register` y ejecuta `beforeUserCreate`, al igual que `/auth/register`. El inicio de sesión de invitados en sí (`POST /auth/anonymous`) no requiere ningún desafío.

#### Falla en modo cerrado

Si no se puede contactar con el proveedor, la verificación falla y la solicitud es rechazada. De lo contrario, un atacante capaz de provocar esa interrupción podría desactivar la protección, que es precisamente lo que un desafío nunca debe permitir.

El inconveniente es que una interrupción del proveedor bloquea los registros. Esto es evidente, visible y se soluciona eliminando una clave de configuración — un fallo mucho mejor que uno silencioso del que te percatas cuando el dominio de correo entra en una lista de bloqueo.

#### Un error de configuración impide el arranque

`enabled: true` sin proveedor, con un proveedor desconocido o sin clave secreta hará que el sistema se niegue a arrancar. Un desafío silenciosamente ausente cuando la configuración indica que está presente es el único fallo inadmisible aquí.

A quien realiza la llamada solo se le informa de que el desafío falló — nunca si el token estaba ausente, malformado, ya utilizado o era inverificable. La causa exacta va a los registros (logs), porque informar a un script es darle pistas sobre cómo burlar la seguridad.

### Correo electrónico en desarrollo

Sin `SMTP_HOST`, los correos de autenticación no tienen adónde ir. En lugar de rechazar la solicitud, un servidor de desarrollo captura el mensaje e imprime sus enlaces:

```
⚠️  No SMTP is configured, so auth email is being captured here instead of sent.
ℹ️  [email] Sign in to Acme → you@example.com
             http://localhost:5173/auth/magic-link?token=…
```

Sigue el enlace y el flujo se completará en la página que sirva esa ruta: el CMS sirve `/reset-password`, `/verify-email`, `/confirm-email-change` y el `/auth/magic-link` de un enlace mágico; otro frontend necesitará una página propia para cada uno (consulta [Magic Links](/docs/sdk/authentication/#magic-links) en el SDK). Nada en el token cambia: se emite, se almacena y se valida exactamente como lo haría desde una bandeja de entrada real; solo cambia el método de entrega.

Esto está activo siempre que se cumplan las tres condiciones, y ninguna configuración lo altera:

- `SMTP_HOST` no está configurado — un servidor de correo configurado siempre tiene prioridad;
- `NODE_ENV` no es `production`. Un correo capturado de restablecimiento de contraseña contiene un token de restablecimiento válido, por lo que el búfer de captura actúa como un almacén de credenciales y no debe existir en producción;
- `FRONTEND_URL` es una URL absoluta `http(s)`, ya que de lo contrario el enlace enviado por correo no tendría base y no funcionaría al recibirlo.

Si no se cumple alguna de ellas, `POST /auth/magic-link` y `POST /auth/forgot-password` responderán `503 EMAIL_NOT_CONFIGURED` como antes. En producción, define `SMTP_HOST` (o `auth.email.sendEmail`) para enviar correos reales.

#### Leer los correos capturados sin una terminal

El registro solo es útil para quien lo esté mirando. Un servidor en Docker, una segunda ventana o una línea que se pasó de largo al hacer scroll dejan un enlace impreso que ya no se puede encontrar — por eso, esa misma captura se sirve a través de HTTP:

```
GET    /api/admin/dev/emails      → { enabled: true, messages: [ … ] }
DELETE /api/admin/dev/emails      → empties the mailbox
```

Cada mensaje contiene `to`, `subject`, `at`, las partes `html` y `text`, y `links` — las URLs absolutas encontradas en el cuerpo, en el orden del documento, que es lo que realmente interesa.

Requiere el ámbito (scope) `users:write`, a través del mismo control de acceso que utilizan cron, los registros y las copias de seguridad, y responde `501 DEV_MAILBOX_UNAVAILABLE` cuando no hay nada que servir — con SMTP configurado, el correo se entregó en lugar de retenerse. `NODE_ENV=production` lo rechaza sin importar ninguna otra condición: lo que contienen estos mensajes es un inicio de sesión funcional.

### Códigos de un solo uso por correo electrónico

Un enlace mágico (magic link) abre la sesión en cualquier dispositivo que contenga el buzón de correo. Ese es el dispositivo correcto en un ordenador portátil, pero el equivocado en cualquier otro lugar: un televisor, una terminal, un segundo navegador, un quiosco. Un código supera esa limitación, porque la persona lo transporta de un sitio a otro.

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

La dirección se envía de nuevo junto con el código, y esto no es por comodidad. Lo que se almacena es un hash de la dirección *y* el código juntos, por lo que un intento de adivinanza es un intento contra una sola cuenta con nombre — no contra todas las cuentas de la tabla a la vez, que es lo que provocaría una búsqueda basada únicamente en el código entre un millón de posibilidades.

El resto de factores que hacen que seis dígitos sean suficientes:

- **Diez minutos** y un solo uso.
- **Cinco intentos de verificación por dirección por ventana de tiempo**, indexados por la dirección en lugar de la IP de origen: una IP puede ser rotada por el atacante, pero la cuenta bajo ataque no. Los contadores residen donde esté el almacén de límite de tasa del despliegue — por réplica por defecto, compartido con `REBASE_RATE_LIMIT_STORE=sql`.
- **Dígitos uniformes**, generados con `randomInt` en lugar de una operación de módulo sobre bytes aleatorios.
- `POST /auth/otp` responde de manera idéntica para una dirección que no tiene cuenta, por lo que no puede utilizarse para averiguar si alguien es cliente.

Leer un código del buzón demuestra la posesión de la dirección, por lo que un inicio de sesión exitoso la marca como verificada — exactamente igual que seguir un magic link. En una cuenta que aún no estaba verificada, esa primera comprobación también elimina lo que nadie verificó: la contraseña y cada identidad vinculada cuyo proveedor no haya verificado la dirección. Consulta [Vinculación de cuentas entre métodos de inicio de sesión](#vinculación-de-cuentas-entre-métodos-de-inicio-de-sesión).

### Personalización de marca en los correos por defecto

Las plantillas integradas para restablecimiento de contraseña, verificación, invitación, bienvenida, magic links y cambio de correo muestran un logotipo encima de la tarjeta. Proviene de `email.logoUrl`:

```ts
email: {
    // …
    appName: "Acme",
    logoUrl: "https://acme.example/logo.png"   // 48×48, absolute https URL
}
```

Debe ser un archivo **PNG o JPG en una URL absoluta `http(s)`**. Los clientes de correo no renderizan SVG y bloquean los URIs `data:`, y la imagen es descargada por el cliente del destinatario en lugar de tu servidor — por lo tanto, una ruta relativa, un URI data o un archivo local no mostrarán ningún logotipo en lugar de una imagen rota. `appName` se utiliza como texto alternativo (`alt`), por lo que un cliente con las imágenes desactivadas seguirá mostrando el nombre.

El valor de reserva (fallback) es deliberadamente asimétrico. `appName` recurre por defecto a `Rebase`, pero el logotipo solo recurre a la marca de Rebase mientras la instalación **no** haya cambiado su nombre. Si configuras `appName` con cualquier otro valor, no se mostrará ningún logotipo hasta que definas `logoUrl` — de lo contrario, los usuarios de Acme recibirían el logotipo de Rebase en correos firmados por el dominio de Acme.

Si reemplazas una plantilla mediante `email.templates`, nada de esto aplica: tu función controla la totalidad del cuerpo. `templates.emailChange(confirmUrl, user, newEmail)` es el enlace enviado por correo a la nueva dirección cuando un usuario la modifica, y `templates.emailChangeNotice(user, newEmail)` es el aviso enviado a la anterior; `user.email` es la dirección actual en ambos casos.

### Proveedores de OAuth

Cada proveedor de OAuth se configura como mínimo con un `clientId`. Algunos proveedores requieren un `clientSecret`:

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

`gitlab` también admite un `baseUrl` opcional para una instancia de GitLab autohospedada.

#### Las nomenclaturas de entorno

Un despliegue administrado o en paquete (bundle) no tiene un bloque `auth` en el que escribir —configura el servidor completamente a través de variables de entorno—, por lo que cada proveedor anterior tiene un par `<PROVEEDOR>_CLIENT_ID` / `<PROVEEDOR>_CLIENT_SECRET`, y ambas partes deben definirse para que el proveedor quede configurado:

```bash
DISCORD_CLIENT_ID=…
DISCORD_CLIENT_SECRET=…
```

Luego, `GET /api/auth/config` incluirá a `discord` en `enabledProviders`, que es la forma de comprobar que el par de claves llegó correctamente.

Google se configura únicamente con `GOOGLE_CLIENT_ID`: su flujo de token de ID no necesita un secreto, por lo que `GOOGLE_CLIENT_SECRET` es opcional.

Apple no tiene secreto de cliente: Rebase firma un JWT ES256 por cada intercambio. Requiere `APPLE_TEAM_ID`, `APPLE_KEY_ID` y `APPLE_PRIVATE_KEY` (el contenido del archivo `.p8`, con saltos de línea incluidos), además de `APPLE_CLIENT_ID` (el Services ID, para la web), `APPLE_BUNDLE_IDS` (IDs separados por comas de tus aplicaciones nativas de iOS y macOS), o ambos. El Services ID es público, por lo que `/auth/config` lo publica para la opción **Sign in with Apple** del panel de administración.

Dos opciones no tienen nomenclatura de variables de entorno y requieren el bloque `auth` (es decir, un backend expulsado o configurado mediante código): `microsoft.tenantId`, que de lo contrario usa por defecto `common` y acepta cualquier tenant de Entra (con cualquier tenant, una dirección se considera verificada solo cuando el registro de la aplicación emite el claim `xms_edov`), y `gitlab.baseUrl`, para una instancia autohospedada.

Cada campo nombrado se resuelve al inicio en `auth.providers`, que es el array canónico y el punto de extensión para cualquier cosa que los campos nombrados no cubran. Las entradas se construyen con las funciones factoría `create*Provider`, y ambas formas se fusionan: los campos nombrados se añaden después de las entradas explícitas:

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

Si no se define, la única comprobación en una redirección de OAuth es la coincidencia de URI registrada del propio proveedor —lo cual autoriza **todas** las URIs registradas en ese cliente OAuth, incluyendo la entrada de `localhost` que alguien añadió para desarrollo y el host de staging que nadie eliminó. Indicar los orígenes a los que realmente da servicio este backend lo restringe a estos. Las URIs se comparan según origen más ruta; los parámetros de consulta (query), fragmentos y la barra diagonal final se ignoran.

### Vinculación de cuentas entre métodos de inicio de sesión

¿Qué ocurre cuando alguien se registra con correo/contraseña como `ada@example.com` y más tarde hace clic en "Sign in with Google" en una cuenta de Google con esa misma dirección? Rebase **las vincula en una sola cuenta**, pero solo cuando el proveedor certifica que el correo está verificado. Nunca crea silenciosamente una segunda cuenta para la misma dirección.

En `POST /api/auth/<provider>`, el orden de resolución es:

1. **Identidad de proveedor conocida**: si esta identidad exacta de proveedor ha iniciado sesión antes, se devuelve dicho usuario. No se consulta el correo.
2. **Cuenta existente con el mismo correo, el proveedor verificó el correo**: la identidad se asocia y el usuario inicia sesión en ella. Una sola cuenta, dos vías de acceso. Una cuenta no verificada se verifica primero (ver más abajo).
3. **Cuenta existente con el mismo correo, el proveedor no lo verificó**: se rechaza con `403 EMAIL_NOT_VERIFIED` y `details.reason` `provider-email-unverified`. No se crea ni se modifica nada.
4. **No existe cuenta con ese correo**: se crea una nueva cuenta, verificada si el proveedor verificó el correo.

El paso 3 es el caso crítico de seguridad. Si un correo no verificado del proveedor fuera suficiente para vincular, cualquiera que pudiera hacer que un proveedor emitiera una dirección que no le pertenece podría apoderarse de la cuenta de Rebase coincidente. Google siempre afirma `email_verified` para cuentas reales de Google, por lo que el paso 2 es la ruta habitual para el inicio de sesión con Google; el paso 3 intercepta principalmente proveedores que permiten a los usuarios proporcionar una dirección arbitraria sin confirmar.

La perspectiva de la cuenta también importa. Nada verifica la dirección proporcionada a `POST /auth/register`, por lo que cualquiera puede registrar la dirección de otra persona con una contraseña, o iniciar sesión con ella a través de un proveedor que no la avale, y esperar. Vincular el inicio de sesión de Google del verdadero dueño a esa cuenta no debe dejar accesible la vía de entrada de la otra persona.

Un proveedor que haya verificado la dirección, un enlace de verificación, un enlace mágico, un código de correo o un restablecimiento de contraseña demuestran la posesión de la dirección y verifican la cuenta. En una cuenta que aún no estaba verificada, la primera prueba de este tipo elimina la contraseña (un restablecimiento establece la nueva) y cada identidad vinculada cuyo proveedor no haya verificado esa dirección, y finaliza cada sesión, antes de marcar la cuenta como verificada: una contraseña que nadie verificó desaparece tras el primer inicio de sesión con Google.

Un enlace de verificación conserva lo que la persona que lo sigue también demuestra: una sesión activa de la cuenta o su contraseña. Consulta [Verificación de correo electrónico](/docs/backend/email-verification/). Las cuentas creadas por un administrador con `POST /api/admin/users` se guardan como verificadas, de modo que un invitado puede usar "Sign in with Google" directamente. Un repositorio de autenticación personalizado sin `unlinkUserIdentity` rechazará dicha prueba con `409 UNVERIFIED_IDENTITIES` cuando haya una identidad que deba eliminarse.

Este comportamiento no es configurable: deliberadamente no existe opción para vincular correos no verificados.

### Verificación de correo electrónico

El registro envía un enlace de verificación a la nueva cuenta, y seguirlo mantiene solo lo que la persona que lo sigue también demuestra. `requireEmailVerification` hace que el registro requiera confirmación previa. Consulta [Verificación de correo electrónico](/docs/backend/email-verification/).

## Tablas creadas automáticamente

En el primer arranque, Rebase aprovisiona automáticamente el esquema `rebase` y las siguientes tablas en la base de datos:

- **`rebase.users`** — Cuentas de usuario con correo electrónico, hash de contraseña, metadatos y una columna `roles` de tipo text[] (los roles se almacenan como arrays de texto en línea para optimizar consultas y evitar joins).
- **`rebase.user_identities`** — Las identidades de OAuth vinculadas a cada cuenta, una fila por identidad de proveedor.
- **`rebase.refresh_tokens`** — Sesiones de larga duración que contienen tokens de actualización hasheados, user agents y direcciones IP. Incluye un índice único en `token_hash`. Un inicio de sesión es un `session_id`, compartido por cada token rotado a partir de él; no hay restricción por dispositivo, por lo que dos navegadores detrás de una misma dirección son dos sesiones. Cada token de una sesión también contiene su nivel de aseguramiento (`aal`) y cómo se inició sesión (`method`, que reporta `providerId`).
- **`rebase.password_reset_tokens`** — Tokens de un solo uso con caducidad para los flujos de recuperación de contraseña.
- **`rebase.magic_link_tokens`** — Tokens de un solo uso con caducidad para inicio de sesión mediante magic link.
- **`rebase.mfa_factors`** — Métodos de autenticación multifactor registrados (por ejemplo, secretos TOTP cifrados con AES-256).
- **`rebase.mfa_challenges`** — Registros de verificación que rastrean los intentos activos de verificación MFA.
- **`rebase.recovery_codes`** — Códigos de recuperación/respaldo multifactor hasheados.
- **`rebase.app_config`** — Almacén clave-valor para configuraciones del sistema.

Los tokens que caducan —enlaces de restablecimiento, enlaces mágicos y códigos de correo, tokens de actualización, desafíos MFA— se eliminan una vez por hora tras expirar. La purga se ejecuta en los procesos que gestionan los temporizadores (todos los roles excepto `functions` en un despliegue dividido, a menos que `REBASE_CRON_SCHEDULER=false` los retire de la `api`) y en una instancia de la flota: cada hora se reclama en `rebase.cron_claims` bajo el ID de trabajo `rebase:auth:expired-tokens`, como si fuera una franja de cron. Con `cronPersistence: false` no existe la tabla de reclamaciones, y cada una de esas instancias realiza la purga. Un token caducado se rechaza al presentarse, independientemente de si la purga se ha ejecutado o no; la purga solo evita que las tablas crezcan indefinidamente.

## Bootstrap del primer usuario

Cuando no existen usuarios en la base de datos y el servidor **no** se está ejecutando con `NODE_ENV=production`, la primera persona que se registre se convierte automáticamente en administrador. A partir de entonces, el registro pasa a estar controlado por la opción `allowRegistration`.

En producción esa ventana está cerrada, porque un host con un nombre público es accesible antes de que su operador se haya registrado, y quien llegara primero tomaría el control. En su lugar, un despliegue en producción define a su primer administrador en las variables de entorno —`REBASE_ADMIN_EMAIL` y `REBASE_ADMIN_PASSWORD`, creados durante el arranque mientras la tabla aún está vacía— o asigna el rol mediante la clave de servicio. Con la ventana cerrada, una tabla vacía rechaza el registro de bootstrap con `SETUP_REQUIRED` (e indica el motivo), una primera cuenta creada mediante el registro abierto es una cuenta ordinaria, `GET /api/auth/config` nunca reporta `needsSetup`, `POST /api/admin/bootstrap` rechaza la solicitud, y el registro de arranque emite una advertencia si la tabla está vacía y no se ha especificado ningún administrador.

En un portátil, esto significa que siempre puedes inicializar una base de datos nueva sin tener que poblarla manualmente. Para evitar ejecuciones concurrentes y condiciones de carrera en la generación del esquema durante la recarga en caliente (HMR) o el arranque, las operaciones de bootstrapping se sincronizan mediante un bloqueo de asesoramiento (advisory lock) de Postgres:
```sql
SELECT pg_advisory_xact_lock(hashtext('rebase_auth_functions_init'));
```

## La tabla de usuarios

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Los usuarios se almacenan en la tabla declarada con `defineAuthTable` en `backend/schema`. Es una tabla ordinaria a la que se le añaden las columnas que requiere la autenticación, una directiva (policy) que permite a cada usuario leer su propia fila y una restricción exclusiva para administradores en la columna `roles`. Su bloque `auth` declara los roles, los ámbitos (scopes) de la aplicación, las claves de API personales y los hooks que se ejecutan cuando un administrador crea un usuario o restablece una contraseña:

```ts
import { defineAuthTable, col } from "@rebasepro/server/schema";

export const users = defineAuthTable("users", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().unique(),
    },
    rls: "admin-only",
    auth: {
        roles: { support: { name: "Support", scopes: ["users:read", "users:write", "logs:read"] } },
        personalKeys: true,
    },
});
```

[La tabla de usuarios](/docs/schema/auth-table/) detalla las columnas, las directivas inyectadas, `onCreateUser` y `onResetPassword`; [Roles y scopes](/docs/backend/roles-and-scopes/) detalla lo que concede cada rol y ámbito.

## Siguientes pasos

- **[Endpoints y tokens](/docs/backend/auth-endpoints/)** — cada ruta que monta esta configuración
- **[Roles y scopes](/docs/backend/roles-and-scopes/)** — qué puede hacer cada rol y cómo las claves y tokens lo restringen
- **[Adaptadores de autenticación personalizados](/docs/backend/auth-adapters/)** — incorporar tu propio proveedor de identidades
- **[Autenticación en Frontend](/docs/frontend/authentication/)** — interfaz de inicio de sesión, controlador de autenticación, gestión de usuarios
- **[Seguridad a nivel de fila (RLS)](/docs/collections/security-rules/)** — control de acceso a nivel de fila
- **[Autenticación en SDK tipado](/docs/sdk/authentication/)** — métodos de autenticación en el SDK tipado
