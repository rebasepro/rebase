---
sourceHash: 3830846c0457a79f
title: Diseño del formulario
sidebar_label: Diseño del formulario
description: "Controla cómo se organiza el formulario de la entidad: extensiones de columna, secciones y la barra de metadatos."
---

## Descripción general

El formulario de la entidad se genera a partir de tus propiedades. De forma predeterminada, deriva un diseño de dos columnas a partir de los tipos de propiedad, por lo que una colección que no especifica nada sobre el diseño sigue obteniendo un formulario que se lee como tal, en lugar de una larga lista de campos de entrada de ancho completo:

- el id y las marcas de tiempo `createdAt` / `updatedAt` van a una barra de metadatos, en modo de solo lectura
- los enums cortos, booleanos, fechas y números ocupan un ancho estrecho
- el texto largo, markdown, arrays, maps y campos de almacenamiento ocupan el ancho completo
- todo lo demás ocupa la mitad

Usa `admin.form` cuando la respuesta derivada no sea la adecuada para tu dominio.

## Ancho de campo

El ancho de un campo es un **span** sobre una cuadrícula de cuatro columnas. `4` es el ancho completo de la columna principal.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

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

Los spans se ajustan a una cuadrícula compartida, lo que hace que dos campos se alineen independientemente del orden en el que se hayan declarado. Reemplazaron a `admin.widthPercentage`, cuyos porcentajes directos no podían alinearse con nada; una colección que todavía lo conserve debería elegir el span más cercano (≤30 → `1`, ≤55 → `2`, ≤80 → `3`, de lo contrario `4`).

En diseños demasiado estrechos para dos columnas (el panel lateral, el panel dividido o un teléfono), la cuadrícula se colapsa a una sola columna y los spans se ignoran.

## Secciones

`sections` agrupa la columna principal bajo encabezados. Una sección con título se puede colapsar; una sin título, no.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

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

Una propiedad que ninguna sección mencione nunca se descarta: se ubica en la última sección sin título, o en un grupo final sin título si no hay ninguno. Por lo tanto, añadir una columna a la base de datos no puede hacer que un campo desaparezca silenciosamente del formulario.

Un error de validación dentro de una sección colapsada hace que esta se expanda, por lo que un error nunca puede quedar oculto detrás de un encabezado cerrado.

## La barra de metadatos

`sidebar` traslada los campos fuera de la columna principal a una barra estrecha situada junto a ella: estado, propiedad, fechas de publicación, indicadores.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

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

La barra no utiliza la cuadrícula, por lo que `span` se ignora para los campos situados en ella. Cuando no hay espacio para una barra lateral, se muestra como una sección inicial ordinaria, por lo que no se pierde nada en un teléfono o en el panel lateral.

`showRecordMeta` coloca el bloque de registro de solo lectura (id, creación, actualización) al pie de la barra. Su valor predeterminado es `true` siempre que se muestre una barra, y es lo que reemplaza a `hideIdFromForm` para la mayoría de las colecciones: el id deja de ser un campo en medio del formulario y se convierte en una línea de metadatos que se puede copiar.

Establece `sidebar: []` para suprimir la barra derivada por completo y mantener todos los campos en la columna principal.

## Referencia

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `admin.span` | `1 \| 2 \| 3 \| 4` | Ancho del campo sobre la cuadrícula de formulario de cuatro columnas |
| `admin.form.sidebar` | `string[]` | Claves de propiedad que se muestran en la barra de metadatos |
| `admin.form.sections` | `FormSection[]` | Grupos con título para la columna principal |
| `admin.form.showRecordMeta` | `boolean` | Muestra id/creación/actualización al pie de la barra |

`FormSection` es `{ key, title?, properties, collapsed?, collapsible? }`.

## Relacionado

- [Campos personalizados](/docs/frontend/custom-fields/) — el campo que organiza un diseño
- [Vistas de entidad](/docs/frontend/entity-views/) — una pestaña completa propia junto al formulario
- [Propiedades](/docs/collections/properties/) — las opciones de propiedad que lee un diseño
