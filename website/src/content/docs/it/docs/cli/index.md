---
sourceHash: 6a990240f0d07538
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

Oppure utilizzala tramite `pnpm dlx`:

```bash
pnpm dlx @rebasepro/cli <command>
```

## Output leggibile da macchina

`--json` è il flag dedicato, e al di fuori della famiglia `cloud` è l'unico: `rebase status`, `rebase resources` e `rebase apps list` inviano quindi un singolo valore JSON su stdout — il risultato, o un envelope `{"error": {"message", "code", "hint", "issues"}}` con un'uscita non-zero — a **ogni** uscita del comando, in modo che un chiamante possa analizzare stdout incondizionatamente. Senza di esso, scrivono testo leggibile dall'uomo e gli errori vanno su stderr. `rebase cloud` utilizza lo stesso envelope ed è l'unica eccezione al flag: attiva anche il JSON automaticamente quando stdout non è una TTY, o quando `REBASE_JSON=1` è impostato. Quindi `rebase cloud status | cat` è JSON mentre `rebase status | cat` non lo è — in uno script, passa `--json` esplicitamente piuttosto che fare affidamento su una delle due regole.

## Comandi

### `rebase init`

Inizializza un nuovo progetto Rebase:

```bash
rebase init [directory]
```

Configura la struttura del progetto con frontend, backend e pacchetti condivisi.

| Flag | Cosa fa |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` o `blank`. Predefinito `blog` |
| `--headless` | Solo backend — nessun pannello di amministrazione e nessun file di collection. `--template` non ha effetto, poiché non ci sono collection da popolare |
| `-y, --yes` | Non chiedere mai conferme. **Obbligatorio ovunque non ci sia un terminale per rispondere**, come nella CI. Salta l'inizializzazione di git e l'installazione delle dipendenze — i valori predefiniti interattivi rispondono sì a entrambi, quindi passa `--git` / `--install` se li desideri |
| `-i, --install` | Installa le dipendenze dopo lo scaffolding |
| `-g, --git` | Inizializza un repository ed esegue il primo commit |
| `--database-url <url>` | Usa un database esistente invece di quello gestito |
| `--introspect` | Genera le collection da quel database. Implica `--template blank` e richiede `--install` |
| `--project <slug>` | Collega lo scaffold a un progetto Rebase Cloud |
| `--setup-key <key>` | La chiave monouso per autenticare quel collegamento |

### `rebase dev`

Avvia il server di sviluppo:

```bash
rebase dev
```

Avvia sia il frontend che il backend con hot reloading.

Entrambe le porte sono derivate dal percorso del progetto, consentendo l'esecuzione affiancata di più progetti Rebase. Usa gli URL stampati da `rebase dev`. Fissane una con `rebase dev --port 3001`.

### `rebase build`

Compila il progetto in un bundle distribuibile in `dist-bundle/`:

```bash
rebase build
```

Il bundle è l'artefatto da distribuire — l'immagine del runtime lo carica, quindi non c'è alcuna immagine dell'applicazione da compilare autonomamente. Flag utili:

| Flag | Effetto |
|------|--------|
| `--out <dir>` | Scrive il bundle in una posizione diversa da `dist-bundle/` |
| `--vendor` | Installa e include sempre le dipendenze del bundle |
| `--no-vendor` | Non include mai le dipendenze; il pod le installerà al primo avvio |
| `--skip-type-check` | Salta il controllo dei tipi (più veloce, meno sicuro) |
| `--no-static` | Salta la compilazione del frontend |

Le dipendenze vengono incluse (vendored) per impostazione predefinita in modo che il riavvio di un pod non richieda un'installazione di 35–55 secondi. Un albero che supera i 200 MB su disco viene invece scartato, poiché il limite di caricamento è di 100 MB compresso — consulta il changelog per le motivazioni.

### `rebase start`

Esegue il bundle compilato come server di produzione:

```bash
rebase start
```

Legge `PORT` e il resto di `.env`, a differenza di `rebase dev`. Indirizzalo a un bundle situato altrove con `rebase start --bundle ./dist-bundle`.

### `rebase apps list`

Mostra le app dichiarate da questo repository:

```bash
rebase apps list
```

Un repository può dichiarare più di un'app distribuibile — ad esempio, un backend e un sito di marketing. È così che puoi vedere su cosa agiranno `rebase build` e il deployment.

### `rebase eject`

Prendi il controllo del processo server e della sua immagine:

```bash
rebase eject
```

Scrive l'entrypoint del backend e un `Dockerfile` nel progetto e converte il suo backend, in modo che il repository compili la propria immagine invece di eseguire il runtime pubblicato. Da quel momento in poi **gli aggiornamenti del runtime della piattaforma non lo raggiungeranno più**, e la configurazione di CORS, autenticazione, storage e shutdown diventerà di tua competenza.

Visualizzane l'anteprima con `rebase eject --dry-run`, che elenca cosa cambierebbe senza modificare nulla. `--force` sostituisce un file `backend/src/index.ts` o `env.ts` esistente, conservando il file corrente come `<name>.bak`.

### `rebase schema generate`

Genera lo schema Drizzle ORM a partire dalle tue collection TypeScript:

```bash
rebase schema generate
```

Legge le tue collection da `config/collections/` e genera `backend/src/schema.generated.ts` con le definizioni delle tabelle Drizzle, gli enum e le relazioni.

### `rebase db push`

Applica le modifiche dello schema direttamente al database (solo per lo sviluppo):

```bash
rebase db push
```

:::caution
`db push` modifica il database direttamente senza file di migrazione. Usa `db generate` + `db migrate` per la produzione.
:::

### `rebase db generate`

Genera file di migrazione SQL a partire dalle modifiche dello schema:

```bash
rebase db generate
```

Crea file di migrazione con timestamp in `drizzle/` che possono essere revisionati e sottoposti a commit.

### `rebase db migrate`

Esegue le migrazioni del database in sospeso:

```bash
rebase db migrate
```

Applica tutte le migrazioni non ancora applicate al database.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups list                  # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` esegue `pg_dump`; `restore` esegue `pg_restore` ed è distruttivo, quindi richiede `--yes`. `--out` accetta un percorso locale o un URL di object storage, e il valore predefinito è `$BACKUP_DESTINATION` o `./backups`.

