---
sourceHash: 608b8f9f3290a362
title: Ansichtsmodi
sidebar_label: Ansichtsmodi
description: Konfigurieren Sie Tabellen-, Karten- und Kanban-Board-Ansichten für Ihre Collections.
---

## Übersicht

Jede Collection kann in vier Ansichtsmodi dargestellt werden:

- **Liste** — Einfache, übersichtliche Listenansicht (der klassische CMS-Standard)
- **Tabelle** — Tabellenkalkulations-Grid mit Inline-Bearbeitung, Sortierung, Filterung
- **Karten** — Kartengitter für visuelle Inhalte (Bilder, Vorschauen)
- **Kanban** — Drag-and-Drop-Board, gruppiert nach einer Enum-Eigenschaft

Dies sind die integrierten Modi. Eine Collection kann auch von Ihnen erstellte Ansichtsmodi bieten — einen Kalender, eine Karte, eine Galerie — im selben Umschalter, gesteuert über dieselbe Toolbar: siehe [Benutzerdefinierte Ansichtsmodi](/docs/frontend/extending#benutzerdefinierte-ansichtsmodi-custom-view-modes) und das Kalender-Rezept in [Admin anpassen](/docs/frontend/customizing).

## Konfiguration

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const productsCollection = defineCollection({
    slug: "products",
    // `orderProperty` and `kanban.columnProperty` are checked against these
    // keys — with an empty `properties` block they narrow to `never`.
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        status: { name: "Status", type: "string" },
        // The order key. A *string*, never a number — see "Ordering" below.
        __order: {
            name: "Order",
            type: "string",
            admin: { disabled: true, hideFromCollection: true }
        }
    },
    name: "Products",
    table: "products",
    admin: {
        defaultViewMode: "table",            // Default view
        enabledViews: ["list", "table", "kanban"],    // Available views
        orderProperty: "__order",           // Property for drag-and-drop ordering
        kanban: {
            columnProperty: "status"         // Enum property for columns
        }
    }
});

```

## Listenansicht

Die Listenansicht ist der klassische, übersichtliche Standard-Ansichtsmodus des CMS, der Entitäten in einem geradlinigen Listenformat ohne die Dichte einer Tabellenkalkulation darstellt.

## Tabellenansicht

Die Tabellenansicht ist eine hochperformante, virtualisierte Tabellenkalkulation mit:

- **Inline-Bearbeitung** — Klicken Sie auf eine beliebige Zelle, um sie direkt zu bearbeiten
- **Spaltenbreite anpassen** — Ziehen von Spaltenüberschriften
- **Spalten neu anordnen** — Ziehen zum Neuanordnen
- **Sortierung** — Klick auf Spaltenüberschriften
- **Textsuche** — Volltextsuche über String-Felder hinweg
- **Filterung** — Filter pro Spalte
- **Mehrfachauswahl** — Entitäten für Bulk-Aktionen auswählen

### Zeilenhöhe

Steuern Sie die Zeilenhöhe mit `defaultSize`:

| Größe | Pixel | Am besten für |
|-------|-------|---------------|
| `"xs"` | 36 | Dichte Datentabellen |
| `"s"` | 42 | Kompakte Textzeilen |
| `"m"` | 48 | Standard |
| `"l"` | 96 | Mittlere Bild-Thumbnails |
| `"xl"` | 160 | Große Bild-Thumbnails |

## Kanban-Ansicht

Konfigurieren Sie ein Kanban-Board, indem Sie angeben, welche Enum-Eigenschaft als Spalten verwendet werden soll:

```typescript
import { defineCollection } from "@rebasepro/cms-types";
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
        __order: {
            type: "string",
            name: "Order",
            admin: { disabled: true, hideFromCollection: true }
        }
    },
    admin: {
        defaultViewMode: "kanban",
        orderProperty: "__order",
        kanban: {
            columnProperty: "status"
        }
    }
});

