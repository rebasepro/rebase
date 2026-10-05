---
sourceHash: 09be514fba53db38
title: Generazione dello Schema
sidebar_label: Generazione dello Schema
description: Genera schemi Drizzle ORM dalle definizioni delle collezioni, crea migrazioni SQL e mantieni il tuo database sincronizzato con la CLI di Rebase.
---

## Panoramica

Rebase usa una pipeline **schema-come-codice** in cui le tue definizioni di collezioni TypeScript sono l'unica fonte di verità. La CLI le trasforma attraverso una pipeline deterministica:

```
Collections (TypeScript) → Drizzle Schema → SQL Migrations → PostgreSQL
```

Questa pagina copre ogni comando CLI coinvolto in quella pipeline.

## La Pipeline

### 1. Collezioni → Schema Drizzle

Le tue definizioni di collezioni in `config/collections/` descrivono tabelle, colonne, tipi, relazioni ed enum. Il comando `schema generate` le legge e produce un file di schema Drizzle ORM.

### 2. Schema Drizzle → Migrazioni

Dallo schema Drizzle generato, `db generate` confronta con lo stato corrente del database e produce file di migrazione SQL con timestamp.

### 3. Migrazioni → PostgreSQL

Il comando `db migrate` applica le migrazioni in sospeso al tuo database PostgreSQL.

## Comandi

### `rebase schema generate`

Genera un file di schema Drizzle ORM dalle tue definizioni di collezioni:

```bash
rebase schema generate
```

**Cosa fa:**
- Legge tutte le collezioni da `config/collections/`
- Genera `backend/src/schema.generated.ts` con le definizioni di tabelle, enum e relazioni di Drizzle

**Opzioni:**

| Flag | Descrizione |
|------|-------------|
| `--collections, -c` | Directory delle collezioni (predefinito: `config/collections/`); i percorsi relativi vengono risolti dalla posizione in cui esegui il comando |
| `--output, -o` | Percorso di output per il file di schema generato; i percorsi relativi vengono risolti dalla posizione in cui esegui il comando |
| `--watch, -w` | Osservare le modifiche e rigenerare automaticamente |

La **modalità watch** è utile durante lo sviluppo — modifica un file di collezione e lo schema si rigenera istantaneamente:

```bash
rebase schema generate --watch
```

### `rebase schema introspect`

Esegui il reverse engineering delle definizioni di collezioni da un database PostgreSQL esistente:

```bash
rebase schema introspect
```

**Cosa fa:**
- Si connette al tuo database (usando la stringa di connessione dal tuo `.env`)
- Ispeziona tutte le tabelle, colonne, tipi e chiavi esterne
- Genera i file di definizione delle collezioni

**Opzioni:**

| Flag | Descrizione |
|------|-------------|
| `--output, -o` | Directory di output per i file di collezione generati |

Questo è utile quando si adotta Rebase su un database esistente — prima esegui l'introspezione, poi personalizza le collezioni generate.

