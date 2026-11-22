---
sourceHash: 5ee5cd26135e6556
title: Códigos de error
sidebar_label: Códigos de error
description: Cada código de error que un backend de Rebase puede devolver, con su estado HTTP, qué significa y qué hacer al respecto — además del envelope de respuesta, X-Request-ID y las reglas de details.
---

Cada fallo devuelto por un backend de Rebase utiliza un único envelope y lleva un
`code` estable. El código es el elemento sobre el cual ramificar la lógica: el mensaje está
escrito para una persona y su redacción puede variar, el estado HTTP se comparte
entre una docena de problemas distintos, y el código no sufre ninguno de esos inconvenientes.

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
  host, un rol o el nombre de una columna.
- **`code`** — uno de los valores que figuran a continuación. Estable a lo largo de versiones menores.
- **`details`** — opcional, y nunca garantizado. Consulta las reglas a continuación.
- **`requestId`** — presente siempre que la solicitud haya pasado por el middleware
  de request-ID, lo que ocurre en cada ruta bajo `basePath`.

### `X-Request-ID`

Cada solicitud bajo `basePath` recibe un ID: el encabezado `X-Request-ID` del
emisor cuando es un UUID; de lo contrario, uno nuevo. Se devuelve en la
respuesta como `X-Request-ID`, se incluye en el envelope de error como `requestId` y se
adjunta a la línea de log del servidor para dicha solicitud.

Esa es la clave de unión. Si la indicas en un reporte de error, un operador podrá encontrar la
única línea de log que explica el fallo, conteniendo el motivo que nunca se le
mostró al cliente.

Enviar el tuyo propio es la forma de hacer que una traza sobreviva a un salto: una pasarela (gateway) o un ejecutador de trabajos que
reenvíe el encabezado mantiene un mismo ID a través de todos los servicios que procesaron la solicitud.
Un valor no válido se ignora en lugar de ser rechazado —no merece la pena hacer fallar una solicitud por un
encabezado mal formado por parte del emisor—, por lo que no debes asumir que el ID que enviaste sea
el ID que recibiste. Lee el encabezado de respuesta.

### Qué contiene `details`

`details` tiene fines de diagnóstico, no contractuales. Se rige por tres reglas:

1. **Todo lo que una ruta establezca explícitamente se devuelve siempre.** Estos son los
   errores propios del emisor descritos con precisión: qué campo de filtro era desconocido,
   qué relación no admite escritura, qué valor no coincidía con su tipo.
2. **Los diagnósticos de la base de datos se recortan en producción.** Cuando el fallo proviene
   de Postgres, `details.dbCode` —el SQLSTATE— está siempre presente: identifica la
   clase de problema y no revela nada acerca de los datos. `dbMessage`,
   `detail` e `hint` solo se añaden cuando `NODE_ENV` no es `production`,
   debido a que Postgres incluye el contenido de las filas en ellos. `23505` informa
   `Key (email)=(a@b.c) already exists.`, lo que respondería a "¿está registrada esta persona?"
   para cualquier dirección que alguien decida probar.
3. **Nunca ramifiques tu lógica en función de `details`.** Ramifica sobre `code`. Lo que hay bajo `details` es
   cualquier cosa que haya sido útil para una persona en ese punto de llamada concreto, y cambia.

## Cómo interpretar un estado

| Estado | Qué indica sobre la solicitud |
| --- | --- |
| `400` | Malformada, o solicita algo que no existe en el esquema. Corrige la solicitud. |
| `401` | No autenticada, o la credencial ha expirado. Inicia sesión o renueva el token. |
| `403` | Autenticada, pero sin permisos. Reintentar con la misma identidad no servirá. |
| `404` | No existe dicha ruta, tabla o fila — o es una fila que la seguridad a nivel de fila (RLS) oculta. |
| `409` | Conflicto con el estado existente: un duplicado o una escritura concurrente. |
| `413` `415` `422` | El cuerpo es demasiado grande, el tipo de medio es incorrecto o fue rechazado semánticamente. |
| `429` | Límite de tasa excedido (rate limited). Espera; el mensaje indica durante cuánto tiempo. |
| `500` | El fallo está en el servidor o en su base de datos, no en el emisor. Revisa los logs. |
| `501` | La ruta existe, pero este despliegue no puede servirla — una característica desactivada o no configurada. |
| `502` `503` `504` | Una dependencia es inalcanzable, no está configurada o es demasiado lenta. |