### `rebase db pull`

Copia un altro database in quello di sviluppo locale:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--anonymize` sostituisce i campi personali durante il trasferimento, consentendo di lavorare localmente su una copia di produzione senza trasferire dati reali dei clienti su un laptop.

`pg_dump` rimuove i privilegi, quindi la copia arriverebbe con le policy RLS della sorgente ma senza i permessi sottostanti — facendo fallire ogni lettura come `rebase_user` con `permission denied`. Il pull riconfigura il ruolo dell'applicazione successivamente, utilizzando la stessa routine impiegata all'avvio e da `rebase db push`, garantendo che le tabelle interne di Rebase rimangano revocate come previsto.

La destinazione è sempre il database di sviluppo locale di questo progetto e non può essere modificata: `--database-url` viene rifiutato anziché accettato, quindi non c'è modo di impostare un "pull in produzione". `--from` è l'unica direzione supportata.

### `rebase db url`

Stampa la stringa di connessione utilizzata da questo progetto, e nient'altro, in modo da poter essere usata con pipe:

```bash
rebase db url
psql "$(rebase db url)"
```

Il database di sviluppo gestito è il caso d'uso che richiede questo comando: `.env` lascia intenzionalmente commentato `DATABASE_URL`, e la porta è derivata dal percorso del progetto, quindi nulla su disco la specifica. Quando hai impostato un tuo `DATABASE_URL`, è quello che verrà stampato — l'ordine di risoluzione è lo stesso seguito da qualsiasi altro comando. Avvia il database gestito se non è già in esecuzione.

### `rebase db stop` / `rebase db reset`

Solo per il database di sviluppo gestito:

```bash
rebase db stop     # stop it; the data is kept
rebase db reset    # delete it and start over
```

### `rebase db branch`

```bash
rebase db branch create <name>
rebase db branch list
rebase db branch info <name>
rebase db branch switch <name>     # work on it; every later command follows
rebase db branch switch            # say which branch you are on
rebase db branch switch --off      # back to the main database
rebase db branch delete <name>
rebase db branch prune [--older-than 14d] [--include-dev-diff]
```

PostgreSQL non copia né elimina un database a cui è connesso qualcos'altro, e di solito quel "qualcos'altro" è la tua istanza di `rebase dev`. `create` e `delete` indicano cosa sta tenendo aperto il database; `--force` disconnette prima quelle sessioni.

Ogni branch è una copia completa su disco, quindi è necessario ripulirli. `prune` rimuove tre cose: una voce il cui database è stato eliminato al di fuori di Rebase, un database di branch la cui voce non è mai stata scritta e — solo con `--older-than` — i branch più vecchi dell'età specificata. Chiede conferma prima di rimuovere qualsiasi elemento, a meno che non venga passato `--yes`.

`switch` registra il branch in `.rebase/branch.json` e non modifica mai `.env`. Ha la precedenza su `DATABASE_URL` in `.env` e cede il passo a `--database-url` o a un `DATABASE_URL` nella shell, quindi un flag sulla riga di comando ha sempre la priorità su uno switch effettuato in precedenza. L'eliminazione del branch su cui ti trovi ti riporta al database principale invece di lasciare il checkout puntato verso un database inesistente.

:::note[Non disponibile sul database di sviluppo gestito]
`push`, `generate` e `migrate` pianificano il proprio lavoro tramite Atlas, che richiede un secondo database vuoto con cui effettuare il confronto — e il PGlite gestito ne serve esattamente uno. Eseguirli lì si arresta con un messaggio che segnala la situazione. Punta `DATABASE_URL` a un PostgreSQL reale per il flusso di migrazione; `rebase dev` crea già le tabelle mancanti in modo incrementale su quello gestito.

`branch` viene rifiutato in tale contesto per un motivo simile. `CREATE DATABASE ... TEMPLATE` su PGlite scrive una voce di catalogo e non copia nulla, quindi il branch farebbe riferimento al database da cui è stato clonato — ogni scrittura destinata a essere isolata finirebbe nel tuo database di sviluppo. `rebase dev --docker` ti fornisce un vero server con cui i branch possono operare.
:::

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init <name>      # register a new app in rebase.json
rebase apps config <app>     # what one app resolves to
```

