---
sourceHash: a3fccf5118b08dd0
title: Riferimento della CLI
sidebar_label: CLI
description: Comandi della CLI di Rebase per inizializzare progetti, generare schemi, migrare database e generare l'SDK.
---

## Panoramica

La CLI di Rebase (`rebase`) gestisce il tuo progetto dallo scaffolding alla distribuzione.

## Installation

```bash
pnpm add -g @rebasepro/cli
```

Oppure usala tramite `pnpm dlx`:

```bash
pnpm dlx @rebasepro/cli <command>
```

## Output leggibile dalle macchine

<span class="since-badge" data-since="0.18">Since 0.18</span>

`--json` è l'interruttore, e fuori dalla famiglia `cloud` è l'unico:
`rebase status`, `rebase resources` e `rebase apps list` scrivono allora un
singolo valore JSON su stdout — il risultato, oppure un involucro
`{"error": {"message", "code", "hint", "issues"}}` con uscita diversa da zero —
a **ogni** uscita del comando, così chi lo invoca può fare il parsing di stdout
senza condizioni. Senza di esso scrivono testo per persone e gli errori vanno su
stderr. `rebase cloud` usa lo stesso involucro ed è l'unica eccezione
all'interruttore: attiva il JSON anche da sé quando stdout non è un TTY, o quando
è impostato `REBASE_JSON=1`. Quindi `rebase cloud status | cat` è JSON mentre
`rebase status | cat` no — in uno script passa `--json` esplicitamente invece di
affidarti a una delle due regole.

## Comandi

### `rebase init`

Inizializza un nuovo progetto Rebase:

```bash
rebase init [directory]
```

Prepara la struttura del progetto con i pacchetti frontend, backend e condivisi.

