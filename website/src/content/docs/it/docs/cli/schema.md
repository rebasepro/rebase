---
sourceHash: 1a01ad3180c225c1
title: Generazione dello schema
sidebar_label: Generazione dello schema
description: Genera schemi Drizzle ORM dalle tabelle in backend/schema, crea migrazioni SQL, esegui l'introspezione di un database esistente in file defineTable e mantieni il tuo database sincronizzato con la CLI di Rebase.
---

## Panoramica

Rebase utilizza una pipeline **schema-as-code** in cui le tabelle dichiarate con
`defineTable` in `backend/schema/` rappresentano l'unica fonte di verità. La CLI
le trasforma attraverso una pipeline deterministica:

```
Tables (backend/schema) → Drizzle Schema → SQL Migrations → PostgreSQL
```

Questa pagina descrive ogni comando della CLI coinvolto in tale pipeline.

## La pipeline

### 1. Tabelle → Schema Drizzle

Le tabelle esportate da `backend/schema/index.ts` descrivono colonne, tipi, relazioni,
enum e la sicurezza a livello di riga (row-level security). Ognuno dei comandi seguenti le legge tramite il loader
da cui si avvia il backend; di conseguenza, uno schema che non compila — una tabella priva di
`rls`, `"inherit"` senza `defaultRls`, un `defineTable` che l'index non
esporta — interrompe il comando con un `SchemaDefinitionError` che specifica ciascun problema,
e non viene scritto nulla. Il comando `schema generate` genera a partire da esse un file di
schema Drizzle ORM.

