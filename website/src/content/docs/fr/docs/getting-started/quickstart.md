---
title: Démarrage rapide
sidebar_label: Démarrage rapide
description: Créez un nouveau projet Rebase et faites-le fonctionner localement en moins de 2 minutes.
---

## Créer un nouveau projet

```bash
pnpm dlx @rebasepro/cli init my-app
```

Ceci échafaude un projet avec trois packages :

| Dossier | Description |
|--------|-------------|
| `frontend/` | SPA React — Vite + TypeScript avec l'interface d'administration Rebase |
| `backend/` | Serveur Node.js — Hono, PostgreSQL via Drizzle ORM, WebSocket |
| `config/` | Définitions de collections TypeScript partagées par les deux parties |

## Prérequis

- **Node.js** 18+
- **pnpm** (recommandé) ou npm

Aucune base de données à installer, et **pas de Docker**. `rebase dev` exécute un PostgreSQL géré pour le projet, dont les données vivent sous `.rebase/`. Voir [Utiliser votre propre PostgreSQL](#utiliser-votre-propre-postgresql) si vous préférez en fournir un — une installation locale, Neon, Supabase, ou le conteneur livré avec cet échafaudage.

## Votre environnement est déjà configuré

`init` génère à la racine du projet un fichier `.env` prêt à l'emploi, avec un vrai `JWT_SECRET`, un mot de passe de base de données et un port de base de données local libre. Vous n'avez rien à créer ni à modifier pour commencer.

:::caution
N'exécutez pas `cp .env.example .env`. `.env.example` est une référence des variables disponibles — le copier par-dessus votre `.env` supprime les secrets générés et fait pointer `DATABASE_URL` vers une base de données qui n'existe pas. Modifiez directement `.env` si vous voulez changer une valeur.
:::

## Démarrer les serveurs de développement

```bash
pnpm install   # only if you declined the install `init` offered
pnpm dev
```

C'est tout le premier lancement — aucune base de données à démarrer, aucune étape de schéma à retenir. `rebase dev` fait trois choses avant de servir :

1. Il génère `backend/src/schema.generated.ts` à partir de `config/collections/`.
2. Il démarre un PostgreSQL géré pour ce projet, dont les données vivent sous `.rebase/`.
3. Il y applique vos collections, de sorte que les tables d'exemple `posts`, `authors` et `tags` existent.

Puis il démarre les deux moitiés ensemble :

- **Backend** — API REST, authentification, stockage, WebSocket
- **Frontend** — le panneau d'administration Rebase
- **Hot reload** pour les deux — les changements prennent effet instantanément

Les deux ports sont **dérivés du chemin du projet** plutôt que fixes, ce qui permet
d'exécuter plusieurs projets Rebase en parallèle. `rebase dev` affiche les deux URLs
qu'il a liées — utilisez celles-ci, pas `localhost:3001`/`localhost:5173`. (`PORT` et
`VITE_API_URL` dans `.env` configurent `rebase start`, le serveur de production, et
sont ignorés ici.) Fixez un port avec `rebase dev --port 3001`.

## Utiliser votre propre PostgreSQL

`DATABASE_URL` est commentée dans `.env` à dessein — c'est ce qui fait de la base gérée l'option par défaut. Pointez-la vers le PostgreSQL de votre choix (installation locale, Neon, Supabase) et elle l'emporte sur la base gérée :

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/your_database
```

L'échafaudage fournit également un `docker-compose.yml` avec un service PostgreSQL, et l'URL déjà présente dans `.env` pointe dessus. Décommentez cette ligne, puis :

```bash
docker compose up -d db
pnpm run db:push
pnpm dev
```

`db:push` est ce qui crée les tables de vos collections sur une base de données que Rebase ne gère pas pour vous.

:::caution
`db:push`, `db:generate` et `db:migrate` planifient leurs changements avec [Atlas](https://atlasgo.io), qui compare votre schéma à une seconde base de données vide. La base de développement gérée n'en sert qu'une seule, donc les trois refusent de s'exécuter contre elle et le disent, plutôt que d'échouer à mi-parcours. Vous n'en avez pas besoin là — `rebase dev` applique vos collections au démarrage. Recourez-y une fois sur votre propre PostgreSQL, et pour les migrations, les suppressions et les renommages de colonnes.
:::

## Introspection d'une Base de Données Existante (Optionnel)

Si vous vous connectez à une base de données existante avec des tables préexistantes, vous pouvez l'introspecter pour générer automatiquement vos fichiers de collection TypeScript :

```bash
pnpm rebase schema introspect
```

Cela analysera les tables, enums et relations de votre base de données et créera les fichiers de collection correspondants dans `config/collections/`.

## Première connexion

Lorsque vous ouvrez l'URL du frontend affichée par `rebase dev`, vous verrez l'écran de connexion. Le **premier utilisateur** à s'inscrire devient automatiquement un administrateur — c'est le flux d'amorçage.

1. Cliquez sur **S'inscrire**
2. Entrez votre adresse e-mail et votre mot de passe
3. Vous êtes connecté — avec un accès administrateur complet

## Définir votre première collection

Ouvrez `config/collections/` et créez un nouveau fichier. Exportez la collection en tant qu'**export par défaut** — c'est ainsi que le registre la détecte :

```typescript title="config/collections/products.ts"
import { defineCollection } from "@rebasepro/cms-types";

const productsCollection = defineCollection({
    slug: "products",
    name: "Products",
    singularName: "Product",
    table: "products",
    properties: {
        name: {
            type: "string",
            name: "Name",
            validation: { required: true }
        },
        price: {
            type: "number",
            name: "Price",
            validation: { required: true, min: 0 }
        },
        description: {
            type: "string",
            name: "Description",
            admin: { multiline: true }
        },
        active: {
            type: "boolean",
            name: "Active",
            defaultValue: true
        },
        createdAt: {
            type: "date",
            name: "Created At",
            autoValue: "on_create"
        }
    }
});

export default productsCollection;
```

Ensuite, enregistrez-la dans `config/collections/index.ts` pour que le backend et le panneau d'administration la connaissent :

```typescript title="config/collections/index.ts" {2,5}
// ...imports existants
import productsCollection from "./products.js";

export const collections = [
    postsCollection, authorsCollection, tagsCollection, usersCollection, productsCollection
];
```

## Créer la table

Redémarrez `rebase dev`. Il régénère le schéma à partir de vos collections et applique la nouvelle table avant de servir, si bien que **Products** apparaît dans la navigation.

Sur un PostgreSQL à vous, c'est le travail de `db:push` à la place :

```bash
pnpm run db:push
```

## Référence des commandes de base de données

| Commande | Description |
|---------|-------------|
| `rebase schema generate` | Générer le schéma Drizzle à partir de vos collections TypeScript. Aucune base de données requise — `rebase dev` l'exécute pour vous |
| `rebase schema introspect` | Générer des collections TypeScript à partir d'une base de données existante |
| `rebase db push` | Pousser les modifications de schéma directement dans la base de données. Nécessite votre propre PostgreSQL |
| `rebase db generate` | Générer les fichiers de migration SQL. Nécessite votre propre PostgreSQL |
| `rebase db migrate` | Exécuter les migrations en attente. Nécessite votre propre PostgreSQL |

## Et ensuite ?

- **[Structure du projet](/docs/getting-started/project-structure)** — Comprendre le code généré
- **[Collections](/docs/collections)** — Approfondir la définition du schéma
- **[Environnement et Configuration](/docs/getting-started/configuration)** — Toutes les options de configuration
- **[Déploiement](/docs/getting-started/deployment)** — Déployer en production

---
