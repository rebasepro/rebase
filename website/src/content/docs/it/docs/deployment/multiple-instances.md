---
sourceHash: de9051fe769a602b
title: Esecuzione di più istanze
sidebar_label: Più istanze
description: "Ogni elemento di stato che un processo Rebase mantiene per sé e l'impostazione per condividerlo: cosa configurare prima che una seconda replica, un rolling deploy o un deployment suddiviso ricevano traffico."
---

## Panoramica

La maggior parte di un deployment Rebase risiede già nel database: righe, utenti e
sessioni, chiavi API, la coda dei job, le acquisizioni cron, le chiavi di idempotenza,
la cronologia dei record, i token del server OAuth MCP. Un secondo processo puntato verso lo
stesso database ha visibilità su tutto questo.

Alcuni elementi invece no. Ciascuno è limitato al singolo processo per impostazione predefinita, poiché
un solo processo è il deployment predefinito e la condivisione ha un costo: una tabella, una
scrittura su bucket, una connessione al database. L'esecuzione di due processi dietro un load balancer,
la scalabilità automatica oltre l'unità o un rolling deploy che esegue brevemente la vecchia e la nuova versione affiancate
ti portano su questa pagina. Lo stesso vale per un [deployment suddiviso](/docs/deployment/split-processes/),
che per definizione è composto da più processi.

Esamina l'elenco sottostante prima che la seconda istanza inizi a ricevere traffico. Nessun elemento
fallisce in modo evidente: ogni problema si manifesta come un limite applicato tre volte di troppo,
un evento che alcuni client non vedono mai o una pagina che mostra log diversi a ogni aggiornamento.

## La checklist

| Cosa | Per processo per impostazione predefinita | Cosa lo condivide |
| --- | --- | --- |
| Segreti di firma | Generati per processo in fase di sviluppo | `JWT_SECRET` e `REBASE_SERVICE_KEY`, impostati esplicitamente e **identici** ovunque |
| Contatori di rate limit | In memoria | `REBASE_RATE_LIMIT_STORE=sql` |
| Indirizzo del client dietro un proxy | `TRUSTED_PROXY_HOPS=0` | Il numero di proxy a monte, uguale ovunque |
| Sottoscrizioni alle collection | Condivise tramite il database quando CDC è attivo | `REALTIME_CDC=auto` (impostazione predefinita) |
| Canali broadcast e presenza | In memoria | `REALTIME_CHANNEL_BUS=postgres` |
| File caricati, `STORAGE_TYPE=local` | Il disco locale dell'istanza | S3 o GCS, oppure un volume condiviso sulla cartella genitore di `STORAGE_PATH` |
| Caricamenti ripristinabili (TUS) in corso | Il disco dell'istanza, in `STORAGE_PATH/.tus-uploads` | Un volume condiviso in `STORAGE_PATH`, oppure sticky session |
| Trasformazioni delle immagini | Una cache interna al processo | `STORAGE_RENDITION_CACHE=true` |
| Logs Explorer | Un buffer circolare delle ultime 10.000 righe | Nulla — invia stdout a un aggregatore di log |
| Timer cron | Ogni processo che esegue lo scheduler | Acquisiti nel database: un'esecuzione per slot. `REBASE_CRON_SCHEDULER` definisce dove risiedono i timer |
| Audit RLS pianificato | Ogni processo a cui appartiene | `REBASE_RLS_AUDIT=false` su tutti tranne uno |
| `index.html` di un'app statica | Letto una volta per processo | Riavvia ogni istanza quando cambia la build |
| `/metrics` | Ciascun processo calcola le proprie | Esegui lo scraping di ciascuna istanza |

Le sezioni seguenti spiegano il comportamento di ogni elemento se lasciato limitato al singolo processo.

## Segreti di firma

