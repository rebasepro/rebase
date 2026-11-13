---
sourceHash: c6b361597710219f
title: Structure du projet
sidebar_label: Structure du projet
description: "La structure d'un projet Rebase — les tables dans backend/schema, les modules backend lus par le runtime, et les personnalisations du panneau d'administration dans frontend/src/cms — avec et sans le panneau."
---

:::note[Six mots utilisés sur cette page]
Chacun d'entre eux a un sens précis ici, et la plupart ont un sens différent ailleurs dans l'industrie.

- **Table** — une table Postgres, déclarée en TypeScript avec `defineTable` dans
  `backend/schema/`. Le SQL, les politiques de sécurité au niveau des lignes (RLS), l'API, les
  types du SDK et les valeurs par défaut du panneau d'administration en découlent tous.
- **Collection** — ce que le panneau d'administration affiche : une table rendue sous la forme d'une liste et d'un
  formulaire, personnalisée dans `frontend/src/cms/`, ou une collection Firestore que le panneau
  lit directement.
- **Studio** — la partie développeur du panneau d'administration : éditeur de schéma, console
  SQL, explorateur de politiques. La même application que celle utilisée par votre équipe de contenu, derrière un commutateur.
- **Runtime managé** — l'image publiée `rebasepro/server` démarre votre
  projet. Vous n'écrivez aucun fichier serveur, et vous bénéficiez des mises à niveau du runtime sans
  recompilation. L'alternative est `rebase eject`, détaillée ci-dessous.
- **Bundle** — ce que produit `rebase build` : vos tables, fonctions et crons,
  compilés, avec un manifeste indiquant où chacun se trouve. C'est ce que démarre le
  runtime managé.
- **Ressource** — ce dont le projet a besoin depuis son environnement d'exécution : une base de données,
  un bucket, un topic. Déclarée dans `backend/resources.ts`, liée par des variables
  d'environnement.
:::

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`rebase init` génère l'une des deux structures suivantes. Les deux partagent le même `backend/` ; la
différence réside dans la présence ou non du panneau d'administration dans le projet.

**Avec le panneau d'administration** (par défaut) :

```
my-app/
├── .env                    # Generated for you: JWT_SECRET, a database password, a free port
├── rebase.json             # Which apps this repository contains, and how each is built
├── package.json            # Root workspace config
├── tsconfig.json           # Typechecks scripts/; each workspace typechecks on its own
├── docker-compose.yml      # Self-hosting: Postgres + the published runtime image
├── scripts/
│   └── example.ts          # A health check and an SDK call to uncomment: `pnpm example`
│
├── backend/
│   ├── schema/             # Your tables
│   │   ├── index.ts        # Exports every table, and the optional defaultRls
│   │   ├── posts.ts        # defineTable("posts", …)
│   │   └── users.ts        # defineAuthTable("users", …)
│   ├── resources.ts        # What this project needs from wherever it runs
│   ├── storage.ts          # Who may read, write and list files (storageAuthorize)
│   ├── functions/          # Custom API routes, auto-mounted at /api/functions/<name>
│   │   └── hello.ts
│   └── src/
│       └── schema.generated.ts   # Drizzle schema, regenerated from your tables
│
└── frontend/               # The admin panel (React + Vite)
    ├── src/
    │   ├── App.tsx
    │   ├── main.tsx
    │   └── cms/            # How tables look in the panel: customizeTable(...)
    │       └── posts.tsx
    └── vite.config.ts
```

**Backend uniquement** (`rebase init --headless`) : le même `backend/`, sans
`frontend/` — et sans `backend/schema/` non plus. Le serveur lit les propres tables
de la base de données au démarrage et sert chacune de celles dont la sécurité au niveau des lignes est activée. Voir
[Backend uniquement](/docs/getting-started/headless/).

```
my-api/
├── .env
├── rebase.json
├── package.json
└── backend/
    ├── storage.ts
    └── functions/
```

Deux fichiers supplémentaires apparaissent lorsque vous en avez besoin, et le runtime lit les deux :
`backend/hooks.ts`, dont l'export `hooks` s'exécute pour chaque table
([Hooks globaux](/docs/backend/hooks/)), et `backend/crons/`, pour les tâches
planifiées. `rebase generate-sdk --register` ajoute `backend/generated/`.

`tsc --noEmit` à la racine vérifie `scripts/` ; dans `backend/` ou `frontend/`, il
vérifie cet espace de travail. Il n'y a pas de paquet `config/` séparé : le frontend
importe une table depuis `backend/schema` uniquement sous forme de type (`import type`). Un import
de valeur de quoi que ce soit sous `backend/` enverrait du code serveur — les hooks et les
secrets qu'ils lisent — vers le navigateur ; ainsi, `rebaseBackendGuard()` de
`@rebasepro/app/vitePlugin`, dans le fichier `frontend/vite.config.ts` généré, fait échouer
`vite build` et `vite dev` dès que quelque chose résout vers `backend/`, en nommant
l'importateur, l'import et le fichier. `rebase build` refuse un frontend sans
celui-ci. Pour l'ajouter à un projet existant, importez-le et ajoutez `rebaseBackendGuard()`
aux `plugins` dans `frontend/vite.config.ts`.

