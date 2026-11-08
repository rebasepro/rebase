---
sourceHash: e44d87326ffbed8c
title: Viste entità
sidebar_label: Viste entità
description: Aggiungi schede e viste personalizzate alle pagine di dettaglio dell'entità per anteprime, analisi, dati correlati o UI personalizzata.
---

## Panoramica

Le viste entità consentono di aggiungere **schede** personalizzate alla pagina di dettaglio dell'entità insieme al modulo predefinito. Utilizzale per:

- **Anteprime** in tempo reale (anteprima del sito web, contenuti renderizzati)
- Viste di **dati correlati** (elementi dell'ordine, entità figlie)
- **Analitiche** o grafici
- **Editor personalizzati** (rich text, editor di mappe)

## Aggiunta di viste entità

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const articlesCollection = defineCollection({
    slug: "articles",
    table: "articles",
    name: "Articles",
    properties: { /* ... */ },
    admin: {
        entityViews: [
            {
                key: "preview",
                name: "Preview",
                Builder: ArticlePreview
            },
            {
                key: "related",
                name: "Related Articles",
                Builder: RelatedArticlesView
            }
        ]
    }
});

```

## Creare una vista entità

```tsx
import type { EntityCustomViewParams } from "@rebasepro/cms-types";

function ArticlePreview({
    row,
    modifiedValues,
    formContext
}: EntityCustomViewParams) {
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

| Prop | Tipo | Descrizione |
|------|------|-------------|
| `row` | `Record<string, unknown>` | Il record salvato così come il server invia la riga: date come stringhe ISO, un belongsTo come la sua colonna foreign-key, `id` solo dove la tabella ha tale colonna. Assente durante la creazione di un nuovo record |
| `id` | `string` | L'id del record salvato, accanto a `row`: la sua chiave primaria sotto forma di stringa, le parti di una chiave composita unite da `:::`. Ciò che accettano `useSidePanel().open` e `useRowWrites().update`. Assente durante la creazione di un nuovo record |
| `modifiedValues` | `EntityValues` | I valori correnti del modulo, incluse le modifiche non salvate (in tempo reale durante la digitazione dell'utente), tipizzati per l'editor: una data è un oggetto `Date` |
| `formContext` | `FormContext` | Contesto completo del modulo |
| `collection` | `AdminCollection` | Definizione della collezione |

![Vista entità con modulo secondario](/img/entity_view_secondary_form.png)

## Controllo della posizione

Le viste appaiono come schede. È possibile configurarne la posizione:

```typescript
entityViews: [
    {
        key: "preview",
        name: "Preview",
        Builder: ArticlePreview,
        position: "start"  // Appears before the default form tab
    }
]
```

## Passaggi successivi

- **[Campi personalizzati](/docs/frontend/custom-fields)** — Crea campi modulo personalizzati
- **[Azioni entità](/docs/frontend/entity-actions)** — Pulsanti di azione personalizzati
