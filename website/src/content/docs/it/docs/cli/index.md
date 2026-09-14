---
sourceHash: 7fbdafd20900a251
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

## Output machine-readable

`--json` è il selettore, e al di fuori della famiglia `cloud` è l'unico: `rebase status`, `rebase resources` e `rebase apps list` inviano quindi un singolo valore JSON su stdout — il risultato, oppure un inviluppo `{"error": {"message", "code", "hint", "issues"}}` con un codice di uscita diverso da zero — a **ogni** terminazione del comando, consentendo a un chiamante di analizzare stdout incondizionatamente. Senza questo flag scrivono testo leggibile dall'utente e gli errori vanno su stderr. `rebase cloud` usa lo stesso inviluppo ed è l'unica eccezione allo switch: attiva automaticamente il JSON anche quando stdout non è un TTY, o quando è impostato `REBASE_JSON=1`. Di conseguenza, `rebase cloud status | cat` produce JSON mentre `rebase status | cat` no — all'interno di uno script, passa esplicitamente `--json` anziché fare affidamento su una delle due regole.

## Comandi

### `rebase init`

Inizializza un nuovo progetto Rebase:

```bash
rebase init [directory]
```

Configura la struttura del progetto con frontend, backend e pacchetti condivisi.

| Flag | Cosa fa |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` o `blank`. Valore predefinito: `blog` |
| `--headless` | Solo backend — nessun pannello di amministrazione e nessun file di collection. `--template` non ha effetto, poiché non ci sono collection da inizializzare |
| `-y, --yes` | Non richiede mai conferme interattive. **Obbligatorio ovunque non sia presente un terminale per rispondere**, come nella CI. Salta il git init e l'installazione delle dipendenze — le opzioni interattive predefinite rispondono sì a entrambi, quindi passa `--git` / `--install` se desideri eseguirli |
| `-i, --install` | Installa le dipendenze dopo lo scaffolding |
| `-g, --git` | Inizializza un repository ed effettua il primo commit |
| `--database-url <url>` | Usa un database esistente anziché quello gestito |
| `--introspect` | Genera collection partendo da quel database. Implica `--template blank` e richiede `--install` |
| `--project <slug>` | Collega lo scaffold a un progetto Rebase Cloud |
| `--setup-key <key>` | La chiave monouso per autenticare tale collegamento |

### `rebase dev`

Avvia il server di sviluppo:

```bash
rebase dev
```

Avvia sia il frontend che il backend con hot reloading.

Entrambe le porte sono derivate dal percorso del progetto, consentendo l'esecuzione di più progetti Rebase
in parallelo. Usa gli URL stampati da `rebase dev`. Fissane una con `rebase dev --port 3001`.

### `rebase build`

Compila il progetto in un bundle distribuibile all'interno di `dist-bundle/`:

```bash
rebase build
```

Il bundle è l'artefatto di cui esegui il deploy — l'immagine di runtime lo carica, quindi non c'è alcuna
immagine dell'applicazione da compilare autonomamente. Flag utili:

| Flag | Effetto |
|------|---------|
| `--out <dir>` | Scrive il bundle in una cartella diversa da `dist-bundle/` |
| `--vendor` | Installa e include sempre le dipendenze del bundle |
| `--no-vendor` | Non esegue mai il vendor; il pod installa al primo avvio |
| `--skip-type-check` | Salta il type checking (più veloce, meno sicuro) |
| `--no-static` | Salta la compilazione del frontend |

Le dipendenze vengono incluse tramite vendoring per impostazione predefinita, in modo che il riavvio di un pod non richieda un'installazione
di 35–55 secondi. Un albero che supera i 200 MB su disco viene invece scartato, poiché il
limite di caricamento è di 100 MB compressi — consulta il changelog per la motivazione.

### `rebase start`

Esegue il bundle compilato come server di produzione:

```bash
rebase start
```

Legge `PORT` e il resto del file `.env`, a differenza di `rebase dev`. Indirizzalo verso un bundle
posizionato altrove con `rebase start --bundle ./dist-bundle`.

### `rebase apps list`

Mostra le applicazioni dichiarate da questo repository:

```bash
rebase apps list
```

Un repository può dichiarare più di un'applicazione distribuibile — ad esempio un backend e un sito
di marketing. Questo comando serve per verificare su cosa agiranno `rebase build` e il deployment.

### `rebase eject`

Prendi il controllo del processo del server e della sua immagine:

```bash
rebase eject
```

Scrive l'entrypoint del backend e un `Dockerfile` all'interno del progetto e converte il suo
backend, in modo che il repository compili la propria immagine anziché eseguire il
runtime pubblicato. Da quel momento in poi **gli aggiornamenti del runtime della piattaforma non lo raggiungeranno più**,
e la configurazione di CORS, autenticazione, storage e arresto passerà sotto la tua responsabilità.

Visualizza un'anteprima con `rebase eject --dry-run`, che elenca le modifiche senza
applicarle. `--force` sovrascrive un eventuale `backend/src/index.ts` o
`env.ts` esistente, salvando il file corrente come `<name>.bak`.

### `rebase schema generate`

Genera lo schema Drizzle ORM a partire dalle tue collection TypeScript:

```bash
rebase schema generate
```

Legge le tue collection da `config/collections/` e genera `backend/src/schema.generated.ts` contenente definizioni di tabelle Drizzle, enum e relazioni.

### `rebase db push`

Invia le modifiche allo schema direttamente al database (solo sviluppo):

```bash
rebase db push
```

:::caution
`db push` modifica il database direttamente senza file di migrazione. Usa `db generate` + `db migrate` per la produzione.
:::

### `rebase db generate`

Genera file di migrazione SQL a partire dalle modifiche allo schema:

```bash
rebase db generate
```

Crea file di migrazione con timestamp in `drizzle/` pronti per essere revisionati e committati.

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

`backup` esegue `pg_dump`; `restore` esegue `pg_restore` ed è un'operazione distruttiva, pertanto
richiede `--yes`. `--out` accetta un percorso locale o un URL di object storage, e
ha come valore predefinito `$BACKUP_DESTINATION` o `./backups`.

### `rebase db pull`

Copia un altro database in quello di sviluppo locale:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--anonymize` sostituisce i campi contenenti dati personali durante l'importazione, permettendo di lavorare
localmente su una copia di produzione senza trasferire dati reali dei clienti sul proprio laptop.

