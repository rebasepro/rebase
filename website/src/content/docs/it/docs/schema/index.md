---
sourceHash: 59fc3060e8bce0e2
title: Tabelle
sidebar_label: Tabelle
description: "Dichiara le tabelle Postgres in backend/schema con defineTable: colonne, relazioni e una postura di row-level security obbligatoria. Ciascuna tabella diventa SQL, policy, route REST, realtime e MCP, e tipi SDK."
---

<span class="since-badge" data-since="0.31">Dalla 0.31</span>

Una tabella viene dichiarata una sola volta, in TypeScript, nella directory `backend/schema/`.
Tale dichiarazione è l'unica cosa che il backend conosce sui tuoi dati. A partire da essa,
Rebase genera la tabella e le sue policy di row-level security in Postgres,
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

Ci sono tre elementi degni di nota in questo esempio prima di passare al resto:

- **Le colonne sono nullable a meno che non sia specificato diversamente**, come in SQL. `.notNull()`
  rende una colonna `NOT NULL` e obbligatoria alla creazione. Consulta [Colonne](/docs/schema/columns/).
- **La foreign key viene dichiarata dalla relazione.** `author` ricava una
  colonna `author_id`, il relativo vincolo e il relativo indice. Consulta
  [Relazioni](/docs/collections/relations/).
- **`rls` è obbligatorio.** Una tabella priva di una configurazione di row-level security costituisce
  un errore di tipo e viene rifiutata durante la compilazione dello schema. Consulta
  [Row-level security](/docs/collections/security-rules/).

:::note[Arrivi dalle collections?]
Le tabelle sostituiscono i file `config/collections` delle versioni precedenti. Il CMS
legge i valori predefiniti dalle tabelle; le sue personalizzazioni risiedono nel
frontend. La guida all'aggiornamento per questa versione descrive la migrazione.
:::

## La directory `backend/schema`

<span class="since-badge" data-since="0.31">Dalla 0.31</span>

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
`backend/schema/index.ts`: il backend legge le tabelle e le viste esportate da esso,
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

`defaultRls` è facoltativo. Viene letto solo dalle tabelle che specificano
`rls: "inherit"`; un progetto che non scrive mai `"inherit"` non ne ha bisogno.

La directory è `backend/schema` a meno che `rebase.json` non ne indichi un'altra con
la chiave `tables`. La chiave `schema` mantiene il suo vecchio significato: il modulo
Drizzle generato.

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

Un progetto privo di `backend/schema/index.ts` non dichiara alcuna tabella. Il backend
legge quindi le tabelle direttamente dal database attivo all'avvio ed espone solo quelle
con row-level security abilitata. Consulta [Solo backend](/docs/getting-started/headless/).

I file di schema sono puro TypeScript privo di dipendenze dal server:
`@rebasepro/server/schema` non carica alcunché del server. Un frontend può eseguire
`import type { posts } from "../../backend/schema/posts"` per tipizzare il proprio codice
rispetto a una tabella, senza includere codice backend nel bundle del browser.

## Cosa diventa una tabella

<span class="since-badge" data-since="0.31">Dalla 0.31</span>

| Dalla dichiarazione | Rebase genera |
|---|---|
| `columns`, `relations`, `indexes` | il `CREATE TABLE`, le foreign key, le junction table e gli indici, scritti in `schema.sql` da `rebase db push` e `rebase db generate` |
| `rls`, `tenant`, the auth table | `ENABLE ROW LEVEL SECURITY` e un `CREATE POLICY` per regola e operazione, in `policies.sql` |
| `search`, vector columns | la colonna generata `tsvector` e gli indici GIN e ANN |
| the slug | le route REST sotto `/api/data/<slug>`, le sottoscrizioni realtime, gli strumenti MCP e il documento OpenAPI |
| the columns' types and modifiers | i tipi `Row`, `Insert` e `Update` dell'SDK, e i [tipi dedotti](/docs/schema/types/) che puoi usare nel tuo codice |

Ciascuna superficie legge la stessa forma compilata della tabella, denominata
descrittore (descriptor): colonne con i relativi tipi Postgres, supporto ai valori nulli,
regole di convalida e archiviazione, relazioni risolte in slug e la postura di row-level
security. Il codice degli hook non lascia mai il server; il descrittore indica soltanto
quali hook esistono. Il backend fornisce i descrittori all'endpoint `GET /api/schema/tables`,
a partire dai quali effettuano il rendering il CMS, lo Studio e le applicazioni MCP.

