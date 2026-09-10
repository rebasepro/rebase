---
sourceHash: 97dd0e836d51f599
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

## Output leggibile da macchina

`--json` è il flag dedicato e, al di fuori della famiglia `cloud`, è l'unico: `rebase status`, `rebase resources` e `rebase apps list` inviano quindi un singolo valore JSON su stdout — il risultato, oppure un envelope `{"error": {"message", "code", "hint", "issues"}}` con un codice di uscita diverso da zero — a **ogni** uscita del comando, in modo che il chiamante possa analizzare stdout incondizionatamente. Senza di esso, scrivono testo leggibile per gli umani e gli errori vanno su stderr. `rebase cloud` usa lo stesso envelope ed è l'unica eccezione al flag: attiva il JSON automaticamente anche quando stdout non è una TTY, o quando è impostato `REBASE_JSON=1`. Quindi `rebase cloud status | cat` produce JSON mentre `rebase status | cat` no — in uno script, passa `--json` esplicitamente anziché fare affidamento su una delle due regole.

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
| `--headless` | Solo backend — nessun pannello di amministrazione e nessun file di collection. `--template` non ha effetto, poiché non ci sono collection da inizializzare |
| `-y, --yes` | Non chiede mai conferme. **Richiesto ovunque non ci sia un terminale interattivo**, come nella CI. Salta git init e l'installazione delle dipendenze — le impostazioni interattive predefinite rispondono affermativamente a entrambi, quindi passa `--git` / `--install` se li desideri |
| `-i, --install` | Installa le dipendenze dopo lo scaffolding |
| `-g, --git` | Inizializza un repository ed esegue il primo commit |
| `--database-url <url>` | Usa un database esistente invece di quello gestito |
| `--introspect` | Genera le collection a partire da quel database. Implica `--template blank` e richiede `--install` |
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

Il bundle è l'artefatto che distribuisci — l'immagine di runtime lo carica, quindi non c'è un'immagine dell'applicazione da compilare autonomamente. Flag utili:

| Flag | Effetto |
|------|---------|
| `--out <dir>` | Scrive il bundle in una posizione diversa da `dist-bundle/` |
| `--vendor` | Installa e include sempre le dipendenze nel bundle |
| `--no-vendor` | Non include mai le dipendenze; il pod le installerà al primo avvio |
| `--skip-type-check` | Salta il controllo dei tipi (più veloce, meno sicuro) |
| `--no-static` | Salta la compilazione del frontend |

Le dipendenze vengono incluse nel bundle (vendored) per impostazione predefinita, in modo che un riavvio del pod non richieda un'installazione da 35–55 secondi. Un albero che supera i 200 MB su disco viene invece escluso, poiché il limite di caricamento è di 100 MB compressi — consulta il changelog per la motivazione completa.

### `rebase start`

Esegue il bundle compilato come server di produzione:

```bash
rebase start
```

Legge `PORT` e il resto di `.env`, a differenza di `rebase dev`. Indirizzalo verso un bundle situato altrove con `rebase start --bundle ./dist-bundle`.

### `rebase apps list`

Mostra le app dichiarate da questo repository:

```bash
rebase apps list
```

Un repository può dichiarare più di un'app distribuibile — ad esempio un backend e un sito di marketing. In questo modo puoi verificare su cosa agiranno `rebase build` e il deployment.

### `rebase eject`

Prendi il controllo del processo server e della sua immagine:

```bash
rebase eject
```

Scrive l'entrypoint del backend e un `Dockerfile` all'interno del progetto e converte il backend, in modo che il repository compili la propria immagine invece di eseguire il runtime pubblicato. Da quel momento in poi **gli aggiornamenti del runtime della piattaforma non lo raggiungeranno più**, e CORS, configurazione dell'autenticazione, archiviazione e arresto saranno a tuo carico.

