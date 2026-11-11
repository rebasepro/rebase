---
sourceHash: c7cdcd8c45de8279
title: Self-Hosting
sidebar_label: Self-Hosting
description: Esegui Rebase ovunque con l'immagine di runtime ufficiale e il bundle del tuo progetto — Docker Compose, Fly, Railway o un semplice VPS.
---

## Panoramica

Eseguire Rebase in self-hosting significa eseguire due elementi: un database Postgres e l'immagine ufficiale `rebasepro/server` con il bundle del tuo progetto montato al suo interno.

Non c'è **alcuna immagine applicativa da compilare**. Il tuo progetto viaggia come bundle, il runtime è pubblicato e l'aggiornamento di Rebase consiste nella modifica di un tag anziché in una ricompilazione. Consulta [Runtime and bundles](/docs/architecture/runtime-and-bundles/) per scoprire i motivi di questa suddivisione.

## Docker Compose

**Se il tuo progetto proviene da `rebase init`, usa il suo `docker-compose.yml`.**
Si trova nel tuo repository; `init` ha già inserito i relativi segreti, il suo primo account amministratore e la versione del runtime bloccata, ed è il file descritto in
[Deployment](/docs/getting-started/deployment/#docker-compose-recommended):

```bash
rebase build
docker compose up -d
```

Il resto di questa pagina descrive lo stesso deployment senza uno scaffold alle spalle — il progetto di qualcun altro, un bundle compilato in CI, o i due elementi che il file generato omette deliberatamente: un connection pooler e le configurazioni a processi separati. Quel file risiede nel repository, in
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Usa quello anziché copiare uno snippet da questa pagina: entrambi i file vengono avviati dal gate di accettazione del progetto a ogni push, quindi nessuno dei due può divergere da ciò che funziona realmente.

I due concordano su ogni variabile d'ambiente tranne la password del database, e questo perché ciascuno è scritto per il proprio generatore: questo legge `POSTGRES_PASSWORD`, generata da `quickstart.sh`; quello generato legge `DATABASE_PASSWORD`, che `rebase init` inserisce anche nella `DATABASE_URL` scritta nel tuo `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` è un singolo comando che compie due operazioni evidenti e le stampa a video entrambe. La procedura estesa, se preferisci gestire ogni passaggio manualmente:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

Non è necessario avviare il database separatamente — `api` attende il completamento del suo healthcheck.

### I sei valori necessari

`quickstart.sh` li genera per te. Per compilare il file `.env` manualmente:

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

Tre segreti, un dato di fatto e l'account con cui accedi:

- **`POSTGRES_PASSWORD`** — la password del database. Modificarla in seguito richiede di aggiornarla anche nel volume, quindi sceglila una sola volta.
- **`JWT_SECRET`** — firma ogni sessione. La rotazione di questa chiave disconnette tutti gli utenti.
- **`REBASE_SERVICE_KEY`** — la credenziale che bypassa la row-level security per le chiamate server-to-server. Trattala come una password di root: chiunque ne sia in possesso può leggere ogni riga.
- **`CORS_ORIGINS`** — le origini da cui viene servito il tuo frontend, separate da virgola. Non è un segreto e non è opzionale: in produzione il runtime si rifiuta di avviarsi senza di essa anziché tirare a indovinare, poiché un'API che prova a indovinare le origini consentite prima o poi autorizzerà quella sbagliata.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — il primo amministratore. Un database vuoto non ha utenti, e al di fuori della produzione la policy di registrazione accetta la prima registrazione promuovendola ad amministratore — altrimenti un database vuoto sarebbe un vicolo cieco, poiché il bootstrap di un admin richiede un chiamante già autenticato. Nel momento in cui questo stack risponde su un hostname, tale comodità diventa una race condition che l'operatore può perdere; pertanto, in produzione questa finestra viene chiusa e l'account viene dichiarato qui. Il runtime lo crea una sola volta, quando la tabella utenti è vuota, e non fa nulla a ogni avvio successivo.

`JWT_SECRET` e `REBASE_SERVICE_KEY` devono contenere ciascuno almeno 32 caratteri, e la password dell'amministratore almeno 12. Utilizza un indirizzo contenente un punto nel dominio: `POST /auth/login` valida il body con `z.string().email()`, quindi il runtime si rifiuta di fare il seeding di `admin@localhost` — un account con cui nessuno potrebbe accedere — registrando invece il motivo nel log. Il file compose dichiara tutti e sei i parametri con `${VAR:?…}`, di conseguenza un valore mancante arresta lo stack con un messaggio che ne indica il nome anziché avviare un sistema configurato a metà — e l'auto-registrazione è disattivata di default (`DISABLE_SELF_REGISTRATION`, predefinito `true`), per cui non resta nulla da reclamare.

Accedi con queste credenziali e modifica la password: sono memorizzate in chiaro in un file sull'host.

## Dipendenze

`rebase build` **installa le dipendenze del progetto direttamente nel bundle** per impostazione predefinita, quindi `dist-bundle` include `node_modules` e `package-lock.json` accanto al suo `package.json`. Un bundle con dipendenze incluse si avvia in circa cinque secondi.

Poiché sono già presenti, puoi montare il bundle in sola lettura — una scelta consigliata, dato che un hook compromesso non potrà riscrivere il codice che verrà eseguito al riavvio successivo:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` disattiva questo comportamento e genera un bundle che installa le proprie dipendenze al primo avvio, operazione che richiede 40–60 secondi a ogni avvio e necessita di un punto di montaggio scrivibile.

Per un deployment di produzione effettivo, è preferibile incorporare entrambi in un'immagine, bloccando in modo esatto ciò che viene eseguito:

```dockerfile
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

## Creazione dello schema

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle delle tue collection.**
`REBASE_MIGRATE_ON_BOOT` è impostato di default su `ensure`, che opera in modalità additiva sull'intero schema: crea le tabelle, le colonne e i tipi enum mancanti, e applica la loro row-level security. Un primo avvio su un database vuoto rende subito disponibili le tue collection, senza passaggi separati.

Ciò che `ensure` deliberatamente non fa mai è modificare elementi già esistenti. Non altera il tipo di una colonna, non elimina tabelle o colonne e non modifica i valori di un enum esistente — poiché il riavvio di un container non deve poter alterare uno schema come effetto collaterale di un deploy.

Pertanto, è comunque opportuno eseguire `rebase db push` per ciò che l'avvio tralascia — ovvero qualsiasi modifica che non sia puramente additiva: una colonna rinominata, un tipo reso più restrittivo, un campo rimosso.

```bash
rebase db push
```

Esegui il comando da un checkout locale o da un job di CI, puntando al database dell'ambiente di deploy. Il comando esegue prima una simulazione (dry-run), rifiuta le modifiche distruttive in assenza di conferma esplicita e può creare un backup prima dell'applicazione. Il database espone una porta nel file compose per consentire questo accesso dall'host; rimuovi questa mappatura una volta impostato lo schema se il database non deve essere raggiungibile dall'esterno.

`REBASE_MIGRATE_ON_BOOT` accetta esclusivamente i valori `ensure` e `none` — l'immagine **si rifiuta di avviarsi** su `push`, per il motivo sopra indicato.

## Quando solo il tuo processo di change management può modificare il database

`REBASE_MIGRATE_ON_BOOT=none` lascia intatte le tue collection. Non lascia intatto il database: le tabelle interne del framework (auth, chiavi API, job, cron) vengono comunque create e mantenute aggiornate a ogni avvio. Quando il database può essere modificato unicamente tramite una procedura di change management approvata, imposta `REBASE_PROVISION=false` su ogni processo che serve traffico:

| Impostazione | Tabelle delle collection e policy | Tabelle del framework |
|---|---|---|
| predefinito (`REBASE_MIGRATE_ON_BOOT=ensure`) | create e mantenute aggiornate all'avvio | create e mantenute aggiornate |
| `REBASE_MIGRATE_ON_BOOT=none` | lasciate intatte | create e mantenute aggiornate |
| `REBASE_PROVISION=false` | lasciate intatte | lasciate intatte; gli elementi mancanti vengono segnalati nel log |

Con il provisioning disattivato, il runtime non crea e non altera nulla: nessuna tabella, colonna, indice, funzione, trigger, policy, ruolo o grant. Questo vale all'avvio e nelle fasi successive, incluse le tabelle che un processo in esecuzione creerebbe al primo utilizzo (idempotency key, lock per cron, contatori condivisi di rate limiting). Si limita invece a verificare quanto presente:

- **Tabelle di autenticazione, o una colonna letta dall'auth, mancanti:** l'avvio si blocca elencando ciascun elemento mancante.
- **Il ruolo della richiesta può accedere a una tabella del framework** come `rebase.refresh_tokens` o `rebase.api_keys`: l'avvio si blocca stampando il comando `REVOKE` da eseguire. Un avvio con provisioning rimuove questi privilegi in autonomia; con il provisioning disattivato, nessun processo interviene.
- **Una tabella opzionale mancante** (chiavi API, idempotency key, lock per cron, contatori di rate limit, presence, storico metriche): la funzionalità corrispondente viene disabilitata e il log indica quale tabella è necessaria.

I dati continuano a essere aggiornati, come in qualunque database: login, sessioni, utilizzo delle chiavi API, idempotency key, lock per cron. Il seeding del primo account admin (`REBASE_ADMIN_EMAIL`) viene eseguito dall'esecuzione di provisioning, non dai processi di servizio. La [modifica dello schema in tempo reale](/docs/backend/live-schema-editing) può comunque effettuare il commit delle modifiche come sorgente, ma si rifiuterà di applicarle al database.

### L'esecuzione di provisioning

Lo schema viene definito mediante un'esecuzione controllata dal tuo processo di change management. Usa la stessa immagine e lo stesso bundle del server, con `REBASE_PROVISION_ONLY=true`, effettuando la connessione con un ruolo che dispone dei permessi di creazione nel database. `REBASE_PROVISION_SQL_OUT` salva ogni modifica allo schema apportata dall'esecuzione sotto forma di script SQL:

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

L'immagine viene eseguita con `NODE_ENV=production`, pertanto questa esecuzione è soggetta agli stessi controlli d'ambiente del server, inclusi `CORS_ORIGINS` o `FRONTEND_URL`, sebbene non serva alcun traffico.

Lo script generato è un resoconto, non un piano: ogni istruzione in esso contenuta è stata eseguita, in ordine e con esito positivo. Registrato su un database vuoto, costituisce l'intero schema richiesto dalla release. Registrato su una copia ripristinata della produzione, rappresenta esattamente l'aggiornamento da applicare. Le righe create durante l'esecuzione non sono incluse. Esaminalo, quindi applicalo al database effettivo:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f out/rebase.sql
```

Ripeti l'operazione per ogni aggiornamento di Rebase, prima di eseguire il rollout dei processi applicativi. Una release può introdurre una nuova tabella o colonna, e un processo privo dei permessi di creazione segnalerà l'elemento mancante anziché crearlo.

Un server personalizzato segue la medesima logica: `initializeRebaseBackend` legge `REBASE_PROVISION`, e `createRebaseBackend` accetta [`provision: false`](/docs/backend/custom-server#what-creating-a-backend-may-change-provision).

## Archiviazione file

L'archiviazione è **disattivata** a meno che non venga configurato un bucket, e ciò è intenzionale: l'alternativa predefinita sarebbe il filesystem del container, che perderebbe silenziosamente ogni file caricato al riavvio successivo. I caricamenti vengono rifiutati con l'errore `501 STORAGE_NOT_CONFIGURED` finché non ne viene configurato uno.

Per un bucket, imposta `STORAGE_TYPE=s3` (o `gcs`) specificando il bucket e le relative credenziali — il file compose elenca le variabili, commentate. `gcs` richiede `@google-cloud/storage`, che non è incluso nell'immagine ufficiale; su tale immagine, connettiti a Google Cloud Storage tramite il suo endpoint compatibile con S3 (`STORAGE_TYPE=s3`, `S3_ENDPOINT=https://storage.googleapis.com`, chiavi HMAC).

Per il disco locale, indicato esclusivamente quando il percorso corrisponde a un volume reale persistente rispetto al ciclo di vita del container:

```yaml
      STORAGE_TYPE: local
      # Each declared bucket gets a directory beside this one, bucket("media")
      # /storage/uploads__media, so the volume goes on their parent.
      STORAGE_PATH: /storage/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - storage:/storage
```

`FORCE_LOCAL_STORAGE` non è facoltativo in questo caso: in produzione un backend `local` viene scartato anziché registrato, poiché l'alternativa comporterebbe upload completati con successo su un filesystem destinato a essere distrutto. Questa variabile serve a confermare esplicitamente che il punto di montaggio è persistente.

Monta il volume nel percorso **superiore** a `STORAGE_PATH`, non direttamente su di esso. `STORAGE_PATH` è la directory del bucket predefinito, e ogni bucket dichiarato in `config/resources.ts` ne ottiene una propria accanto ad esso, `<STORAGE_PATH>__<key>`. Un volume montato esattamente su `STORAGE_PATH` ospiterà solo il bucket predefinito. Ogni altro bucket scriverà sul filesystem del container, perdendo i file alla sua ricreazione. `STORAGE_PATH__MEDIA` consente di spostare un bucket altrove all'interno del volume. Non può tuttavia spostarlo all'interno della directory di un altro bucket (come `/storage/uploads/media`), poiché il bucket predefinito ne elencherebbe, servirebbe ed eliminerebbe i file.

L'immagine crea `/storage` per l'utente non privilegiato `node` con cui viene eseguita, motivo per cui il volume va posizionato lì. Un volume montato dove l'immagine non dispone di una directory apparterrà a root, causando il fallimento di ogni upload con `EACCES`. Il file compose generato da `rebase init` lo monta in questo modo.

### Lo storage richiede un modello di controllo degli accessi

Una volta configurato un bucket, il runtime **rifiuta l'avvio in produzione** finché nel deployment non viene dichiarato come proteggere gli oggetti. Lo storage non è gestito dalla row-level security e le sue chiavi condividono un unico namespace piatto; pertanto, in assenza di regole, l'unico elemento a separare i file di due utenti diversi è l'imprevedibilità delle chiavi — barriera vanificata da `GET /storage/list?prefix=`. Una qualsiasi delle seguenti opzioni soddisfa questo requisito:

- un **hook `storageAuthorize`** (o `storagePolicies`) nella configurazione del progetto, che rappresenta la soluzione corretta ed è quanto fornito dallo scaffold in `config/storage.ts` — nessuna variabile d'ambiente può esprimere il concetto "questo utente può leggere questa chiave";
- **`STORAGE_PUBLIC_READ=true`**, per un bucket che funge a tutti gli effetti da CDN pubblico in sola lettura;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, per un'applicazione single-tenant in cui ogni account autenticato è autorizzato ad accedere a qualunque file.

Al di fuori dell'ambiente di produzione, la medesima condizione genera un avviso evidente anziché un blocco dell'avvio; si tratta quindi di un errore che si riscontra in fase di deploy e non durante lo sviluppo locale. Questo comportamento è deliberato: il problema che previene si verificherebbe altrimenti in modo silenzioso.

Imposta anche `MFA_ENCRYPTION_KEY` se utilizzi TOTP. Se omessa, i segreti degli autenticatori salvati vengono cifrati con `JWT_SECRET` — pertanto la rotazione di quest'ultima disconnetterebbe tutti gli utenti *e* renderebbe indecifrabili tutti i dispositivi registrati.

## Altre piattaforme

Il runtime è un normale container in ascolto su `$PORT`, quindi qualsiasi piattaforma in grado di eseguire container è compatibile. Due aspetti fondamentali da verificare ovunque:

1. Il bundle deve essere presente in `/bundle` (o nel percorso indicato da `REBASE_BUNDLE`), con le relative dipendenze installate al suo interno — vedi [Dipendenze](#dipendenze).
2. Imposta `CORS_ORIGINS`, `JWT_SECRET` e `DATABASE_URL`. In produzione il runtime si rifiuta di avviarsi senza queste variabili anziché procedere a tentativi.

### Fly.io

```toml
[build]
  dockerfile = "Dockerfile"   # FROM rebasepro/server:0.30.1 + COPY dist-bundle /bundle

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Usa la configurazione con immagine derivata mostrata sopra affinché il bundle venga distribuito insieme all'app, quindi esegui `fly deploy`.

### Railway / Render

Punta il servizio all'immagine derivata, imposta le variabili d'ambiente e configura il path dell'health check su `/livez`.

### Un semplice VPS

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

Il comando `rebase-server --help` elenca le variabili supportate. Sotto systemd:

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

`NODE_ENV=production` non è facoltativo. Se omesso, il processo viene eseguito in modalità di sviluppo: accetta origini localhost, serve la specifica OpenAPI e **lascia aperta la finestra di registrazione del primo amministratore** — per cui il primo sconosciuto che raggiunge il form di registrazione diventa l'amministratore. Le due righe `REBASE_ADMIN_*` sostituiscono tale meccanismo; consulta [Your first admin](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` è necessario poiché il database si trova sulla stessa macchina. In produzione il runtime rifiuta qualsiasi variabile che punti a localhost — all'interno di un container, l'indirizzo di loopback coincide con il container stesso, risultando sempre un errore — e questa riga conferma che l'indirizzo è intenzionale. Rimuovila se il database risiede altrove.

È preferibile utilizzare `EnvironmentFile=/etc/rebase.env` con permessi impostati a 0600 anziché definire i segreti nelle direttive `Environment=`: i file di unit sono leggibili da tutti e `systemctl show` mostra tutti i valori impostati con `Environment=`.

## Connection pooling

Il runtime mantiene un pool di connessioni ridotto e a lunga durata, non necessitando di un pooler. Ciò di cui invece necessitano tutti gli altri servizi che comunicano con il medesimo database e non possono mantenere connessioni persistenti: funzioni serverless, script pianificati, tool di BI o code worker scalati a cinquanta istanze. Il parametro `max_connections` di Postgres impone un limite rigido nell'ordine delle poche centinaia e ogni connessione corrisponde a un *processo*, per cui un fan-out di lambda può esaurirlo ben prima che il database sia effettivamente sotto carico.

Il file compose include un servizio `pgbouncer` per questo traffico, isolato tramite un profilo in modo che i deployment privi di questi client non eseguano un processo non necessario:

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

L'autenticazione del client viene ricavata all'avvio da `DATABASE_URL`, evitando la duplicazione della password. Il pooler si autentica su Postgres tramite `scram-sha-256`, supportato da Postgres 18 — l'impostazione predefinita `md5` dell'immagine provocherebbe il fallimento del login al *server* con `FATAL: server login failed: wrong password type`, un errore che sembra indicare una password errata pur non essendolo.

Mantieni la somma di `PGBOUNCER_POOL_SIZE` di tutti i pooler ampiamente al di sotto del valore di `max_connections` del database — il runtime attinge dalla medesima riserva.

### Cosa cambia con il transaction pooling

Un client collegato al pool mantiene una connessione al server solo per la durata di una transazione per poi rilasciarla: questo meccanismo consente a 500 client di condividere 20 connessioni. Tre funzionalità smettono di funzionare attraverso tale porta, e ciascuna di esse è utilizzata da Rebase stesso — motivo per cui il runtime si connette direttamente e questa porta è riservata agli altri client:

- **`LISTEN`/`NOTIFY`.** Il sistema Realtime è basato su questo meccanismo, e un listener richiede una connessione che persista oltre la transazione. Il comando `LISTEN` viene *accettato* dal pooler — risponde a `LISTEN`, ma nessuna notifica verrà mai recapitata.
- **Stato della sessione**: `SET` (a differenza di `SET LOCAL`), lock consultivi mantenuti tra più istruzioni, cursori `WITH HOLD`, tabelle temporanee. La transazione successiva potrebbe essere indirizzata a una connessione server differente, che non avrà visibilità di questo stato. Entrambi i casi falliscono in modo insidioso: con un solo client inattivo lo stato è spesso ancora presente, funzionando durante i test ma smettendo di funzionare sotto il livello di concorrenza per cui il pooler è stato introdotto.
- **Prepared statement a livello di protocollo.** La maggior parte dei driver permette di disattivarli — node-postgres non li usa di default; asyncpg richiede `statement_cache_size=0`.

`SET LOCAL` ha visibilità limitata alla transazione ed è pienamente funzionante; trattandosi del comando utilizzato per impostare la row-level security, la RLS si comporta in modo identico anche tramite la porta del pooler.

Non attivare questo profilo se nessun componente esterno al runtime deve connettersi al database. Una porta non utilizzata rappresenta una superficie di attacco superflua.

## Health check

| Path | Utilizzo |
| --- | --- |
| `/livez` | Liveness. Risponde alla domanda "il processo è vivo?" senza interrogare il database. |
| `/health` | Readiness. Esegue un round-trip verso il database e segnala la latenza. |

Configura le probe di liveness su `/livez`. Una probe di liveness puntata su `/health` riavvierebbe un processo del tutto integro durante un momentaneo rallentamento del database, ottenendo l'effetto contrario a quello desiderato.

## Metriche

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Espone le metriche Prometheus all'endpoint `/metrics`: conteggio delle richieste e istogrammi di latenza suddivisi per area API (data, auth, storage, functions) e per collection, oltre ai gauge di processo. In assenza di token, l'endpoint è accessibile a chiunque possa raggiungere la porta, pertanto è consigliabile definirne uno a meno che non ci si trovi su una rete privata.

`rebase_db_pool_wait_ms` è un istogramma del tempo di attesa di ogni query per ottenere una connessione dal pool del database, inclusa l'apertura di una nuova connessione, con etichetta corrispondente alla chiave dell'origine dati (`source="(default)"` in un progetto che non dichiara data source). Un pool in salute mantiene questo valore vicino allo zero. Una coda che aumenta all'aumentare del traffico indica che le richieste sono in attesa di connessioni — situazione spesso causata da callback di scrittura che restano in attesa di operazioni lente; consulta [A callback holds a connection](/docs/collections/context-data-api/#a-callback-holds-a-connection).

Il database stesso, per ciascuna origine dati:

| Metrica | Cosa indica |
|--------|--------------|
| `rebase_db_pool_connections`, `rebase_db_pool_idle`, `rebase_db_pool_waiting` | Connessioni di ciascun pool, etichettate con `pool="primary"`, `"read"` (la replica) o `"session"` (il pool diretto della console SQL dietro a un pooler). Un valore di `waiting` stabilmente superiore a zero indica un pool sottodimensionato per il carico. |
| `rebase_db_connection_errors_total` | Richieste che hanno ricevuto risposta 503 per mancanza di connessioni disponibili, classificate per `code`: `53300` / `53400` (connessioni esaurite sul server), `pool_exhausted`, `connect_timeout`, `unreachable`. |
| `rebase_db_connections` | Connessioni client attive sul server, suddivise per `state`, a confronto con `rebase_db_max_connections`. |
| `rebase_db_size_bytes` | Dimensione del database. |
| `rebase_db_replica_lag_seconds` | Ritardo di allineamento di `DATABASE_READ_URL` rispetto al primario. |

Gli ultimi quattro valori vengono campionati ogni 30 secondi sulla connessione interna dell'istanza, così che lo scraping non si traduca mai nell'esecuzione di una query.

`rebase_realtime_*` monitora i socket e i canali aperti di ciascuna istanza e i frame inviati al channel bus o trattenuti: consulta [Seeing what the bus does](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Header di sicurezza

Ogni risposta include gli header `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` e `Strict-Transport-Security: max-age=15552000` (180 giorni). L'header HSTS non include `includeSubDomains`: ciò imporrebbe ai browser di rifiutare il traffico HTTP semplice su ogni sottodominio del tuo dominio, compresi quelli del tutto estranei a questo server, e il browser manterrebbe questa direttiva per l'intera durata specificata.
Imposta `REBASE_HSTS_INCLUDE_SUBDOMAINS=true` se tutti i sottodomini gestiscono esclusivamente traffico HTTPS.

`strict-origin-when-cross-origin` è il comportamento predefinito dei browser: una richiesta indirizzata a un altro sito trasmette solo l'origine, escludendo il path e la query della pagina. Non viene utilizzato `no-referrer` poiché i controlli di origine richiedono l'indicazione dell'origine — il pulsante di autenticazione di Google la confronta con le origini JavaScript autorizzate del client OAuth, e con `no-referrer` restituirebbe l'errore "The given origin is not allowed for the given client ID" su qualunque app, a prescindere dalle autorizzazioni configurate nel client. Una risposta che definisce una propria policy la preserva (la pagina di consenso MCP invia `no-referrer`); una pagina che richiede restrizioni maggiori può dichiararlo tramite `<meta name="referrer" content="no-referrer">`.
`X-Frame-Options` opera secondo lo stesso principio: assume il valore `SAMEORIGIN` a meno che la risposta non imposti una propria direttiva, come avviene nella pagina di consenso MCP con `DENY`.

Le applicazioni statiche — l'amministrazione del CMS e qualsiasi frontend servito dal bundle — includono inoltre `Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri 'self'`. Questo header definisce chi può incorporare l'applicazione in un frame, esclude i plugin e vincola `<base>` alla tua origine, senza introdurre ulteriori restrizioni, permettendo così il corretto funzionamento di script inline, worker e meccanismi di login di terze parti. Una risposta che definisce una policy personalizzata mantiene la propria impostazione. Per requisiti più restrittivi, applica la policy sul reverse proxy posto a monte.

## Più di un'istanza

La configurazione predefinita prevede un singolo container e non richiede altro. Prima che una seconda replica inizi a ricevere traffico — o che un deploy di tipo rolling esegua due istanze contemporaneamente — consulta [Running more than one instance](/docs/deployment/multiple-instances/): rate limit, broadcast channel, file locali, upload riprendibili e cache delle immagini sono gestiti a livello di singolo processo finché non viene abilitata un'impostazione per la loro condivisione.

## Connettere Claude

Un unico comando consente di aggiungere questo server al [Rebase connector](/docs/ai/rebase-connector/), il connettore MCP unificato che collega tutti i tuoi progetti da Claude:

```bash
rebase cloud connect https://your-app.com
```

Imposta le due variabili restituite dal comando su questo server e riavvialo. Il server deve eseguire Rebase 0.28.1 o superiore ed essere raggiungibile via HTTPS su un indirizzo pubblico. Nessun altro elemento viene modificato: il server non memorizza segreti e concede al connettore gli stessi permessi assegnati a Studio.

## Esecuzione delle funzioni in un processo dedicato

La configurazione standard descritta finora impiega un unico container per servire l'intero progetto, soluzione ideale per la quasi totalità dei deployment. Quando una funzione personalizzata non deve più competere con la data API per le risorse dell'event loop — o deve poter scalare, riavviarsi e fallire in modo isolato — la stessa immagine e lo stesso bundle possono essere avviati come processi distinti e cooperanti. Consulta [Split processes](/docs/deployment/split-processes/).

## Aggiornamento

```yaml
image: rebasepro/server:0.30.1
```

Riavvia. Il tuo bundle rimane invariato. All'interno della stessa major version del contratto di runtime, un bundle validato continua a funzionare regolarmente — consulta [Compatibility](/docs/architecture/runtime-and-bundles/#compatibility).
