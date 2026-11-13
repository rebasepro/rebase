---
sourceHash: 14cb375a352ba487
title: Storage e File
sidebar_label: Storage
description: Carica, scarica, elenca ed elimina file utilizzando il modulo storage dell'SDK tipizzato di Rebase.
---

## Panoramica

Il modulo `client.storage` fornisce metodi per la gestione dei file: caricamento, download, elenco ed eliminazione. Funziona sia con dischi locali che con backend di storage compatibili con S3, a seconda della configurazione del server.

Tutti i metodi di storage utilizzano il trasporto condiviso, quindi i token di autenticazione vengono inseriti automaticamente.

## Caricare un file

Utilizza `putObject()` per caricare un file. Accetta un oggetto `File` o `Blob` insieme a una chiave di archiviazione opzionale e ai metadati:

```typescript
const result = await client.storage.putObject({
    file: fileObject,                   // File or Blob
    key: "products/images/camera.jpg",  // Storage path (optional)
    bucket: "uploads",                  // Bucket name (optional)
    public: false,                      // Store public (permanent token-less URL) — optional, default false
    metadata: {                         // Custom metadata (optional)
        description: "Product photo",
        uploadedBy: "user-123"
    }
});

// result: { key: string; bucket: string; storageUrl: string }
```

Un file superiore a 8 MiB viene caricato tramite l'endpoint ripristinabile (TUS) del server, 8 MiB per richiesta, invece di una singola richiesta multipart che il server elabora per intero; in questo modo, un caricamento di grandi dimensioni costa al server un solo blocco di memoria, non da tre a cinque volte la dimensione del file. Un blocco che fallisce durante il trasferimento viene reinviato a partire dal punto raggiunto dal server. Il risultato, l'oggetto archiviato e i controlli del server sono identici in entrambi i casi. Quando l'endpoint ripristinabile non può accettare il file (un server obsoleto o più istanze che non condividono i caricamenti), viene inviato come una singola richiesta `POST /api/storage/upload`, così come ogni file successivo inviato da quel client. Consulta [Caricamenti ripristinabili (TUS)](/docs/backend/storage-resumable-uploads/).

### Da un File Input

```typescript
const input = document.querySelector<HTMLInputElement>("#file-input");
const file = input?.files?.[0];

if (file) {
    const result = await client.storage.putObject({
        file,
        key: `avatars/${userId}/${file.name}`
    });
    console.log("Uploaded to:", result.key);
}
```

## Ottenere un URL firmato

Recupera un URL di download e i metadati per un file archiviato:

```typescript
const { url, metadata, fileNotFound } = await client.storage.getSignedUrl(
    "products/images/camera.jpg"
);

if (url) {
    console.log("Download URL:", url);
    console.log("Content type:", metadata?.contentType);
} else {
    console.log("File not found");
}
```