Visualizza un'anteprima con `rebase eject --dry-run`, che mostra cosa cambierebbe senza modificare nulla. `--force` sostituisce un file `backend/src/index.ts` o `env.ts` esistente, salvando il file corrente come `<name>.bak`.

### `rebase schema generate`

Genera lo schema Drizzle ORM a partire dalle tue collection TypeScript:

```bash
rebase schema generate
```

Questo comando legge le tue collection da `config/collections/` e genera `backend/src/schema.generated.ts` con le definizioni delle tabelle Drizzle, gli enum e le relazioni.

### `rebase db push`

Applica le modifiche allo schema direttamente al database (solo per sviluppo):

```bash
rebase db push
```

:::caution
`db push` modifica il database direttamente senza file di migrazione. Usa `db generate` + `db migrate` per la produzione.
:::

### `rebase db generate`

Genera i file di migrazione SQL a partire dalle modifiche allo schema:

```bash
rebase db generate
```

Crea file di migrazione con timestamp in `drizzle/` che possono essere revisionati e sottoposti a commit.

### `rebase db migrate`

Esegue le migrazioni del database in sospeso:

```bash
rebase db migrate
```

Applica al database tutte le migrazioni non ancora eseguite.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups                       # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` esegue `pg_dump`; `restore` esegue `pg_restore` ed è distruttivo, quindi richiede `--yes`. `--out` accetta un percorso locale o un URL di object storage e assume come valore predefinito `$BACKUP_DESTINATION` o `./backups`.

### `rebase db pull`

Copia un altro database in quello di sviluppo locale:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--anonymize` sostituisce i dati personali durante l'importazione, in modo da poter lavorare localmente su una copia di produzione senza trasferire dati reali dei clienti sul proprio computer.

`pg_dump` rimuove i privilegi, quindi la copia arriverebbe con le policy RLS di origine senza alcuna delle concessioni sottostanti — con ogni lettura come `rebase_user` che fallirebbe con `permission denied`. L'operazione di pull ripristina successivamente i ruoli dell'app, impiegando la stessa routine usata all'avvio e da `rebase db push`, garantendo che le tabelle interne di Rebase rimangano revocate come previsto.

La destinazione è sempre il database di sviluppo locale di questo progetto e non può essere modificata: `--database-url` viene rifiutato anziché accettato, quindi non c'è modo di eseguire un "pull in produzione". `--from` è l'unica direzione consentita.

### `rebase db url`

Stampa la stringa di connessione utilizzata da questo progetto, e nient'altro, consentendone l'uso in pipe:

```bash
rebase db url
psql "$(rebase db url)"
```

Il database di sviluppo gestito è il caso principale in cui serve questo comando: `.env` lascia intenzionalmente commentato `DATABASE_URL`, e la porta viene ricavata dal percorso del progetto, quindi nulla su disco la specifica esplicitamente. Se hai impostato un tuo `DATABASE_URL`, verrà stampato quest'ultimo — l'ordine di risoluzione è lo stesso seguito da tutti gli altri comandi. Se non è già in esecuzione, avvia automaticamente il database gestito.

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

PostgreSQL non copia né elimina un database a cui è connesso qualsiasi altro processo, e di solito quel processo è la tua stessa istanza di `rebase dev`. `create` e `delete` indicano cosa sta tenendo occupato il database; `--force` termina prima quelle sessioni.

Ogni branch è una copia completa su disco, pertanto richiede una pulizia periodica. `prune` rimuove tre elementi: una voce il cui database è stato eliminato all'esterno di Rebase, un database di branch la cui voce non è mai stata registrata e — solo specificando `--older-than` — i branch che superano l'età indicata. Chiede conferma prima di eliminare qualsiasi elemento, a meno che non venga passato `--yes`.

`switch` registra il branch in `.rebase/branch.json` e non modifica mai `.env`. Ha la precedenza su `DATABASE_URL` in `.env`, ma è subordinato a `--database-url` o a un `DATABASE_URL` impostato nella shell, quindi un flag sulla riga di comando ha sempre priorità rispetto a uno switch precedente. L'eliminazione del branch su cui ci si trova riporta al database principale anziché lasciare l'ambiente puntato su un database inesistente.

:::note[Non disponibile sul database di sviluppo gestito]
`push`, `generate` e `migrate` pianificano le operazioni tramite Atlas, che necessita di un secondo database vuoto per il confronto — e l'istanza gestita di PGlite ne gestisce esattamente uno solo. Eseguire questi comandi lì si interrompe mostrando un messaggio esplicativo. Punta `DATABASE_URL` su un vero PostgreSQL per il flusso di lavoro delle migrazioni; `rebase dev` crea già in modalità additiva le tabelle mancanti sul database gestito.

Anche `branch` viene rifiutato per una ragione analoga. `CREATE DATABASE ... TEMPLATE` su PGlite registra una voce di catalogo senza copiare nulla, quindi il branch farebbe riferimento al database da cui è stato clonato — ogni scrittura destinata a rimanere isolata finirebbe nel tuo database di sviluppo. `rebase dev --docker` mette a disposizione un vero server su cui i branch possono operare regolarmente.
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

Tre file determinano le risorse accessibili da un backend, e questo comando li illustra tutti insieme:
`rebase.json` specifica la posizione del codice e chi esegue il server,
`config/resources.ts` descrive le esigenze del progetto e l'ambiente definisce
come raggiungere ogni risorsa. Tutto il resto — `rebase.resources.json`, il manifest
del bundle — viene generato a partire da quest'ultimo a beneficio dei processi che non possono
eseguire il tuo codice, e non deve mai essere modificato a mano.

Un cerchio `○` rappresenta lo stato più utile da rilevare prima di un deploy anziché dopo:
dichiarato, ma non configurato. Una `✗` indica che l'ambiente imposta qualcosa in modo *errato*,
provocando il blocco dell'avvio anziché un funzionamento degradato.

### `rebase resources`

Tutto ciò di cui il progetto dichiara di aver bisogno — i database, i bucket, i topic e
le code richiesti dal codice di configurazione, oltre ai cron e alle funzioni definiti nei file:

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` è un'opzione recente — il flag che un job di CI utilizza per fallire
qualora il file `rebase.resources.json` non corrisponda più al codice di configurazione.

