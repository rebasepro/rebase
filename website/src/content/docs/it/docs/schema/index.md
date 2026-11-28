---
sourceHash: ef21a3aa33310095
title: Tabelle
sidebar_label: Tabelle
description: "Dichiara tabelle Postgres in backend/schema con defineTable: colonne, relazioni e una postura di sicurezza a livello di riga obbligatoria. Ogni tabella diventa SQL, policy, route REST, realtime e MCP, e tipi per l'SDK."
---

Una tabella viene dichiarata una sola volta, in TypeScript, nella directory `backend/schema/`.
Quella dichiarazione è l'unica cosa che il backend conosce sui tuoi dati. A partire da essa,
Rebase genera la tabella e le sue policy di row-level security in Postgres,
serve la tabella tramite REST, realtime ed MCP, e tipizza l'SDK.

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

Tre aspetti meritano di essere notati in questo esempio prima di qualsiasi altra cosa:

- **Le colonne ammettono valori null se non specificato diversamente**, come in SQL. `.notNull()`
  rende una colonna `NOT NULL` e obbligatoria in fase di creazione. Consulta [Colonne](/docs/schema/columns/).
- **La foreign key è dichiarata dalla relazione.** `author` deriva una
  colonna `author_id`, il relativo vincolo e il rispettivo indice. Consulta
  [Relazioni](/docs/collections/relations/).
- **`rls` è obbligatorio.** Una tabella priva di una configurazione di row-level security costituisce
  un errore di tipo e viene rifiutata durante la compilazione dello schema. Consulta
  [Row-level security](/docs/collections/security-rules/).

:::note[Provieni dalle collections?]
Le tabelle sostituiscono i file `config/collections` delle release precedenti. Il CMS
legge i valori predefiniti dalle tabelle; le sue personalizzazioni risiedono nel
frontend. La guida all'aggiornamento di questa versione illustra la migrazione.
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
`backend/schema/index.ts`: il backend legge le tabelle e le viste esportate da questo file,
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

La directory è `backend/schema` a meno che `rebase.json` non ne indichi un'altra con
la chiave `tables`. La chiave `schema` mantiene il suo vecchio significato: il modulo Drizzle
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

Un progetto senza `backend/schema/index.ts` non dichiara alcuna tabella. In tal caso, il backend
legge le tabelle direttamente dal database attivo all'avvio e serve solo quelle
con la row-level security abilitata. Consulta [Solo backend](/docs/getting-started/headless/).

I file di schema sono puro TypeScript senza dipendenze dal server:
`@rebasepro/server/schema` non carica alcunché del server. Un frontend può eseguire
`import type { posts } from "../../backend/schema/posts"` per tipizzare il proprio codice
in base a una tabella, senza includere codice backend nel bundle del browser.

## Cosa diventa una tabella

| Dalla dichiarazione | Rebase genera |
|---|---|
| `columns`, `relations`, `indexes` | il comando `CREATE TABLE`, le foreign key, le tabelle di giunzione e gli indici, scritti in `schema.sql` da `rebase db push` e `rebase db generate` |
| `rls`, `tenant`, the auth table | `ENABLE ROW LEVEL SECURITY` e un `CREATE POLICY` per ogni regola e operazione, in `policies.sql` |
| `search`, vector columns | la colonna generata `tsvector` e gli indici GIN e ANN |
| the slug | le route REST sotto `/api/data/<slug>`, le sottoscrizioni realtime, gli strumenti MCP e il documento OpenAPI |
| the columns' types and modifiers | i tipi `Row`, `Insert` e `Update` dell'SDK, e i [tipi dedotti](/docs/schema/types/) utilizzabili nel tuo codice |

Ogni superficie legge la stessa forma compilata della tabella, denominata
descrittore: colonne con i relativi tipi Postgres, nullabilità, regole di convalida e
archiviazione, relazioni risolte in slug e la configurazione di row-level
security. Il codice degli hook non lascia mai il server; il descrittore indica solo quali
hook esistono. Il backend serve i descrittori all'endpoint `GET /api/schema/tables`,
a partire dal quale eseguono il rendering il CMS, lo Studio e le applicazioni MCP.

La pipeline dalla dichiarazione al database è descritta in
[Schema as code](/docs/architecture/schema-as-code/).

## Opzioni di `defineTable`

