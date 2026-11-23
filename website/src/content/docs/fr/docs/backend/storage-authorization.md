---
sourceHash: 20aec4c8317aa338
title: Autorisation de stockage
sidebar_label: Autorisation de stockage
description: Déterminez qui peut lire, écrire, supprimer ou lister chaque objet de stockage avec storagePolicies et le hook storageAuthorize, ainsi que les portées de stockage requises pour une clé API.
---

Les tables sont protégées par la sécurité au niveau des lignes (row-level security ou RLS) ; un bucket n'ayant pas d'équivalent par objet, l'autorisation du stockage est donc gérée ici. La [configuration du stockage](/docs/backend/storage/) couvre les backends eux-mêmes.

## Politiques

La forme déclarative. Une liste de motifs de chemins, lus sans rien exécuter :

```ts
storagePolicies: [
    { path: "public/**", operations: ["read"], allow: "public" },
    { path: "users/:uid/**", allow: ({ params, user }) => user?.uid === params.uid }
]
```

**Une clé ne correspondant à aucune politique est refusée**, sauf si un hook `storageAuthorize` l'autorise : le hook n'est sollicité que lorsqu'aucune politique n'a correspondu à la clé pour cette opération, et aucun des deux ne peut restreindre l'autre. Une politique qui a correspondu sans accorder l'accès est définitive. Chaque élargissement est une ligne explicite, et une erreur entraîne un refus plutôt qu'un accord.

Les motifs correspondent **par segment, jamais par sous-chaîne** — `public/**` ne correspond pas à `publicity/secret.png` :

| Motif | Correspondance |
|---|---|
| `avatars/logo.png` | exactement cette clé |
| `users/*/avatar.png` | exactement un segment là où se trouve `*` |
| `users/:uid/**` | un segment capturé, puis le reste — y compris rien |

`**` n'est valide qu'en tant que dernier segment. `:name` capture un segment et ne traverse jamais un `/` ; les captures sont transmises sous forme de `params` au prédicat.

