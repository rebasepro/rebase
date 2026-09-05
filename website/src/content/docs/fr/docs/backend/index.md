---
title: Aperçu du backend
sidebar_label: Backend
description: Le backend Rebase fournit un serveur complet avec API REST, authentification, stockage, temps réel WebSocket et historique des entités — le tout initialisé par un seul appel de fonction.
---

## Aperçu

Le backend Rebase est un **serveur Node.js** basé sur [Hono](https://hono.dev/) qui offre :

- **API REST** — Points d'extrémité CRUD auto-générés pour chaque collection
- **Authentification** — Jetons JWT, connexion OAuth et OIDC, liens magiques, codes à usage unique, MFA, clés d'API, gestion des utilisateurs/rôles
- **Stockage** — Téléchargement/téléversement de fichiers avec système de fichiers local ou S3
- **WebSocket** — Synchronisation des données en temps réel via PostgreSQL LISTEN/NOTIFY
- **Historique des Entités** — Piste d'audit pour chaque modification de données
- **Ramification de Base de Données** — Copies de base de données instantanées et isolées pour le développement/staging/tests
- **Tâches Cron** — Tâches d'arrière-plan planifiées avec tableau de bord de surveillance

Tout est initialisé avec une seule fonction :

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import { env } from "./env";

const instance = await initializeRebaseBackend({
    app,
    server,
    collectionsDir: "./config/collections",
    database: createPostgresAdapter({
            connection: db,
            schema: { tables, enums, relations }
        }),
    auth: {
        jwtSecret: env.JWT_SECRET,
    },
    storage: { type: "local", basePath: "./uploads" },
    history: true,
    enableSwagger: env.NODE_ENV !== "production"
});
```

## Ce qui est créé

Après l'initialisation, ces routes sont montées :

| Path | Objectif |
|------|----------|
| `/api/auth/*` | Authentification (inscription, connexion, rafraîchissement, OAuth, liens magiques, codes à usage unique, MFA) |
| `/api/admin/*` | Gestion des utilisateurs et des rôles (réservé aux administrateurs) |
| `/api/storage/*` | Téléchargement, téléversement et suppression de fichiers |
| `/api/data/collections` | Point d'extrémité des métadonnées de collection |
| `/api/data/:slug` | Opérations CRUD par collection (GET, POST, PATCH, DELETE) |
| `/api/data/:slug/:id/history` | Historique des modifications d'entité (si activé) |
| `/api/docs` | Spécification OpenAPI (lorsque `enableSwagger: true`) |
| `/api/swagger` | Interface utilisateur Swagger (mode dev, lorsque `enableSwagger: true`) |
| `/api/functions/*` | Routes de fonctions personnalisées (lorsque `functionsDir` est défini) |
| `/api/cron/*` | Gestion des tâches cron (réservé aux administrateurs, lorsque `cronsDir` est défini) |
| WebSocket sur mise à niveau | Abonnements en temps réel |

## Référence de configuration

```typescript
interface RebaseBackendConfig {
    // Framework HTTP
    app: Hono;               // Instance d'application Hono
    server: Server;           // Serveur HTTP Node.js (pour l'attachement WebSocket)
    basePath?: string;        // Préfixe de route (par défaut : "/api")

    // Collections
    collections?: CollectionConfig[];  // Vos définitions de collection
    collectionsDir?: string;  // Charger automatiquement les collections depuis un répertoire

    // Bootstrappers (Bases de données, Authentification, Temps réel, etc.)
    bootstrappers: BackendBootstrapper[];

    // Authentification
    auth?: AuthConfig;

    // Stockage de fichiers
    storage?: BackendStorageConfig | Record<string, BackendStorageConfig>;

    // Historique des entités
    history?: boolean | HistoryConfig;

    // OpenAPI/Swagger
    enableSwagger?: boolean;

    // Points d'extrémité API personnalisés
    functionsDir?: string;    // Charger automatiquement les routes Hono depuis un répertoire

    // Tâches planifiées
    cronsDir?: string;        // Charger automatiquement les tâches cron depuis un répertoire

    // Journalisation
    logging?: { level?: "error" | "warn" | "info" | "debug" };
}
```

## L'instance Backend

`initializeRebaseBackend` retourne une `RebaseBackendInstance` avec accès aux services internes :

```typescript
const instance = await initializeRebaseBackend(config);

// Accès aux services internes
instance.driver              // Pilote de données par défaut
instance.driverRegistry      // Tous les pilotes (pour bases de données multiples)
instance.realtimeService     // Service temps réel par défaut
instance.userService         // Gestion des utilisateurs
instance.roleService         // Gestion des rôles
instance.storageController   // Stockage par défaut
instance.storageRegistry     // Tous les backends de stockage
instance.collectionRegistry  // Métadonnées de collection
instance.historyService      // Historique des entités
instance.cronScheduler       // Planificateur de tâches cron (lorsque cronsDir est défini)
```

> **Note :** Bien que l'`instance` expose ces services internes, le code d'application (comme les fonctions personnalisées et les tâches cron) doit utiliser le singleton global `rebase` de `@rebasepro/server` pour interagir avec l'API backend.

## API REST

L'API REST est auto-générée à partir de vos collections. Chaque collection obtient ces points d'extrémité :

| Méthode | Chemin | Description |
|--------|-------|-------------|
| `GET` | `/api/data/:slug` | Lister les entités (avec filtre, tri, limite, recherche) |
| `GET` | `/api/data/:slug/:id` | Obtenir une seule entité |
| `POST` | `/api/data/:slug` | Créer une nouvelle entité |
| `DELETE` | `/api/data/:slug/:id` | Supprimer une entité |

### Paramètres de requête

| Param | Description | Exemple |
|-------|-------------|---------|
| `filter` | Conditions de filtre encodées en JSON | `?filter={"active":["==",true]}` |
| `orderBy` | Champ de tri | `?orderBy=createdAt` |
| `order` | Direction du tri | `?order=desc` |
| `limit` | Taille de la page | `?limit=25` |
| `startAfter` | Curseur pour la pagination | `?startAfter=encodedCursor` |
| `search` | Recherche en texte intégral | `?search=laptop` |

## WebSocket

Le serveur WebSocket s'attache au même serveur HTTP et fournit des abonnements en temps réel :

- S'abonner aux **modifications de collection** — être averti lorsqu'une entité d'une collection est créée, mise à jour ou supprimée
- S'abonner aux **modifications d'entité** — être averti lorsqu'une entité spécifique est modifiée
- Gestion automatique de la **reconnexion** dans le SDK client

Le backend utilise PostgreSQL `LISTEN/NOTIFY` en interne. Pour les déploiements multi-instances, fournissez une `connectionString` dans votre `PostgresBootstrapper` pour activer la diffusion inter-instances.

## Gestion des erreurs

Le backend inclut un gestionnaire d'erreurs qui intercepte toutes les exceptions et retourne des réponses d'erreur structurées :

```json
{
    "error": {
        "message": "Entity not found",
        "code": "not-found",
        "status": 404
    }
}
```

Si l'initialisation échoue (par exemple, erreur de connexion à la base de données), le serveur démarre tout de même mais retourne 503 pour toutes les requêtes API, avec un message d'erreur descriptif dans les journaux.

## Prochaines étapes

- **[Authentification](/docs/backend/authentication)** — JWT, fournisseurs OAuth et OIDC, MFA, clés d'API, gestion des utilisateurs
- **[Stockage](/docs/backend/storage)** — Stockage de fichiers local et S3
- **[Callbacks d'entité](/docs/collections/callbacks)** — Hooks de cycle de vie et API `context.data`
- **[Historique des entités](/docs/backend/history)** — Piste d'audit
- **[Fonctions personnalisées](/docs/backend/custom-functions)** — Ajouter des points d'extrémité API personnalisés
- **[Tâches Cron](/docs/backend/cron-jobs)** — Tâches d'arrière-plan planifiées
- **[Ramification de base de données](/docs/backend/branching)** — Copies de base de données instantanées pour le développement/staging

---
