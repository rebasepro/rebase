---
title: Diseño del formulario
sidebar_label: Diseño del formulario
description: "Controla cómo se organiza el formulario de la entidad: ancho de columnas, secciones y el panel lateral de metadatos."
---

## Overview

El formulario de la entidad se genera a partir de tus propiedades. De forma predeterminada, deriva un diseño de dos columnas según los tipos de propiedad, por lo que una colección que no especifica nada sobre el diseño sigue obteniendo un formulario legible en lugar de una larga lista de entradas de ancho completo:

- el id y las marcas de tiempo `createdAt` / `updatedAt` van a un panel lateral de metadatos, en modo solo lectura
- los enums cortos, booleanos, fechas y números ocupan un ancho estrecho
- los textos largos, markdown, arrays, maps y campos de almacenamiento ocupan el ancho completo
- todo lo demás ocupa la mitad

Utiliza `admin.form` cuando la solución derivada no se ajuste a tu dominio.

## Field width

El ancho de un campo es un **span** (extensión) sobre una cuadrícula de cuatro columnas. `4` es el ancho completo de la columna principal.

```typescript
import { defineCollection } from "@rebasepro/admin-types";

const productsCollection = defineCollection({
    slug: "products",
    table: "products",
    name: "Products",
    properties: {
        sku: {
            name: "SKU",
            type: "string",
            admin: { span: 1 }
        },
        name: {
            name: "Product name",
            type: "string",
            admin: { span: 3 }
        },
        description: {
            name: "Description",
            type: "string",
            admin: { markdown: true, span: 4 }
        }
    }
});
```

Los spans se ajustan a una cuadrícula compartida, que es lo que hace que dos campos se alineen independientemente del orden en que se declararon. Reemplazaron a `admin.widthPercentage`, cuyos porcentajes brutos no se podían alinear con nada; una colección que aún lo conserve debería elegir el span más cercano (≤30 → `1`, ≤55 → `2`, ≤80 → `3`, de lo contrario `4`).

En diseños demasiado estrechos para dos columnas (el panel lateral, el panel dividido, un teléfono), la cuadrícula se reduce a una sola columna y los spans se ignoran.

## Sections

`sections` agrupa la columna principal bajo encabezados. Una sección con título se puede contraer; una sin título, no.

```typescript
import { defineCollection } from "@rebasepro/admin-types";

const ordersCollection = defineCollection({
    slug: "orders",
    table: "orders",
    name: "Orders",
    properties: {
        reference: { name: "Reference", type: "string" },
        placed_at: { name: "Placed at", type: "date" },
        address: { name: "Address", type: "string" },
        carrier: { name: "Carrier", type: "string" },
        tracking_number: { name: "Tracking number", type: "string" },
        notes: { name: "Notes", type: "string" }
    },
    admin: {
        form: {
            sections: [
                { key: "identity", properties: ["reference", "placed_at"] },
                {
                    key: "shipping",
                    title: "Shipping",
                    properties: ["address", "carrier", "tracking_number"]
                },
                {
                    key: "internal",
                    title: "Internal notes",
                    properties: ["notes"],
                    collapsed: true
                }
            ]
        }
    }
});
```

Una propiedad que ninguna sección mencione nunca se omite: termina en la última sección sin título, o en un grupo final sin título si no hay ninguna. Por lo tanto, agregar una columna a la base de datos no puede hacer que un campo desaparezca silenciosamente del formulario.

Un error de validación dentro de una sección contraída la despliega, por lo que un error nunca podrá ocultarse tras un encabezado cerrado.

## The metadata rail

`sidebar` mueve campos fuera de la columna principal a un panel lateral estrecho junto a ella: estado, propiedad, fechas de publicación, indicadores (flags).

```typescript
import { defineCollection } from "@rebasepro/admin-types";

const postsCollection = defineCollection({
    slug: "posts",
    table: "posts",
    name: "Posts",
    properties: {
        title: { name: "Title", type: "string" },
        body: { name: "Body", type: "string", admin: { markdown: true } },
        status: { name: "Status", type: "string" },
        publishedAt: { name: "Published at", type: "date" },
        author: { name: "Author", type: "string" }
    },
    admin: {
        form: {
            sidebar: ["status", "publishedAt", "author"],
            showRecordMeta: true
        }
    }
});
```

El panel lateral no utiliza la cuadrícula, por lo que `span` se ignora para los campos que contiene. Cuando no hay espacio para un panel lateral, se renderiza como una sección inicial ordinaria, por lo que no se pierde nada en un teléfono o en el panel lateral.

`showRecordMeta` coloca el bloque de registro de solo lectura (id, creado, actualizado) al pie del panel lateral. Su valor predeterminado es `true` siempre que se muestre un panel lateral, y es lo que reemplaza a `hideIdFromForm` en la mayoría de las colecciones: el id deja de ser un campo en medio del formulario y se convierte en una línea de metadatos copiable.

Configura `sidebar: []` para suprimir por completo el panel lateral derivado y mantener todos los campos en la columna principal.

## Reference

| Propiedad | Tipo | Descripción |
|----------|------|-------------|
| `admin.span` | `1 \| 2 \| 3 \| 4` | Ancho del campo sobre la cuadrícula del formulario de cuatro columnas |
| `admin.form.sidebar` | `string[]` | Claves de propiedad mostradas en el panel lateral de metadatos |
| `admin.form.sections` | `FormSection[]` | Grupos con título para la columna principal |
| `admin.form.showRecordMeta` | `boolean` | Muestra id/creado/actualizado al pie del panel lateral |

`FormSection` es `{ key, title?, properties, collapsed?, collapsible? }`.
