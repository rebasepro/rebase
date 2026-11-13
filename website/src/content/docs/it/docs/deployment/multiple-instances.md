---
sourceHash: d2e9fbce6bf304f5
title: Esecuzione di più istanze
sidebar_label: Più istanze
description: Tutto lo stato che un processo Rebase mantiene per sé e l'impostazione per condividerlo — cosa configurare prima che una seconda replica, un rolling deploy o un deployment suddiviso riceva traffico.
---

## Panoramica

La maggior parte di una distribuzione Rebase risiede già nel database: righe, utenti e sessioni, chiavi API, la coda dei job, le claim dei cron, chiavi di idempotenza, cronologia dei record, token del server OAuth MCP. Un secondo processo puntato sullo stesso database vede tutto questo.

Alcuni elementi no. Ciascuno è limitato al singolo processo per impostazione predefinita, poiché un unico processo rappresenta il deployment standard e la condivisione comporta dei costi: una tabella, una scrittura su bucket, una connessione al database. Eseguire due processi dietro un bilanciatore di carico, l'autoscaling oltre un'istanza o un rolling deploy che esegue brevemente la versione vecchia e nuova fianco a fianco richiedono la lettura di questa guida. Lo stesso vale per un [deployment suddiviso](/docs/deployment/split-processes/), che per definizione è composto da più processi.

Esamina l'elenco seguente prima che la seconda istanza inizi a ricevere traffico. Nessun elemento causerà errori bloccanti evidenti: ogni problema si manifesterà come un limite applicato tre volte tanto, un evento che alcuni client non vedono mai o una pagina che mostra log diversi a ogni aggiornamento.

## La checklist

| Cosa | Per processo per impostazione predefinita | Cosa lo condivide |
| --- | --- | --- |
| Segreti di firma | Generati per singolo processo in fase di sviluppo | `JWT_SECRET` e `REBASE_SERVICE_KEY`, impostati esplicitamente e **identici** ovunque |
| Contatori di rate limit | In memoria | `REBASE_RATE_LIMIT_STORE=sql` |
| Indirizzo del client dietro un proxy | `TRUSTED_PROXY_HOPS=0` | Il numero di proxy a monte, uguale ovunque |
| Sottoscrizioni alle tabelle | Condivise tramite il database quando il CDC è attivo | `REALTIME_CDC=auto` (impostazione predefinita) |
| Canali di broadcast e presenza | In memoria | `REALTIME_CHANNEL_BUS=postgres` |
| File caricati, `STORAGE_TYPE=local` | Il disco locale dell'istanza | S3 o GCS, oppure un volume condiviso sulla cartella genitore di `STORAGE_PATH` |
| Caricamenti ripristinabili (TUS) in corso | Il disco dell'istanza, in `STORAGE_PATH/.tus-uploads` | Un volume condiviso su `STORAGE_PATH`, o sessioni sticky |
| Trasformazioni delle immagini | Una cache interna al processo | `STORAGE_RENDITION_CACHE=true` |
| Logs Explorer | Un buffer circolare delle ultime 10.000 righe | Nulla — invia lo stdout a un aggregatore di log |
| Timer cron | Ogni processo che esegue lo scheduler | Acquisiti nel database: un'esecuzione per slot. `REBASE_CRON_SCHEDULER` sceglie dove risiedono i timer |
| Audit RLS pianificato | Ogni processo che lo possiede | `REBASE_RLS_AUDIT=false` su tutte tranne una |
| Il file `index.html` di un'app statica | Letto una volta per processo | Riavvia ogni istanza quando la build cambia |
| `/metrics` | Ogni processo calcola i propri | Esegui lo scraping di ogni istanza |

Le sezioni seguenti spiegano il comportamento di ogni elemento se lasciato limitato al singolo processo.

## Segreti di firma