La pipeline dalla dichiarazione al database è descritta in
[Schema as code](/docs/architecture/schema-as-code/).

## Opzioni di `defineTable`

<span class="since-badge" data-since="0.31">Dalla 0.31</span>

`defineTable(name, config)` accetta il nome della tabella e le seguenti chiavi:

| Chiave | Cosa fa |
|---|---|
| `columns` | **Obbligatorio.** Builder `col.*` per chiave, in ordine fisico. Almeno uno deve essere `.primaryKey()`. Consulta [Colonne](/docs/schema/columns/). |
| `rls` | **Obbligatorio.** `"admin-only"`, `"inherit"`, oppure un elenco non vuoto di regole. Consulta [Row-level security](/docs/collections/security-rules/). |
| `relations` | Builder `rel.*` per nome della relazione. Consulta [Relazioni](/docs/collections/relations/). |
| `slug` | Il nome nell'API, nell'SDK e negli scope. Corrisponde al nome della tabella se omesso. |
| `table` | Il nome della tabella SQL, quando differisce dal nome. |
| `schema` | Lo schema Postgres. `public` se omesso. |
| `database` | Un database Postgres non predefinito, dichiarato in `backend/resources.ts`. Consulta [Sorgenti multiple](/docs/backend/multiple-sources/). |
| `description` | Cosa contiene la tabella. Mostrato in OpenAPI e nelle descrizioni degli strumenti MCP. |
| `defaultPolicies` | `false` genera solo le tue regole, senza le policy di base per admin. Rifiutato con `rls: "admin-only"`. <span class="since-badge" data-since="0.31">Dalla 0.31</span> `true` mantiene la baseline quando il database della tabella la disattiva per ogni tabella (`database({ rls: { defaultPolicies: false } })`). Se omesso, decide l'impostazione del database. |
| `tenant` | Associa l'ambito di ogni riga a un tenant. Consulta [Multi-tenancy](/docs/collections/tenancy/). |
| `softDelete` | `true` o `{ field }`: un'eliminazione applica un timestamp invece di rimuovere la riga. Consulta [Soft delete](/docs/collections/soft-delete/). |
| `history` | `true` registra ogni scrittura nella tabella di cronologia. Consulta [Cronologia entità](/docs/backend/history/). |
| `search` | Ricerca full-text con ranking sulle colonne indicate. Consulta [Ricerca](/docs/backend/search/). |
| `indexes` | Indici, ciascuno con la query che serve. Consulta [Indici](/docs/backend/indexes/). |
| `hooks` | Hook del ciclo di vita lato server. Consulta [Hook di tabella](/docs/collections/callbacks/). |
| `strictWrites` | Una scrittura che fa riferimento a una colonna non dichiarata dalla tabella restituisce un 400. `false` la accetta, per una colonna che esiste nel database senza essere stata dichiarata (ad esempio compilata da un trigger). La colonna deve comunque esistere. |
| `metadata` | Qualsiasi dato che desideri venga fornito con il descrittore della tabella. Rebase non lo legge. |

Altre due definizioni condividono la maggior parte di queste chiavi:
[`defineAuthTable`](/docs/schema/auth-table/) per la tabella in cui sono archiviati gli utenti
e [`defineView`](/docs/collections/views/) per le viste SQL.

## Nomi

<span class="since-badge" data-since="0.31">Dalla 0.31</span>

Il primo argomento di `defineTable` è il nome della tabella, che funge da valore
predefinito per tutto il resto:

| Nome | Predefinito | Override |
|---|---|---|
| Tabella SQL | il nome | `table: "blog_posts"` |
| Slug API, accessor SDK, target dello scope | il nome | `slug: "articles"` |
| Schema Postgres | `public` | `schema: "content"` |
| Colonna SQL di una colonna | lo snake_case della sua chiave | il primo argomento del builder: `col.text("legacy_name")` |

La chiave di una colonna è il suo nome nella riga JSON, nell'SDK e nei filtri e
ordinamenti. Il suo nome SQL è lo snake_case della chiave: `publishDate` è la colonna
`publish_date`, e `photoURL` è `photo_url`. Il primo argomento di un builder mappa
una chiave a qualsiasi altro nome SQL, come in Drizzle (`col.text("legacy_name")`),
consentendo a una tabella di adottare i nomi di un database esistente senza modificare ciò
che vedono i client.

