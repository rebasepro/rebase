---
sourceHash: 5711b13e11b0b4c4
title: Caching dello storage e CDN
sidebar_label: Caching dello storage e CDN
description: Come Rebase distribuisce i file archiviati in modo che browser e CDN possano memorizzarli nella cache — ETag e 304, Cache-Control in base a chi può leggere un oggetto, intervalli di byte per l'avanzamento in audio e video, e cosa configurare su una CDN a monte.
---

Ogni oggetto viene veicolato tramite proxy attraverso il server anziché reindirizzato a un
URL firmato — un URL firmato si rompe in presenza di contenuti misti (una pagina HTTPS, un MinIO HTTP) e su
endpoint raggiungibili solo dal cluster. Di conseguenza, sono gli header di risposta a far
funzionare la memorizzazione nella cache.

Ogni risposta contiene un `ETag` debole e un `Last-Modified`, generati a partire dalla
dimensione dell'oggetto e dalla data di modifica. Un client che possiede già l'oggetto invia
`If-None-Match` e riceve un **304 senza corpo**, così un caricamento successivo costa un round
trip invece di un trasferimento di dati.

`Cache-Control` dipende da chi è autorizzato a leggere l'oggetto:

| Oggetto | Header |
|---|---|
| Sotto il prefisso `public/`, o `publicRead: true` | `public, max-age=60, stale-while-revalidate=86400, must-revalidate` |
| Tutto il resto | `private, max-age=60, must-revalidate` |
| Trasformazioni di immagini | lo stesso, con `max-age=3600` |

`private` è intenzionale: un oggetto che richiedeva credenziali per essere recuperato non deve essere
memorizzato da una cache condivisa, altrimenti una CDN potrebbe consegnare il file di un utente al chiamante
successivo. Per lo stesso motivo viene inviato `Vary: Authorization`.

Niente viene mai contrassegnato come `immutable`. Una chiave di archiviazione può essere sovrascritta — la scrittura
su una chiave esistente è un'operazione ordinaria — quindi la promessa di non riconvalidare mai
renderebbe invisibile un file sostituito fino allo scadere della finestra temporale.

## Avanzamento (seeking) in audio e video

Ogni risposta per un oggetto include `Accept-Ranges: bytes`, e a una richiesta `Range` si
risponde con `206 Partial Content` e un `Content-Range`. Senza di esso un browser
non consentirà l'avanzamento rapido all'interno di un elemento multimediale servito da qui — e Safari rifiuta
di riprodurre un tag `<video>` la cui prima risposta non sia un `206` — quindi per i media questa è
la differenza tra un player funzionante e uno non funzionante.

- Un solo intervallo per richiesta: `bytes=0-499`, `bytes=500-`, `bytes=-500`. Questo è ciò che
  i browser inviano per la riproduzione.
- Più intervalli in un singolo header ricevono come risposta l'intero oggetto e un `200`,
  il che è sempre lecito. Nessun client rilevante li invia.
- Un intervallo che inizia oltre la fine riceve un `416` con `Content-Range: bytes */<size>`,
  e non una silenziosa risposta con il file intero.
- La riconvalida prevale sull'intervallo: una richiesta che include sia `If-None-Match` sia
  `Range` riceve il `304`.

Vengono letti solo i byte richiesti — dal disco sullo storage locale, e tramite una
lettura con intervallo (ranged read) da S3 e GCS — e ogni oggetto viene trasmesso in streaming al client man mano che
viene letto anziché essere prima caricato in memoria; in questo modo, servire un video di grandi dimensioni costa al
server la stessa memoria necessaria per servire una miniatura. Una riconvalida che termina con un
`304`, un `HEAD`, un `416` e una resa dell'immagine in cache ricevono risposta a partire dai
metadati dell'oggetto senza leggerne affatto i byte.

Un `StorageController` personalizzato ottiene lo stesso comportamento implementando i metodi opzionali
`statObject` e `getObjectStream`. Un controller che ne è sprovvisto viene gestito tramite
`getObject`, che legge l'intero oggetto per ogni richiesta, inclusi gli intervalli.

## Posizionare una CDN a monte

Poiché gli oggetti pubblici sono `public` con una finestra di `stale-while-revalidate` e un
validatore, qualsiasi normale reverse proxy o CDN può memorizzarli nella cache senza alcuna configurazione
aggiuntiva. È sufficiente puntarla verso l'origine API e fare in modo che rispetti gli header.

Due cose da configurare sulla CDN stessa:

- **Rispettare `Vary: Authorization`**, oppure non memorizzare affatto nella cache le rotte autenticate.
  Una CDN che ignora `Vary` e memorizza nella cache le risposte `private` rappresenta proprio l'errore per cui
  questo header esiste.
- **Prevedere la riconvalida.** Il breve `max-age` implica che la CDN effettuerà richieste di controllo
  regolarmente; tali richieste sono economici 304, e sono ciò che impedisce a un
  oggetto sovrascritto di essere distribuito obsoleto.

## Risorse correlate

- [Configurazione dello storage](/docs/backend/storage/) — i backend da cui vengono serviti questi header, e il prefisso `public/` e `publicRead` che rendono un oggetto `public`.
- [Autorizzazione per singolo oggetto](/docs/backend/storage-authorization/) — chi può leggere un oggetto, che è ciò che determina la scelta tra `public` e `private`.
- [Caricamento file](/docs/collections/file-uploads/) — le colonne di storage che contengono i file, e come il pannello li carica.
