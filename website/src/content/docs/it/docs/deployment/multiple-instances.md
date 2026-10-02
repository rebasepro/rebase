---
sourceHash: 2e1acf0a887d27a1
title: Eseguire più di un'istanza
sidebar_label: Più di un'istanza
description: Ogni elemento di stato che un processo Rebase conserva solo per sé, e l'impostazione che lo condivide — cosa impostare prima che una seconda replica, un rolling deploy o un deployment suddiviso ricevano traffico.
---

## Panoramica

Gran parte di un deployment Rebase vive già nel database: righe, utenti e
sessioni, chiavi API, la coda dei job, le prenotazioni dei cron, le chiavi di
idempotenza, la cronologia dei record, i token del server OAuth di MCP. Un
secondo processo puntato sullo stesso database vede tutto questo.

Alcune cose no. Ciascuna è per processo per impostazione predefinita, perché
un solo processo è il deployment predefinito e la condivisione ha un costo —
una tabella, una scrittura su bucket, una connessione al database. Eseguire
due processi dietro un load balancer, scalare oltre uno, o un rolling deploy
che per un breve periodo esegue il vecchio e il nuovo fianco a fianco ti
portano tutti su questa pagina. Lo stesso vale per un
[deployment suddiviso](/docs/deployment/split-processes/), che per
definizione è composto da più processi.

Passa in rassegna l'elenco sotto prima che la seconda istanza riceva
traffico. Niente di tutto questo fallisce in modo evidente: ogni voce si
manifesta come un limite applicato tre volte, un evento che alcuni client non
vedono mai, o una pagina che mostra log diversi a ogni aggiornamento.

## La checklist

| Cosa | Per processo per impostazione predefinita | Cosa lo condivide |
| --- | --- | --- |
| Chiavi di firma | Generate per processo in sviluppo | `JWT_SECRET` e `REBASE_SERVICE_KEY`, impostate esplicitamente e **identiche** ovunque |
| Contatori del rate limiting | In memoria | `REBASE_RATE_LIMIT_STORE=sql` |
| Indirizzo del client dietro un proxy | `TRUSTED_PROXY_HOPS=0` | Il numero di proxy davanti, lo stesso ovunque |
| Sottoscrizioni alle collezioni | Condivise tramite il database quando il CDC è attivo | `REALTIME_CDC=auto` (il valore predefinito) |
| Canali di broadcast e presence | In memoria | `REALTIME_CHANNEL_BUS=postgres` |
| File caricati, `STORAGE_TYPE=local` | Il disco proprio dell'istanza | S3 o GCS, oppure un volume condiviso su `STORAGE_PATH` |
| Upload ripristinabili (TUS) in corso | La memoria e il disco dell'istanza | Sessioni sticky; un riavvio li perde comunque |
| Trasformazioni di immagini | Una cache in-process | `STORAGE_RENDITION_CACHE=true` |
| Logs Explorer | Un ring delle ultime 10.000 righe | Niente — invia lo stdout a un aggregatore di log |
| Timer cron | Ogni processo che esegue lo scheduler | Prenotati nel database: una sola esecuzione per slot. `REBASE_CRON_SCHEDULER` decide dove vivono i timer |
| Audit RLS pianificato | Ogni processo che lo possiede | `REBASE_RLS_AUDIT=false` su tutti tranne uno |
| L'`index.html` di un'app statica | Letto una volta per processo | Riavvia ogni istanza quando la build cambia |
| `/metrics` | Ogni processo conta solo il proprio | Effettua lo scraping di ogni istanza |

Le sezioni sotto spiegano cosa fa ciascuna voce quando resta per processo.

## Chiavi di firma

`JWT_SECRET` firma ogni sessione e `REBASE_SERVICE_KEY` autentica le chiamate
server-to-server. In sviluppo ogni processo genera la propria quando non sono
impostate, quindi un token emesso da un processo viene rifiutato dal
successivo. La produzione rifiuta già l'avvio senza di esse; ciò che conta
con più processi è che ognuno riceva gli **stessi** valori — da un unico
segreto, non uno per replica.

## Limiti di frequenza e indirizzo del client

I rate limiter — il budget per chiamante sulle API di data, storage e
functions, e i limiter di autenticazione su accesso, reset della password,
codici temporanei e tentativi MFA — contano in memoria per impostazione
predefinita. Un processo non può sapere quanti pari ha, quindi tre repliche
sul valore predefinito applicano il triplo di ogni limite. Imposta
`REBASE_RATE_LIMIT_STORE=sql` e i contatori vivono invece nel database.

