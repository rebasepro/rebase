---
sourceHash: 1b875d11f8a07037
title: Sincronización offline y local-first
sidebar_label: Offline
description: Habilite el motor de sincronización local-first del SDK tipado de Rebase — una base de datos local de filas, escrituras offline instantáneas con rollback y consultas en vivo reactivas.
---

## Descripción general

El soporte offline convierte la capa de datos del SDK en un **motor de sincronización local-first**. En lugar de una caché que recuerda respuestas, el cliente mantiene una pequeña base de datos local de filas, responde consultas contra ella y trata a la red como algo que la rellena y, eventualmente, acepta sus escrituras.

De esto se derivan tres cosas:

- **Las lecturas sobreviven a la pérdida de red.** Una consulta que el cliente puede evaluar localmente se evalúa localmente —filtros, ordenamiento y paginación incluidos—, por lo que una lista continúa renderizándose aunque la conexión esté caída.
- **Las escrituras se deciden localmente.** Una escritura realizada offline se aplica de inmediato, se pone en cola y se reproduce en orden cuando vuelve la conexión. Si el servidor la rechaza, el cambio local se revierte (*rollback*).
- **Las lecturas son reactivas.** `observe()` emite primero desde la base de datos local y vuelve a emitir cada vez que algo cambia las filas que abarca: sus propias escrituras, la aplicación de una escritura en cola, una reversión, otra pestaña del navegador o un evento en tiempo real (*realtime*).

Está desactivado por defecto. Actívelo con una opción:

```typescript
const client = createRebaseClient({
    baseUrl: "https://api.example.com",
    offline: true
});
```

En el navegador, todo persiste en IndexedDB, por lo que una recarga conserva tanto las filas locales como las escrituras no enviadas. En otros entornos (Node, pruebas), recurre a la memoria; otros entornos de ejecución pueden proporcionar su propio almacenamiento (*store*).

## Qué cambia

Nada en la API que ya utiliza cambia de forma. `find()`, `findById()`, `create()`, `update()`, `delete()` y el *fluent builder* mantienen sus firmas y sus tipos de retorno; simplemente dejan de fallar cuando falla la red.

### Lecturas

Una lectura exitosa fusiona sus filas en la base de datos local y recuerda qué identificadores (IDs) devolvió el servidor para esa consulta. Cuando una lectura no puede comunicarse con el servidor, se responde localmente:

```typescript
const drafts = await client.data.posts
    .where("status", "==", "draft")
    .orderBy("updatedAt", "desc")
    .find();
```

En modo offline, esto filtra y ordena las filas que conserva el cliente. Eso incluye filas obtenidas por *otras* consultas —la base de datos está normalizada, por lo que una fila se almacena una sola vez sin importar en cuántas listas haya aparecido— y filas que usted haya creado offline.

Si genuinamente no hay nada con qué responder (una tabla que la aplicación nunca ha leído), la lectura lanza un error reconocible en lugar de un simple `TypeError`:

```typescript
import { isOfflineError } from "@rebasepro/client";

try {
    await client.data.posts.find();
} catch (error) {
    if (isOfflineError(error)) showOfflinePlaceholder();
    else throw error;
}
```

### Escrituras

Mientras se sabe que la conexión está caída, la escritura ni siquiera se intenta: se aplica localmente y se pone en cola, por lo que no cuesta nada en lugar de causar un tiempo de espera agotado (*timeout*):

```typescript
// While offline, returns at once with the locally applied row.
const post = await client.data.posts.create({ title: "Draft", status: "draft" });

// Shows up in every matching list, right away.
const drafts = await client.data.posts.where("status", "==", "draft").find();
```

Las filas creadas offline obtienen un id generado por el cliente, en el tipo que ya tienen los identificadores de la tabla: un **entero negativo** donde son números, una cadena UUID donde son cadenas. El signo es el indicio —una clave real nunca es negativa—, por lo que una fila que aún no ha llegado al servidor es reconocible sin necesidad de una búsqueda, y el tipo de `id` sigue validándose según lo que indique la `Row` generada. En una tabla que este dispositivo nunca ha leído, no hay nada local de donde deducir el tipo, y el id será un UUID.