`pg_dump` rimuove i privilegi, quindi la copia arriverebbe con le policy RLS
della sorgente ma senza alcuna delle relative concessioni (grant) — ogni lettura come `rebase_user` fallirebbe
con `permission denied`. Il pull ripristina successivamente il ruolo dell'applicazione, usando
la stessa routine impiegata all'avvio e da `rebase db push`, assicurando che l'accesso alle tabelle interne di Rebase rimanga
revocato come previsto.

La destinazione è sempre il database di sviluppo locale di questo progetto e non può essere
modificata: `--database-url` viene rifiutato anziché accettato, impedendo qualsiasi tentativo
di "pull verso la produzione". `--from` è l'unica direzione supportata.

### `rebase db url`

Stampa la stringa di connessione in uso da questo progetto, e nient'altro, rendendola
pronta per le pipe:

```bash
rebase db url
psql "$(rebase db url)"
```

Il database di sviluppo gestito è il caso tipico che richiede questo comando: `.env` lascia
`DATABASE_URL` commentato intenzionalmente, e la porta è derivata dal
percorso del progetto, quindi nulla su disco ne definisce il nome. Se hai impostato un tuo
`DATABASE_URL`, verrà stampato quest'ultimo — l'ordine di risoluzione è lo stesso
seguito da ogni altro comando. Il comando avvia il database gestito qualora non sia
già in esecuzione.

### `rebase db stop` / `rebase db reset`

Valido esclusivamente per il database di sviluppo gestito:

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

PostgreSQL non copia né elimina un database a cui qualcos'altro è connesso, e
spesso questo "qualcos'altro" è la tua istanza di `rebase dev`. `create` e `delete` indicano
cosa sta mantenendo aperto il database; `--force` disconnette prima tali sessioni.