### `rebase status`

Tutto ciò che questo progetto dichiara e se l'ambiente lo associa effettivamente:

```bash
rebase status               # every resource, and the variables it reads
rebase status --json        # machine-readable
```

```
  backend  ·  managed  Rebase's runtime boots your bundle
  declared in  config/resources.ts
  configured by  .env

  buckets
  ✓ media  s3 · account:minio
      ✓ S3_BUCKET__MEDIA
      ✓ S3_ACCESS_KEY_ID__MINIO (shared, for S3_ACCESS_KEY_ID__MEDIA)
  ○ exports  s3
      · S3_BUCKET__EXPORTS not set
      └ declared, not configured — uploads here answer 501 STORAGE_SOURCE_NOT_CONFIGURED
```

Tre file determinano cosa un backend può raggiungere, e questo comando li mostra tutti e tre insieme:
`rebase.json` specifica dove si trova il tuo codice e chi esegue il server,
`config/resources.ts` specifica ciò di cui il progetto ha bisogno, e l'ambiente indica come
raggiungere ciascun elemento. Tutto il resto — `rebase.resources.json`, il manifest
del bundle — viene generato dal file intermedio per i lettori che non possono eseguire il tuo
codice, e non dovrai mai scriverlo a mano.

Un `○` rappresenta lo stato che vale la pena conoscere prima di un deploy piuttosto che dopo:
dichiarato, non configurato. Una `✗` indica che l'ambiente imposta qualcosa in modo *errato*,
il che impedisce l'avvio anziché funzionare in modo degradato.

