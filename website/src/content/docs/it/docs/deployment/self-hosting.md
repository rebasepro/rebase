---
sourceHash: caa4e79614f7401e
title: Self-Hosting
sidebar_label: Self-Hosting
description: Esegui Rebase ovunque con l'immagine di runtime ufficiale e il bundle del tuo progetto — Docker Compose, Fly, Railway o un semplice VPS.
---

## Panoramica

Eseguire Rebase in self-hosting significa eseguire due cose: un database Postgres e
l'immagine ufficiale `rebasepro/server` con il bundle del tuo progetto montato al suo interno.

Non c'è **alcuna immagine dell'applicazione da compilare**. Il tuo progetto viaggia come un bundle,
il runtime è pubblicato e l'aggiornamento di Rebase è una modifica del tag anziché una
ricompilazione. Consulta [Runtime and bundles](/docs/architecture/runtime-and-bundles/) per
scoprire perché è suddiviso in questo modo.

## Docker Compose

**Se il tuo progetto proviene da `rebase init`, usa il suo `docker-compose.yml`.**
Si trova nel tuo repository, `init` ha compilato i relativi secret, il suo primo account amministratore
e la versione del runtime bloccata (pinned), ed è il file descritto in
[Deployment](/docs/getting-started/deployment/#docker-compose-recommended):

```bash
rebase build
docker compose up -d
```

Il resto di questa pagina riguarda lo stesso deployment senza uno scaffold alle spalle:
il progetto di qualcun altro, un bundle creato in CI o le due cose che il file generato
omette deliberatamente: un connection pooler e le configurazioni a processi separati.
Quel file si trova nel repository, in
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Usa quello invece di copiare uno snippet da questa pagina: entrambi i file vengono avviati
dall'acceptance gate del progetto a ogni push, quindi nessuno dei due può discostarsi da ciò che
funziona realmente.

I due file concordano su ogni variabile d'ambiente tranne la password del database, e
questo perché ciascuno è scritto per il rispettivo generatore: questo legge
`POSTGRES_PASSWORD`, generata da `quickstart.sh`; quello generato legge
`DATABASE_PASSWORD`, che `rebase init` incorpora anche nella `DATABASE_URL` che
scrive nel tuo `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` è un singolo comando che esegue due cose ovvie e le stampa entrambe. La
forma estesa, se preferisci gestire manualmente ogni passaggio:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

Non è necessario avviare il database separatamente: `api` attende il relativo
healthcheck.

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

- **`POSTGRES_PASSWORD`** — la password del database. Modificarla in seguito significa
  modificarla anche nel volume, quindi sceglila una sola volta.
- **`JWT_SECRET`** — firma ogni sessione. Ruotarla disconnette tutti gli utenti.
- **`REBASE_SERVICE_KEY`** — la credenziale che bypassa la row-level security per le
  chiamate da server a server. Trattala come una password di root: chiunque la possieda può
  leggere qualsiasi riga.
- **`CORS_ORIGINS`** — le origini da cui viene servito il tuo frontend, separate da virgola.
  Non è un secret e non è facoltativo: il runtime si rifiuta di avviarsi in produzione
  senza di esso invece di tirare a indovinare, poiché un'API che tira a indovinare le sue
  origini consentite finisce per consentire quella sbagliata.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — il primo
  amministratore. Un database vuoto non ha utenti e, al di fuori della produzione, la
  policy di registrazione accetta la prima registrazione e la promuove ad admin —
  altrimenti un database vuoto è un vicolo cieco, poiché il bootstrap di un admin
  richiede un chiamante già autenticato. Nel momento in cui questo stack risponde su un
  hostname, tale comodità diventa una race condition che l'operatore può perdere; pertanto,
  in produzione la finestra viene chiusa e l'account viene specificato qui. Il runtime lo crea
  una sola volta, quando la tabella degli utenti è vuota, e non fa nulla a ogni avvio
  successivo.

`JWT_SECRET` e `REBASE_SERVICE_KEY` devono contenere ciascuno almeno 32 caratteri, e
la password dell'admin almeno 12. Usa un indirizzo con un punto nel dominio:
`POST /auth/login` effettua il parsing del corpo con `z.string().email()`, quindi il runtime
si rifiuta di creare `admin@localhost` — un account a cui nessuno potrebbe accedere — e ne registra
il motivo nei log. Il file compose dichiara tutti e sei i valori con
`${VAR:?…}`, quindi se ne manca uno lo stack si arresta con un messaggio che ne indica il nome anziché
avviarsi a metà configurazione — e l'auto-registrazione è disattivata di default
(`DISABLE_SELF_REGISTRATION`, default `true`), quindi non rimane nulla da riscattare.

Accedi con queste credenziali e cambia la password: si trovano in chiaro in un
file sull'host.

## Dipendenze

`rebase build` **installa le dipendenze del tuo progetto nel bundle** per
impostazione predefinita, quindi `dist-bundle` include `node_modules` e un `package-lock.json`
accanto al suo `package.json`. Un bundle vendored si avvia in circa cinque secondi.

Poiché sono già presenti, puoi montare il bundle in sola lettura — un'ottima
pratica, dato che un hook compromesso non potrà quindi riscrivere il codice eseguito dopo il
riavvio successivo:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` disattiva questo comportamento e produce un bundle che installa
le dipendenze al primo avvio, operazione che richiede 40–60 secondi a ogni avvio e
necessita che il mount sia scrivibile.

Per un deployment reale, è preferibile incorporare entrambi in un'immagine, bloccando
con precisione ciò che viene eseguito:

```dockerfile
FROM rebasepro/server:0.26.0
COPY dist-bundle /bundle
```

## Creazione dello schema

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle delle tue collection.**
Il valore predefinito di `REBASE_MIGRATE_ON_BOOT` è `ensure`, che è additivo sull'intero
schema: crea tabelle, colonne e tipi enum mancanti, applicando la loro
row-level security. Un primo avvio su un database vuoto rende subito disponibili
le tue collection, senza alcun passaggio separato.

Ciò che `ensure` deliberatamente non fa mai è modificare ciò che già esiste. Non
altera il tipo di una colonna, non elimina una tabella o una colonna e non
modifica i valori di un enum esistente — perché il riavvio di un container non deve poter
rimodellare uno schema come effetto collaterale di un deploy.

Pertanto vale comunque la pena eseguire `rebase db push` per ciò che l'avvio non tocca —
qualsiasi modifica che non sia puramente additiva: una colonna rinominata, un tipo ristretto, un
campo rimosso.

```bash
rebase db push
```

Eseguilo da un checkout o da un job di CI, puntando al database del deployment.
Esegue prima un dry-run delle modifiche, rifiuta quelle distruttive senza esplicita
conferma e può eseguire un backup prima dell'applicazione. Il database pubblica una
porta nel file compose affinché questo comando possa raggiungerlo dall'host; rimuovi tale mappatura
una volta configurato lo schema se il database non deve essere accessibile
dall'esterno.

`REBASE_MIGRATE_ON_BOOT` accetta `ensure` e `none`, e nient'altro — l'immagine
**si rifiuta di avviarsi** con `push`, per il motivo sopra descritto.

## Quando solo il tuo processo di modifica può alterare il database

`REBASE_MIGRATE_ON_BOOT=none` non tocca le tue collection. Non lascia tuttavia intatto
il database: le tabelle proprie del framework (auth, API key, job, cron) vengono
comunque create e mantenute aggiornate a ogni avvio. Quando il database può essere modificato
solo tramite un processo di modifica revisionato, imposta `REBASE_PROVISION=false` su ogni processo
che serve traffico:

| Impostazione | Tabelle delle collection e policy | Tabelle del framework |
|---|---|---|
| default (`REBASE_MIGRATE_ON_BOOT=ensure`) | create e mantenute aggiornate all'avvio | create e mantenute aggiornate |
| `REBASE_MIGRATE_ON_BOOT=none` | non toccate | create e mantenute aggiornate |
| `REBASE_PROVISION=false` | non toccate | non toccate; ciò che manca viene indicato nei log |

Con il provisioning disattivato, il runtime non crea né modifica nulla: nessuna tabella, colonna,
indice, funzione, trigger, policy, ruolo o grant. Questo vale all'avvio e successivamente,
comprese le tabelle che un processo altrimenti creerebbe al primo utilizzo
(chiavi di idempotenza, claim cron, contatori condivisi di rate limiting). Al contrario,
legge semplicemente ciò che è presente:

- **Tabelle di autenticazione o una colonna letta dall'autenticazione mancante:** l'avvio viene
  rifiutato ed elenca ciascun elemento mancante.
- **Il ruolo della richiesta può accedere a una tabella del framework** come
  `rebase.refresh_tokens` o `rebase.api_keys`: l'avvio viene rifiutato e stampa il
  comando `REVOKE` da eseguire. Un avvio con provisioning rimuove tali privilegi autonomamente.
  Con il provisioning disattivato, non lo fa nessuno.
- **Una tabella opzionale mancante** (API key, chiavi di idempotenza, claim cron,
  contatori di rate limit, presence, storico delle metriche): tale funzionalità viene disattivata
  e il log indica quale tabella è necessaria.

Le righe continuano a cambiare, come avverrebbe su qualsiasi database: accessi, sessioni,
utilizzo delle API key, chiavi di idempotenza, claim cron. Il primo account amministratore
(`REBASE_ADMIN_EMAIL`) viene inserito dall'esecuzione di provisioning, non dai processi
che servono traffico. Il [Live schema editing](/docs/backend/live-schema-editing) può comunque
effettuare il commit di una modifica nel codice sorgente, ma si rifiuta di applicarla al database.

### L'esecuzione di provisioning

Lo schema proviene da un'esecuzione controllata dal tuo processo di modifica. Usa la stessa immagine e
lo stesso bundle del server, con `REBASE_PROVISION_ONLY=true`, connesso come un ruolo che
dispone dei permessi di creazione nel database. `REBASE_PROVISION_SQL_OUT` salva ogni modifica allo schema
apportata dall'esecuzione sotto forma di script SQL:

```bash
docker run --rm \
  -e DATABASE_URL="postgres://admin:…@scratch-db:5432/app" \
  -e JWT_SECRET="…" \
  -e REBASE_PROVISION_ONLY=true \
  -e REBASE_PROVISION_SQL_OUT=/out/rebase.sql \
  -v "$PWD/out:/out" \
  -v "$PWD/dist-bundle:/bundle" \
  "rebasepro/server:$REBASE_VERSION"
```

Lo script è una registrazione, non un piano: ogni istruzione in esso contenuta è stata eseguita,
in ordine, con successo. Registrato a fronte di un database vuoto, rappresenta l'intero schema
richiesto dalla release. Registrato su una copia ripristinata della produzione, rappresenta esattamente l'aggiornamento.
Le righe scritte durante l'esecuzione non sono incluse. Esaminalo, quindi applicalo al database reale:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f out/rebase.sql
```

Ripeti l'operazione per ogni aggiornamento di Rebase, prima del rollout dei processi che servono traffico. Una
release può aggiungere una tabella o una colonna, e un processo che non ha i permessi di crearne
una la segnalerà come mancante invece di crearla.

Un server compilato autonomamente segue la stessa regola: `initializeRebaseBackend` legge
`REBASE_PROVISION` e `createRebaseBackend` accetta
[`provision: false`](/docs/backend/custom-server#what-creating-a-backend-may-change-provision).

## File storage

Lo storage è **disattivato** a meno che non sia configurato un bucket, e questo è intenzionale:
l'alternativa predefinita sarebbe il filesystem del container, che perderebbe silenziosamente ogni
file caricato al riavvio successivo. I caricamenti vengono rifiutati con
`501 STORAGE_NOT_CONFIGURED` finché non ne configuri uno.

Per un bucket, imposta `STORAGE_TYPE=s3` (o `gcs`) insieme al relativo bucket e alle credenziali —
il file compose elenca le variabili, commentate. `gcs` carica
`@google-cloud/storage`, che l'immagine ufficiale non include, quindi su tale immagine
raggiungi Google Cloud Storage tramite il suo endpoint compatibile con S3
(`STORAGE_TYPE=s3`, `S3_ENDPOINT=https://storage.googleapis.com`, chiavi HMAC).

Per il disco locale, che è appropriato solo quando il percorso corrisponde a un volume reale che
sopravvive al container:

```yaml
      STORAGE_TYPE: local
      # Each declared bucket gets a directory beside this one, bucket("media")
      # /storage/uploads__media, so the volume goes on their parent.
      STORAGE_PATH: /storage/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - storage:/storage
```

`FORCE_LOCAL_STORAGE` non è facoltativo in questo caso: in produzione un backend `local` viene
scartato anziché registrato, poiché l'alternativa sarebbero caricamenti completati con successo
su un filesystem in procinto di essere distrutto. La variabile serve a confermare che il mount
è persistente.

Monta il volume **sopra** `STORAGE_PATH`, non esattamente su di esso. `STORAGE_PATH` è la
directory del bucket predefinito, e ogni bucket dichiarato in `config/resources.ts`
ne ottiene una propria accanto ad essa, `<STORAGE_PATH>__<key>`. Un volume montato esattamente su
`STORAGE_PATH` conterrà solo il bucket predefinito. Tutti gli altri bucket scriveranno sul
filesystem del container e perderanno i propri file quando il container verrà ricreato.
`STORAGE_PATH__MEDIA` può spostare un bucket altrove sul volume. Non può
spostarlo all'interno della directory di un altro bucket, come `/storage/uploads/media`,
perché il bucket predefinito altrimenti elencherebbe, servirebbe ed eliminerebbe i suoi file.

L'immagine crea
`/storage` per l'utente senza privilegi `node` con cui viene eseguita, motivo per cui il volume
va posizionato lì. Un volume montato dove l'immagine non ha una directory appartiene a root e
ogni caricamento fallisce con `EACCES`. Il file compose creato da `rebase init`
lo monta in questo modo.

### Lo storage necessita di un modello di controllo degli accessi

Una volta configurato un bucket, il runtime **si rifiuta di avviarsi in produzione**
finché il deployment non dichiara come sono protetti gli oggetti. Lo storage non è gestito dalla
row-level security e le sue chiavi condividono un unico namespace piatto, quindi senza una regola
l'unica cosa che separa i file di due utenti è l'imprevedibilità della chiave — vanificata da
`GET /storage/list?prefix=`. Uno qualsiasi di questi elementi soddisfa il requisito:

- un **hook `storageAuthorize`** (o `storagePolicies`) nella configurazione del tuo progetto,
  che è la soluzione reale e ciò che lo scaffold fornisce in `config/storage.ts` —
  nessuna variabile d'ambiente può esprimere "questo utente può leggere questa chiave";
- **`STORAGE_PUBLIC_READ=true`**, per un bucket che è a tutti gli effetti una CDN pubblica
  in sola lettura;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, per un'applicazione single-tenant in cui
  ogni account autenticato è autorizzato ad accedere a qualsiasi file.

Al di fuori della produzione, la stessa condizione genera un avviso evidente anziché un blocco,
quindi questo è un errore di avvio che si riscontra durante il deploy piuttosto che sul proprio computer.
È una scelta intenzionale: il problema che previene passerebbe altrimenti inosservato.

Imposta anche `MFA_ENCRYPTION_KEY` se utilizzi TOTP. Se non impostata, i secret memorizzati
dell'autenticatore vengono cifrati con `JWT_SECRET` — pertanto, ruotare quest'ultimo disconnetterà tutti gli utenti
*e* renderà indecifrabili tutti i dispositivi registrati.

## Altre piattaforme

Il runtime è un normale container in ascolto su `$PORT`, quindi qualsiasi piattaforma in grado di
eseguire container va bene. Due aspetti da impostare correttamente ovunque:

1. Il bundle deve essere presente in `/bundle` (o ovunque punti `REBASE_BUNDLE`),
   con le relative dipendenze installate accanto ad esso — consulta [Dipendenze](#dipendenze).
2. Imposta `CORS_ORIGINS`, `JWT_SECRET` e `DATABASE_URL`. Il runtime si rifiuta di
   avviarsi in produzione senza di essi anziché tirare a indovinare.

### Fly.io

```toml
[build]
  dockerfile = "Dockerfile"   # FROM rebasepro/server:0.26.0 + COPY dist-bundle /bundle

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Usa la forma con immagine derivata sopra indicata in modo che il bundle venga distribuito con l'applicazione, quindi
`fly deploy`.

### Railway / Render

Punta il servizio all'immagine derivata, imposta le variabili d'ambiente e imposta
il percorso dell'health check su `/livez`.

### Un semplice VPS

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` elenca le variabili che legge. Sotto systemd — le
due righe `REBASE_ADMIN_*` richiedono la versione 0.18 o successiva, mentre sulla 0.17.3 il primo account registrato
diventa invece l'amministratore:

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

`NODE_ENV=production` non è decorativo. Se omesso, il processo viene eseguito in
modalità di sviluppo: riflette le origini localhost, serve la specifica OpenAPI e
**lascia aperta la finestra per il primo amministratore** — cosicché il primo sconosciuto che trova
il form di registrazione diventa l'amministratore. Le due righe `REBASE_ADMIN_*` sostituiscono
tale finestra; consulta [Your first admin](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` è presente perché il database si trova sulla
stessa macchina. In produzione, il runtime rifiuta qualsiasi variabile che punti a
localhost — in un container, il loopback corrisponde al container stesso, quindi quell'indirizzo è
sempre un errore — e questa riga comunica che l'indirizzo è intenzionale. Rimuovila quando il
database viene eseguito altrove.

Per i secret, preferisci `EnvironmentFile=/etc/rebase.env` con i permessi del file impostati a 0600
rispetto alle righe `Environment=`: un unit file è leggibile da chiunque (`world-readable`) e
`systemctl show` stampa ogni valore di `Environment=`.

## Connection pooling

Il runtime mantiene un pool di connessioni ridotto e a lunga durata e non necessita di un pooler. Ciò di cui
invece necessita è tutto il resto che comunica con lo stesso database e non può mantenere una connessione persistente:
una funzione serverless, uno script pianificato, uno strumento di BI, un queue worker che scala
fino a cinquanta istanze. Il parametro `max_connections` di Postgres è un limite rigido che si aggira intorno a poche centinaia
e ogni connessione è un *processo*, quindi un fan-out di funzioni lambda lo esaurisce molto prima che il database sia effettivamente sotto carico.

Il file compose include un servizio `pgbouncer` per quel traffico, dietro un profilo
affinché un deployment senza tali chiamanti non esegua un processo non necessario:

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

L'autenticazione del client viene generata da `DATABASE_URL` all'avvio, quindi la
password non viene scritta due volte. Il pooler si autentica su Postgres con
`scram-sha-256`, memorizzato da Postgres 18 — l'impostazione predefinita `md5` dell'immagine fa fallire il
login al *server* con `FATAL: server login failed: wrong password type`, che
sembra un errore di password errata ma non lo è.

Mantieni la somma di `PGBOUNCER_POOL_SIZE` su tutti i pooler ampiamente al di sotto di
`max_connections` del database — il runtime attinge dallo stesso budget.

### Cosa cambia con il transaction pooling

Un client pooled mantiene una connessione al server per la durata di una transazione per poi
restituirla; questo è ciò che consente a 500 client di condividere 20 connessioni. Tre
cose smettono di funzionare tramite questa porta, ed ciascuna di esse è utilizzata da Rebase stesso
— motivo per cui il runtime si connette direttamente e questa porta è riservata ad altri
chiamanti:

- **`LISTEN`/`NOTIFY`.** Il realtime si basa su di esso e un listener necessita di una
  connessione che sopravviva a una transazione. `LISTEN` viene *accettato* tramite il
  pooler — risponde a `LISTEN`, ma poi non arriva mai alcuna notifica.
- **Stato della sessione**: `SET` (a differenza di `SET LOCAL`), advisory lock mantenuti
  tra diverse istruzioni, cursori `WITH HOLD`, tabelle temporanee. La transazione successiva
  potrebbe finire su una connessione al server diversa, che non vedrà nulla di tutto ciò. Entrambi
  falliscono nello stesso modo poco intuitivo: con un solo client inattivo lo stato è
  solitamente ancora presente, quindi funziona durante i test ma smette di funzionare sotto
  la concorrenza per cui era stato introdotto il pooler.
- **Prepared statement a livello di protocollo.** Alla maggior parte dei driver può essere indicato di non
  usarli — node-postgres non li usa per impostazione predefinita; asyncpg richiede
  `statement_cache_size=0`.

`SET LOCAL` ha un ambito limitato alla transazione e funziona, ed è ciò con cui viene impostata la
row-level security — pertanto RLS si comporta in modo identico tramite la porta del pool.

Lascia il profilo disattivato se nessun componente esterno al runtime si connette al database.
Una porta inutilizzata è solo superficie di attacco.

## Health check

| Percorso | Scopo |
| --- | --- |
| `/livez` | Liveness. Risponde a "questo processo è attivo" senza toccare il database. |
| `/health` | Readiness. Esegue un round-trip verso il database e riporta la latenza. |

Punta le sonde di liveness a `/livez`. Una sonda di liveness su `/health` riavvia un
processo perfettamente integro durante un momentaneo singhiozzo del database, che è l'opposto
dello scopo per cui è concepita.

## Metriche

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Espone le metriche di Prometheus su `/metrics`: conteggi delle richieste e istogrammi di latenza
suddivisi per superficie API (dati, auth, storage, funzioni) e collection, oltre a
gauge di processo. Senza un token, l'endpoint è leggibile da chiunque possa raggiungere
la porta, quindi impostane uno a meno che non si trovi su una rete privata.

`rebase_db_pool_wait_ms` è un istogramma che misura il tempo di attesa di ciascuna query per ottenere una
connessione dal pool del database, inclusa l'apertura di una nuova, etichettato dalla chiave del
data source (`source="(default)"` in un progetto che non dichiara data source). Un
pool in salute mantiene questo valore vicino allo zero. Una coda che
cresce con il traffico indica che le richieste sono in attesa di connessioni — nella maggior parte dei casi
trattenute da callback di scrittura che attendono operazioni lente; consulta
[A callback holds a connection](/docs/collections/context-data-api/#a-callback-holds-a-connection).

`rebase_realtime_*` riporta i socket aperti di ciascuna istanza, i canali e i frame inviati al
channel bus o trattenuti: consulta
[Seeing what the bus does](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Header di sicurezza

Ogni risposta include `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options:
nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` e `Strict-Transport-Security: max-age=15552000`
(180 giorni). L'header HSTS omette `includeSubDomains`: ciò indicherebbe ai
browser di rifiutare l'HTTP in chiaro su ogni sottodominio del tuo dominio, compresi quelli con cui
questo server non ha nulla a che fare, e un browser mantiene tale regola per la durata specificata dall'header.
Imposta `REBASE_HSTS_INCLUDE_SUBDOMAINS=true` quando ogni sottodominio è esclusivamente HTTPS;
fino alla versione 0.23 inclusa, l'header conteneva sempre `includeSubDomains`.

`strict-origin-when-cross-origin` è il comportamento predefinito dei browser: una richiesta verso
un altro sito include la tua origine e mai il path o la query della pagina. Non è
`no-referrer` perché i controlli dell'origine richiedono l'origine — il pulsante di accesso con Google
la confronta con le origini JavaScript autorizzate del client OAuth e, con
`no-referrer`, rispondeva "The given origin is not allowed for the given client
ID" in ogni app, a prescindere da ciò che il client consentiva. Una risposta che imposta una propria
policy la mantiene (la pagina di consenso MCP invia `no-referrer`); una pagina che richiede una regola
più restrittiva può indicarlo con `<meta name="referrer" content="no-referrer">`.
`X-Frame-Options` funziona allo stesso modo: `SAMEORIGIN` a meno che la risposta non imposti il
proprio valore, come fa la pagina di consenso MCP con `DENY`.

Le applicazioni statiche — l'amministrazione del CMS e qualsiasi frontend servito dal bundle — includono anche
`Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri
'self'`. Questo stabilisce chi può incorporare l'app in un frame, esclude i plugin e vincola `<base>`
alla tua origine, senza limitare nient'altro; in questo modo script inline, worker e
accessi di terze parti continuano a funzionare. Una risposta che imposta una propria policy la mantiene.
Per qualsiasi regola più restrittiva, applica la policy sul reverse proxy a monte.

## Più di un'istanza

Un solo container è l'impostazione predefinita e non richiede altro. Prima che una seconda replica
riceva traffico — o che un rolling deploy ne esegua due affiancate — consulta
[Running more than one instance](/docs/deployment/multiple-instances/): rate
limit, canali di broadcast, file locali, upload ripristinabili e cache delle immagini
sono per processo finché una configurazione non li condivide.

## Esecuzione delle funzioni in un processo separato

Tutto quanto sopra descritto prevede un singolo container che serve l'intero progetto, configurazione
ideale per quasi tutti i deployment. Quando una funzione personalizzata deve smettere di competere
con la data API per l'event loop — o deve scalare, riavviarsi e fallire in modo
indipendente — la stessa immagine e lo stesso bundle possono essere avviati come molteplici processi
cooperanti. Consulta [Split processes](/docs/deployment/split-processes/).

## Aggiornamento

```yaml
image: rebasepro/server:0.26.0
```

Riavvia. Il tuo bundle non subisce modifiche. All'interno della stessa versione major del
contratto di runtime, un bundle validato continua a funzionare — consulta
[Compatibility](/docs/architecture/runtime-and-bundles/#compatibility).
