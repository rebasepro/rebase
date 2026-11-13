---
sourceHash: 04353ad7d35cfe5c
title: Démarrage rapide
sidebar_label: Démarrage rapide
description: Créez un nouveau projet Rebase et lancez-le localement en moins de 2 minutes.
---

## Créer un nouveau projet

```bash
pnpm dlx @rebasepro/cli init my-app
```

Cette commande initialise un projet composé de deux packages. Si les termes *table*, *collection*,
*Studio*, *runtime managé*, *bundle* ou *ressource* vous sont inconnus, l'encadré sur
la page [Structure du projet](/docs/getting-started/project-structure/) les définit en détail.

| Dossier | Description |
|---------|-------------|
| `backend/` | Vos tables (`backend/schema/`), ce que le runtime lit à leurs côtés (`resources.ts`, `storage.ts`), vos fonctions et tâches planifiées (crons), ainsi que le schéma Drizzle généré. Il n'y a aucun fichier serveur — le runtime publié démarre le projet |
| `frontend/` | SPA React — Vite + TypeScript avec l'interface d'administration Rebase, et les personnalisations de tables dans `src/cms/` |

## Prérequis

- **Node.js** 22.22+ — chaque modèle généré, y compris headless, déclare `"node": ">=22.22.0"`
- **pnpm** (recommandé) ou npm

