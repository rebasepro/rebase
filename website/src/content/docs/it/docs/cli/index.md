---
sourceHash: d0b65c1ecccde6ba
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

`--json` è il flag selettore, e al di fuori della famiglia `cloud` è l'unico: `rebase status`, `rebase resources`, `rebase apps list`, `rebase upgrade` e `rebase verify` inviano quindi un singolo valore JSON su stdout — il risultato, o un envelope `{"error": {"message", "code", "hint", "issues"}}` con un codice di uscita diverso da zero — a **ogni** uscita del comando, consentendo a un chiamante di analizzare stdout in modo incondizionato. Senza di esso, scrivono testo leggibile dall'uomo e gli errori finiscono su stderr. `rebase cloud` utilizza lo stesso envelope ed è l'unica eccezione al flag: attiva automaticamente il formato JSON anche quando stdout non è una TTY o quando è impostato `REBASE_JSON=1`. Quindi `rebase cloud status | cat` restituisce JSON mentre `rebase status | cat` no — all'interno di uno script, passa `--json` esplicitamente anziché fare affidamento su una delle due regole.

## Comandi

### `rebase init`

<span class="since-badge" data-since="0.31">Da 0.31</span>

Inizializza un nuovo progetto Rebase:

```bash
rebase init [directory]
```

Configura un `backend/` (le tabelle in `backend/schema/`) e un `frontend/` (il pannello di amministrazione, con le personalizzazioni delle tabelle in `frontend/src/cms/`); `--headless` esegue lo scaffolding solo del `backend/`, senza `backend/schema/`. La [Struttura del progetto](/docs/getting-started/project-structure/) mostra entrambi gli alberi.

