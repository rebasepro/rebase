---
sourceHash: 97a837000033ac9c
title: Entitätsaktionen
sidebar_label: Entitätsaktionen
description: Fügen Sie Entitäten benutzerdefinierte Aktionsschaltflächen zum Archivieren, Veröffentlichen, Exportieren, Klonen und mehr hinzu.
---

## Übersicht

Entitätsaktionen sind benutzerdefinierte Schaltflächen, die auf einzelnen Entitäten angezeigt werden. Verwenden Sie sie für Operationen wie das Veröffentlichen, Archivieren, Klonen oder das Auslösen externer Workflows.

## Definieren von Entitätsaktionen

```typescript
import { defineCollection } from "@rebasepro/cms-types";
import { resolveSelection } from "@rebasepro/cms";
import { iconSize } from "@rebasepro/ui";
import { Copy, Upload } from "lucide-react";

const articlesCollection = defineCollection({
    slug: "articles",
    name: "Articles",
    table: "articles",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        name: { name: "Name", type: "string" },
        status: { name: "Status", type: "string" },
        publishedAt: { name: "Published At", type: "date" }
    },
    admin: {
        entityActions: [
            {
                name: "Publish",
                icon: <Upload size={iconSize.small}/>,
                onClick: async ({ id, path, context }) => {
                    if (id === undefined || !path || !context) return;
                    await context.data.collection<Record<string, unknown>>(path)
                            .update(id, { status: "published", publishedAt: new Date().toISOString() });
                    context.snackbarController?.open({
                        type: "success",
                        message: "Article published!"
                    });
                }
            },
            {
                name: "Clone",
                icon: <Copy size={iconSize.small}/>,
                onClick: async ({ row, path, context }) => {
                    if (!row || !path || !context) return;
                    // `row` is the record as the server sends it, the shape
                    // `context.data` writes: copy it, minus its id.
                    const { id, ...fields } = row;
                    await context.data.collection<Record<string, unknown>>(path)
                            .create({ ...fields, name: `${String(fields.name)} (Copy)` });
                }
            }
        ]
    }
});

```

## Was einer Aktion übergeben wird

Jeder Callback einer Aktion (`onClick`, `isEnabled`, `disabledReason`) erhält den Datensatz, auf dem er ausgeführt wird:

| Prop | Bedeutung |
|------|-----------|
| `row` | Der Datensatz, wie der Server die Zeile sendet, in der Form, die `useRows` und `context.data` zurückgeben: Datumsangaben als ISO-Strings, ein belongsTo als Fremdschlüsselspalte (`authorId`). Genau die Spalten des Datensatzes: `row.id` ist eine `id`-Spalte, sofern die Tabelle eine hat, mit dem Typ dieser Spalte. Nicht definiert (`undefined`), solange kein gespeicherter Datensatz vorliegt. |
| `id` | Die ID des Datensatzes, wie die Administration sie anspricht: ihr Primärschlüssel als String, die Teile eines zusammengesetzten Schlüssels verbunden durch `:::` (`"5"` für einen Integer-Schlüssel `5`). |
| `path` | Der Collection-Pfad, an dem sich der Datensatz befindet, einschließlich Subcollection-Segmenten (`authors/7/posts`). |
| `collection`, `context` | Die Collection und der Kontext der Administration: `context.data`, `context.snackbarController`, `context.dialogsController`, … |
| `formContext` | Im Bearbeitungsformular eines geöffneten Datensatzes das Formular: Seine `values` sind die des Formulars, einschließlich nicht gespeicherter Änderungen. Nicht definiert (`undefined`) in der Collection und in der schreibgeschützten Ansicht. |
| `view` | `"collection"` oder `"form"`. |
| `highlightRow(id)`, `unhighlightRow(id)` | In der Collection eine Zeile anhand ihrer ID hervorheben und die Hervorhebung wieder aufheben. |
| `selectionController` | In der Collection deren Auswahl nach ID: `isSelected(id)`, `toggleSelection(row, selected?)`, `selection` (die markierten Zeilen oder die Query, für die „alle passenden“ steht). |

## Wo eine Aktion angezeigt wird

Eine Aktion erscheint auf dem Datensatz – sowohl in dessen Bearbeitungsformular als auch in der schreibgeschützten Ansicht – sowie in den Tabellenzeilen der Collection. Standardmäßig befindet sie sich an beiden Stellen im Überlaufmenü (⋮).

Setzen Sie `collapsed: false` für die Aktion, für deren Ausführung Benutzer den Datensatz öffnen, und sie erhält eine eigene Schaltfläche:

- **Auf dem Datensatz** wird sie zu einer beschrifteten Schaltfläche in der Leiste vor „Speichern“ (bzw. „Bearbeiten“ in der schreibgeschützten Ansicht). Wenn der Platz in der Leiste knapp wird – etwa in einem Seitenbereich, einem Dialog oder einem schmalen Fenster –, verlieren die Schaltflächen zuerst ihre Beschriftung und behalten das Icon, wobei der Name in einem Tooltip angezeigt wird. Reicht der Platz immer noch nicht aus, werden die zuletzt deklarierten Aktionen wieder in das Menü eingeklappt; deklarieren Sie die wichtigsten Aktionen daher zuerst.
- **Auf einer Tabellenzeile** wird sie zu einem Icon neben „Bearbeiten“, wenn der Mauszeiger über die Zeile bewegt wird (Hover).

```typescript
{
    name: "Publish",
    icon: "Upload",
    collapsed: false, // a button on the record, an icon on the row
    onClick: async ({ row, context }) => { /* … */ }
}
```

