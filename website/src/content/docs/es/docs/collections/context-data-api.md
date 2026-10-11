---
sourceHash: f5cc00d6f5f3e4c3
title: La API context.data
sidebar_label: API context.data
description: Lee y escribe otras colecciones desde un callback con context.data — sus métodos, los privilegios con los que se ejecuta, la semántica transaccional y la conexión que ocupa un callback.
---

Cada callback recibe un objeto `context` que incluye `context.data` — una capa unificada de acceso a datos para realizar **operaciones entre colecciones** desde los hooks de ciclo de vida.

## Acceso a colecciones

`context.data` utiliza un Proxy de JavaScript, por lo que puedes acceder a cualquier colección mediante su slug como propiedad:

```typescript
afterSave: async ({ values, id, context }) => {
    // Dynamic property access — works for any collection slug
    const jobs = context.data.jobs;
    const users = context.data.users;

    // Alternatively, use the .collection() method for dynamic slugs
    const collectionName = "jobs";
    const accessor = context.data.collection(collectionName);
}
```

## Métodos disponibles

Cada descriptor de acceso a la colección (`context.data.<slug>`) proporciona estos métodos:

| Método | Firma | Descripción |
|--------|-----------|-------------|
| `.find()` | `find(params?: FindParams) → FindResponse` | Consulta entidades con filtros, ordenación y paginación |
| `.findById()` | `findById(id: string \| number) → Entity \| undefined` | Obtiene una sola entidad por ID |
| `.create()` | `create(data: Partial<Values>, id?: string) → Entity` | Crea una nueva entidad |
| `.update()` | `update(id: string \| number, data: Partial<Values>) → Entity` | Actualiza una entidad existente |
| `.delete()` | `delete(id: string \| number) → void` | Elimina un registro |
| `.count()` | `count(params?: FindParams) → number` | Cuenta las entidades que coinciden |
| `.listen()` | `listen(params, onUpdate, onError?) → unsubscribe` | Suscripción en tiempo real (donde sea compatible) |
| `.listenById()` | `listenById(id, onUpdate, onError?) → unsubscribe` | Escucha una sola entidad |

## Consultar con `.find()`

El método `find()` filtra con tuplas `[operator, value]` — la forma tipada de
la cadena de consulta `?status=eq.published` que lee la API REST:

```typescript
afterSave: async ({ values, context }) => {
    // Equality
    const { data: activeJobs } = await context.data.jobs.find({
        where: { status: ["==", "published"] },
        limit: 10,
        orderBy: ["createdAt", "desc"]
    });

    // Several conditions, AND-ed
    const { data: expensiveJobs } = await context.data.jobs.find({
        where: {
            salary: [">=", 100000],
            role: ["in", ["admin", "manager"]]
        }
    });
}
```

## Crear entidades

