---
sourceHash: 8f8ab97f8302c1f8
title: Relaciones en el panel de administración
sidebar_label: Relaciones en el panel de administración
description: "Cómo representa el CMS las relaciones de una tabla: un selector para belongsTo, una pestaña bajo el registro para cada relación to-many, filas propias frente a compartidas, las mismas reglas a través de REST y las opciones de customizeTable para campos de relación."
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

El CMS lee las [relaciones](/docs/collections/relations/) de una tabla a partir de su
descriptor y representa cada una según lo que es:

| Relación | En el registro |
|---|---|
| `belongsTo` | un selector de la fila relacionada, en lugar de su columna de clave foránea |
| `hasOne` | un selector de la fila única relacionada |
| `hasMany`, `manyToMany`, un `via` de tipo to-many | una **pestaña** que lista las filas relacionadas |
| un `via` que no es de escritura | de solo lectura |

```ts
// backend/schema/articles.ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { users } from "./users";
import { tags } from "./tags";

export const articles = defineTable("articles", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull(),
    },
    relations: {
        author:       rel.belongsTo(() => users, { notNull: true }),
        tags:         rel.manyToMany(() => tags),
        featuredTags: rel.manyToMany(() => tags, { through: "articles_featured_tags" }),
    },
    rls: "admin-only",
});
```

El formulario muestra **Author** como un selector de usuario y ningún campo `authorId`: el
selector edita esa columna. Es obligatorio, porque la clave foránea es
`NOT NULL` sin valor por defecto. Una clave foránea que forma parte de la clave primaria
de la tabla permanece como un campo propio junto al selector. **Tags** y **Featured Tags**
son pestañas del registro.

Una relación cuyo destino no se sirve al emisor de la llamada se omite: el CMS no puede
abrir una tabla que no tiene. Un `belongsTo` entonces deja su clave foránea como un
campo simple, de modo que el valor permanezca visible y editable. Un `belongsTo` cuya
clave foránea el emisor no puede leer también se omite.

## El segmento de la ruta es el nombre de la relación

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Las filas de una pestaña se direccionan como `parent/parentId/relationName`:

```text
/c/authors/a-1/posts            the posts of author a-1
/c/articles/p-1/featuredTags    the featured tags of article p-1
```

El último segmento es el **nombre de la relación**, la clave en `relations`, no el
slug del destino. Esto es lo que permite que funcionen dos relaciones hacia la misma tabla: cada una
tiene su propio nombre, por lo que cada una obtiene su propia pestaña y su propia ruta.

## Filas propias frente a filas compartidas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Lo que una pestaña te permite hacer depende de cómo se almacena la relación:

| | Uno a muchos (`hasMany`) | Muchos a muchos (`manyToMany`) |
|---|---|---|
| El hijo pertenece a | solo a este padre | cada padre que lo vincula |
| Crear | crea la fila bajo este padre | crea la fila y la vincula |
| Añadir existente | — | vincula una fila existente |
| Eliminar | **elimina** la fila | la **desvincula**; la fila queda intacta |

Una pestaña de muchos a muchos ofrece **Add existing** y **Remove from this record**, y
nunca una eliminación que quitaría la fila de otros padres.

## Las mismas reglas a través de REST

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Una pestaña es una consulta ordinaria restringida a un padre, por lo que acepta todo lo que
acepta una lista raíz (filtros, `orderBy`, `limit`, `offset`, `include`) y
`meta.total` cuenta las filas filtradas. Filtra por campo (`?field=op.value`) o
con un objeto completo `?where={"field":["op","value"]}`:

```text
GET    /api/data/authors/a-1/posts?status=eq.published&orderBy=title&limit=20
GET    /api/data/authors/a-1/posts?where={"status":["==","published"]}&orderBy=title
GET    /api/data/authors/a-1/posts/p-1
POST   /api/data/authors/a-1/posts          create under this parent
PATCH  /api/data/authors/a-1/posts/p-1      update; will not reparent
DELETE /api/data/authors/a-1/posts/p-1      delete (one-to-many) / unlink (many-to-many)
```

El segmento del padre es obligatorio. Direccionar una fila que no está bajo ese padre
devuelve `404`, y `PATCH` nunca mueve una fila de un padre a otro: establece la
clave foránea explícitamente si eso es lo que deseas.

Para una relación de muchos a muchos, `PATCH parent/id/child/childId` representa la *pertenencia al conjunto*: vincula
la fila si aún no está vinculada y es idempotente. Así es como se asocia una fila
que ya existe.

## Qué no se convierte en una pestaña

<span class="since-badge" data-since="0.31">Desde 0.31</span>

- **Relaciones to-one**: un `belongsTo` o un `hasOne` es un campo del registro, no
  una lista. La escritura a través de una ruta to-one se rechaza.
- **Una tabla con `hideFromEntityViews`** en su `customizeTable` no se ofrece
  como pestaña en los registros de las tablas que se relacionan con ella.

## Personalización de campos de relación

<span class="since-badge" data-since="0.31">Desde 0.31</span>

```tsx
// frontend/src/cms/articles.tsx
import { customizeTable } from "@rebasepro/cms";
import type { articles } from "../../../backend/schema/articles";

export const articlesCms = customizeTable<typeof articles>("articles", {
    fields: {
        author: {
            previewFields: ["displayName", "email"],
            widget: "dialog",
            includeEntityLink: true,
        },
        featuredTags: {
            name: "Featured",
            renderInForm: true,
            overrides: { name: "Featured tags", defaultViewMode: "cards" },
        },
    },
});
```

| Opción | Efecto |
|---|---|
| `previewFields` | Los campos del destino que se muestran en el chip para una fila relacionada. Caben como máximo tres. |
| `widget` | `"select"` selecciona desde un menú desplegable, `"dialog"` desde una tabla con búsqueda. |
| `fixedFilter` | Ofrece solo las filas que pasen este filtro. |
| `includeId` | Muestra el id de la fila relacionada en las vistas previas. |
| `includeEntityLink` | Muestra un enlace que abre la fila relacionada. |
| `renderInForm` | También representa una relación to-many como un selector en el formulario, junto a su pestaña. |
| `overrides` | Cómo se presenta el destino en la pestaña de esta relación: cualquier opción de tabla excepto `fields`. |

`overrides` cambia el estilo de la pestaña, no los campos del destino. Esos pertenecen al
propio `customizeTable` de la tabla de destino, y escribir `fields` dentro de `overrides`
arroja un error.

## Próximos pasos

<span class="since-badge" data-since="0.31">Desde 0.31</span>

- [Relaciones](/docs/collections/relations/): los cinco tipos y cómo declarar cada uno
- [customizeTable](/docs/frontend/customize-table/#relations): opciones de relación en la referencia
- [Escritura a través de REST](/docs/backend/writes/): creación, actualización y eliminación más allá de una pestaña
