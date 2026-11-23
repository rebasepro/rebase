---
sourceHash: 68aa6b76fbe1dd6b
title: Modalità di visualizzazione
sidebar_label: Modalità di visualizzazione
description: "Mostra le righe di una tabella come elenco, foglio di calcolo, schede o bacheca kanban; scegli cosa inserire nel titolo, nell'immagine, nello stato e nella data di ogni record; imposta l'ordinamento predefinito, i filtri e i preset di filtri con un clic."
---

Ogni raccolta può essere mostrata in quattro modi, tramite il selettore nella sua barra degli strumenti:

- **Table**: un foglio di calcolo virtualizzato con modifica in linea, ordinamento, filtri
  e selezione multipla. Dove una raccolta si apre a meno che non sia specificato diversamente.
- **List**: una riga per record, con immagine, titolo, sottotitolo, stato e
  data.
- **Cards**: una griglia di schede, per contenuti ricchi di immagini.
- **Kanban**: una bacheca raggruppata per una colonna con un insieme chiuso di valori.

Una raccolta può anche offrire modalità di visualizzazione create da te (un calendario, una mappa, una
galleria) nello stesso selettore, gestite dalla stessa barra degli strumenti: vedi
[Modalità di visualizzazione personalizzate](/docs/frontend/extending#custom-view-modes).

## Scelta delle visualizzazioni

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
    },
});
```

| Opzione | Effetto |
|---|---|
| `defaultViewMode` | Dove atterra un visitatore: `"table"`, `"list"`, `"cards"`, `"kanban"` o la chiave di una vista personalizzata. |
| `enabledViews` | Le viste offerte dal selettore. |
| `kanban` | `{ columnField, orderField }`: la bacheca. |
| `defaultSize` | L'altezza della riga, descritta di seguito. |
| `customViews` | Viste personalizzate, per valore o per chiave. |

### Altezza delle righe

| `defaultSize` | Pixel | Ideale per |
|------|--------|----------|
| `"xs"` | 36 | Tabelle di dati dense |
| `"s"` | 42 | Righe di testo compatte |
| `"m"` | 48 | Predefinito |
| `"l"` | 96 | Miniature di immagini medie |
| `"xl"` | 160 | Miniature di immagini grandi |

## Kanban

`kanban.columnField` specifica la colonna in base alla quale la bacheca esegue il raggruppamento. Deve contenere
un insieme chiuso di stringhe, un `col.enum([...])` o una colonna di testo con
`.oneOf([...])`; qualsiasi altra cosa genera un errore di tipo. Le colonne vengono disegnate
nell'ordine proprio della colonna o in `enumOrder`, con le etichette e i colori di
`enumLabels`. Il trascinamento di una scheda in un'altra colonna scrive `columnField`.

`kanban.orderField` specifica dove viene memorizzata la posizione di una scheda **all'interno** di una colonna.
Dichiaralo ogni volta che tale ordine ha importanza: tre errori comuni qui producono una bacheca
che sembra configurata ma non lo è.

**Senza `orderField`, viene mantenuta solo la colonna.** Una scheda può comunque essere trascinata tra
le colonne, poiché ciò scrive `columnField`, che è tutto ciò di cui una bacheca di stato ha bisogno.
La sua posizione all'interno di una colonna non ha un posto dove essere memorizzata, quindi si reimposta alla
lettura successiva. La bacheca lo segnala la prima volta che una scheda viene rilasciata in una nuova posizione
all'interno della propria colonna, in una barra che può essere chiusa; una bacheca le cui schede si spostano
solo tra colonne non mostra nulla.

**La colonna deve essere di tipo testo.** Il riordinamento scrive una chiave di
[indicizzazione frazionaria](https://github.com/rocicorp/fractional-indexing)
(`"i0"`, `"i1"`, `"i0i"`), non un indice numerico. Una colonna numerica non può mai contenerne una, quindi
`orderField` accetta solo una colonna di testo. Si tratta di un meccanismo interno, non di contenuto, pertanto
specificarlo in `orderField` lo nasconde dalla tabella e lo disabilita nel form.
Una voce in `fields.__order` può comunque sovrascrivere entrambe le cose: `hidden: false` lo rende visibile.

**Le righe create all'esterno del CMS arrivano senza una chiave.** Nulla ne assegna una
all'inserimento. Una riga scritta da un cron job, uno script di seeding, una migrazione o dalle API REST
arriva con `__order` impostato su null, e la bacheca mostra *"Some items don't have order
values"* con un pulsante **Initialize**. Un clic esegue il backfill della prima pagina, ma
la successiva esecuzione del cron riporterà nuovamente la barra. Se un backend crea righe per una
bacheca, dovrebbe aggiungere direttamente la chiave, usando l'alfabeto impiegato dal CMS:

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
vedi la barra non appena ne aggiungi una. **Initialize** è la soluzione in questo caso; su
una bacheca alimentata da un backend è una correzione che viene vanificata a ogni esecuzione.

## Slot di visualizzazione

Ogni superficie che disegna un record utilizza alcuni di questi sei slot: **title**,
**subtitle**, **image**, **status**, **date** e **tags**. Una riga di un elenco è immagine +
titolo + sottotitolo + stato + data, una scheda è la stessa cosa con l'immagine in alto, un
selettore di riferimenti è titolo + sottotitolo e l'intestazione di una pagina è solo il titolo.

Il CMS popola alcuni slot dalle colonne della tabella (vedi
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

Uno slot tralasciato mantiene il suo valore derivato.

A un resolver viene passato `{ row, id, context }`. `row` è il record così come inviato dal server,
tipizzato come riga della tabella: date come stringhe ISO, un belongsTo come la sua colonna
foreign key. `id` è la sua chiave primaria sotto forma di stringa, con le parti di una chiave composita
unite da `:::`. Una relazione caricata dal CMS arriva annidata sotto il suo nome, come
restituita da `include` di REST, consentendo a un resolver di leggere il campo di un record correlato
senza effettuare una propria richiesta.

Un resolver può essere `async`, per leggere dati non presenti nel record. Mentre
la promise è in corso, la superficie mostra il valore derivato e lo sostituisce con quello
risolto una volta disponibile: un titolo non mostra mai uno spinner. I risultati sono memorizzati nella cache per
record e per slot, e le richieste simultanee condividono una singola chiamata.

Restituisci `undefined` quando un record non ha nulla per quello slot; la superficie eseguirà il
fallback su ciò che conosce (un'intestazione usa il nome al singolare della raccolta, un link usa
l'id). Un resolver che genera un'eccezione viene trattato come `undefined` e registrato nei log una sola volta.

È preferibile usare un percorso (path) ogni volta che il valore è presente sul record: un percorso mantiene il
rendering proprio del campo, così uno stato enum rimane un badge colorato e una data rimane formattata,
cosa che un resolver che restituisce una stringa non può fare.

Quando nessuno slot specifica il titolo, il CMS ne sceglie uno dal testo della tabella stessa.
Con `fieldOrder`, viene scelto il primo campo in quell'ordine che può fungere da titolo.
Altrimenti i candidati vengono classificati per priorità: prima il testo la cui chiave corrisponde a un'etichetta (`name`,
`title`, `label`…), poi testi brevi, email, enum, testi lunghi e selettori
utente. Chiavi, colonne uuid, foreign key, relazioni, riferimenti, documenti JSON,
campi file e campi nascosti non sono mai idonei: una relazione indica un altro
record, quindi un cliente che appartiene a un'agenzia non avrà mai come titolo il nome
dell'agenzia. Una tabella priva di uno qualsiasi di questi campi avrà come titolo il suo id. Un nome contenuto
all'interno di una colonna JSON, o una relazione che rappresenta effettivamente la denominazione di una riga (una
riga di giunzione/tabella pivot), viene indicato con `display.title`: `title: "data.name"`,
`title: "agency"`. Qualsiasi cosa contenga il titolo viene renderizzata come testo: una data viene formattata,
un array viene concatenato e una relazione viene mostrata con il titolo della riga correlata, con fallback al
suo id.

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
| `sort` | L'ordinamento predefinito: una chiave e una direzione, oppure più chiavi in sequenza. |
| `defaultFilter` | Il filtro di partenza per l'utente, che può essere modificato. |
| `fixedFilter` | Un filtro che l'utente non può modificare. I filtri applicati su altri campi vengono combinati con questo. |
| `filterPresets` | Filtri attivabili con un clic nella barra degli strumenti: `{ label?, filterValues, sort? }`. Senza un'etichetta, ne viene generata una a partire dal filtro. |
| `pagination` | Caricamento a pagine (`true`, o la dimensione della pagina), o tutto in una volta (`false`). |

Ogni chiave viene verificata rispetto ai campi della tabella. La proprietà `filterOperators` di un campo
restringe le operazioni filtrabili su di esso, mentre `[]` disattiva completamente i filtri per quel campo.

Un `fixedFilter` restringe ciò che il CMS *richiede*. Non costituisce un limite di sicurezza invalicabile: ciò che un
chiamante può leggere è determinato dalla [row-level security](/docs/collections/security-rules/)
della tabella, per qualsiasi chiamante.

## Passaggi successivi

- [customizeTable](/docs/frontend/customize-table/): tutte le opzioni
- [Customizing the admin](/docs/frontend/customizing/): visualizzazioni, pagine e azioni personalizzate
- [Entity views](/docs/frontend/entity-views/): schede su un record
- [Entity actions](/docs/frontend/entity-actions/): pulsanti su un record
