---
sourceHash: d79cfc20665e2e22
title: Caricamenti riprendibili (TUS)
sidebar_label: Caricamenti riprendibili (TUS)
description: L'endpoint TUS v1.0.0 sotto /api/storage/tus — come un file grande viene caricato un blocco alla volta, cosa risponde ogni richiesta, come lo usano l'SDK e il pannello di amministrazione, e come si comporta ai riavvii e tra più istanze.
---

Per caricare file di grandi dimensioni o gestire condizioni di rete instabili, Rebase implementa il protocollo aperto **TUS v1.0.0**, comprese le estensioni `Creation` e `Termination`.
I suoi limiti sono quelli della sorgente, come per ogni caricamento — vedi
[Quanto può essere grande un file](/docs/backend/storage/#how-large-a-file-may-be).

## Perché i file grandi passano da qui

`POST /api/storage/upload` è un unico body multipart, che il server analizza per intero
prima di archiviarlo: da tre a cinque volte il file nella sua memoria (circa 340 MB
per un file da 100 MB). Un caricamento riprendibile trattiene un blocco alla volta — ogni `PATCH`
è sotto il limite globale del body, 10 MB per impostazione predefinita — e viene scritto nello store
dal disco: circa 50 MB per quel file, e 80 MB per uno da 400 MB. Quindi dimensiona il
limite della sorgente sulla memoria del server se i client usano `POST /api/storage/upload`
per file grandi, e non altrimenti.

`client.storage.putObject()` e il pannello di amministrazione inviano un file superiore a
8 MiB attraverso l'endpoint riprendibile, in blocchi da 8 MiB, e riprendono un blocco che
fallisce lungo il percorso dall'offset che il server detiene. Il file arriva come lo
archivierebbe `POST /api/storage/upload` — la stessa chiave, bucket, tipo, metadati
personalizzati, limiti, controllo `storageAuthorize` e trigger `finalize` — e la
chiamata restituisce lo stesso `{ key, bucket, storageUrl }`. Quando la rotta riprendibile
non può trasportarlo — un server senza l'endpoint, un blocco oltre il limite del body
del server, o un'istanza che non detiene il caricamento (vedi
[Eseguire più di un'istanza](/docs/deployment/multiple-instances/#files)) — il
file passa invece da `POST /api/storage/upload`, e quella sorgente invia
allo stesso modo anche ogni file successivo.

```
Client                                                   Rebase Server
  │                                                           │
  │─── POST /api/storage/tus (Upload-Length: 50000000) ──────>│ (Generates session ID)
  │<── 201 Created (Location: /api/storage/tus/uuid-abc) ────│
  │                                                           │
  │─── PATCH /api/storage/tus/uuid-abc (Upload-Offset: 0) ───>│ (Appends chunk via open/write)
  │<── 204 No Content (Upload-Offset: 1500000) ───────────────│
  │                                                           │
  │─── PATCH /api/storage/tus/uuid-abc (Upload-Offset: 1.5M) ─>│ (Upload finishes)
  │<── 204 No Content (Upload-Offset: 50000000) ──────────────│ (Copies to storage, unlinks temp)
```

## Ciclo di vita del caricamento

1. **Inizializzazione della sessione (`POST`)**: il client invia la dimensione totale del file nell'header `Upload-Length` e metadati in base64 tramite `Upload-Metadata`: `key` (o `filename`), `filetype`, `bucket`, `storageId`, `collection` e `property`, come `POST /api/storage/upload` li accetta come campi del form, e voci `metadata_<name>`, che diventano i metadati personalizzati dell'oggetto come i campi `metadata_<name>`. Il server crea un file segnaposto vuoto in una directory temporanea nascosta `.tus-uploads/`, con accanto un record del caricamento (`<id>.json`: la sua chiave, bucket, sorgente, tipo, dimensione e proprietario), e restituisce l'URL di caricamento. Risponde inoltre `Rebase-Upload-Result: on-complete`: questo server riporta ciò che ha archiviato quando il caricamento termina. Il caricamento vive in quella directory, non nel processo: un server riavviato lo riprende, e ogni istanza che condivide `STORAGE_PATH` lo serve — vedi [Eseguire più di un'istanza](/docs/deployment/multiple-instances/#files).
2. **Richieste di avanzamento (`HEAD`)**: se un caricamento viene interrotto, il client interroga l'URL di caricamento con una richiesta `HEAD`. Il server restituisce la posizione corrente in byte nell'header `Upload-Offset`.
3. **Aggiunta dei dati (`PATCH`)**: il client riprende l'invio dei dati binari a partire dall'offset restituito con `Content-Type: application/offset+octet-stream`. Il server scrive ogni blocco nel file temporaneo all'offset in byte dichiarato dalla richiesta, che deve essere l'offset che il server detiene (altrimenti `409`). Viene ricevuto un blocco alla volta: un `PATCH` che arriva mentre un altro per lo stesso caricamento è ancora in ricezione — tipicamente un client che reinvia un blocco bloccato — riceve `423 UPLOAD_LOCKED`, e il client riprende dall'offset che riporta `HEAD`.
4. **Finalizzazione**: quando l'`Upload-Offset` accumulato corrisponde all'`Upload-Length` dichiarato, Rebase legge il file temporaneo completato, lo racchiude come un oggetto `File` JavaScript standard e lo salva nel backend di storage configurato (disco locale o S3). Il file temporaneo viene poi eliminato. Quell'ultimo `PATCH` risponde con `Rebase-Upload-Result` contenente l'oggetto archiviato — `{ key, bucket, storageUrl }`, ciò che `POST /api/storage/upload` risponde sotto `data` — come JSON codificato in URI. Un frontend su un'altra origin può leggerlo, e anche `Location` e `Upload-Offset`, solo quando il server li espone in `Access-Control-Expose-Headers`: il runtime di Rebase e il backend ejected lo fanno; un [server personalizzato](/docs/backend/custom-server/) deve farlo.
5. **Pulizia periodica**: un cleaner in background viene eseguito ogni **60 secondi** per eliminare i caricamenti temporanei incompleti iniziati più di **24 ore** fa — anche quelli avviati da un altro processo, letti dalla directory.

## Chi può raggiungere un caricamento

Un caricamento avviato da un chiamante autenticato risponde solo a quel chiamante e agli amministratori;
chiunque altro riceve `404`, come se l'id non esistesse. Un caricamento avviato senza sessione non ha
proprietario, quindi il suo id è una capability: chi detiene l'URL di caricamento può leggerne l'avanzamento, aggiungervi
dati e annullarlo. Mantieni segreto quell'URL, come faresti con un token di download. Solo un deployment
che esegue lo storage con `requireAuth: false` può avviarne uno: con `requireAuth` attivo, che è
l'impostazione predefinita, un `POST` senza sessione viene rifiutato con `401`.

## Correlati

- [Configurazione dello Storage](/docs/backend/storage/) — sorgenti, limiti, endpoint e autorizzazione
- [Eseguire più di un'istanza](/docs/deployment/multiple-instances/#files) — dove vive un caricamento in corso
- [Archiviazione e file](/docs/sdk/storage/) — `putObject()`, che usa questo endpoint per i file superiori a 8 MiB
