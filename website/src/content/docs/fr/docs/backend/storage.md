---
sourceHash: 5be4e3768bac692e
title: Configuration du stockage
sidebar_label: Configuration du stockage
description: Configurez les backends de stockage sur système de fichiers local, compatible S3 ou GCS/Firebase Storage pour les téléversements de fichiers, les images et les médias.
---

## Vue d'ensemble

Rebase prend en charge trois backends de stockage :

- **Système de fichiers local** — Fichiers stockés sur disque (idéal pour le développement)
- **Compatible S3** — AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces
- **Google Cloud Storage / Firebase Storage** — Prise en charge native de GCS via `@google-cloud/storage`

## Configuration

:::note[Où cela se place]
**Runtime managé** — les variables `STORAGE_*` dans `.env` (`STORAGE_TYPE`, `STORAGE_BUCKET` ou `S3_BUCKET` / `GCS_BUCKET`, `STORAGE_PATH`, `STORAGE_PUBLIC_READ`, … — suffixez n'importe laquelle d'entre elles avec `__<KEY>` pour une source nommée), plus une déclaration `bucket("<key>")` dans `config/resources.ts` pour chaque bucket au-delà de celui par défaut, et `export const storageAuthorize` depuis `config/index.ts`. `storageAuthorize` n'a volontairement aucune forme sous forme de variable d'environnement : aucune variable ne peut exprimer « cet utilisateur peut lire cette clé ».

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

Le stockage local conserve les métadonnées de chaque objet à côté de celui-ci, sous la forme `<key>.metadata.json` ; ainsi, une clé dont le dernier segment se termine par `.metadata.json` est refusée avec `400 INVALID_STORAGE_KEY` sur toutes les routes. S3 et GCS conservent les métadonnées sur l'objet et stockent n'importe quelle clé. Sur un système de fichiers insensible à la casse (macOS et Windows par défaut), `Avatar.png` et `avatar.png` représentent un seul fichier local mais deux objets sur S3, GCS ou un disque Linux ; le serveur émet donc un avertissement au démarrage lorsque le dossier de stockage se trouve sur un tel système.

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

Sur GCP (Cloud Run, GCE, GKE), les identifiants du compte de service par défaut sont utilisés automatiquement. En dehors de GCP, définissez la variable d'environnement `GOOGLE_APPLICATION_CREDENTIALS` avec le chemin vers votre fichier de clé de compte de service.

### Multiples backends de stockage

Vous pouvez configurer plusieurs backends nommés et router différents champs vers différents stockages :

```typescript
storage: {
    "(default)": { type: "local", basePath: "./uploads" },
    "media": { type: "s3", bucket: "media-bucket", region: "us-east-1", ... }
}
```

Ensuite, dans les propriétés de votre collection, référencez un backend spécifique :

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

## Points de terminaison de stockage

| Méthode | Chemin | Description |
|--------|------|-------------|
| `POST` | `/api/storage/upload` | Téléversement direct de fichier |
| `POST` | `/api/storage/upload?storageId=<key>` | Téléversement vers un backend nommé spécifique |
| `GET` | `/api/storage/file/*` | Récupérer un fichier — tout ce qui suit `/file/` est la clé de l'objet |
| `GET` | `/api/storage/file/*?storageId=<key>` | Récupérer un fichier depuis un backend spécifique |
| `GET` | `/api/storage/metadata/*` | Taille, type de contenu et métadonnées personnalisées d'un objet, sans ses octets, plus un jeton de téléchargement à courte durée de vie lorsqu'il est privé |
| `POST` | `/api/storage/metadata` | <span class="since-badge" data-since="0.25">Depuis la version 0.25</span> La même chose pour un maximum de 100 objets d'une même source : corps `{ keys, storageId? }` |
| `DELETE` | `/api/storage/file/*` | Supprimer un fichier |
| `GET` | `/api/storage/list` | Lister les objets sous un préfixe (`prefix`, `bucket`, `maxResults`, `pageToken`, `storageId`). Un `maxResults` inférieur à 1, ou un `pageToken` jamais émis par la source, renvoie `400 INVALID_LIST_OPTIONS` |
| `POST` | `/api/storage/folder` | Créer un marqueur de dossier vide |
| `GET` | `/api/storage/sources` | Les sources de stockage desservies par ce backend, par clé |
| `OPTIONS` | `/api/storage/tus` | Interroger les fonctionnalités supportées du protocole TUS |
| `POST` | `/api/storage/tus` | Initier une session de téléversement TUS avec reprise |
| `HEAD` | `/api/storage/tus/:id` | Vérifier la progression du téléversement (décalage en octets) |
| `PATCH` | `/api/storage/tus/:id` | Ajouter un fragment de données au fichier temporaire |
| `DELETE` | `/api/storage/tus/:id` | Terminer/interrompre la session de téléversement TUS |

