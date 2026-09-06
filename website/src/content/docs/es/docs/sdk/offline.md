---
sourceHash: 6bc50ef7860bac7d
title: Sincronización Offline y Local-First
sidebar_label: Offline
description: Active el motor de sincronización local-first del SDK del Cliente de Rebase — una base de datos local de filas, escrituras offline instantáneas con reversión y consultas en vivo reactivas.
---

## Resumen

El soporte offline convierte la capa de datos del SDK en un **motor de sincronización local-first**. En lugar de una caché que recuerda respuestas, el cliente mantiene una pequeña base de datos local de filas, responde a las consultas contra ella y trata la red como algo que la rellena y que acaba aceptando sus escrituras.

De ahí se derivan tres cosas:

- **Las lecturas sobreviven a la caída de la red.** Una consulta que el cliente puede evaluar localmente se evalúa localmente — filtros, ordenación y paginación incluidos — de modo que una lista sigue renderizándose con la conexión caída.
- **Las escrituras se deciden localmente.** Una escritura hecha offline se aplica de inmediato, se pone en cola y se reproduce en orden cuando vuelve la conexión. Si el servidor la rechaza, el cambio local se revierte.
- **Las lecturas son reactivas.** `observe()` emite primero desde la base de datos local y vuelve a emitir cada vez que algo cambia las filas que cubre — sus propias escrituras, una escritura en cola que llega al servidor, una reversión, otra pestaña del navegador o un evento en tiempo real.

Está desactivado de forma predeterminada. Actívelo con una sola opción:

```typescript
const client = createRebaseClient({
    baseUrl: "https://api.example.com",
    offline: true
});
```

En el navegador todo se persiste en IndexedDB, así que una recarga conserva tanto las filas locales como las escrituras sin enviar. En otros entornos (Node, tests) recurre a la memoria; otros runtimes pueden aportar su propio almacén.

## Qué cambia

Nada de la API que ya usa cambia de forma. `find()`, `findById()`, `create()`, `update()`, `delete()` y el constructor de consultas fluido conservan sus firmas y sus tipos de retorno — simplemente dejan de fallar cuando falla la red.

### Lecturas

Una lectura correcta fusiona sus filas en la base de datos local y recuerda qué ids devolvió el servidor para esa consulta. Cuando una lectura no puede llegar al servidor, se responde localmente:

```typescript
const drafts = await client.data.posts
    .where("status", "==", "draft")
    .orderBy("updatedAt", "desc")
    .find();
```

Sin conexión, esto filtra y ordena las filas que el cliente tiene. Eso incluye filas obtenidas por *otras* consultas — la base de datos está normalizada, así que una fila se almacena una sola vez sin importar en cuántas listas apareció — y filas que creó offline.

Si realmente no hay nada con qué responder (una colección que la aplicación nunca ha leído), la lectura lanza un error reconocible en lugar de un `TypeError` pelado:

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

Mientras se sabe que la conexión está caída, ni siquiera se intenta la escritura — se aplica localmente y se pone en cola, de modo que no cuesta nada en vez de un tiempo de espera agotado:

```typescript
// Returns immediately, offline or not.
const post = await client.data.posts.create({ title: "Draft", status: "draft" });

// Shows up in every matching list, right away.
const drafts = await client.data.posts.where("status", "==", "draft").find();
```

Las filas creadas offline reciben un id generado por el cliente, del tipo que ya tienen los ids de la colección: un **entero negativo** donde son números, una cadena UUID donde son cadenas. El signo es la señal — una clave real nunca es negativa —, así que una fila que aún no ha llegado al servidor se reconoce sin consultar nada, e `id` sigue siendo lo que dice el tipo `Row` generado. En una colección que este dispositivo nunca ha leído no hay nada local de donde deducir el tipo, y el id es un UUID.

Si el servidor asigna el suyo al reproducirlas, la fila local y cualquier escritura en cola que aún apunte al id temporal se trasladan al id real. Hasta entonces, no guarde un id temporal fuera de la base de datos offline: una clave foránea o una URL guardada que lo contenga apunta a una fila que está a punto de renumerarse.

Las escrituras se reproducen en el orden en que las hizo, entre colecciones — así que una creación en una colección sigue llegando antes que la fila de otra que la referencia.

## Consultas en vivo

`observe()` es la lectura reactiva, y la que conviene usar en una UI:

```typescript
const unsubscribe = client.data.posts.observe(
    { where: { status: ["==", "draft"] }, orderBy: ["updatedAt", "desc"] },
    (result) => {
        render(result.data);
        setBadge(result.hasPendingWrites ? "saving…" : null);
    }
);
```

La primera emisión viene de la base de datos local sin ninguna solicitud de por medio; una revalidación la sigue en segundo plano. A partir de ahí vuelve a emitir con cada cambio en las filas que cubre. Las emisiones se deduplican — un refresco que no cambia nada no invoca el callback — así que es seguro renderizar directamente desde ella.

Cada resultado lleva lo que una UI necesita para describirse a sí misma:

| Campo | Significado |
|-------|-------------|
| `data`, `meta` | La misma forma que devuelve `find()` |
| `fromCache` | Las filas vienen de la base de datos local, no de una solicitud completada |
| `hasPendingWrites` | Al menos una fila de aquí lleva una escritura que el servidor no ha aceptado |
| `partial` | La base de datos local puede no tener todas las filas coincidentes — trátelo como el mejor esfuerzo posible |
| `error` | La última revalidación falló |

`observeById()` hace lo mismo para una sola fila, y pasa `undefined` cuando esta se elimina.