Ciascun branch è una copia completa su disco, pertanto richiede pulizia. `prune` rimuove
tre elementi: una voce il cui database è stato eliminato al di fuori di Rebase, un database di branch
la cui voce non è mai stata registrata e — solo con `--older-than` — i branch
più vecchi dell'età specificata. Chiede conferma prima di rimuovere qualsiasi cosa, a meno che non si passi `--yes`.

`switch` registra il branch in `.rebase/branch.json` e non modifica mai `.env`. Ha
la precedenza su `DATABASE_URL` in `.env` ma cede il passo a `--database-url` o a un
`DATABASE_URL` nella shell: un flag da riga di comando prevale sempre su uno switch
effettuato in precedenza. L'eliminazione del branch su cui ti trovi ti riporta al database principale
anziché lasciare il checkout puntato verso un database inesistente.

:::note[Non sul database di sviluppo gestito]
`push`, `generate` e `migrate` pianificano le loro operazioni tramite Atlas, che necessita di un secondo
database vuoto per il confronto — e il PGlite gestito ne serve esattamente uno.
L'esecuzione su di esso si interrompe con un messaggio di avviso. Punta `DATABASE_URL` a un'istanza reale
di PostgreSQL per il flusso di lavoro delle migrazioni; `rebase dev` crea già le tabelle mancanti
in modalità additiva su quello gestito.

`branch` viene rifiutato in questo contesto per una ragione correlata. `CREATE DATABASE ... TEMPLATE`
su PGlite scrive una voce di catalogo senza copiare nulla, quindi il branch farebbe
riferimento al database da cui è stato clonato — ogni scrittura destinata all'ambiente isolato
finirebbe nel database di sviluppo. `rebase dev --docker` fornisce un vero
server compatibile con i branch.
:::

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init <name>      # register a new app in rebase.json
rebase apps config <app>     # what one app resolves to
```

### `rebase status`

Tutto ciò che questo progetto dichiara e lo stato del relativo binding con l'ambiente:

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

Tre file determinano le risorse accessibili da un backend, e questo comando li visualizza congiuntamente:
`rebase.json` definisce dove si trova il codice e chi esegue il server,
`config/resources.ts` definisce i requisiti del progetto e l'ambiente specifica come
raggiungere ciascun componente. Tutto il resto — `rebase.resources.json`, il manifest del bundle —
viene generato da quest'ultimo a beneficio dei lettori che non possono eseguire il tuo codice,
e non deve mai essere modificato manualmente.

Un simbolo `○` rappresenta lo stato utile da conoscere prima del deploy anziché dopo:
dichiarato, ma non configurato. Un `✗` indica che l'ambiente ha configurato qualcosa in modo *errato*,
provocando il blocco dell'avvio anziché un funzionamento degradato.

### `rebase resources`

Ciò di cui il progetto dichiara di aver bisogno — i database, bucket, topic e
code richiesti dal codice di configurazione, oltre ai cron e alle funzioni definiti nei file:

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` è il flag utilizzato da un job di CI per segnalare un errore
nel caso in cui `rebase.resources.json` non corrisponda più al codice di configurazione.

Una risorsa viene dichiarata nel codice di configurazione — `database("analytics")`,
`bucket("media")`, `topic("signups")`, `queue("thumbnails")` — oppure corrisponde a un file
presente in `backend/crons` o `backend/functions`, e non viene mai scritta a mano in
`rebase.resources.json`: quest'ultimo viene generato da tali dichiarazioni affinché l'host possa
rilevare i requisiti del progetto senza doverlo compilare. Ogni voce tiene traccia dei componenti che la utilizzano
(`collection:events`, `property:posts.cover`, `function:report`).

Un backend include inoltre un database predefinito e un'origine di archiviazione predefinita non dichiarati
esplicitamente. Entrambi sono elencati qui, contrassegnati come `implicit`, e nessuno dei due viene scritto in
`rebase.resources.json` — essendo forniti dall'host, registrarli comporterebbe la richiesta
di provisioning per elementi non esplicitamente richiesti.

Per confrontare le risorse allocate dalla piattaforma per un progetto con quelle dichiarate dal suo codice,
e per rimuovere un database allocato non più menzionato nel codice, fai riferimento a
`rebase cloud resources` di seguito.

