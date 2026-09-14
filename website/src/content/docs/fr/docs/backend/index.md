---
sourceHash: 21b1ae6712a17e38
title: Vue d'ensemble du backend
sidebar_label: Backend
description: Le backend Rebase fournit un serveur complet avec API REST, authentification, stockage, temps réel via WebSocket et historique des entités — le tout initialisé avec un seul appel de fonction.
---

## Vue d'ensemble

Le backend Rebase est un **serveur Node.js** basé sur [Hono](https://hono.dev/) qui fournit :

- **API REST** — Points de terminaison CRUD générés automatiquement pour chaque collection
- **Authentification** — Jetons JWT, connexion OAuth et OIDC, liens magiques, codes à usage unique, MFA, clés d'API, gestion des utilisateurs et des rôles
- **Stockage** — Téléversement/téléchargement de fichiers avec le système de fichiers local ou S3
- **WebSocket** — Synchronisation des données en temps réel via PostgreSQL LISTEN/NOTIFY
- **Historique des entités** — Piste d'audit pour chaque modification de données
- **Branching de base de données** — Copies instantanées et isolées de bases de données pour le dev, le staging et les tests
- **Tâches Cron** — Tâches d'arrière-plan planifiées avec tableau de bord de surveillance

Tout est initialisé avec une seule fonction :

:::note[Où placer ce code]
L'appel ci-dessous correspond à ce qu'un backend **éjecté** contient, dans `backend/src/index.ts`. Sur le **runtime managé**, un tel fichier n'existe pas : le runtime effectue l'appel, et vous le configurez via des variables d'environnement, les ressources que vous déclarez dans `config/resources.ts` (`database()`, `bucket()`), et les deux exports qu'il lit depuis `config/index.ts` (`storageAuthorize`, `callbacks`). Chaque page de cette section indique laquelle des deux approches s'applique à l'option documentée, et mentionne celles qui ne disposent d'aucune forme managée. Si vous exportez une option que le runtime ne lit pas, il vous avertit au démarrage plutôt que de l'ignorer en silence ; si vous exportez une option remplacée par une déclaration de ressource, le démarrage la refuse explicitement en indiquant la ligne à écrire dans `config/resources.ts`.
:::

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

## Où réside chaque option

Cet appel représente la forme **éjectée** — celle que vous écrivez vous-même après un `rebase eject`, ou dans un serveur personnalisé. Un projet généré à partir d'un template ne l'a pas : le runtime publié démarre le projet, et chaque option provient d'une variable d'environnement dans `.env`, d'un export depuis `config/index.ts`, ou d'un répertoire que le bundle déclare dans `rebase.json`.

Les deux voies aboutissent au même `RebaseBackendConfig`. En voici la correspondance complète.

| Option | Runtime managé |
|---|---|
| `basePath` | `REBASE_BASE_PATH` (par défaut `/api`) |
| `collections`, `collectionsDir` | le répertoire `config/collections/`, déclaré par `rebase.json` |
| `functionsDir` | `backend/functions/` |
| `cronsDir` | `backend/crons/` |
| `bootstrappers`, `database` | `DATABASE_URL`, plus une déclaration `database("<key>")` dans `config/resources.ts` pour chaque base de données au-delà de celle par défaut |
| `auth` | `JWT_SECRET`, les variables `OAUTH_*` et `config/collections/users` |
| `storage` | les variables `STORAGE_*`, plus une déclaration `bucket("<key>")` dans `config/resources.ts` pour chaque bucket au-delà de celui par défaut |
| `storageAuthorize` | `export const storageAuthorize` depuis `config/index.ts` |
| `storagePublicRead` | `STORAGE_PUBLIC_READ` |
| `storageRenditionCache` | `STORAGE_RENDITION_CACHE` |
| `storageInsecureAllowAnyAuthenticated` | `STORAGE_ALLOW_ANY_AUTHENTICATED` |
| `callbacks` | `export const callbacks` depuis `config/index.ts` |
| `history` | `REBASE_HISTORY` (activé par défaut) — sous forme booléenne uniquement |
| `enableSwagger` | `REBASE_ENABLE_SWAGGER` ; non défini signifie activé hors production |
| `compression` | `REBASE_COMPRESSION` |
| `maxBodySize` | `REBASE_MAX_BODY_SIZE` |
| `logging` | `LOG_LEVEL` |
| `provisionSchema`, `surfaces`, `ownership`, `functionsSelection`, `functionsUpstream` | `REBASE_ROLE` — voir [Processus séparés](/docs/deployment/split-processes/) |
| `corsHandled` | Le CORS est installé par le runtime à partir de `CORS_ORIGINS` |
| `schemaVersion`, `runtimeVersion` | le build inscrit les deux dans le bundle |
| `app`, `server`, `provisioningDriverResult` | le runtime les crée |

### Options sans équivalent managé

Celles-ci ne disposent d'aucune variable d'environnement ni d'aucun export de configuration. Elles ne sont accessibles que depuis un appel manuel à `initializeRebaseBackend` — lors d'un `rebase eject`, ou dans un [serveur personnalisé](/docs/backend/custom-server/) :

`rateLimit` · `jobs` · `csrf` · `cronPersistence` · `functionsTimeoutMs` ·
`storagePolicies` · `storageTriggers` · `baas` · `liveSchema` · `rlsAudit` ·
`history` sous sa forme d'objet (`{ retention }`)

`schemaEditor` est obligatoirement désactivé dans un bundle compilé : l'éditeur réécrit les fichiers *sources* des collections, or un bundle ne contient que des sorties compilées.

## Ce qui est créé

Après l'initialisation, ces routes sont montées :

| Chemin | Rôle |
|------|---------|
| `/api/auth/*` | Authentification (inscription, connexion, rafraîchissement, OAuth, liens magiques, codes à usage unique, MFA) |
| `/api/admin/*` | Gestion des utilisateurs et des rôles (réservé aux administrateurs) |
| `/api/storage/*` | Téléversement, téléchargement et suppression de fichiers |
| `/api/data/:slug` | Opérations CRUD par collection (GET, POST, PATCH, DELETE) |
| `/api/data/:slug/:id/history` | Historique des modifications de l'entité (si activé) |
| `/api/docs` | Spécification OpenAPI (lorsque `enableSwagger: true`) |
| `/api/swagger` | Interface Swagger UI (mode développement, lorsque `enableSwagger: true`) |
| `/api/meta/contract` | Schéma des collections du projet (réservé aux administrateurs) |
| `/api/meta/schema-version` | Chaîne de version pour ce schéma (non authentifié) |
| `/api/functions/*` | Routes de fonctions personnalisées (lorsque `functionsDir` est défini) |
| `/api/cron/*` | Gestion des tâches cron (réservé aux administrateurs, lorsque `cronsDir` est défini) |
| WebSocket sur mise à niveau (upgrade) | Abonnements en temps réel |

---

## Le cycle de vie de l'initialisation

Lorsque vous invoquez `initializeRebaseBackend()`, le framework déclenche une séquence de démarrage séquentielle en 5 étapes :

```
[Start Boot]
     │
     ▼
1. ENV validation (Zod parsing of jwt, databases, cors)
     │
     ▼
2. Dynamic Collection Loading (Chokidar watches .ts files, AST parsing)
     │
     ▼
3. Database Bootstrapping (Acquires advisory lock, creates schemas/auth/helper SQL functions)
     │
     ▼
4. Service Initialization (Auth, Storage S3/Local client instances, Cron store seeding)
     │
     ▼
5. Route Mounting & Edge Loading (Hono controllers, custom functions, WebSocket binding)
     │
     ▼
[Boot Complete]
```

---

## Que se passe-t-il en cas d'échec du démarrage

**Le démarrage échoue de manière stricte et immédiate.** Si la base de données est inaccessible, que les identifiants sont incorrects ou que le schéma de collection ne peut pas être appliqué, `initializeRebaseBackend` lève une exception, rien n'est servi et le processus se termine avec le code de sortie `1`. Il n'y a aucun mode dégradé ni serveur partiel : un conteneur incapable de joindre sa base de données redémarre, et l'erreur ayant provoqué son arrêt est la dernière chose présente dans ses logs.

C'est délibéré. Un serveur qui démarre en répondant aux requêtes d'authentification alors que chaque route `/api/data/*` échoue est bien plus difficile à diagnostiquer qu'un serveur qui ne démarre jamais — et un orchestrateur peut réagir face à une boucle de plantage (crash loop).

Avant la première requête, le démarrage teste la connexion et affiche le diagnostic : l'hôte et le port qu'il n'a pas pu joindre, la raison fournie par le pilote lui-même (`ECONNREFUSED`, `password authentication failed for user "app"`), et la solution. Consultez la page de [Dépannage](/docs/troubleshooting/) pour obtenir la liste détaillée de chaque défaillance.

### Une fois en service : `/livez` et `/health`

Deux sondes, répondant à deux questions différentes.

| Chemin | Interroge la base de données | Réponse |
| --- | --- | --- |
| `/livez` | Non | `200 {"status":"ok"}` tant que le processus est en cours d'exécution. À utiliser comme sonde de vivacité (liveness probe). |
| `/health` | Oui, chaque source de données | `200 {"status":"ok"}` lorsque chaque source de données configurée répond ; `503 {"status":"degraded"}` dès que l'une d'entre elles échoue. À utiliser comme sonde d'aptitude (readiness probe). |

Placer une sonde de vivacité sur `/health` est une erreur importante à souligner : une saute d'humeur passagère de la base de données pousserait l'orchestrateur à tuer un processus par ailleurs sain, transformant une courte panne en boucle de redémarrage.

`/health` n'est pas authentifié, il ne publie donc que le verdict et non la cause — en dehors du développement, il indique quelle source de données est dégradée, rien de plus. Le message d'erreur du pilote mentionne l'hôte, le port, le nom de la base de données et le rôle, et cette information est dirigée vers les logs. Les deux chemins sont également exposés sous `basePath` (`/api/health`).

---

## Référence de configuration

```typescript
interface RebaseBackendConfig {
    // HTTP framework
    app: Hono;               // Hono application instance
    server: Server;           // Node.js HTTP server (for WebSocket attachment)
    basePath?: string;        // Route prefix (default: "/api")

    // Collections
    collections?: CollectionConfig[];  // Your collection definitions
    collectionsDir?: string;  // Auto-load collections from a directory

    // Database adapter (PostgreSQL, SQLite, etc.)
    database?: DatabaseAdapter;

    // Authentication configuration or custom adapter
    auth?: RebaseAuthConfig | AuthAdapter;

    // File storage
    storage?: BackendStorageConfig | Record<string, BackendStorageConfig>;

    // Entity history
    history?: boolean | HistoryConfig;

    // OpenAPI/Swagger
    enableSwagger?: boolean;

    // Custom API endpoints
    functionsDir?: string;    // Auto-load Hono routes from a directory

    // Scheduled tasks
    cronsDir?: string;         // Auto-load cron jobs from a directory
    cronPersistence?: boolean; // Write run logs to rebase.cron_logs (default: true)

    // HTTP behaviour
    compression?: boolean;     // gzip/deflate for API responses (default: true)
    maxBodySize?: number;      // Request-body ceiling in bytes (default: 10MB; 0 disables)
    csrf?: { origin: string | string[] | ((origin: string) => boolean) };

    // Schema editing
    schemaEditor?: boolean;   // Force the schema-editor routes on or off

    // Logging
    logging?: { level?: "error" | "warn" | "info" | "debug" };
}
```

Cinq de ces options sont faciles à négliger et modifient des comportements que vous ne pourriez observer qu'autrement :

| Clé | Valeur par défaut | Description |
|---|---|---|
| `compression` | `true` | gzip/deflate sur les réponses de l'API, négocié d'après `Accept-Encoding`. Les corps déjà compressés, streamés et avec l'en-tête `no-transform` ne sont pas modifiés, il est donc sans danger de la laisser active — une liste JSON volumineuse voit généralement sa taille réduite d'environ un facteur 20. Définissez à `false` lorsqu'un proxy comme nginx, Cloudflare ou un autre en amont effectue déjà la compression, afin d'éviter un double coût de traitement. Variable d'environnement : `REBASE_COMPRESSION`. |
| `maxBodySize` | `10485760` (10 Mo) | Plafond pour les corps de requêtes sur les routes API ; `0` le désactive. Les téléversements de stockage utilisent le `maxFileSize` propre à la configuration de stockage (50 Mo), qui prévaut pour ces routes. Variable d'environnement : `REBASE_MAX_BODY_SIZE`. |
| `csrf` | désactivé | **Activation explicite (Opt-in).** Une API BaaS est appelée par des applications mobiles, des SPAs sur d'autres domaines et des outils CLI, dont aucun n'envoie d'en-tête `Origin` qu'une liste fixe accepterait — ce n'est donc pas activé par défaut. Activez-le en spécifiant les origines utilisées par vos clients navigateurs. Aucune variable d'environnement : éjectez pour le configurer. |
| `cronPersistence` | `true` | Détermine si les journaux d'exécution sont enregistrés dans `rebase.cron_logs`. `false` permet de faire tourner les tâches tout en conservant l'historique uniquement en mémoire, ce qui est alors perdu par le panneau Studio lors d'un redémarrage. |
| `schemaEditor` | activé hors production, quand `collectionsDir` est défini | Force l'activation ou la désactivation des routes de l'éditeur de schéma. L'éditeur réécrit les *fichiers sources* des collections, il a donc besoin d'un répertoire dans lequel écrire — or un bundle compilé n'en a pas, c'est pourquoi un déploiement n'en dispose jamais. |

Le reste de `RebaseBackendConfig` est soit documenté sur sa propre page (`auth`, `storage`, `jobs`, `callbacks`, `liveSchema`, `rlsAudit`), soit marqué `@internal` : `bootstrappers`, `provisioningDriverResult`, `provisionSchema`, `corsHandled`, `functionsSelection`, `functionsUpstream` et `runtimeVersion` sont renseignés par `bootFromBundle` à partir de l'environnement, et les passer manuellement risque d'entrer en conflit avec ce que le runtime attend pour ce processus.

## L'instance du backend

`initializeRebaseBackend` renvoie une instance `RebaseBackendInstance` offrant l'accès aux services internes :

```typescript
const instance = await initializeRebaseBackend(config);

// Internal service access
instance.driver              // Default data driver
instance.driverRegistry      // All drivers (for multi-database)
instance.realtimeService     // Default realtime service
instance.auth?.userService       // User management
instance.auth?.roleService       // Role management
instance.storageController   // Default storage
instance.storageRegistry     // All storage backends
instance.collectionRegistry  // Collection metadata
instance.history?.historyService // Entity history
instance.cronScheduler       // Cron job scheduler (when cronsDir is set)
```

> **Remarque :** Bien que l'`instance` expose ces services internes, le code applicatif (comme les fonctions personnalisées et les tâches cron) doit utiliser le singleton global `rebase` de `@rebasepro/server` pour interagir avec l'API backend.

## API REST

L'API REST est générée automatiquement à partir de vos collections. Chaque collection dispose de ces points de terminaison :

| Méthode | Chemin | Description |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | Lister les entités — le filtrage, le tri, la pagination et la recherche se font par paramètres de requête |
| `GET` | `/api/data/:slug/count` | Nombre de lignes correspondant à cette même requête |
| `GET` | `/api/data/:slug/aggregate` | `count`/`sum`/`avg`/`min`/`max`, éventuellement groupés |
| `GET` | `/api/data/:slug/:id` | Récupérer une entité unique |
| `POST` | `/api/data/:slug` | Créer une nouvelle entité |
| `PATCH` | `/api/data/:slug/:id` | Mettre à jour les champs envoyés |
| `DELETE` | `/api/data/:slug/:id` | Supprimer un enregistrement |
| `POST` | `/api/data/:slug/bulk` | Créer plusieurs lignes dans une seule transaction |
| `PATCH` | `/api/data/:slug/bulk` | Mettre à jour plusieurs lignes dans une seule transaction |
| `POST` | `/api/data/:slug/bulk/delete` | Supprimer plusieurs lignes dans une seule transaction |

### Paramètres de requête

Il existe une référence unique pour ces paramètres, et ce n'est pas cette page. La documentation de l'[API REST](/docs/backend/api/) détaille les deux syntaxes de requête acceptées par le serveur — le format de type PostgREST `?column=op.value` et le format JSON `?where=` — ainsi que `orderBy`, `limit`/`offset`, `include`, `fields`, `searchString` et la recherche vectorielle. La page des [Endpoints](/docs/backend/endpoints/) constitue l'index de chaque route montée par le serveur, y compris celles générées automatiquement.

Tout paramètre qui n'est pas réservé par le serveur est interprété comme un filtre sur la colonne portant ce nom ; par conséquent, un paramètre inventé ne provoque pas d'erreur : il ne correspondra simplement à aucun résultat.

## WebSocket

Le serveur WebSocket se greffe sur le même serveur HTTP et fournit des abonnements en temps réel :

- Abonnement aux **changements de collection** — soyez notifié dès qu'une entité d'une collection est créée, mise à jour ou supprimée
- Abonnement aux **changements d'entités** — soyez notifié lorsqu'une entité spécifique est modifiée
- Gestion automatique de la **reconnexion** dans le SDK client

Le backend s'appuie en interne sur le mécanisme `LISTEN/NOTIFY` de PostgreSQL. Pour les déploiements multi-instances, fournissez une chaîne `connectionString` dans votre `PostgresBootstrapper` pour activer la diffusion inter-instances.

## Gestion des erreurs

Chaque défaillance — quelle que soit la route ou le sous-système concerné — est renvoyée dans une enveloppe unique :

```json
{
    "error": {
        "message": "Entity not found",
        "code": "NOT_FOUND",
        "requestId": "9f1c0b8e-4d2a-4e1b-9d0f-2c7a5b3e6a11"
    }
}
```

| Champ | Toujours présent | Ce que c'est |
|-------|:--------------:|------------|
| `message` | oui | Rédigé pour un être humain lisant une console. Désigne l'obstacle rencontré, pas la règle. |
| `code` | oui | En `SCREAMING_SNAKE_CASE` et stable. C'est le champ à utiliser pour vos embranchements conditionnels. |
| `details` | non | Charge utile structurée lorsque le refus *porte* sur un élément précis — une liste de chemins en échec, un ensemble de champs inconnus. |
| `requestId` | non | Présent lorsque la requête en comportait un ou qu'un identifiant lui a été attribué ; reprend `X-Request-ID`. À inclure dans un rapport de bug. |

Le statut HTTP figure sur la réponse elle-même, pas dans le corps. Basez vos conditions sur `code` et non sur `message` — les messages sont rédigés pour des humains et sont susceptibles d'évoluer.

Le SDK client convertit chacune de ces réponses en une `RebaseApiError` contenant `status`, `code` et `details` — y compris les échecs qui n'ont jamais pu atteindre le serveur. Une connexion refusée, une défaillance DNS, une erreur CORS ou une annulation arrive sous la forme `status: 0`, `code: "NETWORK_ERROR"`, avec l'erreur originelle du runtime dans `cause`, plutôt que sous la forme aléatoire avec laquelle `fetch` aurait pu rejeter. Le code applicatif n'a ainsi qu'une seule classe à capturer :

```typescript
async function setPrice(id: string, price: number) {
    try {
        return await client.data.products.update(id, { price });
    } catch (e) {
        if (e instanceof RebaseApiError && e.code === "NOT_FOUND") return null;
        throw e;
    }
}
```

## Étapes suivantes

- **[Authentification](/docs/backend/authentication)** — Fournisseurs JWT, OAuth et OIDC, MFA, clés d'API, gestion des utilisateurs
- **[Stockage](/docs/backend/storage)** — Stockage de fichiers en local et sur S3
- **[Callbacks d'entités](/docs/collections/callbacks)** — Hooks de cycle de vie et API `context.data`
- **[Historique des entités](/docs/backend/history)** — Piste d'audit
- **[Fonctions personnalisées](/docs/backend/custom-functions)** — Ajouter des points de terminaison d'API personnalisés
- **[Tâches Cron](/docs/backend/cron-jobs)** — Tâches d'arrière-plan planifiées
- **[Branching de base de données](/docs/backend/branching)** — Copies instantanées de base de données pour dev/staging
- **[Déploiement](/docs/getting-started/deployment)** — Mettre le backend en production
