---
sourceHash: c9afeee7ed06431e
title: Vue d'ensemble du backend
sidebar_label: Backend
description: Le backend Rebase fournit un serveur complet avec API REST, authentification, stockage, temps réel via WebSocket et historique des entités — le tout initialisé avec un simple appel de fonction.
---

## Vue d'ensemble

Le backend Rebase est un **serveur Node.js** basé sur [Hono](https://hono.dev/) qui fournit :

- **API REST** — Points de terminaison CRUD générés automatiquement pour chaque table
- **Authentification** — Jetons JWT, connexion OAuth et OIDC, liens magiques, codes à usage unique, MFA, clés d'API, gestion des utilisateurs/rôles
- **Stockage** — Téléversement/téléchargement de fichiers avec système de fichiers local ou S3
- **WebSocket** — Synchronisation des données en temps réel via PostgreSQL LISTEN/NOTIFY
- **Historique des entités** — Piste d'audit pour chaque modification de données
- **Branching de base de données** — Copies de base de données instantanées et isolées pour dev/staging/testing
- **Tâches Cron** — Tâches d'arrière-plan planifiées avec tableau de bord de surveillance

Tout est initialisé avec une seule fonction :

:::note[Emplacement]
L'appel ci-dessous correspond à ce que possède un backend **éjecté**, dans `backend/src/index.ts`. Sur le **runtime géré**, un tel fichier n'existe pas : le runtime effectue l'appel, et vous le configurez via des variables d'environnement, les tables exportées par `backend/schema/index.ts`, les ressources déclarées dans `backend/resources.ts` (`database()`, `bucket()`), et deux exports qu'il lit : `storageAuthorize` depuis `backend/storage.ts` et `hooks` depuis `backend/hooks.ts`. Chaque page de cette section indique lequel des deux s'applique à l'option documentée, et nomme celles qui n'ont pas de forme gérée. Exportez quoi que ce soit d'autre depuis ces deux modules et le runtime vous avertira au démarrage plutôt que de l'ignorer en silence ; exportez-en une qu'une déclaration de ressource a remplacée et le démarrage la refusera expressément, en indiquant la ligne à écrire dans `backend/resources.ts` à la place.
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

Cet appel unique est un raccourci par rapport à des étapes publiques : `installUnhandledRejectionHandler` empêche un rejet orphelin d'arrêter le processus, `createRebaseBackend` construit le backend, `setDefaultBackend` en fait celui auquel répond l'API au niveau du module, et `mount`, `attachRealtime` et `start` le servent. Pour ne monter que certains groupes de routes, les placer sur d'autres chemins, confier les minuteurs à un autre processus ou exécuter deux backends dans un même processus, appelez vous-même les étapes. Consultez [Intégration d'un serveur personnalisé](/docs/backend/custom-server/).

## Emplacement de chaque option

Cet appel correspond à la configuration **éjectée** — celle que vous écrivez vous-même après `rebase eject`, ou dans un serveur personnalisé. Un projet généré à partir d'un template ne l'a pas : le runtime publié démarre le projet, et chaque option arrive sous la forme d'une variable d'environnement dans `.env`, d'un export depuis `backend/storage.ts` ou `backend/hooks.ts`, ou d'un répertoire déclaré par le bundle dans `rebase.json`.

Les deux approches aboutissent à la même `RebaseBackendConfig`. Voici la cartographie complète.

