---
sourceHash: 1090d0be0be163a6
title: Tabelle
sidebar_label: Tabelle
description: "Dichiara tabelle Postgres in backend/schema con defineTable: colonne, relazioni e una configurazione obbligatoria per la row-level security. Ogni tabella diventa SQL, policy, route REST, realtime e MCP, e tipi SDK."
---

Una tabella viene dichiarata una sola volta, in TypeScript, nella directory `backend/schema/`.
Quella dichiarazione è l'unica cosa che il backend conosce sui tuoi dati. A partire da essa,
Rebase genera la tabella e le relative policy di row-level security in Postgres,
espone la tabella tramite REST, realtime e MCP, e tipizza l'SDK.

```ts
// backend/schema/posts.ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { users } from "./users";

export const posts = defineTable("posts", {
    columns: {
        id:          col.uuid().primaryKey().defaultRandom(),
        title:       col.text().notNull().validate({ min: 3, max: 200 }),
        status:      col.enum(["draft", "published", "archived"]).notNull().default("draft"),
        publishDate: col.timestamp({ withTimezone: true }),
        createdAt:   col.timestamp({ withTimezone: true }).notNull().onCreateNow(),
    },
    relations: {
        author: rel.belongsTo(() => users, { notNull: true }),
    },
    rls: [
        { operation: "select", access: "public", condition: { status: "published" } },
        { operations: ["select", "insert", "update"], roles: ["editor"] },
        { operation: "delete", roles: ["admin"] },
    ],
});
```

Tre aspetti meritano di essere evidenziati da questo esempio prima di tutto:

- **Le colonne sono nullable a meno che non sia specificato diversamente**, come in SQL. `.notNull()`
  rende una colonna `NOT NULL` e obbligatoria in fase di creazione. Vedi [Colonne](/docs/schema/columns/).
- **La foreign key è dichiarata dalla relazione.** `author` ricava una
  colonna `author_id`, il relativo vincolo e il suo indice. Vedi
  [Relazioni](/docs/collections/relations/).
- **`rls` è obbligatorio.** Una tabella priva di una postura di row-level security costituisce un errore
  di tipo e viene rifiutata al momento della compilazione dello schema. Vedi
  [Row-level security](/docs/collections/security-rules/).

:::note[Arrivi dalle collections?]
Le tabelle sostituiscono i file `config/collections` delle release precedenti. Il CMS
legge i propri valori predefiniti dalle tabelle; le sue personalizzazioni risiedono nel
frontend. La guida all'aggiornamento per questa versione illustra la migrazione.
:::

## La directory `backend/schema`

```text
backend/
├── schema/
│   ├── index.ts      # exports every table and view, and optionally defaultRls
│   ├── users.ts      # defineAuthTable("users", …)
│   ├── posts.ts      # defineTable("posts", …)
│   └── tags.ts       # defineTable("tags", …)
├── functions/
└── crons/
```

Un file per tabella è una convenzione, non una regola. Ciò che conta è
`backend/schema/index.ts`: il backend legge le tabelle e le viste che questo esporta,
e nient'altro.

```ts
// backend/schema/index.ts
import type { DefaultRls } from "@rebasepro/server/schema";

export { users } from "./users";
export { posts } from "./posts";
export { tags } from "./tags";

// What every table declared with `rls: "inherit"` takes.
export const defaultRls: DefaultRls = [
    { operation: "select", access: "authenticated" },
];
```

`defaultRls` è opzionale. Viene letto solo dalle tabelle che specificano
`rls: "inherit"`; un progetto che non utilizza mai `"inherit"` non ne ha bisogno.

La directory è `backend/schema`, a meno che `rebase.json` non ne indichi un'altra con
la chiave `tables`. La chiave `schema` mantiene il suo significato precedente: il modulo Drizzle
generato.

```json
{
    "apps": {
        "backend": {
            "type": "backend",
            "runtime": "managed",
            "tables": "backend/schema"
        }
    }
}
```

Un progetto senza `backend/schema/index.ts` non dichiara alcuna tabella. All'avvio, il backend
legge quindi le tabelle direttamente dal database attivo ed espone solo quelle
con la row-level security abilitata. Vedi [Solo backend](/docs/getting-started/headless/).

I file di schema sono puro TypeScript senza dipendenze server:
`@rebasepro/server/schema` non carica nulla del server. Un frontend può eseguire
`import type { posts } from "../../backend/schema/posts"` per tipizzare il proprio codice
in base a una tabella, senza includere codice backend nel bundle del browser.

## In cosa si trasforma una tabella

