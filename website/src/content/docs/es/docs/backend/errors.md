---
sourceHash: ffb0a0aaabda1c4c
title: Códigos de error
sidebar_label: Códigos de error
description: Todos los códigos de error que un backend de Rebase puede devolver, con su estado HTTP, su significado y qué hacer al respecto; además del sobre (envelope) de respuesta, X-Request-ID y las reglas de details.
---

Cada fallo devuelto por un backend de Rebase utiliza un mismo sobre (envelope) y contiene un `code` estable. El código es el elemento sobre el que condicionar la lógica: el mensaje está escrito para personas y su redacción puede cambiar, el estado HTTP se comparte entre una docena de problemas distintos y el código no presenta ninguno de esos inconvenientes.

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

- **`message`** — legible por humanos. Para un `4xx` es el propio mensaje del servidor; para un `5xx` es deliberadamente genérico, ya que el texto subyacente puede exponer un host, un rol o un nombre de columna.
- **`code`** — uno de los valores detallados a continuación. Estable entre versiones menores.
- **`details`** — opcional y nunca garantizado. Consulta las reglas a continuación.
- **`requestId`** — presente siempre que la solicitud haya pasado por el middleware de request-ID, lo que incluye a todas las rutas bajo `basePath`.

### `X-Request-ID`

Cada solicitud bajo `basePath` recibe un ID: el encabezado `X-Request-ID` del cliente cuando es un UUID v4 válido; de lo contrario, uno nuevo. Se devuelve en la respuesta como `X-Request-ID`, se incluye en el envelope de error como `requestId` y se adjunta a la línea de log del servidor correspondiente a esa solicitud.

Esa es la clave de correlación. Cítala en un informe de error y un operador podrá encontrar la línea de log exacta que explica el fallo, con el motivo que nunca se mostró al cliente.

Enviar el tuyo propio permite que la traza sobreviva a un salto: un gateway o un ejecutor de tareas (job runner) que reenvíe el encabezado mantiene un único ID en todos los servicios que procesaron la solicitud. Un valor no válido se ignora en lugar de rechazarse (no vale la pena hacer fallar una solicitud por un encabezado mal formado enviado por el cliente), por lo que no debes asumir que el ID que enviaste es el ID que recibiste. Lee el encabezado de la respuesta.

### Qué hay en `details`

`details` tiene fines de diagnóstico, no contractuales. Se rige por tres reglas:

1. **Todo lo que una ruta defina explícitamente se devuelve siempre.** Estos son los errores propios del emisor descritos con precisión: qué campo de filtro era desconocido, qué relación no es de escritura, qué valor no correspondía con su tipo.
2. **Los diagnósticos de la base de datos se recortan en producción.** Cuando el fallo proviene de Postgres, `details.dbCode` (el SQLSTATE) siempre está presente: nombra la clase del problema y no revela nada sobre los datos. `dbMessage`, `detail` e `hint` solo se añaden cuando `NODE_ENV` no es `production`, ya que Postgres incluye el contenido de las filas en ellos. `23505` informa `Key (email)=(a@b.c) already exists.`, lo que respondería a "¿está registrada esta persona?" para cualquier dirección que alguien decida probar.
3. **Nunca condiciones la lógica según `details`.** Hazlo según `code`. Lo que está bajo `details` es lo que resultaba útil para una persona en ese punto de la llamada, y está sujeto a cambios.

## Interpretación de los estados

| Estado | Qué indica sobre la solicitud |
| --- | --- |
| `400` | Malformada, o solicita algo que no existe en el esquema. Corrige la solicitud. |
| `401` | No autenticado, o la credencial ha expirado. Inicia sesión o renueva el token. |
| `403` | Autenticado, pero no autorizado. Reintentar con la misma identidad no servirá. |
| `404` | No existe dicha ruta, colección o fila — o se trata de una fila oculta por la seguridad a nivel de fila (RLS). |
| `409` | Un conflicto con el estado existente: un duplicado o una escritura concurrente. |
| `413` `415` `422` | El cuerpo es demasiado grande, el tipo de medio es incorrecto o fue rechazado semánticamente. |
| `429` | Límite de tasa excedido (Rate limited). Espera; el mensaje indica durante cuánto tiempo. |
| `500` | El fallo está en el servidor o su base de datos, no en el emisor. Revisa los registros. |
| `501` | La ruta existe, pero este despliegue no puede atenderla: una funcionalidad desactivada o no configurada. |
| `502` `503` `504` | Una dependencia no estaba accesible, no estaba configurada o tardó demasiado en responder. |

