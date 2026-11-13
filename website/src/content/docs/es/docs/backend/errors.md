---
sourceHash: ccf1ed328b50de1a
title: Códigos de error
sidebar_label: Códigos de error
description: Todos los códigos de error que puede devolver un backend de Rebase, con su estado HTTP, qué significan y qué hacer al respecto; además del envelope de respuesta, X-Request-ID y las reglas de details.
---

Cada fallo que devuelve un backend de Rebase utiliza un único envelope y contiene un
`code` estable. El código es el elemento sobre el que bifurcar la lógica: el mensaje está escrito para una
persona y puede reformularse, el estado se comparte entre una docena de problemas diferentes
y el código no es ninguna de las dos cosas.

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

- **`message`** — legible por humanos. Para un `4xx` es el mensaje propio del servidor; para
  un `5xx` es deliberadamente genérico, ya que el texto subyacente puede citar un
  host, un rol o un nombre de columna.
- **`code`** — uno de los valores que figuran a continuación. Estable entre versiones menores.
- **`details`** — opcional y nunca garantizado. Consulta las reglas a continuación.
- **`requestId`** — presente siempre que la solicitud haya pasado por el middleware
  de request-ID, es decir, cada ruta bajo `basePath`.

### `X-Request-ID`

Cada solicitud bajo `basePath` obtiene un ID: la cabecera `X-Request-ID` del emisor
cuando es un UUID; de lo contrario, uno nuevo. Se devuelve en la
respuesta como `X-Request-ID`, se incluye en el envelope de error como `requestId` y se
adjunta a la línea de registro del servidor correspondiente a esa solicitud.

Esa es la clave de unión. Cítala en un informe de errores y un operador podrá encontrar la única
línea de registro que explica el fallo, conteniendo la razón que nunca se le
mostró al cliente.

Enviar el tuyo propio es la forma en que una traza sobrevive a un salto: una pasarela (gateway) o un ejecutor de tareas
que reenvía la cabecera obtiene un único ID a través de cada servicio que gestionó la solicitud.
Un valor no válido se ignora en lugar de rechazarse (no merece la pena hacer fallar una solicitud por una cabecera
malformada enviada por el cliente), así que no asumas que el ID que enviaste es
el ID que recibiste. Lee la cabecera de la respuesta.

### Qué contiene `details`

`details` tiene fines de diagnóstico, no contractuales. Se rige por tres reglas:

1. **Todo lo que una ruta establece explícitamente se devuelve siempre.** Estos son los
   errores del propio emisor descritos con precisión: qué campo de filtro era desconocido,
   qué relación no admite escritura, qué valor no encajaba con su tipo.
2. **Los diagnósticos de la base de datos se recortan en producción.** Cuando el fallo proviene
   de Postgres, `details.dbCode` (el SQLSTATE) siempre está presente: nombra
   la clase de problema y no revela nada sobre los datos. `dbMessage`,
   `detail` e `hint` solo se añaden cuando `NODE_ENV` no es `production`,
   porque Postgres incluye el contenido de las filas en ellos. `23505` informa
   `Key (email)=(a@b.c) already exists.`, lo que responde a "¿está registrada esta persona?"
   para cualquier dirección que cualquiera decida probar.
3. **Nunca bifurques la lógica basándote en `details`.** Hazlo según `code`. Lo que hay en `details` es
   cualquier cosa que haya sido útil para una persona en ese punto de llamada, y puede cambiar.

## Lectura de un estado

| Estado | Lo que indica sobre la solicitud |
| --- | --- |
| `400` | Malformada, o solicita algo que no existe en el esquema. Corrige la solicitud. |
| `401` | No autenticado, o la credencial ha caducado. Inicia sesión o renueva el token. |
| `403` | Autenticado, pero no autorizado. Reintentar con la misma identidad no servirá de nada. |
| `404` | No existe dicha ruta, tabla o fila; o bien una política de seguridad a nivel de fila la oculta. |
| `409` | Un conflicto con el estado existente: un duplicado o una escritura concurrente. |
| `413` `415` `422` | El cuerpo es demasiado grande, el tipo de medio es incorrecto o fue rechazado semánticamente. |
| `429` | Límite de tasa excedido (Rate limited). Reduce la frecuencia; el mensaje indica durante cuánto tiempo. |
| `500` | El fallo es del servidor o de su base de datos, no del emisor. Revisa los registros. |
| `501` | La ruta existe, pero este despliegue no puede atenderla: una funcionalidad desactivada o sin configurar. |
| `502` `503` `504` | Una dependencia no estaba accesible, no estaba configurada o fue demasiado lenta. |

