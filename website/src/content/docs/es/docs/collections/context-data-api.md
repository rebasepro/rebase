---
sourceHash: aaaaecaefd6bb6c4
title: La API context.data
sidebar_label: API context.data
description: Lee y escribe en otras tablas desde dentro de un hook de tabla con context.data — sus métodos, los privilegios con los que se ejecuta, la semántica de transacciones y la conexión que mantiene un hook.
---

Cada [hook de tabla](/docs/collections/callbacks/) recibe un objeto `context` que incluye `context.data`: la capa de datos para leer y escribir en **otras tablas** desde dentro del hook.

## Acceder a las tablas

`context.data` utiliza un Proxy de JavaScript, por lo que puedes acceder a cualquier tabla mediante su slug como una propiedad:

```typescript
afterSave: async ({ values, id, context }) => {
    // Dynamic property access — works for any table slug
    const jobs = context.data.jobs;
    const users = context.data.users;

    // Alternatively, use the .table() method for dynamic slugs
    const slug = "jobs";
    const accessor = context.data.table(slug);
}
```

Una propiedad es el accessor de la tabla, el nombre que el SDK generado le asigna:
`context.data.myNotes` es la tabla cuyo slug es `my-notes`, independientemente de la tabla
SQL en la que esté almacenada. Un nombre que no corresponda al accessor de ninguna tabla se interpreta en su forma
snake_case, por lo que `context.data.auditLog` es `audit_log`.

Las filas no tienen tipos (`Record<string, unknown>`) hasta que el proyecto registra su
`Database` generada; a partir de entonces, cada accessor se tipa a partir de ella. Consulta
[Datos tipados en el servidor](/docs/backend/typed-server-data).

## Métodos disponibles

Cada accessor de tabla (`context.data.<slug>`) proporciona estos métodos:

| Método | Firma | Descripción |
|--------|-----------|-------------|
| `.find()` | `find(params?: FindParams) → FindResult` | Consulta filas con filtros, ordenación y paginación |
| `.findById()` | `findById(id: string \| number) → Row \| undefined` | Obtiene una sola fila por ID |
| `.create()` | `create(data: Insert, id?: string \| number) → Row` | Crea una nueva fila y la devuelve tal como se almacenó |
| `.update()` | `update(id: string \| number, data: Update) → Row` | Actualiza una fila existente y la devuelve tal como se almacenó |
| `.delete()` | `delete(id: string \| number) → void` | Elimina un registro |
| `.count()` | `count(params?: FindParams) → number` | Cuenta las filas coincidentes |
| `.listen()` | `listen(params, onUpdate, onError?) → unsubscribe` | Suscripción en tiempo real (donde sea compatible) |
| `.listenById()` | `listenById(id, onUpdate, onError?) → unsubscribe` | Escucha una sola fila |
| `.trash` | `trash.find()`, `.count()`, `.restore(id)`, `.restoreMany(ids)`, `.purge(id)`, `.purgeMany(ids)` | Las filas marcadas por un [borrado suave](/docs/collections/soft-delete#from-the-sdk) |

### Límites conocidos en proceso

La misma superficie a través de HTTP (`@rebasepro/client`) hace algunas cosas que la versión en
proceso (`context.data`, `rebase.data`, `rebase.dataAsAdmin`) no hace.
Nada de esto es nuevo en 0.31:

- Una fila en proceso no contiene `_matches` de búsqueda ni versión: `etagOf(row)`
  es `undefined`, por lo que debes pasar `ifMatch` desde una fila que hayas leído a través de HTTP.
- `listenCount()` no está disponible en proceso: lanza "Realtime is not
  available".
- El atajo de tabla `.search(text)` no acepta `{ explain }` (el `.search` del constructor de consultas
  sí lo hace, pero en proceso no hay `_matches` que devolver).

## Consultar con `.find()`

El método `find()` filtra mediante tuplas `[operator, value]`, la forma tipada de
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

## Crear filas

`.create()` y `.update()` reciben los valores a escribir, con las firmas anteriores.
[Escribir en otras tablas](/docs/collections/callbacks/#writing-to-other-tables) utiliza ambos:
un envío aprobado crea un trabajo publicado y se vincula de vuelta a él.

## Seguridad: con qué privilegios se ejecuta `context.data`

:::important
**`context.data` hereda los privilegios de lo que haya activado el hook.** No es un nivel de confianza fijo.

- Activado por una **petición de usuario** (REST, tiempo real, una edición en el CMS) → **con alcance de usuario (user-scoped)**. El hook se ejecuta dentro de la transacción vinculada a RLS abierta para esa petición, por lo que las políticas se aplican tanto a lecturas *como* a escrituras. Un hook no puede ver una fila que quien lo invocó no pudiera ver.
- Activado por **`rebase.dataAsAdmin` o un cron job** (el mismo singleton) → **con alcance de administrador (admin-scoped)**, no sin alcance. Ese driver tiene el alcance `{ uid: "service", roles: ["admin"] }`, por lo que el hook aún se ejecuta en una transacción vinculada a RLS; tus políticas se evalúan contra esa identidad.
- Activado por **el driver base** (flujos de autenticación integrados, migraciones) → **sin alcance (unscoped)**. Se ejecuta en la conexión del propietario y omite RLS.
:::

Esto es especialmente importante en la dirección en la que falla silenciosamente. RLS *filtra*, no genera excepciones; por lo tanto, un hook que lee una fila hermana la encontrará cuando guarde una tarea de administrador y puede que no encuentre nada cuando guarde un usuario final, sin que se produzca ningún error en ningún caso. Escribe hooks que toleren un resultado vacío, o recurre deliberadamente al plano de administración:

```typescript
afterSave: async ({ context }) => {
    // User-scoped when a user triggered this save: RLS applies.
    await context.data.audit_logs.create({ action: "approved" });

    // Deliberately admin-scoped — for work the caller genuinely may not see,
    // such as an audit trail they must not be able to read or edit. Note this
    // is an admin's reach, not a bypass: a table whose only rule is
    // `policy.serverContext()` stays closed to it, since that compiles to
    // `rebase.uid() IS NULL` and this accessor's uid is `service`.
    // `dataAsAdmin` is always there server-side; its type allows for the
    // browser SDK, which has none — hence the `!`.
    await context.client.dataAsAdmin!.audit_logs.create({ action: "approved" });
}
```

:::caution[`dataAsAdmin` es una segunda conexión, no forma parte de esta escritura]
`context.client.dataAsAdmin` dentro del hook de una petición se ejecuta en una
transacción propia, en otra conexión del pool, mientras la transacción de la escritura
activadora todavía está abierta. Por lo tanto, se confirma por su cuenta y permanece si la
escritura se revierte. Además, no puede ver la fila que se está guardando, ya que aún no
se ha confirmado, y no debe escribir en ella:

- Una escritura de administrador con una clave foránea que apunte a esa fila (un `audit_logs.article_id`
  que hace referencia a `articles`) falla su comprobación de clave, y la escritura de quien invocó falla
  junto con ella.
- Una escritura de administrador en la fila que se está guardando, o en cualquier fila que esta escritura haya bloqueado,
  espera el bloqueo de la escritura mientras la escritura espera al hook. Postgres
  no puede identificar esto como un interbloqueo, por lo que la petición se congela hasta que se alcanza el `statement_timeout`
  (30 segundos por defecto) y luego falla.

Para un registro que deba hacer referencia a la fila, escríbelo con `context.data`, el cual
aprovecha la transacción de la escritura, o encola un [trabajo](/docs/backend/jobs): un trabajo
encolado desde el hook se confirma con la escritura, y su manejador se ejecuta después de
la confirmación.
:::

:::caution[Esta página solía decir lo contrario]
Las versiones anteriores de esta página afirmaban que los hooks (entonces llamados callbacks) siempre omitían RLS y tenían "acceso completo a la base de datos independientemente de los permisos del usuario que los activaba". Eso era incorrecto, e incorrecto en el sentido inseguro: propiciaba la creación de hooks bajo el supuesto de que siempre podían ver todo.

El comportamiento anterior está verificado de extremo a extremo contra Postgres mediante el caso `"scopes context.data to the caller when a callback runs on a user request"` en la suite de aplicación de RLS de `@rebasepro/server-postgres`.
:::

## Semántica de transacciones

:::important
**Las escrituras de `context.data` de un hook forman parte de la escritura que lo activó.** `beforeSave`, el guardado y `afterSave` —o `beforeDelete`, el borrado y `afterDelete`— se ejecutan dentro de una única transacción, esperando cada hook antes de la confirmación, y `context.data` escribe a través de esa misma transacción.
:::

Por lo tanto, la escritura desencadenante y todo lo que escribieron sus hooks se confirman juntos o no se confirma nada:

- Un error lanzado (`throw`) desde `afterSave` o `afterDelete` revierte la escritura desencadenante, junto con cada escritura de `context.data` realizada por los hooks. A quien invocó se le responde con **400 `CALLBACK_REJECTED`** con `details.stage` indicando el hook, o con el propio estado del error cuando lo tenga: un `RebaseApiError` que hayas lanzado, o el 409 de una infracción de unicidad.
- Los suscriptores en tiempo real se enteran de la fila solo después de la confirmación, por lo que una escritura revertida nunca se anuncia.
- Un hook mantiene abierta la transacción mientras se ejecuta, por lo que uno lento implica un bloqueo retenido y una conexión del pool ocupada — tanto en `beforeSave` y `beforeDelete` como en los hooks `after`. Consulta [Un hook mantiene una conexión](#un-hook-mantiene-una-conexión).
- Una escritura de `context.data` también ejecuta los hooks de la tabla de destino, por lo que un `afterSave` que actualiza su propia fila se ejecuta de nuevo a sí mismo. Las escrituras anidadas con más de 16 niveles de profundidad se rechazan con **500 `CALLBACK_RECURSION`**, indicando el hook y la tabla, y toda la escritura se revierte. Haz que una escritura de este tipo sea condicional, tal como lo hace el ejemplo siguiente.

Deja que un fallo lance una excepción cuando la escritura desencadenante no deba sobrevivir a él. Captúralo cuando deba sobrevivir, pero solo alrededor de una **escritura** de `context.data`: una creación, actualización o eliminación que la base de datos rechace (una infracción de clave única o foránea, un trigger) se deshace por sí sola, y el resto se confirma.

Cualquier otra instrucción que falle en la transacción de la escritura —una búsqueda, la lectura que realiza una actualización o eliminación para encontrar su fila (un id que la columna clave no puede albergar), un encolado de trabajo que la base de datos haya rechazado— anula esa transacción en Postgres, y capturar el error en JavaScript no revierte eso. La escritura se rechaza con **500 `TRANSACTION_ABORTED`** y no se almacena nada, en lugar de responder con éxito ante una escritura que fue revertida. Deja que dicho fallo lance una excepción o comprueba la condición antes de ejecutar la instrucción.

```typescript
afterSave: async ({ values, id, status, context }) => {
    // The update below saves this table again, which runs this hook
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

El trabajo que deba salir de la base de datos —un correo electrónico, un webhook, una llamada a una API de terceros— no pertenece al cuerpo del hook. Mantendría la transacción abierta durante un viaje de ida y vuelta de red, y nada podrá revertirlo cuando la escritura se revierta. Encola un [trabajo](/docs/backend/jobs) para ello, o realízalo después de que la escritura retorne: publica en un [canal en tiempo real](/docs/backend/realtime), o utiliza `waitUntil` en una [función personalizada](/docs/backend/custom-functions). [Hooks](/docs/backend/hooks#side-effects-that-must-not-hold-the-transaction) explica cuál es el más adecuado.

## Un hook mantiene una conexión

Una escritura se ejecuta en una conexión obtenida del pool de la base de datos, y cada
hook se ejecuta en ella: `beforeSave` y `beforeDelete` después de que la
transacción haya comenzado, `afterSave` y `afterDelete` antes de que se confirme. Mientras
se ejecute un hook —esperando una búsqueda, un cálculo o cualquier cosa— esa
conexión no sirve para nada más, y los bloqueos que la escritura haya adquirido permanecen retenidos:
en `afterSave`, la fila recién escrita; en una escritura masiva o [`_batch`](/docs/backend/writes/#cross-table-batches),
cada fila que la transacción escribió antes de ella.

El coste es la propia duración del hook, y las escrituras simultáneas lo van sumando:

- El pool contiene 20 conexiones de forma predeterminada (`DB_POOL_MAX`). 25 operaciones de guardado a la vez
  cuyo `beforeSave` esperó 300 ms hicieron que una lectura no relacionada de una sola fila tardara 290 ms,
  casi todo ese tiempo esperando una conexión.
- Una creación masiva de 100 filas cuyo `beforeSave` espera 50 ms es una transacción
  abierta durante 5,3 s, reteniendo su conexión y los bloqueos de cada fila escrita hasta el
  momento durante todo ese tiempo.

Por lo tanto:

- Mantén cualquier cosa lenta fuera de los hooks. Una llamada a otro servicio pertenece a un
  [trabajo](/docs/backend/jobs), o debe hacerse después de que la escritura retorne.
- Busca lo que necesita un hook antes de la escritura siempre que puedas: en el cliente o
  en una [función personalizada](/docs/backend/custom-functions) que luego escriba.
- Envía las filas cuyos hooks sean lentos en lotes masivos más pequeños.
- Si muchos hooks lentos se ejecutan a la vez por diseño, aumenta `DB_POOL_MAX`, dentro de lo que
  permita `max_connections` de la base de datos para cada instancia.
- Con
  `REBASE_METRICS=true`, `/metrics` reporta `rebase_db_pool_wait_ms`: cuánto tiempo
  esperó cada consulta por una conexión. Un pool en buen estado lo mantiene cerca de cero; una cola
  que crece con el tráfico indica peticiones en espera de conexiones que los hooks
  mantienen retenidas. Consulta [Métricas](/docs/deployment/self-hosting/#metrics).
