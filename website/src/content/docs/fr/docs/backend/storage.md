---
sourceHash: dde397d03ef58183
title: Configuration du stockage
sidebar_label: Configuration du stockage
description: Configurez des backends de stockage sur système de fichiers local, compatibles S3 ou GCS/Firebase Storage pour les téléversements de fichiers, les images et les médias.
---

## Vue d'ensemble

Rebase prend en charge trois backends de stockage :

- **Système de fichiers local** — Fichiers stockés sur disque (idéal pour le développement)
- **Compatible S3** — AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces
- **Google Cloud Storage / Firebase Storage** — Prise en charge native de GCS via `@google-cloud/storage`

## Configuration

:::note[Où placer ceci]
**Runtime managé** — les variables `STORAGE_*` dans `.env` (`STORAGE_TYPE`, `S3_BUCKET` / `GCS_BUCKET`, `STORAGE_PATH`, `STORAGE_PUBLIC_READ`, … — ajoutez le suffixe `__<KEY>` à n'importe laquelle d'entre elles pour une source nommée), plus une déclaration `bucket("<key>")` dans `backend/resources.ts` pour chaque bucket supplémentaire au-delà de celui par défaut, et `export const storageAuthorize` depuis `backend/storage.ts`. `storageAuthorize` n'a volontairement aucune forme en variable d'environnement : aucune variable ne peut exprimer « cet utilisateur a le droit de lire cette clé ».

**Éjecté** — le bloc `storage` dans `initializeRebaseBackend({ … })`. `storagePolicies` et `storageTriggers` sont réservés au mode éjecté.

