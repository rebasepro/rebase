---
title: Vistas de Entidad
sidebar_label: Vistas de Entidad
description: Añada pestañas y vistas personalizadas a las páginas de detalles de la entidad para previsualizaciones, análisis, datos relacionados o UI personalizada.
---

## Visión General

Las vistas de entidad le permiten añadir **pestañas** personalizadas a la página de detalles de la entidad junto con el formulario predeterminado. Úselas para:

- **Previsualizaciones** en vivo (previsualización de sitio web, contenido renderizado)
- Vistas de **datos relacionados** (elementos de pedido, entidades hijas)
- **Análisis** o gráficos
- **Editores personalizados** (texto enriquecido, editores de mapas)

## Añadir Vistas de Entidad

```typescript
import { defineCollection } from "@rebasepro/admin-types";
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

## Construyendo una Vista de Entidad

```tsx
import type { EntityCustomViewParams } from "@rebasepro/admin-types";

function ArticlePreview({
    entity,
    modifiedValues,
    formContext
}: EntityCustomViewParams) {
    // modifiedValues has the unsaved, live form values
    const title = modifiedValues?.title ?? entity?.values?.title;
    const content = modifiedValues?.content ?? entity?.values?.content;

    return (
        <div className="p-8 max-w-2xl mx-auto">
            <h1 className="text-3xl font-semibold">{title}</h1>
            <div dangerouslySetInnerHTML={{ __html: content }} />
        </div>
    );
}
```

### EntityCustomViewParams

| Prop | Type | Descripción |
|------|------|-------------|
| `entity` | `Entity` | La entidad guardada (null para nuevas entidades) |
| `modifiedValues` | `EntityValues` | Valores actuales del formulario sin guardar (en vivo a medida que el usuario escribe) |
| `formContext` | `FormContext` | Contexto completo del formulario |
| `collection` | `CollectionConfig` | Definición de colección |

![Vista de entidad con formulario secundario](/img/entity_view_secondary_form.png)

## Controlando la Posición

Las vistas aparecen como pestañas. Puede configurar su posición:

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

## Próximos Pasos

- **[Campos Personalizados](/docs/frontend/custom-fields)** — Construir campos de formulario personalizados
- **[Acciones de Entidad](/docs/frontend/entity-actions)** — Botones de acción personalizados

---
