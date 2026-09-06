---
sourceHash: 6fed2244f8f617c0
title: Suddividere in più processi
sidebar_label: Processi separati
description: "Esegui un bundle come più processi che cooperano — un'API, un livello di funzioni, un worker — dalla stessa immagine di runtime pubblicata, così una funzione personalizzata pesante smette di competere con l'API dei dati."
---

## Panoramica

Un deployment di Rebase è normalmente un unico processo che serve tutto: l'API
dei dati, l'autenticazione, lo storage, le tue funzioni personalizzate, il cron e
la coda dei job. È la forma giusta per quasi ogni deployment e resta quella
predefinita.

Quando smette di esserlo — una funzione personalizzata che blocca l'event loop, o
un livello di funzioni che dovrebbe scalare o riavviarsi indipendentemente
dall'API — puoi avviare **la stessa immagine e lo stesso bundle** più volte e far
sì che ogni processo serva una parte diversa del progetto. Non c'è nulla di nuovo
da costruire e nulla che il client debba sapere: gli URL non cambiano.

Una variabile d'ambiente decide cos'è un processo:

```bash
REBASE_ROLE=api        # data, auth, admin, storage, meta — everything but functions
REBASE_ROLE=functions  # custom functions only
REBASE_ROLE=worker     # no HTTP surface: cron and the job queue
REBASE_ROLE=all        # the default: everything, one process
```

## Cosa serve ogni ruolo

| | `all` | `api` | `functions` | `worker` |
| --- | :---: | :---: | :---: | :---: |
| `/api/auth`, `/api/data`, `/api/storage`, `/api/meta` | ✅ | ✅ | — | — |
| `/api/admin`, `/api/logs`, l'editor di schema | ✅ | ✅ | — | — |
| `/api/functions/*` | ✅ | inoltra (vedi sotto) | ✅ | — |
| `/api/cron` (la superficie di amministrazione) | ✅ | ✅ | — | — |
| `/health`, `/livez`, `/metrics` | ✅ | ✅ | ✅ | ✅ |
| Serve i websocket, consuma gli eventi di modifica | ✅ | ✅ | — | — |
| Crea lo schema all'avvio | ✅ | ✅ | — | — |
| Esegue lo scheduler del cron | ✅ | ✅ | — | ✅ |
| Esegue i worker della coda dei job | ✅ | ✅ | — | ✅ |

Health e metriche sono presenti su ogni ruolo, senza eccezioni. Un processo che
un orchestratore non può sondare è un processo che non può aggiornare.

Il realtime è in elenco perché costa qualcosa che qualcuno lo usi o no: un
processo che consuma eventi di modifica tiene aperta una connessione `LISTEN`
fuori dal pool per tutta la sua vita, e all'avvio installa i trigger di cattura.
Solo un processo che serve websocket ha qualcuno a cui consegnare, quindi i due
ruoli che non ne servono non fanno né l'una né l'altra cosa. **Le scritture fatte
da quei processi si sentono comunque**: la cattura sono trigger di database,
quindi una modifica è pubblicata dal database e non dal processo che l'ha fatta.
Una funzione che scrive una riga sveglia ancora tutti i sottoscrittori
sull'`api`.

## Docker Compose

Due servizi da un'immagine, un bundle e un database:

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

Entrambi i processi hanno bisogno dello stesso `DATABASE_URL`, dello stesso
`JWT_SECRET` e della stessa `REBASE_SERVICE_KEY`: sono un solo deployment, e un
token emesso da uno deve essere accettato dall'altro.

## Mantenere gli stessi URL

`REBASE_FUNCTIONS_UPSTREAM` dice al processo `api` di inoltrare
`/api/functions/*` al processo delle funzioni invece di servirlo. Client, SDK
generati e chiavi API vedono esattamente la superficie che vedevano prima della
suddivisione, quindi nessun codice applicativo cambia e non serve allestire un
reverse proxy per provarla.

