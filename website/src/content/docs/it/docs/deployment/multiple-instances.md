---
sourceHash: 079933126e9be226
title: Esecuzione di più istanze
sidebar_label: Più istanze
description: Ogni elemento di stato che un processo Rebase mantiene per sé e l'impostazione per condividerlo — cosa configurare prima che una seconda replica, un rolling deploy o un deployment suddiviso riceva traffico.
---

## Panoramica

La maggior parte di un deployment Rebase risiede già nel database: righe, utenti e sessioni, chiavi API, la coda dei job, le assegnazioni cron, le chiavi di idempotenza, la cronologia dei record, i token del server OAuth MCP. Un secondo processo puntato sullo stesso database vede tutto questo.

Alcuni elementi, tuttavia, non risiedono nel database. Ognuno di essi è isolato per processo per impostazione predefinita, poiché un singolo processo rappresenta il deployment standard e la condivisione comporta dei costi: una tabella, una scrittura su bucket, una connessione al database. L'esecuzione di due processi dietro un bilanciatore di carico, l'autoscaling oltre un'istanza o un rolling deploy che esegue brevemente la versione vecchia e nuova affiancate richiedono tutti queste configurazioni. Lo stesso vale per un [deployment suddiviso](/docs/deployment/split-processes/), che per definizione è composto da più processi.

Esamina l'elenco seguente prima che la seconda istanza riceva traffico. Nessun elemento causerà errori evidenti o bloccanti: ciascuno si manifesterà come un limite applicato con una tolleranza tripla, un evento che alcuni client non vedranno mai o una pagina che mostra log diversi a ogni aggiornamento.

## Elenco di controllo

| Elemento | Per processo per impostazione predefinita | Come condividerlo |
| --- | --- | --- |
| Segreti di firma | Generati per processo in fase di sviluppo | `JWT_SECRET` e `REBASE_SERVICE_KEY`, impostati esplicitamente e **identici** ovunque |
| Contatori del rate limit | In memoria | `REBASE_RATE_LIMIT_STORE=sql` |
| Indirizzo client dietro un proxy | `TRUSTED_PROXY_HOPS=0` | Il numero di proxy a monte, uguale ovunque |
| Sottoscrizioni alle tabelle | Condivise tramite il database quando CDC è abilitato | `REALTIME_CDC=auto` (impostazione predefinita) |
| Canali broadcast e presence | In memoria | `REALTIME_CHANNEL_BUS=postgres` |
| File caricati, `STORAGE_TYPE=local` | Il disco locale dell'istanza | S3 o GCS, oppure un volume condiviso nella cartella padre di `STORAGE_PATH` |
| Caricamenti ripristinabili (TUS) in corso | Il disco dell'istanza, in `STORAGE_PATH/.tus-uploads` | Un volume condiviso su `STORAGE_PATH`, oppure sessioni persistenti (sticky sessions) |
| Trasformazioni di immagini | Una cache interna al processo | `STORAGE_RENDITION_CACHE=true` |
| Vista Log di Studio | Un buffer circolare delle ultime 10.000 righe | Nulla — invia stdout a un aggregatore di log |
| Timer dei cron | Ogni processo che esegue lo scheduler | Assegnati nel database: un'esecuzione per slot. `REBASE_CRON_SCHEDULER` sceglie dove risiedono i timer |
| Audit RLS pianificato | Ogni processo che lo possiede | `REBASE_RLS_AUDIT=false` su tutti tranne uno |
| `index.html` di un'app statica | Letto una sola volta per processo | Riavvia ogni istanza quando la build cambia |
| `/metrics` | Ogni processo conta le proprie | Effettua lo scrape di ogni istanza |

Le sezioni seguenti spiegano il comportamento di ciascun elemento quando viene lasciato isolato per processo.

## Segreti di firma

