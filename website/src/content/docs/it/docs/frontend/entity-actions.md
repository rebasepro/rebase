---
sourceHash: 81a0981c41ccc947
title: Azioni entità
sidebar_label: Azioni entità
description: Aggiungi pulsanti di azione personalizzati alle entità per archiviare, pubblicare, esportare, clonare e altro ancora.
---

## Panoramica

Le azioni entità sono pulsanti personalizzati che appaiono sulle singole entità. Usale per operazioni come la pubblicazione, l'archiviazione, la clonazione o l'attivazione di flussi di lavoro esterni.

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

## Cosa riceve un'azione

Ogni callback di un'azione (`onClick`, `isEnabled`, `disabledReason`) riceve il record su cui viene eseguita:

| Prop | Descrizione |
|------|-------------|
| `row` | Il record così come inviato dal server, nella forma restituita da `useRows` e `context.data`: date come stringhe ISO, le relazioni belongsTo come colonna di chiave esterna (`authorId`), `id` incluso. `undefined` se non è presente alcun record salvato. |
| `id` | L'ID del record. |
| `path` | Il percorso della collezione in cui si trova il record, inclusi i segmenti delle sotto-collezioni (`authors/7/posts`). |
| `collection`, `context` | La collezione e il contesto dell'admin: `context.data`, `context.snackbarController`, `context.dialogsController`, … |
| `formContext` | Nel form di modifica di un record aperto, il form: i suoi `values` sono quelli del form, incluse le modifiche non salvate. `undefined` nella collezione e nella visualizzazione in sola lettura. |
| `view` | `"collection"` o `"form"`. |
| `highlightEntity(id)`, `unhighlightEntity(id)` | Nella collezione, evidenzia una riga tramite il suo ID e rimuove l'evidenziazione. |
| `selectionController` | Nella collezione, la relativa selezione, per ID: `isSelected(id)`, `toggleSelection(row, selected?)`, `selection` (le righe selezionate o la query rappresentata da "tutti i corrispondenti"). |

## Dove viene visualizzata un'azione

Un'azione appare sul record, sia nel suo form di modifica che nella sua visualizzazione in sola lettura, e sulle righe della tabella della collezione. Per impostazione predefinita, è posizionata nel menu di overflow (⋮) in entrambe le posizioni.

Imposta `collapsed: false` per l'azione principale per cui gli utenti aprono il record, così da assegnarle un pulsante dedicato:

- **Sul record**, diventa un pulsante con etichetta nella barra, prima di Salva (o Modifica, nella visualizzazione in sola lettura). Quando lo spazio nella barra scarseggia, ad esempio in un pannello laterale, in una finestra di dialogo o in una finestra stretta, i pulsanti perdono prima le etichette mantenendo l'icona, con il nome mostrato in un tooltip. Se lo spazio non è ancora sufficiente, gli ultimi pulsanti dichiarati rientrano nel menu; pertanto, dichiara per primi quelli più importanti.
- **Su una riga della tabella**, diventa un'icona accanto a Modifica al passaggio del cursore (hover) sulla riga.

```typescript
{
    name: "Publish",
    icon: "Upload",
    collapsed: false, // a button on the record, an icon on the row
    onClick: async ({ row, context }) => { /* … */ }
}
```

Riserva questa opzione per le una o due azioni principali per cui il record viene aperto. Il resto risulta più chiaro nel menu, che le elenca in tre gruppi: per prime le azioni specifiche della collezione, nell'ordine in cui sono state dichiarate; poi Copia, Cronologia e Ispeziona; infine Elimina, per ultima e separata.

| Proprietà | Predefinito | Effetto |
|-----------|-------------|---------|
| `collapsed` | `true` | `false` rende l'azione un pulsante sul record e un'icona sulla riga della tabella |
| `includeInForm` | `true` | `false` esclude l'azione dal record lasciandola sulle righe della collezione |
| `showActionsInListView` | `false` | `true` mostra l'azione come un'icona su ciascuna riga della vista a elenco |
| `isEnabled` | — | Restituisce `false` per mostrare l'azione disabilitata, come pulsante o come voce di menu |
| `disabledReason` | — | Spiega perché un'azione disabilitata non è disponibile: sotto il suo nome in un menu e come tooltip di un pulsante o di un'icona disabilitata |
| `nameKey` | — | Una chiave di traduzione per il nome. L'admin mostra la sua traduzione nella lingua corrente, e `name` dove la chiave non ne ha una. Le azioni predefinite la impostano, così Modifica, Copia ed Elimina seguono la lingua dell'admin |

Un'azione disabilitata che non ne spiega il motivo sembra non funzionare correttamente. `disabledReason` riceve le stesse prop di `isEnabled`, così da poter indicare cosa manca:

```typescript
{
    name: "Resend to Shopify",
    isEnabled: ({ row }) => Boolean(row?.shopify_id),
    disabledReason: () => "This customer has no Shopify account",
    onClick: async ({ row, context }) => { /* … */ }
}
```

Sul record, un pulsante il cui `onClick` restituisce una promise in sospeso (pending) mostra uno spinner e non può essere premuto nuovamente fino alla risoluzione della promise. Se l'azione genera un errore o la sua promise viene rifiutata, l'utente visualizza l'errore in una notifica. La visualizzazione in sola lettura non ha un form, quindi `formContext` lì è `undefined`.

## Azioni di collezione

Per azioni a livello di barra degli strumenti che operano sulla collezione o sulle entità selezionate:

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

A un'azione viene passato `CollectionActionsProps`. Ognuna tratta le righe così come inviate dal server, nella forma restituita da `useRows`:

| Prop | Descrizione |
|------|-------------|
| `selectionController` | La selezione della vista. `selection` è `{ type: "rows", ids, rows }` per le righe spuntate, oppure `{ type: "query", query, excludedIds, count }` per "tutti i corrispondenti"; `selectedCount`, `hasSelection`, `isSelected(id)`, `toggleSelection(row, selected?)`, `setSelectedRows(rows)`, `selectAllMatching(query, count?)`, `clearSelection()`. |
| `tableController` | La query dinamica della vista: `rows`, `loading`, `error`, e i filtri, la ricerca e l'ordinamento condivisi dalla barra degli strumenti (`filterValues`, `setFilterValues`, `searchString`, `sortBy`, …). |
| `path`, `collection`, `context` | Il percorso della collezione, la sua configurazione e il contesto dell'admin. |
| `openNewDocument(defaults?)` | Apre il form per un nuovo record, precompilato. |

Per mantenere selezionate alcune righe dopo aver eseguito l'azione sulle altre, passa quelle da mantenere a `setSelectedRows`:

```ts
const { selection } = selectionController;
if (selection.type === "rows") {
    selectionController.setSelectedRows(selection.rows.filter(row => failed.has(row.id)));
}
```

![Azioni di collezione](/img/collection_actions.png)

## Prossimi passi

- **[Colonne aggiuntive](/docs/frontend/additional-columns)** — Colonne calcolate della tabella
- **[Campi personalizzati](/docs/frontend/custom-fields)** — Campi personalizzati del form
