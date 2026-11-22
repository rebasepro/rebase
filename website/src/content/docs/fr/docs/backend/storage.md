---
sourceHash: 1eae92c45ebedd91
title: Configuration du stockage
sidebar_label: Configuration du stockage
description: Configurez les backends de stockage sur système de fichiers local, compatibles S3 ou GCS/Firebase Storage pour les téléversements de fichiers, les images et les médias.
---

## Vue d'ensemble

Rebase prend en charge trois backends de stockage :

- **Système de fichiers local** — Fichiers stockés sur disque (idéal pour le développement)
- **Compatible S3** — AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces
- **Google Cloud Storage / Firebase Storage** — Prise en charge native de GCS via `@google-cloud/storage`

## Configuration

<span class="since-badge" data-since="0.35">Depuis la version 0.35</span>

:::note[Où placer ces éléments]
**Runtime géré** — les variables `STORAGE_*` dans `.env` (`STORAGE_TYPE`, `S3_BUCKET` / `GCS_BUCKET`, `STORAGE_PATH`, `STORAGE_PUBLIC_READ`, … — ajoutez le suffixe `__<KEY>` à n'importe laquelle d'entre elles pour une source nommée), plus une déclaration `bucket("<key>")` dans `backend/resources.ts` pour chaque bucket en plus de celui par défaut, et `export const storageAuthorize` depuis `backend/storage.ts`. Les règles par objet peuvent également être définies sous forme de données dans `STORAGE_POLICIES` — "public", "authenticated", "owner" (le segment `:uid` de la clé correspond à l'appelant) et les rôles — voir [Autorisation de stockage](/docs/backend/storage-authorization/#as-data-storage_policies).

**Éjecté (Ejected)** — le bloc `storage` sur `initializeRebaseBackend({ … })`. `storagePolicies` et `storageTriggers` sont réservés au mode éjecté.

La cartographie complète se trouve dans la [Vue d'ensemble du backend](/docs/backend/#where-each-option-lives).
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

Le stockage local conserve les métadonnées de chaque objet à côté de celui-ci, sous la forme `<key>.metadata.json` ; par conséquent, une clé dont le dernier segment se termine par `.metadata.json` est refusée avec l'erreur `400 INVALID_STORAGE_KEY` sur toutes les routes. S3 et GCS conservent les métadonnées sur l'objet et acceptent n'importe quelle clé. Sur un système de fichiers insensible à la casse (macOS et Windows par défaut), `Avatar.png` et `avatar.png` représentent un seul fichier local mais deux objets sur S3, GCS ou un disque Linux ; le serveur émet donc un avertissement au démarrage lorsque le dossier de stockage se trouve sur un tel système.

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

Sur GCP (Cloud Run, GCE, GKE), les identifiants du compte de service par défaut sont utilisés automatiquement. En dehors de GCP, définissez la variable d'environnement `GOOGLE_APPLICATION_CREDENTIALS` avec le chemin d'accès au fichier de clé de votre compte de service.

### Plusieurs backends de stockage

Vous pouvez configurer plusieurs backends nommés et router différents champs vers différents stockages :

```typescript
storage: {
    "(default)": { type: "local", basePath: "./uploads" },
    "media": { type: "s3", bucket: "media-bucket", region: "us-east-1", ... }
}
```

Pointez ensuite une colonne de stockage vers un backend spécifique à l'aide de `source` :

```typescript
image: col.storage({ path: "products/", source: "media" }),  // Routes to the "media" S3 backend
```

## Points de terminaison de stockage

| Méthode | Chemin | Description |
|--------|------|-------------|
| `POST` | `/api/storage/upload` | Téléversement direct de fichier, un corps `multipart/form-data` : `file` (obligatoire) ; `key`, la clé de l'objet, dossiers inclus (`author_pictures/ada.jpg`), sinon le nom du fichier à la racine ; `bucket`, sinon celui par défaut ; `storageId` ; `collection` et `property`, qui restreignent le fichier selon les critères `maxSize` et `acceptedFiles` de cette propriété ; et `metadata_<name>` pour les métadonnées personnalisées. Tout autre champ est ignoré : il n'y a pas de champ `path` |
| `POST` | `/api/storage/upload?storageId=<key>` | Téléversement vers un backend nommé spécifique |
| `GET` | `/api/storage/file/*` | Récupérer un fichier — tout ce qui suit `/file/` est la clé de l'objet |
| `GET` | `/api/storage/file/*?storageId=<key>` | Récupérer un fichier depuis un backend spécifique |
| `GET` | `/api/storage/metadata/*` | Taille, type de contenu et métadonnées personnalisées d'un objet, sans ses octets, ainsi qu'un jeton de téléchargement à courte durée de vie lorsqu'il est privé |
| `POST` | `/api/storage/metadata` | La même chose pour jusqu'à 100 objets d'une même source : corps `{ keys, storageId? }` |
| `DELETE` | `/api/storage/file/*` | Supprimer un fichier |
| `GET` | `/api/storage/list` | Lister les objets sous un préfixe (`prefix`, `bucket`, `maxResults`, `pageToken`, `storageId`). Un `maxResults` inférieur à 1, ou un `pageToken` que la source n'a jamais émis, renvoie `400 INVALID_LIST_OPTIONS` |
| `POST` | `/api/storage/folder` | Créer un marqueur de dossier vide |
| `GET` | `/api/storage/sources` | Les sources de stockage desservies par ce backend, par clé |
| `OPTIONS` | `/api/storage/tus` | Interroger les fonctionnalités supportées du protocole TUS |
| `POST` | `/api/storage/tus` | Initier une session de téléversement TUS avec reprise |
| `HEAD` | `/api/storage/tus/:id` | Vérifier la progression du téléversement (décalage d'octets / byte offset) |
| `PATCH` | `/api/storage/tus/:id` | Ajouter un fragment de données au fichier temporaire |
| `DELETE` | `/api/storage/tus/:id` | Terminer/interrompre une session de téléversement TUS |

**Ce qu'ils retournent.** Une enveloppe unique, identique à celle utilisée par `/api/data` : la charge utile se trouve sous `data`, et un échec est sous la forme `{ "error": { message, code, requestId } }` avec les codes de la [référence des erreurs](/docs/backend/errors/). `/api/storage/file/*` fait exception, car sa charge utile est le fichier lui-même — il renvoie les octets, avec les en-têtes `Content-Type`, `Content-Length` et de mise en cache.

```json
// GET /api/storage/list?prefix=products/images/
{ "data": { "items": [ { "bucket": "default", "fullPath": "products/images/a.jpg", "name": "a.jpg",
  "size": 48213, "updated": "2026-10-01T12:00:00.000Z", "contentType": "image/jpeg" } ], "prefixes": [] } }
```

Un listing décrit chaque fichier retourné : sa taille `size` en octets et `updated`, date de sa dernière écriture, sur le stockage local, S3 et GCS, ainsi que son `contentType` sur le stockage local et GCS. Un listing S3 ne transporte pas le type, il est donc absent sur S3, mais `/api/storage/metadata/*` continue de le fournir. Un dossier dans `prefixes` n'en contient aucun, tout comme un `StorageController` personnalisé qui ne les définirait pas.

`POST /api/storage/upload` renvoie `201` avec les informations `{ key, bucket, storageUrl }` de l'objet stocké sous `data` ;
`GET /api/storage/metadata/*` renvoie les métadonnées de l'objet et, pour un objet privé, le `token` à courte durée de vie ; `POST /api/storage/metadata` renvoie un objet indexé par les chemins qui lui ont été passés, chacun contenant ce que le `GET` aurait renvoyé (voir ci-dessous). Un dossier n'est pas un objet : un appel `/metadata` sur une clé se terminant par `/` renvoie `404` sur tous les stockages, même lorsque S3 ou GCS conserve un marqueur `folder/`, aucun jeton de téléchargement n'est donc émis pour un préfixe ; `GET /api/storage/sources` renvoie le tableau des sources configurées, avec `configured: true`. Sur un déploiement sans aucun stockage configuré, il répond `200 {"data": [], "configured": false}`, tandis que toutes les autres routes renvoient `501 STORAGE_NOT_CONFIGURED`. `GET /api/auth/config` signale la même situation avec `storage: false`, ce qui permet à un client d'éviter de poser la question. `GET /api/storage/sources` est public : il répond sans jeton même lorsque `requireAuth` est activé. Il indique le nom des sources (leur clé, moteur, transport et libellé) et jamais un fichier, et le SDK client le lit pour initialiser ses sources, ce qui peut se produire avant que quiconque ne soit connecté. Une application lisant une source `direct` de manière anonyme en a également besoin. Toutes les routes qui listent, lisent ou écrivent un fichier conservent leur authentification. `DELETE /api/storage/file/*` et `POST /api/storage/folder` ne transportent qu'un `message`, puisqu'il n'y a rien à retourner.

Sur S3 et GCS, un `bucket` doit être l'un de ceux desservis par la source, en écriture comme en lecture : un téléversement, un `POST /api/storage/folder` ou un téléversement TUS désignant tout autre bucket renvoie `404 UNKNOWN_STORAGE_SOURCE`, tout comme le listing. Le stockage local crée toujours un bucket lors de sa première écriture.

**Plusieurs objets à la fois.** `POST /api/storage/metadata` prend en entrée `{ "keys": ["photos/a.png", "photos/b.png"], "storageId": "media" }` — jusqu'à 100 chemins d'objets d'une même source, chacun écrit de la même façon que ce qu'attend `GET /api/storage/metadata/<key>` — et renvoie une entrée par clé :

```json
{ "data": {
  "photos/a.png": { "fullPath": "photos/a.png", "size": 48213, "contentType": "image/png", "token": "…", "tokenExpiresIn": 300 },
  "photos/b.png": { "error": { "code": "FORBIDDEN", "message": "Not authorized for this object", "status": 403 } }
} }
```

Chaque clé est évaluée exactement comme le ferait le `GET` — avec le même hook `storageAuthorize` et la même portée de stockage, la même règle publique, son propre jeton de téléchargement — et une clé refusée, manquante ou malformée renvoie sa propre `error` sans faire échouer ni divulguer les autres. Un appelant sans session dans un déploiement qui en exige une recevra le `401` que le `GET` aurait renvoyé, à moins que toutes les clés ne soient publiques. Plus de 100 clés, ou un corps sans `keys`, renvoie `400 BAD_REQUEST`. Le limiteur de débit compte la requête comme ⌈N/10⌉ requêtes pour N clés ; ainsi, une page de 100 miniatures coûte 10 requêtes. `client.storage.getSignedUrl()` et le panneau d'administration regroupent les recherches effectuées par une page de cette manière, et basculent vers un `GET` par fichier sur un serveur ne disposant pas de cette route.

**Comment une lecture de fichier est autorisée.** Les routes de lecture — `/api/storage/file/*` et `/api/storage/metadata/*` — attendent le jeton signé à courte durée de vie généré par [`getSignedUrl()`](/docs/sdk/storage), passé sous la forme `?token=<token>` ou en tant qu'en-tête `Bearer`. Un JWT d'accès ordinaire est **refusé** sur `/file/*` avec l'erreur `401 Unauthorized: Access JWT not allowed on file routes` : le jeton qui fonctionne sur toutes les autres routes ne fonctionne pas ici, à dessein, car une URL de fichier est destinée à être transmise à un navigateur, un CDN ou une balise `<img>`. Toutes les autres lignes ci-dessus acceptent le JWT d'accès comme d'habitude.

## Transformations d'images à la volée

Rebase intègre un pipeline de traitement d'images optimisé par **Sharp**. Lorsque vous servez des images depuis le stockage, vous pouvez appliquer des opérations dynamiques à l'aide de paramètres de requête :

```bash
# Serve image scaled to 300px width in webp format
GET /api/storage/file/products/laptop.jpg?width=300&format=webp
```

### Paramètres pris en charge

- `width`, `height` : Limites de redimensionnement, `1`–`4096` (l'image n'est jamais agrandie).
- `quality` : `1`–`100`.
- `format` : Convertit le format de l'image. Formats pris en charge : `webp`, `jpeg`, `png`, `avif`.
- `fit` : `cover`, `contain`, `fill`, `inside` ou `outside`.

Un paramètre hors de ces limites produit une erreur **400**, et non une valeur tronquée silencieusement — auparavant, `?width=99999` renvoyait une image de 4096px et `?format=tiff` une image webp, sans avertissement.

Les aperçus d'images stockées dans le panneau d'administration utilisent ce point de terminaison : un affichage en tableau ou en carte demande un rendu webp d'environ deux fois sa taille d'affichage (96–800px) plutôt que l'original. Les fichiers SVG et GIF sont toujours affichés tels quels.
`sharp` est optionnel : sans lui, une requête de transformation renvoie l'original, et le backend avertit une seule fois d'exécuter `pnpm add sharp` dans `backend/`.

### Performance et mise en cache LRU

La transformation consomme beaucoup de CPU et de mémoire, et sur un objet public, le point de terminaison est accessible anonymement ; le travail est donc borné plutôt que simplement mis en cache :
- **Capacité** : un cache LRU limité globalement à **500 entrées**, indexé par source de stockage, bucket et clé canonique.
- **TTL (Time to Live)** : Les variantes mises en cache expirent après **1 heure**.
- Des requêtes simultanées pour une même variante non mise en cache génèrent **une seule** transformation, et non une par requête.
- Un nombre restreint de transformations s'exécute simultanément ; au-delà d'une file d'attente limitée, le serveur répond **503 `TRANSFORM_OVERLOADED`** plutôt que d'accepter un travail qu'il ne pourra pas traiter.

Ce cache réside en mémoire dans le processus, ce qui signifie qu'il n'est pas partagé entre les instances et ne survit pas à un redémarrage. Deux réplicas recalculeront chacun chaque variante, et un déploiement efface l'intégralité du cache.

### Rendus qui survivent à un redémarrage

`storageRenditionCache` réécrit chaque image dérivée dans le même bucket que sa source, de sorte que le travail est effectué une seule fois pour l'ensemble du déploiement plutôt qu'une fois par instance et par version :

```ts
storageRenditionCache: { enabled: true }
```

ou `STORAGE_RENDITION_CACHE=true` pour un déploiement sous forme de bundle. Les rendus sont stockés sous le préfixe réservé `_rebase/renditions/`, indexés par la version de l'objet source — remplacer une image permet donc de servir immédiatement la nouvelle version.

Trois choses à savoir avant de l'activer :

- **Une lecture effectue désormais une écriture.** Chaque nouvelle variante coûte un `PUT` dans votre bucket. Cette option est désactivée par défaut pour cette raison.
- **Un échec d'écriture n'est pas un échec de requête.** Des identifiants en lecture seule, ou une politique de bucket refusant le préfixe, basculent sur le cache en mémoire ; l'image est toujours servie et la raison est consignée une seule fois dans les journaux.
- **Les rendus obsolètes ne sont pas nettoyés.** Le remplacement d'un objet source abandonne ses anciens rendus. Définissez une règle de cycle de vie sur `_rebase/renditions/` — ce préfixe est fixe et non configurable, précisément pour qu'une règle puisse le cibler.

Le préfixe n'est pas accessible depuis l'API. Le lire ou y écrire directement renvoie **400 `INVALID_STORAGE_KEY`** : toutes les règles d'accès du produit — qu'il s'agisse de `storageAuthorize` ou des politiques déclaratives — sont définies par rapport à la clé *source*, et un rendu servi sous son propre chemin répondrait à une demande non formulée.

`_rebase/maintenance/` est réservé de la même manière. `rebase storage orphans` y conserve l'enregistrement de chaque analyse, au sein de la source analysée, afin que le processus qui exécute l'analyse et celui qui renvoie son état lisent le même enregistrement. Un appelant capable d'écrire un enregistrement pourrait choisir ce qu'une suppression ultérieure élimine ; lire, écrire ou lister ce préfixe renvoie donc également une erreur 400. Les enregistrements sont supprimés 7 jours après leur dernière écriture, au moment où débute l'analyse suivante de cette source.

### Ce qui est servi

Le type de contenu stocké correspond à ce que l'expéditeur a déclaré — rien n'analyse les octets — ainsi `/api/storage/file/*` n'affiche en ligne qu'une **liste blanche stricte** : images, vidéo, audio, `application/pdf` et `text/plain`. Tout le reste, y compris `text/html`, est servi sous forme de `application/octet-stream` avec l'en-tête `Content-Disposition: attachment`, et chaque réponse comporte l'en-tête `X-Content-Type-Options: nosniff`. Le stockage n'est pas un hébergeur web : une page téléversée et affichée sur l'origine de l'API pourrait lire les cookies de cette origine et appeler ses points de terminaison.

Un SVG est une image qui est également un document et peut contenir du code `<script>`. Il est servi en tant que `image/svg+xml` — pour qu'il puisse s'afficher dans une balise `<img>` et dans les miniatures du panneau d'administration — avec `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` sur chaque réponse, y compris sur les URL transformées et les URL avec jeton de téléchargement. Lorsqu'il est ouvert directement, il s'affiche avec les scripts désactivés et une origine opaque, l'empêchant d'accéder aux cookies ou aux points de terminaison de l'API.

## Limite de taille de fichier

Chaque source de stockage accepte des fichiers dans la limite qui lui est propre : **50 Mo** sauf si `STORAGE_MAX_FILE_SIZE` (en octets, suffixé par `__<KEY>` pour une source nommée) ou le paramètre `maxFileSize` de la source n'en dispose autrement. Chaque point d'entrée applique cette même limite. `POST /api/storage/upload` renvoie `413 PAYLOAD_TOO_LARGE` en cas de dépassement ; un téléversement avec reprise est refusé dès sa création, avant son premier segment ; et `OPTIONS /api/storage/tus` l'annonce via `Tus-Max-Size` — pour la source désignée par `?storageId=`, ou pour celle par défaut le cas échéant.

```bash
STORAGE_MAX_FILE_SIZE=209715200          # (default): 200 MB
STORAGE_MAX_FILE_SIZE__MEDIA=1073741824  # media: 1 GB
```

La quantité de données d'un fichier que le serveur garde simultanément en mémoire dépend du point d'entrée. `POST /api/storage/upload` représente un corps multipart unique, analysé intégralement par le serveur : soit trois à cinq fois la taille du fichier en mémoire. Un téléversement avec reprise (TUS) ne conserve qu'un segment à la fois. `client.storage.putObject()` et le panneau d'administration transmettent les fichiers de plus de 8 Mio via le protocole avec reprise. Consultez la section [Téléversements avec reprise (TUS)](/docs/backend/storage-resumable-uploads/) pour découvrir le protocole, ses réponses et son comportement entre plusieurs instances.

## Variables d'environnement

<span class="since-badge" data-since="0.35">Depuis la version 0.35</span>

| Variable | Description |
|----------|-------------|
| `STORAGE_TYPE` | `"local"`, `"s3"`, ou `"gcs"` |
| `STORAGE_PATH` | Répertoire de stockage local (par défaut : `<project>/uploads`, sous `rebase dev` ainsi que dans un serveur généré par `rebase eject`). Un chemin relatif est résolu depuis le répertoire d'exécution du serveur, qui correspond à `backend/` après un `rebase eject`. Un bucket local nommé conserve ses fichiers à proximité, dans `<STORAGE_PATH>__<key>`, à moins que `STORAGE_PATH__<KEY>` n'en définisse un spécifique |
| `S3_BUCKET` | Nom du bucket S3 |
| `S3_REGION` | Région AWS (par défaut : `"auto"`) |
| `S3_ACCESS_KEY_ID` | Clé d'accès AWS |
| `S3_SECRET_ACCESS_KEY` | Clé secrète AWS |
| `S3_ENDPOINT` | Point de terminaison S3 personnalisé (pour MinIO, R2) |
| `S3_FORCE_PATH_STYLE` | Utiliser des URL de type chemin (requis pour MinIO) |
| `GCS_BUCKET` | Nom du bucket Google Cloud Storage |
| `GCS_PROJECT_ID` | ID de projet GCP pour GCS |
| `GCS_KEY_FILENAME` | Chemin vers un fichier de clé de compte de service GCP (à omettre sur GKE — Workload Identity/ADC fournit les identifiants) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Variable ADC standard, lue directement par le SDK Google (inutile sur GCP avec les identifiants par défaut) |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Durée de validité de l'URL de téléchargement d'un fichier privé, en secondes — durée de vie du jeton généré par `/api/storage/metadata/*` (par défaut `300`, au maximum `604800`, soit une semaine). Augmentez cette valeur pour les flux vidéo et audio privés, qui continuent de requérir des plages d'octets après le rendu de la page. Équivalent variable d'environnement de `storageDownloadTokenTtl` |
| `STORAGE_MAX_FILE_SIZE` | Taille maximale de fichier acceptée par la source, en octets (par défaut `52428800`, soit 50 Mo). Ajoutez le suffixe `__<KEY>` pour une source nommée. Une valeur qui n'est pas un nombre entier d'octets empêche le démarrage. Voir [Limite de taille de fichier](#limite-de-taille-de-fichier) |
| `FORCE_LOCAL_STORAGE` | Autoriser `STORAGE_TYPE=local` en production — voir ci-dessous |
| `STORAGE_PUBLIC_READ` | Servir les objets stockés aux lecteurs non authentifiés. Équivalent variable d'environnement de `storagePublicRead`, et l'un des trois moyens de satisfaire le [contrôle de démarrage en production](#autorisation-par-objet). |
| `STORAGE_POLICIES` | Règles d'accès au stockage au format JSON : `[{ "path", "operations"?, "allow" }]`, `allow` prenant la valeur `"public"`, `"authenticated"`, `"owner"` ou `{ "roles": [...] }`. Refus par défaut ; satisfait le [contrôle de démarrage en production](#autorisation-par-objet). Une liste invalide bloque le démarrage. Voir [Autorisation de stockage](/docs/backend/storage-authorization/#as-data-storage_policies). |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Désactive le contrôle de démarrage, rétablissant le comportement où tout utilisateur connecté peut lire, écraser, supprimer ou lister n'importe quelle clé. Équivalent variable d'environnement de `storageInsecureAllowAnyAuthenticated`. Uniquement justifiable si chaque utilisateur connecté a toute légitimité pour accéder à chaque fichier. |

## Plusieurs buckets

Un projet peut disposer de plusieurs buckets. Déclarez chacun d'eux dans `backend/resources.ts` — l'emplacement unique lu par la plateforme, le runtime et la console :

```ts
import { bucket } from "@rebasepro/types";

export const uploads = bucket({ engine: "s3" });    // the default one
export const media = bucket("media", { engine: "s3", label: "Media" });
```

Exécutez ensuite `rebase resources --write`, qui régénère `rebase.resources.json` afin qu'un hébergeur puisse lire votre topologie sans exécuter de build. Voir [Sources multiples](/docs/backend/multiple-sources) pour la gestion conjointe des bases de données, des buckets et des topics.

Chaque source est configurée à partir des **mêmes noms de variables portant son propre suffixe**. La source par défaut n'utilise aucun suffixe, un projet à bucket unique conserve donc les noms simples présentés ci-dessus sans rien devoir déclarer, et l'ajout de buckets nommés à ses côtés n'altère pas ces variables ([détails](/docs/backend/multiple-sources/#which-bucket-receives-an-unqualified-upload)) :

```bash
S3_BUCKET=app-uploads             # (default)
S3_BUCKET__MEDIA=app-media        # media
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

Le suffixe dérive de la clé : converti en majuscules, les caractères non alphanumériques sont remplacés par des tirets bas, précédé d'un **double** tiret bas (`media-cdn` → `__MEDIA_CDN`). Un tiret bas simple entrerait en collision avec des variables réelles — `S3_BUCKET_NAME` serait interprété comme le bucket `name`.

Associez une colonne à une source via `source` :

```ts
cover: col.storage({ path: "covers/", source: "media", accept: ["image/*"] }),
```

Une source déclarée mais jamais configurée est **ignorée**, ce qui n'est pas fatal : les téléversements qui lui sont assignés renvoient `501 STORAGE_SOURCE_NOT_CONFIGURED`. La déclaration d'un bucket survient généralement avant qu'un stockage n'y soit rattaché, et une erreur bloquante au démarrage provoquerait une boucle de crash du backend jusqu'à sa configuration. Une source que l'environnement configure de manière **incorrecte** — un type sans bucket, ou un bucket sans identifiants — est refusée au démarrage, s'agissant d'une erreur et non d'une simple omission.

### Buckets partageant un même compte

Les identifiants décrivent généralement le **fournisseur**, et non le bucket. Quinze buckets sur une même instance MinIO impliqueraient sinon quinze copies de la même clé d'accès, et une rotation nécessiterait quinze modifications conjointes. Désignez plutôt un compte :

```ts
export const media = bucket("media", { engine: "s3", account: "minio" });
export const avatars = bucket("avatars", { engine: "s3", account: "minio" });
```

```bash
S3_BUCKET__MEDIA=b-media          # per bucket, always
S3_BUCKET__AVATARS=b-avatars
S3_ACCESS_KEY_ID__MINIO=…         # shared by both
S3_SECRET_ACCESS_KEY__MINIO=…
S3_ENDPOINT__MINIO=https://minio.internal
```

Seules les variables associées au compte s'appliquent en secours — `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`, `S3_FORCE_PATH_STYLE`, ainsi que la paire GCS `GCS_PROJECT_ID` / `GCS_KEY_FILENAME`. Le nom du bucket n'est jamais mutualisé : c'est lui qui distingue une source d'une autre. Une valeur définie par bucket reste toujours prioritaire, ce qui permet à une source de migrer de fournisseur sans perturber les autres.

### Nettoyage planifié des fichiers orphelins

La suppression d'une ligne laisse ses fichiers dans le bucket. Rien n'est supprimé avec la ligne : une autre ligne, une version de l'[historique](/docs/backend/history/), ou votre propre code conservant la clé dans une simple chaîne de caractères peuvent encore référencer le fichier. Un bucket peut configurer un nettoyage qui inspecte tous ces éléments :

```ts
export const voice = bucket("voice", { engine: "s3", orphanSweep: { olderThanHours: 72 } });
export const media = bucket("media", { orphanSweep: true }); // a week, daily at 04:17 UTC
```

Chaque balayage déclaré constitue une tâche cron, nommée `storage-orphan-sweep-<bucket>` (`storage-orphan-sweep-default` pour le bucket par défaut). Elle exécute l'analyse sous-jacente à `rebase storage orphans --delete`. Cette analyse parcourt chaque ligne de chaque table ainsi que chaque entrée d'historique, et conserve :

- un fichier qui demeure référencé par un quelconque élément ;
- un fichier plus récent que `olderThanHours` (au minimum 24 heures, une semaine par défaut) ;
- tous les fichiers, lors de cette exécution, si une table ne peut pas être lue.

Elle vérifie ensuite une nouvelle fois chaque fichier juste avant de procéder à sa suppression. Définissez `schedule` avec une expression cron (UTC) pour modifier sa fréquence d'exécution. S'agissant d'une tâche cron, elle s'exécute sur une seule instance par intervalle. L'historique d'exécution consigne le nombre de fichiers supprimés et conservés, et le traitement peut être suspendu ou déclenché manuellement depuis la liste cron de l'administration. Elle requiert un bucket pris en charge par ce backend : un bucket avec `transport: "direct"` est refusé au démarrage avec un avertissement.

## Sources de stockage frontend

Le frontend découvre les sources du serveur via `GET /api/storage/sources`, une source de type `server` n'a donc pas besoin d'entrée spécifique. Passez `storageSources` au fournisseur `<Rebase>` pour une source de type `direct`, qui téléverse directement vers son fournisseur, ou pour définir vous-même un libellé ou un transport :

```tsx
import { Rebase } from "@rebasepro/app";

<Rebase
    apiUrl="https://api.example.com"
    storageSources={[
        // `engine` names the provider, `transport` says who talks to it:
        // "server" proxies through the Rebase backend, "direct" goes
        // client-to-provider (and needs a `source` implementation).
        { key: "media", engine: "s3", transport: "server", label: "Media CDN" },
        { key: "firebase", engine: "firebase", transport: "server", label: "Firebase Storage" },
    ]}
>
    {() => <MyApp />}
</Rebase>
```

La `key` d'une source `server` doit correspondre à une clé backend enregistrée dans la configuration `storage` du serveur. Le contexte React `StorageSourcesContext` résout la source active pour chaque champ de téléversement.

## Mise en cache et CDN

Chaque objet transite par le serveur avec un `ETag` facilitant la revalidation, un en-tête `Cache-Control` adapté aux autorisations de lecture, et la prise en charge des plages d'octets (byte ranges) pour la lecture audio et vidéo. Consultez la documentation [Mise en cache du stockage et CDN](/docs/backend/storage-caching/) pour le détail des en-têtes et les recommandations de configuration d'un CDN en amont.

## Conseils pour la production

:::caution
**En production, `type: "local"` désactive le stockage de fichiers au lieu de l'utiliser.** Sur une plateforme éphémère (Cloud Run, Heroku, un pod Kubernetes), le système de fichiers est réinitialisé à chaque déploiement, redémarrage ou éviction — ainsi, les téléversements réussiraient, la lecture fonctionnerait, mais tout disparaîtrait au déploiement suivant, sans générer d'erreur.

C'est pourquoi la configuration locale par défaut n'est pas enregistrée, et une requête vers `/api/storage/*` ne ciblant aucune source de stockage renvoie **`501 STORAGE_NOT_CONFIGURED`**, en indiquant les sources actives. Une source nommée et configurée, telle que `bucket("media", { engine: "s3" })`, continue d'assurer le service. Les téléversements échouent de manière explicite et récupérable ; le reste de l'application continue de fonctionner. Le stockage de fichiers nécessite une activation explicite en production : il n'est opérationnel que dès lors qu'un bucket existe.

Définissez `STORAGE_TYPE=s3` ou `gcs`. Si un **volume persistant** héberge réellement `STORAGE_PATH`, spécifiez `FORCE_LOCAL_STORAGE=true` pour le confirmer explicitement. Montez-le sur le répertoire parent de `STORAGE_PATH`, de manière à ce que le dossier `<STORAGE_PATH>__<key>` de chaque bucket local nommé s'y trouve également.
:::

- Montez un **volume persistant** sur le parent de `STORAGE_PATH` si vous utilisez le stockage local sur Docker/Kubernetes, et définissez `FORCE_LOCAL_STORAGE=true` — voir [Auto-hébergement](/docs/deployment/self-hosting/#file-storage)
- Utilisez **S3** ou un service compatible (R2, MinIO), ou **GCS**, pour les déploiements en production
- Configurez un **CDN** (CloudFront, Cloudflare) en façade pour des performances optimales — voir [Mettre un CDN en façade](/docs/backend/storage-caching/#putting-a-cdn-in-front)
- **Toute application utilisant du stockage en production doit déclarer un modèle d'accès** — voir [Autorisation de stockage](/docs/backend/storage-authorization/). Cela ne concerne pas uniquement les environnements multi-locataires : le serveur *refuse de démarrer* en l'absence de configuration d'accès.

## Autorisation par objet

Les permissions de lecture, écriture, suppression ou listage pour chaque clé sont déterminées par `storagePolicies` et le hook `storageAuthorize`, tandis qu'une clé d'API doit également détenir la portée (scope) de stockage requise pour l'opération. En production, le serveur refuse de démarrer avec du stockage sans modèle d'accès défini. Voir [Autorisation de stockage](/docs/backend/storage-authorization/).

## Réagir à un téléversement

Toutes les autres opérations d'écriture dans Rebase permettent d'interagir par événement — une ligne dispose de `beforeSave` et `afterSave`, une planification s'appuie sur une tâche cron — alors qu'un téléversement ne proposait rien de tel. Toute action consécutive à un téléversement devait être initiée par le client lors d'un second appel, ce qui entraînait des ruptures si le client se déconnectait entre-temps.

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

La syntaxe des motifs est identique à celle de `storagePolicies` — des segments littéraux, `*` pour un segment unique, `:name` pour en capturer un, `**` pour le reste — et un motif mal formé bloque le démarrage au lieu d'échouer silencieusement.

| Événement | Moment d'exécution |
| --- | --- |
| `finalize` | après l'écriture durable de l'objet ; jamais pour une écriture ayant échoué |
| `delete` | après la suppression effective de l'objet |

`finalize` se déclenche aussi bien pour les téléversements multipart que pour ceux avec reprise (TUS) — une seule fois par fichier, et non à chaque bloc — et un téléversement avec reprise identifie l'utilisateur qui l'a *créé*, ce dernier correspondant à l'entité validée lors de l'autorisation.

Hypothèses qu'un gestionnaire (handler) ne doit pas formuler :

- **Une exception levée dans un gestionnaire ne fait pas échouer la requête.** L'objet est déjà persisté au moment de son exécution ; retourner une erreur au client indiquerait un échec du téléversement qui n'a pas eu lieu, poussant les clients à réémettre l'envoi. Les erreurs sont journalisées et la réponse reste inchangée. Si le traitement est critique, placez-le dans une file d'attente (queue).
- **Les gestionnaires sont attendus avec `await`**, dans l'ordre de leur déclaration, avant l'envoi de la réponse — ignorer la promesse ("fire and forget") risquerait de voir son exécution gelée en environnement serverless. Un gestionnaire lent ralentit donc le téléversement, ce qui constitue une raison supplémentaire de déléguer la charge à une file d'attente.
- **Les écritures internes ne déclenchent pas de triggers.** Le cache de rendus d'images écrit les objets dérivés directement auprès du contrôleur de stockage ; un déclencheur `**` réagissant à ces écritures bouclerait sur sa propre production.

## Prochaines étapes

- **[Stockage Frontend et Téléversements de fichiers](/docs/frontend/storage)** — Champs et hooks de téléversement de fichiers
- **[Colonnes](/docs/schema/columns/#storage-columns)** — `col.storage()` et ses options