:::note[Il n'y a pas de `backend/src/index.ts`]
Et aucun `Dockerfile`. Un projet généré déclare `runtime: "managed"` dans
`rebase.json`, ce qui signifie que **l'image publiée `rebasepro/server` démarre votre
projet sous forme de bundle** — le même artefact, que vous l'auto-hébergiez ou le déployiez
sur Rebase Cloud. Vous configurez le serveur via `rebase.json`, les fichiers dans
`backend/` et les variables d'environnement plutôt qu'en écrivant un point d'entrée.

Si vous souhaitez contrôler le processus — vos propres middlewares, vos propres routes, votre propre
gestion d'authentification — `rebase eject` écrit le point d'entrée, un Dockerfile et un fichier
compose pour les construire. Voir [Intégration d'un serveur personnalisé](/docs/backend/custom-server).
:::

## Tables (`backend/schema/`)

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Les tables sont l'**unique source de vérité** pour votre modèle de données :

```typescript title="backend/schema/products.ts"
import { defineTable, col } from "@rebasepro/server/schema";

export const products = defineTable("products", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        name:  col.text().notNull(),
        price: col.numeric(),
    },
    rls: "admin-only",
});
```

Le nom devient le point de terminaison REST (`/api/data/products`), le nom de la table dans
Postgres et la route du panneau ; `table` et `slug` permettent de les surcharger. `rls` est
obligatoire. Une table est prise en compte dès lors que `backend/schema/index.ts` l'exporte — un
`defineTable` que l'index omet empêchera le démarrage. [Tables](/docs/schema/)
détaille chaque option.

## Frontend (`frontend/`)

Le frontend est une application standard **Vite + React + TypeScript**. Le fichier clé est `App.tsx`, qui relie l'ensemble des contrôleurs Rebase :

```tsx title="frontend/src/App.tsx"
import "@fontsource/jetbrains-mono";
import "@fontsource-variable/inter";
import "@fontsource-variable/instrument-sans";

import { Rebase, RebaseAuth, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { ErrorBoundary } from "@rebasepro/ui";
import { RebaseStudio } from "@rebasepro/studio";
import { createRebaseClient } from "@rebasepro/client";
import { postsCms } from "./cms/posts";
import { authorsCms } from "./cms/authors";
import { tagsCms } from "./cms/tags";
import { usersCms } from "./cms/users";
// How the collection editor laid out the tables in development (labels, columns, views).
import uiConfig from "./cms/ui-config.json";

// `rebase dev` injects VITE_API_URL with the port it actually bound, and that
// port is derived from this project's path rather than fixed — so a
// `http://localhost:3001` fallback here names a port nothing is listening on.
// A deployed build serves the admin from the same origin as the API, where an
// empty value is exactly what you want.
const API_URL = import.meta.env.VITE_API_URL;
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

// One client for the page, created when this module loads. Inside a component,
// even in a `useMemo`, `<React.StrictMode>` builds a second one in development,
// and both restore the session and open their own connections.
const rebaseClient = createRebaseClient({
    baseUrl: API_URL,
    // Store the refresh token in an httpOnly cookie (XSS-safe) rather than
    // localStorage. The backend issues it via `auth.cookieAuth`.
    auth: { authFlowMode: "cookie" }
});

export function App() {
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
                {/* Every table the backend serves gets an admin view with no
                    code. A file in ./cms changes how one of them looks:
                    labels, icons, enum colours, custom fields and actions. */}
                <RebaseCMS tableCustomizations={[postsCms, authorsCms, tagsCms, usersCms]} uiConfig={uiConfig} />
                <RebaseStudio/>
                <RebaseShell title="Rebase"/>
            </Rebase>
        </ErrorBoundary>
    );
}
```

`main.tsx` le monte sous un `basename` `react-router` extrait de
`import.meta.env.BASE_URL`, que `rebase build` définit à partir du `path` que cette application
déclare dans `rebase.json` — ainsi, les assets, le routeur et le serveur s'accordent sur
une seule valeur sans qu'elle ait besoin d'être écrite trois fois.

### Concepts clés

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

- **`createRebaseClient`** — Crée le client SDK qui gère les requêtes HTTP, les connexions WebSocket et la gestion des jetons d'authentification. Appelez-le une seule fois, à la racine du module : à l'intérieur d'un composant, même dans un `useMemo`, `<React.StrictMode>` instancie un second client en développement
- **`<RebaseCMS tableCustomizations>`** — le panneau affiche chaque table que le backend sert à l'adresse `GET /api/schema/tables` ; les objets `customizeTable` provenant de `frontend/src/cms/` modifient l'apparence de certaines d'entre elles, et `uiConfig` transmet ce que l'éditeur de collections a enregistré en développement. Voir [Personnaliser une table](/docs/frontend/customize-table/#customizations-ui-configjson-and-preferences)
- **`useRebaseAuthController`** — Conserve l'utilisateur connecté ainsi que le cycle de vie des jetons, et c'est ce que `<Rebase>` distribue à tous les éléments situés en dessous de lui

## Backend (`backend/`)

Il n'y a aucun fichier serveur à lire, et c'est l'objectif visé : un projet généré
déclare `runtime: "managed"`, de sorte que l'image publiée `rebasepro/server` démarre
votre projet. Ce que contient `backend/`, c'est le code que le runtime charge :

| Chemin | Ce que c'est |
|---|---|
| `backend/schema/` | Les tables, et le `defaultRls` exporté par leur index |
| `backend/resources.ts`, `backend/storage.ts`, `backend/hooks.ts` | Ressources déclarées, `storageAuthorize`, et hooks globaux de table |
| `backend/functions/` | Routes personnalisées, montées automatiquement sur `/api/functions/<filename>` |
| `backend/crons/` | Tâches planifiées, découvertes de la même façon (créez le dossier lorsque vous en voulez une) |
| `backend/src/schema.generated.ts` | Le schéma Drizzle de vos tables : écrit par `rebase init`, et régénéré à chaque `rebase dev` et `rebase build` |

Le runtime configure :

- **API REST** sur `/api/data/*` — CRUD généré pour chaque table
- **Auth** sur `/api/auth/*` — inscription, connexion, rafraîchissement, OAuth
- **Storage** sur `/api/storage/*` — téléversement et téléchargement
- **WebSocket** — synchronisation en temps réel via Postgres LISTEN/NOTIFY
- **Vos fonctions et crons**, à partir des répertoires ci-dessus

La configuration provient de `rebase.json`, des fichiers dans `backend/` et des variables
d'environnement. Voir [Environnement & Configuration](/docs/getting-started/configuration).

`rebase build` transforme le tout en un **bundle** — les tables, fonctions et crons
compilés accompagnés d'un manifeste — que le runtime managé démarre. Rien dans le bundle
n'est écrit à la main ; si vous souhaitez en voir un,
[Runtime & Bundles](/docs/architecture/runtime-and-bundles/) décrit ce qu'il contient.

Le panneau servi par le frontend comporte deux volets. **Studio** est le volet développeur —
l'éditeur de schéma, la console SQL, l'explorateur de politiques RLS — et il se trouve derrière
le commutateur dans le tiroir latéral, et non dans un déploiement séparé. Voir [Studio](/docs/studio/).

Pour prendre le contrôle total du processus à la place — vos propres middlewares, routes et
gestion d'authentification — exécutez `rebase eject`. **Tout ce qui figure sous ce paragraphe concerne uniquement les projets éjectés** :
un projet généré ne possède aucun de ces fichiers, et rien n'y appelle
`initializeRebaseBackend`. Il génère un point d'entrée qui appelle
directement `initializeRebaseBackend`, ainsi qu'un Dockerfile et un fichier compose qui
le construisent ; à partir de là, vous maintenez le serveur et les mises à niveau du runtime de la plateforme
n'atteignent plus le projet. Cette surface est documentée dans
[Intégration d'un serveur personnalisé](/docs/backend/custom-server).

## Comment ils s'articulent

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

1. **Vous déclarez** les tables dans `backend/schema/`
2. **Le backend** les compile, crée les tables et les politiques, et monte les routes REST, temps réel et MCP
3. **Le panneau d'administration** les lit depuis `GET /api/schema/tables` et affiche une vue pour chacune, modifiée par les fichiers dans `frontend/src/cms/`
4. **La CLI** les lit pour générer le schéma Drizzle (`rebase schema generate`), les types du SDK (`rebase generate-sdk`) et, à partir de ce schéma, les fichiers de migration (`rebase db generate`)

Pendant que `rebase dev` tourne, enregistrer un fichier sous `backend/schema/`
régénère `backend/src/schema.generated.ts` et les types du SDK dans
`generated/sdk/`, redémarre le backend, et le démarrage crée les tables et colonnes
manquantes. En dehors de `rebase dev`, les étapes correspondantes sont `rebase schema generate`
et `rebase generate-sdk`.

Un projet antérieur à la version 0.31 possède un répertoire `config/collections/` à la place. Chaque
commande le refusera et mentionnera `rebase migrate collections-to-tables`, qui le déplace — voir
[le guide de mise à niveau](/docs/upgrading/0-30-to-0-31/).

## Prochaines étapes

- **[Démarrage rapide](/docs/getting-started/quickstart)** — Démarrer avec un nouveau projet Rebase
- **[Tables](/docs/schema/)** — Déclarer votre modèle de données
- **[Configuration](/docs/getting-started/configuration)** — Toutes les variables d'environnement et options
