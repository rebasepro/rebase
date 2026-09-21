---
sourceHash: 4497d118312ff8ce
title: Suddivisione in più processi
sidebar_label: Processi separati
description: Esegui un unico bundle suddiviso in vari processi cooperanti — un'API, un livello per le funzioni, un worker — a partire dalla stessa immagine di runtime pubblicata, evitando che una funzione custom pesante competa con l'API dati.
---

## Panoramica

Un deployment di Rebase è normalmente costituito da un unico processo che gestisce tutto: l'API dati,
l'autenticazione, lo storage, le tue funzioni personalizzate, il cron e la coda dei job. Questa è la configurazione
ideale per quasi tutti i deployment e rimane quella predefinita.

Quando smette di essere la configurazione adatta — ad esempio per via di una funzione personalizzata che blocca l'event loop
o di un livello di funzioni che dovrebbe scalare o riavviarsi indipendentemente dall'API — puoi avviare
**la stessa immagine e lo stesso bundle** più volte, facendo in modo che ogni
processo gestisca una parte diversa del progetto. Non c'è nulla di nuovo da compilare e
nulla che un client debba sapere: gli URL non cambiano.

Una singola variabile d'ambiente determina il ruolo di un processo:

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
| `/api/admin`, `/api/logs`, l'editor dello schema | ✅ | ✅ | — | — |
| `/api/functions/*` | ✅ | inoltra (vedi sotto) | ✅ | — |
| `/api/cron` (la superficie admin) | ✅ | ✅ | — | — |
| `/health`, `/livez`, `/metrics` | ✅ | ✅ | ✅ | ✅ |
| Gestisce i websocket, consuma eventi di modifica | ✅ | ✅ | — | — |
| Crea lo schema all'avvio | ✅ | ✅ | — | — |
| Esegue lo scheduler del cron | ✅ | ✅ | — | ✅ |
| Esegue i worker della coda dei job | ✅ | ✅ | — | ✅ |

Health e metriche sono presenti su ciascun ruolo senza eccezioni. Un processo che un
orchestratore non può sottoporre a probe è un processo di cui non può effettuare il rollout.

Il realtime è presente nell'elenco perché ha un costo a prescindere dal fatto che venga usato o
meno: un processo che consuma eventi di modifica mantiene attiva una connessione `LISTEN` al di fuori
del pool per tutta la sua esecuzione, e installa i trigger di acquisizione all'avvio. Solo
un processo che gestisce websocket ha dei destinatari a cui inviare i dati, quindi i due ruoli che
non ne gestiscono non fanno nessuna delle due cose. **Le scritture effettuate da tali processi vengono comunque rilevate** — l'acquisizione
avviene tramite trigger di database, quindi una modifica viene pubblicata dal database anziché
dal singolo processo che l'ha eseguita. Una funzione che scrive una riga attiva comunque
ogni subscriber sull'`api`.

## Docker Compose

Due servizi a partire da un'unica immagine, un unico bundle e un unico database:

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

Entrambi i processi necessitano dello stesso `DATABASE_URL`, dello stesso `JWT_SECRET` e dello stesso
`REBASE_SERVICE_KEY` — costituiscono un unico deployment, e un token generato da uno deve essere
accettato dall'altro.

## Mantenere invariati gli URL

`REBASE_FUNCTIONS_UPSTREAM` indica al processo `api` di inoltrare `/api/functions/*`
al processo delle funzioni invece di gestirlo direttamente. I client, gli SDK generati e le chiavi
API vedono esattamente la stessa superficie visibile prima della separazione, di conseguenza non è
necessario modificare il codice dell'applicazione né configurare un reverse proxy per provarlo.

Un deployment di produzione potrebbe preferire instradare il percorso direttamente a livello del proprio ingress;
in tal caso, lascia non impostato `REBASE_FUNCTIONS_UPSTREAM` — il processo `api`
risponderà con un 404 per tali percorsi e sarà il proxy a monte a decidere dove indirizzarli.

### Hop del proxy

Quando l'API inoltra la richiesta, aggiunge l'indirizzo del chiamante a `X-Forwarded-For`. Ciò
fa sì che il processo delle funzioni si trovi dietro **un hop di proxy in più** rispetto all'API,
e deve esserne informato:

```bash
# api behind one ingress            → TRUSTED_PROXY_HOPS=1
# functions behind that ingress AND the api → TRUSTED_PROXY_HOPS=2
```

