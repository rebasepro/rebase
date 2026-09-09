---
sourceHash: aa153f3ab4c80526
title: Self-Hosting
sidebar_label: Self-Hosting
description: Esegui Rebase ovunque con l'immagine di runtime ufficiale e il bundle del tuo progetto — Docker Compose, Fly, Railway o un semplice VPS.
---

## Panoramica

Eseguire Rebase in self-hosting significa avviare due componenti: un database Postgres e l'immagine ufficiale `rebasepro/server` con il bundle del tuo progetto montato al suo interno.

Non c'è **nessuna immagine applicativa da compilare**. Il tuo progetto viaggia come bundle, il runtime viene distribuito separatamente e l'aggiornamento di Rebase consiste nel cambiare un tag anziché eseguire una ricompilazione. Consulta [Runtime e bundle](/docs/architecture/runtime-and-bundles/) per scoprire perché è strutturato in questo modo.

## Docker Compose

**Se il tuo progetto è stato generato con `rebase init`, usa il suo `docker-compose.yml`.**
Si trova nel tuo repository; `init` ha già compilato i suoi secret, il primo account amministratore e la versione bloccata del runtime, ed è il file descritto in [Deployment](/docs/getting-started/deployment/#docker-compose-recommended):

```bash
rebase build
docker compose up -d
```

Il resto di questa pagina illustra lo stesso deployment senza uno scaffolding a monte: il progetto di qualcun altro, un bundle compilato in CI o i due elementi deliberatamente esclusi dal file generato: un connection pooler e le configurazioni a processi separati. Questo file si trova nel repository, all'indirizzo [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Usa quello invece di copiare uno snippet da questa pagina: entrambi i file vengono avviati dal gate di accettazione del progetto a ogni push, quindi nessuno dei due rischia di divergere da ciò che funziona realmente.

I due file concordano su ogni variabile d'ambiente tranne la password del database, e questo perché ciascuno è scritto per il proprio generatore: questo legge `POSTGRES_PASSWORD`, generata da `quickstart.sh`; quello generato legge `DATABASE_PASSWORD`, che `rebase init` inserisce anche nella `DATABASE_URL` scritta nel tuo `.env`.

```bash
rebase build                    # produce ./dist-bundle
./infra/docker/quickstart.sh    # scrive infra/docker/.env se assente, poi avvia lo stack
```

`quickstart.sh` è un unico comando che esegue due operazioni ovvie e le stampa entrambe. La versione estesa, se preferisci gestire direttamente ogni passaggio:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

Non è necessario avviare il database separatamente: `api` attende il superamento del suo healthcheck.

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

Tre secret, un dato di configurazione e l'account con cui effettuare l'accesso:

- **`POSTGRES_PASSWORD`** — la password del database. Modificarla in seguito richiede di aggiornarla anche nel volume, quindi sceglila una sola volta.
- **`JWT_SECRET`** — firma ogni sessione. La rotazione di questa chiave disconnette tutti gli utenti.
- **`REBASE_SERVICE_KEY`** — la credenziale che scavalca la row-level security per le chiamate server-to-server. Trattala come una password di root: chiunque la possieda può leggere qualsiasi riga.
- **`CORS_ORIGINS`** — le origini da cui viene servito il frontend, separate da virgola. Non è un secret e non è opzionale: il runtime rifiuta di avviarsi in produzione senza questo valore invece di tirare a indovinare, perché un'API che tenta di indovinare le origini consentite prima o poi autorizzerà quella sbagliata.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — il primo amministratore. Un database vuoto non ha utenti, e al di fuori della produzione la policy di registrazione accetta la prima iscrizione promuovendola ad admin — altrimenti un database vuoto sarebbe un vicolo cieco, poiché l'inizializzazione di un admin richiede un chiamante già autenticato. Nel momento in cui questo stack risponde su un hostname, quella comodità diventa una race condition che l'operatore rischia di perdere; per questo motivo, in produzione la finestra viene chiusa e l'account viene dichiarato qui. Il runtime lo crea una sola volta, quando la tabella utenti è vuota, e non compie alcuna azione a ogni avvio successivo.

Ciascuno dei tre secret deve essere lungo almeno 32 caratteri, e la password dell'amministratore almeno 12. Usa un indirizzo con un punto nel dominio: `POST /auth/login` valida il body con `z.string().email()`, quindi `admin@localhost` creerebbe un account rifiutando poi qualsiasi tentativo di utilizzarlo. Il file compose dichiara tutti e sei i parametri con `${VAR:?…}`, in modo che un valore mancante arresti lo stack con un messaggio che ne indica il nome anziché avviare un sistema parzialmente configurato — e l'autoregistrazione viene disattivata di default (`DISABLE_SELF_REGISTRATION`, predefinito `true`), quindi non rimane nulla da poter rivendicare.

Accedi con queste credenziali e modifica la password: sono archiviate in chiaro in un file sull'host.

## Dipendenze

Di default, `rebase build` **installa le dipendenze del tuo progetto all'interno del bundle**, quindi `dist-bundle` include una cartella `node_modules` e un file `package-lock.json` accanto al suo `package.json`. Un bundle con dipendenze incluse (vendored) si avvia in circa cinque secondi.

Dato che le dipendenze sono già presenti, puoi montare il bundle in sola lettura — una scelta consigliata, poiché un hook compromesso non potrà riscrivere il codice eseguito al riavvio successivo:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` esclude le dipendenze e produce un bundle che le installa al primo avvio, operazione che richiede 40–60 secondi per avvio e necessita di un punto di montaggio con permessi di scrittura.

Per un deployment di produzione reale, è preferibile incorporare entrambi gli elementi in un'immagine, bloccando con precisione ciò che viene eseguito:

```dockerfile
FROM rebasepro/server:0.19.1
COPY dist-bundle /bundle
```

## Creazione dello schema

**Il runtime crea le tabelle mancanti all'avvio, incluse quelle delle tue collection.**
`REBASE_MIGRATE_ON_BOOT` è impostato di default su `ensure`, un'operazione additiva su tutto lo schema: crea tabelle, colonne e tipi enum mancanti, applicando la loro row-level security. Un primo avvio su un database vuoto rende subito disponibili le tue collection, senza passaggi aggiuntivi.

Ciò che `ensure` deliberatamente non fa mai è modificare ciò che esiste già. Non altera il tipo di una colonna, non rimuove tabelle o colonne e non modifica i valori di un enum esistente — perché il riavvio di un container non deve poter alterare lo schema come effetto collaterale di un deploy.

Pertanto, vale comunque la pena eseguire `rebase db push` per i due casi non gestiti dall'avvio:

```bash
rebase db push
```

- **RLS sulle tabelle di giunzione** per le relazioni molti-a-molti.
- **Qualsiasi modifica che non sia puramente additiva** — una colonna rinominata, un tipo reso più restrittivo, un campo rimosso.

Eseguilo da una copia locale o da un job di CI puntando al database dell'ambiente di deploy. Il comando esegue prima una simulazione della modifica, rifiuta quelle distruttive senza esplicita conferma e può creare un backup prima dell'applicazione. Il database espone una porta nel file compose per consentire questo accesso dall'host; rimuovi questa mappatura una volta impostato lo schema se il database non deve essere raggiungibile dall'esterno.

`REBASE_MIGRATE_ON_BOOT` accetta solo i valori `ensure` e `none` — per la ragione sopra indicata, l'immagine **rifiuta l'avvio** con `push`.

## Archiviazione file

L'archiviazione è **disattivata** a meno che non venga configurato un bucket, e questa scelta è intenzionale: l'alternativa predefinita sarebbe il filesystem del container, che perderebbe silenziosamente ogni file caricato al riavvio successivo. I caricamenti vengono rifiutati con `501 STORAGE_NOT_CONFIGURED` finché non ne configuri uno.

Per usare un bucket, imposta `STORAGE_TYPE=s3` (o `gcs`) specificando bucket e credenziali — il file compose elenca le variabili pertinenti, attualmente commentate.

Per il disco locale, opzione indicata solo quando il percorso corrisponde a un volume reale che sopravvive al ciclo di vita del container:

```yaml
      STORAGE_TYPE: local
      STORAGE_PATH: /data/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - uploads:/data/uploads
```

In questo caso, `FORCE_LOCAL_STORAGE` non è opzionale: in produzione un backend `local` viene ignorato anziché registrato, poiché l'alternativa sarebbe consentire upload su un filesystem destinato a essere distrutto. Questa variabile serve a confermare esplicitamente che il montaggio è persistente.

### Lo storage richiede un modello di controllo accessi

Una volta configurato un bucket, il runtime **rifiuta l'avvio in produzione** finché la distribuzione non dichiara come sono protetti gli oggetti. Lo storage non è gestito dalla row-level security e le sue chiavi condividono un unico namespace piatto; senza una regola, l'unica protezione tra i file di due utenti diversi è l'impossibilità di indovinare le chiavi — protezione vanificata da `GET /storage/list?prefix=`. Per soddisfare questo requisito è sufficiente uno qualsiasi dei seguenti criteri:

- un **hook `storageAuthorize`** (o `storagePolicies`) nella configurazione del progetto, che rappresenta la vera soluzione ed è ciò che lo scaffolding fornisce in `config/storage.ts` — nessuna variabile d'ambiente può esprimere "questo utente può leggere questa chiave";
- **`STORAGE_PUBLIC_READ=true`**, per un bucket che funge effettivamente da CDN pubblica in sola lettura;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, per un'applicazione single-tenant in cui ogni account autenticato ha accesso a qualsiasi file.

Al di fuori della produzione, la stessa condizione genera un avviso evidente anziché un blocco: si tratta quindi di un errore di avvio che si manifesta in fase di deploy piuttosto che sulla macchina di sviluppo. È un comportamento voluto: sostituisce un fallimento che altrimenti sarebbe silenzioso.

Imposta anche `MFA_ENCRYPTION_KEY` se utilizzi TOTP. Se non configurata, i secret dell'autenticatore vengono cifrati con `JWT_SECRET` — pertanto, ruotare quest'ultimo disconnetterà tutti gli utenti *e* renderà illeggibile qualsiasi dispositivo registrato.

## Altre piattaforme

Il runtime è un container standard in ascolto su `$PORT`, quindi qualsiasi servizio in grado di eseguire container è compatibile. Due aspetti da verificare con attenzione ovunque:

1. Il bundle deve essere presente in `/bundle` (o nel percorso indicato da `REBASE_BUNDLE`), con le relative dipendenze installate al suo interno — vedi [Dipendenze](#dipendenze).
2. Imposta `CORS_ORIGINS`, `JWT_SECRET` e `DATABASE_URL`. In produzione, il runtime rifiuta l'avvio senza queste variabili invece di tirare a indovinare.

### Fly.io

```toml
[build]
  image = "rebasepro/server:0.19.1"

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Usa la configurazione con immagine derivata illustrata sopra, in modo che il bundle venga distribuito insieme all'applicazione, quindi esegui `fly deploy`.

### Railway / Render

Punta il servizio all'immagine derivata, imposta le variabili d'ambiente e imposta il percorso di health check su `/livez`.

### Un semplice VPS

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

`rebase-server --help` elenca le variabili lette dal processo. Esecuzione sotto systemd — le tre righe relative all'admin sono recenti; sulla versione 0.17.3 il primo account registrato diventa invece l'amministratore:

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

`NODE_ENV=production` non è facoltativo. Se omesso, il processo viene eseguito in modalità sviluppo: accetta origini localhost, espone la specifica OpenAPI e **lascia aperta la finestra per il primo amministratore** — consentendo al primo sconosciuto che trova la schermata di registrazione di diventare l'amministratore. Le due righe `REBASE_ADMIN_*` servono proprio a chiudere questa finestra; consulta [Il tuo primo admin](/docs/getting-started/deployment/#your-first-admin).

È preferibile usare `EnvironmentFile=/etc/rebase.env` con permessi `0600` anziché inserire i secret nelle direttive `Environment=`: i file di unit sono leggibili da tutti e `systemctl show` mostra in chiaro ogni valore specificato in `Environment=`.

## Connection pooling

Il runtime mantiene un pool ridotto e a lunga durata, non necessitando di un pooler dedicato. A richiederlo è invece tutto il resto che comunica con lo stesso database e non può mantenere connessioni persistenti: una funzione serverless, uno script pianificato, uno strumento di BI, un worker di code che scala a cinquanta istanze. Il parametro `max_connections` di Postgres impone un limite rigido nell'ordine di poche centinaia e ogni connessione è un *processo* dedicato, per cui un ventaglio di lambda può esaurirle molto prima che il database sia effettivamente saturo.

Il file compose include un servizio `pgbouncer` dedicato a tale traffico, associato a un profilo specifico per fare in modo che i deployment privi di questi client non eseguano un processo inutile:

```bash
docker compose --profile pooler up -d
```

```
postgres://rebase:$POSTGRES_PASSWORD@your-host:6432/rebase
```

```bash
PGBOUNCER_PORT=6432           # porta sull'host
PGBOUNCER_MAX_CLIENT_CONN=500 # connessioni client accettate
PGBOUNCER_POOL_SIZE=20        # connessioni server usate per servirle
```

L'autenticazione client viene generata all'avvio a partire da `DATABASE_URL`, evitando di duplicare la password. Il pooler si autentica su Postgres tramite `scram-sha-256`, supportato da Postgres 18 — il valore predefinito `md5` dell'immagine fallisce l'autenticazione verso il *server* con l'errore `FATAL: server login failed: wrong password type`, che sembra indicare una password errata pur non essendolo.

Mantieni la somma di `PGBOUNCER_POOL_SIZE` su tutti i pooler ampiamente inferiore a `max_connections` del database — il runtime attinge dalla stessa disponibilità.

### Cosa cambia con il transaction pooling

Un client collegato al pool mantiene una connessione server per la sola durata di una transazione e poi la rilascia, permettendo a 500 client di condividere 20 connessioni. Tre funzionalità smettono di funzionare attraverso questa porta, e ciascuna di esse è utilizzata da Rebase stesso — motivo per cui il runtime si connette direttamente e questa porta è riservata agli altri client:

- **`LISTEN`/`NOTIFY`.** Il sistema Realtime si basa su questo meccanismo, e un listener richiede una connessione che sopravviva alla singola transazione. L'istruzione `LISTEN` viene *accettata* dal pooler — risponde `LISTEN`, ma nessuna notifica viene recapitata.
- **Stato della sessione**: `SET` (a differenza di `SET LOCAL`), advisory lock mantenuti tra più istruzioni, cursori `WITH HOLD`, tabelle temporanee. La transazione successiva potrebbe essere instradata su una diversa connessione server, perdendo l'intero contesto. Entrambi i casi falliscono in modo insidioso: con un solo client inattivo lo stato spesso persiste, quindi il sistema funziona durante i test ma si blocca sotto il carico di concorrenza per cui il pooler era stato introdotto.
- **Prepared statement a livello di protocollo.** La maggior parte dei driver può essere configurata per non usarli — node-postgres non li usa per impostazione predefinita; asyncpg richiede `statement_cache_size=0`.

`SET LOCAL` ha un ambito limitato alla transazione e funziona correttamente, ed è il comando con cui viene impostata la row-level security — l'RLS si comporta quindi in modo identico anche tramite la porta del pooler.

Se nessun servizio all'infuori del runtime si connette al database, lascia il profilo disattivato. Una porta inutilizzata rappresenta solo superficie di attacco.

## Controlli di integrità (Health checks)

| Percorso | Scopo |
| --- | --- |
| `/livez` | Liveness. Risponde a "questo processo è attivo?" senza interrogare il database. |
| `/health` | Readiness. Esegue un round-trip verso il database e riporta la latenza. |

Configura i probe di liveness su `/livez`. Impostare un probe di liveness su `/health` provocherebbe il riavvio di un processo perfettamente sano durante un temporaneo rallentamento del database, ottenendo l'effetto opposto a quello desiderato.

## Metriche

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<stringa casuale>
```

Espone metriche Prometheus su `/metrics`: conteggio richieste e istogrammi di latenza suddivisi per area API (data, auth, storage, functions) e per collection, oltre a gauge relativi al processo. In assenza di token, l'endpoint è accessibile a chiunque possa raggiungere la porta, pertanto impostane uno a meno che il servizio non si trovi all'interno di una rete privata.

## Esecuzione delle funzioni in un processo dedicato

La configurazione descritta finora impiega un singolo container per l'intero progetto, soluzione ottimale per la quasi totalità dei deployment. Quando si desidera che una funzione personalizzata non competa con l'API dati per l'event loop — o debba scalare, riavviarsi e fallire in modo indipendente — la stessa immagine e lo stesso bundle possono essere avviati sotto forma di processi distinti e cooperanti. Consulta [Processi separati](/docs/deployment/split-processes/).

## Aggiornamento

```yaml
image: rebasepro/server:0.19.1
```

Riavvia il servizio. Il bundle rimane invariato. All'interno della stessa major version del contratto di runtime, un bundle validato continua a funzionare regolarmente — consulta [Compatibilità](/docs/architecture/runtime-and-bundles/#compatibility).

---
