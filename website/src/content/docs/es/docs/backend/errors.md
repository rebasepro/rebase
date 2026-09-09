---
sourceHash: b82ed0c23d6537de
title: Códigos de error
sidebar_label: Códigos de error
description: Todos los códigos de error que un backend de Rebase puede devolver, con su estado HTTP, su significado y qué hacer al respecto — además de la estructura de respuesta, X-Request-ID y las reglas de details.
---

Cada fallo que devuelve un backend de Rebase utiliza un mismo contenedor (*envelope*) y contiene un `code` estable. El código es el elemento sobre el cual ramificar o bifurcar la lógica: el mensaje está redactado para personas y puede variar su redacción, el estado se comparte entre una docena de problemas distintos, y el código no sufre de ninguno de esos dos casos.

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

- **`message`** — legible para humanos. Para un `4xx` es el propio mensaje del servidor; para un `5xx` es deliberadamente genérico, ya que el texto subyacente puede citar un host, un rol o un nombre de columna.
- **`code`** — uno de los valores que figuran a continuación. Estable entre versiones menores.
- **`details`** — opcional y nunca garantizado. Consulta las reglas a continuación.
- **`requestId`** — presente siempre que la solicitud haya pasado por el middleware de request-ID, es decir, en todas las rutas bajo `basePath`.

### `X-Request-ID`

Cada solicitud bajo `basePath` obtiene un ID: el encabezado `X-Request-ID` del cliente cuando es un UUID v4 válido, o uno nuevo en caso contrario. Se devuelve en la respuesta como `X-Request-ID`, se incluye en el envelope del error como `requestId` y se adjunta a la línea de log del servidor para esa solicitud.

Esa es la clave de unión (*join key*). Cítala en un reporte de error y un operador podrá encontrar la línea de log exacta que explica el fallo, la cual contiene la razón que nunca se le mostró al cliente.

Enviar tu propio ID es la forma en que una traza sobrevive a un salto: una pasarela (*gateway*) o un ejecutor de tareas (*job runner*) que reenvía el encabezado obtiene un único ID en todos los servicios que procesaron la solicitud. Un valor inválido se ignora en lugar de rechazarse —un encabezado malformado del cliente no justifica hacer fallar una solicitud—, por lo que no debes asumir que el ID enviado es el ID recibido. Lee el encabezado de respuesta.

### Qué contiene `details`

`details` es diagnóstico, no contractual. Se rige por tres reglas:

1. **Todo lo que una ruta establezca explícitamente se devuelve siempre.** Estos son los propios errores del cliente descritos con precisión: qué campo de filtro era desconocido, qué relación no es de escritura, qué valor no coincidió con su tipo.
2. **Los diagnósticos de la base de datos se recortan en producción.** Cuando el fallo proviene de Postgres, `details.dbCode` —el SQLSTATE— siempre está presente: nombra la clase de problema y no revela nada sobre los datos. `dbMessage`, `detail` y `hint` solo se agregan cuando `NODE_ENV` no es `production`, ya que Postgres incluye el contenido de las filas en ellos. `23505` informa `Key (email)=(a@b.c) already exists.`, lo que responde a «¿está registrada esta persona?» para cualquier dirección que alguien intente probar.
3. **Nunca bifurques lógica basándote en `details`.** Hazlo según el `code`. Lo que está dentro de `details` es lo que resultaba útil para una persona en ese punto de llamada específico, y está sujeto a cambios.

## Lectura de un estado

| Estado | Qué indica sobre la solicitud |
| --- | --- |
| `400` | Malformada o solicitando algo que no existe en el esquema. Corrige la solicitud. |
| `401` | No autenticado o la credencial expiró. Inicia sesión o renueva el token. |
| `403` | Autenticado, pero no autorizado. Reintentar con la misma identidad no servirá. |
| `404` | No existe tal ruta, colección o fila — o una fila oculta por seguridad a nivel de fila (*row-level security*). |
| `409` | Un conflicto con el estado existente: un duplicado o una escritura concurrente. |
| `413` `415` `422` | El cuerpo es demasiado grande, el tipo de medio es incorrecto o fue rechazado semánticamente. |
| `429` | Límite de tasa excedido (*rate limited*). Espera antes de reintentar; el mensaje indica cuánto tiempo. |
| `500` | El problema está en el servidor o en su base de datos, no en el cliente. Revisa los logs. |
| `501` | La ruta existe, pero este despliegue no puede atenderla — una característica que está desactivada o no configurada. |
| `502` `503` `504` | Una dependencia no estaba accesible, no estaba configurada o fue demasiado lenta. |

## Autenticación y cuentas

