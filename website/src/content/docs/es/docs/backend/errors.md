---
sourceHash: b8772b5c20745be6
title: Códigos de error
sidebar_label: Códigos de error
description: Cada código de error que un backend de Rebase puede devolver, con su estado HTTP, qué significa y qué hacer al respecto — además del sobre de respuesta, X-Request-ID y las reglas de details.
---

Cada fallo que devuelve un backend de Rebase utiliza un único sobre y contiene un
`code` estable. El código es el elemento sobre el que realizar bifurcaciones condicionales: el mensaje está escrito para una persona
y puede reformularse, el estado es compartido por una docena de problemas diferentes y el
código no es ninguna de esas dos cosas.

## El sobre

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

- **`message`** — legible por humanos. Para un `4xx` es el propio mensaje del servidor; para
  un `5xx` es deliberadamente genérico, porque el texto subyacente puede citar un
  host, un rol o un nombre de columna.
- **`code`** — uno de los valores a continuación. Estable entre versiones menores.
- **`details`** — opcional, y nunca garantizado. Consulta las reglas a continuación.
- **`requestId`** — presente siempre que la solicitud haya pasado por el middleware
  de request-ID, que incluye cada ruta bajo `basePath`.

### `X-Request-ID`

Cada solicitud bajo `basePath` obtiene un ID: la cabecera `X-Request-ID` del llamador
cuando es un UUID; de lo contrario, uno nuevo. Se devuelve en
la respuesta como `X-Request-ID`, se incluye en el sobre de error como `requestId`, y
se adjunta a la línea de registro (log) del servidor para esa solicitud.

Esa es la clave de unión. Cítala en un informe de errores y un operador podrá encontrar la
línea de log exacta que explica el fallo, conteniendo la razón que nunca se mostró
al cliente.

Enviar el tuyo propio es cómo una traza sobrevive a un salto: una pasarela o un ejecutor de trabajos que
reenvíe la cabecera obtiene un único ID en cada servicio que procesó la solicitud.
Un valor no válido se ignora en lugar de rechazarse — no vale la pena fallar una solicitud por una cabecera
malformada de un llamador —, así que no asumas que el ID que enviaste es
el ID que recibiste. Lee la cabecera de respuesta.

### Qué hay en `details`

`details` es de diagnóstico, no contractual. Tres reglas lo rigen:

1. **Cualquier cosa que una ruta establezca explícitamente se devuelve siempre.** Estos son los
   propios errores del llamador descritos con precisión: qué campo de filtro era desconocido,
   qué relación no es escribible, qué valor no encajaba en su tipo.
2. **Los diagnósticos de la base de datos se recortan en producción.** Cuando el fallo proviene
   de Postgres, `details.dbCode` — el SQLSTATE — siempre está presente: nombra
   la clase de problema y no revela nada sobre los datos. `dbMessage`,
   `detail` y `hint` se añaden únicamente cuando `NODE_ENV` no es `production`,
   porque Postgres incluye contenidos de las filas en ellos. `23505` informa
   `Key (email)=(a@b.c) already exists.`, lo cual responde "¿está esta persona
   registrada?" para cualquier dirección que cualquiera decida probar.
3. **Nunca hagas bifurcaciones condicionales basadas en `details`.** Hazlas basándote en `code`. Lo que está bajo `details` es
   cualquier cosa que haya sido útil para una persona en ese punto de llamada, y puede cambiar.

## Interpretación de un estado

| Estado | Qué dice sobre la solicitud |
| --- | --- |
| `400` | Malformada, o solicita algo que no existe en el esquema. Corrige la solicitud. |
| `401` | No autenticado, o la credencial ha expirado. Inicia sesión o renueva el token. |
| `403` | Autenticado, y no permitido. Reintentar con la misma identidad no servirá de nada. |
| `404` | No existe tal ruta, tabla o fila — o es una fila que la seguridad a nivel de fila (RLS) oculta. |
| `409` | Un conflicto con el estado existente: un duplicado o una escritura concurrente. |
| `413` `415` `422` | El cuerpo es demasiado grande, el tipo de medio es incorrecto o fue rechazado semánticamente. |
| `429` | Límite de tasa excedido (Rate limited). Reduce la frecuencia; el mensaje indica por cuánto tiempo. |
| `500` | El servidor o su base de datos son los que fallan, no el llamador. Revisa los registros (logs). |
| `501` | La ruta existe, pero este despliegue no puede atenderla — una funcionalidad desactivada o sin configurar. |
| `502` `503` `504` | Una dependencia no estaba disponible, estaba sin configurar o fue demasiado lenta. |

