---
sourceHash: 3e810cd447c9dd8a
title: Stockage et téléversement de fichiers
sidebar_label: Stockage et téléversement de fichiers
description: Ajoutez des champs de téléversement de fichiers à vos collections, gérez les fichiers par programmation et routez les téléversements vers différents backends de stockage.
---

## Aperçu

Rebase intègre la prise en charge du téléversement de fichiers dans les formulaires de collection :

- Champs de téléversement de fichiers par **glisser-déposer**
- **Aperçus d'images** dans les formulaires et les cellules de tableau
- **Téléversement de fichiers multiples** via des propriétés de type tableau
- **Filtrage par type MIME** et limites de taille
- **Noms de fichiers personnalisés** via des fonctions de rappel

## Champs de téléversement de fichiers

Un champ de fichier est une propriété de type chaîne (`string`) avec un bloc `storage`, ou un tableau de chaînes pour plusieurs fichiers. La section [Champs de téléversement de fichiers](/docs/collections/file-uploads/) détaille leur déclaration : chaque option de `storage`, ainsi que celles qui sont appliquées par le serveur plutôt qu'uniquement par l'interface de téléversement du panneau.

## Stockage multi-backend

Lorsque votre backend dispose de plusieurs backends de stockage configurés (par ex., local + S3 + GCS), vous pouvez router des propriétés individuelles vers des backends spécifiques à l'aide de `storageSource` :

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

### Sources directes côté frontend

Pour les backends de stockage **directs** (par ex., Firebase Storage où le navigateur téléverse directement vers le cloud), enregistrez-les via la prop `storageSources` sur `<Rebase>` :

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
|-----------|------|-------------|
| `key` | `string` | Identifiant unique — doit correspondre à `storageSource` dans la configuration des propriétés |
| `engine` | `string` | Nom du moteur de stockage (par ex., `"firebase"`, `"gcs"`, `"s3"`) |
| `transport` | `"server" \| "direct"` | `"server"` passe par le backend (proxy) ; `"direct"` téléverse depuis le navigateur |
| `source` | `StorageSource` | Implémentation de `StorageSource` côté client (requise pour le transport `"direct"`) |

Le système résout automatiquement la source appropriée pour chaque propriété : les propriétés de collection configurées avec `storageSource: "firebase"` utiliseront la source directe correspondante, tandis que les propriétés sans `storageSource` (ou avec `transport: "server"`) passeront par le backend Rebase.

## Hook useStorageSource

Pour les opérations de fichiers programmatiques en dehors des formulaires de collection :

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
`useStorageSource()` renvoie la source de stockage **par défaut**. Pour les configurations multi-backends, la résolution par propriété est gérée automatiquement par les liaisons des champs de formulaire et le `StorageSourcesContext`. Dans la plupart des cas, vous n'avez pas besoin de résoudre les sources manuellement.
:::

## Étapes suivantes

- **[Configuration du stockage backend](/docs/backend/storage)** — Configuration pour S3, GCS et le stockage local
- **[Propriétés](/docs/collections/properties)** — Tous les types de propriétés, y compris le stockage