| Option | Runtime géré |
|---|---|
| `basePath` | `REBASE_BASE_PATH` (par défaut `/api`) |
| `tables`, `schemaDir`, `defaultRls` | le répertoire `backend/schema/` (la clé `tables` de `rebase.json`) : les tables et le `defaultRls` exportés par son `index.ts` |
| `rpc` | <span class="since-badge" data-since="0.35">Depuis 0.35</span> les déclarations `defineRpc` exportées par `backend/schema/index.ts` — voir [Fonctions SQL en tant que RPC](/docs/backend/rpc/) |
| `functions`, `functionsDir` | `backend/functions/` |
| `functionsTimeoutMs` | `REBASE_FUNCTIONS_TIMEOUT_MS` |
| `crons`, `cronsDir` | `backend/crons/` |
| `bootstrappers`, `database` | `DATABASE_URL`, plus une déclaration `database("<key>")` dans `backend/resources.ts` pour chaque base de données au-delà de celle par défaut |
| `auth` | `JWT_SECRET`, les variables `OAUTH_*`, et la table déclarée par `backend/schema` avec `defineAuthTable` |
| `storage` | les variables `STORAGE_*`, plus une déclaration `bucket("<key>")` dans `backend/resources.ts` pour chaque bucket au-delà de celui par défaut |
| `storageAuthorize` | `export const storageAuthorize` depuis `backend/storage.ts` |
| `storagePolicies` | `STORAGE_POLICIES`, sous forme de règles JSON — voir [Autorisation de stockage](/docs/backend/storage-authorization/#as-data-storage_policies) |
| `storagePublicRead` | `STORAGE_PUBLIC_READ` |
| `storageRenditionCache` | `STORAGE_RENDITION_CACHE` |
| `storageInsecureAllowAnyAuthenticated` | `STORAGE_ALLOW_ANY_AUTHENTICATED` |
| `storageDownloadTokenTtl` | `STORAGE_DOWNLOAD_TOKEN_TTL` |
| `hooks` | `export const hooks` depuis `backend/hooks.ts` — hooks de table globaux |
| `history` | `REBASE_HISTORY` (activé par défaut) — la forme booléenne uniquement |
| `push` | `REBASE_PUSH`, avec `REBASE_VAPID_*` pour les clés — la forme booléenne uniquement |
| `enableSwagger` | `REBASE_ENABLE_SWAGGER` ; non défini sert `/api/docs` à l'audience du point de terminaison de schéma, `true` le publie avec l'interface Swagger UI, `false` le conserve derrière la protection d'administration |
| `compression` | `REBASE_COMPRESSION` |
| `maxBodySize` | `REBASE_MAX_BODY_SIZE` |
| `logging` | `LOG_LEVEL` |
| `liveSchema` | `REBASE_LIVE_SCHEMA_REPOSITORY` et ses identifiants `REBASE_LIVE_SCHEMA_*` — la forme avec dépôt uniquement |
| `rlsAudit` | `REBASE_RLS_AUDIT` |
| `provisionSchema`, `surfaces`, `ownership`, `functionsSelection`, `functionsUpstream` | `REBASE_ROLE` — voir [Processus séparés](/docs/deployment/split-processes/) |
| `corsHandled` | Le CORS est configuré par le runtime à partir de `CORS_ORIGINS` |
| `schemaVersion`, `runtimeVersion` | le build intègre les deux dans le bundle |
| `app`, `server`, `provisioningDriverResult` | le runtime les crée |

### Options sans équivalent géré

Ces options n'ont ni variable d'environnement ni export de module. Elles ne sont accessibles que depuis un appel manuel à `initializeRebaseBackend` — `rebase eject`, ou un [serveur personnalisé](/docs/backend/custom-server/) :

`rateLimit` · `jobs` · `csrf` · `cronPersistence` ·
`storagePolicies` · `storageTriggers` · `baas` · `schemaTables` ·
`history` sous sa forme d'objet (`{ retention }`) ·
`push` sous sa forme d'objet (`{ allowedHosts, sender, vapid }`)

`schemaEditor` est obligatoirement désactivé dans un bundle compilé : l'éditeur réécrit les fichiers *sources* de `backend/schema`, et un bundle ne contient que des sorties compilées.

## Ce qui est créé

Après l'initialisation, les routes suivantes sont montées :

| Chemin | Rôle |
|------|---------|
| `/api/auth/*` | Authentification (inscription, connexion, rafraîchissement, OAuth, liens magiques, codes à usage unique, MFA) |
| `/api/admin/*` | Utilisateurs, rôles, clés de service, cron, sauvegardes, journaux et schéma, chacun protégé par sa propre [portée](/docs/backend/roles-and-scopes/) |
| `/api/storage/*` | Téléversement, téléchargement et suppression de fichiers |
| `/api/data/:slug` | Opérations CRUD par table (GET, POST, PATCH, DELETE) |
| `/api/data/:slug/:id/history` | Historique des modifications d'entités (lorsqu'activé) |
| `/api/docs` | Spécification OpenAPI des tables visibles par l'appelant (publique avec `enableSwagger: true` ; réservée aux administrateurs avec `false`) |
| `/api/swagger` | Interface Swagger UI (avec `enableSwagger: true`, hors production uniquement) |
| `/api/schema/tables` | Les tables servies par ce backend, telles que l'appelant peut les voir — voir [Points de terminaison](/docs/backend/endpoints/#schema) |
| `/api/meta/contract` | La version du schéma, le runtime et chaque table telle qu'un administrateur les voit (requiert `schema:read`) |
| `/api/meta/schema-version` | Une chaîne de version pour ce schéma (non authentifiée) |
| `/api/rpc/:name` | <span class="since-badge" data-since="0.35">Depuis 0.35</span> Les fonctions SQL déclarées avec `defineRpc`, appelées avec l'identité de l'appelant — voir [Fonctions SQL en tant que RPC](/docs/backend/rpc/) |
| `/api/functions/*` | Routes de fonctions personnalisées (lorsque `functions` ou `functionsDir` est défini) |
| `/api/push/*` | Abonnements aux [notifications push](/docs/backend/push-notifications/) (lorsque `push` est activé) |
| `/api/admin/cron/*` | Gestion des tâches cron (`cron:read` / `cron:write`, lorsque `crons` ou `cronsDir` est défini) |
| WebSocket sur upgrade | Abonnements en temps réel, sur `/` pour une API à `/api` |