Dietro un load balancer il limiter ha bisogno anche del vero indirizzo del
client, che arriva in `X-Forwarded-For`. `TRUSTED_PROXY_HOPS` indica quanti
proxy superare; al valore predefinito `0` ogni richiesta appare provenire dal
load balancer e ogni client condivide un unico bucket. Vedi
[Configurazione](/docs/getting-started/configuration/#runtime-behaviour).

## Realtime

Le **sottoscrizioni alle collezioni** funzionano tra istanze quando la
change capture a livello di database è attiva, cosa che avviene per
impostazione predefinita (`REALTIME_CDC=auto`): un trigger annuncia ogni
scrittura confermata, e il listener di ogni istanza esegue un nuovo fetch per
i propri sottoscrittori. Se il CDC è disattivato, o se `auto` non è riuscito a
configurarlo (il log di avvio indica il motivo), una sottoscrizione vede solo
le scritture effettuate tramite l'istanza a cui è connesso il suo socket.
Vedi [Realtime](/docs/backend/realtime/#database-level-change-capture-cdc).

I **canali di broadcast e presence** sono in-process a meno che un bus non li
veicoli: due client su istanze diverse nello stesso canale non si sentono a
vicenda, e ogni istanza risponde "chi c'è?" con solo la propria metà. Imposta
`REALTIME_CHANNEL_BUS=postgres`. Il bus resta in ascolto sul database, il che
richiede una connessione diretta anziché un pooler transazionale — imposta
`DATABASE_DIRECT_URL` quando `DATABASE_URL` passa attraverso pgBouncer. Vedi
[Canali e presence tra istanze](/docs/backend/realtime-transports/#channels-and-presence-across-instances).

## File

Con `STORAGE_TYPE=local`, i caricamenti sono file sul disco dell'istanza che
li ha ricevuti, e un'altra istanza risponde 404 per essi. Usa S3 o GCS, oppure
monta un unico volume su `STORAGE_PATH` su ogni istanza. Vedi
[Self-hosting: archiviazione file](/docs/deployment/self-hosting/#file-storage).

Gli **upload ripristinabili** (l'endpoint TUS) mantengono il file parziale di
ogni caricamento e il suo stato sul disco locale dell'istanza che lo ha
creato, sotto `STORAGE_PATH/.tus-uploads` — anche quando i file completati
finiscono su S3 o GCS. Un chunk che arriva su un'altra istanza riceve 404 e il
client ricomincia da capo. Instrada le richieste di upload di un client verso
una sola istanza (sessioni sticky sul load balancer). Un volume condiviso su
`STORAGE_PATH` condivide i file parziali ma non ancora lo stato del
caricamento, che è mantenuto nella memoria del processo — quindi un riavvio o
un rolling deploy rimanda anche un upload in corso al byte 0. I caricamenti
ordinari tramite `POST /upload` sono una singola richiesta e non sono
interessati.

Le **trasformazioni di immagini** (`?width=400&format=webp`) vengono
memorizzate in cache in memoria, quindi ogni istanza calcola ogni variante
una volta, e una nuova istanza parte a freddo. Imposta
`STORAGE_RENDITION_CACHE=true` per scrivere ogni rendition nel bucket di
provenienza, dove ogni istanza la trova. Questo fa sì che una `GET` scriva sul
tuo bucket, motivo per cui è disattivato finché non viene richiesto. Vedi
[Storage](/docs/backend/storage/).

## Logs Explorer

Il Logs Explorer di Studio legge un ring delle ultime 10.000 righe di log
mantenute dal processo che serve la richiesta. Dietro un load balancer ogni
aggiornamento può mostrare le righe di un'istanza diversa, e nessuna di esse
mostra l'intero deployment. Non esiste un'impostazione che lo condivida: il
runtime scrive una riga JSON per evento su stdout in produzione, ed è quello
che va raccolto — il servizio di log della tua piattaforma, Loki, o
qualunque cosa legga l'output del container.

## Cron e coda dei job

Ogni processo che esegue lo scheduler cron arma i propri timer, e
l'esecuzione viene prenotata prima nel database, quindi uno slot viene
eseguito **una sola volta** indipendentemente da quanti processi lo attivano.
Mettere in pausa un job, e il lease che impedisce a un trigger manuale di
intervenire su un'esecuzione in corso, sono condivisi allo stesso modo. Nulla
da impostare, purché il database sia Postgres. `REBASE_CRON_SCHEDULER` e
`REBASE_JOB_WORKERS` decidono quali processi eseguono timer e worker —
vedi [Processi separati](/docs/deployment/split-processes/).

L'audit RLS pianificato è l'eccezione: non è prenotato, quindi ogni processo
che lo possiede esegue la scansione sul proprio timer. Questo è ridondante
piuttosto che insicuro; imposta `REBASE_RLS_AUDIT=false` ovunque tranne su
uno.

## App statiche

Un processo che serve il frontend o il CMS (`REBASE_SERVE_STATIC`, attivo per
impostazione predefinita) legge una sola volta l'`index.html` di ogni app e lo
mantiene. Sostituire la build su un volume condiviso non raggiunge un
processo in esecuzione: continua a servire il documento vecchio, che nomina
chunk che potrebbero non esistere più. Distribuisci una nuova build
riavviando o eseguendo il rolling di ogni istanza — cosa che una nuova
immagine o un nuovo bundle fanno comunque. Con una CDN davanti e
`REBASE_SERVE_STATIC=false`, questo non si applica.

## Metriche

`/metrics` riporta il processo che risponde. Effettua lo scraping di ogni
istanza — un job di service discovery di Prometheus per pod, non un singolo
target dietro il load balancer — e somma nella query.

## Provisioning all'avvio

Ogni istanza esegue la procedura additiva sullo schema all'avvio
(`REBASE_MIGRATE_ON_BOOT=ensure`). Istanze dello stesso ruolo possono
eseguirla contemporaneamente: è scritta per tollerare un pari che crea la
stessa tabella un istante prima. In un deployment suddiviso, esattamente un
ruolo effettua il provisioning e ogni altro imposta `none` — vedi
[Processi separati](/docs/deployment/split-processes/).
