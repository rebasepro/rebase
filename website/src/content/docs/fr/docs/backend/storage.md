---
sourceHash: 4d4f9bdaabf6ff8e
title: Configuration du stockage
sidebar_label: Configuration du stockage
description: Configurez des backends de stockage sur système de fichiers local, compatibles S3 ou GCS/Firebase Storage pour les téléversements de fichiers, les images et les médias.
---

## Aperçu

Rebase prend en charge trois backends de stockage :

- **Système de fichiers local** — Fichiers stockés sur disque (idéal pour le développement)
- **Compatible S3** — AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces
- **Google Cloud Storage / Firebase Storage** — Prise en charge native de GCS via `@google-cloud/storage`

## Configuration

:::note[Où cela se place]
**Runtime managé** — les variables `STORAGE_*` dans `.env` (`STORAGE_TYPE`, `STORAGE_BUCKET` ou `S3_BUCKET` / `GCS_BUCKET`, `STORAGE_PATH`, `STORAGE_PUBLIC_READ`, … — suffixez n'importe laquelle d'entre elles par `__<KEY>` pour une source nommée), ainsi qu'une déclaration `bucket("<key>")` dans `config/resources.ts` pour chaque bucket au-delà de celui par défaut, et `export const storageAuthorize` depuis `config/index.ts`. `storageAuthorize` n'a volontairement pas de format sous forme de variable d'environnement : aucune variable ne peut exprimer "cet utilisateur peut lire cette clé".

**Éjecté (Ejected)** — le bloc `storage` sur `initializeRebaseBackend({ … })`. `storagePolicies` et `storageTriggers` sont réservés au mode éjecté.

