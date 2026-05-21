---
title: Speicher
sidebar_label: Speicher
description: Konfigurieren Sie die Dateispeicherung mit lokalem Dateisystem oder S3-kompatiblen Backends für Datei-Uploads, Bilder und Medien.
---

## Übersicht

Rebase bietet integrierte Dateispeicherung mit zwei Backend-Optionen:

- **Lokales Dateisystem** — Dateien werden auf der Festplatte gespeichert (ideal für die Entwicklung)
- **S3-kompatibel** — AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces

## Backend-Konfiguration

### Lokaler Speicher

```typescript
await initializeRebaseBackend({
    // ...
    storage: {
        type: "local",
        basePath: "./uploads"   // Directory for file storage
    }
});
```

### S3-Speicher

```typescript
import { env } from "./env";

await initializeRebaseBackend({
    // ...
    storage: {
        type: "s3",
        bucket: env.S3_BUCKET!,
        region: env.S3_REGION || "us-east-1",
        accessKeyId: env.S3_ACCESS_KEY_ID!,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
        // Optional: custom endpoint for MinIO, R2, etc.
        endpoint: env.S3_ENDPOINT
    }
});
```

### Mehrere Speicher-Backends

Sie können mehrere Speicher-Backends konfigurieren und verschiedene Felder an unterschiedliche Backends weiterleiten:

```typescript
storage: {
    "(default)": { type: "local", basePath: "./uploads" },
    "media": { type: "s3", bucket: "media-bucket", region: "us-east-1", ... }
}
```

## Speicher-Endpunkte

| Methode | Pfad | Beschreibung |
|--------|------|-------------|
| `POST` | `/api/storage/upload` | Eine Datei hochladen |
| `GET` | `/api/storage/files/:path` | Eine Datei herunterladen/bereitstellen |
| `DELETE` | `/api/storage/files/:path` | Eine Datei löschen |

## Frontend: Datei-Upload-Felder

Um Datei-Uploads zu Ihren Sammlungen hinzuzufügen, verwenden Sie die Eigenschaft `storage` bei String-Feldern:

```typescript
properties: {
    image: {
        type: "string",
        name: "Product Image",
        storage: {
            storagePath: "products",       // Unterverzeichnis im Speicher
            acceptedFiles: ["image/*"],    // MIME-Typ-Filter
            maxSize: 5 * 1024 * 1024,      // max. 5MB
            fileName: (context) => {        // Benutzerdefinierter Dateiname
                return context.entityId + "_" + context.file.name;
            }
        }
    },
    documents: {
        type: "array",
        name: "Documents",
        of: {
            type: "string",
            storage: {
                storagePath: "documents",
                acceptedFiles: ["application/pdf", "image/*"]
            }
        }
    }
}
```

![Datei-Upload-Feld](/img/fields/File_upload.png)

### Speicher-Konfigurationsoptionen

| Eigenschaft | Typ | Beschreibung |
|----------|------|-------------|
| `storagePath` | `string` | Unterverzeichnis innerhalb des Speicher-Backends |
| `acceptedFiles` | `string[]` | Erlaubte MIME-Typen (z.B. `["image/*"]`, `["application/pdf"]`) |
| `maxSize` | `number` | Maximale Dateigröße in Bytes |
| `fileName` | `function` | Benutzerdefinierter Dateinamen-Generator |
| `metadata` | `object` | Zusätzliche Metadaten, die mit der Datei gespeichert werden sollen |
| `storeUrl` | `boolean` | Die vollständige URL statt des relativen Pfads speichern |

### Mehrere Datei-Uploads

Umschließen Sie die `storage`-Eigenschaft mit einem Array für mehrere Datei-Uploads:

```typescript
photos: {
    type: "array",
    name: "Photos",
    of: {
        type: "string",
        storage: {
            storagePath: "photos",
            acceptedFiles: ["image/*"]
        }
    }
}
```

![Mehrfachdatei-Upload](/img/fields/Multi_file_upload.png)

## Frontend: useStorageSource-Hook

Für programmatische Dateioperationen:

```typescript
import { useStorageSource } from "@rebasepro/core";

const storageSource = useStorageSource();

// Upload a file
const result = await storageSource.uploadFile({
    file,
    fileName: "my-file.pdf",
    path: "documents"
});

// Get download URL
const url = await storageSource.getDownloadURL(result.path);
```

## Tipps für die Produktion

:::caution
**Lokaler Speicher ist nicht für Produktions-Deployments geeignet** auf ephemeren Plattformen (Cloud Run, Heroku usw.), wo das Dateisystem bei jeder Bereitstellung gelöscht wird. Verwenden Sie S3 für die Produktion.
:::

- Hängen Sie ein **persistentes Volume** ein, wenn Sie lokalen Speicher unter Docker/Kubernetes verwenden
- Verwenden Sie **S3** oder kompatible Dienste (R2, MinIO) für Produktions-Deployments
- Konfigurieren Sie ein **CDN** (CloudFront, Cloudflare) vor Ihrem S3-Bucket für eine bessere Performance

## Nächste Schritte

- **[Client SDK](/docs/sdk)** — Programmatische Daten- und Dateioperationen
- **[Eigenschaften](/docs/collections/properties)** — Alle Eigenschaftstypen

---
