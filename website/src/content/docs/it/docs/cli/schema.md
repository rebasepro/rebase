---
sourceHash: 79d8123106a0fa90
title: Generazione dello schema
sidebar_label: Generazione dello schema
description: Genera schemi Drizzle ORM dalle tabelle in backend/schema, crea migrazioni SQL, esegui l'introspezione di un database esistente in file defineTable e mantieni sincronizzato il tuo database con la CLI di Rebase.
---

## Panoramica

Rebase utilizza una pipeline **schema-as-code** in cui le tabelle dichiarate con
`defineTable` in `backend/schema/` costituiscono l'unica fonte di verità. La CLI
le trasforma attraverso una pipeline deterministica:

```
Tables (backend/schema) → Drizzle Schema → SQL Migrations → PostgreSQL
```

Questa pagina descrive ogni comando della CLI coinvolto in tale pipeline.

## La Pipeline

### 1. Tabelle → Schema Drizzle

Le tabelle esportate da `backend/schema/index.ts` descrivono colonne, tipi, relazioni,
enum e row-level security. Ognuno dei comandi seguenti le legge attraverso il loader
utilizzato all'avvio del backend; pertanto, uno schema che non compila — una tabella priva di
`rls`, `"inherit"` senza `defaultRls`, un `defineTable` non esportato
dall'index — arresta il comando con un errore `SchemaDefinitionError` che specifica ciascun problema,
senza scrivere nulla. Il comando `schema generate` genera a partire da esse un file
di schema Drizzle ORM.