`JWT_SECRET` firma ogni sessione e `REBASE_SERVICE_KEY` autentica le chiamate server-to-server. In fase di sviluppo ogni processo genera i propri se non sono impostati, quindi un token emesso da un processo viene rifiutato dal successivo. L'ambiente di produzione rifiuta già l'avvio in assenza di `JWT_SECRET` (senza `REBASE_SERVICE_KEY` si avvia senza alcuna chiave di servizio); ciò che conta quando ci sono più processi è che ciascuno riceva gli **stessi** valori — da un unico segreto, non uno per replica.

## Rate limit e indirizzo del client

I rate limiter — il budget per chiamante sulle API di dati, archiviazione e funzioni, e i limitatori di autenticazione per accesso, reimpostazione della password, codici monouso e tentativi MFA — tengono il conteggio in memoria per impostazione predefinita. Un processo non può sapere quanti peer siano attivi, quindi tre repliche con la configurazione predefinita applicheranno tre volte ciascun limite. Imposta `REBASE_RATE_LIMIT_STORE=sql` e i contatori risiederanno invece nel database.

Dietro un bilanciatore di carico, il limitatore ha bisogno anche dell'indirizzo reale del client, che arriva nell'header `X-Forwarded-For`. `TRUSTED_PROXY_HOPS` specifica quanti proxy oltrepassare; con il valore predefinito `0`, ogni richiesta sembra provenire dal bilanciatore di carico e tutti i client condividono lo stesso bucket. Consulta [Configurazione](/docs/getting-started/configuration/#runtime-behaviour).

## Realtime

Le **sottoscrizioni alle tabelle** funzionano tra diverse istanze quando il change data capture a livello di database è attivo, cosa che avviene per impostazione predefinita (`REALTIME_CDC=auto`): un trigger notifica ogni scrittura confermata e il listener di ogni istanza effettua nuovamente il fetch per i propri sottoscrittori. Se il CDC è disattivato, o `auto` non è riuscito a configurarlo (il log di avvio indicherà l'esito), una sottoscrizione vede solo le scritture effettuate tramite l'istanza a cui è connesso il rispettivo socket. Consulta [Realtime](/docs/backend/realtime-cdc/).

I **canali di broadcast e la presenza** operano internamente al processo a meno che non vengano veicolati da un bus: due client su istanze diverse nello stesso canale non si rilevano a vicenda e ogni istanza risponde alla domanda «chi è presente?» solo con la propria metà. Imposta `REALTIME_CHANNEL_BUS=postgres`. Il bus rimane in ascolto sul database, che richiede una connessione diretta anziché un pooler di transazioni — imposta `DATABASE_DIRECT_URL` quando `DATABASE_URL` passa attraverso pgBouncer. Consulta [Canali e presenza tra più istanze](/docs/backend/realtime-transports/#channels-and-presence-across-instances).

## File

Con `STORAGE_TYPE=local`, i file caricati risiedono sul disco dell'istanza che li ha ricevuti, e un'altra istanza risponderà con un 404. Utilizza S3 o GCS, oppure monta un volume su ogni istanza nella directory padre di `STORAGE_PATH`, in modo che contenga anche la directory `<STORAGE_PATH>__<key>` di ogni bucket locale con nome. Consulta [Self-hosting: archiviazione file](/docs/deployment/self-hosting/#file-storage).

I **caricamenti ripristinabili** (l'endpoint TUS) conservano il file parziale di ciascun caricamento, insieme a un record associato, sul disco dell'istanza che lo ha generato, sotto `STORAGE_PATH/.tus-uploads` — anche quando i file completati sono destinati a S3 o GCS. Montando un unico volume su `STORAGE_PATH` per ogni istanza, qualunque istanza potrà gestire qualsiasi caricamento; un riavvio o un rolling deploy riprenderà l'upload da dove era stato interrotto. Senza un volume condiviso, un frammento (chunk) che finisce su un'altra istanza riceverà un errore 404: instrada le richieste di caricamento di un client verso un'unica istanza (sessioni sticky sul bilanciatore di carico). L'SDK e il pannello di amministrazione, che utilizzano questo endpoint per file superiori a 8 MiB, invieranno quindi il file tramite `POST /upload` e continueranno a farlo per il resto della sessione. I normali caricamenti tramite `POST /upload` costituiscono una singola richiesta e non sono interessati dal problema.

Le **trasformazioni delle immagini** (`?width=400&format=webp`) sono memorizzate in cache in memoria, quindi ogni istanza calcola ogni variante una volta e una nuova istanza parte a freddo. Imposta `STORAGE_RENDITION_CACHE=true` per salvare ogni resa (rendition) nel bucket di origine, rendendola accessibile a tutte le istanze. Ciò comporta che una richiesta `GET` effettui una scrittura sul tuo bucket, motivo per cui è disattivata se non espressamente richiesta. Consulta [Archiviazione](/docs/backend/storage/).

## Logs Explorer

Il Logs Explorer di Studio legge un buffer circolare delle ultime 10.000 righe di log mantenute dal processo che gestisce la richiesta. Dietro un bilanciatore di carico, ogni aggiornamento della pagina potrebbe mostrare le righe di un'istanza diversa, e nessuna di esse mostrerà l'intero deployment. L'explorer indica il nome dell'istanza visualizzata. Non esiste un'impostazione per condividere il buffer: in produzione il runtime scrive una riga JSON per evento su stdout, ed è questo che va raccolto — tramite il servizio di log della tua piattaforma, Loki o qualsiasi strumento che legga l'output dei container.

## Cron e la coda dei job

Ogni processo che esegue lo scheduler dei cron attiva i propri timer e l'esecuzione viene innanzitutto registrata (claimed) nel database, garantendo che uno slot venga eseguito **una sola volta** indipendentemente da quanti processi scattino per esso. La sospensione di un job e il lease che impedisce l'avvio manuale durante un'esecuzione in corso vengono condivisi nello stesso modo. Non c'è nulla da configurare, purché il database sia Postgres. `REBASE_CRON_SCHEDULER` e `REBASE_JOB_WORKERS` determinano quali processi eseguano effettivamente timer e worker — consulta [Processi suddivisi](/docs/deployment/split-processes/).

L'audit RLS pianificato fa eccezione: non viene registrato tramite claim, quindi ogni processo abilitato effettua la scansione in base al proprio timer. Questo è ridondante piuttosto che non sicuro; imposta `REBASE_RLS_AUDIT=false` su tutte le istanze tranne una.

## App statiche

Un processo che serve il frontend o il CMS (`REBASE_SERVE_STATIC`, abilitato per impostazione predefinita) legge il file `index.html` di ogni app una sola volta e lo mantiene in memoria. La sostituzione della build su un volume condiviso non ha effetto su un processo già in esecuzione: questo continuerà a servire il vecchio documento, che fa riferimento a chunk che potrebbero non esistere più. Distribuisci una nuova build riavviando o effettuando un rolling deploy di ogni istanza — operazione che una nuova immagine o bundle esegue comunque. In presenza di un CDN a monte e con `REBASE_SERVE_STATIC=false`, questo non si applica.

## Metriche

L'endpoint `/metrics` riporta lo stato del processo che risponde. Esegui lo scraping di ogni istanza — un job di service-discovery di Prometheus per pod, non un unico target dietro il bilanciatore di carico — ed effettua la somma nella query.

## Provisioning all'avvio

Ogni istanza esegue il passaggio additivo dello schema all'avvio (`REBASE_MIGRATE_ON_BOOT=ensure`). Istanze con lo stesso ruolo possono eseguirlo contemporaneamente: è progettato per gestire il caso in cui un peer crei la stessa tabella un istante prima. In un deployment suddiviso, esattamente un solo ruolo effettua il provisioning e tutti gli altri impostano `none` — consulta [Processi suddivisi](/docs/deployment/split-processes/).