## Autenticación y cuentas

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | La ruta requiere un segundo factor y la sesión solo dispone de uno. | Completa el desafío MFA y reintenta. |
| `ALREADY_VERIFIED` | 400 | La dirección o el factor ya están verificados. | Nada: el estado deseado ya se cumple. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | El inicio de sesión anónimo está desactivado en este servidor. | Habilítalo o inicia sesión con una identidad real. |
| `API_KEY_FORBIDDEN` | 403 | Se utilizó una clave de API en una ruta que solo pueden invocar personas. | Utiliza una sesión de usuario. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Una clave de API intentó crear, listar o revocar claves de API. | Gestiona las claves iniciando sesión como administrador. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Se ejecutó una ruta protegida sin un middleware de autenticación de Rebase previo, por lo que nunca se evaluó la credencial del cliente. | Monta la aplicación a través del router de funciones en lugar de hacerlo directamente sobre tu propio servidor. |
| `BOOTSTRAP_ANONYMOUS` | 403 | Un emisor anónimo intentó realizar el bootstrap del primer administrador. | Inicia sesión primero. |
| `BOOTSTRAP_COMPLETED` | 403 | El primer administrador ya existe. | Pide a un administrador existente que conceda el rol. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | El bootstrap es solo para el primer usuario absoluto, y este no lo es. | Pide a un administrador existente que conceda el rol. |
| `CAPTCHA_FAILED` | 400 | El proveedor rechazó el token de CAPTCHA. | Resuelve un nuevo desafío. |
| `CAPTCHA_REQUIRED` | 400 | La ruta requiere un token de CAPTCHA y no se envió ninguno. | Incluye el token. |
| `CHALLENGE_EXHAUSTED` | 401 | Demasiados códigos incorrectos para un mismo desafío MFA. | Inicia un nuevo desafío. |
| `EMAIL_EXISTS` | 409 | Ya existe una cuenta con esa dirección de correo. | Inicia sesión o solicita un restablecimiento de contraseña. |
| `EMAIL_NOT_CONFIGURED` | 503 | Se solicitaron magic links u OTP y el servidor no tiene configurado el transporte de correo. | Configura SMTP o utiliza otro método de inicio de sesión. |
| `EMAIL_NOT_VERIFIED` | 403 | La cuenta existe pero su dirección no está verificada. | Verifica la dirección. |
| `FACTOR_NOT_VERIFIED` | 400 | El factor MFA fue registrado pero nunca confirmado. | Confirma el factor. |
| `IDENTITY_ALREADY_LINKED` | 409 | Esa identidad OAuth pertenece a otra cuenta. | Inicia sesión con ella o desvincúlala de la otra cuenta primero. |
| `INVALID_ACCOUNT` | 400 | La cuenta se encuentra en un estado sobre el cual esta operación no puede actuar. | Consulta el mensaje. |
| `INVALID_CHALLENGE` | 400 | El desafío MFA es desconocido o ha expirado. | Inicia uno nuevo. |
| `INVALID_CODE` | 401 | El código OTP o MFA es incorrecto. | Reintenta con el código actual. |
| `INVALID_CREDENTIALS` | 401 | Correo electrónico o contraseña incorrectos — deliberadamente no se especifica cuál. | Reintenta o restablece la contraseña. |
| `INVALID_TOKEN` | 400 | Un token de verificación, restablecimiento o magic-link está malformado o es desconocido. | Solicita un enlace nuevo. |
| `LAST_ADMIN` | 403 | El cambio dejaría al proyecto sin administradores. | Promociona a otro usuario primero. |
| `MFA_REQUIRED` | 401 | La contraseña fue correcta y la cuenta tiene un segundo factor verificado, por lo que el inicio de sesión está incompleto. `details` contiene un token de corta duración asignado al desafío MFA — no es una sesión. | Abre un desafío y respóndelo; la respuesta al desafío emitirá la sesión. |
| `NO_SESSION` | 401 | No se presentó ninguna cookie de sesión ni refresh token. Comportamiento normal en la carga inicial de una página. | Inicia sesión. |
| `NOT_ANONYMOUS` | 400 | Una cuenta real intentó invocar una ruta de actualización desde anónimo (upgrade-from-anonymous). | No hay nada que actualizar. |
| `OAUTH_ERROR` | 401 | El proveedor de OAuth rechazó la solicitud o devolvió un error. | Reintenta el flujo; el mensaje contiene el motivo devuelto por el proveedor. |
| `RATE_LIMITED` | 429 | Demasiados intentos desde este origen. | Espera; el mensaje indica durante cuánto tiempo. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | El destino de redirección no está en la lista de permitidos. | Agrégalo a la configuración del proveedor. |
| `REGISTRATION_DISABLED` | 403 | El autoregistro está desactivado. | Solicita a un administrador que cree la cuenta. |
| `ROLE_EXISTS` | 409 | Ese nombre de rol ya está en uso. | Elige otro nombre. |
| `ROLE_LOOKUP_FAILED` | 503 | No se pudieron leer los roles para una solicitud restringida a administradores. Falla de forma restrictiva (fail-closed) en lugar de confiar en el propio claim del token. | Reintenta; comprueba la base de datos. |
| `SELF_DELETE` | 400 | Un administrador intentó eliminar su propia cuenta. | Solicita a otro administrador que lo haga. |
| `SESSION_REVOKED` | 401 | La sesión se cerró en otro lugar o se revocaron todas las sesiones. | Inicia sesión nuevamente. |
| `SETUP_REQUIRED` | 403 | El proyecto aún no tiene ningún administrador, por lo que esta ruta no está disponible. | Completa la configuración inicial del primer administrador. |
| `TOKEN_ALREADY_USED` | 401 | Se reutilizó un token de un solo uso. | Solicita uno nuevo. |
| `TOKEN_EXPIRED` | 401 | El token ha superado su tiempo de vida útil. | Solicita uno nuevo. |
| `USER_NOT_FOUND` | 404 | No existe ninguna cuenta con ese id. | Comprueba el id. |
| `WEAK_PASSWORD` | 400 | La contraseña no cumple con la política configurada. | Elige una más robusta. |

