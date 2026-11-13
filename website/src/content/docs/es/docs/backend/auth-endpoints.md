---
sourceHash: 26d38afcbfd02569
title: Endpoints de autenticación y tokens
sidebar_label: Endpoints de autenticación
description: Las rutas de autenticación que monta el backend de Rebase, las estructuras de sus respuestas, autenticación multifactor, el contexto de base de datos que ve una directiva, JWKS y claves de servicio.
---

Las rutas que monta [el bloque `auth`](/docs/backend/authentication/) y los tokens que devuelven.

## Endpoints de autenticación

Todos los endpoints de autenticación están montados en `/api/auth/`:

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Crear una nueva cuenta |
| `POST` | `/api/auth/login` | Iniciar sesión con correo electrónico/contraseña |
| `POST` | `/api/auth/refresh` | Refrescar el token de acceso |
| `POST` | `/api/auth/<provider>` | Inicio de sesión OAuth (por ejemplo, `/api/auth/google`, `/api/auth/linkedin`) |
| `POST` | `/api/auth/link/<provider>` | Vincular un proveedor de OAuth a la cuenta autenticada. En un invitado esto cuenta como registro: requiere `allowRegistration`, toma la dirección del proveedor cuando este la avala y responde con una sesión para la cuenta en la que se convirtió el invitado |
| `POST` | `/api/auth/logout` | Revocar el token de actualización (refresh token) |
| `POST` | `/api/auth/forgot-password` | Enviar correo de restablecimiento de contraseña |
| `POST` | `/api/auth/reset-password` | Restablecer la contraseña con token |
| `POST` | `/api/auth/find-user` | Resolver un correo electrónico a un perfil público mínimo (opcional — `AUTH_ALLOW_USER_LOOKUP`) |
| `POST` | `/api/auth/change-password` | Cambiar la contraseña del propio emisor (autenticado). Finaliza todas las demás sesiones y responde con una nueva para el emisor |
| `GET` | `/api/auth/me` | El perfil del propio emisor |
| `PATCH` | `/api/auth/me` | Actualizar el perfil del propio emisor |
| `POST` | `/api/auth/change-email` | `{ newEmail }`: traslada la cuenta del propio emisor a otra dirección. Envía un enlace a la nueva dirección y un aviso a la anterior; nada cambia hasta que se accede al enlace. Requiere `aal2` en cuentas con un segundo factor. `409 EMAIL_EXISTS` o `UNDELIVERABLE_ADDRESS`, `400 EMAIL_UNCHANGED`, `403 ANONYMOUS_USER` para un invitado — consulta [Cambiar una dirección de correo electrónico](#cambiar-una-dirección-de-correo-electrónico) |
| `POST` | `/api/auth/confirm-email-change` | `{ token }` del enlace. No requiere sesión. Traslada la cuenta a la nueva dirección, verificada; `400 INVALID_TOKEN` para un enlace ya usado, reemplazado o caducado, `409 EMAIL_EXISTS` cuando la dirección fue tomada mientras esperaba |
| `GET` | `/api/auth/config` | Lo que este backend ofrece a una pantalla de inicio de sesión: `needsSetup`, `registrationEnabled`, `passwordReset`, `emailVerification`, `magicLink`, `anonymousLogin`, `adminPasswordReset`, `enabledProviders`, y `storage`, que indica si el backend sirve almacenamiento de archivos. No autenticado, y calculado a partir de los mismos predicados que aplican las rutas, por lo que lo anunciado por la pantalla no puede diferir de lo que realmente puede hacer |
| `POST` | `/api/auth/send-verification` | Enviar al emisor un enlace de verificación de correo electrónico |
| `GET` | `/api/auth/verify-email` | Consumir un enlace de verificación (la URL de ese correo). Conserva lo que prueba una sesión activa de la cuenta y elimina lo que nadie probó — consulta [Verificación de correo electrónico](/docs/backend/email-verification/) |
| `POST` | `/api/auth/verify-email` | Lo mismo con `{ token, password?, removeUnproven? }`: la contraseña lo conserva e inicia sesión; sin ninguna prueba, una cuenta que la requiera responde `409 PROOF_REQUIRED` |
| `POST` | `/api/auth/magic-link` | Enviar por correo electrónico un enlace de inicio de sesión de un solo uso. `503 EMAIL_NOT_CONFIGURED` sin SMTP |
| `POST` | `/api/auth/magic-link/verify` | Canjear un token de magic link por una sesión |
| `POST` | `/api/auth/otp` | Enviar por correo un código de inicio de sesión de seis dígitos. Responde lo mismo independientemente de si la dirección tiene una cuenta o no |
| `POST` | `/api/auth/otp/verify` | Canjear `{ email, code }` por una sesión |
| `POST` | `/api/auth/anonymous` | Crear una sesión anónima (opcional — `ALLOW_ANONYMOUS`) |
| `POST` | `/api/auth/anonymous/link` | Asociar credenciales reales a la cuenta anónima que ya inició sesión. Requiere tanto `allowAnonymous` como registro abierto: `403 ANONYMOUS_AUTH_DISABLED` una vez desactivado el inicio de sesión anónimo (incluidos los invitados que hayan iniciado sesión antes), y `403 REGISTRATION_DISABLED` mientras el registro esté cerrado |
| `GET` | `/api/auth/sessions` | Listar las sesiones activas del emisor, una por inicio de sesión. La del propio emisor está marcada con `isCurrentSession` |
| `DELETE` | `/api/auth/sessions` | Revocar todas las sesiones, incluida esta: cierre de sesión remoto en todos los dispositivos |
| `DELETE` | `/api/auth/sessions/:id` | Revocar una sesión: su refresh token y el token de acceso que posee ese dispositivo |
| `GET` | `/api/auth/scopes` | Todos los [ámbitos (scopes)](/docs/backend/roles-and-scopes/) que este backend conoce y los que posee el emisor |
| `GET` | `/api/auth/keys` | Las [claves de API personales](/docs/backend/api-keys/#personal-keys) del propio emisor |
| `POST` | `/api/auth/keys` | Crear una clave personal. `403 PERSONAL_KEYS_DISABLED` a menos que la colección users defina `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | Revocar una de las claves del propio emisor |
| `GET` | `/.well-known/jwks.json` | El JWKS público: montado en la raíz, no bajo `basePath`, porque ahí es donde busca un verificador. Se monta siempre que el backend genera sus propios tokens; un conjunto de claves vacío hasta que se configure el [firmado asimétrico](#tokens-asimétricos-y-jwks) |
| `POST` | `/api/auth/mfa/enroll` | Iniciar el registro de TOTP (devuelve el secreto y los códigos de recuperación) |
| `POST` | `/api/auth/mfa/verify` | Confirmar un registro con un código del autenticador |
| `GET` | `/api/auth/mfa/factors` | Listar los factores registrados del emisor |
| `POST` | `/api/auth/mfa/challenge` | Abrir un desafío frente a un factor verificado |
| `POST` | `/api/auth/mfa/challenge/verify` | Responder a un desafío: esto es lo que emite la sesión |
| `DELETE` | `/api/auth/mfa/unenroll` | Eliminar un factor (requiere una sesión `aal2` una vez que la cuenta tenga un factor verificado) |
| `POST` | `/api/auth/mfa/recovery-codes` | Reemplazar los códigos de recuperación del emisor con diez nuevos (requiere una sesión `aal2`) |

La administración de usuarios y roles es una **superficie independiente**, montada en
`/api/admin/` en lugar de `/api/auth/`. La lectura requiere el ámbito `users:read` y
la modificación requiere `users:write`, excepto la lectura restringida del selector de usuarios que se detalla a continuación. Un administrador y la clave de servicio poseen ambos; también cualquier
rol que los declare. Nadie puede modificar una cuenta que tenga más privilegios que
uno mismo. Consulta [Roles y ámbitos](/docs/backend/roles-and-scopes/).

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/admin/users` | Listar usuarios (paginado). `?search=` busca coincidencias sin distinción de mayúsculas y minúsculas en el correo electrónico o el nombre para mostrar. También coincide con cualquier rol que tenga el usuario y el uid |
| `GET` | `/api/admin/users/pick` | La lectura del selector de usuarios: `uid`, `displayName`, `email` y `photoURL` por usuario, nada más. Admite `?search=`, `?limit=` (25 por defecto) y `?offset=`, o `?ids=a,b` para los usuarios que nombra un valor almacenado. Responde a `users:read`, y también a cualquiera que pueda escribir en una colección con un campo [`userSelect`](/docs/collections/properties/) (para que un editor pueda completarlo). Una regla escrita en SQL puro (`using` / `withCheck` que el modelo de políticas no puede interpretar) no se puede evaluar por adelantado, por lo que aquí cuenta como rechazo: en dicha colección solo los poseedores de `users:read` pueden seleccionar. Cualquier otro usuario recibe `403 SCOPE_MISSING` |
| `POST` | `/api/admin/users` | Crear un usuario |
| `GET` | `/api/admin/users/:uid` | Leer un usuario |
| `PUT` | `/api/admin/users/:uid` | Actualizar un usuario. `{ disabled: true }` desactiva la cuenta sin eliminarla: se rechaza cada inicio de sesión y actualización (`ACCOUNT_DISABLED`), sus sesiones finalizan y se rechaza cada token que posea; `false` la vuelve a activar |
| `DELETE` | `/api/admin/users/:uid` | Eliminar un usuario. Sus sesiones finalizan y cada token de acceso que posea es rechazado a partir de esa petición |
| `POST` | `/api/admin/users/:uid/reset-password` | Restablecer la contraseña de un usuario sin requerir la actual. `rebase auth reset-password` lo invoca y escribe directamente en la base de datos solo cuando no se puede acceder al backend; de cualquier forma, las sesiones de la cuenta finalizan |
| `DELETE` | `/api/admin/users/:uid/mfa` | Eliminar los segundos factores y códigos de recuperación de un usuario, y finalizar sus sesiones (para alguien que perdió ambos) |
| `GET` | `/api/admin/roles` | `admin` y los roles que declara la colección users, con sus ámbitos |
| `POST` | `/api/admin/bootstrap` | Permitir que el primer usuario registrado asuma el rol de admin mientras no exista ninguno. Rechazado en producción — consulta [Inicialización del primer usuario](/docs/backend/authentication/#first-user-bootstrap) |

Todos los endpoints de la API de datos requieren una cabecera `Authorization: Bearer <token>` válida cuando `requireAuth: true` (el valor predeterminado).

### Política de contraseñas

Una nueva contraseña necesita al menos 8 caracteres, con una letra mayúscula, una
letra minúscula y un dígito. El registro, restablecimiento y cambio rechazan las que no cumplan con
`400 WEAK_PASSWORD`, detallando cada regla incumplida; lo mismo ocurre cuando un
administrador elige una contraseña: `POST /api/admin/users`, una creación en la
colección users mediante la API de datos (`POST /api/data/users`, su `/bulk`, una
escritura por socket o MCP), `PUT /api/admin/users/:uid` y
`POST /api/admin/users/:uid/reset-password`. En un `/bulk`, el mensaje comienza con
`Row <n>: ` (contando desde 0), al igual que los demás errores por fila del bulk.

Para crear cuentas cuyas contraseñas fueron definidas por otro sistema, como en una importación, envía
`skipPasswordPolicy: true` en el cuerpo de creación (en cada fila de un `/bulk`). El
servidor solo lo respeta para un administrador o la clave de servicio; para cualquier
otro no omite nada y el rechazo así lo indica. Nunca se almacena. La importación del panel de
administración lo envía para cada fila que incluya `password`. El inicio de sesión
nunca comprueba la política, por lo que una contraseña antigua seguirá funcionando. Para definir tus propias reglas, pasa
`auth.hooks.validatePasswordStrength` desde un backend [expulsado (ejected)](/docs/backend/authentication/#configuration).
El primer administrador inicializado desde `REBASE_ADMIN_PASSWORD` se rige por una
regla diferente: al menos 12 caracteres, y nada más.

### Formato de respuesta

Cada endpoint que emite una sesión responde con la misma estructura envoltorio: `register`,
`login`, cada proveedor de OAuth, `magic-link/verify`, `otp/verify`, `anonymous`,
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
`accessTokenExpiresAt` está expresado en milisegundos de la época Unix.

`POST /api/auth/refresh` responde con la misma estructura, salvo que `user` se
omite por completo cuando no es posible volver a leer la cuenta, por lo que debes tratarlo como opcional
allí.

`providerId` indica cómo se inició la sesión: `password`, `anonymous`,
`magic-link`, `otp`, `mfa` (un inicio de sesión completado con un segundo factor) o el
id del proveedor, como `google`. Se almacena con la sesión al iniciar sesión, por lo que
`refresh` y `GET /api/auth/me` ofrecen la misma respuesta durante toda la vida útil de la
sesión. Una sesión iniciada antes de la versión 0.24 devuelve `password`.

:::caution[El SDK tipado aplana esta estructura; HTTP puro no]
El JSON anterior es el formato transmitido por la red (wire format), y es lo que devuelve `fetch("/api/auth/login")`:
el token se encuentra en **`body.tokens.accessToken`**.

El [SDK tipado](/docs/sdk/authentication) desenvuelve `tokens` antes de devolver la
sesión, por lo que `auth.signInWithEmail()` se resuelve en su lugar en un objeto aplanado
**`{ user, accessToken, refreshToken }`**.

Ambas estructuras son reales; pertenecen a dos capas diferentes. Intentar leer la
forma del SDK a partir de un `fetch` directo produce `undefined`, lo que se manifiesta como "el inicio de sesión tuvo éxito
pero no hay token de acceso" — el inicio de sesión fue correcto, el token estaba un nivel más abajo.
:::

### Cambiar una dirección de correo electrónico

Un usuario que ha iniciado sesión traslada su propia cuenta a otra dirección en dos pasos:

1. `POST /api/auth/change-email { newEmail }` registra el cambio y envía un
   enlace, `<frontend>/confirm-email-change?token=…`, a la nueva dirección, y un
   aviso sin enlace a la actual. El enlace dura 24 horas y una
   nueva solicitud reemplaza a la anterior. `GET /api/auth/me` informa la
   dirección en espera como `pendingEmail`.
2. `POST /api/auth/confirm-email-change { token }` traslada la cuenta: la nueva
   dirección se convierte en su dirección, verificada. Cada identidad OAuth cuyo proveedor
   haya avalado la dirección anterior se desvincula (`removedProviders` las enumera),
   porque de lo contrario quien controle la dirección anterior aún podría iniciar sesión
   a través de ella, y cualquier enlace de restablecimiento enviado a la dirección anterior deja de funcionar.
   Las sesiones se mantienen.

La nueva dirección no se reserva mientras el enlace espera: retenerla permitiría a cualquier
cuenta impedir que un desconocido se registre con su propia dirección. Si otra
cuenta ya tiene la dirección en el momento en que se accede al enlace, este responde
`409 EMAIL_EXISTS` y nada cambia; de dos cuentas que soliciten la misma
dirección, la primera en seguir su enlace la obtiene. El hook `beforeEmailChange` puede
rechazar una dirección, tal como lo hace `beforeUserCreate` en el registro.

En el CMS, la dirección se cambia desde **Configuración de la cuenta → Perfil** (Account settings → Profile), y el
enlace abre la propia pantalla del CMS, con la sesión iniciada o no. Otro frontend puede servir una página
en `/confirm-email-change` que llame a la ruta con el token del enlace.

Con [`cookieAuth`](/docs/backend/authentication/#refresh-tokens-in-an-httponly-cookie) activado (el valor predeterminado), el refresh
token viaja como una cookie `httpOnly` y `tokens.refreshToken` es una cadena vacía
en el cuerpo. El token de acceso no se ve afectado.

### Autenticación multifactor (TOTP)

**Un segundo factor restringe el inicio de sesión, no solo operaciones individuales.** Una vez que una
cuenta tiene un factor TOTP *verificado*, ninguna ruta le emitirá una sesión hasta que se
presente un código; el inicio de sesión con contraseña, cada proveedor de OAuth, magic link,
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

`mfaToken` **no es una sesión**: tiene un propósito delimitado (purpose-scoped), expira en cinco minutos
y es rechazado por todas las rutas autenticadas. Envíalo como token de portador (bearer token) a
`POST /api/auth/mfa/challenge` (con un `factorId`) y luego a
`POST /api/auth/mfa/challenge/verify` (con el `challengeId` y el código de seis dígitos,
o un código de recuperación). Esa última llamada es la que genera los tokens de acceso y actualización,
en el nivel `aal2`; el nivel se almacena en la sesión y se mantiene a través de
`POST /api/auth/refresh`.

El registro también está protegido. El primer factor de una cuenta puede registrarse desde una
sesión ordinaria, pero una vez verificado uno, `enroll`, `verify` y `unenroll`
requieren una sesión `aal2`; de lo contrario, una contraseña robada podría registrar un
factor propio, elevar privilegios con él y eliminar el auténtico.

La verificación está delimitada en ambos sentidos: un desafío expira tras cinco intentos
fallidos, cada cuenta está limitada a diez intentos de verificación cada 15 minutos
(contabilizados por usuario, por lo que rotar de IP no ayuda) y un código aceptado se
registra contra el factor para que no pueda reproducirse durante el resto de su
ventana de ±1 paso.

En la tabla de usuarios del CMS, **Restablecer la verificación en dos pasos**
(`DELETE /api/admin/users/:uid/mfa`) y **Desactivar o activar cuenta**
(`PUT /api/admin/users/:uid { disabled }`) se ofrecen a quien posea
`users:write`, tal como ocurre con las rutas; la opción nunca se ofrece para tu propia
cuenta, y una cuenta con mayor rango que el tuyo se rechazará con el motivo indicado por el servidor.

Define `MFA_ENCRYPTION_KEY` (más de 32 caracteres aleatorios) para cifrar los
secretos de TOTP almacenados. Sin ella, el servidor recurre a `JWT_SECRET` y emite una advertencia. Configúrala
**antes** de que nadie se registre: los secretos almacenados no incluyen identificador de clave, por lo que cambiar la clave
posteriormente dejará los factores existentes indescifrables y sus propietarios no podrán
completar un desafío.

### Invitar a compañeros de equipo por correo electrónico

Los flujos de invitación necesitan convertir una dirección de correo electrónico en un ID de usuario, pero la
colección `users` está protegida por RLS frente al cliente. En lugar de crear manualmente una función de
servidor administrativa, activa la búsqueda integrada:

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

El endpoint es **solo para usuarios autenticados** y devuelve únicamente `uid`, `displayName`,
y `photoURL` — nunca el correo electrónico, los roles o los metadatos del usuario consultado. Está
**desactivado por defecto** porque permite a cualquier usuario que haya iniciado sesión sondear qué correos electrónicos tienen
cuentas; actívalo solo cuando la experiencia de usuario (UX) de invitación lo requiera.

## Contexto de base de datos para Row-Level Security (RLS)

Rebase conecta la autenticación de las solicitudes directamente con Row-Level Security (RLS) de PostgreSQL. Cada consulta a la base de datos ejecutada a través de un controlador delimitado por usuario se ejecuta dentro de una transacción de base de datos (`db.transaction()`) que define parámetros de configuración locales a la transacción:

*   `app.uid` — El ID único (`uid`) del usuario autenticado. Su valor predeterminado es `'anonymous'` para solicitudes no autenticadas. El valor anterior al cambio de nombre, `app.user_id`, todavía se escribe junto a este para las políticas compiladas antes del renombramiento.
*   `app.user_roles` — Una cadena separada por comas que lista los roles asignados al usuario.
*   `app.is_anonymous` — `'true'` para una sesión de invitado (inicio de sesión anónimo), `'false'` en caso contrario.
*   `app.jwt` — Una cadena JSON con los claims personalizados del token además de `sub`, `roles` y `is_anonymous` (`{"sub": "<uid>", "roles": [...], "is_anonymous": false, …}`).

Estos parámetros se configuran localmente durante la transacción mediante la función `set_config` de Postgres:
```sql
SELECT 
    set_config('app.uid', $1, true),
    set_config('app.user_id', $1, true),
    set_config('app.user_roles', $2, true),
    set_config('app.is_anonymous', $3, true),
    set_config('app.jwt', $4, true);
```

### Funciones auxiliares para políticas de PostgreSQL

Para simplificar la escritura de políticas de Row-Level Security, Rebase crea funciones auxiliares bajo el esquema `rebase` durante la inicialización de la base de datos:

*   **`rebase.uid()`** — Devuelve el ID del usuario autenticado como `text`, o `NULL` si no está definido:
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
*   **`rebase.jwt()`** — Devuelve el payload completo del JWT como un objeto `jsonb`:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.jwt() RETURNS jsonb AS $$
        SELECT COALESCE(NULLIF(current_setting('app.jwt', true), ''), '{}')::jsonb;
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.is_anonymous()`** — Indica si el emisor es un invitado, como `boolean` (`false` cuando no está definido), de modo que una política pueda especificar `NOT rebase.is_anonymous()`.

Puedes usar estas funciones auxiliares directamente en tus reglas de seguridad personalizadas o migraciones de base de datos:
```sql
CREATE POLICY owner_access ON posts
    FOR ALL
    TO public
    USING (author_id = rebase.uid() OR string_to_array(rebase.roles(), ',') && ARRAY['admin']);
```

## Tokens asimétricos y JWKS

De forma predeterminada, los tokens de acceso se firman con `jwtSecret` (HS256). Esto funciona, pero
implica que cualquier elemento que necesite *verificar* un token debe poseer la clave que lo *emite*
— por lo que una pasarela (gateway) o un edge worker que compruebe una sesión también podría falsificarla —, y
cambiar el secreto cierra la sesión de todos los usuarios a la vez.

Configura una clave de firma y Rebase firmará los tokens de acceso de manera asimétrica,
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

O desde el entorno, para una sola clave:

```bash
JWT_PRIVATE_KEY="$(cat jwt-key.pem)"
JWT_KEY_ID=2026-08
```

Genera una clave con:

```bash
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out jwt-key.pem
```

Las claves RSA también funcionan y firman con `RS256`; las claves EC P-256 firman con `ES256`. Solo se
configura la clave privada — la mitad pública se deriva de ella, por lo que el par nunca puede
desajustarse. `jwtSecret` sigue siendo obligatorio en cualquier caso: todavía firma los
tokens de propósito específico (enlaces de descarga, MFA pendiente, restablecimiento de contraseña) que
solo este servidor lee.

### Rotación de claves

Coloca la nueva clave en primer lugar y mantén la anterior en la lista. Los nuevos tokens se firmarán con
la nueva clave; los tokens que ya están en circulación seguirán verificándose con la anterior hasta
que caduquen, evitando que se cierre la sesión de los usuarios.

```typescript no-verify
signingKeys: [
    { kid: "2026-09", privateKey: process.env.JWT_PRIVATE_KEY_NEW! },
    { kid: "2026-08", privateKey: process.env.JWT_PRIVATE_KEY_OLD! }
]
```

Una vez transcurrido el tiempo de vida más largo de un token de acceso, elimina la entrada antigua. Usa
`activeKid` si deseas publicar una clave antes de empezar a firmar con ella.

### Verificación en otros sistemas

Los tokens incluyen el `kid` de la clave de firma en su cabecera, que es cómo un verificador
selecciona la clave correcta del JWKS y cómo sabe cuándo volver a obtenerla tras
una rotación. Cualquier biblioteca estándar hace esto por ti; por ejemplo, con `jose`:

```typescript no-verify
import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(new URL("https://api.example.com/.well-known/jwks.json"));
const { payload } = await jwtVerify(token, jwks);
```

:::note
Sin `signingKeys` configuradas, `/.well-known/jwks.json` responde
`{"keys":[]}` y los tokens se mantienen en HS256. Nada cambia hasta que agregues una clave.
:::

## Autenticación mediante clave de servicio

Para la comunicación servidor a servidor (p. ej., tareas cron, servicios externos), configura una clave de servicio estática:

```typescript
auth: {
    serviceKey: process.env.REBASE_SERVICE_KEY,
    // ...
}
```

Los clientes se autentican mediante la cabecera `Authorization: Bearer <service-key>`. 

### Clave interna por arranque

Si no se proporciona `REBASE_SERVICE_KEY` en tu configuración, Rebase genera automáticamente una **clave interna por arranque** aleatoria. 

Esta clave nunca se registra en logs y nunca sale del proceso. La instancia singleton de `rebase` la utiliza para autenticarse frente a las API del plano de control del propio servidor (auth, storage, etc.). Esto garantiza que las tareas administrativas (como enviar un correo de bienvenida o generar una URL de almacenamiento) funcionen siempre de serie tanto en desarrollo como en producción sin necesidad de gestionar claves manualmente.

### Protección contra ataques de temporización y requisitos de clave

Para prevenir ataques de temporización (timing attacks), Rebase valida tanto la clave de servicio configurada por el usuario como la clave interna mediante comparación de cadenas en tiempo constante (`safeCompare`). La clave de servicio configurada por el usuario **debe tener al menos 32 caracteres de longitud**; si se configura una clave con menos de 32 caracteres, Rebase arrojará un error de configuración al inicio y fallará bloqueando el acceso (fail-closed).

## Siguientes pasos

- **[Autenticación](/docs/backend/authentication/)** — la configuración de donde provienen estas rutas
- **[Adaptadores de autenticación personalizados](/docs/backend/auth-adapters/)** — sustitución del proveedor detrás de ellas
- **[Reglas de seguridad (RLS)](/docs/collections/security-rules/)** — lo que hace una directiva con `rebase.uid()`
- **[Autenticación con el SDK tipado](/docs/sdk/authentication/)** — cómo llamar a estas rutas desde el SDK
