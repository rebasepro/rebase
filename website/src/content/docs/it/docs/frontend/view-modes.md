---
sourceHash: 57ee5c3ecdf49419
title: Modalità di visualizzazione
sidebar_label: Modalità di visualizzazione
description: "Mostra le righe di una tabella come elenco, foglio di calcolo, schede o bacheca kanban; scegli cosa inserire nel titolo, immagine, stato e data di ogni record; imposta l'ordinamento predefinito, i filtri e i preset di filtri con un clic."
---

<span class="since-badge" data-since="0.31">Da 0.31</span>

Ogni collezione può essere visualizzata in quattro modi, tramite il selettore nella sua barra degli strumenti:

- **Tabella**: un foglio di calcolo virtualizzato con modifica inline, ordinamento, filtraggio
  e selezione multipla. La vista in cui si apre una collezione, a meno che non sia specificato diversamente.
- **Elenco**: una riga per record, con immagine, titolo, sottotitolo, stato e
  data.
- **Schede**: una griglia di schede, per contenuti ricchi di immagini.
- **Kanban**: una bacheca raggruppata in base a una colonna con un insieme chiuso di valori.

Una collezione può anche offrire modalità di visualizzazione create da te (un calendario, una mappa, una
galleria) nello stesso selettore, gestite dalla medesima barra degli strumenti: vedi
[Modalità di visualizzazione personalizzate](/docs/frontend/extending#custom-view-modes).

## Scelta delle visualizzazioni

<span class="since-badge" data-since="0.31">Da 0.31</span>

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
        __order: { hidden: true, hiddenInForm: true },
    },
});
```

| Opzione | Effetto |
|---|---|
| `defaultViewMode` | La vista iniziale dell'utente: `"table"`, `"list"`, `"cards"`, `"kanban"` o la chiave di una vista personalizzata. |
| `enabledViews` | Le viste disponibili nel selettore. |
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

<span class="since-badge" data-since="0.31">Da 0.31</span>

`kanban.columnField` indica la colonna in base alla quale la bacheca raggruppa gli elementi. Deve contenere un
insieme chiuso di stringhe, un `col.enum([...])` o una colonna di testo con
`.oneOf([...])`; qualsiasi altra cosa genera un errore di tipo. Le colonne vengono disegnate nell'ordine
proprio della colonna, o in `enumOrder`, con le etichette e i colori definiti in
`enumLabels`. Il trascinamento di una scheda in un'altra colonna aggiorna `columnField`.

`kanban.orderField` indica dove viene memorizzata la posizione di una scheda **all'interno** di una colonna.
Dichiaralo sempre: tre errori qui producono tutti una bacheca che sembra
configurata ma non lo è.

**`orderField` non è opzionale.** Senza di esso una scheda può comunque essere trascinata tra le colonne,
perché tale azione scrive `columnField`. La sua posizione all'interno di una colonna non ha però un posto in cui
essere memorizzata, quindi viene ripristinata alla lettura successiva e la bacheca mostra una barra ambra
che avvisa che l'ordinamento non è configurato.

**La colonna deve essere di tipo testo.** Il riordinamento scrive una chiave di
[fractional-indexing](https://github.com/rocicorp/fractional-indexing)
(`"i0"`, `"i1"`, `"i0i"`), non un indice numerico. Una colonna numerica non potrà mai contenerla, quindi
`orderField` accetta solo una colonna di testo. È un meccanismo interno, non contenuto: nascondilo,
come mostrato sopra.

**Le righe create all'esterno del CMS arrivano senza chiave.** Nulla ne assegna una al momento
dell'inserimento. Una riga scritta da un cron, da uno script di seed, da una migrazione o dalle API REST
arriva con `__order` null, e la bacheca mostra *"Some items don't have order
values"* con un pulsante **Initialize**. Un clic esegue il backfill della prima pagina, ma
la successiva esecuzione del cron farà riapparire subito la barra. Se un backend crea righe per una
bacheca, dovrebbe aggiungere la chiave autonomamente, utilizzando l'alfabeto impiegato dal CMS:

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

Anche le righe create tramite form arrivano senza chiave; l'unica differenza è che
vedrai la barra non appena ne aggiungi una. **Initialize** è la soluzione in questo caso; su una
bacheca alimentata da un backend, invece, è una soluzione che si annulla a ogni esecuzione.

## Slot di visualizzazione

<span class="since-badge" data-since="0.31">Da 0.31</span>

Ogni superficie che disegna un record utilizza alcuni dei sei slot disponibili: **title**,
**subtitle**, **image**, **status**, **date** e **tags**. Una riga di elenco è composta da image +
title + subtitle + status + date, una scheda è identica ma con l'immagine in alto, un
selettore di riferimenti è title + subtitle, e l'intestazione di una pagina è solo il title.

Il CMS popola alcuni slot a partire dalle colonne della tabella (vedi
[slot di visualizzazione predefiniti](/docs/collections/#display-slots)). `display` consente di specificare
uno qualsiasi di essi, come percorso di campo o come funzione:

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

Uno slot omesso mantiene il suo valore derivato.

A un resolver viene passato `{ row, id, context }`. `row` è il record così come inviato
dal server, tipizzato come riga della tabella: date come stringhe ISO, un belongsTo come la relativa
colonna foreign-key. `id` è la sua chiave primaria sotto forma di stringa, con le parti di una chiave
composita unite da `:::`. Una relazione caricata dal CMS arriva nidificata sotto il proprio nome, così come
restituita da `include` di REST, consentendo a un resolver di leggere un campo del record correlato senza
alcuna richiesta aggiuntiva.

Un resolver può essere `async`, per leggere elementi non presenti nel record. Mentre
la promise è in corso, la superficie mostra il valore derivato e lo sostituisce con quello
risolto all'arrivo: un titolo non mostra mai uno spinner. I risultati vengono memorizzati nella cache per
record e slot, e le richieste simultanee condividono un'unica chiamata.

Restituisci `undefined` quando un record non ha valori per lo slot; l'interfaccia ricorrerà al
fallback disponibile (un'intestazione usa il nome singolare della collezione, un link usa
l'id). Un resolver che genera un errore viene trattato come `undefined` e registrato nei log una sola volta.

Preferisci un percorso ogni volta che il valore è presente sul record: un percorso mantiene il rendering
nativo del campo, così uno stato enum rimane un badge colorato e una data rimane formattata, cosa
che un resolver che restituisce una stringa non può fare.

Quando nessuno slot definisce il titolo, il CMS ne sceglie uno. Con `fieldOrder`, sceglie il primo
campo in quell'ordine che può fungere da titolo: testo, una relazione a singola cardinalità o
un riferimento. In caso contrario, i candidati vengono classificati: prima il testo la cui chiave corrisponde a un'etichetta
(`name`, `title`, `label`…), poi il testo breve, un'email, un enum, il testo lungo,
una relazione e un riferimento. Chiavi, colonne uuid, campi file e campi nascosti
non sono mai idonei. Qualsiasi valore contenga il titolo viene renderizzato come testo: una data formattata, un
array unito e una relazione come il primo tra `name`, `title`, `label` o
`displayName` sulla riga correlata, con fallback al suo id.

## Filtri, preset e ordinamento

<span class="since-badge" data-since="0.31">Da 0.31</span>

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
| `sort` | L'ordinamento predefinito: una chiave e una direzione, oppure diverse in sequenza. |
| `defaultFilter` | Il filtro di partenza per l'utente, che può essere modificato. |
| `fixedFilter` | Un filtro che l'utente non può modificare. I filtri applicati su altri campi vengono combinati con esso. |
| `filterPresets` | Filtri con un clic nella barra degli strumenti: `{ label?, filterValues, sort? }`. Senza un'etichetta, ne viene generata una a partire dal filtro. |
| `pagination` | Caricamento a pagine (`true`, o la dimensione della pagina), o tutto in una volta (`false`). |

Ogni chiave viene verificata rispetto ai campi della tabella. La proprietà `filterOperators`
di un campo restringe le opzioni di filtro disponibili su di esso, mentre `[]` ne disattiva il filtraggio.

Un `fixedFilter` limita ciò che il CMS *richiede*. Non è una barriera di sicurezza: ciò che
un chiamante può leggere è stabilito dalla [row-level security](/docs/collections/security-rules/)
della tabella, per ogni chiamante.

## Passaggi successivi

<span class="since-badge" data-since="0.31">Da 0.31</span>

- [customizeTable](/docs/frontend/customize-table/): tutte le opzioni
- [Personalizzazione dell'admin](/docs/frontend/customizing/): modalità di visualizzazione, pagine e azioni personalizzate
- [Viste dell'entità](/docs/frontend/entity-views/): tab su un record
- [Azioni dell'entità](/docs/frontend/entity-actions/): pulsanti su un record