`JWT_SECRET` firma ciascuna sessione e `REBASE_SERVICE_KEY` autentica
le chiamate server-to-server. In fase di sviluppo, ogni processo genera i propri se
non sono impostati, quindi un token emesso da un processo viene rifiutato dal successivo.
In produzione l'avvio viene già rifiutato se sono assenti; ciò che conta con più processi
è che ognuno riceva gli **stessi** valori — da un unico segreto, non uno per replica.

## Rate limit e indirizzo del client

I limitatori di frequenza (rate limiter) — il budget per chiamante sulle API di dati, storage e
funzioni, e i limitatori di autenticazione per accesso, reimpostazione della password, codici monouso e tentativi
MFA — eseguono il conteggio in memoria per impostazione predefinita. Un processo non può vedere quanti peer
ha, quindi tre repliche con le impostazioni predefinite applicheranno ogni limite con una tolleranza triplicata. Imposta
`REBASE_RATE_LIMIT_STORE=sql` affinché i contatori risiedano invece nel database.

Dietro un load balancer, il limiter necessita anche del vero indirizzo del client, che
arriva tramite `X-Forwarded-For`. `TRUSTED_PROXY_HOPS` specifica quanti proxy oltrepassare;
con il valore predefinito `0`, ogni richiesta sembrerà provenire dal load balancer
e tutti i client condivideranno lo stesso bucket. Consulta
[Configurazione](/docs/getting-started/configuration/#runtime-behaviour).

## Realtime

Le **sottoscrizioni alle collection** funzionano tra istanze quando l'acquisizione delle modifiche a livello di database (CDC)
è attiva, come accade per impostazione predefinita (`REALTIME_CDC=auto`): un trigger notifica
ogni operazione di scrittura confermata, e il listener di ogni istanza effettua nuovamente il recupero per i propri
sottoscrittori. Se CDC è disattivato, o se `auto` non è riuscito a configurarlo (il log di avvio specifica
il motivo), una sottoscrizione vede solo le scritture effettuate tramite l'istanza a cui
è connesso il suo socket. Consulta
[Realtime](/docs/backend/realtime-cdc/).

I **canali broadcast e la presenza** rimangono interni al processo a meno che non ci sia un bus a trasmetterli:
due client su istanze diverse nello stesso canale non si vedono reciprocamente,
e ogni istanza risponde alla domanda "chi è presente?" solo con la propria metà. Imposta
`REALTIME_CHANNEL_BUS=postgres`. Il bus ascolta sul database, che richiede una
connessione diretta anziché un pooler di transazioni: imposta `DATABASE_DIRECT_URL`
quando `DATABASE_URL` passa attraverso pgBouncer. Consulta
[Canali e presenza tra istanze](/docs/backend/realtime-transports/#channels-and-presence-across-instances).

## File

Con `STORAGE_TYPE=local`, i caricamenti sono file sul disco dell'istanza che li
ha ricevuti, e un'altra istanza restituirà 404 per essi. Usa S3 o GCS, oppure
monta un volume comune su ogni istanza, sulla cartella genitore di `STORAGE_PATH` in modo che
contenga anche la directory `<STORAGE_PATH>__<key>` di ciascun bucket locale con nome. Consulta
[Self-hosting: archiviazione dei file](/docs/deployment/self-hosting/#file-storage).

I **caricamenti ripristinabili** (l'endpoint TUS) conservano il file parziale di ogni upload e,
una registrazione del caricamento accanto ad esso, sul disco dell'istanza che
lo ha creato, in `STORAGE_PATH/.tus-uploads` — anche quando i file completati vengono inviati a
S3 o GCS. Monta un unico volume su `STORAGE_PATH` in ogni istanza e qualunque istanza
potrà gestire qualsiasi caricamento; un riavvio o un rolling deploy riprenderà un caricamento da dove
si era interrotto. Senza un volume condiviso, un blocco di dati che finisce su un'altra istanza
riceverà una risposta 404: instrada le richieste di upload di un client verso un'unica istanza (sticky session
sul load balancer). L'SDK e il pannello di amministrazione, che usano questo endpoint per
file superiori a 8 MiB, invieranno quindi il file tramite `POST /upload`, e continueranno
a farlo per il resto della sessione. I caricamenti ordinari tramite `POST /upload` consistono in una sola richiesta
e non sono impattati. Nella versione 0.23 lo stato del caricamento risiedeva nella memoria del processo,
quindi un volume condiviso non era d'aiuto e un riavvio riportava il caricamento al byte 0.

Le **trasformazioni delle immagini** (`?width=400&format=webp`) sono memorizzate nella cache in memoria, quindi ogni
istanza elabora ogni variante una volta, e una nuova istanza parte senza cache. Imposta
`STORAGE_RENDITION_CACHE=true` per riscrivere ogni variante nel bucket da cui
proviene, dove ogni istanza potrà trovarla. Ciò comporta che una richiesta `GET` scriva sul tuo
bucket, motivo per cui è disabilitato a meno che non sia esplicitamente richiesto. Consulta
[Storage](/docs/backend/storage/).

## Logs Explorer

Logs Explorer in Studio legge un buffer circolare delle ultime 10.000 righe di log conservate dal
processo che gestisce la richiesta. Dietro un load balancer, ogni aggiornamento della pagina potrebbe mostrare
le righe di un'istanza diversa, e nessuna di esse mostrerà l'intero deployment.
L'explorer indica l'istanza che sta mostrando.
Non esiste un'impostazione per condividere il buffer: in produzione il runtime scrive una riga JSON per ogni evento su
stdout, ed è questo che va raccolto: il servizio di log della tua piattaforma,
Loki o qualsiasi strumento che legga l'output dei container.

## Cron e la coda dei job

Ogni processo che esegue lo scheduler dei cron attiva i propri timer, e l'esecuzione viene
prima acquisita nel database, così che uno slot venga eseguito **una sola volta** indipendentemente da quanti processi
vengano attivati per esso. La sospensione di un job e il lease che impedisce a un trigger manuale di interferire con un'esecuzione
in corso sono condivisi nello stesso modo. Non c'è nulla da configurare, a patto che il database
sia Postgres. `REBASE_CRON_SCHEDULER` e `REBASE_JOB_WORKERS` decidono quali
processi eseguono effettivamente i timer e i worker — consulta
[Processi suddivisi](/docs/deployment/split-processes/).

L'audit RLS pianificato è l'eccezione: non viene acquisito, quindi ogni processo
a cui appartiene esegue la scansione in base al proprio timer. Questo è ridondante ma non dannoso; imposta
`REBASE_RLS_AUDIT=false` su tutte le istanze tranne una.

## App statiche

Un processo che serve il frontend o il CMS (`REBASE_SERVE_STATIC`, attivo per
impostazione predefinita) legge il file `index.html` di ogni app una volta e lo conserva. La sostituzione della build
su un volume condiviso non si riflette su un processo in esecuzione: esso continuerà a servire il vecchio
documento, che fa riferimento a chunk che potrebbero non esistere più. Rilascia una nuova build
riavviando o aggiornando a rotazione ogni istanza — cosa che una nuova immagine o bundle fa comunque.
Con una CDN a monte e `REBASE_SERVE_STATIC=false`, questo non si applica.

## Metriche

`/metrics` restituisce i dati relativi al processo che risponde. Esegui lo scraping di ogni istanza — un
job di service-discovery Prometheus per pod, non un unico target dietro il load
balancer — e calcola la somma nella query.

## Provisioning all'avvio

Ogni istanza esegue il passaggio additivo dello schema all'avvio
(`REBASE_MIGRATE_ON_BOOT=ensure`). Le istanze con lo stesso ruolo possono eseguirlo
contemporaneamente: è progettato per tollerare che un peer crei la stessa tabella un istante
prima. In un deployment suddiviso, esattamente un ruolo effettua il provisioning e tutti gli altri impostano
`none` — consulta [Processi suddivisi](/docs/deployment/split-processes/).
