---
sourceHash: 98630809329b42c5
title: Códigos de error
sidebar_label: Códigos de error
description: Todos los códigos de error que un backend de Rebase puede devolver, con su estado HTTP, qué significan y qué hacer al respecto; además del envelope de respuesta, X-Request-ID y las reglas de details.
---

Cada fallo que devuelve un backend de Rebase utiliza un único envelope y contiene
un `code` estable. El código es el elemento sobre el que bifurcar la lógica: el
mensaje está escrito para personas y puede reformularse, el estado se comparte
entre una docena de problemas diferentes y el código no sufre ninguno de esos dos
casos.

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

- **`message`** — legible para humanos. Para un `4xx` es el propio mensaje del
  servidor; para un `5xx` es deliberadamente genérico, ya que el texto subyacente
  puede citar un host, un rol o un nombre de columna.
- **`code`** — uno de los valores a continuación. Estable entre versiones menores.
- **`details`** — opcional y nunca garantizado. Consulta las reglas a continuación.
- **`requestId`** — presente siempre que la solicitud haya pasado por el
  middleware de request-ID, que incluye cada ruta bajo `basePath`.

### `X-Request-ID`

Cada solicitud bajo `basePath` obtiene un ID: la cabecera `X-Request-ID` del
cliente cuando es un UUID v4 válido; de lo contrario, uno nuevo. Se devuelve en
la respuesta como `X-Request-ID`, se incluye en el envelope de error como
`requestId` y se adjunta a la línea de log del servidor para esa solicitud.

Esa es la clave de unión. Inclúyela en un reporte de error y un operador podrá
encontrar la línea de log exacta que explica el fallo, con la razón que nunca se
mostró al cliente.

Enviar el tuyo propio es la forma en que una traza sobrevive a un salto: una
pasarela (gateway) o un ejecutor de tareas (job runner) que reenvía la cabecera
obtiene un único ID a través de cada servicio que gestionó la solicitud. Un valor
inválido se ignora en lugar de ser rechazado —no vale la pena hacer fallar una
solicitud por una cabecera malformada del cliente—, así que no asumas que el ID
que enviaste es el ID que obtuviste. Lee la cabecera de respuesta.

### Qué hay en `details`

`details` es de diagnóstico, no contractual. Tres reglas lo rigen:

1. **Todo lo que una ruta establece explícitamente se devuelve siempre.** Estos
   son los propios errores del cliente descritos con precisión: qué campo de
   filtro era desconocido, qué relación no es escribible, qué valor no coincidía
   con su tipo.
2. **Los diagnósticos de la base de datos se recortan en producción.** Cuando el
   fallo proviene de Postgres, `details.dbCode` —el SQLSTATE— está siempre
   presente: nombra la clase del problema y no revela nada sobre los datos.
   `dbMessage`, `detail` y `hint` solo se añaden cuando `NODE_ENV` no es
   `production`, ya que Postgres incluye el contenido de las filas en ellos.
   `23505` reporta `Key (email)=(a@b.c) already exists.`, lo que respondería a
   "¿está registrada esta persona?" para cualquier dirección que alguien decida
   probar.
3. **Nunca bifurques la lógica basándote en `details`.** Hazlo según `code`. Lo
   que está bajo `details` es lo que resultaba útil para una persona en ese punto
   de llamada, y puede cambiar.

## Interpretar un estado

| Estado | Lo que indica sobre la solicitud |
| --- | --- |
| `400` | Malformada, o solicitando algo que no existe en el esquema. Corrige la solicitud. |
| `401` | No autenticado, o la credencial ha expirado. Inicia sesión o refresca el token. |
| `403` | Autenticado, pero no autorizado. Reintentar con la misma identidad no servirá. |
| `404` | No existe tal ruta, colección o fila —o es una fila que la seguridad a nivel de fila oculta. |
| `409` | Un conflicto con el estado existente: un duplicado o una escritura concurrente. |
| `413` `415` `422` | El cuerpo es demasiado grande, el tipo de medio es incorrecto o fue rechazado semánticamente. |
| `429` | Límite de tasa alcanzado. Reduce la frecuencia de peticiones; el mensaje indica durante cuánto tiempo. |
| `500` | El problema está en el servidor o su base de datos, no en el cliente. Revisa los logs. |
| `501` | La ruta existe, pero este despliegue no puede atenderla: una funcionalidad desactivada o sin configurar. |
| `502` `503` `504` | Una dependencia fue inaccesible, no está configurada o fue demasiado lenta. |