`.create()` y `.update()` toman los valores a escribir, con las firmas de
arriba. [Sincronización de datos entre colecciones](/docs/collections/callbacks#syncing-data-between-collections)
usa ambos: una propuesta aprobada crea un puesto publicado y queda enlazada a
él.

## Seguridad: con qué privilegios se ejecuta `context.data`

:::important
**`context.data` hereda los privilegios de lo que haya activado el callback.** No es un nivel de confianza fijo.

- Activado por una **solicitud de usuario** (REST, tiempo real, una edición en el panel de administración) → **con alcance de usuario**. El callback se ejecuta dentro de la transacción vinculada a RLS abierta para esa solicitud, por lo que las políticas se aplican tanto a lecturas *como* a escrituras. Un callback no puede ver una fila que quien llama no pueda ver.
- Activado por **`rebase.dataAsAdmin` o un cron job** (el mismo singleton) → **con alcance de administrador**, no sin alcance. Ese driver tiene un alcance establecido como `{ uid: "service", roles: ["admin"] }`, por lo que el callback todavía se ejecuta en una transacción vinculada a RLS — tus políticas se evalúan contra esa identidad.
- Activado por **el driver base** (flujos de autenticación integrados, migraciones) → **sin alcance**. Se ejecuta en la conexión del propietario y omite RLS.
:::

Esto importa más en la dirección que falla silenciosamente. RLS *filtra*, no genera excepciones — por lo que un callback que lee una fila hermana la encontrará cuando una tarea de administrador guarde y puede que no encuentre nada cuando un usuario final guarde, sin errores en ningún caso. Escribe callbacks que toleren un resultado vacío, o recurre al plano de administración deliberadamente:

```typescript
afterSave: async ({ context }) => {
    // User-scoped when a user triggered this save: RLS applies.
    await context.data.audit_logs.create({ action: "approved" });

    // Deliberately admin-scoped — for work the caller genuinely may not see,
    // such as an audit trail they must not be able to read or edit. Note this
    // is an admin's reach, not a bypass: a collection whose only rule is
    // `policy.serverContext()` stays closed to it, since that compiles to
    // `rebase.uid() IS NULL` and this accessor's uid is `service`.
    // `dataAsAdmin` is always there server-side; its type allows for the
    // browser SDK, which has none — hence the `!`.
    await context.client.dataAsAdmin!.audit_logs.create({ action: "approved" });
}
```

:::caution[`dataAsAdmin` es una segunda conexión, no parte de esta escritura]
En Postgres, `context.client.dataAsAdmin` dentro del callback de una solicitud se ejecuta en una transacción propia, en otra conexión del pool, mientras la transacción de la escritura desencadenante sigue abierta. Así que se confirma por su cuenta, y permanece si la escritura se revierte. Tampoco puede ver la fila que se está guardando, que todavía no se ha confirmado, y no debe escribirla:

- Una escritura de administrador con una clave foránea de vuelta a esa fila (un `audit_logs.article_id` que referencia `articles`) falla en la comprobación de la clave, y la escritura de quien llama falla con ella.
- Una escritura de administrador en la fila que se está guardando, o en cualquier fila que esta escritura haya bloqueado, espera al bloqueo de la escritura mientras la escritura espera al callback. Postgres no puede verlo como un interbloqueo (deadlock), así que la solicitud se queda colgada hasta `statement_timeout` (30 segundos por defecto) y luego falla.

Para un registro que tenga que referenciar la fila, escríbelo con `context.data`, que va en la transacción de la escritura, o encola un [job](/docs/backend/jobs): un job encolado desde el callback se confirma con la escritura, y su handler se ejecuta después del commit.
:::

:::caution[Esta página solía decir lo contrario]
Las versiones anteriores de esta página indicaban que los callbacks siempre omitían RLS y tenían "acceso completo a la base de datos independientemente de los permisos del usuario que los activaba". Eso era incorrecto, e incorrecto en el sentido inseguro — invitaba a escribir callbacks asumiendo que siempre podrían ver todo.

El comportamiento anterior está verificado de extremo a extremo en Postgres mediante el caso `"scopes context.data to the caller when a callback runs on a user request"` en la suite de aplicación de RLS de `@rebasepro/server-postgres`.
:::

## Semántica de transacciones

:::important
**Las escrituras con `context.data` de un callback forman parte de la escritura que lo activó.** En Postgres, `beforeSave`, el guardado y `afterSave` — o `beforeDelete`, la eliminación y `afterDelete` — se ejecutan dentro de una sola transacción, esperando a cada callback antes del commit, y `context.data` escribe a través de esa misma transacción.
:::

Por lo tanto, la escritura desencadenante y todo lo que escribieron sus callbacks se confirman juntos o no se confirma nada:

- Lanzar un error desde `afterSave` o `afterDelete` revierte la escritura desencadenante, junto con cada escritura de `context.data` que hicieron los callbacks. A quien llama se le responde **400 `CALLBACK_REJECTED`** con `details.stage` indicando el hook — o con el propio estado del error cuando lleva uno: un `RebaseApiError` que hayas lanzado, el 409 de una infracción de unicidad.
- Los suscriptores en tiempo real se enteran de la fila solo después del commit, por lo que una escritura que se revirtió nunca se anuncia.
- Un callback mantiene la transacción abierta mientras se ejecuta, por lo que uno lento representa un bloqueo retenido y una conexión del pool ocupada — `beforeSave` y `beforeDelete` tanto como los hooks `after`. Consulta [Un callback retiene una conexión](#un-callback-retiene-una-conexión).
- Una escritura de `context.data` también ejecuta los callbacks de la colección destino, así que un `afterSave` que actualiza su propia fila se ejecuta de nuevo a sí mismo. Las escrituras anidadas a más de 16 niveles de profundidad se rechazan con **500 `CALLBACK_RECURSION`**, nombrando el hook y la colección, y toda la escritura se revierte. Haz que una escritura así sea condicional, como hace el ejemplo de más abajo.

Deja que un fallo lance un error cuando la escritura desencadenante no deba sobrevivir a él. Captúralo cuando sí deba, pero solo en torno a una **escritura** de `context.data`: un create, update o delete que la base de datos rechace (una infracción de clave única o foránea, un trigger) se deshace por sí solo y el resto se confirma.

Cualquier otra sentencia que falle en la transacción de la escritura — una consulta, la lectura que hace un update o un delete para encontrar su fila (un id que la columna clave no puede contener), un encolado de job que la base de datos rechazó — aborta esa transacción en Postgres, y capturar el error en JavaScript no lo deshace. La escritura se rechaza con **500 `TRANSACTION_ABORTED`** y no se almacena nada, en lugar de responder con éxito a una escritura que se revirtió. Deja que ese fallo lance un error, o comprueba la condición antes de ejecutar la sentencia.

```typescript
afterSave: async ({ values, id, status, context }) => {
    // The update below saves this collection again, which runs this callback
    // again: act on creates only, or it never stops.
    if (status !== "new") return;
    try {
        await context.data.jobs.create({ title: values.title, status: "published" });
    } catch (error) {
        // Only the failed create is undone. The submission and this marker commit.
        await context.data.job_submissions.update(id, {
            promotion_status: "failed",
            promotion_error: String(error)
        });
    }
}
```

El trabajo que deba salir de la base de datos — un correo electrónico, un webhook, una llamada a una API de terceros — no pertenece al cuerpo del callback. Mantendría la transacción abierta durante un viaje de ida y vuelta por la red, y nada puede revertirlo cuando la escritura se revierte. Ponlo en cola en un [job](/docs/backend/jobs), o hazlo después de que la escritura retorne: publica en un [canal en tiempo real](/docs/backend/realtime), o usa `waitUntil` en una [función personalizada](/docs/backend/custom-functions). La sección de [hooks](/docs/backend/hooks#side-effects-that-must-not-hold-the-transaction) indica cuál se adapta mejor.

En MongoDB nada de esto aplica. Ese driver ejecuta los mismos callbacks sin transacción, por lo que la escritura ya está almacenada cuando se ejecuta `afterSave`, y lanzar un error allí informa del fallo sin deshacerlo.

## Un callback retiene una conexión

En Postgres una escritura se ejecuta en una conexión sacada del pool de la base de datos,
y todos los callbacks se ejecutan en ella: `beforeSave` y `beforeDelete` una vez
iniciada la transacción, `afterSave` y `afterDelete` antes de que se confirme. Mientras
un callback se ejecuta — esperando una consulta, un cálculo, lo que sea — esa
conexión no atiende nada más, y los bloqueos que la escritura ha tomado siguen tomados:
en `afterSave`, la fila recién escrita; en una escritura masiva o [`_batch`](/docs/backend/writes/#cross-collection-batches),
todas las filas que la transacción escribió antes.

El coste es la propia duración del callback, y las escrituras concurrentes lo suman:

- El pool tiene 20 conexiones por defecto (`DB_POOL_MAX`). 25 guardados simultáneos
  cuyo `beforeSave` esperaba 300 ms hicieron que una lectura de una fila no relacionada tardara 290 ms,
  casi todo ello esperando una conexión.
- Una creación masiva de 100 filas cuyo `beforeSave` espera 50 ms es una transacción
  abierta durante 5,3 s, que retiene su conexión y los bloqueos de todas las filas escritas hasta
  ese momento durante todo ese tiempo.

Por tanto:

- Mantén fuera de los callbacks todo lo lento. Una llamada a otro servicio pertenece a un
  [job](/docs/backend/jobs), o a después de que la escritura devuelva.
- Busca lo que un hook necesita antes de la escritura cuando puedas — en el cliente, o
  en una [función personalizada](/docs/backend/custom-functions) que luego escriba.
- Envía las filas cuyos hooks son lentos en masas más pequeñas.
- Si muchos hooks lentos se ejecutan a la vez por diseño, sube `DB_POOL_MAX`, dentro de lo que
  permita el `max_connections` de la base de datos para todas las instancias.
- <span class="since-badge" data-since="0.25">Desde 0.25</span> Con
  `REBASE_METRICS=true`, `/metrics` informa `rebase_db_pool_wait_ms`: cuánto
  esperó cada consulta una conexión. Un pool sano lo mantiene cerca de cero; una cola
  que crece con el tráfico son solicitudes haciendo cola por conexiones que los callbacks
  retienen. Consulta [Métricas](/docs/deployment/self-hosting/#metrics).
