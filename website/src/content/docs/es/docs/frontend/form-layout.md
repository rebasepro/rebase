---
sourceHash: a6f7e70d9dfb90ae
title: Diseño de formulario
sidebar_label: Diseño de formulario
description: Controla cómo se organiza el formulario de entidad — anchos de columna, secciones y el riel de metadatos.
---

## Descripción general

<span class="since-badge" data-since="0.26">Desde 0.26</span>

El formulario de entidad se genera a partir de tus propiedades:

- el id y las marcas de tiempo `createdAt` / `updatedAt` van a un riel de metadatos, de solo lectura
- cualquier otro campo ocupa el ancho completo de la columna principal, excepto que dos
  campos contiguos con el mismo editor pequeño —dos números, dos interruptores,
  dos fechas del mismo modo, dos selectores con opciones cortas— comparten una fila

Un campo con una etiqueta larga, texto de ayuda de más de 60 caracteres, `conditions` o un
`Field` personalizado nunca se empareja, y tampoco lo hace ninguna cadena de texto libre: nada en
un esquema distingue un nombre de rama corto de una URL larga. El formulario nunca comprueba
qué propiedad es el título. Cualquier otra columna es algo que la colección solicita,
campo por campo, con `admin.span` —establecido a partir de lo que contiene cada campo, como
se muestra a continuación. Usa `admin.form` para
agrupar campos en secciones y moverlos al riel.

## Ancho de campo

El ancho de un campo es un **span** sobre una cuadrícula de cuatro columnas. `4` es el ancho completo de
la columna principal.

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

Los spans se ajustan a una cuadrícula compartida, que es lo que hace que dos campos se alineen independientemente
del orden en que fueron declarados. Reemplazaron a `admin.widthPercentage`,
cuyos porcentajes directos no podían alinearse con nada; una colección que aún
conserve uno debería elegir el span más cercano (≤30 → `1`, ≤55 → `2`, ≤80 → `3`,
de lo contrario `4`).

Elige un span en función de lo que contiene el campo, no de su tipo. Dos valores cortos
que van juntos comparten una fila —fecha de inicio y fin, ciudad y país,
proveedor y región con `2` cada uno, o un valor y su calificador con `3` + `1`.
Los números, booleanos y códigos cortos pueden tomar `1` junto a sus hermanos. Cualquier elemento
de lectura larga —nombres, URLs, correos electrónicos, ids, descripciones, markdown, archivos—
conserva `4`. Las filas se completan en orden de declaración y nada ensancha un campo para cerrar un
espacio, así que declara los pares uno al lado del otro y haz que cada fila sume 4.

En diseños demasiado estrechos para dos columnas —el panel lateral, el panel dividido, un teléfono—,
la cuadrícula se reduce a una sola columna y los spans se ignoran.

## Secciones

`sections` agrupa la columna principal bajo encabezados. Una sección con título se puede
contraer; una sin título, no.

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

Una propiedad que ninguna sección nombra nunca se descarta: va a parar a la última
sección sin título, o a un grupo final sin título si no hay ninguna. Por lo tanto, añadir una columna a
la base de datos no puede hacer que un campo desaparezca silenciosamente del formulario.

Un error de validación dentro de una sección contraída la expande, por lo que un error nunca
puede ocultarse detrás de un encabezado cerrado.

## El riel de metadatos

`sidebar` traslada los campos fuera de la columna principal hacia un riel estrecho a su lado —
estado, propiedad, fechas de publicación, indicadores.

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

El riel no utiliza la cuadrícula, por lo que `span` se ignora para los campos que contiene. Donde
no hay espacio para un riel, se renderiza como una sección inicial ordinaria, de modo que
nada se pierde en un teléfono o en el panel lateral.

`showRecordMeta` coloca el bloque de registro de solo lectura —id, creado, actualizado— al
pie del riel. Por defecto es `true` siempre que se muestra un riel, y es lo que
reemplaza a `hideIdFromForm` para la mayoría de las colecciones: el id deja de ser un campo en
medio del formulario y se convierte en una línea de metadatos copiable.

Establece `sidebar: []` para suprimir el riel derivado por completo y mantener todos los campos en
la columna principal.

## Referencia

<span class="since-badge" data-since="0.26">Desde 0.26</span>

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `admin.span` | `1 \| 2 \| 3 \| 4` | Ancho del campo en la cuadrícula de cuatro columnas del formulario |
| `admin.form.sidebar` | `string[]` | Claves de propiedad mostradas en el riel de metadatos |
| `admin.form.sections` | `FormSection[]` | Grupos con título para la columna principal |
| `admin.form.showRecordMeta` | `boolean` | Mostrar id/creado/actualizado al pie del riel |

`FormSection` es `{ key, title?, properties, collapsed?, collapsible?, readVariant? }`. `readVariant: "summary"` apila los campos de la sección como filas etiqueta/valor en la vista de solo lectura del registro; el valor por defecto, `"grid"`, usa la cuadrícula del formulario.

## Relacionado

- [Custom Fields](/docs/frontend/custom-fields/) — el campo que un diseño está organizando
- [Entity Views](/docs/frontend/entity-views/) — una pestaña completa propia junto al formulario
- [Properties](/docs/collections/properties/) — las opciones de propiedad que lee un diseño
