---
sourceHash: a919caafccd81923
title: Colonne
sidebar_label: Colonne
description: "Ogni builder e modificatore col.*: il tipo Postgres creato da ciascuno, il tipo letto e scritto da un client, e cosa viene imposto dall'API — nullabilità, default, stamp, validazione, insiemi chiusi di valori, accesso e storage."
---

<span class="since-badge" data-since="0.31">Since 0.31</span>

Una colonna è un builder `col.*`, rifinito da modificatori. Il builder definisce il
tipo Postgres; i modificatori stabiliscono tutto il resto: se la colonna può essere
null, il suo default, la sua validazione, e chi può leggerla e scriverla.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const products = defineTable("products", {
    columns: {
        id:        col.uuid().primaryKey().defaultRandom(),
        sku:       col.varchar({ length: 32 }).notNull().unique(),
        name:      col.text().notNull().validate({ min: 2, max: 120, trim: true }),
        price:     col.numeric({ precision: 10, scale: 2 }).notNull().validate({ min: 0 }),
        status:    col.enum(["draft", "active", "retired"]).notNull().default("draft"),
        tags:      col.text().array().validate({ maxItems: 10 }),
        photo:     col.storage({ path: "products/", accept: ["image/*"], maxBytes: "5MB" }),
        createdBy: col.uuid().onCreateUser().readOnly(),
        createdAt: col.timestamp({ withTimezone: true }).notNull().onCreateNow(),
        updatedAt: col.timestamp({ withTimezone: true }).notNull().onUpdateNow(),
    },
    rls: "admin-only",
});
```

I builder sono immutabili: ogni modificatore restituisce un nuovo builder, quindi una colonna può essere
dichiarata una sola volta e condivisa tra tabelle.

Dopo il punto, la sintassi di una colonna è simile a quella di `pg-core` di [Drizzle](https://orm.drizzle.team/docs/column-types/pg):
gli stessi nomi di builder, un nome di colonna SQL opzionale come primo argomento, poi
l'oggetto di configurazione di Drizzle e infine la catena — `col.varchar({ length: 32 })`,
`col.timestamp({ withTimezone: true })`, `col.text().array()`,
`` .default(sql`now()`) ``. Una grafia in stile Drizzle che qui avrebbe un significato diverso
non compila, e l'errore indica cosa scrivere al suo posto. Due differenze da
tenere a mente:

- **Una foreign key è una relazione.** Dichiarala sotto `relations`:
  `author: rel.belongsTo(() => users, { localKey: "author_id" })`. La
  chiave della relazione è ciò che viene specificato in `include`. `.references()` non esiste
  e lo segnala esplicitamente. Consulta [Relazioni](/docs/collections/relations/).
- **`.defaultNow()` è solo un default del database**: `DEFAULT now()`, che un client
  può comunque sovrascrivere. `.onCreateNow()` è uno [stamp](#stamp) del server: il server
  scrive l'orario al momento della creazione, indipendentemente da ciò che ha inviato il client.

## Builder

<span class="since-badge" data-since="0.31">Since 0.31</span>

Un builder per ciascun tipo Postgres. Il wire type è ciò che un client legge in una riga e
invia in una scrittura, nonché il tipo assegnato alla colonna dall'SDK e da
[`InferRow`](/docs/schema/types/). Ogni builder accetta un nome di colonna SQL opzionale come primo
argomento (`col.text("legacy_title")`); se omesso, il nome SQL corrisponderà al
nome della chiave in snake_case.

| Builder | Tipo Postgres | Wire type | Note |
|---|---|---|---|
| `col.uuid()` | `UUID` | `string` | `.defaultRandom()` per `gen_random_uuid()` |
| `col.text()` | `TEXT` | `string` | `col.text({ enum: [...] })` accetta solo quei valori; vedi [Insiemi chiusi di valori](#insiemi-chiusi-di-valori) |
| `col.varchar({ length })` | `VARCHAR(n)` | `string` | la lunghezza è obbligatoria; accetta anche `enum` |
| `col.char({ length })` | `CHAR(n)` | `string` | la lunghezza è obbligatoria; accetta anche `enum` |
| `col.enum(values)` | un tipo enum Postgres, `<table>_<column>` | l'unione di `values` | vedi [Insiemi chiusi di valori](#insiemi-chiusi-di-valori) |
| `pgEnum(name, values)`, poi `status()` | un tipo enum Postgres con nome | l'unione di `values` | ogni colonna associata condivide lo stesso tipo |
| `col.smallint()` | `SMALLINT` | `number` | |
| `col.integer()` | `INTEGER` | `number` | |
| `col.bigint({ mode: "number" })` | `BIGINT` | `number` | letto e scritto come `number` JavaScript |
| `col.smallserial()` | `SMALLSERIAL` | `number` | ha un default; preferisci `col.smallint().generatedByDefaultAsIdentity()` in un nuovo schema |
| `col.serial()` | `SERIAL` | `number` | ha un default; preferisci `col.integer().generatedByDefaultAsIdentity()` |
| `col.bigserial({ mode: "number" })` | `BIGSERIAL` | `number` | ha un default; preferisci `col.bigint({ mode: "number" }).generatedByDefaultAsIdentity()` |
| `col.real()` | `REAL` | `number` | |
| `col.doublePrecision()` | `DOUBLE PRECISION` | `number` | |
| `col.numeric({ precision?, scale? })` | `NUMERIC`, `NUMERIC(p)`, `NUMERIC(p, s)` | `number` | una scala richiede una precisione; `col.decimal()` è lo stesso builder |
| `col.boolean()` | `BOOLEAN` | `boolean` | |
| `col.timestamp({ withTimezone: true })` | `TIMESTAMPTZ` | `string` (ISO 8601) | una scrittura accetta anche un `Date`; un timestamp senza fuso orario è `col.custom({ dataType: "timestamp" })` |
| `col.date()` | `DATE` | `string` (`YYYY-MM-DD`) | una scrittura accetta anche un `Date` |
| `col.time()` | `TIME` | `string` (`HH:MM:SS`) | una scrittura accetta anche un `Date` |
| `col.jsonb()` / `col.jsonb(shape)` | `JSONB` | `unknown` (tipizzato tramite `.$type<T>()`), oppure il tipo dello shape | vedi [Documenti JSON](/docs/schema/json/) |
| `col.json()` / `col.json(shape)` | `JSON` | come `jsonb` | mantiene il testo così come fornito; preferisci `jsonb` |
| `<builder>.array()` | `<inner>[]` | un array del wire type interno | `col.text().array()`; niente array di array; vedi [Array](#array) |
| `col.vector({ dimensions, index? })` | `vector(dimensions)` (pgvector) | `number[]` | un indice HNSW al coseno a meno che `index` non indichi diversamente; vedi [Ricerca vettoriale](/docs/backend/vector-search/) |
| `col.bytea()` | `BYTEA` | `string` (base64) | |
| `col.geopoint()` | `JSONB` | `{ latitude: number; longitude: number }` | |
| `col.storage(options)` | `TEXT` | `string` (il percorso del file) | `.multiple()` lo rende `TEXT[]`; vedi [Colonne di storage](#colonne-di-storage) |
| `col.custom({ dataType })` | qualsiasi altro tipo Postgres, testuale (`"inet"`, `"citext"`) | `string` (tipizzato tramite `.$type<T>()`) | Rebase include il tipo nel DDL e passa i valori senza modifiche |

## Modificatori

<span class="since-badge" data-since="0.31">Since 0.31</span>

Tutti i builder dispongono del primo gruppo. I restanti sono presenti solo sui builder per cui
hanno senso; chiamarne uno altrove genera un errore di tipo.

| Modificatore | Su | Database | API e tipi |
|---|---|---|---|
| `.notNull()` | ogni colonna | `NOT NULL` | mai `null` su una riga; obbligatorio alla creazione a meno che non abbia un default |
| `.primaryKey()` | ogni colonna | parte della chiave primaria, `NOT NULL` | assente dal tipo `Update` |
| `.unique()` | ogni colonna | `UNIQUE` su colonna singola | un duplicato restituisce `409` |
| `.default(value)` | ogni colonna | `DEFAULT <value>` | applicato anche dal driver alla creazione; opzionale alla creazione |
| `` .default(sql`expr`) `` | ogni colonna | `DEFAULT <expr>` | opzionale alla creazione; `sql` viene importato insieme a `col` |
| `.dbDefault()` | ogni colonna | mantiene inalterato il default esistente nel database | opzionale alla creazione |
| `` .generatedAlwaysAs(sql`expr`) `` | ogni colonna | `GENERATED ALWAYS AS (<expr>) STORED` | mai scrivibile, da nessuno |
| `.$type<T>()` | ogni colonna | nessuno | tipizza il valore solo per TypeScript, come in Drizzle |
| `.array()` | ogni colonna | `<type>[]` | vedi [Array](#array) |
| `.readOnly()` | ogni colonna | nessuno | scritture dal client rifiutate; assente da `Insert` e `Update` |
| `.private()` | ogni colonna | nessuno | mai inviato sul wire, nell'SDK o in OpenAPI |
| `.access({ read?, write? })` | ogni colonna | nessuno | lettura e scrittura per ruolo; vedi [Accesso ai campi](/docs/collections/field-access/) |
| `.describe(text)` | ogni colonna | nessuno | la descrizione in OpenAPI e MCP |
| `.validate(rules)` | ogni colonna | nessuno | verificato prima di ogni scrittura; le regole dipendono dal tipo, vedi [Validazione](#validazione) |
| `.transform({ beforeSave?, afterRead? })` | ogni colonna | nessuno | hook a livello di campo; `value` è `T \| null` a meno che `.notNull()` non sia posizionato prima; vedi [Hook di tabella](/docs/collections/callbacks/#field-hooks-transform) |
| `.oneOf(values)` | colonne numeriche | nessuno | accetta solo questi valori; tipizzato come loro unione (una colonna di testo accetta `{ enum: [...] }`) |
| `.defaultRandom()` | `col.uuid()` | `DEFAULT gen_random_uuid()` | opzionale alla creazione |
| `.generatedByDefaultAsIdentity()` | `col.smallint()`, `col.integer()`, `col.bigint({ mode: "number" })` | `GENERATED BY DEFAULT AS IDENTITY` | opzionale alla creazione |
| `.defaultNow()` | `timestamptz`, `date`, `time` | `DEFAULT now()` | opzionale alla creazione; un client può comunque inviare un valore |
| `.onCreateNow()` | `timestamptz`, `date`, `time` | `DEFAULT now()` | il server applica lo stamp con l'orario alla creazione |
| `.onUpdateNow()` | `timestamptz`, `date`, `time` | `DEFAULT now()` e un trigger `BEFORE UPDATE` | il server applica lo stamp con l'orario alla creazione e a ogni aggiornamento |
| `.onCreateUser()` | colonne di testo, `col.uuid()` | nessuno | il server scrive l'ID del chiamante alla creazione |
| `.onUpdateUser()` | colonne di testo, `col.uuid()` | nessuno | il server scrive l'ID del chiamante a ogni scrittura |
| `.userId()` | colonne di testo, `col.uuid()` | nessuno | la colonna contiene l'ID di un utente; il pannello mostra un selettore utente; vedi [Colonne utente](#colonne-utente) |
| `.multiple()` | `col.storage()` | `TEXT[]` | la colonna contiene più percorsi di file |

## Null, obbligatorietà e default

<span class="since-badge" data-since="0.31">Since 0.31</span>

Le colonne sono nullable per impostazione predefinita. `.notNull()` e `.primaryKey()` rendono una colonna
`NOT NULL`, e l'API la richiede quindi alla creazione a meno che non abbia un valore di default. Una
colonna `NOT NULL` è di tipo `T` su una riga; qualsiasi altra colonna è `T | null`.

Un valore di default può essere uno qualsiasi tra `.default()`, `` .default(sql`…`) ``, `.defaultNow()`,
`.dbDefault()`, `.defaultRandom()`, `.generatedByDefaultAsIdentity()`, uno stamp
o un builder serial. Una colonna con un
default può essere omessa durante la creazione:

```ts
import { defineTable, col, sql } from "@rebasepro/server/schema";

