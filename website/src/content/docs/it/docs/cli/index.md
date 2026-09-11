---
sourceHash: 27723fe81b7fd939
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

Oppure usa tramite `pnpm dlx`:

```bash
pnpm dlx @rebasepro/cli <command>
```

## Output interpretabile da macchina

`--json` è il selettore, e al di fuori della famiglia `cloud` è l'unico: `rebase status`, `rebase resources` e `rebase apps list` inseriscono quindi un singolo valore JSON su stdout — il risultato, oppure un envelope `{"error": {"message", "code", "hint", "issues"}}` con un codice di uscita diverso da zero — a **ogni** uscita del comando, consentendo al chiamante di analizzare stdout incondizionatamente. Senza di esso, producono testo leggibile dall'uomo e gli errori vanno su stderr. `rebase cloud` utilizza lo stesso envelope ed è l'unica eccezione al selettore: attiva automaticamente il JSON anche quando stdout non è un TTY, o quando è impostato `REBASE_JSON=1`. Quindi `rebase cloud status | cat` restituisce JSON mentre `rebase status | cat` no — in uno script, passa esplicitamente `--json` anziché fare affidamento su una delle due regole.

## Comandi

### `rebase init`

Inizializza un nuovo progetto Rebase:

```bash
rebase init [directory]
```

Configura la struttura del progetto con frontend, backend e pacchetti condivisi.

| Flag | Descrizione |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` o `blank`. Predefinito `blog` |
| `--headless` | Solo backend — nessun pannello di amministrazione e nessun file di collection. `--template` non ha effetto, poiché non ci sono collection di cui eseguire il seed |
| `-y, --yes` | Non richiedere mai conferme. **Obbligatorio ovunque non ci sia un terminale per rispondere**, come nella CI. Salta git init e l'installazione delle dipendenze — i valori predefiniti interattivi rispondono sì a entrambi, quindi passa `--git` / `--install` se desideri eseguirli |
| `-i, --install` | Installa le dipendenze dopo lo scaffolding |
| `-g, --git` | Inizializza un repository ed esegue il primo commit |
| `--database-url <url>` | Usa un database esistente invece di quello gestito |
| `--introspect` | Genera collection da quel database. Implica `--template blank` e richiede `--install` |
| `--project <slug>` | Collega lo scaffold a un progetto Rebase Cloud |
| `--setup-key <key>` | La chiave monouso per autenticare tale collegamento |

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

Il bundle è l'artefatto da distribuire — l'immagine runtime lo carica, quindi non c'è alcuna immagine applicativa da creare manualmente. Flag utili:

| Flag | Effetto |
|------|--------|
| `--out <dir>` | Scrive il bundle in una posizione diversa da `dist-bundle/` |
| `--vendor` | Installa e include sempre le dipendenze del bundle |
| `--no-vendor` | Non include mai le dipendenze; il pod le installa al primo avvio |
| `--skip-type-check` | Salta il controllo dei tipi (più veloce, meno sicuro) |
| `--no-static` | Salta la compilazione del frontend |

Le dipendenze vengono incluse tramite vendoring per impostazione predefinita, in modo che il riavvio di un pod non richieda un'installazione di 35–55 secondi. Un albero che supera i 200 MB su disco viene invece scartato, poiché il limite di caricamento è di 100 MB compressi — consulta il changelog per i dettagli.

### `rebase start`

Esegue il bundle compilato come server di produzione:

```bash
rebase start
```

Legge `PORT` e il resto di `.env`, a differenza di `rebase dev`. Indirizzalo a un bundle altrove con `rebase start --bundle ./dist-bundle`.

### `rebase apps list`

Mostra le app dichiarate da questo repository:

```bash
rebase apps list
```

Un repository può dichiarare più di un'app distribuibile — ad esempio un backend e un sito di marketing. Questo comando consente di vedere su cosa agiranno `rebase build` e il deployment.

### `rebase eject`

Prendi il controllo del processo del server e della sua immagine:

```bash
rebase eject
```

Scrive l'entrypoint del backend e un `Dockerfile` nel progetto e converte il backend, in modo che il repository compili la propria immagine invece di eseguire il runtime pubblicato. Da quel momento in poi **gli aggiornamenti del runtime della piattaforma non lo raggiungeranno più**, e la configurazione di CORS, autenticazione, storage e arresto diventa interamente a tuo carico.

Visualizza un'anteprima con `rebase eject --dry-run`, che elenca le modifiche senza applicarle. `--force` sostituisce un eventuale `backend/src/index.ts` o `env.ts` esistente, conservando il file corrente come `<name>.bak`.

### `rebase schema generate`

Genera lo schema Drizzle ORM dalle tue collection TypeScript:

```bash
rebase schema generate
```

Legge le collection da `config/collections/` e genera `backend/src/schema.generated.ts` contenente definizioni di tabelle Drizzle, enum e relazioni.

### `rebase db push`

Applica le modifiche allo schema direttamente al database (solo per sviluppo):

```bash
rebase db push
```

:::caution
`db push` modifica direttamente il database senza file di migrazione. Usa `db generate` + `db migrate` per la produzione.
:::

### `rebase db generate`

Genera i file di migrazione SQL dalle modifiche dello schema:

```bash
rebase db generate
```

Crea file di migrazione con timestamp in `drizzle/` che possono essere revisionati e sottoposti a commit.

### `rebase db migrate`

Esegue le migrazioni del database in sospeso:

```bash
rebase db migrate
```

Applica tutte le migrazioni non ancora eseguite al database.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups                       # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` esegue `pg_dump`; `restore` esegue `pg_restore` ed è distruttivo, quindi richiede `--yes`. `--out` accetta un percorso locale o un URL di object storage, con valore predefinito pari a `$BACKUP_DESTINATION` o `./backups`.

