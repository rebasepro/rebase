---
sourceHash: 7b2e4e449b0ca1dc
title: Démarrage rapide
sidebar_label: Démarrage rapide
description: Créez un nouveau projet Rebase et lancez-le localement en moins de 2 minutes.
---

## Créer un nouveau projet

```bash
pnpm dlx @rebasepro/cli init my-app
```

Cela génère un projet contenant trois packages. Si l'un des termes *collection*, *Studio*,
*managed runtime*, *bundle* ou *resource* vous est inconnu, l'encadré en cinq points sur la page
[Structure du projet](/docs/getting-started/project-structure/) les définit.



| Dossier | Description |
|---------|-------------|
| `frontend/` | SPA React — Vite + TypeScript avec l'interface d'administration Rebase |
| `backend/` | Vos fonctions personnalisées et crons, ainsi que le schéma Drizzle généré. Il n'y a pas de fichier serveur — le runtime publié démarre le projet |
| `config/` | Fichiers de configuration et définitions de collections partagés par les deux parties |

## Prérequis

- **Node.js** 22.22+ — chaque modèle généré, y compris headless, déclare `"node": ">=22.22.0"`
- **pnpm** (recommandé) ou npm

Aucune base de données à installer, et pas de Docker. `rebase dev` exécute un PostgreSQL géré pour le projet, avec ses données stockées sous `.rebase/`. Consultez [Variante : utiliser votre propre PostgreSQL](#variante--utiliser-votre-propre-postgresql) si vous préférez en fournir un — une installation locale, Neon, Supabase, ou le conteneur fourni avec ce scaffold.

## Votre environnement est déjà configuré

`init` génère un fichier `.env` prêt à l'emploi à la racine du projet avec un vrai `JWT_SECRET`, un mot de passe de base de données et un port local libre pour la base de données. Vous n'avez rien besoin de créer ou de modifier pour commencer.

:::caution
N'exécutez pas `cp .env.example .env`. `.env.example` est une référence pour les variables disponibles — le copier sur votre `.env` écraserait les secrets générés et ferait pointer `DATABASE_URL` vers une base de données inexistante. Modifiez directement `.env` si vous souhaitez changer une valeur.
:::

## Démarrer les serveurs de développement

```bash
pnpm install
pnpm run dev
```

C'est tout pour le premier lancement. Il n'y a aucune base de données à installer ni d'étape de schéma :
sans `DATABASE_URL` défini, `rebase dev` démarre un **PostgreSQL géré (PGlite)**
dans le répertoire du projet, génère le schéma Drizzle à partir de vos collections et
crée les tables au démarrage — y compris les exemples `posts`, `authors` et `tags`.

Il démarre les deux parties ensemble :

- **Backend** — API REST, authentification, stockage, WebSocket
- **Frontend** — le panneau : Rebase CMS et Rebase Studio
- **Rechargement à chaud (Hot reload)** pour les deux

Les deux ports sont **dérivés du chemin de ce projet** plutôt que d'être fixes, ce qui permet à plusieurs
projets Rebase de fonctionner côte à côte. `rebase dev` affiche les deux URL associées —
**utilisez celles-ci**, et non `localhost:3001` / `localhost:5173`. (`PORT` et `VITE_API_URL`
dans `.env` configurent `rebase start`, le serveur de production, et sont ignorés ici.)
Fixez un port avec `rebase dev --port 3001`.

### Options utiles à connaître

| Option | Commande | Ce qu'elle fait |
|---|---|---|
| `--yes` | `init` | Ne jamais poser de questions. **Requis lorsqu'aucun terminal n'est disponible pour répondre**, comme en CI. Ignore git init et l'installation des dépendances — les valeurs par défaut interactives répondent oui aux deux, passez donc `--git` / `--install` si vous les souhaitez |
| `--headless` | `init` | Un backend sans fichiers de collections et sans interface utilisateur — voir [Backend seul](/docs/getting-started/headless/) |
| `--template <name>` | `init` | Démarrer à partir d'un autre template que celui par défaut |
| `--install` / `--no-install` | `init` | Exécuter le gestionnaire de paquets pour vous, ou l'ignorer |
| `--docker` | `dev` | Utiliser PostgreSQL dans un conteneur au lieu de l'instance gérée |
| `--no-db` | `dev` | Ne démarrer aucune base de données — ni le conteneur ni l'instance gérée. Définissez `DATABASE_URL` vous-même |

## Variante : utiliser votre propre PostgreSQL

La base de données gérée est une commodité, pas une obligation. Pour faire pointer le projet vers
un Postgres que vous gérez, décommentez `DATABASE_URL` dans `.env` :

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/your_database
```

Démarrez ensuite les serveurs de développement comme ci-dessus. Une variable `DATABASE_URL` définie n'est jamais
modifiée, et si elle pointe ailleurs que sur cette machine, elle est totalement
laissée intacte.

Avec votre propre base de données, vous bénéficiez également des commandes de migration, ce que la base gérée
ne peut pas proposer — elles planifient les modifications avec [Atlas](https://atlasgo.io/), le moteur de migration de schéma
avec lequel Rebase fonctionne, qui nécessite une seconde base de données vide
pour comparaison, alors que PGlite n'en dessert qu'une seule :

```bash
pnpm run db:push
```

Le démarrage crée déjà les tables manquantes de manière additive, `db push` sert donc pour les deux
cas délibérément laissés de côté : le [RLS](/docs/collections/security-rules/) (Row-Level Security de PostgreSQL,
mécanisme par lequel Rebase contrôle qui peut lire une ligne) sur les tables de jonction
pour les relations plusieurs-à-plusieurs, et toute modification qui n'est pas purement additive — une colonne renommée, un
type restreint, un champ supprimé.

Le scaffold fournit également un fichier `docker-compose.yml` avec un service PostgreSQL, si vous
préférez un conteneur à une installation locale de Postgres :

```bash
docker compose up -d db
```

## Introspecter une base de données existante (Optionnel)

Si vous vous connectez à une base de données existante contenant déjà des tables, vous pouvez l'introspecter pour générer automatiquement vos fichiers de collections TypeScript :

```bash
pnpm rebase schema introspect
```

Cela analysera les tables de votre base de données et générera les fichiers TypeScript correspondants dans `config/collections/` afin que vous n'ayez pas à les écrire manuellement.

## Première connexion

Lorsque vous ouvrez l'URL frontend affichée par `rebase dev`, vous verrez l'écran de connexion. Le **premier utilisateur** à s'inscrire devient automatiquement administrateur — c'est le flux d'initialisation (bootstrap).

1. Cliquez sur **Sign Up**
2. Entrez votre email et votre mot de passe
3. Vous êtes connecté — avec un accès administrateur complet

`rebase init` a également inscrit `REBASE_ADMIN_EMAIL` et un mot de passe généré `REBASE_ADMIN_PASSWORD` dans le fichier `.env`. Ce ne sont pas vos identifiants ici : `rebase dev` les ignore et l'indique au démarrage. Ils sont destinés à un démarrage en production — `docker compose up`, ou tout environnement avec `NODE_ENV=production` — où cette fenêtre d'initialisation est fermée, car le serveur répond sur un nom d'hôte avant même que vous n'ayez saisi quoi que ce soit. Voir [Votre premier administrateur](/docs/getting-started/deployment#your-first-admin).

## Définir votre première collection

Ouvrez `config/collections/` et créez un nouveau fichier. Exportez la collection en tant qu'**export par défaut** — c'est ainsi que le registre la détecte. Le nom de la table est optionnel : il utilise par défaut le slug, ne le définissez donc que lorsqu'ils diffèrent :

```typescript title="config/collections/products.ts"
import { defineCollection } from "@rebasepro/cms-types";

const productsCollection = defineCollection({
    slug: "products",
    name: "Products",
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

Ensuite, enregistrez-la dans `config/collections/index.ts` afin que le backend et le panneau d'administration en aient connaissance :

```typescript title="config/collections/index.ts" {2,5}
// ...existing imports
import productsCollection from "./products.js";

export const collections = [
    postsCollection, authorsCollection, tagsCollection, usersCollection, productsCollection
];
```

## Créer la table

Enregistrez le fichier. C'est tout ce qu'il y a à faire : `rebase dev` régénère
`backend/src/schema.generated.ts` à partir de vos collections, redémarre le backend,
et le démarrage crée la nouvelle table — votre collection **Products** apparaît alors dans la
navigation.

Il en va de même pour une propriété ajoutée à une collection existante : sauvegardez,
et la colonne est créée.

`rebase db push` est réservé aux modifications que le démarrage ignore délibérément — une colonne
renommée, un type restreint, un champ supprimé, et le RLS sur les tables de jonction pour les
relations plusieurs-à-plusieurs. Cela nécessite votre propre PostgreSQL :

```bash
pnpm run db:push
```

## Référence des commandes de base de données

| Commande | Description |
|----------|-------------|
| `rebase schema generate` | Génère le schéma Drizzle à partir de vos collections TypeScript. Aucune base de données requise — `rebase dev` l'exécute pour vous |
| `rebase schema introspect` | Génère des collections TypeScript à partir d'une base de données existante |
| `rebase db push` | Applique directement les changements de schéma à la base de données. Nécessite votre propre PostgreSQL |
| `rebase db generate` | Génère les fichiers de migration SQL. Nécessite votre propre PostgreSQL |
| `rebase db migrate` | Exécute les migrations en attente. Nécessite votre propre PostgreSQL |

## Étapes suivantes

- **[Structure du projet](/docs/getting-started/project-structure)** — Comprendre le code généré
- **[Collections](/docs/collections)** — Découvrir en détail la définition de schémas
- **[Environnement & Configuration](/docs/getting-started/configuration)** — Toutes les options de configuration
- **[Déploiement](/docs/getting-started/deployment)** — Déployer en production