export const tickets = defineTable("tickets", {
    columns: {
        id:       col.integer().primaryKey().generatedByDefaultAsIdentity(),
        code:     col.text().notNull().default(sql`gen_short_id()`),
        priority: col.smallint().notNull().default(3),
        legacy:   col.text().dbDefault(),
    },
    rls: "admin-only",
});
```

- **`.default(value)`** viene scritto come `DEFAULT` della colonna e applicato anche
  dal driver alla creazione, così che la riga risulti identica chiunque la inserisca. Una
  colonna temporale accetta anche un `Date`, memorizzato come stringa ISO. Il default di una
  colonna enum deve essere uno dei suoi valori.
- **`` .default(sql`expression`) ``** viene valutato da Postgres. L'espressione viene
  inserita nel DDL così com'è, quindi il tag `sql` non accetta `${…}`.
  `.defaultNow()` corrisponde a `` .default(sql`now()`) ``.
- **`.dbDefault()`** indica che il database contiene già un default che lo schema
  non dichiara. Una creazione può omettere la colonna e un push dello schema non rimuoverà
  il default.

`.generatedAlwaysAs()` non può avere un default né uno stamp: Postgres calcola la colonna
a ogni scrittura. Una colonna chiave primaria non può essere `.private()`.

## Stamp

<span class="since-badge" data-since="0.31">Since 0.31</span>

Uno stamp è un valore che il server scrive autonomamente in una colonna. Sovrascrive
qualsiasi cosa inviata dal client per quella colonna.

| Stamp | Scrive | Quando |
|---|---|---|
| `.onCreateNow()` | l'orario corrente | alla creazione |
| `.onUpdateNow()` | l'orario corrente | alla creazione e a ogni aggiornamento |
| `.onCreateUser()` | l'ID utente del chiamante | alla creazione |
| `.onUpdateUser()` | l'ID utente del chiamante | alla creazione e a ogni aggiornamento |

Una colonna può contenere un solo stamp. Chiamarne un secondo diverso genera un errore al
caricamento del modulo; `.onUpdateNow()` da solo applica già lo stamp alla riga al momento della creazione.
Le colonne con stamp rimangono nullable a meno che non si specifichi `.notNull()`.

`.onCreateUser()` è il modo in cui riceve il proprio valore una colonna che una regola di sicurezza a livello di riga
confronta con il chiamante (`ownerField`). Una colonna compilata dal chiamante è una colonna
su cui il chiamante può mentire.

## Colonne utente

<span class="since-badge" data-since="0.31">Since 0.31</span>

`.userId()` indica che una colonna contiene l'ID di un utente. Si tratta di un significato semantico, non di un
tipo: la colonna rimane `text` (oppure `varchar`, `char`, `uuid`) e il
descrittore fornito dal server riporta `semantic: "user"`.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const tickets = defineTable("tickets", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        subject: col.text().notNull(),
        assignedTo: col.text().userId().describe("Team member assigned to this ticket"),
        watchers: col.text().userId().array()
    },
    rls: "admin-only"
});
```