Un deployment di produzione può preferire instradare quel percorso nel proprio
ingress: in quel caso lascia `REBASE_FUNCTIONS_UPSTREAM` non impostata — il
processo `api` risponderà 404 su quei percorsi e sarà il proxy davanti a decidere
dove vanno.

### Hop di proxy

Quando l'API inoltra, aggiunge l'indirizzo del chiamante a `X-Forwarded-For`.
Questo mette il processo delle funzioni dietro **un hop di proxy in più**
rispetto all'API, e bisogna dirglielo:

```bash
# api behind one ingress            → TRUSTED_PROXY_HOPS=1
# functions behind that ingress AND the api → TRUSTED_PROXY_HOPS=2
```

`TRUSTED_PROXY_HOPS` è il numero di reverse proxy che hai realmente davanti a un
processo. Ognuno aggiunge a `X-Forwarded-For` l'indirizzo che ha visto, quindi il
client reale è l'N-esima voce da destra; tutto ciò che sta più a sinistra è
fornito dal client e viene ignorato — ed è questo che impedisce di falsificare
l'header per ruotare le chiavi del rate limiter. Il valore predefinito è `0`:
nessun proxy è considerato affidabile.

Se sbagli qui non si rompe nulla di visibile: i rate limiter del processo delle
funzioni associano ogni richiesta all'indirizzo del container dell'API, così
tutti i chiamanti condividono un solo bucket e l'IP registrato su ogni evento di
autenticazione è sempre lo stesso.

## Un solo processo possiede lo schema

Esattamente un processo di un deployment suddiviso crea le tabelle e applica le
policy RLS all'avvio, ed è quello `api` (o `all`). Ogni altro processo deve
impostare:

```bash
REBASE_MIGRATE_ON_BOOT=none
```

È **obbligatorio**, non un consiglio: un processo `functions` o `worker` lasciato
sul valore predefinito rifiuta di avviarsi, e lo dice. `CREATE … IF NOT EXISTS`
legge il catalogo e poi ci scrive in due passi distinti, quindi processi che si
avviano insieme collidono davvero — e un deployment in cui più di uno corre per
creare lo stesso schema non è un deployment progettato da nessuno.

## Servire una funzione per processo

Un processo può servire un sottoinsieme nominato: è così che una funzione costosa
ottiene il proprio numero di repliche senza che il suo codice si sposti da
nessuna parte.

```bash
REBASE_FUNCTIONS_ONLY=send-invoice
REBASE_FUNCTIONS_EXCLUDE=debug-tools
```

I nomi sono i nomi dei file senza estensione, gli stessi con cui la funzione
viene montata. Un nome che il bundle non contiene **fa fallire l'avvio**, e
l'errore elenca i nomi che invece contiene. Un processo configurato per una
funzione esiste per quella funzione, quindi un refuso che servisse silenziosamente
nulla sarebbe l'esito peggiore possibile.

## Cron e job in background

Entrambi sono già sicuri su più processi: lo scheduler del cron rivendica ogni
coppia `(job, slot)` nel database, e la coda dei job rivendica le righe con
`FOR UPDATE SKIP LOCKED`. Per questo `api` continua a eseguirli entrambi per
impostazione predefinita e una suddivisione in due servizi è completa senza un
terzo container.

Aggiungi un processo `worker` quando vuoi togliere il lavoro pianificato dal
percorso delle richieste, e disattivalo sull'API:

```yaml
  api:
    environment:
      REBASE_CRON_SCHEDULER: "false"
      REBASE_JOB_WORKERS: "false"

  worker:
    environment:
      REBASE_ROLE: worker
      REBASE_MIGRATE_ON_BOOT: none
```

Un processo `functions` non esegue mai nessuno dei due. Scala in base al carico
di richieste e viene sostituito a piacere: dargli lavoro pianificato renderebbe
il suo numero di repliche significativo, cosa che non deve essere.

Nota che `rebase.jobs.enqueue` continua a funzionare ovunque, anche su un
processo che non esegue worker: accodare è una scrittura, eseguire è un ciclo di
polling, e solo il secondo è ciò che un ruolo disattiva.

