---
sourceHash: 28ddba8b909b96aa
title: Generazione dello schema
sidebar_label: Generazione dello schema
description: Genera schemi Drizzle ORM dalle tabelle in backend/schema, crea migrazioni SQL, esegui l'introspezione di un database esistente in file defineTable e mantieni il tuo database sincronizzato con la Rebase CLI.
---

## Panoramica

Rebase utilizza una pipeline **schema-as-code** in cui le tabelle dichiarate con
`defineTable` in `backend/schema/` rappresentano l'unica fonte di verità. La CLI
le trasforma attraverso una pipeline deterministica:

```
Tables (backend/schema) → Drizzle Schema → SQL Migrations → PostgreSQL
```

Questa pagina tratta tutti i comandi della CLI coinvolti in questa pipeline.

## La Pipeline

### 1. Tabelle → Drizzle Schema

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

### 2. Schema dichiarato → Migrazioni

`db generate` produce l'SQL desiderato per Ptah dalle tabelle, policy,
funzioni, indici, trigger e viste dichiarati. Ptah lo confronta con le
migrazioni di `backend/drizzle/migrations/`, riprodotte in un database
temporaneo, e scrive una nuova migrazione. Rebase legge anche il database
di destinazione per proteggere gli oggetti che non gestisce. Una colonna già
aggiunta all'avvio o da `db push` resta nella migrazione, poiché il diff
parte dalla cronologia delle migrazioni.

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

Applica lo schema dichiarato direttamente al database:

```bash
rebase db push
rebase db push --dry-run
```

Rebase produce un unico SQL desiderato per tabelle, policy, funzioni, indici
di ricerca e vettoriali, trigger e viste. Ptah Compat pianifica e applica
questi oggetti insieme. Il piano è limitato alle dichiarazioni di Rebase.
Tabelle, viste, estensioni e funzioni esterne rimangono intatte. Sono protetti
anche policy, trigger, indici e vincoli CHECK ed EXCLUDE personalizzati su
una tabella dichiarata.

Il comando mostra il piano prima di applicarlo. Una modifica distruttiva,
incluso `DROP EXTENSION`, richiede una conferma o `--allow-destructive`.
`--dry-run` mostra il piano senza modificare il database né scrivere una
migrazione. Dopo che Ptah applica il piano, Rebase abilita RLS, prepara le tabelle di autenticazione e
i ruoli delle richieste e registra la versione dello schema. Gli indici
derivati dalle chiavi esterne mancanti vengono creati prima del piano.

Con PostgreSQL esterno, incluso un servizio Docker Compose locale, Ptah può
rieseguire SQL per `db push`, `db push --dry-run` e `db generate`. Usa
`PTAH_DEV_SERVER_DISPOSABLE=1` solo se puoi eliminare tutto il server di sviluppo.
Su un server condiviso, `PTAH_TRUST_REPLAY_SQL=1` autorizza l’esecuzione con i
privilegi della connessione di sviluppo. Attivalo solo se ti fidi di quel SQL.
PGlite gestito è già temporaneo. Vedi la
[configurazione](/docs/getting-started/configuration/).

`db push` e `db generate` aggiornano `.rebase/sql/` dallo schema corrente.
Git ignora questa directory.

| File | Scopo |
|------|-------|
| `schema.sql` | Stato desiderato degli oggetti dichiarati |
| `search.sql` | Ripristina le colonne di ricerca generate dopo un errore |
| `policies.sql`, `vector.sql`, `triggers.sql`, `views.sql` | Estratti del SQL generato |

La CLI rimuove le vecchie copie SQL generate da `drizzle/` e conserva `drizzle/migrations/`.

Includi `backend/drizzle/ptah-managed.json` in Git insieme alle migrazioni. Rebase
usa i nomi salvati per pianificare la rimozione delle dichiarazioni eliminate.

Una policy con nome generato da Rebase viene rimossa quando una nuova regola
la sostituisce. Una policy con nome personalizzato resta attiva. Usa
`rebase doctor --policies` per controllare la deriva. Per affidare una policy
personalizzata a Rebase, dichiarala nel `rls` della tabella.