Ne conseguono due aspetti:

- Il pannello di amministrazione visualizza un selettore utente per la colonna invece di un campo
  di testo, mostrando l'utente anziché l'ID grezzo.
- Un chiamante autorizzato a scrivere sulla tabella può cercare gli utenti per compilarla. La lettura
  del selettore risponde loro anche quando la sicurezza a livello di riga nasconde le righe degli altri utenti.

Funziona su `col.text()`, `col.varchar()`, `col.char()` e `col.uuid()`,
sugli elementi di un array (`col.text().userId().array()`) e su
`json.string()` all'interno di un [documento JSON](/docs/schema/json/). In qualsiasi altro contesto
genera un errore al caricamento del modulo. Non dichiara alcuna foreign key: usa
`rel.belongsTo(() => users)` se il database deve vincolarla. Se vuoi che il
server popoli la colonna con l'ID del chiamante, usa invece uno [stamp](#stamp).

## Validazione

<span class="since-badge" data-since="0.31">Since 0.31</span>

`.validate(rules)` accetta le regole specifiche per il tipo della colonna. L'API le verifica
prima di una creazione o di un aggiornamento e rifiuta la scrittura restituendo un `400` con il nome
della colonna. Chiamare `.validate()` due volte unisce le regole.

| Regola | Colonne di testo e `col.storage()` | Colonne numeriche | `timestamptz`, `date`, `time` | Array |
|---|---|---|---|---|
| `min`, `max` | lunghezza | limiti inclusivi | valore minimo e massimo (stringa ISO o `Date`) | |
| `length` | lunghezza esatta | | | |
| `matches`, `matchesFlags`, `matchesMessage` | un pattern (stringa o `RegExp`) e l'errore | | | |
| `email`, `url` | il valore è un indirizzo email o un URL | | | |
| `trim`, `lowercase`, `uppercase` | il valore viene normalizzato prima di essere memorizzato | | | |
| `lessThan`, `moreThan` | | limiti esclusivi | | |
| `positive`, `negative`, `integer` | | segno, numero intero | | |
| `minItems`, `maxItems`, `uniqueItems` | | | | numero di elementi, nessun duplicato |
| `requiredMessage` | ✓ | ✓ | ✓ | ✓ |

