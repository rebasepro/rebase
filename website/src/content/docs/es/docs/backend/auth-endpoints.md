---
sourceHash: 928eebeb904fa5e0
title: Endpoints de autenticación y tokens
sidebar_label: Endpoints de autenticación
description: Las rutas de autenticación que monta el backend de Rebase, sus formatos de respuesta, autenticación multifactor, el contexto de base de datos que ve una política, JWKS y claves de servicio.
---

Las rutas que monta [el bloque `auth`](/docs/backend/authentication/) y los tokens que devuelven.

## Endpoints de autenticación

Todos los endpoints de autenticación están montados en `/api/auth/`:

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Crear una nueva cuenta |
| `POST` | `/api/auth/login` | Iniciar sesión con correo electrónico/contraseña |
| `POST` | `/api/auth/refresh` | Refrescar el token de acceso |
| `POST` | `/api/auth/<provider>` | Inicio de sesión con OAuth (p. ej., `/api/auth/google`, `/api/auth/linkedin`) |
| `POST` | `/api/auth/link/<provider>` | Vincular un proveedor OAuth a la cuenta autenticada. En un invitado esto cuenta como registro: requiere `allowRegistration`, toma la dirección del proveedor cuando este la avala y responde con una sesión para la cuenta en la que se convirtió el invitado |
| `POST` | `/api/auth/logout` | Revocar el refresh token |
| `POST` | `/api/auth/forgot-password` | Enviar correo de restablecimiento de contraseña |
| `POST` | `/api/auth/reset-password` | Restablecer contraseña con token |
| `POST` | `/api/auth/find-user` | Resolver un correo electrónico a un perfil público mínimo (opcional — `AUTH_ALLOW_USER_LOOKUP`) |
| `POST` | `/api/auth/change-password` | Cambiar la propia contraseña de quien realiza la llamada (autenticado). Cierra todas las demás sesiones y responde con una nueva para quien llama |
| `GET` | `/api/auth/me` | El perfil propio de quien realiza la llamada |
| `PATCH` | `/api/auth/me` | Actualizar el perfil propio de quien realiza la llamada |
| `POST` | `/api/auth/change-email` | `{ newEmail }`: mover la cuenta propia de quien llama a otra dirección. Envía un enlace a la nueva dirección y una notificación a la anterior; nada cambia hasta que se sigue el enlace. Requiere `aal2` en una cuenta con un segundo factor. `409 EMAIL_EXISTS` o `UNDELIVERABLE_ADDRESS`, `400 EMAIL_UNCHANGED`, `403 ANONYMOUS_USER` para un invitado — ver [Cambiar una dirección de correo electrónico](#cambiar-una-dirección-de-correo-electrónico) |
| `POST` | `/api/auth/confirm-email-change` | `{ token }` del enlace. No requiere sesión. Mueve la cuenta a la nueva dirección, verificada; `400 INVALID_TOKEN` para un enlace ya usado, reemplazado o caducado, `409 EMAIL_EXISTS` si la dirección fue tomada mientras esperaba |
| `GET` | `/api/auth/config` | Lo que este backend ofrece a una pantalla de inicio de sesión — `needsSetup`, `registrationEnabled`, `passwordReset`, `emailVerification`, `magicLink`, `anonymousLogin`, `adminPasswordReset`, `enabledProviders` y `storage`, que indica si el backend sirve almacenamiento de archivos. No autenticado, y calculado a partir de los mismos predicados que aplican las rutas, por lo que lo que anuncia la pantalla no puede diferir de lo que realmente puede hacer |
| `POST` | `/api/auth/send-verification` | Enviar a quien llama un enlace de verificación de correo |
| `GET` | `/api/auth/verify-email` | Consumir un enlace de verificación (la URL de ese correo). Mantiene lo que demuestra una sesión activa de la cuenta y elimina lo que nadie demostró — ver [Verificación de correo electrónico](/docs/backend/email-verification/) |
| `POST` | `/api/auth/verify-email` | Lo mismo con `{ token, password?, removeUnproven? }`: la contraseña lo conserva e inicia sesión; sin ninguna de las dos pruebas, una cuenta que posea una responde `409 PROOF_REQUIRED` |
| `POST` | `/api/auth/magic-link` | Enviar por correo un enlace de inicio de sesión de un solo uso. `503 EMAIL_NOT_CONFIGURED` sin SMTP |
| `POST` | `/api/auth/magic-link/verify` | Canjear un token de magic link por una sesión |
| `POST` | `/api/auth/otp` | Enviar por correo un código de inicio de sesión de seis dígitos. Responde lo mismo tanto si la dirección tiene cuenta como si no |
| `POST` | `/api/auth/otp/verify` | Canjear `{ email, code }` por una sesión |
| `POST` | `/api/auth/anonymous` | Crear una sesión anónima (opcional — `ALLOW_ANONYMOUS`) |
| `POST` | `/api/auth/anonymous/link` | Asociar credenciales reales a la cuenta anónima que ya ha iniciado sesión. Requiere tanto `allowAnonymous` como registro abierto: `403 ANONYMOUS_AUTH_DISABLED` una vez desactivado el inicio de sesión anónimo, incluidos los invitados que hayan iniciado sesión antes, y `403 REGISTRATION_DISABLED` mientras el registro esté cerrado |
| `GET` | `/api/auth/sessions` | Listar las sesiones activas de quien llama, una por cada inicio de sesión. La propia de quien llama está marcada con `isCurrentSession` |
| `DELETE` | `/api/auth/sessions` | Revocar todas las sesiones, incluida esta — cierre de sesión remoto en todos los dispositivos |
| `DELETE` | `/api/auth/sessions/:id` | Revocar una sesión: su refresh token y el token de acceso que posee ese dispositivo |
| `GET` | `/api/auth/scopes` | Cada [scope](/docs/backend/roles-and-scopes/) que este backend conoce y los que posee quien llama |
| `GET` | `/api/auth/keys` | Las [claves de API personales](/docs/backend/api-keys/#personal-keys) propias de quien llama |
| `POST` | `/api/auth/keys` | Crear una clave personal. `403 PERSONAL_KEYS_DISABLED` a menos que la tabla de usuarios establezca `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | Revocar una de las claves propias de quien llama |
| `GET` | `/.well-known/jwks.json` | El JWKS público — montado en la raíz, no bajo `basePath`, porque ahí es donde busca un verificador. Se monta siempre que el backend emite sus propios tokens; un conjunto de claves vacío hasta que se configure la [firma asimétrica](#tokens-asimétricos-y-jwks) |
| `POST` | `/api/auth/mfa/enroll` | Iniciar el registro de TOTP (devuelve el secreto y los códigos de recuperación) |
| `POST` | `/api/auth/mfa/verify` | Confirmar un registro con un código del autenticador |
| `GET` | `/api/auth/mfa/factors` | Listar los factores registrados de quien llama |
| `POST` | `/api/auth/mfa/challenge` | Abrir un desafío contra un factor verificado |
| `POST` | `/api/auth/mfa/challenge/verify` | Responder a un desafío — esto es lo que emite la sesión |
| `DELETE` | `/api/auth/mfa/unenroll` | Eliminar un factor (requiere una sesión `aal2` una vez que la cuenta tiene un factor verificado) |
| `POST` | `/api/auth/mfa/recovery-codes` | Reemplazar los códigos de recuperación de quien llama por diez nuevos (requiere una sesión `aal2`) |

La gestión administrativa de usuarios y roles es una **superficie separada**, montada en
`/api/admin/` en lugar de `/api/auth/`. La lectura requiere el scope `users:read` y
la modificación requiere `users:write`, excepto la lectura restringida del selector de usuarios que se detalla a continuación. Un administrador y la service key poseen ambos; también un
rol que los declare. Nadie puede modificar una cuenta que posea más permisos que los suyos propios.
Consulta [Roles y scopes](/docs/backend/roles-and-scopes/).

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/admin/users` | Listar usuarios (paginado). `?search=` coincide con una parte sin distinción de mayúsculas y minúsculas del correo electrónico o nombre para mostrar. También coincide con cualquier rol que tenga el usuario y el uid |
| `GET` | `/api/admin/users/pick` | Lectura del selector de usuarios: `uid`, `displayName`, `email` y `photoURL` por usuario, nada más. Acepta `?search=`, `?limit=` (25 por defecto) y `?offset=`, o `?ids=a,b` para los usuarios especificados por un valor almacenado. Responde a `users:read`, y también a cualquiera que pueda escribir en una colección con un campo [`userSelect`](/docs/collections/properties/), para que un editor pueda completarlo. Una regla escrita como SQL sin procesar (`using` / `withCheck` que el modelo de políticas no puede interpretar) no se puede evaluar de antemano, por lo que aquí se considera como denegada: en dicha colección solo quienes tengan `users:read` pueden seleccionar usuarios. Cualquier otro recibe `403 SCOPE_MISSING` |
| `POST` | `/api/admin/users` | Crear un usuario. `invite: false` sin `password` lo crea sin contraseña y no envía nada |
| `POST` | `/api/admin/users/import` | Importar cuentas desde otro sistema, manteniendo sus identificadores. Ver [Importación de cuentas](#importación-de-cuentas) |
| `GET` | `/api/admin/users/:uid` | Leer un usuario |
| `PUT` | `/api/admin/users/:uid` | Actualizar un usuario. `{ disabled: true }` desactiva la cuenta sin eliminarla: se rechaza cada inicio de sesión y refresco (`ACCOUNT_DISABLED`), sus sesiones finalizan y se rechaza cada token que posea; `false` la vuelve a activar |
| `DELETE` | `/api/admin/users/:uid` | Eliminar un usuario. Sus sesiones finalizan y cada token de acceso que posea se rechaza a partir de esa solicitud |
| `POST` | `/api/admin/users/:uid/reset-password` | Restablecer la contraseña de un usuario sin requerir la actual. `rebase auth reset-password` lo llama y escribe directamente en la base de datos solo cuando no se puede alcanzar el backend; en cualquier caso, las sesiones de la cuenta finalizan |
| `DELETE` | `/api/admin/users/:uid/mfa` | Eliminar los segundos factores y códigos de recuperación de un usuario, y finalizar sus sesiones — para alguien que haya perdido ambos |
| `GET` | `/api/admin/roles` | `admin` y los roles declarados en la tabla de usuarios, con sus scopes |
| `POST` | `/api/admin/bootstrap` | Permitir que el primer usuario registrado reclame el rol de administrador mientras no exista ninguno. Rechazado en producción — ver [Bootstrap del primer usuario](/docs/backend/authentication/#first-user-bootstrap) |

Todos los endpoints de la API de datos requieren una cabecera `Authorization: Bearer <token>` válida cuando `requireAuth: true` (el valor predeterminado).

### Importación de cuentas

`POST /api/admin/users/import` crea cuentas que ya existen en otro
sistema, bajo los ids que tienen allí, de modo que cada fila que haga referencia a una de ellas
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

- **`id`** se mantiene y es opcional. Un uuid es el caso habitual; cualquier id de
  letras, dígitos y `_ - . : |`, que comience con una letra o dígito, de hasta 128
  caracteres, también es válido (ids de Firebase, Auth0, Clerk). Se rechazan `service`, `anonymous`,
  `anon` y `default`, al igual que cualquier otro valor: `400 INVALID_ID` para
  esa cuenta. Una tabla de usuarios cuya columna `id` sea de tipo `uuid` solo acepta uuids.
- **`email`** es obligatorio. `displayName`, `photoUrl`, `createdAt` (ISO 8601) y
  `roles` son opcionales; `emailVerified` es `false` a menos que se indique lo contrario. Una cuenta
  no verificada se confirma con el primer magic link o restablecimiento que siga, y ningún
  proveedor podrá iniciar sesión en ella hasta entonces.
- **Sin contraseña, sin correo.** Un campo `password` o `passwordHash` causará el rechazo de esa
  cuenta, y no se enviará nada por correo. La cuenta inicia sesión mediante magic link, un
  código por correo, un proveedor o un restablecimiento de contraseña.
- **Nada se actualiza.** Una cuenta cuyo id ya esté en uso se marca como `skipped` con
  `ID_EXISTS`, y una cuyo correo ya esté en uso con `EMAIL_EXISTS` (incluida una cuenta previa
  en la misma solicitud). Ejecutar la misma importación dos veces es seguro.
- **Ningún rol superior al del propio solicitante**, igual que en `POST /api/admin/users`, y
  `beforeUserCreate` se ejecuta para cada cuenta y puede rechazarla.
- **Como máximo 100 cuentas por solicitud** (`400 TOO_MANY_USERS` si se supera).
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
a la vez, y `client.admin.importUsers(users, { dryRun })` es la llamada correspondiente en el SDK.

### Política de contraseñas

Una nueva contraseña requiere al menos 8 caracteres, con una letra mayúscula, una
letra minúscula y un dígito. El registro, restablecimiento y cambio rechazan cualquier contraseña que no
cumpla los requisitos con `400 WEAK_PASSWORD`, detallando cada regla incumplida, al igual que cuando un
administrador elige una contraseña: `POST /api/admin/users`, una creación en la
tabla de usuarios a través de la API de datos (`POST /api/data/users`, su `/bulk`, una
escritura por socket o MCP), `PUT /api/admin/users/:uid` y
`POST /api/admin/users/:uid/reset-password`. En un `/bulk`, el mensaje comienza con
`Row <n>: ` (contado desde 0), al igual que los demás errores por fila de las operaciones masivas.

Para crear cuentas cuyas contraseñas fueron establecidas por otro sistema, como en una importación, envía
`skipPasswordPolicy: true` en el cuerpo de creación (en cada fila de un `/bulk`). El
servidor solo lo respeta si proviene de un administrador o de la clave de servicio (service key); para cualquier otro
no exime ninguna comprobación, y el rechazo así lo indica. Nunca se almacena. La
importación del panel de administración lo envía para cada fila que incluya una `password`. El inicio de sesión
nunca comprueba la política, por lo que una contraseña más antigua seguirá funcionando. Para definir tus propias reglas, pasa
`auth.hooks.validatePasswordStrength` desde un backend [expulsado (ejected)](/docs/backend/authentication/#configuration). El primer administrador inicializado a partir de `REBASE_ADMIN_PASSWORD` se rige por una
regla diferente: al menos 12 caracteres y nada más.

### Formato de respuesta

Cada endpoint que emite una sesión responde con la misma estructura (envelope) — `register`,
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

Envía el token de acceso de vuelta como `Authorization: Bearer <accessToken>`.
`accessTokenExpiresAt` se expresa en milisegundos de tiempo epoch.

`POST /api/auth/refresh` responde con la misma estructura, excepto que `user` se
omite por completo cuando la cuenta no se puede volver a leer, por lo que debes tratarlo como opcional
en ese caso.

`providerId` indica cómo se inició sesión: `password`, `anonymous`,
`magic-link`, `otp`, `mfa` (un inicio de sesión completado con un segundo factor) o el
id del proveedor, como `google`. Se almacena con la sesión al iniciar sesión, por lo que
`refresh` y `GET /api/auth/me` devuelven la misma respuesta durante toda la vida útil
de la sesión. Una sesión iniciada antes de la versión 0.24 devuelve `password`.

:::caution[El SDK tipado aplana esta estructura — HTTP directo no]
El JSON anterior es el formato de transmisión (wire format), y es lo que devuelve `fetch("/api/auth/login")`:
el token reside en **`body.tokens.accessToken`**.

El [SDK tipado](/docs/sdk/authentication) desempaqueta `tokens` antes de entregar la
sesión, por lo que `auth.signInWithEmail()` resuelve a un objeto aplanado
**`{ user, accessToken, refreshToken }`** en su lugar.

Ambas estructuras son reales; pertenecen a dos capas distintas. Leer la estructura del SDK
a partir de un `fetch` directo produce `undefined`, lo que se manifiesta como "el inicio de sesión tuvo éxito
pero no hay token de acceso" — el inicio de sesión fue correcto, el token estaba un nivel más abajo.
:::

### Cambiar una dirección de correo electrónico

Un usuario autenticado
traslada su propia cuenta a otra dirección en dos pasos:

1. `POST /api/auth/change-email { newEmail }` registra el cambio y envía un
   enlace, `<frontend>/confirm-email-change?token=…`, a la nueva dirección, así como una
   notificación sin enlace a la actual. El enlace tiene una vigencia de 24 horas y una
   nueva solicitud reemplaza a la anterior. `GET /api/auth/me` reporta la dirección en
   espera como `pendingEmail`.
2. `POST /api/auth/confirm-email-change { token }` traslada la cuenta: la nueva
   dirección se convierte en su dirección verificada. Cada identidad de OAuth cuyo proveedor
   haya avalado la dirección anterior se desvincula (`removedProviders` las enumera),
   ya que quien controle la dirección anterior podría, de lo contrario, seguir iniciando sesión
   a través de ella, y cualquier enlace de restablecimiento enviado a la dirección anterior deja de funcionar.
   Las sesiones se mantienen.

La nueva dirección no queda reservada mientras el enlace espera: retenerla permitiría a cualquier
cuenta impedir que otra persona se registre con su propia dirección. Si otra
cuenta ya tiene la dirección en el momento en que se sigue el enlace, este responde
`409 EMAIL_EXISTS` y nada cambia; de dos cuentas que soliciten la misma
dirección, la primera en seguir su enlace la obtiene. El hook `beforeEmailChange` puede
rechazar una dirección, al igual que hace `beforeUserCreate` en el registro.

En el CMS, la dirección se cambia desde **Configuración de la cuenta → Perfil** (Account settings → Profile), y el
enlace abre la propia pantalla del CMS, con o sin sesión iniciada. Otro frontend puede servir una página
en `/confirm-email-change` que llame a la ruta con el token del enlace.

Con [`cookieAuth`](/docs/backend/authentication/#refresh-tokens-in-an-httponly-cookie) activado (predeterminado), el token de actualización
viaja como una cookie `httpOnly` y `tokens.refreshToken` es una cadena
vacía en el cuerpo. El token de acceso no se ve afectado.

### Autenticación multifactor (TOTP)

**Un segundo factor condiciona el inicio de sesión, no solo operaciones individuales.** Una vez que una
cuenta tiene un factor TOTP *verificado*, ninguna ruta le emitirá una sesión hasta que se
proporcione un código: el inicio de sesión con contraseña, cada proveedor OAuth, magic link,
código por correo y anonymous-link se rechazan con `401 MFA_REQUIRED`:

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

`mfaToken` **no es una sesión**: tiene un propósito específico, expira en cinco minutos
y es rechazado por cualquier ruta autenticada. Envíalo como token de portador (bearer token) a
`POST /api/auth/mfa/challenge` (con un `factorId`) y luego a
`POST /api/auth/mfa/challenge/verify` (con el `challengeId` y el código de seis dígitos,
o un código de recuperación). Esa última llamada es la que emite los tokens de acceso y de actualización,
en nivel `aal2`; el nivel se guarda en la sesión y se mantiene a través de
`POST /api/auth/refresh`.

El registro de factores también está restringido. El primer factor de una cuenta puede registrarse desde una
sesión ordinaria, pero una vez verificado uno, `enroll`, `verify` y `unenroll`
requieren una sesión `aal2`; de lo contrario, una contraseña robada podría registrar un
factor propio, elevar privilegios con él y eliminar el auténtico.

La verificación está limitada en ambos sentidos: un desafío expira tras cinco intentos
fallidos, cada cuenta está limitada a diez intentos de verificación por cada 15 minutos
(contabilizados por usuario, por lo que rotar IPs no sirve de nada) y un código aceptado se
registra contra el factor para que no pueda reutilizarse durante el resto de su
ventana de ±1 paso.

En la tabla de usuarios del CMS, **Restablecer la verificación en dos pasos**
(`DELETE /api/admin/users/:uid/mfa`) y **Desactivar o activar cuenta**
(`PUT /api/admin/users/:uid { disabled }`) se ofrecen a quien posea
`users:write`, al igual que las rutas; la opción nunca se ofrece para tu propia
cuenta, y una cuenta con mayor rango que el tuyo es rechazada con el motivo proporcionado por el servidor.

Configura `MFA_ENCRYPTION_KEY` (más de 32 caracteres aleatorios) para cifrar los
secretos TOTP almacenados. Sin ella, el servidor recurre a `JWT_SECRET` y emite una advertencia. Configúrala
**antes** de que alguien se registre: los secretos almacenados no llevan id de clave, por lo que cambiar la clave
posteriormente dejará los factores existentes indescifrables y sus propietarios no podrán
completar un desafío.

### Invitar a miembros del equipo por correo electrónico

Los flujos de invitación necesitan convertir una dirección de correo electrónico en un ID de usuario, pero la tabla
`users` está protegida por RLS frente al cliente. En lugar de implementar manualmente
una función de servidor administrativa, activa la búsqueda integrada:

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
const profile = await client.auth.findUserByEmail("teammate@example.com");
// → { uid, displayName, photoURL } | null   (never email/roles/metadata)
if (profile) {
    await client.data.team_members.create({ team_id, user_id: profile.uid });
}
```

El endpoint es **exclusivo para usuarios autenticados** y solo devuelve `uid`, `displayName`
y `photoURL` — nunca el correo electrónico, los roles o los metadatos del usuario consultado. Está
**desactivado por defecto** porque permite a cualquier usuario autenticado sondear qué correos electrónicos tienen
cuentas; actívalo solo si la experiencia de invitación de tu aplicación lo requiere.

## Contexto de base de datos para la seguridad a nivel de fila (RLS)

Rebase conecta directamente la autenticación de solicitudes con la seguridad a nivel de fila (RLS) de PostgreSQL. Cada consulta a la base de datos ejecutada a través de un controlador delimitado por usuario se ejecuta dentro de una transacción de base de datos (`db.transaction()`) que define parámetros de configuración locales a la transacción:

*   `app.uid` — El identificador único (`uid`) del usuario autenticado. Por defecto es `'anonymous'` para solicitudes no autenticadas. El nombre previo al renombre, `app.user_id`, todavía se escribe a su lado, para políticas compiladas antes del cambio.
*   `app.user_roles` — Una cadena separada por comas que enumera los roles asignados al usuario.
*   `app.is_anonymous` — `'true'` para una sesión de invitado (inicio de sesión anónimo), `'false'` en caso contrario.
*   `app.jwt` — Una cadena JSON con los claims personalizados del token más `sub`, `roles` y `is_anonymous` (`{"sub": "<uid>", "roles": [...], "is_anonymous": false, …}`).

Estos parámetros se configuran localmente durante la duración de la transacción mediante la función `set_config` de Postgres:
```sql
SELECT 
    set_config('app.uid', $1, true),
    set_config('app.user_id', $1, true),
    set_config('app.user_roles', $2, true),
    set_config('app.is_anonymous', $3, true),
    set_config('app.jwt', $4, true);
```

### Funciones auxiliares para políticas de PostgreSQL

Para facilitar la escritura de políticas de seguridad a nivel de fila, Rebase crea funciones auxiliares en el esquema `rebase` durante la inicialización de la base de datos:

*   **`rebase.uid()`** — Devuelve el ID del usuario autenticado como `text`, o `NULL` si no está establecido:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.uid() RETURNS text AS $$
        SELECT COALESCE(
            NULLIF(current_setting('app.uid', true), ''),
            NULLIF(current_setting('app.user_id', true), '')
        );
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.roles()`** — Devuelve la cadena de roles separados por comas:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.roles() RETURNS text AS $$
        SELECT COALESCE(NULLIF(current_setting('app.user_roles', true), ''), '');
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.jwt()`** — Devuelve la carga útil (payload) completa del JWT como un objeto `jsonb`:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.jwt() RETURNS jsonb AS $$
        SELECT COALESCE(NULLIF(current_setting('app.jwt', true), ''), '{}')::jsonb;
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.is_anonymous()`** — Indica si quien realiza la llamada es un invitado, como `boolean` (`false` si no está establecido), de modo que una política puede indicar `NOT rebase.is_anonymous()`.

Puedes usar estas funciones auxiliares directamente en tus reglas de seguridad personalizadas o migraciones de base de datos:
```sql
CREATE POLICY owner_access ON posts
    FOR ALL
    TO public
    USING (author_id = rebase.uid() OR string_to_array(rebase.roles(), ',') && ARRAY['admin']);
```

## Tokens asimétricos y JWKS

Por defecto, los tokens de acceso se firman con `jwtSecret` (HS256). Eso funciona, pero
significa que cualquier entidad que necesite *verificar* un token debe poseer la clave que lo *emite* — por
lo que una pasarela (gateway) o un edge worker que verifique una sesión también podría falsificarlo — y
cambiar el secreto cierra la sesión de todos los usuarios de golpe.

Configura una clave de firma y Rebase firmará los tokens de acceso de forma asimétrica,
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

Genera una clave con:

```bash
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out jwt-key.pem
```

Las claves RSA también funcionan y firman con `RS256`; las claves EC P-256 firman con `ES256`. Solo
se configura la clave privada — la mitad pública se deriva de ella, por lo que el par no puede
estar desajustado. `jwtSecret` sigue siendo obligatorio en cualquier caso: aún firma los
tokens de propósito específico (enlaces de descarga, MFA pendiente, restablecimiento de contraseña) que solo
este servidor lee.

### Rotar una clave

Coloca la nueva clave en primer lugar y mantén la anterior en la lista. Los nuevos tokens se firmarán con
la nueva clave; los tokens ya en circulación continuarán verificándose contra la anterior hasta
que caduquen, evitando así que se cierren sesiones.

```typescript no-verify
signingKeys: [
    { kid: "2026-09", privateKey: process.env.JWT_PRIVATE_KEY_NEW! },
    { kid: "2026-08", privateKey: process.env.JWT_PRIVATE_KEY_OLD! }
]
```

Una vez que haya transcurrido el tiempo de vida más largo de los tokens de acceso, elimina la entrada antigua. Usa
`activeKid` si deseas publicar una clave antes de firmar con ella.

### Verificación en otros servicios

Los tokens incluyen el `kid` de la clave de firma en su cabecera, que es como un verificador
selecciona la clave correcta del JWKS y sabe cuándo volver a obtenerlas tras una
rotación. Cualquier biblioteca estándar hace esto por ti — por ejemplo, con `jose`:

```typescript no-verify
import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(new URL("https://api.example.com/.well-known/jwks.json"));
const { payload } = await jwtVerify(token, jwks);
```

:::note
Si no hay `signingKeys` configuradas, `/.well-known/jwks.json` responde
`{"keys":[]}` y los tokens continúan en HS256. Nada cambia hasta que agregas una clave.
:::

## Autenticación con Service Key

Para la comunicación de servidor a servidor (p. ej., tareas cron, servicios externos), configura una clave de servicio (service key) estática:

```typescript
auth: {
    serviceKey: process.env.REBASE_SERVICE_KEY,
    // ...
}
```

Los clientes se autentican mediante la cabecera `Authorization: Bearer <service-key>`. 

### Clave interna por arranque

Si no se proporciona `REBASE_SERVICE_KEY` en tu configuración, Rebase genera automáticamente una **clave interna aleatoria por arranque**. 

Esta clave nunca se registra en logs y nunca sale del proceso. El singleton `rebase` la utiliza para autenticarse contra las propias APIs del plano de control del servidor (auth, storage, etc.). Esto garantiza que las tareas administrativas (como enviar un correo de bienvenida o generar una URL de almacenamiento) siempre funcionen de forma predeterminada tanto en desarrollo como en producción sin requerir una gestión manual de claves.

### Protección contra ataques de temporización y requisitos de clave

Para prevenir ataques de temporización (timing attacks), Rebase valida tanto la service key configurada por el usuario como la clave interna mediante una comparación de cadenas en tiempo constante (`safeCompare`). La service key configurada por el usuario **debe tener al menos 32 caracteres de longitud**; si se configura una clave de menos de 32 caracteres, Rebase lanzará un error de configuración al iniciar y se cerrará por seguridad (fail-closed).

## Próximos pasos

- **[Autenticación](/docs/backend/authentication/)** — la configuración de la que proceden estas rutas
- **[Adaptadores de autenticación personalizados](/docs/backend/auth-adapters/)** — cómo reemplazar el proveedor detrás de ellas
- **[Reglas de seguridad (RLS)](/docs/collections/security-rules/)** — lo que hace una política con `rebase.uid()`
- **[Autenticación con el SDK tipado](/docs/sdk/authentication/)** — cómo llamar a estas rutas desde el SDK
