---
sourceHash: 98d9c2872375ef18
title: Generazione dello schema
sidebar_label: Generazione dello schema
description: Genera schemi Drizzle ORM dalle tabelle in backend/schema, crea migrazioni SQL, esegui l'introspezione di un database esistente in file defineTable e mantieni il tuo database sincronizzato con la CLI di Rebase.
---

## Panoramica

<span class="since-badge" data-since="0.31">Da 0.31</span>

Rebase utilizza una pipeline **schema-as-code** in cui le tabelle dichiarate con
`defineTable` in `backend/schema/` rappresentano l'unica fonte di verità. La CLI
le trasforma attraverso una pipeline deterministica:

```
Tables (backend/schema) → Drizzle Schema → SQL Migrations → PostgreSQL
```

Questa pagina illustra tutti i comandi CLI coinvolti in tale pipeline.

## La pipeline

### 1. Tabelle → Schema Drizzle

<span class="since-badge" data-since="0.31">Da 0.31</span>

Le tabelle esportate da `backend/schema/index.ts` descrivono colonne, tipi, relazioni,
enum e la sicurezza a livello di riga (row-level security). Ciascuno dei comandi seguenti le legge tramite il loader
da cui si avvia il backend, quindi uno schema che non compila — una tabella senza
`rls`, `"inherit"` senza `defaultRls`, un `defineTable` non esportato
dall'index — interrompe il comando con un `SchemaDefinitionError` indicando ciascun problema,
e non viene scritto nulla. Il comando `schema generate` genera a partire da esse un file di
schema Drizzle ORM.

