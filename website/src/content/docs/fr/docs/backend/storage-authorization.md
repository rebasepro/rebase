---
sourceHash: b5b66e5876dc7d9c
title: Autorisation du stockage
sidebar_label: Autorisation du stockage
description: Décidez qui peut lire, écrire, supprimer ou lister chaque objet de stockage avec storagePolicies et le hook storageAuthorize, et de quelles portées de stockage une clé d'API a besoin.
---

Les collections sont protégées par la sécurité au niveau des lignes ; un bucket n'a pas
d'équivalent par objet, c'est donc ici que le stockage est autorisé. La [Configuration
du stockage](/docs/backend/storage/) couvre les backends eux-mêmes.

## Les politiques

La forme déclarative. Une liste de motifs de chemin, lue sans rien exécuter :

```ts
storagePolicies: [
    { path: "public/**", operations: ["read"], allow: "public" },
    { path: "users/:uid/**", allow: ({ params, user }) => user?.uid === params.uid }
]
```

**Une clé qu'aucune politique ne couvre est refusée**, sauf si un hook `storageAuthorize` l'autorise : le hook n'est sollicité que lorsqu'aucune politique ne correspond, et aucun des deux ne peut restreindre l'autre. Chaque élargissement est une ligne explicite, et une erreur refuse plutôt qu'elle n'autorise.

Les motifs correspondent **par segment, jamais par sous-chaîne** — `public/**` ne correspond pas à
`publicity/secret.png` :

| Motif | Correspond à |
|---|---|
| `avatars/logo.png` | exactement cette clé |
| `users/*/avatar.png` | exactement un segment à l'emplacement du `*` |
| `users/:uid/**` | un segment capturé, puis le reste — y compris rien |

`**` n'est permis qu'en dernier segment. `:name` capture un segment et ne traverse jamais
un `/` ; les captures arrivent sous forme de `params` dans le prédicat.

