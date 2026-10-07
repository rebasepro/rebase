---
sourceHash: 5bea8df7e8fceb05
title: Entity-Aktionen
sidebar_label: Entity-Aktionen
description: Fügen Sie benutzerdefinierte Aktionsschaltflächen zu Entitäten hinzu, um zu archivieren, zu veröffentlichen, zu exportieren, zu klonen und mehr.
---

## Übersicht

Entity-Aktionen sind benutzerdefinierte Schaltflächen, die bei einzelnen Entitäten angezeigt werden. Verwenden Sie sie für Vorgänge wie das Veröffentlichen, Archivieren, Klonen oder das Auslösen externer Workflows.

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
                onClick: async ({ entity, context }) => {
                    if (!entity || !context) return;
                    await context.data.collection<Record<string, unknown>>(entity.path)
                            .update(entity.id, { status: "published", publishedAt: new Date() });
                    context.snackbarController?.open({
                        type: "success",
                        message: "Article published!"
                    });
                }
            },
            {
                name: "Clone",
                icon: <Copy size={iconSize.small}/>,
                onClick: async ({ entity, context }) => {
                    if (!entity || !context) return;
                    const { id, ...values } = entity.values;
                    await context.data.collection<Record<string, unknown>>(entity.path)
                            .create({ ...values, name: values.name + " (Copy)" });
                }
            }
        ]
    }
});

```

## Wo eine Aktion erscheint

Eine Aktion erscheint am Datensatz, sowohl im Bearbeitungsformular als auch in der schreibgeschützten Ansicht, und in den Tabellenzeilen der Collection. Standardmäßig wartet sie an beiden Stellen im Überlaufmenü (⋮).

Setzen Sie `collapsed: false` für die Aktion, wegen der man den Datensatz öffnet, und sie erhält eine eigene Schaltfläche:

- **Am Datensatz** wird sie zu einer beschrifteten Schaltfläche in der Leiste, vor „Speichern“ (bzw. „Bearbeiten“ in der schreibgeschützten Ansicht). Wird der Platz in der Leiste knapp, etwa in einem Seitenpanel, einem Dialog oder einem schmalen Fenster, verlieren die Schaltflächen zuerst ihre Beschriftung und behalten das Symbol, mit dem Namen als Tooltip. Reicht das immer noch nicht, wandern die zuletzt deklarierten zurück ins Menü. Deklarieren Sie die wichtigste daher zuerst.
- **In einer Tabellenzeile** wird sie zu einem Symbol neben „Bearbeiten“, solange der Mauszeiger über der Zeile liegt.

```typescript
{
    name: "Publish",
    icon: "Upload",
    collapsed: false, // eine Schaltfläche am Datensatz, ein Symbol in der Zeile
    onClick: async ({ entity, context }) => { /* … */ }
}
```

Reservieren Sie das für die ein oder zwei Aktionen, wegen derer der Datensatz geöffnet wird. Alle anderen sind im Menü besser aufgehoben, das sie in drei Gruppen auflistet: zuerst die eigenen Aktionen der Collection in der deklarierten Reihenfolge, dann Kopieren, Verlauf und Untersuchen, dann Löschen, zuletzt und abgesetzt.

| Eigenschaft | Standard | Wirkung |
|-------------|----------|---------|
| `collapsed` | `true` | `false` macht die Aktion zu einer Schaltfläche am Datensatz und zu einem Symbol in der Tabellenzeile |
| `includeInForm` | `true` | `false` hält die Aktion vom Datensatz fern und lässt sie in den Zeilen der Collection |
| `showActionsInListView` | `false` | `true` zeigt die Aktion als Symbol in jeder Zeile der Listenansicht |
| `isEnabled` | — | Geben Sie `false` zurück, um die Aktion deaktiviert anzuzeigen, als Schaltfläche oder als Menüeintrag |

Am Datensatz zeigt eine Schaltfläche, deren `onClick` ein noch offenes Promise zurückgibt, einen Ladeindikator und lässt sich erst wieder drücken, wenn das Promise abgeschlossen ist. Wirft die Aktion einen Fehler oder wird ihr Promise abgelehnt, sieht der Benutzer den Fehler in einer Benachrichtigung. Die schreibgeschützte Ansicht hat kein Formular, daher ist `formContext` dort undefined.

## Collection-Aktionen

Für Aktionen auf Symbolleistenebene, die sich auf die Collection oder ausgewählte Entitäten beziehen:

```tsx
import { defineCollection } from "@rebasepro/cms-types";
import { useData } from "@rebasepro/app";
import { resolveSelection } from "@rebasepro/cms";
function PublishSelectedAction({ selectionController, path }: CollectionActionsProps) {
    const data = useData();
    const handlePublish = async () => {
        // `selection` is either the rows that were ticked or a query standing
        // for every row that matches — `resolveSelection` reads them, one page
        // at a time, and refuses rather than returning a prefix.
        const selected = await resolveSelection({
            selection: selectionController.selection,
            accessor: data.collection(path)
        });
        for (const entity of selected) {
            await data.collection(entity.path).update(entity.id, { status: "published" });
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

![Collection-Aktionen](/img/collection_actions.png)

## Nächste Schritte

- **[Zusätzliche Spalten](/docs/frontend/additional-columns)** — Berechnete Tabellenspalten
- **[Benutzerdefinierte Felder](/docs/frontend/custom-fields)** — Benutzerdefinierte Formularfelder
