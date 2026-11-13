---
sourceHash: 57ee5c3ecdf49419
title: Ansichtsmodi
sidebar_label: Ansichtsmodi
description: "Zeigen Sie die Zeilen einer Tabelle als Liste, Tabellenblatt, Karten oder Kanban-Board an; wählen Sie, was Titel, Bild, Status und Datum der einzelnen Datensätze füllt; und legen Sie die Standard-Sortierung, Filter sowie Ein-Klick-Filtervoreinstellungen fest."
---

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Jede Collection kann über den Umschalter in ihrer Toolbar auf vier Arten dargestellt werden:

- **Table**: eine virtualisierte Tabelle mit Inline-Bearbeitung, Sortierung, Filterung
  und Mehrfachauswahl. Hier öffnet sich eine Collection, sofern nicht anders festgelegt.
- **List**: eine Zeile pro Datensatz, mit Bild, Titel, Untertitel, Status und
  Datum.
- **Cards**: ein Kartengitter für bildlastige Inhalte.
- **Kanban**: ein Board, gruppiert nach einer Spalte mit einer geschlossenen Wertemenge.

Eine Collection kann im selben Umschalter auch von Ihnen geschriebene Ansichtsmodi anbieten (einen Kalender, eine Karte,
eine Galerie), gesteuert über dieselbe Toolbar: siehe
[Custom view modes](/docs/frontend/extending#custom-view-modes).

## Ansichten auswählen

<span class="since-badge" data-since="0.31">Seit 0.31</span>

```ts
// backend/schema/tasks.ts
import { defineTable, col } from "@rebasepro/server/schema";

export const tasks = defineTable("tasks", {
    columns: {
        id:      col.uuid().primaryKey().defaultRandom(),
        title:   col.text().notNull(),
        status:  col.enum(["backlog", "in_progress", "review", "done"]).notNull().default("backlog"),
        dueDate: col.date(),
        // The board's order key: text, never a number.
        __order: col.text(),
    },
    rls: "admin-only",
});
```

```tsx
// frontend/src/cms/tasks.tsx
import { customizeTable } from "@rebasepro/cms";
import type { tasks } from "../../../backend/schema/tasks";

export const tasksCms = customizeTable<typeof tasks>("tasks", {
    defaultViewMode: "kanban",
    enabledViews: ["table", "kanban"],
    kanban: { columnField: "status", orderField: "__order" },
    fields: {
        status: {
            enumLabels: {
                backlog:     { label: "Backlog", color: "gray" },
                in_progress: { label: "In Progress", color: "blue" },
                review:      { label: "Review", color: "orange" },
                done:        { label: "Done", color: "green" },
            },
        },
        __order: { hidden: true, hiddenInForm: true },
    },
});
```

| Option | Auswirkung |
|---|---|
| `defaultViewMode` | Wo Besucher landen: `"table"`, `"list"`, `"cards"`, `"kanban"` oder der Schlüssel einer benutzerdefinierten Ansicht. |
| `enabledViews` | Die Ansichten, die der Umschalter anbietet. |
| `kanban` | `{ columnField, orderField }`: das Board. |
| `defaultSize` | Die Zeilenhöhe, siehe unten. |
| `customViews` | Eigene Ansichten, nach Wert oder nach Schlüssel. |

### Zeilenhöhe

| `defaultSize` | Pixel | Am besten für |
|------|--------|---------------|
| `"xs"` | 36 | Dichte Datentabellen |
| `"s"` | 42 | Kompakte Textzeilen |
| `"m"` | 48 | Standard |
| `"l"` | 96 | Mittlere Bild-Thumbnails |
| `"xl"` | 160 | Große Bild-Thumbnails |

## Kanban

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`kanban.columnField` benennt die Spalte, nach der das Board gruppiert. Sie muss
eine geschlossene Menge von Strings enthalten, ein `col.enum([...])` oder eine
Textspalte mit `.oneOf([...])`; alles andere ist ein Typfehler. Die Spalten werden
in der spalteneigenen Reihenfolge oder in `enumOrder` dargestellt, mit den Labels
und Farben aus `enumLabels`. Das Ziehen einer Karte in eine andere Spalte schreibt in
`columnField`.

`kanban.orderField` benennt, wo die Position einer Karte **innerhalb** einer Spalte
gespeichert wird. Deklarieren Sie es jedes Mal: Drei typische Fehler hier führen alle
zu einem Board, das konfiguriert aussieht, es aber nicht ist.

**`orderField` ist nicht optional.** Ohne diese Angabe lässt sich eine Karte zwar
weiterhin zwischen Spalten verschieben, da dies in `columnField` schreibt. Ihre
Position innerhalb einer Spalte kann jedoch nirgends gespeichert werden, sodass sie
beim nächsten Lesen zurückgesetzt wird und das Board eine gelb-orange Leiste anzeigt,
die besagt, dass die Sortierung nicht konfiguriert ist.

**Die Spalte muss vom Typ Text sein.** Eine Neuanordnung schreibt einen
[fractional-indexing](https://github.com/rocicorp/fractional-indexing)-Schlüssel
(`"i0"`, `"i1"`, `"i0i"`), keinen Index. Eine Zahlenspalte kann einen solchen
niemals aufnehmen, daher akzeptiert `orderField` nur eine Textspalte. Dies ist
interne Logik, kein Inhalt: Blenden Sie sie aus, wie oben gezeigt.

**Zeilen, die außerhalb des CMS erstellt werden, kommen ohne Schlüssel an.** Beim
Einfügen wird ihnen automatisch keiner zugewiesen. Eine Zeile, die durch einen
Cronjob, ein Seed-Skript, eine Migration oder die REST-API geschrieben wird,
landet mit `__order` als `null`, und das Board zeigt *"Some items don't have order
values"* zusammen mit einem **Initialize**-Button an. Ein Klick befüllt die erste
Seite nachträglich, und der nächste Cronjob-Lauf bringt den Hinweis direkt wieder
zurück. Wenn ein Backend Zeilen für ein Board erstellt, sollte es den Schlüssel
selbst anhängen – unter Verwendung desselben Alphabets wie das CMS:

```typescript
import { generateKeyBetween } from "fractional-indexing";

// Base36, lower case. Postgres does the sorting and its default collation is
// not byte ordering, so the library's default base62 alphabet — which mixes
// cases — sorts differently in the database than in the key. Omitting this
// third argument produces keys like "a0" that the board rejects.
const ORDER_KEY_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

// The last key currently in use. `is-not-null` is not optional: a descending
// sort is NULLS FIRST, so without it this reads back one of the very rows that
// has no key and every insert lands on the same "i0".
const { data: last } = await client.data.tasks.find({
    where: { __order: ["is-not-null", null] },
    orderBy: ["__order", "desc"],
    limit: 1
});

await client.data.tasks.create({
    title,
    status,
    __order: generateKeyBetween(
        (last[0]?.__order as string | undefined) ?? null,
        null,
        ORDER_KEY_DIGITS
    )
});
```

Zeilen, die über das Formular erstellt werden, kommen ebenfalls ohne Schlüssel
an; der einzige Unterschied ist, dass Sie den Hinweisbalken in dem Moment sehen,
in dem Sie eine Zeile hinzufügen. **Initialize** ist dort die Lösung; auf einem
Board, das von einem Backend gespeist wird, macht sich dieser Fix bei jedem
Durchlauf wieder zunichte.

## Display-Slots

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Jede Oberfläche, die einen Datensatz darstellt, nutzt einige von sechs Slots: **title**,
**subtitle**, **image**, **status**, **date** und **tags**. Eine Zeile in der Liste
besteht aus Bild + Titel + Untertitel + Status + Datum, eine Karte aus demselben mit dem
Bild oben, eine Referenzauswahl aus Titel + Untertitel und eine Seitenüberschrift aus dem
Titel allein.

Das CMS füllt einige Slots aus den Spalten der Tabelle (siehe
[Standard-Display-Slots](/docs/collections/#display-slots)). `display` definiert
beliebige davon als Feldpfad oder als Funktion:

```tsx
import { customizeTable } from "@rebasepro/cms";
import type { tasks } from "../../../backend/schema/tasks";

export const tasksCms = customizeTable<typeof tasks>("tasks", {
    display: {
        title: "title",
        status: "status",
        date: "dueDate",
        subtitle: ({ row }) => row.dueDate ? `Due ${row.dueDate}` : undefined,
    },
});
```

Ein Slot, den Sie auslassen, behält seinen abgeleiteten Wert.

Einem Resolver wird `{ row, id, context }` übergeben. `row` ist der Datensatz,
wie ihn der Server sendet, typisiert als Tabellenzeile: Datumsangaben als ISO-Strings,
ein `belongsTo` als seine Fremdschlüssel-Spalte. `id` ist sein Primärschlüssel als
String, wobei die Teile eines zusammengesetzten Schlüssels mit `:::` verbunden sind.
Eine vom CMS geladene Relation kommt verschachtelt unter ihrem Namen an, so wie RESTs
`include` sie zurückgibt, sodass ein Resolver das Feld eines verknüpften Datensatzes
ohne eigenen Request auslesen kann.

Ein Resolver kann `async` sein, um etwas auszulesen, das der Datensatz nicht enthält.
Während das Promise läuft, zeigt die Oberfläche den abgeleiteten Wert an und tauscht
den aufgelösten Wert aus, sobald er vorliegt: Ein Titel ist niemals ein Spinner. Die
Ergebnisse werden pro Datensatz und Slot gecacht, und gleichzeitige Abfragen teilen
sich einen Aufruf.

Geben Sie `undefined` zurück, wenn ein Datensatz nichts für den Slot enthält; die
Oberfläche greift auf das zurück, was sie kennt (eine Überschrift verwendet den Namen
der Collection im Singular, ein Link die ID). Ein Resolver, der einen Fehler auslöst,
wird wie `undefined` behandelt und einmalig protokolliert.

Bevorzugen Sie einen Pfad, wann immer sich der Wert im Datensatz befindet: Ein Pfad
behält das feldeigene Rendering bei, sodass ein Enum-Status ein farbiger Chip und ein
Datum formatiert bleibt, was ein Resolver, der einen String zurückgibt, nicht leisten kann.

Wenn kein Slot den Titel benennt, wählt das CMS einen aus. Bei `fieldOrder` ist es das
erste Feld in dieser Reihenfolge, das ein Titel sein kann: Text, eine Relation mit
einfacher Kardinalität oder eine Referenz. Andernfalls werden die Kandidaten nach Rang
geordnet: Text, dessen Schlüssel ein Label bezeichnet (`name`, `title`, `label`…)
zuerst, dann kurzer Text, eine E-Mail, ein Enum, langer Text, eine Relation und eine
Referenz. Schlüssel, UUID-Spalten, Dateifelder und ausgeblendete Felder qualifizieren
sich nie. Was auch immer der Titel enthält, wird als Text dargestellt: ein Datum
formatiert, ein Array zusammengefügt und eine Relation als das erste aus `name`,
`title`, `label` oder `displayName` der verknüpften Zeile, mit Rückfall auf deren ID.

## Filter, Voreinstellungen und Sortierung

<span class="since-badge" data-since="0.31">Seit 0.31</span>

```tsx
import { customizeTable } from "@rebasepro/cms";
import type { tasks } from "../../../backend/schema/tasks";

export const tasksCms = customizeTable<typeof tasks>("tasks", {
    sort: ["dueDate", "asc"],
    defaultFilter: { status: ["!=", "done"] },
    filterPresets: [
        { label: "In review", filterValues: { status: ["==", "review"] } },
        { label: "Overdue", filterValues: { dueDate: ["<", new Date().toISOString().slice(0, 10)] }, sort: ["dueDate", "asc"] },
    ],
});
```

| Option | Auswirkung |
|---|---|
| `sort` | Die Standard-Sortierung: ein Schlüssel und eine Richtung oder mehrere der Reihe nach. |
| `defaultFilter` | Der Filter, mit dem Besucher beginnen und den sie ändern können. |
| `fixedFilter` | Ein Filter, den Besucher nicht ändern können. Filter, die sie auf andere Felder anwenden, werden damit kombiniert. |
| `filterPresets` | Ein-Klick-Filter in der Toolbar: `{ label?, filterValues, sort? }`. Ohne Label wird eines aus dem Filter generiert. |
| `pagination` | Seitenweise laden (`true` oder die Seitengröße) oder alles auf einmal (`false`). |

Jeder Schlüssel wird mit den Feldern der Tabelle abgeglichen. Das feldeigene `filterOperators`
schränkt ein, wonach darin gefiltert werden kann, und `[]` deaktiviert das Filtern für dieses Feld.

Ein `fixedFilter` schränkt ein, was das CMS *anfragt*. Es ist keine Sicherheitsgrenze:
Was ein Aufrufer lesen darf, wird für jeden Aufrufer durch die
[Row-Level-Security](/docs/collections/security-rules/) der Tabelle bestimmt.

## Nächste Schritte

<span class="since-badge" data-since="0.31">Seit 0.31</span>

- [customizeTable](/docs/frontend/customize-table/): alle Optionen
- [Customizing the admin](/docs/frontend/customizing/): eigene Ansichtsmodi, Seiten und Aktionen
- [Entity views](/docs/frontend/entity-views/): Tabs auf einem Datensatz
- [Entity actions](/docs/frontend/entity-actions/): Buttons auf einem Datensatz