Ogni comando che legge lo schema accetta `--schema-dir <dir>` per i progetti
che conservano le tabelle altrove; il valore predefinito è `backend/schema`, oppure la
chiave `tables` dell'app di backend in `rebase.json`. Il flag precedente alla versione 0.31,
`--collections` / `-c`, viene rifiutato con un messaggio che indica il codemod
([`rebase migrate collections-to-tables`](#rebase-migrate)), così come accade per un
progetto che contiene ancora `config/collections`.

### 2. Schema Drizzle → Migrazioni

A partire dallo schema Drizzle generato, `db generate` calcola il diff rispetto alle migrazioni già presenti in `backend/drizzle/migrations/`, riprodotte su un database temporaneo, e produce file di migrazione SQL con timestamp. Non legge mai direttamente il database: una colonna già aggiunta all'avvio o tramite `db push` verrà comunque generata come `ADD COLUMN`.

### 3. Migrazioni → PostgreSQL

Il comando `db migrate` applica le migrazioni in sospeso al database PostgreSQL.

## Comandi

### `rebase schema generate`

Genera un file di schema Drizzle ORM a partire dalle tue tabelle:

```bash
rebase schema generate
```

**Cosa fa:**
- Legge le tabelle esportate da `backend/schema/index.ts`
- Genera `backend/src/schema.generated.ts` con le definizioni delle tabelle Drizzle, gli enum e le relazioni

**Opzioni:**

| Flag | Descrizione |
|------|-------------|
| `--schema-dir` | La directory dello schema (predefinita: `backend/schema`); i percorsi relativi sono risolti a partire dalla cartella in cui si esegue il comando |
| `--output, -o` | Percorso di destinazione per il file di schema generato; i percorsi relativi sono risolti a partire dalla cartella in cui si esegue il comando |
| `--watch, -w` | Monitora le modifiche e rigenera automaticamente |

La **modalità watch** è utile durante lo sviluppo: modificando il file di una tabella, lo schema viene rigenerato all'istante:

```bash
rebase schema generate --watch
```

### `rebase schema stale`

Verifica se lo schema generato corrisponde ancora alle tabelle:

```bash
rebase schema stale          # crea un report ed esce con codice 1 in presenza di discrepanze
rebase schema stale --fix    # rigenera il file invece di limitarsi al report
```

**Cosa fa:**
- Esegue il rendering di ciò che generano le tabelle in `backend/schema/` e lo confronta, dichiarazione per dichiarazione, con `backend/src/schema.generated.ts`
- Specifica ogni differenza riscontrata — una tabella mancante, una colonna con tipo modificato, un'etichetta enum rimossa o chiavi esterne denominate secondo le convenzioni di una versione precedente — ed esce con un codice di errore diverso da zero
- Con `--fix`, rigenera il file invece di limitarsi alla segnalazione

`rebase dev` mantiene il file aggiornato autonomamente, rendendo questo controllo ideale per le fasi di build
o per le pipeline di CI. Accetta i parametri `--schema-dir` e `--output` allo stesso modo di
`rebase schema generate`.

### `rebase schema reconcile`

Rimuove i vincoli o elimina gli elementi che non vengono gestiti all'avvio (boot), dopo aver esaminato il piano di esecuzione:

```bash
rebase schema reconcile                         # rimuove il vincolo NOT NULL sulle colonne rese nullable o rimosse
rebase schema reconcile --drop voice_cache.wav  # ed elimina una colonna non dichiarata in alcuna tabella
```

**Cosa fa:**
- Richiede al backend in esecuzione di elaborare un piano rispetto al proprio database. Questo è il backend a cui puntano il file `.env` e il link cloud, rendendolo compatibile con Rebase Cloud, dove nient'altro può accedere al database.
- Pianifica l'istruzione `DROP NOT NULL` per ogni colonna dichiarata nullable in una tabella ma ancora richiesta come obbligatoria nel database.
- Elenca tutte le colonne non dichiarate in alcuna tabella. Una colonna `NOT NULL` senza valore predefinito blocca qualsiasi inserimento; per questo motivo, anche in questo caso il vincolo viene rimosso, preservando i dati esistenti. Elimina esclusivamente le colonne specificate con `--drop <table>.<column>` e mostra quante righe contengono un valore per ciascuna di esse.
- Applica le modifiche solo dopo aver digitato `yes`. Il server esegue il piano unicamente se il digest corrisponde a quello esaminato; in caso di modifiche intercorse nel database o nelle tabelle, l'operazione viene annullata richiedendo una nuova revisione. Il flag `--yes` ignora la richiesta di conferma.

L'avvio (boot) si limita ad aggiungere elementi: rimuovendo una colonna dal suo `defineTable`, la colonna rimarrà nel database insieme ai relativi dati. Una colonna `NOT NULL` priva di valore predefinito causerebbe quindi il fallimento di ogni inserimento, situazione per la quale i log di avvio consigliano questo comando: senza `--drop` per mantenere i dati, con il flag per rimuovere la colonna. È consigliabile distribuire prima la modifica alla tabella, poiché la riconciliazione viene calcolata in base a ciò che il backend sta eseguendo. Richiede `REBASE_SERVICE_KEY` in `.env`. In locale, `rebase db push` gestisce lo stesso scenario tramite il proprio meccanismo di controllo per modifiche distruttive.

### `rebase schema introspect`

Genera file `defineTable` a partire da un database PostgreSQL esistente:

```bash
rebase schema introspect
```

**Cosa fa:**
- Si connette al database di questo progetto, ovvero quello indicato da `rebase db url` (se si tratta di quello gestito, viene avviato se necessario); `--database-url` consente di specificarne un altro, mentre `--docker` utilizza quello di compose
- Legge ogni tabella, colonna, tipo, chiave esterna e policy, generando
  `backend/schema/<table>.ts` — un `defineTable` per tabella — e il file
  `backend/schema/index.ts` che le esporta (incorporandole in un indice già
  esistente)
- Dichiara ciascuna colonna con il rispettivo tipo Postgres: `col.uuid()`, `col.varchar({ length })`,
  `col.numeric({ precision, scale })`, un enum con le relative etichette e il nome del tipo reale
  (un `pgEnum` se il tipo è condiviso), un array come `<item>.array()`,
  `col.vector({ dimensions })`, chiavi identity e serial, valori predefiniti — definiti
  secondo la sintassi Drizzle. Un tipo non supportato dai builder standard viene convertito in
  `col.custom({ dataType: "<sql type>" })`, che Rebase restituisce esattamente come fornito dal
  driver; `db generate` e `db push` rifiutano l'operazione finché il planner
  non è in grado di gestirlo
- Dichiara la colonna di chiave esterna, la relazione `belongsTo` associata e la corrispondente
  `hasMany` sull'entità di destinazione; una tabella di giunzione diventa una `manyToMany`, con le
  proprie colonne impostate come `pivot`
- Converte le policy di row-level security di ciascuna tabella nel relativo `rls`: nome,
  comando, modalità, elenco `TO`, clausole `USING` e `WITH CHECK`. Le policy `<table>_default_*`
  aggiunte automaticamente da Rebase vengono escluse, in modo che il successivo `db push`
  ricrei ciascuna policy esattamente com'era. Una tabella con row-level security abilitata ma priva di policy
  viene impostata come `rls: "admin-only"`
- Interpreta ogni espressione (la clausola `USING` di una policy, un CHECK, un valore predefinito di colonna) all'interno
  del `search_path` utilizzato dal server, ovvero `public`; di conseguenza, una funzione nello schema `rebase`
  viene scritta come `rebase.roles()`
- Converte i vincoli CHECK interpretabili (`total >= 0`) nel metodo `.validate()` della colonna, lasciando il vincolo originario nel database, dove verrà mantenuto dal push successivo. Ogni CHECK viene inoltre riportato nella sezione "Not carried over" insieme al relativo codice SQL: un push verso un *nuovo* database creerà la validazione a livello applicativo anziché il vincolo SQL
- Dichiara ciascun indice semplice (solo colonne, btree, gin o brin, senza predicati) negli `indexes` della tabella. Un indice applicato unicamente a una colonna con chiave esterna viene demandato alla relazione, che ne gestirà la creazione
- Con l'opzione `--from supabase`, adatta le convenzioni di Supabase per un database in dismissione: un valore predefinito `auth.uid()` diventa `.onCreateUser()` (il server registra l'ID del chiamante), una colonna contenente un ID utente di Supabase (tale default o una chiave esterna verso `auth.users`) viene convertita in `col.text().userId()`, poiché `rebase.users.id` e `rebase.uid()` sono di tipo text, e una policy `TO authenticated` / `TO anon` perde il ruolo (un database Rebase non include nessuno dei due) richiedendo invece un chiamante autenticato / non autenticato; le policy esclusive per `service_role` vengono eliminate. Ciascuna modifica viene annotata all'inizio del file della rispettiva tabella. Senza questo flag le convenzioni rimangono inalterate (necessario se Rebase opera sullo stesso database parallelamente a Supabase) e il processo segnala quando vengono rilevate
- Termina segnalando gli elementi **non** trasferiti: funzioni, trigger, estensioni, CHECK, indici non esprimibili tramite `indexes`, chiavi esterne multicolonna o rivolte ad altri schemi. Il codice SQL per ricreare ciascuno degli elementi compatibili con Postgres viene salvato in `backend/sql/introspected-left-behind.sql`, pronto per essere esaminato e applicato dopo il primo push (`psql "$DATABASE_URL" -f …`, oppure `rebase cloud db query --file …` su Rebase Cloud)
- Ricorda che `DATABASE_URL` fa ancora riferimento al database letto: in uno scenario di migrazione rappresenta l'origine e un comando `db push` eseguito a questo punto scriverebbe su di esso
- Riporta gli elementi che non è stato possibile convertire esattamente all'interno di un commento in cima al file della tabella e nel terminale — un insieme chiuso di stringhe su una colonna di testo, una colonna generata la cui espressione non è stata interpretata, un tipo personalizzato — indicando l'effetto che un push avrebbe su di essi
- Con il flag `--data-inference`, campiona fino a 100 righe per tabella e registra gli elementi di presentazione rilevati — titoli, icone, board, ordinamenti, opzioni dei campi — all'interno di `frontend/src/cms/<table>.tsx` sotto forma di `customizeTable`, qualora il frontend del progetto dipenda da `@rebasepro/cms`. I progetti headless non generano alcun file di questo tipo
- Se eseguito a fronte di un database non attivo, mostra un avviso analogo a quello di `db push`, una sola volta, senza creare alcun elemento. Mostra la directory di output come percorso assoluto

**Opzioni:**

| Flag | Descrizione |
|------|-------------|
| `--schema-dir` | Cartella in cui scrivere i file delle tabelle (predefinita: `backend/schema`). Il parametro `--output` è stato rimosso |
| `--schema` | Lo schema Postgres da esaminare (predefinito: `public`) |
| `--force, -f` | Sovrascrive i file delle tabelle già esistenti; se omesso, i file già presenti vengono ignorati |
| `--database-url` | Esegue la lettura su questo database anziché su quello predefinito del progetto |
| `--docker` | Legge il database del compose, avviandolo se necessario |
| `--from supabase` | Adatta le convenzioni di Supabase (valori predefiniti `auth.uid()`, chiavi esterne ad `auth.users`, `TO anon` / `TO authenticated`) per un database Rebase. Non utilizzare se Rebase opera sullo stesso database affiancato a Supabase |
| `--data-inference` / `--no-data-inference` | Campiona fino a 100 righe per tabella per rilevare formati, vincoli e impostazioni del pannello, oppure legge esclusivamente la struttura. In assenza di entrambi i flag viene richiesta conferma interattiva; in contesti privi di terminale viene letta solo la struttura |

Questa procedura è utile per adottare Rebase su un database preesistente: eseguire prima
l'introspezione, quindi modificare le tabelle generate. Una tabella con row-level security disattivata
viene creata come qualsiasi altra, specificandone l'`rls`; il comando push provvederà ad attivare l'RLS,
segnalandolo nella simulazione (dry run). Un backend privo della cartella `backend/schema`
utilizzerà direttamente il database esistente — consulta [Solo Backend](/docs/getting-started/headless/).
Stai migrando da Supabase? Consulta [Migrazione da Supabase](/docs/recipes/migrate-from-supabase/).

### `rebase db push`

Applica le modifiche allo schema direttamente al database senza creare file di migrazione:

```bash
rebase db push
```

**Cosa fa:**
- Legge lo schema Drizzle generato
- Applica le modifiche direttamente al database (CREATE, ALTER, DROP)
- Esegue prima una simulazione (dry-run) del piano e si interrompe prima di qualsiasi operazione che comporti perdita di dati: eliminazione
  di una tabella, colonna, schema, vista o tipo, un'istruzione `TRUNCATE`, o un cambio di tipo
  di colonna potenzialmente distruttivo per i valori (`timestamptz` → `date`, `numeric` → `integer`),
  oppure una modifica alla chiave primaria — `(id)` → `(id, locale)` assegna a ogni riga un nuovo ID,
  impedendo a link, chiavi esterne e ID salvati altrove di trovare la riga corrispondente.
  Si arresta inoltre
  prima della rimozione di un vincolo CHECK o EXCLUDE presente nel database: non comporta
  perdita di righe, ma da quel momento il database accetterà dati che in precedenza avrebbe rifiutato.
  Nel terminale viene mostrata una richiesta di conferma (in cui Ctrl-C o Ctrl-D equivalgono a rifiutare),
  mentre in ambienti non interattivi l'operazione viene bloccata; l'opzione `--allow-destructive` ne forza l'applicazione. Anche `--yes` mantiene
  tale comportamento in questa versione, accompagnato da un avviso di deprecazione; a partire dalla prossima versione autorizzerà
  esclusivamente operazioni non distruttive. Un'operazione di push interrotta
  a questo punto elimina il database temporaneo `<db>_dev_diff` prima di uscire
- Attiva la row-level security per tutte le tabelle dichiarate, incluse quelle di giunzione, subito dopo
  la modifica allo schema e prima di qualsiasi operazione a rischio di fallimento; in questo modo, un push che si arresta a metà
  lascerà una nuova tabella nello stato di rifiuto di ogni richiesta anziché completamente accessibile
- Applica le policy RLS derivate dalla configurazione `rls` delle tabelle e **rimuove le policy superate da un push precedente**
- Mantiene invariato ogni
  vincolo CHECK ed EXCLUDE presente su una tabella dichiarata. Non potendo una tabella
  dichiarare tali vincoli nel codice, essi sono considerati regole interne del database, create a mano
  o importate tramite `schema introspect`; per rimuoverne uno, è necessario eliminarlo
  manualmente (`ALTER TABLE … DROP CONSTRAINT …`). Nemmeno i trigger e le funzioni personalizzati vengono modificati
- Verifica la corrispondenza esatta dei
  nomi degli oggetti da mantenere inalterati, inclusa la presenza di caratteri quali `.`, `[`, `]` o `*`
- Genera qualsiasi
  [indice su chiave esterna derivato da Rebase](/docs/backend/indexes#foreign-keys-are-indexed-for-you)
  che dovesse mancare in una tabella esistente **prima** della fase di pianificazione, tramite
  `CREATE INDEX CONCURRENTLY`, consentendo la prosecuzione delle scritture sulla tabella durante la generazione;
  Atlas lo troverà quindi già applicato. L'opzione `--dry-run` mostra questi indici senza crearli
- Firma le
  policy applicate secondo la medesima modalità adottata all'avvio del server, cosicché il primo riavvio successivo a
  un push le lasci inalterate senza dover ricreare ogni elemento
- L'opzione `--dry-run`
  elenca le modifiche alla row-level security che il push andrebbe ad applicare, sotto la dicitura "Planned
  row-level security changes": le tabelle su cui verrà abilitata l'RLS e ogni
  policy creata, sostituita o eliminata, determinate secondo la logica dei passaggi interni del push. Il messaggio "No changes" viene mostrato solo quando né lo schema né
  la row-level security necessitano di variazioni. Qualora la firma di una policy non corrisponda alla
  sua regola, o ne sia sprovvista (es. generata da `db migrate` o creata manualmente), la modalità
  dry-run la ricrea provvisoriamente a partire dalla regola con un altro nome all'interno di una transazione
  sottoposta a rollback, confrontando il risultato con quanto memorizzato in Postgres: in assenza di differenze,
  non viene considerata una modifica. Pertanto, una regola letta da `schema introspect` come SQL non pianifica alcuna modifica,
  così come le policy applicate da `db migrate`. Soltanto quelle per cui non è stato possibile effettuare il confronto (ad esempio, se il
  lock sulla tabella non viene ottenuto entro due secondi) vengono elencate separatamente. Il comando di push
  vero e proprio stampa una riga di riepilogo con il conteggio delle modifiche
- Mostra ciascuna
  istruzione applicata da Atlas. Atlas stabilisce la connessione senza SSL verso i database su questa
  macchina (`localhost`, `127.x`, `::1`) il cui URL non contenga il parametro `sslmode`, analogamente a quanto fa l'applicazione,
  evitando l'errore `SSL is not enabled on the server`; gli URL che specificano
  `sslmode`, o che puntano a un altro host, vengono inoltrati senza modifiche. Un'esecuzione di Atlas
  che fallisce prima della fase di pianificazione non lascia residui del database `<db>_dev_diff`
- L'opzione `--dry-run`
  non modifica alcun file di progetto: `src/schema.generated.ts` viene mantenuto inalterato
  e le copie `drizzle/*.sql` introdotte da versioni precedenti vengono elencate anziché
  eliminate. Solo l'input del piano viene salvato in `.rebase/sql/`, cartella non inclusa nel versionamento
- **Non** produce file di migrazione

**Tempi di esecuzione.** La quasi totalità del tempo impiegato da un push è occupata dal calcolo del piano da parte di Atlas: esso
ricostruisce lo schema desiderato all'interno di un database di appoggio e calcola la differenza rispetto a quello reale;
l'impatto prestazionale cresce più che proporzionalmente rispetto al numero di tabelle — su un computer portatile standard
si registrano circa 0,25 s per piano con 11 tabelle, 0,9 s con 111 e 5,5 s con 411. Un push privo di modifiche
esegue la pianificazione una sola volta; un push con modifiche la esegue due volte (la simulazione
valutata dal gate per le operazioni distruttive, seguita dall'applicazione effettiva). Di conseguenza, su uno schema composto da
400 o più tabelle il push richiederà decine di secondi, con tempi superiori su macchine lente o sovraccariche.
Tale durata è imputabile ad Atlas e non al proprio database: le operazioni correlate — generazione del codice
SQL, gestione dei lock RLS, indici di ricerca, trigger, policy e ruoli — richiedono solo pochi secondi per tali volumi,
operando su una singola connessione verso il database.

**File generati durante il processo**, tutti collocati in `.rebase/sql/` all'interno della directory
di backend. Sia `db push` che `db generate` creano tutti e cinque i file a partire dalle tabelle
a ogni esecuzione, prima ancora di leggerli; pertanto, un'eventuale versione committata non verrebbe mai
letta. La directory include il proprio `.gitignore` e non va inclusa nel repository.

| File | Contenuto |
|------|-----------|
| `schema.sql` | Tabelle, colonne, vincoli e indici — lo stato desiderato gestito da Atlas, e l'unico su cui viene calcolato il diff |
| `policies.sql` | Le policy RLS derivate dalla configurazione `rls` delle tabelle |
| `search.sql` | Funzioni di ricerca full-text e colonne generate, per le tabelle dotate di blocco `search` |
| `vector.sql` | Estensioni pgvector e indici ANN |
| `triggers.sql` | La funzione `rebase.set_updated_at()` e i trigger `BEFORE UPDATE` alla base di `.onUpdateNow()` |

Atlas gestisce unicamente il primo di questi file; pertanto, `db push` e la procedura
di verifica dello schema all'avvio applicano autonomamente gli altri quattro. Un deployment basato **esclusivamente su migrazioni** — ovvero
che esegue `db migrate` senza mai ricorrere a `db push` — richiede l'inclusione manuale di questi quattro elementi
all'interno di una migrazione; `db generate` segnala quando una modifica non risulta visibile ad Atlas.

Nei progetti in cui questi file erano stati inclusi in `drizzle/` nelle versioni precedenti,
tali copie verranno eliminate alla prima esecuzione, con il comando che elencherà ciascun file per consentirne
il commit dell'eliminazione. Verranno rimossi solo i file che presentano l'intestazione
del generatore automatico. Qualsiasi file creato manualmente rimarrà invariato, così come la directory `drizzle/migrations/`.

:::note[La modifica di una regola di sicurezza ne rinomina la policy]
Una regola priva di un `name` esplicito viene compilata nel formato `<table>_<op>_<hash>`, in cui l'hash rappresenta la semantica della regola — per questo motivo la *modifica* di una regola (a differenza dell'aggiunta) genera una policy con un nuovo nome, lasciando presente la precedente.

In passato questo aspetto comportava criticità rilevanti: Postgres combina le policy `PERMISSIVE` tramite operatore OR; di conseguenza, una clausola `USING (rebase.uid() IS NOT NULL)` ormai superata continuava ad accordare tutti i permessi, a prescindere da quanto restrittiva fosse la nuova regola. L'inasprimento della regola risultava privo di effetto, nonostante il push segnalasse l'esito positivo.

`db push` ora riconcilia questo comportamento: rimuove le policy generate non più associate ad alcuna regola e segnala — senza eliminarle — le policy con nome personalizzato non descritte nelle tabelle, poiché indistinguibili da istruzioni SQL scritte deliberatamente.

Per verificare lo stato di un database aggiornato tramite push prima di questa modifica, eseguire `rebase doctor --policies`. Può essere utilizzato come gate di CI: restituisce un codice di uscita diverso da zero in caso di disallineamento (drift), oppure qualora non sia stato possibile completare il controllo — ad esempio in assenza di `DATABASE_URL`, con un percorso `--schema-dir` non valido o in mancanza dei permessi di lettura su `pg_policies` per il ruolo della CI. Un controllo non eseguito non viene considerato superato.

I comandi `doctor` e `db push` distinguono le due tipologie di policy orfane. Una policy con nome generato automaticamente è da considerarsi obsoleta e verrà rimossa dal push successivo. Qualsiasi altro nome indica una creazione manuale o tramite altri strumenti e rimane in vigore: per mantenerla è sufficiente descriverla nell'attributo `rls` della tabella (la vista RLS di Studio ne consente l'importazione), oppure eliminarla manualmente qualora non sia più necessaria.
:::

:::caution
`db push` modifica direttamente il database. Utilizzalo esclusivamente in fase di sviluppo. Per gli ambienti di produzione, adotta `db generate` insieme a `db migrate` per creare file di migrazione verificabili.
:::

### `rebase db generate`

Genera i file di migrazione SQL a partire dalle modifiche allo schema:

```bash
rebase db generate
```

**Cosa fa:**
- Confronta lo schema Drizzle con lo stato risultante dalle migrazioni in `drizzle/migrations/`, anziché con il database reale
- Produce file di migrazione SQL con timestamp all'interno di `backend/drizzle/migrations/`
- I file possono essere esaminati, modificati e inclusi nel sistema di controllo versione
- Evidenzia ogni
  istruzione della nuova migrazione che comporta la perdita di dati, impiegando lo stesso controllo effettuato
  da `db push` prima dell'applicazione: rimozione di tabelle, colonne, schemi, viste o tipi, istruzioni
  `TRUNCATE`, modifiche al tipo di colonna con possibile perdita di dati, variazioni
  alle chiavi primarie, o l'eliminazione di vincoli CHECK o EXCLUDE presenti nel database. Il file viene
  comunque creato uscendo con codice 0, limitandosi a emettere un avviso senza bloccare l'operazione.
- Si conclude indicando le
  operazioni successive: l'esecuzione di `rebase db migrate` e, per la prima migrazione del progetto, l'indicazione
  del parametro `--baseline <version>` necessario qualora il database sia già stato inizializzato all'avvio. Le
  migrazioni successive non riporteranno l'indicazione della baseline, poiché l'impostazione di una baseline su modifiche distruttive
  salterebbe le relative istruzioni `DROP`; un'esecuzione che non genera migrazioni si limiterà a notificare tale esito.

**Un vincolo CHECK aggiunto da una migrazione manuale viene rimosso dalla migrazione successiva.** Il comando `db generate`
confronta i file di migrazione e non il database; Atlas non dispone di meccanismi per escludere singoli
oggetti da tale confronto. Di conseguenza, un vincolo CHECK o EXCLUDE introdotto manualmente all'interno
di una migrazione, e non dichiarabile a livello di tabella, verrà riproposto come
`ALTER TABLE … DROP CONSTRAINT …` nella successiva migrazione generata, accorpato alla medesima
istruzione della modifica principale. Il report indicherà tale rimozione qualora
il vincolo sia già presente nel database, senza però escluderlo dal
file. Sarà necessario rimuovere la clausola prima di eseguire `rebase db migrate`, oppure consentire a
`rebase db migrate --refuse-destructive` di interrompere l'operazione. Il comando `db push` esamina direttamente il
database mantenendo il vincolo.

Le migrazioni generate sono file SQL standard, ispezionabili e modificabili prima dell'applicazione.

### `rebase db migrate`

Applica tutte le migrazioni in sospeso:

```bash
rebase db migrate
```

**Cosa fa:**
- Esamina `drizzle/migrations/` per rilevare le migrazioni non ancora applicate
- Le applica in ordine sequenziale al database
- Tiene traccia delle migrazioni già eseguite
- Firma le
  policy di row-level security secondo la medesima logica di `db push` e dell'avvio del server,
  facendo sì che il primo avvio successivo alla migrazione le mantenga inalterate senza dover ricreare ogni
  singolo elemento. Essendo una migrazione generata a partire dallo stato delle tabelle in quel dato momento, la policy
  viene firmata unicamente se corrisponde esattamente a quanto generato dalla regola attuale: il comando migrate la ricrea
  temporaneamente a partire dalla regola con un altro nome in una transazione sottoposta a rollback,
  confrontando il risultato con quanto presente in Postgres, allo stesso modo di `db push --dry-run`. Una policy
  che differisce non riceve la firma e il successivo avvio provvederà a riapplicare la rispettiva tabella

L'opzione `--refuse-destructive`
forza il rifiuto dell'operazione. Esegue prima una simulazione delle migrazioni in sospeso. Se una qualsiasi
istruzione comporta perdita di dati, secondo i medesimi criteri adottati da `db push` e `db generate`,
mostra l'elenco di tali istruzioni ed esce con codice 1. Nessuna modifica viene applicata, nemmeno i file
precedenti all'istruzione critica. In assenza di questo flag, `db migrate` opera normalmente
applicando tutti i file in sospeso:

```bash
rebase db migrate --refuse-destructive
```

Una migrazione che ricostruisce una colonna di ricerca ne richiede preventivamente l'eliminazione; di conseguenza, questo flag
interromperà anche tale migrazione. Verificare l'elenco generato, quindi procedere con l'esecuzione di `rebase db migrate`
senza il flag per consentirne l'applicazione.

#### Impostare la baseline su un database già inizializzato da Rebase

Ogni avvio di Rebase verifica e assicura lo schema, e `rebase db push` lo applica in modo diretto. Di conseguenza, un database sul quale sia stata eseguita una di queste operazioni conterrà già le tabelle e i tipi previsti dalla prima migrazione, provocando l'interruzione di `rebase db migrate` con l'errore `pq: type "posts_status" already exists (42710)`.

La migrazione è corretta: il database è stato semplicemente inizializzato con un metodo alternativo. È necessario allineare lo storico registrando lo stato attuale, per poi procedere regolarmente con le migrazioni:

```bash
rebase db migrate --baseline 20260906101530
rebase db migrate
```

La versione corrisponde al prefisso numerico del file di migrazione che descrive lo stato *attuale* del database. Quella specifica migrazione e tutte le precedenti verranno contrassegnate come già applicate; le successive verranno eseguite normalmente. Su un database vergine, non inizializzato da precedenti avvii, non è richiesta alcuna baseline ed è possibile procedere direttamente con la migrazione.

La stessa situazione può ripresentarsi durante il normale flusso di sviluppo: modificando una tabella mentre `rebase dev` è in esecuzione, l'avvio aggiungerà la colonna prima che `rebase db generate` possa scrivere la relativa migrazione, provocando il blocco di `rebase db migrate` con l'errore `column … already exists (42701)`. In tal caso, impostare la baseline su quella migrazione con la medesima procedura. Il flag `--baseline` funziona anche su database che contengono già uno storico di migrazioni: contrassegna come applicati tutti i passaggi fino alla versione indicata tramite `atlas migrate set`, notificando l'operazione o segnalando l'assenza di elementi da registrare qualora lo storico sia già allineato. L'indicazione di una versione non presente tra i file di `drizzle/migrations` blocca l'operazione prima dell'esecuzione, mostrando l'elenco delle versioni disponibili.

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

I comandi `rebase db branch switch` (incluso `switch --off`) e `rebase db branch prune`
sono stati introdotti di recente. I comandi `create`, `list`, `info` e `delete` sono disponibili dalla versione 0.17.

Ciascun branch è una copia integrale del database generata mediante `CREATE DATABASE ... TEMPLATE`;
richiede pertanto un'istanza PostgreSQL reale e comporta un'occupazione di disco equivalente a quella del database di origine.

### `rebase doctor`

Rileva disallineamenti a tre vie tra le tabelle definite nel codice, lo schema Drizzle generato e il database PostgreSQL attivo:

```bash
rebase doctor
```

**Elementi verificati:**
- Tabelle ↔ Schema generato — sono sincronizzati?
- Schema generato ↔ Database — sono presenti modifiche non applicate?
- Tabelle ↔ Database — esistono disallineamenti imprevisti?

Esegui `doctor` ogni volta che riscontri problemi di sincronizzazione. Permette di individuare con esattezza l'origine della discrepanza.

Il confronto con il database include la verifica effettuata all'avvio prima della segnalazione di disaccordo tra `schema.generated.ts` e il database, eseguita tramite la medesima logica. Tutte le differenze segnalate all'avvio compaiono pertanto nel report con la stessa formulazione: una colonna definita NOT NULL da una parte e nullable dall'altra, oppure una colonna ancora presente nel database ma assente nel file (l'avvio non elimina mai colonne, lasciando residui in caso di proprietà rinominate). Ognuno di questi casi genera un avviso, suggerendo l'uso di `rebase db push` per la risoluzione.

