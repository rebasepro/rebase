---
sourceHash: 03df1518e08ca072
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
| `--collections, -c` | Percorso alla directory delle collezioni (predefinito: `config/collections/`) |
| `--output, -o` | Percorso di output per il file di schema generato |
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

### `rebase db push`

Applica le modifiche allo schema direttamente al database senza file di migrazione:

```bash
rebase db push
```

**Cosa fa:**
- Legge lo schema Drizzle generato
- Applica le modifiche direttamente al database (CREATE, ALTER, DROP)
- **Non** crea file di migrazione

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
- Produce file di migrazione SQL con timestamp nella directory `drizzle/`
- I file possono essere revisionati, modificati e committati nel controllo di versione

Le migrazioni generate sono semplici file SQL — puoi ispezionarle e modificarle prima di applicarle.

### `rebase db migrate`

Esegui tutte le migrazioni in sospeso:

```bash
rebase db migrate
```

**Cosa fa:**
- Legge la directory `drizzle/` per le migrazioni non applicate
- Le applica in ordine al database
- Tiene traccia di quali migrazioni sono state applicate

#### Impostare una baseline su un database che Rebase ha già avviato

<span class="since-badge" data-since="0.18">Since 0.18</span>

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

Genera un SDK client tipizzato dalle tue definizioni di collezioni:

```bash
rebase generate-sdk
```

**Cosa fa:**
- Legge le collezioni da `config/collections/` (supporta gli export barrel `index.ts` o i file individuali)
- Genera tipi TypeScript per tutte le entità in `generated/sdk/`
- Produce un file `database.types.ts` da usare con `createRebaseClient<Database>()`

**Opzioni:**

| Flag | Descrizione |
|------|-------------|
| `-c`, `--collections-dir` | Percorso alla directory delle collezioni (predefinito: `config/collections/`) |
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

# 4. Review the generated SQL in drizzle/
# 5. Commit the migration to version control
git add drizzle/

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
- **[SDK Client](/docs/sdk)** — Usa l'SDK generato