`requiredMessage` è l'errore restituito durante la creazione quando viene omessa una colonna `.notNull()`
priva di default. Tutti gli altri tipi di colonna (`uuid`, `enum`, `boolean`,
JSON, `vector`, `bytea`, `geopoint`) accettano unicamente `requiredMessage`.

Una `RegExp` viene memorizzata con il suo source e i suoi flag, e un limite `Date` come stringa ISO,
cosicché le regole trasmesse sul wire coincidano con quelle verificate dal server.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const signups = defineTable("signups", {
    columns: {
        id:       col.uuid().primaryKey().defaultRandom(),
        email:    col.text().notNull().validate({ email: true, lowercase: true, trim: true, requiredMessage: "Enter your e-mail address." }),
        handle:   col.varchar({ length: 32 }).validate({ matches: /^[a-z0-9_]+$/, matchesMessage: "Lower-case letters, digits and _ only." }),
        age:      col.smallint().validate({ integer: true, min: 13 }),
        birthday: col.date().validate({ max: "2013-01-01" }),
    },
    rls: "admin-only",
});
```

Su `col.varchar({ length })` e `col.char({ length })`, la lunghezza è imposta
sia da Postgres sia dall'API. Un `max` differente entrerebbe in contraddizione con essa;
dichiara la lunghezza una sola volta.

## Insiemi chiusi di valori

<span class="since-badge" data-since="0.31">Since 0.31</span>

Due modi per accettare solo determinati valori:

- **Un tipo enum Postgres**, così che l'insieme sia applicato anche dal database.
  `col.enum(values)` ne crea uno denominato `<table>_<column>`. Un tipo con un nome
  a tua scelta, condiviso da più colonne, si dichiara una sola volta con
  `pgEnum(name, values)` — come in Drizzle — e si richiama in ogni colonna:
  `postStatus()`. Due dichiarazioni con lo stesso nome devono elencare gli stessi valori
  nello stesso ordine.
- **Un insieme verificato dall'API**, senza un tipo Postgres: `{ enum: [...] }` su
  `col.text()`, `col.varchar()` o `col.char()`, e `.oneOf(values)` su una
  colonna numerica. È anche la sintassi usata per un array di stringhe note:
  `col.text({ enum: ["a", "b"] }).array()`.

Tutti questi metodi tipizzano la colonna come unione dei loro valori: nell'esempio sottostante, `status` è
`"draft" | "published"` sulla riga, `kind` è `"news" | "guide"` e `rating`
è `1 | 2 | 3 | 4 | 5`.

```ts
import { defineTable, col, pgEnum } from "@rebasepro/server/schema";

