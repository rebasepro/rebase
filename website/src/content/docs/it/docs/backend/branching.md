---
sourceHash: 297a89400496895a
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

`create --force`
chiude anche la sorgente alle nuove connessioni per la durata della copia
(`ALTER DATABASE … ALLOW_CONNECTIONS false`, eseguito dal database `postgres` del
server) e la riapre in seguito: in caso di errore, e a ogni segnale che può intercettare
(la chiusura del terminale, Ctrl-C, SIGTERM, SIGQUIT). Se viene terminato di colpo
(SIGKILL), lascia la sorgente chiusa fino al successivo comando `rebase db branch`,
uno qualsiasi, che prima la riapre e lo dice;
`ALTER DATABASE "<db>" ALLOW_CONNECTIONS true`, eseguito dal database `postgres`,
fa lo stesso a mano. Finché un create forzato tiene chiusa la sua sorgente, detiene su di
essa un advisory lock nel database `postgres`, così la riapertura lascia stare la
sorgente di una copia in corso, e un secondo create forzato dalla stessa sorgente attende
che il primo finisca. Un client che si
riconnette appena viene disconnesso, come fa un `rebase dev` in esecuzione, non può
quindi rientrare prima che la copia inizi. Per farlo serve il proprietario della sorgente;
senza di esso, e su `delete`, `--force` disconnette le sessioni fino a tre volte prima di
arrendersi. Quando dopo di ciò una sessione è ancora presente, l'errore dice che si sono
riconnesse e di arrestarle, non di passare di nuovo `--force`. Su 0.24 le disconnetteva
una sola volta, e circa un `create --force` su sette con un `rebase dev` in esecuzione
falliva consigliando di rieseguirlo con `--force`.

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
    name         TEXT PRIMARY KEY,              -- Branch name as given (letters, digits, underscores, hyphens)
    db_name      TEXT NOT NULL UNIQUE,          -- Actual PostgreSQL database name (prefixed with 'rb_')
    parent_db    TEXT NOT NULL,                 -- Source database cloned from
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata     JSONB DEFAULT '{}'
);
```

Un server in esecuzione su un branch conserva i branch nel database da cui il branch è stato
copiato. La tabella `rebase.branches` del branch stesso è solo un'istantanea, presa prima che
la sua riga venisse scritta. Quindi `rebase dev` su un checkout [passato a un branch](#integrazione-cli)
imposta `REBASE_BRANCH_PARENT_DATABASE` sul database indicato da `.env`, e un server
con quella variabile legge e scrive lì il registro, e per impostazione predefinita copia da esso i nuovi branch. La scheda Branch
di Studio, su un branch, elenca i branch del database principale, compreso quello corrente, e un branch creato lì
è uno di quelli che `rebase db branch list` mostra.

---

## API programmatica

L'API di branching è esposta tramite il `BranchService` del backend. Di seguito è riportato il riferimento per l'interfaccia principale:

### Creare un branch del database

Genera un nuovo database branch dal database predefinito o da un template sorgente esplicito.

Il database predefinito è quello su cui si trova la connessione del server stesso, oppure
`REBASE_BRANCH_PARENT_DATABASE` quando il server è in esecuzione su un branch. Non è mai
il database indicato da `ADMIN_CONNECTION_STRING`, quando questo è un altro.

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
    database: "rb_feature_oauth",
    parentDatabase: "rebase",
    createdAt: 2026-06-20T22:00:00.000Z,
    sizeBytes: 83886080 // 80 MB
  }
]
*/
```

`database` è il database PostgreSQL che costituisce il branch, come riporta il suo record:
quello a cui connettersi, e quello da passare come `source` per copiare il branch. Non è
il nome del branch (`staging` è il database `rb_staging`).

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
> Protezione di sicurezza: il database principale (il nome del database predefinito configurato nelle stringhe di connessione) è protetto. È il database su cui si trova la connessione del server stesso, oppure `REBASE_BRANCH_PARENT_DATABASE` su un branch. Se si tenta di eliminare il database padre, il `BranchService` solleva un errore `"Cannot delete the main database"` e interrompe l'operazione.

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