`allow` vaut `"public"` (n'importe qui), `"authenticated"` (tout appelant ayant un uid), ou un
prédicat qui reçoit les params capturés, l'utilisateur, l'opération et le bucket.
`operations` vaut par défaut les quatre — `read`, `write`, `delete`, `list`.

Les politiques satisfont à elles seules la garde de démarrage en production, et un motif mal formé
fait échouer le démarrage plutôt que le premier téléversement.

## Le hook

`requireAuth` et `publicRead` sont des interrupteurs *globaux* : ils décident si un appelant doit être connecté, pas ce que cet appelant peut toucher. Sans hook d'autorisation, **tout utilisateur authentifié peut lire toute clé qu'il peut nommer** — la seule chose qui sépare les fichiers de deux tenants est le caractère impossible à deviner des clés, ce qui n'est pas un modèle de contrôle d'accès. Pire, il peut d'abord faire un `GET /storage/list?prefix=`, de sorte que les clés n'ont même pas à être devinées.

:::caution[Le stockage ne démarre pas en production sans hook]
Les collections sont protégées par la sécurité au niveau des lignes ; le stockage ne l'est pas. Il n'y a pas
d'équivalent par objet dans le bucket, ce hook *est* donc le modèle — et
`initializeRebaseBackend` **lève une erreur au démarrage** sous `NODE_ENV=production` lorsque
le stockage est configuré et qu'aucun de ceux-ci n'est défini :

- `storageAuthorize` — un hook, par objet. Recommandé.
- `storagePublicRead: true` — le bucket est réellement un CDN public en lecture seule.
- `storageInsecureAllowAnyAuthenticated: true` — une application mono-tenant où chaque
  utilisateur connecté a la confiance de lire tous les fichiers. Son nom est fait pour qu'on le lise deux fois.

En développement, il consigne un avertissement à la place, de sorte qu'un projet peut se tromper sur ce point et
fonctionner très bien en local jusqu'au moment du déploiement. Un projet généré est livré avec un hook déjà présent dans
`config/storage.ts` — lisez-le avant de le remplacer, et notez qu'il modélise
une *bibliothèque de contenu partagée* de CMS, ce qui n'a pas la même forme que des fichiers par utilisateur.
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
| `key` | Clé de l'objet, préfixe du bucket retiré et traversée de chemin assainie |
| `bucket` | Bucket résolu (`"default"` si non précisé) |
| `operation` | `"read"`, `"write"`, `"delete"` ou `"list"` |
| `user` | `{ uid, email?, roles? }`, ou `null` là où la route autorise l'accès anonyme |
| `storageId` | Le backend nommé, lorsque la requête en visait un — sa clé canonique (`storageId=%20media` donne `"media"`). Absent pour la source par défaut, quelle que soit la façon dont la requête l'a désignée (aucun paramètre, vide, ou `(default)`) |
| `data` | Accès en lecture de confiance, **contournant le RLS** — `data.collection(slug).find(query)` / `.findById(id)`. La propriété réside dans une ligne, pas dans un préfixe de clé : le hook a donc besoin d'un lecteur pour répondre à « à qui appartient cet objet ? ». Il contourne volontairement la sécurité au niveau des lignes : ce hook *est* la décision d'autorisation, et la prendre à travers un lecteur déjà restreint par les propres permissions de l'appelant serait circulaire. En lecture seule par conception. |

Renvoyez `false` pour refuser avec un **403**. Lever une exception refuse aussi — une recherche de propriétaire qui échoue ne laisse pas passer.

À savoir :

- **La route de métadonnées est l'endroit où l'accès en lecture se décide réellement.** Elle émet le jeton de téléchargement à courte durée de vie, limité à un chemin, auquel la route de fichier fait confiance, de sorte que le hook la contrôle là. Deux lectures sautent le hook, par conception. Celle qui porte un tel jeton : le hook l'a approuvée lorsque le jeton a été émis, pour ce chemin et cette source uniquement, de sorte qu'un hook qui refuserait maintenant (une appartenance révoquée depuis) ne l'arrête pas avant l'expiration du jeton — `storageDownloadTokenTtl`, 300 secondes par défaut. Et la lecture d'une clé sous `public/` par un appelant sans identifiant : le préfixe est la déclaration que n'importe qui peut la lire, visiteurs anonymes et CDN compris. La lecture par un appelant connecté est quand même soumise au hook, mais celle d'un appelant anonyme ne l'est pas, de sorte qu'un hook ne peut pas rendre privée une clé `public/` ; stockez plutôt le fichier en dehors de `public/`. Seules ces deux lectures le sautent : un utilisateur que votre adaptateur d'authentification appelle `public` est soumis au hook comme n'importe qui.
- **Un bucket, un nom.** Sur S3 et GCS, le `bucket` du hook vaut toujours `"default"`, y compris lorsqu'une requête nomme le bucket du fournisseur, qui atteint les mêmes objets.
- **Un chemin est public lorsque la clé qu'il désigne l'est.** Le préfixe `public/` est testé sur la clé canonique que la route sert — après avoir lu en tête un segment de bucket `default/` et replié `//`, `./` et un `/` initial — jamais sur l'URL telle qu'elle est écrite. `/api/storage/file/notes://public/x.txt` désigne la clé privée `notes:/public/x.txt`, et la clé `default/public/x.txt` (atteinte par `/api/storage/file/default/default/public/x.txt`) se trouve dans un dossier appelé `default` ; aucune des deux n'est publique. Dans un hook, testez la `key` qui vous est remise avec `isPublicStorageKey` de `@rebasepro/types` — `isPublicStoragePath` lit un chemin ou une URL côté client, et considère ces deux-là comme publics.
- **`list` est contrôlé sur le préfixe.** Lister, c'est ainsi qu'on découvre des clés que personne ne vous a communiquées.
- **Les téléversements reprenables (TUS) sont contrôlés à la création**, de sorte qu'un téléversement refusé ne laisse aucun fichier temporaire.
- Omettre le hook (et `storagePolicies`) ne laisse aucun contrôle par objet : la production refuse donc de démarrer à moins que `storagePublicRead` ou `storageInsecureAllowAnyAuthenticated` ne soit défini.

## Clés d'API et jetons

Une personne connectée détient toutes les portées de stockage, ce sont donc le hook et les politiques
ci-dessus qui décident pour elle. Une [clé d'API](/docs/backend/api-keys/) a aussi besoin de la portée
de stockage correspondant à l'opération, sur la source que la requête nomme : `storage:read` pour
les téléchargements, les métadonnées et les listings, `storage:write` pour les téléversements, les dossiers et chaque
étape d'un téléversement reprenable, `storage:delete` pour les suppressions. La cible est l'identifiant
de la source, et celui de la source par défaut est `(default)` : `storage:read:(default)`,
`storage:write:avatars`. Sans elle, la réponse est `403 SCOPE_MISSING`. Avec elle,
le hook s'exécute quand même, en tant que celui au nom de qui la clé agit.

## Prochaines étapes

- **[Configuration du stockage](/docs/backend/storage/)** — backends, points de terminaison et limites
- **[Clés API](/docs/backend/api-keys/)** — les portées qu'une clé détient
