---
sourceHash: 099cfa22ee1f8493
title: Autenticación
sidebar_label: Autenticación
description: Configura la autenticación JWT, proveedores OAuth, correo SMTP, protección contra bots y la colección de usuarios en el backend de Rebase.
---

La autenticación abarca tres páginas porque implica tres tareas. Esta trata sobre la **configuración**: lo que se incluye en el bloque `auth` y en el entorno.

- [Endpoints y tokens](/docs/backend/auth-endpoints/) — las rutas que monta el backend, las estructuras de respuesta, MFA, el contexto de base de datos que ve una política, JWKS y claves de servicio.
- [Adaptadores de autenticación personalizados](/docs/backend/auth-adapters/) — sustitución del proveedor integrado por Clerk, Firebase Auth o uno propio.

## Descripción general

Rebase incluye un sistema completo de autenticación en el backend:

- **Tokens JWT** — Flujo de tokens de acceso y actualización con expiración configurable
- **Proveedores OAuth** — Google, LinkedIn, GitHub, Microsoft, Apple y más
- **Correo SMTP** — Flujos de restablecimiento de contraseña y verificación de correo electrónico
- **Hooks de autenticación** — Hooks del ciclo de vida para la creación de usuarios y más
- **Adaptadores de autenticación personalizados** — Conecte Firebase Auth, Auth0, Clerk o cualquier proveedor externo
- **Clave de servicio** — Clave estática para autenticación servidor a servidor
- **Auto-bootstrapping** — Fuera de producción, el primer usuario obtiene automáticamente el rol de administrador; un despliegue en producción define a su administrador mediante `REBASE_ADMIN_EMAIL` / `REBASE_ADMIN_PASSWORD`

## Configuración