Il confronto legge il database di progetto ricavato secondo i criteri di risoluzione di `rebase db url` — in una configurazione iniziale pulita si tratta di quello gestito, che viene avviato da `doctor`. Qualora non sia possibile risolvere alcun database, questa fase viene segnalata come **skipped** (ignorata) anziché superata e l'esecuzione non restituirà mai il messaggio "All schemas are in sync": un controllo non eseguito non garantisce l'assenza di problemi.

Vengono inoltre segnalate tutte le tabelle prive di un [blocco `search`](/docs/backend/search) contenenti indicativamente più di 10.000 righe. Le ricerche effettuate su di esse — tramite casella di ricerca del pannello di amministrazione, `.search()`, `?searchString=` — si traducono in query `ILIKE '%term%'` sulle colonne di testo, non supportate da indici; di conseguenza, ogni ricerca richiede la scansione dell'intera tabella, ripetuta per il conteggio totale (circa un terzo di secondo con 100.000 righe, con tempi crescenti all'aumentare dei dati). Il conteggio delle righe si basa sulle stime interne di Postgres, evitando scansioni effettive della tabella. Si tratta di un avviso informativo: non modifica il codice di uscita e non genera indici automatici.

Viene inoltre segnalata la presenza di **tabelle di giunzione orfane**: tabelle nello schema `public` con struttura tipica di una giunzione many-to-many non dichiarata in alcuna tabella del codice. La struttura prevede due colonne che costituiscono insieme la chiave primaria, ciascuna chiave esterna verso una tabella dichiarata. Rinomimare o rimuovere una relazione `manyToMany` lascia la vecchia giunzione nel database, poiché le operazioni di push e avvio si limitano a creare tabelle, mantenendo tutte le righe di collegamento esistenti. La nota ha valore puramente informativo e non altera il codice di uscita. La soluzione consiste nell'eseguire l'istruzione `DROP TABLE`, mostrata da `doctor` senza mai applicarla in automatico.

