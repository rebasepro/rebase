---
sourceHash: 6d4a5f8b72b38f97
title: Endpoints de autenticación y tokens
sidebar_label: Endpoints de autenticación
description: Las rutas de autenticación que monta el backend de Rebase, las estructuras de sus respuestas, autenticación multifactor, el contexto de base de datos que ve una política, JWKS y claves de servicio.
---

Las rutas que monta [el bloque `auth`](/docs/backend/authentication/) y los tokens que devuelven.

## Endpoints de autenticación

Todos los endpoints de autenticación están montados en `/api/auth/`:

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Crear una nueva cuenta |
| `POST` | `/api/auth/login` | Iniciar sesión con correo/contraseña |
| `POST` | `/api/auth/refresh` | Refrescar el token de acceso |
| `POST` | `/api/auth/<provider>` | Inicio de sesión OAuth (por ej., `/api/auth/google`, `/api/auth/linkedin`) |
| `POST` | `/api/auth/link/<provider>` | Vincular un proveedor OAuth a la cuenta autenticada. En un invitado esto cuenta como registro: requiere `allowRegistration`, toma la dirección del proveedor cuando este la avala y responde con una sesión para la cuenta en la que se convirtió el invitado |
| `POST` | `/api/auth/logout` | Revocar el token de actualización |
| `POST` | `/api/auth/forgot-password` | Enviar correo para restablecer la contraseña |
| `POST` | `/api/auth/reset-password` | Restablecer contraseña con token |
| `POST` | `/api/auth/find-user` | Resolver un correo a un perfil público mínimo (opcional — `AUTH_ALLOW_USER_LOOKUP`) |
| `POST` | `/api/auth/change-password` | Cambiar la propia contraseña del emisor (autenticado). Finaliza todas las demás sesiones y responde con una nueva para el emisor |
| `GET` | `/api/auth/me` | El propio perfil del emisor |
| `PATCH` | `/api/auth/me` | Actualizar el propio perfil del emisor |
| `POST` | `/api/auth/change-email` | `{ newEmail }`: mover la propia cuenta del emisor a otra dirección. Envía un enlace a la nueva dirección y una notificación a la antigua; nada cambia hasta que se sigue el enlace. Requiere `aal2` en una cuenta con un segundo factor. `409 EMAIL_EXISTS` o `UNDELIVERABLE_ADDRESS`, `400 EMAIL_UNCHANGED`, `403 ANONYMOUS_USER` para un invitado — ver [Cambiar una dirección de correo electrónico](#cambiar-una-dirección-de-correo-electrónico) |
| `POST` | `/api/auth/confirm-email-change` | `{ token }` del enlace. No requiere sesión. Mueve la cuenta a la nueva dirección, verificada; `400 INVALID_TOKEN` para un enlace ya usado, reemplazado o expirado, `409 EMAIL_EXISTS` si la dirección fue tomada mientras esperaba |
| `GET` | `/api/auth/config` | Lo que ofrece este backend a una pantalla de inicio de sesión: `needsSetup`, `registrationEnabled`, `passwordReset`, `emailVerification`, `magicLink`, `anonymousLogin`, `adminPasswordReset`, `enabledProviders` y `storage`, que indica si el backend sirve almacenamiento de archivos. No autenticado, y computado a partir de los mismos predicados que aplican las rutas, por lo que lo anunciado por la pantalla no puede diferir de lo que realmente puede hacer |
| `POST` | `/api/auth/send-verification` | Enviar al emisor un enlace de verificación de correo |
| `GET` | `/api/auth/verify-email` | Consumir un enlace de verificación (la URL de ese correo). Mantiene lo demostrado por una sesión activa de la cuenta y elimina lo que nadie demostró — ver [Verificación de correo](/docs/backend/email-verification/) |
| `POST` | `/api/auth/verify-email` | Lo mismo con `{ token, password?, removeUnproven? }`: la contraseña lo mantiene e inicia sesión; sin ninguna de las dos pruebas, una cuenta que posea una responde `409 PROOF_REQUIRED` |
| `POST` | `/api/auth/magic-link` | Enviar por correo un enlace de inicio de sesión de un solo uso. `503 EMAIL_NOT_CONFIGURED` sin SMTP |
| `POST` | `/api/auth/magic-link/verify` | Canjear un token de magic link por una sesión |
| `POST` | `/api/auth/otp` | Enviar por correo un código de inicio de sesión de seis dígitos. Responde igual exista o no una cuenta con esa dirección |
| `POST` | `/api/auth/otp/verify` | Canjear `{ email, code }` por una sesión |
| `POST` | `/api/auth/anonymous` | Crear una sesión anónima (opcional — `ALLOW_ANONYMOUS`) |
| `POST` | `/api/auth/anonymous/link` | Adjuntar credenciales reales a la cuenta anónima que ya ha iniciado sesión. Requiere tanto `allowAnonymous` como registro abierto: `403 ANONYMOUS_AUTH_DISABLED` una vez que el inicio de sesión anónimo está desactivado, incluidos los invitados que hayan iniciado sesión previamente, y `403 REGISTRATION_DISABLED` mientras el registro esté cerrado |
| `GET` | `/api/auth/sessions` | Listar las sesiones activas del emisor, una por inicio de sesión. La propia del emisor está marcada como `isCurrentSession` |
| `DELETE` | `/api/auth/sessions` | Revocar todas las sesiones, incluida esta: cierre de sesión remoto en todos los dispositivos |
| `DELETE` | `/api/auth/sessions/:id` | Revocar una sesión: su token de actualización y el token de acceso que contiene ese dispositivo |
| `GET` | `/api/auth/scopes` | Cada [scope](/docs/backend/roles-and-scopes/) que este backend conoce, y los que posee el emisor |
| `GET` | `/api/auth/keys` | Las propias [claves de API personales](/docs/backend/api-keys/#personal-keys) del emisor |
| `POST` | `/api/auth/keys` | Crear una clave personal. `403 PERSONAL_KEYS_DISABLED` a menos que la tabla users establezca `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | Revocar una de las propias claves del emisor |
| `GET` | `/.well-known/jwks.json` | El JWKS público: montado en la raíz, no bajo `basePath`, porque allí es donde busca un verificador. Se monta siempre que el backend genera sus propios tokens; es un conjunto de claves vacío hasta que se configure el [firmado asimétrico](#tokens-asimétricos-y-jwks) |
| `POST` | `/api/auth/mfa/enroll` | Iniciar el registro de TOTP (devuelve el secreto y los códigos de recuperación) |
| `POST` | `/api/auth/mfa/verify` | Confirmar un registro con un código de la app de autenticación |
| `GET` | `/api/auth/mfa/factors` | Listar los factores registrados del emisor |
| `POST` | `/api/auth/mfa/challenge` | Abrir un desafío contra un factor verificado |
| `POST` | `/api/auth/mfa/challenge/verify` | Responder a un desafío: esto es lo que emite la sesión |
| `DELETE` | `/api/auth/mfa/unenroll` | Eliminar un factor (requiere una sesión `aal2` una vez que la cuenta tiene un factor verificado) |
| `POST` | `/api/auth/mfa/recovery-codes` | Reemplazar los códigos de recuperación del emisor con diez nuevos (requiere una sesión `aal2`) |

La gestión administrativa de usuarios y roles es una **superficie separada**, montada en
`/api/admin/` en lugar de `/api/auth/`. La lectura requiere el scope `users:read` y
la modificación requiere `users:write`, excepto la lectura restringida del selector de usuarios a continuación. Un administrador y la clave de servicio poseen ambos; también
un rol que los declare. Nadie puede modificar una cuenta que tenga más privilegios que
los propios. Ver [Roles y scopes](/docs/backend/roles-and-scopes/).

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/admin/users` | Listar usuarios (paginado). `?search=` coincide con una parte insensible a mayúsculas y minúsculas del correo o display name. También coincide con cualquier rol que tenga el usuario y el uid |
| `GET` | `/api/admin/users/pick` | La lectura del selector de usuarios: `uid`, `displayName`, `email` y `photoURL` por usuario, nada más. Acepta `?search=`, `?limit=` (25 por defecto) y `?offset=`, o `?ids=a,b` para los usuarios que especifica un valor almacenado. Responde a `users:read`, y también a cualquiera que pueda escribir en una colección con un campo [`userSelect`](/docs/collections/properties/), permitiendo que un editor lo complete. Una regla escrita en SQL puro (`using` / `withCheck` que el modelo de políticas no puede interpretar) no se puede evaluar por adelantado, por lo que cuenta como denegada aquí: en dicha colección solo los poseedores de `users:read` pueden seleccionar. Cualquier otro recibe `403 SCOPE_MISSING` |
| `POST` | `/api/admin/users` | Crear un usuario. `invite: false` sin `password` lo crea sin contraseña y no envía nada |
| `POST` | `/api/admin/users/import` | Importar cuentas desde otro sistema, manteniendo sus ids. Ver [Importar cuentas](#importar-cuentas) |
| `GET` | `/api/admin/users/:uid` | Leer un usuario |
| `PUT` | `/api/admin/users/:uid` | Actualizar un usuario. `{ disabled: true }` deshabilita la cuenta sin eliminarla: todo inicio de sesión y actualización es rechazado (`ACCOUNT_DISABLED`), sus sesiones finalizan y todo token que posea es rechazado; `false` la habilita nuevamente |
| `DELETE` | `/api/admin/users/:uid` | Eliminar un usuario. Sus sesiones finalizan y todo token de acceso que posea es rechazado a partir de esa petición |
| `POST` | `/api/admin/users/:uid/reset-password` | Restablecer la contraseña de un usuario sin requerir la actual. `rebase auth reset-password` la invoca y escribe directamente en la base de datos solo cuando no se puede alcanzar el backend; de cualquier manera, las sesiones de la cuenta finalizan |
| `DELETE` | `/api/admin/users/:uid/mfa` | Eliminar los segundos factores y códigos de recuperación de un usuario, y finalizar sus sesiones (para alguien que perdió ambos) |
| `GET` | `/api/admin/roles` | `admin` y los roles que la tabla users declara, con sus scopes |
| `POST` | `/api/admin/bootstrap` | Permitir que el usuario registrado más antiguo reclame el rol de admin mientras no exista ninguno. Rechazado en producción — ver [Primer usuario Bootstrap](/docs/backend/authentication/#first-user-bootstrap) |

Todos los endpoints de la API de datos requieren una cabecera `Authorization: Bearer <token>` válida cuando `requireAuth: true` (el valor predeterminado).

### Importar cuentas

`POST /api/admin/users/import` crea cuentas que ya existen en otro
sistema bajo los ids que tienen allí, de modo que cada fila que haga referencia a uno de ellos
siga apuntando a la misma cuenta. Requiere `users:write`, al igual que `POST /api/admin/users`.

```json
{
  "users": [
    { "id": "5b0a3c9e-21f4-4d3b-8a6e-7c1d2e3f4a5b", "email": "ada@example.com", "displayName": "Ada",
      "createdAt": "2024-05-02T08:30:00Z", "emailVerified": true, "roles": ["editor"] }
  ],
  "dryRun": false
}
```

Con hashes de contraseña:

```json
{
  "passwordHashAlgorithm": "bcrypt",
  "users": [
    { "id": "5b0a3c9e-21f4-4d3b-8a6e-7c1d2e3f4a5b", "email": "ada@example.com", "emailVerified": true,
      "passwordHash": "$2a$10$…" }
  ]
}
```

- **`id`** se mantiene y es opcional. Un uuid es el caso habitual; cualquier id de
  letras, dígitos y `_ - . : |`, que comience con una letra o dígito, de hasta 128
  caracteres, también encaja (ids de Firebase, Auth0, Clerk). `service`, `anonymous`,
  `anon` y `default` son rechazados, al igual que cualquier otra cosa: `400 INVALID_ID` para
  esa cuenta. Una tabla users cuya columna `id` sea un `uuid` solo acepta uuids.
- **`email`** es obligatorio. `displayName`, `photoUrl`, `createdAt` (ISO 8601) y
  `roles` son opcionales; `emailVerified` es `false` a menos que se indique lo contrario. Una cuenta
  no verificada se confirma con el primer magic link o reseteo que siga, y no puede
  recibir inicios de sesión mediante un proveedor hasta entonces.
- **Sin correo y sin contraseña a menos que proporcione el hash.** No se envía nada por correo.
  Un campo `password` hace fallar esa cuenta. Una cuenta sin `passwordHash`
  inicia sesión mediante magic link, un código por correo, un proveedor o un restablecimiento de contraseña.
- **`passwordHash`** es el hash almacenado por el otro sistema, aceptado solo cuando la
  petición indica su formato en `passwordHashAlgorithm`. Actualmente es
  `"bcrypt"` (`$2a$`, `$2b$` o `$2y$`): lo que Supabase guarda en
  `auth.users.encrypted_password`, y lo que almacenan Auth0, Clerk y la mayoría de las apps en Rails,
  Laravel y Django-bcrypt. La cuenta luego inicia sesión con la
  contraseña que tenía, y su primer inicio de sesión reemplaza el hash con el propio
  scrypt de Rebase, sin cerrar otras sesiones. Un hash sin `passwordHashAlgorithm`,
  o uno que no coincida con ese formato, hace fallar esa cuenta (`INVALID_INPUT`,
  `INVALID_PASSWORD_HASH`); el hash nunca se devuelve en la respuesta. Un proyecto con sus
  propios hooks `hashPassword` o `verifyPassword` conserva el hash tal como se importó, y
  su `verifyPassword` decide qué acepta.
- **Nada se actualiza.** Una cuenta cuyo id ya esté en uso se marca como `skipped` con
  `ID_EXISTS`, y una cuyo correo ya esté en uso con `EMAIL_EXISTS` (incluida una cuenta
  anterior en la misma petición). Ejecutar la misma importación dos veces es seguro.
- **Ningún rol superior al del propio emisor**, al igual que en `POST /api/admin/users`, y
  `beforeUserCreate` se ejecuta para cada cuenta y puede rechazarla.
- **Un máximo de 100 cuentas por petición** (`400 TOO_MANY_USERS` por encima de eso).
  `dryRun: true` ejecuta todas las comprobaciones sin escribir nada.

La respuesta es `200` con un resultado por cuenta, en orden:

```json
{
  "dryRun": false, "created": 1, "skipped": 1, "failed": 1,
  "results": [
    { "index": 0, "status": "created", "uid": "5b0a3c9e-…", "email": "ada@example.com" },
    { "index": 1, "status": "skipped", "uid": "…", "email": "bob@example.com", "code": "EMAIL_EXISTS", "message": "…" },
    { "index": 2, "status": "failed", "email": "eve@example.com", "code": "INVALID_ID", "message": "…" }
  ]
}
```

`rebase users import <file>` envía un archivo CSV o JSON de esta manera, 100 cuentas
a la vez, y `client.admin.importUsers(users, { dryRun })` es la llamada del SDK.

### Política de contraseñas

Una nueva contraseña requiere al menos 8 caracteres, con una letra mayúscula, una
minúscula y un dígito. El registro, restablecimiento y cambio rechazan cualquier contraseña que
no cumpla con `400 WEAK_PASSWORD`, listando cada regla rota, al igual que un
administrador eligiendo una contraseña: `POST /api/admin/users`, una creación en la
tabla users a través de la API de datos (`POST /api/data/users`, su `/bulk`, una
escritura por socket o MCP), `PUT /api/admin/users/:uid` y
`POST /api/admin/users/:uid/reset-password`. En un `/bulk`, el mensaje comienza con
`Row <n>: ` (contado desde 0), al igual que los demás errores de fila en bulk.

Para crear cuentas cuyas contraseñas fueron definidas por otro sistema, como en una importación, envíe
`skipPasswordPolicy: true` en el cuerpo de creación (en cada fila de un `/bulk`). El
servidor solo lo respeta para un administrador o la clave de servicio; para cualquier
otro no exime nada, y el rechazo lo indica explícitamente. Nunca se almacena. La importación
del panel de administración lo envía para cada fila que contenga un `password`. El inicio de sesión
nunca valida la política, por lo que una contraseña antigua sigue funcionando. Para configurar sus propias reglas, pase
`auth.hooks.validatePasswordStrength` desde un backend [extraído (ejected)](/docs/backend/authentication/#configuration).
El primer administrador inicializado a partir de `REBASE_ADMIN_PASSWORD` está sujeto a
una regla diferente: al menos 12 caracteres y nada más.

### Formato de respuesta

Cada endpoint que emite una sesión responde con el mismo envoltorio — `register`,
`login`, cada proveedor OAuth, `magic-link/verify`, `otp/verify`, `anonymous`,
`anonymous/link` y `mfa/challenge/verify`:

```json
{
  "user": {
    "uid": "8f1c2a6e-…",
    "email": "jane@example.com",
    "displayName": "Jane Doe",
    "photoURL": null,
    "providerId": "password",
    "isAnonymous": false,
    "emailVerified": true,
    "roles": ["editor"],
    "metadata": {}
  },
  "tokens": {
    "accessToken": "eyJhbGciOi…",
    "refreshToken": "9b2e…",
    "accessTokenExpiresAt": 1700000000000
  }
}
```

Envíe el token de acceso de vuelta como `Authorization: Bearer <accessToken>`.
`accessTokenExpiresAt` se expresa en milisegundos de la época unix.

`POST /api/auth/refresh` responde con el mismo envoltorio, excepto que `user` se
omite por completo cuando la cuenta no puede volver a leerse, por lo que debe tratarse como opcional
en ese caso.

`providerId` indica cómo se inició la sesión: `password`, `anonymous`,
`magic-link`, `otp`, `mfa` (un inicio de sesión completado con un segundo factor), o el
id del proveedor, como `google`. Se guarda junto a la sesión en el inicio, por lo que
`refresh` y `GET /api/auth/me` devuelven la misma respuesta mientras
la sesión permanezca activa. Una sesión iniciada antes de la versión 0.24 devuelve `password`.

:::caution[El SDK tipado aplana este envoltorio — HTTP en bruto no lo hace]
El JSON anterior es el formato de transporte y es lo que devuelve `fetch("/api/auth/login")`:
el token se encuentra en **`body.tokens.accessToken`**.

El [SDK tipado](/docs/sdk/authentication) desenvuelve `tokens` antes de entregar
la sesión, por lo que `auth.signInWithEmail()` se resuelve en un objeto aplanado
**`{ user, accessToken, refreshToken }`**.

Ambas estructuras son reales; pertenecen a dos capas diferentes. Leer la estructura
del SDK desde un `fetch` en bruto devolverá `undefined`, lo que se manifestará como "inicio de sesión exitoso
pero no hay token de acceso" — el inicio de sesión fue correcto, el token estaba un nivel más abajo.
:::

### Cambiar una dirección de correo electrónico

Un usuario autenticado
mueve su propia cuenta a otra dirección en dos pasos:

1. `POST /api/auth/change-email { newEmail }` registra el cambio y envía un
   enlace, `<frontend>/confirm-email-change?token=…`, a la nueva dirección, y una
   notificación sin enlace a la actual. El enlace dura 24 horas y una
   nueva petición reemplaza a la anterior. `GET /api/auth/me` reporta la dirección
   en espera como `pendingEmail`.
2. `POST /api/auth/confirm-email-change { token }` traslada la cuenta: la nueva
   dirección pasa a ser su dirección verificada. Cada identidad OAuth cuyo proveedor
   haya avalado la dirección anterior se desvincula (`removedProviders` las lista),
   porque quien controle la dirección anterior podría, de lo contrario, seguir iniciando sesión
   a través de ella, y cualquier enlace de restablecimiento enviado a la dirección anterior deja de funcionar.
   Las sesiones se conservan.

La nueva dirección no se reserva mientras el enlace espera: retenerla permitiría a cualquier
cuenta impedir que un extraño se registre con su propia dirección. Si otra
cuenta ya posee la dirección para el momento en que se sigue el enlace, el enlace responde
`409 EMAIL_EXISTS` y nada se transfiere; entre dos cuentas que soliciten la misma
dirección, la primera en seguir su enlace la obtiene. El hook `beforeEmailChange` puede
rechazar una dirección, al igual que hace `beforeUserCreate` en el registro.

En el CMS, la dirección se cambia desde **Configuración de la cuenta → Perfil**, y el
enlace abre la propia pantalla del CMS, esté iniciada la sesión o no. Otro frontend sirve una página
en `/confirm-email-change` que invoca la ruta con el token del enlace.

Con [`cookieAuth`](/docs/backend/authentication/#refresh-tokens-in-an-httponly-cookie) activado (por defecto), el token
de actualización viaja como una cookie `httpOnly` y `tokens.refreshToken` es una cadena
vacía en el cuerpo. El token de acceso no se ve afectado.

### Autenticación multifactor (TOTP)

**Un segundo factor restringe el inicio de sesión, no solo operaciones individuales.** Una vez que
una cuenta tiene un factor TOTP *verificado*, ninguna ruta le emitirá una sesión hasta que
se presente un código: el inicio con contraseña, cada proveedor OAuth, magic link, código por correo
y anonymous-link rechazarán la petición con `401 MFA_REQUIRED`:

```json
{
  "error": {
    "code": "MFA_REQUIRED",
    "message": "Multi-factor authentication is required to complete sign-in.",
    "details": {
      "mfaToken": "<short-lived pre-auth token>",
      "factors": [{ "id": "…", "factorType": "totp", "friendlyName": "Phone" }]
    }
  }
}
```

`mfaToken` **no es una sesión**: tiene un propósito delimitado, expira en cinco minutos,
y es rechazado por cualquier ruta autenticada. Envíelo como token portador (bearer) a
`POST /api/auth/mfa/challenge` (con un `factorId`) y luego a
`POST /api/auth/mfa/challenge/verify` (con el `challengeId` y el código de seis dígitos,
o un código de recuperación). Esta última llamada es la que genera los tokens de acceso y actualización,
en nivel `aal2`; el nivel se guarda en la sesión y se mantiene a lo largo de
`POST /api/auth/refresh`.

El registro de factores también está restringido. El primer factor en una cuenta puede registrarse desde
una sesión ordinaria, pero una vez que uno esté verificado, `enroll`, `verify` y `unenroll`
requerirán una sesión `aal2` — de lo contrario, una contraseña robada podría registrar un
factor propio, elevar privilegios con él y eliminar el verdadero.

La verificación está acotada en ambos ejes: un desafío expira tras cinco intentos
fallidos, cada cuenta está limitada a diez intentos de verificación cada 15 minutos
(contabilizados por usuario, por lo que rotar IPs no ayuda), y un código aceptado se
registra contra el factor para que no pueda reutilizarse durante el resto de su
ventana de ±1 paso.

En la tabla users del CMS, **Restablecer verificación en dos pasos**
(`DELETE /api/admin/users/:uid/mfa`) y **Deshabilitar o habilitar cuenta**
(`PUT /api/admin/users/:uid { disabled }`) se ofrecen a quien posea
`users:write`, tal como las rutas; la opción nunca se ofrece sobre su propia
cuenta, y una cuenta con mayor rango que usted será rechazada con el motivo del servidor.

Configure `MFA_ENCRYPTION_KEY` (32+ caracteres aleatorios) para cifrar los secretos
TOTP almacenados. Sin esto, el servidor recurrirá a `JWT_SECRET` y emitirá una advertencia. Configúrelo
**antes** de que nadie se registre: los secretos almacenados no llevan id de clave, por lo que cambiar la clave
posteriormente dejará los factores existentes indescifrables y sus propietarios no podrán
completar un desafío.

### Invitar a miembros del equipo por correo

Los flujos de invitación necesitan convertir una dirección de correo en un id de usuario, pero la
tabla `users` está protegida por RLS frente al cliente. En lugar de crear manualmente una
función de servidor de administrador, habilite la búsqueda integrada:

```typescript no-verify
await initializeRebaseBackend({
    auth: {
        // ...
        allowUserLookup: true,   // habilita POST /api/auth/find-user
    },
});
```

Luego, desde el cliente:

```typescript
const profile = await client.auth.findUserByEmail("teammate@example.com");
// → { uid, displayName, photoURL } | null   (nunca email/roles/metadata)
if (profile) {
    await client.data.team_members.create({ team_id, user_id: profile.uid });
}
```

El endpoint es **únicamente autenticado** y devuelve solo `uid`, `displayName`,
y `photoURL` — nunca el correo, roles o metadatos del usuario consultado. Está
**desactivado por defecto** porque permite a cualquier usuario autenticado sondear qué correos tienen
cuentas; actívelo únicamente cuando la experiencia de invitación de su aplicación lo requiera.

## Contexto de base de datos para Row-Level Security (RLS)

Rebase conecta la autenticación de peticiones directamente con la seguridad a nivel de fila (Row-Level Security o RLS) de PostgreSQL. Cada consulta a la base de datos ejecutada a través de un driver con ámbito de usuario corre dentro de una transacción de base de datos (`db.transaction()`) que define parámetros de configuración locales a la transacción:

*   `app.uid` — El ID único (`uid`) del usuario autenticado. Por defecto es `'anonymous'` para peticiones no autenticadas. El nombre previo al cambio, `app.user_id`, todavía se escribe junto a este para políticas compiladas antes del cambio de nombre.
*   `app.user_roles` — Una cadena separada por comas que lista los roles asignados al usuario.
*   `app.is_anonymous` — `'true'` para una sesión de invitado (inicio anónimo), `'false'` en caso contrario.
*   `app.jwt` — Una cadena JSON con los claims personalizados del token más `sub`, `roles` e `is_anonymous` (`{"sub": "<uid>", "roles": [...], "is_anonymous": false, …}`).

Estos parámetros se configuran localmente durante la transacción usando la función `set_config` de Postgres:
```sql
SELECT 
    set_config('app.uid', $1, true),
    set_config('app.user_id', $1, true),
    set_config('app.user_roles', $2, true),
    set_config('app.is_anonymous', $3, true),
    set_config('app.jwt', $4, true);
```

### Funciones auxiliares de políticas de PostgreSQL

Para facilitar la escritura de políticas de Row-Level Security, Rebase crea funciones auxiliares bajo el esquema `rebase` durante la inicialización de la base de datos:

*   **`rebase.uid()`** — Devuelve el ID del usuario autenticado como `text`, o `NULL` si no está configurado:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.uid() RETURNS text AS $$
        SELECT COALESCE(
            NULLIF(current_setting('app.uid', true), ''),
            NULLIF(current_setting('app.user_id', true), '')
        );
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.roles()`** — Devuelve la cadena de roles separada por comas:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.roles() RETURNS text AS $$
        SELECT COALESCE(NULLIF(current_setting('app.user_roles', true), ''), '');
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.jwt()`** — Devuelve el payload completo del JWT como un objeto `jsonb`:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.jwt() RETURNS jsonb AS $$
        SELECT COALESCE(NULLIF(current_setting('app.jwt', true), ''), '{}')::jsonb;
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.is_anonymous()`** — Indica si el emisor es un invitado, como `boolean` (`false` cuando no está configurado), de modo que una política puede indicar `NOT rebase.is_anonymous()`.

Puede usar estas funciones auxiliares directamente en sus reglas de seguridad personalizadas o migraciones de base de datos:
```sql
CREATE POLICY owner_access ON posts
    FOR ALL
    TO public
    USING (author_id = rebase.uid() OR string_to_array(rebase.roles(), ',') && ARRAY['admin']);
```

## Tokens asimétricos y JWKS

Por defecto, los tokens de acceso están firmados con `jwtSecret` (HS256). Eso funciona, pero
significa que cualquier entidad que necesite *verificar* un token debe poseer la clave que lo
*emite* — por lo que un gateway o un edge worker que compruebe una sesión también puede falsificarla — y
cambiar el secreto cierra la sesión de todos los usuarios a la vez.

Configure una clave de firma y Rebase firmará los tokens de acceso de forma asimétrica,
publicando la parte pública en **`/.well-known/jwks.json`** para que cualquiera pueda verificar
contra ella:

```typescript no-verify
auth: {
    jwtSecret: process.env.JWT_SECRET,
    signingKeys: [
        { kid: "2026-08", privateKey: process.env.JWT_PRIVATE_KEY! }
    ]
}
```

O desde las variables de entorno, para una sola clave:

```bash
JWT_PRIVATE_KEY="$(cat jwt-key.pem)"
JWT_KEY_ID=2026-08
```

Genere una clave con:

```bash
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out jwt-key.pem
```

Las claves RSA también funcionan y firman con `RS256`; las claves EC P-256 firman con `ES256`. Solo se
configura la clave privada — la mitad pública se deriva de ella, por lo que el par no puede
estar desalineado. `jwtSecret` sigue siendo obligatorio en ambos casos: aún firma los
tokens de propósito delimitado (enlaces de descarga, MFA pendiente, restablecimiento de contraseña) que solo
este servidor lee.

### Rotar una clave

Coloque la nueva clave primero y mantenga la antigua en la lista. Los nuevos tokens se firmarán con la
nueva clave; los tokens ya en circulación continuarán verificándose contra la antigua hasta
que expiren, de modo que a ningún usuario se le cierre la sesión.

```typescript no-verify
signingKeys: [
    { kid: "2026-09", privateKey: process.env.JWT_PRIVATE_KEY_NEW! },
    { kid: "2026-08", privateKey: process.env.JWT_PRIVATE_KEY_OLD! }
]
```

Una vez que haya transcurrido el tiempo de vida más largo de los tokens de acceso, elimine la entrada antigua. Use
`activeKid` si desea publicar una clave antes de firmar con ella.

### Verificar en otros servicios

Los tokens llevan el `kid` de la clave de firma en su cabecera, que es como un verificador
selecciona la clave correcta del JWKS y cómo sabe que debe volver a consultarlo tras
una rotación. Cualquier biblioteca estándar hace esto por usted; por ejemplo, con `jose`:

```typescript no-verify
import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(new URL("https://api.example.com/.well-known/jwks.json"));
const { payload } = await jwtVerify(token, jwks);
```

:::note
Sin `signingKeys` configurado, `/.well-known/jwks.json` responde
`{"keys":[]}` y los tokens siguen siendo HS256. Nada cambia hasta que agregue una clave.
:::

## Autenticación mediante Service Key

Para la comunicación de servidor a servidor (por ej., cron jobs, servicios externos), configure una clave de servicio estática:

```typescript
auth: {
    serviceKey: process.env.REBASE_SERVICE_KEY,
    // ...
}
```

Los clientes se autentican mediante la cabecera `Authorization: Bearer <service-key>`. 

### Clave interna por arranque

Si no se proporciona `REBASE_SERVICE_KEY` en su configuración, Rebase genera automáticamente una **clave interna aleatoria por arranque**. 

Esta clave nunca se registra en logs y nunca abandona el proceso. Es utilizada por el singleton `rebase` para autenticarse frente a las propias APIs de control del servidor (autenticación, almacenamiento, etc.). Esto garantiza que las tareas administrativas (como enviar un correo de bienvenida o generar una URL de almacenamiento) siempre funcionen directamente en desarrollo y producción sin requerir una gestión manual de claves.

### Protección contra ataques de temporización y requisitos de clave

Para prevenir ataques de temporización (timing attacks), Rebase valida tanto la clave de servicio configurada por el usuario como la clave interna mediante comparación de cadenas en tiempo constante (`safeCompare`). La clave de servicio configurada por el usuario **debe tener al menos 32 caracteres de longitud**; si se configura una clave de menos de 32 caracteres, Rebase lanzará un error de configuración al inicio y se cerrará por seguridad (fail-closed).

## Próximos pasos

- **[Autenticación](/docs/backend/authentication/)** — la configuración de la que provienen estas rutas
- **[Adaptadores de autenticación personalizados](/docs/backend/auth-adapters/)** — reemplazar el proveedor detrás de ellas
- **[Reglas de seguridad (RLS)](/docs/collections/security-rules/)** — qué hace una política con `rebase.uid()`
- **[Autenticación con el SDK tipado](/docs/sdk/authentication/)** — invocar estas rutas desde el SDK