:::caution
`db push` modifica direttamente il database. Usalo durante lo sviluppo.
Per la produzione, crea una migrazione verificabile con `db generate` e
applicala con `db migrate`.
:::

### `rebase db generate`

Crea una migrazione SQL con data e ora:

```bash
rebase db generate
```

Ptah confronta l'SQL desiderato con lo stato ricostruito dalle migrazioni
in `backend/drizzle/migrations/`. Il diff parte da questa cronologia, non
dal database attivo. Rebase legge comunque il database attivo per individuare
gli oggetti esterni. Una colonna già aggiunta all'avvio o da `db push`
compare quindi nella migrazione generata.

Il comando scrive la migrazione in `backend/drizzle/migrations/` e segnala le
operazioni distruttive. Un piano vuoto non produce una migrazione.

Per la prima migrazione, il comando mostra un esempio con `--baseline <version>`.
Verifica prima che il database corrisponda a quella versione.

Controlla ogni migrazione per individuare `DROP CONSTRAINT`. I vincoli CHECK ed
EXCLUDE manuali presenti solo nella cronologia rieseguita possono comparire nel
piano come rimozioni.

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
  confrontando l'output presente su Postgres esattamente. Una policy
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

Ciascun avvio di Rebase assicura la presenza dello schema, e `rebase db push` lo applica direttamente. Per questo motivo, un database sul quale sia stata eseguita una di queste procedure presenterà già le tabelle e i tipi previsti dalla prima migrazione, causando l'interruzione di `rebase db migrate` con l'errore `type "posts_status" already exists (42710)`.

La migrazione non presenta anomalie: il database è stato semplicemente predisposto tramite una procedura diversa. Registra lo stato attuale del database per poi proseguire con la normale procedura di migrazione:

```bash
rebase db migrate --baseline 20260906101530
rebase db migrate
```

La versione corrisponde al prefisso numerico del file di migrazione che rispecchia ciò che si trova *attualmente* all'interno del database. Tale migrazione e tutte quelle precedenti verranno registrate come già applicate; le successive verranno invece eseguite normalmente. Su un database vergine, non inizializzato da precedenti avvii, il baseline non è necessario: è possibile eseguire direttamente la migrazione.

Per una migrazione successiva, usa il baseline solo dopo aver applicato e
verificato ogni modifica in sospeso fino a quella versione, incluse le eliminazioni
e gli aggiornamenti dei dati. Una colonna già presente attesta una sola modifica.

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
changes: the database already matches the declared schema.", e
`rebase doctor --policies` non dovrebbe mostrare alcun disallineamento.

## Flusso di lavoro per lo sviluppo

Il flusso di lavoro per iterare rapidamente in fase di sviluppo:

```bash
# 1. Modifica una tabella in backend/schema/
# 2. Genera lo schema Drizzle
rebase schema generate

# 3. Esegui il push diretto al database di sviluppo
rebase db push
```

## Flusso di lavoro per la produzione

Il flusso di lavoro sicuro e tracciabile consigliato per la produzione:

```bash
# 1. Modifica una tabella in backend/schema/
# 2. Genera lo schema Drizzle
rebase schema generate

# 3. Genera i file di migrazione SQL
rebase db generate

# 4. Esamina il codice SQL generato in backend/drizzle/migrations/
# 5. Esegui il commit della migrazione nel version control
git add backend/drizzle/migrations/ backend/drizzle/ptah-managed.json

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
| `db migrate` fallisce con `already exists (42710)` | Verifica tutte le modifiche fino a quella versione, incluse le eliminazioni e le modifiche ai dati, prima di impostare il baseline. |
| `db migrate` fallisce con `column … already exists (42701)` | Verifica tutte le modifiche fino a quella versione, incluse le eliminazioni e le modifiche ai dati, prima di impostare il baseline. |

## Passaggi successivi

- **[Tabelle](/docs/schema/)** — Definisci il tuo modello dati
- **[Riferimento CLI](/docs/cli)** — Tutti i comandi della CLI
- **[SDK tipizzato](/docs/sdk)** — Utilizza l'SDK generato