## Autenticación y cuentas

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | La ruta necesita un segundo factor y la sesión solo tiene uno. | Completa el desafío MFA y vuelve a intentarlo. |
| `ALREADY_VERIFIED` | 400 | La dirección o el factor ya están verificados. | Nada: el estado deseado ya se cumple. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | El inicio de sesión anónimo está desactivado en este servidor. | Habilítalo o inicia sesión con una identidad real. |
| `API_KEY_FORBIDDEN` | 403 | Se utilizó una clave de API en una ruta a la que solo pueden llamar personas. | Utiliza una sesión de usuario. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Una clave de API intentó crear, listar o revocar claves de API. | Gestiona las claves como un administrador autenticado. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Se ejecutó una ruta protegida sin ningún middleware de autenticación de Rebase previo, por lo que nunca se evaluó la credencial del cliente. | Monta la app a través del router de funciones en lugar de directamente sobre tu propio servidor. |
| `BOOTSTRAP_ANONYMOUS` | 403 | Un cliente anónimo intentó el bootstrap del primer administrador. | Inicia sesión primero. |
| `BOOTSTRAP_COMPLETED` | 403 | El primer administrador ya existe. | Haz que un administrador existente otorgue el rol. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | El bootstrap es solo para el primer usuario absoluto, y este no lo es. | Haz que un administrador existente otorgue el rol. |
| `CAPTCHA_FAILED` | 400 | El proveedor rechazó el token CAPTCHA. | Resuelve un nuevo desafío. |
| `CAPTCHA_REQUIRED` | 400 | La ruta requiere un token CAPTCHA y no se envió ninguno. | Incluye el token. |
| `CHALLENGE_EXHAUSTED` | 401 | Demasiados códigos incorrectos para un mismo desafío MFA. | Inicia un nuevo desafío. |
| `EMAIL_EXISTS` | 409 | Ya existe una cuenta con esa dirección. | Inicia sesión o inicia un restablecimiento de contraseña. |
| `EMAIL_NOT_CONFIGURED` | 503 | Se solicitaron enlaces mágicos u OTP y el servidor no tiene transporte de correo. | Configura SMTP o usa otro método de inicio de sesión. |
| `EMAIL_NOT_VERIFIED` | 403 | La cuenta existe y su dirección no está verificada. | Verifica la dirección. |
| `FACTOR_NOT_VERIFIED` | 400 | El factor MFA fue registrado pero nunca confirmado. | Confirma el factor. |
| `IDENTITY_ALREADY_LINKED` | 409 | Esa identidad OAuth pertenece a otra cuenta. | Inicia sesión con ella o desvincúlala allí primero. |
| `INVALID_ACCOUNT` | 400 | La cuenta se encuentra en un estado sobre el que esta operación no puede actuar. | Consulta el mensaje. |
| `INVALID_CHALLENGE` | 400 | El desafío MFA es desconocido o ha expirado. | Inicia uno nuevo. |
| `INVALID_CODE` | 401 | El código OTP o MFA es incorrecto. | Reintenta con el código actual. |
| `INVALID_CREDENTIALS` | 401 | Correo electrónico o contraseña incorrectos (deliberadamente no se especifica cuál). | Reintenta o restablece la contraseña. |
| `INVALID_TOKEN` | 400 | Un token de verificación, restablecimiento o enlace mágico está malformado o es desconocido. | Solicita un enlace nuevo. |
| `LAST_ADMIN` | 403 | El cambio dejaría al proyecto sin administradores. | Promociona a otra persona primero. |
| `MFA_REQUIRED` | 401 | La contraseña era correcta y la cuenta tiene un segundo factor verificado, por lo que el inicio de sesión está a medio completar. `details` contiene un token de corta duración con ámbito para el desafío MFA; no es una sesión. | Inicia un desafío y respóndelo; la respuesta al desafío emite la sesión. |
| `NO_SESSION` | 401 | No se presentó ninguna cookie de sesión ni refresh token. Normal en la primera carga de una página. | Inicia sesión. |
| `NOT_ANONYMOUS` | 400 | Se llamó a una ruta de actualización desde anónimo con una cuenta real. | Nada que actualizar. |
| `OAUTH_ERROR` | 401 | El proveedor de OAuth lo rechazó o devolvió un error. | Reintenta el flujo; el mensaje contiene el motivo del proveedor. |
| `RATE_LIMITED` | 429 | Demasiados intentos desde este cliente. | Reduce la frecuencia de peticiones; el mensaje indica durante cuánto tiempo. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | El destino de redirección no está en la lista de permitidos. | Añádelo a la configuración del proveedor. |
| `REGISTRATION_DISABLED` | 403 | El registro de autoservicio está desactivado. | Haz que un administrador cree la cuenta. |
| `ROLE_EXISTS` | 409 | Ese nombre de rol ya está en uso. | Elige otro nombre. |
| `ROLE_LOOKUP_FAILED` | 503 | No se pudieron leer los roles para una solicitud restringida a administradores. Falla de forma cerrada en lugar de confiar en el claim del propio token. | Reintenta; comprueba la base de datos. |
| `SELF_DELETE` | 400 | Un administrador intentó eliminar su propia cuenta. | Haz que lo haga otro administrador. |
| `SESSION_REVOKED` | 401 | Se cerró la sesión en otro lugar, o se revocaron todas las sesiones. | Inicia sesión de nuevo. |
| `SETUP_REQUIRED` | 403 | El proyecto aún no tiene administrador, por lo que esta ruta no está disponible. | Completa la configuración del primer administrador. |
| `TOKEN_ALREADY_USED` | 401 | Se reutilizó un token de un solo uso. | Solicita uno nuevo. |
| `TOKEN_EXPIRED` | 401 | El token ha superado su tiempo de vida. | Solicita uno nuevo. |
| `USER_NOT_FOUND` | 404 | No hay cuenta con ese id. | Verifica el id. |
| `WEAK_PASSWORD` | 400 | La contraseña no cumple con la política configurada. | Elige una más robusta. |

