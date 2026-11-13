---
sourceHash: 4281e973dcdf0b86
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

`--json` è il flag dedicato, e al di fuori della famiglia `cloud` è l'unico: `rebase status`, `rebase resources`, `rebase apps list`, `rebase upgrade` e `rebase verify` inviano quindi un singolo valore JSON su stdout — il risultato, oppure un envelope `{"error": {"message", "code", "hint", "issues"}}` con un codice di uscita diverso da zero — a **ogni** uscita del comando, in modo che un chiamante possa analizzare stdout incondizionatamente. Senza di esso, scrivono testo leggibile dall'uomo e gli errori vanno su stderr. `rebase cloud` utilizza lo stesso envelope ed è l'unica eccezione al flag: attiva automaticamente il JSON anche quando stdout non è una TTY, oppure quando `REBASE_JSON=1` è impostato. Di conseguenza, `rebase cloud status | cat` è in formato JSON mentre `rebase status | cat` non lo è — all'interno di uno script, passa `--json` esplicitamente anziché affidarti a una delle due regole.

## Comandi

### `rebase init`

<span class="since-badge" data-since="0.31">Da 0.31</span>

Inizializza un nuovo progetto Rebase:

```bash
rebase init [directory]
```

Configura un `backend/` (le tabelle in `backend/schema/`) e un `frontend/` (il pannello di amministrazione, con le personalizzazioni delle tabelle in `frontend/src/cms/`); `--headless` esegue lo scaffolding solo del `backend/`, senza `backend/schema/`. La [Struttura del progetto](/docs/getting-started/project-structure/) mostra entrambi gli alberi.

| Flag | Cosa fa |
|---|---|
| `-t, --template <preset>` | `blog`, `ecommerce` o `blank`. Predefinito: `blog` |
| `--headless` | Solo backend — nessun pannello di amministrazione e nessun `backend/schema/`: il server serve direttamente le tabelle del database. `--template` non ha effetto, poiché non ci sono tabelle da inizializzare |
| `-y, --yes` | Non richiede mai conferme interattive. **Obbligatorio ovunque non ci sia un terminale per rispondere**, come in CI. Salta git init e l'installazione delle dipendenze — le impostazioni predefinite interattive prevedono sì per entrambi, quindi passa `--git` / `--install` se desideri eseguirli |
| `-i, --install` | Installa le dipendenze dopo lo scaffolding. Senza questo flag, init lo chiede (predefinito sì); con `--yes`, non viene installato nulla |
| `--no-install` | Non installa nulla e non lo chiede |
| `-g, --git` | Inizializza un repository ed effettua il primo commit. Senza questo flag, init lo chiede (predefinito sì); con `--yes`, nessun repository |
| `--database-url <url>` | Usa un database esistente invece di quello gestito. Deve essere un URL `postgres://` o `postgresql://`: qualsiasi altra cosa viene rifiutata prima che venga scritto qualsiasi file, e il prompt interattivo chiederà nuovamente |
| `--introspect` | Genera `backend/schema` da quel database. Implica `--template blank` e richiede `--install` |
| `--project <slug>` | Collega lo scaffold a un progetto Rebase Cloud |
| `--setup-key <key>` | La chiave monouso che autentica tale collegamento |
| `-a, --agent <name>` | Configura gli agenti di coding IA: le [skill](/docs/ai/skills) e il [server MCP](/docs/ai/mcp). Ripetibile o separato da virgole — `claude`, `cursor`, `windsurf`, `gemini`, `codex`, `kiro`, `copilot` o `all`. Senza questo flag, `init` lo chiede e pre-seleziona gli agenti installati sulla macchina; con `--yes`, nessuno |

### `rebase dev`

Avvia il server di sviluppo:

```bash
rebase dev
```

Avvia sia il frontend che il backend con hot reloading, e rigenera lo schema Drizzle e i tipi dell'SDK (`generated/sdk/`) all'avvio e a ogni salvataggio all'interno di `backend/schema/`.

Entrambe le porte sono derivate dal percorso del progetto, consentendo l'esecuzione di più progetti Rebase
fianco a fianco. Usa gli URL stampati da `rebase dev`. Fissane una con `rebase dev --port 3001`.

Una modifica a `.env`
riavvia il backend, che rilegge il file, esattamente come fa il pannello di amministrazione. Ciò che
`rebase dev` imposta autonomamente viene mantenuto fino al riavvio: `PORT`, e
`DATABASE_URL` quando si trova sul database gestito o su Docker.

Con
`--database-url`, `rebase dev` verifica prima che ci sia una risposta su quell'host
e porta. Se non c'è risposta, lo segnala menzionando il flag ed esce con codice `1`
senza avviare nulla; lascia inoltre invariati i nomi del database in `.env`, senza mai avviare
il container compose associato.

