---
sourceHash: 1268d4bf9843a74b
title: Suddivisione in più processi
sidebar_label: Processi separati
description: Esegui un singolo bundle come molteplici processi cooperanti — un'API, un tier di funzioni, un worker — dalla stessa immagine di runtime pubblicata, in modo che una funzione personalizzata pesante smetta di competere con l'API dati.
---

## Panoramica

Un deployment di Rebase è normalmente un singolo processo che serve tutto: l'API dati, l'autenticazione, lo storage, le tue funzioni personalizzate, il cron e la coda dei job. Questa è la forma corretta per quasi tutti i deployment e rimane l'impostazione predefinita.

Quando smette di essere la forma corretta — una funzione personalizzata che blocca l'event loop, un tier di funzioni che dovrebbe scalare o riavviarsi indipendentemente dall'API — puoi avviare **la stessa immagine e lo stesso bundle** più volte e fare in modo che ogni processo serva una parte diversa del progetto. Non c'è nulla di nuovo da compilare e nulla di cui il client debba essere a conoscenza: gli URL non cambiano.

Una singola variabile d'ambiente determina cosa sia un processo:

```bash
REBASE_ROLE=api        # data, auth, admin, storage, meta — everything but functions
REBASE_ROLE=functions  # custom functions only
REBASE_ROLE=worker     # no HTTP surface: cron and the job queue
REBASE_ROLE=all        # the default: everything, one process
```

## Cosa serve ciascun ruolo

| | `all` | `api` | `functions` | `worker` |
| --- | :---: | :---: | :---: | :---: |
| `/api/auth`, `/api/data`, `/api/storage`, `/api/meta` | ✅ | ✅ | — | — |
| `/api/admin`, `/api/logs`, the schema editor | ✅ | ✅ | — | — |
| `/api/functions/*` | ✅ | inoltra (vedi sotto) | ✅ | — |
| `/api/cron` (the admin surface) | ✅ | ✅ | — | — |
| `/health`, `/livez`, `/metrics` | ✅ | ✅ | ✅ | ✅ |
| Serve websocket, consuma eventi di modifica | ✅ | ✅ | — | — |
| Crea lo schema all'avvio | ✅ | ✅ | — | — |
| Esegue lo scheduler cron | ✅ | ✅ | — | ✅ |
| Esegue i worker della coda dei job | ✅ | ✅ | — | ✅ |

Health e metriche sono presenti su ciascun ruolo senza eccezioni. Un processo su cui un orchestratore non può eseguire controlli di stato (probe) è un processo di cui non può effettuare il rollout.

La funzionalità Realtime è presente nell'elenco perché comporta un costo, a prescindere dal fatto che qualcuno la utilizzi o meno: un processo che consuma eventi di modifica mantiene una connessione `LISTEN` all'esterno del pool per l'intera durata della sua esecuzione e installa i trigger di acquisizione all'avvio. Solo un processo che serve websocket ha destinatari a cui recapitare gli eventi, pertanto i due ruoli che non ne servono non fanno nessuna delle due cose. **Le scritture effettuate da questi processi continuano a essere rilevate** — l'acquisizione avviene tramite trigger del database, quindi una modifica viene pubblicata dal database anziché dal processo specifico che l'ha generata. Una funzione che scrive una riga risveglia comunque ogni subscriber su `api`.

## Docker Compose

Due servizi a partire da una sola immagine, un solo bundle e un solo database:

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

Entrambi i processi necessitano dello stesso `DATABASE_URL`, dello stesso `JWT_SECRET` e dello stesso `REBASE_SERVICE_KEY` — costituiscono un unico deployment, e un token generato da uno deve essere accettato dall'altro.

## Mantenere invariati gli URL

`REBASE_FUNCTIONS_UPSTREAM` indica al processo `api` di inoltrare `/api/functions/*` al processo functions invece di gestirlo direttamente. I client, gli SDK generati e le chiavi API vedono esattamente la stessa superficie visibile prima della separazione, quindi non è necessaria alcuna modifica al codice dell'applicazione e non occorre configurare un reverse proxy per fare una prova.

Un deployment di produzione potrebbe preferire instradare il percorso a livello del proprio ingress; in tal caso, lascia `REBASE_FUNCTIONS_UPSTREAM` non impostato — il processo `api` risponderà con un 404 per tali percorsi e il proxy a monte deciderà dove indirizzarli.

### Hop di proxy

