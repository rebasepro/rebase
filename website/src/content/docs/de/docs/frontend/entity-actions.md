---
sourceHash: 81a0981c41ccc947
title: Entity-Aktionen
sidebar_label: Entity-Aktionen
description: Fügen Sie Entitäten benutzerdefinierte Aktionsschaltflächen zum Archivieren, Veröffentlichen, Exportieren, Klonen und mehr hinzu.
---

## Übersicht

Entity-Aktionen sind benutzerdefinierte Schaltflächen, die bei einzelnen Entitäten angezeigt werden. Verwenden Sie sie für Operationen wie das Veröffentlichen, Archivieren, Klonen oder das Auslösen externer Workflows.

## Definieren von Entity-Aktionen

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

| Eigenschaft | Beschreibung |
|------|------------|
| `row` | Der Datensatz, wie der Server die Zeile sendet, in der Struktur, die `useRows` und `context.data` zurückgeben: Datumsangaben als ISO-Strings, ein belongsTo als Fremdschlüsselspalte (`authorId`), `id` enthalten. Undefined, solange kein gespeicherter Datensatz vorhanden ist. |
| `id` | Die ID des Datensatzes. |
| `path` | Der Collection-Pfad, an dem sich der Datensatz befindet, einschließlich Subcollection-Segmenten (`authors/7/posts`). |
| `collection`, `context` | Die Collection und der Kontext des Admins: `context.data`, `context.snackbarController`, `context.dialogsController`, … |
| `formContext` | Im Bearbeitungsformular eines geöffneten Datensatzes das Formular: Seine `values` entsprechen denen des Formulars, einschließlich nicht gespeicherter Änderungen. Undefined in der Collection und in der schreibgeschützten Ansicht. |
| `view` | `"collection"` oder `"form"`. |
| `highlightEntity(id)`, `unhighlightEntity(id)` | In der Collection eine Zeile anhand ihrer ID hervorheben und die Hervorhebung wieder aufheben. |
| `selectionController` | In der Collection deren Auswahl nach ID: `isSelected(id)`, `toggleSelection(row, selected?)`, `selection` (die markierten Zeilen oder die Abfrage, für die „alle passenden“ steht). |

## Wo eine Aktion angezeigt wird

Eine Aktion wird auf dem Datensatz angezeigt – sowohl in dessen Bearbeitungsformular als auch in dessen schreibgeschützter Ansicht – sowie in den Tabellenzeilen der Collection. Standardmäßig befindet sie sich an beiden Orten im Überlaufmenü (⋮).

Setzen Sie `collapsed: false` für die Aktion, für deren Ausführung Benutzer den Datensatz öffnen, und sie erhält eine eigene Schaltfläche:

- **Auf dem Datensatz** wird sie zu einer beschrifteten Schaltfläche in der Leiste vor Speichern (oder Bearbeiten in der schreibgeschützten Ansicht). Wenn der Platz in der Leiste knapp wird, wie etwa in einem Seitenbereich, einem Dialog oder einem schmalen Fenster, verlieren die Schaltflächen zuerst ihre Beschriftung und behalten das Icon bei, wobei der Name in einem Tooltip angezeigt wird. Wenn das immer noch zu breit ist, werden die zuletzt deklarierten Aktionen wieder in das Menü eingeklappt; deklarieren Sie die wichtigsten Aktionen daher zuerst.
- **Auf einer Tabellenzeile** wird sie zu einem Icon neben Bearbeiten, wenn der Mauszeiger über der Zeile schwebt (Hover).

```typescript
{
    name: "Publish",
    icon: "Upload",
    collapsed: false, // a button on the record, an icon on the row
    onClick: async ({ row, context }) => { /* … */ }
}
```

Behalten Sie dies für die ein oder zwei Aktionen bei, die der Grund dafür sind, dass der Datensatz geöffnet wird. Die restlichen sind im Menü besser aufgehoben, das sie in drei Gruppen auflistet: Zuerst die eigenen Aktionen der Collection in der Reihenfolge ihrer Deklaration; dann Kopieren, Verlauf und Untersuchen; zuletzt und abgesetzt Löschen.

