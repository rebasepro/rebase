---
sourceHash: f1296ae912e0725e
title: Suddivisione in più processi
sidebar_label: Processi separati
description: Esegui un singolo bundle come più processi cooperanti — un'API, un livello di funzioni, un worker — dalla stessa immagine di runtime pubblicata, in modo che una funzione personalizzata pesante smetta di competere con l'API dei dati.
---

## Panoramica

Una distribuzione Rebase è normalmente un unico processo che gestisce tutto: l'API dei dati,
l'autenticazione, lo storage, le tue funzioni personalizzate, i cron e la coda dei job. Questa è la
struttura corretta per quasi tutte le distribuzioni e rimane l'impostazione predefinita.

Quando smette di essere la struttura adatta — una funzione personalizzata che blocca l'event loop,
un livello di funzioni che dovrebbe scalare o riavviarsi indipendentemente dall'API — puoi avviare
**la stessa immagine e lo stesso bundle** più volte e fare in modo che ogni
processo gestisca una parte diversa del progetto. Non c'è nulla di nuovo da compilare e
nulla di cui il client debba essere a conoscenza: gli URL non cambiano.

Una variabile d'ambiente decide cosa sia un processo:

```bash
REBASE_ROLE=api        # data, auth, admin, storage, meta — everything but functions
REBASE_ROLE=functions  # custom functions only
REBASE_ROLE=worker     # no HTTP surface: cron and the job queue
REBASE_ROLE=all        # the default: everything, one process
```

## Cosa gestisce ciascun ruolo

