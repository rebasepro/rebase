---
sourceHash: b82ed0c23d6537de
title: Códigos de error
sidebar_label: Códigos de error
description: Todos los códigos de error que puede devolver un backend de Rebase, con su estado HTTP, qué significan y qué hacer al respecto; además del envelope de respuesta, X-Request-ID y las reglas de details.
---

Cada fallo devuelto por un backend de Rebase utiliza un único envelope y lleva un
`code` estable. El código es el elemento sobre el que basar la lógica condicional: el mensaje está
escrito para una persona y su redacción puede cambiar, el código de estado se comparte entre una docena de
problemas distintos y el código de error no cambia.

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

- **`message`** — legible por humanos. Para un `4xx` es el propio mensaje del servidor; para
  un `5xx` es deliberadamente genérico, ya que el texto subyacente puede exponer un
  host, un rol o un nombre de columna.
- **`code`** — uno de los valores que figuran a continuación. Estable entre versiones menores.
- **`details`** — opcional y nunca garantizado. Consulta las reglas a continuación.
- **`requestId`** — presente siempre que la solicitud haya pasado por el middleware de request-ID,
  es decir, en todas las rutas bajo `basePath`.

### `X-Request-ID`

Cada solicitud bajo `basePath` recibe un ID: el encabezado `X-Request-ID` del emisor
cuando es un UUID v4 válido; de lo contrario, uno nuevo. Se devuelve en la
respuesta como `X-Request-ID`, se incluye en el envelope del error como `requestId` y se
adjunta a la línea de log del servidor para esa solicitud.

Esa es la clave de correlación. Menciónala en un reporte de error y un operador podrá encontrar la única
línea de log que explica el fallo, la cual contiene el motivo que nunca se le
mostró al cliente.

Enviar tu propio ID es la manera en que una traza sobrevive a un salto de red: un gateway o un gestor de colas (job runner) que
reenvía el encabezado mantiene un único ID a través de todos los servicios que procesaron la solicitud.
Un valor no válido se ignora en lugar de rechazarse —no vale la pena hacer fallar una solicitud por un
encabezado mal formado de un cliente—, así que no asumas que el ID que enviaste es
el ID que recibiste. Lee el encabezado de la respuesta.

### Qué hay en `details`

`details` es de diagnóstico, no contractual. Tres reglas lo rigen:

1. **Todo lo que una ruta establece explícitamente se devuelve siempre.** Estos son los
   propios errores del cliente descritos con precisión: qué campo de filtro era desconocido,
   qué relación no es de escritura, qué valor no encajaba con su tipo.
2. **Los diagnósticos de la base de datos se recortan en producción.** Cuando el fallo proviene
   de Postgres, `details.dbCode` —el SQLSTATE— siempre está presente: nombra
   la clase del problema y no revela nada sobre los datos. `dbMessage`,
   `detail` e `hint` solo se agregan cuando `NODE_ENV` no es `production`,
   ya que Postgres incluye el contenido de las filas en ellos. `23505` reporta
   `Key (email)=(a@b.c) already exists.`, lo que respondería a "¿esta persona está
   registrada?" para cualquier dirección que cualquiera decida probar.
3. **Nunca bases la lógica condicional en `details`.** Hazlo en `code`. Lo que está bajo `details` es
   aquello que fue útil para una persona en ese punto de la llamada, y puede cambiar.

## Lectura de un estado

| Estado | Qué indica sobre la solicitud |
| --- | --- |
| `400` | Con formato incorrecto, o solicitando algo que no existe en el esquema. Corrige la solicitud. |
| `401` | No autenticado, o la credencial expiró. Inicia sesión o renueva el token. |
| `403` | Autenticado, y no autorizado. Reintentar con la misma identidad no servirá de nada. |
| `404` | No existe dicha ruta, colección o fila — o es una fila que la seguridad a nivel de fila oculta. |
| `409` | Un conflicto con el estado existente: un duplicado o una escritura concurrente. |
| `413` `415` `422` | El cuerpo es demasiado grande, el tipo de medio es incorrecto o fue rechazado semánticamente. |
| `429` | Límite de tasa excedido. Reduce la frecuencia; el mensaje indica por cuánto tiempo. |
| `500` | El error está en el servidor o su base de datos, no en el cliente. Revisa los logs. |
| `501` | La ruta existe y este despliegue no puede atenderla: una funcionalidad apagada o no configurada. |
| `502` `503` `504` | Una dependencia no estaba disponible, no estaba configurada o fue demasiado lenta. |