| Código | Estado | Significado | Acción |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | La ruta requiere un segundo factor y la sesión solo tiene uno. | Completa el desafío MFA y luego reintenta. |
| `ALREADY_VERIFIED` | 400 | La dirección o el factor ya están verificados. | Ninguna — el estado deseado ya se cumple. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | El inicio de sesión anónimo está desactivado en este servidor. | Actívalo o inicia sesión con una identidad real. |
| `API_KEY_FORBIDDEN` | 403 | Se utilizó una clave de API en una ruta que solo las personas pueden llamar. | Utiliza una sesión de usuario. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Una clave de API intentó crear, listar o revocar claves de API. | Administra las claves como un administrador con sesión iniciada. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Una ruta protegida se ejecutó sin middleware de autenticación de Rebase previo, por lo que nunca se evaluó la credencial del cliente. | Monta la aplicación a través del enrutador de funciones en lugar de montarla directamente en tu propio servidor. |
| `BOOTSTRAP_ANONYMOUS` | 403 | Un cliente anónimo intentó el bootstrap del primer administrador. | Inicia sesión primero. |
| `BOOTSTRAP_COMPLETED` | 403 | El primer administrador ya existe. | Haz que un administrador existente otorgue el rol. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | El bootstrap es solo para el primerísimo usuario, y este no lo es. | Haz que un administrador existente otorgue el rol. |
| `CAPTCHA_FAILED` | 400 | El proveedor rechazó el token de CAPTCHA. | Resuelve un nuevo desafío. |
| `CAPTCHA_REQUIRED` | 400 | La ruta requiere un token de CAPTCHA y no se envió ninguno. | Incluye el token. |
| `CHALLENGE_EXHAUSTED` | 401 | Demasiados códigos incorrectos para un mismo desafío MFA. | Inicia un nuevo desafío. |
| `EMAIL_EXISTS` | 409 | Ya existe una cuenta con esa dirección. | Inicia sesión o solicita un restablecimiento de contraseña. |
| `EMAIL_NOT_CONFIGURED` | 503 | Se solicitaron enlaces mágicos u OTP y el servidor no tiene transporte de correo configurado. | Configura SMTP o utiliza otro método de inicio de sesión. |
| `EMAIL_NOT_VERIFIED` | 403 | La cuenta existe y su dirección no está verificada. | Verifica la dirección. |
| `FACTOR_NOT_VERIFIED` | 400 | El factor MFA se registró pero nunca se confirmó. | Confirma el factor. |
| `IDENTITY_ALREADY_LINKED` | 409 | Esa identidad de OAuth pertenece a otra cuenta. | Inicia sesión con ella o desvincúlala primero de la otra cuenta. |
| `INVALID_ACCOUNT` | 400 | La cuenta está en un estado en el que esta operación no puede actuar. | Consulta el mensaje. |
| `INVALID_CHALLENGE` | 400 | El desafío MFA es desconocido o ha expirado. | Inicia uno nuevo. |
| `INVALID_CODE` | 401 | El código OTP o MFA es incorrecto. | Reintenta con el código actual. |
| `INVALID_CREDENTIALS` | 401 | Correo electrónico o contraseña incorrectos — deliberadamente no se especifica cuál. | Reintenta o restablece la contraseña. |
| `INVALID_TOKEN` | 400 | Un token de verificación, restablecimiento o magic link está malformado o es desconocido. | Solicita un enlace nuevo. |
| `LAST_ADMIN` | 403 | El cambio dejaría al proyecto sin ningún administrador. | Promueve a otra persona primero. |
| `MFA_REQUIRED` | 401 | La contraseña fue correcta y la cuenta tiene un segundo factor verificado, por lo que el inicio de sesión solo se ha completado a medias. `details` contiene un token de corta duración delimitado al desafío MFA — no es una sesión. | Abre un desafío y respóndelo; la respuesta al desafío emite la sesión. |
| `NO_SESSION` | 401 | No se presentó ninguna cookie de sesión ni token de actualización. Normal en la primera carga de página. | Inicia sesión. |
| `NOT_ANONYMOUS` | 400 | Una cuenta real llamó a una ruta de actualización desde usuario anónimo. | Nada que actualizar. |
| `OAUTH_ERROR` | 401 | El proveedor de OAuth rechazó la solicitud o devolvió un error. | Reintenta el flujo; el mensaje contiene el motivo del proveedor. |
| `RATE_LIMITED` | 429 | Demasiados intentos desde este cliente. | Espera antes de reintentar; el mensaje indica cuánto tiempo. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | El destino de redirección no está en la lista de permitidos. | Agrégalo a la configuración del proveedor. |
| `REGISTRATION_DISABLED` | 403 | El registro de autoservicio está desactivado. | Haz que un administrador cree la cuenta. |
| `ROLE_EXISTS` | 409 | Ese nombre de rol ya está en uso. | Elige otro nombre. |
| `ROLE_LOOKUP_FAILED` | 503 | No se pudieron leer los roles para una solicitud restringida a administradores. Falla de forma cerrada en lugar de confiar en el claim del propio token. | Reintenta; verifica la base de datos. |
| `SELF_DELETE` | 400 | Un administrador intentó eliminar su propia cuenta. | Haz que otro administrador lo haga. |
| `SESSION_REVOKED` | 401 | Se cerró la sesión en otro lugar o se revocaron todas las sesiones. | Inicia sesión de nuevo. |
| `SETUP_REQUIRED` | 403 | El proyecto aún no tiene administrador, por lo que esta ruta no está disponible. | Completa la configuración del primer administrador. |
| `TOKEN_ALREADY_USED` | 401 | Se reutilizó un token de un solo uso. | Solicita uno nuevo. |
| `TOKEN_EXPIRED` | 401 | El token ha superado su tiempo de vida. | Solicita uno nuevo. |
| `USER_NOT_FOUND` | 404 | No existe ninguna cuenta con ese id. | Verifica el id. |
| `WEAK_PASSWORD` | 400 | La contraseña no cumple con la política configurada. | Elige una más segura. |

