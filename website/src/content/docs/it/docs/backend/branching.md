---
sourceHash: f9ad18cf03580c13
title: Database Branching
sidebar_label: Branching
description: Crea branch di database isolati per sviluppo, staging e test utilizzando CREATE DATABASE ... TEMPLATE di PostgreSQL — copie istantanee e ad alta fedeltà con zero tempi di inattività.
---

## Panoramica

Il database branching ti consente di creare **copie istantanee e isolate** dell'intero database (sia schema che dati) per eseguire in sicurezza attività di sviluppo, test di migrazione e procedure di QA. 

Sfruttando i template nativi di PostgreSQL, Rebase effettua il provisioning dei database clonati a livello di filesystem. Ciò significa che ottieni una replica ad alta fedeltà contenente tutte le tabelle, gli indici, i tipi personalizzati, i vincoli e le policy di Row-Level Security (RLS) senza alcun sovraccarico di trasferimento di rete o ritardo nella configurazione dello schema.

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

## Dietro le quinte: Creazione di template in PostgreSQL

Quando viene creato un branch del database, il `BranchService` di Rebase esegue il seguente SQL:

```sql
CREATE DATABASE "rb_feature_auth" TEMPLATE "rebase";
```

PostgreSQL elabora questa operazione copiando le directory del filesystem sottostante che contengono i file del database di origine. Ciò offre:
- **Cloni in meno di un secondo**: non viene eseguita alcuna generazione di SQL o caricamento di dati.
- **Schemi e dati identici**: ogni riga, indice e vincolo viene duplicato istantaneamente.
- **Isolamento completo**: la modifica dello schema o l'inserimento di record nel branch non ha alcun impatto sul database di origine.

### La protezione dalle limitazioni di connessione

PostgreSQL richiede che **non esistano altre connessioni attive** sul database template (di origine) durante l'esecuzione di un comando `CREATE DATABASE ... TEMPLATE`.

Per prevenire errori, il `DatabasePoolManager` di Rebase esegue un processo attivo di disconnessione (eviction) prima di clonare o eliminare un branch:
1. **Loop di eviction**: chiude e disconnette automaticamente tutti i pool inattivi che puntano al database di destinazione all'interno del contesto dell'applicazione Rebase.
2. **Blocco delle connessioni esterne**: se client esterni (come DBeaver, pgAdmin o processi di backend esterni) mantengono transazioni attive sul database di origine, PostgreSQL rifiuterà l'operazione di template con un errore `"being accessed by other users"`.

L'errore specifica cosa è connesso anziché lasciarlo indovinare:

```
Cannot create branch: the source database "leadgen" has active connections.
  Connected right now:
    2 × psql
  A running `rebase dev` is the usual one — stop it, or re-run with --force to
  disconnect them for you.
```

`--force` termina tali sessioni prima dell'applicazione del template, sia su `create` che su `delete`. Non termina mai la sessione che sta eseguendo il comando stesso.

Inoltre, `create --force` blocca le nuove connessioni verso la sorgente per tutta la durata della copia (`ALTER DATABASE … ALLOW_CONNECTIONS false`, eseguito dal database `postgres` del server) e la riapre successivamente: in caso di errore e su qualsiasi segnale intercettabile (chiusura del terminale, Ctrl-C, SIGTERM, SIGQUIT). In caso di terminazione forzata immediata (SIGKILL), lascia la sorgente chiusa fino al successivo comando `rebase db branch`, uno qualsiasi di essi, che prima la riapre segnalandolo; `ALTER DATABASE "<db>" ALLOW_CONNECTIONS true`, eseguito dal database `postgres`, fa la stessa cosa manualmente. Mentre una creazione forzata mantiene la sorgente chiusa, detiene un advisory lock su di essa nel database `postgres`, in modo che la riapertura non interferisca con la sorgente di una copia in corso e una seconda creazione forzata dalla stessa sorgente attenda il completamento della prima. Un client che si riconnette non appena viene disconnesso, come fa un'istanza in esecuzione di `rebase dev`, non può quindi intrufolarsi nuovamente prima dell'avvio della copia. Ciò richiede l'owner della sorgente; senza di esso, e su `delete`, `--force` disconnette le sessioni fino a tre volte prima di arrendersi. Se una sessione è ancora presente dopo questi tentativi, l'errore segnala che si sono riconnessi e richiede di fermarli, invece di eseguire nuovamente `--force`.

`DatabasePoolManager` disconnette i propri pool inattivi prima della clonazione o dell'eliminazione — ma solo i pool **all'interno del processo che sta svolgendo il lavoro**. `rebase db branch` viene eseguito come processo indipendente, quindi questo non ha effetto su nient'altro sul tuo computer:

