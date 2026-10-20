---
sourceHash: 608b8f9f3290a362
title: Modalità di visualizzazione
sidebar_label: Modalità di visualizzazione
description: Configura le viste tabella, schede e bacheca Kanban per le tue collezioni.
---

## Panoramica

Ogni collezione può essere visualizzata in quattro modalità di visualizzazione:

- **List** — Vista a elenco semplice e pulita (la classica predefinita del CMS)
- **Table** — Griglia in stile foglio di calcolo con modifica inline, ordinamento e filtri
- **Cards** — Griglia di schede per contenuti visivi (immagini, anteprime)
- **Kanban** — Bacheca drag-and-drop raggruppata per una proprietà enum

Queste sono le modalità integrate. Una collezione può anche offrire modalità di visualizzazione create da te — un calendario, una mappa, una galleria — nello stesso selettore, gestite dalla stessa barra degli strumenti: consulta [Modalità di visualizzazione personalizzate](/docs/frontend/extending#custom-view-modes) e la guida del calendario in [Personalizzazione dell'Admin](/docs/frontend/customizing).

## Configurazione

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const productsCollection = defineCollection({
    slug: "products",
    // `orderProperty` and `kanban.columnProperty` are checked against these
    // keys — with an empty `properties` block they narrow to `never`.
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        status: { name: "Status", type: "string" },
        // The order key. A *string*, never a number — see "Ordering" below.
        __order: {
            name: "Order",
            type: "string",
            admin: { disabled: true, hideFromCollection: true }
        }
    },
    name: "Products",
    table: "products",
    admin: {
        defaultViewMode: "table",            // Default view
        enabledViews: ["list", "table", "kanban"],    // Available views
        orderProperty: "__order",           // Property for drag-and-drop ordering
        kanban: {
            columnProperty: "status"         // Enum property for columns
        }
    }
});

```

## Vista Elenco

La vista elenco è la classica e pulita modalità di visualizzazione predefinita del CMS, che mostra le entità in un formato a elenco lineare senza la densità di un foglio di calcolo.

## Vista Tabella

La vista tabella è un foglio di calcolo virtualizzato ad alte prestazioni dotato di:

- **Modifica inline** — Fai clic su qualsiasi cella per modificarla direttamente
- **Ridimensionamento delle colonne** — Trascina le intestazioni di colonna
- **Riordinamento delle colonne** — Trascina per riorganizzare
- **Ordinamento** — Fai clic sulle intestazioni di colonna
- **Ricerca testuale** — Ricerca full-text tra i campi stringa
- **Filtri** — Filtri per singola colonna
- **Selezione multipla** — Seleziona entità per azioni di massa

### Altezza delle righe

Controlla l'altezza delle righe con `defaultSize`:

| Dimensione | Pixel | Ideale per |
|------|--------|----------|
| `"xs"` | 36 | Tabelle di dati dense |
| `"s"` | 42 | Righe di testo compatte |
| `"m"` | 48 | Predefinito |
| `"l"` | 96 | Miniature di immagini medie |
| `"xl"` | 160 | Miniature di immagini grandi |

## Vista Kanban

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

Il drag-and-drop tra le colonne aggiorna automaticamente il campo enum e l'ordine di visualizzazione.

### Ordinamento

`kanban` e `orderProperty` sono due metà della stessa funzionalità. Dichiarale entrambe, ogni singola volta — tre errori comuni in questo punto producono tutti una bacheca che sembra configurata ma non lo è.

**`orderProperty` non è opzionale.** Senza di essa, una scheda può comunque essere trascinata tra le colonne, poiché quell'azione scrive `columnProperty`. La sua posizione *all'interno* di una colonna non ha però dove essere memorizzata, quindi si reimposta alla lettura successiva, e la bacheca mostra una barra ambrata che ti informa che l'ordinamento non è configurato.

**La proprietà deve essere una `string`.** Il riordinamento scrive una chiave di [fractional-indexing](https://github.com/rocicorp/fractional-indexing) — `"i0"`, `"i1"`, `"i0i"` — non un indice numerico. Una proprietà `number` non può mai contenerne una, quindi un `sortOrder` numerico fa sì che la bacheca chieda all'infinito di essere inizializzata, e l'inizializzazione stessa fallisce a fronte di una colonna numerica. Dichiarala nascosta; è un meccanismo interno, non un contenuto:

```typescript
__order: {
    type: "string",
    name: "Order",
    admin: { disabled: true, hideFromCollection: true }
}
```

**Le righe create al di fuori dell'admin arrivano senza chiave.** Niente ne assegna una all'inserimento. Una riga scritta da un cron job, da uno script di seed, da una migrazione o dalle API REST viene inserita con `__order` impostato a null, e la bacheca mostra *"Some items don't have order values"* con un pulsante **Initialize** — un clic esegue il backfill della prima pagina, ma la successiva esecuzione del cron riporterà immediatamente la barra. Se un backend crea righe per una bacheca, deve aggiungere la chiave autonomamente. Usa lo stesso alfabeto utilizzato dall'admin:

```typescript
import { generateKeyBetween } from "fractional-indexing";

// Base36, lower case. Postgres does the sorting and its default collation is
// not byte ordering, so the library's default base62 alphabet — which mixes
// cases — sorts differently in the database than in the key. Omitting this
// third argument produces keys like "a0" that the board rejects.
const ORDER_KEY_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

const tasks = client.data.collection("tasks");

// The last key currently in use. `is-not-null` is not optional: a descending
// sort is NULLS FIRST, so without it this reads back one of the very rows that
// has no key and every insert lands on the same "i0".
const { data: last } = await tasks.find({
    where: { __order: ["is-not-null", null] },
    orderBy: ["__order", "desc"],
    limit: 1
});

await tasks.create({
    title,
    status,
    __order: generateKeyBetween(
        (last[0]?.__order as string | undefined) ?? null,
        null,
        ORDER_KEY_DIGITS
    )
});
```

Anche le righe create tramite il form dell'admin arrivano prive di chiave — l'unica differenza è che vedrai comparire la barra nel momento stesso in cui ne aggiungi una. In quel caso **Initialize** è la soluzione; su una bacheca alimentata da un backend, invece, è una correzione che viene annullata a ogni esecuzione.

## Vista Schede

Le schede mostrano le entità come card visive — utili per contenuti ricchi di immagini:

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

## Prossimi passi

- **[Personalizzazione dell'Admin](/docs/frontend/customizing)** — Crea le tue modalità di visualizzazione, pagine e azioni
- **[Viste entità](/docs/frontend/entity-views)** — Schede personalizzate nei form delle entità
- **[Azioni entità](/docs/frontend/entity-actions)** — Azioni personalizzate per le entità