const reviewStatus = pgEnum("review_status", ["draft", "published"]);

export const reviews = defineTable("reviews", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        status: reviewStatus().notNull().default("draft"),
        kind:   col.text({ enum: ["news", "guide"] }),
        rating: col.smallint().notNull().oneOf([1, 2, 3, 4, 5]),
        labels: col.text({ enum: ["bug", "praise", "question"] }).array(),
    },
    rls: "admin-only",
});
```

Etichette e colori per i valori riguardano la presentazione. Appartengono al CMS, non
alla tabella.

## Array

<span class="since-badge" data-since="0.31">Since 0.31</span>

`.array()` crea un array Postgres del tipo della colonna, come in Drizzle:
`col.text().array()` corrisponde a `TEXT[]`, `col.integer().array()` a `INTEGER[]`. Ciò che
viene concatenato prima di `.array()` descrive ciascun elemento: il suo `{ enum }`, `.validate()`,
`.oneOf()`, le opzioni di storage e `.transform()`. Ciò che viene concatenato dopo descrive
la colonna array stessa: il suo `.validate()` accetta `minItems`, `maxItems` e
`uniqueItems`.

I modificatori che descrivono una colonna (`.notNull()`, un default, `.unique()`,
`.access()`) vanno posizionati dopo `.array()` — `col.text().array().notNull().default([])`;
prima di esso non compilano. Gli array di array non sono consentiti; usa
`col.jsonb()` per liste nidificate. Un array contiene scalari — testo, `uuid`, numeri,
booleani, date, enum: un `.array()` di `jsonb`, `json`, `vector`, `bytea`,
geopoint o `col.custom()` viene rifiutato, mentre una lista di documenti, punti o
vettori si definisce con `col.jsonb(json.array(…))`. Un tipo di lista personalizzato viene indicato direttamente:
`col.custom({ dataType: "inet[]" })`.

Ogni elemento viene trasmesso come verrebbe trasmesso il suo tipo su una colonna scalare: un
elemento `timestamptz[]` come stringa RFC 3339, un elemento `numeric[]` come numero, e
un elemento null come `null`.

## Chiavi, identity e serial

<span class="since-badge" data-since="0.31">Since 0.31</span>

`.generatedByDefaultAsIdentity()` rende una colonna intera `GENERATED BY DEFAULT
AS IDENTITY`. È la forma standard per una chiave intera in un nuovo schema
(`.generatedAlwaysAsIdentity()` non compila: Rebase crea solo identity by
default). I builder serial (`col.smallserial()`, `col.serial()`,
`col.bigserial({ mode: "number" })`) esistono per gli schemi che
già li utilizzano; una colonna che punta a una chiave serial corrisponde al semplice intero della
medesima ampiezza. Consulta [Chiavi primarie](/docs/schema/#primary-keys) per le chiavi composite.

`col.bigint({ mode: "number" })` viene letto e scritto come `number` JavaScript
(la modalità `mode: "bigint"` di Drizzle non compila), che è esatto fino a
2⁵³ − 1. Anche `col.numeric()` è un `number`, quindi trasmette sul wire la precisione di un
double, indipendentemente dalla precisione memorizzata da Postgres.

## Chi può leggere e scrivere una colonna

<span class="since-badge" data-since="0.31">Since 0.31</span>

La sicurezza a livello di riga stabilisce a quali righe può accedere un chiamante. Tre modificatori limitano
ciò che può vedere di una riga e ciò che può impostare:

- **`.readOnly()`** rifiuta qualsiasi scrittura del client sulla colonna, sia in creazione che in
  aggiornamento, indipendentemente dal ruolo del chiamante. Il database (tramite default o trigger) e
  il codice server possono comunque compilarla. La colonna è assente dai tipi `Insert` e `Update`.
- **`.private()`** mantiene la colonna confinata al server: assente da ogni riga sul
  wire, dall'SDK e da OpenAPI, e rifiutata nei filtri e negli ordinamenti. Gli hook e il
  codice server continuano a vederla. Una colonna privata non può dichiarare anche `.access()`.
- **`.access({ read, write })`** elenca i ruoli che ricevono la colonna e i
  ruoli autorizzati a scriverla. Omettere un elenco affida tale direzione alla riga; un
  elenco vuoto ne preclude l'accesso a qualsiasi chiamante.

[Accesso ai campi](/docs/collections/field-access/) illustra cosa vede un chiamante quando
una colonna è nascosta e tutti i contesti a cui si applica la regola.

## Colonne di storage

<span class="since-badge" data-since="0.31">Since 0.31</span>

`col.storage(options)` contiene il percorso di un file all'interno di un bucket di storage. La rotta
di upload applica `accept` e `maxBytes`, e la pulizia dei file orfani considera il file come
referenziato fintanto che una riga ne contiene il percorso. `.multiple()` consente alla colonna di contenere
più percorsi (`TEXT[]`).

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const listings = defineTable("listings", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        cover:  col.storage({ path: "listings/{id}/", accept: ["image/*"], maxBytes: "10MB",
                              imageResize: { maxWidth: 1600, format: "webp", quality: 80 } }),
        photos: col.storage({ path: "listings/{id}/gallery/", accept: ["image/*"] }).multiple(),
        terms:  col.storage({ path: "listings/terms/", accept: ["application/pdf"], public: true }),
    },
    rls: "admin-only",
});
```

