---
sourceHash: 78c09101b46f0864
title: Generazione dello schema
sidebar_label: Generazione dello schema
description: Genera schemi Drizzle ORM dalle tabelle in backend/schema, crea migrazioni SQL, esegui l'introspezione di un database esistente in file defineTable e mantieni il tuo database sincronizzato con la Rebase CLI.
---

## Panoramica

<span class="since-badge" data-since="0.31">Da 0.31</span>

Rebase utilizza una pipeline **schema-as-code** in cui le tabelle dichiarate con
`defineTable` in `backend/schema/` rappresentano l'unica fonte di verità. La CLI
le trasforma attraverso una pipeline deterministica:

```
Tables (backend/schema) → Drizzle Schema → SQL Migrations → PostgreSQL
```

Questa pagina tratta tutti i comandi della CLI coinvolti in questa pipeline.

## La Pipeline

### 1. Tabelle → Drizzle Schema

<span class="since-badge" data-since="0.31">Da 0.31</span>

Le tabelle esportate da `backend/schema/index.ts` descrivono colonne, tipi, relazioni,
enum e sicurezza a livello di riga (row-level security). Ciascuno dei comandi seguenti le legge attraverso il loader
con cui viene avviato il backend; per questo motivo, uno schema che non compila — una tabella priva di
`rls`, `"inherit"` senza `defaultRls`, un `defineTable` non esportato dall'index —
blocca il comando con un `SchemaDefinitionError` che segnala ogni problema,
e nulla viene scritto. Il comando `schema generate` produce un file di schema
Drizzle ORM a partire da esse.

