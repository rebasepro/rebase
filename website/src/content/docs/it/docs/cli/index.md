---
sourceHash: c5b8a13884254638
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

`--json` è il flag principale e, al di fuori della famiglia `cloud`, è l'unico: `rebase status`, `rebase resources`, `rebase apps list`, `rebase upgrade` e `rebase verify` emettono quindi un singolo valore JSON su stdout — il risultato, o un envelope `{"error": {"message", "code", "hint", "issues"}}` con un codice di uscita diverso da zero — a **ogni** uscita del comando, in modo che il chiamante possa analizzare stdout incondizionatamente. Senza di esso scrivono testo leggibile dall'uomo e gli errori vanno su stderr. `rebase cloud` usa lo stesso envelope ed è l'unica eccezione al flag: attiva automaticamente il JSON anche quando stdout non è un TTY, o quando è impostato `REBASE_JSON=1`. Quindi `rebase cloud status | cat` produce JSON mentre `rebase status | cat` no — in uno script, passa `--json` esplicitamente anziché fare affidamento su queste regole.

## Comandi

### `rebase init`

Inizializza un nuovo progetto Rebase:

```bash
rebase init [directory]
```

Configura una cartella `backend/` (le tabelle in `backend/schema/`) e una `frontend/` (il pannello di amministrazione, con le personalizzazioni delle tabelle in `frontend/src/cms/`); `--headless` crea solo l'impalcatura di `backend/`, senza `backend/schema/`. [Struttura del progetto](/docs/getting-started/project-structure/) mostra entrambi gli alberi delle directory.