| Opzione | Cosa fa |
|---|---|
| `path` | **Obbligatorio.** Dove vanno i file, sotto forma di template di percorso: `"posts/heroes/"`, `"users/{id}/"`. |
| `source` | Il bucket, dichiarato in `backend/resources.ts`. Se omesso, viene utilizzato il bucket predefinito. |
| `accept` | Tipi MIME accettati, con caratteri jolly: `["image/*", "application/pdf"]`. |
| `maxBytes` | La dimensione massima del file accettato: un numero di byte o una dimensione come `"10MB"`, `"512 kb"`, `"1.5GB"`. Multipli binari: 1 MB equivale a 1.048.576 byte. Una dimensione non interpretabile genera un errore. |
| `imageResize` | Ridimensiona le immagini prima di memorizzarle: `maxWidth`, `maxHeight`, `mode` (`"contain"` o `"cover"`), `format` (`"original"`, `"jpeg"`, `"png"`, `"webp"`), `quality`. |
| `public` | I file sono leggibili senza un URL firmato. |
| `fileName` | Il nome del file memorizzato, come template. Se omesso, usa il nome del file caricato. |
| `metadata` | Metadati memorizzati con ogni file. |
| `includeBucketUrl` | Memorizza l'URL del bucket davanti al percorso. |
| `storeUrl` | Memorizza l'URL di download anziché il percorso. |

