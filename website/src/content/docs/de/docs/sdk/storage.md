---
sourceHash: 8e6b49d8e91f586c
title: Speicher & Dateien
sidebar_label: Speicher
description: Dateien mit dem Speichermodul des Rebase Client SDK hochladen, herunterladen, auflisten und löschen.
---

## Überblick

Das Modul `client.storage` bietet Methoden zur Dateiverwaltung — Hochladen, Herunterladen, Auflisten und Löschen. Es funktioniert je nach Serverkonfiguration sowohl mit lokalem Speicher als auch mit S3-kompatiblen Speicher-Backends.

Alle Speichermethoden verwenden den gemeinsamen Transport, sodass Authentifizierungstokens automatisch eingefügt werden.

## Eine Datei hochladen

Verwenden Sie `putObject()`, um eine Datei hochzuladen. Es akzeptiert ein `File`- oder `Blob`-Objekt zusammen mit einem optionalen Speicherschlüssel und Metadaten:

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

// result: { key: string, url: string, ... }
```

### Aus einem Datei-Input

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

## Eine signierte URL abrufen

Rufen Sie eine Download-URL und Metadaten für eine gespeicherte Datei ab:

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

Mit einem bestimmten Bucket:

```typescript
const { url } = await client.storage.getSignedUrl(
    "camera.jpg",
    "product-images"   // bucket
);
```

Das SDK speichert signierte URLs im Cache, um redundante Serveraufrufe zu vermeiden.

### Private vs. öffentliche URLs

- **Private Dateien** erhalten eine URL mit einem **kurzlebigen, pfadbeschränkten Download-Token** (`?token=…`, standardmäßig 5 Min.) — niemals Ihr Access-Token. Da es abläuft, **speichern Sie keine private URL**; speichern Sie den **Pfad** der Datei und rufen Sie `getSignedUrl()` beim Rendern erneut auf.
- **Öffentliche Dateien** (unter dem Präfix `public/` gespeichert — setzen Sie `storage: { public: true }` auf die Property oder übergeben Sie `public: true` an `putObject`) erhalten eine **stabile, tokenlose, dauerhafte, CDN-cachefähige** URL ohne Server-Roundtrip. Diese können sicher in einer Datenbank gespeichert und direkt verlinkt werden.

## Eine Datei herunterladen

Rufen Sie eine Datei als `File`-Objekt ab:

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

Mit einem bestimmten Bucket:

```typescript
const file = await client.storage.getObject("camera.jpg", "product-images");
```

## Eine Datei löschen

```typescript
await client.storage.deleteObject("products/images/camera.jpg");

// With bucket
await client.storage.deleteObject("camera.jpg", "product-images");
```

Das Löschen einer nicht vorhandenen Datei wirft keinen Fehler.

## Dateien auflisten

Listen Sie Dateien nach Präfix auf, mit optionaler Paginierung:

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

## Formate von Speicherschlüsseln

Das SDK verarbeitet Präfixe von Speicherschlüsseln transparent. Sie können Schlüssel mit oder ohne Protokollpräfix übergeben:

```typescript
// All equivalent — the SDK strips the prefix internally
await client.storage.getSignedUrl("local://products/image.jpg");
await client.storage.getSignedUrl("s3://products/image.jpg");
await client.storage.getSignedUrl("products/image.jpg");
```

## API-Referenz

| Methode | Beschreibung | Rückgabe |
|--------|-------------|---------|
| `putObject({ file, key?, bucket?, metadata? })` | Eine Datei hochladen | `UploadFileResult` |
| `getSignedUrl(key, bucket?)` | Download-URL + Metadaten abrufen | `DownloadConfig` |
| `getObject(key, bucket?)` | Als `File`-Objekt herunterladen | `File \| null` |
| `deleteObject(key, bucket?)` | Eine Datei löschen | `void` |
| `listObjects(prefix, options?)` | Dateien nach Präfix auflisten | `StorageListResult` |

## Nächste Schritte

- **[Speicherkonfiguration](/docs/backend/storage)** — S3 oder lokalen Speicher auf dem Server konfigurieren
- **[Daten abfragen](/docs/sdk/querying)** — CRUD-Operationen und Query-Builder
- **[Authentifizierung](/docs/sdk/authentication)** — Anmeldung und Sitzungsverwaltung