`TRUSTED_PROXY_HOPS` è il numero di reverse proxy effettivamente presenti davanti
a un processo. Ciascuno di essi aggiunge l'indirizzo rilevato a `X-Forwarded-For`, quindi il
vero client corrisponde all'N-esima voce da destra; tutto ciò che si trova più a sinistra è
fornito dal client e viene ignorato, impedendo così a un chiamante di falsificare l'header per
aggirare le chiavi di rate limiting. Il valore predefinito è `0` — nessun proxy fidato.

Se questo valore viene impostato in modo errato, nulla si rompe in modo evidente: i rate limiter sul processo delle funzioni
associano ogni richiesta all'indirizzo del container API, facendo sì che tutti i chiamanti condividano
lo stesso bucket e che l'IP registrato per ogni evento di autenticazione sia identico.

## Un solo processo gestisce lo schema

In un deployment suddiviso, esattamente un solo processo crea le tabelle e applica le policy
RLS all'avvio, ed è quello `api` (o `all`). Tutti gli altri processi devono
impostare:

```bash
REBASE_MIGRATE_ON_BOOT=none
```

Questo è **obbligatorio**, non facoltativo: un processo `functions` o `worker` lasciato con il
valore predefinito rifiuta di avviarsi, segnalandolo esplicitamente. `CREATE … IF NOT EXISTS` legge il catalogo
e successivamente vi scrive in due passaggi separati, quindi processi avviati contemporaneamente entrano in
conflitto — e un deployment in cui più istanze competono per effettuare il provisioning dello stesso
schema non è uno scenario previsto.

## Esecuzione di una sola funzione per processo

Un processo può gestire un sottoinsieme specifico, consentendo a una funzione particolarmente onerosa
di avere un proprio numero di repliche senza doverne spostare il codice:

```bash
REBASE_FUNCTIONS_ONLY=send-invoice
REBASE_FUNCTIONS_EXCLUDE=debug-tools
```

I nomi corrispondono ai nomi dei file senza estensione — lo stesso nome con cui la funzione viene
montata. Un nome non presente nel bundle **causa il fallimento dell'avvio** e l'errore elenca
i nomi effettivamente contenuti. Un processo configurato per una specifica funzione esiste esclusivamente per
essa, pertanto un refuso che portasse a non erogare silenziosamente nulla rappresenterebbe lo scenario peggiore.

## Cron e job in background

Entrambi possono già essere eseguiti in sicurezza su più processi: lo scheduler del cron acquisisce
ciascuna coppia `(job, slot)` nel database, e la coda dei job acquisisce le righe con
`FOR UPDATE SKIP LOCKED`. Di conseguenza, per impostazione predefinita `api` continua a eseguire entrambi,
rendendo completa una suddivisione a due servizi senza richiedere un terzo container.

Aggiungi un processo `worker` quando desideri spostare le attività pianificate fuori dal percorso delle richieste HTTP,
e disattivale sull'API:

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

Un processo `functions` non esegue mai nessuno dei due. La sua scalabilità dipende dal
carico delle richieste e viene sostituito liberamente; assegnargli attività pianificate darebbe
al suo numero di repliche un significato improprio.

Tieni presente che `rebase.jobs.enqueue` continua a funzionare ovunque, anche su un processo
che non esegue worker — l'accodamento è una scrittura, l'esecuzione è un ciclo di polling, e
solo quest'ultimo viene disattivato da un ruolo.

## Cosa non offre la suddivisione

**Rate limit condivisi, a meno che non vengano richiesti.** Lo store predefinito è per singolo processo, quindi N
processi moltiplicano la quota a disposizione di ciascun chiamante per N senza che alcun log lo
segnali. Imposta `REBASE_RATE_LIMIT_STORE=sql` su ogni processo che gestisce traffico HTTP — il
conteggio avviene in Postgres, quindi il limite rimane lo stesso indipendentemente dal numero di repliche.
(Il chart Helm lo imposta automaticamente e si rifiuta di eseguire il rendering di una topologia multi-processo
che lo lasci impostato su `memory`).

