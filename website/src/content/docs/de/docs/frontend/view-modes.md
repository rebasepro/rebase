---
sourceHash: 68aa6b76fbe1dd6b
title: Ansichtsmodi
sidebar_label: Ansichtsmodi
description: "Zeigen Sie die Zeilen einer Tabelle als Liste, Tabellenblatt, Karten oder Kanban-Board an; wählen Sie, was Titel, Bild, Status und Datum jedes Datensatzes befüllt; und legen Sie Standardsortierung, Filter und 1-Klick-Filter-Presets fest."
---

Jede Collection kann über den Umschalter in ihrer Toolbar auf vier Arten angezeigt werden:

- **Table**: ein virtualisiertes Tabellenblatt mit Inline-Bearbeitung, Sortierung, Filterung
  und Mehrfachauswahl. Dort wird eine Collection standardmäßig geöffnet, sofern nicht anders angegeben.
- **List**: eine Zeile pro Datensatz, mit dessen Bild, Titel, Untertitel, Status und
  Datum.
- **Cards**: ein Karten-Grid für bildlastige Inhalte.
- **Kanban**: ein Board, gruppiert nach einer Spalte mit einer geschlossenen Menge von Werten.

Eine Collection kann im selben Umschalter auch selbst geschriebene Ansichtsmodi (einen Kalender, eine
Karte, eine Galerie) bereitstellen, die von derselben Toolbar gesteuert werden: siehe
[Custom view modes](/docs/frontend/extending#custom-view-modes).

## Ansichten auswählen

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
    },
});
```

| Option | Effekt |
|---|---|
| `defaultViewMode` | Wo ein Besucher landet: `"table"`, `"list"`, `"cards"`, `"kanban"` oder der Schlüssel einer benutzerdefinierten Ansicht. |
| `enabledViews` | Die Ansichten, die der Umschalter anbietet. |
| `kanban` | `{ columnField, orderField }`: das Board. |
| `defaultSize` | Die Zeilenhöhe, siehe unten. |
| `customViews` | Eigene Ansichten, nach Wert oder nach Schlüssel. |

### Zeilenhöhe

| `defaultSize` | Pixel | Am besten für |
|------|--------|----------|
| `"xs"` | 36 | Dichte Datentabellen |
| `"s"` | 42 | Kompakte Textzeilen |
| `"m"` | 48 | Standard |
| `"l"` | 96 | Mittlere Bild-Thumbnails |
| `"xl"` | 160 | Große Bild-Thumbnails |

## Kanban

`kanban.columnField` benennt die Spalte, nach der das Board gruppiert. Sie muss
eine geschlossene Menge von Strings enthalten, ein `col.enum([...])` oder eine
Textspalte mit `.oneOf([...])`; alles andere ist ein Typfehler. Die Spalten werden
in der eigenen Reihenfolge der Spalte oder in `enumOrder` dargestellt, mit den
Bezeichnungen und Farben von `enumLabels`. Das Ziehen einer Karte in eine andere
Spalte schreibt `columnField`.

`kanban.orderField` gibt an, wo die Position einer Karte **innerhalb** einer Spalte
gespeichert wird. Deklarieren Sie es immer dann, wenn diese Reihenfolge wichtig ist:
Drei typische Fehler führen hier zu einem Board, das konfiguriert aussieht, es aber nicht ist.

**Ohne `orderField` bleibt nur die Spalte erhalten.** Eine Karte lässt sich weiterhin
zwischen Spalten verschieben, da dies `columnField` schreibt – was für ein Status-Board
ausreicht. Ihre Position innerhalb einer Spalte kann jedoch nirgends gespeichert werden,
sodass sie beim nächsten Lesen zurückgesetzt wird. Das Board weist beim ersten Mal darauf
hin, wenn eine Karte an einer neuen Stelle in ihrer eigenen Spalte abgelegt wird, und zwar
in einer Leiste, die geschlossen werden kann; ein Board, dessen Karten nur zwischen Spalten
verschoben werden, zeigt nichts an.

**Die Spalte muss Text sein.** Das Neuanordnen schreibt einen
[fractional-indexing](https://github.com/rocicorp/fractional-indexing)-Schlüssel
(`"i0"`, `"i1"`, `"i0i"`), keinen Index. Eine Zahlenspalte kann einen solchen niemals
aufnehmen, weshalb `orderField` nur eine Textspalte akzeptiert. Es handelt sich um interne
Logik, nicht um Inhalt; die Angabe in `orderField` blendet sie daher aus der Tabelle aus
und deaktiviert sie im Formular. Ein Eintrag `fields.__order` überschreibt dies jedoch:
`hidden: false` zeigt sie an.

**Zeilen, die außerhalb des CMS erstellt werden, kommen ohne Schlüssel an.** Beim
Einfügen wird keiner zugewiesen. Eine Zeile, die durch einen Cronjob, ein Seed-Skript,
eine Migration oder die REST-API geschrieben wird, landet mit `__order` als null, und
das Board zeigt *„Some items don't have order values“* mit einer **Initialize**-Schaltfläche
an. Ein Klick befüllt die erste Seite nachträglich, und der nächste Cron-Lauf bringt die
Leiste direkt wieder zurück. Wenn ein Backend Zeilen für ein Board erstellt, sollte es
den Schlüssel selbst anhängen – mit dem Alphabet, das das CMS verwendet:

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

Zeilen, die über das Formular erstellt werden, kommen ebenfalls ohne Schlüssel an;
der einzige Unterschied besteht darin, dass Sie die Leiste in dem Moment sehen, in dem
Sie eine hinzufügen. **Initialize** ist dort die Lösung; bei einem Board, das von einem
Backend gespeist wird, ist es eine Lösung, die sich bei jedem Durchlauf selbst wieder zunichtemacht.

## Display-Slots

Jede Oberfläche, die einen Datensatz darstellt, verwendet einige von sechs Slots: **title**,
**subtitle**, **image**, **status**, **date** und **tags**. Eine Zeile in der Liste ist
image + title + subtitle + status + date, eine Karte ist dasselbe mit dem Bild oben, ein
Referenzauswähler ist title + subtitle und eine Seitenüberschrift ist nur title.

Das CMS füllt einige Slots aus den Spalten der Tabelle (siehe
[Standard-Display-Slots](/docs/collections/#display-slots)). `display` gibt beliebige davon
an, als Feldpfad oder als Funktion:

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

Einem Resolver wird `{ row, id, context }` übergeben. `row` ist der Datensatz, wie ihn
der Server sendet, typisiert als Zeile der Tabelle: Datumsangaben als ISO-Strings, ein
`belongsTo` als seine Fremdschlüsselspalte. `id` ist sein Primärschlüssel als String,
wobei die Teile eines zusammengesetzten Schlüssels mit `:::` verbunden sind. Eine vom
CMS geladene Relation kommt verschachtelt unter ihrem Namen an, so wie RESTs `include` sie
zurückgibt; ein Resolver kann also das Feld eines verknüpften Datensatzes ohne eigenen
Request lesen.

Ein Resolver kann `async` sein, um etwas auszulesen, das der Datensatz nicht enthält.
Während das Promise aussteht, zeigt die Oberfläche den abgeleiteten Wert an und tauscht
den aufgelösten Wert aus, sobald er eintrifft: Ein Titel ist niemals ein Spinner. Die
Ergebnisse werden pro Datensatz und Slot zwischengespeichert, und gleichzeitige Anfragen
teilen sich denselben Aufruf.

Geben Sie `undefined` zurück, wenn ein Datensatz für den Slot keinen Wert hat; die
Oberfläche fällt auf das zurück, was sie kennt (eine Überschrift verwendet den Singular-Namen
der Collection, ein Link die ID). Ein Resolver, der einen Fehler wirft, wird wie `undefined`
behandelt und einmalig protokolliert.

Bevorzugen Sie einen Pfad, wann immer sich der Wert im Datensatz befindet: Ein Pfad
behält das feldeigene Rendering bei, sodass ein Enum-Status ein farbiger Chip und ein
Datum formatiert bleibt – was ein Resolver, der einen String zurückgibt, nicht leisten kann.

Wenn kein Slot den Titel benennt, wählt das CMS einen aus den Textfeldern der Tabelle aus.
Bei `fieldOrder` ist es das erste Feld in dieser Reihenfolge, das ein Titel sein kann.
Andernfalls werden die Kandidaten priorisiert: Zuerst Text, dessen Schlüssel eine Bezeichnung
nennt (`name`, `title`, `label`…), dann kurzer Text, eine E-Mail, ein Enum, langer Text und
ein Benutzerauswähler. Primärschlüssel, UUID-Spalten, Fremdschlüssel, Relationen, Referenzen,
JSON-Dokumente, Dateifelder und versteckte Felder qualifizieren sich nie: Eine Relation
benennt einen anderen Datensatz; ein Kunde, der zu einer Agentur gehört, erhält also niemals
den Titel der Agentur. Eine Tabelle ohne all diese Felder erhält ihre ID als Titel. Ein Name,
der sich innerhalb einer JSON-Spalte befindet, oder eine Relation, die tatsächlich das ist,
wie eine Zeile heißt (eine Junction-Zeile), wird mit `display.title` benannt:
`title: "data.name"`, `title: "agency"`. Was auch immer der Titel enthält, wird als Text
dargestellt: ein Datum formatiert, ein Array zusammengefügt und eine Relation als Titel der
zugehörigen Zeile (mit Fallback auf deren ID).

## Filter, Presets und Sortierung

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

| Option | Effekt |
|---|---|
| `sort` | Die Standardsortierung: ein Schlüssel und eine Richtung oder mehrere der Reihe nach. |
| `defaultFilter` | Der Filter, mit dem ein Besucher startet und den er ändern kann. |
| `fixedFilter` | Ein Filter, den der Besucher nicht ändern kann. Filter, die auf andere Felder angewendet werden, werden damit kombiniert. |
| `filterPresets` | 1-Klick-Filter in der Toolbar: `{ label?, filterValues, sort? }`. Ohne Label wird eines aus dem Filter generiert. |
| `pagination` | Seitenweises Laden (`true` oder die Seitengröße) oder alles auf einmal (`false`). |

Jeder Schlüssel wird anhand der Felder der Tabelle überprüft. Das feldeigene `filterOperators`
schränkt ein, was darauf gefiltert werden kann, und `[]` deaktiviert das Filtern für dieses Feld.

Ein `fixedFilter` schränkt ein, was das CMS *abfragt*. Es ist keine Sicherheitsgrenze: Was ein
Aufrufer lesen darf, entscheidet die [Row-Level-Security](/docs/collections/security-rules/)
der Tabelle für jeden Aufrufer.

## Nächste Schritte

- [customizeTable](/docs/frontend/customize-table/): alle Optionen
- [Customizing the admin](/docs/frontend/customizing/): eigene Ansichtsmodi, Seiten und Aktionen
- [Entity views](/docs/frontend/entity-views/): Tabs auf einem Datensatz
- [Entity actions](/docs/frontend/entity-actions/): Buttons auf einem Datensatz
