---
sourceHash: 14cb375a352ba487
title: Stockage et fichiers
sidebar_label: Stockage
description: Téléversez, téléchargez, listez et supprimez des fichiers à l'aide du module de stockage du SDK typé Rebase.
---

## Vue d'ensemble

Le module `client.storage` fournit des méthodes pour la gestion des fichiers : téléversement, téléchargement, listage et suppression. Il fonctionne aussi bien avec des backends de stockage sur disque local qu'avec des stockages compatibles S3, selon la configuration de votre serveur.

Toutes les méthodes de stockage utilisent le transport partagé, de sorte que les jetons d'authentification sont injectés automatiquement.

## Téléverser un fichier

Utilisez `putObject()` pour téléverser un fichier. Elle accepte un objet `File` ou `Blob` ainsi qu'une clé de stockage optionnelle et des métadonnées :

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

Un fichier de plus de 8 Mio est envoyé via le point de terminaison de téléversement avec reprise (TUS) du serveur, à raison de 8 Mio par requête, plutôt que sous la forme d'une seule requête multipart que le serveur analyse intégralement — ainsi, un téléversement volumineux ne coûte au serveur qu'un bloc de mémoire, et non trois à cinq fois la taille du fichier. Un fragment qui échoue en cours de route est renvoyé à partir de l'endroit où le serveur s'est arrêté. Le résultat, l'objet stocké et les vérifications du serveur sont identiques dans les deux cas. Lorsque le point de terminaison avec reprise ne peut pas accepter le fichier (un serveur plus ancien ou plusieurs instances qui ne partagent pas les téléversements), il est envoyé via une unique requête `POST /api/storage/upload`, tout comme chaque fichier suivant provenant de ce client. Consultez [Téléversements avec reprise (TUS)](/docs/backend/storage-resumable-uploads/).

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