## Autenticación y cuentas

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | La ruta requiere un segundo factor y la sesión solo tiene uno. | Completa el desafío MFA y reintenta. |
| `ALREADY_VERIFIED` | 400 | La dirección o el factor ya están verificados. | Nada — el estado deseado ya se cumple. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | El inicio de sesión anónimo está desactivado en este servidor. | Habilítalo o inicia sesión con una identidad real. |
| `API_KEY_FORBIDDEN` | 403 | Se utilizó una clave API en una ruta que solo pueden llamar personas. | Utiliza una sesión de usuario. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Una clave API intentó crear, listar o revocar claves API. | Gestiona las claves como un administrador autenticado. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Una ruta protegida se ejecutó sin un middleware de autenticación de Rebase antes de ella, por lo que nunca se evaluó la credencial del cliente. | Monta la aplicación a través del router de functions en lugar de hacerlo directamente en tu propio servidor. |
| `BOOTSTRAP_ANONYMOUS` | 403 | Un emisor anónimo intentó inicializar el primer administrador. | Inicia sesión primero. |
| `BOOTSTRAP_COMPLETED` | 403 | El primer administrador ya existe. | Haz que un administrador existente otorgue el rol. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | El bootstrap es solo para el primer usuario absoluto, y este no lo es. | Haz que un administrador existente otorgue el rol. |
| `CAPTCHA_FAILED` | 400 | El proveedor rechazó el token de CAPTCHA. | Resuelve un nuevo desafío. |
| `CAPTCHA_REQUIRED` | 400 | La ruta requiere un token de CAPTCHA y no se envió ninguno. | Incluye el token. |
| `CHALLENGE_EXHAUSTED` | 401 | Demasiados códigos incorrectos para un mismo desafío MFA. | Inicia un nuevo desafío. |
| `EMAIL_EXISTS` | 409 | Ya existe una cuenta con esa dirección. | Inicia sesión o inicia el restablecimiento de contraseña. |
| `EMAIL_NOT_CONFIGURED` | 503 | Se solicitaron enlaces mágicos u OTP y el servidor no tiene transporte de correo. | Configura SMTP o utiliza otro método de inicio de sesión. |
| `EMAIL_NOT_VERIFIED` | 403 | La cuenta existe y su dirección no está verificada. | Verifica la dirección. |
| `FACTOR_NOT_VERIFIED` | 400 | El factor MFA fue registrado pero nunca confirmado. | Confirma el factor. |
| `IDENTITY_ALREADY_LINKED` | 409 | Esa identidad de OAuth pertenece a otra cuenta. | Inicia sesión con ella o desvincula la identidad allí primero. |
| `INVALID_ACCOUNT` | 400 | La cuenta se encuentra en un estado en el que esta operación no puede actuar. | Consulta el mensaje. |
| `INVALID_CHALLENGE` | 400 | El desafío MFA es desconocido o ha expirado. | Inicia uno nuevo. |
| `INVALID_CODE` | 401 | El código OTP o MFA es incorrecto. | Reintenta con el código actual. |
| `INVALID_CREDENTIALS` | 401 | Correo o contraseña incorrectos — deliberadamente no se especifica cuál. | Reintenta o restablece la contraseña. |
| `INVALID_TOKEN` | 400 | Un token de verificación, restablecimiento o enlace mágico está mal formado o es desconocido. | Solicita un enlace nuevo. |
| `LAST_ADMIN` | 403 | El cambio dejaría al proyecto sin ningún administrador. | Promueve a otra persona primero. |
| `MFA_REQUIRED` | 401 | La contraseña era correcta y la cuenta tiene un segundo factor verificado, por lo que el inicio de sesión está incompleto. `details` contiene un token de corta duración delimitado al desafío MFA — no es una sesión. | Abre un desafío y respóndelo; la respuesta al desafío emite la sesión. |
| `NO_SESSION` | 401 | No se presentó ninguna cookie de sesión ni token de actualización. Normal en la primera carga de una página. | Inicia sesión. |
| `NOT_ANONYMOUS` | 400 | Una cuenta real llamó a una ruta para actualizar desde una cuenta anónima. | Nada que actualizar. |
| `OAUTH_ERROR` | 401 | El proveedor de OAuth lo rechazó o devolvió un error. | Reintenta el flujo; el mensaje contiene el motivo del proveedor. |
| `RATE_LIMITED` | 429 | Demasiados intentos por parte de este cliente. | Reduce la frecuencia; el mensaje indica por cuánto tiempo. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | El destino de redirección no está en la lista de permitidos. | Agrégalo a la configuración del proveedor. |
| `REGISTRATION_DISABLED` | 403 | El registro por cuenta propia está desactivado. | Haz que un administrador cree la cuenta. |
| `ROLE_EXISTS` | 409 | Ese nombre de rol ya está en uso. | Elige otro nombre. |
| `ROLE_LOOKUP_FAILED` | 503 | No se pudieron leer los roles para una solicitud restringida a administradores. Falla cerrando el acceso en lugar de confiar en el claim del propio token. | Reintenta; comprueba la base de datos. |
| `SELF_DELETE` | 400 | Un administrador intentó eliminar su propia cuenta. | Haz que otro administrador lo haga. |
| `SESSION_REVOKED` | 401 | Se cerró la sesión en otro lugar o se revocaron todas las sesiones. | Inicia sesión nuevamente. |
| `SETUP_REQUIRED` | 403 | El proyecto aún no tiene ningún administrador, por lo que esta ruta no está disponible. | Completa la configuración inicial del primer administrador. |
| `TOKEN_ALREADY_USED` | 401 | Se reutilizó un token de un solo uso. | Solicita uno nuevo. |
| `TOKEN_EXPIRED` | 401 | El token ha superado su tiempo de vida. | Solicita uno nuevo. |
| `USER_NOT_FOUND` | 404 | No existe ninguna cuenta con ese id. | Comprueba el id. |
| `WEAK_PASSWORD` | 400 | La contraseña no cumple con la política configurada. | Elige una más segura. |

