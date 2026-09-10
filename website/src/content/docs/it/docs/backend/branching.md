---
sourceHash: bba1fa1dd7f34bed
title: Database Branching
sidebar_label: Branching
description: Crea branch di database isolati per sviluppo, staging e testing utilizzando CREATE DATABASE ... TEMPLATE di PostgreSQL — copie istantanee a fedeltà totale senza tempi di inattività.
---

## Panoramica

Il branching del database consente di creare **copie istantanee e isolate** dell'intero database (sia dello schema che dei dati) per eseguire in sicurezza attività di sviluppo, test di migrazione e procedure di QA.

Sfruttando i template nativi di PostgreSQL, Rebase esegue il provisioning dei database clonati a livello di filesystem. Ciò significa che si ottiene una replica a fedeltà totale contenente tutte le tabelle, gli indici, i tipi personalizzati, i vincoli e le policy di Row-Level Security (RLS) senza alcun sovraccarico di trasferimento di rete o ritardi nella configurazione dello schema.

```
                  ┌────────────────────────┐
                  │ Production DB (rebase) │
                  └───────────┬────────────┘
                              │
               (CREATE DATABASE ... TEMPLATE)
                              │
            ┌─────────────────┴─────────────────┐
            ▼                                   ▼
┌───────────────────────┐           ┌───────────────────────┐
│ rb_feature_auth (Dev) │           │ rb_staging (Staging)  │
└───────────────────────┘           └───────────────────────┘
```

---

## Sotto il cofano: il templating di PostgreSQL

Quando viene creato un branch del database, il `BranchService` di Rebase esegue il seguente comando SQL:

```sql
CREATE DATABASE "rb_feature_auth" TEMPLATE "rebase";
```

PostgreSQL gestisce questa operazione copiando le directory del filesystem sottostante che contengono i file del database di origine. Questo garantisce:
- **Clonazioni in frazioni di secondo**: Non viene eseguita alcuna generazione SQL né caricamento di dati.
- **Schemi e dati identici**: Ogni riga, indice e vincolo viene duplicato istantaneamente.
- **Isolamento completo**: Modificare lo schema o inserire record nel branch non ha alcun impatto sul database di origine.

### La protezione sul limite di connessioni

PostgreSQL richiede che non sia presente **nessun'altra connessione attiva** sul database template (di origine) durante l'esecuzione del comando `CREATE DATABASE ... TEMPLATE`.

Per prevenire errori, il `DatabasePoolManager` di Rebase esegue un processo di rimozione attiva (eviction) prima di clonare o eliminare un branch:
1. **Ciclo di rimozione**: Chiude e disconnette automaticamente tutti i pool inattivi che puntano al database di destinazione all'interno del contesto applicativo di Rebase.
2. **Blocco connessioni esterne**: Se client esterni (come DBeaver, pgAdmin o processi di backend esterni) mantengono transazioni attive sul database di origine, PostgreSQL rifiuterà l'operazione di templating con l'errore `"being accessed by other users"`.

Il fallimento specifica chiaramente che cosa è connesso, invece di lasciarlo indovinare:

```
Cannot create branch: the source database "leadgen" has active connections.
  Connected right now:
    2 × psql
  A running `rebase dev` is the usual one — stop it, or re-run with --force to
  disconnect them for you.
```

`--force` termina queste sessioni prima del templating, sia su `create` che su
`delete`. Non termina mai la sessione che sta eseguendo il comando stesso.

`DatabasePoolManager` disconnette i propri pool inattivi prima della clonazione o dell'eliminazione — ma solo i pool **all'interno del processo che sta svolgendo il lavoro**. `rebase db branch` viene eseguito come processo a sé stante, pertanto non ha effetto su nient'altro nella macchina:

- **Un'istanza di `rebase dev` in esecuzione blocca il branching.** Questo è il caso comune, non un caso limite: la necessità di un branch e l'esecuzione dell'app si verificano solitamente nello stesso momento. Arresta il server di sviluppo, crea il branch e riavvialo.
- **Lo stesso vale per qualsiasi altro client.** DBeaver, pgAdmin, una sessione `psql`, una seconda istanza dell'app — PostgreSQL rifiuta l'operazione con `is being accessed by other users` e queste connessioni devono essere chiuse manualmente.

