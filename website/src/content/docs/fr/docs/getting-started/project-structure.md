---
title: Structure du projet
sidebar_label: Structure du projet
description: Comprendre la structure d'un projet Rebase — frontend, backend et collections partagées.
---

Un projet de démarrage Rebase comprend trois packages interconnectés :

```
my-app/
├── .env                    # Environment variables (DATABASE_URL, JWT_SECRET, etc.)
├── package.json            # Root workspace config
│
├── frontend/               # React admin panel (Vite)
│   ├── src/
│   │   ├── App.tsx         # Main application component
│   │   ├── main.tsx        # React entry point
│   │   └── index.css       # Global styles
│   ├── package.json
│   └── vite.config.ts
│
├── backend/                # Node.js API server (Hono)
│   ├── src/
│   │   ├── index.ts        # Server entry — initializes Rebase backend
│   │   └── schema.generated.ts  # Auto-generated Drizzle schema
│   ├── drizzle.config.ts   # Drizzle ORM configuration
│   ├── Dockerfile
│   └── package.json
│
└── config/                 # Collection definitions
    └── collections/
        ├── index.ts        # Exports all collections
        └── products.ts     # Example: products collection
```

## Frontend (`frontend/`)

Le frontend est une application standard **Vite + React + TypeScript**. Le fichier clé est `App.tsx`, qui relie tous les contrôleurs Rebase :

```typescript title="frontend/src/App.tsx"
import { Rebase } from "@rebasepro/app";
import { Scaffold, AppBar, Drawer } from "@rebasepro/cms";
import { createRebaseClient } from "@rebasepro/client";
import { collections } from "virtual:rebase-collections";

// The client connects to your backend API and WebSocket
const rebaseClient = createRebaseClient({
    baseUrl: "http://localhost:3001",
    websocketUrl: "ws://localhost:3001"
});

// Collections are imported via a Vite virtual module
// that reads from the config/ directory
```

### Concepts clés

- **`createRebaseClient`** — Crée le client SDK qui gère les requêtes HTTP, les connexions WebSocket et la gestion des jetons d'authentification
- **`virtual:rebase-collections`** — Un plugin Vite qui importe automatiquement vos collections partagées au moment de la compilation
- **Contrôleurs** — `useBuildNavigationStateController`, `useBuildCollectionRegistryController`, etc. — ceux-ci configurent le routage, la résolution des collections et la configuration de l'interface utilisateur

## Backend (`backend/`)

Le backend est un **serveur Node.js** basé sur [Hono](https://hono.dev/) (un framework HTTP rapide et léger). Le point d'entrée `index.ts` initialise tout :

```typescript title="backend/src/index.ts"
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";

const app = new Hono<HonoEnv>();

await initializeRebaseBackend({
    app,
    server,
    collectionsDir: "./config/collections",
    database: createPostgresAdapter({
            connection: db,
            schema: { tables, enums, relations }
        }),
    auth: {
        jwtSecret: process.env.JWT_SECRET!,
        google: { clientId: process.env.GOOGLE_CLIENT_ID },
    },
    storage: {
        type: "local",
        basePath: "./uploads"
    },
    history: true
});
```

`initializeRebaseBackend` configure :
- **Routes API REST** à `/api/data/*` — CRUD auto-généré pour chaque collection
- **Routes d'authentification** à `/api/auth/*` — inscription, connexion, rafraîchissement, OAuth
- **Routes de stockage** à `/api/storage/*` — téléchargement/téléversement de fichiers
- **Serveur WebSocket** — synchronisation d'entités en temps réel via Postgres LISTEN/NOTIFY
- **Historique** — enregistrement des traces d'audit à chaque modification d'entité

## Collections partagées (`config/`)

Les collections sont la **source unique de vérité** pour votre modèle de données. Elles sont définies en TypeScript et consommées par le frontend (pour la génération d'UI) et le backend (pour la génération de schémas et le routage d'API).

```typescript title="config/collections/products.ts"
import { defineCollection } from "@rebasepro/cms-types";

export const productsCollection = defineCollection({
    slug: "products",
    name: "Products",
    table: "products",
    properties: {
        name: { type: "string", name: "Name" },
        price: { type: "number", name: "Price" }
    }
});
```

Le `slug` devient le chemin URL dans l'interface d'administration et le point d'accès API REST (`/api/data/products`). La `table` correspond au nom de la table PostgreSQL.

## Comment ils se connectent

1. **Vous définissez** les collections dans `config/`
2. **Le backend** les lit pour générer les schémas Drizzle et monter les routes REST
3. **Le frontend** les lit (via le plugin Vite) pour afficher les tableaux, les formulaires et la navigation
4. **La CLI** les lit pour générer des fichiers de migration avec `rebase schema generate`

Les modifications apportées aux collections se propagent partout automatiquement.

## Prochaines étapes

- **[Démarrage rapide](/docs/getting-started/quickstart)** — Commencez avec un nouveau projet Rebase
- **[Configuration](/docs/getting-started/configuration)** — Toutes les variables d'environnement et options
---