## Datos, consultas y escrituras

| Código | Estado | Significado | Acción |
| --- | --- | --- | --- |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Este driver no puede calcular el agregado solicitado. | Utiliza un driver que pueda hacerlo o calcúlalo en el cliente. |
| `BRANCHING_UNSUPPORTED` | — | Se solicitó una rama de base de datos a través del WebSocket de Studio en la base de datos de desarrollo administrada (PGlite), donde una rama *es* el elemento principal y nada quedaría aislado. El rechazo es el mismo que imprime `rebase db branch`. | Apunta `DATABASE_URL` a una instancia propia de Postgres (`rebase dev --docker` inicia una) y crea la rama allí. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` contiene más operaciones que el límite por lote (1000 por defecto). Un lote es una sola transacción y mantiene sus bloqueos durante toda su ejecución. | Envíalo en fragmentos; el mensaje indica el límite y tu cantidad. |
| `BATCH_UNSUPPORTED` | 400 | El driver de este backend no puede escribir entre colecciones de forma atómica, y un bucle de escrituras individuales no sería atómico ni de un solo viaje de ida y vuelta (*round trip*). | Envía las escrituras como solicitudes separadas o como llamadas `/bulk` por colección. |
| `BULK_TOO_LARGE` | 400 | El cuerpo de la operación masiva excede el límite de elementos configurado. | Divide la solicitud. |
| `BULK_UNSUPPORTED` | 400 | Esta colección o driver no admite escrituras masivas. | Escribe las filas una por una. |
| `CALLBACK_REJECTED` | 400 | Un callback de colección rechazó la escritura. Un `throw` desde `beforeSave`/`beforeDelete`/`after*` es un 400 que incluye el propio mensaje del autor; un `beforeDelete` que devuelve `false` es un 403. `details.stage` indica qué callback, `details.path` la colección. | Lee el mensaje — fue redactado por este proyecto, no por Rebase. |
| `CURSOR_WITH_OFFSET` | 400 | Se combinó `?after=` con `?offset=` o `?page=`. Un cursor ya indica dónde comienza la página, por lo que un desplazamiento sobre él omite silenciosamente esa cantidad de filas más allá del cursor — un salto que el cliente no puede ver en la respuesta. | Usa uno u otro. |
| `DISTINCT_NOT_APPLICABLE` | 400 | Se combinó `?distinct=true` con una consulta de búsqueda o vectorial. Ambas adjuntan una puntuación por fila, por lo que nunca hay dos filas iguales y `DISTINCT` no colapsaría nada — parecería haber funcionado pero no cambiaría nada. | Elimina uno de los dos. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Una lectura `distinct` está ordenada por una columna que no devuelve. Un `SELECT DISTINCT` solo se puede ordenar por columnas presentes en su lista de selección, o de lo contrario las filas que colapsa no tendrían un orden definido. `details.fields` las nombra. | Agrega esos campos a `?fields=` o elimínalos de `?orderBy=`. |
| `DB_PERMISSION_DENIED` | 500 | Postgres rechazó la sentencia (`42501`): ya sea una política de seguridad a nivel de fila que deniega este rol o un `GRANT` faltante. | Consulta [Solución de problemas](/docs/troubleshooting/). |
| `FIELD_NOT_READABLE` | 400 | Un filtro, `orderBy`, `fields`, `select` de agregación o `groupBy` nombra un campo que los roles de este cliente no pueden leer (`access.read`). Un campo que ninguna respuesta puede incluir debe ser uno que ninguna consulta pueda interrogar, o de lo contrario el valor sería legible predicado por predicado. `details.violations` nombra cada campo. | Elimina el campo de la consulta u obtén el rol necesario. Consulta [Acceso a campos](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 | El cuerpo establece un campo que los roles de este cliente no pueden escribir (`access.write`). Se rechaza en lugar de descartarse: una escritura que descarte un campo reportaría éxito para una edición que no ocurrió. `details.violations` nombra cada campo. | Elimina el campo u obtén el rol necesario. Un campo que nadie puede escribir responde con `VALIDATION_EXCLUDED_FIELDS` en su lugar. |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Una solicitud anterior con la misma `Idempotency-Key` todavía se está ejecutando. | Reintenta una vez que finalice. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | Llegó la misma `Idempotency-Key` con un cuerpo diferente. | Usa una nueva clave o envía el cuerpo original. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` especificó una función que no es `count`, `sum`, `avg`, `min` o `max`. | Utiliza una de esas; el mensaje las enumera. |
| `INVALID_AGGREGATE_SELECT` | 400 | Una entrada de `?select=` no es `fn(campo)`, o se proporcionó una función distinta de `count()` sin campo. | Escribe `sum(total)`, `count()`, `avg(score)`. |
| `INVALID_BATCH_BODY` | 400 | Una operación de `/_batch` carece de `op`, `collection`, `values` o `id`, nombra una colección que este backend no sirve o reutiliza un nombre de `ref`. | Consulta el mensaje; identifica la operación por su índice. |
| `INVALID_BATCH_REF` | 400 | Un `{ "$ref": "<name>.<field>" }` no hace referencia a ninguna operación previa, apunta hacia adelante o solicita un campo que la fila referenciada no tiene. Solo se resuelven referencias hacia atrás. | Nombra la operación con `ref` *antes* de referenciarla. |
| `INVALID_BULK_BODY` | 400 | El cuerpo de la operación masiva no tiene el formato esperado. | Envía el arreglo `items` documentado. |
| `INVALID_CONFLICT_TARGET` | 400 | El `on_conflict` / `onConflict` de un upsert nombra columnas sin garantía de unicidad, o las nombra sin `upsert: true`. De lo contrario, Postgres respondería con 42P10 desde dentro de una transacción que ya ha realizado trabajo. | Declara `validation: { unique: true }` o un índice `unique`; el mensaje enumera los destinos que sí existen. |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` no es ni `include` ni `only`. Se rechaza en lugar de ignorarse: un `?deleted=true` mal escrito que ocultara silenciosamente todas las filas eliminadas parecería funcionar y respondería a la pregunta opuesta. | Envía `include` (activas y eliminadas) u `only` (solo eliminadas). Omítelo para obtener solo filas activas. |
| `INVALID_DISTINCT` | 400 | `?distinct=` no es `true` ni `false`. | Envía uno de esos; también se aceptan `1` y `0`. |
| `INVALID_FIELD_OPERATION` | 400 | Se utilizó un `$inc` / `$push` / `$pull` / `$merge` en un tipo de propiedad para el cual no está definido, con un operando de estructura incorrecta, con dos operadores en un mismo campo, mal escrito o en una creación (donde no hay un valor almacenado sobre el cual operar). | Consulta [Escritura a través de REST](/docs/backend/writes/#field-operations); el mensaje nombra el campo. |
| `INVALID_FILTER_FIELD` | 400 | El filtro nombra una propiedad que esta colección no tiene. | Comprueba la ortografía con la colección. |
| `INVALID_FILTER_OPERATOR` | 400 | El operador no es admitido por este tipo de propiedad. | Consulta [Consultar datos](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | Un valor de filtro no se puede interpretar como el tipo de la columna con la que se comparó: `?id=eq.abc` en una clave entera, una etiqueta que no está en el enum, una marca de tiempo que no lo es, un número fuera del rango del tipo. `details.dbCode` contiene el SQLSTATE. | Envía un valor del tipo de la columna. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` no es `true` ni `false`. Cualquier otro valor se rechaza en lugar de interpretarse como "no" — una errata que haga un soft-delete cuando el cliente pidió purgar deja al cliente creyendo que los datos se eliminaron. | Envía `true` o `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` está malformado: no es una lista de rutas válida o está anidado más allá de la profundidad máxima. Se responde en el límite de la API en lugar de escapar del driver como un 500. | Consulta el mensaje; nombra la ruta infractora. |
| `INVALID_INPUT` | 400 | El cuerpo no pasó la validación. | Consulta el mensaje. |
| `INVALID_LIMIT` | — | Una suscripción en tiempo real solicitó un límite fuera del rango permitido. Se entrega como un marco `ERROR` de WebSocket, no como una respuesta HTTP. | Reduce el límite. |
| `INVALID_LOGICAL_GROUP` | 400 | Un grupo `?or=` / `?and=` está malformado o anidado más allá de la profundidad permitida. | Consulta el mensaje; muestra la regla de aplanamiento. |
| `INVALID_OFFSET` | 400 | `?offset=` no es un número entero mayor o igual a 0. | Envía un entero no negativo. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` no es `field`, `field:desc` ni un arreglo JSON de `{ field, direction }`. | Consulta el mensaje; muestra las tres variantes sintácticas. |
| `INVALID_PAGE` | 400 | `?page=` no es un número entero mayor o igual a 1. Las páginas están basadas en 1, por lo que `?page=0` es un error y no la primera página. | Envía `1` o superior, o utiliza `?offset=`. |
| `INVALID_PARAM` | 400 | Un parámetro de consulta está malformado. | Consulta el mensaje. |
| `INVALID_VECTOR` | 400 | `?vector=` no es un arreglo JSON de números. | Envía `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` no es `cosine`, `l2` ni `inner_product`. | Utiliza uno de esos tres. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` no es un número. | Envía un número. |
| `INVALID_WHERE` | 400 | `?where=` no es un objeto JSON que asocie campos con condiciones. | Envía `{"status":["==","active"]}`. |
| `MISSING_AGGREGATE_SELECT` | 400 | Se llamó a la ruta de agregación sin `?select=`. | Agrega uno, ej. `?select=count()`. |
| `NO_COLLECTIONS` | 404 | El proyecto no sirve ninguna colección: ninguna declarada en código y ninguna tabla de la que derivarlas. | Crea tablas —mediante una migración, SQL o un archivo de colección más `rebase db push`— y reinicia. |
| `NOT_FOUND` | 404 | No existe ninguna fila con ese id en esa colección — o la seguridad a nivel de fila la oculta para este cliente. | Comprueba el id y luego las `securityRules` de la colección. |
| `UNKNOWN_RELATION` | 400 | `?include=` nombra algo que no es una relación en la colección. El mismo código responde **404** cuando es una *ruta de URL* anidada la que la nombra, ej. `/api/data/authors/1/posts` donde `authors` no declara ninguna — allí la URL no nombra nada, por lo que es un recurso no encontrado en lugar de una solicitud malformada. | Comprueba el nombre de la relación — el mensaje enumera las que tiene la colección. Una referencia inversa debe declararse en el elemento principal para que sea navegable. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | El ordenamiento nombra una propiedad que no admite ordenamiento. | Ordena por una propiedad respaldada por una columna. |
| `PAYLOAD_TOO_LARGE` | 413 | El cuerpo excede el límite configurado. | Envía menos datos o aumenta el límite. |
| `READ_ONLY_TRANSACTION` | 409 | Un callback `afterRead` intentó escribir. Una lectura en el ámbito de la solicitud se ejecuta en una transacción `READ ONLY`, por lo que ni el callback ni nada a lo que llame puede escribir. | Traslada la escritura fuera de la lectura: un trabajo en segundo plano (*background job*), o `rebase.dataAsAdmin` desde un cron job o una función personalizada. |
| `RELATION_MISCONFIGURED` | 500 | Una relación no se resuelve contra el esquema registrado. La operación se rechaza en lugar de omitirse: descartarla reportaría éxito para una escritura que nunca ocurrió, o vacío para filas que sí existen. | Ejecuta `rebase schema generate` si el esquema generado es más antiguo que la base de datos. |
| `RELATION_NOT_UNLINKABLE` | 400 | La relación no se puede desvincular desde este lado. | Escribe desde el lado propietario. |
| `RELATION_NOT_WRITABLE` | 400 | La ruta anidada no es una relación de escritura. | Consulta [Relaciones](/docs/collections/relations/). |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Una escritura de relación no tenía clave de origen en la que vincular el enlace. | Guarda la fila principal primero. |
| `SCHEMA_DRIFT` | 500 | Una tabla o columna que el código espera no existe en la base de datos. | Ejecuta `rebase db push` en desarrollo; redespliega en un tenant administrado. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | Se combinó `startAfter` con `orderBy: "_score"`. La relevancia se calcula por consulta en lugar de almacenarse, por lo que no puede servir de clave para un cursor. | Pagina la relevancia con `limit`/`offset` u ordena por una columna. |
| `TENANT_IMMUTABLE` | 400 | Una escritura movería una fila de un tenant a otro. Una fila no puede cambiar de tenant. `details.violations` nombra el campo. | Crea la fila en el otro tenant y elimina esta, o escribe con un rol en `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | La escritura especifica un tenant al que este cliente no pertenece; la base de datos también la rechazaría. | Escribe en un tenant al que pertenezca el cliente o autentícate como alguien que pertenezca a él. |
| `TENANT_REQUIRED` | 400 | La colección está delimitada por tenant y este no se puede inferir: la solicitud no incluye ninguno o el cliente pertenece a varios. | Envía el campo de tenant explícitamente o autentícate como un cliente que pertenezca exactamente a uno. |
| `UNKNOWN_FIELD` | 400 | `?fields=` nombra un campo que la colección no tiene. | Comprueba la ortografía; el mensaje enumera los campos válidos. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Un agregado o `groupBy` nombra un campo que la colección no tiene. | Comprueba la ortografía; el mensaje enumera los campos válidos. |
| `UNKNOWN_FILTER_FIELD` | 400 | El filtro nombra un campo que esta colección —o el destino de una relación— no tiene. | Comprueba la ortografía; el mensaje enumera los campos válidos. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | El filtro nombra un operador que no existe. | El mensaje enumera todos los operadores. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | El ordenamiento nombra un campo que esta colección no tiene. | Comprueba la ortografía; el mensaje enumera los campos válidos. |
| `PRECONDITION_FAILED` | 412 | Un encabezado `If-Match` nombró una versión de la fila que ya no está vigente: alguien escribió en ella entre la lectura y esta escritura. No se escribió nada. | Vuelve a leer la fila, vuelve a aplicar el cambio y envía el nuevo `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` solicita un campo que la colección no tiene. | Comprueba la ortografía; el mensaje enumera los campos conocidos. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Una búsqueda vectorial nombró una propiedad que no es de tipo `vector` en esta colección. | El mensaje enumera las propiedades de tipo vector de la colección. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | El `Content-Type` no es admitido por esta ruta. | Envía el tipo documentado para la ruta. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | El filtro cruza una relación `via`, cuya ruta de unión está definida en un solo sentido, por lo que no hay forma de correlacionar una subconsulta de vuelta. | Filtra desde el lado propietario. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | El operador no está definido para ese campo: una relación sin columna en esta fila se filtra por pertenencia, y la coincidencia no sensible a mayúsculas/minúsculas solo aplica a texto. | Consulta el mensaje; enumera lo que acepta el campo. |
| `VALIDATION_CONSTRAINT` | 400 | Un valor infringió una regla de `validation` declarada en la propiedad — una longitud, un rango, un patrón, un campo obligatorio. | Consulta el mensaje; nombra cada infracción. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | El cuerpo escribe en una columna marcada con `excludeFromApi` o `access: { write: [] }` — la misma regla, dos formas de escribirla. Son del servidor para establecer: un hash de contraseña, un token de verificación. A diferencia de `FIELD_NOT_WRITABLE`, esta es la misma respuesta para todos los clientes, incluido `admin`. | Elimina el campo. Consulta [Acceso a campos](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Un valor no se ajusta a su tipo de propiedad. | Consulta el mensaje; nombra la propiedad. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | El cuerpo nombra un campo que la colección no tiene — incluyendo un argumento `id` en una colección indexada por otra cosa. | Comprueba la ortografía; el mensaje enumera los campos conocidos. |
| `WRITE_DENIED` | 403 | Una regla de seguridad o una política de seguridad a nivel de fila rechazó la escritura. | Revisa las `securityRules` de la colección. |

## `PG_<SQLSTATE>` — una restricción rechazada por la base de datos

Una escritura que Postgres rechaza por una razón atribuible a *los datos del cliente* responde con el SQLSTATE en el código: `PG_23505`, `PG_23503`, y así sucesivamente. Se trata de una familia, no de una lista fija —Postgres define cientos de SQLSTATEs—, pero solo dos clases llegan a utilizarse, ya que solo esas dos son responsabilidad del cliente:

- **clase 23**, infracción de restricción de integridad (*integrity constraint violation*): un duplicado, una clave foránea que apunta a la nada, una columna NOT NULL dejada vacía;
- **clase 22**, excepción de datos (*data exception*): un valor que el tipo de la columna no puede almacenar.

Todo lo demás —una conexión caída, una columna faltante, un problema de privilegios— es problema del servidor y se mantiene como un `500`. Por lo tanto, `code.startsWith("PG_")` es una comprobación segura para «la fila que envié era incorrecta», y los cuatro siguientes son los que un cliente encuentra en la práctica. `details.dbCode` contiene el mismo SQLSTATE para todos ellos, y el mensaje nombra la restricción.

| Código | Estado | Significado | Acción |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | No se pudo leer un valor como el tipo de la columna — el gemelo del lado de escritura de `INVALID_FILTER_VALUE`. | Envía un valor del tipo de la columna. |
| `PG_23502` | 400 | Se dejó vacía una columna `NOT NULL`. | Envía el campo o asigna un valor predeterminado a la columna. |
| `PG_23503` | 400 | Una clave foránea apunta a una fila que no existe. | Crea la fila de destino primero o corrige el id. |
| `PG_23505` | 409 | Se infringió una restricción de unicidad. El mensaje nombra la restricción. | Usa un valor diferente o actualiza la fila existente. |

## Storage

| Código | Estado | Significado | Acción |
| --- | --- | --- | --- |
| `INVALID_STORAGE_BUCKET` | 400 | El nombre del bucket está malformado. | Comprueba el nombre. |
| `INVALID_STORAGE_KEY` | 400 | La clave del objeto está malformada o escapa de su prefijo. | Comprueba la clave. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | Los parámetros de transformación de imagen están fuera de rango o son contradictorios. | Consulta [Storage](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | La subida excede el `maxSize` declarado por la propiedad de destino. Se valida en el servidor, no solo en el navegador. `details` contiene la propiedad, el límite y el tamaño real. | Sube un archivo más pequeño o aumenta `maxSize` en la propiedad. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | El tipo del archivo subido no está en `acceptedFiles` de la propiedad. `details` contiene la propiedad, la lista aceptada y el tipo de contenido enviado. | Sube un tipo aceptado o amplía `acceptedFiles`. |
| `STORAGE_NOT_CONFIGURED` | 503 | No hay ningún backend de almacenamiento configurado en este servidor. | Configura S3, GCS o almacenamiento local. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | El origen de almacenamiento está declarado pero no tiene credenciales aquí. | Establece las variables de entorno de ese origen. |
| `STORAGE_WRITE_FAILED` | 502 | El backend de almacenamiento rechazó o interrumpió la escritura. | Revisa sus propios logs y credenciales. |
| `TRANSFORM_OVERLOADED` | 503 | Hay demasiadas transformaciones de imagen en curso. | Reintenta; considera colocar una CDN delante. |
| `UNKNOWN_STORAGE_SOURCE` | 400 | La solicitud especificó un origen de almacenamiento (`?storageId=`) que este proyecto no declara. Un `bucket` que este despliegue no sirve devuelve el mismo código en **404** —lo que falta es el almacén—, y `details` nombra los buckets y los orígenes que sí existen. Anteriormente ambos se devolvían como "archivo no encontrado", idéntico a una clave que simplemente está ausente. | Declara el origen en `config/resources.ts` o consulta `GET /api/storage/sources`. |

## Funciones personalizadas

| Código | Estado | Significado | Acción |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | No se sirve ninguna función con ese nombre — o existe una pero sus propias rutas no cubren la ruta posterior. A un cliente autenticado también se le informa qué *está* disponible; a uno anónimo no, ya que esa lista es un inventario de todos los endpoints personalizados. Cuando un archivo con ese nombre no pudo cargarse, el mensaje lo indica: esa es la diferencia entre un error tipográfico y un despliegue defectuoso. | Comprueba el nombre contra `GET /api/functions` o revisa el log de arranque en busca de un archivo que no se haya cargado. |
| `FUNCTION_TIMEOUT` | 504 | El controlador (handler) superó su tiempo de espera (*timeout*). Todavía se está ejecutando; no se puede cancelar desde aquí. | Proporciona un `AbortSignal` a las llamadas salientes o aumenta `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Este proceso redirige funciones como proxy a otro proceso, el cual no respondió. | Comprueba que la unidad de funciones esté en ejecución. |