| Flag | Cosa fa |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` o `blank`. Predefinito `blog` |
| `--headless` | Solo backend — nessun pannello di amministrazione e nessun file di collezione. `--template` non ha effetto, perché non ci sono collezioni da creare |
| `-y, --yes` | Non chiede mai nulla. **Necessario ovunque non ci sia un terminale a rispondere**, come in CI. Salta `git init` e l'installazione delle dipendenze — i valori interattivi predefiniti dicono sì a entrambi, quindi passa `--git` / `--install` se li vuoi |
| `-i, --install` | Installare le dipendenze dopo lo scaffolding |
| `-g, --git` | Inizializzare un repository e fare il primo commit |
| `--database-url <url>` | Usare un database esistente al posto di quello gestito |
| `--introspect` | Generare le collezioni da quel database. Implica `--template blank` e richiede `--install` |
| `--project <slug>` | Collegare lo scaffold a un progetto Rebase Cloud |
| `--setup-key <key>` | La chiave monouso che autentica quel collegamento |

### `rebase dev`

Avvia il server di sviluppo:

```bash
rebase dev
```

Avvia sia il frontend sia il backend con hot reloading.

Entrambe le porte derivano dal percorso del progetto, così più progetti Rebase
possono girare affiancati. Usa gli URL che `rebase dev` stampa. Ne fissi una con
`rebase dev --port 3001`.

### `rebase build`

Compila il progetto in un bundle distribuibile in `dist-bundle/`:

```bash
rebase build
```

Il bundle è l'artefatto che distribuisci — l'immagine del runtime lo carica,
quindi non c'è nessuna immagine applicativa da costruire tu. Flag utili:

| Flag | Effetto |
|------|--------|
| `--out <dir>` | Scrivere il bundle altrove rispetto a `dist-bundle/` |
| `--vendor` | Installare e spedire sempre le dipendenze del bundle |
| `--no-vendor` | Non includerle mai; il pod installa al primo avvio |
| `--skip-type-check` | Saltare il controllo dei tipi (più rapido, meno sicuro) |
| `--no-static` | Saltare la compilazione del frontend |

Le dipendenze vengono incluse per impostazione predefinita, così il riavvio di un
pod non paga 35–55 secondi di installazione. Un albero che supera i 200 MB su
disco viene invece scartato, perché il limite di caricamento è 100 MB compressi —
il ragionamento è nel changelog.

### `rebase start`

Esegui il bundle compilato come server di produzione:

```bash
rebase start
```

Legge `PORT` e il resto di `.env`, a differenza di `rebase dev`. Puntalo a un
bundle altrove con `rebase start --bundle ./dist-bundle`.

### `rebase apps list`

Mostra le app che questo repository dichiara:

```bash
rebase apps list
```

Un repository può dichiarare più di un'app distribuibile — un backend e un sito di
marketing, per dire. È così che vedi su cosa agiranno `rebase build` e la
distribuzione.

### `rebase eject`

Prendi in mano il processo del server e la sua immagine:

```bash
rebase eject
```

Scrive nel progetto il punto di ingresso del backend e un `Dockerfile` e ne
commuta il backend, così il repository costruisce la propria immagine invece di
eseguire il runtime pubblicato. Da quel momento **gli aggiornamenti del runtime
della piattaforma non lo raggiungono più**, e CORS, il cablaggio
dell'autenticazione, lo storage e lo shutdown diventano affar tuo.

Vedilo in anteprima con `rebase eject --dry-run`, che elenca cosa cambierebbe e
non cambia nulla. `--force` sostituisce un `backend/src/index.ts` o `env.ts`
esistente, conservando il file attuale come `<name>.bak`.

### `rebase schema generate`

Genera lo schema Drizzle ORM dalle tue collezioni TypeScript:

```bash
rebase schema generate
```

Legge le tue collezioni da `config/collections/` e genera `backend/src/schema.generated.ts` con le definizioni di tabelle, gli enum e le relazioni di Drizzle.

### `rebase db push`

Invia le modifiche allo schema direttamente al database (solo sviluppo):

```bash
rebase db push
```

:::caution
`db push` modifica il database direttamente senza file di migrazione. Per la produzione usa `db generate` + `db migrate`.
:::

### `rebase db generate`

Genera i file di migrazione SQL dalle modifiche allo schema:

```bash
rebase db generate
```

Crea in `drizzle/` file di migrazione con marca temporale, che possono essere revisionati e committati.

### `rebase db migrate`

Esegue le migrazioni del database in sospeso:

```bash
rebase db migrate
```

Applica al database tutte le migrazioni non ancora applicate.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups                       # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` esegue `pg_dump`; `restore` esegue `pg_restore` ed è distruttivo, quindi
richiede `--yes`. `--out` accetta un percorso locale o un URL di object storage e
per impostazione predefinita vale `$BACKUP_DESTINATION` o `./backups`.

### `rebase db pull`

