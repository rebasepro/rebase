---
sourceHash: 97a837000033ac9c
title: Azioni di entità
sidebar_label: Azioni di entità
description: Aggiungi pulsanti di azione personalizzati alle entità per archiviazione, pubblicazione, esportazione, clonazione e altro ancora.
---

## Panoramica

Le azioni di entità sono pulsanti personalizzati che compaiono sulle singole entità. Utilizzale per operazioni come la pubblicazione, l'archiviazione, la clonazione o l'attivazione di flussi di lavoro esterni.

## Definizione delle azioni di entità

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

## Cosa viene passato a un'azione

Ogni callback di un'azione (`onClick`, `isEnabled`, `disabledReason`) riceve il record su cui viene eseguita:

| Prop | Che cos'è |
|------|------------|
| `row` | Il record nel formato in cui il server invia la riga, la struttura restituita da `useRows` e `context.data`: date come stringhe ISO, un belongsTo come colonna della relativa foreign-key (`authorId`). Esattamente le colonne del record: `row.id` è una colonna `id`, dove la tabella ne ha una, con il tipo di quella colonna. Undefined finché non è presente un record salvato. |
| `id` | L'ID del record, nel modo in cui l'admin lo indirizza: la sua chiave primaria come stringa, le parti di una chiave composita unite da `:::` (`"5"` per una chiave intera `5`). |
| `path` | Il percorso della collezione in cui si trova il record, inclusi i segmenti di sottocollezione (`authors/7/posts`). |
| `collection`, `context` | La collezione e il contesto dell'admin: `context.data`, `context.snackbarController`, `context.dialogsController`, … |
| `formContext` | Nel form di modifica di un record aperto, il form: i suoi `values` sono quelli del form, modifiche non salvate incluse. Undefined nella collezione e nella vista di sola lettura. |
| `view` | `"collection"` o `"form"`. |
| `highlightRow(id)`, `unhighlightRow(id)` | Nella collezione, evidenzia una riga tramite il suo ID e rimuove l'evidenziazione. |
| `selectionController` | Nella collezione, la relativa selezione per ID: `isSelected(id)`, `toggleSelection(row, selected?)`, `selection` (le righe selezionate o la query rappresentata da "all matching"). |

## Dove compare un'azione

Un'azione appare sul record, sia nel suo form di modifica che nella sua vista di sola lettura, e sulle righe della tabella della collezione. Per impostazione predefinita, si trova nel menu di overflow (⋮) in entrambi i casi.

Imposta `collapsed: false` per l'azione per cui gli utenti aprono il record, così da assegnarle un pulsante dedicato:

- **Sul record**, diventa un pulsante con etichetta nella barra, posizionato prima di Salva (o Modifica, nella vista di sola lettura). Quando lo spazio nella barra scarseggia, come in un pannello laterale, in una finestra di dialogo o in una finestra stretta, i pulsanti nascondono prima le etichette mantenendo l'icona, con il nome visibile in un tooltip. Se lo spazio è ancora insufficiente, le ultime dichiarate vengono ripiegate nel menu; dichiara quindi le più importanti per prime.
- **Su una riga della tabella**, diventa un'icona accanto a Modifica al passaggio del cursore sulla riga.

```typescript
{
    name: "Publish",
    icon: "Upload",
    collapsed: false, // a button on the record, an icon on the row
    onClick: async ({ row, context }) => { /* … */ }
}
```

Riserva questo comportamento per le una o due azioni per cui il record viene principalmente aperto. Il resto risulta più leggibile nel menu, che le elenca in tre gruppi: prima le azioni proprie della collezione, nell'ordine in cui sono state dichiarate; poi Copy, History e Inspect; infine Delete, per ultima e separata.

| Proprietà | Predefinito | Effetto |
|-----------|-------------|---------|
| `collapsed` | `true` | `false` rende l'azione un pulsante sul record e un'icona sulla riga della tabella |
| `includeInForm` | `true` | `false` esclude l'azione dal record e la lascia sulle righe della collezione |
| `showActionsInListView` | `false` | `true` mostra l'azione come un'icona su ciascuna riga della vista a elenco |
| `isEnabled` | — | Restituisci `false` per mostrare l'azione disabilitata, come pulsante o come elemento di menu |
| `disabledReason` | — | Spiega perché un'azione disabilitata non è disponibile: sotto il suo nome in un menu e come tooltip di un pulsante o un'icona disabilitati |
| `nameKey` | — | Una chiave di traduzione per il nome. L'admin mostra la relativa traduzione nella lingua corrente, e `name` se la chiave non ne ha una. Le azioni integrate la impostano, così che Modifica, Copia ed Elimina seguano la lingua dell'admin |

Un'azione disabilitata che non ne specifica il motivo dà l'impressione di essere malfunzionante. `disabledReason` riceve le stesse proprietà di `isEnabled`, potendo così indicare che cosa manca:

```typescript
{
    name: "Resend to Shopify",
    isEnabled: ({ row }) => Boolean(row?.shopify_id),
    disabledReason: () => "This customer has no Shopify account",
    onClick: async ({ row, context }) => { /* … */ }
}
```

Sul record, un pulsante il cui `onClick` restituisce una promise in sospeso mostra uno spinner e non può essere premuto nuovamente fino alla risoluzione della promise. Se l'azione genera un errore o la sua promise viene rifiutata, l'utente visualizza l'errore in una notifica. La vista di sola lettura non ha un form, quindi `formContext` è undefined in tale contesto.

## Azioni di collezione

Per azioni a livello di barra degli strumenti che operano sulla collezione o sulle entità selezionate:

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

A un'azione viene passato `CollectionActionsProps`. Ciascuna tratta le righe nel formato in cui il server le invia, la struttura restituita da `useRows`:

| Prop | Che cos'è |
|------|------------|
| `selectionController` | La selezione della vista. `selection` è `{ type: "rows", ids, rows }` per le righe spuntate, oppure `{ type: "query", query, excludedIds, count }` per "all matching"; `selectedCount`, `hasSelection`, `isSelected(id)`, `toggleSelection(row, selected?)`, `setSelectedRows(rows)`, `selectAllMatching(query, count?)`, `clearSelection()`. |
| `tableController` | La query live della vista: `rows`, `loading`, `error`, e i parametri di filtro, ricerca e ordinamento condivisi dalla barra degli strumenti (`filterValues`, `setFilterValues`, `searchString`, `sortBy`, …). |
| `path`, `collection`, `context` | La posizione della collezione, la sua configurazione e il contesto dell'admin. |
| `openNewDocument(defaults?)` | Apre il form per un nuovo record, precompilato. |

Per mantenere selezionate alcune righe dopo aver eseguito un'azione sulle restanti, passa quelle da conservare a `setSelectedRows`:

```ts
const { selection } = selectionController;
if (selection.type === "rows") {
    selectionController.setSelectedRows(selection.rows.filter((_row, i) => failed.has(selection.ids[i])));
}
```

![Collection actions](/img/collection_actions.png)

## Passaggi successivi

- **[Additional Columns](/docs/frontend/additional-columns)** — Colonne calcolate della tabella
- **[Custom Fields](/docs/frontend/custom-fields)** — Campi personalizzati del form
