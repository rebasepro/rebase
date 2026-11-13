---
sourceHash: d3b3f413d231c3d0
title: SDK typé — Prise en main
sidebar_label: Prise en main
description: Installez et configurez le SDK typé Rebase pour interagir avec votre backend depuis n'importe quelle application JavaScript ou TypeScript.
---

## Vue d'ensemble

Le package `@rebasepro/client` fournit un SDK JavaScript type-safe pour interagir avec votre backend Rebase. Il gère :

- **Opérations sur les données** — CRUD avec filtrage, tri et pagination
- **Récupération des relations** — Incluez les entités associées avec `.include()`
- **Abonnements en temps réel** — Mises à jour en direct via WebSocket
- **Synchronisation hors ligne et local-first** — Base de données locale de lignes optionnelle, écritures hors ligne instantanées, requêtes en direct
- **Authentification** — Gestion des jetons, connexion, inscription, OAuth
- **Stockage** — Téléversement, téléchargement et gestion de fichiers
- **Fonctions personnalisées** — Appel de points de terminaison serveur personnalisés

## Installation

```bash
pnpm add @rebasepro/client
```

## Création d'un client

`rebase dev` dérive un port libre à partir du chemin du projet plutôt que d'en utiliser un fixe, donc **lisez `baseUrl` depuis l'URL qu'il affiche** — aucun port n'est partagé par tous les projets. Dans un frontend Vite, il s'agit de la variable `VITE_API_URL` que le scaffolding écrit dans `.env` ; dans un script, d'une variable d'environnement qui vous est propre.

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({
    baseUrl: import.meta.env.VITE_API_URL,
});
```

`websocketUrl` est dérivée automatiquement de `baseUrl` (`http → ws`, `https → wss`). Vous pouvez la remplacer explicitement si nécessaire :

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
| `websocketUrl` | `string` | URL WebSocket — dérivée automatiquement de `baseUrl` si omise |
| `token` | `string` | Jeton JWT statique pour les appels de serveur à serveur |
| `apiPath` | `string` | Préfixe de l'API (par défaut : `"/api"`) |
| `fetch` | `typeof fetch` | Implémentation personnalisée de fetch (ex. pour le SSR) |
| `onUnauthorized` | `() => Promise<boolean>` | Gestionnaire 401 personnalisé — retourner `true` pour réessayer |
| `realtime` | `boolean \| RealtimeClientOptions` | Ouvre le WebSocket (par défaut `true`) — définir sur `false` dans les scripts ponctuels. `{ affinity }` [nomme le groupe auquel appartient le socket](/docs/sdk/realtime#keeping-a-group-on-one-instance) |
| `tables` | `Record<string, string>` | <span class="since-badge" data-since="0.31">Depuis 0.31</span> Mappe les noms d'accesseurs aux slugs de table — le `tablesDictionary` généré |
| `offline` | `boolean \| OfflineConfig` | [Synchronisation local-first](/docs/sdk/offline) — désactivée par défaut |
| `impersonate` | `string` | Exécute chaque requête en tant que cet utilisateur, par uid, pour vérifier ce qu'un utilisateur donné peut voir. Seule la session d'un administrateur le permet : l'API de données, les fonctions et le realtime s'exécutent en tant que cet utilisateur, et toutes les autres routes refusent |
| `debug` | `boolean` | Journalise la progression de la connexion temps réel avec `console.debug` (par défaut `false`) — voir [Journalisation de la connexion](#journalisation-de-la-connexion) |

### Journalisation de la connexion

Le client n'affiche rien concernant sa connexion en temps réel par défaut, de sorte qu'une page publique ne révèle rien sur son backend dans la console d'un visiteur. Les avertissements et les erreurs sont toujours affichés. Pour observer l'ouverture de la connexion, l'authentification, la déconnexion et la reconnexion, passez `debug: true`, ou activez-le dans un navigateur sans modifier le site en exécutant ceci dans sa console :

```js
localStorage.setItem("rebase_debug", "1"); // localStorage.removeItem("rebase_debug") to stop
```

Cela s'applique dès la prochaine ligne journalisée par le client ; une page déjà connectée n'a donc pas besoin d'être rechargée. En dehors d'un navigateur, définissez `globalThis.__REBASE_DEBUG__ = true`. Les navigateurs n'affichent `console.debug` qu'au niveau Verbeux.

## Génération du SDK typé

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Générez un client entièrement typé à partir de vos tables :

```bash
rebase generate-sdk
```

Tant que `rebase dev` est en cours d'exécution, vous n'avez pas besoin de le faire : il régénère les types dans `generated/sdk/` au démarrage et à chaque enregistrement sous `backend/schema/`. Exécutez vous-même la commande en CI, dans un dépôt frontend qui ne possède pas ses propres tables (`rebase generate-sdk --from link`), ou partout où `rebase dev` ne tourne pas. `generate-sdk` lit les tables exportées par `backend/schema/index.ts`, via le même chargeur que le backend utilise pour démarrer ; `--from` lit plutôt les `tables` depuis `/api/meta/contract` d'un backend en cours d'exécution.

Passez ensuite le paramètre de type `Database` à `createRebaseClient` pour bénéficier de l'autocomplétion complète :

```typescript
import { createRebaseClient } from "@rebasepro/client";
import { tablesDictionary, type Database } from "./generated/sdk/database.types";