Copia un altro database in quello di sviluppo locale:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--anonymize` sostituisce i campi personali durante l'importazione, così una copia
di produzione può essere lavorata in locale senza portarsi dati reali dei clienti
su un portatile.

`pg_dump` rimuove i privilegi, quindi la copia arriverebbe con le policy RLS
dell'origine e senza nessuno dei grant che ci stanno dietro — ogni lettura come
`rebase_user` fallirebbe con `permission denied`. Il pull ri-provisiona poi il
ruolo applicativo, con la stessa routine usata dal boot e da `rebase db push`,
così le tabelle interne di Rebase restano revocate come devono.

La destinazione è sempre il database di sviluppo locale di questo progetto e non
si può scegliere: `--database-url` viene rifiutato anziché accettato, quindi non
c'è modo di scrivere «tira in produzione». `--from` è l'unica direzione.

### `rebase db url`

Stampa la stringa di connessione che questo progetto sta usando, e nient'altro,
così si può mettere in pipe:

```bash
rebase db url
psql "$(rebase db url)"
```

Il database di sviluppo gestito è il caso che ne ha bisogno: `.env` lascia
`DATABASE_URL` commentata di proposito, e la porta deriva dal percorso del
progetto, quindi nulla su disco la nomina. Quando hai impostato una tua
`DATABASE_URL`, è quella che viene stampata — l'ordine di risoluzione è lo stesso
che segue ogni altro comando. Avvia il database gestito se non è già in
esecuzione.

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

PostgreSQL non copia né elimina un database a cui è connesso qualcos'altro, e
quel «qualcos'altro» di solito è il tuo `rebase dev`. `create` e `delete` dicono
cosa sta tenendo aperto il database; `--force` disconnette prima quelle sessioni.

<span class="since-badge" data-since="0.18">Since 0.18</span> Ogni branch è una copia completa su disco, quindi vanno ripuliti. `prune` rimuove
tre cose: una voce il cui database è stato eliminato fuori da Rebase, un database
di branch la cui voce non è mai stata scritta e — solo con `--older-than` — i
branch più vecchi di un'età che indichi tu. Chiede conferma prima di rimuovere
qualsiasi cosa, a meno che tu non passi `--yes`.

<span class="since-badge" data-since="0.18">Since 0.18</span> `switch` registra il branch in `.rebase/branch.json` e non modifica mai `.env`.
Ha la precedenza su `DATABASE_URL` in `.env` e cede a `--database-url` o a una
`DATABASE_URL` nella shell, così un flag sulla riga di comando batte sempre uno
switch fatto prima. Eliminare il branch su cui ti trovi ti riporta al database
principale, invece di lasciare il checkout puntato a un database che non c'è
più.

:::note[Non sul database di sviluppo gestito]
`push`, `generate` e `migrate` pianificano il proprio lavoro con Atlas, che ha
bisogno di un secondo database vuoto con cui confrontarsi — e il PGlite gestito ne
serve esattamente uno. Eseguirli lì si ferma con un messaggio che lo dice. Punta
`DATABASE_URL` a un PostgreSQL vero per il flusso di migrazione; `rebase dev` crea
già in modo additivo le tabelle mancanti su quello gestito.

`branch` lì viene rifiutato per un motivo affine.
`CREATE DATABASE ... TEMPLATE` contro PGlite scrive una voce di catalogo e non
copia nulla, quindi il branch si risolverebbe sul database da cui è stato clonato
— ogni scrittura che volevi isolare finirebbe nel tuo database di sviluppo.
`rebase dev --docker` ti dà un server vero su cui i branch funzionano.
:::

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init <name>      # register a new app in rebase.json
rebase apps config <app>     # what one app resolves to
```

### `rebase status`

<span class="since-badge" data-since="0.18">Since 0.18</span>

Tutto ciò che questo progetto dichiara, e se l'ambiente lo lega davvero:

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

Tre file decidono cosa può raggiungere un backend, e questo li stampa tutti e tre
insieme: `rebase.json` dice dov'è il tuo codice e chi esegue il server,
`config/resources.ts` dice di cosa ha bisogno il progetto, e l'ambiente dice come
raggiungere ogni cosa. Tutto il resto — `rebase.resources.json`, il manifest del
bundle — è generato da quello di mezzo per lettori che non possono eseguire il tuo
codice, e non lo scrivi mai.

Un `○` è lo stato che conviene conoscere prima di una distribuzione e non dopo:
dichiarato, non configurato. Un `✗` significa che l'ambiente imposta qualcosa
*male*, e questo rifiuta il boot invece di degradare.

### `rebase resources`