---

## Le cycle de vie de l'initialisation

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

**Le démarrage échoue bruyamment.** Si la base de données est inaccessible, que les identifiants sont incorrects ou que le schéma ne peut être compilé ou appliqué, `initializeRebaseBackend` lève une exception, rien n'est servi et le processus se termine avec le code `1`. Il n'y a aucun mode dégradé ni serveur partiel : un conteneur qui ne peut pas joindre sa base de données redémarre, et l'erreur qui l'a arrêté est la dernière ligne de ses journaux.

Ce comportement est délibéré. Un serveur qui démarre en répondant aux connexions alors que chaque route `/api/data/*` échoue est bien plus difficile à diagnostiquer qu'un serveur qui ne démarre jamais — et un orchestrateur peut réagir à une boucle de plantage (crash loop).

Avant la première requête, le démarrage teste la connexion et affiche le diagnostic : l'hôte et le port qu'il n'a pas pu joindre, la raison fournie par le pilote (`ECONNREFUSED`, `password authentication failed for user "app"`), et la solution. Consultez [Dépannage](/docs/troubleshooting/) pour la liste exhaustive des pannes.

### Une fois en service : `/livez` et `/health`

Deux sondes, répondant à deux questions différentes.

| Chemin | Touche à la base de données | Répond |
| --- | --- | --- |
| `/livez` | Non | `200 {"status":"ok"}` tant que le processus est en cours d'exécution. À utiliser comme sonde de vivacité (liveness probe). |
| `/health` | Oui, chaque source de données | `200 {"status":"ok"}` lorsque chaque source de données configurée répond ; `503 {"status":"degraded"}` lorsque l'une d'elles ne répond pas. À utiliser comme sonde d'état de préparation (readiness probe). |

Définir une sonde de vivacité sur `/health` est une erreur à éviter : une brève instabilité de la base de données pousserait l'orchestrateur à tuer un processus par ailleurs sain, transformant une courte panne en une boucle de redémarrages.

`/health` n'est pas authentifié, il publie donc le verdict et non la cause — en dehors du développement, il indique quelle source de données est dégradée et rien d'autre. Le message d'erreur du pilote mentionne l'hôte, le port, le nom de la base de données et le rôle, et cela apparaît dans les journaux. `/health` est également servi sous `basePath` (`/api/health`) ; `/livez` ne l'est pas.

Ces deux sondes appartiennent au runtime géré. Un `backend/src/index.ts` éjecté sert lui-même `/health` et `/api/health`, en sondant uniquement la base de données par défaut, et ne dispose pas de `/livez` tant que vous n'en ajoutez pas un.

---

## Référence de configuration

<span class="since-badge" data-since="0.35">Depuis 0.35</span> L'option `rpc` ci-dessous.

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

    // SQL functions served at /api/rpc/<name> (defineRpc). Read from the
    // schemaDir index when the tables are; pass them as values otherwise.
    rpc?: AnyRpcDef[];

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

Cinq d'entre elles passent facilement inaperçues et modifient des comportements qui ne sont autrement qu'observables :

