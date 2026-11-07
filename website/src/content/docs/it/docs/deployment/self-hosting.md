---
sourceHash: dd7f515c841c860b
title: Self-Hosting
sidebar_label: Self-Hosting
description: "Esegui Rebase ovunque con l'immagine runtime ufficiale e il bundle del tuo progetto: Docker Compose, Fly, Railway o un semplice VPS."
---

## Panoramica

Il self-hosting di Rebase richiede l'esecuzione di due componenti: un database Postgres e l'immagine ufficiale `rebasepro/server` con il bundle del tuo progetto montato al suo interno.

Non c'è **alcuna immagine applicativa da compilare**. Il tuo progetto viaggia come un bundle, il runtime viene distribuito e l'aggiornamento di Rebase consiste nel cambiare un tag anziché ricompilare. Consulta [Runtime and bundles](/docs/architecture/runtime-and-bundles/) per comprendere il motivo di questa separazione.

## Docker Compose

**Se il tuo progetto è stato creato con `rebase init`, usa il suo file `docker-compose.yml`.**
Si trova nel tuo repository, `init` ha già inserito i suoi secret, il primo account amministratore e la versione del runtime bloccata (pinned), ed è il file descritto in
[Deployment](/docs/getting-started/deployment/#docker-compose-recommended):

```bash
rebase build
docker compose up -d
```

Il resto di questa pagina illustra lo stesso deployment senza un'impalcatura (scaffold) alle spalle: il progetto di qualcun altro, un bundle compilato in CI, o i due elementi deliberatamente omessi dal file generato: un connection pooler e le configurazioni a processi separati. Quel file si trova nel repository, all'indirizzo
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Usalo invece di copiare uno snippet da questa pagina: entrambi i file vengono testati dal gate di accettazione del progetto a ogni push, quindi nessuno dei due può divergere da ciò che funziona realmente.

I due file coincidono su ogni variabile d'ambiente tranne la password del database, e questo perché ciascuno è scritto per il proprio scrittore: questo legge `POSTGRES_PASSWORD`, generata da `quickstart.sh`; quello generato legge `DATABASE_PASSWORD`, che `rebase init` incorpora anche nella `DATABASE_URL` scritta nel tuo `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` è un singolo comando che fa due cose ovvie mostrandole a schermo. La forma estesa, se preferisci gestire ogni passaggio manualmente:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

Non è necessario avviare il database separatamente: `api` attende il suo healthcheck.

### I sei valori necessari

`quickstart.sh` genera questi valori per te. Per scrivere il file `.env` manualmente:

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

Tre secret, un dato di fatto e l'account con cui accedi:

- **`POSTGRES_PASSWORD`** — la password del database. Modificarla in seguito significa doverla cambiare anche nel volume, quindi sceglila una sola volta.
- **`JWT_SECRET`** — firma ogni sessione. Ruotarla disconnette tutti gli utenti.
- **`REBASE_SERVICE_KEY`** — la credenziale che scavalca la row-level security per le chiamate server-to-server. Trattala come una password di root: chiunque la possieda può leggere ogni riga.
- **`CORS_ORIGINS`** — le origini da cui viene servito il tuo frontend, separate da virgola. Non è un secret e non è facoltativo: il runtime rifiuta di avviarsi in produzione in sua assenza invece di tirare a indovinare, perché un'API che tenta di indovinare le origini consentite prima o poi autorizzerà quella sbagliata.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — il primo amministratore. Un database appena creato non ha utenti e, al di fuori della produzione, la policy di registrazione accetta la prima registrazione promuovendola ad admin — altrimenti un database vuoto sarebbe un vicolo cieco, poiché il bootstrap di un admin richiede un chiamante già autenticato. Nel momento in cui questo stack risponde su un hostname, quella comodità diventa una race condition che l'operatore può perdere; pertanto, in produzione la finestra viene chiusa e l'account viene specificato qui. Il runtime lo crea una sola volta, quando la tabella degli utenti è vuota, e non fa nulla a ogni avvio successivo.

`JWT_SECRET` e `REBASE_SERVICE_KEY` devono avere ciascuna una lunghezza minima di 32 caratteri, e la password dell'amministratore almeno 12. Usa un indirizzo email con un punto nel dominio: `POST /auth/login` valida il corpo con `z.string().email()`, quindi il runtime rifiuta di inizializzare `admin@localhost` — un account a cui nessuno potrebbe accedere — e registra invece il motivo nel log. Il file compose dichiara tutti e sei i parametri con
`${VAR:?…}`, quindi una variabile mancante arresta lo stack con un messaggio che ne indica il nome anziché avviare un sistema configurato a metà — e l'autoregistrazione viene disabilitata per impostazione predefinita (`DISABLE_SELF_REGISTRATION`, default `true`), quindi non rimane nulla di rivendicabile.

Accedi con queste credenziali e modifica la password: sono memorizzate in un file sull'host.

## Dipendenze

`rebase build` **installa le dipendenze del tuo progetto all'interno del bundle** per impostazione predefinita, quindi `dist-bundle` arriva con una cartella `node_modules` e un file `package-lock.json` accanto al suo `package.json`. Un bundle con le dipendenze incluse si avvia in circa cinque secondi.

Poiché sono già presenti, puoi montare il bundle in sola lettura — un'ottima pratica, dato che un hook compromesso non potrà poi riscrivere il codice che verrà eseguito al riavvio successivo:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` disattiva questa funzione e produce un bundle che installa le sue dipendenze solo al primo avvio, operazione che richiede 40–60 secondi a ogni avvio e richiede che il mount sia scrivibile.

Per un deployment effettivo in produzione, è preferibile incorporare entrambi in un'immagine, bloccando esattamente ciò che viene eseguito:

```dockerfile
FROM rebasepro/server:0.28.2
COPY dist-bundle /bundle
```

## Creazione dello schema

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle delle tue collection.**
Il valore predefinito di `REBASE_MIGRATE_ON_BOOT` è `ensure`, che è incrementale su tutto lo schema: crea tabelle, colonne e tipi enum mancanti, e applica la loro row-level security. Un primo avvio su un database vuoto si conclude servendo le tue collection, senza alcun passaggio separato.

Ciò che `ensure` deliberatamente non fa mai è modificare ciò che esiste già. Non altera il tipo di una colonna, non elimina una tabella o una colonna e non modifica i valori di un enum esistente — perché il riavvio di un container non deve poter alterare uno schema come effetto collaterale di un deploy.

Pertanto, vale comunque la pena eseguire `rebase db push` per ciò che l'avvio lascia invariato: qualsiasi modifica non puramente incrementale, come una colonna rinominata, un tipo di dato ristretto, un campo rimosso.

```bash
rebase db push
```

Eseguilo da un checkout locale o da un job di CI, puntando al database del deployment. Esegue prima una simulazione (dry-run) della modifica, rifiuta quelle distruttive senza esplicita conferma e può eseguire un backup prima di applicarle. Il database pubblica una porta nel file compose affinché questa operazione possa raggiungerlo dall'host; rimuovi questa mappatura una volta impostato lo schema se il database non deve essere raggiungibile dall'esterno.

`REBASE_MIGRATE_ON_BOOT` accetta solo `ensure` e `none`, e nient'altro — l'immagine **si rifiuta di avviarsi** se impostata su `push`, per il motivo sopra indicato.

## Quando solo il tuo processo di modifica può modificare il database

`REBASE_MIGRATE_ON_BOOT=none` non tocca le tue collection. Non lascia però intatto il database: le tabelle interne del framework (auth, chiavi API, job, cron) vengono comunque create e mantenute aggiornate a ogni avvio. Quando il database può essere modificato unicamente attraverso un processo di modifica revisionato, imposta `REBASE_PROVISION=false` su ogni processo che serve traffico:

| Impostazione | Tabelle e policy delle collection | Tabelle del framework |
|---|---|---|
| predefinito (`REBASE_MIGRATE_ON_BOOT=ensure`) | create e mantenute aggiornate all'avvio | create e mantenute aggiornate |
| `REBASE_MIGRATE_ON_BOOT=none` | non toccate | create e mantenute aggiornate |
| `REBASE_PROVISION=false` | non toccate | non toccate; gli elementi mancanti vengono segnalati nel log |

Con il provisioning disattivato, il runtime non crea né modifica nulla: nessuna tabella, colonna, indice, funzione, trigger, policy, ruolo o grant. Questo vale all'avvio e successivamente, comprese le tabelle che un processo attivo creerebbe altrimenti al primo utilizzo (chiavi di idempotenza, claim dei cron, contatori di rate limit condivisi). Si limita invece a leggere ciò che trova:

- **Tabelle di autenticazione o una colonna letta da auth mancanti:** l'avvio viene rifiutato e ciascuna viene elencata.
- **Il ruolo della richiesta può accedere a una tabella del framework** come `rebase.refresh_tokens` o `rebase.api_keys`: l'avvio viene rifiutato e viene stampato il comando `REVOKE` da eseguire. Un avvio con provisioning rimuove autonomamente tali privilegi. Con il provisioning disattivato, non lo fa nessuno.
- **Una tabella facoltativa mancante** (chiavi API, chiavi di idempotenza, claim dei cron, contatori di rate limit, presence, storico delle metriche): tale funzionalità rimane disattivata e il log indica quale tabella è necessaria.

Le righe continuano a cambiare, come accadrebbe in qualsiasi database: accessi, sessioni, utilizzo delle chiavi API, chiavi di idempotenza, claim dei cron. Il primo account amministratore (`REBASE_ADMIN_EMAIL`) viene inserito dall'esecuzione del provisioning, non dai processi di serving. La [modifica dello schema in tempo reale](/docs/backend/live-schema-editing) può comunque effettuare il commit di una modifica come sorgente, ma si rifiuta di applicarla al database.

### L'esecuzione del provisioning

Lo schema deriva da un'esecuzione controllata dal tuo processo di rilascio. Usa la stessa immagine e lo stesso bundle del server, con `REBASE_PROVISION_ONLY=true`, connesso come un ruolo che ha i permessi di creazione nel database. `REBASE_PROVISION_SQL_OUT` salva ogni modifica dello schema apportata dall'esecuzione sotto forma di script SQL:

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

L'immagine viene eseguita con `NODE_ENV=production`, pertanto questa esecuzione è soggetta agli stessi controlli di ambiente del server, inclusi `CORS_ORIGINS` o `FRONTEND_URL`, anche se non serve traffico.

Lo script è una registrazione, non un piano: ogni istruzione in esso contenuta è stata eseguita, in ordine, ed è andata a buon fine. Registrato su un database vuoto, rappresenta l'intero schema richiesto dalla release. Registrato su una copia ripristinata della produzione, rappresenta esattamente l'aggiornamento. Le righe scritte dall'esecuzione non sono incluse. Revisionalo, quindi applicalo al database reale:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f out/rebase.sql
```

Ripeti l'operazione per ogni aggiornamento di Rebase, prima di distribuire i processi che servono traffico. Una release può aggiungere una tabella o una colonna, e un processo a cui non è consentito crearne una ne segnalerà la mancanza invece di crearla.

Un server compilato autonomamente segue la stessa regola: `initializeRebaseBackend` legge `REBASE_PROVISION` e `createRebaseBackend` accetta [`provision: false`](/docs/backend/custom-server#what-creating-a-backend-may-change-provision).

## Storage dei file

Lo storage è **disattivato** a meno che non venga configurato un bucket, e questo è intenzionale: l'alternativa predefinita sarebbe il filesystem del container, che perderebbe silenziosamente ogni file caricato al riavvio successivo. I caricamenti vengono rifiutati con `501 STORAGE_NOT_CONFIGURED` finché non ne configuri uno.

Per un bucket, imposta `STORAGE_TYPE=s3` (o `gcs`) insieme al relativo bucket e alle credenziali — il file compose elenca le variabili, commentate. `gcs` carica `@google-cloud/storage`, che l'immagine ufficiale non include; pertanto, su quell'immagine accedi a Google Cloud Storage tramite il suo endpoint compatibile con S3 (`STORAGE_TYPE=s3`, `S3_ENDPOINT=https://storage.googleapis.com`, chiavi HMAC).

Per il disco locale, appropriato solo quando il percorso corrisponde a un volume reale che persiste oltre il ciclo di vita del container:

```yaml
      STORAGE_TYPE: local
      # Each declared bucket gets a directory beside this one, bucket("media")
      # /storage/uploads__media, so the volume goes on their parent.
      STORAGE_PATH: /storage/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - storage:/storage
```

`FORCE_LOCAL_STORAGE` non è facoltativo in questo caso: in produzione un backend `local` viene scartato anziché registrato, perché l'alternativa sarebbero upload che vanno a buon fine in un filesystem destinato a essere distrutto. Questa variabile serve a confermare che il mount è permanente.

Monta il volume **a monte** di `STORAGE_PATH`, non direttamente su di esso. `STORAGE_PATH` è la directory del bucket predefinito, e ogni bucket dichiarato in `config/resources.ts` ne ottiene una propria accanto ad essa, `<STORAGE_PATH>__<key>`. Un volume montato esattamente su `STORAGE_PATH` conterrà solo il bucket predefinito. Tutti gli altri bucket scriveranno sul filesystem del container e perderanno i propri file quando il container verrà ricreato. `STORAGE_PATH__MEDIA` può spostare un bucket altrove sul volume. Non può spostarlo all'interno della directory di un altro bucket, come `/storage/uploads/media`, poiché il bucket predefinito potrebbe elencarne, servirne ed eliminarne i file.

L'immagine crea `/storage` per l'utente non privilegiato `node` con cui viene eseguita, motivo per cui il volume va lì. Un volume montato dove l'immagine non dispone di una directory appartiene a root e ogni caricamento fallirà con `EACCES`. Il file compose scritto da `rebase init` lo monta in questo modo.

### Lo storage richiede un modello di controllo degli accessi

Una volta configurato un bucket, il runtime **rifiuta l'avvio in produzione** finché la distribuzione non specifica in che modo gli oggetti sono protetti. Lo storage non è coperto da row-level security e le sue chiavi condividono un unico namespace piatto; pertanto, senza una regola, l'unica cosa che separa i file di due utenti è l'imprevedibilità delle chiavi — che `GET /storage/list?prefix=` vanifica. Uno qualsiasi di questi elementi soddisfa il requisito:

- un **hook `storageAuthorize`** (o `storagePolicies`) nella configurazione del tuo progetto, che è la soluzione reale e ciò che lo scaffold include in `config/storage.ts` — nessuna variabile d'ambiente può esprimere "questo utente può leggere questa chiave";
- **`STORAGE_PUBLIC_READ=true`**, per un bucket che è a tutti gli effetti una CDN pubblica di sola lettura;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, per un'applicazione single-tenant in cui ogni account autenticato è autorizzato ad accedere a ogni file.

Al di fuori della produzione, la stessa condizione genera un avviso evidente anziché un blocco dell'avvio, quindi questo è un errore che si riscontra in fase di deploy e non durante lo sviluppo locale. È intenzionale: l'errore che sostituisce avverrebbe in modo silenzioso.

Imposta anche `MFA_ENCRYPTION_KEY` se usi TOTP. Se non viene impostata, i secret archiviati dell'authenticator vengono crittografati con `JWT_SECRET` — ruotare tale secret disconnetterebbe tutti gli utenti *e* renderebbe indecifrabili tutti i dispositivi registrati.

## Altre piattaforme

Il runtime è un normale container in ascolto su `$PORT`, quindi qualsiasi piattaforma in grado di eseguire container funziona. Due aspetti da impostare correttamente ovunque:

1. Il bundle deve essere presente in `/bundle` (o dove punta `REBASE_BUNDLE`), con le relative dipendenze installate al suo interno — vedi [Dipendenze](#dipendenze).
2. Imposta `CORS_ORIGINS`, `JWT_SECRET` e `DATABASE_URL`. Il runtime si rifiuta di avviarsi in produzione in loro assenza invece di tirare a indovinare.

### Fly.io

```toml
[build]
  dockerfile = "Dockerfile"   # FROM rebasepro/server:0.28.2 + COPY dist-bundle /bundle

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Usa il formato dell'immagine derivata sopra descritto in modo che il bundle venga distribuito con l'app, quindi esegui `fly deploy`.

### Railway / Render

Punta il servizio all'immagine derivata, imposta le variabili d'ambiente e configura il percorso dell'health check su `/livez`.

### Un semplice VPS

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` elenca le variabili lette. Sotto systemd — le due righe `REBASE_ADMIN_*` richiedono la versione 0.18 o successiva; nella versione 0.17.3 il primo account registrato diventa invece l'amministratore:

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

`NODE_ENV=production` non è decorativo. Se non impostata, il processo viene eseguito in modalità di sviluppo: riflette le origini localhost, serve le specifiche OpenAPI e **lascia aperta la finestra del primo admin** — quindi il primo sconosciuto che trova il form di registrazione diventa l'amministratore. Le due righe `REBASE_ADMIN_*` servono proprio a sostituire quella finestra; vedi [Il tuo primo admin](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` è presente perché il database si trova sulla stessa macchina. In produzione il runtime rifiuta qualsiasi variabile che punti a localhost — in un container, il loopback coincide con il container stesso, quindi tale indirizzo è sempre un errore — e questa riga gli segnala che l'indirizzo è intenzionale. Rimuovila se il database viene eseguito altrove.

Preferisci `EnvironmentFile=/etc/rebase.env` con permessi impostati su 0600 rispetto alle righe `Environment=` per i secret: un file unit è leggibile da chiunque e `systemctl show` mostra a schermo ogni valore di `Environment=`.

## Connection pooling

Il runtime mantiene un pool di connessioni ridotto e a lunga durata e non necessita di un pooler. Ciò che invece ne ha bisogno è qualsiasi altro servizio che comunica con lo stesso database e non può mantenere una connessione aperta: una funzione serverless, uno script pianificato, uno strumento di BI, un worker di code che scala fino a cinquanta istanze. Il parametro `max_connections` di Postgres è un limite rigido che si attesta intorno a poche centinaia e ogni connessione è un *processo*, quindi un fan-out di funzioni lambda lo esaurirebbe molto prima che il database sia effettivamente sotto carico.

Il file compose include un servizio `pgbouncer` per tale traffico, protetto da un profilo in modo che un deployment privo di tali chiamanti non esegua un processo superfluo:

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

L'autenticazione del client viene generata da `DATABASE_URL` all'avvio, evitando di scrivere la password due volte. Il pooler si autentica su Postgres con `scram-sha-256`, memorizzato da Postgres 18 — il valore predefinito `md5` dell'immagine farebbe fallire il login al *server* con `FATAL: server login failed: wrong password type`, che sembra un errore di password errata ma non lo è.

Mantieni la somma di `PGBOUNCER_POOL_SIZE` su tutti i pooler ampiamente al di sotto di `max_connections` del database: il runtime attinge dallo stesso budget.

### Cosa cambia con il transaction pooling

Un client gestito tramite pool occupa una connessione al server per la durata di una transazione per poi restituirla, ed è questo che permette a 500 client di condividere 20 connessioni. Tre funzionalità smettono di funzionare attraverso quella porta, e ciascuna di esse è utilizzata da Rebase stesso — motivo per cui il runtime si connette direttamente e questa porta è riservata agli altri chiamanti:

- **`LISTEN`/`NOTIFY`.** Il Realtime si basa su questo meccanismo, e un listener necessita di una connessione che persista oltre una singola transazione. `LISTEN` viene *accettato* dal pooler — risponde `LISTEN`, ma successivamente non arriverà alcuna notifica.
- **Stato della sessione**: `SET` (a differenza di `SET LOCAL`), lock consultivi (advisory locks) mantenuti tra istruzioni, cursori `WITH HOLD`, tabelle temporanee. La transazione successiva potrebbe finire su una connessione al server diversa, che non vedrà alcuno di questi elementi. Entrambe le situazioni falliscono nello stesso modo subdolo: con un solo client inattivo lo stato è spesso ancora presente, quindi funziona durante i test ma smette di funzionare sotto la concorrenza per cui hai introdotto il pooler.
- **Prepared statement a livello di protocollo.** Alla maggior parte dei driver si può indicare di non usarli — node-postgres non lo fa per impostazione predefinita; asyncpg necessita di `statement_cache_size=0`.

`SET LOCAL` ha visibilità limitata alla transazione e funziona correttamente, ed è ciò con cui viene impostata la row-level security — pertanto RLS si comporta in modo identico attraverso la porta del pooler.

Lascia disattivato il profilo se nessun servizio esterno al runtime si connette al tuo database. Una porta inutilizzata è una superficie di attacco.

## Health check

| Percorso | Utilizzo |
| --- | --- |
| `/livez` | Liveness. Risponde a "questo processo è attivo" senza toccare il database. |
| `/health` | Readiness. Esegue un round-trip verso il database e segnala la latenza. |

Punta i probe di liveness su `/livez`. Un probe di liveness su `/health` riavvierebbe un processo perfettamente integro durante una breve esitazione del database, che è l'esatto opposto del suo scopo.

## Metriche

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Espone metriche Prometheus su `/metrics`: conteggio delle richieste e istogrammi di latenza suddivisi per superficie API (dati, autenticazione, storage, funzioni) e per collection, oltre a gauge sui processi. Senza un token, l'endpoint è leggibile da chiunque possa raggiungere la porta, quindi impostane uno a meno che non ci si trovi su una rete privata.

`rebase_db_pool_wait_ms` è un istogramma di quanto a lungo ciascuna query ha atteso una connessione dal pool del database, inclusa l'apertura di una nuova connessione, etichettato per chiave della sorgente dati (`source="(default)"` in un progetto che non dichiara sorgenti dati). Un pool in salute mantiene questo valore vicino allo zero. Una coda che cresce con il traffico indica che le richieste si stanno accodando per ottenere connessioni — nella maggior parte dei casi trattenute da callback di scrittura che rimangono in attesa di operazioni lente; vedi [Un callback trattiene una connessione](/docs/collections/context-data-api/#a-callback-holds-a-connection).

Il database stesso, per sorgente dati:

| Metrica | Cosa dice |
|---------|-----------|
| `rebase_db_pool_total`, `_idle`, `_waiting` | Le connessioni di ciascun pool, etichettate `pool="primary"`, `"read"` (la replica) o `"session"` (il pool diretto della console SQL dietro un pooler). `waiting` sopra zero a lungo indica un pool troppo piccolo per il suo carico. |
| `rebase_db_connection_errors_total` | Richieste a cui si è risposto 503 per mancanza di una connessione, per `code`: `53300` / `53400` (il server ha esaurito le connessioni), `pool_exhausted`, `connect_timeout`, `unreachable`. |
| `rebase_db_connections` | Connessioni client sul server, per `state`, rispetto a `rebase_db_max_connections`. |
| `rebase_db_size_bytes` | La dimensione del database. |
| `rebase_db_replica_lag_seconds` | Quanto `DATABASE_READ_URL` è indietro rispetto al primario. |

Le ultime quattro vengono campionate ogni 30 secondi sulla connessione dell'istanza stessa, quindi uno scrape non diventa mai una query.

`rebase_realtime_*` segnala i socket e i canali aperti di ciascuna istanza e i frame inviati al channel bus o trattenuti: vedi [Vedere cosa fa il bus](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Header di sicurezza

Ogni risposta include `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` e `Strict-Transport-Security: max-age=15552000` (180 giorni). L'header HSTS tralascia `includeSubDomains`: ciò imporrebbe ai browser di rifiutare il protocollo HTTP semplice su ogni sottodominio del tuo dominio, compresi quelli con cui questo server non ha nulla a che fare, e un browser mantiene questa regola per l'intera durata indicata nell'header.
Imposta `REBASE_HSTS_INCLUDE_SUBDOMAINS=true` quando ogni sottodominio supporta solo HTTPS; fino alla versione 0.23 inclusa, l'header conteneva sempre `includeSubDomains`.

`strict-origin-when-cross-origin` è il valore predefinito dei browser: una richiesta a un altro sito trasmette la tua origine e mai il percorso o la query della pagina. Non è `no-referrer` perché i controlli sull'origine necessitano dell'origine stessa: il pulsante di accesso con Google la confronta con le origini JavaScript autorizzate del client OAuth, e con `no-referrer` restituiva "The given origin is not allowed for the given client ID" su ogni app, indipendentemente da cosa consentisse il client. Una risposta che imposta una propria policy la mantiene (la pagina di consenso MCP invia `no-referrer`); una pagina che necessita di una policy più restrittiva può specificarlo con `<meta name="referrer" content="no-referrer">`. `X-Frame-Options` funziona allo stesso modo: `SAMEORIGIN` a meno che la risposta non ne imposti uno proprio, come fa la pagina di consenso MCP con `DENY`.

Le applicazioni statiche — l'admin CMS e qualsiasi frontend servito dal bundle — includono anche `Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri 'self'`. Questa direttiva stabilisce chi può includere l'app in un frame, esclude i plugin e vincola `<base>` alla tua origine, senza limitare nient'altro, permettendo a script inline, worker e login di terze parti di continuare a funzionare. Una risposta che definisce una propria policy la mantiene. Per qualsiasi regola più restrittiva, applica la policy sul reverse proxy a monte.

## Più di un'istanza

Un solo container rappresenta la configurazione predefinita e non richiede altro. Prima che una seconda replica inizi a ricevere traffico — o che un deploy incrementale (rolling) ne esegua due affiancate — consulta [Eseguire più di un'istanza](/docs/deployment/multiple-instances/): rate limit, canali di broadcast, file locali, upload ripristinabili e la cache delle immagini sono gestiti per singolo processo a meno che un'impostazione non li condivida.

## Connettere Claude

Un solo comando aggiunge questo server al [connettore Rebase](/docs/ai/rebase-connector/), l'unico connettore MCP che consente a Claude di raggiungere tutti i tuoi progetti:

```bash
rebase cloud connect https://your-app.com
```

Imposta su questo server le due variabili restituite a terminale e riavvialo. Il server deve eseguire Rebase 0.28.1 o versione successiva e rispondere tramite HTTPS a un indirizzo pubblico. Non cambia nient'altro: non conserva alcun secret e concede al connettore gli stessi permessi concessi da Studio.

## Eseguire le funzioni in un processo dedicato

Tutto ciò che è descritto sopra riguarda un unico container che serve l'intero progetto, la struttura adatta per la quasi totalità dei deployment. Quando una custom function non deve più competere con la data API per l'event loop — o deve scalare, riavviarsi e fallire in modo isolato — la stessa immagine e lo stesso bundle possono essere avviati come diversi processi cooperanti. Consulta [Processi separati](/docs/deployment/split-processes/).

## Aggiornamento

```yaml
image: rebasepro/server:0.28.2
```

Riavvia. Il tuo bundle rimane invariato. All'interno della stessa major version del contratto di runtime, un bundle validato continuerà a funzionare — consulta [Compatibilità](/docs/architecture/runtime-and-bundles/#compatibility).
