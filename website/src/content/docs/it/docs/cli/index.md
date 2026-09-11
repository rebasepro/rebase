---
sourceHash: ace00ff64a9b8e17
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

Oppure utilizzala tramite `pnpm dlx`:

```bash
pnpm dlx @rebasepro/cli <command>
```

## Output leggibile da macchina

`--json` è il selettore, e al di fuori della famiglia `cloud` è l'unico: `rebase status`, `rebase resources` e `rebase apps list` inviano un singolo valore JSON su stdout — il risultato, oppure un inviluppo `{"error": {"message", "code", "hint", "issues"}}` con un'uscita diversa da zero — a **ogni** uscita del comando, in modo che il chiamante possa analizzare stdout incondizionatamente. Senza questo parametro generano testo per esseri umani e gli errori vanno su stderr. `rebase cloud` usa lo stesso inviluppo ed è l'unica eccezione al selettore: attiva il JSON automaticamente anche quando stdout non è un TTY, o quando è impostato `REBASE_JSON=1`. Pertanto `rebase cloud status | cat` produce JSON mentre `rebase status | cat` no — in uno script, passa `--json` esplicitamente anziché affidarti a queste regole.

## Comandi

### `rebase init`

Inizializza un nuovo progetto Rebase:

```bash
rebase init [directory]
```

Configura la struttura del progetto con frontend, backend e pacchetti condivisi.

| Flag | Descrizione |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` o `blank`. Valore predefinito: `blog` |
| `--headless` | Solo backend — niente pannello di amministrazione e nessun file di collection. `--template` non ha effetto, poiché non ci sono collection da inserire |
| `-y, --yes` | Non richiedere mai conferme. **Obbligatorio ovunque non ci sia un terminale per rispondere**, ad esempio nella CI. Salta l'inizializzazione di git e l'installazione delle dipendenze — le risposte predefinite interattive impostano "sì" per entrambi, quindi passa `--git` / `--install` se li desideri |
| `-i, --install` | Installa le dipendenze dopo lo scaffolding |
| `-g, --git` | Inizializza un repository ed esegue il primo commit |
| `--database-url <url>` | Usa un database esistente invece di quello gestito |
| `--introspect` | Genera le collection a partire da quel database. Implica `--template blank` e richiede `--install` |
| `--project <slug>` | Collega lo scaffold a un progetto Rebase Cloud |
| `--setup-key <key>` | La chiave monouso per autenticare tale collegamento |

### `rebase dev`

Avvia il server di sviluppo:

```bash
rebase dev
```

Avvia sia il frontend che il backend con hot reloading.

Entrambe le porte sono ricavate dal percorso del progetto, permettendo a diversi progetti Rebase di essere eseguiti fianco a fianco. Usa gli URL stampati da `rebase dev`. Fissane uno specifico con `rebase dev --port 3001`.

### `rebase build`

Compila il progetto in un bundle distribuibile all'interno di `dist-bundle/`:

```bash
rebase build
```

Il bundle è l'artefatto che distribuisci — l'immagine runtime lo carica, quindi non c'è alcuna immagine dell'applicazione da compilare autonomamente. Flag utili:

| Flag | Effetto |
|------|--------|
| `--out <dir>` | Salva il bundle in una posizione diversa da `dist-bundle/` |
| `--vendor` | Installa e include sempre le dipendenze del bundle |
| `--no-vendor` | Non includere mai le dipendenze; il pod le installerà al primo avvio |
| `--skip-type-check` | Salta il controllo dei tipi (più veloce, meno sicuro) |
| `--no-static` | Salta la compilazione del frontend |

Le dipendenze vengono incluse tramite vendoring per impostazione predefinita, evitando così che un riavvio del pod richieda dai 35 ai 55 secondi di installazione. Un albero di file che supera i 200 MB su disco viene invece scartato, poiché il limite di upload è di 100 MB compressi — consulta il changelog per la motivazione.

### `rebase start`

Esegui il bundle compilato come server di produzione:

```bash
rebase start
```

Legge `PORT` e il resto di `.env`, a differenza di `rebase dev`. Indirizzalo verso un bundle situato altrove con `rebase start --bundle ./dist-bundle`.

### `rebase apps list`

Mostra le applicazioni dichiarate da questo repository:

```bash
rebase apps list
```

Un repository può dichiarare più di un'applicazione distribuibile — ad esempio un backend e un sito di marketing. Questo comando consente di vedere su quali elementi interverranno `rebase build` e il deployment.

### `rebase eject`

Prendi il controllo del processo server e della sua immagine:

```bash
rebase eject
```

Scrive l'entrypoint del backend e un `Dockerfile` all'interno del progetto e ne modifica la configurazione del backend, facendo sì che il repository compili la propria immagine invece di eseguire il runtime pubblicato. Da quel momento in poi **gli aggiornamenti del runtime della piattaforma non lo raggiungeranno più**, e la gestione di CORS, autenticazione, storage e arresto del server saranno interamente a carico tuo.

Visualizza un'anteprima con `rebase eject --dry-run`, che elenca le modifiche senza applicarne alcuna. `--force` sostituisce un eventuale `backend/src/index.ts` o `env.ts` esistente, salvando il file corrente come `<name>.bak`.

### `rebase schema generate`

Genera lo schema per Drizzle ORM a partire dalle tue collection TypeScript:

```bash
rebase schema generate
```

Questo comando legge le tue collection da `config/collections/` e genera `backend/src/schema.generated.ts` contenente definizioni di tabelle Drizzle, enum e relazioni.

### `rebase db push`

Applica le modifiche allo schema direttamente al database (solo in sviluppo):

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

Esegui le migrazioni del database in sospeso:

```bash
rebase db migrate
```

Applica tutte le migrazioni non ancora eseguite al database.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # o s3://bucket/prefix, gs://bucket/prefix
rebase db backups                       # elenca gli elementi archiviati
rebase db restore ./backups/<file>.dump --yes
```

