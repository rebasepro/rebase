---
sourceHash: c6ff4a9052df3362
title: Configuration du stockage
sidebar_label: Configuration du stockage
description: Configurez des backends de stockage sur le système de fichiers local, compatibles S3 ou GCS/Firebase Storage pour les téléversements de fichiers, images et médias.
---

## Vue d'ensemble

Rebase prend en charge trois backends de stockage :

- **Système de fichiers local** — Fichiers stockés sur disque (idéal pour le développement)
- **Compatible S3** — AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces
- **Google Cloud Storage / Firebase Storage** — Prise en charge native de GCS via `@google-cloud/storage`

## Configuration

Le stockage est configuré dans le bloc `storage` de `initializeRebaseBackend` :

### Stockage local

```typescript no-verify
const backend = await initializeRebaseBackend({
    // ...
    storage: {
        type: "local",
        basePath: "./uploads"   // Directory for file storage
    }
});
```

### Stockage S3

```typescript no-verify
const backend = await initializeRebaseBackend({
    // ...
    storage: {
        type: "s3",
        bucket: env.S3_BUCKET!,
        region: env.S3_REGION || "auto",
        accessKeyId: env.S3_ACCESS_KEY_ID || "",
        secretAccessKey: env.S3_SECRET_ACCESS_KEY || "",
        endpoint: env.S3_ENDPOINT,          // For MinIO, R2, etc.
        forcePathStyle: env.S3_FORCE_PATH_STYLE  // Required for MinIO
    }
});
```

### GCS / Firebase Storage

```typescript no-verify
const backend = await initializeRebaseBackend({
    // ...
    storage: {
        type: "gcs",
        bucket: env.GCS_BUCKET!,
        projectId: env.GCS_PROJECT_ID,
    }
});
```

Sur GCP (Cloud Run, GCE, GKE), les identifiants du compte de service par défaut sont utilisés automatiquement. En dehors de GCP, définissez la variable d'environnement `GOOGLE_APPLICATION_CREDENTIALS` sur le chemin du fichier de clé de votre compte de service.

### Plusieurs backends de stockage

Vous pouvez configurer plusieurs backends nommés et router différents champs vers différents stockages :

```typescript
storage: {
    "(default)": { type: "local", basePath: "./uploads" },
    "media": { type: "s3", bucket: "media-bucket", region: "us-east-1", ... }
}
```

Puis, dans les propriétés de votre collection, référencez un backend spécifique :

```typescript
image: {
    type: "string",
    name: "Image",
    storage: {
        storagePath: "products",
        storageSource: "media"  // Routes to the "media" S3 backend
    }
}
```

## Endpoints de stockage

| Méthode | Chemin | Description |
|--------|------|-------------|
| `POST` | `/api/storage/upload` | Téléversement direct de fichier |
| `POST` | `/api/storage/upload?storageId=<key>` | Téléverser vers un backend nommé spécifique |
| `GET` | `/api/storage/file/*` | Récupérer un fichier — tout ce qui suit `/file/` est la clé de l'objet |
| `GET` | `/api/storage/file/*?storageId=<key>` | Récupérer un fichier depuis un backend spécifique |
| `GET` | `/api/storage/metadata/*` | Taille, type de contenu et dernière modification d'un objet, sans ses octets |
| `DELETE` | `/api/storage/file/*` | Supprimer un fichier |
| `GET` | `/api/storage/list` | Lister les objets sous un préfixe (`prefix`, `bucket`, `maxResults`, `pageToken`, `storageId`) |
| `POST` | `/api/storage/folder` | Créer un marqueur de dossier vide |
| `GET` | `/api/storage/sources` | Les sources de stockage servies par ce backend, par clé |
| `OPTIONS` | `/api/storage/tus` | Interroger les capacités prises en charge du protocole TUS |
| `POST` | `/api/storage/tus` | Initier une session de téléversement reprenable TUS |
| `HEAD` | `/api/storage/tus/:id` | Vérifier la progression du téléversement (offset en octets) |
| `PATCH` | `/api/storage/tus/:id` | Ajouter un bloc de données au fichier temporaire |
| `DELETE` | `/api/storage/tus/:id` | Terminer/annuler la session de téléversement TUS |