### `rebase resources`

Ciò di cui questo progetto dichiara di aver bisogno — i database, i bucket, i topic e
le code richiesti dal codice di configurazione, nonché i cron e le funzioni definiti dai suoi file:

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` è nuovo — il flag utilizzato da un job di CI per fallire
in presenza di un `rebase.resources.json` non più allineato con il codice di configurazione.

Una risorsa viene dichiarata nel codice di configurazione — `database("analytics")`,
`bucket("media")`, `topic("signups")`, `queue("thumbnails")` — oppure è un file
sotto `backend/crons` o `backend/functions`, e non viene mai scritta a mano in
`rebase.resources.json`, che viene generato da tali dichiarazioni affinché un host possa
leggere ciò di cui un progetto necessita senza doverlo compilare. Ciascuna voce registra chi la utilizza
(`collection:events`, `property:posts.cover`, `function:report`).

Un backend ha anche un database predefinito e una sorgente di storage predefinita che nessuno
dichiara. Entrambi sono elencati qui, contrassegnati come `implicit`, e nessuno dei due viene scritto in
`rebase.resources.json` — l'host li fornisce direttamente, pertanto registrarli significherebbe
richiedere il provisioning di qualcosa che nessuno ha richiesto.

Per verificare ciò che la piattaforma gestisce per un progetto a fronte di quanto dichiarato dal suo codice,
e per rimuovere un database allocato che il codice non menziona più, consulta
`rebase cloud resources` di seguito.

### `rebase cloud`

Tutto ciò che riguarda Rebase Cloud, attualmente in beta privata. Consulta la
[guida a Rebase Cloud](/docs/deployment/cloud/) per scoprire cosa comprende e cosa non è
incluso nella beta.

Ogni gruppo risponde a `--help`, e `--help` non esegue mai il comando. La maggior parte dei comandi
agisce sul progetto collegato in `.rebase/cloud.json`; `--project <id>` opera su
un progetto senza necessità di collegamento.

Tre opzioni sono valide ovunque: `--json` per l'output leggibile da macchina (anche il
valore predefinito se reindirizzato tramite pipe, o con `REBASE_JSON=1`), `--url <origin>` per indirizzare
uno specifico control plane (oppure `REBASE_CLOUD_URL`), e `--project, -p <id>`.

#### Autenticazione

```bash
rebase cloud login      # sign in to the control plane
rebase cloud logout     # sign out
rebase cloud whoami     # show the current session
```

#### Collegamento del progetto

```bash
rebase cloud link         # link this directory to a cloud project
rebase cloud link [url]   # or straight at a backend: no control plane, no login, and the rest of the family refuses until you unlink
rebase cloud unlink       # remove the link
rebase cloud use [org]    # select the active organization
rebase cloud open         # open the dashboard in a browser
```

#### Progetti

```bash
rebase cloud projects list
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects delete [id]
```

#### Deploy e monitoraggio

```bash
rebase cloud deploy [app] [--source .]   # deploy an app and stream build logs
rebase cloud logs [--runtime] [-f]       # build logs, or the running process's
rebase cloud deployments list [--limit N|--all]
rebase cloud rollback [id] [-y]          # back to a successful deploy
rebase cloud cancel [-y]                 # cancel the in-flight build
rebase cloud start | stop | restart [-y] # stop and restart need -y
rebase cloud status                      # one-glance project status
rebase cloud metrics                     # live CPU / memory / disk
rebase cloud debug [health|logs|…]       # diagnose a deployment, read-only
```

`deploy` senza il nome di un'app distribuisce il backend.

#### Configurazione

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add | verify | remove
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain
```

#### Organizzazioni

```bash
rebase cloud orgs list | create | members
```