Ogni comando che legge lo schema accetta `--schema-dir <dir>` per i progetti
che conservano le tabelle altrove; il valore predefinito è `backend/schema`, oppure la
chiave `tables` dell'app di backend in `rebase.json`. Il flag precedente alla versione 0.31, `--collections` / `-c`,
viene rifiutato con un messaggio che indica il codemod
([`rebase migrate collections-to-tables`](#rebase-migrate)), e lo stesso accade per i
progetti che contengono ancora `config/collections`.

### 2. Drizzle Schema → Migrazioni

A partire dallo schema Drizzle generato, `db generate` calcola le differenze (diff) rispetto alle migrazioni già presenti in `backend/drizzle/migrations/`, riprodotte su un database temporaneo di appoggio, e produce file di migrazione SQL con timestamp. Non legge mai il tuo database: una colonna già aggiunta all'avvio o tramite `db push` risulterà comunque come `ADD COLUMN`.

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
- Genera `backend/src/schema.generated.ts` contenente le definizioni delle tabelle Drizzle, gli enum e le relazioni

**Opzioni:**

| Flag | Descrizione |
|------|-------------|
| `--schema-dir` | La directory dello schema (predefinito: `backend/schema`); i percorsi relativi vengono risolti a partire da dove si esegue il comando |
| `--output, -o` | Percorso di output per il file di schema generato; i percorsi relativi vengono risolti a partire da dove si esegue il comando |
| `--watch, -w` | Monitora le modifiche e rigenera automaticamente |

La **modalità watch** è utile durante lo sviluppo — modifica un file di tabella e lo schema si rigenererà all'istante:

```bash
rebase schema generate --watch
```

### `rebase schema stale`

Verifica se lo schema generato corrisponde ancora alle tabelle:

```bash
rebase schema stale          # genera un report ed esce con codice 1 se qualcosa non è aggiornato
rebase schema stale --fix    # rigenera direttamente il file
```

**Cosa fa:**
- Esegue il rendering di quanto generato dalle tabelle in `backend/schema/` e lo confronta, dichiarazione per dichiarazione, con `backend/src/schema.generated.ts`
- Segnala ogni discrepanza — una tabella mancante, una colonna con un tipo diverso, un'etichetta enum rimossa o chiavi esterne nominate secondo le modalità ricavate da una release precedente — ed esce con un codice diverso da zero
- Con `--fix`, rigenera il file invece di mostrare solo il report

`rebase dev` mantiene il file aggiornato autonomamente, quindi questo controllo è pensato per un passaggio di build
o di CI. Accetta `--schema-dir` e `--output` esattamente come `rebase schema generate`.

### `rebase schema reconcile`

<span class="since-badge" data-since="0.31">Da 0.31</span>

Rilassa e rimuovi ciò che la procedura di avvio non tocca, dopo aver esaminato il piano d'azione:

```bash
rebase schema reconcile                         # rilassa i vincoli NOT NULL sulle colonne rese nullable o rimosse
rebase schema reconcile --drop voice_cache.wav  # ed elimina una colonna non dichiarata da nessuna tabella
```

**Cosa fa:**
- Chiede al backend in esecuzione di pianificare l'operazione sul proprio database. È il backend a cui puntano il file `.env` e il cloud link, pertanto funziona anche su Rebase Cloud, dove nient'altro ha accesso diretto al database.
- Pianifica `DROP NOT NULL` per ogni colonna che una tabella dichiara nullable ma che il database richiede ancora come obbligatoria.
- Elenca ogni colonna non dichiarata da alcuna tabella. Una colonna `NOT NULL` priva di valore predefinito bloccherebbe ogni inserimento, quindi viene rilassata a sua volta, mantenendone i dati. Rimuove esclusivamente le colonne indicate con `--drop <table>.<column>`, mostrando quante righe contengono un valore per ciascuna di esse.
- Applica le modifiche solo dopo aver digitato `yes`. Il server esegue il piano unicamente a fronte del digest di quello mostrato; se nel frattempo il database o le tabelle sono cambiati, l'operazione viene rifiutata e sarà necessario esaminarlo di nuovo. Il flag `--yes` ignora la richiesta di conferma.

L'avvio si limita ad aggiungere elementi, quindi dopo aver rimosso una colonna dal rispettivo `defineTable` essa rimane all'interno del database, insieme ai suoi dati. Una colonna `NOT NULL` senza default causerebbe il fallimento di ogni operazione di inserimento, e il log di avvio indicherà l'uso di questo comando: senza `--drop` per mantenere i dati, con l'opzione per eliminare la colonna. Effettua prima il deploy della modifica alla tabella, poiché la riconciliazione pianifica a partire da ciò che il backend sta eseguendo. Richiede `REBASE_SERVICE_KEY` in `.env`. In locale, `rebase db push` copre la stessa esigenza tramite il controllo di sicurezza per le modifiche distruttive.

### `rebase schema introspect`

<span class="since-badge" data-since="0.31">Da 0.31</span>

Crea i file `defineTable` a partire da un database PostgreSQL esistente:

```bash
rebase schema introspect
```

**Cosa fa:**
- Si connette al database del progetto, ovvero quello stampato da `rebase db url` (se si tratta di quello gestito, viene avviato se necessario); `--database-url` ne indica uno differente, mentre `--docker` fa uso di quello configurato tramite compose
- Legge ogni tabella, colonna, tipo, foreign key e policy, generando
  `backend/schema/<table>.ts` — un `defineTable` per tabella — e il file
  `backend/schema/index.ts` che le esporta (integrandosi in un indice già
  esistente)
- Dichiara ciascuna colonna con il suo tipo Postgres: `col.uuid()`, `col.varchar({ length })`,
  `col.numeric({ precision, scale })`, un enum con le relative etichette e il nome effettivo del tipo
  (un `pgEnum` nel caso in cui il tipo sia condiviso), un array nella forma `<item>.array()`,
  `col.vector({ dimensions })`, chiavi identity e serial, valori di default — secondo la sintassi
  utilizzata da Drizzle. I tipi non riconosciuti da alcun builder diventano
  `col.custom({ dataType: "<sql type>" })`, gestiti da Rebase così come
  vengono restituiti dal driver; `db generate` e `db push` li rifiuteranno finché il planner
  non sarà in grado di gestirli
- Dichiara la colonna foreign-key, la relazione `belongsTo` su di essa e la corrispondente
  `hasMany` inversa sulla destinazione; una tabella di giunzione diventa una `manyToMany`, dove le
  colonne proprietarie costituiscono il `pivot`
- Legge le policy di row-level security di ciascuna tabella inserendole nella proprietà `rls`: nome,
  comando, modalità, lista `TO`, clausole `USING` e `WITH CHECK`. Le policy
  `<table>_default_*` introdotte automaticamente da Rebase vengono escluse, così che il successivo
  `db push` possa ricreare ciascuna policy esattamente com'era. Una tabella con row-level security attiva
  ma senza alcuna policy viene configurata come `rls: "admin-only"`
- Legge ogni espressione (la clausola `USING` di una policy, un CHECK, il default di una colonna) nel contesto del
  `search_path` impiegato dal server, ovvero `public`, in modo tale che una funzione presente nello schema `rebase`
  venga scritta come `rebase.roles()`
- Converte un CHECK interpretabile (`total >= 0`) nel metodo `.validate()` della colonna,
  mantenendo il vincolo vero e proprio all'interno del database, dove il push successivo
  continuerà a conservarlo
- Inserisce ciò che non è stato possibile interpretare con esattezza all'interno di un commento in cima al file
  della tabella e sul terminale — un set chiuso di stringhe su una colonna di testo, una
  colonna generata la cui espressione non è stata letta, un tipo personalizzato — descrivendo come
  un push interverrebbe su di esso
- Con l'opzione `--data-inference`, esamina un campione fino a 100 righe per tabella ed estrae le impostazioni
  di presentazione — titoli, icone, board, ordinamenti, opzioni dei campi — inserendole in
  `frontend/src/cms/<table>.tsx` sotto forma di `customizeTable`, qualora il frontend
  del progetto dipenda da `@rebasepro/cms`. Un progetto headless ne sarà privo
- Se eseguito a fronte di un database non attivo, mostra lo stesso banner di `db push`,
  una sola volta, senza creare nulla. Stampa la directory di output come
  percorso assoluto

**Opzioni:**

| Flag | Descrizione |
|------|-------------|
| `--schema-dir` | Cartella in cui scrivere i file delle tabelle (predefinito: `backend/schema`). `--output` è stato rimosso |
| `--schema` | Lo schema Postgres da leggere (predefinito: `public`) |
| `--force, -f` | Sovrascrive i file delle tabelle già esistenti; senza questa opzione, un file esistente viene ignorato |
| `--database-url` | Legge questo database anziché quello configurato per il progetto |
| `--docker` | Legge il database compose, avviandolo se necessario |
| `--data-inference` / `--no-data-inference` | Esamina fino a 100 righe per tabella per rilevare formati, vincoli e impostazioni del pannello, oppure legge esclusivamente la struttura. In assenza di entrambi i flag richiede conferma interattiva; in un ambiente senza terminale legge solo la struttura |

Questa procedura è utile per adottare Rebase su un database preesistente — prima si esegue l'introspezione,
quindi si modificano le tabelle generate. Una tabella priva di row-level security viene
scritta come qualsiasi altra, con il relativo blocco `rls`; il push provvederà ad attivare l'RLS, informando
l'utente durante il dry run. Un backend eseguito interamente senza `backend/schema` opererà
interagendo direttamente con il database — consulta [Backend only](/docs/getting-started/headless/).

### `rebase db push`

Applica le modifiche allo schema direttamente al database senza passare per i file di migrazione:

```bash
rebase db push
```

**Cosa fa:**
- Legge lo schema Drizzle generato
- Applica le modifiche direttamente al database (CREATE, ALTER, DROP)
- Esegue prima una simulazione (dry-run) del piano e si arresta davanti a qualsiasi operazione distruttiva per i dati:
  l'eliminazione di una tabella, colonna, schema, vista o tipo, un `TRUNCATE`, una modifica del tipo di
  colonna che potrebbe causare perdita di valori (`timestamptz` → `date`, `numeric` → `integer`),
  oppure una modifica alla chiave primaria — `(id)` → `(id, locale)` assegna a ogni riga un nuovo id,
  impedendo a link, chiavi esterne e id memorizzati altrove di individuare la riga corrispondente.
  Si arresta inoltre prima della rimozione di un vincolo CHECK o EXCLUDE presente nel database:
  nessuna riga andrà persa, ma da quel momento in poi il database accetterà righe che prima avrebbe rifiutato.
  Nel terminale viene richiesta conferma interattiva (dove Ctrl-C o Ctrl-D equivalgono a rifiutare), e l'operazione
  viene bloccata in caso contrario; `--allow-destructive` la applica forzatamente. In questa release
  anche `--yes` produce lo stesso effetto, accompagnato da un avviso di deprecazione; a partire dalla prossima versione,
  esso approverà esclusivamente push che non distruggono dati. Un push che si interrompe in questa fase
  rimuove il rispettivo database temporaneo `<db>_dev_diff` prima di uscire
- Attiva la row-level security per ogni tabella dichiarata, comprese le tabelle di giunzione, subito dopo
  la modifica dello schema e prima di qualsiasi operazione a rischio di errore, cosicché un push interrotto
  a metà lasci la nuova tabella in uno stato che blocca ogni richiesta anziché lasciarla aperta a tutti
- Applica le policy RLS derivate dalla compilazione del parametro `rls` delle tabelle, e **rimuove le policy superate da un push precedente**
- Mantiene intatto qualsiasi vincolo
  CHECK ed EXCLUDE presente su una tabella dichiarata. Una tabella
  non può dichiarare nessuno dei due elementi, che rappresentano quindi regole interne del database, scritte
  manualmente o ereditate da un database acquisito con `schema introspect`; per eliminarne uno, occorre rimuoverlo
  manualmente (`ALTER TABLE … DROP CONSTRAINT …`). Nemmeno i trigger e le funzioni scritte dall'utente vengono toccati
- Corrisponde esattamente al nome di ciascun elemento che lascia invariato,
  compresi eventuali caratteri `.`, `[`, `]` o `*` in esso presenti
- Crea qualsiasi
  [indice su chiave esterna derivato da Rebase](/docs/backend/indexes#foreign-keys-are-indexed-for-you)
  che risulti mancante in una tabella esistente **prima** della fase di pianificazione, tramite
  `CREATE INDEX CONCURRENTLY`, così che le operazioni di scrittura sulla tabella possano proseguire durante la creazione;
  Atlas lo troverà quindi già disponibile. L'opzione `--dry-run` mostra questi elementi senza creare alcunché
- Applica un contrassegno (stamp) alle policy implementate esattamente come farebbe la fase di avvio del server,
  in modo che il primo avvio successivo al push non debba ricrearle da capo
- L'opzione `--dry-run`
  elenca le modifiche di row-level security che il push andrebbe ad applicare, sotto la sezione "Planned
  row-level security changes": le tabelle su cui l'RLS verrebbe abilitato e ogni singola
  policy creata, sostituita o eliminata, determinate secondo la logica dei singoli passaggi del push.
  Riporta "No changes" solo quando né lo schema né la
  row-level security richiedono modifiche. Nel caso in cui lo stamp di una policy non corrisponda alla rispettiva
  regola, o qualora ne sia sprovvista (es. creata da `db migrate` o scritta a mano), il dry run
  la ricrea a partire dalla regola assegnandole un altro nome, all'interno di una transazione sottoposta a rollback,
  e confronta il risultato memorizzato da Postgres: se l'esito coincide, viene considerata invariata.
  Pertanto, una regola reimportata da `schema introspect` come SQL non pianifica alcuna modifica, e lo stesso vale
  per le policy applicate tramite `db migrate`. Soltanto quelle che non è stato possibile confrontare (ad esempio
  a causa del mancato ottenimento del lock sulla tabella entro due secondi) vengono elencate separatamente. Il push
  effettivo si limita a stampare una riga che riassume il numero di modifiche
- Mostra ciascuna istruzione
  applicata da Atlas una sola volta. Atlas si connette senza SSL ai database in esecuzione sulla macchina
  locale (`localhost`, `127.x`, `::1`) il cui URL non specifica `sslmode`, analogamente a quanto fa l'applicazione,
  anziché fallire con l'errore `SSL is not enabled on the server`; un URL che
  indica esplicitamente `sslmode`, o relativo a un altro host, viene gestito senza modifiche. Un'esecuzione di Atlas
  che si interrompe prima della pianificazione non lascia alcun database residuo del tipo `<db>_dev_diff`
- L'opzione `--dry-run`
  non modifica alcun file del progetto: `src/schema.generated.ts` rimane intatto,
  e le copie dei file `drizzle/*.sql` committate con versioni precedenti vengono menzionate ma non
  eliminate. Soltanto i parametri di input del piano vengono scritti in `.rebase/sql/`, cartella non soggetta a commit
- **Non** genera file di migrazione

**Tempistiche di esecuzione.** La quasi totalità del tempo impiegato da un push è dedicata al calcolo del piano da parte di Atlas:
esso compila lo schema desiderato all'interno di un database temporaneo e ne calcola il diff rispetto a quello
reale, con un costo computazionale che cresce più che proporzionalmente rispetto al numero di tabelle — su un normale portatile,
circa 0,25 s per piano con 11 tabelle, 0,9 s con 111 tabelle e 5,5 s con 411 tabelle. Un push che
non apporta modifiche pianifica una sola volta; un push con modifiche pianifica due volte (la simulazione
letta dal controllo sulle modifiche distruttive, seguita dall'applicazione effettiva). Di conseguenza, su uno schema con
400 o più tabelle il push richiederà decine di secondi, e anche di più su una macchina lenta o sotto carico.
Tale intervallo dipende unicamente da Atlas e non dal database: i passaggi accessori — la generazione del codice
SQL, il lock RLS, le funzionalità di ricerca, i trigger, le policy e il ruolo — richiedono solo pochi secondi per
dimensioni simili, operando su una singola connessione verso il database.

**I file generati durante il processo**, tutti posizionati in `.rebase/sql/` all'interno della cartella di backend.
`db push` e `db generate` creano tutti e cinque i file a partire dalle tabelle a ogni
esecuzione, prima di leggerli, per cui una copia committata non verrebbe mai utilizzata.
La cartella include un proprio file `.gitignore` e non va mai aggiunta al version control.

| File | Contenuto |
|------|-----------|
| `schema.sql` | Tabelle, colonne, vincoli e indici — lo stato desiderato secondo Atlas, e l'unico su cui viene calcolato il diff |
| `policies.sql` | Le policy RLS derivate dalla compilazione dell'`rls` delle tue tabelle |
| `search.sql` | Funzioni di ricerca full-text e colonne generate, per le tabelle dotate di blocco `search` |
| `vector.sql` | Estensioni pgvector e indici ANN |
| `triggers.sql` | La funzione `rebase.set_updated_at()` e i trigger `BEFORE UPDATE` alla base di `.onUpdateNow()` |

Atlas si occupa esclusivamente del primo file; per questa ragione `db push` e la routine di
verifica dello schema all'avvio applicano autonomamente gli altri quattro file. Una distribuzione di tipo **migration-only** — ovvero
basata unicamente su `db migrate` e mai su `db push` — richiede di integrare a mano questi quattro componenti
all'interno di una migrazione; `db generate` segnalerà quando una modifica non risulta visibile ad Atlas.

Nei progetti in cui questi file erano stati committati sotto `drizzle/` con una versione precedente,
le rispettive copie verranno eliminate alla prima esecuzione: il comando elencherà ciascun file eliminato affinché
si possa procedere al commit della rimozione. Vengono rimossi esclusivamente i file che iniziano con l'intestazione
del generatore. I file scritti manualmente non vengono toccati, così come la cartella `drizzle/migrations/`.

:::note[La modifica di una regola di sicurezza comporta la ridenominazione della relativa policy]
Una regola priva di un `name` esplicito viene compilata come `<table>_<op>_<hash>`, dove l'hash rappresenta la semantica della regola — per questo motivo, la *modifica* di una regola esistente (anziché l'aggiunta di una nuova) genera una policy con un nuovo nome, lasciando presente quella precedente.

Questo in passato costituiva un problema critico: Postgres combina le policy `PERMISSIVE` tramite operatore OR, pertanto una vecchia policy `USING (rebase.uid() IS NOT NULL)` continuava a concedere l'accesso completo indipendentemente da quanto restrittiva fosse la sua sostituta. Rendere più rigida una regola non sortiva alcun effetto pratico, e il push confermava erroneamente il successo dell'operazione.

`db push` ora risolve questa situazione: rimuove le policy generate che non corrispondono più ad alcuna regola e segnala — senza rimuoverle — le policy con nome personalizzato non descritte all'interno delle tabelle, poiché indistinguibili da codice SQL inserito intenzionalmente a mano.

Per analizzare un database aggiornato tramite push prima dell'introduzione di questa funzionalità, esegui `rebase doctor --policies`. Può essere utilizzato come gate in CI: termina con codice diverso da zero in caso di disallineamento (drift), così come nell'eventualità in cui non sia stato possibile completare il controllo — assenza di `DATABASE_URL`, percorso `--schema-dir` non valido o permessi insufficienti per la lettura di `pg_policies` da parte dell'utente di CI. Se la verifica non può essere eseguita, il controllo non è da considerarsi superato.

`doctor` e `db push` distinguono le due tipologie di policy orfane. Una policy con nome generato automaticamente è da considerarsi obsoleta e verrà rimossa al push successivo. Qualsiasi altro nome fa riferimento a policy scritte manualmente o create da altri strumenti, che restano pertanto valide: descrivile all'interno dell'`rls` della rispettiva tabella per preservarle (la vista RLS di Studio ne consente l'importazione), oppure eliminale manualmente qualora non siano più necessarie.
:::

:::caution
`db push` altera la struttura del database in modo diretto. Utilizzalo esclusivamente in fase di sviluppo. Per gli ambienti di produzione, usa `db generate` abbinato a `db migrate` per creare file di migrazione tracciabili ed esaminabili.
:::

### `rebase db generate`

Genera file di migrazione SQL a partire dalle modifiche apportate allo schema:

```bash
rebase db generate
```

**Cosa fa:**
- Confronta lo schema Drizzle con lo stato determinato dalle migrazioni presenti in `drizzle/migrations/`, anziché con il database reale
- Crea file di migrazione SQL provvisti di timestamp all'interno di `backend/drizzle/migrations/`
- Tali file possono essere esaminati, modificati e versionati tramite Git
- Segnala ciascuna
  istruzione della nuova migrazione che comporta la perdita di dati, impiegando lo stesso controllo effettuato
  da `db push` prima dell'applicazione: l'eliminazione di una tabella, colonna, schema, vista o tipo, un'istruzione
  `TRUNCATE`, modifiche di tipo di colonna con possibile perdita di valori, modifiche alla chiave primaria,
  oppure la rimozione di un vincolo CHECK o EXCLUDE salvato nel database. Il comando
  genera comunque il file e termina con codice 0, limitandosi a emettere un avviso senza bloccare l'operazione.
- Conclude indicando
  i passaggi successivi: l'esecuzione di `rebase db migrate` e, nel caso della prima migrazione del progetto,
  l'uso dell'opzione `--baseline <version>` necessaria per i database già inizializzati dalla routine di avvio. Le
  migrazioni successive non riporteranno l'indicazione del baseline, poiché baselining di una migrazione distruttiva
  salterebbe la relativa istruzione `DROP`; un'esecuzione che non genera alcuna migrazione si limiterà a notificarlo.

**I vincoli CHECK aggiunti manualmente in una migrazione vengono rimossi da quella successiva.** Il comando `db generate`
confronta i file di migrazione e non il database; Atlas non dispone di meccanismi per escludere singoli oggetti
da tale confronto. Di conseguenza, un vincolo CHECK o EXCLUDE inserito manualmente
all'interno di una migrazione, e che nessuna tabella è in grado di dichiarare, verrà riproposto come
`ALTER TABLE … DROP CONSTRAINT …` nella migrazione generata successivamente, accorpato
nella stessa istruzione della modifica reale. Il report menzionato sopra evidenzierà tale eliminazione qualora
il vincolo risulti già presente nel database, senza tuttavia rimuoverlo dal file.
Sarà necessario eliminare manualmente la clausola prima di procedere con `rebase db migrate`, o lasciare che
`rebase db migrate --refuse-destructive` ne blocchi l'esecuzione. `db push`, al contrario, legge direttamente il
database e mantiene intatto il vincolo.

Le migrazioni generate sono normali file SQL: possono essere ispezionate e ritoccate prima di essere applicate.

### `rebase db migrate`

Esegue tutte le migrazioni non ancora applicate:

```bash
rebase db migrate
```

**Cosa fa:**
- Esegue la scansione di `drizzle/migrations/` alla ricerca di migrazioni pendenti
- Le applica in ordine sequenziale al database
- Registra quali migrazioni sono state applicate con successo
- Applica un contrassegno
  alle policy di row-level security secondo la medesima modalità di `db push` e dell'avvio del server,
  facendo sì che il primo avvio successivo alla migrazione le mantenga inalterate anziché ricrearle tutte.
  Poiché una migrazione è stata generata a partire dallo stato delle tabelle all'epoca della sua creazione, una policy
  riceve il contrassegno unicamente se coincide in modo esatto con quanto prodotto dalla sua regola attuale: migrate la
  ricrea dalla regola con un nome alternativo all'interno di una transazione con rollback,
  confrontando l'output presente su Postgres esattamente come fa `db push --dry-run`. Una policy
  non coincidente non riceverà il contrassegno, e all'avvio successivo la relativa tabella verrà riapplicata

`--refuse-destructive`
fa sì che il comando blocchi l'operazione in caso di rischi. Esegue innanzitutto una simulazione delle migrazioni pendenti. Qualora una
qualsiasi istruzione comporti la perdita di dati, basandosi sulle medesime verifiche di `db push` e `db generate`,
mostrerà l'elenco delle istruzioni interessate ed uscirà con codice 1. Nessuna modifica verrà applicata, compresi
i file precedenti all'istruzione critica. Senza questo flag, `db migrate` opera come di consueto
applicando tutti i file in sospeso:

```bash
rebase db migrate --refuse-destructive
```

Una migrazione che ricostruisce una colonna di ricerca ne richiede preventivamente la rimozione; pertanto, questo flag
bloccherà anche tale operazione. Esamina l'elenco mostrato, quindi avvia `rebase db migrate`
senza il flag per procedere all'applicazione.

#### Esecuzione del baseline su un database già avviato da Rebase

Ciascun avvio di Rebase assicura la presenza dello schema, e `rebase db push` lo applica direttamente. Per questo motivo, un database sul quale sia stata eseguita una di queste procedure presenterà già le tabelle e i tipi previsti dalla prima migrazione, causando l'interruzione di `rebase db migrate` con l'errore `pq: type "posts_status" already exists (42710)`.

La migrazione non presenta anomalie: il database è stato semplicemente predisposto tramite una procedura diversa. Registra lo stato attuale del database per poi proseguire con la normale procedura di migrazione:

```bash
rebase db migrate --baseline 20260906101530
rebase db migrate
```

La versione corrisponde al prefisso numerico del file di migrazione che rispecchia ciò che si trova *attualmente* all'interno del database. Tale migrazione e tutte quelle precedenti verranno registrate come già applicate; le successive verranno invece eseguite normalmente. Su un database vergine, non inizializzato da precedenti avvii, il baseline non è necessario: è possibile eseguire direttamente la migrazione.

La stessa situazione può presentarsi successivamente nel normale flusso di lavoro: modificando una tabella mentre `rebase dev` è in esecuzione, la fase di avvio aggiungerà la colonna prima che `rebase db generate` possa generare la relativa migrazione, causando il blocco di `rebase db migrate` con l'errore `column … already exists (42701)`. In tal caso è sufficiente registrare il baseline per tale migrazione allo stesso modo. L'opzione `--baseline` opera correttamente anche su database che già tengono traccia delle migrazioni: marca tutti gli elementi fino alla versione indicata come applicati tramite `atlas migrate set`, notificandolo all'utente, oppure segnala che non vi è nulla da aggiornare qualora lo storico contenga già tale versione. Se viene indicata una versione non presente in `drizzle/migrations`, il comando terminerà prima dell'esecuzione mostrando l'elenco delle versioni disponibili.

### `rebase db branch`

Gestione dei branch del database per lo sviluppo in parallelo:

```bash
rebase db branch create feature_auth
rebase db branch switch feature_auth
rebase db branch list
rebase db branch switch --off

rebase db branch info feature_auth
rebase db branch delete feature_auth
```

I comandi `rebase db branch switch` (e `switch --off`) assieme a `rebase db branch prune`
sono stati introdotti di recente. `create`, `list`, `info` e `delete` sono disponibili a partire dalla versione 0.17.

Ciascun branch è una copia integrale del database generata mediante `CREATE DATABASE ... TEMPLATE`,
richiede pertanto un'istanza reale di PostgreSQL e occupa sul disco lo stesso spazio della sorgente.

### `rebase doctor`

Rileva il disallineamento a tre vie (drift) tra le tabelle definite, lo schema Drizzle generato e il database PostgreSQL live:

```bash
rebase doctor
```

**Cosa controlla:**
- Tabelle ↔ Schema generato — sono sincronizzati?
- Schema generato ↔ Database — ci sono modifiche non applicate?
- Tabelle ↔ Database — sono presenti disallineamenti imprevisti?

Esegui `doctor` ogni volta che si verificano anomalie di sincronizzazione. Permette di identificare con precisione la causa del disallineamento.

Il confronto con il database include le stesse verifiche che la procedura di avvio esegue prima di segnalare che `schema.generated.ts` e il database non coincidono, condividendo la stessa base di codice. Di conseguenza, tutti gli avvisi mostrati all'avvio sono inclusi nel report, con la medesima formulazione: una colonna definita NOT NULL da un lato e nullable dall'altro, o una colonna presente nel database ma assente nel file (l'avvio non elimina mai elementi, pertanto la ridenominazione di una proprietà lascia la vecchia colonna nel database). Ciascuna discrepanza viene notificata come avviso (warning), indicando `rebase db push` come soluzione.

Il controllo del database fa riferimento all'istanza del progetto risolta nel modo mostrato da `rebase db url` — in un ambiente appena inizializzato corrisponde a quella gestita, avviata direttamente da `doctor`. Qualora non sia possibile raggiungere alcuna istanza, tale fase verrà contrassegnata come **skipped** anziché come superata, e il report non restituirà il messaggio finale "All schemas are in sync" — un controllo non eseguito non equivale a una verifica con esito positivo.

Segnala inoltre tutte le tabelle prive di blocco [`search`](/docs/backend/search) contenenti più di circa 10.000 righe. Una ricerca su di esse — tramite casella di ricerca del pannello di amministrazione, `.search()`, o parametro `?searchString=` — viene eseguita come `ILIKE '%term%'` sulle colonne di testo, operazione che non può sfruttare indici e che richiede quindi la scansione dell'intera tabella, ripetuta ulteriormente per il calcolo del totale (circa un terzo di secondo con 100.000 righe, crescendo con l'aumentare dei dati). Il numero di righe si basa sulle stime fornite da Postgres, senza richiedere una scansione completa. L'avviso ha valore puramente informativo: non modifica il codice di uscita del comando e non provvede a creare indici automatici.

Identifica infine eventuali **giunzioni orfane**: tabelle nello schema `public` strutturate come relazioni many-to-many non dichiarate da alcuna tabella. Tale struttura consiste in due colonne che costituiscono assieme la chiave primaria, ciascuna foreign key verso una tabella dichiarata. Ridenominare o cancellare una relazione `manyToMany` lascia intatta la vecchia tabella di giunzione, dato che push e avvio operano solo creando elementi, mantenendo le righe di collegamento precedentemente salvate. La segnalazione è a scopo informativo e non altera il codice di uscita. La correzione suggerita è l'istruzione `DROP TABLE`, che `doctor` si limita a mostrare senza mai eseguirla.

### `rebase generate-sdk`

<span class="since-badge" data-since="0.31">Da 0.31</span>

Genera un SDK tipizzato a partire dalle tabelle:

```bash
rebase generate-sdk
```

**Cosa fa:**
- Legge le tabelle esportate da `backend/schema/index.ts` attraverso il loader utilizzato per l'avvio del backend, garantendo che l'SDK descriva in modo fedele le tabelle gestite; uno schema che non compila interrompe l'esecuzione
- Genera i tipi TypeScript per ogni tabella all'interno di `generated/sdk/`
- Crea un file `database.types.ts` utilizzabile con `createRebaseClient<Database>()`: il tipo `Database`, `TableName` (l'unione di tutti gli slug), e `tablesDictionary` / `TablesDictionary`, ovvero la mappa tra accessor e slug

`rebase dev` esegue automaticamente questo comando all'avvio e a ogni salvataggio all'interno di
`backend/schema/`. Può essere eseguito manualmente in CI, all'interno di repository privi di
tabelle locali (vedere il parametro `--from` più sotto), o in contesti in cui `rebase dev` non sia attivo.

**Opzioni:**

| Flag | Descrizione |
|------|-------------|
| `--schema-dir` | La directory dello schema (predefinito: `backend/schema`, o la chiave `tables` in `rebase.json`); i percorsi relativi vengono risolti a partire da dove si esegue il comando |
| `-o`, `--output` | Cartella di output per l'SDK generato (predefinito: `generated/sdk/`) |
| `--from <link\|url>` | Legge lo schema da un progetto in esecuzione anziché dal codice sorgente locale. `link` fa riferimento al progetto collegato a questo checkout. |
| `--token` | Token Bearer per l'endpoint di contratto (predefinito: `$REBASE_SERVICE_KEY` dall'ambiente della shell; `.env` non viene letto) |
| `--register` | Tipizza anche i dati lato server: scrive i tipi e una dichiarazione `Register` in `backend/generated/`, salvando l'impostazione in `rebase.json` — consulta [Dati tipizzati lato server](/docs/backend/typed-server-data/) |

`--from` consente a repository che non includono la definizione delle tabelle — ad esempio frontend separati,
applicazioni web secondarie o app mobile — di generare un client tipizzato connettendosi al progetto
di riferimento: legge la sezione `tables` dell'endpoint `/api/meta/contract` del backend in esecuzione.
`REBASE_SERVICE_KEY` viene inoltrata esclusivamente al progetto collegato a questo checkout;
è necessario specificare esplicitamente `--token` per qualsiasi altro host. La chiave impostata
in `.env` appartiene al backend locale e non viene mai trasmessa.
In caso di rifiuto, il messaggio indicherà la causa specifica: `--token` non valido, chiave della shell non valida,
chiave non inviata poiché destinata a un host non associato, chiave definita unicamente in `.env`, oppure assenza totale di chiavi.

**Esempio di utilizzo post-generazione:**

```typescript
import { createRebaseClient } from "@rebasepro/client";
import { tablesDictionary, type Database } from "./generated/sdk/database.types";

const client = createRebaseClient<Database>({
    baseUrl: import.meta.env.VITE_API_URL,
    tables: tablesDictionary,
});

// Piena sicurezza dei tipi e autocompletamento
const { data } = await client.data.products.find();
```

I nomi dei campi all'interno dei tipi generati coincidono con quelli restituiti dalle API. Il nome
utilizzato sulla rete corrisponde alla chiave della colonna, e le API adottano uniformemente il camelCase: l'introspezione
converte una colonna `created_at` in `createdAt: col.timestamp({ withTimezone: true })`, il cui identificatore SQL
è la versione snake_case della chiave, e la restituisce come `row.createdAt`. La colonna
non subisce modifiche nel database. L'*accessor* della tabella viene convertito
in nome di proprietà seguendo la medesima convenzione (`my-notes` → `client.data.myNotes`),
che viene poi ricondotto allo slug originale tramite `tablesDictionary`.

### `rebase migrate`

<span class="since-badge" data-since="0.31">Da 0.31</span>

`rebase migrate collections-to-tables [dir]` trasferisce `config/collections` in
`backend/schema` (un `defineTable` per collezione, con ogni colonna definita esplicitamente
nella posizione originaria secondo la sintassi Drizzle, e il file `index.ts` corredato di
`defaultRls`) e in `frontend/src/cms` (un `customizeTable` per ogni collezione personalizzata,
i file `defineFirestoreCollection` e `ui-config.json`), genera
`backend/resources.ts`, `backend/storage.ts` e `backend/generated/register.ts`,
inserisce `rebaseBackendGuard()` nel file `vite.config.ts` dell'ambiente, quindi esegue
`rebase migrate sdk-calls`, che trasforma `.collection(` in `.table(`, applica le
ulteriori ridenominazioni dell'SDK e adegua le sorgenti delle regole `existsIn` / `membership` nel codice,
aggiornando inoltre gli import dei moduli trasferiti in altri pacchetti con la versione 0.31
([l'elenco completo](/docs/upgrading/0-30-to-0-31-imports/)), aggiungendo i pacchetti alle dipendenze
del modulo chiamante ("Dependencies added": eseguire `pnpm install`). Aggiorna tutti i pacchetti `@rebasepro` alla versione 0.31 prima di procedere.
A ogni esecuzione il risultato viene verificato: il codice SQL risultante — DDL, policy, search,
vector, trigger, viste e lo schema Drizzle — deve risultare identico byte per byte, in caso contrario tutti
i file vengono ripristinati allo stato iniziale. Gli elementi non convertibili vengono segnalati con indicazione di file e riga,
mentre le operazioni lasciate alla gestione manuale vengono elencate come passaggi numerati, terminando con
`rebase skills install` qualora il progetto contenga skill per agenti. I moduli personali presenti in
`config/` non vengono rimossi; al termine verrà visualizzato il comando `git rm` per i file sostituiti. Gestisce
inoltre le collezioni Firestore create a livello di funzione, gli alias di percorso, i pannelli montati
esternamente ad `App.tsx` e tutte le app statiche prive di guard ([elenco dettagliato](/docs/upgrading/0-30-to-0-31/#108-tables-in-backendschema-replace-configcollections--run-the-codemod-first)).
Una volta eseguito il comando `git rm`, `--check` restituirà `already-migrated`.

| Flag | Effetto |
|---|---|
| `--dry-run` | Mostra l'elenco dei file, le operazioni non consentite, le note e i passaggi manuali senza scrivere modifiche. È il comando da cui iniziare. |
| `--check` | Da usare su un progetto già migrato: verifica che `backend/schema` continui a produrre lo stesso codice SQL. Termina con codice 1 mostrando il diff, o quando una regola cambia significato. |
| `--accept-rule-changes` | Da abbinare a `--check`: conferma l'avvenuta revisione delle regole elencate nella sezione "Review before deploying". |
| `--json` / `--force` / `--skip-sdk-calls` | Restituisce il report in formato JSON (comprensivo di `ruleChanges`); consente l'esecuzione su un tree con modifiche non committate o su file già editati; non modifica il codice sorgente. |

Esamina i due elenchi forniti nell'output relativo all'SDK: **"Rewritten by name — review"** (receiver non tipizzati,
data slot, test double) e **"Left unchanged — check each"** (procedi a rinominare gli elementi appartenenti all'SDK;
[una ricerca](/docs/upgrading/0-30-to-0-31-by-hand/#sdk-calls-no-type-checker-sees) aiuta a individuare i restanti).

La verifica del codice SQL assicura l'accuratezza formale della conversione, ma non che una regola mantenga invariato il proprio comportamento.
L'ultima sezione dell'output, **"Review before deploying: these rules change meaning"**, elenca tutte le regole
la cui policy accorda ora permessi differenti — una clausola isolata `access: "authenticated"` in precedenza non concedeva
alcun accesso, mentre ora consente l'accesso a qualsiasi utente autenticato ([le quattro casistiche](/docs/upgrading/0-30-to-0-31/#review-before-deploying-these-rules-change-meaning)).
Verifica infine a fronte del database: `rebase db push --dry-run` dovrebbe restituire "No
changes: the database already matches these tables.", e
`rebase doctor --policies` non dovrebbe mostrare alcun disallineamento.

## Flusso di lavoro per lo sviluppo

<span class="since-badge" data-since="0.31">Da 0.31</span>

Il flusso di lavoro per iterare rapidamente in fase di sviluppo:

```bash
# 1. Modifica una tabella in backend/schema/
# 2. Genera lo schema Drizzle
rebase schema generate

# 3. Esegui il push diretto al database di sviluppo
rebase db push
```

## Flusso di lavoro per la produzione

<span class="since-badge" data-since="0.31">Da 0.31</span>

Il flusso di lavoro sicuro e tracciabile consigliato per la produzione:

```bash
# 1. Modifica una tabella in backend/schema/
# 2. Genera lo schema Drizzle
rebase schema generate

# 3. Genera i file di migrazione SQL
rebase db generate

# 4. Esamina il codice SQL generato in backend/drizzle/migrations/
# 5. Esegui il commit della migrazione nel version control
git add backend/drizzle/migrations/

# 6. Applica in produzione
#    Un database già avviato da Rebase richiede l'impostazione di un baseline la prima volta —
#    consulta "Esecuzione del baseline su un database già avviato da Rebase" più sopra.
rebase db migrate
```

## Risoluzione dei problemi

| Sintomo | Soluzione |
|---------|-----------|
| `Could not detect an active database plugin` | Installa `@rebasepro/server-postgres` in `backend/package.json` |
| Il file di schema non si aggiorna | Verifica che il percorso `--schema-dir` (o la chiave `tables` in `rebase.json`) punti alla cartella corretta |
| La migrazione evidenzia modifiche inattese | Esegui `rebase doctor` per identificare la natura del disallineamento |
| `db push` fallisce in produzione | Utilizza invece la combinazione `db generate` + `db migrate` |
| Una migrazione non deve eliminare dati in CI o produzione | `rebase db migrate --refuse-destructive` esce con codice 1 senza applicare modifiche se un'istruzione pendente elimina dati |
| `db migrate` fallisce con `already exists (42710)` | L'avvio o `db push` hanno già predisposto lo schema — registralo mediante `rebase db migrate --baseline <version>` |
| `db migrate` fallisce con `column … already exists (42701)` | `rebase dev` ha aggiunto la colonna durante l'avvio — applica il baseline alla migrazione nello stesso modo |
| `db push` fallisce sul database gestito con `Error: EOF` | Atlas ha perso la connessione occupata dall'istanza attiva di `rebase dev`. Riprova ad eseguire il comando; se l'errore persiste, arresta preventivamente `rebase dev` |

## Passaggi successivi

- **[Tabelle](/docs/schema/)** — Definisci il tuo modello dati
- **[Riferimento CLI](/docs/cli)** — Tutti i comandi della CLI
- **[SDK tipizzato](/docs/sdk)** — Utilizza l'SDK generato