### `rebase cloud`

Tutto ciò che riguarda Rebase Cloud, attualmente in beta privata. Consulta la
[guida a Rebase Cloud](/docs/deployment/cloud/) per scoprire di cosa si tratta e cosa non è incluso
nella versione beta.

Ogni gruppo risponde a `--help`, e `--help` non esegue mai il comando. La maggior parte dei comandi
opera sul progetto collegato in `.rebase/cloud.json`; `--project <id>` permette di operare su un
progetto specifico senza collegarlo.

Tre opzioni sono applicabili universalmente: `--json` per l'output machine-readable (attivo
anche di default quando indirizzato in pipe o con `REBASE_JSON=1`), `--url <origin>` per indirizzare un
piano di controllo specifico (oppure `REBASE_CLOUD_URL`), e `--project, -p <id>`.

#### Auth

```bash
rebase cloud login      # sign in to the control plane
rebase cloud logout     # sign out
rebase cloud whoami     # show the current session
```

#### Collegamento progetto

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

`deploy` senza il nome di un'applicazione distribuisce il backend.

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

`db connect` apre una porta locale che *corrisponde* al database gestito (senza endpoint
pubblico) fino a quando non viene interrotto con Ctrl-C; `--reveal` mostra la password. Riservato a owner o admin.

#### Risorse

Ciò che la piattaforma gestisce per il progetto, a confronto con quanto dichiarato dal codice.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un deploy non rimuove mai un database provisionato quando la sua dichiarazione viene eliminata — ciò
comporterebbe la perdita di dati a seguito di un push. Viene mantenuto, associato e fatturato fino a quando
non viene eliminato esplicitamente specificandone il nome.

#### Compute