`defineTable(name, config)` accetta il nome della tabella e le seguenti chiavi:

| Chiave | Cosa fa |
|---|---|
| `columns` | **Obbligatorio.** Builder `col.*` per chiave, in ordine fisico. Almeno uno deve essere `.primaryKey()`. Consulta [Colonne](/docs/schema/columns/). |
| `rls` | **Obbligatorio.** `"admin-only"`, `"external"` (Postgres applica la RLS con policy gestite all'esterno di Rebase), `"unmanaged"` (nessuna RLS Postgres; l'applicazione gestisce l'accesso), `"inherit"`, o un elenco non vuoto di regole. Consulta [Row-level security](/docs/collections/security-rules/). |
| `relations` | Builder `rel.*` per nome della relazione. Consulta [Relazioni](/docs/collections/relations/). |
| `slug` | Il nome nell'API, nell'SDK e negli scope. Corrisponde al nome della tabella quando omesso. |
| `table` | Il nome della tabella SQL, se differisce dal nome. |
| `schema` | Lo schema Postgres. `public` se omesso. |
| `database` | Un database Postgres non predefinito, dichiarato in `backend/resources.ts`. Consulta [Sorgenti multiple](/docs/backend/multiple-sources/). |
| `description` | Il contenuto della tabella. Mostrato in OpenAPI e nelle descrizioni dei tool MCP. |
| `defaultPolicies` | `false` genera solo le tue regole, senza le policy di base (baseline) dell'amministratore. Rifiutato con `rls: "admin-only"`. `true` mantiene la baseline quando il database della tabella la disattiva per ogni tabella (`database({ rls: { defaultPolicies: false } })`). Se omesso, decide l'impostazione del database. |
| `rlsRequired` | `false` serve la tabella anche quando il database non applica la sua `rls` (row-level security disattivata, policy dichiarate mancanti), per uno schema gestito da un altro strumento e un'applicazione che controlla l'accesso autonomamente. `true` la richiede con un database che specifica `database({ rls: { required: false } })`. Se omesso, decide l'impostazione del database, e una tabella non protetta dal database non viene servita da un avvio che non effettua il provisioning di nulla. Consulta [Uno schema gestito da un altro strumento](/docs/deployment/existing-database/#another-tool-owns-the-schema-and-the-app-enforces-access). |
| `tenant` | Limita l'ambito di ogni riga a un tenant. Consulta [Multi-tenancy](/docs/collections/tenancy/). |
| `softDelete` | `true` o `{ field }`: un'eliminazione applica un timestamp invece di rimuovere la riga. Consulta [Soft delete](/docs/collections/soft-delete/). |
| `history` | `true` registra ogni operazione di scrittura nella tabella di cronologia. Consulta [Cronologia entità](/docs/backend/history/). |
| `search` | Ricerca full-text con ranking sulle colonne indicate. Consulta [Ricerca](/docs/backend/search/). |
| `indexes` | Indici, ciascuno associato alla query che serve. Consulta [Indici](/docs/backend/indexes/). |
| `hooks` | Hook del ciclo di vita lato server. Consulta [Hook di tabella](/docs/collections/callbacks/). |
| `strictWrites` | Una scrittura che fa riferimento a una colonna non dichiarata dalla tabella restituisce un 400. `false` la accetta, nel caso di una colonna che esiste nel database senza essere dichiarata (ad esempio valorizzata da un trigger). La colonna deve comunque esistere. |
| `metadata` | Qualsiasi dato che desideri venga servito con il descrittore della tabella. Rebase non lo legge. |

Altre due definizioni condividono la maggior parte di queste chiavi:
[`defineAuthTable`](/docs/schema/auth-table/) per la tabella in cui sono memorizzati gli utenti,
e [`defineView`](/docs/collections/views/) per le viste SQL.

## Nomi

Il primo argomento di `defineTable` è il nome della tabella, che funge da valore predefinito
per tutto il resto:

| Nome | Valore predefinito | Override |
|---|---|---|
| Tabella SQL | il nome | `table: "blog_posts"` |
| Slug API, accessor SDK, target dello scope | il nome | `slug: "articles"` |
| Schema Postgres | `public` | `schema: "content"` |
| Colonna SQL di una colonna | la versione snake_case della sua chiave | il primo argomento del builder: `col.text("legacy_name")` |

La chiave di una colonna è il suo nome nella riga JSON, nell'SDK, nei filtri e
negli ordinamenti. Il suo nome SQL è la versione snake_case della chiave: `publishDate` è la colonna
`publish_date`, e `photoURL` è `photo_url`. Il primo argomento del builder mappa
una chiave su qualsiasi altro nome SQL, come in Drizzle (`col.text("legacy_name")`),
consentendo a una tabella di adottare i nomi di un database esistente senza modificare ciò che
vedono i client.

`table` e `schema` devono essere normali identificatori SQL. Due definizioni non possono
condividere un nome, uno slug o una tabella SQL. L'importanza dello slug va oltre l'URL: i nomi
delle foreign key e delle colonne di giunzione derivano da esso, pertanto la modifica dello slug di una
tabella già distribuita può rinominare le colonne. Imposta `slug` esplicitamente quando
deve differire dal nome della tabella e non modificarlo successivamente.

## Chiavi primarie

Non esiste alcuna colonna `id` implicita. Ogni tabella deve contrassegnare almeno una colonna
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

Una colonna chiave è `NOT NULL` per definizione. Una chiave `uuid` solitamente accetta
`.defaultRandom()`; una chiave intera accetta `.generatedByDefaultAsIdentity()`. Una chiave senza un
valore predefinito deve essere fornita dal chiamante in fase di creazione. Una colonna chiave non può essere
`.private()`, né può essere di tipo `timestamptz` o `time`.

## Quando una definizione viene rifiutata

Uno schema che lascerebbe una tabella non protetta o non disponibile non raggiunge mai il
database. Viene rifiutato in tre momenti:

1. **Nell'editor.** `rls` e `columns` sono richiesti dai tipi, e
   `rls: []` non è una configurazione valida. Un campo `tenant` o `softDelete`, oppure una
   colonna di indice scritta come chiave semplice, che non fa riferimento ad alcuna colonna costituisce un errore di tipo.
2. **Al caricamento del modulo.** `defineTable` solleva un'eccezione in presenza di una tabella senza colonne,
   una colonna che non è un builder `col.*`, una relazione che non è il risultato di un
   `rel.*`, una relazione con la stessa chiave di una colonna o l'assenza di una `rls` utilizzabile. Questo
   intercetta anche codice JavaScript e cast che il controllo dei tipi non può rilevare.
3. **Alla compilazione dello schema.** `rebase db generate`, `rebase db push`,
   `rebase doctor` e l'avvio del server compilano tutte le tabelle insieme e si interrompono con
   un errore `SchemaDefinitionError` che elenca ogni problema, indicando la tabella, la
   colonna o la relazione interessata e cosa scrivere in alternativa:

```text
The schema cannot be used (2 problems):
  - posts: the table has no primary key. Mark a column `.primaryKey()` — e.g. `id: col.uuid().primaryKey().defaultRandom()`; several make a composite key in declaration order.
  - comments: `rls: "inherit"` takes the project's `defaultRls`, and none was given. Export `defaultRls` from backend/schema/index.ts (`"admin-only"` or a list of rules), or write this table's own `rls`.
```

La fase di compilazione verifica gli elementi che richiedono la presenza simultanea di tutte le tabelle: le destinazioni delle relazioni
e i rispettivi tipi di chiave, le tabelle di giunzione rivendicate da due relazioni contemporaneamente, gli slug e i nomi SQL
in conflitto (inclusi i nomi che collidono una volta che Postgres li tronca a 63
byte), le regole che fanno riferimento a una colonna inesistente nella tabella e l'uso di `"inherit"`
in assenza di un `defaultRls`. Viene rifiutata anche una tabella esportata da un file adiacente a `index.ts` ma non
da `index.ts` stesso: il file index costituisce l'elenco ufficiale delle tabelle.

## Passaggi successivi

- [Colonne](/docs/schema/columns/): ogni builder e modificatore `col.*`
- [Documenti JSON](/docs/schema/json/): `jsonb` tipizzati e convalidati con `json.*`
- [Relazioni](/docs/collections/relations/): le cinque tipologie di `rel.*`
- [Row-level security](/docs/collections/security-rules/): la configurazione `rls` e le sue regole
- [Hook di tabella](/docs/collections/callbacks/): hook del ciclo di vita lato server
- [Inferenza dei tipi](/docs/schema/types/): `InferRow`, `InferInsert` e `InferUpdate`