`JWT_SECRET` firma ogni sessione e `REBASE_SERVICE_KEY` autentica le chiamate server-to-server. In fase di sviluppo, ogni processo genera i propri se non sono impostati, quindi un token emesso da un processo viene rifiutato dal successivo. L'ambiente di produzione rifiuta già l'avvio senza `JWT_SECRET` (senza `REBASE_SERVICE_KEY` si avvia senza alcuna chiave di servizio); ciò che conta quando ci sono più processi è che ciascuno riceva gli **stessi** valori — da un unico segreto, non uno per replica.

## Rate limit e indirizzo del client

I rate limiter — la quota per chiamante sulle API di dati, storage e funzioni, e i limitatori di autenticazione per l'accesso, il ripristino della password, i codici monouso e i tentativi MFA — tengono il conteggio in memoria per impostazione predefinita. Un processo non è a conoscenza del numero di peer presenti, per cui tre repliche con l'impostazione predefinita applicheranno ogni limite moltiplicato per tre. Imposta `REBASE_RATE_LIMIT_STORE=sql` e i contatori risiederanno invece nel database.

Dietro un bilanciatore di carico, il limiter necessita inoltre del reale indirizzo del client, fornito nell'header `X-Forwarded-For`. `TRUSTED_PROXY_HOPS` specifica quanti proxy oltrepassare; con il valore predefinito `0`, ogni richiesta sembrerà provenire dal bilanciatore di carico e tutti i client condivideranno lo stesso bucket. Consulta [Configurazione](/docs/getting-started/configuration/#runtime-behaviour).

## Realtime

Le **sottoscrizioni alle tabelle** funzionano tra più istanze quando la cattura delle modifiche a livello di database (CDC) è attiva, cosa che avviene per impostazione predefinita (`REALTIME_CDC=auto`): il write-ahead log (WAL, dove il database consente la decodifica logica) o un trigger notifica ogni scrittura confermata, e il listener di ogni istanza recupera nuovamente i dati per i propri iscritti. Le istanze che utilizzano l'acquisizione tramite WAL lasciano attivi i trigger finché un'istanza è ancora in ascolto su di essi, in modo che una replica che ha effettuato il fallback sui trigger non rimanga mai esclusa. Se CDC è disabilitato, o se `auto` non è riuscito a configurarlo (il log di avvio specifica quale sia il caso), una sottoscrizione vede solo le scritture effettuate tramite l'istanza a cui è connesso il proprio socket. Consulta [Realtime](/docs/backend/realtime-cdc/).

