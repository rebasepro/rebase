---
title: Ansichtsmodi
sidebar_label: Ansichtsmodi
description: Konfigurieren Sie Tabellen-, Karten- und Kanban-Board-Ansichten für Ihre Sammlungen.
---

## Übersicht

Jede Sammlung kann in vier Ansichtsmodi angezeigt werden:

- **Liste** — Einfache, saubere Listenansicht (die klassische CMS-Standardansicht)
- **Tabelle** — Tabellenähnliches Raster mit Inline-Bearbeitung, Sortierung, Filterung
- **Karten** — Kartenraster für visuelle Inhalte (Bilder, Vorschauen)
- **Kanban** — Drag-and-drop-Board, gruppiert nach einer Enum-Eigenschaft

## Konfiguration

```typescript
import { defineCollection } from "@rebasepro/admin-types";
const productsCollection = defineCollection({
    slug: "products",
    properties: { /* … */ },
    name: "Products",
    table: "products",
    // ...
    admin: {
        defaultViewMode: "table",            // Default view
        enabledViews: ["list", "table", "kanban"],    // Available views
        kanban: {
            columnProperty: "status",        // Enum property for columns
            orderProperty: "sortOrder"      // Property for drag-and-drop ordering
        }
    }
});

```

## Listenansicht

![Screenshot-Platzhalter für Listenansicht](/img/features/list-view.png)

Die Listenansicht ist der klassische, saubere CMS-Standardansichtsmodus, der Entitäten in einem unkomplizierten Listenformat ohne die Dichte einer Tabelle darstellt.

## Tabellenansicht

![Screenshot-Platzhalter für Tabellenansicht](/img/features/table-view.png)

Die Standardansicht ist eine hochleistungsfähige virtualisierte Tabelle mit:

- **Inline-Bearbeitung** — Klicken Sie auf eine beliebige Zelle, um sie direkt zu bearbeiten
- **Spaltengrößenanpassung** — Spaltenüberschriften ziehen
- **Spaltenneuanordnung** — Ziehen, um neu anzuordnen
- **Sortierung** — Klicken Sie auf Spaltenüberschriften
- **Textsuche** — Volltextsuche über Zeichenfolgenfelder
- **Filterung** — Spaltenbezogene Filter
- **Mehrfachauswahl** — Entitäten für Massenaktionen auswählen

### Zeilenhöhe

Steuern Sie die Zeilenhöhe mit `defaultSize`:

| Größe | Pixel | Am besten geeignet für |
|------|--------|----------|
| `"xs"` | 40 | Dichte Datentabellen |
| `"s"` | 54 | Standard |
| `"m"` | 80 | Mit Bildminiaturen |
| `"l"` | 120 | Karten mit Vorschauen |
| `"xl"` | 260 | Vorschauen von Rich Media Inhalten |

## Kanban-Ansicht

![Screenshot-Platzhalter für Kanban-Ansicht](/img/features/kanban-view.png)

Konfigurieren Sie ein Kanban-Board, indem Sie festlegen, welche Enum-Eigenschaft als Spalten verwendet werden soll:

```typescript
import { defineCollection } from "@rebasepro/admin-types";
const tasksCollection = defineCollection({
    slug: "tasks",
    name: "Tasks",
    table: "tasks",
    properties: {
        title: { type: "string", name: "Title" },
        status: {
            type: "string",
            name: "Status",
            enum: [
                { id: "backlog", label: "Backlog", color: "gray" },
                { id: "in_progress", label: "In Progress", color: "blue" },
                { id: "review", label: "Review", color: "orange" },
                { id: "done", label: "Done", color: "green" }
            ]
        },
        sortOrder: { type: "number", name: "Sort Order" }
    },
    admin: {
        defaultViewMode: "kanban",
        kanban: {
            columnProperty: "status",
            orderProperty: "sortOrder"
        }
    }
});

```

Drag-and-drop zwischen Spalten aktualisiert automatisch das Enum-Feld und die Sortierreihenfolge.

## Kartenansicht

![Screenshot-Platzhalter für Kartenansicht](/img/features/cards-view.png)

Karten zeigen Entitäten als visuelle Karten an – nützlich für inhaltsreiche Inhalte mit vielen Bildern:

```typescript
import { defineCollection } from "@rebasepro/admin-types";
const articlesCollection = defineCollection({
    slug: "articles",
    name: "Articles",
    table: "articles",
    properties: {
        title: { type: "string", name: "Title" },
        cover: {
            type: "string",
            name: "Cover Image",
            storage: { storagePath: "covers", acceptedFiles: ["image/*"] }
        }
    },
    admin: {
        defaultViewMode: "cards"
    }
});

```

## Nächste Schritte

- **[Entitätsansichten](/docs/frontend/entity-views)** — Benutzerdefinierte Tabs in Entitätsformularen
- **[Entitätsaktionen](/docs/frontend/entity-actions)** — Benutzerdefinierte Entitätsaktionen
---
