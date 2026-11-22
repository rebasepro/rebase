---
sourceHash: 94cc15a104ed93ec
title: Ansichtsmodi
sidebar_label: Ansichtsmodi
description: "Zeigen Sie die Zeilen einer Tabelle als Liste, Tabellenblatt, Karten oder Kanban-Board an; wählen Sie, was Titel, Bild, Status und Datum jedes Datensatzes füllt; und legen Sie die Standardsortierung, Filter und 1-Klick-Filter-Voreinstellungen fest."
---

Jede Collection kann über den Umschalter in ihrer Toolbar auf vier Arten angezeigt werden:

- **Table**: Ein virtualisiertes Tabellenblatt mit Inline-Bearbeitung, Sortierung, Filterung
  und Mehrfachauswahl. Der Standard-Einstiegspunkt für eine Collection, sofern nicht anders angegeben.
- **List**: Eine Zeile pro Datensatz, mit dessen Bild, Titel, Untertitel, Status und
  Datum.
- **Cards**: Ein Raster aus Karten für bildlastige Inhalte.
- **Kanban**: Ein Board, gruppiert nach einer Spalte mit einer geschlossenen Wertemenge.

Eine Collection kann im selben Umschalter auch selbst geschriebene Ansichtsmodi (einen Kalender, eine Karte, eine
Galerie) anbieten, die von derselben Toolbar gesteuert werden: siehe
[Benutzerdefinierte Ansichtsmodi](/docs/frontend/extending#custom-view-modes).

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
        __order: { hidden: true },
    },
});
```

| Option | Wirkung |
|---|---|
| `defaultViewMode` | Wo ein Besucher landet: `"table"`, `"list"`, `"cards"`, `"kanban"` oder der Schlüssel einer benutzerdefinierten Ansicht. |
| `enabledViews` | Die Ansichten, die der Umschalter anbietet. |
| `kanban` | `{ columnField, orderField }`: das Board. |
| `defaultSize` | Die Zeilenhöhe, siehe unten. |
| `customViews` | Eigene Ansichten, nach Wert oder Schlüssel. |

### Zeilenhöhe

| `defaultSize` | Pixel | Ideal für |
|------|--------|----------|
| `"xs"` | 36 | Dichte Datentabellen |
| `"s"` | 42 | Kompakte Textzeilen |
| `"m"` | 48 | Standard |
| `"l"` | 96 | Mittlere Bild-Thumbnails |
| `"xl"` | 160 | Große Bild-Thumbnails |

## Kanban

`kanban.columnField` benennt die Spalte, nach der das Board gruppiert. Sie muss eine
geschlossene Menge von Strings enthalten, ein `col.enum([...])` oder eine Textspalte mit
`.oneOf([...])`; alles andere ist ein Typfehler. Die Spalten werden in der
eigenen Reihenfolge der Spalte oder in `enumOrder` dargestellt, mit den Beschriftungen und Farben aus
`enumLabels`. Das Ziehen einer Karte in eine andere Spalte schreibt `columnField`.

`kanban.orderField` gibt an, wo die Position einer Karte **innerhalb** einer Spalte gespeichert wird.
Deklarieren Sie es immer dann, wenn diese Reihenfolge wichtig ist: Drei typische Fehler führen hier zu einem Board,
das konfiguriert aussieht, es aber nicht ist.

**Ohne `orderField` wird nur die Spalte beibehalten.** Eine Karte lässt sich weiterhin zwischen
Spalten verschieben, da dies `columnField` aktualisiert – was für ein Status-Board völlig ausreicht.
Ihre Position innerhalb einer Spalte kann jedoch nirgends gespeichert werden, sodass sie beim nächsten
Lesevorgang zurückgesetzt wird. Das Board weist beim ersten Ablegen einer Karte an einer neuen Position in der
eigenen Spalte in einer schließbaren Leiste darauf hin; ein Board, dessen Karten nur
zwischen Spalten verschoben werden, zeigt diesen Hinweis nicht an.

**Die Spalte muss vom Typ Text sein.** Das Neuanordnen schreibt einen
[fractional-indexing](https://github.com/rocicorp/fractional-indexing)-Schlüssel
(`"i0"`, `"i1"`, `"i0i"`), keinen Index. Eine Zahlenspalte kann einen solchen Wert niemals aufnehmen, daher
akzeptiert `orderField` ausschließlich Textspalten. Es handelt sich um interne Logik, nicht um Inhalt: blenden Sie
sie aus, wie oben gezeigt.

**Zeilen, die außerhalb des CMS erstellt werden, kommen ohne Schlüssel an.** Beim Einfügen
wird keiner automatisch zugewiesen. Eine Zeile, die durch einen Cron-Job, ein Seed-Skript, eine Migration oder die REST-API
geschrieben wird, enthält `__order: null`, und das Board zeigt *„Some items don't have order
values“* mit einer **Initialize**-Schaltfläche an. Ein Klick füllt die erste Seite nachträglich auf, und
der nächste Cron-Lauf bringt die Leiste direkt wieder zurück. Wenn ein Backend Zeilen für
ein Board erstellt, sollte es den Schlüssel selbst generieren, und zwar mit dem vom CMS verwendeten Alphabet:

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

Zeilen, die über das Formular erstellt werden, kommen ebenfalls ohne Schlüssel an; der Unterschied besteht lediglich darin,
dass Sie die Leiste in dem Moment sehen, in dem Sie eine Zeile hinzufügen. **Initialize** ist dort die Lösung;
bei einem Board, das von einem Backend gespeist wird, ist es eine Behebung, die sich bei jedem Durchlauf selbst wieder zunichtemacht.

## Display-Slots

Jede Oberfläche, die einen Datensatz darstellt, verwendet einige von sechs Slots: **title**,
**subtitle**, **image**, **status**, **date** und **tags**. Eine Zeile in der Listenansicht besteht aus Bild +
Titel + Untertitel + Status + Datum, eine Karte ist dasselbe mit dem Bild oben, ein
Reference-Picker ist Titel + Untertitel und eine Seitenüberschrift besteht nur aus dem Titel.

Das CMS füllt einige Slots aus den Spalten der Tabelle (siehe
[Standard-Display-Slots](/docs/collections/#display-slots)). `display` definiert beliebige
davon als Feldpfad oder als Funktion:

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

Ein Slot, den Sie weglassen, behält seinen abgeleiteten Wert.

Einem Resolver wird `{ row, id, context }` übergeben. `row` ist der Datensatz, wie ihn der Server
sendet, typisiert als Zeile der Tabelle: Datumsangaben als ISO-Strings, ein belongsTo als seine
Fremdschlüsselspalte. `id` ist sein Primärschlüssel als String, wobei die Teile eines zusammengesetzten
Schlüssels mit `:::` verbunden sind. Eine vom CMS geladene Relation wird unter ihrem Namen verschachtelt übergeben,
so wie RESTs `include` sie zurückgibt, sodass ein Resolver das Feld eines verknüpften Datensatzes
ohne eigene Anfrage lesen kann.

Ein Resolver kann `async` sein, um etwas auszulesen, das der Datensatz nicht enthält. Solange
das Promise aussteht, zeigt die Oberfläche den abgeleiteten Wert an und tauscht den
aufgelösten Wert aus, sobald er vorliegt: Ein Titel ist niemals ein Spinner. Die Ergebnisse werden pro
Datensatz und Slot zwischengespeichert, und gleichzeitige Abfragen teilen sich einen Aufruf.

Geben Sie `undefined` zurück, wenn ein Datensatz keinen Wert für den Slot hat; die Oberfläche greift dann
auf das zurück, was ihr bekannt ist (eine Überschrift verwendet den Singularnamen der Collection, ein Link verwendet
die ID). Ein Resolver, der einen Fehler wirft, wird wie `undefined` behandelt und einmalig protokolliert.

Bevorzugen Sie einen Pfad, wann immer der Wert im Datensatz vorhanden ist: Ein Pfad behält das eigene
Rendering des Felds bei, sodass ein Enum-Status ein farbiger Chip und ein Datum formatiert bleibt –
was ein Resolver, der einen String zurückgibt, nicht leisten kann.

Wenn kein Slot den Titel bestimmt, wählt das CMS einen aus den Textfeldern der Tabelle aus.
Bei `fieldOrder` ist es das erste Feld in dieser Reihenfolge, das als Titel fungieren kann.
Andernfalls werden die Kandidaten nach Priorität geordnet: zuerst Text, dessen Schlüssel ein Label bezeichnet (`name`,
`title`, `label`…), dann kurzer Text, eine E-Mail, ein Enum, langer Text und eine
Benutzerauswahl. Schlüssel, UUID-Spalten, Fremdschlüssel, Relationen, Referenzen, JSON-Dokumente,
Dateifelder und ausgeblendete Felder qualifizieren sich nie: Eine Relation bezeichnet
einen anderen Datensatz, sodass ein Client, der zu einer Agentur gehört, niemals nach der
Agentur benannt wird. Eine Tabelle, die keines dieser Felder aufweist, wird nach ihrer ID benannt. Ein Name, der sich
innerhalb einer JSON-Spalte befindet, oder eine Relation, die tatsächlich der Bezeichnung einer Zeile entspricht (eine
Junction-Zeile), wird mit `display.title` benannt: `title: "data.name"`,
`title: "agency"`. Was auch immer der Titel enthält, wird als Text dargestellt: ein Datum formatiert,
ein Array zusammengefügt und eine Relation als Titel der zugehörigen Zeile (mit Fallback auf
deren ID).

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

| Option | Wirkung |
|---|---|
| `sort` | Die Standardsortierung: ein Schlüssel und eine Richtung oder mehrere der Reihe nach. |
| `defaultFilter` | Der Filter, mit dem ein Besucher startet und den er ändern kann. |
| `fixedFilter` | Ein Filter, den der Besucher nicht ändern kann. Filter, die auf andere Felder angewendet werden, werden damit kombiniert. |
| `filterPresets` | 1-Klick-Filter in der Toolbar: `{ label?, filterValues, sort? }`. Ohne Label wird eines aus dem Filter generiert. |
| `pagination` | Seitenweises Laden (`true` oder die Seitengröße) oder alles auf einmal (`false`). |

Jeder Schlüssel wird anhand der Felder der Tabelle überprüft. Das feldeigene `filterOperators`
schränkt ein, wonach darin gefiltert werden kann, und `[]` deaktiviert die Filterung für dieses Feld.

Ein `fixedFilter` grenzt ein, was das CMS *abfragt*. Es ist keine Sicherheitsgrenze: Was ein
Aufrufer lesen darf, wird für jeden Aufrufer durch die
[Row-Level Security](/docs/collections/security-rules/) der Tabelle bestimmt.

## Nächste Schritte

- [customizeTable](/docs/frontend/customize-table/): Alle Optionen
- [Customizing the admin](/docs/frontend/customizing/): Eigene Ansichtsmodi, Seiten und Aktionen
- [Entity views](/docs/frontend/entity-views/): Tabs auf einem Datensatz
- [Entity actions](/docs/frontend/entity-actions/): Buttons auf einem Datensatz