Una risorsa viene dichiarata nel codice di configurazione — `database("analytics")`,
`bucket("media")`, `topic("signups")`, `queue("thumbnails")` — oppure corrisponde a un file
sotto `backend/crons` o `backend/functions`, e non viene mai scritta a mano in
`rebase.resources.json`, che è generato da queste dichiarazioni in modo che un host possa
leggere i requisiti del progetto senza doverlo compilare. Ciascuna voce tiene traccia di chi la impiega
(`collection:events`, `property:posts.cover`, `function:report`).

Un backend dispone inoltre di un database e di una sorgente di archiviazione predefiniti che nessuno
dichiara esplicitamente. Entrambi vengono elencati qui, contrassegnati come `implicit`, e nessuno dei due
è scritto in `rebase.resources.json` — l'host li fornisce in automatico, perciò registrarli
richiederebbe il provisioning di risorse non richieste.

Per confrontare le risorse mantenute dalla piattaforma con quelle dichiarate nel codice,
e per eliminare un database di cui è stato effettuato il provisioning ma che non è più presente nel codice,
consulta `rebase cloud resources` di seguito.

### `rebase cloud`

Tutto ciò che riguarda Rebase Cloud, attualmente in beta privata. Consulta la
[guida a Rebase Cloud](/docs/deployment/cloud/) per scoprire in cosa consiste e cosa
non include la beta.

Ogni gruppo accetta `--help`, e `--help` non esegue mai il comando. La maggior parte dei comandi
agisce sul progetto collegato in `.rebase/cloud.json`; `--project <id>` opera su uno
specifico progetto senza effettuare il collegamento.