## Superficies de administración y edición de esquemas

Estos indican que una característica está desactivada o no configurada, en lugar de que la solicitud fuera errónea. Cada uno también se reporta en la ruta `/status` correspondiente con un `200`, de modo que un panel pueda deshabilitar visualmente la función en gris en lugar de mostrar un error.

| Código | Estado | Significado | Acción |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | Se llamó a una superficie exclusiva de administradores en un servidor sin autenticación configurada, por lo que nada puede distinguir a un administrador de un desconocido. | Establece `auth.jwtSecret` o pasa un `AuthAdapter`. |
| `CONTRACT_UNAVAILABLE` | 404 | El contrato del proyecto solo se sirve cuando la autenticación está configurada — describe cada tabla y relación. | Configura auth. `/meta/schema-version` siempre se sirve. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | No hay ningún buzón de desarrollo activo. El correo solo se captura cuando `SMTP_HOST` no está definido y `NODE_ENV` no es producción. | Desasigna `SMTP_HOST` en desarrollo o consulta la bandeja de entrada real. |
| `INVALID_CHANGE` | 400 | El cambio de esquema propuesto no está bien formado. | Consulta el mensaje. |
| `SCHEMA_CHANGE_FAILED` | 400 | La aplicación de un cambio de esquema planificado falló por una razón no cubierta por códigos más específicos. | Consulta el mensaje; es el fallo subyacente textualmente. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | El cambio es válido pero no se puede aplicar al esquema en su estado actual. | Consulta el mensaje. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | El repositorio tiene cambios sin confirmar (*uncommitted*), por lo que la edición no pudo aplicarse de forma segura. | Haz commit o stash y luego reintenta. |
| `SCHEMA_EDIT_REFUSED` | 400 | El editor de esquemas rechazó la edición. | Consulta el mensaje; es el propio rechazo del editor. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Una clave de API u otra entidad de máquina intentó aplicar un cambio de esquema. | Inicia sesión como usuario o establece `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | La edición de esquemas en vivo requiere `collectionsDir` o `liveSchema.repository`, y este servidor se inició sin ninguno de ellos. | Configura uno. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | La planificación funciona; no hay repositorio en el que hacer commit del cambio. | Configura `liveSchema.repository`. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Este driver no puede planificar cambios de esquema. | La edición en vivo está disponible en Postgres. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | Las colecciones se introspeccionan desde la base de datos aquí, por lo que no hay archivos fuente para editar. | Modifica el esquema mediante una migración. |
| `SCHEMA_EDITOR_DISABLED` | 501 | El editor de esquemas está desactivado para este servidor. | Actívalo con `schemaEditor`. |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | El editor de esquemas necesita `ts-morph`, que no está instalado. | `pnpm add -D ts-morph@28.0.0`. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | El servidor no tiene `collectionsDir`, por lo que el editor no tiene dónde escribir. | Establece `collectionsDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | El editor está desactivado bajo `NODE_ENV=production`: los archivos de un servidor desplegado se reconstruyen desde tu repositorio en cada despliegue, por lo que una edición aquí se descartaría. | Edita las colecciones en desarrollo y despliega. |