:::caution[L'argument `bucket` est actuellement un préfixe de chemin]
Sur `getSignedUrl`, `getObject` et `deleteObject`, le deuxième argument est incorporé dans la clé de l'objet (`<bucket>/<key>`) et n'atteint jamais le serveur en tant que bucket. Par conséquent, un nom que le déploiement ne dessert pas est signalé comme un *fichier* manquant, et non comme un bucket inconnu — et un fichier écrit avec `putObject({ bucket: "media" })` ne peut pas être relu avec `getSignedUrl(key, "media")`. Relisez un fichier avec la même structure d'appel que celle utilisée pour l'écrire. Le côté serveur répond déjà `404 UNKNOWN_STORAGE_SOURCE` pour un bucket qu'il ne dessert pas sur `/api/storage/list`, ainsi que sur S3 ou GCS lors des téléversements ; l'argument du SDK est en cours de refonte pour s'y conformer.
:::

Avec un bucket spécifique :

```typescript
const { url } = await client.storage.getSignedUrl(
    "camera.jpg",
    "product-images"   // bucket
);
```

Le SDK met en cache les URL signées afin d'éviter les appels serveur redondants, jusqu'à ce que le jeton de téléchargement de chacune expire. Les recherches effectuées ensemble — une page d'aperçus appelant `getSignedUrl()` dans le même cycle d'exécution — sont envoyées au serveur sous la forme d'une seule requête `POST /api/storage/metadata` pour 100 fichiers, que le limiteur de débit compte comme un dixième des requêtes qu'elle remplace ; un fichier qu'un appelant n'est pas autorisé à lire ne fait échouer que cet appel précis. Le cache appartient aux identifiants qui l'ont demandé : lorsque le jeton d'accès change — une déconnexion, la connexion d'un autre utilisateur, un rafraîchissement —, il est réinitialisé, évitant ainsi qu'un utilisateur ne reçoive une URL générée pour un autre.

### URL privées vs URL publiques

- **Fichiers privés** : ils obtiennent une URL avec un **jeton de téléchargement à courte durée de vie et limité au chemin** (`?token=…`, 5 minutes à moins que le serveur ne définisse `STORAGE_DOWNLOAD_TOKEN_TTL`, que la version 0.23 ne lit pas) — jamais votre jeton d'accès. Comme elle expire, **ne persistez pas d'URL privée** ; stockez le **chemin** du fichier et appelez à nouveau `getSignedUrl()` au moment de l'afficher.
- **Fichiers publics** (stockés sous le préfixe `public/` — définissez `storage: { public: true }` sur la propriété, ou transmettez `public: true` à `putObject`) : ils obtiennent une URL **stable, sans jeton, permanente et pouvant être mise en cache par CDN**, sans aucun aller-retour vers le serveur. Celles-ci peuvent être stockées sans risque dans une base de données et intégrées directement (hotlinking).

### Fichiers au sein d'un texte

Un texte qui intègre un fichier — par exemple les images dans un champ Markdown — ne peut pas non plus contenir d'URL privée ; il utilise donc une **référence de stockage** à la place : `rebase-storage:posts/cover.png`, avec `?storageId=media` lorsque le fichier se trouve dans une source nommée. C'est ce que l'éditeur Markdown du panneau d'administration enregistre pour une image téléversée. Remplacez les références par des URL lors du rendu du texte :

```typescript
import { resolveStorageReferences } from "@rebasepro/client";

const post = await client.data.table("posts").findById("post-1");
const body = await resolveStorageReferences(String(post?.body ?? ""), client);
// `body` is the same markdown, each reference replaced by a fresh URL.
```

Chaque objet est signé une fois par appel, à partir de sa propre source, afin qu'une image privée continue de fonctionner quel que soit le temps écoulé depuis son téléversement. Une référence qui pointe vers un objet n'existant plus reste inchangée. `storageReference(key, storageId?)` permet d'en construire une, pour le texte que vous écrivez vous-même.

Le texte enregistré avant l'existence des références contient directement l'URL de téléchargement d'un fichier privé, `…/storage/file/posts/cover.png?token=…`, dont le jeton a expiré quelques minutes après son écriture. `resolveStorageReferences` renouvelle également celles-ci : le jeton désigne toujours l'objet, l'URL est donc remplacée par une nouvelle URL valide. Pour stocker des références à la place, réécrivez le texte une seule fois avec `storageReferencesForDownloadUrls(text)`, qui laisse toutes les autres URL telles quelles.

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

La suppression d'un fichier inexistant ne lève aucune erreur.

## Lister les fichiers

Listez les fichiers par préfixe, avec pagination facultative :

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

Chaque élément comporte sa taille `size` en octets et sa date de mise à jour `updated` (un horodatage ISO 8601) sur le stockage local, S3 et GCS, ainsi que son `contentType` sur le stockage local et GCS — ce qui suffit pour afficher un dossier sans effectuer un appel `getSignedUrl()` par fichier. Un listage S3 ne comporte pas de type de contenu ; les dossiers (`result.prefixes`) ne comportent aucun des trois.

## Formats de clé de stockage

Le SDK gère les préfixes de clé de stockage de manière transparente. Vous pouvez transmettre des clés avec ou sans le préfixe de protocole :

```typescript
// All equivalent — the SDK strips the prefix internally
await client.storage.getSignedUrl("local://products/image.jpg");
await client.storage.getSignedUrl("s3://products/image.jpg");
await client.storage.getSignedUrl("products/image.jpg");
```

## Référence de l'API

| Méthode | Description | Retourne |
|---------|-------------|----------|
| `putObject({ file, key?, bucket?, metadata? })` | Téléverser un fichier | `UploadFileResult` |
| `getSignedUrl(key, bucket?)` | Obtenir l'URL de téléchargement + métadonnées | `DownloadConfig` |
| `getObject(key, bucket?)` | Télécharger sous forme d'objet `File` | `File \| null` |
| `deleteObject(key, bucket?)` | Supprimer un fichier | `void` |
| `listObjects(prefix, options?)` | Lister les fichiers par préfixe | `StorageListResult` |

## Prochaines étapes

- **[Configuration du stockage](/docs/backend/storage)** — Configurer S3 ou le stockage local sur le serveur
- **[Interrogation des données](/docs/sdk/querying)** — Opérations CRUD et constructeur de requêtes
- **[Authentification](/docs/sdk/authentication)** — Connexion et gestion des sessions