Tre opzioni sono valide ovunque: `--json` per l'output leggibile da macchina (impostazione
predefinita anche tramite pipe o con `REBASE_JSON=1`), `--url <origin>` per puntare a un
control plane specifico (oppure `REBASE_CLOUD_URL`), e `--project, -p <id>`.

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

#### Deploy e osservabilità

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

`deploy` eseguito senza il nome di un'app distribuisce il backend.

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

Ciò che la piattaforma riserva per il progetto, a fronte di quanto dichiarato dal codice.

```bash
rebase cloud resources                       # each database and bucket: declared? provisioned?
rebase cloud resources prune database <key>  # remove one the code no longer declares
```

Un deploy non elimina mai un database sottoposto a provisioning quando la relativa dichiarazione viene rimossa — questo
comporterebbe la perdita di dati causata da un push. Il database viene mantenuto, associato e fatturato finché
qualcuno non lo rimuove esplicitamente indicandone il nome con prune.

#### Compute

Cosa riserva il progetto e quali sono i relativi costi.

```bash
rebase cloud compute            # the current reservation and its monthly cost
rebase cloud compute set        # change it
```

`compute set` accetta i parametri `--cpu`, `--memory`, `--replicas`, `--spot`,
`--scale-to-zero`, `--db-mode`, `--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` e `--no-autoscale`.
Non esistono livelli di abbonamento: i prezzi sono calcolati in base alla singola risorsa. Consulta
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

Genera un client SDK tipizzato a partire dalle definizioni delle collection:

```bash
rebase generate-sdk
```

Crea i tipi TypeScript e un client type-safe per tutte le tue collection.

### `rebase doctor`

```bash
rebase doctor
```

Il comando da eseguire quando qualcosa non funziona e non se ne conosce ancora il motivo. Si limita a
rilevare e segnalare senza apportare modifiche, pertanto è sicuro da eseguire su qualsiasi database raggiungibile.

**Senza database.** Questi controlli vengono eseguiti per primi, poiché tutto ciò che impedisce a un progetto
di avviarsi si verifica prima ancora che sia possibile esaminare una tabella:

| Controllo | Motivo |
| --- | --- |
| Versione di Node | Verifica rispetto all'intervallo dichiarato dalla CLI. Una versione obsoleta non viene segnalata come "Node non supportato", bensì come errore di sintassi all'interno di una dipendenza. |
| Gestori di pacchetti | Rileva due file di lock all'interno dello stesso progetto. L'esecuzione di `npm install` in un workspace pnpm riscrive `node_modules` secondo una struttura incompatibile con pnpm, causando errori di tipo `Cannot find module` ore dopo. |
| Slug duplicati | Il registro mantiene l'ultima collection registrata, quindi l'altra non viene segnalata come mancante: viene invece servita come prevalente, con il proprio nome. |
| Integrità di `.env` | Verifica che `JWT_SECRET` non sia inferiore a 32 caratteri (condizione che impedisce l'avvio in produzione) e che `NODE_ENV=production` non sia privo di `CORS_ORIGINS` e `FRONTEND_URL`. I valori non vengono mai stampati a video. |
| Discrepanza di versione `@rebasepro/*` | Verifica se lo stesso pacchetto è bloccato su versioni differenti nei vari file `package.json` del progetto. La presenza di due copie compromette l'uso di `instanceof` tra di esse, provocando il fallimento di un type guard che rigetta il proprio stesso tipo. |
| Stringhe di connessione | Verifica la presenza di caratteri `=` non codificati nei parametri dell'URL, che gli strumenti nativi di PostgreSQL non riescono ad analizzare — causando il malfunzionamento di backup e `psql` mentre l'applicazione continua a funzionare. |
| Funzioni personalizzate | Verifica ciò di cui ogni funzione ha bisogno dall'host e quali di esse non potrebbero essere eseguite su un runtime edge. |

**Sul database**, quando è impostato `DATABASE_URL`:

| Controllo | Motivo |
| --- | --- |
| Collection → schema generato | Verifica se `schema.generated.ts` non è aggiornato. |
| Collection → database | Controlla la presenza di tabelle, colonne, enum, chiavi esterne e tabelle di giunzione mancanti. |
| Estensioni richieste | Una proprietà `{ type: "vector" }` necessita di pgvector, che Rebase installa unicamente se dichiarato nel progetto. |
| Schema stamp | Verifica se il database è stato predisposto a partire da queste collection. Trattandosi di un hash, indica se le due parti non concordano, senza specificare quale sia più recente. |
| Collection → tipi SDK | Verifica se l'SDK tipizzato generato non è aggiornato. |
| Policy RLS | Controlla se le policy del database corrispondono alle `securityRules` dichiarate e se qualche policy fa riferimento a un ruolo non utilizzabile dal server. |

Se il database non è raggiungibile, le relative fasi vengono contrassegnate come saltate indicandone il motivo e
i controlli rimanenti vengono comunque portati a termine — consulta la [Risoluzione dei problemi](/docs/troubleshooting/).

Il comando termina con un codice diverso da zero se un controllo rileva un errore o se una fase non può essere completata
a causa del database che rifiuta le connessioni. Una fase saltata per via della mancata impostazione di `DATABASE_URL` non costituisce un errore.

`rebase doctor --policies` esegue solo i controlli relativi a RLS — senza calcolare le differenze di schema né verificare i tipi dell'SDK — e si arresta in modalità "fail closed", rappresentando la variante consigliata da utilizzare come controllo (gate) di CI su un database già distribuito.

### `rebase auth`

Comandi per la gestione dell'autenticazione:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gestisce le chiavi API con privilegi limitati per i servizi — la credenziale utilizzata da un agente, uno script o un
servizio esterno, a differenza della sessione di un utente finale:

```bash
rebase api-keys list
rebase api-keys create --name "Analytics" --permissions '[{"collection":"events","operations":["read"]}]'
rebase api-keys create --name "Full Access" --full-access --expires 90d
rebase api-keys revoke abc123-def456
```

`--permissions` accetta un array JSON di oggetti `{ collection, operations }`, oppure è possibile utilizzare
`--full-access` per concedere permessi di lettura/scrittura/cancellazione su qualsiasi collection e funzione. `--expires`
accetta `7d`, `30d`, `90d`, `1y` o una data in formato ISO, mentre `--rate-limit` definisce le richieste massime
per ogni intervallo di 15 minuti. La chiave viene mostrata una sola volta, al momento della creazione.

Le chiavi prevedono una doppia verifica: si applicano sia i permessi propri della chiave sia la row-level security
dell'identità per conto della quale agisce, impedendo alla chiave di accedere a più dati rispetto a quanti ne siano consentiti all'identità.

### `rebase skills install`

Installa le skill di riferimento di Rebase per il tuo assistente di sviluppo AI. Supporta
Cursor, Claude Code, Windsurf, Gemini CLI e Antigravity:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Consulta [Agent Skills](/docs/ai/skills) per visualizzare l'elenco completo e le directory di destinazione dei file.

### `rebase telemetry`

Condivisione anonima dei dati di utilizzo. **`rebase init` lo richiede una sola volta per progetto, e la risposta predefinita è affermativa — nessun dato viene trasmesso prima di aver risposto:**

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` visualizza l'impostazione corrente, `show` stampa nel dettaglio il payload che verrebbe inviato —
a prescindere dal fatto che la condivisione sia abilitata, permettendo di verificarne i dati prima di scegliere — mentre
gli altri due comandi ne modificano lo stato. Se non hai mai eseguito `init`, nessun dato è mai stato raccolto.

## Flusso di lavoro per le migrazioni

Il tipico flusso di lavoro per applicare modifiche allo schema:

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
- **[Quickstart](/docs/getting-started/quickstart)** — Inizia subito

---