const client = createRebaseClient<Database>({
    baseUrl: import.meta.env.VITE_API_URL,
    tables: tablesDictionary,
});

// Full autocomplete on table names and field types
const { data } = await client.data.products.find();
```

Lorsque `Database` est fourni, `createRebaseClient` retourne une instance de `CreateRebaseClientResult<DB>`. Cela mappe directement les accesseurs de table en camelCase sur `client.data` à leurs types correspondants, vous offrant une autocomplétion complète sur les opérations de table et les types (par ex. `client.data.products.find()`).

`tablesDictionary` mappe chaque accesseur au slug utilisé sur le réseau. Le module généré exporte également `TableName`, l'union de chaque slug, et le type `TablesDictionary`. **`tables` est requis pour un client typé.** Les types proposent tous les accesseurs, que vous le passiez ou non, mais sans lui, `client.data.myNotes` est envoyé à `/data/my_notes`, l'accesseur en snake_case, de sorte qu'un slug comme `my-notes` ou un accesseur renommé renvoie une erreur 404. Le client émet un avertissement une seule fois, en indiquant l'accesseur et le correctif. Avec le dictionnaire, un accesseur qui n'y figure pas lève une erreur `RebaseClientError` avec le code `UNKNOWN_TABLE` et une suggestion. Une version ultérieure rendra `tables` obligatoire dans les types lorsque `Database` est fourni.

Quelques noms sur `client.data` sont réservés : `table` est la fonction dynamique `table(slug)`, `batch` est [`client.batch`](/docs/sdk/writing/#writing-across-tables), et `then`, `toJSON` et `$$typeof` sont laissés intacts pour les vérifications de promesses et de sérialisation. Une table dont l'accesseur serait `table`, `then`, `toJSON` ou `$$typeof` est générée sous la forme `<name>Table` — le slug `table` devient `client.data.tableTable` — et `generate-sdk` affiche un avertissement mentionnant les deux. `client.data.table("table")` permet également d'y accéder, et c'est ainsi qu'une table dont l'accesseur serait `batch` est accessible. `data.table(slug)` refuse un slug contenant un segment `.` ou `..`, qui sortirait de `/data`, avec l'erreur `INVALID_TABLE_PATH`.

### Noms des champs

**Le nom d'un champ sur le réseau est sa clé de colonne**, et l'API utilise le camelCase partout. Une colonne `createdAt` stockée sous le nom `created_at` devient `row.createdAt`, et la clé étrangère d'une relation est `authorId` même si la colonne reste `author_id`. `where` et `orderBy` sont indexés sur le même type `Row`, de sorte que ce qui compile correspond à ce à quoi le backend répond.

Une clé de colonne que *vous* avez écrite est votre clé, quelle que soit sa forme — rien ne renomme un nom que vous avez choisi. Les deux clés dérivées plutôt que déclarées, à savoir la clé étrangère d'une relation et une colonne récupérée par introspection, sont en camelCase.

`Row` décrit une lecture, `Insert` un `create()` et `Update` un `update()` — ils n'ont pas la même structure. Une colonne non requise est de type `T | null` sur les trois, afin qu'une écriture puisse la vider ; la clé primaire est toujours présente lors d'une lecture et ne peut jamais être définie lors d'une mise à jour ; la cible d'un `belongsTo` peut être écrite soit sous forme de relation (`{ author: 5 }`), soit sous forme de sa clé étrangère (`{ authorId: 5 }`), et une relation requise est satisfaite par l'un ou l'autre ; un `hasOne` s'écrit en nommant la ligne cible (`{ profile: 9 }`), ou `null` pour la dissocier ; un `via` à saut unique s'écrit selon le type qu'il représente (to-one : l'identifiant de la cible ou `null` ; to-many : une liste d'identifiants), tandis qu'un `via` multi-sauts est en lecture seule et n'apparaît sur aucun des deux ; et une appartenance `hasMany` ou `manyToMany` s'écrit sous forme d'une liste d'identifiants cibles ou d'objets `{ id }` (`{ tags: ["t-1"] }`), chacun portant un `_pivot` lorsque la table de jonction déclare des colonnes de données (payload). Un champ que personne ne peut écrire (`.access({ write: [] })`) n'apparaît ni sur `Insert` ni sur `Update`. Une colonne `date` se lit comme une chaîne ISO, et une écriture accepte soit cette chaîne, soit un objet `Date`.

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

Dans un frontend Rebase, le client est créé une seule fois et partagé via le contexte :

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

- **[Interrogation des données](/docs/sdk/querying)** — CRUD, filtres, pagination et relations
- **[Authentification](/docs/sdk/authentication)** — Connexion, inscription, OAuth, sessions
- **[Abonnements en temps réel](/docs/sdk/realtime)** — Données en direct avec les WebSockets
- **[Synchronisation hors ligne et local-first](/docs/sdk/offline)** — Travaillez sans connexion et synchronisez lorsqu'elle revient
- **[Stockage et fichiers](/docs/sdk/storage)** — Téléversez, téléchargez et gérez des fichiers
