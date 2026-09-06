---
sourceHash: af85efb5a9d69006
title: Entitätsansichten
sidebar_label: Entitätsansichten
description: Fügen Sie benutzerdefinierte Tabs und Ansichten zu Entitätsdetailseiten für Vorschauen, Analysen, verknüpfte Daten oder benutzerdefinierte Benutzeroberflächen hinzu.
---

## Übersicht

Entitätsansichten ermöglichen es Ihnen, benutzerdefinierte **Tabs** zur Entitätsdetailseite neben dem Standardformular hinzuzufügen. Verwenden Sie sie für:

- Live-**Vorschauen** (Website-Vorschau, gerenderter Inhalt)
- Ansichten für **verknüpfte Daten** (Bestellpositionen, untergeordnete Entitäten)
- **Analysen** oder Diagramme
- **Benutzerdefinierte Editoren** (Rich-Text, Karteneditoren)

## Entitätsansichten hinzufügen

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

## Eine Entitätsansicht erstellen

```tsx
import type { EntityCustomViewParams } from "@rebasepro/cms-types";

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

| Eigenschaft | Typ | Beschreibung |
|------|------|-------------|
| `entity` | `Entity` | Die gespeicherte Entität (null für neue Entitäten) |
| `modifiedValues` | `EntityValues` | Aktuelle ungespeicherte Formularwerte (live während der Benutzereingabe) |
| `formContext` | `FormContext` | Voller Formular-Kontext |
| `collection` | `CollectionConfig` | Sammlungsdefinition |

![Entitätsansicht mit sekundärem Formular](/img/entity_view_secondary_form.png)

## Position steuern

Ansichten erscheinen als Tabs. Sie können deren Position konfigurieren:

```typescript
entityViews: [
    {
        key: "preview",
        name: "Preview",
        Builder: ArticlePreview,
        position: "start"  // Erscheint vor dem Standard-Formular-Tab
    }
]
```

## Nächste Schritte

- **[Benutzerdefinierte Felder](/docs/frontend/custom-fields)** — Erstellen Sie benutzerdefinierte Formularfelder
- **[Entitätsaktionen](/docs/frontend/entity-actions)** — Benutzerdefinierte Aktionsschaltflächen
---
