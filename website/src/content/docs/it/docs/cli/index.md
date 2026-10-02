---
sourceHash: cc9569d9e5b15674
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

Oppure esegui qualsiasi comando senza installarla: `pnpm dlx @rebasepro/cli <command>`.

## Output leggibile da macchina (Machine-readable)

`--json` è il flag principale e, al di fuori della famiglia `cloud`, è l'unico: `rebase status`, `rebase resources`, `rebase apps list` e `rebase upgrade` restituiscono un singolo valore JSON su stdout — il risultato, oppure un envelope `{"error": {"message", "code", "hint", "issues"}}` con un codice di uscita diverso da zero — a **ogni** uscita del comando, in modo che un chiamante possa analizzare stdout incondizionatamente. Senza questo flag, scrivono testo leggibile per gli umani e gli errori vanno su stderr. `rebase cloud` utilizza lo stesso envelope ed è l'unica eccezione al flag: abilita il JSON automaticamente anche quando stdout non è una TTY, o quando è impostato `REBASE_JSON=1`. Quindi `rebase cloud status | cat` è in formato JSON mentre `rebase status | cat` non lo è — all'interno di uno script, passa esplicitamente `--json` invece di affidarti a queste regole.

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
| `--headless` | Solo backend — nessun pannello di amministrazione e nessun file di collection. `--template` non ha effetto, poiché non ci sono collection da popolare |
| `-y, --yes` | Non richiede mai conferme interattive. **Obbligatorio ovunque non ci sia un terminale per rispondere**, come in CI. Salta git init e l'installazione delle dipendenze — le opzioni predefinite interattive rispondono sì a entrambe, quindi passa `--git` / `--install` se le desideri |
| `-i, --install` | Installa le dipendenze dopo lo scaffolding |
| `-g, --git` | Inizializza un repository ed esegue il primo commit |
| `--database-url <url>` | Usa un database esistente invece di quello gestito |
| `--introspect` | Genera le collection da tale database. Implica `--template blank` e richiede `--install` |
| `--project <slug>` | Collega lo scaffold a un progetto Rebase Cloud |
| `--setup-key <key>` | La chiave monouso per autenticare tale collegamento |
| `-a, --agent <name>` | <span class="since-badge" data-since="0.24">Dalla 0.24</span> Configura gli agenti di programmazione AI: le [skills](/docs/ai/skills) e il [server MCP](/docs/ai/mcp). Ripetibile o separato da virgole — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` o `all`. Senza di esso, `init` chiede e seleziona preventivamente gli agenti installati sulla macchina; con `--yes`, nessuno |

### `rebase dev`

Avvia il server di sviluppo:

```bash
rebase dev
```

Avvia sia il frontend che il backend con hot reloading, e rigenera lo schema Drizzle e i tipi dell'SDK (`generated/sdk/`) all'avvio e a ogni salvataggio di una collection. <span class="since-badge" data-since="0.24">Da 0.24</span> per i tipi dell'SDK — sulla 0.23 rigenera solo lo schema, ed eseguire `rebase generate-sdk` spetta a te.

Entrambe le porte sono derivate dal percorso del progetto, consentendo l'esecuzione affiancata di più progetti Rebase. Usa gli URL stampati da `rebase dev`. Puoi fissarne una con `rebase dev --port 3001`.

### `rebase build`

Compila il progetto in un bundle distribuibile all'interno di `dist-bundle/`:

```bash
rebase build
```

Il bundle è l'artefatto di cui esegui il deploy — l'immagine di runtime lo carica, quindi non è necessario creare un'immagine dell'applicazione autonomamente. Flag utili:

| Flag | Effetto |
|------|--------|
| `--output <dir>` (o `--out`) | Scrive il bundle in una posizione diversa da `dist-bundle/` (un'app alla volta) |
| `--vendor` | Installa e include sempre le dipendenze del bundle |
| `--no-vendor` | Non include mai le dipendenze; il pod le installerà al primo avvio |
| `--skip-type-check` | Salta il controllo dei tipi (più veloce, meno sicuro) |
| `--no-static` | Non ripiega il frontend nel bundle del backend (ogni app statica ottiene comunque un proprio bundle) |
| `--skip-static-build` | Ripiega il frontend come già compilato, senza eseguire il suo comando di build |

Le dipendenze vengono incluse (vendored) per impostazione predefinita, evitando che il riavvio di un pod richieda un'installazione di 35–55 secondi. Un albero che supera i 200 MB su disco viene invece scartato, poiché il limite di caricamento è di 100 MB compressi — consulta il changelog per le motivazioni.

### `rebase upgrade`

Aggiorna ogni pacchetto `@rebasepro/*` bloccato dal progetto a una singola release, quindi installa con il gestore di pacchetti i nomi indicati nel relativo lockfile. `rebase upgrade` seleziona l'ultima versione; `--to 0.21.0` una versione esatta, senza consultare il registro; `--to canary` un dist-tag. Ogni versione bloccata in `dependencies`, `devDependencies` e `optionalDependencies`, in ogni `package.json` del progetto, mantiene il proprio `^` o `~`, e null'altro nel file viene modificato. Le specifiche per `peerDependencies` e `workspace:`, `link:`, `file:`, git e tag vengono elencate e lasciate invariate. Anche gli override in `pnpm-workspace.yaml` e `package.json` vengono aggiornati, ma un override `link:` o `file:` ha la precedenza su qualsiasi blocco: viene segnalato e `--drop-local-overrides` lo rimuove. `--dry-run` non scrive nulla, `--no-install` salta l'installazione e `--json` stampa un unico documento.

### `rebase start`

Esegue il bundle compilato nello stesso modo in cui lo esegue un deployment:

```bash
rebase start
```

Legge `PORT` e il resto di `.env`, a differenza di `rebase dev`, nel `NODE_ENV`
che impostano. Un `.env` scaffoldato indica `development`, quindi il primo
account che si registra diventa comunque admin, e `rebase start` lo segnala
in testa; imposta `NODE_ENV=production` per un server di produzione.
`rebase start --bundle ./dist-bundle` esegue un bundle posizionato altrove.

### `rebase apps list`

Mostra le app dichiarate da questo repository:

```bash
rebase apps list
```

Un repository può dichiarare più di un'app distribuibile — ad esempio, un backend e un sito di marketing. Questo comando consente di vedere su cosa agiranno `rebase build` e il deployment.

### `rebase eject`

Prendi il pieno controllo del processo del server e della sua immagine:

```bash
rebase eject
```

Scrive l'entrypoint del backend e un `Dockerfile` nel progetto e converte il backend, in modo che il repository compili la propria immagine anziché eseguire il runtime pubblicato. Da quel momento in poi **gli aggiornamenti del runtime della piattaforma non lo raggiungeranno più**, e la configurazione di CORS, autenticazione, archiviazione e arresto diventerà di tua competenza.

Visualizzane un'anteprima con `rebase eject --dry-run`, che elenca le modifiche senza applicarle. `--force` sostituisce un file `backend/src/index.ts` o `env.ts` esistente, conservando il file corrente come `<name>.bak`.

### `rebase schema generate`

Genera lo schema per Drizzle ORM dalle tue collection TypeScript:

```bash
rebase schema generate
```

Legge le tue collection da `config/collections/` e genera `backend/src/schema.generated.ts` con definizioni di tabelle Drizzle, enum e relazioni.

### `rebase db push`

Invia le modifiche allo schema direttamente al database (solo per sviluppo):

```bash
rebase db push
```

:::caution
`db push` modifica il database direttamente senza file di migrazione. Usa `db generate` + `db migrate` per l'ambiente di produzione.
:::

### `rebase db generate`

Genera file di migrazione SQL a partire dalle modifiche allo schema:

```bash
rebase db generate
```

Crea file di migrazione con timestamp in `drizzle/migrations/` che possono essere revisionati e committati.

### `rebase db migrate`

Esegue le migrazioni del database in sospeso:

```bash
rebase db migrate
```

Applica tutte le migrazioni non ancora applicate al database.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # o s3://bucket/prefix, gs://bucket/prefix
rebase db backups list                  # elenca i backup archiviati
rebase db restore ./backups/<file>.dump --yes
```

`backup` esegue `pg_dump`; `restore` esegue `pg_restore` e, essendo distruttivo, richiede `--yes`.
La pianificazione, il file dei ruoli che viaggia con ogni dump e la procedura di ripristino sono in [Backup e ripristino](/docs/deployment/backups/).

### `rebase db pull`

Copia un altro database in quello di sviluppo locale:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--anonymize` sostituisce i campi personali durante l'importazione, consentendo di lavorare localmente su una copia della produzione senza trasferire dati reali dei clienti su un laptop.

Dato che `pg_dump` rimuove i privilegi, la copia arriverebbe con i criteri RLS di origine ma senza le relative autorizzazioni sottostanti — causando il fallimento di ogni lettura come `rebase_user` con l'errore `permission denied`. L'operazione di pull ripristina successivamente il ruolo dell'applicazione, impiegando la medesima procedura usata all'avvio e da `rebase db push`, garantendo che le tabelle interne di Rebase rimangano protette come previsto.

La destinazione è sempre il database di sviluppo locale di questo progetto e non può essere modificata: il passaggio di `--database-url` viene rifiutato, evitando qualsiasi possibilità di eseguire un "pull verso la produzione". `--from` è l'unica direzione consentita.

### `rebase db url`

Stampa la stringa di connessione utilizzata dal progetto, e nient'altro, facilitando l'uso in pipe:

```bash
rebase db url
psql "$(rebase db url)"
```

Il database di sviluppo gestito è il caso principale che necessita di questo comando: `.env` lascia intenzionalmente `DATABASE_URL` commentato, e la porta è calcolata dal percorso del progetto, per cui nessun elemento su disco la definisce in modo esplicito. Quando imposti un tuo `DATABASE_URL`, viene stampato quello — l'ordine di risoluzione è lo stesso seguito da qualsiasi altro comando. Il comando avvia il database gestito qualora non sia già in esecuzione.

### `rebase db stop` / `rebase db reset`

Valido solo per il database di sviluppo gestito:

```bash
rebase db stop     # arresta il database; i dati vengono conservati
rebase db reset    # lo elimina e riparte da capo
```

### `rebase db branch`

```bash
rebase db branch create <name>
rebase db branch list
rebase db branch info <name>
rebase db branch switch <name>     # lavora su questo branch; tutti i comandi successivi lo seguiranno
rebase db branch switch            # mostra il branch corrente
rebase db branch switch --off      # torna al database principale
rebase db branch delete <name>
rebase db branch prune [--older-than 14d] [--include-dev-diff]
```

PostgreSQL non consente di copiare o eliminare un database a cui è connesso qualsiasi altro processo, e il caso più tipico di "qualsiasi altro processo" è la tua istanza di `rebase dev`. `create` e `delete` indicano cosa sta occupando il database; `--force` disconnette preventivamente tali sessioni.

Ogni branch è una copia completa su disco, pertanto richiede una pulizia periodica. `prune` rimuove tre elementi: una voce il cui database è stato rimosso all'esterno di Rebase, un database di branch la cui voce non è mai stata salvata e — solo specificando `--older-than` — i branch più vecchi dell'età specificata. Salvo l'uso di `--yes`, richiede conferma prima di eliminare qualsiasi cosa.

`switch` registra il branch in `.rebase/branch.json` e non modifica mai `.env`. Ha la precedenza su `DATABASE_URL` presente in `.env` ma cede il passo a `--database-url` o a una variabile `DATABASE_URL` definita nella shell; pertanto, un flag passato da riga di comando ha sempre priorità rispetto a uno switch effettuato precedentemente. L'eliminazione del branch su cui ti trovi ti riporta al database principale, evitando di lasciare l'ambiente puntato su un database inesistente.

:::note[Non utilizzabile sul database di sviluppo gestito]
`push`, `generate` e `migrate` pianificano le loro operazioni tramite Atlas, che richiede un secondo database vuoto con cui effettuare il confronto — e il PGlite gestito ne fornisce esattamente uno. L'esecuzione di questi comandi sul database gestito si arresterà mostrando un messaggio che notifica tale vincolo. Per il flusso di lavoro basato su migrazioni, imposta `DATABASE_URL` verso un'istanza PostgreSQL reale; `rebase dev` provvede già a creare in modo additivo le tabelle mancanti sull'istanza gestita.

Per un motivo simile, `branch` viene rifiutato in tale contesto. L'istruzione `CREATE DATABASE ... TEMPLATE` su PGlite registra una voce nel catalogo senza copiare alcunché; di conseguenza, il branch punterebbe al database da cui è stato clonato, facendo confluire nel database di sviluppo ogni scrittura che intendevi isolare. `rebase dev --docker` mette a disposizione un server reale compatibile con la gestione dei branch.
:::

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # le app dichiarate da questo progetto
rebase apps init <name>      # registra una nuova app in rebase.json
rebase apps config <app>     # configurazione a cui corrisponde una specifica app
```

### `rebase status`

Tutto ciò che il progetto dichiara e il rispettivo stato di associazione all'interno dell'ambiente:

```bash
rebase status               # ogni risorsa e le variabili che legge
rebase status --json        # formato leggibile da macchina
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

Tre file determinano le risorse accessibili da un backend, e questo comando li illustra congiuntamente: `rebase.json` specifica la posizione del codice e l'esecutore del server, `config/resources.ts` descrive i requisiti del progetto e l'ambiente definisce le modalità di connessione a ciascuna risorsa. Tutti gli altri elementi — `rebase.resources.json`, il manifest del bundle — vengono generati a partire dal secondo per consentirne l'analisi ai lettori che non possono eseguire il codice, senza richiedere una scrittura manuale.

Il simbolo `○` denota lo stato che è utile rilevare prima del deployment anziché dopo: risorsa dichiarata ma non configurata. Il simbolo `✗` indica una configurazione *errata* nell'ambiente, condizione che impedisce l'avvio invece di consentire un funzionamento degradato.

### `rebase resources`

Ciò di cui il progetto dichiara di aver bisogno — i database, i bucket, i topic e le code richiesti dal codice di configurazione, nonché i cron e le funzioni definiti dai suoi file:

```bash
rebase resources            # elenca le risorse
rebase resources --write    # rigenera rebase.resources.json
rebase resources --check    # fallisce se il grafo tracciato nel commit non è aggiornato
rebase resources --json     # formato leggibile da macchina
```

`rebase resources --check` è un comando recente — rappresenta il flag utilizzato nei job di CI per segnalare un errore qualora `rebase.resources.json` non corrisponda più al codice di configurazione.

Una risorsa viene dichiarata nel codice di configurazione — `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` — oppure consiste in un file collocato in `backend/crons` o `backend/functions`. Essa non va mai scritta manualmente in `rebase.resources.json`, file generato automaticamente da tali dichiarazioni per consentire all'host di determinare le dipendenze del progetto senza compilarlo. Ogni voce tiene traccia dei relativi utilizzatori (`collection:events`, `property:posts.cover`, `function:report`).

Un backend include inoltre un database predefinito e una sorgente di archiviazione predefinita che non richiedono alcuna dichiarazione. Entrambi compaiono in questo elenco con il contrassegno `implicit` e non vengono registrati in `rebase.resources.json`: essendo forniti direttamente dall'host, la loro annotazione comporterebbe la richiesta di provisioning per risorse non esplicitamente sollecitate.

Per verificare le risorse allocate sulla piattaforma a fronte di quanto dichiarato nel codice, e per eliminare un database allocato non più presente nel codice, consulta la sezione `rebase cloud resources` di seguito.

### `rebase cloud`

Tutte le funzionalità correlate a Rebase Cloud, attualmente disponibile in beta privata. Per maggiori dettagli sulla piattaforma e sulle funzionalità escluse dalla beta, consulta la [guida a Rebase Cloud](/docs/deployment/cloud/).

Ogni gruppo accetta il flag `--help`, il quale si limita a descrivere la sintassi senza eseguire il comando. La maggior parte dei comandi agisce sul progetto collegato in `.rebase/cloud.json`; il flag `--project <id>` consente di operare su uno specifico progetto senza doverlo collegare.

Tre opzioni risultano applicabili a livello globale: `--json` per produrre output interpretabile da macchina (attivo di default in caso di pipe o definendo `REBASE_JSON=1`), `--url <origin>` per indirizzare un control plane specifico (in alternativa a `REBASE_CLOUD_URL`) e `--project, -p <id>`.

#### Autenticazione (Auth)

```bash
rebase cloud login      # sign in to the control plane
rebase cloud logout     # sign out
rebase cloud whoami     # the current session, or what REBASE_TOKEN may do
rebase cloud tokens create --can deploy,logs   # a token for CI, shown once
```

#### Collegamento del progetto (Project link)

```bash
rebase cloud link         # collega questa directory a un progetto cloud
rebase cloud link [url]   # o direttamente a un backend: esclude control plane e login, inibendo il resto del gruppo fino al successivo unlink
rebase cloud unlink       # rimuove il collegamento
rebase cloud use [org]    # seleziona l'organizzazione attiva
rebase cloud open         # apre la dashboard nel browser
```

#### Progetti (Projects)

```bash
rebase cloud projects list
rebase cloud projects create [--link]
rebase cloud projects info [id]
rebase cloud projects delete [id]
```

#### Deploy e monitoraggio (Deploy and observe)

```bash
rebase cloud deploy [app] [--source .]   # esegue il deploy di un'app e trasmette i log di compilazione
rebase cloud logs [--runtime] [-f]       # log di compilazione o del processo in esecuzione
rebase cloud deployments list [--limit N|--all]
rebase cloud rollback [id] [-y]          # ripristina un deploy precedente andato a buon fine
rebase cloud cancel [-y]                 # annulla la compilazione in corso
rebase cloud start | stop | restart [-y] # stop e restart richiedono -y
rebase cloud status                      # stato sintetico del progetto
rebase cloud metrics                     # metriche in tempo reale di CPU / memoria / disco
rebase cloud debug [health|logs|…]       # diagnosi di un deployment, in sola lettura
```

Il comando `deploy` invocato senza specificare alcuna app distribuisce il backend. Il deploy del bundle di backend carica contestualmente anche il sorgente del progetto — quanto tracciato da git, escludendo rigorosamente il file `.env` — per consentire a un aggiornamento della piattaforma di ricompilarlo; `--no-source` evita tale operazione per la singola istanza, mentre `cloud settings set --platform-rebuilds off` la disattiva permanentemente eliminando la copia salvata. `--allow-downgrade` consente il deployment di una versione precedente.

#### Configurazione (Config)

```bash
rebase cloud env list | set | unset | reveal | pull
rebase cloud domains list | add <domain> | verify [domain] | remove <domain>
rebase cloud extensions list | enable | disable
rebase cloud settings show | set        # name, branch, repo, subdomain, rebuilds
```

#### Organizzazioni (Organizations)

```bash
rebase cloud orgs list | create | members
```

#### Database

```bash
rebase cloud db list | create | info | connect | test
rebase cloud db backup list | create | restore | status | download
rebase cloud db pitr status | restore | cutover | discard
```

`db connect` apre una porta locale corrispondente al database gestito (privo di endpoint pubblico) mantenendola attiva fino all'interruzione con Ctrl-C; `--reveal` mostra anche la password. Riservato a ruoli owner o admin.

#### Risorse (Resources)

Riepilogo delle risorse allocate dalla piattaforma per il progetto a fronte delle dichiarazioni contenute nel codice.

```bash
rebase cloud resources                       # ogni database e bucket: dichiarato? allocato?
rebase cloud resources prune database <key>  # rimuove una risorsa non più dichiarata nel codice
```

La procedura di deploy non elimina mai un database allocato a fronte della rimozione della sua dichiarazione — tale operazione comporterebbe la cancellazione di dati in seguito a un push. Il database viene conservato, associato e fatturato fino a esplicita rimozione nominativa tramite prune.

#### Calcolo (Compute)

Risorse di calcolo allocate per il progetto e relativi costi associati.

```bash
rebase cloud compute            # allocazione corrente e costo mensile associato
rebase cloud compute set        # modifica l'allocazione
```

`compute set` supporta i flag `--cpu`, `--memory`, `--replicas`, `--spot`, `--scale-to-zero`, `--db-instances`, `--db-cpu`, `--db-memory`, `--storage`, `--autoscale-max`, `--autoscale-cpu-target` e `--no-autoscale`. Non sono previsti piani tariffari a livelli: ciascun elemento viene fatturato in base alle singole risorse impiegate. Per maggiori dettagli consulta [Rebase Cloud](/docs/deployment/cloud/).

#### Storage, webhook, cluster e fatturazione

```bash
rebase cloud storage             # elenca i bucket di archiviazione
rebase cloud storage create      # alloca storage gestito dalla piattaforma
rebase cloud storage attach      # collega un bucket compatibile S3 personalizzato
rebase cloud webhooks list | create | delete
rebase cloud clusters list | add | verify   # i cluster su cui vengono eseguiti i tenant; `add` ne registra uno da un kubeconfig
rebase cloud billing             # account di fatturazione e carta associata
rebase cloud billing setup       # procedura una tantum per associare una carta, apre il browser
rebase cloud billing checkout    # sessione Stripe per un singolo progetto
```

### `rebase generate-sdk`

Genera un SDK tipizzato a partire dalle definizioni delle tue collection:

```bash
rebase generate-sdk
```

Crea tipi TypeScript e un client type-safe per tutte le tue collection.

### `rebase doctor`

```bash
rebase doctor
```

Il comando da eseguire qualora si verifichi un'anomalia di cui non sia ancora nota la causa. Si limita a effettuare diagnosi e non applica alcuna modifica, risultando sicuro su qualsiasi database raggiungibile.

**Senza database.** Questi controlli vengono eseguiti per primi, poiché tutti i problemi che impediscono totalmente il funzionamento di un progetto insorgono prima di poter effettuare il confronto delle tabelle:

| Controllo | Motivazione |
| --- | --- |
| Versione di Node | Confrontata con l'intervallo dichiarato dalla CLI. L'uso di una versione obsoleta non viene segnalato come "Node non supportato", bensì come errore di sintassi all'interno di una dipendenza. |
| Gestori di pacchetti | Presenza di due lockfile nello stesso progetto. L'esecuzione di `npm install` in un workspace pnpm altera la struttura di `node_modules` generando incompatibilità con pnpm, con la conseguente comparsa di errori `Cannot find module` a distanza di tempo. |
| Slug duplicati | Il registro mantiene l'ultima collection registrata; di conseguenza, la versione precedente non viene segnalata come mancante, ma viene rimpiazzata da quella più recente con lo stesso nome. |
| Validità di `.env` | Presenza di un valore `JWT_SECRET` inferiore a 32 caratteri (che impedisce l'avvio in produzione), oppure impostazione di `NODE_ENV=production` in assenza di `CORS_ORIGINS` o `FRONTEND_URL`. I valori effettivi non vengono mai stampati a video. |
| Disallineamento versioni `@rebasepro/*` | Lo stesso pacchetto bloccato su versioni eterogenee nei vari file `package.json` del progetto. La presenza di due copie compromette il funzionamento di `instanceof`, provocando il fallimento di un type guard che non riconosce il proprio tipo. |
| Stringhe di connessione | Carattere `=` non codificato all'interno di un parametro dell'URL, che gli strumenti nativi di PostgreSQL non riescono ad analizzare — causando il malfunzionamento di backup e `psql` pur mantenendo operativa l'applicazione. |
| Funzioni personalizzate | Requisiti richiesti da ciascuna funzione all'ambiente host e verifica della compatibilità per l'esecuzione su runtime edge. |

**Con connessione al database**, in presenza della variabile `DATABASE_URL`:

| Controllo | Motivazione |
| --- | --- |
| Collection → schema generato | Verifica l'eventuale mancato aggiornamento di `schema.generated.ts`. |
| Collection → database | Rileva tabelle, colonne, enum, chiavi esterne e tabelle ponte mancanti. |
| Estensioni richieste | La presenza di una proprietà `{ type: "vector" }` richiede pgvector, che Rebase installa esclusivamente nei progetti in cui è esplicitamente dichiarata. |
| Schema stamp | Verifica che il database sia stato inizializzato a partire da queste specifiche collection. Trattandosi di un hash, evidenzia l'eventuale disallineamento tra le parti senza specificare quale risulti più recente. |
| Collection → tipi SDK | Verifica l'eventuale mancato aggiornamento dell'SDK tipizzato generato. |
| Criteri RLS | Verifica la corrispondenza tra i criteri del database e le `securityRules` dichiarate, controllando che nessun criterio faccia riferimento a ruoli non utilizzabili dal server. |

In caso di mancata raggiungibilità del database, le relative fasi vengono contrassegnate come ignorate (con la specifica della causa), procedendo con l'esecuzione dei controlli restanti — per approfondimenti, consulta la sezione [Risoluzione dei problemi](/docs/troubleshooting/).

Il comando restituisce un codice di uscita diverso da zero qualora un controllo riscontri un errore, oppure quando una fase non possa essere completata a causa del rifiuto delle connessioni da parte del database configurato. L'omissione di una fase causata dalla mancata impostazione di `DATABASE_URL` non costituisce un errore.

`rebase doctor --policies` esegue esclusivamente i controlli relativi a RLS — escludendo la verifica delle differenze di schema e i tipi dell'SDK — e adotta una modalità restrittiva con blocco in caso di anomalie (fail closed), risultando ideale come controllo di gate nei sistemi di CI a fronte di un database di produzione.

### `rebase auth`

Comandi per la gestione dell'autenticazione:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

<span class="since-badge" data-since="0.24">Da 0.24</span> Gestisci le chiavi API di servizio del progetto — le credenziali utilizzate da un agente, uno script o un altro servizio, a differenza della sessione di un utente finale:

```bash
rebase api-keys list
rebase api-keys create --name "Blog CI" --scopes data:read:posts,data:write:posts --expires-in 90
rebase api-keys create --name "Ops" --full-access --roles admin --expires-at 2027-01-31
rebase api-keys revoke abc123-def456
```

`--scopes` indica cosa può fare la chiave, separati da virgole o ripetuti; `--full-access`
le assegna ogni scope che possiede la service key tranne `keys:*`. `--roles` aggiunge ruoli RLS oltre a
`service`, `--expires-in` accetta un numero di giorni e `--expires-at` una data ISO.
`rebase api-keys scopes` elenca ogni scope noto al backend. La chiave viene visualizzata una sola volta.

Le chiavi prevedono un duplice livello di autorizzazione: a esse si applicano sia gli scope della chiave sia la row-level security (RLS) dell'identità con cui opera. Vedi [Chiavi API](/docs/backend/api-keys/).

### `rebase skills install`

Installa le skill di riferimento di Rebase per i tuoi assistenti di programmazione AI — valido per tutti i valori di `--agent` indicati in precedenza:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
```

Per l'elenco esaustivo e la destinazione dei file installati, consulta la sezione [Skill degli agenti](/docs/ai/skills).

### `rebase telemetry`

Condivisione anonima dei dati di utilizzo. **`rebase init` formula la richiesta una sola volta per ciascun progetto, impostando la risposta affermativa come predefinita — nessun dato viene inviato senza una tua esplicita risposta:**

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` mostra l'impostazione corrente, `show` visualizza l'esatto payload predisposto per l'invio — a prescindere dall'attivazione del servizio, consentendone la verifica preventiva — e i restanti comandi ne modificano lo stato. Se non hai mai eseguito `init`, nessun dato è mai stato raccolto.

## Passaggi successivi

- **[Generazione dello schema](/docs/cli/schema/#production-workflow)** — Il flusso di lavoro delle migrazioni, dalla modifica della collection alla produzione
- **[Schema as Code](/docs/architecture/schema-as-code)** — Come funziona la generazione dello schema
- **[Guida rapida](/docs/getting-started/quickstart)** — Inizia subito
