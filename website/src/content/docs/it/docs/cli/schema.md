---
sourceHash: be35acd402d34ec0
title: Generazione dello Schema
sidebar_label: Generazione dello Schema
description: Genera schemi Drizzle ORM dalle tabelle in backend/schema, crea migrazioni SQL, esegui l'introspezione di un database esistente in file defineTable e mantieni il tuo database sincronizzato con la CLI di Rebase.
---

## Panoramica

Rebase utilizza una pipeline **schema-as-code** in cui le tabelle dichiarate con
`defineTable` in `backend/schema/` rappresentano la singola fonte di verità. La CLI
le trasforma attraverso una pipeline deterministica:

```
Tables (backend/schema) → Drizzle Schema → SQL Migrations → PostgreSQL
```

Questa pagina illustra ogni comando della CLI coinvolto in questa pipeline.

## Quale usare?

Una modifica a una tabella raggiunge PostgreSQL in tre modi:

- **All'avvio (boot), in autonomia.** Il backend applica la parte additiva a ogni avvio (`REBASE_MIGRATE_ON_BOOT=ensure`, il valore predefinito): tabelle, colonne, tipi enum e policy di row-level security mancanti. Con `rebase dev`, una tabella o una colonna aggiunta non richiede nient'altro. L'avvio non esegue mai drop, ridenominazioni o restrizioni di tipo.
- **`rebase db push`, in sviluppo.** Sincronizza lo schema direttamente con il database, inclusi drop e ridenominazioni, protetto dal suo [gate per le modifiche distruttive](#rebase-db-push). Usalo su un database per il quale non gestisci migrazioni.
- **`rebase db generate` + `rebase db migrate`, in produzione.** Ogni modifica è un file SQL revisionato nel controllo versione, applicato in ordine.

Il passaggio alle migrazioni di un database già configurato dal boot o da `db push` richiede una baseline, poiché contiene già le tabelle create dalla prima migrazione. `rebase db migrate` rileva questa condizione prima di eseguire qualsiasi operazione, si interrompe e stampa il comando `rebase db migrate --baseline <version>` da eseguire con la versione già compilata; vedi [Impostare una baseline per un database già avviato da Rebase](#baselining-a-database-rebase-has-already-booted). Al contrario, `db push` su un database che tiene traccia delle migrazioni lo segnala in una riga: la migrazione successiva che apporta la stessa modifica si arresterà con `already exists`.

## La Pipeline

### 1. Tabelle → Schema Drizzle

Le tabelle esportate da `backend/schema/index.ts` descrivono colonne, tipi, relazioni,
enum e row-level security. Ognuno dei comandi sottostanti le legge attraverso il loader
utilizzato all'avvio del backend; pertanto, uno schema che non compila — una tabella priva di
`rls`, un `"inherit"` senza `defaultRls`, un `defineTable` non esportato dall'index — interrompe
il comando con un errore `SchemaDefinitionError` che specifica ciascun problema,
e non viene scritto nulla. Il comando `schema generate` produce a partire da esse un file di schema
Drizzle ORM.

Ogni comando che legge lo schema accetta `--schema-dir <dir>` per i progetti
che conservano le tabelle altrove; il percorso predefinito è `backend/schema`, oppure la
chiave `tables` dell'app backend in `rebase.json`. `--collections` / `-c`, il
flag precedente alla versione 0.31, viene rifiutato con un messaggio che indica il codemod
([`rebase migrate collections-to-tables`](#rebase-migrate)), così come viene rifiutato un
progetto che contiene ancora `config/collections`.

### 2. Schema Drizzle → Migrazioni

A partire dallo schema Drizzle generato, `db generate` calcola il diff rispetto alle migrazioni già presenti in `backend/drizzle/migrations/` rieseguite su un database temporaneo, e produce file di migrazione SQL dotati di timestamp. Non legge mai il tuo database: una colonna già aggiunta tramite boot o `db push` verrà comunque generata come `ADD COLUMN`.

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
| `--schema-dir` | La directory dello schema (predefinita: `backend/schema`); i percorsi relativi vengono risolti a partire dalla directory in cui viene eseguito il comando |
| `--output, -o` | Percorso di destinazione per il file di schema generato; i percorsi relativi vengono risolti a partire dalla directory in cui viene eseguito il comando |
| `--watch, -w` | Monitora le modifiche e rigenera automaticamente |

La **modalità watch** è utile durante lo sviluppo: modificando il file di una tabella, lo schema viene rigenerato istantaneamente:

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
- Effettua il rendering di quanto generato dalle tabelle in `backend/schema/` e lo confronta, dichiarazione per dichiarazione, con `backend/src/schema.generated.ts`
- Elenca ogni differenza — una tabella mancante, una colonna con un tipo modificato, un'etichetta enum rimossa o foreign key denominate secondo la convenzione di una release precedente — ed esce con un codice diverso da zero
- Con `--fix`, rigenera il file invece di limitarsi alla segnalazione

`rebase dev` mantiene il file aggiornato autonomamente, quindi questo controllo è
pensato per una build o uno step di CI. Accetta `--schema-dir` e `--output` esattamente
come `rebase schema generate`.

### `rebase schema reconcile`

Rimuovi vincoli ed elimina ciò che l'avvio (boot) non gestisce, dopo aver esaminato il piano:

```bash
rebase schema reconcile                         # relax NOT NULL on columns made nullable or removed
rebase schema reconcile --drop voice_cache.wav  # and drop a column no table declares
```

**Cosa fa:**
- Richiede al backend in esecuzione di pianificare le operazioni rispetto al proprio database. È il backend a cui puntano il file `.env` e il collegamento cloud, pertanto funziona su Rebase Cloud, dove nient'altro può accedere al database.
- Pianifica `DROP NOT NULL` per ogni colonna dichiarata nullable in una tabella che il database richiede ancora come obbligatoria.
- Elenca tutte le colonne non dichiarate in alcuna tabella. Una colonna `NOT NULL` senza valore predefinito bloccherebbe ogni operazione di inserimento, quindi viene allentato anche questo vincolo, preservando i dati. Elimina solo le colonne specificate con `--drop <table>.<column>`, mostrando quante righe contengono un valore per ciascuna di esse.
- Applica le modifiche dopo aver digitato `yes`. Il server esegue il piano unicamente in base al digest di quello appena esaminato; se il database o le tabelle sono cambiati nel frattempo, l'operazione viene rifiutata ed è necessario procedere a una nuova revisione. `--yes` salta la richiesta di conferma.

L'avvio (boot) si limita ad aggiungere elementi, pertanto dopo aver rimosso una colonna dal relativo `defineTable`, la colonna rimane nel database insieme ai suoi dati. Una colonna `NOT NULL` priva di valore predefinito causerebbe quindi il fallimento di ogni inserimento, e il log del boot segnala questo comando per risolvere il problema: senza `--drop` per preservare i dati, o con `--drop` per rimuovere la colonna. Esegui prima il deploy della modifica alla tabella, poiché reconcile pianifica le azioni rispetto a ciò che il backend sta eseguendo. Richiede `REBASE_SERVICE_KEY` in `.env`. In locale, `rebase db push` copre lo stesso scenario tramite il suo gate per le modifiche distruttive.

### `rebase schema introspect`

Genera i file `defineTable` a partire da un database PostgreSQL esistente:

```bash
rebase schema introspect
```

**Cosa fa:**
- Si connette al database di questo progetto, quello stampato da `rebase db url` (se si tratta di quello gestito, viene avviato se necessario); `--database-url` ne indica un altro e `--docker` utilizza quello di compose
- Legge ogni tabella, colonna, tipo, foreign key e policy, e scrive
  `backend/schema/<table>.ts` — un `defineTable` per tabella — e il
  file `backend/schema/index.ts` che le esporta (integrandosi in un index
  eventualmente già presente)
- Dichiara ciascuna colonna con il rispettivo tipo Postgres: `col.uuid()`, `col.varchar({ length })`,
  `col.numeric({ precision, scale })`, un enum con le relative etichette e il nome del tipo reale
  (un `pgEnum` se il tipo è condiviso), un array come `<item>.array()`,
  `col.vector({ dimensions })`, chiavi identity e serial, valori predefiniti — formulati secondo la sintassi
  di Drizzle. Un tipo non supportato da alcun builder diventa
  `col.custom({ dataType: "<sql type>" })`, che Rebase restituisce così come
  fornito dal driver; `db generate` e `db push` lo rifiutano fino a quando il planner
  non è in grado di gestirlo
- Dichiara la colonna foreign-key, la relazione `belongsTo` su di essa e la corrispondente
  `hasMany` sull'entità di destinazione; una tabella di giunzione diventa una `manyToMany`, le cui
  colonne costituiscono il `pivot`
- Importa le policy di row-level security di ciascuna tabella nel rispettivo `rls`: nome,
  comando, modalità, elenco `TO`, `USING` e `WITH CHECK`. Le policy `<table>_default_*`
  aggiunte direttamente da Rebase vengono escluse, in modo che il successivo `db push` ricrei
  ogni policy esattamente com'era. Una tabella con row-level security abilitata ma priva di policy
  viene scritta come `rls: "admin-only"`
- Valuta ogni espressione (la clausola `USING` di una policy, un vincolo CHECK, un valore predefinito di colonna) nel
  `search_path` utilizzato dal server, ovvero `public`, di conseguenza una funzione nello schema
  `rebase` viene scritta come `rebase.roles()`
- Converte i vincoli CHECK interpretabili (`total >= 0`) nel metodo `.validate()` della colonna, mantenendo il vincolo effettivo nel database, dove il push successivo continuerà a preservarlo. Ciascun CHECK viene inoltre elencato in "Not carried over" con il relativo SQL: un push su un *nuovo* database creerà la validazione, non il vincolo
- Dichiara ogni indice semplice (solo colonne, btree, gin o brin, senza predicati) negli `indexes` della tabella. Un indice presente sulla sola colonna foreign key viene delegato alla relazione, che provvede a crearne uno
- Con `--from supabase`, adatta le convenzioni di Supabase per un database in fase di migrazione: un valore predefinito di colonna pari ad `auth.uid()` diventa `.onCreateUser()` (il server registra l'ID del chiamante), una colonna contenente un ID utente di Supabase (tale valore predefinito o una foreign key verso `auth.users`) diventa `col.text().userId()`, poiché `rebase.users.id` e `rebase.uid()` sono di tipo text, e una policy `TO authenticated` / `TO anon` perde il ruolo (un database Rebase non prevede né l'uno né l'altro) richiedendo invece un chiamante autenticato / non autenticato; le policy destinate esclusivamente a `service_role` vengono rimosse. Ciascuna modifica viene annotata all'inizio del file della tabella. Senza questo flag, tali elementi vengono lasciati invariati (Rebase in esecuzione sullo stesso database in parallelo con Supabase ne ha ancora bisogno), e l'esecuzione segnala dove sono stati riscontrati
- Conclude indicando ciò che **non** è stato riportato: funzioni, trigger, estensioni, CHECK, indici non esprimibili tramite `indexes`, foreign key composte da più colonne o rivolte verso un altro schema. L'SQL in grado di ricreare ciascuno di questi elementi supportati da Postgres viene scritto in `backend/sql/_introspected-left-behind.sql`, una bozza: esaminalo, rendilo idempotente per esecuzioni ripetute e rinominalo rimuovendo il carattere iniziale `_`; `rebase db push` e ogni successivo deploy lo applicheranno ogni volta che risulterà modificato
- Ricorda che `DATABASE_URL` punta ancora al database analizzato: in una migrazione questo rappresenta l'origine, e un `db push` eseguito a questo punto scriverebbe direttamente al suo interno
- In un progetto headless, sostituisce le istruzioni `ai-instructions.md` dello scaffold ("the database is the schema") con le regole di schema-in-code specifiche per il backend, a patto che il file sia identico a come generato dallo scaffold; un file modificato non viene toccato, e il comando segnala quali regole non sono più valide
- Inserisce ciò che non è stato possibile determinare con certezza in un commento in cima al file della tabella e nel terminale — un set chiuso di stringhe su una colonna di testo, una colonna generata la cui espressione non è stata analizzata, un tipo personalizzato — descrivendo come verrebbe trattato da un push
- Con `--data-inference`, campiona fino a 100 righe per tabella e scrive gli elementi
  relativi alla presentazione rilevati — titoli, icone, board, ordinamenti, opzioni dei campi — in
  `frontend/src/cms/<table>.tsx` sotto forma di `customizeTable`, purché il frontend del
  progetto dipenda da `@rebasepro/cms`. Un progetto headless non riceve nulla
- A fronte di un database non attivo, stampa una sola volta lo stesso messaggio di avviso
  visualizzato da `db push` e non crea nulla. Mostra la directory di output come
  percorso assoluto

**Opzioni:**

| Flag | Descrizione |
|------|-------------|
| `--schema-dir` | Dove scrivere i file delle tabelle (predefinito: `backend/schema`). `--output` è stato rimosso |
| `--schema` | Lo schema Postgres da leggere (predefinito: `public`) |
| `--force, -f` | Sovrascrive i file delle tabelle già esistenti; senza questo flag, un file esistente viene ignorato |
| `--database-url` | Legge questo database invece di quello del progetto |
| `--docker` | Legge il database compose, avviandolo se necessario |
| `--from supabase` | Adatta le convenzioni di Supabase (valori predefiniti `auth.uid()`, foreign key verso `auth.users`, `TO anon` / `TO authenticated`) per un database Rebase. Non utilizzarlo se Rebase è in esecuzione sullo stesso database a fianco di Supabase |
| `--data-inference` / `--no-data-inference` | Campiona fino a 100 righe per tabella per rilevare formati, vincoli e impostazioni del pannello, oppure legge soltanto la struttura. In assenza di entrambi i flag richiede conferma, mentre in assenza di un terminale interattivo legge solo la struttura |
| `--users` | Scrive anche `users.ts` per `rebase.users`, come `defineAuthTable` corrispondente alla tabella creata da auth. Mostra la sezione Utenti nell'admin come tabella a cui poter aggiungere colonne. Senza di esso, gli account sono gestiti nella sezione Users & Roles dello Studio |

Questo comando è utile per adottare Rebase su un database esistente: prima si esegue l'introspezione,
poi si modificano le tabelle generate. Una tabella con row-level security disattivata viene
scritta come qualsiasi altra, con il proprio blocco `rls`; il push attiverà la RLS, e il dry
run lo indicherà. Un backend in esecuzione privo di `backend/schema` serve invece
direttamente il database — vedi [Solo backend](/docs/getting-started/headless/).
Stai migrando da Supabase? Vedi [Migrazione da Supabase](/docs/recipes/migrate-from-supabase/).

### `rebase db push`

Invia le modifiche allo schema direttamente al database senza file di migrazione:

```bash
rebase db push
```

**Cosa fa:**
- Legge lo schema Drizzle generato
- Applica le modifiche direttamente al database (CREATE, ALTER, DROP)
- Esegue prima un dry run del piano e si arresta prima di qualsiasi operazione che distrugge dati: una
  tabella, colonna, schema, vista o tipo eliminato, un `TRUNCATE`, o una modifica al tipo
  di una colonna che può comportare la perdita di valori (`timestamptz` → `date`, `numeric` → `integer`),
  oppure una modifica alla chiave primaria — `(id)` → `(id, locale)` assegna a ogni riga un nuovo ID,
  quindi link, foreign key e ID salvati altrove non troveranno più la rispettiva riga.
  Si arresta inoltre
  prima dell'eliminazione di un vincolo CHECK o EXCLUDE presente nel database: nessuna riga
  va persa, ma da quel momento in poi il database accetterà le righe che prima rifiutava.
  Richiede conferma su terminale, dove premere Ctrl-C o Ctrl-D equivale a rispondere no, e in caso
  contrario rifiuta l'operazione; `--allow-destructive` la applica comunque. Anche `--yes` lo consente
  in questa release, mostrando un avviso di deprecazione; a partire dalla prossima release approverà
  esclusivamente i push che non distruggono dati. Un push che
  si interrompe a questo punto provvede a eliminare il proprio database temporaneo `<db>_dev_diff`
- Attiva la row-level security per ogni tabella dichiarata, tabelle di giunzione incluse, subito dopo
  la modifica allo schema e prima di qualsiasi passaggio che potrebbe fallire, in modo che un push interrotto
  a metà lasci la nuova tabella in uno stato che nega ogni richiesta anziché lasciarla accessibile a tutti
- Applica le policy RLS generate dal blocco `rls` delle tue tabelle e **rimuove le policy superate da un push precedente**
- <span class="since-badge" data-since="0.35">Da 0.35</span> Con `--prune-policies`, elimina anche le policy sulle tabelle dichiarate che nessuna tabella dichiara più — quelle che il dry run elenca come "left in force", come ad esempio le policy proprie del database dopo che una tabella è passata a `rls: "admin-only"` — all'interno della medesima transazione che applica quelle dichiarate. Il dry run elenca ciascuna di esse sotto "Planned row-level security changes", e il push le sottopone a verifica come per le colonne eliminate (chiede conferma su terminale, e richiede altrove `--allow-destructive`): eliminare una policy modifica chi può leggere e scrivere le righe, e l'eliminazione di una policy `RESTRICTIVE` amplia l'accesso. Una tabella non dichiarata in `backend/schema`, così come lo schema `rebase`, non vengono mai toccati
- Mantiene invariato ogni
  vincolo CHECK ed EXCLUDE presente su una tabella dichiarata. Poiché una tabella
  non può dichiarare nessuno dei due, si tratta di regole proprie del database, scritte a mano
  o importate da un database adottato tramite `schema introspect`; per rimuoverne uno, eliminalo
  manualmente (`ALTER TABLE … DROP CONSTRAINT …`). Nemmeno i trigger e le funzioni creati
  manualmente vengono modificati
- Verifica con corrispondenza esatta il
  nome di tutto ciò che lascia invariato, inclusi eventuali caratteri `.`, `[`, `]` o `*`
- Crea qualsiasi
  [indice su foreign key derivato da Rebase](/docs/backend/indexes#foreign-keys-are-indexed-for-you)
  che dovesse mancare in una tabella esistente **prima** della pianificazione, mediante
  `CREATE INDEX CONCURRENTLY`, in modo che le scritture sulla tabella possano continuare durante la compilazione;
  Atlas lo troverà quindi già presente. `--dry-run` elenca questi indici senza crearli
- Contrassegna (stamp) le
  policy applicate secondo la stessa modalità utilizzata all'avvio del server, in modo che il primo avvio successivo a un
  push le lasci invariate invece di ricrearle ciascuna da capo
- `--dry-run`
  elenca le modifiche alla row-level security che il push apporterebbe, sotto "Planned
  row-level security changes": le tabelle su cui viene attivata la RLS e ogni
  policy creata, sostituita o eliminata, determinate secondo le logiche
  interne del push. Riporta "No changes" solo quando né lo schema né
  la row-level security subiscono variazioni. Qualora il contrassegno di una policy non corrisponda
  alla sua regola, o sia assente (generata da `db migrate`, scritta a mano), il dry
  run la ricrea a partire dalla regola sotto un altro nome, all'interno di una transazione che
  viene poi annullata (rollback), e confronta quanto memorizzato da Postgres: se il risultato coincide,
  non viene conteggiata alcuna modifica. Di conseguenza, una regola reimportata come SQL da `schema introspect`
  non pianifica modifiche, così come le policy applicate da `db migrate`. Solo quelle per cui non è stato possibile
  eseguire il confronto (ad esempio, per il mancato ottenimento del lock sulla tabella entro due secondi)
  vengono elencate separatamente. Il push restituisce a video una singola riga con il conteggio delle modifiche
- Segnala se un'istanza di `rebase dev` è in esecuzione sullo stesso database: applicando le nuove tabelle e colonne al salvataggio, l'indicazione "No changes" può significare che sono già state applicate
- Mostra ciascuna
  istruzione applicata da Atlas una sola volta. Atlas si connette senza SSL a un database su questa
  macchina (`localhost`, `127.x`, `::1`) il cui URL non specifica alcun `sslmode`, come fa l'app,
  invece di fallire con `SSL is not enabled on the server`; un URL che
  specifica `sslmode`, o un altro host, viene gestito esattamente come fornito. Un'esecuzione di Atlas
  che fallisce prima della pianificazione non lascia residui del database `<db>_dev_diff`
- `--dry-run`
  non modifica alcun file di progetto: `src/schema.generated.ts` viene lasciato invariato,
  e le copie in `drizzle/*.sql` committate con una versione precedente vengono segnalate ma non
  eliminate. Solo l'input del piano viene salvato in `.rebase/sql/`, directory non tracciata nel controllo versione
- **Non** genera file di migrazione

**Tempi di esecuzione.** La quasi totalità del tempo di un push è dovuta al calcolo del piano
da parte di Atlas: crea lo schema desiderato in un database temporaneo e ne calcola il diff rispetto a quello reale;
questo costo computazionale cresce più velocemente del numero di tabelle — su un computer portatile con
carico ridotto, circa 0,25 s per piano con 11 tabelle, 0,9 s con 111 e 5,5 s con 411. Un push che
non apporta modifiche pianifica una sola volta; uno con modifiche pianifica due volte (il dry run
esaminato dal gate delle modifiche distruttive, poi l'applicazione effettiva). Pertanto, un push su uno schema di
400 o più tabelle richiede decine di secondi, e anche di più su una macchina lenta o sotto carico.
Tale tempo è richiesto da Atlas, non dal database: i passaggi circostanti — generazione dell'SQL,
lock RLS, ricerca, trigger, policy, ruoli — richiedono solo pochi secondi per quelle
dimensioni, su una singola connessione al database.

**I file generati durante l'operazione**, tutti salvati in `.rebase/sql/` nella
directory del backend. `db push` e `db generate` scrivono tutti e cinque i file a partire dalle tabelle a
ogni esecuzione, prima di leggerne alcuno, quindi una copia committata non verrebbe letta
da nulla. La directory include il proprio file `.gitignore` e non va mai committata.

| File | Contenuto |
|------|-----------|
| `schema.sql` | Tabelle, colonne, vincoli e indici — lo stato desiderato da Atlas e l'unico su cui calcola il diff |
| `policies.sql` | Le policy RLS generate dal blocco `rls` delle tabelle |
| `search.sql` | Funzioni di ricerca full-text e colonne generate, per le tabelle con un blocco `search` |
| `vector.sql` | Estensioni pgvector e indici ANN |
| `triggers.sql` | `rebase.set_updated_at()` e i trigger `BEFORE UPDATE` alla base di `.onUpdateNow()` |

Atlas gestisce solo il primo file e nient'altro, quindi `db push` e la procedura di verifica dello schema
all'avvio applicano autonomamente gli altri quattro. Un deployment **basato solo su migrazioni** — che
esegue `db migrate` e mai `db push` — deve integrare manualmente questi quattro file in una
migrazione; `db generate` lo segnala quando una modifica risulta invisibile ad Atlas.

In un progetto in cui questi file erano stati committati in `drizzle/` con una versione precedente,
tali copie vengono rimosse alla prima esecuzione e il comando indica ciascun file per consentirti di
committarne l'eliminazione. Vengono eliminati solo i file che iniziano con l'intestazione
del generatore. I file scritti manualmente vengono preservati, così come `drizzle/migrations/`.

:::note[Modificare una regola di sicurezza ne rinomina la policy]
Una regola priva di `name` esplicito viene compilata come `<table>_<op>_<hash>`, dove l'hash copre la semantica della regola — perciò *modificare* una regola (invece di aggiungerne una nuova) genera una policy con un nuovo nome lasciando invariata quella precedente.

In passato questo era un problema rilevante: Postgres valuta le policy `PERMISSIVE` in OR tra loro, quindi una policy obsoleta come `USING (rebase.uid() IS NOT NULL)` continuava a concedere l'accesso a tutto, indipendentemente da quanto restrittiva fosse la sua sostituta. Rendere una regola più severa non aveva effetto e il comando push segnalava l'esito positivo.

`db push` ora risolve questo disallineamento: elimina le policy generate che non corrispondono più ad alcuna regola e segnala — senza eliminarle — le policy con nomi personalizzati non descritte nelle tabelle, poiché indistinguibili da SQL scritto intenzionalmente a mano.

Per verificare un database su cui è stato eseguito un push prima di questa modifica, esegui `rebase doctor --policies`. Funziona come un gate di CI: termina con codice diverso da zero in caso di drift o qualora non sia stato possibile eseguire il controllo (assenza di `DATABASE_URL`, percorso `--schema-dir` non risolvibile, autorizzazione di lettura su `pg_policies` non concessa al ruolo di CI). Un gate che non è riuscito a verificare non viene considerato superato.

`doctor` e `db push` distinguono i due tipi di policy orfane. Una policy con nome generato è considerata obsoleta e il successivo push la eliminerà. Qualsiasi altro nome è stato scritto a mano o da un altro strumento ed è ancora attivo: descrivilo nel blocco `rls` della rispettiva tabella per mantenerlo (la vista RLS di Studio lo importa), oppure eliminalo con `rebase db push --prune-policies` se non è più necessario.
:::

:::caution
`db push` modifica direttamente il database. Usalo solo in fase di sviluppo. Per la produzione, usa `db generate` + `db migrate` per creare file di migrazione revisionabili.
:::

### `rebase db generate`

Genera file di migrazione SQL a partire dalle modifiche allo schema:

```bash
rebase db generate
```

**Cosa fa:**
- Confronta lo schema Drizzle con lo stato generato dalle migrazioni in `drizzle/migrations/`, non con il tuo database
- Produce file di migrazione SQL provvisti di timestamp in `backend/drizzle/migrations/`
- I file possono essere revisionati, modificati e tracciati nel controllo versione
- Segnala ogni
  istruzione nella nuova migrazione che comporta la distruzione di dati, utilizzando lo stesso controllo che `db push`
  esegue prima di applicare le modifiche: l'eliminazione (drop) di una tabella, colonna, schema, vista o tipo, un'operazione
  di `TRUNCATE`, la modifica del tipo di una colonna che può comportare la perdita di valori, una modifica alla chiave
  primaria o l'eliminazione di un vincolo CHECK o EXCLUDE presente nel database. Il
  file viene comunque generato e il comando esce con codice 0, avvisando senza bloccare l'operazione.
- Si conclude indicando i
  passaggi successivi: `rebase db migrate` e, per la prima migrazione del progetto, l'indicazione
  di `--baseline <version>` necessaria per un database già configurato dal boot. Una
  migrazione successiva non mostra il suggerimento della baseline, poiché impostare una baseline su una migrazione
  distruttiva salterebbe il relativo `DROP`; un'esecuzione che non genera alcuna migrazione si limita a indicarlo.

**Un vincolo CHECK aggiunto da una migrazione manuale viene eliminato da quella successiva.** `db generate`
confronta i file di migrazione, non il database, e Atlas non ha modo di escludere un
oggetto da questo diff. Di conseguenza, un vincolo CHECK o EXCLUDE inserito manualmente in una
migrazione, non dichiarabile in alcuna tabella, ricompare come
`ALTER TABLE … DROP CONSTRAINT …` nella successiva migrazione generata, accorpato
nella medesima istruzione della modifica effettiva. Il report segnala tale eliminazione
qualora il database contenga già il vincolo, ma non lo rimuove dal
file. Elimina la clausola prima di eseguire `rebase db migrate`, oppure consenti a
`rebase db migrate --refuse-destructive` di bloccarsi su di essa. `db push` legge il
database e mantiene il vincolo.

Le migrazioni generate sono semplici file SQL: puoi esaminarle e modificarle prima di applicarle.

### `rebase db migrate`

Esegue tutte le migrazioni in sospeso:

```bash
rebase db migrate
```

**Cosa fa:**
- Analizza `drizzle/migrations/` alla ricerca delle migrazioni non ancora applicate
- Le applica in ordine al database
- Traccia quali migrazioni sono state applicate
- Contrassegna (stamp) le
  policy di row-level security secondo la stessa modalità utilizzata da `db push` e dall'avvio del server, in
  modo che il primo avvio successivo alla migrazione non le modifichi invece di ricrearle ciascuna
  da zero. Poiché una migrazione è stata scritta in base alle tabelle del suo periodo, una policy viene
  contrassegnata solo se corrisponde esattamente a ciò che la sua regola produrrebbe ora: migrate la ricrea
  a partire dalla regola sotto un altro nome, all'interno di una transazione che viene poi annullata (rollback), e
  confronta quanto memorizzato da Postgres, come fa `db push --dry-run`. Una policy differente
  non riceve il contrassegno, e al successivo avvio la tabella verrà riapplicata

`--refuse-destructive`
forza invece il rifiuto dell'operazione. Esegue prima un dry run delle migrazioni in sospeso. Se un'istruzione
comporta la distruzione di dati, in base allo stesso controllo adoperato da `db push` e `db generate`,
elenca tali istruzioni ed esce con codice 1. Non applica nulla, nemmeno i file
precedenti a tale istruzione. Senza il flag, `db migrate` opera come di consueto e
applica ogni file in sospeso:

```bash
rebase db migrate --refuse-destructive
```

Una migrazione che ricostruisce una colonna di ricerca la elimina prima, pertanto questo flag rifiuterà
anche tale migrazione. Esamina l'elenco stampato, quindi esegui `rebase db migrate`
senza il flag per applicarla.

#### Baselining a database Rebase has already booted

Ogni avvio di Rebase assicura la conformità dello schema, e `rebase db push` lo applica direttamente. Di conseguenza, un database che abbia eseguito una di queste due operazioni possiede già le tabelle e i tipi che la prima migrazione andrebbe a creare. Su un database di questo tipo privo di cronologia delle migrazioni, `rebase db migrate` non esegue nulla: elenca le tabelle già presenti e il comando da eseguire, completato con la versione della migrazione più recente. Non registra autonomamente la baseline.

Non c'è alcun problema con la migrazione: il database è stato semplicemente predisposto con un altro metodo. Registra il punto in cui si trova attualmente, una sola volta; lo stesso comando eseguirà le migrazioni successive, e ogni `rebase db migrate` successivo funzionerà normalmente:

```bash
rebase db migrate --baseline 20260906101530
```

La versione corrisponde al prefisso numerico del file di migrazione che descrive lo stato *attuale* del database. Quella migrazione e tutte le precedenti vengono registrate come applicate; tutto ciò che segue viene eseguito. L'avvio non effettua mai drop o ridenominazioni: se una di queste migrazioni lo fa, imposta la baseline alla versione precedente. Su un database con cui non è mai stato effettuato un avvio, non è necessaria alcuna baseline: esegui direttamente la migrazione.

La stessa cosa può verificarsi successivamente nel normale ciclo di sviluppo: modificando una tabella mentre `rebase dev` è in esecuzione, l'avvio aggiunge la colonna prima che `rebase db generate` scriva la migrazione che la introduce, quindi `rebase db migrate` si arresta con `column … already exists (42701)`. Crea la baseline per quella migrazione allo stesso modo. `--baseline` funziona anche su un database che registra già le migrazioni: contrassegna tutto fino a quella versione come applicato tramite `atlas migrate set` e fornisce una conferma, oppure segnala che non c'è nulla da registrare se la cronologia include già quella versione. Una versione non presente in alcun file di `drizzle/migrations` viene rifiutata prima di eseguire qualsiasi operazione, elencando le versioni disponibili.

### `rebase db branch`

Branching del database per lo sviluppo parallelo:

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

Ogni branch è una copia completa del database creata tramite `CREATE DATABASE ... TEMPLATE`,
pertanto richiede un server PostgreSQL reale e occupa lo stesso spazio su disco dell'origine.

### `rebase doctor`

Rileva il disallineamento a tre vie (drift) tra le tue tabelle, lo schema Drizzle generato e il database PostgreSQL attivo:

```bash
rebase doctor
```

**Cosa controlla:**
- Tabelle ↔ Schema generato — sono sincronizzati?
- Schema generato ↔ Database — ci sono modifiche non applicate?
- Tabelle ↔ Database — c'è qualche disallineamento imprevisto?

Esegui `doctor` ogni volta che qualcosa sembra disallineato. Individua con precisione il punto in cui risiede la discrepanza.

Il confronto con il database include la verifica effettuata all'avvio prima di segnalare che `schema.generated.ts` e il database non concordano, eseguita mediante il medesimo codice. Di conseguenza, ogni discrepanza segnalata dall'avvio compare anche nel report, con gli stessi termini: una colonna NOT NULL da un lato e nullable dall'altro, o una colonna ancora presente nel database ma assente nel file (l'avvio non elimina mai nulla, quindi una proprietà rinominata lascia la vecchia colonna al suo posto). Ognuna di queste è un avviso, e la correzione suggerita indica `rebase db push`.

Il confronto con il database esamina il database del progetto, risolto nello stesso modo in cui lo risolve `rebase db url` — in uno scaffold appena creato, quello gestito, che `doctor` avvia. Quando non è possibile risolverne alcuno, questa fase viene segnalata come **saltata** (skipped) anziché superata, e l'esecuzione non si conclude mai con "All schemas are in sync": un controllo non eseguito non costituisce una conferma di corretta sincronizzazione.

Segnala inoltre ogni tabella priva di [blocco `search`](/docs/backend/search) contenente più di circa 10.000 righe. Una ricerca in tale tabella — tramite la casella di ricerca dell'admin, `.search()`, `?searchString=` — si traduce in un `ILIKE '%term%'` sulle colonne di testo, che nessun indice può ottimizzare; ciascuna ricerca scansiona quindi l'intera tabella e il relativo conteggio la scansiona nuovamente (circa un terzo di secondo per 100.000 righe, aumentando all'aumentare delle dimensioni della tabella). Il numero di righe è una stima interna di Postgres, quindi il controllo non esegue alcuna scansione dei dati. Si tratta di un suggerimento: non modifica il codice di uscita e non crea indici automaticamente.

Segnala inoltre le **tabelle di giunzione orfane** (orphaned junction): una tabella `public` strutturata come giunzione many-to-many che nessuna tabella dichiara. La struttura è costituita da due colonne che formano congiuntamente la chiave primaria, ciascuna foreign key verso una tabella dichiarata. Ridenominare o rimuovere una `manyToMany` lascia indietro la vecchia tabella di giunzione, poiché push e boot si limitano a creare tabelle, e ogni riga di associazione rimane presente al suo interno. La nota ha valore puramente informativo, pertanto non modifica il codice di uscita. La soluzione consiste nell'istruzione `DROP TABLE`, che `doctor` mostra ma non esegue mai.

### `rebase generate-sdk`

Genera un SDK tipizzato a partire dalle tue tabelle:

```bash
rebase generate-sdk
```

**Cosa fa:**
- Legge le tabelle esportate da `backend/schema/index.ts`, tramite il loader utilizzato all'avvio del backend, in modo che l'SDK descriva esattamente le tabelle fornite; uno schema che non compila interrompe l'esecuzione
- Genera i tipi TypeScript per ogni tabella in `generated/sdk/`
- Produce un file `database.types.ts` da utilizzare con `createRebaseClient<Database>()`: il tipo `Database`, `TableName` (l'unione di tutti gli slug) e `tablesDictionary` / `TablesDictionary`, la mappa da accessor a slug

`rebase dev` esegue questa operazione automaticamente all'avvio e a ogni salvataggio all'interno di
`backend/schema/`. Eseguilo manualmente in CI, in un repository privo di
tabelle proprie (vedi `--from` sotto), o in qualsiasi contesto in cui `rebase dev` non sia attivo.

**Opzioni:**

| Flag | Descrizione |
|------|-------------|
| `--schema-dir` | La directory dello schema (predefinita: `backend/schema`, oppure la chiave `tables` in `rebase.json`); i percorsi relativi vengono risolti a partire da dove viene eseguito il comando |
| `-o`, `--output` | Directory di output per l'SDK (predefinita: `generated/sdk/`) |
| `--from <link\|url>` | Legge lo schema da un progetto in esecuzione invece che dai sorgenti locali. `link` utilizza il progetto collegato a questo checkout. |
| `--token` | Bearer token per l'endpoint di contratto (predefinito: `$REBASE_SERVICE_KEY` dalla shell; il file `.env` non viene letto) |
| `--register` | Tipizza anche i dati lato server: scrive i tipi e una dichiarazione `Register` in `backend/generated/`, salvando l'impostazione in `rebase.json` — vedi [Dati tipizzati lato server](/docs/backend/typed-server-data/) |

`--from` consente a un repository che non contiene tabelle — un frontend
separato, una seconda web app, un'applicazione mobile — di generare un client tipizzato a partire dal
progetto con cui comunica: legge le `tables` dall'endpoint `/api/meta/contract` del backend
attivo. `REBASE_SERVICE_KEY` viene inviato solo al progetto a cui questo
checkout è collegato; passa esplicitamente `--token` per qualunque altro host. La chiave in
`.env` appartiene al backend locale e non viene mai inviata.
Un eventuale rifiuto segnala
quale situazione si è verificata: un `--token` rifiutato, una chiave della shell rifiutata, una chiave
non inviata a un host non collegato, una chiave presente solo in `.env` o nessuna chiave fornita.

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
(wire name) di un campo è la chiave della colonna, e l'API utilizza il formato camelCase in ogni punto:
l'introspezione scrive una colonna `created_at` come `createdAt: col.timestamp({ withTimezone: true })`, il cui nome SQL
è lo snake_case della chiave, e la restituisce come `row.createdAt`. La colonna
nel database rimane inalterata. L'*accessor* della tabella viene convertito nel nome di una proprietà
con la stessa modalità (`my-notes` → `client.data.myNotes`), che è ciò che `tablesDictionary`
rimappa allo slug.

### `rebase migrate`

`rebase migrate collections-to-tables [dir]` sposta `config/collections` in
`backend/schema` (un `defineTable` per collection, ogni colonna esplicita nella
sua posizione originaria secondo la sintassi Drizzle, e `index.ts` con
`defaultRls`) e `frontend/src/cms` (un `customizeTable` per ogni collection
personalizzata, i file `defineFirestoreCollection`, `ui-config.json`), scrive
`backend/resources.ts`, `backend/storage.ts` e `backend/generated/register.ts`,
aggiunge `rebaseBackendGuard()` al file `vite.config.ts` di uno scaffold, quindi esegue
`rebase migrate sdk-calls`, che riscrive `.collection(` in `.table(`, le
altre ridenominazioni dell'SDK e le origini delle regole `existsIn` / `membership` nel codice,
e sposta le importazioni dei nomi che la versione 0.31 ha trasferito in un altro pacchetto
([l'elenco](/docs/upgrading/0-30-to-0-31-imports/)), aggiungendo il pacchetto alle
dipendenze del modulo importatore ("Dependencies added": esegui `pnpm install`). Aggiorna tutti i pacchetti `@rebasepro` alla versione 0.31 prima di eseguirlo.
Ogni esecuzione rilegge il risultato finale: l'SQL generato — DDL, policy, search,
vector, trigger, viste, lo schema Drizzle — deve essere identico byte per byte, altrimenti ogni
file viene ripristinato allo stato precedente. Ciò che non è possibile migrare viene rifiutato indicando file e riga, e
ciò che viene delegato all'intervento manuale viene stampato sotto forma di passaggi numerati, terminando con
`rebase skills install` qualora il progetto contenga agent skills. I moduli personali in
`config/` vengono mantenuti; l'esecuzione stampa la riga di comando `git rm` per gli elementi sostituiti. Gestisce inoltre
le collection Firestore create da una funzione, gli alias di percorso, un pannello montato
al di fuori di `App.tsx` e tutte le app statiche non protette ([l'elenco completo](/docs/upgrading/0-30-to-0-31/#108-tables-in-backendschema-replace-configcollections--run-the-codemod-first)).
Dopo il comando `git rm`, `--check` segnala `already-migrated`.

| Flag | Effetto |
|---|---|
| `--dry-run` | Mostra file, rifiuti, note e passaggi manuali; non scrive nulla. Inizia da qui. |
| `--check` | Su un progetto migrato: verifica che `backend/schema` generi ancora lo stesso SQL. Esce con codice 1 mostrando il diff, o quando una regola cambia significato. |
| `--accept-rule-changes` | Con `--check`: conferma che le regole elencate in "Review before deploying" sono state revisionate. |
| `--json` / `--force` / `--skip-sdk-calls` | Il report in formato JSON (con `ruleChanges`); esecuzione su un albero di lavoro con modifiche o su output modificato; non tocca il codice. |

Esamina due elenchi nel suo output dell'SDK: **"Rewritten by name — review"** (ricevitori
non tipizzati, data slot, test double) e **"Left unchanged — check each"**
(rinomina quelli appartenenti all'SDK; [una ricerca](/docs/upgrading/0-30-to-0-31-by-hand/#sdk-calls-no-type-checker-sees) individua i rimanenti).

Il controllo SQL attesta la fedeltà della conversione, ma non che una regola mantenga
esattamente lo stesso significato precedente. L'ultima sezione dell'output, **"Review before deploying: these rules
change meaning"**, elenca tutte le regole la cui policy concede ora permessi differenti
— una semplice dicitura `access: "authenticated"` non concedeva nulla, mentre ora ammette qualsiasi
chiamante autenticato ([le quattro casistiche](/docs/upgrading/0-30-to-0-31/#review-before-deploying-these-rules-change-meaning)).
Procedi poi con la verifica rispetto al database: `rebase db push --dry-run` dovrebbe restituire "No
changes: the database already matches these tables.", e
`rebase doctor --policies` nessun drift.

## Flusso di lavoro per lo sviluppo

Il flusso di lavoro per un'iterazione rapida in sviluppo:

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
| La migrazione mostra modifiche inattese | Esegui `rebase doctor` per identificare il disallineamento (drift) |
| `db push` fallisce in produzione | Usa `db generate` + `db migrate` al suo posto |
| Una migrazione non deve eliminare dati in CI o in produzione | `rebase db migrate --refuse-destructive` esce con codice 1 e non applica nulla quando un'istruzione in sospeso distrugge dati |
| `db migrate` si arresta con "already has the tables your migrations create", oppure fallisce con `already exists (42710)` | Il boot o `db push` hanno già predisposto lo schema — registralo con il comando `rebase db migrate --baseline <version>` stampato a video |
| `db migrate` fallisce con `column … already exists (42701)` | `rebase dev` ha aggiunto la colonna all'avvio — crea la baseline per quella migrazione allo stesso modo |
| `db push` sul database gestito fallisce con `Error: EOF` | Atlas ha perso una connessione trattenuta da `rebase dev` in esecuzione. Eseguilo nuovamente; se continua a fallire, arresta prima `rebase dev` |

## Passaggi successivi

- **[Tables](/docs/schema/)** — Definisci il tuo modello dati
- **[CLI Reference](/docs/cli)** — Tutti i comandi della CLI
- **[Typed SDK](/docs/sdk)** — Utilizza l'SDK tipizzato
