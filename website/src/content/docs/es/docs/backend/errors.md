---
sourceHash: e4de48ccefd98d19
title: Códigos de error
sidebar_label: Códigos de error
description: Todos los códigos de error que un backend de Rebase puede devolver, con su estado HTTP, su significado y qué hacer al respecto; además del envelope de respuesta, X-Request-ID y las reglas de details.
---

Cada fallo que devuelve un backend de Rebase utiliza un único envelope y contiene un
`code` estable. El código es el elemento sobre el que bifurcar la lógica: el mensaje está escrito para
una persona y puede cambiar de redacción, el estado HTTP es compartido por una docena de
problemas diferentes, y el código no sufre ninguno de estos inconvenientes.

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

- **`message`** — legible por humanos. Para un error `4xx` es el propio mensaje del servidor; para
  un `5xx` es deliberadamente genérico, ya que el texto subyacente puede citar un
  host, un rol o el nombre de una columna.
- **`code`** — uno de los valores listados a continuación. Estable entre versiones menores.
- **`details`** — opcional, y nunca garantizado. Consulta las reglas a continuación.
- **`requestId`** — presente siempre que la solicitud haya pasado por el middleware de
  request-ID, lo cual aplica a cada ruta bajo `basePath`.

### `X-Request-ID`

Cada solicitud bajo `basePath` obtiene un ID: el encabezado `X-Request-ID` del emisor
cuando es un UUID; de lo contrario, uno nuevo. Se devuelve en la
respuesta como `X-Request-ID`, se incluye en el envelope de error como `requestId` y se
adjunta a la línea de log del servidor correspondiente a esa solicitud.

Esa es la clave de unión. Cítala en un informe de errores y un operador podrá encontrar la
única línea de log que explica el fallo, conteniendo el motivo que nunca se mostró
al cliente.

Enviar el tuyo propio permite que una traza sobreviva a un salto: una pasarela (gateway) o un ejecutor de tareas
que reenvíe el encabezado mantiene un único ID en todos los servicios que procesaron la solicitud.
Un valor no válido se ignora en lugar de rechazarse (no vale la pena hacer fallar una solicitud por un
encabezado mal formado por parte del emisor), así que no asumas que el ID que enviaste es
el ID que recibiste. Lee el encabezado de respuesta.

### Qué hay en `details`

`details` es de carácter diagnóstico, no contractual. Se rige por tres reglas:

1. **Cualquier cosa que una ruta defina explícitamente siempre se devuelve.** Estos son los
   propios errores del emisor descritos con precisión: qué campo de filtro era desconocido,
   qué relación no es escribible, qué valor no encajaba con su tipo.
2. **Los diagnósticos de la base de datos se recortan en producción.** Cuando el fallo proviene
   de Postgres, `details.dbCode` (el SQLSTATE) siempre está presente: nombra
   la clase de problema y no revela nada sobre los datos. `dbMessage`,
   `detail` y `hint` solo se añaden cuando `NODE_ENV` no es `production`,
   porque Postgres incluye el contenido de las filas en ellos. `23505` informa
   `Key (email)=(a@b.c) already exists.`, lo que respondería a "¿está esta persona
   registrada?" para cualquier dirección que cualquiera decida probar.
3. **Nunca bifurques tu lógica basándote en `details`.** Hazlo según el `code`. Lo que está bajo `details` es
   cualquier información que resultara útil para una persona en ese punto de llamada, y cambia.

## Interpretar un estado

| Estado | Lo que indica sobre la solicitud |
| --- | --- |
| `400` | Mal formada o solicitando algo que no existe en el esquema. Corrige la solicitud. |
| `401` | No autenticado o la credencial expiró. Inicia sesión o renueva credenciales. |
| `403` | Autenticado, pero no autorizado. Reintentar con la misma identidad no servirá de nada. |
| `404` | No existe dicha ruta, tabla o fila; o bien se trata de una fila que la seguridad a nivel de fila oculta. |
| `409` | Conflicto con el estado existente: un duplicado o una escritura concurrente. |
| `413` `415` `422` | El cuerpo es demasiado grande, el tipo de medio es incorrecto o fue rechazado semánticamente. |
| `429` | Límite de tasa superado. Reduce la frecuencia; el mensaje indica por cuánto tiempo. |
| `500` | El error reside en el servidor o su base de datos, no en el emisor. Revisa los logs. |
| `501` | La ruta existe, pero este despliegue no puede atenderla: una funcionalidad desactivada o sin configurar. |
| `502` `503` `504` | Una dependencia no era accesible, no estaba configurada o fue demasiado lenta. |