### `rebase generate-sdk`

Genera un SDK tipizzato a partire dalle tabelle:

```bash
rebase generate-sdk
```

**Cosa fa:**
- Legge le tabelle esportate da `backend/schema/index.ts` attraverso il loader utilizzato all'avvio del backend, garantendo che l'SDK descriva con precisione le sole tabelle effettivamente esposte; schemi che non compilano arrestano il processo
- Genera i tipi TypeScript per ogni tabella all'interno di `generated/sdk/`
- Crea il file `database.types.ts` per l'utilizzo con `createRebaseClient<Database>()`: include il tipo `Database`, `TableName` (l'unione di tutti gli slug) e `tablesDictionary` / `TablesDictionary`, la mappa tra accessor e slug

`rebase dev` esegue automaticamente questo comando all'avvio e a ogni salvataggio all'interno di
`backend/schema/`. Può essere eseguito manualmente in CI, all'interno di repository privi di
tabelle proprie (vedere l'opzione `--from` sotto), o in qualsiasi contesto in cui `rebase dev` non sia attivo.

**Opzioni:**

| Flag | Descrizione |
|------|-------------|
| `--schema-dir` | Cartella dello schema (predefinita: `backend/schema`, o la chiave `tables` in `rebase.json`); i percorsi relativi vengono risolti a partire dalla cartella di esecuzione |
| `-o`, `--output` | Cartella di destinazione per l'SDK (predefinita: `generated/sdk/`) |
| `--from <link\|url>` | Legge lo schema da un progetto in esecuzione anziché dai sorgenti locali. `link` utilizza il progetto collegato a questa cartella. |
| `--token` | Bearer token per l'endpoint di contratto (predefinito: `$REBASE_SERVICE_KEY` dall'ambiente della shell; `.env` non viene letto) |
| `--register` | Tipizza anche i dati lato server: scrive i tipi e una dichiarazione `Register` in `backend/generated/`, memorizzandoli in `rebase.json` — consulta [Dati tipizzati lato server](/docs/backend/typed-server-data/) |

