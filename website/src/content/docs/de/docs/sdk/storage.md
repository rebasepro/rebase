---
sourceHash: 14cb375a352ba487
title: Speicher & Dateien
sidebar_label: Speicher
description: Dateien hochladen, herunterladen, auflisten und löschen mit dem Storage-Modul des typisierten Rebase SDKs.
---

## Übersicht

Das `client.storage`-Modul bietet Methoden für die Dateiverwaltung – Hochladen, Herunterladen, Auflisten und Löschen. Es funktioniert je nach Serverkonfiguration sowohl mit lokalem Festplattenspeicher als auch mit S3-kompatiblen Storage-Backends.

Alle Storage-Methoden verwenden den gemeinsamen Transport, sodass Authentifizierungs-Token automatisch eingefügt werden.

## Datei hochladen

Verwenden Sie `putObject()`, um eine Datei hochzuladen. Die Methode akzeptiert ein `File`- oder `Blob`-Objekt zusammen mit einem optionalen Storage-Key und Metadaten:

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

Eine Datei von mehr als 8 MiB wird über den Resumable-Endpoint (TUS) des Servers hochgeladen, mit 8 MiB pro Anfrage, anstatt als eine einzelne Multipart-Anfrage, die der Server vollständig parst – so beansprucht ein großer Upload auf dem Server nur einen Chunk an Speicher und nicht das Drei- bis Fünffache der Datei. Ein Chunk, der unterwegs fehlschlägt, wird ab dem Punkt erneut gesendet, bis zu dem der Server gelangt ist. Das Ergebnis, das gespeicherte Objekt und die Prüfungen des Servers sind in beiden Fällen identisch. Wenn der Resumable-Endpoint die Datei nicht annehmen kann (ein älterer Server oder mehrere Instanzen, die Uploads nicht gemeinsam nutzen), wird sie als einzelne Anfrage an `POST /api/storage/upload` übertragen, und ebenso jede spätere Datei dieses Clients. Siehe [Resumable uploads (TUS)](/docs/backend/storage-resumable-uploads/).

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

## Signierte URL abrufen

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

:::caution[Das Argument `bucket` ist derzeit ein Pfad-Präfix]
Bei `getSignedUrl`, `getObject` und `deleteObject` wird das zweite Argument in den Objektschlüssel eingebunden (`<bucket>/<key>`) und erreicht den Server niemals als Bucket. Daher wird ein Name, den das Deployment nicht bedient, als fehlende *Datei* gemeldet und nicht als unbekannter Bucket – und eine mit `putObject({ bucket: "media" })` geschriebene Datei kann nicht mit `getSignedUrl(key, "media")` wieder ausgelesen werden. Lesen Sie eine Datei mit derselben Aufrufstruktur zurück, mit der sie geschrieben wurde. Die Serverseite antwortet für einen nicht bedienten Bucket bei `/api/storage/list` bereits mit `404 UNKNOWN_STORAGE_SOURCE`, ebenso auf S3 oder GCS bei Uploads; das SDK-Argument wird derzeit überarbeitet, um dem zu entsprechen.
:::

Mit einem bestimmten Bucket:

```typescript
const { url } = await client.storage.getSignedUrl(
    "camera.jpg",
    "product-images"   // bucket
);
```

Das SDK speichert signierte URLs im Cache, um redundante Serveraufrufe zu vermeiden, bis das jeweilige Download-Token abläuft. Gemeinsam durchgeführte Abfragen – etwa eine Seite mit Vorschauen, die `getSignedUrl()` im selben Tick aufruft – werden als ein einziger `POST /api/storage/metadata` pro 100 Dateien an den Server gesendet, den der Rate-Limiter als ein Zehntel der ersetzten Anfragen zählt; eine Datei, die ein Aufrufer nicht lesen darf, schlägt nur für diesen Aufruf fehl. Der Cache gehört zu den Anmeldedaten der Anfrage: Wenn sich das Zugriffstoken ändert – bei einer Abmeldung, der Anmeldung eines anderen Benutzers oder einem Refresh –, beginnt der Cache von vorn, sodass kein Benutzer jemals eine URL erhält, die für einen anderen ausgestellt wurde.

### Private vs. öffentliche URLs