Ambos enlazan la suscripción en tiempo real cuando el cliente tiene una, de modo que los cambios hechos por otros usuarios también llegan en streaming. Pase `{ realtime: false }` para una suscripción que solo refleje el estado local y los refrescos explícitos.

Sin `offline` activado, `observe()` sigue existiendo: obtiene los datos una vez y se mantiene en vivo mediante el tiempo real, con las tres marcas en `false`.

## Estado de sincronización

`client.offline` expone el motor, que es a partir de lo que se construye un indicador de sincronización:

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
| `status()` | Conectividad actual, profundidad de la cola, actividad de sincronización, último error |
| `onStatusChange(fn)` | Suscribirse a lo anterior |
| `onQueueChange(fn)` | Solo el número de escrituras sin enviar, para un indicador |
| `pending()` | Las mutaciones en cola en sí, de la más antigua a la más reciente |
| `sync()` | Reproducir ahora — se resuelve con `{ flushed, remaining }` |
| `clear()` | Descartar las escrituras en cola **y** las filas locales del usuario actual |

La reproducción ocurre por su cuenta: cuando el navegador dispara `online`, cuando el usuario inicia sesión y con un backoff exponencial (un segundo, duplicándose hasta un minuto) mientras haya algo en cola. `sync()` es para un botón de «reintentar ahora».

## Cuando el servidor dice que no

Una escritura en cola puede ser rechazada — validación, seguridad a nivel de fila, una fila que otra persona eliminó. Eso nunca se resuelve por sí solo, así que el motor revierte las filas locales a como estaban antes de la escritura, descarta las ediciones en cola que se construyeron sobre ella y se lo comunica:

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

La cascada es estrecha: un `update` se descarta junto con la escritura que editaba, porque solo puede fallar de la misma manera. Un `create` o `delete` posterior sobre la misma fila se sostiene por sí mismo y se conserva.

Un fallo que es meramente temporal — un 429, un 503, una conexión caída — no es un rechazo. Esos permanecen en cola y se reintentan; solo después de `maxRetries` aplazamientos se revierte una escritura.

## Múltiples pestañas

Las pestañas de la misma aplicación comparten una única base de datos IndexedDB, así que comparten las filas locales y la cola de salida (outbox). Una escritura en una aparece en las demás, y solo una pestaña a la vez reproduce la cola. No hay nada que configurar.

## Usuarios

La base de datos local y la cola de salida están particionadas por usuario autenticado. Las filas en caché son lo que la seguridad a nivel de fila dejó ver a ese usuario, y una escritura en cola tiene que reproducirse como su autor — así que cerrar sesión y volver a entrar como otra persona nunca mezcla las dos. Cerrar sesión no necesita limpiar nada.

## Configuración

```typescript
createRebaseClient({
    baseUrl: API_URL,
    offline: {
        store: myCustomStore,                 // default: IndexedDB in the browser, memory elsewhere
        maxCachedRowsPerCollection: 5000,     // rows with unsent writes are never evicted
        maxCachedQueriesPerCollection: 50,    // remembered server page compositions
        syncIntervalMs: 60_000,               // ceiling for the retry backoff; 0 disables auto-retry
        maxRetries: 5,                        // deferrals before a write is given up on
        crossTab: true,                       // default: on for IndexedDB, off for memory
        onSyncError: (error, mutation) => {}
    }
});
```

### Un almacén personalizado

Cualquier entorno puede persistir la base de datos local implementando `OfflineStore` — una superficie clave/valor con espacios de nombres, con un área de caché de lectura y un área de cola. Así es como se respalda con AsyncStorage en React Native, o con el sistema de archivos en Electron:

```typescript no-verify
import type { OfflineStore } from "@rebasepro/client";

class AsyncStorageOfflineStore implements OfflineStore {
    // Read cache: getCache, setCache, setCacheMany, deleteCache,
    //             listCache, listCacheEntries
    // Outbox:     enqueue, dequeue, listQueue
    // Both:       clear
}
```

El único contrato más allá de lo evidente es que los listados por prefijo vuelven en orden lexicográfico de clave — eso es lo que hace que la cola de salida sea FIFO.

## Límites

El cliente no es una réplica de su base de datos, y no pretende serlo:

- **Solo son locales las filas que la aplicación ha leído o escrito.** Una consulta que el cliente nunca ha enviado aún puede responderse con lo que tiene, pero a la respuesta pueden faltarle filas que el servidor habría devuelto. Los resultados en vivo lo indican mediante `partial`.
- **`searchString` se aproxima** como un escaneo de subcadena sin distinción de mayúsculas sobre los campos de texto en caché. El servidor ejecuta una búsqueda de texto completo real sobre las columnas configuradas de la colección.
- **Las relaciones incluidas con `include` no se pueden evaluar localmente** — las filas relacionadas viven en colecciones que la consulta nunca cargó. Una consulta así siempre se marca como `partial` cuando se responde desde la caché.
- **La reproducción es al menos una vez.** Una escritura que llega al servidor pero cuya respuesta se pierde puede enviarse de nuevo. Prefiera escrituras idempotentes (`createMany` con `upsert`) allí donde los duplicados importen.
- **Las lecturas locales aplican la semántica de Postgres, no los datos de la base de datos.** Los filtros se evalúan como lo haría SQL — las comparaciones contra `NULL` son desconocidas, `ORDER BY` coloca los nulos al final en orden ascendente — pero contra la copia de las filas que tiene el cliente, que puede estar desactualizada.

## Receta: un indicador de estado offline

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

- [Consultar Datos](/docs/sdk/querying) — la superficie de consulta que `observe()` comparte con `find()`
- [Suscripciones en Tiempo Real](/docs/sdk/realtime) — actualizaciones enviadas por el servidor, sobre las que se construyen las consultas en vivo
