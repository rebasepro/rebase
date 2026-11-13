---
sourceHash: 49c04468f92c50c8
title: Azioni sulle entità (Entity Actions)
sidebar_label: Azioni sulle entità
description: Aggiungi pulsanti di azione personalizzati alle entità per l'archiviazione, la pubblicazione, l'esportazione, la clonazione e altro ancora.
---

## Panoramica

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

Le azioni sulle entità sono pulsanti presenti su un record: pubblicare, archiviare, clonare o avviare un flusso di lavoro esterno. Vengono dichiarate per tabella in `customizeTable`, e `updateRecord` gestisce la scrittura eseguita dalla maggior parte di esse.

## Definizione delle azioni sulle entità

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

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

Utilizzando la tabella come argomento di tipo, `row` in `onClick`, `isEnabled` e `disabledReason` corrisponde al tipo di riga della tabella, pertanto `row?.status` viene controllato rispetto ai valori della colonna. Una voce può anche essere una stringa: la `key` di un'azione registrata una sola volta su `<RebaseCMS entityActions>` (o `<Rebase entityActions>`), utile per le azioni condivise da più tabelle.

## `updateRecord`

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

`updateRecord(context, slug, id, patch, message?)` applica la `patch` su un singolo record, quindi mostra `message` come notifica di successo quando specificato.

