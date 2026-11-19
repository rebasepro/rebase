---
sourceHash: 0dca906999fefc66
title: Riferimento CLI
sidebar_label: CLI
description: Comandi della CLI di Rebase per l'inizializzazione del progetto, la generazione dello schema, le migrazioni del database e la generazione dell'SDK.
---

## Panoramica

La CLI di Rebase (`rebase`) gestisce il tuo progetto dallo scaffolding al deployment.

## Installazione

```bash
pnpm add -g @rebasepro/cli
```

Oppure esegui qualsiasi comando senza installarlo: `pnpm dlx @rebasepro/cli <command>`.

## Output leggibile da macchina

`--json` è il flag principale e, al di fuori della famiglia `cloud`, è l'unico: `rebase status`, `rebase resources`, `rebase apps list`, `rebase upgrade` e `rebase verify` inviano quindi un singolo valore JSON su stdout — il risultato, oppure un envelope `{"error": {"message", "code", "hint", "issues"}}` con un codice di uscita diverso da zero — a **ogni** uscita del comando, consentendo al chiamante di analizzare stdout incondizionatamente. Senza di esso, scrivono testo leggibile dall'uomo e gli errori finiscono su stderr. `rebase cloud` utilizza lo stesso envelope ed è l'unica eccezione al flag: attiva automaticamente il JSON anche quando stdout non è un TTY o quando `REBASE_JSON=1` è impostato. Pertanto `rebase cloud status | cat` è in formato JSON mentre `rebase status | cat` non lo è: all'interno di uno script, passa esplicitamente `--json` invece di affidarti a una di queste regole.

## Comandi

### `rebase init`

Inizializza un nuovo progetto Rebase:

```bash
rebase init [directory]
```

Configura una directory `backend/` (le tabelle in `backend/schema/`) e una `frontend/` (il pannello di amministrazione, con le personalizzazioni delle tabelle in `frontend/src/cms/`); `--headless` esegue lo scaffolding del solo `backend/`, senza `backend/schema/`. [Project structure](/docs/getting-started/project-structure/) mostra entrambi gli alberi.