Le risorse di calcolo riservate dal progetto e i relativi costi.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` accetta `--cpu`, `--memory`, `--replicas`, `--spot`,
`--scale-to-zero`, `--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` e `--no-autoscale`.
Non sono presenti piani a livelli: la tariffazione è calcolata per risorsa. Consulta
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

Crea tipi TypeScript e un client typesafe per tutte le tue collection.

### `rebase doctor`

```bash
rebase doctor
```

Il comando da eseguire quando si verificano problemi di origine sconosciuta. Esegue
un'analisi diagnostica senza modificare nulla, risultando sicuro da eseguire su qualsiasi database raggiungibile.

**Senza database.** Questi controlli vengono eseguiti per primi, poiché qualsiasi elemento che impedisca
del tutto l'avvio del progetto si verifica prima di poter verificare le tabelle:

| Controllo | Motivo |
| --- | --- |
| Versione di Node | Confrontata con l'intervallo dichiarato dalla CLI. Una versione obsoleta non viene segnalata come "Node non supportato", bensì come errore di sintassi all'interno di una dipendenza. |
| Package manager | Rilevamento di lockfile duplicati nello stesso progetto. L'esecuzione di `npm install` all'interno di un workspace pnpm riscrive la struttura di `node_modules` in modo incompatibile con pnpm, manifestando errori `Cannot find module` a distanza di tempo. |
| Slug duplicati | Il registro mantiene l'ultima collection registrata, per cui l'altra non risulterà mancante, ma verrà servita come versione vincente sotto il proprio nome. |
| Verifica `.env` | Verifica la presenza di un `JWT_SECRET` inferiore a 32 caratteri (che impedisce l'avvio in produzione) e di `NODE_ENV=production` configurato senza `CORS_ORIGINS` né `FRONTEND_URL`. I valori non vengono mai stampati a video. |
| Disallineamento versioni `@rebasepro/*` | Lo stesso pacchetto vincolato a versioni diverse tra i vari file `package.json` del progetto. La presenza di due copie compromette il funzionamento di `instanceof`, causando il fallimento dei type guard che rigettano il proprio stesso tipo. |
| Stringhe di connessione | Carattere `=` non codificato all'interno di un parametro URL, che gli strumenti nativi di PostgreSQL non riescono ad analizzare, provocando il blocco di backup e `psql` mentre l'applicazione continua a funzionare. |
| Funzioni personalizzate | Verifica dei requisiti di ciascuna funzione rispetto all'host e identificazione di quelle non compatibili con un runtime edge. |

**Sul database**, quando `DATABASE_URL` è impostato:

| Controllo | Motivo |
| --- | --- |
| Collection → schema generato | Verifica che `schema.generated.ts` non sia obsoleto. |
| Collection → database | Verifica l'assenza di tabelle, colonne, enum, chiavi esterne e tabelle ponte (junction). |
| Estensioni richieste | Una proprietà `{ type: "vector" }` necessita di pgvector, installata da Rebase solo ove esplicitamente dichiarato dal progetto. |
| Schema stamp | Verifica se il database è stato originato da queste collection. Si tratta di un hash utile a segnalare una discrepanza tra i due elementi, senza indicare quale dei due sia più recente. |
| Collection → tipi SDK | Verifica che l'SDK tipizzato generato sia aggiornato. |
| Policy RLS | Verifica che le policy del database corrispondano alle `securityRules` dichiarate e che nessuna policy faccia riferimento a ruoli non utilizzabili da questo server. |

Qualora il database risulti irraggiungibile, le relative fasi vengono contrassegnate come saltate riportando la
motivazione, mentre le restanti verifiche vengono portate a termine — consulta [Risoluzione dei problemi](/docs/troubleshooting/).

Il comando termina con codice diverso da zero se un controllo rileva un errore o se una fase non può essere completata
a causa di un database che rifiuta le connessioni. Una fase saltata per assenza della variabile
`DATABASE_URL` non viene considerata un errore.

`rebase doctor --policies` esegue esclusivamente i controlli sulle policy RLS — escludendo la verifica delle differenze di schema e dei tipi dell'SDK — e adotta una politica fail-closed, rendendolo adatto per l'utilizzo come gate di CI a fronte di un database distribuito.

### `rebase auth`

Comandi di gestione dell'autenticazione:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gestisce chiavi API di servizio con permessi specifici (scoped) — le credenziali utilizzate da un agente, uno script o un altro
servizio, a differenza della sessione di un utente finale:

```bash
rebase api-keys list
rebase api-keys create --name "Analytics" --permissions '[{"collection":"events","operations":["read"]}]'
rebase api-keys create --name "Full Access" --full-access --expires 90d
rebase api-keys revoke abc123-def456
```

`--permissions` accetta un array JSON di oggetti `{ collection, operations }`, oppure puoi usare
`--full-access` per ottenere permessi di lettura/scrittura/cancellazione su ogni collection e funzione. `--expires`
accetta `7d`, `30d`, `90d`, `1y` o una data in formato ISO, mentre `--rate-limit` imposta il numero di richieste
consentite per intervallo di 15 minuti. La chiave viene mostrata una sola volta, al momento della creazione.

Le chiavi sono soggette a una doppia validazione: si applicano sia i permessi propri della chiave sia la row-level security (RLS)
dell'identità che essa rappresenta; pertanto, una chiave non potrà mai accedere a più dati di quanti ne siano consentiti a tale identità.

### `rebase skills install`

Installa le skill di riferimento di Rebase per il tuo assistente di programmazione basato su AI. Supporta
Cursor, Claude Code, Windsurf, Gemini CLI e Antigravity:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Consulta [Agent Skills](/docs/ai/skills) per l'elenco completo e i percorsi in cui vengono scritti i file.

### `rebase telemetry`

Condivisione anonima dei dati di utilizzo. **`rebase init` richiede il consenso una sola volta per progetto, e la scelta
predefinita è sì — non viene inviato alcun dato senza un'esplicita risposta:**

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` stampa l'impostazione corrente, `show` stampa l'esatto payload che verrebbe inviato —
a prescindere che la condivisione sia abilitata o meno, consentendo di ispezionare i dati prima di scegliere — mentre
gli altri due comandi ne modificano lo stato. Se non hai mai eseguito `init`, nessun dato è mai stato raccolto.

## Flusso di lavoro per le migrazioni

Il flusso tipico per le modifiche allo schema:

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
- **[Quickstart](/docs/getting-started/quickstart)** — Primi passi

---
