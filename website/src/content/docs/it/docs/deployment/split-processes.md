---
sourceHash: f09c52453f45b58d
title: Suddivisione in più processi
sidebar_label: Processi separati
description: Esegui un unico bundle come più processi cooperanti — un'API, un livello di funzioni, un worker — dalla stessa immagine runtime pubblicata, in modo che una funzione personalizzata pesante non competa più con l'API dei dati.
---

## Panoramica

Una distribuzione di Rebase è normalmente un unico processo che gestisce tutto: l'API dei dati,
l'autenticazione, lo storage, le tue funzioni personalizzate, il cron e la coda di job. Questa è la struttura
ideale per quasi ogni distribuzione e rimane l'impostazione predefinita.

Quando smette di essere la struttura adatta — una funzione personalizzata che blocca l'event loop,
un livello di funzioni che dovrebbe scalare o riavviarsi indipendentemente dall'API — puoi
avviare **la stessa immagine e lo stesso bundle** più volte e fare in modo che ciascun
processo gestisca una parte diversa del progetto. Non c'è nulla di nuovo da compilare e
nulla di cui un client debba essere a conoscenza: gli URL non cambiano.

Una singola variabile d'ambiente decide il ruolo di un processo:

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
| Gestisce i websocket, consuma gli eventi di modifica | ✅ | ✅ | — | — |
| Crea lo schema all'avvio | ✅ | ✅ | — | — |
| Esegue lo scheduler cron | ✅ | ✅ | — | ✅ |
| Esegue i worker della coda di job | ✅ | ✅ | — | ✅ |

Health e metriche sono presenti in ogni ruolo senza eccezioni; `/metrics` risponde solo con `REBASE_METRICS=true`. Un processo di cui
un orchestratore non può verificare lo stato è un processo che non può aggiornare gradualmente.

`GET /api/auth/config`,
ciò che legge la schermata di accesso, segue il resto di `/api/auth`: solo `api` e
`all` lo gestiscono.

Realtime è nell'elenco perché comporta un costo a prescindere dal fatto che qualcuno lo usi o
meno: un processo che consuma eventi di modifica mantiene una connessione `LISTEN` al di fuori
del pool per tutta la durata della sua esecuzione e installa i trigger di cattura all'avvio. Solo
un processo che gestisce websocket ha dei destinatari a cui recapitare gli eventi, quindi i due ruoli che
non ne gestiscono non fanno nessuna delle due cose. **Le scritture eseguite da tali processi vengono comunque rilevate.** Con
il change capture abilitato, la cattura avviene tramite trigger del database, quindi una modifica viene pubblicata
dal database anziché dal processo che l'ha effettuata. Con la cattura disabilitata
(`REALTIME_CDC=off`, o fallback ad `auto` perché il ruolo del database non può
creare trigger), un processo `worker` o `functions` annuncia ciascuna delle proprie
scritture sul canale tra istanze (cross-instance), senza mantenere una connessione `LISTEN`.
In entrambi i casi, una funzione che scrive una riga risveglia comunque tutti i
sottoscrittori su `api`.

Assegna a ogni processo lo stesso valore di `REALTIME_CDC`. Un processo proprietario
dello schema con `REALTIME_CDC=off` rimuove i trigger di cattura all'avvio, e un'`api`
ancora impostata su `auto` rimarrebbe in ascolto di modifiche che nessuno annuncerà mai.

## Docker Compose

Due servizi da una sola immagine, un bundle e un database:

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
`REBASE_SERVICE_KEY` — costituiscono un'unica distribuzione e un token generato da uno deve essere
accettato dall'altro. Un processo con `REBASE_FUNCTIONS_UPSTREAM` e senza
`REBASE_SERVICE_KEY` rifiuterà di avviarsi: le sue stesse chiamate `rebase.functions.invoke(...)`,
provenienti da un hook o da un cron job, raggiungono il processo delle funzioni con quella chiave.

## Mantenere invariati gli URL