## Autenticación y cuentas

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | La ruta necesita un segundo factor y la sesión solo tiene uno. | Completa el desafío MFA, luego reintenta. |
| `ALREADY_VERIFIED` | 400 | La dirección o el factor ya están verificados. | Nada — el estado deseado ya es verdadero. |
| `ACCOUNT_OUTRANKS_CALLER` | 403 | La cuenta que se intenta editar, restablecer o eliminar posee un rol o alcance (scope) que el llamador no tiene. `details.beyond` los nombra. | Haz que alguien que los posea realice el cambio. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | El inicio de sesión anónimo está desactivado en este servidor. | Habilítalo, o inicia sesión con una identidad real. |
| `ANONYMOUS_NOT_ALLOWED` | 403 | Una sesión de invitado intentó aprobar un inicio de sesión de dispositivo. Un invitado no tiene cuenta para prestar a un dispositivo. | Inicia sesión con una cuenta y luego apruébalo. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Una clave de API intentó listar, crear, modificar o revocar claves de API, ya sean de su propio tipo o personales. | Gestiona claves como una persona con `keys:write`, o con la clave de servicio. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Una ruta protegida se ejecutó sin ningún middleware de autenticación de Rebase previo, por lo que la credencial del llamador nunca se examinó. | Monta la aplicación a través del enrutador de funciones en lugar de montarla directamente en tu propio servidor. |
| `BOOTSTRAP_ANONYMOUS` | 403 | El inicio inicial (bootstrap) del primer administrador fue intentado por un llamador anónimo. | Inicia sesión primero. |
| `BOOTSTRAP_COMPLETED` | 403 | El primer administrador ya existe. | Haz que un administrador existente otorgue el rol. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | El bootstrap es solo para el primerísimo usuario, y este no lo es. | Haz que un administrador existente otorgue el rol. |
| `CAPTCHA_FAILED` | 400 | El proveedor rechazó el token de CAPTCHA. | Resuelve un nuevo desafío. |
| `CAPTCHA_REQUIRED` | 400 | La ruta requiere un token de CAPTCHA y no se envió ninguno. | Incluye el token. |
| `CHALLENGE_EXHAUSTED` | 401 | Demasiados códigos incorrectos para un desafío MFA. | Inicia un nuevo desafío. |
| `CONFIRMATION_REQUIRED` | 400 | Se llamó a una operación DDL destructiva (`DELETE /api/admin/db/tables/:table` o `DELETE …/columns/:column`) sin `{ confirm: "<name>" }`. | Reenvía con el nombre de destino exacto en `confirm`, o pasa `dryRun: true` para previsualizar el SQL. |
| `DDL_REJECTED` | 400, o 409 cuando el objeto ya existe | PostgreSQL rechazó una sentencia que `/api/admin/db/*` ejecutó por ti — un tipo, un valor por defecto, una condición de política, un nombre ya en uso. El mensaje es propio de Postgres, y `details.dbCode` es su SQLSTATE. | Modifica lo que indique el mensaje y envía la solicitud de nuevo; `dryRun: true` muestra el SQL primero. |
| `DEVICE_LOGIN_DECIDED` | 409 | El inicio de sesión de dispositivo ya fue aprobado o denegado. Un inicio de sesión se decide una sola vez. | Inicia uno nuevo en el dispositivo. |
| `DEVICE_LOGIN_EXPIRED` | 410 | El inicio de sesión de dispositivo superó sus diez minutos antes de ser decidido. | Inicia uno nuevo en el dispositivo. |
| `DEVICE_LOGIN_NOT_FOUND` | 404 | Ningún inicio de sesión de dispositivo tiene ese código de usuario. El sondeo del dispositivo en sí responde con los códigos en minúsculas del RFC 8628: `authorization_pending`, `slow_down`, `access_denied`, `expired_token`, `invalid_grant`. | Verifica el código con el que muestra el dispositivo. |
| `EMAIL_EXISTS` | 409 | Ya existe una cuenta con esa dirección — en el registro, en un cambio de dirección, o al seguir un enlace de cambio de dirección cuando otra cuenta tomó la dirección mientras esperaba. | Inicia sesión o inicia un restablecimiento de contraseña; para un cambio de dirección, elige otra. |
| `EMAIL_NOT_CONFIGURED` | 503 | Se solicitaron enlaces mágicos u OTP y el servidor no tiene transporte de correo configurado. | Configura SMTP o usa otro método de inicio de sesión. |
| `EMAIL_NOT_VERIFIED` | 403 | Un inicio de sesión OAuth encontró una cuenta con la misma dirección y el proveedor no verificó esa dirección, por lo que no está vinculada. | Inicia sesión con el método existente y luego ejecuta `POST /auth/link/<provider>`. |
| `CSRF_REFUSED` | 403 | La protección CSRF está activada (`csrf: { origin }`) y llegó una solicitud sin encabezado `Authorization` desde un origen que no está en la lista: un envío de formulario autenticado por cookie desde otro sitio, o una solicitud sin cuerpo y sin `Origin`. | Envíala desde un origen permitido, con un cuerpo JSON o con un encabezado `Authorization`. |
| `FACTOR_NOT_VERIFIED` | 400 | El factor MFA fue registrado pero nunca confirmado. | Confirma el factor. |
| `ID_EXISTS` | 409 | Una cuenta ya tiene el id que una importación de cuentas mantiene (`POST /api/admin/users/import`). La importación lo reporta como `skipped` y deja la cuenta como está. | Nada, si la cuenta fue importada previamente. De lo contrario, omite `id` o elige otro. |
| `IDENTITY_ALREADY_LINKED` | 409 | Esa identidad OAuth pertenece a otra cuenta. | Inicia sesión con ella, o desvincúlala de allí primero. |
| `IMPERSONATION_FORBIDDEN` | 403 | Una solicitud envió `x-rebase-impersonate` y su llamador no puede ejecutar una solicitud como otro usuario. Solo la sesión de un administrador autenticado puede hacerlo, nunca una clave de API ni la clave de servicio. | Envíala con la sesión de un administrador, u omite la cabecera. |
| `IMPERSONATION_INVALID` | 400 | `x-rebase-impersonate` se envió vacío. | Envía el uid del usuario a suplantar, u omite la cabecera. |
| `IMPERSONATION_TARGET_NOT_FOUND` | 404 | `x-rebase-impersonate` no nombra a ningún usuario activo: ninguna cuenta tiene ese uid, o está desactivada. | Comprueba el uid. |
| `IMPERSONATION_UNAVAILABLE` | 501 | La autenticación de este backend no puede ejecutar una solicitud como otro usuario porque su `AuthAdapter` no tiene `resolveUser`. | Implementa `resolveUser` en el adaptador, u omite la cabecera. |
| `IMPERSONATION_UNSUPPORTED` | 400 | Se envió `x-rebase-impersonate` a una ruta que no puede ejecutarse como otro usuario. Solo la API de datos y las funciones personalizadas lo admiten, y el socket en tiempo real admite `impersonate` en `AUTHENTICATE`. | Envía la solicitud sin la cabecera. |
| `SIMULATION_FORBIDDEN` | 403 | Una solicitud envió una cabecera `x-rebase-simulate-*` (el simulador RLS), o consultó `/api/admin/rls-simulator`, y su llamador no tiene permiso para simular acceso. Solo la sesión propia de un administrador autenticado puede hacerlo, nunca una clave de API o la clave de servicio. | Envíala con la sesión de un administrador, u omite las cabeceras. |
| `SIMULATION_INVALID` | 400 | La simulación estaba malformada: una cabecera enviada vacía, `x-rebase-simulate-api-key-id` combinado con un rol o id de usuario, o simulación combinada con `x-rebase-impersonate`. | Especifica un rol (opcionalmente con un uid), un id de usuario, o un id de clave de API. |
| `SIMULATION_READ_ONLY` | 403 | Una escritura, eliminación, `_batch`, reversión de historial o una función personalizada llamada con cualquier verbo distinto de `GET`/`HEAD`/`OPTIONS` incluyó una cabecera `x-rebase-simulate-*`. El acceso simulado es de solo lectura: la escritura se ejecutaría como la identidad simulada, no como el administrador. Las lecturas, incluyendo `POST …/query` y `…/count`, siguen ejecutándose. | Deja de simular para realizar cambios. |
| `SIMULATION_TARGET_NOT_FOUND` | 404 | La simulación no nombra a ningún usuario activo (un id de usuario enviado sin rol) o a ninguna clave de API activa. | Comprueba el id, o envía un rol con el uid para simular un uid que no tiene cuenta. |
| `SIMULATION_UNAVAILABLE` | 501 | Este backend no puede simular acceso: su `AuthAdapter` no tiene `resolveUser` para confirmar a un administrador, o se especificó una clave en un backend sin claves de API. | Implementa `resolveUser`, u omite las cabeceras. |
| `SIMULATION_UNSUPPORTED` | 400 | Se envió una cabecera `x-rebase-simulate-*` a una ruta que no puede ejecutarse con acceso simulado. Solo la API de datos y las funciones personalizadas las admiten. | Envía la solicitud sin las cabeceras. |
| `GUEST_REFERENCED` | 409 | Un invitado no pudo eliminarse porque una fila propia del proyecto lo requiere mediante una clave foránea con `ON DELETE RESTRICT` o `NO ACTION`. `DELETE /api/admin/guests` lo reporta por invitado en `skipped` y continúa. | Elimina la fila, o conserva al invitado. |
| `INVALID_ACCOUNT` | 400 | La cuenta está en un estado sobre el cual esta operación no puede actuar. | Consulta el mensaje. |
| `INVALID_CHALLENGE` | 400 | El desafío MFA es desconocido o ha expirado. | Inicia uno nuevo. |
| `INVALID_CODE` | 400 / 401 | El código OTP o MFA es incorrecto: 400 desde el inicio de sesión con código por correo (`/auth/otp/verify`), 401 desde un registro o desafío MFA. | Reintenta con el código actual. |
| `INVALID_CREDENTIALS` | 401 | Correo electrónico o contraseña incorrectos — omitiendo deliberadamente cuál de los dos. | Reintenta o restablece la contraseña. |
| `INVALID_PLATFORM_TOKEN` | 401 | Se rechazó un token de plataforma `rpt_`: firma incorrecta, audiencia errónea, expirado o tiempo de vida por encima del límite. El mensaje indica cuál fue el motivo. | Haz que la plataforma genere uno nuevo — en Rebase Cloud, ejecuta el comando de nuevo. |
| `INVALID_SCOPES` | 400 | Se solicitó para una clave algo que no es un alcance: malformado, desconocido o con un destino que el alcance no admite. `details.problems` dice cuál y por qué; `details.validScopes` lista los alcances que una clave puede poseer. Excluye `keys:read` y `keys:write`, que ninguna clave puede tener. | Usa un nombre de la lista. Consulta [Roles and scopes](/docs/backend/roles-and-scopes/). |
| `INVALID_TOKEN` | 400 / 401 | Un token de verificación, restablecimiento, enlace mágico o cambio de dirección está malformado, es desconocido, ya fue usado o ha expirado (400). Una credencial de proveedor OAuth o un token de actualización que no se verifica es un 401. | Solicita un enlace nuevo o inicia sesión otra vez. |
| `INVALID_USER_CODE` | 400 | Lo que se envió como código de inicio de sesión de dispositivo no lo es: ocho letras, como `BCDF-GHJK`. | Copia el código que muestra el dispositivo. |
| `INVALID_ID` | 400 | El `id` de una cuenta importada no es válido para una cuenta: vacío, más de 128 caracteres, contiene caracteres fuera de letras, dígitos y `_ - . : \|`, es un id reservado (`service`, `anonymous`), o es un valor que la columna id de la tabla de usuarios no puede contener (no es un uuid en una columna `uuid`). | Corrige el id, u omítelo y deja que la tabla genere uno. |
| `INVALID_ROLE` | 400 | El nombre de rol que se intenta escribir no es una cadena, está vacío o contiene `,` `{` `}` `"` `\` o un carácter de control. Esos caracteres se interpretarían al leerlos como otros roles: un rol viaja en un `text[]` de Postgres y en la lista unida por comas que las políticas RLS dividen, por lo que `"support,admin"` volvería como `admin`. `details.problems` nombra cada uno. | Renombra el rol. Cualquier otro nombre es aceptado. |
| `KEY_MANAGEMENT_SCOPE` | 400 | Se solicitó `keys:read` o `keys:write` para una clave. Ninguna clave puede gestionar claves. `details.scopes` los nombra. | Omítelos. |
| `KEY_OUTRANKS_CALLER` | 403 | Un poseedor de `keys:write` intentó modificar o revocar una clave de servicio que posee un rol o alcance que este no tiene. Solo un administrador gestiona cualquier clave. `details.roles` y `details.scopes` nombran lo que la clave posee más allá del llamador. | Haz que un administrador, o alguien que los posea, modifique la clave. |
| `LAST_ADMIN` | 403 | El cambio dejaría al proyecto sin administradores. | Promueve a alguien más primero. |
| `MFA_REQUIRED` | 401 | La contraseña fue correcta y la cuenta tiene un segundo factor verificado, por lo que el inicio de sesión solo está a medio completar. `details` contiene un token de corta duración limitado al desafío MFA — no es una sesión. | Abre un desafío y respóndelo; la respuesta al desafío emite la sesión. |
| `NO_SESSION` | 401 | No se presentó ninguna cookie de sesión ni token de actualización. Normal en la primera carga de página. | Inicia sesión. |
| `NOT_ANONYMOUS` | 400 | Una ruta de actualización desde usuario anónimo fue llamada por una cuenta real, o `DELETE /api/admin/guests/:uid` especificó una. | Nada que actualizar. Para eliminar una cuenta, usa `DELETE /api/admin/users/:uid`. |
| `OAUTH_ERROR` | 401 | El proveedor de OAuth rechazó la solicitud o devolvió un error. | Reintenta el flujo; el mensaje contiene la razón dada por el proveedor. |
| `PERSONAL_KEYS_DISABLED` | 403 | Las claves de API personales están desactivadas en este backend. | Configura `personalKeys: true` en las opciones `auth` de la tabla de autenticación (`defineAuthTable`). |
| `PERSONAL_KEY_NEEDS_ACCOUNT` | 403 | La clave de servicio o una sesión de invitado intentó usar las rutas de claves personales. Ninguna de las dos tiene una cuenta bajo la cual una clave pueda actuar. | Inicia sesión en una cuenta, o crea una clave de servicio bajo `/api/admin/api-keys`. |
| `PLATFORM_TOKENS_OFF` | 401 | Un token de plataforma `rpt_` llegó a un servidor que no los acepta: `REBASE_PLATFORM_TOKEN_KEY` y `REBASE_PLATFORM_TOKEN_AUDIENCE` no están configurados. | La plataforma que aloja la aplicación configura ambos al desplegar; redespliega o inicia sesión en la aplicación de otra manera. |
| `RATE_LIMITED` | 429 | Demasiados intentos desde este llamador. | Reduce la frecuencia; el mensaje indica por cuánto tiempo. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | El destino de redirección no está en la lista de permitidos. | Añádelo a la configuración del proveedor. |
| `REGISTRATION_DISABLED` | 403 | El autoregistro está desactivado. | Haz que un administrador cree la cuenta. |
| `ROLE_EXCEEDS_CALLER` | 403 | Los roles que se intentan otorgar contienen un alcance, o `admin`, que el llamador no posee. `details.beyond` los nombra. | Haz que alguien que los posea otorgue el rol. |
| `ROLE_EXCEEDS_CREATOR` | 403 | A una clave de servicio se le asignó un rol RLS que su creador no posee. Solo un administrador puede asignar cualquier rol. `details.roles` los nombra. | Quita el rol, o haz que un administrador cree la clave. |
| `ROLE_EXISTS` | 409 | Ese nombre de rol ya está en uso. | Elige otro nombre. |
| `ROLE_LOOKUP_FAILED` | 503 | No se pudieron leer los roles del llamador — en una ruta de administración, o en una solicitud de datos en un backend con `config.auth`. Falla de forma cerrada en lugar de confiar en los roles del token. Un token cuyo uid no nombra ninguna cuenta, incluyendo un uid que la tabla de usuarios no puede alojar, devuelve 401, no este error. Una base de datos inalcanzable devuelve `DATABASE_UNAVAILABLE`, no este error. | Reintenta; verifica la base de datos. |
| `SCOPE_EXCEEDS_CREATOR` | 403 | Se solicitó para una clave un alcance que su creador no posee. Una clave nunca puede tener más privilegios que la cuenta que la crea. `details.scopes` los nombra. | Quítalos, o haz que alguien que los posea cree la clave. |
| `SCOPE_MISSING` | 403 | La credencial no posee el alcance que esta ruta, tabla, origen de almacenamiento o función necesita. `details.requiredScope` lo nombra, destino incluido. | Para una persona, un rol que declare el alcance. Para una clave, una clave que lo posea. Consulta [Roles and scopes](/docs/backend/roles-and-scopes/). |
| `SCOPE_NOT_DECLARED` | 500 | Una ruta protegida con `requireScope` especifica un alcance de aplicación que este backend no declara, por lo que nadie lo posee, ni siquiera un administrador. Un nombre que no es un alcance en absoluto, o uno integrado mal escrito como `data:raed`, nunca llega tan lejos: `requireScope` lanza una excepción en el momento en que se registra la ruta. | Declara el alcance bajo `auth.scopes` en la tabla de autenticación, o corrige el nombre. Consulta [Roles and scopes](/docs/backend/roles-and-scopes/). |
| `SELF_DELETE` | 400 | Un administrador intentó eliminar su propia cuenta. | Haz que otro administrador lo haga. |
| `SESSION_REVOKED` | 401 | La sesión se cerró en otro lugar, o se revocaron todas las sesiones, o la cuenta fue eliminada. Cada punto de entrada que acepta una sesión responderá con esto ante dicho token de acceso: la API de datos, el almacenamiento, las funciones personalizadas y las rutas de administración. El socket en tiempo real rechaza su `AUTHENTICATE` con una trama `AUTH_ERROR` que lleva el mismo código. El SDK intenta refrescar, la renovación es rechazada y cierra la sesión. | Inicia sesión de nuevo. |
| `ACCOUNT_DISABLED` | 401/403 | Un administrador desactivó la cuenta: el inicio de sesión (403), la renovación y cada token que posee (401) son rechazados en cada punto de entrada que acepta sesiones. El socket en tiempo real rechaza su `AUTHENTICATE` con una trama `AUTH_ERROR` que lleva el mismo código. | Consulta con un administrador. |
| `EMAIL_NOT_CONFIRMED` | 403 | `requireEmailVerification` está activado y la dirección aún no ha sido verificada. Solo se responde ante una contraseña correcta; se envía un nuevo enlace por correo. | Sigue el enlace en el correo. |
| `PROOF_REQUIRED` | 409 | `POST /auth/verify-email`: la cuenta contiene una contraseña o identidad que nadie ha probado, y la solicitud no demuestra ninguna de las dos. El token no se consume. | Envía `password` para conservarla, o `removeUnproven: true` para verificar sin ella. |
| `UNDELIVERABLE_ADDRESS` | 400 / 409 | Se solicitó un correo de verificación para una dirección a la que no se puede enviar correo — la de un invitado, o el marcador de posición de X (400) — o una cuenta solicitó cambiar a dicha dirección (409, `POST /auth/change-email`). | Configura una dirección real primero. |
| `EMAIL_UNCHANGED` | 400 | `POST /auth/change-email` especificó la dirección actual de la cuenta. | Nada que cambiar. |
| `ANONYMOUS_USER` | 403 | Un invitado intentó cambiar su dirección de correo; un invitado no tiene ninguna propia. | Conviértelo en una cuenta primero (`POST /auth/anonymous/link`). |
| `MFA_NOT_ENROLLED` | 400 | Se solicitaron códigos de recuperación para una cuenta sin un segundo factor verificado. | Registra un factor primero. |
| `HOOK_REJECTED` | 400 | Un hook `beforeUserCreate`, `beforeLogin`, `beforeUserDelete` o `beforeEmailChange` lanzó una excepción. El mensaje es el del hook; un hook que eligió un estado 4xx responderá con él. | Consulta el mensaje. |
| `INVALID_JSON` | 400 | El cuerpo de la solicitud no es JSON. | Envía un cuerpo JSON. |
| `SELF_DISABLE` | 400 | Un administrador intentó desactivar su propia cuenta. | Pide a otro administrador que lo haga. |
| `NOT_SUPPORTED` | 501 | El repositorio de autenticación de este backend no puede realizar lo solicitado (desactivar cuentas, cambiar una dirección). | Reinicia el servidor para que se agregue la columna, o usa un repositorio que lo soporte. |
| `UNKNOWN_SCOPE_TARGET` | 400 | El destino de un alcance nombra una tabla, origen de almacenamiento o función que este backend no proporciona. `details` lista los que sí proporciona. | Corrige el destino. |
| `UNVERIFIED_IDENTITIES` | 409 | Un enlace mágico, código de correo o restablecimiento de contraseña validó la dirección de una cuenta no verificada, y la cuenta contiene una identidad de inicio de sesión cuyo proveedor nunca verificó esa dirección. El repositorio de autenticación no puede eliminarla (no tiene `unlinkUserIdentity`), por lo que la prueba se rechaza antes que dejar abierta esa vía de acceso en una cuenta verificada. | Implementa `unlinkUserIdentity` en el repositorio de autenticación personalizado, o haz que un administrador revise la cuenta. |
| `SETUP_REQUIRED` | 403 | El proyecto aún no tiene administrador, por lo que esta ruta no está disponible. | Completa la configuración del primer administrador. |
| `TOKEN_ALREADY_USED` | 401 | Se reutilizó un token de un solo uso, o un token de actualización que fue rotado hace más tiempo que `refreshTokenReuseIntervalSeconds`. | Solicita uno nuevo o inicia sesión de nuevo. |
| `TOKEN_EXPIRED` | 401 | El token ha superado su tiempo de vida. | Solicita uno nuevo. |
| `TOO_MANY_USERS` | 400 | Una sola solicitud `POST /api/admin/users/import` contenía más de 100 cuentas. `details.max` indica el límite. | Envíalas en solicitudes de 100; `rebase users import` lo hace así. |
| `USER_NOT_FOUND` | 404 | No existe una cuenta con ese id. | Comprueba el id. |
| `WEAK_PASSWORD` | 400 | La contraseña no cumple con la [política de contraseñas](/docs/backend/auth-endpoints/#password-policy) (por defecto 8+ caracteres con una letra mayúscula, una minúscula y un dígito) — en el registro, restablecimiento o cambio, y en contraseñas elegidas por administradores: `POST /api/admin/users`, una creación en la tabla de autenticación mediante la API de datos, `PUT /api/admin/users/:id` o `POST /api/admin/users/:id/reset-password`. | Elige una más robusta. Un administrador importando cuentas puede enviar `skipPasswordPolicy: true` al crear. |

## Datos, consultas y escrituras

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `AGGREGATE_MASKED_BY_AFTER_READ` | 400 | Una agregación distinta de `count()` sin `groupBy` en una tabla que un hook `afterRead` reescribe (global, tabla o el `.transform()` de una columna). Una agregación lee los valores almacenados y nunca ejecuta el hook, por lo que una suma, mínimo, máximo, conteo de campos o agrupación leería lo que el hook oculta. | Usa `count()` sin `groupBy`, o lee las filas, las cuales sí pasan por el hook. |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Este controlador no puede computar la agregación solicitada. | Usa un controlador que pueda, o calcúlala en el cliente. |
| `BRANCHING_UNSUPPORTED` | — | Se solicitó una rama de base de datos a través del websocket de Studio en la base de datos de desarrollo administrada (PGlite), donde una rama *es* la principal y nada quedaría aislado. El rechazo es el mismo que imprime `rebase db branch`. | Apunta `DATABASE_URL` a un Postgres propio (`rebase dev --docker` inicia uno) y crea ramas allí. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` contiene más operaciones que el límite por lote (1000 por defecto). Un lote es una sola transacción y retiene sus bloqueos durante toda su duración. | Envíalo en fragmentos; el mensaje indica el límite y tu recuento. |
| `BATCH_UNSUPPORTED` | 400 | El controlador de este backend no puede escribir en varias tablas de forma atómica, y un bucle de escrituras individuales no sería ni atómico ni de un solo viaje de ida y vuelta (round trip). | Envía las escrituras como solicitudes separadas, o como llamadas `/bulk` por tabla. |
| `BULK_TOO_LARGE` | 400 | El cuerpo de la operación masiva supera el límite de elementos configurado. | Divide la solicitud. |
| `BULK_UNSUPPORTED` | 400 | Esta tabla o controlador no admite escrituras masivas. | Escribe las filas una por una. |
| `CALLBACK_REJECTED` | 400 / 403 | Un hook de tabla rechazó la escritura. Un `throw` desde `beforeSave`/`beforeDelete`/`after*` devuelve un 400 con el mensaje propio del autor; un `beforeDelete` que retorna `false` devuelve un 403. `details.stage` nombra qué hook, `details.path` la tabla. | Lee el mensaje — fue escrito por este proyecto, no por Rebase. |
| `CALLBACK_RECURSION` | 500 | Las escrituras iniciadas por hooks se anidaron a más de 16 niveles de profundidad: la escritura `context.data` de un hook vuelve a ejecutar los hooks de esa tabla, y nada en la cadena lo detiene — generalmente un `afterSave` que actualiza su propia fila incondicionalmente. Toda la escritura fue revertida (rollback). El mensaje nombra el hook y la tabla; `details.chain` lista cada paso de hook → escritura. | Haz que la escritura del hook sea condicional: actúa solo sobre `status === "new"`, u omítela cuando `values` ya contenga lo que iba a escribir. |
| `COMPOSITE_KEY_ADDRESS` | 400 | La tabla tiene una clave compuesta, y la dirección en la URL especifica un número diferente de sus partes. | Direcciona la fila como `<part1>:::<part2>`, cada parte codificada para URL, en el orden de la clave; `details.primaryKey` lista las columnas. |
| `TABLE_READ_ONLY` | 405 | Una escritura intentó modificar una vista (`defineView`). Una vista es de solo lectura. Anteriormente `COLLECTION_READ_ONLY`. | Escribe en las tablas que la vista consulta. Consulta [Views](/docs/collections/views/). |
| `TABLE_WITHHELD` | 503 | La tabla está declarada, pero la base de datos no la protege: la seguridad a nivel de fila está desactivada, ninguna de las políticas que declara está presente, o falta una política restrictiva declarada. (Una política permisiva faltante sí se atiende, con una advertencia en el arranque nombrándola.) Esto ocurre cuando el servidor no aprovisiona sus tablas (`REBASE_PROVISION=false`, `provisionSchema: false`, `provision.tables: false`, `REBASE_MIGRATE_ON_BOOT=none`), y el servidor retiene la tabla en lugar de exponer cada fila a cada llamador. Una unión muchos a muchos sigue la misma regla: cuando falla, las tablas cuyas relaciones la usan se retienen y el mensaje nombra la unión; lo mismo ocurre con una tabla cuyo `via` pasa a través de una tabla retenida, nombrándola. Una lectura de relación o filtro que pase por una tabla retenida también devuelve este código. Las demás tablas se sirven con normalidad. El registro de arranque indica las sentencias para protegerla. | Aplica las sentencias que indica el log de arranque (`rebase db push` lo hace), luego reinicia. O, si la aplicación gestiona el acceso a esa tabla por sí misma, declara `rlsRequired: false` en ella (o `database({ rls: { required: false } })`) y reinicia. |
| `SQL_NOT_ALLOWED` | 400 | El SQL ejecutado como el llamador (`getSql(c)`, `withAuth(user).sql`) no fue una única sentencia `SELECT`, `WITH`, `VALUES`, `TABLE`, `INSERT`, `UPDATE`, `DELETE` o `MERGE` simple, o llamó a `set_config` o nombró `pg_settings`. La identidad del llamador reside en la configuración de la sesión, por lo que una sentencia que pueda alterarla es rechazada. | Mantén el texto de la consulta propio, una sola sentencia, con cada valor en `params`. Consulta [Custom functions](/docs/backend/custom-functions/#3-getsqlc--sql-as-the-caller). |
| `CURSOR_WITH_OFFSET` | 400 | Se combinó `?after=` con `?offset=` o `?page=`. Un cursor ya indica dónde comienza la página, por lo que un offset sobre él omite silenciosamente esa cantidad de filas después del cursor — un vacío que el llamador no puede percibir en la respuesta. | Usa uno o el otro. |
| `DISTINCT_NOT_APPLICABLE` | 400 | Se combinó `?distinct=true` con una consulta de búsqueda o vectorial. Ambas adjuntan una puntuación por fila, por lo que no hay dos filas iguales y `DISTINCT` no agruparía nada — parecería haber funcionado pero no cambiaría nada. | Descarta uno de los dos. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Una lectura `distinct` está ordenada por una columna que no devuelve. Un `SELECT DISTINCT` solo puede ordenarse por columnas presentes en su lista de selección, o las filas agrupadas no tendrían un orden definido. `details.fields` las nombra. | Añade esos campos a `?fields=`, o quítalos de `?orderBy=`. |
| `DATABASE_UNAVAILABLE` | 503 | No se pudo conectar a la base de datos: la conexión fue rechazada o interrumpida, el host no resolvió, el servidor se está apagando o iniciando, o la base de datos está cerrada para nuevas conexiones (`ALLOW_CONNECTIONS false`, lo que un `rebase db branch create --force` interrumpido a la mitad deja en su origen; el log del servidor nombra la base de datos y `rebase db branch list` la vuelve a abrir). Todos los puntos de entrada responden esto, incluyendo inicio de sesión, rutas de administración y el socket en tiempo real (una trama `ERROR`). Se envía con `Retry-After: 5`. | Reintenta; el SDK lo hace automáticamente. Comprueba que la base de datos esté en ejecución y accesible desde el servidor. |
| `DB_CONNECTIONS_EXHAUSTED` | 503 | El servidor de base de datos rechazó una nueva conexión porque no le quedan disponibles (`53300` demasiados clientes, `53400` límite de conexiones de un rol o base de datos). Todas las instancias de servidor comparten el `max_connections` del servidor, por lo que esto sucede cuando varias instancias con grupos (pools) grandes no usan un gestor de conexiones (pooler). Es carga, no un error de código; se envía con `Retry-After: 2`. El servidor registra la solución una vez por minuto. | Reintenta; el SDK lo hace automáticamente. Reduce `DB_POOL_MAX` (o limítalo con `REBASE_DB_POOL_MAX`) entre instancias, pon un pooler delante de la base de datos (`DATABASE_POOLED`), o aumenta `max_connections`. |
| `DB_CONNECT_TIMEOUT` | 503 | Abrir una nueva conexión a la base de datos tardó más que `DB_POOL_CONNECT_TIMEOUT`: la base de datos tarda en aceptar conexiones o está muy distante. Se envía con `Retry-After`. | Reintenta; el SDK lo hace. Comprueba la carga de la base de datos y la red hacia ella. |
| `DB_PERMISSION_DENIED` | 500 | Postgres rechazó la sentencia (`42501`): ya sea por una política de seguridad a nivel de fila denegando este rol, o por un `GRANT` faltante. | Consulta [Troubleshooting](/docs/troubleshooting/). |
| `DB_POOL_EXHAUSTED` | 503 | Cada conexión agrupada de la base de datos permaneció ocupada durante `DB_POOL_CONNECT_TIMEOUT`, por lo que esta solicitud nunca llegó a la base de datos. Es saturación, no un error de código; se envía con `Retry-After`. El servidor registra la solución una vez por minuto. | Reintenta; el SDK lo hace. Incrementa `DB_POOL_MAX`, o identifica las consultas lentas o transacciones largas que retienen conexiones. |
| `FIELD_NOT_READABLE` | 400 | Un filtro, `orderBy`, `fields`, `select` de agregación o `groupBy` nombra un campo que los roles de este llamador no pueden leer (`access.read`), una ruta anidada o una ordenación de agregación nombra una relación que no pueden leer — o una operación de campo (`$inc`, `$push`, …) apunta a uno, donde un límite rechazado revelaría el valor almacenado. Un campo que ninguna respuesta puede transportar debe ser uno que ninguna consulta pueda interrogar, o el valor sería legible predicado por predicado. Un filtro a través de una relación (`author.salary`) y una ordenación de agregación sobre el campo de una relación (`max(staff.salary)`) se juzgan según la regla del destino. `details.violations` nombra cada campo. El controlador aplica la misma regla a una lectura realizada en el proceso en nombre de un llamador (`context.data` bajo el alcance del llamador), y a una búsqueda vectorial, inclusión o comprobación de unicidad. Una columna `.private()` responde como si no existiese: un filtro, `orderBy`, `fields`, `include`, `select` de agregación o `groupBy`, o `vector_search` que la nombre obtiene exactamente la respuesta que obtendría un nombre mal escrito (`UNKNOWN_FILTER_FIELD`, `UNKNOWN_ORDER_BY_FIELD`, `UNKNOWN_FIELD`, `UNKNOWN_RELATION`, `UNKNOWN_AGGREGATE_FIELD` o `UNKNOWN_VECTOR_PROPERTY`), y ninguna respuesta de campo desconocido la incluye en su lista. | Elimina el campo de la consulta o adquiere el rol necesario. Consulta [Field access](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 / 403 | El cuerpo establece un campo que los roles de este llamador no pueden escribir (`access.write`). Rechazado en lugar de omitido: una escritura que descarte un campo reportaría éxito para una edición que no ocurrió. El mismo código rechaza una escritura a través de un padre que establece una relación que el llamador no puede escribir, y una actualización que asigna un valor a un campo `softDelete` — solo una eliminación lo establece. El socket en tiempo real responde 403 con este código ante una escritura a través de una ruta anidada cuya tabla padre, relación o tabla de destino no se sirve allí, en lugar de pasarla al controlador sin juzgar. `details.violations` nombra cada campo. | Elimina el campo o adquiere el rol necesario. Un campo que nadie puede escribir responde con `VALIDATION_EXCLUDED_FIELDS` en su lugar. |
| `FILTERED_USER_WRITE` | 400 | Se envió una actualización o eliminación con filtro a la tabla de autenticación a través de HTTP, cuyas escrituras se verifican usuario por usuario antes de ejecutarse. | Lee los usuarios, luego usa `updateMany`/`deleteMany` por su id. |
| `FILTER_REQUIRED` | 400 | Una escritura filtrada (una actualización o eliminación por `where`/`logical`, desde el SDK o las rutas masivas) no incluye condiciones, por lo que afectaría a todas las filas. Es rechazada antes de ejecutar nada. | Añade una condición. Para modificar intencionadamente todas las filas, hazlo explícito con una que todas las filas cumplan. |
| `HISTORY_UNAVAILABLE` | 503 | Una escritura en una tabla con `history: true` fue rechazada porque su entrada de historial no pudo registrarse: la base de datos no tiene la tabla `rebase.entity_history` o, para `openRebase` y `rebase console`, la función `rebase.record_history`. Ningún backend con historial ha arrancado en esta base de datos. Nada se ejecutó, incluidos los hooks, y las lecturas no se ven afectadas. Lanzado por `openRebase`, y respondido por un backend creado con `provision: false`. | Arranca el backend una vez con historial activado y `provision: true` (`rebase dev` lo hace), luego reintenta. |
| `HISTORY_UNSERVABLE` | 501 | El controlador de datos de la tabla no puede ejecutar las reglas de lectura y los hooks `afterRead` sobre las filas almacenadas (`DataDriver.serveStoredRows`), y el historial nunca se sirve sin enmascarar. El controlador de Postgres integrado sí puede. | Implementa `serveStoredRows` en el controlador personalizado. Consulta [History](/docs/backend/history/). |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Una solicitud anterior con la misma `Idempotency-Key` todavía se está ejecutando. | Reintenta una vez que termine. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | La misma `Idempotency-Key` llegó en una solicitud diferente: otro método, ruta, cadena de consulta o cuerpo. | Usa una clave nueva, o envía la solicitud original. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` especificó una función que no es de agregación (`count`, `sum`, `avg`, `min`, `max`, `countDistinct`, `mode`, `percentile`, `distinct`, `fingerprint`). | Usa una de esas; el mensaje las lista. |
| `INVALID_AGGREGATE_GROUP` | 400 | Una transformación de `groupBy` es desconocida o no aplica a su columna: `year`/`month`/`day` en una columna que no es fecha, `unnest` en una que no es array. | Usa `lower`, `upper`, `year`, `month`, `day` o `unnest`, en una columna del tipo adecuado. |
| `INVALID_AGGREGATE_SELECT` | 400 | Una entrada de `?select=` no tiene el formato `fn(field)`; se especificó una función diferente de `count()` o `fingerprint()` sin campo; `percentile` no tiene una fracción entre 0 y 1; o se solicitó `fingerprint()` sobre una vista plana, que no almacena filas. | Escribe `sum(total)`, `count()`, `percentile(price,0.95)`. |
| `INVALID_AGGREGATE_WINDOW` | 400 | `offset`, `page` u `orderBy` en una agregación sin `groupBy`, o un cursor en cualquier agregación. Una agregación no agrupada es una sola fila, y un grupo no es una fila tras la cual un cursor pueda continuar. | Añade `groupBy`, o descártalos; pagina grupos con `offset` o `page`. Consulta [Aggregates](/docs/sdk/aggregates-and-search/#aggregates). |
| `INVALID_BATCH_BODY` | 400 | Una operación de `/_batch` carece de `op`, `table`, `values` o `id`, nombra una tabla que este backend no proporciona, o reutiliza un nombre de `ref`. | Consulta el mensaje; identifica la operación por su índice. |
| `INVALID_BATCH_REF` | 400 | Un `{ "$ref": "<name>.<field>" }` no nombra ninguna operación previa, apunta hacia adelante, o solicita un campo que la fila referenciada no tiene. Solo se resuelven referencias hacia atrás. | Nombra la operación con `ref` *antes* de hacer referencia a ella. |
| `INVALID_BULK_BODY` | 400 | El cuerpo de la operación masiva no tiene la estructura esperada. | Envía el array que espera la ruta: `{ "rows": [...] }` para `POST /bulk`, `{ "updates": [{ "id", "data" }] }` para `PATCH /bulk`, `{ "ids": [...] }` para `POST /bulk/delete`. |
| `INVALID_CONFLICT_RULE` | 400 | La regla de conflicto de un upsert (mantener duplicados, o reemplazar solo ante un `where`) se envió sin `upsert: true`, o ambas reglas se enviaron juntas. | Envía `upsert: true` y solo una de las dos reglas. |
| `INVALID_CONFLICT_TARGET` | 400 | El `on_conflict` / `onConflict` de un upsert nombra columnas sin garantía de unicidad, las nombra sin `upsert: true`, o se envía en una creación anidada, donde una fila coincidente se movería bajo el nuevo padre. De lo contrario, Postgres respondería 42P10 desde el interior de una transacción que ya procesó datos. También aplica a cualquier upsert en la tabla de autenticación, donde crear y actualizar siguen reglas distintas. | Declara `.unique()` en la columna o un índice `unique`; el mensaje lista los destinos válidos existentes. En la tabla de usuarios, envía `POST` para crear y `PATCH` para actualizar. |
| `INVALID_COUNT` | 400 | `?count=` no es `exact` ni `none`. Es rechazado en lugar de tomarse como el valor predeterminado: un `?count=nnone` mal escrito pagaría el coste de conteo que intentaba evitar. | Envía `exact` (el predeterminado) o `none`. Consulta [Skipping the count](/docs/backend/api/#skipping-the-count). |
| `INVALID_CURSOR` | 400 | El cursor `after` no puede leerse, o nombra un id de fila que no encaja en las columnas de clave de la tabla: fue truncado, recodificado o construido manualmente. Un cursor legible enviado con un `orderBy` diferente a aquel con el que fue emitido genera `CURSOR_ORDER_MISMATCH`, también un 400. | Devuelve el valor `meta.nextCursor` de la página anterior sin modificar, con el mismo `orderBy` o ninguno. Consulta [Pagination](/docs/sdk/pagination/). |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` no es ni `include` ni `only`. Rechazado en lugar de ignorado: un `?deleted=true` mal escrito que ocultara silenciosamente cada fila eliminada parecería haber funcionado pero respondería la pregunta contraria. | Envía `include` (activas y eliminadas) u `only` (únicamente eliminadas). Omítelo para obtener solo filas activas. |
| `INVALID_DISTINCT` | 400 | `?distinct=` no es `true` ni `false`. | Envía uno de esos; `1` y `0` también son aceptados. |
| `INVALID_FIELD_OPERATION` | 400 | Se usó `$inc` / `$push` / `$pull` / `$merge` sobre un tipo de columna en el que no está definido, con un operando de estructura errónea, con dos operadores en un solo campo, mal escrito, o en una creación — donde no hay valor almacenado sobre el cual operar. | Consulta [Writing over REST](/docs/backend/writes/#field-operations); el mensaje nombra el campo. |
| `INVALID_FILTERED_WRITE` | 400 | Una escritura filtrada se dirigió a una ruta a través de una relación (`posts/1/comments`) o a ninguna tabla en absoluto. | Escribe en la tabla relacionada aplicando un filtro sobre su vínculo. |
| `INVALID_FILTER_FIELD` | 400 | El filtro nombra una columna que esta tabla no posee. | Comprueba la ortografía consultando la definición de la tabla. |
| `INVALID_FILTER_OPERATOR` | 400 | El operador no es compatible con este tipo de columna — por ejemplo `like` sobre un número o una fecha. | Consulta [Querying data](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | Un valor de filtro no puede interpretarse como el tipo de la columna con la que se comparó: `?id=eq.abc` en una clave entera, una etiqueta que no está en el enum, una marca de tiempo inválida, un número fuera de rango. `details.dbCode` incluye el SQLSTATE. | Envía un valor correspondiente al tipo de la columna. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` no es `true` ni `false`. Cualquier otro valor es rechazado en lugar de interpretarse como "no" — un error tipográfico que borre suavemente (soft-delete) cuando el llamador pidió purgar deja la falsa impresión de que los datos fueron eliminados permanentemente. | Envía `true` o `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` está malformado: no es una lista de rutas válida, o es un objeto de opciones por relación con estructura incorrecta. Una ruta anidada a más de tres saltos genera `INCLUDE_TOO_DEEP`, también un 400. Se valida en la frontera antes de dejarlo escapar del controlador como un 500. | Consulta el mensaje; nombra la ruta infractora. |
| `INVALID_INPUT` | 400 | El cuerpo falló la validación. | Consulta el mensaje. |
| `INVALID_LIMIT` | 400 | `?limit=` no es un número entero entre 1 y el máximo permitido (1000 por defecto); un valor superior es rechazado, no ajustado al límite. Una suscripción en tiempo real que pida un límite fuera de ese rango recibe el mismo código en una trama `ERROR` de WebSocket. | Reduce el límite y pagina el resto. |
| `INVALID_LOGICAL_GROUP` | 400 | Un grupo `?or=` / `?and=` / `?not=` está malformado o anidado más allá de la profundidad permitida. | Consulta el mensaje; muestra la regla de aplanamiento. |
| `INVALID_OFFSET` | 400 | `?offset=` no es un número entero igual o mayor que 0. | Envía un entero no negativo. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` no es `field`, `field:desc`, `field:desc:last`, ni un array JSON de `{ field, direction, nulls }` — o especifica una dirección distinta de `asc`/`desc`, o una posición de NULL distinta de `first`/`last`. | Consulta el mensaje; muestra todas las sintaxis posibles. |
| `INVALID_PAGE` | 400 | `?page=` no es un número entero igual o mayor que 1. Las páginas se indexan desde 1, por lo que `?page=0` se considera un error y no la primera página. | Envía `1` o más, o usa `?offset=`. |
| `INVALID_PARAM` | 400 | Un parámetro de consulta está malformado. | Consulta el mensaje. |
| `INVALID_QUERY_BODY` | 400 | El cuerpo de un `POST …/query` contiene un valor que la URL no admitiría: una lista para un parámetro que la URL lee una sola vez (`fields`, `limit`, …), un objeto para un filtro, o la repetición de un parámetro en la URL — un `POST …/query` lee todos los parámetros desde el cuerpo. | Escribe cada valor como lo hace la URL — una cadena, o una lista para un filtro repetido; `where`, `include`, `orderBy` y `vector` reciben JSON. Consulta [Queries too long for a URL](/docs/backend/vector-search/#queries-too-long-for-a-url). |
| `INVALID_VECTOR` | 400 | `?vector=` no es un array JSON de números. | Envía `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` no es `cosine`, `l2` ni `inner_product`. | Usa una de esas tres opciones. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` no es un número. | Envía un número. |
| `INVALID_WHERE` | 400 | `?where=` no es un objeto JSON que asocie campos con condiciones. | Envía `{"status":["==","active"]}`. |
| `KEY_IMMUTABLE` | 400 | Una actualización especifica la clave de la fila con un valor distinto al que se usa para direccionarla — en el cuerpo, o escrito por un `beforeSave`. Una fila no puede cambiar de clave: todo lo que ocurre tras la escritura (la relectura, `afterSave`, historial, tiempo real) la referencia por la clave original. Rechazado antes de ejecutar hooks, sin escribir nada, en cualquier punto de acceso. `details.violations` nombra el campo. | Crea la fila bajo la nueva clave y elimina esta. Enviar la clave que la fila ya tiene está permitido. |
| `MISSING_AGGREGATE_SELECT` | 400 | La ruta de agregación fue llamada sin `?select=`. | Añade uno, por ej. `?select=count()`. |
| `NOT_A_MATERIALIZED_VIEW` | 400 | Se llamó a `refresh()` en una tabla que no proporciona una vista materializada. | Actualiza únicamente vistas definidas con `defineView(…, { materialized: true })`. |
| `NO_TABLES` | 404 | El proyecto no expone tablas: ninguna declarada en `backend/schema` y ninguna en la base de datos para introspección. Cuando las tablas existen pero tienen la seguridad a nivel de fila desactivada, el mensaje las lista junto con el SQL para activarla, y `details.unprotectedTables` las enumera. Anteriormente `NO_COLLECTIONS`. | Crea tablas — mediante una migración, SQL, o un archivo `defineTable` más `rebase db push` — y reinicia. |
| `NOT_FOUND` | 404 | No existe una fila con ese id en esa tabla — o la seguridad a nivel de fila la oculta para este llamador. | Comprueba el id y luego el `rls` de la tabla. |
| `UNKNOWN_RELATION` | 400 / 404 | `?include=` nombra algo que no es una relación en la tabla. El mismo código responde **404** cuando una *ruta de URL* anidada lo incluye en su lugar, por ej. `/api/data/authors/1/posts` donde `authors` no declara ninguna — allí la URL no apunta a nada, por lo que es un recurso no encontrado en lugar de una solicitud malformada. | Revisa el nombre de la relación — el mensaje lista las que posee la tabla. Una referencia inversa debe declararse en el padre para ser navegable. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | El ordenamiento nombra un campo que no admite ordenación. | Ordena por una columna. |
| `PAGE_WITH_OFFSET` | 400 | Se combinó `?page=` con `?offset=` — o `page` con `offset` en un `find()`, lo cual el SDK de cliente, el `rebase.data` en proceso y el cliente offline rechazan con el mismo código antes de enviar la solicitud. Describen la misma ventana, y `page` solía imponerse silenciosamente sobre un `offset` que el llamador nunca veía aplicado. | Envía solo uno de ellos. |
| `PAYLOAD_TOO_LARGE` | 413 | El cuerpo supera el límite configurado. | Envía menos datos o incrementa el límite. |
| `READ_ONLY_TRANSACTION` | 409 | Un hook `afterRead` intentó realizar una escritura. Una lectura de ámbito de solicitud se ejecuta en una transacción `READ ONLY`, por lo que ni el hook ni nada de lo que llame puede escribir. | Mueve la escritura fuera de la lectura: usa un trabajo en segundo plano (background job), o `rebase.dataAsAdmin` desde una tarea programada (cron) o una función personalizada. |
| `REFRESH_NOT_SUPPORTED` | 501 | `POST /api/data/<slug>/refresh` llegó a un controlador de datos sin vistas materializadas. | Nada que refrescar en este backend. |
| `RELATION_HAS_NO_PIVOT` | 400 | La escritura contenía una carga de vínculo, pero la ruta no llega a su destino mediante un `manyToMany` que declare un `pivot` — por lo que no hay fila de unión intermedia donde almacenarla. | Declara columnas de `pivot` en la relación, o elimina esa carga útil de la escritura. Consulta [Relations](/docs/collections/relations/). |
| `RELATION_MISCONFIGURED` | 500 | Una relación no se resuelve contra el esquema registrado. La operación se rechaza antes que ignorarse: omitirla reportaría éxito para una escritura que no ocurrió, o un conjunto vacío para filas que sí existen. | Ejecuta `rebase schema generate` si el esquema generado es anterior a la base de datos. |
| `RELATION_NOT_UNLINKABLE` | 400 | La relación no puede desvincularse desde este extremo. | Realiza la escritura desde el lado propietario. |
| `RELATION_NOT_WRITABLE` | 400 | La ruta anidada no es una relación escribible, o una creación o actualización especifica una relación `via` multisalto — solo las relaciones `via` de un solo salto son escribibles. `details.fields` lista las claves `via`. Nada fue escrito. | Escribe directamente las filas que la cadena vincula. Consulta [Relations](/docs/collections/relations/#via--an-explicit-join-chain). |
| `RELATION_PIVOT_UNSUPPORTED` | 400 | La relación declara columnas de unión (junction), pero este origen de datos no admite escribir en ellas. | El enlace en sí continúa funcionando; solo la carga asociada a él falla. Comprueba las capacidades del controlador. |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Una escritura de relación no tenía una clave de origen a la cual asociar el enlace. | Guarda la fila padre primero. |
| `RESULT_TOO_LARGE` | — | Una sentencia enviada por el socket en tiempo real mediante `EXECUTE_SQL` — `admin.executeSql` desde un cliente, lecturas de catálogo del panel de administración — devolvió más de 128 MB de filas, por lo que no se envió nada. Se emite como una trama `ERROR` de WebSocket. Las ejecuciones de la consola SQL no se rechazan: muestran las primeras filas. | Añade un `LIMIT`, o selecciona menos columnas, y lee el resultado por partes. |
| `ROW_IN_TRASH` | 409 | La clave de un upsert pertenece a una fila en la papelera (una fila borrada de forma lógica aún conserva su clave). Un upsert no sobreescribe una fila eliminada, en ningún punto de acceso: REST `?on_conflict=`, upserts en `/bulk` y `/_batch`, el SDK y el socket en tiempo real. Nada fue escrito. | Restaura la fila primero (una actualización asignando el campo de borrado lógico a `null`), o púrgame con `?hard=true` y vuelve a hacer el upsert. Consulta [Soft delete](/docs/collections/soft-delete/). |
| `SCHEMA_DRIFT` | 500 | Una tabla o columna que el código espera no existe en la base de datos. | Ejecuta `rebase db push` en desarrollo; redespliega en un entorno administrado. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | Se combinó `startAfter` con `orderBy: "_score"`. La relevancia se calcula por consulta en lugar de almacenarse, por lo que no puede servir de clave para un cursor. | Pagina la relevancia con `limit`/`offset`, u ordena por una columna. |
| `SQL_ERROR` | 400 | La base de datos rechazó el SQL escrito por un usuario. Sobre el socket en tiempo real mediante `EXECUTE_SQL` es una trama `ERROR` con el mensaje de la base de datos. `POST /api/admin/sql/csv` lo responde antes de transmitir cualquier parte del archivo: un error de sintaxis, una escritura (la descarga opera en modo de solo lectura), más de una sentencia, o un rol que la conexión no puede asumir. | Corrige el SQL. Una descarga admite un solo `SELECT`, `WITH … SELECT`, `TABLE` o `VALUES`. |
| `VIEW_NOT_READABLE` | 403 | Un llamador sin ninguno de los roles `view.roles` de una vista materializada la leyó o intentó refrescarla. Una vista materializada no tiene seguridad a nivel de fila, por lo que se sirve completa y exclusivamente a esos roles. | Léela con uno de los roles permitidos, o declara el rol del llamador en `view.roles`. |
| `TENANT_IMMUTABLE` | 400 | Una escritura movería una fila de un inquilino (tenant) a otro. Una fila no puede cambiar de inquilino. `details.violations` nombra el campo. Un disparador impone la misma regla en la base de datos, por lo que el SQL ejecutado como el llamador falla con el error Postgres `42501` y un mensaje que comienza con `TENANT_IMMUTABLE`. | Crea la fila en el otro inquilino y elimina esta, o escribe usando un rol incluido en `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | La escritura especifica un inquilino al que este llamador no pertenece; la base de datos también la rechazaría. | Escribe en un inquilino al que pertenezca el llamador, o autentícate con uno que pertenezca a él. |
| `TENANT_REQUIRED` | 400 | La tabla tiene alcance de inquilino y el inquilino no puede deducirse: la solicitud no incluye ninguno, o el llamador pertenece a varios. | Envía el campo del inquilino explícitamente, o autentícate como un llamador que pertenezca exactamente a uno. |
| `TRANSACTION_ABORTED` | 500 | Una sentencia en la transacción de escritura falló y un hook capturó el error. Postgres ya había abortado la transacción, por lo que la escritura fue revertida y nada quedó almacenado. Solo una creación, actualización o eliminación vía `context.data` rechazada por la base de datos se deshace de forma aislada y es seguro capturarla. | Deja que el fallo lance la excepción, o valida antes de ejecutar la sentencia. Consulta [Transaction Semantics](/docs/collections/context-data-api/#transaction-semantics). |
| `UNKNOWN_FIELD` | 400 | `?fields=` nombra un campo que la tabla no tiene. | Comprueba la ortografía; el mensaje lista los campos válidos. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Una agregación o `groupBy` nombra un campo que la tabla no tiene. | Comprueba la ortografía; el mensaje lista los campos válidos. |
| `UNKNOWN_FILTER_FIELD` | 400 | El filtro nombra un campo que esta tabla — o el destino de una relación — no tiene, o una columna `.private()`. | Comprueba la ortografía; el mensaje lista los campos válidos. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | El filtro nombra un operador inexistente. | El mensaje lista todos los operadores admitidos. |
| `UNKNOWN_MESSAGE_TYPE` | 400 | Una trama del socket en tiempo real tiene un `type` que el servidor no procesa. Respondido como una trama `ERROR` con el `requestId` de la solicitud, para que la solicitud finalice en lugar de agotar el tiempo de espera. | Comprueba el `type` de la trama; el mensaje lo nombra. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | El ordenamiento nombra un campo que esta tabla no tiene. | Comprueba la ortografía; el mensaje lista los campos válidos. |
| `PRECONDITION_FAILED` | 412 | Un `If-Match` indicó una versión de la fila que ya no es la actual: alguien escribió en ella entre la lectura y esta escritura. Nada fue escrito. | Vuelve a leer la fila, reaplica el cambio y envía el nuevo `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` solicita un campo que la tabla no tiene. | Comprueba la ortografía; el mensaje lista los campos conocidos. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Una búsqueda vectorial nombró una columna que no es de tipo `col.vector()` en esta tabla. | El mensaje lista las columnas vectoriales de la tabla. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | El `Content-Type` no es admitido por esta ruta. | Envía el tipo documentado para la ruta. |
| `UNSUPPORTED_OPTION` | — | Se lanza internamente, no se responde por red: una escritura a través del descriptor de acceso en proceso (`context.data` en un hook, `rebase.data` en una función o cron) recibió `ifMatch` o `idempotencyKey`. Esta vía no tiene comprobación de precondiciones ni almacén de idempotencia, por lo que la opción se rechaza antes de escribir nada en lugar de ignorarse. | Elimina la opción allí, o realiza la escritura mediante el cliente HTTP, que sí soporta ambas. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | El filtro cruza una relación `via`, cuya ruta de unión se definió en una sola dirección, impidiendo correlacionar una subconsulta. | Filtra desde el lado propietario. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | El operador no está definido para ese campo: una relación sin columna en esta fila se filtra por pertenencia, y la coincidencia de patrones (`like`, `ilike` y sus negaciones) solo aplica a texto. | Consulta el mensaje; lista lo que el campo acepta. |
| `VALIDATION_CONSTRAINT` | 400 | Un valor infringió una regla declarada en la columna (`.validate()`, `.notNull()`, `.oneOf()`) — una longitud, un rango, un patrón, un campo obligatorio, un valor fuera de lista. Cada entrada de `details.violations` lleva un `code`: `required`, `min_length`, `max_length`, `length`, `min`, `max`, `less_than`, `more_than`, `positive`, `negative`, `integer`, `pattern`, `email`, `url`, `enum`, `min_items`, `max_items`, `unique_items` (un array contiene el mismo elemento dos veces, `$push` incluido), `unique_by` (dos elementos de un array JSON comparten un valor en un campo especificado por `uniqueBy`), `date_min`, `date_max`, `geopoint_range`. | Consulta el mensaje; nombra la tabla, la columna y cada infracción. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | El cuerpo intenta escribir una columna marcada como `.private()`, o `.access({ write: [] })` — la misma regla con dos sintaxis. Su escritura corresponde al servidor: un hash de contraseña, un token de verificación. A diferencia de `FIELD_NOT_WRITABLE`, la respuesta es idéntica para todos los llamadores, incluyendo `admin`. | Elimina el campo. Consulta [Field access](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Un valor no coincide con el tipo de su columna. | Consulta el mensaje; nombra la columna. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | El cuerpo especifica un campo que la tabla no tiene — incluyendo un argumento `id` en una tabla con otra clave principal. | Comprueba la ortografía; el mensaje ("Table 'x' has no column 'f'. Known columns: …") lista las columnas válidas. |
| `VECTOR_CURSOR_UNSUPPORTED` | 400 | Se combinó un cursor (`after` / `startAfter`) con una búsqueda vectorial. Las filas se ordenan según una distancia calculada por consulta que no puede servir de clave para un cursor, por lo que un listado vectorial no proporciona `nextCursor`. | Pagina las filas más cercanas con `limit`/`offset`. |
| `WRITE_DENIED` | 403 | Una regla de seguridad o política de seguridad a nivel de fila rechazó la escritura. | Comprueba el `rls` de la tabla. |

## `PG_<SQLSTATE>` — una restricción rechazada por la base de datos

Una escritura que Postgres rechaza por un motivo originado en *los datos del llamador* responde
con el SQLSTATE en el código: `PG_23505`, `PG_23503`, etcétera. Es una
familia, no una lista fija — Postgres define cientos de SQLSTATEs —, pero solo dos
clases la alcanzan en la práctica, porque únicamente esas dos son responsabilidad del llamador:

- **clase 23**, infracción de restricción de integridad: un duplicado, una clave foránea que
  no apunta a nada, una columna NOT NULL dejada vacía;
- **clase 22**, excepción de datos: un valor que el tipo de la columna no puede almacenar.

Todo lo demás — una conexión caída, una columna inexistente, un problema de privilegios —
es responsabilidad del servidor y permanece como un `500`. Por lo tanto, `code.startsWith("PG_")` es una comprobación segura
para "la fila que envié era incorrecta", y las cuatro siguientes son las que un cliente
encuentra habitualmente. `details.dbCode` contiene el mismo SQLSTATE en todas ellas, y
el mensaje identifica la restricción.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | Un valor no pudo ser interpretado como el tipo de la columna — el equivalente en escritura de `INVALID_FILTER_VALUE`. | Envía un valor del tipo de la columna. |
| `PG_23502` | 400 | Una columna `NOT NULL` se dejó vacía. | Envía el campo o asigna un valor predeterminado a la columna. |
| `PG_23503` | 400 / 409 | Al guardar, una clave foránea apunta a una fila inexistente (400). Al eliminar, otras filas aún referencian a esta (409; una clave `RESTRICT` genera `PG_23001`, también 409). | Crea la fila de destino primero o corrige el id; al eliminar, elimina o reasigna antes las filas que la referencian. |
| `PG_23505` | 409 | Se violó una restricción de unicidad. El mensaje nombra la restricción. | Usa un valor diferente o actualiza la fila existente. |

## Almacenamiento (Storage)

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `INVALID_LIST_OPTIONS` | 400 | El parámetro `maxResults` de un listado de almacenamiento no es un número entero de al menos 1, o su `pageToken` no fue emitido por la fuente. Un tamaño de página inferior a uno solía devolver una página vacía con el mismo token, generando un bucle infinito en `while (pageToken)`. | Envía un `maxResults` positivo y devuelve `nextPageToken` sin modificar. |
| `INVALID_STORAGE_BUCKET` | 400 | El nombre del bucket está malformado. | Comprueba el nombre. |
| `INVALID_STORAGE_KEY` | 400 | La clave del objeto está malformada, escapa de su prefijo o está bajo un prefijo reservado (`_rebase/renditions/`, `_rebase/maintenance/`). | Comprueba la clave. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | Los parámetros de transformación de imagen están fuera de rango o son contradictorios. | Consulta [Storage](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | La subida supera los `maxBytes` declarados en la columna `col.storage()` de destino. Se valida en el servidor, no solo en el navegador. `details` contiene la columna, el límite y el tamaño real. | Sube un archivo más pequeño o aumenta `maxBytes` en la columna. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | El tipo de archivo subido no está en la lista `accept` de la columna, o no está en el `allowedMimeTypes` propio de la fuente de almacenamiento. `details` contiene la columna (o la lista del origen), la lista aceptada y el tipo de contenido enviado. | Sube un tipo admitido o amplía `accept` / `allowedMimeTypes`. |
| `STORAGE_MISCONFIGURED` | 502 | El bucket de S3 o GCS con el que está configurado este origen no existe, o el proveedor rechazó las credenciales de este despliegue. El mensaje indica el nombre del bucket; `details.reason` es `NoSuchBucket` o el rechazo del proveedor. Un bucket inexistente solía manifestarse erróneamente como "file not found" en cada archivo. | Corrige el nombre del bucket (`S3_BUCKET` / `GCS_BUCKET`, `__<KEY>` para un origen nombrado) o los permisos de las credenciales. |
| `STORAGE_NOT_CONFIGURED` | 501 / 503 | No hay un backend de almacenamiento configurado en este servidor, o ninguno es el predeterminado y la solicitud no especifica un origen; el mensaje lista los orígenes activos (501). Una subida reanudable cuyo origen desapareció antes de terminar devuelve 503. | Configura S3, GCS o almacenamiento local, o especifica un origen con `?storageId=`. |
| `STORAGE_SAME_LOCATION` | 400 | `POST /api/admin/storage/move` con `deleteSource` (`rebase storage move --delete-source`) entre dos orígenes que guardan en el mismo bucket o directorio. Todos los archivos se considerarían ya presentes en el destino al ser el mismo archivo, y borrar la copia del origen eliminaría el único archivo existente. Nada fue movido ni eliminado. | Apunta la columna al otro origen; sus archivos ya están allí. |
| `STORAGE_SCAN_INCOMPLETE` | 409 | `DELETE /api/admin/storage/orphans` (`rebase storage orphans --delete`) no pudo leer todas las tablas, por lo que un archivo nombrado en una de ellas parecería no utilizado. Con `?scan=`, el escaneo nombrado es el que no pudo leer todas las tablas. Nada fue eliminado; `details.unscanned` indica cada tabla y por qué no pudo leerse. | Soluciona lo que impide leer esas tablas y ejecútalo de nuevo. |
| `STORAGE_SCAN_NOT_FOUND` | 404 | `GET /api/admin/storage/orphans/scans/:id` o `DELETE /api/admin/storage/orphans?scan=:id` especifica un escaneo que el origen no conserva. Los escaneos se guardan durante 7 días en el origen escaneado, por lo que un `storageId` distinto al del escaneo tampoco encontrará ninguno. | Envía el `storageId` del escaneo, o inicia un nuevo escaneo. |
| `STORAGE_SCAN_NOT_COMPLETE` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` especifica un escaneo que aún está en estado `queued` o `running`, o que ha terminado en `failed`. Nada fue eliminado; `details.status` indica su estado. | Espera a que el escaneo finalice, o inicia otro. |
| `STORAGE_SCAN_EXPIRED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` nombra un escaneo que finalizó hace más de 15 minutos. Nada fue eliminado. | Inicia otro escaneo y procede a eliminar desde él. |
| `STORAGE_SCAN_DELETION_STARTED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` nombra un escaneo cuyos huérfanos ya se están eliminando. | Consulta el estado `deletion` del escaneo con `GET /api/admin/storage/orphans/scans/:id`. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | El origen de almacenamiento está declarado pero no tiene credenciales configuradas aquí. | Configura las variables de entorno de dicho origen. |
| `STORAGE_WRITE_FAILED` | 502 | El backend de almacenamiento rechazó o interrumpió la escritura. | Comprueba sus propios registros (logs) y credenciales. |
| `TRANSFORM_OVERLOADED` | 503 | Demasiadas transformaciones de imagen en curso simultáneamente. | Reintenta; considera colocar una CDN por delante. |
| `UNKNOWN_STORAGE_SOURCE` | 400 / 404 | La solicitud especificó un origen de almacenamiento (`?storageId=`) que este proyecto no declara. Un `bucket` que este despliegue no atiende arroja el mismo código en **404** (en un listado y en una subida, una carpeta o una subida reanudable a S3 o GCS) — el almacén es lo que no existe, y `details` lista los buckets y los orígenes existentes. Ambos casos solían responder "file not found", idéntico a una clave simplemente inexistente. | Declara el origen en `config/resources.ts`, o consulta `GET /api/storage/sources`. |
| `UPLOAD_LOCKED` | 423 | El `PATCH` de una subida reanudable llegó mientras aún se recibía otro fragmento (chunk) de la misma subida — casi siempre debido a que un cliente reintenta un fragmento en tránsito. Se rechaza en lugar de ponerse en cola, tal como hace tusd. | Consulta el desplazamiento con `HEAD /api/storage/tus/:id` y reanuda desde allí; tus-js-client gestiona los reintentos automáticamente. Consulta [Resumable uploads (TUS)](/docs/backend/storage-resumable-uploads/). |

## Funciones personalizadas

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | No se sirve ninguna función con ese nombre — o existe una, pero sus propias rutas no cubren la ruta posterior. A un llamador autenticado también se le indica qué *está* disponible; a uno anónimo no, ya que esa lista constituye un inventario de todos los endpoints personalizados. Cuando un archivo con ese nombre falló al cargarse, el mensaje se lo indica al llamador autenticado nombrando el archivo: esa es la diferencia entre un error de escritura y un despliegue defectuoso. Un llamador anónimo recibe la respuesta estándar de nombre desconocido, equivalente a un nombre sin coincidencias. | Comprueba el nombre consultando `GET /api/functions`, o el log de arranque para detectar archivos no cargados. |
| `FUNCTION_TIMEOUT` | 504 | El controlador superó su tiempo límite de ejecución. Sigue ejecutándose; no puede ser cancelado desde aquí. El mensaje y `details` (`{ timeoutMs, source }`) indican qué límite aplicó y dónde fue configurado. | Proporciona un `AbortSignal` a las llamadas salientes, declara el `timeoutMs` propio de la función (`defineFunction(…, { timeoutMs })`, máximo `REBASE_FUNCTIONS_MAX_TIMEOUT_MS`), o incrementa `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Este proceso reenvía funciones a otro que no respondió. | Verifica que la unidad de funciones esté en ejecución. |

## Funciones SQL como RPC

<span class="since-badge" data-since="0.35">Desde 0.35</span>

`POST /api/rpc/<name>` — consulta [SQL functions as RPC](/docs/backend/rpc/). Un argumento incorrecto genera `VALIDATION_CONSTRAINT` (400), con `details.violations` nombrando cada campo, tal como en la API de datos; una credencial sin `data:read` genera `SCOPE_MISSING` (403); un RPC público que supera su límite genera `RATE_LIMITED` (429).

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `RPC_NOT_FOUND` | 404 | No hay ningún `defineRpc` con ese nombre exportado desde `backend/schema/index.ts`. Solo las funciones declaradas son invocables, por lo que una función que la base de datos tenga pero que nadie declaró responde esto también. | Declárala con `defineRpc`, o comprueba el nombre. |
| `METHOD_NOT_ALLOWED` | 405 | El RPC existe y es llamado con un método distinto de `POST`. La respuesta incluye `Allow: POST`. | Realiza un `POST` con un cuerpo JSON de argumentos con nombre. |
| `INVALID_RPC_BODY` | 400 | El cuerpo es JSON, pero no un objeto de argumentos con nombre (un array, una cadena). | Envía `{ "argument": value }`, o ningún cuerpo si no lleva argumentos. |
| `RPC_ARGUMENTS_MISMATCH` | 400 | Ninguna sobrecarga de la función SQL acepta los argumentos enviados: se omitió un parámetro sin `DEFAULT`, o se nombró uno que no posee. El mensaje lista los que admite. | Envía los argumentos que la función requiere y márcalos como `.required()` en `args`. |
| `RPC_INVALID_ARGUMENT` | 400 | Postgres rechazó un valor por no coincidir con el tipo de parámetro de la función (un SQLSTATE clase 22): `"abc"` para un `uuid`, una etiqueta fuera de un enum. | Envía un valor del tipo correspondiente al parámetro. |
| `RPC_EXCEPTION` | 400, o el estado que determine un SQLSTATE `PTnnn` | La función lanzó una excepción: `RAISE EXCEPTION '…'` responde 400 con su mensaje, y `details` contiene `sqlState`, `detail` y `hint`; `RAISE SQLSTATE 'PT404'` responde 404, de la misma forma que PostgREST. | El mensaje es el propio emitido por la función. |
| `RPC_READ_ONLY` | 500 | La función intentó escribir, y un RPC se ejecuta en una transacción de solo lectura a menos que se declare con `write: true`. | Añade `write: true` a su `defineRpc`. |
| `RPC_FUNCTION_MISSING` | 500 | El RPC está declarado pero la base de datos no tiene una función con ese esquema y nombre. Postgres almacena nombres sin comillas en minúsculas. | Crea la función, o corrige el nombre o `schema` en `defineRpc`. |
| `RPC_AMBIGUOUS` | 500 | Varias sobrecargas de la función aceptan los argumentos enviados. | Elimina las sobrecargas a las que el RPC no debería llegar, o renómbralas. |

## Notificaciones push

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `PUSH_ENDPOINT_REFUSED` | 400 | El endpoint de la suscripción no pertenece a un servicio push utilizado por navegadores (FCM, Mozilla, Apple, Windows) mediante `https`. El servidor envía peticiones a esa dirección en cada envío, por lo que no admite ningún otro. | Envía `PushSubscription.toJSON()` tal como lo produjo el navegador, o añade un servicio push de prueba a `push.allowedHosts`. Consulta [Push notifications](/docs/backend/push-notifications/#routes). |
| `PUSH_NEEDS_A_USER` | 403 | Una clave de API o la clave de servicio llamó a una ruta de push. Una suscripción corresponde al navegador de una persona autenticada. | Invócala con la sesión de esa persona. |
| `PUSH_NOT_CONFIGURED` | 503 | El servicio push está activado pero no puede enviar: no hay claves VAPID en producción, o su tabla no pudo inicializarse. El mensaje detalla cuál es el caso. | Configura `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` y `REBASE_VAPID_SUBJECT`. Consulta [Push notifications](/docs/backend/push-notifications/#keys). |

## Tareas programadas (Cron jobs)

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `CRON_JOB_ALREADY_EXECUTING` | 409 | Disparo manual de una tarea cron que ya se encuentra en ejecución — en el proceso que respondió, o en otro que posee el bloqueo (lease) de ejecución, como el worker detrás de un proceso `api`. Nada se ejecutó. La omisión se registra en el historial de la tarea, y `details.log` es esa entrada; su línea nombra el proceso que la está ejecutando. | Inténtalo de nuevo cuando termine esa ejecución. Consulta [Cron Jobs](/docs/backend/cron-across-instances/#concurrency-guarding). |

## Superficies de administración y edición de esquemas

Estos indican que una funcionalidad está desactivada o sin configurar, no que la solicitud fuera
errónea. Cada uno también se reporta en la ruta `/status` correspondiente con un `200`,
para que un panel pueda deshabilitar visualmente la función en lugar de mostrar un error.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | Se accedió a una superficie de administración en un servidor sin autenticación configurada, impidiendo distinguir a un administrador de un desconocido. | Configura `auth.jwtSecret`, o pasa un `AuthAdapter`. |
| `BRANCH_DIFF_STALE` | 409 | `POST /api/admin/branches/:name/merge` recibió la huella (fingerprint) de un diff que ya no es válido: la rama o su padre cambiaron desde entonces. Nada fue escrito. | Lee el diff de nuevo, revísalo y realiza el merge con su nuevo `fingerprint`. |
| `BRANCH_DIFF_UNSUPPORTED` | 501 | El origen de datos no puede comparar ramas: no tiene SQL, o no admite ramas (no hay conexión administrativa). | Usa un backend Postgres con `adminConnectionString` configurado. |
| `BRANCH_MERGE_BLOCKED` | 409 | Una tabla con diferencias no puede fusionarse — añadida o eliminada en la rama, columnas o clave primaria que difieren, falta de clave primaria, demasiadas filas para comparar, o reescrita desde la creación de la rama (`TABLE_REWRITTEN`). Una tabla cuyas filas no pudieron compararse bloquea la fusión incluso si su conteo devuelve 0: son desconocidas, no cero. `details.tables` lista cada una con el motivo. Nada fue escrito. | Aplica el esquema con tus migraciones primero, o fusiona con `skipBlocked: true` para ignorar esas tablas. |
| `BRANCH_MERGE_CONFLICT` | 409 | Se modificaron filas tanto en la rama como en su padre, y `onConflict` era `"abort"` (el valor predeterminado); o el padre rechazó parte de la fusión — una fila cambió mientras tanto, un trigger la omitió, una política la ocultó. Nada fue escrito. | Elige qué lado tiene prioridad con `onConflict: "branch"` o `"target"`, o lee el diff nuevamente. |
| `BRANCH_MERGE_FAILED` | 409 | El padre rechazó las filas de la rama dentro de la sentencia de fusión — una restricción, una etiqueta de enum o una clave foránea existente que las filas de la rama vulneran, usualmente debido a diferencias entre ambos esquemas. `details` contiene `sqlState`, `table`, `constraint` y `detail`. Nada fue escrito. | Revisa los cambios de esquema del diff, alinea el esquema del padre mediante tus migraciones, o corrige las filas de la rama y vuelve a fusionar. |
| `BRANCH_NOT_FOUND` | 404 | No existe una rama con ese nombre en el registro. | `rebase db branch list`, o el panel de Ramas, lista las existentes. |
| `CONTRACT_UNAVAILABLE` | 404 | El contrato del proyecto se sirve únicamente cuando la autenticación está configurada — describe cada tabla y relación. | Configura la autenticación. `/meta/schema-version` siempre se sirve. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | No hay un buzón de desarrollo activo. El correo se captura solo cuando `SMTP_HOST` no está configurado y `NODE_ENV` no es production. | Desactiva `SMTP_HOST` en desarrollo, o consulta la bandeja de entrada real. |
| `DOCS_UNAVAILABLE` | 404 | `GET /api/docs` se sirve a los mismos llamadores a los que `GET /api/schema/tables` describe tablas, y este servidor no tiene autenticación configurada, por lo que no hay nadie a quien describírselas. | Configura la autenticación, o publica la documentación completa para todos con `enableSwagger: true` (`REBASE_ENABLE_SWAGGER=true`). |
| `INVALID_CHANGE` | 400 | El cambio de esquema propuesto no está bien estructurado. | Consulta el mensaje. |
| `SCHEMA_CHANGE_FAILED` | 400 | La aplicación de un cambio de esquema planificado falló por un motivo no cubierto por códigos más específicos. | Consulta el mensaje; refleja textualmente el error subyacente. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | El cambio es válido pero no puede aplicarse al esquema en su estado actual. | Consulta el mensaje. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | El repositorio tiene cambios sin confirmar (uncommitted), impidiendo aplicar la edición de forma segura. | Haz commit o stash y luego reintenta. |
| `SCHEMA_EDIT_REFUSED` | 400 | El editor de esquemas rechazó la edición: lo que cambiaría está escrito en código que no reescribe (un spread, una función auxiliar, una clave computada), o es una edición que nunca realiza (renombrar una tabla, eliminar la última regla). `details.problems` lista cada inconveniente. Nada fue escrito. | Consulta el mensaje. Realiza el cambio manualmente en `backend/schema`. |
| `SCHEMA_EDIT_DOES_NOT_COMPILE` | 400 | La edición puede realizarse, pero dejaría un esquema que no compilaría — una relación hacia una tabla que se elimina, una regla que nombra una columna eliminada. `details.problems` contiene los diagnósticos del compilador, cada uno con su tabla y columna. Nada fue escrito. | Modifica primero las tablas de las que depende, o haz el cambio manualmente en `backend/schema`. |
| `SCHEMA_EDIT_STALE_FILE` | 409 | Un archivo que la edición reescribe cambió en disco desde que se preparó la modificación (guardado en el IDE, otro proceso). Nada fue escrito. | Recarga y aplica la edición nuevamente sobre el archivo en su estado actual. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Una clave de API u otra entidad de máquina intentó aplicar un cambio de esquema. | Inicia sesión como usuario, o configura `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | La edición de esquema en vivo requiere `schemaDir` (el directorio `backend/schema`) o `liveSchema.repository`, y este servidor se inició sin ninguno de ellos. El código conserva su nombre anterior. | Configura uno de ellos. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | La planificación funciona, pero no hay un repositorio donde hacer commit del cambio — un despliegue que ejecuta un bundle compilado, o un servidor cuyo `backend/schema` no está en ningún repositorio git (la aplicación de cambios siempre realiza un commit). | Ejecuta `git init` en el proyecto y reinicia el servidor (el repositorio se detecta al arrancar), o configura `liveSchema.repository`. |
| `SCHEMA_EDITING_PROVISIONING_OFF` | 409 | Este despliegue no aplica cambios en su base de datos (`REBASE_PROVISION=false`), impidiendo aplicar modificaciones desde el panel. | Guárdalo únicamente en el código fuente mediante commit, y permite que el proceso a cargo de la base de datos lo aplique. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Este controlador no puede planificar cambios de esquema. | La edición en vivo está disponible en Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | Las tablas se obtienen por introspección desde la base de datos aquí, por lo que no hay archivos fuente para editar. | Modifica el esquema mediante una migración. |
| `SCHEMA_EDITOR_DISABLED` | 501 | El editor de esquemas está desactivado para este servidor. Un bundle compilado siempre responde esto. | Actívalo con `schemaEditor`. En un bundle, configura `REBASE_LIVE_SCHEMA_REPOSITORY` para editar `backend/schema` a través de un repositorio — consulta [Live schema editing](/docs/backend/live-schema-editing#from-a-built-bundle). |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | El editor de esquemas necesita `ts-morph`, el cual no está instalado. | Instálalo en el paquete que ejecuta el backend y reinícialo: `pnpm --dir backend add -D ts-morph@28.0.0` desde la raíz de un proyecto inicializado, o `pnpm add -D ts-morph@28.0.0` donde el backend es el proyecto raíz. El mensaje indica el comando exacto para tu proyecto. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | El servidor no tiene definido `schemaDir`, por lo que el editor no tiene dónde escribir. El código conserva su nombre anterior. | Configura `schemaDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | El editor está desactivado bajo `NODE_ENV=production`: los archivos de un servidor desplegado se reconstruyen desde tu repositorio en cada despliegue, por lo que una edición aquí se perdería. | Edita `backend/schema` en desarrollo y despliega, o configura `liveSchema.repository` para confirmar los cambios allí. |
| `SCHEMA_UNAVAILABLE` | 404 | `GET /api/schema/tables` en un backend sin autenticación configurada: no hay ningún llamador para el cual filtrar tablas, y `auth.requireAuth: false` no altera este comportamiento. | Configura un adaptador de autenticación o `auth.jwtSecret`. Consulta [Endpoints](/docs/backend/endpoints/#schema). |
| `TABLE_NOT_FOUND` | 404 | `GET /api/schema/tables/:slug` especifica una tabla que no se sirve a este llamador — no existe con ese slug, o los alcances de su credencial no la cubren. | Comprueba el slug y los alcances `data:*` de la credencial. |
| `UI_PREFERENCES_NEED_A_PERSON` | 403 | `/api/admin/ui-config` fue llamado con una clave de API, un token de plataforma o la clave de servicio. Las preferencias de UI pertenecen a una persona autenticada. | Inicia sesión como usuario. |
| `UI_PREFERENCES_TOO_LARGE` | 413 | Las preferencias de UI de una tabla superan los 64 KB. | Guarda menos datos: las preferencias almacenan visualización, no datos de aplicación. |
| `UI_PREFERENCES_UNSUPPORTED` | 501 | El controlador de este backend no puede ejecutar SQL, por lo que no almacena preferencias de UI; el panel las conserva en el navegador. | Nada que corregir: las preferencias se mantienen por navegador. |
| `UI_CONFIG_FILE_INVALID` | 500 | `frontend/src/cms/ui-config.json`, donde se guardan las preferencias de UI del espacio de trabajo en desarrollo, no es un JSON válido. | Corrígelo o elimínalo; el panel lo regenera al guardar la próxima vez. |
| `SQL_EXPORT_UNSUPPORTED` | 501 | `POST /api/admin/sql/csv` no puede transmitir un resultado aquí: la base de datos de desarrollo en proceso (PGlite) tiene una sola conexión, y un cursor abierto durante una descarga bloquearía todas las demás consultas; o el origen de datos carece de cursor SQL. | Apunta `DATABASE_URL` a un Postgres propio (`rebase dev --docker` inicia uno), o añade un `LIMIT` y exporta las filas visibles en pantalla. |

### Reconciliación de esquema

[`rebase schema reconcile`](/docs/cli/schema/#rebase-schema-reconcile) planifica
mediante `POST /api/admin/schema/reconcile/plan` y aplica a través de
`/reconcile/apply`. Un rechazo no altera nada; únicamente `SCHEMA_RECONCILE_FAILED`
deja parte de un plan aplicado.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `INVALID_RECONCILE` | 400 | El cuerpo no es un objeto JSON, o `drop` no es una lista de cadenas `"<table>.<column>"`. | Envía `{ "drop": ["voice_cache.wav"] }`, u omite `drop`. |
| `SCHEMA_RECONCILE_FAILED` | 400 | Una sentencia falló a mitad del proceso. Las sentencias previas se ejecutaron y permanecen aplicadas; `details.applied` las lista. | Soluciona lo que indica el mensaje y vuelve a planificar: el nuevo plan excluirá lo ya ejecutado. |
| `SCHEMA_RECONCILE_INVALID` | 400 | El plan no puede aplicarse y el mensaje lista las razones: un `drop` que no cumple `<table>.<column>`, no especifica tabla o columna, o especifica una columna que la tabla aún declara. `details.plan` es el plan. | Corrige la lista `drop`. Una columna declarada se elimina retirándola de su `defineTable`, desplegando y luego reconciliando. |
| `SCHEMA_RECONCILE_STALE` | 409 | La base de datos o las tablas cambiaron desde el plan que confirmaste. `details.plan` es el nuevo. | Revisa el nuevo plan y confirma su `digest`. |
| `SCHEMA_RECONCILE_UNCONFIRMED` | 400 | No se envió `confirm` a `/reconcile/apply`. | Planifica primero y envía el `digest` del plan como `confirm`. La CLI hace esto automáticamente cuando escribes `yes`. |
| `SCHEMA_RECONCILE_UNSUPPORTED` | 503 | El controlador de este backend no puede planificar una reconciliación, o no puede ejecutar SQL. | La reconciliación funciona en Postgres. |

### Por qué una tabla de una rama no puede fusionarse

`BRANCH_MERGE_BLOCKED` nombra cada tabla rechazada en `details.tables`, con uno
de estos códigos. El mismo código aparece en el `blocked` de la tabla dentro del diff,
permitiendo que Studio lo señale antes de pulsar **Merge**. Ninguno es una respuesta
independiente.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `COLUMNS_DIFFER` | — | Las columnas de la tabla difieren entre la rama y su padre. Las filas se comparan basándose en las columnas compartidas. | Añade las columnas faltantes al padre mediante tus migraciones (`rebase db push`), luego fusiona. Una migración que reescribe la tabla — como cambiar el tipo de una columna — la convierte en `TABLE_REWRITTEN`: fusiona antes de tal cambio, o recrea la rama después de este. |
| `NO_PRIMARY_KEY` | — | La tabla carece de clave primaria, impidiendo comparar filas una a una; el diff solo muestra recuentos de filas. | Asigna una clave primaria a la tabla o traslada sus filas manualmente. |
| `PRIMARY_KEY_DIFFERS` | — | Las columnas de la clave primaria o sus tipos difieren entre ambos. | Aplica el esquema al padre primero. |
| `TABLE_ADDED` | — | La rama creó la tabla. Una fusión nunca crea una tabla. | Créala en el padre mediante tus migraciones, luego fusiona sus filas. |
| `TABLE_DROPPED` | — | La rama eliminó la tabla. Una fusión nunca elimina una tabla. | Elimínala mediante tus migraciones. |
| `TABLE_REWRITTEN` | — | Uno de los lados reescribió todas las filas de la tabla tras crear la rama — cambio de tipo de columna, un `ADD COLUMN` con valor por defecto volátil, `VACUUM FULL`, `CLUSTER` —, haciendo que cada fila figure como modificada y sea imposible distinguir qué lado alteró cada fila. | Fusiona la rama antes de ejecutar dicha migración, o recrea la rama desde el padre posteriormente. |
| `TOO_LARGE` | — | La tabla contiene más filas en uno de los lados de las que un diff compara fila por fila (100,000 por defecto, `maxRowsPerTable`). | Incrementa `maxRowsPerTable` tanto en el diff como en el merge, o traslada las filas por otro medio. |

## Códigos genéricos

Una ruta usa uno de estos códigos cuando no aplica ninguno más específico.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Malformada, y nada más específico aplica. | Consulta el mensaje. |
| `UNAUTHORIZED` | 401 | No autenticado, o la credencial fue rechazada. | Inicia sesión o renueva el token. |
| `FORBIDDEN` | 403 | Autenticado, y no permitido. | Reintentar con la misma identidad no servirá de nada. |
| `CONFLICT` | 409 | Conflicto con el estado existente. | Consulta el mensaje. |
| `INTERNAL_ERROR` | 500 | Algo falló en el servidor. El mensaje es genérico a propósito. | Cita el `requestId`; el motivo se encuentra en los logs. |
| `NOT_CONFIGURED` | 503 | Una dependencia que esta ruta necesita no está configurada en este servidor. | Consulta el mensaje. |
| `SERVICE_UNAVAILABLE` | 503 | No se pudo contactar con un servicio del que depende la solicitud: un bucket S3 o MinIO, o un host al que una función hace `fetch()` que rechaza la conexión o no resuelve. El log del servidor indica el host; la respuesta no. Una base de datos inaccesible devuelve `DATABASE_UNAVAILABLE`. Una conexión fallida hacia cualquiera de estos servicios responde esto. | Reintenta; revisa los logs. |

## Mantenimiento de la exactitud de esta página

`pnpm verify:docs` falla cuando un código que el servidor puede generar no está en estas
tablas, cuando una tabla lista un código inexistente, cuando los estados de una fila no coinciden
exactamente con aquellos con los que el código fuente lo emite, o cuando una familia de códigos como `PG_<SQLSTATE>` no tiene una fila
para un SQLSTATE que los clientes encuentran. La fase se define en
`tooling/scripts/docs-verify/check-error-codes.mjs`.

Se comprueba a sí misma primero. El análisis extrae códigos directamente de TypeScript y no de
un servidor en ejecución, por lo que sus ángulos muertos son silenciosos por diseño: en una ocasión
no detectó un código pasado a través de un envoltorio de una sola línea, o uno escrito tras un mensaje
que contenía un `)`, y reportó "cada código que el servidor puede emitir está documentado"
en una página a la que le faltaban diecisiete. Por eso, la fase ejecuta una prueba con esas
estructuras exactas antes de procesar esta página, y rechaza validar nada si
no puede verlas.