| Clé | Valeur par défaut | Ce qu'elle fait |
|---|---|---|
| `compression` | `true` | gzip/deflate sur les réponses de l'API, négocié à partir de `Accept-Encoding`. Les corps déjà compressés, diffusés en continu (streamed) et avec `no-transform` ne sont pas modifiés, tout comme les corps inférieurs à 1 Ko (le coût de gzip y dépasse le gain réalisé), il est donc sûr de la laisser activée — un grand volume JSON diminue généralement d'environ 20 fois. Définissez à `false` lorsqu'un proxy en amont tel que nginx ou Cloudflare compresse déjà, pour éviter de payer le coût deux fois. Environnement : `REBASE_COMPRESSION`. |
| `maxBodySize` | `10485760` (10 Mo) | Plafond pour le corps des requêtes sur les routes d'API ; `0` le désactive. Les téléversements vers le stockage utilisent le `maxFileSize` propre à la configuration du stockage (50 Mo), qui prévaut pour ces routes. Environnement : `REBASE_MAX_BODY_SIZE`. |
| `csrf` | désactivé | **Activation explicite (opt-in).** Une API de BaaS est appelée par des applications mobiles, des SPA sur d'autres domaines et des outils CLI, dont aucun n'envoie un en-tête `Origin` qu'une liste fixe accepterait — cette option n'est donc pas activée par défaut. Activez-la avec les origines utilisées par vos clients navigateurs. Aucune forme sous variable d'environnement : éjectez pour la définir. |
| `cronPersistence` | `true` | Détermine si les journaux d'exécution sont écrits dans `rebase.cron_logs`. `false` maintient les tâches actives et l'historique en mémoire uniquement, que le panneau Studio perd alors au redémarrage. |
| `schemaEditor` | activé hors production, quand `schemaDir` est défini | Force l'activation ou la désactivation des routes de l'éditeur de schéma. L'éditeur réécrit les *fichiers sources* de `backend/schema`, il a donc besoin d'un répertoire dans lequel écrire — et un bundle compilé n'en a pas, c'est pourquoi un déploiement ne l'a jamais. |

Le reste de `RebaseBackendConfig` est soit documenté sur sa propre page (`auth`, `storage`, `jobs`, `hooks`, `liveSchema`, `rlsAudit`, `schemaTables`), soit marqué `@internal` : `bootstrappers`, `provisioningDriverResult`, `provisionSchema`, `corsHandled`, `functionsSelection`, `functionsUpstream` et `runtimeVersion` sont renseignés par `bootFromBundle` à partir de l'environnement, et les transmettre manuellement revient à entrer en conflit avec le runtime sur la nature de ce processus.

## L'instance du backend

`initializeRebaseBackend` retourne le backend qu'il a construit, déjà monté et démarré. Son type est `RebaseBackendInstance`, qui correspond à `RebaseBackend`, le type renvoyé par `createRebaseBackend` :

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

