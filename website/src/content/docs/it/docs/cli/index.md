---
sourceHash: 38a7979a6ca8b028
title: Riferimento CLI
sidebar_label: CLI
description: Comandi della CLI di Rebase per l'inizializzazione del progetto, la generazione degli schemi, le migrazioni del database e la generazione dell'SDK.
---

## Panoramica

La CLI di Rebase (`rebase`) gestisce il tuo progetto dallo scaffolding al deployment.

## Installazione

```bash
pnpm add -g @rebasepro/cli
```

Oppure esegui qualsiasi comando senza installarlo: `pnpm dlx @rebasepro/cli <command>`.

## Output leggibile da macchina

`--json` è il flag dedicato, e al di fuori della famiglia `cloud` è l'unico: `rebase status`, `rebase resources`, `rebase apps list`, `rebase upgrade` e `rebase verify` inviano quindi un singolo valore JSON su stdout — il risultato, oppure un inviluppo `{"error": {"message", "code", "hint", "issues"}}` con un codice di uscita diverso da zero — a **ogni** terminazione del comando, in modo che il chiamante possa analizzare stdout incondizionatamente. Senza di esso scrivono testo leggibile dall'uomo e gli errori vanno su stderr. `rebase cloud` usa lo stesso inviluppo ed è l'unica eccezione al flag: abilita il JSON anche automaticamente quando stdout non è un TTY, oppure quando è impostato `REBASE_JSON=1`. Quindi `rebase cloud status | cat` produce JSON mentre `rebase status | cat` no — in uno script, passa `--json` esplicitamente invece di fare affidamento su una delle due regole.

## Comandi

### `rebase init`

Inizializza un nuovo progetto Rebase:

```bash
rebase init [directory]
```

Configura un `backend/` (le tabelle in `backend/schema/`) e un `frontend/` (il pannello di amministrazione, con le personalizzazioni delle tabelle in `frontend/src/cms/`); `--headless` genera solo lo scaffolding di `backend/`, senza `backend/schema/`. La [Struttura del progetto](/docs/getting-started/project-structure/) mostra entrambi gli alberi.

