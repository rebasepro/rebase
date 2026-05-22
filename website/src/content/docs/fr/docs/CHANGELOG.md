---
slug: docs/changelog
title: Journal des Modifications
---
# Journal des Modifications

## [0.1.2] - 2026-05-15

### Améliorations

- **Suppression de la dépendance à `lodash`** — Remplacement de `lodash/cloneDeep` par un utilitaire personnalisé `deepClone` dans `@rebasepro/utils`. Cela élimine la dépendance externe et corrige l'échec de `npx create-rebase-app` dû à l'absence de `lodash` à l'exécution.
- **Nouvel utilitaire `deepClone`** — Une fonction de clonage profond légère qui préserve les références de fonctions et les instances de classes (Date, GeoPoint, etc.), conçue spécifiquement pour les objets de collection Rebase.

### CI & Outils

- **Pipeline de publication automatisé** — Nouveau flux de travail GitHub Actions (`Publish Stable Release`) qui gère l'incrémentation de version, la publication sur npm et la création de la release GitHub en un seul clic depuis l'onglet Actions.
- **Script de publication local** — `pnpm release:patch`, `pnpm release:minor`, `pnpm release:major` pour publier depuis la ligne de commandes avec le même pipeline.
- **Publications Canary** — Chaque push vers `main` publie une version canary sur npm (tag de distribution `@canary`).

### Corrections

- Correction des tests des utilitaires de navigation pour valider la bonne signature d'appel avec le paramètre d'options `undefined` optionnel.
- Mise à jour des descriptions des packages pour refléter l'architecture basée sur Postgres.

---

## [0.1.0] - 2025-05-14

🎉 **Première version publique de Rebase** — un CMS headless open-source et panneau d'administration pour Postgres.

### Points Forts

- **Panneau d'Administration Complet** — Vistes de type feuille de calcul, cartes, listes et tableaux pour gérer vos données avec édition en ligne, filtrage, tri et recherche.
- **Backend PostgreSQL** — Support Postgres de premier plan avec Drizzle ORM, introspection de schéma et migrations automatiques.
- **Authentification** — Authentification intégrée avec e-mail/mot de passe, Google OAuth et connexion anonyme. Contrôle d'accès basé sur les rôles avec autorisations personnalisables.
- **Stockage** — Stockage de fichiers compatible S3 avec redimensionnement d'images, téléversement par glisser-déposer et gestion des métadonnées.
- **Studio** — Éditeur SQL, éditeur de politiques RLS, visualiseur de schéma, éditeur JS/TS, tâches cron et explorateur d'API.
- **CLI** — `npx create-rebase-app` pour initialiser un nouveau projet en quelques secondes. Supporte à la fois npm et pnpm.
- **Générateur de SDK** — Génération automatique de SDK TypeScript entièrement typés à partir de vos définitions de collections.
- **Serveur MCP** — Serveur Model Context Protocol pour la gestion de base de données assistée par IA.
- **Plugins** — Plugins d'enrichissement de données et d'analyses pour étendre l'expérience d'administration.
- **Bibliothèque de Composants UI** — Un ensemble complet de composants React accessibles et personnalisables basés sur les primitives Radix.
- **Support Firebase** — Adaptateurs optionnels de source de données et d'authentification Firebase/Firestore.
- **Support MongoDB** — Adaptateur optionnel de source de données MongoDB.

### Packages

| Package | Description |
|---|---|
| `@rebasepro/types` | Définitions de types TypeScript de base |
| `@rebasepro/utils` | Fonctions utilitaires partagées |
| `@rebasepro/common` | Modules communs partagés entre les packages |
| `@rebasepro/formex` | Bibliothèque légère de gestion de formulaires |
| `@rebasepro/ui` | Bibliothèque de composants React |
| `@rebasepro/core` | Logique CMS principale et contrôleurs |
| `@rebasepro/client` | Couche d'accès aux données côté client |
| `@rebasepro/client-postgresql` | Adaptateur client PostgreSQL |
| `@rebasepro/client-firebase` | Adaptateur client Firebase/Firestore |
| `@rebasepro/server-core` | Framework serveur et middleware |
| `@rebasepro/server-postgresql` | Adaptateur serveur PostgreSQL avec Drizzle |
| `@rebasepro/server-mongodb` | Adaptateur serveur MongoDB |
| `@rebasepro/auth` | Contrôleurs et vues d'authentification |
| `@rebasepro/admin` | Interface complète du panneau d'administration |
| `@rebasepro/studio` | Éditeur SQL, outils de schéma et utilitaires de développement |
| `@rebasepro/cli` | CLI pour la structure et la gestion de projets |
| `@rebasepro/sdk-generator` | Génération de code SDK TypeScript |
| `@rebasepro/mcp-server` | Serveur MCP pour les intégrations d'IA |
| `@rebasepro/schema-inference` | Introspection et inférence de schéma de base de données |
| `@rebasepro/plugin-data-enhancement` | Plugin d'enrichissement de données basé sur l'IA |
| `@rebasepro/plugin-insights` | Plugin d'analyses et de perspectives |
