---
sourceHash: 9be8187c5259c1dd
title: Aperçu du backend
sidebar_label: Backend
description: Le backend Rebase fournit un serveur complet avec API REST, authentification, stockage, temps réel via WebSocket et historique des entités — le tout initialisé avec un simple appel de fonction.
---

## Aperçu

Le backend Rebase est un **serveur Node.js** basé sur [Hono](https://hono.dev/) qui fournit :

- **API REST** — Points de terminaison CRUD générés automatiquement pour chaque table
- **Authentification** — Jetons JWT, connexion OAuth et OIDC, liens magiques, codes à usage unique, MFA, clés d'API, gestion des utilisateurs et des rôles
- **Stockage** — Téléversement/téléchargement de fichiers avec le système de fichiers local ou S3
- **WebSocket** — Synchronisation des données en temps réel via PostgreSQL LISTEN/NOTIFY
- **Historique des entités** — Piste d'audit pour chaque modification de données
- **Branching de base de données** — Copies instantanées et isolées de la base de données pour le développement, le staging et les tests
- **Tâches Cron** — Tâches d'arrière-plan planifiées avec tableau de bord de surveillance

Tout est initialisé avec une seule fonction :

:::note[Emplacement de ce code]
L'appel ci-dessous correspond à ce qu'un backend **éjecté** contient, dans `backend/src/index.ts`. Sur
le **runtime managé**, un tel fichier n'existe pas : le runtime effectue l'appel, et
vous le configurez par le biais de variables d'environnement, des tables exportées par
`backend/schema/index.ts`, des ressources déclarées dans `backend/resources.ts` (`database()`,
`bucket()`), et de deux exports qu'il lit : `storageAuthorize` depuis
`backend/storage.ts` et `hooks` depuis `backend/hooks.ts`. Chaque page de cette
section précise lequel des deux s'applique à l'option documentée, et mentionne
celles qui n'ont pas d'équivalent managé. Si vous exportez autre chose depuis ces deux modules,
le runtime vous avertira au démarrage plutôt que de l'ignorer en silence ; si vous exportez un élément
qu'une déclaration de ressource a remplacé, le démarrage le refusera par son nom, en indiquant la
ligne à écrire dans `backend/resources.ts` à la place.
:::

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import path from "node:path";
import { env } from "./env";

const instance = await initializeRebaseBackend({
    app,
    server,
    schemaDir: path.resolve(__dirname, "../schema"),
    database: createPostgresAdapter({
        connection: db,
        schema: { tables, enums, relations }
    }),
    auth: {
        jwtSecret: env.JWT_SECRET,
    },
    storage: { type: "local", basePath: "./uploads" },
    history: true
});
```

Ce simple appel est un raccourci regroupant des étapes publiques : `installUnhandledRejectionHandler` empêche un rejet orphelin d'interrompre le processus, `createRebaseBackend` construit le backend, `setDefaultBackend` en fait l'instance à laquelle répond l'API au niveau du module, et `mount`, `attachRealtime` ainsi que `start` le servent. Pour ne monter que certains groupes de routes, les placer sur d'autres chemins, déléguer les minuteurs à un autre processus ou exécuter deux backends dans un seul processus, appelez vous-même ces étapes. Consultez [Intégration d'un serveur personnalisé](/docs/backend/custom-server/).

## Où se trouve chaque option

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Cet appel représente la configuration **éjectée** — celle que vous écrivez vous-même après `rebase eject`, ou dans un serveur personnalisé. Un projet généré à partir d'un template ne la possède pas : le runtime publié démarre le projet, et chaque option arrive sous la forme d'une variable d'environnement dans `.env`, d'un export depuis `backend/storage.ts` ou `backend/hooks.ts`, ou d'un répertoire déclaré par le bundle dans `rebase.json`.

Les deux approches aboutissent à la même `RebaseBackendConfig`. En voici la cartographie complète.

| Option | Runtime managé |
|---|---|
| `basePath` | `REBASE_BASE_PATH` (par défaut `/api`) |
| `tables`, `schemaDir`, `defaultRls` | le répertoire `backend/schema/` (la clé `tables` de `rebase.json`) : les tables et le `defaultRls` exportés par son `index.ts` |
| `functions`, `functionsDir` | `backend/functions/` |
| `functionsTimeoutMs` | `REBASE_FUNCTIONS_TIMEOUT_MS` |
| `crons`, `cronsDir` | `backend/crons/` |
| `bootstrappers`, `database` | `DATABASE_URL`, plus une déclaration `database("<key>")` dans `backend/resources.ts` pour chaque base de données au-delà de celle par défaut |
| `auth` | `JWT_SECRET`, les variables `OAUTH_*`, et la table déclarée par `backend/schema` avec `defineAuthTable` |
| `storage` | les variables `STORAGE_*`, plus une déclaration `bucket("<key>")` dans `backend/resources.ts` pour chaque bucket au-delà de celui par défaut |
| `storageAuthorize` | `export const storageAuthorize` depuis `backend/storage.ts` |
| `storagePublicRead` | `STORAGE_PUBLIC_READ` |
| `storageRenditionCache` | `STORAGE_RENDITION_CACHE` |
| `storageInsecureAllowAnyAuthenticated` | `STORAGE_ALLOW_ANY_AUTHENTICATED` |
| `storageDownloadTokenTtl` | `STORAGE_DOWNLOAD_TOKEN_TTL` |
| `hooks` | `export const hooks` depuis `backend/hooks.ts` — hooks de table globaux |
| `history` | `REBASE_HISTORY` (activé par défaut) — sous forme booléenne uniquement |
| `enableSwagger` | `REBASE_ENABLE_SWAGGER` ; non défini sert `/api/docs` à l'audience du point de terminaison de schéma, `true` le publie avec l'interface Swagger UI, `false` le restreint derrière l'accès administrateur |
| `compression` | `REBASE_COMPRESSION` |
| `maxBodySize` | `REBASE_MAX_BODY_SIZE` |
| `logging` | `LOG_LEVEL` |
| `liveSchema` | `REBASE_LIVE_SCHEMA_REPOSITORY` et ses identifiants `REBASE_LIVE_SCHEMA_*` — sous forme de dépôt uniquement |
| `rlsAudit` | `REBASE_RLS_AUDIT` |
| `provisionSchema`, `surfaces`, `ownership`, `functionsSelection`, `functionsUpstream` | `REBASE_ROLE` — voir [Processus séparés](/docs/deployment/split-processes/) |
| `corsHandled` | Le CORS est configuré par le runtime à partir de `CORS_ORIGINS` |
| `schemaVersion`, `runtimeVersion` | le build inscrit les deux dans le bundle |
| `app`, `server`, `provisioningDriverResult` | le runtime les crée |

### Options sans équivalent managé

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Celles-ci ne disposent d'aucune variable d'environnement ni d'aucun export de module. Elles ne sont accessibles que depuis un appel manuel à `initializeRebaseBackend` — lors d'un `rebase eject`, ou dans un [serveur personnalisé](/docs/backend/custom-server/) :

`rateLimit` · `jobs` · `csrf` · `cronPersistence` ·
`storagePolicies` · `storageTriggers` · `baas` · `schemaTables` ·
`history` sous sa forme d'objet (`{ retention }`)

`schemaEditor` est obligatoirement désactivé dans un bundle compilé : l'éditeur réécrit les fichiers *sources* de `backend/schema`, et un bundle ne contient que du code compilé.

## Ce qui est créé

Après l'initialisation, les routes suivantes sont montées :

| Chemin | Rôle |
|------|---------|
| `/api/auth/*` | Authentification (inscription, connexion, rafraîchissement, OAuth, liens magiques, codes à usage unique, MFA) |
| `/api/admin/*` | Utilisateurs, rôles, clés de service, cron, sauvegardes, journaux et schéma, chacun protégé par son propre [scope](/docs/backend/roles-and-scopes/) |
| `/api/storage/*` | Téléversement, téléchargement et suppression de fichiers |
| `/api/data/:slug` | Opérations CRUD par table (GET, POST, PATCH, DELETE) |
| `/api/data/:slug/:id/history` | Historique des modifications de l'entité (lorsqu'il est activé) |
| `/api/docs` | Spécification OpenAPI des tables que l'appelant est autorisé à voir (publique avec `enableSwagger: true` ; réservée aux administrateurs avec `false`) |
| `/api/swagger` | Swagger UI (avec `enableSwagger: true`, hors production uniquement) |
| `/api/schema/tables` | Les tables servies par ce backend, telles que l'appelant est autorisé à les voir — voir [Points de terminaison](/docs/backend/endpoints/#schema) |
| `/api/meta/contract` | La version du schéma, le runtime et chaque table tels qu'un administrateur les voit (nécessite `schema:read`) |
| `/api/meta/schema-version` | Une chaîne de version pour ce schéma (non authentifiée) |
| `/api/functions/*` | Routes de fonctions personnalisées (lorsque `functions` ou `functionsDir` est défini) |
| `/api/admin/cron/*` | Gestion des tâches cron (`cron:read` / `cron:write`, lorsque `crons` ou `cronsDir` est défini) |
| WebSocket lors de l'upgrade | Abonnements en temps réel, sur `/` pour une API située à `/api` |

---

## Le cycle de vie de l'initialisation

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Lorsque vous appelez `initializeRebaseBackend()`, le framework déclenche une séquence de démarrage séquentielle en 5 étapes :

```
[Start Boot]
     │
     ▼
1. Configuration (the database adapter, the auth and storage options you passed)
     │
     ▼
2. Schema Loading (imports backend/schema/index.ts, compiles every table — a problem in any refuses the boot)
     │
     ▼
3. Database Bootstrapping (creates schemas/auth/helper SQL functions, as `provision` allows)
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

**Le démarrage échoue de manière explicite.** Si la base de données est inaccessible, que les identifiants sont incorrects, ou que le schéma ne peut être compilé ou appliqué, `initializeRebaseBackend` lève une exception, rien n'est servi, et le processus se termine avec le code `1`. Il n'y a pas de mode dégradé ni de serveur partiel : un conteneur qui ne peut pas joindre sa base de données redémarre, et l'erreur responsable de son arrêt constitue la dernière ligne de ses logs.

Ce comportement est délibéré. Un serveur qui démarre et répond aux demandes de connexion alors que toutes les routes `/api/data/*` échouent est beaucoup plus difficile à diagnostiquer qu'un serveur qui ne démarre jamais — et un orchestrateur peut réagir face à une boucle de plantages (crash loop).

Avant la première requête, la procédure de démarrage teste la connexion et affiche un diagnostic : l'hôte et le port inaccessibles, la raison renvoyée par le pilote (`ECONNREFUSED`, `password authentication failed for user "app"`), ainsi que la solution. Consultez [Dépannage](/docs/troubleshooting/) pour la liste détaillée des pannes.

### Une fois en service : `/livez` et `/health`

Deux sondes, répondant à deux questions différentes.

| Chemin | Accède à la base de données | Répond |
| --- | --- | --- |
| `/livez` | Non | `200 {"status":"ok"}` tant que le processus est en cours d'exécution. Utilisez-le pour une sonde de vivacité (liveness probe). |
| `/health` | Oui, chaque source de données | `200 {"status":"ok"}` lorsque toutes les sources de données configurées répondent ; `503 {"status":"degraded"}` si l'une d'elles échoue. Utilisez-le pour une sonde d'état de préparation (readiness probe). |

Définir une sonde de vivacité (liveness probe) sur `/health` est une erreur qui mérite d'être soulignée : une micro-coupure de la base de données inciterait l'orchestrateur à tuer un processus par ailleurs sain, transformant une courte panne en une boucle de redémarrage.

`/health` ne nécessite pas d'authentification, elle publie donc le verdict et non la cause — en dehors de l'environnement de développement, elle indique quelle source de données est dégradée et rien d'autre. Le message d'erreur du pilote mentionne l'hôte, le port, le nom de la base de données et le rôle, et ces informations sont envoyées dans les logs. `/health` est également servie sous le `basePath` (`/api/health`) ; ce n'est pas le cas de `/livez`.

Ces deux sondes appartiennent au runtime managé. Un fichier `backend/src/index.ts` éjecté sert lui-même `/health` et `/api/health`, en interrogeant uniquement la base de données par défaut, et ne dispose d'aucun `/livez` tant que vous n'en ajoutez pas un.

---

## Référence de configuration

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

```typescript
interface RebaseBackendConfig {
    // HTTP framework
    app: Hono;               // Hono application instance
    server: Server;           // Node.js HTTP server (for WebSocket attachment)
    basePath?: string;        // Route prefix (default: "/api")

    // Tables
    tables?: (AnyTableDef | AnyViewDef)[]; // defineTable / defineAuthTable / defineView results
    defaultRls?: DefaultRls;  // What `rls: "inherit"` tables take, when you pass `tables`
    schemaDir?: string;       // The backend/schema directory: loaded when `tables` is absent, and what the schema editor writes
    hooks?: TableHooks;       // Global table hooks, run for every table

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

    // Custom API endpoints: values, or a directory of files (not both)
    functions?: Record<string, FunctionApp>;  // { "send-invoice": app } → /api/functions/send-invoice
    functionsDir?: string;    // Auto-load Hono routes from a directory

    // Scheduled tasks: values, or a directory of files (not both)
    crons?: Record<string, CronJobDefinition>; // { "nightly-report": defineCron(…) }
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

Cinq de ces options sont faciles à négliger et modifient des comportements que vous ne feriez autrement que constater :

| Clé | Valeur par défaut | Description |
|---|---|---|
| `compression` | `true` | gzip/deflate sur les réponses de l'API, négocié à partir de `Accept-Encoding`. Les corps déjà compressés, diffusés en continu (streamed) ou marqués `no-transform` ne sont pas modifiés, tout comme les corps inférieurs à 1 Ko (gzip coûte plus qu'il ne rapporte dans ce cas), il est donc sûr de le laisser activé — une volumineuse liste JSON est généralement réduite d'environ un facteur 20. Réglez sur `false` lorsque nginx, Cloudflare ou un autre proxy en amont compresse déjà, afin d'éviter un double traitement. Environnement : `REBASE_COMPRESSION`. |
| `maxBodySize` | `10485760` (10 Mo) | Plafond pour les corps de requête sur les routes d'API ; `0` le désactive. Les téléversements de fichiers utilisent le `maxFileSize` propre à la configuration de stockage (50 Mo), qui prévaut pour ces routes. Environnement : `REBASE_MAX_BODY_SIZE`. |
| `csrf` | désactivé | **Optionnel (opt-in).** Une API BaaS est appelée par des applications mobiles, des SPA hébergées sur d'autres domaines et des outils CLI, dont aucun n'envoie un en-tête `Origin` qu'une liste fixe accepterait — cette option n'est donc pas activée par défaut. Activez-la en indiquant les origines utilisées par vos clients navigateurs. Aucun format en variable d'environnement : éjectez pour la définir. |
| `cronPersistence` | `true` | Indique si les journaux d'exécution sont écrits dans `rebase.cron_logs`. `false` permet de maintenir l'exécution des tâches avec un historique conservé uniquement en mémoire, que le panneau Studio perd alors au redémarrage. |
| `schemaEditor` | activé hors production, lorsque `schemaDir` est défini | Force l'activation ou la désactivation des routes de l'éditeur de schéma. L'éditeur réécrit les *fichiers sources* de `backend/schema`, il a donc besoin d'un répertoire où écrire — or un bundle compilé n'en possède aucun, raison pour laquelle un déploiement ne l'a jamais. |

Le reste de `RebaseBackendConfig` est soit documenté sur sa propre page (`auth`,
`storage`, `jobs`, `hooks`, `liveSchema`, `rlsAudit`, `schemaTables`), soit marqué `@internal` :
`bootstrappers`, `provisioningDriverResult`, `provisionSchema`, `corsHandled`,
`functionsSelection`, `functionsUpstream` et `runtimeVersion` sont renseignés par
`bootFromBundle` à partir de l'environnement, et les transmettre manuellement risque
d'entrer en conflit avec la perception qu'a le runtime de ce processus.

## L'instance du backend

`initializeRebaseBackend` renvoie le backend qu'il a construit, déjà monté et
démarré. Son type est `RebaseBackendInstance`, qui correspond à `RebaseBackend`, le
type renvoyé par `createRebaseBackend` :

```typescript
const instance = await initializeRebaseBackend(config);

// Internal service access
instance.driver              // Default data driver
instance.driverRegistry      // All drivers (for multi-database)
instance.realtimeService     // Default realtime service
instance.auth?.userService       // User management
instance.storageController   // Default storage
instance.storageRegistry     // All storage backends
instance.getTableDescriptors() // The compiled tables, as GET /api/schema/tables serves them
instance.history?.historyService // Entity history
instance.cronScheduler       // Cron job scheduler (when crons or cronsDir is set)
instance.jobQueue            // Durable job queue (when jobs are enabled)
instance.setTableHooks(slug, hooks) // Replace a table's hooks
instance.shutdown()          // Drain and stop; also closes the server it was given
```

Elle fournit également
`rebase`, le client in-process, `fetch(request)`, `routes`, les groupes de routes
sous forme de sous-applications Hono, `services`, ses propres clés JWT, son modèle d'accès, son magasin de clés d'API et
ses limiteurs de débit, ainsi que `verifyCredential(token)` ; voir
[Intégration d'un serveur personnalisé](/docs/backend/custom-server/).

> **Remarque :** Bien que l'`instance` expose ces services internes, le code applicatif (comme les fonctions personnalisées et les tâches cron) doit utiliser le singleton `rebase` de `@rebasepro/server` pour interagir avec l'API du backend. Au sein d'une requête, d'une exécution de tâche cron ou d'un job, `rebase` représente le backend qui la sert ; ailleurs, il s'agit de la valeur par défaut du processus, configurée par `initializeRebaseBackend` sur son backend.

## API REST

L'API REST est générée à partir de vos tables. Chaque table dispose de ces points de terminaison :

| Méthode | Chemin | Description |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | Lister les entités — le filtrage, le tri, la pagination et la recherche se font par paramètres de requête |
| `GET` | `/api/data/:slug/count` | Nombre de lignes correspondant à cette même requête |
| `GET` | `/api/data/:slug/aggregate` | `count`/`sum`/`avg`/`min`/`max`, éventuellement groupés |
| `GET` | `/api/data/:slug/:id` | Récupérer une seule entité |
| `POST` | `/api/data/:slug` | Créer une nouvelle entité |
| `PATCH` | `/api/data/:slug/:id` | Mettre à jour les champs transmis |
| `DELETE` | `/api/data/:slug/:id` | Supprimer un enregistrement |
| `POST` | `/api/data/:slug/bulk` | Créer plusieurs lignes dans une seule transaction |
| `PATCH` | `/api/data/:slug/bulk` | Mettre à jour plusieurs lignes dans une seule transaction |
| `POST` | `/api/data/:slug/bulk/delete` | Supprimer plusieurs lignes dans une seule transaction |

### Paramètres de requête

Il existe une référence dédiée pour ces paramètres, et ce n'est pas cette page. La documentation de l'[API REST](/docs/backend/api/) détaille les deux dialectes de requête acceptés par le serveur — le format de style PostgREST `?column=op.value` et le format JSON `?where=` — ainsi que `orderBy`, `limit`/`offset`, `include`, `fields`, `searchString` et la recherche vectorielle. [Points de terminaison](/docs/backend/endpoints/) répertorie l'ensemble des routes montées par le serveur, y compris celles générées automatiquement.

Tout paramètre non réservé par le serveur est interprété comme un filtre sur la colonne portant ce nom ; ainsi, un paramètre inventé ne provoque pas d'erreur, mais ne renvoie simplement aucun résultat.

## WebSocket

Le serveur WebSocket se rattache au même serveur HTTP et fournit des abonnements en temps réel. Il répond aux requêtes de mise à niveau (upgrade) sur un chemin unique, `/` pour une API située à `/api`, là où le SDK se connecte, et laisse tous les autres chemins à vos propres écouteurs `upgrade` :

- S'abonner aux **modifications de tables** — être notifié lorsqu'une ligne d'une table est créée, mise à jour ou supprimée
- S'abonner aux **modifications de lignes** — être notifié lorsqu'une ligne spécifique change
- Gestion automatique de la **reconnexion** dans le SDK typé

Le backend utilise PostgreSQL `LISTEN/NOTIFY` en interne. Pour les déploiements multi-instances, fournissez une `connectionString` dans votre `PostgresBootstrapper` pour activer la diffusion entre instances.

## Gestion des erreurs

Chaque échec — quelle que soit la route ou le sous-système — est retourné dans une enveloppe unique :

```json
{
    "error": {
        "message": "Entity not found",
        "code": "NOT_FOUND",
        "requestId": "9f1c0b8e-4d2a-4e1b-9d0f-2c7a5b3e6a11"
    }
}
```

| Champ | Toujours présent | Description |
|-------|:--------------:|------------|
| `message` | oui | Rédigé pour une personne lisant une console. Décrit l'obstacle, pas la règle. |
| `code` | oui | En `SCREAMING_SNAKE_CASE` et stable. C'est le champ à utiliser pour vos conditions. |
| `details` | non | Données structurées lorsque le refus concerne des éléments précis — une liste de chemins en échec, un ensemble de champs inconnus. |
| `requestId` | non | Présent lorsque la requête en portait un ou s'en est vu attribuer un ; reprend `X-Request-ID`. À indiquer dans un rapport de bug. |

Le statut HTTP figure sur la réponse, pas dans le corps. Fondez vos conditions sur `code`, et non sur `message` — les messages sont rédigés pour des humains et sont susceptibles de changer.

Le SDK typé convertit chacune de ces erreurs en une `RebaseApiError` contenant `status`, `code` et `details` — y compris les échecs qui n'ont jamais atteint le serveur. Une connexion refusée, une panne DNS, une erreur CORS ou une interruption se traduit par un `status: 0`, `code: "NETWORK_ERROR"`, avec l'erreur propre au runtime dans `cause`, plutôt que par l'erreur brute renvoyée par `fetch`. Une réponse sans enveloppe — un code 413 renvoyé par un proxy, un 502 émis par un répartiteur de charge — reçoit tout de même un `code` dérivé de son statut (`PAYLOAD_TOO_LARGE`, `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR`, …), et un client instancié hors d'un navigateur sans `baseUrl` échoue avec `BASE_URL_REQUIRED` plutôt qu'avec une erreur réseau. Une lecture couronnée de succès mais ne correspondant pas à la structure attendue — un `204`, un corps vide, une page sans liste `data` — échoue avec `UNEXPECTED_RESPONSE` au lieu d'indiquer « aucune ligne », et l'appel à `createMany`, `updateMany`, `deleteMany` ou `batch` avec un paramètre autre qu'un tableau échoue avec `INVALID_BULK_BODY`, le code qu'utilise le serveur pour cette même erreur. Ainsi, le code de l'application n'a qu'une seule classe à intercepter :

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

## Prochaines étapes

- **[Authentification](/docs/backend/authentication)** — Fournisseurs JWT, OAuth et OIDC, MFA, clés d'API, gestion des utilisateurs
- **[Stockage](/docs/backend/storage)** — Stockage de fichiers en local et sur S3
- **[Hooks de table](/docs/collections/callbacks)** — Hooks de cycle de vie et API `context.data`
- **[Historique des entités](/docs/backend/history)** — Piste d'audit
- **[Fonctions personnalisées](/docs/backend/custom-functions)** — Ajouter des points de terminaison d'API personnalisés
- **[Tâches Cron](/docs/backend/cron-jobs)** — Tâches d'arrière-plan planifiées
- **[Branching de base de données](/docs/backend/branching)** — Copies instantanées de bases de données pour le dev/staging
- **[Déploiement](/docs/getting-started/deployment)** — Passer le backend en production
