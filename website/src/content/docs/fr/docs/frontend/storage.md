---
sourceHash: 11a70a4f7a976bf5
title: Stockage et téléversement de fichiers
sidebar_label: Stockage et téléversement de fichiers
description: Ajoutez des champs de téléversement de fichiers à vos collections, gérez les fichiers par programmation et routez les téléversements vers différents backends de stockage.
---

## Présentation

Rebase prend en charge nativement le téléversement de fichiers dans les formulaires de collection :

- Champs de téléversement de fichiers par **glisser-déposer**
- **Aperçus d'images** dans les formulaires et les cellules de tableau
- **Téléversements de fichiers multiples** via des propriétés de type tableau
- **Filtrage par type MIME** et limites de taille
- **Noms de fichiers personnalisés** via des fonctions de rappel (callbacks)

## Champs de téléversement de fichiers

Un champ de fichier est une propriété de type chaîne avec un bloc `storage`, ou un tableau de chaînes pour plusieurs fichiers. La page [Champs de téléversement de fichiers](/docs/collections/file-uploads/) aborde leur déclaration : chaque option `storage`, et lesquelles sont appliquées par le serveur plutôt qu'uniquement par l'outil de téléversement du panneau.

## Stockage multi-backend

Lorsque plusieurs backends de stockage sont configurés sur votre backend (par ex., local + S3 + GCS), vous pouvez router des propriétés individuelles vers des backends spécifiques à l'aide de `storageSource` :

```typescript
image: {
    type: "string",
    name: "Product Image",
    storage: {
        storageSource: "firebase",     // Routes to the "firebase" backend
        storagePath: "products/{id}",
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
| `key` | `string` | Identifiant unique — doit correspondre à `storageSource` dans les configurations de propriété |
| `engine` | `string` | Nom du moteur de stockage (par ex., `"firebase"`, `"gcs"`, `"s3"`) |
| `transport` | `"server" \| "direct"` | `"server"` passe par le backend (proxy) ; `"direct"` téléverse directement depuis le navigateur |
| `source` | `StorageSource` | Implémentation côté client de `StorageSource` (requise pour le transport `"direct"`) |

Le système résout automatiquement la source appropriée par propriété — les propriétés de collection avec `storageSource: "firebase"` utiliseront la source directe correspondante, tandis que les propriétés sans `storageSource` (ou avec `transport: "server"`) passeront par le backend Rebase.

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
`useStorageSource()` renvoie la source de stockage par **défaut**. Pour les configurations multi-backend, la résolution par propriété est gérée automatiquement par les liaisons de champs de formulaire et le `StorageSourcesContext`. Dans la plupart des cas, vous n'avez pas besoin de résoudre manuellement les sources.
:::

## Prochaines étapes

- **[Configuration du stockage backend](/docs/backend/storage)** — Configuration de S3, GCS et du stockage local
- **[Propriétés](/docs/collections/properties)** — Tous les types de propriétés, y compris le stockage
