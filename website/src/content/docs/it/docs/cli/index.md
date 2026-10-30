---
sourceHash: 67ab1823d7297527
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

`--json` è il flag principale e, al di fuori della famiglia `cloud`, è l'unico: `rebase status`, `rebase resources`, `rebase apps list`, `rebase upgrade` e `rebase verify` restituiscono un singolo valore JSON su stdout — il risultato, oppure un envelope `{"error": {"message", "code", "hint", "issues"}}` con un codice di uscita diverso da zero — a **ogni** uscita del comando, in modo che un chiamante possa analizzare stdout incondizionatamente. Senza questo flag, scrivono testo leggibile per gli umani e gli errori vanno su stderr. `rebase cloud` utilizza lo stesso envelope ed è l'unica eccezione al flag: abilita il JSON automaticamente anche quando stdout non è una TTY, o quando è impostato `REBASE_JSON=1`. Quindi `rebase cloud status | cat` è in formato JSON mentre `rebase status | cat` non lo è — all'interno di uno script, passa esplicitamente `--json` invece di affidarti a queste regole.

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
| `-i, --install` | Installa le dipendenze dopo lo scaffolding. Senza di esso, init lo chiede (predefinito sì); con `--yes`, non viene installato nulla |
| `--no-install` | Non installa nulla, e non lo chiede |
| `-g, --git` | Inizializza un repository ed esegue il primo commit. Senza di esso, init lo chiede (predefinito sì); con `--yes`, nessun repository |
| `--database-url <url>` | Usa un database esistente invece di quello gestito. Deve essere un URL `postgres://` o `postgresql://`: qualsiasi altra cosa viene rifiutata prima che venga scritto un file, e il prompt interattivo lo richiede di nuovo |
| `--introspect` | Genera le collection da tale database. Implica `--template blank` e richiede `--install` |
| `--project <slug>` | Collega lo scaffold a un progetto Rebase Cloud |
| `--setup-key <key>` | La chiave monouso per autenticare tale collegamento |
| `-a, --agent <name>` | Configura gli agenti di programmazione AI: le [skills](/docs/ai/skills) e il [server MCP](/docs/ai/mcp). Ripetibile o separato da virgole — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` o `all`. Senza di esso, `init` chiede e seleziona preventivamente gli agenti installati sulla macchina; con `--yes`, nessuno |

### `rebase dev`

Avvia il server di sviluppo:

```bash
rebase dev
```

Avvia sia il frontend che il backend con hot reloading, e rigenera lo schema Drizzle e i tipi dell'SDK (`generated/sdk/`) all'avvio e a ogni salvataggio di una collection. Sulla 0.23 rigenera solo lo schema, ed eseguire `rebase generate-sdk` spetta a te.

Entrambe le porte sono derivate dal percorso del progetto, consentendo l'esecuzione affiancata di più progetti Rebase. Usa gli URL stampati da `rebase dev`. Puoi fissarne una con `rebase dev --port 3001`.

Una modifica a `.env`
riavvia il backend, che rilegge il file, come fa il pannello di amministrazione. Ciò che
`rebase dev` imposta da sé resta com'è finché non lo riavvii: `PORT`, e `DATABASE_URL`
quando è sul database gestito o su Docker. Su 0.24 una modifica a `.env` raggiungeva il
backend solo quando cambiava qualche altro file osservato.

Con
`--database-url`, `rebase dev` controlla prima che qualcosa risponda a quell'host e a
quella porta. Se non risponde nulla, lo dice, nominando il flag, e termina con `1` senza
avviare nulla; lascia inoltre stare il database indicato da `.env`, senza mai avviarne il
container compose. Su 0.24 il banner del backend diceva di verificare `DATABASE_URL` in
`.env`, e dev continuava a girare con il backend fermo.

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
| `--no-vendor` | Non include mai le dipendenze; il pod le installa a ogni avvio |
| `--skip-type-check` | Salta il controllo dei tipi (più veloce, meno sicuro) |
| `--no-static` | Non ripiega il frontend nel bundle del backend (ogni app statica ottiene comunque un proprio bundle) |
| `--skip-static-build` | Ripiega il frontend come già compilato, senza eseguire il suo comando di build |

Le dipendenze vengono incluse (vendored) per impostazione predefinita, evitando che una nuova istanza richieda un'installazione di 35–55 secondi. Un albero che supera i 2 GB su disco viene invece scartato, poiché il limite di caricamento è di 1 GB compresso.

Ogni app statica che il
bundle contiene riceve una copia brotli (`.br`) e una gzip (`.gz`) accanto a ogni
asset con hash di contenuto di 1 KB o più — i file che un browser mette in cache per un anno.
Il runtime invia quella che il browser accetta, così quei file non costano alcun
lavoro di compressione per richiesta, compresa la prima visita dopo un deploy, e
i browser che accettano brotli lo ottengono (circa l'11% più piccolo di gzip sul
JavaScript dell'admin). L'output di build del tuo frontend resta com'era; cambia
solo la copia nel bundle. Sull'app di esempio questo aggiunge meno di un secondo alla
build e circa 2,4 MB al bundle.

### `rebase upgrade`

Aggiorna ogni pacchetto `@rebasepro/*` bloccato dal progetto a una singola release, quindi installa con il gestore di pacchetti i nomi indicati nel relativo lockfile. `rebase upgrade` seleziona l'ultima versione; `--to 0.21.0` una versione esatta, senza consultare il registro; `--to canary` un dist-tag. Ogni versione bloccata in `dependencies`, `devDependencies` e `optionalDependencies`, in ogni `package.json` del progetto, mantiene il proprio `^` o `~`, e null'altro nel file viene modificato. Le specifiche per `peerDependencies` e `workspace:`, `link:`, `file:`, git e tag vengono elencate e lasciate invariate. Anche gli override in `pnpm-workspace.yaml` e `package.json` vengono aggiornati, ma un override `link:` o `file:` ha la precedenza su qualsiasi blocco: viene segnalato e `--drop-local-overrides` lo rimuove. `--dry-run` non scrive nulla, `--no-install` salta l'installazione e `--json` stampa un unico documento.

Un progetto su una prerelease,
come un canary, resta sul suo canale a meno che `latest` sia più recente. Un dist-tag che
sposterebbe un pin all'indietro viene rifiutato (`downgrade_refused` con `--json`) a meno
che tu non passi `--allow-downgrade`; un `--to` esatto viene applicato, e segnalato come
downgrade. Un `--dry-run` di un aggiornamento che l'esecuzione reale rifiuterebbe mostra
che cosa si sposterebbe e termina con 0, e con `--json` il suo documento riporta il
rifiuto come `wouldRefuse` (`{ code, message, hint }`). Su 0.24, `rebase upgrade` prende
`latest` in ogni caso.

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

`rebase start` non avvia alcun database, e il `.env` dello scaffold non ha
`DATABASE_URL`, quindi un'esecuzione locale sul database che usa `rebase dev` è
`DATABASE_URL="$(rebase db url)" rebase start`.
Senza uno, stampa quella riga prima dell'avvio; su 0.24 il runtime si ferma su
"DATABASE_URL: is required".

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

Il server espulso tiene gli
upload locali nella cartella `uploads/` del progetto, eseguito dai sorgenti o compilato,
come fa `rebase dev`. Gira in `backend/`, quindi lì uno `STORAGE_PATH` relativo viene
letto da `backend/`. Su 0.24 il server compilato usa `backend/dist/uploads`, che la
build successiva elimina.

### `rebase schema generate`

Genera lo schema per Drizzle ORM dalle tue collection TypeScript:

```bash
rebase schema generate
```

Legge le tue collection da `config/collections/` e genera `backend/src/schema.generated.ts` con definizioni di tabelle Drizzle, enum e relazioni.

### `rebase schema stale`

```bash
rebase schema stale          # name what differs from the collections, exit 1 if anything does
rebase schema stale --fix    # regenerate backend/src/schema.generated.ts instead
```

`rebase dev` mantiene il file aggiornato da sé, quindi questo è il controllo per una build
o per un passaggio di CI. Vedi [Generazione dello schema](/docs/cli/schema/#rebase-schema-stale).

### `rebase db`

```bash
rebase db push                 # apply the collections to the database (development)
rebase db generate             # write a SQL migration file
rebase db migrate              # apply the pending migrations
rebase db url                  # print the connection string this project uses
rebase db pull --from <url>    # copy another database into the local one
rebase db backup               # pg_dump; db backups list and db restore beside it
rebase db branch create <name> # a copy to work on; switch, list and prune it too
rebase db stop                 # stop the managed development database
rebase db reset                # delete it and start over
```

Ognuno è in [Comandi del database](/docs/cli/database/), con l'ordine in cui un comando
sceglie il proprio database; `push`, `generate` e `migrate` sono trattati in dettaglio in
[Generazione dello schema](/docs/cli/schema/).

### `rebase console`

Un REPL Node con i dati del progetto aperti, oppure un singolo snippet eseguito con `-e`:

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) e `collections` sono
disponibili, e l'`await` di primo livello funziona. Il database viene risolto come lo
risolve `rebase db push`, e aprirlo non vi modifica nulla. Con `-e`, il risultato atteso
(awaited) viene stampato come JSON su stdout e un errore lanciato termina con `1`. Flag:
`--eval`/`-e`, `--collections`/`-c`, `--database-url`, `--docker`. Vedi
[Script e console](/docs/backend/scripts/).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # the apps this project declares
rebase apps init             # write a rebase.json inferred from this project
rebase apps config <app>     # the client configuration for one app
```

`apps init` non accetta un nome: deduce ogni app dal progetto e scrive l'intero
`rebase.json`, e rifiuta di sostituirne uno esistente a meno che tu non passi
`--force`.

Un argomento nome viene
rifiutato. `--force` mantiene ciò che l'inferenza non può sapere dal file che sostituisce:
il nome di ogni app, il suo `path` e la sua route `cms`. Tutto il resto viene dedotto di
nuovo, e un'app dichiarata che non trova più viene nominata come rimossa, quindi su uno
scaffold riscrive il `rebase.json` fornito dallo scaffold. Il comando di build dell'app
statica usa il gestore di pacchetti del progetto. Su 0.24 il nome viene ignorato, e
`--force` scrive la semplice inferenza: l'app statica diventa `web`, compilata con
`npm run build --workspace frontend`.

Per un checkout non collegato
a un progetto Cloud, `apps config` dice che non è collegato, che `rebase dev` sia in
esecuzione o meno, e fornisce l'URL del backend così come lo serve `rebase dev`. Su 0.24
stampa `http://localhost:3001`.

### `rebase status`

Tutto ciò che il progetto dichiara e il rispettivo stato di associazione all'interno dell'ambiente:

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

Tre file determinano le risorse accessibili da un backend, e questo comando li illustra congiuntamente: `rebase.json` specifica la posizione del codice e l'esecutore del server, `config/resources.ts` descrive i requisiti del progetto e l'ambiente definisce le modalità di connessione a ciascuna risorsa. Tutti gli altri elementi — `rebase.resources.json`, il manifest del bundle — vengono generati a partire dal secondo per consentirne l'analisi ai lettori che non possono eseguire il codice, senza richiedere una scrittura manuale.

Il simbolo `○` denota lo stato che è utile rilevare prima del deployment anziché dopo: risorsa dichiarata ma non configurata. Il simbolo `✗` indica una configurazione *errata* nell'ambiente, condizione che impedisce l'avvio invece di consentire un funzionamento degradato.

Un
`rebase.resources.json` che non corrisponde più alle dichiarazioni riceve una riga `○`.
Uno non ancora scritto no: `rebase build` lo scrive a ogni build, quindi un progetto mai
compilato, come uno scaffold appena creato, non ha nulla da correggere. Su 0.24 lo
`status` di ogni nuovo progetto terminava con "is missing".

### `rebase resources`

Ciò di cui il progetto dichiara di aver bisogno — i database, i bucket, i topic e le code richiesti dal codice di configurazione, nonché i cron e le funzioni definiti dai suoi file:

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if the committed graph is stale
rebase resources --json     # machine-readable
```

`rebase resources --check` è il flag utilizzato nei job di CI per segnalare un errore qualora `rebase.resources.json` non corrisponda più al codice di configurazione.
`--json` si combina con esso:
in caso di drift, `rebase resources --check --json` termina con 1 e una busta di errore
(`resource_graph_missing` o `resource_graph_stale`), e in caso di successo il grafo porta
`check.status`. `--write --json` scrive il file e riporta `written.changed`. Su 0.24
`--json` stampava il grafo e ignorava entrambi i flag.

Una risorsa viene dichiarata nel codice di configurazione — `database("analytics")`, `bucket("media")`, `topic("signups")`, `queue("thumbnails")` — oppure consiste in un file collocato in `backend/crons` o `backend/functions`. Essa non va mai scritta manualmente in `rebase.resources.json`, file generato automaticamente da tali dichiarazioni per consentire all'host di determinare le dipendenze del progetto senza compilarlo. Ogni voce tiene traccia dei relativi utilizzatori (`collection:events`, `property:posts.cover`, `function:report`).

Un backend include inoltre un database predefinito e una sorgente di archiviazione predefinita che non richiedono alcuna dichiarazione. Entrambi compaiono in questo elenco con il contrassegno `implicit` e non vengono registrati in `rebase.resources.json`: essendo forniti direttamente dall'host, la loro annotazione comporterebbe la richiesta di provisioning per risorse non esplicitamente sollecitate.
Dichiararne uno con
nome, come `bucket("media")`, lascia il predefinito dov'è, quindi compaiono entrambi.
Solo dichiarare il predefinito stesso, o segnare un bucket con `default: true`, lo
sostituisce. Su 0.24 la sorgente di archiviazione predefinita spariva da
`rebase status` e `rebase resources` appena veniva dichiarato un qualsiasi bucket,
sebbene il server continuasse a servirla.

Per verificare le risorse allocate sulla piattaforma a fronte di quanto dichiarato nel codice, e per eliminare un database allocato non più presente nel codice, consulta la sezione [`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` — tutti i comandi di Rebase Cloud: autenticazione, collegamento del progetto, deploy, configurazione, database, risorse, compute e altro — ha [una pagina dedicata](/docs/cli/cloud).

### `rebase generate-sdk`

Genera un SDK tipizzato a partire dalle definizioni delle tue collection:

```bash
rebase generate-sdk
```

Crea tipi TypeScript e un client type-safe per tutte le tue collection.

`--register` tipizza anche i dati lato server: scrive i tipi e la dichiarazione
`Register` in `config/generated/`, e ricorda la scelta in
`rebase.json` (`registerDatabase`), così le esecuzioni successive, `rebase dev` e i nuovi clone
li mantengono aggiornati.
Vedi [Dati lato server tipizzati](/docs/backend/typed-server-data).

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

**Con connessione al database** — quello del progetto, risolto come lo risolve `rebase db url`,
quindi su uno scaffold appena creato è il database gestito, che `doctor` avvia:

| Controllo | Motivazione |
| --- | --- |
| Collection → schema generato | Verifica l'eventuale mancato aggiornamento di `schema.generated.ts`. |
| Collection → database | Rileva tabelle, colonne, enum, chiavi esterne e tabelle ponte mancanti. |
| Estensioni richieste | La presenza di una proprietà `{ type: "vector" }` richiede pgvector, che Rebase installa esclusivamente nei progetti in cui è esplicitamente dichiarata. |
| Schema stamp | Verifica che il database sia stato inizializzato a partire da queste specifiche collection. Trattandosi di un hash, evidenzia l'eventuale disallineamento tra le parti senza specificare quale risulti più recente. |
| Collection → tipi SDK | Verifica l'eventuale mancato aggiornamento dell'SDK tipizzato generato. |
| Criteri RLS | Verifica la corrispondenza tra i criteri del database e le `securityRules` dichiarate, controllando che nessun criterio faccia riferimento a ruoli non utilizzabili dal server. |

In caso di mancata raggiungibilità del database, le relative fasi vengono contrassegnate come ignorate (con la specifica della causa), procedendo con l'esecuzione dei controlli restanti — per approfondimenti, consulta la sezione [Risoluzione dei problemi](/docs/troubleshooting/).

Il comando restituisce un codice di uscita diverso da zero qualora un controllo riscontri un errore, oppure quando una fase non possa essere completata a causa del rifiuto delle connessioni da parte del database configurato. Una fase saltata perché non è stato possibile risolvere alcun database non costituisce un errore.

`rebase doctor --policies` esegue esclusivamente i controlli relativi a RLS — escludendo la verifica delle differenze di schema e i tipi dell'SDK — e adotta una modalità restrittiva con blocco in caso di anomalie (fail closed), risultando ideale come controllo di gate nei sistemi di CI a fronte di un database di produzione.

### `rebase verify`

```bash
rebase verify
rebase verify --json
rebase verify --live
rebase verify --live --database-url postgresql://…
```

Se le collection sono pronte per il rilascio, in un unico comando veloce per la CI e per gli hook di un agente AI. Offline per impostazione predefinita, e non modifica mai nulla.

| Passo | Cosa lo fa fallire |
| --- | --- |
| Configurazione delle collection | Un file in `config/collections/` che non si carica, o che il validatore di avvio rifiuta — con le chiavi sconosciute trattate come errori, così un'opzione scritta male o un'opzione dell'interfaccia scritta fuori da `admin: { … }` (un `widget` al primo livello) viene rilevata qui invece di essere ignorata in silenzio. |
| Copertura RLS | Una collection senza `securityRules` che non ne eredita nessuna, o una con una colonna `user_id`, `owner_id`, `organization_id` o `tenant_id` che si affida invece ai valori predefiniti della directory. Una regola che permette a un ruolo di leggere ogni riga di una tabella simile è un avviso. |
| Migrazioni aggiornate | Una tabella o colonna che le collection dichiarano e che nessun file in `backend/drizzle/migrations` crea, o una rimossa che una migrazione crea ancora. Saltato per un progetto che non ha ancora migrazioni. |
| Audit RLS dal vivo | Con `--live`: il catalogo di [`rls-check`](/docs/rls-check) sul database del progetto, e se ogni migrazione è stata applicata. Il database viene risolto come lo risolvono i comandi `db` — `--database-url`, `DATABASE_URL`, `--docker`, altrimenti il database di sviluppo gestito. Un database non configurato o che non risponde è un errore, non un salto: l'audit è stato richiesto. Una policy di lettura `USING (true)` compilata da una regola `access: "public"` è un avviso finché l'API richiede un token (`AUTH_REQUIRE`, attivo per impostazione predefinita) — ogni utente autenticato legge ogni riga — e un errore con `AUTH_REQUIRE=false`, dove le righe sono anonime. |

`--json` stampa un unico oggetto — ogni passo, e ogni rilievo con il suo `file`, il `path` puntato nella configurazione della collection e il `fix` — così un agente può riparare ciò che ha rotto. `--quiet` non stampa nulla quando tutto passa. Esce con un codice diverso da zero in caso di errore; gli avvisi non lo fanno fallire.

Un progetto generato lo esegue per Claude Code dopo ogni modifica a una collection: vedi [`rebase skills install`](#rebase-skills-install).

### `rebase auth`

Comandi per la gestione dell'autenticazione:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gestisci le chiavi API di servizio del progetto — le credenziali utilizzate da un agente, uno script o un altro servizio, a differenza della sessione di un utente finale:

```bash
rebase api-keys list
rebase api-keys get abc123-def456
rebase api-keys create --name "Blog CI" --scopes data:read:posts,data:write:posts --expires-in 90
rebase api-keys create --name "Ops" --full-access --roles admin --expires-at 2027-01-31
rebase api-keys revoke abc123-def456
```

`--scopes` indica cosa può fare la chiave, separati da virgole o ripetuti; `--full-access`
le assegna ogni scope che possiede la service key tranne `keys:*`. `--roles` aggiunge ruoli RLS oltre a
`service`, `--expires-in` accetta un numero di giorni e `--expires-at` una data ISO.
`rebase api-keys scopes` elenca ogni scope noto al backend. La chiave viene visualizzata una sola volta.

Le chiavi prevedono un duplice livello di autorizzazione: a esse si applicano sia gli scope della chiave sia la row-level security (RLS) dell'identità con cui opera. Vedi [Chiavi API](/docs/backend/api-keys/).

### `rebase storage`

Manutenzione dell'intero
store dei file archiviati, tramite il backend in esecuzione con
`REBASE_SERVICE_KEY` da `.env`:

```bash
rebase storage orphans                         # files no row names
rebase storage orphans --source media --delete # and delete them, after asking
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` legge ogni riga di ogni collection così come è memorizzata (comprese quelle eliminate in modo
soft, al di là di ogni hook `beforeQuery` e `afterRead`) e ogni voce della
[cronologia](/docs/backend/history/), dato che un ripristino riporta ciò che essa contiene.
Elenca i file di una sorgente (`--source`, la sorgente predefinita se omesso)
che nessuna stringa in nessuna di esse nomina: una chiave, un URL, un riferimento `rebase-storage:` in
un testo. I file più recenti di `--older-than` ore (24 per impostazione predefinita) sono esclusi,
perché il pannello di amministrazione carica un file prima che la riga che lo nomina venga salvata.
La scansione viene eseguita sul backend in background, quindi un progetto troppo grande per essere scansionato
in una sola richiesta (dietro un ingress che la interrompe per timeout) arriva comunque alla fine. La
CLI la avvia, poi mostra i progressi (file elencati, righe lette, collection
completate, ed eventuali collection che non è stato possibile leggere) fino al termine. Con la
[coda di job](/docs/backend/jobs/) attiva, la scansione è un job `storage.orphans` che
viene eseguito dai worker dei job. Senza di essa, la scansione viene eseguita all'interno del processo del server
interpellato, e la CLI lo segnala: riavviare quel processo interrompe la scansione. Una scansione
è un singolo tentativo di job, limitato da `jobs.timeoutMs` (15 minuti per impostazione predefinita). Aumentalo,
o impostalo a 0, per una sorgente che richiede più tempo. `--json` stampa lo stesso
report di prima, più il suo `scanId`.

`--delete` chiede conferma prima di eliminare (`--yes` salta la domanda, ed è obbligatorio
senza un terminale). Elimina solo a partire dalla scansione appena stampata, e solo entro
15 minuti dal completamento di quella scansione. Nulla viene eliminato finché una collection
non può essere letta: una collection con hook di lettura su una sorgente dati il cui driver
non può leggere oltre di essi conta come non letta. Prima di eliminare qualsiasi cosa, il server
rilegge ogni riga e ogni voce della cronologia rispetto ai file elencati. Poi richiede
ogni file di nuovo subito prima di eliminarlo. Un file che una riga nomina adesso,
che è stato caricato di nuovo dopo la scansione, o che non esiste più, viene mantenuto, e la CLI
lo elenca come mantenuto. I file che solo le tue tabelle fuori dalle collection nominano sembrano
inutilizzati: controlla prima di eliminare. Contro un backend della 0.25.1 o precedente, la
CLI scansiona alla vecchia maniera, all'interno di una sola richiesta.

`move` copia i file sotto `--prefix` in un'altra sorgente con le stesse chiavi,
una pagina alla volta. Un file che la destinazione contiene già con la stessa dimensione viene saltato,
quindi uno spostamento interrotto riprende eseguendolo di nuovo; `--delete-source` elimina ogni
file dalla sorgente una volta che la destinazione lo contiene, ed è rifiutato quando le due
sorgenti memorizzano nello stesso bucket o nella stessa directory. Terminato lo spostamento, la CLI
elenca di nuovo la sorgente con una scansione nuova e nomina ogni file che lo spostamento non ha
spostato: con `--delete-source`, ogni file ancora nella sorgente; senza, ogni file
di cui la destinazione non contiene una copia della stessa dimensione. Esce con codice 1 se ce n'è uno,
e rieseguire lo stesso spostamento lo recupera. `--json` li stampa come `notMoved`. Entrambi richiedono `database:read`, e
eliminare o spostare `database:write`, che la service key possiede.

### `rebase skills install`

Installa le skill di riferimento di Rebase per i tuoi assistenti di programmazione AI — valido per tutti i valori di `--agent` indicati in precedenza:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
rebase skills --hooks
```

Per l'elenco esaustivo e la destinazione dei file installati, consulta la sezione [Skill degli agenti](/docs/ai/skills).

`--hooks` installa la protezione per Claude Code che `rebase init` include in ogni progetto: `.claude/hooks/post-edit-collection.sh`, registrato come hook `PostToolUse` in `.claude/settings.json`, che esegue `rebase verify --quiet` dopo ogni modifica in `config/collections/` e restituisce ogni problema all'agente. Le impostazioni e gli hook esistenti vengono mantenuti. `rebase skills --hooks` installa solo l'hook.

### `rebase telemetry`

Condivisione anonima dei dati di utilizzo, disattivata finché non dici di sì. Un
`rebase init` interattivo lo chiede alla fine, e il prompt ha come predefinito no, quindi
nulla viene condiviso a meno che tu risponda sì. La risposta vale per macchina
(`~/.rebase/telemetry.json`): dopo un sì `init` non lo chiede più, e dopo un no il
successivo `init` lo chiede di nuovo. Ogni checkout riceve un id di progetto casuale,
conservato nel suo `.rebase/telemetry-project.json` escluso da git.
Su 0.24 il prompt ha come predefinito sì, e l'id di progetto cambia a ogni riavvio di
`rebase dev`.

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
