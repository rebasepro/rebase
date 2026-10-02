---
sourceHash: bad3ea0d4f6e00f8
title: Caching dello storage e CDN
sidebar_label: Caching dello storage e CDN
description: Come Rebase serve i file memorizzati in modo che browser e CDN possano metterli in cache — ETag e 304, Cache-Control in base a chi può leggere un oggetto, byte range per il seeking in audio e video, e cosa configurare su una CDN davanti.
---

Ogni oggetto viene veicolato tramite proxy attraverso il server anziché
reindirizzato a un URL firmato — un URL firmato genera errori in caso di
contenuti misti (una pagina HTTPS, un MinIO su HTTP) e su endpoint
raggiungibili esclusivamente all'interno del cluster. Di conseguenza, sono gli
header di risposta a rendere possibile il funzionamento della cache.

Ciascuna risposta include un `ETag` debole e `Last-Modified`, ricavati dalla
dimensione dell'oggetto e dall'orario di modifica. Un client che possiede già
l'oggetto invia `If-None-Match` e riceve un **304 senza corpo**, per cui un
caricamento ripetuto comporta solo un round trip anziché un trasferimento.

`Cache-Control` dipende da chi è autorizzato a leggere l'oggetto:

| Oggetto | Header |
|---|---|
| Sotto il prefisso `public/`, o `publicRead: true` | `public, max-age=60, stale-while-revalidate=86400, must-revalidate` |
| Qualsiasi altra cosa | `private, max-age=60, must-revalidate` |
| Trasformazioni di immagini | lo stesso, con `max-age=3600` |

`private` è intenzionale: un oggetto per il cui recupero sono state necessarie
credenziali non deve essere memorizzato da una cache condivisa, altrimenti una
CDN potrebbe consegnare il file di un utente a quello successivo. `Vary:
Authorization` viene inviato per lo stesso motivo.

Nulla viene mai contrassegnato come `immutable`. Una chiave di storage può
essere sovrascritta — la scrittura su una chiave esistente è un'operazione
comune — quindi la promessa di non effettuare mai una riconvalida renderebbe
invisibile un file sostituito fino alla scadenza dell'intervallo temporale.

## Seeking in audio e video

Ogni risposta di un oggetto include `Accept-Ranges: bytes`, e a una richiesta
`Range` si risponde con `206 Partial Content` e un `Content-Range`. Senza di
questo, un browser non consentirà il seeking in un elemento multimediale
servito da qui — e Safari rifiuta di riprodurre un tag `<video>` la cui prima
risposta non sia un `206` — perciò per i media questa è la differenza tra un
player funzionante e uno non funzionante.

- Un singolo intervallo per richiesta: `bytes=0-499`, `bytes=500-`,
  `bytes=-500`. Questo è ciò che i browser inviano per la riproduzione.
- A intervalli multipli in un singolo header si risponde con l'intero oggetto
  e un `200`, operazione sempre valida. Nessun client rilevante ne invia.
- Un intervallo che inizia oltre la fine riceve un `416` con
  `Content-Range: bytes */<size>`, e non una risposta silenziosa con l'intero
  file.
- La riconvalida ha la priorità su un range: una richiesta contenente sia
  `If-None-Match` sia `Range` riceve un `304`.

Nello storage locale viene letta da disco solo la porzione richiesta. Su S3 e
GCS l'oggetto viene comunque recuperato per intero — un `StorageController`
non dispone di lettura a intervalli — pertanto il risparmio riguarda la
risposta, non l'upstream.

## Inserire una CDN davanti

Poiché gli oggetti pubblici sono `public` con una finestra di
`stale-while-revalidate` e un validatore, qualsiasi normale reverse proxy o
CDN può memorizzarli nella cache senza configurazioni aggiuntive. È
sufficiente puntarlo all'origine dell'API e lasciare che rispetti gli header.

Due aspetti da configurare direttamente sulla CDN:

- **Rispettare `Vary: Authorization`**, oppure non inserire affatto in cache
  le rotte autenticate. Una CDN che ignora `Vary` e mette in cache risposte
  `private` rappresenta l'errore per cui questo header è stato creato.
- **Aspettarsi la riconvalida.** Il breve `max-age` fa sì che la CDN ripeta la
  richiesta regolarmente; tali richieste sono leggeri 304, ed è proprio
  questo a evitare che un oggetto sovrascritto venga servito obsoleto.

## Correlati

- [Storage](/docs/backend/storage/) — i backend da cui vengono serviti questi header, e il prefisso `public/` e `publicRead` che rendono un oggetto `public`.
- [Autorizzazione per Oggetto](/docs/backend/storage/#per-object-authorization) — chi può leggere un oggetto, ciò che decide tra `public` e `private`.
- [Campi di caricamento file](/docs/collections/file-uploads/) — le proprietà di collezione che memorizzano i file.