La cartographie complète se trouve dans [Aperçu du backend](/docs/backend/#where-each-option-lives).
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

Sur GCP (Cloud Run, GCE, GKE), les identifiants du compte de service par défaut sont utilisés automatiquement. En dehors de GCP, définissez la variable d'environnement `GOOGLE_APPLICATION_CREDENTIALS` avec le chemin vers votre fichier de clé de compte de service.

### Plusieurs backends de stockage

Vous pouvez configurer plusieurs backends nommés et router différents champs vers différents stockages :

```typescript
storage: {
    "(default)": { type: "local", basePath: "./uploads" },
    "media": { type: "s3", bucket: "media-bucket", region: "us-east-1", ... }
}
```

Ensuite, dans les propriétés de vos collections, référencez un backend spécifique :

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

## Points de terminaison de stockage (Endpoints)

| Méthode | Chemin | Description |
|---------|--------|-------------|
| `POST` | `/api/storage/upload` | Téléversement direct de fichier |
| `POST` | `/api/storage/upload?storageId=<key>` | Téléversement vers un backend nommé spécifique |
| `GET` | `/api/storage/file/*` | Récupérer un fichier — tout ce qui suit `/file/` est la clé de l'objet |
| `GET` | `/api/storage/file/*?storageId=<key>` | Récupérer un fichier depuis un backend spécifique |
| `GET` | `/api/storage/metadata/*` | Taille, type de contenu et dernière modification d'un objet, sans ses octets |
| `DELETE` | `/api/storage/file/*` | Supprimer un fichier |
| `GET` | `/api/storage/list` | Lister les objets sous un préfixe (`prefix`, `bucket`, `maxResults`, `pageToken`, `storageId`). Un `maxResults` inférieur à 1, ou un `pageToken` que la source n'a jamais émis, donne `400 INVALID_LIST_OPTIONS` |
| `POST` | `/api/storage/folder` | Créer un marqueur de dossier vide |
| `GET` | `/api/storage/sources` | Les sources de stockage desservies par ce backend, par clé |
| `OPTIONS` | `/api/storage/tus` | Interroger les fonctionnalités du protocole TUS prises en charge |
| `POST` | `/api/storage/tus` | Initier une session de téléversement TUS avec reprise |
| `HEAD` | `/api/storage/tus/:id` | Vérifier la progression du téléversement (décalage en octets) |
| `PATCH` | `/api/storage/tus/:id` | Ajouter un bloc de données au fichier temporaire |
| `DELETE` | `/api/storage/tus/:id` | Terminer/abandonner la session de téléversement TUS |

**Ce qu'ils répondent.** Une seule enveloppe, la même que celle utilisée par `/api/data` : la charge utile (payload)
se trouve sous `data`, et un échec correspond à `{ "error": { message, code, requestId } }`
avec les codes indiqués dans la [référence des erreurs](/docs/backend/errors/). `/api/storage/file/*`
fait exception, car sa charge utile est le fichier lui-même — elle répond avec les octets, accompagnés de
`Content-Type`, `Content-Length` et des en-têtes de mise en cache.

```json
// GET /api/storage/list?prefix=products/images/
{ "data": { "items": [ { "bucket": "default", "fullPath": "products/images/a.jpg", "name": "a.jpg" } ], "prefixes": [] } }
```

`POST /api/storage/upload` répond `201` avec les informations `{ key, bucket, storageUrl }`
de l'objet stocké sous `data` ; `GET /api/storage/metadata/*` renvoie les métadonnées
de l'objet et, pour un objet privé, le `token` à courte durée de vie ;
`GET /api/storage/sources` renvoie le tableau des sources configurées.
`DELETE /api/storage/file/*` et `POST /api/storage/folder` ne transportent qu'un
`message`, puisqu'il n'y a rien à retourner.

Sur S3 et GCS, un `bucket` doit être l'un de ceux que sert la source, en
écriture comme en lecture : un téléversement, un `POST /api/storage/folder` ou
un téléversement TUS qui nomme un autre bucket répond
`404 UNKNOWN_STORAGE_SOURCE`, comme le listage. Le stockage local crée toujours
un bucket lors de sa première écriture.

**Comment la lecture d'un fichier est autorisée.** Les routes de lecture — `/api/storage/file/*` et
`/api/storage/metadata/*` — acceptent le jeton signé à courte durée de vie généré par
[`getSignedUrl()`](/docs/sdk/storage), transmis via `?token=<token>` ou sous forme de jeton
`Bearer`. Un JWT d'accès ordinaire est **refusé** sur `/file/*` avec l'erreur `401
Unauthorized: Access JWT not allowed on file routes` : le jeton qui fonctionne sur
toutes les autres routes ne fonctionne pas ici, à dessein, car une URL de fichier est
un élément que vous transmettez à un navigateur, un CDN ou une balise `<img>`. Toutes les autres lignes ci-dessus
acceptent le JWT d'accès habituel.

## Transformations d'images à la volée

Rebase inclut un pipeline de traitement d'images intégré alimenté par **Sharp**. Lors de la distribution d'images depuis le stockage, vous pouvez appliquer des opérations dynamiques à l'aide de paramètres de requête :

```bash
# Serve image scaled to 300px width in webp format
GET /api/storage/file/products/laptop.jpg?width=300&format=webp
```

### Paramètres pris en charge

- `width`, `height` : Limites de redimensionnement, de `1` à `4096` (l'image n'est jamais agrandie).
- `quality` : De `1` à `100`.
- `format` : Convertit le format de l'image. Formats pris en charge : `webp`, `jpeg`, `png`, `avif`.
- `fit` : `cover`, `contain`, `fill`, `inside` ou `outside`.

Un paramètre en dehors de ces limites renvoie une erreur **400**, et non une valeur discrètement plafonnée —
auparavant, `?width=99999` renvoyait une image de 4096px et `?format=tiff` une image webp, sans
qu'aucun message ne le signale.

### Performances et mise en cache LRU

La transformation consomme beaucoup de CPU et de mémoire, et sur un objet public, le point de terminaison est
accessible de manière anonyme, le travail est donc limité plutôt que simplement mis en cache :
- **Capacité** : un cache LRU plafonné à **500 entrées** globalement, indexé par source de stockage,
  bucket et clé canonique.
- **TTL (Time to Live)** : Les variantes mises en cache expirent après **1 heure**.
- Des requêtes simultanées pour une même variante non mise en cache génèrent **une seule** transformation,
  et non une par requête.
- Un petit nombre de transformations s'exécutent simultanément ; au-delà d'une file d'attente limitée, le serveur
  répond **503 `TRANSFORM_OVERLOADED`** plutôt que d'accepter un travail qu'il ne pourra pas traiter.

Ce cache réside dans le processus, ce qui signifie qu'il n'est pas partagé entre les instances
et ne survit pas à un redémarrage. Deux réplicas calculent chacun chaque variante, et un
déploiement réinitialise la totalité du cache.

### Des rendus qui survivent à un redémarrage

`storageRenditionCache` réécrit chaque image dérivée dans le même bucket que sa
source, afin que le travail soit effectué une seule fois pour l'ensemble du déploiement plutôt qu'une fois par
instance et par version :

```ts
storageRenditionCache: { enabled: true }
```

ou `STORAGE_RENDITION_CACHE=true` pour un déploiement sous forme de bundle. Les rendus sont stockés
sous le préfixe réservé `_rebase/renditions/`, indexés par la version de l'objet source —
ainsi, le remplacement d'une image distribue immédiatement la nouvelle version.

Trois éléments à connaître avant de l'activer :

- **Une lecture effectue désormais une écriture.** Chaque nouvelle variante coûte un `PUT` dans votre bucket.
  Elle est désactivée par défaut pour cette raison.
- **Une écriture échouée n'est pas une requête échouée.** Des identifiants en lecture seule ou une politique
  de bucket refusant le préfixe basculent vers le cache en cours de processus ; l'image est
  toujours servie et la raison est journalisée une seule fois.
- **Les rendus obsolètes ne sont pas nettoyés automatiquement.** Le remplacement d'un objet source
  laisse ses anciens rendus à l'abandon. Définissez une règle de cycle de vie sur `_rebase/renditions/`
  — ce préfixe est fixe et non configurable, précisément pour qu'une règle puisse le cibler.

Le préfixe n'est pas accessible depuis l'API. Tenter de le lire ou d'y écrire directement
renvoie **400 `INVALID_STORAGE_KEY`** : chaque règle d'accès du produit —
`storageAuthorize` tout comme les politiques déclaratives — est rédigée par rapport à la
clé *source*, et un rendu servi sous son propre chemin répondrait à une question
que personne n'a posée.

### Ce qui est distribué

Le type de contenu stocké correspond à celui déclaré par la personne ayant effectué le téléversement — rien n'inspecte
les octets — ainsi `/api/storage/file/*` ne restituera en ligne qu'une **liste restreinte autorisée** :
les images, la vidéo, l'audio, `application/pdf` et `text/plain`. Tout le
reste, y compris `text/html`, est servi sous forme de
`application/octet-stream` avec `Content-Disposition: attachment`, et chaque
réponse comporte `X-Content-Type-Options: nosniff`. Le stockage n'est pas un hébergeur web :
une page téléversée rendue sur l'origine de l'API peut lire les cookies de cette origine et
appeler ses points de terminaison.

Un SVG est à la fois une image et un document, et peut porter un `<script>`. Il est servi
comme `image/svg+xml` — afin de s'afficher dans un `<img>` et dans les miniatures du panneau
d'administration — avec
`Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`
sur chaque réponse, transformations d'URL et URL à jeton de téléchargement comprises. Ouvert
directement, il s'affiche avec les scripts désactivés et une origine opaque, si bien qu'il ne
peut atteindre ni les cookies ni les points de terminaison de l'API.

## Protocole de reprise de téléversement TUS

Pour le téléversement de fichiers volumineux ou la gestion de conditions réseau instables, Rebase implémente le protocole ouvert **TUS v1.0.0**, incluant les extensions `Creation` et `Termination`.

### Quelle taille un fichier peut atteindre

Chaque source de stockage accepte des fichiers jusqu'à sa propre limite : **50 Mo** sauf si
`STORAGE_MAX_FILE_SIZE` (en octets, suffixé `__<KEY>` pour une source nommée) ou le `maxFileSize`
de la source en dit autrement. Chaque porte d'accès applique le même nombre à un fichier.
`POST /api/storage/upload` répond `413 PAYLOAD_TOO_LARGE` au-delà ; un téléversement reprenable
est refusé à sa création, avant son premier fragment ; et `OPTIONS /api/storage/tus` l'annonce
comme `Tus-Max-Size` — pour la source nommée par `?storageId=`, la source par défaut sinon.

<span class="since-badge" data-since="0.24">Depuis 0.24</span> pour `STORAGE_MAX_FILE_SIZE` : sur la 0.23 seul le `maxFileSize` de la
source fixe la limite, et la variable n'est pas lue.

```bash
STORAGE_MAX_FILE_SIZE=209715200          # (default): 200 MB
STORAGE_MAX_FILE_SIZE__MEDIA=1073741824  # media: 1 GB
```

Un fichier complet est retenu dans la mémoire du serveur pendant son écriture vers le stockage,
sur chaque chemin de téléversement ; dimensionnez donc la limite en fonction de la mémoire dont
dispose le serveur.

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

### Mécanique du cycle de vie d'un téléversement

1. **Initialisation de la session (`POST`)** : Le client envoie la taille totale du fichier dans l'en-tête `Upload-Length` et les métadonnées en base64 via `Upload-Metadata`. Le serveur crée un fichier temporaire vide sous un répertoire temporaire masqué `.tus-uploads/` et renvoie l'URL de téléversement.
2. **Consultation de la progression (`HEAD`)** : Si un téléversement est interrompu, le client interroge l'URL de téléversement à l'aide d'une requête `HEAD`. Le serveur renvoie la position actuelle en octets dans l'en-tête `Upload-Offset`.
3. **Ajout de données (`PATCH`)** : Le client reprend l'envoi des données binaires en partant du décalage retourné avec `Content-Type: application/offset+octet-stream`. Le serveur écrit chaque fragment dans le fichier temporaire au décalage d'octets que déclare la requête, qui doit être le décalage que détient le serveur (`409` sinon). Un seul fragment est reçu à la fois : un `PATCH` qui arrive alors qu'un autre fragment du même téléversement est encore en cours de réception — typiquement un client qui renvoie un fragment resté bloqué — reçoit `423 UPLOAD_LOCKED`, et le client reprend depuis le décalage que rapporte `HEAD`.
4. **Finalisation** : Lorsque l'`Upload-Offset` cumulé correspond à l'`Upload-Length` déclaré, Rebase lit le fichier temporaire finalisé, l'encapsule sous forme d'objet `File` JavaScript standard et l'enregistre sur le backend de stockage configuré (disque local ou S3). Le fichier temporaire est ensuite supprimé.
5. **Nettoyage périodique** : Un processus de nettoyage en arrière-plan s'exécute toutes les **60 secondes** pour supprimer les téléversements temporaires orphelins et incomplets qui ont dépassé le seuil de rétention de **24 heures**.

## Variables d'environnement

| Variable | Description |
|----------|-------------|
| `STORAGE_TYPE` | `"local"`, `"s3"` ou `"gcs"` |
| `STORAGE_PATH` | Répertoire de stockage local (par défaut : `./uploads`) |
| `S3_BUCKET` | Nom du bucket S3 |
| `S3_REGION` | Région AWS (par défaut : `"auto"`) |
| `S3_ACCESS_KEY_ID` | Clé d'accès AWS |
| `S3_SECRET_ACCESS_KEY` | Clé secrète AWS |
| `S3_ENDPOINT` | Point de terminaison S3 personnalisé (pour MinIO, R2) |
| `S3_FORCE_PATH_STYLE` | Utiliser des URL de type path-style (requis pour MinIO) |
| `GCS_BUCKET` | Nom du bucket Google Cloud Storage |
| `GCS_PROJECT_ID` | ID du projet GCP pour GCS |
| `GCS_KEY_FILENAME` | Chemin vers un fichier de clé de compte de service GCP (à omettre sur GKE — Workload Identity/ADC fournit les identifiants) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Variable ADC standard, lue directement par le SDK Google (inutile sur GCP avec les identifiants par défaut) |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | <span class="since-badge" data-since="0.24">Depuis 0.24</span> Durée pendant laquelle l'URL de téléchargement d'un fichier privé fonctionne, en secondes — la durée de vie du jeton que mint `/api/storage/metadata/*` (par défaut `300`, au plus `604800`, une semaine). Augmentez-la pour la vidéo et l'audio privés, qui continuent de demander des plages après le rendu de la page. L'orthographe env de `storageDownloadTokenTtl` |
| `STORAGE_MAX_FILE_SIZE` | <span class="since-badge" data-since="0.24">Depuis 0.24</span> Le plus gros fichier que la source accepte, en octets (par défaut `52428800`, 50 Mo). Suffixe `__<KEY>` pour une source nommée. Une valeur qui n'est pas un nombre entier d'octets fait échouer le démarrage. Voir [Quelle taille un fichier peut atteindre](#quelle-taille-un-fichier-peut-atteindre) |
| `FORCE_LOCAL_STORAGE` | Autoriser `STORAGE_TYPE=local` en production — voir ci-dessous |
| `STORAGE_PUBLIC_READ` | Servir les objets stockés aux lecteurs non authentifiés. L'équivalent en variable d'environnement de `storagePublicRead`, et l'un des trois moyens de satisfaire la [protection de démarrage en production](#autorisation-par-objet). |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Se désengager de la protection de démarrage, en rétablissant le comportement où tout utilisateur connecté peut lire, écraser, supprimer ou lister n'importe quelle clé. L'équivalent en variable d'environnement de `storageInsecureAllowAnyAuthenticated`. Défendable uniquement lorsque l'on peut faire confiance à chaque utilisateur connecté pour l'ensemble des fichiers. |

## Plusieurs buckets

Un projet peut posséder plusieurs buckets. Déclarez chacun d'entre eux dans `config/resources.ts`
— l'endroit unique lu par la plateforme, le runtime et la console :

```ts
import { bucket } from "@rebasepro/types";

export const uploads = bucket({ engine: "s3" });    // the default one
export const media = bucket("media", { engine: "s3", label: "Media" });
```

Exécutez ensuite `rebase resources --write`, ce qui régénère `rebase.resources.json`
afin qu'un hôte puisse lire votre topologie sans exécuter de build. Consultez
[Sources multiples](/docs/backend/multiple-sources) pour les bases de données, les buckets et
les topics réunis.

Chaque source est configurée à partir des **mêmes noms de variables portant leur propre
suffixe**. La source par défaut ne prend aucun suffixe, ainsi un projet à bucket unique continue
d'utiliser les noms simples ci-dessus et n'a rien à déclarer :

```bash
S3_BUCKET=app-uploads             # (default)
S3_BUCKET__MEDIA=app-media        # media
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

Le suffixe est dérivé de la clé : converti en majuscules, les caractères non alphanumériques transformés en
underscores, précédé d'un **double** underscore (`media-cdn` → `__MEDIA_CDN`). Un
underscore simple entrerait en collision avec de véritables noms de variables — `S3_BUCKET_NAME`
serait interprété comme le bucket `name`.

Acheminez une propriété vers une source à l'aide de `storageSource` :

```ts
{
    name: "Cover",
    dataType: "string",
    storage: { storageSource: "media", acceptedFiles: ["image/*"] }
}
```

Une source que vous déclarez mais ne configurez jamais est **ignorée**, ce n'est pas fatal : les téléversements
qui y sont acheminés renvoient `501 STORAGE_SOURCE_NOT_CONFIGURED`. La déclaration d'un bucket survient généralement
avant que quiconque n'y attache un stockage, et une erreur de démarrage à ce moment-là provoquerait
une boucle de crashs du backend en attendant que ce soit fait. Une source que l'environnement configure
*incorrectement* — un type sans bucket, ou un bucket sans identifiants — est refusée
au démarrage, car il s'agit d'une erreur et non d'une simple omission.

### Buckets partageant un même compte

Les identifiants décrivent généralement le **fournisseur**, pas le bucket. Quinze buckets sur
une même installation MinIO exigeraient autrement quinze copies de la même clé d'accès, et
une rotation imposerait quinze paires de modifications. Spécifiez plutôt un compte nommé :

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

Seules les variables délimitées au niveau du compte font l'objet d'un repli (fallback) — `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`, `S3_FORCE_PATH_STYLE`, ainsi que
le couple GCS `GCS_PROJECT_ID` / `GCS_KEY_FILENAME`. Le nom du bucket ne le fait jamais :
c'est lui qui distingue une source d'une autre. Une valeur définie par bucket l'emporte toujours,
ce qui permet à une source de changer de fournisseur sans impacter les autres.

## Sources de stockage frontend

Lors de l'utilisation de plusieurs backends de stockage, transmettez `storageSources` au fournisseur `<Rebase>` afin que le frontend sache comment acheminer les téléversements directement :

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

Le champ `key` de chaque source doit correspondre à une clé de backend enregistrée dans la structure `storage` du serveur. Le contexte React `StorageSourcesContext` détermine la source active pour chaque champ de téléversement.

## Mise en cache et CDN

Chaque objet transite via le serveur, avec un `ETag` pour une revalidation économique, un
`Cache-Control` qui dépend de qui est autorisé à le lire, et des plages d'octets pour le
déplacement (seeking) dans l'audio et la vidéo.
[Mise en cache du stockage et CDN](/docs/backend/storage-caching/) détaille les en-têtes, et ce
qu'il faut configurer sur un CDN en amont.

## Conseils pour la production

:::caution
**En production, `type: "local"` désactive le stockage de fichiers au lieu de l'utiliser.** Sur une plateforme éphémère (Cloud Run, Heroku, un pod Kubernetes), le système de fichiers est effacé à chaque déploiement, redémarrage ou éviction — ainsi, les téléversements réussiraient, se reliraient sans souci, mais disparaîtraient lors du déploiement suivant, sans aucune erreur à aucun moment.

Le défaut local n'est donc pas enregistré, et une requête vers `/api/storage/*` qui ne nomme aucune source de stockage répond **`501 STORAGE_NOT_CONFIGURED`**, en nommant les sources servies. Une source nommée qui est configurée, comme `bucket("media", { engine: "s3" })`, continue de servir. Les téléversements échouent de manière visible et récupérable ; le reste de l'application continue de fonctionner. Le stockage de fichiers est activé explicitement en production : il existe dès lors qu'un bucket est configuré.

Définissez `STORAGE_TYPE=s3` ou `gcs`. Si un **volume persistant** est réellement monté sur `STORAGE_PATH`, définissez `FORCE_LOCAL_STORAGE=true` pour l'indiquer explicitement.
:::

- Montez un **volume persistant** si vous utilisez le stockage local sur Docker/Kubernetes, et définissez `FORCE_LOCAL_STORAGE=true`
- Utilisez **S3** ou un équivalent compatible (R2, MinIO), ou **GCS**, pour les déploiements en production
- Configurez un **CDN** (CloudFront, Cloudflare) en amont pour améliorer les performances — voir [Placer un CDN en amont](/docs/backend/storage-caching/#putting-a-cdn-in-front)
- **Toute application disposant d'un stockage en production doit déclarer un modèle d'accès** — voir ci-dessous.
  Cela ne concerne pas uniquement le multi-tenant : le serveur *refuse de démarrer* en l'absence de ce modèle.

## Autorisation par objet

### Politiques (Policies)

La forme déclarative. Une liste de modèles de chemins, analysée sans exécuter de code :

```ts
storagePolicies: [
    { path: "public/**", operations: ["read"], allow: "public" },
    { path: "users/:uid/**", allow: ({ params, user }) => user?.uid === params.uid }
]
```

**Une clé ne correspondant à aucune politique est refusée.** Chaque ouverture de droit fait l'objet d'une ligne explicite,
et une erreur entraîne un refus plutôt qu'un accord d'accès.

Les motifs correspondent **par segment, jamais par sous-chaîne** — `public/**` ne correspond pas à
`publicity/secret.png` :

| Motif | Correspondance |
|---|---|
| `avatars/logo.png` | cette clé exactement |
| `users/*/avatar.png` | exactement un segment là où se trouve `*` |
| `users/:uid/**` | un segment capturé, puis le reste — y compris rien |

`**` n'est autorisé qu'en tant que segment final. `:name` capture un segment et ne s'étend
jamais sur un `/` ; les captures sont transmises sous forme de `params` au prédicat.

`allow` accepte `"public"` (tout le monde), `"authenticated"` (tout appelant doté d'un uid), ou un
prédicat recevant les paramètres capturés, l'utilisateur, l'opération et le bucket.
`operations` applique par défaut les quatre opérations — `read`, `write`, `delete`, `list`.

Les politiques suffisent à elles seules pour satisfaire la protection de démarrage en production, et un motif mal formé
provoque l'échec dès le démarrage plutôt qu'au premier téléversement.

### Le hook

`requireAuth` et `publicRead` sont des commutateurs *globaux* : ils déterminent si un appelant doit être connecté, et non ce que cet appelant a le droit de manipuler. Sans hook d'autorisation, **tout utilisateur authentifié peut lire n'importe quelle clé dont il connaît le nom** — la seule frontière entre les fichiers de deux organisations locataires (tenants) repose sur l'impossibilité de deviner la clé, ce qui ne constitue pas un modèle de contrôle d'accès. Pire encore, ils peuvent exécuter `GET /storage/list?prefix=` au préalable, éliminant ainsi le besoin de deviner les clés.

:::caution[Le stockage ne démarrera pas en production sans cela]
Les collections sont protégées par une sécurité au niveau des lignes (RLS) ; le stockage ne l'est pas. Il n'existe pas
d'équivalent par objet dans le bucket, ce hook *constitue* donc le modèle — et
`initializeRebaseBackend` **lève une erreur au démarrage** sous `NODE_ENV=production` lorsque
le stockage est configuré et qu'aucune de ces options n'est définie :

- `storageAuthorize` — un hook, par objet. Recommandé.
- `storagePublicRead: true` — le bucket est véritablement un CDN public en lecture seule.
- `storageInsecureAllowAnyAuthenticated: true` — une application mono-tenant où chaque
  utilisateur connecté a accès à l'ensemble des fichiers. Nommé explicitement pour inciter à la prudence.

En développement, un simple avertissement est consigné dans les logs, un projet peut donc comporter cette erreur et
fonctionner parfaitement en local jusqu'au moment de son déploiement. Un projet initialisé intègre déjà un hook dans
`config/storage.ts` — lisez-le avant de le remplacer, et notez qu'il modélise
une *bibliothèque de contenu partagée* de CMS, ce qui ne correspond pas au schéma de fichiers propres à chaque utilisateur.
:::

`storageAuthorize` est l'équivalent pour le stockage des règles de sécurité d'une collection, et s'exécute après l'authentification sur chaque route de stockage :

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
| `key` | Clé de l'objet, préfixe de bucket retiré et traversée de répertoires assainie |
| `bucket` | Bucket résolu (`"default"` s'il n'est pas spécifié) |
| `operation` | `"read"`, `"write"`, `"delete"` ou `"list"` |
| `user` | `{ uid, email?, roles? }`, ou `null` lorsque la route autorise l'accès anonyme |
| `storageId` | Le backend nommé, lorsque la requête en ciblait un — sa clé canonique (`storageId=%20media` vaut `"media"`). Absent pour la source par défaut, quelle que soit la façon dont la requête la nomme (pas de paramètre, vide ou `(default)`) |
| `data` | Accès en lecture de confiance, **contournant la RLS** — `data.collection(slug).find(query)` / `.findById(id)`. La propriété d'un objet réside dans une ligne de base de données, et non dans le préfixe d'une clé ; le hook a donc besoin d'un lecteur pour déterminer "qui possède cet objet ?". Il contourne délibérément la sécurité au niveau des lignes : ce hook *est* la décision d'autorisation, et l'exécuter via un lecteur déjà restreint par les permissions de l'appelant créerait une circularité. Conçu en lecture seule par définition. |

Renvoyez `false` pour refuser avec un code **403**. Lever une exception refuse également l'accès — une vérification de propriété qui échoue ne laisse pas l'accès ouvert par défaut.

Bon à savoir :

- **La route de métadonnées est l'endroit où l'accès en lecture est réellement validé.** Elle génère le jeton de téléchargement temporaire restreint au chemin, auquel la route de fichier fait confiance ; le hook effectue donc le filtrage à ce niveau. Les requêtes présentant déjà un tel jeton, ou ciblant un chemin déclaré public, ignorent le hook — le jeton a été délivré sous son contrôle et n'est valide que pour son propre chemin.
- **Un chemin est public quand la clé qu'il désigne l'est.** Le préfixe `public/` est testé sur la clé canonique que sert la route — après lecture d'un segment de bucket `default/` initial et repli de `//`, `./` et d'un `/` initial —, jamais sur l'URL telle qu'elle est écrite. `/api/storage/file/notes://public/x.txt` désigne la clé privée `notes:/public/x.txt`, et la clé `default/public/x.txt` (atteinte via `/api/storage/file/default/default/public/x.txt`) se trouve dans un dossier nommé `default` ; aucune des deux n'est publique. Dans un hook, testez la `key` qui vous est transmise avec `isPublicStorageKey` de `@rebasepro/types` — `isPublicStoragePath` lit un chemin ou une URL côté client, et considère ces deux cas comme publics.
- **`list` est filtré selon le préfixe.** L'opération de listage permet de découvrir des clés dont personne ne vous a communiqué l'existence.
- **Les téléversements avec reprise (TUS) sont filtrés dès la création**, ainsi un téléversement refusé ne laisse aucun fichier temporaire derrière lui.
- Omettre le hook préserve le comportement antérieur, de sorte que les applications mono-tenant ne sont pas impactées.

### Clés API et jetons

<span class="since-badge" data-since="0.24">Depuis 0.24</span> Une personne connectée détient toutes les portées de stockage, donc le hook et les politiques ci-dessus
décident pour elle. Une [clé API](/docs/backend/api-keys/) a aussi besoin de la portée de
stockage de l'opération, sur la source que nomme la requête : `storage:read` pour les
téléchargements, les métadonnées et les listages, `storage:write` pour les téléversements, les dossiers et chaque
étape d'un téléversement avec reprise, `storage:delete` pour les suppressions. La cible est
l'identifiant de la source, et celui de la source par défaut est `(default)` : `storage:read:(default)`,
`storage:write:avatars`. Sans elle, la réponse est `403 SCOPE_MISSING`. Avec elle,
le hook s'exécute quand même, en tant que l'identité pour laquelle la clé agit.

## Réagir à un téléversement

Toute autre écriture dans Rebase permet de déclencher une action — une ligne dispose de `beforeSave` et
`afterSave`, une planification dispose d'une tâche cron — alors qu'un téléversement ne proposait rien. Tout ce qu'un
téléversement impliquait devait être pris en charge par le client, lors d'un second appel, ce qui signifie que
l'action n'était pas exécutée du tout si le client se déconnectait entre-temps.

```ts
storageTriggers: [
    {
        path: "uploads/:uid/**",
        events: ["finalize"],
        handler: async ({ key, params, size, user }) => {
            await jobs.enqueue("index-upload", { key, uid: params.uid, size });
        }
    }
]
```

La syntaxe des motifs est identique à celle de `storagePolicies` — segments littéraux, `*`
pour un segment, `:name` pour en capturer un, `**` pour le reste — et un motif
mal formé empêche le démarrage au lieu d'ignorer silencieusement les événements.

| Événement | Moment de déclenchement |
| --- | --- |
| `finalize` | après l'écriture durable de l'objet ; jamais lors d'une écriture ayant échoué |
| `delete` | après la suppression de l'objet |

`finalize` se déclenche pour les flux multipart tout comme pour les téléversements avec reprise (TUS) — une seule fois
par téléversement, et non à chaque segment — et un téléversement avec reprise indique l'utilisateur qui l'a
*créé*, puisque c'est l'entité vérifiée lors de l'autorisation.

Ce qu'un gestionnaire (handler) ne doit pas présumer :

- **Un gestionnaire qui lève une exception ne fait pas échouer la requête.** L'objet est déjà stocké
  au moment de son exécution ; renvoyer une erreur au client indiquerait que
  le téléversement a échoué alors que ce n'est pas le cas, et les clients réessaient les téléversements. Les échecs sont journalisés
  et la réponse reste inchangée. Si le traitement doit impérativement avoir lieu, placez une tâche en file d'attente (queue).
- **Les gestionnaires sont attendus (`await`)**, dans l'ordre de leur déclaration, avant l'envoi de la réponse —
  exécuter en arrière-plan sans attendre laisserait une promesse qu'un environnement serverless pourrait
  geler en plein vol. Un gestionnaire lent entraîne donc un téléversement lent, ce qui constitue l'autre
  raison d'utiliser une file d'attente plutôt que d'exécuter le traitement sur place.
- **Les écritures internes ne déclenchent pas de triggers.** Le cache de rendus d'images écrit
  directement les objets dérivés dans le contrôleur de stockage ; un déclencheur `**` s'activant sur
  ces derniers s'exécuterait sur sa propre production.

## Étapes suivantes

- **[Stockage Frontend et Téléversements de fichiers](/docs/frontend/storage)** — Champs et hooks de téléversement de fichiers
- **[Propriétés](/docs/collections/properties)** — Configuration des propriétés de stockage
