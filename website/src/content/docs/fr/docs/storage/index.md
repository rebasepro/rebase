---
title: Stockage
sidebar_label: Stockage
slug: fr/docs/storage
description: Configurez le stockage de fichiers avec un système de fichiers local ou des backends compatibles S3 pour les téléchargements de fichiers, les images et les médias.
---

## Aperçu

Rebase offre un stockage de fichiers intégré avec deux options de backend :

- **Système de fichiers local** — Fichiers stockés sur disque (idéal pour le développement)
- **Compatible S3** — AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces

## Configuration du Backend

### Stockage Local

```typescript
await initializeRebaseBackend({
    // ...
    storage: {
        type: "local",
        basePath: "./uploads"   // Directory for file storage
    }
});
```

### Stockage S3

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

### Plusieurs Backends de Stockage

Vous pouvez configurer plusieurs backends de stockage et acheminer différents champs vers différents backends :

```typescript
storage: {
    "(default)": { type: "local", basePath: "./uploads" },
    "media": { type: "s3", bucket: "media-bucket", region: "us-east-1", ... }
}
```

## Points d'Accès de Stockage

| Méthode | Chemin | Description |
|--------|------|-------------|
| `POST` | `/api/storage/upload` | Télécharger un fichier |
| `GET` | `/api/storage/files/:path` | Télécharger/servir un fichier |
| `DELETE` | `/api/storage/files/:path` | Supprimer un fichier |

## Frontend : Champs de Téléchargement de Fichiers

Pour ajouter des téléchargements de fichiers à vos collections, utilisez la propriété `storage` sur les champs de type chaîne de caractères :

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

![File upload field](/img/fields/File_upload.png)

### Options de Configuration du Stockage

| Propriété | Type | Description |
|----------|------|-------------|
| `storagePath` | `string` | Sous-répertoire dans le backend de stockage |
| `acceptedFiles` | `string[]` | Types MIME autorisés (ex. `["image/*"]`, `["application/pdf"]`) |
| `maxSize` | `number` | Taille maximale du fichier en octets |
| `fileName` | `function` | Générateur de nom de fichier personnalisé |
| `metadata` | `object` | Métadonnées supplémentaires à stocker avec le fichier |
| `storeUrl` | `boolean` | Stocker l'URL complète au lieu du chemin relatif |

### Téléchargements de Fichiers Multiples

Enveloppez la propriété storage dans un tableau pour les téléchargements de fichiers multiples :

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

![Multi file upload](/img/fields/Multi_file_upload.png)

## Frontend : Hook useStorageSource

Pour les opérations de fichiers programmatiques :

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

## Conseils de Production

:::caution
**Le stockage local n'est pas adapté aux déploiements en production** sur des plateformes éphémères (Cloud Run, Heroku, etc.) où le système de fichiers est effacé à chaque déploiement. Utilisez S3 pour la production.
:::

- Montez un **volume persistant** si vous utilisez le stockage local sur Docker/Kubernetes
- Utilisez **S3** ou compatible (R2, MinIO) pour les déploiements en production
- Configurez un **CDN** (CloudFront, Cloudflare) devant votre bucket S3 pour les performances

## Étapes Suivantes

- **[SDK Client](/docs/sdk)** — Opérations de données et de fichiers programmatiques
- **[Propriétés](/docs/collections/properties)** — Tous les types de propriétés
