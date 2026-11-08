---
sourceHash: e44d87326ffbed8c
title: Entity Views
sidebar_label: Entity Views
description: Fügen Sie benutzerdefinierte Tabs und Ansichten zu Entitäts-Detailseiten für Vorschauen, Analysen, verknüpfte Daten oder benutzerdefinierte UIs hinzu.
---

## Übersicht

Entity Views ermöglichen es Ihnen, neben dem Standardformular benutzerdefinierte **Tabs** zur Entitäts-Detailseite hinzuzufügen. Nutzen Sie sie für:

- Live-**Vorschauen** (Website-Vorschau, gerenderte Inhalte)
- Ansichten für **verknüpfte Daten** (Bestellpositionen, untergeordnete Entitäten)
- **Analysen** oder Diagramme
- **Benutzerdefinierte Editoren** (Rich-Text, Karten-Editoren)

## Entity Views hinzufügen

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

## Erstellen einer Entity View

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
| `row` | `Record<string, unknown>` | Der gespeicherte Datensatz, wie der Server die Zeile sendet: Datumsangaben als ISO-Strings, ein belongsTo als seine Fremdschlüssel-Spalte, `id` nur dort, wo die Tabelle diese Spalte hat. Nicht vorhanden, während ein neuer Datensatz erstellt wird |
| `id` | `string` | Die ID des gespeicherten Datensatzes neben `row`: sein Primärschlüssel als String, bei zusammengesetzten Schlüsseln werden die Teile mit `:::` verbunden. Das, was `useSidePanel().open` und `useRowWrites().update` entgegennehmen. Nicht vorhanden, während ein neuer Datensatz erstellt wird |
| `modifiedValues` | `EntityValues` | Aktuelle Formularwerte inklusive ungespeicherter Änderungen (live während der Benutzereingabe), für den Editor typisiert: ein Datum ist ein `Date` |
| `formContext` | `FormContext` | Vollständiger Formularkontext |
| `collection` | `AdminCollection` | Collection-Definition |

![Entity View mit sekundärem Formular](/img/entity_view_secondary_form.png)

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

- **[Custom Fields](/docs/frontend/custom-fields)** — Benutzerdefinierte Formularfelder erstellen
- **[Entity Actions](/docs/frontend/entity-actions)** — Benutzerdefinierte Aktionsschaltflächen