`REBASE_FUNCTIONS_UPSTREAM` indica al processo `api` di inoltrare `/api/functions/*`
al processo delle funzioni anziché gestirlo direttamente. Deve essere un URL `http://` o
`https://`; qualsiasi altra cosa blocca l'avvio. Solo `api` e `worker` lo leggono
(vedi [Cron e job in background](#cron-e-job-in-background) per il worker). I client, gli SDK generati e le chiavi
API vedono esattamente la stessa superficie visibile prima della separazione, quindi nessun codice applicativo
deve essere modificato e non è necessario configurare un reverse proxy per provarlo.

Un deployment in produzione potrebbe preferire instradare il percorso a livello del proprio ingress; in tal
caso, lascia `REBASE_FUNCTIONS_UPSTREAM` non impostato — il processo `api`
risponderà con un 404 per tali percorsi e il proxy a monte deciderà dove indirizzarli.

### Hop del proxy

Quando l'API inoltra la richiesta, aggiunge l'indirizzo del chiamante a `X-Forwarded-For`. Questo
fa sì che il processo delle funzioni si trovi dietro **un hop di proxy in più** rispetto all'API,
e deve esserne informato:

```bash
# api behind one ingress            → TRUSTED_PROXY_HOPS=1
# functions behind that ingress AND the api → TRUSTED_PROXY_HOPS=2
```

`TRUSTED_PROXY_HOPS` è il numero di reverse proxy effettivamente eseguiti davanti
a un processo. Ciascuno di essi aggiunge l'indirizzo rilevato a `X-Forwarded-For`, quindi il
vero client corrisponde all'N-esima voce da destra; tutto ciò che si trova più a sinistra è
fornito dal client e viene ignorato, il che impedisce a un chiamante di falsificare l'header per
aggirare le chiavi di rate-limiting. Il valore predefinito è `0` — nessun proxy considerato attendibile.

Se questo valore viene configurato in modo errato, nulla si rompe in modo evidente: i rate limiter sul processo delle funzioni
associano ogni richiesta all'indirizzo del container dell'API, facendo sì che tutti i chiamanti condividano
lo stesso bucket, e l'IP registrato per ogni evento di autenticazione risulterà essere sempre lo stesso.

## Un solo processo è proprietario dello schema

Esattamente un processo in una distribuzione suddivisa crea le tabelle e applica i criteri RLS
all'avvio, e questo è il processo `api` (o `all`). Tutti gli altri processi devono
impostare:

```bash
REBASE_MIGRATE_ON_BOOT=none
```

Questo è **obbligatorio**, non facoltativo: un processo `functions` o `worker` lasciato con l'impostazione
predefinita si rifiuterà di avviarsi, segnalandolo esplicitamente. `CREATE … IF NOT EXISTS` legge il catalogo
e poi vi scrive in due passaggi separati, quindi i processi che si avviano contemporaneamente entrano in
conflitto — e un deployment in cui più processi competono per effettuare il provisioning dello stesso
schema non è uno scenario previsto.

In un
[server personalizzato](/docs/backend/custom-server/), la stessa decisione corrisponde all'opzione
`provision` di `createRebaseBackend`: `true` nel processo proprietario dello
schema e `{ tables: false, realtime: false }` in tutti gli altri, mantenendo
comunque le tabelle interne del framework. Anche in questo caso, `REBASE_MIGRATE_ON_BOOT=none` disabilita lo
schema delle tabelle. Il lavoro in background viene gestito nello stesso modo:
un processo che non chiama mai `start()` non esegue alcuno scheduler cron né worker di job,
mentre un processo che lo chiama esegue quelli assegnati dall'opzione `ownership`.

## Gestire una singola funzione per processo

Un processo può gestire un sottoinsieme designato, ed è così che a una funzione particolarmente onerosa
può essere assegnato un numero dedicato di repliche senza doverne spostare il codice altrove:

```bash
REBASE_FUNCTIONS_ONLY=send-invoice
REBASE_FUNCTIONS_EXCLUDE=debug-tools
```

I nomi sono i nomi dei file privi di estensione — lo stesso nome con cui la funzione è montata.
Un nome non presente nel bundle **fa fallire l'avvio**, e l'errore elenca i nomi
effettivamente presenti. Un processo configurato per una singola funzione esiste esclusivamente per quella
funzione, pertanto un refuso che portasse a non erogare silenziosamente nulla sarebbe il peggior risultato
possibile.

## Cron e job in background

Entrambi possono già essere eseguiti in sicurezza in più processi: lo scheduler cron acquisisce
ogni coppia `(job, slot)` nel database e la coda di job acquisisce le righe con
`FOR UPDATE SKIP LOCKED`. Di conseguenza, `api` continua a eseguire entrambi per impostazione predefinita e la
suddivisione in due servizi è completa senza bisogno di un terzo container.

Aggiungi un processo `worker` quando desideri spostare il lavoro pianificato al di fuori del percorso delle richieste HTTP, e
disabilitalo sull'API:

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

Un job trasferito su un worker mantiene `rebase.dataAsAdmin`, `rebase.sql`,
`rebase.storage` e `rebase.email`, che comunicano direttamente con il database, i bucket e
il server di posta. Mantiene inoltre:

- **`rebase.admin`** (utenti, ruoli, reimpostazioni password) **e `rebase.cron`.** Un
  worker non espone alcuna interfaccia di amministrazione sulla sua porta, ma include entrambi in-process,
  esclusivamente per i propri job.
- **`rebase.functions`, con `REBASE_FUNCTIONS_UPSTREAM`.** Un worker non gestisce
  funzioni. Con l'upstream configurato, le sue chiamate `rebase.functions.invoke(...)`
  vengono inoltrate al processo delle funzioni, dove la funzione riceve la
  chiamata con privilegi di servizio. Il worker continua a non rispondere a nulla sotto `/api/functions`
  sulla propria porta. Per fare ciò, il worker necessita della `REBASE_SERVICE_KEY` del deployment,
  esattamente come l'`api`.

Perde `rebase.auth`: questi rappresentano i flussi di accesso degli utenti, e un worker
non ne gestisce alcuno. Per operazioni sugli account all'interno di un job, utilizza `rebase.admin`. Perde inoltre il
resto dell'API di amministrazione (backup, log, editor dello schema e così via), e
`rebase.functions` quando non è impostato alcun upstream. Una chiamata a uno qualsiasi di questi risponde con
`404 NOT_FOUND`, indicando l'interfaccia disabilitata e l'alternativa da adottare.

Un processo `functions` non esegue mai né l'uno né l'altro. Viene scalato in base al carico delle richieste e
sostituito liberamente; assegnargli lavoro pianificato altererebbe il significato del suo numero di
repliche.

Tieni presente che l'accodamento — `jobQueue.enqueue`, l'`enqueue` di una coda dichiarata, il
`publish` di un topic — continua a funzionare ovunque, anche su un processo che non esegue
worker: l'accodamento è un'operazione di scrittura, l'esecuzione è un ciclo di polling, e solo
quest'ultimo viene disattivato dal ruolo.

## Cosa non offre la suddivisione

**Rate limit condivisi, a meno che non vengano richiesti esplicitamente.** Lo store predefinito è per processo, pertanto N
processi moltiplicano la soglia di ogni chiamante per N senza che alcun log lo segnali. Imposta
`REBASE_RATE_LIMIT_STORE=sql` su ogni processo che gestisce HTTP: il conteggio avviene in Postgres,
quindi il limite rimane invariato a prescindere dal numero di repliche. (Il chart Helm lo imposta
automaticamente e rifiuta di effettuare il rendering di una topologia multi-processo che lo lasci impostato su `memory`.)

**Canali tra istanze (cross-instance).** Broadcast e presence utilizzano per impostazione predefinita un bus in memoria,
che non comunica tra processi diversi. Si tratta di una questione legata al *numero di repliche*
piuttosto che alla suddivisione dei processi — vale lo stesso per un deployment a ruolo singolo
scalato a tre istanze — pertanto imposta `REALTIME_CHANNEL_BUS=postgres` (o `realtime.bus` nella
configurazione) ogni volta che più di un processo gestisce websocket.

**Scale-to-zero.** Nessun meccanismo qui descritto scala un processo a zero o ne avvia uno
su richiesta. Questa è una funzionalità della piattaforma di hosting, non del runtime.

Tutto il resto che un processo mantiene isolato è raccolto nell'elenco:
[Esecuzione di più istanze](/docs/deployment/multiple-instances/).

## Rilasciare una singola unità in modo indipendente

Tutto quanto sopra suddivide *il luogo in cui viene eseguito il lavoro*. L'intero sistema viene comunque distribuito come
un'unica build: una sola immagine, un solo bundle, aggiornati insieme. Questa è l'impostazione predefinita
corretta e la maggior parte delle distribuzioni dovrebbe mantenerla.

Un'unità può anche essere vincolata a una propria build specifica — una correzione a una funzione che non
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
un solo progetto e di una sola immagine con una singola unità modificata. `bundleUrl` svolge la stessa funzione
quando `bundle.mode: url`.

### La regola

Due unità su build differenti equivalgono a due insiemi di tabelle a fronte di **un solo**
database, e una sola unità ne esegue il provisioning. Pertanto:

> **L'unità proprietaria dello schema viene aggiornata per prima. Un'unità può rimanere indietro; non deve mai
> essere in anticipo.**

Tale unità è il Job di migrazione, oppure l'`api` quando il Job non è attivo. Un'unità in esecuzione in
*anticipo* rispetto allo schema interroga colonne che non esistono ancora e si affida a criteri RLS
che nessuno ha applicato — il primo caso genera un errore SQL su una route, il secondo un
risultato vuoto con codice di stato 200. Un'unità in esecuzione in *ritardo* rappresenta il normale stato di qualsiasi
rollout in corso.

### Cosa effettua la verifica

Il processo che esegue il provisioning registra nel database la versione dello schema applicata.
Tutti gli altri processi calcolano la propria versione dalle tabelle caricate ed
effettuano un confronto. In caso di discrepanza lo segnalano, indicando entrambe le versioni:

```
⚠️ [schema] The database was last provisioned from a different set of tables
   than this process was built from (database v2:6f2a…, this process v2:91cd…).
```

Mostra un avviso e continua a rispondere alle richieste, perché durante un rollout tale discrepanza è *corretta* —
le unità non ancora aggiornate dovrebbero trovarsi indietro. Imposta
`REBASE_REQUIRE_SCHEMA_MATCH=true` (o `sharedState.requireSchemaMatch` nel
chart) per rifiutare invece l'avvio, in un deployment in cui si preferisce non rispondere
affatto piuttosto che rispondere in modo errato.

Entrambi i termini di questo confronto sono **calcolati**, mai letti da un manifest. La
versione che una build dichiara per se stessa non è una prova del fatto che il database sia allineato
con essa.

Nulla controlla la *direzione* — la versione dello schema è un hash, quindi può rilevare che le
due versioni non coincidono, ma mai quale sia più avanzata. È questo che rende l'ordine di rollout una
regola da seguire manualmente, piuttosto che un vincolo imponibile dal runtime.

## Aggiornamento

Invariato: ogni processo esegue la stessa immagine pubblicata, quindi un aggiornamento consiste nella stessa
modifica del tag su ciascuno di essi. Esegui prima il rollout del processo proprietario dello schema — l'`api`,
o il Job di migrazione — affinché lo schema della nuova versione sia pronto prima
che gli altri processi vi operino contro: un'unità può rimanere indietro, mai anticipare (vedi
[La regola](#la-regola)).

## Correlati

- [Guida al deployment](/docs/getting-started/deployment/) — il deployment a processo singolo da cui questo si suddivide
- [Ambiente e configurazione](/docs/getting-started/configuration/) — `REBASE_ROLE`, `REBASE_CRON_SCHEDULER` e `REBASE_MIGRATE_ON_BOOT`
- [Kubernetes](/docs/deployment/kubernetes/) — un deployment per ruolo