:::caution[L'argomento `bucket` è attualmente un prefisso del percorso]
In `getSignedUrl`, `getObject` e `deleteObject`, il secondo argomento viene incorporato nella chiave dell'oggetto (`<bucket>/<key>`) e non raggiunge mai il server come bucket, quindi un nome non gestito dal deployment viene segnalato come *file* mancante, non come bucket sconosciuto — e un file scritto con `putObject({ bucket: "media" })` non viene riletto con `getSignedUrl(key, "media")`. Rileggi un file utilizzando la stessa struttura di chiamata che lo ha scritto. Il lato server risponde già con `404 UNKNOWN_STORAGE_SOURCE` per un bucket non gestito su `/api/storage/list`, e anche su S3 o GCS durante i caricamenti; l'argomento dell'SDK è in fase di rielaborazione per allinearsi.
:::

Con un bucket specifico:

```typescript
const { url } = await client.storage.getSignedUrl(
    "camera.jpg",
    "product-images"   // bucket
);
```

L'SDK memorizza nella cache gli URL firmati per evitare chiamate ridondanti al server, fino alla scadenza del token di download di ciascuno. Le ricerche effettuate insieme — ad esempio una pagina di anteprime che chiama `getSignedUrl()` nello stesso tick — vengono inviate al server come una singola richiesta `POST /api/storage/metadata` ogni 100 file, che il rate limiter conteggia come un decimo delle richieste che sostituisce; un file che un chiamante non è autorizzato a leggere fallisce solo per quella specifica chiamata. La cache appartiene alle credenziali che hanno effettuato la richiesta: quando il token di accesso cambia — una disconnessione, l'accesso di un altro utente, un aggiornamento — la cache viene reimpostata, in modo che a un utente non venga mai fornito un URL generato per un altro.

### URL privati vs pubblici

- **I file privati** ottengono un URL con un **token di download di breve durata con ambito limitato al percorso** (`?token=…`, 5 minuti a meno che il server non imposti `STORAGE_DOWNLOAD_TOKEN_TTL`, che la versione 0.23 non legge) — mai il tuo token di accesso. Poiché scade, **non persistere un URL privato**; memorizza il **percorso** del file e chiama nuovamente `getSignedUrl()` quando lo renderizzi.
- **I file pubblici** (archiviati sotto il prefisso `public/` — imposta `storage: { public: true }` sulla proprietà, o passa `public: true` a `putObject`) ottengono un URL **stabile, senza token, permanente e memorizzabile nella cache del CDN** senza round-trip verso il server. Questi possono essere salvati in sicurezza in un database e collegati direttamente (hotlinking).

### File all'interno del testo

Anche il testo che incorpora un file — come le immagini in un campo markdown — non può contenere un URL privato; pertanto, contiene invece un **riferimento di archiviazione (storage reference)**: `rebase-storage:posts/cover.png`, con `?storageId=media` quando il file si trova in una sorgente con nome. Questo è ciò che l'editor markdown del pannello di amministrazione scrive per un'immagine caricata. Sostituisci i riferimenti con gli URL quando renderizzi il testo:

```typescript
import { resolveStorageReferences } from "@rebasepro/client";

const post = await client.data.table("posts").findById("post-1");
const body = await resolveStorageReferences(String(post?.body ?? ""), client);
// `body` is the same markdown, each reference replaced by a fresh URL.
```

Ogni oggetto viene firmato una sola volta per chiamata, dalla propria sorgente, garantendo il funzionamento di un'immagine privata indipendentemente da quanto tempo fa è stata caricata. Un riferimento che punta a un oggetto non più esistente viene lasciato invariato. `storageReference(key, storageId?)` ne crea uno, per il testo scritto manualmente.

I testi salvati prima dell'introduzione dei riferimenti contengono direttamente l'URL di download del file privato, `…/storage/file/posts/cover.png?token=…`, il cui token è scaduto pochi minuti dopo la scrittura. `resolveStorageReferences` rinnova anche questi: il token identifica ancora l'oggetto, quindi l'URL viene sostituito con uno nuovo. Per memorizzare invece i riferimenti, riscrivi il testo una volta con `storageReferencesForDownloadUrls(text)`, che lascia invariato qualsiasi altro URL.

## Scaricare un file

Recupera un file come oggetto `File`:

```typescript
const file = await client.storage.getObject("products/images/camera.jpg");

if (file) {
    console.log("File name:", file.name);
    console.log("File type:", file.type);
    console.log("File size:", file.size);

    // Create a download link
    const url = URL.createObjectURL(file);
    window.open(url);
} else {
    console.log("File not found");
}
```

Con un bucket specifico:

```typescript
const file = await client.storage.getObject("camera.jpg", "product-images");
```

## Eliminare un file

```typescript
await client.storage.deleteObject("products/images/camera.jpg");

// With bucket
await client.storage.deleteObject("camera.jpg", "product-images");
```

L'eliminazione di un file inesistente non genera un errore.

## Elencare i file

Elenca i file per prefisso, con paginazione opzionale:

```typescript
const result = await client.storage.listObjects("products/images/", {
    bucket: "uploads",
    maxResults: 50,
    pageToken: undefined   // for pagination
});

for (const item of result.items) {
    console.log(item.fullPath, item.name, item.size, item.updated, item.contentType);
}

// Paginate
if (result.nextPageToken) {
    const nextPage = await client.storage.listObjects("products/images/", {
        pageToken: result.nextPageToken
    });
}
```

Ogni elemento include la sua `size` in byte e `updated` (un timestamp ISO 8601) su storage locale, S3 e GCS, e il suo `contentType` su storage locale e GCS — sufficiente per mostrare una cartella senza richiedere un `getSignedUrl()` per ogni file. Un elenco su S3 non include il content type; le cartelle (`result.prefixes`) non contengono nessuno dei tre.

## Formati delle chiavi di archiviazione

L'SDK gestisce in modo trasparente i prefissi delle chiavi di archiviazione. Puoi passare le chiavi con o senza il prefisso del protocollo:

```typescript
// All equivalent — the SDK strips the prefix internally
await client.storage.getSignedUrl("local://products/image.jpg");
await client.storage.getSignedUrl("s3://products/image.jpg");
await client.storage.getSignedUrl("products/image.jpg");
```

## Riferimento API

| Metodo | Descrizione | Restituisce |
|--------|-------------|-------------|
| `putObject({ file, key?, bucket?, metadata? })` | Carica un file | `UploadFileResult` |
| `getSignedUrl(key, bucket?)` | Ottiene l'URL di download + metadati | `DownloadConfig` |
| `getObject(key, bucket?)` | Scarica come oggetto `File` | `File \| null` |
| `deleteObject(key, bucket?)` | Elimina un file | `void` |
| `listObjects(prefix, options?)` | Elenca i file per prefisso | `StorageListResult` |

## Prossimi passi

- **[Configurazione dello storage](/docs/backend/storage)** — Configura S3 o lo storage locale sul server
- **[Interrogazione dei dati](/docs/sdk/querying)** — Operazioni CRUD e query builder
- **[Autenticazione](/docs/sdk/authentication)** — Accesso e gestione delle sessioni
