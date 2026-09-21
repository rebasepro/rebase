---
sourceHash: c5827fa03f8801fd
title: Self-Hosting
sidebar_label: Self-Hosting
description: Esegui Rebase ovunque con l'immagine di runtime ufficiale e il bundle del tuo progetto — Docker Compose, Fly, Railway o un semplice VPS.
---

## Panoramica

Eseguire Rebase in self-hosting significa avviare due componenti: un database Postgres e l'immagine ufficiale `rebasepro/server` con il bundle del tuo progetto montato al suo interno.

Non c'è **nessuna immagine dell'applicazione da compilare**. Il tuo progetto viaggia come bundle, il runtime viene distribuito e l'aggiornamento di Rebase consiste in una modifica del tag anziché in una ricompilazione. Consulta [Runtime and bundles](/docs/architecture/runtime-and-bundles/) per scoprire il motivo di questa suddivisione.

## Docker Compose

**Se il tuo progetto proviene da `rebase init`, usa il suo `docker-compose.yml`.**
Si trova nel tuo repository, `init` ha inserito i suoi secret, il suo primo account amministratore e la versione bloccata del runtime, ed è il file descritto in [Deployment](/docs/getting-started/deployment/#docker-compose-recommended):

```bash
rebase build
docker compose up -d
```

Il resto di questa pagina descrive lo stesso deployment senza uno scaffold alla base — il progetto di qualcun altro, un bundle creato in CI o le due cose che il file generato tralascia intenzionalmente: un connection pooler e le configurazioni a processi separati. Quel file si trova nel repository, all'indirizzo [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml). Usalo invece di copiare uno snippet da questa pagina: entrambi i file vengono avviati dal gate di accettazione del progetto a ogni push, quindi nessuno dei due può divergere da ciò che funziona effettivamente.

I due file concordano su ogni variabile d'ambiente tranne la password del database, e questo perché ciascuno è concepito per chi lo scrive: questo legge `POSTGRES_PASSWORD`, generata da `quickstart.sh`; quello generato legge `DATABASE_PASSWORD`, che `rebase init` incorpora anche nella `DATABASE_URL` scritta nel tuo `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` è un singolo comando che fa due cose ovvie e le stampa entrambe. La forma estesa, se preferisci gestire personalmente ogni passaggio:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

Non è necessario avviare il database separatamente — `api` attende il suo healthcheck.

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

- **`POSTGRES_PASSWORD`** — la password del database. Modificarla in seguito significa cambiarla anche nel volume, quindi sceglila una volta per tutte.
- **`JWT_SECRET`** — firma ogni sessione. La rotazione di questa chiave disconnette tutti gli utenti.
- **`REBASE_SERVICE_KEY`** — la credenziale che scavalca la row-level security per le chiamate server-to-server. Trattala come una password di root: qualunque entità ne sia in possesso può leggere ogni riga.
- **`CORS_ORIGINS`** — le origini da cui viene servito il tuo frontend, separate da virgola. Non è un secret e non è facoltativo: il runtime rifiuta di avviarsi in produzione senza di esso piuttosto che tirare a indovinare, poiché un'API che tenta di indovinare le proprie origini consentite finirà prima o poi per consentire quella sbagliata.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — il primo amministratore. Un database nuovo non ha utenti, e al di fuori della produzione i criteri di registrazione accettano la prima iscrizione promuovendola ad amministratore — altrimenti un database vuoto sarebbe un vicolo cieco, poiché l'inizializzazione di un admin richiede un chiamante già autenticato. Nel momento in cui questo stack risponde su un hostname, tale comodità diventa una race condition che l'operatore può perdere, quindi in produzione la finestra viene chiusa e l'account viene specificato qui. Il runtime lo crea una sola volta, mentre la tabella utenti è vuota, e non fa nulla a ogni avvio successivo.

Ognuno dei tre secret deve contenere almeno 32 caratteri, e la password di amministratore almeno 12. Usa un indirizzo con un punto nel dominio: `POST /auth/login` analizza il payload con `z.string().email()`, quindi `admin@localhost` creerebbe un account rifiutando poi qualsiasi tentativo di utilizzarlo. Il file compose dichiara tutti e sei i valori con `${VAR:?…}`, quindi una variabile mancante arresta lo stack con un messaggio che ne indica il nome anziché avviare qualcosa di configurato a metà — inoltre l'autoregistrazione è disabilitata di default (`DISABLE_SELF_REGISTRATION`, predefinito su `true`), impedendo così che qualcuno possa appropriarsi dell'istanza.

Accedi con queste credenziali e cambia la password: sono memorizzate in chiaro in un file sull'host.

## Dipendenze

`rebase build` **installa di default le dipendenze del progetto nel bundle**, perciò `dist-bundle` viene generato con `node_modules` e `package-lock.json` accanto al suo `package.json`. Un bundle con dipendenze incluse si avvia in circa cinque secondi.

Essendo già presenti, puoi montare il bundle in sola lettura — un'ottima precauzione, poiché un hook compromesso non potrà così riscrivere il codice eseguito dopo il riavvio successivo:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` disattiva questo comportamento e produce un bundle che installa le dipendenze solo al primo avvio, impiegando 40–60 secondi per avvio e richiedendo che il mount sia scrivibile.

Per un deployment reale, è preferibile incorporare entrambi in un'immagine, bloccando con precisione ciò che viene eseguito:

```dockerfile
FROM rebasepro/server:0.22.0
COPY dist-bundle /bundle
```

## Creazione dello schema

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle delle tue collection.**
`REBASE_MIGRATE_ON_BOOT` è impostato per impostazione predefinita su `ensure`, che ha un comportamento additivo sull'intero schema: crea le tabelle, le colonne e i tipi enum mancanti, applicando la loro row-level security. Il primo avvio su un database vuoto rende subito disponibili le tue collection, senza ulteriori passaggi.

Ciò che `ensure` deliberatamente non fa mai è modificare elementi già esistenti. Non altera il tipo di una colonna, non elimina tabelle o colonne e non modifica le etichette di un enum esistente — questo perché il riavvio di un container non deve poter rimodellare uno schema come effetto collaterale di un deploy.

Pertanto vale comunque la pena eseguire `rebase db push`, per le due cose che l'avvio non tocca:

```bash
rebase db push
```

- **RLS sulle junction table** per le relazioni molti-a-molti.
- **Qualsiasi modifica che non sia puramente additiva** — una colonna rinominata, un tipo ristretto, un campo rimosso.

Eseguilo da un checkout locale o da un job di CI, puntando al database del deployment. Esegue prima un dry-run delle modifiche, rifiuta quelle distruttive in assenza di una conferma esplicita e può effettuare un backup prima dell'applicazione. Il database espone una porta nel file compose per consentirne l'accesso dall'host; rimuovi questa mappatura una volta impostato lo schema se il database non deve essere raggiungibile dall'esterno.

`REBASE_MIGRATE_ON_BOOT` accetta solo `ensure` e `none` — l'immagine **rifiuta di avviarsi** se impostata su `push`, per la ragione spiegata sopra.

## Archiviazione file

Lo storage è **disattivato** a meno che non sia configurato un bucket, e questo è intenzionale: l'alternativa predefinita sarebbe il filesystem del container, che perderebbe silenziosamente ogni file caricato al riavvio successivo. I caricamenti vengono rifiutati con `501 STORAGE_NOT_CONFIGURED` finché non ne configuri uno.

Per un bucket, imposta `STORAGE_TYPE=s3` (o `gcs`) con il relativo bucket e le credenziali — il file compose elenca le variabili commentate.

Per il disco locale, appropriato solo quando il percorso corrisponde a un volume effettivo che sopravvive al container:

```yaml
      STORAGE_TYPE: local
      STORAGE_PATH: /data/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - uploads:/data/uploads
```

`FORCE_LOCAL_STORAGE` non è facoltativo in questo caso: in produzione un backend `local` viene scartato anziché registrato, poiché l'alternativa consisterebbe in upload che hanno successo all'interno di un filesystem destinato a essere distrutto. Questa variabile serve a certificare che il mount è persistente.

### Lo storage richiede un modello di controllo accessi

Una volta configurato un bucket, il runtime **rifiuta di avviarsi in produzione** finché il deployment non specifica le modalità di protezione degli oggetti. Lo storage non è gestito dalla row-level security e le sue chiavi condividono un singolo namespace piatto; pertanto, senza una regola, l'unica cosa a separare i file di due utenti sarebbe l'imprevedibilità delle chiavi — compromessa da `GET /storage/list?prefix=`. Uno qualsiasi dei seguenti approcci soddisfa il requisito:

- un **hook `storageAuthorize`** (o `storagePolicies`) nella configurazione del progetto, che rappresenta la vera soluzione ed è fornito dallo scaffold in `config/storage.ts` — nessuna variabile d'ambiente può esprimere "questo utente può leggere questa chiave";
- **`STORAGE_PUBLIC_READ=true`**, per un bucket che funge effettivamente da CDN pubblica in sola lettura;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, per un'applicazione single-tenant in cui ogni account autenticato è autorizzato ad accedere a qualunque file.

Al di fuori della produzione la medesima condizione genera un avviso evidente anziché un blocco dell'avvio; si tratta quindi di un errore che incontrerai durante il deploy anziché sulla tua macchina di sviluppo. È un comportamento voluto: il problema che previene si verificherebbe altrimenti in modo silenzioso.

Imposta anche `MFA_ENCRYPTION_KEY` se utilizzi TOTP. Se non impostata, i secret di autenticazione memorizzati vengono cifrati con `JWT_SECRET` — quindi la rotazione di quest'ultima disconnetterebbe tutti gli utenti *e* renderebbe indecifrabili tutti i dispositivi configurati.

## Altre piattaforme

Il runtime è un normale container in ascolto su `$PORT`, quindi qualsiasi piattaforma in grado di eseguire container è adatta. Due aspetti fondamentali da gestire ovunque:

1. Il bundle deve essere presente in `/bundle` (o nel percorso a cui punta `REBASE_BUNDLE`), con le dipendenze installate al suo interno — vedi [Dipendenze](#dipendenze).
2. Imposta `CORS_ORIGINS`, `JWT_SECRET` e `DATABASE_URL`. Il runtime rifiuta di avviarsi in produzione in loro assenza anziché tentare di indovinare.

### Fly.io

```toml
[build]
  image = "rebasepro/server:0.22.0"

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Usa la variante con immagine derivata illustrata sopra in modo che il bundle venga distribuito insieme all'app, quindi esegui `fly deploy`.

### Railway / Render

Punta il servizio all'immagine derivata, imposta le variabili d'ambiente e imposta il percorso di health check su `/livez`.

### Un semplice VPS

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` elenca le variabili che legge. Sotto systemd — le tre righe relative all'amministratore sono nuove, mentre su 0.17.3 il primo account registrato diventa invece l'amministratore:

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

`NODE_ENV=production` non è una decorazione. Se non impostata, il processo viene eseguito in modalità di sviluppo: accetta le origini localhost, espone la specifica OpenAPI e **lascia aperta la finestra del primo amministratore** — per cui il primo sconosciuto che trova il form di registrazione diventa l'amministratore. Le due righe `REBASE_ADMIN_*` sostituiscono proprio questa finestra; vedi [Your first admin](/docs/getting-started/deployment/#your-first-admin).

Preferisci `EnvironmentFile=/etc/rebase.env` con permessi impostati su 0600 rispetto alle righe `Environment=` per i secret: un unit file è leggibile da chiunque (world-readable) e `systemctl show` stampa ogni valore specificato con `Environment=`.

## Connection pooling

Il runtime mantiene un pool di connessioni ridotto e a lunga durata e non necessita di un pooler. Ciò di cui ha bisogno è invece tutto il resto che comunica con lo stesso database e non può mantenere una connessione persistente: una funzione serverless, uno script pianificato, uno strumento di BI, un worker di una coda che scala a cinquanta istanze. Il parametro `max_connections` di Postgres è un limite rigido nell'ordine di poche centinaia di connessioni e ogni connessione è un *processo*, per cui un fan-out di funzioni lambda lo esaurisce ben prima che il database sia effettivamente sotto carico.

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

L'autenticazione del client viene generata da `DATABASE_URL` all'avvio, evitando di scrivere la password due volte. Il pooler si autentica su Postgres con `scram-sha-256`, supportato da Postgres 18 — l'impostazione predefinita `md5` dell'immagine fallisce il login del *server* con `FATAL: server login failed: wrong password type`, che sembra un errore di password errata pur non essendolo.

Mantieni la somma di `PGBOUNCER_POOL_SIZE` per tutti i pooler ampiamente al di sotto di `max_connections` del database — il runtime attinge allo stesso budget.

### Cosa cambia con il transaction pooling

Un client gestito dal pool mantiene una connessione al server per la durata di una transazione e poi la rilascia: è questo che consente a 500 client di condividere 20 connessioni. Tre funzionalità smettono di operare tramite questa porta, e ciascuna di esse è utilizzata da Rebase stesso — motivo per cui il runtime si connette direttamente e questa porta è riservata ad altri chiamanti:

- **`LISTEN`/`NOTIFY`.** Le funzionalità in tempo reale sono basate su questo, e un listener richiede una connessione che sopravviva alla singola transazione. `LISTEN` viene *accettato* attraverso il pooler — risponde `LISTEN`, ma nessuna notifica verrà mai recapitata.
- **Stato della sessione**: `SET` (a differenza di `SET LOCAL`), advisory lock mantenuti tra istruzioni diverse, cursori `WITH HOLD`, tabelle temporanee. La transazione successiva potrebbe essere instradata su una connessione server diversa, che non vedrà alcuno di questi elementi. Entrambi falliscono nello stesso modo insidioso: con un solo client inattivo lo stato solitamente rimane presente, quindi funziona durante i test ma smette di funzionare sotto il livello di concorrenza per cui hai introdotto il pooler.
- **Prepared statement a livello di protocollo.** Alla maggior parte dei driver può essere indicato di non usarli — node-postgres non lo fa per impostazione predefinita; asyncpg richiede `statement_cache_size=0`.

`SET LOCAL` ha visibilità limitata alla transazione e funziona correttamente, ed è ciò che viene utilizzato per impostare la row-level security — pertanto la RLS si comporta in modo identico attraverso la porta del pool.

Lascia disattivato il profilo se nessun elemento esterno al runtime si connette al tuo database. Una porta inutilizzata rappresenta solo una superficie di attacco superflua.

## Health check

| Percorso | Scopo |
| --- | --- |
| `/livez` | Liveness. Risponde a "questo processo è attivo?" senza toccare il database. |
| `/health` | Readiness. Esegue un round-trip verso il database e riporta la latenza. |

Punta i probe di liveness su `/livez`. Un probe di liveness su `/health` riavvierebbe un processo perfettamente funzionante durante una breve instabilità del database, che è l'esatto contrario del suo scopo.

## Metriche

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Espone metriche Prometheus su `/metrics`: conteggio delle richieste e istogrammi di latenza suddivisi per superficie API (data, auth, storage, functions) e collection, oltre a gauge sul processo. Senza un token, l'endpoint è leggibile da chiunque possa raggiungere la porta, quindi impostane uno a meno che non si trovi su una rete privata.

## Esecuzione delle funzioni in un processo dedicato

Tutto quanto descritto sopra prevede un unico container che serve l'intero progetto, la configurazione corretta per la quasi totalità dei deployment. Quando una funzione personalizzata non deve più competere con le API dati per l'event loop — o deve poter scalare, riavviarsi e fallire in autonomia — la stessa immagine e lo stesso bundle possono essere avviati come più processi cooperanti. Consulta [Split processes](/docs/deployment/split-processes/).

## Aggiornamento

```yaml
image: rebasepro/server:0.22.0
```

Riavvia. Il tuo bundle rimane invariato. All'interno della stessa major version del contratto di runtime, un bundle validato continuerà a funzionare — consulta [Compatibility](/docs/architecture/runtime-and-bundles/#compatibility).