| Dalla dichiarazione | Rebase genera |
|---|---|
| `columns`, `relations`, `indexes` | i comandi `CREATE TABLE`, foreign key, junction table e indici, scritti in `schema.sql` da `rebase db push` e `rebase db generate` |
| `rls`, `tenant`, la tabella auth | `ENABLE ROW LEVEL SECURITY` e un `CREATE POLICY` per ciascuna regola e operazione, in `policies.sql` |
| `search`, colonne vettoriali | la colonna `tsvector` generata e gli indici GIN e ANN |
| lo slug | le route REST sotto `/api/data/<slug>`, le sottoscrizioni realtime, i tool MCP e il documento OpenAPI |
| i tipi e i modificatori delle colonne | i tipi `Row`, `Insert` e `Update` dell'SDK e i [tipi dedotti](/docs/schema/types/) utilizzabili nel proprio codice |

Ogni componente legge la stessa forma compilata della tabella, chiamata
descrittore: colonne con i relativi tipi Postgres, nullabilità, regole di validazione e
archiviazione, relazioni risolte in slug e la configurazione della row-level
security. Il codice degli hook non lascia mai il server; il descrittore indica solo quali
hook esistono. Il backend fornisce i descrittori tramite `GET /api/schema/tables`,
da cui il CMS, lo Studio e le app MCP effettuano il rendering.

La pipeline dalla dichiarazione al database è descritta in
[Schema as code](/docs/architecture/schema-as-code/).

## Opzioni di `defineTable`

`defineTable(name, config)` accetta il nome della tabella e queste chiavi:

| Chiave | Cosa fa |
|---|---|
| `columns` | **Obbligatorio.** Builder `col.*` per chiave, in ordine fisico. Almeno uno deve essere `.primaryKey()`. Vedi [Colonne](/docs/schema/columns/). |
| `rls` | **Obbligatorio.** `"admin-only"`, `"inherit"`, o un elenco non vuoto di regole. Vedi [Row-level security](/docs/collections/security-rules/). |
| `relations` | Builder `rel.*` per nome della relazione. Vedi [Relazioni](/docs/collections/relations/). |
| `slug` | Il nome nell'API, nell'SDK e negli scope. Se omesso, corrisponde al nome della tabella. |
| `table` | Il nome della tabella SQL, quando differisce dal nome. |
| `schema` | Lo schema Postgres. `public` se omesso. |
| `database` | Un database Postgres non predefinito, dichiarato in `backend/resources.ts`. Vedi [Multiple sources](/docs/backend/multiple-sources/). |
| `description` | Cosa contiene la tabella. Mostrato in OpenAPI e nelle descrizioni dei tool MCP. |
| `defaultPolicies` | `false` genera solo le tue regole, senza le policy di base per l'amministratore. Rifiutato con `rls: "admin-only"`. `true` mantiene la baseline quando il database della tabella la disattiva per ogni tabella (`database({ rls: { defaultPolicies: false } })`). Se omesso, decide l'impostazione del database. |
| `rlsRequired` | `false` espone la tabella anche quando il database non applica la sua `rls` (row-level security disattivata, policy dichiarate mancanti), per uno schema gestito da un altro strumento e un'applicazione che gestisce gli accessi autonomamente. `true` la richiede per un database che specifica `database({ rls: { required: false } })`. Se omesso, decide l'impostazione del database, e una tabella non protetta dal database non viene esposta da un avvio che non effettua il provisioning di nulla. Vedi [Another tool owns the schema](/docs/deployment/existing-database/#another-tool-owns-the-schema-and-the-app-enforces-access). |
| `tenant` | Associa ogni riga a un tenant. Vedi [Tenancy](/docs/collections/tenancy/). |
| `softDelete` | `true` o `{ field }`: l'eliminazione imposta un timestamp anziché rimuovere la riga. Vedi [Soft delete](/docs/collections/soft-delete/). |
| `history` | `true` registra ogni operazione di scrittura nella tabella di cronologia. Vedi [Entity history](/docs/backend/history/). |
| `search` | Ricerca full-text con ranking sulle colonne specificate. Vedi [Ricerca](/docs/backend/search/). |
| `indexes` | Indici, ciascuno con la query che serve. Vedi [Indici](/docs/backend/indexes/). |
| `hooks` | Hook del ciclo di vita lato server. Vedi [Hook di tabella](/docs/collections/callbacks/). |
| `strictWrites` | Una scrittura che specifica una colonna non dichiarata dalla tabella restituisce un 400. `false` la accetta, per colonne che esistono nel database senza essere dichiarate (ad esempio valorizzate da un trigger). La colonna deve comunque esistere. |
| `metadata` | Qualsiasi dato che desideri venga fornito insieme al descrittore della tabella. Rebase non lo legge. |

Altre due definizioni condividono la maggior parte di queste chiavi:
[`defineAuthTable`](/docs/schema/auth-table/) per la tabella in cui sono memorizzati gli utenti,
e [`defineView`](/docs/collections/views/) per le viste SQL.

## Nomi

Il primo argomento di `defineTable` è il nome della tabella, ed è il valore predefinito
per tutto il resto:

| Nome | Predefinito | Override |
|---|---|---|
| Tabella SQL | il nome | `table: "blog_posts"` |
| Slug API, accessor SDK, target dello scope | il nome | `slug: "articles"` |
| Schema Postgres | `public` | `schema: "content"` |
| Colonna SQL di una colonna | lo snake_case della sua chiave | il primo argomento del builder: `col.text("legacy_name")` |

La chiave di una colonna corrisponde al suo nome nella riga JSON, nell'SDK e nei filtri e
ordinamenti. Il suo nome SQL è lo snake_case della chiave: `publishDate` è la colonna
`publish_date`, e `photoURL` è `photo_url`. Il primo argomento di un builder mappa
una chiave su qualsiasi altro nome SQL, come in Drizzle (`col.text("legacy_name")`),
permettendo a una tabella di adottare la nomenclatura di un database esistente senza modificare ciò che
i client vedono.

`table` e `schema` devono essere identificatori SQL standard. Due definizioni non possono
condividere lo stesso nome, slug o tabella SQL. Lo slug è importante non solo per l'URL: i nomi delle foreign
key e delle colonne di giunzione sono derivati da esso, quindi modificare lo slug di una
tabella già distribuita può rinominare delle colonne. Imposta esplicitamente `slug` quando deve
differire dal nome della tabella, e non modificarlo in seguito.

## Chiavi primarie

Non esiste alcuna colonna `id` implicita. Ogni tabella contrassegna almeno una colonna come
`.primaryKey()`:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const invoices = defineTable("invoices", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        number: col.integer().notNull().unique(),
    },
    rls: "admin-only",
});

