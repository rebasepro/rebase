---
sourceHash: 1e1ed4905f58d5fd
title: Autorisation du stockage
sidebar_label: Autorisation du stockage
description: Déterminez qui peut lire, écrire, supprimer ou lister chaque objet de stockage avec storagePolicies et le hook storageAuthorize, ainsi que les portées de stockage requises pour une clé d'API.
---

Les tables sont protégées par la sécurité au niveau des lignes (RLS) ; un bucket ne possède pas d'équivalent par objet, l'autorisation du stockage est donc gérée ici. La [Configuration du stockage](/docs/backend/storage/) traite des backends eux-mêmes.

## Politiques

La forme déclarative. Une liste de motifs de chemin, lus sans rien exécuter :

```ts
storagePolicies: [
    { path: "public/**", operations: ["read"], allow: "public" },
    { path: "users/:uid/**", allow: ({ params, user }) => user?.uid === params.uid }
]
```

**Une clé correspondant à aucune politique est refusée**, à moins qu'un hook `storageAuthorize` ne l'autorise : le hook n'est sollicité que si aucune politique ne correspond à la clé pour cette opération, et aucun ne peut restreindre l'autre. Une politique qui a correspondu sans accorder l'accès est définitive. Chaque élargissement est une ligne explicite, et une erreur entraîne un refus plutôt qu'une autorisation.

Les motifs correspondent **par segment, jamais par sous-chaîne** — `public/**` ne correspond pas à `publicity/secret.png` :

| Motif | Correspondance |
|---|---|
| `avatars/logo.png` | exactement cette clé |
| `users/*/avatar.png` | exactement un segment là où se trouve `*` |
| `users/:uid/**` | un segment capturé, puis le reste — y compris rien |

`**` n'est valide qu'en tant que dernier segment. `:name` capture un segment et ne traverse jamais un `/` ; les captures sont transmises sous forme de `params` au prédicat.