- **Private Dateien** erhalten eine URL mit einem **kurzlebigen, pfadbezogenen Download-Token** (`?token=…`, 5 Minuten, es sei denn, der Server setzt `STORAGE_DOWNLOAD_TOKEN_TTL`, was von 0.23 nicht gelesen wird) – niemals Ihr Zugriffstoken. Da sie abläuft, sollten Sie **eine private URL nicht persistent speichern**; speichern Sie stattdessen den Datei-**Pfad** und rufen Sie `getSignedUrl()` erneut auf, wenn Sie sie rendern.
- **Öffentliche Dateien** (gespeichert unter dem Präfix `public/` – setzen Sie `storage: { public: true }` auf der Eigenschaft oder übergeben Sie `public: true` an `putObject`) erhalten eine **stabile, tokenlose, permanente und über ein CDN cachebare** URL ohne Roundtrip zum Server. Diese können sicher in einer Datenbank gespeichert und direkt verlinkt werden.

### Dateien innerhalb von Text

Text, der eine Datei einbettet – wie Bilder in einem Markdown-Feld –, kann ebenfalls keine private URL enthalten, weshalb er stattdessen eine **Storage-Referenz** enthält: `rebase-storage:posts/cover.png`, mit `?storageId=media`, wenn sich die Datei in einer benannten Quelle befindet. Genau das schreibt der Markdown-Editor des Admin-Panels für ein hochgeladenes Bild. Tauschen Sie die Referenzen gegen URLs aus, wenn Sie den Text rendern:

```typescript
import { resolveStorageReferences } from "@rebasepro/client";

const post = await client.data.table("posts").findById("post-1");
const body = await resolveStorageReferences(String(post?.body ?? ""), client);
// `body` is the same markdown, each reference replaced by a fresh URL.
```

Jedes Objekt wird einmal pro Aufruf aus seiner eigenen Quelle signiert, sodass ein privates Bild unabhängig vom Upload-Zeitpunkt weiterhin funktioniert. Eine Referenz, die ein nicht mehr existentes Objekt benennt, bleibt unverändert. `storageReference(key, storageId?)` erstellt eine solche Referenz für Text, den Sie selbst verfassen.

Text, der gespeichert wurde, bevor Referenzen existierten, enthält die Download-URL der privaten Datei selbst, `…/storage/file/posts/cover.png?token=…`, deren Token wenige Minuten nach dem Schreiben abgelaufen ist. `resolveStorageReferences` erneuert auch diese: Das Token benennt das Objekt weiterhin, sodass die URL durch eine frische ersetzt wird. Um stattdessen Referenzen zu speichern, schreiben Sie den Text einmalig mit `storageReferencesForDownloadUrls(text)` um, wodurch jede andere URL unverändert bleibt.

## Datei herunterladen

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

## Datei löschen

```typescript
await client.storage.deleteObject("products/images/camera.jpg");

// With bucket
await client.storage.deleteObject("camera.jpg", "product-images");
```

Das Löschen einer nicht vorhandenen Datei löst keinen Fehler aus.

## Dateien auflisten

Listen Sie Dateien nach Präfix auf, mit optionaler Paginierung:

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

Jedes Element enthält bei lokalem Speicher, S3 und GCS seine `size` in Bytes und `updated` (einen ISO-8601-Zeitstempel) sowie bei lokalem Speicher und GCS seinen `contentType` – ausreichend, um einen Ordner ohne `getSignedUrl()` pro Datei anzuzeigen. Ein S3-Listing enthält keinen Content-Type; Ordner (`result.prefixes`) enthalten keines der drei Attribute.

## Storage-Key-Formate

Das SDK handhabt Storage-Key-Präfixe transparent. Sie können Keys mit oder ohne Protokoll-Präfix übergeben:

```typescript
// All equivalent — the SDK strips the prefix internally
await client.storage.getSignedUrl("local://products/image.jpg");
await client.storage.getSignedUrl("s3://products/image.jpg");
await client.storage.getSignedUrl("products/image.jpg");
```

## API-Referenz

| Methode | Beschreibung | Rückgabewert |
|--------|-------------|---------|
| `putObject({ file, key?, bucket?, metadata? })` | Datei hochladen | `UploadFileResult` |
| `getSignedUrl(key, bucket?)` | Download-URL + Metadaten abrufen | `DownloadConfig` |
| `getObject(key, bucket?)` | Als `File`-Objekt herunterladen | `File \| null` |
| `deleteObject(key, bucket?)` | Datei löschen | `void` |
| `listObjects(prefix, options?)` | Dateien nach Präfix auflisten | `StorageListResult` |

## Nächste Schritte

- **[Storage Configuration](/docs/backend/storage)** — Konfigurieren Sie S3 oder lokalen Speicher auf dem Server
- **[Querying Data](/docs/sdk/querying)** — CRUD-Operationen und Query-Builder
- **[Authentication](/docs/sdk/authentication)** — Anmeldung und Sitzungsverwaltung