#### Database

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` apre una porta locale che *è* il database gestito (nessun endpoint
pubblico) fino a Ctrl-C; `--reveal` aggiunge la password. Riservato a owner o admin.

#### Risorse

Ciò che la piattaforma gestisce per il progetto a fronte di quanto dichiarato dal suo codice.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un deploy non rimuove mai un database allocato quando la sua dichiarazione scompare — ciò
comporterebbe l'eliminazione di dati a seguito di un push. Viene mantenuto, associato e fatturato finché
qualcuno non ne effettua il pruning specificandone il nome.

#### Compute

Ciò che il progetto riserva e il relativo costo.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` accetta `--cpu`, `--memory`, `--replicas`, `--spot`,
`--scale-to-zero`, `--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` e `--no-autoscale`.
Non ci sono livelli di piano: ogni risorsa ha un prezzo dedicato. Consulta
[Rebase Cloud](/docs/deployment/cloud/).

#### Storage, webhook, cluster e fatturazione

```bash
rebase cloud storage             # list storage buckets
rebase cloud storage create      # provision platform-managed storage
rebase cloud storage attach      # attach your own S3-compatible bucket
rebase cloud webhooks list | create | delete
rebase cloud clusters list | add | verify   # the clusters tenants run on; `add` registers one from a kubeconfig
rebase cloud billing             # the billing account and card on file
rebase cloud billing setup       # attach a card, one-time, opens a browser
rebase cloud billing checkout    # a Stripe session for one project
```

### `rebase generate-sdk`

Genera un SDK client tipizzato a partire dalle definizioni delle tue collection:

```bash
rebase generate-sdk
```

Crea tipi TypeScript e un client type-safe per tutte le tue collection.

### `rebase doctor`

```bash
rebase doctor
```

Il comando da eseguire quando qualcosa non funziona e non sai ancora cosa sia.
Esegue solo controlli e non modifica mai nulla, rendendolo sicuro da usare con qualsiasi database
raggiungibile.

**Senza un database.** Questi controlli vengono eseguiti per primi, poiché tutto ciò che impedisce
a un progetto di funzionare del tutto si verifica prima ancora che una tabella possa essere confrontata:

| Controllo | Motivo |
| --- | --- |
| Versione di Node | Rispetto all'intervallo dichiarato dalla CLI. Una versione troppo vecchia non viene segnalata come "Node non supportato" — si presenta come un errore di sintassi all'interno di una dipendenza. |
| Gestori di pacchetti | Due lockfile in un unico progetto. `npm install` in un workspace pnpm riscrive `node_modules` in una disposizione incompatibile con pnpm, e il sintomo è `Cannot find module` ore dopo. |
| Slug duplicati | Il registro mantiene l'ultima collection registrata, quindi l'altra non viene segnalata come mancante — viene servita come vincente, con il proprio nome. |
| Integrità di `.env` | Un `JWT_SECRET` più corto di 32 caratteri (con cui la produzione rifiuta l'avvio), e `NODE_ENV=production` senza `CORS_ORIGINS` né `FRONTEND_URL`. I valori non vengono mai stampati. |
| Disallineamento di versione di `@rebasepro/*` | Lo stesso pacchetto bloccato a versioni diverse tra i vari file `package.json` del progetto. Due copie distinte interrompono l'`instanceof` tra loro, che fallisce fungendo da type guard che rifiuta il proprio stesso tipo. |
| Stringhe di connessione | Un `=` non codificato in un parametro URL, che gli strumenti nativi di PostgreSQL rifiutano di analizzare — portando alla rottura di backup e `psql` mentre l'app continua a funzionare. |
| Funzioni personalizzate | Ciò di cui ciascuna funzione ha bisogno dal proprio host, e quali di esse non verrebbero eseguite su un runtime edge. |

**Contro il database**, quando `DATABASE_URL` è impostato:

| Controllo | Motivo |
| --- | --- |
| Collection → schema generato | Verifica se `schema.generated.ts` è obsoleto. |
| Collection → database | Tabelle, colonne, enum, chiavi esterne e giunzioni mancanti. |
| Estensioni richieste | Una proprietà `{ type: "vector" }` richiede pgvector, che Rebase installa solo se dichiarato dal progetto. |
| Schema stamp | Verifica se questo database è stato configurato a partire da queste collection. Si tratta di un hash, quindi può indicare se i due non concordano, ma mai quale sia più avanti. |
| Collection → tipi SDK | Verifica se l'SDK tipizzato generato è obsoleto. |
| Policy RLS | Verifica se le policy del database corrispondono alle `securityRules` dichiarate e se qualche policy fa riferimento a un ruolo non utilizzabile da questo server. |

Se il database non è raggiungibile, le sue fasi vengono segnalate come saltate indicandone il
motivo e il resto dei controlli viene comunque eseguito — consulta [Risoluzione dei problemi](/docs/troubleshooting/).

Termina con codice non-zero quando un controllo rileva un errore, o quando una fase non può essere eseguita
perché il database specificato rifiuta le connessioni. Una fase saltata perché
non è stato impostato alcun `DATABASE_URL` non viene considerata un errore.

`rebase doctor --policies` esegue solo i controlli RLS — nessun diff dello schema, nessun tipo SDK — e
adotta una politica di tipo "fail closed", rendendolo ideale come gate di CI a fronte di un database distribuito.

### `rebase auth`

Comandi per la gestione dell'autenticazione:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gestisci le chiavi API di servizio con ambito — le credenziali utilizzate da un agente, uno script o un altro
servizio, a differenza della sessione di un utente finale:

```bash
rebase api-keys list
rebase api-keys create --name "Analytics" --permissions '[{"collection":"events","operations":["read"]}]'
rebase api-keys create --name "Full Access" --full-access --expires 90d
rebase api-keys revoke abc123-def456
```

`--permissions` accetta un array JSON di oggetti `{ collection, operations }`, oppure usa
`--full-access` per lettura/scrittura/eliminazione su ogni collection e funzione. `--expires`
accetta `7d`, `30d`, `90d`, `1y` o una data ISO, e `--rate-limit` imposta le richieste
per intervallo di 15 minuti. Una chiave viene mostrata una sola volta, al momento della creazione.

Le chiavi sono a doppia protezione: si applicano sia i permessi propri della chiave sia la row-level security
dell'identità per cui agisce, garantendo che una chiave non possa mai leggere più di quanto quell'identità possa fare.

### `rebase skills install`

Installa le skill di riferimento di Rebase per il tuo assistente di programmazione IA. Supporta
Cursor, Claude Code, Windsurf, Gemini CLI e Antigravity:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Consulta [Skill degli agenti](/docs/ai/skills) per l'elenco completo e i percorsi in cui i file vengono scritti.

### `rebase telemetry`

Condivisione anonima dei dati di utilizzo. **`rebase init` lo chiede una sola volta per progetto, e la richiesta
ha come valore predefinito il consenso — non viene inviato nulla a meno che tu non risponda:**

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` stampa l'impostazione corrente, `show` stampa esattamente ciò che verrebbe inviato —
indipendentemente dal fatto che la condivisione sia attiva o meno, consentendoti di esaminare il payload prima di decidere — e
gli altri due comandi ne modificano lo stato. Se non hai mai eseguito `init`, non è mai stato raccolto alcun dato.

## Flusso di lavoro delle migrazioni

Il flusso di lavoro tipico per le modifiche allo schema:

```bash
# 1. Edit your collection in config/collections/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Generate SQL migration
rebase db generate

# 4. Review the generated SQL in drizzle/

# 5. Apply the migration
rebase db migrate
```

## Passaggi successivi

- **[Schema as Code](/docs/architecture/schema-as-code)** — Come funziona la generazione dello schema
- **[Guida rapida](/docs/getting-started/quickstart)** — Inizia subito