## Datos, consultas y escrituras

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Este driver no puede calcular la agregación solicitada. | Usa un driver compatible o calcúlala en el cliente. |
| `BRANCHING_UNSUPPORTED` | — | Se solicitó una rama de base de datos a través del WebSocket de Studio en la base de datos de desarrollo administrada (PGlite), donde una rama *es* el padre y nada quedaría aislado. El rechazo es el mismo que imprime `rebase db branch`. | Apunta `DATABASE_URL` a tu propio Postgres (`rebase dev --docker` inicia uno) y crea la rama allí. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` contiene más operaciones que el límite por lote (1000 por defecto). Un lote equivale a una transacción y mantiene sus bloqueos durante toda su duración. | Envíalo por partes; el mensaje indica el límite y tu cantidad actual. |
| `BATCH_UNSUPPORTED` | 400 | El driver de este backend no puede escribir entre colecciones de forma atómica, y un bucle de escrituras individuales no sería atómico ni se realizaría en un solo viaje de ida y vuelta. | Envía las escrituras como solicitudes separadas, o como llamadas `/bulk` por colección. |
| `BULK_TOO_LARGE` | 400 | El cuerpo de la operación masiva excede el límite de elementos configurado. | Divide la solicitud. |
| `BULK_UNSUPPORTED` | 400 | Esta colección o driver no admite escrituras masivas. | Escribe las filas una por una. |
| `CALLBACK_REJECTED` | 400 | Un callback de la colección rechazó la escritura. Un `throw` desde `beforeSave`/`beforeDelete`/`after*` devuelve un 400 con el mensaje definido por el autor; un `beforeDelete` que devuelve `false` arroja un 403. `details.stage` nombra qué callback fue y `details.path` la colección. | Lee el mensaje — fue redactado por este proyecto, no por Rebase. |
| `CURSOR_WITH_OFFSET` | 400 | Se combinó `?after=` con `?offset=` o `?page=`. Un cursor ya indica dónde comienza la página, por lo que un desplazamiento sobre él omite silenciosamente esa cantidad de filas más allá del cursor — un vacío que el cliente no puede ver en la respuesta. | Usa uno u otro. |
| `DISTINCT_NOT_APPLICABLE` | 400 | Se combinó `?distinct=true` con una consulta de búsqueda o vectorial. Ambas adjuntan una puntuación por fila, por lo que nunca habrá dos filas iguales y `DISTINCT` no colapsaría nada — parecería haber funcionado sin cambiar nada. | Descarta uno de los dos. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Una lectura con `distinct` está ordenada por una columna que no devuelve. Un `SELECT DISTINCT` solo puede ordenarse por columnas en su lista de selección, o de lo contrario las filas que colapsa carecen de un orden definido. `details.fields` las nombra. | Agrega esos campos a `?fields=`, o elimínalos de `?orderBy=`. |
| `DB_PERMISSION_DENIED` | 500 | Postgres rechazó la sentencia (`42501`): bien por una política de seguridad a nivel de fila que deniega este rol, o por la falta de un `GRANT`. | Consulta [Troubleshooting](/docs/troubleshooting/). |
| `FIELD_NOT_READABLE` | 400 | Un filtro, `orderBy`, `fields`, `select` de agregación o `groupBy` nombra un campo que los roles de este cliente no pueden leer (`access.read`). Un campo que ninguna respuesta puede incluir debe ser uno que ninguna consulta pueda interrogar, o de lo contrario el valor sería legible predicado por predicado. `details.violations` nombra cada campo. | Elimina el campo de la consulta o adquiere el rol necesario. Consulta [Acceso a campos](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 | El cuerpo asigna un campo que los roles de este cliente no pueden escribir (`access.write`). Se rechaza en lugar de descartarse: una escritura que omite un campo reportaría éxito para una edición que no ocurrió. `details.violations` nombra cada campo. | Elimina el campo o adquiere el rol necesario. Un campo que nadie puede escribir devuelve `VALIDATION_EXCLUDED_FIELDS` en su lugar. |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Una solicitud anterior con la misma `Idempotency-Key` todavía se está ejecutando. | Reintenta una vez que haya finalizado. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | Se recibió la misma `Idempotency-Key` con un cuerpo diferente. | Usa una clave nueva o envía el cuerpo original. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` especificó una función distinta de `count`, `sum`, `avg`, `min` o `max`. | Usa una de esas; el mensaje las lista. |
| `INVALID_AGGREGATE_SELECT` | 400 | Una entrada de `?select=` no sigue el formato `fn(field)`, o se proporcionó una función diferente de `count()` sin ningún campo. | Escribe `sum(total)`, `count()`, `avg(score)`. |
| `INVALID_BATCH_BODY` | 400 | A una operación de `/_batch` le falta `op`, `collection`, `values` o `id`, nombra una colección que este backend no sirve, o reutiliza un nombre de `ref`. | Consulta el mensaje; nombra la operación por su índice. |
| `INVALID_BATCH_REF` | 400 | Un `{ "$ref": "<name>.<field>" }` no apunta a ninguna operación anterior, apunta hacia adelante o pide un campo que la fila referenciada no tiene. Solo se resuelven referencias hacia atrás. | Nombra la operación con `ref` *antes* de referenciarla. |
| `INVALID_BULK_BODY` | 400 | El cuerpo de la operación masiva no tiene la estructura esperada. | Envía el array `items` documentado. |
| `INVALID_CONFLICT_TARGET` | 400 | El `on_conflict` / `onConflict` de un upsert nombra columnas que no garantizan unicidad, o las nombra sin `upsert: true`. De lo contrario, Postgres respondería con 42P10 desde el interior de una transacción que ya ha realizado operaciones. | Declara `validation: { unique: true }` o un índice `unique`; el mensaje lista los destinos válidos que existen. |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` no es ni `include` ni `only`. Se rechaza en lugar de ignorarse: un error tipográfico como `?deleted=true` que ocultara silenciosamente cada fila eliminada parecería haber funcionado y respondería la pregunta contraria. | Envía `include` (activas y eliminadas) u `only` (únicamente eliminadas). Omítelo para obtener solo filas activas. |
| `INVALID_DISTINCT` | 400 | `?distinct=` no es ni `true` ni `false`. | Envía uno de esos valores; también se aceptan `1` y `0`. |
| `INVALID_FIELD_OPERATION` | 400 | Se utilizó `$inc` / `$push` / `$pull` / `$merge` en un tipo de propiedad para el que no está definido, con un operando de estructura errónea, con dos operadores en un solo campo, mal escrito o en una creación (donde no hay valor almacenado sobre el que operar). | Consulta [Escritura a través de REST](/docs/backend/writes/#field-operations); el mensaje nombra el campo. |
| `INVALID_FILTER_FIELD` | 400 | El filtro nombra una propiedad que esta colección no tiene. | Verifica la ortografía comparándola con la colección. |
| `INVALID_FILTER_OPERATOR` | 400 | El operador no es compatible con este tipo de propiedad. | Consulta [Consulta de datos](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | Un valor de filtro no se puede interpretar como el tipo de la columna con la que se comparó: `?id=eq.abc` en una clave entera, una etiqueta que no está en el enum, una marca de tiempo inválida o un número fuera del rango del tipo. `details.dbCode` contiene el SQLSTATE. | Envía un valor correspondiente al tipo de la columna. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` no es ni `true` ni `false`. Cualquier otro valor se rechaza en lugar de interpretarse como "no" — un error tipográfico que aplica un borrado lógico cuando el cliente solicitó purgar le haría creer erróneamente que los datos han desaparecido. | Envía `true` o `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` tiene un formato incorrecto: no es una lista de rutas válida o está anidada más allá de la profundidad máxima. Se responde en el límite de la API en lugar de escapar del driver como un 500. | Consulta el mensaje; nombra la ruta problemática. |
| `INVALID_INPUT` | 400 | El cuerpo de la solicitud no superó la validación. | Consulta el mensaje. |
| `INVALID_LIMIT` | — | Una suscripción en tiempo real solicitó un límite fuera del rango permitido. Se entrega como un frame `ERROR` de WebSocket, no como una respuesta HTTP. | Reduce el límite. |
| `INVALID_LOGICAL_GROUP` | 400 | Un grupo `?or=` / `?and=` tiene un formato incorrecto o supera la profundidad de anidamiento permitida. | Consulta el mensaje; muestra la regla de aplanamiento. |
| `INVALID_OFFSET` | 400 | `?offset=` no es un número entero igual o mayor a 0. | Envía un entero no negativo. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` no es `field`, `field:desc`, ni un array JSON de `{ field, direction }`. | Consulta el mensaje; muestra las tres variantes válidas. |
| `INVALID_PAGE` | 400 | `?page=` no es un número entero igual o mayor a 1. Las páginas empiezan en 1, por lo que `?page=0` se considera un error en lugar de la primera página. | Envía `1` o más, o usa `?offset=`. |
| `INVALID_PARAM` | 400 | Un parámetro de consulta tiene un formato incorrecto. | Consulta el mensaje. |
| `INVALID_VECTOR` | 400 | `?vector=` no es un array JSON de números. | Envía `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` no es `cosine`, `l2` ni `inner_product`. | Utiliza uno de esos tres. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` no es un número. | Envía un número. |
| `INVALID_WHERE` | 400 | `?where=` no es un objeto JSON que asocie campos con condiciones. | Envía `{"status":["==","active"]}`. |
| `MISSING_AGGREGATE_SELECT` | 400 | Se llamó a la ruta de agregación sin un parámetro `?select=`. | Agrega uno, por ejemplo `?select=count()`. |
| `NO_COLLECTIONS` | 404 | El proyecto no sirve colecciones: no hay ninguna declarada en el código ni tablas de las cuales derivarlas. | Crea tablas —mediante una migración, SQL o un archivo de colección junto con `rebase db push`— y reinicia. |
| `NOT_FOUND` | 404 | No existe una fila con ese id en esa colección — o la seguridad a nivel de fila la oculta para este cliente. | Comprueba el id y luego las `securityRules` de la colección. |
| `UNKNOWN_RELATION` | 400 | `?include=` especifica algo que no es una relación en la colección. El mismo código devuelve **404** cuando es una *ruta de URL* anidada la que lo especifica, por ejemplo `/api/data/authors/1/posts` donde `authors` no declara ninguna; allí la URL no apunta a nada, por lo que es un recurso no encontrado y no una solicitud mal formada. | Comprueba el nombre de la relación — el mensaje lista las que posee la colección. Una referencia inversa debe declararse en el padre para poder navegarse. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | El ordenamiento hace referencia a una propiedad que no es ordenable. | Ordena por una propiedad respaldada por una columna. |
| `PAYLOAD_TOO_LARGE` | 413 | El cuerpo de la solicitud excede el límite configurado. | Envía menos datos o incrementa el límite. |
| `READ_ONLY_TRANSACTION` | 409 | Un callback `afterRead` intentó escribir. Una lectura en el ámbito de una solicitud se ejecuta en una transacción `READ ONLY`, por lo que ni el callback ni nada de lo que invoque puede escribir. | Extrae la escritura de la lectura: usa un trabajo en segundo plano, o `rebase.dataAsAdmin` desde una tarea cron o una función personalizada. |
| `RELATION_MISCONFIGURED` | 500 | Una relación no se resuelve contra el esquema registrado. La operación se rechaza en lugar de ignorarse: omitirla reportaría éxito en una escritura que nunca ocurrió, o un conjunto vacío para filas que sí existen. | Ejecuta `rebase schema generate` si el esquema generado es anterior a la base de datos. |
| `RELATION_NOT_UNLINKABLE` | 400 | La relación no se puede desvincular desde este extremo. | Escribe desde el lado propietario. |
| `RELATION_NOT_WRITABLE` | 400 | La ruta anidada no es una relación de escritura. | Consulta [Relaciones](/docs/collections/relations/). |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Una escritura de relación no tenía una clave de origen a la cual asociar el enlace. | Guarda primero la fila padre. |
| `SCHEMA_DRIFT` | 500 | Una tabla o columna esperada por el código no existe en la base de datos. | Ejecuta `rebase db push` en desarrollo; vuelve a desplegar en un entorno administrado. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | Se combinó `startAfter` con `orderBy: "_score"`. La relevancia se calcula por consulta en lugar de almacenarse, por lo que no puede servir de clave para un cursor. | Pagina la relevancia con `limit`/`offset`, u ordena por una columna. |
| `TENANT_IMMUTABLE` | 400 | Una escritura movería una fila de un tenant a otro. Una fila no puede cambiar de tenant. `details.violations` indica el campo. | Crea la fila en el otro tenant y elimina esta, o escribe usando un rol incluido en `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | La escritura especifica un tenant al que este cliente no pertenece; la base de datos también la rechazaría. | Escribe en un tenant al que pertenezca el cliente o autentícate con una cuenta que pertenezca a él. |
| `TENANT_REQUIRED` | 400 | La colección está delimitada por tenant y el tenant no se puede deducir: la solicitud no incluye ninguno o el cliente pertenece a varios. | Envía el campo del tenant de forma explícita o autentícate como un usuario que pertenezca exactamente a uno. |
| `UNKNOWN_FIELD` | 400 | `?fields=` nombra un campo que la colección no tiene. | Comprueba la ortografía; el mensaje lista los campos válidos. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Una agregación o `groupBy` nombra un campo que la colección no tiene. | Comprueba la ortografía; el mensaje lista los campos válidos. |
| `UNKNOWN_FILTER_FIELD` | 400 | El filtro nombra un campo que esta colección —o el destino de una relación— no tiene. | Comprueba la ortografía; el mensaje lista los campos válidos. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | El filtro nombra un operador que no existe. | El mensaje lista todos los operadores disponibles. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | La ordenación nombra un campo que esta colección no tiene. | Comprueba la ortografía; el mensaje lista los campos válidos. |
| `PRECONDITION_FAILED` | 412 | Un encabezado `If-Match` indicó una versión de la fila que ya no es la actual: alguien escribió en ella entre la lectura y esta escritura. No se guardó ningún cambio. | Vuelve a leer la fila, vuelve a aplicar el cambio y envía el nuevo `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` solicita un campo que la colección no tiene. | Comprueba la ortografía; el mensaje lista los campos conocidos. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Una búsqueda vectorial especificó una propiedad que no es de tipo `vector` en esta colección. | El mensaje lista las propiedades vectoriales de la colección. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | El `Content-Type` no es admitido por esta ruta. | Envía el tipo documentado para la ruta. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | El filtro atraviesa una relación `via`, cuya ruta de unión (join) está definida en una sola dirección, por lo que no hay forma de correlacionar una subconsulta de retorno. | Filtra desde el lado propietario. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | El operador no está definido para ese campo: una relación sin columna en esta fila se filtra por pertenencia, y la coincidencia insensible a mayúsculas/minúsculas solo aplica a texto. | Consulta el mensaje; lista lo que admite el campo. |
| `VALIDATION_CONSTRAINT` | 400 | Un valor infringió una regla de `validation` declarada en la propiedad: longitud, rango, patrón o campo obligatorio. | Consulta el mensaje; detalla cada infracción. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | El cuerpo escribe sobre una columna marcada con `excludeFromApi`, o `access: { write: [] }` —la misma regla con dos sintaxis diferentes—. Esas columnas están reservadas para el servidor: un hash de contraseña, un token de verificación. A diferencia de `FIELD_NOT_WRITABLE`, esta respuesta es idéntica para cualquier cliente, incluyendo `admin`. | Elimina el campo. Consulta [Acceso a campos](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Un valor no coincide con el tipo de su propiedad. | Consulta el mensaje; indica la propiedad. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | El cuerpo nombra un campo que la colección no tiene — incluyendo un argumento `id` en una colección indexada por otro identificador. | Comprueba la ortografía; el mensaje lista los campos conocidos. |
| `WRITE_DENIED` | 403 | Una regla de seguridad o una política de seguridad a nivel de fila rechazó la escritura. | Revisa las `securityRules` de la colección. |

## `PG_<SQLSTATE>` — una restricción rechazada por la base de datos

Una escritura que Postgres rechaza por un motivo atribuible a *los datos del emisor* responde
con el SQLSTATE en el código: `PG_23505`, `PG_23503`, etc. Se trata de una
familia, no de una lista fija —Postgres define cientos de SQLSTATEs—, pero solo dos
clases la alcanzan, ya que solo esas dos son responsabilidad del cliente:

- **clase 23**, violación de restricción de integridad: un duplicado, una clave foránea que
  apunta a nada, una columna NOT NULL dejada vacía;
- **clase 22**, excepción de datos: un valor que el tipo de la columna no puede almacenar.

Todo lo demás —una conexión interrumpida, una columna faltante, un problema de privilegios—
es responsabilidad del servidor y permanece como un `500`. Por tanto, `code.startsWith("PG_")` es una comprobación segura
para determinar que "la fila que envié era incorrecta", y los cuatro casos a continuación son los que
un cliente encuentra en la práctica. `details.dbCode` contiene el mismo SQLSTATE en todos ellos, y
el mensaje nombra la restricción.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | Un valor no pudo leerse como el tipo de la columna — el equivalente en escritura de `INVALID_FILTER_VALUE`. | Envía un valor correspondiente al tipo de la columna. |
| `PG_23502` | 400 | Se dejó vacía una columna `NOT NULL`. | Envía el campo o asigna un valor por defecto a la columna. |
| `PG_23503` | 400 | Una clave foránea apunta a una fila inexistente. | Crea la fila de destino primero o corrige el id. |
| `PG_23505` | 409 | Se violó una restricción de unicidad. El mensaje nombra la restricción. | Usa un valor diferente o actualiza la fila existente. |

## Almacenamiento (Storage)

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `INVALID_STORAGE_BUCKET` | 400 | El nombre del bucket tiene un formato incorrecto. | Comprueba el nombre. |
| `INVALID_STORAGE_KEY` | 400 | La clave del objeto tiene un formato incorrecto o escapa de su prefijo. | Comprueba la clave. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | Los parámetros de transformación de imagen están fuera de rango o son contradictorios. | Consulta [Almacenamiento](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | La subida supera el `maxSize` declarado por la propiedad de destino. Se valida en el servidor, no solo en el navegador. `details` contiene la propiedad, el límite y el tamaño real. | Sube un archivo más pequeño o incrementa `maxSize` en la propiedad. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | El tipo de archivo subido no está en el `acceptedFiles` de la propiedad. `details` contiene la propiedad, la lista aceptada y el content type enviado. | Sube un tipo aceptado o amplía `acceptedFiles`. |
| `STORAGE_NOT_CONFIGURED` | 503 | No hay ningún backend de almacenamiento configurado en este servidor. | Configura S3, GCS o almacenamiento local. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | La fuente de almacenamiento está declarada pero no tiene credenciales en este entorno. | Configura las variables de entorno de esa fuente. |
| `STORAGE_WRITE_FAILED` | 502 | El backend de almacenamiento rechazó o interrumpió la escritura. | Comprueba sus propios logs y credenciales. |
| `TRANSFORM_OVERLOADED` | 503 | Hay demasiadas transformaciones de imagen en curso. | Reintenta; considera colocar una CDN por delante. |
| `UNKNOWN_STORAGE_SOURCE` | 400 | La solicitud indicó una fuente de almacenamiento (`?storageId=`) que este proyecto no declara. Un `bucket` que este despliegue no sirve devuelve este mismo código con estado **404** —lo que falta es el almacenamiento—, y `details` nombra los buckets y las fuentes que sí existen. Ambos solían responder como "file not found", idéntico a una clave que simplemente no existe. | Declara la fuente en `config/resources.ts` o consulta `GET /api/storage/sources`. |

## Funciones personalizadas (Custom functions)

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | No se sirve ninguna función con ese nombre — o existe una, pero sus propias rutas no cubren la ruta posterior. A un cliente autenticado también se le indica cuáles *sí* están disponibles; a uno anónimo no, ya que esa lista representa un inventario de cada endpoint personalizado. Si un archivo con ese nombre no pudo cargarse, el mensaje lo especifica: esa es la diferencia entre un error tipográfico y un despliegue defectuoso. | Comprueba el nombre con `GET /api/functions`, o revisa el log de inicio para ver si un archivo no se cargó. |
| `FUNCTION_TIMEOUT` | 504 | El handler excedió su tiempo límite. Todavía se está ejecutando; no puede cancelarse desde aquí. | Proporciona un `AbortSignal` a las llamadas salientes o aumenta `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Este proceso reenvía las funciones mediante proxy a otro, el cual no respondió. | Verifica que la unidad de funciones esté en ejecución. |

