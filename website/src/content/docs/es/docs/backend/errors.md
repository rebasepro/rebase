---
sourceHash: 8732e8711cde4c20
title: Códigos de error
sidebar_label: Códigos de error
description: Cada código de error que un backend de Rebase puede devolver, con su estado HTTP, qué significa y qué hacer al respecto — además del envelope de respuesta, X-Request-ID y las reglas de details.
---

Cada fallo devuelto por un backend de Rebase utiliza un único envelope y contiene un
`code` estable. El código es el elemento sobre el que bifurcar en la lógica: el mensaje está escrito para una persona
y puede reformularse, el estado HTTP se comparte entre una docena de problemas diferentes y el
código no es ninguna de las dos cosas.

## El envelope

```json
{
  "error": {
    "message": "Schema drift: table \"posts\" does not exist.",
    "code": "SCHEMA_DRIFT",
    "details": { "dbCode": "42P01" },
    "requestId": "6f1b2f3e-8a0c-4d1b-9c3e-2a5b7c9d1e0f"
  }
}
```

- **`message`** — legible para humanos. Para un `4xx` es el propio mensaje del servidor; para
  un `5xx` es deliberadamente genérico, ya que el texto subyacente puede citar un
  host, un rol o un nombre de columna.
- **`code`** — uno de los valores que figuran a continuación. Estable entre versiones menores.
- **`details`** — opcional, y nunca garantizado. Consulta las reglas a continuación.
- **`requestId`** — presente siempre que la petición haya pasado por el middleware de request-ID,
  lo cual ocurre en cada ruta bajo `basePath`.

### `X-Request-ID`

Cada petición bajo `basePath` recibe un ID: la cabecera `X-Request-ID` de quien realiza la llamada
cuando es un UUID; de lo contrario, uno nuevo. Se devuelve en la
respuesta como `X-Request-ID`, se incluye en el envelope del error como `requestId` y se
asocia a la línea de log del servidor correspondiente a esa petición.

Esa es la clave de unión. Cítala en un informe de error y un operador podrá encontrar la única
línea de log que explica el fallo, incluyendo el motivo que nunca se
mostró al cliente.

Enviar el tuyo propio es cómo una traza sobrevive a un salto: una pasarela (gateway) o un gestor de trabajos (job runner) que
reenvía la cabecera obtiene un único ID en todos los servicios que procesaron la petición.
Un valor no válido se ignora en lugar de ser rechazado —una cabecera malformada enviada por el
cliente no amerita hacer fallar una petición—, así que no asumas que el ID que enviaste es
el ID que recibiste. Lee la cabecera de la respuesta.

### Qué hay en `details`

`details` es de carácter diagnóstico, no contractual. Tres reglas lo rigen:

1. **Todo lo que una ruta define explícitamente se devuelve siempre.** Estos son los
   propios errores de quien llama descritos con precisión: qué campo de filtro era desconocido,
   qué relación no es de escritura, qué valor no encajaba en su tipo.
2. **Los diagnósticos de la base de datos se omiten en producción.** Cuando el fallo proviene
   de Postgres, `details.dbCode` —el SQLSTATE— está siempre presente: nombra
   la clase de problema y no revela nada sobre los datos. `dbMessage`,
   `detail` y `hint` se añaden únicamente cuando `NODE_ENV` no es `production`,
   ya que Postgres incluye el contenido de las filas en ellos. `23505` reporta
   `Key (email)=(a@b.c) already exists.`, lo que responde a "¿está registrada esta persona?"
   para cualquier dirección que cualquiera decida probar.
3. **Nunca bifurques la lógica según `details`.** Hazlo según `code`. Lo que está bajo `details` es
   cualquier información que resultara útil para una persona en ese punto de llamada, y puede cambiar.

## Cómo interpretar un estado

| Estado | Qué indica sobre la petición |
| --- | --- |
| `400` | Malformada, o solicita algo que no existe en el esquema. Corrige la petición. |
| `401` | No autenticado, o la credencial ha expirado. Inicia sesión o renueva el token. |
| `403` | Autenticado, pero no autorizado. Reintentar con la misma identidad no servirá de nada. |
| `404` | No existe tal ruta, tabla o fila —o es una fila que la seguridad a nivel de fila (RLS) oculta. |
| `409` | Un conflicto con el estado existente: un duplicado o una escritura concurrente. |
| `413` `415` `422` | El cuerpo es demasiado grande, el tipo de medio es incorrecto o fue rechazado semánticamente. |
| `429` | Límite de tasa alcanzado (Rate limited). Reduce la frecuencia; el mensaje indica por cuánto tiempo. |
| `500` | El fallo es del servidor o de su base de datos, no de quien llama. Revisa los logs. |
| `501` | La ruta existe, pero este despliegue no puede atenderla —una funcionalidad desactivada o sin configurar. |
| `502` `503` `504` | Una dependencia era inalcanzable, no estaba configurada o fue demasiado lenta. |