**Ce qu'ils renvoient.** Une enveloppe unique, identique à celle utilisée par `/api/data` : la charge utile
se trouve sous `data`, et un échec est sous la forme `{ "error": { message, code, requestId } }`
avec les codes listés dans la [référence des erreurs](/docs/backend/errors/). `/api/storage/file/*`
est l'exception, car sa charge utile est le fichier lui-même — il renvoie les octets, avec
`Content-Type`, `Content-Length` et les en-têtes de mise en cache.

```json
// GET /api/storage/list?prefix=products/images/
{ "data": { "items": [ { "bucket": "default", "fullPath": "products/images/a.jpg", "name": "a.jpg",
  "size": 48213, "updated": "2026-10-01T12:00:00.000Z", "contentType": "image/jpeg" } ], "prefixes": [] } }
```

<span class="since-badge" data-since="0.25">Depuis la version 0.25</span> Un listing décrit chaque fichier retourné : sa taille `size` en octets et
`updated`, date de sa dernière écriture, sur le stockage local, S3 et GCS, ainsi que son
`contentType` sur le stockage local et GCS. Un listing S3 ne transporte pas le type,
il est donc absent sur S3 et `/api/storage/metadata/*` continue de le fournir. Un dossier dans
`prefixes` n'en transporte aucun, tout comme un `StorageController` personnalisé qui
ne les définit pas.

