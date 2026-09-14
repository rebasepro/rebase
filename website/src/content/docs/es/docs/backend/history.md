---
sourceHash: 2c6e24a9d83f64ab
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
2. En cada creación, actualización o eliminación, se registra una instantánea con:
   - El ID de la entidad y el slug de la colección (en `table_name`)
   - Los valores completos de la entidad (antes y después)
   - Marca de tiempo e ID de usuario
   - La acción (`create`, `update`, `delete`)
   - Un array de `changed_fields` que muestra qué columnas se modificaron

### Seguimiento de diferencias e igualdad estructural profunda

Para evitar registrar logs redundantes donde los campos se guardan pero ningún valor cambia, el `HistoryService` realiza una comparación de igualdad estructural profunda (deep equality) en las claves de nivel superior de los valores antiguos y nuevos:
- Ignora las propiedades de metadatos del sistema que comienzan con `__`.
- Si se encuentran diferencias, los nombres de las propiedades modificadas se guardan en la columna `changed_fields` (`text[]`).
- Si la verificación de igualdad profunda detecta cero cambios, la inserción en el historial se omite por completo.

### Purgado no bloqueante posterior al guardado

A diferencia de los sistemas tradicionales que dependen por completo de scripts por lotes periódicos y lentos, Rebase aplica tus políticas de retención de forma continua:
- Justo después de guardar o eliminar una entidad, el servidor programa un **barrido asíncrono en línea** en una promesa no bloqueante de tipo fire-and-forget.
- Este barrido comprueba inmediatamente los límites de retención para ese ID de entidad específico y purga las entradas que superen las 200 más recientes, o que sean más antiguas que el período de retención.

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
            "previous_values": { "status": "pending", "total": 99.99 },
            "updated_by": "admin-user-id",
            "updated_at": "2025-01-15T10:30:00Z"
        }
    ],
    "meta": { "total": 1, "limit": 20, "offset": 0, "hasMore": false }
}
```

## Configuración de retención

| Configuración | Por defecto | Descripción |
|---------------|-------------|-------------|
| `retention` | 90 | Se eliminan las entradas más antiguas que este número de días. |

Cada entidad también conserva como máximo sus **200** entradas más recientes. Ese límite es fijo; no tiene configuración.

### Mecánica del ciclo de vida del purgado

El purgado solo se realiza en línea. Se ejecuta de forma asíncrona justo después de cada cambio registrado, para la entidad modificada: se eliminan las entradas más antiguas que el período de retención y, a continuación, todo lo que supere las 200 más recientes. No hay ningún barrido periódico, por lo que el historial de una entidad en la que nunca se vuelva a escribir no se purga — sus entradas antiguas permanecen hasta el siguiente cambio en esa entidad o hasta que las elimines de `rebase.entity_history` tú mismo.

## Próximos pasos

- **[Entity Callbacks](/docs/collections/callbacks)** — Hooks de ciclo de vida
- **[Backend Overview](/docs/backend)** — Configuración completa del backend
