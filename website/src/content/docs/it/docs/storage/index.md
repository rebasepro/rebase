---
title: Archiviazione
sidebar_label: Archiviazione
slug: docs/storage
description: Configura l'archiviazione dei file con filesystem locale o backend compatibili S3 per upload di file, immagini e media.
---

## Panoramica

Rebase fornisce archiviazione file integrata con due opzioni di backend:

- **Filesystem locale** — File archiviati su disco (ottimo per lo sviluppo)
- **Compatibile S3** — AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces

## Configurazione Backend

### Archiviazione Locale

```typescript
await initializeRebaseBackend({
    // ...
    storage: {
        type: "local",
        basePath: "./uploads"   // Directory for file storage
    }
});
```

### Archiviazione S3

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

### Backend di Archiviazione Multipli

È possibile configurare più backend di archiviazione e instradare campi diversi a backend diversi:

```typescript
storage: {
    "(default)": { type: "local", basePath: "./uploads" },
    "media": { type: "s3", bucket: "media-bucket", region: "us-east-1", ... }
}
```

## Endpoint di Archiviazione

| Metodo | Percorso | Descrizione |
|--------|----------|-------------|
| `POST` | `/api/storage/upload` | Carica un file |
| `GET` | `/api/storage/files/:path` | Scarica/servi un file |
| `DELETE` | `/api/storage/files/:path` | Elimina un file |

## Frontend: Campi di Caricamento File

Per aggiungere caricamenti di file alle tue collezioni, usa la proprietà `storage` sui campi stringa:

```typescript
properties: {
    image: {
        type: "string",
        name: "Product Image",
        storage: {
            storagePath: "products",       // Subdirectory in storage
            acceptedFiles: ["image/*"],    // MIME type filter
            maxSize: 5 * 1024 * 1024,      // 5MB max
            fileName: (context) => {        // Custom filename
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

![Campo di caricamento file](/img/fields/File_upload.png)

### Opzioni di Configurazione dell'Archiviazione

| Proprietà | Tipo | Descrizione |
|-----------|------|-------------|
| `storagePath` | `string` | Sottodirectory all'interno del backend di archiviazione |
| `acceptedFiles` | `string[]` | Tipi MIME consentiti (es. `["image/*"]`, `["application/pdf"]`) |
| `maxSize` | `number` | Dimensione massima del file in byte |
| `fileName` | `function` | Generatore di nomi file personalizzato |
| `metadata` | `object` | Metadati aggiuntivi da archiviare con il file |
| `storeUrl` | `boolean` | Archivia l'URL completo invece del percorso relativo |

### Caricamenti di File Multipli

Includi la proprietà storage in un array per caricamenti di file multipli:

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

![Caricamento file multipli](/img/fields/Multi_file_upload.png)

## Frontend: Hook useStorageSource

Per operazioni programmatiche sui file:

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

## Consigli per la Produzione

:::caution
**L'archiviazione locale non è adatta per le distribuzioni in produzione** su piattaforme effimere (Cloud Run, Heroku, ecc.) dove il filesystem viene cancellato ad ogni deploy. Usa S3 per la produzione.
:::

- Monta un **volume persistente** se usi l'archiviazione locale su Docker/Kubernetes
- Usa **S3** o compatibile (R2, MinIO) per le distribuzioni in produzione
- Configura una **CDN** (CloudFront, Cloudflare) davanti al tuo bucket S3 per le prestazioni

## Passi Successivi

- **[Client SDK](/docs/sdk)** — Operazioni programmatiche su dati e file
- **[Proprietà](/docs/collections/properties)** — Tutti i tipi di proprietà
