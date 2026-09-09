---
sourceHash: ce7486bb141920aa
title: Suddivisione in più processi
sidebar_label: Processi separati
description: Esegui un unico bundle come più processi cooperanti — un'API, un livello per le funzioni, un worker — dalla stessa immagine di runtime pubblicata, in modo che una funzione personalizzata pesante non competa più con l'API dei dati.
---

## Panoramica

Un deployment di Rebase è normalmente un unico processo che gestisce tutto: l'API dei dati, l'autenticazione, lo storage, le tue funzioni personalizzate, il cron e la coda dei job. Questa è la configurazione ideale per quasi ogni deployment e rimane quella predefinita.

Quando smette di essere la configurazione ideale — una funzione personalizzata che blocca l'event loop, un livello di funzioni che dovrebbe scalare o riavviarsi indipendentemente dall'API — puoi avviare **la stessa immagine e lo stesso bundle** più volte e fare in modo che ciascun processo gestisca una parte diversa del progetto. Non c'è nulla di nuovo da compilare e nulla di cui il client debba essere a conoscenza: gli URL non cambiano.

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
| `/api/admin`, `/api/logs`, l'editor dello schema | ✅ | ✅ | — | — |
| `/api/functions/*` | ✅ | inoltra (vedi sotto) | ✅ | — |
| `/api/cron` (la superficie di amministrazione) | ✅ | ✅ | — | — |
| `/health`, `/livez`, `/metrics` | ✅ | ✅ | ✅ | ✅ |
| Gestisce i websocket, consuma gli eventi di modifica | ✅ | ✅ | — | — |
| Crea lo schema all'avvio | ✅ | ✅ | — | — |
| Esegue lo scheduler cron | ✅ | ✅ | — | ✅ |
| Esegue i worker della coda dei job | ✅ | ✅ | — | ✅ |

Health e metriche sono presenti su ogni ruolo senza eccezioni. Un processo di cui un orchestratore non può verificare lo stato tramite probe è un processo che non può rilasciare gradualmente tramite rolling update.

Il Realtime è nell'elenco perché comporta un costo a prescindere dal fatto che qualcuno lo utilizzi o meno: un processo che consuma gli eventi di modifica mantiene una connessione `LISTEN` al di fuori del pool per l'intera durata della sua esecuzione, e installa i trigger di acquisizione all'avvio. Solo un processo che gestisce websocket ha dei destinatari a cui recapitare gli eventi, quindi i due ruoli che non ne gestiscono non fanno nessuna delle due cose. **Le scritture effettuate da tali processi vengono comunque rilevate** — l'acquisizione si basa sui trigger del database, quindi una modifica viene pubblicata dal database anziché dal singolo processo che l'ha eseguita. Una funzione che scrive una riga attiva comunque ogni subscriber su `api`.

## Docker Compose

Due servizi a partire da un'unica immagine, un solo bundle e un unico database:

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

Entrambi i processi richiedono gli stessi `DATABASE_URL`, `JWT_SECRET` e `REBASE_SERVICE_KEY` — appartengono allo stesso deployment, e un token emesso da uno deve essere accettato dall'altro.

## Mantenere invariati gli URL

`REBASE_FUNCTIONS_UPSTREAM` indica al processo `api` di inoltrare `/api/functions/*` al processo functions anziché servirlo direttamente. I client, gli SDK generati e le chiavi API vedono esattamente la stessa superficie visibile prima della separazione; di conseguenza, il codice applicativo non cambia e non è necessario configurare un reverse proxy per fare una prova.

Un deployment di produzione potrebbe preferire instradare il percorso a livello di ingress; in tal caso, lascia `REBASE_FUNCTIONS_UPSTREAM` non impostato — il processo `api` risponderà con un 404 per tali percorsi e sarà il proxy a monte a decidere dove inoltrarli.

### Hop del proxy

Quando l'API effettua l'inoltro, aggiunge l'indirizzo del chiamante a `X-Forwarded-For`. Ciò significa che il processo functions si trova dietro **un hop di proxy in più** rispetto all'API, e deve esserne informato:

```bash
# api behind one ingress            → TRUSTED_PROXY_HOPS=1
# functions behind that ingress AND the api → TRUSTED_PROXY_HOPS=2
```