`POST /api/storage/upload` renvoie `201` avec `{ key, bucket, storageUrl }` de l'objet stocké sous `data` ;
`GET /api/storage/metadata/*` renvoie les métadonnées de l'objet et, pour un objet privé, le `token` à courte durée de vie ; `POST
/api/storage/metadata` renvoie un objet indexé par les chemins reçus, chacun contenant ce que le `GET` aurait répondu
(voir ci-dessous). Un dossier n'est pas un objet : `/metadata` sur une clé se terminant par `/` renvoie `404` sur tous les stockages, même là où S3
ou GCS conserve un marqueur `folder/`, aucun jeton de téléchargement n'est donc émis pour un préfixe ; `GET /api/storage/sources` renvoie le tableau des
sources configurées, avec `configured: true`. Sur un déploiement sans aucun stockage configuré, il répond `200 {"data": [],
"configured": false}`, tandis que toutes les autres routes renvoient `501 STORAGE_NOT_CONFIGURED`. `GET /api/auth/config` signale
ce même état avec `storage: false`, permettant ainsi à un client d'éviter de poser la question. `GET /api/storage/sources` est public : il répond
sans jeton même lorsque `requireAuth` est activé. Il énumère les sources (leur clé, moteur, transport et libellé) et jamais
un fichier, et le SDK client le lit pour initialiser ses sources, ce qui peut se produire avant toute authentification. Une application qui
lit anonymement une source `direct` en a également besoin. Chaque route qui liste, lit ou écrit un fichier conserve son authentification.
`DELETE /api/storage/file/*` et `POST /api/storage/folder` ne transmettent qu'un `message`, puisqu'il n'y a rien à retourner.

Sur S3 et GCS, un `bucket` doit faire partie de ceux desservis par la source, tant en écriture
qu'en lecture : un téléversement, un `POST /api/storage/folder` ou un téléversement TUS désignant tout autre
bucket répond `404 UNKNOWN_STORAGE_SOURCE`, tout comme le listing. Le stockage local
crée quant à lui toujours un bucket lors de sa première écriture.

**Plusieurs objets à la fois.** <span class="since-badge" data-since="0.25">Depuis la version 0.25</span> `POST /api/storage/metadata` accepte
`{ "keys": ["photos/a.png", "photos/b.png"], "storageId": "media" }` — jusqu'à 100
chemins d'objets d'une même source, chacun formaté comme `GET /api/storage/metadata/<key>`
le requiert — et renvoie une entrée par clé :

```json
{ "data": {
  "photos/a.png": { "fullPath": "photos/a.png", "size": 48213, "contentType": "image/png", "token": "…", "tokenExpiresIn": 300 },
  "photos/b.png": { "error": { "code": "FORBIDDEN", "message": "Not authorized for this object", "status": 403 } }
} }
```

Chaque clé est évaluée exactement comme le ferait le `GET` — le même hook
`storageAuthorize` et portée de stockage, la même règle publique, son propre jeton de téléchargement — et une
clé refusée, manquante ou mal formée répond avec sa propre `error` sans faire échouer
ni révéler les autres. Un appelant sans session sur un déploiement qui en exige
une reçoit le code `401` que le `GET` aurait renvoyé, sauf si toutes les clés sont publiques. Plus de
100 clés, ou un corps sans `keys`, renvoie `400 BAD_REQUEST`. Le limiteur de débit (rate limiter) comptabilise
la requête comme ⌈N/10⌉ requêtes pour N clés, ainsi une page de 100 miniatures en coûte 10.
`client.storage.getSignedUrl()` et le panneau d'administration regroupent ainsi les résolutions d'une page
de cette façon, et basculent sur un `GET` par fichier sur un serveur dépourvu de cette
route.

**Comment une lecture de fichier est autorisée.** Les routes de lecture — `/api/storage/file/*` et
`/api/storage/metadata/*` — acceptent le jeton signé à courte durée de vie émis par
[`getSignedUrl()`](/docs/sdk/storage), transmis via `?token=<token>` ou en tant que
`Bearer`. Un JWT d'accès ordinaire est **refusé** sur `/file/*` avec `401
Unauthorized: Access JWT not allowed on file routes` : le jeton fonctionnant sur
toutes les autres routes ne fonctionne volontairement pas ici, car une URL de fichier est
destinée à être transmise à un navigateur, un CDN ou une balise `<img>`. Toutes les autres lignes ci-dessus
acceptent le JWT d'accès comme d'habitude.

## Transformations d'images à la volée

Rebase inclut un pipeline de traitement d'images intégré propulsé par **Sharp**. Lors de la distribution de ressources images depuis le stockage, vous pouvez appliquer des opérations dynamiques via des paramètres d'URL :

```bash
# Serve image scaled to 300px width in webp format
GET /api/storage/file/products/laptop.jpg?width=300&format=webp
```

### Paramètres pris en charge

- `width`, `height` : Limites de redimensionnement, `1`–`4096` (l'image n'est jamais agrandie).
- `quality` : `1`–`100`.
- `format` : Convertit le format de l'image. Formats supportés : `webp`, `jpeg`, `png`, `avif`.
- `fit` : `cover`, `contain`, `fill`, `inside` ou `outside`.

Un paramètre en dehors de ces limites renvoie un **400**, et non une valeur discrètement tronquée —
`?width=99999` renvoyait auparavant une image de 4096px et `?format=tiff` du webp, sans
qu'aucun message ne le signale.

Les miniatures d'images stockées dans le panneau d'administration utilisent ce point de terminaison : un aperçu
sous forme de tableau ou de carte demande un rendu webp environ deux fois supérieur à sa taille affichée (96–800px)
plutôt que l'original. Les fichiers SVG et GIF sont toujours affichés tels quels.
`sharp` est facultatif : <span class="since-badge" data-since="0.25">Depuis 0.25</span>
sans lui, une demande de transformation reçoit l'original, et le backend avertit une fois de
lancer `pnpm add sharp` dans `backend/` (en 0.24, elle répond 500, et le panneau affiche les originaux).

### Performance et mise en cache LRU

La transformation consomme beaucoup de CPU et de mémoire, et sur un objet public, le point de terminaison est
accessible de manière anonyme, de sorte que le travail est encadré plutôt que simplement mis en cache :
- **Capacité** : un LRU plafonné à **500 entrées** globalement, indexé par source
  de stockage, bucket et clé canonique.
- **TTL (Time to Live)** : Les variantes mises en cache expirent après **1 heure**.
- Les requêtes concurrentes pour une même variante non mise en cache produisent **une seule** transformation,
  et non une chacune.
- Un nombre restreint de transformations s'exécute simultanément ; au-delà d'une file d'attente délimitée, le serveur
  répond **503 `TRANSFORM_OVERLOADED`** plutôt que d'accepter un travail qu'il ne pourra
  pas traiter.

Ce cache réside dans le processus, ce qui signifie qu'il n'est pas partagé entre les instances
et ne survit pas à un redémarrage. Deux réplicas calculeront chacun chaque variante, et un
déploiement invalidera l'intégralité du cache.

### Rendus persistant après un redémarrage

`storageRenditionCache` réécrit chaque image dérivée dans le même bucket que sa
source, ainsi le travail est effectué une seule fois pour l'ensemble du déploiement plutôt qu'une fois par
instance et par version :

```ts
storageRenditionCache: { enabled: true }
```

ou `STORAGE_RENDITION_CACHE=true` pour un déploiement sous forme de bundle. Les rendus sont stockés
sous le préfixe réservé `_rebase/renditions/`, indexés par la version de l'objet
source — ainsi, le remplacement d'une image distribue immédiatement la nouvelle version.

Trois éléments à connaître avant de l'activer :

- **Une lecture implique désormais une écriture.** Chaque nouvelle variante coûte un `PUT` dans votre bucket. Cette option est
  désactivée par défaut pour cette raison.
- **Une écriture échouée n'est pas une requête échouée.** Des identifiants en lecture seule, ou une politique
  de bucket refusant le préfixe, basculent sur le cache en mémoire ; l'image est
  toujours distribuée et la raison est consignée une seule fois dans les logs.
- **Les rendus obsolètes ne sont pas nettoyés.** Remplacer un objet source
  laisse orphelins ses anciens rendus. Définissez une règle de cycle de vie sur `_rebase/renditions/`
  — ce préfixe est fixe et non configurable, précisément pour qu'une règle puisse le cibler.

Le préfixe n'est pas accessible depuis l'API. Le lire ou y écrire directement
renvoie **400 `INVALID_STORAGE_KEY`** : chaque règle d'accès du produit —
`storageAuthorize` tout comme les politiques déclaratives — est rédigée par rapport à la
clé *source*, et un rendu distribué sous son propre chemin répondrait à une demande
non sollicitée.

### Ce qui est distribué

Le type de contenu stocké correspond à ce que le téléverseur a déclaré — rien n'analyse
les octets — ainsi `/api/storage/file/*` n'affichera inline qu'une **liste blanche stricte** :
images, vidéo, audio, `application/pdf` et `text/plain`. Tout le reste,
`text/html` inclus, est distribué en tant que `application/octet-stream` avec
`Content-Disposition: attachment`, et chaque réponse comporte
`X-Content-Type-Options: nosniff`. Le stockage n'est pas un hébergeur web : une page téléversée
rendue sur l'origine de l'API pourrait lire les cookies de cette origine et appeler ses
points de terminaison.

Un SVG est une image qui est également un document pouvant contenir des `<script>`. Il est
distribué en tant que `image/svg+xml` — afin de s'afficher dans une balise `<img>` et dans les
miniatures du panneau d'administration — avec
`Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`
sur chaque réponse, URLs transformées et URLs avec jeton de téléchargement incluses. Ouvert
directement, il s'affiche avec les scripts désactivés et une origine opaque, ne pouvant ainsi
pas accéder aux cookies ou aux points de terminaison de l'API.

## Taille maximale autorisée pour un fichier

Chaque source de stockage accepte des fichiers jusqu'à sa propre limite : **50 Mo** sauf si
`STORAGE_MAX_FILE_SIZE` (en octets, suffixé par `__<KEY>` pour une source nommée) ou le
`maxFileSize` de la source n'en dispose autrement. Chaque point d'entrée limite un fichier à la même
valeur. `POST /api/storage/upload` renvoie `413 PAYLOAD_TOO_LARGE` en cas de dépassement ; un
téléversement avec reprise est refusé dès sa création, avant son premier fragment ; et
`OPTIONS /api/storage/tus` l'annonce sous l'en-tête `Tus-Max-Size` — pour la source
indiquée par `?storageId=`, ou celle par défaut sinon.

Sur la version 0.23, seul le `maxFileSize` de la source définit la limite ; `STORAGE_MAX_FILE_SIZE` n'est pas lue.

```bash
STORAGE_MAX_FILE_SIZE=209715200          # (default): 200 MB
STORAGE_MAX_FILE_SIZE__MEDIA=1073741824  # media: 1 GB
```

La quantité de données qu'un serveur garde en mémoire à la fois dépend du point d'entrée.
`POST /api/storage/upload` constitue un corps multipart complet que le serveur traite en entier :
trois à cinq fois la taille du fichier dans sa mémoire. Un téléversement avec reprise (TUS) ne conserve qu'un
fragment à la fois. <span class="since-badge" data-since="0.25">Depuis la version 0.25</span> `client.storage.putObject()` et le panneau d'administration envoient les fichiers
de plus de 8 Mio via le protocole avec reprise. Consultez
[Téléversements avec reprise (TUS)](/docs/backend/storage-resumable-uploads/) pour découvrir le
protocole, ce qu'il renvoie et son comportement à travers plusieurs instances.

## Variables d'environnement

| Variable | Description |
|----------|-------------|
| `STORAGE_TYPE` | `"local"`, `"s3"` ou `"gcs"` |
| `STORAGE_PATH` | Répertoire de stockage local (par défaut : `<project>/uploads`, sous `rebase dev` comme dans un serveur écrit par `rebase eject`). Un chemin relatif est lu depuis le répertoire où tourne le serveur, qui après `rebase eject` est `backend/`. Un bucket local nommé conserve ses fichiers à côté, dans `<STORAGE_PATH>__<key>`, sauf si `STORAGE_PATH__<KEY>` en définit un propre |
| `S3_BUCKET` | Nom du bucket S3 |
| `S3_REGION` | Région AWS (par défaut : `"auto"`) |
| `S3_ACCESS_KEY_ID` | Clé d'accès AWS |
| `S3_SECRET_ACCESS_KEY` | Clé secrète AWS |
| `S3_ENDPOINT` | Point de terminaison S3 personnalisé (pour MinIO, R2) |
| `S3_FORCE_PATH_STYLE` | Utiliser des URLs de type path-style (requis pour MinIO) |
| `GCS_BUCKET` | Nom du bucket Google Cloud Storage |
| `GCS_PROJECT_ID` | ID de projet GCP pour GCS |
| `GCS_KEY_FILENAME` | Chemin vers un fichier de clé de compte de service GCP (à omettre sur GKE — Workload Identity/ADC fournit les identifiants) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Variable ADC standard, lue directement par le SDK Google (inutile sur GCP avec les identifiants par défaut) |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Durée de validité de l'URL de téléchargement d'un fichier privé, en secondes — durée de vie du jeton émis par `/api/storage/metadata/*` (par défaut `300`, au maximum `604800`, soit une semaine). Augmentez-la pour les vidéos et audios privés, qui continuent de requérir des plages d'octets après le rendu de la page. Équivalent en variable d'environnement de `storageDownloadTokenTtl` |
| `STORAGE_MAX_FILE_SIZE` | Fichier le plus volumineux accepté par la source, en octets (par défaut `52428800`, soit 50 Mo). Suffixez par `__<KEY>` pour une source nommée. Une valeur qui n'est pas un nombre entier d'octets empêche le démarrage. Voir [Taille maximale autorisée pour un fichier](#taille-maximale-autorisée-pour-un-fichier) |
| `FORCE_LOCAL_STORAGE` | Autoriser `STORAGE_TYPE=local` en production — voir ci-dessous |
| `STORAGE_PUBLIC_READ` | Distribuer les objets stockés aux lecteurs non authentifiés. Équivalent en variable d'environnement de `storagePublicRead`, et l'un des trois moyens de satisfaire le [garde-fou de démarrage en production](#autorisation-par-objet). |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Désactiver le garde-fou de démarrage, restaurant le comportement où tout utilisateur connecté peut lire, écraser, supprimer ou lister n'importe quelle clé. Équivalent en variable d'environnement de `storageInsecureAllowAnyAuthenticated`. Ne se justifie que si chaque utilisateur connecté a la confiance nécessaire pour accéder à l'ensemble des fichiers. |

## Plusieurs buckets

Un projet peut comporter plus d'un bucket. Déclarez chacun d'eux dans `config/resources.ts`
— le point unique lu par la plateforme, le runtime et la console :

```ts
import { bucket } from "@rebasepro/types";

export const uploads = bucket({ engine: "s3" });    // the default one
export const media = bucket("media", { engine: "s3", label: "Media" });
```

Exécutez ensuite `rebase resources --write`, ce qui régénère `rebase.resources.json`
afin qu'un hôte puisse lire votre topologie sans avoir à exécuter un build. Consultez
[Sources multiples](/docs/backend/multiple-sources) pour la gestion combinée des bases de données, buckets et
topics.

Chaque source est configurée à partir des **mêmes noms de variables portant leur propre
suffixe**. La source par défaut ne prend aucun suffixe, ainsi un projet à bucket unique continue
d'utiliser les noms simples ci-dessus sans rien devoir déclarer, et déclarer des buckets nommés à côté
ne les change pas (<span class="since-badge" data-since="0.25">Depuis 0.25</span>, [détails](/docs/backend/multiple-sources/#which-bucket-receives-an-unqualified-upload)) :

```bash
S3_BUCKET=app-uploads             # (default)
S3_BUCKET__MEDIA=app-media        # media
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

Le suffixe est dérivé de la clé : mis en majuscules, les caractères non alphanumériques transformés en
underscores, précédés d'un **double** underscore (`media-cdn` → `__MEDIA_CDN`). Un
simple underscore entrerait en collision avec de véritables noms de variables — `S3_BUCKET_NAME`
serait interprété comme le bucket `name`.

Associez une propriété à une source à l'aide de `storageSource` :

```ts
{
    name: "Cover",
    dataType: "string",
    storage: { storageSource: "media", acceptedFiles: ["image/*"] }
}
```

Une source déclarée mais jamais configurée est **ignorée**, sans être fatale : les téléversements
qui lui sont adressés renvoient `501 STORAGE_SOURCE_NOT_CONFIGURED`. La déclaration d'un bucket survient
généralement avant qu'on ne lui associe un stockage, et une erreur de démarrage ici
ferait crasher en boucle le backend en attendant une configuration. Une source que l'environnement configure
*incorrectement* — un type sans bucket, ou un bucket sans identifiants — est refusée
au démarrage, car il s'agit d'une erreur et non d'une simple omission.

### Buckets partageant un même compte

Les identifiants décrivent généralement le **fournisseur**, et non le bucket. Quinze buckets sur
une même installation MinIO nécessiteraient sinon quinze copies de la même clé d'accès, et
une rotation impliquerait quinze modifications coordonnées. Nommez plutôt un compte :

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

Seules les variables délimitées au compte adoptent une valeur de repli — `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`, `S3_FORCE_PATH_STYLE`, et
la paire GCS `GCS_PROJECT_ID` / `GCS_KEY_FILENAME`. Le nom du bucket n'a jamais de valeur de repli :
c'est ce qui distingue une source d'une autre. Une valeur définie par bucket reste prioritaire,
permettant ainsi à une source de changer de fournisseur sans impacter les autres.

## Sources de stockage côté frontend

Lors de l'utilisation de multiples backends de stockage, transmettez `storageSources` au fournisseur `<Rebase>` afin que le frontend sache comment router directement les téléversements :

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

La `key` de chaque source doit correspondre à une clé de backend enregistrée dans la configuration `storage` du serveur. Le contexte React `StorageSourcesContext` détermine la source active pour chaque champ de téléversement.

## Mise en cache et CDNs

Chaque objet transite par le serveur, avec un `ETag` pour une revalidation
peu coûteuse, un en-tête `Cache-Control` dépendant de qui peut le lire, et des plages d'octets
pour la navigation dans les flux audio et vidéo. [Mise en cache du stockage et CDNs](/docs/backend/storage-caching/)
détaille les en-têtes ainsi que la configuration à appliquer sur un CDN placé en frontal.

## Conseils pour la production

:::caution
**En production, `type: "local"` désactive le stockage de fichiers au lieu de l'utiliser.** Sur une plateforme éphémère (Cloud Run, Heroku, un pod Kubernetes), le système de fichiers est effacé à chaque déploiement, redémarrage et éviction — les téléversements réussiraient donc, se reliraient correctement, puis disparaîtraient lors du déploiement suivant, sans la moindre erreur apparente.

Par conséquent, la valeur par défaut locale n'est pas enregistrée, et une requête vers `/api/storage/*` qui ne spécifie aucune source de stockage renvoie **`501 STORAGE_NOT_CONFIGURED`**, en indiquant les sources qui sont desservies. Une source nommée et configurée, telle que `bucket("media", { engine: "s3" })`, continue d'être desservie. Les téléversements échouent de façon explicite et récupérable ; le reste de l'application continue de fonctionner. Le stockage de fichiers nécessite une activation explicite en production : il n'existe qu'à partir du moment où un bucket est configuré.

Définissez `STORAGE_TYPE=s3` ou `gcs`. Si un **volume persistant** contient réellement `STORAGE_PATH`, spécifiez explicitement `FORCE_LOCAL_STORAGE=true`. Montez-le sur le parent de `STORAGE_PATH`, afin que le répertoire `<STORAGE_PATH>__<key>` de chaque bucket local nommé s'y trouve également.
:::

- Montez un **volume persistant** sur le parent de `STORAGE_PATH` si vous utilisez le stockage local sur Docker/Kubernetes, et définissez `FORCE_LOCAL_STORAGE=true` — voir [Auto-hébergement](/docs/deployment/self-hosting/#file-storage)
- Utilisez **S3** ou un équivalent compatible (R2, MinIO), ou **GCS**, pour les déploiements en production
- Configurez un **CDN** (CloudFront, Cloudflare) en frontal pour les performances — voir [Placer un CDN en frontal](/docs/backend/storage-caching/#putting-a-cdn-in-front)
- **Toute application avec du stockage en production doit déclarer un modèle d'accès** — voir ci-dessous.
  Cela ne concerne pas uniquement les architectures multi-locataires : le serveur *refuse de démarrer* sans cela.

## Autorisation par objet

### Politiques (Policies)

La forme déclarative. Une liste de modèles de chemins, lus sans aucune exécution de code :

```ts
storagePolicies: [
    { path: "public/**", operations: ["read"], allow: "public" },
    { path: "users/:uid/**", allow: ({ params, user }) => user?.uid === params.uid }
]
```

**Une clé ne correspondant à aucune politique est refusée.** Chaque ouverture de droit est une ligne explicite,
et une erreur entraîne un refus plutôt qu'un accès accordé.

Les modèles effectuent la correspondance **par segment, jamais par sous-chaîne** — `public/**` ne correspond pas à
`publicity/secret.png` :

| Modèle | Correspond à |
|---|---|
| `avatars/logo.png` | cette clé exactement |
| `users/*/avatar.png` | exactement un segment là où se trouve `*` |
| `users/:uid/**` | un segment capturé, puis le reste — y compris rien |

`**` n'est autorisé qu'en tant que segment final. `:name` capture un segment et ne s'étend
jamais sur un `/` ; les valeurs capturées sont transmises via `params` au prédicat.

`allow` peut valoir `"public"` (tout le monde), `"authenticated"` (tout appelant avec un uid), ou un
prédicat recevant les paramètres capturés, l'utilisateur, l'opération et le bucket.
`operations` prend par défaut les quatre valeurs — `read`, `write`, `delete`, `list`.

Les politiques satisfont le garde-fou de démarrage en production à elles seules, et un modèle mal formé
fait échouer le démarrage plutôt que le premier téléversement.

### Le hook

`requireAuth` et `publicRead` sont des commutateurs *globaux* : ils déterminent si un appelant doit être connecté, et non ce à quoi il a accès. Sans hook d'autorisation, **tout utilisateur authentifié peut lire n'importe quelle clé dont il connaît le nom** — la seule protection entre les fichiers de deux locataires réside dans l'impossibilité de deviner les clés, ce qui ne constitue pas un modèle de contrôle d'accès. Pire encore, ils peuvent d'abord effectuer un `GET /storage/list?prefix=`, de sorte qu'il n'est même pas nécessaire de deviner les clés.

:::caution[Le stockage ne démarrera pas en production sans cela]
Les collections sont protégées par une sécurité au niveau des lignes (RLS) ; le stockage ne l'est pas. Il n'existe pas
d'équivalent par objet au sein du bucket, ce hook *est* donc le modèle — et
`initializeRebaseBackend` **lève une exception au démarrage** sous `NODE_ENV=production` lorsque
le stockage est configuré et qu'aucun de ces éléments n'est défini :

- `storageAuthorize` — un hook, par objet. Recommandé.
- `storagePublicRead: true` — le bucket est véritablement un CDN public en lecture seule.
- `storageInsecureAllowAnyAuthenticated: true` — une application mono-locataire où chaque
  utilisateur connecté a la confiance nécessaire pour accéder à l'ensemble des fichiers. Nommé ainsi pour inciter à une double vérification.

En développement, un simple avertissement est consigné dans les logs ; un projet peut donc présenter cette mauvaise configuration
et fonctionner parfaitement en local jusqu'à ce qu'il soit déployé. Un projet généré à partir d'un template inclut déjà un hook dans
`config/storage.ts` — lisez-le avant de le remplacer, et notez qu'il modélise
la *bibliothèque de contenu partagée* d'un CMS, ce qui ne correspond pas au schéma de fichiers spécifiques par utilisateur.
:::

`storageAuthorize` est l'analogue pour le stockage des règles de sécurité d'une collection, et s'exécute après l'authentification sur chaque route de stockage :

```typescript no-verify
await initializeRebaseBackend({
    storage: { type: "s3", bucket: "app-files", /* ... */ },
    storageAuthorize: async ({ key, bucket, operation, user }) => {
        if (!user) return false;
        // Keys are laid out as `{teamId}/{docId}/...`
        const [teamId] = key.split("/");
        return isTeamMember(user.uid, teamId);
    }
});
```

| Champ | Description |
|-------|-------------|
| `key` | Clé de l'objet, débarrassée du préfixe de bucket et assainie des traversées de répertoires |
| `bucket` | Bucket résolu (`"default"` lorsqu'il n'est pas spécifié) |
| `operation` | `"read"`, `"write"`, `"delete"` ou `"list"` |
| `user` | `{ uid, email?, roles? }`, ou `null` lorsque la route autorise l'accès anonyme |
| `storageId` | Le backend nommé, lorsque la requête en ciblait un — sa clé canonique (`storageId=%20media` vaut `"media"`). Absent pour la source par défaut, quelle que soit la façon dont la requête l'a nommé (aucun paramètre, vide, ou `(default)`) |
| `data` | Accès en lecture approuvé, **contournant la RLS** — `data.collection(slug).find(query)` / `.findById(id)`. La notion de propriétaire réside dans une ligne de base de données, pas dans un préfixe de clé ; le hook a donc besoin d'un lecteur pour déterminer « qui possède cet objet ? ». Il contourne délibérément la sécurité au niveau des lignes : ce hook *constitue* la décision d'autorisation, et l'évaluer à travers un lecteur déjà restreint par les permissions propres de l'appelant créerait une circularité. Conçu en lecture seule par définition. |

Renvoyez `false` pour refuser l'accès avec un code **403**. Lever une exception refuse également l'accès — une recherche de propriétaire qui échoue ne laisse pas l'accès ouvert.

Bon à savoir :

- **La route de métadonnées est l'endroit où l'accès en lecture est réellement validé.** Elle émet le jeton de téléchargement à courte durée de vie restreint au chemin auquel la route du fichier fait confiance, le hook contrôle donc l'accès à ce niveau. Deux lectures contournent le hook, par conception. Une requête portant un tel jeton : le hook l'a déjà approuvée lors de la création du jeton, pour ce chemin et cette source uniquement, de sorte qu'un hook qui refuserait désormais l'accès (une adhésion révoquée entre-temps) ne l'interrompt pas avant l'expiration du jeton — `storageDownloadTokenTtl`, 300 secondes par défaut. Et la lecture d'une clé sous `public/` par un appelant sans identifiants : ce préfixe constitue la déclaration explicite que tout le monde peut la lire, y compris les visiteurs anonymes et les CDNs. La lecture de cette clé par un utilisateur connecté passe toujours par le hook, mais celle d'un utilisateur anonyme ne l'est pas, de sorte qu'un hook ne peut pas rendre privée une clé sous `public/` ; stockez plutôt le fichier en dehors de `public/`. Seules ces deux lectures le contournent : un utilisateur que votre adaptateur d'authentification appellerait par hasard `public` est évalué comme n'importe qui d'autre.
- **Un bucket, un seul nom.** Sur S3 et GCS, le `bucket` du hook est toujours `"default"`, même lorsqu'une requête spécifie le bucket du fournisseur, qui cible les mêmes objets.
- **Un chemin est public lorsque la clé qu'il désigne l'est.** Le préfixe `public/` est évalué sur la clé canonique servie par la route — après suppression du segment initial de bucket `default/` et résolution de `//`, `./` et du `/` initial — jamais sur l'URL telle qu'elle est écrite. `/api/storage/file/notes://public/x.txt` désigne la clé privée `notes:/public/x.txt`, et la clé `default/public/x.txt` (atteinte via `/api/storage/file/default/default/public/x.txt`) se trouve dans un dossier nommé `default` ; aucune des deux n'est publique. Dans un hook, testez la `key` qui vous est fournie avec `isPublicStorageKey` issu de `@rebasepro/types` — `isPublicStoragePath` lit un chemin ou une URL côté client, et les évalue tous deux comme publics.
- **`list` est contrôlé sur le préfixe.** Le listing est le moyen de découvrir des clés dont personne ne vous a parlé.
- **Les téléversements avec reprise (TUS) sont contrôlés au moment de la création**, évitant ainsi qu'un téléversement refusé ne laisse un fichier temporaire derrière lui.
- Omettre le hook préserve le comportement précédent, les applications mono-locataires ne sont donc pas affectées.