## Superficies de administración y edición de esquemas

Estos códigos indican que una funcionalidad está desactivada o sin configurar, no que la solicitud fuera
incorrecta. Cada uno también se reporta en la ruta `/status` correspondiente con un `200`,
de modo que un panel de control puede deshabilitar visualmente la función en lugar de mostrar un error.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | Se invocó una superficie exclusiva de administración en un servidor sin autenticación configurada, por lo que no se puede distinguir a un administrador de un desconocido. | Configura `auth.jwtSecret` o pasa un `AuthAdapter`. |
| `CONTRACT_UNAVAILABLE` | 404 | El contrato del proyecto solo se sirve cuando la autenticación está configurada — describe cada tabla y relación. | Configura la autenticación. `/meta/schema-version` siempre está disponible. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | No hay ningún buzón de desarrollo activo. El correo solo se captura cuando `SMTP_HOST` no está configurado y `NODE_ENV` no es production. | Deja sin configurar `SMTP_HOST` en desarrollo o revisa la bandeja de entrada real. |
| `INVALID_CHANGE` | 400 | El cambio de esquema propuesto no tiene un formato válido. | Consulta el mensaje. |
| `SCHEMA_CHANGE_FAILED` | 400 | La aplicación de un cambio de esquema planificado falló por un motivo que códigos más específicos no contemplan. | Consulta el mensaje; contiene el fallo subyacente de forma textual. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | El cambio es válido pero no puede aplicarse al esquema en su estado actual. | Consulta el mensaje. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | El repositorio tiene cambios sin confirmar, por lo que la edición no pudo aplicarse de forma segura. | Haz commit o stash y vuelve a intentarlo. |
| `SCHEMA_EDIT_REFUSED` | 400 | El editor de esquemas rechazó la modificación. | Consulta el mensaje; es el propio rechazo del editor. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Una clave API u otra entidad máquina intentó aplicar un cambio de esquema. | Inicia sesión como usuario o configura `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | La edición de esquemas en vivo requiere `collectionsDir` o `liveSchema.repository`, y este servidor se inició sin ninguno de ellos. | Configura uno. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | La planificación funciona; no hay ningún repositorio en el que confirmar el cambio. | Configura `liveSchema.repository`. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Este driver no puede planificar cambios de esquema. | La edición en vivo está disponible en Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | Las colecciones se inspeccionan directamente desde la base de datos aquí, por lo que no hay archivos de origen que editar. | Modifica el esquema mediante una migración. |
| `SCHEMA_EDITOR_DISABLED` | 501 | El editor de esquemas está desactivado para este servidor. | Actívalo con `schemaEditor`. |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | El editor de esquemas requiere `ts-morph`, el cual no está instalado. | `pnpm add -D ts-morph@28.0.0`. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | El servidor no tiene `collectionsDir`, por lo que el editor no tiene ningún lugar donde escribir. | Configura `collectionsDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | El editor está desactivado bajo `NODE_ENV=production`: los archivos de un servidor desplegado se reconstruyen a partir de tu repositorio en cada despliegue, por lo que cualquier edición aquí se perdería. | Edita las colecciones en desarrollo y despliega. |

