---
sourceHash: 4afe718897048683
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

`--json` è l'opzione principale e, al di fuori della famiglia `cloud`, è l'unica: `rebase status`, `rebase resources`, `rebase apps list`, `rebase upgrade` e `rebase verify` restituiscono un singolo valore JSON su stdout — il risultato, oppure un envelope `{"error": {"message", "code", "hint", "issues"}}` con un'uscita diversa da zero — a **ogni** terminazione del comando, in modo che il chiamante possa analizzare stdout incondizionatamente. Senza di essa, i comandi scrivono testo leggibile dall'uomo e gli errori finiscono su stderr. `rebase cloud` usa lo stesso envelope ed è l'unica eccezione al selettore: attiva il JSON automaticamente anche quando stdout non è un TTY, o quando è impostato `REBASE_JSON=1`. Quindi `rebase cloud status | cat` produce JSON mentre `rebase status | cat` no — all'interno di uno script, passa `--json` esplicitamente anziché affidarti a queste regole.

## Comandi

### `rebase init`

Inizializza un nuovo progetto Rebase:

```bash
rebase init [directory]
```

Configura un `backend/` (le tabelle in `backend/schema/`) e un `frontend/` (il pannello di amministrazione, con le personalizzazioni delle tabelle in `frontend/src/cms/`); `--headless` crea lo scaffold del solo `backend/`, senza `backend/schema/`. La pagina [Project structure](/docs/getting-started/project-structure/) mostra entrambi gli alberi.