`allow` peut valoir `"public"` (quiconque est autorisé par la route), `"authenticated"` (tout appelant disposant d'un uid), ou un prédicat recevant les paramètres capturés, l'utilisateur, l'opération et le bucket.

Une politique s'exécute après l'authentification de la route, de sorte que `"public"` seul n'ouvre pas un chemin aux appelants anonymes. Avec `requireAuth` activé, ils ne peuvent effectuer que la lecture des clés sous `public/`, ou toutes les lectures avec `storagePublicRead` ; `/upload`, `/list`, les suppressions et les téléversements avec reprise (resumable uploads) nécessitent toujours un appelant. Ailleurs, la réponse est `401`.

`operations` prend par défaut les quatre opérations — `read`, `write`, `delete`, `list`.

Les politiques satisfont à elles seules la vérification de démarrage en production, et un motif mal formé fait échouer le démarrage plutôt que le premier téléversement.

### Sous forme de données : `STORAGE_POLICIES`

Le runtime managé ne peut pas lire de prédicat depuis votre code, et un projet utilisant le backend standard de Rebase Cloud n'a aucun code à lire. Les mêmes règles peuvent donc être définies sous forme de JSON dans la variable d'environnement `STORAGE_POLICIES`, les deux prédicats que presque toutes les applications écrivent étant nommés plutôt que codés :

```bash
STORAGE_POLICIES='[
  { "path": "public/**", "operations": ["read"], "allow": "public" },
  { "path": "users/:uid/**", "allow": "owner" },
  { "path": "**", "allow": { "roles": ["admin"] } }
]'
```

| `allow` | Accorde |
|---|---|
| `"public"` | quiconque est autorisé par la route |
| `"authenticated"` | tout appelant authentifié |
| `"owner"` | l'appelant authentifié dont l'uid correspond au segment `:uid` de la clé — le `path` doit en capturer un |
| `{ "roles": [...] }` | un appelant authentifié possédant l'un de ces rôles |

Elles se compilent en `storagePolicies`, de sorte que la correspondance, l'ordre et le repli sur `storageAuthorize` sont identiques à la forme en code : une clé qu'aucune règle ne couvre est soumise au hook si le projet en possède un, et refusée sinon. Une valeur qui n'est pas une liste valide bloque le démarrage en indiquant chaque problème ; Rebase Cloud refuse d'en enregistrer une invalide, et sa console permet de modifier la liste sous **File storage → Access rules**.

## Le hook

`requireAuth` et `publicRead` sont des commutateurs *globaux* : ils déterminent si un appelant doit être connecté, et non ce à quoi il a le droit d'accéder. Sans hook d'autorisation, **tout utilisateur authentifié peut lire n'importe quelle clé dont il connaît le nom** — la seule chose qui sépare les fichiers de deux locataires (tenants) est l'impossibilité de deviner la clé, ce qui ne constitue pas un modèle de contrôle d'accès. Pire encore, ils peuvent d'abord exécuter `GET /storage/list?prefix=`, de sorte que les clés n'ont même pas besoin d'être devinées.

:::caution[Le stockage ne démarrera pas en production sans hook ni politique]
Les tables sont protégées par la sécurité au niveau des lignes (RLS) ; ce n'est pas le cas du stockage. Il n'y a pas d'équivalent par objet dans le bucket, ce hook *est* donc le modèle — et `initializeRebaseBackend` **lève une exception au démarrage** sous `NODE_ENV=production` lorsque le stockage est configuré et qu'aucun de ces éléments n'est défini :

- `storageAuthorize` — un hook, par objet. Recommandé.
- `storagePolicies` — les règles déclarées ci-dessus.
- `storagePublicRead: true` — le bucket est réellement un CDN public en lecture seule.
- `storageInsecureAllowAnyAuthenticated: true` — une application mono-tenant où chaque utilisateur connecté est digne de confiance pour chaque fichier. Nommé ainsi pour être lu à deux fois.

En développement, un avertissement est consigné à la place, de sorte qu'un projet peut comporter cette erreur et fonctionner correctement en local jusqu'à son déploiement. Un projet généré (scaffolded) inclut déjà un hook dans `backend/storage.ts` — lisez-le avant de le remplacer, et notez qu'il modélise la *bibliothèque de contenu partagé* d'un CMS, ce qui n'a pas la même structure que des fichiers par utilisateur.
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
| `key` | Clé de l'objet, préfixe de bucket retiré et traversée de chemin nettoyée |
| `bucket` | Bucket résolu (`"default"` lorsqu'il n'est pas spécifié) |
| `operation` | `"read"`, `"write"`, `"delete"` ou `"list"` |
| `user` | `{ uid, email?, roles? }`, ou `null` lorsque la route autorise l'accès anonyme |
| `storageId` | Le backend nommé, lorsque la requête en ciblait un — sa clé canonique (`storageId=%20media` devient `"media"`). Absent pour la source par défaut, quelle que soit la manière dont la requête l'a désignée (aucun paramètre, vide ou `(default)`) |
| `data` | Accès en lecture de confiance, **contournant la RLS** — `data.table(slug).find(query)` / `.findById(id)`. La propriété résidant dans une ligne et non dans un préfixe de clé, le hook a besoin d'un lecteur pour répondre à la question « à qui appartient cet objet ? ». Il contourne délibérément la sécurité au niveau des lignes : ce hook *est* la décision d'autorisation, et la prendre par le biais d'un lecteur déjà restreint par les permissions de l'appelant lui-même serait une dépendance circulaire. En lecture seule par conception. |

Renvoyez `false` pour refuser avec un code **403**. Lever une exception refuse également — une recherche de propriété qui échoue ne laisse pas l'accès ouvert.

Bon à savoir :

- **La route de métadonnées est l'endroit où l'accès en lecture est réellement décidé.** Elle génère le jeton de téléchargement à courte durée de vie et limité au chemin, auquel la route de fichier fait confiance ; le hook contrôle donc l'accès à ce niveau. Deux lectures ignorent le hook, par conception. Une lecture porteuse d'un tel jeton : le hook l'a approuvée lors de la création du jeton, pour ce chemin et cette source uniquement, de sorte qu'un hook qui refuserait désormais l'accès (une adhésion révoquée depuis) ne l'interrompt pas avant l'expiration du jeton — `storageDownloadTokenTtl`, 300 secondes par défaut. Et la lecture d'une clé sous `public/` par un appelant sans identifiants : le préfixe déclare que n'importe qui peut la lire, y compris les visiteurs anonymes et les CDN. La lecture par un appelant connecté est toujours soumise au hook, mais pas celle d'un appelant anonyme, de sorte qu'un hook ne peut pas rendre privée une clé sous `public/` ; stockez plutôt le fichier en dehors de `public/`. Seules ces deux lectures l'ignorent : un utilisateur que votre adaptateur d'authentification appellerait par hasard `public` est évalué comme n'importe qui d'autre.
- **Un bucket, un nom.** Sur S3 et GCS, le `bucket` du hook est toujours `"default"`, y compris lorsqu'une requête nomme le bucket du fournisseur, qui cible les mêmes objets.
- **Un chemin est public lorsque la clé qu'il désigne l'est.** Le préfixe `public/` est testé sur la clé canonique servie par la route — après suppression du segment initial de bucket `default/` et réduction de `//`, `./` et du `/` initial — jamais sur l'URL telle qu'écrite. `/api/storage/file/notes://public/x.txt` désigne la clé privée `notes:/public/x.txt`, et la clé `default/public/x.txt` (accessible via `/api/storage/file/default/default/public/x.txt`) se trouve dans un dossier nommé `default` ; aucune des deux n'est publique. Dans un hook, testez la `key` qui vous est fournie avec `isPublicStorageKey` de `@rebasepro/types` — `isPublicStoragePath` analyse un chemin ou une URL côté client, et considérerait les deux comme publics.
- **`list` est restreint selon le préfixe.** Le listage permet de découvrir des clés dont personne ne vous a communiqué l'existence.
- **Les téléversements avec reprise (TUS) sont contrôlés au moment de la création**, de sorte qu'un téléversement refusé ne laisse aucun fichier temporaire derrière lui.
- Omettre le hook (ainsi que `storagePolicies` et `STORAGE_POLICIES`) supprime toute vérification par objet ; la production refusera donc de démarrer à moins que `storagePublicRead` ou `storageInsecureAllowAnyAuthenticated` ne soit défini.

## Clés API et jetons

Une personne connectée dispose de toutes les portées (scopes) de stockage ; le hook et les politiques ci-dessus décident donc pour elle. Une [clé API](/docs/backend/api-keys/) a également besoin de la portée de stockage pour l'opération, sur la source ciblée par la requête : `storage:read` pour les téléchargements, métadonnées et listages, `storage:write` pour les téléversements, dossiers et chaque étape d'un téléversement avec reprise, `storage:delete` pour les suppressions. La cible est l'identifiant de la source, et celui de la source par défaut est `(default)` : `storage:read:(default)`, `storage:write:avatars`. Sans cela, la réponse est `403 SCOPE_MISSING`. Avec celle-ci, le hook s'exécute tout de même, en agissant sous l'identité représentée par la clé.

## Prochaines étapes

- **[Configuration du stockage](/docs/backend/storage/)** — backends, points de terminaison et limites
- **[Clés API](/docs/backend/api-keys/)** — les portées associées à une clé
