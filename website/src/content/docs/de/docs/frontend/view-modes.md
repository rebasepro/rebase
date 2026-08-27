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
import { defineCollection } from "@rebasepro/cms-types";
const productsCollection = defineCollection({
    slug: "products",
    properties: { /* … */ },
    name: "Products",
    table: "products",
    // ...
    admin: {
        defaultViewMode: "table",            // Default view
        enabledViews: ["list", "table", "kanban"],    // Available views
        orderProperty: "__order",           // Eigenschaft für die Drag-and-drop-Sortierung
        kanban: {
            columnProperty: "status"         // Enum property for columns
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

Drag-and-drop zwischen Spalten aktualisiert automatisch das Enum-Feld und die Sortierreihenfolge.

### Sortierung

`kanban` und `orderProperty` sind zwei Hälften einer Funktion. Deklarieren Sie
immer beide — drei Fehler an dieser Stelle ergeben ein Board, das konfiguriert
*aussieht* und es nicht ist.

**`orderProperty` ist nicht optional.** Ohne sie lässt sich eine Karte weiterhin
zwischen Spalten ziehen, denn das schreibt `columnProperty`. Ihre Position
*innerhalb* einer Spalte hat keinen Speicherort, springt beim nächsten Laden
zurück, und das Board zeigt einen bernsteinfarbenen Hinweisbalken, dass die
Sortierung nicht konfiguriert ist.

**Die Eigenschaft muss ein `string` sein.** Das Umsortieren schreibt einen
[fractional-indexing](https://github.com/rocicorp/fractional-indexing)-Schlüssel
— `"i0"`, `"i1"`, `"i0i"` — keinen Index. Eine `number`-Eigenschaft kann ihn nie
aufnehmen: ein numerisches `sortOrder` lässt das Board dauerhaft nach
Initialisierung fragen, und die Initialisierung selbst scheitert an einer
numerischen Spalte. Deklarieren Sie sie versteckt — sie ist Mechanik, kein
Inhalt.

```typescript
__order: {
    type: "string",
    name: "Order",
    admin: { disabled: true, hideFromCollection: true }
}
```

**Außerhalb des Admin erzeugte Zeilen kommen ohne Schlüssel an.** Beim Insert
vergibt ihn niemand. Eine Zeile aus einem Cron, einem Seed-Skript, einer
Migration oder der REST-API landet mit `__order` auf null, und das Board zeigt
*"Some items don't have order values"* samt **Initialize**-Schaltfläche — ein
Klick füllt die erste Seite, der nächste Cron-Lauf holt den Balken zurück.
Erzeugt ein Backend Zeilen für ein Board, vergibt es den Schlüssel selbst, mit
demselben Alphabet wie der Admin:

```typescript
import { generateKeyBetween } from "fractional-indexing";

// Base36, Kleinbuchstaben. Sortiert wird von Postgres, dessen Standard-Collation
// keine Byte-Ordnung ist: Lässt man dieses dritte Argument weg, entstehen
// base62-Schlüssel wie "a0", die das Board ablehnt.
const ORDER_KEY_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

const tasks = client.data.collection("tasks");

// Der zuletzt vergebene Schlüssel. `is-not-null` ist nicht optional: eine
// absteigende Sortierung ist NULLS FIRST, ohne sie liest das hier eine der
// schlüssellosen Zeilen zurück und jeder Insert landet auf demselben "i0".
const { data: last } = await tasks.find({
    where: { __order: ["is-not-null", null] },
    orderBy: ["__order", "desc"],
    limit: 1
});

await tasks.create({
    title,
    status,
    __order: generateKeyBetween(last[0]?.__order ?? null, null, ORDER_KEY_DIGITS)
});
```

## Kartenansicht

![Screenshot-Platzhalter für Kartenansicht](/img/features/cards-view.png)

Karten zeigen Entitäten als visuelle Karten an – nützlich für inhaltsreiche Inhalte mit vielen Bildern:

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

- **[Entitätsansichten](/docs/frontend/entity-views)** — Benutzerdefinierte Tabs in Entitätsformularen
- **[Entitätsaktionen](/docs/frontend/entity-actions)** — Benutzerdefinierte Entitätsaktionen
---