**Ce qu'ils répondent.** Une seule enveloppe, celle de `/api/data` : la charge
utile est sous `data`, et un échec est `{ "error": { message, code, requestId } }`
avec les codes de la [référence des erreurs](/docs/backend/errors/).
`/api/storage/file/*` fait exception, car sa charge utile est le fichier — il
répond les octets, avec `Content-Type`, `Content-Length` et les en-têtes de cache.

```json
// GET /api/storage/list?prefix=products/images/
{ "data": { "items": [ { "bucket": "default", "fullPath": "products/images/a.jpg", "name": "a.jpg" } ], "prefixes": [] } }
```

`POST /api/storage/upload` répond `201` avec le `{ key, bucket, storageUrl }` de
l'objet stocké sous `data` ; `GET /api/storage/metadata/*` les métadonnées de
l'objet et, pour un objet privé, le `token` de courte durée ;
`GET /api/storage/sources` le tableau des sources configurées.
`DELETE /api/storage/file/*` et `POST /api/storage/folder` ne portent qu'un
`message`, puisqu'il n'y a rien à renvoyer.

**Comment la lecture d'un fichier est autorisée.** Les routes de lecture —
`/api/storage/file/*` et `/api/storage/metadata/*` — acceptent le jeton signé et de
courte durée émis par [`getSignedUrl()`](/docs/sdk/storage), passé en `?token=<token>`
ou en `Bearer`. Un JWT d'accès ordinaire est **refusé** sur `/file/*` avec `401
Unauthorized: Access JWT not allowed on file routes` : le jeton qui fonctionne sur
toutes les autres routes ne fonctionne pas ici, délibérément, car une URL de fichier se
donne à un navigateur, à un CDN ou à une balise `<img>`. Toutes les autres lignes
ci-dessus acceptent le JWT d'accès comme d'habitude.

## Transformations d'images à la volée

Rebase inclut un pipeline de traitement d'images intégré, propulsé par **Sharp**. Lors de la diffusion d'assets d'image depuis le stockage, vous pouvez appliquer des opérations dynamiques via des paramètres de requête :

```bash
# Serve image scaled to 300px width in webp format
GET /api/storage/file/products/laptop.jpg?width=300&format=webp
```

### Paramètres pris en charge

- `width` : Redimensionne l'image à la largeur spécifiée (en conservant le rapport d'aspect).
- `format` : Convertit le format de l'image. Formats pris en charge : `webp`, `jpeg`, `png`, `avif`.

### Performance et cache LRU

Pour éviter une utilisation élevée du CPU et une latence de mise à l'échelle sous forte charge, les images traitées sont stockées dans un **cache LRU** en mémoire :
- **Capacité** : Plafonnée à **500 entrées** globalement.
- **TTL (durée de vie)** : Les variantes en cache expirent après **1 heure**.
- Les requêtes suivantes pour la même combinaison taille/format touchent instantanément le cache LRU, évitant une manipulation de fichier redondante.

## Protocole de téléversement reprenable TUS

Pour téléverser de gros fichiers (jusqu'à **5 Go**) ou gérer des conditions réseau instables, Rebase implémente le protocole ouvert **TUS v1.0.0**, y compris les extensions `Creation` et `Termination`.

```
Client                                                   Rebase Server
  │                                                           │
  │─── POST /api/storage/tus (Upload-Length: 50000000) ──────>│ (Generates session ID)
  │<── 201 Created (Location: /api/storage/tus/uuid-abc) ────│
  │                                                           │
  │─── PATCH /api/storage/tus/uuid-abc (Upload-Offset: 0) ───>│ (Appends chunk via open/write)
  │<── 204 No Content (Upload-Offset: 1500000) ───────────────│
  │                                                           │
  │─── PATCH /api/storage/tus/uuid-abc (Upload-Offset: 1.5M) ─>│ (Upload finishes)
  │<── 204 No Content (Upload-Offset: 50000000) ──────────────│ (Copies to storage, unlinks temp)