**Canali tra istanze diverse.** Broadcast e presence utilizzano per impostazione predefinita un bus in memoria,
che non oltrepassa i confini del singolo processo. Questa è una questione legata al *numero di repliche*
piuttosto che alla suddivisione dei ruoli — vale ugualmente per un deployment con ruolo singolo
scalato a tre repliche — pertanto imposta `REALTIME_CHANNEL_BUS=postgres` (o `realtime.bus` nella
configurazione) ogni volta che più di un processo gestisce websocket.

**Scalabilità a zero.** Nessuna di queste funzionalità scala un processo a zero o ne avvia uno
su richiesta. Si tratta di una funzionalità a livello di piattaforma di orchestrazione, non del runtime.

## Rilascio indipendente di una singola unità

Tutto quanto descritto sopra suddivide *il luogo in cui il carico di lavoro viene eseguito*. L'intero sistema viene
comunque distribuito come un'unica build: una sola immagine, un solo bundle, aggiornati insieme. Questa è l'impostazione
predefinita corretta e la maggior parte dei deployment dovrebbe mantenerla.

Un'unità può anche essere vincolata a una propria build specifica — ad esempio per un fix a una funzione
che non richiede il riavvio dell'API:

```yaml
# values.yaml
split: true
functions:
  enabled: true
  image:
    tag: "0.22.0"     # this unit only; the rest stay on the release-wide tag
```

Solitamente ha senso bloccare solo il tag: il repository viene ereditato, quindi si tratta di
un unico progetto e di un'unica immagine con una sola unità modificata. `bundleUrl` svolge lo stesso compito
quando `bundle.mode: url`.

### La regola

Due unità su build differenti rappresentano due insiemi distinti di collection su **un unico**
database, e una sola unità ne esegue il provisioning. Di conseguenza:

> **L'unità che gestisce lo schema deve essere aggiornata per prima. Un'unità può rimanere indietro; non deve mai essere più avanti.**

Tale unità è il Job di migrazione, oppure l'`api` quando il Job è disattivato. Un'unità che opera
*più avanti* rispetto allo schema interroga colonne non ancora esistenti e fa affidamento su policy RLS
che nessuno ha ancora applicato — il primo caso genera un errore SQL su una route, il secondo restituisce un
risultato vuoto con uno stato 200. Un'unità che opera *più indietro* rappresenta invece il normale stato
di qualsiasi rollout in corso.

### Cosa effettua la verifica

Il processo che esegue il provisioning registra nel database la versione dello schema applicata.
Tutti gli altri processi calcolano la propria a partire dalle collection caricate ed effettuano un
confronto. In caso di discrepanza, viene emesso un avviso che indica entrambe:

```
⚠️ [schema] The database was last provisioned from a different set of collections
   than this process was built from (database v1:6f2a…, this process v1:91cd…).
```

Viene emesso un avviso e il servizio continua, poiché durante un rollout tale discrepanza è *corretta* —
le unità non ancora aggiornate devono essere indietro. Imposta
`REBASE_REQUIRE_SCHEMA_MATCH=true` (o `sharedState.requireSchemaMatch` nel
chart) per impedire invece l'avvio, nel caso di un deployment in cui si preferisca non erogare
affatto il servizio piuttosto che erogarlo in modo errato.

Entrambi i lati del confronto sono **calcolati**, mai letti da un manifest. La
versione che una build dichiara su se stessa non è una prova del fatto che il database sia allineato
ad essa.

Nulla verifica la *direzione* — la versione dello schema è un hash, quindi può rilevare una discrepanza
ma non quale dei due sia più avanti. Questo rende l'ordine di rollout una regola operativa da seguire,
piuttosto che un vincolo imposto dal runtime.

## Aggiornamento

Invariato: ogni processo esegue la stessa immagine pubblicata, quindi un aggiornamento corrisponde alla
modifica dello stesso tag su ciascuno di essi. Esegui il rollout dell'`api` per ultimo se desideri che il
provisioning dello schema avvenga per primo rispetto alla nuova versione — anche se in pratica
l'ordine è irrilevante, poiché la procedura di schema è additiva e idempotente.

## Risorse correlate

- [Guida al deployment](/docs/getting-started/deployment/) — il deployment a singolo processo da cui deriva questa suddivisione
- [Ambiente e configurazione](/docs/getting-started/configuration/) — `REBASE_ROLE`, `REBASE_CRON_SCHEDULER` e `REBASE_MIGRATE_ON_BOOT`
- [Kubernetes](/docs/deployment/kubernetes/) — un deployment per ciascun ruolo