L'opzione `--from` permette ai repository che non definiscono tabelle — frontend separati,
applicazioni web secondarie, app mobile — di generare un client fortemente tipizzato a partire
dal progetto con cui comunicano: legge le `tables` tramite l'endpoint `/api/meta/contract`
del backend in esecuzione. La chiave `REBASE_SERVICE_KEY` viene trasmessa esclusivamente al progetto a cui la
cartella corrente risulta collegata; per qualsiasi altro host è necessario fornire esplicitamente il flag `--token`. La chiave definita nel file
`.env` appartiene al backend locale e non viene mai inviata all'esterno.
In caso di rifiuto, il messaggio
indicherà la causa specifica: valore `--token` non valido, chiave della shell non valida, chiave
non inviata a un host non collegato, chiave presente solo in `.env`, oppure assenza totale di una chiave.

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

I nomi dei campi nei tipi generati corrispondono a quelli forniti dall'API. Il nome di trasporto
di un campo corrisponde alla chiave della colonna, e l'API adotta uniformemente la convenzione camelCase: l'introspezione
converte una colonna `created_at` in `createdAt: col.timestamp({ withTimezone: true })`, il cui nome SQL
è la versione snake_case della chiave, esponendola come `row.createdAt`. La colonna nel database
non viene alterata. L'*accessor* della tabella viene convertito nel nome di una proprietà
con lo stesso criterio (`my-notes` → `client.data.myNotes`), valore che `tablesDictionary`
riconverte successivamente nello slug originale.