### `rebase db pull`

Copia un altro database in quello di sviluppo locale:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--anonymize` sostituisce i dati personali durante l'importazione, consentendo di lavorare localmente su una copia di produzione senza trasferire dati reali dei clienti sul computer.

`pg_dump` rimuove i privilegi, quindi la copia arriverebbe con i criteri RLS di origine ma senza i relativi grant — causando il fallimento di ogni lettura come `rebase_user` con `permission denied`. Il pull ripristina successivamente il ruolo dell'applicazione, usando la stessa procedura impiegata all'avvio e da `rebase db push`, assicurando che l'accesso alle tabelle interne di Rebase rimanga revocato come previsto.

La destinazione è sempre il database di sviluppo locale di questo progetto e non può essere modificata: `--database-url` viene rifiutato, rendendo impossibile eseguire un "pull in produzione". `--from` è l'unica direzione supportata.

### `rebase db url`

Stampa la stringa di connessione utilizzata da questo progetto, e nient'altro, facilitando l'uso in pipe:

```bash
rebase db url
psql "$(rebase db url)"
```

Il database di sviluppo gestito è il caso tipico in cui questo comando serve: `.env` lascia intenzionalmente `DATABASE_URL` commentato e la porta viene derivata dal percorso del progetto, quindi nessun file su disco la specifica. Quando imposti un tuo `DATABASE_URL`, è quello che verrà stampato — l'ordine di risoluzione è lo stesso seguito da qualsiasi altro comando. Se non è già in esecuzione, il comando avvia il database gestito.

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

PostgreSQL non consente di copiare o eliminare un database se vi sono connessioni attive, e solitamente l'altra connessione è la tua istanza di `rebase dev`. `create` e `delete` indicano cosa sta tenendo aperto il database; `--force` disconnette prima queste sessioni.

Ogni branch è una copia completa su disco, quindi richiede una pulizia periodica. `prune` rimuove tre elementi: una voce il cui database è stato eliminato al di fuori di Rebase, un database di branch la cui voce non è mai stata registrata e — solo con `--older-than` — i branch che superano l'anzianità specificata. Richiede conferma prima di rimuovere qualsiasi elemento, a meno che non si passi `--yes`.

`switch` registra il branch in `.rebase/branch.json` e non modifica mai `.env`. Ha la precedenza rispetto a `DATABASE_URL` in `.env`, ma cede il passo a `--database-url` o a un `DATABASE_URL` nella shell, garantendo che un flag sulla riga di comando prevalga sempre su uno switch precedente. L'eliminazione del branch su cui ti trovi ti riporta al database principale anziché lasciare il puntamento a un database rimosso.

:::note[Non supportato sul database di sviluppo gestito]
`push`, `generate` e `migrate` pianificano le operazioni con Atlas, che richiede un secondo database vuoto per il confronto — e il PGlite gestito ne fornisce esattamente uno. L'esecuzione di questi comandi lì si interrompe con un messaggio esplicativo. Per il flusso di lavoro delle migrazioni, fai puntare `DATABASE_URL` a un'istanza PostgreSQL reale; `rebase dev` crea già le tabelle mancanti in modo incrementale su quello gestito.

`branch` viene rifiutato lì per un motivo simile. L'istruzione `CREATE DATABASE ... TEMPLATE` su PGlite scrive una voce di catalogo senza copiare nulla, quindi il branch farebbe riferimento al database da cui è stato clonato — e ogni scrittura che intendevi isolare finirebbe nel database di sviluppo. `rebase dev --docker` fornisce un server reale compatibile con i branch.
:::

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init <name>      # register a new app in rebase.json
rebase apps config <app>     # what one app resolves to
```