| Eigenschaft | Standard | Auswirkung |
|----------|---------|--------|
| `collapsed` | `true` | `false` macht die Aktion zu einer Schaltfläche auf dem Datensatz und zu einem Icon auf der Tabellenzeile |
| `includeInForm` | `true` | `false` blendet die Aktion auf dem Datensatz aus und belässt sie auf den Zeilen der Collection |
| `showActionsInListView` | `false` | `true` zeigt die Aktion als Icon in jeder Zeile der Listenansicht an |
| `isEnabled` | — | Geben Sie `false` zurück, um die Aktion als Schaltfläche oder Menüeintrag deaktiviert anzuzeigen |
| `disabledReason` | — | Gibt an, warum eine deaktivierte Aktion nicht verfügbar ist: unter ihrem Namen in einem Menü und als Tooltip einer deaktivierten Schaltfläche oder eines Icons |
| `nameKey` | — | Ein Übersetzungsschlüssel für den Namen. Der Admin zeigt dessen Übersetzung in der aktuellen Sprache an bzw. `name`, falls für den Schlüssel keine vorhanden ist. Die integrierten Aktionen setzen diesen Schlüssel, sodass Bearbeiten, Kopieren und Löschen der Admin-Sprache folgen |

Eine deaktivierte Aktion, die den Grund nicht angibt, wirkt fehlerhaft. `disabledReason` erhält dieselben Props wie `isEnabled` und kann daher benennen, was fehlt:

```typescript
{
    name: "Resend to Shopify",
    isEnabled: ({ row }) => Boolean(row?.shopify_id),
    disabledReason: () => "This customer has no Shopify account",
    onClick: async ({ row, context }) => { /* … */ }
}
```

Auf dem Datensatz zeigt eine Schaltfläche, deren `onClick` ein ausstehendes Promise zurückgibt, einen Ladeindikator (Spinner) an und kann nicht erneut betätigt werden, bis das Promise abgeschlossen ist. Wenn die Aktion einen Fehler auslöst oder ihr Promise abgelehnt wird, sieht der Benutzer den Fehler in einer Benachrichtigung. Die schreibgeschützte Ansicht besitzt kein Formular, daher ist `formContext` dort undefined.

## Collection-Aktionen

Für Aktionen auf Toolbar-Ebene, die auf der Collection oder auf ausgewählten Entitäten operieren:

```tsx
import { defineCollection } from "@rebasepro/cms-types";
import { resolveSelection } from "@rebasepro/cms";
function PublishSelectedAction({ selectionController, path, collection, context }: CollectionActionsProps) {
    const handlePublish = async () => {
        // `selection` is either the rows that were ticked or a query standing
        // for every row that matches — `resolveSelection` reads them, one page
        // at a time, and refuses rather than returning a prefix.
        const rows = await resolveSelection({
            selection: selectionController.selection,
            data: context.data,
            collection
        });
        for (const row of rows) {
            await context.data.collection(path).update(String(row.id), { status: "published" });
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

Einer Aktion wird `CollectionActionsProps` übergeben. Jedes arbeitet mit Zeilen so, wie der Server sie sendet – in der Struktur, die `useRows` zurückgibt:

| Eigenschaft | Beschreibung |
|------|------------|
| `selectionController` | Die Auswahl der Ansicht. `selection` ist `{ type: "rows", ids, rows }` für markierte Zeilen oder `{ type: "query", query, excludedIds, count }` für „alle passenden“; `selectedCount`, `hasSelection`, `isSelected(id)`, `toggleSelection(row, selected?)`, `setSelectedRows(rows)`, `selectAllMatching(query, count?)`, `clearSelection()`. |
| `tableController` | Die Live-Abfrage der Ansicht: `rows`, `loading`, `error` sowie die Filter-, Such- und Sortierfunktionen, die die Toolbar teilt (`filterValues`, `setFilterValues`, `searchString`, `sortBy`, …). |
| `path`, `collection`, `context` | Wo sich die Collection befindet, ihre Konfiguration und der Kontext des Admins. |
| `openNewDocument(defaults?)` | Öffnet das Formular für neue Datensätze, vorausgefüllt. |

Um einige Zeilen nach der Ausführung einer Aktion für die restlichen weiterhin ausgewählt zu lassen, übergeben Sie die beizubehaltenden Zeilen an `setSelectedRows`:

```ts
const { selection } = selectionController;
if (selection.type === "rows") {
    selectionController.setSelectedRows(selection.rows.filter(row => failed.has(row.id)));
}
```

![Collection actions](/img/collection_actions.png)

## Nächste Schritte

- **[Zusätzliche Spalten](/docs/frontend/additional-columns)** — Berechnete Tabellenspalten
- **[Benutzerdefinierte Felder](/docs/frontend/custom-fields)** — Eigene Formularfelder