```

Drag-and-Drop zwischen Spalten aktualisiert das Enum-Feld und die Sortierreihenfolge automatisch.

### Sortierung

`kanban` und `orderProperty` sind zwei Hälften desselben Features. Deklarieren Sie immer beide — drei typische Fehler führen hier zu einem Board, das konfiguriert aussieht, es aber nicht ist.

**`orderProperty` ist nicht optional.** Ohne diese Eigenschaft lässt sich eine Karte zwar weiterhin zwischen Spalten verschieben, da dies `columnProperty` schreibt. Ihre Position *innerhalb* einer Spalte kann jedoch nirgendwo gespeichert werden, sodass sie beim nächsten Lesen zurückgesetzt wird und das Board einen bernsteinfarbenen Balken anzeigt, der darauf hinweist, dass die Sortierung nicht konfiguriert ist.

**Die Eigenschaft muss ein `string` sein.** Das Neuanordnen schreibt einen [fractional-indexing](https://github.com/rocicorp/fractional-indexing)-Schlüssel — `"i0"`, `"i1"`, `"i0i"` — keinen Index. Eine `number`-Eigenschaft kann diesen niemals aufnehmen, weshalb ein numerisches `sortOrder` dazu führt, dass das Board endlos zur Initialisierung auffordert, und die Initialisierung selbst bei einer numerischen Spalte fehlschlägt. Deklarieren Sie sie als ausgeblendet; sie dient der internen Logik, nicht dem Inhalt:

```typescript
__order: {
    type: "string",
    name: "Order",
    admin: { disabled: true, hideFromCollection: true }
}
```

**Außerhalb des Admin-Bereichs erstellte Zeilen werden ohne Schlüssel geliefert.** Beim Einfügen wird keiner zugewiesen. Eine Zeile, die durch einen Cronjob, ein Seed-Skript, eine Migration oder die REST-API geschrieben wird, kommt mit `__order` als null an, und das Board zeigt *„Some items don't have order values“* zusammen mit einem **Initialize**-Button an — ein Klick füllt die erste Seite nachträglich aus, und der nächste Cronjob-Lauf bringt den Balken direkt wieder zurück. Wenn ein Backend Zeilen für ein Board erstellt, sollte es den Schlüssel selbst anhängen. Verwenden Sie dasselbe Alphabet wie der Admin:

```typescript
import { generateKeyBetween } from "fractional-indexing";

// Base36, lower case. Postgres does the sorting and its default collation is
// not byte ordering, so the library's default base62 alphabet — which mixes
// cases — sorts differently in the database than in the key. Omitting this
// third argument produces keys like "a0" that the board rejects.
const ORDER_KEY_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

const tasks = client.data.collection("tasks");

// The last key currently in use. `is-not-null` is not optional: a descending
// sort is NULLS FIRST, so without it this reads back one of the very rows that
// has no key and every insert lands on the same "i0".
const { data: last } = await tasks.find({
    where: { __order: ["is-not-null", null] },
    orderBy: ["__order", "desc"],
    limit: 1
});

await tasks.create({
    title,
    status,
    __order: generateKeyBetween(
        (last[0]?.__order as string | undefined) ?? null,
        null,
        ORDER_KEY_DIGITS
    )
});
```

Zeilen, die über das Admin-Formular erstellt werden, kommen ebenfalls ohne Schlüssel an — der Unterschied ist lediglich, dass Sie den Balken in dem Moment sehen, in dem Sie eine Zeile hinzufügen. **Initialize** ist dort die Lösung; bei einem Board, das über ein Backend gespeist wird, ist es jedoch eine Korrektur, die sich bei jedem Durchlauf selbst wieder zunichtemacht.

## Kartenansicht

Karten stellen Entitäten als visuelle Karten dar — nützlich für bildlastige Inhalte:

```typescript
import { defineCollection } from "@rebasepro/cms-types";
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

- **[Admin anpassen](/docs/frontend/customizing)** — Eigene Ansichtsmodi, Seiten und Aktionen
- **[Entitätsansichten](/docs/frontend/entity-views)** — Benutzerdefinierte Tabs auf Entitätsformularen
- **[Entitätsaktionen](/docs/frontend/entity-actions)** — Benutzerdefinierte Entitätsaktionen
