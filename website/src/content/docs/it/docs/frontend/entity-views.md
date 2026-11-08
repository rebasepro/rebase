---
sourceHash: 0a2cae1ef41369b1
title: Viste entità
sidebar_label: Viste entità
description: Aggiungi schede e viste personalizzate alle pagine di dettaglio delle entità per anteprime, analisi, dati correlati o UI personalizzata.
---

## Panoramica

Le viste entità consentono di aggiungere **schede** personalizzate alla pagina di dettaglio dell'entità, affiancandole al form predefinito. Utilizzale per:

- **Anteprime** in tempo reale (anteprima del sito web, contenuti renderizzati)
- Viste di **dati correlati** (voci dell'ordine, entità figlie)
- **Analisi** o grafici
- **Editor personalizzati** (rich text, editor di mappe)

## Aggiungere viste entità

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
| `row` | `Record<string, unknown>` | Il record salvato così come il server invia la riga: date come stringhe ISO, un belongsTo come colonna della foreign key, `id` incluso. Assente durante la creazione di uno nuovo |
| `modifiedValues` | `EntityValues` | Valori correnti del form, incluse le modifiche non salvate (in tempo reale mentre l'utente digita), tipizzati per l'editor: una data è un oggetto `Date` |
| `formContext` | `FormContext` | Contesto completo del form |
| `collection` | `AdminCollection` | Definizione della collection |

![Vista entità con form secondario](/img/entity_view_secondary_form.png)

## Controllare la posizione

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

- **[Custom Fields](/docs/frontend/custom-fields)** — Crea campi del form personalizzati
- **[Entity Actions](/docs/frontend/entity-actions)** — Pulsanti di azione personalizzati