```

### Mécanique du cycle de vie du téléversement

1. **Initialisation de la session (`POST`)** : Le client envoie la taille totale du fichier dans l'en-tête `Upload-Length` et des métadonnées en base64 via `Upload-Metadata`. Le serveur crée un fichier fictif vide sous un répertoire temporaire caché `.tus-uploads/` et renvoie l'URL de téléversement.
2. **Requêtes de progression (`HEAD`)** : Si un téléversement est interrompu, le client interroge l'URL de téléversement à l'aide d'une requête `HEAD`. Le serveur renvoie la position d'octet actuelle dans l'en-tête `Upload-Offset`.
3. **Ajout de données (`PATCH`)** : Le client reprend l'envoi de données binaires à partir de l'offset renvoyé avec `Content-Type: application/offset+octet-stream`. Le serveur écrit les blocs entrants directement dans le fichier temporaire à l'aide des API de bas niveau `open` et `write` de Node à l'offset d'octet spécifié.
4. **Finalisation** : Lorsque l'`Upload-Offset` accumulé correspond à l'`Upload-Length` déclaré, Rebase lit le fichier temporaire terminé, l'enveloppe en objet `File` JavaScript standard et l'enregistre dans le backend de stockage configuré (disque local ou S3). Le fichier temporaire est ensuite supprimé.
5. **Balayage périodique** : Un nettoyeur en arrière-plan s'exécute toutes les **60 secondes** pour supprimer les téléversements temporaires orphelins et incomplets qui ont dépassé le seuil de rétention de **24 heures**.

## Variables d'environnement

| Variable | Description |
|----------|-------------|
| `STORAGE_TYPE` | `"local"`, `"s3"` ou `"gcs"` |
| `STORAGE_PATH` | Répertoire de stockage local (par défaut : `./uploads`) |
| `S3_BUCKET` | Nom du bucket S3 |
| `S3_REGION` | Région AWS (par défaut : `"auto"`) |
| `S3_ACCESS_KEY_ID` | Clé d'accès AWS |
| `S3_SECRET_ACCESS_KEY` | Clé secrète AWS |
| `S3_ENDPOINT` | Endpoint S3 personnalisé (pour MinIO, R2) |
| `S3_FORCE_PATH_STYLE` | Utiliser des URL de style chemin (requis pour MinIO) |
| `GCS_BUCKET` | Nom du bucket Google Cloud Storage |
| `GCS_PROJECT_ID` | ID du projet GCP pour GCS |
| `GOOGLE_APPLICATION_CREDENTIALS` | Chemin vers le fichier de clé du compte de service GCP (non nécessaire sur GCP avec les identifiants par défaut) |

## Sources de stockage du frontend

Lorsque vous utilisez plusieurs backends de stockage, passez `storageSources` au provider `<Rebase>` afin que le frontend sache router les téléversements directement :

```tsx
import { Rebase } from "@rebasepro/app";

<Rebase
    apiUrl="https://api.example.com"
    storageSources={[
        { key: "media", label: "Media CDN" },
        { key: "firebase", label: "Firebase Storage" },
    ]}
>
    {/* ... */}
</Rebase>
```

Le `key` de chaque source doit correspondre à une clé de backend enregistrée dans la map `storage` du serveur. Le contexte React `StorageSourcesContext` résout la source active pour chaque champ de téléversement.

## Conseils pour la production

:::caution
**En production, `type: "local"` désactive le stockage de fichiers au lieu de l'utiliser.** Sur des plateformes éphémères (Cloud Run, Heroku, un pod Kubernetes), le système de fichiers est effacé à chaque déploiement, redémarrage et éviction : les téléversements réussiraient, se reliraient correctement, et auraient disparu au déploiement suivant, sans la moindre erreur.

Aucun backend de stockage n'est donc enregistré et `/api/storage/*` répond **`501 STORAGE_NOT_CONFIGURED`**. Les téléversements échouent de façon visible et réparable, et le reste de l'application continue de fonctionner.

Définissez `STORAGE_TYPE=s3` ou `gcs`. Si un **volume durable** est réellement monté sur `STORAGE_PATH`, déclarez-le explicitement avec `FORCE_LOCAL_STORAGE=true`.
:::

- Montez un **volume persistant** si vous utilisez le stockage local sur Docker/Kubernetes, et définissez `FORCE_LOCAL_STORAGE=true`
- Utilisez **S3** ou compatible (R2, MinIO) pour les déploiements en production
- Configurez un **CDN** (CloudFront, Cloudflare) devant votre bucket S3 pour la performance

## Étapes suivantes

- **[Stockage et téléversements de fichiers côté frontend](/docs/frontend/storage)** — Champs et hooks de téléversement de fichiers
- **[Propriétés](/docs/collections/properties)** — Configuration de la propriété de stockage
