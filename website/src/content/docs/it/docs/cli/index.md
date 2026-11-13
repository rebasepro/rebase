---
sourceHash: ed5be063323e7f6a
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

`--json` è il selettore, e al di fuori della famiglia `cloud` è l'unico: `rebase status`, `rebase resources`, `rebase apps list`, `rebase upgrade` e `rebase verify` inviano quindi un singolo valore JSON su stdout — il risultato, o un envelope `{"error": {"message", "code", "hint", "issues"}}` con un'uscita diversa da zero — a **ogni** uscita del comando, in modo che un chiamante possa analizzare stdout incondizionatamente. Senza di esso scrivono testo leggibile dall'uomo e gli errori vanno su stderr. `rebase cloud` utilizza lo stesso envelope ed è l'unica eccezione al selettore: attiva anche il JSON automaticamente quando stdout non è un TTY, o quando è impostato `REBASE_JSON=1`. Quindi `rebase cloud status | cat` restituisce JSON mentre `rebase status | cat` no — in uno script, passa `--json` esplicitamente anziché affidarti a queste regole.

## Comandi

### `rebase init`

<span class="since-badge" data-since="0.31">Dalla 0.31</span>

Inizializza un nuovo progetto Rebase:

```bash
rebase init [directory]
```

Configura un `backend/` (le tabelle in `backend/schema/`) e un `frontend/` (il pannello di amministrazione, con le personalizzazioni delle tabelle in `frontend/src/cms/`); `--headless` genera solo il `backend/`, senza `backend/schema/`. [Struttura del progetto](/docs/getting-started/project-structure/) mostra entrambi gli alberi.