## Códigos genéricos

Una ruta utiliza uno de estos cuando no aplica ningún código más específico.

| Código | Estado | Significado | Qué hacer |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Solicitud mal formada y ningún código más específico es aplicable. | Consulta el mensaje. |
| `UNAUTHORIZED` | 401 | No autenticado, o la credencial fue rechazada. | Inicia sesión o renueva el token. |
| `FORBIDDEN` | 403 | Autenticado, pero no autorizado. | Reintentar con la misma identidad no servirá de nada. |
| `CONFLICT` | 409 | Un conflicto con el estado existente. | Consulta el mensaje. |
| `INTERNAL_ERROR` | 500 | Algo falló en el servidor. El mensaje es genérico intencionalmente. | Indica el `requestId`; la causa se encuentra en los logs. |
| `NOT_CONFIGURED` | 503 | Una dependencia requerida por esta ruta no está configurada en este servidor. | Consulta el mensaje. |
| `SERVICE_UNAVAILABLE` | 503 | Una dependencia no estuvo accesible. | Reintenta; revisa los logs. |

## Mantener esta página actualizada

`pnpm verify:docs` falla cuando un código que el servidor puede generar falta en estas
tablas, cuando una tabla lista un código que nada puede generar, cuando un estado indicado
no coincide con el código fuente, o cuando una familia de códigos como `PG_<SQLSTATE>` carece de una fila
para un SQLSTATE con el que los clientes se encuentran. La fase se ejecuta en
`tooling/scripts/docs-verify/check-error-codes.mjs`.

Primero se verifica a sí mismo. El análisis lee los códigos directamente de TypeScript en lugar de hacerlo desde
un servidor en ejecución, por lo que sus puntos ciegos son silenciosos por diseño: en una ocasión no
pudo detectar un código pasado mediante un wrapper de una sola línea, o uno escrito tras un mensaje
que contenía un `)`, reportando "todos los códigos que el servidor puede emitir están documentados"
en una página a la que le faltaban diecisiete de ellos. Por ello, la verificación ejecuta un fixture con exactamente
esas estructuras antes de leer esta página, y se niega a emitir cualquier reporte si
no es capaz de detectarlas.

---
