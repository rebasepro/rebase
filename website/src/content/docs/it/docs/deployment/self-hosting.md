---
sourceHash: 5490764f32356e9d
title: Self-Hosting
sidebar_label: Self-Hosting
description: Esegui Rebase ovunque con l'immagine di runtime ufficiale e il bundle del tuo progetto — Docker Compose, Fly, Railway o un semplice VPS.
---

## Panoramica

Fare self-hosting di Rebase significa eseguire due cose: un database Postgres e l'immagine ufficiale `rebasepro/server` con il bundle del tuo progetto montato al suo interno.

Non c'è **alcuna immagine dell'applicazione da compilare**. Il tuo progetto viaggia sotto forma di bundle, il runtime è già pubblicato e l'aggiornamento di Rebase consiste nel cambiare un tag anziché ricompilare. Consulta [Runtime and bundles](/docs/architecture/runtime-and-bundles/) per scoprire perché è suddiviso in questo modo.

## Docker Compose

**Se il tuo progetto è stato creato con `rebase init`, usa il suo `docker-compose.yml`.** Si trova nel tuo repository, `init` ha già inserito i suoi secret, il suo primo account amministratore e la versione del runtime bloccata, ed è il file descritto in [Deployment](/docs/getting-started/deployment/#docker-compose-recommended):

```bash
rebase build
docker compose up -d
```

Il resto di questa pagina riguarda lo stesso deployment senza uno scaffold di base — il progetto di qualcun altro, un bundle compilato in CI o le due cose che il file generato omette deliberatamente: un connection pooler e le configurazioni a processi separati. Quel file si trova nel repository, su [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml). Usa quello invece di copiare uno snippet da questa pagina: entrambi i file vengono avviati dal gate di accettazione del progetto a ogni push, quindi nessuno dei due può divergere da ciò che funziona realmente.

I due file concordano su ogni variabile d'ambiente tranne la password del database, e questo perché ciascuno è pensato per il proprio autore: questo legge `POSTGRES_PASSWORD`, generata da `quickstart.sh`; quello generato legge `DATABASE_PASSWORD`, che `rebase init` include anche nella `DATABASE_URL` scritta nel tuo `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` è un unico comando che fa due cose ovvie e le stampa entrambe. La forma estesa, se preferisci gestire ogni singolo passaggio:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

Non occorre avviare il database separatamente — `api` attende il suo healthcheck.

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

Tre secret, un dato di fatto e l'account con cui accedi:

- **`POSTGRES_PASSWORD`** — la password del database. Modificarla in seguito significa modificarla anche nel volume, quindi sceglila una volta sola.
- **`JWT_SECRET`** — firma ogni sessione. Ruotarlo disconnette tutti gli utenti.
- **`REBASE_SERVICE_KEY`** — la credenziale che bypassa la row-level security per le chiamate server-to-server. Trattala come una password di root: chiunque la possieda può leggere ogni riga.
- **`CORS_ORIGINS`** — le origini da cui viene servito il tuo frontend, separate da virgola. Non è un secret e non è opzionale: in produzione il runtime si rifiuta di avviarsi senza di esso anziché tirare a indovinare, perché un'API che indovina le sue origini consentite prima o poi autorizza quella sbagliata.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — il primo amministratore. Un database nuovo non ha utenti, e al di fuori della produzione il criterio di registrazione accetta la prima registrazione e la promuove ad admin — altrimenti un database vuoto sarebbe un vicolo cieco, perché per inizializzare un amministratore serve un chiamante già autenticato. Nel momento in cui questo stack risponde su un hostname, tale comodità diventa una race condition che l'operatore può perdere, quindi in produzione questa finestra viene chiusa e l'account viene specificato qui. Il runtime lo crea una sola volta, quando la tabella degli utenti è vuota, e non fa nulla a ogni avvio successivo.

`JWT_SECRET` e `REBASE_SERVICE_KEY` devono contenere ciascuno almeno 32 caratteri, e la password di admin almeno 12. Usa un indirizzo con un punto nel dominio: `POST /auth/login` analizza il body con `z.string().email()`, quindi il runtime si rifiuta di creare `admin@localhost` — un account con cui nessuno potrebbe effettuare l'accesso — registrando invece il motivo nel log. Il file compose dichiara tutti e sei i parametri con `${VAR:?…}`, quindi l'assenza di uno di essi arresta lo stack con un messaggio indicante il valore mancante invece di avviare qualcosa di configurato a metà — e l'auto-registrazione è disattivata per impostazione predefinita (`DISABLE_SELF_REGISTRATION`, default `true`), quindi non rimane nulla da riscattare.

Accedi con queste credenziali e modifica la password: sono memorizzate in chiaro in un file sull'host.

## Dipendenze

Per impostazione predefinita, `rebase build` **installa le dipendenze del tuo progetto nel bundle**, quindi `dist-bundle` include una cartella `node_modules` e un `package-lock.json` accanto al suo `package.json`. Un bundle vendored si avvia in circa cinque secondi.

Dato che sono già presenti, puoi montare il bundle in sola lettura — operazione consigliata, poiché un hook compromesso non potrà riscrivere il codice eseguito dopo il riavvio successivo:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` esclude questa opzione e produce un bundle che installa le sue dipendenze solo al primo avvio, richiedendo 40–60 secondi a ogni avvio e necessitando di un mount scrivibile.

Per un deployment reale, è preferibile includere entrambi in un'immagine, bloccando con precisione ciò che viene eseguito:

```dockerfile
FROM rebasepro/server:0.38.0
COPY dist-bundle /bundle
```

## Creazione dello schema

**Il runtime crea le tabelle mancanti all'avvio, comprese quelle dichiarate in `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` ha come valore predefinito `ensure`, che è additivo sull'intero schema: crea tabelle, colonne e tipi enum mancanti, e applica la loro row-level security. Un primo avvio su un database vuoto inizia a servire le tue tabelle senza alcun passaggio separato.

Ciò che `ensure` deliberatamente non fa mai è modificare ciò che esiste già. Non altera il tipo di una colonna, non elimina tabelle o colonne e non modifica le label di un enum esistente — perché il riavvio di un container non deve poter rimodellare uno schema come effetto collaterale di un deploy.

Pertanto vale comunque la pena eseguire `rebase db push` per ciò che l'avvio non tocca — qualsiasi modifica che non sia puramente additiva: una colonna rinominata, un tipo ristretto, un campo rimosso.

```bash
rebase db push
```

Eseguilo da un checkout o da un job di CI, puntando al database del deployment. Esegue prima una prova (dry-run) della modifica, rifiuta quelle distruttive in assenza di conferma esplicita e può effettuare un backup prima dell'applicazione. Il database pubblica una porta nel file compose affinché possa essere raggiunto dall'host; rimuovi tale mappatura una volta configurato lo schema se il database non deve essere raggiungibile dall'esterno.

`REBASE_MIGRATE_ON_BOOT` accetta `ensure` e `none`, e nient'altro — l'immagine **si rifiuta di avviarsi** se impostata su `push`, per il motivo spiegato sopra.

## Quando solo il tuo processo di change management può modificare il database

`REBASE_MIGRATE_ON_BOOT=none` non tocca le tue tabelle. Non lascia però intatto il database: le tabelle interne del framework (auth, chiavi API, job, cron) vengono comunque create e mantenute aggiornate a ogni avvio. Quando il database può essere modificato solo tramite un processo di modifica revisionato, imposta `REBASE_PROVISION=false` su ogni processo che serve traffico:

| Impostazione | Tabelle e policy dichiarate | Tabelle del framework |
|---|---|---|
| default (`REBASE_MIGRATE_ON_BOOT=ensure`) | create e mantenute aggiornate all'avvio | create e mantenute aggiornate |
| `REBASE_MIGRATE_ON_BOOT=none` | non toccate | create e mantenute aggiornate |
| `REBASE_PROVISION=false` | non toccate | non toccate; gli elementi mancanti vengono indicati nel log |

Con il provisioning disattivato, il runtime non crea né altera alcunché: nessuna tabella, colonna, indice, funzione, trigger, policy, ruolo o grant. Questo vale all'avvio e successivamente, comprese le tabelle che un processo di servizio creerebbe al primo utilizzo (chiavi di idempotenza, claim dei cron, contatori condivisi di rate limit). Si limita invece a leggere ciò che è presente:

- **Tabelle di autenticazione, o una colonna letta da auth, mancanti:** l'avvio si rifiuta e le elenca singolarmente.
- **Il ruolo di richiesta può accedere a una tabella del framework** come `rebase.refresh_tokens` o `rebase.api_keys`: l'avvio si rifiuta e stampa il comando `REVOKE` da eseguire. Un avvio con provisioning rimuove automaticamente tali privilegi. Con il provisioning disattivato, non lo fa nessuno.
- **Una tabella opzionale mancante** (chiavi API, chiavi di idempotenza, claim dei cron, contatori di rate limit, presence, storico metriche): tale funzionalità rimane disattivata e il log indica quale tabella è necessaria.
- **Una tabella dichiarata che il database non protegge** — row-level security disabilitata, nessuna delle policy dichiarate presente o una policy restrittiva dichiarata mancante: tale tabella non viene servita (una policy permissiva mancante viene servita, con un avviso di avvio che la specifica). Una richiesta per essa risponde con `503 TABLE_WITHHELD`, e il log di avvio indica l'SQL per proteggerla (o suggerisce `rebase db push`). Le altre tabelle vengono servite e l'avvio prosegue. Una tabella di giunzione many-to-many viene controllata allo stesso modo: una non protetta dal database blocca le tabelle le cui relazioni la utilizzano, e `TABLE_WITHHELD` indica la giunzione. Anche una tabella la cui relazione `via` passa attraverso una tabella bloccata viene bloccata a sua volta, e il messaggio specifica la relazione. Ciò vale anche con `REBASE_MIGRATE_ON_BOOT=none` e durante un aggiornamento a caldo dello schema. Una tabella il cui accesso è regolato direttamente dall'applicazione specifica `rlsRequired: false` per essere comunque servita ([come fare](/docs/deployment/existing-database/#another-tool-owns-the-schema-and-the-app-enforces-access)).

I record continuano a cambiare, come avverrebbe in qualsiasi database: accessi, sessioni, utilizzo delle chiavi API, chiavi di idempotenza, claim dei cron. Il primo account admin (`REBASE_ADMIN_EMAIL`) viene creato dall'esecuzione di provisioning, non dai processi di servizio. La [modifica dello schema dal vivo](/docs/backend/live-schema-editing) può comunque effettuare il commit di una modifica nel codice sorgente, ma si rifiuta di applicarla al database.

### L'esecuzione di provisioning

Lo schema proviene da un'esecuzione controllata dal tuo processo di change management. Usa la stessa immagine e lo stesso bundle del server, con `REBASE_PROVISION_ONLY=true`, effettuando la connessione con un ruolo che dispone dei permessi di creazione nel database. `REBASE_PROVISION_SQL_OUT` salva ogni modifica allo schema apportata dall'esecuzione sotto forma di script SQL:

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

L'immagine viene eseguita con `NODE_ENV=production`, quindi questa esecuzione è soggetta agli stessi controlli d'ambiente del server, inclusi `CORS_ORIGINS` o `FRONTEND_URL`, anche se non serve traffico.

Lo script è una registrazione, non un piano: ogni istruzione in esso contenuta è stata eseguita con successo, in ordine. Registrato su un database vuoto, rappresenta l'intero schema richiesto dalla release. Registrato su una copia ripristinata della produzione, rappresenta esattamente l'aggiornamento. Le righe scritte durante l'esecuzione non sono incluse. Esaminalo, quindi applicalo al database reale:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f out/rebase.sql
```

Ripeti la procedura per ogni aggiornamento di Rebase, prima del rolling update dei processi di servizio. Una nuova release può aggiungere una tabella o una colonna, e un processo che non ha i permessi per crearla ne segnalerà l'assenza anziché crearla.

Un server creato da te segue la stessa regola: `initializeRebaseBackend` legge `REBASE_PROVISION` e `createRebaseBackend` accetta [`provision: false`](/docs/backend/custom-server#what-creating-a-backend-may-change-provision).

## Archiviazione dei file

Lo storage è **disattivato** a meno che non sia configurato un bucket, e questo è intenzionale: l'alternativa predefinita sarebbe il filesystem del container, che perderebbe silenziosamente ogni file caricato al riavvio successivo. I caricamenti vengono rifiutati con `501 STORAGE_NOT_CONFIGURED` finché non ne configuri uno.

Per un bucket, imposta `STORAGE_TYPE=s3` (oppure `gcs`), oltre al relativo bucket e alle credenziali — il file compose elenca le variabili, commentate. `gcs` carica `@google-cloud/storage`, che non è incluso nell'immagine ufficiale; pertanto, su tale immagine, accedi a Google Cloud Storage tramite il suo endpoint compatibile con S3 (`STORAGE_TYPE=s3`, `S3_ENDPOINT=https://storage.googleapis.com`, chiavi HMAC).

Per il disco locale, opzione adatta solo se il percorso corrisponde a un volume reale che sopravvive al container:

```yaml
      STORAGE_TYPE: local
      # Each declared bucket gets a directory beside this one, bucket("media")
      # /storage/uploads__media, so the volume goes on their parent.
      STORAGE_PATH: /storage/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - storage:/storage
```

`FORCE_LOCAL_STORAGE` non è opzionale in questo caso: in produzione un backend `local` viene scartato anziché registrato, poiché l'alternativa sarebbe avere upload che vanno a buon fine in un filesystem destinato a essere distrutto. Questa variabile serve a dichiarare che il mount è persistente.

Monta il volume **al di sopra** di `STORAGE_PATH`, non esattamente su di esso. `STORAGE_PATH` è la directory del bucket predefinito, e ogni bucket dichiarato in `backend/resources.ts` ne ottiene una propria a fianco, `<STORAGE_PATH>__<key>`. Un volume montato direttamente su `STORAGE_PATH` conterrà solo il bucket predefinito. Tutti gli altri bucket scriveranno sul filesystem del container e perderanno i propri file alla ricreazione del container. `STORAGE_PATH__MEDIA` può spostare un singolo bucket altrove sul volume. Non può tuttavia spostarlo all'interno della directory di un altro bucket, come `/storage/uploads/media`, perché in tal caso il bucket predefinito ne elencherebbe, servirebbe ed eliminerebbe i file.

L'immagine crea `/storage` per l'utente non privilegiato `node` con cui viene eseguita, motivo per cui il volume va posizionato lì. Un volume montato dove l'immagine non ha una directory appartiene a root, e ogni caricamento fallisce con `EACCES`. Il file compose generato da `rebase init` lo monta in questo modo.

### Lo storage richiede un modello di controllo degli accessi

Una volta che un bucket **è** configurato, il runtime **si rifiuta di avviarsi in produzione** finché il deployment non specifica come sono protetti gli oggetti. Lo storage non è coperto dalla row-level security e le sue chiavi condividono un unico namespace piatto; quindi, senza alcuna regola, l'unica cosa a separare i file di due utenti è l'imprevedibilità delle chiavi — che `GET /storage/list?prefix=` vanifica. Una qualsiasi delle seguenti opzioni è sufficiente:

- un **hook `storageAuthorize`** (o `storagePolicies`) nella configurazione del tuo progetto, che è quanto fornito dallo scaffold in `backend/storage.ts`;
- **`STORAGE_POLICIES`**, le stesse regole in formato JSON — "owner" per una cartella per utente, ruoli per gli admin (consulta [Storage authorization](/docs/backend/storage-authorization/#as-data-storage_policies));
- **`STORAGE_PUBLIC_READ=true`**, per un bucket che è a tutti gli effetti un CDN pubblico in sola lettura;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, per un'applicazione single-tenant in cui ogni account autenticato è autorizzato ad accedere a qualsiasi file.

Al di fuori della produzione la stessa condizione produce un warning evidente anziché un blocco dell'avvio, quindi si tratta di un errore di boot che si riscontra durante il deploy anziché sul computer locale. È una scelta voluta: l'errore che sostituisce sarebbe altrimenti silenzioso.

Imposta anche `MFA_ENCRYPTION_KEY` se utilizzi TOTP. Se non impostata, i secret archiviati dell'autenticatore vengono crittografati con `JWT_SECRET` — quindi ruotarlo disconnetterà tutti gli utenti *e* renderà indecifrabili tutti i dispositivi registrati.

## Altre piattaforme

Il runtime è un normale container in ascolto su `$PORT`, quindi qualsiasi ambiente in grado di eseguire container funziona. Due cose da configurare correttamente ovunque:

1. Il bundle deve essere presente su `/bundle` (o dove punta `REBASE_BUNDLE`), con le relative dipendenze installate al suo fianco — consulta [Dipendenze](#dipendenze).
2. Imposta `CORS_ORIGINS`, `JWT_SECRET` e `DATABASE_URL`. In produzione il runtime si rifiuta di avviarsi senza di essi anziché tirare a indovinare.

### Fly.io

```toml
[build]
  dockerfile = "Dockerfile"   # FROM rebasepro/server:0.38.0 + COPY dist-bundle /bundle

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Usa la forma con immagine derivata vista sopra, così che il bundle venga distribuito insieme all'app, quindi esegui `fly deploy`.

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

`NODE_ENV=production` non è una formalità. Se omesso, il processo viene eseguito in modalità di sviluppo: accetta le origini localhost, serve la specifica OpenAPI e **lascia aperta la finestra del primo amministratore** — cosicché il primo sconosciuto a trovare il modulo di registrazione diventa l'amministratore. Le due righe `REBASE_ADMIN_*` sono ciò che chiude e sostituisce tale finestra; consulta [Your first admin](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` è presente perché il database si trova sulla stessa macchina. In produzione il runtime rifiuta qualsiasi variabile che punti a localhost — in un container, il loopback è il container stesso, quindi quell'indirizzo è sempre un errore — e questa riga indica che l'indirizzo è intenzionale. Rimuovila quando il database viene eseguito altrove.

Preferisci `EnvironmentFile=/etc/rebase.env` con permessi file a 0600 rispetto alle righe `Environment=` per i secret: un unit file è leggibile da chiunque nel sistema e `systemctl show` stampa ogni valore di `Environment=`.

## Connection pooling

Il runtime gestisce un proprio piccolo pool e non necessita di un pooler esterno. Per tutto ciò che comunica con lo stesso database e non può mantenere una connessione aperta — funzioni serverless, script pianificati, worker scalati orizzontalmente — il file compose include un servizio `pgbouncer` sotto il profilo `pooler`. Consulta [Connection pooling](/docs/deployment/connection-pooling/).

## Health check

| Percorso | Scopo |
| --- | --- |
| `/livez` | Liveness. Risponde a "questo processo è attivo?" senza toccare il database. |
| `/health` | Readiness. Esegue un round-trip verso il database e riporta la latenza. |

Punta i probe di liveness su `/livez`. Un probe di liveness su `/health` riavvierebbe un processo perfettamente funzionante durante un temporaneo singhiozzo del database, sortendo l'effetto contrario a quello desiderato.

## Metriche

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Espone le metriche di Prometheus su `/metrics`: conteggio delle richieste e istogrammi di latenza suddivisi per superficie API (data, auth, storage, functions) e per tabella, oltre a gauge del processo. Senza un token, l'endpoint è accessibile a chiunque possa raggiungere la porta, quindi impostane uno a meno che non ci si trovi su una rete privata.

`rebase_db_pool_wait_ms` è un istogramma del tempo di attesa di ciascuna query per una connessione dal pool del database, inclusa l'apertura di una nuova, etichettato per chiave della sorgente dati (`source="(default)"` in un progetto che non dichiara sorgenti dati). Un pool in salute lo mantiene vicino allo zero. Una coda che cresce con il traffico indica che le richieste sono in coda in attesa di connessioni — nella maggior parte dei casi trattenute da hook di scrittura che attendono operazioni lente; consulta [A hook holds a connection](/docs/collections/context-data-api/#a-hook-holds-a-connection).

Il database stesso, per sorgente dati:

| Metrica | Descrizione |
|--------|--------------|
| `rebase_db_pool_connections`, `rebase_db_pool_idle`, `rebase_db_pool_waiting` | Connessioni di ciascun pool, etichettate con `pool="primary"`, `"read"` (la replica) o `"session"` (il pool diretto della console SQL dietro a un pooler). `waiting` superiore a zero per un tempo prolungato indica un pool troppo piccolo per il suo carico. |
| `rebase_db_connection_errors_total` | Richieste che hanno risposto 503 per mancanza di una connessione, per `code`: `53300` / `53400` (il server ha esaurito le connessioni), `pool_exhausted`, `connect_timeout`, `unreachable`. |
| `rebase_db_connections` | Connessioni client sul server, per `state`, confrontate con `rebase_db_max_connections`. |
| `rebase_db_size_bytes` | Dimensione del database. |
| `rebase_db_replica_lag_seconds` | Ritardo di `DATABASE_READ_URL` rispetto al primario. |

Le ultime quattro vengono campionate ogni 30 secondi sulla connessione dell'istanza stessa, così che uno scrape non si trasformi mai in una query.

`rebase_realtime_*` riporta i socket aperti di ciascuna istanza, i canali e i frame inviati al channel bus o trattenuti: consulta [Seeing what the bus does](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Header di sicurezza

Ogni risposta include `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` e `Strict-Transport-Security: max-age=15552000` (180 giorni). L'header HSTS tralascia `includeSubDomains`: ciò indicherebbe ai browser di rifiutare l'HTTP semplice su qualsiasi sottodominio del tuo dominio, inclusi quelli con cui questo server non ha nulla a che fare, e un browser lo mantiene memorizzato per tutta la durata specificata dall'header. Imposta `REBASE_HSTS_INCLUDE_SUBDOMAINS=true` quando tutti i sottodomini supportano esclusivamente HTTPS.

`strict-origin-when-cross-origin` è l'impostazione predefinita dei browser: una richiesta a un altro sito include la tua origine e mai il percorso della pagina o la query. Non è impostato su `no-referrer` perché i controlli dell'origine richiedono l'origine — il pulsante di accesso Google la confronta con le origini JavaScript autorizzate del client OAuth, e con `no-referrer` restituiva "The given origin is not allowed for the given client ID" in ogni applicazione, a prescindere da cosa consentisse il client. Una risposta che imposta una propria policy la mantiene (la pagina di consenso MCP invia `no-referrer`); una pagina che necessita di una policy più restrittiva può indicarlo con `<meta name="referrer" content="no-referrer">`. `X-Frame-Options` funziona allo stesso modo: `SAMEORIGIN` a meno che la risposta non ne imposti una propria, come fa la pagina di consenso MCP con `DENY`.

Le app statiche — l'admin del CMS e qualsiasi frontend servito dal bundle — includono anche `Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri 'self'`. Questo determina chi può incorporare l'app in un frame, esclude i plugin e fissa `<base>` alla tua origine, senza limitare nient'altro, consentendo il normale funzionamento di script inline, worker e accessi di terze parti. Una risposta che imposta una propria policy la mantiene. Per regole più restrittive, applica la policy sul reverse proxy a monte.

### Consentire a un'altra origine di incorporare un'app in un frame

`frame-ancestors 'self'` indica che solo una pagina appartenente alla stessa origine dell'applicazione può incorporarla in un iframe. Un CMS su `admin.example.com` che mostra un'anteprima del sito su `www.example.com` richiede che il sito lo consenta, configurando `frameAncestors` nell'app del sito in `rebase.json`:

```jsonc
"site": {
  "type": "static", "root": "site", "output": "site/dist", "path": "https://www.example.com",
  "frameAncestors": ["https://admin.example.com"]
}
```

Il sito viene quindi servito con `frame-ancestors 'self' https://admin.example.com`, così come qualsiasi [route](/docs/architecture/apps-and-repositories/#serving-a-function-at-a-path-on-an-app) del sito la cui funzione non invii una propria policy. Le altre app mantengono `'self'`. `X-Frame-Options: SAMEORIGIN` viene comunque inviato a fianco; un browser che interpreta `frame-ancestors` ignora `X-Frame-Options`, come previsto dalle specifiche CSP.

Ogni voce corrisponde a un'origine, scritta esattamente: `https://` con un hostname e una porta opzionale, oppure `http://` per `localhost`, `127.0.0.1` e `[::1]` durante lo sviluppo. Non ci sono caratteri jolly, percorsi o parole chiave — `'self'` è sempre presente nell'elenco, e qualsiasi altra cosa viene rifiutata dalla CLI e nuovamente dal runtime prima di raggiungere l'header. Nulla è consentito a meno che non venga indicato esplicitamente.

## Più di un'istanza

Un unico container è la configurazione predefinita e non necessita di altro. Prima che una seconda replica riceva traffico — o che un rolling deploy ne esegua due affiancate — consulta [Running more than one instance](/docs/deployment/multiple-instances/): rate limit, canali di broadcast, file locali, upload ripristinabili e la cache delle immagini sono per-processo finché un'impostazione non li condivide.

## Connessione a Claude

Un unico comando aggiunge questo server al [Rebase connector](/docs/ai/rebase-connector/), il connettore MCP univoco che raggiunge tutti i tuoi progetti da Claude:

```bash
rebase cloud connect https://your-app.com
```

Imposta su questo server le due variabili stampate a video e riavvialo. Il server deve eseguire Rebase 0.28.1 o successivo e rispondere via https su un indirizzo pubblico. Non cambia nient'altro: non conserva alcun secret e concede al connettore gli stessi permessi concessi da Studio.

## Esecuzione delle funzioni in un processo dedicato

Tutto quanto descritto sopra prevede un unico container che serve l'intero progetto, che è la configurazione adatta per quasi tutti i deployment. Quando una custom function non deve più competere con la data API per l'event loop — o deve poter scalare, riavviarsi e fallire in modo indipendente — la stessa immagine e lo stesso bundle possono essere avviati come diversi processi cooperanti. Consulta [Split processes](/docs/deployment/split-processes/).

## Aggiornamento

```yaml
image: rebasepro/server:0.38.0
```

Riavvia. Il tuo bundle rimane invariato. All'interno della stessa major version del contratto di runtime, un bundle validato continua a funzionare — consulta [Compatibility](/docs/architecture/runtime-and-bundles/#compatibility).