## Datos, consultas y escrituras

<span class="since-badge" data-since="0.20">Since 0.20</span>

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Este driver no puede calcular la agregación solicitada. | Usa un driver compatible o calcúlala en el cliente. |
| `BRANCHING_UNSUPPORTED` | — | Se solicitó una rama de la base de datos a través del websocket de Studio en la base de desarrollo gestionada (PGlite), donde una rama *es* el elemento principal y nada quedaría aislado. El rechazo es el mismo que imprime `rebase db branch`. | Apunta `DATABASE_URL` a tu propio Postgres (`rebase dev --docker` inicia uno) y crea la rama allí. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` contiene más operaciones que el límite permitido por lote (1000 por defecto). Un lote equivale a una transacción y retiene sus bloqueos durante toda su duración. | Envíalo en fragmentos más pequeños; el mensaje indica el límite y tu cantidad actual. |
| `BATCH_UNSUPPORTED` | 400 | El driver de este backend no puede escribir entre colecciones de forma atómica, y un bucle de escrituras individuales no sería ni atómico ni de un solo ciclo (round trip). | Envía las escrituras como solicitudes separadas, o como llamadas `/bulk` por colección. |
| `BULK_TOO_LARGE` | 400 | El cuerpo de la operación masiva excede el límite de elementos configurado. | Divide la solicitud. |
| `BULK_UNSUPPORTED` | 400 | Esta colección o driver no admite escrituras masivas. | Escribe las filas de una en una. |
| `CALLBACK_REJECTED` | 400 | Un callback de la colección rechazó la escritura. Un `throw` desde `beforeSave`/`beforeDelete`/`after*` devuelve un 400 con el mensaje propio del autor; un `beforeDelete` que devuelva `false` genera un 403. `details.stage` indica qué callback fue, y `details.path` la colección. | Lee el mensaje: fue escrito por este proyecto, no por Rebase. |
| `CURSOR_WITH_OFFSET` | 400 | Se combinó `?after=` con `?offset=` o `?page=`. Un cursor ya define dónde comienza la página, por lo que aplicar un desplazamiento (offset) sobre él omite silenciosamente esa cantidad de filas tras el cursor, dejando un vacío imperceptible para el emisor en la respuesta. | Usa uno u otro, pero no ambos. |
| `DISTINCT_NOT_APPLICABLE` | 400 | Se combinó `?distinct=true` con una búsqueda o consulta vectorial. Ambas asignan una puntuación por fila, por lo que nunca habrá dos filas iguales y `DISTINCT` no colapsaría nada: parecería funcionar sin alterar ningún resultado. | Descarta una de las dos opciones. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Una lectura con `distinct` está ordenada por una columna que no devuelve. Un `SELECT DISTINCT` solo puede ordenarse mediante columnas presentes en su lista de selección; de lo contrario, las filas que colapsa carecen de un orden definido. `details.fields` indica cuáles son. | Añade esos campos a `?fields=`, o elimínalos de `?orderBy=`. |
| `DB_PERMISSION_DENIED` | 500 | Postgres denegó la sentencia (`42501`): bien por una política de seguridad a nivel de fila (RLS) que rechaza este rol, o por la falta de un `GRANT`. | Consulta [Troubleshooting](/docs/troubleshooting/). |
| `FIELD_NOT_READABLE` | 400 | Un filtro, `orderBy`, `fields`, agregación en `select` o `groupBy` nombra un campo que los roles de este emisor no pueden leer (`access.read`). Un campo que ninguna respuesta puede incluir debe ser también inaccesible mediante consultas, o de lo contrario el valor podría deducirse predicado por predicado. `details.violations` nombra cada campo. | Elimina el campo de la consulta o adquiere el rol necesario. Consulta [Field access](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 | El cuerpo asigna un campo que los roles de este emisor no pueden escribir (`access.write`). Es rechazado en lugar de descartado: una escritura que ignore un campo reportaría éxito en una edición que nunca ocurrió. `details.violations` nombra cada campo. | Elimina el campo o adquiere el rol necesario. Un campo que nadie tiene permiso de escribir devolverá `VALIDATION_EXCLUDED_FIELDS`. |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Una solicitud anterior con la misma `Idempotency-Key` todavía se está ejecutando. | Reintenta una vez haya finalizado. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | Se recibió la misma `Idempotency-Key` con un cuerpo distinto. | Usa una clave nueva o envía el cuerpo original. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` especificó una función distinta de `count`, `sum`, `avg`, `min` o `max`. | Utiliza una de las indicadas; el mensaje lista las opciones válidas. |
| `INVALID_AGGREGATE_SELECT` | 400 | Una entrada de `?select=` no tiene el formato `fn(field)`, o se omitió el campo en una función distinta de `count()`. | Escribe `sum(total)`, `count()`, `avg(score)`. |
| `INVALID_BATCH_BODY` | 400 | A una operación de `/_batch` le falta `op`, `collection`, `values` o `id`, especifica una colección que este backend no sirve, o reutiliza un nombre de `ref`. | Consulta el mensaje; identifica la operación por su índice. |
| `INVALID_BATCH_REF` | 400 | Un `{ "$ref": "<name>.<field>" }` no apunta a ninguna operación previa, apunta hacia adelante o solicita un campo que la fila referenciada no posee. Solo se resuelven referencias hacia atrás. | Asigna un `ref` a la operación *antes* de hacer referencia a ella. |
| `INVALID_BULK_BODY` | 400 | El cuerpo de la operación masiva no tiene la estructura esperada. | Envía el array `items` según la documentación. |
| `INVALID_CONFLICT_TARGET` | 400 | El parámetro `on_conflict` / `onConflict` de un upsert nombra columnas que no garantizan unicidad, o las nombra sin `upsert: true`. De lo contrario, Postgres devolvería un error 42P10 desde el interior de una transacción que ya ha realizado operaciones. | Declara `validation: { unique: true }` o un índice `unique`; el mensaje lista los destinos válidos existentes. |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` no es ni `include` ni `only`. Se rechaza en lugar de ignorarse: un error tipográfico como `?deleted=true` que ocultara silenciosamente todas las filas eliminadas parecería funcionar pero respondería a la pregunta opuesta. | Envía `include` (activas y eliminadas) u `only` (únicamente eliminadas). Omítelo para obtener solo las filas activas. |
| `INVALID_DISTINCT` | 400 | `?distinct=` no es `true` ni `false`. | Envía uno de esos valores; también se aceptan `1` y `0`. |
| `INVALID_FIELD_OPERATION` | 400 | Se utilizó `$inc` / `$push` / `$pull` / `$merge` en un tipo de propiedad donde no está definido, con un operando con estructura errónea, con dos operadores sobre un mismo campo, mal escrito, o durante una creación (donde no existe un valor almacenado previo sobre el que operar). | Consulta [Writing over REST](/docs/backend/writes/#field-operations); el mensaje especifica el campo. |
| `INVALID_FILTER_FIELD` | 400 | El filtro especifica una propiedad que esta colección no tiene. | Revisa la ortografía cotejándola con la colección. |
| `INVALID_FILTER_OPERATOR` | 400 | El operador no es compatible con este tipo de propiedad. | Consulta [Querying data](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | No se puede interpretar el valor del filtro según el tipo de la columna con la que se compara: `?id=eq.abc` en una clave entera, una etiqueta inexistente en un enum, una marca de tiempo inválida o un número fuera de rango. `details.dbCode` contiene el SQLSTATE. | Envía un valor correspondiente al tipo de la columna. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` no es `true` ni `false`. Cualquier otro valor se rechaza en lugar de interpretarse como "no": un error tipográfico que realice un borrado lógico cuando se solicitó una purga definitiva haría creer al usuario que los datos han desaparecido. | Envía `true` o `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` está malformado: no es una lista de rutas válida o excede la profundidad máxima permitida. Se intercepta en el límite en lugar de permitir que escape del driver como un error 500. | Consulta el mensaje; indica la ruta infractora. |
| `INVALID_INPUT` | 400 | El cuerpo no superó la validación. | Consulta el mensaje. |
| `INVALID_LIMIT` | — | Una suscripción en tiempo real solicitó un límite fuera del rango permitido. Se entrega como un frame `ERROR` de WebSocket, no como una respuesta HTTP. | Reduce el límite. |
| `INVALID_LOGICAL_GROUP` | 400 | Un grupo `?or=` / `?and=` está malformado o anidado más allá de la profundidad permitida. | Consulta el mensaje; muestra la regla de aplanamiento (flattening). |
| `INVALID_OFFSET` | 400 | `?offset=` no es un número entero mayor o igual a 0. | Envía un entero no negativo. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` no tiene el formato `field`, `field:desc`, ni es un array JSON de `{ field, direction }`. | Consulta el mensaje; muestra los tres formatos admitidos. |
| `INVALID_PAGE` | 400 | `?page=` no es un número entero mayor o igual a 1. Las páginas tienen base 1, por lo que `?page=0` se considera un error y no la primera página. | Envía `1` o un número superior, o usa `?offset=`. |
| `INVALID_PARAM` | 400 | Un parámetro de consulta está malformado. | Consulta el mensaje. |
| `INVALID_VECTOR` | 400 | `?vector=` no es un array JSON de números. | Envía `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` no es `cosine`, `l2` ni `inner_product`. | Utiliza uno de esos tres. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` no es un número. | Envía un número. |
| `INVALID_WHERE` | 400 | `?where=` no es un objeto JSON que asocie campos con condiciones. | Envía `{"status":["==","active"]}`. |
| `MISSING_AGGREGATE_SELECT` | 400 | Se invocó la ruta de agregación sin incluir `?select=`. | Añade uno, por ejemplo `?select=count()`. |
| `NO_COLLECTIONS` | 404 | El proyecto no sirve colecciones: no hay ninguna declarada en código ni tablas desde las que derivarlas. | Crea tablas (mediante una migración, SQL o un archivo de colección más `rebase db push`) y reinicia. |
| `NOT_FOUND` | 404 | No se encontró ninguna fila con ese id en la colección — o bien la seguridad a nivel de fila la oculta para este emisor. | Comprueba el id y luego las `securityRules` de la colección. |
| `UNKNOWN_RELATION` | 400 | `?include=` nombra algo que no es una relación en la colección. Este mismo código responde **404** cuando una *ruta de URL* anidada nombra una relación inexistente, por ejemplo `/api/data/authors/1/posts` donde `authors` no la declara; en ese caso la URL no apunta a nada, tratándose de un recurso no encontrado y no de una petición malformada. | Comprueba el nombre de la relación; el mensaje lista las que posee la colección. Para poder recorrer una referencia inversa, esta debe declararse en el elemento padre. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | La ordenación especifica una propiedad que no admite ordenación. | Ordena según una propiedad respaldada por una columna. |
| `PAYLOAD_TOO_LARGE` | 413 | El cuerpo supera el límite configurado. | Envía menos datos o incrementa el límite. |
| `READ_ONLY_TRANSACTION` | 409 | Un callback `afterRead` intentó realizar una escritura. Las lecturas con ámbito de solicitud se ejecutan en una transacción `READ ONLY`, por lo que ni el callback ni nada de lo que invoque puede escribir. | Traslada la escritura fuera de la lectura: usa un trabajo en segundo plano, o `rebase.dataAsAdmin` desde una tarea programada (cron) o una función personalizada. |
| `RELATION_MISCONFIGURED` | 500 | Una relación no se resuelve contra el esquema registrado. La operación se rechaza en lugar de ignorarse: descartarla reportaría éxito en una escritura que nunca se realizó, o un resultado vacío para filas que sí existen. | Ejecuta `rebase schema generate` si el esquema generado es anterior a la base de datos. |
| `RELATION_NOT_UNLINKABLE` | 400 | La relación no se puede desvincular desde este lado. | Realiza la escritura desde el lado propietario. |
| `RELATION_NOT_WRITABLE` | 400 | La ruta anidada no es una relación de escritura. | Consulta [Relations](/docs/collections/relations/). |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Una escritura de relación no disponía de una clave de origen para vincular el enlace. | Guarda la fila principal primero. |
| `SCHEMA_DRIFT` | 500 | Una tabla o columna requerida por el código no existe en la base de datos. | Ejecuta `rebase db push` en desarrollo; vuelve a desplegar en un entorno gestionado. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | Se combinó `startAfter` con `orderBy: "_score"`. La relevancia se calcula por consulta en lugar de almacenarse, por lo que no puede actuar como clave para un cursor. | Pagina la relevancia con `limit`/`offset`, o bien ordena por una columna. |
| `TENANT_IMMUTABLE` | 400 | Una escritura movería una fila de un tenant a otro. Una fila no puede cambiar de tenant. `details.violations` nombra el campo. | Crea la fila en el nuevo tenant y elimina esta, o realiza la escritura con un rol incluido en `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | La escritura especifica un tenant al que este emisor no pertenece; la base de datos también la rechazaría. | Escribe en un tenant al que pertenezca el emisor, o autentícate con una identidad asociada al mismo. |
| `TENANT_REQUIRED` | 400 | La colección tiene ámbito de tenant y este no puede inferirse: la solicitud no incluye ninguno o el emisor pertenece a varios. | Envía el campo del tenant explícitamente, o autentícate con un emisor asociado exactamente a uno. |
| `UNKNOWN_FIELD` | 400 | `?fields=` nombra un campo que la colección no tiene. | Revisa la ortografía; el mensaje lista los campos válidos. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Una agregación o `groupBy` nombra un campo que la colección no tiene. | Revisa la ortografía; el mensaje lista los campos válidos. |
| `UNKNOWN_FILTER_FIELD` | 400 | El filtro nombra un campo que esta colección —o el destino de una relación— no tiene. | Revisa la ortografía; el mensaje lista los campos válidos. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | El filtro nombra un operador inexistente. | El mensaje lista todos los operadores válidos. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | La ordenación especifica un campo que esta colección no tiene. | Revisa la ortografía; el mensaje lista los campos válidos. |
| `PRECONDITION_FAILED` | 412 | Una cabecera `If-Match` especificó una versión de la fila que ya no es la actual: alguien escribió en ella entre la lectura y esta escritura. No se guardó ningún cambio. | Vuelve a leer la fila, vuelve a aplicar el cambio y envía el nuevo `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` solicita un campo que la colección no tiene. | Revisa la ortografía; el mensaje lista los campos conocidos. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Una búsqueda vectorial especificó una propiedad que no es de tipo `vector` en esta colección. | El mensaje lista las propiedades vectoriales de la colección. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | El encabezado `Content-Type` no es aceptado por esta ruta. | Envía el tipo indicado en la documentación de la ruta. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | El filtro cruza una relación `via`, cuya ruta de unión (join) está definida en un solo sentido, por lo que no hay forma de correlacionar una subconsulta de retorno. | Aplica el filtro desde el lado propietario. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | El operador no está definido para ese campo: una relación sin columna en esta fila se filtra por pertenencia, y la coincidencia no sensible a mayúsculas solo aplica a texto. | Consulta el mensaje; lista lo que admite el campo. |
| `VALIDATION_CONSTRAINT` | 400 | Un valor infringió una regla de `validation` declarada por la propiedad: longitud, rango, patrón o campo obligatorio. | Consulta el mensaje; indica cada infracción. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | El cuerpo intenta escribir una columna marcada con `excludeFromApi` o `access: { write: [] }` (dos formas de expresar la misma regla). Su asignación corresponde exclusivamente al servidor: hash de contraseñas, tokens de verificación, etc. A diferencia de `FIELD_NOT_WRITABLE`, esta respuesta es idéntica para cualquier emisor, incluido `admin`. | Elimina el campo. Consulta [Field access](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Un valor no coincide con el tipo de su propiedad. | Consulta el mensaje; nombra la propiedad. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | El cuerpo especifica un campo que la colección no tiene — incluyendo un argumento `id` en una colección indexada por otra clave. | Revisa la ortografía; el mensaje lista los campos conocidos. |
| `WRITE_DENIED` | 403 | Una regla de seguridad o política de RLS denegó la escritura. | Comprueba las `securityRules` de la colección. |

## `PG_<SQLSTATE>` — una restricción rechazada por la base de datos

Una escritura que Postgres rechace por motivos relativos a los *datos del emisor* responde con el SQLSTATE incorporado en el código: `PG_23505`, `PG_23503`, etc. Se trata de una familia, no de una lista estática (Postgres define cientos de SQLSTATEs), pero solo dos clases la alcanzan, ya que solo esas dos son responsabilidad del emisor:

- **clase 23**, infracción de restricción de integridad: un duplicado, una clave foránea que apunta a la nada, una columna NOT NULL que se dejó vacía;
- **clase 22**, excepción de datos: un valor incompatible con el tipo de la columna.

Cualquier otra causa —una conexión caída, una columna inexistente, un problema de privilegios— es responsabilidad del servidor y permanece como un error `500`. Por lo tanto, comprobar `code.startsWith("PG_")` es un método seguro para verificar si "la fila que envié era incorrecta", y las cuatro siguientes son las que un cliente encontrará en la práctica. `details.dbCode` contiene el mismo SQLSTATE en todas ellas y el mensaje identifica la restricción afectada.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | No se pudo interpretar un valor según el tipo de la columna (el equivalente en escritura a `INVALID_FILTER_VALUE`). | Envía un valor correspondiente al tipo de la columna. |
| `PG_23502` | 400 | Una columna `NOT NULL` se dejó vacía. | Envía el campo o asigna un valor predeterminado a la columna. |
| `PG_23503` | 400 | Una clave foránea apunta a una fila que no existe. | Crea la fila de destino primero o corrige el id. |
| `PG_23505` | 409 | Se infringió una restricción de unicidad. El mensaje nombra la restricción. | Usa un valor diferente o actualiza la fila existente. |

## Almacenamiento

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `INVALID_STORAGE_BUCKET` | 400 | El nombre del bucket está malformado. | Comprueba el nombre. |
| `INVALID_STORAGE_KEY` | 400 | La clave del objeto está malformada o escapa a su prefijo. | Comprueba la clave. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | Los parámetros de transformación de imagen están fuera de rango o son contradictorios. | Consulta [Storage](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | La carga supera el `maxSize` declarado por la propiedad de destino. Se valida en el servidor, no solo en el navegador. `details` contiene la propiedad, el límite y el tamaño real. | Sube un archivo más pequeño o aumenta el `maxSize` en la propiedad. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | El tipo del archivo no está incluido en los `acceptedFiles` de la propiedad. `details` contiene la propiedad, la lista admitida y el content-type enviado. | Sube un tipo permitido o amplía `acceptedFiles`. |
| `STORAGE_NOT_CONFIGURED` | 503 | No hay ningún backend de almacenamiento configurado en este servidor. | Configura S3, GCS o almacenamiento local. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | El origen de almacenamiento está declarado pero carece de credenciales en este entorno. | Define las variables de entorno para ese origen. |
| `STORAGE_WRITE_FAILED` | 502 | El backend de almacenamiento rechazó o interrumpió la escritura. | Comprueba sus propios registros y credenciales. |
| `TRANSFORM_OVERLOADED` | 503 | Hay demasiadas transformaciones de imagen ejecutándose simultáneamente. | Reintenta; considera colocar una CDN por delante. |
| `UNKNOWN_STORAGE_SOURCE` | 400 | La solicitud especificó un origen de almacenamiento (`?storageId=`) no declarado en este proyecto. Un `bucket` que este despliegue no sirve devuelve este mismo código con estado **404** (lo que falta es el almacén, y `details` lista los buckets y orígenes que sí existen). Ambos solían responder antes con "file not found", idéntico a una clave simplemente inexistente. | Declara el origen en `config/resources.ts` o consulta `GET /api/storage/sources`. |

## Funciones personalizadas

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | No se sirve ninguna función con ese nombre — o bien existe, pero sus propias rutas no cubren la ruta posterior. A un emisor autenticado se le informa también de lo que *sí* se sirve; a uno anónimo no, ya que esa lista representa un inventario de cada endpoint personalizado. Si un archivo con ese nombre no pudo cargarse, el mensaje lo indica: esa es la diferencia entre un error tipográfico y un despliegue defectuoso. | Comprueba el nombre contra `GET /api/functions` o revisa los registros de inicio en busca de archivos no cargados. |
| `FUNCTION_TIMEOUT` | 504 | El controlador (handler) superó su tiempo límite de espera. Continúa ejecutándose; no puede cancelarse desde aquí. | Proporciona un `AbortSignal` a las llamadas salientes o incrementa `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Este proceso actúa como proxy de funciones hacia otro que no respondió. | Comprueba que la unidad de funciones esté en ejecución. |