| Flag | Descrizione |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` o `blank`. Predefinito `blog` |
| `--headless` | Solo backend — nessun pannello di amministrazione e nessun `backend/schema/`: il server serve le tabelle native del database. `--template` non ha effetto, poiché non ci sono tabelle da popolare con seed |
| `-y, --yes` | Non richiede mai conferme. **Obbligatorio ovunque non ci sia un terminale per rispondere**, come in CI. Salta git init e l'installazione delle dipendenze — le opzioni predefinite interattive prevedono "sì" per entrambi, quindi passa `--git` / `--install` se desideri includerli |
| `-i, --install` | Installa le dipendenze dopo lo scaffolding. Senza di esso, init lo chiede (predefinito sì); con `--yes`, non viene installato nulla |
| `--no-install` | Non installa nulla e non chiede conferma |
| `-g, --git` | Inizializza un repository ed esegue il primo commit. Senza di esso, init lo chiede (predefinito sì); con `--yes`, nessun repository |
| `--database-url <url>` | Usa un database esistente invece di quello gestito. Deve essere un URL `postgres://` o `postgresql://`: qualsiasi altra cosa viene rifiutata prima che venga scritto un file e il prompt interattivo lo richiederà nuovamente |
| `--introspect` | Genera `backend/schema` da quel database. Implica `--template blank` e richiede `--install` |
| `--project <slug>` | Collega lo scaffold a un progetto Rebase Cloud |
| `--setup-key <key>` | La chiave monouso per autenticare tale collegamento |
| `-a, --agent <name>` | Configura gli agenti di coding IA: le [skill](/docs/ai/skills) e il [server MCP](/docs/ai/mcp). Ripetibile o separato da virgole — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` o `all`. Senza questo flag, `init` chiede e seleziona preventivamente gli agenti installati sulla macchina; con `--yes`, nessuno |

### `rebase dev`

Avvia il server di sviluppo:

```bash
rebase dev
```

Avvia sia il frontend che il backend con hot reloading e rigenera lo schema Drizzle e i tipi dell'SDK (`generated/sdk/`) all'avvio e a ogni salvataggio all'interno di `backend/schema/`.

Entrambe le porte sono ricavate dal percorso del progetto, in modo che più progetti Rebase possano essere eseguiti fianco a fianco. Usa gli URL stampati da `rebase dev`. Fissane una con `rebase dev --port 3001`.

Un'app statica in `rebase.json` senza passaggio di compilazione (nessun `build`, e `output` corrisponde alla sua `root`, come un normale sito HTML) viene servita dal backend da quella directory, al suo `path`, così come `rebase start` la serve dal bundle, e `FRONTEND_URL` viene impostato su di essa (sulla porta del backend) in modo che i link inviati via email puntino lì. Un'app con un passaggio di build viene eseguita in Vite sulla propria porta e `FRONTEND_URL` è quello di Vite.

Una modifica a `.env` riavvia il backend, che rilegge il file, così come fa il pannello di amministrazione. Ciò che `rebase dev` imposta autonomamente viene mantenuto fino al riavvio: `PORT` e `DATABASE_URL` quando si trova sul database gestito o su Docker.

Con `--database-url`, `rebase dev` verifica prima che qualcosa risponda a quell'host e porta. In caso contrario, lo segnala specificando il flag ed esce con codice `1` senza avviare nulla; inoltre non tocca i nomi relativi al database in `.env`, senza mai avviare il relativo container compose.

### `rebase build`

Compila il progetto in un bundle distribuibile in `dist-bundle/`:

```bash
rebase build
```

Il bundle è l'artefatto che distribuisci — l'immagine di runtime lo carica, quindi non c'è alcuna immagine applicativa da compilare manualmente. Flag utili:

| Flag | Effetto |
|------|--------|
| `--output <dir>` (or `--out`) | Scrive il bundle in una posizione diversa da `dist-bundle/` (un'app alla volta) |
| `--vendor` | Installa e include sempre le dipendenze del bundle |
| `--no-vendor` | Non include mai le dipendenze (no vendor); il pod le installa a ogni avvio |
| `--skip-type-check` | Salta il controllo dei tipi (più veloce, meno sicuro) |
| `--no-static` | Non include il frontend nel bundle del backend (ogni app statica ottiene comunque il proprio bundle) |
| `--skip-static-build` | Include il frontend così come è già stato compilato, senza eseguire il suo comando di build |

Un frontend — ogni app statica di `rebase.json` con una configurazione Vite — la cui configurazione non utilizza `rebaseBackendGuard()` (da `@rebasepro/app/vitePlugin`) viene rifiutato: è ciò che impedisce al codice del server di finire nel bundle del browser e impedisce a Vite di includere inline un file del backend come URL `data:` (interrompe la build con errore, menzionando se stesso, quando un altro plugin sostituisce il suo `build.assetsInlineLimit`). `frontend/src/cms/ui-config.json` viene trasferito nel bundle come `entry.uiConfig`, la presentazione del workspace servita da un backend distribuito.

Le dipendenze sono incluse (vendored) per impostazione predefinita, in modo che una nuova istanza non debba attendere un'installazione di 35–55 secondi. Un albero che supera i 2 GB su disco viene invece scartato, poiché il limite di caricamento è di 1 GB compresso.

Ogni app statica inclusa nel bundle riceve una copia brotli (`.br`) e gzip (`.gz`) accanto a ogni risorsa con hash del contenuto di 1 KB o più — i file che un browser memorizza nella cache per un anno. Il runtime invia quella accettata dal browser, in modo che tali file non richiedano lavoro di compressione per richiesta, inclusa la prima visita dopo un deploy, e i browser che accettano brotli la ricevono (circa l'11% più piccola rispetto a gzip sul JavaScript dell'admin). L'output di compilazione originale del tuo frontend rimane invariato; cambia solo la copia all'interno del bundle. Nell'app di esempio questo aggiunge meno di un secondo alla compilazione e circa 2,4 MB al bundle.

### `rebase upgrade`

Aggiorna ogni pacchetto `@rebasepro/*` vincolato nel progetto a un'unica release, quindi installa con il gestore di pacchetti indicato dal relativo file di blocco (lockfile). `rebase upgrade` adotta l'ultima versione (`latest`); `--to 0.21.0` una versione esatta, senza consultare il registro; `--to canary` un dist-tag. Ogni vincolo in `dependencies`, `devDependencies` e `optionalDependencies`, in ciascun `package.json` del progetto, mantiene il proprio `^` o `~` e nient'altro nel file viene modificato. `peerDependencies` e le specifiche `workspace:`, `link:`, `file:`, git e tag vengono elencate e lasciate invariate. Anche gli override in `pnpm-workspace.yaml` e `package.json` vengono aggiornati, ma un override `link:` o `file:` prevale su ogni vincolo: viene segnalato e `--drop-local-overrides` lo rimuove. `--dry-run` non scrive nulla, `--no-install` salta l'installazione e `--json` stampa un singolo documento.

Un progetto basato su una versione prerelease, come una canary, rimane sul suo canale a meno che `latest` non sia più recente. Un dist-tag che sposterebbe un vincolo a una versione precedente viene rifiutato (`downgrade_refused` con `--json`), a meno che non si passi `--allow-downgrade`; una versione esatta indicata con `--to` viene applicata e contrassegnata come downgrade. Un'esecuzione `--dry-run` di un upgrade che la vera esecuzione rifiuterebbe mostra cosa verrebbe aggiornato ed esce con codice 0, e con `--json` il documento riporta il rifiuto come `wouldRefuse` (`{ code, message, hint }`).

#### Aggiornare un progetto PostgreSQL a Rebase 0.35

Esegui la CLI di Rebase 0.35 dalla radice del progetto su Linux, macOS o Windows.
Sostituisce `@ariga/atlas` con `@stokaro/ptah-compat` nel backend PostgreSQL.
Mantiene i file di migrazione, `atlas.sum` e le revisioni registrate.

```bash
pnpm dlx @rebasepro/cli@0.35.0 upgrade --to 0.35.0 # version-pin: ignore
```

### `rebase start`

Esegui il bundle compilato esattamente come lo esegue un deployment:

```bash
rebase start
```

Legge `PORT` e il resto di `.env`, a differenza di `rebase dev`, nel `NODE_ENV` impostato. Un file `.env` generato dallo scaffolding specifica `development`, quindi il primo account registrato diventa comunque l'amministratore, e `rebase start` lo segnala all'inizio; imposta `NODE_ENV=production` per un server di produzione. `rebase start --bundle ./dist-bundle` esegue un bundle posizionato altrove.

`rebase start` non avvia alcun database e il file `.env` generato dallo scaffolding non contiene `DATABASE_URL`, quindi un'esecuzione locale sul database utilizzato da `rebase dev` è `DATABASE_URL="$(rebase db url)" rebase start`. In assenza di un URL, stampa tale riga prima dell'avvio.

### `rebase apps list`

Mostra le app dichiarate da questo repository:

```bash
rebase apps list
```

Un repository può dichiarare più di un'app distribuibile — ad esempio un backend e un sito di marketing. In questo modo puoi verificare su cosa agiranno `rebase build` e il deployment.

### `rebase eject`

Prendi il controllo completo del processo del server e della sua immagine:

```bash
rebase eject
```

Scrive l'entrypoint del backend e un `Dockerfile` nel progetto e converte il backend, in modo che il repository compili la propria immagine invece di eseguire il runtime pubblicato. Da quel momento in poi, **gli aggiornamenti del runtime della piattaforma non avranno più effetto su di esso**, e la configurazione di CORS, autenticazione, storage e arresto (shutdown) sarà interamente a tuo carico.

Visualizzane un'anteprima con `rebase eject --dry-run`, che elenca le modifiche senza applicarne alcuna. `--force` sostituisce un eventuale `backend/src/index.ts` o `env.ts` esistente, conservando il file corrente come `<name>.bak`.

Il server dopo l'eject mantiene i caricamenti locali nella cartella `uploads/` del progetto, sia eseguito da sorgente che compilato, esattamente come fa `rebase dev`. Viene eseguito in `backend/`, quindi un eventuale `STORAGE_PATH` relativo viene letto da `backend/`.

### `rebase schema generate` / `rebase schema stale`

```bash
rebase schema generate       # backend/schema → backend/src/schema.generated.ts
rebase schema stale          # name what differs from the tables, exit 1 if anything does
rebase schema stale --fix    # regenerate the file instead
```

Ogni comando che legge lo schema accetta `--schema-dir <dir>` per un progetto che lo conserva altrove; `--collections` è stato rimosso. `rebase dev` mantiene il file aggiornato, quindi `stale` è il controllo ideale per una build o per la CI. Consulta [Schema Generation](/docs/cli/schema/).

### `rebase db`

```bash
rebase db push                 # apply the tables to the database (development)
rebase db generate             # write a SQL migration file
rebase db migrate              # apply the pending migrations
rebase db url                  # print the connection string this project uses
rebase db pull --from <url>    # copy another database into the local one
rebase db backup               # pg_dump; db backups list and db restore beside it
rebase db branch create <name> # a copy to work on; switch, list and prune it too
rebase db stop                 # stop the managed development database
rebase db reset                # delete it and start over
rebase db request-role migrate --to <role> # move requests to another Postgres role
rebase db provision --print    # the SQL that sets up the request role, for a DBA
```

Ognuno di essi è descritto in [Database Commands](/docs/cli/database/), insieme all'ordine con cui un comando sceglie il proprio database; `push`, `generate` e `migrate` sono trattati in dettaglio in [Schema Generation](/docs/cli/schema/).

### `rebase console`

Una REPL di Node con i dati del progetto accessibili, oppure un singolo snippet eseguito con `-e`:

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) e `tables` (le tabelle del progetto, caricate da `backend/schema`) sono nello scope, e l'`await` di primo livello (top-level await) è supportato. Il database viene risolto nello stesso modo in cui lo risolve `rebase db push`, e l'apertura della console non vi apporta alcuna modifica. Con `-e`, il risultato atteso viene stampato come JSON su stdout e un'eccezione non gestita (throw) termina con codice `1`. Flag: `--eval`/`-e`, `--schema-dir`, `--database-url`, `--docker`. Consulta [Scripts and the Console](/docs/backend/scripts/).

### `rebase migrate`

Migrazioni irreversibili da una struttura che questa release non supporta più: `rebase migrate collections-to-tables` (`config/collections` → `backend/schema` e `frontend/src/cms`) e `rebase migrate sdk-calls` (`data.collection("x")` → `data.table("x")` nel tuo codice). I relativi flag, ciò che scrivono e la sezione "Review before deploying" sono disponibili in [Schema Generation](/docs/cli/schema/#rebase-migrate).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init             # write a rebase.json inferred from this project
rebase apps config <app>     # the client configuration for one app
```

`apps init` non accetta alcun nome: deduce ogni app dal progetto e scrive l'intero `rebase.json`, rifiutandosi di sostituirne uno esistente a meno che non venga passato `--force`.

Un argomento con il nome viene rifiutato. `--force` mantiene ciò che l'inferenza non può ricavare dal file sostituito: il nome di ciascuna app, il suo `path` e la sua route `cms`. Tutto il resto viene dedotto nuovamente, e un'app dichiarata che non viene più trovata viene indicata come rimossa; pertanto, su uno scaffold riscrive il `rebase.json` originale dello scaffold. Il comando di build dell'app statica utilizza il gestore di pacchetti del progetto.

Per una copia di lavoro locale (checkout) non collegata a un progetto Cloud, `apps config` segnala che non è collegata, indipendentemente dal fatto che `rebase dev` sia in esecuzione o meno, e fornisce l'URL del backend come viene servito da `rebase dev`.

### `rebase status`

Tutto ciò che questo progetto dichiara e se l'ambiente lo associa effettivamente:

```bash
rebase status               # every resource, and the variables it reads
rebase status --json        # machine-readable
```

```
  backend  ·  managed  Rebase's runtime boots your bundle
  declared in  backend/resources.ts
  configured by  .env

  buckets
  ✓ media  s3 · account:minio
      ✓ S3_BUCKET__MEDIA
      ✓ S3_ACCESS_KEY_ID__MINIO (shared, for S3_ACCESS_KEY_ID__MEDIA)
  ○ exports  s3
      · S3_BUCKET__EXPORTS not set
      └ declared, not configured — uploads here answer 501 STORAGE_SOURCE_NOT_CONFIGURED
```

Tre file determinano ciò a cui un backend può accedere, e questo comando li visualizza tutti e tre insieme: `rebase.json` indica dove si trova il tuo codice e chi esegue il server, `backend/resources.ts` descrive ciò di cui il progetto ha bisogno e l'ambiente definisce come raggiungere ciascun elemento. Tutto il resto — `rebase.resources.json`, il manifest del bundle — viene generato a partire dal secondo per i lettori che non possono eseguire il tuo codice, e non deve mai essere scritto a mano.

Un `○` rappresenta lo stato utile da conoscere prima di un deploy piuttosto che dopo: dichiarato, ma non configurato. Una `✗` indica che l'ambiente imposta qualcosa in modo *errato*, impedendo l'avvio anziché funzionare in modalità degradata.

Un file `rebase.resources.json` che non corrisponde più alle dichiarazioni riceve una riga `○`. Uno che non è ancora stato scritto non la riceve: `rebase build` lo scrive a ogni build, quindi un progetto che non è mai stato compilato, come uno scaffold appena creato, non ha nulla da correggere.

### `rebase resources`

Ciò di cui questo progetto dichiara di aver bisogno — i database, i bucket, i topic e le code richiesti da `backend/resources.ts`, nonché i cron e le funzioni definiti dai suoi file:

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` è il flag utilizzato da un job di CI per fallire in presenza di un `rebase.resources.json` che non corrisponde più a `backend/resources.ts`. `--json` si combina con esso: in caso di disallineamento (drift), `rebase resources --check --json` termina con codice 1 con un envelope di errore (`resource_graph_missing` o `resource_graph_stale`), mentre in caso di successo il grafo riporta `check.status`. `--write --json` scrive il file e segnala `written.changed`.

Una risorsa viene dichiarata in `backend/resources.ts` — `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` — oppure corrisponde a un file in `backend/crons` o `backend/functions`, e non va mai scritta a mano in `rebase.resources.json`, che viene generato da tali dichiarazioni affinché un host possa leggere ciò di cui il progetto necessita senza doverlo compilare. Ogni voce registra chi la utilizza (`table:events`, `column:posts.cover`, `function:report`).

Un backend dispone anche di un database predefinito e di una sorgente di storage predefinita che nessuno dichiara. Entrambi sono elencati qui, contrassegnati come `implicit`, e nessuno dei due viene scritto in `rebase.resources.json` — l'host li fornisce automaticamente, quindi registrarli richiederebbe il provisioning di qualcosa che nessuno ha esplicitamente richiesto. Dichiararne uno con un nome specifico, come `bucket("media")`, leaves the default where it is, so both are listed. Only declaring the default itself, or marking one bucket `default: true`, replaces it.

Per visualizzare ciò che la piattaforma contiene per un progetto rispetto a quanto dichiarato dal suo codice, e per rimuovere un database fornito che il codice non menziona più, consulta [`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` — ogni comando per Rebase Cloud: autenticazione, collegamento del progetto, deploy, configurazione, database, risorse, compute e altro ancora — ha una [pagina dedicata](/docs/cli/cloud).

### `rebase generate-sdk`

```bash
rebase generate-sdk
```

Scrive un client tipizzato per le tabelle esportate da `backend/schema/index.ts` in `generated/sdk/`, con `TableName` e `tablesDictionary`; `--from <link|url>` legge invece il contratto di un backend in esecuzione. `--register` tipizza anche i dati lato server: scrive i tipi e la dichiarazione `Register` in `backend/generated/` e li memorizza in `rebase.json` (`registerDatabase`). Consulta [Typed server-side data](/docs/backend/typed-server-data) e [Schema Generation](/docs/cli/schema/#rebase-generate-sdk).

### `rebase doctor`

```bash
rebase doctor
```

Il comando da eseguire quando qualcosa non funziona e non sai ancora cosa sia. Si limita a segnalare senza mai modificare nulla, quindi è sicuro da eseguire su qualsiasi database raggiungibile.

**Senza un database.** Questi controlli vengono eseguiti per primi, poiché tutto ciò che impedisce a un progetto di funzionare del tutto si verifica prima ancora che una tabella possa essere confrontata:

| Controllo | Motivo |
| --- | --- |
| Versione di Node | Rispetto all'intervallo dichiarato dalla CLI. Una versione troppo vecchia non viene segnalata come "Node non supportato", bensì come un errore di sintassi all'interno di una dipendenza. |
| Gestori di pacchetti | Due file di blocco (lockfile) in un unico progetto. `npm install` in un workspace pnpm riscrive `node_modules` con una struttura incompatibile con pnpm, e il sintomo si manifesterà ore dopo con `Cannot find module`. |
| Slug duplicati | Due tabelle che dichiarano lo stesso slug. Lo schema rifiuta di compilare a causa di questo e il controllo le segnala entrambe. |
| Validità di `.env` | Un `JWT_SECRET` più corto di 32 caratteri (con cui l'ambiente di produzione rifiuta l'avvio) e `NODE_ENV=production` senza né `CORS_ORIGINS` né `FRONTEND_URL`. I valori non vengono mai stampati. |
| Discrepanza di versione `@rebasepro/*` | Lo stesso pacchetto vincolato a versioni differenti nei vari file `package.json` del progetto. Due copie causano il malfunzionamento di `instanceof` tra loro, fallendo come type guard che rigetta il proprio stesso tipo. |
| Stringhe di connessione | Un `=` non codificato in un parametro dell'URL, che gli strumenti nativi di PostgreSQL si rifiutano di analizzare — provocando il blocco dei backup e di `psql` mentre l'app continua a funzionare. |
| Funzioni personalizzate | Ciò di cui ciascuna funzione ha bisogno dal proprio host e quali di esse non verrebbero eseguite su un runtime edge. |

**Sul database** — quello del progetto, risolto nello stesso modo in cui lo risolve `rebase db url`, quindi su uno scaffold appena creato corrisponde al database gestito, che `doctor` avvia:

| Controllo | Motivo |
| --- | --- |
| Tabelle → schema generato | Verifica se `schema.generated.ts` non è aggiornato (stale). |
| Tabelle → database | Tabelle, colonne, enum, chiavi esterne e tabelle di giunzione mancanti. |
| Estensioni richieste | Una colonna `col.vector()` richiede pgvector, che Rebase installa solo se dichiarato dal progetto. |
| Schema stamp | Verifica se questo database è stato sottoposto a provisioning a partire da queste tabelle. È un hash, quindi può indicare che i due non corrispondono, ma mai quale dei due sia più recente. Uno stamp `v1:` proveniente da un runtime precedente alla versione 0.31 viene segnalato una volta, insieme al comando per riapplicare il timbro: `rebase db push`. |
| Tabelle → tipi SDK | Verifica se l'SDK tipizzato generato non è aggiornato (stale). |
| Policy RLS | Verifica se le policy del database corrispondono a `rls` dichiarato e se qualche policy menziona un ruolo che questo server non può utilizzare. |

Se il database non è raggiungibile, le relative fasi vengono contrassegnate come saltate con la motivazione e il resto viene comunque eseguito — consulta [Troubleshooting](/docs/troubleshooting/).

Termina con codice diverso da zero quando un controllo rileva un errore o quando una fase non è stata eseguita perché il database specificato rifiuta le connessioni. Una fase saltata perché non è stato possibile risolvere alcun database non è considerata un errore.

`rebase doctor --policies` esegue solo i controlli RLS — nessun diff dello schema, nessun tipo SDK — e fallisce in modo restrittivo (fail-closed), rendendolo il formato ideale da usare come gate di CI su un database distribuito.

`rebase doctor --database` esegue solo il preflight del database: verifica se il ruolo con cui vengono eseguite le richieste autenticate esiste, è limitato e può essere assunto, quali altri account di accesso possono passare ad esso, se ogni ruolo può connettersi e quali tabelle, permessi (grants) e policy Rebase condividerebbe con altri ruoli. Ogni risultato indica l'istruzione SQL da eseguire come amministratore, l'impostazione `rls` che adatta invece Rebase al database, o entrambi. Legge il catalogo e non modifica nulla, terminando con codice 1 se un risultato costituisce un fallimento. Funziona anche su un progetto headless. Consulta [Running on an existing or shared database](/docs/deployment/existing-database/).

### `rebase verify`

```bash
rebase verify
rebase verify --json
rebase verify --live
rebase verify --live --database-url postgresql://…
```

Verifica se le tabelle sono pronte per la distribuzione (safe to ship), in un unico comando veloce pensato per la CI e per gli hook degli agenti IA. È offline per impostazione predefinita e non modifica mai nulla.

| Passaggio | Cosa ne determina il fallimento |
| --- | --- |
| Definizioni delle tabelle (`schema`) | `backend/schema` non si carica o non compila tramite il loader da cui si avvia il backend: una relazione verso una tabella non esportata dall'index, `rls: "inherit"` senza `defaultRls`, una tabella priva di chiave primaria — una segnalazione per ciascun problema. Anche una tabella senza `rls` è tra questi. |
| Copertura RLS (`rls`) | Una tabella con una colonna `user_id`, `owner_id`, `organization_id` o `tenant_id` le cui regole — proprie o derivate dal `defaultRls` ereditato — consentono a un ruolo di leggere ogni riga indipendentemente da essa. È un warning. `rls-policy-recursion`: una regola che legge la propria stessa tabella in una sottoquery, oppure due tabelle le cui regole si leggono a vicenda, situazione che Postgres rifiuta di espandere, provocando il fallimento di ogni istruzione protetta con `42P17 infinite recursion detected in policy`; la segnalazione indica la tabella letta e la soluzione, ovvero spostare la lettura in una funzione `SECURITY DEFINER`. È un errore, oppure un warning quando il loop non è certo. |
| Aggiornamento delle migrazioni (`migrations`) | Una tabella o colonna dichiarata nelle tabelle che nessun file in `backend/drizzle/migrations` crea, oppure una eliminata che una migrazione crea ancora. Saltato per un progetto senza migrazioni. |
| Personalizzazioni CMS (`cms`) | Una chiamata a `customizeTable(...)` in `frontend/src/cms` (o in `src/cms` di un'app statica in `rebase.json`) che non corrisponde alle tabelle, letta staticamente — i moduli non vengono eseguiti. `cms-unknown-table`: lo slug non corrisponde ad alcuna tabella, quindi il pannello la ignora (viene suggerito lo slug più vicino). `cms-unknown-field`: una chiave in `fields` non è né una colonna né una relazione (il nome SQL di una colonna viene riscontrato con la sua chiave). `cms-hidden-required`: un campo escluso dal modulo (`hiddenInForm`, `readOnly`, `disabled`) la cui colonna è `NOT NULL` senza valore predefinito e senza nulla che il server compili, per cui la creazione di un record dal pannello fallisce sempre; è un warning quando un hook `beforeSave` o una trasformazione potrebbe compilarlo, ed è silenziato da `filledByServer`. `cms-duplicate-customization`: uno stesso slug personalizzato due volte. `cms-not-static` (warning): una chiamata il cui slug, le cui opzioni o i cui `fields` non sono valori letterali o una costante (`const`) nello stesso file, per cui nessun elemento al suo interno è stato verificato. `cms-ui-config-not-mounted` (warning): `frontend/src/cms/ui-config.json` esiste ma non viene fornito a `<RebaseCMS>` come `uiConfig`. `cms-backend-guard-missing`: la configurazione Vite del frontend non usa `rebaseBackendGuard()`, pertanto `rebase build` lo rifiuterebbe. Un progetto headless non ha `frontend/src/cms` e salta questo passaggio. |
| Audit RLS live (`live`) | Con `--live`: il catalogo di [`rls-check`](/docs/rls-check) rispetto al database del progetto e la verifica che ogni migrazione sia stata applicata. Il database viene risolto come fanno i comandi `db` — `--database-url`, `DATABASE_URL`, `--docker`, altrimenti il database di sviluppo gestito. Un database non configurato o che non risponde costituisce un errore, non un passaggio saltato: l'audit è stato esplicitamente richiesto. Una policy di lettura `USING (true)` compilata da una regola `access: "public"` è un warning finché l'API richiede un token (`AUTH_REQUIRE`, attivo per impostazione predefinita) — ogni utente autenticato può leggere ogni riga — e un errore con `AUTH_REQUIRE=false`, in cui le righe risultano accessibili in modo anonimo. |

`--json` stampa un singolo oggetto, `{ ok, schemaDir, steps, findings, summary }`: ogni passaggio è `{ id, title, status, detail? }` (`status` è `passed`, `failed`, `warnings` o `skipped`) e ciascuna segnalazione (finding) include `step`, `check` (un tipo kebab-case stabile), `severity`, `message` e, ove applicabili, `fix`, `table`, `file`, `line` e il percorso puntato `path` nella tabella (`posts.rls[0]`) — consentendo a un agente di riparare ciò che ha corrotto. `summary` conta `errors` e `warnings`. `--quiet` non stampa nulla se tutti i controlli vengono superati. Termina con codice diverso da zero in caso di errore; i warning non determinano il fallimento.

Un progetto generato tramite scaffold lo esegue per Claude Code dopo ogni modifica all'interno di `backend/schema/`: consulta [`rebase skills install`](#rebase-skills-install).

### Comandi per un'app in esecuzione

`rebase api`, `rebase data`, `rebase users`, `rebase cron`, `rebase logs`, `rebase functions`, `rebase rls simulate`, `rebase auth login` e `rebase storage ls|cp|rm|url|stat` operano su un'app in esecuzione tramite la sua API: l'istanza locale `rebase dev`, un server specificato con `--url` o un progetto Rebase Cloud specificato con `--project`. Consulta [A running app](/docs/cli/project/).

### `rebase auth`

Comandi per la gestione dell'autenticazione:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gestisci le chiavi API di servizio del progetto — le credenziali utilizzate da un agente, da uno script o da un altro servizio, a differenza della sessione di un utente finale:

```bash
rebase api-keys list
rebase api-keys get abc123-def456
rebase api-keys create --name "Blog CI" --scopes data:read:posts,data:write:posts --expires-in 90
rebase api-keys create --name "Ops" --full-access --roles admin --expires-at 2027-01-31
rebase api-keys revoke abc123-def456
```

`--scopes` indica cosa può fare la chiave, specificato come elenco separato da virgole o ripetuto; `--full-access` le assegna tutti gli ambiti (scope) posseduti dalla chiave di servizio tranne `keys:*`. `--roles` aggiunge ruoli RLS oltre a `service`, `--expires-in` accetta giorni ed `--expires-at` una data in formato ISO. `rebase api-keys scopes` elenca tutti gli ambiti noti al backend. Una chiave viene mostrata una sola volta. Vengono applicati sia gli ambiti della chiave che la row-level security dell'identità con cui agisce. Consulta [API keys](/docs/backend/api-keys/).

### `rebase storage`

Manutenzione dell'intero archivio dei file memorizzati, tramite il backend in esecuzione con `REBASE_SERVICE_KEY` letto da `.env`:

```bash
rebase storage orphans                         # files no row names
rebase storage orphans --source media --delete # and delete them, after asking
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` legge ogni riga di ogni tabella così come memorizzata (incluse le righe eliminate tramite soft-delete, scavalcando qualsiasi hook `beforeQuery` e `afterRead`) e ogni voce della [cronologia](/docs/backend/history/), poiché un ripristino recupera ciò che essa contiene. Elenca i file di una sorgente (`--source`, la sorgente predefinita se omessa) che non vengono menzionati da alcuna stringa al loro interno: una chiave, un URL o un riferimento `rebase-storage:` in un testo. I file più recenti di `--older-than` ore (24 per impostazione predefinita) vengono esclusi, poiché il pannello di amministrazione carica un file prima che la riga che lo referenzia venga salvata. La scansione viene eseguita sul backend in background, quindi un progetto troppo grande per essere scansionato all'interno di una singola richiesta (dietro un ingress che andrebbe in timeout) giunge comunque al termine. La CLI la avvia, quindi mostra il suo avanzamento (file elencati, righe lette, tabelle completate e quelle che non è stato possibile leggere) fino al completamento. Con la [coda dei job](/docs/backend/jobs/) attiva, la scansione è un job `storage.orphans` eseguito dai worker dei job. Senza di essa, la scansione viene eseguita all'interno del processo server a cui è stata richiesta, e la CLI lo segnala: il riavvio di tale processo interrompe la scansione. Una scansione corrisponde a un tentativo di job, limitato da `jobs.timeoutMs` (15 minuti per impostazione predefinita). Aumentalo o impostalo a 0 per una sorgente che richiede più tempo. `--json` stampa lo stesso report descritto in precedenza, con l'aggiunta del relativo `scanId`.

`--delete` chiede conferma prima di eliminare (`--yes` salta la domanda ed è obbligatorio in assenza di un terminale). Elimina solo i file derivanti dalla scansione appena stampata e solo entro 15 minuti dal completamento di tale scansione. Non viene eliminato nulla finché una tabella risulta illeggibile: una tabella con hook di lettura su un database il cui driver non riesce a bypassarli viene considerata come non letta. Prima di eliminare qualsiasi elemento, il server rilegge ogni riga e ogni voce della cronologia confrontandole con i file elencati. Quindi richiede ciascun file subito prima di eliminarlo. Un file che ora viene referenziato da una riga, che è stato ricaricato dopo la scansione o che non esiste più viene conservato, e la CLI lo elenca come mantenuto. I file a cui fanno riferimento solo tabelle non gestite da Rebase appariranno come inutilizzati: verifica attentamente prima di procedere all'eliminazione. Con un backend versione 0.25.1 o precedente, la CLI esegue la scansione secondo la vecchia modalità, all'interno di una singola richiesta.

`move` copia i file presenti in `--prefix` in un'altra sorgente mantenendo le stesse chiavi, una pagina alla volta. Un file già presente nella destinazione con le stesse dimensioni viene saltato, consentendo di riprendere uno spostamento interrotto eseguendolo nuovamente; `--delete-source` elimina ciascun file dalla sorgente una volta che la destinazione lo contiene, e viene rifiutato se le due sorgenti risiedono nello stesso bucket o nella stessa directory. Una volta completato lo spostamento, la CLI esamina nuovamente la sorgente con un percorso aggiornato e segnala ogni file che l'operazione non ha spostato: con `--delete-source`, qualsiasi file ancora presente nella sorgente; senza di esso, qualsiasi file di cui la destinazione non possiede una copia di pari dimensioni. Termina con codice 1 se ne trova anche solo uno, ed eseguendo nuovamente lo stesso comando di spostamento l'operazione ripartirà da lì. `--json` li stampa come `notMoved`. La lettura del report di una scansione richiede il permesso `database:read`. L'avvio di una scansione, l'eliminazione e lo spostamento richiedono `database:write`, che la chiave di servizio possiede.

### `rebase skills install`

Installa le skill di riferimento di Rebase per i tuoi assistenti di coding IA — ogni `--agent` sopra indicato:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
rebase skills --hooks
```

Consulta [Agent Skills](/docs/ai/skills) per l'elenco completo e le posizioni in cui vengono scritti i file.

`--hooks` installa il guardrail per Claude Code che `rebase init` include con ogni progetto: `.claude/hooks/post-edit-collection.sh`, registrato come hook `PostToolUse` in `.claude/settings.json`, che esegue `rebase verify --quiet` dopo ogni modifica all'interno di `backend/schema/` o `frontend/src/cms/` e restituisce qualsiasi problema all'agente. Le impostazioni e gli hook esistenti vengono mantenuti. `rebase skills --hooks` installa esclusivamente l'hook.

### `rebase telemetry`

Condivisione anonima dei dati di utilizzo, disattivata finché non dai il consenso. Una sessione interattiva di `rebase init` lo richiede al termine, con risposta predefinita impostata su no, per cui nulla viene condiviso a meno che non si risponda sì. La risposta è memorizzata per macchina (`~/.rebase/telemetry.json`): dopo un sì, `init` non lo chiederà più; dopo un no, il successivo `init` lo chiederà nuovamente. A ciascun checkout viene assegnato un ID progetto casuale, conservato nel file ignorato da git `.rebase/telemetry-project.json`.

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` stampa l'impostazione corrente, `show` stampa esattamente ciò che verrebbe inviato — a prescindere che la condivisione sia attiva o meno, consentendoti di esaminare il payload prima di decidere — e gli altri due ne modificano lo stato. Se non hai mai eseguito `init`, non è mai stato raccolto alcun dato.

## Prossimi passi

- **[Schema Generation](/docs/cli/schema/#production-workflow)** — Il flusso di lavoro delle migrazioni, dalla modifica di una tabella alla produzione
- **[Schema as Code](/docs/architecture/schema-as-code)** — Come funziona la generazione dello schema
- **[Quickstart](/docs/getting-started/quickstart)** — Inizia subito
