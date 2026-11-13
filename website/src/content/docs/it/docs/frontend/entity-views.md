---
sourceHash: faf8f760aabce923
title: Entity Views
sidebar_label: Entity Views
description: Aggiungi schede e viste personalizzate alle pagine di dettaglio delle entità per anteprime, analisi, dati correlati o UI personalizzata.
---

## Panoramica

Le viste delle entità (Entity views) consentono di aggiungere **schede** (tabs) personalizzate alla pagina di dettaglio dell'entità accanto al form predefinito. Utilizzale per:

- **Anteprime** in tempo reale (anteprima del sito web, contenuti renderizzati)
- Viste di **dati correlati** (articoli dell'ordine, entità figlie)
- **Analytics** o grafici
- **Editor personalizzati** (rich text, editor di mappe)

## Aggiungere Entity Views

<span class="since-badge" data-since="0.31">Since 0.31</span>

```tsx
// frontend/src/cms/products.tsx
import { customizeTable } from "@rebasepro/cms";
import type { products } from "../../../backend/schema/products";
import { ArticlePreview } from "../../../../../components/ArticlePreview";

export const productsCms = customizeTable<typeof products>("products", {
    entityViews: [
        { key: "preview", name: "Preview", Builder: ArticlePreview, position: "start" },
        "related",   // registered once on <RebaseCMS entityViews>
    ],
});
```

Una voce è una vista, o la `key` di una registrata una volta su
`<RebaseCMS entityViews>` (o `<Rebase entityViews>`), per schede condivise da più tabelle.
Una vista registrata viene mostrata solo sulle tabelle che ne specificano la chiave.
`position: "start"` posiziona la scheda prima di quella del form; in caso contrario, viene posizionata dopo.

## Creare una Entity View

<span class="since-badge" data-since="0.31">Since 0.31</span>

`Builder` è il componente stesso, importato per valore:

```tsx
// frontend/src/components/ArticlePreview.tsx
import React from "react";
import type { EntityCustomViewParams } from "@rebasepro/cms-types";

export function ArticlePreview({ row, modifiedValues }: EntityCustomViewParams) {
    // modifiedValues has the unsaved, live form values; row is the saved
    // record. Both are open records, so narrow before rendering.
    const title = String(modifiedValues?.title ?? row?.title ?? "");
    const content = String(modifiedValues?.content ?? row?.content ?? "");

    return (
        <div className="p-8 max-w-2xl mx-auto">
            <h1 className="text-xl font-semibold tracking-[-0.01em]">{title}</h1>
            <div dangerouslySetInnerHTML={{ __html: content }} />
        </div>
    );
}
```

### EntityCustomViewParams

<span class="since-badge" data-since="0.31">Since 0.31</span>

| Prop | Type | Descrizione |
|------|------|-------------|
| `row` | `Record<string, unknown>` | Il record salvato così come il server invia la riga: le date come stringhe ISO, un belongsTo come colonna di foreign-key, `id` solo dove la tabella ha quella colonna. Assente durante la creazione di uno nuovo |
| `id` | `string` | L'id del record salvato, accanto a `row`: la sua chiave primaria come stringa, le parti di una chiave composita unite da `:::`. Ciò che accettano `useSidePanel().open` e `useRowWrites().update`. Assente durante la creazione di uno nuovo |
| `modifiedValues` | `EntityValues` | Valori correnti del form, incluse le modifiche non salvate (in tempo reale mentre l'utente digita), tipizzati per l'editor: una data è un `Date` |
| `formContext` | `FormContext` | Contesto completo del form |
| `collection` | `AdminCollection` | La collezione così come risolta dal CMS |

![Entity view with secondary form](/img/entity_view_secondary_form.png)

Anche le relazioni to-many di una tabella sono schede del record, senza bisogno di nulla di tutto questo;
vedi [Relazioni nel pannello](/docs/collections/relations-in-the-admin-panel/).
`defaultSelectedView` in `customizeTable` imposta la scheda su cui si apre un record.

## Passaggi successivi

- **[Campi personalizzati](/docs/frontend/custom-fields)** — Crea campi di form personalizzati
- **[Azioni entità](/docs/frontend/entity-actions)** — Pulsanti di azione personalizzati
