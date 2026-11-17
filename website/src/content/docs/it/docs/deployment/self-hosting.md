---
sourceHash: 2450935032a5319f
title: Self-Hosting
sidebar_label: Self-Hosting
description: Esegui Rebase ovunque con l'immagine di runtime ufficiale e il bundle del tuo progetto — Docker Compose, Fly, Railway o una semplice VPS.
---

## Panoramica

Eseguire il self-hosting di Rebase significa avviare due componenti: un database Postgres e l'immagine ufficiale `rebasepro/server` con il bundle del tuo progetto montato al suo interno.

Non c'è **alcuna immagine dell'applicazione da compilare**. Il tuo progetto viaggia come bundle, il runtime è già pubblicato e l'aggiornamento di Rebase consiste semplicemente nel modificare un tag anziché ricompilare da zero. Consulta [Runtime e bundle](/docs/architecture/runtime-and-bundles/) per comprendere i motivi di questa suddivisione.

## Docker Compose

**Se il tuo progetto è stato creato con `rebase init`, usa il suo `docker-compose.yml`.**
Si trova nel tuo repository; `init` ne ha già compilato i secret, il primo account amministratore e la versione del runtime bloccata, ed è il file descritto in
[Deployment](/docs/getting-started/deployment/#docker-compose-recommended):

```bash
rebase build
docker compose up -d
```

Il resto di questa pagina descrive la stessa distribuzione ma senza uno scaffold di base: il progetto di qualcun altro, un bundle compilato in CI, o i due elementi che il file generato omette deliberatamente: un connection pooler e le configurazioni a processi separati. Questo file si trova nel repository, all'indirizzo
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Utilizza direttamente quello anziché copiare snippet da questa pagina: entrambi i file vengono testati dal gate di accettazione del progetto a ogni push, garantendo che nessuno dei due si discosti da ciò che funziona realmente.

I due file condividono tutte le variabili d'ambiente ad eccezione della password del database, e questo perché ciascuno è pensato per il rispettivo generatore: questo legge `POSTGRES_PASSWORD`, generata da `quickstart.sh`; quello generato legge `DATABASE_PASSWORD`, che `rebase init` include anche nella `DATABASE_URL` inserita nel tuo `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` è un unico comando che esegue due operazioni intuitive e le mostra a schermo. Ecco la procedura completa, se preferisci gestire ciascun passaggio:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

Non è necessario avviare il database separatamente: il servizio `api` attende il completamento del relativo healthcheck.

### I sei valori necessari

`quickstart.sh` genera questi valori automaticamente. Per scrivere manualmente il file `.env`:

```bash
cat > infra/docker/.env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 32)
REBASE_SERVICE_KEY=$(openssl rand -hex 32)
CORS_ORIGINS=https://app.example.com
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=$(openssl rand -hex 16)
EOF
```

Tre secret, un dato di fatto e l'account con cui effettuare l'accesso:

- **`POSTGRES_PASSWORD`** — la password del database. Modificarla in seguito richiede di aggiornarla anche nel volume, quindi sceglila una volta sola.
- **`JWT_SECRET`** — firma ogni sessione. Modificarlo disconnetterà tutti gli utenti.
- **`REBASE_SERVICE_KEY`** — la credenziale che bypassa la row-level security per le chiamate server-to-server. Trattala come una password di root: chiunque la possieda può leggere qualsiasi riga.
- **`CORS_ORIGINS`** — le origini da cui viene servito il frontend, separate da virgola. Non è un secret e non è opzionale: in produzione il runtime rifiuta l'avvio senza questa variabile anziché tirare a indovinare, poiché un'API che tenta di indovinare le origini consentite prima o poi autorizzerà quella sbagliata.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — il primo amministratore. Un database nuovo non ha utenti e, al di fuori della produzione, la policy di registrazione accetta la prima iscrizione promuovendola ad amministratore — altrimenti un database vuoto sarebbe un vicolo cieco, poiché l'inizializzazione di un admin richiede un chiamante già autenticato. Nel momento in cui questo stack risponde su un hostname, tale comodità diventa una race condition che l'operatore rischia di perdere; pertanto, in produzione questa finestra viene chiusa e l'account viene specificato qui. Il runtime lo crea una sola volta, quando la tabella degli utenti è vuota, e non compie alcuna azione a ogni avvio successivo.

`JWT_SECRET` e `REBASE_SERVICE_KEY` devono essere lunghi almeno 32 caratteri ciascuno, e la password di admin almeno 12. Utilizza un indirizzo con un punto nel dominio: `POST /auth/login` analizza il body con `z.string().email()`, quindi il runtime rifiuterà di inizializzare `admin@localhost` — un account con cui nessuno potrebbe accedere — e registrerà nei log il motivo. Il file compose dichiara tutti e sei i parametri con `${VAR:?…}`, di conseguenza un valore mancante bloccherà lo stack indicandolo chiaramente, invece di avviare un sistema parzialmente configurato — inoltre l'autoregistrazione è disabilitata di default (`DISABLE_SELF_REGISTRATION`, predefinito su `true`), per cui nessun account rimarrà reclamabile.

Accedi con queste credenziali e modifica la password: si trovano in chiaro in un file sull'host.

## Dipendenze

Per impostazione predefinita, `rebase build` **installa le dipendenze del progetto all'interno del bundle**, quindi `dist-bundle` include già `node_modules` e `package-lock.json` accanto a `package.json`. Un bundle "vendored" (con dipendenze incorporate) si avvia in circa cinque secondi.

Poiché sono già presenti, puoi montare il bundle in sola lettura — una procedura consigliata, poiché in questo modo un hook compromesso non potrà riscrivere il codice eseguito al riavvio successivo:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` disattiva questo comportamento e genera un bundle che installa le proprie dipendenze al primo avvio, operazione che richiede 40–60 secondi a ogni avvio e necessita che il mount sia scrivibile.

Per una distribuzione in produzione, è preferibile includere entrambi direttamente in un'immagine, bloccando esattamente ciò che viene eseguito:

```dockerfile
FROM rebasepro/server:0.33.2
COPY dist-bundle /bundle
```

## Creazione dello schema

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle dichiarate in `backend/schema`.**
Il valore predefinito di `REBASE_MIGRATE_ON_BOOT` è `ensure`, che opera in modalità additiva sull'intero schema: crea le tabelle, le colonne e i tipi enum mancanti, e applica la relativa row-level security. Il primo avvio su un database vuoto rende subito disponibili le tue tabelle, senza alcun passaggio separato.

Ciò che `ensure` deliberatamente non fa mai è modificare elementi già esistenti. Non altera il tipo di una colonna, non elimina tabelle o colonne e non modifica i valori di un enum esistente — perché il riavvio di un container non deve poter alterare uno schema come effetto collaterale di un deploy.

Pertanto vale comunque la pena eseguire `rebase db push` per ciò che l'avvio tralascia — ossia qualsiasi modifica non puramente additiva: una colonna rinominata, un tipo ristretto, un campo rimosso.

```bash
rebase db push
```

Eseguilo da una copia locale del repository o da un job di CI, puntando al database dell'ambiente di deploy. Esegue prima una simulazione (dry-run) della modifica, rifiuta le operazioni distruttive in assenza di conferma esplicita e può creare un backup prima di applicare le modifiche. Nel file compose il database espone una porta affinché questo comando possa raggiungerlo dall'host; rimuovi tale mappatura una volta impostato lo schema se il database non deve essere accessibile dall'esterno.

`REBASE_MIGRATE_ON_BOOT` accetta solo i valori `ensure` e `none` — l'immagine **rifiuta l'avvio** se impostata su `push`, per il motivo sopra descritto.

## Quando solo il tuo processo di change management può modificare il database

`REBASE_MIGRATE_ON_BOOT=none` non tocca le tabelle della tua applicazione. Non lascia però intatto l'intero database: le tabelle interne del framework (autenticazione, chiavi API, job, cron) vengono comunque create e mantenute aggiornate a ogni avvio. Quando il database può essere modificato esclusivamente tramite una procedura di change management approvata, imposta `REBASE_PROVISION=false` su ciascun processo che serve traffico:

| Impostazione | Tabelle e policy dichiarate | Tabelle del framework |
|---|---|---|
| predefinita (`REBASE_MIGRATE_ON_BOOT=ensure`) | create e mantenute aggiornate all'avvio | create e mantenute aggiornate |
| `REBASE_MIGRATE_ON_BOOT=none` | non modificate | create e mantenute aggiornate |
| `REBASE_PROVISION=false` | non modificate | non modificate; gli elementi mancanti vengono indicati nel log |

Con il provisioning disattivato, il runtime non crea né altera alcunché: nessuna tabella, colonna, indice, funzione, trigger, policy, ruolo o grant. Questo vale all'avvio e nelle fasi successive, incluse le tabelle che un processo attivo creerebbe altrimenti al primo utilizzo (chiavi di idempotenza, claim di cron, contatori condivisi di rate limiting). Al contrario, si limita a leggere ciò che trova:

- **Tabelle di autenticazione o colonne lette dall'autenticazione mancanti:** l'avvio viene rifiutato e ciascuna viene elencata.
- **Il ruolo delle richieste può accedere a una tabella del framework** come
  `rebase.refresh_tokens` o `rebase.api_keys`: l'avvio viene rifiutato e viene stampato il comando
  `REVOKE` da eseguire. Un avvio con provisioning attivo revoca questi privilegi in autonomia.
  Con il provisioning disattivato, non lo fa nessuno.
- **Una tabella opzionale mancante** (chiavi API, chiavi di idempotenza, claim di cron,
  contatori di rate limit, presence, storico delle metriche): la relativa funzionalità viene disabilitata e il
  log specifica la tabella necessaria.
- **Una tabella dichiarata che il database non protegge** — row-level security
  disabilitata, nessuna delle policy dichiarate presente o una policy restrittiva
  dichiarata mancante: la tabella non viene servita (una policy permissiva mancante
  viene servita, con un avviso all'avvio che la specifica). Una richiesta per essa risponde con `503 TABLE_WITHHELD` e il log di avvio
  indica l'SQL che la protegge (oppure `rebase db push`). Le altre tabelle vengono
  servite e l'avvio prosegue. Una tabella di giunzione many-to-many viene controllata allo stesso
  modo: se il database non ne protegge una, vengono trattenute le tabelle le cui relazioni
  la utilizzano, e `TABLE_WITHHELD` specificherà la giunzione. Anche una tabella la cui relazione `via`
  passa attraverso una tabella trattenuta verrà trattenuta a sua volta, e il messaggio indicherà la
  relazione. Questo vale anche con `REBASE_MIGRATE_ON_BOOT=none` e durante l'aggiornamento dello schema a caldo.
  Una tabella il cui accesso è gestito direttamente dall'applicazione può impostare `rlsRequired: false` per essere comunque servita ([come fare](/docs/deployment/existing-database/#another-tool-owns-the-schema-and-the-app-enforces-access)).

I dati (righe) continuano a cambiare, come in qualsiasi database: accessi, sessioni, utilizzo delle chiavi API, chiavi di idempotenza, claim di cron. Il primo account amministratore
(`REBASE_ADMIN_EMAIL`) viene inserito dall'esecuzione di provisioning, non dai processi che servono traffico. La [modifica dello schema live](/docs/backend/live-schema-editing) può comunque effettuare il commit delle modifiche come sorgente, ma rifiuterà di applicarle al database.

### L'esecuzione del provisioning

Lo schema deriva da un'esecuzione controllata dal tuo processo di change management. Utilizza la stessa immagine e lo stesso bundle del server, impostando `REBASE_PROVISION_ONLY=true` e connettendoti con un ruolo autorizzato a creare oggetti nel database. `REBASE_PROVISION_SQL_OUT` salva ogni modifica allo schema apportata dall'esecuzione sotto forma di script SQL:

```bash
docker run --rm \
  -e DATABASE_URL="postgres://admin:…@scratch-db:5432/app" \
  -e JWT_SECRET="…" \
  -e CORS_ORIGINS="https://app.example.com" \
  -e REBASE_PROVISION_ONLY=true \
  -e REBASE_PROVISION_SQL_OUT=/out/rebase.sql \
  -v "$PWD/out:/out" \
  -v "$PWD/dist-bundle:/bundle" \
  "rebasepro/server:$REBASE_VERSION"
```

L'immagine viene eseguita con `NODE_ENV=production`, quindi questa esecuzione è soggetta agli stessi controlli sull'ambiente del server, inclusi `CORS_ORIGINS` o `FRONTEND_URL`, anche se non serve traffico.

Lo script rappresenta uno storico effettivo, non un piano: ogni istruzione al suo interno è stata eseguita con successo, in sequenza. Se registrato su un database vuoto, corrisponde all'intero schema richiesto dalla release. Se registrato su una copia ripristinata della produzione, rappresenta l'aggiornamento esatto. I record inseriti durante l'esecuzione non sono inclusi nello script. Esaminalo, quindi applicalo al database reale:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f out/rebase.sql
```

Ripeti questa operazione a ogni aggiornamento di Rebase, prima del rollout dei processi che servono traffico. Una nuova release può aggiungere una tabella o una colonna, e un processo non autorizzato a crearle ne segnalerà l'assenza anziché crearle.

Anche un server creato autonomamente segue la stessa regola: `initializeRebaseBackend` legge
`REBASE_PROVISION`, e `createRebaseBackend` accetta
[`provision: false`](/docs/backend/custom-server#what-creating-a-backend-may-change-provision).

## Archiviazione file

Lo storage è **disattivato** a meno che non venga configurato un bucket, e ciò è intenzionale: l'alternativa predefinita sarebbe il filesystem del container, che perderebbe silenziosamente tutti i file caricati al riavvio successivo. I caricamenti vengono rifiutati con
`501 STORAGE_NOT_CONFIGURED` finché non ne viene configurato uno.

Per usare un bucket, imposta `STORAGE_TYPE=s3` (o `gcs`) specificando bucket e credenziali — il file compose elenca le variabili pertinenti, commentate. `gcs` carica `@google-cloud/storage`, pacchetto non incluso nell'immagine ufficiale; pertanto, con quell'immagine accedi a Google Cloud Storage tramite il suo endpoint compatibile con S3
(`STORAGE_TYPE=s3`, `S3_ENDPOINT=https://storage.googleapis.com`, chiavi HMAC).

Per l'uso del disco locale, appropriato solo quando il percorso corrisponde a un volume persistente che sopravvive al container:

```yaml
      STORAGE_TYPE: local
      # Each declared bucket gets a directory beside this one, bucket("media")
      # /storage/uploads__media, so the volume goes on their parent.
      STORAGE_PATH: /storage/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - storage:/storage
```

`FORCE_LOCAL_STORAGE` non è opzionale in questo scenario: in produzione un backend `local` viene rifiutato anziché registrato, poiché l'alternativa consisterebbe in upload completati su un filesystem destinato alla distruzione. Questa variabile serve a confermare esplicitamente che il mount è persistente.

Monta il volume **sopra** `STORAGE_PATH`, non esattamente su di esso. `STORAGE_PATH` è la directory del bucket predefinito, e ogni bucket dichiarato in `backend/resources.ts` ne ottiene una propria al suo fianco, `<STORAGE_PATH>__<key>`. Un volume montato esattamente su `STORAGE_PATH` conterrebbe solo il bucket predefinito. Tutti gli altri bucket scriverebbero sul filesystem del container, perdendo i file alla ricreazione dello stesso. `STORAGE_PATH__MEDIA` consente di spostare un bucket specifico altrove sul volume. Non può tuttavia spostarlo all'interno della directory di un altro bucket (come ad esempio `/storage/uploads/media`), poiché in tal caso il bucket predefinito finirebbe per elencare, servire ed eliminare i file di quest'ultimo.

L'immagine crea `/storage` per l'utente non privilegiato `node` con cui viene eseguita, motivo per cui il volume va montato lì. Un volume montato dove l'immagine non dispone di una directory appartiene a root, provocando l'errore `EACCES` a ogni caricamento. Il file compose generato da `rebase init` effettua il mount esattamente in questo modo.

### Lo storage richiede un modello di controllo degli accessi

Una volta configurato un bucket, il runtime **rifiuta l'avvio in produzione** finché la distribuzione non dichiara come sono protetti gli oggetti. Lo storage non rientra nella row-level security e le sue chiavi condividono un unico namespace piatto; senza regole, l'unica protezione tra i file di due utenti sarebbe l'imprevedibilità delle chiavi — vanificata da `GET /storage/list?prefix=`. Una qualunque delle seguenti opzioni soddisfa questo requisito:

- un **hook `storageAuthorize`** (o `storagePolicies`) nella configurazione del tuo progetto, che rappresenta la soluzione corretta ed è quanto fornito dallo scaffold in `backend/storage.ts` — nessuna variabile d'ambiente può esprimere "questo utente può leggere questa chiave";
- **`STORAGE_PUBLIC_READ=true`**, per un bucket che funge a tutti gli effetti da CDN pubblica di sola lettura;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, per un'applicazione single-tenant in cui qualsiasi account autenticato ha accesso a ogni file.

Al di fuori della produzione, la stessa condizione genera un avviso evidente anziché un blocco dell'avvio, quindi si tratta di un errore che incontrerai in fase di deploy e non sul tuo computer di sviluppo. È un comportamento intenzionale: il problema che previene si verificherebbe altrimenti in modo del tutto silenzioso.

Imposta anche `MFA_ENCRYPTION_KEY` se utilizzi TOTP. Se non impostata, i secret degli autenticatori memorizzati vengono cifrati con `JWT_SECRET` — di conseguenza, la rotazione di quest'ultimo non solo disconnetterà tutti gli utenti, *ma* renderà indecifrabili tutti i dispositivi registrati.

## Altre piattaforme

Il runtime è un container standard in ascolto su `$PORT`, quindi qualsiasi ambiente in grado di eseguire container è adatto. Due accorgimenti fondamentali validi ovunque:

1. Il bundle deve essere presente in `/bundle` (o nel percorso specificato da `REBASE_BUNDLE`), con le relative dipendenze installate al suo interno — vedi [Dipendenze](#dipendenze).
2. Imposta `CORS_ORIGINS`, `JWT_SECRET` e `DATABASE_URL`. In produzione il runtime rifiuterà l'avvio senza queste variabili anziché tirare a indovinare.

### Fly.io

```toml
[build]
  dockerfile = "Dockerfile"   # FROM rebasepro/server:0.33.2 + COPY dist-bundle /bundle

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Utilizza la modalità basata sull'immagine derivata descritta sopra per includere il bundle con l'app, quindi esegui `fly deploy`.

### Railway / Render

Punta il servizio all'immagine derivata, imposta le variabili d'ambiente e configura il percorso dell'health check su `/livez`.

### Una semplice VPS

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` elenca le variabili accettate. Con systemd:

```ini title="/etc/systemd/system/rebase.service"
[Service]
ExecStart=/usr/bin/rebase-server /srv/myapp/dist-bundle
Restart=always
Environment=NODE_ENV=production
Environment=DATABASE_URL=postgresql://rebase:...@127.0.0.1:5432/rebase
Environment=ALLOW_LOCALHOST_IN_PRODUCTION=true
Environment=JWT_SECRET=...
Environment=REBASE_SERVICE_KEY=...
Environment=CORS_ORIGINS=https://app.example.com
Environment=DISABLE_SELF_REGISTRATION=true
Environment=REBASE_ADMIN_EMAIL=you@example.com
Environment=REBASE_ADMIN_PASSWORD=...
```

`NODE_ENV=production` non è una formalità. Se omesso, il processo viene eseguito in modalità di sviluppo: accetta le origini localhost, espone la specifica OpenAPI e **lascia aperta la finestra per il primo amministratore** — in questo modo il primo sconosciuto che trova il modulo di registrazione diventa l'amministratore. Le due righe `REBASE_ADMIN_*` sostituiscono proprio tale meccanismo; consulta [Your first admin](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` è necessaria perché il database risiede sulla stessa macchina. In produzione il runtime rifiuta qualsiasi variabile che punti a localhost — in un container, il loopback coincide con il container stesso, rendendo tale indirizzo sempre errato — e questa riga specifica che l'indirizzo è intenzionale. Rimuovila quando il database viene eseguito altrove.

Per i secret, preferisci l'uso di `EnvironmentFile=/etc/rebase.env` con permessi 0600 rispetto alle direttive `Environment=`: un unit file è leggibile da chiunque sul sistema e `systemctl show` mostra in chiaro ogni valore specificato in `Environment=`.

## Connection pooling

Il runtime mantiene un pool di connessioni ridotto e persistente, e non necessita di un pooler. Ciò che invece ne ha bisogno è tutto il resto che interagisce con lo stesso database e non può mantenere una connessione aperta: una funzione serverless, uno script pianificato, un tool di BI, un worker di code che scala fino a cinquanta istanze. Il parametro `max_connections` di Postgres è un limite rigido che si attesta nell'ordine di poche centinaia e ogni connessione è un *processo*, quindi un fan-out di funzioni lambda può esaurirlo molto prima che il database sia effettivamente sotto carico.

Il file compose include un servizio `pgbouncer` per questo traffico, protetto da un profilo affinché un'infrastruttura priva di tali client non esegua un processo superfluo:

```bash
docker compose --profile pooler up -d
```

```
postgres://rebase:$POSTGRES_PASSWORD@your-host:6432/rebase
```

```bash
PGBOUNCER_PORT=6432           # host port
PGBOUNCER_MAX_CLIENT_CONN=500 # client connections accepted
PGBOUNCER_POOL_SIZE=20        # server connections used to serve them
```

L'autenticazione del client viene generata all'avvio a partire da `DATABASE_URL`, evitando di dover scrivere la password due volte. Il pooler si autentica su Postgres con `scram-sha-256`, supportato da Postgres 18 — l'impostazione predefinita `md5` dell'immagine fallisce il login lato *server* con `FATAL: server login failed: wrong password type`, un errore che sembra indicare una password errata ma non lo è.

Mantieni la somma di `PGBOUNCER_POOL_SIZE` su tutti i pooler ampiamente al di sotto del valore `max_connections` del database: anche il runtime attinge allo stesso limite.

### Cosa comporta il transaction pooling

Un client che usa il pooling mantiene una connessione al server solo per la durata di una transazione per poi rilasciarla; è questo meccanismo che consente a 500 client di condividere 20 connessioni. Tre funzionalità smettono di operare attraverso tale porta, ed ciascuna di esse è utilizzata da Rebase stesso — motivo per cui il runtime si connette direttamente e questa porta è riservata ad altri chiamanti:

- **`LISTEN`/`NOTIFY`.** Il realtime si basa su questo, e un listener richiede una
  connessione che persista oltre la transazione. `LISTEN` viene *accettato* dal
  pooler — risponde `LISTEN`, ma successivamente non perverrà mai alcuna notifica.
- **Stato della sessione**: `SET` (a differenza di `SET LOCAL`), advisory lock mantenuti
  tra istruzioni diverse, cursori `WITH HOLD`, tabelle temporanee. La transazione successiva
  potrebbe finire su una connessione server differente, che non vedrà alcuno di questi elementi. Entrambe
  le situazioni falliscono nello stesso modo poco trasparente: con un solo client inattivo lo stato è
  solitamente ancora presente, quindi il sistema funziona durante i test ma smette di funzionare sotto
  la concorrenza per cui il pooler era stato introdotto.
- **Prepared statement a livello di protocollo.** Molti driver possono essere configurati per non
  utilizzarli: node-postgres non li usa per impostazione predefinita; asyncpg richiede
  `statement_cache_size=0`.

`SET LOCAL` è limitato all'ambito della transazione e funziona correttamente, ed è ciò con cui viene impostata la row-level security — pertanto la RLS si comporta in modo identico attraverso la porta con pooling.

Lascia il profilo disattivato se nessun servizio esterno al runtime si connette al database. Una porta inutilizzata costituisce superficie di attacco superflua.

## Health checks

| Percorso | Scopo |
| --- | --- |
| `/livez` | Liveness. Risponde a "questo processo è vivo?" senza interrogare il database. |
| `/health` | Readiness. Esegue un round-trip sul database e riporta la latenza. |

Punta le verifiche di liveness su `/livez`. Un probe di liveness su `/health` riavvierebbe un processo del tutto integro durante un momentaneo rallentamento del database, ottenendo l'effetto opposto a quello desiderato.

## Metriche

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Espone le metriche Prometheus su `/metrics`: conteggio delle richieste e istogrammi di latenza suddivisi per superficie API (data, auth, storage, functions) e tabella, oltre a gauge relativi al processo. Senza un token l'endpoint è accessibile da chiunque possa raggiungere la porta, pertanto impostane uno a meno che non ti trovi su una rete privata.

`rebase_db_pool_wait_ms` è un istogramma che misura il tempo di attesa di ciascuna query per ottenere una connessione dal pool del database, inclusa l'eventuale apertura di una nuova connessione, con etichetta per chiave del data source (`source="(default)"` in un progetto privo di data source dichiarati). Un pool sano mantiene questo valore prossimo allo zero. Una coda che cresce con il traffico indica che le richieste sono in attesa di connessioni — nella maggior parte dei casi trattenute da hook di scrittura in attesa di operazioni lente; vedi
[A hook holds a connection](/docs/collections/context-data-api/#a-hook-holds-a-connection).

Il database stesso, per ciascun data source:

| Metrica | Significato |
|--------|--------------|
| `rebase_db_pool_connections`, `rebase_db_pool_idle`, `rebase_db_pool_waiting` | Connessioni di ciascun pool, etichettate con `pool="primary"`, `"read"` (la replica) o `"session"` (il pool diretto della console SQL dietro a un pooler). Un valore di `waiting` superiore a zero per un tempo prolungato indica un pool sottodimensionato rispetto al carico. |
| `rebase_db_connection_errors_total` | Richieste che hanno risposto con 503 per mancanza di una connessione, suddivise per `code`: `53300` / `53400` (il server ha esaurito le connessioni), `pool_exhausted`, `connect_timeout`, `unreachable`. |
| `rebase_db_connections` | Connessioni client sul server, suddivise per `state`, confrontate con `rebase_db_max_connections`. |
| `rebase_db_size_bytes` | Dimensioni del database. |
| `rebase_db_replica_lag_seconds` | Ritardo di `DATABASE_READ_URL` rispetto al primario. |

Le ultime quattro metriche vengono campionate ogni 30 secondi sulla connessione interna dell'istanza, così che lo scraping non si traduca mai in una query sul database.

`rebase_realtime_*` riporta i socket aperti, i canali e i frame inviati al channel bus o trattenuti da ciascuna istanza: vedi
[Seeing what the bus does](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Header di sicurezza

Ogni risposta include `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` e `Strict-Transport-Security: max-age=15552000` (180 giorni). L'header HSTS omette `includeSubDomains`: l'inclusione indicherebbe ai browser di rifiutare il traffico HTTP semplice su ogni sottodominio del tuo dominio, compresi quelli con cui questo server non ha alcuna relazione, e il browser manterrebbe questa regola per l'intera durata specificata dall'header.
Imposta `REBASE_HSTS_INCLUDE_SUBDOMAINS=true` se tutti i sottodomini supportano esclusivamente HTTPS.

`strict-origin-when-cross-origin` è l'impostazione predefinita dei browser stessi: una richiesta a un altro sito include la tua origine e mai il percorso o la query della pagina. Non viene usato `no-referrer` poiché i controlli sull'origine necessitano di tale valore — il pulsante di accesso con Google la confronta con le origini JavaScript autorizzate del client OAuth, e con `no-referrer` restituiva "The given origin is not allowed for the given client ID" su ogni applicazione, a prescindere da cosa autorizzasse il client. Una risposta che imposta una propria policy la preserva (la pagina di consenso MCP invia `no-referrer`); una pagina che necessita di una policy più restrittiva può specificarlo tramite `<meta name="referrer" content="no-referrer">`. `X-Frame-Options` funziona allo stesso modo: `SAMEORIGIN`, a meno che la risposta non ne imposti uno proprio, come accade per la pagina di consenso MCP con `DENY`.

Le applicazioni statiche — il pannello CMS di amministrazione e qualsiasi frontend servito dal bundle — includono inoltre `Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri 'self'`. Questa direttiva stabilisce chi può incorporare l'app in un frame, esclude i plugin e vincola `<base>` alla tua origine senza imporre ulteriori restrizioni, consentendo a script inline, worker e sistemi di accesso di terze parti di continuare a funzionare. Una risposta che imposta una propria policy la preserva. Per requisiti più restrittivi, applica la policy sul reverse proxy a monte.

### Consentire l'incorporamento di un'app in frame a un'altra origine

`frame-ancestors 'self'` significa che solo una pagina appartenente alla stessa origine dell'app può inserirla in un iframe. Un CMS su `admin.example.com` che mostra un'anteprima del sito su `www.example.com` richiede che il sito lo autorizzi, tramite la configurazione `frameAncestors` dell'app del sito in `rebase.json`:

```jsonc
"site": {
  "type": "static", "root": "site", "output": "site/dist", "path": "https://www.example.com",
  "frameAncestors": ["https://admin.example.com"]
}
```

Il sito viene quindi servito con `frame-ancestors 'self' https://admin.example.com`, così come qualsiasi [route](/docs/architecture/apps-and-repositories/#serving-a-function-at-a-path-on-an-app) del sito la cui funzione non invia una policy propria. Le altre applicazioni mantengono `'self'`. `X-Frame-Options: SAMEORIGIN` continua a essere inviato contestualmente; un browser che interpreta `frame-ancestors` ignora `X-Frame-Options`, come previsto dalle specifiche CSP.

Ciascuna voce rappresenta un'origine scritta esattamente: `https://` con un hostname e una porta opzionale, oppure `http://` per `localhost`, `127.0.0.1` e `[::1]` durante lo sviluppo. Non sono ammessi caratteri jolly (wildcard), percorsi né parole chiave — `'self'` è sempre presente nell'elenco e qualsiasi altro valore viene rifiutato dalla CLI e successivamente dal runtime prima di raggiungere l'header. Nulla è consentito a meno che non venga specificato esplicitamente.

## Più di un'istanza

Un singolo container rappresenta la configurazione predefinita e non richiede altro. Prima che una seconda replica inizi a ricevere traffico — o che un rolling deploy ne esegua due affiancate — consulta [Eseguire più di un'istanza](/docs/deployment/multiple-instances/): rate limit, broadcast channel, file locali, upload ripristinabili e cache delle immagini sono gestiti per singolo processo finché una configurazione specifica non li condivide.

## Connettere Claude

Un unico comando consente di aggiungere questo server al [Rebase connector](/docs/ai/rebase-connector/), l'unico connettore MCP per raggiungere tutti i tuoi progetti da Claude:

```bash
rebase cloud connect https://your-app.com
```

Imposta su questo server le due variabili restituite in output e riavvialo. Il server deve eseguire Rebase 0.28.1 o superiore e rispondere via HTTPS su un indirizzo pubblico. Non cambia nient'altro: non conserva alcun secret e concede al connettore gli stessi permessi concessi da Studio.

## Esecuzione delle funzioni in un processo dedicato

Tutto ciò che è stato descritto sopra prevede un unico container che serve l'intero progetto, la struttura ideale per quasi ogni deployment. Qualora una custom function dovesse smettere di competere con la Data API per l'event loop — o dovesse scalare, riavviarsi e fallire in modo isolato — la stessa immagine e lo stesso bundle possono essere avviati come processi distinti che cooperano tra loro. Consulta [Processi separati](/docs/deployment/split-processes/).

## Aggiornamento

```yaml
image: rebasepro/server:0.33.2
```

Riavvia. Il tuo bundle rimane invariato. All'interno della stessa major version del runtime contract, un bundle convalidato continuerà a funzionare — consulta [Compatibilità](/docs/architecture/runtime-and-bundles/#compatibility).