I **canali broadcast e la presence** sono interni al processo a meno che non vengano veicolati da un bus: due client su istanze diverse nello stesso canale non comunicano tra loro, e ogni istanza risponde alla domanda "chi è presente?" solo con la propria quota. Imposta `REALTIME_CHANNEL_BUS=postgres`. Il bus rimane in ascolto sul database, che richiede una connessione diretta anziché un pooler di transazioni: imposta `DATABASE_DIRECT_URL` quando `DATABASE_URL` passa attraverso pgBouncer. Consulta [Canali e presence tra istanze](/docs/backend/realtime-transports/#channels-and-presence-across-instances).

## File

Con `STORAGE_TYPE=local`, i file caricati risiedono sul disco dell'istanza che li ha ricevuti, e un'altra istanza restituirà un 404 per essi. Usa S3 o GCS, oppure monta un volume su ogni istanza nella directory padre di `STORAGE_PATH`, in modo che contenga anche la directory `<STORAGE_PATH>__<key>` di ciascun bucket locale con nome. Consulta [Self-hosting: archiviazione file](/docs/deployment/self-hosting/#file-storage).

I **caricamenti ripristinabili** (l'endpoint TUS) conservano il file parziale di ciascun caricamento, insieme al rispettivo record, sul disco dell'istanza che lo ha generato, all'interno di `STORAGE_PATH/.tus-uploads` — anche quando i file completati vengono archiviati su S3 o GCS. Montando un unico volume su `STORAGE_PATH` per ogni istanza, qualunque istanza può gestire qualsiasi caricamento; un riavvio o un rolling deploy riprenderà l'upload dal punto in cui è stato interrotto. Senza un volume condiviso, un blocco (chunk) che arriva su un'altra istanza riceverà un errore 404: instrada le richieste di upload di un client verso una singola istanza (sessioni persistenti o sticky sessions sul bilanciatore di carico). In questo caso, l'SDK e il pannello di amministrazione, che usano questo endpoint per file superiori a 8 MiB, invieranno il file tramite `POST /upload`, continuando a farlo per il resto della sessione. I normali caricamenti tramite `POST /upload` consistono in una singola richiesta e non sono impattati.

Le **trasformazioni di immagini** (`?width=400&format=webp`) sono memorizzate nella cache in memoria, quindi ogni istanza calcola ciascuna variante una sola volta e una nuova istanza parte a freddo. Imposta `STORAGE_RENDITION_CACHE=true` per riscrivere ciascuna resa (rendition) nel rispettivo bucket di provenienza, rendendola accessibile a tutte le istanze. Questo fa sì che una richiesta `GET` effettui una scrittura sul tuo bucket, motivo per cui è disabilitato a meno che non venga richiesto esplicitamente. Consulta [Storage](/docs/backend/storage/).

## Vista Log di Studio

La vista Log di Studio legge un buffer circolare delle ultime 10.000 righe di log conservate dal processo che serve la richiesta. Dietro un bilanciatore di carico, ogni aggiornamento può mostrare le righe di un'istanza diversa, e nessuna di esse mostra l'intero deployment. L'explorer indica il nome dell'istanza visualizzata. Non esiste un'impostazione per condividere questo buffer circolare: in produzione, il runtime scrive una riga JSON per evento su stdout, ed è questo che va raccolto — tramite il servizio di log della tua piattaforma, Loki o qualsiasi strumento che legga l'output dei container.

## Cron e la coda dei job

Ogni processo che esegue il cron scheduler inizializza i propri timer e l'esecuzione viene prima prenotata nel database, garantendo che uno slot venga eseguito **una sola volta** indipendentemente da quanti processi scattino per esso. La messa in pausa di un job e il lease che impedisce a un trigger manuale di interferire con un'esecuzione in corso sono condivisi nello stesso modo. Non c'è nulla da configurare, a patto che il database sia Postgres. `REBASE_CRON_SCHEDULER` e `REBASE_JOB_WORKERS` determinano quali processi devono eseguire i timer e i worker — consulta [Processi suddivisi](/docs/deployment/split-processes/).

L'audit RLS pianificato fa eccezione: non viene prenotato nel database, pertanto ogni processo configurato per eseguirlo effettua la scansione secondo il proprio timer. Ciò è ridondante ma non pericoloso; imposta `REBASE_RLS_AUDIT=false` su tutte le istanze tranne una.

## App statiche

Un processo che serve il frontend o il CMS (`REBASE_SERVE_STATIC`, abilitato per impostazione predefinita) legge il file `index.html` di ogni app una sola volta e lo mantiene in memoria. La sostituzione della build su un volume condiviso non ha effetto su un processo in esecuzione: questo continuerà a servire il vecchio documento, che fa riferimento a chunk che potrebbero non esistere più. Rilascia una nuova build riavviando o effettuando il rolling update di ogni istanza — operazione che una nuova immagine o bundle comporta comunque. In presenza di una CDN a monte e con `REBASE_SERVE_STATIC=false`, questo non si applica.

## Metriche

L'endpoint `/metrics` riporta i dati del processo che risponde alla richiesta. Esegui lo scrape di ogni istanza — tramite un job di service-discovery Prometheus per pod, non un unico target dietro il bilanciatore di carico — ed effettua la somma nella query.

## Provisioning all'avvio

Ogni istanza esegue il passaggio additivo dello schema all'avvio (`REBASE_MIGRATE_ON_BOOT=ensure`). Le istanze con lo stesso ruolo possono eseguirlo contemporaneamente: è strutturato per tollerare che un peer crei la stessa tabella un istante prima. In un deployment suddiviso, esattamente un solo ruolo effettua il provisioning e tutti gli altri impostano `none` — consulta [Processi suddivisi](/docs/deployment/split-processes/).