Elle intègre également `rebase`, le client intra-processus, `fetch(request)`, `routes`, les groupes de routes sous forme de sous-applications Hono, `services`, ses propres clés JWT, le modèle d'accès, le magasin de clés d'API et les limiteurs de débit, ainsi que `verifyCredential(token)` ; voir [Intégration d'un serveur personnalisé](/docs/backend/custom-server/).

> **Note :** Bien que l'`instance` expose ces services internes, le code applicatif (comme les fonctions personnalisées et les tâches cron) doit utiliser le singleton `rebase` d'`@rebasepro/server` pour interagir avec l'API du backend. À l'intérieur d'une requête, d'une exécution de cron ou d'un job, `rebase` correspond au backend qui le sert ; ailleurs, il s'agit de la valeur par défaut du processus, qu'`initializeRebaseBackend` associe à son backend.

## API REST

L'API REST est générée à partir de vos tables. Chaque table dispose de ces points de terminaison :

| Méthode | Chemin | Description |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | Lister les entités — le filtrage, le tri, la pagination et la recherche sont des paramètres de requête |
| `GET` | `/api/data/:slug/count` | Nombre de lignes correspondant à la même requête |
| `GET` | `/api/data/:slug/aggregate` | `count`/`sum`/`avg`/`min`/`max`, éventuellement groupés |
| `GET` | `/api/data/:slug/:id` | Obtenir une entité unique |
| `POST` | `/api/data/:slug` | Créer une nouvelle entité |
| `PATCH` | `/api/data/:slug/:id` | Mettre à jour les champs transmis |
| `DELETE` | `/api/data/:slug/:id` | Supprimer un enregistrement |
| `POST` | `/api/data/:slug/bulk` | Créer plusieurs lignes dans une seule transaction |
| `PATCH` | `/api/data/:slug/bulk` | Mettre à jour plusieurs lignes dans une seule transaction |
| `POST` | `/api/data/:slug/bulk/delete` | Supprimer plusieurs lignes dans une seule transaction |

### Paramètres de requête

Il existe une référence unique pour ceux-ci et ce n'est pas cette page. [API REST](/docs/backend/api/) documente les deux dialectes de requête acceptés par le serveur — la syntaxe façon PostgREST `?column=op.value` et la syntaxe JSON `?where=` — ainsi que `orderBy`, `limit`/`offset`, `include`, `fields`, `searchString` et la recherche vectorielle. [Points de terminaison](/docs/backend/endpoints/) est l'index de chaque route montée par le serveur, y compris celles générées.

Un paramètre qui n'est pas réservé par le serveur est interprété comme un filtre sur la colonne portant ce nom, de sorte qu'un nom inexistant n'échoue pas : il ne correspond silencieusement à rien.

## WebSocket

Le serveur WebSocket se rattache au même serveur HTTP et fournit des abonnements en temps réel. Il répond aux requêtes de mise à niveau (upgrade) sur un chemin unique, `/` pour une API à `/api`, où le SDK se connecte, et laisse tous les autres chemins à vos propres écouteurs `upgrade` :

- S'abonner aux **modifications de tables** — être notifié lorsqu'une ligne d'une table est créée, mise à jour ou supprimée
- S'abonner aux **modifications de lignes** — être notifié lorsqu'une ligne spécifique change
- Gestion automatique de la **reconnexion** dans le SDK typé

Le backend utilise en interne PostgreSQL `LISTEN/NOTIFY`. Pour les déploiements multi-instances, fournissez une `connectionString` dans votre `PostgresBootstrapper` pour activer la diffusion entre instances.

## Gestion des erreurs

Chaque échec — quelle que soit la route, dans n'importe quel sous-système — est renvoyé dans une même enveloppe :

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
| `message` | oui | Rédigé pour une personne lisant une console. Désigne l'obstacle rencontré, pas la règle. |
| `code` | oui | En `SCREAMING_SNAKE_CASE` et stable. C'est le champ sur lequel baser vos branchements conditionnels. |
| `details` | non | Données structurées lorsque le refus *porte sur* quelque chose — une liste de chemins en échec, un ensemble de champs inconnus. |
| `requestId` | non | Présent lorsque la requête en contenait un ou s'en est vu attribuer un ; fait écho à `X-Request-ID`. Mentionnez-le dans un rapport de bogue. |

Le statut HTTP se trouve sur la réponse, pas dans le corps. Effectuez vos branchements sur `code`, et non sur `message` — les messages sont écrits pour des humains et sont susceptibles de changer.

Le SDK typé convertit chacune de ces erreurs en une `RebaseApiError` contenant `status`, `code` et `details` — y compris les échecs qui n'ont jamais atteint de serveur. Une connexion refusée, un échec DNS, un problème de CORS ou une annulation arrive sous forme de `status: 0`, `code: "NETWORK_ERROR"`, avec l'erreur propre au runtime dans `cause`, plutôt que ce avec quoi `fetch` a choisi de rejeter la promesse. Une réponse sans enveloppe — un 413 d'un proxy, un 502 d'un équilibreur de charge — reçoit tout de même un `code` dérivé de son statut (`PAYLOAD_TOO_LARGE`, `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR`, …), et un client initialisé hors navigateur sans `baseUrl` échoue avec `BASE_URL_REQUIRED` plutôt qu'avec une erreur réseau.
Une lecture recevant un succès sans la forme attendue — un `204`, un corps vide, une page sans liste `data` — échoue avec `UNEXPECTED_RESPONSE` au lieu de se résoudre par "aucune ligne", et `createMany`, `updateMany`, `deleteMany` ou `batch` recevant autre chose qu'un tableau échoue avec `INVALID_BULK_BODY`, le code qu'utilise le serveur pour la même erreur. Le code de l'application intercepte ainsi une seule classe :

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

- **[Authentification](/docs/backend/authentication)** — JWT, fournisseurs OAuth et OIDC, MFA, clés d'API, gestion des utilisateurs
- **[Stockage](/docs/backend/storage)** — Stockage de fichiers local et S3
- **[Hooks de table](/docs/collections/callbacks)** — Hooks de cycle de vie et API `context.data`
- **[Historique des entités](/docs/backend/history)** — Piste d'audit
- **[Fonctions personnalisées](/docs/backend/custom-functions)** — Ajouter des points de terminaison d'API personnalisés
- **[Fonctions SQL en tant que RPC](/docs/backend/rpc)** — Appeler une fonction Postgres sur `/api/rpc/<name>`, avec l'identité de l'appelant
- **[Tâches Cron](/docs/backend/cron-jobs)** — Tâches d'arrière-plan planifiées
- **[Branching de base de données](/docs/backend/branching)** — Copies instantanées de bases de données pour dev/staging
- **[Déploiement](/docs/getting-started/deployment)** — Mettre le backend en production
