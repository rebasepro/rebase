---
sourceHash: 2728510dde81de28
title: Self-Hosting
sidebar_label: Self-Hosting
description: Esegui Rebase ovunque con l'immagine di runtime ufficiale e il bundle del tuo progetto — Docker Compose, Fly, Railway o una semplice VPS.
---

## Panoramica

Fare il self-hosting di Rebase significa eseguire due cose: un database Postgres e l'immagine ufficiale `rebasepro/server` con il bundle del tuo progetto montato al suo interno.

Non c'è **alcuna immagine dell'applicazione da compilare**. Il tuo progetto viaggia come un bundle, il runtime è pubblicato e l'aggiornamento di Rebase consiste nel cambiare un tag anziché ricompilare. Consulta [Runtime e bundle](/docs/architecture/runtime-and-bundles/) per capire il motivo di questa suddivisione.

## Docker Compose

**Se il tuo progetto è stato creato con `rebase init`, usa il suo `docker-compose.yml`.**
Si trova nel tuo repository, `init` ha già configurato i suoi secret, il suo primo account amministratore e la versione bloccata del runtime; ed è il file descritto in [Deployment](/docs/getting-started/deployment/#docker-compose-recommended):

```bash
rebase build
docker compose up -d
```

Il resto di questa pagina riguarda lo stesso deployment senza uno scaffold alle spalle — il progetto di qualcun altro, un bundle compilato in CI o le due cose che il file generato tralascia deliberatamente: un connection pooler e le configurazioni a processi separati. Quel file si trova nel repository, all'indirizzo [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml). Usa quello invece di copiare uno snippet da questa pagina: entrambi i file vengono avviati dall'acceptance gate del progetto a ogni push, quindi nessuno dei due può divergere da ciò che funziona realmente.

I due file coincidono su ogni variabile d'ambiente tranne la password del database, e questo perché ciascuno è scritto per il proprio generatore: questo legge `POSTGRES_PASSWORD`, generata da `quickstart.sh`; quello generato legge `DATABASE_PASSWORD`, che `rebase init` include anche nella `DATABASE_URL` scritta nel tuo `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` è un unico comando che fa due cose ovvie e le stampa entrambe. La forma estesa, se preferisci gestire ciascun passaggio:

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

- **`POSTGRES_PASSWORD`** — la password del database. Modificarla in seguito significa doverla cambiare anche nel volume, quindi sceglila con cura una volta sola.
- **`JWT_SECRET`** — firma ogni sessione. La rotazione di questa chiave disconnette tutti gli utenti.
- **`REBASE_SERVICE_KEY`** — la credenziale che bypassa la row-level security per le chiamate server-to-server. Trattala come una password di root: chiunque la possieda può leggere ogni riga.
- **`CORS_ORIGINS`** — le origini da cui viene servito il frontend, separate da virgola. Non è un secret e non è opzionale: in produzione il runtime si rifiuta di avviarsi senza di essa piuttosto che tirare a indovinare, perché un'API che tira a indovinare le origini consentite prima o poi consentirà quella sbagliata.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — il primo amministratore. Un database nuovo non ha utenti, e al di fuori della produzione il criterio di registrazione accetta la prima iscrizione e la promuove ad admin — altrimenti un database vuoto sarebbe un vicolo cieco, poiché l'inizializzazione di un admin richiede un chiamante già autenticato. Nel momento in cui questo stack risponde su un hostname, quella comodità diventa una race condition che l'operatore può perdere; perciò, in produzione la finestra viene chiusa e l'account viene specificato qui. Il runtime lo crea una sola volta, quando la tabella utenti è vuota, e non fa nulla a ogni avvio successivo.

Ciascuno dei tre secret deve contenere almeno 32 caratteri, e la password dell'amministratore almeno 12. Usa un indirizzo con un punto nel dominio: `POST /auth/login` analizza il body con `z.string().email()`, quindi `admin@localhost` creerebbe un account iniziale per poi rifiutare qualsiasi tentativo di utilizzo. Il file compose dichiara tutti e sei i parametri con `${VAR:?…}`, quindi se ne manca uno lo stack si arresta con un messaggio che ne indica il nome anziché avviarsi a metà — e l'auto-registrazione viene disabilitata di default (`DISABLE_SELF_REGISTRATION`, predefinito `true`), evitando che qualcuno possa appropriarsi dell'account.

Accedi con quelle credenziali e cambia la password: sono memorizzate in chiaro in un file sull'host.

## Dipendenze

`rebase build` **installa le dipendenze del tuo progetto nel bundle** per impostazione predefinita, quindi `dist-bundle` si presenta con una cartella `node_modules` e un file `package-lock.json` accanto al suo `package.json`. Un bundle "vendored" si avvia in circa cinque secondi.

Dato che sono già presenti, puoi montare il bundle in sola lettura — cosa consigliata, poiché un hook compromesso non potrà riscrivere il codice eseguito dopo il riavvio successivo:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` disattiva questo comportamento e produce un bundle che installa invece le sue dipendenze al primo avvio, operazione che richiede 40–60 secondi a ogni avvio e necessita che il mount sia scrivibile.

Per un deployment reale, è preferibile incorporare entrambi in un'immagine, bloccando con precisione ciò che viene eseguito:

```dockerfile
FROM rebasepro/server:0.20.0
COPY dist-bundle /bundle
```

## Creazione dello schema

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle delle tue collection.** `REBASE_MIGRATE_ON_BOOT` ha come valore predefinito `ensure`, che opera in modo additivo sull'intero schema: crea tabelle, colonne e tipi enum mancanti, e applica la relativa row-level security. Il primo avvio su un database vuoto inizia a servire le tue collection senza alcun passaggio aggiuntivo.

Ciò che `ensure` deliberatamente non fa mai è modificare elementi già esistenti. Non altera il tipo di una colonna, non elimina tabelle o colonne e non modifica le etichette di un enum esistente — perché il riavvio di un container non deve poter rimodellare uno schema come effetto collaterale di un deploy.

Pertanto vale comunque la pena eseguire `rebase db push`, per le due cose che l'avvio non tocca:

```bash
rebase db push
```

- **RLS sulle tabelle di giunzione** per le relazioni many-to-many.
- **Qualsiasi modifica non puramente additiva** — una colonna rinominata, un tipo ristretto, un campo rimosso.

Eseguilo da un checkout locale o da un job di CI, puntando al database di deployment. Esegue prima un dry-run delle modifiche, rifiuta quelle distruttive senza conferma esplicita e può effettuare un backup prima dell'applicazione. Il database espone una porta nel file compose affinché il comando possa raggiungerlo dall'host; rimuovi questa mappatura una volta impostato lo schema, se il database non deve essere raggiungibile dall'esterno.

`REBASE_MIGRATE_ON_BOOT` accetta `ensure` e `none`, e null'altro — l'immagine **si rifiuta di avviarsi** con `push`, per il motivo sopra descritto.

## File storage

Lo storage è **disattivato** a meno che non sia configurato un bucket, e questo è intenzionale: l'alternativa predefinita sarebbe il filesystem del container, che perderebbe silenziosamente ogni file caricato al riavvio successivo. I caricamenti vengono rifiutati con `501 STORAGE_NOT_CONFIGURED` finché non ne configuri uno.

Per un bucket, imposta `STORAGE_TYPE=s3` (o `gcs`) insieme al nome del bucket e alle relative credenziali — il file compose elenca le variabili, commentate.

Per il disco locale, appropriato solo quando il percorso corrisponde a un vero volume che sopravvive al container:

```yaml
      STORAGE_TYPE: local
      STORAGE_PATH: /data/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - uploads:/data/uploads
```

In questo caso `FORCE_LOCAL_STORAGE` non è opzionale: in produzione un backend `local` viene scartato anziché registrato, poiché l'alternativa consisterebbe in upload riusciti verso un filesystem destinato a essere distrutto. Questa variabile serve a confermare che il mount è persistente.

### Lo storage necessita di un modello di controllo degli accessi

Una volta configurato un bucket, il runtime **si rifiuta di avviarsi in produzione** finché il deployment non specifica come sono protetti gli oggetti. Lo storage non è sottoposto alla row-level security e le sue chiavi condividono un unico namespace piatto; pertanto, senza una regola l'unica cosa a separare i file di due utenti sarebbe l'impossibilità di indovinare la chiave — presupposto vanificato da `GET /storage/list?prefix=`. Una qualsiasi delle seguenti opzioni soddisfa questo requisito:

- un **hook `storageAuthorize`** (o `storagePolicies`) nella configurazione del progetto, che rappresenta la vera soluzione ed è ciò che lo scaffold include in `config/storage.ts` — nessuna variabile d'ambiente può esprimere "questo utente può leggere questa chiave";
- **`STORAGE_PUBLIC_READ=true`**, per un bucket che funge effettivamente da CDN pubblica di sola lettura;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, per un'applicazione single-tenant in cui a ogni account autenticato è concesso l'accesso a qualsiasi file.

Al di fuori della produzione, la stessa condizione genera un avviso evidente anziché un blocco dell'avvio, quindi questo è un errore di avvio che si riscontra durante il deploy anziché sulla propria macchina di sviluppo. È un comportamento intenzionale: l'errore che sostituisce è silenzioso.

Imposta anche `MFA_ENCRYPTION_KEY` se utilizzi TOTP. Se non impostata, i secret memorizzati dell'autenticatore vengono crittografati con `JWT_SECRET` — quindi la rotazione di quest'ultima disconnette tutti gli utenti *e* rende indecifrabili tutti i dispositivi registrati.

## Altre piattaforme

Il runtime è un normale container in ascolto su `$PORT`, quindi qualsiasi servizio in grado di eseguire container andrà bene. Due aspetti da configurare correttamente ovunque:

1. Il bundle deve trovarsi in `/bundle` (o dove punta `REBASE_BUNDLE`), con le relative dipendenze installate al suo interno — vedi [Dipendenze](#dependencies).
2. Imposta `CORS_ORIGINS`, `JWT_SECRET` e `DATABASE_URL`. Il runtime si rifiuta di avviarsi in produzione senza di essi piuttosto che tirare a indovinare.

### Fly.io

```toml
[build]
  image = "rebasepro/server:0.20.0"

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Usa il formato con immagine derivata mostrato sopra in modo che il bundle sia distribuito insieme all'app, quindi esegui `fly deploy`.

### Railway / Render

Punta il servizio all'immagine derivata, imposta le variabili d'ambiente e imposta il percorso dell'health check su `/livez`.

### Una semplice VPS

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` elenca le variabili che legge. Sotto systemd — le tre righe relative all'admin sono nuove, mentre sulla versione 0.17.3 è il primo account registrato a diventare amministratore:

```ini title="/etc/systemd/system/rebase.service"
[Service]
ExecStart=/usr/bin/rebase-server /srv/myapp/dist-bundle
Restart=always
Environment=NODE_ENV=production
Environment=DATABASE_URL=postgresql://rebase:...@127.0.0.1:5432/rebase
Environment=JWT_SECRET=...
Environment=REBASE_SERVICE_KEY=...
Environment=CORS_ORIGINS=https://app.example.com
Environment=DISABLE_SELF_REGISTRATION=true
Environment=REBASE_ADMIN_EMAIL=you@example.com
Environment=REBASE_ADMIN_PASSWORD=...
```

`NODE_ENV=production` non è una semplice formalità. Se omesso, il processo viene eseguito in modalità di sviluppo: riflette le origini localhost, serve la specifica OpenAPI e **lascia aperta la finestra per il primo admin** — consentendo al primo sconosciuto che trova il form di registrazione di diventare l'amministratore. Le due righe `REBASE_ADMIN_*` sostituiscono proprio questa finestra; consulta [Il tuo primo admin](/docs/getting-started/deployment/#your-first-admin).

Per i secret, preferisci `EnvironmentFile=/etc/rebase.env` con permessi del file impostati a 0600 rispetto alle righe `Environment=`: un unit file è leggibile da chiunque e `systemctl show` stampa tutti i valori di `Environment=`.

## Connection pooling

Il runtime mantiene un pool ridotto e a lunga durata e non necessita di un pooler. Ciò di cui ha bisogno un pooler è tutto il resto che comunica con lo stesso database e non può mantenere una connessione persistente: una funzione serverless, uno script pianificato, uno strumento di BI, un worker di code che scala a cinquanta istanze. Il parametro `max_connections` di Postgres è un limite rigido di poche centinaia e ogni connessione è un *processo*, quindi un fan-out di funzioni lambda lo esaurisce molto prima che il database sia effettivamente saturo.

Il file compose include un servizio `pgbouncer` per tale traffico, protetto da un profilo in modo che un deployment privo di tali client non esegua un processo non necessario:

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

L'autenticazione del client viene generata da `DATABASE_URL` all'avvio, quindi la password non viene scritta due volte. Il pooler si autentica su Postgres tramite `scram-sha-256`, supportato da Postgres 18 — l'impostazione predefinita `md5` dell'immagine fa fallire il login al *server* con `FATAL: server login failed: wrong password type`, che sembra una password errata ma in realtà non lo è.

Mantieni la somma di `PGBOUNCER_POOL_SIZE` su tutti i pooler ampiamente al di sotto del valore `max_connections` del database — il runtime attinge dallo stesso budget.

### Cosa comporta il transaction pooling

Un client che utilizza il pool mantiene una connessione al server per la sola durata di una transazione per poi rilasciarla, consentendo a 500 client di condividere 20 connessioni. Tre funzionalità smettono di funzionare tramite questa porta, e ciascuna di esse è utilizzata da Rebase stesso — motivo per cui il runtime si connette direttamente e questa porta è riservata agli altri client:

- **`LISTEN`/`NOTIFY`.** Il Realtime si basa su questo, e un listener richiede una connessione che sopravviva alla transazione. `LISTEN` viene *accettato* dal pooler — risponde a `LISTEN`, ma poi non arriverà mai alcuna notifica.
- **Stato della sessione**: `SET` (a differenza di `SET LOCAL`), advisory lock mantenuti tra istruzioni diverse, cursori `WITH HOLD`, tabelle temporanee. La transazione successiva potrebbe finire su una diversa connessione al server, la quale non vedrà nulla di tutto ciò. Entrambi i casi falliscono nello stesso modo ingannevole: con un singolo client inattivo lo stato in genere è ancora presente, quindi funziona durante i test ma smette di funzionare proprio sotto il carico di concorrenza per cui hai introdotto il pooler.
- **Prepared statement a livello di protocollo.** Alla maggior parte dei driver si può indicare di non usarli — node-postgres non lo fa per impostazione predefinita; asyncpg necessita di `statement_cache_size=0`.

`SET LOCAL` ha ambito di transazione e funziona correttamente, ed è ciò con cui viene configurata la row-level security — quindi la RLS si comporta in modo identico attraverso la porta con pool.

Lascia il profilo disattivato se nessun componente esterno al runtime si connette al tuo database. Una porta inutilizzata rappresenta superficie di attacco.

## Health check

| Path | Utilizzo |
| --- | --- |
| `/livez` | Liveness. Risponde a "questo processo è attivo?" senza toccare il database. |
| `/health` | Readiness. Esegue un round-trip con il database e segnala la latenza. |

Punta i probe di liveness su `/livez`. Un probe di liveness su `/health` riavvierebbe un processo perfettamente funzionante durante un temporaneo rallentamento del database, che è l'esatto opposto del suo scopo.

## Metriche

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Espone metriche Prometheus su `/metrics`: conteggio delle richieste e istogrammi di latenza suddivisi per superficie API (data, auth, storage, functions) e collection, oltre a gauge relativi al processo. Senza un token, l'endpoint è leggibile da chiunque possa raggiungere la porta, quindi impostane uno a meno che non si trovi su una rete privata.

## Eseguire le funzioni in un processo dedicato

Tutto quanto sopra descritto riguarda un unico container che serve l'intero progetto, configurazione ideale per quasi ogni deployment. Quando si desidera che una funzione personalizzata smetta di competere con la data API per l'event loop — o debba scalare, riavviarsi e fallire in modo indipendente — la stessa immagine e lo stesso bundle possono essere avviati come molteplici processi cooperativi. Consulta [Processi separati](/docs/deployment/split-processes/).

## Aggiornamento

```yaml
image: rebasepro/server:0.20.0
```

Riavvia. Il tuo bundle rimane invariato. All'interno della stessa versione major del runtime contract, un bundle convalidato continua a funzionare — consulta [Compatibilità](/docs/architecture/runtime-and-bundles/#compatibility).

---
