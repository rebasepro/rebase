---
sourceHash: d156ac95aebe2dab
title: Esecuzione di più istanze
sidebar_label: Più istanze
description: Ogni porzione di stato che un processo Rebase mantiene per sé e la configurazione per condividerla — cosa impostare prima che una seconda replica, un deployment progressivo o un deployment a processi separati riceva traffico.
---

## Panoramica

La maggior parte di un deployment Rebase risiede già nel database: righe, utenti e sessioni, chiavi API, la coda dei job, le acquisizioni cron, le chiavi di idempotenza, la cronologia dei record, i token del server OAuth MCP. Un secondo processo puntato allo stesso database vede tutto questo.

Alcune cose non lo fanno. Ciascuna è per processo per impostazione predefinita, poiché un singolo processo costituisce il deployment predefinito e la condivisione comporta un costo: una tabella, una scrittura su bucket, una connessione al database. Eseguire due processi dietro un bilanciatore di carico, l'autoscaling oltre un'istanza o un deployment progressivo (rolling deploy) che esegue brevemente la vecchia e la nuova versione affiancate, ricadono tutti in questa casistica. Lo stesso vale per un [deployment a processi separati](/docs/deployment/split-processes/), che per definizione è composto da più processi.

Esamina l'elenco seguente prima che la seconda istanza inizi a ricevere traffico. Nessun elemento causerà un errore esplicito: ciascuno si manifesterà invece come un limite applicato tre volte, un evento che alcuni client non vedranno mai o una pagina che mostra log diversi a ogni aggiornamento.

## La checklist

| Cosa | Per processo per impostazione predefinita | Come condividerlo |
| --- | --- | --- |
| Segreti di firma | Generati per processo in fase di sviluppo | `JWT_SECRET` e `REBASE_SERVICE_KEY`, impostati esplicitamente e **identici** ovunque |
| Contatori di rate limit | In memoria | `REBASE_RATE_LIMIT_STORE=sql` |
| Indirizzo del client dietro un proxy | `TRUSTED_PROXY_HOPS=0` | Il numero di proxy a monte, uguale ovunque |
| Sottoscrizioni alle tabelle | Condivise tramite il database quando il CDC è attivo | `REALTIME_CDC=auto` (impostazione predefinita) |
| Canali di broadcast e presenza | In memoria | `REALTIME_CHANNEL_BUS=postgres` |
| File caricati, `STORAGE_TYPE=local` | Disco locale dell'istanza | S3 o GCS, oppure un volume condiviso sulla cartella genitore di `STORAGE_PATH` |
| Caricamenti ripristinabili (TUS) in corso | Disco dell'istanza, in `STORAGE_PATH/.tus-uploads` | Un volume condiviso su `STORAGE_PATH`, o sessioni persistenti (sticky sessions) |
| Trasformazioni delle immagini | Cache interna al processo | `STORAGE_RENDITION_CACHE=true` |
| Logs Explorer | Un buffer circolare delle ultime 10.000 righe | Nulla — inoltra stdout a un aggregatore di log |
| Timer cron | Ogni processo che esegue lo scheduler | Acquisiti nel database: un'esecuzione per slot. `REBASE_CRON_SCHEDULER` sceglie dove risiedono i timer |
| Audit RLS pianificato | Ogni processo che ne è proprietario | `REBASE_RLS_AUDIT=false` su tutte tranne una |
| `index.html` di un'app statica | Letto una volta per processo | Riavviare ogni istanza quando la build cambia |
| `/metrics` | Ciascun processo conta i propri | Eseguire lo scraping di ogni istanza |

Le sezioni seguenti spiegano il comportamento di ciascuna voce quando viene lasciata configurata per processo.

## Segreti di firma

`JWT_SECRET` firma ogni sessione e `REBASE_SERVICE_KEY` autentica le chiamate server-to-server. In fase di sviluppo ciascun processo genera i propri valori quando non sono impostati, quindi un token emesso da un processo verrà rifiutato dal successivo. La produzione rifiuta già l'avvio in assenza di `JWT_SECRET` (senza `REBASE_SERVICE_KEY` si avvia senza alcuna chiave di servizio); ciò che conta con più processi è che ciascuno riceva gli **stessi** valori — da un unico segreto, non uno per replica.