Ogni comando che legge lo schema accetta `--schema-dir <dir>` per i progetti
che conservano le tabelle altrove; il valore predefinito è `backend/schema`, oppure la
chiave `tables` dell'app di backend in `rebase.json`. Il flag `--collections` / `-c`,
antecedente alla versione 0.31, viene rifiutato con un messaggio che indica il codemod
([`rebase migrate collections-to-tables`](#rebase-migrate)), così come viene rifiutato un
progetto che contiene ancora `config/collections`.

### 2. Schema Drizzle → Migrazioni

A partire dallo schema Drizzle generato, `db generate` calcola il diff rispetto alle migrazioni già presenti in `backend/drizzle/migrations/`, riprodotte su un database temporaneo di appoggio (scratch database), e genera file di migrazione SQL dotati di timestamp. Non legge mai il tuo database: una colonna già aggiunta all'avvio (boot) o da `db push` risulterà comunque come `ADD COLUMN`.

### 3. Migrazioni → PostgreSQL

Il comando `db migrate` applica le migrazioni in sospeso al tuo database PostgreSQL.

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
| `--schema-dir` | La directory dello schema (predefinita: `backend/schema`); i percorsi relativi vengono risolti a partire da dove viene eseguito il comando |
| `--output, -o` | Percorso di output per il file di schema generato; i percorsi relativi vengono risolti a partire da dove viene eseguito il comando |
| `--watch, -w` | Controlla le modifiche e rigenera automaticamente |

La **modalità watch** è utile durante lo sviluppo: modificando il file di una tabella, lo schema viene rigenerato all'istante:

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
- Effettua il rendering di ciò che generano le tabelle in `backend/schema/` e lo confronta, dichiarazione per dichiarazione, con `backend/src/schema.generated.ts`
- Specifica ogni differenza — una tabella mancante, una colonna con tipo modificato, un'etichetta di enum rimossa o chiavi esterne denominate secondo le convenzioni di una versione precedente — ed esce con un codice diverso da zero
- Con `--fix`, rigenera il file invece di limitarsi a segnalarlo

`rebase dev` mantiene aggiornato il file in autonomia, quindi questo è il controllo da usare per una build
o uno step di CI. Accetta `--schema-dir` e `--output` esattamente come `rebase schema generate`.

### `rebase schema reconcile`

Rimuovi i vincoli ed elimina ciò che il boot non toccherà, dopo aver esaminato il piano:

```bash
rebase schema reconcile                         # relax NOT NULL on columns made nullable or removed
rebase schema reconcile --drop voice_cache.wav  # and drop a column no table declares
```

**Cosa fa:**
- Richiede al backend in esecuzione di pianificare le modifiche rispetto al proprio database. Questo è il backend a cui puntano il file `.env` e il link cloud, quindi funziona su Rebase Cloud, dove nient'altro può raggiungere direttamente il database.
- Pianifica un `DROP NOT NULL` per ogni colonna che una tabella dichiara come nullable ma che il database richiede ancora come obbligatoria.
- Elenca ogni colonna non dichiarata da alcuna tabella. Una colonna `NOT NULL` priva di valore predefinito blocca ogni operazione di inserimento, quindi anch'essa viene resa nullable (relaxed), preservandone i dati. Vengono eliminate solo le colonne specificate con `--drop <table>.<column>`, mostrando quante righe contengono un valore in ciascuna di esse.
- Applica le modifiche dopo aver digitato `yes`. Il server esegue il piano basandosi esclusivamente sul digest di quello appena esaminato; pertanto, se nel frattempo il database o le tabelle sono cambiati, l'operazione viene rifiutata ed è necessario riesaminarlo. `--yes` salta la richiesta di conferma.

Il boot si limita sempre e solo ad aggiungere; pertanto, dopo aver rimosso una colonna dal relativo `defineTable`, la colonna rimane nel database insieme ai suoi dati. Una colonna `NOT NULL` senza valore predefinito provocherà quindi il fallimento di ogni operazione di inserimento, e i log di avvio indicano proprio questo comando per risolvere il problema: senza `--drop` per mantenere i dati, con il flag per rimuovere la colonna. Distribuisci prima la modifica alla tabella, poiché reconcile pianifica le modifiche in base a ciò che è in esecuzione nel backend. Richiede `REBASE_SERVICE_KEY` in `.env`. A livello locale, `rebase db push` gestisce lo stesso scenario attraverso il proprio controllo sulle modifiche distruttive.

### `rebase schema introspect`

Scrive i file `defineTable` a partire da un database PostgreSQL esistente:

```bash
rebase schema introspect
```

**Cosa fa:**
- Si connette al database di questo progetto, quello stampato da `rebase db url` (se si tratta di quello gestito, viene avviato se necessario); `--database-url` ne indica un altro, mentre `--docker` utilizza quello di compose
- Legge ogni tabella, colonna, tipo, chiave esterna e policy, e scrive
  `backend/schema/<table>.ts` — un `defineTable` per tabella — e il file
  `backend/schema/index.ts` che le esporta (unito a un index eventualmente
  già esistente)
- Dichiara ogni colonna con il rispettivo tipo Postgres: `col.uuid()`, `col.varchar({ length })`,
  `col.numeric({ precision, scale })`, un enum con le relative etichette e il nome del tipo reale
  (un `pgEnum` quando il tipo è condiviso), un array come `<item>.array()`,
  `col.vector({ dimensions })`, chiavi identity e serial, valori predefiniti — espressi secondo la
  sintassi di Drizzle. Un tipo non supportato da alcun builder diventa
  `col.custom({ dataType: "<sql type>" })`, che Rebase restituisce esattamente come
  fornito dal driver; `db generate` e `db push` lo rifiuteranno finché il planner
  non sarà in grado di gestirlo
- Dichiara la colonna di chiave esterna, la relazione `belongsTo` su di essa e la corrispondente
  `hasMany` inversa sulla tabella di destinazione; una junction table diventa una `manyToMany`, con
  le proprie colonne come `pivot`
- Legge le policy di row-level security di ciascuna tabella nel relativo blocco `rls`: nome,
  comando, modalità, elenco `TO`, `USING` e `WITH CHECK`. Le policy `<table>_default_*`
  aggiunte automaticamente da Rebase vengono omesse, in modo che il successivo `db push` ricrei
  ogni policy esattamente com'era. Una tabella con la row-level security attiva ma senza alcuna policy
  viene scritta con `rls: "admin-only"`
- Legge ogni espressione (lo `USING` di una policy, un vincolo CHECK, un default di colonna) sotto
  il `search_path` utilizzato dal server, `public`, per cui una funzione nello schema `rebase`
  viene scritta come `rebase.roles()`
- Converte un vincolo CHECK leggibile (`total >= 0`) nel metodo `.validate()` della colonna, lasciando il vincolo originale nel database, dove il push successivo lo manterrà. Ogni CHECK viene inoltre elencato sotto "Not carried over" con il relativo SQL: un push verso un *nuovo* database creerà la validazione, non il vincolo
- Dichiara ogni indice semplice (solo colonne, btree, gin o brin, senza predicati) negli `indexes` della tabella. Un indice applicato solo a una colonna di chiave esterna viene delegato alla relazione, che provvederà a crearne uno
- Con `--from supabase`, converte le convenzioni di Supabase per un database da cui si sta migrando: un default di colonna impostato su `auth.uid()` diventa `.onCreateUser()` (il server scrive l'id del chiamante), una colonna contenente un ID utente di Supabase (quel default o una chiave esterna verso `auth.users`) diventa `col.text().userId()`, poiché `rebase.users.id` e `rebase.uid()` sono di tipo text, e una policy `TO authenticated` / `TO anon` perde il ruolo (un database Rebase non include nessuno dei due) e richiede invece un chiamante autenticato / non autenticato; una policy valida solo per `service_role` viene eliminata. Ogni modifica viene annotata all'inizio del file della tabella. Senza questo flag, tali elementi vengono lasciati invariati (Rebase in esecuzione sullo stesso database a fianco di Supabase ne ha ancora bisogno) e l'esecuzione segnala dove sono stati rilevati
- Termina indicando ciò che **non** è stato trasferito: funzioni, trigger, estensioni, CHECK, indici che `indexes` non può rappresentare, chiavi esterne su più colonne o verso un altro schema. Il codice SQL in grado di ricreare ciascun elemento stampabile da Postgres viene scritto in `backend/sql/introspected-left-behind.sql`, per poter essere esaminato e applicato dopo il primo push (`psql "$DATABASE_URL" -f …`, oppure `rebase cloud db query --file …` su Rebase Cloud)
- Ti ricorda che `DATABASE_URL` fa ancora riferimento al database da cui ha letto: in una migrazione quello rappresenta la sorgente, e un `db push` in questo momento scriverebbe al suo interno
- In un progetto headless, sostituisce il file `ai-instructions.md` dello scaffold ("il database è lo schema") con le regole dello schema-in-code per backend-only, purché il file sia esattamente come generato dallo scaffold; se è stato modificato, viene lasciato intatto e il comando segnala quali regole non sono più valide
- Inserisce ciò che non è stato possibile definire con precisione in un commento all'inizio del file della tabella e sul terminale — un insieme chiuso di stringhe su una colonna di testo, una colonna generata la cui espressione non è stata letta, un tipo personalizzato — indicando l'effetto che un push avrebbe su di essi
- Con `--data-inference`, campiona fino a 100 righe per tabella e scrive le configurazioni di presentazione
  rilevate — titoli, icone, board, ordinamenti, opzioni dei campi — in
  `frontend/src/cms/<table>.tsx` sotto forma di `customizeTable`, purché il frontend del
  progetto dipenda da `@rebasepro/cms`. Un progetto headless non riceve alcuna configurazione
- Se eseguito su un database non attivo, stampa lo stesso banner di `db push`,
  una sola volta, e non crea nulla. Stampa la directory di output come
  percorso assoluto

**Opzioni:**

| Flag | Descrizione |
|------|-------------|
| `--schema-dir` | Dove scrivere i file delle tabelle (predefinito: `backend/schema`). `--output` è stato rimosso |
| `--schema` | Lo schema Postgres da leggere (predefinito: `public`) |
| `--force, -f` | Sovrascrive i file delle tabelle già esistenti; senza questo flag, i file esistenti vengono ignorati |
| `--database-url` | Legge questo database invece di quello del progetto |
| `--docker` | Legge il database del compose, avviandolo se necessario |
| `--from supabase` | Converte le convenzioni di Supabase (default `auth.uid()`, chiavi esterne `auth.users`, `TO anon` / `TO authenticated`) per un database Rebase. Non usarlo se Rebase è in esecuzione sullo stesso database a fianco di Supabase |
| `--data-inference` / `--no-data-inference` | Campiona fino a 100 righe per tabella per rilevare formati, vincoli e impostazioni del pannello, oppure legge solo la struttura. In assenza di entrambi i flag viene richiesta conferma; senza un terminale interattivo legge solo la struttura |

Questo è utile quando si adotta Rebase su un database esistente: prima si esegue
l'introspezione, poi si modificano le tabelle generate. Una tabella priva di row-level security
viene scritta come qualsiasi altra, con il relativo blocco `rls`; il push attiverà la RLS,
segnalandolo nel dry run. Un backend in esecuzione completamente privo di `backend/schema`
serve direttamente il database — consulta [Solo backend](/docs/getting-started/headless/).
Stai lasciando Supabase? Consulta [Migrazione da Supabase](/docs/recipes/migrate-from-supabase/).

### `rebase db push`

Applica le modifiche allo schema direttamente al database senza file di migrazione:

```bash
rebase db push
```

**Cosa fa:**
- Legge lo schema Drizzle generato
- Applica le modifiche direttamente al database (CREATE, ALTER, DROP)
- Esegue prima un dry run del piano e si arresta prima di qualsiasi operazione che distrugga dati:
  eliminazione di tabelle, colonne, schemi, viste o tipi, un `TRUNCATE`, o una modifica al tipo di colonna
  che potrebbe causare la perdita di valori (`timestamptz` → `date`, `numeric` → `integer`),
  oppure una modifica alla chiave primaria — `(id)` → `(id, locale)` assegna a ogni riga un nuovo ID,
  impedendo a link, chiavi esterne e ID memorizzati altrove di individuare la riga corrispondente.
  Si arresta inoltre
  prima della rimozione di un vincolo CHECK o EXCLUDE presente nel database: nessuna riga
  va persa, ma da quel momento in poi il database accetterà righe che prima rifiutava.
  Richiede conferma su terminale (dove Ctrl-C o Ctrl-D risponde negativamente) e in caso contrario
  rifiuta l'operazione; `--allow-destructive` la applica comunque. Anche `--yes` lo fa in
  questa versione, mostrando un avviso di deprecazione; a partire dalla prossima versione autorizzerà
  solo i push non distruttivi. Un push che
  si arresta a questo punto elimina il database temporaneo `<db>_dev_diff` in uscita
- Attiva la row-level security per ogni tabella dichiarata, comprese le junction table, subito dopo la
  modifica dello schema e prima di qualsiasi passaggio che potrebbe fallire, in modo che un push interrotto a metà lasci la nuova tabella
  configurata per rifiutare ogni richiesta anziché lasciarla esposta
- Applica le policy RLS risultanti dalla compilazione del blocco `rls` delle tue tabelle e **rimuove le policy sostituite da un push precedente**
- <span class="since-badge" data-since="0.35">Dalla versione 0.35</span> Con `--prune-policies`, elimina anche le policy sulle tabelle dichiarate che non sono definite da alcuna tabella — quelle che il dry run elenca come "left in force", come ad esempio le policy proprie del database dopo che una tabella è passata a `rls: "admin-only"` — all'interno della stessa transazione che applica quelle dichiarate. Il dry run elenca ciascuna di esse sotto "Planned row-level security changes", e il push le gestisce con gli stessi controlli previsti per una colonna eliminata (chiede conferma su terminale e altrove richiede `--allow-destructive`): rimuovere una policy modifica i permessi di lettura e scrittura delle righe, e l'eliminazione di una policy `RESTRICTIVE` amplia l'accesso. Le tabelle non dichiarate in `backend/schema` e lo schema `rebase` non vengono mai toccati
- Lascia invariato
  ogni vincolo CHECK ed EXCLUDE presente su una tabella dichiarata. Una tabella
  non può dichiarare nessuno dei due, per cui si tratta di regole proprie del database, scritte a mano
  o ereditate da un database importato con `schema introspect`; per rimuoverne uno, eliminalo
  manualmente (`ALTER TABLE … DROP CONSTRAINT …`). Nemmeno i trigger e le funzioni scritti da te
  vengono toccati
- Confronta esattamente
  il nome di tutto ciò che lascia invariato, inclusi eventuali caratteri `.`, `[`, `]` o `*`
- Genera qualsiasi
  [indice di chiave esterna derivato da Rebase](/docs/backend/indexes#foreign-keys-are-indexed-for-you)
  mancante in una tabella esistente **prima** della pianificazione, con
  `CREATE INDEX CONCURRENTLY`, in modo che le scritture sulla tabella possano continuare durante la creazione;
  Atlas lo troverà quindi già presente. `--dry-run` elenca questi indici senza crearli
- Appone un contrassegno (stamp)
  alle policy applicate nello stesso modo in cui fa il boot del server, affinché il primo avvio successivo a un
  push le lasci invariate anziché ricrearle tutte
- `--dry-run`
  elenca le modifiche alla row-level security che verrebbero apportate dal push, sotto "Planned
  row-level security changes": le tabelle su cui viene attivata la RLS e ogni
  policy creata, sostituita o eliminata, determinate secondo la logica dei passaggi del push.
  Mostra "No changes" solo quando né lo schema né la
  row-level security subirebbero variazioni. Se il contrassegno di una policy non corrisponde alla sua
  regola, o se non ne possiede uno (una policy creata da `db migrate`, una scritta manualmente), il dry
  run la ricrea a partire dalla regola con un altro nome all'interno di una transazione annullata (rollback),
  confrontando ciò che Postgres ha memorizzato: se il risultato è identico, non viene considerata
  alcuna modifica. Di conseguenza, una regola reimportata come SQL da `schema introspect` non pianifica nulla, e
  nemmeno le policy applicate da `db migrate`. Solo quelle che non è stato possibile confrontare (ad esempio, se il
  lock sulla tabella non viene concesso entro due secondi) vengono elencate a parte. Il comando di push
  vero e proprio stampa una singola riga con il conteggio delle modifiche
- Segnala se un'istanza di `rebase dev` è in esecuzione sullo stesso database: essa applica nuove tabelle e colonne al salvataggio, per cui "No changes" può indicare che sono già state applicate
- Mostra ogni
  istruzione applicata da Atlas una sola volta. Atlas si connette senza SSL a un database su questa
  macchina (`localhost`, `127.x`, `::1`) il cui URL non specifica alcun `sslmode`, proprio come fa
  l'app, invece di fallire con `SSL is not enabled on the server`; un URL che
  specifica `sslmode`, o un host diverso, viene gestito esattamente come scritto. Un'esecuzione di Atlas
  che fallisce prima della pianificazione non lascia residui del database `<db>_dev_diff`
- `--dry-run`
  non scrive nulla nel progetto: `src/schema.generated.ts` viene lasciato inalterato,
  e le copie `drizzle/*.sql` sottoposte a commit da una versione precedente vengono menzionate, non
  eliminate. Solo l'input del piano viene salvato in `.rebase/sql/`, che non viene sottoposto a commit
- **Non** crea file di migrazione

**Quanto tempo richiede.** Quasi l'intera durata di un push è dovuta al calcolo del piano da parte di Atlas: genera lo schema desiderato in un database temporaneo e ne calcola il diff rispetto a quello reale, e tale costo computazionale cresce più velocemente del numero di tabelle — su un computer portatile con carico minimo circa 0,25 s per piano con 11 tabelle, 0,9 s con 111 e 5,5 s con 411. Un push che non apporta modifiche esegue la pianificazione una sola volta; uno che apporta modifiche pianifica due volte (il dry run verificato dal controllo delle modifiche distruttive, poi l'applicazione). Di conseguenza, un push su uno schema di 400 o più tabelle richiede decine di secondi, e anche di più su una macchina lenta o sotto carico. Tale tempo è impiegato da Atlas, non dal database: i passaggi accessori — generazione dell'SQL, lock RLS, ricerca, trigger, policy, ruolo — richiedono solo pochi secondi per tali dimensioni, attraverso un'unica connessione al tuo database.

**I file generati durante il processo**, tutti salvati in `.rebase/sql/` nella
directory del backend. `db push` e `db generate` scrivono tutti e cinque i file a partire dalle tabelle
a ogni esecuzione, prima di leggerne alcuno; pertanto, un'eventuale copia sottoposta a commit non verrebbe
mai letta da nulla. La directory include il proprio file `.gitignore` e non va mai sottoposta a commit.

| File | Contenuto |
|------|-----------|
| `schema.sql` | Tabelle, colonne, vincoli e indici — lo stato desiderato da Atlas, e l'unico su cui viene calcolato il diff |
| `policies.sql` | Le policy RLS risultanti dalla compilazione del blocco `rls` delle tue tabelle |
| `search.sql` | Le funzioni di ricerca full-text e le colonne generate, per le tabelle dotate di un blocco `search` |
| `vector.sql` | Estensioni pgvector e indici ANN |
| `triggers.sql` | `rebase.set_updated_at()` e i trigger `BEFORE UPDATE` alla base di `.onUpdateNow()` |

Atlas gestisce solo il primo file e nient'altro, quindi `db push` e la procedura di verifica dello schema all'avvio applicano autonomamente gli altri quattro. Un deployment basato **esclusivamente su migrazioni** — ovvero che esegue `db migrate` e mai `db push` — deve integrare manualmente questi quattro elementi in una migrazione; `db generate` segnala quando una modifica non è visibile ad Atlas.

In un progetto in cui tali file erano stati sottoposti a commit in `drizzle/` in una versione precedente, queste copie verranno eliminate alla prima esecuzione e il comando indicherà ciascuna di esse per consentirti di registrarne l'eliminazione con un commit. Vengono eliminati solo i file che iniziano con l'intestazione del generatore. Qualsiasi file scritto manualmente rimane intatto, così come `drizzle/migrations/`.

:::note[La modifica di una regola di sicurezza rinomina la relativa policy]
Una regola senza un `name` esplicito compila in `<table>_<op>_<hash>`, dove l'hash copre la semantica della regola — di conseguenza, *modificare* una regola (anziché aggiungerne una nuova) genera una policy con un nuovo nome lasciando invariata quella precedente.

Questo in passato rappresentava un problema rilevante: Postgres combina le policy `PERMISSIVE` con l'operatore OR, per cui una policy sostituita del tipo `USING (rebase.uid() IS NOT NULL)` continuava a concedere tutti i permessi, a prescindere da quanto restrittiva fosse la sua sostituta. Rendere più restrittiva una regola non aveva alcun effetto, e il comando di push segnalava comunque l'operazione come riuscita.

`db push` ora riconcilia questo comportamento: rimuove le policy generate che non corrispondono più ad alcuna regola e segnala — senza eliminarle — le policy con nomi personalizzati non descritte dalle tue tabelle, poiché indistinguibili da codice SQL scritto intenzionalmente da un utente.

Per verificare un database su cui è stato eseguito il push prima di questa novità, esegui `rebase doctor --policies`. Funziona come gate di CI: restituisce un codice di uscita diverso da zero in caso di disallineamento (drift), nonché quando non è possibile eseguire affatto il controllo — assenza di `DATABASE_URL`, percorso `--schema-dir` non risolvibile, permessi di lettura su `pg_policies` non concessi al ruolo della CI. Un gate che non ha potuto verificare non è superato.

`doctor` e `db push` distinguono le due tipologie di policy orfane. Una policy con un nome generato è considerata obsoleta/sostituita e il push successivo la rimuoverà. Qualsiasi altro nome è stato scritto a mano o da un altro strumento ed è ancora attivo: descrivila nel blocco `rls` della relativa tabella per mantenerla (la vista RLS di Studio la importa), oppure eliminala con `rebase db push --prune-policies` se non è più necessaria.
:::

:::caution
`db push` modifica direttamente il database. Utilizzalo solo in fase di sviluppo. Per la produzione, usa `db generate` + `db migrate` per creare file di migrazione esaminabili.
:::

### `rebase db generate`

Genera file di migrazione SQL a partire dalle modifiche allo schema:

```bash
rebase db generate
```

**Cosa fa:**
- Confronta lo schema Drizzle con lo stato generato dalle migrazioni in `drizzle/migrations/`, non con il tuo database
- Genera file di migrazione SQL dotati di timestamp in `backend/drizzle/migrations/`
- I file possono essere esaminati, modificati e sottoposti a commit nel sistema di controllo versione
- Segnala ogni
  istruzione nella nuova migrazione che comporta la distruzione di dati, utilizzando lo stesso controllo che `db push`
  esegue prima dell'applicazione: eliminazione di tabelle, colonne, schemi, viste o tipi, un
  `TRUNCATE`, una modifica al tipo di colonna che può causare la perdita di valori, una modifica della chiave
  primaria o l'eliminazione di un vincolo CHECK o EXCLUDE presente nel database. Il file viene comunque scritto ed esce con codice 0, emettendo un avviso senza bloccare l'operazione.
- Conclude indicando
  i passaggi successivi: `rebase db migrate` e, per la prima migrazione di un progetto, il
  comando `--baseline <version>` necessario se il database è già stato configurato all'avvio (boot). Una
  migrazione successiva non include l'indicazione del baseline, poiché impostare un baseline su una migrazione distruttiva
  salterebbe i relativi `DROP`, e un'esecuzione che non produce alcuna migrazione si limita a segnalarlo.

**Un vincolo CHECK aggiunto da una tua migrazione viene rimosso da quella successiva.** `db generate`
calcola il diff sui file di migrazione, non sul database, e Atlas non ha modo di escludere un
oggetto da tale diff. Di conseguenza, un vincolo CHECK o EXCLUDE inserito a mano in una
migrazione, e che nessuna tabella è in grado di dichiarare, ricomparirà come
`ALTER TABLE … DROP CONSTRAINT …` nella successiva migrazione generata, accorpato nella
medesima istruzione della modifica reale. Il report sopra indicato segnala tale eliminazione quando
il database include già il vincolo; non lo rimuove dal file. Elimina la clausola prima di eseguire `rebase db migrate`, oppure lascia che
`rebase db migrate --refuse-destructive` si arresti su di essa. `db push` legge il
database e mantiene il vincolo.

Le migrazioni generate sono semplici file SQL: puoi ispezionarli e modificarli prima di applicarli.

### `rebase db migrate`

Esegue tutte le migrazioni in sospeso:

```bash
rebase db migrate
```

**Cosa fa:**
- Legge `drizzle/migrations/` alla ricerca di migrazioni non ancora applicate
- Le applica in ordine al database
- Traccia quali migrazioni sono state applicate
- Appone un contrassegno (stamp) alle
  policy di row-level security come fanno `db push` e il boot del server, affinché
  il primo avvio successivo a una migrazione le lasci inalterate invece di ricrearle ciascuna.
  Una migrazione è stata scritta in base alle tabelle dell'epoca, quindi una policy viene
  contrassegnata solo se corrisponde esattamente a ciò che la sua regola produce attualmente:
  migrate la ricrea a partire dalla regola con un altro nome, all'interno di una transazione annullata (rollback),
  e confronta ciò che Postgres ha memorizzato, analogamente a `db push --dry-run`. Una policy che
  differisce non riceve alcun contrassegno e il boot successivo riapplicherà la relativa tabella

`--refuse-destructive`
fa sì che l'operazione venga rifiutata. Esegue prima un dry run delle migrazioni in sospeso. Se un'istruzione
distrugge dati, in base al medesimo controllo impiegato da `db push` e `db generate`,
elenca tali istruzioni ed esce con codice 1. Non applica nulla, nemmeno i file
precedenti a tale istruzione. Senza questo flag, `db migrate` si comporta come di consueto e
applica ogni file in sospeso:

```bash
rebase db migrate --refuse-destructive
```

Una migrazione che ricostruisce una colonna di ricerca la rimuove preventivamente, pertanto questo flag rifiuterà
anche tale migrazione. Leggi l'elenco stampato a video, quindi esegui `rebase db migrate`
senza il flag per applicarla.

#### Esecuzione del baseline su un database già avviato da Rebase

Ogni avvio di Rebase verifica e assicura lo schema, e `rebase db push` lo applica direttamente. Pertanto, un database che abbia mai eseguito uno dei due possiede già le tabelle e i tipi che la prima migrazione andrebbe a creare, e `rebase db migrate` si blocca con `pq: type "posts_status" already exists (42710)`.

Non c'è nulla di errato nella migrazione: il database è stato semplicemente configurato in un altro modo. Registra lo stato in cui si trova attualmente, quindi esegui la migrazione normalmente:

```bash
rebase db migrate --baseline 20260906101530
rebase db migrate
```

La versione corrisponde al prefisso numerico del file di migrazione che descrive lo stato *attuale* del database. Quella migrazione e tutte le precedenti vengono registrate come applicate; tutto ciò che segue verrà eseguito. Su un database contro cui non è mai stato avviato nulla non è necessario alcun baseline: è possibile migrare immediatamente.

Lo stesso si verifica successivamente nel normale ciclo di sviluppo: modificando una tabella mentre `rebase dev` è in esecuzione, il boot aggiunge la colonna prima che `rebase db generate` scriva la migrazione corrispondente; di conseguenza `rebase db migrate` si arresta con `column … already exists (42701)`. Esegui il baseline di quella migrazione nello stesso modo. `--baseline` funziona anche su un database che registra già le migrazioni: contrassegna tutto fino alla versione specificata come applicato tramite `atlas migrate set` e lo segnala, oppure indica che non c'è nulla da registrare se la cronologia ha già raggiunto tale versione. Una versione non presente in alcun file di `drizzle/migrations` viene rifiutata prima di avviare qualsiasi operazione, indicando le versioni disponibili.

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
pertanto richiede un server PostgreSQL reale e occupa lo stesso spazio su disco della sorgente.

### `rebase doctor`

Rileva il disallineamento a tre vie (three-way drift) tra le tue tabelle, lo schema Drizzle generato e il database PostgreSQL live:

```bash
rebase doctor
```

**Cosa controlla:**
- Tabelle ↔ Schema generato — sono sincronizzati?
- Schema generato ↔ Database — ci sono modifiche non applicate?
- Tabelle ↔ Database — c'è un disallineamento imprevisto?

Esegui `doctor` ogni volta che qualcosa sembra non sincronizzato. Individua esattamente dove si trova la discrepanza.

Il confronto del database include quello che il boot esegue prima di segnalare che `schema.generated.ts` e il database non concordano, eseguito tramite il medesimo codice. Di conseguenza, ogni differenza segnalata dal boot è presente anche nel report, con le stesse parole: una colonna che è NOT NULL da un lato e nullable dall'altro, e una colonna che il database possiede ancora ma il file no (il boot non elimina mai le colonne, quindi una proprietà rinominata lascia la vecchia colonna al suo posto). Ognuna di queste è un avviso, e la correzione suggerita indica `rebase db push`.

Il confronto del database legge il database del progetto, risolto nello stesso modo in cui lo risolve `rebase db url` — su un nuovo scaffold quello gestito, che `doctor` provvede ad avviare. Quando non è possibile risolverne alcuno, tale fase viene segnalata come **skipped** (saltata) anziché superata, e l'esecuzione non si conclude mai con "All schemas are in sync": un controllo che non è stato eseguito non equivale a un esito positivo.

Indica inoltre ogni tabella priva di un [blocco `search`](/docs/backend/search) che contiene più di circa 10.000 righe. Una ricerca in tali tabelle — la casella di ricerca dell'admin, `.search()`, `?searchString=` — si traduce in un `ILIKE '%term%'` sulle colonne di testo, che nessun indice può servire; pertanto ogni ricerca legge l'intera tabella e il relativo conteggio la rilegge una seconda volta (circa un terzo di secondo con 100.000 righe, crescendo all'aumentare della tabella). Il numero di righe è una stima interna di Postgres, quindi il controllo non esegue alcuna scansione della tabella. Si tratta di un suggerimento: non modifica il codice di uscita e non viene indicizzato nulla automaticamente.

Segnala inoltre eventuali **junction orfane** (orphaned junction): una tabella in `public` strutturata come una junction many-to-many che nessuna tabella dichiara. Tale struttura prevede due colonne che insieme compongono la chiave primaria, ciascuna chiave esterna verso una tabella dichiarata. Rinominare o rimuovere una relazione `manyToMany` lascia la vecchia junction nel database, poiché push e boot si limitano a creare tabelle, e ogni riga di collegamento rimane al suo interno. La segnalazione è a solo scopo informativo, quindi non modifica il codice di uscita. La soluzione consiste nell'istruzione `DROP TABLE`, che `doctor` mostra senza mai eseguirla.

### `rebase generate-sdk`

Genera un SDK tipizzato a partire dalle tue tabelle:

```bash
rebase generate-sdk
```

**Cosa fa:**
- Legge le tabelle esportate da `backend/schema/index.ts`, tramite il loader da cui si avvia il backend, in modo che l'SDK descriva esattamente le tabelle fornite; uno schema che non compila interrompe l'esecuzione
- Genera tipi TypeScript per ogni tabella in `generated/sdk/`
- Produce un file `database.types.ts` da utilizzare con `createRebaseClient<Database>()`: il tipo `Database`, `TableName` (l'unione di tutti gli slug) e `tablesDictionary` / `TablesDictionary`, la mappa dall'accessor allo slug

`rebase dev` esegue questa operazione automaticamente all'avvio e a ogni salvataggio
all'interno di `backend/schema/`. Eseguilo manualmente in CI, in un repository che non
contiene tabelle proprie (vedi `--from` sotto), o ovunque `rebase dev` non sia in esecuzione.

**Opzioni:**

| Flag | Descrizione |
|------|-------------|
| `--schema-dir` | La directory dello schema (predefinita: `backend/schema`, oppure la chiave `tables` in `rebase.json`); i percorsi relativi vengono risolti a partire da dove viene eseguito il comando |
| `-o`, `--output` | Directory di output per l'SDK (predefinita: `generated/sdk/`) |
| `--from <link\|url>` | Legge lo schema da un progetto in esecuzione invece che dai sorgenti locali. `link` utilizza il progetto collegato a questo checkout. |
| `--token` | Bearer token per l'endpoint di contract (predefinito: `$REBASE_SERVICE_KEY` dalla shell; `.env` non viene letto) |
| `--register` | Tipizza anche i dati lato server: scrive i tipi e una dichiarazione `Register` in `backend/generated/`, memorizzandola in `rebase.json` — vedi [Dati lato server tipizzati](/docs/backend/typed-server-data/) |

`--from` consente a un repository privo di tabelle — un frontend separato,
una seconda web app, un'app mobile — di generare un client tipizzato dal
progetto con cui comunica: legge le `tables` dell'endpoint
`/api/meta/contract` del backend in esecuzione. `REBASE_SERVICE_KEY` viene inviata solo al progetto a cui
questo checkout è collegato; passa `--token` esplicitamente per qualsiasi altro host. La chiave presente in
`.env` appartiene al tuo backend locale e non viene mai inviata.
Un eventuale rifiuto indica
quale di questi casi si è verificato: un `--token` rifiutato, una chiave della shell rifiutata, una chiave
non inviata a un host non collegato, una chiave presente solo in `.env`, oppure l'assenza totale di una chiave.

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

I nomi dei campi nei tipi generati corrispondono a quelli forniti dall'API. Il nome di rete
(wire name) di un campo è la sua chiave di colonna, e l'API utilizza interamente la convenzione camelCase:
l'introspezione scrive una colonna `created_at` come `createdAt: col.timestamp({ withTimezone: true })`, il cui nome SQL
è lo snake_case della chiave, e la restituisce come `row.createdAt`. La colonna
stessa rimane inalterata. L'*accessor* della tabella viene trasformato nel nome di una proprietà
nello stesso modo (`my-notes` → `client.data.myNotes`), che è ciò che `tablesDictionary`
mappa nuovamente allo slug.

### `rebase migrate`

`rebase migrate collections-to-tables [dir]` sposta `config/collections` in
`backend/schema` (un `defineTable` per collection, con ogni colonna esplicita nella
sua posizione originale, secondo la sintassi di Drizzle, e `index.ts` con
`defaultRls`) e `frontend/src/cms` (un `customizeTable` per ogni collection personalizzata,
file `defineFirestoreCollection`, `ui-config.json`), scrive
`backend/resources.ts`, `backend/storage.ts` e `backend/generated/register.ts`,
aggiunge `rebaseBackendGuard()` al file `vite.config.ts` di uno scaffold, quindi esegue
`rebase migrate sdk-calls`, che riscrive `.collection(` in `.table(`, applica le
altre ridenominazioni dell'SDK e le sorgenti di regole `existsIn` / `membership` nel tuo codice,
e sposta gli import dei nomi che la versione 0.31 ha trasferito in un altro pacchetto
([l'elenco](/docs/upgrading/0-30-to-0-31-imports/)), aggiungendo il pacchetto alle
dipendenze dell'importatore ("Dependencies added": esegui `pnpm install`). Aggiorna ogni pacchetto `@rebasepro` alla versione 0.31 prima di eseguirlo.
Ogni esecuzione rilegge il risultato: l'SQL generato — DDL, policy, ricerca,
vettori, trigger, viste, lo schema Drizzle — deve essere identico byte per byte, altrimenti ogni
file viene ripristinato. Ciò che non è possibile convertire viene rifiutato indicando file e riga, e
ciò che viene lasciato all'utente viene stampato come passaggi manuali numerati, terminando con
`rebase skills install` se il progetto include agent skill. I tuoi moduli personalizzati in
`config/` rimangono; l'esecuzione stampa il comando `git rm` per gli elementi sostituiti. Gestisce inoltre
le collection Firestore costruite da funzioni, gli alias di percorso, i pannelli montati
all'esterno di `App.tsx` e tutte le app statiche non protette ([l'elenco completo](/docs/upgrading/0-30-to-0-31/#108-tables-in-backendschema-replace-configcollections--run-the-codemod-first)).
Dopo il comando `git rm`, `--check` segnala `already-migrated`.

| Flag | Effetto |
|---|---|
| `--dry-run` | Stampa file, rifiuti, note e passaggi manuali; non scrive nulla. Inizia da qui. |
| `--check` | Su un progetto migrato: verifica che `backend/schema` generi ancora lo stesso SQL. Esce con codice 1 mostrando il diff, oppure se una regola cambia significato. |
| `--accept-rule-changes` | Con `--check`: conferma che le regole sotto "Review before deploying" sono state revisionate. |
| `--json` / `--force` / `--skip-sdk-calls` | Il report in formato JSON (con `ruleChanges`); esegue su un working tree con modifiche non committate o su output modificato; non tocca il tuo codice. |

Esamina due elenchi nell'output dell'SDK: **"Rewritten by name — review"** (ricevitori non
tipizzati, data slot, test double) e **"Left unchanged — check each"**
(rinomina quelli appartenenti all'SDK; [una ricerca](/docs/upgrading/0-30-to-0-31-by-hand/#sdk-calls-no-type-checker-sees) individua il resto).

Il controllo SQL dimostra che la conversione è fedele, non che una regola mantenga il
medesimo significato originale. L'ultima sezione dell'output, **"Review before deploying: these rules
change meaning"**, elenca ogni regola la cui policy ora concede autorizzazioni differenti
— un semplice `access: "authenticated"` non concedeva nulla, mentre ora ammette qualsiasi chiamante
autenticato ([le quattro casistiche](/docs/upgrading/0-30-to-0-31/#review-before-deploying-these-rules-change-meaning)).
Dopodiché effettua un controllo rispetto al tuo database: `rebase db push --dry-run` dovrebbe stampare "No
changes: the database already matches these tables.", e
`rebase doctor --policies` non dovrebbe mostrare alcun disallineamento (drift).

## Flusso di lavoro per lo sviluppo

Il flusso di lavoro a iterazione rapida per lo sviluppo:

```bash
# 1. Edit a table in backend/schema/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Push directly to dev database
rebase db push
```

## Flusso di lavoro per la produzione

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
| La migrazione mostra modifiche impreviste | Esegui `rebase doctor` per identificare il disallineamento |
| `db push` fallisce in produzione | Usa invece `db generate` + `db migrate` |
| Una migrazione non deve perdere dati in CI o in produzione | `rebase db migrate --refuse-destructive` esce con codice 1 e non applica nulla se un'istruzione in sospeso distrugge dati |
| `db migrate` fallisce con `already exists (42710)` | Il boot o `db push` hanno già eseguito il provisioning dello schema — registralo con `rebase db migrate --baseline <version>` |
| `db migrate` fallisce con `column … already exists (42701)` | `rebase dev` ha aggiunto la colonna all'avvio — esegui il baseline della migrazione nello stesso modo |
| `db push` sul database gestito fallisce con `Error: EOF` | Atlas ha perso una connessione occupata da `rebase dev` in esecuzione. Eseguilo di nuovo; se continua a fallire, arresta prima `rebase dev` |

## Passaggi successivi

- **[Tabelle](/docs/schema/)** — Definisci il tuo modello di dati
- **[Riferimento CLI](/docs/cli)** — Tutti i comandi della CLI
- **[SDK tipizzato](/docs/sdk)** — Utilizza l'SDK generato