| Flag | Descrizione |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` o `blank`. Predefinito `blog` |
| `--headless` | Solo backend — nessun pannello di amministrazione e nessun `backend/schema/`: il server serve le tabelle native del database. `--template` non ha effetto, poiché non ci sono tabelle da popolare con seed |
| `-y, --yes` | Non chiedere mai conferma (senza prompt). **Richiesto ovunque non ci sia un terminale interattivo**, come nei sistemi di CI. Salta git init e l'installazione delle dipendenze — le impostazioni predefinite interattive rispondono sì a entrambi, quindi passa `--git` / `--install` se desideri abilitarli |
| `-i, --install` | Installa le dipendenze dopo lo scaffolding. Senza questo flag, init lo chiede (predefinito sì); con `--yes`, non viene installato nulla |
| `--no-install` | Non installare nulla e non chiedere |
| `-g, --git` | Inizializza un repository ed esegui il primo commit. Senza questo flag, init lo chiede (predefinito sì); con `--yes`, nessun repository |
| `--database-url <url>` | Usa un database esistente invece di quello gestito. Deve essere un URL `postgres://` o `postgresql://`: qualsiasi altra cosa viene rifiutata prima di scrivere qualsiasi file, e il prompt interattivo chiederà nuovamente |
| `--introspect` | Genera `backend/schema` da quel database. Implica `--template blank` e richiede `--install` |
| `--project <slug>` | Collega lo scaffold a un progetto Rebase Cloud |
| `--setup-key <key>` | La chiave monouso per autenticare tale collegamento |
| `-a, --agent <name>` | Configura gli agenti di coding IA: le [skills](/docs/ai/skills) e il [server MCP](/docs/ai/mcp). Ripetibile o separato da virgole — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` o `all`. Senza questo flag, `init` lo chiede e pre-seleziona gli agenti installati sulla macchina; con `--yes`, nessuno |

### `rebase dev`

Avvia il server di sviluppo:

```bash
rebase dev
```

Avvia sia il frontend che il backend con hot reloading, e rigenera lo schema Drizzle e i tipi dell'SDK (`generated/sdk/`) all'avvio e a ogni salvataggio all'interno di `backend/schema/`.

Entrambe le porte sono derivate dal percorso del progetto in modo che più progetti Rebase possano essere eseguiti in parallelo. Usa gli URL stampati da `rebase dev`. Fissane una con `rebase dev --port 3001`.

Un'app statica in `rebase.json` senza passaggio di build (nessun `build` e `output` corrisponde alla sua `root`, come un semplice sito HTML) viene servita dal backend da quella directory, al suo `path`, così come `rebase start` la serve dal bundle, e `FRONTEND_URL` viene impostato su di essa (sulla porta del backend) in modo che i link inviati via email puntino lì.
<span class="since-badge" data-since="0.35">Dalla 0.35</span> Vengono serviti anche i suoi [`redirects` e `cleanUrls`](/docs/architecture/redirects-and-clean-urls/), e un'app che dichiara reindirizzamenti non necessita di `index.html`.
Un'app con una build viene eseguita in Vite sulla propria porta, e `FRONTEND_URL` è quello di Vite.

Una modifica a `.env` riavvia il backend, che rilegge il file, così come fa il pannello di amministrazione. Ciò che `rebase dev` imposta autonomamente viene mantenuto fino al suo riavvio: `PORT`, e `DATABASE_URL` quando si trova sul database gestito o su Docker.

Con `--database-url`, `rebase dev` verifica prima che qualcosa risponda a quell'host e a quella porta. Se nulla risponde, lo segnala menzionando il flag ed esce con codice `1` senza avviare nulla; lascia inoltre intatte le variabili `.env` del database, senza mai avviare il relativo container compose.

### `rebase build`

Compila il progetto in un bundle distribuibile in `dist-bundle/`:

```bash
rebase build
```

Il bundle è l'artefatto che distribuisci — l'immagine runtime lo carica, quindi non c'è un'immagine applicativa da compilare personalmente. Flag utili:

| Flag | Effetto |
|------|--------|
| `--output <dir>` (or `--out`) | Scrivi il bundle altrove anziché in `dist-bundle/` (un'app alla volta) |
| `--vendor` | Installa e includi sempre le dipendenze del bundle |
| `--no-vendor` | Non includere mai le dipendenze nel bundle; il pod le installerà a ogni avvio |
| `--skip-type-check` | Salta il controllo dei tipi (più veloce, meno sicuro) |
| `--no-static` | Non incorporare il frontend nel bundle di backend (ogni app statica ottiene comunque il proprio bundle) |
| `--skip-static-build` | Incorpora il frontend così com'è già compilato, senza eseguire il relativo comando di build |

Un frontend — ogni app statica di `rebase.json` con una configurazione Vite — la cui configurazione non utilizzi `rebaseBackendGuard()` (da `@rebasepro/app/vitePlugin`) viene rifiutato: è ciò che impedisce al codice del server di finire nel bundle del browser e impedisce a Vite di incorporare inline un file di backend come URL `data:` (fa fallire la build, segnalandosi esplicitamente, se un altro plugin sostituisce il suo `build.assetsInlineLimit`). `frontend/src/cms/ui-config.json` viene inserito nel bundle come `entry.uiConfig`, ovvero la presentazione dell'area di lavoro servita da un backend distribuito.

Le dipendenze vengono incluse (vendored) per impostazione predefinita, in modo che una nuova istanza non debba attendere un'installazione di 35–55 secondi. Un albero di file che supera i 2 GB su disco viene invece scartato, poiché il limite di caricamento è di 1 GB compresso.

Ogni app statica trasportata dal bundle riceve una copia brotli (`.br`) e gzip (`.gz`) accanto a ciascun asset con hash nel contenuto pari o superiore a 1 KB — i file che un browser memorizza nella cache per un anno. Il runtime invia quella accettata dal browser, quindi tali file non richiedono alcun lavoro di compressione per richiesta, inclusa la prima visita dopo un deploy, e i browser che accettano brotli lo ricevono (circa l'11% più piccolo di gzip sul JavaScript del pannello di amministrazione). L'output di compilazione effettivo del tuo frontend rimane inalterato; cambia solo la copia all'interno del bundle. Nell'app di esempio questo aggiunge meno di un secondo alla build e circa 2,4 MB al bundle.

### `rebase upgrade`

Aggiorna ogni pacchetto `@rebasepro/*` bloccato nel progetto a una specifica release, quindi installa con il package manager indicato dal file di lock. `rebase upgrade` seleziona l'ultima versione disponibile (`latest`); `--to 0.21.0` una versione esatta, senza consultare il registry; `--to canary` un dist-tag. Ogni versione fissata in `dependencies`, `devDependencies` e `optionalDependencies`, in ogni `package.json` all'interno del progetto, mantiene il proprio prefisso `^` o `~`, e nient'altro nel file viene modificato. `peerDependencies` e le specifiche `workspace:`, `link:`, `file:`, git e tag vengono elencate e lasciate intatte. Anche gli override in `pnpm-workspace.yaml` e `package.json` vengono aggiornati, ma un override `link:` o `file:` ha la precedenza su qualsiasi pin: viene segnalato e `--drop-local-overrides` lo rimuove. `--dry-run` non scrive nulla, `--no-install` salta l'installazione e `--json` stampa un unico documento.

Un progetto su una prerelease, come una versione canary, rimane sul suo canale a meno che `latest` non sia più recente. Un dist-tag che porterebbe una versione fissata a una precedente viene rifiutato (`downgrade_refused` con `--json`), a meno che non si passi `--allow-downgrade`; un `--to` esatto viene applicato e contrassegnato come downgrade. Un `--dry-run` di un aggiornamento che l'esecuzione reale rifiuterebbe mostra cosa verrebbe modificato ed esce con 0; con `--json` il documento riporta il rifiuto come `wouldRefuse` (`{ code, message, hint }`).

### `rebase start`

Esegui il bundle compilato nello stesso modo in cui viene eseguito in fase di deployment:

```bash
rebase start
```

Legge `PORT` e il resto di `.env`, a differenza di `rebase dev`, nel `NODE_ENV` impostato. Un `.env` generato dall'impalcatura iniziale riporta `development`, quindi il primo account registrato diventa comunque l'amministratore, e `rebase start` lo specifica all'inizio; imposta `NODE_ENV=production` per un server di produzione. `rebase start --bundle ./dist-bundle` esegue un bundle posizionato altrove.

`rebase start` non avvia alcun database e il `.env` iniziale non contiene `DATABASE_URL`, quindi un'esecuzione locale sul database utilizzato da `rebase dev` si esegue con `DATABASE_URL="$(rebase db url)" rebase start`. Senza di esso, stampa quella riga prima dell'avvio.

### `rebase apps list`

Mostra le app dichiarate da questo repository:

```bash
rebase apps list
```

Un repository può dichiarare più di un'app distribuibile — ad esempio un backend e un sito di marketing. In questo modo puoi verificare su cosa agiranno `rebase build` e il deployment.

### `rebase eject`

Prendi il controllo diretto del processo del server e della sua immagine:

```bash
rebase eject
```

Scrive l'entrypoint del backend e un `Dockerfile` nel progetto e converte il backend, in modo che il repository compili la propria immagine anziché eseguire il runtime pubblicato. Da quel momento in poi **gli aggiornamenti del runtime della piattaforma non avranno più effetto su di esso**, e la configurazione di CORS, collegamenti di autenticazione, storage e arresto (shutdown) sarà completamente sotto la tua responsabilità.

Visualizza un'anteprima con `rebase eject --dry-run`, che elenca le modifiche senza applicarle. `--force` sostituisce un eventuale `backend/src/index.ts` o `env.ts` esistente, conservando il file corrente come `<name>.bak`.

Il server estratto (ejected) conserva i caricamenti locali nella cartella `uploads/` del progetto, sia eseguito da codice sorgente che compilato, esattamente come fa `rebase dev`. Viene eseguito in `backend/`, quindi un `STORAGE_PATH` relativo lì viene letto a partire da `backend/`.

### `rebase schema generate` / `rebase schema stale`

```bash
rebase schema generate       # backend/schema → backend/src/schema.generated.ts
rebase schema stale          # name what differs from the tables, exit 1 if anything does
rebase schema stale --fix    # regenerate the file instead
```

Ogni comando che legge lo schema accetta `--schema-dir <dir>` per i progetti che lo conservano altrove; `--collections` è stato rimosso. `rebase dev` mantiene il file aggiornato, quindi `stale` è il controllo ideale per una build o per la CI. Consulta [Generazione dello schema](/docs/cli/schema/).

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

Ciascuno è descritto in [Comandi del database](/docs/cli/database/), con l'ordine in cui un comando seleziona il proprio database; `push`, `generate` e `migrate` sono trattati in modo approfondito in [Generazione dello schema](/docs/cli/schema/).

### `rebase console`

Una REPL di Node con i dati del progetto accessibili, oppure un singolo frammento eseguito con `-e`:

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) e `tables` (le tabelle del progetto, caricate da `backend/schema`) sono nello scope e `await` a livello principale funziona. Il database viene risolto allo stesso modo di `rebase db push`, e l'apertura non vi apporta alcuna modifica. Con `-e`, il risultato atteso viene stampato in formato JSON su stdout e un'eccezione non gestita esce con codice `1`. Flag: `--eval`/`-e`, `--schema-dir`, `--database-url`, `--docker`. Consulta [Script e console](/docs/backend/scripts/).

### `rebase migrate`

Migrazioni unidirezionali da una struttura che questa release non legge più: `rebase migrate collections-to-tables` (`config/collections` → `backend/schema` e `frontend/src/cms`) e `rebase migrate sdk-calls` (`data.collection("x")` → `data.table("x")` nel tuo codice). I relativi flag, ciò che scrivono e la sezione "Review before deploying" si trovano in [Generazione dello schema](/docs/cli/schema/#rebase-migrate).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init             # write a rebase.json inferred from this project
rebase apps config <app>     # the client configuration for one app
```

`apps init` non accetta un nome: deduce ogni app dal progetto e scrive l'intero `rebase.json`, rifiutandosi di sostituirne uno esistente a meno che non si passi `--force`.

Un argomento per il nome viene rifiutato. `--force` mantiene ciò che l'inferenza non può dedurre dal file che va a sostituire: il nome di ciascuna app, il suo `path` e la sua route `cms`. Tutto il resto viene dedotto nuovamente, e un'app precedentemente dichiarata che non viene più trovata viene contrassegnata come rimossa; pertanto, su uno scaffold riscrive il `rebase.json` originale dello scaffold. Il comando di build dell'app statica utilizza il package manager del progetto.

Per un checkout non collegato a un progetto Cloud, `apps config` indica che non è collegato, indipendentemente dal fatto che `rebase dev` sia in esecuzione o meno, e fornisce l'URL del backend così come viene servito da `rebase dev`.

### `rebase apps add admin`

```bash
rebase apps add admin                  # at /, or at /admin when another app is at /
rebase apps add admin --path /console  # anywhere else, or an https URL of its own
```

Aggiunge il pannello di amministrazione a un progetto headless o migrato, così come l'avrebbe scritto `rebase init`. Cosa scrive, quale versione blocca e quando viene rifiutato: [Aggiungere un pannello di amministrazione in seguito](/docs/getting-started/headless/#adding-an-admin-panel-later).

### `rebase status`

Tutto ciò che questo progetto dichiara e se l'ambiente lo vincola effettivamente:

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

Tre file determinano ciò che un backend può raggiungere, e questo comando li stampa tutti e tre insieme: `rebase.json` indica dove si trova il tuo codice e chi esegue il server, `backend/resources.ts` specifica ciò di cui il progetto ha bisogno e l'ambiente definisce come raggiungere ciascun elemento. Tutto il resto — `rebase.resources.json`, il manifest del bundle — viene generato da quest'ultimo per i lettori che non possono eseguire il tuo codice, e non viene mai scritto manualmente.

`○` è lo stato che è utile conoscere prima di un deploy piuttosto che dopo: dichiarato, ma non configurato. `✗` significa che l'ambiente imposta qualcosa in modo *errato*, impedendo l'avvio anziché funzionare in modalità degradata.

Un file `rebase.resources.json` che non corrisponde più alle dichiarazioni riceve una riga `○`. Uno che non è ancora stato scritto no: `rebase build` lo genera a ogni build, quindi un progetto che non è mai stato compilato, come un nuovo scaffold, non ha nulla da correggere.

### `rebase resources`

Ciò di cui questo progetto dichiara di aver bisogno — i database, i bucket, i topic e le code richiesti da `backend/resources.ts`, nonché i cron e le funzioni definiti dai suoi file:

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` è il flag che un job di CI utilizza per fallire in caso di un `rebase.resources.json` che non corrisponde più a `backend/resources.ts`. `--json` si combina con esso: in caso di disallineamento (drift), `rebase resources --check --json` esce con codice 1 con un envelope di errore (`resource_graph_missing` o `resource_graph_stale`), mentre in caso di successo il grafo riporta `check.status`. `--write --json` scrive il file e segnala `written.changed`.

Una risorsa viene dichiarata in `backend/resources.ts` — `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` — o è un file in `backend/crons` o `backend/functions`, e non viene mai scritta a mano in `rebase.resources.json`, che viene generato da tali dichiarazioni affinché un host possa leggere ciò di cui un progetto ha bisogno senza compilarlo. Ogni voce registra chi la utilizza (`table:events`, `column:posts.cover`, `function:report`).

Un backend ha anche un database predefinito e una sorgente di storage predefinita che nessuno dichiara esplicitamente. Entrambi sono elencati qui, contrassegnati come `implicit`, e nessuno dei due viene scritto in `rebase.resources.json` — l'host li fornisce automaticamente, quindi registrarli comporterebbe la richiesta di provisioning per qualcosa che nessuno ha richiesto. Dichiararne uno con nome, ad esempio `bucket("media")`, lascia intatto quello predefinito, quindi entrambi compaiono nell'elenco. Solo dichiarare esplicitamente quello predefinito, oppure contrassegnare un bucket con `default: true`, lo sostituisce.

Per vedere ciò che la piattaforma gestisce per un progetto rispetto a quanto dichiarato dal suo codice, e per rimuovere un database fornito che il codice non menziona più, consulta [`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` — tutti i comandi per Rebase Cloud: autenticazione, collegamento progetti, deploy, configurazione, database, risorse, elaborazione (compute) e altro ancora — ha [una pagina dedicata](/docs/cli/cloud).

### `rebase generate-sdk`

```bash
rebase generate-sdk
```

Scrive un client tipizzato per le tabelle esportate da `backend/schema/index.ts` in `generated/sdk/`, con `TableName` e `tablesDictionary`; `--from <link|url>` legge invece il contratto di un backend in esecuzione. `--register` tipizza anche i dati lato server: scrive i tipi e la dichiarazione `Register` in `backend/generated/` e la memorizza in `rebase.json` (`registerDatabase`). Consulta [Dati lato server tipizzati](/docs/backend/typed-server-data) e [Generazione dello schema](/docs/cli/schema/#rebase-generate-sdk).

### `rebase doctor`

```bash
rebase doctor
```

Il comando da eseguire quando qualcosa non funziona e non sai ancora cosa sia. Riporta la situazione senza modificare mai nulla, quindi è sicuro da eseguire su qualsiasi database raggiungibile.

**Senza un database.** Questi controlli vengono eseguiti per primi, perché tutto ciò che impedisce a un progetto di avviarsi si verifica prima ancora che una tabella possa essere confrontata:

| Controllo | Motivo |
| --- | --- |
| Versione di Node | Confrontata con l'intervallo dichiarato dalla CLI. Una versione troppo vecchia non viene segnalata come "Node non supportato", bensì come un errore di sintassi all'interno di una dipendenza. |
| Package manager | Presenza di due file di lock in un unico progetto. `npm install` in un workspace pnpm riscrive `node_modules` con una struttura incompatibile con pnpm, e il sintomo è `Cannot find module` ore dopo. |
| Slug duplicati | Due tabelle che dichiarano lo stesso slug. Lo schema rifiuta la compilazione in questo caso, e questo controllo indica entrambe. |
| Integrità di `.env` | Un `JWT_SECRET` più corto di 32 caratteri (con cui l'ambiente di produzione rifiuta l'avvio) e `NODE_ENV=production` senza né `CORS_ORIGINS` né `FRONTEND_URL`. I valori non vengono mai stampati. |
| Disallineamento versioni `@rebasepro/*` | Lo stesso pacchetto bloccato a versioni diverse nei vari file `package.json` del progetto. Due copie mandano in errore l'`instanceof` tra loro, fallendo come type guard che rigetta il proprio stesso tipo. |
| Stringhe di connessione | Un `=` non codificato nel parametro di un URL, che gli strumenti nativi di PostgreSQL si rifiutano di analizzare — provocando il fallimento di backup e `psql` mentre l'applicazione continua a funzionare. |
| Funzioni personalizzate | Ciò di cui ciascuna funzione ha bisogno dal proprio host e quali di esse non verrebbero eseguite su un runtime edge. |

**Sul database** — quello del progetto, risolto nello stesso modo in cui lo risolve `rebase db url`; pertanto, su uno scaffold appena creato corrisponde al database gestito, che `doctor` provvede ad avviare:

| Controllo | Motivo |
| --- | --- |
| Tabelle → schema generato | Verifica se `schema.generated.ts` non è aggiornato. |
| Tabelle → database | Tabelle, colonne, enum, chiavi esterne e tabelle di giunzione mancanti. |
| Estensioni richieste | Una colonna `col.vector()` richiede pgvector, che Rebase installa solo se dichiarato nel progetto. |
| Stamp dello schema | Verifica se questo database è stato configurato a partire da queste tabelle. È un hash, quindi può indicare che i due non corrispondono, ma non chi sia più recente. Uno stamp `v1:` proveniente da un runtime precedente alla 0.31 viene segnalato una sola volta con il comando di aggiornamento: `rebase db push`. |
| Tabelle → tipi SDK | Verifica se l'SDK tipizzato generato non è aggiornato. |
| Criteri RLS | Verifica se i criteri del database corrispondono alla configurazione `rls` dichiarata e se qualche criterio fa riferimento a un ruolo che questo server non può utilizzare. |

Se il database non è raggiungibile, le relative fasi vengono contrassegnate come saltate con la motivazione e il resto continua a essere eseguito — consulta [Risoluzione dei problemi](/docs/troubleshooting/).

Esce con codice diverso da zero se un controllo rileva un errore o se una fase non può essere eseguita perché il database specificato rifiuta le connessioni. Una fase saltata perché non è stato possibile identificare alcun database non è considerata un fallimento.

`rebase doctor --policies` esegue solo i controlli RLS — nessun diff dello schema, nessun tipo SDK — e fallisce in modalità restrittiva (fail-closed), rendendolo il comando ideale da usare come gate di CI su un database distribuito.

`rebase doctor --database` esegue solo il preflight del database: verifica se il ruolo con cui vengono eseguite le richieste autenticate esiste, se è limitato e se può essere assunto (switch), quali altri login possono passare a tale ruolo, se ogni ruolo ha i permessi di connessione e quali tabelle, permessi (grant) e criteri Rebase condividerebbe con altri ruoli. Ogni segnalazione indica l'SQL da eseguire come amministratore, l'impostazione `rls` per adattare Rebase al database, oppure entrambi. Legge il catalogo di sistema senza modificare nulla ed esce con 1 se un risultato è un errore. Funziona anche su un progetto headless. Consulta [Esecuzione su un database esistente o condiviso](/docs/deployment/existing-database/).

### `rebase verify`

```bash
rebase verify
rebase verify --json
rebase verify --live
rebase verify --live --database-url postgresql://…
```

Verifica se le tabelle sono pronte e sicure per il rilascio, in un unico comando rapido pensato per la CI e per gli hook degli agenti IA. Funziona offline per impostazione predefinita e non modifica mai nulla.

| Fase | Cosa ne determina il fallimento |
| --- | --- |
| Definizioni delle tabelle (`schema`) | `backend/schema` non si carica o non compila tramite il loader da cui si avvia il backend: una relazione con una tabella non esportata dall'index, `rls: "inherit"` senza `defaultRls`, una tabella senza chiave primaria — una segnalazione per ogni problema. Una tabella priva di `rls` è tra questi. |
| Copertura RLS (`rls`) | Una tabella con una colonna `user_id`, `owner_id`, `organization_id` o `tenant_id` le cui regole — proprie o ereditate tramite `defaultRls` — consentono a un ruolo di leggere ogni riga indipendentemente da essa. Viene segnalato come avviso. `rls-policy-recursion`: una regola che legge la propria tabella in una sottoquery, o due tabelle le cui regole si leggono a vicenda, che Postgres rifiuta di espandere, provocando il fallimento di ogni istruzione protetta con `42P17 infinite recursion detected in policy`; la segnalazione indica la tabella letta e la soluzione, ovvero spostare la lettura in una funzione `SECURITY DEFINER`. Viene trattato come errore, oppure come avviso quando il loop non è certo. |
| Aggiornamento delle migrazioni (`migrations`) | Una tabella o colonna dichiarata nelle tabelle che nessun file in `backend/drizzle/migrations` crea, oppure una eliminata che una migrazione continua a creare. Viene saltato per i progetti che non hanno ancora migrazioni. |
| Personalizzazioni del CMS (`cms`) | Una chiamata `customizeTable(...)` in `frontend/src/cms` (o nel percorso `src/cms` di un'app statica in `rebase.json`) che non corrisponde alle tabelle, analizzata staticamente — i moduli non vengono eseguiti. `cms-unknown-table`: lo slug non corrisponde ad alcuna tabella, quindi il pannello lo ignora (viene suggerito lo slug più simile). `cms-unknown-field`: una chiave in `fields` non è né una colonna né una relazione (se viene usato il nome SQL della colonna, viene suggerita la relativa chiave). `cms-hidden-required`: un campo escluso dal form (`hiddenInForm`, `readOnly`, `disabled`) la cui colonna è `NOT NULL` senza valore predefinito e senza valorizzazione da parte del server, per cui la creazione di un record dal pannello fallisce sempre; è un avviso quando un hook `beforeSave` o una trasformazione potrebbe valorizzarlo, e viene silenziato da `filledByServer`. `cms-duplicate-customization`: uno slug personalizzato due volte. `cms-not-static` (avviso): una chiamata i cui slug, opzioni o `fields` non sono valori letterali o una costante (`const`) nello stesso file, per cui nessun controllo ha potuto verificare il contenuto. `cms-ui-config-not-mounted` (avviso): `frontend/src/cms/ui-config.json` esiste ma non viene passato a `<RebaseCMS>` come `uiConfig`. `cms-backend-guard-missing`: la configurazione Vite del frontend non utilizza `rebaseBackendGuard()`, pertanto `rebase build` la rifiuterebbe. Un progetto headless non ha `frontend/src/cms` e salta questo passaggio. |
| Audit RLS in tempo reale (`live`) | Con `--live`: esegue il catalogo [`rls-check`](/docs/rls-check) sul database del progetto e verifica se tutte le migrazioni sono state applicate. Il database viene risolto come fanno i comandi `db` — `--database-url`, `DATABASE_URL`, `--docker`, altrimenti il database di sviluppo gestito. Un database non configurato o che non risponde è considerato un errore, non un passaggio saltato, poiché l'audit è stato richiesto esplicitamente. Un criterio di lettura `USING (true)` compilato a partire da una regola `access: "public"` genera un avviso finché l'API richiede un token (`AUTH_REQUIRE`, abilitato per impostazione predefinita) — ogni utente autenticato può leggere tutte le righe — e un errore con `AUTH_REQUIRE=false`, dove le righe risultano accessibili anonimamente. |

`--json` stampa un unico oggetto, `{ ok, schemaDir, steps, findings, summary }`: ogni step è `{ id, title, status, detail? }` (`status` è `passed`, `failed`, `warnings` o `skipped`), e ogni segnalazione contiene `step`, `check` (un identificativo stabile in kebab-case), `severity`, `message` e, ove applicabile, `fix`, `table`, `file`, `line` e il percorso con notazione a punti `path` all'interno della tabella (`posts.rls[0]`) — in modo che un agente possa correggere ciò che ha compromesso. `summary` conta `errors` e `warnings`. `--quiet` non stampa nulla se tutti i controlli hanno esito positivo. Esce con codice diverso da zero in caso di errore; i warning non provocano il fallimento.

Un progetto generato tramite scaffold lo esegue automaticamente per Claude Code dopo ogni modifica in `backend/schema/`: vedi [`rebase skills install`](#rebase-skills-install).

### Comandi per un'app in esecuzione

`rebase api`, `rebase data`, `rebase users`, `rebase cron`, `rebase logs`, `rebase functions`, `rebase rls simulate`, `rebase auth login` e `rebase storage ls|cp|rm|url|stat` agiscono su un'app in esecuzione tramite la sua API: l'istanza locale `rebase dev`, un server specificato con `--url` o un progetto Rebase Cloud con `--project`. Consulta [Un'applicazione in esecuzione](/docs/cli/project/).

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

`--scopes` specifica cosa la chiave può fare, separato da virgole o ripetuto; `--full-access` le assegna tutti gli ambiti (scopes) posseduti dalla chiave di servizio, eccetto `keys:*`. `--roles` aggiunge ruoli RLS oltre a `service`, `--expires-in` accetta i giorni ed `--expires-at` una data ISO. `rebase api-keys scopes` elenca tutti gli ambiti noti al backend. Una chiave viene mostrata una sola volta. Vengono applicati sia gli ambiti della chiave sia la sicurezza a livello di riga (RLS) dell'identità con cui opera. Consulta [Chiavi API](/docs/backend/api-keys/).

### `rebase storage`

Manutenzione globale dei file archiviati nello store, tramite il backend in esecuzione con `REBASE_SERVICE_KEY` letto da `.env`:

```bash
rebase storage orphans                         # files no row names
rebase storage orphans --source media --delete # and delete them, after asking
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` legge ogni riga di ogni tabella così come memorizzata (incluse le righe eliminate tramite soft-delete, oltrepassando qualsiasi hook `beforeQuery` e `afterRead`) e ogni voce di [cronologia](/docs/backend/history/), poiché un ripristino recupera quanto vi era contenuto. Elenca i file di una determinata sorgente (`--source`, la sorgente predefinita se omessa) che nessuna stringa all'interno di essi menziona: una chiave, un URL o un riferimento `rebase-storage:` all'interno di un testo. I file più recenti di `--older-than` ore (24 per impostazione predefinita) vengono esclusi, poiché il pannello di amministrazione carica un file prima che la riga che lo referenzia sia salvata. La scansione viene eseguita in background sul backend, quindi anche un progetto troppo grande per essere scansionato all'interno di una singola richiesta (dietro un ingress che andrebbe in timeout) viene comunque completato. La CLI avvia la scansione e mostra il suo avanzamento (file elencati, righe lette, tabelle completate ed eventuali non leggibili) fino al completamento. Con la [coda dei job](/docs/backend/jobs/) attiva, la scansione è un job `storage.orphans` eseguito dai worker dei job. Senza di essa, la scansione viene eseguita all'interno del processo del server a cui è stata richiesta, e la CLI lo segnala: il riavvio di tale processo interrompe la scansione. Una scansione corrisponde a un tentativo di job, limitato da `jobs.timeoutMs` (15 minuti per impostazione predefinita). Aumentalo o impostalo a 0 per una sorgente che richiede più tempo. `--json` stampa lo stesso report precedente, con in più il suo `scanId`.

`--delete` chiede conferma prima di eliminare (`--yes` salta la domanda ed è obbligatorio in assenza di terminale). Elimina solo i file derivanti dalla scansione appena stampata ed esclusivamente entro 15 minuti dal completamento della stessa. Non viene eliminato nulla se una tabella non può essere letta: una tabella con hook di lettura su un database il cui driver non può oltrepassarli viene considerata non letta. Prima di eliminare qualsiasi elemento, il server rilegge ogni riga e voce di cronologia confrontandole con i file elencati. Successivamente verifica nuovamente ciascun file subito prima di eliminarlo. Un file a cui fa riferimento una riga ora, che è stato caricato nuovamente dopo la scansione o che non esiste più viene mantenuto, e la CLI lo elenca come mantenuto. I file a cui fanno riferimento esclusivamente tabelle non servite da Rebase appariranno come inutilizzati: verifica attentamente prima di eliminare. Su un backend versione 0.25.1 o precedente, la CLI esegue la scansione secondo la modalità precedente, all'interno di una singola richiesta.

`move` copia i file sotto `--prefix` in un'altra sorgente mantenendo le stesse chiavi, una pagina alla volta. Un file che la destinazione possiede già con la medesima dimensione viene saltato, consentendo di riprendere uno spostamento interrotto eseguendolo di nuovo; `--delete-source` cancella ogni file dalla sorgente una volta che la destinazione lo ha ricevuto, e viene rifiutato quando le due sorgenti puntano allo stesso bucket o alla stessa directory. Una volta completato lo spostamento, la CLI esamina nuovamente la sorgente con una scansione aggiornata ed elenca ogni file che lo spostamento non ha trasferito: con `--delete-source`, qualsiasi file ancora presente nella sorgente; senza di esso, qualsiasi file di cui la destinazione non possiede una copia di uguale dimensione. Esce con codice 1 se ne è presente qualcuno, e una nuova esecuzione dello stesso comando ne riprende il trasferimento. `--json` li restituisce come `notMoved`. La lettura del report di scansione richiede `database:read`. L'avvio di una scansione, l'eliminazione e lo spostamento richiedono `database:write`, concesso dalla chiave di servizio.

### `rebase skills install`

Installa le skill di riferimento di Rebase per i tuoi assistenti di coding basati su IA — tutti i `--agent` sopra indicati:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
rebase skills --hooks
```

Consulta [Skill degli agenti](/docs/ai/skills) per l'elenco completo e le directory di destinazione dei file.

`--hooks` installa il guardrail per Claude Code che `rebase init` include in ogni progetto: `.claude/hooks/post-edit-collection.sh`, registrato come hook `PostToolUse` in `.claude/settings.json`, che esegue `rebase verify --quiet` dopo ogni modifica in `backend/schema/` o `frontend/src/cms/` e restituisce qualsiasi problema all'agente. Le impostazioni e gli hook esistenti vengono mantenuti. `rebase skills --hooks` installa esclusivamente l'hook.

### `rebase telemetry`

Condivisione anonima dei dati di utilizzo, disattivata finché non dai il consenso. Una sessione interattiva di `rebase init` lo chiede al termine, con risposta predefinita impostata su no, per cui nulla viene condiviso a meno che tu non risponda affermativamente. La risposta è memorizzata a livello di macchina (`~/.rebase/telemetry.json`): dopo un sì, `init` non lo chiederà più; dopo un no, il successivo `init` lo richiederà. Ogni checkout riceve un ID progetto casuale, conservato nel file ignorato da git `.rebase/telemetry-project.json`.

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` stampa l'impostazione corrente, `show` stampa esattamente ciò che verrebbe inviato — indipendentemente dal fatto che la condivisione sia attiva o meno, consentendoti di esaminare il payload prima di decidere — e gli altri due ne modificano lo stato. Se non hai mai eseguito `init`, non è mai stato raccolto nulla.

## Prossimi passi

- **[Generazione dello schema](/docs/cli/schema/#production-workflow)** — Il flusso di lavoro delle migrazioni, dalla modifica di una tabella alla produzione
- **[Schema as Code](/docs/architecture/schema-as-code)** — Come funziona la generazione dello schema
- **[Guida rapida](/docs/getting-started/quickstart)** — Per iniziare
