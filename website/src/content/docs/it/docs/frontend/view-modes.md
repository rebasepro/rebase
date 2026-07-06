---
title: Modalità di Visualizzazione
sidebar_label: Modalità di Visualizzazione
description: Configura le visualizzazioni tabella, schede e bacheca Kanban per le tue collezioni.
---

## Panoramica

Ogni collezione può essere visualizzata in quattro modalità:

- **Lista** — Visualizzazione elenco semplice e pulita (il classico predefinito CMS)
- **Tabella** — Griglia in stile foglio di calcolo con modifica inline, ordinamento, filtraggio
- **Schede** — Griglia di schede per contenuti visivi (immagini, anteprime)
- **Kanban** — Bacheca drag-and-drop raggruppata per una proprietà enum

## Configurazione

```typescript
const productsCollection: CollectionConfig = {
    slug: "products",
    defaultViewMode: "table",            // Default view
    enabledViews: ["list", "table", "kanban"],    // Available views
    kanban: {
        columnProperty: "status",        // Enum property for columns
        orderProperty: "sort_order"      // Property for drag-and-drop ordering
    },
    // ...
};
```

## Visualizzazione Lista

![Screenshot segnaposto della visualizzazione Lista](/img/features/list-view.png)

La visualizzazione lista è la modalità predefinita classica e pulita del CMS, che mostra le entità in un formato elenco diretto senza la densità di un foglio di calcolo.

## Visualizzazione Tabella

![Screenshot segnaposto della visualizzazione Tabella](/img/features/table-view.png)

La visualizzazione predefinita è un foglio di calcolo virtualizzato ad alte prestazioni con:

- **Modifica inline** — Clicca su qualsiasi cella per modificare sul posto
- **Ridimensionamento colonne** — Trascina le intestazioni delle colonne
- **Riordinamento colonne** — Trascina per riorganizzare
- **Ordinamento** — Clicca sulle intestazioni delle colonne
- **Ricerca testuale** — Ricerca full-text tra i campi stringa
- **Filtraggio** — Filtri per colonna
- **Selezione multipla** — Seleziona entità per azioni di massa

### Altezza delle Righe

Controlla l'altezza delle righe con `defaultSize`:

| Dimensione | Pixel | Ideale per |
|------------|-------|------------|
| `"xs"` | 40 | Tabelle dati dense |
| `"s"` | 54 | Predefinito |
| `"m"` | 80 | Con miniature di immagini |
| `"l"` | 120 | Schede con anteprime |
| `"xl"` | 260 | Anteprime di contenuti ricchi |

## Visualizzazione Kanban

![Screenshot segnaposto della visualizzazione Kanban](/img/features/kanban-view.png)

Configura una bacheca Kanban specificando quale proprietà enum utilizzare come colonne:

```typescript
const tasksCollection: CollectionConfig = {
    slug: "tasks",
    defaultViewMode: "kanban",
    kanban: {
        columnProperty: "status",
        orderProperty: "sort_order"
    },
    properties: {
        title: { type: "string", name: "Title" },
        status: {
            type: "string",
            name: "Status",
            enum: [
                { id: "backlog", label: "Backlog", color: "grayDark" },
                { id: "in_progress", label: "In Progress", color: "blueDark" },
                { id: "review", label: "Review", color: "orangeDark" },
                { id: "done", label: "Done", color: "greenDark" }
            ]
        },
        sort_order: { type: "number", name: "Sort Order" }
    }
};
```

Il trascinamento tra le colonne aggiorna automaticamente il campo enum e l'ordine di ordinamento.

## Visualizzazione Schede

![Screenshot segnaposto della visualizzazione Schede](/img/features/cards-view.png)

Le schede mostrano le entità come schede visive — utili per contenuti ricchi di immagini:

```typescript
const articlesCollection: CollectionConfig = {
    slug: "articles",
    defaultViewMode: "cards",
    properties: {
        title: { type: "string", name: "Title" },
        cover: {
            type: "string",
            name: "Cover Image",
            storage: { storagePath: "covers", acceptedFiles: ["image/*"] }
        }
    }
};
```

## Passi Successivi

- **[Visualizzazioni Entità](/docs/frontend/entity-views)** — Schede personalizzate sui moduli entità
- **[Azioni Entità](/docs/frontend/entity-actions)** — Azioni entità personalizzate