| Flag | Descrizione |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` o `blank`. Predefinito: `blog` |
| `--headless` | Solo backend — nessun pannello di amministrazione e nessun `backend/schema/`: il server espone le tabelle del database stesso. `--template` non ha effetto, poiché non ci sono tabelle da popolare con seed |
| `-y, --yes` | Non richiedere mai conferme interattive. **Obbligatorio ovunque non ci sia un terminale per rispondere**, come in CI. Salta git init e l'installazione delle dipendenze — i valori predefiniti interattivi rispondono sì a entrambi, quindi passa `--git` / `--install` se li desideri |
| `-i, --install` | Installa le dipendenze dopo lo scaffolding. Senza questo flag, init chiede conferma (predefinito sì); con `--yes`, non viene installato nulla |
| `--no-install` | Non installare nulla e non chiedere |
| `-g, --git` | Inizializza un repository ed effettua il primo commit. Senza questo flag, init chiede conferma (predefinito sì); con `--yes`, nessun repository |
| `--database-url <url>` | Usa un database esistente invece di quello gestito. Deve essere un URL `postgres://` o `postgresql://`: qualsiasi altra cosa viene rifiutata prima che un file venga scritto, e il prompt interattivo chiederà nuovamente |
| `--introspect` | Genera `backend/schema` da quel database. Implica `--template blank` e richiede `--install` |
| `--project <slug>` | Collega lo scaffold a un progetto Rebase Cloud |
| `--setup-key <key>` | La chiave monouso che autentica tale collegamento |
| `-a, --agent <name>` | Configura gli agenti di programmazione AI: le [skill](/docs/ai/skills) e il [server MCP](/docs/ai/mcp). Ripetibile o separato da virgole — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` o `all`. Senza questo flag, `init` chiede e pre-seleziona gli agenti installati sulla macchina; con `--yes`, nessuno |

### `rebase dev`

Avvia il server di sviluppo:

```bash
rebase dev
```

Avvia sia il frontend che il backend con hot reloading e rigenera lo schema Drizzle e i tipi dell'SDK (`generated/sdk/`) all'avvio e a ogni salvataggio all'interno di `backend/schema/`.

Entrambe le porte sono derivate dal percorso del progetto in modo che più progetti Rebase possano essere eseguiti contemporaneamente affiancati. Usa gli URL stampati da `rebase dev`. Fissane una con `rebase dev --port 3001`.

Una modifica a `.env` riavvia il backend, che rilegge il file, esattamente come fa il pannello di amministrazione. Ciò che `rebase dev` imposta autonomamente viene mantenuto fino al suo riavvio: `PORT`, e `DATABASE_URL` quando si trova sul database gestito o su Docker.

Con `--database-url`, `rebase dev` verifica prima che ci sia risposta a quell'host e a quella porta. Se non riceve risposta, lo segnala menzionando il flag ed esce con codice `1` senza avviare nulla; inoltre non tocca i nomi del database in `.env`, evitando di avviare il relativo container compose.

### `rebase build`

Compila il progetto in un bundle distribuibile in `dist-bundle/`:

```bash
rebase build
```

Il bundle è l'artefatto di cui effettui il deploy — l'immagine di runtime lo carica, quindi non è necessario compilare un'immagine dell'applicazione autonomamente. Flag utili:

| Flag | Effetto |
|------|--------|
| `--output <dir>` (or `--out`) | Scrive il bundle in una posizione diversa da `dist-bundle/` (un'app alla volta) |
| `--vendor` | Installa e include sempre le dipendenze del bundle |
| `--no-vendor` | Non effettuare mai il vendoring; il pod le installerà a ogni avvio |
| `--skip-type-check` | Salta il controllo dei tipi (più veloce, meno sicuro) |
| `--no-static` | Non incorporare il frontend nel bundle del backend (ogni app statica riceve comunque il proprio bundle) |
| `--skip-static-build` | Incorpora il frontend così come già compilato, senza eseguire il relativo comando di build |

<span class="since-badge" data-since="0.31">Da 0.31</span> Un frontend — ogni app statica di `rebase.json` con una configurazione Vite — la cui configurazione non utilizza `rebaseBackendGuard()` (da `@rebasepro/app/vitePlugin`) viene rifiutato: è ciò che impedisce al codice server di finire nel bundle del browser ed evita che Vite incorpori inline un file di backend come URL `data:` (interrompe la build con errore, citando se stesso, quando un altro plugin sostituisce il suo `build.assetsInlineLimit`). `frontend/src/cms/ui-config.json` viene inserito nel bundle come `entry.uiConfig`, la presentazione del workspace servita da un backend distribuito.

Le dipendenze sono sottoposte a vendoring per impostazione predefinita, in modo che una nuova istanza non debba sostenere un'installazione di 35–55 secondi. Un albero che supera i 2 GB su disco viene invece scartato, poiché il limite di caricamento è di 1 GB compresso.

Ogni app statica trasportata dal bundle riceve una copia brotli (`.br`) e una gzip (`.gz`) accanto a ciascun asset con hash nel contenuto pari o superiore a 1 KB — i file che un browser memorizza nella cache per un anno. Il runtime invia quella accettata dal browser, in modo che tali file non richiedano lavoro di compressione per richiesta, inclusa la prima visita dopo un deploy, e i browser che supportano brotli la ricevono (circa l'11% più piccola di gzip sul JavaScript del pannello di amministrazione). L'output di compilazione effettivo del tuo frontend rimane invariato; solo la copia nel bundle cambia. Sull'applicazione di esempio, ciò aggiunge meno di un secondo alla build e circa 2,4 MB al bundle.

### `rebase upgrade`

Sposta ogni pacchetto `@rebasepro/*` fissato dal progetto a una singola release, quindi installa con il gestore di pacchetti indicato dal relativo lockfile. `rebase upgrade` prende la versione più recente (`latest`); `--to 0.21.0` una versione esatta, senza interrogazione del registry; `--to canary` un dist-tag. Ogni vincolo in `dependencies`, `devDependencies` e `optionalDependencies`, in ogni `package.json` del progetto, mantiene il proprio `^` o `~`, e nient'altro nel file viene modificato. Le `peerDependencies` e le specifiche `workspace:`, `link:`, `file:`, git e tag vengono elencate e lasciate invariate. Anche gli override in `pnpm-workspace.yaml` e `package.json` vengono aggiornati, ma un override `link:` o `file:` prevale su ogni vincolo: viene segnalato e `--drop-local-overrides` lo rimuove. `--dry-run` non scrive nulla, `--no-install` salta l'installazione e `--json` stampa un unico documento.

Un progetto su una versione prerelease, come una canary, rimane sul suo canale a meno che `latest` non sia più recente. Un dist-tag che porterebbe un pacchetto a una versione precedente viene rifiutato (`downgrade_refused` con `--json`), a meno che non si passi `--allow-downgrade`; un `--to` esatto viene applicato e segnalato come downgrade. Un `--dry-run` di un aggiornamento che l'esecuzione reale rifiuterebbe mostra cosa verrebbe spostato ed esce con 0, e con `--json` il suo documento include il rifiuto come `wouldRefuse` (`{ code, message, hint }`).

### `rebase start`

Esegue il bundle compilato nello stesso modo in cui viene eseguito in una distribuzione:

```bash
rebase start
```

Legge `PORT` e il resto di `.env`, a differenza di `rebase dev`, nel `NODE_ENV` da essi impostato. Un `.env` generato contiene `development`, quindi il primo account registrato diventa comunque l'amministratore, e `rebase start` lo segnala all'inizio; imposta `NODE_ENV=production` per un server di produzione. `rebase start --bundle ./dist-bundle` esegue un bundle situato altrove.

`rebase start` non avvia alcun database e il file `.env` dello scaffold non ha un `DATABASE_URL`, quindi un'esecuzione locale sul database utilizzato da `rebase dev` si effettua con `DATABASE_URL="$(rebase db url)" rebase start`. In assenza di questo, stampa tale riga prima dell'avvio.

### `rebase apps list`

Mostra le app dichiarate da questo repository:

```bash
rebase apps list
```

Un repository può dichiarare più di un'app distribuibile — ad esempio, un backend e un sito di marketing. Questo è il modo per vedere su cosa opereranno `rebase build` e il deployment.

### `rebase eject`

Prendi il pieno controllo del processo del server e della sua immagine:

```bash
rebase eject
```

Scrive l'entrypoint del backend e un `Dockerfile` nel progetto e converte il backend, in modo che il repository compili la propria immagine invece di eseguire il runtime pubblicato. Da quel momento in poi, **gli aggiornamenti del runtime della piattaforma non avranno più effetto su di esso**, e la configurazione di CORS, gestione dell'autenticazione, storage e shutdown diventerà di tua competenza.

Visualizzane un'anteprima con `rebase eject --dry-run`, che elenca le modifiche senza applicarle. `--force` sostituisce un `backend/src/index.ts` o `env.ts` esistente, conservando il file corrente come `<name>.bak`.

Il server espulso ("ejected") conserva i caricamenti locali nella cartella `uploads/` del progetto, sia eseguito da sorgente che compilato, esattamente come `rebase dev`. Viene eseguito in `backend/`, quindi un `STORAGE_PATH` relativo viene letto a partire da `backend/`.

### `rebase schema generate` / `rebase schema stale`

<span class="since-badge" data-since="0.31">Da 0.31</span>

```bash
rebase schema generate       # backend/schema → backend/src/schema.generated.ts
rebase schema stale          # name what differs from the tables, exit 1 if anything does
rebase schema stale --fix    # regenerate the file instead
```

Ogni comando che legge lo schema accetta `--schema-dir <dir>` per un progetto che lo conserva altrove; `--collections` è stato rimosso. `rebase dev` mantiene il file aggiornato, quindi `stale` è il controllo ideale per una build o per la CI. Consulta [Generazione dello schema](/docs/cli/schema/).

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

Ciascuno è descritto in [Comandi del database](/docs/cli/database/), insieme all'ordine con cui un comando seleziona il proprio database; `push`, `generate` e `migrate` sono trattati in dettaglio in [Generazione dello schema](/docs/cli/schema/).

### `rebase console`

<span class="since-badge" data-since="0.31">Da 0.31</span>

Una REPL di Node con i dati del progetto accessibili, o un singolo snippet eseguito con `-e`:

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) e `tables` (le tabelle del progetto, caricate da `backend/schema`) sono nello scope e l'`await` di primo livello è supportato. Il database viene risolto nello stesso modo in cui lo risolve `rebase db push`, e l'apertura della console non vi apporta alcuna modifica. Con `-e`, il risultato atteso viene stampato come JSON su stdout e un'eccezione non gestita esce con codice `1`. Flag: `--eval`/`-e`, `--schema-dir`, `--database-url`, `--docker`. Consulta [Script e console](/docs/backend/scripts/).

### `rebase migrate`

<span class="since-badge" data-since="0.31">Da 0.31</span>

Migrazioni unidirezionali da una struttura non più supportata da questa release: `rebase migrate collections-to-tables` (`config/collections` → `backend/schema` e `frontend/src/cms`) e `rebase migrate sdk-calls` (`data.collection("x")` → `data.table("x")` nel proprio codice). I relativi flag, ciò che scrivono e la sezione "Verifica prima del deployment" sono disponibili in [Generazione dello schema](/docs/cli/schema/#rebase-migrate).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init             # write a rebase.json inferred from this project
rebase apps config <app>     # the client configuration for one app
```

`apps init` non accetta alcun nome: deduce ogni app dal progetto e scrive l'intero `rebase.json`, rifiutandosi di sovrascriverne uno esistente a meno che non si passi `--force`.

Un argomento per il nome viene rifiutato. `--force` mantiene ciò che l'inferenza non può dedurre dal file sostituito: il nome di ciascuna app, il suo `path` e la sua route `cms`. Tutto il resto viene dedotto nuovamente, e un'app dichiarata che non viene più trovata viene indicata come rimossa; pertanto, su uno scaffold riscrive il `rebase.json` originariamente fornito dallo scaffold. Il comando di build dell'app statica utilizza il gestore di pacchetti del progetto.

Per un checkout non collegato a un progetto Cloud, `apps config` segnala che non è collegato, indipendentemente dal fatto che `rebase dev` sia in esecuzione o meno, e fornisce l'URL del backend così come servito da `rebase dev`.

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

Tre file determinano ciò che un backend può raggiungere e questo comando li stampa tutti e tre insieme: `rebase.json` indica dove si trova il codice e chi esegue il server, `backend/resources.ts` specifica ciò di cui il progetto ha bisogno e l'ambiente indica come raggiungere ogni risorsa. Tutto il resto — `rebase.resources.json`, il manifest del bundle — viene generato da quest'ultimo per i lettori che non possono eseguire il tuo codice, e non viene mai modificato manualmente.

Uno `○` indica lo stato utile da conoscere prima di un deploy piuttosto che dopo: dichiarato, ma non configurato. Una `✗` indica che l'ambiente imposta qualcosa in modo *errato*, impedendo l'avvio anziché funzionare in modalità degradata.

Un `rebase.resources.json` che non corrisponde più alle dichiarazioni riceve una riga `○`. Uno che non è ancora stato scritto non la riceve: `rebase build` lo scrive a ogni compilazione, quindi un progetto che non è mai stato compilato, come un nuovo scaffold, non ha nulla da correggere.

### `rebase resources`

Ciò di cui questo progetto dichiara di aver bisogno — i database, i bucket, i topic e le code richiesti da `backend/resources.ts`, nonché i cron e le funzioni definiti dai suoi file:

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` è il flag utilizzato da un job di CI per fallire in caso di un `rebase.resources.json` che non corrisponde più a `backend/resources.ts`. `--json` può essere combinato con esso: in caso di disallineamento (drift), `rebase resources --check --json` esce con codice 1 con un envelope di errore (`resource_graph_missing` o `resource_graph_stale`), mentre in caso di successo il grafo riporta `check.status`. `--write --json` scrive il file e segnala `written.changed`.

Una risorsa viene dichiarata in `backend/resources.ts` — `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` — oppure è un file all'interno di `backend/crons` o `backend/functions`, e non viene mai scritta a mano in `rebase.resources.json`, il quale viene generato a partire da tali dichiarazioni per consentire a un host di determinare ciò di cui un progetto necessita senza compilarlo. Ogni voce registra chi la utilizza (`table:events`, `column:posts.cover`, `function:report`).

Un backend dispone inoltre di un database predefinito e di un'origine di archiviazione predefinita che nessuno dichiara esplicitamente. Entrambi sono elencati qui, contrassegnati come `implicit`, e nessuno dei due viene scritto in `rebase.resources.json` — l'host li fornisce, quindi registrarli richiederebbe il provisioning di elementi non esplicitamente richiesti. La dichiarazione di una risorsa denominata, come `bucket("media")`, lascia invariato l'elemento predefinito, quindi entrambi compaiono nell'elenco. Solo la dichiarazione esplicita del valore predefinito, o l'assegnazione a un bucket di `default: true`, lo sostituisce.

Per confrontare ciò che la piattaforma mantiene per un progetto con quanto dichiarato dal suo codice, e per rimuovere un database fornito che il codice non menziona più, consulta [`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` — ogni comando per Rebase Cloud: autenticazione, collegamento al progetto, deployment, configurazione, database, risorse, calcolo e altro ancora — ha [una pagina dedicata](/docs/cli/cloud).

### `rebase generate-sdk`

<span class="since-badge" data-since="0.31">Da 0.31</span>

```bash
rebase generate-sdk
```

Scrive un client tipizzato per le tabelle esportate da `backend/schema/index.ts` in `generated/sdk/`, con `TableName` e `tablesDictionary`; `--from <link|url>` legge invece il contratto di un backend in esecuzione. `--register` tipizza anche i dati lato server: scrive i tipi e la dichiarazione `Register` in `backend/generated/` e li memorizza in `rebase.json` (`registerDatabase`). Consulta [Dati tipizzati lato server](/docs/backend/typed-server-data) e [Generazione dello schema](/docs/cli/schema/#rebase-generate-sdk).

### `rebase doctor`

```bash
rebase doctor
```

Il comando da eseguire quando qualcosa non funziona e non si sa ancora cosa. Si limita a segnalare i problemi senza modificare nulla, risultando sicuro su qualsiasi database raggiungibile.

**Senza database.** Questi controlli vengono eseguiti per primi, poiché tutto ciò che impedisce al progetto di funzionare del tutto si verifica prima ancora che una tabella possa essere confrontata:

| Controllo | Motivo |
| --- | --- |
| Versione di Node | Rispetto all'intervallo dichiarato dalla CLI. Una versione obsoleta non viene segnalata come "Node non supportato", bensì come errore di sintassi all'interno di una dipendenza. |
| Gestori di pacchetti | Due file di lockfile in un unico progetto. `npm install` in un workspace pnpm riscrive `node_modules` secondo una struttura non compatibile con pnpm, e il sintomo è un errore `Cannot find module` riscontrato ore dopo. |
| Slug duplicati | Due tabelle che dichiarano lo stesso slug. Lo schema rifiuta la compilazione e questo controllo le indica entrambe. |
| Integrità di `.env` | Un `JWT_SECRET` inferiore a 32 caratteri (su cui l'ambiente di produzione rifiuta l'avvio) e `NODE_ENV=production` in assenza sia di `CORS_ORIGINS` che di `FRONTEND_URL`. I valori non vengono mai stampati. |
| Disallineamento di versione di `@rebasepro/*` | Lo stesso pacchetto vincolato a versioni diverse tra i vari file `package.json` del progetto. Due copie distinte compromettono l'`instanceof` tra loro, causando il fallimento di un type guard che rifiuta il proprio stesso tipo. |
| Stringhe di connessione | Un `=` non codificato in un parametro dell'URL, che gli strumenti nativi di PostgreSQL non riescono ad analizzare — provocando il malfunzionamento dei backup e di `psql` mentre l'applicazione continua a funzionare. |
| Funzioni personalizzate | Ciò di cui ciascuna funzione necessita dal proprio host e quali di esse non verrebbero eseguite su un runtime edge. |

**Confronto con il database** — quello del progetto, risolto nello stesso modo in cui lo risolve `rebase db url`; pertanto, su uno scaffold appena creato si tratta del database gestito, che `doctor` avvia:

| Controllo | Motivo |
| --- | --- |
| Tabelle → schema generato | Verifica se `schema.generated.ts` non è aggiornato. |
| Tabelle → database | Tabelle, colonne, enum, chiavi esterne e tabelle di giunzione mancanti. |
| Estensioni richieste | Una colonna `col.vector()` richiede pgvector, che Rebase installa solo se dichiarato dal progetto. |
| Stamp dello schema | Verifica se il database è stato predisposto a partire da queste tabelle. Trattandosi di un hash, può segnalare una divergenza ma mai quale versione sia più avanzata. Uno stamp `v1:` proveniente da un runtime precedente alla 0.31 viene segnalato una volta, insieme al comando per riapplicarlo: `rebase db push`. |
| Tabelle → tipi SDK | Verifica se l'SDK tipizzato generato non è aggiornato. |
| Policy RLS | Verifica se le policy del database corrispondono a `rls` dichiarato e se una policy nomina un ruolo non utilizzabile da questo server. |

Se il database non è raggiungibile, le relative fasi vengono contrassegnate come ignorate con la motivazione e il resto dei controlli viene comunque eseguito — consulta [Risoluzione dei problemi](/docs/troubleshooting/).

Esce con codice diverso da zero se un controllo rileva un errore o se una fase non ha potuto essere eseguita perché il database specificato rifiuta le connessioni. Una fase saltata per l'impossibilità di risolvere alcun database non è considerata un errore.

`rebase doctor --policies` esegue esclusivamente i controlli RLS — nessun diff dello schema, nessun tipo SDK — e fallisce in modalità restrittiva ("fail-closed"), rendendolo il formato ideale da usare come gate di CI su un database distribuito.

`rebase doctor --database` esegue solo il preflight del database: verifica se il ruolo con cui vengono eseguite le richieste autenticate esiste, è limitato e consente l'impersonificazione, quali altri accessi possono passare ad esso, se ogni ruolo può connettersi e quali tabelle, permessi e policy Rebase condividerebbe con altri ruoli. Ogni segnalazione specifica il codice SQL da eseguire come amministratore, l'impostazione `rls` per adattare Rebase al database, o entrambi. Legge il catalogo di sistema senza modificare nulla ed esce con 1 quando un rilievo costituisce un errore. Funziona anche su un progetto headless. Consulta [Esecuzione su un database esistente o condiviso](/docs/deployment/existing-database/).

### `rebase verify`

```bash
rebase verify
rebase verify --json
rebase verify --live
rebase verify --live --database-url postgresql://…
```

<span class="since-badge" data-since="0.31">Da 0.31</span>

Verifica se le tabelle sono pronte per il rilascio, in un unico comando rapido per la CI e per gli hook degli agenti AI. Funziona offline per impostazione predefinita e non modifica mai nulla.

| Passaggio | Cosa determina il fallimento |
| --- | --- |
| Definizioni delle tabelle (`schema`) | `backend/schema` non si carica o non compila tramite il loader con cui il backend si avvia: una relazione con una tabella non esportata dall'index, `rls: "inherit"` senza `defaultRls`, una tabella priva di chiave primaria — una segnalazione per problema. Una tabella priva di `rls` rientra tra queste. |
| Copertura RLS (`rls`) | Una tabella con una colonna `user_id`, `owner_id`, `organization_id` o `tenant_id` le cui regole — proprie o derivate dal `defaultRls` ereditato — consentono a un ruolo di leggere tutte le righe ignorando tale vincolo. È un avviso (warning). |
| Aggiornamento delle migrazioni (`migrations`) | Una tabella o colonna dichiarata nelle tabelle che nessun file in `backend/drizzle/migrations` crea, oppure una eliminata che una migrazione continua a creare. Viene saltato per progetti senza ancora alcuna migrazione. |
| Personalizzazioni CMS (`cms`) | Un `customizeTable(...)` in `frontend/src/cms` (o nel `src/cms` di un'app statica in `rebase.json`) che non corrisponde alle tabelle, analizzato staticamente — i moduli non vengono eseguiti. `cms-unknown-table`: lo slug non corrisponde ad alcuna tabella, quindi il pannello lo ignora (viene suggerito lo slug più simile). `cms-unknown-field`: una chiave sotto `fields` non è né una colonna né una relazione (al nome SQL di una colonna viene associata la relativa chiave). `cms-hidden-required`: un campo escluso dal form (`hiddenInForm`, `readOnly`, `disabled`) la cui colonna è `NOT NULL` senza valore predefinito e senza valorizzazione da parte del server, per cui la creazione di un record dal pannello fallisce sempre; è un avviso qualora un hook `beforeSave` o una trasformazione possa valorizzarlo, e viene silenziato da `filledByServer`. `cms-duplicate-customization`: uno stesso slug personalizzato due volte. `cms-not-static` (avviso): una chiamata il cui slug, opzioni o `fields` non sono valori letterali o una costante (`const`) definita nello stesso file, per cui non è stato possibile effettuare verifiche. `cms-ui-config-not-mounted` (avviso): `frontend/src/cms/ui-config.json` esiste ma non viene fornito a `<RebaseCMS>` come `uiConfig`. `cms-backend-guard-missing`: la configurazione Vite del frontend non usa `rebaseBackendGuard()`, pertanto `rebase build` la rifiuterebbe. Un progetto headless non ha `frontend/src/cms` e salta questo passaggio. |
| Audit RLS live (`live`) | Con `--live`: il catalogo [`rls-check`](/docs/rls-check) a fronte del database di progetto e la verifica che ogni migrazione sia stata applicata. Il database viene risolto come fanno i comandi `db` — `--database-url`, `DATABASE_URL`, `--docker`, altrimenti il database di sviluppo gestito. Un database non configurato o che non risponde costituisce un errore, non un passaggio ignorato: l'audit è stato esplicitamente richiesto. Una policy di lettura `USING (true)` compilata da una regola `access: "public"` genera un avviso finché l'API richiede un token (`AUTH_REQUIRE`, attivo per impostazione predefinita) — ogni utente autenticato legge tutte le righe — e un errore con `AUTH_REQUIRE=false`, dove le righe sono accessibili anonimamente. |

`--json` stampa un singolo oggetto, `{ ok, schemaDir, steps, findings, summary }`: ogni passaggio è `{ id, title, status, detail? }` (`status` è `passed`, `failed`, `warnings` o `skipped`) e ciascun rilievo riporta `step`, `check` (una tipologia stabile in kebab-case), `severity`, `message` e, ove applicabili, `fix`, `table`, `file`, `line` e il `path` separato da punti all'interno della tabella (`posts.rls[0]`) — consentendo a un agente di correggere l'anomalia. `summary` calcola il totale di `errors` e `warnings`. `--quiet` non stampa nulla se tutti i controlli hanno esito positivo. Esce con codice diverso da zero in caso di errore; i warning non determinano il fallimento.

Un progetto generato tramite scaffold lo esegue per Claude Code dopo ogni modifica all'interno di `backend/schema/`: consulta [`rebase skills install`](#rebase-skills-install).

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

`--scopes` indica le azioni consentite alla chiave, separate da virgola o ripetute; `--full-access` le assegna tutti gli ambiti (scope) detenuti dalla chiave di servizio ad eccezione di `keys:*`. `--roles` aggiunge ruoli RLS oltre a `service`, `--expires-in` accetta un numero di giorni e `--expires-at` una data in formato ISO. `rebase api-keys scopes` elenca tutti gli ambiti riconosciuti dal backend. Una chiave viene mostrata una sola volta. Si applicano sia gli ambiti della chiave sia la sicurezza a livello di riga (row-level security) dell'identità con cui opera. Consulta [Chiavi API](/docs/backend/api-keys/).

### `rebase storage`

Manutenzione complessiva dello storage dei file archiviati, tramite il backend in esecuzione con `REBASE_SERVICE_KEY` ricavata da `.env`:

```bash
rebase storage orphans                         # files no row names
rebase storage orphans --source media --delete # and delete them, after asking
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` legge ogni riga di ogni tabella così come memorizzata (incluse le righe eliminate tramite soft-delete, bypassando tutti gli hook `beforeQuery` e `afterRead`) e ogni voce della [cronologia](/docs/backend/history/), poiché un ripristino recupera quanto vi è memorizzato. Elenca i file di una determinata sorgente (`--source`, la sorgente predefinita se omessa) a cui nessuna stringa all'interno di esse fa riferimento: una chiave, un URL o un riferimento `rebase-storage:` all'interno di un testo. I file più recenti di `--older-than` ore (24 per impostazione predefinita) vengono esclusi, poiché il pannello di amministrazione carica un file prima che la riga che lo referenzia sia salvata. La scansione viene eseguita in background sul backend, in modo che un progetto troppo grande per essere scansionato in un'unica richiesta (dietro un ingress che andrebbe in timeout) possa comunque essere completato. La CLI avvia l'operazione, quindi mostra l'avanzamento (file elencati, righe lette, tabelle completate ed eventuali tabelle illeggibili) fino al termine. Con la [coda dei job](/docs/backend/jobs/) attiva, la scansione è un job `storage.orphans` eseguito dai worker. Senza di essa, la scansione viene eseguita all'interno del processo del server interpellato, e la CLI lo segnala: il riavvio di tale processo interrompe la scansione. Una scansione corrisponde a un tentativo di job, limitato da `jobs.timeoutMs` (15 minuti per impostazione predefinita). Aumentalo, o impostalo su 0, per una sorgente che richiede più tempo. `--json` stampa lo stesso report di prima, oltre al relativo `scanId`.

`--delete` chiede conferma prima di procedere con l'eliminazione (`--yes` salta la domanda ed è obbligatorio in assenza di un terminale). Elimina solo i file della scansione appena stampata ed esclusivamente entro 15 minuti dal completamento di tale scansione. Non viene eliminato nulla se una tabella non può essere letta: una tabella con hook di lettura su un database il cui driver non riesce a bypassarli viene considerata non letta. Prima di eliminare qualsiasi elemento, il server rilegge nuovamente ogni riga e ogni voce della cronologia confrontandole con i file elencati. Richiede poi conferma per ciascun file subito prima di eliminarlo. Un file a cui una riga fa riferimento in quel momento, che è stato ricaricato dopo la scansione o che non esiste più viene preservato, e la CLI lo elenca come mantenuto. I file a cui fanno riferimento solo tabelle non gestite da Rebase appariranno come inutilizzati: verifica attentamente prima di cancellare. Rispetto a un backend versione 0.25.1 o precedente, la CLI esegue la scansione secondo la vecchia modalità, all'interno di una singola richiesta.

`move` copia i file presenti sotto `--prefix` in un'altra sorgente con le stesse chiavi, una pagina alla volta. Un file già presente nella destinazione con le stesse dimensioni viene saltato, consentendo di riprendere uno spostamento interrotto eseguendolo nuovamente; `--delete-source` elimina ogni file dalla sorgente una volta acquisito dalla destinazione, e viene rifiutato se le due sorgenti risiedono nello stesso bucket o nella stessa directory. Una volta completato lo spostamento, la CLI esegue una nuova scansione della sorgente ed elenca ogni file non spostato: con `--delete-source`, qualsiasi file ancora presente nella sorgente; senza di esso, qualsiasi file di cui la destinazione non possieda una copia di pari dimensioni. Esce con codice 1 se ne trova anche solo uno, e l'esecuzione del medesimo spostamento lo elaborerà. `--json` li restituisce come `notMoved`. La lettura del report di una scansione richiede `database:read`. L'avvio di una scansione, l'eliminazione e lo spostamento richiedono `database:write`, autorizzazione inclusa nella chiave di servizio.

### `rebase skills install`

Installa le skill di riferimento di Rebase per i tuoi assistenti di programmazione AI — ciascuno degli argomenti `--agent` sopra indicati:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
rebase skills --hooks
```

Consulta [Skill degli agenti](/docs/ai/skills) per l'elenco completo e le posizioni in cui vengono scritti i file.

`--hooks` installa la guardrail per Claude Code inclusa da `rebase init` in ogni progetto: `.claude/hooks/post-edit-collection.sh`, registrato come hook `PostToolUse` in `.claude/settings.json`, che esegue `rebase verify --quiet` dopo ogni modifica all'interno di `backend/schema/` o `frontend/src/cms/` e restituisce qualsiasi problema all'agente. Le impostazioni e gli hook esistenti vengono mantenuti. `rebase skills --hooks` installa esclusivamente l'hook.

### `rebase telemetry`

Condivisione anonima dei dati di utilizzo, disattivata fino a esplicito consenso. La procedura interattiva di `rebase init` lo richiede al termine e il prompt è impostato su no per impostazione predefinita, per cui nulla viene condiviso a meno che non si risponda affermativamente. La preferenza è memorizzata per macchina (`~/.rebase/telemetry.json`): dopo un sì, `init` non lo chiederà più; dopo un no, il successivo `init` lo richiederà nuovamente. A ogni checkout viene assegnato un ID progetto casuale, conservato nel file `.rebase/telemetry-project.json` escluso da git.

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` visualizza l'impostazione corrente, `show` stampa esattamente ciò che verrebbe inviato — a prescindere dal fatto che la condivisione sia attiva o meno, consentendo di esaminare il payload prima di decidere — e gli altri due comandi ne modificano lo stato. Se non hai mai eseguito `init`, non è mai stato raccolto alcun dato.

## Passaggi successivi

- **[Generazione dello schema](/docs/cli/schema/#production-workflow)** — Il flusso di lavoro delle migrazioni, dalla modifica della tabella alla produzione
- **[Schema as Code](/docs/architecture/schema-as-code)** — Come funziona la generazione dello schema
- **[Guida rapida](/docs/getting-started/quickstart)** — Per iniziare
