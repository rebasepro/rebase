---
sourceHash: ab3e8ab0477304ad
title: Riferimento CLI
sidebar_label: CLI
description: Comandi della CLI di Rebase per l'inizializzazione del progetto, la generazione dello schema, le migrazioni del database e la generazione dell'SDK.
---

## Panoramica

La CLI di Rebase (`rebase`) gestisce il tuo progetto dallo scaffolding fino al deployment.

## Installazione

```bash
pnpm add -g @rebasepro/cli
```

Oppure esegui qualsiasi comando senza installarlo: `pnpm dlx @rebasepro/cli <command>`.

## Output leggibile da macchina

`--json` è il flag selettore, e al di fuori della famiglia `cloud` è l'unico: `rebase status`, `rebase resources`, `rebase apps list`, `rebase upgrade` e `rebase verify` inviano quindi un singolo valore JSON su stdout — il risultato, oppure un envelope `{"error": {"message", "code", "hint", "issues"}}` con un codice di uscita diverso da zero — a **ogni** terminazione del comando, in modo che un chiamante possa eseguire il parsing di stdout incondizionatamente. Senza di esso scrivono testo leggibile dall'uomo e gli errori finiscono su stderr. `rebase cloud` utilizza lo stesso envelope ed è l'unica eccezione a questo flag: attiva il JSON automaticamente anche quando stdout non è un TTY, oppure quando `REBASE_JSON=1` è impostato. Pertanto `rebase cloud status | cat` produce JSON mentre `rebase status | cat` no — in uno script, passa esplicitamente `--json` invece di affidarti a queste regole.

## Comandi

### `rebase init`

Inizializza un nuovo progetto Rebase:

```bash
rebase init [directory]
```

Configura una cartella `backend/` (le tabelle in `backend/schema/`) e una `frontend/` (il pannello di amministrazione, con le relative personalizzazioni delle tabelle in `frontend/src/cms/`); `--headless` esegue lo scaffold del solo `backend/`, senza `backend/schema/`. La [Struttura del progetto](/docs/getting-started/project-structure/) mostra entrambi gli alberi.