Quando l'API inoltra la richiesta, aggiunge l'indirizzo del chiamante a `X-Forwarded-For`. Di conseguenza, il processo functions si trova dietro **un hop di proxy in più** rispetto all'API, ed è necessario configurarlo di conseguenza:

```bash
# api behind one ingress            → TRUSTED_PROXY_HOPS=1
# functions behind that ingress AND the api → TRUSTED_PROXY_HOPS=2
```

`TRUSTED_PROXY_HOPS` è il numero di reverse proxy effettivamente in esecuzione davanti a un processo. Ciascuno di essi aggiunge l'indirizzo rilevato a `X-Forwarded-For`, quindi il vero client corrisponde all'ennesima voce a partire da destra; tutto ciò che si trova più a sinistra è fornito dal client e viene ignorato, impedendo così a un chiamante di falsificare l'header per aggirare le chiavi di rate limiting. Il valore predefinito è `0` — nessun proxy considerato affidabile.

Sbagliare questa configurazione non causerà errori visibili immediati: i rate limiter sul processo functions assoceranno ogni richiesta all'indirizzo del container API, facendo condividere a tutti i tuoi chiamanti lo stesso bucket, e l'IP registrato per ogni evento di autenticazione sarà sempre lo stesso.

## Un solo processo è proprietario dello schema

Esattamente un processo in un deployment suddiviso crea le tabelle e applica le policy RLS all'avvio, ossia il processo `api` (o `all`). Tutti gli altri processi devono impostare:

```bash
REBASE_MIGRATE_ON_BOOT=none
```

Questo è **obbligatorio**, non facoltativo: un processo `functions` o `worker` lasciato con l'impostazione predefinita si rifiuterà di avviarsi, segnalando l'errore. `CREATE … IF NOT EXISTS` legge il catalogo e successivamente vi scrive in due passaggi separati, quindi i processi che si avviano simultaneamente vanno in conflitto — e un deployment in cui più processi competono per effettuare il provisioning dello stesso schema non è uno scenario previsto.

## Servire una funzione per processo

Un processo può servire un sottoinsieme con nome; in questo modo, una singola funzione onerosa ottiene il proprio numero di repliche dedicato senza che il suo codice debba essere spostato:

```bash
REBASE_FUNCTIONS_ONLY=send-invoice
REBASE_FUNCTIONS_EXCLUDE=debug-tools
```

I nomi corrispondono ai nomi dei file senza estensione — lo stesso nome con cui la funzione viene montata. Un nome non presente nel bundle **causa il fallimento dell'avvio**, e l'errore elenca i nomi effettivamente presenti. Un processo configurato per una singola funzione esiste esclusivamente per quella funzione, pertanto un errore di battitura che finisse per non servire silenziosamente nulla sarebbe il peggior risultato possibile.

## Cron e job in background

Entrambi possono già essere eseguiti in modo sicuro su più processi: lo scheduler cron acquisisce ogni coppia `(job, slot)` nel database, e la coda dei job acquisisce le righe con `FOR UPDATE SKIP LOCKED`. Di conseguenza, `api` continua a eseguire entrambi per impostazione predefinita e la suddivisione in due servizi è completa senza bisogno di un terzo container.

Aggiungi un processo `worker` quando desideri spostare le attività pianificate fuori dal percorso delle richieste HTTP, e disattivale sull'API:

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

Un processo `functions` non esegue mai né l'uno né l'altro. Viene scalato in base al carico di richieste e sostituito all'occorrenza; assegnargli attività pianificate attribuirebbe al suo conteggio di repliche un significato improprio.

Nota che `rebase.jobs.enqueue` continua a funzionare ovunque, compreso su un processo che non esegue worker — l'accodamento è un'operazione di scrittura, l'esecuzione è un ciclo di polling, e solo quest'ultimo viene disattivato da un ruolo.

## Cosa non offre la suddivisione