Ciò che questo progetto dichiara di avere bisogno — i database, i bucket, i topic
e le code che il suo codice di configurazione chiede, e i cron e le function che i
suoi file definiscono:

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` è nuovo <span class="since-badge" data-since="0.18">Since 0.18</span> — il flag che un job di CI usa per fallire su un `rebase.resources.json` che non
corrisponde più al codice di configurazione.

Una risorsa viene dichiarata nel codice di configurazione —
`database("analytics")`, `bucket("media")`, `topic("signups")`,
`queue("thumbnails")` — oppure è un file sotto `backend/crons` o
`backend/functions`, e non viene mai scritta a mano in `rebase.resources.json`,
che è generato da quelle dichiarazioni perché un host possa leggere di cosa ha
bisogno un progetto senza compilarlo. Ogni voce registra chi la usa
(`collection:events`, `property:posts.cover`, `function:report`).

Un backend ha anche un database predefinito e una sorgente di storage predefinita
che nessuno dichiara. Entrambi sono elencati qui, marcati `implicit`, e nessuno
dei due viene scritto in `rebase.resources.json` — li fornisce l'host, quindi
registrarli equivarrebbe a chiedere il provisioning di qualcosa che nessuno ha
richiesto.

Per vedere cosa la piattaforma tiene per un progetto rispetto a ciò che il suo
codice dichiara, e per rimuovere un database provisionato che il codice non nomina
più, vedi `rebase cloud resources` qui sotto.

### `rebase cloud`

Tutto ciò che riguarda Rebase Cloud, che è in beta privata. Vedi la
[guida a Rebase Cloud](/docs/deployment/cloud/) per capire cos'è e cosa la beta non
include.

Ogni gruppo risponde a `--help`, e `--help` non esegue mai il comando. La maggior
parte dei comandi agisce sul progetto collegato in `.rebase/cloud.json`;
`--project <id>` agisce su uno senza collegarlo.

Tre opzioni valgono ovunque: `--json` per un output leggibile dalle macchine
(anche il valore predefinito in pipe, o con `REBASE_JSON=1`), `--url <origin>` per
puntare a uno specifico control plane (o `REBASE_CLOUD_URL`), e
`--project, -p <id>`.

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

#### Distribuire e osservare

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

`deploy` senza nome dell'app distribuisce il backend.

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
rebase cloud db list | create | info | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

#### Risorse

Ciò che la piattaforma tiene per il progetto, rispetto a ciò che il suo codice dichiara.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Una distribuzione non rimuove mai un database provisionato quando la sua
dichiarazione sparisce — sarebbero dati cancellati da un push. Lo conserva, lo
lega e lo fattura finché qualcuno non lo elimina per nome.

#### Compute

Ciò che il progetto riserva, e quanto costa.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` accetta `--cpu`, `--memory`, `--replicas`, `--spot`,
`--scale-to-zero`, `--db-mode`, `--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` e `--no-autoscale`. Non
esistono fasce di piano: tutto è prezzato per risorsa. Vedi
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

Genera un SDK client tipizzato dalle tue definizioni di collezione:

```bash
rebase generate-sdk
```

Crea i tipi TypeScript e un client type-safe per tutte le tue collezioni.

### `rebase doctor`

```bash
rebase doctor
```

Il comando da eseguire quando qualcosa non va e non sai ancora cosa. Riporta e non
cambia mai nulla, quindi è sicuro su qualsiasi database tu possa raggiungere.

**Senza database.** Questi girano per primi, perché tutto ciò che impedisce a un
progetto di funzionare del tutto accade prima che si possa confrontare una
tabella:

| Controllo | Perché |
| --- | --- |
| Versione di Node | Rispetto all'intervallo che la CLI dichiara. Una versione troppo vecchia non viene segnalata come «Node non supportato» — è un errore di sintassi dentro una dipendenza. |
| Gestori di pacchetti | Due lockfile in un solo progetto. `npm install` in un workspace pnpm riscrive `node_modules` in un layout con cui pnpm non è d'accordo, e il sintomo è un `Cannot find module` ore dopo. |
| Slug duplicati | Il registro tiene l'ultima collezione registrata, quindi l'altra non viene segnalata come mancante — viene servita come vincitrice, sotto il proprio nome. |
| Sanità di `.env` | Un `JWT_SECRET` più corto di 32 caratteri (con cui la produzione si rifiuta di avviarsi), e `NODE_ENV=production` senza né `CORS_ORIGINS` né `FRONTEND_URL`. I valori non vengono mai stampati. |
| Disallineamento di versione di `@rebasepro/*` | Lo stesso pacchetto fissato a versioni diverse nei vari `package.json` del progetto. Due copie rompono `instanceof` tra loro, che fallisce come type guard che rifiuta il proprio tipo. |
| Stringhe di connessione | Un `=` non codificato in un parametro dell'URL, che gli strumenti stessi di PostgreSQL si rifiutano di interpretare — quindi backup e `psql` si rompono mentre l'app continua a funzionare. |
| Function personalizzate | Cosa serve a ogni function dal suo host, e quali di esse non girerebbero su un runtime edge. |

