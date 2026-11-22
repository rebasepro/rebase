---
sourceHash: 94cc15a104ed93ec
title: Modalità di visualizzazione
sidebar_label: Modalità di visualizzazione
description: "Mostra le righe di una tabella come elenco, foglio di calcolo, schede o bacheca kanban; scegli cosa inserire nel titolo, immagine, stato e data di ciascun record; e imposta l'ordinamento predefinito, i filtri e i preset di filtro a clic singolo."
---

Ogni collezione può essere mostrata in quattro modi, dal selettore nella sua barra degli strumenti:

- **Table**: un foglio di calcolo virtualizzato con modifica inline, ordinamento, filtraggio
  e selezione multipla. Il punto in cui si apre una collezione, a meno che non venga indicato diversamente.
- **List**: una riga per record, con la sua immagine, titolo, sottotitolo, stato e
  data.
- **Cards**: una griglia di schede, per contenuti ricchi di immagini.
- **Kanban**: una bacheca raggruppata per una colonna con un insieme chiuso di valori.

Una collezione può anche offrire modalità di visualizzazione create da te (un calendario, una mappa, una
galleria) nello stesso selettore, gestite dalla stessa barra degli strumenti: vedi
[Modalità di visualizzazione personalizzate](/docs/frontend/extending#custom-view-modes).

## Scelta delle viste

```ts
// backend/schema/tasks.ts
import { defineTable, col } from "@rebasepro/server/schema";

export const tasks = defineTable("tasks", {
    columns: {
        id:      col.uuid().primaryKey().defaultRandom(),
        title:   col.text().notNull(),
        status:  col.enum(["backlog", "in_progress", "review", "done"]).notNull().default("backlog"),
        dueDate: col.date(),
        // The board's order key: text, never a number.
        __order: col.text(),
    },
    rls: "admin-only",
});
```

```tsx
// frontend/src/cms/tasks.tsx
import { customizeTable } from "@rebasepro/cms";
import type { tasks } from "../../../backend/schema/tasks";

export const tasksCms = customizeTable<typeof tasks>("tasks", {
    defaultViewMode: "kanban",
    enabledViews: ["table", "kanban"],
    kanban: { columnField: "status", orderField: "__order" },
    fields: {
        status: {
            enumLabels: {
                backlog:     { label: "Backlog", color: "gray" },
                in_progress: { label: "In Progress", color: "blue" },
                review:      { label: "Review", color: "orange" },
                done:        { label: "Done", color: "green" },
            },
        },
        __order: { hidden: true },
    },
});
```

| Opzione | Effetto |
|---|---|
| `defaultViewMode` | Dove atterra un visitatore: `"table"`, `"list"`, `"cards"`, `"kanban"` o la chiave di una vista personalizzata. |
| `enabledViews` | Le viste offerte dal selettore. |
| `kanban` | `{ columnField, orderField }`: la bacheca. |
| `defaultSize` | L'altezza della riga, indicata sotto. |
| `customViews` | Viste personalizzate, per valore o per chiave. |

### Altezza della riga

| `defaultSize` | Pixel | Ideale per |
|------|--------|----------|
| `"xs"` | 36 | Tabelle di dati dense |
| `"s"` | 42 | Righe di testo compatte |
| `"m"` | 48 | Predefinito |
| `"l"` | 96 | Miniature di immagini medie |
| `"xl"` | 160 | Miniature di immagini grandi |

## Kanban

`kanban.columnField` specifica la colonna in base a cui la bacheca esegue il raggruppamento. Deve contenere un
insieme chiuso di stringhe, un `col.enum([...])` o una colonna di testo con
`.oneOf([...])`; qualsiasi altra cosa genera un errore di tipo. Le colonne vengono disegnate nell'ordine
proprio della colonna, o in `enumOrder`, con le etichette e i colori di
`enumLabels`. Il trascinamento di una scheda in un'altra colonna scrive in `columnField`.

`kanban.orderField` specifica dove viene memorizzata la posizione di una scheda **all'interno** di una colonna.
Dichiaralo ogni volta che tale ordine è importante: tre errori in questo punto producono tutti una bacheca
che sembra configurata ma non lo è.

**Senza `orderField`, viene mantenuta solo la colonna.** Una scheda può comunque essere trascinata tra le
colonne, perché ciò scrive in `columnField`, che è tutto ciò di cui una bacheca di stato ha bisogno.
La sua posizione all'interno di una colonna non ha un luogo in cui essere memorizzata, quindi si reimposta alla
lettura successiva. La bacheca lo segnala la prima volta che una scheda viene rilasciata in una nuova posizione
all'interno della propria colonna, in una barra che può essere chiusa; una bacheca le cui schede si spostano
solo tra le colonne non mostra nulla.

**La colonna deve essere di testo.** Il riordinamento scrive una chiave di
[fractional-indexing](https://github.com/rocicorp/fractional-indexing)
(`"i0"`, `"i1"`, `"i0i"`), non un indice. Una colonna numerica non potrà mai contenerne una, quindi
`orderField` accetta solo una colonna di testo. Si tratta di meccanismi interni, non di contenuto: nascondila,
come mostrato sopra.

**Le righe create all'esterno del CMS arrivano senza chiave.** Nulla ne assegna una durante
l'inserimento. Una riga scritta da un cron, uno script di seed, una migrazione o dall'API REST
arriva con `__order` impostato su null, e la bacheca mostra *"Some items don't have order
values"* con un pulsante **Initialize**. Un clic esegue il backfill della prima pagina, e
la successiva esecuzione del cron fa ricomparire subito la barra. Se un backend crea righe per una
bacheca, dovrebbe aggiungere la chiave da sé, utilizzando l'alfabeto impiegato dal CMS:

```typescript
import { generateKeyBetween } from "fractional-indexing";

// Base36, lower case. Postgres does the sorting and its default collation is
// not byte ordering, so the library's default base62 alphabet — which mixes
// cases — sorts differently in the database than in the key. Omitting this
// third argument produces keys like "a0" that the board rejects.
const ORDER_KEY_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

// The last key currently in use. `is-not-null` is not optional: a descending
// sort is NULLS FIRST, so without it this reads back one of the very rows that
// has no key and every insert lands on the same "i0".
const { data: last } = await client.data.tasks.find({
    where: { __order: ["is-not-null", null] },
    orderBy: ["__order", "desc"],
    limit: 1
});

await client.data.tasks.create({
    title,
    status,
    __order: generateKeyBetween(
        (last[0]?.__order as string | undefined) ?? null,
        null,
        ORDER_KEY_DIGITS
    )
});
```

Anche le righe create tramite il form arrivano prive di chiave; l'unica differenza è che
vedi la barra nel momento stesso in cui ne aggiungi una. **Initialize** è la soluzione in quel caso;
su una bacheca alimentata da un backend, si tratta di una soluzione che si annulla a ogni esecuzione.

## Slot di visualizzazione

Ogni superficie che disegna un record utilizza alcuni dei sei slot: **title**,
**subtitle**, **image**, **status**, **date** e **tags**. Una riga di elenco è image +
title + subtitle + status + date, una scheda è identica con l'immagine in alto, un
selettore di riferimenti è title + subtitle, e l'intestazione di una pagina è solo il title.

Il CMS compila alcuni slot dalle colonne della tabella (vedi
[slot di visualizzazione predefiniti](/docs/collections/#display-slots)). `display` definisce ciascuno
di essi, come percorso di campo o come funzione:

```tsx
import { customizeTable } from "@rebasepro/cms";
import type { tasks } from "../../../backend/schema/tasks";

export const tasksCms = customizeTable<typeof tasks>("tasks", {
    display: {
        title: "title",
        status: "status",
        date: "dueDate",
        subtitle: ({ row }) => row.dueDate ? `Due ${row.dueDate}` : undefined,
    },
});
```

Uno slot tralasciato mantiene il proprio valore derivato.

A un resolver viene passato `{ row, id, context }`. `row` è il record così come inviato dal
server, tipizzato come riga della tabella: date come stringhe ISO, un belongsTo come la relativa
colonna foreign-key. `id` è la sua chiave primaria come stringa, con le parti di una chiave composita
unite da `:::`. Una relazione caricata dal CMS arriva nidificata sotto il proprio nome, come
restituito dall'`include` di REST, in modo che un resolver possa leggere il campo di un record correlato
senza effettuare una propria richiesta.

Un resolver può essere `async`, per leggere qualcosa che il record non contiene. Mentre
la promise è in corso, la superficie mostra il valore derivato e lo sostituisce con quello
risolto non appena arriva: un titolo non è mai uno spinner di caricamento. I risultati sono memorizzati nella cache
per record e slot, e le richieste simultanee condividono una singola chiamata.

Restituisci `undefined` quando un record non ha nulla per lo slot; la superficie ripiega
su ciò che conosce (un'intestazione usa il nome singolare della collezione, un link usa
l'id). Un resolver che genera un'eccezione viene trattato come `undefined` e registrato nei log una volta sola.

Prediligi un percorso ogni volta che il valore è presente sul record: un percorso mantiene il rendering
proprio del campo, quindi uno stato enum rimane un badge colorato e una data rimane formattata,
cosa che un resolver che restituisce una stringa non può fare.

Quando nessuno slot specifica il titolo, il CMS ne sceglie uno dal testo stesso della tabella.
Con `fieldOrder`, viene scelto il primo campo in quell'ordine che può fungere da titolo.
Altrimenti, i candidati vengono classificati per priorità: prima il testo la cui chiave corrisponde a un'etichetta (`name`,
`title`, `label`…), poi testo breve, un'email, un enum, testo lungo e un
selettore utente. Chiavi, colonne uuid, foreign key, relazioni, riferimenti, documenti
JSON, campi file e campi nascosti non sono mai idonei: una relazione indica
un altro record, quindi un cliente che appartiene a un'agenzia non avrà mai come titolo
l'agenzia. Una tabella priva di tutti questi elementi è intitolata con il suo id. Un nome che risiede
all'interno di una colonna JSON, o una relazione che rappresenta effettivamente il nome della riga (una tabella
di giunzione), viene specificato con `display.title`: `title: "data.name"`,
`title: "agency"`. Qualsiasi cosa contenga il titolo viene visualizzata come testo: una data formattata,
un array concatenato, e una relazione come titolo della riga correlata, con fallback
al suo id.

## Filtri, preset e ordinamento

```tsx
import { customizeTable } from "@rebasepro/cms";
import type { tasks } from "../../../backend/schema/tasks";

export const tasksCms = customizeTable<typeof tasks>("tasks", {
    sort: ["dueDate", "asc"],
    defaultFilter: { status: ["!=", "done"] },
    filterPresets: [
        { label: "In review", filterValues: { status: ["==", "review"] } },
        { label: "Overdue", filterValues: { dueDate: ["<", new Date().toISOString().slice(0, 10)] }, sort: ["dueDate", "asc"] },
    ],
});
```

| Opzione | Effetto |
|---|---|
| `sort` | L'ordinamento predefinito: una chiave e una direzione, o diverse in sequenza. |
| `defaultFilter` | Il filtro da cui parte un visitatore, e che può modificare. |
| `fixedFilter` | Un filtro che il visitatore non può modificare. I filtri applicati su altri campi vengono combinati con questo. |
| `filterPresets` | Filtri con un clic nella barra degli strumenti: `{ label?, filterValues, sort? }`. Senza un'etichetta, ne viene generata una a partire dal filtro. |
| `pagination` | Carica a pagine (`true`, o la dimensione della pagina), o tutto in una volta (`false`). |

Ogni chiave viene verificata rispetto ai campi della tabella. Il parametro `filterOperators` del campo stesso
restringe ciò che può essere filtrato su di esso, e `[]` ne disattiva il filtraggio.

Un `fixedFilter` restringe ciò che il CMS *richiede*. Non è una barriera di sicurezza: ciò che un
chiamante può leggere è deciso dalla [row-level security](/docs/collections/security-rules/) della tabella, per ciascun chiamante.

## Passaggi successivi

- [customizeTable](/docs/frontend/customize-table/): tutte le opzioni
- [Personalizzazione dell'admin](/docs/frontend/customizing/): le tue modalità di visualizzazione, pagine e azioni personalizzate
- [Entity views](/docs/frontend/entity-views/): schede su un record
- [Entity actions](/docs/frontend/entity-actions/): pulsanti su un record