- **Un'istanza di `rebase dev` in esecuzione blocca il branching.** Questo è il caso comune, non un caso limite: la necessità di un branch e l'esecuzione dell'app si verificano solitamente nello stesso momento. Arresta il dev server, crea il branch e riavvialo.
- **Lo stesso vale per qualsiasi altro client.** DBeaver, pgAdmin, una sessione `psql`, una seconda istanza dell'app — PostgreSQL rifiuta l'operazione con `is being accessed by other users` e tali connessioni devono essere chiuse manualmente.

Non c'è modo di aggirare questo comportamento all'interno di PostgreSQL; `CREATE DATABASE ... TEMPLATE` è una copia a livello di filesystem e il template deve rimanere quiescente per tutta la durata.

---

## Schema dei metadati

Le configurazioni dei branch sono memorizzate nel database predefinito nella tabella `rebase.branches`, sottoposta a provisioning durante il bootstrapping:

```sql
CREATE SCHEMA IF NOT EXISTS rebase;

CREATE TABLE IF NOT EXISTS rebase.branches (
    name         TEXT PRIMARY KEY,              -- Branch name as given (letters, digits, underscores, hyphens)
    db_name      TEXT NOT NULL UNIQUE,          -- Actual PostgreSQL database name (prefixed with 'rb_')
    parent_db    TEXT NOT NULL,                 -- Source database cloned from
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata     JSONB DEFAULT '{}'
);
```