## Rate limit e indirizzo del client

I rate limiter — il budget per chiamante sulle API di dati, storage e funzioni, e i limitatori di autenticazione per accesso, reimpostazione della password, codici monouso e tentativi MFA — contano in memoria per impostazione predefinita. Un processo non può rilevare quanti peer siano attivi, quindi tre repliche con la configurazione predefinita applicheranno ogni limite tre volte. Imposta `REBASE_RATE_LIMIT_STORE=sql` affinché i contatori risiedano invece nel database.

Dietro un bilanciatore di carico, il limiter necessita anche del reale indirizzo del client, che viene trasmesso in `X-Forwarded-For`. `TRUSTED_PROXY_HOPS` definisce quanti proxy attraversare; con il valore predefinito `0`, ogni richiesta sembrerà provenire dal bilanciatore di carico e tutti i client condivideranno lo stesso bucket. Consulta [Configurazione](/docs/getting-started/configuration/#runtime-behaviour).

## Realtime

Le **sottoscrizioni alle tabelle** funzionano su più istanze quando il change data capture a livello di database è attivo, cosa che avviene per impostazione predefinita (`REALTIME_CDC=auto`): il write-ahead log (dove il database supporta la decodifica logica) o un trigger notifica ogni scrittura confermata (commit) e il listener di ogni istanza recupera nuovamente i dati per i propri iscritti. Le istanze che acquisiscono modifiche tramite WAL mantengono attivi i trigger finché un'altra istanza è ancora in ascolto su di essi, in modo che una replica che ha fatto fallback sui trigger non rimanga mai esclusa. Se il CDC è disattivato, o se la modalità `auto` non è riuscita a effettuarne il provisioning (il log di avvio ne indica il motivo), una sottoscrizione vedrà solo le scritture effettuate tramite l'istanza a cui è connesso il proprio socket. Consulta [Realtime](/docs/backend/realtime-cdc/).

I **canali di broadcast e la presenza** rimangono interni al singolo processo a meno che non sia configurato un bus di messaggistica: due client connessi a istanze diverse nello stesso canale non comunicheranno tra loro e ciascuna istanza risponderà a "chi è presente?" solo con la propria porzione di utenti. Imposta `REALTIME_CHANNEL_BUS=postgres`. Il bus ascolta le notifiche del database, operazione che richiede una connessione diretta anziché un transaction pooler — imposta `DATABASE_DIRECT_URL` quando `DATABASE_URL` passa attraverso pgBouncer. Consulta [Canali e presenza su più istanze](/docs/backend/realtime-transports/#channels-and-presence-across-instances).

## File

Con `STORAGE_TYPE=local`, i file caricati risiedono sul disco dell'istanza che li ha ricevuti, e un'altra istanza risponderà con un errore 404 per essi. Utilizza S3 o GCS, oppure monta un volume condiviso su ogni istanza, sulla cartella genitore di `STORAGE_PATH` in modo che contenga anche la directory `<STORAGE_PATH>__<key>` di ciascun bucket locale con nome. Consulta [Self-hosting: archiviazione file](/docs/deployment/self-hosting/#file-storage).

I **caricamenti ripristinabili** (l'endpoint TUS) conservano il file parziale di ciascun caricamento, insieme al relativo record, sul disco dell'istanza che lo ha generato, in `STORAGE_PATH/.tus-uploads` — anche quando i file completati vengono inviati a S3 o GCS. Montando un unico volume su `STORAGE_PATH` su ogni istanza, qualsiasi istanza potrà gestire qualsiasi caricamento; un riavvio o un rolling deploy riprenderà il caricamento dal punto in cui era stato interrotto. Senza un volume condiviso, un blocco (chunk) inviato a un'altra istanza riceverà un errore 404: instrada le richieste di caricamento di un client verso un'unica istanza (sticky session sul bilanciatore di carico). L'SDK e il pannello di amministrazione, che utilizzano questo endpoint per file superiori a 8 MiB, invieranno quindi il file tramite `POST /upload`, continuando a farlo per il resto della sessione. I caricamenti ordinari tramite `POST /upload` consistono in una singola richiesta e non sono influenzati da questo comportamento.

Le **trasformazioni delle immagini** (`?width=400&format=webp`) vengono memorizzate nella cache in memoria; di conseguenza, ogni istanza calcola ogni variante una volta e una nuova istanza parte a freddo. Imposta `STORAGE_RENDITION_CACHE=true` per salvare ogni rendering nel bucket di provenienza, dove ogni istanza potrà trovarlo. Ciò fa sì che una richiesta `GET` esegua una scrittura nel bucket, motivo per cui questa opzione è disabilitata a meno che non venga richiesta esplicitamente. Consulta [Storage](/docs/backend/storage/).

## Logs Explorer

Il Logs Explorer di Studio legge un buffer circolare delle ultime 10.000 righe di log conservate dal processo che gestisce la richiesta. Dietro un bilanciatore di carico, ogni aggiornamento della pagina potrebbe mostrare le righe di un'istanza diversa, e nessuna di esse mostrerà l'intero deployment. L'explorer indica il nome dell'istanza visualizzata. Non esiste un'impostazione per condividere questo buffer: in produzione, il runtime scrive una riga JSON per evento su stdout, ed è proprio questo il flusso da raccogliere — tramite il servizio di log della piattaforma, Loki o qualsiasi strumento che legga l'output dei container.

## Cron e la coda dei job

Ogni processo che esegue lo scheduler cron avvia i propri timer e l'esecuzione viene prima acquisita nel database, garantendo che uno slot venga eseguito **una sola volta** indipendentemente da quanti processi si attivino per esso. La messa in pausa di un job e il lease che impedisce a un trigger manuale di interferire con un'esecuzione in corso sono condivisi nello stesso modo. Non c'è nulla da configurare, purché il database sia Postgres. `REBASE_CRON_SCHEDULER` e `REBASE_JOB_WORKERS` determinano quali processi devono eseguire timer e worker — consulta [Processi separati](/docs/deployment/split-processes/).

L'audit RLS pianificato costituisce un'eccezione: non viene acquisito a livello di database, pertanto ogni processo che ne ha la titolarità eseguirà la scansione in base al proprio timer. Si tratta di un comportamento ridondante ma non rischioso; imposta `REBASE_RLS_AUDIT=false` su tutte le istanze tranne una.

## App statiche

Un processo che distribuisce il frontend o il CMS (`REBASE_SERVE_STATIC`, attivo per impostazione predefinita) legge l'`index.html` di ogni app una sola volta e lo mantiene in memoria. La sostituzione della build su un volume condiviso non ha effetto su un processo già in esecuzione: continuerà a servire il vecchio documento, che fa riferimento a chunk che potrebbero non esistere più. Rilascia una nuova build riavviando o aggiornando progressivamente (rolling deploy) ogni istanza — cosa che una nuova immagine o bundle fa comunque. In presenza di una CDN a monte e con `REBASE_SERVE_STATIC=false`, questo problema non si pone.

## Metriche

L'endpoint `/metrics` restituisce i dati relativi al processo che risponde alla richiesta. Esegui lo scraping di ogni singola istanza — un job di service-discovery Prometheus per pod, non un unico target dietro il bilanciatore di carico — ed esegui la somma nella query.

## Provisioning all'avvio

Ogni istanza esegue il passaggio additivo sullo schema all'avvio (`REBASE_MIGRATE_ON_BOOT=ensure`). Istanze con lo stesso ruolo possono eseguirlo contemporaneamente: è progettato per tollerare che un'altra istanza crei la stessa tabella un istante prima. In un deployment a processi separati, esattamente un solo ruolo si occupa del provisioning e tutti gli altri impostano `none` — consulta [Processi separati](/docs/deployment/split-processes/).