### `rebase status`

Tutto ciò che questo progetto dichiara, e se l'ambiente lo associa effettivamente:

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

Tre file determinano ciò a cui un backend può accedere, e questo comando li stampa tutti insieme: `rebase.json` indica dove si trova il codice e chi esegue il server, `config/resources.ts` specifica ciò di cui il progetto ha bisogno, e l'ambiente indica come raggiungere ogni risorsa. Tutto il resto — `rebase.resources.json`, il manifest del bundle — viene generato a partire dal secondo file per i processi che non possono eseguire il tuo codice, e non va mai modificato a mano.

Un simbolo `○` indica lo stato utile da conoscere prima di un deploy anziché dopo: dichiarato, non configurato. Una `✗` indica che l'ambiente imposta qualcosa in modo *errato*, bloccando l'avvio anziché funzionare in modalità degradata.

### `rebase resources`

Ciò di cui questo progetto dichiara di aver bisogno — database, bucket, topic e code richiesti dal codice di configurazione, nonché cron e funzioni definiti dai suoi file:

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` è una novità — è il flag utilizzato dai job di CI per segnalare un errore nel caso in cui `rebase.resources.json` non corrisponda più al codice di configurazione.

Una risorsa viene dichiarata nel codice di configurazione — `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` — oppure è un file in `backend/crons` o `backend/functions`, e non va mai scritta manualmente in `rebase.resources.json`, che viene generato da tali dichiarazioni affinché l'host possa verificare i requisiti del progetto senza doverlo compilare. Ogni voce indica chi la utilizza (`collection:events`, `property:posts.cover`, `function:report`).

Un backend include anche un database predefinito e un'origine di storage predefinita che nessuno dichiara. Entrambi sono elencati qui, contrassegnati come `implicit`, e nessuno dei due viene scritto in `rebase.resources.json` — poiché vengono forniti dall'host, registrarli richiederebbe il provisioning di elementi non esplicitamente richiesti.

Per verificare le risorse allocate sulla piattaforma rispetto a quelle dichiarate dal codice, e per rimuovere un database fornito non più menzionato dal codice, vedi `rebase cloud resources` di seguito.

### `rebase cloud`

Tutto ciò che riguarda Rebase Cloud, attualmente in beta privata. Consulta la [guida a Rebase Cloud](/docs/deployment/cloud/) per scoprire di cosa si tratta e cosa non è incluso nella beta.

Ogni gruppo risponde a `--help`, e `--help` non esegue mai il comando. La maggior parte dei comandi agisce sul progetto collegato in `.rebase/cloud.json`; `--project <id>` opera su uno specifico progetto senza collegarlo.

Tre opzioni si applicano ovunque: `--json` per l'output interpretabile da macchina (predefinito anche in pipe o con `REBASE_JSON=1`), `--url <origin>` per indirizzare un control plane specifico (oppure `REBASE_CLOUD_URL`), e `--project, -p <id>`.

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

#### Distribuzione e osservabilità

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

`db connect` apre una porta locale che *è* il database gestito — che non ha endpoint pubblici — e la mantiene attiva fino a Ctrl-C. `--reveal` include la password.

#### Risorse

Ciò che la piattaforma gestisce per il progetto, a confronto con quanto dichiarato dal codice.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un deploy non rimuove mai un database allocato quando la sua dichiarazione viene eliminata — ciò comporterebbe la perdita di dati a causa di un push. Lo mantiene, lo collega e lo fattura finché qualcuno non lo rimuove esplicitamente per nome.

#### Compute

Ciò che il progetto riserva e il relativo costo.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` accetta `--cpu`, `--memory`, `--replicas`, `--spot`, `--scale-to-zero`, `--db-mode`, `--db-instances`, `--db-cpu`, `--db-memory`, `--storage`, `--autoscale-max`, `--autoscale-cpu-target` e `--no-autoscale`. Non ci sono livelli di piano tariffario: ogni risorsa è prezzata singolarmente. Consulta [Rebase Cloud](/docs/deployment/cloud/).

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