Un server in esecuzione su un branch mantiene i branch nel database da cui il branch è stato copiato. La tabella `rebase.branches` propria del branch è solo uno snapshot, scattato prima che la sua riga venisse scritta. Di conseguenza, `rebase dev` su un checkout con [switch](#integrazione-cli) imposta `REBASE_BRANCH_PARENT_DATABASE` sul database specificato nel `.env`, e un server con tale variabile legge e scrive il registro in quella posizione, copiando da esso i nuovi branch per impostazione predefinita. Il pannello Branches di Studio su un branch elenca i branch del database principale, compreso quello corrente, e un branch creato lì è visibile in `rebase db branch list`.

---

## API programmatica

L'API di branching è esposta tramite il `BranchService` del backend. Di seguito è riportato un riferimento dell'interfaccia principale:

### Creare un branch del database

Genera un nuovo branch del database a partire dal database predefinito o da un template sorgente esplicito.

Il valore predefinito è il database su cui risiede la connessione del server stesso, oppure `REBASE_BRANCH_PARENT_DATABASE` quando il server è in esecuzione su un branch. Non è mai il database specificato da `ADMIN_CONNECTION_STRING`, qualora fosse diverso.

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

Recupera l'elenco dei branch registrati insieme alle loro dimensioni fisiche interrogate tramite la funzione di sistema `pg_database_size` di PostgreSQL.

```typescript
const branches = await admin.listBranches();
/*
Output:
[
  {
    name: "feature_oauth",
    database: "rb_feature_oauth",
    parentDatabase: "rebase",
    createdAt: 2026-06-20T22:00:00.000Z,
    sizeBytes: 83886080 // 80 MB
  }
]
*/
```

`database` è il database PostgreSQL corrispondente al branch, come indicato dal suo record: ciò a cui connettersi e cosa passare come `source` per copiare il branch. Non è il nome del branch (`staging` è il database `rb_staging`).

### Ottenere informazioni sul branch

Recupera i metadati per un singolo branch. Se il branch esiste, il servizio tenta di interrogare il suo utilizzo corrente del disco fisico:

```typescript
const info = await admin.getBranchInfo("feature_oauth");
```

### Eliminare un branch

Rimuove (DROP) il database di destinazione dal server e ripulisce il relativo record nella tabella dei metadati `rebase.branches`.

```typescript
await admin.deleteBranch("feature_oauth");
```

> [!CAUTION]
> Protezione di sicurezza: il database principale (il nome del database predefinito configurato nelle stringhe di connessione) è protetto. Questo è il database su cui risiede la connessione del server stesso, o `REBASE_BRANCH_PARENT_DATABASE` su un branch. Se tenti di eliminare il database genitore, `BranchService` genera un errore `"Cannot delete the main database"` e interrompe l'operazione.

---

## Integrazione CLI

I branch del database possono essere gestiti direttamente utilizzando la CLI di Rebase.

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

# What the branch changed: schema, RLS policies and rows (--json for all of it)
rebase db branch diff dev_sandbox

# Delete a branch
rebase db branch delete dev_sandbox
```

`switch` è ciò che rende utilizzabile un branch. Registra il branch in `.rebase/branch.json` — un nome, mai una stringa di connessione, in modo che le tue credenziali rimangano unicamente in `.env` — e ogni comando `rebase` in quel checkout fa quindi riferimento al database del branch: `dev`, `db push`, `db migrate`, `db backup`. Un'istanza di `rebase dev` già in esecuzione mantiene il database con cui è stata avviata finché non viene riavviata, e `switch` lo segnala.

`rebase db branch list` contrassegna il branch su cui si trova questo checkout, e `prune` non lo rimuove mai, così come `delete` si rifiuta di farlo: il piano lo elenca come mantenuto e segnala di abbandonarlo prima con `rebase db branch switch --off`.

Si colloca tra la shell e il file di progetto nell'ordine di risoluzione:

1. `--database-url` sulla riga di comando
2. `DATABASE_URL` nell'ambiente della shell
3. **il branch a cui questo checkout è collegato tramite switch**
4. `DATABASE_URL` nel file `.env` del progetto
5. `--docker`, o l'ultimo `rebase dev` eseguito con questo flag
6. il database di sviluppo gestito

Il livello 5 segue l'ultimo `rebase dev --docker`, quindi un comando di branch successivo non necessita di un proprio `--docker`, e un `--docker` superato in priorità da un livello superiore non avvia alcun container e segnala di essere stato ignorato.

Un branch deve avere precedenza su `.env`, altrimenti lo switch non avrebbe alcun effetto su qualsiasi progetto che imposta `DATABASE_URL`; non deve invece prevalere sui due livelli superiori, perché un flag su questa riga di comando è un'istruzione più immediata rispetto a uno switch effettuato in precedenza.

`.rebase/` è incluso in .gitignore, quindi il branch su cui ti trovi è un'informazione legata alla tua macchina e mai al progetto.

Su un checkout sottoposto a switch, i comandi `rebase db branch create`, `list`, `info`, `delete` e `prune` operano sul database principale, dove risiede il registro, e lo segnalano. `create` continua a copiare il branch su cui ti trovi a meno che non si passi `--from`; viene registrato nel database principale, quindi `list` lo mostra da qualsiasi checkout.

I branch sono normali database PostgreSQL denominati in base al branch con un prefisso `rb_`, quindi l'esempio `dev_sandbox` sopra corrisponde al database `rb_dev_sandbox` sullo stesso server.

Creare un branch **non** modifica il database con cui comunica il tuo progetto. `rebase db branch create` crea la copia e si ferma lì; nulla viene scritto in `.env`, e il successivo `rebase dev` userà ancora il database usato in precedenza. Per lavorare su un branch, passa ad esso con `rebase db branch switch <name>`, come sopra. Per raggiungerlo da qualsiasi cosa non sia un comando `rebase`, la sua stringa di connessione è quella già in tuo possesso con il nome del database sostituito:

```bash
postgresql://user:pass@localhost:5432/rb_dev_sandbox
```

---

## Revisione e merge di un branch

Un branch è l'ambiente in cui un agent, o una migrazione di cui non sei sicuro, può modificare un database senza toccare quello reale. Prima che qualsiasi modifica raggiunga il database da cui è stato creato il branch, puoi vedere cosa è cambiato ed eseguirne il merge da [Studio](/docs/studio/): apri **Branches** e selezionane uno.

- **Schema & RLS policies** elenca ogni tabella, colonna, chiave primaria, vincolo (unique, foreign key, check, exclusion), indice, trigger, policy, tipo enum (con le relative label), vista e funzione che il branch ha aggiunto, eliminato o modificato, sotto forma di SQL, affiancando la definizione del genitore a quella del branch.
- **Data changes** conta, per tabella, le righe che il branch ha inserito, aggiornato ed eliminato, confrontate tramite chiave primaria, e ne mostra fino a 100 per tabella (al massimo 1.000 su richiesta specifica) con le colonne modificate. Una colonna con un nome riconducibile a una credenziale — `password_hash`, un `*_token`, qualsiasi elemento contenente `secret`, un `*_hash` — mostra `[redacted]` al posto del suo valore.

La revisione di un branch richiede l'ambito (scope) `database:write`, ovvero quello che esegue SQL come owner del database: i campioni sono righe di entrambi i database, lette al di fuori della row-level security. `database:read` elenca i branch ma non ne legge le righe.

Lo stesso diff è disponibile con `rebase db branch diff <name>` nel terminale, tramite `GET /api/admin/branches/<name>/diff` via HTTP, con il tool MCP `rebase_db_branch_diff` e con `admin.diffBranch(name)` nel codice. Le tabelle interne di Rebase (sessioni, cronologia, registro dei branch) vengono escluse.

### Quale lato ha modificato una riga

Il genitore continua a ricevere scritture mentre si lavora sul branch, quindi "i due database differiscono" non equivale a "il branch l'ha modificato": una riga inserita dal genitore dopo la creazione del branch ha esattamente lo stesso aspetto di una riga eliminata dal branch. Rebase le distingue in base al momento in cui ciascuna riga è stata scritta. Gli ID delle transazioni appartengono al server, non a un singolo database, e la copia da template li mantiene, per cui una riga scritta dopo la creazione del branch — su entrambi i lati — è più recente della transazione che ha creato il database del branch. Quella transazione viene letta al momento della creazione del branch e conservata nel suo record, cosicché un successivo `GRANT` o `ALTER DATABASE` sul database del branch non la modifichi.

| Riga del branch | Riga del genitore | Conteggiata come |
| --- | --- | --- |
| scritta dopo il fork | assente | inserita dal branch |
| assente | precedente al fork | eliminata dal branch |
| scritta dopo il fork | precedente al fork | aggiornata dal branch |
| precedente al fork, o assente | scritta dopo il fork, o assente | modifica del genitore: mantenuta |
| scritta dopo il fork | scritta dopo il fork | un **conflitto** |

Due casi appaiono simili e vengono interpretati nella modalità che non perde alcun dato: una riga eliminata dal branch e successivamente modificata dal genitore viene mantenuta, mentre una riga eliminata dal genitore e successivamente modificata dal branch costituisce un inserimento del branch. Un'`UPDATE` che scrive i valori che una riga possedeva già conta comunque come scrittura.

Un branch creato prima che Rebase tenesse traccia di tale transazione la legge dalla riga `pg_database` del database del branch nello stato attuale; qualsiasi operazione che abbia riscritto la riga da allora ne modifica il riferimento. Quando il punto di fork non può essere letto affatto — un branch di lunga durata la cui riga è stata congelata da un vacuum — il diff lo segnala e attribuisce ogni differenza al branch.

### Cosa fa un merge

Il **Merge** scrive nel genitore le righe che il branch ha inserito, aggiornato ed eliminato. Chi prevale:

- **Le righe modificate solo dal branch** vengono scritte: inserite, sovrascritte o eliminate.
- **Le righe modificate solo dal genitore** da quando è stato creato il branch vengono lasciate esattamente come sono — a meno che una di esse non faccia riferimento a una riga eliminata dal branch, il che costituisce un conflitto (vedere sotto).
- **Le righe modificate da entrambi** costituiscono conflitti. Per impostazione predefinita il merge non scrive alcunché; scegli `onConflict: "branch"` per sovrascrivere la riga del genitore con quella del branch, oppure `"target"` per mantenere quella del genitore.
- **Anche una riga eliminata dal branch a cui fanno ancora riferimento righe più recenti del genitore** costituisce un conflitto. Supponiamo che il branch abbia eliminato un autore e che il genitore abbia nel frattempo inserito un post associato ad esso: l'eliminazione dell'autore sul genitore si propagherebbe a cascata su quel post, imposterebbe a null la colonna o fallirebbe a causa della foreign key. Il diff conta l'autore come conflitto e specifica le righe che vi fanno riferimento (`referencedBy`: la tabella, la foreign key, la sua clausola `ON DELETE` e il numero di righe). Per impostazione predefinita il merge rifiuta l'operazione, indicando la tabella, le righe e la soluzione; `"target"` mantiene l'autore, e con esso il post; `"branch"` elimina l'autore, lascia che la foreign key applichi la propria azione e include gli elementi interessati in `warnings`.
- **Le modifiche allo schema e alle policy non vengono mai unite tramite merge.** Esse appartengono alle definizioni delle tabelle e alle relative migrazioni: applicale con `rebase db push` (o `migrate`), quindi esegui il merge delle righe.

Una tabella le cui righe non possono essere associate blocca il merge: una tabella aggiunta o eliminata dal branch, una in cui le colonne o la chiave primaria differiscono tra i due lati, una priva di chiave primaria o una con più di 100.000 righe su un lato. I suoi conteggi indicano 0, poiché non è possibile stabilire quali righe siano cambiate; `rowCounts` fornisce il numero di righe di ciascun lato. Una tabella di questo tipo modificata solo dal genitore — il branch non ha modificato alcuna delle sue righe e quelle precedenti al fork sono identiche — non viene bloccata. Passa `skipBlocked` (in Studio, seleziona **Merge the other tables**) per unire il resto e tralasciare tali tabelle.

Anche una tabella riscritta dopo la creazione del branch viene bloccata (`TABLE_REWRITTEN`). La modifica del tipo di una colonna, un `ADD COLUMN` con un valore predefinito volatile, `VACUUM FULL` o `CLUSTER` riscrive ogni riga da zero, pertanto ogni riga risulta scritta successivamente e non è più possibile determinare quale lato abbia apportato le modifiche. Se il branch ha modificato il tipo di una colonna, esegui il merge delle sue righe prima di applicare tale modifica al genitore, oppure ricrea il branch successivamente.

Ogni scrittura avviene in un'unica istruzione sul genitore — tutto o niente, con le foreign key verificate al termine. Un merge include il `fingerprint` del diff revisionato e non scrive nulla se uno dei due database è cambiato nel frattempo: ricarica il diff e ricontrolla. Le sequenze vengono avanzate oltre gli ID inseriti dal merge.

```typescript
const diff = await admin.diffBranch("agent_run_17");
// …review diff.schema and diff.data…
const result = await admin.mergeBranch("agent_run_17", {
    expectedFingerprint: diff.fingerprint,
    onConflict: "abort" // or "branch", or "target"
});
```

Il merge non è deliberatamente uno strumento MCP: un agent propone sul proprio branch e una persona esegue il merge.

---

## Il branching richiede un vero server PostgreSQL

Il branching **non** funziona con il database di sviluppo gestito — il database PGlite a configurazione zero che `rebase dev` avvia quando un progetto non ha un `DATABASE_URL`.

PGlite gestisce esattamente un solo database. `CREATE DATABASE ... TEMPLATE` su di esso scrive una voce nel catalogo e non copia nulla, quindi il "branch" fa capo al database da cui è stato clonato: le scritture che ritieni isolate finiscono nel tuo database di sviluppo e non c'è una seconda copia a cui tornare.

Usa il branching su un vero server — la tua istanza di PostgreSQL tramite `DATABASE_URL`, oppure `rebase dev --docker`, che i comandi di branch seguiranno automaticamente.

---

## Best practice e limitazioni

### Utilizzo del disco
Poiché PostgreSQL duplica i file sul disco, ciascun branch consuma uno spazio pari a quello del database di origine. Se disponi di un database di produzione da 100 GB, la creazione di 5 branch richiederà ulteriori 500 GB di spazio di archiviazione. 
* *Raccomandazione*: utilizza database ridotti a un sottoinsieme (subset) o template di sviluppo leggeri come sorgenti di clonazione anziché cloni completi della produzione.

`rebase db branch prune` è il modo per recuperare lo spazio:

```bash
rebase db branch prune                      # orphans only — always safe
rebase db branch prune --older-than 2w      # and anything older than two weeks
```

Nulla scade a meno che non venga richiesto esplicitamente: un branch può essere l'unica copia del lavoro di un pomeriggio, quindi `--older-than` è facoltativo e le età vengono arrotondate per difetto; inoltre il comando mostra il proprio piano e chiede conferma prima di rimuovere qualsiasi elemento, a meno che non si passi `--yes`.

Inoltre, `prune` rileva i due modi in cui i branch si disallineano dai rispettivi metadati — una voce il cui database è stato eliminato tramite SQL semplice (che `list` continuerebbe a segnalare indefinitamente) e un database di branch la cui voce non è mai stata registrata (un arresto anomalo tra le due istruzioni eseguite da `create`). I database temporanei di Atlas `<db>_dev_diff` vengono segnalati contestualmente ma rimossi solo con `--include-dev-diff`: non sono branch e uno di essi potrebbe appartenere a un `db push` attualmente in esecuzione.

### Compatibilità con pgBouncer
Quando si effettua il deployment dietro pgBouncer o connection pooler, assicurati che il pooler supporti le operazioni amministrative sul database. La creazione e l'eliminazione di database bypassano i pool standard a livello di transazione e richiedono connessioni dirette al server Postgres (utilizzando privilegi utente elevati) tramite la configurazione `adminConnectionString`.

### Query cross-database
Poiché i branch sono database PostgreSQL separati, non è possibile eseguire istruzioni SQL `JOIN` tra branch diversi. Tutte le relazioni devono essere contenute nell'ambito del singolo database di branch attivo.


## Correlati

- [Comandi del database](/docs/cli/database/#rebase-db-branch) — `rebase db branch` e i suoi flag
- [Generazione dello schema](/docs/cli/schema/) — come viene prodotto lo schema copiato da un branch
- [Ambiente e configurazione](/docs/getting-started/configuration/) — `DATABASE_URL` e le priorità di un branch sottoposto a switch
