---
sourceHash: 983cce6efed81a1a
title: Códigos de error
sidebar_label: Códigos de error
description: Todos los códigos de error que un backend de Rebase puede devolver, con su estado HTTP, qué significan y qué hacer al respecto; además del sobre de respuesta, X-Request-ID y las reglas de details.
---

Cada fallo que devuelve un backend de Rebase utiliza un mismo sobre (envelope) y
contiene un `code` estable. El código es el elemento por el cual realizar
bifurcaciones: el mensaje está escrito para una persona y puede reformularse, el
estado se comparte entre una docena de problemas diferentes, y el código no sufre
de ninguno de estos dos inconvenientes.

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

- **`message`** — legible por humanos. Para un `4xx` es el propio mensaje del
  servidor; para un `5xx` es deliberadamente genérico, ya que el texto subyacente
  puede citar un host, un rol o un nombre de columna.
- **`code`** — uno de los valores que figuran a continuación. Estable entre versiones menores.
- **`details`** — opcional y nunca garantizado. Consulta las reglas a continuación.
- **`requestId`** — presente siempre que la solicitud haya pasado por el middleware
  de request-ID, que abarca cada ruta bajo `basePath`.

### `X-Request-ID`

Cada solicitud bajo `basePath` obtiene un ID: la cabecera `X-Request-ID` del emisor
cuando es un UUID; de lo contrario, uno nuevo. Se devuelve en la respuesta como
`X-Request-ID`, se incluye en el sobre de error como `requestId` y se adjunta a
la línea de registro (log) del servidor para esa solicitud.

Esa es la clave de unión. Cítala en un informe de errores y un operador podrá encontrar
la línea de registro exacta que explica el fallo, la cual contiene el motivo que nunca
se mostró al cliente.

Enviar el tuyo propio es la forma en que una traza sobrevive a un salto: una pasarela
(gateway) o un ejecutor de tareas que reenvía la cabecera obtiene un único ID en todos
los servicios que procesaron la solicitud. Un valor no válido se ignora en lugar de
rechazarse (no vale la pena hacer fallar una solicitud por una cabecera malformada
enviada por el cliente), por lo que no debes asumir que el ID que enviaste es el ID
que recibiste. Lee la cabecera de la respuesta.

### Qué contiene `details`

`details` es para diagnóstico, no contractual. Se rige por tres reglas:

1. **Todo lo que una ruta defina explícitamente se devuelve siempre.** Estos son
   los propios errores del cliente descritos con precisión: qué campo de filtro
   era desconocido, qué relación no es escribible, qué valor no encajaba con su tipo.
2. **Los diagnósticos de la base de datos se recortan en producción.** Cuando el
   fallo proviene de Postgres, `details.dbCode` (el SQLSTATE) siempre está presente:
   nombra la clase de problema y no revela nada sobre los datos. `dbMessage`,
   `detail` y `hint` se añaden únicamente cuando `NODE_ENV` no es `production`,
   porque Postgres incluye en ellos el contenido de las filas. `23505` reporta
   `Key (email)=(a@b.c) already exists.`, lo que responde a "¿está registrada esta persona?"
   para cualquier dirección que alguien decida probar.
3. **Nunca bifurques en función de `details`.** Bifurca según `code`. Lo que está
   bajo `details` es aquello que resultó útil para una persona en ese punto de
   llamada, y está sujeto a cambios.

## Cómo interpretar un estado

| Estado | Lo que dice sobre la solicitud |
| --- | --- |
| `400` | Malformado, o solicitando algo que no existe en el esquema. Corrige la solicitud. |
| `401` | No autenticado, o la credencial ha expirado. Inicia sesión o renueva el token. |
| `403` | Autenticado, pero no autorizado. Reintentar con la misma identidad no servirá de nada. |
| `404` | No existe tal ruta, colección o fila, o se trata de una fila que la seguridad a nivel de fila oculta. |
| `409` | Un conflicto con el estado existente: un duplicado o una escritura concurrente. |
| `413` `415` `422` | El cuerpo es demasiado grande, el tipo de medio es incorrecto o fue rechazado semánticamente. |
| `429` | Límite de tasa alcanzado (Rate limited). Espera antes de reintentar; el mensaje indica por cuánto tiempo. |
| `500` | El fallo está en el servidor o en su base de datos, no en el cliente. Revisa los registros. |
| `501` | La ruta existe, pero este despliegue no puede atenderla: una funcionalidad desactivada o sin configurar. |
| `502` `503` `504` | Una dependencia no estaba disponible, no estaba configurada o tardó demasiado. |

