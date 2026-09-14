---
sourceHash: 8fb63312e30e41a2
title: Structure du projet
sidebar_label: Structure du projet
description: Comprenez la structure d'un projet Rebase — configuration du frontend, du backend et des collections.
---

:::note[Cinq termes utilisés sur cette page]
Chacun d'eux a un sens précis ici, et quatre d'entre eux ont un sens différent ailleurs dans l'industrie.

- **Collection** — une table, décrite en TypeScript. Le schéma, l'API et
  l'écran d'administration proviennent tous du même fichier.
- **Studio** — la partie développeur du panneau d'administration : éditeur de schéma, console
  SQL, explorateur de politiques. La même application que celle utilisée par votre équipe de contenu, derrière un bouton de bascule.
- **Managed runtime** — l'image publiée `rebasepro/server` démarre votre
  projet. Vous n'écrivez aucun fichier serveur et vous bénéficiez des mises à niveau du runtime sans
  recompilation. L'alternative est `rebase eject`, détaillée ci-dessous.
- **Bundle** — ce que produit `rebase build` : vos collections, fonctions et
  crons, compilés, avec un manifeste indiquant l'emplacement de chacun. C'est ce que démarre
  le runtime managé.
- **Resource** — un élément dont le projet a besoin depuis son environnement d'exécution : une base de données,
  un bucket, un topic. Déclaré dans `config/resources.ts`, lié par des variables
  d'environnement.
:::

Un projet de démarrage Rebase comporte trois packages interconnectés :

```
my-app/
├── .env                    # Generated for you: JWT_SECRET, a database password, a free port
├── rebase.json             # Which apps this repository contains, and how each is built
├── package.json            # Root workspace config
├── docker-compose.yml      # Self-hosting: Postgres + the published runtime image
│
├── config/                 # Shared by the backend and the admin panel
│   ├── index.ts            # Re-exports what the runtime reads (collections, storageAuthorize)
│   ├── collections/        # Your data model
│   │   ├── index.ts        # Exports `collections` and the default security rules
│   │   ├── posts.ts        # Example collections
│   │   └── users.ts        # The auth collection
│   ├── resources.ts        # What this project needs from wherever it runs
│   ├── storage.ts          # Who may read, write and list files
│   └── cms.d.ts            # One line that makes the `admin` block legal here
│
├── backend/
│   ├── functions/          # Custom API routes, auto-mounted at /api/functions/<name>
│   │   └── hello.ts
│   └── src/
│       └── schema.generated.ts   # Drizzle schema, regenerated from your collections
│
└── frontend/               # The admin panel (React + Vite)
    ├── src/App.tsx
    ├── src/main.tsx
    └── vite.config.ts
```