| Flag | Cosa fa |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` o `blank`. Predefinito `blog` |
| `--headless` | Solo backend — nessun pannello di amministrazione e nessun `backend/schema/`: il server serve direttamente le tabelle del database. `--template` non ha effetto, poiché non ci sono tabelle da inizializzare |
| `-y, --yes` | Non richiede mai conferme interattive. **Obbligatorio ovunque non ci sia un terminale per rispondere**, come in CI. Salta git init e l'installazione delle dipendenze — i valori predefiniti interattivi rispondono sì a entrambi, quindi passa `--git` / `--install` se li desideri |
| `-i, --install` | Installa le dipendenze dopo lo scaffolding. Senza questo flag, init lo chiede (predefinito sì); con `--yes`, non viene installato nulla |
| `--no-install` | Non installa nulla e non lo chiede |
| `-g, --git` | Inizializza un repository ed effettua il primo commit. Senza questo flag, init lo chiede (predefinito sì); con `--yes`, nessun repository |
| `--database-url <url>` | Usa un database esistente invece di quello gestito. Deve essere un URL `postgres://` o `postgresql://`: qualsiasi altra cosa viene rifiutata prima che venga scritto un file, e il prompt interattivo chiederà di nuovo |
| `--introspect` | Genera `backend/schema` da quel database. Implica `--template blank` e richiede `--install` |
| `--project <slug>` | Collega lo scaffold a un progetto Rebase Cloud |
| `--setup-key <key>` | La chiave monouso che autentica tale collegamento |
| `-a, --agent <name>` | Configura gli agenti di programmazione AI: le [skill](/docs/ai/skills) e il [server MCP](/docs/ai/mcp). Ripetibile o separato da virgole — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` o `all`. Senza questo flag, `init` lo chiede e preseleziona gli agenti installati sulla macchina; con `--yes`, nessuno |

### `rebase dev`

Avvia il server di sviluppo:

```bash
rebase dev
```

Avvia sia il frontend che il backend con hot reloading, e rigenera lo schema Drizzle e i tipi dell'SDK (`generated/sdk/`) all'avvio e a ogni salvataggio sotto `backend/schema/`. Il backend avviato serve anche l'[endpoint MCP remoto](/docs/ai/remote-mcp/) su `/mcp` senza nulla da configurare, a meno che una riga `REBASE_MCP_ENABLED` nella shell o in `.env` non stabilisca diversamente; la riga `MCP:` del banner stampa il suo URL, e [`rebase mcp connect`](/docs/cli/project/#rebase-mcp) vi connette un client AI.

Entrambe le porte sono derivate dal percorso del progetto, in modo che più progetti Rebase possano essere eseguiti fianco a fianco. Usa gli URL stampati da `rebase dev`. Fissane una con `rebase dev --port 3001`.

Un'app statica in `rebase.json` senza fase di compilazione (nessun `build`, e `output` corrisponde alla sua `root`, come un semplice sito HTML) viene servita dal backend da quella directory, al suo `path`, così come `rebase start` la serve dal bundle, e `FRONTEND_URL` viene impostato su di essa (sulla porta del backend) in modo che i link inviati via email atterrino lì. Vengono serviti anche i suoi [`redirects` e `cleanUrls`](/docs/architecture/redirects-and-clean-urls/), e un'app che dichiara reindirizzamenti non necessita di un file `index.html`.
Un'app con una fase di build viene eseguita in Vite sulla propria porta, e `FRONTEND_URL` corrisponde a quella di Vite.

Una modifica a `.env` riavvia il backend, che rilegge il file, così come fa il pannello di amministrazione. Ciò che `rebase dev` imposta autonomamente viene mantenuto fino al riavvio: `PORT`, e `DATABASE_URL` quando si trova sul database gestito o su Docker.

Con `--database-url`, `rebase dev` verifica prima che qualcosa risponda a quell'host e porta. Se non risponde nulla, lo segnala menzionando il flag ed esce con codice `1` senza avviare nulla; inoltre lascia inalterati i nomi del database in `.env`, senza mai avviare il container compose corrispondente.

### `rebase build`

Compila il progetto in un bundle distribuibile in `dist-bundle/`:

```bash
rebase build
```

Il bundle è l'artefatto da distribuire — l'immagine di runtime lo carica, quindi non c'è alcuna immagine applicativa da compilare autonomamente. Flag utili:

| Flag | Effetto |
|------|--------|
| `--output <dir>` (o `--out`) | Scrive il bundle in una posizione diversa da `dist-bundle/` (un'app alla volta) |
| `--vendor` | Installa e include sempre le dipendenze del bundle |
| `--no-vendor` | Non include mai le dipendenze nel vendor; il pod le installerà a ogni avvio |
| `--skip-type-check` | Salta il controllo dei tipi (più veloce, meno sicuro) |
| `--no-static` | Non include il frontend nel bundle del backend (ogni app statica ottiene comunque il proprio bundle) |
| `--skip-static-build` | Include il frontend così come è già compilato, senza eseguire il suo comando di build |

Un frontend — ogni app statica di `rebase.json` con una configurazione Vite — la cui configurazione non utilizza `rebaseBackendGuard()` (da `@rebasepro/app/vitePlugin`) viene rifiutato: è ciò che impedisce al codice del server di finire nel bundle del browser ed evita che Vite incorpori un file del backend come URL `data:` (fa fallire la build, menzionando se stesso, quando un altro plugin sostituisce il suo `build.assetsInlineLimit`). `frontend/src/cms/ui-config.json` viene inserito nel bundle come `entry.uiConfig`, ovvero la presentazione dell'area di lavoro servita da un backend distribuito.

Le dipendenze vengono incluse nel vendor per impostazione predefinita, in modo che una nuova istanza non debba attendere un'installazione di 35-55 secondi. Un albero che supera i 2 GB su disco viene invece scartato, poiché il limite di caricamento è di 1 GB compresso.

Ogni app statica inclusa nel bundle ottiene una copia brotli (`.br`) e gzip (`.gz`) accanto a ciascun asset con hash nel contenuto pari o superiore a 1 KB — i file che un browser memorizza nella cache per un anno. Il runtime invia quello accettato dal browser, in modo che tali file non comportino alcun costo di compressione per richiesta, inclusa la prima visita dopo una distribuzione, e i browser che supportano brotli lo ricevono (circa l'11% più piccolo di gzip sul JavaScript dell'admin). L'output di build del frontend rimane inalterato; cambia solo la copia all'interno del bundle. Sull'applicazione di esempio, questo aggiunge meno di un secondo alla build e circa 2,4 MB al bundle.

### `rebase upgrade`

Aggiorna ogni pacchetto `@rebasepro/*` vincolato nel progetto a un'unica release, quindi installa con il package manager specificato nel file di lock. `rebase upgrade` seleziona l'ultima versione; `--to 0.21.0` una versione esatta, senza lookup nel registry; `--to canary` un dist-tag. Ogni vincolo in `dependencies`, `devDependencies` e `optionalDependencies`, in ogni `package.json` del progetto, mantiene il suo `^` o `~`, e nient'altro nel file viene modificato. `peerDependencies` e le specifiche `workspace:`, `link:`, `file:`, git e tag vengono elencate e lasciate invariate. Anche gli override in `pnpm-workspace.yaml` e `package.json` vengono aggiornati, ma un override `link:` o `file:` ha la precedenza su ogni vincolo: viene segnalato e `--drop-local-overrides` lo rimuove. `--dry-run` non scrive nulla, `--no-install` salta l'installazione e `--json` stampa un unico documento.

Un progetto su una versione di pre-release, come una canary, rimane sul suo canale a meno che `latest` non sia più recente. Un dist-tag che sposterebbe un vincolo a una versione precedente viene rifiutato (`downgrade_refused` con `--json`), a meno che non si passi `--allow-downgrade`; un `--to` esatto viene applicato e contrassegnato come downgrade. Un `--dry-run` di un aggiornamento che l'esecuzione reale rifiuterebbe mostra cosa verrebbe aggiornato ed esce con 0; con `--json` il suo documento include il rifiuto come `wouldRefuse` (`{ code, message, hint }`).
Una volta installato, aggiorna anche le [skill dell'agente](/docs/ai/skills/#updating-the-skills) del progetto dalla nuova CLI (`skills` nel documento `--json`). Gli altri comandi terminano con una riga su stderr quando è disponibile una release più recente; [`REBASE_NO_UPDATE_CHECK=1`](/docs/getting-started/configuration/) la nasconde.

### `rebase start`

Esegue il bundle compilato nello stesso modo in cui lo esegue un deployment:

```bash
rebase start
```

Legge `PORT` e il resto di `.env`, a differenza di `rebase dev`, nel `NODE_ENV` che essi definiscono. Un file `.env` generato contiene `development`, quindi il primo account registrato diventa comunque l'amministratore, e `rebase start` lo segnala all'inizio; imposta `NODE_ENV=production` per un server di produzione. `rebase start --bundle ./dist-bundle` esegue un bundle situato altrove.

`rebase start` non avvia alcun database e il file `.env` generato non ha un `DATABASE_URL`, quindi un'esecuzione locale sul database utilizzato da `rebase dev` si effettua con `DATABASE_URL="$(rebase db url)" rebase start`.
In assenza di questa variabile, stampa tale riga prima dell'avvio.

### `rebase apps list`

Mostra le applicazioni dichiarate da questo repository:

```bash
rebase apps list
```

Un repository può dichiarare più di un'app distribuibile — ad esempio un backend e un sito di marketing. Questo comando consente di vedere su cosa agiranno `rebase build` e il deployment.

### `rebase eject`

Prende il pieno controllo del processo del server e della sua immagine:

```bash
rebase eject
```

Scrive l'entrypoint del backend e un `Dockerfile` nel progetto e ne converte il backend, in modo che il repository compili la propria immagine invece di eseguire il runtime pubblicato. Da quel momento in poi **gli aggiornamenti del runtime della piattaforma non lo raggiungeranno più**, e CORS, gestione dell'autenticazione, storage e arresto saranno completamente a carico tuo.

Visualizzane un'anteprima con `rebase eject --dry-run`, che elenca le modifiche senza applicare nulla. `--force` sostituisce un `backend/src/index.ts` o `env.ts` esistente, salvando il file corrente come `<name>.bak`.

Il server sottoposto a eject mantiene i caricamenti locali nella directory `uploads/` del progetto, sia eseguito dal sorgente che compilato, esattamente come fa `rebase dev`. Viene eseguito in `backend/`, quindi un `STORAGE_PATH` relativo lì viene letto da `backend/`.

### `rebase schema generate` / `rebase schema stale`

```bash
rebase schema generate       # backend/schema → backend/src/schema.generated.ts
rebase schema stale          # elenca le differenze rispetto alle tabelle, esce con 1 se ce ne sono
rebase schema stale --fix    # rigenera invece il file
```

Ogni comando che legge lo schema accetta `--schema-dir <dir>` per un progetto che lo conserva altrove; `--collections` è stato rimosso. `rebase dev` mantiene il file aggiornato, quindi `stale` è il controllo ideale per una build o per la CI. Consulta la [Generazione dello schema](/docs/cli/schema/).

### `rebase db`

```bash
rebase db push                 # applica le tabelle al database (sviluppo)
rebase db generate             # scrive un file di migrazione SQL
rebase db migrate              # applica le migrazioni in sospeso
rebase db url                  # stampa la stringa di connessione usata da questo progetto
rebase db pull --from <url>    # copia un altro database in quello locale
rebase db backup               # pg_dump; db backups list e db restore disponibili a fianco
rebase db branch create <name> # una copia su cui lavorare; sono disponibili anche switch, list e prune
rebase db stop                 # arresta il database di sviluppo gestito
rebase db reset                # lo elimina e ricomincia da capo
rebase db request-role migrate --to <role> # sposta le richieste su un altro ruolo Postgres
rebase db provision --print    # l'SQL che configura il ruolo di richiesta, per un DBA
```

Ciascuno è illustrato nei [Comandi database](/docs/cli/database/), insieme all'ordine con cui un comando seleziona il proprio database; `push`, `generate` e `migrate` sono trattati in dettaglio nella sezione [Generazione dello schema](/docs/cli/schema/).

### `rebase console`

Un REPL Node con i dati del progetto aperti, o un singolo snippet eseguito con `-e`:

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) e `tables` (le tabelle del progetto, caricate da `backend/schema`) sono nello scope, e l'`await` di primo livello funziona. Il database viene risolto come lo risolve `rebase db push`, e aprirlo non modifica nulla al suo interno. Con `-e`, il risultato atteso viene stampato in formato JSON su stdout e un'eccezione esce con codice `1`. Flag: `--eval`/`-e`, `--schema-dir`, `--database-url`, `--docker`. Consulta [Script e la Console](/docs/backend/scripts/).

### `rebase migrate`

Passaggi unidirezionali da un layout che questa versione non legge più:
`rebase migrate collections-to-tables` (`config/collections` → `backend/schema` e `frontend/src/cms`) e `rebase migrate sdk-calls` (`data.collection("x")` → `data.table("x")` nel tuo codice). I relativi flag, cosa scrivono e la sezione "Verifica prima del deploy" sono disponibili in [Generazione dello schema](/docs/cli/schema/#rebase-migrate).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # le app dichiarate da questo progetto
rebase apps init             # scrive un rebase.json dedotto da questo progetto
rebase apps config <app>     # la configurazione client per una singola app
```

`apps init` non accetta alcun nome: deduce ogni app dal progetto e scrive l'intero `rebase.json`, rifiutandosi di sostituirne uno esistente a meno che non venga passato `--force`.

L'argomento del nome viene rifiutato. `--force` mantiene ciò che l'inferenza non può conoscere dal file che va a sostituire: il nome di ciascuna app, il suo `path` e la sua rotta `cms`. Tutto il resto viene dedotto nuovamente, e un'app dichiarata che non viene più trovata viene indicata come rimossa, in modo che su uno scaffold riscriva il `rebase.json` fornito originariamente con lo scaffold. Il comando di build dell'app statica utilizza il gestore di pacchetti del progetto.

Per un checkout non collegato a un progetto Cloud, `apps config` segnala che non è collegato, indipendentemente dal fatto che `rebase dev` sia in esecuzione o meno, e fornisce l'URL del backend così come viene servito da `rebase dev`.

### `rebase apps add admin`

```bash
rebase apps add admin                  # su /, o su /admin quando un'altra app si trova su /
rebase apps add admin --path /console  # ovunque altrove, o un URL https dedicato
```

Aggiunge il pannello di amministrazione a un progetto headless o migrato, così come lo avrebbe generato `rebase init`. Per informazioni su cosa scrive, quale versione vincola e quando si rifiuta: [Aggiungere un pannello di amministrazione in seguito](/docs/getting-started/headless/#adding-an-admin-panel-later).

### `rebase status`

Tutto ciò che questo progetto dichiara, e se l'ambiente effettivamente vi si associa:

```bash
rebase status               # ogni risorsa e le variabili che legge
rebase status --json        # formato leggibile da macchina
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

Tre file determinano ciò che un backend può raggiungere, e questo comando li stampa tutti e tre insieme:
`rebase.json` definisce dove si trova il tuo codice e chi esegue il server,
`backend/resources.ts` definisce cosa serve al progetto, e l'ambiente definisce come raggiungere ogni elemento. Tutto il resto — `rebase.resources.json`, il manifesto del bundle — viene generato dal file intermedio per i lettori che non possono eseguire il tuo codice, e non deve mai essere scritto manualmente.

Uno stato `○` indica la condizione utile da conoscere prima di un deploy piuttosto che dopo: dichiarato, non configurato. Uno stato `✗` indica che l'ambiente ha impostato qualcosa in modo *errato*, il che impedisce l'avvio anziché degradare con grazia.

Un `rebase.resources.json` che non corrisponde più alle dichiarazioni riceve una riga `○`. Uno che non è ancora stato scritto non la riceve: `rebase build` lo scrive a ogni compilazione, quindi un progetto che non è mai stato compilato, come un nuovo scaffold, non ha nulla da correggere.

### `rebase resources`

Ciò che questo progetto dichiara come necessario — i database, i bucket, i topic e le code richiesti da `backend/resources.ts`, nonché i cron e le funzioni definiti dai suoi file:

```bash
rebase resources            # elencali
rebase resources --write    # rigenera rebase.resources.json
rebase resources --check    # fallisce se il grafo committato non è aggiornato
rebase resources --json     # formato leggibile da macchina
```

`rebase resources --check` è il flag utilizzato da un job di CI per fallire in caso di un `rebase.resources.json` che non corrisponde più a `backend/resources.ts`.
`--json` può essere combinato con esso: in caso di disallineamento, `rebase resources --check --json` esce con codice 1 restituendo un inviluppo di errore (`resource_graph_missing` o `resource_graph_stale`), mentre in caso di successo il grafo riporta `check.status`. `--write --json` scrive il file e segnala `written.changed`.

Una risorsa viene dichiarata in `backend/resources.ts` — `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` — oppure è un file situato in `backend/crons` o `backend/functions`, e non va mai scritta a mano in `rebase.resources.json`, il quale viene generato a partire da tali dichiarazioni affinché un host possa leggere ciò di cui il progetto necessita senza doverlo compilare. Ciascuna voce registra chi la usa (`table:events`, `column:posts.cover`, `function:report`).

Un backend include anche un database predefinito e una sorgente di storage predefinita che nessuno dichiara esplicitamente. Entrambi vengono elencati qui, contrassegnati come `implicit`, e nessuno dei due viene scritto in `rebase.resources.json` — l'host li fornisce automaticamente, pertanto registrarli significherebbe richiedere il provisioning di qualcosa che nessuno ha richiesto.
Dichiararne uno esplicito con nome, come `bucket("media")`, lascia l'elemento predefinito al suo posto, per cui entrambi vengono elencati. Solo dichiarare esplicitamente il default stesso, o contrassegnare un bucket con `default: true`, va a sostituirlo.

Per visualizzare ciò che la piattaforma mantiene per un progetto a fronte di ciò che il suo codice dichiara, e per rimuovere un database fornito che il codice non menziona più, consulta [`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` — ogni comando relativo a Rebase Cloud: autenticazione, collegamento al progetto, deploy, configurazione, database, risorse, calcolo e altro — ha [la propria pagina dedicata](/docs/cli/cloud).

### `rebase generate-sdk`

```bash
rebase generate-sdk
```

Scrive in `generated/sdk/` un client tipizzato per le tabelle esportate da `backend/schema/index.ts`, con `TableName` e `tablesDictionary`; `--from <link|url>` legge invece il contratto di un backend in esecuzione. `--register` tipizza anche i dati lato server: scrive i tipi e la dichiarazione `Register` in `backend/generated/` e lo memorizza in `rebase.json` (`registerDatabase`).
Consulta [Dati tipizzati lato server](/docs/backend/typed-server-data) e [Generazione dello schema](/docs/cli/schema/#rebase-generate-sdk).

### `rebase doctor`

```bash
rebase doctor
```

Il comando da eseguire quando qualcosa non funziona e non sai ancora cosa sia. Riporta informazioni senza modificare mai nulla, quindi è sicuro su qualsiasi database raggiungibile.

**Senza un database.** Questi controlli vengono eseguiti per primi, poiché tutto ciò che impedisce a un progetto di funzionare a monte accade prima che una tabella possa essere confrontata:

| Controllo | Motivo |
| --- | --- |
| Versione di Node | Rispetto all'intervallo dichiarato dalla CLI. Una versione troppo vecchia non viene segnalata come "Node non supportato" — bensì come un errore di sintassi all'interno di una dipendenza. |
| Package manager | Presenza di due lockfile in un unico progetto. `npm install` in un workspace pnpm riscrive `node_modules` in una struttura non compatibile con pnpm, e il sintomo è `Cannot find module` ore dopo. |
| Slug duplicati | Due tabelle che dichiarano lo stesso slug. Lo schema rifiuta di compilare in questa condizione, e il controllo elenca entrambi. |
| Integrità di `.env` | Un `JWT_SECRET` più corto di 32 caratteri (con cui la produzione rifiuta l'avvio), e `NODE_ENV=production` senza né `CORS_ORIGINS` né `FRONTEND_URL`. I valori non vengono mai stampati. |
| Disallineamento versioni `@rebasepro/*` | Lo stesso pacchetto vincolato a versioni differenti nei vari file `package.json` del progetto. Due copie causano il fallimento di `instanceof` tra di esse, che fallisce come un type guard che rigetta il proprio tipo. |
| Stringhe di connessione | Un carattere `=` non codificato in un parametro URL, che gli strumenti nativi di PostgreSQL rifiutano di analizzare — portando alla rottura di backup e `psql` mentre l'applicazione continua a funzionare. |
| Funzioni personalizzate | Ciò di cui ciascuna funzione ha bisogno dal proprio host, e quali di esse non potrebbero essere eseguite su un runtime edge. |

**Contro il database** — quello del progetto, risolto nello stesso modo in cui lo risolve `rebase db url`, quindi su un nuovo scaffold è il database gestito, che `doctor` avvia:

| Controllo | Motivo |
| --- | --- |
| Tabelle → schema generato | Verifica se `schema.generated.ts` non è aggiornato. |
| Tabelle → database | Tabelle, colonne, enum, chiavi esterne e giunzioni mancanti. |
| Estensioni richieste | Una colonna `col.vector()` richiede pgvector, che Rebase installa solo dove dichiarato dal progetto. |
| Schema stamp | Verifica se questo database è stato sottoposto a provisioning da queste tabelle. Trattandosi di un hash, può indicare che i due differiscono ma mai quale sia più avanti. Uno stamp `v1:` derivante da un runtime precedente allo 0.31 viene segnalato una sola volta, con il relativo restamp: `rebase db push`. |
| Tabelle → tipi SDK | Verifica se l'SDK tipizzato generato non è aggiornato. |
| Policy RLS | Verifica se le policy del database corrispondono all'`rls` dichiarato, e se una policy nomina un ruolo che questo server non può utilizzare. |

Se il database non è raggiungibile, le relative fasi vengono segnalate come saltate con il relativo motivo e il resto dei controlli viene comunque eseguito — vedi [Risoluzione dei problemi](/docs/troubleshooting/).

Termina con codice diverso da zero quando un controllo rileva un errore, o quando una fase non ha potuto essere eseguita perché il database specificato rifiuta le connessioni. Una fase saltata a causa dell'impossibilità di risolvere alcun database non è considerata un fallimento.

`rebase doctor --policies` esegue esclusivamente i controlli RLS — nessun diff dello schema, nessun tipo SDK — e fallisce in modo restrittivo (fail-closed), rendendolo ideale come controllo di sbarramento (gate) di CI contro un database distribuito.

`rebase doctor --database` esegue solo il preflight del database: se il ruolo con cui vengono eseguite le richieste autenticate esiste, è ristretto e può essere assunto, quali altri accessi possono assumerlo, se ogni ruolo può connettersi, e quali tabelle, permessi e policy Rebase condividerebbe con altri ruoli. Ogni riscontro indica l'SQL da eseguire come amministratore, l'impostazione `rls` che adatta Rebase al database, o entrambi. Legge il catalogo senza modificare nulla, ed esce con 1 quando un riscontro costituisce un errore. Funziona anche su un progetto headless. Consulta [Esecuzione su un database esistente o condiviso](/docs/deployment/existing-database/).

### `rebase verify`

```bash
rebase verify
rebase verify --json
rebase verify --live
rebase verify --live --database-url postgresql://…
```

Verifica se le tabelle sono pronte per il rilascio, in un unico comando rapido pensato per la CI e per gli hook degli agenti AI. Funziona offline per impostazione predefinita e non modifica mai nulla.

| Passaggio | Cosa ne determina il fallimento |
| --- | --- |
| Definizioni delle tabelle (`schema`) | `backend/schema` non si carica o non compila tramite il loader da cui si avvia il backend: una relazione con una tabella non esportata dall'index, `rls: "inherit"` senza `defaultRls`, una tabella priva di chiave primaria — un riscontro per problema. Una tabella priva di `rls` è tra questi. |
| Copertura RLS (`rls`) | Una tabella con una colonna `user_id`, `owner_id`, `organization_id` o `tenant_id` le cui regole — proprie o ereditate tramite `defaultRls` — consentono a un ruolo di leggere ogni riga indipendentemente da essa (avviso). `rls-policy-recursion`: una regola che legge la propria tabella in una subquery, o due tabelle le cui regole si leggono a vicenda, che Postgres rifiuta di espandere causando il fallimento di ogni istruzione protetta con `42P17 infinite recursion detected in policy`; il riscontro indica la tabella letta e la correzione, che consiste nello spostare la lettura in una funzione `SECURITY DEFINER` (un errore, oppure un avviso quando il loop non è certo). |
| Aggiornamento delle migrazioni (`migrations`) | Una tabella o colonna dichiarata nelle tabelle che nessun file in `backend/drizzle/migrations` crea, oppure una rimossa che una migrazione crea ancora. Saltato per un progetto che non ha ancora migrazioni. |
| Personalizzazioni CMS (`cms`) | Una chiamata `customizeTable(...)` in `frontend/src/cms` (o nel `src/cms` di un'app statica in `rebase.json`) che non corrisponde alle tabelle, letta staticamente — i moduli non vengono eseguiti. `cms-unknown-table`: lo slug non corrisponde ad alcuna tabella, quindi il pannello la ignora (viene suggerito lo slug più vicino). `cms-unknown-field`: una chiave sotto `fields` non è né una colonna né una relazione (il nome SQL di una colonna riceve risposta con la sua chiave). `cms-hidden-required`: un campo escluso dal form (`hiddenInForm`, `readOnly`, `disabled`) la cui colonna è `NOT NULL` senza valore predefinito e senza nulla che il server compili automaticamente, per cui la creazione di un record dal pannello fallisce sempre; produce un avviso quando un hook `beforeSave` o una trasformazione potrebbe compilarlo, ed è silenziato da `filledByServer`. `cms-duplicate-customization`: un unico slug personalizzato due volte. `cms-not-static` (avviso): una chiamata il cui slug, opzioni o `fields` non sono valori letterali o una costante (`const`) nello stesso file, per cui nulla al suo interno è stato controllato. `cms-ui-config-not-mounted` (avviso): `frontend/src/cms/ui-config.json` esiste ma non viene fornito a `<RebaseCMS>` come `uiConfig`. `cms-backend-guard-missing`: la configurazione Vite del frontend non usa `rebaseBackendGuard()`, per cui `rebase build` la rifiuterebbe. Un progetto headless non ha `frontend/src/cms` e salta questo passaggio. |
| Audit RLS live (`live`) | Con `--live`: il catalogo [`rls-check`](/docs/rls-check) rispetto al database del progetto, e se ogni migrazione è stata applicata. Il database viene risolto come lo risolvono i comandi `db` — `--database-url`, `DATABASE_URL`, `--docker`, altrimenti il database di sviluppo gestito. Un database non configurato o che non risponde è un errore, non un'omissione: l'audit è stato esplicitamente richiesto. Una policy di lettura `USING (true)` compilata da una regola `access: "public"` costituisce un avviso finché l'API richiede un token (`AUTH_REQUIRE`, attivo per impostazione predefinita) — ogni utente autenticato legge ogni riga — ed è un errore con `AUTH_REQUIRE=false`, dove le righe sono anonime. |

`--json` stampa un unico oggetto, `{ ok, schemaDir, steps, findings, summary }`:
ogni step è `{ id, title, status, detail? }` (`status` può essere `passed`, `failed`, `warnings` o `skipped`), e ogni riscontro (finding) include `step`, `check` (un tipo kebab-case stabile), `severity`, `message` e, dove applicabile, `fix`, `table`, `file`, `line` e il percorso puntato (`path`) all'interno della tabella (`posts.rls[0]`) — consentendo a un agente di riparare ciò che ha corrotto. `summary` conta `errors` e `warnings`. `--quiet` non stampa nulla quando tutti i controlli passano. Termina con un codice diverso da zero in caso di errore; gli avvisi non causano il fallimento.

Un progetto creato tramite scaffolding lo esegue per Claude Code dopo ogni modifica in `backend/schema/`: vedi [`rebase skills install`](#rebase-skills-install).

### Comandi per un'app in esecuzione

`rebase api`, `rebase data`, `rebase users`, `rebase cron`, `rebase logs`, `rebase functions`, `rebase rls simulate`, `rebase auth login` e `rebase storage ls|cp|rm|url|stat` agiscono su un'applicazione in esecuzione tramite la sua API: il server locale di `rebase dev`, un server specificato con `--url`, o un progetto Rebase Cloud con `--project`. Consulta [Un'applicazione in esecuzione](/docs/cli/project/).

### `rebase auth`

Comandi per la gestione dell'autenticazione:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gestisce le chiavi API di servizio del progetto — le credenziali usate da un agente, da uno script o da un altro servizio, a differenza della sessione di un utente finale:

```bash
rebase api-keys list
rebase api-keys get abc123-def456
rebase api-keys create --name "Blog CI" --scopes data:read:posts,data:write:posts --expires-in 90
rebase api-keys create --name "Ops" --full-access --roles admin --expires-at 2027-01-31
rebase api-keys revoke abc123-def456
```

`--scopes` definisce cosa la chiave può fare, separato da virgole o ripetuto; `--full-access` le assegna ogni scope posseduto dalla chiave di servizio eccetto `keys:*`. `--roles` aggiunge ruoli RLS accanto a `service`, `--expires-in` accetta giorni ed `--expires-at` una data in formato ISO.
`rebase api-keys scopes` elenca tutti gli scope riconosciuti dal backend. Una chiave viene mostrata una sola volta.
Si applicano sia gli scope della chiave sia la sicurezza a livello di riga (RLS) dell'identità con cui opera.
Consulta [Chiavi API](/docs/backend/api-keys/).

### `rebase storage`

Manutenzione dell'intero archivio dei file memorizzati, tramite il backend in esecuzione con `REBASE_SERVICE_KEY` da `.env`:

```bash
rebase storage orphans                         # file a cui nessuna riga fa riferimento
rebase storage orphans --source media --delete # ed eliminali, previa conferma
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` legge ogni riga di ogni tabella così come memorizzata (comprese le righe soft-deleted, oltrepassando qualsiasi hook `beforeQuery` e `afterRead`) e ogni voce di [cronologia](/docs/backend/history/), poiché un ripristino recupera ciò che essa contiene.
Elenca i file di una sorgente (`--source`, la sorgente predefinita se omessa) a cui nessuna stringa al loro interno fa riferimento: una chiave, un URL, un riferimento `rebase-storage:` in un testo. I file più recenti di `--older-than` ore (24 per impostazione predefinita) vengono esclusi, poiché il pannello di amministrazione carica un file prima che la riga che lo referenzia venga salvata.
La scansione viene eseguita sul backend in background, quindi un progetto troppo grande per essere scansionato all'interno di una singola richiesta (dietro un ingress che andrebbe in timeout) viene comunque completato. La CLI avvia la scansione e ne mostra l'avanzamento (file elencati, righe lette, tabelle completate e quelle che non è stato possibile leggere) fino al termine. Con la [coda dei job](/docs/backend/jobs/) attiva, la scansione è un job `storage.orphans` eseguito dai worker. Senza di essa, la scansione viene eseguita all'interno del processo del server a cui è stata richiesta e la CLI lo notifica: il riavvio di quel processo interrompe la scansione. Una scansione corrisponde a un tentativo di job, limitato da `jobs.timeoutMs` (15 minuti per impostazione predefinita). Aumentalo o impostalo su 0 per una sorgente che richiede più tempo. `--json` stampa lo stesso report di prima, oltre al relativo `scanId`.

`--delete` richiede conferma prima dell'eliminazione (`--yes` salta la domanda ed è obbligatorio in assenza di un terminale). Elimina solo gli elementi della scansione appena stampata ed esclusivamente entro 15 minuti dal completamento di tale scansione. Non viene eliminato nulla se una tabella non può essere letta: una tabella con hook di lettura su un database il cui driver non riesce a leggerli oltrepassandoli viene considerata non letta. Prima di eliminare qualsiasi elemento, il server rilegge ogni riga e voce di cronologia rispetto ai file elencati. Successivamente richiede nuovamente ogni file subito prima di eliminarlo. Un file referenziato ora da una riga, caricato nuovamente dopo la scansione o non più presente viene mantenuto, e la CLI lo elenca come conservato. I file referenziati esclusivamente da tabelle non servite da Rebase sembreranno inutilizzati: controlla bene prima di eliminare. Contro un backend con versione 0.25.1 o precedente, la CLI esegue la scansione alla vecchia maniera, all'interno di un'unica richiesta.

`move` copia i file sotto `--prefix` verso un'altra sorgente mantenendo le stesse chiavi, una pagina alla volta. Un file già presente nella destinazione con la stessa dimensione viene saltato, in modo che un'operazione interrotta possa riprendere eseguendola di nuovo; `--delete-source` elimina ciascun file dalla sorgente una volta che la destinazione lo contiene, e viene rifiutato se le due sorgenti memorizzano i dati nello stesso bucket o nella stessa directory. Una volta terminato lo spostamento, la CLI elenca nuovamente la sorgente con una nuova scansione e menziona ogni file che l'operazione non ha spostato: con `--delete-source`, qualsiasi file ancora presente nella sorgente; senza di esso, qualsiasi file di cui la destinazione non contenga una copia della stessa dimensione. Esce con 1 qualora ce ne sia uno, e rieseguire lo stesso comando di spostamento lo elaborerà. `--json` li stampa come `notMoved`. La lettura del report di una scansione richiede `database:read`. L'avvio di una scansione, l'eliminazione e lo spostamento richiedono `database:write`, concesso dalla chiave di servizio.

### `rebase skills install`

Installa le skill di riferimento di Rebase per i tuoi assistenti di programmazione AI — ciascuno degli argomenti `--agent` sopra citati:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
rebase skills --hooks
```

Consulta le [Skill dell'agente](/docs/ai/skills) per l'elenco completo e per sapere dove vengono scritti i file.

`--hooks` installa il guardrail di Claude Code fornito da `rebase init` con ogni progetto: `.claude/hooks/post-edit-collection.sh`, registrato come hook `PostToolUse` in `.claude/settings.json`, che esegue `rebase verify --quiet` dopo ogni modifica sotto `backend/schema/` o `frontend/src/cms/` e restituisce qualsiasi eventuale problema all'agente. Le impostazioni e gli hook esistenti vengono mantenuti. `rebase skills --hooks` installa l'hook singolarmente.

### `rebase telemetry`

Condivisione anonima dei dati di utilizzo, disattivata finché non fornisci il consenso. Un'esecuzione interattiva di `rebase init` lo chiede al termine, e la risposta predefinita è no, quindi non viene condiviso nulla a meno che non rispondi affermativamente. La risposta è memorizzata per macchina (`~/.rebase/telemetry.json`): dopo un sì, `init` non lo chiederà più, e dopo un no il successivo `init` lo chiederà di nuovo. Ogni checkout riceve un ID di progetto casuale, conservato nel file ignorato da git `.rebase/telemetry-project.json`.

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` stampa l'impostazione corrente, `show` stampa esattamente ciò che verrebbe inviato — a prescindere dal fatto che la condivisione sia attiva o meno, consentendoti di esaminare il payload prima di decidere — e gli altri due comandi la modificano. Se non hai mai eseguito `init`, non è mai stato raccolto nulla.

## Passaggi successivi

- **[Generazione dello schema](/docs/cli/schema/#production-workflow)** — Il flusso di lavoro delle migrazioni, dalla modifica di una tabella alla produzione
- **[Schema as Code](/docs/architecture/schema-as-code)** — Come funziona la generazione dello schema
- **[Guida rapida](/docs/getting-started/quickstart)** — Inizia subito