`backup` esegue `pg_dump`; `restore` esegue `pg_restore` ed è distruttivo, quindi richiede `--yes`. `--out` accetta un percorso locale o un URL di object storage, con valore predefinito pari a `$BACKUP_DESTINATION` o `./backups`.

### `rebase db pull`

Copia un altro database in quello di sviluppo locale:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--anonymize` sostituisce i dati personali durante l'importazione, permettendo di lavorare localmente su una copia di produzione senza trasferire i dati reali dei clienti sul proprio computer.

Dato che `pg_dump` rimuove i privilegi, la copia arriverebbe con le policy RLS dell'origine ma senza i grant sottostanti — facendo fallire ogni lettura eseguita come `rebase_user` con l'errore `permission denied`. L'operazione di pull ripristina successivamente il ruolo dell'applicazione tramite la stessa procedura utilizzata all'avvio e da `rebase db push`, assicurando che le tabelle interne di Rebase rimangano inaccessibili come previsto.

La destinazione è sempre il database di sviluppo locale di questo progetto e non può essere modificata: `--database-url` viene rifiutato, rendendo impossibile specificare un "pull in produzione". `--from` è l'unica direzione consentita.

### `rebase db url`

Stampa solo la stringa di connessione attualmente in uso da questo progetto, consentendo il piping:

```bash
rebase db url
psql "$(rebase db url)"
```

Il database di sviluppo gestito è il caso tipico che ne richiede l'uso: `.env` lascia intenzionalmente commentato `DATABASE_URL` e la porta è calcolata dal percorso del progetto, per cui non vi è alcun riferimento su disco. Se hai impostato una tua `DATABASE_URL`, verrà stampata quella — l'ordine di risoluzione è identico a quello seguito da ogni altro comando. Se non è già attivo, avvia il database gestito.

### `rebase db stop` / `rebase db reset`

Solo per il database di sviluppo gestito:

```bash
rebase db stop     # lo arresta; i dati vengono conservati
rebase db reset    # lo elimina e riparte da zero
```

### `rebase db branch`

```bash
rebase db branch create <name>
rebase db branch list
rebase db branch info <name>
rebase db branch switch <name>     # passa al branch; ogni comando successivo lo seguirà
rebase db branch switch            # mostra su quale branch ti trovi
rebase db branch switch --off      # torna al database principale
rebase db branch delete <name>
rebase db branch prune [--older-than 14d] [--include-dev-diff]
```

PostgreSQL non copia né elimina un database a cui sia connesso qualcos'altro; solitamente questo "qualcos'altro" è la tua istanza di `rebase dev`. I comandi `create` e `delete` indicano cosa sta tenendo aperto il database; `--force` provvede a disconnettere preventivamente tali sessioni.

Ogni branch è una copia completa su disco, pertanto è necessario ripulirli regolarmente. `prune` rimuove tre categorie di elementi: una voce il cui database è stato eliminato all'esterno di Rebase, un database di branch la cui voce non è mai stata registrata e — solo con `--older-than` — i branch che superano una certa età specificata. Chiede conferma prima di eliminare qualsiasi elemento a meno che non venga passato `--yes`.

`switch` registra il branch in `.rebase/branch.json` senza mai modificare `.env`. Ha la precedenza rispetto a `DATABASE_URL` in `.env` e cede il passo a `--database-url` o a una variabile `DATABASE_URL` definita nella shell; pertanto un flag passato da riga di comando ha sempre priorità rispetto a un cambio effettuato in precedenza. L'eliminazione del branch su cui ti trovi ti riporta al database principale, evitando che l'ambiente rimanga puntato su un database inesistente.

:::note[Non disponibile sul database di sviluppo gestito]
`push`, `generate` e `migrate` pianificano le loro operazioni tramite Atlas, che necessita di un secondo database vuoto per effettuare il confronto — mentre il PGlite gestito ne serve esattamente uno. Eseguirli in tale contesto interromperà l'esecuzione con un messaggio apposito. Per utilizzare il workflow delle migrazioni, fai puntare `DATABASE_URL` a un'istanza reale di PostgreSQL; `rebase dev` provvede già a creare le tabelle mancanti in modalità additiva sul database gestito.

`branch` viene rifiutato per un motivo correlato. L'esecuzione di `CREATE DATABASE ... TEMPLATE` su PGlite scrive una voce di catalogo senza copiare nulla; di conseguenza il branch punterebbe allo stesso database da cui è stato clonato, facendo atterrare sul database di sviluppo ogni scrittura che intendevi isolare. `rebase dev --docker` mette a disposizione un server reale pienamente compatibile con i branch.
:::

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # le app dichiarate da questo progetto
rebase apps init <name>      # registra una nuova app in rebase.json
rebase apps config <app>     # la risoluzione dei parametri di una specifica app
```