| Flag | Cosa fa |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` o `blank`. Predefinito `blog` |
| `--headless` | Solo backend — nessun pannello di amministrazione e nessun `backend/schema/`: il server serve le tabelle del database. `--template` non ha effetto, poiché non ci sono tabelle da popolare |
| `-y, --yes` | Non chiede mai conferma. **Richiesto ovunque non sia presente un terminale per rispondere**, come in CI. Salta git init e l'installazione delle dipendenze — le opzioni interattive predefinite impostano sì a entrambi, quindi passa `--git` / `--install` se li desideri |
| `-i, --install` | Installa le dipendenze dopo lo scaffolding. Senza questo flag, init chiede conferma (predefinito sì); con `--yes`, non viene installato nulla |
| `--no-install` | Non installa nulla e non chiede conferma |
| `-g, --git` | Inizializza un repository ed esegue il primo commit. Senza questo flag, init chiede conferma (predefinito sì); con `--yes`, nessun repository |
| `--database-url <url>` | Usa un database esistente anziché quello gestito. Deve essere un URL `postgres://` o `postgresql://`: qualsiasi altro valore viene rifiutato prima di scrivere qualsiasi file, e il prompt interattivo lo richiederà di nuovo |
| `--introspect` | Genera `backend/schema` da quel database. Implica `--template blank` e richiede `--install` |
| `--project <slug>` | Collega lo scaffold a un progetto Rebase Cloud |
| `--setup-key <key>` | La chiave monouso per autenticare tale collegamento |
| `-a, --agent <name>` | Configura gli agenti di programmazione AI: le [skills](/docs/ai/skills) e il [server MCP](/docs/ai/mcp). Ripetibile o separato da virgole — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` o `all`. Senza questo flag, `init` lo chiede e seleziona preventivamente gli agenti installati sulla macchina; con `--yes`, nessuno |

### `rebase dev`

Avvia il server di sviluppo:

```bash
rebase dev
```

Avvia sia il frontend che il backend con hot reloading, e rigenera lo schema Drizzle e i tipi dell'SDK (`generated/sdk/`) all'avvio e a ogni salvataggio all'interno di `backend/schema/`.

Entrambe le porte sono derivate dal percorso del progetto, consentendo l'esecuzione affiancata di più progetti Rebase. Usa gli URL stampati da `rebase dev`. Fissane una con `rebase dev --port 3001`.

Un'app statica in `rebase.json` senza fase di build (nessun `build`, e `output` corrisponde al suo `root`, come un semplice sito HTML) viene servita dal backend da quella directory, al suo `path`, così come `rebase start` la serve dal bundle, e `FRONTEND_URL` viene impostato su di essa (sulla porta del backend) in modo che i link inviati via email puntino lì.
Vengono serviti anche i suoi [`redirects` e `cleanUrls`](/docs/architecture/redirects-and-clean-urls/), e un'app che dichiara reindirizzamenti non ha bisogno di un file `index.html`.
Un'app con una fase di build viene eseguita in Vite sulla propria porta, e `FRONTEND_URL` corrisponde a quella di Vite.

Una modifica a `.env` riavvia il backend, che rilegge il file, come fa il pannello di amministrazione. Ciò che `rebase dev` imposta autonomamente viene mantenuto fino al riavvio: `PORT` e `DATABASE_URL` quando si trova sul database gestito o su Docker.

Con `--database-url`, `rebase dev` verifica prima che qualcosa risponda a quell'host e a quella porta. Se nulla risponde, lo segnala menzionando il flag ed esce con `1` senza avviare nulla; inoltre, lascia invariati i nomi del database in `.env`, senza mai avviare il relativo container compose.

### `rebase build`

Compila il progetto in un bundle distribuibile in `dist-bundle/`:

```bash
rebase build
```

Il bundle è l'artefatto da distribuire — l'immagine di runtime lo carica, quindi non è necessario compilare un'immagine dell'applicazione. Flag utili:

| Flag | Effetto |
|------|--------|
| `--output <dir>` (o `--out`) | Scrive il bundle in una posizione diversa da `dist-bundle/` (un'app alla volta) |
| `--vendor` | Installa e include sempre le dipendenze del bundle nel vendor |
| `--no-vendor` | Non include mai le dipendenze nel vendor; il pod le installa a ogni avvio |
| `--skip-type-check` | Salta il controllo dei tipi (più veloce, meno sicuro) |
| `--no-static` | Non include il frontend nel bundle del backend (ogni app statica riceve comunque il proprio bundle) |
| `--skip-static-build` | Include il frontend come già compilato, senza eseguire il relativo comando di build |

Un frontend — ogni app statica di `rebase.json` con una configurazione Vite — la cui configurazione non utilizza `rebaseBackendGuard()` (da `@rebasepro/app/vitePlugin`) viene rifiutato: è ciò che impedisce al codice del server di finire nel bundle del browser e impedisce a Vite di incorporare un file del backend come URL `data:` (interrompe la build con errore, menzionando se stesso, quando un altro plugin sostituisce il suo `build.assetsInlineLimit`). `frontend/src/cms/ui-config.json` viene integrato nel bundle come `entry.uiConfig`, la presentazione del workspace servita da un backend distribuito.

Le dipendenze vengono incluse nel vendor per impostazione predefinita in modo che una nuova istanza non debba sostenere un'installazione di 35–55 secondi. Un albero che supera i 2 GB su disco viene invece scartato, poiché il limite di caricamento è di 1 GB compresso.

Ogni app statica inclusa nel bundle riceve una copia brotli (`.br`) e una gzip (`.gz`) accanto a ciascun asset con hash nel contenuto pari o superiore a 1 KB — i file che un browser memorizza nella cache per un anno. Il runtime invia quella accettata dal browser, in modo che tali file non comportino alcun carico di compressione per richiesta, inclusa la prima visita dopo un deploy, e i browser che accettano brotli la ricevono (circa l'11% più piccola di gzip sul JavaScript dell'admin). L'output di compilazione effettivo del frontend viene lasciato invariato; cambia solo la copia nel bundle. Sull'app di esempio, ciò aggiunge meno di un secondo alla build e circa 2,4 MB al bundle.

### `rebase upgrade`

Aggiorna ogni pacchetto `@rebasepro/*` fissato dal progetto a una singola release, quindi installa con il gestore di pacchetti indicato dal relativo lockfile. `rebase upgrade` seleziona l'ultima versione; `--to 0.21.0` una versione esatta, senza consultare il registro; `--to canary` un dist-tag. Ogni dipendenza fissata in `dependencies`, `devDependencies` e `optionalDependencies`, in ogni `package.json` del progetto, mantiene il proprio `^` o `~`, e nient'altro nel file viene modificato. `peerDependencies` e le specifiche `workspace:`, `link:`, `file:`, git e i tag vengono elencati e lasciati invariati. Vengono aggiornati anche gli override in `pnpm-workspace.yaml` e `package.json`, ma un override `link:` o `file:` ha la precedenza su qualsiasi versione fissata: viene segnalato e `--drop-local-overrides` lo rimuove. `--dry-run` non scrive nulla, `--no-install` salta l'installazione e `--json` stampa un singolo documento.

Un progetto su una versione preliminare (prerelease), come canary, rimane sul proprio canale a meno che `latest` non sia più recente. Un dist-tag che porterebbe una versione fissata a una versione precedente viene rifiutato (`downgrade_refused` con `--json`) a meno che non si passi `--allow-downgrade`; un valore esatto per `--to` viene applicato e contrassegnato come downgrade. Un'esecuzione `--dry-run` di un aggiornamento che la versione reale rifiuterebbe mostra cosa verrebbe spostato ed esce con 0, e con `--json` il documento include il rifiuto come `wouldRefuse` (`{ code, message, hint }`). Una volta installato, aggiorna anche le [skill dell'agente](/docs/ai/skills/#updating-the-skills) del progetto dalla nuova CLI (`skills` nel documento `--json`). Gli altri comandi terminano con una riga su stderr quando è disponibile una nuova release; [`REBASE_NO_UPDATE_CHECK=1`](/docs/getting-started/configuration/) la nasconde.

### `rebase start`

Esegue il bundle compilato nello stesso modo in cui viene eseguito in fase di deployment:

```bash
rebase start
```

Legge `PORT` e il resto di `.env`, a differenza di `rebase dev`, nel `NODE_ENV` configurato. Uno scaffold genera un `.env` impostato su `development`, quindi il primo account registrato diventa comunque l'amministratore, e `rebase start` lo indica chiaramente all'inizio; imposta `NODE_ENV=production` per un server di produzione. `rebase start --bundle ./dist-bundle` esegue un bundle presente altrove.

`rebase start` non avvia alcun database e il file `.env` dello scaffold non contiene `DATABASE_URL`, quindi un'esecuzione locale sul database usato da `rebase dev` si effettua con `DATABASE_URL="$(rebase db url)" rebase start`. In assenza di questo valore, stampa tale riga prima dell'avvio.

### `rebase apps list`

Mostra le app dichiarate da questo repository:

```bash
rebase apps list
```

Un repository può dichiarare più di un'app distribuibile — ad esempio un backend e un sito di marketing. In questo modo puoi verificare su cosa agiranno `rebase build` e il deployment.

### `rebase eject`

Prendi il controllo del processo del server e della sua immagine:

```bash
rebase eject
```

Scrive l'entrypoint del backend e un `Dockerfile` nel progetto e converte il backend, in modo che il repository compili la propria immagine invece di eseguire il runtime pubblicato. Da quel momento in poi **gli aggiornamenti del runtime della piattaforma non si applicheranno più**, e la configurazione di CORS, autenticazione, storage e arresto (shutdown) sarà interamente a tuo carico.

Visualizza l'anteprima con `rebase eject --dry-run`, che elenca le modifiche senza applicare nulla. `--force` sostituisce un file `backend/src/index.ts` o `env.ts` esistente, conservando il file corrente come `<name>.bak`.

Il server espulso (ejected) mantiene gli upload locali nella directory `uploads/` del progetto, sia eseguito dai sorgenti che compilato, esattamente come fa `rebase dev`. Viene eseguito in `backend/`, quindi un percorso `STORAGE_PATH` relativo viene letto a partire da `backend/`.

### `rebase schema generate` / `rebase schema stale`

```bash
rebase schema generate       # backend/schema → backend/src/schema.generated.ts
rebase schema stale          # name what differs from the tables, exit 1 if anything does
rebase schema stale --fix    # regenerate the file instead
```

Ogni comando che legge lo schema accetta `--schema-dir <dir>` per i progetti che lo posizionano altrove; `--collections` è stato rimosso. `rebase dev` mantiene il file aggiornato, quindi `stale` è il controllo ideale per una build o la CI. Consulta [Generazione dello schema](/docs/cli/schema/).

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

Ciascuno di essi è descritto in [Comandi del database](/docs/cli/database/), insieme all'ordine di risoluzione del database da parte dei comandi; `push`, `generate` e `migrate` sono trattati in dettaglio in [Generazione dello schema](/docs/cli/schema/).

### `rebase console`

Un REPL di Node con i dati del progetto accessibili, o un singolo snippet eseguito con `-e`:

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) e `tables` (le tabelle del progetto, caricate da `backend/schema`) sono nello scope, e l'`await` a livello principale (top-level) funziona. Il database viene risolto nello stesso modo di `rebase db push`, e l'apertura della console non vi apporta alcuna modifica. Con `-e`, il risultato atteso viene stampato come JSON su stdout e un'eccezione non gestita (throw) termina con codice `1`. Flag: `--eval`/`-e`, `--schema-dir`, `--database-url`, `--docker`. Consulta [Script e console](/docs/backend/scripts/).

### `rebase migrate`

Migrazioni unidirezionali da una struttura che questa versione non supporta più: `rebase migrate collections-to-tables` (`config/collections` → `backend/schema` e `frontend/src/cms`) e `rebase migrate sdk-calls` (`data.collection("x")` → `data.table("x")` nel tuo codice). I relativi flag, ciò che scrivono e la sezione "Review before deploying" sono disponibili in [Generazione dello schema](/docs/cli/schema/#rebase-migrate).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init             # write a rebase.json inferred from this project
rebase apps config <app>     # the client configuration for one app
```

`apps init` non accetta nomi: deduce ogni app dal progetto e scrive l'intero `rebase.json`, rifiutando di sostituirne uno esistente a meno che non si passi `--force`.

Un argomento con il nome viene rifiutato. `--force` mantiene ciò che il rilevamento automatico non può ricavare dal file sostituito: il nome di ciascuna app, il suo `path` e la sua route `cms`. Tutto il resto viene dedotto nuovamente, e un'app dichiarata che non viene più trovata viene indicata come rimossa; pertanto, su uno scaffold riscrive il `rebase.json` originale fornito dallo scaffold. Il comando di build dell'app statica utilizza il gestore di pacchetti del progetto.

Per un checkout non collegato a un progetto Cloud, `apps config` indica che non è collegato, indipendentemente dal fatto che `rebase dev` sia in esecuzione o meno, e fornisce l'URL del backend così come servito da `rebase dev`.

### `rebase apps add admin`

```bash
rebase apps add admin                  # at /, or at /admin when another app is at /
rebase apps add admin --path /console  # anywhere else, or an https URL of its own
```

Aggiunge il pannello di amministrazione a un progetto headless o importato, nello stesso modo in cui lo avrebbe generato `rebase init`. Cosa scrive, quale versione fissa e in quali casi rifiuta l'operazione: [Aggiungere un pannello di amministrazione in seguito](/docs/getting-started/headless/#adding-an-admin-panel-later).

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

Tre file decidono cosa un backend può raggiungere, e questo comando li stampa tutti e tre insieme: `rebase.json` indica dove si trova il codice e chi esegue il server, `backend/resources.ts` descrive ciò di cui il progetto ha bisogno e l'ambiente indica come raggiungere ogni elemento. Tutto il resto — `rebase.resources.json`, il manifest del bundle — viene generato da quest'ultimo per i lettori che non possono eseguire il codice, e non deve mai essere scritto manualmente.

Uno stato `○` rappresenta la condizione utile da conoscere prima di un deploy piuttosto che dopo: dichiarato, non configurato. Una `✗` indica che l'ambiente imposta qualcosa in modo *errato*, impedendo l'avvio anziché funzionare in modalità degradata.

Un `rebase.resources.json` che non corrisponde più alle dichiarazioni riceve una riga `○`. Uno che non è ancora stato scritto non la riceve: `rebase build` lo scrive a ogni compilazione, quindi un progetto che non è mai stato compilato, come un nuovo scaffold, non ha nulla da correggere.

### `rebase resources`

Ciò di cui questo progetto dichiara di aver bisogno — i database, i bucket, i topic e le code richiesti da `backend/resources.ts`, nonché i cron e le funzioni definiti dai suoi file:

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` è il flag utilizzato da un job di CI per fallire su un `rebase.resources.json` che non corrisponde più a `backend/resources.ts`.
`--json` può essere combinato con esso: in caso di disallineamento (drift), `rebase resources --check --json` termina con codice 1 restituendo un envelope di errore (`resource_graph_missing` o `resource_graph_stale`), mentre in caso di successo il grafo riporta `check.status`. `--write --json` scrive il file e segnala `written.changed`.

Una risorsa viene dichiarata in `backend/resources.ts` — `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` — o è un file posizionato in `backend/crons` o `backend/functions`, e non viene mai scritta a mano in `rebase.resources.json`, che viene generato a partire da tali dichiarazioni per consentire a un host di leggere ciò di cui un progetto ha bisogno senza compilarlo. Ogni voce registra chi la utilizza (`table:events`, `column:posts.cover`, `function:report`).

Un backend possiede anche un database predefinito e una sorgente di storage predefinita che nessuno dichiara esplicitamente. Entrambi sono elencati qui, contrassegnati come `implicit`, e nessuno dei due viene scritto in `rebase.resources.json` — l'host li fornisce direttamente, pertanto registrarli significherebbe richiedere il provisioning di qualcosa che nessuno ha richiesto.
Dichiararne uno con nome, come `bucket("media")`, lascia invariato quello predefinito, quindi entrambi vengono elencati. Solo la dichiarazione esplicita del predefinito, o l'impostazione di un bucket con `default: true`, lo sostituisce.

Per verificare ciò che la piattaforma gestisce per un progetto rispetto a quanto dichiarato dal relativo codice, e per rimuovere un database fornito che il codice non menziona più, consulta [`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` — ogni comando per Rebase Cloud: autenticazione, collegamento al progetto, deploy, configurazione, database, risorse, compute e altro — ha [la propria pagina dedicata](/docs/cli/cloud).

### `rebase generate-sdk`

```bash
rebase generate-sdk
```

Genera un client tipizzato per le tabelle esportate da `backend/schema/index.ts` in `generated/sdk/`, con `TableName` e `tablesDictionary`; `--from <link|url>` legge invece il contratto di un backend in esecuzione. `--register` tipizza anche i dati lato server: scrive i tipi e la dichiarazione `Register` in `backend/generated/` e li memorizza in `rebase.json` (`registerDatabase`).
Consulta [Dati tipizzati lato server](/docs/backend/typed-server-data) e [Generazione dello schema](/docs/cli/schema/#rebase-generate-sdk).

### `rebase doctor`

```bash
rebase doctor
```

Il comando da eseguire quando qualcosa non funziona e non sai ancora di cosa si tratti. Esegue diagnosi e non modifica mai nulla, rendendone sicuro l'uso con qualsiasi database raggiungibile.

**Senza un database.** Questi controlli vengono eseguiti per primi, poiché tutto ciò che impedisce a un progetto di funzionare si verifica prima ancora che sia possibile confrontare una tabella:

| Controllo | Motivo |
| --- | --- |
| Versione di Node | Confrontata con l'intervallo dichiarato dalla CLI. Una versione troppo vecchia non viene segnalata come "Node non supportato", ma come errore di sintassi all'interno di una dipendenza. |
| Gestori di pacchetti | Due lockfile in un singolo progetto. Eseguire `npm install` in un workspace pnpm riscrive `node_modules` con una struttura incompatibile con pnpm, manifestando l'errore `Cannot find module` a distanza di ore. |
| Slug duplicati | Due tabelle che dichiarano lo stesso slug. Lo schema non si compila e il comando elenca entrambi. |
| Integrità di `.env` | Un `JWT_SECRET` inferiore a 32 caratteri (che la produzione rifiuta all'avvio) e `NODE_ENV=production` senza `CORS_ORIGINS` né `FRONTEND_URL`. I valori non vengono mai stampati. |
| Disallineamento versioni `@rebasepro/*` | Lo stesso pacchetto fissato a versioni diverse tra i vari file `package.json` del progetto. Due copie causano il malfunzionamento di `instanceof` tra loro, fallendo come guardie di tipo che rifiutano il proprio stesso tipo. |
| Stringhe di connessione | Un `=` non codificato nel parametro di un URL, che gli strumenti nativi di PostgreSQL si rifiutano di analizzare, compromettendo i backup e `psql` mentre l'applicazione continua a funzionare. |
| Funzioni personalizzate | Ciò di cui ogni funzione ha bisogno dal proprio host e quali di esse non potrebbero essere eseguite su un runtime edge. |

**Confronto con il database** — quello del progetto, risolto nello stesso modo in cui lo risolve `rebase db url`, quindi su un nuovo scaffold corrisponde al database gestito, che `doctor` provvede ad avviare:

| Controllo | Motivo |
| --- | --- |
| Tabelle → schema generato | Verifica se `schema.generated.ts` è obsoleto. |
| Tabelle → database | Tabelle, colonne, enum, foreign key e tabelle di giunzione mancanti. |
| Estensioni richieste | Una colonna `col.vector()` richiede pgvector, che Rebase installa solo se dichiarato dal progetto. |
| Schema stamp | Verifica se questo database è stato sottoposto a provisioning a partire da queste tabelle. È un hash, quindi può rilevare che i due differiscono ma non quale sia più avanti. Un timbro `v1:` proveniente da un runtime precedente alla versione 0.31 viene segnalato una volta, con il comando per rigenerarlo: `rebase db push`. |
| Tabelle → tipi SDK | Verifica se l'SDK tipizzato generato è obsoleto. |
| Criteri RLS | Verifica se i criteri del database corrispondono alla configurazione `rls` dichiarata e se qualche criterio fa riferimento a un ruolo che questo server non può utilizzare. |

Se il database non è raggiungibile, le relative fasi vengono segnalate come saltate con il relativo motivo e il resto dei controlli viene comunque eseguito — consulta [Risoluzione dei problemi](/docs/troubleshooting/).

Termina con codice diverso da zero quando un controllo rileva un errore o quando una fase non può essere eseguita perché il database specificato rifiuta le connessioni. Una fase saltata per impossibilità di risolvere un database non costituisce un errore.

`rebase doctor --policies` esegue solo i controlli RLS — nessun diff dello schema, nessun tipo SDK — e adotta una modalità restrittiva (fail closed), rendendolo ideale come controllo di verifica (gate) in CI rispetto a un database distribuito.

`rebase doctor --database` esegue solo il preflight del database: verifica se il ruolo con cui vengono eseguite le richieste autenticate esiste, è limitato e accessibile, quali altri login possono passare ad esso, se tutti i ruoli possono connettersi e quali tabelle, permessi e criteri Rebase condividerebbe con altri ruoli. Ogni risultato indica il comando SQL da eseguire come amministratore, l'impostazione `rls` per adattare Rebase al database, o entrambi. Legge il catalogo senza modificare nulla ed esce con 1 quando un risultato è un errore. Funziona anche su progetti headless. Consulta [Esecuzione su un database esistente o condiviso](/docs/deployment/existing-database/).

### `rebase verify`

```bash
rebase verify
rebase verify --json
rebase verify --live
rebase verify --live --database-url postgresql://…
```

Verifica se le tabelle sono pronte per il rilascio, in un unico comando rapido pensato per la CI e per gli hook di un agente AI. Offline per impostazione predefinita, non modifica mai nulla.

| Passaggio | Cosa ne determina il fallimento |
| --- | --- |
| Definizioni delle tabelle (`schema`) | `backend/schema` non si carica o non si compila tramite il loader da cui si avvia il backend: una relazione verso una tabella non esportata dall'index, `rls: "inherit"` senza `defaultRls`, una tabella senza chiave primaria — una segnalazione per ogni problema. Anche una tabella priva di `rls` è tra questi. |
| Copertura RLS (`rls`) | Una tabella con una colonna `user_id`, `owner_id`, `organization_id` o `tenant_id` le cui regole — proprie o ereditate tramite `defaultRls` — consentono a un ruolo di leggere ogni riga indipendentemente da essa. Viene segnalato un avviso. `rls-policy-recursion`: una regola che legge la propria stessa tabella in una sottoquery, o due tabelle le cui regole si leggono a vicenda, che Postgres rifiuta di espandere, provocando il fallimento di ogni istruzione da esse protetta con `42P17 infinite recursion detected in policy`; la segnalazione indica la tabella letta e la correzione, spostando la lettura in una funzione `SECURITY DEFINER`. Viene restituito un errore, oppure un avviso quando il ciclo non è certo. |
| Aggiornamento delle migrazioni (`migrations`) | Una tabella o colonna dichiarata nelle tabelle che nessun file in `backend/drizzle/migrations` crea, oppure una eliminata che una migrazione continua a creare. Viene saltato per progetti senza ancora alcuna migrazione. |
| Personalizzazioni CMS (`cms`) | Una chiamata `customizeTable(...)` in `frontend/src/cms` (o in `src/cms` di un'app statica in `rebase.json`) che non corrisponde alle tabelle, analizzata staticamente — i moduli non vengono eseguiti. `cms-unknown-table`: lo slug non corrisponde ad alcuna tabella, quindi il pannello la ignora (viene suggerito lo slug più vicino). `cms-unknown-field`: una chiave sotto `fields` non è né una colonna né una relazione (il nome SQL di una colonna viene indicato insieme alla relativa chiave). `cms-hidden-required`: un campo escluso dal form (`hiddenInForm`, `readOnly`, `disabled`) la cui colonna è `NOT NULL` senza valore predefinito e non gestita dal server, rendendo sempre fallimentare la creazione di un record dal pannello; è un avviso quando un hook `beforeSave` o una trasformazione potrebbero compilarlo, e viene silenziato da `filledByServer`. `cms-duplicate-customization`: uno stesso slug personalizzato due volte. `cms-not-static` (avviso): una chiamata il cui slug, opzioni o `fields` non sono valori letterali o `const` nello stesso file, impedendo la verifica dei contenuti. `cms-ui-config-not-mounted` (avviso): `frontend/src/cms/ui-config.json` esiste ma non viene passato a `<RebaseCMS>` come `uiConfig`. `cms-backend-guard-missing`: la configurazione Vite del frontend non usa `rebaseBackendGuard()`, pertanto `rebase build` la rifiuterebbe. Un progetto headless non possiede `frontend/src/cms` e salta questo passaggio. |
| Audit RLS live (`live`) | Con `--live`: esegue il catalogo [`rls-check`](/docs/rls-check) rispetto al database del progetto e verifica che ogni migrazione sia stata applicata. Il database viene risolto nello stesso modo dei comandi `db` — `--database-url`, `DATABASE_URL`, `--docker`, altrimenti il database di sviluppo gestito. Un database non configurato o che non risponde costituisce un errore, non un passaggio saltato: l'audit è stato richiesto esplicitamente. Un criterio di lettura `USING (true)` compilato a partire da una regola `access: "public"` è un avviso finché l'API richiede un token (`AUTH_REQUIRE`, attivo per impostazione predefinita) — ogni utente autenticato legge ogni riga — e un errore con `AUTH_REQUIRE=false`, dove le righe risultano accessibili anonimamente. |

`--json` stampa un singolo oggetto, `{ ok, schemaDir, steps, findings, summary }`:
ciascun passaggio è strutturato come `{ id, title, status, detail? }` (`status` può essere `passed`, `failed`, `warnings` o `skipped`), e ogni segnalazione include `step`, `check` (un tipo stabile in kebab-case), `severity`, `message`, e quando applicabile `fix`, `table`, `file`, `line` e il `path` con notazione a punti nella tabella (`posts.rls[0]`) — consentendo a un agente di riparare quanto interrotto. `summary` calcola il totale di `errors` e `warnings`. `--quiet` non stampa nulla quando tutti i controlli vengono superati. Termina con un codice diverso da zero in caso di errore; i soli avvisi non ne determinano il fallimento.

Un progetto creato tramite scaffold lo esegue automaticamente per Claude Code dopo ogni modifica in `backend/schema/`: consulta [`rebase skills install`](#rebase-skills-install).

### Comandi per un'app in esecuzione

`rebase api`, `rebase data`, `rebase users`, `rebase cron`, `rebase logs`, `rebase functions`, `rebase rls simulate`, `rebase auth login` e `rebase storage ls|cp|rm|url|stat` agiscono su un'applicazione in esecuzione tramite la relativa API: l'istanza locale di `rebase dev`, un server specificato con `--url`, o un progetto Rebase Cloud tramite `--project`. Consulta [Un'applicazione in esecuzione](/docs/cli/project/).

### `rebase auth`

Comandi di gestione dell'autenticazione:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gestisce le chiavi API di servizio del progetto — le credenziali utilizzate da un agente, uno script o un altro servizio, a differenza della sessione di un utente finale:

```bash
rebase api-keys list
rebase api-keys get abc123-def456
rebase api-keys create --name "Blog CI" --scopes data:read:posts,data:write:posts --expires-in 90
rebase api-keys create --name "Ops" --full-access --roles admin --expires-at 2027-01-31
rebase api-keys revoke abc123-def456
```

`--scopes` specifica cosa la chiave può fare, come elenco separato da virgole o ripetuto; `--full-access` le assegna tutti gli ambiti (scopes) detenuti dalla chiave di servizio ad eccezione di `keys:*`. `--roles` aggiunge ruoli RLS accanto a `service`, `--expires-in` accetta giorni ed `--expires-at` una data ISO. `rebase api-keys scopes` elenca tutti gli ambiti noti al backend. Una chiave viene mostrata una sola volta.
Si applicano sia gli ambiti della chiave sia la row-level security dell'identità con cui essa agisce.
Consulta [Chiavi API](/docs/backend/api-keys/).

### `rebase storage`

Manutenzione a livello globale dei file memorizzati, tramite il backend in esecuzione con `REBASE_SERVICE_KEY` letto da `.env`:

```bash
rebase storage orphans                         # files no row names
rebase storage orphans --source media --delete # and delete them, after asking
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` legge ogni riga di ogni tabella così come memorizzata (comprese le righe eliminate in modo soft, superando ogni hook `beforeQuery` e `afterRead`) e ogni voce della [cronologia](/docs/backend/history/), poiché un ripristino recupera quanto vi è contenuto.
Elenca i file di una determinata sorgente (`--source`, quella predefinita se omessa) che non sono menzionati da alcuna stringa al loro interno: una chiave, un URL, un riferimento `rebase-storage:` in un testo. I file più recenti di `--older-than` ore (24 per impostazione predefinita) vengono esclusi, poiché il pannello di amministrazione carica un file prima che la riga che lo referenzia sia salvata.
La scansione viene eseguita sul backend in background, quindi un progetto troppo grande per essere scansionato all'interno di una singola richiesta (dietro un ingress che andrebbe in timeout) viene comunque completato. La CLI avvia la scansione e ne mostra l'avanzamento (file elencati, righe lette, tabelle completate e quelle non leggibili) fino al termine. Con la [coda dei job](/docs/backend/jobs/) attiva, la scansione diventa un job `storage.orphans` eseguito dai worker dei job. In sua assenza, la scansione viene eseguita all'interno del processo del server a cui è stata richiesta e la CLI lo notifica: il riavvio di tale processo interrompe la scansione. Una scansione corrisponde a un tentativo di job, limitato da `jobs.timeoutMs` (15 minuti per impostazione predefinita). Aumentalo, o impostalo su 0, per una sorgente che richiede più tempo. `--json` stampa lo stesso report precedente, con l'aggiunta di `scanId`.

`--delete` chiede conferma prima di eliminare (`--yes` salta la domanda ed è obbligatorio in assenza di un terminale). Elimina solo i file derivanti dalla scansione appena stampata ed esclusivamente entro 15 minuti dal suo completamento. Non viene eliminato nulla se una tabella non può essere letta: una tabella con hook di lettura su un database il cui driver non può ignorarli viene considerata non letta. Prima di eliminare qualsiasi elemento, il server rilegge ogni riga e voce di cronologia confrontandole con i file elencati. Quindi verifica nuovamente ciascun file subito prima di eliminarlo. Un file ora referenziato da una riga, caricato nuovamente dopo la scansione o non più presente viene mantenuto, e la CLI lo elenca come mantenuto. I file referenziati esclusivamente da tabelle non gestite da Rebase appariranno come inutilizzati: verifica attentamente prima di procedere all'eliminazione. Rispetto a un backend di versione 0.25.1 o precedente, la CLI esegue la scansione secondo la vecchia modalità, all'interno di una singola richiesta.

`move` copia i file presenti sotto `--prefix` verso un'altra sorgente mantenendo le stesse chiavi, una pagina alla volta. Un file già presente nella destinazione con la stessa dimensione viene saltato, consentendo di riprendere uno spostamento interrotto eseguendolo nuovamente; `--delete-source` elimina ciascun file dalla sorgente una volta presente nella destinazione, e viene rifiutato se le due sorgenti utilizzano lo stesso bucket o la stessa directory. Una volta completato lo spostamento, la CLI esamina nuovamente la sorgente con una scansione aggiornata ed elenca ogni file non trasferito: con `--delete-source`, qualsiasi file ancora presente nella sorgente; senza di esso, qualsiasi file di cui la destinazione non contenga una copia con la medesima dimensione. Termina con codice 1 se ne trova anche solo uno, e l'esecuzione del medesimo spostamento riprenderà l'operazione. `--json` li riporta come `notMoved`. La lettura del report di scansione richiede `database:read`. L'avvio di una scansione, l'eliminazione e lo spostamento richiedono `database:write`, detenuto dalla chiave di servizio.

### `rebase skills install`

Installa le skill di riferimento di Rebase per i tuoi assistenti di programmazione AI — ogni `--agent` sopra indicato:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
rebase skills --hooks
```

Consulta [Skill dell'agente](/docs/ai/skills) per l'elenco completo e i percorsi di scrittura dei file.

`--hooks` installa la protezione per Claude Code inclusa da `rebase init` in ogni progetto: `.claude/hooks/post-edit-collection.sh`, registrato come hook `PostToolUse` in `.claude/settings.json`, che esegue `rebase verify --quiet` dopo ogni modifica all'interno di `backend/schema/` o `frontend/src/cms/` e restituisce qualsiasi problema all'agente. Le impostazioni e gli hook esistenti vengono conservati. `rebase skills --hooks` installa esclusivamente l'hook.

### `rebase telemetry`

Condivisione anonima dei dati di utilizzo, disattivata finché non fornisci il consenso. Una sessione interattiva di `rebase init` lo chiede al termine, impostando il prompt in modo predefinito su no, quindi nulla viene condiviso a meno che non si risponda affermativamente. La risposta è valida per singola macchina (`~/.rebase/telemetry.json`): dopo un sì `init` non lo richiederà più, mentre dopo un no il successivo `init` lo chiederà nuovamente. Ogni checkout riceve un ID progetto casuale, conservato nel file gitignored `.rebase/telemetry-project.json`.

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` stampa l'impostazione corrente, `show` stampa esattamente ciò che verrebbe inviato — indipendentemente dal fatto che la condivisione sia attiva o meno, consentendo di esaminare il payload prima di decidere — e gli altri due ne modificano lo stato. Se non hai mai eseguito `init`, nessun dato è mai stato raccolto.

## Prossimi passi

- **[Generazione dello schema](/docs/cli/schema/#production-workflow)** — Il flusso di lavoro delle migrazioni, dalla modifica di una tabella alla produzione
- **[Schema as Code](/docs/architecture/schema-as-code)** — Come funziona la generazione dello schema
- **[Guida rapida](/docs/getting-started/quickstart)** — Inizia subito