# What the branch changed: schema, RLS policies and rows (--json for all of it)
rebase db branch diff dev_sandbox

# Delete a branch
rebase db branch delete dev_sandbox
```

`switch` è ciò che rende utilizzabile un branch. Registra il branch in
`.rebase/branch.json` — un nome, mai una stringa di connessione, affinché le tue credenziali
rimangano esclusivamente in `.env` — e ogni comando `rebase` successivo in quel checkout punterà
quindi al database del branch: `dev`, `db push`, `db migrate`, `db backup`.
Un `rebase dev` già in esecuzione mantiene il database su cui è partito finché non lo
riavvii, e `switch` lo dice.

`rebase db branch
list` segna il branch su cui si trova questo checkout, e `prune` non lo rimuove mai, così
come `delete` si rifiuta di farlo: il piano lo elenca come mantenuto, e dice di lasciarlo
prima con `rebase db branch switch --off`. Su 0.24 `prune --older-than … --yes` lo
eliminava, e il checkout puntava poi ogni comando a un database che non esisteva più.

Si posiziona tra la shell e il file di progetto nell'ordine di risoluzione:

1. `--database-url` sulla riga di comando
2. `DATABASE_URL` nell'ambiente della shell
3. **il branch su cui è posizionato questo checkout**
4. `DATABASE_URL` nel file `.env` del progetto
5. `--docker`, o l'ultimo `rebase dev` eseguito con esso
6. il database di sviluppo gestito

Il livello 5 segue
l'ultimo `rebase dev --docker`, quindi un comando branch eseguito dopo di esso
non ha bisogno di un proprio `--docker`, e un `--docker` che un livello superiore
supera non avvia alcun container e dichiara di essere stato ignorato. Su 0.24
conta solo il flag, e uno superato avvia comunque il container.

Un branch deve avere la precedenza su `.env`, altrimenti il passaggio di branch non avrebbe alcun effetto su qualsiasi progetto che
imposta `DATABASE_URL`; non deve però avere la precedenza sui due livelli superiori, perché un flag specificato su questa
riga di comando è un'istruzione più immediata rispetto a uno switch effettuato in precedenza.

`.rebase/` è incluso nel file .gitignore, pertanto il branch su cui ti trovi è un dato relativo alla tua macchina
e mai relativo al progetto.

In un checkout su cui hai cambiato
branch, `rebase db branch create`, `list`, `info`, `delete` e `prune` operano sul
database principale, dove si trova il registro, e lo dichiarano. `create` copia
comunque il branch su cui ti trovi, a meno che tu non passi `--from`; viene
registrato nel database principale, quindi `list` lo mostra da qualsiasi
checkout. Prima della 0.25 lo faceva solo `list`, e un branch creato da un
checkout con branch cambiato veniva registrato solo nello snapshot del branch.

I branch sono normali database PostgreSQL denominati con il nome del branch preceduto dal prefisso `rb_`, quindi `dev_sandbox` nell'esempio precedente corrisponde al database `rb_dev_sandbox` sullo stesso server.

La creazione di un branch **non** modifica il database con cui comunica il progetto. `rebase db branch create` crea la copia e si ferma lì; non viene scritto nulla in `.env`, e il successivo `rebase dev` utilizzerà ancora il database utilizzato in precedenza. Per lavorare su un branch, passa a esso con `rebase db branch switch <name>`, come sopra. Per raggiungerlo da qualcosa che non è un comando `rebase`, la sua stringa di connessione è quella già a disposizione, modificando solo il nome del database:

```bash
postgresql://user:pass@localhost:5432/rb_dev_sandbox
```

## Esaminare e unire un branch

Un branch è il posto in cui un agente, o una migrazione di cui non sei sicuro, può modificare un database senza toccare quello vero. Prima che qualcosa arrivi al database da cui il branch è stato creato, puoi vedere cosa è cambiato e unirlo da [Studio](/docs/studio/): apri **Branch** e scegline uno.

- **Schema e policy RLS** elenca ogni tabella, colonna, chiave primaria,
  vincolo (unique, chiave esterna, check, exclusion), indice, trigger, policy,
  tipo enum (con le sue etichette), vista e funzione che il branch ha aggiunto, eliminato o
  modificato, come SQL, con la definizione del genitore accanto a quella del branch.
- **Modifiche ai dati** conta, per tabella, le righe che il branch ha inserito, aggiornato ed
  eliminato, abbinate per chiave primaria, e ne mostra fino a 100 per tabella (al
  massimo 1.000 quando ne chiedi di più) con le colonne cambiate. Una colonna
  il cui nome somiglia a una credenziale — `password_hash`, un `*_token`, qualsiasi nome con
  `secret`, un `*_hash` — mostra `[redacted]` al posto del suo valore.

Esaminare un branch richiede lo scope `database:write`, quello che esegue SQL come
proprietario del database: i campioni sono righe di entrambi i database, lette al di fuori della
sicurezza a livello di riga. `database:read` elenca i branch ma non ne legge
le righe.

Lo stesso diff è `rebase db branch diff <name>` in un terminale, `GET /api/admin/branches/<name>/diff` via HTTP, lo strumento MCP `rebase_db_branch_diff` e `admin.diffBranch(name)` nel codice. Le tabelle interne di Rebase (sessioni, cronologia, il registro dei branch) restano fuori.

### Quale lato ha cambiato una riga

Il genitore continua a ricevere scritture mentre si lavora sul branch, quindi «i due database sono diversi» non significa «l'ha cambiato il branch»: una riga che il genitore ha inserito dopo la creazione del branch appare identica a una riga che il branch ha eliminato. Rebase le distingue in base a quando è stata scritta ogni riga. Gli ID di transazione appartengono al server, non a un singolo database, e la copia da template li conserva: una riga scritta dopo la creazione del branch, da una parte o dall'altra, è più recente della transazione che ha creato il database del branch. Quella transazione viene letta quando
il branch viene creato e conservata nel suo record, quindi un successivo `GRANT` o
`ALTER DATABASE` sul database del branch non la sposta.

| La riga del branch | La riga del genitore | Conta come |
| --- | --- | --- |
| scritta dopo la biforcazione | assente | inserita dal branch |
| assente | di prima della biforcazione | eliminata dal branch |
| scritta dopo la biforcazione | di prima della biforcazione | aggiornata dal branch |
| di prima della biforcazione, o assente | scritta dopo la biforcazione, o assente | modifica del genitore: mantenuta |
| scritta dopo la biforcazione | scritta dopo la biforcazione | un **conflitto** |

Due casi si somigliano e vengono letti nel modo che non perde nulla: una riga che il branch ha eliminato e il genitore ha poi modificato viene mantenuta, e una riga che il genitore ha eliminato e il branch ha poi modificato è un inserimento del branch. Un `UPDATE` che scrive i valori che una riga aveva già conta comunque come scrittura.

Un branch creato prima che Rebase conservasse quella transazione la legge dalla riga `pg_database` del database
del branch così com'è ora; qualsiasi cosa che abbia riscritto la riga da allora
la sposta. Quando il punto di biforcazione non si può leggere affatto — un branch di lunga durata
la cui riga è stata congelata da un vacuum — il diff lo segnala e conta ogni differenza come
modifica del branch.

### Cosa fa un'unione

**Unisci** scrive nel genitore le righe che il branch ha inserito, aggiornato ed eliminato. Cosa prevale:

- **Le righe che ha cambiato solo il branch** vengono scritte: inserite, sovrascritte o eliminate.
- **Le righe che ha cambiato solo il genitore** dalla creazione del branch restano esattamente come sono, a meno che una non faccia riferimento a una riga che il branch ha eliminato: in tal caso è un
  conflitto (vedi sotto).
- **Le righe cambiate da entrambi** sono conflitti. Per impostazione predefinita l'unione non scrive nulla; scegli `onConflict: "branch"` per scrivere la riga del branch sopra quella del genitore, o `"target"` per mantenere quella del genitore.
- **Una riga che il branch ha eliminato e a cui le righe più recenti del genitore fanno ancora riferimento** è
  anch'essa un conflitto. Poniamo che il branch abbia eliminato un autore, e che il genitore abbia nel frattempo
  scritto un post di quell'autore: eliminare l'autore sul genitore si propagherebbe a
  quel post, ne porrebbe a null la colonna, oppure fallirebbe sulla chiave esterna. Il diff conta l'
  autore come un conflitto e nomina le righe che vi fanno riferimento (`referencedBy`: la
  tabella, la chiave esterna, il suo `ON DELETE` e quante righe). Per impostazione predefinita
  l'unione rifiuta, indicando la tabella, le righe e la via d'uscita; `"target"` mantiene
  l'autore, e con esso il post; `"branch"` elimina l'autore, lascia che la chiave
  esterna faccia ciò che dichiara, ed elenca in `warnings` ciò che ha raggiunto.
- **Le modifiche a schema e policy non vengono mai unite.** Appartengono alle tue collection e alle loro migrazioni: applicale con `rebase db push` (o `migrate`), poi unisci le righe.

Una tabella le cui righe non si possono abbinare blocca l'unione: una che il branch ha aggiunto o eliminato, una le cui colonne o chiave primaria differiscono tra i due, una senza chiave primaria, o una con più di 100.000 righe su un lato. I suoi conteggi risultano 0,
perché non si sa quali righe siano cambiate; `rowCounts` indica il numero di righe di ciascun lato.
Una tabella simile che ha cambiato solo il genitore — il branch non ne ha scritto alcuna riga, e quelle
precedenti alla biforcazione sono le stesse — non è bloccata.
Passa `skipBlocked` (in Studio, spunta **Unisci le altre tabelle**) per unire il
resto e lasciare stare quelle.

Anche una tabella riscritta dalla creazione del branch è bloccata (`TABLE_REWRITTEN`).
Un cambio di tipo di colonna, un `ADD COLUMN` con un default volatile, `VACUUM FULL` o
`CLUSTER` riscrivono ogni riga da capo, quindi ogni riga risulta scritta dopo la biforcazione e
non si può più dire quale lato abbia cambiato cosa. Quando il branch ha cambiato il tipo di una colonna,
unisci le sue righe prima di applicare quella modifica al genitore, oppure ricrea
il branch dopo di essa.

Ogni scrittura avviene in un'unica istruzione sul genitore — tutto o niente, chiavi esterne verificate alla fine. Un'unione porta il `fingerprint` del diff che hai esaminato e non scrive nulla se uno dei due database è cambiato da allora: ricarica il diff e guardalo di nuovo. Le sequenze vengono portate oltre ogni id inserito dall'unione.

```typescript
const diff = await admin.diffBranch("agent_run_17");
// …review diff.schema and diff.data…
const result = await admin.mergeBranch("agent_run_17", {
    expectedFingerprint: diff.fingerprint,
    onConflict: "abort" // or "branch", or "target"
});
```

L'unione non è, di proposito, uno strumento MCP: un agente propone sul suo branch, e una persona unisce.

---

## Il branching richiede un vero server PostgreSQL

Il branching **non** funziona con il database di sviluppo gestito — il database PGlite a configurazione zero che `rebase dev` avvia quando un progetto non ha alcun `DATABASE_URL`.

PGlite gestisce esattamente un solo database. `CREATE DATABASE ... TEMPLATE` su di esso scrive una voce di catalogo e non copia nulla, quindi il "branch" fa riferimento allo stesso database da cui è stato clonato: le scritture che si ritengono isolate finiranno nel database di sviluppo, e non ci sarà una seconda copia a cui ritornare.

Usa il branching su un server reale — la tua istanza PostgreSQL tramite `DATABASE_URL`, o `rebase dev --docker`, che i comandi branch poi seguono.

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

- [Comandi del database](/docs/cli/database/#rebase-db-branch) — `rebase db branch` e i suoi flag
- [Generazione dello schema](/docs/cli/schema/) — come viene generato lo schema copiato da un branch
- [Ambiente e configurazione](/docs/getting-started/configuration/) — `DATABASE_URL` e le priorità rispetto a un branch selezionato
