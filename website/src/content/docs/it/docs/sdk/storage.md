---
sourceHash: 7a0c74973860c714
title: Archiviazione e file
sidebar_label: Archiviazione
description: Carica, scarica, elenca ed elimina file usando il modulo di archiviazione dell'SDK Client di Rebase.
---

## Panoramica

Il modulo `client.storage` fornisce metodi per la gestione dei file — caricamento, download, elenco ed eliminazione. Funziona sia con disco locale sia con backend di archiviazione compatibili con S3, a seconda della configurazione del server.

Tutti i metodi di archiviazione utilizzano il trasporto condiviso, quindi i token di autenticazione vengono iniettati automaticamente.

## Caricare un file

Usa `putObject()` per caricare un file. Accetta un oggetto `File` o `Blob` insieme a una chiave di archiviazione e metadati opzionali:

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

### Da un campo file

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

Recupera un URL di download e i metadati di un file archiviato:

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

:::caution[L'argomento `bucket` oggi è un prefisso di percorso]
In `getSignedUrl`, `getObject` e `deleteObject` il secondo argomento viene ripiegato nella chiave dell'oggetto (`<bucket>/<key>`) e non raggiunge mai il server come bucket: un nome che il deployment non serve viene segnalato come *file* mancante, non come bucket sconosciuto — e un file scritto con `putObject({ bucket: "media" })` non si rilegge con `getSignedUrl(key, "media")`. Rileggi un file con la stessa forma di chiamata che lo ha scritto. Lato server `/api/storage/list` risponde già `404 UNKNOWN_STORAGE_SOURCE`; l'argomento dell'SDK è in corso di revisione per allinearsi.
:::

Con un bucket specifico:

```typescript
const { url } = await client.storage.getSignedUrl(
    "camera.jpg",
    "product-images"   // bucket
);
```

L'SDK memorizza nella cache gli URL firmati per evitare chiamate ridondanti al server.

### URL privati vs. pubblici

- **I file privati** ottengono un URL con un **token di download a breve durata, limitato al percorso** (`?token=…`, 5 min per impostazione predefinita) — mai il tuo token di accesso. Poiché scade, **non conservare un URL privato**; memorizza il **percorso** del file e richiama `getSignedUrl()` al momento del rendering.
- **I file pubblici** (archiviati sotto il prefisso `public/` — imposta `storage: { public: true }` sulla proprietà, o passa `public: true` a `putObject`) ottengono un URL **stabile, senza token, permanente e memorizzabile nella CDN**, senza andata e ritorno al server. Sono sicuri da memorizzare in un database e da collegare direttamente.

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
    console.log(item.fullPath, item.name);
}

// Paginate
if (result.nextPageToken) {
    const nextPage = await client.storage.listObjects("products/images/", {
        pageToken: result.nextPageToken
    });
}
```

## Formati delle chiavi di archiviazione

L'SDK gestisce in modo trasparente i prefissi delle chiavi di archiviazione. Puoi passare le chiavi con o senza il prefisso di protocollo:

```typescript
// All equivalent — the SDK strips the prefix internally
await client.storage.getSignedUrl("local://products/image.jpg");
await client.storage.getSignedUrl("s3://products/image.jpg");
await client.storage.getSignedUrl("products/image.jpg");
```

## Riferimento dell'API

| Metodo | Descrizione | Restituisce |
|--------|-------------|---------|
| `putObject({ file, key?, bucket?, metadata? })` | Caricare un file | `UploadFileResult` |
| `getSignedUrl(key, bucket?)` | Ottenere l'URL di download + metadati | `DownloadConfig` |
| `getObject(key, bucket?)` | Scaricare come oggetto `File` | `File \| null` |
| `deleteObject(key, bucket?)` | Eliminare un file | `void` |
| `listObjects(prefix, options?)` | Elencare i file per prefisso | `StorageListResult` |

## Prossimi passi

- **[Configurazione dell'archiviazione](/docs/backend/storage)** — Configurare S3 o l'archiviazione locale sul server
- **[Interrogare i dati](/docs/sdk/querying)** — Operazioni CRUD e query builder
- **[Autenticazione](/docs/sdk/authentication)** — Accesso e gestione delle sessioni
