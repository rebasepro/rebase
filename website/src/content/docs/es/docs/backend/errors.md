---
sourceHash: f3bc0de4cbc7297e
title: Códigos de error
sidebar_label: Códigos de error
description: Todos los códigos de error que un backend de Rebase puede devolver, con su estado HTTP, qué significan y qué hacer al respecto — además del envoltorio de respuesta, X-Request-ID y las reglas de details.
---

Cada fallo que devuelve un backend de Rebase utiliza un único envoltorio y contiene un
`code` estable. El código es el elemento sobre el que bifurcar en la lógica: el mensaje está escrito para
una persona y puede cambiar de redacción, el estado lo comparten una docena de problemas
distintos, y el código no es ninguna de las dos cosas.

## El envoltorio

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

- **`message`** — legible por humanos. Para un `4xx`, es el propio mensaje del servidor; para
  un `5xx`, es deliberadamente genérico, porque el texto subyacente puede citar un
  host, un rol o un nombre de columna.
- **`code`** — uno de los valores a continuación. Estable entre versiones menores.
- **`details`** — opcional y nunca garantizado. Consulta las reglas más abajo.
- **`requestId`** — presente siempre que la solicitud haya pasado por el middleware de
  request-ID, lo cual aplica a todas las rutas bajo `basePath`.

### `X-Request-ID`

Cada solicitud bajo `basePath` recibe un ID: la cabecera `X-Request-ID` del
llamador cuando es un UUID, o uno nuevo en caso contrario. Se devuelve en la
respuesta como `X-Request-ID`, se incluye en el envoltorio de error como `requestId` y
se adjunta a la línea de log del servidor para esa solicitud.

Esa es la clave de unión. Cítala en un informe de errores y un operador podrá encontrar la línea
exacta de log que explica el fallo, con el motivo que nunca se le
mostró al cliente.

Enviar el tuyo propio es la forma en que una traza sobrevive a un salto: una pasarela (gateway) o un ejecutor de trabajos
que reenvía la cabecera obtiene un único ID en todos los servicios que procesaron la solicitud.
Un valor no válido se ignora en lugar de rechazarse —no vale la pena fallar una solicitud por una
cabecera mal formada del llamador—, así que no asumas que el ID enviado es el
ID recibido. Lee la cabecera de la respuesta.

### Qué contiene `details`

`details` tiene fines de diagnóstico, no contractuales. Se rige por tres reglas:

1. **Todo lo que una ruta define explícitamente se devuelve siempre.** Estos son los
   propios errores del llamador descritos con precisión: qué campo de filtro era desconocido,
   qué relación no es de escritura, qué valor no coincidía con su tipo.
2. **Los diagnósticos de la base de datos se recortan en producción.** Cuando el fallo proviene
   de Postgres, `details.dbCode` —el SQLSTATE— está siempre presente: nombra
   la clase de problema y no revela nada sobre los datos. `dbMessage`,
   `detail` e `hint` solo se agregan cuando `NODE_ENV` no es `production`,
   porque Postgres incluye en ellos el contenido de las filas. `23505` informa
   `Key (email)=(a@b.c) already exists.`, lo cual respondería "¿está registrada esta persona?"
   para cualquier dirección que alguien decida probar.
3. **Nunca bifurques tu lógica según `details`.** Hazlo según `code`. Lo que está bajo `details` es
   aquello que resultaba útil para una persona en ese punto de la llamada, y está sujeto a cambios.

## Interpretar un estado

| Estado | Lo que indica sobre la solicitud |
| --- | --- |
| `400` | Malformada, o solicitando algo que no existe en el esquema. Corrige la solicitud. |
| `401` | No autenticado, o la credencial ha expirado. Inicia sesión o renueva el token. |
| `403` | Autenticado, pero no permitido. Reintentar con la misma identidad no servirá de nada. |
| `404` | No existe tal ruta, colección o fila — o se trata de una fila que la seguridad a nivel de fila oculta. |
| `409` | Conflicto con el estado existente: un duplicado o una escritura concurrente. |
| `413` `415` `422` | El cuerpo es demasiado grande, el tipo de medio es erróneo o se ha rechazado semánticamente. |
| `429` | Límite de tasa excedido (rate limit). Espera un momento; el mensaje indica cuánto tiempo. |
| `500` | El servidor o su base de datos han fallado, no el llamador. Revisa los logs. |
| `501` | La ruta existe, pero este despliegue no puede atenderla — una funcionalidad desactivada o sin configurar. |
| `502` `503` `504` | Una dependencia era inaccesible, no estaba configurada o fue demasiado lenta. |