Ogni comando che legge lo schema accetta `--schema-dir <dir>` per i progetti
che conservano le tabelle altrove; il valore predefinito è `backend/schema`, oppure la
chiave `tables` dell'app backend in `rebase.json`. Il flag pre-0.31 `--collections` / `-c`
viene rifiutato con un messaggio che indica il codemod
([`rebase migrate collections-to-tables`](#rebase-migrate)), e lo stesso vale per un
progetto che contiene ancora `config/collections`.

### 2. Schema Drizzle → Migrazioni

A partire dallo schema Drizzle generato, `db generate` calcola le differenze (diff) rispetto alle migrazioni già presenti in `backend/drizzle/migrations/`, rieseguite su un database temporaneo (scratch database), e produce file di migrazione SQL provvisti di timestamp. Non legge mai il tuo database: una colonna già aggiunta all'avvio o tramite `db push` risulterà comunque come `ADD COLUMN`.

### 3. Migrazioni → PostgreSQL

Il comando `db migrate` applica le migrazioni in sospeso al tuo database PostgreSQL.

## Comandi

### `rebase schema generate`

<span class="since-badge" data-since="0.31">Da 0.31</span>

Genera un file di schema Drizzle ORM a partire dalle tue tabelle:

```bash
rebase schema generate
```

**Cosa fa:**
- Legge le tabelle esportate da `backend/schema/index.ts`
- Genera `backend/src/schema.generated.ts` con le definizioni delle tabelle, le enum e le relazioni Drizzle

**Opzioni:**

| Flag | Descrizione |
|------|-------------|
| `--schema-dir` | La directory dello schema (predefinita: `backend/schema`); i percorsi relativi vengono risolti a partire dal punto in cui esegui il comando |
| `--output, -o` | Percorso di output per il file di schema generato; i percorsi relativi vengono risolti a partire dal punto in cui esegui il comando |
| `--watch, -w` | Controlla le modifiche e rigenera automaticamente |

La **modalità watch** è utile durante lo sviluppo — modifica il file di una tabella e lo schema si rigenera all'istante:

```bash
rebase schema generate --watch
```

### `rebase schema stale`

Verifica se lo schema generato corrisponde ancora alle tabelle:

```bash
rebase schema stale          # report, and exit 1 if anything is stale
rebase schema stale --fix    # regenerate the file instead
```

**Cosa fa:**
- Esegue il rendering di ciò che generano le tabelle in `backend/schema/` e lo confronta, dichiarazione per dichiarazione, con `backend/src/schema.generated.ts`
- Segnala ciascuna differenza — una tabella mancante, una colonna con tipo modificato, un'etichetta enum rimossa o chiavi esterne denominate secondo le convenzioni di una versione precedente — ed esce con codice diverso da zero
- Con `--fix`, rigenera il file invece di limitarsi a segnalare le differenze

`rebase dev` mantiene il file aggiornato autonomamente, quindi questo è il controllo ideale per una build
o uno step di CI. Accetta `--schema-dir` e `--output` esattamente come
`rebase schema generate`.

### `rebase schema reconcile`

<span class="since-badge" data-since="0.31">Da 0.31</span>

Rimuovi i vincoli e cancella ciò che l'avvio (boot) non gestisce, dopo aver esaminato il piano:

```bash
rebase schema reconcile                         # relax NOT NULL on columns made nullable or removed
rebase schema reconcile --drop voice_cache.wav  # and drop a column no table declares
```

**Cosa fa:**
- Richiede al backend in esecuzione di pianificare le modifiche rispetto al proprio database. Questo corrisponde al backend a cui puntano `.env` e il link cloud, quindi funziona su Rebase Cloud, dove nient'altro può raggiungere il database.
- Pianifica un `DROP NOT NULL` per ogni colonna che una tabella dichiara nullable ma che il database richiede ancora come obbligatoria.
- Elenca ogni colonna non dichiarata da alcuna tabella. Una colonna `NOT NULL` senza valore predefinito blocca qualsiasi inserimento, quindi viene anch'essa resa nullable (relaxed), preservandone i dati. Rimuove solo le colonne specificate con `--drop <table>.<column>` e mostra quante righe contengono un valore in ciascuna di esse.
- Applica le modifiche dopo aver digitato `yes`. Il server esegue il piano solo se corrisponde al digest di quello visualizzato; pertanto, se nel frattempo il database o le tabelle sono cambiati, l'operazione viene rifiutata ed è necessario riesaminarla. `--yes` salta la richiesta di conferma.

Il boot si limita esclusivamente ad aggiungere, quindi dopo aver rimosso una colonna dal relativo `defineTable`, la colonna rimane nel database insieme ai suoi dati. Una colonna `NOT NULL` priva di default provocherebbe il fallimento di ogni inserimento, e il log del boot suggerisce questo comando: senza `--drop` per conservare i dati, oppure con esso per rimuovere la colonna. Distribuisci (deploy) prima la modifica alla tabella, poiché reconcile pianifica rispetto a ciò che il backend sta eseguendo. Richiede `REBASE_SERVICE_KEY` in `.env`. In locale, `rebase db push` copre la stessa esigenza tramite il suo controllo sulle modifiche distruttive (destructive-change gate).

### `rebase schema introspect`

<span class="since-badge" data-since="0.31">Da 0.31</span>

Genera file `defineTable` a partire da un database PostgreSQL esistente:

```bash
rebase schema introspect
```

**Cosa fa:**
- Si connette al database di questo progetto, quello mostrato da `rebase db url` (se si tratta di quello gestito, viene avviato se necessario); `--database-url` ne indica un altro, e `--docker` utilizza quello di compose
- Legge ogni tabella, colonna, tipo, chiave esterna e policy, e genera
  `backend/schema/<table>.ts` — un `defineTable` per tabella — e il file
  `backend/schema/index.ts` che le esporta (unendole a un index già
  esistente)
- Dichiara ogni colonna con il rispettivo tipo Postgres: `col.uuid()`, `col.varchar({ length })`,
  `col.numeric({ precision, scale })`, un'enum con le relative etichette e il vero nome del tipo
  (un `pgEnum` quando il tipo è condiviso), un array come `<item>.array()`,
  `col.vector({ dimensions })`, chiavi identity e serial, valori predefiniti — scritti
  nella sintassi di Drizzle. Un tipo non riconosciuto da alcun builder diventa
  `col.custom({ dataType: "<sql type>" })`, che Rebase restituisce esattamente come
  ricevuto dal driver; `db generate` e `db push` lo rifiuteranno finché il planner
  non sarà in grado di gestirlo
- Dichiara la colonna di chiave esterna, il `belongsTo` su di essa e il relativo
  `hasMany` inverso sulla destinazione; una tabella di giunzione diventa un `manyToMany`, con le proprie
  colonne nel `pivot`
- Legge le policy di sicurezza a livello di riga (RLS) di ciascuna tabella nel rispettivo `rls`: nome,
  comando, modalità, lista `TO`, `USING` e `WITH CHECK`. Le policy
  `<table>_default_*` aggiunte automaticamente da Rebase vengono escluse, affinché il successivo `db push`
  ricrei ciascuna policy esattamente com'era. Una tabella con RLS abilitata ma senza policy viene
  scritta come `rls: "admin-only"`
- Legge ogni espressione (lo `USING` di una policy, un CHECK, un default di colonna) all'interno
  del `search_path` utilizzato dal server, ovvero `public`; pertanto, una funzione nello schema `rebase`
  viene scritta come `rebase.roles()`
- Converte un CHECK interpretabile (`total >= 0`) nel `.validate()` della colonna,
  mantenendo il vincolo vero e proprio nel database, dove il push successivo
  continuerà a conservarlo
- Inserisce ciò che non è stato possibile interpretare con certezza in un commento all'inizio del file
  della tabella e sul terminale — un insieme chiuso di stringhe su una colonna di testo, una
  colonna generata la cui espressione non è stata letta, un tipo personalizzato — descrivendo le
  conseguenze di un eventuale push
- Con `--data-inference`, campiona fino a 100 righe per tabella e scrive le informazioni relative alla
  presentazione — titoli, icone, board, ordinamenti, opzioni dei campi — in
  `frontend/src/cms/<table>.tsx` come `customizeTable`, purché il frontend del
  progetto dipenda da `@rebasepro/cms`. Un progetto headless non ne riceve alcuna
- Se eseguito su un database non attivo, mostra lo stesso banner di
  `db push`, una sola volta, senza creare nulla. Mostra la directory di output come
  percorso assoluto

**Opzioni:**

| Flag | Descrizione |
|------|-------------|
| `--schema-dir` | Dove scrivere i file delle tabelle (predefinito: `backend/schema`). `--output` è stato rimosso |
| `--schema` | Lo schema Postgres da leggere (predefinito: `public`) |
| `--force, -f` | Sovrascrive i file delle tabelle già esistenti; in sua assenza, i file esistenti vengono saltati |
| `--database-url` | Legge questo database anziché quello del progetto |
| `--docker` | Legge il database compose, avviandolo se necessario |
| `--data-inference` / `--no-data-inference` | Campiona fino a 100 righe per tabella per rilevare formati, vincoli e impostazioni del pannello, oppure legge solo la struttura. In assenza di entrambi i flag viene richiesta conferma interattiva; senza terminale, legge solo la struttura |

Questo comando è utile quando si adotta Rebase su un database esistente: esegui prima
l'introspezione e poi modifica le tabelle generate. Una tabella con row-level security disattivata viene
scritta come qualsiasi altra, con il suo `rls`; il push attiverà l'RLS e la
dry run lo segnalerà. Un backend in esecuzione senza alcun `backend/schema`
serve invece direttamente il database — consulta [Solo backend](/docs/getting-started/headless/).

### `rebase db push`

Invia le modifiche allo schema direttamente al database senza file di migrazione:

```bash
rebase db push
```

**Cosa fa:**
- Legge lo schema Drizzle generato
- Applica le modifiche direttamente al database (CREATE, ALTER, DROP)
- Esegue prima una simulazione (dry-run) del piano e si interrompe prima di qualsiasi operazione distruttiva per i dati:
  una tabella, colonna, schema, vista o tipo rimossi, un `TRUNCATE`, o una modifica del tipo di
  colonna che potrebbe comportare perdita di valori (`timestamptz` → `date`, `numeric` → `integer`),
  o una modifica alla chiave primaria — `(id)` → `(id, locale)` assegna a ogni riga un nuovo id,
  quindi link, chiavi esterne e id memorizzati altrove smetteranno di trovare la rispettiva riga.
  Si arresta inoltre
  prima della rimozione di un vincolo CHECK o EXCLUDE presente nel database: nessuna riga
  va perduta, ma da quel momento in poi il database accetterà le righe che prima rifiutava.
  Richiede conferma su terminale, dove Ctrl-C o Ctrl-D corrispondono a "no", e rifiuta
  l'operazione altrimenti; `--allow-destructive` la applica comunque. Anche `--yes` lo fa
  in questa versione, con un avviso di deprecazione; a partire dalla prossima versione autorizzerà
  solo push che non distruggono dati. Un push che
  si arresta in questa fase rimuove il database temporaneo `<db>_dev_diff` prima di uscire
- Attiva la sicurezza a livello di riga (RLS) per ogni tabella dichiarata, comprese le tabelle di giunzione, subito dopo
  la modifica dello schema e prima di qualsiasi passaggio che potrebbe fallire, in modo che un push interrotto a metà lasci la nuova tabella
  in uno stato che rifiuta ogni richiesta anziché lasciarla aperta a tutti
- Applica le policy RLS risultanti dalla compilazione di `rls` delle tue tabelle e **rimuove le policy sostituite da un push precedente**
- Mantiene inalterato ogni
  vincolo CHECK ed EXCLUDE su una tabella dichiarata. Poiché una tabella non
  può dichiararli, essi costituiscono regole proprie del database, scritte manualmente
  o ereditate da un database adottato tramite `schema introspect`; per rimuoverne uno, eliminalo
  manualmente (`ALTER TABLE … DROP CONSTRAINT …`). Anche i trigger e le funzioni creati da te
  non vengono toccati
- Verifica con corrispondenza
  esatta il nome di ogni elemento preservato, inclusi eventuali `.`, `[`, `]`
  o `*`
- Crea qualsiasi
  [indice di chiave esterna derivato da Rebase](/docs/backend/indexes#foreign-keys-are-indexed-for-you)
  mancante in una tabella esistente **prima** della pianificazione, tramite
  `CREATE INDEX CONCURRENTLY`, affinché le operazioni di scrittura sulla tabella proseguano durante la creazione;
  Atlas lo troverà quindi già presente. `--dry-run` elenca questi indici senza crearli
- Appone un marcatore (stamp)
  alle policy applicate nello stesso modo in cui fa il boot del server, affinché il primo avvio dopo un
  push non le ricrei da capo ma le lasci invariate
- `--dry-run`
  elenca le modifiche alla row-level security previste dal push, nella sezione "Planned
  row-level security changes": le tabelle su cui viene attivata l'RLS e ciascuna
  policy creata, sostituita o eliminata, determinate secondo i passaggi del
  push stesso. Mostra "No changes" solo quando né lo schema né
  la row-level security necessitano di modifiche. Laddove il marcatore di una policy non corrisponda alla
  sua regola, o ne sia sprovvista (una creata da `db migrate`, una scritta manualmente), la dry
  run la ricrea a partire dalla regola con un altro nome, all'interno di una transazione di cui
  esegue il rollback, e confronta ciò che Postgres ha memorizzato: se il risultato coincide,
  non c'è alcuna modifica. Di conseguenza, una regola reimportata da `schema introspect` come SQL non pianifica nulla,
  e lo stesso vale per le policy applicate da `db migrate`. Solo quelle impossibili da confrontare (ad esempio se il
  lock sulla tabella non viene concesso entro due secondi) vengono elencate a parte. Il push
  stesso stampa una sola riga riepilogativa con il conteggio delle modifiche
- Mostra ciascuna
  istruzione applicata da Atlas una sola volta. Atlas si connette senza SSL a un database situato su questa
  macchina (`localhost`, `127.x`, `::1`) il cui URL non specifica alcun `sslmode`, come fa l'app,
  anziché fallire con `SSL is not enabled on the server`; un URL che
  specifica `sslmode`, o un altro host, viene inoltrato esattamente come scritto. Un'esecuzione di Atlas
  che fallisce prima della pianificazione non lascia residui del database `<db>_dev_diff`
- `--dry-run`
  non scrive nulla nei file di progetto: `src/schema.generated.ts` rimane intatto,
  e le copie `drizzle/*.sql` committate da una versione precedente vengono elencate, non
  eliminate. Solo l'input del piano viene scritto in `.rebase/sql/`, che non viene committato
- **Non** crea file di migrazione

**Quanto tempo richiede.** La quasi totalità del tempo di un push è dovuta al calcolo del piano da parte di Atlas:
Atlas genera lo schema desiderato in un database temporaneo e ne calcola il diff rispetto a quello
reale, e tale costo aumenta più che proporzionalmente rispetto al numero di tabelle — su un portatile a riposo
circa 0,25 s per piano con 11 tabelle, 0,9 s con 111 e 5,5 s con 411. Un push che
non apporta modifiche pianifica una sola volta; uno che introduce modifiche pianifica due volte (la simulazione
letta dal destructive-change gate, seguita dall'applicazione effettiva). Pertanto, un push su uno schema con
400 o più tabelle richiede decine di secondi, e anche di più su macchine lente o sovraccariche.
Questo tempo dipende da Atlas, non dal tuo database: i passaggi accessori — generazione
dell'SQL, lock RLS, ricerca, trigger, policy, ruoli — richiedono solo pochi secondi per
dimensioni simili, su un'unica connessione al tuo database.

**I file generati durante il processo**, tutti salvati in `.rebase/sql/` all'interno della directory
backend. `db push` e `db generate` creano tutti e cinque i file a partire dalle tue tabelle
a ogni esecuzione, prima di leggerne alcuno, quindi una copia committata non verrebbe
utilizzata da nulla. La directory include il proprio `.gitignore` e non va mai committata.

| File | Contenuto |
|------|-----------|
| `schema.sql` | Tabelle, colonne, vincoli e indici — lo stato desiderato da Atlas, e l'unico su cui calcola il diff |
| `policies.sql` | Le policy RLS a cui compila `rls` delle tue tabelle |
| `search.sql` | Le funzioni di ricerca full-text e le colonne generate, per le tabelle con un blocco `search` |
| `vector.sql` | Le estensioni pgvector e gli indici ANN |
| `triggers.sql` | `rebase.set_updated_at()` e i trigger `BEFORE UPDATE` alla base di `.onUpdateNow()` |

Atlas gestisce il primo e nient'altro, quindi `db push` e l'allineamento dello schema
al boot applicano autonomamente gli altri quattro. Un deployment **basato solo su migrazioni** — ovvero
che esegue `db migrate` e mai `db push` — deve includere manualmente questi quattro elementi in
una migrazione; `db generate` lo segnala quando una modifica non è visibile ad Atlas.

Nei progetti in cui questi file erano stati committati in `drizzle/` con una versione precedente,
tali copie verranno eliminate alla prima esecuzione, e il comando indicherà ciascun file eliminato
per consentirne il commit della rimozione. Vengono eliminati solo i file che iniziano con l'intestazione
del generatore. I file scritti manualmente vengono preservati, così come `drizzle/migrations/`.

:::note[La modifica di una regola di sicurezza rinomina la relativa policy]
Una regola senza un `name` esplicito viene compilata come `<table>_<op>_<hash>`, dove l'hash rappresenta la semantica della regola — pertanto, *modificare* una regola (anziché aggiungerne una) genera una policy con un nuovo nome, lasciando invariata quella precedente.

Questo in passato comportava criticità importanti: Postgres unisce le policy `PERMISSIVE` tramite operatore logico OR, quindi una policy obsoleta come `USING (rebase.uid() IS NOT NULL)` continuava a concedere l'accesso a tutto, indipendentemente da quanto restrittiva fosse la sua sostituta. L'inasprimento di una regola non sortiva alcun effetto e il push segnalava un esito positivo.

`db push` ora gestisce questa riconciliazione: elimina le policy generate che non corrispondono più ad alcuna regola e segnala — senza eliminarle — le policy con nomi personalizzati non descritte dalle tue tabelle, poiché indistinguibili da istruzioni SQL scritte deliberatamente.

Per verificare un database su cui è stato eseguito un push prima dell'introduzione di questa funzionalità, esegui `rebase doctor --policies`. Può fungere da gate di CI: restituisce un codice di uscita diverso da zero in caso di disallineamento (drift), nonché nell'eventualità in cui non sia stato possibile eseguire il controllo — assenza di `DATABASE_URL`, percorso `--schema-dir` non valido, autorizzazioni di lettura su `pg_policies` non concesse al ruolo CI. Un controllo non eseguito non equivale a un controllo superato.

`doctor` e `db push` distinguono le due tipologie di elementi orfani. Una policy con nome generato è stata sostituita e verrà eliminata al push successivo. Qualsiasi altro nome è stato impostato manualmente o da un altro strumento ed è tuttora in vigore: descrivilo nell'`rls` della relativa tabella per mantenerlo (la vista RLS di Studio lo importa), oppure eliminalo manualmente se obsoleto.
:::

:::caution
`db push` modifica direttamente il database. Usalo solo in fase di sviluppo. Per l'ambiente di produzione, usa `db generate` + `db migrate` per creare file di migrazione revisionabili.
:::

### `rebase db generate`

Genera file di migrazione SQL a partire dalle modifiche allo schema:

```bash
rebase db generate
```

**Cosa fa:**
- Confronta lo schema Drizzle con lo stato creato dalle migrazioni in `drizzle/migrations/`, anziché con il database
- Produce file di migrazione SQL provvisti di timestamp in `backend/drizzle/migrations/`
- I file possono essere revisionati, modificati e tracciati nel controllo versione
- Elenca ogni
  istruzione nella nuova migrazione che distrugge dati, impiegando lo stesso controllo eseguito da `db push`
  prima dell'applicazione: tabelle, colonne, schemi, viste o tipi eliminati, un
  `TRUNCATE`, modifiche al tipo di colonna che comportano perdita di valori, modifiche alla
  chiave primaria o l'eliminazione di vincoli CHECK o EXCLUDE presenti nel database. Scrive
  comunque il file ed esce con codice 0, segnalando un avviso senza interrompere il processo.
- Conclude indicando i
  passaggi successivi: `rebase db migrate` e, nel caso della prima migrazione di un progetto,
  l'opzione `--baseline <version>` necessaria per i database già inizializzati al boot. Alle
  migrazioni successive non viene indicata la riga di baseline, poiché impostare la baseline su una migrazione distruttiva
  ne salterebbe il `DROP`, mentre un'esecuzione che non produce alcuna migrazione si limita a indicarlo.

**Un vincolo CHECK aggiunto da una tua migrazione viene rimosso da quella successiva.** `db generate`
confronta i file di migrazione, non il database, e Atlas non consente di escludere un
oggetto da questo diff. Pertanto, un vincolo CHECK o EXCLUDE inserito a mano in
una migrazione, e non dichiarabile da alcuna tabella, verrà riproposto come
`ALTER TABLE … DROP CONSTRAINT …` nella successiva migrazione generata, accorpato
nella stessa istruzione della modifica effettiva. Il report sopra menzionato segnala tale rimozione quando
il database contiene già il vincolo; non lo elimina automaticamente dal
file. Rimuovi la clausola prima di eseguire `rebase db migrate`, oppure lascia che
`rebase db migrate --refuse-destructive` ne blocchi l'esecuzione. `db push` esamina il
database e preserva il vincolo.

Le migrazioni generate sono semplici file SQL — puoi ispezionarli e modificarli prima di applicarli.

### `rebase db migrate`

Esegui tutte le migrazioni in sospeso:

```bash
rebase db migrate
```

**Cosa fa:**
- Cerca le migrazioni non ancora applicate in `drizzle/migrations/`
- Le applica in ordine sequenziale al database
- Traccia quali migrazioni sono già state applicate
- Appone un marcatore (stamp)
  alle policy di row-level security nello stesso modo in cui fanno `db push` e il boot del server, affinché
  il primo avvio dopo una migrazione le lasci intatte anziché ricrearle da capo. Poiché una migrazione
  è stata generata in base alle tabelle dell'epoca, una policy riceve il marcatore solo quando coincide
  esattamente con quanto prodotto dalla regola attuale: la migrazione la ricrea
  a partire dalla regola con un altro nome, in una transazione sottoposta a rollback, e
  confronta ciò che Postgres ha memorizzato, proprio come fa `db push --dry-run`. Una policy che
  differisce non riceve il marcatore, e all'avvio successivo la relativa tabella verrà riapplicata

`--refuse-destructive`
forza il rifiuto dell'operazione. Esegue prima una dry-run delle migrazioni in sospeso. Se una qualsiasi
istruzione comporta perdita di dati, secondo lo stesso criterio usato da `db push` e `db generate`,
elenca tali istruzioni ed esce con codice 1. Non applica alcunché, nemmeno i file
precedenti a tale istruzione. In assenza di questo flag, `db migrate` agisce come di consueto e
applica ogni file in sospeso:

```bash
rebase db migrate --refuse-destructive
```

Una migrazione che ricostruisce una colonna di ricerca ne richiede prima l'eliminazione, quindi questo flag rifiuterà
anche tale migrazione. Esamina l'elenco visualizzato, quindi esegui `rebase db migrate`
senza il flag per procedere all'applicazione.

#### Creare una baseline per un database già avviato da Rebase

Ogni avvio di Rebase verifica e allinea lo schema, e `rebase db push` lo applica direttamente. Di conseguenza, un database che abbia eseguito l'uno o l'altro possiede già le tabelle e i tipi che la prima migrazione tenterebbe di creare, causando il blocco di `rebase db migrate` con l'errore `pq: type "posts_status" already exists (42710)`.

La migrazione non presenta anomalie: il database è stato semplicemente inizializzato in un altro modo. Registra lo stato attuale del database e poi procedi con la migrazione standard:

```bash
rebase db migrate --baseline 20260906101530
rebase db migrate
```

La versione corrisponde al prefisso numerico del file di migrazione che descrive lo stato *attuale* del database. Quella specifica migrazione e tutte le precedenti vengono registrate come già applicate; le successive verranno eseguite normalmente. Su un database vergine su cui non è mai stato effettuato un boot, non occorre alcuna baseline: è possibile migrare immediatamente.

La stessa situazione si ripresenta nel normale ciclo di sviluppo: modificando una tabella mentre `rebase dev` è in esecuzione, il boot aggiunge la colonna prima che `rebase db generate` scriva la migrazione corrispondente, bloccando `rebase db migrate` con l'errore `column … already exists (42701)`. Crea la baseline per tale migrazione allo stesso modo. `--baseline` funziona anche su database che contengono già uno storico di migrazioni: contrassegna come applicate tutte le migrazioni fino alla versione indicata tramite `atlas migrate set`, notificando l'operazione, oppure segnala che non c'è nulla da registrare se la cronologia ha già raggiunto tale versione. L'indicazione di una versione non presente tra i file di `drizzle/migrations` viene respinta prima dell'esecuzione, mostrando l'elenco delle versioni disponibili.

### `rebase db branch`

Branching del database per lo sviluppo in parallelo:

```bash
rebase db branch create feature_auth
rebase db branch switch feature_auth
rebase db branch list
rebase db branch switch --off

rebase db branch info feature_auth
rebase db branch delete feature_auth
```

I comandi `rebase db branch switch` (e `switch --off`) e `rebase db branch prune`
sono stati introdotti di recente. `create`, `list`, `info` e `delete` sono disponibili dalla versione 0.17.

Ogni branch è una copia completa del database creata tramite `CREATE DATABASE ... TEMPLATE`,
pertanto richiede un server PostgreSQL reale e occupa lo stesso spazio su disco dell'originale.

### `rebase doctor`

Rileva il disallineamento a tre vie (drift) tra le tue tabelle, lo schema Drizzle generato e il database PostgreSQL attivo:

```bash
rebase doctor
```

**Elementi verificati:**
- Tabelle ↔ Schema generato — sono sincronizzati?
- Schema generato ↔ Database — ci sono modifiche non applicate?
- Tabelle ↔ Database — ci sono disallineamenti imprevisti?

Esegui `doctor` ogni volta che riscontri incongruenze. Identifica con precisione l'origine del problema.

Il confronto con il database include la stessa verifica svolta dal boot prima di segnalare discrepanze tra `schema.generated.ts` e il database, eseguita tramite il medesimo codice. Di conseguenza, ogni differenza segnalata dal boot compare anche nel report, con le stesse indicazioni: una colonna NOT NULL da un lato e nullable dall'altro, o una colonna presente nel database ma assente nel file (il boot non esegue mai cancellazioni, quindi una proprietà rinominata lascia indietro la vecchia colonna). Ognuna di esse costituisce un avviso, e la correzione suggerita indica `rebase db push`.

Il confronto con il database interroga il database del progetto, risolto secondo la logica di `rebase db url` — in un'installazione iniziale, quello gestito, che viene avviato da `doctor`. Qualora non sia possibile risolverne alcuno, questa fase viene contrassegnata come **saltata** (skipped) anziché superata, e il comando non restituirà mai "All schemas are in sync": un controllo non eseguito non garantisce la conformità dello stato.

Inoltre, segnala ogni tabella priva di un [blocco `search`](/docs/backend/search) contenente più di circa 10.000 righe. Una ricerca su di esse — tramite la casella di ricerca dell'admin, `.search()`, `?searchString=` — viene eseguita come `ILIKE '%term%'` sulle colonne di testo, operazione non ottimizzabile da alcun indice; ogni ricerca comporta quindi la scansione dell'intera tabella, e il conteggio richiede un'ulteriore scansione completa (circa un terzo di secondo su 100.000 righe, con tempi crescenti). Il conteggio delle righe si basa sulla stima interna di Postgres, pertanto il controllo non effettua scansioni. Si tratta di un suggerimento: non influisce sul codice di uscita e non crea indici automatici.

Segnala inoltre una **tabella di giunzione orfana**: una tabella in `public` strutturata come giunzione many-to-many non dichiarata da alcuna tabella. Tale struttura prevede due colonne che costituiscono insieme la chiave primaria, ciascuna con vincolo di chiave esterna verso una tabella dichiarata. La ridenominazione o l'eliminazione di un `manyToMany` lascia indietro la vecchia tabella di giunzione, poiché push e boot si limitano alla creazione di tabelle, e le righe di collegamento continuano a risiedere al suo interno. La nota ha valore puramente informativo e non modifica il codice di uscita. La soluzione consiste nell'istruzione `DROP TABLE`, che `doctor` mostra senza mai eseguirla automaticamente.

### `rebase generate-sdk`

<span class="since-badge" data-since="0.31">Da 0.31</span>

Genera un SDK tipizzato a partire dalle tue tabelle:

```bash
rebase generate-sdk
```

**Cosa fa:**
- Legge le tabelle esportate da `backend/schema/index.ts`, tramite il loader utilizzato all'avvio del backend, garantendo che l'SDK descriva con esattezza le tabelle effettivamente servite; la presenza di uno schema non compilabile blocca l'operazione
- Genera i tipi TypeScript per ciascuna tabella in `generated/sdk/`
- Produce un file `database.types.ts` da utilizzare con `createRebaseClient<Database>()`: il tipo `Database`, `TableName` (l'unione di tutti gli slug) e `tablesDictionary` / `TablesDictionary`, la mappa che associa ciascun accessor al relativo slug

`rebase dev` esegue automaticamente questo comando all'avvio e a ogni salvataggio all'interno di
`backend/schema/`. Puoi eseguirlo manualmente in ambienti CI, all'interno di un repository privo
di tabelle proprie (vedi `--from` di seguito), o ovunque `rebase dev` non sia attivo.

**Opzioni:**

| Flag | Descrizione |
|------|-------------|
| `--schema-dir` | La directory dello schema (predefinita: `backend/schema`, oppure la chiave `tables` in `rebase.json`); i percorsi relativi vengono risolti rispetto alla posizione di esecuzione |
| `-o`, `--output` | Directory di destinazione per l'SDK generato (predefinita: `generated/sdk/`) |
| `--from <link\|url>` | Legge lo schema da un progetto in esecuzione anziché dal codice sorgente locale. `link` fa riferimento al progetto collegato a questo checkout. |
| `--token` | Token Bearer per l'endpoint di contratto (predefinito: `$REBASE_SERVICE_KEY` dall'ambiente della shell; `.env` non viene letto) |
| `--register` | Tipizza anche i dati lato server: genera i tipi e la dichiarazione `Register` in `backend/generated/`, salvandola in `rebase.json` — vedi [Dati lato server tipizzati](/docs/backend/typed-server-data/) |

L'opzione `--from` consente ai repository privi di definizioni di tabelle — un
frontend separato, una seconda applicazione web, un'app mobile — di generare un client tipizzato a partire
dal progetto remoto di riferimento: legge le `tables` restituite da
`/api/meta/contract` del backend in esecuzione. `REBASE_SERVICE_KEY` viene inviata esclusivamente al progetto a cui
è collegato il checkout locale; specifica `--token` per qualsiasi altro host. La chiave presente in
`.env` appartiene al tuo backend locale e non viene mai trasmessa.
In caso di rifiuto, il messaggio indicherà la causa specifica: un `--token` non valido, una chiave shell respinta,
una chiave non inviata a un host non collegato, una chiave presente solo in `.env`, oppure l'assenza totale di credenziali.

**Utilizzo dopo la generazione:**

```typescript
import { createRebaseClient } from "@rebasepro/client";
import { tablesDictionary, type Database } from "./generated/sdk/database.types";

const client = createRebaseClient<Database>({
    baseUrl: import.meta.env.VITE_API_URL,
    tables: tablesDictionary,
});

// Full type safety and autocomplete
const { data } = await client.data.products.find();
```

I nomi dei campi nei tipi generati corrispondono a quelli esposti dall'API. Il nome di trasporto (wire name) di un
campo corrisponde alla chiave della colonna, e l'API adotta uniformemente la convenzione camelCase: l'introspezione
genera una colonna `created_at` come `createdAt: col.timestamp({ withTimezone: true })`, il cui nome SQL
è la versione snake_case della chiave, e la espone come `row.createdAt`. La colonna
stessa rimane invariata. L'*accessor* della tabella viene convertito nel nome di una proprietà
con lo stesso criterio (`my-notes` → `client.data.myNotes`), che `tablesDictionary`
rimappa poi al rispettivo slug.

### `rebase migrate`

<span class="since-badge" data-since="0.31">Da 0.31</span>

`rebase migrate collections-to-tables [dir]` trasferisce `config/collections` in
`backend/schema` (un `defineTable` per collezione, ciascuna colonna definita in modo esplicito
nella posizione originaria secondo la sintassi Drizzle, e `index.ts` con
`defaultRls`) e in `frontend/src/cms` (un `customizeTable` per ogni collezione personalizzata,
i file `defineFirestoreCollection`, `ui-config.json`), genera
`backend/resources.ts`, `backend/storage.ts` e `backend/generated/register.ts`,
aggiunge `rebaseBackendGuard()` al file `vite.config.ts` dell'applicazione, quindi esegue
`rebase migrate sdk-calls`, che converte `.collection(` in `.table(`, applica le
altre modifiche di ridenominazione dell'SDK, aggiorna le sorgenti delle regole `existsIn` / `membership` nel codice
e sposta le importazioni dei costrutti trasferiti ad altri package nella 0.31 (i tipi
e gli helper del pannello di amministrazione in `@rebasepro/cms-types`, le funzioni di migrazione in
`@rebasepro/common/migrate` — vedi [l'elenco completo](/docs/upgrading/0-30-to-0-31-imports/)),
aggiungendo i nuovi package alle dipendenze ("Dependencies added": eseguire
`pnpm install`). Aggiorna ogni pacchetto `@rebasepro` alla versione 0.31 prima dell'esecuzione.
Ogni esecuzione riesamina il risultato: il codice SQL generato — DDL, policy, search,
vector, trigger, viste, schema Drizzle — deve coincidere byte per byte, pena il ripristino
di tutti i file. Gli elementi non convertibili vengono segnalati indicando file e riga, e
le operazioni a carico dell'utente vengono mostrate come passaggi manuali numerati, terminando con
`rebase skills install` qualora il progetto contenga agent skills. I moduli personali presenti in
`config/` rimangono intatti; l'esecuzione indica il comando `git rm` per i file sostituiti.

| Flag | Effetto |
|---|---|
| `--dry-run` | Mostra i file, le operazioni non consentite, le note e i passaggi manuali senza scrivere nulla. Consigliato come primo passaggio. |
| `--check` | Su un progetto già migrato: verifica che `backend/schema` generi ancora lo stesso codice SQL. Restituisce codice 1 mostrando il diff o in caso di variazione semantica di una regola. |
| `--accept-rule-changes` | Da usare con `--check`: conferma che le regole elencate in "Review before deploying" sono state verificate. |
| `--json` / `--force` / `--skip-sdk-calls` | Output del report in formato JSON (con `ruleChanges`); esecuzione su un git tree con modifiche non committate o su file già modificati; non modifica il codice sorgente. |

Esamina due sezioni specifiche nell'output dell'SDK: **"Rewritten by name — review"** (chiamate su
un ricevitore non tipizzato, riscritte in base al nome) e **"Left unchanged — check each"**
(chiamate la cui appartenenza all'SDK non è stata accertata: rinomina manualmente quelle pertinenti per evitare errori a runtime).

La verifica del codice SQL garantisce la fedeltà della conversione, ma non che le regole mantengano
il medesimo significato originario. La sezione finale dell'output, **"Review before deploying: these rules change meaning"**,
elenca ogni regola la cui policy attribuisce ora permessi differenti
— una regola generica `access: "authenticated"` non concedeva nulla, mentre ora autorizza qualsiasi
utente autenticato ([i quattro scenari](/docs/upgrading/0-30-to-0-31/#review-before-deploying-these-rules-change-meaning)).
Verifica infine sul database: `rebase db push --dry-run` dovrebbe restituire "No
changes: the database already matches these tables.", e
`rebase doctor --policies` non dovrebbe mostrare alcun disallineamento (drift).

## Flusso di lavoro per lo sviluppo

<span class="since-badge" data-since="0.31">Da 0.31</span>

Il flusso di lavoro a iterazione rapida per lo sviluppo:

```bash
# 1. Edit a table in backend/schema/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Push directly to dev database
rebase db push
```

## Flusso di lavoro per la produzione

<span class="since-badge" data-since="0.31">Da 0.31</span>

Il flusso di lavoro sicuro e revisionabile per la produzione:

```bash
# 1. Edit a table in backend/schema/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Generate SQL migration files
rebase db generate

# 4. Review the generated SQL in backend/drizzle/migrations/
# 5. Commit the migration to version control
git add backend/drizzle/migrations/

# 6. Apply in production
#    A database Rebase has already booted needs a baseline the first time —
#    see "Baselining a database Rebase has already booted" above.
rebase db migrate
```

## Risoluzione dei problemi

| Sintomo | Soluzione |
|---------|-----------|
| `Could not detect an active database plugin` | Installa `@rebasepro/server-postgres` in `backend/package.json` |
| Il file di schema non si aggiorna | Verifica che il percorso `--schema-dir` (o la chiave `tables` in `rebase.json`) punti alla directory corretta |
| La migrazione mostra modifiche impreviste | Esegui `rebase doctor` per identificare eventuali disallineamenti |
| `db push` fallisce in produzione | Usa `db generate` + `db migrate` in alternativa |
| Una migrazione non deve eliminare dati in CI o produzione | `rebase db migrate --refuse-destructive` esce con codice 1 senza applicare nulla se un'istruzione in sospeso è distruttiva per i dati |
| `db migrate` fallisce con `already exists (42710)` | L'avvio o `db push` hanno già predisposto lo schema — imposta la baseline con `rebase db migrate --baseline <version>` |
| `db migrate` fallisce con `column … already exists (42701)` | `rebase dev` ha inserito la colonna all'avvio — imposta la baseline per tale migrazione seguendo la stessa procedura |
| `db push` sul database gestito fallisce con `Error: EOF` | Atlas ha perso la connessione mantenuta attiva da `rebase dev`. Riprova; se l'errore persiste, arresta prima `rebase dev` |

## Passaggi successivi

- **[Tabelle](/docs/schema/)** — Definisci il tuo modello dati
- **[Riferimento CLI](/docs/cli)** — Tutti i comandi CLI
- **[SDK tipizzato](/docs/sdk)** — Usa l'SDK generato
