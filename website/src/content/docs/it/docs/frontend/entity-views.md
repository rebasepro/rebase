---
title: Viste Entità
sidebar_label: Viste Entità
description: Aggiungi schede e viste personalizzate alle pagine di dettaglio delle entità per anteprime, analisi, dati correlati o UI personalizzate.
---

## Overview

Le viste entità ti permettono di aggiungere **schede** personalizzate alla pagina di dettaglio dell'entità accanto al modulo predefinito. Usale per:

- **Anteprime** in tempo reale (anteprima sito web, contenuto renderizzato)
- Viste di **dati correlati** (articoli dell'ordine, entità figlie)
- **Analisi** o grafici
- **Editor personalizzati** (testo RTF, editor di mappe)

## Adding Entity Views

```typescript
const articlesCollection: EntityCollection = {
    slug: "articles",
    name: "Articles",
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
    ],
    properties: { /* ... */ }
};
```

## Building an Entity View

```tsx
import { EntityCustomViewParams } from "@rebasepro/types";

function ArticlePreview({
    entity,
    modifiedValues,
    formContext
}: EntityCustomViewParams) {
    // modifiedValues has the unsaved, live form values
    const title = modifiedValues?.title ?? entity?.values?.title;
    const content = modifiedValues?.content ?? entity?.values?.content;

    return (
        <div className="p-8 max-w-2xl mx-auto">
            <h1 className="text-3xl font-bold">{title}</h1>
            <div dangerouslySetInnerHTML={{ __html: content }} />
        </div>
    );
}
```

### EntityCustomViewParams

| Proprietà | Tipo | Descrizione |
|-----------|------|-------------|
| `entity` | `Entity` | L'entità salvata (null per nuove entità) |
| `modifiedValues` | `EntityValues` | Valori correnti del modulo non salvati (aggiornati in tempo reale mentre l'utente digita) |
| `formContext` | `FormContext` | Contesto completo del modulo |
| `collection` | `EntityCollection` | Definizione della collezione |

![Vista entità con modulo secondario](/img/entity_view_secondary_form.png)

## Controlling Position

Le viste appaiono come schede. Puoi configurarne la posizione:

```typescript
entityViews: [
    {
        key: "preview",
        name: "Preview",
        Builder: ArticlePreview,
        position: "start"  // Appare prima della scheda del modulo predefinito
    }
]
```

## Next Steps

- **[Campi Personalizzati](/docs/frontend/custom-fields)** — Crea campi modulo personalizzati
- **[Azioni Entità](/docs/frontend/entity-actions)** — Pulsanti di azione personalizzati

---