## Autenticación y cuentas

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | La ruta requiere un segundo factor y la sesión solo tiene uno. | Completa el desafío MFA y luego reintenta. |
| `ALREADY_VERIFIED` | 400 | La dirección o el factor ya están verificados. | Nada — el estado deseado ya se cumple. |
| `ACCOUNT_OUTRANKS_CALLER` | 403 | La cuenta que se intenta editar, restablecer o eliminar posee un rol o alcance (scope) que el llamador no tiene. `details.beyond` los enumera. | Haz que alguien que los posea realice el cambio. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | El inicio de sesión anónimo está desactivado en este servidor. | Actívalo o inicia sesión con una identidad real. |
| `ANONYMOUS_NOT_ALLOWED` | 403 | Una sesión de invitado intentó aprobar el inicio de sesión de un dispositivo. Un invitado no tiene una cuenta para vincular a un dispositivo. | Inicia sesión con una cuenta y luego apruébalo. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Una clave de API intentó listar, crear, modificar o revocar claves de API, ya sean de su propio tipo o personales. | Gestiona las claves como un usuario con `keys:write`, o con la clave de servicio. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Una ruta protegida se ejecutó sin ningún middleware de autenticación de Rebase previo, por lo que nunca se evaluó la credencial del llamador. | Monta la aplicación a través del enrutador de funciones en lugar de directamente en tu propio servidor. |
| `BOOTSTRAP_ANONYMOUS` | 403 | Un llamador anónimo intentó realizar el bootstrap del primer administrador. | Inicia sesión primero. |
| `BOOTSTRAP_COMPLETED` | 403 | El primer administrador ya existe. | Pide a un administrador existente que conceda el rol. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | El bootstrap es solo para el primerísimo usuario, y este no lo es. | Pide a un administrador existente que conceda el rol. |
| `CAPTCHA_FAILED` | 400 | El proveedor rechazó el token de CAPTCHA. | Resuelve un nuevo desafío. |
| `CAPTCHA_REQUIRED` | 400 | La ruta requiere un token de CAPTCHA y no se envió ninguno. | Incluye el token. |
| `CHALLENGE_EXHAUSTED` | 401 | Demasiados códigos incorrectos para un mismo desafío MFA. | Inicia un nuevo desafío. |
| `DEVICE_LOGIN_DECIDED` | 409 | El inicio de sesión del dispositivo ya fue aprobado o denegado. Un inicio de sesión se resuelve una sola vez. | Inicia uno nuevo en el dispositivo. |
| `DEVICE_LOGIN_EXPIRED` | 410 | El inicio de sesión del dispositivo superó sus diez minutos antes de resolverse. | Inicia uno nuevo en el dispositivo. |
| `DEVICE_LOGIN_NOT_FOUND` | 404 | Ningún inicio de sesión de dispositivo tiene ese código de usuario. El sondeo del propio dispositivo responde en su lugar con los códigos en minúsculas del RFC 8628: `authorization_pending`, `slow_down`, `access_denied`, `expired_token`, `invalid_grant`. | Comprueba el código con el que muestra el dispositivo. |
| `EMAIL_EXISTS` | 409 | Ya existe una cuenta con esa dirección: en el registro, en un cambio de dirección y al hacer clic en un enlace de cambio de dirección cuando otra cuenta tomó la dirección mientras esperaba. | Inicia sesión o inicia un restablecimiento de contraseña; para un cambio de dirección, elige otra. |
| `EMAIL_NOT_CONFIGURED` | 503 | Se solicitaron enlaces mágicos o códigos OTP y el servidor no tiene transporte de correo configurado. | Configura SMTP o utiliza otro método de inicio de sesión. |
| `EMAIL_NOT_VERIFIED` | 403 | Un inicio de sesión con OAuth encontró una cuenta con la misma dirección y el proveedor no verificó dicha dirección, por lo que no está vinculada. | Inicia sesión con el método existente y luego ejecuta `POST /auth/link/<provider>`. |
| `FACTOR_NOT_VERIFIED` | 400 | El factor MFA se registró pero nunca se confirmó. | Confirma el factor. |
| `IDENTITY_ALREADY_LINKED` | 409 | Esa identidad de OAuth pertenece a otra cuenta. | Inicia sesión con ella o desvincúlala de la otra cuenta primero. |
| `IMPERSONATION_FORBIDDEN` | 403 | Una solicitud envió `x-rebase-impersonate` y su llamador no tiene permiso para ejecutar una solicitud como otro usuario. Solo la sesión propia de un administrador autenticado puede hacerlo, nunca una clave de API o la clave de servicio. | Envíala con la sesión de un administrador o no incluyas la cabecera. |
| `IMPERSONATION_INVALID` | 400 | `x-rebase-impersonate` se envió vacío. | Envía el uid del usuario a suplantar, o no incluyas la cabecera. |
| `IMPERSONATION_TARGET_NOT_FOUND` | 404 | `x-rebase-impersonate` no especifica ningún usuario activo: ninguna cuenta tiene ese uid, o está desactivada. | Comprueba el uid. |
| `IMPERSONATION_UNAVAILABLE` | 501 | La autenticación de este backend no puede ejecutar una solicitud como otro usuario porque su `AuthAdapter` no tiene `resolveUser`. | Implementa `resolveUser` en el adaptador o no incluyas la cabecera. |
| `IMPERSONATION_UNSUPPORTED` | 400 | `x-rebase-impersonate` se envió a una ruta que no puede ejecutarse como otro usuario. Solo la API de datos y las funciones personalizadas lo admiten, y el socket en tiempo real admite `impersonate` en `AUTHENTICATE`. | Envía la solicitud sin la cabecera. |
| `SIMULATION_FORBIDDEN` | 403 | Una solicitud envió una cabecera `x-rebase-simulate-*` (el simulador de RLS) o consultó `/api/admin/rls-simulator`, y su llamador no puede simular acceso. Solo la sesión de un administrador autenticado puede hacerlo, nunca una clave de API o la clave de servicio. | Envíala con la sesión de un administrador o elimina las cabeceras. |
| `SIMULATION_INVALID` | 400 | La simulación estaba malformada: una cabecera se envió vacía, se combinó `x-rebase-simulate-api-key-id` con un rol o un id de usuario, o se combinó la simulación con `x-rebase-impersonate`. | Especifica un solo rol (opcionalmente con un uid), un id de usuario o un id de clave de API. |
| `SIMULATION_READ_ONLY` | 403 | Una operación de escritura, borrado, `_batch`, reversión de historial o una función personalizada invocada con cualquier verbo que no sea `GET`/`HEAD`/`OPTIONS` incluía una cabecera `x-rebase-simulate-*`. El acceso simulado es de solo lectura: la escritura se ejecutaría con la identidad simulada, no como administrador. Las lecturas, incluidas `POST …/query` y `…/count`, continúan funcionando. | Deja de simular para realizar cambios. |
| `SIMULATION_TARGET_NOT_FOUND` | 404 | La simulación no hace referencia a ningún usuario activo (se envió un id de usuario sin rol) o a ninguna clave de API activa. | Comprueba el id, o envía un rol junto con el uid para simular un uid que no tiene cuenta. |
| `SIMULATION_UNAVAILABLE` | 501 | Este backend no puede simular acceso: su `AuthAdapter` no dispone de `resolveUser` para confirmar a un administrador, o se especificó una clave en un backend sin claves de API. | Implementa `resolveUser` o no incluyas las cabeceras. |
| `SIMULATION_UNSUPPORTED` | 400 | Se envió una cabecera `x-rebase-simulate-*` a una ruta que no admite ejecución con acceso simulado. Solo la API de datos y las funciones personalizadas las reconocen. | Envía la solicitud sin las cabeceras. |
| `GUEST_REFERENCED` | 409 | No se pudo eliminar a un invitado porque una fila del propio proyecto lo requiere, a través de una clave foránea con `ON DELETE RESTRICT` o `NO ACTION`. `DELETE /api/admin/guests` lo reporta por invitado en `skipped` y continúa. | Elimina la fila o conserva al invitado. |
| `INVALID_ACCOUNT` | 400 | La cuenta se encuentra en un estado sobre el cual esta operación no puede actuar. | Consulta el mensaje. |
| `INVALID_CHALLENGE` | 400 | El desafío MFA es desconocido o ha expirado. | Inicia uno nuevo. |
| `INVALID_CODE` | 400 / 401 | El código OTP o MFA es incorrecto: 400 desde el inicio de sesión con código por correo (`/auth/otp/verify`), 401 desde un registro o desafío MFA. | Reintenta con el código actual. |
| `INVALID_CREDENTIALS` | 401 | Correo electrónico o contraseña incorrectos — deliberadamente no se especifica cuál. | Reintenta o restablece la contraseña. |
| `INVALID_PLATFORM_TOKEN` | 401 | Se rechazó un token de plataforma `rpt_`: firma incorrecta, audiencia incorrecta, expirado o tiempo de vida por encima del límite máximo. El mensaje indica cuál fue el motivo. | Haz que la plataforma genere uno nuevo; en Rebase Cloud, vuelve a ejecutar el comando. |
| `INVALID_SCOPES` | 400 | Se solicitó para una clave algo que no es un scope: malformado, desconocido o con un destino que el scope no admite. `details.problems` indica cuál y por qué; `details.validScopes` enumera los scopes que puede tener una clave. Excluye `keys:read` y `keys:write`, que ninguna clave puede poseer. | Usa un nombre de la lista. Consulta [Roles and scopes](/docs/backend/roles-and-scopes/). |
| `INVALID_TOKEN` | 400 / 401 | Un token de verificación, restablecimiento, enlace mágico o cambio de dirección está malformado, es desconocido, ya fue utilizado o ha expirado (400). Una credencial de proveedor OAuth o un token de actualización que no se verifica es un 401. | Solicita un nuevo enlace o inicia sesión de nuevo. |
| `INVALID_USER_CODE` | 400 | Lo que se envió como código de inicio de sesión de dispositivo no lo es: deben ser ocho letras, como `BCDF-GHJK`. | Copia el código que muestra el dispositivo. |
| `INVALID_ROLE` | 400 | El nombre del rol que se intenta escribir no es una cadena, está vacío o contiene `,`, `{`, `}`, `"`, `\` o un carácter de control. Esos caracteres se interpretarían como otros roles: un rol viaja en un `text[]` de Postgres y en la lista separada por comas que dividen las políticas RLS, por lo que `"support,admin"` se leería como `admin`. `details.problems` enumera cada uno. | Cambia el nombre del rol. Cualquier otro nombre es aceptado. |
| `KEY_MANAGEMENT_SCOPE` | 400 | Se solicitaron los scopes `keys:read` o `keys:write` para una clave. Ninguna clave puede administrar claves. `details.scopes` los enumera. | Omítelos. |
| `KEY_OUTRANKS_CALLER` | 403 | Un poseedor de `keys:write` intentó modificar o revocar una clave de servicio que posee un rol o scope que este no tiene. Solo un administrador gestiona cualquier clave. `details.roles` y `details.scopes` indican lo que la clave tiene por encima del llamador. | Haz que un administrador o alguien que los posea modifique la clave. |
| `LAST_ADMIN` | 403 | El cambio dejaría al proyecto sin administradores. | Promueve a otra persona primero. |
| `MFA_REQUIRED` | 401 | La contraseña era correcta y la cuenta tiene un segundo factor verificado, por lo que el inicio de sesión está incompleto. `details` contiene un token de corta duración restringido al desafío MFA — no es una sesión. | Abre un desafío y respóndelo; la respuesta al desafío emitirá la sesión. |
| `NO_SESSION` | 401 | No se presentó ninguna cookie de sesión ni token de actualización. Comportamiento normal en la primera carga de una página. | Inicia sesión. |
| `NOT_ANONYMOUS` | 400 | Una ruta para pasar de anónimo a registrado fue llamada por una cuenta real, o `DELETE /api/admin/guests/:uid` especificó una cuenta real. | Nada que actualizar. Para eliminar una cuenta, usa `DELETE /api/admin/users/:uid`. |
| `OAUTH_ERROR` | 401 | El proveedor de OAuth rechazó la solicitud o devolvió un error. | Reintenta el flujo; el mensaje contiene el motivo del proveedor. |
| `PERSONAL_KEYS_DISABLED` | 403 | Las claves de API personales están desactivadas en este backend. | Establece `personalKeys: true` en el bloque `auth` de la colección de usuarios. |
| `PERSONAL_KEY_NEEDS_ACCOUNT` | 403 | La clave de servicio o una sesión de invitado intentó utilizar las rutas de claves personales. Ninguna de las dos tiene una cuenta sobre la cual la clave pueda actuar. | Inicia sesión en una cuenta o crea una clave de servicio en `/api/admin/api-keys`. |
| `PLATFORM_TOKENS_OFF` | 401 | Un token de plataforma `rpt_` llegó a un servidor que no los acepta: `REBASE_PLATFORM_TOKEN_KEY` y `REBASE_PLATFORM_TOKEN_AUDIENCE` no están configuradas. | La plataforma que aloja la aplicación define ambas al desplegar; vuelve a desplegar o inicia sesión en la aplicación de otra manera. |
| `RATE_LIMITED` | 429 | Demasiados intentos de este llamador. | Reduce la frecuencia; el mensaje indica por cuánto tiempo. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | El destino de redirección no está en la lista de permitidos. | Agrégalo a la configuración del proveedor. |
| `REGISTRATION_DISABLED` | 403 | El registro de autoservicio está desactivado. | Haz que un administrador cree la cuenta. |
| `ROLE_EXCEEDS_CALLER` | 403 | Los roles que se están otorgando poseen un scope, o `admin`, que el llamador no tiene. `details.beyond` los enumera. | Haz que alguien que los posea otorgue el rol. |
| `ROLE_EXCEEDS_CREATOR` | 403 | Se le asignó a una clave de servicio un rol de RLS que su creador no tiene. Solo un administrador puede otorgar cualquier rol. `details.roles` los enumera. | Elimina el rol o haz que un administrador cree la clave. |
| `ROLE_EXISTS` | 409 | Ese nombre de rol ya está en uso. | Elige otro nombre. |
| `ROLE_LOOKUP_FAILED` | 503 | No se pudieron leer los roles del llamador — en una ruta de administración o en una solicitud de datos en un backend con `config.auth`. Falla de forma cerrada (fail closed) en lugar de confiar en los roles del token. Un token cuyo uid no corresponde a ninguna cuenta, incluido un uid que la tabla de usuarios no puede albergar, es un 401, no esto. Una base de datos inalcanzable es `DATABASE_UNAVAILABLE`, no esto. | Reintenta; comprueba la base de datos. |
| `SCOPE_EXCEEDS_CREATOR` | 403 | Se solicitó para una clave un scope que su creador no posee. Una clave nunca posee más privilegios que la cuenta que la crea. `details.scopes` los enumera. | Elimínalos o haz que alguien que los posea cree la clave. |
| `SCOPE_MISSING` | 403 | La credencial no posee el scope que requiere esta ruta, colección, fuente de almacenamiento o función. `details.requiredScope` lo especifica, incluyendo el destino. | Para una persona, un rol que declare el scope. Para una clave, una clave que lo posea. Consulta [Roles and scopes](/docs/backend/roles-and-scopes/). |
| `SCOPE_NOT_DECLARED` | 500 | Una ruta protegida con `requireScope` hace referencia a un scope de aplicación que este backend no declara, por lo que nadie lo tiene, ni siquiera un administrador. Un nombre que no es un scope en absoluto, o uno integrado mal escrito como `data:raed`, nunca llega tan lejos: `requireScope` lanza un error en el momento en que se registra la ruta. | Declara el scope bajo `auth.scopes` en la colección de usuarios, o corrige el nombre. Consulta [Roles and scopes](/docs/backend/roles-and-scopes/). |
| `SELF_DELETE` | 400 | Un administrador intentó eliminar su propia cuenta. | Pide a otro administrador que lo haga. |
| `SESSION_REVOKED` | 401 | La sesión se cerró en otro lugar, o se revocaron todas las sesiones, o la cuenta fue eliminada. Cada punto de entrada que acepta una sesión responderá con este error ante tal token de acceso: la API de datos, el almacenamiento, las funciones personalizadas y las rutas de administración. El socket de tiempo real rechaza su `AUTHENTICATE` con una trama `AUTH_ERROR` que lleva el mismo código. El SDK intenta refrescar, la renovación se rechaza y se cierra la sesión. | Inicia sesión de nuevo. |
| `ACCOUNT_DISABLED` | 401/403 | Un administrador desactivó la cuenta: el inicio de sesión (403), la renovación y cada token que posee (401) son rechazados en cada punto de entrada que requiera una sesión. El socket de tiempo real rechaza su `AUTHENTICATE` con una trama `AUTH_ERROR` que lleva el mismo código. | Contacta a un administrador. |
| `EMAIL_NOT_CONFIRMED` | 403 | `requireEmailVerification` está activado y la dirección aún no se ha verificado. Solo se responde cuando la contraseña es correcta; se envía un nuevo enlace por correo. | Sigue el enlace en el correo. |
| `PROOF_REQUIRED` | 409 | `POST /auth/verify-email`: la cuenta contiene una contraseña o identidad que nadie ha demostrado, y la solicitud no demuestra ninguna de las dos. El token no se consume. | Envía `password` para conservarla, o `removeUnproven: true` para verificar sin ella. |
| `UNDELIVERABLE_ADDRESS` | 400 / 409 | Se solicitó un correo de verificación para una dirección a la que no se puede entregar correo —la de un invitado o el marcador de posición de X (400)— o una cuenta solicitó cambiar a dicha dirección (409, `POST /auth/change-email`). | Configura una dirección real primero. |
| `EMAIL_UNCHANGED` | 400 | `POST /auth/change-email` indicó la dirección actual de la cuenta. | Nada que cambiar. |
| `ANONYMOUS_USER` | 403 | Un invitado solicitó cambiar su dirección de correo electrónico; un invitado no tiene ninguna. | Conviértelo en una cuenta primero (`POST /auth/anonymous/link`). |
| `MFA_NOT_ENROLLED` | 400 | Se solicitaron códigos de recuperación para una cuenta sin un segundo factor verificado. | Registra un factor primero. |
| `HOOK_REJECTED` | 400 | Un hook `beforeUserCreate`, `beforeLogin`, `beforeUserDelete` o `beforeEmailChange` lanzó una excepción. El mensaje es el del propio hook; si el hook eligió un estado 4xx, responde con él. | Consulta el mensaje. |
| `INVALID_JSON` | 400 | El cuerpo de la solicitud no es JSON. | Envía un cuerpo en formato JSON. |
| `SELF_DISABLE` | 400 | Un administrador intentó desactivar su propia cuenta. | Pide a otro administrador que lo haga. |
| `NOT_SUPPORTED` | 501 | El repositorio de autenticación de este backend no puede realizar la acción solicitada (desactivar cuentas, cambiar una dirección). | Reinicia el servidor para que se agregue la columna, o usa un repositorio que lo admita. |
| `UNKNOWN_SCOPE_TARGET` | 400 | El destino de un scope nombra una colección, fuente de almacenamiento o función que este backend no proporciona. `details` enumera las que sí proporciona. | Corrige el destino. |
| `UNVERIFIED_IDENTITIES` | 409 | Un enlace mágico, código por correo o restablecimiento de contraseña comprobó la dirección de una cuenta no verificada, y la cuenta posee una identidad de inicio de sesión cuyo proveedor nunca verificó dicha dirección. El repositorio de autenticación no puede eliminarla (no tiene `unlinkUserIdentity`), por lo que la comprobación se rechaza en lugar de dejar esa vía de acceso abierta en una cuenta verificada. | Implementa `unlinkUserIdentity` en el repositorio de autenticación personalizado, o haz que un administrador revise la cuenta. |
| `SETUP_REQUIRED` | 403 | El proyecto aún no tiene administrador, por lo que esta ruta no está disponible. | Completa la configuración del primer administrador. |
| `TOKEN_ALREADY_USED` | 401 | Se reutilizó un token de un solo uso, o un token de actualización que ya se había rotado hace más de `refreshTokenReuseIntervalSeconds`. | Solicita uno nuevo o inicia sesión otra vez. |
| `TOKEN_EXPIRED` | 401 | El token ha superado su tiempo de vida útil. | Solicita uno nuevo. |
| `USER_NOT_FOUND` | 404 | No existe ninguna cuenta con ese id. | Comprueba el id. |
| `WEAK_PASSWORD` | 400 | La contraseña no cumple con la [política de contraseñas](/docs/backend/auth-endpoints/#password-policy) (por defecto más de 8 caracteres con una mayúscula, una minúscula y un dígito) — al registrarse, restablecer o cambiar la clave, y en la contraseña elegida por un administrador: `POST /api/admin/users`, una creación en la colección de usuarios a través de la API de datos, `PUT /api/admin/users/:id` o `POST /api/admin/users/:id/reset-password`. | Elige una contraseña más segura. Un administrador que importe cuentas puede enviar `skipPasswordPolicy: true` en la creación. |

## Datos, consultas y escrituras

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `AGGREGATE_MASKED_BY_AFTER_READ` | 400 | Una agregación distinta de `count()` sin `groupBy` en una colección que un callback `afterRead` reescribe (global, colección o propiedad). Una agregación lee los valores almacenados y nunca ejecuta el callback, por lo que una suma, mínimo, máximo, conteo de campos o grupo leería lo que el callback oculta. | Usa `count()` sin `groupBy`, o lee las filas, las cuales sí pasan a través del callback. |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Este controlador no puede calcular la agregación solicitada. | Usa un controlador que pueda o calcúlala en el cliente. |
| `BRANCHING_UNSUPPORTED` | — | Se solicitó una rama de base de datos a través del websocket de Studio en la base de datos de desarrollo administrada (PGlite), donde una rama *es* la principal y nada quedaría aislado. El rechazo es el mismo que imprime `rebase db branch`. | Apunta `DATABASE_URL` a una instancia propia de Postgres (`rebase dev --docker` inicia una) y ramifica allí. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` incluye más operaciones que el límite por lote (1000 por defecto). Un lote equivale a una transacción y retiene sus bloqueos durante toda su ejecución. | Envíalo en fragmentos; el mensaje indica el límite y tu recuento. |
| `BATCH_UNSUPPORTED` | 400 | El controlador de este backend no puede escribir en múltiples colecciones de manera atómica, y un bucle de escrituras individuales no sería atómico ni se realizaría en un solo viaje de ida y vuelta. | Envía las escrituras como solicitudes separadas, o como llamadas `/bulk` por colección. |
| `BULK_TOO_LARGE` | 400 | El cuerpo masivo supera el límite de elementos configurado. | Divide la solicitud. |
| `BULK_UNSUPPORTED` | 400 | Esta colección o controlador no admite escrituras masivas. | Escribe las filas una por una. |
| `CALLBACK_REJECTED` | 400 / 403 | Un callback de la colección rechazó la escritura. Un `throw` desde `beforeSave`/`beforeDelete`/`after*` es un 400 que incluye el mensaje definido por el autor; un `beforeDelete` que devuelve `false` es un 403. `details.stage` indica cuál callback fue y `details.path` la colección. | Lee el mensaje — fue escrito por este proyecto, no por Rebase. |
| `CALLBACK_RECURSION` | 500 | Escrituras iniciadas por hooks anidados a más de 16 niveles de profundidad: una escritura `context.data` de un hook vuelve a ejecutar los hooks de esa colección y nada en la cadena lo detiene —habitualmente un `afterSave` que actualiza su propia fila incondicionalmente. Se revirtió toda la escritura. El mensaje nombra el hook y la colección; `details.chain` enumera cada paso hook → escritura. | Haz que la escritura del hook sea condicional: actúa solo cuando `status === "new"`, o sáltala si `values` ya contienen lo que escribiría. |
| `COLLECTION_READ_ONLY` | 405 | Una escritura llegó a una colección que expone una vista SQL (`view`). Una vista es de solo lectura. | Escribe en las tablas que lee la vista. Consulta [Vistas](/docs/collections/views/). |
| `SQL_NOT_ALLOWED` | 400 | El SQL ejecutado como el llamador (`getSql(c)`, `withAuth(user).sql`) no era una sentencia simple `SELECT`, `WITH`, `VALUES`, `TABLE`, `INSERT`, `UPDATE`, `DELETE` o `MERGE`, o invocó `set_config` o mencionó `pg_settings`. La identidad del llamador reside en la configuración de la sesión, por lo que se rechaza cualquier sentencia que pueda alterarla. | Mantén el texto de la consulta bajo tu control, en una sola sentencia, con cada valor en `params`. Consulta [Funciones personalizadas](/docs/backend/custom-functions/#3-getsqlc--sql-as-the-caller). |
| `CURSOR_WITH_OFFSET` | 400 | Se combinó `?after=` con `?offset=` o `?page=`. Un cursor ya indica dónde comienza la página, por lo que un desplazamiento adicional sobre él omite silenciosamente esa cantidad de filas después del cursor — una discrepancia que el llamador no puede percibir en la respuesta. | Usa uno o el otro. |
| `DISTINCT_NOT_APPLICABLE` | 400 | Se combinó `?distinct=true` con una consulta de búsqueda o vectorial. Ambas adjuntan una puntuación por fila, por lo que no hay dos filas iguales y `DISTINCT` no colapsaría nada — parecería haber funcionado pero no cambiaría nada. | Elimina uno de los dos. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Una lectura con `distinct` se ordena mediante una columna que no devuelve. Un `SELECT DISTINCT` solo puede ordenarse por columnas incluidas en su lista de selección, o de lo contrario las filas que colapsa carecen de un orden definido. `details.fields` las enumera. | Agrega esos campos a `?fields=`, o elimínalos de `?orderBy=`. |
| `DATABASE_UNAVAILABLE` | 503 | No se pudo conectar con la base de datos: la conexión fue rechazada o interrumpida, el host no se resolvió, el servidor se está apagando o iniciando, o la base de datos está cerrada a nuevas conexiones (`ALLOW_CONNECTIONS false`, estado en el que queda el origen si un `rebase db branch create --force` se interrumpe a la mitad; el log del servidor nombra la base de datos, y `rebase db branch list` la vuelve a abrir). Todos los accesos devuelven este error, incluidos el inicio de sesión, las rutas de administración y el socket de tiempo real (trama `ERROR`). Se envía con `Retry-After: 5`. | Reintenta; el SDK lo hace automáticamente. Comprueba que la base de datos esté funcionando y accesible desde el servidor. |
| `DB_CONNECTIONS_EXHAUSTED` | 503 | El servidor de base de datos rechazó una nueva conexión porque no le quedan disponibles (`53300` demasiados clientes, `53400` límite de conexiones de un rol o base de datos). Cada instancia del servidor comparte el `max_connections` del servidor de BD, por lo que este es el problema con el que se topan varias instancias con pools grandes sin un pooler intermedio. Es un problema de carga, no un fallo; enviado con `Retry-After: 2`. El servidor registra la solución una vez por minuto. | Reintenta; el SDK lo hace. Reduce `DB_POOL_MAX` (o límitalo con `REBASE_DB_POOL_MAX`) en todas las instancias, coloca un pooler delante de la base de datos (`DATABASE_POOLED`), o aumenta `max_connections`. |
| `DB_CONNECT_TIMEOUT` | 503 | Abrir una nueva conexión a la base de datos tomó más tiempo que `DB_POOL_CONNECT_TIMEOUT`: la base de datos tarda en aceptar conexiones o está muy distante. Se envía con `Retry-After`. | Reintenta; el SDK lo hace. Comprueba la carga de la base de datos y la red hacia ella. |
| `DB_PERMISSION_DENIED` | 500 | Postgres rechazó la sentencia (`42501`): bien una política de seguridad a nivel de fila denegando este rol, o la falta de un `GRANT`. | Consulta [Solución de problemas](/docs/troubleshooting/). |
| `DB_POOL_EXHAUSTED` | 503 | Todas las conexiones del pool de base de datos permanecieron ocupadas durante `DB_POOL_CONNECT_TIMEOUT`, por lo que esta solicitud nunca llegó a la base de datos. Es un problema de carga, no un fallo; se envía con `Retry-After`. El servidor registra la solución una vez por minuto. | Reintenta; el SDK lo hace. Aumenta `DB_POOL_MAX` o localiza las consultas lentas o transacciones largas que retienen conexiones. |
| `FIELD_NOT_READABLE` | 400 | Un filtro, `orderBy`, `fields`, agregación `select` o `groupBy` nombra un campo que los roles de este llamador no pueden leer (`access.read`), una ruta anidada o una ordenación agregada nombra una relación que no pueden leer — o una operación de campo (`$inc`, `$push`, …) apunta a uno, donde un límite rechazado revelaría el valor almacenado. Un campo que ninguna respuesta puede transportar debe ser un campo que ninguna consulta pueda interrogar, o de lo contrario el valor podría leerse predicado a predicado. Un filtro a través de una relación (`author.salary`) y una ordenación agregada sobre el campo de una relación (`max(staff.salary)`) se evalúan según la regla de destino. `details.violations` enumera cada campo. Un campo oculto con `excludeFromApi` responde como si no existiera: un filtro, `orderBy`, `fields`, `include`, agregación `select` o `groupBy`, o `vector_search` que lo mencione recibe exactamente la respuesta que recibiría un nombre mal escrito (`UNKNOWN_FILTER_FIELD`, `UNKNOWN_ORDER_BY_FIELD`, `UNKNOWN_FIELD`, `UNKNOWN_RELATION`, `UNKNOWN_AGGREGATE_FIELD` o `UNKNOWN_VECTOR_PROPERTY`), y ninguna respuesta de campo desconocido lo listará. | Elimina el campo de la consulta o adquiere el rol correspondiente. Consulta [Acceso a campos](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 | El cuerpo asigna un campo que los roles de este llamador no pueden escribir (`access.write`). Se rechaza en lugar de ignorarse: una escritura que descarte un campo reportaría éxito para una modificación que en realidad no ocurrió. El mismo código rechaza una escritura a través de un padre que asigna una relación que el llamador no puede escribir, y una actualización que asigna un valor a un campo `softDelete` — solo una eliminación lo marca. `details.violations` enumera cada campo. | Elimina el campo o adquiere el rol. Un campo que nadie puede escribir responde en su lugar `VALIDATION_EXCLUDED_FIELDS`. |
| `FILTERED_USER_WRITE` | 400 | Se envió una actualización o eliminación con filtro a la colección de usuarios por HTTP, cuyas escrituras se comprueban usuario por usuario antes de ejecutarse. | Lee los usuarios y luego usa `updateMany`/`deleteMany` sobre ellos por id. |
| `FILTER_REQUIRED` | 400 | Una escritura filtrada (una actualización o eliminación mediante `where`/`logical`, desde el SDK o las rutas bulk) no incluye condiciones, por lo que afectaría a todas las filas. Se rechaza antes de ejecutar nada. | Agrega una condición. Si la intención es modificar todas las filas expresamente, indícalo con una condición que cumplan todas las filas. |
| `HISTORY_UNAVAILABLE` | 503 | Se rechazó una escritura en una colección con `history: true` porque no se pudo registrar su entrada de historial: la base de datos no tiene la tabla `rebase.entity_history` o, para `openRebase` y `rebase console`, falta la función `rebase.record_history`. Ningún backend con historial ha arrancado sobre esta base de datos. No se ejecutó nada, callbacks incluidos, y las lecturas no se ven afectadas. Lanzado por `openRebase`, y devuelto por un backend creado con `provision: false`. | Arranca el backend una vez con el historial activado y `provision: true` (`rebase dev` lo hace), luego reintenta. |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Una solicitud anterior con la misma cabecera `Idempotency-Key` todavía se está ejecutando. | Reintenta una vez que termine. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | Se recibió la misma `Idempotency-Key` en una solicitud diferente: otro método, ruta, cadena de consulta o cuerpo. | Usa una clave nueva o envía la solicitud original. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` especificó una función que no es de agregación (`count`, `sum`, `avg`, `min`, `max`, `countDistinct`, `mode`, `percentile`, `distinct`, `fingerprint`). | Usa una de ellas; el mensaje las enumera. |
| `INVALID_AGGREGATE_GROUP` | 400 | Una transformación de `groupBy` es desconocida o no se aplica a su columna: `year`/`month`/`day` en una columna que no es fecha, `unnest` en una que no es array. | Usa `lower`, `upper`, `year`, `month`, `day` o `unnest`, en una columna del tipo adecuado. |
| `INVALID_AGGREGATE_SELECT` | 400 | Una entrada de `?select=` no tiene el formato `fn(field)`; se invocó una función distinta de `count()` o `fingerprint()` sin proporcionar ningún campo; `percentile` no tiene una fracción entre 0 y 1; o se solicitó `fingerprint()` sobre una vista plana, que no almacena filas. | Escribe `sum(total)`, `count()`, `percentile(price,0.95)`. |
| `INVALID_AGGREGATE_WINDOW` | 400 | Se usó `offset`, `page` o `orderBy` en una agregación sin `groupBy`, o un cursor en cualquier agregación. Una agregación no agrupada es una sola fila, y un grupo no es una fila a partir de la cual un cursor pueda continuar. | Agrega `groupBy` o elimínalos; pagina grupos con `offset` o `page`. Consulta [Agregaciones](/docs/sdk/aggregates-and-search/#aggregates). |
| `INVALID_BATCH_BODY` | 400 | Una operación de `/_batch` no incluye `op`, `collection`, `values` o `id`, nombra una colección que este backend no proporciona o reutiliza un nombre de `ref`. | Consulta el mensaje; indica la operación por índice. |
| `INVALID_BATCH_REF` | 400 | Un `{ "$ref": "<name>.<field>" }` no coincide con ninguna operación anterior, apunta hacia adelante o solicita un campo que la fila referenciada no posee. Solo se resuelven referencias hacia atrás. | Asigna el nombre a la operación con `ref` *antes* de referenciarla. |
| `INVALID_BULK_BODY` | 400 | El cuerpo masivo no tiene la estructura esperada. | Envía el array que espera la ruta: `{ "rows": [...] }` para `POST /bulk`, `{ "updates": [{ "id", "data" }] }` para `PATCH /bulk`, `{ "ids": [...] }` para `POST /bulk/delete`. |
| `INVALID_CONFLICT_RULE` | 400 | La regla de conflicto de un upsert (mantener duplicados o reemplazar solo ante un `where`) se envió sin `upsert: true`, o se enviaron ambas reglas al mismo tiempo. | Envía `upsert: true` y solo una de las dos. |
| `INVALID_CONFLICT_TARGET` | 400 | El `on_conflict` / `onConflict` de un upsert nombra columnas que no garantizan unicidad, las nombra sin `upsert: true`, o se envía en una creación anidada, donde una fila coincidente se movería bajo el nuevo padre. Postgres respondería de otro modo 42P10 desde el interior de una transacción que ya ha realizado operaciones. También ocurre en cualquier upsert en la colección de usuarios (auth), donde la creación y la actualización siguen reglas diferentes. | Declara `validation: { unique: true }` o un índice `unique`; el mensaje enumera los destinos existentes. En la colección de usuarios, envía un `POST` para crear y un `PATCH` para actualizar. |
| `INVALID_COUNT` | 400 | `?count=` no es `exact` ni `none`. Se rechaza en lugar de interpretarse como el valor predeterminado: un error tipográfico como `?count=nnone` pagaría el costo del recuento que se quería omitir. | Envía `exact` (el predeterminado) o `none`. Consulta [Omitir el recuento](/docs/backend/api/#skipping-the-count). |
| `INVALID_CURSOR` | 400 | El cursor `after` no se puede leer o especifica un id de fila que no coincide con las columnas clave de la colección: fue truncado, recodificado o generado a mano. Un cursor legible enviado con un `orderBy` distinto de aquel con el que se emitió genera `CURSOR_ORDER_MISMATCH`, también un 400. | Devuelve `meta.nextCursor` de la página anterior sin modificar, con el mismo `orderBy` o ninguno. Consulta [Paginación](/docs/sdk/pagination/). |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` no es `include` ni `only`. Se rechaza en lugar de ignorarse: un error tipográfico como `?deleted=true` que ocultara silenciosamente todas las filas eliminadas parecería funcionar pero respondería lo contrario a lo esperado. | Envía `include` (activas y eliminadas) u `only` (únicamente eliminadas). Omítelo para recibir solo filas activas. |
| `INVALID_DISTINCT` | 400 | `?distinct=` no es `true` ni `false`. | Envía uno de ellos; también se aceptan `1` y `0`. |
| `INVALID_FIELD_OPERATION` | 400 | Se utilizó un `$inc` / `$push` / `$pull` / `$merge` en un tipo de propiedad en el que no está definido, con un operando de estructura incorrecta, con dos operadores en un mismo campo, mal escrito o en una creación — donde no existe un valor previo almacenado sobre el cual operar. | Consulta [Escritura a través de REST](/docs/backend/writes/#field-operations); el mensaje nombra el campo. |
| `INVALID_FILTERED_WRITE` | 400 | Una escritura filtrada apuntó a una ruta a través de una relación (`posts/1/comments`) o a ninguna colección. | Escribe en la colección relacionada aplicando un filtro sobre su vínculo. |
| `INVALID_FILTER_FIELD` | 400 | El filtro nombra una propiedad que esta colección no tiene. | Comprueba el nombre con la definición de la colección. |
| `INVALID_FILTER_OPERATOR` | 400 | El operador no es admitido por este tipo de propiedad — por ejemplo, `like` en un número o fecha. | Consulta [Consultar datos](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | No se puede interpretar un valor de filtro según el tipo de la columna contra la cual se compara: `?id=eq.abc` en una clave entera, una etiqueta que no está en el enum, una marca de tiempo inválida, un número fuera de rango. `details.dbCode` contiene el SQLSTATE. | Envía un valor del tipo correspondiente a la columna. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` no es `true` ni `false`. Cualquier otro valor se rechaza en lugar de interpretarse como "no" — un error tipográfico que realice un borrado lógico cuando el llamador solicitó purgar le haría creer erróneamente que los datos fueron destruidos. | Envía `true` o `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` está malformado: no es una lista de rutas válida, o contiene un objeto de opciones por relación con estructura incorrecta. Una ruta anidada a más de tres saltos genera `INCLUDE_TOO_DEEP`, también un 400. Se responde en el límite de la API en lugar de escapar del controlador como un 500. | Consulta el mensaje; nombra la ruta infractora. |
| `INVALID_INPUT` | 400 | El cuerpo no superó la validación. | Consulta el mensaje. |
| `INVALID_LIMIT` | 400 | `?limit=` no es un número entero entre 1 y el máximo (1000 por defecto); uno superior se rechaza, no se trunca. Una suscripción en tiempo real que solicite un límite fuera de ese rango recibe este mismo código como una trama `ERROR` de WebSocket. | Reduce el límite y pagina los resultados restantes. |
| `INVALID_LOGICAL_GROUP` | 400 | Un grupo `?or=` / `?and=` / `?not=` está malformado o anidado más allá de la profundidad permitida. | Consulta el mensaje; muestra la regla de aplanamiento. |
| `INVALID_OFFSET` | 400 | `?offset=` no es un número entero mayor o igual a 0. | Envía un entero no negativo. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` no tiene el formato `field`, `field:desc`, `field:desc:last`, ni es un array JSON de `{ field, direction, nulls }` — o especifica una dirección distinta de `asc`/`desc`, o una posición de NULL distinta de `first`/`last`. | Consulta el mensaje; muestra todas las sintaxis válidas. |
| `INVALID_PAGE` | 400 | `?page=` no es un número entero mayor o igual a 1. Las páginas se basan en índice 1, por lo que `?page=0` es un error y no la primera página. | Envía `1` o más, o usa `?offset=`. |
| `INVALID_PARAM` | 400 | Un parámetro de consulta está malformado. | Consulta el mensaje. |
| `INVALID_QUERY_BODY` | 400 | El cuerpo de un `POST …/query` contiene un valor que la URL no habría podido transportar: una lista para un parámetro que la URL lee una sola vez (`fields`, `limit`, …), un objeto para un filtro, o cualquier parámetro duplicado también en la URL — un `POST …/query` lee todos los parámetros desde el cuerpo. | Escribe cada valor como lo hace la URL — una cadena o una lista para un filtro repetido; `where`, `include`, `orderBy` y `vector` aceptan JSON. Consulta [Consultas demasiado largas para una URL](/docs/backend/vector-search/#queries-too-long-for-a-url). |
| `INVALID_VECTOR` | 400 | `?vector=` no es un array JSON de números. | Envía `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` no es `cosine`, `l2` ni `inner_product`. | Usa una de esas tres opciones. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` no es un número. | Envía un número. |
| `INVALID_WHERE` | 400 | `?where=` no es un objeto JSON que asigne campos a condiciones. | Envía `{"status":["==","active"]}`. |
| `KEY_IMMUTABLE` | 400 | Una actualización define la clave de la fila con un valor distinto de aquel por el cual está direccionada — en el cuerpo, o escrito por un `beforeSave`. Una fila no puede trasladarse a otra clave: todo lo que ocurre después de la escritura (la relectura, `afterSave`, historial, tiempo real) la referencia mediante la clave que ya tenía. Se rechaza antes de ejecutar ningún hook, sin escribir nada, en todas las vías de acceso. `details.violations` nombra el campo. | Crea la fila bajo la nueva clave y elimina la actual. Enviar la clave que la fila ya tiene está permitido. |
| `MISSING_AGGREGATE_SELECT` | 400 | La ruta de agregación fue invocada sin `?select=`. | Agrega uno, ej. `?select=count()`. |
| `NOT_A_MATERIALIZED_VIEW` | 400 | Se llamó a `refresh()` sobre una colección que no expone una vista materializada. | Actualiza únicamente colecciones con `view: { materialized: true }`. |
| `NO_COLLECTIONS` | 404 | El proyecto no sirve colecciones: no hay ninguna declarada en código ni tablas de las cuales derivarlas. Cuando existen tablas pero la seguridad a nivel de fila está desactivada en ellas, el mensaje las nombra con el SQL necesario para activarla, y `details.unprotectedTables` las lista. | Crea tablas —mediante una migración, SQL o un archivo de colección junto con `rebase db push`— y reinicia. |
| `NOT_FOUND` | 404 | No existe ninguna fila con ese id en esa colección — o es una fila que la seguridad a nivel de fila oculta a este llamador. | Comprueba el id y luego las `securityRules` de la colección. |
| `UNKNOWN_RELATION` | 400 / 404 | `?include=` nombra algo que no es una relación en la colección. El mismo código responde **404** cuando es una *ruta de URL* anidada la que lo nombra, ej. `/api/data/authors/1/posts` donde `authors` no declara ninguna — en ese caso la URL no apunta a nada, por lo que es un recurso no encontrado y no una solicitud malformada. | Comprueba el nombre de la relación — el mensaje lista las que posee la colección. Una referencia inversa debe declararse en el padre para ser navegable. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | La ordenación especifica una propiedad que no es ordenable. | Ordena por una propiedad respaldada por una columna. |
| `PAGE_WITH_OFFSET` | 400 | Se combinó `?page=` con `?offset=` — o `page` con `offset` en un `find()`, lo cual el SDK del cliente, `rebase.data` en proceso y el cliente offline rechazan con el mismo código antes de emitir cualquier solicitud. Describen la misma ventana, y antiguamente `page` prevalecía silenciosamente sobre un `offset` que el llamador nunca veía aplicado. | Envía solo uno de ellos. |
| `PAYLOAD_TOO_LARGE` | 413 | El cuerpo supera el límite configurado. | Envía menos datos o aumenta el límite. |
| `READ_ONLY_TRANSACTION` | 409 | Un callback `afterRead` intentó escribir. Una lectura con ámbito de solicitud se ejecuta en una transacción `READ ONLY`, por lo que ni el callback ni nada de lo que invoque puede realizar escrituras. | Mueve la escritura fuera de la lectura: un trabajo en segundo plano, o `rebase.dataAsAdmin` desde una tarea cron o una función personalizada. |
| `REFRESH_NOT_SUPPORTED` | 501 | `POST /api/data/<slug>/refresh` llegó a un controlador de datos sin vistas materializadas. | Nada que actualizar en este backend. |
| `RELATION_HAS_NO_PIVOT` | 400 | La escritura contenía una carga de vínculo, pero la ruta no llega a su destino a través de un `manyToMany` que declare `through.properties` — por lo que no existe una fila de unión donde almacenarla. | Declara `through.properties` en la relación o elimina la carga de la escritura. Consulta [Relaciones](/docs/collections/relations/). |
| `RELATION_MISCONFIGURED` | 500 | Una relación no se resuelve contra el esquema registrado. La operación se rechaza en lugar de ignorarse: descartarla reportaría éxito para una escritura que nunca ocurrió, o un resultado vacío para filas que sí existen. | Ejecuta `rebase schema generate` si el esquema generado es anterior a la base de datos. |
| `RELATION_NOT_UNLINKABLE` | 400 | La relación no se puede desvincular desde este lado. | Escribe desde el lado propietario. |
| `RELATION_NOT_WRITABLE` | 400 | La ruta anidada no es una relación modificable, o una creación/actualización especifica una relación `via` de múltiples saltos — solo las relaciones `via` de un solo salto son modificables. `details.fields` enumera las claves `via`. No se escribió nada. | Escribe directamente las filas que une la cadena. Consulta [Relaciones](/docs/collections/relations/#via--an-explicit-join-chain). |
| `RELATION_PIVOT_UNSUPPORTED` | 400 | La relación declara columnas de unión, pero este origen de datos no admite escribir en ellas. | El vínculo en sí sigue funcionando; únicamente la carga de datos asociada a él no. Consulta las capacidades del controlador. |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Una escritura de relación no tenía una clave de origen a la cual asociar el vínculo. | Guarda primero la fila padre. |
| `RESULT_TOO_LARGE` | — | Una sentencia enviada a través del `EXECUTE_SQL` del socket de tiempo real —`admin.executeSql` desde un cliente, las lecturas de catálogo del panel de administración— devolvió más de 128 MB de filas, por lo que no se envió nada. Se entrega como una trama `ERROR` de WebSocket. Las ejecuciones de la consola SQL no se rechazan: muestran las primeras filas. | Agrega un `LIMIT` o selecciona menos columnas, y lee el resultado en partes. |
| `ROW_IN_TRASH` | 409 | La clave de un upsert pertenece a una fila en la papelera (una fila borrada lógicamente aún retiene su clave). Un upsert no escribe en una fila eliminada, en ninguna vía: `?on_conflict=` de REST, upserts en `/bulk` y `/_batch`, el SDK y el socket de tiempo real. No se escribió nada. | Restaura la fila primero (una actualización asignando `null` al campo de borrado lógico), o purga con `?hard=true` y vuelve a ejecutar el upsert. Consulta [Borrado lógico](/docs/collections/soft-delete/). |
| `SCHEMA_DRIFT` | 500 | Una tabla o columna esperada por el código no existe en la base de datos. | Ejecuta `rebase db push` en desarrollo; vuelve a desplegar en un entorno administrado. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | Se combinó `startAfter` con `orderBy: "_score"`. La relevancia se calcula por consulta en lugar de almacenarse, por lo que no puede actuar como clave de cursor. | Pagina la relevancia con `limit`/`offset`, u ordena por una columna. |
| `SQL_ERROR` | 400 | La base de datos rechazó el SQL escrito por un usuario. En el `EXECUTE_SQL` del socket de tiempo real es una trama `ERROR` que incluye el mensaje de la base de datos. `POST /api/admin/sql/csv` lo responde antes de comenzar a enviar el archivo: un error de sintaxis, una escritura (la descarga se ejecuta en modo de solo lectura), más de una sentencia o un rol que la conexión no puede asumir. | Corrige el SQL. Una descarga requiere una única sentencia `SELECT`, `WITH … SELECT`, `TABLE` o `VALUES`. |
| `VIEW_NOT_READABLE` | 403 | Un llamador que no posee ninguno de los `view.roles` de una vista materializada intentó leerla o solicitó actualizarla. Una vista materializada carece de seguridad a nivel de fila, por lo que se entrega completa y exclusivamente a esos roles. | Léela con uno de los roles permitidos o declara el rol del llamador en `view.roles`. |
| `TENANT_IMMUTABLE` | 400 | Una escritura trasladaría una fila de un inquilino (tenant) a otro. Una fila no puede cambiar de inquilino. `details.violations` nombra el campo. Un trigger mantiene esta misma regla en la base de datos, por lo que el SQL ejecutado como el llamador falla con el error de Postgres `42501` y un mensaje que comienza con `TENANT_IMMUTABLE`. | Crea la fila en el otro inquilino y elimina esta, o escribe con un rol incluido en `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | La escritura especifica un inquilino al que este llamador no pertenece; la base de datos la rechazaría igualmente. | Escribe en un inquilino al que pertenezca el llamador, o autentícate como uno que pertenezca a él. |
| `TENANT_REQUIRED` | 400 | La colección tiene ámbito de inquilino y este no puede inferirse: la solicitud no incluye ninguno o el llamador pertenece a varios. | Envía el campo de inquilino explícitamente, o autentícate como un llamador que pertenezca exactamente a uno. |
| `TRANSACTION_ABORTED` | 500 | Una sentencia en la transacción de escritura falló y un callback capturó el error. Postgres ya había abortado la transacción, por lo que la escritura se revirtió y nada quedó almacenado. Solo una creación, actualización o eliminación con `context.data` rechazada por la base de datos se deshace por separado y es seguro capturarla. | Permite que el fallo lance la excepción, o valida antes de ejecutar la sentencia. Consulta [Semántica de transacciones](/docs/collections/context-data-api/#transaction-semantics). |
| `UNKNOWN_FIELD` | 400 | `?fields=` nombra un campo que la colección no tiene. | Comprueba la escritura; el mensaje lista los campos válidos. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Una agregación o `groupBy` nombra un campo que la colección no tiene. | Comprueba la escritura; el mensaje lista los campos válidos. |
| `UNKNOWN_FILTER_FIELD` | 400 | El filtro nombra un campo que esta colección —o el destino de una relación— no tiene, o uno oculto con `excludeFromApi`. | Comprueba la escritura; el mensaje lista los campos válidos. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | El filtro especifica un operador inexistente. | El mensaje enumera todos los operadores admitidos. |
| `UNKNOWN_MESSAGE_TYPE` | 400 | Una trama del socket de tiempo real tiene un `type` que el servidor no procesa. Se responde como una trama `ERROR` con el `requestId` de la solicitud, para que esta se resuelva en lugar de agotarse por tiempo de espera. | Comprueba el `type` de la trama; el mensaje lo indica. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | La ordenación nombra un campo que esta colección no tiene. | Comprueba la escritura; el mensaje lista los campos válidos. |
| `PRECONDITION_FAILED` | 412 | Un `If-Match` especificó una versión de la fila que ya no es la actual: alguien escribió en ella entre la lectura y esta escritura. No se escribió nada. | Vuelve a leer la fila, reaplica el cambio y envía el nuevo `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` solicita un campo que la colección no tiene. | Comprueba la escritura; el mensaje lista los campos conocidos. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Una búsqueda vectorial especificó una propiedad que no es de tipo `vector` en esta colección. | El mensaje enumera las propiedades vectoriales de la colección. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | El `Content-Type` no es admitido por esta ruta. | Envía el tipo documentado para la ruta. |
| `UNSUPPORTED_OPTION` | — | Se lanza como excepción, no como respuesta HTTP: una escritura a través del descriptor de acceso en proceso (`context.data` en un callback, `rebase.data` en una función o cron) recibió `ifMatch` o `idempotencyKey`. Esa vía no cuenta con comprobación de precondiciones ni almacén de idempotencia, por lo que la opción se rechaza antes de escribir nada en lugar de ignorarse. | Elimina la opción en ese punto o realiza la escritura mediante el cliente HTTP, que sí admite ambas. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | El filtro atraviesa una relación `via`, cuya ruta de unión está definida en una sola dirección, por lo que no existe forma de correlacionar una subconsulta de retorno. | Filtra desde el lado propietario. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | El operador no está definido para ese campo: una relación sin columna en esta fila se filtra por pertenencia, y la coincidencia de patrones (`like`, `ilike` y sus negaciones) solo se aplica a texto. | Consulta el mensaje; lista lo que admite el campo. |
| `VALIDATION_CONSTRAINT` | 400 | Un valor infringió una regla de `validation` declarada por la propiedad — longitud, rango, patrón, campo obligatorio. | Consulta el mensaje; nombra cada infracción. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | El cuerpo escribe en una columna marcada como `excludeFromApi`, o `access: { write: [] }` — la misma regla, dos sintaxis. Son campos de asignación exclusiva del servidor: un hash de contraseña, un token de verificación. A diferencia de `FIELD_NOT_WRITABLE`, esta respuesta es idéntica para cualquier llamador, `admin` incluido. | Elimina el campo. Consulta [Acceso a campos](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Un valor no coincide con su tipo de propiedad. | Consulta el mensaje; nombra la propiedad. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | El cuerpo nombra un campo que la colección no tiene — incluyendo un argumento `id` en una colección indexada por otra clave. | Comprueba la escritura; el mensaje lista los campos conocidos. |
| `VECTOR_CURSOR_UNSUPPORTED` | 400 | Se combinó un cursor (`after` / `startAfter`) con una búsqueda vectorial. Las filas se ordenan según una distancia calculada por consulta, la cual no puede actuar como clave de cursor, por lo que un listado vectorial no incluye `nextCursor`. | Pagina las filas más cercanas con `limit`/`offset`. |
| `WRITE_DENIED` | 403 | Una regla de seguridad o política de seguridad a nivel de fila rechazó la escritura. | Comprueba las `securityRules` de la colección. |

## `PG_<SQLSTATE>` — una restricción que la base de datos rechazó

Una escritura que Postgres rechaza por un motivo que radica en *los datos del llamador* responde
con el SQLSTATE en el código: `PG_23505`, `PG_23503`, etcétera. Se trata de
una familia, no de una lista —Postgres define cientos de SQLSTATEs—, pero solo dos
clases llegan a manifestarse aquí, ya que solo esas dos son culpa del llamador:

- **clase 23**, infracción de restricción de integridad (integrity constraint violation): un duplicado, una clave foránea que
  apunta a nada, una columna NOT NULL dejada vacía;
- **clase 22**, excepción de datos (data exception): un valor que el tipo de la columna no puede almacenar.

Todo lo demás —una conexión perdida, una columna inexistente, un problema de privilegios—
es responsabilidad del servidor y permanece como un `500`. Por tanto, `code.startsWith("PG_")` es una comprobación segura
para determinar que "la fila que envié era incorrecta", y las cuatro siguientes son las que un cliente
encontrará en la práctica. `details.dbCode` contiene el mismo SQLSTATE para todas ellas, y
el mensaje nombra la restricción.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | No se pudo leer un valor según el tipo de la columna — el equivalente en escritura de `INVALID_FILTER_VALUE`. | Envía un valor del tipo correspondiente a la columna. |
| `PG_23502` | 400 | Se dejó vacía una columna `NOT NULL`. | Envía el campo o asigna un valor por defecto a la columna. |
| `PG_23503` | 400 / 409 | Al guardar, una clave foránea apunta a una fila inexistente (400). Al eliminar, otras filas aún hacen referencia a esta (409; una clave `RESTRICT` genera `PG_23001`, también 409). | Crea la fila de destino primero o corrige el id; al eliminar, elimina o redirige primero las filas que la referencian. |
| `PG_23505` | 409 | Se violó una restricción de unicidad. El mensaje indica el nombre de la restricción. | Usa un valor diferente o actualiza la fila existente. |

## Almacenamiento

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `INVALID_LIST_OPTIONS` | 400 | El parámetro `maxResults` de un listado de almacenamiento no es un número entero mayor o igual a 1, o su `pageToken` no fue emitido por la fuente. Un tamaño de página inferior a uno solía devolver una página vacía con el mismo token, por lo que un bucle `while (pageToken)` nunca terminaba. | Envía un `maxResults` positivo y devuelve `nextPageToken` sin modificar. |
| `INVALID_STORAGE_BUCKET` | 400 | El nombre del bucket está malformado. | Revisa el nombre. |
| `INVALID_STORAGE_KEY` | 400 | La clave del objeto está malformada, escapa de su prefijo o se encuentra bajo un prefijo reservado (`_rebase/renditions/`, `_rebase/maintenance/`). | Comprueba la clave. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | Los parámetros de transformación de imagen están fuera de rango o son contradictorios. | Consulta [Almacenamiento](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | La subida excede el `maxSize` declarado por la propiedad de destino. Se valida en el servidor, no solo en el navegador. `details` contiene la propiedad, el límite y el tamaño real. | Sube un archivo más pequeño o aumenta `maxSize` en la propiedad. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | El tipo de archivo subido no está en el `acceptedFiles` de la propiedad, o no está en el `allowedMimeTypes` de la propia fuente de almacenamiento. `details` contiene la propiedad (o la lista de la fuente), la lista de aceptados y el content-type enviado. | Sube un tipo aceptado o amplía `acceptedFiles` / `allowedMimeTypes`. |
| `STORAGE_MISCONFIGURED` | 502 | El bucket de S3 o GCS configurado para esta fuente no existe, o el proveedor rechazó las credenciales de este despliegue para acceder a él. El mensaje indica el nombre del bucket; `details.reason` es `NoSuchBucket` o el rechazo del proveedor. Un bucket inexistente solía interpretarse como "archivo no encontrado" para cada archivo. | Corrige el nombre del bucket (`S3_BUCKET` / `GCS_BUCKET`, `__<KEY>` para una fuente con nombre) o los permisos de las credenciales. |
| `STORAGE_NOT_CONFIGURED` | 501 / 503 | No hay ningún backend de almacenamiento configurado en este servidor, o ninguno es el predeterminado y la solicitud no indica ninguna fuente; el mensaje nombra las fuentes que están disponibles (501). Una subida reanudable cuya fuente desapareció antes de completarse devuelve 503. | Configura S3, GCS o almacenamiento local, o especifica una fuente con `?storageId=`. |
| `STORAGE_SAME_LOCATION` | 400 | `POST /api/admin/storage/move` con `deleteSource` (`rebase storage move --delete-source`) entre dos fuentes que almacenan en el mismo bucket o directorio. Cada archivo contaría como ya presente en el destino, al tratarse del mismo archivo, y borrar la copia de la fuente eliminaría la única copia existente. No se movió ni eliminó nada. | Apunta la propiedad a la otra fuente; sus archivos ya están allí. |
| `STORAGE_SCAN_INCOMPLETE` | 409 | `DELETE /api/admin/storage/orphans` (`rebase storage orphans --delete`) no pudo leer todas las colecciones, por lo que un archivo mencionado en una de ellas parecería huérfano. Con `?scan=`, el escaneo indicado es el que no pudo leer todas las colecciones. No se eliminó nada; `details.unscanned` indica cada colección y el motivo por el cual no se pudo leer. | Soluciona lo que impide leer esas colecciones y ejecútalo de nuevo. |
| `STORAGE_SCAN_NOT_FOUND` | 404 | `GET /api/admin/storage/orphans/scans/:id` o `DELETE /api/admin/storage/orphans?scan=:id` especifica un escaneo que la fuente no contiene. Los escaneos se conservan durante 7 días en la fuente que escanearon, por lo que un `storageId` diferente al del escaneo tampoco encontrará ninguno. | Pasa el `storageId` del escaneo, o inicia otro escaneo. |
| `STORAGE_SCAN_NOT_COMPLETE` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` especifica un escaneo que todavía está en estado `queued` o `running`, o que ha fallado (`failed`). No se eliminó nada; `details.status` indica en qué estado se encuentra. | Espera a que el escaneo se complete o inicia otro. |
| `STORAGE_SCAN_EXPIRED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` especifica un escaneo que se completó hace más de 15 minutos. No se eliminó nada. | Inicia otro escaneo y elimina a partir de él. |
| `STORAGE_SCAN_DELETION_STARTED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` especifica un escaneo cuyos huérfanos ya se están eliminando. | Consulta el progreso en `deletion` del escaneo con `GET /api/admin/storage/orphans/scans/:id`. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | La fuente de almacenamiento está declarada pero no tiene credenciales configuradas aquí. | Define las variables de entorno de esa fuente. |
| `STORAGE_WRITE_FAILED` | 502 | El backend de almacenamiento rechazó o interrumpió la escritura. | Revisa sus propios registros (logs) y credenciales. |
| `TRANSFORM_OVERLOADED` | 503 | Hay demasiadas transformaciones de imagen en curso. | Reintenta; considera interponer una CDN. |
| `UNKNOWN_STORAGE_SOURCE` | 400 / 404 | La solicitud indicó una fuente de almacenamiento (`?storageId=`) que este proyecto no declara. Un `bucket` que este despliegue no sirve devuelve este mismo código con estado **404** (en un listado, y en una subida, una carpeta o una subida reanudable a S3 o GCS) — el almacén es lo que falta, y `details` indica los buckets y las fuentes que sí existen. Ambos solían devolverse como "archivo no encontrado", idéntico a una clave que simplemente no existe. | Declara la fuente en `config/resources.ts`, o consulta `GET /api/storage/sources`. |
| `UPLOAD_LOCKED` | 423 | El `PATCH` de una subida reanudable llegó mientras se recibía otro fragmento de la misma subida — casi siempre un cliente reintentando el fragmento en curso. Se rechaza en lugar de ponerse en cola, tal como hace tusd. | Solicita el desplazamiento con `HEAD /api/storage/tus/:id` y reanuda desde allí; tus-js-client espera y reintenta por su cuenta. Consulta [Subidas reanudables (TUS)](/docs/backend/storage-resumable-uploads/). |

## Funciones personalizadas

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | No se sirve ninguna función con ese nombre — o existe una, pero sus propias rutas no cubren la ruta posterior. A un llamador autenticado también se le informa qué *está* disponible; a uno anónimo no, porque esa lista constituye un inventario de cada endpoint personalizado. Cuando un archivo con ese nombre no pudo cargarse, el mensaje se lo indica a un llamador autenticado, mencionando el archivo: esa es la diferencia entre un error tipográfico y un despliegue roto. Un llamador anónimo recibe la respuesta simple de nombre desconocido, igual que para un nombre que no coincide con nada. | Comprueba el nombre en `GET /api/functions` o revisa el registro de arranque para detectar un archivo que no se haya cargado. |
| `FUNCTION_TIMEOUT` | 504 | El controlador excedió su tiempo de espera. Sigue ejecutándose; no se puede cancelar desde aquí. | Asigna un `AbortSignal` a las llamadas salientes o aumenta `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Este proceso redirige las funciones por proxy a otro, el cual no respondió. | Comprueba que la unidad de funciones esté en ejecución. |

## Trabajos cron

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `CRON_JOB_ALREADY_EXECUTING` | 409 | Activación manual de un trabajo cron que ya está en ejecución — en el proceso que respondió o en otro que retiene la concesión de ejecución del trabajo, como el worker detrás de un proceso `api`. No se ejecutó nada. La omisión queda registrada en el historial del trabajo, y `details.log` es dicha entrada; su línea indica el proceso que ejecuta el trabajo. | Vuelve a intentarlo cuando esa ejecución haya finalizado. Consulta [Trabajos cron](/docs/backend/cron-across-instances/#concurrency-guarding). |

## Superficies de administración y edición del esquema

Estos indican que una funcionalidad está desactivada o sin configurar, y no que la solicitud fuera
errónea. Cada uno también se reporta en la ruta `/status` correspondiente con un `200`,
de modo que un panel pueda deshabilitar visualmente la funcionalidad en lugar de mostrar un error.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | Se invocó una superficie exclusiva de administración en un servidor sin autenticación configurada, por lo que nada puede distinguir a un administrador de un desconocido. | Define `auth.jwtSecret` o pasa un `AuthAdapter`. |
| `BRANCH_DIFF_STALE` | 409 | Se envió a `POST /api/admin/branches/:name/merge` la huella digital (fingerprint) de un diff que ya no es válido: la rama o su rama principal cambiaron desde entonces. No se escribió nada. | Lee el diff de nuevo, revísalo y fusiona con su nuevo `fingerprint`. |
| `BRANCH_DIFF_UNSUPPORTED` | 501 | La fuente de datos no puede comparar ramas: no tiene SQL o no admite ramificación (no hay conexión de administrador). | Usa un backend de Postgres con `adminConnectionString` configurada. |
| `BRANCH_MERGE_BLOCKED` | 409 | Una tabla con diferencias no puede fusionarse: agregada o eliminada por la rama, columnas o clave primaria que difieren, sin clave primaria, demasiadas filas para comparar o reescrita desde que se creó la rama (`TABLE_REWRITTEN`). Una tabla cuyas filas no pudieron compararse bloquea la fusión incluso si su conteo marca 0: son desconocidas, no cero. `details.tables` enumera cada una con el motivo. No se escribió nada. | Aplica el esquema con tus migraciones primero, o fusiona con `skipBlocked: true` para ignorar esas tablas. |
| `BRANCH_MERGE_CONFLICT` | 409 | Se modificaron filas tanto en la rama como en su principal, y `onConflict` era `"abort"` (el valor por defecto); o la principal rechazó parte de la fusión: una fila cambió mientras tanto, un trigger la omitió, una política la ocultó. No se escribió nada. | Elige qué lado prevalece con `onConflict: "branch"` o `"target"`, o lee el diff de nuevo. |
| `BRANCH_MERGE_FAILED` | 409 | La principal rechazó las filas de la rama dentro de la sentencia de fusión: una restricción, un valor de enum o una clave foránea que esta contiene y que las filas de la rama infringen, generalmente porque ambos esquemas difieren. `details` contiene `sqlState`, `table`, `constraint` y `detail`. No se escribió nada. | Lee los cambios de esquema del diff, alinea el esquema de la principal con tus migraciones o corrige las filas de la rama, y luego vuelve a fusionar. |
| `BRANCH_NOT_FOUND` | 404 | Ninguna rama tiene ese nombre en el registro. | `rebase db branch list`, o el panel de Ramas, enumera las existentes. |
| `CONTRACT_UNAVAILABLE` | 404 | El contrato del proyecto solo se sirve cuando la autenticación está configurada — describe cada tabla y relación. | Configura la autenticación. `/meta/schema-version` siempre se sirve. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | No hay ningún buzón de desarrollo activo. El correo solo se captura cuando `SMTP_HOST` no está configurado y `NODE_ENV` no es producción. | Desasigna `SMTP_HOST` en desarrollo o consulta la bandeja de entrada real. |
| `INVALID_CHANGE` | 400 | El cambio de esquema propuesto no está bien formado. | Consulta el mensaje. |
| `SCHEMA_CHANGE_FAILED` | 400 | Falló la aplicación de un cambio de esquema planificado por un motivo que códigos más específicos no contemplan. | Consulta el mensaje; es el fallo subyacente de forma textual. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | El cambio es válido pero no se puede aplicar al esquema en su estado actual. | Consulta el mensaje. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | El repositorio tiene cambios sin confirmar, por lo que la edición no pudo aplicarse de forma segura. | Haz commit o stash, y vuelve a intentarlo. |
| `SCHEMA_EDIT_REFUSED` | 400 | El editor de esquemas rechazó la edición. | Consulta el mensaje; es el rechazo del propio editor. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Una clave de API u otra entidad máquina intentó aplicar un cambio de esquema. | Inicia sesión como usuario o configura `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | La edición de esquemas en vivo necesita `collectionsDir` o `liveSchema.repository`, y este servidor se inició sin ninguno de los dos. | Configura uno de ellos. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | La planificación funciona; no hay ningún repositorio en el cual confirmar el cambio. | Configura `liveSchema.repository`. |
| `SCHEMA_EDITING_PROVISIONING_OFF` | 409 | Este despliegue no modifica nada en su base de datos (`REBASE_PROVISION=false`), por lo que un cambio no puede aplicarse desde el panel. | Confírmalo únicamente como código fuente y deja que el proceso que modifica la base de datos lo aplique. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Este controlador no puede planificar cambios de esquema. | La edición en vivo está disponible en Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | Las colecciones se introspeccionan desde la base de datos en este entorno, por lo que no hay archivos de origen que editar. | Modifica el esquema mediante una migración. |
| `SCHEMA_EDITOR_DISABLED` | 501 | El editor de esquemas está desactivado para este servidor. Un bundle compilado siempre responde esto. | Actívalo con `schemaEditor`. En un bundle compilado, define `REBASE_LIVE_SCHEMA_REPOSITORY` para editar colecciones a través de un repositorio — consulta [Edición de esquemas en vivo](/docs/backend/live-schema-editing#from-a-built-bundle). |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | El editor de esquemas necesita `ts-morph`, el cual no está instalado. | Instálalo en el paquete que ejecuta el backend y luego reinícialo: `pnpm --dir backend add -D ts-morph@28.0.0` desde la raíz de un proyecto generado, o `pnpm add -D ts-morph@28.0.0` donde el backend sea el propio proyecto. El mensaje indica el comando exacto para tu proyecto. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | El servidor no tiene definido `collectionsDir`, por lo que el editor no tiene dónde escribir. | Define `collectionsDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | El editor está desactivado bajo `NODE_ENV=production`: los archivos de un servidor desplegado se reconstruyen a partir de tu repositorio en cada despliegue, por lo que cualquier edición aquí se perdería. | Edita las colecciones en desarrollo y despliega, o configura `liveSchema.repository` para confirmarlas allí. |
| `SQL_EXPORT_UNSUPPORTED` | 501 | `POST /api/admin/sql/csv` no puede transmitir un resultado en streaming aquí: la base de datos de desarrollo en proceso (PGlite) tiene una sola conexión, y un cursor retenido durante una descarga bloquearía todas las demás consultas; o bien la fuente de datos no admite cursores SQL. | Apunta `DATABASE_URL` a una instancia propia de Postgres (`rebase dev --docker` inicia una), o añade un `LIMIT` y exporta las filas en pantalla. |

### Reconciliación de esquema

[`rebase schema reconcile`](/docs/cli/schema/#rebase-schema-reconcile) planifica
a través de `POST /api/admin/schema/reconcile/plan` y aplica mediante
`/reconcile/apply`. Un rechazo no altera nada; únicamente `SCHEMA_RECONCILE_FAILED`
deja parte de un plan aplicado.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `INVALID_RECONCILE` | 400 | El cuerpo no es un objeto JSON, o `drop` no es una lista de cadenas `"<collection>.<column>"`. | Envía `{ "drop": ["voice_cache.wav"] }`, o no incluyas `drop`. |
| `SCHEMA_RECONCILE_FAILED` | 400 | Una sentencia falló a mitad del proceso. Las sentencias anteriores se ejecutaron y permanecen aplicadas; `details.applied` las enumera. | Corrige lo indicado en el mensaje y luego vuelve a planificar: el nuevo plan excluirá lo que ya se ejecutó. |
| `SCHEMA_RECONCILE_INVALID` | 400 | El plan no se puede aplicar y el mensaje detalla el motivo: un `drop` que no cumple con `<collection>.<column>`, no indica colección o columna, o especifica una columna que la colección todavía declara. `details.plan` es el plan. | Corrige la lista `drop`. Una columna declarada se elimina quitando su propiedad, desplegando y luego ejecutando reconcile. |
| `SCHEMA_RECONCILE_STALE` | 409 | La base de datos o las colecciones cambiaron después del plan confirmado. `details.plan` es el nuevo plan. | Revisa el nuevo plan y confirma su `digest`. |
| `SCHEMA_RECONCILE_UNCONFIRMED` | 400 | No se envió `confirm` a `/reconcile/apply`. | Planifica primero y envía el `digest` del plan como `confirm`. La CLI hace esto automáticamente una vez que escribes `yes`. |
| `SCHEMA_RECONCILE_UNSUPPORTED` | 503 | El controlador de este backend no puede planificar una reconciliación o no puede ejecutar SQL. | Reconcile funciona en Postgres. |

### Por qué no se puede fusionar la tabla de una rama

`BRANCH_MERGE_BLOCKED` nombra cada tabla rechazada en `details.tables`, con uno
de estos códigos. El mismo código aparece en el campo `blocked` de la tabla en el propio diff,
para que Studio pueda advertirlo antes de que alguien presione **Merge**. Ninguno constituye una respuesta
independiente por sí mismo.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `COLUMNS_DIFFER` | — | Las columnas de la tabla difieren entre la rama y su principal. Las filas se comparan según las columnas que comparten. | Agrega las columnas faltantes a la principal mediante tus migraciones (`rebase db push`) y luego fusiona. Una migración que reescriba la tabla —un cambio de tipo de columna— la convierte en `TABLE_REWRITTEN`: fusiona antes de dicho cambio, o vuelve a crear la rama después de él. |
| `NO_PRIMARY_KEY` | — | La tabla no tiene clave primaria, por lo que las filas no pueden cotejarse una por una; el diff solo muestra sus conteos de filas. | Añade una clave primaria a la tabla, o traslada sus filas manualmente. |
| `PRIMARY_KEY_DIFFERS` | — | Las columnas de la clave primaria, o sus tipos, difieren entre ambas. | Aplica primero el esquema a la principal. |
| `TABLE_ADDED` | — | La rama creó la tabla. Una fusión nunca crea tablas. | Créala en la principal con tus migraciones y luego fusiona sus filas. |
| `TABLE_DROPPED` | — | La rama eliminó la tabla. Una fusión nunca elimina tablas. | Elimínala con tus migraciones. |
| `TABLE_REWRITTEN` | — | Una de las partes reescribió por completo cada fila de la tabla después de crear la rama —un cambio de tipo de columna, un `ADD COLUMN` con valor por defecto volátil, `VACUUM FULL`, `CLUSTER`— por lo que todas las filas figuran como modificadas desde entonces y ya no es posible determinar qué parte modificó cada fila. | Fusiona la rama antes de una migración de este tipo, o vuelve a crear la rama a partir de la principal después de ella. |
| `TOO_LARGE` | — | La tabla contiene en uno de los lados más filas de las que un diff puede cotejar una a una (100.000 por defecto, `maxRowsPerTable`). | Aumenta `maxRowsPerTable` tanto en el diff como en la fusión, o traslada las filas por otro método. |

## Códigos genéricos

Una ruta utiliza uno de estos cuando nada más específico resulta aplicable.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Solicitud malformada y no aplica nada más específico. | Consulta el mensaje. |
| `UNAUTHORIZED` | 401 | No autenticado, o la credencial fue rechazada. | Inicia sesión o renueva el token. |
| `FORBIDDEN` | 403 | Autenticado, pero no permitido. | Reintentar con la misma identidad no servirá de nada. |
| `CONFLICT` | 409 | Conflicto con el estado existente. | Consulta el mensaje. |
| `INTERNAL_ERROR` | 500 | Algo falló en el servidor. El mensaje es genérico a propósito. | Cita el `requestId`; el motivo se encuentra en los logs. |
| `NOT_CONFIGURED` | 503 | Una dependencia que necesita esta ruta no está configurada en este servidor. | Consulta el mensaje. |
| `SERVICE_UNAVAILABLE` | 503 | No se pudo conectar con un servicio del que depende la solicitud: un bucket de S3 o MinIO, o un host al que una función hace `fetch()` que rechaza la conexión o no se resuelve. El registro del servidor nombra al host; la respuesta no. Una base de datos inalcanzable es `DATABASE_UNAVAILABLE`. Una conexión a dicho servicio que falle responde esto. | Reintenta; comprueba los logs. |

## Mantener esta página actualizada

`pnpm verify:docs` falla cuando falta en estas tablas un código que el servidor puede emitir,
cuando una tabla lista un código que nada puede generar, cuando los estados de una fila no son
exactamente aquellos con los que el código fuente emite dicho código, o cuando una familia de códigos como `PG_<SQLSTATE>` no tiene una fila
para un SQLSTATE con el que los llamadores se puedan topar. La fase es
`tooling/scripts/docs-verify/check-error-codes.mjs`.

Se comprueba a sí mismo primero. El análisis lee los códigos directamente de TypeScript en lugar de hacerlo
desde un servidor en ejecución, por lo que sus puntos ciegos son silenciosos por diseño: en una ocasión
no pudo detectar un código pasado a través de un wrapper de una sola línea, o uno escrito después de un mensaje
que contenía un `)`, y reportó que "cada código que el servidor puede emitir está documentado"
en una página a la que le faltaban diecisiete de ellos. Por ello, la comprobación ejecuta un fixture con exactamente
esas estructuras antes de leer esta página, y se niega a reportar nada si no logra detectarlas.
