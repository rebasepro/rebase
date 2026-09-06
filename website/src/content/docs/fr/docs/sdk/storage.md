---
sourceHash: 8e6b49d8e91f586c
title: Stockage et fichiers
sidebar_label: Stockage
description: Téléverser, télécharger, lister et supprimer des fichiers à l'aide du module de stockage du SDK Client de Rebase.
---

## Vue d'ensemble

Le module `client.storage` fournit des méthodes de gestion des fichiers — téléversement, téléchargement, listage et suppression. Il fonctionne aussi bien avec le disque local qu'avec des backends de stockage compatibles S3, selon la configuration de votre serveur.

Toutes les méthodes de stockage utilisent le transport partagé, de sorte que les tokens d'authentification sont injectés automatiquement.

## Téléverser un fichier

Utilisez `putObject()` pour téléverser un fichier. Elle accepte un objet `File` ou `Blob` accompagné d'une clé de stockage et de métadonnées optionnelles :

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

### Depuis un champ de fichier

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

## Obtenir une URL signée

Récupérez une URL de téléchargement et les métadonnées d'un fichier stocké :

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

Avec un bucket spécifique :

```typescript
const { url } = await client.storage.getSignedUrl(
    "camera.jpg",
    "product-images"   // bucket
);
```

Le SDK met en cache les URL signées pour éviter les appels serveur redondants.

### URL privées vs. publiques

- **Les fichiers privés** obtiennent une URL avec un **token de téléchargement à courte durée de vie, limité au chemin** (`?token=…`, 5 min par défaut) — jamais votre token d'accès. Comme il expire, **ne conservez pas d'URL privée** ; stockez le **chemin** du fichier et rappelez `getSignedUrl()` au moment du rendu.
- **Les fichiers publics** (stockés sous le préfixe `public/` — définissez `storage: { public: true }` sur la propriété, ou passez `public: true` à `putObject`) obtiennent une URL **stable, sans token, permanente et cacheable par CDN**, sans aller-retour serveur. Ils peuvent être stockés en toute sécurité dans une base de données et liés directement.

## Télécharger un fichier

Récupérez un fichier sous forme d'objet `File` :

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

Avec un bucket spécifique :

```typescript
const file = await client.storage.getObject("camera.jpg", "product-images");
```

## Supprimer un fichier

```typescript
await client.storage.deleteObject("products/images/camera.jpg");

// With bucket
await client.storage.deleteObject("camera.jpg", "product-images");
```

Supprimer un fichier inexistant ne lève pas d'erreur.

## Lister les fichiers

Listez les fichiers par préfixe, avec pagination optionnelle :

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

## Formats de clé de stockage

Le SDK gère de manière transparente les préfixes des clés de stockage. Vous pouvez passer des clés avec ou sans le préfixe de protocole :

```typescript
// All equivalent — the SDK strips the prefix internally
await client.storage.getSignedUrl("local://products/image.jpg");
await client.storage.getSignedUrl("s3://products/image.jpg");
await client.storage.getSignedUrl("products/image.jpg");
```

## Référence de l'API

| Méthode | Description | Renvoie |
|--------|-------------|---------|
| `putObject({ file, key?, bucket?, metadata? })` | Téléverser un fichier | `UploadFileResult` |
| `getSignedUrl(key, bucket?)` | Obtenir l'URL de téléchargement + métadonnées | `DownloadConfig` |
| `getObject(key, bucket?)` | Télécharger sous forme d'objet `File` | `File \| null` |
| `deleteObject(key, bucket?)` | Supprimer un fichier | `void` |
| `listObjects(prefix, options?)` | Lister les fichiers par préfixe | `StorageListResult` |

## Étapes suivantes

- **[Configuration du stockage](/docs/backend/storage)** — Configurer S3 ou le stockage local sur le serveur
- **[Interroger les données](/docs/sdk/querying)** — Opérations CRUD et constructeur de requêtes
- **[Authentification](/docs/sdk/authentication)** — Connexion et gestion des sessions
