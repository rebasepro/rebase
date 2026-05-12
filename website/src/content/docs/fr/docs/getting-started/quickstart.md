---
title: Démarrage rapide
sidebar_label: Démarrage rapide
slug: fr/docs/getting-started/quickstart
description: Créez un nouveau projet Rebase et faites-le fonctionner localement en moins de 2 minutes.
---

## Créer un nouveau projet

```bash
git clone https://github.com/rebasepro/rebase-starter my-app
```

Ceci échafaude un projet avec trois packages :

| Dossier | Description |
|--------|-------------|
| `frontend/` | SPA React — Vite + TypeScript avec l'interface d'administration Rebase |
| `backend/` | Serveur Node.js — Hono, PostgreSQL via Drizzle ORM, WebSocket |
| `shared/` | Définitions de collections TypeScript partagées par les deux parties |

## Prérequis

- **Node.js** 18+
- **PostgreSQL** — installation locale, Docker, ou toute base de données gérée (Neon, Supabase, etc.)
- **pnpm** (recommandé) ou npm

## Configurer votre environnement

Après l'échafaudage, modifiez le fichier `.env` à la racine du projet :

```bash
# PostgreSQL connection string
DATABASE_URL=postgresql://username:password@localhost:5432/your_database

# JWT secret for authentication (generate a strong random string)
JWT_SECRET=change-me-to-a-random-secret

# Frontend URL for CORS
VITE_API_URL=http://localhost:3001

# Optional: Google OAuth client ID
# VITE_GOOGLE_CLIENT_ID=your-google-client-id
```

## Démarrer les serveurs de développement

```bash
pnpm dev
```

Ceci démarre :
- **Backend** à `http://localhost:3001` — API REST, authentification, stockage, WebSocket
- **Frontend** à `http://localhost:5173` — Panneau d'administration Rebase
- **Hot reload** pour les deux — les changements prennent effet instantanément

Vous pouvez également les démarrer individuellement :

```bash
pnpm dev:backend   # Backend only
pnpm dev:frontend  # Frontend only
```

## Première connexion

Lorsque vous ouvrez `http://localhost:5173`, vous verrez l'écran de connexion. Le **premier utilisateur** à s'inscrire devient automatiquement un administrateur — c'est le flux d'amorçage.

1. Cliquez sur **S'inscrire**
2. Entrez votre adresse e-mail et votre mot de passe
3. Vous êtes connecté — avec un accès administrateur complet

## Définir votre première collection

Ouvrez `shared/collections/` et créez un nouveau fichier :

```typescript title="shared/collections/products.ts"
import { EntityCollection } from "@rebasepro/types";

export const productsCollection: EntityCollection = {
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
            multiline: true
        },
        active: {
            type: "boolean",
            name: "Active",
            defaultValue: true
        },
        created_at: {
            type: "date",
            name: "Created At",
            autoValue: "on_create"
        }
    }
};
```

## Générer le schéma de la base de données

```bash
rebase schema generate   # Generate Drizzle schema from your collections
rebase db push           # Push the schema to your database
```

Redémarrez les serveurs de développement et votre nouvelle collection **Produits** apparaîtra dans la navigation.

## Référence des commandes de base de données

| Commande | Description |
|---------|-------------|
| `rebase schema generate` | Générer le schéma Drizzle à partir de vos collections TypeScript |
| `rebase db push` | Pousser les modifications de schéma directement dans la base de données (dev seulement) |
| `rebase db generate` | Générer les fichiers de migration SQL |
| `rebase db migrate` | Exécuter les migrations en attente |

## Et ensuite ?

- **[Structure du projet](/docs/getting-started/project-structure)** — Comprendre le code généré
- **[Collections](/docs/collections)** — Approfondir la définition du schéma
- **[Environnement et Configuration](/docs/getting-started/configuration)** — Toutes les options de configuration
- **[Déploiement](/docs/getting-started/deployment)** — Déployer en production

---