**Sul database**, quando `DATABASE_URL` è impostata:

| Controllo | Perché |
| --- | --- |
| Collezioni → schema generato | Se `schema.generated.ts` è obsoleto. |
| Collezioni → database | Tabelle, colonne, enum, chiavi esterne e tabelle di giunzione mancanti. |
| Estensioni richieste | Una proprietà `{ type: "vector" }` richiede pgvector, che Rebase installa solo dove un progetto lo ha dichiarato. |
| Timbro dello schema | Se questo database è stato provisionato da queste collezioni. È un hash, quindi può dire che i due non concordano e mai quale sia più avanti. |
| Collezioni → tipi dell'SDK | Se l'SDK tipizzato generato è obsoleto. |
| Policy RLS | Se le policy del database corrispondono alle `securityRules` che hai dichiarato, e se qualche policy nomina un ruolo che questo server non può usare. |

Se il database è irraggiungibile, le sue fasi vengono riportate come saltate con
il motivo e il resto viene comunque eseguito — vedi
[Risoluzione dei problemi](/docs/troubleshooting/).

Esce con codice diverso da zero quando un controllo trova un errore, o quando una
fase non ha potuto essere eseguita perché il database che le è stato dato rifiuta
le connessioni. Una fase saltata perché non hai impostato `DATABASE_URL` non è un
fallimento.

`rebase doctor --policies` esegue solo i controlli RLS — nessun diff dello schema,
nessun tipo dell'SDK — e fallisce in modo chiuso, il che lo rende la forma da
usare come gate di CI su un database distribuito.

### `rebase auth`

Comandi di gestione dell'autenticazione:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gestisci chiavi API di servizio con scope — la credenziale che un agente, uno
script o un altro servizio usa, in contrapposizione alla sessione di un utente
finale:

```bash
rebase api-keys list
rebase api-keys create --name "Analytics" --permissions '[{"collection":"events","operations":["read"]}]'
rebase api-keys create --name "Full Access" --full-access --expires 90d
rebase api-keys revoke abc123-def456
```

`--permissions` accetta un array JSON di oggetti `{ collection, operations }`,
oppure usa `--full-access` per lettura/scrittura/eliminazione su ogni collezione e
function. `--expires` accetta `7d`, `30d`, `90d`, `1y` o una data ISO, e
`--rate-limit` imposta le richieste per finestra di 15 minuti. Una chiave viene
mostrata una volta sola, alla creazione.

Le chiavi hanno un doppio cancello: valgono sia i permessi della chiave stessa sia
la row-level security dell'identità per cui agisce, quindi una chiave non può mai
leggere più di quanto possa quell'identità.

### `rebase skills install`

Installa le skill di riferimento di Rebase per il tuo assistente di programmazione
AI. Supporta Cursor, Claude Code, Windsurf, Gemini CLI e Antigravity:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Vedi [Agent Skills](/docs/ai/skills) per l'elenco completo e per sapere dove vengono scritti i file.

### `rebase telemetry`

Condivisione anonima dell'uso. **È opt-in, e resta spenta finché non la accendi:**

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` stampa l'impostazione corrente, `show` stampa esattamente ciò che
verrebbe inviato, e gli altri due la cambiano. `rebase init` lo chiede una volta;
se non hai mai eseguito `init`, non è mai stato raccolto nulla.

## Flusso di lavoro di migrazione

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

## Passi Successivi

- **[Schema come codice](/docs/architecture/schema-as-code)** — Come funziona la generazione dello schema
- **[Avvio rapido](/docs/getting-started/quickstart)** — Inizia da qui