Aucune base de données à installer, et aucun Docker requis. `rebase dev` exécute un PostgreSQL managé pour le projet, avec ses données stockées sous `.rebase/`. Consultez [Variante : utiliser votre propre PostgreSQL](#variante--utiliser-votre-propre-postgresql) si vous préférez en fournir une — une installation locale, Neon, Supabase, ou le conteneur fourni avec ce modèle.

## Votre environnement est déjà configuré

`init` génère un fichier `.env` prêt à l'emploi à la racine du projet avec un véritable `JWT_SECRET`, un mot de passe de base de données et un port local disponible pour la base de données. Vous n'avez rien besoin de créer ou de modifier pour commencer.

:::caution
N'exécutez pas `cp .env.example .env`. Le fichier `.env.example` sert de référence pour les variables disponibles — le copier sur votre `.env` écraserait les secrets générés — le `JWT_SECRET`, la clé de service, le mot de passe de la base de données et les identifiants du premier administrateur, qui y sont tous vides ou commentés. Modifiez directement `.env` si vous souhaitez changer une valeur.
:::

## Démarrer les serveurs de développement

```bash
cd my-app
pnpm install
pnpm run dev
```

C'est tout pour le premier lancement. Il n'y a aucune base de données à installer ni aucune étape de schéma :
sans `DATABASE_URL` définie, `rebase dev` démarre un **PostgreSQL managé (PGlite)**
dans le répertoire du projet, génère le schéma Drizzle à partir de vos tables et
crée les tables au démarrage — y compris les exemples `posts`, `authors` et `tags`.

Il démarre les deux parties simultanément :

- **Backend** — API REST, authentification, stockage, WebSocket
- **Frontend** — l'interface : Rebase CMS et Rebase Studio
- **Rechargement à chaud (Hot reload)** pour les deux

Les deux ports sont **dérivés du chemin de ce projet** plutôt que d'être fixes, permettant à plusieurs
projets Rebase de s'exécuter côte à côte. `rebase dev` affiche les deux URL auxquelles il s'est lié —
**utilisez celles-ci**, et non `localhost:3001` / `localhost:5173`. (`PORT` et `VITE_API_URL`
dans `.env` configurent `rebase start`, qui exécute le bundle compilé, et sont ignorés ici.)
Fixez un port avec `rebase dev --port 3001`.

### Options utiles (Flags)

| Option | Commande | Description |
|---|---|---|
| `--yes` | `init` | Ne jamais poser de questions. **Requis lorsqu'aucun terminal n'est disponible pour répondre**, comme dans un CI. Ignore l'initialisation de git et l'installation des dépendances — les valeurs interactives par défaut étant oui pour les deux, passez `--git` / `--install` si vous les souhaitez |
| `--headless` | `init` | Un backend sans `backend/schema/` et sans interface graphique, exposant directement les tables de votre base de données — voir [Backend seul](/docs/getting-started/headless/) |
| `--template <name>` | `init` | Démarrer à partir d'un autre template que celui par défaut |
| `--install` / `--no-install` | `init` | Exécuter le gestionnaire de paquets à votre place, ou l'ignorer |
| `--docker` | `dev` | Utiliser PostgreSQL dans un conteneur au lieu de l'instance managée. Les autres commandes suivent cette option jusqu'à ce que `rebase dev` soit exécuté sans elle. Une variable `DATABASE_URL` est prioritaire : dans ce cas, aucun conteneur n'est démarré, et un message l'indique |
| `--no-db` | `dev` | Ne démarrer aucune base de données — ni le conteneur ni l'instance managée. Vous devez définir `DATABASE_URL` vous-même |

## Variante : utiliser votre propre PostgreSQL

La base de données managée est une commodité, pas une obligation. Pour pointer le projet vers
un PostgreSQL que vous administrez, décommentez `DATABASE_URL` dans `.env` :

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/your_database
```

Puis démarrez les serveurs de développement comme ci-dessus. Une variable `DATABASE_URL` définie n'est jamais
modifiée, et si elle pointe ailleurs que sur cette machine, elle est laissée
totalement intacte.

Les commandes de migration planifient les modifications avec [Atlas](https://atlasgo.io/), le
moteur de migration de schéma utilisé par Rebase, qui nécessite une seconde base de données vide pour
effectuer la comparaison. Sur votre propre base de données, Rebase en crée une à côté ; sur la base
managée, qui ne dessert qu'une seule base de données, il démarre une instance temporaire PGlite pour la
durée de la commande.
Dans les deux cas :

```bash
pnpm run db:push
```

Le démarrage crée déjà les tables manquantes — ainsi que leurs
politiques [RLS](/docs/collections/security-rules/) (sécurité au niveau des lignes de PostgreSQL,
mécanisme par lequel Rebase contrôle qui peut lire une ligne) — de manière additive.
`db push` sert donc pour ce qui est délibérément ignoré au démarrage : tout changement qui n'est pas
purement additif — une colonne renommée, un type restreint, un champ supprimé.

Le template fournit également un fichier `docker-compose.yml` avec un service PostgreSQL, si vous
préférez un conteneur plutôt qu'un PostgreSQL installé :

```bash
docker compose up -d db
```

## Introspecter une base de données existante (Optionnel)

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Si vous vous connectez à une base de données existante contenant déjà des tables, vous pouvez l'introspecter pour générer un fichier `defineTable` pour chacune d'elles :

```bash
pnpm rebase schema introspect
```

Cette commande lit chaque table, colonne, clé étrangère et politique de sécurité au niveau des lignes, puis génère `backend/schema/<table>.ts` ainsi que le fichier `index.ts` qui les exporte, vous évitant de les écrire à la main. Voir [`schema introspect`](/docs/cli/schema/#rebase-schema-introspect).

## Première connexion

Lorsque vous ouvrez l'URL du frontend affichée par `rebase dev`, vous accédez à l'écran de connexion. Le **premier utilisateur** à s'inscrire devient automatiquement administrateur — c'est le flux d'initialisation (bootstrap).

1. L'écran s'ouvre sur **Welcome!**, le formulaire dédié à ce premier compte
2. Entrez votre e-mail et votre mot de passe, puis cliquez sur **Create account**
3. Vous êtes connecté — avec un accès administrateur complet

`rebase init` a également inscrit `REBASE_ADMIN_EMAIL` et un mot de passe généré `REBASE_ADMIN_PASSWORD` dans `.env`. Ce ne sont pas vos identifiants ici : `rebase dev` les ignore et le signale au démarrage. Ils sont destinés à un démarrage en production — `docker compose up`, ou tout environnement avec `NODE_ENV=production` — où cette fenêtre d'initialisation est fermée, car le serveur répond sur un nom d'hôte avant que vous n'ayez pu saisir quoi que ce soit. Voir [Votre premier administrateur](/docs/getting-started/deployment#your-first-admin).

## Définir votre première table

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Créez un fichier dans `backend/schema/` :

```typescript title="backend/schema/products.ts"
import { defineTable, col } from "@rebasepro/server/schema";

export const products = defineTable("products", {
    columns: {
        id:          col.uuid().primaryKey().defaultRandom(),
        name:        col.text().notNull(),
        price:       col.numeric().notNull().validate({ min: 0 }),
        description: col.text(),
        active:      col.boolean().default(true),
        createdAt:   col.timestamp({ withTimezone: true }).onCreateNow(),
    },
    // Takes the defaultRls the scaffold's index.ts exports: everyone reads, admins write.
    rls: "inherit",
});
```

Exportez-le ensuite depuis `backend/schema/index.ts`. Cet index est lu par le backend,
le CLI et le générateur de SDK : une table définie avec `defineTable` qui n'y est pas exportée bloque
le démarrage en indiquant le fichier concerné.

```typescript title="backend/schema/index.ts"
// ...existing exports
export { products } from "./products";
```

## Créer la table

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Enregistrez le fichier. C'est tout ce qu'il y a à faire : `rebase dev` régénère
`backend/src/schema.generated.ts` et les types du SDK dans `generated/sdk/` à partir de vos
tables, redémarre le backend, et le démarrage crée la nouvelle table ainsi que ses politiques de sécurité
au niveau des lignes — et **Products** apparaît dans la navigation du panneau d'administration,
avec une liste, un formulaire et des filtres dérivés des colonnes.

Il en va de même pour une colonne ajoutée à une table existante : enregistrez, et la
colonne est disponible.

Pour modifier l'apparence de la table dans le panneau — un éditeur multiligne pour
`description`, une icône, un groupe — ajoutez un fichier dans `frontend/src/cms/` et passez-le
à `<RebaseCMS tableCustomizations>` dans `App.tsx` :

```tsx title="frontend/src/cms/products.tsx"
import { customizeTable } from "@rebasepro/cms";
import type { products } from "../../../backend/schema/products";

export const productsCms = customizeTable<typeof products>("products", {
    icon: "ShoppingCart",
    fields: {
        description: { multiline: true },
    },
});
```

Voir [Personnaliser une table](/docs/frontend/customize-table/).

`rebase db push` sert pour les modifications délibérément ignorées au démarrage — une colonne
renommée, un type restreint, un champ supprimé :

```bash
pnpm run db:push
```

Elle fonctionne aussi bien sur la
base de données managée que sur la vôtre.

## Référence des commandes de base de données

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

| Commande | Description |
|----------|-------------|
| `rebase schema generate` | Génère le schéma Drizzle à partir de vos tables. Aucune base de données requise — `rebase dev` l'exécute pour vous |
| `rebase schema introspect` | Génère les fichiers `defineTable` à partir d'une base de données existante |
| `rebase db push` | Pousse les modifications de schéma directement vers la base de données, y compris l'instance managée |
| `rebase db generate` | Génère les fichiers de migration SQL |
| `rebase db migrate` | Exécute les migrations en attente |

Les trois commandes `db`
fonctionnent sur la base de données managée.

## Étapes suivantes

- **[Structure du projet](/docs/getting-started/project-structure)** — Comprendre le code généré
- **[Tables](/docs/schema/)** — Découvrir en détail la définition des schémas
- **[Environnement et configuration](/docs/getting-started/configuration)** — Toutes les options de configuration
- **[Déploiement](/docs/getting-started/deployment)** — Déployer en production
