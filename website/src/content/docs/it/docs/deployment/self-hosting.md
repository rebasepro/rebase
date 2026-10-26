---
sourceHash: 7368bcbe77416455
title: Self-Hosting
sidebar_label: Self-Hosting
description: Esegui Rebase ovunque con l'immagine di runtime ufficiale e il bundle del tuo progetto — Docker Compose, Fly, Railway o un semplice VPS.
---

## Panoramica

Effettuare il self-hosting di Rebase significa eseguire due cose: un database Postgres e l'immagine ufficiale `rebasepro/server` con il bundle del tuo progetto montato al suo interno.

Non c'è **alcuna immagine dell'applicazione da compilare**. Il tuo progetto viaggia come un bundle, il runtime viene pubblicato e l'aggiornamento di Rebase consiste in un cambio di tag piuttosto che in una ricompilazione. Consulta [Runtime and bundles](/docs/architecture/runtime-and-bundles/) per comprendere il motivo di questa separazione.

## Docker Compose

**Se il tuo progetto proviene da `rebase init`, usa il suo `docker-compose.yml`.**
Si trova nel tuo repository, `init` ha già compilato i suoi segreti, il suo primo account amministratore e la versione bloccata del runtime; è il file descritto in [Deployment](/docs/getting-started/deployment/#docker-compose-recommended):

```bash
rebase build
docker compose up -d
```

Il resto di questa pagina descrive la stessa distribuzione senza uno scaffold preesistente: il progetto di qualcun altro, un bundle compilato in CI, o le due configurazioni che il file generato tralascia deliberatamente: un connection pooler e le architetture a processi separati. Quel file si trova nel repository, su [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml). Usa quello invece di copiare uno snippet da questa pagina: entrambi i file vengono testati dall'acceptance gate del progetto a ogni push, quindi nessuno dei due rischia di non funzionare.

I due file concordano su ogni variabile d'ambiente eccetto la password del database, e questo perché ciascuno è scritto per il proprio generatore: questo legge `POSTGRES_PASSWORD`, generata da `quickstart.sh`; quello generato legge `DATABASE_PASSWORD`, che `rebase init` inserisce anche nel `DATABASE_URL` scritto nel tuo `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` è un unico comando che esegue due operazioni intuitive mostrandole a schermo. La forma estesa, se preferisci gestire ogni passaggio manualmente:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

Non è necessario avviare il database separatamente: `api` attende il completamento del suo healthcheck.

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

Tre segreti, un dato di configurazione e l'account con cui effettuare l'accesso:

- **`POSTGRES_PASSWORD`** — la password del database. Modificarla in seguito richiede di aggiornarla anche nel volume, quindi sceglila con attenzione fin dall'inizio.
- **`JWT_SECRET`** — firma ogni sessione. La sua rotazione disconnette tutti gli utenti.
- **`REBASE_SERVICE_KEY`** — la credenziale che scavalca la row-level security per le chiamate server-to-server. Trattala come una password di root: chiunque la possieda può leggere ogni riga.
- **`CORS_ORIGINS`** — le origini da cui viene servito il frontend, separate da virgola. Non è un segreto e non è opzionale: il runtime rifiuta di avviarsi in produzione senza questo valore invece di tirare a indovinare, perché un'API che tenta di indovinare le origini consentite prima o poi autorizzerà quella sbagliata.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — il primo amministratore. Un database appena creato non ha utenti e, al di fuori dell'ambiente di produzione, la policy di registrazione accetta la prima iscrizione promuovendola ad admin — altrimenti un database vuoto sarebbe un vicolo cieco, poiché l'inizializzazione di un admin richiede un chiamante già autenticato. Nel momento in cui questo stack risponde su un hostname pubblico, tale comodità diventa una race condition che l'operatore può perdere; perciò, in produzione la finestra viene chiusa e l'account viene definito qui. Il runtime lo crea una sola volta, quando la tabella utenti è vuota, e non compie alcuna azione a ogni avvio successivo.

Ciascuno dei tre segreti deve essere lungo almeno 32 caratteri, e la password di admin almeno 12. Usa un indirizzo con un punto nel dominio: `POST /auth/login` valida il corpo della richiesta con `z.string().email()`, quindi `admin@localhost` creerebbe un account rifiutando poi qualsiasi tentativo di accesso. Il file compose dichiara tutti e sei i parametri con `${VAR:?…}`, di conseguenza un valore mancante arresterà lo stack con un messaggio esplicativo invece di avviare un'istanza configurata a metà — inoltre l'auto-registrazione è disattivata di default (`DISABLE_SELF_REGISTRATION`, default `true`), impedendo a terzi di appropriarsi dell'account.

Accedi con queste credenziali e cambia la password: sono memorizzate in chiaro in un file sull'host.

## Dipendenze

`rebase build` **installa le dipendenze del progetto all'interno del bundle** per impostazione predefinita, quindi `dist-bundle` include `node_modules` e un file `package-lock.json` accanto al suo `package.json`. Un bundle con dipendenze incluse (vendored) si avvia in circa cinque secondi.

Poiché sono già presenti, puoi montare il bundle in sola lettura — una pratica consigliata, poiché un hook compromesso non potrà così riscrivere il codice eseguito al riavvio successivo:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` disattiva questo comportamento e genera un bundle che installa invece le proprie dipendenze al primo avvio; questa operazione richiede 40–60 secondi per avvio e necessita che il mount sia scrivibile.

Per un ambiente di produzione reale, è preferibile incorporare entrambi in un'immagine, bloccando con precisione ciò che viene eseguito:

```dockerfile
FROM rebasepro/server:0.25.1
COPY dist-bundle /bundle
```

## Creazione dello schema

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle delle tue collection.**
`REBASE_MIGRATE_ON_BOOT` è impostato di default su `ensure`, che opera in modo additivo sull'intero schema: crea tabelle, colonne e tipi enum mancanti, applicando la relativa row-level security. Un primo avvio su un database vuoto sarà subito pronto a servire le tue collection, senza passaggi aggiuntivi.

Ciò che `ensure` deliberatamente non fa mai è modificare elementi già esistenti. Non altera il tipo di una colonna, non rimuove tabelle o colonne e non modifica i valori di un enum esistente — perché il riavvio di un container non deve poter alterare uno schema come effetto collaterale di un deploy.

Pertanto, vale comunque la pena eseguire `rebase db push` per ciò che l'avvio non tocca — qualsiasi modifica che non sia puramente additiva: una colonna rinominata, un tipo reso più restrittivo, un campo rimosso.

```bash
rebase db push
```

Eseguilo da una copia locale del repository o da un job di CI, puntando al database dell'ambiente di produzione. Il comando esegue prima una simulazione (dry-run), rifiuta modifiche distruttive in assenza di conferma esplicita e può effettuare un backup prima dell'applicazione. Il database espone una porta nel file compose per permettere a questo comando di raggiungerlo dall'host; rimuovi tale mappatura una volta impostato lo schema se il database non deve essere accessibile dall'esterno.

`REBASE_MIGRATE_ON_BOOT` accetta solo `ensure` e `none` — l'immagine **rifiuta l'avvio** se impostata su `push`, per il motivo sopra indicato.

## Archiviazione file

L'archiviazione è **disattivata** a meno che non sia configurato un bucket, e questo è intenzionale: l'alternativa predefinita sarebbe il filesystem del container, che perderebbe silenziosamente ogni file caricato al riavvio successivo. I caricamenti vengono rifiutati con `501 STORAGE_NOT_CONFIGURED` finché non ne configuri uno.

Per un bucket, imposta `STORAGE_TYPE=s3` (o `gcs`) insieme al relativo bucket e alle credenziali — il file compose elenca le variabili, commentate.

Per il disco locale, appropriato solo quando il percorso corrisponde a un volume reale persistente che sopravvive al container:

```yaml
      STORAGE_TYPE: local
      # Each declared bucket gets a directory beside this one, bucket("media")
      # /storage/uploads__media, so the volume goes on their parent.
      STORAGE_PATH: /storage/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - storage:/storage
```

`FORCE_LOCAL_STORAGE` non è opzionale in questo caso: in produzione un backend `local` viene scartato anziché registrato, per evitare caricamenti a buon fine su un filesystem destinato a essere distrutto. La variabile serve a confermare esplicitamente che il mount è persistente.

Monta il volume **sopra** `STORAGE_PATH`, non direttamente su di esso. `STORAGE_PATH` è la directory del bucket predefinito, e ogni bucket dichiarato in `config/resources.ts` ne riceve una propria affiancata, `<STORAGE_PATH>__<key>`. Un volume montato esattamente su `STORAGE_PATH` conterrà solo il bucket predefinito. Tutti gli altri bucket scriveranno sul filesystem del container e perderanno i propri file alla ricreazione dello stesso. `STORAGE_PATH__MEDIA` può spostare un singolo bucket altrove nel volume. Non può tuttavia spostarlo all'interno della directory di un altro bucket (come `/storage/uploads/media`), poiché il bucket predefinito ne elencherebbe, servirebbe ed eliminerebbe i file.

L'immagine crea `/storage` per l'utente non privilegiato `node` con cui viene eseguita, motivo per cui il volume va posizionato lì. Un volume montato dove l'immagine non possiede alcuna directory appartiene a root, e ogni caricamento fallirà con `EACCES`. Il file compose generato da `rebase init` lo monta in questo modo.

### Lo storage necessita di un modello di controllo degli accessi

Una volta configurato un bucket, il runtime **rifiuta di avviarsi in produzione** finché la distribuzione non specifica come sono protetti gli oggetti. Lo storage non rientra nella row-level security e le sue chiavi condividono un unico namespace piatto; senza regole, l'unico elemento a separare i file di due utenti è l'imprevedibilità delle chiavi — vanificata da `GET /storage/list?prefix=`. Una qualsiasi delle seguenti opzioni soddisfa questo requisito:

- un **hook `storageAuthorize`** (o `storagePolicies`) nella configurazione del tuo progetto, che rappresenta la soluzione corretta ed è ciò che lo scaffold fornisce in `config/storage.ts` — nessuna variabile d'ambiente può esprimere "questo utente può leggere questa chiave";
- **`STORAGE_PUBLIC_READ=true`**, per un bucket che è a tutti gli effetti un CDN pubblico in sola lettura;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, per un'app single-tenant in cui ogni account autenticato è autorizzato ad accedere a qualsiasi file.

Al di fuori dell'ambiente di produzione la medesima condizione genera un semplice avviso invece di bloccare l'esecuzione; si tratta quindi di un errore di avvio che si riscontra in fase di deploy e non durante lo sviluppo locale. È una scelta intenzionale: sostituisce un fallimento altrimenti silente.

Imposta anche `MFA_ENCRYPTION_KEY` se utilizzi TOTP. Se non configurata, i segreti dell'autenticatore memorizzati vengono cifrati con `JWT_SECRET` — pertanto la sua rotazione disconnetterà tutti gli utenti *e* renderà illeggibile qualsiasi dispositivo registrato.

## Altre piattaforme

Il runtime è un normale container in ascolto su `$PORT`, quindi qualsiasi servizio che esegue container è supportato. Due accorgimenti fondamentali ovunque:

1. Il bundle deve essere presente in `/bundle` (o nel percorso specificato da `REBASE_BUNDLE`), con le dipendenze installate al suo interno — vedi [Dipendenze](#dipendenze).
2. Imposta `CORS_ORIGINS`, `JWT_SECRET` e `DATABASE_URL`. Il runtime rifiuta di avviarsi in produzione in assenza di queste variabili.

### Fly.io

```toml
[build]
  image = "rebasepro/server:0.25.1"

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Usa la configurazione con immagine derivata vista in precedenza in modo che il bundle sia integrato nell'app, quindi esegui `fly deploy`.

### Railway / Render

Punta il servizio all'immagine derivata, configura le variabili d'ambiente e imposta il percorso dell'health check su `/livez`.

### Un semplice VPS

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` elenca le variabili che legge. Sotto systemd — le tre righe relative all'amministratore sono nuove; sulla versione 0.17.3 il primo account registrato diventa invece l'amministratore:

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

`NODE_ENV=production` non è decorativo. Se non impostato, il processo viene eseguito in modalità sviluppo: risponde alle origini localhost, serve la specifica OpenAPI e **lascia aperta la registrazione del primo admin** — consentendo al primo sconosciuto che raggiunge il form di iscrizione di diventare amministratore. Le due righe `REBASE_ADMIN_*` sostituiscono tale comportamento; consulta [Il tuo primo admin](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` è presente perché il database si trova sulla stessa macchina. In produzione, il runtime rifiuta qualsiasi variabile che punti a localhost — all'interno di un container, l'interfaccia di loopback coincide con il container stesso, rendendo tale indirizzo quasi sempre errato — e questa riga conferma che l'indirizzo è intenzionale. Rimuovila quando il database viene eseguito altrove.

È preferibile utilizzare `EnvironmentFile=/etc/rebase.env` con permessi `0600` piuttosto che le righe `Environment=` per i segreti: un file di unit è leggibile da chiunque nel sistema e `systemctl show` mostra in chiaro ogni valore `Environment=`.

## Connection pooling

Il runtime mantiene un pool di connessioni ridotto e a lunga durata, non necessitando di un pooler. Ciò che ne ha bisogno è tutto il resto che interagisce con lo stesso database senza poter mantenere una connessione persistente: funzioni serverless, script pianificati, strumenti di BI o worker di code che scalano fino a decine di istanze. Il parametro `max_connections` di Postgres è un limite rigido che si aggira intorno a poche centinaia e ogni connessione è un *processo*, quindi un'ondata di lambda può esaurirlo molto prima che il database sia saturo.

Il file compose include un servizio `pgbouncer` per questo traffico, isolato dietro un profilo per evitare che distribuzioni prive di tali carichi eseguano un processo superfluo:

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

L'autenticazione del client viene generata da `DATABASE_URL` all'avvio, evitando di dover scrivere la password due volte. Il pooler si autentica su Postgres con `scram-sha-256`, utilizzato da Postgres 18 — il default `md5` dell'immagine farebbe fallire il login al *server* con `FATAL: server login failed: wrong password type`, che sembra un errore di password errata pur non essendolo.

Mantieni la somma di `PGBOUNCER_POOL_SIZE` di tutti i pooler ampiamente al di sotto del `max_connections` del database — il runtime attinge dallo stesso limite.

### Cosa cambia con il transaction pooling

Un client collegato tramite pool impegna una connessione al server solo per la durata di una transazione, rilasciandola subito dopo; questo permette a 500 client di condividere 20 connessioni. Tre funzionalità smettono di funzionare attraverso quella porta, e ciascuna di esse è utilizzata da Rebase stesso — motivo per cui il runtime si connette direttamente e questa porta è riservata ad altri chiamanti:

- **`LISTEN`/`NOTIFY`.** Il sistema Realtime si basa su questo, e un listener richiede una connessione che sopravviva alla singola transazione. Il comando `LISTEN` viene *accettato* dal pooler — risponde a `LISTEN`, ma nessuna notifica verrà mai recapitata.
- **Stato della sessione**: `SET` (a differenza di `SET LOCAL`), lock consultivi mantenuti tra più istruzioni, cursori `WITH HOLD`, tabelle temporanee. La transazione successiva potrebbe essere assegnata a una connessione differente del server, la quale non vedrà alcuno di questi stati. Entrambi i problemi falliscono in modo insidioso: con un solo client inattivo lo stato è spesso ancora presente, funzionando durante i test ma smettendo di funzionare sotto il livello di concorrenza per cui il pooler era stato introdotto.
- **Prepared statements a livello di protocollo.** Alla maggior parte dei driver si può indicare di non usarli — node-postgres non lo fa di default; asyncpg richiede `statement_cache_size=0`.

`SET LOCAL` ha visibilità limitata alla transazione e funziona regolarmente; è ciò che imposta la row-level security, pertanto la RLS opera in modo identico attraverso la porta del pooler.

Lascia il profilo disattivato se nessun servizio esterno al runtime si connette al database. Una porta inutilizzata rappresenta solo superficie d'attacco.

## Controlli di integrità (Health checks)

| Percorso | Scopo |
| --- | --- |
| `/livez` | Liveness. Risponde a "questo processo è vivo" senza interrogare il database. |
| `/health` | Readiness. Esegue un round-trip verso il database e riporta la latenza. |

Punta i probe di liveness su `/livez`. Un probe di liveness configurato su `/health` riavvierebbe un processo altrimenti sano durante una temporanea anomalia del database, ottenendo l'effetto opposto a quello desiderato.

## Metriche

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Espone metriche Prometheus su `/metrics`: conteggio delle richieste e istogrammi di latenza suddivisi per superficie API (data, auth, storage, functions) e collection, oltre a misurazioni del processo. Senza un token l'endpoint è accessibile a chiunque possa raggiungere la porta, pertanto impostane uno a meno che l'istanza non si trovi su una rete privata.

`rebase_db_pool_wait_ms` è un istogramma del tempo di attesa di ciascuna query per ottenere una connessione dal pool del database (inclusa la sua apertura), etichettato per chiave della sorgente dati (`source="(default)"` nei progetti che non dichiarano sorgenti dati). Un pool in salute mantiene questo valore vicino allo zero. Una coda che cresce con il traffico indica richieste in attesa di connessioni — nella maggior parte dei casi trattenute da callback di scrittura in attesa di operazioni lente; vedi [A callback holds a connection](/docs/collections/context-data-api/#a-callback-holds-a-connection).

## Header di sicurezza

Ogni risposta include `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` e `Strict-Transport-Security: max-age=15552000` (180 giorni). L'header HSTS omette `includeSubDomains`: includerlo imporrebbe ai browser di rifiutare il traffico HTTP su ogni sottodominio del tuo dominio, compresi quelli non gestiti da questo server, memorizzandolo per l'intera durata specificata.
Imposta `REBASE_HSTS_INCLUDE_SUBDOMAINS=true` quando tutti i sottodomini sono esclusivamente HTTPS; fino alla versione 0.23 inclusa, l'header conteneva sempre `includeSubDomains`.

`strict-origin-when-cross-origin` è il valore predefinito dei browser stessi: una richiesta verso un altro sito porta la tua origine e mai il percorso o la query della pagina. Non è `no-referrer` perché i controlli sull'origine hanno bisogno dell'origine: il pulsante di accesso con Google la confronta con le origini JavaScript autorizzate del client OAuth e, con `no-referrer`, rispondeva "The given origin is not allowed for the given client ID" su ogni app, qualunque cosa il client consentisse. Una risposta che imposta una propria policy la mantiene (la pagina di consenso MCP invia `no-referrer`); una pagina che ne vuole una più restrittiva può indicarlo con `<meta name="referrer" content="no-referrer">`. `X-Frame-Options` funziona allo stesso modo: `SAMEORIGIN`, a meno che la risposta non imposti un proprio valore, come fa la pagina di consenso MCP con `DENY`.

Le applicazioni statiche — l'admin CMS e qualsiasi frontend servito dal bundle — includono anche `Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri 'self'`. Questa direttiva definisce chi può incorporare l'app in un frame, esclude plugin e vincola `<base>` alla tua origine, senza limitare altro: script inline, worker e accessi tramite terze parti continuano a funzionare regolarmente. Una risposta che imposta una propria policy mantiene la propria. Per criteri più restrittivi, configura la policy sul reverse proxy a monte.

## Più di un'istanza

Un singolo container rappresenta la configurazione predefinita e non richiede altro. Prima che una seconda replica riceva traffico — o che un deploy progressivo ne esegua due in parallelo — consulta [Running more than one instance](/docs/deployment/multiple-instances/): rate limit, canali di broadcast, file locali, upload ripristinabili e cache delle immagini rimangono confinati al singolo processo a meno che non siano configurati per la condivisione.

## Esecuzione delle funzioni in un processo dedicato

Tutto quanto descritto sopra prevede un unico container a servizio dell'intero progetto, configurazione ideale per la quasi totalità dei casi d'uso. Quando una custom function non deve competere con le data API per l'event loop — o deve poter scalare, riavviarsi e fallire in modo isolato — la stessa immagine e lo stesso bundle possono essere avviati come processi cooperanti separati. Consulta [Split processes](/docs/deployment/split-processes/).

## Aggiornamento

```yaml
image: rebasepro/server:0.25.1
```

Riavvia. Il tuo bundle rimane invariato. All'interno della stessa major version del contratto di runtime, un bundle validato continuerà a funzionare — consulta [Compatibility](/docs/architecture/runtime-and-bundles/#compatibility).