- Scrive tramite `context.data`, la stessa richiesta effettuata dal form, quindi vengono applicati gli hook del server e la sicurezza a livello di riga (RLS), e ogni vista della tabella viene aggiornata.
- Accetta direttamente ciò che riceve l'`onClick` di un'azione. Se `context` o `id` mancano (un'azione su un record non ancora creato), non scrive nulla.
- Una scrittura rifiutata genera un errore (throw), e l'azione segnala l'errore all'utente.
- `updateRecord<typeof products>(…)` controlla la `patch` rispetto a ciò che l'aggiornamento della tabella accetta. Una data viene passata come stringa ISO, esattamente come richiesto dal server.

## Cosa viene passato a un'azione

Ogni callback di un'azione (`onClick`, `isEnabled`, `disabledReason`) riceve il record su cui viene eseguita:

| Proprietà | Descrizione |
|-----------|-------------|
| `row` | Il record così come il server invia la riga, la struttura restituita da `useRows` e `context.data`: date come stringhe ISO, un belongsTo come la relativa colonna di chiave esterna (`authorId`). Esattamente le colonne del record: `row.id` è una colonna `id`, dove la tabella ne ha una, con il tipo di quella colonna. È `undefined` finché non è presente un record salvato. |
| `id` | L'ID del record, così come gestito dal pannello di amministrazione: la sua chiave primaria come stringa, con le parti di una chiave composita unite da `:::` (`"5"` per una chiave intera `5`). |
| `path` | Il percorso della collezione in cui si trova il record, inclusi i segmenti di sottocollezione (`authors/7/posts`). |
| `collection`, `context` | La collezione e il contesto di amministrazione: `context.data`, `context.snackbarController`, `context.dialogsController`, … |
| `formContext` | Nel form di modifica di un record aperto, il form stesso: i suoi `values` sono quelli del form, incluse le modifiche non salvate. È `undefined` nella collezione e nella vista di sola lettura. |
| `view` | `"collection"` o `"form"`. |
| `highlightRow(id)`, `unhighlightRow(id)` | Nella collezione, evidenzia una riga tramite il suo ID e rimuove l'evidenziazione. |
| `selectionController` | Nella collezione, la relativa selezione per ID: `isSelected(id)`, `toggleSelection(row, selected?)`, `selection` (le righe spuntate o la query corrispondente a "tutti i risultati"). |

## Dove compare un'azione

Un'azione compare sul record, sia nel suo form di modifica che nella sua vista di sola lettura, e sulle righe della tabella della collezione. Per impostazione predefinita, rimane nel menu di overflow (⋮) in entrambe le posizioni.

Imposta `collapsed: false` sull'azione principale per cui gli utenti aprono il record, in modo da darle un pulsante dedicato:

- **Sul record**, diventa un pulsante con etichetta nella barra, posizionato prima di Salva (o Modifica, nella vista di sola lettura). Quando la barra ha poco spazio, come in un pannello laterale, in una finestra di dialogo o in una finestra stretta, i pulsanti nascondono prima le loro etichette mantenendo solo l'icona, con il nome visibile in un tooltip. Se lo spazio è ancora insufficiente, gli ultimi elementi dichiarati rientrano nel menu a scomparsa; dichiara quindi i più importanti per primi.
- **Su una riga della tabella**, diventa un'icona accanto a Modifica quando il cursore passa sopra la riga (hover).

```typescript
{
    name: "Publish",
    icon: "Upload",
    collapsed: false, // a button on the record, an icon on the row
    onClick: async ({ row, context }) => { /* … */ }
}
```

Riserva questa impostazione per una o due azioni principali che motivano l'apertura del record. Il resto è più fruibile all'interno del menu, che le raggruppa in tre sezioni: per prime le azioni proprie della collezione, nell'ordine in cui sono state dichiarate; poi Copia, Cronologia e Ispeziona; infine Elimina, per ultima e separata.

| Proprietà | Valore predefinito | Effetto |
|-----------|--------------------|---------|
| `collapsed` | `true` | `false` rende l'azione un pulsante sul record e un'icona sulla riga della tabella |
| `includeInForm` | `true` | `false` esclude l'azione dal record e la lascia sulle righe della collezione |
| `showActionsInListView` | `false` | `true` mostra l'azione come un'icona su ogni riga della vista a elenco |
| `isEnabled` | — | Restituisce `false` per mostrare l'azione disabilitata, come pulsante o come voce di menu |
| `disabledReason` | — | Spiega perché un'azione disabilitata non è disponibile: sotto il suo nome in un menu e come tooltip di un pulsante o di un'icona disabilitati |
| `nameKey` | — | Una chiave di traduzione per il nome. Il pannello di amministrazione mostra la sua traduzione nella lingua corrente, oppure `name` se la chiave non è presente. Le azioni predefinite la impostano, quindi Modifica, Copia ed Elimina seguono la lingua dell'amministrazione |

Un'azione disabilitata che non ne spiega il motivo sembra malfunzionante. `disabledReason` riceve le stesse proprietà di `isEnabled`, così da poter indicare cosa manca:

```typescript
{
    name: "Resend to Shopify",
    isEnabled: ({ row }) => Boolean(row?.shopify_id),
    disabledReason: () => "This customer has no Shopify account",
    onClick: async ({ row, context }) => { /* … */ }
}
```

Sul record, un pulsante il cui `onClick` restituisce una promise in sospeso mostra uno spinner e non può essere premuto nuovamente fino al completamento della promise. Se l'azione genera un errore o la sua promise viene rifiutata, l'utente visualizza l'errore in una notifica. La vista di sola lettura non ha un form, quindi `formContext` vi risulta `undefined`.

## Azioni sulla collezione (Collection Actions)

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

`Actions` inserisce componenti personalizzati nella barra degli strumenti della collezione, per operare sull'intera collezione o sulle righe selezionate: come `PublishSelected` nell'esempio precedente. Trattandosi di un array, è possibile comporne diverse.

A un'azione vengono passate le proprietà `CollectionActionsProps`. Ognuna gestisce le righe così come le invia il server, nella struttura restituita da `useRows`:

| Proprietà | Descrizione |
|-----------|-------------|
| `selectionController` | La selezione della vista. `selection` è `{ type: "rows", ids, rows }` per le righe spuntate, oppure `{ type: "query", query, excludedIds, count }` per "tutti i risultati corrispondenti"; `selectedCount`, `hasSelection`, `isSelected(id)`, `toggleSelection(row, selected?)`, `setSelectedRows(rows)`, `selectAllMatching(query, count?)`, `clearSelection()`. |
| `tableController` | La query dinamica della vista: `rows`, `loading`, `error`, e i filtri, la ricerca e l'ordinamento condivisi dalla barra degli strumenti (`filterValues`, `setFilterValues`, `searchString`, `sortBy`, …). |
| `path`, `collection`, `context` | La posizione della collezione, la sua configurazione e il contesto di amministrazione. |
| `openNewDocument(defaults?)` | Apre il form per un nuovo record, precompilato. |

Per mantenere selezionate alcune righe dopo aver eseguito un'operazione sulle altre, passa quelle da conservare a `setSelectedRows`:

```ts
const { selection } = selectionController;
if (selection.type === "rows") {
    selectionController.setSelectedRows(selection.rows.filter((_row, i) => failed.has(selection.ids[i])));
}
```

![Collection actions](/img/collection_actions.png)

## Passaggi successivi

- **[customizeTable](/docs/frontend/customize-table)** — Tutte le opzioni delle tabelle
- **[Additional Columns](/docs/frontend/additional-columns)** — Colonne calcolate della tabella
- **[Custom Fields](/docs/frontend/custom-fields)** — Campi personalizzati per i form
