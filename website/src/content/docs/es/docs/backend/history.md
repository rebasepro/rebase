---
sourceHash: 4952ad745ea2bab4
title: Historial de entidades
sidebar_label: Historial de entidades
description: Realiza un seguimiento de cada cambio en tus entidades con un registro de auditoría completo — quién cambió qué, cuándo y la entidad completa antes y después.
---

## Descripción general

El historial de entidades registra una instantánea de los valores de la entidad en cada creación, actualización y eliminación. Esto te proporciona un registro de auditoría completo con diferencias (diffs).

## Habilitar el historial

:::note[Dónde va esto]
**Runtime gestionado** — activado por defecto. `REBASE_HISTORY=false` en `.env` lo desactiva.

**Ejected** — `history: true` en `initializeRebaseBackend({ … })`. La forma de objeto a continuación — `{ retention }` — es solo para ejected; la variable de entorno es un booleano.

El mapa completo se encuentra en [Backend Overview](/docs/backend/#where-each-option-lives).
:::

### Backend

:::note[Dónde va esto]
**Runtime gestionado:** `REBASE_HISTORY` (`true` por defecto; define `false` para desactivarlo). Los ajustes de retención no tienen formato de variable de entorno — haz eject para cambiarlos.
**Ejected:** `initializeRebaseBackend({ history })` en `backend/src/index.ts`.
:::

Habilita el historial en `initializeRebaseBackend`:

```typescript no-verify
await initializeRebaseBackend({
    // ...
    history: true
});
```

O con un período de retención personalizado:

```typescript
history: {
    retention: 30        // Days. Entries older than this are pruned (default: 90)
}
```

### Por colección

Marca qué colecciones deben registrar el historial:

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const ordersCollection = defineCollection({
    slug: "orders",
    name: "Orders",
    table: "orders",
    history: true,       // Enable for this collection
    properties: { /* ... */ }
});
```

## Cómo funciona

1. El backend crea automáticamente una tabla `rebase.entity_history`.
2. En cada creación, actualización o eliminación, se registra una entrada con:
   - El ID de la entidad y el slug de la colección (en `table_name`)
   - Los valores de la entidad tras el cambio (`values`; en un borrado, la entidad
     que se eliminó)
   - En una actualización, lo que contenían antes los campos modificados (`previous_values`)
   - Marca de tiempo e ID de usuario
   - La acción (`create`, `update`, `delete`)
   - Un array de `changed_fields` que muestra qué columnas se modificaron

Los valores son la fila tal como la sirve la API REST: sus columnas, las fechas
como timestamps, una `belongsTo` como su clave foránea. Eso es lo que escribe
de vuelta un revert.

Una entrada nunca contiene los valores de una fila relacionada. Leer el historial de una
fila solo requiere acceso de lectura a esa fila, no a las filas a las que apunta, así que
una relación se guarda como una referencia — `{ "__type": "relation", "id", "path" }` — y
nada más. Las entradas que versiones anteriores registraron con la fila relacionada
incrustada (un borrado solía guardar la vista de la fila del panel de administración) se
sirven igual: el endpoint de historial descarta los valores incrustados antes de responder.

En una colección con [soft delete](/docs/collections/soft-delete/), un borrado
se registra como `delete` y una restauración (la actualización que devuelve el
campo de soft delete a `null`) como `update`. El historial de una fila sigue
siendo legible mientras la fila está en la papelera, y revertirla a una
versión anterior al borrado la restaura.

### Qué contiene `previous_values`

<span class="since-badge" data-since="0.25">Desde 0.25</span> Una entrada de
actualización guarda, en `previous_values`, solo los campos listados en
`changed_fields`. Todos los demás campos tenían el mismo valor antes y después del
cambio, así que ya están en `values`; guardar la fila entera dos veces costaba a un
cambio de un campo en una fila de 20 campos 1.269 bytes, donde ahora cuesta 794.

Las entradas registradas antes de la 0.25 conservan la fila anterior completa. El
`format` de la entrada indica cuál es:

| `format` | `previous_values` en una actualización |
|---|---|
| `1` (entradas anteriores a la 0.25) | La fila completa antes del cambio |
| `2` | Solo los `changed_fields`, cada uno tal como lo tenía la fila completa |

La vista de historial del administrador y un revert leen ambos por igual: la vista
muestra el valor anterior de cada campo modificado, y un revert escribe los `values`
de la entrada elegida, que están completos en ambos formatos. Para reconstruir la fila
tal como era antes de un cambio de `format: 2`, toma `values` y devuelve cada campo
que contiene `previous_values`.

### Seguimiento de diferencias e igualdad estructural profunda

Para evitar registrar logs redundantes donde los campos se guardan pero ningún valor cambia, el `HistoryService` realiza una comparación de igualdad estructural profunda (deep equality) en las claves de nivel superior de los valores antiguos y nuevos:
- Ignora las propiedades de metadatos del sistema que comienzan con `__`.
- Si se encuentran diferencias, los nombres de las propiedades modificadas se guardan en la columna `changed_fields` (`text[]`).
- Si la verificación de igualdad profunda detecta cero cambios, la inserción en el historial se omite por completo.

### Purgado

La retención se aplica en dos lugares:
- **Tras cada escritura**, para la entidad escrita: justo después de guardarla o
  eliminarla, el servidor purga las entradas de esa entidad que superen las 200 más
  recientes, o que sean más antiguas que el período de retención. No retiene la
  escritura.
- <span class="since-badge" data-since="0.25">Desde 0.25</span> **Una vez por hora**,
  para todas las entidades: se eliminan las entradas más antiguas que el período de
  retención, sea cual sea la entidad a la que pertenezcan — incluidas las entidades
  en las que nunca se vuelve a escribir, como las eliminadas. Consulta
  [Mecánica del ciclo de vida del purgado](#mecánica-del-ciclo-de-vida-del-purgado).

## Endpoint REST

```
GET /api/data/:slug/:entityId/history
```

Devuelve una lista de entradas del historial para una entidad específica, ordenada de la más reciente a la más antigua:

```json
{
    "data": [
        {
            "id": "5b0e7c2e-…",
            "table_name": "orders",
            "entity_id": "123",
            "action": "update",
            "changed_fields": ["status"],
            "values": { "status": "shipped", "total": 99.99 },
            "previous_values": { "status": "pending" },
            "updated_by": "admin-user-id",
            "updated_at": "2025-01-15T10:30:00Z",
            "format": 2
        }
    ],
    "meta": { "total": 1, "limit": 20, "offset": 0, "hasMore": false }
}
```

```
POST /api/data/:slug/:entityId/history/:historyId/revert
```

Vuelve a escribir los `values` de la entrada en la fila por la vía de guardado normal, así
que el revert se registra a su vez como un `update`. Responde con la fila guardada bajo
`data` y con `meta.reverted_from`, el id de la entrada.

Las entradas escritas por versiones anteriores pueden contener claves para las que la fila
no tiene columna: un campo que calculó un `afterRead` (antes de 0.24, un guardado registraba
la fila tal como la mostraba `afterRead`), o una relación guardada como la vista que de ella
tiene el panel de administración. Un revert escribe las columnas de la fila y omite esas
claves, devolviendo una relación propietaria como su clave foránea, y nombra lo que omitió
en `meta.dropped_fields`. Un valor que un `afterRead` antiguo enmascaró (`********`) sí tiene
columna, así que se escribe de vuelta tal como se registró.

## Configuración de retención

| Configuración | Por defecto | Descripción |
|---------------|-------------|-------------|
| `retention` | 90 | Se eliminan las entradas más antiguas que este número de días. |

Cada entidad también conserva como máximo sus **200** entradas más recientes. Ese límite es fijo; no tiene configuración.

### Mecánica del ciclo de vida del purgado

Tras cada cambio que registra el servidor, se purga la entidad modificada: se eliminan sus
entradas más antiguas que el período de retención y, a continuación, todo lo que supere sus
200 más recientes. Esto se ejecuta de forma asíncrona y no retiene la escritura.

Una escritura hecha mediante [`openRebase` o `rebase console`](/docs/backend/scripts/)
registra su entrada de historial pero no purga nada, porque un script no puede conocer la
retención con la que está configurado tu servidor. El servidor purga esa entidad en su
siguiente escritura sobre ella, y en el barrido horario que sigue.

<span class="since-badge" data-since="0.25">Desde 0.25</span> Una vez por hora, el
backend elimina además todas las entradas más antiguas que el período de retención, de
todas las entidades. Antes, el historial de una entidad en la que nunca se volvía a
escribir — todas las eliminadas — no se purgaba en absoluto. El barrido:

- se ejecuta en una instancia de la flota por hora, en los procesos que ejecutan los
  trabajos programados (reclama su hora en `rebase.cron_claims`, como hace una
  ejecución de cron), la primera vez cuando arranca el backend;
- elimina en lotes de 5.000 entradas, una sentencia cada uno, hasta que un lote vuelve
  corto, saltándose las entradas que otro barrido retiene — así que un primer barrido
  sobre un gran retraso son muchos borrados cortos, no uno largo;
- lee un índice sobre `updated_at`, `idx_history_updated_at`. En una base de datos
  creada antes de la 0.25 se construye en segundo plano tras el primer arranque,
  con `CREATE INDEX CONCURRENTLY`, sin bloquear lecturas ni escrituras — alrededor de un
  segundo por cada 2 millones de entradas.

El mismo arranque elimina `idx_history_entity` donde existe: `idx_history_time`
empieza por las mismas columnas y sirve todas las lecturas que servía aquel, así que
solo ralentizaba cada cambio registrado. La eliminación espera como máximo un segundo
cada vez por el bloqueo de la tabla, y una tabla que algo retiene todo el tiempo conserva
el índice hasta el siguiente arranque.

El tope de 200 entradas por entidad solo se aplica después de una escritura en esa entidad.

## Próximos pasos

- **[Entity Callbacks](/docs/collections/callbacks)** — Hooks de ciclo de vida
- **[Backend Overview](/docs/backend)** — Configuración completa del backend
