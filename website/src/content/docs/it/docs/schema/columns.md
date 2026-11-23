---
sourceHash: b2705ba2e3901257
title: Colonne
sidebar_label: Colonne
description: "Ogni builder e modificatore col.*: il tipo Postgres creato da ciascuno, il tipo letto e scritto da un client e ciò che l'API applica — nullabilità, valori predefiniti, timestamp, validazione, insiemi chiusi di valori, accesso e archiviazione."
---

Una colonna è un builder `col.*`, perfezionato da modificatori. Il builder definisce il
tipo Postgres; i modificatori stabiliscono tutto il resto: se la colonna può essere
null, il suo valore predefinito, la sua validazione, chi può leggerla e scriverla.

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

I builder sono immutabili: ogni modificatore restituisce un nuovo builder, consentendo di
dichiarare una colonna una sola volta e condividerla tra tabelle.

Dopo il punto, la sintassi di una colonna è simile a quella di `pg-core` di [Drizzle](https://orm.drizzle.team/docs/column-types/pg):
gli stessi nomi di builder, un nome di colonna SQL facoltativo come primo parametro, poi
l'oggetto di configurazione di Drizzle e infine la catena di metodi — `col.varchar({ length: 32 })`,
`col.timestamp({ withTimezone: true })`, `col.text().array()`,
`` .default(sql`now()`) ``. Una sintassi Drizzle che qui avrebbe un significato diverso
non compila, e il messaggio di errore indica cosa scrivere in alternativa. Due differenze da
tenere a mente:

- **Una foreign key è una relazione.** Dichiarala sotto `relations`:
  `author: rel.belongsTo(() => users, { localKey: "author_id" })`. La
  chiave della relazione è ciò che `include` specifica per nome. `.references()` non esiste e
  lo segnala esplicitamente. Vedi [Relazioni](/docs/collections/relations/).
- **`.defaultNow()` è solo un default a livello di database**: `DEFAULT now()`, che un client
  può comunque sovrascrivere. `.onCreateNow()` è un [timestamp](#stamp) del server: il server
  scrive la data/ora al momento della creazione, indipendentemente da quanto inviato dal client.

## Builder

Un builder per ogni tipo Postgres. Il wire type è ciò che un client legge in una riga e
invia in una scrittura, e il modo in cui l'SDK e [`InferRow`](/docs/schema/types/) tipizzano
la colonna. Ogni builder accetta un nome di colonna SQL facoltativo come primo
argomento (`col.text("legacy_title")`); in sua assenza, il nome SQL corrisponde allo
snake_case della chiave.

| Builder | Tipo Postgres | Wire type | Note |
|---|---|---|---|
| `col.uuid()` | `UUID` | `string` | `.defaultRandom()` per `gen_random_uuid()` |
| `col.text()` | `TEXT` | `string` | `col.text({ enum: [...] })` accetta solo quei valori; vedi [Insiemi chiusi di valori](#insiemi-chiusi-di-valori) |
| `col.varchar({ length })` | `VARCHAR(n)` | `string` | la lunghezza è obbligatoria; accetta anche `enum` |
| `col.char({ length })` | `CHAR(n)` | `string` | la lunghezza è obbligatoria; accetta anche `enum` |
| `col.enum(values)` | un tipo enum Postgres, `<table>_<column>` | l'unione dei `values` | vedi [Insiemi chiusi di valori](#insiemi-chiusi-di-valori) |
| `pgEnum(name, values)`, poi `status()` | un tipo enum Postgres con nome | l'unione dei `values` | ogni colonna che lo usa condivide lo stesso tipo |
| `col.smallint()` | `SMALLINT` | `number` | |
| `col.integer()` | `INTEGER` | `number` | |
| `col.bigint({ mode: "number" })` | `BIGINT` | `number` | letto e scritto come numero JavaScript |
| `col.smallserial()` | `SMALLSERIAL` | `number` | ha un valore predefinito; preferire `col.smallint().generatedByDefaultAsIdentity()` in un nuovo schema |
| `col.serial()` | `SERIAL` | `number` | ha un valore predefinito; preferire `col.integer().generatedByDefaultAsIdentity()` |
| `col.bigserial({ mode: "number" })` | `BIGSERIAL` | `number` | ha un valore predefinito; preferire `col.bigint({ mode: "number" }).generatedByDefaultAsIdentity()` |
| `col.real()` | `REAL` | `number` | |
| `col.doublePrecision()` | `DOUBLE PRECISION` | `number` | |
| `col.numeric({ precision?, scale? })` | `NUMERIC`, `NUMERIC(p)`, `NUMERIC(p, s)` | `number` | una scala richiede una precisione; `col.decimal()` è lo stesso builder |
| `col.boolean()` | `BOOLEAN` | `boolean` | |
| `col.timestamp({ withTimezone: true })` | `TIMESTAMPTZ` | `string` (ISO 8601) | una scrittura accetta anche un `Date`; un timestamp senza fuso orario è `col.custom({ dataType: "timestamp" })` |
| `col.date()` | `DATE` | `string` (`YYYY-MM-DD`) | una scrittura accetta anche un `Date` |
| `col.time()` | `TIME` | `string` (`HH:MM:SS`) | una scrittura accetta anche un `Date` |
| `col.jsonb()` / `col.jsonb(shape)` | `JSONB` | `unknown` (`.$type<T>()` lo tipizza), o il tipo di shape | vedi [Documenti JSON](/docs/schema/json/) |
| `col.json()` / `col.json(shape)` | `JSON` | come `jsonb` | mantiene il testo fornito; preferire `jsonb` |
| `<builder>.array()` | `<inner>[]` | un array del wire type interno | `col.text().array()`; niente array di array; vedi [Array](#array) |
| `col.vector({ dimensions, index? })` | `vector(dimensions)` (pgvector) | `number[]` | un indice HNSW cosine a meno che `index` non indichi diversamente; vedi [Ricerca vettoriale](/docs/backend/vector-search/) |
| `col.bytea()` | `BYTEA` | `string` (base64) | |
| `col.geopoint()` | `JSONB` | `{ latitude: number; longitude: number }` | |
| `col.storage(options)` | `TEXT` | `string` (il percorso del file) | `.multiple()` lo rende `TEXT[]`; vedi [Colonne di archiviazione](#colonne-di-archiviazione) |
| `col.custom({ dataType })` | qualsiasi altro tipo Postgres, verbatim (`"inet"`, `"citext"`) | `string` (`.$type<T>()` lo tipizza) | Rebase assegna il nome al tipo nel DDL e inoltra i valori direttamente |

## Modificatori

Ogni builder dispone del primo gruppo. I restanti esistono solo sui builder per cui hanno
senso; chiamarli altrove genera un errore di tipo.

| Modificatore | Applicabile a | Database | API e tipi |
|---|---|---|---|
| `.notNull()` | ogni colonna | `NOT NULL` | mai `null` su una riga; obbligatorio in fase di creazione a meno che non abbia un valore predefinito |
| `.primaryKey()` | ogni colonna | parte della chiave primaria, `NOT NULL` | assente dal tipo `Update` |
| `.unique()` | ogni colonna | `UNIQUE` a colonna singola | un duplicato restituisce un `409` |
| `.default(value)` | ogni colonna | `DEFAULT <value>` | applicato dal driver anche in fase di creazione; facoltativo in creazione |
| `` .default(sql`expr`) `` | ogni colonna | `DEFAULT <expr>` | facoltativo in creazione; `sql` viene importato insieme a `col` |
| `.dbDefault()` | ogni colonna | lascia invariato il valore predefinito esistente nel database | facoltativo in creazione |
| `.serverDefault()` | ogni colonna | nessuno | un hook lo valorizza; facoltativo in creazione, e il form del pannello non lo richiede |
| `` .generatedAlwaysAs(sql`expr`) `` | ogni colonna | `GENERATED ALWAYS AS (<expr>) STORED` | mai scrivibile, da nessuno |
| `.$type<T>()` | ogni colonna | nessuno | tipizza il valore solo per TypeScript, come in Drizzle |
| `.array()` | ogni colonna | `<type>[]` | vedi [Array](#array) |
| `.readOnly()` | ogni colonna | nessuno | scritture da client rifiutate; assente da `Insert` e `Update` |
| `.private()` | ogni colonna | nessuno | mai trasmesso via rete, nell'SDK o in OpenAPI |
| `.access({ read?, write? })` | ogni colonna | nessuno | lettura e scrittura per ruolo; vedi [Accesso ai campi](/docs/collections/field-access/) |
| `.describe(text)` | ogni colonna | nessuno | la descrizione in OpenAPI ed MCP |
| `.validate(rules)` | ogni colonna | nessuno | verificato prima di ogni scrittura; le regole dipendono dal tipo, vedi [Validazione](#validazione) |
| `.transform({ beforeSave?, afterRead? })` | ogni colonna | nessuno | hook a livello di campo; `value` è `T \| null` a meno che non sia preceduto da `.notNull()`; vedi [Hook di tabella](/docs/collections/callbacks/#field-hooks-transform) |
| `.oneOf(values)` | colonne numeriche | nessuno | solo questi valori accettati; tipizzato come la loro unione (una colonna di testo usa `{ enum: [...] }`) |
| `.defaultRandom()` | `col.uuid()` | `DEFAULT gen_random_uuid()` | facoltativo in creazione |
| `.generatedByDefaultAsIdentity()` | `col.smallint()`, `col.integer()`, `col.bigint({ mode: "number" })` | `GENERATED BY DEFAULT AS IDENTITY` | optional in creazione |
| `.defaultNow()` | `timestamptz`, `date`, `time` | `DEFAULT now()` | facoltativo in creazione; un client può comunque inviare un valore |
| `.onCreateNow()` | `timestamptz`, `date`, `time` | `DEFAULT now()` | il server inserisce la data/ora al momento della creazione |
| `.onUpdateNow()` | `timestamptz`, `date`, `time` | `DEFAULT now()` e un trigger `BEFORE UPDATE` | il server inserisce la data/ora alla creazione e a ogni aggiornamento |
| `.onCreateUser()` | colonne di testo, `col.uuid()` | nessuno | il server scrive l'id del chiamante al momento della creazione |
| `.onUpdateUser()` | colonne di testo, `col.uuid()` | nessuno | il server scrive l'id del chiamante a ogni scrittura |
| `.userId()` | colonne di testo, `col.uuid()` | nessuno | la colonna contiene l'id di un utente; il pannello offre un selettore utente; vedi [Colonne utente](#colonne-utente) |
| `.multiple()` | `col.storage()` | `TEXT[]` | la colonna contiene più percorsi di file |

## Null, obbligatorietà e valori predefiniti

Le colonne ammettono valori null per impostazione predefinita. `.notNull()` e `.primaryKey()` rendono una colonna
`NOT NULL`, e l'API la richiede quindi in fase di creazione a meno che non abbia un valore predefinito. Una
colonna `NOT NULL` è di tipo `T` su una riga; qualsiasi altra colonna è `T | null`.

Un valore predefinito è uno qualsiasi tra `.default()`, `` .default(sql`…`) ``, `.defaultNow()`,
`.dbDefault()`, `.serverDefault()`, `.defaultRandom()`,
`.generatedByDefaultAsIdentity()`, uno stamp o un serial builder. Una colonna con un
valore predefinito può essere omessa in fase di creazione:

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

- **`.default(value)`** viene scritto come `DEFAULT` della colonna e applicato
  anche dal driver in fase di creazione, in modo che una riga risulti identica a prescindere da chi la inserisce. Una
  colonna temporale accetta anche un `Date`, memorizzato come stringa ISO. Il valore predefinito
  di una colonna enum deve essere uno dei suoi valori consentiti.
- **`` .default(sql`espressione`) ``** viene valutato da Postgres. L'espressione viene
  scritta nel DDL così com'è, quindi il tag `sql` non accetta `${…}`.
  `.defaultNow()` equivale a `` .default(sql`now()`) ``.
- **`.dbDefault()`** indica che il database contiene già un valore predefinito non
  dichiarato nello schema. Un'operazione di creazione può omettere la colonna, e un push dello schema non
  elimina il default.
- **`.serverDefault()`** indica che il codice server della tabella valorizza la colonna quando
  un'operazione di creazione la omette: un `hooks.beforeSave` che ricava uno slug dal
  titolo, o il `.transform()` della colonna. Poiché un hook è codice non ispezionabile dall'esterno, la
  colonna dichiara esplicitamente cosa fa. Non viene scritto alcun default nel DDL; una creazione può omettere
  la colonna, OpenAPI non la elenca come obbligatoria e il form del pannello consente di
  creare un record senza di essa (nessun `filledByServer` nella personalizzazione).

`.generatedAlwaysAs()` non può avere un valore predefinito o uno stamp: Postgres calcola la colonna
a ogni scrittura. Una colonna di chiave primaria non può essere `.private()`.

## Stamp

Uno stamp è un valore che il server scrive autonomamente in una colonna. Sovrascrive
qualsiasi valore inviato da un client per quella colonna.

| Stamp | Cosa scrive | Quando |
|---|---|---|
| `.onCreateNow()` | la data/ora corrente | alla creazione |
| `.onUpdateNow()` | la data/ora corrente | alla creazione e a ogni aggiornamento |
| `.onCreateUser()` | l'id utente del chiamante | alla creazione |
| `.onUpdateUser()` | l'id utente del chiamante | alla creazione e a ogni aggiornamento |

Una colonna può contenere un solo stamp. Chiamarne un secondo diverso solleva un errore al
caricamento del modulo; `.onUpdateNow()` da solo applica già lo stamp alla riga al momento della creazione.
Le colonne con stamp rimangono nullable a meno che non si specifichi `.notNull()`.

`.onCreateUser()` è il modo in cui una colonna confrontata con il chiamante da una regola di sicurezza a livello di riga
(`ownerField`) ottiene il proprio valore. Una colonna compilata dal chiamante è una colonna
su cui il chiamante può mentire.

## Colonne utente

`.userId()` indica che una colonna contiene l'id di un utente. Si tratta di un significato semantico, non di un
tipo: la colonna rimane `text` (o `varchar`, `char`, `uuid`), e il
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

Da ciò conseguono due comportamenti:

- Il pannello di amministrazione esegue il rendering di un selettore utente per la colonna anziché di un
  input di testo, e mostra l'utente invece dell'id grezzo.
- Un chiamante autorizzato a scrivere sulla tabella può cercare gli utenti per valorizzarla. La lettura
  del selettore risponde loro anche quando la sicurezza a livello di riga nasconde le righe degli altri utenti
  dalla loro vista.

Funziona su `col.text()`, `col.varchar()`, `col.char()` e `col.uuid()`,
sugli elementi di un array (`col.text().userId().array()`), e su
`json.string()` all'interno di un [documento JSON](/docs/schema/json/). In qualsiasi altro contesto
solleva un errore al caricamento del modulo. Non dichiara alcuna foreign key: specifica
`rel.belongsTo(() => users)` se desideri che il database ne imponga una. Per fare in modo che sia il
server a valorizzare la colonna con l'id del chiamante, usa invece uno [stamp](#stamp).

## Validazione

`.validate(rules)` accetta le regole appropriate per il tipo della colonna. L'API le verifica
prima di una creazione o di un aggiornamento e rifiuta la scrittura con un `400` indicando il
nome della colonna. Chiamare `.validate()` due volte unisce le regole.

| Regola | Colonne di testo e `col.storage()` | Colonne numeriche | `timestamptz`, `date`, `time` | Array |
|---|---|---|---|---|
| `min`, `max` | lunghezza | limiti inclusivi | valore minimo e massimo (stringa ISO o `Date`) | |
| `length` | lunghezza esatta | | | |
| `matches`, `matchesFlags`, `matchesMessage` | un pattern (stringa o `RegExp`) e l'errore | | | |
| `email`, `url` | il valore è un indirizzo o un URL | | | |
| `trim`, `lowercase`, `uppercase` | il valore viene normalizzato prima di essere salvato | | | |
| `lessThan`, `moreThan` | | limiti esclusivi | | |
| `positive`, `negative`, `integer` | | segno, numero intero | | |
| `minItems`, `maxItems`, `uniqueItems` | | | | conteggio elementi, nessun duplicato |
| `requiredMessage` | ✓ | ✓ | ✓ | ✓ |

`requiredMessage` è l'errore restituito a un'operazione di creazione quando viene omessa una colonna
`.notNull()` senza un valore predefinito. Ogni altro tipo di colonna (`uuid`, `enum`, `boolean`,
JSON, `vector`, `bytea`, `geopoint`) accetta unicamente `requiredMessage`.

Una `RegExp` viene memorizzata come sorgente e flag, e un limite `Date` come
stringa ISO, garantendo che le regole trasmesse sul canale siano le stesse verificate dal server.

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

Su `col.varchar({ length })` e `col.char({ length })` la lunghezza è imposta
sia da Postgres che dall'API. Un valore di `max` differente entrerebbe in contraddizione
con essa; specifica la lunghezza una sola volta.

## Insiemi chiusi di valori

Due modalità per accettare solo determinati valori:

- **Un tipo enum di Postgres**, in modo che anche il database applichi il vincolo.
  `col.enum(values)` ne crea uno denominato `<table>_<column>`. Un tipo con un nome
  personalizzato, condiviso da più colonne, viene dichiarato una sola volta con
  `pgEnum(name, values)` — come in Drizzle — e richiamato in ciascuna colonna:
  `postStatus()`. Due dichiarazioni con lo stesso nome devono elencare gli stessi valori
  nello stesso ordine.
- **Un insieme verificato dall'API**, senza alcun tipo Postgres: `{ enum: [...] }` su
  `col.text()`, `col.varchar()` o `col.char()`, e `.oneOf(values)` su una
  colonna numerica. È anche la sintassi per un array di stringhe note:
  `col.text({ enum: ["a", "b"] }).array()`.

Tutte queste opzioni tipizzano la colonna come unione dei loro valori: `status` qui sotto è
`"draft" | "published"` sulla riga, `kind` è `"news" | "guide"`, e `rating`
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

`.array()` crea un array Postgres del tipo della colonna, come in Drizzle:
`col.text().array()` è `TEXT[]`, `col.integer().array()` è `INTEGER[]`. Ciò che
è concatenato prima di `.array()` descrive ciascun elemento: `{ enum }`, `.validate()`,
`.oneOf()`, le opzioni di archiviazione e `.transform()`. Ciò che viene dopo descrive
la colonna array: il suo `.validate()` accetta `minItems`, `maxItems` e
`uniqueItems`.

I modificatori che descrivono una colonna (`.notNull()`, un default, `.unique()`,
`.access()`) vanno dopo `.array()` — `col.text().array().notNull().default([])`;
prima di esso non compilano. Gli array di array non sono consentiti; usa
`col.jsonb()` per elenchi annidati. Un array contiene scalari — testo, `uuid`, numeri,
booleani, date, enum: un `.array()` di `jsonb`, `json`, `vector`, `bytea`,
geopoint o `col.custom()` non è consentito, e un elenco di documenti, punti o
vettori va definito come `col.jsonb(json.array(…))`. Un tipo di lista personalizzato va specificato con il suo nome:
`col.custom({ dataType: "inet[]" })`.

Ciascun elemento viene restituito nel formato tipico di una colonna scalare: un
elemento `timestamptz[]` come stringa RFC 3339, un elemento `numeric[]` come numero, e
un elemento null come `null`.

## Chiavi, identity e serial

`.generatedByDefaultAsIdentity()` rende una colonna di tipo intero `GENERATED BY DEFAULT
AS IDENTITY`. È il formato consigliato per una chiave intera in un nuovo schema
(`.generatedAlwaysAsIdentity()` non compila: Rebase crea le identity solo
by default). I builder serial (`col.smallserial()`, `col.serial()`,
`col.bigserial({ mode: "number" })`) esistono per schemi che
già li utilizzano; una colonna che punta a una chiave serial corrisponde al tipo intero semplice
della stessa dimensione. Vedi [Chiavi primarie](/docs/schema/#primary-keys) per le chiavi composite.

`col.bigint({ mode: "number" })` viene letto e scritto come `number` JavaScript
(`mode: "bigint"` di Drizzle non compila), che è esatto fino a
2⁵³ − 1. Anche `col.numeric()` è un `number`, quindi mantiene la precisione di un
double sul wire, indipendentemente dalla precisione memorizzata da Postgres.

## Chi può leggere e scrivere una colonna

La sicurezza a livello di riga stabilisce a quali righe ha accesso un chiamante. Tre modificatori limitano
ciò che può visualizzare di una riga e ciò che può impostare:

- **`.readOnly()`** rifiuta qualsiasi scrittura da parte del client sulla colonna, sia in creazione che in
  aggiornamento, qualunque sia il ruolo del chiamante. Il database (un default, un trigger) e
  il codice server possono comunque valorizzarla. La colonna è assente dai tipi `Insert` e `Update`.
- **`.private()`** mantiene la colonna confinata al server: assente da ogni riga sul
  wire, dall'SDK, da OpenAPI, e non consentita in filtri e ordinamenti. Gli hook e
  il codice server continuano a vederla. Una colonna privata non può dichiarare anche `.access()`.
- **`.access({ read, write })`** elenca i ruoli che ricevono la colonna e i
  ruoli che possono scriverla. Omettere un elenco delega tale permesso alla riga; una
  lista vuota ne preclude l'accesso a qualsiasi chiamante.

[Accesso ai campi](/docs/collections/field-access/) illustra cosa vede un chiamante quando
una colonna viene omessa e ogni via di accesso a cui la regola si applica.

## Colonne di archiviazione

`col.storage(options)` memorizza il percorso di un file all'interno di un bucket di archiviazione. La route di
upload applica `accept` e `maxBytes`, e la pulizia degli orfani considera il file come
referenziato finché una riga ne contiene il percorso. `.multiple()` consente alla colonna di contenere
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

| Opzione | Descrizione |
|---|---|
| `path` | **Obbligatorio.** Dove vengono collocati i file, sotto forma di template di percorso: `"posts/heroes/"`, `"users/{id}/"`. |
| `source` | Il bucket, dichiarato in `backend/resources.ts`. Il bucket predefinito se omesso. |
| `accept` | Tipi MIME accettati, con caratteri jolly: `["image/*", "application/pdf"]`. |
| `maxBytes` | La dimensione massima del file accettato: un numero di byte, o una stringa come `"10MB"`, `"512 kb"`, `"1.5GB"`. Multipli binari: 1 MB equivale a 1.048.576 byte. Una dimensione non valida genera un errore. |
| `imageResize` | Ridimensiona le immagini prima di salvarle: `maxWidth`, `maxHeight`, `mode` (`"contain"` o `"cover"`), `format` (`"original"`, `"jpeg"`, `"png"`, `"webp"`), `quality`. |
| `public` | I file sono accessibili in lettura senza un URL firmato. |
| `fileName` | Il nome del file salvato, come template. Il nome del file caricato se omesso. |
| `metadata` | Metadati salvati con ogni file. |
| `includeBucketUrl` | Memorizza l'URL del bucket davanti al percorso. |
| `storeUrl` | Memorizza l'URL di download anziché il percorso. |

Una colonna di archiviazione accetta le regole di validazione delle colonne di testo. Un file all'interno di un
documento JSON si dichiara con `json.storage()`, con le medesime opzioni; vedi
[Documenti JSON](/docs/schema/json/). Chi può caricare e scaricare determinati percorsi è descritto in
[Autorizzazione all'archiviazione](/docs/backend/storage-authorization/); la distribuzione e
il caching dei file sono illustrati in [Archiviazione](/docs/backend/storage/).

## Cosa viene rifiutato

Al caricamento del modulo, un builder genera un'eccezione nei seguenti casi:

- `col.varchar()` o `col.char()` senza una lunghezza specificata; una `length` o `dimensions`
  che non sia un numero intero positivo, e `col.numeric({ scale })` senza
  precisione;
- `col.enum([])`, `pgEnum(name, { … })`, e `.array()` applicato a un array;
- un default `sql` o un'espressione generata contenente un'interpolazione;
- un secondo stamp differente sulla stessa colonna, e `.oneOf()` con un valore che
  non sia una stringa o un numero;
- `.access()` i cui parametri `read` o `write` non siano elenchi di nomi di ruoli non vuoti;
- `col.storage()` senza un `path`, o con un `maxBytes` che non rappresenta una dimensione valida.

In fase di compilazione dello schema, la tabella viene rifiutata in presenza di:

- un default insieme a `.generatedAlwaysAs()`, oppure uno stamp insieme ad esso;
- `.generatedByDefaultAsIdentity()` su una colonna non intera, `.defaultRandom()` su una colonna non-`uuid`,
  uno stamp temporale su una colonna non temporale, uno stamp utente su una colonna che
  non sia né di testo né `uuid`;
- una chiave primaria `.private()`, oppure una chiave primaria di tipo `timestamptz` o `time`;
- una chiave primaria su una colonna `jsonb`, `json`, geopoint, `vector`, `bytea`, array o
  lista personalizzata: una chiave deve essere uno scalare (testo, `varchar`, `char`, `uuid`, un
  enum, un numero, un booleano o una data). `schema introspect` ignora una tabella con una chiave
  di questo tipo e ne indica il motivo;
- un `.array()` di `jsonb`, `json`, `vector`, `bytea`, geopoint o
  `col.custom()` (vedi [Array](#array));
- una regola `.validate()` non verificabile per il tipo di colonna, i suoi elementi o un nodo JSON
  (`integer` su una colonna di testo, `trim` su un numero, `minItems` su uno scalare);
- una colonna configurata sia con `.private()` che con `.access()`;
- un `.transform()` su una colonna e un altro sulla sua struttura JSON;
- un `col.custom({ dataType })` il cui nome di tipo non rispetta la struttura di un
  tipo Postgres;
- `.oneOf([])`, e `.oneOf()` su una colonna che non è né di testo né numerica;
- un enum contenente un valore vuoto o duplicato, o un default che non rientra tra i suoi
  valori;
- due chiavi che fanno riferimento alla medesima colonna SQL, anche dopo che Postgres
  abbia troncato i nomi a 63 byte;
- un tipo enum con nome a cui sono stati forniti due elenchi di valori differenti.

Ogni rifiuto specifica il nome della tabella, della colonna e cosa scrivere in alternativa.

Le varianti di sintassi Drizzle che qui avrebbero un significato differente non compilano, e il
compilatore segnala cosa scrivere: `col.timestamp()` senza `withTimezone: true`,
`.references()`, `.$defaultFn()`, `.$onUpdate()`, `.generatedAlwaysAsIdentity()`,
`.unique("name")`, l'opzione `mode: "string"` di `numeric`, e `col.inet()`, `col.interval()`
unitamente agli altri tipi che Rebase supporta esclusivamente tramite `col.custom({ dataType })`.

## Passaggi successivi

- [Documenti JSON](/docs/schema/json/): la struttura di una colonna `jsonb`
- [Relazioni](/docs/collections/relations/): le foreign key derivano da `rel.*`, non dalle colonne
- [Accesso ai campi](/docs/collections/field-access/): `.access()`, `.private()` e `.readOnly()` nel dettaglio
- [Inferenza dei tipi](/docs/schema/types/): l'effetto di ciascun modificatore su `InferRow` e `InferInsert`