Una colonna di storage supporta le regole di validazione delle colonne di testo. Un file all'interno di un
documento JSON si dichiara con `json.storage()`, con le medesime opzioni; vedi
[Documenti JSON](/docs/schema/json/). Chi può caricare e scaricare determinati percorsi è
descritto in [autorizzazione dello storage](/docs/backend/storage-authorization/); il serving e la
memorizzazione in cache dei file sono descritti in [Storage](/docs/backend/storage/).

## Cosa viene rifiutato

<span class="since-badge" data-since="0.31">Since 0.31</span>

Al caricamento del modulo, un builder genera un'eccezione in caso di:

- `col.varchar()` o `col.char()` senza una lunghezza specificata; un valore di `length` o `dimensions`
  che non sia un numero intero positivo, oppure `col.numeric({ scale })` senza precisione;
- `col.enum([])`, `pgEnum(name, { … })` e `.array()` di un array;
- un default `sql` o un'espressione generata contenente un'interpolazione;
- un secondo stamp diverso sulla stessa colonna, e `.oneOf()` con un valore che
  non sia una stringa o un numero;
- `.access()` il cui `read` o `write` non sia un elenco di nomi di ruolo non vuoti;
- `col.storage()` privo di `path`, o con un `maxBytes` che non rappresenta una dimensione valida.