<span class="since-badge" data-since="0.24">Da 0.24</span> **Introspezione, poi push, non cambia nulla.** Le proprietà generate dicono esattamente cos'è ogni colonna — `columnType`, `precision`/`scale`, `defaultValue`, `required`, l'`isId` di una chiave (`"increment"` per un'identity intera, `columnType: "serial"` per una serial, `"manual"` per una chiave senza default), l'`onDelete` di una relazione, e il blocco `search` di una collezione letto a ritroso dalla colonna che ha costruito — quindi `rebase db push --dry-run` eseguito subito dopo un'introspezione non pianifica alcuna modifica. Dove nessuna proprietà può rappresentare una colonna — un `timestamp` senza time zone, un `interval`, un `inet`, un tipo enum che non si chiama `<table>_<column>`, un default come `CURRENT_DATE` — l'introspezione lo segnala, colonna per colonna, sul terminale e in testa al file, con ciò che un push le farebbe e, quando esiste, l'istruzione che fa coincidere le due cose (`ALTER TYPE "mood" RENAME TO "customers_current_mood";`). Una tabella con chiave su più di una colonna torna come una chiave composita, con il suo `isId` su ogni colonna della chiave. Viene esclusa, con il relativo motivo, quando una colonna della chiave non può portare `isId` (un timestamp, per esempio) o la chiave esterna di un'altra tabella punta a essa, cosa che una relazione su una sola colonna non può fare; `db push` lascia stare una tabella che non è una collezione. Sulla 0.23 il push eseguito subito dopo un'introspezione può ancora pianificare cambi di tipo, default rimossi e NOT NULL, e una chiave `id` fantasma.

### `rebase db push`

Applica le modifiche allo schema direttamente al database senza file di migrazione:

```bash
rebase db push
```

**Cosa fa:**
- Legge lo schema Drizzle generato
- Applica le modifiche direttamente al database (CREATE, ALTER, DROP)
- Esegue prima il piano in modalità dry run e si ferma prima di tutto ciò che distrugge dati: una tabella, colonna, schema, vista o tipo eliminati, un `TRUNCATE`, un cambio di tipo di colonna che può perdere valori (`timestamptz` → `date`, `numeric` → `integer`), o un cambio di chiave primaria: `(id)` → `(id, locale)` dà a ogni riga un nuovo id, così link, chiavi esterne e id salvati altrove non trovano più la loro riga. In un terminale chiede conferma, altrimenti rifiuta; `--allow-destructive` (o `--yes`) applica comunque la modifica
- Attiva la sicurezza a livello di riga su ogni tabella di collezione, tabelle di giunzione comprese, subito dopo la modifica dello schema e prima di qualsiasi passaggio che possa fallire: un push che si interrompe a metà lascia una nuova tabella che nega ogni richiesta invece che aperta a tutte
- Applica le policy RLS delle tue collezioni e **rimuove le policy sostituite da un push precedente**
- **Non** crea file di migrazione

**I file che genera lungo il percorso**, tutti sotto `.rebase/sql/` nella directory del backend. `db push` e `db generate` scrivono tutti e cinque a partire dalle tue collezioni a ogni esecuzione, prima di leggerne uno qualsiasi, quindi una copia committata non verrebbe letta da nulla. La directory ha il proprio `.gitignore` e non viene mai committata.

| File | Contiene |
|------|-------|
| `schema.sql` | Tabelle, colonne, vincoli e indici — lo stato desiderato di Atlas, e l'unico che confronta |
| `policies.sql` | Le policy RLS in cui vengono compilate le tue `securityRules` |
| `search.sql` | Le funzioni di ricerca full-text e le colonne generate, per le collezioni con un blocco `search` |
| `vector.sql` | Le estensioni pgvector e gli indici ANN |
| `triggers.sql` | `rebase.set_updated_at()` e i trigger `BEFORE UPDATE` dietro `autoValue: "on_update"` |

Atlas gestisce il primo e nient'altro, quindi `db push` e l'allineamento dello schema all'avvio applicano da soli gli altri quattro. Un deployment **solo con migrazioni** — uno che esegue `db migrate` e mai `db push` — deve includere quei quattro in una migrazione a mano; `db generate` lo segnala quando una modifica è invisibile ad Atlas.

Se un progetto ha committato questi file in `drizzle/` con una release precedente, quelle copie vengono eliminate alla prima esecuzione, e il comando le nomina una per una così puoi committare l'eliminazione. Elimina solo i file che iniziano con l'intestazione del generatore. Un file che hai scritto tu resta, così come `drizzle/migrations/`.

:::note[Modificare una regola di sicurezza rinomina la sua policy]
Una regola senza un `name` esplicito viene compilata in `<table>_<op>_<hash>`, dove l'hash copre la semantica della regola — quindi *modificare* una regola (invece di aggiungerne una) produce una policy con un nuovo nome e lascia indietro quella vecchia.

Un tempo questo contava molto: Postgres combina le policy `PERMISSIVE` in OR, quindi un `USING (rebase.uid() IS NOT NULL)` sostituito continuava a concedere tutto, per quanto restrittiva fosse la sua sostituta. Rendere più restrittiva una regola non aveva alcun effetto, e il push segnalava successo.

Ora `db push` riconcilia questa situazione: elimina le policy generate che non corrispondono più ad alcuna regola, e segnala — senza eliminarla — ogni policy con nome personalizzato che le tue collezioni non descrivono, perché non si distingue da SQL scritto deliberatamente da qualcuno.

Per verificare un database su cui è stato fatto il push prima di questa modifica, esegui `rebase doctor --policies`. Funziona come controllo di CI: esce con un codice diverso da zero in caso di drift, e anche quando non è riuscito a eseguire il controllo — nessuna `DATABASE_URL`, un percorso `--collections` che non si risolve, una lettura di `pg_policies` non concessa al ruolo di CI. Un controllo che non ha potuto guardare non è stato superato.
:::

:::caution
`db push` modifica il database direttamente. Usalo solo in sviluppo. Per la produzione, usa `db generate` + `db migrate` per creare file di migrazione revisionabili.
:::

### `rebase db generate`

Genera file di migrazione SQL dalle modifiche allo schema:

```bash
rebase db generate
```

**Cosa fa:**
- Confronta lo schema Drizzle con lo stato corrente del database
- Produce file di migrazione SQL con timestamp in `drizzle/migrations/`
- I file possono essere revisionati, modificati e committati nel controllo di versione

Le migrazioni generate sono semplici file SQL — puoi ispezionarle e modificarle prima di applicarle.

### `rebase db migrate`

Esegui tutte le migrazioni in sospeso:

```bash
rebase db migrate
```

**Cosa fa:**
- Legge `drizzle/migrations/` per le migrazioni non applicate
- Le applica in ordine al database
- Tiene traccia di quali migrazioni sono state applicate

#### Impostare una baseline su un database che Rebase ha già avviato

Ogni avvio di Rebase assicura lo schema, e `rebase db push` lo applica direttamente. Un database su cui uno dei due sia mai stato eseguito ha quindi già le tabelle e i tipi che la prima migrazione creerebbe, e `rebase db migrate` si ferma su `pq: type "posts_status" already exists (42710)`.

Nella migrazione non c'è nulla di sbagliato: il database è stato predisposto in un altro modo. Registrate dove si trova già, poi migrate normalmente:

```bash
rebase db migrate --baseline 20260906101530
rebase db migrate
```

La versione è il prefisso numerico del file di migrazione che descrive ciò che c'è nel database *adesso*. Quella migrazione e tutte le precedenti risultano applicate; tutto ciò che viene dopo viene eseguito. Su un database che non è mai stato avviato non serve alcuna baseline: migrate direttamente.

### `rebase db branch`

Branching del database per lo sviluppo parallelo:

```bash
rebase db branch create feature_auth
rebase db branch list
rebase db branch delete feature_auth
```

### `rebase doctor`

Rileva la deriva a tre vie tra le tue definizioni di collezioni, lo schema Drizzle generato e il database PostgreSQL in esecuzione:

```bash
rebase doctor
```

**Cosa controlla:**
- Collezioni ↔ Schema generato — sono sincronizzati?
- Schema generato ↔ Database — ci sono modifiche non applicate?
- Collezioni ↔ Database — c'è qualche deriva imprevista?

Esegui `doctor` ogni volta che qualcosa sembra non sincronizzato. Individua esattamente dove si trova la discrepanza.

### `rebase generate-sdk`

Genera un SDK tipizzato dalle tue definizioni di collezioni:

```bash
rebase generate-sdk
```

**Cosa fa:**
- Legge ogni file di collezione in `config/collections/` — i file che il backend serve, che siano elencati o no nel barrel `index.ts` — e si interrompe su uno che non si carica
- Genera tipi TypeScript per tutte le entità in `generated/sdk/`
- Produce un file `database.types.ts` da usare con `createRebaseClient<Database>()`

`rebase dev` lo esegue per te all'avvio e a ogni salvataggio sotto `config/collections/`. Eseguilo tu stesso in CI, in un repository che non ha collezioni (vedi `--from` più sotto), o ovunque `rebase dev` non sia in esecuzione.

<span class="since-badge" data-since="0.24">Da 0.24</span> per la lettura di ogni file, l'interruzione su uno danneggiato,
l'esecuzione da parte di `rebase dev` e `--collections` su questo comando.
Sulla 0.23 legge i file elencati dal barrel `index.ts`, salta con un avviso
quello che non si carica, e accetta la directory come `--collections-dir`;
`rebase dev` rigenera solo lo schema.

**Opzioni:**

| Flag | Descrizione |
|------|-------------|
| `-c`, `--collections` | Directory delle collezioni (predefinito: `config/collections/`); i percorsi relativi vengono risolti dalla posizione in cui esegui il comando. Anche `--collections-dir` è accettato. |
| `-o`, `--output` | Directory di output per l'SDK (predefinito: `generated/sdk/`) |
| `--from <link\|url>` | Legge lo schema da un progetto in esecuzione anziché dal codice locale. `link` usa il progetto collegato a questo checkout. |
| `--token` | Token Bearer per l'endpoint del contratto (predefinito: `$REBASE_SERVICE_KEY`) |

`--from` è ciò che permette a un repository privo di collezioni — un frontend separato, una seconda web app, un'app mobile — di generare un client tipizzato dal progetto con cui parla. `REBASE_SERVICE_KEY` viene inviato solo al progetto collegato a questo checkout; per qualsiasi altro host, passa `--token` esplicitamente.

**Utilizzo dopo la generazione:**

```typescript
import { createRebaseClient } from "@rebasepro/client";
import { collectionsDictionary, type Database } from "./generated/sdk/database.types";

const client = createRebaseClient<Database>({
    baseUrl: import.meta.env.VITE_API_URL,
    collections: collectionsDictionary,
});

// Full type safety and autocomplete
const { data } = await client.data.products.find();
```

I nomi dei campi nei tipi generati sono quelli che l'API serve, invariati: una colonna `createdAt` è `row.createdAt`. Solo l'*accessor* della collezione diventa un nome di proprietà (`my-notes` → `client.data.myNotes`), ed è questo che `collectionsDictionary` rimappa sullo slug.

## Flusso di Lavoro di Sviluppo

Il flusso di lavoro a iterazione rapida per lo sviluppo:

```bash
# 1. Edit your collection in config/collections/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Push directly to dev database
rebase db push
```

## Flusso di Lavoro di Produzione

Il flusso di lavoro sicuro e revisionabile per la produzione:

```bash
# 1. Edit your collection in config/collections/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Generate SQL migration files
rebase db generate

# 4. Review the generated SQL in drizzle/migrations/
# 5. Commit the migration to version control
git add drizzle/migrations/

# 6. Apply in production
#    A database Rebase has already booted needs a baseline the first time —
#    see the baselining section above.
rebase db migrate
```

## Risoluzione dei Problemi

| Sintomo | Soluzione |
|---------|----------|
| `Could not detect an active database plugin` | Installa `@rebasepro/server-postgres` in `backend/package.json` |
| Il file di schema non si aggiorna | Controlla che il percorso `--collections` punti alla directory corretta |
| La migrazione mostra modifiche impreviste | Esegui `rebase doctor` per identificare la deriva |
| `db push` fallisce in produzione | Usa `db generate` + `db migrate` invece |
| `db migrate` fallisce con `already exists (42710)` | L'avvio o `db push` hanno già predisposto lo schema — registratelo con `rebase db migrate --baseline <version>` |

## Prossimi Passi

- **[Collezioni](/docs/collections)** — Definisci il tuo modello di dati
- **[Riferimento CLI](/docs/cli)** — Tutti i comandi CLI
- **[SDK tipizzato](/docs/sdk)** — Usa l'SDK generato