## Códigos genéricos

Una ruta utiliza uno de estos cuando no aplica nada más específico.

| Código | Estado | Significado | Acción |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Malformada, y nada más específico aplica. | Consulta el mensaje. |
| `UNAUTHORIZED` | 401 | No autenticado, o la credencial fue rechazada. | Inicia sesión o renueva el token. |
| `FORBIDDEN` | 403 | Autenticado, pero no autorizado. | Reintentar con la misma identidad no servirá. |
| `CONFLICT` | 409 | Un conflicto con el estado existente. | Consulta el mensaje. |
| `INTERNAL_ERROR` | 500 | Algo falló en el servidor. El mensaje es genérico a propósito. | Cita el `requestId`; la causa está en los logs. |
| `NOT_CONFIGURED` | 503 | Una dependencia requerida por esta ruta no está configurada en este servidor. | Consulta el mensaje. |
| `SERVICE_UNAVAILABLE` | 503 | Una dependencia no estaba accesible. | Reintenta; revisa los logs. |

## Cómo mantener esta página actualizada

`pnpm verify:docs` falla cuando falta en estas tablas un código que el servidor puede emitir, cuando una tabla lista un código que nada puede emitir, cuando un estado indicado discrepa del código fuente, o cuando una familia de códigos como `PG_<SQLSTATE>` no tiene una fila para un SQLSTATE con el que se topan los clientes. El paso (*stage*) es `tooling/scripts/docs-verify/check-error-codes.mjs`.

Se verifica a sí mismo primero. El escaneo lee los códigos directamente de TypeScript en lugar de hacerlo desde un servidor en ejecución, por lo que sus puntos ciegos son silenciosos por diseño: en una ocasión no pudo detectar un código pasado a través de un contenedor (*wrapper*) de una sola línea, o uno escrito después de un mensaje que contenía un `)`, y reportó que «todos los códigos que el servidor puede emitir están documentados» en una página a la que le faltaban diecisiete de ellos. Por ello, este paso ejecuta un *fixture* con exactamente esas estructuras antes de leer esta página, y se niega a reportar nada si no puede detectarlas.

---