Non esiste alcun modo per aggirare questo comportamento in PostgreSQL stesso; `CREATE DATABASE ... TEMPLATE` è una copia a livello di filesystem e il template deve rimanere inattivo (quiescente) per l'intera durata.

---

## Schema dei metadati

Le configurazioni dei branch sono memorizzate nel database predefinito all'interno della tabella `rebase.branches`, che viene predisposta durante il bootstrap:

```sql
CREATE SCHEMA IF NOT EXISTS rebase;

CREATE TABLE IF NOT EXISTS rebase.branches (
    name         TEXT PRIMARY KEY,              -- Sanitize user branch name (alphanumeric & underscores)
    db_name      TEXT NOT NULL UNIQUE,          -- Actual PostgreSQL database name (prefixed with 'rb_')
    parent_db    TEXT NOT NULL,                 -- Source database cloned from
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata     JSONB DEFAULT '{}'
);
```

---

## API programmatica

L'API di branching è esposta tramite il `BranchService` del backend. Di seguito è riportato il riferimento per l'interfaccia principale:

### Creare un branch del database

Genera un nuovo database branch dal database predefinito o da un template sorgente esplicito.

```typescript no-verify
import { initializeRebaseBackend } from "@rebasepro/server";

const backend = await initializeRebaseBackend({ /* ... */ });
const admin = backend.driver.admin;

// Create a branch from the default database
const newBranch = await admin.createBranch("feature_oauth");

// Create a branch from a specific staging database
const stagingBranch = await admin.createBranch("pr_review_42", { 
    source: "rb_staging" 
});
```

### Elencare i branch attivi

Recupera l'elenco dei branch registrati insieme alle loro dimensioni fisiche interrogate tramite la funzione di sistema di PostgreSQL `pg_database_size`.

```typescript
const branches = await admin.listBranches();
/*
Output:
[
  {
    name: "feature_oauth",
    parentDatabase: "rebase",
    createdAt: 2026-06-20T22:00:00.000Z,
    sizeBytes: 83886080 // 80 MB
  }
]
*/
```

### Ottenere informazioni su un branch

Recupera i metadati relativi a un singolo branch. Se il branch esiste, il servizio tenta di interrogare il suo attuale utilizzo di spazio su disco:

```typescript
const info = await admin.getBranchInfo("feature_oauth");
```

### Eliminare un branch

Rimuove il database di destinazione dal server e pulisce il relativo record nella tabella dei metadati `rebase.branches`.

```typescript
await admin.deleteBranch("feature_oauth");
```

> [!CAUTION]
> Protezione di sicurezza: il database principale (il nome del database predefinito configurato nelle stringhe di connessione) è protetto. Se si tenta di eliminare il database padre, il `BranchService` solleva un errore `"Cannot delete the main database"` e interrompe l'operazione.

---

## Integrazione CLI

I branch del database possono essere gestiti direttamente tramite la CLI di Rebase.

```bash
# Create a new branch named 'dev_sandbox'
rebase db branch create dev_sandbox

# Clone from a database other than the default
rebase db branch create pr_review_42 --from rb_staging

# List all branches and disk utilization
rebase db branch list

# Work on it — every later command in this checkout uses it
rebase db branch switch dev_sandbox

# Which branch am I on?
rebase db branch switch

# Back to the main database
rebase db branch switch --off

# Show one branch's parent, age and size
rebase db branch info dev_sandbox

# Delete a branch
rebase db branch delete dev_sandbox
```

`switch` è ciò che rende utilizzabile un branch. Registra il branch in
`.rebase/branch.json` — un nome, mai una stringa di connessione, affinché le tue credenziali
rimangano esclusivamente in `.env` — e ogni comando `rebase` successivo in quel checkout punterà
quindi al database del branch: `dev`, `db push`, `db migrate`, `db backup`.

Si posiziona tra la shell e il file di progetto nell'ordine di risoluzione:

1. `--database-url` sulla riga di comando
2. `DATABASE_URL` nell'ambiente della shell
3. **il branch su cui è posizionato questo checkout**
4. `DATABASE_URL` nel file `.env` del progetto

Un branch deve avere la precedenza su `.env`, altrimenti il passaggio di branch non avrebbe alcun effetto su qualsiasi progetto che
imposta `DATABASE_URL`; non deve però avere la precedenza sui due livelli superiori, perché un flag specificato su questa
riga di comando è un'istruzione più immediata rispetto a uno switch effettuato in precedenza.

