---
sourceHash: 37c268f3d4b76c7f
title: Historial de entidades
sidebar_label: Historial de entidades
description: Rastrea cada cambio en tus entidades con un registro de auditoría completo — quién cambió qué, cuándo y la entidad completa antes y después.
---

## Descripción general

El historial de entidades registra una instantánea de los valores de la entidad en cada creación, actualización y eliminación. Esto proporciona un registro de auditoría completo con diferencias (diffs).

## Habilitar el historial

:::note[Dónde va esto]
**Runtime gestionado** — activado por defecto. `REBASE_HISTORY=false` en `.env` lo desactiva.

**Ejected** — `history: true` en `initializeRebaseBackend({ … })`. La forma de objeto a continuación — `{ retention }` — es solo para ejected; la variable de entorno es un booleano.

El mapa completo está en [Información general del backend](/docs/backend/#where-each-option-lives).
:::

### Backend

:::note[Dónde va esto]
**Runtime gestionado:** `REBASE_HISTORY` (`true` por defecto; establece `false` para desactivarlo). La configuración de retención no tiene forma de variable de entorno — haz eject para cambiarla.
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

### Por tabla

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Marca qué tablas rastrean el historial con `history: true`:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const orders = defineTable("orders", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        status: col.enum(["open", "paid", "shipped"]).notNull().default("open"),
        total:  col.numeric({ precision: 10, scale: 2 }).notNull(),
    },
    history: true,
    rls: "admin-only",
});
```

Una vista no puede rastrear el historial: nunca se escribe.

## Cómo funciona

1. El backend crea una tabla `rebase.entity_history` automáticamente.
2. En cada creación, actualización o eliminación, se registra una entrada con:
   - ID de la entidad y el slug de la tabla (en `table_name`)
   - Los valores de la entidad después del cambio (`values`; para una eliminación, la entidad
     que fue eliminada)
   - En una actualización, lo que contenían los campos modificados antes de esta (`previous_values`)
   - Marca de tiempo e ID de usuario
   - La acción (`create`, `update`, `delete`)
   - Un array de `changed_fields` que muestra qué columnas fueron modificadas

Los valores son la fila tal como la sirve la API REST: sus columnas, fechas como
marcas de tiempo, un `belongsTo` como su clave foránea. Eso es lo que reescribe una reversión.

Una entrada nunca contiene los valores de una fila relacionada. Leer el historial de una fila
solo requiere acceso de lectura a esa fila, no a las filas a las que apunta, por lo que un `belongsTo`
se mantiene como su clave foránea y nada más.

Las entradas que versiones anteriores registraron a través de la vista de la fila del panel de administración
(una eliminación solía almacenarla) se sirven, y se revierten, como la fila que representan:
un envoltorio `{ "__type": "date", "value" }` como su valor, una referencia
`{ "__type": "relation" }` de una relación propietaria como la clave foránea bajo
el propio nombre de la clave, cualquier otra referencia de relación como la clave de la fila relacionada, y una
fila relacionada que la referencia embebía nunca se sirve. Revertir dicha entrada escribe
esos valores planos; una lista to-many que contenga no se escribe, y se nombra en
`dropped_fields`.

En una tabla con [eliminación suave (soft delete)](/docs/collections/soft-delete/), una eliminación se
registra como `delete` y una restauración (la actualización que restablece el campo de soft-delete
a `null`) como `update`. El historial de una fila sigue siendo legible mientras la fila está en
la papelera, y revertirla a una versión anterior a la eliminación la restaura.

### Qué contiene `previous_values`

Una entrada de actualización conserva,
en `previous_values`, únicamente los campos listados en `changed_fields`. Todos los
demás campos tenían el mismo valor antes y después del cambio, por lo que ya están en
`values`; almacenar la fila completa dos veces le costaba a un cambio de un solo campo en una
fila de 20 campos 1.269 bytes, donde ahora cuesta 794.

Las entradas registradas antes de 0.25 conservan toda la fila anterior. El `format`
de la entrada indica cuál es:

| `format` | `previous_values` en una actualización |
|---|---|
| `1` (entradas anteriores a 0.25) | La fila completa antes del cambio |
| `2` | Solo los `changed_fields`, cada uno tal como lo tenía la fila completa |

La vista del historial del admin y una reversión leen ambos de la misma manera: la vista muestra el
valor anterior de cada campo modificado, y una reversión escribe los `values` de la entrada elegida,
que están completos en ambos formatos. Para reconstruir la fila tal como estaba antes de un
cambio con `format: 2`, toma `values` y vuelve a colocar cada campo que contiene `previous_values`.

### Rastreo de diferencias e igualdad estructural profunda

Para evitar registrar logs redundantes donde los campos se guardan pero no cambian los valores, el `HistoryService` realiza una comparación de igualdad estructural profunda en las claves de nivel superior de los valores antiguos y nuevos:
- Ignora los campos de metadatos del sistema que comienzan con `__`.
- Si se encuentran diferencias, los nombres de los campos modificados se guardan en la columna `changed_fields` (`text[]`).
- Si la comprobación de igualdad profunda detecta cero cambios, la inserción en el historial se omite por completo.

### Purga

La retención se aplica en dos lugares:
- **Después de cada escritura**, para la entidad escrita: justo después de que se guarda o
  elimina, el servidor purga las entradas de esa entidad que superen las 200 más recientes, o
  que sean más antiguas que el período de retención. Esto no retrasa la escritura.
- **Una vez por hora**,
  para cada entidad: las entradas más antiguas que el período de retención se eliminan
  sin importar a qué pertenezcan — incluidas las entidades que nunca se vuelven a escribir,
  como las eliminadas. Consulta [Mecánica del ciclo de vida de purga](#mecánica-del-ciclo-de-vida-de-purga).

## Endpoint REST

```
GET /api/data/:slug/:entityId/history
```

Devuelve una lista de entradas de historial para una entidad específica, ordenadas por la más reciente primero. <span class="since-badge" data-since="0.31">Desde 0.31</span> Las entradas que registra una transacción — una creación y la actualización posterior en un solo `_batch`, una reversión y su respectiva reversión — se devuelven en el orden en que se escribieron: el `updated_at` de cada entrada es posterior a la entrada previa de la fila. Una base de datos existente obtiene esto con su próximo arranque de aprovisionamiento, o con una ejecución con `REBASE_PROVISION_ONLY=true`, lo que reemplaza la función `rebase.record_history`; un despliegue que nunca se aprovisiona mantiene el orden anterior hasta entonces. Las entradas registradas antes de eso conservan su orden.

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

### Las entradas se sirven como lecturas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Las entradas de historial se sirven de la misma manera que la fila: acceso a nivel de campo primero,
luego `afterRead` (global, tabla, columna), dentro de la transacción de solo lectura del
solicitante. Una columna que un hook o un `.transform({ afterRead })` enmascara se enmascara
en `values` y `previous_values`; una columna que los roles del solicitante no pueden leer se
retiene y se excluye de `changed_fields`; las claves de columnas que la tabla ya no
tiene se retienen. Quienquiera que pueda leer la fila ahora puede ver su historial, y
`updated_by` se mantiene. Un hook que lance una excepción en una instantánea antigua falla la
solicitud en lugar de servirla sin enmascarar, y el historial de una fila eliminada de forma permanente (hard delete) responde
404 ("No row with id '…' in table '…'").

El controlador de Postgres hace esto; un controlador personalizado sirve el historial implementando
`DataDriver.serveStoredRows(path, rows)`, y sin él las rutas de historial
responden 501. Antes de 0.31, las entradas se servían tal como estaban almacenadas.

```
POST /api/data/:slug/:entityId/history/:historyId/revert
```

Escribe los `values` de la entrada de vuelta en la fila a través de la ruta normal de guardado, por lo que la
reversión en sí misma se registra como un `update`. Responde con la fila guardada bajo `data`
y `meta.reverted_from`, el id de la entrada. Una reversión nunca escribe una columna que el solicitante
no pueda leer: esas mantienen su valor actual.

Las entradas escritas por versiones anteriores pueden contener claves para las cuales la fila no tiene columna: un
campo que un `afterRead` calculaba (antes de 0.24, un guardado registraba la fila tal como
`afterRead` la mostraba), o una relación almacenada según la vista del panel de administración.
Una reversión escribe las columnas de la fila y omite esas claves, volviendo una relación
propietaria como su clave foránea, y lista lo omitido en
`meta.dropped_fields`. Un valor que un `afterRead` antiguo enmascaró (`********`) tiene una
columna, por lo que se vuelve a escribir tal como fue registrado.

## Configuración de retención

| Configuración | Por defecto | Descripción |
|---------|---------|-------------|
| `retention` | 90 | Se eliminan las entradas más antiguas que esta cantidad de días. |

Cada entidad también conserva a lo sumo sus **200** entradas más recientes. Ese límite es fijo; no
tiene configuración.

### Mecánica del ciclo de vida de purga

Después de cada cambio que el servidor registra, la entidad modificada se purga: se eliminan
sus entradas más antiguas que el período de retención, y luego todo lo que exceda sus 200 más
recientes. Esto se ejecuta de forma asíncrona y no retrasa la escritura.

Una escritura realizada a través de [`openRebase` o `rebase console`](/docs/backend/scripts/)
registra su entrada de historial pero no purga nada, porque un script no puede conocer la
retención configurada en tu servidor. El servidor purga esa entidad en su
siguiente escritura sobre ella, y en el barrido horario que se describe a continuación.

Una vez por hora, el
backend también elimina todas las entradas anteriores al período de retención, de cada
entidad. Antes de esto, el historial de una entidad que nunca más se volvía a escribir —
todas las eliminadas — no se purgaba en absoluto. El barrido:

- se ejecuta en una instancia del clúster por hora, en los procesos que ejecutan las
  tareas programadas (reclama su hora en `rebase.cron_claims`, como lo hace una ejecución de cron),
  inicialmente cuando el backend se inicia;
- elimina en lotes de 5.000 entradas, una sentencia para cada uno, hasta que un lote devuelva
  menos elementos, omitiendo las entradas que otro barrido mantiene bloqueadas — por lo que un primer barrido sobre un
  gran atraso consiste en muchas eliminaciones cortas, no una sola larga;
- lee un índice en `updated_at`, `idx_history_updated_at`. En una base de datos
  creada antes de 0.25, se construye en segundo plano después del primer arranque,
  `CREATE INDEX CONCURRENTLY`, sin bloquear lecturas ni escrituras — aproximadamente un
  segundo por cada 2 millones de entradas.

El mismo arranque elimina `idx_history_entity` donde exista: `idx_history_time`
comienza con las mismas columnas y atiende todas las lecturas que este hacía, por lo que solo ralentizaba cada
cambio registrado. La eliminación espera como máximo un segundo por intento para obtener el bloqueo de la tabla,
y una tabla que esté ocupada por completo mantiene el índice hasta el próximo arranque.

El límite de 200 entradas por entidad se aplica únicamente después de una escritura en esa entidad.

## Próximos pasos

- **[Hooks de tabla](/docs/collections/callbacks/)** — Hooks de ciclo de vida
- **[Información general del backend](/docs/backend)** — Configuración completa del backend
