---
sourceHash: 35d04e650c33c5cb
title: SDK typé — Prise en main
sidebar_label: Prise en main
description: Installez et configurez le SDK Client Rebase pour interagir avec votre backend depuis n'importe quelle application JavaScript ou TypeScript.
---

## Vue d'ensemble

Le package `@rebasepro/client` fournit un SDK JavaScript type-safe pour interagir avec votre backend Rebase. Il prend en charge :

- **Opérations sur les données** — CRUD avec filtrage, tri et pagination
- **Récupération des relations** — Incluez les entités associées avec `.include()`
- **Abonnements en temps réel** — Mises à jour en direct basées sur WebSocket
- **Synchronisation hors-ligne & local-first** — Base de données locale de lignes activable à la demande, écritures instantanées hors-ligne, requêtes en direct
- **Authentification** — Gestion des tokens, connexion, inscription, OAuth
- **Stockage** — Téléversement, téléchargement et gestion de fichiers
- **Fonctions personnalisées** — Appel de points de terminaison serveur personnalisés

## Installation

```bash
pnpm add @rebasepro/client
```

## Création d'un client

`rebase dev` dérive un port libre à partir du chemin du projet plutôt que d'utiliser un port fixe, donc **lisez `baseUrl` à partir de l'URL affichée** — aucun port n'est partagé par tous les projets. Dans un frontend Vite, il s'agit de la variable `VITE_API_URL` que l'échafaudage écrit dans `.env` ; dans un script, d'une variable d'environnement qui vous est propre.

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({
    baseUrl: import.meta.env.VITE_API_URL,
});
```

L'`websocketUrl` est dérivée automatiquement de `baseUrl` (`http → ws`, `https → wss`). Vous pouvez la remplacer explicitement si nécessaire :

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
| `token` | `string` | Token JWT statique pour les appels de serveur à serveur |
| `apiPath` | `string` | Préfixe de l'API (par défaut : `"/api"`) |
| `fetch` | `typeof fetch` | Implémentation fetch personnalisée (ex. pour le SSR) |
| `onUnauthorized` | `() => Promise<boolean>` | Gestionnaire personnalisé pour les erreurs 401 — retournez `true` pour réessayer |
| `realtime` | `boolean` | Ouvre la WebSocket (par défaut `true`) — définissez sur `false` dans les scripts ponctuels |
| `collections` | `Record<string, string>` | Associe les noms d'accesseurs aux slugs des collections |
| `offline` | `boolean \| OfflineConfig` | [Synchronisation local-first](/docs/sdk/offline) — désactivée par défaut |

## Génération du SDK typé

Générez un client entièrement typé à partir des définitions de vos collections :

```bash
rebase generate-sdk
```

Passez ensuite le paramètre de type `Database` à `createRebaseClient` pour bénéficier d'une autocomplétion complète :

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

Lorsque `Database` est fourni, `createRebaseClient` renvoie une instance de `CreateRebaseClientResult<DB>`. Cela associe directement les accesseurs de collection en camelCase sur `client.data` à leurs types correspondants, vous offrant une autocomplétion complète sur les opérations et les types de collections (ex. `client.data.products.find()`).

`collectionsDictionary` associe chaque accesseur au slug utilisé sur le réseau. Passez-le chaque fois qu'un slug n'est pas déjà un nom de propriété valide — `my-notes` n'est accessible sous la forme `client.data.myNotes` que parce que le dictionnaire l'indique.

### Noms des champs

**Le nom d'un champ sur le réseau est sa clé de propriété**, et l'API utilise le camelCase d'un bout à l'autre. Une propriété `createdAt` stockée dans une colonne `created_at` est `row.createdAt`, et la clé étrangère d'une relation est `authorId` même si la colonne reste `author_id`. `where` et `orderBy` reposent sur le même type `Row`, donc ce qui compile correspond exactement à ce à quoi le backend répond.

Une clé de propriété que *vous* avez écrite est votre clé, quelle que soit sa forme — rien ne renomme un nom que vous avez choisi. Les deux clés qui sont dérivées plutôt que déclarées — la clé étrangère d'une relation et une colonne récupérée par introspection — sont en camelCase.

`Row` décrit une lecture, `Insert` un `create()` et `Update` un `update()` — ils n'ont pas la même structure. Les colonnes pouvant être nulles sont `T | null` sur `Row`, la clé primaire est toujours présente lors d'une lecture et ne peut jamais être modifiée lors d'une mise à jour, et une cible `belongsTo` peut être écrite soit sous forme de relation (`{ author: 5 }`), soit sous forme de sa clé étrangère (`{ authorId: 5 }`).

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

- **[Interroger les données](/docs/sdk/querying)** — CRUD, filtres, pagination et relations
- **[Authentification](/docs/sdk/authentication)** — Connexion, inscription, OAuth, sessions
- **[Abonnements en temps réel](/docs/sdk/realtime)** — Données en direct avec les WebSockets
- **[Synchronisation hors-ligne & local-first](/docs/sdk/offline)** — Travaillez sans connexion et synchronisez dès son retour
- **[Stockage & fichiers](/docs/sdk/storage)** — Téléversement, téléchargement et gestion de fichiers