## Cosa la suddivisione non ti dà

**Rate limit condivisi, se li chiedi.** Lo store è per processo per impostazione
predefinita, quindi N processi moltiplicano per N il budget di ogni chiamante, e
nessun log lo dice. Imposta `REBASE_RATE_LIMIT_STORE=sql` su ogni processo che
serve HTTP: conta in Postgres, quindi il limite è il limite comunque siano le
repliche. (Il chart Helm lo imposta per te e si rifiuta di renderizzare una
topologia multi-processo che lo lasci su `memory`.)

**Canali tra istanze.** Broadcast e presence usano per impostazione predefinita
un bus in memoria, che non attraversa i processi. È una questione di *numero di
repliche* più che di suddivisione — vale allo stesso modo per un deployment a
ruolo singolo scalato a tre — quindi imposta `REALTIME_CHANNEL_BUS=postgres` (o
`realtime.bus` nella configurazione) ogni volta che più di un processo serve
websocket.

**Scale to zero.** Niente di tutto questo riduce un processo a zero né ne avvia
uno su richiesta. È una capacità della piattaforma, non del runtime.

## Rilasciare una unità per conto suo

Tutto quanto sopra divide *dove* gira il lavoro. Il tutto viene comunque
rilasciato come una sola build: un'immagine, un bundle, distribuiti insieme. È il
default giusto, e la maggior parte dei deployment dovrebbe restare lì.

Una unità può però essere tenuta su una build propria — una correzione a una
funzione che non riavvia l'API:

```yaml
# values.yaml
split: true
functions:
  enabled: true
  image:
    tag: "0.17.3"     # solo questa unità; il resto resta sul tag del release
```

Di solito conviene fissare solo il tag: il repository viene ereditato, quindi
resta un progetto e un'immagine con una unità spostata. `bundleUrl` fa lo stesso
quando `bundle.mode: url`.

### La regola

Due unità su build diverse sono due insiemi di collection contro **un solo**
database, e una sola unità lo provisiona. Quindi:

> **L'unità che possiede lo schema si distribuisce per prima. Una unità può
> restare indietro; non deve mai andare avanti.**

È il Job di migrazione, oppure l'`api` quando il Job è spento. Una unità *avanti*
rispetto allo schema interroga colonne che non esistono ancora e si affida a
policy RLS che nessuno ha applicato — la prima è un errore SQL su una rotta, la
seconda un risultato vuoto con un 200. Una unità *indietro* è lo stato ordinario
di qualunque rollout in corso.

### Che cosa lo controlla

Il processo che provisiona registra nel database la versione di schema che ha
applicato. Ogni altro processo calcola la propria dalle collection che ha
caricato e confronta. In caso di disaccordo lo dice, nominando entrambe:

```
⚠️ [schema] The database was last provisioned from a different set of collections
   than this process was built from (database v1:6f2a…, this process v1:91cd…).
```

Avvisa e serve, perché durante un rollout quel disaccordo è *corretto*: le unità
non ancora distribuite devono essere indietro. Imposta
`REBASE_REQUIRE_SCHEMA_MATCH=true` (o `sharedState.requireSchemaMatch` nel chart)
per rifiutare l'avvio, su un deployment che preferisce non servire piuttosto che
servire sbagliato.

Entrambi i lati di quel confronto sono **calcolati**, mai letti da un manifest.
Una versione che una build afferma su sé stessa non prova che il database sia
d'accordo.

Nulla controlla la *direzione* — una versione di schema è un hash: può dire che
le due divergono, mai quale sia avanti. Per questo l'ordine del rollout è una
regola che segui, non una che il runtime possa imporre.

## Aggiornamento

Invariato: ogni processo esegue la stessa immagine pubblicata, quindi
l'aggiornamento è lo stesso cambio di tag su ciascuno. Aggiorna `api` per ultimo
se vuoi che il provisioning dello schema avvenga prima sulla nuova versione —
anche se in pratica l'ordine non conta, perché il passo dello schema è additivo e
idempotente.