## Datos, consultas y escrituras

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Este driver no puede calcular el agregado solicitado. | Usa un driver que pueda, o calcúlalo en el cliente. |
| `BRANCHING_UNSUPPORTED` | — | Se solicitó una rama de la base de datos mediante el websocket de Studio en la base de datos de desarrollo administrada (PGlite), donde una rama *es* la principal y nada quedaría aislado. El rechazo es el mismo que imprime `rebase db branch`. | Apunta `DATABASE_URL` a tu propio Postgres (`rebase dev --docker` inicia uno) y crea la rama allí. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` contiene más operaciones que el límite por lote (1000 por defecto). Un lote es una sola transacción y mantiene sus bloqueos durante toda ella. | Envíalo en fragmentos; el mensaje indica el límite y tu recuento. |
| `BATCH_UNSUPPORTED` | 400 | El driver de este backend no puede escribir en múltiples colecciones de forma atómica, y un bucle de escrituras individuales no sería atómico ni de un solo viaje de ida y vuelta. | Envía las escrituras como solicitudes separadas, o como llamadas `/bulk` por colección. |
| `BULK_TOO_LARGE` | 400 | El cuerpo de la operación masiva excede el límite configurado de elementos. | Divide la solicitud. |
| `BULK_UNSUPPORTED` | 400 | Esta colección o driver no admite escrituras masivas. | Escribe las filas una por una. |
| `CALLBACK_REJECTED` | 400 | Un callback de colección rechazó la escritura. Un `throw` desde `beforeSave`/`beforeDelete`/`after*` es un 400 que contiene el propio mensaje del autor; un `beforeDelete` que devuelve `false` es un 403. `details.stage` indica qué callback, `details.path` la colección. | Lee el mensaje: fue redactado por este proyecto, no por Rebase. |
| `CURSOR_WITH_OFFSET` | 400 | Se combinó `?after=` con `?offset=` o `?page=`. Un cursor ya indica dónde comienza la página, por lo que un desplazamiento sobre él omite silenciosamente esa cantidad de filas después del cursor —una brecha que el cliente no puede ver en la respuesta. | Usa uno u otro. |
| `DISTINCT_NOT_APPLICABLE` | 400 | Se combinó `?distinct=true` con una consulta de búsqueda o vectorial. Ambas adjuntan una puntuación por fila, por lo que nunca habrá dos filas iguales y `DISTINCT` no colapsaría nada; parecería haber funcionado sin cambiar nada. | Descarta uno de los dos. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Una lectura con `distinct` está ordenada por una columna que no devuelve. Un `SELECT DISTINCT` solo puede ordenarse por columnas en su lista de selección, o las filas que colapsa no tendrían un orden definido. `details.fields` los enumera. | Añade esos campos a `?fields=`, o elimínalos de `?orderBy=`. |
| `DB_PERMISSION_DENIED` | 500 | Postgres rechazó la sentencia (`42501`): una política de seguridad a nivel de fila que deniega este rol, o un `GRANT` faltante. | Consulta [Troubleshooting](/docs/troubleshooting/). |
| `FIELD_NOT_READABLE` | 400 | Un filtro, `orderBy`, `fields`, `select` de agregado o `groupBy` nombra un campo que los roles de este cliente no pueden leer (`access.read`). Un campo que ninguna respuesta puede contener debe ser uno que ninguna consulta pueda interrogar, o el valor sería legible predicado a predicado. `details.violations` nombra cada campo. | Elimina el campo de la consulta o adquiere el rol. Consulta [Field access](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 | El cuerpo establece un campo que los roles de este cliente no pueden escribir (`access.write`). Rechazado en lugar de descartado: una escritura que descarta un campo reportaría éxito para una edición que no ocurrió. `details.violations` nombra cada campo. | Elimina el campo o adquiere el rol. Un campo que nadie puede escribir responde con `VALIDATION_EXCLUDED_FIELDS` en su lugar. |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Una solicitud anterior con la misma `Idempotency-Key` todavía se está ejecutando. | Reintenta una vez que termine. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | Llegó la misma `Idempotency-Key` con un cuerpo diferente. | Usa una nueva clave o envía el cuerpo original. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` especificó una función que no es `count`, `sum`, `avg`, `min` ni `max`. | Usa una de ellas; el mensaje las enumera. |
| `INVALID_AGGREGATE_SELECT` | 400 | Una entrada de `?select=` no es `fn(field)`, o se proporcionó una función distinta de `count()` sin campo. | Escribe `sum(total)`, `count()`, `avg(score)`. |
| `INVALID_BATCH_BODY` | 400 | A una operación de `/_batch` le falta `op`, `collection`, `values` o `id`, nombra una colección que este backend no sirve, o reutiliza un nombre de `ref`. | Consulta el mensaje; identifica la operación por su índice. |
| `INVALID_BATCH_REF` | 400 | Un `{ "$ref": "<name>.<field>" }` no nombra ninguna operación anterior, apunta hacia adelante o solicita un campo que la fila referenciada no tiene. Solo se resuelven referencias hacia atrás. | Asigna el nombre a la operación con `ref` *antes* de referenciarla. |
| `INVALID_BULK_BODY` | 400 | El cuerpo masivo no tiene la estructura esperada. | Envía el array `items` documentado. |
| `INVALID_CONFLICT_TARGET` | 400 | El `on_conflict` / `onConflict` de un upsert nombra columnas sin garantía de unicidad, o las nombra sin `upsert: true`. De lo contrario, Postgres respondería 42P10 desde el interior de una transacción que ya ha realizado trabajo. | Declara `validation: { unique: true }` o un índice `unique`; el mensaje lista los destinos que sí existen. |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` no es `include` ni `only`. Rechazado en lugar de ignorado: un `?deleted=true` mal escrito que ocultara silenciosamente todas las filas eliminadas parecería funcionar y respondería la pregunta opuesta. | Envía `include` (activas y eliminadas) o `only` (solo eliminadas). Omítelo solo para filas activas. |
| `INVALID_DISTINCT` | 400 | `?distinct=` no es `true` ni `false`. | Envía uno de esos valores; también se aceptan `1` y `0`. |
| `INVALID_FIELD_OPERATION` | 400 | Se usó un `$inc` / `$push` / `$pull` / `$merge` en un tipo de propiedad en el que no está definido, con un operando con formato erróneo, con dos operadores en un mismo campo, mal escrito, o en una creación, donde no hay un valor almacenado sobre el cual operar. | Consulta [Writing over REST](/docs/backend/writes/#field-operations); el mensaje nombra el campo. |
| `INVALID_FILTER_FIELD` | 400 | El filtro nombra una propiedad que esta colección no tiene. | Comprueba la ortografía en la colección. |
| `INVALID_FILTER_OPERATOR` | 400 | El operador no es compatible con este tipo de propiedad. | Consulta [Querying data](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | Un valor de filtro no se puede leer como el tipo de la columna contra la que se comparó: `?id=eq.abc` en una clave entera, una etiqueta que no está en el enum, una marca de tiempo inválida, un número fuera del rango del tipo. `details.dbCode` contiene el SQLSTATE. | Envía un valor del tipo de la columna. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` no es `true` ni `false`. Cualquier otra cosa se rechaza en lugar de interpretarse como "no": un error tipográfico que elimine de forma lógica cuando el cliente pidió purgar le haría creer erróneamente que los datos desaparecieron. | Envía `true` o `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` está malformado: no es una lista de rutas válida o está anidado más allá de la profundidad máxima. Se responde en la frontera en lugar de escapar del driver como un 500. | Consulta el mensaje; nombra la ruta problemática. |
| `INVALID_INPUT` | 400 | El cuerpo no superó la validación. | Consulta el mensaje. |
| `INVALID_LIMIT` | — | Una suscripción en tiempo real solicitó un límite fuera del rango permitido. Se entrega como un marco `ERROR` de WebSocket, no como una respuesta HTTP. | Reduce el límite. |
| `INVALID_LOGICAL_GROUP` | 400 | Un grupo `?or=` / `?and=` está malformado o anidado más allá de la profundidad permitida. | Consulta el mensaje; muestra la regla de aplanado. |
| `INVALID_OFFSET` | 400 | `?offset=` no es un número entero mayor o igual a 0. | Envía un entero no negativo. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` no es `field`, `field:desc` ni un array JSON de `{ field, direction }`. | Consulta el mensaje; muestra las tres sintaxis posibles. |
| `INVALID_PAGE` | 400 | `?page=` no es un número entero mayor o igual a 1. Las páginas están basadas en 1, por lo que `?page=0` es un error en lugar de la primera página. | Envía `1` o superior, o usa `?offset=`. |
| `INVALID_PARAM` | 400 | Un parámetro de consulta está malformado. | Consulta el mensaje. |
| `INVALID_VECTOR` | 400 | `?vector=` no es un array JSON de números. | Envía `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` no es `cosine`, `l2` ni `inner_product`. | Usa uno de esos tres. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` no es un número. | Envía un número. |
| `INVALID_WHERE` | 400 | `?where=` no es un objeto JSON que asocie campos con condiciones. | Envía `{"status":["==","active"]}`. |
| `MISSING_AGGREGATE_SELECT` | 400 | La ruta de agregados se invocó sin `?select=`. | Añade uno, p. ej. `?select=count()`. |
| `NO_COLLECTIONS` | 404 | El proyecto no sirve colecciones: ninguna declarada en código y sin tablas de las que derivarlas. | Crea tablas (una migración, SQL o un archivo de colección más `rebase db push`) y reinicia. |
| `NOT_FOUND` | 404 | No hay fila con ese id en esa colección, o la seguridad a nivel de fila la oculta a este cliente. | Verifica el id y luego las `securityRules` de la colección. |
| `UNKNOWN_RELATION` | 400 | `?include=` nombra algo que no es una relación en la colección. El mismo código responde **404** cuando una *ruta URL* anidada nombra una relación, p. ej. `/api/data/authors/1/posts` donde `authors` no declara ninguna; allí la URL no nombra nada, por lo que es un "no encontrado" en lugar de una solicitud malformada. | Comprueba el nombre de la relación: el mensaje lista las que tiene la colección. Una referencia inversa debe declararse en el padre para poder recorrerse. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | La ordenación nombra una propiedad que no se puede ordenar. | Ordena según una propiedad respaldada por una columna. |
| `PAYLOAD_TOO_LARGE` | 413 | El cuerpo excede el límite configurado. | Envía menos datos o aumenta el límite. |
| `READ_ONLY_TRANSACTION` | 409 | Un callback `afterRead` intentó escribir. Una lectura con ámbito de solicitud se ejecuta en una transacción `READ ONLY`, por lo que ni el callback ni nada de lo que invoque puede escribir. | Mueve la escritura fuera de la lectura: una tarea en segundo plano, o `rebase.dataAsAdmin` desde una tarea cron o función personalizada. |
| `RELATION_HAS_NO_PIVOT` | 400 | La escritura incluía un payload de enlace, pero la ruta no llega a su destino mediante un `manyToMany` que declare `through.properties`, por lo que no hay fila de unión donde ponerlo. | Declara `through.properties` en la relación o elimina el payload de la escritura. Consulta [Relations](/docs/collections/relations/). |
| `RELATION_MISCONFIGURED` | 500 | Una relación no se resuelve contra el esquema registrado. La operación se rechaza en lugar de omitirse: descartarla reportaría éxito para una escritura que nunca ocurrió, o un vacío para filas que existen. | Ejecuta `rebase schema generate` si el esquema generado es anterior al de la base de datos. |
| `RELATION_NOT_UNLINKABLE` | 400 | La relación no se puede desvincular desde este lado. | Escribe desde el lado propietario. |
| `RELATION_NOT_WRITABLE` | 400 | La ruta anidada no es una relación escribible. | Consulta [Relations](/docs/collections/relations/). |
| `RELATION_PIVOT_UNSUPPORTED` | 400 | La relación declara columnas de unión, pero este origen de datos no puede escribirlas. | El enlace en sí sigue funcionando; solo falla el payload asociado. Comprueba las capacidades del driver. |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Una escritura de relación no tenía una clave de origen a la cual asociar el enlace. | Guarda primero la fila padre. |
| `SCHEMA_DRIFT` | 500 | Una tabla o columna que el código espera no existe en la base de datos. | `rebase db push` en desarrollo; vuelve a desplegar en un entorno administrado (tenant). |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | Se combinó `startAfter` con `orderBy: "_score"`. La relevancia se calcula por consulta en lugar de almacenarse, por lo que no puede servir de clave para un cursor. | Pagina la relevancia con `limit`/`offset`, u ordena por una columna. |
| `TENANT_IMMUTABLE` | 400 | Una escritura movería una fila de un tenant a otro. Una fila no puede cambiar de tenant. `details.violations` nombra el campo. | Crea la fila en el otro tenant y elimina esta, o escribe con un rol en `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | La escritura especifica un tenant al que este cliente no pertenece; la base de datos también la rechazaría. | Escribe en un tenant al que pertenezca el cliente, o autentícate como alguien que pertenezca a él. |
| `TENANT_REQUIRED` | 400 | La colección está restringida por tenant y este no puede inferirse: la solicitud no incluye ninguno o el cliente pertenece a varios. | Envía el campo del tenant explícitamente, o autentícate como un cliente que pertenezca exactamente a uno. |
| `UNKNOWN_FIELD` | 400 | `?fields=` nombra un campo que la colección no tiene. | Comprueba la ortografía; el mensaje lista los campos válidos. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Un agregado o `groupBy` nombra un campo que la colección no tiene. | Comprueba la ortografía; el mensaje lista los campos válidos. |
| `UNKNOWN_FILTER_FIELD` | 400 | El filtro nombra un campo que esta colección —o el destino de una relación— no tiene. | Comprueba la ortografía; el mensaje lista los campos válidos. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | El filtro nombra un operador que no existe. | El mensaje lista todos los operadores. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | La ordenación nombra un campo que esta colección no tiene. | Comprueba la ortografía; el mensaje lista los campos válidos. |
| `PRECONDITION_FAILED` | 412 | Un `If-Match` indicó una versión de la fila que ya no es la actual: alguien escribió en ella entre la lectura y esta escritura. No se escribió nada. | Vuelve a leer la fila, reaplica el cambio y envía el nuevo `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` solicita un campo que la colección no tiene. | Comprueba la ortografía; el mensaje lista los campos conocidos. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Una búsqueda vectorial especificó una propiedad que no es un `vector` en esta colección. | El mensaje lista las propiedades vectoriales de la colección. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | El `Content-Type` no es aceptado por esta ruta. | Envía el tipo que documenta la ruta. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | El filtro cruza una relación `via`, cuya ruta de join está definida en una sola dirección, por lo que no hay forma de correlacionar una subconsulta de vuelta. | Filtra desde el lado propietario. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | El operador no está definido para ese campo: una relación sin columna en esta fila se filtra por pertenencia, y la coincidencia no sensible a mayúsculas solo aplica a texto. | Consulta el mensaje; lista lo que acepta el campo. |
| `VALIDATION_CONSTRAINT` | 400 | Un valor violó una regla de `validation` declarada en la propiedad: una longitud, un rango, un patrón, un campo obligatorio. | Consulta el mensaje; nombra cada violación. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | El cuerpo escribe en una columna marcada como `excludeFromApi`, o `access: { write: [] }` (la misma regla, dos formas de escribirla). Estas son exclusivas del servidor: un hash de contraseña, un token de verificación. A diferencia de `FIELD_NOT_WRITABLE`, esta respuesta es la misma para todos los clientes, incluido `admin`. | Elimina el campo. Consulta [Field access](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Un valor no coincide con su tipo de propiedad. | Consulta el mensaje; nombra la propiedad. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | El cuerpo nombra un campo que la colección no tiene, incluido un argumento `id` en una colección indexada por otra cosa. | Comprueba la ortografía; el mensaje lista los campos conocidos. |
| `WRITE_DENIED` | 403 | Una regla de seguridad o política de seguridad a nivel de fila rechazó la escritura. | Consulta las `securityRules` de la colección. |

## `PG_<SQLSTATE>` — una restricción que la base de datos rechazó

Una escritura que Postgres rechaza por una razón atribuible a *los datos del
cliente* responde con el SQLSTATE en el código: `PG_23505`, `PG_23503`, etcétera.
Se trata de una familia, no de una lista (Postgres define cientos de SQLSTATEs),
pero solo dos clases llegan a utilizarse aquí, porque solo esas dos son
responsabilidad del cliente:

- **clase 23**, violación de restricción de integridad: un duplicado, una clave
  foránea que apunta a la nada, una columna NOT NULL dejada vacía;
- **clase 22**, excepción de datos: un valor que el tipo de columna no puede admitir.

Todo lo demás —una conexión caída, una columna faltante, un problema de
privilegios— es del servidor y se mantiene como un `500`. Por lo tanto,
`code.startsWith("PG_")` es una comprobación segura de que "la fila que envié era
incorrecta", y las cuatro a continuación son las que un cliente encuentra en la
práctica. `details.dbCode` contiene el mismo SQLSTATE para todas ellas, y el
mensaje nombra la restricción.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | No se pudo leer un valor como el tipo de la columna (el gemelo del lado de escritura de `INVALID_FILTER_VALUE`). | Envía un valor del tipo de la columna. |
| `PG_23502` | 400 | Una columna `NOT NULL` se dejó vacía. | Envía el campo, o define un valor por defecto para la columna. |
| `PG_23503` | 400 | Una clave foránea apunta a una fila que no existe. | Crea primero la fila de destino o corrige el id. |
| `PG_23505` | 409 | Se violó una restricción de unicidad. El mensaje indica la restricción. | Usa un valor diferente o actualiza la fila existente. |

## Almacenamiento

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `INVALID_STORAGE_BUCKET` | 400 | El nombre del bucket está malformado. | Revisa el nombre. |
| `INVALID_STORAGE_KEY` | 400 | La clave del objeto está malformada o escapa de su prefijo. | Revisa la clave. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | Los parámetros de transformación de imagen están fuera de rango o son contradictorios. | Consulta [Storage](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | La subida supera el `maxSize` declarado por la propiedad de destino. Se aplica en el servidor, no solo en el navegador. `details` contiene la propiedad, el límite y el tamaño real. | Sube un archivo más pequeño o aumenta `maxSize` en la propiedad. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | El tipo del archivo subido no está en el `acceptedFiles` de la propiedad. `details` contiene la propiedad, la lista aceptada y el tipo de contenido enviado. | Sube un tipo aceptado o amplía `acceptedFiles`. |
| `STORAGE_NOT_CONFIGURED` | 503 | No hay backend de almacenamiento configurado en este servidor. | Configura S3, GCS o almacenamiento local. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | El origen de almacenamiento está declarado pero no tiene credenciales aquí. | Configura las variables de entorno de ese origen. |
| `STORAGE_WRITE_FAILED` | 502 | El backend de almacenamiento rechazó o interrumpió la escritura. | Revisa sus propios logs y credenciales. |
| `TRANSFORM_OVERLOADED` | 503 | Hay demasiadas transformaciones de imagen en curso. | Reintenta; considera colocar una CDN delante. |
| `UNKNOWN_STORAGE_SOURCE` | 400 | La solicitud especificó un origen de almacenamiento (`?storageId=`) que este proyecto no declara. Un `bucket` que este despliegue no atiende devuelve el mismo código con **404** (lo que falta es el store, y `details` nombra los buckets y orígenes que sí existen). Anteriormente, ambos se devolvían como "archivo no encontrado", idéntico a una clave que simplemente no existe. | Declara el origen en `config/resources.ts`, o consulta `GET /api/storage/sources`. |

## Funciones personalizadas

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | No se sirve ninguna función con ese nombre, o sí se sirve, pero sus propias rutas no cubren la ruta posterior. A un cliente autenticado también se le indica qué *sí* se sirve; a uno anónimo no, porque esa lista es un inventario de cada endpoint personalizado. Si un archivo con ese nombre no pudo cargarse, el mensaje lo especifica: esa es la diferencia entre un error tipográfico y un despliegue roto. | Comprueba el nombre contra `GET /api/functions`, o el log de arranque para ver si un archivo no se cargó. |
| `FUNCTION_TIMEOUT` | 504 | El handler excedió su tiempo de espera. Sigue ejecutándose; no se puede cancelar desde aquí. | Añade un `AbortSignal` a las llamadas salientes o aumenta `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Este proceso reenvía funciones por proxy a otro que no respondió. | Comprueba que la unidad de funciones esté en ejecución. |