### `rebase migrate`

Il comando `rebase migrate collections-to-tables [dir]` trasferisce `config/collections` verso
`backend/schema` (un `defineTable` per collezione, ciascuna colonna definita esplicitamente
nella sua posizione originale con la sintassi Drizzle, e il file `index.ts` con
`defaultRls`) e `frontend/src/cms` (un `customizeTable` per ogni collezione personalizzata,
i file `defineFirestoreCollection`, `ui-config.json`), genera i file
`backend/resources.ts`, `backend/storage.ts` e `backend/generated/register.ts`,
introduce `rebaseBackendGuard()` nel file `vite.config.ts` dell'applicazione, quindi esegue
`rebase migrate sdk-calls`, che sostituisce `.collection(` con `.table(`, applica le
ulteriori ridenominazioni dell'SDK e adatta le origini delle regole `existsIn` / `membership` nel codice,
aggiornando i riferimenti per gli elementi spostati in altri pacchetti con la versione 0.31
([elenco completo](/docs/upgrading/0-30-to-0-31-imports/)), aggiungendo i pacchetti alle
dipendenze del modulo ("Dependencies added": eseguire `pnpm install`). Aggiornare tutti i pacchetti `@rebasepro` alla versione 0.31 prima dell'esecuzione.
Ogni esecuzione verifica il risultato: il codice SQL generato — DDL, policy, ricerca,
vettori, trigger, viste, schema Drizzle — deve corrispondere esattamente byte per byte, pena il ripristino
di tutti i file allo stato originale. Gli elementi non convertibili vengono rifiutati segnalando file e riga,
mentre le attività residue a carico dell'utente vengono indicate come passaggi manuali numerati, che terminano con
l'istruzione `rebase skills install` qualora il progetto includa agent skills. I moduli personalizzati in
`config/` vengono mantenuti; il comando fornisce l'istruzione `git rm` per i file sostituiti. Gestisce
inoltre le collezioni Firestore create tramite funzioni, gli alias di percorso, i pannelli montati
all'esterno di `App.tsx` e tutte le applicazioni statiche prive di guard ([elenco dettagliato](/docs/upgrading/0-30-to-0-31/#108-tables-in-backendschema-replace-configcollections--run-the-codemod-first)).
A seguito di `git rm`, il flag `--check` restituirà `already-migrated`.

