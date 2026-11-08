---
sourceHash: 0a2cae1ef41369b1
title: Entitätsansichten
sidebar_label: Entitätsansichten
description: Fügen Sie benutzerdefinierte Tabs und Ansichten zu Entitäts-Detailseiten für Vorschauen, Analysen, verknüpfte Daten oder benutzerdefinierte Benutzeroberflächen hinzu.
---

## Übersicht

Mit Entitätsansichten können Sie der Entitäts-Detailseite neben dem Standardformular benutzerdefinierte **Tabs** hinzufügen. Verwenden Sie sie für:

- Live-**Vorschauen** (Website-Vorschau, gerenderte Inhalte)
- Ansichten für **verknüpfte Daten** (Bestellpositionen, untergeordnete Entitäten)
- **Analysen** oder Diagramme
- **Benutzerdefinierte Editoren** (Rich-Text, Karten-Editoren)

## Hinzufügen von Entitätsansichten

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

## Erstellen einer Entitätsansicht

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

| Prop | Typ | Beschreibung |
|------|------|-------------|
| `row` | `Record<string, unknown>` | Der gespeicherte Datensatz so, wie der Server die Zeile sendet: Datumsangaben als ISO-Strings, ein belongsTo als Fremdschlüsselspalte, `id` enthalten. Nicht vorhanden, während ein neuer Datensatz erstellt wird |
| `modifiedValues` | `EntityValues` | Aktuelle Formularwerte einschließlich nicht gespeicherter Änderungen (live während der Eingabe des Benutzers), für den Editor typisiert: ein Datum ist ein `Date` |
| `formContext` | `FormContext` | Vollständiger Formularkontext |
| `collection` | `AdminCollection` | Collection-Definition |

![Entitätsansicht mit sekundärem Formular](/img/entity_view_secondary_form.png)

## Position steuern

Ansichten werden als Tabs dargestellt. Sie können deren Position konfigurieren:

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

## Nächste Schritte

- **[Benutzerdefinierte Felder](/docs/frontend/custom-fields)** — Benutzerdefinierte Formularfelder erstellen
- **[Entitätsaktionen](/docs/frontend/entity-actions)** — Benutzerdefinierte Aktions-Buttons