## Superficies de administración y edición de esquemas

Estos indican que una funcionalidad está desactivada o no configurada, en lugar
de que la solicitud fuera errónea. Cada uno también se reporta en la ruta
`/status` correspondiente con un `200`, de modo que un panel pueda atenuar la
funcionalidad en lugar de mostrar un error.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | Se invocó una superficie exclusiva para administradores en un servidor sin autenticación configurada, por lo que nada puede distinguir a un administrador de un desconocido. | Configura `auth.jwtSecret` o pasa un `AuthAdapter`. |
| `CONTRACT_UNAVAILABLE` | 404 | El contrato del proyecto solo se sirve cuando la autenticación está configurada (describe cada tabla y relación). | Configura la autenticación. `/meta/schema-version` siempre se sirve. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | No hay ningún buzón de desarrollo activo. El correo solo se captura cuando `SMTP_HOST` no está configurado y `NODE_ENV` no es producción. | Desasigna `SMTP_HOST` en desarrollo o revisa la bandeja de entrada real. |
| `INVALID_CHANGE` | 400 | El cambio de esquema propuesto no está bien formado. | Consulta el mensaje. |
| `SCHEMA_CHANGE_FAILED` | 400 | La aplicación de un cambio de esquema planificado falló por una razón no cubierta por códigos más específicos. | Consulta el mensaje; es el fallo subyacente de forma literal. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | El cambio es válido pero no se puede aplicar al esquema en su estado actual. | Consulta el mensaje. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | El repositorio tiene cambios no confirmados, por lo que la edición no pudo aplicarse de forma segura. | Haz commit o stash y luego reintenta. |
| `SCHEMA_EDIT_REFUSED` | 400 | El editor de esquemas rechazó la edición. | Consulta el mensaje; es el propio rechazo del editor. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Una clave de API u otra entidad no humana intentó aplicar un cambio de esquema. | Inicia sesión como usuario o configura `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | La edición de esquemas en vivo necesita `collectionsDir` o `liveSchema.repository`, y este servidor se inició sin ninguno de los dos. | Configura uno. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | La planificación funciona; no hay repositorio en el que hacer commit del cambio. | Configura `liveSchema.repository`. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Este driver no puede planificar cambios de esquema. | La edición en vivo está disponible en Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | Aquí las colecciones se introspeccionan desde la base de datos, por lo que no hay archivos fuente para editar. | Modifica el esquema mediante una migración. |
| `SCHEMA_EDITOR_DISABLED` | 501 | El editor de esquemas está desactivado para este servidor. | Actívalo con `schemaEditor`. |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | El editor de esquemas necesita `ts-morph`, que no está instalado. | `pnpm add -D ts-morph@28.0.0`. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | El servidor no tiene `collectionsDir`, por lo que el editor no tiene dónde escribir. | Configura `collectionsDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | El editor está desactivado bajo `NODE_ENV=production`: los archivos de un servidor desplegado se reconstruyen a partir de tu repositorio en cada despliegue, por lo que una edición aquí se descartaría. | Edita las colecciones en desarrollo y despliega. |

