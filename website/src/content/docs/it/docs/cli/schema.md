---
sourceHash: 06945ca1e787897f
title: Generazione dello schema
sidebar_label: Generazione dello schema
description: Genera schemi Drizzle ORM dalle tabelle in backend/schema, crea migrazioni SQL, esegui l'introspezione di un database esistente in file defineTable e mantieni sincronizzato il database con la CLI di Rebase.
---

## Panoramica

Rebase utilizza una pipeline **schema-as-code** in cui le tabelle dichiarate con
`defineTable` in `backend/schema/` rappresentano l'unica fonte di verità. La CLI
le trasforma attraverso una pipeline deterministica:

```
Tables (backend/schema) → Drizzle Schema → SQL Migrations → PostgreSQL
```

Questa pagina copre ogni comando della CLI coinvolto in tale pipeline.

## La pipeline

### 1. Tabelle → Schema Drizzle

Le tabelle esportate da `backend/schema/index.ts` descrivono colonne, tipi, relazioni,
enum e la row-level security (sicurezza a livello di riga). Ogni comando seguente le legge tramite il loader
da cui si avvia il backend, quindi uno schema che non compila — una tabella senza
`rls`, `"inherit"` senza `defaultRls`, un `defineTable` non esportato
dall'index — blocca il comando con un `SchemaDefinitionError` che specifica ciascun problema,
e non viene scritto nulla. Il comando `schema generate` produce un file di schema Drizzle ORM
a partire da esse.