## Autenticación y cuentas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | La ruta requiere un segundo factor y la sesión solo dispone de uno. | Completa el desafío MFA y luego reintenta. |
| `ALREADY_VERIFIED` | 400 | La dirección o el factor ya están verificados. | Nada: el estado deseado ya se cumple. |
| `ACCOUNT_OUTRANKS_CALLER` | 403 | La cuenta que se intenta editar, restablecer o eliminar posee un rol o scope que el emisor no tiene. `details.beyond` los enumera. | Haz que alguien que los posea realice el cambio. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | El inicio de sesión anónimo está desactivado en este servidor. | Actívalo o inicia sesión con una identidad real. |
| `ANONYMOUS_NOT_ALLOWED` | 403 | Una sesión de invitado intentó aprobar el inicio de sesión de un dispositivo. Un invitado no tiene una cuenta que vincular a un dispositivo. | Inicia sesión con una cuenta y luego apruébalo. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Una API key intentó listar, crear, modificar o revocar API keys, ya sean de su propio tipo o personales. | Administra las claves como un usuario que posea `keys:write`, o con la clave de servicio. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Se ejecutó una ruta protegida sin ningún middleware de autenticación de Rebase previo, por lo que nunca se evaluó la credencial del emisor. | Monta la aplicación a través del enrutador de funciones en lugar de hacerlo directamente sobre tu propio servidor. |
| `BOOTSTRAP_ANONYMOUS` | 403 | Un emisor anónimo intentó inicializar el primer administrador. | Inicia sesión primero. |
| `BOOTSTRAP_COMPLETED` | 403 | El primer administrador ya existe. | Pide a un administrador existente que conceda el rol. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | La inicialización (bootstrap) es solo para el primer usuario absoluto, y este no lo es. | Pide a un administrador existente que conceda el rol. |
| `CAPTCHA_FAILED` | 400 | El proveedor rechazó el token de CAPTCHA. | Resuelve un desafío nuevo. |
| `CAPTCHA_REQUIRED` | 400 | La ruta requiere un token de CAPTCHA y no se envió ninguno. | Incluye el token. |
| `CHALLENGE_EXHAUSTED` | 401 | Demasiados códigos erróneos para un mismo desafío MFA. | Inicia un nuevo desafío. |
| `DEVICE_LOGIN_DECIDED` | 409 | El inicio de sesión del dispositivo ya fue aprobado o denegado. Un inicio de sesión solo se resuelve una vez. | Inicia uno nuevo en el dispositivo. |
| `DEVICE_LOGIN_EXPIRED` | 410 | El inicio de sesión del dispositivo superó sus diez minutos antes de ser resuelto. | Inicia uno nuevo en el dispositivo. |
| `DEVICE_LOGIN_NOT_FOUND` | 404 | Ningún inicio de sesión de dispositivo coincide con ese código de usuario. El propio sondeo del dispositivo responde con los códigos en minúsculas del RFC 8628: `authorization_pending`, `slow_down`, `access_denied`, `expired_token`, `invalid_grant`. | Comprueba el código comparándolo con el que muestra el dispositivo. |
| `EMAIL_EXISTS` | 409 | Ya existe una cuenta con esa dirección: al registrarse, al cambiar de dirección o al seguir un enlace de cambio de dirección cuando otra cuenta tomó la dirección mientras esperaba. | Inicia sesión o inicia un restablecimiento de contraseña; para un cambio de dirección, elige otra dirección. |
| `EMAIL_NOT_CONFIGURED` | 503 | Se solicitaron magic links u OTP y el servidor no tiene transporte de correo configurado. | Configura SMTP o utiliza otro método de inicio de sesión. |
| `EMAIL_NOT_VERIFIED` | 403 | Un inicio de sesión mediante OAuth encontró una cuenta con la misma dirección y el proveedor no verificó esa dirección, por lo que no se vincula. | Inicia sesión con el método existente y luego haz `POST /auth/link/<provider>`. |
| `FACTOR_NOT_VERIFIED` | 400 | El factor MFA se registró pero nunca se confirmó. | Confirma el factor. |
| `IDENTITY_ALREADY_LINKED` | 409 | Esa identidad de OAuth pertenece a otra cuenta. | Inicia sesión con ella, o desvincúlala primero de esa cuenta. |
| `IMPERSONATION_FORBIDDEN` | 403 | Una solicitud envió `x-rebase-impersonate` y su emisor no tiene permiso para ejecutar una solicitud como otro usuario. Solo la sesión propia de un administrador autenticado puede hacerlo, nunca una API key o la clave de servicio. | Envíala con una sesión de administrador o elimina la cabecera. |
| `IMPERSONATION_INVALID` | 400 | `x-rebase-impersonate` se envió vacío. | Envía el uid del usuario a suplantar o elimina la cabecera. |
| `IMPERSONATION_TARGET_NOT_FOUND` | 404 | `x-rebase-impersonate` no especifica ningún usuario activo: ninguna cuenta tiene ese uid, o está deshabilitada. | Comprueba el uid. |
| `IMPERSONATION_UNAVAILABLE` | 501 | La autenticación de este backend no puede ejecutar una solicitud como otro usuario porque su `AuthAdapter` no dispone de `resolveUser`. | Implementa `resolveUser` en el adaptador o elimina la cabecera. |
| `IMPERSONATION_UNSUPPORTED` | 400 | Se envió `x-rebase-impersonate` a una ruta que no admite ejecutarse como otro usuario. Solo la API de datos y las funciones personalizadas lo admiten, y el socket en tiempo real admite `impersonate` en `AUTHENTICATE`. | Envía la solicitud sin la cabecera. |
| `SIMULATION_FORBIDDEN` | 403 | Una solicitud envió una cabecera `x-rebase-simulate-*` (el simulador de RLS), o consultó `/api/admin/rls-simulator`, y su emisor no puede simular accesos. Solo la sesión propia de un administrador autenticado puede hacerlo, nunca una API key o la clave de servicio. | Envíala con una sesión de administrador o elimina las cabeceras. |
| `SIMULATION_INVALID` | 400 | La simulación estaba malformada: una cabecera vacía, `x-rebase-simulate-api-key-id` combinado con un rol o ID de usuario, o la simulación combinada con `x-rebase-impersonate`. | Especifica un único rol (opcionalmente con un uid), un único ID de usuario o un único ID de API key. |
| `SIMULATION_READ_ONLY` | 403 | Una escritura, eliminación, `_batch`, reversión de historial o una función personalizada llamada mediante cualquier verbo distinto de `GET`/`HEAD`/`OPTIONS` incluyó una cabecera `x-rebase-simulate-*`. El acceso simulado es de solo lectura: la escritura se ejecutaría como la identidad simulada, no como el administrador. Las lecturas, incluidas `POST …/query` y `…/count`, siguen funcionando. | Deja de simular para realizar cambios. |
| `SIMULATION_TARGET_NOT_FOUND` | 404 | La simulación no designa a ningún usuario activo (un ID de usuario enviado sin un rol) ni ninguna API key activa. | Comprueba el ID, o envía un rol junto con el uid para simular un uid que no tiene cuenta. |
| `SIMULATION_UNAVAILABLE` | 501 | Este backend no puede simular accesos: su `AuthAdapter` no tiene `resolveUser` para confirmar a un administrador, o se especificó una clave en un backend sin API keys. | Implementa `resolveUser` o elimina las cabeceras. |
| `SIMULATION_UNSUPPORTED` | 400 | Se envió una cabecera `x-rebase-simulate-*` a una ruta que no admite ejecutarse con acceso simulado. Solo la API de datos y las funciones personalizadas las admiten. | Envía la solicitud sin las cabeceras. |
| `GUEST_REFERENCED` | 409 | No se pudo eliminar un invitado porque una fila propia del proyecto lo requiere a través de una clave foránea con `ON DELETE RESTRICT` o `NO ACTION`. `DELETE /api/admin/guests` lo reporta por invitado en `skipped` y continúa. | Elimina la fila o conserva el invitado. |
| `INVALID_ACCOUNT` | 400 | La cuenta está en un estado sobre el cual esta operación no puede actuar. | Consulta el mensaje. |
| `INVALID_CHALLENGE` | 400 | El desafío MFA es desconocido o ha caducado. | Inicia uno nuevo. |
| `INVALID_CODE` | 400 / 401 | El código OTP o MFA es incorrecto: 400 para el inicio de sesión con código por correo (`/auth/otp/verify`), 401 para un registro o desafío MFA. | Reintenta con el código actual. |
| `INVALID_CREDENTIALS` | 401 | Correo o contraseña incorrectos — deliberadamente no se indica cuál. | Reintenta o restablece la contraseña. |
| `INVALID_PLATFORM_TOKEN` | 401 | Se rechazó un token de plataforma `rpt_`: firma incorrecta, audiencia errónea, caducado o duración por encima del límite. El mensaje indica cuál. | Haz que la plataforma genere uno nuevo; en Rebase Cloud, ejecuta el comando nuevamente. |
| `INVALID_SCOPES` | 400 | Se solicitó para una clave algo que no es un scope: malformado, desconocido o con un destino no admitido por el scope. `details.problems` indica cuál y por qué; `details.validScopes` enumera los scopes que una clave puede tener. Excluye `keys:read` y `keys:write`, que ninguna clave puede poseer. | Usa un nombre de la lista. Consulta [Roles y scopes](/docs/backend/roles-and-scopes/). |
| `INVALID_TOKEN` | 400 / 401 | Un token de verificación, restablecimiento, magic link o cambio de dirección está malformado, es desconocido, ya fue utilizado o ha caducado (400). Una credencial de proveedor OAuth o un refresh token que no se valida devuelve 401. | Solicita un enlace nuevo o inicia sesión de nuevo. |
| `INVALID_USER_CODE` | 400 | Lo que se envió como código de inicio de sesión de dispositivo no es válido: son ocho letras, como `BCDF-GHJK`. | Copia el código que muestra el dispositivo. |
| `INVALID_ROLE` | 400 | El nombre de un rol que se intenta escribir no es una cadena, está vacío o contiene `,` `{` `}` `"` `\` o un carácter de control. Esos caracteres se interpretarían como otros roles al leerlos: un rol viaja en un `text[]` de Postgres y en la lista separada por comas que dividen las políticas RLS, por lo que `"support,admin"` se leería como `admin`. `details.problems` nombra cada uno. | Renombra el rol. Cualquier otro nombre es aceptado. |
| `KEY_MANAGEMENT_SCOPE` | 400 | Se solicitó `keys:read` o `keys:write` para una clave. Ninguna clave puede gestionar claves. `details.scopes` los enumera. | Exclúyelos. |
| `KEY_OUTRANKS_CALLER` | 403 | Un titular de `keys:write` intentó modificar o revocar una clave de servicio que posee un rol o scope que él no tiene. Solo un administrador gestiona cualquier clave. `details.roles` y `details.scopes` detallan lo que la clave posee más allá del emisor. | Haz que un administrador, o alguien que los posea, modifique la clave. |
| `LAST_ADMIN` | 403 | El cambio dejaría al proyecto sin administradores. | Promociona a otra persona primero. |
| `MFA_REQUIRED` | 401 | La contraseña fue correcta y la cuenta tiene un segundo factor verificado, por lo que el inicio de sesión solo se ha completado a medias. `details` contiene un token de corta duración delimitado al desafío MFA — no es una sesión. | Inicia un desafío y respóndelo; la respuesta al desafío emitirá la sesión. |
| `NO_SESSION` | 401 | No se presentó ninguna cookie de sesión ni refresh token. Es normal en la primera carga de una página. | Inicia sesión. |
| `NOT_ANONYMOUS` | 400 | Una cuenta real llamó a una ruta de actualización desde anónimo, o `DELETE /api/admin/guests/:uid` designó una cuenta real. | No hay nada que actualizar. Para eliminar una cuenta, usa `DELETE /api/admin/users/:uid`. |
| `OAUTH_ERROR` | 401 | El proveedor de OAuth rechazó la solicitud o devolvió un error. | Reintenta el flujo; el mensaje incluye el motivo del proveedor. |
| `PERSONAL_KEYS_DISABLED` | 403 | Las API keys personales están desactivadas en este backend. | Configura `personalKeys: true` en las opciones de `auth` de la tabla de autenticación (`defineAuthTable`). |
| `PERSONAL_KEY_NEEDS_ACCOUNT` | 403 | La clave de servicio o una sesión de invitado intentaron usar las rutas de claves personales. Ninguno de los dos tiene una cuenta para la cual la clave pueda actuar. | Inicia sesión en una cuenta, o crea una clave de servicio en `/api/admin/api-keys`. |
| `PLATFORM_TOKENS_OFF` | 401 | Un token de plataforma `rpt_` llegó a un servidor que no los acepta: `REBASE_PLATFORM_TOKEN_KEY` y `REBASE_PLATFORM_TOKEN_AUDIENCE` no están configurados. | La plataforma que aloja la app configura ambos al desplegar; vuelve a desplegar o inicia sesión en la aplicación de otra forma. |
| `RATE_LIMITED` | 429 | Demasiados intentos por parte de este emisor. | Reduce la frecuencia; el mensaje indica durante cuánto tiempo. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | El destino de redirección no está en la lista de permitidos. | Añádelo a la configuración del proveedor. |
| `REGISTRATION_DISABLED` | 403 | El registro libre de usuarios está desactivado. | Haz que un administrador cree la cuenta. |
| `ROLE_EXCEEDS_CALLER` | 403 | Los roles que se están otorgando contienen un scope, o `admin`, que el emisor no posee. `details.beyond` los enumera. | Haz que alguien que los posea otorgue el rol. |
| `ROLE_EXCEEDS_CREATOR` | 403 | Se asignó a una clave de servicio un rol de RLS que su creador no posee. Solo un administrador puede asignar cualquier rol. `details.roles` los enumera. | Elimina el rol o haz que un administrador cree la clave. |
| `ROLE_EXISTS` | 409 | Ese nombre de rol ya está en uso. | Elige otro nombre. |
| `ROLE_LOOKUP_FAILED` | 503 | No se pudieron leer los roles del emisor: en una ruta de administración o en una solicitud de datos en un backend con `config.auth`. Se deniega por defecto (fail closed) en lugar de confiar en los roles del token. Un token cuyo uid no nombra ninguna cuenta, incluido un uid que la tabla de usuarios no puede albergar, es un 401, no este error. Una base de datos inalcanzable es `DATABASE_UNAVAILABLE`, no este error. | Reintenta; comprueba la base de datos. |
| `SCOPE_EXCEEDS_CREATOR` | 403 | Se solicitó para una clave un scope que su creador no posee. Una clave nunca posee más que la cuenta que la crea. `details.scopes` los enumera. | Quítalos, o haz que alguien que los posea cree la clave. |
| `SCOPE_MISSING` | 403 | La credencial no posee el scope que esta ruta, tabla, fuente de almacenamiento o función necesita. `details.requiredScope` lo especifica, incluyendo el destino. | Para una persona, un rol que declare el scope. Para una clave, una clave que lo posea. Consulta [Roles y scopes](/docs/backend/roles-and-scopes/). |
| `SCOPE_NOT_DECLARED` | 500 | Una ruta protegida con `requireScope` nombra un scope de aplicación que este backend no declara, por lo que nadie lo tiene, ni siquiera un administrador. Un nombre que no es un scope en absoluto, o uno integrado mal escrito como `data:raed`, nunca llega hasta aquí: `requireScope` lanza una excepción donde se registra la ruta. | Declara el scope en `auth.scopes` en la tabla de autenticación, o corrige el nombre. Consulta [Roles y scopes](/docs/backend/roles-and-scopes/). |
| `SELF_DELETE` | 400 | Un administrador intentó eliminar su propia cuenta. | Pide a otro administrador que lo haga. |
| `SESSION_REVOKED` | 401 | La sesión se cerró en otro lugar, se revocaron todas las sesiones o la cuenta fue eliminada. Cualquier punto de entrada que requiera sesión responderá con esto ante dicho token de acceso: la API de datos, almacenamiento, funciones personalizadas y las rutas de administración. El socket en tiempo real rechaza su `AUTHENTICATE` con un frame `AUTH_ERROR` que lleva el mismo código. El SDK intenta renovar, la renovación se rechaza y se cierra la sesión. | Inicia sesión de nuevo. |
| `ACCOUNT_DISABLED` | 401/403 | Un administrador desactivó la cuenta: el inicio de sesión (403), la renovación y todos los tokens que posee (401) son rechazados en cualquier punto que requiera sesión. El socket en tiempo real rechaza su `AUTHENTICATE` con un frame `AUTH_ERROR` que contiene el mismo código. | Contacta a un administrador. |
| `EMAIL_NOT_CONFIRMED` | 403 | `requireEmailVerification` está activado y la dirección aún no se ha verificado. Solo se responde ante una contraseña correcta; se envía un nuevo enlace por correo. | Sigue el enlace que se envió por correo. |
| `PROOF_REQUIRED` | 409 | `POST /auth/verify-email`: la cuenta tiene una contraseña o identidad que nadie ha verificado y la solicitud no demuestra ninguna de las dos cosas. El token no se consume. | Envía `password` para conservarla, o `removeUnproven: true` para verificar sin ella. |
| `UNDELIVERABLE_ADDRESS` | 400 / 409 | Se solicitó un correo de verificación para una dirección inalcanzable (la de un invitado o el marcador de posición de X, 400), o una cuenta solicitó migrar a dicha dirección (409, `POST /auth/change-email`). | Configura primero una dirección real. |
| `EMAIL_UNCHANGED` | 400 | `POST /auth/change-email` especificó la dirección actual de la cuenta. | No hay nada que cambiar. |
| `ANONYMOUS_USER` | 403 | Un invitado intentó cambiar su dirección de correo electrónico; un invitado no tiene ninguna propia. | Conviértelo en una cuenta primero (`POST /auth/anonymous/link`). |
| `MFA_NOT_ENROLLED` | 400 | Se solicitaron códigos de recuperación para una cuenta sin un segundo factor verificado. | Registra un factor primero. |
| `HOOK_REJECTED` | 400 | Un hook `beforeUserCreate`, `beforeLogin`, `beforeUserDelete` o `beforeEmailChange` lanzó un error. El mensaje es el del propio hook; un hook que eligió un estado 4xx responde con él. | Consulta el mensaje. |
| `INVALID_JSON` | 400 | El cuerpo de la solicitud no es JSON. | Envía un cuerpo JSON válido. |
| `SELF_DISABLE` | 400 | Un administrador intentó desactivar su propia cuenta. | Pide a otro administrador que lo haga. |
| `NOT_SUPPORTED` | 501 | El repositorio de autenticación de este backend no puede realizar lo solicitado (desactivar cuentas, cambiar una dirección). | Reinicia el servidor para que se agregue la columna, o usa un repositorio que lo soporte. |
| `UNKNOWN_SCOPE_TARGET` | 400 | El destino de un scope nombra una tabla, fuente de almacenamiento o función que este backend no proporciona. `details` lista los disponibles. | Corrige el destino. |
| `UNVERIFIED_IDENTITIES` | 409 | Un magic link, código por correo o restablecimiento de contraseña validó la dirección de una cuenta no verificada, pero la cuenta posee una identidad de inicio de sesión cuyo proveedor nunca verificó esa dirección. El repositorio de autenticación no puede eliminarla (no dispone de `unlinkUserIdentity`), por lo que se rechaza la verificación en lugar de dejar esa vía de acceso abierta en una cuenta verificada. | Implementa `unlinkUserIdentity` en el repositorio de autenticación personalizado, o haz que un administrador revise la cuenta. |
| `SETUP_REQUIRED` | 403 | El proyecto aún no tiene ningún administrador, por lo que esta ruta no está disponible. | Completa la configuración inicial del primer administrador. |
| `TOKEN_ALREADY_USED` | 401 | Se reutilizó un token de un solo uso, o un refresh token que fue rotado hace más de `refreshTokenReuseIntervalSeconds`. | Solicita uno nuevo o inicia sesión de nuevo. |
| `TOKEN_EXPIRED` | 401 | El token ha superado su tiempo de vida útil. | Solicita uno nuevo. |
| `USER_NOT_FOUND` | 404 | No existe ninguna cuenta con ese ID. | Comprueba el ID. |
| `WEAK_PASSWORD` | 400 | La contraseña no cumple con la [política de contraseñas](/docs/backend/auth-endpoints/#password-policy) (por defecto, más de 8 caracteres con una mayúscula, una minúscula y un dígito): en registros, restablecimientos o cambios, y en contraseñas elegidas por administradores: `POST /api/admin/users`, una creación en la tabla de autenticación mediante la API de datos, `PUT /api/admin/users/:id` o `POST /api/admin/users/:id/reset-password`. | Elige una contraseña más segura. Un administrador que importe cuentas puede enviar `skipPasswordPolicy: true` al crear. |

## Datos, consultas y escrituras

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `AGGREGATE_MASKED_BY_AFTER_READ` | 400 | Un agregado distinto de `count()` sin `groupBy` en una tabla que un hook `afterRead` modifica (global, tabla o el `.transform()` de una columna). Un agregado lee los valores almacenados y nunca ejecuta el hook, por lo que una suma, mínimo, máximo, conteo de campos o agrupación leería lo que el hook oculta. | Usa `count()` sin `groupBy`, o lee las filas, las cuales sí pasan por el hook. |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Este driver no puede calcular el agregado solicitado. | Usa un driver compatible o calcúlalo en el cliente. |
| `BRANCHING_UNSUPPORTED` | — | Se solicitó una rama de base de datos a través del websocket de Studio en la base de datos de desarrollo administrada (PGlite), donde una rama *es* el elemento principal y nada quedaría aislado. El rechazo es el mismo que imprime `rebase db branch`. | Apunta `DATABASE_URL` a una instancia propia de Postgres (`rebase dev --docker` inicia una) y ramifica allí. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` contiene más operaciones que el límite por lote (1000 por defecto). Un lote equivale a una transacción y mantiene sus bloqueos durante toda su duración. | Envíalo en fragmentos; el mensaje indica el límite y tu cantidad actual. |
| `BATCH_UNSUPPORTED` | 400 | El driver de este backend no puede escribir en varias tablas de forma atómica, y un bucle de escrituras individuales no sería atómico ni se realizaría en un solo viaje de ida y vuelta. | Envía las escrituras como solicitudes separadas, o como llamadas `/bulk` por tabla. |
| `BULK_TOO_LARGE` | 400 | El cuerpo de la operación masiva supera el límite configurado de elementos. | Divide la solicitud. |
| `BULK_UNSUPPORTED` | 400 | Esta tabla o driver no admite escrituras masivas. | Escribe las filas de una en una. |
| `CALLBACK_REJECTED` | 400 / 403 | Un hook de tabla rechazó la escritura. Un `throw` desde `beforeSave`/`beforeDelete`/`after*` devuelve un 400 con el mensaje propio del autor; un `beforeDelete` que devuelve `false` da un 403. `details.stage` especifica qué hook, `details.path` la tabla. | Lee el mensaje: fue escrito por este proyecto, no por Rebase. |
| `CALLBACK_RECURSION` | 500 | Las escrituras iniciadas por hooks se anidaron con más de 16 niveles de profundidad: una escritura `context.data` de un hook vuelve a ejecutar los hooks de esa tabla y nada en la cadena lo detiene (generalmente un `afterSave` que actualiza su propia fila sin condiciones). Toda la escritura fue revertida (rollback). El mensaje nombra el hook y la tabla; `details.chain` lista cada paso de hook → escritura. | Haz que la escritura del hook sea condicional: actúa solo cuando `status === "new"`, u omítela cuando `values` ya contenga lo que iba a escribir. |
| `TABLE_READ_ONLY` | 405 | <span class="since-badge" data-since="0.31">Desde 0.31</span> Una escritura alcanzó una vista (`defineView`). Las vistas son de solo lectura. Antes era `COLLECTION_READ_ONLY`. | Escribe en las tablas desde las cuales lee la vista. Consulta [Vistas](/docs/collections/views/). |
| `TABLE_WITHHELD` | 503 | <span class="since-badge" data-since="0.31">Desde 0.31</span> La tabla está declarada, pero la base de datos no la protege: la seguridad a nivel de fila (RLS) está desactivada, ninguna de las políticas que declara está presente, o falta una política restrictiva que declara. (Una política permisiva faltante se sirve, mostrando una advertencia de arranque indicándola). Esto sucede cuando el servidor no aprovisiona sus tablas (`REBASE_PROVISION=false`, `provisionSchema: false`, `provision.tables: false`, `REBASE_MIGRATE_ON_BOOT=none`), y el servidor retiene la tabla en lugar de exponer todas las filas a todos los emisores. Una tabla intermedia de muchos a muchos sigue la misma regla: si falla, las tablas cuyas relaciones la usan se retienen y el mensaje nombra la tabla de unión. Las demás tablas se sirven con normalidad. El registro de arranque lista las sentencias que la protegen. | Aplica las sentencias que indica el registro de arranque (`rebase db push` lo hace) y reinicia. |
| `SQL_NOT_ALLOWED` | 400 | El SQL ejecutado como el emisor (`getSql(c)`, `withAuth(user).sql`) no era una sentencia simple `SELECT`, `WITH`, `VALUES`, `TABLE`, `INSERT`, `UPDATE`, `DELETE` o `MERGE`, o bien llamó a `set_config` o nombró `pg_settings`. La identidad del emisor reside en los ajustes de sesión, por lo que se rechaza cualquier sentencia que pueda modificarlos. | Mantén el texto de la consulta propio, una sola sentencia, con cada valor en `params`. Consulta [Funciones personalizadas](/docs/backend/custom-functions/#3-getsqlc--sql-as-the-caller). |
| `CURSOR_WITH_OFFSET` | 400 | Se combinó `?after=` con `?offset=` o `?page=`. Un cursor ya indica dónde empieza la página, por lo que un desplazamiento sobre él omite silenciosamente esa cantidad de filas más allá del cursor: un hueco que el emisor no puede percibir en la respuesta. | Usa uno u otro. |
| `DISTINCT_NOT_APPLICABLE` | 400 | Se combinó `?distinct=true` con una búsqueda o consulta vectorial. Ambas asignan una puntuación por fila, por lo que nunca hay dos filas iguales y `DISTINCT` no reduciría nada: parecería que funcionó sin alterar nada. | Descarta uno de los dos. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Una lectura con `distinct` se ordena mediante una columna que no devuelve. Un `SELECT DISTINCT` solo puede ordenarse por columnas presentes en su lista de selección; de lo contrario, las filas colapsadas carecen de un orden definido. `details.fields` las nombra. | Añade esos campos a `?fields=`, o elimínalos de `?orderBy=`. |
| `DATABASE_UNAVAILABLE` | 503 | No se pudo conectar con la base de datos: conexión rechazada o caída, el host no resolvió, el servidor se está apagando o iniciando, o la base de datos está cerrada a nuevas conexiones (`ALLOW_CONNECTIONS false`, lo cual ocurre cuando un `rebase db branch create --force` se interrumpe a mitad de camino y bloquea su origen; el registro del servidor nombra la base de datos y `rebase db branch list` la vuelve a abrir). Todos los accesos devuelven esto, incluidos el inicio de sesión, las rutas de administración y el socket en tiempo real (un frame `ERROR`). Se envía con `Retry-After: 5`. | Reintenta; el SDK lo hace automáticamente. Comprueba que la base de datos esté funcionando y accesible desde el servidor. |
| `DB_CONNECTIONS_EXHAUSTED` | 503 | El servidor de base de datos rechazó una nueva conexión porque no le quedan disponibles (`53300` demasiados clientes, `53400` límite de conexiones de un rol o base de datos). Cada instancia del servidor comparte el `max_connections` del servidor, por lo que esto sucede cuando varias instancias usan grupos grandes sin un pooler. Se trata de sobrecarga, no de un fallo; se envía con `Retry-After: 2`. El servidor registra la solución una vez por minuto. | Reintenta; el SDK lo hace. Reduce `DB_POOL_MAX` (o limítalo con `REBASE_DB_POOL_MAX`) entre instancias, coloca un pooler delante de la base de datos (`DATABASE_POOLED`), o aumenta `max_connections`. |
| `DB_CONNECT_TIMEOUT` | 503 | Abrir una nueva conexión a la base de datos tardó más que `DB_POOL_CONNECT_TIMEOUT`: la base de datos tarda en aceptar conexiones o está muy lejana. Se envía con `Retry-After`. | Reintenta; el SDK lo hace. Revisa la carga de la base de datos y la red hacia ella. |
| `DB_PERMISSION_DENIED` | 500 | Postgres rechazó la sentencia (`42501`): una política de seguridad a nivel de fila denegando a este rol, o un `GRANT` faltante. | Consulta [Resolución de problemas](/docs/troubleshooting/). |
| `DB_POOL_EXHAUSTED` | 503 | Todas las conexiones del pool de la base de datos estuvieron ocupadas durante `DB_POOL_CONNECT_TIMEOUT`, por lo que esta solicitud nunca llegó a la base de datos. Es un problema de carga, no un fallo; se envía con `Retry-After`. El servidor registra la solución una vez por minuto. | Reintenta; el SDK lo hace. Aumenta `DB_POOL_MAX` o localiza las consultas lentas o transacciones largas que retienen conexiones. |
| `FIELD_NOT_READABLE` | 400 | Un filtro, `orderBy`, `fields`, el `select` de un agregado o `groupBy` nombra un campo que los roles de este emisor no pueden leer (`access.read`), una ruta anidada o una ordenación agregada nombra una relación que no pueden leer, o una operación de campo (`$inc`, `$push`, …) apunta a uno donde un límite denegado revelaría el valor almacenado. Un campo que ninguna respuesta puede transportar debe ser uno que ninguna consulta pueda evaluar, o el valor sería deducible predicado a predicado. Un filtro a través de una relación (`author.salary`) y una ordenación agregada sobre el campo de una relación (`max(staff.salary)`) se evalúan según la regla de destino. `details.violations` nombra cada campo. El driver aplica la misma regla a lecturas hechas dentro del proceso en nombre de un emisor (`context.data` bajo el alcance del emisor) y a búsquedas vectoriales, inclusiones o comprobaciones de unicidad. Una columna `.private()` responde como si no existiese: un filtro, `orderBy`, `fields`, `include`, `select` de agregado o `groupBy`, o `vector_search` que la nombre recibe exactamente la misma respuesta que un nombre mal escrito (`UNKNOWN_FILTER_FIELD`, `UNKNOWN_ORDER_BY_FIELD`, `UNKNOWN_FIELD`, `UNKNOWN_RELATION`, `UNKNOWN_AGGREGATE_FIELD` o `UNKNOWN_VECTOR_PROPERTY`), y ninguna respuesta de campo desconocido la incluirá. | Elimina el campo de la consulta o adquiere el rol correspondiente. Consulta [Acceso a campos](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 / 403 | El cuerpo asigna un valor a un campo en el que los roles de este emisor no pueden escribir (`access.write`). Se rechaza en lugar de ignorarse: una escritura que descarte un campo reportaría éxito para una modificación que nunca ocurrió. El mismo código rechaza una escritura a través de un elemento padre que establece una relación que el emisor no puede escribir, así como una actualización que define un campo `softDelete` con un valor (solo una eliminación lo sella). El socket en tiempo real responde 403 con este código para una escritura a través de una ruta anidada cuya tabla padre, relación o tabla de destino no se sirve allí, en lugar de pasarla al driver sin evaluar. `details.violations` nombra cada campo. | Elimina el campo o adquiere el rol necesario. Un campo que nadie puede escribir responde `VALIDATION_EXCLUDED_FIELDS`. |
| `FILTERED_USER_WRITE` | 400 | Se envió una actualización o eliminación con filtro a la tabla de autenticación a través de HTTP, cuyas escrituras se validan usuario por usuario antes de ejecutarse. | Lee los usuarios y luego usa `updateMany`/`deleteMany` por ID. |
| `FILTER_REQUIRED` | 400 | Una escritura filtrada (una actualización o eliminación mediante `where`/`logical`, desde el SDK o las rutas masivas) no incluye ninguna condición, por lo que afectaría a todas las filas. Se rechaza antes de ejecutar nada. | Añade una condición. Para modificar todas las filas intencionadamente, indícalo con una condición que cumplan todas las filas. |
| `HISTORY_UNAVAILABLE` | 503 | Se rechazó una escritura en una tabla con `history: true` porque no se pudo registrar su entrada de historial: la base de datos no tiene la tabla `rebase.entity_history` o, en el caso de `openRebase` y `rebase console`, la función `rebase.record_history`. Ningún backend con historial se ha iniciado en esta base de datos. No se ejecutó nada (hooks incluidos) y las lecturas no se ven afectadas. Lanzado por `openRebase`, y devuelto por un backend creado con `provision: false`. | Inicia el backend una vez con el historial activado y `provision: true` (`rebase dev` lo hace), luego reintenta. |
| `HISTORY_UNSERVABLE` | 501 | <span class="since-badge" data-since="0.31">Desde 0.31</span> El driver de datos de la tabla no puede ejecutar las reglas de lectura ni los hooks `afterRead` sobre filas almacenadas (`DataDriver.serveStoredRows`), y el historial nunca se expone sin enmascarar. El driver integrado de Postgres sí puede. | Implementa `serveStoredRows` en el driver personalizado. Consulta [Historial](/docs/backend/history/). |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Una solicitud anterior con la misma `Idempotency-Key` todavía se está ejecutando. | Reintenta una vez que finalice. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | Llegó la misma `Idempotency-Key` en una solicitud diferente: otro método, ruta, parámetros de consulta o cuerpo. | Usa una clave nueva o envía la solicitud original. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` especificó una función que no es de agregación (`count`, `sum`, `avg`, `min`, `max`, `countDistinct`, `mode`, `percentile`, `distinct`, `fingerprint`). | Usa una de ellas; el mensaje las lista. |
| `INVALID_AGGREGATE_GROUP` | 400 | Una transformación de `groupBy` es desconocida o no se aplica a su columna: `year`/`month`/`day` en una columna que no es fecha, o `unnest` en una que no es array. | Usa `lower`, `upper`, `year`, `month`, `day` o `unnest` en una columna del tipo adecuado. |
| `INVALID_AGGREGATE_SELECT` | 400 | Una entrada de `?select=` no tiene el formato `fn(field)`; una función distinta de `count()` o `fingerprint()` no recibió ningún campo; `percentile` no tiene una fracción entre 0 y 1; o se solicitó `fingerprint()` en una vista simple, que no almacena filas. | Escribe `sum(total)`, `count()`, `percentile(price,0.95)`. |
| `INVALID_AGGREGATE_WINDOW` | 400 | Se usó `offset`, `page` u `orderBy` en un agregado sin `groupBy`, o un cursor en cualquier agregado. Un agregado no agrupado es una sola fila, y un grupo no es una fila después de la cual un cursor pueda continuar. | Añade `groupBy` o elimínalos; pagina los grupos con `offset` o `page`. Consulta [Agregaciones](/docs/sdk/aggregates-and-search/#aggregates). |
| `INVALID_BATCH_BODY` | 400 | Una operación de `/_batch` carece de `op`, `table`, `values` o `id`, nombra una tabla que este backend no proporciona o reutiliza un nombre de `ref`. | Consulta el mensaje; indica la operación por su índice. |
| `INVALID_BATCH_REF` | 400 | Un `{ "$ref": "<name>.<field>" }` no apunta a ninguna operación previa, apunta hacia adelante o solicita un campo que la fila referenciada no contiene. Solo se resuelven referencias hacia atrás. | Nombra la operación con `ref` *antes* de referenciarla. |
| `INVALID_BULK_BODY` | 400 | El cuerpo de la solicitud masiva no tiene el formato esperado. | Envía el array que espera la ruta: `{ "rows": [...] }` para `POST /bulk`, `{ "updates": [{ "id", "data" }] }` para `PATCH /bulk`, `{ "ids": [...] }` para `POST /bulk/delete`. |
| `INVALID_CONFLICT_RULE` | 400 | La regla de conflicto de un upsert (mantener duplicados o reemplazar solo ante un `where`) se envió sin `upsert: true`, o se enviaron ambas reglas simultáneamente. | Envía `upsert: true` y una de las dos. |
| `INVALID_CONFLICT_TARGET` | 400 | El `on_conflict` / `onConflict` de un upsert especifica columnas sin garantía de unicidad, las nombra sin `upsert: true`, o se envía en una creación anidada, donde una fila coincidente se movería bajo el nuevo padre. De lo contrario, Postgres respondería 42P10 desde dentro de una transacción que ya ha realizado operaciones. También ocurre con cualquier upsert en la tabla de autenticación, donde crear y actualizar siguen reglas distintas. | Declara `.unique()` en la columna o un índice `unique`; el mensaje lista los destinos válidos. En la tabla de usuarios, envía un `POST` para crear y un `PATCH` para actualizar. |
| `INVALID_COUNT` | 400 | `?count=` no es `exact` ni `none`. Se rechaza en lugar de tomar el valor por defecto: un error tipográfico como `?count=nnone` pagaría el coste del recuento que se pretendía omitir. | Envía `exact` (el valor por defecto) o `none`. Consulta [Omitir el recuento](/docs/backend/api/#skipping-the-count). |
| `INVALID_CURSOR` | 400 | El cursor `after` no se puede leer o nombra un ID de fila que no se ajusta a las columnas clave de la tabla: fue truncado, recodificado o construido manualmente. Un cursor legible enviado con un `orderBy` distinto de aquel con el que fue emitido genera `CURSOR_ORDER_MISMATCH`, también un 400. | Devuelve `meta.nextCursor` de la página anterior sin cambios, con el mismo `orderBy` o ninguno. Consulta [Paginación](/docs/sdk/pagination/). |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` no es `include` ni `only`. Se rechaza en lugar de ignorarse: un error como `?deleted=true` que ocultara silenciosamente las filas eliminadas parecería haber funcionado pero respondería lo contrario. | Envía `include` (activas y eliminadas) u `only` (solo eliminadas). Omítelo para recibir solo filas activas. |
| `INVALID_DISTINCT` | 400 | `?distinct=` no es `true` ni `false`. | Envía uno de ellos; también se aceptan `1` y `0`. |
| `INVALID_FIELD_OPERATION` | 400 | Se utilizó `$inc` / `$push` / `$pull` / `$merge` en un tipo de columna en el que no está definido, con un operando de tipo incorrecto, con dos operadores en el mismo campo, mal escrito o en una creación (donde no hay ningún valor almacenado sobre el que operar). | Consulta [Escritura mediante REST](/docs/backend/writes/#field-operations); el mensaje especifica el campo. |
| `INVALID_FILTERED_WRITE` | 400 | Una escritura filtrada apuntó a una ruta a través de una relación (`posts/1/comments`) o a ninguna tabla. | Escribe en la tabla relacionada aplicando un filtro en su enlace. |
| `INVALID_FILTER_FIELD` | 400 | El filtro nombra una columna que esta tabla no tiene. | Revisa la ortografía cotejándola con la tabla. |
| `INVALID_FILTER_OPERATOR` | 400 | El operador no es compatible con este tipo de columna; por ejemplo, `like` en un número o fecha. | Consulta [Consulta de datos](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | Un valor de filtro no se puede interpretar como el tipo de la columna con la que se comparó: `?id=eq.abc` en una clave entera, un valor que no está en el enum, una marca de tiempo inválida, un número fuera de rango. `details.dbCode` contiene el SQLSTATE. | Envía un valor del tipo correspondiente a la columna. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` no es `true` ni `false`. Cualquier otro valor se rechaza en lugar de asumirse como "no": un error tipográfico que aplique borrado suave cuando se solicitó purga definitiva haría creer al emisor que los datos se han eliminado para siempre. | Envía `true` o `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` está malformado: no es una lista válida de rutas, o es un objeto de opciones por relación con una estructura incorrecta. Una ruta anidada más allá de tres saltos genera `INCLUDE_TOO_DEEP`, también un 400. Se intercepta en el límite en lugar de propagarse fuera del driver como un 500. | Consulta el mensaje; indica la ruta infractora. |
| `INVALID_INPUT` | 400 | El cuerpo de la solicitud no superó la validación. | Consulta el mensaje. |
| `INVALID_LIMIT` | 400 | `?limit=` no es un número entero entre 1 y el máximo permitido (1000 por defecto); uno superior se rechaza, no se recorta. Una suscripción en tiempo real que pida un límite fuera de ese rango recibe este mismo código en un frame `ERROR` de WebSocket. | Reduce el límite y pagina los resultados restantes. |
| `INVALID_LOGICAL_GROUP` | 400 | Un grupo `?or=` / `?and=` / `?not=` está malformado o anidado más allá de la profundidad permitida. | Consulta el mensaje; muestra la regla de aplanamiento. |
| `INVALID_OFFSET` | 400 | `?offset=` no es un número entero igual o mayor que 0. | Envía un número entero no negativo. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` no es `field`, `field:desc`, `field:desc:last`, ni un array JSON de `{ field, direction, nulls }` — o especifica una dirección distinta de `asc`/`desc`, o una posición de NULL distinta de `first`/`last`. | Consulta el mensaje; muestra todas las sintaxis válidas. |
| `INVALID_PAGE` | 400 | `?page=` no es un número entero igual o mayor que 1. Las páginas empiezan en 1, por lo que `?page=0` se considera un error en lugar de la primera página. | Envía `1` o superior, o utiliza `?offset=`. |
| `INVALID_PARAM` | 400 | Un parámetro de consulta está malformado. | Consulta el mensaje. |
| `INVALID_QUERY_BODY` | 400 | El cuerpo de un `POST …/query` contiene un valor que la URL no habría podido admitir: una lista para un parámetro que la URL lee una sola vez (`fields`, `limit`, …), un objeto para un filtro, o cualquier parámetro repetido también en la URL (un `POST …/query` lee todos los parámetros desde el cuerpo). | Escribe cada valor como lo hace la URL: una cadena, o una lista para un filtro repetido; `where`, `include`, `orderBy` y `vector` aceptan JSON. Consulta [Consultas demasiado largas para una URL](/docs/backend/vector-search/#queries-too-long-for-a-url). |
| `INVALID_VECTOR` | 400 | `?vector=` no es un array JSON de números. | Envía `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` no es `cosine`, `l2` ni `inner_product`. | Utiliza uno de esos tres. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` no es un número. | Envía un número. |
| `INVALID_WHERE` | 400 | `?where=` no es un objeto JSON que asocie campos con condiciones. | Envía `{"status":["==","active"]}`. |
| `KEY_IMMUTABLE` | 400 | Una actualización define la clave de la fila con un valor distinto de aquel con el que fue direccionada: en el cuerpo o escrita por un `beforeSave`. Una fila no puede cambiar de clave: todo lo posterior a la escritura (la relectura, `afterSave`, el historial, el tiempo real) la busca por la clave previa. Se rechaza antes de ejecutar ningún hook, sin escribir nada, en todas las vías de acceso. `details.violations` nombra el campo. | Crea la fila con la nueva clave y elimina la actual. Enviar la clave que la fila ya tiene está permitido. |
| `MISSING_AGGREGATE_SELECT` | 400 | Se llamó a la ruta de agregación sin ningún `?select=`. | Añade uno, p. ej. `?select=count()`. |
| `NOT_A_MATERIALIZED_VIEW` | 400 | Se llamó a `refresh()` en una tabla que no proporciona una vista materializada. | Refresca únicamente vistas definidas con `defineView(…, { materialized: true })`. |
| `NO_TABLES` | 404 | <span class="since-badge" data-since="0.31">Desde 0.31</span> El proyecto no sirve ninguna tabla: ninguna declarada en `backend/schema` y ninguna en la base de datos para introspeccionar. Cuando existen tablas pero la seguridad a nivel de fila está desactivada en ellas, el mensaje las nombra junto con el SQL para activarla, y `details.unprotectedTables` las enumera. Antes era `NO_COLLECTIONS`. | Crea tablas (una migración, SQL, o un archivo `defineTable` más `rebase db push`) y reinicia. |
| `NOT_FOUND` | 404 | No existe ninguna fila con ese ID en esa tabla, o bien la seguridad a nivel de fila la oculta a este emisor. | Comprueba el ID y luego el `rls` de la tabla. |
| `UNKNOWN_RELATION` | 400 / 404 | `?include=` nombra algo que no es una relación en la tabla. El mismo código responde **404** cuando una *ruta de URL* anidada nombra una inexistente, p. ej. `/api/data/authors/1/posts` donde `authors` no declara ninguna (allí la URL no apunta a nada, por lo que se considera un "no encontrado" en vez de una solicitud malformada). | Comprueba el nombre de la relación; el mensaje lista las que posee la tabla. Una referencia inversa debe declararse en el padre para ser navegable. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | La ordenación especifica un campo que no admite ordenación. | Ordena por una columna válida. |
| `PAGE_WITH_OFFSET` | 400 | Se combinó `?page=` con `?offset=`, o `page` con `offset` en un `find()`, lo cual es rechazado con el mismo código por el SDK de cliente, el `rebase.data` interno y el cliente offline antes de enviar cualquier solicitud. Ambos describen la misma ventana, y antes `page` se imponía silenciosamente sobre un `offset` que nunca llegaba a aplicarse. | Envía solo uno de ellos. |
| `PAYLOAD_TOO_LARGE` | 413 | El cuerpo supera el límite configurado. | Envía menos datos o aumenta el límite. |
| `READ_ONLY_TRANSACTION` | 409 | Un hook `afterRead` intentó realizar una escritura. Una lectura acotada a una solicitud se ejecuta en una transacción `READ ONLY`, por lo que ni el hook ni nada de lo que llame puede escribir. | Mueve la escritura fuera de la lectura: usa una tarea en segundo plano, o `rebase.dataAsAdmin` desde una tarea cron o una función personalizada. |
| `REFRESH_NOT_SUPPORTED` | 501 | `POST /api/data/<slug>/refresh` alcanzó un driver de datos sin vistas materializadas. | No hay nada que refrescar en este backend. |
| `RELATION_HAS_NO_PIVOT` | 400 | La escritura contenía una carga de enlace, pero la ruta no llega a su destino mediante una relación `manyToMany` que declare un `pivot`, por lo que no existe una fila de unión donde almacenarla. | Declara columnas `pivot` en la relación o elimina la carga útil de la escritura. Consulta [Relaciones](/docs/collections/relations/). |
| `RELATION_MISCONFIGURED` | 500 | Una relación no se resuelve contra el esquema registrado. La operación se rechaza en lugar de ignorarse: descartarla reportaría éxito para una escritura que nunca sucedió, o un vacío para filas existentes. | Ejecuta `rebase schema generate` si el esquema generado es más antiguo que la base de datos. |
| `RELATION_NOT_UNLINKABLE` | 400 | La relación no se puede desvincular desde este extremo. | Escribe desde el lado propietario. |
| `RELATION_NOT_WRITABLE` | 400 | La ruta anidada no es una relación modificable, o bien una creación o actualización nombra una relación `via` de múltiples saltos (solo las relaciones `via` de un solo salto son modificables). `details.fields` enumera las claves `via`. No se escribió nada. | Escribe directamente las filas que une la cadena. Consulta [Relaciones](/docs/collections/relations/#via--an-explicit-join-chain). |
| `RELATION_PIVOT_UNSUPPORTED` | 400 | La relación declara columnas de unión, pero este origen de datos no permite escribirlas. | El enlace en sí sigue funcionando; solo falla la carga útil asignada a él. Revisa las capacidades del driver. |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Una escritura de relación no tenía clave de origen sobre la cual vincular el enlace. | Guarda primero la fila padre. |
| `RESULT_TOO_LARGE` | — | Una sentencia enviada a través de `EXECUTE_SQL` en el socket en tiempo real (`admin.executeSql` desde un cliente, lecturas del catálogo del panel de control) devolvió más de 128 MB de filas, por lo que no se envió nada. Se emite como un frame `ERROR` de WebSocket. Las ejecuciones directas desde la consola SQL no se rechazan: muestran las primeras filas. | Añade un `LIMIT` o selecciona menos columnas, y lee el resultado por partes. |
| `ROW_IN_TRASH` | 409 | La clave de un upsert pertenece a una fila en la papelera (una fila con borrado suave sigue reteniendo su clave). Un upsert no escribe en una fila eliminada, en ninguna vía de acceso: `?on_conflict=` en REST, upserts en `/bulk` y `/_batch`, el SDK y el socket en tiempo real. No se escribió nada. | Restaura la fila primero (una actualización asignando `null` al campo de borrado suave) o purga con `?hard=true` y vuelve a realizar el upsert. Consulta [Borrado suave (Soft delete)](/docs/collections/soft-delete/). |
| `SCHEMA_DRIFT` | 500 | Una tabla o columna esperada por el código no existe en la base de datos. | Ejecuta `rebase db push` en desarrollo; vuelve a desplegar en un entorno administrado. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | Se combinó `startAfter` con `orderBy: "_score"`. La relevancia se calcula por consulta en lugar de almacenarse, por lo que no puede actuar como clave de cursor. | Pagina la relevancia con `limit`/`offset`, o bien ordena por una columna. |
| `SQL_ERROR` | 400 | La base de datos rechazó el SQL escrito por un usuario. En `EXECUTE_SQL` del socket en tiempo real se traduce en un frame `ERROR` con el mensaje de la base de datos. `POST /api/admin/sql/csv` responde con esto antes de enviar parte alguna del archivo: un error de sintaxis, una escritura (la descarga se ejecuta en modo de solo lectura), más de una sentencia o un rol que la conexión no puede asumir. | Corrige el SQL. Una descarga requiere un único `SELECT`, `WITH … SELECT`, `TABLE` o `VALUES`. |
| `VIEW_NOT_READABLE` | 403 | Un emisor que no posee ninguno de los `view.roles` de una vista materializada intentó leerla o refrescarla. Una vista materializada no cuenta con seguridad a nivel de fila, por lo que se entrega íntegra y exclusivamente a dichos roles. | Léela usando uno de esos roles, o declara el rol del emisor en `view.roles`. |
| `TENANT_IMMUTABLE` | 400 | Una escritura movería una fila de un tenant a otro. Una fila no puede cambiar de tenant. `details.violations` nombra el campo. Un trigger aplica la misma regla en la base de datos, por lo que el SQL ejecutado como el emisor falla con el error Postgres `42501` y un mensaje que comienza con `TENANT_IMMUTABLE`. | Crea la fila en el otro tenant y elimina esta, o escribe usando un rol en `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | La escritura especifica un tenant al cual este emisor no pertenece; la base de datos también la rechazaría. | Escribe en un tenant al cual pertenezca el emisor, o autentícate con uno que pertenezca a él. |
| `TENANT_REQUIRED` | 400 | La tabla está delimitada por tenant y el tenant no se puede deducir: la solicitud no incluye ninguno o el emisor pertenece a varios. | Envía el campo tenant explícitamente, o autentícate como un emisor que pertenezca exactamente a uno. |
| `TRANSACTION_ABORTED` | 500 | Falló una sentencia en la transacción de escritura y un hook capturó el error. Postgres ya había abortado la transacción, por lo que la escritura se revirtió por completo y nada se guardó. Solo las creaciones, actualizaciones o eliminaciones mediante `context.data` rechazadas por la base de datos se deshacen por sí solas y pueden capturarse con seguridad. | Deja que el fallo lance la excepción o valida antes de ejecutar la sentencia. Consulta [Semántica de transacciones](/docs/collections/context-data-api/#transaction-semantics). |
| `UNKNOWN_FIELD` | 400 | `?fields=` nombra un campo que la tabla no posee. | Comprueba la ortografía; el mensaje lista los campos válidos. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Un agregado o `groupBy` nombra un campo que la tabla no posee. | Comprueba la ortografía; el mensaje lista los campos válidos. |
| `UNKNOWN_FILTER_FIELD` | 400 | El filtro nombra un campo que esta tabla (o el destino de una relación) no posee, o una columna `.private()`. | Comprueba la ortografía; el mensaje lista los campos válidos. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | El filtro especifica un operador inexistente. | El mensaje enumera todos los operadores válidos. |
| `UNKNOWN_MESSAGE_TYPE` | 400 | Un frame del socket en tiempo real tiene un `type` que el servidor no procesa. Se responde como un frame `ERROR` con el `requestId` de la solicitud, para que la solicitud finalice en lugar de expirar por timeout. | Revisa el `type` del frame; el mensaje indica cuál fue recibido. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | La ordenación especifica un campo que esta tabla no posee. | Comprueba la ortografía; el mensaje lista los campos válidos. |
| `PRECONDITION_FAILED` | 412 | Un `If-Match` especificó una versión de la fila que ya no es la actual: alguien escribió en ella entre la lectura y esta escritura. No se guardó nada. | Vuelve a leer la fila, aplica el cambio de nuevo y envía el nuevo `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` solicita un campo que la tabla no posee. | Comprueba la ortografía; el mensaje lista los campos conocidos. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Una búsqueda vectorial nombró una columna que no es `col.vector()` en esta tabla. | El mensaje enumera las columnas vectoriales de la tabla. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | El `Content-Type` no es admitido por esta ruta. | Envía el tipo documentado para la ruta. |
| `UNSUPPORTED_OPTION` | — | Se lanza como excepción, no se responde: una escritura a través del descriptor de acceso en proceso (`context.data` en un hook, `rebase.data` en una función o tarea cron) recibió `ifMatch` o `idempotencyKey`. Dicha vía carece de comprobación de precondiciones o almacén de idempotencia, por lo que la opción se rechaza antes de escribir nada en lugar de ignorarse. | Elimina la opción allí, o realiza la escritura mediante el cliente HTTP, que sí soporta ambas. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | El filtro atraviesa una relación `via`, cuya ruta de unión está definida en un solo sentido, por lo que no hay forma de correlacionar una subconsulta de retorno. | Filtra desde el lado propietario. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | El operador no está definido para ese campo: una relación sin columna física en esta fila se filtra por pertenencia, y la coincidencia de patrones (`like`, `ilike` y sus negaciones) solo aplica a texto. | Consulta el mensaje; lista lo que admite el campo. |
| `VALIDATION_CONSTRAINT` | 400 | Un valor infringió una regla declarada por la columna (`.validate()`, `.notNull()`, `.oneOf()`): longitud, rango, patrón, campo obligatorio o un valor fuera de la lista. Cada entrada de `details.violations` incluye un `code`: `required`, `min_length`, `max_length`, `length`, `min`, `max`, `less_than`, `more_than`, `positive`, `negative`, `integer`, `pattern`, `email`, `url`, `enum`, `min_items`, `max_items`, `unique_items` (un array contiene el mismo elemento duplicado, incluido `$push`), `unique_by` (dos elementos de un array JSON comparten un valor en un campo indicado por `uniqueBy`), `date_min`, `date_max`, `geopoint_range`. | Consulta el mensaje; especifica la tabla, la columna y cada infracción. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | El cuerpo escribe en una columna marcada como `.private()` o `.access({ write: [] })` (la misma regla con distinta sintaxis). Dichas columnas son reservadas del servidor: un hash de contraseña, un token de verificación. A diferencia de `FIELD_NOT_WRITABLE`, esta es la misma respuesta para cualquier emisor, incluido `admin`. | Elimina el campo. Consulta [Acceso a campos](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Un valor no encaja con el tipo de su columna. | Consulta el mensaje; nombra la columna. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | El cuerpo nombra un campo que la tabla no posee, incluido un argumento `id` en una tabla con clave primaria diferente. | Comprueba la ortografía; el mensaje ("Table 'x' has no column 'f'. Known columns: …") enumera las columnas. |
| `VECTOR_CURSOR_UNSUPPORTED` | 400 | Se combinó un cursor (`after` / `startAfter`) con una búsqueda vectorial. Las filas se ordenan según una distancia calculada por consulta que no puede servir de clave de cursor, por lo que un listado vectorial no incluye `nextCursor`. | Pagina las filas más cercanas con `limit`/`offset`. |
| `WRITE_DENIED` | 403 | Una regla de seguridad o política de seguridad a nivel de fila rechazó la escritura. | Comprueba el `rls` de la tabla. |

## `PG_<SQLSTATE>` — una restricción que la base de datos rechazó

Una escritura que Postgres rechaza por un motivo atribuible a *los datos del emisor* responde
con el SQLSTATE en el código: `PG_23505`, `PG_23503`, etc. Se trata de una
familia, no de una lista estática (Postgres define cientos de SQLSTATEs), pero solo dos
clases llegan a producirse, pues solo esas dos son culpa del emisor:

- **clase 23**, infracción de restricción de integridad: un duplicado, una clave foránea que
  apunta a la nada, una columna NOT NULL que se dejó vacía;
- **clase 22**, excepción de datos: un valor que el tipo de la columna no puede almacenar.

Cualquier otra cosa (una conexión caída, una columna faltante, un problema de privilegios)
es responsabilidad del servidor y permanece como un `500`. Por lo tanto, `code.startsWith("PG_")` es una comprobación
segura para identificar que "la fila enviada era errónea", y las cuatro siguientes son las que un cliente
encuentra en la práctica. `details.dbCode` contiene el mismo SQLSTATE para todas ellas, y
el mensaje indica la restricción específica.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | Un valor no pudo interpretarse como el tipo de la columna: la contraparte de escritura de `INVALID_FILTER_VALUE`. | Envía un valor del tipo de la columna. |
| `PG_23502` | 400 | Se dejó vacía una columna `NOT NULL`. | Envía el campo o asigna un valor por defecto a la columna. |
| `PG_23503` | 400 / 409 | Al guardar, una clave foránea apunta a una fila inexistente (400). Al eliminar, otras filas todavía referencian a esta (409; una clave con `RESTRICT` produce `PG_23001`, también 409). | Crea la fila de destino primero o corrige el ID; para una eliminación, borra o reasigna antes las filas que la referencian. |
| `PG_23505` | 409 | Se violó una restricción de unicidad (unique constraint). El mensaje especifica la restricción. | Usa un valor diferente o actualiza la fila existente. |

## Almacenamiento

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `INVALID_LIST_OPTIONS` | 400 | El `maxResults` de un listado de almacenamiento no es un entero de al menos 1, o su `pageToken` no fue emitido por la fuente. Un tamaño de página inferior a uno solía devolver una página vacía con el mismo token, provocando un bucle infinito en `while (pageToken)`. | Envía un `maxResults` positivo y devuelve `nextPageToken` sin modificar. |
| `INVALID_STORAGE_BUCKET` | 400 | El nombre del bucket está malformado. | Comprueba el nombre. |
| `INVALID_STORAGE_KEY` | 400 | La clave del objeto está malformada, escapa de su prefijo o se encuentra bajo un prefijo reservado (`_rebase/renditions/`, `_rebase/maintenance/`). | Comprueba la clave. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | Los parámetros de transformación de imagen están fuera de rango o son contradictorios. | Consulta [Almacenamiento](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | El archivo subido supera los `maxBytes` declarados en la columna `col.storage()` de destino. Se valida en el servidor, no solo en el navegador. `details` contiene la columna, el límite y el tamaño real. | Sube un archivo más pequeño o aumenta `maxBytes` en la columna. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | El tipo de archivo subido no está en la lista `accept` de la columna ni en el `allowedMimeTypes` de la fuente de almacenamiento. `details` contiene la columna (o la lista de la fuente), la lista admitida y el tipo de contenido enviado. | Sube un tipo admitido o amplía `accept` / `allowedMimeTypes`. |
| `STORAGE_MISCONFIGURED` | 502 | El bucket S3 o GCS con el que está configurada esta fuente no existe, o el proveedor rechazó las credenciales de este despliegue para acceder a él. El mensaje nombra el bucket; `details.reason` es `NoSuchBucket` o el rechazo del proveedor. Un bucket no encontrado solía interpretarse como "archivo no encontrado" para cualquier archivo. | Corrige el nombre del bucket (`S3_BUCKET` / `GCS_BUCKET`, `__<KEY>` para una fuente nombrada) o los permisos de las credenciales. |
| `STORAGE_NOT_CONFIGURED` | 501 / 503 | No hay ningún backend de almacenamiento configurado en este servidor, o ninguno es el predeterminado y la solicitud no especifica fuente; el mensaje nombra las fuentes disponibles (501). Una subida reanudable cuya fuente desapareció antes de completarse devuelve 503. | Configura S3, GCS o almacenamiento local, o nombra una fuente con `?storageId=`. |
| `STORAGE_SAME_LOCATION` | 400 | `POST /api/admin/storage/move` con `deleteSource` (`rebase storage move --delete-source`) entre dos fuentes que apuntan al mismo bucket o directorio. Cada archivo contaría como ya presente en el destino por ser el mismo archivo, y eliminar la copia de la fuente borraría el único ejemplar existente. No se movió ni eliminó nada. | Apunta la columna a la otra fuente; sus archivos ya están allí. |
| `STORAGE_SCAN_INCOMPLETE` | 409 | `DELETE /api/admin/storage/orphans` (`rebase storage orphans --delete`) no pudo leer todas las tablas, por lo que un archivo nombrado por alguna de ellas parecería huérfano. Con `?scan=`, el escaneo indicado es el que no pudo leer todas las tablas. No se eliminó nada; `details.unscanned` indica cada tabla y por qué no se pudo leer. | Soluciona lo que impide leer esas tablas y vuelve a ejecutarlo. |
| `STORAGE_SCAN_NOT_FOUND` | 404 | `GET /api/admin/storage/orphans/scans/:id` o `DELETE /api/admin/storage/orphans?scan=:id` especifica un escaneo que la fuente no posee. Los escaneos se guardan durante 7 días en la fuente analizada, por lo que un `storageId` diferente al del escaneo tampoco encontrará nada. | Pasa el `storageId` del escaneo o inicia otro escaneo. |
| `STORAGE_SCAN_NOT_COMPLETE` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` hace referencia a un escaneo que aún está en estado `queued` o `running`, o que ha fallado (`failed`). No se borró nada; `details.status` indica el estado. | Espera a que el escaneo finalice o inicia otro. |
| `STORAGE_SCAN_EXPIRED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` nombra un escaneo completado hace más de 15 minutos. No se eliminó nada. | Inicia otro escaneo y realiza la eliminación a partir de él. |
| `STORAGE_SCAN_DELETION_STARTED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` nombra un escaneo cuyos huérfanos ya se están eliminando. | Consulta el estado `deletion` del escaneo mediante `GET /api/admin/storage/orphans/scans/:id`. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | La fuente de almacenamiento está declarada pero no tiene credenciales en este entorno. | Configura las variables de entorno de dicha fuente. |
| `STORAGE_WRITE_FAILED` | 502 | El backend de almacenamiento rechazó o interrumpió la escritura. | Revisa sus propios registros y credenciales. |
| `TRANSFORM_OVERLOADED` | 503 | Demasiadas transformaciones de imagen en ejecución simultánea. | Reintenta; considera colocar una CDN por delante. |
| `UNKNOWN_STORAGE_SOURCE` | 400 / 404 | La solicitud especificó una fuente de almacenamiento (`?storageId=`) que este proyecto no declara. Un `bucket` que este despliegue no sirve devuelve este mismo código con estado **404** (en un listado, subida, carpeta o subida reanudable a S3 o GCS): lo que falta es el almacenamiento, y `details` lista los buckets y fuentes que sí existen. Ambos solían responder "archivo no encontrado", idéntico a una clave que simplemente no existe. | Declara la fuente en `config/resources.ts`, o consulta `GET /api/storage/sources`. |
| `UPLOAD_LOCKED` | 423 | Llegó un `PATCH` de una subida reanudable mientras aún se recibía otro fragmento de la misma subida; casi siempre ocurre porque el cliente reintenta el fragmento en curso. Se rechaza en lugar de ponerse en cola, tal como hace tusd. | Consulta el desplazamiento mediante `HEAD /api/storage/tus/:id` y reanuda desde allí; tus-js-client gestiona las esperas y reintentos de forma autónoma. Consulta [Subidas reanudables (TUS)](/docs/backend/storage-resumable-uploads/). |

## Funciones personalizadas

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | No se proporciona ninguna función con ese nombre, o bien existe una pero sus rutas internas no cubren la ruta posterior. A un emisor autenticado también se le informa de lo que *sí* se sirve; a uno anónimo no, porque esa lista constituye un inventario de todos los endpoints personalizados. Cuando un archivo con ese nombre no pudo cargarse, el mensaje se lo indica al emisor autenticado especificando el archivo: esa es la diferencia entre un error tipográfico y un despliegue roto. Un emisor anónimo recibe la respuesta genérica de nombre desconocido, igual que para un nombre que no coincide con nada. | Compara el nombre con `GET /api/functions`, o revisa el registro de arranque en busca de un archivo que no se haya cargado. |
| `FUNCTION_TIMEOUT` | 504 | El controlador superó su tiempo de espera (timeout). Sigue ejecutándose; no se puede cancelar desde aquí. | Pasa un `AbortSignal` a las llamadas salientes o aumenta `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Este proceso actúa como proxy de funciones hacia otro que no respondió. | Verifica que la unidad de funciones esté en ejecución. |

## Tareas cron

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `CRON_JOB_ALREADY_EXECUTING` | 409 | Ejecución manual de una tarea cron que ya se encuentra en ejecución: en el proceso que respondió o en otro que mantiene el lease de ejecución de la tarea, como el worker detrás de un proceso `api`. No se ejecutó nada. La omisión queda registrada en el historial de la tarea y `details.log` corresponde a esa entrada; su línea indica el proceso que la está ejecutando. | Inténtalo de nuevo cuando termine esa ejecución. Consulta [Tareas cron](/docs/backend/cron-across-instances/#concurrency-guarding). |

## Superficies de administración y edición de esquemas

Estos códigos indican que una característica está desactivada o sin configurar, no necesariamente
que la solicitud fuera errónea. Cada uno también se reporta en la ruta `/status`
correspondiente con un `200`, permitiendo al panel deshabilitar la opción visualmente en lugar de mostrar un error.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | Se invocó una superficie exclusiva de administración en un servidor sin autenticación configurada, por lo que no es posible distinguir a un administrador de un desconocido. | Configura `auth.jwtSecret` o pasa un `AuthAdapter`. |
| `BRANCH_DIFF_STALE` | 409 | Se envió a `POST /api/admin/branches/:name/merge` la huella digital (fingerprint) de un diff que ya no es válido: la rama o su padre cambiaron entretanto. No se escribió nada. | Lee el diff nuevamente, revísalo y fusiona usando su nuevo `fingerprint`. |
| `BRANCH_DIFF_UNSUPPORTED` | 501 | La fuente de datos no puede comparar ramas: no tiene SQL o carece de soporte de ramas (sin conexión de administración). | Usa un backend Postgres con `adminConnectionString` configurado. |
| `BRANCH_MERGE_BLOCKED` | 409 | Una tabla con diferencias no se puede fusionar: añadida o eliminada por la rama, columnas o clave primaria dispares, sin clave primaria, demasiadas filas para comparar o reescrita desde la creación de la rama (`TABLE_REWRITTEN`). Una tabla cuyas filas no pudieron ser comparadas bloquea la operación incluso si sus conteos indican 0: son desconocidos, no cero. `details.tables` lista cada una con el motivo. No se escribió nada. | Aplica primero el esquema con tus migraciones, o fusiona con `skipBlocked: true` para ignorar esas tablas. |
| `BRANCH_MERGE_CONFLICT` | 409 | Se modificaron filas tanto en la rama como en su padre, y `onConflict` era `"abort"` (el valor por defecto); o bien el padre rechazó parte de la fusión (una fila cambió entretanto, un trigger la omitió, una política la ocultó). No se escribió nada. | Elige qué lado prevalece con `onConflict: "branch"` o `"target"`, o lee el diff de nuevo. |
| `BRANCH_MERGE_FAILED` | 409 | El padre rechazó las filas de la rama dentro de la sentencia de fusión: una restricción, una etiqueta de enum o una clave foránea presente en él que las filas de la rama rompen, generalmente porque ambos esquemas difieren. `details` contiene `sqlState`, `table`, `constraint` y `detail`. No se escribió nada. | Revisa los cambios de esquema del diff, sincroniza el esquema del padre con tus migraciones o corrige las filas de la rama, y vuelve a fusionar. |
| `BRANCH_NOT_FOUND` | 404 | Ninguna rama tiene ese nombre en el registro. | `rebase db branch list`, o el panel de Ramas, muestra las existentes. |
| `CONTRACT_UNAVAILABLE` | 404 | El contrato del proyecto solo se sirve cuando la autenticación está configurada (describe cada tabla y relación). | Configura la autenticación. `/meta/schema-version` siempre se sirve. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | No hay ningún buzón de desarrollo activo. Los correos solo se capturan cuando `SMTP_HOST` no está configurado y `NODE_ENV` no es producción. | Desasigna `SMTP_HOST` en desarrollo o revisa la bandeja de entrada real. |
| `DOCS_UNAVAILABLE` | 404 | <span class="since-badge" data-since="0.31">Desde 0.31</span> `GET /api/docs` se sirve a los mismos emisores a los que `GET /api/schema/tables` describe las tablas, y este servidor no tiene autenticación configurada, por lo que no hay a quién describírselas. | Configura autenticación o publica el documento completo para todos con `enableSwagger: true` (`REBASE_ENABLE_SWAGGER=true`). |
| `INVALID_CHANGE` | 400 | El cambio de esquema propuesto no está bien formado. | Consulta el mensaje. |
| `SCHEMA_CHANGE_FAILED` | 400 | La aplicación de un cambio de esquema planificado falló por un motivo no cubierto por códigos más específicos. | Consulta el mensaje; refleja textualmente el fallo subyacente. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | El cambio es válido pero no puede aplicarse al esquema en su estado actual. | Consulta el mensaje. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | El repositorio tiene cambios sin confirmar (uncommitted changes), por lo que la edición no pudo aplicarse de forma segura. | Haz commit o stash y luego reintenta. |
| `SCHEMA_EDIT_REFUSED` | 400 | El editor de esquemas rechazó la edición: lo que modificaría está escrito en código que no reescribe (un spread, un helper, una clave calculada), o es una edición que nunca realiza (renombrar una tabla, eliminar la última regla). `details.problems` enumera cada una. No se escribió nada. | Consulta el mensaje. Realiza el cambio manualmente en `backend/schema`. |
| `SCHEMA_EDIT_DOES_NOT_COMPILE` | 400 | <span class="since-badge" data-since="0.31">Desde 0.31</span> La edición puede realizarse, pero el esquema resultante no compilaría: una relación hacia una tabla que se elimina, una regla que nombra una columna borrada. `details.problems` contiene los diagnósticos del compilador, cada uno con su tabla y columna. No se escribió nada. | Modifica primero las tablas de las que depende, o haz el cambio en `backend/schema` manualmente. |
| `SCHEMA_EDIT_STALE_FILE` | 409 | Un archivo modificado por la edición cambió en disco desde que se preparó (guardado desde un IDE, otro proceso). No se escribió nada. | Recarga y vuelve a preparar la edición sobre el archivo tal como está ahora. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Una API key u otra entidad máquina intentó aplicar un cambio de esquema. | Inicia sesión como usuario o configura `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | La edición de esquema en vivo requiere `schemaDir` (el directorio `backend/schema`) o `liveSchema.repository`, y este servidor se inició sin ninguno de ellos. El código mantiene su nombre anterior. | Configura uno de ellos. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | La planificación funciona, pero no existe un repositorio donde confirmar el cambio: un despliegue que ejecuta un bundle compilado o un servidor cuyo `backend/schema` no está dentro de ningún repositorio git (una aplicación siempre se confirma mediante commit). | Ejecuta `git init` en el proyecto y reinicia el servidor (el repositorio se detecta al arrancar) o configura `liveSchema.repository`. |
| `SCHEMA_EDITING_PROVISIONING_OFF` | 409 | Este despliegue no altera nada en su base de datos (`REBASE_PROVISION=false`), por lo que no es posible aplicar cambios desde el panel. | Confírmalo únicamente como código fuente y deja que el proceso responsable de modificar la base de datos lo aplique. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Este driver no puede planificar cambios de esquema. | La edición en vivo está disponible en Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | Las tablas se introspeccionan desde la base de datos aquí, por lo que no existen archivos fuente que editar. | Modifica el esquema mediante una migración. |
| `SCHEMA_EDITOR_DISABLED` | 501 | El editor de esquemas está desactivado en este servidor. Un bundle compilado siempre responde esto. | Actívalo con `schemaEditor`. En un bundle, define `REBASE_LIVE_SCHEMA_REPOSITORY` para editar `backend/schema` mediante un repositorio; consulta [Edición de esquemas en vivo](/docs/backend/live-schema-editing#from-a-built-bundle). |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | El editor de esquemas requiere `ts-morph`, el cual no está instalado. | Instálalo en el paquete que ejecuta el backend y reinícialo: `pnpm --dir backend add -D ts-morph@28.0.0` desde la raíz de un proyecto estructurado, o `pnpm add -D ts-morph@28.0.0` donde el backend sea el proyecto en sí. El mensaje indica el comando para tu proyecto. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | El servidor carece de `schemaDir`, por lo que el editor no tiene dónde escribir. El código conserva su nombre anterior. | Configura `schemaDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | El editor está desactivado bajo `NODE_ENV=production`: los archivos de un servidor desplegado se reconstruyen a partir de tu repositorio en cada despliegue, por lo que una edición aquí se perdería. | Edita `backend/schema` en desarrollo y despliega, o configura `liveSchema.repository` para confirmar los cambios allí. |
| `SCHEMA_UNAVAILABLE` | 404 | <span class="since-badge" data-since="0.31">Desde 0.31</span> `GET /api/schema/tables` en un backend sin autenticación configurada: no hay ningún emisor para el cual filtrar las tablas, y `auth.requireAuth: false` no modifica esto. | Configura un adaptador de autenticación o `auth.jwtSecret`. Consulta [Endpoints](/docs/backend/endpoints/#schema). |
| `TABLE_NOT_FOUND` | 404 | <span class="since-badge" data-since="0.31">Desde 0.31</span> `GET /api/schema/tables/:slug` especifica una tabla no servida a este emisor: ninguna con ese slug o una a la que los scopes de su credencial no alcanzan. | Comprueba el slug y los scopes `data:*` de la credencial. |
| `UI_PREFERENCES_NEED_A_PERSON` | 403 | <span class="since-badge" data-since="0.31">Desde 0.31</span> `/api/admin/ui-config` fue invocado con una API key, un token de plataforma o la clave de servicio. Las preferencias de interfaz pertenecen a una persona autenticada. | Inicia sesión como usuario. |
| `UI_PREFERENCES_TOO_LARGE` | 413 | <span class="since-badge" data-since="0.31">Desde 0.31</span> Las preferencias de UI de una tabla superan los 64 KB. | Guarda menos datos: las preferencias almacenan presentación, no contenido. |
| `UI_PREFERENCES_UNSUPPORTED` | 501 | <span class="since-badge" data-since="0.31">Desde 0.31</span> El driver de este backend no puede ejecutar SQL, por lo que no guarda preferencias de UI; el panel las conserva en el navegador. | No hay nada que solucionar: las preferencias se mantienen por navegador. |
| `UI_CONFIG_FILE_INVALID` | 500 | <span class="since-badge" data-since="0.31">Desde 0.31</span> `frontend/src/cms/ui-config.json`, donde se guardan las preferencias de UI del espacio de trabajo en desarrollo, no es un JSON válido. | Corrígelo o elimínalo; el panel lo regenerará en el siguiente guardado. |
| `SQL_EXPORT_UNSUPPORTED` | 501 | `POST /api/admin/sql/csv` no puede transmitir un resultado aquí: la base de datos de desarrollo en proceso (PGlite) tiene una sola conexión, y un cursor abierto durante una descarga bloquearía todas las demás consultas; o bien el origen de datos carece de cursor SQL. | Apunta `DATABASE_URL` a un Postgres propio (`rebase dev --docker` inicia uno), o añade un `LIMIT` y exporta las filas en pantalla. |

### Reconciliación de esquemas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

[`rebase schema reconcile`](/docs/cli/schema/#rebase-schema-reconcile) planifica
mediante `POST /api/admin/schema/reconcile/plan` y aplica a través de
`/reconcile/apply`. Un rechazo no altera nada; solo `SCHEMA_RECONCILE_FAILED`
deja parte de un plan aplicado.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `INVALID_RECONCILE` | 400 | El cuerpo no es un objeto JSON, o `drop` no es una lista de cadenas `"<table>.<column>"`. | Envía `{ "drop": ["voice_cache.wav"] }`, o no incluyas `drop`. |
| `SCHEMA_RECONCILE_FAILED` | 400 | Una sentencia falló a mitad del proceso. Las sentencias previas se ejecutaron y permanecen aplicadas; `details.applied` las enumera. | Corrige lo que indica el mensaje y vuelve a planificar: el nuevo plan excluirá lo que ya se ejecutó. |
| `SCHEMA_RECONCILE_INVALID` | 400 | El plan no puede aplicarse y el mensaje explica los motivos: un `drop` que no cumple `<table>.<column>`, no especifica tabla o columna, o nombra una columna que la tabla todavía declara. `details.plan` contiene el plan. | Corrige la lista `drop`. Una columna declarada se descarta eliminándola de su `defineTable`, desplegando y luego reconciliando. |
| `SCHEMA_RECONCILE_STALE` | 409 | La base de datos o las tablas cambiaron desde el plan que confirmaste. `details.plan` es el nuevo plan. | Revisa el nuevo plan y confirma su `digest`. |
| `SCHEMA_RECONCILE_UNCONFIRMED` | 400 | Se envió `/reconcile/apply` sin ningún `confirm`. | Planifica primero y envía el `digest` del plan como `confirm`. La CLI hace esto automáticamente cuando escribes `yes`. |
| `SCHEMA_RECONCILE_UNSUPPORTED` | 503 | El driver de este backend no puede planificar una reconciliación o no puede ejecutar SQL. | La reconciliación funciona en Postgres. |

### Por qué no se puede fusionar la tabla de una rama

`BRANCH_MERGE_BLOCKED` enumera cada tabla rechazada en `details.tables`, junto con uno
de estos códigos. El mismo código aparece en el `blocked` de la tabla dentro del diff,
permitiendo a Studio indicarlo antes de que nadie pulse **Merge**. Ninguno es una respuesta
independiente por sí mismo.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `COLUMNS_DIFFER` | — | Las columnas de la tabla difieren entre la rama y su padre. Las filas se comparan a partir de las columnas compartidas. | Añade las columnas faltantes al padre mediante tus migraciones (`rebase db push`) y luego fusiona. Una migración que reescriba la tabla (como un cambio de tipo de columna) la convertirá en `TABLE_REWRITTEN`: fusiona antes de aplicar dicho cambio, o crea la rama de nuevo tras él. |
| `NO_PRIMARY_KEY` | — | La tabla carece de clave primaria, por lo que las filas no pueden emparejarse una a una; el diff solo muestra su recuento de filas. | Asigna una clave primaria a la tabla o mueve sus filas manualmente. |
| `PRIMARY_KEY_DIFFERS` | — | Las columnas de la clave primaria, o sus tipos, difieren entre ambas. | Aplica primero el esquema al padre. |
| `TABLE_ADDED` | — | La rama creó la tabla. Una fusión nunca crea una tabla. | Créala en el padre mediante tus migraciones y luego fusiona sus filas. |
| `TABLE_DROPPED` | — | La rama eliminó la tabla. Una fusión nunca elimina una tabla. | Elimínala mediante tus migraciones. |
| `TABLE_REWRITTEN` | — | Uno de los lados reescribió todas las filas de la tabla tras crear la rama (un cambio de tipo de columna, un `ADD COLUMN` con valor por defecto volátil, `VACUUM FULL`, `CLUSTER`), por lo que todas las filas figuran como modificadas y ya no se puede determinar qué lado modificó qué fila. | Fusiona la rama antes de dicha migración, o recrea la rama a partir del padre después de aplicarla. |
| `TOO_LARGE` | — | La tabla contiene en uno de los lados más filas de las que un diff puede emparejar individualmente (100.000 por defecto, `maxRowsPerTable`). | Incrementa `maxRowsPerTable` tanto en el diff como en la fusión, o traslada las filas por otro medio. |

## Códigos genéricos

Una ruta recurre a uno de estos códigos cuando no existe ninguno más específico aplicable.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Malformada, y nada más específico es aplicable. | Consulta el mensaje. |
| `UNAUTHORIZED` | 401 | No autenticado, o la credencial fue rechazada. | Inicia sesión o renueva el token. |
| `FORBIDDEN` | 403 | Autenticado, pero sin permisos suficientes. | Reintentar con la misma identidad no ayudará. |
| `CONFLICT` | 409 | Un conflicto con el estado existente. | Consulta el mensaje. |
| `INTERNAL_ERROR` | 500 | Algo falló en el servidor. El mensaje es genérico intencionadamente. | Facilita el `requestId`; la causa se encuentra en los registros. |
| `NOT_CONFIGURED` | 503 | Una dependencia necesaria para esta ruta no está configurada en este servidor. | Consulta el mensaje. |
| `SERVICE_UNAVAILABLE` | 503 | Un servicio del cual depende la solicitud no estuvo accesible: un bucket S3 o MinIO, o un host al que una función hace `fetch()` que rechaza la conexión o no resuelve. El registro del servidor especifica el host; la respuesta no. Una base de datos inalcanzable es `DATABASE_UNAVAILABLE`. Una conexión fallida hacia un servicio similar responde esto. | Reintenta; revisa los registros. |

## Mantener esta página actualizada

`pnpm verify:docs` falla cuando falta en estas tablas algún código que el servidor
pueda emitir, cuando una tabla lista un código que nada puede producir, cuando los estados de una fila no coinciden
exactamente con aquellos con los que el código fuente emite el error, o cuando una familia de códigos como `PG_<SQLSTATE>` carece de una fila
para un SQLSTATE que los clientes puedan recibir. El script correspondiente es
`tooling/scripts/docs-verify/check-error-codes.mjs`.

Se comprueba a sí mismo primero. El escaneo extrae los códigos directamente de TypeScript en lugar de hacerlo
desde un servidor en ejecución, por lo que sus puntos ciegos son silenciosos por diseño: en una ocasión no
pudo detectar un código pasado a través de un wrapper de una sola línea, o uno escrito tras un mensaje
que contenía un `)`, reportando "todos los códigos que el servidor puede emitir están documentados"
en una página a la que le faltaban diecisiete de ellos. Por ello, la verificación ejecuta un fixture con
exactamente esas estructuras antes de leer esta página, y se niega a validar nada si no es
capaz de verlos.
