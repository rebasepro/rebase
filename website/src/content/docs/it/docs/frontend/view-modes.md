---
sourceHash: 2cf8f0e1f2cb33d7
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
import { defineCollection } from "@rebasepro/cms-types";
const productsCollection = defineCollection({
    slug: "products",
    properties: { /* … */ },
    name: "Products",
    table: "products",
    // ...
    admin: {
        defaultViewMode: "table",            // Default view
        enabledViews: ["list", "table", "kanban"],    // Available views
        orderProperty: "__order",           // Proprietà per il riordino drag-and-drop
        kanban: {
            columnProperty: "status"         // Enum property for columns
        }
    }
});

```

## Visualizzazione Lista

La visualizzazione lista è la modalità predefinita classica e pulita del CMS, che mostra le entità in un formato elenco diretto senza la densità di un foglio di calcolo.

## Visualizzazione Tabella

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

Configura una bacheca Kanban specificando quale proprietà enum utilizzare come colonne:

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const tasksCollection = defineCollection({
    slug: "tasks",
    name: "Tasks",
    table: "tasks",
    properties: {
        title: { type: "string", name: "Title" },
        status: {
            type: "string",
            name: "Status",
            enum: [
                { id: "backlog", label: "Backlog", color: "gray" },
                { id: "in_progress", label: "In Progress", color: "blue" },
                { id: "review", label: "Review", color: "orange" },
                { id: "done", label: "Done", color: "green" }
            ]
        },
        __order: {
            type: "string",
            name: "Order",
            admin: { disabled: true, hideFromCollection: true }
        }
    },
    admin: {
        defaultViewMode: "kanban",
        orderProperty: "__order",
        kanban: {
            columnProperty: "status"
        }
    }
});

```

Il trascinamento tra le colonne aggiorna automaticamente il campo enum e l'ordine di ordinamento.

### Ordinamento

`kanban` e `orderProperty` sono due metà della stessa funzionalità. Dichiarale
sempre entrambe — tre errori qui producono una board che *sembra* configurata e
non lo è.

**`orderProperty` non è opzionale.** Senza, una card si trascina comunque tra le
colonne, perché quel gesto scrive `columnProperty`. La sua posizione *dentro* la
colonna non ha dove essere salvata: torna indietro alla lettura successiva e la
board mostra una barra ambra che segnala l'ordinamento non configurato.

**La proprietà deve essere una `string`.** Il riordino scrive una chiave
[fractional-indexing](https://github.com/rocicorp/fractional-indexing) — `"i0"`,
`"i1"`, `"i0i"` — non un indice. Una proprietà `number` non può contenerla:
un `sortOrder` numerico lascia la board che chiede all'infinito di essere
inizializzata, e l'inizializzazione stessa fallisce contro una colonna numerica.
Dichiarala nascosta: è meccanica, non contenuto.

```typescript
__order: {
    type: "string",
    name: "Order",
    admin: { disabled: true, hideFromCollection: true }
}
```

**Le righe create fuori dall'admin arrivano senza chiave.** Nessuno la assegna
all'inserimento. Una riga scritta da un cron, uno script di seed, una migrazione
o l'API REST arriva con `__order` a null e la board mostra *"Some items don't
have order values"* con un pulsante **Initialize** — un clic riempie la prima
pagina, e il cron successivo riporta la barra. Se un backend crea righe per una
board, deve assegnare la chiave da sé, con lo stesso alfabeto usato dall'admin:

```typescript
import { generateKeyBetween } from "fractional-indexing";

// Base36, minuscolo. Ordina Postgres, la cui collation predefinita non è
// l'ordinamento per byte: omettere questo terzo argomento produce chiavi base62
// come "a0" che la board rifiuta.
const ORDER_KEY_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

const tasks = client.data.collection("tasks");

// L'ultima chiave in uso. `is-not-null` non è opzionale: un ordinamento
// discendente è NULLS FIRST, quindi senza di esso questo rilegge una delle
// righe senza chiave e ogni inserimento finisce sullo stesso "i0".
const { data: last } = await tasks.find({
    where: { __order: ["is-not-null", null] },
    orderBy: ["__order", "desc"],
    limit: 1
});

await tasks.create({
    title,
    status,
    __order: generateKeyBetween(last[0]?.__order ?? null, null, ORDER_KEY_DIGITS)
});
```

## Visualizzazione Schede

Le schede mostrano le entità come schede visive — utili per contenuti ricchi di immagini:

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const articlesCollection = defineCollection({
    slug: "articles",
    name: "Articles",
    table: "articles",
    properties: {
        title: { type: "string", name: "Title" },
        cover: {
            type: "string",
            name: "Cover Image",
            storage: { storagePath: "covers", acceptedFiles: ["image/*"] }
        }
    },
    admin: {
        defaultViewMode: "cards"
    }
});

```

## Passi Successivi

- **[Visualizzazioni Entità](/docs/frontend/entity-views)** — Schede personalizzate sui moduli entità
- **[Azioni Entità](/docs/frontend/entity-actions)** — Azioni entità personalizzate