## Autenticación y cuentas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | La ruta requiere un segundo factor y la sesión solo dispone de uno. | Completa el desafío MFA y reintenta. |
| `ALREADY_VERIFIED` | 400 | La dirección o el factor ya están verificados. | Nada: el estado deseado ya es efectivo. |
| `ACCOUNT_OUTRANKS_CALLER` | 403 | La cuenta que se intenta editar, restablecer o eliminar posee un rol o ámbito que el emisor no tiene. `details.beyond` los enumera. | Haz que alguien que los posea realice el cambio. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | El inicio de sesión anónimo está desactivado en este servidor. | Actívalo o inicia sesión con una identidad real. |
| `ANONYMOUS_NOT_ALLOWED` | 403 | Una sesión de invitado intentó aprobar el inicio de sesión de un dispositivo. Un invitado no tiene una cuenta para vincular a un dispositivo. | Inicia sesión con una cuenta y luego apruébalo. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Una clave de API intentó listar, crear, modificar o revocar claves de API, ya sean de su mismo tipo o personales. | Gestiona las claves como una persona con `keys:write` o con la clave de servicio. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Una ruta protegida se ejecutó sin un middleware de autenticación de Rebase previo, por lo que la credencial del emisor nunca se examinó. | Monta la aplicación a través del enrutador de funciones en lugar de montarla directamente en tu propio servidor. |
| `BOOTSTRAP_ANONYMOUS` | 403 | Se intentó realizar el arranque inicial (bootstrap) del primer administrador desde un emisor anónimo. | Inicia sesión primero. |
| `BOOTSTRAP_COMPLETED` | 403 | El primer administrador ya existe. | Haz que un administrador existente otorgue el rol. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | El arranque inicial solo es para el primer usuario absoluto, y este no lo es. | Haz que un administrador existente otorgue el rol. |
| `CAPTCHA_FAILED` | 400 | El proveedor rechazó el token de CAPTCHA. | Resuelve un desafío nuevo. |
| `CAPTCHA_REQUIRED` | 400 | La ruta requiere un token de CAPTCHA y no se envió ninguno. | Incluye el token. |
| `CHALLENGE_EXHAUSTED` | 401 | Demasiados códigos incorrectos para un desafío MFA. | Inicia un nuevo desafío. |
| `DEVICE_LOGIN_DECIDED` | 409 | El inicio de sesión de dispositivo ya fue aprobado o denegado. Un inicio de sesión se decide una sola vez. | Inicia uno nuevo en el dispositivo. |
| `DEVICE_LOGIN_EXPIRED` | 410 | El inicio de sesión de dispositivo superó sus diez minutos de vigencia antes de ser decidido. | Inicia uno nuevo en el dispositivo. |
| `DEVICE_LOGIN_NOT_FOUND` | 404 | Ningún inicio de sesión de dispositivo coincide con ese código de usuario. El sondeo del dispositivo en sí responde con los códigos en minúsculas de la RFC 8628: `authorization_pending`, `slow_down`, `access_denied`, `expired_token`, `invalid_grant`. | Comprueba el código comparándolo con el que muestra el dispositivo. |
| `EMAIL_EXISTS` | 409 | Ya existe una cuenta con esa dirección: en el registro, en un cambio de dirección o al seguir un enlace de cambio de dirección si otra cuenta tomó la dirección mientras esperaba. | Inicia sesión o inicia un restablecimiento de contraseña; para un cambio de dirección, elige otra. |
| `EMAIL_NOT_CONFIGURED` | 503 | Se solicitaron enlaces mágicos u OTP y el servidor no tiene transporte de correo configurado. | Configura SMTP o utiliza otro método de inicio de sesión. |
| `EMAIL_NOT_VERIFIED` | 403 | Un inicio de sesión OAuth encontró una cuenta con la misma dirección y el proveedor no verificó dicha dirección, por lo que no se vincula. | Inicia sesión con el método existente y luego ejecuta `POST /auth/link/<provider>`. |
| `FACTOR_NOT_VERIFIED` | 400 | El factor MFA se registró pero nunca se confirmó. | Confirma el factor. |
| `IDENTITY_ALREADY_LINKED` | 409 | Esa identidad OAuth pertenece a otra cuenta. | Inicia sesión con ella o desvincúlala de esa cuenta primero. |
| `IMPERSONATION_FORBIDDEN` | 403 | Una solicitud envió `x-rebase-impersonate` y su emisor no tiene permiso para ejecutar una solicitud como otro usuario. Solo la sesión propia de un administrador autenticado puede hacerlo, nunca una clave de API o la clave de servicio. | Envíala con la sesión de un administrador o elimina el encabezado. |
| `IMPERSONATION_INVALID` | 400 | `x-rebase-impersonate` se envió vacío. | Envía el uid del usuario a suplantar o elimina el encabezado. |
| `IMPERSONATION_TARGET_NOT_FOUND` | 404 | `x-rebase-impersonate` no especifica ningún usuario activo: ninguna cuenta tiene ese uid o está deshabilitada. | Comprueba el uid. |
| `IMPERSONATION_UNAVAILABLE` | 501 | La autenticación de este backend no puede ejecutar una solicitud como otro usuario porque su `AuthAdapter` no tiene `resolveUser`. | Implementa `resolveUser` en el adaptador o elimina el encabezado. |
| `IMPERSONATION_UNSUPPORTED` | 400 | `x-rebase-impersonate` se envió a una ruta que no admite ejecutarse como otro usuario. Solo la API de datos y las funciones personalizadas lo admiten, y el socket en tiempo real admite `impersonate` en `AUTHENTICATE`. | Envía la solicitud sin el encabezado. |
| `SIMULATION_FORBIDDEN` | 403 | Una solicitud envió un encabezado `x-rebase-simulate-*` (el simulador RLS) o consultó `/api/admin/rls-simulator`, y su emisor no tiene permiso para simular acceso. Solo la sesión propia de un administrador autenticado puede hacerlo, nunca una clave de API o la clave de servicio. | Envíala con la sesión de un administrador o elimina los encabezados. |
| `SIMULATION_INVALID` | 400 | La simulación estaba mal formada: un encabezado enviado vacío, `x-rebase-simulate-api-key-id` combinado con un rol o id de usuario, o simulación combinada con `x-rebase-impersonate`. | Especifica un único rol (opcionalmente con un uid), un único id de usuario o un único id de clave de API. |
| `SIMULATION_READ_ONLY` | 403 | Una escritura, eliminación, `_batch`, reversión de historial o una función personalizada llamada mediante cualquier verbo que no sea `GET`/`HEAD`/`OPTIONS` incluía un encabezado `x-rebase-simulate-*`. El acceso simulado es de solo lectura: la escritura se ejecutaría con la identidad simulada, no como el administrador. Las lecturas, incluidas `POST …/query` y `…/count`, siguen ejecutándose. | Deja de simular para realizar cambios. |
| `SIMULATION_TARGET_NOT_FOUND` | 404 | La simulación no especifica ningún usuario activo (un id de usuario enviado sin un rol) o ninguna clave de API activa. | Comprueba el id, o envía un rol junto con el uid para simular un uid que no posee cuenta. |
| `SIMULATION_UNAVAILABLE` | 501 | Este backend no puede simular acceso: su `AuthAdapter` no tiene `resolveUser` para confirmar a un administrador, o se especificó una clave en un backend sin claves de API. | Implementa `resolveUser` o elimina los encabezados. |
| `SIMULATION_UNSUPPORTED` | 400 | Se envió un encabezado `x-rebase-simulate-*` a una ruta que no puede ejecutarse con acceso simulado. Solo la API de datos y las funciones personalizadas los admiten. | Envía la solicitud sin los encabezados. |
| `GUEST_REFERENCED` | 409 | No se pudo eliminar a un invitado porque una fila del propio proyecto lo requiere mediante una clave foránea con `ON DELETE RESTRICT` o `NO ACTION`. `DELETE /api/admin/guests` lo reporta por invitado en `skipped` y continúa. | Elimina la fila o conserva al invitado. |
| `INVALID_ACCOUNT` | 400 | La cuenta se encuentra en un estado sobre el que esta operación no puede actuar. | Consulta el mensaje. |
| `INVALID_CHALLENGE` | 400 | El desafío MFA es desconocido o ha expirado. | Inicia uno nuevo. |
| `INVALID_CODE` | 400 / 401 | El código OTP o MFA es incorrecto: 400 desde el inicio de sesión por código de email (`/auth/otp/verify`), 401 desde un registro o desafío MFA. | Reintenta con el código actual. |
| `INVALID_CREDENTIALS` | 401 | Correo electrónico o contraseña incorrectos (deliberadamente no se especifica cuál). | Reintenta o restablece la contraseña. |
| `INVALID_PLATFORM_TOKEN` | 401 | Se rechazó un token de plataforma `rpt_`: firma incorrecta, audiencia errónea, expirado o tiempo de vida superior al límite máximo. El mensaje detalla la causa. | Haz que la plataforma genere uno nuevo (en Rebase Cloud, ejecuta el comando de nuevo). |
| `INVALID_SCOPES` | 400 | Se solicitó para una clave algo que no es un ámbito: mal formado, desconocido o con un destino no admitido por el ámbito. `details.problems` detalla cuáles y por qué; `details.validScopes` enumera los ámbitos válidos para una clave. Omite `keys:read` y `keys:write`, que ninguna clave puede poseer. | Usa un nombre de la lista. Consulta [Roles y ámbitos](/docs/backend/roles-and-scopes/). |
| `INVALID_TOKEN` | 400 / 401 | Un token de verificación, restablecimiento, enlace mágico o cambio de dirección está mal formado, es desconocido, ya fue usado o ha expirado (400). Una credencial de proveedor OAuth o un token de actualización que no se verifica devuelve 401. | Solicita un enlace nuevo o inicia sesión de nuevo. |
| `INVALID_USER_CODE` | 400 | Lo enviado como código de inicio de sesión de dispositivo no es válido: debe tener ocho letras, como `BCDF-GHJK`. | Copia el código que muestra el dispositivo. |
| `INVALID_ROLE` | 400 | Un nombre de rol que se intenta escribir no es una cadena, está vacío o contiene `,` `{` `}` `"` `\` o un carácter de control. Esos caracteres se interpretarían de nuevo como otros roles: un rol viaja en un `text[]` de Postgres y en la lista separada por comas que dividen las directivas RLS, por lo que `"support,admin"` se leería como `admin`. `details.problems` lista cada uno. | Renombra el rol. Cualquier otro nombre es aceptado. |
| `KEY_MANAGEMENT_SCOPE` | 400 | Se solicitó `keys:read` o `keys:write` para una clave. Ninguna clave puede gestionar claves. `details.scopes` las enumera. | Ofrécelas sin esos ámbitos. |
| `KEY_OUTRANKS_CALLER` | 403 | Un titular de `keys:write` intentó modificar o revocar una clave de servicio que posee un rol o ámbito que este no tiene. Solo un administrador gestiona cualquier clave. `details.roles` y `details.scopes` listan lo que la clave posee por encima del emisor. | Haz que un administrador o alguien que los posea modifique la clave. |
| `LAST_ADMIN` | 403 | El cambio dejaría al proyecto sin administradores. | Asigna el rol de administrador a otra persona primero. |
| `MFA_REQUIRED` | 401 | La contraseña era correcta y la cuenta tiene un segundo factor verificado, por lo que el inicio de sesión solo se ha completado a medias. `details` contiene un token de corta duración delimitado al desafío MFA (no es una sesión). | Abre un desafío y respóndelo; la respuesta del desafío emite la sesión. |
| `NO_SESSION` | 401 | No se presentó ninguna cookie de sesión ni token de actualización. Comportamiento habitual en la primera carga de una página. | Inicia sesión. |
| `NOT_ANONYMOUS` | 400 | Una ruta para ascender desde un estado anónimo fue llamada por una cuenta real, o `DELETE /api/admin/guests/:uid` especificó una cuenta real. | No hay nada que ascender. Para eliminar una cuenta, usa `DELETE /api/admin/users/:uid`. |
| `OAUTH_ERROR` | 401 | El proveedor OAuth denegó la petición o devolvió un error. | Reintenta el flujo; el mensaje contiene la razón del proveedor. |
| `PERSONAL_KEYS_DISABLED` | 403 | Las claves de API personales están desactivadas en este backend. | Configura `personalKeys: true` en las opciones `auth` de la tabla de autenticación (`defineAuthTable`). |
| `PERSONAL_KEY_NEEDS_ACCOUNT` | 403 | La clave de servicio o una sesión de invitado intentó usar las rutas de claves personales. Ninguna de las dos tiene una cuenta para actuar en su nombre. | Inicia sesión en una cuenta o crea una clave de servicio bajo `/api/admin/api-keys`. |
| `PLATFORM_TOKENS_OFF` | 401 | Un token de plataforma `rpt_` llegó a un servidor que no los acepta: `REBASE_PLATFORM_TOKEN_KEY` y `REBASE_PLATFORM_TOKEN_AUDIENCE` no están configurados. | La plataforma que aloja la aplicación configura ambos al desplegar; vuelve a desplegar o inicia sesión en la aplicación por otra vía. |
| `RATE_LIMITED` | 429 | Demasiados intentos por parte de este emisor. | Reduce la frecuencia; el mensaje indica por cuánto tiempo. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | El destino de redirección no está en la lista de permitidos. | Añádelo a la configuración del proveedor. |
| `REGISTRATION_DISABLED` | 403 | El registro libre de usuarios está desactivado. | Haz que un administrador cree la cuenta. |
| `ROLE_EXCEEDS_CALLER` | 403 | Los roles otorgados poseen un ámbito, o `admin`, que el emisor no tiene. `details.beyond` los enumera. | Haz que alguien que los posea otorgue el rol. |
| `ROLE_EXCEEDS_CREATOR` | 403 | Se asignó a una clave de servicio un rol RLS que su creador no posee. Solo un administrador puede asignar cualquier rol. `details.roles` los enumera. | Quita el rol o haz que un administrador cree la clave. |
| `ROLE_EXISTS` | 409 | Ese nombre de rol ya está en uso. | Elige otro nombre. |
| `ROLE_LOOKUP_FAILED` | 503 | No se pudieron leer los roles del emisor: en una ruta de administración o en una solicitud de datos en un backend con `config.auth`. Falla de forma cerrada en lugar de confiar en los roles del token. Un token cuyo uid no corresponde a ninguna cuenta (incluido un uid que la tabla de usuarios no pueda almacenar) es un 401, no este error. Una base de datos inalcanzable es `DATABASE_UNAVAILABLE`, no este error. | Reintenta; comprueba la base de datos. |
| `SCOPE_EXCEEDS_CREATOR` | 403 | Se solicitó para una clave un ámbito que su creador no posee. Una clave nunca posee más privilegios que la cuenta que la crea. `details.scopes` los enumera. | Quítalos o haz que alguien que los posea cree la clave. |
| `SCOPE_MISSING` | 403 | La credencial no posee el ámbito que esta ruta, tabla, fuente de almacenamiento o función necesita. `details.requiredScope` lo especifica, incluyendo el destino. | Para una persona, asigna un rol que declare el ámbito. Para una clave, usa una clave que lo posea. Consulta [Roles y ámbitos](/docs/backend/roles-and-scopes/). |
| `SCOPE_NOT_DECLARED` | 500 | Una ruta protegida con `requireScope` especifica un ámbito de aplicación que este backend no declara, por lo que nadie lo posee, ni siquiera un administrador. Un nombre que no es un ámbito o uno integrado mal escrito (como `data:raed`) nunca llega a este punto: `requireScope` lanza una excepción en el momento en que se registra la ruta. | Declara el ámbito bajo `auth.scopes` en la tabla de autenticación o corrige el nombre. Consulta [Roles y ámbitos](/docs/backend/roles-and-scopes/). |
| `SELF_DELETE` | 400 | Un administrador intentó eliminar su propia cuenta. | Haz que otro administrador lo haga. |
| `SESSION_REVOKED` | 401 | La sesión se cerró en otro lugar, se revocaron todas las sesiones o se eliminó la cuenta. Cualquier acceso que reciba una sesión responde con esto ante dicho token de acceso: la API de datos, el almacenamiento, las funciones personalizadas y las rutas de administración. El socket en tiempo real rechaza su `AUTHENTICATE` con una trama `AUTH_ERROR` que incluye este mismo código. El SDK intenta refrescar, la renovación es rechazada y se cierra la sesión. | Inicia sesión de nuevo. |
| `ACCOUNT_DISABLED` | 401/403 | Un administrador desactivó la cuenta: el inicio de sesión (403), la renovación y todos los tokens que posee (401) son rechazados en cualquier punto que reciba una sesión. El socket en tiempo real rechaza su `AUTHENTICATE` con una trama `AUTH_ERROR` que incluye este mismo código. | Consulta con un administrador. |
| `EMAIL_NOT_CONFIRMED` | 403 | `requireEmailVerification` está activado y la dirección aún no se ha verificado. Solo se responde ante una contraseña correcta; se envía un nuevo enlace por correo. | Sigue el enlace enviado por correo. |
| `PROOF_REQUIRED` | 409 | `POST /auth/verify-email`: la cuenta contiene una contraseña o una identidad que nadie ha acreditado, y la solicitud no acredita ninguna de las dos. El token no se consume. | Envía `password` para conservarla o `removeUnproven: true` para verificar sin ella. |
| `UNDELIVERABLE_ADDRESS` | 400 / 409 | Se solicitó un correo de verificación para una dirección inalcanzable (la de un invitado o el marcador de posición de X, 400) o una cuenta solicitó cambiarse a dicha dirección (409, `POST /auth/change-email`). | Establece una dirección real primero. |
| `EMAIL_UNCHANGED` | 400 | `POST /auth/change-email` especificó la dirección actual de la cuenta. | Nada que cambiar. |
| `ANONYMOUS_USER` | 403 | Un invitado solicitó cambiar su dirección de correo electrónico; un invitado no tiene ninguna propia. | Conviértelo en una cuenta primero (`POST /auth/anonymous/link`). |
| `MFA_NOT_ENROLLED` | 400 | Se solicitaron códigos de recuperación para una cuenta sin un segundo factor verificado. | Registra un factor primero. |
| `HOOK_REJECTED` | 400 | Un hook `beforeUserCreate`, `beforeLogin`, `beforeUserDelete` o `beforeEmailChange` lanzó una excepción. El mensaje corresponde al del hook; un hook que elija un estado 4xx responderá con él. | Consulta el mensaje. |
| `INVALID_JSON` | 400 | El cuerpo de la solicitud no es JSON. | Envía un cuerpo JSON válido. |
| `SELF_DISABLE` | 400 | Un administrador intentó desactivar su propia cuenta. | Pídeselo a otro administrador. |
| `NOT_SUPPORTED` | 501 | El repositorio de autenticación de este backend no puede realizar lo solicitado (desactivar cuentas, cambiar una dirección). | Reinicia el servidor para que se añada la columna o usa un repositorio que lo admita. |
| `UNKNOWN_SCOPE_TARGET` | 400 | El destino de un ámbito especifica una tabla, fuente de almacenamiento o función que este backend no sirve. `details` lista las que sí sirve. | Corrige el destino. |
| `UNVERIFIED_IDENTITIES` | 409 | Un enlace mágico, código de email o restablecimiento de contraseña acreditó la dirección de una cuenta no verificada, y la cuenta posee una identidad de inicio de sesión cuyo proveedor nunca verificó dicha dirección. El repositorio de autenticación no puede eliminarla (carece de `unlinkUserIdentity`), por lo que la acreditación se rechaza antes de dejar esa vía de acceso abierta en una cuenta verificada. | Implementa `unlinkUserIdentity` en el repositorio de autenticación personalizado o haz que un administrador revise la cuenta. |
| `SETUP_REQUIRED` | 403 | El proyecto aún no tiene ningún administrador, por lo que esta ruta no está disponible. | Completa la configuración inicial del primer administrador. |
| `TOKEN_ALREADY_USED` | 401 | Se reutilizó un token de un solo uso o un token de actualización rotado hace más de `refreshTokenReuseIntervalSeconds` segundos. | Solicita uno nuevo o inicia sesión de nuevo. |
| `TOKEN_EXPIRED` | 401 | El token ha superado su tiempo de vida. | Solicita uno nuevo. |
| `USER_NOT_FOUND` | 404 | No existe ninguna cuenta con ese id. | Comprueba el id. |
| `WEAK_PASSWORD` | 400 | La contraseña no cumple con la [política de contraseñas](/docs/backend/auth-endpoints/#password-policy) (por defecto más de 8 caracteres con una mayúscula, una minúscula y un dígito): en el registro, en un restablecimiento o cambio, y en una contraseña elegida por un administrador: `POST /api/admin/users`, una creación en la tabla de autenticación vía la API de datos, `PUT /api/admin/users/:id` o `POST /api/admin/users/:id/reset-password`. | Elige una más robusta. Un administrador que importe cuentas puede enviar `skipPasswordPolicy: true` al crear. |

## Datos, consultas y escrituras

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `AGGREGATE_MASKED_BY_AFTER_READ` | 400 | Una agregación distinta de `count()` sin `groupBy` en una tabla reescrita por un hook `afterRead` (global, de tabla o el `.transform()` de una columna). Una agregación lee los valores almacenados y nunca ejecuta el hook, por lo que una suma, mínimo, máximo, conteo de campos o agrupación leería lo que el hook oculta. | Usa `count()` sin `groupBy` o lee las filas, las cuales sí pasan por el hook. |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Este controlador no puede computar la agregación solicitada. | Usa un controlador que pueda o calcúlala en el cliente. |
| `BRANCHING_UNSUPPORTED` | — | Se solicitó una rama de la base de datos a través del WebSocket de Studio en la base de datos de desarrollo administrada (PGlite), donde una rama *es* el propio elemento primario y nada quedaría aislado. El rechazo es el mismo que imprime `rebase db branch`. | Apunta `DATABASE_URL` a un Postgres propio (`rebase dev --docker` inicia uno) y crea la rama allí. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` contiene más operaciones que el límite por lote (1000 por defecto). Un lote es una sola transacción y retiene sus bloqueos durante toda su duración. | Envíalo en fragmentos; el mensaje especifica el límite y tu cantidad actual. |
| `BATCH_UNSUPPORTED` | 400 | El controlador de este backend no puede escribir en múltiples tablas de forma atómica, y un bucle de escrituras individuales no sería ni atómico ni de un solo viaje de ida y vuelta (round-trip). | Envía las escrituras como solicitudes separadas o como llamadas `/bulk` por tabla. |
| `BULK_TOO_LARGE` | 400 | El cuerpo masivo supera el límite de elementos configurado. | Divide la solicitud. |
| `BULK_UNSUPPORTED` | 400 | Esta tabla o controlador no admite escrituras masivas. | Escribe las filas una a una. |
| `CALLBACK_REJECTED` | 400 / 403 | Un hook de tabla rechazó la escritura. Un `throw` desde `beforeSave`/`beforeDelete`/`after*` devuelve un 400 con el mensaje propio del autor; un `beforeDelete` que retorna `false` devuelve un 403. `details.stage` indica qué hook y `details.path` la tabla. | Lee el mensaje: fue escrito por este proyecto, no por Rebase. |
| `CALLBACK_RECURSION` | 500 | Las escrituras iniciadas por hooks se anidaron a más de 16 niveles de profundidad: la escritura `context.data` de un hook ejecuta los hooks de esa tabla nuevamente, y nada en la cadena lo detiene (habitualmente un `afterSave` que actualiza su propia fila incondicionalmente). Toda la escritura fue revertida (rollback). El mensaje nombra el hook y la tabla; `details.chain` lista cada paso de hook → escritura. | Haz que la escritura del hook sea condicional: actúa solo sobre `status === "new"`, o sáltatela cuando `values` ya contenga lo que iba a escribir. |
| `TABLE_READ_ONLY` | 405 | <span class="since-badge" data-since="0.31">Desde 0.31</span> Una escritura alcanzó una vista (`defineView`). Una vista es de solo lectura. Anteriormente `COLLECTION_READ_ONLY`. | Escribe en las tablas que lee la vista. Consulta [Vistas](/docs/collections/views/). |
| `TABLE_WITHHELD` | 503 | <span class="since-badge" data-since="0.31">Desde 0.31</span> La tabla está declarada, pero la base de datos no la protege: la seguridad a nivel de fila está desactivada, no existe ninguna de las políticas que declara o falta una política restrictiva declarada. (Una política permisiva faltante se sirve, emitiendo una advertencia de arranque que la nombra). Esto ocurre cuando el servidor no aprovisiona sus tablas (`REBASE_PROVISION=false`, `provisionSchema: false`, `provision.tables: false`, `REBASE_MIGRATE_ON_BOOT=none`), y el servidor retiene la tabla en lugar de servir todas las filas a todos los usuarios. Una tabla de unión muchos a muchos se somete a la misma regla: si falla, las tablas cuyas relaciones la utilicen se retienen y el mensaje nombra la unión; de igual modo una tabla cuyo `via` pase por una tabla retenida, indicando el `via`. Una lectura de relación o filtro que pase por una tabla retenida también responde con este código. El resto de las tablas se sirven con normalidad. El registro de arranque indica las sentencias para protegerla. | Aplica las sentencias que indica el log de arranque (`rebase db push` lo hace) y reinicia. |
| `SQL_NOT_ALLOWED` | 400 | El SQL ejecutado como el emisor (`getSql(c)`, `withAuth(user).sql`) no era una única sentencia directa de tipo `SELECT`, `WITH`, `VALUES`, `TABLE`, `INSERT`, `UPDATE`, `DELETE` o `MERGE`, o invocó `set_config` o mencionó `pg_settings`. La identidad del emisor reside en los ajustes de sesión, por lo que se rechaza cualquier sentencia que pueda alterarlos. | Mantén el texto de la consulta propio, una sola sentencia y con cada valor en `params`. Consulta [Funciones personalizadas](/docs/backend/custom-functions/#3-getsqlc--sql-as-the-caller). |
| `CURSOR_WITH_OFFSET` | 400 | Se combinó `?after=` con `?offset=` o `?page=`. Un cursor ya indica dónde comienza la página, por lo que aplicar un desplazamiento (offset) sobre él omitiría silenciosamente esa cantidad de filas tras el cursor, produciendo un salto que el emisor no puede percibir en la respuesta. | Usa uno u otro. |
| `DISTINCT_NOT_APPLICABLE` | 400 | Se combinó `?distinct=true` con una consulta de búsqueda o vectorial. Ambas asignan una puntuación por fila, por lo que nunca habrá dos filas idénticas y `DISTINCT` no colapsaría nada: aparentaría funcionar pero no cambiaría nada. | Elimina uno de los dos. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Una lectura `distinct` se ordena mediante una columna que no devuelve. Un `SELECT DISTINCT` solo puede ordenarse por columnas presentes en su lista de selección, o de lo contrario las filas colapsadas carecen de un orden definido. `details.fields` las enumera. | Añade esos campos a `?fields=` o quítalos de `?orderBy=`. |
| `DATABASE_UNAVAILABLE` | 503 | No se pudo conectar a la base de datos: la conexión fue rechazada o interrumpida, el host no se resolvió, el servidor se está apagando o iniciando, o la base de datos está cerrada para nuevas conexiones (`ALLOW_CONNECTIONS false`, algo que un `rebase db branch create --force` interrumpido deja en su origen; el log del servidor indica la base de datos y `rebase db branch list` la vuelve a abrir). Todos los accesos responden con esto, incluidos el inicio de sesión, las rutas de administración y el socket en tiempo real (una trama `ERROR`). Se envía con `Retry-After: 5`. | Reintenta; el SDK lo hace automáticamente. Comprueba que la base de datos esté funcionando y accesible desde el servidor. |
| `DB_CONNECTIONS_EXHAUSTED` | 503 | El servidor de base de datos rechazó una nueva conexión porque no le quedan disponibles (`53300` demasiados clientes, `53400` límite de conexiones para un rol o base de datos). Cada instancia de servidor comparte el `max_connections` del servidor de BD, por lo que esto sucede cuando coinciden varias instancias con pools grandes sin un pooler intermediario. Es una cuestión de carga, no un defecto; se envía con `Retry-After: 2`. El servidor registra la solución en el log una vez por minuto. | Reintenta; el SDK lo hace automáticamente. Reduce `DB_POOL_MAX` (o limítalo con `REBASE_DB_POOL_MAX`) entre las instancias, coloca un pooler delante de la base de datos (`DATABASE_POOLED`) o incrementa `max_connections`. |
| `DB_CONNECT_TIMEOUT` | 503 | Abrir una nueva conexión con la base de datos tomó más tiempo que `DB_POOL_CONNECT_TIMEOUT`: la base de datos tarda en aceptar conexiones o está muy distante. Se envía con `Retry-After`. | Reintenta; el SDK lo hace automáticamente. Comprueba la carga de la base de datos y la red hacia ella. |
| `DB_PERMISSION_DENIED` | 500 | Postgres rechazó la sentencia (`42501`): bien por una política de seguridad a nivel de fila que deniega este rol, o por un `GRANT` faltante. | Consulta [Solución de problemas](/docs/troubleshooting/). |
| `DB_POOL_EXHAUSTED` | 503 | Todas las conexiones del pool permanecieron ocupadas durante `DB_POOL_CONNECT_TIMEOUT`, por lo que la solicitud nunca llegó a la base de datos. Cuestión de carga, no un defecto; se envía con `Retry-After`. El servidor registra la solución en el log una vez por minuto. | Reintenta; el SDK lo hace automáticamente. Incrementa `DB_POOL_MAX` o localiza las consultas lentas o transacciones extensas que retienen las conexiones. |
| `FIELD_NOT_READABLE` | 400 | Un filtro, `orderBy`, `fields`, agregación `select` o `groupBy` especifica un campo que los roles del emisor no pueden leer (`access.read`), una ruta anidada o un ordenamiento por agregación nombra una relación que no pueden leer, o una operación de campo (`$inc`, `$push`, …) apunta a uno de ellos, donde un límite rechazado revelaría el valor almacenado. Un campo que ninguna respuesta puede incluir debe ser también uno que ninguna consulta pueda evaluar, o de lo contrario el valor sería legible evaluando predicados uno a uno. Un filtro a través de una relación (`author.salary`) y una ordenación agregada sobre el campo de una relación (`max(staff.salary)`) se evalúan según la regla de destino. `details.violations` detalla cada campo. El controlador aplica la misma regla a lecturas en proceso en nombre del emisor (`context.data` bajo el alcance del emisor) y a búsquedas vectoriales, inclusiones o comprobaciones de unicidad. Una columna `.private()` responde como si no existiera: un filtro, `orderBy`, `fields`, `include`, `select` de agregación, `groupBy` o `vector_search` que la mencione recibe exactamente la respuesta que obtendría un nombre mal escrito (`UNKNOWN_FILTER_FIELD`, `UNKNOWN_ORDER_BY_FIELD`, `UNKNOWN_FIELD`, `UNKNOWN_RELATION`, `UNKNOWN_AGGREGATE_FIELD` o `UNKNOWN_VECTOR_PROPERTY`), y ninguna respuesta de campo desconocido la incluirá. | Elimina el campo de la consulta u obtén el rol. Consulta [Acceso a campos](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 / 403 | El cuerpo define un campo que los roles del emisor no pueden escribir (`access.write`). Es rechazado en lugar de omitido: una escritura que descarte un campo reportaría éxito para una modificación que nunca ocurrió. El mismo código rechaza una escritura a través de un padre que establece una relación que el emisor no puede escribir, y una actualización que asigna un valor a un campo `softDelete` (solo una eliminación lo sella). El socket en tiempo real responde 403 con este código para escrituras a través de rutas anidadas cuya tabla padre, relación o tabla destino no se sirven allí, en lugar de pasársela al controlador sin evaluar. `details.violations` nombra cada campo. | Elimina el campo u obtén el rol. Un campo que nadie puede escribir responde con `VALIDATION_EXCLUDED_FIELDS`. |
| `FILTERED_USER_WRITE` | 400 | Se envió una actualización o eliminación filtrada a la tabla de autenticación por HTTP, cuyas escrituras se evalúan usuario por usuario antes de ejecutarse. | Lee los usuarios y luego aplica `updateMany`/`deleteMany` por id. |
| `FILTER_REQUIRED` | 400 | Una escritura filtrada (actualización o eliminación mediante `where`/`logical`, desde el SDK o las rutas masivas) no contiene condiciones, por lo que afectaría a todas las filas. Se rechaza antes de ejecutar nada. | Añade una condición. Si quieres modificar todas las filas intencionadamente, indícalo con una condición que todas cumplan. |
| `HISTORY_UNAVAILABLE` | 503 | Se rechazó una escritura en una tabla con `history: true` porque su entrada de historial no pudo registrarse: la base de datos no tiene la tabla `rebase.entity_history` o, para `openRebase` y `rebase console`, no existe la función `rebase.record_history`. Ningún backend con historial activo ha arrancado en esta base de datos. Nada se ejecutó, hooks incluidos, y las lecturas no se ven afectadas. Lanzado por `openRebase` y respondido por backends creados con `provision: false`. | Arranca el backend al menos una vez con historial activado y `provision: true` (`rebase dev` lo hace) y reintenta. |
| `HISTORY_UNSERVABLE` | 501 | <span class="since-badge" data-since="0.31">Desde 0.31</span> El controlador de datos de la tabla no puede ejecutar las reglas de lectura ni los hooks `afterRead` sobre las filas almacenadas (`DataDriver.serveStoredRows`), y el historial nunca se sirve sin máscara. El controlador integrado de Postgres sí puede. | Implementa `serveStoredRows` en el controlador personalizado. Consulta [Historial](/docs/backend/history/). |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Una solicitud anterior con la misma `Idempotency-Key` todavía se está ejecutando. | Reintenta cuando finalice. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | Se recibió la misma `Idempotency-Key` en una solicitud distinta: método, ruta, cadena de consulta o cuerpo diferentes. | Usa una clave nueva o envía la solicitud original. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` especificó una función que no es de agregación (`count`, `sum`, `avg`, `min`, `max`, `countDistinct`, `mode`, `percentile`, `distinct`, `fingerprint`). | Usa una de esas; el mensaje las enumera. |
| `INVALID_AGGREGATE_GROUP` | 400 | Una transformación de `groupBy` es desconocida o no aplica a su columna: `year`/`month`/`day` en una columna que no es fecha, o `unnest` en una que no es array. | Usa `lower`, `upper`, `year`, `month`, `day` o `unnest` sobre una columna del tipo adecuado. |
| `INVALID_AGGREGATE_SELECT` | 400 | Una entrada de `?select=` no tiene el formato `fn(field)`; se usó una función distinta de `count()` o `fingerprint()` sin proporcionar un campo; `percentile` no tiene una fracción de 0 a 1; o se solicitó `fingerprint()` sobre una vista plana, que no almacena filas. | Escribe `sum(total)`, `count()`, `percentile(price,0.95)`. |
| `INVALID_AGGREGATE_WINDOW` | 400 | `offset`, `page` u `orderBy` en una agregación sin `groupBy`, o un cursor en cualquier agregación. Una agregación no agrupada es una sola fila, y un grupo no es una fila a partir de la cual un cursor pueda continuar. | Añade `groupBy` o elimínalos; pagina grupos con `offset` o `page`. Consulta [Agregaciones](/docs/sdk/aggregates-and-search/#aggregates). |
| `INVALID_BATCH_BODY` | 400 | A una operación de `/_batch` le falta `op`, `table`, `values` o `id`, especifica una tabla que este backend no sirve, o reutiliza un nombre de `ref`. | Consulta el mensaje; nombra la operación por su índice. |
| `INVALID_BATCH_REF` | 400 | Un `{ "$ref": "<name>.<field>" }` no apunta a ninguna operación previa, apunta hacia adelante o pide un campo que la fila referenciada no posee. Solo se resuelven referencias hacia atrás. | Nombra la operación con `ref` *antes* de referenciarla. |
| `INVALID_BULK_BODY` | 400 | El cuerpo masivo no tiene la estructura esperada. | Envía el array correspondiente a la ruta: `{ "rows": [...] }` para `POST /bulk`, `{ "updates": [{ "id", "data" }] }` para `PATCH /bulk`, `{ "ids": [...] }` para `POST /bulk/delete`. |
| `INVALID_CONFLICT_RULE` | 400 | La regla de conflicto de un upsert (mantener duplicados o reemplazar solo en un `where`) se envió sin `upsert: true`, o se enviaron ambas reglas simultáneamente. | Envía `upsert: true` y solo una de las dos. |
| `INVALID_CONFLICT_TARGET` | 400 | El `on_conflict` / `onConflict` de un upsert menciona columnas que no garantizan unicidad, las menciona sin `upsert: true`, o se envía en una creación anidada (donde una fila coincidente se movería bajo el nuevo padre). Postgres respondería de otro modo 42P10 dentro de una transacción que ya ha realizado operaciones. También cualquier upsert en la tabla de autenticación, donde crear y actualizar siguen reglas distintas. | Declara `.unique()` en la columna o un índice `unique`; el mensaje lista los destinos válidos existentes. En la tabla de usuarios, envía `POST` para crear y `PATCH` para actualizar. |
| `INVALID_COUNT` | 400 | `?count=` no es `exact` ni `none`. Se rechaza en lugar de interpretar el valor por defecto: un error tipográfico como `?count=nnone` pagaría el coste del conteo que se pretendía omitir. | Envía `exact` (por defecto) o `none`. Consulta [Omitir el conteo](/docs/backend/api/#skipping-the-count). |
| `INVALID_CURSOR` | 400 | El cursor `after` no se puede leer o especifica un id de fila que no encaja con las columnas clave de la tabla: fue truncado, recodificado o generado manualmente. Un cursor legible enviado con un `orderBy` distinto a aquel bajo el que se emitió genera `CURSOR_ORDER_MISMATCH`, también un 400. | Devuelve `meta.nextCursor` de la página anterior sin cambios, con el mismo `orderBy` o ninguno. Consulta [Paginación](/docs/sdk/pagination/). |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` no es ni `include` ni `only`. Rechazado en lugar de ignorado: un error de escritura como `?deleted=true` que ocultara silenciosamente las filas eliminadas aparentaría funcionar respondiendo exactamente lo opuesto. | Envía `include` (activas y eliminadas) o `only` (solo eliminadas). Omítelo para obtener solo filas activas. |
| `INVALID_DISTINCT` | 400 | `?distinct=` no es `true` ni `false`. | Envía uno de ellos; `1` y `0` también son aceptados. |
| `INVALID_FIELD_OPERATION` | 400 | Se utilizó `$inc` / `$push` / `$pull` / `$merge` sobre un tipo de columna en el que no está definido, con un operando de tipo incorrecto, con dos operadores en un mismo campo, mal escrito o en una creación (donde no existe un valor previo almacenado sobre el que operar). | Consulta [Escrituras sobre REST](/docs/backend/writes/#field-operations); el mensaje especifica el campo. |
| `INVALID_FILTERED_WRITE` | 400 | Una escritura filtrada se dirigió a una ruta a través de una relación (`posts/1/comments`) o a ninguna tabla. | Escribe en la tabla relacionada aplicando un filtro en su enlace. |
| `INVALID_FILTER_FIELD` | 400 | El filtro nombra una columna que esta tabla no tiene. | Comprueba cómo está escrita contrastándola con la tabla. |
| `INVALID_FILTER_OPERATOR` | 400 | El operador no es compatible con este tipo de columna; por ejemplo, `like` en un número o fecha. | Consulta [Consultar datos](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | Un valor de filtro no puede interpretarse como el tipo de la columna con la que se compara: `?id=eq.abc` en una clave entera, una etiqueta que no está en el enum, una marca de tiempo inválida, un número fuera de rango. `details.dbCode` incluye el SQLSTATE. | Envía un valor correspondiente al tipo de la columna. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` no es `true` ni `false`. Cualquier otro valor se rechaza en lugar de interpretarse como "no": un error tipográfico que aplique un borrado suave cuando el usuario pidió purgar le haría creer erróneamente que los datos se eliminaron definitivamente. | Envía `true` o `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` está mal formado: no es una lista de rutas válida o es un objeto de opciones por relación con estructura incorrecta. Una ruta anidada a más de tres saltos devuelve `INCLUDE_TOO_DEEP`, también un 400. Se responde en la frontera en lugar de salir del controlador como un 500. | Consulta el mensaje; especifica la ruta problemática. |
| `INVALID_INPUT` | 400 | El cuerpo no superó la validación. | Consulta el mensaje. |
| `INVALID_LIMIT` | 400 | `?limit=` no es un número entero entre 1 y el máximo permitido (1000 por defecto); valores superiores se rechazan, no se acotan. Una suscripción en tiempo real que solicite un límite fuera de ese rango recibe el mismo código en una trama `ERROR` de WebSocket. | Reduce el límite y pagina los resultados restantes. |
| `INVALID_LOGICAL_GROUP` | 400 | Un grupo `?or=` / `?and=` / `?not=` está mal formado o anidado más allá de la profundidad permitida. | Consulta el mensaje; muestra la regla de aplanamiento. |
| `INVALID_OFFSET` | 400 | `?offset=` no es un número entero igual o superior a 0. | Envía un número entero no negativo. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` no es `field`, `field:desc`, `field:desc:last`, ni un array JSON de `{ field, direction, nulls }`; o especifica una dirección distinta de `asc`/`desc`, o una posición de NULL distinta de `first`/`last`. | Consulta el mensaje; muestra todas las sintaxis válidas. |
| `INVALID_PAGE` | 400 | `?page=` no es un número entero igual o superior a 1. Las páginas tienen índice en base 1, por lo que `?page=0` es un error y no la primera página. | Envía `1` o más, o usa `?offset=`. |
| `INVALID_PARAM` | 400 | Un parámetro de consulta está mal formado. | Consulta el mensaje. |
| `INVALID_QUERY_BODY` | 400 | El cuerpo de un `POST …/query` contiene un valor que la URL no admitiría: una lista para un parámetro que la URL solo lee una vez (`fields`, `limit`, …), un objeto para un filtro, o cualquier parámetro repetido en la URL: un `POST …/query` lee todos los parámetros desde el cuerpo. | Escribe cada valor como lo hace la URL: una cadena, o una lista para un filtro repetido; `where`, `include`, `orderBy` y `vector` aceptan JSON. Consulta [Consultas demasiado largas para una URL](/docs/backend/vector-search/#queries-too-long-for-a-url). |
| `INVALID_VECTOR` | 400 | `?vector=` no es un array JSON de números. | Envía `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` no es `cosine`, `l2` ni `inner_product`. | Usa una de esas tres opciones. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` no es un número. | Envía un número. |
| `INVALID_WHERE` | 400 | `?where=` no es un objeto JSON que asocie campos con condiciones. | Envía `{"status":["==","active"]}`. |
| `KEY_IMMUTABLE` | 400 | Una actualización define la clave de la fila con un valor diferente al que se usa para identificarla: en el cuerpo o escrito mediante un `beforeSave`. Una fila no puede cambiar a otra clave: todo lo que ocurre tras la escritura (la relectura, `afterSave`, el historial, el tiempo real) la referencia con la clave que ya tenía. Se rechaza antes de ejecutar ningún hook, sin escribir nada, en todas las vías. `details.violations` nombra el campo. | Crea la fila bajo la nueva clave y elimina la actual. Enviar la clave que la fila ya tiene está permitido. |
| `MISSING_AGGREGATE_SELECT` | 400 | La ruta de agregación fue invocada sin `?select=`. | Añade uno; por ejemplo, `?select=count()`. |
| `NOT_A_MATERIALIZED_VIEW` | 400 | Se llamó a `refresh()` en una tabla que no es una vista materializada. | Actualiza únicamente vistas definidas con `defineView(…, { materialized: true })`. |
| `NO_TABLES` | 404 | <span class="since-badge" data-since="0.31">Desde 0.31</span> El proyecto no sirve tablas: ninguna declarada en `backend/schema` y ninguna en la base de datos para introspeccionar. Si existen tablas pero la seguridad a nivel de fila está desactivada en ellas, el mensaje las nombra indicando el SQL para activarla, y `details.unprotectedTables` las lista. Anteriormente `NO_COLLECTIONS`. | Crea tablas (mediante una migración, SQL o un archivo `defineTable` más `rebase db push`) y reinicia. |
| `NOT_FOUND` | 404 | No existe una fila con ese id en esa tabla, o la seguridad a nivel de fila la oculta para este emisor. | Comprueba el id y luego la directiva `rls` de la tabla. |
| `UNKNOWN_RELATION` | 400 / 404 | `?include=` indica algo que no es una relación en la tabla. Este mismo código responde **404** cuando una *ruta de URL* anidada lo nombra en su lugar, p. ej. `/api/data/authors/1/posts` donde `authors` no declara ninguna relación: allí la URL no apunta a nada, por lo que es un no encontrado y no una solicitud mal formada. | Comprueba el nombre de la relación; el mensaje enumera las que tiene la tabla. Una referencia inversa debe declararse en el padre para ser navegable. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | La ordenación especifica un campo no ordenable. | Ordena por una columna. |
| `PAGE_WITH_OFFSET` | 400 | Se combinó `?page=` con `?offset=`, o `page` con `offset` en un `find()`, lo cual el SDK cliente, el `rebase.data` en proceso y el cliente offline rechazan con este mismo código antes de emitir cualquier solicitud. Ambos describen la misma ventana, y antes `page` prevalecía silenciosamente sobre un `offset` que el emisor nunca veía aplicado. | Envía solo uno de ellos. |
| `PAYLOAD_TOO_LARGE` | 413 | El cuerpo supera el límite configurado. | Envía menos datos o incrementa el límite. |
| `READ_ONLY_TRANSACTION` | 409 | Un hook `afterRead` intentó escribir. Una lectura acotada a una solicitud se ejecuta en una transacción `READ ONLY`, por lo que ni el hook ni nada que este invoque puede realizar escrituras. | Extrae la escritura fuera de la lectura: usa un trabajo en segundo plano o `rebase.dataAsAdmin` desde una tarea cron o una función personalizada. |
| `REFRESH_NOT_SUPPORTED` | 501 | `POST /api/data/<slug>/refresh` llegó a un controlador de datos sin soporte de vistas materializadas. | Nada que actualizar en este backend. |
| `RELATION_HAS_NO_PIVOT` | 400 | La escritura transportaba datos de enlace, pero la ruta no alcanza su destino mediante un `manyToMany` que declare un `pivot`, por lo que no existe una fila de unión donde almacenarlos. | Declara columnas `pivot` en la relación o elimina esos datos de la escritura. Consulta [Relaciones](/docs/collections/relations/). |
| `RELATION_MISCONFIGURED` | 500 | Una relación no se resuelve según el esquema registrado. La operación se rechaza en vez de omitirse: omitirla informaría de éxito para una escritura que nunca ocurrió o devolvería vacío para filas que existen. | Ejecuta `rebase schema generate` si el esquema generado es más antiguo que la base de datos. |
| `RELATION_NOT_UNLINKABLE` | 400 | La relación no se puede desvincular desde este lado. | Realiza la escritura desde el lado propietario. |
| `RELATION_NOT_WRITABLE` | 400 | La ruta anidada no es una relación modificable, o una creación/actualización especifica una relación `via` con múltiples saltos: solo las relaciones `via` de un solo salto son modificables. `details.fields` lista las claves `via`. No se escribió nada. | Escribe directamente las filas que une la cadena. Consulta [Relaciones](/docs/collections/relations/#via--an-explicit-join-chain). |
| `RELATION_PIVOT_UNSUPPORTED` | 400 | La relación declara columnas de unión, pero este origen de datos no puede escribir en ellas. | El enlace en sí sigue funcionando; únicamente los datos asociados a él fallan. Comprueba las capacidades del controlador. |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | La escritura de una relación no tenía una clave de origen a la cual asociar el enlace. | Guarda la fila padre primero. |
| `RESULT_TOO_LARGE` | — | Una sentencia enviada a través de `EXECUTE_SQL` en el socket en tiempo real (`admin.executeSql` desde un cliente, lecturas del catálogo del panel de administración) devolvió más de 128 MB en filas, por lo que no se envió nada. Se entrega como una trama `ERROR` de WebSocket. Las ejecuciones propias de la consola SQL no se rechazan: muestran las primeras filas. | Añade un `LIMIT` o selecciona menos columnas y lee el resultado por partes. |
| `ROW_IN_TRASH` | 409 | La clave de un upsert pertenece a una fila en la papelera (una fila borrada de forma lógica sigue reteniendo su clave). Un upsert no escribe sobre una fila eliminada, en ninguna vía: `?on_conflict=` de REST, upserts en `/bulk` y `/_batch`, el SDK y el socket en tiempo real. No se escribió nada. | Restaura la fila primero (una actualización que ponga el campo de borrado suave en `null`) o púrgalo con `?hard=true` y haz el upsert nuevamente. Consulta [Borrado suave](/docs/collections/soft-delete/). |
| `SCHEMA_DRIFT` | 500 | Una tabla o columna que el código espera no existe en la base de datos. | Ejecuta `rebase db push` en desarrollo; vuelve a desplegar en un tenant gestionado. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | Se combinó `startAfter` con `orderBy: "_score"`. La relevancia se calcula por consulta y no se almacena, por lo que no puede actuar como clave de cursor. | Pagina la relevancia con `limit`/`offset` u ordena por una columna. |
| `SQL_ERROR` | 400 | La base de datos rechazó el SQL escrito por un usuario. En el `EXECUTE_SQL` del socket en tiempo real es una trama `ERROR` con el mensaje de la base de datos. `POST /api/admin/sql/csv` responde con esto antes de enviar cualquier parte del archivo: un error de sintaxis, una escritura (la descarga se ejecuta en modo solo lectura), más de una sentencia o un rol que la conexión no puede asumir. | Corrige el SQL. Una descarga admite un solo `SELECT`, `WITH … SELECT`, `TABLE` o `VALUES`. |
| `VIEW_NOT_READABLE` | 403 | Un emisor sin ninguno de los roles `view.roles` de una vista materializada intentó leerla o solicitó actualizarla. Una vista materializada carece de seguridad a nivel de fila, por lo que se sirve completa y únicamente a dichos roles. | Léela con uno de esos roles o declara el rol del emisor en `view.roles`. |
| `TENANT_IMMUTABLE` | 400 | Una escritura movería una fila de un tenant a otro. Una fila no puede cambiar de tenant. `details.violations` nombra el campo. Un disparador (trigger) impone la misma regla en la base de datos, por lo que el SQL ejecutado como el emisor fallará con el error de Postgres `42501` y un mensaje que comienza con `TENANT_IMMUTABLE`. | Crea la fila en el otro tenant y elimina esta, o escribe usando un rol incluido en `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | La escritura especifica un tenant al que este emisor no pertenece; la base de datos también la rechazaría. | Escribe en un tenant al que pertenezca el emisor o autentícate como alguien perteneciente a él. |
| `TENANT_REQUIRED` | 400 | La tabla está acotada por tenant y este no se puede deducir: la solicitud no incluye ninguno o el emisor pertenece a varios. | Envía el campo del tenant explícitamente o autentícate como un emisor que pertenezca a exactamente uno. |
| `TRANSACTION_ABORTED` | 500 | Falló una sentencia en la transacción de escritura y un hook capturó el error. Postgres ya había abortado la transacción, por lo que la escritura se revirtió por completo y nada se guardó. Solo las creaciones, actualizaciones o eliminaciones de `context.data` que la base de datos rechace se deshacen por sí solas y pueden capturarse con seguridad. | Deja que el fallo lance una excepción o realiza comprobaciones antes de ejecutar la sentencia. Consulta [Semántica de transacciones](/docs/collections/context-data-api/#transaction-semantics). |
| `UNKNOWN_FIELD` | 400 | `?fields=` nombra un campo que la tabla no tiene. | Comprueba la escritura; el mensaje lista los campos válidos. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Una agregación o `groupBy` nombra un campo que la tabla no tiene. | Comprueba la escritura; el mensaje lista los campos válidos. |
| `UNKNOWN_FILTER_FIELD` | 400 | El filtro nombra un campo que esta tabla (o el destino de una relación) no tiene, o una columna `.private()`. | Comprueba la escritura; el mensaje lista los campos válidos. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | El filtro nombra un operador que no existe. | El mensaje enumera todos los operadores disponibles. |
| `UNKNOWN_MESSAGE_TYPE` | 400 | Una trama del socket en tiempo real tiene un `type` que el servidor no procesa. Se responde con una trama `ERROR` que transporta el `requestId` de la solicitud, para que esta se resuelva en lugar de agotarse por tiempo de espera. | Comprueba el `type` de la trama; el mensaje lo nombra. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | La ordenación nombra un campo que esta tabla no tiene. | Comprueba la escritura; el mensaje lista los campos válidos. |
| `PRECONDITION_FAILED` | 412 | Un encabezado `If-Match` indicó una versión de la fila que ya no es la actual: alguien escribió en ella entre la lectura y esta escritura. No se escribió nada. | Vuelve a leer la fila, reaplica el cambio y envía el nuevo `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` solicita un campo que la tabla no tiene. | Comprueba la escritura; el mensaje lista los campos reconocidos. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Una búsqueda vectorial mencionó una columna que no es un `col.vector()` en esta tabla. | El mensaje lista las columnas vectoriales de la tabla. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | El `Content-Type` no es aceptado por esta ruta. | Envía el tipo documentado para la ruta. |
| `UNSUPPORTED_OPTION` | — | Lanzado como excepción, no respondido: una escritura a través del descriptor de acceso en proceso (`context.data` en un hook, `rebase.data` en una función o tarea cron) incluyó `ifMatch` o `idempotencyKey`. Esa vía no dispone de comprobación de precondiciones ni almacenamiento de idempotencia, por lo que la opción se rechaza antes de escribir nada en lugar de ignorarse. | Elimina la opción en ese punto o realiza la escritura mediante el cliente HTTP, que sí admite ambas. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | El filtro atraviesa una relación `via`, cuya ruta de unión se declara en un solo sentido, por lo que no hay manera de correlacionar una subconsulta de vuelta. | Aplica el filtro desde el lado propietario. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | El operador no está definido para ese campo: una relación sin columna en esta fila se filtra por pertenencia, y la coincidencia de patrones (`like`, `ilike` y sus negaciones) solo aplica a texto. | Consulta el mensaje; lista lo que admite el campo. |
| `VALIDATION_CONSTRAINT` | 400 | Un valor infringió una regla declarada en la columna (`.validate()`, `.notNull()`, `.oneOf()`): longitud, rango, patrón, campo obligatorio o valor fuera de la lista. Cada elemento de `details.violations` incluye un `code`: `required`, `min_length`, `max_length`, `length`, `min`, `max`, `less_than`, `more_than`, `positive`, `negative`, `integer`, `pattern`, `email`, `url`, `enum`, `min_items`, `max_items`, `unique_items` (un array contiene el mismo elemento dos veces, `$push` incluido), `unique_by` (dos elementos de un array JSON comparten valor en un campo designado por `uniqueBy`), `date_min`, `date_max`, `geopoint_range`. | Consulta el mensaje; nombra la tabla, la columna y cada infracción. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | El cuerpo escribe sobre una columna marcada como `.private()` o `.access({ write: [] })` (misma regla con dos sintaxis). Estas corresponden únicamente al servidor: un hash de contraseña, un token de verificación. A diferencia de `FIELD_NOT_WRITABLE`, esta respuesta es idéntica para todos los emisores, `admin` incluido. | Elimina el campo. Consulta [Acceso a campos](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Un valor no coincide con el tipo de su columna. | Consulta el mensaje; especifica la columna. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | El cuerpo nombra un campo que la tabla no tiene (incluido un argumento `id` en una tabla cuya clave sea otra). | Comprueba la escritura; el mensaje ("Table 'x' has no column 'f'. Known columns: …") lista las columnas. |
| `VECTOR_CURSOR_UNSUPPORTED` | 400 | Se combinó un cursor (`after` / `startAfter`) con una búsqueda vectorial. Las filas se ordenan por una distancia calculada por consulta que no puede actuar como clave de cursor, por lo que un listado vectorial no proporciona `nextCursor`. | Pagina las filas más cercanas mediante `limit`/`offset`. |
| `WRITE_DENIED` | 403 | Una regla de seguridad o política de seguridad a nivel de fila denegó la escritura. | Comprueba la directiva `rls` de la tabla. |

## `PG_<SQLSTATE>`: una restricción que la base de datos rechazó

Una escritura que Postgres rechaza por un motivo derivado de los *datos del emisor* responde
con el SQLSTATE en el código: `PG_23505`, `PG_23503`, etc. Se trata de una
familia, no de una lista estática (Postgres define cientos de SQLSTATEs), pero solo dos
clases la alcanzan, puesto que solo esas dos son atribuibles al emisor:

- **clase 23**, infracción de restricción de integridad: un duplicado, una clave foránea que
  apunta a la nada, una columna NOT NULL que se deja vacía;
- **clase 22**, excepción de datos: un valor que el tipo de la columna no puede almacenar.

Todo lo demás (una conexión caída, una columna faltante, un problema de privilegios)
corresponde al servidor y permanece como un `500`. Por tanto, `code.startsWith("PG_")` es una comprobación
segura para identificar que "la fila que envié era incorrecta", y las cuatro listadas a continuación son las que
un cliente encuentra en la práctica. `details.dbCode` contiene el mismo SQLSTATE para todas ellas, y
el mensaje nombra la restricción.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | No se pudo interpretar un valor con el tipo de la columna: el equivalente en escritura de `INVALID_FILTER_VALUE`. | Envía un valor correspondiente al tipo de la columna. |
| `PG_23502` | 400 | Se dejó vacía una columna `NOT NULL`. | Envía el campo o asigna un valor por defecto a la columna. |
| `PG_23503` | 400 / 409 | Al guardar, una clave foránea apunta a una fila inexistente (400). Al eliminar, otras filas siguen haciendo referencia a esta (409; una clave `RESTRICT` genera `PG_23001`, también 409). | Crea la fila de destino primero o corrige el id; al eliminar, elimina o reapunta primero las filas que hacen referencia a ella. |
| `PG_23505` | 409 | Se infringió una restricción de unicidad. El mensaje especifica la restricción. | Usa un valor diferente o actualiza la fila existente. |

## Almacenamiento

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `INVALID_LIST_OPTIONS` | 400 | El parámetro `maxResults` de un listado de almacenamiento no es un número entero mayor o igual a 1, o su `pageToken` no fue emitido por la fuente. Un tamaño de página inferior a uno solía devolver una página vacía con el mismo token, provocando bucles `while (pageToken)` infinitos. | Envía un `maxResults` positivo y devuelve `nextPageToken` sin modificaciones. |
| `INVALID_STORAGE_BUCKET` | 400 | El nombre del bucket está mal formado. | Comprueba el nombre. |
| `INVALID_STORAGE_KEY` | 400 | La clave del objeto está mal formada, escapa de su prefijo o se encuentra bajo un prefijo reservado (`_rebase/renditions/`, `_rebase/maintenance/`). | Comprueba la clave. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | Los parámetros de transformación de imagen están fuera de rango o son contradictorios. | Consulta [Almacenamiento](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | La subida supera los `maxBytes` declarados por la columna de destino `col.storage()`. Se valida en el servidor, no solo en el navegador. `details` contiene la columna, el límite y el tamaño real. | Sube un archivo más pequeño o aumenta `maxBytes` en la columna. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | El tipo de archivo subido no está en la lista `accept` de la columna ni en el `allowedMimeTypes` de la propia fuente de almacenamiento. `details` contiene la columna (o la lista de la fuente), la lista aceptada y el content-type enviado. | Sube un tipo aceptado o amplía `accept` / `allowedMimeTypes`. |
| `STORAGE_MISCONFIGURED` | 502 | El bucket S3 o GCS con el que está configurada esta fuente no existe, o el proveedor rechazó las credenciales de este despliegue para acceder a él. El mensaje nombra el bucket; `details.reason` es `NoSuchBucket` o el rechazo del proveedor. Antes, un bucket no encontrado se interpretaba como "archivo no encontrado" para cualquier archivo. | Corrige el nombre del bucket (`S3_BUCKET` / `GCS_BUCKET`, `__<KEY>` para fuentes con nombre) o los permisos de las credenciales. |
| `STORAGE_NOT_CONFIGURED` | 501 / 503 | No hay un backend de almacenamiento configurado en este servidor, o ninguno es el predeterminado y la solicitud no nombra ninguna fuente de almacenamiento; el mensaje lista las fuentes activas (501). Una subida reanudable cuya fuente desapareció antes de completarse devuelve 503. | Configura S3, GCS o almacenamiento local, o especifica una fuente con `?storageId=`. |
| `STORAGE_SAME_LOCATION` | 400 | `POST /api/admin/storage/move` con `deleteSource` (`rebase storage move --delete-source`) entre dos fuentes que almacenan en el mismo bucket o directorio. Todos los archivos constarían como ya presentes en el destino por tratarse del mismo archivo, y borrar la copia de origen eliminaría la única existencia. Nada fue movido ni eliminado. | Apunta la columna a la otra fuente; sus archivos ya se encuentran allí. |
| `STORAGE_SCAN_INCOMPLETE` | 409 | `DELETE /api/admin/storage/orphans` (`rebase storage orphans --delete`) no pudo leer todas las tablas, por lo que un archivo referenciado por alguna de ellas parecería huérfano. Con `?scan=`, el escaneo indicado es el que no pudo leer todas las tablas. No se eliminó nada; `details.unscanned` especifica cada tabla y por qué no pudo leerse. | Soluciona lo que impide leer esas tablas y ejecuta la acción nuevamente. |
| `STORAGE_SCAN_NOT_FOUND` | 404 | `GET /api/admin/storage/orphans/scans/:id` o `DELETE /api/admin/storage/orphans?scan=:id` especifica un escaneo que la fuente no conserva. Los escaneos se guardan durante 7 días en la fuente analizada, por lo que un `storageId` distinto al del escaneo tampoco encontrará nada. | Pasa el `storageId` del escaneo o inicia otro escaneo. |
| `STORAGE_SCAN_NOT_COMPLETE` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` especifica un escaneo que aún está en estado `queued` o `running`, o que ha fallado (`failed`). No se eliminó nada; `details.status` aclara el estado. | Espera a que el escaneo finalice o inicia otro. |
| `STORAGE_SCAN_EXPIRED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` especifica un escaneo finalizado hace más de 15 minutos. No se eliminó nada. | Inicia otro escaneo y elimina desde él. |
| `STORAGE_SCAN_DELETION_STARTED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` especifica un escaneo cuyos archivos huérfanos ya están en proceso de eliminación. | Consulta el estado `deletion` del escaneo mediante `GET /api/admin/storage/orphans/scans/:id`. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | La fuente de almacenamiento está declarada pero carece de credenciales en este entorno. | Configura las variables de entorno de dicha fuente. |
| `STORAGE_WRITE_FAILED` | 502 | El backend de almacenamiento rechazó o interrumpió la escritura. | Revisa sus propios registros de log y credenciales. |
| `TRANSFORM_OVERLOADED` | 503 | Hay demasiadas transformaciones de imagen en curso simultáneamente. | Reintenta; considera interponer una CDN por delante. |
| `UNKNOWN_STORAGE_SOURCE` | 400 / 404 | La solicitud especificó una fuente de almacenamiento (`?storageId=`) no declarada por este proyecto. Un `bucket` no servido por este despliegue devuelve este mismo código con estado **404** (en listados, subidas, carpetas o subidas reanudables a S3 o GCS): lo que falta es el contenedor, y `details` especifica los buckets y fuentes que sí existen. Ambos solían responder antes "archivo no encontrado", idéntico a una clave que simplemente no existe. | Declara la fuente en `config/resources.ts` o consulta `GET /api/storage/sources`. |
| `UPLOAD_LOCKED` | 423 | Se recibió el `PATCH` de una subida reanudable mientras aún se recibía otro fragmento de la misma subida (casi siempre un cliente reintentando un fragmento en tránsito). Se rechaza en vez de encolarse, siguiendo el comportamiento de tusd. | Solicita el desplazamiento actual con `HEAD /api/storage/tus/:id` y reanuda desde allí; tus-js-client gestiona la espera y el reintento por su cuenta. Consulta [Subidas reanudables (TUS)](/docs/backend/storage-resumable-uploads/). |

## Funciones personalizadas

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | No se sirve ninguna función con ese nombre, o bien existe pero sus propias rutas no contemplan la ruta posterior. A un emisor autenticado se le informa además qué *está* disponible; a uno anónimo no, ya que esa lista representa un inventario de todos los endpoints personalizados. Cuando un archivo con ese nombre no pudo cargarse, el mensaje se lo notifica al usuario autenticado mencionando el archivo: esa es la diferencia entre un error tipográfico y un fallo de despliegue. Un emisor anónimo recibe la respuesta estándar de nombre desconocido, como si no coincidiera con nada. | Comprueba el nombre contra `GET /api/functions` o revisa el log de arranque para detectar archivos no cargados. |
| `FUNCTION_TIMEOUT` | 504 | El controlador superó su tiempo de espera límite. Sigue ejecutándose; no puede cancelarse desde este punto. | Asigna un `AbortSignal` a las llamadas salientes o incrementa `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Este proceso actúa como proxy de funciones hacia otro que no respondió. | Comprueba que la unidad de funciones esté en ejecución. |

## Tareas programadas (Cron jobs)

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `CRON_JOB_ALREADY_EXECUTING` | 409 | Activación manual de una tarea cron que ya se encuentra en ejecución: en el proceso que respondió o en otro que mantiene la concesión de ejecución (lease) de la tarea, como un worker tras un proceso `api`. No se ejecutó nada. La omisión se registra en el historial de la tarea y `details.log` muestra esa entrada; su línea indica el proceso que la ejecuta. | Reintenta cuando finalice dicha ejecución. Consulta [Tareas Cron](/docs/backend/cron-across-instances/#concurrency-guarding). |

## Superficies de administración y edición de esquemas

Estos códigos indican que una característica está desactivada o no configurada, en lugar de
que la solicitud fuera errónea. Cada uno también se reporta en la ruta `/status` correspondiente
con un `200`, permitiendo que un panel deshabilite la opción en gris en lugar de arrojar un error.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | Se invocó una superficie exclusiva de administración en un servidor sin autenticación configurada, impidiendo distinguir entre un administrador y un desconocido. | Define `auth.jwtSecret` o pasa un `AuthAdapter`. |
| `BRANCH_DIFF_STALE` | 409 | Se envió a `POST /api/admin/branches/:name/merge` la huella digital (fingerprint) de un diff que ha quedado obsoleto: la rama o su elemento primario cambiaron en el transcurso. No se escribió nada. | Lee el diff de nuevo, revísalo y fusiona usando su nuevo `fingerprint`. |
| `BRANCH_DIFF_UNSUPPORTED` | 501 | El origen de datos no puede comparar ramas: no tiene SQL o no soporta ramificación (no hay conexión administrativa). | Usa un backend de Postgres con `adminConnectionString` configurado. |
| `BRANCH_MERGE_BLOCKED` | 409 | Una tabla con diferencias no puede fusionarse: añadida o eliminada por la rama, columnas o clave primaria discrepantes, sin clave primaria, demasiadas filas para comparar o reescrita desde que se creó la rama (`TABLE_REWRITTEN`). Una tabla cuyas filas no pudieron cotejarse bloquea la fusión incluso si su recuento marca 0: son desconocidas, no cero. `details.tables` lista cada una con su motivo. No se escribió nada. | Aplica el esquema con tus migraciones primero o fusiona con `skipBlocked: true` para ignorar esas tablas. |
| `BRANCH_MERGE_CONFLICT` | 409 | Se modificaron filas tanto en la rama como en su elemento primario y `onConflict` era `"abort"` (por defecto); o bien el primario rechazó parte de la fusión (una fila cambió mientras tanto, un trigger la omitió, una directiva la ocultó). No se escribió nada. | Elige qué lado prevalece mediante `onConflict: "branch"` o `"target"`, o lee el diff de nuevo. |
| `BRANCH_MERGE_FAILED` | 409 | El elemento primario rechazó las filas de la rama dentro de la sentencia de fusión: una restricción, una etiqueta de enum o una clave foránea existente que las filas de la rama quebrantan, generalmente debido a divergencias entre ambos esquemas. `details` contiene `sqlState`, `table`, `constraint` y `detail`. No se escribió nada. | Analiza los cambios de esquema del diff, alinea el esquema primario con tus migraciones o corrige las filas de la rama antes de fusionar nuevamente. |
| `BRANCH_NOT_FOUND` | 404 | Ninguna rama con ese nombre figura en el registro. | `rebase db branch list` o el panel de Ramas lista las existentes. |
| `CONTRACT_UNAVAILABLE` | 404 | El contrato del proyecto solo se sirve cuando la autenticación está configurada (describe cada tabla y relación). | Configura la autenticación. `/meta/schema-version` siempre está disponible. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | No hay ningún buzón de desarrollo activo. El correo solo se intercepta cuando `SMTP_HOST` no está configurado y `NODE_ENV` no es producción. | Desasigna `SMTP_HOST` en desarrollo o revisa la bandeja de entrada real. |
| `DOCS_UNAVAILABLE` | 404 | <span class="since-badge" data-since="0.31">Desde 0.31</span> `GET /api/docs` se sirve a los emisores a los que `GET /api/schema/tables` les describe las tablas, y este servidor no tiene autenticación configurada, por lo que no hay nadie a quien describírselas. | Configura la autenticación o publica el documento completo para todos con `enableSwagger: true` (`REBASE_ENABLE_SWAGGER=true`). |
| `INVALID_CHANGE` | 400 | El cambio de esquema propuesto no está bien formado. | Consulta el mensaje. |
| `SCHEMA_CHANGE_FAILED` | 400 | La aplicación de un cambio de esquema planificado falló por un motivo no cubierto por códigos más específicos. | Consulta el mensaje; reproduce el fallo subyacente de forma literal. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | El cambio es válido pero no puede aplicarse al esquema en su estado actual. | Consulta el mensaje. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | El repositorio contiene cambios sin confirmar (uncommitted), lo que impide aplicar la modificación con seguridad. | Haz commit o stash y luego reintenta. |
| `SCHEMA_EDIT_REFUSED` | 400 | El editor de esquemas rechazó la edición: lo que cambiaría está escrito en código que no puede reescribir (un spread, una función auxiliar, una clave calculada) o el cambio es de una clase que nunca realiza automáticamente (renombrar una tabla, eliminar la última regla). `details.problems` lista cada uno. No se escribió nada. | Consulta el mensaje. Realiza el cambio manualmente en `backend/schema`. |
| `SCHEMA_EDIT_DOES_NOT_COMPILE` | 400 | <span class="since-badge" data-since="0.31">Desde 0.31</span> La edición es factible, pero el esquema resultante no compilaría: una relación hacia una tabla que se elimina, una regla que nombra una columna retirada. `details.problems` muestra las observaciones del compilador con su respectiva tabla y columna. No se escribió nada. | Modifica primero las tablas de las que depende o haz el cambio a mano en `backend/schema`. |
| `SCHEMA_EDIT_STALE_FILE` | 409 | Un archivo que la edición debe reescribir cambió en el disco desde que se preparó la modificación (guardado en IDE, otro proceso). No se escribió nada. | Recarga y vuelve a preparar la edición sobre el archivo en su estado actual. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Una clave de API u otra entidad automatizada intentó aplicar un cambio de esquema. | Inicia sesión como usuario o configura `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | La edición de esquema en caliente requiere `schemaDir` (el directorio `backend/schema`) o `liveSchema.repository`, y este servidor arrancó sin ninguno. El código mantiene su denominación heredada. | Configura uno de ellos. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | La planificación funciona, pero no existe un repositorio donde confirmar el cambio: un despliegue ejecutando un bundle empaquetado o un servidor cuyo `backend/schema` no está dentro de ningún repositorio git (la aplicación de cambios siempre se confirma vía commit). | Ejecuta `git init` en el proyecto y reinicia el servidor (el repositorio se detecta al arrancar) o configura `liveSchema.repository`. |
| `SCHEMA_EDITING_PROVISIONING_OFF` | 409 | Este despliegue no aplica cambios sobre su base de datos (`REBASE_PROVISION=false`), por lo que no es posible aplicar modificaciones desde el panel. | Confírmalo únicamente en el código fuente y permite que el proceso a cargo de la base de datos lo aplique. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Este controlador no puede planificar cambios de esquema. | La edición en vivo está disponible en Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | Aquí las tablas se introspeccionan desde la base de datos, por lo que no existen archivos fuente que editar. | Modifica el esquema mediante una migración. |
| `SCHEMA_EDITOR_DISABLED` | 501 | El editor de esquemas está deshabilitado en este servidor. Un bundle empaquetado siempre responde esto. | Habilítalo con `schemaEditor`. En un bundle empaquetado, configura `REBASE_LIVE_SCHEMA_REPOSITORY` para editar `backend/schema` a través de un repositorio; consulta [Edición de esquemas en vivo](/docs/backend/live-schema-editing#from-a-built-bundle). |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | El editor de esquemas requiere `ts-morph`, el cual no está instalado. | Instálalo en el paquete que ejecuta el backend y reinícialo: `pnpm --dir backend add -D ts-morph@28.0.0` desde la raíz de un proyecto estructurado o `pnpm add -D ts-morph@28.0.0` donde el backend sea la raíz. El mensaje indica el comando específico para tu proyecto. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | El servidor carece de `schemaDir`, de modo que el editor no tiene dónde escribir. El código mantiene su denominación heredada. | Configura `schemaDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | El editor se desactiva bajo `NODE_ENV=production`: los archivos de un servidor desplegado se reconstruyen desde tu repositorio en cada despliegue, por lo que una modificación aquí se perdería. | Edita `backend/schema` en desarrollo y despliega, o configura `liveSchema.repository` para confirmar allí los cambios. |
| `SCHEMA_UNAVAILABLE` | 404 | <span class="since-badge" data-since="0.31">Desde 0.31</span> `GET /api/schema/tables` en un backend sin autenticación configurada: no existe un emisor para el cual filtrar u ocultar las tablas, y `auth.requireAuth: false` no altera esto. | Configura un adaptador de autenticación o `auth.jwtSecret`. Consulta [Endpoints](/docs/backend/endpoints/#schema). |
| `TABLE_NOT_FOUND` | 404 | <span class="since-badge" data-since="0.31">Desde 0.31</span> `GET /api/schema/tables/:slug` especifica una tabla no servida a este emisor: no existe bajo ese slug o los ámbitos de su credencial no la cubren. | Comprueba el slug y los ámbitos `data:*` de la credencial. |
| `UI_PREFERENCES_NEED_A_PERSON` | 403 | <span class="since-badge" data-since="0.31">Desde 0.31</span> Se invocó `/api/admin/ui-config` usando una clave de API, un token de plataforma o la clave de servicio. Las preferencias de interfaz corresponden a una persona autenticada. | Inicia sesión como usuario. |
| `UI_PREFERENCES_TOO_LARGE` | 413 | <span class="since-badge" data-since="0.31">Desde 0.31</span> Las preferencias de UI de una tabla superan los 64 KB. | Guarda menos datos: las preferencias deben almacenar presentación, no información. |
| `UI_PREFERENCES_UNSUPPORTED` | 501 | <span class="since-badge" data-since="0.31">Desde 0.31</span> El controlador de este backend no puede ejecutar SQL, por lo que no guarda preferencias de UI; el panel las preserva en el navegador. | Nada que corregir: las preferencias se mantienen por navegador. |
| `UI_CONFIG_FILE_INVALID` | 500 | <span class="since-badge" data-since="0.31">Desde 0.31</span> `frontend/src/cms/ui-config.json`, donde se guardan las preferencias de UI del espacio de trabajo en desarrollo, no es un JSON válido. | Corrígelo o elimínalo; el panel lo reescribirá en el próximo guardado. |
| `SQL_EXPORT_UNSUPPORTED` | 501 | `POST /api/admin/sql/csv` no puede transmitir resultados por streaming aquí: la base de datos de desarrollo integrada (PGlite) tiene una sola conexión, y mantener un cursor abierto durante la descarga bloquearía las demás consultas; o bien el origen de datos carece de cursores SQL. | Apunta `DATABASE_URL` hacia una instancia de Postgres propia (`rebase dev --docker` inicia una) o añade un `LIMIT` y exporta las filas en pantalla. |

### Reconciliación de esquema

<span class="since-badge" data-since="0.31">Desde 0.31</span>

[`rebase schema reconcile`](/docs/cli/schema/#rebase-schema-reconcile) genera el plan
mediante `POST /api/admin/schema/reconcile/plan` y lo aplica a través de
`/reconcile/apply`. Una denegación no modifica nada; únicamente `SCHEMA_RECONCILE_FAILED`
deja partes del plan aplicadas.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `INVALID_RECONCILE` | 400 | El cuerpo no es un objeto JSON o `drop` no es una lista de cadenas `"<table>.<column>"`. | Envía `{ "drop": ["voice_cache.wav"] }` o prescinde de `drop`. |
| `SCHEMA_RECONCILE_FAILED` | 400 | Una sentencia falló a mitad de camino. Las sentencias previas se ejecutaron y permanecen aplicadas; `details.applied` las lista. | Resuelve lo indicado en el mensaje y vuelve a planificar: el nuevo plan omitirá lo ya aplicado. |
| `SCHEMA_RECONCILE_INVALID` | 400 | El plan no se puede aplicar y el mensaje lista las razones: un elemento de `drop` no tiene el formato `<table>.<column>`, no referencia ninguna tabla o columna, o menciona una columna que la tabla todavía declara. `details.plan` contiene el plan. | Corrige la lista `drop`. Una columna declarada se elimina quitándola de su `defineTable`, desplegando y luego reconciliando. |
| `SCHEMA_RECONCILE_STALE` | 409 | La base de datos o las tablas sufrieron cambios desde el plan que confirmaste. `details.plan` contiene el nuevo. | Examina el nuevo plan y confirma su `digest`. |
| `SCHEMA_RECONCILE_UNCONFIRMED` | 400 | No se envió `confirm` a `/reconcile/apply`. | Planifica primero y envía el `digest` del plan como `confirm`. La CLI realiza esto automáticamente al escribir `yes`. |
| `SCHEMA_RECONCILE_UNSUPPORTED` | 503 | El controlador de este backend no puede planificar una reconciliación o no puede ejecutar SQL. | La reconciliación funciona en Postgres. |

### Por qué no se puede fusionar la tabla de una rama

`BRANCH_MERGE_BLOCKED` enumera en `details.tables` cada tabla rechazada, usando uno
de estos códigos. El mismo código figura en la propiedad `blocked` de la tabla en el propio diff,
permitiendo que Studio lo señale antes de que alguien presione **Merge**. Ninguno es una respuesta
aislada por sí mismo.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `COLUMNS_DIFFER` | — | Las columnas de la tabla difieren entre la rama y su primario. Las filas se comparan únicamente sobre las columnas compartidas. | Añade las columnas faltantes al primario mediante tus migraciones (`rebase db push`) y luego fusiona. Una migración que reescriba la tabla (como cambiar el tipo de una columna) la convertirá en `TABLE_REWRITTEN`: fusiona antes de aplicar dicho cambio o recrea la rama tras haberlo hecho. |
| `NO_PRIMARY_KEY` | — | La tabla no tiene clave primaria, impidiendo comparar las filas una a una; el diff únicamente refleja los conteos de filas. | Asigna una clave primaria a la tabla o transfiere sus filas manualmente. |
| `PRIMARY_KEY_DIFFERS` | — | Las columnas de la clave primaria o sus tipos difieren entre ambos lados. | Aplica el esquema al primario primero. |
| `TABLE_ADDED` | — | La rama creó la tabla. Una fusión nunca crea tablas. | Créala en el primario mediante tus migraciones y luego fusiona sus filas. |
| `TABLE_DROPPED` | — | La rama eliminó la tabla. Una fusión nunca elimina tablas. | Elimínala mediante tus migraciones. |
| `TABLE_REWRITTEN` | — | Uno de los lados reescribió por completo las filas de la tabla tras crearse la rama (cambio de tipo de columna, `ADD COLUMN` con valor por defecto volátil, `VACUUM FULL`, `CLUSTER`), por lo que todas las filas constan como modificadas desde entonces y no se puede distinguir qué lado cambió cuál fila. | Fusiona la rama antes de aplicar dicha migración o vuelve a crear la rama a partir del primario después de ella. |
| `TOO_LARGE` | — | La tabla contiene más filas en un lado de las que un diff puede comparar una a una (100.000 por defecto, `maxRowsPerTable`). | Aumenta `maxRowsPerTable` tanto en el diff como en el merge, o transfiere las filas por otro medio. |

## Códigos genéricos

Una ruta recurre a uno de estos códigos cuando no aplica ninguno más específico.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Solicitud mal formada sin ningún código más específico aplicable. | Consulta el mensaje. |
| `UNAUTHORIZED` | 401 | No autenticado o credencial rechazada. | Inicia sesión o renueva credenciales. |
| `FORBIDDEN` | 403 | Autenticado pero no autorizado. | Reintentar con la misma identidad no servirá de nada. |
| `CONFLICT` | 409 | Conflicto con el estado actual del recurso. | Consulta el mensaje. |
| `INTERNAL_ERROR` | 500 | Fallo interno en el servidor. El mensaje es genérico intencionadamente. | Menciona el `requestId`; la causa detallada se encuentra en los logs. |
| `NOT_CONFIGURED` | 503 | Una dependencia necesaria para esta ruta no está configurada en este servidor. | Consulta el mensaje. |
| `SERVICE_UNAVAILABLE` | 503 | Un servicio externo del cual depende la solicitud no pudo alcanzarse: un bucket S3 o MinIO, o un host al que una función llama mediante `fetch()` que rechaza la conexión o no se resuelve. El log del servidor indica el host; la respuesta no. Una base de datos inalcanzable devuelve `DATABASE_UNAVAILABLE`. Una conexión fallida hacia dicho servicio devuelve este error. | Reintenta; comprueba los logs. |

## Cómo mantener la veracidad de esta página

`pnpm verify:docs` falla si falta algún código emitido por el servidor
en estas tablas, si una tabla incluye un código inexistente, si los estados HTTP de una fila no
coinciden exactamente con aquellos con los que el código fuente lo emite, o si una familia de códigos como `PG_<SQLSTATE>` carece de fila
para un SQLSTATE habitual para los clientes. El script a cargo es
`tooling/scripts/docs-verify/check-error-codes.mjs`.

La verificación comprueba su propia integridad primero. El escaneo lee los códigos directamente desde TypeScript en lugar de hacerlo desde
un servidor en ejecución, por lo que sus ángulos muertos son silenciosos por diseño: en el pasado
no detectó un código pasado por un wrapper de una línea, o uno escrito tras un mensaje
que contenía un `)`, reportando "todos los códigos que el servidor puede emitir están documentados"
sobre una página a la que le faltaban diecisiete de ellos. En consecuencia, el script ejecuta un fixture con exactamente
dichos patrones antes de leer esta página y se niega a validar nada si no es capaz de verlos.