Ogni comando che legge lo schema accetta `--schema-dir <dir>` per un progetto
che conserva le tabelle altrove; il valore predefinito è `backend/schema`, o la
chiave `tables` dell'app backend in `rebase.json`. Il flag pre-0.31 `--collections` / `-c`
viene rifiutato con un messaggio che indica il codemod
([`rebase migrate collections-to-tables`](#rebase-migrate)), così come un
progetto che contiene ancora `config/collections`.

### 2. Schema Drizzle → Migrazioni

A partire dallo schema Drizzle generato, `db generate` esegue un diff rispetto alle migrazioni già presenti in `backend/drizzle/migrations/`, riprodotte su un database temporaneo (scratch), e produce file di migrazione SQL con timestamp. Non legge mai il tuo database: una colonna già aggiunta all'avvio (boot) o con `db push` risulterà comunque come `ADD COLUMN`.

### 3. Migrazioni → PostgreSQL

Il comando `db migrate` applica le migrazioni in sospeso al tuo database PostgreSQL.

## Comandi

### `rebase schema generate`

Genera un file di schema Drizzle ORM dalle tue tabelle:

```bash
rebase schema generate
```

**Cosa fa:**
- Legge le tabelle esportate da `backend/schema/index.ts`
- Genera `backend/src/schema.generated.ts` con le definizioni delle tabelle Drizzle, gli enum e le relazioni

**Opzioni:**

| Flag | Descrizione |
|------|-------------|
| `--schema-dir` | La directory dello schema (predefinita: `backend/schema`); i percorsi relativi vengono risolti a partire dalla cartella di esecuzione del comando |
| `--output, -o` | Percorso di output per il file di schema generato; i percorsi relativi vengono risolti a partire dalla cartella di esecuzione del comando |
| `--watch, -w` | Monitora le modifiche e rigenera automaticamente |

La **modalità watch** è utile durante lo sviluppo — modifica un file di tabella e lo schema si rigenera all'istante:

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
- Riporta ogni differenza — una tabella mancante, una colonna con tipo modificato, un'etichetta di enum rimossa o chiavi esterne denominate secondo la logica di una versione precedente — ed esce con codice diverso da zero
- Con `--fix`, rigenera il file invece di limitarsi a segnalare le differenze

`rebase dev` mantiene il file aggiornato autonomamente, quindi questo è il controllo da usare per
una build o in una fase di CI. Accetta `--schema-dir` e `--output` come
fa `rebase schema generate`.

### `rebase schema reconcile`

Rilassa i vincoli ed elimina ciò che il boot non tocca, dopo aver esaminato il piano:

```bash
rebase schema reconcile                         # relax NOT NULL on columns made nullable or removed
rebase schema reconcile --drop voice_cache.wav  # and drop a column no table declares
```

**Cosa fa:**
- Chiede al backend in esecuzione di elaborare un piano confrontandosi con il proprio database. Questo è il backend a cui puntano il file `.env` e il link cloud, quindi funziona su Rebase Cloud, dove nient'altro può accedere al database.
- Pianifica `DROP NOT NULL` per ogni colonna che una tabella dichiara nullable ma che il database richiede ancora come obbligatoria.
- Elenca ogni colonna non dichiarata da alcuna tabella. Una colonna `NOT NULL` senza valore predefinito blocca ogni inserimento, pertanto anch'essa viene rilassata, mantenendo i suoi dati. Vengono rimosse solo le colonne specificate con `--drop <table>.<column>`, mostrando quante righe contengono un valore in ciascuna di esse.
- Applica le modifiche solo dopo aver digitato `yes`. Il server esegue il piano unicamente in base al digest di quello visualizzato, quindi se nel frattempo il database o le tabelle sono cambiati, rifiuta l'esecuzione richiedendo una nuova revisione. `--yes` salta la richiesta di conferma.

L'avvio (boot) si limita sempre e solo ad aggiungere, perciò dopo aver rimosso una colonna dal relativo `defineTable`, la colonna rimane nel database con i suoi dati. Una colonna `NOT NULL` priva di valore predefinito fa fallire ogni operazione di inserimento, e il log di avvio suggerisce questo comando: senza `--drop` per preservare i dati, con `--drop` per eliminare la colonna. Effettua prima il deploy della modifica alla tabella, poiché reconcile pianifica le azioni rispetto a ciò che il backend sta eseguendo. Richiede `REBASE_SERVICE_KEY` in `.env`. In locale, `rebase db push` copre la stessa esigenza attraverso il suo controllo sulle modifiche distruttive.

### `rebase schema introspect`

Genera file `defineTable` a partire da un database PostgreSQL esistente:

```bash
rebase schema introspect
```

**Cosa fa:**
- Si connette al database di questo progetto, quello stampato da `rebase db url` (se è quello gestito, viene avviato se necessario); `--database-url` ne indica un altro, mentre `--docker` usa quello di compose
- Legge ogni tabella, colonna, tipo, foreign key e policy, e scrive
  `backend/schema/<table>.ts` — un `defineTable` per tabella — e il
  file `backend/schema/index.ts` che le esporta (unito a un index già
  esistente)
- Dichiara ogni colonna con il rispettivo tipo Postgres: `col.uuid()`, `col.varchar({ length })`,
  `col.numeric({ precision, scale })`, un enum con le relative etichette e il nome del tipo reale
  (un `pgEnum` quando il tipo è condiviso), un array come `<item>.array()`,
  `col.vector({ dimensions })`, chiavi identity e serial, valori predefiniti — nella sintassi
  prevista da Drizzle. Un tipo non supportato da alcun builder diventa
  `col.custom({ dataType: "<sql type>" })`, che Rebase gestisce così come viene restituito dal
  driver; `db generate` e `db push` lo rifiutano finché il planner
  non è in grado di gestirlo
- Dichiara la colonna foreign-key, il `belongsTo` su di essa e la relazione inversa
  `hasMany` sulla destinazione; una tabella di giunzione diventa un `manyToMany`, con le proprie
  colonne utilizzate come `pivot`
- Legge le policy di row-level security di ciascuna tabella nel rispettivo `rls`: nome,
  comando, modalità, elenco `TO`, `USING` e `WITH CHECK`. Le policy `<table>_default_*`
  aggiunte automaticamente da Rebase vengono escluse, in modo che il successivo `db push` ricrei
  ogni policy esattamente com'era. Una tabella con la row-level security abilitata ma priva di policy
  viene scritta con `rls: "admin-only"`
- Legge ogni espressione (la clausola `USING` di una policy, un CHECK, un valore predefinito di colonna) sotto
  il `search_path` utilizzato dal server, ovvero `public`, in modo che una funzione nello schema `rebase`
  venga scritta come `rebase.roles()`
- Converte un vincolo CHECK leggibile (`total >= 0`) nel metodo `.validate()` della colonna e lascia il vincolo vero e proprio nel database, dove il push successivo lo manterrà. Ogni CHECK viene inoltre elencato nella sezione "Not carried over" con il relativo SQL: un push verso un *nuovo* database creerà la validazione, non il vincolo
- Dichiara ogni indice semplice (solo colonne, btree, gin o brin, senza predicato) negli `indexes` della tabella. Un indice basato unicamente su una colonna foreign-key viene delegato alla relazione, che ne creerà uno
- Con `--from supabase`, traduce le convenzioni di Supabase per un database da cui si sta migrando: un default di colonna impostato su `auth.uid()` diventa `.onCreateUser()` (il server scrive l'ID del chiamante), una colonna contenente un ID utente di Supabase (tale default o una foreign key verso `auth.users`) diventa `col.text().userId()`, poiché `rebase.users.id` e `rebase.uid()` sono di tipo text, e una policy `TO authenticated` / `TO anon` perde il ruolo (un database Rebase non include nessuno dei due) e richiede invece un chiamante autenticato o non autenticato (signed-in / signed-out); una policy destinata solo a `service_role` viene eliminata. Ogni modifica viene annotata all'inizio del file della tabella. Senza questo flag, questi elementi vengono lasciati invariati (Rebase in esecuzione sullo stesso database a fianco di Supabase ne ha ancora bisogno) e l'esecuzione segnala dove sono stati riscontrati
- Conclude indicando ciò che **non** è stato trasferito: funzioni, trigger, estensioni, vincoli CHECK, indici non esprimibili tramite `indexes`, chiavi esterne composte da più colonne o riferite a un altro schema. L'SQL in grado di ricreare ciascuno di questi elementi che Postgres può stampare viene scritto in `backend/sql/_introspected-left-behind.sql`, come bozza: revisionalo, rendilo rieseguibile in sicurezza e rinominalo rimuovendo il carattere `_` iniziale; `rebase db push` e ogni successivo deploy lo applicheranno ogni volta che viene modificato
- Ricorda che `DATABASE_URL` punta ancora al database letto: in una migrazione quello rappresenta la sorgente, e un eventuale `db push` eseguito ora scriverebbe al suo interno
- In un progetto headless, sostituisce il file `ai-instructions.md` generato dallo scaffold ("il database è lo schema") con le regole schema-in-code per backend-only, purché il file sia identico a come creato originariamente; se modificato, viene lasciato intatto e il comando elenca quali delle sue regole non sono più valide
- Riporta nei commenti in cima al file della tabella e nel terminale ciò che non ha potuto definire esattamente — un insieme chiuso di stringhe su una colonna di testo, una colonna generata la cui espressione non è stata letta, un tipo personalizzato — indicando l'effetto che un push avrebbe su di esso
- Con `--data-inference`, campiona fino a 100 righe per tabella e scrive ciò che riguarda la
  presentazione — titoli, icone, bacheche (boards), ordinamenti, opzioni dei campi — in
  `frontend/src/cms/<table>.tsx` sotto forma di `customizeTable`, se il frontend del progetto
  dipende da `@rebasepro/cms`. Un progetto headless non riceve nulla
- In caso di database non attivo, stampa una sola volta lo stesso messaggio di avviso
  visualizzato da `db push` e non crea alcun elemento. Mostra la directory di
  destinazione come percorso assoluto

**Opzioni:**

| Flag | Descrizione |
|------|-------------|
| `--schema-dir` | Dove scrivere i file delle tabelle (predefinito: `backend/schema`). `--output` è stato rimosso |
| `--schema` | Lo schema Postgres da leggere (predefinito: `public`) |
| `--force, -f` | Sovrascrive i file delle tabelle già esistenti; senza questa opzione, i file esistenti vengono ignorati |
| `--database-url` | Legge questo database anziché quello del progetto |
| `--docker` | Legge il database Compose, avviandolo se necessario |
| `--from supabase` | Traduce le convenzioni di Supabase (default `auth.uid()`, foreign key `auth.users`, `TO anon` / `TO authenticated`) per un database Rebase. Non usarlo se Rebase opera sullo stesso database affiancato a Supabase |
| `--data-inference` / `--no-data-inference` | Campiona fino a 100 righe per tabella per rilevare formati, vincoli e impostazioni del pannello, oppure legge unicamente la struttura. In assenza di entrambi i flag viene richiesta conferma a terminale; senza terminale, legge solo la struttura |
| `--users` | Scrive anche `users.ts` per `rebase.users`, come `defineAuthTable` corrispondente alla tabella creata dall'autenticazione. Mostra Users nel pannello di amministrazione come tabella a cui è possibile aggiungere colonne. Senza questo flag, gli account vengono gestiti in Users & Roles di Studio |

Questo è utile quando si adotta Rebase su un database esistente: esegui prima l'introspezione,
quindi modifica le tabelle generate. Una tabella con la row-level security disattivata viene
scritta come qualsiasi altra, con il suo `rls`; il push attiva RLS e il dry-run
lo segnala. Un backend in esecuzione senza alcuna directory `backend/schema`
serve direttamente il database — vedi [Solo backend](/docs/getting-started/headless/).
Stai migrando da Supabase? Consulta [Migrazione da Supabase](/docs/recipes/migrate-from-supabase/).

### `rebase db push`

Applica le modifiche allo schema direttamente al database senza file di migrazione:

```bash
rebase db push
```

**Cosa fa:**
- Legge lo schema Drizzle generato
- Applica le modifiche direttamente al database (CREATE, ALTER, DROP)
- Esegue prima una simulazione (dry-run) del piano e si interrompe prima di qualsiasi operazione che distrugga dati: una
  tabella, colonna, schema, vista o tipo eliminato, un `TRUNCATE`, una modifica del tipo di colonna
  che può causare perdita di dati (`timestamptz` → `date`, `numeric` → `integer`),
  oppure una modifica della chiave primaria — ad esempio `(id)` → `(id, locale)` assegna a ogni riga un nuovo ID, per cui
  link, foreign key e ID memorizzati altrove non troveranno più la rispettiva riga.
  Si interrompe inoltre
  prima dell'eliminazione di un vincolo CHECK o EXCLUDE presente nel database: non viene persa
  alcuna riga, ma da quel momento in poi il database accetterà le righe che prima rifiutava.
  Mostra una richiesta interattiva sul terminale (dove Ctrl-C o Ctrl-D corrisponde a no) e rifiuta
  in caso contrario; `--allow-destructive` applica comunque le modifiche. In questa versione anche
  `--yes` procede, mostrando un avviso di deprecazione; a partire dalla prossima versione approverà
  solo i push non distruttivi. Un push che
  si arresta a questo punto elimina il database temporaneo `<db>_dev_diff` all'uscita
- Attiva la row-level security per ogni tabella dichiarata, comprese le tabelle di giunzione, subito dopo la
  modifica dello schema e prima di qualsiasi passaggio che potrebbe fallire, in modo che un push interrotto a metà lasci la nuova tabella
  in uno stato che nega ogni richiesta anziché lasciarla accessibile
- Applica le policy RLS risultanti dalla compilazione della proprietà `rls` delle tabelle e **rimuove le policy sostituite da un push precedente**
- <span class="since-badge" data-since="0.35">Da 0.35</span> Con `--prune-policies`, elimina anche le policy sulle tabelle dichiarate che non sono definite da alcuna tabella — quelle che il dry-run elenca come "left in force" (rimaste in vigore), come le policy native del database dopo che una tabella è passata a `rls: "admin-only"` — all'interno della transazione che applica quelle dichiarate. Il dry-run elenca ciascuna di esse sotto "Planned row-level security changes" e il push ne controlla l'esecuzione come per una colonna eliminata (chiede conferma su terminale e altrove richiede `--allow-destructive`): eliminare una policy cambia chi può leggere e scrivere le righe, e l'eliminazione di una policy `RESTRICTIVE` amplia l'accesso. Una tabella non dichiarata in `backend/schema` e lo schema `rebase` non vengono mai toccati
- Lascia inalterato ogni
  vincolo CHECK ed EXCLUDE su una tabella dichiarata. Una tabella
  non può dichiarare nessuno dei due vincoli, quindi si tratta di regole native del database, scritte
  manualmente o importate da un database adottato tramite `schema introspect`; per rimuoverne uno, eliminalo
  manualmente (`ALTER TABLE … DROP CONSTRAINT …`). Anche i trigger e le funzioni creati
  manualmente non vengono toccati
- Confronta esattamente il
  nome di ogni elemento lasciato inalterato, inclusi eventuali caratteri `.`, `[`, `]` o `*`
- Crea qualsiasi
  [indice su foreign-key derivato da Rebase](/docs/backend/indexes#foreign-keys-are-indexed-for-you)
  mancante in una tabella esistente **prima** della pianificazione, con
  `CREATE INDEX CONCURRENTLY`, consentendo le scritture sulla tabella durante la creazione;
  Atlas lo troverà quindi già presente. `--dry-run` si limita a elencare tali indici senza crearli
- Applica un contrassegno (stamp) alle
  policy create nello stesso modo in cui fa il server all'avvio, affinché il primo avvio dopo un
  push le lasci inalterate invece di ricrearle tutte
- `--dry-run`
  elenca le modifiche alla row-level security che il push apporterebbe, sotto "Planned
  row-level security changes": le tabelle su cui verrebbe abilitata la RLS e ciascuna
  policy creata, sostituita o eliminata, calcolate secondo le regole del push
  stesso. Mostra "No changes" solo quando né lo schema né
  la row-level security subiscono modifiche. Se il contrassegno di una policy non corrisponde alla sua
  regola o se ne è priva (creata tramite `db migrate` o scritta a mano), il dry-run
  la ricrea provvisoriamente con un altro nome all'interno di una transazione di cui
  esegue il rollback e la confronta con quanto memorizzato in Postgres: se coincidono, non viene considerata
  alcuna modifica. Di conseguenza, una regola reimportata come SQL da `schema introspect` non pianifica modifiche, e
  nemmeno le policy applicate da `db migrate`. Solo gli elementi non confrontabili (ad esempio se il
  lock della tabella non è stato concesso entro due secondi) vengono elencati a parte. Il comando di push
  vero e proprio stampa una singola riga con il conteggio delle modifiche
- Segnala se un'istanza di `rebase dev` è in esecuzione sullo stesso database: essa applica nuove tabelle e colonne al salvataggio, quindi "No changes" può indicare che le modifiche sono già state applicate
- Mostra ogni
  istruzione applicata da Atlas una sola volta. Atlas si connette senza SSL a un database locale
  (`localhost`, `127.x`, `::1`) il cui URL non specifica alcun `sslmode`, come fa l'app,
  invece di fallire con `SSL is not enabled on the server`; un URL che
  specifica `sslmode`, o un host diverso, viene passato esattamente come indicato. Un'esecuzione di Atlas
  che fallisce prima della fase di pianificazione non lascia residui del database `<db>_dev_diff`
- `--dry-run`
  non modifica alcun file del progetto: `src/schema.generated.ts` rimane invariato
  e le copie in `drizzle/*.sql` committate con una versione precedente vengono menzionate ma non
  eliminate. Solo l'input del piano viene salvato in `.rebase/sql/`, che non è sottoposto a commit
- **Non** crea file di migrazione

**Quanto tempo richiede.** Quasi l'intera durata di un push è dovuta al calcolo del piano da parte di Atlas: esso
crea lo schema desiderato in un database temporaneo e ne calcola il diff rispetto a quello reale,
e questo costo computazionale cresce più velocemente del numero di tabelle — su un computer portatile a riposo
circa 0,25 s per piano con 11 tabelle, 0,9 s con 111 e 5,5 s con 411. Un push che
non modifica nulla calcola il piano una sola volta; uno che apporta modifiche calcola il piano due volte (la simulazione
letta dal gate per le modifiche distruttive, poi l'applicazione effettiva). Pertanto, un push su uno schema di
400 o più tabelle richiede decine di secondi, e anche di più su una macchina lenta o sotto carico.
Tale tempo è impiegato da Atlas, non dal database: i passaggi accessori — generazione
dell'SQL, lock RLS, search, trigger, policy, ruolo — richiedono solo pochi secondi per
tali dimensioni, tramite un'unica connessione al database.

**I file generati durante il processo**, tutti posizionati sotto `.rebase/sql/` nella
directory del backend. `db push` e `db generate` riscrivono tutti e cinque i file a partire dalle tabelle a
ogni esecuzione, prima di leggerne alcuno, pertanto una copia committata non verrebbe mai
letta. La directory include il proprio file `.gitignore` e non va mai committata.

| File | Contenuto |
|------|-------|
| `schema.sql` | Tabelle, colonne, vincoli e indici — lo stato desiderato da Atlas, e l'unico su cui viene calcolato il diff |
| `policies.sql` | Le policy RLS derivanti dalla compilazione della proprietà `rls` delle tabelle |
| `search.sql` | Le funzioni di ricerca full-text e le colonne generate per le tabelle dotate di un blocco `search` |
| `vector.sql` | Estensioni pgvector e indici ANN |
| `triggers.sql` | `rebase.set_updated_at()` e i trigger `BEFORE UPDATE` alla base di `.onUpdateNow()` |

Atlas gestisce solo il primo file e nient'altro, quindi `db push` e la procedura di sincronizzazione dello schema
all'avvio applicano autonomamente gli altri quattro. Un deployment di tipo **migration-only** —
che esegue solo `db migrate` e mai `db push` — deve integrare manualmente questi quattro file in una
migrazione; `db generate` segnala quando una modifica è invisibile ad Atlas.

Un progetto che ha committato questi file in `drizzle/` con una versione precedente vedrà
tali copie eliminate alla prima esecuzione, e il comando elencherà ciascun file per consentirti
di committarne l'eliminazione. Vengono eliminati solo i file che iniziano con l'intestazione
del generatore. Eventuali file scritti manualmente vengono conservati, così come `drizzle/migrations/`.

:::note[La modifica di una regola di sicurezza rinomina la relativa policy]
Una regola senza un `name` esplicito viene compilata come `<table>_<op>_<hash>`, dove l'hash copre la semantica della regola — pertanto la *modifica* di una regola (rispetto all'aggiunta) produce una policy con un nuovo nome lasciando presente quella precedente.

Questo in passato aveva un impatto notevole: Postgres combina le policy `PERMISSIVE` con un operatore logico OR, quindi una clausola sostituita `USING (rebase.uid() IS NOT NULL)` continuava a concedere l'accesso completo indipendentemente da quanto restrittiva fosse la sua sostituta. Rendere più restrittiva una regola non aveva alcun effetto e il push segnalava esito positivo.

`db push` ora risolve questa discrepanza: elimina le policy generate che non corrispondono più ad alcuna regola e segnala — senza eliminarle — le policy con nome personalizzato non descritte dalle tabelle, poiché indistinguibili da istruzioni SQL scritte deliberatamente.

Per verificare un database su cui è stato eseguito il push prima di questa introduzione, esegui `rebase doctor --policies`. Funziona come controllo di gate in CI: termina con codice diverso da zero in caso di disallineamento (drift), e anche quando non è possibile eseguire il controllo (assenza di `DATABASE_URL`, percorso `--schema-dir` non valido, mancata concessione della lettura di `pg_policies` al ruolo CI). Un controllo che non ha potuto verificare non è superato.

`doctor` e `db push` distinguono i due tipi di policy orfane. Una policy con un nome generato è stata sostituita e il push successivo la eliminerà. Qualsiasi altro nome è stato scritto manualmente o da un altro strumento ed è ancora in vigore: descrivilo nel blocco `rls` della rispettiva tabella per mantenerlo (la vista RLS di Studio lo importa), oppure eliminalo con `rebase db push --prune-policies` se obsoleto.
:::

:::caution
`db push` modifica direttamente il database. Utilizzalo solo in fase di sviluppo. Per la produzione, usa `db generate` + `db migrate` per creare file di migrazione revisionabili.
:::

### `rebase db generate`

Genera file di migrazione SQL a partire dalle modifiche allo schema:

```bash
rebase db generate
```

**Cosa fa:**
- Confronta lo schema Drizzle rispetto allo stato costruito dalle migrazioni in `drizzle/migrations/`, non rispetto al database
- Produce file di migrazione SQL con timestamp in `backend/drizzle/migrations/`
- I file possono essere revisionati, modificati e committati nel controllo versione
- Segnala ogni
  istruzione nella nuova migrazione che distrugge dati, impiegando lo stesso controllo eseguito da `db push`
  prima dell'applicazione: eliminazione di tabelle, colonne, schemi, viste o tipi, un
  `TRUNCATE`, modifiche al tipo di colonna con possibile perdita di dati, modifiche alla chiave primaria
  o l'eliminazione di vincoli CHECK o EXCLUDE presenti nel database. Scrive
  comunque il file ed esce con codice 0, emettendo solo un avviso senza bloccare l'operazione.
- Si conclude indicando le azioni
  successive: `rebase db migrate` e, per la prima migrazione del progetto, l'indicazione di usare
  `--baseline <version>` se il database è già stato inizializzato all'avvio. Una
  migrazione successiva non mostra il suggerimento del baseline, poiché se una migrazione distruttiva venisse impostata come baseline
  salterebbe i suoi `DROP`; un'esecuzione che non produce alcuna migrazione si limita a segnalarlo.

**Un vincolo CHECK aggiunto da una migrazione viene eliminato dalla migrazione successiva.** `db generate`
calcola il diff rispetto ai file di migrazione e non rispetto al database, e Atlas non ha modo di escludere un
oggetto da tale diff. Di conseguenza, un vincolo CHECK o EXCLUDE inserito manualmente in una
migrazione e che nessuna tabella può dichiarare, viene riproposto come
`ALTER TABLE … DROP CONSTRAINT …` nella migrazione successiva, accorpato nella
medesima istruzione con la modifica effettiva. Il report sopra citato segnala tale eliminazione quando
il database include già il vincolo; non lo rimuove dal
file. Elimina la clausola prima di eseguire `rebase db migrate`, oppure lascia che
`rebase db migrate --refuse-destructive` si interrompa su di essa. `db push` legge il
database e preserva il vincolo.

Le migrazioni generate sono semplici file SQL: puoi esaminarle e modificarle prima di applicarle.

### `rebase db migrate`

Esegue tutte le migrazioni in sospeso:

```bash
rebase db migrate
```

**Cosa fa:**
- Legge `drizzle/migrations/` alla ricerca di migrazioni non ancora applicate
- Le applica in ordine al database
- Tiene traccia delle migrazioni applicate
- Applica il contrassegno alle
  policy di row-level security nello stesso modo in cui fanno `db push` e l'avvio del server, cosicché
  il primo avvio dopo la migrazione le lasci inalterate invece di ricrearle tutte.
  Poiché una migrazione è stata scritta in base alle tabelle del momento in cui è stata creata, una policy viene
  contrassegnata solo se corrisponde esattamente a ciò che la sua regola produce attualmente: migrate la ricrea
  provvisoriamente con un altro nome all'interno di una transazione di cui esegue il rollback e
  la confronta con quanto memorizzato in Postgres, esattamente come fa `db push --dry-run`. Una policy che
  differisce non riceve il contrassegno e l'avvio successivo riapplicherà la relativa tabella

`--refuse-destructive`
rifiuta invece l'operazione in caso di modifiche distruttive. Esegue prima una simulazione delle migrazioni in sospeso. Se un'istruzione
distrugge dati (secondo lo stesso controllo impiegato da `db push` e `db generate`),
elenca tali istruzioni ed esce con codice 1. Non applica nulla, nemmeno i file
precedenti a tale istruzione. Senza il flag, `db migrate` mantiene il comportamento standard e
applica tutti i file in sospeso:

```bash
rebase db migrate --refuse-destructive
```

Una migrazione che ricostruisce una colonna di ricerca ne esegue prima l'eliminazione (drop), quindi questo flag bloccherà
anche tale migrazione. Esamina l'elenco stampato, poi esegui `rebase db migrate`
senza il flag per applicarla.

#### Creazione di una baseline per un database già avviato da Rebase

Ogni avvio di Rebase assicura l'allineamento dello schema e `rebase db push` lo applica direttamente. Di conseguenza, un database su cui è stato eseguito l'uno o l'altro contiene già le tabelle e i tipi che la prima migrazione tenterebbe di creare, e `rebase db migrate` si interrompe con l'errore `pq: type "posts_status" already exists (42710)`.

Non c'è alcun errore nella migrazione: il database è stato semplicemente inizializzato in un altro modo. Registra lo stato attuale e poi esegui la migrazione normalmente:

```bash
rebase db migrate --baseline 20260906101530
rebase db migrate
```

La versione corrisponde al prefisso numerico del file di migrazione che descrive ciò che è presente *ora* nel database. Quella migrazione e tutte quelle precedenti vengono registrate come applicate; le successive verranno eseguite. Su un database contro cui non è mai stato avviato nulla, non è necessaria alcuna baseline: procedi direttamente con migrate.

La stessa situazione può verificarsi nel normale ciclo di sviluppo: modifica una tabella mentre `rebase dev` è in esecuzione, e l'avvio aggiungerà la colonna prima che `rebase db generate` scriva la migrazione corrispondente, bloccando `rebase db migrate` con l'errore `column … already exists (42701)`. Imposta come baseline quella migrazione nello stesso modo. `--baseline` funziona su un database che registra già le migrazioni: contrassegna tutto fino alla versione indicata come applicato tramite `atlas migrate set`, notificandolo, oppure segnala che non c'è nulla da registrare se la cronologia l'ha già raggiunta. Una versione non presente in alcun file di `drizzle/migrations` viene rifiutata prima di eseguire qualsiasi operazione, elencando le versioni disponibili.

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

`rebase db branch switch` (e `switch --off`) e `rebase db branch prune`
sono nuovi. `create`, `list`, `info` e `delete` sono stati introdotti nella versione 0.17.

Ciascun branch è una copia completa del database creata con `CREATE DATABASE ... TEMPLATE`,
pertanto richiede un server PostgreSQL reale e occupa lo stesso spazio su disco dell'originale.

### `rebase doctor`

Rileva il disallineamento a tre vie (three-way drift) tra le tabelle, lo schema Drizzle generato e il database PostgreSQL attivo:

```bash
rebase doctor
```

**Cosa controlla:**
- Tabelle ↔ Schema generato — sono sincronizzati?
- Schema generato ↔ Database — ci sono modifiche non applicate?
- Tabelle ↔ Database — è presente un disallineamento imprevisto?

Esegui `doctor` ogni volta che qualcosa sembra non sincronizzato. Identifica esattamente dove risiede la discrepanza.

Il confronto con il database include quello che l'avvio esegue prima di avvisare che `schema.generated.ts` e il database non concordano, eseguito tramite lo stesso codice. Di conseguenza, ogni differenza segnalata dall'avvio è presente anche nel report, con le stesse parole: una colonna NOT NULL da un lato e nullable dall'altro, oppure una colonna ancora presente nel database ma assente nel file (l'avvio non elimina mai colonne, quindi una proprietà rinominata lascia indietro la vecchia colonna). Ciascuna segnalazione è un avviso e la correzione suggerita indica `rebase db push`.

Il confronto del database legge il database del progetto, risolto nello stesso modo in cui lo risolve `rebase db url` — in uno scaffold appena creato quello gestito, che `doctor` provvede ad avviare. Quando non è possibile risolverne alcuno, tale fase viene indicata come **saltata** (skipped) anziché superata, e l'esecuzione non si chiude mai con "All schemas are in sync": un controllo non eseguito non equivale a un esito positivo.

Segnala inoltre ogni tabella priva di [blocco `search`](/docs/backend/search) che contiene più di circa 10.000 righe. Una ricerca in tali tabelle — la casella di ricerca del pannello di amministrazione, `.search()`, `?searchString=` — viene eseguita come `ILIKE '%term%'` sulle colonne di testo, operazione che nessun indice può ottimizzare, comportando la lettura dell'intera tabella e una seconda lettura per il conteggio (circa un terzo di secondo con 100.000 righe, crescendo con le dimensioni della tabella). Il numero di righe è una stima fornita direttamente da Postgres, quindi il controllo non effettua scansioni. Si tratta di un suggerimento: non modifica il codice di uscita e non crea indici automaticamente.

Identifica una **giunzione orfana** (orphaned junction): una tabella in `public` strutturata come una giunzione many-to-many ma non dichiarata da alcuna tabella. La struttura consiste in due colonne che insieme formano la chiave primaria, ciascuna foreign key verso una tabella dichiarata. Rinominare o rimuovere una relazione `manyToMany` lascia indietro la vecchia tabella di giunzione, poiché push e boot si limitano a creare tabelle, e ogni riga di collegamento rimane al suo interno. La nota ha valore puramente informativo, pertanto non modifica il codice di uscita. La soluzione consiste nell'istruzione `DROP TABLE`, che `doctor` mostra senza mai eseguirla.

### `rebase generate-sdk`

Genera un SDK tipizzato a partire dalle tue tabelle:

```bash
rebase generate-sdk
```

**Cosa fa:**
- Legge le tabelle esportate da `backend/schema/index.ts` tramite il loader da cui si avvia il backend, in modo che l'SDK descriva esattamente le tabelle servite; uno schema che non compila blocca l'operazione
- Genera tipi TypeScript per ogni tabella in `generated/sdk/`
- Produce un file `database.types.ts` da utilizzare con `createRebaseClient<Database>()`: il tipo `Database`, `TableName` (l'unione di tutti gli slug) e `tablesDictionary` / `TablesDictionary`, la mappatura da accessor a slug

`rebase dev` esegue automaticamente questo comando all'avvio e a ogni salvataggio in
`backend/schema/`. Eseguilo manualmente in CI, in un repository che non contiene
tabelle proprie (vedi `--from` di seguito) o in qualsiasi contesto in cui `rebase dev` non sia attivo.

**Opzioni:**

| Flag | Descrizione |
|------|-------------|
| `--schema-dir` | La directory dello schema (predefinita: `backend/schema`, o la chiave `tables` in `rebase.json`); i percorsi relativi vengono risolti dalla cartella di esecuzione del comando |
| `-o`, `--output` | Directory di output per l'SDK (predefinita: `generated/sdk/`) |
| `--from <link\|url>` | Legge lo schema da un progetto in esecuzione anziché dal sorgente locale. `link` utilizza il progetto collegato a questo checkout. |
| `--token` | Bearer token per l'endpoint del contract (predefinito: `$REBASE_SERVICE_KEY` dalla shell; il file `.env` non viene letto) |
| `--register` | Tipizza anche i dati lato server: scrive i tipi e una dichiarazione `Register` in `backend/generated/` e la memorizza in `rebase.json` — consulta [Dati tipizzati lato server](/docs/backend/typed-server-data/) |

`--from` è ciò che consente a un repository privo di tabelle — un
frontend separato, una seconda web app, un'app mobile — di generare un client tipizzato dal
progetto con cui comunica: legge le `tables` dall'endpoint
`/api/meta/contract` del backend in esecuzione. `REBASE_SERVICE_KEY` viene inviata unicamente al progetto collegato a
questo checkout; specifica `--token` in modo esplicito per qualsiasi altro host. La chiave in
`.env` appartiene al tuo backend locale e non viene mai inviata.
Un eventuale rifiuto indica
quale di questi casi si è verificato: `--token` rifiutato, chiave della shell rifiutata, una chiave
non inviata a un host non collegato, una chiave presente solo in `.env` o l'assenza totale di chiave.

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

I nomi dei campi nei tipi generati corrispondono a quelli serviti dall'API. Il nome di rete
(wire name) di un campo è la chiave della colonna e l'API utilizza costantemente camelCase:
l'introspezione scrive una colonna `created_at` come `createdAt: col.timestamp({ withTimezone: true })`, il cui nome SQL
è lo snake_case della chiave, e la serve come `row.createdAt`. La colonna
stessa rimane inalterata. L'*accessor* della tabella viene trasformato nel nome di una proprietà
nello stesso modo (`my-notes` → `client.data.myNotes`), che è ciò che `tablesDictionary`
rimappa allo slug.

### `rebase migrate`

`rebase migrate collections-to-tables [dir]` sposta `config/collections` in
`backend/schema` (un `defineTable` per collection, ogni colonna esplicita nella
sua posizione originale, secondo la convenzione Drizzle, e `index.ts` con
`defaultRls`) e in `frontend/src/cms` (un `customizeTable` per ogni collection personalizzata,
file `defineFirestoreCollection`, `ui-config.json`), scrive
`backend/resources.ts`, `backend/storage.ts` e `backend/generated/register.ts`,
aggiunge `rebaseBackendGuard()` al `vite.config.ts` di uno scaffold, quindi esegue
`rebase migrate sdk-calls`, che riscrive `.collection(` in `.table(`, applica
le altre ridenominazioni dell'SDK e le sorgenti di regole `existsIn` / `membership` nel tuo codice,
e sposta gli import dei nomi che la versione 0.31 ha trasferito in un altro pacchetto
([l'elenco](/docs/upgrading/0-30-to-0-31-imports/)), aggiungendo il pacchetto alle
dipendenze di chi lo importa ("Dependencies added": esegui `pnpm install`). Aggiorna ogni pacchetto `@rebasepro` alla versione 0.31 prima di eseguirlo.
A ogni esecuzione viene riletto il risultato: l'SQL generato — DDL, policy, search,
vector, trigger, viste, schema Drizzle — deve essere identico byte per byte, altrimenti ogni
file viene ripristinato. Ciò che non può essere convertito viene rifiutato indicando file e riga, e
ciò che richiede un intervento manuale viene stampato come passaggi numerati, terminando con
`rebase skills install` se il progetto include competenze per agenti (agent skills). I moduli personalizzati in
`config/` vengono mantenuti; l'esecuzione stampa la riga di comando `git rm` per gli elementi sostituiti. Gestisce inoltre
le collection Firestore costruite da funzioni, i path alias, i pannelli montati
all'esterno di `App.tsx` e tutte le app statiche non protette ([l'elenco completo](/docs/upgrading/0-30-to-0-31/#108-tables-in-backendschema-replace-configcollections--run-the-codemod-first)).
Dopo il comando `git rm`, `--check` segnala `already-migrated`.

| Flag | Effetto |
|---|---|
| `--dry-run` | Stampa file, rifiuti, note e passaggi manuali; non scrive nulla. Inizia da qui. |
| `--check` | Su un progetto migrato: verifica che `backend/schema` produca ancora lo stesso SQL. Esce con codice 1 mostrando il diff, o se una regola cambia significato. |
| `--accept-rule-changes` | In combinazione con `--check`: attesta che le regole nella sezione "Review before deploying" sono state revisionate. |
| `--json` / `--force` / `--skip-sdk-calls` | Il report in formato JSON (con `ruleChanges`); esegue su un working tree modificato o su output già editato; non modifica il codice. |

Esamina due elenchi nell'output dell'SDK: **"Rewritten by name — review"** (ricevitori non
tipizzati, data slot, test double) e **"Left unchanged — check each"**
(rinomina quelli appartenenti all'SDK; [una ricerca](/docs/upgrading/0-30-to-0-31-by-hand/#sdk-calls-no-type-checker-sees) trova i restanti).

Il controllo SQL certifica la fedeltà della conversione, non che il significato logico di una regola
sia rimasto invariato. L'ultima sezione dell'output, **"Review before deploying: these rules change meaning"**,
elenca ogni regola la cui policy ora concede autorizzazioni differenti
— un semplice `access: "authenticated"` prima non concedeva nulla, mentre ora ammette qualsiasi chiamante
autenticato ([i quattro casi](/docs/upgrading/0-30-to-0-31/#review-before-deploying-these-rules-change-meaning)).
Successivamente effettua una verifica con il database: `rebase db push --dry-run` dovrebbe stampare "No
changes: the database already matches these tables.", e
`rebase doctor --policies` non dovrebbe mostrare alcun disallineamento.

## Flusso di lavoro di sviluppo

Il flusso di lavoro a iterazione rapida per lo sviluppo:

```bash
# 1. Edit a table in backend/schema/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Push directly to dev database
rebase db push
```

## Flusso di lavoro di produzione

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
|---------|----------|
| `Could not detect an active database plugin` | Installa `@rebasepro/server-postgres` in `backend/package.json` |
| Schema file not updating | Verifica che il percorso `--schema-dir` (o la chiave `tables` in `rebase.json`) punti alla directory corretta |
| Migration shows unexpected changes | Esegui `rebase doctor` per identificare eventuali disallineamenti |
| `db push` fails on production | Utilizza invece `db generate` + `db migrate` |
| A migration must not drop data in CI or production | `rebase db migrate --refuse-destructive` esce con codice 1 e non applica nulla se un'istruzione in sospeso distrugge dati |
| `db migrate` fails with `already exists (42710)` | L'avvio o `db push` hanno già configurato lo schema — registralo con `rebase db migrate --baseline <version>` |
| `db migrate` fails with `column … already exists (42701)` | `rebase dev` ha aggiunto la colonna all'avvio — imposta come baseline quella migrazione nello stesso modo |
| `db push` on the managed database fails with `Error: EOF` | Atlas ha perso una connessione mantenuta dall'istanza attiva di `rebase dev`. Esegui nuovamente il comando; se continua a fallire, arresta prima `rebase dev` |

## Passaggi successivi

- **[Tabelle](/docs/schema/)** — Definisci il tuo modello di dati
- **[Riferimento CLI](/docs/cli)** — Tutti i comandi della CLI
- **[SDK tipizzato](/docs/sdk)** — Utilizza l'SDK generato
