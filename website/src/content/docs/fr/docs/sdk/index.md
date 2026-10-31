---
sourceHash: a1afbafa7c27ef28
title: SDK typé — Prise en main
sidebar_label: Prise en main
description: Installez et configurez le SDK typé Rebase pour interagir avec votre backend depuis n'importe quelle application JavaScript ou TypeScript.
---

## Vue d'ensemble

Le package `@rebasepro/client` fournit un SDK JavaScript type-safe pour interagir avec votre backend Rebase. Il gère :

- **Opérations sur les données** — CRUD avec filtrage, tri et pagination
- **Récupération des relations** — Incluez les entités liées avec `.include()`
- **Abonnements en temps réel** — Mises à jour en direct basées sur WebSocket
- **Synchronisation hors ligne et local-first** — Base de données locale de lignes optionnelle, écritures hors ligne instantanées, requêtes en direct
- **Authentification** — Gestion des jetons, connexion, inscription, OAuth
- **Stockage** — Téléversement, téléchargement et gestion de fichiers
- **Fonctions personnalisées** — Appel de points de terminaison serveur personnalisés

## Installation

```bash
pnpm add @rebasepro/client
```

## Création d'un client

`rebase dev` déduit un port libre à partir du chemin du projet plutôt que d'en utiliser un fixe, par conséquent **lisez `baseUrl` depuis l'URL qu'il a affichée** — il n'existe aucun port partagé par tous les projets. Dans un frontend Vite, il s'agit de la valeur `VITE_API_URL` que le scaffolding écrit dans `.env` ; dans un script, utilisez votre propre variable d'environnement.

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({
    baseUrl: import.meta.env.VITE_API_URL,
});
```

L'URL `websocketUrl` est déduite automatiquement de `baseUrl` (`http → ws`, `https → wss`). Vous pouvez la remplacer explicitement si nécessaire :

```typescript
const client = createRebaseClient({
    baseUrl: import.meta.env.VITE_API_URL,
    websocketUrl: import.meta.env.VITE_WS_URL,
});
```

### Options de configuration

| Option | Type | Description |
|--------|------|-------------|
| `baseUrl` | `string` | URL du backend. Lisez-la depuis ce que `rebase dev` a affiché, ou depuis votre déploiement |
| `websocketUrl` | `string` | URL WebSocket — déduite automatiquement de `baseUrl` si omise |
| `token` | `string` | Jeton JWT statique pour les appels de serveur à serveur |
| `apiPath` | `string` | Préfixe de l'API (par défaut : `"/api"`) |
| `fetch` | `typeof fetch` | Implémentation fetch personnalisée (ex. pour le SSR) |
| `onUnauthorized` | `() => Promise<boolean>` | Gestionnaire 401 personnalisé — retournez `true` pour réessayer |
| `realtime` | `boolean \| RealtimeClientOptions` | Ouvre le WebSocket (par défaut `true`) — définissez `false` dans les scripts ponctuels. `{ affinity }` [nomme le groupe auquel appartient le socket](/docs/sdk/realtime#keeping-a-group-on-one-instance) |
| `collections` | `Record<string, string>` | Associe les noms des accesseurs aux slugs des collections |
| `offline` | `boolean \| OfflineConfig` | [Synchronisation local-first](/docs/sdk/offline) — désactivée par défaut |
| `impersonate` | `string` | Exécute chaque requête en tant que cet utilisateur, par uid, pour vérifier ce qu'un utilisateur spécifique peut voir. Seule la session d'un administrateur le permet : l'API de données, les fonctions et le temps réel s'exécutent en tant que cet utilisateur, et toutes les autres routes refusent |
| `debug` | `boolean` | Journalise la progression de la connexion temps réel avec `console.debug` (par défaut `false`) — voir [Journalisation de la connexion](#journalisation-de-la-connexion) |

### Journalisation de la connexion

Par défaut, le client n'affiche rien concernant sa connexion en temps réel, de sorte qu'une page publique n'indique rien sur son backend dans la console d'un visiteur. Les avertissements et les erreurs sont toujours affichés. Pour voir la connexion s'ouvrir, s'authentifier, se déconnecter et se reconnecter, passez `debug: true`, ou activez-le dans un navigateur sans modifier le site en exécutant ceci dans sa console :

```js
localStorage.setItem("rebase_debug", "1"); // localStorage.removeItem("rebase_debug") to stop
```

Cela s'applique à partir de la prochaine ligne journalisée par le client, ainsi une page déjà connectée n'a pas besoin d'être rechargée. En dehors d'un navigateur, définissez `globalThis.__REBASE_DEBUG__ = true`. Les navigateurs n'affichent `console.debug` qu'au niveau Verbeux (Verbose).

## Génération du SDK typé

Générez un client entièrement typé à partir des définitions de vos collections :

```bash
rebase generate-sdk
```

Tant que `rebase dev` est en cours d'exécution, vous n'avez pas besoin de le faire : il régénère les types dans `generated/sdk/` au démarrage et à chaque enregistrement sous `config/collections/`. Exécutez la commande vous-même en CI, dans un dépôt frontend qui ne contient pas de collections (`rebase generate-sdk --from link`), ou partout où `rebase dev` ne tourne pas. Sur la version 0.23, `rebase dev` ne touche pas aux types du SDK, vous devez donc exécuter la commande après chaque modification de collection.

Passez ensuite le paramètre de type `Database` à `createRebaseClient` pour bénéficier de l'autocomplétion complète :

```typescript
import { createRebaseClient } from "@rebasepro/client";
import { collectionsDictionary, type Database } from "./generated/sdk/database.types";

