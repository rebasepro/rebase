---
sourceHash: 49c04468f92c50c8
title: Entitätsaktionen
sidebar_label: Entitätsaktionen
description: Fügen Sie Entitäten benutzerdefinierte Aktionsschaltflächen zum Archivieren, Veröffentlichen, Exportieren, Klonen und mehr hinzu.
---

## Übersicht

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Entitätsaktionen sind Schaltflächen auf einem Datensatz: Veröffentlichen, Archivieren, Klonen oder das Auslösen eines externen Workflows. Sie werden pro Tabelle in `customizeTable` deklariert, und `updateRecord` deckt den Schreibvorgang ab, den die meisten von ihnen ausführen.

## Definieren von Entitätsaktionen

<span class="since-badge" data-since="0.31">Seit 0.31</span>

```tsx
// frontend/src/cms/products.tsx
import React from "react";
import { customizeTable, updateRecord, resolveSelection } from "@rebasepro/cms";
import type { CollectionActionsProps } from "@rebasepro/cms-types";
import type { products } from "../../../backend/schema/products";

function PublishSelected({ selectionController, collection, context }: CollectionActionsProps) {
    const publish = async () => {
        // `selection` is the ticked rows, or a query standing for every row
        // that matches: resolveSelection reads them, a page at a time.
        const { ids } = await resolveSelection({
            selection: selectionController.selection,
            data: context.data,
            collection
        });
        for (const id of ids) await updateRecord(context, "products", id, { status: "active" });
        context.snackbarController?.open({ type: "success", message: `${ids.length} published` });
    };
    return <button onClick={publish}>Publish selected</button>;
}

export const productsCms = customizeTable<typeof products>("products", {
    entityActions: [
        {
            key: "publish",
            name: "Publish",
            icon: "Upload",
            collapsed: false,
            isEnabled: ({ row }) => row?.status !== "active",
            disabledReason: () => "Already active",
            onClick: ({ id, context }) =>
                updateRecord<typeof products>(context, "products", id,
                    { status: "active", publishedAt: new Date().toISOString() }, "Product published"),
        },
        {
            key: "clone",
            name: "Clone",
            icon: "Copy",
            onClick: async ({ row, context }) => {
                if (!row || !context) return;
                // `row` is the record as the server sends it: copy it, minus its id.
                const { id: _id, ...fields } = row;
                await context.data.products.create({ ...fields, name: `${fields.name} (Copy)` });
            },
        },
    ],
    Actions: [PublishSelected],
});
```

Mit der Tabelle als Typargument ist `row` in `onClick`, `isEnabled` und `disabledReason` der Zeilentyp der Tabelle, sodass `row?.status` gegen die Werte der Spalte geprüft wird. Ein Eintrag kann auch ein String sein: der `key` einer Aktion, die einmalig auf `<RebaseCMS entityActions>` (oder `<Rebase entityActions>`) registriert wurde, für Aktionen, die sich mehrere Tabellen teilen.

## `updateRecord`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`updateRecord(context, slug, id, patch, message?)` schreibt `patch` auf einen Datensatz und zeigt anschließend `message` als Erfolgsbenachrichtigung an, falls angegeben.

- Es schreibt über `context.data`, dieselbe Anfrage, die das Formular ausführt, sodass die Hooks und Row-Level-Security-Regeln des Servers greifen und jede Ansicht der Tabelle aktualisiert wird.
- Es übernimmt das, was das `onClick` einer Aktion erhält, unverändert. Ein fehlender `context` oder eine fehlende `id` (eine Aktion auf einem noch nicht erstellten Datensatz) schreibt nichts.
- Ein abgelehnter Schreibvorgang löst einen Fehler aus (wirft eine Exception), und die Aktion meldet den Fehler an den Benutzer.
- `updateRecord<typeof products>(…)` prüft `patch` gegen das, was eine Aktualisierung der Tabelle akzeptiert. Ein Datum wird als ISO-String übergeben, so wie der Server es entgegennimmt.

## Was einer Aktion übergeben wird

Jeder Callback einer Aktion (`onClick`, `isEnabled`, `disabledReason`) empfängt den Datensatz, auf dem er ausgeführt wird:

| Prop | Bedeutung |
|------|-----------|
| `row` | Der Datensatz, wie der Server die Zeile sendet, in der Struktur, die `useRows` und `context.data` zurückgeben: Datumsangaben als ISO-Strings, ein `belongsTo` als seine Fremdschlüsselspalte (`authorId`). Exakt die Spalten des Datensatzes: `row.id` ist eine `id`-Spalte, sofern die Tabelle eine hat, mit dem Typ dieser Spalte. `undefined`, solange kein gespeicherter Datensatz existiert. |
| `id` | Die ID des Datensatzes, wie der Admin sie adressiert: ihr Primärschlüssel als String, die Teile eines zusammengesetzten Schlüssels mit `:::` verbunden (`"5"` für einen Integer-Schlüssel `5`). |
| `path` | Der Collection-Pfad, an dem sich der Datensatz befindet, einschließlich Subcollection-Segmenten (`authors/7/posts`). |
| `collection`, `context` | Die Collection und der Kontext des Admins: `context.data`, `context.snackbarController`, `context.dialogsController`, … |
| `formContext` | Im Bearbeitungsformular eines geöffneten Datensatzes das Formular: seine `values` entsprechen denen des Formulars, einschließlich nicht gespeicherter Änderungen. `undefined` in der Collection und in der schreibgeschützten Ansicht. |
| `view` | `"collection"` oder `"form"`. |
| `highlightRow(id)`, `unhighlightRow(id)` | In der Collection eine Zeile anhand ihrer ID hervorheben und die Hervorhebung wieder entfernen. |
| `selectionController` | In der Collection deren Auswahl anhand der ID: `isSelected(id)`, `toggleSelection(row, selected?)`, `selection` (die markierten Zeilen oder die Abfrage, für die „alle passenden“ steht). |

## Wo eine Aktion angezeigt wird

Eine Aktion erscheint auf dem Datensatz, sowohl in seinem Bearbeitungsformular als auch in seiner schreibgeschützten Ansicht, sowie auf den Tabellenzeilen der Collection. Standardmäßig wartet sie an beiden Orten im Überlaufmenü (⋮).

Setzen Sie `collapsed: false` für die Aktion, für die Benutzer den Datensatz öffnen, und sie erhält eine eigene Schaltfläche:

- **Auf dem Datensatz** wird sie zu einer beschrifteten Schaltfläche in der Leiste vor „Speichern“ (oder „Bearbeiten“ in der schreibgeschützten Ansicht). Wenn der Platz in der Leiste knapp wird, wie in einer Seitenleiste, einem Dialog oder einem schmalen Fenster, verlieren die Schaltflächen zuerst ihre Beschriftungen und behalten das Icon bei, wobei der Name in einem Tooltip angezeigt wird. Wenn das immer noch zu breit ist, werden die zuletzt deklarierten Aktionen wieder in das Menü eingeklappt; deklarieren Sie die wichtigsten daher zuerst.
- **Auf einer Tabellenzeile** wird sie zu einem Icon neben „Bearbeiten“, während mit der Maus über die Zeile gefahren wird (Hover).

```typescript
{
    name: "Publish",
    icon: "Upload",
    collapsed: false, // a button on the record, an icon on the row
    onClick: async ({ row, context }) => { /* … */ }
}
```

Behalten Sie dies für die ein oder zwei Aktionen bei, die der Hauptgrund dafür sind, dass der Datensatz geöffnet ist. Der Rest liest sich besser im Menü, das sie in drei Gruppen auflistet: zuerst die eigenen Aktionen der Collection in der Reihenfolge, in der Sie sie deklariert haben; dann Kopieren, Verlauf und Untersuchen; und schließlich Löschen, als letzter und abgesetzter Eintrag.