Behalten Sie dies für die ein oder zwei Aktionen bei, die der Hauptgrund dafür sind, dass der Datensatz geöffnet wird. Die übrigen lassen sich im Menü besser erfassen, welches sie in drei Gruppen auflistet: Zuerst die eigenen Aktionen der Collection in der von Ihnen deklarierten Reihenfolge; dann „Kopieren“, „Verlauf“ und „Untersuchen“; zuletzt und abgesetzt „Löschen“.

| Eigenschaft | Standard | Auswirkung |
|-------------|----------|------------|
| `collapsed` | `true` | `false` macht die Aktion zu einer Schaltfläche auf dem Datensatz und einem Icon in der Tabellenzeile |
| `includeInForm` | `true` | `false` blendet die Aktion auf dem Datensatz aus und belässt sie in den Zeilen der Collection |
| `showActionsInListView` | `false` | `true` zeigt die Aktion als Icon in jeder Zeile der Listenansicht an |
| `isEnabled` | — | `false` zurückgeben, um die Aktion deaktiviert anzuzeigen, sei es als Schaltfläche oder als Menüeintrag |
| `disabledReason` | — | Gibt an, warum eine deaktivierte Aktion nicht verfügbar ist: unter ihrem Namen im Menü und als Tooltip einer deaktivierten Schaltfläche oder eines Icons |
| `nameKey` | — | Ein Übersetzungsschlüssel für den Namen. Die Administration zeigt dessen Übersetzung in der aktuellen Sprache an bzw. `name`, falls für den Schlüssel keine Übersetzung vorliegt. Die integrierten Aktionen setzen dies, sodass „Bearbeiten“, „Kopieren“ und „Löschen“ der Sprache der Administration folgen |

Eine deaktivierte Aktion, die keinen Grund nennt, wirkt fehlerhaft. `disabledReason` erhält dieselben Props wie `isEnabled` und kann so benennen, was fehlt:

```typescript
{
    name: "Resend to Shopify",
    isEnabled: ({ row }) => Boolean(row?.shopify_id),
    disabledReason: () => "This customer has no Shopify account",
    onClick: async ({ row, context }) => { /* … */ }
}
```

Auf dem Datensatz zeigt eine Schaltfläche, deren `onClick` ein ausstehendes Promise (pending promise) zurückgibt, einen Spinner an und kann nicht erneut betätigt werden, bis das Promise aufgelöst ist. Wenn die Aktion einen Fehler wirft oder ihr Promise abgewiesen wird (rejects), sieht der Benutzer den Fehler in einer Benachrichtigung. Die schreibgeschützte Ansicht enthält kein Formular, daher ist `formContext` dort nicht definiert (`undefined`).

## Collection-Aktionen

Für Aktionen auf Symbolleistenebene (Toolbar), die auf die Collection oder ausgewählte Entitäten angewendet werden:

```tsx
import { defineCollection } from "@rebasepro/cms-types";
import { resolveSelection } from "@rebasepro/cms";
function PublishSelectedAction({ selectionController, path, collection, context }: CollectionActionsProps) {
    const handlePublish = async () => {
        // `selection` is either the rows that were ticked or a query standing
        // for every row that matches — `resolveSelection` reads them, one page
        // at a time, and refuses rather than returning a prefix. Each row's
        // id comes beside it in `ids`, whatever the collection is keyed by.
        const { ids } = await resolveSelection({
            selection: selectionController.selection,
            data: context.data,
            collection
        });
        for (const id of ids) {
            await context.data.collection(path).update(id, { status: "published" });
        }
    };

    return (
        <button onClick={handlePublish}>
            Publish {selectionController.selectedCount ?? "all"} selected
        </button>
    );
}

// Register — `Actions` is an array, so several can be composed.
const collection = defineCollection({
    slug: "products",
    name: "Products",
    table: "products",
    properties: { /* … */ },
    admin: {
        Actions: [PublishSelectedAction]
    }
});
```

Einer Aktion werden `CollectionActionsProps` übergeben. Jede dieser Eigenschaften verwendet Zeilen so, wie der Server sie sendet – in der Form, die `useRows` zurückgibt:

| Prop | Bedeutung |
|------|-----------|
| `selectionController` | Die Auswahl der Ansicht. `selection` ist `{ type: "rows", ids, rows }` für markierte Zeilen oder `{ type: "query", query, excludedIds, count }` für „alle passenden“; `selectedCount`, `hasSelection`, `isSelected(id)`, `toggleSelection(row, selected?)`, `setSelectedRows(rows)`, `selectAllMatching(query, count?)`, `clearSelection()`. |
| `tableController` | Die Live-Query der Ansicht: `rows`, `loading`, `error` und die Filter-, Such- und Sortiereinstellungen, die die Toolbar teilt (`filterValues`, `setFilterValues`, `searchString`, `sortBy`, …). |
| `path`, `collection`, `context` | Wo sich die Collection befindet, ihre Konfiguration und der Kontext der Administration. |
| `openNewDocument(defaults?)` | Öffnet das Formular für einen neuen Datensatz, vorausgefüllt. |

Um bestimmte Zeilen nach der Ausführung einer Aktion für die restlichen Zeilen ausgewählt zu lassen, übergeben Sie die beizubehaltenden Zeilen an `setSelectedRows`:

```ts
const { selection } = selectionController;
if (selection.type === "rows") {
    selectionController.setSelectedRows(selection.rows.filter((_row, i) => failed.has(selection.ids[i])));
}
```

![Collection-Aktionen](/img/collection_actions.png)

## Nächste Schritte

- **[Zusätzliche Spalten](/docs/frontend/additional-columns)** — Berechnete Tabellenspalten
- **[Benutzerdefinierte Felder](/docs/frontend/custom-fields)** — Eigene Formularfelder