## Superficies de administración y edición de esquemas

Estos códigos indican que una funcionalidad está desactivada o sin configurar, no que la solicitud haya sido errónea. Cada uno de ellos se reporta también en su ruta `/status` correspondiente con un código `200`, lo que permite que un panel deshabilite visualmente la funcionalidad en lugar de mostrar un error.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | Se invocó una superficie exclusiva para administradores en un servidor sin autenticación configurada, por lo que no es posible distinguir a un administrador de un desconocido. | Configura `auth.jwtSecret` o pasa un `AuthAdapter`. |
| `CONTRACT_UNAVAILABLE` | 404 | El contrato del proyecto solo se sirve cuando la autenticación está configurada; describe cada tabla y relación. | Configura la autenticación. `/meta/schema-version` siempre se sirve. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | No hay un buzón de desarrollo activo. Los correos solo se capturan si `SMTP_HOST` no está definido y `NODE_ENV` no es production. | Elimina la variable `SMTP_HOST` en desarrollo o consulta la bandeja de entrada real. |
| `INVALID_CHANGE` | 400 | La modificación de esquema propuesta no está bien formada. | Consulta el mensaje. |
| `SCHEMA_CHANGE_FAILED` | 400 | La aplicación de un cambio de esquema planificado falló por un motivo que los códigos más específicos no cubren. | Consulta el mensaje: refleja textualmente el fallo subyacente. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | El cambio es válido pero no puede aplicarse al esquema en su estado actual. | Consulta el mensaje. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | El repositorio contiene cambios sin confirmar (uncommitted), por lo que la edición no pudo aplicarse con seguridad. | Haz commit o stash y vuelve a intentarlo. |
| `SCHEMA_EDIT_REFUSED` | 400 | El editor de esquemas rechazó la modificación. | Consulta el mensaje; corresponde al rechazo emitido por el propio editor. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Una clave de API u otra entidad automatizada intentó aplicar un cambio de esquema. | Inicia sesión como usuario o define `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | La edición de esquemas en caliente requiere `collectionsDir` o `liveSchema.repository`, y este servidor se inició sin ninguno de ellos. | Configura uno. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | La planificación funciona, pero no existe un repositorio en el que confirmar el cambio. | Configura `liveSchema.repository`. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Este driver no puede planificar cambios de esquema. | La edición en caliente está disponible en Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | En este entorno las colecciones se introspeccionan desde la base de datos, por lo que no hay archivos de origen que editar. | Modifica el esquema mediante una migración. |
| `SCHEMA_EDITOR_DISABLED` | 501 | El editor de esquemas está desactivado para este servidor. | Actívalo mediante `schemaEditor`. |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | El editor de esquemas requiere `ts-morph`, el cual no está instalado. | `pnpm add -D ts-morph@28.0.0`. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | El servidor no tiene `collectionsDir`, por lo que el editor no tiene dónde escribir. | Define `collectionsDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | El editor está desactivado bajo `NODE_ENV=production`: los archivos de un servidor desplegado se reconstruyen desde tu repositorio en cada despliegue, por lo que cualquier edición realizada aquí se perdería. | Edita las colecciones en desarrollo y despliega. |