| | `all` | `api` | `functions` | `worker` |
| --- | :---: | :---: | :---: | :---: |
| `/api/auth`, `/api/data`, `/api/storage`, `/api/meta` | ✅ | ✅ | — | — |
| `/api/admin` (inclusi i log e l'editor dello schema) | ✅ | ✅ | — | — |
| `/api/functions/*` | ✅ | inoltra (vedi sotto) | ✅ | — |
| `/api/admin/cron` (l'interfaccia di amministrazione) | ✅ | ✅ | — | — |
| `/health`, `/livez`, `/metrics` | ✅ | ✅ | ✅ | ✅ |
| Gestisce websocket, consuma eventi di modifica | ✅ | ✅ | — | — |
| Crea lo schema all'avvio | ✅ | ✅ | — | — |
| Esegue lo scheduler dei cron | ✅ | ✅ | — | ✅ |
| Esegue i worker della coda dei job | ✅ | ✅ | — | ✅ |

Health e metriche sono presenti su ogni ruolo senza eccezioni; `/metrics` risponde solo con `REBASE_METRICS=true`. Un processo che un
orchestratore non può sondare è un processo su cui non può eseguire un rollout.

`GET /api/auth/config`,
ciò che legge la schermata di accesso, segue il resto di `/api/auth`: solo `api` e
`all` lo gestiscono.

La funzionalità Realtime è nell'elenco perché comporta un costo, indipendentemente dal fatto che qualcuno la utilizzi o
meno: un processo che consuma eventi di modifica mantiene una connessione `LISTEN` esterna
al pool per tutta la sua durata di esecuzione e installa i trigger di cattura all'avvio. Solo
un processo che gestisce websocket ha dei destinatari a cui recapitare gli eventi, quindi i due ruoli che
non ne gestiscono non fanno nessuna delle due cose. **Le scritture effettuate da tali processi vengono comunque rilevate.** Con
il change capture attivo, la cattura avviene tramite trigger del database, quindi una modifica viene pubblicata
dal database anziché dal processo che l'ha eseguita. Con il capture disattivato
(`REALTIME_CDC=off`, o con `auto` in fallback perché il ruolo del database non può
creare trigger), un processo `worker` o `functions` annuncia ciascuna delle proprie
scritture sul canale tra istanze (cross-instance), senza mantenere una connessione `LISTEN`.
In entrambi i casi, una funzione che scrive una riga risveglia comunque ogni
sottoscrittore su `api`.

Assegna a ogni processo lo stesso valore di `REALTIME_CDC`. Un processo che possiede lo schema
con `REALTIME_CDC=off` rimuove i trigger di cattura all'avvio, e un'`api`
ancora impostata su `auto` si metterebbe quindi in ascolto di modifiche che nessuno annuncia.

## Docker Compose

Due servizi da un'unica immagine, un solo bundle e un solo database:

```yaml
services:
  api:
    image: rebasepro/server:latest
    environment:
      REBASE_ROLE: api
      REBASE_FUNCTIONS_UPSTREAM: http://functions:8080
      DATABASE_URL: postgres://rebase:${POSTGRES_PASSWORD}@db:5432/rebase
      JWT_SECRET: ${JWT_SECRET}
      REBASE_SERVICE_KEY: ${REBASE_SERVICE_KEY}
      CORS_ORIGINS: ${CORS_ORIGINS}
    volumes:
      - ./dist-bundle:/bundle
    ports:
      - "8080:8080"

  functions:
    image: rebasepro/server:latest
    environment:
      REBASE_ROLE: functions
      REBASE_MIGRATE_ON_BOOT: none
      TRUSTED_PROXY_HOPS: 1
      DATABASE_URL: postgres://rebase:${POSTGRES_PASSWORD}@db:5432/rebase
      JWT_SECRET: ${JWT_SECRET}
      REBASE_SERVICE_KEY: ${REBASE_SERVICE_KEY}
      CORS_ORIGINS: ${CORS_ORIGINS}
    volumes:
      - ./dist-bundle:/bundle
```

```bash
docker compose up --scale functions=3
```

Entrambi i processi necessitano dello stesso `DATABASE_URL`, dello stesso `JWT_SECRET` e della stessa
`REBASE_SERVICE_KEY` — costituiscono una sola distribuzione, e un token generato da uno deve
essere accettato dall'altro. Un processo con `REBASE_FUNCTIONS_UPSTREAM` e senza
`REBASE_SERVICE_KEY` rifiuta di avviarsi: le sue stesse chiamate `rebase.functions.invoke(...)`,
provenienti da un hook o da un cron job, raggiungono il processo delle funzioni con quella chiave.

## Mantenere invariati gli URL

`REBASE_FUNCTIONS_UPSTREAM` indica al processo `api` di inoltrare `/api/functions/*`
al processo functions anziché gestirlo direttamente. Deve essere un URL `http://` o
`https://`; qualsiasi altra cosa interrompe l'avvio. Solo `api` e `worker` lo leggono
(vedi [Cron e job in background](#cron-e-job-in-background) per il worker). I client, gli SDK generati e le chiavi
API vedono esattamente la stessa superficie che vedevano prima della suddivisione, quindi nessun codice applicativo
deve essere modificato e non è necessario configurare un reverse proxy per provarlo.

Una distribuzione in produzione potrebbe preferire instradare il percorso direttamente a livello di ingress;
in tal caso, lascia `REBASE_FUNCTIONS_UPSTREAM` non impostato: il processo `api`
risponderà con 404 per tali percorsi e il proxy a monte deciderà dove indirizzarli.

### Hop del proxy

Quando l'API inoltra la richiesta, aggiunge l'indirizzo del chiamante a `X-Forwarded-For`. Questo
fa sì che il processo functions si trovi dietro **un hop di proxy in più** rispetto all'API,
e deve essere informato di ciò:

```bash
# api behind one ingress            → TRUSTED_PROXY_HOPS=1
# functions behind that ingress AND the api → TRUSTED_PROXY_HOPS=2
```

`TRUSTED_PROXY_HOPS` è il numero di reverse proxy effettivamente presenti davanti
a un processo. Ciascuno aggiunge l'indirizzo rilevato a `X-Forwarded-For`, quindi il
vero client corrisponde all'N-esima voce da destra; tutto ciò che si trova più a sinistra è
fornito dal client e viene ignorato, impedendo a un chiamante di falsificare l'header per
aggirare le chiavi di rate-limiting. Il valore predefinito è `0` — nessun proxy considerato attendibile.

Se si sbaglia questa configurazione, nulla si romperà visibilmente: i rate limiter sul processo functions
assoceranno ogni richiesta all'indirizzo del container API, condividendo un unico
bucket tra tutti i chiamanti, e l'IP registrato per ogni evento di autenticazione sarà lo stesso.

## Un solo processo è proprietario dello schema

Esattamente un solo processo in una distribuzione suddivisa crea tabelle e applica policy RLS
all'avvio, ovvero il processo `api` (o `all`). Tutti gli altri processi devono
impostare:

```bash
REBASE_MIGRATE_ON_BOOT=none
```

Questo è **obbligatorio**, non opzionale: un processo `functions` o `worker` lasciato con l'impostazione
predefinita rifiuterà di avviarsi, segnalando l'errore. `CREATE … IF NOT EXISTS` legge il catalogo
e poi vi scrive in due passaggi separati, quindi i processi che si avviano contemporaneamente vanno in
collisione — e una distribuzione in cui più processi competono per effettuare il provisioning dello stesso
schema non è uno scenario previsto.

In un
[server personalizzato](/docs/backend/custom-server/), la stessa decisione corrisponde all'opzione
`provision` di `createRebaseBackend`: `true` nel processo proprietario dello
schema e `{ collections: false, realtime: false }` in tutti gli altri, mantenendo
comunque le tabelle interne del framework. Anche in questo caso, `REBASE_MIGRATE_ON_BOOT=none` disattiva lo
schema delle tabelle. Le attività in background vengono decise nello stesso modo:
un processo che non chiama mai `start()` non esegue alcuno scheduler cron né worker dei job,
mentre uno che lo chiama esegue quelli assegnati dall'opzione `ownership`.

## Gestire una singola funzione per processo

Un processo può gestire un sottoinsieme specifico, consentendo a una funzione onerosa di
avere un proprio numero di repliche senza dover spostare il codice altrove:

```bash
REBASE_FUNCTIONS_ONLY=send-invoice
REBASE_FUNCTIONS_EXCLUDE=debug-tools
```

I nomi corrispondono ai nomi dei file senza estensione — lo stesso nome con cui la funzione viene montata.
Un nome non contenuto nel bundle **fa fallire l'avvio**, e l'errore elenca
i nomi effettivamente presenti. Un processo configurato per una singola funzione esiste per quella
specifica funzione, quindi un refuso che gestisse silenziosamente il nulla sarebbe il peggior risultato
possibile.

## Cron e job in background

Entrambi possono già essere eseguiti in modo sicuro in più di un processo: lo scheduler cron acquisisce
ogni coppia `(job, slot)` nel database, e la coda dei job acquisisce le righe con
`FOR UPDATE SKIP LOCKED`. Di conseguenza, `api` continua a eseguire entrambi per impostazione predefinita e una suddivisione
a due servizi è completa senza richiedere un terzo container.

Aggiungi un processo `worker` quando desideri separare le attività pianificate dal percorso delle richieste HTTP, e
disattivalo sull'API:

```yaml
  api:
    environment:
      REBASE_CRON_SCHEDULER: "false"
      REBASE_JOB_WORKERS: "false"

  worker:
    environment:
      REBASE_ROLE: worker
      REBASE_MIGRATE_ON_BOOT: none
      REBASE_SERVICE_KEY: ${REBASE_SERVICE_KEY}
      # Only if a job calls rebase.functions:
      REBASE_FUNCTIONS_UPSTREAM: http://functions:8080
```

Un job che passa a un worker mantiene `rebase.dataAsAdmin`, `rebase.sql`,
`rebase.storage` e `rebase.email`, che comunicano direttamente con il database, i bucket e
il server di posta. Mantiene inoltre:

- **`rebase.admin`** (utenti, ruoli, reimpostazione delle password) **e `rebase.cron`.** Un
  worker non espone alcuna interfaccia di amministrazione sulla sua porta, ma include questi due componenti in-process,
  esclusivamente per i propri job.
- **`rebase.functions`, con `REBASE_FUNCTIONS_UPSTREAM`.** Un worker non gestisce
  funzioni. Con l'upstream configurato, le sue chiamate `rebase.functions.invoke(...)`
  vengono inoltrate al processo functions, dove la funzione riceve la
  chiamata come servizio. Il worker continua a non rispondere a nulla sotto `/api/functions`
  sulla sua porta. Il worker necessita della `REBASE_SERVICE_KEY` della distribuzione per questa operazione,
  analogamente all'`api`.

Perde `rebase.auth`: questi rappresentano i flussi di accesso degli utenti e un worker
non ne gestisce alcuno. Per la gestione degli account all'interno di un job, usa `rebase.admin`. Perde inoltre il
resto dell'API di amministrazione (backup, log, editor dello schema e così via) e
`rebase.functions` se non è impostato un upstream. Una chiamata a uno qualsiasi di questi risponde con
`404 NOT_FOUND`, indicando quale interfaccia è disattivata e cosa fare in alternativa.

Un processo `functions` non esegue mai né l'uno né l'altro. Viene scalato in base al carico delle richieste e
sostituito a piacere; assegnargli attività pianificate darebbe al conteggio delle sue repliche un
significato improprio.

Nota che l'accodamento — `jobQueue.enqueue`, l'`enqueue` di una coda dichiarata, il
`publish` di un topic — continua a funzionare ovunque, compreso su un processo che non
esegue worker: l'accodamento è un'operazione di scrittura, mentre l'esecuzione è un ciclo di polling, ed è
solo quest'ultima a essere disattivata da un ruolo.

## Cosa non offre la suddivisione

**Rate limit condivisi, a meno che non vengano richiesti.** Lo store predefinito è per singolo processo, quindi N
processi moltiplicano la soglia consentita a ciascun chiamante per N, senza alcuna indicazione nei log.
Imposta `REBASE_RATE_LIMIT_STORE=sql` su ogni processo che gestisce traffico HTTP: il conteggio viene
effettuato in Postgres, mantenendo il limite invariato a prescindere dal numero di repliche.
(Il chart Helm lo imposta automaticamente e rifiuta di eseguire il rendering di una topologia multi-processo
che lo lasci su `memory`.)

**Canali tra istanze.** Broadcast e presence utilizzano per impostazione predefinita un bus in memoria,
che non comunica tra processi diversi. Questa è una questione legata al *numero di repliche*
più che alla suddivisione dei ruoli — vale lo stesso per una distribuzione a ruolo singolo
scalata a tre istanze — pertanto imposta `REALTIME_CHANNEL_BUS=postgres` (o `realtime.bus` nella
configurazione) ogni volta che più di un processo gestisce websocket.

**Scalabilità a zero.** Nulla in questa configurazione riduce un processo a zero o ne avvia uno
su richiesta. Questa è una funzionalità della piattaforma di hosting, non del runtime.

Tutto il resto che un processo mantiene isolato per sé è documentato in:
[Esecuzione di più istanze](/docs/deployment/multiple-instances/).

## Rilasciare una singola unità in modo indipendente

Tutto quanto descritto sopra suddivide il luogo in cui *viene eseguito il carico di lavoro*. Il tutto viene comunque distribuito come
un'unica build: una sola immagine, un solo bundle, aggiornati insieme. Questa è l'impostazione predefinita ideale, e
la maggior parte delle distribuzioni dovrebbe mantenerla.

Un'unità può anche essere mantenuta su una propria build indipendente — una correzione a una funzione che non
richiede il riavvio dell'API:

```yaml
# values.yaml
split: true
functions:
  enabled: true
  image:
    tag: "0.30.1"     # this unit only; the rest stay on the release-wide tag
```

Di solito vale la pena bloccare solo il tag: il repository viene ereditato, quindi si tratta di
un unico progetto e di un'unica immagine con una sola unità modificata. `bundleUrl` svolge la stessa funzione
quando `bundle.mode: url`.

### La regola

Due unità con build diverse corrispondono a due insiemi di tabelle a fronte di **un solo**
database, e una sola unità ne esegue il provisioning. Pertanto:

> **L'unità proprietaria dello schema viene aggiornata per prima. Un'unità può rimanere indietro; non deve mai
> anticipare.**

Questa unità è il Job di migrazione, oppure `api` quando il Job è disattivato. Un'unità in esecuzione che
*anticipa* lo schema esegue query su colonne che non esistono ancora e fa affidamento su policy RLS
che nessuno ha applicato: il primo caso genera un errore SQL su una route, il secondo un
risultato vuoto con stato 200. Un'unità che rimane *indietro* rappresenta lo stato ordinario di qualsiasi
rollout in corso.

### Cosa lo verifica

Il processo che esegue il provisioning registra nel database la versione dello schema applicata.
Tutti gli altri processi calcolano la propria versione dalle tabelle caricate ed
effettuano un confronto. In caso di discrepanza lo segnalano, indicando entrambe:

```
⚠️ [schema] The database was last provisioned from a different set of collections
   than this process was built from (database v2:6f2a…, this process v2:91cd…).
```

Emette un avviso e continua a servire traffico, poiché durante un rollout tale discrepanza è *corretta* —
le unità che non sono state ancora aggiornate devono essere indietro. Imposta
`REBASE_REQUIRE_SCHEMA_MATCH=true` (o `sharedState.requireSchemaMatch` nel
chart) per rifiutare invece l'avvio, in una distribuzione in cui si preferisce non erogare alcun servizio
piuttosto che servire risposte errate.

Entrambi i lati del confronto vengono **calcolati**, mai letti da un manifest. La
versione che una build dichiara su se stessa non è una prova del fatto che il database sia allineato
con essa.

Nulla verifica la *direzione* — la versione dello schema è un hash, quindi può rilevare che
le due versioni differiscono, ma mai quale sia la più recente. Questo è il motivo per cui l'ordine di rollout è una
regola da seguire anziché un vincolo applicabile dal runtime.

## Aggiornamento

Invariato: ogni processo esegue la stessa immagine pubblicata, quindi un aggiornamento consiste nella stessa
modifica di tag su ciascuno di essi. Esegui prima il rollout del processo proprietario dello schema — `api`
o il Job di migrazione — in modo che lo schema della nuova versione sia operativo prima che
gli altri processi vengano eseguiti a fronte di esso: un'unità può restare indietro, mai anticipare (vedi
[La regola](#la-regola)).

## Risorse correlate

- [Guida alla distribuzione](/docs/getting-started/deployment/) — la distribuzione a processo singolo da cui deriva questa suddivisione
- [Ambiente e configurazione](/docs/getting-started/configuration/) — `REBASE_ROLE`, `REBASE_CRON_SCHEDULER` e `REBASE_MIGRATE_ON_BOOT`
- [Kubernetes](/docs/deployment/kubernetes/) — un deployment per ruolo