:::note[Il n'y a pas de `backend/src/index.ts`]
Ni de `Dockerfile`. Un projet échafaudé déclare `runtime: "managed"` dans
`rebase.json`, ce qui signifie que **l'image publiée `rebasepro/server` démarre votre
projet en tant que bundle** — le même变为 artefact, que vous l'auto-hébergiez ou que vous le déployiez
sur Rebase Cloud. Vous configurez le serveur via `rebase.json`, `config/` et
des variables d'environnement plutôt qu'en écrivant un point d'entrée.

Si vous souhaitez reprendre le contrôle total du processus — vos propres middlewares, vos propres routes, votre propre
configuration d'authentification —, `rebase eject` génère le point d'entrée, un Dockerfile et un fichier compose
qui les compile. Voir [Intégration d'un serveur personnalisé](/docs/backend/custom-server).
:::

## Frontend (`frontend/`)

Le frontend est une application standard **Vite + React + TypeScript**. Le fichier clé est `App.tsx`, qui relie tous les contrôleurs Rebase ensemble :

```typescript title="frontend/src/App.tsx"
import React from "react";

import "@fontsource/jetbrains-mono";
import "@fontsource-variable/inter";
import "@fontsource-variable/instrument-sans";

import { Rebase, RebaseAuth, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { ErrorBoundary } from "@rebasepro/ui";
import { RebaseStudio } from "@rebasepro/studio";
import { createRebaseClient } from "@rebasepro/client";
import { collections } from "virtual:rebase-collections";

// `rebase dev` injects VITE_API_URL with the port it actually bound, and that
// port is derived from this project's path rather than fixed — so a
// `http://localhost:3001` fallback here names a port nothing is listening on.
// A deployed build serves the admin from the same origin as the API, where an
// empty value is exactly what you want.
const API_URL = import.meta.env.VITE_API_URL;
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

export function App() {
    const rebaseClient = React.useMemo(() => createRebaseClient({
        baseUrl: API_URL,
        // Store the refresh token in an httpOnly cookie (XSS-safe) rather than
        // localStorage. The backend issues it via `auth.cookieAuth`.
        auth: { authFlowMode: "cookie" }
    }), []);

    const authController = useRebaseAuthController({
        client: rebaseClient,
        googleClientId: GOOGLE_CLIENT_ID
    });

    return (
        <ErrorBoundary fullPage>
            <Rebase
                client={rebaseClient}
                authController={authController}
            >
                {/* The sign-in screen. On its own this changes nothing —
                    it is where you pass `loginView` to replace it. */}
                <RebaseAuth />
                <RebaseCMS
                    collections={collections}
                />
                <RebaseStudio/>
                <RebaseShell title="Rebase"/>
            </Rebase>
        </ErrorBoundary>
    );
}
```

`main.tsx` le monte sous un `basename` de `react-router` récupéré depuis
`import.meta.env.BASE_URL`, que `rebase build` définit à partir du `path` déclaré
par cette application dans `rebase.json` — ainsi, les assets, le routeur et le serveur s'accordent sur
une seule et même valeur sans avoir à l'écrire trois fois.

### Concepts clés

- **`createRebaseClient`** — Crée le client SDK qui gère les requêtes HTTP, les connexions WebSocket et la gestion des jetons d'authentification
- **`virtual:rebase-collections`** — Un plugin Vite qui importe automatiquement vos collections partagées au moment du build
- **`useRebaseAuthController`** — Conserve l'utilisateur connecté et le cycle de vie des jetons, et constitue ce que `<Rebase>` distribue à tous les éléments en dessous de lui

## Backend (`backend/`)

Il n'y a aucun fichier serveur à consulter, et c'est voulu : un projet échafaudé
déclare `runtime: "managed"`, de sorte que l'image publiée `rebasepro/server` démarre
votre projet. Ce que contient `backend/`, c'est le code pris en compte par le runtime :

| Chemin | Description |
|---|---|
| `backend/functions/` | Routes personnalisées, montées automatiquement sur `/api/functions/<filename>` |
| `backend/crons/` | Tâches planifiées, découvertes de la même manière (à créer selon vos besoins) |
| `backend/src/schema.generated.ts` | Le schéma Drizzle, régénéré à partir de vos collections à chaque `rebase dev` et `rebase build` |

Le runtime met en place :

- **API REST** à `/api/data/*` — CRUD généré pour chaque collection
- **Authentification** à `/api/auth/*` — inscription, connexion, rafraîchissement, OAuth
- **Stockage** à `/api/storage/*` — téléversement et téléchargement
- **WebSocket** — synchronisation en temps réel via LISTEN/NOTIFY de Postgres
- **Vos fonctions et crons**, issus des répertoires ci-dessus

La configuration provient de `rebase.json`, du répertoire `config/` et des variables
d'environnement. Voir [Environnement et configuration](/docs/getting-started/configuration).

`rebase build` transforme l'ensemble en un **bundle** — les collections,
fonctions et crons compilés, accompagnés d'un manifeste — que le runtime managé démarre. Rien
dans le bundle n'est écrit à la main ; si vous souhaitez voir à quoi il ressemble,
consultez [Runtime et bundles](/docs/architecture/runtime-and-bundles/).

Le panneau servi par le frontend comporte deux volets. Le **Studio** est celui destiné aux développeurs —
l'éditeur de schéma, la console SQL, l'explorateur de politiques RLS — et il est accessible
via le bouton de bascule dans le menu latéral, sans nécessiter de déploiement séparé. Voir [Studio](/docs/studio/).

Pour reprendre plutôt le contrôle du processus — vos propres middlewares, routes et
configuration d'authentification —, exécutez `rebase eject`. **Tout ce qui suit ce paragraphe s'applique uniquement après un eject** :
un projet échafaudé ne contient aucun de ces fichiers, et rien n'y appelle
`initializeRebaseBackend`. Cette commande génère un point d'entrée qui appelle
directement `initializeRebaseBackend`, ainsi qu'un Dockerfile et un fichier compose pour le
compiler ; à partir de ce moment, vous maintenez le serveur et les mises à niveau du runtime de la plateforme
ne s'appliquent plus au projet. Cet aspect est documenté dans
[Intégration d'un serveur personnalisé](/docs/backend/custom-server).

## Collections (`config/collections/`)

Les collections constituent la **source unique de vérité** de votre modèle de données. Elles sont définies en TypeScript et consommées à la fois par le frontend (pour la génération de l'interface utilisateur) et par le backend (pour la génération du schéma et le routage de l'API).

```typescript title="config/collections/products.ts"
import { defineCollection } from "@rebasepro/cms-types";

const productsCollection = defineCollection({
    slug: "products",
    name: "Products",
    properties: {
        name: { type: "string", name: "Name" },
        price: { type: "number", name: "Price" }
    }
});

// The default export is what the registry picks up — every collection in the
// scaffold is written this way.
export default productsCollection;
```

Le `slug` devient le chemin d'URL dans l'interface d'administration ainsi que le point de terminaison de l'API REST (`/api/data/products`), et le nom de table PostgreSQL correspond par défaut à ce slug. N'ajoutez `table` que s'ils diffèrent.

## Comment ils sont reliés

1. **Vous définissez** les collections dans `config/collections/`
2. **Le backend** les lit pour générer les schémas Drizzle et monter les routes REST
3. **Le frontend** les lit (via le plugin Vite) pour afficher les tables, les formulaires et la navigation
4. **La CLI** les lit pour générer les fichiers de migration avec `rebase schema generate`

Pendant l'exécution de `rebase dev`, enregistrer un fichier dans `config/collections/`
régénère `backend/src/schema.generated.ts` et redémarre le backend, et le démarrage
crée les tables et les colonnes manquantes. En dehors de `rebase dev`, la même
étape s'effectue via `rebase schema generate`.

## Étapes suivantes

- **[Démarrage rapide](/docs/getting-started/quickstart)** — Lancez-vous avec un nouveau projet Rebase
- **[Configuration](/docs/getting-started/configuration)** — Toutes les variables d'environnement et options