## Códigos genéricos

Una ruta utiliza uno de estos cuando no aplica ningún código más específico.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Malformada, y no aplica nada más específico. | Consulta el mensaje. |
| `UNAUTHORIZED` | 401 | No autenticado, o la credencial fue rechazada. | Inicia sesión o renueva el token. |
| `FORBIDDEN` | 403 | Autenticado, pero sin permisos suficientes. | Reintentar con la misma identidad no servirá. |
| `CONFLICT` | 409 | Conflicto con el estado existente. | Consulta el mensaje. |
| `INTERNAL_ERROR` | 500 | Algo falló en el servidor. El mensaje es intencionadamente genérico. | Cita el `requestId`; la causa detallada se encuentra en los registros. |
| `NOT_CONFIGURED` | 503 | Una dependencia requerida por esta ruta no está configurada en este servidor. | Consulta el mensaje. |
| `SERVICE_UNAVAILABLE` | 503 | Una dependencia no estaba accesible. | Reintenta; revisa los registros. |

## Mantener la exactitud de esta página

`pnpm verify:docs` falla si algún código que el servidor pueda emitir falta en estas tablas, si una tabla lista un código que nada puede generar, si un estado indicado discrepa del código fuente, o si una familia de códigos como `PG_<SQLSTATE>` carece de fila para un SQLSTATE que los clientes puedan recibir. El paso del proceso se encuentra en `tooling/scripts/docs-verify/check-error-codes.mjs`.

Este script se valida a sí mismo primero. El análisis extrae los códigos a partir de TypeScript y no de un servidor en ejecución, por lo que sus puntos ciegos son silenciosos por diseño: en el pasado no fue capaz de detectar un código pasado a través de una función envoltorio de una sola línea, o uno escrito tras un mensaje que contenía un `)`, reportando erróneamente que "todos los códigos que el servidor puede emitir están documentados" en una página en la que faltaban diecisiete de ellos. Por ello, el script ejecuta una prueba con esas estructuras exactas antes de leer esta página y rechaza emitir informe alguno si no es capaz de detectarlas.

---