| Flag | Descrizione |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` o `blank`. Predefinito `blog` |
| `--headless` | Solo backend — nessun pannello di amministrazione e nessun `backend/schema/`: il server espone le tabelle del database stesso. `--template` non ha effetto, poiché non ci sono tabelle di cui eseguire il seed |
| `-y, --yes` | Non chiedere mai conferme. **Richiesto ovunque non ci sia un terminale per rispondere**, come nella CI. Salta il git init e l'installazione delle dipendenze — i valori predefiniti interattivi rispondono sì a entrambi, quindi passa `--git` / `--install` se desideri eseguirli |
| `-i, --install` | Installa le dipendenze dopo lo scaffolding. Senza questo flag, init lo chiede (predefinito sì); con `--yes`, non viene installato nulla |
| `--no-install` | Non installare nulla e non chiedere |
| `-g, --git` | Inizializza un repository ed effettua il primo commit. Senza questo flag, init lo chiede (predefinito sì); con `--yes`, nessun repository |
| `--database-url <url>` | Usa un database esistente invece di quello gestito. Deve essere un URL `postgres://` o `postgresql://`: qualsiasi altra cosa viene rifiutata prima che venga scritto qualsiasi file, e il prompt interattivo lo chiederà di nuovo |
| `--introspect` | Genera `backend/schema` a partire da quel database. Implica `--template blank` e richiede `--install` |
| `--project <slug>` | Collega lo scaffold a un progetto Rebase Cloud |
| `--setup-key <key>` | La chiave monouso per autenticare tale collegamento |
| `-a, --agent <name>` | Configura gli agenti di coding IA: le [skills](/docs/ai/skills) e il [server MCP](/docs/ai/mcp). Ripetibile o separato da virgole — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` o `all`. Senza questo flag, `init` lo chiede e seleziona preventivamente gli agenti installati sulla macchina; con `--yes`, nessuno |

### `rebase dev`

Avvia il server di sviluppo:

```bash
rebase dev
```

Avvia sia il frontend che il backend con hot reloading, e rigenera lo schema Drizzle e i tipi dell'SDK (`generated/sdk/`) all'avvio e a ogni salvataggio all'interno di `backend/schema/`.

Entrambe le porte sono derivate dal percorso del progetto, così che più progetti Rebase possano essere eseguiti contemporaneamente. Usa gli URL stampati da `rebase dev`. Fissane una con `rebase dev --port 3001`.

Una modifica a `.env`
riavvia il backend, che rilegge il file, così come fa il pannello di amministrazione. Ciò che
`rebase dev` imposta autonomamente viene mantenuto fino al suo riavvio: `PORT` e
`DATABASE_URL` quando si trova sul database gestito o su Docker.

Con
`--database-url`, `rebase dev` verifica prima che qualcosa risponda a quell'host
e porta. Se nulla risponde, lo segnala menzionando il flag ed esce con codice `1` senza
avviare nulla; lascia inoltre intatti i nomi delle variabili del database in `.env`, non avviando
mai il rispettivo container compose.

### `rebase build`

Compila il progetto in un bundle distribuibile in `dist-bundle/`:

```bash
rebase build
```

Il bundle è l'artefatto da distribuire — l'immagine di runtime lo carica, quindi non c'è alcuna
immagine dell'applicazione da compilare autonomamente. Flag utili:

| Flag | Effetto |
|------|--------|
| `--output <dir>` (o `--out`) | Scrive il bundle in una posizione diversa da `dist-bundle/` (un'app alla volta) |
| `--vendor` | Installa e include sempre le dipendenze del bundle |
| `--no-vendor` | Non eseguire mai il vendoring; il pod le installerà a ogni avvio |
| `--skip-type-check` | Salta il controllo dei tipi (più veloce, meno sicuro) |
| `--no-static` | Non integrare il frontend nel bundle del backend (ogni app statica ottiene comunque il proprio bundle) |
| `--skip-static-build` | Integra il frontend così come già compilato, senza eseguire il relativo comando di build |

Un frontend — ogni app statica di `rebase.json` dotata di una configurazione Vite — la cui configurazione non usa `rebaseBackendGuard()` (da
`@rebasepro/app/vitePlugin`) viene rifiutato: è ciò che impedisce al codice server di finire nel
bundle del browser e impedisce a Vite di incorporare inline un file di backend come URL `data:`
(fa fallire la build, segnalandosi, quando un altro plugin sostituisce il suo
`build.assetsInlineLimit`). `frontend/src/cms/ui-config.json` viene inserito nel bundle come
`entry.uiConfig`, la presentazione del workspace servita da un backend distribuito.

Le dipendenze sono sottoposte a vendoring per impostazione predefinita, in modo che una nuova istanza non debba sostenere un'installazione da 35–55
secondi. Un albero che supera i 2 GB su disco viene invece scartato, poiché
il limite di upload è di 1 GB compresso.

Ogni app statica inclusa nel
bundle riceve una copia brotli (`.br`) e una gzip (`.gz`) accanto a ciascun
asset con hash nel nome (content-hashed) di dimensione pari o superiore a 1 KB — i file che un browser memorizza nella cache per un anno.
Il runtime invia quella accettata dal browser, quindi tali file non richiedono alcun
lavoro di compressione per richiesta, inclusa la prima visita dopo un deploy, e
i browser che supportano brotli la ricevono (circa l'11% più piccola di gzip sul
JavaScript dell'admin). L'output di build originale del frontend rimane invariato; cambia solo la copia
all'interno del bundle. Nell'app di esempio questo aggiunge meno di un secondo alla build
e circa 2,4 MB al bundle.

### `rebase upgrade`

Aggiorna tutti i pacchetti `@rebasepro/*` fissati dal progetto a una singola release, quindi
installa con il package manager indicato dal file di lock. `rebase upgrade` seleziona l'ultima versione disponibile (`latest`); `--to 0.21.0` una versione esatta, senza consultare il registry; `--to canary` un
dist-tag. Ogni dipendenza fissata in `dependencies`, `devDependencies` e
`optionalDependencies`, in ogni `package.json` del progetto, mantiene il proprio `^`
o `~`, e nient'altro nel file viene modificato. `peerDependencies` e
le specifiche `workspace:`, `link:`, `file:`, git e tag vengono elencate e lasciate invariate.
Anche gli override in `pnpm-workspace.yaml` e `package.json` vengono aggiornati, ma un override `link:` o
`file:` prevale su qualsiasi versione fissata: viene segnalato e
`--drop-local-overrides` lo rimuove. `--dry-run` non scrive nulla, `--no-install`
salta l'installazione e `--json` stampa un singolo documento.

Un progetto su una
versione di pre-release, come una canary, rimane sul suo canale a meno che `latest` non sia più recente. Un
dist-tag che porterebbe indietro una versione viene rifiutato (`downgrade_refused` con
`--json`), a meno che non si passi `--allow-downgrade`; un valore `--to` esatto viene applicato e
contrassegnato come downgrade. Un `--dry-run` di un aggiornamento che l'esecuzione reale rifiuterebbe
mostra cosa verrebbe spostato ed esce con 0, e con `--json` il suo documento include il
rifiuto come `wouldRefuse` (`{ code, message, hint }`).

### `rebase start`

Esegue il bundle compilato esattamente come farebbe un deployment:

```bash
rebase start
```

Legge `PORT` e il resto di `.env`, a differenza di `rebase dev`, nel `NODE_ENV` ivi
impostato. Un file `.env` generato dallo scaffold indica `development`, quindi il primo account registrato
diventa comunque l'amministratore, e `rebase start` lo specifica all'inizio; imposta `NODE_ENV=production`
per un server di produzione. `rebase start --bundle ./dist-bundle` esegue un bundle posizionato altrove.

`rebase start` non avvia alcun database, e il file `.env` generato dallo scaffold non contiene
`DATABASE_URL`, quindi un'esecuzione locale sul database usato da `rebase dev` è
`DATABASE_URL="$(rebase db url)" rebase start`.
In assenza di questo valore, stampa tale riga prima dell'avvio.

### `rebase apps list`

Mostra le app dichiarate da questo repository:

```bash
rebase apps list
```

Un repository può dichiarare più di un'app distribuibile — ad esempio un backend e un sito
di marketing. Questo comando permette di verificare su cosa agiranno `rebase build` e il deployment.

### `rebase eject`

Prendi il controllo del processo del server e della sua immagine:

```bash
rebase eject
```

Scrive l'entrypoint del backend e un `Dockerfile` nel progetto e ne converte il
backend, in modo che il repository compili la propria immagine anziché eseguire il
runtime pubblicato. Da quel momento in poi **gli aggiornamenti del runtime della piattaforma non lo raggiungeranno più**,
e la configurazione di CORS, collegamenti di autenticazione, storage e arresto (shutdown) sarà sotto la tua completa responsabilità.

Visualizzane un'anteprima con `rebase eject --dry-run`, che elenca le modifiche senza
applicarne alcuna. `--force` sovrascrive un file `backend/src/index.ts` o
`env.ts` esistente, conservando il file corrente come `<name>.bak`.

Il server espulso (ejected)
conserva i caricamenti locali nella cartella `uploads/` del progetto, sia eseguito dai sorgenti sia compilato, esattamente
come fa `rebase dev`. Viene eseguito in `backend/`, quindi un parametro relativo `STORAGE_PATH` viene
letto a partire da `backend/`.

### `rebase schema generate` / `rebase schema stale`

```bash
rebase schema generate       # backend/schema → backend/src/schema.generated.ts
rebase schema stale          # name what differs from the tables, exit 1 if anything does
rebase schema stale --fix    # regenerate the file instead
```

Ogni comando che legge lo schema accetta `--schema-dir <dir>` per i progetti
che lo conservano altrove; `--collections` è stato rimosso. `rebase dev` mantiene il
file aggiornato, quindi `stale` è il controllo ideale per una build o per la CI. Consulta
[Generazione dello schema](/docs/cli/schema/).

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

Ciascuno di essi è descritto in [Comandi del database](/docs/cli/database/), insieme all'ordine con cui un
comando seleziona il database; `push`, `generate` e `migrate` sono trattati approfonditamente
in [Generazione dello schema](/docs/cli/schema/).

### `rebase console`

Una REPL Node con i dati del progetto aperti, oppure un singolo snippet eseguito con `-e`:

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) e `tables` (le
tabelle del progetto, caricate da `backend/schema`) sono nello scope, e l'`await` di primo
livello funziona. Il database viene risolto nello stesso modo in cui lo
risolve `rebase db push`, e aprirlo non modifica nulla al suo interno. Con `-e`, il risultato atteso con await
viene stampato come JSON su stdout e un'eccezione non gestita esce con codice `1`. Flag: `--eval`/`-e`,
`--schema-dir`, `--database-url`, `--docker`. Consulta
[Script e console](/docs/backend/scripts/).

### `rebase migrate`

Passaggi unidirezionali da un layout non più supportato da questa release:
`rebase migrate collections-to-tables` (`config/collections` → `backend/schema`
e `frontend/src/cms`) e `rebase migrate sdk-calls` (`data.collection("x")`
→ `data.table("x")` nel tuo codice). I relativi flag, ciò che scrivono e la
sezione "Review before deploying" sono disponibili in
[Generazione dello schema](/docs/cli/schema/#rebase-migrate).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init             # write a rebase.json inferred from this project
rebase apps config <app>     # the client configuration for one app
```

`apps init` non accetta alcun nome: deduce ogni app dal progetto e scrive l'intero
`rebase.json`, rifiutandosi di sovrascriverne uno esistente a meno che non si passi
`--force`.

Un argomento per il nome viene
rifiutato. `--force` mantiene ciò che l'inferenza non può determinare dal file che va a sostituire:
il nome di ciascuna app, il suo `path` e la sua route `cms`. Tutto il resto viene dedotto
nuovamente, e un'app dichiarata che non viene più trovata viene contrassegnata come rimossa; pertanto, su uno
scaffold riscrive il `rebase.json` originale dello scaffold. Il comando di build dell'app
statica utilizza il package manager del progetto.

Per un
checkout non collegato a un progetto Cloud, `apps config` segnala che non è collegato,
a prescindere dal fatto che `rebase dev` sia in esecuzione o meno, e fornisce l'URL del backend così come
servito da `rebase dev`.

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

Tre file determinano cosa può raggiungere un backend, e questo comando li stampa tutti e tre insieme:
`rebase.json` indica dove si trova il codice e chi esegue il server,
`backend/resources.ts` definisce cosa occorre al progetto e l'ambiente indica come
raggiungere ciascuna risorsa. Tutto il resto — `rebase.resources.json`, il manifest del
bundle — viene generato a partire da quest'ultimo per i lettori che non possono eseguire il tuo
codice, e non va mai scritto a mano.

`○` indica lo stato utile da conoscere prima di un deploy piuttosto che dopo:
dichiarato, non configurato. `✗` indica che l'ambiente imposta qualcosa in modo *errato*,
impedendo l'avvio anziché degradare il servizio.

Un file
`rebase.resources.json` che non corrisponde più alle dichiarazioni riceve una riga `○`.
Uno che non è ancora stato scritto non la riceve: `rebase build` lo scrive a ogni
build, quindi un progetto che non è mai stato compilato, come un nuovo scaffold, non ha
nulla da correggere.

### `rebase resources`

Ciò di cui questo progetto dichiara di aver bisogno — database, bucket, topic e
code richiesti da `backend/resources.ts`, nonché i cron e le funzioni definiti dai suoi file:

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` è il flag utilizzato da un job di CI per fallire in presenza di un
`rebase.resources.json` che non corrisponde più a `backend/resources.ts`.
`--json` può essere combinato
con esso: in caso di disallineamento (drift), `rebase resources --check --json` esce con codice 1 con un envelope di errore
(`resource_graph_missing` o `resource_graph_stale`), mentre in caso di successo
il grafo riporta `check.status`. `--write --json` scrive il file e segnala
`written.changed`.

Una risorsa viene dichiarata in `backend/resources.ts` — `database("analytics")`,
`bucket("media")`, `topic("signups")`, `queue("thumbnails")` — oppure è un file
all'interno di `backend/crons` o `backend/functions`, e non va mai scritta a mano in
`rebase.resources.json`, che viene generato da tali dichiarazioni affinché un host possa
leggere le necessità di un progetto senza compilarlo. Ciascuna voce registra chi la utilizza
(`table:events`, `column:posts.cover`, `function:report`).

Un backend dispone inoltre di un database predefinito e di una sorgente di archiviazione predefinita che nessuno
dichiara esplicitamente. Entrambi sono elencati qui, contrassegnati come `implicit`, e nessuno dei due viene scritto in
`rebase.resources.json` — è l'host a fornirli, quindi registrarli comporterebbe la richiesta
di provisioning di qualcosa che nessuno ha richiesto.
Dichiararne uno con nome,
come `bucket("media")`, lascia invariato quello predefinito, quindi entrambi
compaiono nell'elenco. Solo dichiarare il default stesso, o contrassegnare un bucket con
`default: true`, va a sostituirlo.

Per visualizzare ciò che la piattaforma mantiene per un progetto a fronte di quanto dichiarato dal suo codice,
e per rimuovere un database sottoposto a provisioning che il codice non menziona più, consulta
[`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` — ogni comando per Rebase Cloud: autenticazione, collegamento al progetto, deploy, configurazione, database, risorse, elaborazione (compute) e altro ancora — dispone di una [pagina dedicata](/docs/cli/cloud).

### `rebase generate-sdk`

```bash
rebase generate-sdk
```

Scrive un client tipizzato per le tabelle esportate da `backend/schema/index.ts` in
`generated/sdk/`, con `TableName` e `tablesDictionary`; `--from <link|url>`
legge invece il contratto di un backend in esecuzione. `--register` tipizza anche
i dati lato server: scrive i tipi e la dichiarazione `Register` in
`backend/generated/` e la memorizza in `rebase.json` (`registerDatabase`).
Consulta [Dati tipizzati lato server](/docs/backend/typed-server-data) e
[Generazione dello schema](/docs/cli/schema/#rebase-generate-sdk).

### `rebase doctor`

```bash
rebase doctor
```

Il comando da eseguire quando qualcosa non funziona e non sai ancora cosa sia.
Genera un report e non modifica mai nulla, quindi è sicuro da eseguire su qualsiasi database
raggiungibile.

**Senza database.** Questi controlli vengono eseguiti per primi, perché tutto ciò che impedisce a un progetto
di funzionare del tutto si verifica prima ancora che sia possibile confrontare una tabella:

| Controllo | Motivo |
| --- | --- |
| Versione di Node | Rispetto all'intervallo dichiarato dalla CLI. Una versione troppo vecchia non viene segnalata come "Node non supportato", bensì come un errore di sintassi all'interno di una dipendenza. |
| Package manager | Due file di lock in un unico progetto. `npm install` in un workspace pnpm riscrive `node_modules` in una struttura incompatibile con pnpm, e il sintomo è un errore `Cannot find module` ore dopo. |
| Slug duplicati | Due tabelle che dichiarano lo stesso slug. Lo schema rifiuta di compilare in questo caso, e il controllo le segnala entrambe. |
| Integrità di `.env` | Un `JWT_SECRET` più corto di 32 caratteri (con cui la produzione rifiuta di avviarsi) e `NODE_ENV=production` senza né `CORS_ORIGINS` né `FRONTEND_URL`. I valori non vengono mai stampati. |
| Disallineamento versioni `@rebasepro/*` | Lo stesso pacchetto fissato a versioni differenti nei vari file `package.json` del progetto. Due copie causano problemi con l'`instanceof` tra loro, fallendo come type guard che rifiuta il proprio stesso tipo. |
| Stringhe di connessione | Un `=` non codificato in un parametro URL, che gli strumenti nativi di PostgreSQL si rifiutano di analizzare — portando alla rottura di backup e `psql` mentre l'applicazione continua a funzionare. |
| Funzioni personalizzate | Ciò di cui ciascuna funzione ha bisogno dal proprio host, e quali di esse non potrebbero essere eseguite su un edge runtime. |

**Contro il database** — quello del progetto, risolto nello stesso modo in cui lo
risolve `rebase db url`, quindi su un nuovo scaffold si tratta del database gestito, che `doctor`
avvia:

| Controllo | Motivo |
| --- | --- |
| Tabelle → schema generato | Indica se `schema.generated.ts` non è aggiornato (stale). |
| Tabelle → database | Tabelle, colonne, enum, chiavi esterne e giunzioni mancanti. |
| Estensioni richieste | Una colonna `col.vector()` richiede pgvector, che Rebase installa solo se il progetto lo ha dichiarato. |
| Schema stamp | Indica se questo database è stato sottoposto a provisioning a partire da queste tabelle. È un hash, quindi può solo rilevare una discrepanza tra i due, senza poter stabilire quale sia più avanti. Un timbro `v1:` proveniente da un runtime precedente alla versione 0.31 viene segnalato una volta, con il comando per rigenerarlo: `rebase db push`. |
| Tabelle → tipi SDK | Indica se l'SDK tipizzato generato non è aggiornato. |
| Criteri RLS | Indica se i criteri del database corrispondono all'`rls` dichiarato e se qualche criterio fa riferimento a un ruolo che questo server non può utilizzare. |

Se il database non è raggiungibile, le relative fasi vengono contrassegnate come saltate con la
motivazione e il resto viene comunque eseguito — vedi [Risoluzione dei problemi](/docs/troubleshooting/).

Esce con codice diverso da zero se un controllo rileva un errore o se una fase non è potuta essere eseguita
poiché il database specificato rifiuta le connessioni. Una fase saltata perché
non è stato possibile identificare alcun database non è considerata un errore.

`rebase doctor --policies` esegue solo i controlli RLS — nessun diff dello schema, nessun tipo
SDK — e fallisce in modo restrittivo (fails closed), rendendolo il formato ideale da usare come gate di CI a fronte di un
database distribuito.

`rebase doctor --database`
esegue solo il preflight del database: verifica se il ruolo con cui vengono eseguite le richieste autenticate
esiste, se è limitato e se vi si può passare (switch), quali altri login possono passare
a questo ruolo, se ogni ruolo può connettersi e quali tabelle, permessi (grants) e criteri
Rebase condividerebbe con altri ruoli. Ciascun riscontro specifica l'SQL da eseguire come
amministratore, l'impostazione `rls` per adattare invece Rebase al database, o
entrambi. Legge il catalogo e non modifica nulla, ed esce con 1 se un riscontro è
un fallimento. Funziona anche su un progetto headless. Consulta
[Esecuzione su un database esistente o condiviso](/docs/deployment/existing-database/).

### `rebase verify`

```bash
rebase verify
rebase verify --json
rebase verify --live
rebase verify --live --database-url postgresql://…
```

Verifica se le tabelle sono pronte per il rilascio, in un unico comando rapido per la CI e per gli
hook degli agenti IA. Offline per impostazione predefinita, non modifica mai nulla.

| Passaggio | Cosa ne causa il fallimento |
| --- | --- |
| Definizioni delle tabelle (`schema`) | `backend/schema` non si carica o non compila tramite il loader da cui si avvia il backend: una relazione verso una tabella non esportata dall'index, `rls: "inherit"` senza `defaultRls`, una tabella priva di chiave primaria — una segnalazione per ogni problema. Anche una tabella senza `rls` rientra tra questi. |
| Copertura RLS (`rls`) | Una tabella con una colonna `user_id`, `owner_id`, `organization_id` o `tenant_id` le cui regole — proprie, o ereditate tramite `defaultRls` — consentono a un ruolo di leggere ogni riga ignorando tale campo. È un avviso (warning). `rls-policy-recursion`: una regola che legge la propria tabella in una sottoquery, o due tabelle le cui regole si leggono a vicenda, che Postgres rifiuta di espandere, provocando il fallimento di ogni istruzione protetta con `42P17 infinite recursion detected in policy`; la segnalazione indica la tabella letta e la correzione, ovvero spostare la lettura in una funzione `SECURITY DEFINER`. È un errore, o un avviso quando il loop non è certo. |
| Aggiornamento migrazioni (`migrations`) | Una tabella o una colonna dichiarata nelle tabelle che nessun file in `backend/drizzle/migrations` crea, oppure una eliminata che una migrazione crea ancora. Viene saltato per i progetti privi di migrazioni. |
| Personalizzazioni CMS (`cms`) | Un `customizeTable(...)` in `frontend/src/cms` (o nel `src/cms` di un'app statica in `rebase.json`) che non corrisponde alle tabelle, letto staticamente — i moduli non vengono eseguiti. `cms-unknown-table`: lo slug non corrisponde ad alcuna tabella, quindi il pannello lo ignora (viene suggerito lo slug più vicino). `cms-unknown-field`: una chiave sotto `fields` non è né una colonna né una relazione (al nome SQL di una colonna viene risposto con la sua chiave). `cms-hidden-required`: un campo escluso dal form (`hiddenInForm`, `readOnly`, `disabled`) la cui colonna è `NOT NULL` senza valore predefinito e senza nulla che il server compili, per cui la creazione di un record dal pannello fallisce sempre; è un avviso quando un hook `beforeSave` o una trasformazione potrebbe compilarlo, e viene silenziato da `filledByServer`. `cms-duplicate-customization`: uno slug personalizzato due volte. `cms-not-static` (avviso): una chiamata il cui slug, opzioni o `fields` non sono valori letterali o `const` nello stesso file, per cui nessun elemento è stato verificato. `cms-ui-config-not-mounted` (avviso): `frontend/src/cms/ui-config.json` esiste ma non viene fornito a `<RebaseCMS>` come `uiConfig`. `cms-backend-guard-missing`: la configurazione Vite del frontend non usa `rebaseBackendGuard()`, quindi `rebase build` la rifiuterebbe. Un progetto headless non ha `frontend/src/cms` e salta questo passaggio. |
| Audit RLS live (`live`) | Con `--live`: il catalogo [`rls-check`](/docs/rls-check) a fronte del database del progetto e la verifica che ogni migrazione sia stata applicata. Il database viene risolto come fanno i comandi `db` — `--database-url`, `DATABASE_URL`, `--docker`, altrimenti il database di sviluppo gestito. Un database non configurato o che non risponde genera un errore, non un salto: l'audit è stato esplicitamente richiesto. Un criterio di lettura `USING (true)` compilato da una regola `access: "public"` è un avviso quando l'API richiede un token (`AUTH_REQUIRE`, attivo per impostazione predefinita) — ogni utente autenticato può leggere ogni riga — e un errore con `AUTH_REQUIRE=false`, in cui le righe sono anonime. |

`--json` stampa un singolo oggetto, `{ ok, schemaDir, steps, findings, summary }`:
ogni passaggio è `{ id, title, status, detail? }` (`status` è `passed`, `failed`,
`warnings` o `skipped`), e ogni segnalazione contiene `step`, `check` (un tipo stabile in kebab-case),
`severity`, `message` e, quando applicabili, `fix`, `table`,
`file`, `line` e il `path` separato da punti nella tabella (`posts.rls[0]`) — in modo che un agente possa
correggere ciò che ha interrotto. `summary` conta `errors` e `warnings`. `--quiet` non stampa nulla quando tutti i controlli hanno esito positivo. Esce con codice diverso da zero in
caso di errore; gli avvisi non causano il fallimento.

Un progetto creato tramite scaffolding lo esegue per Claude Code dopo ogni modifica in `backend/schema/`: vedi
[`rebase skills install`](#rebase-skills-install).

### Comandi per un'app in esecuzione

`rebase api`, `rebase data`, `rebase users`, `rebase cron`, `rebase logs`, `rebase functions`, `rebase rls simulate`, `rebase auth login` e `rebase storage ls|cp|rm|url|stat` agiscono su un'applicazione in esecuzione tramite la sua API: l'istanza locale di `rebase dev`, un server specificato con `--url` o un progetto Rebase Cloud con `--project`. Consulta [Un'applicazione in esecuzione](/docs/cli/project/).

### `rebase auth`

Comandi di gestione dell'autenticazione:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gestisci le chiavi API di servizio del progetto — le credenziali utilizzate da un agente, da uno script o da
un altro servizio, a differenza della sessione di un utente finale:

```bash
rebase api-keys list
rebase api-keys get abc123-def456
rebase api-keys create --name "Blog CI" --scopes data:read:posts,data:write:posts --expires-in 90
rebase api-keys create --name "Ops" --full-access --roles admin --expires-at 2027-01-31
rebase api-keys revoke abc123-def456
```

`--scopes` indica ciò che la chiave può fare, separato da virgole o ripetuto; `--full-access`
le assegna tutti gli ambiti (scope) posseduti dalla chiave di servizio ad eccezione di `keys:*`. `--roles` aggiunge
ruoli RLS oltre a `service`, `--expires-in` accetta giorni ed `--expires-at` una data ISO.
`rebase api-keys scopes` elenca tutti gli ambiti noti al backend. Una chiave viene mostrata una sola volta.
Si applicano sia gli ambiti della chiave sia la row-level security dell'identità con cui agisce.
Consulta [Chiavi API](/docs/backend/api-keys/).

### `rebase storage`

Manutenzione dell'intero archivio dei file memorizzati, tramite il backend in esecuzione con
`REBASE_SERVICE_KEY` da `.env`:

```bash
rebase storage orphans                         # files no row names
rebase storage orphans --source media --delete # and delete them, after asking
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` legge ogni riga di ogni tabella così come memorizzata (comprese le righe eliminate
tramite soft-delete, scavalcando ogni hook `beforeQuery` e `afterRead`) e ogni
voce della [cronologia](/docs/backend/history/), poiché un ripristino recupera ciò che essa contiene.
Elenca i file di una determinata sorgente (`--source`, o la sorgente predefinita se omessa)
a cui nessuna stringa al loro interno fa riferimento: una chiave, un URL, un riferimento `rebase-storage:`
in un testo. I file più recenti di `--older-than` ore (24 per impostazione predefinita) vengono esclusi,
poiché il pannello di amministrazione carica un file prima che la riga che lo referenzia sia stata salvata.
La scansione viene eseguita in background sul backend, quindi anche un progetto troppo grande per essere scansionato
all'interno di una singola richiesta (dietro a un ingress che andrebbe in timeout) viene comunque completato. La
CLI la avvia, quindi ne mostra l'avanzamento (file elencati, righe lette, tabelle
completate e quelle che non è stato possibile leggere) fino al termine. Con la
[coda dei job](/docs/backend/jobs/) attiva, la scansione è un job `storage.orphans` eseguito
dai job worker. Senza di essa, la scansione viene eseguita all'interno del processo del server a cui è
stata richiesta, e la CLI lo segnala: il riavvio di quel processo interrompe la scansione. Una scansione
corrisponde a un tentativo di job, limitato da `jobs.timeoutMs` (15 minuti per impostazione predefinita). Aumentalo
o impostalo su 0 per una sorgente che richiede più tempo. `--json` stampa lo stesso
report di prima, insieme al relativo `scanId`.

`--delete` richiede conferma prima di procedere all'eliminazione (`--yes` salta la richiesta ed è obbligatorio
in assenza di terminale). Elimina solo a partire dalla scansione appena stampata ed esclusivamente entro
15 minuti dal completamento di tale scansione. Non viene eliminato nulla finché una tabella
non può essere letta: una tabella dotata di hook di lettura su un database il cui driver
non è in grado di oltrepassarli viene considerata non letta. Prima di eliminare qualsiasi elemento, il server
rilegge ogni riga e voce della cronologia confrontandole con i file elencati. Quindi richiede nuovamente conferma
per ciascun file subito prima di eliminarlo. Un file a cui fa riferimento una riga ora,
che è stato caricato di nuovo dopo la scansione o che non esiste più viene preservato, e la CLI
lo elenca come mantenuto. I file a cui fanno riferimento solo tabelle non gestite da Rebase appariranno come
inutilizzati: verifica attentamente prima di cancellare. Rispetto a un backend versione 0.25.1 o precedente, la
CLI esegue la scansione secondo la vecchia modalità, all'interno di un'unica richiesta.

`move` copia i file presenti sotto `--prefix` in un'altra sorgente mantenendo le stesse chiavi,
una pagina alla volta. Un file che la destinazione già possiede con le stesse dimensioni viene saltato,
consentendo di riprendere uno spostamento interrotto eseguendolo nuovamente; `--delete-source` elimina ciascun
file dalla sorgente una volta che la destinazione lo contiene, e viene rifiutato se le due
sorgenti puntano allo stesso bucket o cartella. Una volta completato lo spostamento, la CLI
elenca nuovamente la sorgente con un'ulteriore scansione e indica ogni file che lo spostamento non ha
trasferito: con `--delete-source`, qualsiasi file ancora presente nella sorgente; senza di esso, qualsiasi file
di cui la destinazione non possiede una copia con le stesse dimensioni. Esce con codice 1 se ne rileva alcuno, e
l'esecuzione del medesimo spostamento lo rielaborerà. `--json` li stampa come `notMoved`. La lettura del report di
una scansione richiede `database:read`. L'avvio di una scansione, l'eliminazione e lo spostamento richiedono
`database:write`, concesso dalla chiave di servizio.

### `rebase skills install`

Installa le competenze di riferimento (reference skills) di Rebase per i tuoi assistenti di programmazione IA — ciascun `--agent` sopra indicato:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
rebase skills --hooks
```

Consulta [Competenze dell'agente](/docs/ai/skills) per l'elenco completo e le posizioni in cui vengono scritti i file.

`--hooks` installa il guardrail per Claude Code fornito da `rebase init` con ogni
progetto: `.claude/hooks/post-edit-collection.sh`, registrato come hook `PostToolUse`
in `.claude/settings.json`, che esegue `rebase verify --quiet` dopo ogni modifica
all'interno di `backend/schema/` o `frontend/src/cms/` e restituisce qualsiasi problema all'agente. Le impostazioni
e gli hook esistenti vengono mantenuti. `rebase skills --hooks` installa esclusivamente l'hook.

### `rebase telemetry`

Condivisione anonima dei dati di utilizzo, disattivata finché non dai il consenso. La modalità interattiva di `rebase init`
lo chiede al termine, e la risposta predefinita è no, quindi nulla viene condiviso a meno che tu non
risponda affermativamente. La risposta è memorizzata a livello di macchina (`~/.rebase/telemetry.json`): dopo un sì
`init` non lo chiederà mai più, mentre dopo un no il successivo `init` lo chiederà di nuovo. Ciascun
checkout riceve un ID progetto casuale, salvato nel file (ignorato da git)
`.rebase/telemetry-project.json`.

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` stampa l'impostazione corrente, `show` stampa esattamente ciò che verrebbe inviato —
a prescindere dal fatto che la condivisione sia attiva o meno, consentendoti di esaminare il payload prima di decidere — e
gli altri due comandi la modificano. Se non hai mai eseguito `init`, non è mai stato raccolto alcun dato.

## Passaggi successivi

- **[Generazione dello schema](/docs/cli/schema/#production-workflow)** — Il flusso di lavoro delle migrazioni, dalla modifica di una tabella alla produzione
- **[Schema as Code](/docs/architecture/schema-as-code)** — Come funziona la generazione dello schema
- **[Guida rapida](/docs/getting-started/quickstart)** — Inizia subito