Genera un SDK client tipizzato a partire dalle definizioni delle collection:

```bash
rebase generate-sdk
```

Crea tipi TypeScript e un client type-safe per tutte le tue collection.

### `rebase doctor`

```bash
rebase doctor
```

Il comando da eseguire quando qualcosa non funziona e non sai ancora cosa sia. Si limita a generare un report senza modificare nulla, quindi è sicuro su qualsiasi database raggiungibile.

**Senza un database.** Questi controlli vengono eseguiti per primi, poiché tutto ciò che impedisce del tutto il funzionamento di un progetto si verifica prima ancora che sia possibile confrontare una tabella:

| Controllo | Motivo |
| --- | --- |
| Node version | Rispetto all'intervallo dichiarato dalla CLI. Una versione obsoleta non viene segnalata come "Node non supportato", ma come errore di sintassi all'interno di una dipendenza. |
| Package managers | Due file di lock in un singolo progetto. L'esecuzione di `npm install` in un workspace pnpm riscrive `node_modules` con una struttura non compatibile con pnpm, e il sintomo è un errore `Cannot find module` riscontrato ore dopo. |
| Duplicate slugs | Il registry conserva l'ultima collection registrata, quindi l'altra non viene segnalata come mancante: viene servita come vincente, con il proprio nome. |
| `.env` sanity | Un `JWT_SECRET` più corto di 32 caratteri (con cui la produzione rifiuta l'avvio), e `NODE_ENV=production` senza `CORS_ORIGINS` né `FRONTEND_URL`. I valori non vengono mai stampati. |
| `@rebasepro/*` version skew | Lo stesso pacchetto bloccato su versioni diverse nei vari file `package.json` del progetto. Due copie distinte compromettono il funzionamento di `instanceof` tra loro, causando il fallimento di un type guard che rifiuta il proprio stesso tipo. |
| Connection strings | Un carattere `=` non codificato in un parametro URL, che gli strumenti nativi di PostgreSQL si rifiutano di analizzare — provocando il blocco di backup e `psql` mentre l'applicazione continua a funzionare. |
| Custom functions | Cosa richiede ciascuna funzione dal proprio host e quali di esse non funzionerebbero su un edge runtime. |

**Connesso al database**, quando `DATABASE_URL` è impostato:

| Controllo | Motivo |
| --- | --- |
| Collections → generated schema | Verifica se `schema.generated.ts` non è aggiornato. |
| Collections → database | Tabelle, colonne, enum, chiavi esterne e tabelle di giunzione mancanti. |
| Required extensions | Una proprietà `{ type: "vector" }` richiede pgvector, che Rebase installa solo se dichiarato nel progetto. |
| Schema stamp | Verifica se il database è stato creato da queste collection. È un hash, quindi può indicare che i due differiscono ma non chi sia più avanti. |
| Collections → SDK types | Verifica se l'SDK tipizzato generato non è aggiornato. |
| RLS policies | Verifica se i criteri del database corrispondono alle `securityRules` dichiarate e se qualche criterio indica un ruolo che questo server non può utilizzare. |

Se il database non è raggiungibile, le relative fasi vengono contrassegnate come ignorate con la motivazione indicata e il resto viene comunque eseguito — vedi [Risoluzione dei problemi](/docs/troubleshooting/).

Termina con codice diverso da zero se un controllo rileva un errore o se una fase non può essere eseguita a causa del rifiuto delle connessioni da parte del database configurato. Una fase saltata perché non è stato impostato alcun `DATABASE_URL` non viene considerata un errore.

`rebase doctor --policies` esegue solo i controlli RLS — nessun diff dello schema, nessun tipo SDK — e fallisce in modo restrittivo (fail-closed), rendendolo ideale come gate di CI su un database distribuito.

### `rebase auth`

Comandi per la gestione dell'autenticazione:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gestisce le chiavi API di servizio con ambito (scoped) — le credenziali utilizzate da un agente, uno script o un altro servizio, a differenza della sessione di un utente finale:

```bash
rebase api-keys list
rebase api-keys create --name "Analytics" --permissions '[{"collection":"events","operations":["read"]}]'
rebase api-keys create --name "Full Access" --full-access --expires 90d
rebase api-keys revoke abc123-def456
```

`--permissions` accetta un array JSON di oggetti `{ collection, operations }`, oppure usa `--full-access` per permessi di lettura/scrittura/cancellazione su ogni collection e funzione. `--expires` accetta `7d`, `30d`, `90d`, `1y` o una data ISO, mentre `--rate-limit` imposta il numero di richieste per finestra di 15 minuti. La chiave viene mostrata una sola volta, al momento della creazione.

Le chiavi sono soggette a una doppia convalida: si applicano sia i permessi della chiave stessa, sia la sicurezza a livello di riga (row-level security) dell'identità per conto della quale opera; di conseguenza, una chiave non potrà mai leggere più di quanto consentito a tale identità.

### `rebase skills install`

Installa le skill di riferimento di Rebase per il tuo assistente di sviluppo AI. Supporta Cursor, Claude Code, Windsurf, Gemini CLI e Antigravity:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Consulta [Skill degli agenti](/docs/ai/skills) per l'elenco completo e i percorsi di destinazione dei file.

### `rebase telemetry`

Condivisione anonima dei dati di utilizzo. **`rebase init` chiede conferma una sola volta per progetto, e il prompt è impostato su sì per impostazione predefinita — non viene inviato nulla a meno che tu non risponda:**

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` stampa l'impostazione corrente, `show` mostra esattamente cosa verrebbe inviato — a prescindere che la condivisione sia attiva o meno, consentendoti di esaminare il payload prima di decidere — e gli altri due comandi ne modificano lo stato. Se non hai mai eseguito `init`, non è mai stato raccolto alcun dato.

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
- **[Quickstart](/docs/getting-started/quickstart)** — Per iniziare

---
