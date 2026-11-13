---
sourceHash: faf8f760aabce923
title: Entitätsansichten (Entity Views)
sidebar_label: Entity Views
description: Fügen Sie benutzerdefinierte Tabs und Ansichten zu Entitätsdetailseiten für Vorschauen, Analysen, verknüpfte Daten oder benutzerdefinierte UIs hinzu.
---

## Übersicht

Mit Entitätsansichten (Entity Views) können Sie der Entitätsdetailseite neben dem Standardformular benutzerdefinierte **Tabs** hinzufügen. Verwenden Sie sie für:

- Live-**Vorschauen** (Website-Vorschau, gerenderte Inhalte)
- Ansichten für **verknüpfte Daten** (Bestellpositionen, untergeordnete Entitäten)
- **Analysen** oder Diagramme
- **Benutzerdefinierte Editoren** (Rich-Text, Karten-Editoren)

## Entitätsansichten hinzufügen

<span class="since-badge" data-since="0.31">Since 0.31</span>

```tsx
// frontend/src/cms/products.tsx
import { customizeTable } from "@rebasepro/cms";
import type { products } from "../../../backend/schema/products";
import { ArticlePreview } from "../../../../../components/ArticlePreview";

export const productsCms = customizeTable<typeof products>("products", {
    entityViews: [
        { key: "preview", name: "Preview", Builder: ArticlePreview, position: "start" },
        "related",   // registered once on <RebaseCMS entityViews>
    ],
});
```

Ein Eintrag ist entweder eine Ansicht oder der `key` einer Ansicht, die einmalig unter
`<RebaseCMS entityViews>` (oder `<Rebase entityViews>`) registriert wurde, für Tabs,
die mehrere Tabellen teilen. Eine registrierte Ansicht wird nur auf den Tabellen angezeigt, die ihren Schlüssel angeben.
`position: "start"` platziert den Tab vor dem Formular-Tab; andernfalls wird er dahinter eingefügt.

## Erstellen einer Entitätsansicht

<span class="since-badge" data-since="0.31">Since 0.31</span>

`Builder` ist die Komponente selbst, die als Wert importiert wird:

```tsx
// frontend/src/components/ArticlePreview.tsx
import React from "react";
import type { EntityCustomViewParams } from "@rebasepro/cms-types";

export function ArticlePreview({ row, modifiedValues }: EntityCustomViewParams) {
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

<span class="since-badge" data-since="0.31">Since 0.31</span>

| Prop | Typ | Beschreibung |
|------|------|-------------|
| `row` | `Record<string, unknown>` | Der gespeicherte Datensatz, wie ihn der Server für die Zeile sendet: Datumsangaben als ISO-Strings, ein belongsTo als Fremdschlüsselspalte, `id` nur dort, wo die Tabelle diese Spalte besitzt. Nicht vorhanden, solange ein neuer Datensatz erstellt wird |
| `id` | `string` | Die ID des gespeicherten Datensatzes neben `row`: sein Primärschlüssel als String, bei zusammengesetzten Schlüsseln werden die Teile durch `:::` verbunden. Was `useSidePanel().open` und `useRowWrites().update` erwarten. Nicht vorhanden, solange ein neuer Datensatz erstellt wird |
| `modifiedValues` | `EntityValues` | Aktuelle Formularwerte inklusive ungespeicherter Änderungen (live während der Benutzereingabe), typisiert für den Editor: ein Datum ist ein `Date` |
| `formContext` | `FormContext` | Vollständiger Formularkontext |
| `collection` | `AdminCollection` | Die Collection, wie sie vom CMS aufgelöst wurde |

![Entity view with secondary form](/img/entity_view_secondary_form.png)

Die To-Many-Relationen einer Tabelle sind ebenfalls Tabs des Datensatzes, ganz ohne diesen Aufwand;
siehe [Relationen im Panel](/docs/collections/relations-in-the-admin-panel/).
`defaultSelectedView` in `customizeTable` legt fest, mit welchem Tab sich ein Datensatz öffnet.

## Nächste Schritte

- **[Benutzerdefinierte Felder](/docs/frontend/custom-fields)** — Eigene Formularfelder erstellen
- **[Entitätsaktionen](/docs/frontend/entity-actions)** — Benutzerdefinierte Aktionsschaltflächen