Le récapitulatif complet se trouve dans la [Vue d'ensemble du backend](/docs/backend/#where-each-option-lives).
:::

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

Le stockage local conserve les métadonnées de chaque objet à côté de lui, sous la forme `<key>.metadata.json`. Par conséquent, une clé dont le dernier segment se termine par `.metadata.json` est refusée avec `400 INVALID_STORAGE_KEY` sur chaque route. S3 et GCS conservent les métadonnées sur l'objet et acceptent n'importe quelle clé. Sur un système de fichiers insensible à la casse (macOS et Windows par défaut), `Avatar.png` et `avatar.png` représentent un seul fichier local mais deux objets sur S3, GCS ou un disque Linux ; le serveur émet donc un avertissement au démarrage lorsque le dossier de stockage se trouve sur un tel système.

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

### Stockage GCS / Firebase

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

Sur GCP (Cloud Run, GCE, GKE), les identifiants du compte de service par défaut sont utilisés automatiquement. En dehors de GCP, définissez la variable d'environnement `GOOGLE_APPLICATION_CREDENTIALS` avec le chemin d'accès vers votre fichier de clé de compte de service.

### Plusieurs backends de stockage

Vous pouvez configurer plusieurs backends nommés et acheminer différents champs vers différents stockages :

```typescript
storage: {
    "(default)": { type: "local", basePath: "./uploads" },
    "media": { type: "s3", bucket: "media-bucket", region: "us-east-1", ... }
}
```

Pointez ensuite une colonne de stockage vers un backend spécifique grâce à `source` :

```typescript
image: col.storage({ path: "products/", source: "media" }),  // Routes to the "media" S3 backend
```

## Points de terminaison de stockage

| Méthode | Chemin | Description |
|--------|------|-------------|
| `POST` | `/api/storage/upload` | Téléversement direct de fichier, un seul corps `multipart/form-data` : `file` (obligatoire) ; `key`, la clé de l'objet, dossiers inclus (`author_pictures/ada.jpg`), sinon le nom du fichier à la racine ; `bucket`, sinon celui par défaut ; `storageId` ; `collection` et `property`, qui restreignent le fichier aux `maxSize` et `acceptedFiles` de cette propriété ; et `metadata_<name>` pour les métadonnées personnalisées. Tout autre champ est ignoré : il n'y a pas de champ `path` |
| `POST` | `/api/storage/upload?storageId=<key>` | Téléverser vers un backend nommé spécifique |
| `GET` | `/api/storage/file/*` | Récupérer un fichier — tout ce qui suit `/file/` constitue la clé de l'objet |
| `GET` | `/api/storage/file/*?storageId=<key>` | Récupérer un fichier depuis un backend spécifique |
| `GET` | `/api/storage/metadata/*` | Taille, type de contenu et métadonnées personnalisées d'un objet, sans ses octets, ainsi qu'un jeton de téléchargement de courte durée lorsqu'il est privé |
| `POST` | `/api/storage/metadata` | La même chose pour un maximum de 100 objets d'une même source : corps `{ keys, storageId? }` |
| `DELETE` | `/api/storage/file/*` | Supprimer un fichier |
| `GET` | `/api/storage/list` | Lister les objets sous un préfixe (`prefix`, `bucket`, `maxResults`, `pageToken`, `storageId`). Un `maxResults` inférieur à 1, ou un `pageToken` jamais émis par la source, renvoie `400 INVALID_LIST_OPTIONS` |
| `POST` | `/api/storage/folder` | Créer un marqueur de dossier vide |
| `GET` | `/api/storage/sources` | Les sources de stockage servies par ce backend, par clé |
| `OPTIONS` | `/api/storage/tus` | Interroger les fonctionnalités supportées du protocole TUS |
| `POST` | `/api/storage/tus` | Initier une session de téléversement TUS résumable |
| `HEAD` | `/api/storage/tus/:id` | Vérifier la progression du téléversement (décalage en octets) |
| `PATCH` | `/api/storage/tus/:id` | Ajouter un segment de données au fichier temporaire |
| `DELETE` | `/api/storage/tus/:id` | Terminer/abandonner la session de téléversement TUS |

**Format de réponse.** Une enveloppe unique, identique à celle utilisée par `/api/data` : la charge utile se trouve sous `data`, et un échec renvoie `{ "error": { message, code, requestId } }` avec les codes documentés dans la [référence des erreurs](/docs/backend/errors/). `/api/storage/file/*` fait exception, car sa charge utile est le fichier lui-même — il renvoie les octets, avec les en-têtes `Content-Type`, `Content-Length` et les en-têtes de mise en cache.

```json
// GET /api/storage/list?prefix=products/images/
{ "data": { "items": [ { "bucket": "default", "fullPath": "products/images/a.jpg", "name": "a.jpg",
  "size": 48213, "updated": "2026-10-01T12:00:00.000Z", "contentType": "image/jpeg" } ], "prefixes": [] } }
```

Un listage décrit chaque fichier renvoyé : sa taille `size` en octets et `updated`, date de sa dernière écriture, sur le stockage local, S3 et GCS, ainsi que son `contentType` sur le stockage local et GCS. Un listage S3 ne comporte pas le type ; il est donc absent sur S3, mais `/api/storage/metadata/*` continue de l'indiquer. Un dossier dans `prefixes` n'en comporte aucun, tout comme un `StorageController` personnalisé qui ne les renseignerait pas.

`POST /api/storage/upload` renvoie `201` avec `{ key, bucket, storageUrl }` pour l'objet stocké sous `data` ;
`GET /api/storage/metadata/*` renvoie les métadonnées de l'objet et, pour un objet privé, le `token` de courte durée ; `POST /api/storage/metadata` renvoie un objet indexé par les chemins qui lui ont été transmis, chacun contenant ce que le `GET` aurait renvoyé (voir ci-dessous). Un dossier n'est pas un objet : appeler `/metadata` sur une clé se terminant par `/` renvoie `404` sur tous les stockages, même là où S3 ou GCS conserve un marqueur `folder/`, aucun jeton de téléchargement n'est donc émis pour un préfixe ; `GET /api/storage/sources` renvoie le tableau des sources configurées, avec `configured: true`. Sur un déploiement sans aucun stockage configuré, il renvoie `200 {"data": [], "configured": false}`, tandis que toutes les autres routes renvoient `501 STORAGE_NOT_CONFIGURED`. `GET /api/auth/config` rapporte ce même état avec `storage: false`, permettant ainsi au client d'éviter la requête. `GET /api/storage/sources` est public : il répond sans jeton, même lorsque `requireAuth` est activé. Il énumère les sources (leur clé, moteur, transport et libellé) et jamais un fichier, et le SDK client le lit pour initialiser ses sources, ce qui peut se produire avant toute authentification. Une application lisant anonymement une source `direct` en a également besoin. Toutes les routes qui listent, lisent ou écrivent un fichier conservent leur niveau d'authentification requis. `DELETE /api/storage/file/*` et `POST /api/storage/folder` ne renvoient qu'un simple `message`, puisqu'il n'y a rien d'autre à retourner.

Sur S3 et GCS, le `bucket` doit impérativement être desservi par la source, à l'écriture comme à la lecture : un téléversement, un appel `POST /api/storage/folder` ou un téléversement TUS spécifiant un autre bucket renvoie `404 UNKNOWN_STORAGE_SOURCE`, tout comme le listage. Le stockage local, quant à lui, crée toujours le bucket lors de sa première écriture.

**Plusieurs objets à la fois.** `POST /api/storage/metadata` accepte
`{ "keys": ["photos/a.png", "photos/b.png"], "storageId": "media" }` — jusqu'à 100
chemins d'objets d'une même source, chacun formaté comme l'attend `GET /api/storage/metadata/<key>` — et renvoie une entrée par clé :

```json
{ "data": {
  "photos/a.png": { "fullPath": "photos/a.png", "size": 48213, "contentType": "image/png", "token": "…", "tokenExpiresIn": 300 },
  "photos/b.png": { "error": { "code": "FORBIDDEN", "message": "Not authorized for this object", "status": 403 } }
} }
```

Chaque clé est évaluée exactement de la même manière que pour un `GET` — même hook `storageAuthorize`, même portée de stockage, même règle publique, son propre jeton de téléchargement — et une clé refusée, manquante ou malformée renvoie sa propre `error` sans provoquer l'échec de la requête ni compromettre les autres. Un appelant sans session dans un déploiement qui en exige une recevra le code `401` que le `GET` aurait renvoyé, à moins que toutes les clés ne soient publiques. Plus de 100 clés, ou un corps de requête sans `keys`, renvoie `400 BAD_REQUEST`. Le limiteur de débit compte la requête comme ⌈N/10⌉ requêtes pour N clés, ainsi une page de 100 miniatures en coûte 10. `client.storage.getSignedUrl()` et le panneau d'administration regroupent ainsi les résolutions nécessaires à une page et se rabattent sur un `GET` individuel par fichier sur les serveurs ne disposant pas de cette route.

**Comment une lecture de fichier est autorisée.** Les routes de lecture — `/api/storage/file/*` et
`/api/storage/metadata/*` — acceptent le jeton signé de courte durée généré par
[`getSignedUrl()`](/docs/sdk/storage), passé sous la forme `?token=<token>` ou en tant que jeton
`Bearer`. Un JWT d'accès ordinaire est **refusé** sur `/file/*` avec l'erreur `401 Unauthorized: Access JWT not allowed on file routes` : le jeton valide sur toutes les autres routes ne fonctionne pas ici, par conception, car une URL de fichier a vocation à être transmise à un navigateur, un CDN ou une balise `<img>`. Toutes les autres lignes du tableau ci-dessus acceptent le JWT d'accès de manière classique.

## Transformations d'images à la volée

Rebase intègre un pipeline de traitement d'images propulsé par **Sharp**. Lors de la distribution de ressources visuelles depuis le stockage, vous pouvez appliquer des transformations dynamiques via des paramètres d'URL :

```bash
# Serve image scaled to 300px width in webp format
GET /api/storage/file/products/laptop.jpg?width=300&format=webp
```

### Paramètres pris en charge

- `width`, `height` : Limites de redimensionnement, `1`–`4096` (l'image n'est jamais agrandie au-delà de sa taille d'origine).
- `quality` : `1`–`100`.
- `format` : Convertit le format d'image. Formats pris en charge : `webp`, `jpeg`, `png`, `avif`.
- `fit` : `cover`, `contain`, `fill`, `inside` ou `outside`.

Un paramètre en dehors de ces limites renvoie un statut **400**, et non une valeur corrigée silencieusement —
`?width=99999` renvoyait auparavant une image de 4096px et `?format=tiff` une image au format webp, sans que rien ne l'indique.

Les miniatures d'images stockées du panneau d'administration s'appuient sur ce point de terminaison : un aperçu dans un tableau ou une carte demande un rendu webp d'environ deux fois sa taille affichée (96–800px) plutôt que l'original. Les fichiers SVG et GIF sont toujours affichés tels quels.
`sharp` est optionnel :
sans lui, une requête de transformation reçoit le fichier original, et le backend avertit une seule fois d'exécuter `pnpm add sharp` dans `backend/`.

### Performances et cache LRU

La transformation d'images est gourmande en CPU et en mémoire. De plus, sur un objet public, le point de terminaison est accessible de façon anonyme : le travail est donc strictement limité au lieu d'être simplement mis en cache :
- **Capacité** : un cache LRU plafonné à **500 entrées** au global, indexé par source de stockage, bucket et clé canonique.
- **TTL (Time to Live)** : Les variantes mises en cache expirent après **1 heure**.
- Plusieurs requêtes simultanées pour une même variante non présente dans le cache ne produisent qu'**une seule** transformation, et non une par requête.
- Un nombre restreint de transformations s'exécute en parallèle ; au-delà d'une file d'attente plafonnée, le serveur renvoie **503 `TRANSFORM_OVERLOADED`** au lieu d'accepter des traitements qu'il ne pourra pas mener à bien.

Ce cache réside en mémoire dans le processus, ce qui implique qu'il n'est pas partagé entre différentes instances et ne survit pas à un redémarrage. Deux réplicas recalculeront chacun chaque variante, et un déploiement purge l'intégralité du cache.

### Rendus persistants après un redémarrage

`storageRenditionCache` réécrit chaque image dérivée dans le même bucket que sa source, de sorte que le travail n'est effectué qu'une seule fois pour l'ensemble du déploiement, et non une fois par instance et par livraison :

```ts
storageRenditionCache: { enabled: true }
```

ou `STORAGE_RENDITION_CACHE=true` pour un déploiement packagé. Les rendus sont stockés sous le préfixe réservé `_rebase/renditions/`, indexés par la version de l'objet source — remplacer une image sert ainsi immédiatement la nouvelle.

Trois éléments à retenir avant de l'activer :

- **Une lecture implique désormais une écriture.** Chaque nouvelle variante coûte un `PUT` dans votre bucket. Cette option est donc désactivée par défaut.
- **Un échec d'écriture n'entraîne pas l'échec de la requête.** En cas d'identifiants en lecture seule, ou d'une stratégie de bucket rejetant ce préfixe, le mécanisme bascule sur le cache mémoire du processus ; l'image est toujours servie et la raison n'est consignée qu'une fois dans les journaux.
- **Les rendus obsolètes ne sont pas nettoyés automatiquement.** Le remplacement d'un objet source abandonne ses anciens rendus. Définissez une règle de cycle de vie sur `_rebase/renditions/` — ce préfixe est fixe et non configurable, précisément pour pouvoir être ciblé par une telle règle.

Ce préfixe n'est pas accessible via l'API. Tenter de le lire ou d'y écrire directement renvoie **400 `INVALID_STORAGE_KEY`** : toutes les règles d'accès du système — `storageAuthorize` comme les stratégies déclaratives — s'appliquent à la clé *source*, et un rendu exposé sous son propre chemin répondrait à une question qui n'a pas lieu d'être.

`_rebase/maintenance/` est réservé de la même façon. `rebase storage orphans` y conserve le rapport de chaque analyse, au sein de la source analysée, de sorte que le processus exécutant l'analyse et celui répondant à son statut lisent le même enregistrement. Un appelant en mesure d'écrire un tel rapport pourrait contrôler ce qu'une suppression ultérieure effacerait ; lire, écrire ou lister ce préfixe renvoie donc également une erreur 400. Les rapports sont purgés 7 jours après leur dernière écriture, lors du démarrage de l'analyse suivante sur cette source.

### Ce qui est distribué

Le type de contenu stocké correspond exactement à celui déclaré par l'expéditeur lors du téléversement — aucun contrôle du contenu des octets n'est effectué — `/api/storage/file/*` n'affiche donc en ligne qu'une **liste d'autorisation stricte** : images, vidéo, audio, `application/pdf` et `text/plain`. Tout le reste, y compris `text/html`, est distribué sous la forme `application/octet-stream` avec l'en-tête `Content-Disposition: attachment`, et chaque réponse inclut `X-Content-Type-Options: nosniff`. L'espace de stockage n'est pas un serveur web : une page téléversée qui serait interprétée sur l'origine de l'API pourrait accéder aux cookies de cette origine et appeler ses points de terminaison.

Un fichier SVG est une image mais aussi un document, et peut contenir des balises `<script>`. Il est servi sous le type `image/svg+xml` — lui permettant ainsi de s'afficher dans une balise `<img>` et dans les miniatures du panneau d'administration — accompagné de l'en-tête
`Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`
sur chaque réponse, y compris pour les URL transformées et les URL avec jeton de téléchargement. Lorsqu'il est ouvert directement, il s'affiche avec les scripts désactivés et une origine opaque, ce qui l'empêche d'accéder aux cookies ou aux points de terminaison de l'API.

## Taille maximale des fichiers

Chaque source de stockage accepte des fichiers dans la limite définie pour celle-ci : **50 Mo** à moins que `STORAGE_MAX_FILE_SIZE` (en octets, suffixé par `__<KEY>` pour une source nommée) ou la directive `maxFileSize` de la source n'en dispose autrement. Tous les points d'entrée appliquent la même limite. `POST /api/storage/upload` renvoie `413 PAYLOAD_TOO_LARGE` au-delà de cette valeur ; un téléversement résumable est refusé dès son initialisation, avant son premier segment ; et `OPTIONS /api/storage/tus` l'annonce sous la forme `Tus-Max-Size` — pour la source indiquée via `?storageId=`, ou pour celle par défaut dans le cas contraire.

```bash
STORAGE_MAX_FILE_SIZE=209715200          # (défaut) : 200 Mo
STORAGE_MAX_FILE_SIZE__MEDIA=1073741824  # media : 1 Go
```

La quantité de données d'un fichier conservée simultanément en mémoire par le serveur dépend du point d'entrée.
`POST /api/storage/upload` implique un corps multipart complet, que le serveur analyse intégralement : cela nécessite trois à cinq fois la taille du fichier en mémoire. Un téléversement résumable (TUS) ne conserve qu'un segment à la fois. `client.storage.putObject()` et le panneau d'administration transmettent les fichiers de plus de 8 Mio via le protocole résumable. Consultez la documentation sur les [Téléversements résumables (TUS)](/docs/backend/storage-resumable-uploads/) pour découvrir le protocole, le format de réponse et le comportement entre plusieurs instances.

## Variables d'environnement

| Variable | Description |
|----------|-------------|
| `STORAGE_TYPE` | `"local"`, `"s3"`, ou `"gcs"` |
| `STORAGE_PATH` | Répertoire de stockage local (par défaut : `<project>/uploads`, sous `rebase dev` comme dans un serveur généré par `rebase eject`). Un chemin relatif est résolu depuis le répertoire d'exécution du serveur, qui correspond à `backend/` après un `rebase eject`. Un bucket local nommé stocke ses fichiers à côté, dans `<STORAGE_PATH>__<key>`, à moins que `STORAGE_PATH__<KEY>` n'en définisse un propre |
| `S3_BUCKET` | Nom du bucket S3 |
| `S3_REGION` | Région AWS (par défaut : `"auto"`) |
| `S3_ACCESS_KEY_ID` | Clé d'accès AWS |
| `S3_SECRET_ACCESS_KEY` | Clé secrète AWS |
| `S3_ENDPOINT` | Point de terminaison S3 personnalisé (pour MinIO, R2) |
| `S3_FORCE_PATH_STYLE` | Utiliser des URL au format path-style (requis pour MinIO) |
| `GCS_BUCKET` | Nom du bucket Google Cloud Storage |
| `GCS_PROJECT_ID` | ID de projet GCP pour GCS |
| `GCS_KEY_FILENAME` | Chemin vers un fichier de clé de compte de service GCP (à omettre sur GKE — Workload Identity/ADC fournit les identifiants) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Variable standard ADC, lue par le SDK Google lui-même (non requise sur GCP avec les identifiants par défaut) |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Durée de validité de l'URL de téléchargement d'un fichier privé, en secondes — durée de vie du jeton généré par `/api/storage/metadata/*` (par défaut `300`, maximum `604800`, soit une semaine). Augmentez cette valeur pour les vidéos et audios privés, qui continuent de requérir des plages d'octets après le rendu de la page. Équivalent en variable d'environnement de `storageDownloadTokenTtl` |
| `STORAGE_MAX_FILE_SIZE` | Taille maximale de fichier acceptée par la source, en octets (par défaut `52428800`, soit 50 Mo). Ajoutez le suffixe `__<KEY>` pour une source nommée. Une valeur qui n'est pas un entier empêche le démarrage du serveur. Voir [Taille maximale des fichiers](#taille-maximale-des-fichiers) |
| `FORCE_LOCAL_STORAGE` | Autoriser `STORAGE_TYPE=local` en production — voir ci-dessous |
| `STORAGE_PUBLIC_READ` | Mettre les objets stockés à disposition des lecteurs non authentifiés. Équivalent en variable d'environnement de `storagePublicRead`, et l'un des trois moyens de satisfaire le [contrôle de démarrage en production](#autorisation-par-objet). |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Désactiver le contrôle de démarrage, rétablissant le comportement où tout utilisateur connecté peut lire, écraser, supprimer ou lister n'importe quelle clé. Équivalent en variable d'environnement de `storageInsecureAllowAnyAuthenticated`. Uniquement justifiable si chaque utilisateur connecté a la confiance nécessaire pour accéder à chaque fichier. |

## Plusieurs buckets

Un projet peut comporter plusieurs buckets. Déclarez chacun d'eux dans `backend/resources.ts`
— l'emplacement unique lu à la fois par la plateforme, le runtime et la console :

```ts
import { bucket } from "@rebasepro/types";

export const uploads = bucket({ engine: "s3" });    // the default one
export const media = bucket("media", { engine: "s3", label: "Media" });
```

Exécutez ensuite `rebase resources --write`, ce qui régénère `rebase.resources.json`
afin qu'un hôte puisse interpréter votre topologie sans lancer de build. Consultez
[Sources multiples](/docs/backend/multiple-sources) pour la gestion conjointe des bases de données, des buckets et des topics.

Chaque source se configure à partir des **mêmes noms de variables assortis de son propre suffixe**. La source par défaut ne prend aucun suffixe, ainsi un projet à bucket unique conserve les dénominations simples présentées ci-dessus sans rien devoir déclarer de plus, et l'ajout de buckets nommés à ses côtés n'altère en rien son fonctionnement ([détails](/docs/backend/multiple-sources/#which-bucket-receives-an-unqualified-upload)) :

```bash
S3_BUCKET=app-uploads             # (défaut)
S3_BUCKET__MEDIA=app-media        # media
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

Le suffixe est dérivé de la clé : converti en majuscules, les caractères non alphanumériques étant remplacés par des tirets bas, précédé d'un **double** tiret bas (`media-cdn` → `__MEDIA_CDN`). Un tiret bas unique entrerait en collision avec des variables existantes — `S3_BUCKET_NAME` serait alors interprété comme le bucket `NAME`.

Associez une colonne à une source via `source` :

```ts
cover: col.storage({ path: "covers/", source: "media", accept: ["image/*"] }),
```

Une source déclarée mais non configurée est simplement **ignorée**, sans provoquer d'erreur fatale : les téléversements acheminés vers celle-ci renvoient `501 STORAGE_SOURCE_NOT_CONFIGURED`. La déclaration d'un bucket intervient généralement avant qu'un stockage effectif ne lui soit rattaché ; générer une erreur de démarrage à ce stade bloquerait le backend dans une boucle de redémarrages jusqu'à ce que ce soit fait. En revanche, une source configurée de manière *invalide* dans l'environnement — un type sans bucket, ou un bucket sans identifiants — est rejetée au démarrage, s'agissant d'une erreur de configuration et non d'une absence volontaire.

### Buckets partageant un même compte

Les identifiants décrivent généralement le **fournisseur**, et non le bucket. Quinze buckets sur une même instance MinIO nécessiteraient sans cela quinze copies de la même clé d'accès, et leur renouvellement imposerait quinze modifications simultanées. Désignez plutôt un compte partagé :

```ts
export const media = bucket("media", { engine: "s3", account: "minio" });
export const avatars = bucket("avatars", { engine: "s3", account: "minio" });
```

```bash
S3_BUCKET__MEDIA=b-media          # par bucket, toujours
S3_BUCKET__AVATARS=b-avatars
S3_ACCESS_KEY_ID__MINIO=…         # partagé par les deux
S3_SECRET_ACCESS_KEY__MINIO=…
S3_ENDPOINT__MINIO=https://minio.internal
```

Seules les variables délimitées au niveau du compte sont partagées par défaut — `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`, `S3_FORCE_PATH_STYLE`, ainsi que le couple GCS `GCS_PROJECT_ID` / `GCS_KEY_FILENAME`. Le nom du bucket ne l'est jamais : c'est précisément ce qui distingue une source d'une autre. Une valeur définie au niveau du bucket reste prioritaire, ce qui permet à une source donnée de changer de fournisseur sans impacter les autres.

### Suppression planifiée des fichiers non référencés par une ligne

La suppression d'une ligne laisse ses fichiers dans le bucket. Rien n'est supprimé en même temps que la ligne : une autre ligne, une version dans l'[historique](/docs/backend/history/), ou votre propre code conservant la clé dans une simple chaîne de caractères peut encore référencer le fichier. Un bucket peut déclencher un processus de nettoyage capable d'examiner l'ensemble de ces références :

```ts
export const voice = bucket("voice", { engine: "s3", orphanSweep: { olderThanHours: 72 } });
export const media = bucket("media", { orphanSweep: true }); // une semaine, tous les jours à 04:17 UTC
```

Chaque balayage déclaré constitue une tâche cron, `storage-orphan-sweep-<bucket>`
(`storage-orphan-sweep-default` pour le bucket par défaut). Elle exécute l'analyse sous-jacente de `rebase storage orphans --delete`. Cette analyse parcourt l'ensemble des lignes de chaque table ainsi que chaque entrée d'historique, et conserve :

- tout fichier encore référencé par un quelconque élément ;
- tout fichier plus récent que `olderThanHours` (au minimum 24 heures, une semaine par défaut) ;
- tous les fichiers, pour cette exécution, si une table ne peut pas être lue.

Elle vérifie ensuite chaque fichier une seconde fois juste avant sa suppression. Définissez `schedule` à l'aide d'une expression cron (UTC) pour modifier sa fréquence d'exécution. Étant une tâche cron, elle ne s'exécute que sur une seule instance par créneau. L'historique de ses exécutions consigne le nombre de fichiers supprimés et conservés, et elle peut être mise en pause ou déclenchée manuellement depuis la liste des tâches cron dans l'administration. Elle requiert un bucket pris en charge par ce backend : un bucket avec `transport: "direct"` est refusé au démarrage avec un avertissement.

## Sources de stockage côté frontend

Le frontend prend connaissance des sources du serveur via `GET /api/storage/sources` ; une source de type `server` n'a donc pas besoin d'entrée manuelle. Passez `storageSources` au fournisseur `<Rebase>` pour une source de type `direct`, qui téléverse directement vers son fournisseur, ou pour définir vous-même un libellé ou un transport :

```tsx
import { Rebase } from "@rebasepro/app";

<Rebase
    apiUrl="https://api.example.com"
    storageSources={[
        // `engine` désigne le fournisseur, `transport` indique qui communique avec lui :
        // "server" relaie via le backend Rebase, "direct" établit une connexion directe
        // client-fournisseur (et requiert une implémentation `source`).
        { key: "media", engine: "s3", transport: "server", label: "Media CDN" },
        { key: "firebase", engine: "firebase", transport: "server", label: "Firebase Storage" },
    ]}
>
    {() => <MyApp />}
</Rebase>
```

La `key` d'une source `server` doit concorder avec une clé déclarée dans le mapping `storage` du serveur. Le contexte React `StorageSourcesContext` détermine la source active pour chaque champ de téléversement.

## Mise en cache et CDN

Chaque objet transite par le serveur, avec un en-tête `ETag` pour une revalidation légère, un en-tête `Cache-Control` adapté aux autorisations de lecture, et la prise en charge des plages d'octets (byte ranges) pour la recherche dans les fichiers audio et vidéo. La section [Mise en cache du stockage et CDN](/docs/backend/storage-caching/) détaille les en-têtes ainsi que les paramètres à configurer sur un CDN placé en amont.

## Conseils pour la production

:::caution
**En production, `type: "local"` désactive le stockage de fichiers au lieu de l'utiliser.** Sur une plateforme éphémère (Cloud Run, Heroku, un pod Kubernetes), le système de fichiers est réinitialisé à chaque déploiement, redémarrage ou éviction — ainsi, les téléversements réussiraient, se reliraient sans souci, mais disparaîtraient lors du déploiement suivant, sans générer d'erreur apparente.

La configuration locale par défaut n'est donc pas enregistrée, et toute requête vers `/api/storage/*` ne mentionnant aucune source de stockage renvoie **`501 STORAGE_NOT_CONFIGURED`**, en indiquant la liste des sources actives. Une source nommée et configurée, telle que `bucket("media", { engine: "s3" })`, continue de fonctionner normalement. Les téléversements échouent de manière explicite et recouvrable ; le reste de l'application continue de fonctionner. Le stockage de fichiers est activé explicitement en production : il n'est effectif qu'à partir du moment où un bucket existe.

Définissez `STORAGE_TYPE=s3` ou `gcs`. Si un **volume persistant** héberge réellement `STORAGE_PATH`, définissez `FORCE_LOCAL_STORAGE=true` pour le spécifier de manière explicite. Montez-le sur le répertoire parent de `STORAGE_PATH`, afin que le dossier `<STORAGE_PATH>__<key>` de chaque bucket local nommé s'y trouve également.
:::

- Montez un **volume persistant** sur le parent de `STORAGE_PATH` si vous utilisez le stockage local sous Docker/Kubernetes, et définissez `FORCE_LOCAL_STORAGE=true` — voir [Auto-hébergement](/docs/deployment/self-hosting/#file-storage)
- Utilisez **S3** ou un service compatible (R2, MinIO), ou **GCS**, pour les déploiements en production
- Configurez un **CDN** (CloudFront, Cloudflare) en amont pour optimiser les performances — voir [Mettre en place un CDN](/docs/backend/storage-caching/#putting-a-cdn-in-front)
- **Toute application utilisant le stockage en production doit déclarer un modèle d'accès** — voir
  [Autorisation de stockage](/docs/backend/storage-authorization/).
  Cela ne concerne pas uniquement les environnements multi-locataires : le serveur *refuse de démarrer* en l'absence d'un modèle d'accès.

## Autorisation par objet

Les permissions de lecture, d'écriture, de suppression ou de listage pour chaque clé sont régies par `storagePolicies`
et le hook `storageAuthorize` ; une clé d'API doit également posséder la portée de stockage requise pour l'opération concernée. En production, le serveur refuse de démarrer si un stockage est actif sans modèle d'accès associé. Voir
[Autorisation de stockage](/docs/backend/storage-authorization/).

## Réagir à un téléversement

Toutes les autres opérations d'écriture dans Rebase permettent d'attacher un traitement — une ligne propose `beforeSave` et
`afterSave`, une planification dispose d'une tâche cron — alors qu'un téléversement ne proposait rien. Toute logique découlant d'un téléversement devait être prise en charge par le client lors d'un second appel, avec le risque de ne jamais être exécutée si le client se déconnectait entre-temps.

```ts
storageTriggers: [
    {
        path: "uploads/:uid/**",
        events: ["finalize"],
        handler: async ({ key, params, size, user }) => {
            await indexUpload.enqueue({ key, uid: params.uid, size }); // a `queue()` in backend/resources.ts
        }
    }
]
```

La syntaxe des motifs est identique à celle de `storagePolicies` — segments littéraux, `*`
pour un segment individuel, `:name` pour en capturer un, `**` pour le reste — et un motif malformé bloque le démarrage du serveur au lieu d'ignorer silencieusement les correspondances.

| Événement | Moment d'exécution |
| --- | --- |
| `finalize` | après que l'objet a été écrit de manière durable ; jamais pour une écriture ayant échoué |
| `delete` | après la suppression définitive de l'objet |

L'événement `finalize` se déclenche pour les téléversements standards en multipart comme pour les téléversements résumables (TUS) — une seule fois par téléversement, et non à chaque segment — et un téléversement résumable rapporte l'utilisateur qui l'a *initié*, dans la mesure où il s'agit de l'entité vérifiée lors du contrôle d'autorisation.

Hypothèses qu'un gestionnaire ne doit pas faire :

- **Un gestionnaire qui lève une exception ne fait pas échouer la requête.** L'objet est déjà stocké au moment de son exécution ; retourner une erreur au client indiquerait un échec du téléversement alors que ce n'est pas le cas, provoquant de nouvelles tentatives superflues. Les erreurs sont consignées dans les journaux et la réponse HTTP reste inchangée. Si le traitement est critique, mettez-le dans une file d'attente (queue).
- **Les gestionnaires sont attendus (`await`)**, dans leur ordre de déclaration, avant l'envoi de la réponse — adopter une approche sans attente (« fire and forget ») laisserait une promesse en suspens qu'un runtime serverless pourrait geler en cours d'exécution. Un gestionnaire lent ralentit donc directement le téléversement, ce qui constitue une raison supplémentaire de déléguer la tâche à une file d'attente plutôt que de l'exécuter sur place.
- **Les écritures internes ne déclenchent pas les triggers.** Le cache de rendu d'images écrit les objets dérivés directement auprès du contrôleur de stockage ; un trigger `**` réagissant à ces écritures s'exécuterait en boucle sur sa propre production.

## Prochaines étapes

- **[Stockage côté frontend & téléversement de fichiers](/docs/frontend/storage)** — Champs et hooks de téléversement de fichiers
- **[Colonnes](/docs/schema/columns/#storage-columns)** — `col.storage()` et ses options