## Autenticación y cuentas

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | La ruta necesita un segundo factor y la sesión solo tiene uno. | Completa el desafío MFA y luego reintenta. |
| `ALREADY_VERIFIED` | 400 | La dirección o el factor ya están verificados. | Nada — el estado deseado ya se cumple. |
| `ACCOUNT_OUTRANKS_CALLER` | 403 | La cuenta que se edita, restablece o elimina posee un rol o alcance que quien llama no tiene. `details.beyond` los especifica. | Haz que alguien que los posea realice el cambio. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | El inicio de sesión anónimo está desactivado en este servidor. | Actívalo o inicia sesión con una identidad real. |
| `ANONYMOUS_NOT_ALLOWED` | 403 | Una sesión de invitado intentó aprobar un inicio de sesión de dispositivo. Un invitado no tiene una cuenta que prestar a un dispositivo. | Inicia sesión con una cuenta y luego apruébalo. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Una clave de API intentó listar, crear, modificar o revocar claves de API, ya sean de su mismo tipo o personales. | Gestiona las claves como una persona con `keys:write` o con la clave de servicio. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Una ruta protegida se ejecutó sin ningún middleware de autenticación de Rebase previo, por lo que nunca se evaluó la credencial de quien llama. | Monta la aplicación a través del enrutador de funciones en lugar de hacerlo directamente en tu propio servidor. |
| `BOOTSTRAP_ANONYMOUS` | 403 | Quien intentó la inicialización (bootstrap) del primer administrador fue un llamador anónimo. | Inicia sesión primero. |
| `BOOTSTRAP_COMPLETED` | 403 | El primer administrador ya existe. | Haz que un administrador existente otorgue el rol. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | La inicialización (bootstrap) es solo para el primer usuario absoluto, y este no lo es. | Haz que un administrador existente otorgue el rol. |
| `CAPTCHA_FAILED` | 400 | El proveedor rechazó el token de CAPTCHA. | Resuelve un nuevo desafío. |
| `CAPTCHA_REQUIRED` | 400 | La ruta requiere un token de CAPTCHA y no se envió ninguno. | Incluye el token. |
| `CHALLENGE_EXHAUSTED` | 401 | Demasiados códigos incorrectos para un único desafío MFA. | Inicia un nuevo desafío. |
| `CONFIRMATION_REQUIRED` | 400 | Se llamó a una operación DDL destructiva (`DELETE /api/admin/db/tables/:table` o `DELETE …/columns/:column`) sin `{ confirm: "<name>" }`. | Vuelve a enviar la petición con el nombre exacto de destino en `confirm`, o pasa `dryRun: true` para previsualizar el SQL. |
| `DDL_REJECTED` | 400, o 409 cuando el objeto ya existe | PostgreSQL rechazó una sentencia que `/api/admin/db/*` ejecutó por ti —un tipo, un valor por defecto, una condición de política, un nombre ya ocupado. El mensaje es el propio de Postgres y `details.dbCode` su SQLSTATE. | Modifica lo que el mensaje indica y envía la petición de nuevo; `dryRun: true` muestra el SQL primero. |
| `DEVICE_LOGIN_DECIDED` | 409 | El inicio de sesión de dispositivo ya fue aprobado o denegado. Un inicio de sesión se decide una sola vez. | Inicia uno nuevo en el dispositivo. |
| `DEVICE_LOGIN_EXPIRED` | 410 | El inicio de sesión de dispositivo superó sus diez minutos antes de ser decidido. | Inicia uno nuevo en el dispositivo. |
| `DEVICE_LOGIN_NOT_FOUND` | 404 | Ningún inicio de sesión de dispositivo tiene ese código de usuario. El propio sondeo del dispositivo responde en su lugar con los códigos en minúsculas de RFC 8628: `authorization_pending`, `slow_down`, `access_denied`, `expired_token`, `invalid_grant`. | Comprueba el código con el que muestra el dispositivo. |
| `EMAIL_EXISTS` | 409 | Ya existe una cuenta con esa dirección —al registrarse, al cambiar de dirección o al seguir un enlace de cambio de dirección cuando otra cuenta tomó la dirección mientras estaba en espera. | Inicia sesión o inicia un restablecimiento de contraseña; para un cambio de dirección, elige otra. |
| `EMAIL_NOT_CONFIGURED` | 503 | Se solicitaron enlaces mágicos u OTP y el servidor no tiene transporte de correo. | Configura SMTP o usa otro método de inicio de sesión. |
| `EMAIL_NOT_VERIFIED` | 403 | Un inicio de sesión con OAuth encontró una cuenta con la misma dirección, y el proveedor no verificó esa dirección, por lo que no está vinculada. | Inicia sesión con el método existente y luego haz `POST /auth/link/<provider>`. |
| `CSRF_REFUSED` | 403 | La protección CSRF está activa (`csrf: { origin }`) y una petición sin cabecera `Authorization` provino de un origen que no está en la lista: un envío de formulario autenticado por cookies desde otro sitio, o una petición sin cuerpo y sin `Origin`. | Envíala desde un origen permitido, con un cuerpo JSON o con una cabecera `Authorization`. |
| `FACTOR_NOT_VERIFIED` | 400 | El factor MFA fue registrado pero nunca confirmado. | Confirma el factor. |
| `ID_EXISTS` | 409 | Una cuenta ya posee el id que mantiene una importación de cuentas (`POST /api/admin/users/import`). La importación lo reporta como `skipped` y deja la cuenta intacta. | Nada, si la cuenta fue importada previamente. De lo contrario, omite `id` o elige otro. |
| `IDENTITY_ALREADY_LINKED` | 409 | Esa identidad de OAuth pertenece a otra cuenta. | Inicia sesión con ella o desvincúlala allí primero. |
| `IMPERSONATION_FORBIDDEN` | 403 | Una petición envió `x-rebase-impersonate` y quien llama no puede ejecutar peticiones como otro usuario. Solo la sesión propia de un administrador autenticado puede hacerlo, nunca una clave de API ni la clave de servicio. | Envíala con la sesión de un administrador u omite la cabecera. |
| `IMPERSONATION_INVALID` | 400 | `x-rebase-impersonate` se envió vacío. | Envía el uid del usuario como quien actuar u omite la cabecera. |
| `IMPERSONATION_TARGET_NOT_FOUND` | 404 | `x-rebase-impersonate` no apunta a ningún usuario activo: ninguna cuenta tiene ese uid o está deshabilitada. | Comprueba el uid. |
| `IMPERSONATION_UNAVAILABLE` | 501 | La autenticación de este backend no puede ejecutar una petición como otro usuario porque su `AuthAdapter` no tiene `resolveUser`. | Implementa `resolveUser` en el adaptador u omite la cabecera. |
| `IMPERSONATION_UNSUPPORTED` | 400 | `x-rebase-impersonate` fue enviado a una ruta que no puede ejecutarse como otro usuario. Solo la API de datos y las funciones personalizadas lo admiten, y el socket en tiempo real admite `impersonate` en `AUTHENTICATE`. | Envía la petición sin la cabecera. |
| `SIMULATION_FORBIDDEN` | 403 | Una petición envió una cabecera `x-rebase-simulate-*` (el simulador de RLS) o consultó `/api/admin/rls-simulator`, y quien llama no puede simular accesos. Solo la sesión propia de un administrador autenticado puede hacerlo, nunca una clave de API ni la clave de servicio. | Envíala con la sesión de un administrador u omite las cabeceras. |
| `SIMULATION_INVALID` | 400 | La simulación estaba malformada: una cabecera enviada vacía, `x-rebase-simulate-api-key-id` combinado con un rol o id de usuario, o simulación combinada con `x-rebase-impersonate`. | Especifica un rol (opcionalmente con un uid), un id de usuario o un id de clave de API. |
| `SIMULATION_READ_ONLY` | 403 | Una escritura, eliminación, `_batch`, reversión de historial o una función personalizada llamada con cualquier verbo excepto `GET`/`HEAD`/`OPTIONS`, llevó una cabecera `x-rebase-simulate-*`. El acceso simulado es de solo lectura: la escritura se ejecutaría como la identidad simulada, no como el administrador. Las lecturas, incluyendo `POST …/query` y `…/count`, siguen ejecutándose. | Deja de simular para realizar cambios. |
| `SIMULATION_TARGET_NOT_FOUND` | 404 | La simulación no apunta a ningún usuario activo (un id de usuario enviado sin rol) o a ninguna clave de API activa. | Comprueba el id, o envía un rol con el uid para simular un uid que no tiene cuenta. |
| `SIMULATION_UNAVAILABLE` | 501 | Este backend no puede simular accesos: su `AuthAdapter` no tiene `resolveUser` para confirmar a un administrador, o se especificó una clave en un backend sin claves de API. | Implementa `resolveUser` u omite las cabeceras. |
| `SIMULATION_UNSUPPORTED` | 400 | Se envió una cabecera `x-rebase-simulate-*` a una ruta que no puede ejecutarse con acceso simulado. Solo la API de datos y las funciones personalizadas las admiten. | Envía la petición sin las cabeceras. |
| `GUEST_REFERENCED` | 409 | No se pudo eliminar un invitado porque una fila del propio proyecto lo requiere, a través de una clave foránea con `ON DELETE RESTRICT` o `NO ACTION`. `DELETE /api/admin/guests` lo reporta por invitado en `skipped` y continúa. | Elimina la fila o conserva el invitado. |
| `INVALID_ACCOUNT` | 400 | La cuenta está en un estado sobre el cual esta operación no puede actuar. | Consulta el mensaje. |
| `INVALID_CHALLENGE` | 400 | El desafío MFA es desconocido o ha expirado. | Inicia uno nuevo. |
| `INVALID_CODE` | 400 / 401 | El código OTP o MFA es incorrecto: 400 desde el inicio de sesión por código de email (`/auth/otp/verify`), 401 desde un registro o desafío MFA. | Reintenta con el código actual. |
| `INVALID_CREDENTIALS` | 401 | Email o contraseña incorrectos —deliberadamente sin especificar cuál. | Reintenta o restablece la contraseña. |
| `INVALID_PLATFORM_TOKEN` | 401 | Se rechazó un token de plataforma `rpt_`: firma incorrecta, audiencia errónea, expirado o tiempo de vida superior al límite máximo. El mensaje indica cuál. | Haz que la plataforma genere uno nuevo; en Rebase Cloud, ejecuta el comando nuevamente. |
| `INVALID_SCOPES` | 400 | Se solicitó para una clave algo que no es un alcance: malformado, desconocido o con un destino no admitido por el alcance. `details.problems` dice cuál y por qué; `details.validScopes` lista los alcances que puede tener una clave. Omite `keys:read` y `keys:write`, que ninguna clave puede poseer. | Usa un nombre de la lista. Consulta [Roles y alcances](/docs/backend/roles-and-scopes/). |
| `INVALID_TOKEN` | 400 / 401 | Un token de verificación, restablecimiento, enlace mágico o cambio de dirección está malformado, es desconocido, ya fue utilizado o ha expirado (400). Una credencial de proveedor OAuth o un token de actualización que no se verifica devuelve 401. | Solicita un enlace nuevo o inicia sesión de nuevo. |
| `INVALID_USER_CODE` | 400 | Lo enviado como código de inicio de sesión de dispositivo no es válido: debe tener ocho letras, como `BCDF-GHJK`. | Copia el código que muestra el dispositivo. |
| `INVALID_PASSWORD_HASH` | 400 | El `passwordHash` de una cuenta importada no es un hash en el formato que indica el `passwordHashAlgorithm` de la petición: para `bcrypt`, `$2a$`, `$2b$` o `$2y$`, un coste de 04 a 31, seguido de 53 caracteres. Una contraseña en texto plano en esa columna suele ser la causa habitual. | Exporta la columna donde el otro sistema guarda el hash (Supabase: `auth.users.encrypted_password`), u omítela y la cuenta iniciará sesión por enlace mágico o restablecimiento. |
| `INVALID_ID` | 400 | El `id` de una cuenta importada no es admisible para una cuenta: está vacío, supera 128 caracteres, contiene caracteres fuera de letras, dígitos y `_ - . : \|`, es un id reservado (`service`, `anonymous`) o un valor que la columna id de la tabla de usuarios no puede almacenar (no es un uuid en una columna `uuid`). | Corrige el id u omítelo y deja que la tabla genere uno. |
| `INVALID_ROLE` | 400 | El nombre de un rol que se escribe no es una cadena, está vacío o contiene `,` `{` `}` `"` `\` o un carácter de control. Esos caracteres se interpretarían al recuperarse como otros roles: un rol viaja en un `text[]` de Postgres y en la lista separada por comas que dividen las políticas de RLS, por lo que `"support,admin"` se leería como `admin`. `details.problems` enumera cada uno. | Renombra el rol. Cualquier otro nombre es aceptado. |
| `KEY_MANAGEMENT_SCOPE` | 400 | Se solicitó `keys:read` o `keys:write` para una clave. Ninguna clave puede gestionar claves. `details.scopes` las enumera. | Omítelas. |
| `KEY_OUTRANKS_CALLER` | 403 | Un poseedor de `keys:write` intentó modificar o revocar una clave de servicio que contiene un rol o alcance que este no posee. Solo un admin gestiona cualquier clave. `details.roles` y `details.scopes` indican lo que la clave posee por encima de quien llama. | Haz que un admin, o alguien que los posea, modifique la clave. |
| `LAST_ADMIN` | 403 | El cambio dejaría el proyecto sin ningún admin. | Promociona a otra persona primero. |
| `MFA_REQUIRED` | 401 | La contraseña era correcta y la cuenta tiene un segundo factor verificado, por lo que el inicio de sesión solo está completado a medias. `details` contiene un token de corta duración limitado al desafío MFA —no es una sesión. | Inicia un desafío y respóndelo; la respuesta al desafío emite la sesión. |
| `NO_SESSION` | 401 | No se presentó ninguna cookie de sesión ni token de actualización. Habitual en la primera carga de página. | Inicia sesión. |
| `NOT_ANONYMOUS` | 400 | Una ruta de actualización desde anónimo fue llamada por una cuenta real, o `DELETE /api/admin/guests/:uid` especificó una cuenta real. | No hay nada que actualizar. Para eliminar una cuenta, usa `DELETE /api/admin/users/:uid`. |
| `OAUTH_ERROR` | 401 | El proveedor OAuth rechazó la solicitud o devolvió un error. | Reintenta el flujo; el mensaje contiene el motivo del proveedor. |
| `PERSONAL_KEYS_DISABLED` | 403 | Las claves de API personales están desactivadas en este backend. | Establece `personalKeys: true` en las opciones `auth` de la tabla de autenticación (`defineAuthTable`). |
| `PERSONAL_KEY_NEEDS_ACCOUNT` | 403 | La clave de servicio o una sesión de invitado intentó usar las rutas de claves personales. Ninguno tiene una cuenta sobre la cual actuar mediante una clave. | Inicia sesión en una cuenta o crea una clave de servicio en `/api/admin/api-keys`. |
| `PLATFORM_TOKENS_OFF` | 401 | Un token de plataforma `rpt_` llegó a un servidor que no los acepta: `REBASE_PLATFORM_TOKEN_KEY` y `REBASE_PLATFORM_TOKEN_AUDIENCE` no están configurados. | La plataforma que aloja la app configura ambos al desplegar; vuelve a desplegar o inicia sesión en la app de otra forma. |
| `RATE_LIMITED` | 429 | Demasiados intentos desde este cliente. | Reduce el ritmo de peticiones; el mensaje indica por cuánto tiempo. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | El destino de redirección no está en la lista de permitidos. | Añádelo a la configuración del proveedor. |
| `REGISTRATION_DISABLED` | 403 | El registro autoservicio está desactivado. | Haz que un admin cree la cuenta. |
| `ROLE_EXCEEDS_CALLER` | 403 | Los roles otorgados poseen un alcance, o `admin`, que quien llama no tiene. `details.beyond` los enumera. | Haz que alguien que los posea otorgue el rol. |
| `ROLE_EXCEEDS_CREATOR` | 403 | Se asignó a una clave de servicio un rol de RLS que su creador no posee. Solo un admin puede otorgar cualquier rol. `details.roles` los enumera. | Quita el rol o haz que un admin cree la clave. |
| `ROLE_EXISTS` | 409 | Ese nombre de rol ya está ocupado. | Elige otro nombre. |
| `ROLE_LOOKUP_FAILED` | 503 | No se pudieron leer los roles de quien llama —en una ruta de admin o en una petición de datos en un backend con `config.auth`. Se deniega el acceso por seguridad (fail closed) en lugar de confiar en los roles del token. Un token cuyo uid no corresponde a ninguna cuenta, incluido un uid no admisible en la tabla de usuarios, devuelve 401, no este error. Una base de datos inalcanzable es `DATABASE_UNAVAILABLE`, no este error. | Reintenta; comprueba la base de datos. |
| `SCOPE_EXCEEDS_CREATOR` | 403 | Se solicitó para una clave un alcance que su creador no posee. Una clave nunca puede tener más privilegios que la cuenta que la crea. `details.scopes` los enumera. | Quítalos o haz que alguien que los posea cree la clave. |
| `SCOPE_MISSING` | 403 | La credencial no posee el alcance que esta ruta, tabla, fuente de almacenamiento o función necesita. `details.requiredScope` lo especifica, destino incluido. | Para una persona, un rol que declare el alcance. Para una clave, una clave que lo contenga. Consulta [Roles y alcances](/docs/backend/roles-and-scopes/). |
| `SCOPE_NOT_DECLARED` | 500 | Una ruta protegida con `requireScope` nombra un alcance de aplicación que este backend no declara, por lo que nadie lo posee, ni siquiera un administrador. Un nombre que ni siquiera es un alcance o uno integrado mal escrito como `data:raed` nunca llega a este punto: `requireScope` lanza un error al registrarse la ruta. | Declara el alcance bajo `auth.scopes` en la tabla de autenticación o corrige el nombre. Consulta [Roles y alcances](/docs/backend/roles-and-scopes/). |
| `SELF_DELETE` | 400 | Un admin intentó eliminar su propia cuenta. | Haz que otro admin lo haga. |
| `SESSION_REVOKED` | 401 | La sesión se cerró en otro lugar, se revocaron todas las sesiones o la cuenta fue eliminada. Cualquier punto de entrada que reciba una sesión responde esto ante tal token de acceso: la API de datos, almacenamiento, funciones personalizadas y las rutas de admin. El socket en tiempo real rechaza su `AUTHENTICATE` con una trama `AUTH_ERROR` con este mismo código. El SDK renueva, la renovación es rechazada y se cierra la sesión. | Inicia sesión de nuevo. |
| `ACCOUNT_DISABLED` | 401/403 | Un administrador desactivó la cuenta: el inicio de sesión (403), la renovación y cada token que posee (401) son rechazados en todos los puntos que aceptan sesiones. El socket en tiempo real rechaza su `AUTHENTICATE` con una trama `AUTH_ERROR` con este mismo código. | Consulta con un administrador. |
| `EMAIL_NOT_CONFIRMED` | 403 | `requireEmailVerification` está activado y la dirección aún no ha sido verificada. Solo se responde ante una contraseña correcta; se envía un nuevo enlace por correo. | Sigue el enlace del correo. |
| `PROOF_REQUIRED` | 409 | `POST /auth/verify-email`: la cuenta contiene una contraseña o identidad que nadie ha probado, y la petición no demuestra ninguna de las dos. El token no se consume. | Envía `password` para conservarla, o `removeUnproven: true` para verificar sin ella. |
| `UNDELIVERABLE_ADDRESS` | 400 / 409 | Se solicitó un correo de verificación para una dirección inalcanzable —la de un invitado o el marcador de posición de X (400)— o una cuenta solicitó cambiar a dicha dirección (409, `POST /auth/change-email`). | Configura una dirección real primero. |
| `EMAIL_UNCHANGED` | 400 | `POST /auth/change-email` especificó la dirección actual de la cuenta. | Nada que cambiar. |
| `ANONYMOUS_USER` | 403 | Un invitado solicitó cambiar su dirección de correo; un invitado no tiene ninguna propia. | Conviértelo en una cuenta primero (`POST /auth/anonymous/link`). |
| `MFA_NOT_ENROLLED` | 400 | Se solicitaron códigos de recuperación para una cuenta sin un segundo factor verificado. | Registra un factor primero. |
| `HOOK_REJECTED` | 400 | Un hook `beforeUserCreate`, `beforeLogin`, `beforeUserDelete` o `beforeEmailChange` lanzó un error. El mensaje es el propio del hook; un hook que eligió un estado 4xx responde con dicho estado. | Consulta el mensaje. |
| `INVALID_JSON` | 400 | El cuerpo de la petición no es JSON. | Envía un cuerpo JSON. |
| `SELF_DISABLE` | 400 | Un administrador intentó deshabilitar su propia cuenta. | Pide a otro administrador que lo haga. |
| `NOT_SUPPORTED` | 501 | El repositorio de autenticación de este backend no puede realizar lo solicitado (deshabilitar cuentas, cambiar una dirección). | Reinicia el servidor para que se agregue la columna, o usa un repositorio compatible. |
| `UNKNOWN_SCOPE_TARGET` | 400 | El destino de un alcance nombra una tabla, fuente de almacenamiento o función que este backend no sirve. `details` lista las que sí sirve. | Corrige el destino. |
| `UNVERIFIED_IDENTITIES` | 409 | Un enlace mágico, código de correo o restablecimiento de contraseña validó la dirección de una cuenta no verificada, y la cuenta posee una identidad de inicio de sesión cuyo proveedor nunca verificó dicha dirección. El repositorio de autenticación no puede eliminarla (carece de `unlinkUserIdentity`), por lo que se rechaza la verificación antes que dejar abierta esa vía de acceso en una cuenta verificada. | Implementa `unlinkUserIdentity` en el repositorio de autenticación personalizado, o haz que un admin revise la cuenta. |
| `SETUP_REQUIRED` | 403 | El proyecto aún no tiene administrador, por lo que esta ruta no está disponible. | Completa la configuración del primer administrador. |
| `TOKEN_ALREADY_USED` | 401 | Se reutilizó un token de un solo uso, o un token de actualización que fue rotado hace más de `refreshTokenReuseIntervalSeconds`. | Solicita uno nuevo o inicia sesión otra vez. |
| `TOKEN_EXPIRED` | 401 | El token ha superado su tiempo de vida. | Solicita uno nuevo. |
| `TOO_MANY_USERS` | 400 | Un `POST /api/admin/users/import` contenía más de 100 cuentas. `details.max` indica el límite. | Envíalas en peticiones de 100; `rebase users import` lo hace así. |
| `USER_NOT_FOUND` | 404 | No existe ninguna cuenta con ese id. | Comprueba el id. |
| `WEAK_PASSWORD` | 400 | La contraseña no cumple con la [política de contraseñas](/docs/backend/auth-endpoints/#password-policy) (por defecto más de 8 caracteres con una mayúscula, una minúscula y un dígito) —en el registro, restablecimiento o cambio, y en contraseñas elegidas por un administrador: `POST /api/admin/users`, una creación en la tabla de autenticación a través de la API de datos, `PUT /api/admin/users/:id` o `POST /api/admin/users/:id/reset-password`. | Elige una más segura. Un administrador que importe cuentas puede enviar `skipPasswordPolicy: true` al crear. |

## Datos, consultas y escrituras

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `AGGREGATE_MASKED_BY_AFTER_READ` | 400 | Un agregado distinto de `count()` sin `groupBy` en una tabla que un hook `afterRead` reescribe (global, tabla o el `.transform()` de una columna). Un agregado lee los valores almacenados y nunca ejecuta el hook, por lo que una suma, mínimo, máximo, recuento de campos o agrupación leería lo que el hook oculta. | Usa `count()` sin `groupBy`, o lee las filas, que pasan por el hook. |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Este controlador no puede computar el agregado solicitado. | Usa un controlador compatible, o computa el valor en el cliente. |
| `BRANCHING_UNSUPPORTED` | — | Se solicitó una rama de la base de datos a través del websocket de Studio en la base de datos de desarrollo administrada (PGlite), donde una rama *es* la principal y nada quedaría aislado. El rechazo es el mismo que muestra `rebase db branch`. | Apunta `DATABASE_URL` a una instancia de Postgres propia (`rebase dev --docker` inicia una) y crea ramas allí. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` contiene más operaciones que el límite por lote (1000 por defecto). Un lote es una transacción única y retiene sus bloqueos durante toda su duración. | Envíalo en fragmentos; el mensaje especifica el límite y tu recuento. |
| `BATCH_UNSUPPORTED` | 400 | El controlador de este backend no puede escribir entre tablas de manera atómica, y un bucle de escrituras individuales no sería ni atómico ni de un solo viaje de ida y vuelta. | Envía las escrituras como peticiones independientes o como llamadas `/bulk` por tabla. |
| `BULK_TOO_LARGE` | 400 | El cuerpo de la operación masiva excede el límite de elementos configurado. | Divide la petición. |
| `BULK_UNSUPPORTED` | 400 | Esta tabla o controlador no admite escrituras masivas. | Escribe las filas una a una. |
| `CALLBACK_REJECTED` | 400 / 403 | Un hook de tabla rechazó la escritura. Un `throw` desde `beforeSave`/`beforeDelete`/`after*` devuelve 400 con el mensaje propio del autor; un `beforeDelete` que devuelve `false` devuelve 403. `details.stage` nombra qué hook, `details.path` la tabla. | Lee el mensaje — fue escrito por este proyecto, no por Rebase. |
| `CALLBACK_RECURSION` | 500 | Las escrituras iniciadas por hooks alcanzaron una profundidad de anidación superior a 16: la escritura `context.data` de un hook ejecuta los hooks de esa tabla nuevamente, y nada en la cadena lo detiene —habitualmente un `afterSave` que actualiza su propia fila sin condición. Toda la escritura fue revertida. El mensaje especifica el hook y la tabla; `details.chain` lista cada paso de hook → escritura. | Haz que la escritura del hook sea condicional: actúa solo sobre `status === "new"`, o sáltala si `values` ya contienen lo que escribiría. |
| `COMPOSITE_KEY_ADDRESS` | 400 | La tabla tiene una clave compuesta y la dirección en la URL especifica una cantidad diferente de partes. | Direcciona la fila como `<part1>:::<part2>`, con cada parte codificada para URL, en el orden de la clave; `details.primaryKey` enumera las columnas. |
| `TABLE_READ_ONLY` | 405 | Una escritura llegó a una vista (`defineView`). Una vista es de solo lectura. Antes era `COLLECTION_READ_ONLY`. | Escribe en las tablas que la vista lee. Consulta [Vistas](/docs/collections/views/). |
| `TABLE_WITHHELD` | 503 | La tabla está declarada, pero la base de datos no la protege: la seguridad a nivel de fila está desactivada, ninguna de las políticas que declara está presente, o falta una política restrictiva que declara. (Una política permisiva ausente sí se atiende, mostrando una advertencia de arranque que la nombra). Esto sucede cuando el servidor no aprovisiona sus tablas (`REBASE_PROVISION=false`, `provisionSchema: false`, `provision.tables: false`, `REBASE_MIGRATE_ON_BOOT=none`), y el servidor retiene la tabla en lugar de servir cada fila a cada cliente. Una unión de muchos a muchos está sujeta a la misma regla: si falla, las tablas cuyas relaciones la utilizan son retenidas y el mensaje nombra la tabla intermedia; lo mismo ocurre con una tabla cuyo `via` atraviesa una tabla retenida, indicando el `via`. Una lectura de relación o filtro que pasa a través de una tabla retenida también devuelve este código. Las demás tablas sí se sirven. El log de arranque nombra las sentencias que la protegen. | Aplica las sentencias indicadas en el log de arranque (`rebase db push` lo hace) y reinicia. O bien, si la aplicación gestiona el acceso a esa tabla por sí misma, declara `rlsRequired: false` en ella (o `database({ rls: { required: false } })`) y reinicia. |
| `SQL_NOT_ALLOWED` | 400 | El SQL ejecutado en nombre de quien llama (`getSql(c)`, `withAuth(user).sql`) no era una sentencia simple `SELECT`, `WITH`, `VALUES`, `TABLE`, `INSERT`, `UPDATE`, `DELETE` o `MERGE`, o llamó a `set_config` o mencionó `pg_settings`. La identidad de quien llama reside en configuraciones de sesión, por lo que cualquier sentencia que pudiera alterarlas es rechazada. | Mantén el texto de la consulta propio, en una sola sentencia, con cada valor en `params`. Consulta [Funciones personalizadas](/docs/backend/custom-functions/#3-getsqlc--sql-as-the-caller). |
| `CURSOR_WITH_OFFSET` | 400 | Se combinó `?after=` con `?offset=` o `?page=`. Un cursor ya define dónde comienza la página, por lo que un offset adicional salta silenciosamente esa cantidad de filas más allá del cursor —un salto que el cliente no puede advertir en la respuesta. | Usa uno o el otro. |
| `DISTINCT_NOT_APPLICABLE` | 400 | Se combinó `?distinct=true` con una consulta de búsqueda o vectorial. Ambas asocian una puntuación por fila, por lo que nunca hay dos filas iguales y `DISTINCT` no colapsaría nada —aparentaría funcionar sin alterar nada. | Descarta una de las dos opciones. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Una lectura `distinct` está ordenada por una columna que no devuelve. Un `SELECT DISTINCT` solo puede ordenarse por columnas presentes en su lista selecta, o de lo contrario las filas que colapsa carecen de orden definido. `details.fields` las enumera. | Agrega esos campos a `?fields=` o quítalos de `?orderBy=`. |
| `DATABASE_UNAVAILABLE` | 503 | No se pudo conectar a la base de datos: la conexión fue rechazada o se perdió, el host no resolvió, el servidor se está apagando o iniciando, o la base de datos está cerrada a nuevas conexiones (`ALLOW_CONNECTIONS false`, estado en el que un `rebase db branch create --force` interrumpido a medio camino deja su origen; el log del servidor nombra la base de datos, y `rebase db branch list` la vuelve a abrir). Todos los puntos de entrada responden esto, incluidos el inicio de sesión, las rutas de administración y el socket en tiempo real (una trama `ERROR`). Se envía con `Retry-After: 5`. | Reintenta; el SDK lo hace. Comprueba que la base de datos esté ejecutándose y accesible desde el servidor. |
| `DB_CONNECTIONS_EXHAUSTED` | 503 | El servidor de base de datos rechazó una nueva conexión porque no le quedan disponibles (`53300` demasiados clientes, `53400` límite de conexiones de un rol o de la base de datos). Cada instancia del servidor comparte el `max_connections` del servidor, por lo que esto sucede cuando varias instancias con pools grandes operan sin pooler. Es un problema de carga, no un fallo; se envía con `Retry-After: 2`. El servidor registra la solución en los logs una vez por minuto. | Reintenta; el SDK lo hace. Reduce `DB_POOL_MAX` (o limítalo con `REBASE_DB_POOL_MAX`) en todas las instancias, coloca un pooler delante de la base de datos (`DATABASE_POOLED`) o aumenta `max_connections`. |
| `DB_CONNECT_TIMEOUT` | 503 | Abrir una nueva conexión a la base de datos tomó más tiempo que `DB_POOL_CONNECT_TIMEOUT`: la base de datos tarda en aceptar conexiones o está lejos en la red. Se envía con `Retry-After`. | Reintenta; el SDK lo hace. Comprueba la carga de la base de datos y la latencia de red. |
| `DB_PERMISSION_DENIED` | 500 | Postgres rechazó la sentencia (`42501`): bien por una política de seguridad a nivel de fila que deniega este rol, o por un `GRANT` faltante. | Consulta [Solución de problemas](/docs/troubleshooting/). |
| `DB_POOL_EXHAUSTED` | 503 | Todas las conexiones del pool de la base de datos permanecieron ocupadas durante `DB_POOL_CONNECT_TIMEOUT`, por lo que esta petición nunca llegó a la base de datos. Carga, no un fallo; enviado con `Retry-After`. El servidor registra la solución en los logs una vez por minuto. | Reintenta; el SDK lo hace. Aumenta `DB_POOL_MAX` o localiza las consultas lentas o transacciones largas que retienen conexiones. |
| `FIELD_NOT_READABLE` | 400 | Un filtro, `orderBy`, `fields`, `select` de agregado o `groupBy` especifica un campo que los roles de este cliente no pueden leer (`access.read`), una ruta anidada o una ordenación agregada nombra una relación que no pueden leer —o una operación de campo (`$inc`, `$push`, …) apunta a uno de ellos, donde un límite rechazado revelaría el valor almacenado. Un campo que ninguna respuesta puede contener debe ser un campo que ninguna consulta pueda interrogar, o de lo contrario el valor sería legible predicado por predicado. Un filtro a través de una relación (`author.salary`) y una ordenación agregada sobre el campo de una relación (`max(staff.salary)`) se evalúan según la regla del destino. `details.violations` enumera cada campo. El controlador aplica la misma regla a una lectura hecha en el proceso en nombre de quien llama (`context.data` bajo el alcance de quien llama), y a una búsqueda vectorial, inclusión o comprobación de unicidad. Una columna `.private()` responde como si no existiera: un filtro, `orderBy`, `fields`, `include`, `select` de agregado o `groupBy`, o `vector_search` que la nombre recibe exactamente la respuesta que recibiría un nombre mal escrito (`UNKNOWN_FILTER_FIELD`, `UNKNOWN_ORDER_BY_FIELD`, `UNKNOWN_FIELD`, `UNKNOWN_RELATION`, `UNKNOWN_AGGREGATE_FIELD` o `UNKNOWN_VECTOR_PROPERTY`), y ninguna respuesta de campo desconocido la lista. | Elimina el campo de la consulta u obtén el rol correspondiente. Consulta [Acceso a campos](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 / 403 | El cuerpo establece un campo que los roles de quien llama no pueden escribir (`access.write`). Rechazado en lugar de omitido: una escritura que descarte un campo reportaría éxito para una edición que no ocurrió. El mismo código rechaza una escritura a través de un padre que establece una relación que el cliente no puede escribir, y una actualización que asigna un valor a un campo `softDelete` —solo una eliminación lo sella. El socket en tiempo real responde 403 con este código ante una escritura mediante una ruta anidada cuya tabla padre, relación o tabla destino no se sirven allí, en lugar de pasarla al controlador sin evaluar. `details.violations` enumera cada campo. | Elimina el campo u obtén el rol requerido. Un campo que nadie puede escribir responde `VALIDATION_EXCLUDED_FIELDS` en su lugar. |
| `FILTERED_USER_WRITE` | 400 | Se envió una actualización o eliminación filtrada a la tabla de autenticación a través de HTTP, cuyas escrituras se validan usuario por usuario antes de ejecutarse. | Lee los usuarios y luego usa `updateMany`/`deleteMany` por id. |
| `FILTER_REQUIRED` | 400 | Una escritura filtrada (una actualización o eliminación mediante `where`/`logical`, desde el SDK o las rutas bulk) no incluye ninguna condición, por lo que afectaría a cada fila. Rechazada antes de ejecutar nada. | Agrega una condición. Si deseas modificar todas las filas intencionadamente, indícalo con una condición que cumplan todas las filas. |
| `HISTORY_UNAVAILABLE` | 503 | Se rechazó una escritura en una tabla con `history: true` porque no se pudo registrar su entrada de historial: la base de datos no tiene la tabla `rebase.entity_history` o, para `openRebase` y `rebase console`, la función `rebase.record_history`. Ningún backend con historial ha arrancado en esta base de datos. No se ejecutó nada, incluidos los hooks, y las lecturas no se ven afectadas. Lanzado por `openRebase` y respondido por un backend creado con `provision: false`. | Arranca el backend una vez con historial activado y `provision: true` (`rebase dev` lo hace), y luego reintenta. |
| `HISTORY_UNSERVABLE` | 501 | El controlador de datos de la tabla no puede ejecutar las reglas de lectura y los hooks `afterRead` sobre filas almacenadas (`DataDriver.serveStoredRows`), y el historial nunca se sirve sin enmascarar. El controlador de Postgres integrado sí puede. | Implementa `serveStoredRows` en el controlador personalizado. Consulta [Historial](/docs/backend/history/). |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Una petición anterior con la misma `Idempotency-Key` todavía se está ejecutando. | Reintenta cuando finalice. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | La misma `Idempotency-Key` llegó en una petición diferente: otro método, ruta, cadena de consulta o cuerpo. | Usa una clave nueva o envía la petición original. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` especificó una función que no es un agregado (`count`, `sum`, `avg`, `min`, `max`, `countDistinct`, `mode`, `percentile`, `distinct`, `fingerprint`). | Usa una de ellas; el mensaje las lista. |
| `INVALID_AGGREGATE_GROUP` | 400 | Una transformación de `groupBy` es desconocida o no aplica a su columna: `year`/`month`/`day` en una columna que no es una fecha, `unnest` en una que no es un array. | Usa `lower`, `upper`, `year`, `month`, `day` o `unnest` en una columna del tipo adecuado. |
| `INVALID_AGGREGATE_SELECT` | 400 | Una entrada de `?select=` no tiene el formato `fn(field)`; se pasó una función distinta de `count()` o `fingerprint()` sin campo; `percentile` no tiene una fracción de 0 a 1; o se solicitó `fingerprint()` sobre una vista plana, que no almacena filas. | Escribe `sum(total)`, `count()`, `percentile(price,0.95)`. |
| `INVALID_AGGREGATE_WINDOW` | 400 | Se usó `offset`, `page` o `orderBy` en un agregado sin `groupBy`, o un cursor en cualquier agregado. Un agregado no agrupado es una sola fila, y un grupo no es una fila después de la cual un cursor pueda continuar. | Agrega `groupBy` o descártalos; pagina grupos con `offset` o `page`. Consulta [Agregados](/docs/sdk/aggregates-and-search/#aggregates). |
| `INVALID_BATCH_BODY` | 400 | Una operación de `/_batch` carece de `op`, `table`, `values` o `id`, nombra una tabla que este backend no sirve o reutiliza un nombre en `ref`. | Consulta el mensaje; nombra la operación por índice. |
| `INVALID_BATCH_REF` | 400 | Un `{ "$ref": "<name>.<field>" }` no apunta a ninguna operación anterior, apunta hacia adelante o solicita un campo que la fila referenciada no tiene. Solo se resuelven referencias hacia atrás. | Nombra la operación con `ref` *antes* de referenciarla. |
| `INVALID_BULK_BODY` | 400 | El cuerpo de la operación masiva no tiene la estructura esperada. | Envía el array que espera la ruta: `{ "rows": [...] }` a `POST /bulk`, `{ "updates": [{ "id", "data" }] }` a `PATCH /bulk`, `{ "ids": [...] }` a `POST /bulk/delete`. |
| `INVALID_CONFLICT_RULE` | 400 | La regla de conflicto de un upsert (mantener duplicados o reemplazar solo en un `where`) se envió sin `upsert: true`, o se enviaron ambas reglas simultáneamente. | Envía `upsert: true` y una de las dos reglas. |
| `INVALID_CONFLICT_TARGET` | 400 | El `on_conflict` / `onConflict` de un upsert especifica columnas sin garantía de unicidad, las nombra sin `upsert: true`, o se envía en una creación anidada, donde una fila coincidente se movería bajo el nuevo padre. De lo contrario, Postgres respondería 42P10 desde el interior de una transacción que ya procesó datos. También aplica a cualquier upsert en la tabla de autenticación, donde crear y actualizar siguen reglas distintas. | Declara `.unique()` en la columna o un índice `unique`; el mensaje lista los destinos válidos. En la tabla de usuarios, envía un `POST` para crear y un `PATCH` para actualizar. |
| `INVALID_COUNT` | 400 | `?count=` no es `exact` ni `none`. Rechazado en lugar de asumirse por defecto: un `?count=nnone` mal escrito pagaría el coste de un recuento que se pretendía omitir. | Envía `exact` (por defecto) o `none`. Consulta [Omitir el recuento](/docs/backend/api/#skipping-the-count). |
| `INVALID_CURSOR` | 400 | El cursor `after` no se puede interpretar o especifica un id de fila incompatible con las columnas clave de la tabla: fue truncado, recodificado o armado a mano. Un cursor legible enviado con un `orderBy` distinto de aquel bajo el que se emitió devuelve `CURSOR_ORDER_MISMATCH`, también un 400. | Reenvía `meta.nextCursor` de la página previa sin cambios, con el mismo `orderBy` o ninguno. Consulta [Paginación](/docs/sdk/pagination/). |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` no es ni `include` ni `only`. Rechazado en lugar de ignorado: un `?deleted=true` mal escrito que ocultara silenciosamente cada fila eliminada parecería funcionar respondiendo lo opuesto. | Envía `include` (activas y eliminadas) u `only` (solo eliminadas). Omítelo para obtener solo filas activas. |
| `INVALID_DISTINCT` | 400 | `?distinct=` no es `true` ni `false`. | Envía uno de ellos; `1` y `0` también son aceptados. |
| `INVALID_FIELD_OPERATION` | 400 | Se utilizó `$inc` / `$push` / `$pull` / `$merge` en un tipo de columna no admitido, con un operando de estructura incorrecta, con dos operadores en un mismo campo, con un error ortográfico o en una creación —donde no hay un valor almacenado sobre el cual operar. | Consulta [Escritura sobre REST](/docs/backend/writes/#field-operations); el mensaje especifica el campo. |
| `INVALID_FILTERED_WRITE` | 400 | Una escritura filtrada se dirigió a una ruta a través de una relación (`posts/1/comments`) o a ninguna tabla. | Escribe en la tabla relacionada con un filtro sobre su enlace. |
| `INVALID_FILTER_FIELD` | 400 | El filtro nombra una columna que esta tabla no tiene. | Comprueba el nombre con respecto a la tabla. |
| `INVALID_FILTER_OPERATOR` | 400 | El operador no es compatible con este tipo de columna —por ejemplo `like` en un número o fecha. | Consulta [Consultar datos](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | Un valor de filtro no se puede leer como el tipo de la columna contra la que se compara: `?id=eq.abc` en una clave entera, una etiqueta fuera del enum, una marca de tiempo inválida, un número fuera de rango. `details.dbCode` contiene el SQLSTATE. | Envía un valor del tipo correspondiente a la columna. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` no es `true` ni `false`. Cualquier otro valor se rechaza en lugar de interpretarse como "no" —un error tipográfico que hace borrado lógico cuando el cliente pidió purgar los datos le haría creer erróneamente que la información fue eliminada. | Envía `true` o `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` está malformado: no es una lista de rutas válida o es un objeto de opciones por relación con estructura incorrecta. Una ruta anidada con más de tres saltos devuelve `INCLUDE_TOO_DEEP`, también un 400. Se valida en la frontera antes de que escape al controlador como un 500. | Consulta el mensaje; indica la ruta infractora. |
| `INVALID_INPUT` | 400 | El cuerpo no pasó la validación. | Consulta el mensaje. |
| `INVALID_LIMIT` | 400 | `?limit=` no es un número entero entre 1 y el máximo (1000 por defecto); uno superior se rechaza, no se acota. Una suscripción en tiempo real que solicite un límite fuera de ese rango recibe el mismo código como trama `ERROR` de WebSocket. | Reduce el límite y recorre el resto mediante paginación. |
| `INVALID_LOGICAL_GROUP` | 400 | Un grupo `?or=` / `?and=` / `?not=` está malformado o excede la profundidad permitida. | Consulta el mensaje; muestra la regla de aplanamiento. |
| `INVALID_OFFSET` | 400 | `?offset=` no es un número entero mayor o igual a 0. | Envía un entero no negativo. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` no tiene el formato `field`, `field:desc`, `field:desc:last`, ni es un array JSON de `{ field, direction, nulls }` —o especifica una dirección distinta de `asc`/`desc`, o una posición de nulos diferente de `first`/`last`. | Consulta el mensaje; muestra cada variación admitida. |
| `INVALID_PAGE` | 400 | `?page=` no es un entero mayor o igual a 1. Las páginas empiezan en 1, por lo que `?page=0` es un error en lugar de la primera página. | Envía `1` o superior, o utiliza `?offset=`. |
| `INVALID_PARAM` | 400 | Un parámetro de consulta está malformado. | Consulta el mensaje. |
| `INVALID_QUERY_BODY` | 400 | El cuerpo de un `POST …/query` contiene un valor no admisible en la URL: una lista para un parámetro que la URL lee una sola vez (`fields`, `limit`, …), un objeto para un filtro, o cualquier parámetro también duplicado en la URL —un `POST …/query` lee todos los parámetros desde el cuerpo. | Escribe cada valor como lo hace la URL —una cadena, o una lista para un filtro repetido; `where`, `include`, `orderBy` y `vector` aceptan JSON. Consulta [Consultas demasiado extensas para una URL](/docs/backend/vector-search/#queries-too-long-for-a-url). |
| `INVALID_VECTOR` | 400 | `?vector=` no es un array JSON de números. | Envía `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` no es `cosine`, `l2` ni `inner_product`. | Usa una de esas tres opciones. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` no es un número. | Envía un número. |
| `INVALID_WHERE` | 400 | `?where=` no es un objeto JSON que asocie campos con condiciones. | Envía `{"status":["==","active"]}`. |
| `KEY_IMMUTABLE` | 400 | Una actualización define la clave de la fila con un valor distinto al usado para referenciarla —en el cuerpo o escrito por un `beforeSave`. Una fila no puede trasladarse a otra clave: todo lo posterior a la escritura (la relectura, `afterSave`, historial, realtime) la direcciona mediante la clave previa. Se rechaza antes de ejecutar cualquier hook, sin escribir nada, en todos los puntos de entrada. `details.violations` nombra el campo. | Crea la fila bajo la nueva clave y elimina la actual. Enviar la clave que la fila ya tiene no causa problema. |
| `MISSING_AGGREGATE_SELECT` | 400 | La ruta de agregados se invocó sin `?select=`. | Agrega uno, p. ej. `?select=count()`. |
| `NOT_A_MATERIALIZED_VIEW` | 400 | Se llamó a `refresh()` en una tabla que no es una vista materializada. | Actualiza únicamente vistas definidas con `defineView(…, { materialized: true })`. |
| `NO_TABLES` | 404 | El proyecto no sirve ninguna tabla: ninguna declarada en `backend/schema` ni existente en la base de datos para introspección. Si existen tablas pero la seguridad a nivel de fila está desactivada en ellas, el mensaje las lista con el SQL para activarla, y `details.unprotectedTables` las enumera. Antes era `NO_COLLECTIONS`. | Crea tablas —mediante una migración, SQL o un archivo `defineTable` más `rebase db push`— y reinicia. |
| `NOT_FOUND` | 404 | No existe ninguna fila con ese id en esa tabla —o la seguridad a nivel de fila la oculta para quien realiza la llamada. | Comprueba el id y luego el `rls` de la tabla. |
| `UNKNOWN_RELATION` | 400 / 404 | `?include=` nombra algo que no es una relación en la tabla. El mismo código responde **404** cuando una *ruta de URL* anidada nombra una en su lugar, p. ej. `/api/data/authors/1/posts` donde `authors` no declara ninguna —allí la URL no apunta a nada, tratándose de un recurso no encontrado en lugar de una petición malformada. | Comprueba el nombre de la relación —el mensaje lista las que posee la tabla. Una referencia inversa debe declararse en el padre para ser navegable. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | La ordenación especifica un campo no ordenable. | Ordena por una columna. |
| `PAGE_WITH_OFFSET` | 400 | Se combinó `?page=` con `?offset=` —o `page` con `offset` en un `find()`, lo cual el SDK cliente, el `rebase.data` en proceso y el cliente offline rechazan con este mismo código antes de enviar la petición. Ambos describen la misma ventana, y antes `page` anulaba silenciosamente a `offset` sin que quien llamaba lo notara. | Envía solo uno de ellos. |
| `PAYLOAD_TOO_LARGE` | 413 | El cuerpo supera el límite configurado. | Envía menos datos o aumenta el límite. |
| `READ_ONLY_TRANSACTION` | 409 | Un hook `afterRead` intentó escribir. Una lectura acotada a una petición se ejecuta dentro de una transacción `READ ONLY`, por lo que ni el hook ni nada de lo que invoque puede realizar escrituras. | Mueve la escritura fuera de la lectura: una tarea en segundo plano o `rebase.dataAsAdmin` desde una tarea cron o una función personalizada. |
| `REFRESH_NOT_SUPPORTED` | 501 | `POST /api/data/<slug>/refresh` llegó a un controlador de datos sin soporte de vistas materializadas. | Nada que actualizar en este backend. |
| `RELATION_HAS_NO_PIVOT` | 400 | La escritura incluyó datos para el enlace, pero la ruta no llega al destino mediante un `manyToMany` que declare un `pivot` —por lo que no existe una fila de unión donde almacenarlos. | Declara columnas `pivot` en la relación o descarta la carga útil en la escritura. Consulta [Relaciones](/docs/collections/relations/). |
| `RELATION_MISCONFIGURED` | 500 | Una relación no se resuelve contra el esquema registrado. La operación se rechaza en lugar de ignorarse: descartarla confirmaría erróneamente una escritura que nunca ocurrió, o devolvería vacío para filas existentes. | Ejecuta `rebase schema generate` si el esquema generado es anterior a la base de datos. |
| `RELATION_NOT_UNLINKABLE` | 400 | La relación no se puede desvincular desde este extremo. | Realiza la escritura desde el lado propietario de la relación. |
| `RELATION_NOT_WRITABLE` | 400 | La ruta anidada no es una relación modificable, o una creación o actualización especifica una relación `via` de múltiples saltos —solo las relaciones `via` de un solo salto son modificables. `details.fields` enumera las claves `via`. Nada fue escrito. | Escribe directamente en las filas que la cadena une. Consulta [Relaciones](/docs/collections/relations/#via--an-explicit-join-chain). |
| `RELATION_PIVOT_UNSUPPORTED` | 400 | La relación declara columnas de tabla intermedia, pero esta fuente de datos no puede escribirlas. | El vínculo en sí sigue funcionando; únicamente los datos asociados a él no se escriben. Comprueba las capacidades del controlador. |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Una escritura de relación no tenía clave de origen sobre la cual anclar el enlace. | Guarda la fila padre primero. |
| `RESULT_TOO_LARGE` | — | Una sentencia enviada mediante `EXECUTE_SQL` en el socket en tiempo real —`admin.executeSql` desde un cliente, lecturas del catálogo del panel de control— devolvió más de 128 MB de filas, por lo que no se envió nada. Se entrega como una trama `ERROR` de WebSocket. Las ejecuciones directas de la consola SQL no se rechazan: muestran las primeras filas. | Agrega un `LIMIT` o selecciona menos columnas, y lee el resultado por partes. |
| `ROW_IN_TRASH` | 409 | La clave de un upsert pertenece a una fila en la papelera (una fila borrada lógicamente aún retiene su clave). Un upsert no escribe en una fila borrada, en ningún canal: REST `?on_conflict=`, upserts en `/bulk` y `/_batch`, el SDK y el socket en tiempo real. Nada fue escrito. | Restaura la fila primero (una actualización asignando `null` al campo de borrado lógico), o purga con `?hard=true` y haz el upsert nuevamente. Consulta [Borrado lógico (soft delete)](/docs/collections/soft-delete/). |
| `SCHEMA_DRIFT` | 500 | Una tabla o columna esperada por el código no existe en la base de datos. | Ejecuta `rebase db push` en desarrollo; vuelve a desplegar en un entorno administrado. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | Se combinó `startAfter` con `orderBy: "_score"`. La relevancia se calcula por consulta en lugar de almacenarse, por lo que no puede utilizarse como cursor. | Pagina la relevancia con `limit`/`offset`, u ordena por una columna. |
| `SQL_ERROR` | 400 | La base de datos rechazó una sentencia SQL escrita manualmente. Mediante `EXECUTE_SQL` en el socket en tiempo real es una trama `ERROR` con el mensaje de la base de datos. `POST /api/admin/sql/csv` lo devuelve antes de enviar cualquier parte del archivo: un error de sintaxis, una escritura (la descarga se ejecuta como solo lectura), más de una sentencia o un rol no permitido para la conexión. | Corrige el SQL. Una descarga requiere un único `SELECT`, `WITH … SELECT`, `TABLE` o `VALUES`. |
| `VIEW_NOT_READABLE` | 403 | Un cliente sin ninguno de los roles `view.roles` de una vista materializada intentó leerla o actualizarla. Una vista materializada carece de RLS, por lo que se entrega completa y únicamente a dichos roles. | Léela con uno de los roles requeridos, o añade el rol del cliente en `view.roles`. |
| `TENANT_IMMUTABLE` | 400 | Una escritura trasladaría una fila de un tenant a otro. Una fila no puede cambiar de tenant. `details.violations` nombra el campo. Un trigger mantiene esta misma restricción en la base de datos, por lo que el SQL ejecutado en nombre del cliente falla con el error de Postgres `42501` y un mensaje que inicia con `TENANT_IMMUTABLE`. | Crea la fila en el nuevo tenant y elimina la actual, o escribe con un rol en `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | La escritura especifica un tenant al cual este cliente no pertenece; la base de datos también la rechazaría. | Escribe en un tenant al que pertenezca quien llama, o autentícate como un usuario que pertenezca a él. |
| `TENANT_REQUIRED` | 400 | La tabla está acotada por tenant y este no puede inferirse: la petición no incluye ninguno o quien llama pertenece a varios. | Envía el campo del tenant explícitamente, o autentícate como un cliente perteneciente a uno solo. |
| `TRANSACTION_ABORTED` | 500 | Una sentencia falló dentro de la transacción de escritura y un hook capturó el error. Postgres ya había abortado la transacción, por lo que la escritura fue revertida y nada quedó almacenado. Solo una creación, actualización o eliminación mediante `context.data` rechazada por la base de datos se revierte por separado y es seguro capturar. | Deja que el fallo lance la excepción, o valida los datos antes de ejecutar la sentencia. Consulta [Semántica de transacciones](/docs/collections/context-data-api/#transaction-semantics). |
| `UNKNOWN_FIELD` | 400 | `?fields=` nombra un campo que la tabla no tiene. | Comprueba el nombre; el mensaje lista los campos válidos. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Un agregado o `groupBy` especifica un campo que la tabla no tiene. | Comprueba el nombre; el mensaje lista los campos válidos. |
| `UNKNOWN_FILTER_FIELD` | 400 | El filtro nombra un campo que esta tabla —o el destino de una relación— no tiene, o una columna `.private()`. | Comprueba el nombre; el mensaje lista los campos válidos. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | El filtro especifica un operador que no existe. | El mensaje lista todos los operadores admitidos. |
| `UNKNOWN_MESSAGE_TYPE` | 400 | Una trama del socket en tiempo real tiene un `type` que el servidor no procesa. Respondido como una trama `ERROR` con el `requestId` de la petición, para que esta se resuelva en lugar de expirar por tiempo de espera. | Comprueba el `type` de la trama; el mensaje lo especifica. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | La ordenación especifica un campo que la tabla no tiene. | Comprueba el nombre; el mensaje lista los campos válidos. |
| `PRECONDITION_FAILED` | 412 | Un encabezado `If-Match` especificó una versión de la fila que ya no es la actual: alguien escribió en ella entre la lectura y esta escritura. Nada fue escrito. | Vuelve a leer la fila, aplica el cambio de nuevo y envía el nuevo `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` solicita un campo que la tabla no posee. | Comprueba el nombre; el mensaje lista los campos conocidos. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Una búsqueda vectorial especificó una columna que no es un `col.vector()` en esta tabla. | El mensaje lista las columnas vectoriales de la tabla. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | El `Content-Type` no es aceptado por esta ruta. | Envía el tipo documentado para la ruta. |
| `UNSUPPORTED_OPTION` | — | Se lanza internamente, no se responde: una escritura a través del descriptor en proceso (`context.data` en un hook, `rebase.data` en una función o cron) recibió `ifMatch` o `idempotencyKey`. Este canal carece de validación de precondiciones o almacén de idempotencia, por lo que la opción se rechaza antes de escribir nada en lugar de ignorarse. | Omite la opción allí o haz la escritura mediante el cliente HTTP, que admite ambas. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | El filtro cruza una relación `via`, cuya ruta de unión está definida en una sola dirección, por lo que no hay forma de correlacionar una subconsulta de retorno. | Filtra desde el lado propietario. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | El operador no está definido para ese campo: una relación sin columna en esta fila se filtra por pertenencia, y la coincidencia de patrones (`like`, `ilike` y sus negaciones) solo aplica a texto. | Consulta el mensaje; lista lo que el campo acepta. |
| `VALIDATION_CONSTRAINT` | 400 | Un valor infringió una regla declarada en la columna (`.validate()`, `.notNull()`, `.oneOf()`) —longitud, rango, patrón, campo obligatorio, un valor no incluido en la lista. Cada elemento de `details.violations` contiene un `code`: `required`, `min_length`, `max_length`, `length`, `min`, `max`, `less_than`, `more_than`, `positive`, `negative`, `integer`, `pattern`, `email`, `url`, `enum`, `min_items`, `max_items`, `unique_items` (un array contiene el mismo elemento dos veces, `$push` incluido), `unique_by` (dos elementos de un array JSON comparten valor en un campo especificado por `uniqueBy`), `date_min`, `date_max`, `geopoint_range`. | Consulta el mensaje; indica la tabla, la columna y cada infracción. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | El cuerpo escribe en una columna marcada como `.private()` o `.access({ write: [] })` —la misma regla con dos sintaxis. Son de asignación exclusiva por el servidor: un hash de contraseña, un token de verificación. A diferencia de `FIELD_NOT_WRITABLE`, esta es la misma respuesta para cualquier cliente, incluido `admin`. | Elimina el campo. Consulta [Acceso a campos](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Un valor no es compatible con el tipo de su columna. | Consulta el mensaje; nombra la columna. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | El cuerpo nombra un campo que la tabla no posee —incluido un argumento `id` en una tabla con otra clave principal. | Comprueba el nombre; el mensaje ("Table 'x' has no column 'f'. Known columns: …") enumera las columnas. |
| `VECTOR_CURSOR_UNSUPPORTED` | 400 | Se combinó un cursor (`after` / `startAfter`) con una búsqueda vectorial. Las filas se ordenan según una distancia computada por consulta, la cual no puede usarse como cursor, por lo que un listado vectorial no incluye `nextCursor`. | Pagina las filas más cercanas mediante `limit`/`offset`. |
| `WRITE_DENIED` | 403 | Una regla de seguridad o política de RLS rechazó la escritura. | Comprueba el `rls` de la tabla. |

## `PG_<SQLSTATE>` — una restricción que la base de datos rechazó

Una escritura que Postgres rechaza por un motivo derivado de los *datos del cliente* responde
con el SQLSTATE en el código: `PG_23505`, `PG_23503`, y similares. Se trata de una
familia, no de una lista fija —Postgres define cientos de SQLSTATEs—, pero únicamente dos
clases la alcanzan en la práctica, pues solo esas dos son responsabilidad del cliente:

- **clase 23**, infracción de restricción de integridad: un duplicado, una clave foránea que
  apunta a la nada, una columna NOT NULL dejada vacía;
- **clase 22**, excepción de datos: un valor incompatible con el tipo de la columna.

Cualquier otra causa —una conexión caída, una columna inexistente, un problema de privilegios—
es responsabilidad del servidor y se mantiene como un `500`. Por lo tanto, `code.startsWith("PG_")` es una comprobación
segura para determinar que "la fila enviada era incorrecta", siendo las cuatro siguientes las que
un cliente encuentra habitualmente. `details.dbCode` contiene el mismo SQLSTATE para todas ellas, y
el mensaje nombra la restricción.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | No se pudo interpretar un valor como el tipo de la columna —el equivalente en escritura de `INVALID_FILTER_VALUE`. | Envía un valor del tipo correspondiente a la columna. |
| `PG_23502` | 400 | Una columna `NOT NULL` se dejó vacía. | Envía el campo o asigna un valor por defecto a la columna. |
| `PG_23503` | 400 / 409 | Al guardar, una clave foránea apunta a una fila que no existe (400). Al eliminar, otras filas todavía referencian a esta (409; una clave con `RESTRICT` produce `PG_23001`, también 409). | Crea la fila de destino primero o corrige el id; al eliminar, elimina o reasigna las filas dependientes primero. |
| `PG_23505` | 409 | Se infringió una restricción de unicidad. El mensaje especifica la restricción. | Usa un valor diferente o actualiza la fila existente. |

## Almacenamiento

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `INVALID_LIST_OPTIONS` | 400 | El `maxResults` de un listado de almacenamiento no es un entero mayor o igual a 1, o su `pageToken` no fue emitido por la fuente. Un tamaño de página inferior a uno devolvía antes una página vacía con el mismo token, provocando un bucle `while (pageToken)` infinito. | Envía un `maxResults` positivo y reenvía `nextPageToken` intacto. |
| `INVALID_STORAGE_BUCKET` | 400 | El nombre del bucket está malformado. | Comprueba el nombre. |
| `INVALID_STORAGE_KEY` | 400 | La clave del objeto está malformada, escapa de su prefijo o se encuentra bajo un prefijo reservado (`_rebase/renditions/`, `_rebase/maintenance/`). | Comprueba la clave. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | Los parámetros de transformación de imagen están fuera de rango o resultan contradictorios. | Consulta [Almacenamiento](/docs/backend/storage/). |
| `STORAGE_BROKER_REFUSED` | 502 | El almacenamiento de plataforma (`STORAGE_TYPE=platform`) solicitó al intermediario (broker) de almacenamiento de la plataforma firmar una petición, y el broker la rechazó por un motivo desconocido para este servidor. El mensaje contiene el código y motivo del broker. | Revisa el estado de la plataforma; si persiste, reporta el código. |
| `STORAGE_FILE_TOO_LARGE` | 413 | La subida supera los `maxBytes` declarados por la columna de destino `col.storage()`. Se valida en el servidor, no solo en el navegador. `details` contiene la columna, el límite y el tamaño real. | Sube un archivo más pequeño o aumenta `maxBytes` en la columna. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | El tipo de archivo subido no está en la lista `accept` de la columna, o no está en `allowedMimeTypes` de la fuente de almacenamiento. `details` contiene la columna (o la lista de la fuente), la lista de aceptados y el content type enviado. | Sube un tipo permitido o amplía `accept` / `allowedMimeTypes`. |
| `STORAGE_MISCONFIGURED` | 502 | El bucket de S3 o GCS configurado para esta fuente no existe, o el proveedor rechazó las credenciales de este despliegue. El mensaje indica el bucket; `details.reason` es `NoSuchBucket` o el rechazo del proveedor. Antes, un bucket inexistente se interpretaba como "archivo no encontrado" en cada archivo. | Corrige el nombre del bucket (`S3_BUCKET` / `GCS_BUCKET`, `__<KEY>` para una fuente nombrada) o los permisos de las credenciales. |
| `STORAGE_NOT_CONFIGURED` | 501 / 503 | No hay un backend de almacenamiento configurado en este servidor, o ninguno es el predeterminado y la petición no indica ninguna fuente; el mensaje nombra las fuentes disponibles (501). Una subida reanudable cuya fuente desapareció antes de completarse devuelve 503. | Configura S3, GCS o almacenamiento local, o especifica una fuente con `?storageId=`. |
| `STORAGE_OBJECT_TOO_LARGE` | 413 | Una subida a almacenamiento de plataforma requiere más partes de las que el almacén de objetos permite para un único archivo. | Sube un archivo más pequeño. |
| `STORAGE_PROVIDER_ERROR` | 502 | El almacén de objetos rechazó una transferencia de plataforma que el broker había firmado, o respondió sin los datos requeridos (un id de subida, el ETag de una parte). `details.status` es el estado HTTP del almacén. | Reintenta; si persiste, comprueba el estado de la plataforma. |
| `STORAGE_QUOTA_EXCEEDED` | 413 | El almacenamiento de plataforma del proyecto está lleno, por lo que el broker no firmó la subida. | Elimina archivos o aumenta el límite de almacenamiento del proyecto. |
| `STORAGE_RATE_LIMITED` | 429 | El broker de almacenamiento de la plataforma está limitando las peticiones de este proyecto. | Reduce el ritmo de peticiones y reintenta. |
| `STORAGE_SAME_LOCATION` | 400 | `POST /api/admin/storage/move` con `deleteSource` (`rebase storage move --delete-source`) entre dos fuentes configuradas en el mismo bucket o directorio. Cada archivo se consideraría ya presente en el destino por tratarse del mismo archivo, y eliminar la copia de origen borraría la única existente. Nada fue movido ni eliminado. | Apunta la columna a la otra fuente; sus archivos ya están allí. |
| `STORAGE_SCAN_INCOMPLETE` | 409 | `DELETE /api/admin/storage/orphans` (`rebase storage orphans --delete`) no pudo leer todas las tablas, por lo que un archivo referenciado por alguna de ellas parecería huérfano. Con `?scan=`, el escaneo indicado es el que no pudo leer todas las tablas. Nada fue eliminado; `details.unscanned` enumera cada tabla y la razón por la que no pudo leerse. | Resuelve lo que impide leer esas tablas y vuelve a ejecutarlo. |
| `STORAGE_SCAN_NOT_FOUND` | 404 | `GET /api/admin/storage/orphans/scans/:id` o `DELETE /api/admin/storage/orphans?scan=:id` especifica un escaneo que la fuente no posee. Los escaneos se conservan por 7 días en la fuente analizada, por lo que un `storageId` distinto al del escaneo tampoco encontrará resultados. | Envía el `storageId` del escaneo, o inicia otro escaneo. |
| `STORAGE_SCAN_NOT_COMPLETE` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` especifica un escaneo que aún está en estado `queued` o `running`, o que falló (`failed`). Nada fue eliminado; `details.status` indica el estado. | Espera a que el escaneo finalice, o inicia otro. |
| `STORAGE_SCAN_EXPIRED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` especifica un escaneo completado hace más de 15 minutos. Nada fue eliminado. | Inicia otro escaneo y elimina desde este. |
| `STORAGE_SCAN_DELETION_STARTED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` apunta a un escaneo cuyos huérfanos ya se están eliminando. | Consulta el progreso en `deletion` mediante `GET /api/admin/storage/orphans/scans/:id`. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | La fuente de almacenamiento está declarada pero carece de credenciales en este entorno. | Configura las variables de entorno de esa fuente. |
| `STORAGE_UNAVAILABLE` | 503 | El broker de almacenamiento de la plataforma es inalcanzable, o temporalmente no computa las subidas frente a la cuota. Las lecturas de un archivo obtenido en la última hora continúan funcionando durante una interrupción. | Reintenta en unos instantes. |
| `STORAGE_WRITE_FAILED` | 502 | El backend de almacenamiento rechazó o interrumpió la escritura. | Revisa sus propios logs y credenciales. |
| `TRANSFORM_OVERLOADED` | 503 | Hay demasiadas transformaciones de imágenes en ejecución simultánea. | Reintenta; considera colocar una CDN por delante. |
| `UNKNOWN_STORAGE_SOURCE` | 400 / 404 | La petición especificó una fuente de almacenamiento (`?storageId=`) que este proyecto no declara. Un `bucket` que este despliegue no atiende devuelve este mismo código con estado **404** (en un listado, subida, carpeta o subida reanudable a S3 o GCS) —el almacén es lo que falta, y `details` lista los buckets y las fuentes disponibles. Ambos se reportaban antes como "archivo no encontrado", idéntico a una clave inexistente. | Declara la fuente en `config/resources.ts`, o consulta `GET /api/storage/sources`. |
| `UPLOAD_LOCKED` | 423 | El `PATCH` de una subida reanudable llegó mientras otro fragmento de la misma subida aún se estaba recibiendo —casi siempre un cliente reintentando el fragmento en tránsito. Se rechaza en lugar de ponerse en cola, siguiendo la conducta de tusd. | Consulta el offset mediante `HEAD /api/storage/tus/:id` y reanuda desde allí; tus-js-client reintenta automáticamente con retroceso exponencial. Consulta [Subidas reanudables (TUS)](/docs/backend/storage-resumable-uploads/). |

## Funciones personalizadas

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | No se sirve ninguna función con ese nombre —o existe una, pero sus propias rutas no cubren el path posterior. A un cliente autenticado se le informa qué funciones *sí* están disponibles; a uno anónimo no, ya que esa lista representa un inventario de cada endpoint personalizado. Cuando un archivo con ese nombre no pudo cargarse, el mensaje se lo indica a un cliente autenticado nombrando el archivo: esa es la diferencia entre un error tipográfico y un fallo de despliegue. Un cliente anónimo recibe la respuesta de nombre desconocido estándar, idéntica a si nada coincidiera. | Comprueba el nombre en `GET /api/functions` o revisa el log de arranque para detectar archivos no cargados. |
| `FUNCTION_TIMEOUT` | 504 | El controlador superó su tiempo límite de ejecución. Sigue ejecutándose; no puede cancelarse desde aquí. El mensaje y `details` (`{ timeoutMs, source }`) especifican qué límite aplicó y dónde fue configurado. | Asigna un `AbortSignal` a las llamadas salientes, declara el `timeoutMs` propio de la función (`defineFunction(…, { timeoutMs })`, como máximo `REBASE_FUNCTIONS_MAX_TIMEOUT_MS`), o amplía `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Este proceso redirige las funciones por proxy a otro, el cual no respondió. | Comprueba que la unidad de funciones esté ejecutándose. |

## Funciones SQL como RPC

`POST /api/rpc/<name>` — consulta [Funciones SQL como RPC](/docs/backend/rpc/). Un argumento incorrecto devuelve `VALIDATION_CONSTRAINT` (400), con `details.violations` nombrando cada campo, al igual que en la API de datos; una credencial sin `data:read` devuelve `SCOPE_MISSING` (403); un RPC público que excede su límite devuelve `RATE_LIMITED` (429).

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `RPC_NOT_FOUND` | 404 | No se exporta ningún `defineRpc` con ese nombre desde `backend/schema/index.ts`. Solo las funciones declaradas son invocables, por lo que una función que existe en la base de datos pero no fue declarada también devuelve esto. | Declárala con `defineRpc` o comprueba el nombre. |
| `METHOD_NOT_ALLOWED` | 405 | El RPC existe y fue invocado con un método distinto de `POST`. La respuesta incluye `Allow: POST`. | Realiza un `POST` con un cuerpo JSON de argumentos con nombre. |
| `INVALID_RPC_BODY` | 400 | El cuerpo es JSON, pero no es un objeto de argumentos con nombre (es un array, una cadena, etc.). | Envía `{ "argument": value }`, o sin cuerpo si no requiere argumentos. |
| `RPC_ARGUMENTS_MISMATCH` | 400 | Ninguna sobrecarga de la función SQL acepta los argumentos enviados: se omitió un parámetro sin `DEFAULT`, o se especificó uno que no existe. El mensaje lista los parámetros aceptados. | Envía los argumentos que la función espera y márcalos como `.required()` en `args`. |
| `RPC_INVALID_ARGUMENT` | 400 | Postgres rechazó un valor por ser incompatible con el tipo del parámetro de la función (un SQLSTATE de clase 22): `"abc"` para un `uuid`, una etiqueta inexistente en un enum. | Envía un valor del tipo correspondiente al parámetro. |
| `RPC_EXCEPTION` | 400, o el estado indicado por un SQLSTATE `PTnnn` | La función lanzó una excepción: `RAISE EXCEPTION '…'` responde 400 con su mensaje, y `details` incluye `sqlState`, `detail` y `hint`; `RAISE SQLSTATE 'PT404'` responde 404, de forma idéntica a PostgREST. | El mensaje es el propio definido en la función. |
| `RPC_READ_ONLY` | 500 | La función ejecutó una escritura, y un RPC se ejecuta en una transacción de solo lectura a menos que se declare con `write: true`. | Añade `write: true` en su `defineRpc`. |
| `RPC_FUNCTION_MISSING` | 500 | El RPC está declarado pero la base de datos no contiene ninguna función con ese esquema y nombre. Postgres almacena nombres sin comillas en minúsculas. | Crea la función, o corrige el nombre o `schema` en `defineRpc`. |
| `RPC_AMBIGUOUS` | 500 | Múltiples sobrecargas de la función aceptan los argumentos enviados. | Elimina las sobrecargas a las que el RPC no deba acceder, o cámbiales el nombre. |

## Notificaciones push

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `PUSH_ENDPOINT_REFUSED` | 400 | El endpoint de la suscripción no pertenece a un servicio push reconocido por navegadores (FCM, Mozilla, Apple, Windows) sobre `https`. El servidor envía peticiones a esa dirección en cada notificación, por lo que no acepta otros destinos. | Envía `PushSubscription.toJSON()` tal como lo genera el navegador, o añade un servicio push de prueba a `push.allowedHosts`. Consulta [Notificaciones push](/docs/backend/push-notifications/#routes). |
| `PUSH_NEEDS_A_USER` | 403 | Una clave de API o la clave de servicio invocó una ruta push. Una suscripción corresponde al navegador de una persona autenticada. | Invócala con la sesión de ese usuario. |
| `PUSH_NOT_CONFIGURED` | 503 | Push está habilitado pero no puede realizar envíos: faltan las claves VAPID en producción o no se pudo preparar su tabla. El mensaje indica cuál es la causa. | Configura `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` y `REBASE_VAPID_SUBJECT`. Consulta [Notificaciones push](/docs/backend/push-notifications/#keys). |

## Tareas programadas (cron jobs)

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `CRON_JOB_ALREADY_EXECUTING` | 409 | Ejecución manual de una tarea cron que ya se encuentra en curso —en el proceso que respondió o en otro que mantiene el lease de ejecución de la tarea, como el worker detrás de un proceso `api`. No se ejecutó nada. La omisión se refleja en el historial del trabajo y `details.log` corresponde a esa entrada; su línea especifica el proceso que lo ejecuta. | Intenta de nuevo cuando esa ejecución haya concluido. Consulta [Tareas cron](/docs/backend/cron-across-instances/#concurrency-guarding). |

## Interfaces de administración y edición de esquemas

Estos códigos indican que una funcionalidad está desactivada o sin configurar, no que la petición
fuera incorrecta. Cada uno se reporta también en la ruta `/status` correspondiente con un `200`,
permitiendo a un panel deshabilitar la opción visualmente en lugar de mostrar un error.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | Se invocó una interfaz de administración exclusiva en un servidor sin autenticación configurada, impidiendo distinguir a un administrador de un tercero. | Define `auth.jwtSecret` o pasa un `AuthAdapter`. |
| `BRANCH_DIFF_STALE` | 409 | Se envió a `POST /api/admin/branches/:name/merge` la huella (fingerprint) de un diff que ya no es válido: la rama o su padre sufrieron cambios desde entonces. Nada fue escrito. | Consulta el diff nuevamente, revísalo y fusiona con su nuevo `fingerprint`. |
| `BRANCH_DIFF_UNSUPPORTED` | 501 | La fuente de datos no puede comparar ramas: carece de soporte SQL o no admite ramificación (sin conexión admin). | Usa un backend de Postgres con `adminConnectionString` configurado. |
| `BRANCH_MERGE_BLOCKED` | 409 | Una tabla con diferencias no puede fusionarse —añadida o eliminada por la rama, columnas o clave primaria discrepantes, sin clave primaria, exceso de filas para comparar, o reescrita desde que se creó la rama (`TABLE_REWRITTEN`). Una tabla cuyas filas no se pudieron comparar bloquea la fusión incluso si su recuento marca 0: son desconocidas, no cero. `details.tables` enumera cada una y su motivo. Nada fue escrito. | Aplica el esquema primero mediante tus migraciones, o fusiona con `skipBlocked: true` para ignorar esas tablas. |
| `BRANCH_MERGE_CONFLICT` | 409 | Se modificaron filas simultáneamente en la rama y en su padre, y `onConflict` estaba en `"abort"` (por defecto); o el padre rechazó parte de la fusión —una fila cambió en el intertanto, un trigger la omitió, una política la ocultó. Nada fue escrito. | Elige qué versión prevalece con `onConflict: "branch"` o `"target"`, o lee el diff de nuevo. |
| `BRANCH_MERGE_FAILED` | 409 | El padre rechazó las filas de la rama dentro de la sentencia de fusión —una restricción, una etiqueta de enum o una clave foránea existente que las filas de la rama rompen, usualmente debido a discrepancias entre ambos esquemas. `details` contiene `sqlState`, `table`, `constraint` y `detail`. Nada fue escrito. | Revisa los cambios de esquema del diff, alinea el esquema del padre con tus migraciones o corrige las filas de la rama antes de fusionar nuevamente. |
| `BRANCH_NOT_FOUND` | 404 | Ninguna rama tiene ese nombre en el registro. | `rebase db branch list`, o el panel de Ramas, muestra las existentes. |
| `CONTRACT_UNAVAILABLE` | 404 | El contrato del proyecto se sirve únicamente con autenticación configurada —describe cada tabla y relación. | Configura autenticación. `/meta/schema-version` se sirve siempre. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | No hay buzón de desarrollo activo. Los correos se capturan solo cuando `SMTP_HOST` no está configurado y `NODE_ENV` no es production. | Desactiva `SMTP_HOST` en desarrollo o consulta la bandeja de entrada real. |
| `DOCS_UNAVAILABLE` | 404 | `GET /api/docs` se sirve a los clientes a quienes `GET /api/schema/tables` describe las tablas; al no haber autenticación configurada, no hay a quién describirlas. | Configura autenticación, o publica toda la documentación a cualquiera con `enableSwagger: true` (`REBASE_ENABLE_SWAGGER=true`). |
| `INVALID_CHANGE` | 400 | El cambio de esquema propuesto no está bien formado. | Consulta el mensaje. |
| `SCHEMA_CHANGE_FAILED` | 400 | La aplicación del cambio de esquema falló por un motivo no cubierto por códigos más específicos. | Consulta el mensaje; contiene el error original literal. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | El cambio es válido pero no puede aplicarse al esquema en su estado actual. | Consulta el mensaje. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | El repositorio contiene cambios sin commitear, impidiendo aplicar la edición de forma segura. | Haz commit o stash y luego reintenta. |
| `SCHEMA_EDIT_REFUSED` | 400 | El editor de esquemas rechazó la edición: lo que modificaría está escrito en código que no reescribe (un spread, un helper, una clave calculada), o la edición es una operación que nunca realiza (renombrar una tabla, eliminar la última regla). `details.problems` enumera cada uno. Nada fue escrito. | Consulta el mensaje. Realiza el cambio manualmente en `backend/schema`. |
| `SCHEMA_EDIT_DOES_NOT_COMPILE` | 400 | La edición puede aplicarse, pero dejaría un esquema que no compila —una relación hacia una tabla eliminada, una regla sobre una columna retirada. `details.problems` contiene las advertencias del compilador con su tabla y columna. Nada fue escrito. | Modifica las tablas de las que depende primero, o edita manualmente en `backend/schema`. |
| `SCHEMA_EDIT_STALE_FILE` | 409 | Un archivo que la edición reescribe cambió en disco tras prepararse la edición (guardado en el IDE, otro proceso). Nada fue escrito. | Recarga y vuelve a preparar la edición sobre el archivo actualizado. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Una clave de API u otra entidad de máquina intentó aplicar un cambio de esquema. | Inicia sesión como usuario o establece `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | La edición de esquema en caliente requiere `schemaDir` (el directorio `backend/schema`) o `liveSchema.repository`, y este servidor inició sin ninguno. El código mantiene su denominación histórica. | Configura alguno de los dos. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | La planificación funciona, pero no hay repositorio donde hacer commit del cambio —un despliegue ejecutando un bundle compilado, o un servidor cuyo `backend/schema` no está bajo git (un apply siempre genera commit). | Ejecuta `git init` en el proyecto y reinicia el servidor (el repositorio se detecta al arrancar), o define `liveSchema.repository`. |
| `SCHEMA_EDITING_PROVISIONING_OFF` | 409 | Este despliegue no altera su base de datos (`REBASE_PROVISION=false`), por lo que no se pueden aplicar cambios desde el panel. | Haz commit solo en el código fuente y deja que el proceso a cargo de la base de datos lo aplique. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Este controlador no puede planificar cambios de esquema. | La edición en caliente está disponible en Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | Las tablas se inspeccionan directamente desde la base de datos, por lo que no existen archivos de código que editar. | Modifica el esquema mediante una migración. |
| `SCHEMA_EDITOR_DISABLED` | 501 | El editor de esquemas está desactivado en este servidor. Un bundle compilado siempre responde esto. | Habilítalo con `schemaEditor`. En un bundle, define `REBASE_LIVE_SCHEMA_REPOSITORY` para editar `backend/schema` mediante un repositorio —consulta [Edición de esquemas en vivo](/docs/backend/live-schema-editing#from-a-built-bundle). |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | El editor de esquemas requiere `ts-morph`, que no se encuentra instalado. | Instálalo en el paquete que ejecuta el backend y reinicia: `pnpm --dir backend add -D ts-morph@28.0.0` desde la raíz de un proyecto generado, o `pnpm add -D ts-morph@28.0.0` si el backend es la raíz. El mensaje indica el comando específico para tu proyecto. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | El servidor carece de `schemaDir`, dejando al editor sin destino de escritura. El código mantiene su nombre original. | Define `schemaDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | El editor está inhabilitado bajo `NODE_ENV=production`: los archivos de un servidor en producción se recompilan desde tu repositorio en cada despliegue, perdiéndose cualquier edición local. | Edita `backend/schema` en desarrollo y despliega, o configura `liveSchema.repository` para commitear directamente. |
| `SCHEMA_UNAVAILABLE` | 404 | `GET /api/schema/tables` en un backend sin autenticación configurada: no hay cliente para quien filtrar las tablas, y `auth.requireAuth: false` no altera esto. | Configura un adaptador de autenticación o `auth.jwtSecret`. Consulta [Endpoints](/docs/backend/endpoints/#schema). |
| `TABLE_NOT_FOUND` | 404 | `GET /api/schema/tables/:slug` indica una tabla que este cliente no tiene permitida —ninguna con ese slug, o una fuera del alcance de los scopes de su credencial. | Comprueba el slug y los scopes `data:*` de la credencial. |
| `UI_PREFERENCES_NEED_A_PERSON` | 403 | `/api/admin/ui-config` fue invocado con una clave de API, un token de plataforma o la clave de servicio. Las preferencias de UI pertenecen a un usuario con sesión iniciada. | Inicia sesión como usuario. |
| `UI_PREFERENCES_TOO_LARGE` | 413 | Las preferencias de UI de una tabla superan los 64 KB. | Guarda menos datos: las preferencias almacenan visualización, no datos. |
| `UI_PREFERENCES_UNSUPPORTED` | 501 | El controlador de este backend no admite SQL, por lo que no guarda preferencias de UI; el panel las almacena en el navegador. | Nada que corregir: las preferencias permanecen locales al navegador. |
| `UI_CONFIG_FILE_INVALID` | 500 | `frontend/src/cms/ui-config.json`, donde se guardan las preferencias de UI del workspace en desarrollo, no es un JSON válido. | Corrígelo o elimínalo; el panel lo reescribirá en el próximo guardado. |
| `SQL_EXPORT_UNSUPPORTED` | 501 | `POST /api/admin/sql/csv` no puede transmitir resultados aquí: la base de datos de desarrollo en proceso (PGlite) tiene una sola conexión, y retener un cursor durante una descarga bloquearía todas las demás consultas; o la fuente de datos carece de cursor SQL. | Apunta `DATABASE_URL` a un Postgres propio (`rebase dev --docker` inicia uno), o usa `LIMIT` y exporta las filas en pantalla. |

### Conciliación de esquemas (Schema reconcile)

[`rebase schema reconcile`](/docs/cli/schema/#rebase-schema-reconcile) planifica
a través de `POST /api/admin/schema/reconcile/plan` y aplica los cambios mediante
`/reconcile/apply`. Un rechazo no modifica nada; únicamente `SCHEMA_RECONCILE_FAILED`
puede dejar parte de un plan aplicado.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `INVALID_RECONCILE` | 400 | El cuerpo no es un objeto JSON, o `drop` no es una lista de cadenas `"<table>.<column>"`. | Envía `{ "drop": ["voice_cache.wav"] }`, o no incluyas `drop`. |
| `SCHEMA_RECONCILE_FAILED` | 400 | Una sentencia falló a medio camino. Las sentencias anteriores se ejecutaron y permanecen aplicadas; `details.applied` las lista. | Corrige lo que el mensaje indique y genera el plan de nuevo: el nuevo plan excluirá lo ya ejecutado. |
| `SCHEMA_RECONCILE_INVALID` | 400 | El plan no puede aplicarse y el mensaje lista los motivos: un `drop` sin formato `<table>.<column>`, una tabla o columna inexistente, o una columna que la tabla todavía declara. `details.plan` contiene el plan. | Corrige la lista `drop`. Una columna declarada se elimina retirándola de su `defineTable`, desplegando y luego conciliando. |
| `SCHEMA_RECONCILE_STALE` | 409 | La base de datos o las tablas sufrieron cambios desde el plan que confirmaste. `details.plan` contiene el nuevo plan. | Revisa el nuevo plan y confirma su `digest`. |
| `SCHEMA_RECONCILE_UNCONFIRMED` | 400 | Se invocó `/reconcile/apply` sin `confirm`. | Genera el plan primero y envía el `digest` del plan como `confirm`. La CLI hace esto automáticamente al escribir `yes`. |
| `SCHEMA_RECONCILE_UNSUPPORTED` | 503 | El controlador de este backend no puede planificar una conciliación o no admite SQL. | La conciliación funciona sobre Postgres. |

### Por qué no se puede fusionar la tabla de una rama

`BRANCH_MERGE_BLOCKED` enumera cada tabla rechazada en `details.tables`, junto con uno
de estos códigos. El mismo código figura en la propiedad `blocked` de la tabla dentro del diff,
permitiendo a Studio advertirlo antes de pulsar **Merge**. Ninguno es una respuesta
independiente por sí mismo.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `COLUMNS_DIFFER` | — | Las columnas de la tabla difieren entre la rama y su padre. Las filas se comparan según las columnas compartidas. | Añade las columnas faltantes al padre mediante tus migraciones (`rebase db push`), y luego fusiona. Una migración que reescribe la tabla —como un cambio de tipo de columna— la convierte en `TABLE_REWRITTEN`: fusiona antes de ese cambio o recrea la rama tras él. |
| `NO_PRIMARY_KEY` | — | La tabla carece de clave primaria, impidiendo comparar filas individualmente; el diff solo entrega recuentos de filas. | Añade una clave primaria a la tabla o traslada sus filas manualmente. |
| `PRIMARY_KEY_DIFFERS` | — | Las columnas de la clave primaria, o sus tipos, difieren entre ambas. | Aplica el esquema al padre primero. |
| `TABLE_ADDED` | — | La rama creó la tabla. Una fusión nunca crea tablas. | Créala en el padre mediante tus migraciones y luego fusiona sus filas. |
| `TABLE_DROPPED` | — | La rama eliminó la tabla. Una fusión nunca elimina tablas. | Elimínala mediante tus migraciones. |
| `TABLE_REWRITTEN` | — | Uno de los lados reescribió todas las filas de la tabla tras crearse la rama —un cambio de tipo de columna, un `ADD COLUMN` con valor por defecto volátil, `VACUUM FULL`, `CLUSTER`— haciendo que todas figuren como modificadas y volviendo imposible distinguir qué lado cambió cada fila. | Fusiona la rama antes de esa migración o créala de nuevo desde el padre tras ella. |
| `TOO_LARGE` | — | La tabla contiene más filas en uno de los lados de las que un diff puede comparar individualmente (100.000 por defecto, `maxRowsPerTable`). | Aumenta `maxRowsPerTable` tanto en el diff como en la fusión, o transfiere las filas por otra vía. |

## Códigos genéricos

Una ruta utiliza uno de estos códigos cuando no aplica ninguno más específico.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Malformada, y ningún código más específico aplica. | Consulta el mensaje. |
| `UNAUTHORIZED` | 401 | No autenticado, o la credencial fue rechazada. | Inicia sesión o renueva el token. |
| `FORBIDDEN` | 403 | Autenticado, pero no autorizado. | Reintentar con la misma identidad no servirá. |
| `CONFLICT` | 409 | Conflicto con el estado actual. | Consulta el mensaje. |
| `INTERNAL_ERROR` | 500 | Fallo interno en el servidor. El mensaje es intencionalmente genérico. | Cita el `requestId`; el motivo reside en los logs. |
| `NOT_CONFIGURED` | 503 | Una dependencia requerida por esta ruta no está configurada en este servidor. | Consulta el mensaje. |
| `SERVICE_UNAVAILABLE` | 503 | No se pudo alcanzar un servicio del que depende la petición: un bucket de S3 o MinIO, o un host al que una función hace `fetch()` que rechaza la conexión o no resuelve. El log del servidor indica el host; la respuesta no. Una base de datos inalcanzable produce `DATABASE_UNAVAILABLE`. Una conexión fallida hacia tal servicio responde esto. | Reintenta; revisa los logs. |

## Cómo se mantiene exacta esta página

`pnpm verify:docs` falla si un código que el servidor puede emitir no figura en estas
tablas, si una tabla lista un código que nada puede producir, si los estados de una fila no coinciden
exactamente con los que emite el código fuente, o si una familia como `PG_<SQLSTATE>` carece de fila
para un SQLSTATE habitual para los clientes. El script a cargo es
`tooling/scripts/docs-verify/check-error-codes.mjs`.

El proceso se valida a sí mismo en primer lugar. La inspección analiza los códigos desde TypeScript en lugar de
consultar un servidor en ejecución, por lo que sus puntos ciegos son silenciosos por diseño: en el pasado no
lograba detectar un código envuelto en un wrapper de una sola línea, o uno escrito tras un mensaje que
contenía un `)`, reportando erróneamente que "todos los códigos emitibles están documentados"
en una página a la que le faltaban diecisiete de ellos. Debido a esto, la verificación ejecuta un fixture con
esas estructuras exactas antes de procesar esta página, y rechaza validar nada si no es capaz de detectarlos.