### `rebase build`

Compila il progetto in un bundle distribuibile in `dist-bundle/`:

```bash
rebase build
```

Il bundle è l'artefatto che distribuisci — l'immagine runtime lo carica, quindi non c'è
alcuna immagine dell'applicazione da compilare autonomamente. Flag utili:

| Flag | Effetto |
|------|--------|
| `--output <dir>` (o `--out`) | Scrive il bundle in una posizione diversa da `dist-bundle/` (un'app alla volta) |
| `--vendor` | Installa e include sempre le dipendenze del bundle |
| `--no-vendor` | Non effettua mai il vendoring; il pod le installerà a ogni avvio |
| `--skip-type-check` | Salta il controllo dei tipi (più veloce, meno sicuro) |
| `--no-static` | Non include il frontend nel bundle del backend (ogni app statica riceve comunque il proprio bundle) |
| `--skip-static-build` | Include il frontend così come è già compilato, senza eseguire il relativo comando di build |

<span class="since-badge" data-since="0.31">Da 0.31</span> Un frontend — qualsiasi app statica di `rebase.json` con una configurazione Vite — la cui configurazione non utilizzi `rebaseBackendGuard()` (da
`@rebasepro/app/vitePlugin`) viene rifiutato: è ciò che impedisce al codice del server di finire nel
bundle del browser, e impedisce a Vite di incorporare inline un file del backend come URL `data:`
(fallisce la build, segnalandosi esplicitamente, quando un altro plugin sostituisce il suo
`build.assetsInlineLimit`). `frontend/src/cms/ui-config.json` viene trasferito nel bundle come
`entry.uiConfig`, la presentazione dell'area di lavoro servita da un backend distribuito.

Le dipendenze vengono incluse tramite vendoring per impostazione predefinita, in modo che una nuova istanza non debba attendere un'installazione
di 35–55 secondi. Un albero che supera i 2 GB su disco viene invece scartato, poiché
il limite di caricamento è di 1 GB compresso.

Ogni app statica inclusa
nel bundle riceve una copia brotli (`.br`) e una gzip (`.gz`) accanto a ogni
asset con hash del contenuto pari o superiore a 1 KB — i file che un browser memorizza nella cache per un anno.
Il runtime invia quella accettata dal browser, evitando così qualsiasi lavoro di compressione
per richiesta, inclusa la prima visita dopo un deploy, e
i browser che accettano brotli la ricevono (circa l'11% più piccola di gzip sul JavaScript
dell'admin). L'output di build del frontend originale rimane inalterato; cambia solo la copia
nel bundle. Sull'applicazione di esempio questo aggiunge meno di un secondo alla compilazione
e circa 2,4 MB al bundle.

### `rebase upgrade`

Aggiorna ogni pacchetto `@rebasepro/*` bloccato dal progetto a una specifica release, quindi
esegue l'installazione con il package manager specificato nel relativo file di lock. `rebase upgrade` seleziona la
versione più recente; `--to 0.21.0` una versione esatta, senza consultare il registry; `--to canary` un
dist-tag. Ogni versione bloccata in `dependencies`, `devDependencies` e
`optionalDependencies`, in ogni `package.json` del progetto, mantiene il suo prefisso `^`
o `~`, e nient'altro nel file viene modificato. Le specifiche di `peerDependencies` e
`workspace:`, `link:`, `file:`, git e tag vengono elencate e lasciate invariate.
Vengono aggiornati anche gli override in `pnpm-workspace.yaml` e `package.json`, ma un override `link:` o
`file:` ha la precedenza su ogni versione bloccata: viene segnalato e
`--drop-local-overrides` lo rimuove. `--dry-run` non scrive nulla, `--no-install`
salta l'installazione e `--json` restituisce un unico documento.

Un progetto su una
prerelease, come una versione canary, rimane sul suo canale a meno che `latest` non sia più recente. Un
dist-tag che sposterebbe una versione indietro viene rifiutato (`downgrade_refused` con
`--json`) a meno che non si passi `--allow-downgrade`; un valore `--to` esatto viene applicato e
segnalato come downgrade. Un `--dry-run` di un aggiornamento che l'esecuzione reale rifiuterebbe
mostra cosa verrebbe aggiornato ed esce con codice 0; con `--json` il documento riporta il
rifiuto come `wouldRefuse` (`{ code, message, hint }`).

### `rebase start`

Esegue il bundle compilato esattamente come lo eseguirebbe una distribuzione:

```bash
rebase start
```

Legge `PORT` e il resto di `.env`, a differenza di `rebase dev`, nel `NODE_ENV`
impostato. Un `.env` generato contiene `development`, quindi il primo account registrato
diventa comunque l'amministratore, e `rebase start` lo indica all'inizio; imposta `NODE_ENV=production`
per un server di produzione. `rebase start --bundle ./dist-bundle` esegue un bundle situato altrove.

`rebase start` non avvia alcun database e il `.env` generato non include
`DATABASE_URL`, quindi un'esecuzione locale sul database usato da `rebase dev` si effettua con
`DATABASE_URL="$(rebase db url)" rebase start`.
In assenza di questa variabile, stampa tale riga prima dell'avvio.

### `rebase apps list`

Mostra le app dichiarate da questo repository:

```bash
rebase apps list
```

Un repository può dichiarare più di un'app distribuibile — ad esempio un backend e un
sito di marketing. Questo comando permette di vedere su cosa agiranno `rebase build` e il deployment.

### `rebase eject`

Prendi il controllo del processo del server e della sua immagine:

```bash
rebase eject
```

Scrive l'entrypoint del backend e un `Dockerfile` all'interno del progetto e converte il suo
backend, in modo che il repository compili la propria immagine invece di eseguire il
runtime pubblicato. Da quel momento in poi **gli aggiornamenti del runtime della piattaforma non lo raggiungeranno più**,
e la configurazione di CORS, autenticazione, storage e arresto del sistema diventa interamente a tuo carico.

Visualizza un'anteprima con `rebase eject --dry-run`, che elenca le modifiche senza
applicare nulla. `--force` sovrascrive un `backend/src/index.ts` o
`env.ts` esistente, salvando il file corrente come `<name>.bak`.

Il server espulso (ejected)
mantiene gli upload locali nella directory `uploads/` del progetto, eseguito da sorgente o compilato, proprio come
fa `rebase dev`. Viene eseguito in `backend/`, quindi un `STORAGE_PATH` relativo lì presente viene
letto a partire da `backend/`.

### `rebase schema generate` / `rebase schema stale`

<span class="since-badge" data-since="0.31">Da 0.31</span>

```bash
rebase schema generate       # backend/schema → backend/src/schema.generated.ts
rebase schema stale          # segnala cosa differisce dalle tabelle, esce con 1 se ci sono discrepanze
rebase schema stale --fix    # rigenera invece il file
```

Ogni comando che legge lo schema accetta `--schema-dir <dir>` per un progetto
che lo conserva altrove; `--collections` è stato rimosso. `rebase dev` mantiene il
file aggiornato, quindi `stale` funge da controllo di verifica per una build o per la CI. Consulta
[Generazione dello schema](/docs/cli/schema/).

### `rebase db`

```bash
rebase db push                 # applica le tabelle al database (sviluppo)
rebase db generate             # genera un file di migrazione SQL
rebase db migrate              # applica le migrazioni in sospeso
rebase db url                  # stampa la stringa di connessione usata dal progetto
rebase db pull --from <url>    # copia un altro database in quello locale
rebase db backup               # pg_dump; include anche db backups list e db restore
rebase db branch create <name> # una copia su cui lavorare; include anche switch, list e prune
rebase db stop                 # arresta il database di sviluppo gestito
rebase db reset                # lo elimina e ricomincia da capo
rebase db request-role migrate --to <role> # sposta le richieste su un altro ruolo Postgres
rebase db provision --print    # l'SQL che configura il ruolo per le richieste, per un DBA
```

Ciascuno è illustrato in [Comandi del database](/docs/cli/database/), con l'ordine in cui un
comando sceglie il proprio database; `push`, `generate` e `migrate` sono trattati in
dettaglio in [Generazione dello schema](/docs/cli/schema/).

### `rebase console`

<span class="since-badge" data-since="0.31">Da 0.31</span>

Un REPL Node con i dati del progetto accessibili, o un singolo frammento eseguito con `-e`:

```bash
rebase console
rebase console -e "rebase.dataAsAdmin.posts.find({ limit: 5 })"
```

`rebase` (`dataAsAdmin`, `sql`, `withAuth(user)`) e `collections` (le
tabelle del progetto, caricate da `backend/schema`) sono nello scope, e l'`await` a livello
radice è supportato. Il database viene risolto nello stesso modo in cui lo risolve
`rebase db push`, e la sua apertura non apporta modifiche. Con `-e`, il risultato atteso
viene stampato come JSON su stdout e un'eventuale eccezione fa uscire il comando con codice `1`. Flag: `--eval`/`-e`,
`--schema-dir`, `--database-url`, `--docker`. Consulta
[Script e Console](/docs/backend/scripts/).

### `rebase migrate`

<span class="since-badge" data-since="0.31">Da 0.31</span>

Migrazioni unidirezionali da una struttura non più supportata in questa release:
`rebase migrate collections-to-tables` (`config/collections` → `backend/schema`
e `frontend/src/cms`) e `rebase migrate sdk-calls` (`data.collection("x")`
→ `data.table("x")` nel tuo codice). I relativi flag, ciò che scrivono e la
sezione "Verifica prima del deploy" sono disponibili in
[Generazione dello schema](/docs/cli/schema/#rebase-migrate).

### `rebase apps init` / `rebase apps config`

```bash
rebase apps list             # le app dichiarate da questo progetto
rebase apps init             # genera un rebase.json dedotto da questo progetto
rebase apps config <app>     # la configurazione client per una specifica app
```

`apps init` non accetta alcun nome: deduce tutte le app dal progetto e scrive
l'intero `rebase.json`, rifiutandosi di sovrascriverne uno esistente a meno che non si passi
`--force`.

Un argomento con il nome viene
rifiutato. `--force` mantiene ciò che l'inferenza non può dedurre dal file che va a sostituire:
il nome di ciascuna app, il suo `path` e la sua route `cms`. Tutto il resto viene dedotto
nuovamente, e un'app dichiarata non più presente viene segnalata come rimossa; pertanto, su uno
scaffold riscrive il `rebase.json` originariamente fornito. Il comando di compilazione dell'app
statica utilizza il package manager del progetto.

Per un
repository locale non collegato a un progetto Cloud, `apps config` segnala la mancata associazione,
indipendentemente dal fatto che `rebase dev` sia in esecuzione o meno, e fornisce l'URL del backend così
come servito da `rebase dev`.

### `rebase status`

Tutto ciò che questo progetto dichiara, e se l'ambiente lo associa effettivamente:

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

Tre file determinano ciò che un backend può raggiungere, e questo comando li visualizza insieme:
`rebase.json` specifica dove si trova il codice e chi esegue il server,
`backend/resources.ts` specifica di cosa ha bisogno il progetto, e l'ambiente indica come
raggiungere ciascun componente. Tutto il resto — `rebase.resources.json`, il manifest
del bundle — viene generato da quest'ultimo per i lettori che non possono eseguire il tuo
codice, e non devi mai scriverlo a mano.

Un simbolo `○` rappresenta lo stato che è opportuno verificare prima di un deploy piuttosto che dopo:
dichiarato, ma non configurato. Una `✗` indica che l'ambiente ha impostato qualcosa in modo *errato*,
il che impedisce l'avvio anziché funzionare in modalità ridotta.

Un
`rebase.resources.json` che non corrisponde più alle dichiarazioni riceve una riga `○`.
Un file che non è stato ancora scritto non la riceve: `rebase build` lo scrive a ogni
compilazione, quindi un progetto mai compilato prima, come un nuovo scaffold, non ha
nulla da correggere.

### `rebase resources`

Ciò di cui questo progetto dichiara di aver bisogno — i database, i bucket, i topic e
le code richiesti da `backend/resources.ts`, insieme ai cron e alle funzioni definiti dai suoi file:

```bash
rebase resources            # li elenca
rebase resources --write    # rigenera rebase.resources.json
rebase resources --check    # fallisce se il grafo nel repository è obsoleto
rebase resources --json     # leggibile da macchina
```

`rebase resources --check` è il flag che un job di CI utilizza per fallire in caso di un
`rebase.resources.json` non più allineato con `backend/resources.ts`.
`--json` può essere combinato
con esso: in caso di disallineamento, `rebase resources --check --json` esce con codice 1 restituendo un envelope
di errore (`resource_graph_missing` o `resource_graph_stale`), mentre in caso di successo
il grafo riporta `check.status`. `--write --json` scrive il file e riporta
`written.changed`.

Una risorsa viene dichiarata in `backend/resources.ts` — `database("analytics")`,
`bucket("media")`, `topic("signups")`, `queue("thumbnails")` — oppure corrisponde a un file
all'interno di `backend/crons` o `backend/functions`, e non va mai scritta manualmente in
`rebase.resources.json`, che viene invece generato da tali dichiarazioni per consentire a un host di
leggere le dipendenze di un progetto senza compilarlo. Ogni voce registra chi la utilizza
(`table:events`, `column:posts.cover`, `function:report`).

Un backend include inoltre un database predefinito e una sorgente di storage predefinita che nessuno
dichiara. Entrambi vengono elencati qui, contrassegnati come `implicit`, e nessuno dei due viene scritto in
`rebase.resources.json` — vengono forniti dall'host, quindi registrarli richiederebbe
il provisioning di risorse non esplicitamente volute.
Dichiararne una con
un nome specifico, ad esempio `bucket("media")`, lascia inalterata quella predefinita, ed entrambe vengono
elencate. Solo la dichiarazione esplicita della risorsa predefinita, o l'indicazione di un bucket con
`default: true`, la sostituisce.

Per visualizzare le risorse allocate dalla piattaforma per un progetto rispetto a quelle dichiarate dal codice,
e per rimuovere un database allocato che il codice non referenzia più, consulta
[`rebase cloud resources`](/docs/cli/cloud#resources).

`rebase cloud` — ogni comando relativo a Rebase Cloud: autenticazione, collegamento del progetto, deploy, configurazione, database, risorse, compute e altro — ha [la propria pagina dedicata](/docs/cli/cloud).

### `rebase generate-sdk`

<span class="since-badge" data-since="0.31">Da 0.31</span>

```bash
rebase generate-sdk
```

Genera un client tipizzato per le tabelle esportate da `backend/schema/index.ts` in
`generated/sdk/`, con `TableName` e `tablesDictionary`; `--from <link|url>`
legge invece il contratto di un backend in esecuzione. `--register` tipizza inoltre i
dati lato server: scrive i tipi e la dichiarazione `Register` in
`backend/generated/` memorizzandoli in `rebase.json` (`registerDatabase`).
Consulta [Dati server-side tipizzati](/docs/backend/typed-server-data) e
[Generazione dello schema](/docs/cli/schema/#rebase-generate-sdk).

### `rebase doctor`

```bash
rebase doctor
```

Il comando da eseguire quando qualcosa non funziona e non sai ancora cosa sia.
Esegue verifiche e segnalazioni senza modificare nulla, risultando sicuro su qualsiasi database
raggiungibile.

**Senza un database.** Questi controlli vengono eseguiti per primi, perché tutti i problemi che impediscono
il funzionamento globale di un progetto si verificano prima ancora di poter confrontare una tabella:

| Controllo | Motivo |
| --- | --- |
| Versione di Node | Confrontata con l'intervallo dichiarato dalla CLI. Una versione troppo vecchia non viene segnalata come "Node non supportato", bensì come errore di sintassi all'interno di una dipendenza. |
| Package manager | Presenza di due lockfile in uno stesso progetto. L'esecuzione di `npm install` in un workspace pnpm riscrive `node_modules` in una struttura incompatibile con pnpm, generando ore dopo l'errore `Cannot find module`. |
| Slug duplicati | Due tabelle che dichiarano lo stesso slug. Lo schema rifiuta la compilazione in questo caso, e il controllo le segnala entrambe. |
| Validità di `.env` | Un `JWT_SECRET` più corto di 32 caratteri (che l'ambiente di produzione rifiuta all'avvio), e `NODE_ENV=production` senza né `CORS_ORIGINS` né `FRONTEND_URL`. I valori effettivi non vengono mai stampati. |
| Disallineamento di versioni `@rebasepro/*` | Lo stesso pacchetto bloccato a versioni differenti nei vari file `package.json` del progetto. La presenza di due copie invalida `instanceof` tra di esse, provocando il fallimento di type guard che rigettano il proprio stesso tipo. |
| Stringhe di connessione | Un carattere `=` non codificato in un parametro dell'URL, che gli strumenti nativi di PostgreSQL rifiutano di analizzare — compromettendo backup e `psql` mentre l'applicazione continua apparentemente a funzionare. |
| Funzioni personalizzate | Requisiti di ciascuna funzione rispetto al proprio host, e quali di esse non potrebbero essere eseguite su un runtime edge. |

**Confronto con il database** — quello del progetto, risolto nello stesso modo in cui lo risolve
`rebase db url`; su un nuovo scaffold corrisponde al database gestito, che `doctor`
provvede ad avviare:

| Controllo | Motivo |
| --- | --- |
| Tabelle → schema generato | Verifica se `schema.generated.ts` è obsoleto. |
| Tabelle → database | Individua tabelle, colonne, enum, foreign key e tabelle ponte mancanti. |
| Estensioni richieste | Una colonna `col.vector()` richiede pgvector, che Rebase installa solo se esplicitamente dichiarato dal progetto. |
| Stamp dello schema | Verifica se il database è stato inizializzato a partire da queste tabelle. È un hash, quindi può indicare che i due elementi non concordano ma mai chi sia più avanti. Uno stamp `v1:` proveniente da un runtime precedente alla 0.31 viene segnalato una volta con il comando di riallineamento: `rebase db push`. |
| Tabelle → tipi SDK | Verifica se l'SDK tipizzato generato è obsoleto. |
| Policy RLS | Verifica se le policy del database corrispondono alla configurazione `rls` dichiarata, e se qualche policy menziona un ruolo che questo server non può utilizzare. |

Se il database non è raggiungibile, le relative fasi vengono segnalate come saltate con la
relativa motivazione e il resto dei controlli prosegue normalmente — consulta [Risoluzione dei problemi](/docs/troubleshooting/).

Esce con codice diverso da zero se un controllo rileva un errore, o se una fase non è potuta
partire perché il database fornito rifiuta le connessioni. Una fase saltata per l'impossibilità
di risolvere un database non costituisce un fallimento.

`rebase doctor --policies` esegue solo i controlli RLS — nessun diff dello schema, nessun controllo
dei tipi dell'SDK — e fallisce in modo restrittivo (fail-closed), risultando ideale come controllo di gate in CI
rispetto a un database in produzione.

`rebase doctor --database`
esegue unicamente i controlli preliminari del database: verifica se il ruolo con cui vengono eseguite le richieste autenticate
esiste, è limitato e può essere assunto, quali altri account possono assumerlo, se ogni ruolo ha i permessi
di connessione e quali tabelle, permessi e policy Rebase condividerebbe con altri ruoli. Ogni esito indica il codice SQL da eseguire come
amministratore, l'impostazione `rls` per adattare Rebase al database, oppure
entrambi. Legge il catalogo di sistema senza modificare nulla ed esce con codice 1 se viene riscontrato un fallimento. Funziona anche su progetti headless. Consulta
[Esecuzione su un database esistente o condiviso](/docs/deployment/existing-database/).

### `rebase verify`

```bash
rebase verify
rebase verify --json
rebase verify --live
rebase verify --live --database-url postgresql://…
```

<span class="since-badge" data-since="0.31">Da 0.31</span>

Verifica se le tabelle sono pronte per il rilascio, in un unico comando rapido pensato per la CI e per
gli hook degli agenti IA. È offline per impostazione predefinita e non modifica mai alcunché.

| Passaggio | Condizione di fallimento |
| --- | --- |
| Definizioni delle tabelle (`schema`) | `backend/schema` non si carica o non compila tramite il loader da cui si avvia il backend: una relazione verso una tabella non esportata dall'index, `rls: "inherit"` senza `defaultRls`, una tabella senza chiave primaria — una segnalazione per ciascun problema. L'assenza di `rls` su una tabella è uno di questi. |
| Copertura RLS (`rls`) | Una tabella con una colonna `user_id`, `owner_id`, `organization_id` o `tenant_id` le cui regole — proprie o ereditate tramite `defaultRls` — consentono a un ruolo di leggere ogni riga ignorando tale campo. Genera un avviso (warning). |
| Aggiornamento delle migrazioni (`migrations`) | Una tabella o colonna dichiarata nelle tabelle che nessun file in `backend/drizzle/migrations` crea, oppure una rimossa che una migrazione continua a creare. Viene saltato per progetti senza migrazioni. |
| Personalizzazioni CMS (`cms`) | Una chiamata `customizeTable(...)` in `frontend/src/cms` (o nel `src/cms` di un'app statica in `rebase.json`) non corrispondente alle tabelle, analizzata staticamente — i moduli non vengono eseguiti. `cms-unknown-table`: lo slug non corrisponde ad alcuna tabella, quindi il pannello la ignora (viene suggerito lo slug più simile). `cms-unknown-field`: una chiave in `fields` non è né una colonna né una relazione (il nome SQL di una colonna viene risposto con la sua chiave corrispondente). `cms-hidden-required`: un campo escluso dal form (`hiddenInForm`, `readOnly`, `disabled`) la cui colonna è `NOT NULL` senza valore predefinito e senza popolamento da parte del server, rendendo sempre fallimentare la creazione di un record dal pannello; genera un avviso se un hook `beforeSave` o una trasformazione potrebbe compilarlo, e viene silenziato da `filledByServer`. `cms-duplicate-customization`: uno stesso slug personalizzato due volte. `cms-not-static` (avviso): una chiamata i cui slug, opzioni o `fields` non sono valori letterali o `const` nello stesso file, impedendone la verifica. `cms-ui-config-not-mounted` (avviso): `frontend/src/cms/ui-config.json` esiste ma non viene passato come `uiConfig` a `<RebaseCMS>`. `cms-backend-guard-missing`: la configurazione Vite del frontend non include `rebaseBackendGuard()`, provocando il rifiuto da parte di `rebase build`. Un progetto headless non include `frontend/src/cms` e salta questo passaggio. |
| Audit RLS live (`live`) | Con `--live`: confronta il catalogo [`rls-check`](/docs/rls-check) con il database del progetto, e verifica che ogni migrazione sia stata applicata. Il database viene risolto allo stesso modo dei comandi `db` — `--database-url`, `DATABASE_URL`, `--docker`, altrimenti il database di sviluppo gestito. Un database non configurato o non raggiungibile genera un errore anziché essere ignorato: l'audit è stato richiesto esplicitamente. Una policy di lettura `USING (true)` generata da una regola `access: "public"` produce un avviso finché l'API richiede un token (`AUTH_REQUIRE`, attivo per impostazione predefinita) — ogni utente autenticato legge ogni riga — e un errore con `AUTH_REQUIRE=false`, in cui le righe risultano accessibili anonimamente. |

`--json` stampa un unico oggetto, `{ ok, schemaDir, steps, findings, summary }`:
ciascun passaggio è strutturato come `{ id, title, status, detail? }` (`status` può essere `passed`, `failed`,
`warnings` o `skipped`), e ogni segnalazione include `step`, `check` (un tipo kebab-case stabile),
`severity`, `message`, e ove applicabile `fix`, `table`,
`file`, `line` e il percorso puntato `path` all'interno della tabella (`posts.rls[0]`) — consentendo a un agente di
ripristinare l'errore commesso. `summary` calcola il totale di `errors` e `warnings`. `--quiet` non stampa nulla in caso di successo completo. Esce con codice diverso da zero
in caso di errore; i soli avvisi non ne causano il fallimento.

Un progetto generato tramite scaffold lo esegue automaticamente per Claude Code dopo ogni modifica in `backend/schema/`: consulta
[`rebase skills install`](#rebase-skills-install).

### `rebase auth`

Comandi di gestione dell'autenticazione:

```bash
rebase auth reset-password --email admin@example.com --password NewPassword123!
```

### `rebase api-keys`

Gestisci le chiavi API di servizio del progetto — le credenziali utilizzate da un agente, da uno script o
da un altro servizio, a differenza della sessione di un utente finale:

```bash
rebase api-keys list
rebase api-keys get abc123-def456
rebase api-keys create --name "Blog CI" --scopes data:read:posts,data:write:posts --expires-in 90
rebase api-keys create --name "Ops" --full-access --roles admin --expires-at 2027-01-31
rebase api-keys revoke abc123-def456
```

`--scopes` specifica le operazioni consentite alla chiave, separate da virgola o ripetute; `--full-access`
le assegna tutti gli scope associati alla chiave di servizio a eccezione di `keys:*`. `--roles` aggiunge ruoli
RLS accanto a `service`, `--expires-in` accetta un numero di giorni e `--expires-at` una data ISO.
`rebase api-keys scopes` elenca tutti gli scope riconosciuti dal backend. La chiave viene mostrata una sola volta.
Si applicano sia gli scope della chiave sia la row-level security dell'identità con cui opera.
Consulta [Chiavi API](/docs/backend/api-keys/).

### `rebase storage`

Manutenzione
globale dei file archiviati, tramite il backend in esecuzione utilizzando
la variabile `REBASE_SERVICE_KEY` definita in `.env`:

```bash
rebase storage orphans                         # file non referenziati da alcuna riga
rebase storage orphans --source media --delete # e li elimina, previa conferma
rebase storage move --from "(default)" --to media --prefix avatars
rebase storage move --from "(default)" --to media --prefix avatars --delete-source
```

`orphans` esamina ogni riga di ogni tabella così come memorizzata (comprese le righe
eliminate logicamente con soft-delete, ignorando qualsiasi hook `beforeQuery` e `afterRead`) e ogni
voce della [cronologia](/docs/backend/history/), poiché un ripristino ne recupera i contenuti.
Elenca i file di una determinata sorgente (`--source`, la sorgente predefinita se omessa)
non referenziati da alcuna stringa: una chiave, un URL o un
riferimento `rebase-storage:` all'interno di un testo. I file più recenti di `--older-than` ore (24 per impostazione predefinita) vengono esclusi,
poiché il pannello di amministrazione carica un file prima che la riga che lo referenzia sia effettivamente salvata.
La scansione viene eseguita in background sul backend, consentendo a un progetto troppo grande per essere scansionato
in una singola richiesta (dietro un ingress soggetto a timeout) di completare l'operazione. La
CLI avvia la scansione e ne visualizza l'avanzamento (file elencati, righe lette, tabelle
completate ed eventuali tabelle illeggibili) fino alla fine. Se la
[coda di job](/docs/backend/jobs/) è attiva, la scansione diventa un job `storage.orphans` eseguito
dai worker dei job. In caso contrario, la scansione viene eseguita all'interno del processo del server
a cui è stata richiesta, e la CLI lo notifica: il riavvio del processo interrompe la scansione. Una scansione
rappresenta un singolo tentativo di esecuzione, regolato da `jobs.timeoutMs` (15 minuti per impostazione predefinita). È possibile aumentarlo,
o impostarlo a 0, per sorgenti che richiedono tempi più lunghi. `--json` stampa il medesimo
report precedente, con l'aggiunta di `scanId`.

`--delete` richiede una conferma prima di eliminare (`--yes` salta la domanda ed è obbligatorio
in assenza di terminale). Elimina unicamente i file derivanti dalla scansione appena mostrata, ed esclusivamente entro
15 minuti dal completamento di tale scansione. Non viene eliminato nulla se una tabella
non può essere letta: una tabella con hook di lettura su un database il cui driver
non può oltrepassarli viene considerata non letta. Prima di procedere all'eliminazione, il server
rileggie ogni riga e voce di cronologia confrontandole con i file elencati. Successivamente verifica
singolarmente ogni file subito prima di rimuoverlo. Un file che risulta ora referenziato da una riga,
che è stato ricaricato dopo la scansione o che non esiste più viene preservato, e la CLI
lo elenca come mantenuto. I file referenziati esclusivamente da tabelle non servite da Rebase possono apparire
inutilizzati: controlla sempre prima di eliminarli. Rispetto a un backend versione 0.25.1 o precedente, la
CLI esegue la scansione secondo la modalità precedente, all'interno di un'unica richiesta.

`move` copia i file inclusi in `--prefix` verso un'altra sorgente mantenendo le stesse chiavi,
una pagina alla volta. Un file già presente nella destinazione con la stessa dimensione viene ignorato,
consentendo a un trasferimento interrotto di riprendere rieseguendo il comando; `--delete-source` rimuove ciascun
file dalla sorgente non appena è presente nella destinazione, e viene rifiutato se le due
sorgenti fanno riferimento allo stesso bucket o alla stessa directory. Una volta completato il trasferimento, la CLI
scansiona nuovamente la sorgente ed elenca ogni file non trasferito:
con `--delete-source`, qualsiasi file ancora presente nella sorgente; senza di esso, qualsiasi file di cui
la destinazione non possiede una copia di dimensione identica. Esce con codice 1 se ne rileva alcuno, e
rieseguendo lo stesso comando di spostamento verranno rielaborati. `--json` li riporta come `notMoved`. La lettura del report di una
scansione richiede `database:read`. L'avvio di una scansione, l'eliminazione e lo spostamento richiedono
`database:write`, permesso posseduto dalla chiave di servizio.

### `rebase skills install`

Installa le skill di riferimento di Rebase per i tuoi assistenti di programmazione IA — ciascuno degli agenti selezionabili con `--agent`:

```bash
rebase skills install
rebase skills install --agent claude,cursor
rebase skills install --agent all
rebase skills --hooks
```

Consulta [Skill degli Agenti](/docs/ai/skills) per l'elenco completo e i percorsi in cui vengono scritti i file.

`--hooks` installa il guardrail per Claude Code fornito da `rebase init` per ogni
progetto: `.claude/hooks/post-edit-collection.sh`, registrato come hook `PostToolUse`
in `.claude/settings.json`, che esegue `rebase verify --quiet` dopo ogni modifica
in `backend/schema/` o `frontend/src/cms/` rimandando eventuali problemi all'agente. Le impostazioni e gli hook
esistenti vengono preservati. `rebase skills --hooks` installa esclusivamente l'hook.

### `rebase telemetry`

Condivisione anonima dei dati di utilizzo, disattivata finché non viene esplicitamente accettata. La modalità interattiva di `rebase init`
lo richiede al termine dell'inizializzazione, con risposta predefinita "no", garantendo che nessun dato venga inviato senza
il tuo consenso esplicito. La risposta è memorizzata a livello di macchina (`~/.rebase/telemetry.json`): dopo un sì,
`init` non lo richiederà più, mentre dopo un no il comando `init` successivo lo chiederà nuovamente. A ogni
clone locale del progetto viene assegnato un identificativo casuale, salvato nel file
`.rebase/telemetry-project.json` ignorato da git.

```bash
rebase telemetry status
rebase telemetry show
rebase telemetry enable
rebase telemetry disable
```

`status` stampa l'impostazione corrente, `show` stampa esattamente ciò che verrebbe trasmesso —
indipendentemente dal fatto che la telemetria sia attiva o meno, consentendoti di esaminare il payload prima di decidere — e
gli altri due comandi ne modificano lo stato. Se non hai mai eseguito `init`, nessun dato è mai stato raccolto.

## Passaggi successivi

- **[Generazione dello schema](/docs/cli/schema/#production-workflow)** — Il flusso di lavoro delle migrazioni, dalla modifica di una tabella alla produzione
- **[Schema as Code](/docs/architecture/schema-as-code)** — Come funziona la generazione dello schema
- **[Guida rapida](/docs/getting-started/quickstart)** — Inizia subito
