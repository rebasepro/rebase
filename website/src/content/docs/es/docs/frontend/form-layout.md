---
sourceHash: 93694433369991ae
title: Diseño del formulario
sidebar_label: Diseño del formulario
description: "Organice el formulario de un registro: anchos de campo en una cuadrícula de cuatro columnas, secciones con título y plegables, la barra lateral de metadatos y un componente que reemplaza el formulario generado."
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

El formulario del registro se genera a partir de las columnas y relaciones de la tabla:

- el id y las marcas de tiempo de creación y actualización van a una barra lateral de metadatos de solo lectura;
- todos los demás campos ocupan el ancho completo de la columna principal, excepto que dos campos contiguos con el mismo editor pequeño (dos números, dos interruptores, dos fechas del mismo modo, dos selectores con opciones cortas) comparten una fila.

Un campo con una etiqueta larga, texto de ayuda de más de 60 caracteres, `conditions`, una [regla de acceso](/docs/collections/field-access/) a nivel de columna o un `Field` personalizado nunca se empareja, y tampoco ningún texto libre: nada en un esquema distingue el nombre corto de una rama de una URL larga. Cualquier otra cosa se solicita en `customizeTable`, campo por campo con `span`, y para todo el formulario con `form`.

```ts
// backend/schema/orders.ts
import { defineTable, col } from "@rebasepro/server/schema";

export const orders = defineTable("orders", {
    columns: {
        id:             col.uuid().primaryKey().defaultRandom(),
        reference:      col.text().notNull(),
        sku:            col.text(),
        status:         col.enum(["placed", "shipped", "delivered"]).notNull().default("placed"),
        placedAt:       col.timestamp({ withTimezone: true }),
        address:        col.text(),
        carrier:        col.text(),
        trackingNumber: col.text(),
        notes:          col.text(),
    },
    rls: "admin-only",
});
```

```tsx
// frontend/src/cms/orders.tsx
import { customizeTable } from "@rebasepro/cms";
import type { orders } from "../../../backend/schema/orders";

export const ordersCms = customizeTable<typeof orders>("orders", {
    form: {
        sidebar: ["status", "placedAt"],
        sections: [
            { key: "identity", fields: ["reference", "sku"] },
            { key: "shipping", title: "Shipping", fields: ["address", "carrier", "trackingNumber"] },
            { key: "internal", title: "Internal notes", fields: ["notes"], collapsed: true },
        ],
    },
    fields: {
        reference: { span: 3 },
        sku:       { name: "SKU", span: 1 },
        carrier:   { span: 2 },
        trackingNumber: { span: 2 },
        notes:     { multiline: true },
    },
});
```

## Ancho de campo

<span class="since-badge" data-since="0.31">Desde 0.31</span>

El ancho de un campo es un **span** sobre una cuadrícula de cuatro columnas; `4` es el ancho completo de la columna principal. Los spans se ajustan a la cuadrícula, que es lo que hace que dos campos se alineen sin importar el orden en que fueron declarados.

Elija un span según lo que contiene el campo, no según su tipo. Dos valores cortos que van juntos comparten una fila: fecha de inicio y de fin, ciudad y país, transportista y número de seguimiento con `2` cada uno, o un valor y su calificador con `3` + `1`. Los números, booleanos y códigos cortos pueden tomar `1` junto a sus campos hermanos. Todo lo que sea largo de leer (nombres, URLs, correos electrónicos, identificadores, descripciones, markdown, archivos) mantiene `4`. Las filas se llenan en el orden de los campos y nada ensancha un campo para cerrar un espacio vacío, así que coloque los pares uno al lado del otro y haga que cada fila sume 4.

En disposiciones demasiado estrechas para dos columnas (el panel lateral, el panel dividido, un teléfono), la cuadrícula se reduce a una columna y los spans se ignoran.

## Secciones

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`form.sections` agrupa la columna principal bajo encabezados. Cada sección es `{ key, title?, fields, collapsed?, collapsible?, readVariant? }`. Una sección con título se puede colapsar; una sin título no puede. `readVariant: "summary"` apila los campos de la sección como filas de etiqueta y valor en la vista de solo lectura del registro; el valor predeterminado, `"grid"`, utiliza la cuadrícula del formulario.

Un campo que ninguna sección nombre nunca se descarta: va a parar a la última sección sin título, o a un grupo final sin título cuando no hay ninguna. Una columna agregada a la tabla no puede hacer que un campo desaparezca silenciosamente del formulario. Un error de validación dentro de una sección colapsada la expande.

Cada entrada se verifica con respecto a la tabla. Cualquier entrada que el servidor no entregue a quien realiza la consulta, debido a que no tiene permisos para leer esa columna, se omite.

## La barra lateral de metadatos

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`form.sidebar` traslada los campos fuera de la columna principal a una barra lateral estrecha junto a ella: estado, propiedad, fechas de publicación, indicadores. La barra lateral no utiliza la cuadrícula, por lo que `span` se ignora allí. Donde no haya espacio para una barra lateral, se representa como una sección inicial ordinaria.

`form.showRecordMeta` coloca el bloque de registro de solo lectura (id, created, updated) al pie de la barra lateral. Es `true` siempre que se muestre una barra lateral. `sidebar: []` desactiva la barra lateral derivada y mantiene todos los campos en la columna principal. `hideIdFromForm` oculta el id del formulario por completo.

## Reemplazar el formulario

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`formView` sustituye el formulario generado por un componente propio, importado por valor. Recibe los mismos `EntityCustomViewParams` que una [vista de entidad](/docs/frontend/entity-views/). `includeActions: true` mantiene Guardar y Descartar en la barra del registro mientras está en pantalla.

```tsx
import React from "react";
import { customizeTable } from "@rebasepro/cms";
import type { EntityCustomViewParams } from "@rebasepro/cms-types";
import type { orders } from "../../../backend/schema/orders";

function OrderForm({ row, modifiedValues }: EntityCustomViewParams) {
    return <h2>{String(modifiedValues?.reference ?? row?.reference ?? "New order")}</h2>;
}

export const ordersCms = customizeTable<typeof orders>("orders", {
    formView: { Builder: OrderForm, includeActions: true },
});
```

Para un cambio menor, puede sobrescribir una parte del formulario en su lugar (`Entity.Form`, consulte [Sobrescrituras de componentes](/docs/frontend/component-overrides/)), o diseñar algunos campos usted mismo con `<RecordForm>` y `<FormField>` en una página propia (consulte [Paneles](/docs/frontend/panels/)).

## Otras opciones del formulario

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| Opción | Efecto |
|---|---|
| `formAutoSave` | Guardar a medida que el visitante escribe. |
| `alwaysApplyDefaultValues` | Rellenar los valores predeterminados declarados en los campos vacíos de un registro almacenado cuando este se abre. |
| `includeJsonView` | Agregar una pestaña con el registro en formato JSON. |
| `localChangesBackup` | Mantener las ediciones no guardadas en el almacenamiento local: `"manual_apply"`, `"auto_apply"` o `false`. |

## Relacionado

<span class="since-badge" data-since="0.31">Desde 0.31</span>

- [Campos personalizados](/docs/frontend/custom-fields/): los campos que organiza un diseño
- [Vistas de entidad](/docs/frontend/entity-views/): una pestaña completa propia junto al formulario
- [customizeTable](/docs/frontend/customize-table/#form): las opciones del formulario en la referencia
