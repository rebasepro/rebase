---
sourceHash: cfc9a95285da2353
title: Self-Hosting
sidebar_label: Self-Hosting
description: Esegui Rebase ovunque con l'immagine di runtime ufficiale e il bundle del tuo progetto — Docker Compose, Fly, Railway o un semplice VPS.
---

## Panoramica

Fare self-hosting di Rebase significa eseguire due elementi: un database Postgres e l'immagine ufficiale `rebasepro/server` con il bundle del tuo progetto montato al suo interno.

Non c'è **alcuna immagine dell'applicazione da compilare**. Il tuo progetto viaggia come un bundle, il runtime è pubblicato e l'aggiornamento di Rebase consiste in una modifica di tag anziché in una ricompilazione. Consulta [Runtime e bundle](/docs/architecture/runtime-and-bundles/) per scoprire perché è suddiviso in questo modo.

## Docker Compose

**Se il tuo progetto è stato creato con `rebase init`, usa il suo `docker-compose.yml`.**
Si trova nel tuo repository, `init` ne ha compilato i segreti, il suo primo account amministratore e la versione del runtime bloccata (pinned), ed è il file descritto in [Deployment](/docs/getting-started/deployment/#docker-compose-recommended):

```bash
rebase build
docker compose up -d
```

Il resto di questa pagina riguarda lo stesso deployment senza uno scaffold alle spalle: il progetto di qualcun altro, un bundle compilato in CI, o le due cose che il file generato omette deliberatamente: un connection pooler e le configurazioni a processi separati. Quel file si trova nel repository, in [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml). Usa quello invece di copiare uno snippet da questa pagina: entrambi i file vengono avviati dall'acceptance gate del progetto a ogni push, quindi nessuno dei due può divergere da ciò che funziona realmente.

I due file concordano su ogni variabile d'ambiente tranne la password del database, e questo perché ciascuno è scritto per il proprio generatore: questo legge `POSTGRES_PASSWORD`, generata da `quickstart.sh`; quello generato legge `DATABASE_PASSWORD`, che `rebase init` incorpora anche nella `DATABASE_URL` scritta nel tuo `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` è un unico comando che fa due cose ovvie stampandole entrambe. La forma estesa, se preferisci gestire ogni passaggio manualmente:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

Non è necessario avviare il database separatamente: `api` attende il relativo healthcheck.

### I sei valori necessari

`quickstart.sh` li genera per te. Per scrivere il file `.env` manualmente:

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

- **`POSTGRES_PASSWORD`** — la password del database. Modificarla in seguito significa modificarla anche nel volume, quindi sceglila una sola volta.
- **`JWT_SECRET`** — firma ogni sessione. Eseguirne la rotazione disconnetterà tutti gli utenti.
- **`REBASE_SERVICE_KEY`** — la credenziale che scavalca la row-level security per le chiamate server-to-server. Trattala come una password di root: chiunque la possieda può leggere qualsiasi riga.
- **`CORS_ORIGINS`** — le origini da cui viene servito il tuo frontend, separate da virgola. Non è un segreto e non è facoltativo: in produzione il runtime rifiuta di avviarsi senza questo valore anziché tirare a indovinare, perché un'API che indovina le origini consentite prima o poi consentirà quella sbagliata.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — il primo amministratore. Un database nuovo non ha utenti, e al di fuori della produzione la policy di registrazione accetta la prima iscrizione promuovendola ad admin — altrimenti un database vuoto sarebbe un vicolo cieco, poiché l'inizializzazione di un amministratore richiede un chiamante già autenticato. Nel momento in cui questo stack risponde su un hostname, tale comodità diventa una race condition che l'operatore può perdere, quindi in produzione questa finestra viene chiusa e l'account viene specificato qui. Il runtime lo crea una sola volta, quando la tabella utenti è vuota, e non fa nulla a ogni avvio successivo.

`JWT_SECRET` e `REBASE_SERVICE_KEY` devono contenere ciascuno almeno 32 caratteri, e la password di amministrazione almeno 12. Usa un indirizzo con un punto nel dominio: `POST /auth/login` analizza il body con `z.string().email()`, quindi il runtime rifiuta di creare `admin@localhost` — un account con cui nessuno potrebbe accedere — registrando invece il motivo nel log. Il file compose dichiara tutti e sei i parametri con `${VAR:?…}`, quindi l'assenza di uno di essi arresta lo stack con un messaggio che ne indica il nome, anziché avviare un sistema configurato a metà — e l'auto-registrazione è disattivata di default (`DISABLE_SELF_REGISTRATION`, default `true`), in modo che non rimanga nulla di non reclamato.

Accedi con queste credenziali e cambia la password: si trovano in chiaro in un file sull'host.

## Dipendenze

`rebase build` **installa di default le dipendenze del progetto nel bundle**, quindi `dist-bundle` include `node_modules` e un `package-lock.json` accanto al suo `package.json`. Un bundle con dipendenze incluse (vendored) si avvia in circa cinque secondi.

Dato che sono già presenti, puoi montare il bundle in sola lettura: una pratica consigliata, poiché un hook compromesso non potrà riscrivere il codice eseguito dopo il riavvio successivo:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` disattiva questa opzione e produce un bundle che installa le dipendenze al primo avvio, impiegando 40-60 secondi per avvio e richiedendo che il montaggio sia scrivibile.

Per un deployment reale, è preferibile incorporare entrambi in un'immagine, bloccando così con precisione ciò che viene eseguito:

```dockerfile
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

## Creazione dello schema

<span class="since-badge" data-since="0.31">Da 0.31</span>

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle dichiarate in `backend/schema`.**
`REBASE_MIGRATE_ON_BOOT` ha come valore predefinito `ensure`, che opera in modo additivo sull'intero schema: crea le tabelle, le colonne e i tipi enum mancanti, e applica la relativa row-level security. Un primo avvio su un database vuoto inizia a servire le tue tabelle senza alcun passaggio aggiuntivo.

Ciò che `ensure` deliberatamente non fa mai è modificare ciò che esiste già. Non altera il tipo di una colonna, non elimina tabelle o colonne e non modifica i valori di un enum esistente — perché il riavvio di un container non deve poter rimodellare uno schema come effetto collaterale di un deploy.

Pertanto, vale comunque la pena eseguire `rebase db push` per ciò che l'avvio tralascia — qualsiasi modifica che non sia puramente additiva: una colonna rinominata, un tipo ristretto, un campo rimosso.

```bash
rebase db push
```

Eseguilo da un checkout locale o da un job di CI, puntando al database di deployment. Esegue prima una prova (dry-run) delle modifiche, rifiuta quelle distruttive senza conferma esplicita e può creare un backup prima di applicarle. Il database pubblica una porta nel file compose per permettere di raggiungerlo dall'host; rimuovi tale mappatura una volta impostato lo schema se il database non deve essere raggiungibile dall'esterno.

`REBASE_MIGRATE_ON_BOOT` accetta solo `ensure` e `none`, e nient'altro — l'immagine **rifiuta di avviarsi** con `push`, per il motivo sopra indicato.

## Quando solo il tuo processo di modifica può modificare il database

`REBASE_MIGRATE_ON_BOOT=none` lascia intatte le tue tabelle. Tuttavia, non lascia intatto l'intero database: le tabelle interne del framework (autenticazione, chiavi API, job, cron) vengono comunque create e mantenute aggiornate a ogni avvio. Quando il database può essere modificato solo tramite un processo di modifica revisionato, imposta `REBASE_PROVISION=false` su ogni processo che serve traffico:

| Impostazione | Tabelle e policy dichiarate | Tabelle del framework |
|---|---|---|
| predefinito (`REBASE_MIGRATE_ON_BOOT=ensure`) | create e mantenute aggiornate all'avvio | create e mantenute aggiornate |
| `REBASE_MIGRATE_ON_BOOT=none` | lasciate intatte | create e mantenute aggiornate |
| `REBASE_PROVISION=false` | lasciate intatte | lasciate intatte; qualsiasi elemento mancante viene segnalato nel log |

Con il provisioning disattivato, il runtime non crea né altera alcunché: nessuna tabella, colonna, indice, funzione, trigger, policy, ruolo o grant. Questo vale all'avvio e successivamente, incluse le tabelle che un processo in esecuzione creerebbe al primo utilizzo (chiavi di idempotenza, claim di cron, contatori condivisi di rate-limit). Invece, si limita a leggere ciò che è presente:

- **Tabelle di autenticazione, o una colonna letta dall'autenticazione, mancanti:** l'avvio fallisce elencando ciascun elemento mancante.
- **Il ruolo di richiesta può accedere a una tabella del framework** come `rebase.refresh_tokens` o `rebase.api_keys`: l'avvio fallisce e stampa il comando `REVOKE` da eseguire. Un avvio con provisioning revoca tali privilegi autonomamente. Con il provisioning disattivato, non lo fa nessuno.
- **Una tabella opzionale mancante** (chiavi API, chiavi di idempotenza, claim di cron, contatori di rate-limit, presenza, storico metriche): la funzionalità corrispondente viene disattivata e il log indica quale tabella è necessaria.
- <span class="since-badge" data-since="0.31">Da 0.31</span> **Una tabella dichiarata non protetta dal database** — row-level security disabilitata, nessuna delle policy dichiarate presente o una policy restrittiva dichiarata mancante: tale tabella non viene servita (una policy permissiva mancante viene servita, con un avviso di avvio che la specifica). Una richiesta per essa risponde con `503 TABLE_WITHHELD`, e il log di avvio indica l'SQL che la protegge (o suggerisce `rebase db push`). Le altre tabelle vengono servite e l'avvio procede. Una tabella di giunzione molti-a-molti viene verificata allo stesso modo: una non protetta dal database trattiene le tabelle le cui relazioni la utilizzano, e `TABLE_WITHHELD` indica la giunzione. Anche una tabella la cui relazione `via` passa attraverso una tabella trattenuta viene trattenuta, e il messaggio indica la relazione. Ciò vale anche con `REBASE_MIGRATE_ON_BOOT=none` e durante un aggiornamento dinamico dello schema.

I record cambiano comunque, come avverrebbe in qualsiasi database: accessi, sessioni, utilizzo delle chiavi API, chiavi di idempotenza, claim di cron. Il primo account amministratore (`REBASE_ADMIN_EMAIL`) viene inserito dall'esecuzione di provisioning, non dai processi che servono traffico. La [modifica dello schema in tempo reale](/docs/backend/live-schema-editing) può comunque effettuare il commit di una modifica come sorgente, ma rifiuta di applicarla al database.

### L'esecuzione del provisioning

Lo schema proviene da un'esecuzione controllata dal tuo processo di modifica. Usa la stessa immagine e lo stesso bundle del server, con `REBASE_PROVISION_ONLY=true`, connesso come un ruolo che ha i permessi di creazione nel database. `REBASE_PROVISION_SQL_OUT` salva ogni modifica allo schema apportata dall'esecuzione sotto forma di script SQL:

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

Lo script è una registrazione, non un piano: ogni istruzione al suo interno è stata eseguita con successo, nell'ordine indicato. Se registrato su un database vuoto, costituisce l'intero schema richiesto dalla release. Se registrato su una copia ripristinata della produzione, rappresenta esattamente l'aggiornamento. Le righe scritte durante l'esecuzione non sono incluse. Esaminalo, quindi applicalo al database reale:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f out/rebase.sql
```

Ripeti l'operazione per ogni aggiornamento di Rebase, prima del rollout dei processi che servono il traffico. Una nuova release può aggiungere una tabella o una colonna, e un processo privo dei permessi di creazione la segnalerà come mancante invece di crearla.

Un server creato da te segue la stessa regola: `initializeRebaseBackend` legge `REBASE_PROVISION`, e `createRebaseBackend` accetta [`provision: false`](/docs/backend/custom-server#what-creating-a-backend-may-change-provision).

## Archiviazione dei file

Lo storage è **disattivato** a meno che non sia configurato un bucket, e questo è intenzionale: l'alternativa predefinita sarebbe il filesystem del container, che perderebbe silenziosamente ogni file caricato al riavvio successivo. I caricamenti vengono rifiutati con `501 STORAGE_NOT_CONFIGURED` finché non ne configuri uno.

Per un bucket, imposta `STORAGE_TYPE=s3` (o `gcs`) insieme al bucket e alle credenziali — il file compose elenca le variabili, commentate. `gcs` carica `@google-cloud/storage`, che non è incluso nell'immagine ufficiale; pertanto, su tale immagine, accedi a Google Cloud Storage tramite il suo endpoint compatibile con S3 (`STORAGE_TYPE=s3`, `S3_ENDPOINT=https://storage.googleapis.com`, chiavi HMAC).

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

`FORCE_LOCAL_STORAGE` non è facoltativo in questo caso: in produzione un backend `local` viene scartato anziché registrato, poiché l'alternativa vedrebbe upload riusciti all'interno di un filesystem destinato a essere distrutto. Questa variabile serve a confermare che il mount è persistente.

Monta il volume **al di sopra** di `STORAGE_PATH`, non esattamente su di esso. `STORAGE_PATH` è la directory del bucket predefinito, e ogni bucket dichiarato in `backend/resources.ts` ne ottiene una propria accanto, `<STORAGE_PATH>__<key>`. Un volume montato esattamente su `STORAGE_PATH` conterrà solo il bucket predefinito. Ogni altro bucket scriverà sul filesystem del container e perderà i propri file alla ricreazione del container. `STORAGE_PATH__MEDIA` può spostare un bucket altrove sul volume. Non può spostarlo all'interno della directory di un altro bucket, come ad esempio `/storage/uploads/media`, perché in tal caso il bucket predefinito ne elencherebbe, servirebbe ed eliminerebbe i file.

L'immagine crea `/storage` per l'utente non privilegiato `node` con cui viene eseguita, motivo per cui il volume va posizionato lì. Un volume montato dove l'immagine non dispone di una directory appartiene a root e ogni caricamento fallisce con `EACCES`. Il file compose generato da `rebase init` lo monta in questo modo.

### Lo storage richiede un modello di controllo degli accessi

Una volta configurato un bucket, il runtime **rifiuta di avviarsi in produzione** finché il deployment non dichiara come sono protetti gli oggetti. Lo storage non è soggetto a row-level security e le sue chiavi condividono un singolo namespace piatto; senza regole, l'unica cosa a separare i file di due utenti sarebbe l'imprevedibilità delle chiavi — vanificata da `GET /storage/list?prefix=`. Una qualsiasi delle seguenti opzioni soddisfa questo requisito:

- un **hook `storageAuthorize`** (o `storagePolicies`) nella configurazione del progetto, che rappresenta la vera soluzione ed è ciò che lo scaffold include in `backend/storage.ts` — nessuna variabile d'ambiente può esprimere "questo utente può leggere questa chiave";
- **`STORAGE_PUBLIC_READ=true`**, per un bucket che è a tutti gli effetti un CDN pubblico di sola lettura;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, per un'applicazione single-tenant in cui ogni account autenticato è autorizzato ad accedere a tutti i file.

Al di fuori della produzione, la stessa condizione genera un chiaro warning anziché un blocco dell'avvio; pertanto, questo è un errore di avvio che si riscontra in fase di deploy anziché sul computer di sviluppo locale. È una scelta intenzionale: l'errore che sostituisce avverrebbe altrimenti in modo silenzioso.

Imposta anche `MFA_ENCRYPTION_KEY` se utilizzi TOTP. Se non configurata, i segreti memorizzati dell'autenticatore vengono crittografati con `JWT_SECRET` — quindi la rotazione di quest'ultimo disconnetterebbe tutti gli utenti *e* renderebbe indecifrabili tutti i dispositivi registrati.

## Altre piattaforme

Il runtime è un normale container in ascolto su `$PORT`, quindi qualsiasi piattaforma in grado di eseguire container andrà bene. Due aspetti da configurare correttamente ovunque:

1. Il bundle deve essere presente in `/bundle` (o ovunque punti `REBASE_BUNDLE`), con le relative dipendenze installate accanto — vedi [Dipendenze](#dipendenze).
2. Imposta `CORS_ORIGINS`, `JWT_SECRET` e `DATABASE_URL`. Il runtime rifiuta di avviarsi in produzione in loro assenza anziché tirare a indovinare.

### Fly.io

```toml
[build]
  dockerfile = "Dockerfile"   # FROM rebasepro/server:0.30.1 + COPY dist-bundle /bundle

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Usa la forma dell'immagine derivata mostrata sopra in modo che il bundle sia distribuito insieme all'app, quindi esegui `fly deploy`.

### Railway / Render

Punta il servizio all'immagine derivata, imposta le variabili d'ambiente e configura il percorso dell'health check su `/livez`.

### Un semplice VPS

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` elenca le variabili che legge. Sotto systemd:

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

`NODE_ENV=production` non è una formalità. Se omesso, il processo viene eseguito in modalità di sviluppo: accetta origini localhost, serve le specifiche OpenAPI e **lascia aperta la finestra del primo amministratore** — cosicché il primo sconosciuto a trovare il form di registrazione diventa l'amministratore. Le due righe `REBASE_ADMIN_*` sono ciò che sostituisce tale finestra; consulta [Il tuo primo amministratore](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` è presente perché il database si trova sulla stessa macchina. In produzione il runtime rifiuta qualsiasi variabile che punti a localhost — in un container, l'interfaccia di loopback è il container stesso, quindi quell'indirizzo è sempre un errore — e questa riga gli indica che l'indirizzo è intenzionale. Rimuovila quando il database viene eseguito altrove.

Per i segreti, preferisci `EnvironmentFile=/etc/rebase.env` con permessi impostati a 0600 rispetto alle righe `Environment=`: un file di unit è leggibile da chiunque (world-readable) e `systemctl show` stampa tutti i valori di `Environment=`.

## Connection pooling

Il runtime mantiene un pool ristretto e a lunga durata e non necessita di un pooler. Ne ha invece bisogno tutto il resto che comunica con lo stesso database e non può mantenere una connessione aperta: una funzione serverless, uno script pianificato, uno strumento di BI, un worker di code che scala fino a cinquanta istanze. Il parametro `max_connections` di Postgres è un limite rigido nell'ordine delle poche centinaia e ogni connessione è un *processo*, quindi un fan-out di funzioni lambda lo esaurisce molto prima che il database sia effettivamente carico.

Il file compose include un servizio `pgbouncer` per questo traffico, protetto da un profilo in modo che un deployment privo di tali chiamanti non esegua un processo superfluo:

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

L'autenticazione del client viene generata da `DATABASE_URL` all'avvio, evitando di dover scrivere la password due volte. Il pooler si autentica su Postgres con `scram-sha-256`, supportato da Postgres 18 — il valore predefinito `md5` dell'immagine fallisce il login del *server* con `FATAL: server login failed: wrong password type`, che sembra un errore di password errata pur non essendolo.

Mantieni la somma di `PGBOUNCER_POOL_SIZE` su tutti i pooler ampiamente al di sotto del parametro `max_connections` del database — il runtime attinge allo stesso budget.

### Cosa cambia con il transaction pooling

Un client che usa il pool trattiene una connessione al server per la durata di una transazione per poi rilasciarla, ed è questo che permette a 500 client di condividere 20 connessioni. Tre cose smettono di funzionare attraverso quella porta, e ciascuna di esse è utilizzata da Rebase stesso — motivo per cui il runtime si connette direttamente e questa porta è riservata agli altri chiamanti:

- **`LISTEN`/`NOTIFY`.** La funzionalità Realtime è basata su questo meccanismo, e un listener necessita di una connessione che sopravviva alla transazione. `LISTEN` viene *accettato* dal pooler — risponde a `LISTEN`, ma nessuna notifica verrà mai recapitata.
- **Stato della sessione**: `SET` (a differenza di `SET LOCAL`), advisory lock mantenuti tra istruzioni diverse, cursori `WITH HOLD`, tabelle temporanee. La transazione successiva potrebbe atterrare su una connessione al server differente, che non vedrà alcuno di questi elementi. Entrambi i casi falliscono nello stesso modo ingannevole: con un singolo client inattivo lo stato è spesso ancora presente, quindi funziona durante i test ma smette di funzionare sotto la concorrenza per cui il pooler è stato introdotto.
- **Prepared statement a livello di protocollo.** Alla maggior parte dei driver può essere indicato di non usarli — node-postgres non lo fa per impostazione predefinita; asyncpg richiede `statement_cache_size=0`.

`SET LOCAL` ha visibilità limitata alla transazione e funziona correttamente, ed è ciò con cui viene impostata la row-level security — quindi la RLS si comporta in modo identico attraverso la porta del pool.

Lascia il profilo disattivato se nessun servizio esterno al runtime si connette al database. Una porta non utilizzata è solo superficie di attacco.

## Health check

| Percorso | Scopo |
| --- | --- |
| `/livez` | Liveness. Risponde a "questo processo è vivo?" senza toccare il database. |
| `/health` | Readiness. Esegue un round-trip verso il database e riporta la latenza. |

Punta i probe di liveness su `/livez`. Un probe di liveness su `/health` riavvierebbe un processo perfettamente integro durante un momentaneo singhiozzo del database, che è l'opposto del suo scopo.

## Metriche

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Espone le metriche di Prometheus su `/metrics`: conteggio delle richieste e istogrammi di latenza suddivisi per superficie API (data, auth, storage, functions) e tabella, oltre ai gauge di processo. Senza un token, l'endpoint è accessibile a chiunque possa raggiungere la porta, quindi impostane uno a meno che non ci si trovi su una rete privata.

`rebase_db_pool_wait_ms` è un istogramma di quanto a lungo ogni query ha atteso una connessione dal pool del database, inclusa l'apertura di una nuova connessione, etichettato per chiave della sorgente dati (`source="(default)"` in un progetto che non dichiara data source). Un pool in salute mantiene questo valore vicino allo zero. Una coda che cresce con il traffico indica che le richieste sono in coda per ottenere connessioni — nella maggior parte dei casi trattenute da hook di scrittura in attesa di operazioni lente; vedi [Un hook trattiene una connessione](/docs/collections/context-data-api/#a-hook-holds-a-connection).

Il database stesso, per ciascuna sorgente dati:

| Metrica | Cosa indica |
|--------|--------------|
| `rebase_db_pool_connections`, `rebase_db_pool_idle`, `rebase_db_pool_waiting` | Le connessioni di ciascun pool, etichettate con `pool="primary"`, `"read"` (la replica) o `"session"` (il pool diretto della console SQL dietro un pooler). Un valore di `waiting` superiore a zero per un tempo prolungato indica un pool troppo piccolo per il suo carico. |
| `rebase_db_connection_errors_total` | Richieste che hanno risposto 503 per mancanza di una connessione, per `code`: `53300` / `53400` (il server ha esaurito le connessioni), `pool_exhausted`, `connect_timeout`, `unreachable`. |
| `rebase_db_connections` | Connessioni client sul server, per `state`, a confronto con `rebase_db_max_connections`. |
| `rebase_db_size_bytes` | Le dimensioni del database. |
| `rebase_db_replica_lag_seconds` | Quanto `DATABASE_READ_URL` è indietro rispetto al primario. |

Le ultime quattro metriche vengono campionate ogni 30 secondi sulla connessione dell'istanza stessa, così che uno scrape non si trasformi mai in una query aggiuntiva.

`rebase_realtime_*` riporta i socket aperti, i canali e i frame inviati al bus di canale o trattenuti da ciascuna istanza: vedi [Verificare cosa fa il bus](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Header di sicurezza

Ogni risposta include `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` e `Strict-Transport-Security: max-age=15552000` (180 giorni). L'header HSTS tralascia `includeSubDomains`: questo indicherebbe ai browser di rifiutare l'HTTP semplice su qualsiasi sottodominio del tuo dominio, inclusi quelli con cui questo server non ha nulla a che fare, e il browser manterrebbe questa regola per l'intera durata specificata dall'header.
Imposta `REBASE_HSTS_INCLUDE_SUBDOMAINS=true` quando tutti i sottodomini sono esclusivamente in HTTPS.

`strict-origin-when-cross-origin` è il valore predefinito dei browser: una richiesta a un altro sito include la tua origine e mai il path o la query della pagina. Non viene usato `no-referrer` poiché i controlli dell'origine necessitano dell'origine stessa — il pulsante di accesso Google la confronta con le origini JavaScript autorizzate del client OAuth, e con `no-referrer` rispondeva "The given origin is not allowed for the given client ID" su ogni app, indipendentemente da cosa consentisse il client. Una risposta che imposta la propria policy la mantiene (la pagina di consenso MCP invia `no-referrer`); una pagina che necessita di una policy più restrittiva può specificarlo con `<meta name="referrer" content="no-referrer">`. `X-Frame-Options` funziona allo stesso modo: `SAMEORIGIN` a meno che la risposta non imposti la propria, come fa la pagina di consenso MCP con `DENY`.

Le app statiche — il pannello di amministrazione CMS e qualsiasi frontend servito dal bundle — includono anche `Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri 'self'`. Questa direttiva stabilisce chi può incorporare l'app in un frame, esclude i plugin e fissa `<base>` alla tua origine, senza limitare nient'altro, permettendo a script inline, worker e accessi di terze parti di continuare a funzionare. Una risposta che imposta la propria policy la mantiene. Per qualsiasi regola più restrittiva, configura la policy sul reverse proxy a monte.

## Più di un'istanza

Un singolo container rappresenta la configurazione predefinita e non richiede altro. Prima che una seconda replica riceva traffico — o che un rolling deploy ne esegua due affiancate — consulta [Esecuzione di più istanze](/docs/deployment/multiple-instances/): rate limit, canali broadcast, file locali, upload ripristinabili e cache delle immagini sono gestiti per singolo processo a meno che un'impostazione non li condivida.

## Connettere Claude

Un solo comando aggiunge questo server al [Rebase connector](/docs/ai/rebase-connector/), l'unico connettore MCP che consente a Claude di raggiungere tutti i tuoi progetti:

```bash
rebase cloud connect https://your-app.com
```

Imposta le due variabili stampate a schermo su questo server e riavvialo. Il server deve eseguire Rebase 0.28.1 o versione successiva e rispondere tramite https su un indirizzo pubblico. Non cambia nient'altro: non conserva alcun segreto e concede al connettore gli stessi permessi concessi da Studio.

## Esecuzione di funzioni in un processo dedicato

Tutto quanto descritto sopra prevede un unico container che serve l'intero progetto, configurazione ottimale per quasi tutti i deployment. Quando una custom function non deve più competere con le data API per l'event loop — o deve scalare, riavviarsi e fallire in modo indipendente — la stessa immagine e lo stesso bundle possono essere avviati come processi distinti e cooperanti. Consulta [Processi separati](/docs/deployment/split-processes/).

## Aggiornamento

```yaml
image: rebasepro/server:0.30.1
```

Riavvia. Il tuo bundle rimane invariato. All'interno della stessa versione major del contratto di runtime, un bundle validato continua a funzionare — consulta [Compatibilità](/docs/architecture/runtime-and-bundles/#compatibility).