`TRUSTED_PROXY_HOPS` è il numero di reverse proxy effettivamente eseguiti a monte di un processo. Ciascuno aggiunge l'indirizzo rilevato a `X-Forwarded-For`, quindi il vero client è la N-esima voce da destra; tutto ciò che si trova più a sinistra è fornito dal client e viene ignorato, impedendo così a un chiamante di falsificare l'header per aggirare le chiavi di rate limiting. Il valore predefinito è `0` — nessun proxy considerato attendibile.

Se questo parametro viene configurato in modo errato, apparentemente non si romperà nulla: i rate limiter sul processo functions assoceranno ogni richiesta all'indirizzo del container dell'API, facendo sì che tutti i chiamanti condividano lo stesso bucket e che l'IP registrato per ogni evento di autenticazione sia identico.

## Un solo processo gestisce lo schema

In un deployment suddiviso, esattamente un solo processo crea le tabelle e applica i criteri RLS all'avvio: quello `api` (o `all`). Tutti gli altri processi devono impostare:

```bash
REBASE_MIGRATE_ON_BOOT=none
```

Questo è **obbligatorio**, non facoltativo: un processo `functions` o `worker` lasciato con l'impostazione predefinita rifiuterà di avviarsi, segnalando l'errore. `CREATE … IF NOT EXISTS` legge il catalogo e successivamente vi scrive in due passaggi distinti, quindi i processi avviati contemporaneamente entrano in collisione — e un deployment in cui più processi competono per eseguire il provisioning dello stesso schema non è uno scenario previsto da nessuno.

## Servire una sola funzione per processo

Un processo può gestire un sottoinsieme specifico, consentendo a una funzione particolarmente onerosa di avere un proprio numero di repliche senza dover spostare il suo codice altrove:

```bash
REBASE_FUNCTIONS_ONLY=send-invoice
REBASE_FUNCTIONS_EXCLUDE=debug-tools
```

I nomi corrispondono ai nomi dei file privi di estensione — lo stesso nome con cui la funzione viene montata. Un nome non presente nel bundle **causa il fallimento dell'avvio**, e l'errore elenca i nomi effettivamente contenuti. Un processo configurato per una singola funzione esiste per quella specifica funzione; pertanto, un refuso che portasse a non servire nulla in modo silenzioso sarebbe il peggior risultato possibile.

## Cron e job in background

Entrambi possono già essere eseguiti in sicurezza su più processi: lo scheduler cron acquisisce ciascuna coppia `(job, slot)` nel database, e la coda dei job acquisisce le righe con `FOR UPDATE SKIP LOCKED`. Di conseguenza, `api` continua a eseguire entrambi per impostazione predefinita e una suddivisione a due servizi è completa senza bisogno di un terzo container.

Aggiungi un processo `worker` quando desideri spostare le attività pianificate fuori dal percorso delle richieste e disattivale sull'API:

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

Un processo `functions` non esegue mai nessuno dei due. Viene scalato in base al carico delle richieste e sostituito a piacimento; assegnargli attività pianificate altererebbe il significato del suo numero di repliche.

Nota che `rebase.jobs.enqueue` continua a funzionare ovunque, anche su un processo che non esegue worker — l'accodamento è un'operazione di scrittura, l'esecuzione è un ciclo di polling, e solo il secondo viene disattivato da un ruolo.

## Cosa non offre la suddivisione

**Rate limit condivisi, a meno che non vengano richiesti esplicitamente.** Lo store predefinito è per processo, quindi N processi moltiplicano la soglia consentita per ciascun chiamante per N, senza che alcun log lo segnali. Imposta `REBASE_RATE_LIMIT_STORE=sql` su ogni processo che gestisce HTTP — il conteggio viene effettuato in Postgres, garantendo che il limite rimanga tale a prescindere dal numero di repliche. (Il chart Helm lo imposta automaticamente e si rifiuta di effettuare il rendering di una topologia multi-processo che lo lasci su `memory`).

**Canali tra istanze diverse.** Il broadcast e la presence utilizzano per impostazione predefinita un bus in memoria, che non comunica tra processi diversi. Questa è una questione legata al *conteggio delle repliche* piuttosto che alla suddivisione dei ruoli — vale allo stesso modo per un deployment a ruolo singolo scalato a tre repliche — quindi imposta `REALTIME_CHANNEL_BUS=postgres` (o `realtime.bus` nella configurazione) ogni volta che più di un processo gestisce i websocket.