## Autenticación y cuentas

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | La ruta requiere un segundo factor y la sesión solo cuenta con uno. | Completa el desafío MFA y luego reintenta. |
| `ALREADY_VERIFIED` | 400 | La dirección o el factor ya han sido verificados. | Nada — el estado deseado ya se cumple. |
| `ACCOUNT_OUTRANKS_CALLER` | 403 | La cuenta que se está editando, restableciendo o eliminando posee un rol o ámbito que el emisor no tiene. `details.beyond` los enumera. | Haz que alguien que los posea realice el cambio. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | El inicio de sesión anónimo está desactivado en este servidor. | Actívalo o inicia sesión con una identidad real. |
| `ANONYMOUS_NOT_ALLOWED` | 403 | Una sesión de invitado intentó aprobar un inicio de sesión en un dispositivo. Un invitado no tiene una cuenta que vincular a un dispositivo. | Inicia sesión con una cuenta y luego apruébalo. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Una clave de API intentó listar, crear, modificar o revocar claves de API, ya sean de su mismo tipo o personales. | Gestiona las claves como una persona con `keys:write` o mediante la clave de servicio. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Se ejecutó una ruta protegida sin el middleware de autenticación de Rebase previo, por lo que nunca se evaluaron las credenciales del emisor. | Monta la aplicación a través del enrutador de funciones en lugar de hacerlo directamente en tu propio servidor. |
| `BOOTSTRAP_ANONYMOUS` | 403 | Un emisor anónimo intentó realizar el bootstrap del primer administrador. | Inicia sesión primero. |
| `BOOTSTRAP_COMPLETED` | 403 | El primer administrador ya existe. | Haz que un administrador existente otorgue el rol. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | El bootstrap es únicamente para el primer usuario absoluto, y este no lo es. | Haz que un administrador existente otorgue el rol. |
| `CAPTCHA_FAILED` | 400 | El proveedor rechazó el token de CAPTCHA. | Resuelve un nuevo desafío. |
| `CAPTCHA_REQUIRED` | 400 | La ruta requiere un token de CAPTCHA y no se envió ninguno. | Incluye el token. |
| `CHALLENGE_EXHAUSTED` | 401 | Demasiados códigos incorrectos para un mismo desafío MFA. | Inicia un nuevo desafío. |
| `CONFIRMATION_REQUIRED` | 400 | Se invocó una operación DDL destructiva (`DELETE /api/admin/db/tables/:table` o `DELETE …/columns/:column`) sin `{ confirm: "<name>" }`. | Reenvía la solicitud indicando el nombre exacto del objetivo en `confirm`, o pasa `dryRun: true` para previsualizar el SQL. |
| `DDL_REJECTED` | 400, o 409 cuando el objeto ya existe | PostgreSQL rechazó una sentencia que `/api/admin/db/*` ejecutó por ti — un tipo, un valor por defecto, una condición de política, un nombre ya en uso. El mensaje es el de Postgres y `details.dbCode` su SQLSTATE. | Modifica lo que indique el mensaje y vuelve a enviar la solicitud; `dryRun: true` muestra el SQL previamente. |
| `DEVICE_LOGIN_DECIDED` | 409 | El inicio de sesión en dispositivo ya fue aprobado o denegado. Un inicio de sesión se decide una sola vez. | Inicia uno nuevo en el dispositivo. |
| `DEVICE_LOGIN_EXPIRED` | 410 | El inicio de sesión en dispositivo superó sus diez minutos antes de ser resuelto. | Inicia uno nuevo en el dispositivo. |
| `DEVICE_LOGIN_NOT_FOUND` | 404 | Ningún inicio de sesión de dispositivo coincide con ese código de usuario. El sondeo del dispositivo responde con los códigos en minúsculas del RFC 8628: `authorization_pending`, `slow_down`, `access_denied`, `expired_token`, `invalid_grant`. | Comprueba el código comparándolo con el que muestra el dispositivo. |
| `EMAIL_EXISTS` | 409 | Ya existe una cuenta con esa dirección — en el registro, en un cambio de dirección o al seguir un enlace de cambio de dirección cuando otra cuenta tomó la dirección mientras estaba pendiente. | Inicia sesión o solicita un restablecimiento de contraseña; en un cambio de dirección, elige otra. |
| `EMAIL_NOT_CONFIGURED` | 503 | Se solicitaron magic links u OTP y el servidor no tiene transporte de correo configurado. | Configura SMTP o utiliza otro método de autenticación. |
| `EMAIL_NOT_VERIFIED` | 403 | Un inicio de sesión OAuth encontró una cuenta con la misma dirección, pero el proveedor no la verificó, por lo que no está vinculada. | Inicia sesión con el método existente y luego ejecuta `POST /auth/link/<provider>`. |
| `CSRF_REFUSED` | 403 | La protección CSRF está activa (`csrf: { origin }`) y una solicitud sin encabezado `Authorization` provino de un origen no permitido: un POST de formulario autenticado por cookies desde otro sitio, o una solicitud sin cuerpo y sin `Origin`. | Envíala desde un origen permitido, con un cuerpo JSON o con un encabezado `Authorization`. |
| `FACTOR_NOT_VERIFIED` | 400 | El factor MFA se registró pero nunca se confirmó. | Confirma el factor. |
| `ID_EXISTS` | 409 | Una cuenta ya posee el identificador que una importación intenta conservar (`POST /api/admin/users/import`). La importación lo marca como `skipped` y no modifica la cuenta. | Nada, si la cuenta ya se había importado antes. De lo contrario, omite `id` o escoge otro. |
| `IDENTITY_ALREADY_LINKED` | 409 | Esa identidad OAuth pertenece a otra cuenta. | Inicia sesión con ella, o desvincula la identidad en la otra cuenta primero. |
| `IMPERSONATION_FORBIDDEN` | 403 | La solicitud envió `x-rebase-impersonate` y su emisor no tiene permisos para actuar como otro usuario. Solo la sesión propia de un administrador autenticado puede hacerlo, nunca una clave de API o la clave de servicio. | Envíala con la sesión de un administrador u omite el encabezado. |
| `IMPERSONATION_INVALID` | 400 | Se envió `x-rebase-impersonate` vacío. | Envía el UID del usuario como el que actuar u omite el encabezado. |
| `IMPERSONATION_TARGET_NOT_FOUND` | 404 | `x-rebase-impersonate` apunta a un usuario inactivo: ninguna cuenta tiene ese UID o está deshabilitada. | Comprueba el UID. |
| `IMPERSONATION_UNAVAILABLE` | 501 | La autenticación de este backend no puede ejecutar una solicitud como otro usuario porque su `AuthAdapter` no dispone de `resolveUser`. | Implementa `resolveUser` en el adaptador u omite el encabezado. |
| `IMPERSONATION_UNSUPPORTED` | 400 | Se envió `x-rebase-impersonate` a una ruta que no admite la suplantación. Solo la API de datos y las funciones personalizadas lo permiten, y el socket en tiempo real admite `impersonate` en `AUTHENTICATE`. | Envía la solicitud sin el encabezado. |
| `SIMULATION_FORBIDDEN` | 403 | Una solicitud envió un encabezado `x-rebase-simulate-*` (el simulador RLS) o consultó `/api/admin/rls-simulator`, y su emisor no puede simular accesos. Solo la sesión de un administrador autenticado puede hacerlo, nunca una clave de API o la clave de servicio. | Envíala con la sesión de un administrador u omite los encabezados. |
| `SIMULATION_INVALID` | 400 | La simulación estaba malformada: un encabezado vacío, `x-rebase-simulate-api-key-id` combinado con un rol o ID de usuario, o simulación combinada con `x-rebase-impersonate`. | Especifica un rol (opcionalmente con un UID), un ID de usuario o un ID de clave de API. |
| `SIMULATION_READ_ONLY` | 403 | Una escritura, eliminación, `_batch`, reversión de historial o una función personalizada llamada con cualquier verbo que no sea `GET`/`HEAD`/`OPTIONS` incluyó un encabezado `x-rebase-simulate-*`. El acceso simulado es de solo lectura: la escritura se ejecutaría como la identidad simulada, no como el administrador. Las lecturas, incluidas `POST …/query` y `…/count`, siguen ejecutándose. | Deja de simular para realizar modificaciones. |
| `SIMULATION_TARGET_NOT_FOUND` | 404 | La simulación no apunta a ningún usuario activo (un ID de usuario enviado sin rol) o a ninguna clave de API activa. | Comprueba el ID, o envía un rol junto al UID para simular un UID que no tiene cuenta asociada. |
| `SIMULATION_UNAVAILABLE` | 501 | Este backend no puede simular accesos: su `AuthAdapter` no tiene `resolveUser` para verificar a un administrador, o se especificó una clave en un backend sin claves de API. | Implementa `resolveUser` u omite los encabezados. |
| `SIMULATION_UNSUPPORTED` | 400 | Se envió un encabezado `x-rebase-simulate-*` a una ruta que no admite accesos simulados. Solo la API de datos y las funciones personalizadas los admiten. | Envía la solicitud sin los encabezados. |
| `GUEST_REFERENCED` | 409 | No se pudo eliminar un invitado porque una fila propia del proyecto lo requiere a través de una clave foránea con `ON DELETE RESTRICT` o `NO ACTION`. `DELETE /api/admin/guests` lo notifica por invitado en `skipped` y continúa. | Elimina la fila o conserva al invitado. |
| `INVALID_ACCOUNT` | 400 | La cuenta se encuentra en un estado sobre el cual esta operación no puede actuar. | Consulta el mensaje. |
| `INVALID_CHALLENGE` | 400 | El desafío MFA es desconocido o ha expirado. | Inicia uno nuevo. |
| `INVALID_CODE` | 400 / 401 | El código OTP o MFA es erróneo: 400 en el inicio de sesión con código por correo (`/auth/otp/verify`), 401 en un registro o desafío MFA. | Reintenta con el código actual. |
| `INVALID_CREDENTIALS` | 401 | Correo o contraseña incorrectos — deliberadamente no se especifica cuál. | Reintenta o restablece la contraseña. |
| `INVALID_PLATFORM_TOKEN` | 401 | Se rechazó un token de plataforma `rpt_`: firma incorrecta, audiencia errónea, expirado o con una duración superior al límite. El mensaje detalla la razón. | Haz que la plataforma genere uno nuevo — en Rebase Cloud, ejecuta el comando nuevamente. |
| `INVALID_SCOPES` | 400 | Se solicitó para una clave algo que no es un ámbito: malformado, desconocido o con un objetivo incompatible. `details.problems` explica cuál y por qué; `details.validScopes` lista los ámbitos que una clave puede tener. Excluye `keys:read` y `keys:write`, que ninguna clave puede poseer. | Usa un nombre de la lista. Consulta [Roles and scopes](/docs/backend/roles-and-scopes/). |
| `INVALID_TOKEN` | 400 / 401 | Un token de verificación, restablecimiento, magic link o cambio de dirección está malformado, es desconocido, ya fue consumido o expiró (400). Una credencial de proveedor OAuth o un refresh token que no se valida devuelve un 401. | Solicita un enlace nuevo o inicia sesión de nuevo. |
| `INVALID_USER_CODE` | 400 | El código enviado para inicio de sesión en dispositivo no tiene el formato correcto: ocho letras, como `BCDF-GHJK`. | Copia el código que muestra el dispositivo. |
| `INVALID_ID` | 400 | El `id` de una cuenta importada no es válido: vacío, más de 128 caracteres, contiene caracteres fuera de letras, números y `_ - . : \|`, es un ID reservado (`service`, `anonymous`) o un valor no admitido por la columna id de la tabla de usuarios (por ejemplo, no es un uuid en una columna `uuid`). | Corrige el id, u omítelo y deja que la tabla genere uno. |
| `INVALID_ROLE` | 400 | El nombre del rol a escribir no es un string, está vacío o contiene `,` `{` `}` `"` `\` o un carácter de control. Esos caracteres se interpretarían como roles adicionales: un rol viaja en un `text[]` de Postgres y en listas separadas por comas que descomponen las políticas RLS, por lo que `"support,admin"` se leería como `admin`. `details.problems` nombra cada caso. | Renombra el rol. Cualquier otro nombre es aceptado. |
| `KEY_MANAGEMENT_SCOPE` | 400 | Se solicitó `keys:read` o `keys:write` para una clave. Ninguna clave puede gestionar claves. `details.scopes` los enumera. | Exclúyelos. |
| `KEY_OUTRANKS_CALLER` | 403 | Un usuario con `keys:write` intentó modificar o revocar una clave de servicio que posee un rol o ámbito que este no tiene. Solo un admin gestiona cualquier clave. `details.roles` y `details.scopes` indican lo que la clave posee por encima del emisor. | Haz que un admin, o alguien que los posea, modifique la clave. |
| `LAST_ADMIN` | 403 | El cambio dejaría al proyecto sin administradores. | Asigna el rol a otra persona antes. |
| `MFA_REQUIRED` | 401 | La contraseña fue correcta y la cuenta dispone de un segundo factor verificado, por lo que el inicio de sesión está incompleto. `details` contiene un token de corta duración delimitado al desafío MFA — no es una sesión. | Inicia un desafío y respóndelo; la respuesta al desafío emitirá la sesión. |
| `NO_SESSION` | 401 | No se presentó ninguna cookie de sesión ni refresh token. Es normal en la primera carga de una página. | Inicia sesión. |
| `NOT_ANONYMOUS` | 400 | Una cuenta real invocó una ruta de actualización desde usuario anónimo, o `DELETE /api/admin/guests/:uid` especificó una cuenta real. | Nada que actualizar. Para eliminar una cuenta, usa `DELETE /api/admin/users/:uid`. |
| `OAUTH_ERROR` | 401 | El proveedor de OAuth rechazó la solicitud o devolvió un error. | Reintenta el flujo; el mensaje contiene el motivo del proveedor. |
| `PERSONAL_KEYS_DISABLED` | 403 | Las claves de API personales están desactivadas en este backend. | Configura `personalKeys: true` en las opciones `auth` de la tabla de autenticación (`defineAuthTable`). |
| `PERSONAL_KEY_NEEDS_ACCOUNT` | 403 | La clave de servicio o una sesión de invitado intentó usar las rutas de claves personales. Ninguna de las dos tiene una cuenta sobre la cual actuar. | Inicia sesión en una cuenta, o crea una clave de servicio en `/api/admin/api-keys`. |
| `PLATFORM_TOKENS_OFF` | 401 | Un token de plataforma `rpt_` llegó a un servidor que no los acepta: `REBASE_PLATFORM_TOKEN_KEY` y `REBASE_PLATFORM_TOKEN_AUDIENCE` no están configuradas. | La plataforma de alojamiento las define al desplegar; vuelve a desplegar o inicia sesión de otro modo. |
| `RATE_LIMITED` | 429 | Demasiados intentos por parte de este emisor. | Espera; el mensaje indica durante cuánto tiempo. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | El destino de redirección no está en la lista de permitidos. | Añádelo a la configuración del proveedor. |
| `REGISTRATION_DISABLED` | 403 | El registro libre de usuarios está desactivado. | Haz que un administrador cree la cuenta. |
| `ROLE_EXCEEDS_CALLER` | 403 | Los roles que se intentan otorgar contienen un ámbito, o `admin`, que el emisor no posee. `details.beyond` los enumera. | Haz que alguien que los posea otorgue el rol. |
| `ROLE_EXCEEDS_CREATOR` | 403 | Se intentó asignar a una clave de servicio un rol de RLS que su creador no tiene. Solo un admin puede asignar cualquier rol. `details.roles` los enumera. | Elimina el rol o haz que un admin cree la clave. |
| `ROLE_EXISTS` | 409 | Ese nombre de rol ya está en uso. | Elige otro nombre. |
| `ROLE_LOOKUP_FAILED` | 503 | No se pudieron leer los roles del emisor — en una ruta de admin, o en una solicitud de datos en un backend con `config.auth`. Falla de forma cerrada en lugar de confiar en los roles del token. Un token cuyo UID no apunta a ninguna cuenta (o un UID incompatible con la tabla de usuarios) devuelve 401, no este código. Si la base de datos es inalcanzable, devuelve `DATABASE_UNAVAILABLE`. | Reintenta; comprueba la base de datos. |
| `SCOPE_EXCEEDS_CREATOR` | 403 | Se solicitó para una clave un ámbito que su creador no posee. Una clave nunca puede tener más permisos que la cuenta que la crea. `details.scopes` los enumera. | Quítalos, o haz que alguien que los posea cree la clave. |
| `SCOPE_MISSING` | 403 | La credencial no cuenta con el ámbito requerido por esta ruta, tabla, fuente de almacenamiento o función. `details.requiredScope` lo especifica, incluyendo el objetivo. | Para una persona, asigna un rol que declare dicho ámbito. Para una clave, utiliza una que lo incluya. Consulta [Roles and scopes](/docs/backend/roles-and-scopes/). |
| `SCOPE_NOT_DECLARED` | 500 | Una ruta protegida con `requireScope` especifica un ámbito de aplicación que este backend no declara, por lo que nadie lo posee, ni siquiera un administrador. Un nombre que no es un ámbito o uno integrado mal escrito (como `data:raed`) nunca llega a este punto: `requireScope` falla al registrar la ruta. | Declara el ámbito bajo `auth.scopes` en la tabla de autenticación, o corrige el nombre. Consulta [Roles and scopes](/docs/backend/roles-and-scopes/). |
| `SELF_DELETE` | 400 | Un administrador intentó eliminar su propia cuenta. | Haz que otro administrador lo haga. |
| `SESSION_REVOKED` | 401 | La sesión se cerró en otro dispositivo, se revocaron todas las sesiones o la cuenta fue eliminada. Toda vía de acceso que requiera sesión responderá esto a dicho token de acceso: la API de datos, storage, funciones personalizadas y rutas de admin. El socket en tiempo real rechaza su `AUTHENTICATE` con un frame `AUTH_ERROR` con este mismo código. El SDK intenta renovar, la renovación es rechazada y cierra la sesión. | Inicia sesión de nuevo. |
| `ACCOUNT_DISABLED` | 401/403 | Un administrador desactivó la cuenta: el inicio de sesión (403), la renovación y todos los tokens que posee (401) son rechazados en cada vía de acceso. El socket en tiempo real rechaza su `AUTHENTICATE` con un frame `AUTH_ERROR` con este mismo código. | Contacta con un administrador. |
| `EMAIL_NOT_CONFIRMED` | 403 | `requireEmailVerification` está activo y la dirección aún no se ha verificado. Solo se responde ante una contraseña correcta; se envía un nuevo enlace por correo. | Haz clic en el enlace del correo. |
| `PROOF_REQUIRED` | 409 | `POST /auth/verify-email`: la cuenta contiene una contraseña o identidad que nadie ha demostrado, y la solicitud no demuestra ninguna de las dos. El token no se consume. | Envía `password` para conservarla, o `removeUnproven: true` para verificar sin ella. |
| `UNDELIVERABLE_ADDRESS` | 400 / 409 | Se solicitó un correo de verificación para una dirección inalcanzable — la de un invitado o el marcador de posición de X (400) — o una cuenta intentó cambiarse a dicha dirección (409, `POST /auth/change-email`). | Configura una dirección real primero. |
| `EMAIL_UNCHANGED` | 400 | `POST /auth/change-email` especificó la misma dirección que la cuenta ya tiene. | No hay nada que cambiar. |
| `ANONYMOUS_USER` | 403 | Un invitado intentó cambiar su dirección de correo; un invitado no tiene una propia. | Conviértelo en una cuenta primero (`POST /auth/anonymous/link`). |
| `MFA_NOT_ENROLLED` | 400 | Se solicitaron códigos de recuperación para una cuenta sin un segundo factor verificado. | Registra un factor primero. |
| `HOOK_REJECTED` | 400 | Un hook `beforeUserCreate`, `beforeLogin`, `beforeUserDelete` o `beforeEmailChange` lanzó un error. El mensaje es el del propio hook; si el hook eligió un estado 4xx, responderá con él. | Consulta el mensaje. |
| `INVALID_JSON` | 400 | El cuerpo de la solicitud no es JSON. | Envía un cuerpo en formato JSON. |
| `SELF_DISABLE` | 400 | Un administrador intentó deshabilitar su propia cuenta. | Pide a otro administrador que lo haga. |
| `NOT_SUPPORTED` | 501 | El repositorio de autenticación de este backend no soporta la acción solicitada (deshabilitar cuentas, cambiar dirección). | Reinicia el servidor para que se agregue la columna, o usa un repositorio compatible. |
| `UNKNOWN_SCOPE_TARGET` | 400 | El objetivo de un ámbito especifica una tabla, fuente de almacenamiento o función que este backend no proporciona. `details` lista las disponibles. | Corrige el objetivo. |
| `UNVERIFIED_IDENTITIES` | 409 | Un magic link, código por correo o restablecimiento de contraseña demostró la dirección de una cuenta no verificada, y la cuenta posee una identidad cuyo proveedor nunca verificó esa dirección. El repositorio de autenticación no puede eliminarla (carece de `unlinkUserIdentity`), por lo que la comprobación se rechaza antes de dejar esa puerta abierta en una cuenta verificada. | Implementa `unlinkUserIdentity` en el repositorio de autenticación personalizado, o haz que un admin revise la cuenta. |
| `SETUP_REQUIRED` | 403 | El proyecto aún no tiene administradores, por lo que esta ruta no está disponible. | Completa la configuración del primer administrador. |
| `TOKEN_ALREADY_USED` | 401 | Se reutilizó un token de un solo uso, o un refresh token que fue rotado hace más de `refreshTokenReuseIntervalSeconds`. | Solicita uno nuevo o inicia sesión otra vez. |
| `TOKEN_EXPIRED` | 401 | El token ha superado su tiempo de vida útil. | Solicita uno nuevo. |
| `TOO_MANY_USERS` | 400 | Una llamada a `POST /api/admin/users/import` contenía más de 100 cuentas. `details.max` indica el límite. | Envíalas en lotes de 100; `rebase users import` ya lo hace automáticamente. |
| `USER_NOT_FOUND` | 404 | No existe ninguna cuenta con ese ID. | Comprueba el ID. |
| `WEAK_PASSWORD` | 400 | La contraseña no cumple con la [password policy](/docs/backend/auth-endpoints/#password-policy) (por defecto más de 8 caracteres con mayúscula, minúscula y número) — en el registro, restablecimiento, cambio de contraseña o en una contraseña elegida por un administrador: `POST /api/admin/users`, creación en la tabla auth vía API de datos, `PUT /api/admin/users/:id` o `POST /api/admin/users/:id/reset-password`. | Elige una más segura. Un administrador que importe cuentas puede enviar `skipPasswordPolicy: true` al crearlas. |

## Datos, consultas y escrituras

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `AGGREGATE_MASKED_BY_AFTER_READ` | 400 | Se solicitó una función de agregación distinta de `count()` sin `groupBy` en una tabla modificada por un hook `afterRead` (global, de tabla o el `.transform()` de una columna). La agregación lee los valores almacenados y nunca ejecuta el hook, por lo que una suma, mínimo, máximo, conteo de campo o agrupación leería lo que el hook oculta. | Usa `count()` sin `groupBy`, o lee las filas completas, que sí pasan por el hook. |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Este driver no puede calcular la agregación solicitada. | Usa un driver compatible o calcúlala en el cliente. |
| `BRANCHING_UNSUPPORTED` | — | Se solicitó una rama de la base de datos mediante el websocket de Studio en la base de datos de desarrollo administrada (PGlite), donde la rama *es* el elemento padre y nada quedaría aislado. El rechazo es el mismo que muestra `rebase db branch`. | Apunta `DATABASE_URL` a una instancia propia de Postgres (`rebase dev --docker` inicia una) y crea la rama allí. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` contiene más operaciones que el límite permitido por lote (1000 por defecto). Un lote equivale a una sola transacción y retiene sus bloqueos durante toda su duración. | Envíalo en fragmentos más pequeños; el mensaje indica el límite y tu cantidad actual. |
| `BATCH_UNSUPPORTED` | 400 | El driver de este backend no permite escribir en varias tablas de forma atómica, y un bucle de escrituras individuales no sería ni atómico ni de una sola ida y vuelta. | Envía las escrituras como solicitudes separadas, o como llamadas `/bulk` por tabla. |
| `BULK_TOO_LARGE` | 400 | El cuerpo de la operación masiva excede el límite configurado de elementos. | Divide la solicitud. |
| `BULK_UNSUPPORTED` | 400 | Esta tabla o driver no admite operaciones de escritura masiva. | Escribe las filas una a una. |
| `CALLBACK_REJECTED` | 400 / 403 | Un hook de la tabla rechazó la escritura. Un `throw` desde `beforeSave`/`beforeDelete`/`after*` devuelve un 400 con el mensaje del autor; un `beforeDelete` que retorna `false` devuelve un 403. `details.stage` indica qué hook falló, y `details.path` la tabla. | Lee el mensaje — fue escrito por el código de este proyecto, no por Rebase. |
| `CALLBACK_RECURSION` | 500 | Las escrituras desencadenadas por hooks alcanzaron más de 16 niveles de anidamiento: la escritura `context.data` de un hook vuelve a disparar los hooks de esa tabla y nada detiene la cadena — normalmente un `afterSave` que actualiza su propia fila incondicionalmente. Se revirtió toda la escritura. El mensaje nombra el hook y la tabla; `details.chain` lista cada paso de hook → escritura. | Haz que la escritura del hook sea condicional: actúa solo cuando `status === "new"`, o ignórala si `values` ya contiene lo que se iba a escribir. |
| `COMPOSITE_KEY_ADDRESS` | 400 | La tabla tiene una clave compuesta y la dirección en la URL incluye una cantidad distinta de partes. | Especifica la fila como `<part1>:::<part2>`, con cada parte codificada para URL en el orden de la clave; `details.primaryKey` enumera las columnas. |
| `TABLE_READ_ONLY` | 405 | Una escritura intentó modificar una vista (`defineView`). Las vistas son de solo lectura. Antes era `COLLECTION_READ_ONLY`. | Escribe en las tablas desde las cuales lee la vista. Consulta [Views](/docs/collections/views/). |
| `TABLE_WITHHELD` | 503 | La tabla está declarada, pero la base de datos no la protege: la seguridad a nivel de fila (RLS) está desactivada, no existe ninguna de las políticas que declara o falta una de sus políticas restrictivas. (Una política permisiva faltante sí se sirve, emitiendo una advertencia en el arranque con su nombre). Esto ocurre cuando el servidor no aprovisiona sus tablas (`REBASE_PROVISION=false`, `provisionSchema: false`, `provision.tables: false`, `REBASE_MIGRATE_ON_BOOT=none`), y el servidor retiene la tabla en lugar de servir todas las filas a cualquier emisor. Una unión many-to-many está sujeta a la misma regla: si falla, las tablas cuyas relaciones la utilicen son retenidas y el mensaje nombra la unión; lo mismo ocurre con tablas cuyo `via` atraviesa una tabla retenida. Una lectura o filtro de relación que pase por una tabla retenida también devuelve este código. Las demás tablas se sirven con normalidad. El log de arranque indica las sentencias para protegerla. | Ejecuta las sentencias indicadas en el log de arranque (`rebase db push` lo hace) y reinicia. O bien, si la aplicación gestiona el acceso a esa tabla por sí misma, declara `rlsRequired: false` en ella (o `database({ rls: { required: false } })`) y reinicia. |
| `SQL_NOT_ALLOWED` | 400 | El SQL ejecutado como el emisor (`getSql(c)`, `withAuth(user).sql`) no era una sentencia simple `SELECT`, `WITH`, `VALUES`, `TABLE`, `INSERT`, `UPDATE`, `DELETE` o `MERGE`, o invocó `set_config` o nombró `pg_settings`. La identidad del emisor reside en la configuración de la sesión, por lo que cualquier sentencia que pudiera alterarla es rechazada. | Mantén el texto de la consulta propio, en una sola sentencia, con cada valor en `params`. Consulta [Custom functions](/docs/backend/custom-functions/#3-getsqlc--sql-as-the-caller). |
| `CURSOR_WITH_OFFSET` | 400 | Se combinó `?after=` con `?offset=` o `?page=`. Un cursor ya define dónde comienza la página, por lo que un desplazamiento sobre él omitiría silenciosamente esa cantidad de filas tras el cursor — un vacío que el emisor no puede percibir en la respuesta. | Utiliza uno u otro, no ambos. |
| `DISTINCT_NOT_APPLICABLE` | 400 | Se combinó `?distinct=true` con una búsqueda por texto o vectorial. Ambas asignan una puntuación por fila, por lo que nunca habrá dos filas idénticas y `DISTINCT` no agruparía nada — parecería haber funcionado pero no alteraría el resultado. | Descarta una de las dos opciones. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Una lectura `distinct` está ordenada por una columna que no devuelve. Un `SELECT DISTINCT` solo puede ordenarse por columnas presentes en su lista de selección; de lo contrario, las filas agrupadas carecerían de un orden definido. `details.fields` las lista. | Añade esos campos a `?fields=` o quítalos de `?orderBy=`. |
| `DATABASE_UNAVAILABLE` | 503 | No se pudo conectar con la base de datos: conexión rechazada o interrumpida, el host no se resuelve, el servidor se está apagando o iniciando, o la base de datos no acepta nuevas conexiones (`ALLOW_CONNECTIONS false`, que puede dejar un `rebase db branch create --force` interrumpido a medias; el log del servidor indica la base de datos y `rebase db branch list` la reabre). Todas las vías responden esto, incluidos el inicio de sesión, las rutas de admin y el socket en tiempo real (un frame `ERROR`). Se envía con `Retry-After: 5`. | Reintenta; el SDK lo hace automáticamente. Comprueba que la base de datos esté activa y accesible desde el servidor. |
| `DB_CONNECTIONS_EXHAUSTED` | 503 | El servidor de base de datos rechazó una conexión nueva por no tener disponibles (`53300` demasiados clientes, `53400` límite de conexiones por rol o base de datos alcanzado). Todas las instancias del servidor comparten el `max_connections` general, por lo que esto sucede con múltiples instancias con grupos grandes de conexiones sin un pooler intermedio. Es un problema de carga, no un fallo; se envía con `Retry-After: 2`. El servidor registra la solución en los logs una vez por minuto. | Reintenta; el SDK lo hace. Reduce `DB_POOL_MAX` (o limítalo con `REBASE_DB_POOL_MAX`) entre instancias, sitúa un pooler frente a la base de datos (`DATABASE_POOLED`), o incrementa `max_connections`. |
| `DB_CONNECT_TIMEOUT` | 503 | Abrir una nueva conexión a la base de datos tardó más que `DB_POOL_CONNECT_TIMEOUT`: la base de datos tarda en aceptar conexiones o está lejos en la red. Se envía con `Retry-After`. | Reintenta; el SDK lo hace. Revisa la carga de la base de datos y la latencia de red. |
| `DB_PERMISSION_DENIED` | 500 | Postgres rechazó la sentencia (`42501`): bien por una política de seguridad a nivel de fila que deniega este rol, o por la falta de un `GRANT`. | Consulta [Troubleshooting](/docs/troubleshooting/). |
| `DB_POOL_EXHAUSTED` | 503 | Todas las conexiones del pool estuvieron ocupadas durante `DB_POOL_CONNECT_TIMEOUT`, por lo que la solicitud nunca llegó a la base de datos. Es sobrecarga, no un error de código; se envía con `Retry-After`. El servidor registra la solución en los logs una vez por minuto. | Reintenta; el SDK lo hace. Aumenta `DB_POOL_MAX` o localiza las consultas lentas o transacciones extensas que retienen las conexiones. |
| `FIELD_NOT_READABLE` | 400 | Un filtro, `orderBy`, `fields`, `select` de agregación o `groupBy` hace referencia a un campo que los roles de este emisor no pueden leer (`access.read`), una ruta anidada o un ordenamiento por agregación nombra una relación que no pueden leer — o una operación de campo (`$inc`, `$push`, …) apunta a uno de ellos, donde un límite rechazado revelaría el valor almacenado. Un campo que ninguna respuesta puede incluir debe ser también inaccesible mediante consultas; de lo contrario, el valor se podría deducir predicado a predicado. Un filtro a través de una relación (`author.salary`) y una ordenación agregada sobre el campo de una relación (`max(staff.salary)`) se evalúan según la regla de la tabla destino. `details.violations` detalla cada campo. El driver aplica la misma regla a lecturas internas realizadas en nombre del emisor (`context.data` bajo el ámbito del emisor), y a búsquedas vectoriales, inclusiones o comprobaciones de unicidad. Una columna `.private()` responde como si no existiese: un filtro, `orderBy`, `fields`, `include`, `select` de agregación, `groupBy` o `vector_search` que la mencione recibe exactamente la misma respuesta que un nombre inexistente (`UNKNOWN_FILTER_FIELD`, `UNKNOWN_ORDER_BY_FIELD`, `UNKNOWN_FIELD`, `UNKNOWN_RELATION`, `UNKNOWN_AGGREGATE_FIELD` o `UNKNOWN_VECTOR_PROPERTY`), y ninguna respuesta de campos desconocidos la incluirá. | Elimina el campo de la consulta u obtén el rol correspondiente. Consulta [Field access](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 / 403 | El cuerpo incluye un campo en el que los roles de este emisor no tienen permiso de escritura (`access.write`). Se rechaza en lugar de descartarlo: una escritura que ignore un campo notificaría éxito para una modificación que en realidad no ocurrió. Este mismo código rechaza una escritura a través de un elemento padre que define una relación no editable por el emisor, así como una actualización que intente asignar un valor a un campo `softDelete` — solo una eliminación puede marcarlo. El socket en tiempo real responde 403 con este código ante una escritura a través de una ruta anidada cuya tabla padre, relación o tabla destino no se sirven allí, en lugar de pasarla al driver sin verificar. `details.violations` detalla cada campo. | Elimina el campo u obtén el rol necesario. Un campo que nadie puede escribir responde `VALIDATION_EXCLUDED_FIELDS`. |
| `FILTERED_USER_WRITE` | 400 | Se envió una actualización o eliminación con filtros a la tabla de autenticación vía HTTP, cuyas escrituras deben validarse usuario a usuario antes de ejecutarse. | Lee los usuarios y luego usa `updateMany`/`deleteMany` sobre ellos por ID. |
| `FILTER_REQUIRED` | 400 | Una escritura filtrada (actualización o eliminación mediante `where`/`logical`, desde el SDK o las rutas bulk) no incluye condiciones, por lo que afectaría a todas las filas. Se rechaza antes de ejecutar nada. | Agrega una condición. Si deseas modificar todas las filas intencionadamente, hazlo explícito con una condición que todas cumplan. |
| `HISTORY_UNAVAILABLE` | 503 | Se rechazó una escritura en una tabla con `history: true` porque no se pudo registrar su entrada de historial: la base de datos carece de la tabla `rebase.entity_history` o, en el caso de `openRebase` y `rebase console`, de la función `rebase.record_history`. Ningún backend con historial ha arrancado en esta base de datos. Nada se ejecutó, incluidos los hooks, y las lecturas no se ven afectadas. Lanzado por `openRebase` y retornado por un backend creado con `provision: false`. | Arranca el backend al menos una vez con historial activado y `provision: true` (`rebase dev` lo hace) y reintenta. |
| `HISTORY_UNSERVABLE` | 501 | El driver de datos de la tabla no puede aplicar las reglas de lectura y los hooks `afterRead` sobre las filas almacenadas (`DataDriver.serveStoredRows`), y el historial nunca se expone sin enmascarar. El driver integrado de Postgres sí lo soporta. | Implementa `serveStoredRows` en el driver personalizado. Consulta [History](/docs/backend/history/). |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Una solicitud anterior con la misma `Idempotency-Key` todavía se encuentra en ejecución. | Reintenta cuando haya concluido. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | Se reutilizó la misma `Idempotency-Key` en una solicitud distinta: método, ruta, parámetros de consulta o cuerpo diferentes. | Usa una clave nueva o envía la solicitud original. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` especificó una función que no es de agregación (`count`, `sum`, `avg`, `min`, `max`, `countDistinct`, `mode`, `percentile`, `distinct`, `fingerprint`). | Usa una de las indicadas; el mensaje las lista. |
| `INVALID_AGGREGATE_GROUP` | 400 | Una transformación de `groupBy` es desconocida o no aplica a su columna: `year`/`month`/`day` en una columna que no es fecha, o `unnest` en una que no es array. | Usa `lower`, `upper`, `year`, `month`, `day` o `unnest` sobre una columna del tipo apropiado. |
| `INVALID_AGGREGATE_SELECT` | 400 | Una entrada de `?select=` no sigue el formato `fn(field)`; se usó una función distinta de `count()` o `fingerprint()` sin indicar un campo; `percentile` no tiene una fracción entre 0 y 1; o se solicitó `fingerprint()` sobre una vista estándar, que no almacena filas. | Escribe `sum(total)`, `count()`, `percentile(price,0.95)`. |
| `INVALID_AGGREGATE_WINDOW` | 400 | Se usó `offset`, `page` u `orderBy` en una agregación sin `groupBy`, o un cursor en cualquier agregación. Una agregación no agrupada produce una sola fila, y un grupo no es una fila a partir de la cual un cursor pueda continuar. | Agrega `groupBy` o retira esos parámetros; pagina los grupos con `offset` o `page`. Consulta [Aggregates](/docs/sdk/aggregates-and-search/#aggregates). |
| `INVALID_BATCH_BODY` | 400 | Una operación de `/_batch` carece de `op`, `table`, `values` o `id`, nombra una tabla no servida por este backend o reutiliza un nombre de `ref`. | Consulta el mensaje; indica la operación por su índice. |
| `INVALID_BATCH_REF` | 400 | Una referencia `{ "$ref": "<name>.<field>" }` no apunta a ninguna operación previa, apunta hacia adelante o solicita un campo que la fila referenciada no contiene. Solo se resuelven referencias hacia operaciones anteriores. | Nombra la operación con `ref` *antes* de referenciarla. |
| `INVALID_BULK_BODY` | 400 | El cuerpo de la operación masiva no tiene la estructura esperada. | Envía el array que requiere la ruta: `{ "rows": [...] }` para `POST /bulk`, `{ "updates": [{ "id", "data" }] }` para `PATCH /bulk`, `{ "ids": [...] }` para `POST /bulk/delete`. |
| `INVALID_CONFLICT_RULE` | 400 | La regla de conflicto de un upsert (mantener duplicados o reemplazar solo bajo un `where`) se envió sin `upsert: true`, o se enviaron ambas reglas simultáneamente. | Envía `upsert: true` y una sola de las dos reglas. |
| `INVALID_CONFLICT_TARGET` | 400 | El parámetro `on_conflict` / `onConflict` de un upsert nombra columnas sin garantía de unicidad, las nombra sin `upsert: true`, o se envía en una creación anidada donde la fila coincidente pasaría al nuevo padre. De lo contrario, Postgres respondería 42P10 dentro de una transacción ya iniciada. Aplica también a cualquier upsert en la tabla auth, donde la creación y la actualización siguen reglas diferentes. | Declara `.unique()` en la columna o un índice `unique`; el mensaje lista los destinos válidos. En la tabla de usuarios, envía un `POST` para crear y un `PATCH` para actualizar. |
| `INVALID_COUNT` | 400 | `?count=` no es `exact` ni `none`. Se rechaza en lugar de asumir el valor por defecto: un error tipográfico como `?count=nnone` pagaría el costo del recuento que se pretendía omitir. | Envía `exact` (por defecto) o `none`. Consulta [Skipping the count](/docs/backend/api/#skipping-the-count). |
| `INVALID_CURSOR` | 400 | El cursor `after` no se puede interpretar o nombra un ID de fila incompatible con las columnas clave de la tabla: fue truncado, recodificado o generado manualmente. Un cursor legible enviado con un `orderBy` distinto de aquel con el que se generó devuelve `CURSOR_ORDER_MISMATCH`, también un 400. | Reenvía `meta.nextCursor` de la página anterior sin alterarlo, con el mismo `orderBy` o ninguno. Consulta [Pagination](/docs/sdk/pagination/). |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` no es ni `include` ni `only`. Se rechaza en vez de ignorarse: un error como `?deleted=true` que ocultara silenciosamente todas las filas eliminadas parecería funcionar pero respondería a la pregunta opuesta. | Envía `include` (activas y eliminadas) u `only` (únicamente eliminadas). Omítelo para obtener solo filas activas. |
| `INVALID_DISTINCT` | 400 | `?distinct=` no es `true` ni `false`. | Envía uno de esos valores; también se aceptan `1` y `0`. |
| `INVALID_FIELD_OPERATION` | 400 | Se utilizó `$inc` / `$push` / `$pull` / `$merge` en un tipo de columna no compatible, con un operando mal estructurado, con dos operadores en el mismo campo, mal escrito o en una creación — donde no existe un valor previo sobre el que operar. | Consulta [Writing over REST](/docs/backend/writes/#field-operations); el mensaje especifica el campo. |
| `INVALID_FILTERED_WRITE` | 400 | Una escritura filtrada apuntó a una ruta a través de una relación (`posts/1/comments`) o a ninguna tabla. | Escribe directamente en la tabla relacionada aplicando un filtro en su enlace. |
| `INVALID_FILTER_FIELD` | 400 | El filtro nombra una columna inexistente en esta tabla. | Verifica la ortografía comparándola con la tabla. |
| `INVALID_FILTER_OPERATOR` | 400 | El operador no es compatible con este tipo de columna — por ejemplo, `like` en un número o fecha. | Consulta [Querying data](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | Un valor de filtro no se puede convertir al tipo de columna con el que se compara: `?id=eq.abc` en una clave entera, un valor fuera de un enum, una marca de tiempo inválida o un número fuera de rango. `details.dbCode` incluye el SQLSTATE. | Envía un valor compatible con el tipo de la columna. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` no es `true` ni `false`. Cualquier otro valor se rechaza en lugar de interpretarse como "no": un error tipográfico que realice un borrado lógico cuando se solicitó purga definitiva haría creer al usuario que los datos desaparecieron. | Envía `true` o `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` está malformado: no es una lista de rutas válida o es un objeto de opciones por relación mal estructurado. Una ruta con más de tres saltos devuelve `INCLUDE_TOO_DEEP`, también un 400. Se valida en la frontera antes de que escape del driver como un 500. | Consulta el mensaje; nombra la ruta errónea. |
| `INVALID_INPUT` | 400 | El cuerpo no superó la validación. | Consulta el mensaje. |
| `INVALID_LIMIT` | 400 | `?limit=` no es un número entero entre 1 y el máximo configurado (1000 por defecto); valores mayores son rechazados, no truncados. Una suscripción en tiempo real con un límite fuera de rango devuelve este mismo código en un frame `ERROR` de WebSocket. | Reduce el límite y pagina los resultados restantes. |
| `INVALID_LOGICAL_GROUP` | 400 | Un grupo `?or=` / `?and=` / `?not=` está malformado o anidado más allá de la profundidad permitida. | Consulta el mensaje; muestra la regla de aplanamiento. |
| `INVALID_OFFSET` | 400 | `?offset=` no es un número entero igual o mayor que 0. | Envía un entero no negativo. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` no tiene el formato `field`, `field:desc`, `field:desc:last`, ni es un array JSON de `{ field, direction, nulls }` — o especifica una dirección distinta de `asc`/`desc`, o un orden de nulos diferente de `first`/`last`. | Consulta el mensaje; muestra los formatos válidos. |
| `INVALID_PAGE` | 400 | `?page=` no es un número entero igual o mayor que 1. Las páginas tienen base 1, por lo que `?page=0` se considera un error y no la primera página. | Envía `1` o superior, o utiliza `?offset=`. |
| `INVALID_PARAM` | 400 | Un parámetro de consulta está malformado. | Consulta el mensaje. |
| `INVALID_QUERY_BODY` | 400 | El cuerpo de un `POST …/query` contiene un valor no compatible con la URL: una lista para un parámetro que la URL solo lee una vez (`fields`, `limit`, …), un objeto para un filtro, o parámetros enviados tanto en URL como en cuerpo — `POST …/query` lee todos los parámetros exclusivamente del cuerpo. | Especifica cada valor como en la URL — un string o una lista para filtros repetidos; `where`, `include`, `orderBy` y `vector` aceptan JSON. Consulta [Queries too long for a URL](/docs/backend/vector-search/#queries-too-long-for-a-url). |
| `INVALID_VECTOR` | 400 | `?vector=` no es un array JSON de números. | Envía `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` no es `cosine`, `l2` ni `inner_product`. | Utiliza uno de esos tres. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` no es un número. | Envía un número. |
| `INVALID_WHERE` | 400 | `?where=` no es un objeto JSON que asocie campos con condiciones. | Envía `{"status":["==","active"]}`. |
| `KEY_IMMUTABLE` | 400 | Una actualización nombra la clave de la fila con un valor diferente al usado para referenciarla — en el cuerpo o asignado por un `beforeSave`. Una fila no puede cambiar de clave: cualquier operación posterior (relectura, `afterSave`, historial, realtime) la busca por su clave original. Se rechaza antes de cualquier hook sin escribir nada, en todas las vías. `details.violations` nombra el campo. | Crea la fila bajo la nueva clave y elimina la actual. Enviar la clave existente es válido. |
| `MISSING_AGGREGATE_SELECT` | 400 | Se invocó la ruta de agregación sin `?select=`. | Añade uno, por ejemplo `?select=count()`. |
| `NOT_A_MATERIALIZED_VIEW` | 400 | Se invocó `refresh()` en una tabla que no corresponde a una vista materializada. | Ejecuta refresh solo sobre vistas definidas con `defineView(…, { materialized: true })`. |
| `NO_TABLES` | 404 | El proyecto no expone tablas: ninguna declarada en `backend/schema` ni en la base de datos para introspección. Si existen tablas pero carecen de seguridad a nivel de fila (RLS), el mensaje las nombra junto al SQL para activarla, y `details.unprotectedTables` las lista. Antes era `NO_COLLECTIONS`. | Crea tablas — mediante migración, SQL o un archivo `defineTable` más `rebase db push` — y reinicia. |
| `NOT_FOUND` | 404 | No se encontró ninguna fila con ese ID en la tabla — o las políticas de seguridad a nivel de fila la ocultan para este emisor. | Comprueba el ID y luego el `rls` de la tabla. |
| `UNKNOWN_RELATION` | 400 / 404 | `?include=` nombra algo que no es una relación en la tabla. Devuelve **404** si es una *ruta de URL* anidada la que lo hace, por ejemplo `/api/data/authors/1/posts` donde `authors` no declara dicha relación — en ese caso la URL no apunta a nada existente, por lo que es un recurso no encontrado y no una solicitud malformada. | Comprueba el nombre de la relación; el mensaje lista las existentes en la tabla. Una referencia inversa debe declararse en el padre para ser navegable. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | La ordenación especifica un campo no ordenable. | Ordena por una columna válida. |
| `PAGE_WITH_OFFSET` | 400 | Se combinó `?page=` con `?offset=` — o `page` con `offset` en un `find()`, lo cual el SDK del cliente, el método en proceso `rebase.data` y el cliente offline rechazan con este mismo código antes de enviar la solicitud. Ambos describen la misma ventana, y anteriormente `page` prevalecía silenciosamente ignorando el `offset`. | Envía solo uno de ellos. |
| `PAYLOAD_TOO_LARGE` | 413 | El cuerpo supera el límite configurado. | Envía menos datos o incrementa el límite. |
| `READ_ONLY_TRANSACTION` | 409 | Un hook `afterRead` intentó realizar una escritura. Las lecturas en el ámbito de una solicitud se ejecutan en transacciones `READ ONLY`, por lo que ni el hook ni nada de lo que invoque puede escribir. | Mueve la escritura fuera de la lectura: usa un trabajo en segundo plano o `rebase.dataAsAdmin` desde una tarea cron o función personalizada. |
| `REFRESH_NOT_SUPPORTED` | 501 | `POST /api/data/<slug>/refresh` llegó a un driver de datos sin soporte para vistas materializadas. | No hay nada que refrescar en este backend. |
| `RELATION_HAS_NO_PIVOT` | 400 | La escritura incluyó datos para el enlace, pero la ruta no accede a su destino a través de un `manyToMany` que declare un `pivot` — no existe una fila intermedia donde almacenarlos. | Declara columnas `pivot` en la relación o elimina esos datos de la escritura. Consulta [Relations](/docs/collections/relations/). |
| `RELATION_MISCONFIGURED` | 500 | Una relación no se resuelve contra el esquema registrado. La operación se rechaza en lugar de omitirse: omitirla notificaría éxito en una escritura inexistente o devolvería vacíos para filas que sí existen. | Ejecuta `rebase schema generate` si el esquema generado es anterior a la base de datos. |
| `RELATION_NOT_UNLINKABLE` | 400 | La relación no puede desvincularse desde este extremo. | Realiza la modificación desde el extremo propietario. |
| `RELATION_NOT_WRITABLE` | 400 | La ruta anidada no es una relación modificable, o una creación/actualización especifica una relación `via` de múltiples saltos — solo las relaciones `via` de un solo salto admiten escritura. `details.fields` lista las claves `via`. Nada fue escrito. | Escribe directamente en las filas que une la cadena. Consulta [Relations](/docs/collections/relations/#via--an-explicit-join-chain). |
| `RELATION_PIVOT_UNSUPPORTED` | 400 | La relación declara columnas intermedias, pero esta fuente de datos no puede escribirlas. | El vínculo en sí funciona; solo los datos asociados a él fallan. Comprueba las capacidades del driver. |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Una escritura de relación no tenía clave de origen donde anclar el vínculo. | Guarda la fila padre primero. |
| `RESULT_TOO_LARGE` | — | Una sentencia enviada mediante `EXECUTE_SQL` en el socket en tiempo real — `admin.executeSql` desde un cliente, lecturas de catálogo del panel de administración — devolvió más de 128 MB de filas, por lo que no se envió nada. Se emite como un frame `ERROR` de WebSocket. Las ejecuciones directas en la consola SQL no se rechazan: muestran las primeras filas. | Añade un `LIMIT` o selecciona menos columnas y lee el resultado por partes. |
| `ROW_IN_TRASH` | 409 | La clave de un upsert pertenece a una fila en la papelera (una fila con borrado lógico aún retiene su clave). Un upsert no sobreescribe filas eliminadas en ninguna vía: REST `?on_conflict=`, upserts en `/bulk` y `/_batch`, el SDK y el socket en tiempo real. Nada fue modificado. | Restaura la fila primero (una actualización asignando `null` al campo de borrado lógico) o purga con `?hard=true` y haz el upsert nuevamente. Consulta [Soft delete](/docs/collections/soft-delete/). |
| `SCHEMA_DRIFT` | 500 | Una tabla o columna esperada por el código no existe en la base de datos. | Ejecuta `rebase db push` en desarrollo; vuelve a desplegar en entornos administrados. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | Se combinó `startAfter` con `orderBy: "_score"`. La relevancia se calcula por consulta y no se almacena, por lo que no puede actuar como clave para un cursor. | Pagina los resultados de relevancia con `limit`/`offset` u ordena por una columna física. |
| `SQL_ERROR` | 400 | La base de datos rechazó el SQL ingresado. En el socket en tiempo real bajo `EXECUTE_SQL` es un frame `ERROR` con el mensaje de la base de datos. `POST /api/admin/sql/csv` lo responde antes de enviar parte alguna del archivo: error de sintaxis, intento de escritura (la descarga es de solo lectura), múltiples sentencias o un rol no autorizado en la conexión. | Corrige el SQL. Las descargas admiten una única sentencia `SELECT`, `WITH … SELECT`, `TABLE` o `VALUES`. |
| `VIEW_NOT_READABLE` | 403 | Un emisor sin ninguno de los roles `view.roles` de una vista materializada intentó leerla o refrescarla. Las vistas materializadas no poseen seguridad a nivel de fila, por lo que se sirven completas y exclusivamente a dichos roles. | Léela con uno de los roles autorizados o declara el rol del emisor en `view.roles`. |
| `TENANT_IMMUTABLE` | 400 | Una escritura movería una fila de un tenant a otro. Una fila no puede cambiar de tenant. `details.violations` nombra el campo. Un disparador impone esta misma regla en la base de datos, por lo que el SQL ejecutado como el emisor fallará con el error `42501` de Postgres y un mensaje que inicia con `TENANT_IMMUTABLE`. | Crea la fila en el nuevo tenant y elimina la actual, o escribe usando un rol en `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | La escritura especifica un tenant al cual este emisor no pertenece; la base de datos también la rechazaría. | Escribe en un tenant al que pertenezca el emisor o autentícate con una cuenta asociada a él. |
| `TENANT_REQUIRED` | 400 | La tabla está restringida por tenant y este no puede inferirse: la solicitud no lo incluye o el emisor pertenece a varios. | Envía el campo del tenant explícitamente o autentícate como un usuario que pertenezca a uno solo. |
| `TRANSACTION_ABORTED` | 500 | Una sentencia falló en la transacción de escritura y un hook capturó el error. Postgres ya había abortado la transacción, por lo que se revirtió toda la escritura y no se guardó nada. Solo una creación, actualización o eliminación rechazada por la base de datos mediante `context.data` se revierte individualmente y es seguro capturarla. | Permite que el error se lance o realiza comprobaciones antes de ejecutar la sentencia. Consulta [Transaction Semantics](/docs/collections/context-data-api/#transaction-semantics). |
| `UNKNOWN_FIELD` | 400 | `?fields=` nombra un campo que la tabla no posee. | Verifica la ortografía; el mensaje lista los campos válidos. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Una función de agregación o `groupBy` nombra un campo inexistente en la tabla. | Verifica la ortografía; el mensaje lista los campos válidos. |
| `UNKNOWN_FILTER_FIELD` | 400 | El filtro nombra un campo inexistente en esta tabla — o en el destino de una relación —, o una columna `.private()`. | Verifica la ortografía; el mensaje lista los campos válidos. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | El filtro utiliza un operador inexistente. | El mensaje lista todos los operadores disponibles. |
| `UNKNOWN_MESSAGE_TYPE` | 400 | Un frame del socket en tiempo real tiene un `type` no procesable por el servidor. Se responde como un frame `ERROR` con el `requestId` correspondiente para resolver la solicitud en lugar de agotarse por timeout. | Revisa el `type` del frame; el mensaje indica cuál fue. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | La ordenación nombra un campo que la tabla no tiene. | Verifica la ortografía; el mensaje lista los campos válidos. |
| `PRECONDITION_FAILED` | 412 | Un encabezado `If-Match` indicó una versión de la fila que ya no está vigente: alguien escribió en ella entre la lectura y esta escritura. No se guardó nada. | Vuelve a leer la fila, reaplica el cambio y envía el nuevo `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` solicita un campo inexistente en la tabla. | Verifica la ortografía; el mensaje lista los campos conocidos. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Una búsqueda vectorial apuntó a una columna que no es `col.vector()` en esta tabla. | El mensaje lista las columnas vectoriales de la tabla. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | El `Content-Type` no es aceptado por esta ruta. | Envía el tipo indicado en la documentación de la ruta. |
| `UNSUPPORTED_OPTION` | — | Se lanza como excepción, no como respuesta HTTP: una escritura mediante el descriptor en proceso (`context.data` en un hook, `rebase.data` en una función o cron) recibió `ifMatch` o `idempotencyKey`. Esta vía no dispone de validación de precondiciones ni almacén de idempotencia, por lo que la opción se rechaza antes de escribir en lugar de ignorarse. | Elimina la opción en ese punto o realiza la escritura mediante el cliente HTTP, que soporta ambas. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | El filtro atraviesa una relación `via` cuya unión está definida en un solo sentido, por lo que no es posible correlacionar una subconsulta. | Aplica el filtro desde el extremo propietario. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | El operador no está definido para ese campo: una relación sin columna en esta fila se filtra por pertenencia, y la coincidencia de patrones (`like`, `ilike` y sus negaciones) solo aplica a texto. | Consulta el mensaje; detalla lo que admite el campo. |
| `VALIDATION_CONSTRAINT` | 400 | Un valor infringió una regla declarada por la columna (`.validate()`, `.notNull()`, `.oneOf()`) — longitud, rango, patrón, campo obligatorio o valor no permitido en la lista. Cada entrada de `details.violations` contiene un `code`: `required`, `min_length`, `max_length`, `length`, `min`, `max`, `less_than`, `more_than`, `positive`, `negative`, `integer`, `pattern`, `email`, `url`, `enum`, `min_items`, `max_items`, `unique_items` (un array contiene el mismo elemento dos veces, incluido vía `$push`), `unique_by` (dos elementos de un array JSON comparten un valor en un campo indicado por `uniqueBy`), `date_min`, `date_max`, `geopoint_range`. | Consulta el mensaje; especifica la tabla, la columna y cada infracción. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | El cuerpo intenta escribir en una columna marcada con `.private()` o `.access({ write: [] })` — la misma regla con dos sintaxis. Son de uso exclusivo del servidor: hash de contraseñas, tokens de verificación. A diferencia de `FIELD_NOT_WRITABLE`, la respuesta es idéntica para cualquier emisor, incluyendo `admin`. | Elimina el campo. Consulta [Field access](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Un valor no corresponde con el tipo de su columna. | Consulta el mensaje; nombra la columna afectada. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | El cuerpo nombra un campo inexistente en la tabla — incluido un parámetro `id` en una tabla cuya clave primaria es otra. | Verifica la ortografía; el mensaje ("Table 'x' has no column 'f'. Known columns: …") lista las columnas válidas. |
| `VECTOR_CURSOR_UNSUPPORTED` | 400 | Se combinó un cursor (`after` / `startAfter`) con una búsqueda vectorial. Las filas se ordenan según una distancia calculada por consulta que no puede actuar como clave de cursor, por lo que una consulta vectorial no devuelve `nextCursor`. | Pagina las filas más cercanas mediante `limit`/`offset`. |
| `WRITE_DENIED` | 403 | Una regla de seguridad o una política de seguridad a nivel de fila denegó la escritura. | Revisa las políticas `rls` de la tabla. |

## `PG_<SQLSTATE>` — una restricción rechazada por la base de datos

Una escritura que Postgres rechace por motivos imputables a los *datos del emisor* responde
con el SQLSTATE incorporado en el código: `PG_23505`, `PG_23503`, etcétera. Se trata de una
familia, no de una lista fija —Postgres define cientos de SQLSTATEs—, pero únicamente dos
clases llegan a producirse, ya que solo esas dos se deben a acciones del emisor:

- **clase 23**, violación de restricción de integridad: un duplicado, una clave foránea
  que apunta a un recurso inexistente, una columna NOT NULL dejada vacía;
- **clase 22**, excepción de datos: un valor incompatible con el tipo de la columna.

Todo lo demás —una conexión caída, una columna faltante, un fallo de privilegios—
corresponde al servidor y se mantiene como un `500`. Por tanto, `code.startsWith("PG_")` es una comprobación segura
para determinar que "la fila enviada era incorrecta", y las cuatro siguientes son las que un cliente
encuentra habitualmente. `details.dbCode` incluye el mismo SQLSTATE en todas ellas y
el mensaje identifica la restricción afectada.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | Un valor no se pudo interpretar según el tipo de la columna — el equivalente de escritura para `INVALID_FILTER_VALUE`. | Envía un valor correspondiente al tipo de la columna. |
| `PG_23502` | 400 | Una columna `NOT NULL` se dejó vacía. | Envía el campo o asigna un valor por defecto a la columna. |
| `PG_23503` | 400 / 409 | Al guardar, una clave foránea apunta a una fila inexistente (400). Al eliminar, otras filas aún referencian a esta (409; una clave `RESTRICT` genera `PG_23001`, también 409). | Crea la fila de destino primero o corrige el ID; para eliminaciones, borra o reasigna antes las filas que la referencian. |
| `PG_23505` | 409 | Se violó una restricción de unicidad. El mensaje indica la restricción. | Usa un valor diferente o actualiza la fila existente. |

## Almacenamiento

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `INVALID_LIST_OPTIONS` | 400 | El parámetro `maxResults` de un listado de storage no es un número entero mayor o igual a 1, o su `pageToken` no fue emitido por la fuente. Anteriormente, un tamaño menor a uno devolvía una página vacía con el mismo token, generando un bucle infinito en `while (pageToken)`. | Envía un `maxResults` positivo y reenvía `nextPageToken` sin alterarlo. |
| `INVALID_STORAGE_BUCKET` | 400 | El nombre del bucket está malformado. | Revisa el nombre. |
| `INVALID_STORAGE_KEY` | 400 | La clave del objeto está malformada, escapa de su prefijo o se encuentra bajo un prefijo reservado (`_rebase/renditions/`, `_rebase/maintenance/`). | Revisa la clave. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | Los parámetros de transformación de imagen están fuera de rango o son contradictorios. | Consulta [Storage](/docs/backend/storage/). |
| `STORAGE_BROKER_REFUSED` | 502 | El almacenamiento de plataforma (`STORAGE_TYPE=platform`) solicitó al broker de almacenamiento firmar una petición y este la rechazó por un motivo desconocido para este servidor. El mensaje incluye el código y motivo del broker. | Revisa el estado de la plataforma; si persiste, reporta el código. |
| `STORAGE_FILE_TOO_LARGE` | 413 | El archivo subido excede el `maxBytes` declarado por la columna `col.storage()`. Se valida en el servidor, no solo en el navegador. `details` contiene la columna, el límite y el tamaño recibido. | Sube un archivo menor o aumenta `maxBytes` en la columna. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | El tipo de archivo subido no figura en el `accept` de la columna ni en el `allowedMimeTypes` de la fuente de almacenamiento. `details` indica la columna (o la lista de la fuente), los tipos admitidos y el content type recibido. | Sube un archivo de tipo permitido o amplía `accept` / `allowedMimeTypes`. |
| `STORAGE_MISCONFIGURED` | 502 | El bucket de S3 o GCS configurado para esta fuente no existe, o el proveedor rechazó las credenciales de este despliegue. El mensaje indica el bucket; `details.reason` es `NoSuchBucket` o el rechazo del proveedor. Anteriormente, un bucket inexistente se interpretaba como "archivo no encontrado" para cualquier archivo. | Corrige el nombre del bucket (`S3_BUCKET` / `GCS_BUCKET`, `__<KEY>` para fuentes con nombre) o los permisos de las credenciales. |
| `STORAGE_NOT_CONFIGURED` | 501 / 503 | No hay un backend de almacenamiento configurado en este servidor, o ninguno es el predeterminado y la solicitud no especifica fuente; el mensaje nombra las fuentes servidas (501). Una subida reanudable cuya fuente desapareció antes de terminar devuelve 503. | Configura S3, GCS o almacenamiento local, o especifica una fuente con `?storageId=`. |
| `STORAGE_OBJECT_TOO_LARGE` | 413 | Una subida a storage de plataforma requiere más fragmentos (parts) de los permitidos para un único objeto. | Sube un archivo más pequeño. |
| `STORAGE_PROVIDER_ERROR` | 502 | El almacenamiento de objetos rechazó una transferencia de plataforma firmada por el broker, o respondió sin los datos requeridos (ID de subida, ETag de un fragmento). `details.status` contiene el código HTTP del almacenamiento. | Reintenta; si persiste, revisa el estado de la plataforma. |
| `STORAGE_QUOTA_EXCEEDED` | 413 | El almacenamiento de plataforma del proyecto está lleno, por lo que el broker no autorizó la subida. | Elimina archivos o amplía el límite de almacenamiento del proyecto. |
| `STORAGE_RATE_LIMITED` | 429 | El broker de almacenamiento de la plataforma está limitando las peticiones de este proyecto. | Reduce la frecuencia de solicitudes y reintenta. |
| `STORAGE_SAME_LOCATION` | 400 | Se invocó `POST /api/admin/storage/move` con `deleteSource` (`rebase storage move --delete-source`) entre dos fuentes que apuntan al mismo bucket o directorio. Todos los archivos se considerarían ya presentes en el destino al ser idénticos, y borrar la copia de origen eliminaría el único archivo existente. Nada se movió ni eliminó. | Apunta la columna a la otra fuente; sus archivos ya se encuentran allí. |
| `STORAGE_SCAN_INCOMPLETE` | 409 | `DELETE /api/admin/storage/orphans` (`rebase storage orphans --delete`) no pudo leer todas las tablas, por lo que un archivo referenciado por alguna de ellas parecería huérfano sin estarlo. Con `?scan=`, el análisis indicado es el que no pudo leer todas las tablas. Nada fue eliminado; `details.unscanned` especifica cada tabla y por qué no pudo leerse. | Soluciona lo que impide leer esas tablas y ejecuta el análisis nuevamente. |
| `STORAGE_SCAN_NOT_FOUND` | 404 | `GET /api/admin/storage/orphans/scans/:id` o `DELETE /api/admin/storage/orphans?scan=:id` apunta a un análisis inexistente en la fuente. Los análisis se conservan 7 días en la fuente analizada, por lo que un `storageId` distinto tampoco encontrará nada. | Pasa el `storageId` correcto del análisis o inicia uno nuevo. |
| `STORAGE_SCAN_NOT_COMPLETE` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` especifica un análisis aún en estado `queued`, `running` o que ha resultado `failed`. Nada fue eliminado; `details.status` indica su estado. | Espera a que termine el análisis o inicia uno nuevo. |
| `STORAGE_SCAN_EXPIRED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` especifica un análisis completado hace más de 15 minutos. Nada fue eliminado. | Inicia otro análisis y elimina sobre este último. |
| `STORAGE_SCAN_DELETION_STARTED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` apunta a un análisis cuyos archivos huérfanos ya están en proceso de eliminación. | Consulta el progreso de la eliminación con `GET /api/admin/storage/orphans/scans/:id`. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | La fuente de almacenamiento está declarada pero no tiene credenciales en este entorno. | Configura las variables de entorno para esa fuente. |
| `STORAGE_UNAVAILABLE` | 503 | El broker de almacenamiento de la plataforma es inaccesible o no puede contabilizar las subidas en la cuota temporalmente. Las lecturas de archivos descargados durante la última hora siguen funcionando durante una interrupción. | Reintenta en unos momentos. |
| `STORAGE_WRITE_FAILED` | 502 | El backend de almacenamiento rechazó o interrumpió la escritura. | Revisa sus propios logs y credenciales. |
| `TRANSFORM_OVERLOADED` | 503 | Hay demasiadas transformaciones de imagen ejecutándose a la vez. | Reintenta; considera colocar una CDN al frente. |
| `UNKNOWN_STORAGE_SOURCE` | 400 / 404 | La solicitud especificó una fuente (`?storageId=`) no declarada en este proyecto. Un `bucket` no servido por este despliegue devuelve este mismo código con estado **404** (en listados, subidas, carpetas o subidas reanudables a S3 o GCS) — lo que falta es el bucket, y `details` lista los buckets y fuentes que sí existen. Ambos solían reportarse como "archivo no encontrado", idéntico a una clave que simplemente no existe. | Declara la fuente en `config/resources.ts` o consulta `GET /api/storage/sources`. |
| `UPLOAD_LOCKED` | 423 | Se recibió el `PATCH` de una subida reanudable mientras se recibía otro fragmento de la misma subida — casi siempre por un cliente reintentando un fragmento en vuelo. Se rechaza en vez de encolarse, siguiendo el comportamiento de tusd. | Consulta el desplazamiento con `HEAD /api/storage/tus/:id` y reanuda desde allí; tus-js-client gestiona las pausas y reintentos automáticamente. Consulta [Resumable uploads (TUS)](/docs/backend/storage-resumable-uploads/). |

## Funciones personalizadas

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | No se sirve ninguna función con ese nombre — o existe, pero sus propias rutas no cubren la ruta solicitada. A un emisor autenticado también se le informa qué funciones *sí* se sirven; a uno anónimo no, pues esa lista supone un inventario de todos los endpoints personalizados. Cuando un archivo con ese nombre no pudo cargarse, el mensaje informa de ello a un emisor autenticado, indicando el archivo: esa es la diferencia entre un error tipográfico y un fallo de despliegue. Un emisor anónimo recibe la respuesta simple de nombre desconocido, igual que para nombres sin coincidencia. | Verifica el nombre con `GET /api/functions` o revisa en el log de arranque si algún archivo falló al cargar. |
| `FUNCTION_TIMEOUT` | 504 | El controlador superó su tiempo límite de ejecución. Sigue ejecutándose internamente; no es posible cancelarlo desde aquí. El mensaje y `details` (`{ timeoutMs, source }`) especifican qué límite aplicó y dónde fue configurado. | Proporciona un `AbortSignal` a las llamadas salientes, declara el `timeoutMs` propio de la función (`defineFunction(…, { timeoutMs })`, máximo `REBASE_FUNCTIONS_MAX_TIMEOUT_MS`), o incrementa `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Este proceso actúa como proxy de funciones hacia otro que no respondió. | Comprueba que la unidad de funciones esté ejecutándose. |

## Funciones SQL como RPC

<span class="since-badge" data-since="0.35">Desde 0.35</span>

`POST /api/rpc/<name>` — consulta [SQL functions as RPC](/docs/backend/rpc/). Un argumento incorrecto devuelve `VALIDATION_CONSTRAINT` (400), con `details.violations` nombrando cada campo, al igual que en la API de datos; una credencial sin `data:read` devuelve `SCOPE_MISSING` (403); una RPC pública que exceda su cuota devuelve `RATE_LIMITED` (429).

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `RPC_NOT_FOUND` | 404 | No se exporta ningún `defineRpc` con ese nombre desde `backend/schema/index.ts`. Solo se pueden invocar funciones declaradas, por lo que una función existente en la base de datos que nadie haya declarado también devuelve esto. | Declárala con `defineRpc` o revisa el nombre. |
| `METHOD_NOT_ALLOWED` | 405 | La RPC existe, pero fue llamada con un método diferente a `POST`. La respuesta incluye `Allow: POST`. | Realiza un `POST` con un cuerpo JSON de argumentos con nombre. |
| `INVALID_RPC_BODY` | 400 | El cuerpo es JSON, pero no un objeto con argumentos con nombre (por ejemplo, un array o un string). | Envía `{ "argument": value }`, o ningún cuerpo si no requiere argumentos. |
| `RPC_ARGUMENTS_MISMATCH` | 400 | Ninguna sobrecarga de la función SQL admite los argumentos enviados: se omitió un parámetro sin `DEFAULT`, o se especificó uno que no existe. El mensaje lista los parámetros esperados. | Envía los argumentos esperados por la función y márcalos como `.required()` en `args`. |
| `RPC_INVALID_ARGUMENT` | 400 | Postgres rechazó un valor por ser incompatible con el tipo de parámetro de la función (un SQLSTATE clase 22): `"abc"` para un `uuid`, un valor fuera del enum. | Envía un valor compatible con el tipo del parámetro. |
| `RPC_EXCEPTION` | 400, o el estado indicado por un SQLSTATE `PTnnn` | La función lanzó una excepción: `RAISE EXCEPTION '…'` devuelve 400 con su mensaje, y `details` incluye `sqlState`, `detail` e `hint`; `RAISE SQLSTATE 'PT404'` responde 404, al igual que PostgREST. | El mensaje proviene de la propia función. |
| `RPC_READ_ONLY` | 500 | La función intentó escribir, y una RPC se ejecuta en una transacción de solo lectura a menos que se declare con `write: true`. | Añade `write: true` a su `defineRpc`. |
| `RPC_FUNCTION_MISSING` | 500 | La RPC está declarada, pero la base de datos no tiene una función con ese esquema y nombre. Postgres almacena nombres sin comillas en minúsculas. | Crea la función, o corrige el nombre o `schema` en `defineRpc`. |
| `RPC_AMBIGUOUS` | 500 | Múltiples sobrecargas de la función aceptan los argumentos enviados. | Elimina las sobrecargas a las que la RPC no deba acceder o renómbralas. |

## Notificaciones push

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `PUSH_ENDPOINT_REFUSED` | 400 | El endpoint de la suscripción no pertenece a un servicio push reconocido por los navegadores (FCM, Mozilla, Apple, Windows) sobre `https`. El servidor envía un POST a esa dirección en cada notificación, por lo que no acepta otros. | Envía `PushSubscription.toJSON()` tal como lo generó el navegador, o añade un servicio de pruebas en `push.allowedHosts`. Consulta [Push notifications](/docs/backend/push-notifications/#routes). |
| `PUSH_NEEDS_A_USER` | 403 | Una clave de API o la clave de servicio intentó invocar una ruta push. Una suscripción corresponde al navegador de una persona autenticada. | Invócala utilizando la sesión de esa persona. |
| `PUSH_NOT_CONFIGURED` | 503 | El servicio push está activo pero no puede enviar: faltan claves VAPID en producción o no se pudo inicializar su tabla. El mensaje aclara cuál fue la causa. | Configura `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` y `REBASE_VAPID_SUBJECT`. Consulta [Push notifications](/docs/backend/push-notifications/#keys). |

## Trabajos cron

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `CRON_JOB_ALREADY_EXECUTING` | 409 | Ejecución manual de una tarea cron que ya se encuentra en curso — en el proceso que respondió o en otro que tiene la reserva de ejecución, como el worker detrás de un proceso `api`. No se ejecutó nada. La omisión queda registrada en el historial del trabajo, y `details.log` contiene dicha entrada; su línea identifica el proceso que ejecuta el trabajo. | Reintenta cuando concluya la ejecución en curso. Consulta [Cron Jobs](/docs/backend/cron-across-instances/#concurrency-guarding). |

## Superficies de administración y edición de esquemas

Estos códigos indican que una funcionalidad está desactivada o no configurada, y no que
la solicitud fuera incorrecta. Cada una de ellas también se reporta en su ruta
`/status` correspondiente con un código `200`, permitiendo al panel deshabilitar
la opción visualmente en lugar de mostrar un error.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | Se invocó una superficie exclusiva de administración en un servidor sin autenticación configurada, por lo que no es posible distinguir a un administrador de un usuario cualquiera. | Configura `auth.jwtSecret` o pasa un `AuthAdapter`. |
| `BRANCH_DIFF_STALE` | 409 | `POST /api/admin/branches/:name/merge` recibió el fingerprint de un diff desactualizado: la rama o su padre cambiaron desde entonces. No se guardó nada. | Vuelve a leer el diff, revísalo y fusiona usando su nuevo `fingerprint`. |
| `BRANCH_DIFF_UNSUPPORTED` | 501 | La fuente de datos no puede comparar ramas: carece de soporte SQL o de ramificación (no hay conexión administrativa). | Utiliza un backend Postgres con `adminConnectionString` configurado. |
| `BRANCH_MERGE_BLOCKED` | 409 | Una tabla con diferencias no puede ser fusionada — creada o eliminada por la rama, diferencias en columnas o clave primaria, sin clave primaria, demasiadas filas para comparar o reescrita tras la creación de la rama (`TABLE_REWRITTEN`). Una tabla cuyas filas no pudieron compararse bloquea el proceso incluso si sus recuentos muestran 0: son recuentos indeterminados, no cero. `details.tables` lista cada una con su motivo. No se guardó nada. | Aplica el esquema con tus migraciones previamente o fusiona con `skipBlocked: true` para ignorar esas tablas. |
| `BRANCH_MERGE_CONFLICT` | 409 | Se modificaron filas tanto en la rama como en su padre y `onConflict` estaba en `"abort"` (por defecto); o el padre rechazó parte de la fusión — una fila cambió entretanto, un disparador la omitió o una política la ocultó. No se guardó nada. | Define qué lado prevalece con `onConflict: "branch"` o `"target"`, o lee el diff nuevamente. |
| `BRANCH_MERGE_FAILED` | 409 | El padre rechazó las filas de la rama dentro de la sentencia merge — una restricción, una etiqueta de enum o una clave foránea existente que las filas de la rama rompen, comúnmente debido a diferencias entre esquemas. `details` contiene `sqlState`, `table`, `constraint` y `detail`. No se guardó nada. | Revisa las diferencias de esquema en el diff, alinea el esquema del padre con tus migraciones o corrige las filas de la rama y fusiona otra vez. |
| `BRANCH_NOT_FOUND` | 404 | No existe ninguna rama con ese nombre en el registro. | `rebase db branch list`, o el panel Branches, lista las existentes. |
| `CONTRACT_UNAVAILABLE` | 404 | El contrato del proyecto solo se sirve cuando la autenticación está configurada — describe todas las tablas y relaciones. | Configura auth. `/meta/schema-version` siempre se sirve. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | No hay ningún buzón de desarrollo activo. Los correos solo se capturan si `SMTP_HOST` no está configurado y `NODE_ENV` no es production. | Elimina la variable `SMTP_HOST` en desarrollo o revisa la bandeja de entrada real. |
| `DOCS_UNAVAILABLE` | 404 | `GET /api/docs` se sirve a los mismos emisores a los que `GET /api/schema/tables` describe las tablas; este servidor no tiene autenticación configurada, por lo que no hay nadie a quien describirlas. | Configura auth o publica la documentación completa para todos con `enableSwagger: true` (`REBASE_ENABLE_SWAGGER=true`). |
| `INVALID_CHANGE` | 400 | El cambio de esquema propuesto no está bien formado. | Consulta el mensaje. |
| `SCHEMA_CHANGE_FAILED` | 400 | La aplicación del cambio de esquema falló por un motivo no cubierto por códigos más específicos. | Consulta el mensaje; reproduce el error subyacente de forma textual. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | El cambio es válido pero no puede aplicarse al esquema en su estado actual. | Consulta el mensaje. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | El repositorio contiene cambios sin confirmar (uncommitted), impidiendo aplicar la modificación de forma segura. | Haz commit o stash y luego reintenta. |
| `SCHEMA_EDIT_REFUSED` | 400 | El editor de esquemas rechazó el cambio: lo que modificaría está escrito en código que no puede reescribir (un spread, una función auxiliar, una clave calculada), o es una acción no permitida (renombrar una tabla, eliminar la última regla). `details.problems` enumera cada caso. Nada fue escrito. | Consulta el mensaje. Realiza el cambio manualmente en `backend/schema`. |
| `SCHEMA_EDIT_DOES_NOT_COMPILE` | 400 | La edición es factible, pero el esquema resultante no compilaría — una relación hacia una tabla eliminada o una regla que referencia una columna suprimida. `details.problems` contiene los diagnósticos del compilador, cada uno con su tabla y columna. No se guardó nada. | Modifica primero las tablas de las que depende o realiza el cambio manualmente en `backend/schema`. |
| `SCHEMA_EDIT_STALE_FILE` | 409 | Un archivo afectado por la edición cambió en disco tras prepararse el cambio (guardado en IDE, otro proceso). No se guardó nada. | Recarga y aplica el cambio de nuevo sobre el archivo actual. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Una clave de API u otra entidad de máquina intentó aplicar un cambio de esquema. | Inicia sesión como usuario o configura `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | La edición de esquema en caliente requiere `schemaDir` (el directorio `backend/schema`) o `liveSchema.repository`, y el servidor se inició sin ninguno de ellos. El código conserva su nombre histórico. | Configura uno de ellos. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | La planificación funciona, pero no existe un repositorio donde confirmar los cambios — despliegues ejecutando un bundle compilado o servidores cuyo `backend/schema` no está bajo git (toda aplicación genera un commit). | Ejecuta `git init` en el proyecto y reinicia el servidor (el repositorio se detecta al inicio), o define `liveSchema.repository`. |
| `SCHEMA_EDITING_PROVISIONING_OFF` | 409 | Este despliegue no altera su base de datos (`REBASE_PROVISION=false`), por lo que no se pueden aplicar cambios desde el panel. | Confírmalo únicamente como código fuente y deja que el proceso responsable aplique los cambios en la base de datos. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Este driver no permite planificar cambios de esquema. | La edición en caliente está disponible en Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | Las tablas se inspeccionan directamente desde la base de datos en este entorno, por lo que no hay archivos fuente para editar. | Modifica el esquema mediante una migración. |
| `SCHEMA_EDITOR_DISABLED` | 501 | El editor de esquemas está desactivado en este servidor. Un bundle compilado siempre responderá esto. | Actívalo con `schemaEditor`. En un bundle, configura `REBASE_LIVE_SCHEMA_REPOSITORY` para editar `backend/schema` mediante un repositorio — consulta [Live schema editing](/docs/backend/live-schema-editing#from-a-built-bundle). |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | El editor de esquemas requiere `ts-morph`, que no se encuentra instalado. | Instálalo en el paquete que ejecuta el backend y reinicia: `pnpm --dir backend add -D ts-morph@28.0.0` desde la raíz del proyecto, o `pnpm add -D ts-morph@28.0.0` si el backend es la raíz. El mensaje indica el comando específico para tu proyecto. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | El servidor carece de `schemaDir`, por lo que el editor no tiene dónde escribir. El código conserva su nombre histórico. | Define `schemaDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | El editor está desactivado con `NODE_ENV=production`: los archivos de un servidor desplegado se reconstruyen desde el repositorio en cada deploy, por lo que cualquier cambio aquí se perdería. | Edita `backend/schema` en desarrollo y despliega, o configura `liveSchema.repository` para confirmar los cambios allí. |
| `SCHEMA_UNAVAILABLE` | 404 | `GET /api/schema/tables` en un backend sin autenticación configurada: no existe un emisor para el cual filtrar las tablas, y `auth.requireAuth: false` no altera este comportamiento. | Configura un adaptador de autenticación o `auth.jwtSecret`. Consulta [Endpoints](/docs/backend/endpoints/#schema). |
| `TABLE_NOT_FOUND` | 404 | `GET /api/schema/tables/:slug` apunta a una tabla no disponible para este emisor — no existe dicho slug o los ámbitos de sus credenciales no la alcanzan. | Verifica el slug y los ámbitos `data:*` de la credencial. |
| `UI_PREFERENCES_NEED_A_PERSON` | 403 | `/api/admin/ui-config` fue invocado con una clave de API, un token de plataforma o la clave de servicio. Las preferencias de UI corresponden a una persona autenticada. | Inicia sesión como usuario. |
| `UI_PREFERENCES_TOO_LARGE` | 413 | Las preferencias de UI de una tabla superan los 64 KB. | Guarda menos información: las preferencias almacenan presentación, no datos. |
| `UI_PREFERENCES_UNSUPPORTED` | 501 | El driver de este backend no soporta SQL, por lo que no guarda preferencias de UI; el panel las mantiene en el navegador. | No requiere acción: las preferencias se mantienen por navegador. |
| `UI_CONFIG_FILE_INVALID` | 500 | `frontend/src/cms/ui-config.json`, donde se guardan las preferencias de UI del espacio de trabajo en desarrollo, no contiene JSON válido. | Corrígelo o elimínalo; el panel lo regenerará en el próximo guardado. |
| `SQL_EXPORT_UNSUPPORTED` | 501 | `POST /api/admin/sql/csv` no puede transmitir resultados en este entorno: la base de datos de desarrollo en proceso (PGlite) tiene una sola conexión, y retener un cursor durante una descarga bloquearía todas las demás consultas; o la fuente de datos carece de cursor SQL. | Apunta `DATABASE_URL` a una instancia Postgres propia (`rebase dev --docker` inicia una), o añade un `LIMIT` y exporta las filas en pantalla. |

### Conciliación de esquemas (Schema reconcile)

[`rebase schema reconcile`](/docs/cli/schema/#rebase-schema-reconcile) planifica
mediante `POST /api/admin/schema/reconcile/plan` y aplica mediante
`/reconcile/apply`. Un rechazo no altera nada; únicamente `SCHEMA_RECONCILE_FAILED`
puede dejar parte de un plan aplicado.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `INVALID_RECONCILE` | 400 | El cuerpo no es un objeto JSON o `drop` no es un listado de cadenas `"<table>.<column>"`. | Envía `{ "drop": ["voice_cache.wav"] }` u omite `drop`. |
| `SCHEMA_RECONCILE_FAILED` | 400 | Una sentencia falló durante la ejecución. Las sentencias previas se ejecutaron y permanecen aplicadas; `details.applied` las lista. | Corrige lo que señale el mensaje y planifica de nuevo: el nuevo plan excluirá lo ya ejecutado. |
| `SCHEMA_RECONCILE_INVALID` | 400 | El plan no puede aplicarse; el mensaje explica las razones: un `drop` sin formato `<table>.<column>`, referencias a tablas o columnas inexistentes, o columnas que la tabla todavía declara. `details.plan` contiene el plan. | Corrige la lista `drop`. Una columna declarada se elimina retirándola de su `defineTable`, desplegando y luego conciliando. |
| `SCHEMA_RECONCILE_STALE` | 409 | La base de datos o las tablas cambiaron desde el plan confirmado. `details.plan` contiene el nuevo plan. | Revisa el nuevo plan y confirma su `digest`. |
| `SCHEMA_RECONCILE_UNCONFIRMED` | 400 | `/reconcile/apply` se invocó sin `confirm`. | Planifica primero y envía el `digest` del plan en `confirm`. La CLI hace esto automáticamente al escribir `yes`. |
| `SCHEMA_RECONCILE_UNSUPPORTED` | 503 | El driver de este backend no puede planificar conciliaciones o no puede ejecutar SQL. | La conciliación funciona sobre Postgres. |

### Por qué no se puede fusionar la tabla de una rama

`BRANCH_MERGE_BLOCKED` nombra cada tabla rechazada en `details.tables`, con uno
de estos códigos. El mismo código aparece en el campo `blocked` de la tabla dentro del propio diff,
permitiendo a Studio indicarlo antes de pulsar **Merge**. Ninguno es una respuesta
HTTP por sí mismo.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `COLUMNS_DIFFER` | — | Las columnas de la tabla difieren entre la rama y su padre. Las filas se comparan únicamente sobre las columnas compartidas. | Añade las columnas faltantes al padre mediante tus migraciones (`rebase db push`) y luego fusiona. Una migración que reescriba la tabla —como un cambio de tipo de columna— la convierte en `TABLE_REWRITTEN`: fusiona antes de dicho cambio o recrea la rama tras él. |
| `NO_PRIMARY_KEY` | — | La tabla no tiene clave primaria, por lo que las filas no pueden compararse una a una; el diff solo muestra recuentos de filas. | Añade una clave primaria a la tabla o traslada sus filas manualmente. |
| `PRIMARY_KEY_DIFFERS` | — | Las columnas de la clave primaria, o sus tipos, difieren entre ambas. | Aplica el esquema al padre previamente. |
| `TABLE_ADDED` | — | La rama creó la tabla. Una fusión nunca crea tablas. | Créala en el padre mediante tus migraciones y luego fusiona sus filas. |
| `TABLE_DROPPED` | — | La rama eliminó la tabla. Una fusión nunca elimina tablas. | Elimínala mediante tus migraciones. |
| `TABLE_REWRITTEN` | — | Un extremo reescribió todas las filas de la tabla tras crearse la rama — cambio de tipo de columna, `ADD COLUMN` con valor por defecto volátil, `VACUUM FULL`, `CLUSTER` — por lo que todas las filas aparecen como modificadas posteriormente y ya no se puede distinguir qué lado alteró cada fila. | Fusiona la rama antes de esa migración o recrea la rama desde el padre después de ella. |
| `TOO_LARGE` | — | La tabla contiene en uno de los lados más filas de las que un diff puede comparar individualmente (100.000 por defecto, `maxRowsPerTable`). | Incrementa `maxRowsPerTable` tanto en el diff como en el merge, o traslada las filas por otro medio. |

## Códigos genéricos

Una ruta devuelve uno de estos códigos cuando no aplica ninguno más específico.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Solicitud malformada sin un código más específico aplicable. | Consulta el mensaje. |
| `UNAUTHORIZED` | 401 | No autenticado, o la credencial fue rechazada. | Inicia sesión o renueva el token. |
| `FORBIDDEN` | 403 | Autenticado, pero sin permisos suficientes. | Reintentar con la misma identidad no servirá. |
| `CONFLICT` | 409 | Conflicto con el estado actual. | Consulta el mensaje. |
| `INTERNAL_ERROR` | 500 | Fallo interno en el servidor. El mensaje es intencionadamente genérico. | Proporciona el `requestId`; la causa detallada se encuentra en los logs. |
| `NOT_CONFIGURED` | 503 | Una dependencia necesaria para esta ruta no está configurada en este servidor. | Consulta el mensaje. |
| `SERVICE_UNAVAILABLE` | 503 | Un servicio externo del cual depende la solicitud no pudo ser alcanzado: un bucket de S3 o MinIO, o un host al que una función hace `fetch()` que rechaza la conexión o no se resuelve. El log del servidor nombra el host; la respuesta HTTP no. Una base de datos inalcanzable devuelve `DATABASE_UNAVAILABLE`. Una conexión fallida hacia tales servicios devuelve este código. | Reintenta; revisa los logs. |

## Mantenimiento de la exactitud de esta página

`pnpm verify:docs` falla si falta en estas tablas algún código que el servidor
pueda emitir, si una tabla lista un código inexistente en el código fuente, si los estados de una fila no
coinciden exactamente con los emitidos por el código, o si una familia de códigos como `PG_<SQLSTATE>` carece
de fila para un SQLSTATE que los clientes puedan recibir. El script encargado es
`tooling/scripts/docs-verify/check-error-codes.mjs`.

Se comprueba a sí mismo previamente. El escaneo extrae los códigos directamente de TypeScript en lugar
de un servidor en ejecución, por lo que sus puntos ciegos son silenciosos por diseño: en el pasado no
detectaba códigos envueltos en funciones de una sola línea o escritos tras un mensaje con un
`)`, reportando que "todos los códigos que el servidor puede emitir están documentados" en
una página a la que le faltaban diecisiete de ellos. Por ello, el paso ejecuta un fixture con exactamente
dichos casos antes de leer esta página, y se niega a validar nada si no es capaz de verlos.
