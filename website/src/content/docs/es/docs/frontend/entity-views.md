---
sourceHash: 0a2cae1ef41369b1
title: Vistas de entidad
sidebar_label: Vistas de entidad
description: Añade pestañas y vistas personalizadas a las páginas de detalles de entidades para vistas previas, analíticas, datos relacionados o interfaces de usuario personalizadas.
---

## Descripción general

Las vistas de entidad te permiten añadir **pestañas** personalizadas a la página de detalles de la entidad junto al formulario predeterminado. Úsalas para:

- **Vistas previas** en vivo (vista previa del sitio web, contenido renderizado)
- Vistas de **datos relacionados** (artículos de pedidos, entidades secundarias)
- **Analíticas** o gráficos
- **Editores personalizados** (texto enriquecido, editores de mapas)

## Añadir vistas de entidad

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const articlesCollection = defineCollection({
    slug: "articles",
    table: "articles",
    name: "Articles",
    properties: { /* ... */ },
    admin: {
        entityViews: [
            {
                key: "preview",
                name: "Preview",
                Builder: ArticlePreview
            },
            {
                key: "related",
                name: "Related Articles",
                Builder: RelatedArticlesView
            }
        ]
    }
});

```

## Construir una vista de entidad

```tsx
import type { EntityCustomViewParams } from "@rebasepro/cms-types";

function ArticlePreview({
    row,
    modifiedValues,
    formContext
}: EntityCustomViewParams) {
    // modifiedValues has the unsaved, live form values; row is the saved
    // record. Both are open records, so narrow before rendering.
    const title = String(modifiedValues?.title ?? row?.title ?? "");
    const content = String(modifiedValues?.content ?? row?.content ?? "");

    return (
        <div className="p-8 max-w-2xl mx-auto">
            <h1 className="text-xl font-semibold tracking-[-0.01em]">{title}</h1>
            <div dangerouslySetInnerHTML={{ __html: content }} />
        </div>
    );
}
```

### EntityCustomViewParams

| Prop | Tipo | Descripción |
|------|------|-------------|
| `row` | `Record<string, unknown>` | El registro guardado tal como el servidor envía la fila: fechas como cadenas ISO, un belongsTo como su columna de clave foránea, `id` incluido. Ausente mientras se está creando uno nuevo |
| `modifiedValues` | `EntityValues` | Valores actuales del formulario, incluidas las modificaciones sin guardar (en vivo a medida que el usuario escribe), tipados para el editor: una fecha es un `Date` |
| `formContext` | `FormContext` | Contexto completo del formulario |
| `collection` | `AdminCollection` | Definición de la colección |

![Vista de entidad con formulario secundario](/img/entity_view_secondary_form.png)

## Controlar la posición

Las vistas aparecen como pestañas. Puedes configurar su posición:

```typescript
entityViews: [
    {
        key: "preview",
        name: "Preview",
        Builder: ArticlePreview,
        position: "start"  // Appears before the default form tab
    }
]
```

## Próximos pasos

- **[Campos personalizados](/docs/frontend/custom-fields)** — Construye campos de formulario personalizados
- **[Acciones de entidad](/docs/frontend/entity-actions)** — Botones de acción personalizados