### `rebase status`

Tutto ciò che questo progetto dichiara e il relativo stato di binding con l'ambiente:

```bash
rebase status               # ogni risorsa e le variabili che legge
rebase status --json        # leggibile da macchina
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

Tre file determinano le risorse accessibili da un backend, e questo comando li mostra tutti insieme:
`rebase.json` definisce dove si trova il codice e chi esegue il server,
`config/resources.ts` specifica le risorse necessarie al progetto, e l'ambiente indica come
raggiungere ciascuna di esse. Tutto il resto — `rebase.resources.json`, il manifest
del bundle — viene generato a partire da quello intermedio per consentirne la lettura a sistemi che non possono eseguire il tuo codice, e non va mai scritto a mano.

Il simbolo `○` evidenzia lo stato utile da conoscere prima di un deploy piuttosto che dopo:
dichiarato, non configurato. Il simbolo `✗` indica che l'ambiente ha impostato qualcosa in modo *errato*,
causando il rifiuto dell'avvio anziché un degrado controllato.

### `rebase resources`

Ciò che questo progetto dichiara come necessario — i database, i bucket, i topic e
le code richiesti dal codice di configurazione, nonché i cron e le function definiti nei suoi file:

```bash
rebase resources            # elencali
rebase resources --write    # rigenera rebase.resources.json
rebase resources --check    # fallisce se il grafo tracciato nei commit non è aggiornato
rebase resources --json     # leggibile da macchina
```

`rebase resources --check` è una nuova funzionalità — il flag utilizzato dai job di CI per segnalare un errore se `rebase.resources.json` non corrisponde più al codice di configurazione.

Una risorsa viene dichiarata nel codice di configurazione — `database("analytics")`,
`bucket("media")`, `topic("signups")`, `queue("thumbnails")` — oppure consiste in un file
in `backend/crons` o `backend/functions`. Non va mai modificata a mano in
`rebase.resources.json`, che viene generato a partire da tali dichiarazioni per consentire a un host di
leggere i requisiti di un progetto senza compilarlo. Ciascuna voce tiene traccia di chi la utilizza
(`collection:events`, `property:posts.cover`, `function:report`).

Un backend include inoltre un database predefinito e un'origine di storage predefinita che non necessitano di dichiarazione. Entrambi sono elencati qui, contrassegnati come `implicit`, e nessuno dei due viene scritto in
`rebase.resources.json` — poiché forniti direttamente dall'host, una loro registrazione comporterebbe la richiesta di provisioning per risorse non richieste.

Per confrontare le risorse allocate dalla piattaforma per un progetto con quelle dichiarate nel codice,
e per rimuovere un database allocato che il codice non referenzia più, consulta
`rebase cloud resources` di seguito.

### `rebase cloud`

Tutto ciò che riguarda Rebase Cloud, attualmente in beta privata. Consulta la
[guida a Rebase Cloud](/docs/deployment/cloud/) per scoprire le sue funzionalità e ciò che non è incluso nella beta.

Ogni gruppo di comandi supporta `--help`, e l'uso di `--help` non esegue mai il comando. La maggior parte dei comandi
agisce sul progetto collegato in `.rebase/cloud.json`; `--project <id>` permette di operare su
uno specifico progetto senza doverlo collegare.

Tre opzioni hanno valenza globale: `--json` per output leggibile da macchina (impostazione predefinita in caso di pipe o con `REBASE_JSON=1`), `--url <origin>` per indirizzare un control plane specifico (o tramite `REBASE_CLOUD_URL`), e `--project, -p <id>`.

#### Auth

```bash
rebase cloud login      # accedi al control plane
rebase cloud logout     # disconnettiti
rebase cloud whoami     # mostra la sessione corrente
```

#### Collegamento del progetto

```bash
rebase cloud link         # collega questa directory a un progetto cloud
rebase cloud link [url]   # o direttamente a un backend: nessun control plane, nessun login, e il resto della famiglia non sarà disponibile fino a unlink
rebase cloud unlink       # rimuovi il collegamento
rebase cloud use [org]    # seleziona l'organizzazione attiva
rebase cloud open         # apri la dashboard nel browser
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
rebase cloud deploy [app] [--source .]   # distribuisci un'app e trasmetti i log di build
rebase cloud logs [--runtime] [-f]       # log di build, o del processo in esecuzione
rebase cloud deployments list [--limit N|--all]
rebase cloud rollback [id] [-y]          # ripristina una distribuzione riuscita precedente
rebase cloud cancel [-y]                 # annulla la build in corso
rebase cloud start | stop | restart [-y] # stop e restart richiedono -y
rebase cloud status                      # stato immediato del progetto
rebase cloud metrics                     # metriche in tempo reale di CPU / memoria / disco
rebase cloud debug [health|logs|…]       # diagnostica una distribuzione, in sola lettura
```

`deploy` eseguito senza specificare il nome dell'applicazione distribuisce il backend.

#### Configurazione

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add | verify | remove
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # nome, branch, repo, sottodominio
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

`db connect` apre una porta locale che *è* il database gestito (nessun endpoint pubblico) fino a Ctrl-C; `--reveal` mostra la password. Riservato a owner o admin.

#### Risorse

La corrispondenza tra ciò che la piattaforma alloca per il progetto e ciò che il relativo codice dichiara.

```bash
rebase cloud resources                       # ogni database e bucket: dichiarato? allocato?
rebase cloud resources prune database <key>  # rimuove una risorsa non più dichiarata nel codice
```

Un deploy non rimuove mai automaticamente un database allocato quando la sua dichiarazione scompare — ciò comporterebbe la cancellazione di dati in seguito a un push. Il database viene mantenuto, collegato e fatturato finché non viene esplicitamente rimosso per nome con un'operazione di prune.

#### Compute

Le risorse di calcolo riservate per il progetto e i relativi costi.

```bash
rebase cloud compute            # la prenotazione corrente e il relativo costo mensile
rebase cloud compute set        # modificala
```

`compute set` accetta `--cpu`, `--memory`, `--replicas`, `--spot`,
`--scale-to-zero`, `--db-mode`, `--db-instances`, `--db-cpu`, `--db-memory`,
`--storage`, `--autoscale-max`, `--autoscale-cpu-target` e `--no-autoscale`.
Non esistono piani tariffari fissi a livelli: ogni risorsa ha un prezzo a consumo. Consulta
[Rebase Cloud](/docs/deployment/cloud/).

#### Storage, webhook, cluster e fatturazione

```bash
rebase cloud storage             # elenca i bucket di storage
rebase cloud storage create      # alloca storage gestito dalla piattaforma
rebase cloud storage attach      # collega il tuo bucket compatibile S3
rebase cloud webhooks list | create | delete
rebase cloud clusters list | add | verify   # i cluster su cui girano i tenant; `add` ne registra uno da un kubeconfig
rebase cloud billing             # l'account di fatturazione e la carta registrata
rebase cloud billing setup       # collega una carta una tantum, apre un browser
rebase cloud billing checkout    # una sessione Stripe per un progetto
```

### `rebase generate-sdk`

Genera un SDK client tipizzato a partire dalle definizioni delle tue collection:

```bash
rebase generate-sdk
```

Crea i tipi TypeScript e un client con sicurezza dei tipi per tutte le tue collection.

### `rebase doctor`

```bash
rebase doctor
```

Il comando da eseguire quando qualcosa non funziona e non se ne conosce ancora la causa.
Fornisce una diagnostica senza apportare alcuna modifica, rendendolo sicuro su qualsiasi database raggiungibile.

**Senza database.** Questi controlli vengono eseguiti per primi, poiché qualsiasi problema che impedisce del tutto il funzionamento di un progetto si verifica prima ancora di poter confrontare una tabella:

| Controllo | Motivazione |
| --- | --- |
| Versione di Node | Confrontata con l'intervallo dichiarato dalla CLI. Una versione obsoleta non viene segnalata come "Node non supportato", bensì come errore di sintassi all'interno di una dipendenza. |
| Package manager | Presenza di due file di lock in un unico progetto. L'esecuzione di `npm install` in un workspace pnpm riscrive la cartella `node_modules` secondo una struttura non compatibile con pnpm, causando l'errore `Cannot find module` a distanza di ore. |
| Slug duplicati | Il registro mantiene l'ultima collection registrata, pertanto l'altra non viene segnalata come mancante: viene servita al suo posto come vincente, con il proprio nome. |
| Integrità di `.env` | Verifica di un `JWT_SECRET` inferiore a 32 caratteri (con cui la produzione rifiuta l'avvio) e di `NODE_ENV=production` in assenza di `CORS_ORIGINS` o `FRONTEND_URL`. I valori non vengono mai stampati a video. |
| Disallineamento versioni di `@rebasepro/*` | Lo stesso pacchetto bloccato su versioni differenti all'interno dei file `package.json` del progetto. La coesistenza di due copie compromette l'uso di `instanceof`, che fallisce operando come un type guard che rigetta il proprio stesso tipo. |
| Stringhe di connessione | Carattere `=` non codificato in un parametro URL, che gli strumenti nativi di PostgreSQL non riescono ad analizzare — causando il blocco di backup e `psql` mentre l'applicazione continua a funzionare. |
| Custom function | Requisiti di ciascuna function verso il proprio host e individuazione di quelle incompatibili con l'esecuzione su un runtime edge. |

**Sul database**, quando `DATABASE_URL` è impostata:

| Controllo | Motivazione |
| --- | --- |
| Collection → schema generato | Verifica se `schema.generated.ts` è obsoleto. |
| Collection → database | Tabelle, colonne, enum, chiavi esterne e tabelle di giunzione mancanti. |
| Estensioni richieste | Una proprietà `{ type: "vector" }` necessita di pgvector, che Rebase installa unicamente se dichiarato dal progetto. |
| Schema stamp | Verifica se il database in uso è stato inizializzato a partire da queste collection. Si tratta di un hash, in grado di rilevare una discordanza tra i due senza però determinare quale sia il più avanzato. |
| Collection → tipi dell'SDK | Verifica se l'SDK tipizzato generato è obsoleto. |
| Policy RLS | Verifica se le policy del database corrispondono alle `securityRules` dichiarate e se qualche policy fa riferimento a un ruolo non utilizzabile da questo server. |

Se il database non è raggiungibile, le relative fasi vengono contrassegnate come saltate riportandone il motivo, mentre il resto dei controlli viene comunque completato — consulta [Risoluzione dei problemi](/docs/troubleshooting/).

Termina con codice diverso da zero se un controllo rileva un errore o se una fase non può essere eseguita a causa del rifiuto delle connessioni da parte del database configurato. Una fase saltata per l'assenza della variabile `DATABASE_URL` non costituisce un errore.

`rebase doctor --policies` esegue unicamente i controlli sulle RLS — senza diff dello schema né verifica dei tipi dell'SDK — e adotta una logica "fail-closed", rendendolo il comando ideale da usare come gate di CI su un database distribuito.

### `rebase auth`

Comandi per la gestione dell'autenticazione:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gestisci le chiavi API di servizio con permessi limitati (scoped) — le credenziali utilizzate da un agente, uno script o un altro servizio, a differenza della sessione di un utente finale:

```bash
rebase api-keys list
rebase api-keys create --name "Analytics" --permissions '[{"collection":"events","operations":["read"]}]'
rebase api-keys create --name "Full Access" --full-access --expires 90d
rebase api-keys revoke abc123-def456
```

`--permissions` accetta un array JSON di oggetti `{ collection, operations }`, oppure puoi usare `--full-access` per abilitare operazioni di lettura/scrittura/cancellazione su ogni collection e function. `--expires` accetta `7d`, `30d`, `90d`, `1y` o una data in formato ISO, e `--rate-limit` imposta il numero massimo di richieste per intervallo di 15 minuti. La chiave viene mostrata una sola volta, al momento della creazione.

Le chiavi dispongono di un doppio livello di controllo: si applicano sia i permessi propri della chiave sia la row-level security (RLS) dell'identità con cui agisce, garantendo che una chiave non possa mai accedere a dati superiori a quelli consentiti a tale identità.

### `rebase skills install`

Installa le skill di riferimento di Rebase per il tuo assistente di programmazione basato su IA. Supporta Cursor, Claude Code, Windsurf, Gemini CLI e Antigravity:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Consulta [Agent Skills](/docs/ai/skills) per l'elenco completo e i percorsi in cui vengono scritti i file.

### `rebase telemetry`

Condivisione anonima dei dati di utilizzo. **`rebase init` richiede il consenso una volta per progetto, con risposta predefinita affermativa — nessun dato viene inviato a meno che non si risponda al prompt:**

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` stampa l'impostazione corrente, `show` mostra con esattezza cosa verrebbe inviato — indipendentemente dal fatto che la condivisione sia abilitata o meno, consentendo di esaminare il payload prima di prendere una decisione — e gli altri due comandi ne modificano lo stato. Se non hai mai eseguito `init`, non è mai stato raccolto alcun dato.

## Flusso di lavoro per le migrazioni

Il tipico flusso di lavoro per applicare modifiche allo schema:

```bash
# 1. Modifica la tua collection in config/collections/
# 2. Genera lo schema Drizzle
rebase schema generate

# 3. Genera la migrazione SQL
rebase db generate

# 4. Esamina l'SQL generato in drizzle/

# 5. Applica la migrazione
rebase db migrate
```

## Passaggi successivi

- **[Schema as Code](/docs/architecture/schema-as-code)** — Come funziona la generazione dello schema
- **[Guida rapida](/docs/getting-started/quickstart)** — Inizia subito

---