const client = createRebaseClient<Database>({
    baseUrl: import.meta.env.VITE_API_URL,
    collections: collectionsDictionary,
});

// Full autocomplete on collection names and field types
const { data } = await client.data.products.find();
```

Lorsque `Database` est fourni, `createRebaseClient` renvoie une instance de `CreateRebaseClientResult<DB>`. Cela associe directement les accesseurs de collections en camelCase sur `client.data` à leurs types correspondants, vous offrant une autocomplétion complète sur les opérations et les types de collections (ex. `client.data.products.find()`).

`collectionsDictionary` réassocie chaque accesseur au slug utilisé sur le réseau. **`collections` est obligatoire pour un client typé.** Les types proposent chaque accesseur, que vous le passiez ou non, mais sans cela, `client.data.myNotes` est envoyé à `/data/my_notes`, l'accesseur en snake_case, donc un slug comme `my-notes` ou un accesseur renommé renverra une 404. Le client émet un avertissement unique, précisant l'accesseur et la solution. Une version ultérieure rendra `collections` obligatoire dans les types lorsque `Database` est fourni.

Certains noms sur `client.data` sont réservés : `collection` est la fonction dynamique `collection(slug)`, et `then`, `toJSON` ainsi que `$$typeof` sont préservés pour les promesses et les vérifications de sérialisation. Une collection dont l'accesseur correspondrait à l'un de ces noms est générée sous la forme `<name>Collection` — le slug `collection` devient `client.data.collectionCollection` — et `generate-sdk` affiche un avertissement mentionnant les deux. `client.data.collection("collection")` permet également d'y accéder.

### Noms des champs

**Le nom d'un champ sur le réseau correspond à sa clé de propriété**, et l'API utilise le camelCase partout. Une propriété `createdAt` stockée dans une colonne `created_at` correspond à `row.createdAt`, et la clé étrangère d'une relation est `authorId` même si la colonne reste `author_id`. `where` et `orderBy` sont basés sur le même type `Row`, garantissant ainsi que ce qui compile correspond à ce à quoi le backend répond.

Une clé de propriété que *vous* avez écrite reste votre clé, quelle que soit sa forme — rien ne renomme un nom que vous avez choisi. Les deux clés qui sont dérivées plutôt que déclarées, à savoir la clé étrangère d'une relation et une colonne lue par introspection, sont en camelCase.

`Row` décrit une lecture, `Insert` un `create()` et `Update` un `update()` — ils n'ont pas la même structure. Une colonne qui n'est pas requise est de type `T | null` sur les trois, afin qu'une écriture puisse la vider ; la clé primaire est toujours présente lors d'une lecture et ne peut jamais être définie lors d'une mise à jour ; une cible `belongsTo` peut être écrite soit sous la forme de la relation (`{ author: 5 }`), soit via sa clé étrangère (`{ authorId: 5 }`), une relation obligatoire étant satisfaite par l'un ou l'autre ; un `hasOne` s'écrit en nommant la ligne cible (`{ profile: 9 }`), ou `null` pour la détacher ; un `via` à saut unique s'écrit selon le type qu'il remplace (to-one : l'identifiant de la cible ou `null` ; to-many : une liste d'identifiants), tandis qu'un `via` multi-sauts est en lecture seule et ne figure sur aucun des deux ; et une appartenance `hasMany` ou `manyToMany` s'écrit sous forme d'une liste d'identifiants cibles ou d'objets `{ id }` (`{ tags: ["t-1"] }`), chacun comportant un `_pivot` lorsque la table de jonction déclare des colonnes de charge utile. Un champ que personne ne peut écrire (`access: { write: [] }`) ne figure ni sur `Insert` ni sur `Update`. Une colonne `date` est lue sous forme de chaîne ISO, et une écriture accepte soit cette chaîne, soit un `Date`.

## Exemple rapide

```typescript
// Create
const product = await client.data.products.create({
    name: "Camera",
    price: 299,
});

// Query with filters
const { data } = await client.data.products
    .where("price", ">=", 100)
    .orderBy("createdAt", "desc")
    .limit(10)
    .find();

// Real-time subscription
const unsubscribe = client.data.products.listen(
    { where: { active: ["==", true] } },
    (response) => console.log("Updated:", response.data)
);
```

## Utilisation avec React

Dans un frontend Rebase, le client est créé une seule fois et partagé via un contexte :

```tsx no-verify
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: API_URL });

<Rebase client={client} ...>
```

Accédez-y depuis n'importe quel composant :

```tsx
import { useRebaseClient } from "@rebasepro/app";

function MyComponent() {
    const client = useRebaseClient();
    // client.data, client.auth, client.storage, client.functions
}
```

## Prochaines étapes

- **[Interroger les données](/docs/sdk/querying)** — CRUD, filtres, pagination et relations
- **[Authentification](/docs/sdk/authentication)** — Connexion, inscription, OAuth, sessions
- **[Abonnements en temps réel](/docs/sdk/realtime)** — Données en direct avec les WebSockets
- **[Synchronisation hors ligne et local-first](/docs/sdk/offline)** — Travaillez sans connexion et synchronisez lorsqu'elle revient
- **[Stockage et fichiers](/docs/sdk/storage)** — Téléversez, téléchargez et gérez des fichiers