**Rate limit condivisi, a meno di non richiederli esplicitamente.** Lo store predefinito è per singolo processo, quindi N processi moltiplicano la quota di ciascun chiamante per N, senza che alcun log lo segnali. Imposta `REBASE_RATE_LIMIT_STORE=sql` su ogni processo che serve HTTP — il conteggio avverrà in Postgres, garantendo che il limite rimanga tale indipendentemente dal numero di repliche. (Il chart Helm lo imposta automaticamente e rifiuta il rendering di una topologia multi-processo che mantenga l'impostazione su `memory`.)

**Canali cross-instance.** Broadcast e presence utilizzano per impostazione predefinita un bus in memoria, che non attraversa i processi. Si tratta di una questione legata al *conteggio delle repliche* piuttosto che alla suddivisione dei processi — vale lo stesso per un deployment a ruolo singolo scalato a tre repliche — quindi imposta `REALTIME_CHANNEL_BUS=postgres` (oppure `realtime.bus` nella configurazione) ogni volta che più di un processo serve websocket.

**Scale to zero.** Nessuna impostazione qui scala un processo a zero né ne avvia uno su richiesta. Questa è una funzionalità della piattaforma di hosting, non del runtime.

## Rilasciare una singola unità in modo indipendente

Tutto quanto descritto finora suddivide *il luogo in cui il carico di lavoro viene eseguito*. Tutto viene ancora distribuito come un'unica build: un'unica immagine, un unico bundle, rilasciati insieme. Questa è l'impostazione predefinita ottimale e la maggior parte dei deployment dovrebbe mantenerla.

Un'unità può anche essere mantenuta su una propria build indipendente — ad esempio, una correzione a una funzione che non richiede il riavvio dell'API:

```yaml
# values.yaml
split: true
functions:
  enabled: true
  image:
    tag: "0.20.0"     # this unit only; the rest stay on the release-wide tag
```

Di solito vale la pena bloccare solo il tag: il repository è ereditato, quindi si tratta dello stesso progetto e della stessa immagine con una sola unità aggiornata. `bundleUrl` svolge la stessa funzione quando è impostato `bundle.mode: url`.

### La regola

Due unità su build diverse rappresentano due insiemi di collezioni a fronte di **un solo** database, e una sola unità ne esegue il provisioning. Di conseguenza:

> **L'unità proprietaria dello schema viene aggiornata per prima. Un'unità può essere indietro; non deve mai essere avanti.**

Si tratta del Job di migrazione, oppure di `api` se il Job è disattivato. Un'unità in esecuzione in uno stato *più avanzato* rispetto allo schema interroga colonne che non esistono ancora e fa affidamento su policy RLS che nessuno ha applicato — il primo caso genera un errore SQL su una route, il secondo restituisce un risultato vuoto con uno stato 200. Un'unità in esecuzione in uno stato *arretrato* rappresenta la normale condizione durante qualsiasi rollout in corso.

### Cosa effettua il controllo

Il processo che esegue il provisioning registra nel database la versione dello schema che ha applicato. Ogni altro processo calcola la propria versione a partire dalle collezioni caricate ed effettua un confronto. In caso di discrepanza, viene visualizzata una notifica che riporta entrambe le versioni:

```
⚠️ [schema] The database was last provisioned from a different set of collections
   than this process was built from (database v1:6f2a…, this process v1:91cd…).
```

Emette un avviso e continua a servire le richieste, poiché durante un rollout tale discrepanza è *corretta* — le unità non ancora aggiornate devono risultare indietro. Imposta `REBASE_REQUIRE_SCHEMA_MATCH=true` (oppure `sharedState.requireSchemaMatch` nel chart) per rifiutare invece l'avvio, nei deployment in cui si preferisce non rispondere affatto piuttosto che rispondere in modo errato.

Entrambi i lati di tale confronto sono **calcolati**, mai letti da un manifest. La versione dichiarata da una build su se stessa non è una prova del fatto che il database sia allineato.

Nulla verifica la *direzione* — la versione di uno schema è un hash, quindi può solo indicare che i due differiscono e mai quale sia più avanti. Questo è il motivo per cui l'ordine di rollout è una regola da seguire manualmente anziché un vincolo che il runtime possa imporre.

## Aggiornamento

Invariato: ciascun processo esegue la stessa immagine pubblicata, quindi un aggiornamento si traduce nella modifica dello stesso tag su ciascuno di essi. Esegui il rollout di `api` per ultimo se desideri che il provisioning dello schema avvenga per primo rispetto alla nuova versione — sebbene in pratica l'ordine non abbia importanza, in quanto la fase di aggiornamento dello schema è additiva e idempotente.

## Contenuti correlati

- [Guida al deployment](/docs/getting-started/deployment/) — il deployment a processo singolo da cui questo è derivato
- [Ambiente e configurazione](/docs/getting-started/configuration/) — `REBASE_ROLE`, `REBASE_CRON_SCHEDULER` e `REBASE_MIGRATE_ON_BOOT`
- [Kubernetes](/docs/deployment/kubernetes/) — un deployment per ruolo

---