| Flag | Cosa fa |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` o `blank`. Predefinito `blog` |
| `--headless` | Solo backend — nessun pannello di amministrazione e nessun `backend/schema/`: il server serve le tabelle proprietarie del database. `--template` non ha effetto, poiché non ci sono tabelle da popolare |
| `-y, --yes` | Non chiedere mai conferme. **Obbligatorio ovunque non ci sia un terminale per rispondere**, come in CI. Salta git init e l'installazione delle dipendenze — i valori predefiniti interattivi rispondono sì a entrambi, quindi passa `--git` / `--install` se li desideri |
| `-i, --install` | Installa le dipendenze dopo lo scaffolding. Senza questo flag, init chiede (predefinito sì); con `--yes`, non viene installato nulla |
| `--no-install` | Non installare nulla e non chiedere |
| `-g, --git` | Inizializza un repository ed esegue il primo commit. Senza questo flag, init chiede (predefinito sì); con `--yes`, nessun repository |
| `--database-url <url>` | Usa un database esistente invece di quello gestito. Deve essere un URL `postgres://` o `postgresql://`: qualsiasi altra cosa viene rifiutata prima che un file venga scritto, e il prompt interattivo chiederà di nuovo |
| `--introspect` | Genera `backend/schema` da quel database. Implica `--template blank` e richiede `--install` |
| `--project <slug>` | Collega lo scaffold a un progetto Rebase Cloud |
| `--setup-key <key>` | La chiave monouso che autentica tale collegamento |
| `-a, --agent <name>` | Configura gli agenti di programmazione AI: le [skill](/docs/ai/skills) e il [server MCP](/docs/ai/mcp). Ripetibile o separato da virgola — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` o `all`. Senza questo flag, `init` chiede e pre-seleziona gli agenti installati sulla macchina; con `--yes`, nessuno |

### `rebase dev`

Avvia il server di sviluppo:

```bash
rebase dev
```

Avvia sia il frontend che il backend con hot reloading, e rigenera lo schema Drizzle e i tipi dell'SDK (`generated/sdk/`) all'avvio e a ogni salvataggio all'interno di `backend/schema/`.

Entrambe le porte sono derivate dal percorso del progetto in modo che diversi progetti Rebase possano essere eseguiti
fianco a fianco. Usa gli URL stampati da `rebase dev`. Fissane una con `rebase dev --port 3001`.

Una modifica a `.env`
riavvia il backend, che rilegge il file, così come fa il pannello di amministrazione. Ciò che
`rebase dev` imposta autonomamente viene mantenuto fino al suo riavvio: `PORT`, e
`DATABASE_URL` quando si trova sul database gestito o su Docker.

Con
`--database-url`, `rebase dev` verifica prima che qualcosa risponda a quell'host
e porta. Se non risponde nulla, lo segnala, menzionando il flag, ed esce con `1` senza
avviare nulla; inoltre non tocca i nomi del database in `.env`, senza mai avviare
il suo container compose.

### `rebase build`

Compila il progetto in un bundle distribuibile in `dist-bundle/`:

```bash
rebase build
```

Il bundle è l'artefatto da distribuire — l'immagine di runtime lo carica, quindi non c'è
alcuna immagine dell'applicazione da compilare autonomamente. Flag utili:

| Flag | Effetto |
|------|--------|
| `--output <dir>` (o `--out`) | Scrive il bundle in una posizione diversa da `dist-bundle/` (un'app alla volta) |
| `--vendor` | Installa e include sempre le dipendenze del bundle |
| `--no-vendor` | Non include mai le dipendenze; il pod le installa a ogni avvio |
| `--skip-type-check` | Salta il controllo dei tipi (più veloce, meno sicuro) |
| `--no-static` | Non integra il frontend nel bundle del backend (ogni app statica ottiene comunque il proprio bundle) |
| `--skip-static-build` | Integra il frontend così come già compilato, senza eseguire il suo comando di build |

<span class="since-badge" data-since="0.31">Dalla 0.31</span> Un frontend la cui configurazione Vite non utilizza `rebaseBackendGuard()` (da
`@rebasepro/app/vitePlugin`) viene rifiutato: è ciò che tiene il codice server fuori dal
bundle del browser. `frontend/src/cms/ui-config.json` viene inserito nel bundle come
`entry.uiConfig`, la presentazione dell'area di lavoro servita da un backend distribuito.

Le dipendenze vengono incluse (vendored) per impostazione predefinita, in modo che una nuova istanza non debba sostenere
un'installazione di 35–55 secondi. Un albero che supera i 2 GB su disco viene invece scartato, poiché
il limite di caricamento è di 1 GB compresso.

Ogni app statica inclusa
nel bundle riceve una copia brotli (`.br`) e gzip (`.gz`) accanto a ciascun
asset con hash del contenuto pari o superiore a 1 KB — i file che un browser memorizza nella cache per un anno.
Il runtime invia quella accettata dal browser, quindi tali file non richiedono alcun
lavoro di compressione per richiesta, inclusa la prima visita dopo un deploy, e
i browser che supportano brotli la ricevono (circa l'11% più piccola di gzip sul JavaScript
dell'amministrazione). L'output di compilazione del tuo frontend rimane inalterato; solo la copia
nel bundle cambia. Sull'app di esempio questo aggiunge meno di un secondo alla compilazione
e circa 2,4 MB al bundle.

### `rebase upgrade`

Aggiorna ogni pacchetto `@rebasepro/*` bloccato dal progetto a una singola release, quindi
installa con il package manager specificato nel file di lock. `rebase upgrade` seleziona la
versione più recente; `--to 0.21.0` una versione esatta, senza consultare il registry; `--to canary` un
dist-tag. Ogni versione bloccata in `dependencies`, `devDependencies` e
`optionalDependencies`, in ogni `package.json` del progetto, mantiene il suo `^`
o `~`, e nient'altro nel file viene modificato. `peerDependencies` e
specifiche `workspace:`, `link:`, `file:`, git e tag vengono elencati e lasciati invariati.
Anche gli override in `pnpm-workspace.yaml` e `package.json` vengono aggiornati, ma un override `link:` o
`file:` ha la precedenza su qualsiasi pin: viene segnalato e
`--drop-local-overrides` lo rimuove. `--dry-run` non scrive nulla, `--no-install`
salta l'installazione e `--json` stampa un unico documento.

Un progetto su una
prerelease, come una canary, rimane sul suo canale a meno che `latest` non sia più recente. Un
dist-tag che comporterebbe il downgrade di una versione bloccata viene rifiutato (`downgrade_refused` sotto
`--json`) a meno che non si passi `--allow-downgrade`; un `--to` esatto viene applicato e
segnalato come downgrade. Un `--dry-run` di un aggiornamento che l'esecuzione reale rifiuterebbe
mostra cosa verrebbe aggiornato ed esce con 0, e sotto `--json` il suo documento riporta il
rifiuto come `wouldRefuse` (`{ code, message, hint }`).

### `rebase start`

Esegue il bundle compilato nello stesso modo in cui lo esegue un deployment:

```bash
rebase start
```

Legge `PORT` e il resto di `.env`, a differenza di `rebase dev`, nel `NODE_ENV`
impostato. Un `.env` generato via scaffold indica `development`, quindi il primo account a registrarsi
diventa comunque l'amministratore, e `rebase start` lo segnala all'inizio; imposta `NODE_ENV=production`
per un server di produzione. `rebase start --bundle ./dist-bundle` esegue un bundle altrove.

`rebase start` non avvia alcun database e il `.env` dello scaffold non contiene
`DATABASE_URL`, quindi un'esecuzione locale sul database utilizzato da `rebase dev` è
`DATABASE_URL="$(rebase db url)" rebase start`.
Senza di esso, stampa quella riga prima dell'avvio.

### `rebase apps list`

Mostra le app dichiarate da questo repository:

```bash
rebase apps list
```

Un repository può dichiarare più di un'app distribuibile — ad esempio, un backend e un
sito di marketing. In questo modo puoi vedere su cosa agiranno `rebase build` e il deployment.

### `rebase eject`

Prendi il controllo del processo del server e della sua immagine:

```bash
rebase eject
```

Scrive l'entrypoint del backend e un `Dockerfile` nel progetto e converte il suo
backend, in modo che il repository compili la propria immagine invece di eseguire il
runtime pubblicato. Da quel momento in poi **gli aggiornamenti del runtime della piattaforma non lo raggiungeranno più**,
e CORS, configurazione dell'autenticazione, storage e arresto saranno a tuo carico.

Visualizza un'anteprima con `rebase eject --dry-run`, che elenca cosa cambierebbe senza
modificare nulla. `--force` sostituisce un eventuale `backend/src/index.ts` o
`env.ts` esistente, conservando il file corrente come `<name>.bak`.

Il server dopo l'eject
mantiene i caricamenti locali nella cartella `uploads/` del progetto, eseguito da sorgente o compilato, come
fa `rebase dev`. Viene eseguito in `backend/`, quindi un `STORAGE_PATH` relativo al suo interno viene
letto da `backend/`.

### `rebase schema generate` / `rebase schema stale`

<span class="since-badge" data-since="0.31">Dalla 0.31</span>

```bash
rebase schema generate       # backend/schema → backend/src/schema.generated.ts
rebase schema stale          # elenca le differenze rispetto alle tabelle, esce con 1 se ce ne sono
rebase schema stale --fix    # rigenera invece il file
```

Ogni comando che legge lo schema accetta `--schema-dir <dir>` per un progetto
che lo conserva altrove; `--collections` è stato rimosso. `rebase dev` mantiene il
file aggiornato, quindi `stale` è il controllo ideale per una build o per la CI. Consulta
[Generazione dello schema](/docs/cli/schema/).

### `rebase db`

```bash
rebase db push                 # applica le tabelle al database (sviluppo)
rebase db generate             # scrive un file di migrazione SQL
rebase db migrate              # applica le migrazioni in sospeso
rebase db url                  # stampa la stringa di connessione utilizzata da questo progetto
rebase db pull --from <url>    # copia un altro database in quello locale
rebase db backup               # pg_dump; include anche db backups list e db restore
rebase db branch create <name> # una copia su cui lavorare; include switch, list e prune
rebase db stop                 # arresta il database di sviluppo gestito
rebase db reset                # lo elimina e ricomincia da capo
rebase db request-role migrate --to <role> # sposta le richieste su un altro ruolo Postgres
rebase db provision --print    # l'SQL che configura il ruolo di richiesta, per un DBA
```

Ciascuno è documentato in [Comandi Database](/docs/cli/database/), con l'ordine in cui un
comando sceglie il proprio database; `push`, `generate` e `migrate` sono trattati in
dettaglio in [Generazione dello schema](/docs/cli/schema/).

### `rebase console`

<span class="since-badge" data-since="0.31">Dalla 0.31</span>

Un REPL Node con i dati del progetto aperti, o un singolo snippet eseguito con `-e`:

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) e `collections` (le
tabelle del progetto, caricate da `backend/schema`) sono nello scope, e l'`await`
di primo livello funziona. Il database viene risolto come lo
risolve `rebase db push`, e aprirlo non modifica nulla al suo interno. Con `-e`, il risultato
atteso viene stampato come JSON su stdout e un errore (throw) genera un'uscita `1`. Flag: `--eval`/`-e`,
`--schema-dir`, `--database-url`, `--docker`. Consulta
[Script e la Console](/docs/backend/scripts/).

### `rebase migrate`

<span class="since-badge" data-since="0.31">Dalla 0.31</span>

Migrazioni unidirezionali da una struttura non più supportata da questa versione:
`rebase migrate collections-to-tables` (`config/collections` → `backend/schema`
e `frontend/src/cms`) e `rebase migrate sdk-calls` (`data.collection("x")`
→ `data.table("x")` nel tuo codice). I relativi flag, cosa scrivono e la
sezione "Verifica prima del deployment" si trovano in
[Generazione dello schema](/docs/cli/schema/#rebase-migrate).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # le app dichiarate da questo progetto
rebase apps init             # scrive un rebase.json dedotto da questo progetto
rebase apps config <app>     # la configurazione client per un'app specifica
```

`apps init` non accetta alcun nome: deduce ogni app dal progetto e scrive l'intero
`rebase.json`, rifiutando di sovrascriverne uno esistente a meno che non si passi
`--force`.

Un argomento con il nome viene
rifiutato. `--force` mantiene ciò che l'inferenza automatica non può rilevare dal file che sostituisce:
il nome di ciascuna app, il suo `path` e la sua route `cms`. Tutto il resto viene dedotto
nuovamente, e un'app dichiarata che non viene più trovata viene indicata come rimossa; pertanto, su uno
scaffold riscrive il `rebase.json` fornito originariamente dallo scaffold. Il comando di build dell'app
statica utilizza il package manager del progetto.

Per un
checkout non collegato a un progetto Cloud, `apps config` segnala che non è collegato,
indipendentemente dal fatto che `rebase dev` sia in esecuzione o meno, e fornisce l'URL del backend così
come servito da `rebase dev`.

### `rebase status`

Tutto ciò che questo progetto dichiara e se l'ambiente lo associa effettivamente:

```bash
rebase status               # ogni risorsa e le variabili che legge
rebase status --json        # leggibile da macchina
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

Tre file determinano cosa un backend può raggiungere, e questo comando li stampa tutti e tre insieme:
`rebase.json` indica dove si trova il codice e chi esegue il server,
`backend/resources.ts` indica di cosa ha bisogno il progetto e l'ambiente indica come
raggiungere ciascun elemento. Tutto il resto — `rebase.resources.json`, il manifest
del bundle — viene generato dal file intermedio per i reader che non possono eseguire il
tuo codice, e non dovrai mai scriverlo a mano.

Un `○` rappresenta lo stato utile da conoscere prima di un deploy piuttosto che dopo:
dichiarato, non configurato. Una `✗` indica che l'ambiente imposta qualcosa in modo *errato*,
il che impedisce l'avvio anziché funzionare in modalità degradata.

Un
`rebase.resources.json` che non corrisponde più alle dichiarazioni riceve una riga `○`.
Uno che non è ancora stato scritto non la riceve: `rebase build` lo scrive a ogni
build, quindi un progetto che non è mai stato compilato, come un nuovo scaffold, non ha
nulla da correggere.

### `rebase resources`

Ciò che questo progetto dichiara di richiedere — i database, bucket, topic e
code richiesti da `backend/resources.ts`, e i cron e le funzioni definiti dai suoi file:

```bash
rebase resources            # elencali
rebase resources --write    # rigenera rebase.resources.json
rebase resources --check    # fallisce se il grafo committato non è aggiornato
rebase resources --json     # leggibile da macchina
```

`rebase resources --check` è il flag che un job di CI utilizza per fallire in presenza di un
`rebase.resources.json` che non corrisponde più a `backend/resources.ts`.
`--json` si combina
con esso: in caso di disallineamento, `rebase resources --check --json` esce con codice 1 restituendo un envelope
di errore (`resource_graph_missing` o `resource_graph_stale`), mentre in caso di successo
il grafo riporta `check.status`. `--write --json` scrive il file e restituisce
`written.changed`.

Una risorsa viene dichiarata in `backend/resources.ts` — `database("analytics")`,
`bucket("media")`, `topic("signups")`, `queue("thumbnails")` — o è un file
sotto `backend/crons` o `backend/functions`, e non va mai scritta a mano in
`rebase.resources.json`, che viene generato da tali dichiarazioni in modo che un host possa
leggere ciò di cui un progetto ha bisogno senza compilarlo. Ogni voce registra chi la utilizza
(`table:events`, `column:posts.cover`, `function:report`).

Un backend ha anche un database predefinito e una sorgente di storage predefinita che nessuno
dichiara esplicitamente. Entrambi sono elencati qui, contrassegnati come `implicit`, e nessuno dei due viene scritto in
`rebase.resources.json` — l'host li fornisce automaticamente, quindi registrarli comporterebbe
la richiesta di provisioning di qualcosa che nessuno ha richiesto.
Dichiararne una
con nome, come `bucket("media")`, lascia l'impostazione predefinita invariata, quindi entrambe vengono
elencate. Solo la dichiarazione esplicita della risorsa predefinita, o il contrassegnare un bucket con
`default: true`, la sostituisce.

Per vedere cosa la piattaforma riserva per un progetto a fronte di ciò che il suo codice dichiara,
e per rimuovere un database allocato non più menzionato dal codice, consulta
[`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` — ogni comando per Rebase Cloud: autenticazione, collegamento al progetto, deploy, configurazione, database, risorse, compute e altro — ha [la propria pagina dedicata](/docs/cli/cloud).

### `rebase generate-sdk`

<span class="since-badge" data-since="0.31">Dalla 0.31</span>

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

Il comando da eseguire quando qualcosa non va e non sai ancora cosa. Genera
un report senza modificare mai nulla, quindi è sicuro su qualsiasi database raggiungibile.

**Senza un database.** Questi controlli vengono eseguiti per primi, poiché tutto ciò che impedisce a un progetto
di avviarsi si verifica prima ancora che una tabella possa essere confrontata:

| Controllo | Motivo |
| --- | --- |
| Versione di Node | Confrontata con l'intervallo dichiarato dalla CLI. Una versione troppo vecchia non viene segnalata come "Node non supportato" — si manifesta come un errore di sintassi all'interno di una dipendenza. |
| Package manager | Due lockfile in un unico progetto. Eseguire `npm install` in un workspace pnpm riscrive `node_modules` in una struttura incompatibile con pnpm, e il sintomo è `Cannot find module` ore dopo. |
| Slug duplicati | Due tabelle che dichiarano lo stesso slug. Lo schema rifiuta la compilazione in questo caso, e questo controllo le segnala entrambe. |
| Validità di `.env` | Un `JWT_SECRET` inferiore a 32 caratteri (che la produzione rifiuta all'avvio) e `NODE_ENV=production` senza `CORS_ORIGINS` né `FRONTEND_URL`. I valori non vengono mai stampati. |
| Disallineamento versioni `@rebasepro/*` | Lo stesso pacchetto bloccato su versioni diverse tra i vari file `package.json` del progetto. Due copie rompono l'`instanceof` tra loro, fallendo come type guard che rigetta il proprio stesso tipo. |
| Stringhe di connessione | Un `=` non codificato in un parametro URL, che gli strumenti nativi di PostgreSQL rifiutano di analizzare — provocando il blocco dei backup e di `psql` mentre l'app continua a funzionare. |
| Funzioni personalizzate | Ciò di cui ciascuna funzione ha bisogno dal proprio host, e quali di esse non potrebbero essere eseguite su un runtime edge. |

**Contro il database** — quello del progetto, risolto nello stesso modo in cui lo
risolve `rebase db url`, quindi su un nuovo scaffold si tratta del database gestito, che `doctor`
avvia:

| Controllo | Motivo |
| --- | --- |
| Tabelle → schema generato | Verifica se `schema.generated.ts` non è aggiornato. |
| Tabelle → database | Tabelle, colonne, enum, foreign key e junction mancanti. |
| Estensioni richieste | Una colonna `col.vector()` richiede pgvector, che Rebase installa solo dove dichiarato dal progetto. |
| Schema stamp | Verifica se questo database è stato allocato a partire da queste tabelle. È un hash, quindi può indicare che i due differiscono ma non chi è più avanti. Un timbro `v1:` da un runtime precedente alla 0.31 viene segnalato una volta, con l'indicazione per riapplicarlo: `rebase db push`. |
| Tabelle → tipi SDK | Verifica se l'SDK tipizzato generato non è aggiornato. |
| Criteri RLS | Verifica se le policy del database corrispondono a `rls` dichiarato e se qualche policy menziona un ruolo che questo server non può utilizzare. |

Se il database non è raggiungibile, le sue fasi vengono segnalate come saltate con il
relativo motivo e il resto continua a essere eseguito — consulta [Risoluzione dei problemi](/docs/troubleshooting/).

Esce con codice diverso da zero quando un controllo rileva un errore, o quando una fase non può essere eseguita
perché il database specificato rifiuta le connessioni. Una fase saltata perché
non è stato possibile risolvere alcun database non viene considerata un fallimento.

`rebase doctor --policies` esegue solo i controlli RLS — nessun diff dello schema, nessun controllo
dei tipi SDK — e adotta una politica fail-closed, rendendolo ideale come gate di CI a fronte di
un database distribuito.

`rebase doctor --database`
esegue solo il preflight del database: verifica se il ruolo con cui vengono eseguite le richieste autenticate
esiste, è limitato e può essere assunto, quali altri accessi possono passare
a esso, se ogni ruolo può connettersi e quali tabelle, permessi e criteri
Rebase condividerebbe con altri ruoli. Ogni risultato indica l'SQL da eseguire come
amministratore, l'impostazione `rls` per adattare invece Rebase al database, oppure
entrambi. Legge il catalogo e non modifica nulla, uscendo con 1 se un risultato è
un errore. Funziona anche su un progetto headless. Consulta
[Esecuzione su un database esistente o condiviso](/docs/deployment/existing-database/).

### `rebase verify`

```bash
rebase verify
rebase verify --json
rebase verify --live
rebase verify --live --database-url postgresql://…
```

<span class="since-badge" data-since="0.31">Dalla 0.31</span>

Verifica se le tabelle sono pronte per il rilascio, in un unico comando rapido per la CI e per
gli hook degli agenti AI. Funziona offline per impostazione predefinita e non modifica mai nulla.

| Passaggio | Cosa ne determina il fallimento |
| --- | --- |
| Definizioni delle tabelle (`schema`) | `backend/schema` non si carica o non si compila tramite il loader da cui si avvia il backend: una relazione verso una tabella non esportata dall'index, `rls: "inherit"` senza `defaultRls`, una tabella senza chiave primaria — una segnalazione per ogni problema. Una tabella senza `rls` è uno di questi. |
| Copertura RLS (`rls`) | Una tabella con una colonna `user_id`, `owner_id`, `organization_id` o `tenant_id` le cui regole — proprietarie o ereditate da `defaultRls` — consentono a un ruolo di leggere ogni riga indipendentemente da essa. Viene generato un avviso (warning). |
| Aggiornamento delle migrazioni (`migrations`) | Una tabella o colonna dichiarata nelle tabelle che nessun file in `backend/drizzle/migrations` crea, oppure una rimossa che una migrazione continua a creare. Saltato per un progetto che non ha ancora migrazioni. |
| Personalizzazioni CMS (`cms`) | Una chiamata `customizeTable(...)` in `frontend/src/cms` (o in `src/cms` di un'app statica in `rebase.json`) che non corrisponde alle tabelle, letta staticamente — i moduli non vengono eseguiti. `cms-unknown-table`: lo slug non corrisponde ad alcuna tabella, quindi il pannello lo ignora (viene suggerito lo slug più vicino). `cms-unknown-field`: una chiave sotto `fields` non è né una colonna né una relazione (il nome SQL di una colonna riceve in risposta la sua chiave). `cms-hidden-required`: un campo escluso dal form (`hiddenInForm`, `readOnly`, `disabled`) la cui colonna è `NOT NULL` senza valore predefinito e senza che il server lo popoli, per cui la creazione di un record dal pannello fallisce sempre; produce un avviso quando un hook o transform `beforeSave` potrebbe popolarlo, ed è silenziato da `filledByServer`. `cms-duplicate-customization`: uno slug personalizzato due volte. `cms-not-static` (avviso): una chiamata il cui slug, opzioni o `fields` non sono valori letterali o una `const` nello stesso file, per cui nessun controllo è stato eseguito al suo interno. `cms-ui-config-not-mounted` (avviso): `frontend/src/cms/ui-config.json` esiste ma non viene passato a `<RebaseCMS>` come `uiConfig`. `cms-backend-guard-missing`: la configurazione Vite del frontend non usa `rebaseBackendGuard()`, quindi `rebase build` lo rifiuterebbe. Un progetto headless non ha `frontend/src/cms` e salta questo passaggio. |
| Audit RLS in tempo reale (`live`) | Con `--live`: confronta il catalogo [`rls-check`](/docs/rls-check) con il database del progetto e verifica se ogni migrazione è stata applicata. Il database viene risolto come fanno i comandi `db` — `--database-url`, `DATABASE_URL`, `--docker`, altrimenti il database di sviluppo gestito. Un database non configurato o che non risponde costituisce un errore, non un passaggio saltato: l'audit è stato esplicitamente richiesto. Una policy di lettura `USING (true)` compilata da una regola `access: "public"` genera un avviso finché l'API richiede un token (`AUTH_REQUIRE`, attivo per impostazione predefinita) — ogni utente autenticato legge ogni riga — e un errore con `AUTH_REQUIRE=false`, dove le righe sono anonime. |

`--json` stampa un singolo oggetto, `{ ok, schemaDir, steps, findings, summary }`:
ogni step è `{ id, title, status, detail? }` (`status` può essere `passed`, `failed`,
`warnings` o `skipped`), e ogni finding contiene `step`, `check` (un tipo kebab-case stabile),
`severity`, `message` e, dove applicabile, `fix`, `table`,
`file`, `line` e il percorso puntato `path` all'interno della tabella (`posts.rls[0]`) — consentendo a un agente di
correggere ciò che ha interrotto. `summary` calcola il totale di `errors` e `warnings`. `--quiet` non stampa nulla se tutti i controlli hanno esito positivo. Esce con codice diverso da zero in caso
di errore; gli avvisi non ne determinano il fallimento.

Un progetto creato tramite scaffold esegue questo comando per Claude Code dopo ogni modifica all'interno di `backend/schema/`: consulta
[`rebase skills install`](#rebase-skills-install).

### `rebase auth`

Comandi per la gestione dell'autenticazione:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gestisci le chiavi API di servizio del progetto — le credenziali utilizzate da un agente, uno script o
un altro servizio, a differenza della sessione di un utente finale:

```bash
rebase api-keys list
rebase api-keys get abc123-def456
rebase api-keys create --name "Blog CI" --scopes data:read:posts,data:write:posts --expires-in 90
rebase api-keys create --name "Ops" --full-access --roles admin --expires-at 2027-01-31
rebase api-keys revoke abc123-def456
```

`--scopes` definisce le operazioni consentite alla chiave, separate da virgola o ripetute; `--full-access`
le assegna ogni scope posseduto dalla chiave di servizio, eccetto `keys:*`. `--roles` aggiunge ruoli RLS
oltre a `service`, `--expires-in` accetta giorni ed `--expires-at` una data ISO.
`rebase api-keys scopes` elenca tutti gli scope noti al backend. Una chiave viene mostrata una sola volta.
Si applicano sia gli scope della chiave sia la row-level security dell'identità per cui agisce.
Consulta [Chiavi API](/docs/backend/api-keys/).

### `rebase storage`

Manutenzione
dell'intero archivio dei file memorizzati, tramite il backend in esecuzione con
`REBASE_SERVICE_KEY` da `.env`:

```bash
rebase storage orphans                         # file a cui nessuna riga fa riferimento
rebase storage orphans --source media --delete # ed eliminali, previa conferma
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` legge ogni riga di ogni tabella così come archiviata (comprese le righe
eliminate logicamente, oltrepassando qualsiasi hook `beforeQuery` e `afterRead`) e ogni
voce di [cronologia](/docs/backend/history/), poiché un ripristino recupera ciò che contiene.
Elenca i file di una determinata sorgente (`--source`, la sorgente predefinita se omessa)
a cui nessuna stringa al loro interno fa riferimento: una chiave, un URL, un riferimento
`rebase-storage:` in un testo. I file più recenti di `--older-than` ore (24 per impostazione predefinita) vengono esclusi,
poiché il pannello di amministrazione carica un file prima che la riga che lo referenzia sia salvata.
La scansione viene eseguita sul backend in background, quindi un progetto troppo grande per essere scansionato
all'interno di una singola richiesta (dietro un ingress che andrebbe in timeout) viene comunque completato. La
CLI la avvia, quindi mostra l'avanzamento (file elencati, righe lette, tabelle
completate ed eventuali tabelle che non è stato possibile leggere) fino al termine. Con la
[coda di job](/docs/backend/jobs/) attiva, la scansione è un job `storage.orphans` eseguito
dai worker dei job. Senza di essa, la scansione viene eseguita all'interno del processo server a cui è
stata richiesta, e la CLI lo notifica: il riavvio di tale processo interrompe la scansione. Una scansione
rappresenta un singolo tentativo di job, limitato da `jobs.timeoutMs` (15 minuti per impostazione predefinita). Aumenta
questo valore, o impostalo su 0, per una sorgente che richiede più tempo. `--json` stampa lo stesso
report descritto in precedenza, oltre al relativo `scanId`.

`--delete` chiede conferma prima dell'eliminazione (`--yes` salta la domanda ed è obbligatorio
in assenza di terminale). Elimina solo in base alla scansione appena stampata ed esclusivamente entro
15 minuti dal completamento di tale scansione. Non viene eliminato nulla se una tabella
non può essere letta: una tabella con hook di lettura su un database il cui driver
non può oltrepassarli viene considerata non letta. Prima di eliminare qualsiasi cosa, il server
legge nuovamente ogni riga e voce di cronologia confrontandole con i file elencati. Quindi richiede
conferma per ciascun file immediatamente prima di eliminarlo. Un file a cui una riga fa riferimento ora,
che è stato caricato di nuovo dopo la scansione, o che non esiste più viene mantenuto, e la CLI
lo elenca come mantenuto. I file a cui fanno riferimento solo tabelle non gestite da Rebase appaiono
inutilizzati: verifica prima di eliminare. Con un backend versione 0.25.1 o precedente, la
CLI esegue la scansione secondo la vecchia modalità, all'interno di una singola richiesta.

`move` copia i file sotto `--prefix` in un'altra sorgente mantenendo le stesse chiavi,
una pagina alla volta. Un file già presente nella destinazione con le stesse dimensioni viene saltato,
quindi uno spostamento interrotto riprende rieseguendo il comando; `--delete-source` elimina ciascun
file dalla sorgente non appena la destinazione lo contiene, e viene rifiutato se le due
sorgenti risiedono nello stesso bucket o directory. Al termine dello spostamento, la CLI
analizza nuovamente la sorgente con una nuova scansione ed elenca ogni file non
spostato: con `--delete-source`, qualsiasi file ancora presente nella sorgente; senza di esso, qualsiasi file
di cui la destinazione non possiede una copia con le stesse dimensioni. Esce con codice 1 se ne trova anche solo uno, e
rieseguendo lo stesso spostamento verrà rielaborato. `--json` li stampa come `notMoved`. La lettura del report
di una scansione richiede `database:read`. L'avvio di una scansione, l'eliminazione e lo spostamento richiedono
`database:write`, permesso posseduto dalla chiave di servizio.

### `rebase skills install`

Installa le skill di riferimento di Rebase per i tuoi assistenti di programmazione AI — ciascuno degli `--agent` sopra indicati:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
rebase skills --hooks
```

Consulta [Skill degli agenti](/docs/ai/skills) per l'elenco completo e i percorsi in cui vengono scritti i file.

`--hooks` installa il guardrail per Claude Code che `rebase init` include in ogni
progetto: `.claude/hooks/post-edit-collection.sh`, registrato come hook `PostToolUse`
in `.claude/settings.json`, che esegue `rebase verify --quiet` dopo ogni modifica
sotto `backend/schema/` o `frontend/src/cms/` e restituisce qualsiasi problema all'agente. Le impostazioni
e gli hook esistenti vengono mantenuti. `rebase skills --hooks` installa esclusivamente l'hook.

### `rebase telemetry`

Condivisione anonima dei dati di utilizzo, disattivata finché non fornisci il consenso. Un comando `rebase init` interattivo
lo chiede al termine, e la risposta predefinita è no, quindi non viene condiviso nulla a meno che tu non
risponda sì. La risposta è memorizzata per macchina (`~/.rebase/telemetry.json`): dopo un sì,
`init` non lo chiederà più; dopo un no, il successivo `init` lo chiederà di nuovo. Ciascun
checkout riceve un id di progetto casuale, conservato nel file ignorato da git
`.rebase/telemetry-project.json`.

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` stampa l'impostazione corrente, `show` stampa esattamente ciò che verrebbe inviato —
indipendentemente dal fatto che la condivisione sia attiva o meno, così da poter esaminare il payload prima di decidere — e
gli altri due comandi ne modificano lo stato. Se non hai mai eseguito `init`, non è mai stato raccolto alcun dato.

## Passaggi successivi

- **[Generazione dello schema](/docs/cli/schema/#production-workflow)** — Il flusso di lavoro delle migrazioni, dalla modifica di una tabella alla produzione
- **[Schema as Code](/docs/architecture/schema-as-code)** — Come funziona la generazione dello schema
- **[Guida rapida](/docs/getting-started/quickstart)** — Inizia subito
