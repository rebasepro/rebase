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
- **Docker** — pour exécuter le conteneur PostgreSQL inclus. (Ou apportez votre propre PostgreSQL : installation locale, Neon, Supabase, etc.)
- **pnpm** (recommandé) ou npm

## Votre environnement est déjà configuré

`init` génère à la racine du projet un fichier `.env` prêt à l'emploi, avec un vrai `JWT_SECRET`, un mot de passe de base de données et un port de base de données local libre. Vous n'avez rien à créer ni à modifier pour commencer.

:::caution
N'exécutez pas `cp .env.example .env`. `.env.example` est une référence des variables disponibles — le copier par-dessus votre `.env` supprime les secrets générés et fait pointer `DATABASE_URL` vers une base de données qui n'existe pas. Modifiez directement `.env` si vous voulez changer une valeur.
:::

Si vous préférez pointer vers votre propre PostgreSQL plutôt que vers le conteneur inclus, modifiez `DATABASE_URL` dans `.env` :

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/your_database
```

## Démarrer la base de données

L'échafaudage fournit un `docker-compose.yml` avec un service PostgreSQL. Démarrez-le :

```bash
docker compose up -d db
```

(Ignorez cette étape si vous avez fait pointer `DATABASE_URL` vers votre propre base de données.)

## Créer les tables

Poussez vos collections vers la base de données. Ceci crée les tables pour les collections d'exemple `posts`, `authors` et `tags` :

```bash
pnpm run db:push
```

Sans cette étape, le panneau d'administration s'ouvre quand même, mais chaque collection est vide et ses appels API échouent tant que les tables n'existent pas.

## Introspection d'une Base de Données Existante (Optionnel)

Si vous vous connectez à une base de données existante avec des tables préexistantes, vous pouvez l'introspecter pour générer automatiquement vos fichiers de collection TypeScript :

```bash
pnpm rebase schema introspect
```

Cela analysera les tables, enums et relations de votre base de données et créera les fichiers de collection correspondants dans `config/collections/`.

## Démarrer les serveurs de développement

```bash
pnpm dev
```

Ceci démarre les deux ensemble :
- **Backend** — API REST, authentification, stockage, WebSocket
- **Frontend** — le panneau d'administration Rebase
- **Hot reload** pour les deux — les changements prennent effet instantanément

Les deux ports sont **dérivés du chemin du projet** plutôt que fixes, ce qui permet
d'exécuter plusieurs projets Rebase en parallèle. `rebase dev` affiche les deux URLs
qu'il a liées — utilisez celles-ci, pas `localhost:3001`/`localhost:5173`. (`PORT` et
`VITE_API_URL` dans `.env` configurent `rebase start`, le serveur de production, et
sont ignorés ici.) Fixez un port avec `rebase dev --port 3001`.

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

Poussez la nouvelle collection vers la base de données :

```bash
pnpm run db:push
```

Ceci régénère le schéma à partir de vos collections et l'applique. Redémarrez les serveurs de développement et votre nouvelle collection **Products** apparaîtra dans la navigation.

## Référence des commandes de base de données

| Commande | Description |
|---------|-------------|
| `rebase schema generate` | Générer le schéma Drizzle à partir de vos collections TypeScript |
| `rebase schema introspect` | Générer des collections TypeScript à partir d'une base de données existante |
| `rebase db push` | Pousser les modifications de schéma directement dans la base de données (dev seulement) |
| `rebase db generate` | Générer les fichiers de migration SQL |
| `rebase db migrate` | Exécuter les migrations en attente |

## Et ensuite ?

- **[Structure du projet](/docs/getting-started/project-structure)** — Comprendre le code généré
- **[Collections](/docs/collections)** — Approfondir la définition du schéma
- **[Environnement et Configuration](/docs/getting-started/configuration)** — Toutes les options de configuration
- **[Déploiement](/docs/getting-started/deployment)** — Déployer en production

---
