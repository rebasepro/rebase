---
sourceHash: 6463f2ed4a86c836
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

- **Node.js** 22.22+ — chaque scaffold, y compris le headless, déclare `"node": ">=22.22.0"`
- **pnpm** (recommandé) ou npm

Aucune base de données à installer, et pas de Docker. `rebase dev` exécute un PostgreSQL géré pour le projet, dont les données vivent sous `.rebase/`. Voir [Variante : votre propre PostgreSQL](#variante--votre-propre-postgresql) si vous préférez en fournir un — une installation locale, Neon, Supabase, ou le conteneur livré avec cet échafaudage.

## Votre environnement est déjà configuré

`init` génère à la racine du projet un fichier `.env` prêt à l'emploi, avec un vrai `JWT_SECRET`, un mot de passe de base de données et un port de base de données local libre. Vous n'avez rien à créer ni à modifier pour commencer.

:::caution
N'exécutez pas `cp .env.example .env`. `.env.example` est une référence des variables disponibles — le copier par-dessus votre `.env` supprime les secrets générés et fait pointer `DATABASE_URL` vers une base de données qui n'existe pas. Modifiez directement `.env` si vous voulez changer une valeur.
:::

## Démarrer les serveurs de développement

```bash
pnpm install
pnpm run dev
```

C'est tout le premier démarrage. Il n'y a pas de base de données à installer ni
d'étape de schéma : sans `DATABASE_URL` définie, `rebase dev` lance une
**PostgreSQL gérée (PGlite)** dans le répertoire du projet, génère le schéma
Drizzle à partir de vos collections et crée les tables au démarrage — y compris
les exemples `posts`, `authors` et `tags`.

Les deux moitiés démarrent ensemble :

- **Backend** — API REST, auth, stockage, WebSocket
- **Frontend** — le panneau d'administration Rebase
- **Rechargement à chaud** pour les deux

Les deux ports sont **dérivés du chemin de ce projet** plutôt que fixes, de sorte
que plusieurs projets Rebase peuvent tourner côte à côte. `rebase dev` affiche
les deux URLs auxquelles il s'est lié — **utilisez celles-là**, pas
`localhost:3001` / `localhost:5173`. (`PORT` et `VITE_API_URL` dans `.env`
configurent `rebase start`, le serveur de production, et sont ignorés ici.)
Fixez un port avec `rebase dev --port 3001`.

### Options utiles

| Option | Sur | Effet |
|---|---|---|
| `--yes` | `init` | Accepte toutes les valeurs par défaut. **Obligatoire quand aucun terminal ne peut répondre**, en CI par exemple |
| `--headless` | `init` | Un backend sans fichiers de collection et sans UI |
| `--template <nom>` | `init` | Part d'un autre modèle que celui par défaut |
| `--install` / `--no-install` | `init` | Lance le gestionnaire de paquets pour vous, ou non |
| `--docker` | `dev` | Utilise PostgreSQL dans un conteneur plutôt que la base gérée |
| `--no-db` | `dev` | Ne touche à aucune base ; vous apportez la vôtre |

## Variante : votre propre PostgreSQL

La base gérée est un confort, pas une obligation. Pour pointer le projet vers une
PostgreSQL à vous, décommentez `DATABASE_URL` dans `.env` :

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/your_database
```

Démarrez ensuite les serveurs comme ci-dessus. Une `DATABASE_URL` déjà définie
n'est jamais touchée, et une qui pointe ailleurs que sur cette machine est
laissée entièrement tranquille.

Avec votre propre base vous disposez en plus des commandes de migration, que la
base gérée ne peut pas offrir : elles planifient les changements avec Atlas, qui
a besoin d'une seconde base vide pour comparer, et PGlite en sert exactement une :

```bash
pnpm run db:push
```

Le démarrage crée déjà les tables manquantes de façon additive ; `db push` sert
donc aux deux choses qu'il laisse délibérément de côté : la RLS des tables de
jointure des relations plusieurs-à-plusieurs, et tout changement qui n'est pas
purement additif — une colonne renommée, un type restreint, un champ supprimé.

Le scaffold fournit aussi un `docker-compose.yml` avec un service PostgreSQL, si
vous préférez un conteneur à une Postgres installée :

```bash
docker compose up -d db
```

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

Poussez la nouvelle collection vers la base de données :

```bash
pnpm run db:push
```

Ceci régénère le schéma à partir de vos collections et l'applique. Redémarrez les serveurs de développement et votre nouvelle collection **Products** apparaîtra dans la navigation.

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