## Códigos genéricos

Una ruta utiliza uno de estos cuando no aplica nada más específico.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Malformada, y nada más específico aplica. | Consulta el mensaje. |
| `UNAUTHORIZED` | 401 | No autenticado, o la credencial fue rechazada. | Inicia sesión o refresca el token. |
| `FORBIDDEN` | 403 | Autenticado, pero no autorizado. | Reintentar con la misma identidad no servirá. |
| `CONFLICT` | 409 | Un conflicto con el estado existente. | Consulta el mensaje. |
| `INTERNAL_ERROR` | 500 | Algo falló en el servidor. El mensaje es genérico a propósito. | Cita el `requestId`; el motivo está en los logs. |
| `NOT_CONFIGURED` | 503 | Una dependencia que necesita esta ruta no está configurada en este servidor. | Consulta el mensaje. |
| `SERVICE_UNAVAILABLE` | 503 | Una dependencia no fue accesible. | Reintenta; comprueba los logs. |

## Mantener la precisión de esta página

`pnpm verify:docs` falla cuando un código que el servidor puede emitir falta en
estas tablas, cuando una tabla lista un código que nada puede emitir, cuando un
estado indicado discrepa del código fuente, o cuando una familia de códigos como
`PG_<SQLSTATE>` no tiene fila para un SQLSTATE con el que los clientes se topan.
El paso es `tooling/scripts/docs-verify/check-error-codes.mjs`.

Se comprueba a sí mismo primero. El análisis lee los códigos a partir de
TypeScript en lugar de hacerlo desde un servidor en ejecución, por lo que sus
puntos ciegos son silenciosos por diseño: en una ocasión no pudo detectar un
código pasado a través de un wrapper de una sola línea, o uno escrito tras un
mensaje que contenía un `)`, y reportó que "cada código que el servidor puede
emitir está documentado" sobre una página a la que le faltaban diecisiete de
ellos. Por ello, el paso ejecuta un fixture exactamente con esas estructuras
antes de leer esta página, y se niega a reportar nada si no es capaz de verlos.

---