`allow` vaut `"public"` (quiconque est autorisé par la route), `"authenticated"` (tout appelant disposant d'un uid), ou un prédicat recevant les params capturés, l'utilisateur, l'opération et le bucket.

Une politique s'exécute après l'authentification de la route, donc `"public"` seul n'ouvre pas un chemin aux appelants anonymes. Avec `requireAuth` activé, ils ne peuvent effectuer que des lectures de clés `public/`, ou toutes les lectures avec `storagePublicRead` ; `/upload`, `/list`, les suppressions et les téléversements avec reprise nécessitent toujours un appelant. Ailleurs, la réponse est `401`.

`operations` prend par défaut les quatre valeurs — `read`, `write`, `delete`, `list`.

Les politiques satisfont à elles seules la vérification de démarrage en production, et un motif mal formé fait échouer le démarrage plutôt que le premier téléversement.

## Le hook

`requireAuth` et `publicRead` sont des commutateurs *globaux* : ils déterminent si un appelant doit être connecté, et non ce à quoi il a le droit d'accéder. Sans hook d'autorisation, **tout utilisateur authentifié peut lire n'importe quelle clé dont il connaît le nom** — la seule chose séparant les fichiers de deux locataires (tenants) est l'impossibilité de deviner la clé, ce qui ne constitue pas un modèle de contrôle d'accès. Pire encore, ils peuvent d'abord exécuter `GET /storage/list?prefix=`, de sorte qu'il n'est même pas nécessaire de deviner les clés.

:::caution[Le stockage ne démarrera pas en production sans l'un de ces éléments]
Les tables sont protégées par la sécurité au niveau des lignes (RLS) ; ce n'est pas le cas du stockage. Il n'existe pas d'équivalent par objet dans le bucket, ce hook *est* donc le modèle — et `initializeRebaseBackend` **lève une exception au démarrage** sous `NODE_ENV=production` lorsque le stockage est configuré et qu'aucun de ces paramètres n'est défini :

- `storageAuthorize` — un hook, par objet. Recommandé.
- `storagePolicies` — les règles déclarées ci-dessus.
- `storagePublicRead: true` — le bucket est véritablement un CDN public en lecture seule.
- `storageInsecureAllowAnyAuthenticated: true` — une application mono-tenant où chaque utilisateur connecté a accès à chaque fichier. Nommé ainsi pour inciter à y réfléchir à deux fois.

En développement, un avertissement est journalisé à la place ; un projet peut donc comporter cette erreur et fonctionner parfaitement en local jusqu'à son déploiement. Un projet généré inclut déjà un hook dans `backend/storage.ts` — lisez-le avant de le remplacer, et notez qu'il modélise la *bibliothèque de contenu partagée* d'un CMS, ce qui n'a pas la même structure que des fichiers spécifiques à chaque utilisateur.
:::

`storageAuthorize` est l'analogue pour le stockage du `rls` d'une table, et s'exécute après l'authentification sur chaque route de stockage :

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
| `key` | Clé de l'objet, préfixe de bucket retiré et traversée nettoyée |
| `bucket` | Bucket résolu (`"default"` si non spécifié) |
| `operation` | `"read"`, `"write"`, `"delete"` ou `"list"` |
| `user` | `{ uid, email?, roles? }`, ou `null` lorsque la route autorise l'accès anonyme |
| `storageId` | Le backend nommé, lorsque la requête en ciblait un — sa clé canonique (`storageId=%20media` devient `"media"`). Absent pour la source par défaut, quelle que soit la façon dont la requête l'a nommée (aucun paramètre, vide ou `(default)`) |
| `data` | Accès en lecture approuvé, **contournant le RLS** — `data.table(slug).find(query)` / `.findById(id)`. La propriété réside dans une ligne et non dans un préfixe de clé, le hook a donc besoin d'un lecteur pour répondre à « qui possède cet objet ? ». Il contourne délibérément la sécurité au niveau des lignes : ce hook *est* la décision d'autorisation, et la prendre via un lecteur déjà restreint par les permissions de l'appelant lui-même serait une démarche circulaire. Conçu pour être en lecture seule. |

Renvoyez `false` pour refuser l'accès avec un **403**. Lever une exception refuse également — une recherche de propriété qui échoue n'ouvre pas l'accès par défaut.

Bon à savoir :

- **La route des métadonnées est l'endroit où l'accès en lecture est réellement décidé.** Elle génère le jeton de téléchargement à courte durée de vie et restreint au chemin auquel la route du fichier fait confiance, de sorte que le hook en contrôle l'accès à ce niveau. Deux lectures contournent le hook, par conception. L'une comportant un tel jeton : le hook l'a approuvé lors de l'émission du jeton, pour ce chemin et cette source uniquement ; ainsi, un hook qui refuserait désormais (une adhésion révoquée depuis) ne l'arrêtera pas avant l'expiration du jeton — `storageDownloadTokenTtl`, 300 secondes par défaut. Et la lecture d'une clé sous `public/` par un appelant sans identifiants : le préfixe déclare que tout le monde peut la lire, visiteurs anonymes et CDN inclus. La lecture par un appelant connecté fait toujours l'objet d'une vérification, mais pas celle d'un appelant anonyme ; un hook ne peut donc pas rendre privée une clé `public/` ; stockez plutôt le fichier en dehors de `public/`. Seules ces deux lectures le contournent : un utilisateur que votre adaptateur d'authentification appellerait par hasard `public` est vérifié comme n'importe qui d'autre.
- **Un bucket, un nom.** Sur S3 et GCS, le `bucket` du hook est toujours `"default"`, même lorsqu'une requête nomme le bucket du fournisseur, qui accède aux mêmes objets.
- **Un chemin est public lorsque la clé qu'il désigne l'est.** Le préfixe `public/` est testé sur la clé canonique servie par la route — après avoir retiré un segment initial de bucket `default/` et réduit `//`, `./` et un `/` initial — jamais sur l'URL telle qu'elle est écrite. `/api/storage/file/notes://public/x.txt` désigne la clé privée `notes:/public/x.txt`, et la clé `default/public/x.txt` (accessible via `/api/storage/file/default/default/public/x.txt`) se trouve dans un dossier nommé `default` ; aucune des deux n'est publique. Dans un hook, testez la `key` qui vous est fournie avec `isPublicStorageKey` de `@rebasepro/types` — `isPublicStoragePath` analyse un chemin ou une URL côté client, et traite ces deux cas comme publics.
- **`list` est contrôlé sur le préfixe.** Le listage est le moyen de découvrir des clés dont personne ne vous a parlé.
- **Les téléversements avec reprise (TUS) sont contrôlés lors de la création**, de sorte qu'un téléversement refusé ne laisse aucun fichier temporaire derrière lui.
- L'omission du hook (et de `storagePolicies`) supprime toute vérification par objet, la production refusera donc de démarrer à moins que `storagePublicRead` ou `storageInsecureAllowAnyAuthenticated` ne soit défini.

## Clés d'API et jetons

Une personne connectée détient toutes les portées de stockage, de sorte que le hook et les politiques ci-dessus tranchent pour elle. Une [clé d'API](/docs/backend/api-keys/) nécessite également la portée de stockage correspondant à l'opération, sur la source désignée par la requête : `storage:read` pour les téléchargements, les métadonnées et les listages, `storage:write` pour les téléversements, les dossiers et chaque étape d'un téléversement avec reprise, `storage:delete` pour les suppressions. La cible est l'identifiant de la source, et celui de la source par défaut est `(default)` : `storage:read:(default)`, `storage:write:avatars`. Sans cela, la réponse est `403 SCOPE_MISSING`. Avec celle-ci, le hook s'exécute quand même, sous l'identité représentée par la clé.

## Étapes suivantes

- **[Configuration du stockage](/docs/backend/storage/)** — backends, points de terminaison et limites
- **[Clés d'API](/docs/backend/api-keys/)** — les portées associées à une clé
