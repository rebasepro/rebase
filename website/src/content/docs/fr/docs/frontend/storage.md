---
sourceHash: 1134b2a4207579d3
title: Stockage et téléversements de fichiers
sidebar_label: Stockage et téléversements de fichiers
description: Ajoutez des champs de téléversement de fichiers à vos collections, gérez les fichiers par programmation et routez les téléversements vers différents backends de stockage.
---

## Vue d'ensemble

Rebase fournit une prise en charge intégrée du téléversement de fichiers dans les formulaires de collection :

- Champs de téléversement de fichiers **glisser-déposer**
- **Aperçus d'images** dans les formulaires et les cellules de tableau
- **Téléversements de plusieurs fichiers** via des propriétés de tableau
- **Filtrage par type MIME** et limites de taille
- **Noms de fichiers personnalisés** via des fonctions de callback

## Champs de téléversement de fichiers

Pour ajouter des téléversements de fichiers à une collection, utilisez la configuration `storage` sur une propriété de type chaîne :

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
    }
}
```

### Options de configuration du stockage

| Propriété | Type | Description |
|----------|------|-------------|
| `storagePath` | `string` | Sous-répertoire au sein du backend de stockage |
| `storageSource` | `string` | Source de stockage nommée — route les téléversements vers un backend spécifique (par ex. `"firebase"`, `"media"`). Voir [Stockage multi-backend](#stockage-multi-backend). |
| `public` | `boolean` | Stocke les fichiers sous le préfixe `public/` et les sert via des URL stables, sans token, permanentes et cacheables par CDN (sûres à conserver et à lier directement). Par défaut `false` (les fichiers privés utilisent des URL signées à courte durée de vie). |
| `acceptedFiles` | `string[]` | Types MIME autorisés (par ex. `["image/*"]`, `["application/pdf"]`) |
| `maxSize` | `number` | Taille maximale du fichier en octets |
| `fileName` | `function` | Générateur de nom de fichier personnalisé |
| `metadata` | `object` | Métadonnées supplémentaires à stocker avec le fichier |
| `storeUrl` | `boolean` | Stocke l'URL complète au lieu du chemin relatif |

## Téléversements de plusieurs fichiers

Enveloppez la propriété de stockage dans un tableau pour téléverser plusieurs fichiers :

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

## Téléversements de documents

Téléversez des fichiers non-image comme des PDF :

```typescript
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
```

## Stockage multi-backend

Lorsque votre backend a plusieurs backends de stockage configurés (par ex. local + S3 + GCS), vous pouvez router des propriétés individuelles vers des backends spécifiques à l'aide de `storageSource` :

```typescript
image: {
    type: "string",
    name: "Product Image",
    storage: {
        storageSource: "firebase",     // Routes to the "firebase" backend
        storagePath: "products/{entityId}",
        acceptedFiles: ["image/*"],
    }
}
```

### Sources directes du frontend

Pour les backends de stockage **directs** (par ex. Firebase Storage où le navigateur téléverse directement vers le cloud), enregistrez-les via la prop `storageSources` sur `<Rebase>` :

```tsx
import type { RebaseStorageSource } from "@rebasepro/app";

<Rebase
    client={rebaseClient}
    storageSources={[
        { key: "firebase", engine: "firebase", transport: "direct", source: firebaseStorageSource }
    ]}
>
    {/* your app */}
    …
</Rebase>
```

| Propriété | Type | Description |
|----------|------|-------------|
| `key` | `string` | Identifiant unique — doit correspondre à `storageSource` dans les configurations de propriété |
| `engine` | `string` | Nom du moteur de stockage (par ex. `"firebase"`, `"gcs"`, `"s3"`) |
| `transport` | `"server" \| "direct"` | `"server"` fait office de proxy via le backend ; `"direct"` téléverse depuis le navigateur |
| `source` | `StorageSource` | Implémentation `StorageSource` côté client (requise pour le transport `"direct"`) |

Le système résout automatiquement la source correcte par propriété — les propriétés de collection avec `storageSource: "firebase"` utiliseront la source directe correspondante, tandis que les propriétés sans `storageSource` (ou avec `transport: "server"`) passeront par le backend Rebase.

## Hook useStorageSource

Pour les opérations de fichiers par programmation en dehors des formulaires de collection :

```typescript
import { useStorageSource } from "@rebasepro/app";

// Returns the default storage source
const storageSource = useStorageSource();

// Upload a file — the object is addressed by `key`
const result = await storageSource.putObject({
    file,
    key: "documents/my-file.pdf"
});

// Get a download URL
const { url } = await storageSource.getSignedUrl(result.key);
```

:::tip
`useStorageSource()` renvoie la source de stockage **par défaut**. Pour les configurations multi-backend, la résolution par propriété est gérée automatiquement par les liaisons de champ de formulaire et le `StorageSourcesContext`. Dans la plupart des cas, vous n'avez pas besoin de résoudre les sources manuellement.
:::

## Étapes suivantes

- **[Configuration du stockage backend](/docs/backend/storage)** — Configuration de S3, GCS et stockage local
- **[Propriétés](/docs/collections/properties)** — Tous les types de propriétés, y compris le stockage