### Clés d'API et jetons

Une personne connectée dispose de toutes les portées de stockage (scopes), le hook et les politiques ci-dessus
décident donc pour elle. Une [clé d'API](/docs/backend/api-keys/) a également besoin de la portée de stockage
adéquate pour l'opération, sur la source désignée par la requête : `storage:read` pour
les téléchargements, métadonnées et listings, `storage:write` pour les téléversements, dossiers et chaque
étape d'un téléversement avec reprise, `storage:delete` pour les suppressions. La cible est
l'identifiant de la source, et celui de la source par défaut est `(default)` : `storage:read:(default)`,
`storage:write:avatars`. Sans cela, la réponse est `403 SCOPE_MISSING`. Avec la portée requise,
le hook s'exécute tout de même, en adoptant l'identité représentée par la clé.

## Réagir à un téléversement

Toute autre écriture dans Rebase peut déclencher une réaction — une ligne dispose de `beforeSave` et
`afterSave`, une planification dispose d'une tâche cron — alors qu'un téléversement ne disposait de rien. Tout ce qu'un
téléversement impliquait devait être géré par le client, lors d'un second appel, ce qui signifie que l'action
n'était pas réalisée du tout si le client se déconnectait entre-temps.

```ts
storageTriggers: [
    {
        path: "uploads/:uid/**",
        events: ["finalize"],
        handler: async ({ key, params, size, user }) => {
            await indexUpload.enqueue({ key, uid: params.uid, size }); // a `queue()` in config/resources.ts
        }
    }
]
```

La syntaxe des modèles est la même que celle de `storagePolicies` — segments littéraux, `*`
pour un segment, `:name` pour en capturer un, `**` pour le reste — et un modèle mal formé
fait échouer le démarrage plutôt que d'ignorer silencieusement les événements sans correspondance.

| Événement | Moment de déclenchement |
| --- | --- |
| `finalize` | après que l'objet est écrit de manière durable ; jamais pour une écriture ayant échoué |
| `delete` | après la suppression effective de l'objet |

`finalize` se déclenche pour les téléversements multipart comme pour ceux avec reprise (TUS) — une seule fois
par téléversement, et non par fragment — et un téléversement avec reprise indique l'utilisateur qui l'a
*créé*, puisque c'est cette identité que l'autorisation a validée.

Ce qu'un gestionnaire (handler) ne doit pas présumer :

- **Un gestionnaire qui lève une exception ne fait pas échouer la requête.** L'objet est déjà stocké
  au moment de son exécution ; renvoyer une erreur au client indiquerait que
  le téléversement a échoué alors que ce n'est pas le cas, et les clients réessayent leurs téléversements. Les échecs sont consignés dans les logs
  et la réponse reste inchangée. Si le traitement doit impérativement avoir lieu, ajoutez une tâche dans une file d'attente (queue).
- **Les gestionnaires sont attendus avec `await`**, dans l'ordre de leur déclaration, avant l'envoi de la réponse —
  exécuter en tâche de fond (« fire and forget ») laisserait une promesse qu'un environnement serverless est libre de
  geler en plein vol. Un gestionnaire lent équivaut donc à un téléversement ralenti, ce qui constitue une
  autre raison d'utiliser une file d'attente plutôt que d'effectuer le travail ici.
- **Les écritures internes ne déclenchent pas de triggers.** Le cache de rendu d'images écrit
  les objets dérivés directement dans le contrôleur de stockage ; un trigger `**` réagissant à
  ces écritures se déclencherait sur sa propre sortie.

## Étapes suivantes

- **[Stockage Frontend et téléversement de fichiers](/docs/frontend/storage)** — Champs de téléversement de fichiers et hooks
- **[Propriétés](/docs/collections/properties)** — Configuration des propriétés de stockage