| Eigenschaft | Standard | Auswirkung |
|-------------|----------|------------|
| `collapsed` | `true` | `false` macht die Aktion zu einer Schaltfläche auf dem Datensatz und einem Icon auf der Tabellenzeile |
| `includeInForm` | `true` | `false` hält die Aktion vom Datensatz fern und belässt sie auf den Zeilen der Collection |
| `showActionsInListView` | `false` | `true` zeigt die Aktion als Icon auf jeder Zeile der Listenansicht an |
| `isEnabled` | — | Geben Sie `false` zurück, um die Aktion als Schaltfläche oder als Menüpunkt deaktiviert darzustellen |
| `disabledReason` | — | Gibt an, warum eine deaktivierte Aktion nicht verfügbar ist: unter ihrem Namen in einem Menü und als Tooltip einer deaktivierten Schaltfläche oder eines Icons |
| `nameKey` | — | Ein Übersetzungsschlüssel für den Namen. Der Admin zeigt seine Übersetzung in der aktuellen Sprache an und `name`, wenn der Schlüssel keine hat. Die integrierten Aktionen setzen dies, sodass Bearbeiten, Kopieren und Löschen der Sprache des Admins folgen |

Eine deaktivierte Aktion, die den Grund nicht angibt, wirkt fehlerhaft. `disabledReason` erhält dieselben Props wie `isEnabled`, sodass genau benannt werden kann, was fehlt:

```typescript
{
    name: "Resend to Shopify",
    isEnabled: ({ row }) => Boolean(row?.shopify_id),
    disabledReason: () => "This customer has no Shopify account",
    onClick: async ({ row, context }) => { /* … */ }
}
```

Auf dem Datensatz zeigt eine Schaltfläche, deren `onClick` ein ausstehendes Promise zurückgibt, einen Spinner an und kann nicht erneut geklickt werden, bis das Promise aufgelöst ist. Wenn die Aktion einen Fehler auslöst oder ihr Promise abgelehnt wird, sieht der Benutzer den Fehler in einer Benachrichtigung. Die schreibgeschützte Ansicht hat kein Formular, daher ist `formContext` dort `undefined`.

## Collection-Aktionen

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`Actions` platziert eigene Komponenten in der Symbolleiste der Collection, um Aktionen auf der gesamten Collection oder auf den ausgewählten Zeilen auszuführen: wie `PublishSelected` oben. Es ist eine Liste, sodass mehrere kombiniert werden können.

Einer Aktion werden `CollectionActionsProps` übergeben. Jede arbeitet mit Zeilen, wie der Server sie sendet, in der Struktur, die `useRows` zurückgibt:

| Prop | Bedeutung |
|------|-----------|
| `selectionController` | Die Auswahl der Ansicht. `selection` ist `{ type: "rows", ids, rows }` für markierte Zeilen oder `{ type: "query", query, excludedIds, count }` für „alle passenden“; `selectedCount`, `hasSelection`, `isSelected(id)`, `toggleSelection(row, selected?)`, `setSelectedRows(rows)`, `selectAllMatching(query, count?)`, `clearSelection()`. |
| `tableController` | Die Live-Abfrage der Ansicht: `rows`, `loading`, `error` und die Filter-, Such- und Sortiereinstellungen, die die Symbolleiste teilt (`filterValues`, `setFilterValues`, `searchString`, `sortBy`, …). |
| `path`, `collection`, `context` | Wo sich die Collection befindet, ihre Konfiguration und der Kontext des Admins. |
| `openNewDocument(defaults?)` | Öffnet das Formular für neue Datensätze, vorausgefüllt. |

Um einige Zeilen nach einer Aktion auf den restlichen Zeilen ausgewählt zu lassen, übergeben Sie die beizubehaltenden Zeilen an `setSelectedRows`:

```ts
const { selection } = selectionController;
if (selection.type === "rows") {
    selectionController.setSelectedRows(selection.rows.filter((_row, i) => failed.has(selection.ids[i])));
}
```

![Collection actions](/img/collection_actions.png)

## Nächste Schritte

- **[customizeTable](/docs/frontend/customize-table)** — Alle Tabellenoptionen
- **[Zusätzliche Spalten](/docs/frontend/additional-columns)** — Berechnete Tabellenspalten
- **[Benutzerdefinierte Felder](/docs/frontend/custom-fields)** — Benutzerdefinierte Formularfelder