`.rebase/` è incluso nel file .gitignore, pertanto il branch su cui ti trovi è un dato relativo alla tua macchina
e mai al progetto.

I branch sono normali database PostgreSQL denominati con il nome del branch preceduto dal prefisso `rb_`, quindi `dev_sandbox` nell'esempio precedente corrisponde al database `rb_dev_sandbox` sullo stesso server.

La creazione di un branch **non** modifica il database con cui comunica il progetto. `rebase db branch create` crea la copia e si ferma lì; non viene scritto nulla in `.env`, e il successivo `rebase dev` utilizzerà ancora il database utilizzato in precedenza. Per lavorare su un branch, punta tu stesso la variabile `DATABASE_URL` su di esso — la stringa di connessione è quella già a disposizione, modificando solo il nome del database:

```bash
# .env
DATABASE_URL=postgresql://user:pass@localhost:5432/rb_dev_sandbox
```

---

## Il branching richiede un vero server PostgreSQL

Il branching **non** funziona con il database di sviluppo gestito — il database PGlite a configurazione zero che `rebase dev` avvia quando un progetto non ha alcun `DATABASE_URL`.

PGlite gestisce esattamente un solo database. `CREATE DATABASE ... TEMPLATE` su di esso scrive una voce di catalogo e non copia nulla, quindi il "branch" fa riferimento allo stesso database da cui è stato clonato: le scritture che si ritengono isolate finiranno nel database di sviluppo, e non ci sarà una seconda copia a cui ritornare.

Usa il branching su un server reale — la tua istanza PostgreSQL tramite `DATABASE_URL`, o `rebase dev --docker`.

---

## Best practice e limitazioni

### Utilizzo del disco
Poiché PostgreSQL duplica i file su disco, ogni branch occupa uno spazio pari a quello del database di origine. Se si dispone di un database di produzione da 100 GB, la creazione di 5 branch richiederà ulteriori 500 GB di spazio di archiviazione.
* *Raccomandazione*: Utilizzare database con sottoinsiemi di dati (subsetted) o template leggeri di sviluppo come sorgenti di clonazione anziché cloni completi di produzione.

`rebase db branch prune` è il comando per recuperare lo spazio:

```bash
rebase db branch prune                      # orphans only — always safe
rebase db branch prune --older-than 2w      # and anything older than two weeks
```

Nulla scade a meno che non venga richiesto: un branch può essere l'unica copia del lavoro
di un intero pomeriggio, quindi `--older-than` è opzionale e le età sono arrotondate per difetto; inoltre il comando mostra il suo
piano e richiede conferma prima di rimuovere qualsiasi elemento, a meno che non venga passato `--yes`.

Prune rileva inoltre le due situazioni in cui i branch si disallineano rispetto ai rispettivi metadati: una voce il cui
database è stato eliminato tramite semplice SQL (che `list` continuerebbe a segnalare per sempre),
e un database branch la cui voce non è mai stata registrata (un crash tra le due
istruzioni eseguite da `create`). I database scratch `<db>_dev_diff` di Atlas vengono segnalati
contestualmente, ma rimossi solo con `--include-dev-diff`: non sono branch e
uno di essi potrebbe appartenere a un `db push` in esecuzione proprio in quel momento.

### Compatibilità con pgBouncer
Quando si esegue il deployment dietro pgBouncer o pooler di connessioni, assicurarsi che il pooler supporti le operazioni amministrative sul database. La creazione e l'eliminazione di database aggira i pool standard a livello di transazione e richiede connessioni dirette al server Postgres (utilizzando privilegi utente elevati) tramite la configurazione `adminConnectionString`.

### Query cross-database
Poiché i branch sono database PostgreSQL separati, non è possibile eseguire query SQL `JOIN` tra branch differenti. Tutte le relazioni devono essere contenute nell'ambito del singolo database branch attivo.


## Risorse correlate

- [Comandi CLI](/docs/cli/) — `rebase db branch` e i suoi flag
- [Generazione dello schema](/docs/cli/schema/) — come viene generato lo schema copiato da un branch
- [Ambiente e configurazione](/docs/getting-started/configuration/) — `DATABASE_URL` e le priorità rispetto a un branch selezionato

---