| Flag | Effetto |
|---|---|
| `--dry-run` | Mostra file, rifiuti, note e passaggi manuali senza scrivere alcuna modifica. Consigliato per iniziare. |
| `--check` | Su progetti migrati: verifica che `backend/schema` generi ancora il medesimo SQL. Esce con codice 1 mostrando il diff o se una regola ha mutato significato. |
| `--accept-rule-changes` | Da usare con `--check`: attesta che le regole nella sezione "Review before deploying" sono state verificate. |
| `--json` / `--force` / `--skip-sdk-calls` | Restituisce il report in formato JSON (con `ruleChanges`); esecuzione su alberi di lavoro non puliti o su output già modificati; non modifica il codice utente. |

Esaminare i due elenchi forniti nell'output dell'SDK: **"Rewritten by name — review"** (ricevitori
non tipizzati, data slot, test double) e **"Left unchanged — check each"**
(rinominare gli elementi appartenenti all'SDK; [una ricerca mirata](/docs/upgrading/0-30-to-0-31-by-hand/#sdk-calls-no-type-checker-sees) permette di individuare i rimanenti).

La verifica SQL garantisce la fedeltà della conversione a livello di schema, ma non che una regola mantenga
l'esatto significato originario. La sezione finale dell'output, **"Review before deploying: these rules
change meaning"**, elenca tutte le regole la cui policy accorda ora permessi differenti
— una regola semplice come `access: "authenticated"` non concedeva alcun permesso in precedenza, mentre ora consente l'accesso a qualsiasi chiamante autenticato
([le quattro casistiche](/docs/upgrading/0-30-to-0-31/#review-before-deploying-these-rules-change-meaning)).
Verificare quindi la coerenza con il database: `rebase db push --dry-run` dovrebbe indicare "No
changes: the database already matches these tables.", mentre
`rebase doctor --policies` non deve rilevare alcun disallineamento (drift).

## Flusso di lavoro in sviluppo

Flusso di lavoro rapido e iterativo per le fasi di sviluppo:

```bash
# 1. Modifica una tabella in backend/schema/
# 2. Genera lo schema Drizzle
rebase schema generate

# 3. Applica direttamente al database di sviluppo
rebase db push
```

## Flusso di lavoro in produzione

Flusso di lavoro controllato e verificabile per gli ambienti di produzione:

```bash
# 1. Modifica una tabella in backend/schema/
# 2. Genera lo schema Drizzle
rebase schema generate

# 3. Genera i file di migrazione SQL
rebase db generate

# 4. Esamina il codice SQL generato in backend/drizzle/migrations/
# 5. Effettua il commit della migrazione nel controllo versione
git add backend/drizzle/migrations/

# 6. Applica in produzione
#    Un database già inizializzato da Rebase necessita di una baseline la prima volta —
#    consulta la sezione "Impostare la baseline su un database già inizializzato da Rebase" sopra.
rebase db migrate
```

## Risoluzione dei problemi

| Sintomo | Soluzione |
|---------|-----------|
| `Could not detect an active database plugin` | Installa `@rebasepro/server-postgres` in `backend/package.json` |
| Il file di schema non si aggiorna | Verifica che il percorso specificato in `--schema-dir` (o la chiave `tables` in `rebase.json`) punti alla cartella corretta |
| La migrazione evidenzia modifiche inattese | Esegui `rebase doctor` per individuare eventuali disallineamenti |
| `db push` fallisce in ambiente di produzione | Utilizza `db generate` combinato con `db migrate` |
| Una migrazione non deve eliminare dati in CI o produzione | L'opzione `rebase db migrate --refuse-destructive` esce con codice 1 senza applicare alcuna modifica quando un'istruzione in sospeso risulta distruttiva per i dati |
| `db migrate` fallisce restituendo `already exists (42710)` | Lo schema è già stato predisposto all'avvio o tramite `db push` — allinea lo storico eseguendo `rebase db migrate --baseline <version>` |
| `db migrate` fallisce restituendo `column … already exists (42701)` | La colonna è stata aggiunta all'avvio da `rebase dev` — imposta la baseline su quella migrazione adottando lo stesso criterio |
| `db push` sul database gestito fallisce con `Error: EOF` | Atlas ha perso la connessione mantenuta attiva da `rebase dev`. Riprova l'esecuzione; se l'errore persiste, arresta preventivamente `rebase dev` |

## Passaggi successivi

- **[Tabelle](/docs/schema/)** — Definisci il tuo modello dati
- **[Riferimento CLI](/docs/cli)** — Tutti i comandi della CLI
- **[SDK Tipizzato](/docs/sdk)** — Utilizza l'SDK generato