Si el servidor asigna el suyo propio durante la reproducción, la fila local y cualquier escritura en cola que aún apunte al id temporal se actualizan al real, en todas las tablas: una publicación en cola con `author_id` asignado a un autor creado offline se envía con el id que el servidor le otorgó al autor. Si, por el contrario, el servidor rechaza al autor, las escrituras que hagan referencia a él se descartan junto con él y se reportan como `DEPENDENCY_REJECTED` (consulte [Cuando el servidor dice que no](#cuando-el-servidor-dice-que-no)). Hasta entonces, no persista un id temporal en ningún lugar fuera de la base de datos offline; una clave foránea o una URL en marcadores que contenga uno apuntará a una fila que está a punto de ser renumerada.

Las escrituras se reproducen en el orden en que se realizaron, a través de todas las tablas; por lo tanto, una creación en una tabla seguirá ejecutándose antes que la fila en otra tabla que hace referencia a ella.

Cada escritura en cola es una petición por defecto, por lo que 500 filas escritas offline requieren 500 viajes de ida y vuelta (*round trips*) para vaciarse. Con `replayBatchSize` configurado (hasta 1 000), una serie de creaciones offline consecutivas en una misma tabla se reproduce como un solo `createMany`. Solo se agrupan las creaciones con un id que el SDK generó como cadena, y nunca una que haga referencia a otra fila de la misma serie. Si el servidor rechaza o pospone la serie por cualquier motivo que no sea una pérdida de conexión, no se escribe nada (una escritura por lotes es una sola transacción), y la serie se reproduce una escritura a la vez, como lo haría por defecto.

### Escrituras puestas en cola por una versión anterior

<span class="since-badge" data-since="0.31">Desde 0.31</span>

La cola almacena una escritura como los valores que envía —claves para relaciones, listas de números para vectores, `{ latitude, longitude }` para puntos, texto ISO para fechas— y las filas en caché como las filas del servidor. Una escritura puesta en cola offline por la versión anterior del SDK, que las almacenaba como clases (`EntityRelation`, `GeoPoint`, `Vector`), se convierte a esos valores cuando se vuelve a leer y se reproduce normalmente: nada de lo encolado antes de la actualización se pierde. Un SDK más antiguo que encuentre una escritura encolada por este la dejará en cola.

## Consultas en vivo

`observe()` es la lectura reactiva y la opción recomendada para una interfaz de usuario:

```typescript
const unsubscribe = client.data.posts.observe(
    { where: { status: ["==", "draft"] }, orderBy: ["updatedAt", "desc"] },
    (result) => {
        render(result.data);
        setBadge(result.hasPendingWrites ? "saving…" : null);
    }
);
```

La primera emisión proviene de la base de datos local sin peticiones de por medio; le sigue una revalidación en segundo plano. Después de eso, vuelve a emitir con cada cambio en las filas que abarca. Las emisiones están deduplicadas —una actualización que no cambia nada no vuelve a invocar el callback—, por lo que es seguro renderizar directamente a partir de ella.

Cada resultado contiene lo que una interfaz de usuario necesita para describirse a sí misma:

| Campo | Significado |
|-------|-------------|
| `data`, `meta` | La misma estructura que devuelve `find()` |
| `fromCache` | Las filas provienen de la base de datos local, no de una petición completada |
| `hasPendingWrites` | Al menos una fila aquí contiene una escritura que el servidor aún no ha aceptado |
| `partial` | La base de datos local puede no contener todas las filas coincidentes; trátese como el mejor esfuerzo posible (*best effort*) |
| `error` | La última revalidación falló |

`observeById()` hace lo mismo para una sola fila y pasa `undefined` cuando se elimina. Acepta `include` al igual que `findById()`, y cada emisión incluye esas relaciones:

```typescript
const stop = client.data.posts.observeById(postId, (post) => render(post), undefined, {
    include: ["tags"]
});
```

Ambos vinculan la suscripción en tiempo real cuando el cliente dispone de una, de modo que los cambios realizados por otros usuarios también se transmiten. Pase `{ realtime: false }` para obtener una suscripción que solo refleje el estado local y las actualizaciones explícitas.

Sin `offline` activado, `observe()` sigue existiendo: realiza una obtención inicial y se mantiene activo mediante tiempo real, con las tres banderas en `false`.

## Estado de sincronización

`client.offline` expone el motor, a partir del cual se construye un indicador de sincronización:

```typescript
const unsubscribe = client.offline!.onStatusChange((status) => {
    setOnline(status.online);
    setPending(status.pending);
    setSyncing(status.syncing);
});

// Or read it once
const { online, pending, syncing, lastSyncedAt, lastError } = client.offline!.status();
```

| Método | Propósito |
|--------|-----------|
| `status()` | Conectividad actual, profundidad de la cola, actividad de sincronización, último error y `persisted`: si el navegador aceptó conservar la base de datos offline (se solicita cuando se encola la primera escritura; `false` significa que puede ser desalojada bajo presión de almacenamiento, incluidas las escrituras no enviadas). `unverifiedUser` es `true` mientras una recarga offline muestra los datos del último usuario sin una sesión confirmada (consulte [`keepLastUser`](#recargas-offline-en-modo-cookie)) |
| `onStatusChange(fn)` | Suscribirse a lo anterior |
| `onQueueChange(fn)` | Solo el número de escrituras no enviadas, para una insignia (*badge*) |
| `pending()` | Las mutaciones en cola en sí, las más antiguas primero. `pending({ orphaned: true })`: las encoladas mientras la sesión estaba cerrada — consulte [Usuarios](#usuarios) |
| `sync()` | Reproducir ahora — se resuelve con `{ flushed, remaining }` |
| `clear()` | Descarta las escrituras en cola del usuario actual **y** las filas locales. `clear({ orphaned: true })`: las encoladas mientras la sesión estaba cerrada |

La reproducción ocurre por sí sola: cuando el navegador dispara el evento `online`, cuando el usuario inicia sesión y con un retroceso exponencial (*exponential backoff*, un segundo, duplicándose hasta un minuto) mientras haya algo en cola. `sync()` es para un botón de "reintentar ahora".

## Cuando el servidor dice que no

Una escritura en cola puede ser rechazada: validación, seguridad a nivel de fila (*row-level security*), una fila que otra persona eliminó. Estos casos nunca se resuelven por sí solos, por lo que el motor revierte las filas locales al estado en que estaban antes de la escritura, descarta las ediciones en cola construidas sobre ella y le notifica:

```typescript
const client = createRebaseClient({
    baseUrl: API_URL,
    offline: {
        onSyncError: (error, mutation) => {
            toast(`Couldn't save your change to ${mutation.collection}: ${error.message}`);
        }
    }
});
```

Una fila que otra persona eliminó es el único caso que no se revierte. Un `delete` en cola para esa fila cumplió su propósito, por lo que cuenta como sincronizado y no se reporta. Una edición en cola sobre ella sí se reporta, y la fila se elimina de la base de datos local en lugar de restaurarse, ya que el servidor ya no la tiene.

La cascada es limitada: un `update` se descarta junto con la escritura que editó, porque solo puede fallar de la misma manera. Un `create` o `delete` posterior para la misma fila se mantiene por sí mismo. Un `create` rechazado de una fila creada offline también se lleva consigo todas las escrituras en cola, en cualquier tabla, cuyos valores hagan referencia al id temporal de la fila. Una escritura descartada nunca llegó a enviarse. Se reporta con un `RebaseApiError` cuyo `code` es `DEPENDENCY_REJECTED` y cuyo `cause` es el rechazo que la condenó, para que pueda distinguirla de la escritura que el servidor realmente rechazó.

Las ediciones consecutivas en una misma fila mientras se está offline se fusionan en una sola escritura en cola, evitando que rellenar un formulario incremente la cola innecesariamente. No se fusionan ediciones en una escritura que la cola ya ha comenzado a enviar: una edición realizada tras un intento de reproducción cuya respuesta se perdió se encola como una actualización independiente, y la eliminación de una fila creada offline se envía en lugar de cancelarse contra su creación, ya que el servidor podría contener ya la fila. Si el servidor rechaza la escritura fusionada debido a su contenido (un error 400, 403 o 422 —por ejemplo, un campo eliminado por un cambio de esquema mientras el usuario estaba offline—), el motor la vuelve a dividir en las ediciones separadas y reproduce cada una. Solo se revierte y reporta la edición que el servidor rechaza; las demás se conservan.

### Conflictos

Por defecto, una edición encolada offline sobrescribe lo que el servidor tenga en los campos que modifica, incluso si alguien más los cambió mientras tanto. Para detectarlo en su lugar, pase `onConflict`. Un `update` en cola se reproducirá entonces con `If-Match`, la versión de la fila sobre la que se realizó la modificación, y si la fila ha cambiado desde entonces, el servidor lo rechazará con un código 412 y `onConflict` decidirá:

```typescript
const client = createRebaseClient({
    baseUrl: API_URL,
    offline: {
        onConflict: async (error, mutation) =>
            (await askUser(`${mutation.collection} changed while you were offline. Keep your edit?`))
                ? "overwrite"
                : "discard"
    }
});
```

- `"overwrite"` envía la edición nuevamente sin la condición previa: la última escritura gana (*last writer wins*), igual que sin `onConflict`.
- `"discard"` descarta la edición. La fila vuelve al estado previo a la misma, como ocurre con un rechazo, y se vuelve a leer desde el servidor. No se reporta a `onSyncError`; las escrituras encoladas sobre ella sí se reportan, como `DEPENDENCY_REJECTED`.

La cola espera mientras se ejecuta `onConflict`, por lo que puede consultar al usuario. Si lanza una excepción, la edición se sobrescribe.

La versión sobre la que se realiza una edición es la que reportó la última lectura de la fila: `findById()`, una trama de `listenById()` o la respuesta a un `update()` anterior. Una fila leída por última vez en una lista de `find()` o `listen()` no tiene versión, y tampoco la tiene una edición realizada sobre otra escritura en cola en la misma fila. Esas se reproducen sin condición previa. Cualquier `ifMatch` que usted mismo pase a `update()` o `delete()` se conserva cuando la escritura se pone en cola, con o sin `onConflict`, y `findById()` en un cliente con offline habilitado devuelve la fila con su versión, por lo que `etagOf(row)` funciona igual que online. Sin `onConflict`, una escritura en cola rechazada por su propio `ifMatch` se revierte y se reporta a `onSyncError` con un error 412 `PRECONDITION_FAILED`.

Un fallo meramente temporal —un 429, un 503, una conexión caída— no se considera un rechazo. Esos permanecen en cola y se reintentan; solo después de `maxRetries` aplazamientos se revierte una escritura.

## Múltiples pestañas

Las pestañas de la misma aplicación comparten una única base de datos IndexedDB, por lo que comparten las filas locales y la bandeja de salida (*outbox*). Una escritura en una aparece en las demás, y solo una pestaña a la vez reproduce la cola. No hay nada que configurar.

Esta última garantía proviene de la [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API) del navegador, que solo existe en un contexto seguro (HTTPS o `localhost`) y no en Safari anterior a la versión 15.4 ni en algunas webviews integradas. Sin ella, cada pestaña abierta reproduce la cola cuando sincroniza. Las creaciones, escrituras por lotes, actualizaciones y eliminaciones se reproducen bajo una clave de idempotencia, por lo que un servidor que almacene claves aplicará cada una de ellas una sola vez; lo que se podría observar es la misma escritura enviada desde dos pestañas.

## Usuarios

La base de datos local y la bandeja de salida están particionadas por usuario autenticado. Las filas en caché son las que la seguridad a nivel de fila (*row-level security*) permitió ver a ese usuario, y una escritura en cola debe reproducirse con su autor, por lo que cerrar sesión e iniciar sesión como otra persona nunca mezcla ambos datos. Cerrar sesión no requiere limpiar nada.

### Mientras se restaura la sesión

Hasta que el cliente sabe quién ha iniciado sesión, no sabe qué base de datos local ni qué bandeja de salida utilizar, por lo que las lecturas y escrituras offline esperan. Ese es el tiempo que tarda `auth.isInitialized()`: nada para una sesión almacenada que sigue siendo válida, y una petición de actualización cuando la sesión debe recuperarse del servidor (en el modo cookie, donde nada se almacena en el dispositivo, esto ocurre en cada carga de página). Una escritura realizada en ese intervalo se pone en cola a nombre de quienquiera que resulte ser la sesión, y una lectura responde desde su base de datos local. Las tramas en tiempo real que lleguen mientras tanto se pasan a su callback tal como las envió el servidor y no se almacenan en ningún sitio.

Si la sesión no se puede restaurar —la actualización es rechazada o, en modo cookie, no se puede conectar con el servidor—, el cliente pasa al estado de sesión cerrada, y las lecturas y escrituras offline pertenecerán al usuario sin sesión iniciada.

### Escrituras realizadas sin haber iniciado sesión

Las escrituras puestas en cola mientras nadie había iniciado sesión no se reproducen cuando alguien inicia sesión. Ese usuario no las realizó, y reproducirlas con sus credenciales atribuiría los cambios de una persona a nombre de otra (en un dispositivo compartido, las escrituras de un visitante en la cuenta del siguiente usuario). Tampoco se mueven a la bandeja de salida del usuario que inició sesión. Se conservan y se listan por separado, para que la aplicación pueda decidir qué hacer con ellas:

```typescript
client.auth.onAuthStateChange(async (event) => {
    if (event !== "SIGNED_IN") return;
    const orphaned = await client.offline!.pending({ orphaned: true });
    if (orphaned.length === 0) return;
    if (await askToKeep(orphaned.length)) {
        // Re-issue each one yourself, now as the signed-in user.
        for (const write of orphaned) await reissue(write);
    }
    await client.offline!.clear({ orphaned: true });
});
```

`clear({ orphaned: true })` las descarta junto con las filas locales a las que se aplicaron; la bandeja de salida del usuario autenticado no se modifica. Si la aplicación no hace nada con ellas, se reproducirán la próxima vez que nadie haya iniciado sesión. Mientras nadie haya iniciado sesión, simplemente constituyen la bandeja de salida actual, y `pending({ orphaned: true })` no devuelve nada.

### Recargas offline en modo cookie

En el modo cookie, nada relativo a la sesión se almacena en el dispositivo, por lo que una recarga que no pueda comunicarse con el servidor no tiene ningún usuario. Por defecto se trata como una sesión cerrada: las filas locales del usuario se ocultan y las escrituras realizadas en ese momento se ponen en cola como pertenecientes al usuario sin sesión.

`keepLastUser: true` cambia ese comportamiento. El cliente recuerda al último usuario que inició sesión en el dispositivo (únicamente su id), y una recarga offline abre en su lugar la base de datos local de ese usuario. Las escrituras realizadas entonces se ponen en cola como suyas, pero ninguna se reproduce hasta que se confirme la sesión: cuando se restablece la conexión, el cliente actualiza la sesión, y un inicio de sesión también la confirma. Si el servidor rechaza la sesión, o si otra persona inicia sesión, el dispositivo cambia de usuario y las escrituras en cola permanecen vinculadas a su autor hasta que vuelva a iniciar sesión. Mientras tanto, `status().unverifiedUser` es `true`, y esto también aplica online: hasta que la actualización de la sesión responda, las escrituras se ponen en cola en lugar de enviarse sin credenciales, y las lecturas se responden a partir de las filas locales del usuario. Lo que el servidor devuelve a una petición sin sesión es lo que un usuario no autenticado podría ver, por lo que no se conserva.

```typescript
createRebaseClient({
    baseUrl: API_URL,
    auth: { authFlowMode: "cookie" },
    offline: { keepLastUser: true }
});
```

Está desactivado por defecto porque, en un dispositivo compartido, permitiría que las filas en caché del usuario anterior se lean offline sin una sesión. Actívelo para instalaciones que pertenezcan a una sola persona. El id se olvida al cerrar sesión y cuando el servidor rechaza la sesión. Nunca se utiliza cuando el servidor responde que no existe una sesión.

## Configuración

<span class="since-badge" data-since="0.31">Desde 0.31</span> `maxCachedRowsPerTable` y `maxCachedQueriesPerTable` eran `…PerCollection`.

```typescript
createRebaseClient({
    baseUrl: API_URL,
    offline: {
        store: myCustomStore,                 // default: IndexedDB in the browser, memory elsewhere
        maxCachedRowsPerTable: 5000,          // rows with unsent writes are never evicted
        maxCachedQueriesPerTable: 50,         // remembered server page compositions
        syncIntervalMs: 60_000,               // ceiling for the retry backoff; 0 disables auto-retry
        maxRetries: 5,                        // deferrals before a write is given up on
        crossTab: true,                       // default: on for IndexedDB, off for memory
        keepLastUser: false,                  // open the last user's data on an offline reload (cookie mode)
        replayBatchSize: 1,                   // queued creates sent per request on replay (max 1000)
        onConflict: (error, mutation) => "overwrite", // or "discard"; default: no conflict check
        onSyncError: (error, mutation) => {}
    }
});
```

### Un almacenamiento personalizado

Cualquier entorno puede persistir la base de datos local implementando `OfflineStore`: una superficie clave/valor con espacio de nombres que cuenta con un área de caché de lectura y un área de cola. Así es como puede respaldarlo con AsyncStorage en React Native, o con el sistema de archivos en Electron:

```typescript no-verify
import type { OfflineStore } from "@rebasepro/client";

class AsyncStorageOfflineStore implements OfflineStore {
    // Read cache: getCache, setCache, setCacheMany, deleteCache,
    //             listCache, listCacheEntries
    // Outbox:     enqueue, dequeue, listQueue
    // Both:       clear
}
```

El único requisito más allá de lo evidente es que los listados por prefijo se devuelvan en orden lexicográfico de claves; eso es lo que hace que la bandeja de salida funcione como un FIFO.

## Límites

El cliente no es una réplica de su base de datos, y no pretende serlo:

- **Solo las filas que la aplicación ha leído o escrito son locales.** Una consulta que el cliente nunca ha enviado aún puede responderse a partir de lo que contiene, pero la respuesta podría carecer de filas que el servidor habría devuelto. Los resultados en vivo lo indican mediante `partial`.
- **`findAll()` e `iterate()` leen únicamente las páginas que el servidor respondió en este dispositivo.** Un recorrido continúa mientras cada página indique que hay más contenido, y solo el servidor puede determinar eso. En modo offline, un recorrido que necesita una página que este dispositivo nunca obtuvo falla con el error `OFFLINE` (`isOfflineError`) en lugar de devolver parte de la tabla como si fuera la totalidad.
- **`count()` en modo offline necesita un recuento que el servidor haya proporcionado a este dispositivo para la misma consulta.** Las escrituras puestas en cola desde entonces lo modifican: creaciones, ediciones que incluyen o excluyen una fila del filtro y eliminaciones. Sin este recuento previo, falla con el error `OFFLINE` en lugar de contar simplemente las filas que este dispositivo contiene en ese momento.
- **`searchString` se aproxima** como un escaneo de subcadenas que no distingue entre mayúsculas y minúsculas sobre los campos de texto en caché. El servidor ejecuta una búsqueda de texto completo (*full-text search*) real sobre las columnas configuradas de la tabla.
- **Las relaciones en `include` no se pueden evaluar localmente** —las filas relacionadas residen en tablas que la consulta nunca cargó. Dicha consulta siempre se marca como `partial` cuando se responde desde la caché.
- **Los conflictos se resuelven mediante el principio de que la última escritura gana (*last-writer-wins*), por campo, a menos que pase `onConflict`.** Un `update` reproducido envía los campos que el usuario modificó y nada más, por lo que los campos que no modificó conservan lo que tenga el servidor. Para un campo que *sí* modificó, cualquier cambio que otra persona haya hecho en el servidor mientras estaba offline se sobrescribirá cuando la cola se reproduzca, sin notificar a ninguno de los dos usuarios. Con [`onConflict`](#conflictos), una edición cuya versión de fila se conoce se compara contra la del servidor, y la aplicación decide. Las creaciones, eliminaciones y escrituras por lotes nunca se comprueban.
- **La reproducción es al menos una vez (*at-least-once*).** Una escritura que llega al servidor pero cuya respuesta se pierde puede volver a enviarse. Prefiera escrituras idempotentes (`createMany` con `upsert`) donde los duplicados pudieran ser un problema.
- **La papelera requiere el servidor.** La base de datos local solo contiene filas activas, por lo que `trash.find()`, `trash.count()`, `trash.restore()` y `trash.purge()` (consulte [eliminación lógica (soft delete)](/docs/collections/soft-delete#from-the-sdk)) nunca se responden localmente ni se ponen en cola: en modo offline fallan con el error `OFFLINE`. Restaurar o purgar una fila con una escritura aún en cola primero sincroniza la cola, y se rechaza con `TRASH_PENDING_WRITE` si la escritura aún no se puede enviar.
- **Un upsert en una clave natural requiere el servidor.** Determinar a qué fila apunta el objetivo de `onConflict` le corresponde al servidor, por lo que `upsert()` en una clave natural (o sin el id de la fila), y un `createMany()` con `onConflict` que nunca se envió, se rechazan mientras se esté offline con `OFFLINE_UPSERT_UNSUPPORTED`. Un upsert en la clave primaria, con la clave presente en cada fila, se pone en cola.
- **Las lecturas locales aplican la semántica de Postgres, no los datos de la base de datos.** Los filtros se evalúan como lo haría SQL —las comparaciones contra `NULL` son desconocidas (*unknown*), `ORDER BY` coloca los nulos al final de forma ascendente y resuelve los empates restantes por el id de fila en orden descendente, exactamente como lo hace el servidor—, pero sobre la copia de filas del cliente, la cual puede estar desactualizada.
- **Un ordenamiento que el cliente no puede reproducir no se aplica.** La ordenación de texto le corresponde al servidor: PostgreSQL lo ordena según la intercalación (*collation*) de la *base de datos*, la cual este proceso desconoce, y bajo la intercalación C `Banana` se ordena antes que `apple` mientras que un cotejador de JavaScript indica lo contrario. Cuando una columna de ordenamiento no se puede comparar numéricamente, las filas conservan el orden que envió el servidor, y el resultado se marca como `partial` en lugar de presentarse como la página ordenada solicitada. Cada clave de un ordenamiento multicolumna debe ser reproducible, no solo la primera; un ordenamiento en el que la parte local solo coincide hasta su segunda columna es uno con el que no coincide.

## Receta: un indicador offline

```tsx
import React from "react";
import type { CreateRebaseClientResult } from "@rebasepro/client";

export function SyncIndicator({ client }: { client: CreateRebaseClientResult }) {
    const offline = client.offline!;
    const [status, setStatus] = React.useState(offline.status());
    React.useEffect(() => offline.onStatusChange(setStatus), [offline]);

    if (!status.online) {
        return <span className="badge warning">
            Offline{status.pending ? ` · ${status.pending} unsaved` : ""}
        </span>;
    }
    if (status.syncing) return <span className="badge">Syncing…</span>;
    if (status.pending) return <span className="badge">{status.pending} unsaved</span>;
    return null;
}
```

## Véase también

- [Querying Data](/docs/sdk/querying) — la superficie de consulta que `observe()` comparte con `find()`
- [Realtime Subscriptions](/docs/sdk/realtime) — actualizaciones enviadas por el servidor, sobre las cuales se construyen las consultas en vivo
