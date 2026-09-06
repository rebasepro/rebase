---
sourceHash: 8375c766b4952cf8
title: Démarrage rapide
sidebar_label: Démarrage rapide
description: Créez un nouveau projet Rebase et faites-le fonctionner localement en moins de 2 minutes.
---

## Créer un nouveau projet

```bash
pnpm dlx @rebasepro/cli init my-app
```

Ceci échafaude un projet avec trois packages. Si l'un des mots *collection*,
*Studio*, *runtime managé*, *bundle* ou *ressource* vous est nouveau, l'encadré
de cinq mots sur [Structure du
projet](/docs/getting-started/project-structure/) les définit.



| Dossier | Description |
|--------|-------------|
| `frontend/` | SPA React — Vite + TypeScript avec l'interface d'administration Rebase |
| `backend/` | Vos fonctions et crons à vous, plus le schéma Drizzle généré. Il n'y a aucun fichier serveur — c'est le runtime publié qui démarre le projet |
| `config/` | Fichiers de configuration et définitions de collections partagés par les deux parties |

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
| `--yes` | `init` | Ne demande jamais rien. **Obligatoire quand aucun terminal ne peut répondre**, en CI par exemple. Il saute `git init` et l'installation des dépendances — en interactif les valeurs par défaut acceptent les deux, alors passez `--git` / `--install` si vous les voulez |
| `--headless` | `init` | Un backend sans fichiers de collection et sans UI — voir [Backend seul](/docs/getting-started/headless/) |
| `--template <nom>` | `init` | Part d'un autre modèle que celui par défaut |
| `--install` / `--no-install` | `init` | Lance le gestionnaire de paquets pour vous, ou non |
| `--docker` | `dev` | Utilise PostgreSQL dans un conteneur plutôt que la base gérée |
| `--no-db` | `dev` | Ne démarre aucune base — ni le conteneur, ni la base gérée. Définissez `DATABASE_URL` vous-même |

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
base gérée ne peut pas offrir : elles planifient les changements avec
[Atlas](https://atlasgo.io/), le moteur de migration de schéma avec lequel
Rebase planifie, qui a besoin d'une seconde base vide pour comparer, et PGlite
en sert exactement une :

```bash
pnpm run db:push
```

Le démarrage crée déjà les tables manquantes de façon additive ; `db push` sert
donc aux deux choses qu'il laisse délibérément de côté : la
[RLS](/docs/collections/security-rules/) des tables de jointure — la sécurité au
niveau des lignes de PostgreSQL, par laquelle Rebase impose qui peut lire une
ligne — sur les relations plusieurs-à-plusieurs, et tout changement qui n'est pas
purement additif : une colonne renommée, un type restreint, un champ supprimé.

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

Cela analysera les tables de votre base de données et générera les fichiers TypeScript correspondants dans `config/collections/`, pour que vous n'ayez pas à les écrire à la main.

## Première connexion

Lorsque vous ouvrez l'URL du frontend affichée par `rebase dev`, vous verrez l'écran de connexion. Le **premier utilisateur** à s'inscrire devient automatiquement un administrateur — c'est le flux d'amorçage.

1. Cliquez sur **S'inscrire**
2. Entrez votre adresse e-mail et votre mot de passe
3. Vous êtes connecté — avec un accès administrateur complet

<span class="since-badge" data-since="0.18">Since 0.18</span>

`rebase init` a aussi écrit `REBASE_ADMIN_EMAIL` et un `REBASE_ADMIN_PASSWORD` généré dans `.env`. Ce ne sont **pas** vos identifiants ici : `rebase dev` les ignore et le dit au démarrage. Ils appartiennent à un démarrage de production — `docker compose up`, ou tout ce qui tourne avec `NODE_ENV=production` — où cette fenêtre d'amorçage est fermée, parce que le serveur répond sur un nom d'hôte avant que vous ayez tapé quoi que ce soit. Voir [Votre premier administrateur](/fr/docs/getting-started/deployment#votre-premier-administrateur).

## Définir votre première collection

Ouvrez `config/collections/` et créez un nouveau fichier. Exportez la collection en tant qu'**export par défaut** — c'est ainsi que le registre la détecte. Le nom de la table est optionnel : il vaut le slug par défaut, ne le définissez donc que s'ils diffèrent :

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

Ensuite, enregistrez-la dans `config/collections/index.ts` pour que le backend et le panneau d'administration la connaissent :

```typescript title="config/collections/index.ts" {2,5}
// ...imports existants
import productsCollection from "./products.js";

export const collections = [
    postsCollection, authorsCollection, tagsCollection, usersCollection, productsCollection
];
```

## Créer la table

Enregistrez le fichier. C'est toute l'étape : `rebase dev` régénère
`backend/src/schema.generated.ts` à partir de vos collections, redémarre le
backend, et le démarrage crée la nouvelle table — votre collection **Products**
apparaît donc dans la navigation.

Il en va de même d'une propriété ajoutée à une collection que vous avez déjà :
enregistrez, et la colonne est là.

`rebase db push` sert aux changements que le démarrage laisse délibérément de
côté — une colonne renommée, un type restreint, un champ supprimé, et la RLS des
tables de jointure sur les relations plusieurs-à-plusieurs. Il lui faut votre
propre PostgreSQL :

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