## Autenticación y cuentas

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | La ruta necesita un segundo factor y la sesión solo tiene uno. | Completa el desafío MFA y reintenta. |
| `ALREADY_VERIFIED` | 400 | La dirección o el factor ya están verificados. | Nada: el estado deseado ya se cumple. |
| `ACCOUNT_OUTRANKS_CALLER` | 403 | La cuenta que se intenta editar, restablecer o eliminar posee un rol o alcance que el emisor de la llamada no tiene. `details.beyond` los enumera. | Haz que alguien que los posea realice el cambio. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | El inicio de sesión anónimo está desactivado en este servidor. | Actívalo o inicia sesión con una identidad real. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Una clave de API intentó listar, crear, modificar o revocar claves de API, ya sean de su propio tipo o personales. | Gestiona las claves como un usuario con `keys:write`, o mediante la clave de servicio. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Una ruta protegida se ejecutó sin ningún middleware de autenticación de Rebase antes de ella, por lo que nunca se revisaron las credenciales del cliente. | Monta la aplicación a través del router de funciones en lugar de hacerlo directamente en tu propio servidor. |
| `BOOTSTRAP_ANONYMOUS` | 403 | Un cliente anónimo intentó inicializar el primer administrador (bootstrap). | Inicia sesión primero. |
| `BOOTSTRAP_COMPLETED` | 403 | El primer administrador ya existe. | Haz que un administrador existente otorgue el rol. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | La inicialización (bootstrap) es solo para el primerísimo usuario, y este no lo es. | Haz que un administrador existente otorgue el rol. |
| `CAPTCHA_FAILED` | 400 | El proveedor rechazó el token de CAPTCHA. | Resuelve un nuevo desafío. |
| `CAPTCHA_REQUIRED` | 400 | La ruta requiere un token de CAPTCHA y no se envió ninguno. | Incluye el token. |
| `CHALLENGE_EXHAUSTED` | 401 | Demasiados códigos erróneos para un mismo desafío MFA. | Inicia un nuevo desafío. |
| `EMAIL_EXISTS` | 409 | Ya existe una cuenta con esa dirección: al registrarse, al cambiar de dirección o al seguir un enlace de cambio de dirección cuando otra cuenta tomó la dirección mientras esperaba. | Inicia sesión o inicia un restablecimiento de contraseña; para un cambio de dirección, elige otra dirección. |
| `EMAIL_NOT_CONFIGURED` | 503 | Se solicitaron enlaces mágicos u OTP y el servidor no tiene configurado el transporte de correo. | Configura SMTP o usa otro método de inicio de sesión. |
| `EMAIL_NOT_VERIFIED` | 403 | Un inicio de sesión con OAuth encontró una cuenta con la misma dirección y el proveedor no verificó esa dirección, por lo que no está vinculada. | Inicia sesión con el método existente y luego ejecuta `POST /auth/link/<provider>`. |
| `FACTOR_NOT_VERIFIED` | 400 | El factor MFA fue registrado pero nunca confirmado. | Confirma el factor. |
| `IDENTITY_ALREADY_LINKED` | 409 | Esa identidad OAuth pertenece a otra cuenta. | Inicia sesión con ella o desvincúlala de la otra cuenta primero. |
| `IMPERSONATION_FORBIDDEN` | 403 | Una solicitud envió `x-rebase-impersonate` y su emisor no tiene permiso para ejecutar una solicitud como otro usuario. Solo la sesión de un administrador conectado puede hacerlo, nunca una clave de API o la clave de servicio. | Envíala con la sesión de un administrador o elimina la cabecera. |
| `IMPERSONATION_INVALID` | 400 | Se envió `x-rebase-impersonate` vacío. | Envía el uid del usuario como el que actuar o elimina la cabecera. |
| `IMPERSONATION_TARGET_NOT_FOUND` | 404 | `x-rebase-impersonate` no nombra a ningún usuario activo: ninguna cuenta tiene ese uid o está desactivada. | Comprueba el uid. |
| `IMPERSONATION_UNAVAILABLE` | 501 | La autenticación de este backend no puede ejecutar una solicitud como otro usuario porque su `AuthAdapter` carece de `resolveUser`. | Implementa `resolveUser` en el adaptador o elimina la cabecera. |
| `IMPERSONATION_UNSUPPORTED` | 400 | Se envió `x-rebase-impersonate` a una ruta que no admite ejecutarse como otro usuario. Solo la API de datos y las funciones personalizadas lo admiten, y el socket en tiempo real admite `impersonate` en `AUTHENTICATE`. | Envía la solicitud sin la cabecera. |
| `SIMULATION_FORBIDDEN` | 403 | Una solicitud envió una cabecera `x-rebase-simulate-*` (el simulador de RLS) o consultó `/api/admin/rls-simulator`, y su emisor no puede simular el acceso. Solo la sesión de un administrador conectado puede hacerlo, nunca una clave de API o la clave de servicio. | Envíala con la sesión de un administrador o elimina las cabeceras. |
| `SIMULATION_INVALID` | 400 | La simulación estaba malformada: se envió una cabecera vacía, se combinó `x-rebase-simulate-api-key-id` con un rol o id de usuario, o se combinó la simulación con `x-rebase-impersonate`. | Especifica un solo rol (opcionalmente con un uid), un id de usuario o un id de clave de API. |
| `SIMULATION_READ_ONLY` | 403 | Una escritura, eliminación, `_batch`, reversión de historial o una función personalizada llamada con cualquier verbo distinto de `GET`/`HEAD`/`OPTIONS` incluía una cabecera `x-rebase-simulate-*`. El acceso simulado es de solo lectura: la escritura se ejecutaría como la identidad simulada, no como el administrador. Las lecturas, incluidas `POST …/query` y `…/count`, se siguen ejecutando. En 0.25 la escritura se ejecutaba como la identidad simulada. | Deja de simular para realizar cambios. |
| `SIMULATION_TARGET_NOT_FOUND` | 404 | La simulación no designa a ningún usuario activo (un id de usuario enviado sin un rol) o ninguna clave de API activa. | Comprueba el id, o envía un rol junto con el uid para simular un uid que no tenga cuenta. |
| `SIMULATION_UNAVAILABLE` | 501 | Este backend no puede simular el acceso: su `AuthAdapter` carece de `resolveUser` para confirmar a un administrador, o se especificó una clave en un backend sin claves de API. | Implementa `resolveUser` o elimina las cabeceras. |
| `SIMULATION_UNSUPPORTED` | 400 | Se envió una cabecera `x-rebase-simulate-*` a una ruta que no puede ejecutarse con acceso simulado. Solo la API de datos y las funciones personalizadas las admiten. | Envía la solicitud sin las cabeceras. |
| `GUEST_REFERENCED` | 409 | No se pudo eliminar un invitado porque una fila del propio proyecto lo requiere a través de una clave foránea con `ON DELETE RESTRICT` o `NO ACTION`. `DELETE /api/admin/guests` lo reporta por invitado en `skipped` y continúa. | Elimina la fila o conserva el invitado. |
| `INVALID_ACCOUNT` | 400 | La cuenta se encuentra en un estado en el que esta operación no puede actuar. | Consulta el mensaje. |
| `INVALID_CHALLENGE` | 400 | El desafío MFA es desconocido o ha expirado. | Inicia uno nuevo. |
| `INVALID_CODE` | 400 / 401 | El código OTP o MFA es incorrecto: 400 para el inicio de sesión con código por correo (`/auth/otp/verify`), 401 para un registro o desafío MFA. | Reintenta con el código actual. |
| `INVALID_CREDENTIALS` | 401 | Correo electrónico o contraseña incorrectos (deliberadamente no se especifica cuál). | Reintenta o restablece la contraseña. |
| `INVALID_PLATFORM_TOKEN` | 401 | Se rechazó un token de plataforma `rpt_`: firma incorrecta, audiencia errónea, expirado o con una duración superior al límite máximo. El mensaje indica cuál fue el motivo. | Haz que la plataforma genere uno nuevo; en Rebase Cloud, ejecuta el comando de nuevo. |
| `INVALID_SCOPES` | 400 | Se solicitó para una clave algo que no es un alcance (scope): malformado, desconocido o con un destino que el alcance no admite. `details.problems` indica cuál y por qué; `details.validScopes` enumera los alcances que una clave puede tener. Omite `keys:read` y `keys:write`, que ninguna clave puede tener; en 0.24 los incluye en la lista. | Usa un nombre de la lista. Consulta [Roles and scopes](/docs/backend/roles-and-scopes/). |
| `INVALID_TOKEN` | 400 / 401 | Un token de verificación, restablecimiento, enlace mágico o cambio de dirección está malformado, es desconocido, ya fue utilizado o ha expirado (400). Una credencial de proveedor OAuth o un token de actualización que no se verifique es un 401. | Solicita un nuevo enlace o inicia sesión nuevamente. |
| `INVALID_ROLE` | 400 | El nombre del rol que se intenta escribir no es una cadena, está vacío o contiene `,` `{` `}` `"` `\` o un carácter de control. Esos caracteres se interpretarían como otros roles al leerlos: un rol viaja en un `text[]` de Postgres y en la lista separada por comas que dividen las políticas de RLS, por lo que `"support,admin"` se devolvería como `admin`. En 0.25 dicho nombre se almacenaba. `details.problems` indica cada uno. | Cambia el nombre del rol. Cualquier otro nombre es aceptado. |
| `KEY_MANAGEMENT_SCOPE` | 400 | Se solicitó `keys:read` o `keys:write` para una clave. Ninguna clave puede gestionar claves. `details.scopes` los enumera. | Elimínalos de la solicitud. |
| `KEY_OUTRANKS_CALLER` | 403 | Un poseedor de `keys:write` intentó modificar o revocar una clave de servicio que posee un rol o alcance que él no tiene. Solo un administrador gestiona cualquier clave. `details.roles` y `details.scopes` indican lo que la clave posee por encima del emisor. En 0.25 el cambio se procesaba. | Haz que un administrador, o alguien que los posea, modifique la clave. |
| `LAST_ADMIN` | 403 | El cambio dejaría al proyecto sin ningún administrador. | Promueve a otra persona primero. |
| `MFA_REQUIRED` | 401 | La contraseña era correcta y la cuenta tiene un segundo factor verificado, por lo que el inicio de sesión está completado a medias. `details` contiene un token de corta duración limitado al desafío MFA; no es una sesión. | Inicia un desafío y respóndelo; la respuesta al desafío emite la sesión. |
| `NO_SESSION` | 401 | No se presentó ninguna cookie de sesión ni token de actualización. Normal en la primera carga de la página. | Inicia sesión. |
| `NOT_ANONYMOUS` | 400 | Se llamó a una ruta de actualización desde anónimo con una cuenta real, o `DELETE /api/admin/guests/:uid` especificó una. | No hay nada que actualizar. Para eliminar una cuenta, usa `DELETE /api/admin/users/:uid`. |
| `OAUTH_ERROR` | 401 | El proveedor de OAuth rechazó la solicitud o devolvió un error. | Reintenta el flujo; el mensaje contiene el motivo del proveedor. |
| `PERSONAL_KEYS_DISABLED` | 403 | Las claves de API personales están desactivadas en este backend. | Establece `personalKeys: true` en el bloque `auth` de la colección de usuarios. |
| `PERSONAL_KEY_NEEDS_ACCOUNT` | 403 | La clave de servicio o una sesión de invitado intentó usar las rutas de claves personales. Ninguno de los dos tiene una cuenta para que la clave actúe en su nombre. | Inicia sesión en una cuenta o crea una clave de servicio en `/api/admin/api-keys`. |
| `PLATFORM_TOKENS_OFF` | 401 | Un token de plataforma `rpt_` llegó a un servidor que no los acepta: `REBASE_PLATFORM_TOKEN_KEY` y `REBASE_PLATFORM_TOKEN_AUDIENCE` no están configurados. | La plataforma que aloja la app configura ambos al desplegar; vuelve a desplegar o inicia sesión en la aplicación por otra vía. |
| `RATE_LIMITED` | 429 | Demasiados intentos desde este cliente. | Reduce la frecuencia de peticiones; el mensaje indica por cuánto tiempo. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | El destino de redirección no está en la lista de permitidos. | Agrégalo a la configuración del proveedor. |
| `REGISTRATION_DISABLED` | 403 | El registro de autoservicio está desactivado. | Haz que un administrador cree la cuenta. |
| `ROLE_EXCEEDS_CALLER` | 403 | Los roles que se intentan otorgar poseen un alcance, o `admin`, que el emisor de la llamada no tiene. `details.beyond` los enumera. | Haz que alguien que los posea otorgue el rol. |
| `ROLE_EXCEEDS_CREATOR` | 403 | A una clave de servicio se le asignó un rol de RLS que su creador no posee. Solo un administrador puede asignar cualquier rol. `details.roles` los enumera. | Descarta el rol o haz que un administrador cree la clave. |
| `ROLE_EXISTS` | 409 | Ese nombre de rol ya está en uso. | Elige otro nombre. |
| `ROLE_LOOKUP_FAILED` | 503 | No se pudieron leer los roles del emisor: en una ruta de administrador o en una solicitud de datos en un backend con `config.auth`. Falla de forma cerrada en lugar de confiar en los roles del token. Un token cuyo uid no nombra ninguna cuenta, incluido un uid que la tabla de usuarios no puede contener, es un 401, no este error (en 0.24, un uid que la tabla no puede contener devolvía este 503). Una base de datos inalcanzable es `DATABASE_UNAVAILABLE`, no este error (en 0.24 devolvía este 503). | Reintenta; comprueba la base de datos. |
| `SCOPE_EXCEEDS_CREATOR` | 403 | Se solicitó para una clave un alcance que su creador no posee. Una clave nunca tiene más permisos que la cuenta que la crea. `details.scopes` los enumera. | Descártalos o haz que alguien que los posea cree la clave. |
| `SCOPE_MISSING` | 403 | La credencial no posee el alcance que esta ruta, colección, fuente de almacenamiento o función necesita. `details.requiredScope` lo especifica, destino incluido. | Para una persona, un rol que declare el alcance. Para una clave, una clave que lo posea. Consulta [Roles and scopes](/docs/backend/roles-and-scopes/). |
| `SCOPE_NOT_DECLARED` | 500 | Una ruta protegida con `requireScope` especifica un alcance de aplicación que este backend no declara, por lo que nadie lo posee, ni siquiera un administrador. Un nombre que no es un alcance en absoluto, o uno integrado mal escrito como `data:raed`, nunca llega tan lejos: `requireScope` lanza un error donde se registra la ruta. En 0.24 ambos responden a todo emisor `403 SCOPE_MISSING`. | Declara el alcance bajo `auth.scopes` en la colección de usuarios o corrige el nombre. Consulta [Roles and scopes](/docs/backend/roles-and-scopes/). |
| `SELF_DELETE` | 400 | Un administrador intentó eliminar su propia cuenta. | Haz que otro administrador lo haga. |
| `SESSION_REVOKED` | 401 | La sesión se cerró en otro lugar, o se revocaron todas las sesiones, o la cuenta fue eliminada. Cualquier punto de entrada que acepte una sesión responde esto a dicho token de acceso: la API de datos, el almacenamiento, las funciones personalizadas y las rutas de administración (en 0.24 los tres primeros responden `UNAUTHORIZED` "Invalid or expired token"). El socket en tiempo real rechaza su `AUTHENTICATE` con una trama `AUTH_ERROR` que lleva el mismo código. El SDK intenta renovar, la renovación es rechazada y se cierra la sesión. | Inicia sesión nuevamente. |
| `ACCOUNT_DISABLED` | 401/403 | Un administrador desactivó la cuenta: el inicio de sesión (403), la renovación y cada token que posee (401) son rechazados en cualquier punto de acceso que requiera una sesión (en 0.24 la API de datos, el almacenamiento y las funciones personalizadas responden `UNAUTHORIZED`). El socket en tiempo real rechaza su `AUTHENTICATE` con una trama `AUTH_ERROR` que contiene el mismo código. | Contacta a un administrador. |
| `EMAIL_NOT_CONFIRMED` | 403 | `requireEmailVerification` está activado y la dirección aún no se ha verificado. Solo se responde ante una contraseña correcta; se envía un nuevo enlace por correo. | Sigue el enlace en el correo electrónico. |
| `PROOF_REQUIRED` | 409 | `POST /auth/verify-email`: la cuenta posee una contraseña o identidad que nadie ha demostrado, y la solicitud no demuestra ninguna. El token no se consume. | Envía `password` para conservarla, o `removeUnproven: true` para verificar sin ella. |
| `UNDELIVERABLE_ADDRESS` | 400 / 409 | Se solicitó un correo de verificación para una dirección a la que no se puede enviar correo (la de un invitado o el marcador de posición de X [400]) o una cuenta solicitó cambiar a dicha dirección (409, `POST /auth/change-email`). | Configura primero una dirección real. |
| `EMAIL_UNCHANGED` | 400 | `POST /auth/change-email` indicó la dirección actual de la cuenta. | Nada que cambiar. |
| `ANONYMOUS_USER` | 403 | Un invitado solicitó cambiar su dirección de correo electrónico; un invitado no tiene ninguna propia. | Conviértelo primero en una cuenta (`POST /auth/anonymous/link`). |
| `MFA_NOT_ENROLLED` | 400 | Se solicitaron códigos de recuperación para una cuenta sin un segundo factor verificado. | Registra primero un factor. |
| `HOOK_REJECTED` | 400 | Un hook `beforeUserCreate`, `beforeLogin`, `beforeUserDelete` o `beforeEmailChange` lanzó un error. El mensaje es el del hook; un hook que eligió un estado 4xx responde con él. | Consulta el mensaje. |
| `INVALID_JSON` | 400 | El cuerpo de la solicitud no es JSON. | Envía un cuerpo JSON. |
| `SELF_DISABLE` | 400 | Un administrador intentó desactivar su propia cuenta. | Pídeselo a otro administrador. |
| `NOT_SUPPORTED` | 501 | El repositorio de autenticación de este backend no puede realizar lo solicitado (desactivar cuentas, cambiar una dirección). | Reinicia el servidor para que se agregue la columna, o usa un repositorio que lo soporte. |
| `UNKNOWN_SCOPE_TARGET` | 400 | El destino de un alcance nombra una colección, fuente de almacenamiento o función que este backend no proporciona. `details` lista las que sí proporciona. | Corrige el destino. |
| `UNVERIFIED_IDENTITIES` | 409 | Un enlace mágico, código de correo o restablecimiento de contraseña comprobó la dirección de una cuenta no verificada, y la cuenta posee una identidad de inicio de sesión cuyo proveedor nunca verificó esa dirección. El repositorio de autenticación no puede eliminarla (carece de `unlinkUserIdentity`), por lo que la comprobación se rechaza en lugar de dejar esa vía de acceso abierta en una cuenta verificada. | Implementa `unlinkUserIdentity` en el repositorio de autenticación personalizado, o haz que un administrador revise la cuenta. |
| `SETUP_REQUIRED` | 403 | El proyecto aún no tiene administrador, por lo que esta ruta no está disponible. | Completa la configuración del primer administrador. |
| `TOKEN_ALREADY_USED` | 401 | Se reutilizó un token de un solo uso, o un token de actualización que fue rotado hace más de `refreshTokenReuseIntervalSeconds` segundos. | Solicita uno nuevo o inicia sesión otra vez. |
| `TOKEN_EXPIRED` | 401 | El token ha superado su tiempo de vida. | Solicita uno nuevo. |
| `USER_NOT_FOUND` | 404 | No existe ninguna cuenta con ese id. | Comprueba el id. |
| `WEAK_PASSWORD` | 400 | La contraseña no cumple con la [política de contraseñas](/docs/backend/auth-endpoints/#password-policy) (por defecto, más de 8 caracteres con una mayúscula, una minúscula y un dígito): en el registro, restablecimiento o cambio, y en la contraseña elegida por un administrador: `POST /api/admin/users`, una creación en la colección de usuarios a través de la API de datos, `PUT /api/admin/users/:id` o `POST /api/admin/users/:id/reset-password`. | Elige una más segura. Un administrador que importe cuentas puede enviar `skipPasswordPolicy: true` al crear. |

## Datos, consultas y escrituras

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Este driver no puede calcular la agregación solicitada. | Usa un driver que pueda o calcúlala en el cliente. |
| `BRANCHING_UNSUPPORTED` | — | Se solicitó una rama de base de datos a través del websocket de Studio en la base de datos de desarrollo administrada (PGlite), donde una rama *es* el elemento principal y nada quedaría aislado. El rechazo es el mismo que imprime `rebase db branch`. | Apunta `DATABASE_URL` a un Postgres propio (`rebase dev --docker` inicia uno) y crea la rama allí. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` contiene más operaciones que el límite por lote (1000 por defecto). Un lote es una sola transacción y mantiene sus bloqueos durante toda su duración. | Envíalo en fragmentos; el mensaje indica el límite y tu recuento. |
| `BATCH_UNSUPPORTED` | 400 | El driver de este backend no puede escribir en varias colecciones de forma atómica, y un bucle de escrituras individuales no sería atómico ni se realizaría en un solo viaje de ida y vuelta. | Envía las escrituras como solicitudes separadas, o como llamadas `/bulk` por colección. |
| `BULK_TOO_LARGE` | 400 | El cuerpo de la operación masiva excede el límite de elementos configurado. | Divide la solicitud. |
| `BULK_UNSUPPORTED` | 400 | Esta colección o driver no admite escrituras masivas. | Escribe las filas una a una. |
| `CALLBACK_REJECTED` | 400 / 403 | Un callback de colección rechazó la escritura. Un `throw` desde `beforeSave`/`beforeDelete`/`after*` es un 400 que lleva el propio mensaje del autor; un `beforeDelete` que devuelve `false` es un 403. `details.stage` indica qué callback, `details.path` la colección. | Lee el mensaje: fue escrito por este proyecto, no por Rebase. |
| `CALLBACK_RECURSION` | 500 | Las escrituras iniciadas por hooks se anidaron a más de 16 niveles de profundidad: la escritura de `context.data` de un hook ejecuta los hooks de esa colección nuevamente y nada en la cadena lo detiene (por lo general, un `afterSave` que actualiza su propia fila incondicionalmente). Se revirtió toda la escritura. El mensaje indica el hook y la colección; `details.chain` enumera cada paso de hook → escritura. | Haz que la escritura del hook sea condicional: actúa solo cuando `status === "new"`, o sáltala cuando `values` ya contenga lo que escribiría. |
| `CURSOR_WITH_OFFSET` | 400 | Se combinó `?after=` con `?offset=` o `?page=`. Un cursor ya indica dónde empieza la página, por lo que un offset aplicado encima omite silenciosamente esa cantidad de filas después del cursor, un hueco que el emisor no puede ver en la respuesta. | Usa uno u otro. |
| `DISTINCT_NOT_APPLICABLE` | 400 | Se combinó `?distinct=true` con una consulta de búsqueda o vectorial. Ambas adjuntan una puntuación por fila, por lo que no hay dos filas iguales y `DISTINCT` no colapsaría nada: parecería que funcionó pero no cambiaría nada. | Descarta una de las dos. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Una lectura `distinct` está ordenada por una columna que no devuelve. Un `SELECT DISTINCT` solo se puede ordenar por columnas presentes en su lista de selección, o de lo contrario las filas que colapsa no tendrían un orden definido. `details.fields` las nombra. | Añade esos campos a `?fields=`, o elimínalos de `?orderBy=`. |
| `DATABASE_UNAVAILABLE` | 503 | No se pudo conectar con la base de datos: se rechazó o se perdió la conexión, el host no se resolvió, el servidor se está apagando o iniciando, o la base de datos no acepta nuevas conexiones (`ALLOW_CONNECTIONS false`, que un `rebase db branch create --force` detenido a medio camino deja en su origen; el log del servidor indica la base de datos y `rebase db branch list` la vuelve a abrir). Todos los accesos responden esto, incluidos el inicio de sesión, las rutas de administración y el socket en tiempo real (una trama `ERROR`). Se envía con `Retry-After: 5`. En 0.24 la misma interrupción responde `ROLE_LOOKUP_FAILED`, `INTERNAL_ERROR` o un 500 con el código `ECONNREFUSED`. | Reintenta; el SDK lo hace. Comprueba que la base de datos esté en ejecución y sea accesible desde el servidor. |
| `DB_CONNECT_TIMEOUT` | 503 | Abrir una nueva conexión a la base de datos tardó más de `DB_POOL_CONNECT_TIMEOUT`: la base de datos tarda en aceptar conexiones o está lejos. Se envía con `Retry-After`. | Reintenta; el SDK lo hace. Comprueba la carga de la base de datos y la red hacia ella. |
| `DB_PERMISSION_DENIED` | 500 | Postgres rechazó la sentencia (`42501`): una política de seguridad a nivel de fila deniega este rol o falta un `GRANT`. | Consulta [Troubleshooting](/docs/troubleshooting/). |
| `DB_POOL_EXHAUSTED` | 503 | Todas las conexiones del pool de la base de datos permanecieron ocupadas durante `DB_POOL_CONNECT_TIMEOUT`, por lo que esta solicitud nunca llegó a la base de datos. Se trata de carga, no de un fallo; se envía con `Retry-After`. El servidor registra la solución una vez por minuto en los logs. | Reintenta; el SDK lo hace. Aumenta `DB_POOL_MAX` o busca las consultas lentas o transacciones largas que retienen conexiones. |
| `FIELD_NOT_READABLE` | 400 | Un filtro, `orderBy`, `fields`, `select` de agregación o `groupBy` indica un campo que los roles de este emisor no pueden leer (`access.read`), una ruta anidada o una ordenación agregada indica una relación que no pueden leer, o una operación de campo (`$inc`, `$push`, …) tiene como destino uno, donde un límite rechazado revelaría el valor almacenado. Un campo que ninguna respuesta puede contener debe ser uno que ninguna consulta pueda interrogar, o el valor sería legible predicado por predicado. Un filtro a través de una relación (`author.salary`) y una ordenación agregada sobre el campo de una relación (`max(staff.salary)`) se juzgan según la regla del destino. `details.violations` nombra cada campo. Un campo oculto con `excludeFromApi` responde como si no existiera: un filtro, `orderBy`, `fields`, `include`, `select` de agregación o `groupBy`, o `vector_search` que lo nombre recibe exactamente la misma respuesta que recibe un nombre mal escrito (`UNKNOWN_FILTER_FIELD`, `UNKNOWN_ORDER_BY_FIELD`, `UNKNOWN_FIELD`, `UNKNOWN_RELATION`, `UNKNOWN_AGGREGATE_FIELD` o `UNKNOWN_VECTOR_PROPERTY`), y ninguna respuesta de campo desconocido lo enumera. | Elimina el campo de la consulta o adquiere el rol. Consulta [Field access](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 | El cuerpo establece un campo que los roles de este emisor no pueden escribir (`access.write`). Rechazado en lugar de omitido: una escritura que descarta un campo informaría de éxito para una edición que no ocurrió. El mismo código rechaza una escritura a través de un registro padre que establece una relación que el emisor no puede escribir, y una actualización que establece un campo de `softDelete` a un valor (solo una eliminación lo marca). `details.violations` enumera cada campo. | Elimina el campo o adquiere el rol. Un campo que nadie puede escribir responde `VALIDATION_EXCLUDED_FIELDS` en su lugar. |
| `HISTORY_UNAVAILABLE` | 503 | Se rechazó una escritura en una colección con `history: true` porque no se pudo registrar su entrada de historial: la base de datos no tiene la tabla `rebase.entity_history` o, para `openRebase` y `rebase console`, no tiene la función `rebase.record_history`. Ningún backend con historial ha arrancado en esta base de datos. No se ejecutó nada, callbacks incluidos, y las lecturas no se ven afectadas. Lanzado por `openRebase` y respondido por un backend creado con `provision: false`. | Inicia el backend una vez con el historial activado y `provision: true` (`rebase dev` lo hace), luego reintenta. |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Una solicitud anterior con la misma `Idempotency-Key` todavía se está ejecutando. | Reintenta una vez que termine. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | La misma `Idempotency-Key` llegó en una solicitud diferente: otro método, ruta, cadena de consulta o cuerpo. | Usa una nueva clave o envía la solicitud original. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` especificó una función que no es `count`, `sum`, `avg`, `min` ni `max`. | Usa una de esas; el mensaje las enumera. |
| `INVALID_AGGREGATE_SELECT` | 400 | Una entrada de `?select=` no tiene el formato `fn(field)`, o a una función distinta de `count()` no se le proporcionó ningún campo. | Escribe `sum(total)`, `count()`, `avg(score)`. |
| `INVALID_AGGREGATE_WINDOW` | 400 | `offset`, `page` o `orderBy` en una agregación sin `groupBy`, o un cursor en cualquier agregación. Una agregación no agrupada es una sola fila, y un grupo no es una fila después de la cual un cursor pueda continuar. | Añade `groupBy` o elimínalos; pagina los grupos con `offset` o `page`. Consulta [Aggregates](/docs/sdk/aggregates-and-search/#aggregates). |
| `INVALID_BATCH_BODY` | 400 | A una operación de `/_batch` le falta `op`, `collection`, `values` o `id`, especifica una colección que este backend no proporciona o reutiliza un nombre de `ref`. | Consulta el mensaje; indica la operación por índice. |
| `INVALID_BATCH_REF` | 400 | Un `{ "$ref": "<name>.<field>" }` no hace referencia a ninguna operación anterior, apunta hacia adelante o solicita un campo que la fila referenciada no tiene. Solo se resuelven las referencias hacia atrás. | Nombra la operación con `ref` *antes* de referenciarla. |
| `INVALID_BULK_BODY` | 400 | El cuerpo de la operación masiva no tiene el formato esperado. | Envía el array que espera la ruta: `{ "rows": [...] }` para `POST /bulk`, `{ "updates": [{ "id", "data" }] }` para `PATCH /bulk`, `{ "ids": [...] }` para `POST /bulk/delete`. |
| `INVALID_CONFLICT_TARGET` | 400 | El `on_conflict` / `onConflict` de un upsert nombra columnas que no garantizan unicidad, las nombra sin `upsert: true`, o se envía en una creación anidada donde una fila coincidente se movería bajo el nuevo padre. De lo contrario, Postgres respondería 42P10 desde dentro de una transacción que ya ha realizado operaciones. También cualquier upsert en la colección de usuarios (auth), donde una creación y una actualización siguen reglas diferentes. | Declara `validation: { unique: true }` o un índice `unique`; el mensaje enumera los destinos que sí existen. En la colección de usuarios, envía un `POST` para crear y un `PATCH` para actualizar. |
| `INVALID_COUNT` | 400 | `?count=` no es `exact` ni `none`. Rechazado en lugar de interpretarse como el valor predeterminado: un error tipográfico como `?count=nnone` pagaría el costo del recuento que se pretendía omitir. | Envía `exact` (el valor predeterminado) o `none`. Consulta [Skipping the count](/docs/backend/api/#skipping-the-count). |
| `INVALID_CURSOR` | 400 | El cursor `after` no se puede leer o nombra un id de fila que no coincide con las columnas clave de la colección: fue truncado, recodificado o construido manualmente. Un cursor legible enviado con un `orderBy` diferente de aquel bajo el cual se emitió devuelve `CURSOR_ORDER_MISMATCH`, también un 400. | Devuelve `meta.nextCursor` de la página anterior sin cambios, con el mismo `orderBy` o ninguno. Consulta [Pagination](/docs/sdk/pagination/). |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` no es `include` ni `only`. Rechazado en lugar de ignorado: un error como `?deleted=true` que ocultara silenciosamente cada fila eliminada parecería haber funcionado y respondería a la pregunta opuesta. | Envía `include` (activas y eliminadas) u `only` (solo eliminadas). Omítelo para obtener solo filas activas. |
| `INVALID_DISTINCT` | 400 | `?distinct=` no es `true` ni `false`. | Envía uno de esos valores; también se aceptan `1` y `0`. |
| `INVALID_FIELD_OPERATION` | 400 | Se utilizó `$inc` / `$push` / `$pull` / `$merge` en un tipo de propiedad para el que no está definido, con un operando con formato incorrecto, con dos operadores en un mismo campo, mal escrito o en una creación (donde no hay ningún valor almacenado sobre el que operar). | Consulta [Writing over REST](/docs/backend/writes/#field-operations); el mensaje indica el campo. |
| `INVALID_FILTER_FIELD` | 400 | El filtro indica una propiedad que esta colección no tiene. | Comprueba cómo está escrito comparándolo con la colección. |
| `INVALID_FILTER_OPERATOR` | 400 | El operador no es compatible con este tipo de propiedad; por ejemplo, `like` en un número o una fecha. | Consulta [Querying data](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | Un valor de filtro no se puede interpretar como el tipo de la columna contra la que se comparó: `?id=eq.abc` en una clave entera, una etiqueta que no está en el enum, una marca de tiempo que no lo es, un número fuera del rango del tipo. `details.dbCode` contiene el SQLSTATE. | Envía un valor del tipo de la columna. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` no es `true` ni `false`. Cualquier otra cosa se rechaza en lugar de interpretarse como "no": una errata que borra de forma lógica (soft delete) cuando el emisor pidió purgar le hace creer que los datos han desaparecido. | Envía `true` o `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` está malformado: no es una lista de rutas válida o es un objeto de opciones por relación con formato incorrecto. Una ruta anidada más allá de tres saltos devuelve `INCLUDE_TOO_DEEP`, también un 400. Se responde en el límite en lugar de salir del driver como un 500. | Consulta el mensaje; indica la ruta infractora. |
| `INVALID_INPUT` | 400 | El cuerpo no superó la validación. | Consulta el mensaje. |
| `INVALID_LIMIT` | 400 | `?limit=` no es un número entero de 1 al máximo (1000 por defecto); un valor mayor se rechaza, no se acota. Una suscripción en tiempo real que pida un límite fuera de ese rango recibe el mismo código en una trama `ERROR` de WebSocket. | Reduce el límite y pagina a través del resto. |
| `INVALID_LOGICAL_GROUP` | 400 | Un grupo `?or=` / `?and=` / `?not=` está malformado o anidado más allá de la profundidad permitida. | Consulta el mensaje; muestra la regla de aplanamiento. |
| `INVALID_OFFSET` | 400 | `?offset=` no es un número entero mayor o igual a 0. | Envía un número entero no negativo. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` no es `field`, `field:desc`, `field:desc:last` ni un array JSON de `{ field, direction, nulls }`, o indica una dirección distinta de `asc`/`desc`, o una colocación de NULL distinta de `first`/`last`. | Consulta el mensaje; muestra todas las formas válidas. |
| `INVALID_PAGE` | 400 | `?page=` no es un número entero mayor o igual a 1. Las páginas empiezan en 1, por lo que `?page=0` es un error en lugar de la primera página. | Envía `1` o más, o usa `?offset=`. |
| `INVALID_PARAM` | 400 | Un parámetro de consulta está malformado. | Consulta el mensaje. |
| `INVALID_QUERY_BODY` | 400 | El cuerpo de un `POST …/query` contiene un valor que la URL no habría podido llevar: una lista para un parámetro que la URL lee una sola vez (`fields`, `limit`, …), un objeto para un filtro, o cualquier parámetro también presente en la URL (un `POST …/query` lee todos los parámetros del cuerpo). | Escribe cada valor como lo hace la URL: una cadena, o una lista para un filtro repetido; `where`, `include`, `orderBy` y `vector` aceptan JSON. Consulta [Queries too long for a URL](/docs/backend/vector-search/#queries-too-long-for-a-url). |
| `INVALID_VECTOR` | 400 | `?vector=` no es un array JSON de números. | Envía `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` no es `cosine`, `l2` ni `inner_product`. | Usa uno de esos tres. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` no es un número. | Envía un número. |
| `INVALID_WHERE` | 400 | `?where=` no es un objeto JSON que asocie campos con condiciones. | Envía `{"status":["==","active"]}`. |
| `KEY_IMMUTABLE` | 400 | Una actualización indica la clave de la fila con un valor diferente al que se utiliza para direccionarla: en el cuerpo o escrito por un `beforeSave`. Una fila no puede moverse a otra clave: todo lo posterior a la escritura (la relectura, `afterSave`, el historial, el tiempo real) la direcciona mediante la clave que tenía. Se rechaza antes de ejecutar ningún hook, sin escribir nada, en todos los accesos. `details.violations` nombra el campo. | Crea la fila con la nueva clave y elimina esta. Enviar la clave que la fila ya tiene es válido. |
| `MISSING_AGGREGATE_SELECT` | 400 | Se llamó a la ruta de agregación sin `?select=`. | Añade uno, por ejemplo `?select=count()`. |
| `NO_COLLECTIONS` | 404 | El proyecto no sirve colecciones: ninguna declarada en el código y ninguna tabla de la cual derivarlas. Cuando existen tablas pero la seguridad a nivel de fila está desactivada en ellas, el mensaje las enumera junto con el SQL para activarla, y `details.unprotectedTables` las lista; en 0.24 indica que no hay tablas. | Crea tablas (una migración, SQL o un archivo de colección más `rebase db push`) y reinicia. |
| `NOT_FOUND` | 404 | No existe ninguna fila con ese id en esa colección, o se trata de una fila que la seguridad a nivel de fila oculta para este emisor. | Comprueba el id y luego las `securityRules` de la colección. |
| `UNKNOWN_RELATION` | 400 / 404 | `?include=` indica algo que no es una relación en la colección. El mismo código responde **404** cuando es una *ruta de URL* anidada la que lo indica, por ejemplo `/api/data/authors/1/posts` donde `authors` no declara ninguna; allí la URL no apunta a nada, por lo que es un "no encontrado" en lugar de una solicitud malformada. | Comprueba el nombre de la relación; el mensaje enumera las que tiene la colección. Una referencia inversa debe declararse en el padre para ser navegable. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | La ordenación indica una propiedad que no se puede ordenar. | Ordena por una propiedad respaldada por una columna. |
| `PAGE_WITH_OFFSET` | 400 | Se combinó `?page=` con `?offset=`, o `page` con `offset` en un `find()`, lo cual rechazan con el mismo código antes de cualquier solicitud el SDK de cliente, el `rebase.data` en proceso y el cliente offline. Describen la misma ventana, y `page` solía imponerse silenciosamente sobre un `offset` que el llamador nunca veía aplicado. | Envía solo uno de ellos. |
| `PAYLOAD_TOO_LARGE` | 413 | El cuerpo excede el límite configurado. | Envía menos datos o aumenta el límite. |
| `READ_ONLY_TRANSACTION` | 409 | Un callback `afterRead` intentó escribir. Una lectura con ámbito de solicitud se ejecuta en una transacción `READ ONLY`, por lo que ni el callback ni nada de lo que llame pueden escribir. | Mueve la escritura fuera de la lectura: un trabajo en segundo plano (background job) o `rebase.dataAsAdmin` desde una tarea cron o una función personalizada. |
| `RELATION_HAS_NO_PIVOT` | 400 | La escritura llevaba datos de enlace (link payload), pero la ruta no llega a su destino a través de un `manyToMany` que declare `through.properties`, por lo que no hay fila de unión donde colocarlos. | Declara `through.properties` en la relación o elimina los datos de la escritura. Consulta [Relations](/docs/collections/relations/). |
| `RELATION_MISCONFIGURED` | 500 | Una relación no se resuelve contra el esquema registrado. La operación se rechaza en lugar de omitirse: descartarla reportaría éxito para una escritura que nunca ocurrió, o un resultado vacío para filas que existen. | Ejecuta `rebase schema generate` si el esquema generado es anterior a la base de datos. |
| `RELATION_NOT_UNLINKABLE` | 400 | La relación no se puede desvincular desde este lado. | Escribe desde el lado propietario. |
| `RELATION_NOT_WRITABLE` | 400 | La ruta anidada no es una relación escribible, o una creación o actualización especifica una relación `via` de múltiples saltos (solo las relaciones `via` de un solo salto son escribibles). `details.fields` enumera las claves `via`. No se escribió nada. | Escribe directamente las filas que une la cadena. Consulta [Relations](/docs/collections/relations/#via--an-explicit-join-chain). |
| `RELATION_PIVOT_UNSUPPORTED` | 400 | La relación declara columnas de unión, pero esta fuente de datos no puede escribirlas. | El enlace en sí sigue funcionando; solo los datos adjuntos a él no. Comprueba las capacidades del driver. |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Una escritura de relación no tenía una clave de origen a la cual asociar el enlace. | Guarda primero la fila padre. |
| `RESULT_TOO_LARGE` | — | Una sentencia enviada a través de `EXECUTE_SQL` del socket en tiempo real (`admin.executeSql` desde un cliente, lecturas de catálogo del panel de administración) devolvió más de 128 MB de filas, por lo que no se envió nada. Se entrega como una trama `ERROR` de WebSocket. Las ejecuciones de la propia consola SQL no se rechazan: muestran las primeras filas. | Añade un `LIMIT` o selecciona menos columnas, y lee el resultado por partes. |
| `ROW_IN_TRASH` | 409 | La clave de un upsert pertenece a una fila en la papelera (una fila borrada de forma lógica aún conserva su clave). Un upsert no escribe en una fila eliminada, en ningún punto de entrada: `?on_conflict=` de REST, upserts en `/bulk` y `/_batch`, el SDK y el socket en tiempo real. No se escribió nada. | Restaura la fila primero (una actualización que establezca el campo de borrado lógico en `null`), o púrgalo con `?hard=true` y haz el upsert nuevamente. Consulta [Soft delete](/docs/collections/soft-delete/). |
| `SCHEMA_DRIFT` | 500 | Una tabla o columna que el código espera no existe en la base de datos. | Ejecuta `rebase db push` en desarrollo; vuelve a desplegar en un tenant administrado. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | Se combinó `startAfter` con `orderBy: "_score"`. La relevancia se calcula por consulta en lugar de almacenarse, por lo que no puede servir de clave para un cursor. | Pagina la relevancia con `limit`/`offset`, u ordena por una columna. |
| `SQL_ERROR` | 400 | La base de datos rechazó el SQL escrito por un usuario. A través de `EXECUTE_SQL` del socket en tiempo real es una trama `ERROR` con el mensaje de la base de datos. `POST /api/admin/sql/csv` responde esto antes de que se envíe nada del archivo: un error de sintaxis, una escritura (la descarga se ejecuta como solo lectura), más de una sentencia o un rol que la conexión no puede asumir. | Corrige el SQL. Una descarga acepta un único `SELECT`, `WITH … SELECT`, `TABLE` o `VALUES`. |
| `TENANT_IMMUTABLE` | 400 | Una escritura movería una fila de un tenant a otro. Una fila no puede cambiar de tenant. `details.violations` nombra el campo. | Crea la fila en el otro tenant y elimina esta, o escribe con un rol en `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | La escritura indica un tenant al que este emisor no pertenece; la base de datos también la rechazaría. | Escribe en un tenant al que pertenezca el emisor o autentícate como alguien que pertenezca a él. |
| `TENANT_REQUIRED` | 400 | La colección está delimitada por tenant y el tenant no se puede deducir: la solicitud no lleva ninguno o el emisor pertenece a varios. | Envía el campo de tenant explícitamente o autentícate como un emisor que pertenezca a uno solo. |
| `TRANSACTION_ABORTED` | 500 | Una sentencia en la transacción de escritura falló y un callback capturó el error. Postgres ya había abortado la transacción, por lo que la escritura se revirtió y no se almacenó nada. Solo una creación, actualización o eliminación de `context.data` que la base de datos rechazó se deshace por sí sola y es seguro capturarla. | Deja que el error se lance, o realiza comprobaciones antes de ejecutar la sentencia. Consulta [Transaction Semantics](/docs/collections/context-data-api/#transaction-semantics). |
| `UNKNOWN_FIELD` | 400 | `?fields=` nombra un campo que la colección no tiene. | Comprueba cómo está escrito; el mensaje enumera los campos válidos. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Una agregación o `groupBy` indica un campo que la colección no tiene. | Comprueba cómo está escrito; el mensaje enumera los campos válidos. |
| `UNKNOWN_FILTER_FIELD` | 400 | El filtro indica un campo que esta colección (o el destino de una relación) no tiene, o uno oculto con `excludeFromApi`. | Comprueba cómo está escrito; el mensaje enumera los campos válidos. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | El filtro indica un operador que no existe. | El mensaje lista todos los operadores. |
| `UNKNOWN_MESSAGE_TYPE` | 400 | Una trama del socket en tiempo real tiene un `type` que el servidor no procesa. Se responde como una trama `ERROR` con el `requestId` de la solicitud, para que la solicitud finalice en lugar de agotar el tiempo de espera. | Comprueba el `type` de la trama; el mensaje lo nombra. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | La ordenación indica un campo que esta colección no tiene. | Comprueba cómo está escrito; el mensaje enumera los campos válidos. |
| `PRECONDITION_FAILED` | 412 | Una cabecera `If-Match` indicó una versión de la fila que ya no es la actual: alguien escribió en ella entre la lectura y esta escritura. No se escribió nada. | Vuelve a leer la fila, vuelve a aplicar el cambio y envía el nuevo `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` solicita un campo que la colección no tiene. | Comprueba cómo está escrito; el mensaje enumera los campos conocidos. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Una búsqueda vectorial indicó una propiedad que no es un `vector` en esta colección. | El mensaje enumera las propiedades vectoriales de la colección. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | El `Content-Type` no es uno de los aceptados por esta ruta. | Envía el tipo documentado para la ruta. |
| `UNSUPPORTED_OPTION` | — | Se lanza como excepción, no se responde: a una escritura a través del descriptor de acceso en proceso (`context.data` en un callback, `rebase.data` en una función o cron) se le pasó `ifMatch` o `idempotencyKey`. Esa vía de acceso carece de comprobación de precondiciones o almacenamiento de idempotencia, por lo que la opción se rechaza antes de escribir nada en lugar de ignorarse. | Omite la opción allí o realiza la escritura a través del cliente HTTP, que admite ambas. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | El filtro cruza una relación `via`, cuya ruta de unión está definida en una sola dirección, por lo que no hay nada con lo que correlacionar una subconsulta. | Filtra desde el lado propietario. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | El operador no está definido para ese campo: una relación sin columna en esta fila se filtra por pertenencia, y la coincidencia de patrones (`like`, `ilike` y sus negaciones) solo se aplica a texto. | Consulta el mensaje; lista lo que el campo acepta. |
| `VALIDATION_CONSTRAINT` | 400 | Un valor infringió una regla de `validation` que declara la propiedad: una longitud, un rango, un patrón o un campo requerido. | Consulta el mensaje; indica cada infracción. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | El cuerpo escribe una columna marcada como `excludeFromApi` o `access: { write: [] }` (la misma regla, dos formas de escribirlo). Esas son responsabilidad del servidor: un hash de contraseña, un token de verificación. A diferencia de `FIELD_NOT_WRITABLE`, esta es la misma respuesta para cualquier emisor, incluido `admin`. | Elimina el campo. Consulta [Field access](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Un valor no se ajusta al tipo de su propiedad. | Consulta el mensaje; nombra la propiedad. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | El cuerpo indica un campo que la colección no tiene, incluido un argumento `id` en una colección indexada por otra cosa. | Comprueba cómo está escrito; el mensaje enumera los campos conocidos. |
| `VECTOR_CURSOR_UNSUPPORTED` | 400 | Se combinó un cursor (`after` / `startAfter`) con una búsqueda vectorial. Las filas se ordenan según una distancia calculada por consulta, la cual no puede usarse como clave de cursor, por lo que un listado vectorial no incluye `nextCursor`. | Pagina las filas más cercanas con `limit`/`offset`. |
| `WRITE_DENIED` | 403 | Una regla de seguridad o política de seguridad a nivel de fila rechazó la escritura. | Comprueba las `securityRules` de la colección. |

## `PG_<SQLSTATE>` — una restricción que la base de datos rechazó

Una escritura que Postgres rechaza por un motivo imputable a *los datos del emisor*
responde con el SQLSTATE en el código: `PG_23505`, `PG_23503`, etc. Se trata de
una familia, no de una lista (Postgres define cientos de SQLSTATE), pero solo
dos clases llegan a emitirlo, porque solo esas dos son atribuibles al emisor:

- **clase 23**, violación de restricción de integridad: un duplicado, una clave
  foránea que no apunta a nada, una columna NOT NULL dejada vacía;
- **clase 22**, excepción de datos: un valor que el tipo de la columna no puede almacenar.

Todo lo demás (una conexión interrumpida, una columna inexistente, un problema
de privilegios) es responsabilidad del servidor y permanece como un `500`. Por
tanto, `code.startsWith("PG_")` es una comprobación segura para saber si "la fila
que envié era incorrecta", y los cuatro siguientes son los que un cliente suele
encontrar en la práctica. `details.dbCode` contiene el mismo SQLSTATE para todos
ellos, y el mensaje indica el nombre de la restricción.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | Un valor no se pudo interpretar como el tipo de la columna: el equivalente en escritura de `INVALID_FILTER_VALUE`. | Envía un valor del tipo de la columna. |
| `PG_23502` | 400 | Se dejó vacía una columna `NOT NULL`. | Envía el campo o asigna un valor predeterminado a la columna. |
| `PG_23503` | 400 / 409 | En un guardado, una clave foránea apunta a una fila inexistente (400). En un borrado, otras filas aún hacen referencia a esta (409; una clave `RESTRICT` genera `PG_23001`, también 409). | Crea la fila de destino primero o corrige el id; para una eliminación, elimina o reasigna antes las filas que hacen referencia a ella. |
| `PG_23505` | 409 | Se infringió una restricción de unicidad. El mensaje indica la restricción. | Usa un valor diferente o actualiza la fila existente. |

## Almacenamiento

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `INVALID_LIST_OPTIONS` | 400 | El `maxResults` de un listado de almacenamiento no es un número entero mayor o igual a 1, o su `pageToken` no es uno emitido por la fuente. Un tamaño de página inferior a 1 solía responder una página vacía con el mismo token, por lo que un bucle `while (pageToken)` nunca terminaba. | Envía un `maxResults` positivo y devuelve `nextPageToken` sin cambios. |
| `INVALID_STORAGE_BUCKET` | 400 | El nombre del bucket es inválido. | Comprueba el nombre. |
| `INVALID_STORAGE_KEY` | 400 | La clave del objeto es inválida, se sale de su prefijo o está bajo un prefijo reservado (`_rebase/renditions/`, `_rebase/maintenance/`). | Comprueba la clave. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | Los parámetros de transformación de imagen están fuera de rango o son contradictorios. | Consulta [Storage](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | La subida excede el `maxSize` declarado por la propiedad de destino. Se valida en el servidor, no solo en el navegador. `details` incluye la propiedad, el límite y el tamaño real. | Sube un archivo más pequeño o aumenta `maxSize` en la propiedad. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | El tipo del archivo subido no está en el `acceptedFiles` de la propiedad o no está en el `allowedMimeTypes` de la propia fuente de almacenamiento. `details` contiene la propiedad (o la lista de la fuente), la lista aceptada y el tipo de contenido enviado. | Sube un tipo aceptado o amplía `acceptedFiles` / `allowedMimeTypes`. |
| `STORAGE_MISCONFIGURED` | 502 | El bucket de S3 o GCS con el que está configurada esta fuente no existe, o el proveedor rechazó las credenciales de este despliegue para él. El mensaje indica el nombre del bucket; `details.reason` es `NoSuchBucket` o el rechazo del proveedor. La falta de un bucket solía interpretarse como "archivo no encontrado" para todos los archivos. | Corrige el nombre del bucket (`S3_BUCKET` / `GCS_BUCKET`, `__<KEY>` para una fuente con nombre) o los permisos de las credenciales. |
| `STORAGE_NOT_CONFIGURED` | 501 / 503 | No hay ningún backend de almacenamiento configurado en este servidor, o ninguno es el predeterminado y la solicitud no indica una fuente de almacenamiento; el mensaje enumera las fuentes que están disponibles (501). Una subida reanudable cuya fuente desapareció antes de terminar es un 503. | Configura S3, GCS o almacenamiento local, o especifica una fuente con `?storageId=`. |
| `STORAGE_SAME_LOCATION` | 400 | `POST /api/admin/storage/move` con `deleteSource` (`rebase storage move --delete-source`) entre dos fuentes que almacenan en el mismo bucket o directorio. Cada archivo contaría como que ya está en el destino al tratarse del mismo archivo, y eliminar la copia del origen eliminaría la única existencia. No se movió ni eliminó nada. | Apunta la propiedad a la otra fuente; sus archivos ya están allí. |
| `STORAGE_SCAN_INCOMPLETE` | 409 | `DELETE /api/admin/storage/orphans` (`rebase storage orphans --delete`) no pudo leer todas las colecciones, por lo que un archivo nombrado por una de ellas parecería no utilizado. Con `?scan=`, el análisis indicado es el que no pudo leer todas las colecciones. No se eliminó nada; `details.unscanned` indica cada colección y el motivo por el cual no se pudo leer. | Soluciona lo que impide leer esas colecciones y ejecútalo de nuevo. |
| `STORAGE_SCAN_NOT_FOUND` | 404 | `GET /api/admin/storage/orphans/scans/:id` o `DELETE /api/admin/storage/orphans?scan=:id` indica un análisis que la fuente no contiene. Los análisis se conservan durante 7 días en la fuente analizada, por lo que un `storageId` diferente al del análisis tampoco encontrará ninguno. | Envía el `storageId` del análisis o inicia otro análisis. |
| `STORAGE_SCAN_NOT_COMPLETE` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` indica un análisis que todavía está en estado `queued` o `running`, o que tiene estado `failed`. No se eliminó nada; `details.status` indica el estado. | Espera a que termine el análisis o inicia otro. |
| `STORAGE_SCAN_EXPIRED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` indica un análisis completado hace más de 15 minutos. No se eliminó nada. | Inicia otro análisis y elimina a partir de él. |
| `STORAGE_SCAN_DELETION_STARTED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` indica un análisis cuyos archivos huérfanos ya se están eliminando. | Lee la propiedad `deletion` del análisis con `GET /api/admin/storage/orphans/scans/:id`. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | La fuente de almacenamiento está declarada pero no tiene credenciales aquí. | Configura las variables de entorno de esa fuente. |
| `STORAGE_WRITE_FAILED` | 502 | El backend de almacenamiento rechazó o interrumpió la escritura. | Comprueba sus propios registros y credenciales. |
| `TRANSFORM_OVERLOADED` | 503 | Hay demasiadas transformaciones de imagen en curso. | Reintenta; considera colocar una CDN delante. |
| `UNKNOWN_STORAGE_SOURCE` | 400 / 404 | La solicitud indicó una fuente de almacenamiento (`?storageId=`) que este proyecto no declara. Un `bucket` que este despliegue no sirve devuelve este mismo código con un estado **404** (en un listado y en una subida, una carpeta o una subida reanudable a S3 o GCS): el almacenamiento es lo que falta, y `details` indica los buckets y las fuentes que sí existen. Ambos solían devolverse como "archivo no encontrado", idéntico a una clave que simplemente no existe. | Declara la fuente en `config/resources.ts` o consulta `GET /api/storage/sources`. |
| `UPLOAD_LOCKED` | 423 | El `PATCH` de una subida reanudable llegó mientras aún se recibía otro fragmento de la misma subida; casi siempre se trata de un cliente que reintenta el fragmento en curso. Se rechaza en lugar de ponerse en cola, tal como hace tusd. | Solicita el offset con `HEAD /api/storage/tus/:id` y reanuda desde allí; tus-js-client aplica retroceso exponencial y reintenta por su cuenta. Consulta [Resumable uploads (TUS)](/docs/backend/storage-resumable-uploads/). |

## Funciones personalizadas

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | No se sirve ninguna función con ese nombre, o sí se sirve pero sus propias rutas no cubren la ruta posterior. A un cliente autenticado también se le indica qué *sí* se sirve; a uno anónimo no, porque esa lista es un inventario de cada endpoint personalizado. Cuando un archivo con ese nombre no se pudo cargar, el mensaje se lo indica a un cliente autenticado nombrando el archivo: esa es la diferencia entre una errata y un despliegue defectuoso. Un emisor anónimo recibe la respuesta simple de nombre desconocido, igual que para un nombre que no coincide con nada. | Comprueba el nombre comparándolo con `GET /api/functions`, o revisa el registro de arranque en busca de un archivo que no se haya cargado. |
| `FUNCTION_TIMEOUT` | 504 | El controlador superó su tiempo límite. Todavía se está ejecutando; no se puede cancelar desde aquí. | Pasa un `AbortSignal` a las llamadas salientes o aumenta `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Este proceso actúa como proxy de funciones hacia otro que no respondió. | Comprueba que la unidad de funciones esté en ejecución. |

## Tareas cron

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `CRON_JOB_ALREADY_EXECUTING` | 409 | Disparo manual de una tarea cron que ya se encuentra en ejecución: en el proceso que respondió o en otro que retiene el bloqueo de ejecución (lease) de la tarea, como el worker detrás de un proceso `api`. No se ejecutó nada. La omisión queda registrada en el historial de la tarea y `details.log` es esa entrada; su línea indica el proceso que ejecuta la tarea. | Vuelve a intentarlo cuando termine esa ejecución. Consulta [Cron Jobs](/docs/backend/cron-across-instances/#concurrency-guarding). |

## Superficies de administración y edición de esquemas

Estos indican que una funcionalidad está desactivada o sin configurar en lugar de
que la solicitud fuera errónea. Cada uno de ellos se reporta también en la ruta
`/status` correspondiente con un `200`, de modo que un panel pueda deshabilitar
visualmente la opción en lugar de mostrar un error.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | Se llamó a una interfaz exclusiva de administración en un servidor sin autenticación configurada, por lo que no es posible distinguir a un administrador de un desconocido. | Configura `auth.jwtSecret` o pasa un `AuthAdapter`. |
| `BRANCH_DIFF_STALE` | 409 | Se envió a `POST /api/admin/branches/:name/merge` la huella digital (fingerprint) de un diff que ya no es válido: la rama o su elemento principal cambiaron desde entonces. No se escribió nada. | Lee el diff nuevamente, revísalo y fusiona con su nuevo `fingerprint`. |
| `BRANCH_DIFF_UNSUPPORTED` | 501 | La fuente de datos no puede comparar ramas: no dispone de SQL o no admite ramas (no hay conexión de administración). | Usa un backend de Postgres con `adminConnectionString` configurado. |
| `BRANCH_MERGE_BLOCKED` | 409 | Una tabla que difiere no se puede fusionar: agregada o eliminada por la rama, columnas o clave primaria que difieren, sin clave primaria, demasiadas filas para comparar o reescrita desde que se creó la rama (`TABLE_REWRITTEN`). Una tabla cuyas filas no pudieron ser comparadas bloquea la operación incluso si sus recuentos marcan 0: son desconocidos, no cero. `details.tables` enumera cada una con su motivo. No se escribió nada. | Aplica primero el esquema con tus migraciones, o fusiona con `skipBlocked: true` para ignorar esas tablas. |
| `BRANCH_MERGE_CONFLICT` | 409 | Se modificaron filas tanto en la rama como en su elemento principal, y `onConflict` era `"abort"` (el valor predeterminado); o el elemento principal rechazó parte de la fusión (una fila cambió mientras tanto, un trigger la omitió, una política la ocultó). No se escribió nada. | Elige qué lado prevalece con `onConflict: "branch"` o `"target"`, o lee el diff de nuevo. |
| `BRANCH_MERGE_FAILED` | 409 | El elemento principal rechazó las filas de la rama dentro de la sentencia de fusión: una restricción, una etiqueta de enum o una clave foránea presente en él que las filas de la rama infringen, generalmente porque ambos esquemas difieren. `details` contiene `sqlState`, `table`, `constraint` y `detail`. No se escribió nada. | Revisa los cambios de esquema del diff, alinea el esquema principal con tus migraciones o corrige las filas de la rama y fusiona nuevamente. |
| `BRANCH_NOT_FOUND` | 404 | No existe ninguna rama con ese nombre en el registro. | `rebase db branch list`, o el panel de Ramas, lista las existentes. |
| `CONTRACT_UNAVAILABLE` | 404 | El contrato del proyecto solo se sirve cuando la autenticación está configurada (describe cada tabla y relación). | Configura la autenticación. `/meta/schema-version` siempre se sirve. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | No hay ningún buzón de desarrollo activo. El correo solo se captura cuando `SMTP_HOST` no está configurado y `NODE_ENV` no es production. | Desasigna `SMTP_HOST` en desarrollo o consulta la bandeja de entrada real. |
| `INVALID_CHANGE` | 400 | El cambio de esquema propuesto no tiene un formato correcto. | Consulta el mensaje. |
| `SCHEMA_CHANGE_FAILED` | 400 | La aplicación de un cambio de esquema planificado falló por un motivo que los códigos más específicos no cubren. | Consulta el mensaje; es el fallo subyacente literal. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | El cambio es válido pero no se puede aplicar al esquema en su estado actual. | Consulta el mensaje. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | El repositorio tiene cambios sin confirmar (uncommitted changes), por lo que la edición no pudo aplicarse de forma segura. | Haz commit o stash, y vuelve a intentarlo. |
| `SCHEMA_EDIT_REFUSED` | 400 | El editor de esquemas rechazó la modificación. | Consulta el mensaje; es el rechazo directo del editor. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Una clave de API u otra entidad máquina intentó aplicar un cambio de esquema. | Inicia sesión como usuario o configura `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | La edición de esquemas en vivo necesita `collectionsDir` o `liveSchema.repository`, y este servidor se inició sin ninguno de los dos. | Configura uno de ellos. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | La planificación funciona; no hay ningún repositorio en el que confirmar el cambio. | Configura `liveSchema.repository`. |
| `SCHEMA_EDITING_PROVISIONING_OFF` | 409 | Este despliegue no altera nada en su base de datos (`REBASE_PROVISION=false`), por lo que no se puede aplicar un cambio desde el panel. | Confírmalo únicamente en el código fuente y deja que el proceso que modifica la base de datos lo aplique. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Este driver no puede planificar cambios de esquema. | La edición en vivo está disponible en Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | En este entorno las colecciones se introspeccionan desde la base de datos, por lo que no hay archivos fuente para editar. | Modifica el esquema mediante una migración. |
| `SCHEMA_EDITOR_DISABLED` | 501 | El editor de esquemas está desactivado para este servidor. Un bundle compilado siempre responde esto. | Actívalo con `schemaEditor`. En un bundle, configura `REBASE_LIVE_SCHEMA_REPOSITORY` para editar colecciones mediante un repositorio; consulta [Live schema editing](/docs/backend/live-schema-editing#from-a-built-bundle). |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | El editor de esquemas necesita `ts-morph`, que no está instalado. | Instálalo en el paquete que ejecuta el backend y luego reinícialo: `pnpm --dir backend add -D ts-morph@28.0.0` desde la raíz de un proyecto generado, o `pnpm add -D ts-morph@28.0.0` si el backend es el proyecto mismo. El mensaje indica el comando para tu proyecto. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | El servidor no tiene configurado `collectionsDir`, por lo que el editor no tiene dónde escribir. | Configura `collectionsDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | El editor está desactivado con `NODE_ENV=production`: los archivos de un servidor desplegado se reconstruyen a partir de tu repositorio en cada despliegue, por lo que una edición realizada aquí se perdería. | Edita las colecciones en desarrollo y despliega, o configura `liveSchema.repository` para confirmarlas allí. |
| `SQL_EXPORT_UNSUPPORTED` | 501 | `POST /api/admin/sql/csv` no puede transmitir un resultado aquí: la base de datos de desarrollo en proceso (PGlite) tiene una sola conexión, y un cursor retenido durante una descarga bloquearía todas las demás consultas detrás de él; o la fuente de datos carece de cursor SQL. | Apunta `DATABASE_URL` a un Postgres propio (`rebase dev --docker` inicia uno), o añade un `LIMIT` y exporta las filas en pantalla. |

### Por qué no se puede fusionar la tabla de una rama

`BRANCH_MERGE_BLOCKED` nombra cada tabla que rechazó en `details.tables`, con uno
de estos códigos. El mismo código aparece en la propiedad `blocked` de la tabla en el
propio diff, de modo que Studio pueda indicarlo antes de que alguien pulse **Merge**.
Ninguno es una respuesta por sí mismo.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `COLUMNS_DIFFER` | — | Las columnas de la tabla difieren entre la rama y su elemento principal. Las filas se comparan a partir de las columnas que comparten. | Añade las columnas faltantes al elemento principal con tus migraciones (`rebase db push`), luego fusiona. Una migración que reescribe la tabla (un cambio de tipo de columna) la convierte en `TABLE_REWRITTEN`: fusiona antes de tal cambio, o vuelve a crear la rama después de él. |
| `NO_PRIMARY_KEY` | — | La tabla no tiene clave primaria, por lo que las filas no se pueden comparar una a una; el diff solo muestra sus recuentos de filas. | Asigna una clave primaria a la tabla o traslada sus filas manualmente. |
| `PRIMARY_KEY_DIFFERS` | — | Las columnas de la clave primaria, o sus tipos, difieren entre ambas. | Aplica primero el esquema al elemento principal. |
| `TABLE_ADDED` | — | La rama creó la tabla. Una fusión nunca crea tablas. | Créala en el elemento principal con tus migraciones, luego fusiona sus filas. |
| `TABLE_DROPPED` | — | La rama eliminó la tabla. Una fusión nunca elimina tablas. | Elimínala mediante tus migraciones. |
| `TABLE_REWRITTEN` | — | Uno de los lados reescribió cada fila de la tabla desde cero después de crear la rama (un cambio de tipo de columna, un `ADD COLUMN` con un valor predeterminado volátil, `VACUUM FULL`, `CLUSTER`), por lo que todas las filas aparecen como escritas con posterioridad y ya no es posible determinar qué lado modificó cada fila. | Fusiona la rama antes de una migración de este tipo, o vuelve a crear la rama desde el elemento principal después de ella. |
| `TOO_LARGE` | — | La tabla contiene más filas en uno de los lados de las que un diff puede comparar una a una (100.000 por defecto, `maxRowsPerTable`). | Aumenta `maxRowsPerTable` tanto en el diff como en la fusión, o mueve las filas por otro medio. |

## Códigos genéricos

Una ruta utiliza uno de estos cuando no aplica nada más específico.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Malformado, y no aplica nada más específico. | Consulta el mensaje. |
| `UNAUTHORIZED` | 401 | No autenticado, o la credencial fue rechazada. | Inicia sesión o renueva el token. |
| `FORBIDDEN` | 403 | Autenticado, pero no autorizado. | Reintentar con la misma identidad no ayudará. |
| `CONFLICT` | 409 | Un conflicto con el estado existente. | Consulta el mensaje. |
| `INTERNAL_ERROR` | 500 | Algo falló en el servidor. El mensaje es genérico a propósito. | Cita el `requestId`; el motivo se encuentra en los logs. |
| `NOT_CONFIGURED` | 503 | Una dependencia requerida por esta ruta no está configurada en este servidor. | Consulta el mensaje. |
| `SERVICE_UNAVAILABLE` | 503 | No se pudo acceder a un servicio del que depende la solicitud: un bucket de S3 o MinIO, o un host al que una función hace `fetch()` que rechaza la conexión o no se resuelve. El log del servidor indica el host; la respuesta no. Una base de datos inalcanzable es `DATABASE_UNAVAILABLE`. Una conexión a tal servicio que falle responde esto; en 0.24 responde un `500` cuyo código es el error del socket (`ECONNREFUSED`), o `INTERNAL_ERROR`. | Reintenta; comprueba los logs. |

## Mantenimiento de la exactitud de esta página

`pnpm verify:docs` falla cuando falta en estas tablas un código que el servidor
puede generar, cuando una tabla lista un código que nada puede generar, cuando
los estados de una fila no son exactamente aquellos con los que el código fuente
genera el error, o cuando una familia de códigos como `PG_<SQLSTATE>` no tiene una
fila para un SQLSTATE con el que los clientes se encuentran. La fase correspondiente
es `tooling/scripts/docs-verify/check-error-codes.mjs`.

Se comprueba a sí mismo primero. El análisis extrae los códigos directamente de
TypeScript en lugar de hacerlo desde un servidor en ejecución, por lo que sus puntos
ciegos son silenciosos por diseño: en una ocasión no pudo detectar un código que
pasaba por un wrapper de una sola línea, o uno escrito tras un mensaje que contenía
un `)`, e informó que "todos los códigos que el servidor puede emitir están documentados"
en una página a la que le faltaban diecisiete de ellos. Por ello, esta fase ejecuta
una prueba fija (fixture) con exactamente esas estructuras antes de leer esta página,
y se niega a reportar nada si no es capaz de verlas.
