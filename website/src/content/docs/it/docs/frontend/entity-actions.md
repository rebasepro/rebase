---
sourceHash: db464576272c842b
title: Azioni entità
sidebar_label: Azioni entità
description: Aggiungi pulsanti di azione personalizzati alle entità per archiviare, pubblicare, esportare, clonare e altro ancora.
---

## Panoramica

Le azioni entità sono pulsanti personalizzati visualizzati sulle singole entità. Utilizzale per operazioni quali la pubblicazione, l'archiviazione, la clonazione o l'attivazione di flussi di lavoro esterni.

## Definizione delle azioni entità

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

## Dove appare un'azione

Un'azione appare sul record, sia nel modulo di modifica sia nella vista di sola lettura, e sulle righe della tabella della collection. Per impostazione predefinita resta nel menu di overflow (⋮) in entrambi i punti.

Impostate `collapsed: false` sull'azione per cui si apre il record, e otterrà un pulsante tutto suo:

- **Sul record**, diventa un pulsante con etichetta nella barra, prima di Salva (o di Modifica, nella vista di sola lettura). Quando nella barra manca spazio, come in un pannello laterale, in una finestra di dialogo o in una finestra stretta, i pulsanti perdono prima l'etichetta e conservano l'icona, con il nome in un tooltip. Se ancora non basta, le ultime dichiarate tornano nel menu: dichiarate quindi per prima la più importante.
- **Su una riga della tabella**, diventa un'icona accanto a Modifica quando il puntatore è sulla riga.

```typescript
{
    name: "Publish",
    icon: "Upload",
    collapsed: false, // un pulsante sul record, un'icona sulla riga
    onClick: async ({ entity, context }) => { /* … */ }
}
```

Riservatelo alle una o due azioni che sono il motivo per cui si apre il record. Le altre si leggono meglio nel menu, che le raggruppa in tre blocchi: prima le azioni proprie della collection, nell'ordine in cui le avete dichiarate; poi Copia, Cronologia e Ispeziona; infine Elimina, in fondo e separato.

| Proprietà | Predefinito | Effetto |
|-----------|-------------|---------|
| `collapsed` | `true` | `false` rende l'azione un pulsante sul record e un'icona sulla riga della tabella |
| `includeInForm` | `true` | `false` tiene l'azione fuori dal record e la lascia sulle righe della collection |
| `showActionsInListView` | `false` | `true` mostra l'azione come icona su ogni riga della vista elenco |
| `isEnabled` | — | Restituite `false` per mostrare l'azione disabilitata, come pulsante o come voce di menu |
| `disabledReason` | — | Spiega perché un'azione disabilitata non è disponibile: sotto il suo nome nel menu e come tooltip di un pulsante o di un'icona disabilitati |

Un'azione disabilitata che non dice perché sembra rotta. `disabledReason` riceve le stesse props di `isEnabled`, quindi può indicare cosa manca:

```typescript
{
    name: "Resend to Shopify",
    isEnabled: ({ entity }) => Boolean(entity?.values.shopify_id),
    disabledReason: () => "Questo cliente non ha un account Shopify",
    onClick: async ({ entity, context }) => { /* … */ }
}
```

Sul record, un pulsante il cui `onClick` restituisce una promise in sospeso mostra un indicatore di caricamento e non si può premere di nuovo finché la promise non si conclude. Se l'azione lancia un errore o la sua promise viene rifiutata, l'utente vede l'errore in una notifica. La vista di sola lettura non ha un modulo, quindi lì `formContext` è undefined.

## Azioni della collection

Per azioni a livello di barra degli strumenti che operano sulla collection o sulle entità selezionate:

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

![Azioni della collection](/img/collection_actions.png)

## Passaggi successivi

- **[Colonne aggiuntive](/docs/frontend/additional-columns)** — Colonne calcolate della tabella
- **[Campi personalizzati](/docs/frontend/custom-fields)** — Campi modulo personalizzati