// Several key columns form a composite key, in declaration order.
export const dailyStats = defineTable("daily_stats", {
    columns: {
        siteId: col.uuid().primaryKey(),
        day:    col.date().primaryKey(),
        views:  col.integer().notNull().default(0),
    },
    rls: "admin-only",
});
```

Una colonna chiave è `NOT NULL` per definizione. Una chiave `uuid` solitamente accetta
`.defaultRandom()`; una chiave intera utilizza `.generatedByDefaultAsIdentity()`. Una chiave senza un valore
predefinito viene fornita dal chiamante in fase di creazione. Una colonna chiave non può essere
`.private()`, né può essere di tipo `timestamptz` o `time`.

## Quando una definizione viene rifiutata

Uno schema che lascerebbe una tabella non protetta o non esponibile non raggiunge mai il
database. Viene rifiutato in tre fasi:

1. **Nell'editor.** `rls` e `columns` sono richiesti dai tipi, e
   `rls: []` non è una configurazione valida. Un campo `tenant` o `softDelete`, oppure una
   colonna indice specificata come chiave semplice che non fa riferimento ad alcuna colonna, costituisce un errore di tipo.
2. **Al caricamento del modulo.** `defineTable` genera un'eccezione in caso di tabella senza colonne,
   una colonna che non sia un builder `col.*`, una relazione che non sia un
   risultato di `rel.*`, una relazione con la stessa chiave di una colonna o l'assenza di una `rls` utilizzabile. Questo
   intercetta anche codice JavaScript e cast che i tipi non sono in grado di rilevare.
3. **Alla compilazione dello schema.** `rebase db generate`, `rebase db push`,
   `rebase doctor` e l'avvio del server compilano tutte le tabelle insieme e si interrompono con
   un `SchemaDefinitionError` che elenca ogni problema, ciascuno associato alla tabella, alla
   colonna o relazione, e a cosa scrivere in alternativa:

```text
The schema cannot be used (2 problems):
  - posts: the table has no primary key. Mark a column `.primaryKey()` — e.g. `id: col.uuid().primaryKey().defaultRandom()`; several make a composite key in declaration order.
  - comments: `rls: "inherit"` takes the project's `defaultRls`, and none was given. Export `defaultRls` from backend/schema/index.ts (`"admin-only"` or a list of rules), or write this table's own `rls`.
```

La fase di compilazione verifica ciò che richiede la conoscenza contemporanea di tutte le tabelle: target delle relazioni e
i relativi tipi di chiave, junction table rivendicate da due relazioni contemporaneamente, slug e nomi SQL
in conflitto (inclusi i nomi che vanno in conflitto una volta troncati da Postgres a 63
byte), regole che fanno riferimento a colonne non presenti nella tabella e `"inherit"`
senza un `defaultRls`. Anche una tabella esportata da un file accanto a `index.ts`, ma non
da `index.ts` stesso, viene rifiutata: il file index costituisce l'elenco ufficiale delle tabelle.

## Prossimi passi

- [Colonne](/docs/schema/columns/): tutti i builder e i modificatori `col.*`
- [Documenti JSON](/docs/schema/json/): `jsonb` tipizzato e validato con `json.*`
- [Relazioni](/docs/collections/relations/): le cinque tipologie di `rel.*`
- [Row-level security](/docs/collections/security-rules/): la configurazione `rls` e le relative regole
- [Hook di tabella](/docs/collections/callbacks/): hook del ciclo di vita lato server
- [Inferenza dei tipi](/docs/schema/types/): `InferRow`, `InferInsert` e `InferUpdate`