`table` e `schema` devono essere normali identificatori SQL. Due definizioni non possono
condividere un nome, uno slug o una tabella SQL. Lo slug ha importanza non solo per l'URL:
i nomi delle foreign key e delle colonne di giunzione sono derivati da esso, quindi
modificare lo slug di una tabella già distribuita può rinominare le colonne. Imposta
esplicitamente `slug` quando deve differire dal nome della tabella e non modificarlo successivamente.

## Chiavi primarie

<span class="since-badge" data-since="0.31">Dalla 0.31</span>

Non esiste alcuna colonna `id` implicita. Ciascuna tabella contrassegna almeno una colonna
con `.primaryKey()`:

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

Una colonna chiave è `NOT NULL` per definizione. Una chiave `uuid` accetta solitamente
`.defaultRandom()`; una chiave intera accetta `.generatedByDefaultAsIdentity()`. Una chiave priva di
valore predefinito viene fornita dal chiamante in fase di creazione. Una colonna chiave non può essere
`.private()`, né può essere di tipo `timestamptz` o `time`.

## Quando una definizione viene rifiutata

<span class="since-badge" data-since="0.31">Dalla 0.31</span>

Uno schema che lascerebbe una tabella non protetta o non esponibile non raggiunge mai
il database. Viene rifiutato in tre fasi:

1. **Nell'editor.** `rls` e `columns` sono richiesti dai tipi e
   `rls: []` non è una configurazione valida. Un campo `tenant` o `softDelete`, oppure una
   colonna di un indice indicata come semplice chiave, che non corrisponde ad alcuna colonna rappresenta un errore di tipo.
2. **Al caricamento del modulo.** `defineTable` genera un'eccezione in presenza di una tabella senza colonne,
   una colonna che non sia un builder `col.*`, una relazione che non sia il risultato di un
   `rel.*`, una relazione con la stessa chiave di una colonna o l'assenza di un `rls` utilizzabile. Questo
   intercetta anche il codice JavaScript e i cast che i tipi non possono rilevare.
3. **Alla compilazione dello schema.** `rebase db generate`, `rebase db push`,
   `rebase doctor` e l'avvio del server compilano tutte le tabelle insieme e si interrompono con
   uno `SchemaDefinitionError` che elenca ogni problema, indicando per ciascuno la tabella, la
   colonna o la relazione, e cosa scrivere al suo posto:

```text
The schema cannot be used (2 problems):
  - posts: the table has no primary key. Mark a column `.primaryKey()` — e.g. `id: col.uuid().primaryKey().defaultRandom()`; several make a composite key in declaration order.
  - comments: `rls: "inherit"` takes the project's `defaultRls`, and none was given. Export `defaultRls` from backend/schema/index.ts (`"admin-only"` or a list of rules), or write this table's own `rls`.
```

La fase di compilazione verifica ciò che richiede la presenza di tutte le tabelle contemporaneamente: target delle relazioni e
relativi tipi di chiave, tabelle di giunzione rivendicate da due relazioni diverse, slug e nomi SQL
in conflitto (inclusi i nomi che entrano in collisione una volta che Postgres li tronca a 63
byte), regole che indicano una colonna non presente nella tabella e `"inherit"`
senza un `defaultRls`. Anche una tabella esportata da un file accanto a `index.ts` ma non
da `index.ts` stesso viene rifiutata: l'index costituisce l'elenco ufficiale delle tabelle.

## Passaggi successivi

<span class="since-badge" data-since="0.31">Dalla 0.31</span>

- [Colonne](/docs/schema/columns/): ogni builder e modificatore `col.*`
- [Documenti JSON](/docs/schema/json/): `jsonb` tipizzato e validato con `json.*`
- [Relazioni](/docs/collections/relations/): i cinque tipi di `rel.*`
- [Row-level security](/docs/collections/security-rules/): la postura di `rls` e le sue regole
- [Hook di tabella](/docs/collections/callbacks/): hook del ciclo di vita lato server
- [Inferenza dei tipi](/docs/schema/types/): `InferRow`, `InferInsert` e `InferUpdate`