:::note[Dónde va esto]
**Runtime gestionado:** entorno — `JWT_SECRET`, `AUTH_*`, `SMTP_*`, `CAPTCHA_*` y los pares `*_CLIENT_ID` / `*_CLIENT_SECRET` del proveedor, uno para cada uno de los doce proveedores ([la nomenclatura](#la-nomenclatura-en-variables-de-entorno); el de Apple son cuatro claves, no un par). La colección de usuarios es aquella que el bundle designe (`collections/users` por convención).
**Sin ruta gestionada:** `auth.hooks`. Son funciones; haga eject para pasarlas.
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
| `collection` | `CollectionConfig` | — | La colección de usuarios. Consulte [Configuración de autenticación a nivel de colección](#configuración-de-autenticación-a-nivel-de-colección) |
| `jwtSecret` | `string` | — | Secreto de firma HS256. Requerido en producción |
| `signingKeys` | `JwtSigningKeyConfig[]` | — | Claves de firma asimétricas — consulte [Tokens asimétricos y JWKS](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) |
| `activeKid` | `string` | primera clave | Cuál de las `signingKeys` genera nuevos tokens |
| `accessExpiresIn` | `string` | `1h` | Tiempo de vida del token de acceso |
| `refreshExpiresIn` | `string` | `30d` | Tiempo de vida del token de actualización. Deslizante: cada rotación lo renueva. El runtime pasa `JWT_REFRESH_EXPIRES_IN`, cuyo valor predeterminado es `400d` |
| `requireAuth` | `boolean` | `true` | Requiere una sesión para la API de datos |
| `allowRegistration` | `boolean` | `false` | Habilita `POST /api/auth/register`. Fuera de producción, el primer usuario en una tabla vacía se admite de cualquier manera; en producción, el administrador se define con `REBASE_ADMIN_EMAIL` |
| `disableSelfRegistration` | `boolean` | `false` | Mecanismo de corte: también cierra la ventana de inicialización del primer usuario que `allowRegistration: false` deja abierta |
| `allowAnonymous` | `boolean` | `false` | Habilita `POST /api/auth/anonymous`. Deliberadamente no condicionado por `allowRegistration` — una aplicación pública principalmente de lectura puede requerir sesiones sin cuentas |
| `allowUserLookup` | `boolean` | `false` | Monta `POST /api/auth/find-user` para flujos de invitación por correo electrónico |
| `defaultRole` | `string` | — | Rol asignado a un usuario recién registrado cuando no se especifica ninguno |
| `serviceKey` | `string` | — | Clave estática para llamadas servidor a servidor — consulte [Autenticación mediante clave de servicio](/docs/backend/auth-endpoints/#service-key-authentication) |
| `email` | `EmailConfig` | — | SMTP, para restablecimiento de contraseña, verificación, invitaciones y enlaces mágicos |
| `magicLink` | `boolean` | `false` | Habilita el inicio de sesión por correo electrónico sin contraseña. Requiere que `email` esté configurado; sin ello, las rutas responden `503 EMAIL_NOT_CONFIGURED` |
| `emailOtp` | `boolean` | `false` | Habilita códigos de inicio de sesión de seis dígitos por correo electrónico — consulte [Códigos de un solo uso por correo electrónico](#códigos-de-un-solo-uso-por-correo-electrónico). Mismo requisito de correo |
| `cookieAuth` | `CookieAuthConfig` | — | Entrega el token de actualización como una cookie `httpOnly` `Secure` `SameSite` en lugar de en el cuerpo JSON — ver más abajo |
| `providers` | `OAuthProvider[]` | `[]` | El array canónico de OAuth; los campos de proveedores nombrados se resuelven en él |
| `allowedRedirectUris` | `string[]` | — | Restringe qué URIs de redirección aceptan las rutas OAuth |
| `hooks` | `AuthHooks` | — | `beforeUserCreate`, `afterUserCreate`, `afterUserDelete`, … |

#### Tokens de actualización en una cookie `httpOnly`

```typescript no-verify
auth: { cookieAuth: { sameSite: "Lax" } }
```

El token de actualización es la credencial de larga duración, y en el modo predeterminado con cuerpo JSON cualquier ataque XSS en la página puede leerlo. `cookieAuth` lo traslada a una cookie que el propio JavaScript de la página no puede tocar. El token de **acceso** permanece en el cuerpo JSON, ya que el cliente debe incluirlo en un encabezado `Authorization`.

Deben cumplirse dos condiciones, o de lo contrario el inicio de sesión fallará en lugar de degradarse de forma controlada: las solicitudes del cliente a los endpoints de autenticación necesitan `credentials: "include"`, y CORS debe permitir credenciales — lo que implica una lista de orígenes explícita, nunca `origin: "*"`. `AUTH_COOKIE_SAME_SITE` es el nombre de variable de entorno para `sameSite`, y `AUTH_COOKIE_SECURE` para `secure`.

La cookie lleva la directiva `Secure` a menos que la desactive, y nada relativo a la solicitud puede alterarlo: este flag solía leerse del protocolo de la solicitud, que es `http` detrás de cualquier proxy de terminación TLS, haciendo que el token de actualización viajara en texto plano en la topología de producción más común. `AUTH_COOKIE_SECURE=false` es la única alternativa para un despliegue servido genuinamente sobre HTTP plano — una dirección LAN, un appliance — y emite una advertencia en el arranque. `http://localhost` no lo necesita: los navegadores lo tratan como un origen confiable y aceptan cookies `Secure` en él.

| Clave | Por defecto | |
|-----|---------|--|
| `cookieName` | `__rb_refresh` | |
| `domain` | dominio actual | |
| `path` | `/` | |
| `sameSite` | `Lax` | `None` es solo para un frontend genuinamente cross-site |
| `secure` | `true` | Seguro por defecto; `AUTH_COOKIE_SECURE=false` para HTTP plano |

:::caution[Los callbacks de colección no se ejecutan para usuarios de autenticación]
La creación y actualización de usuarios mediante el sistema de autenticación — registro, administración de usuarios y OAuth — escribe **directamente** en el almacén de usuarios y omite la canalización de guardado de colecciones. Los callbacks `beforeSave`/`afterSave`/`beforeDelete`/`afterDelete` en la colección de autenticación (usuarios) **no** se ejecutarán en estas rutas. Para efectos secundarios como aprovisionar un equipo personal durante el registro, utilice los hooks del ciclo de vida de autenticación (`afterUserCreate`, `beforeUserCreate`, `afterUserDelete`, …), los cuales reciben el registro de usuario completamente poblado.

OAuth ejecuta menos hooks que el registro normal. El inicio de sesión con un proveedor dispara `afterUserCreate` cuando crea la cuenta, y ningún otro hook del ciclo de vida: `beforeUserCreate`, `beforeLogin` y `onAuthenticated` no se ejecutan en la ruta de OAuth, por lo que cualquier validación o registro de auditoría asociado a ellos nunca verá a un usuario de OAuth.
:::

### Protección contra bots

La limitación de tasa (rate limiting) acota a un único emisor. Mil direcciones enviando una solicitud cada una nunca alcanzan la ventana por IP — y `/auth/register`, `/auth/forgot-password` y `/auth/magic-link` envían correos, por lo que el costo de un formulario desprotegido se paga con la reputación de su dominio de envío.

```ts
auth: {
    captcha: {
        enabled: true,
        provider: "turnstile",              // or "hcaptcha"
        secret: process.env.CAPTCHA_SECRET
    }
}
```

O desde el entorno, que es lo que tiene un despliegue gestionado:

```bash
CAPTCHA_PROVIDER=turnstile
CAPTCHA_SECRET=...
CAPTCHA_ROUTES=register,forgotPassword,magicLink,emailOtp   # optional; this is the default
```

El cliente envía el token del widget como `captchaToken` en el cuerpo JSON, o en el encabezado propio del widget `cf-turnstile-response` / `h-captcha-response`. Se aceptan ambos; configure `tokenField` para usar una clave de cuerpo diferente.

**`login` no está protegido por defecto.** Un desafío (challenge) en cada inicio de sesión penaliza a todos los usuarios reales, y el credential stuffing es precisamente para lo que sirven el limitador de tasa y el bloqueo de cuentas. Añádalo a `routes` si lo desea.

#### Falla en modo cerrado (fail-closed)

Si no se puede contactar al proveedor, la verificación falla y la solicitud es rechazada. De lo contrario, un atacante capaz de provocar dicha interrupción podría desactivar la protección, que es exactamente lo que un desafío no debe permitir.

La contrapartida es que una caída del proveedor bloquea los registros. Esto es evidente, visible y se revierte eliminando una sola clave de configuración — un fallo preferible a uno silencioso que solo se descubre cuando el dominio de correo entra en listas negras.

#### Una mala configuración impide el arranque

`enabled: true` sin proveedor, con un proveedor desconocido o sin secreto impedirá el inicio. Un desafío ausente de forma silenciosa mientras la configuración indica que está activo es el único fallo que no se puede tolerar.

Al emisor de la solicitud solo se le comunica que el desafío falló — nunca si el token estuvo ausente, mal formado, ya utilizado o fue inverificable. El motivo exacto se envía al registro (log), ya que darle pistas a un script le indica cómo sortear la barrera.

### Correo electrónico en desarrollo

Sin `SMTP_HOST`, los correos de autenticación no tienen adónde ir. En lugar de rechazar la solicitud, un servidor de desarrollo captura el mensaje e imprime sus enlaces:

```
⚠️  No SMTP is configured, so auth email is being captured here instead of sent.
ℹ️  [email] Sign in to Acme → you@example.com
             http://localhost:5173/auth/magic-link?token=…
```

Siga el enlace y el flujo se completará. Nada cambia con respecto al token: se genera, almacena y valida exactamente igual que si viniera de una bandeja de entrada real; solo la entrega es diferente.

Esto se activa siempre que se cumplan estas tres condiciones, y no hay ningún parámetro que las altere:

- `SMTP_HOST` no está configurado — un servidor de correo configurado siempre tiene prioridad;
- `NODE_ENV` no es `production`. Un correo de restablecimiento de contraseña capturado contiene un token de restablecimiento funcional, por lo que el búfer de captura actúa como un almacén de credenciales y no debe existir en producción;
- `FRONTEND_URL` es una URL `http(s)` absoluta, ya que de lo contrario el enlace enviado por correo no tendría base y quedaría inservible.

Si alguna de ellas no se cumple, `POST /auth/magic-link` y `POST /auth/forgot-password` responderán con `503 EMAIL_NOT_CONFIGURED` como de costumbre. En producción, configure `SMTP_HOST` (o `auth.email.sendEmail`) para enviar correos de manera real.

#### Leer el correo capturado sin una terminal

El registro solo es útil para quien lo esté observando. Un servidor en Docker, una segunda ventana o una línea que se pasó por alto al hacer scroll pueden hacer que el enlace impreso sea difícil de encontrar — por ello, la misma captura se sirve a través de HTTP:

```
GET    /api/admin/dev/emails      → { enabled: true, messages: [ … ] }
DELETE /api/admin/dev/emails      → empties the mailbox
```

Cada mensaje contiene `to`, `subject`, `at`, las partes `html` y `text`, y `links` — las URLs absolutas encontradas en el cuerpo, en el orden del documento, que es la información que realmente se necesita.

Es de acceso exclusivo para administradores, protegido por la misma compuerta que utilizan cron, los registros y las copias de seguridad, y responde con `501 DEV_MAILBOX_UNAVAILABLE` cuando no hay nada que servir — al estar configurado SMTP, los correos se entregan en lugar de retenerse. `NODE_ENV=production` lo rechaza sin importar cualquier otra condición: lo que estos mensajes contienen es un acceso válido.

### Códigos de un solo uso por correo electrónico

Un enlace mágico abre la sesión en el dispositivo que tenga abierta la bandeja de entrada. Ese suele ser el dispositivo adecuado en una laptop, pero el equivocado en cualquier otro caso: un televisor, una terminal, un segundo navegador, un quiosco. Un código salva esa distancia, ya que la persona lo traslada manualmente.

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

La dirección se envía de nuevo junto con el código, y esto no es solo por conveniencia. Lo que se almacena es un hash de la dirección *y* el código juntos, por lo que un intento de adivinanza es un intento contra una cuenta específica — no contra todas las cuentas de la tabla a la vez, que es lo que propiciaría una búsqueda basada únicamente en el código entre un millón de posibilidades.

El resto de factores que hacen que seis dígitos sean suficientes:

- **Diez minutos** y un solo uso.
- **Cinco intentos de verificación por dirección por ventana**, indexados por la dirección en lugar de la IP del emisor: una IP puede ser rotada por el atacante, mientras que la cuenta bajo ataque no. Los conteos residen donde resida el almacén de límite de tasa del despliegue — por réplica por defecto, compartido con `REBASE_RATE_LIMIT_STORE=sql`.
- **Dígitos uniformes**, generados con `randomInt` en lugar de un módulo de bytes aleatorios.
- `POST /auth/otp` responde de manera idéntica para una dirección sin cuenta, por lo que no puede utilizarse para averiguar si alguien es cliente.

Leer un código de la bandeja de entrada demuestra la titularidad de la dirección, por lo que un inicio de sesión exitoso la marca como verificada — exactamente igual que al seguir un enlace mágico.

### Personalización de marca en los correos predeterminados

Las plantillas integradas de restablecimiento de contraseña, verificación, invitación, bienvenida y enlace mágico muestran un logotipo encima de la tarjeta. Este proviene de `email.logoUrl`:

```ts
email: {
    // …
    appName: "Acme",
    logoUrl: "https://acme.example/logo.png"   // 48×48, absolute https URL
}
```

Debe ser un **PNG o JPG en una URL `http(s)` absoluta**. Los clientes de correo no renderizan SVG y bloquean los URIs `data:`, y la imagen es descargada por el cliente del destinatario en lugar de por su servidor — por lo tanto, una ruta relativa, un URI de datos o un archivo local no mostrarán ningún logotipo en lugar de una imagen rota. `appName` se utiliza como texto `alt`, de modo que un cliente con imágenes desactivadas siga mostrando el nombre.

El valor por defecto es deliberadamente asimétrico. `appName` recurre por defecto a `Rebase`, pero el logotipo solo recurre al isotipo de Rebase mientras la instalación **no** haya cambiado de nombre. Si define `appName` con cualquier otro valor, no obtendrá ningún logotipo hasta que configure `logoUrl` — de lo contrario, los usuarios de Acme recibirían la marca de Rebase en correos firmados por el dominio de Acme.

Si reemplaza una plantilla mediante `email.templates`, nada de esto aplica: su función toma el control de la totalidad del cuerpo.

### Proveedores OAuth

Cada proveedor OAuth se configura como mínimo con un `clientId`. Algunos proveedores requieren un `clientSecret`:

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

`gitlab` también admite un `baseUrl` opcional para una instancia autoalojada de GitLab.

#### La nomenclatura en variables de entorno

Un despliegue gestionado o en bundle no dispone de un bloque `auth` en el cual escribir — configura el servidor en su totalidad a través del entorno —, por lo que cada proveedor mencionado anteriormente dispone de un par `<PROVIDER>_CLIENT_ID` / `<PROVIDER>_CLIENT_SECRET`, y ambas partes deben definirse antes de que el proveedor se configure por completo:

```bash
DISCORD_CLIENT_ID=…
DISCORD_CLIENT_SECRET=…
```

`GET /api/auth/config` listará entonces `discord` en `enabledProviders`, lo cual sirve para comprobar que el par de variables se cargó correctamente.

Apple es la excepción: no tiene un client secret estático, ya que Rebase firma un JWT ES256 de corta duración para cada intercambio de tokens. Requiere los cuatro valores: `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID` y `APPLE_PRIVATE_KEY` — el contenido del archivo `.p8`, con saltos de línea incluidos.

Dos opciones no tienen equivalente en variables de entorno y requieren el bloque `auth` (es decir, un backend ejected o configurado por código): `microsoft.tenantId`, que de lo contrario utiliza por defecto `common` y reporta cada dirección como no verificada, y `gitlab.baseUrl`, para una instancia autoalojada.

Cada campo nombrado se resuelve al inicio dentro de `auth.providers`, que es el array canónico y el punto de extensión para cualquier cosa que los campos nombrados no cubran. Las entradas se construyen con las funciones factoría `create*Provider`, y ambas formas se combinan — los campos nombrados se agregan después de las entradas explícitas:

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

Si no se configura, la única comprobación sobre una redirección de OAuth es la coincidencia de URI registrada del propio proveedor — lo que autoriza **cualquier** URI registrada en ese cliente OAuth, incluida la entrada de `localhost` que alguien añadió para desarrollo y el host de staging que nadie eliminó. Listar los orígenes a los que este backend realmente da servicio lo restringe a estos. Las URIs se comparan por origen más ruta; los parámetros de consulta (query), fragmentos y la barra diagonal final se ignoran.

### Vinculación de cuentas entre métodos de inicio de sesión

¿Qué ocurre cuando alguien se registra con correo/contraseña como `ada@example.com`, y más tarde hace clic en "Iniciar sesión con Google" con una cuenta de Google que tiene esa misma dirección? Rebase **vincula ambas en una sola cuenta** — pero únicamente cuando el proveedor certifica que el correo está verificado. Nunca crea de forma silenciosa una segunda cuenta para la misma dirección.

En `POST /api/auth/<provider>`, el orden de resolución es:

1. **Identidad de proveedor conocida** — si esta identidad exacta del proveedor ha iniciado sesión antes, se devuelve ese usuario. No se consulta el correo electrónico.
2. **Cuenta existente con el mismo correo electrónico, proveedor verificado** — la identidad se asocia a la cuenta existente y se inicia sesión con el usuario en ella. Una cuenta, dos vías de acceso.
3. **Cuenta existente con el mismo correo electrónico, proveedor NO verificado** — rechazada con `403 EMAIL_NOT_VERIFIED`. No se crea ni se modifica nada.
4. **Sin cuenta con ese correo electrónico** — se crea una nueva cuenta.

El paso 3 es el caso crítico a nivel de seguridad. Si un correo electrónico de proveedor no verificado bastara para vincular cuentas, cualquiera que lograse que un proveedor emitiera una dirección que no le pertenece podría apoderarse de la cuenta de Rebase correspondiente. Google siempre declara `email_verified` para cuentas reales de Google, por lo que el paso 2 es la ruta habitual para el inicio de sesión con Google; el paso 3 detecta principalmente proveedores que permiten a los usuarios proporcionar una dirección arbitraria sin confirmar.

Este comportamiento no es configurable — deliberadamente no existe ninguna opción para vincular cuentas mediante correos no verificados.

Para recuperarse de un rechazo en el paso 3, el usuario inicia sesión con su método existente y llama al endpoint de vinculación explícito:

```http
POST /api/auth/link/google
Authorization: Bearer <access token>

{ "idToken": "..." }
```

La vinculación mientras se está autenticado intencionalmente **no** requiere un correo electrónico verificado, ni exige que los correos coincidan en absoluto — la dirección de Google de un usuario a menudo no es su dirección en la aplicación. La asimetría es deliberada: al iniciar sesión, el correo del proveedor es la única evidencia que vincula la identidad entrante con una cuenta, mientras que aquí el emisor ya ha demostrado la titularidad al contar con una sesión válida. Devuelve `409 IDENTITY_ALREADY_LINKED` si esa identidad de proveedor pertenece a otro usuario, y es idempotente si ya está vinculada al emisor.

#### La dirección inversa

Un usuario que se registró con Google y no tiene contraseña:

- **El registro con el mismo correo** se rechaza con `409 EMAIL_EXISTS`.
- **`POST /api/auth/change-password`** devuelve `400 INVALID_ACCOUNT` — no existe una contraseña previa con la cual contrastar.
- **`forgot-password` → `reset-password` es el método admitido para agregar una.** Vuelve a validar la posesión de la dirección por correo electrónico, tras lo cual la cuenta dispondrá de ambos métodos de inicio de sesión.

## Tablas creadas automáticamente

En el primer arranque, Rebase aprovisiona automáticamente el esquema `auth` y las siguientes tablas en la base de datos (vinculadas al esquema definido en su colección, p. ej., `rebase`):

- **`rebase.users`** — Cuentas de usuario con correo electrónico, hash de contraseña, metadatos y una columna text[] `roles` (los roles se almacenan como arrays de texto en línea para optimizar consultas y evitar joins).
- **`rebase.refresh_tokens`** — Sesiones de larga duración que contienen tokens de actualización hasheados, user agents y direcciones IP. Incluye un índice único en `token_hash` y una restricción única en `(user_id, user_agent, ip_address)` para rastrear sesiones de dispositivos activos.
- **`rebase.password_reset_tokens`** — Tokens de un solo uso con expiración para los flujos de recuperación de contraseña.
- **`rebase.mfa_factors`** — Métodos de autenticación multifactor registrados (p. ej., secretos TOTP cifrados con AES-256).
- **`rebase.mfa_challenges`** — Registros de verificación que rastrean los intentos activos de verificación MFA.
- **`rebase.recovery_codes`** — Códigos de respaldo/recuperación multifactor hasheados.
- **`rebase.app_config`** — Almacén clave-valor para configuraciones del sistema.

## Inicialización del primer usuario (Bootstrap)

Cuando no existen usuarios en la base de datos y el servidor **no** se está ejecutando con `NODE_ENV=production`, la primera persona que se registre se convierte automáticamente en administrador. A partir de ese momento, el registro queda regulado por el ajuste `allowRegistration`.

En producción esa ventana está cerrada, ya que un host con un nombre público es accesible antes de que su operador se haya registrado, y cualquiera que llegue primero se apropiaría de él. En su lugar, un despliegue de producción designa a su primer administrador en las variables de entorno — `REBASE_ADMIN_EMAIL` y `REBASE_ADMIN_PASSWORD`, creados en el arranque mientras la tabla aún esté vacía — o asigna el rol mediante la clave de servicio. Con la ventana cerrada, una tabla vacía rechaza el registro de inicialización con `SETUP_REQUIRED` (e informa de ello), una primera cuenta creada mediante registro abierto es una cuenta común, `GET /api/auth/config` nunca reporta `needsSetup`, `POST /api/admin/bootstrap` rechaza la solicitud y el registro de arranque emite una advertencia si la tabla está vacía y no se ha especificado ningún administrador.

En un entorno local, esto significa que siempre se puede inicializar una base de datos limpia sin tener que sembrarla manualmente. Para evitar ejecuciones simultáneas y condiciones de carrera en la generación del esquema durante el hot reloading (HMR) o el arranque, las operaciones de inicialización se sincronizan mediante un advisory lock de Postgres:
```sql
SELECT pg_advisory_xact_lock(hashtext('rebase_auth_functions_init'));
```

## Configuración de autenticación a nivel de colección

En lugar de depender exclusivamente de las reglas de autenticación predeterminadas de la base de datos, puede marcar cualquier colección de Postgres (como `users.ts` o una colección personalizada `members.ts`) como la colección de autenticación. Esto se configura a través de la propiedad `auth` en la propia colección:

```typescript
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

Cuando se llaman los hooks personalizados (`onCreateUser`, `onResetPassword`), estos reciben una fachada `AuthCollectionContext` que contiene:
- `hashPassword(password: string): Promise<string>` — Genera el hash de la contraseña utilizando el algoritmo de hashing configurado (p. ej., scrypt).
- `sendEmail?: (options) => Promise<EmailSendResult>` — Envía un correo electrónico (disponible solo cuando el servicio de correo está configurado). Resuelve con la información reportada por el proveedor — `messageId`, `accepted`, `rejected` — para que un hook pueda almacenar el ID y enlazar una respuesta posterior con este.
- `emailConfigured: boolean` — Indica si el servicio de correo electrónico está configurado.
- `appName: string` — El nombre de la aplicación proveniente de la configuración de correo.
- `resetPasswordUrl: string` — La URL base del enlace de restablecimiento de contraseña.

## Pasos siguientes

- **[Endpoints y tokens](/docs/backend/auth-endpoints/)** — cada ruta que monta esta configuración
- **[Adaptadores de autenticación personalizados](/docs/backend/auth-adapters/)** — utilización de su propio proveedor de identidad
- **[Autenticación en Frontend](/docs/frontend/authentication/)** — interfaz de inicio de sesión, controlador de autenticación, gestión de usuarios
- **[Reglas de seguridad (RLS)](/docs/collections/security-rules/)** — control de acceso a nivel de fila
- **[Autenticación en el SDK de cliente](/docs/sdk/authentication/)** — métodos de autenticación en el SDK de cliente
