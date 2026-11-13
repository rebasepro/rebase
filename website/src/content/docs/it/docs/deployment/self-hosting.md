---
sourceHash: d3a77712f89b7829
title: Self-Hosting
sidebar_label: Self-Hosting
description: Esegui Rebase ovunque con l'immagine di runtime ufficiale e il bundle del tuo progetto — Docker Compose, Fly, Railway o un semplice VPS.
---

## Panoramica

L'hosting autonomo (self-hosting) di Rebase richiede l'esecuzione di due componenti: un database Postgres e l'immagine ufficiale `rebasepro/server` con il bundle del tuo progetto montato al suo interno.

**Non c'è alcuna immagine applicativa da compilare**. Il tuo progetto viaggia sotto forma di bundle, il runtime è già pubblicato e l'aggiornamento di Rebase consiste nel semplice cambio di un tag invece di una ricompilazione. Consulta [Runtime and bundles](/docs/architecture/runtime-and-bundles/) per scoprire i motivi di questa separazione.

## Docker Compose

**Se il tuo progetto è stato creato con `rebase init`, usa il suo `docker-compose.yml`.**
Si trova già nel tuo repository, `init` ha inserito i suoi segreti, il suo primo account amministratore e la versione del runtime bloccata (pinned), ed è il file descritto in [Deployment](/docs/getting-started/deployment/#docker-compose-recommended):

```bash
rebase build
docker compose up -d
```

Il resto di questa pagina illustra lo stesso deployment senza un'impalcatura (scaffold) generata — il progetto di qualcun altro, un bundle compilato in CI, o i due elementi che il file generato tralascia volutamente: un connection pooler e le configurazioni a processi separati. Quel file risiede nel repository, all'indirizzo [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml). Usa quello invece di copiare uno snippet da questa pagina: entrambi i file vengono avviati dall'acceptance gate del progetto a ogni push, garantendo che nessuno dei due si discosti da ciò che funziona realmente.

I due file concordano su ogni variabile d'ambiente tranne la password del database, e questo perché ciascuno è pensato per il rispettivo generatore: questo legge `POSTGRES_PASSWORD`, generata da `quickstart.sh`; quello generato legge `DATABASE_PASSWORD`, che `rebase init` include anche nella stringa `DATABASE_URL` scritta nel tuo `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` è un singolo comando che compie due operazioni evidenti stampandole entrambe. La forma estesa, se preferisci gestire direttamente ogni passaggio:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

Non è necessario avviare il database separatamente: `api` attende il completamento del suo healthcheck.

### I sei valori necessari

`quickstart.sh` li genera automaticamente per te. Per scrivere il file `.env` manualmente:

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

Tre segreti, un dato di fatto e l'account con cui effettuare l'accesso:

- **`POSTGRES_PASSWORD`** — la password del database. Modificarla in seguito richiede di aggiornarla anche nel volume, quindi sceglila con attenzione la prima volta.
- **`JWT_SECRET`** — firma ogni sessione. La rotazione di questa chiave disconnette tutti gli utenti.
- **`REBASE_SERVICE_KEY`** — la credenziale che bypassa la row-level security per le chiamate server-to-server. Trattala come una password di root: chiunque la possieda può leggere qualsiasi riga.
- **`CORS_ORIGINS`** — le origini da cui viene servito il frontend, separate da virgola. Non è un segreto e non è facoltativo: in produzione il runtime si rifiuta di avviarsi in sua assenza invece di tirare a indovinare, perché un'API che tenta di indovinare le origini consentite prima o poi autorizzerà quella sbagliata.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — il primo amministratore. Un database nuovo non ha utenti, e al di fuori della produzione i criteri di registrazione accettano la prima iscrizione promuovendola ad amministratore — altrimenti un database vuoto sarebbe un vicolo cieco, poiché l'inizializzazione di un amministratore richiede un chiamante già autenticato. Nel momento in cui questo stack risponde su un hostname pubblico, tale comodità diventa una race condition che l'operatore può perdere; perciò in produzione questa finestra viene chiusa e l'account viene definito qui. Il runtime lo crea una sola volta, quando la tabella utenti è vuota, e non fa nulla a ogni avvio successivo.

`JWT_SECRET` e `REBASE_SERVICE_KEY` devono contenere ciascuno almeno 32 caratteri, e la password dell'amministratore almeno 12. Usa un indirizzo con un punto nel dominio: `POST /auth/login` valida il corpo della richiesta con `z.string().email()`, pertanto il runtime rifiuta di effettuare il seeding di `admin@localhost` — un account con cui nessuno potrebbe accedere — registrando invece il motivo nei log. Il file compose dichiara tutte e sei le variabili con `${VAR:?…}`, quindi l'assenza di una di esse arresta lo stack con un messaggio che ne indica il nome anziché avviare un ambiente configurato a metà — inoltre l'autoregistrazione è disabilitata di default (`DISABLE_SELF_REGISTRATION`, predefinito `true`), per cui nessun account può essere rivendicato da terzi.

Accedi con queste credenziali e cambia la password: sono memorizzate in un file sull'host.

## Dipendenze

Di default `rebase build` **installa le dipendenze del progetto all'interno del bundle**, così che `dist-bundle` includa una cartella `node_modules` e un file `package-lock.json` accanto al suo `package.json`. Un bundle con dipendenze incluse (vendored) si avvia in circa cinque secondi.

Poiché sono già presenti, puoi montare il bundle in sola lettura — una scelta consigliata, dato che un hook compromesso non potrà così riscrivere il codice che verrà eseguito al riavvio successivo:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` disattiva questo comportamento e genera un bundle che installa invece le dipendenze al primo avvio, operazione che richiede dai 40 ai 60 secondi a ogni avvio e necessita di un punto di montaggio scrivibile.

Per un deployment di produzione, è preferibile incorporare entrambi in un'immagine, bloccando con precisione ciò che viene eseguito:

```dockerfile
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

## Creazione dello schema

<span class="since-badge" data-since="0.31">Since 0.31</span>

**Il runtime crea le tabelle mancanti all'avvio, comprese quelle dichiarate da `backend/schema`.**
Il valore predefinito di `REBASE_MIGRATE_ON_BOOT` è `ensure`, che ha un comportamento additivo sull'intero schema: crea le tabelle, le colonne e i tipi enum mancanti e applica la loro row-level security. Un primo avvio su un database vuoto rende subito disponibili le tue tabelle, senza alcun passaggio intermedio.

Ciò che `ensure` si rifiuta categoricamente di fare è modificare qualsiasi cosa sia già esistente. Non altera il tipo di una colonna, non elimina tabelle o colonne e non modifica i valori di un enum esistente — perché il riavvio di un container non deve poter alterare lo schema come effetto collaterale di un deploy.

Pertanto è sempre opportuno eseguire `rebase db push` per tutto ciò che l'avvio non tocca — qualsiasi modifica che non sia puramente additiva: una colonna rinominata, un tipo ristretto, un campo rimosso.

```bash
rebase db push
```

Eseguilo da un checkout locale o da un job di CI, puntando al database del deployment. Esegue prima un test di prova (dry-run) delle modifiche, rifiuta quelle distruttive senza una conferma esplicita e può effettuare un backup prima dell'applicazione. Il database espone una porta nel file compose affinché possa essere raggiunto dall'host; rimuovi tale mappatura una volta configurato lo schema se il database non deve essere accessibile dall'esterno.

`REBASE_MIGRATE_ON_BOOT` accetta solo `ensure` e `none`, e null'altro — l'immagine **si rifiuta di avviarsi** se impostata su `push`, per il motivo sopra indicato.

## Quando solo il tuo processo di change management può modificare il database

`REBASE_MIGRATE_ON_BOOT=none` non tocca le tue tabelle. Non lascia però del tutto invariato il database: le tabelle interne del framework (auth, chiavi API, job, cron) vengono comunque create e mantenute aggiornate a ogni avvio. Quando il database può essere modificato esclusivamente tramite un processo formale di change management con revisione, imposta `REBASE_PROVISION=false` su ogni processo che serve traffico:

| Impostazione | Tabelle e policy dichiarate | Tabelle del framework |
|---|---|---|
| predefinito (`REBASE_MIGRATE_ON_BOOT=ensure`) | create e mantenute aggiornate all'avvio | create e mantenute aggiornate |
| `REBASE_MIGRATE_ON_BOOT=none` | non modificate | create e mantenute aggiornate |
| `REBASE_PROVISION=false` | non modificate | non modificate; gli elementi mancanti vengono elencati nei log |

Con il provisioning disattivato, il runtime non crea né altera alcunché: nessuna tabella, colonna, indice, funzione, trigger, policy, ruolo o grant. Questo vale sia all'avvio che in seguito, incluse le tabelle che un processo normalmente creerebbe al primo utilizzo (chiavi di idempotenza, cron claim, contatori condivisi di rate limit). Si limita invece a leggere ciò che trova:

- **Tabelle di autenticazione o colonne lette dall'auth mancanti:** l'avvio si blocca elencando ciascuna di esse.
- **Il ruolo della richiesta può accedere a una tabella del framework** come `rebase.refresh_tokens` o `rebase.api_keys`: l'avvio si blocca e stampa il comando `REVOKE` da eseguire. Un avvio con provisioning abilitato revoca autonomamente tali privilegi; a provisioning disattivato, nessuno lo farà.
- **Tabella opzionale mancante** (chiavi API, chiavi di idempotenza, cron claim, contatori di rate limit, presence, storico metriche): la funzionalità corrispondente viene disattivata e il log indica quale tabella sia richiesta.
- <span class="since-badge" data-since="0.31">Since 0.31</span> **Una tabella dichiarata non è protetta dal database** — row-level security disattivata, nessuna delle policy dichiarate presente o una policy restrittiva dichiarata mancante: tale tabella non viene servita (se manca una policy permissiva viene servita, con un avviso nei log all'avvio). Una richiesta verso di essa restituisce `503 TABLE_WITHHELD` e il log di avvio specifica l'istruzione SQL necessaria a proteggerla (o suggerisce `rebase db push`). Le altre tabelle continuano a essere servite e l'avvio prosegue. Una tabella di giunzione many-to-many viene controllata allo stesso modo: se il database non la protegge, vengono trattenute le tabelle le cui relazioni la utilizzano, e `TABLE_WITHHELD` specifica la giunzione incriminata. Ciò si applica anche con `REBASE_MIGRATE_ON_BOOT=none` e durante il refresh live dello schema.

Le righe continuano a cambiare, come avverrebbe in qualsiasi database: accessi, sessioni, uso di chiavi API, chiavi di idempotenza, cron claim. Il primo account amministratore (`REBASE_ADMIN_EMAIL`) viene inserito (seeded) durante l'esecuzione del provisioning, non dai processi che servono il traffico. [Live schema editing](/docs/backend/live-schema-editing) può comunque eseguire il commit di una modifica a livello di codice sorgente, ma rifiuterà di applicarla al database.

### L'esecuzione del provisioning

Lo schema deriva da un'esecuzione controllata dal tuo processo di change management. Usa la stessa immagine e lo stesso bundle del server, impostando `REBASE_PROVISION_ONLY=true`, collegandoti con un ruolo autorizzato a creare oggetti nel database. `REBASE_PROVISION_SQL_OUT` salva ogni modifica allo schema apportata dall'esecuzione sotto forma di script SQL:

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

L'immagine viene eseguita con `NODE_ENV=production`, quindi questo processo è soggetto agli stessi controlli ambientali del server, inclusi `CORS_ORIGINS` o `FRONTEND_URL`, sebbene non serva alcun traffico.

Lo script è un resoconto (record), non un piano (plan): ogni istruzione in esso contenuta è stata eseguita con successo, nell'ordine specificato. Registrato a partire da un database vuoto, costituisce l'intero schema richiesto dalla release. Registrato su una copia ripristinata della produzione, rappresenta esattamente l'aggiornamento. I dati (le righe) scritti durante l'esecuzione non sono inclusi nello script. Esaminalo e poi applicalo al database reale:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f out/rebase.sql
```

Ripeti l'operazione per ogni aggiornamento di Rebase, prima del rolling restart dei processi che servono il traffico. Una release può aggiungere una tabella o una colonna, e un processo privo dei permessi di creazione segnalerà l'elemento come mancante invece di crearlo.

Un server compilato autonomamente segue la stessa regola: `initializeRebaseBackend` legge `REBASE_PROVISION`, e `createRebaseBackend` accetta [`provision: false`](/docs/backend/custom-server#what-creating-a-backend-may-change-provision).

## Archiviazione file (File storage)

Lo storage è **disattivato** a meno che non sia configurato un bucket, e questo per una precisa scelta progettuale: l'alternativa predefinita sarebbe il filesystem del container, che perderebbe silenziosamente ogni file caricato al riavvio successivo. I caricamenti vengono rifiutati con l'errore `501 STORAGE_NOT_CONFIGURED` finché non ne configuri uno.

Per configurare un bucket, imposta `STORAGE_TYPE=s3` (oppure `gcs`) insieme al nome del bucket e alle credenziali — il file compose elenca le variabili necessarie, commentate. `gcs` carica `@google-cloud/storage`, che non è incluso nell'immagine ufficiale; pertanto, con quell'immagine accedi a Google Cloud Storage tramite il suo endpoint compatibile S3 (`STORAGE_TYPE=s3`, `S3_ENDPOINT=https://storage.googleapis.com`, chiavi HMAC).

Per il disco locale, opzione appropriata solo se il percorso corrisponde a un vero volume che persiste oltre il ciclo di vita del container:

```yaml
      STORAGE_TYPE: local
      # Each declared bucket gets a directory beside this one, bucket("media")
      # /storage/uploads__media, so the volume goes on their parent.
      STORAGE_PATH: /storage/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - storage:/storage
```

In questo caso `FORCE_LOCAL_STORAGE` non è facoltativo: in produzione un backend `local` viene scartato anziché registrato, poiché l'alternativa porterebbe a upload completati con successo in un filesystem destinato alla distruzione. Questa variabile serve a confermare esplicitamente che il volume montato è persistente.

Monta il volume **a monte** di `STORAGE_PATH`, non direttamente su di esso. `STORAGE_PATH` è la directory del bucket predefinito, e ogni bucket dichiarato in `backend/resources.ts` ne ottiene una propria accanto ad esso, `<STORAGE_PATH>__<key>`. Un volume montato esattamente su `STORAGE_PATH` conterrà solo il bucket predefinito. Tutti gli altri bucket scriveranno sul filesystem del container, perdendo i file alla sua ricreazione. `STORAGE_PATH__MEDIA` può spostare un singolo bucket altrove nel volume. Non può tuttavia spostarlo all'interno della directory di un altro bucket (come ad esempio `/storage/uploads/media`), altrimenti il bucket predefinito ne elencherebbe, servirebbe ed eliminerebbe i file.

L'immagine crea `/storage` assegnandola all'utente non privilegiato `node` con cui viene eseguita, motivo per cui il volume va posizionato lì. Un volume montato dove l'immagine non possiede alcuna directory appartiene a root, provocando il fallimento di ogni upload con errore `EACCES`. Il file compose generato da `rebase init` adotta già questo schema di montaggio.

### Lo storage necessita di un modello di controllo accessi

Una volta configurato un bucket, il runtime **si rifiuta di avviarsi in produzione** finché il deployment non dichiara in che modo gli oggetti sono protetti. Lo storage non rientra nella row-level security e le sue chiavi condividono un singolo namespace piatto, quindi in assenza di regole l'unica cosa a separare i file di due utenti sarebbe l'imprevedibilità delle chiavi — che `GET /storage/list?prefix=` rende vana. Per soddisfare questo requisito è sufficiente uno qualsiasi dei seguenti elementi:

- un **hook `storageAuthorize`** (o `storagePolicies`) nella configurazione del progetto, che costituisce la soluzione ideale ed è ciò che lo scaffold include in `backend/storage.ts` — nessuna variabile d'ambiente può esprimere il concetto "questo utente può leggere questa chiave";
- **`STORAGE_PUBLIC_READ=true`**, per un bucket che funge a tutti gli effetti da CDN pubblica in sola lettura;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, per un'applicazione single-tenant in cui ogni account autenticato è autorizzato ad accedere a tutti i file.

Al di fuori della produzione questa stessa condizione genera un chiaro avviso nei log anziché un blocco dell'avvio; si tratta quindi di un errore di avvio che si riscontra in fase di deploy piuttosto che sulla propria macchina di sviluppo. È una scelta intenzionale: la vulnerabilità a cui si pone rimedio sarebbe altrimenti del tutto silenziosa.

Imposta anche `MFA_ENCRYPTION_KEY` se utilizzi TOTP. Se non configurata, i segreti memorizzati per l'autenticatore vengono crittografati con `JWT_SECRET` — di conseguenza, la rotazione di quest'ultimo non solo disconnetterà tutti gli utenti, *ma* renderà anche indecifrabili tutti i dispositivi registrati.

## Altre piattaforme

Il runtime è un normale container in ascolto su `$PORT`, quindi qualsiasi piattaforma in grado di eseguire container è adatta. Due aspetti fondamentali da impostare correttamente ovunque:

1. Il bundle deve essere presente in `/bundle` (o nel percorso a cui punta `REBASE_BUNDLE`), con le relative dipendenze installate al suo fianco — vedi [Dipendenze](#dipendenze).
2. Imposta `CORS_ORIGINS`, `JWT_SECRET` e `DATABASE_URL`. In produzione il runtime si rifiuta di avviarsi senza queste variabili invece di tirare a indovinare.

### Fly.io

```toml
[build]
  dockerfile = "Dockerfile"   # FROM rebasepro/server:0.30.1 + COPY dist-bundle /bundle

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Usa il formato con immagine derivata sopra indicato in modo che il bundle venga distribuito insieme all'app, quindi esegui `fly deploy`.

### Railway / Render

Punta il servizio all'immagine derivata, configura le variabili d'ambiente e imposta il percorso per l'health check su `/livez`.

### Un semplice VPS

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` elenca le variabili che riconosce. Con systemd:

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

`NODE_ENV=production` non è una formalità. Se omesso, il processo viene eseguito in modalità di sviluppo: accetta le origini localhost, serve le specifiche OpenAPI e **lascia aperta la finestra del primo amministratore** — permettendo al primo sconosciuto che raggiunge il form di registrazione di diventare amministratore. Le due righe `REBASE_ADMIN_*` sostituiscono tale finestra; vedi [Your first admin](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` serve perché il database si trova sulla stessa macchina. In produzione il runtime rifiuta qualsiasi variabile che punti a localhost — in un container il loopback corrisponde al container stesso, perciò quell'indirizzo è quasi sempre un errore — e questa opzione serve a confermare che l'indirizzo è intenzionale. Rimuovila se il database viene eseguito altrove.

Preferisci `EnvironmentFile=/etc/rebase.env` con permessi 0600 rispetto alle direttive `Environment=` per i segreti: un file unit è leggibile da chiunque (world-readable) e `systemctl show` stampa in chiaro tutti i valori definiti in `Environment=`.

## Pool di connessioni (Connection pooling)

Il runtime gestisce un pool di connessioni ridotto e a lunga durata e non richiede un pooler. Ciò che invece ne ha bisogno è tutto il resto che comunica con lo stesso database e non può mantenere una connessione persistente: funzioni serverless, script pianificati, strumenti di BI, worker di code che scalano fino a cinquanta istanze. Il parametro `max_connections` di Postgres è un limite rigido nell'ordine di poche centinaia e ogni connessione è un *processo*, quindi un fan-out di funzioni lambda può esaurirlo molto prima che il database sia effettivamente sotto carico.

Il file compose include un servizio `pgbouncer` per questo tipo di traffico, associato a un profile in modo che un deployment privo di tali client non esegua un processo superfluo:

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

L'autenticazione del client viene generata all'avvio a partire da `DATABASE_URL`, evitando di dover scrivere la password due volte. Il pooler si autentica su Postgres con `scram-sha-256`, supportato e memorizzato da Postgres 18 — il valore predefinito `md5` dell'immagine provocherebbe il fallimento del login al *server* con `FATAL: server login failed: wrong password type`, errore che somiglia a una password errata pur non essendolo.

Assicurati che la somma dei valori di `PGBOUNCER_POOL_SIZE` di tutti i pooler rimanga abbondantemente al di sotto del valore di `max_connections` del database: il runtime attinge dallo stesso limite.

### Cosa cambia con il transaction pooling

Un client che utilizza il pool trattiene una connessione al server solo per la durata di una transazione per poi rilasciarla: è questo meccanismo che consente a 500 client di condividere 20 connessioni. Tre funzionalità smettono di funzionare attraverso questa porta, ed entrambe sono usate da Rebase stesso — motivo per cui il runtime si connette direttamente e questa porta è riservata agli altri client:

- **`LISTEN`/`NOTIFY`.** Le funzionalità Realtime si basano su questo, e un listener richiede una connessione che sopravviva alla singola transazione. Il comando `LISTEN` viene *accettato* dal pooler — che risponde a `LISTEN`, ma successivamente non inoltra alcuna notifica.
- **Stato di sessione**: `SET` (a differenza di `SET LOCAL`), advisory lock mantenuti tra istruzioni diverse, cursori `WITH HOLD`, tabelle temporanee. La transazione successiva potrebbe finire su una connessione al server differente, che non avrà visibilità di nessuno di questi elementi. Entrambi falliscono nello stesso modo subdolo: con un unico client inattivo lo stato solitamente rimane presente, funzionando durante i test ma smettendo di funzionare sotto quel livello di concorrenza per cui il pooler era stato introdotto.
- **Prepared statement a livello di protocollo.** La maggior parte dei driver può essere configurata per non usarli — node-postgres non li usa di default; asyncpg richiede `statement_cache_size=0`.

`SET LOCAL` ha visibilità limitata alla transazione e funziona correttamente; è proprio con questo comando che viene impostata la row-level security — pertanto la RLS si comporta in modo identico anche tramite la porta con pooling.

Lascia il profilo disattivato se nessun componente esterno al runtime si connette al database. Una porta inutilizzata rappresenta una superficie d'attacco superflua.

## Health check

| Path | Utilizzo |
| --- | --- |
| `/livez` | Liveness. Risponde a "questo processo è attivo?" senza interrogare il database. |
| `/health` | Readiness. Esegue un round-trip verso il database e riporta la latenza. |

Punta i liveness probe su `/livez`. Un liveness probe impostato su `/health` riavvierebbe un processo del tutto sano durante una breve instabilità del database, ottenendo l'effetto opposto a quello desiderato.

## Metriche

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Espone le metriche Prometheus all'endpoint `/metrics`: conteggio delle richieste e istogrammi di latenza suddivisi per superficie API (data, auth, storage, functions) e per tabella, oltre a gauge relativi al processo. Senza un token l'endpoint è leggibile da chiunque possa raggiungere la porta, pertanto impostane uno a meno che non ci si trovi all'interno di una rete privata.

`rebase_db_pool_wait_ms` è un istogramma che misura il tempo di attesa di ciascuna query per ottenere una connessione dal pool del database, inclusa l'eventuale apertura di una nuova connessione, etichettato con la chiave del data source (`source="(default)"` nei progetti che non dichiarano data source). In un pool sano questo valore si mantiene prossimo allo zero. Una coda (tail) che cresce all'aumentare del traffico indica che le richieste sono in coda in attesa di connessioni — nella maggior parte dei casi trattenute da hook di scrittura che attendono operazioni lente; vedi [A hook holds a connection](/docs/collections/context-data-api/#a-hook-holds-a-connection).

Il database stesso, per ciascun data source:

| Metrica | Cosa indica |
|--------|--------------|
| `rebase_db_pool_connections`, `rebase_db_pool_idle`, `rebase_db_pool_waiting` | Connessioni di ciascun pool, etichettate con `pool="primary"`, `"read"` (la replica) o `"session"` (il pool diretto della console SQL dietro a un pooler). Un valore di `waiting` superiore a zero per un periodo prolungato indica un pool troppo piccolo per il carico di lavoro. |
| `rebase_db_connection_errors_total` | Richieste che hanno risposto con 503 a causa della mancanza di connessioni, raggruppate per `code`: `53300` / `53400` (il server ha esaurito le connessioni), `pool_exhausted`, `connect_timeout`, `unreachable`. |
| `rebase_db_connections` | Connessioni client sul server, per `state`, a confronto con `rebase_db_max_connections`. |
| `rebase_db_size_bytes` | La dimensione del database. |
| `rebase_db_replica_lag_seconds` | Il ritardo di allineamento di `DATABASE_READ_URL` rispetto al primario. |

Gli ultimi quattro valori vengono campionati ogni 30 secondi sulla connessione interna dell'istanza, così che uno scrape non si trasformi mai in una query al database.

`rebase_realtime_*` riporta i socket aperti, i canali e i frame inviati al channel bus o trattenuti da ciascuna istanza: vedi [Seeing what the bus does](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Header di sicurezza

Ogni risposta include `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` e `Strict-Transport-Security: max-age=15552000` (180 giorni). L'header HSTS omette volutamente `includeSubDomains`: tale direttiva indicherebbe ai browser di rifiutare l'HTTP in chiaro su qualsiasi sottodominio del tuo dominio, compresi quelli con cui questo server non ha nulla a che fare, e il browser manterrebbe questa regola per l'intera durata specificata nell'header. Imposta `REBASE_HSTS_INCLUDE_SUBDOMAINS=true` quando tutti i sottodomini supportano esclusivamente HTTPS.

`strict-origin-when-cross-origin` è il comportamento predefinito dei browser: una richiesta verso un altro sito include la tua origine e mai il percorso (path) o la query della pagina. Non viene utilizzato `no-referrer` perché i controlli di origine necessitano dell'origine stessa — il pulsante di accesso con Google la confronta con le origini JavaScript autorizzate del client OAuth, e con `no-referrer` rispondeva "The given origin is not allowed for the given client ID" su qualsiasi applicazione, a prescindere da cosa autorizzasse il client. Una risposta che imposta una propria policy la preserva (la pagina di consenso MCP invia `no-referrer`); una pagina che richiede criteri più restrittivi può specificarlo con `<meta name="referrer" content="no-referrer">`. `X-Frame-Options` funziona allo stesso modo: `SAMEORIGIN` a meno che la risposta non ne imposti una propria, come fa la pagina di consenso MCP con `DENY`.

Le applicazioni statiche — l'amministrazione del CMS e qualsiasi frontend servito dal bundle — includono inoltre `Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri 'self'`. Questa policy determina chi può incorporare (frame) l'applicazione, esclude i plugin e vincola `<base>` alla tua origine senza limitare nient'altro, permettendo a script inline, worker e accessi di terze parti di continuare a funzionare. Una risposta che definisce una propria policy la mantiene. Per requisiti più restrittivi, applica la policy sul reverse proxy a monte.

## Più di un'istanza

Un singolo container rappresenta la configurazione standard e non richiede altro. Prima che una seconda replica inizi a ricevere traffico — o prima che un rolling deploy ne esegua due affiancate — consulta [Running more than one instance](/docs/deployment/multiple-instances/): rate limit, broadcast channel, file locali, upload ripristinabili (resumable) e cache delle immagini sono legati al singolo processo finché non viene configurata un'impostazione per condividerli.

## Connettere Claude

Un singolo comando aggiunge questo server al [Rebase connector](/docs/ai/rebase-connector/), il connettore MCP unificato che permette a Claude di accedere a tutti i tuoi progetti:

```bash
rebase cloud connect https://your-app.com
```

Imposta su questo server le due variabili restituite dal comando e riavvialo. Il server deve eseguire Rebase 0.28.1 o versione successiva e rispondere via HTTPS su un indirizzo pubblico. Non cambia nient'altro: non conserva alcun segreto e concede al connettore gli stessi privilegi concessi da Studio.

## Esecuzione di funzioni in un processo dedicato

Tutte le istruzioni precedenti considerano un unico container che serve l'intero progetto, configurazione ideale per la quasi totalità dei deployment. Quando una custom function non deve più competere con la data API per l'event loop — o quando necessita di scalare, riavviarsi o fallire in modo isolato — la stessa immagine e lo stesso bundle possono essere avviati come processi distinti e cooperanti. Consulta [Split processes](/docs/deployment/split-processes/).

## Aggiornamento

```yaml
image: rebasepro/server:0.30.1
```

Riavvia. Il tuo bundle rimane invariato. All'interno della stessa versione major del contratto di runtime, un bundle validato continua a funzionare regolarmente — vedi [Compatibility](/docs/architecture/runtime-and-bundles/#compatibility).