Alla compilazione dello schema, la tabella viene rifiutata per:

- un default insieme a `.generatedAlwaysAs()`, oppure uno stamp insieme ad esso;
- `.generatedByDefaultAsIdentity()` su una colonna non intera, `.defaultRandom()` su una colonna non-`uuid`,
  un time stamp su una colonna non temporale, un user stamp su una colonna che
  non è né testo né `uuid`;
- una chiave primaria `.private()`, oppure una chiave primaria di tipo `timestamptz` o `time`;
- una chiave primaria su una colonna `jsonb`, `json`, geopoint, `vector`, `bytea`, array o
  lista personalizzata: una chiave deve essere uno scalare (testo, `varchar`, `char`, `uuid`, un
  enum, un numero, un booleano o una data). `schema introspect` salta una tabella con tale
  chiave e ne indica il motivo;
- un `.array()` di `jsonb`, `json`, `vector`, `bytea`, geopoint o
  `col.custom()` (vedi [Array](#array));
- una regola di `.validate()` non verificata dalla tipologia di colonna, dai suoi elementi o da un nodo JSON
  (`integer` su una colonna di testo, `trim` su un numero, `minItems` su uno scalare);
- una colonna che è contemporaneamente `.private()` e `.access()`;
- un `.transform()` su una colonna e un altro sul suo shape JSON;
- un `col.custom({ dataType })` il cui nome del tipo non rispecchia la forma di un nome
  di tipo Postgres;
- `.oneOf([])`, e `.oneOf()` su una colonna che non è né testo né numerica;
- un enum con un valore vuoto o duplicato, o un default che non è uno dei suoi
  valori;
- due chiavi che risolvono nella stessa colonna SQL, anche dopo che Postgres
  ha troncato i nomi a 63 byte;
- un tipo enum con nome a cui vengono fornite due liste di valori differenti.

Ogni rifiuto indica la tabella, la colonna e cosa scrivere in alternativa.

Le grafie in stile Drizzle che qui avrebbero un significato diverso non compilano, e il
compilatore segnala cosa scrivere: `col.timestamp()` senza `withTimezone: true`,
`.references()`, `.$defaultFn()`, `.$onUpdate()`, `.generatedAlwaysAsIdentity()`,
`.unique("name")`, `mode: "string"` per `numeric`, nonché `col.inet()`, `col.interval()`
e gli altri tipi che Rebase supporta unicamente tramite `col.custom({ dataType })`.

## Prossimi passi

<span class="since-badge" data-since="0.31">Since 0.31</span>

- [Documenti JSON](/docs/schema/json/): la struttura di una colonna `jsonb`
- [Relazioni](/docs/collections/relations/): le foreign key provengono da `rel.*`, non dalle colonne
- [Accesso ai campi](/docs/collections/field-access/): `.access()`, `.private()` e `.readOnly()` nel dettaglio
- [Inferenza dei tipi](/docs/schema/types/): l'effetto di ciascun modificatore su `InferRow` e `InferInsert`
