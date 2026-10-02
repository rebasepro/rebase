---
sourceHash: 8b15e7eb390a6548
title: Endpoints y tokens de autenticación
sidebar_label: Endpoints de autenticación
description: Las rutas de autenticación que monta el backend de Rebase, las estructuras de sus respuestas, autenticación multifactor, el contexto de base de datos que ve una directiva, JWKS y claves de servicio.
---

Las rutas que monta [el bloque `auth`](/docs/backend/authentication/) y los tokens que devuelven.

## Endpoints de autenticación

Todos los endpoints de autenticación están montados en `/api/auth/`:

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Crear una nueva cuenta |
| `POST` | `/api/auth/login` | Iniciar sesión con correo/contraseña |
| `POST` | `/api/auth/refresh` | Refrescar el token de acceso |
| `POST` | `/api/auth/<provider>` | Inicio de sesión con OAuth (p. ej., `/api/auth/google`, `/api/auth/linkedin`) |
| `POST` | `/api/auth/link/<provider>` | Vincular un proveedor de OAuth a la cuenta autenticada. En un invitado esto es un registro: necesita `allowRegistration`, toma la dirección del proveedor cuando este la avala, y responde con una sesión para la cuenta en la que se convirtió el invitado |
| `POST` | `/api/auth/logout` | Revocar el token de actualización (refresh token) |
| `POST` | `/api/auth/forgot-password` | Enviar correo de restablecimiento de contraseña |
| `POST` | `/api/auth/reset-password` | Restablecer contraseña con token |
| `POST` | `/api/auth/find-user` | Resolver un correo a un perfil público mínimo (opcional — `AUTH_ALLOW_USER_LOOKUP`) |
| `POST` | `/api/auth/change-password` | Cambiar la contraseña del propio usuario emisor (autenticado). Termina todas las demás sesiones y responde con una nueva para el emisor |
| `GET` | `/api/auth/me` | El perfil del propio usuario emisor |
| `PATCH` | `/api/auth/me` | Actualizar el perfil del propio usuario emisor |
| `POST` | `/api/auth/change-email` | `{ newEmail }`: mover la propia cuenta del emisor a otra dirección. Envía un enlace por correo a la dirección nueva y un aviso a la antigua; nada cambia hasta que se sigue el enlace. Necesita `aal2` en una cuenta con un segundo factor. `409 EMAIL_EXISTS` o `UNDELIVERABLE_ADDRESS`, `400 EMAIL_UNCHANGED`, `403 ANONYMOUS_USER` para un invitado — consulta [Cambiar una dirección de correo](#cambiar-una-dirección-de-correo) |
| `POST` | `/api/auth/confirm-email-change` | `{ token }` del enlace. No se necesita sesión. Mueve la cuenta a la dirección nueva, verificada; `400 INVALID_TOKEN` para un enlace consumido, sustituido o caducado, `409 EMAIL_EXISTS` cuando la dirección fue tomada mientras esperaba |
| `GET` | `/api/auth/config` | Lo que este backend ofrece a una pantalla de inicio de sesión — `needsSetup`, `registrationEnabled`, `passwordReset`, `emailVerification`, `magicLink`, `anonymousLogin`, `adminPasswordReset`, `enabledProviders`. No autenticado, y calculado a partir de los mismos predicados que aplican las rutas, por lo que lo anunciado en la pantalla no puede diferir de lo que realmente puede hacer |
| `POST` | `/api/auth/send-verification` | Enviar al usuario emisor un enlace de verificación de correo |
| `GET` | `/api/auth/verify-email` | Consumir un enlace de verificación (la URL de ese correo). Conserva lo que demuestra una sesión activa de la cuenta y elimina lo que nadie demostró — consulta [Verificación de correo electrónico](/docs/backend/email-verification/) |
| `POST` | `/api/auth/verify-email` | Lo mismo con `{ token, password?, removeUnproven? }`: la contraseña la conserva e inicia sesión; sin ninguna de las dos pruebas, una cuenta que tenga una responde `409 PROOF_REQUIRED` |
| `POST` | `/api/auth/magic-link` | Enviar por correo un enlace de inicio de sesión de un solo uso. `503 EMAIL_NOT_CONFIGURED` sin SMTP |
| `POST` | `/api/auth/magic-link/verify` | Intercambiar un token de magic link por una sesión |
| `POST` | `/api/auth/otp` | Enviar por correo un código de inicio de sesión de seis dígitos. Responde de la misma manera tenga o no una cuenta la dirección |
| `POST` | `/api/auth/otp/verify` | Intercambiar `{ email, code }` por una sesión |
| `POST` | `/api/auth/anonymous` | Crear una sesión anónima (opcional — `ALLOW_ANONYMOUS`) |
| `POST` | `/api/auth/anonymous/link` | Asociar credenciales reales a la cuenta anónima que ya ha iniciado sesión |
| `GET` | `/api/auth/sessions` | Listar las sesiones activas del usuario emisor, una por cada inicio de sesión. La propia del emisor está marcada con `isCurrentSession` |
| `DELETE` | `/api/auth/sessions` | Revocar todas las sesiones, incluida esta — cierre de sesión remoto en todos los dispositivos |
| `DELETE` | `/api/auth/sessions/:id` | Revocar una sesión: su refresh token, y el token de acceso que tiene ese dispositivo |
| `GET` | `/api/auth/scopes` | Todos los [alcances](/docs/backend/roles-and-scopes/) que conoce este backend y los que tiene el emisor |
| `GET` | `/api/auth/keys` | Las [claves de API personales](/docs/backend/api-keys/#personal-keys) propias del emisor |
| `POST` | `/api/auth/keys` | Crear una clave personal. `403 PERSONAL_KEYS_DISABLED` salvo que la colección de usuarios establezca `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | Revocar una de las claves propias del emisor |
| `GET` | `/.well-known/jwks.json` | El JWKS público — montado en la raíz, no bajo `basePath`, porque allí es donde busca un verificador. Presente cuando se configura la [firma asimétrica](#tokens-asimétricos-y-jwks) |
| `POST` | `/api/auth/mfa/enroll` | Iniciar el registro de TOTP (devuelve el secreto y los códigos de recuperación) |
| `POST` | `/api/auth/mfa/verify` | Confirmar un registro con un código del autenticador |
| `GET` | `/api/auth/mfa/factors` | Listar los factores registrados del usuario emisor |
| `POST` | `/api/auth/mfa/challenge` | Abrir un desafío (challenge) contra un factor verificado |
| `POST` | `/api/auth/mfa/challenge/verify` | Responder a un desafío — esto es lo que emite la sesión |
| `DELETE` | `/api/auth/mfa/unenroll` | Eliminar un factor (requiere una sesión `aal2`) |
| `POST` | `/api/auth/mfa/recovery-codes` | Sustituir los códigos de recuperación del emisor por diez nuevos (requiere una sesión `aal2`) |

La gestión administrativa de usuarios y roles es una **superficie independiente**, montada en `/api/admin/` en lugar de `/api/auth/`. Leer necesita el alcance `users:read` y cambiar necesita `users:write`. Un administrador y la clave de servicio tienen ambos; también los tiene un rol que los declare. Nadie puede cambiar una cuenta que tenga más que él. Consulte [Roles y alcances](/docs/backend/roles-and-scopes/).

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/admin/users` | Listar usuarios (paginado) |
| `POST` | `/api/admin/users` | Crear un usuario |
| `GET` | `/api/admin/users/:uid` | Leer un usuario |
| `PUT` | `/api/admin/users/:uid` | Actualizar un usuario. `{ disabled: true }` deshabilita la cuenta sin eliminarla: todo inicio de sesión y toda renovación se rechazan (`ACCOUNT_DISABLED`), sus sesiones terminan y se rechaza todo token que tenga; `false` la vuelve a habilitar |
| `DELETE` | `/api/admin/users/:uid` | Eliminar un usuario. Sus sesiones terminan, y a partir de esa solicitud se rechaza todo token de acceso que tenga |
| `POST` | `/api/admin/users/:uid/reset-password` | Restablecer la contraseña de un usuario sin su contraseña actual. `rebase auth reset-password` la llama, y escribe directamente en la base de datos solo cuando no se puede contactar al backend; de cualquier modo, las sesiones de la cuenta terminan |
| `DELETE` | `/api/admin/users/:uid/mfa` | Eliminar los segundos factores y los códigos de recuperación de un usuario, y terminar sus sesiones — para alguien que perdió ambos |
| `GET` | `/api/admin/roles` | `admin` y los roles que declara la colección de usuarios, con sus alcances |
| `POST` | `/api/admin/bootstrap` | Permitir que el primer usuario registrado reclame el rol de administrador mientras no exista ninguno. Rechazado en producción — consulte [First User Bootstrap](/docs/backend/authentication/#first-user-bootstrap) |

Todos los endpoints de la API de datos requieren una cabecera `Authorization: Bearer <token>` válida cuando `requireAuth: true` (el valor predeterminado).

### Formato de respuesta

Cada endpoint que emite una sesión responde con la misma estructura contenedora (envelope) — `register`, `login`, cada proveedor de OAuth, `magic-link/verify`, `otp/verify`, `anonymous`, `anonymous/link` y `mfa/challenge/verify`:

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

Envíe el token de acceso devuelto como `Authorization: Bearer <accessToken>`. `accessTokenExpiresAt` se expresa en milisegundos de época (epoch milliseconds).

`POST /api/auth/refresh` responde con la misma estructura, salvo que `user` se omite por completo cuando la cuenta no se puede volver a leer, por lo que debe tratarse como opcional en ese caso.

`providerId` indica cómo se inició la sesión: `password`, `anonymous`, `magic-link`, `otp`, `mfa` (un inicio de sesión completado con un segundo factor), o el id del proveedor, como `google`. Se almacena junto con la sesión al iniciarla, por lo que `refresh` y `GET /api/auth/me` dan la misma respuesta durante toda la vida de la sesión. Una sesión iniciada antes de 0.24 muestra `password`.

:::caution[El SDK tipado aplana esta estructura contenedora — HTTP sin procesar no]
El JSON anterior es el formato de transmisión (wire format), y es lo que devuelve `fetch("/api/auth/login")`: el token reside en **`body.tokens.accessToken`**.

El [SDK tipado](/docs/sdk/authentication) desempaqueta `tokens` antes de devolver la sesión, por lo que `auth.signInWithEmail()` se resuelve en su lugar en un objeto aplanado **`{ user, accessToken, refreshToken }`**.

Ambas estructuras son reales; pertenecen a dos capas distintas. Intentar leer la forma del SDK a partir de un `fetch` directo arroja `undefined`, lo que se manifiesta como "el inicio de sesión tuvo éxito pero no hay token de acceso" — el inicio de sesión fue correcto, pero el token estaba un nivel más abajo.
:::

### Cambiar una dirección de correo

<span class="since-badge" data-since="0.24">Desde 0.24</span> Una persona con
la sesión iniciada mueve su propia cuenta a otra dirección en dos pasos:

1. `POST /api/auth/change-email { newEmail }` registra el cambio y envía por
   correo un enlace, `<frontend>/confirm-email-change?token=…`, a la dirección
   nueva, y un aviso sin enlace a la actual. El enlace vive 24 horas, y una
   solicitud nueva sustituye a la anterior. `GET /api/auth/me` informa la
   dirección en espera como `pendingEmail`.
2. `POST /api/auth/confirm-email-change { token }` mueve la cuenta: la
   dirección nueva se convierte en su dirección, verificada. Cada identidad
   OAuth cuyo proveedor avaló la dirección antigua se desvincula
   (`removedProviders` las nombra), porque de otro modo quien controle la
   dirección antigua podría seguir iniciando sesión con ella, y cualquier
   enlace de restablecimiento enviado a la dirección antigua deja de
   funcionar. Las sesiones se conservan.

La dirección nueva no queda reservada mientras el enlace espera: retenerla
dejaría que cualquier cuenta impidiera que un desconocido se registrara con su
propia dirección. Si otra cuenta tiene esa dirección cuando se sigue el
enlace, el enlace responde `409 EMAIL_EXISTS` y nada se mueve; de dos cuentas
que pidan la misma dirección, se la lleva la primera que siga su enlace. El
hook `beforeEmailChange` puede rechazar una dirección, igual que
`beforeUserCreate` lo hace en el registro.

En el CMS, la dirección se cambia desde **Configuración de la cuenta → Perfil**,
y el enlace abre la propia pantalla del CMS, con o sin sesión iniciada. Otro
frontend sirve una página en `/confirm-email-change` que llama a la ruta con
el token del enlace.

Con [`cookieAuth`](/docs/backend/authentication/#refresh-tokens-in-an-httponly-cookie) habilitado, el token de actualización viaja como una cookie `httpOnly` y `tokens.refreshToken` es una cadena vacía en el cuerpo de la respuesta. El token de acceso no se ve afectado.

### Autenticación multifactor (TOTP)

**Un segundo factor condiciona el inicio de sesión, no solo operaciones individuales.** Una vez que una cuenta tiene un factor TOTP *verificado*, ninguna ruta le emitirá una sesión hasta que se presente un código; el inicio de sesión con contraseña, cada proveedor de OAuth, magic link y anonymous-link se rechazan con `401 MFA_REQUIRED`:

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

`mfaToken` **no es una sesión**: tiene un alcance específico, expira en cinco minutos y es rechazado por todas las rutas autenticadas. Envíelo como token de portador (bearer token) a `POST /api/auth/mfa/challenge` (con un `factorId`) y luego a `POST /api/auth/mfa/challenge/verify` (con el `challengeId` y el código de seis dígitos, o un código de recuperación). Esa última llamada es la que genera los tokens de acceso y actualización, en `aal2`; dicho nivel se almacena en la sesión y se mantiene a través de `POST /api/auth/refresh`.

El registro de factores también está restringido. El primer factor en una cuenta puede registrarse desde una sesión ordinaria, pero una vez que uno es verificado, `enroll`, `verify` y `unenroll` requieren una sesión `aal2`; de lo contrario, una contraseña robada podría registrar un factor propio, elevar privilegios con él y eliminar el factor real.

La verificación está acotada en ambos ejes: un desafío expira tras cinco intentos fallidos, cada cuenta está limitada a diez intentos de verificación cada 15 minutos (contabilizados por usuario, por lo que rotar direcciones IP no sirve de nada) y un código aceptado se registra contra el factor para que no pueda reutilizarse durante el resto de su ventana de tolerancia de ±1 paso.

<span class="since-badge" data-since="0.24">Desde 0.24</span> En el CMS, **Configuración de la cuenta → Verificación en dos pasos** registra una
app de autenticación (su clave, y un enlace que la abre en la app, y luego el
código que muestra), lista los factores de la cuenta, elimina uno y sustituye
los códigos de recuperación. Cuando un cambio necesita `aal2`, primero pide un
código y con él eleva el nivel de la sesión. Los códigos de recuperación se
muestran una sola vez, tras confirmar el primer factor. En la tabla de
usuarios, **Restablecer verificación en dos pasos**
(`DELETE /api/admin/users/:uid/mfa`) y **Deshabilitar o habilitar cuenta**
(`PUT /api/admin/users/:uid { disabled }`) se ofrecen a quien tenga
`users:write`, igual que las rutas; el interruptor nunca se ofrece sobre la
propia cuenta, y una cuenta que tiene más que tú se rechaza con el motivo del
servidor.

Configure `MFA_ENCRYPTION_KEY` (32+ caracteres aleatorios) para cifrar los secretos TOTP almacenados. Sin ella, el servidor recurre a `JWT_SECRET` y emite una advertencia. Configúrela **antes** de que cualquier usuario se registre: los secretos almacenados no llevan ningún ID de clave, por lo que cambiar la clave a posteriori hace que los factores existentes no se puedan descifrar y sus propietarios no puedan completar un desafío.

### Invitar a miembros del equipo por correo electrónico

Los flujos de invitación necesitan convertir una dirección de correo electrónico en un ID de usuario, pero la colección `users` está protegida por RLS frente al cliente. En lugar de crear manualmente una función de servidor administrativa, active la búsqueda integrada:

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

El endpoint es **solo para usuarios autenticados** y devuelve únicamente `uid`, `displayName` y `photoURL` — nunca el correo, roles o metadatos del usuario consultado. Está **desactivado por defecto** porque permite a cualquier usuario autenticado sondear qué correos tienen cuenta; actívelo únicamente cuando la experiencia de usuario (UX) de sus invitaciones lo requiera.

## Contexto de base de datos de Row-Level Security (RLS)

Rebase conecta la autenticación de las solicitudes directamente con Row-Level Security (RLS) de PostgreSQL. Cada consulta a la base de datos ejecutada a través de un controlador (driver) con ámbito de usuario se ejecuta dentro de una transacción de base de datos (`db.transaction()`) que establece parámetros de configuración locales para la transacción:

*   `app.user_id` — El ID único (`uid`) del usuario autenticado. Por defecto es `'anon'` para solicitudes no autenticadas.
*   `app.user_roles` — Una cadena separada por comas que lista los roles asignados al usuario.
*   `app.jwt` — Una cadena JSON que contiene el payload completo de claims del JWT (`{"sub": "<uid>", "roles": [...]}`).

Estos parámetros se configuran localmente durante la duración de la transacción mediante la función `set_config` de Postgres:
```sql
SELECT 
    set_config('app.user_id', $1, true),
    set_config('app.user_roles', $2, true),
    set_config('app.jwt', $3, true);
```

### Funciones auxiliares para políticas de PostgreSQL

Para simplificar la redacción de políticas de Row-Level Security, Rebase crea funciones auxiliares en el esquema `auth` durante el arranque de la base de datos:

*   **`rebase.uid()`** — Devuelve el ID del usuario autenticado como `text`, o `NULL` si no está establecido:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.uid() RETURNS text AS $$
        SELECT NULLIF(current_setting('app.user_id', true), '');
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

Puede utilizar estas funciones auxiliares directamente en sus reglas de seguridad personalizadas o migraciones de base de datos:
```sql
CREATE POLICY owner_access ON posts
    FOR ALL
    TO public
    USING (author_id = rebase.uid() OR string_to_array(rebase.roles(), ',') && ARRAY['admin']);
```

## Tokens asimétricos y JWKS

Por defecto, los tokens de acceso se firman con `jwtSecret` (HS256). Eso funciona, pero significa que cualquier componente que necesite *verificar* un token debe poseer la clave que lo *emite* — por lo que una pasarela (gateway) o un edge worker que compruebe una sesión también podría falsificarlo — y cambiar el secreto cerrará la sesión de todos los usuarios a la vez.

Configure una clave de firma y Rebase firmará los tokens de acceso de forma asimétrica, publicando la mitad pública en **`/.well-known/jwks.json`** para que cualquiera pueda realizar la verificación contra ella:

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

Genere una clave con:

```bash
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out jwt-key.pem
```

Las claves RSA también funcionan y firman con `RS256`; las claves EC P-256 firman con `ES256`. Solo se configura la clave privada — la mitad pública se deriva de ella, por lo que el par no puede diferir. `jwtSecret` sigue siendo obligatorio en cualquier caso: todavía firma los tokens de propósito específico (enlaces de descarga, MFA pendiente, restablecimiento de contraseña) que solo este servidor lee.

### Rotar una clave

Coloque la clave nueva primero y mantenga la antigua en la lista. Los nuevos tokens se firman con la nueva clave; los tokens que ya están en circulación continúan verificándose contra la antigua hasta que expiren, por lo que a ningún usuario se le cierra la sesión.

```typescript no-verify
signingKeys: [
    { kid: "2026-09", privateKey: process.env.JWT_PRIVATE_KEY_NEW! },
    { kid: "2026-08", privateKey: process.env.JWT_PRIVATE_KEY_OLD! }
]
```

Una vez transcurrido el tiempo de vida más largo de los tokens de acceso, elimine la entrada antigua. Utilice `activeKid` si desea publicar una clave antes de comenzar a firmar con ella.

### Verificación en otros servicios

Los tokens llevan el `kid` de la clave de firma en su cabecera, que es como un verificador selecciona la clave correcta del JWKS y cómo sabe que debe volver a obtenerlas tras una rotación. Cualquier biblioteca estándar hace esto por usted — por ejemplo, con `jose`:

```typescript no-verify
import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(new URL("https://api.example.com/.well-known/jwks.json"));
const { payload } = await jwtVerify(token, jwks);
```

:::note
Sin ningún `signingKeys` configurado, `/.well-known/jwks.json` responde `{"keys":[]}` y los tokens permanecen en HS256. Nada cambia hasta que agregue una clave.
:::

## Autenticación mediante clave de servicio (Service Key)

Para la comunicación entre servidores (p. ej., tareas cron, servicios externos), configure una clave de servicio estática:

```typescript
auth: {
    serviceKey: process.env.REBASE_SERVICE_KEY,
    // ...
}
```

Los clientes se autentican con la cabecera `Authorization: Bearer <service-key>`. 

### Clave interna por arranque (Per-Boot Key)

Si no se proporciona `REBASE_SERVICE_KEY` en su configuración, Rebase genera automáticamente una **clave interna aleatoria por arranque**. 

Esta clave nunca se registra en logs ni sale del proceso. El singleton `rebase` la utiliza para autenticarse contra las propias API del plano de control del servidor (autenticación, almacenamiento, etc.). Esto garantiza que las tareas administrativas (como enviar un correo de bienvenida o generar una URL de almacenamiento) funcionen siempre de forma inmediata en desarrollo y producción sin necesidad de gestionar claves manualmente.

### Protección contra ataques de temporización y requisitos de clave

Para evitar ataques de temporización (timing attacks), Rebase valida tanto la clave de servicio configurada por el usuario como la clave interna mediante una comparación de cadenas en tiempo constante (`safeCompare`). La clave de servicio configurada por el usuario **debe tener al menos 32 caracteres de longitud**; si se configura una clave de menos de 32 caracteres, Rebase lanzará un error de configuración al iniciar y se cerrará por seguridad (fail-closed).

## Próximos pasos

- **[Authentication](/docs/backend/authentication/)** — la configuración de la que proceden estas rutas
- **[Custom auth adapters](/docs/backend/auth-adapters/)** — sustitución del proveedor subyacente
- **[Security Rules (RLS)](/docs/collections/security-rules/)** — lo que hace una directiva con `rebase.uid()`
- **[Autenticación del SDK tipado](/docs/sdk/authentication/)** — llamada a estas rutas desde el SDK