**Scale to zero.** Nulla di tutto ciò riduce un processo a zero o ne avvia uno su richiesta. Questa è una funzionalità della piattaforma, non del runtime.

## Rilasciare una singola unità in autonomia

Tutto ciò che è stato descritto finora suddivide *il luogo in cui viene eseguito il carico di lavoro*. Il tutto viene comunque distribuito come un'unica build: una sola immagine, un unico bundle, rilasciati insieme. Questa è l'impostazione predefinita corretta e la maggior parte dei deployment dovrebbe mantenerla.

Un'unità può anche essere vincolata a una propria build indipendente — ad esempio, un fix a una funzione che non richiede il riavvio dell'API:

```yaml
# values.yaml
split: true
functions:
  enabled: true
  image:
    tag: "0.19.1"     # this unit only; the rest stay on the release-wide tag
```

Di solito vale la pena bloccare solo il tag: il repository viene ereditato, quindi si tratta di un unico progetto e di un'unica immagine con una sola unità modificata. `bundleUrl` svolge la stessa funzione quando `bundle.mode: url`.

### La regola

Due unità basate su build diverse rappresentano due insiemi di collection a fronte di **un solo** database, e una sola unità ne esegue il provisioning. Di conseguenza:

> **L'unità che gestisce lo schema viene aggiornata per prima. Un'unità può rimanere indietro; non deve mai essere più avanti.**

Questa unità è il Job di migrazione, o il processo `api` quando il Job è disattivato. Un'unità in esecuzione *più avanti* rispetto allo schema interroga colonne che non esistono ancora e fa affidamento su policy RLS che nessuno ha applicato — la prima situazione genera un errore SQL su una route, la seconda un risultato vuoto con codice di stato 200. Un'unità in esecuzione *più indietro* rappresenta invece il normale stato transitorio di qualsiasi rollout in corso.

### Cosa effettua la verifica

Il processo che esegue il provisioning registra nel database la versione dello schema applicata. Tutti gli altri processi calcolano la propria a partire dalle collection caricate ed effettuano un confronto. In caso di discrepanza lo segnalano, indicando entrambe le versioni:

```
⚠️ [schema] The database was last provisioned from a different set of collections
   than this process was built from (database v1:6f2a…, this process v1:91cd…).
```

Il processo emette un avviso e continua a servire le richieste, poiché durante un rollout tale discrepanza è *corretta* — le unità non ancora aggiornate devono essere indietro. Imposta `REBASE_REQUIRE_SCHEMA_MATCH=true` (o `sharedState.requireSchemaMatch` nel chart) per rifiutare l'avvio, nel caso di un deployment che preferisce non servire traffico piuttosto che gestirlo in modo errato.

Entrambi i termini di tale confronto sono **calcolati**, mai letti da un manifest. Una versione dichiarata da una build non costituisce una prova del fatto che il database sia d'accordo.

Nulla verifica la *direzione* — la versione di uno schema è un hash, quindi può solo indicare che i due differiscono, ma mai quale sia più avanti. Questo è il motivo per cui l'ordine di rollout è una regola da seguire manualmente anziché un vincolo che il runtime può imporre.

## Aggiornamento

Invariato: ogni processo esegue la stessa immagine pubblicata, quindi un aggiornamento consiste nella medesima modifica di tag su ciascuno di essi. Esegui il rollout di `api` per ultimo se vuoi che il provisioning dello schema avvenga per primo rispetto alla nuova versione — anche se in pratica l'ordine non ha importanza, poiché la fase dello schema è additiva e idempotente.

## Contenuti correlati

- [Guida al deployment](/docs/getting-started/deployment/) — il deployment a singolo processo che questa guida suddivide
- [Ambiente e configurazione](/docs/getting-started/configuration/) — `REBASE_ROLE`, `REBASE_CRON_SCHEDULER` e `REBASE_MIGRATE_ON_BOOT`
- [Kubernetes](/docs/deployment/kubernetes/) — un deployment per ruolo

---
