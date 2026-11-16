---
sourceHash: e399d82e853d3169
title: Vue d'ensemble du backend
sidebar_label: Backend
description: Le backend Rebase fournit un serveur complet avec API REST, authentification, stockage, temps réel WebSocket et historique des entités — le tout initialisé avec un simple appel de fonction.
---

## Vue d'ensemble

Le backend Rebase est un **serveur Node.js** basé sur [Hono](https://hono.dev/) qui fournit :

- **API REST** — Points de terminaison CRUD générés automatiquement pour chaque table
- **Authentification** — Jetons JWT, connexion OAuth et OIDC, liens magiques, codes à usage unique, MFA, clés d'API, gestion des utilisateurs et des rôles
- **Stockage** — Téléversement/téléchargement de fichiers avec le système de fichiers local ou S3
- **WebSocket** — Synchronisation des données en temps réel via PostgreSQL LISTEN/NOTIFY
- **Historique des entités** — Piste d'audit pour chaque modification de données
- **Branching de base de données** — Copies de base de données instantanées et isolées pour le dev/staging/test
- **Tâches Cron** — Tâches d'arrière-plan planifiées avec tableau de bord de surveillance

Tout est initialisé à l'aide d'une seule fonction :

:::note[Où cela se place]
L'appel ci-dessous correspond à ce que contient un backend **éjecté**, dans `backend/src/index.ts`. Sur
le **runtime managé**, un tel fichier n'existe pas : le runtime effectue l'appel, et
vous le configurez via des variables d'environnement, les tables que `backend/schema/index.ts`
exporte, les ressources que vous déclarez dans `backend/resources.ts` (`database()`,
`bucket()`), et deux exports qu'il lit : `storageAuthorize` depuis
`backend/storage.ts` et `hooks` depuis `backend/hooks.ts`. Chaque page de cette
section précise lequel des deux s'applique à l'option qu'elle documente, et indique
celles qui n'ont pas de forme managée. Exportez quoi que ce soit d'autre depuis ces deux modules et
le runtime vous avertira au démarrage plutôt que de l'ignorer silencieusement ; exportez-en un
qu'une déclaration de ressource a remplacé et le démarrage le refusera nommément, en indiquant la
ligne `backend/resources.ts` à écrire à la place.
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

Cet appel unique est un raccourci regroupant des étapes publiques : `installUnhandledRejectionHandler` empêche un rejet non géré d'interrompre le processus, `createRebaseBackend` construit le backend, `setDefaultBackend` en fait celui auquel répond l'API au niveau du module, et `mount`, `attachRealtime` et `start` le servent. Pour ne monter que certains groupes de routes, les placer sur d'autres chemins, déléguer les minuteurs à un autre processus, ou exécuter deux backends dans un seul processus, appelez vous-même ces étapes. Consultez [Custom Server Integration](/docs/backend/custom-server/).

## Où se trouve chaque option

Cet appel correspond à la forme **éjectée** — celle que vous écrivez vous-même après `rebase eject`, ou dans un serveur personnalisé. Un projet généré par scaffold ne la possède pas : le runtime publié démarre le projet, et chaque option arrive sous la forme d'une variable d'environnement dans `.env`, d'un export depuis `backend/storage.ts` ou `backend/hooks.ts`, ou d'un répertoire déclaré par le bundle dans `rebase.json`.

Les deux approches aboutissent à la même configuration `RebaseBackendConfig`. En voici la vue d'ensemble complète.

| Option | Runtime managé |
|---|---|
| `basePath` | `REBASE_BASE_PATH` (par défaut `/api`) |
| `tables`, `schemaDir`, `defaultRls` | le répertoire `backend/schema/` (la clé `tables` de `rebase.json`) : les tables et le `defaultRls` exportés par son `index.ts` |
| `functions`, `functionsDir` | `backend/functions/` |
| `functionsTimeoutMs` | `REBASE_FUNCTIONS_TIMEOUT_MS` |
| `crons`, `cronsDir` | `backend/crons/` |
| `bootstrappers`, `database` | `DATABASE_URL`, plus une déclaration `database("<key>")` dans `backend/resources.ts` pour chaque base de données au-delà de celle par défaut |
| `auth` | `JWT_SECRET`, les variables `OAUTH_*`, et la table que `backend/schema` déclare avec `defineAuthTable` |
| `storage` | les variables `STORAGE_*`, plus une déclaration `bucket("<key>")` dans `backend/resources.ts` pour chaque bucket au-delà de celui par défaut |
| `storageAuthorize` | `export const storageAuthorize` depuis `backend/storage.ts` |
| `storagePublicRead` | `STORAGE_PUBLIC_READ` |
| `storageRenditionCache` | `STORAGE_RENDITION_CACHE` |
| `storageInsecureAllowAnyAuthenticated` | `STORAGE_ALLOW_ANY_AUTHENTICATED` |
| `storageDownloadTokenTtl` | `STORAGE_DOWNLOAD_TOKEN_TTL` |
| `hooks` | `export const hooks` depuis `backend/hooks.ts` — hooks de tables globaux |
| `history` | `REBASE_HISTORY` (activé par défaut) — la forme booléenne uniquement |
| `push` | `REBASE_PUSH`, avec `REBASE_VAPID_*` pour les clés — la forme booléenne uniquement |
| `enableSwagger` | `REBASE_ENABLE_SWAGGER` ; non défini sert `/api/docs` à l'audience du point de terminaison de schéma, `true` le publie avec l'interface Swagger UI, `false` le conserve derrière le contrôle d'accès administrateur |
| `compression` | `REBASE_COMPRESSION` |
| `maxBodySize` | `REBASE_MAX_BODY_SIZE` |
| `logging` | `LOG_LEVEL` |
| `liveSchema` | `REBASE_LIVE_SCHEMA_REPOSITORY` et ses identifiants `REBASE_LIVE_SCHEMA_*` — la forme avec dépôt uniquement |
| `rlsAudit` | `REBASE_RLS_AUDIT` |
| `provisionSchema`, `surfaces`, `ownership`, `functionsSelection`, `functionsUpstream` | `REBASE_ROLE` — voir [Split Processes](/docs/deployment/split-processes/) |
| `corsHandled` | CORS est configuré par le runtime à partir de `CORS_ORIGINS` |
| `schemaVersion`, `runtimeVersion` | le build inscrit les deux dans le bundle |
| `app`, `server`, `provisioningDriverResult` | le runtime les crée |

### Options sans équivalent managé

Celles-ci ne possèdent ni variable d'environnement ni export de module. Elles ne sont accessibles que depuis un appel manuel à `initializeRebaseBackend` — `rebase eject`, ou un [serveur personnalisé](/docs/backend/custom-server/) :

`rateLimit` · `jobs` · `csrf` · `cronPersistence` ·
`storagePolicies` · `storageTriggers` · `baas` · `schemaTables` ·
`history` sous sa forme d'objet (`{ retention }`) ·
`push` sous sa forme d'objet (`{ allowedHosts, sender, vapid }`)

`schemaEditor` est désactivé d'office dans un bundle compilé : l'éditeur réécrit les fichiers *sources* de `backend/schema`, et un bundle ne contient que la sortie compilée.

## Ce qui est créé

Après l'initialisation, ces routes sont montées :

| Chemin | Rôle |
|------|---------|
| `/api/auth/*` | Authentification (inscription, connexion, rafraîchissement, OAuth, liens magiques, codes à usage unique, MFA) |
| `/api/admin/*` | Utilisateurs, rôles, clés de service, cron, sauvegardes, logs et schéma, chacun derrière son propre [scope](/docs/backend/roles-and-scopes/) |
| `/api/storage/*` | Téléversement, téléchargement et suppression de fichiers |
| `/api/data/:slug` | Opérations CRUD par table (GET, POST, PATCH, DELETE) |
| `/api/data/:slug/:id/history` | Historique des modifications d'entités (lorsqu'il est activé) |
| `/api/docs` | Spécification OpenAPI des tables que l'appelant est autorisé à voir (publique avec `enableSwagger: true` ; réservée aux administrateurs avec `false`) |
| `/api/swagger` | Interface Swagger UI (avec `enableSwagger: true`, hors production uniquement) |
| `/api/schema/tables` | Les tables que ce backend dessert, telles que l'appelant est autorisé à les voir — voir [Endpoints](/docs/backend/endpoints/#schema) |
| `/api/meta/contract` | La version du schéma, le runtime et chaque table telle qu'un administrateur les voit (nécessite `schema:read`) |
| `/api/meta/schema-version` | Une chaîne de version pour ce schéma (non authentifiée) |
| `/api/functions/*` | Routes de fonctions personnalisées (lorsque `functions` ou `functionsDir` est défini) |
| `/api/push/*` | Abonnements aux [notifications push](/docs/backend/push-notifications/) (lorsque `push` est activé) |
| `/api/admin/cron/*` | Gestion des tâches cron (`cron:read` / `cron:write`, lorsque `crons` ou `cronsDir` est défini) |
| WebSocket sur upgrade | Abonnements en temps réel, sur `/` pour une API située à `/api` |

---

## Le cycle de vie de l'initialisation

Lorsque vous appelez `initializeRebaseBackend()`, le framework déclenche une séquence de démarrage en 5 étapes séquentielles :

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

## Que se passe-t-il lorsque le démarrage échoue

**Le démarrage échoue bruyamment.** Si la base de données est inaccessible, que les identifiants sont incorrects, ou que le schéma ne peut être compilé ou appliqué, `initializeRebaseBackend` lève une exception, rien n'est servi, et le processus se termine avec le code `1`. Il n'y a pas de mode dégradé ni de serveur partiel : un conteneur qui ne peut pas joindre sa base de données redémarre, et l'erreur qui l'a arrêté est la dernière ligne de ses logs.

C'est délibéré. Un serveur qui démarre en répondant aux connexions alors que toutes les routes `/api/data/*` échouent est bien plus difficile à diagnostiquer qu'un serveur qui ne démarre jamais — et un orchestrateur peut réagir à une boucle de plantages (crash loop).

Avant la première requête, le démarrage teste la connexion et affiche le diagnostic : l'hôte et le port qu'il n'a pas pu atteindre, la raison fournie par le pilote (`ECONNREFUSED`, `password authentication failed for user "app"`), et la solution. Consultez [Troubleshooting](/docs/troubleshooting/) pour la liste détaillée des pannes.

### Une fois en service : `/livez` et `/health`

Deux sondes, répondant à deux questions différentes.

| Chemin | Touche à la base de données | Répond |
| --- | --- | --- |
| `/livez` | Non | `200 {"status":"ok"}` tant que le processus fonctionne. À utiliser comme sonde de vivacité (liveness probe). |
| `/health` | Oui, chaque source de données | `200 {"status":"ok"}` lorsque chaque source de données configurée répond ; `503 {"status":"degraded"}` si l'une d'elles ne répond pas. À utiliser comme sonde d'état de préparation (readiness probe). |

Placer une sonde de vivacité sur `/health` est une erreur à souligner : une brève instabilité de la base de données amènerait l'orchestrateur à tuer un processus par ailleurs sain, transformant une courte panne en une boucle de redémarrage.

`/health` n'est pas authentifié, il publie donc le verdict et non la raison — hors développement, il indique quelle source de données est dégradée et rien d'autre. Le message d'erreur du pilote mentionne l'hôte, le port, le nom de la base de données et le rôle, et ces informations sont envoyées dans les logs. `/health` est également servi sous `basePath` (`/api/health`) ; ce qui n'est pas le cas de `/livez`.

Ces deux sondes proviennent du runtime managé. Un fichier `backend/src/index.ts` éjecté sert lui-même `/health` et `/api/health`, en sondant uniquement la base de données par défaut, et ne possède pas de `/livez` tant que vous n'en ajoutez pas un.

---

## Référence de configuration

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

Cinq d'entre elles passent facilement inaperçues et modifient des comportements que vous ne pourriez observer autrement :

| Clé | Valeur par défaut | Ce qu'elle fait |
|---|---|---|
| `compression` | `true` | gzip/deflate sur les réponses de l'API, négocié à partir de `Accept-Encoding`. Les corps déjà compressés, diffusés en continu (streamed) et `no-transform` sont laissés intacts, de même que les corps de moins de 1 Ko (le coût de gzip y est supérieur au gain obtenu) ; il est donc sûr de la laisser activée — une grande liste JSON diminue généralement d'environ ~20x. Définissez sur `false` lorsque nginx, Cloudflare ou un autre proxy en amont compresse déjà, afin d'éviter un double traitement. Environnement : `REBASE_COMPRESSION`. |
| `maxBodySize` | `10485760` (10 Mo) | Plafond pour le corps des requêtes sur les routes de l'API ; `0` le désactive. Les téléversements de fichiers utilisent le `maxFileSize` propre à la configuration du stockage (50 Mo), qui prévaut pour ces routes. Environnement : `REBASE_MAX_BODY_SIZE`. |
| `csrf` | désactivé | **Sur adhésion volontaire (opt-in).** Une API BaaS est appelée par des applications mobiles, des SPA situées sur d'autres domaines et des outils CLI, dont aucun n'envoie d'`Origin` qu'une liste fixe accepterait — ce paramètre n'est donc pas activé par défaut. Activez-le en spécifiant les origines utilisées par vos clients navigateurs. Pas de variable d'environnement disponible : éjectez pour le configurer. |
| `cronPersistence` | `true` | Détermine si les logs d'exécution sont écrits dans `rebase.cron_logs`. `false` maintient l'exécution des tâches mais conserve l'historique uniquement en mémoire, ce que le panneau Studio perd alors au redémarrage. |
| `schemaEditor` | activé hors production, lorsque `schemaDir` est défini | Force l'activation ou la désactivation des routes de l'éditeur de schéma. L'éditeur réécrit les *fichiers sources* de `backend/schema`, il a donc besoin d'un répertoire dans lequel écrire — or un bundle compilé n'en possède aucun, c'est pourquoi un déploiement ne l'a jamais. |

Le reste de `RebaseBackendConfig` est soit documenté sur sa propre page (`auth`,
`storage`, `jobs`, `hooks`, `liveSchema`, `rlsAudit`, `schemaTables`), soit marqué `@internal` :
`bootstrappers`, `provisioningDriverResult`, `provisionSchema`, `corsHandled`,
`functionsSelection`, `functionsUpstream` et `runtimeVersion` sont renseignés par
`bootFromBundle` à partir de l'environnement, et les transmettre manuellement revient à
entrer en désaccord avec le runtime sur ce qu'est ce processus.

## L'instance du backend

`initializeRebaseBackend` renvoie le backend qu'il a construit, déjà monté et
démarré. Son type est `RebaseBackendInstance`, c'est-à-dire `RebaseBackend`, le
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

Elle contient également
`rebase`, le client intra-processus, `fetch(request)`, `routes`, les groupes de routes
en tant que sous-applications Hono, `services`, ses propres clés JWT, le modèle d'accès, le magasin de clés d'API et
les limiteurs de débit, ainsi que `verifyCredential(token)` ; voir
[Custom Server Integration](/docs/backend/custom-server/).

> **Remarque :** Bien que l'`instance` expose ces services internes, le code applicatif (comme les fonctions personnalisées et les tâches cron) doit utiliser le singleton `rebase` de `@rebasepro/server` pour interagir avec l'API du backend. À l'intérieur d'une requête, d'une exécution cron ou d'un job, `rebase` correspond au backend qui la dessert ; ailleurs, il s'agit de la valeur par défaut du processus, qu'`initializeRebaseBackend` initialise avec son propre backend.

## API REST

L'API REST est générée à partir de vos tables. Chaque table bénéficie de ces points de terminaison :

| Méthode | Chemin | Description |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | Lister les entités — le filtrage, le tri, la pagination et la recherche sont des paramètres de requête |
| `GET` | `/api/data/:slug/count` | Nombre de lignes correspondant à la même requête |
| `GET` | `/api/data/:slug/aggregate` | `count`/`sum`/`avg`/`min`/`max`, avec regroupement optionnel |
| `GET` | `/api/data/:slug/:id` | Obtenir une entité unique |
| `POST` | `/api/data/:slug` | Créer une nouvelle entité |
| `PATCH` | `/api/data/:slug/:id` | Mettre à jour les champs envoyés |
| `DELETE` | `/api/data/:slug/:id` | Supprimer un enregistrement |
| `POST` | `/api/data/:slug/bulk` | Créer plusieurs lignes en une seule transaction |
| `PATCH` | `/api/data/:slug/bulk` | Mettre à jour plusieurs lignes en une seule transaction |
| `POST` | `/api/data/:slug/bulk/delete` | Supprimer plusieurs lignes en une seule transaction |

### Paramètres de requête

Il existe une référence dédiée pour ceux-ci et ce n'est pas cette page. [REST
API](/docs/backend/api/) documente les deux dialectes de requête acceptés par le serveur —
la forme de style PostgREST `?column=op.value` et la forme JSON `?where=` — ainsi que
`orderBy`, `limit`/`offset`, `include`, `fields`, `searchString` et la recherche vectorielle.
[Endpoints](/docs/backend/endpoints/) est l'index de chaque route montée par le serveur,
y compris celles générées automatiquement.

Un paramètre que le serveur ne réserve pas est interprété comme un filtre sur la colonne
portant ce nom, de sorte qu'un paramètre inexistant n'échoue pas : il ne correspond silencieusement à rien.

## WebSocket

Le serveur WebSocket s'attache au même serveur HTTP et fournit des abonnements en temps réel. Il répond aux demandes de mise à niveau (upgrade) sur un seul chemin, `/` pour une API située à `/api`, là où le SDK se connecte, et laisse tous les autres chemins à vos propres écouteurs `upgrade` :

- S'abonner aux **modifications de tables** — être notifié lorsqu'une ligne d'une table est créée, mise à jour ou supprimée
- S'abonner aux **modifications de lignes** — être notifié lorsqu'une ligne spécifique change
- Gestion automatique de la **reconnexion** dans le SDK typé

Le backend utilise PostgreSQL `LISTEN/NOTIFY` en interne. Pour les déploiements multi-instances, fournissez une `connectionString` dans votre `PostgresBootstrapper` pour activer la diffusion entre instances.

## Gestion des erreurs

Chaque échec — provenant de n'importe quelle route, dans n'importe quel sous-système — est renvoyé dans une enveloppe unique :

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
| `message` | oui | Rédigé pour une personne lisant une console. Nomme l'obstacle, pas la règle. |
| `code` | oui | En `SCREAMING_SNAKE_CASE` et stable. C'est le champ sur lequel baser vos branchements conditionnels. |
| `details` | non | Données structurées lorsque le refus *porte sur* quelque chose — une liste de chemins en échec, un ensemble de champs inconnus. |
| `requestId` | non | Présent lorsque la requête en portait un ou s'en est vu attribuer un ; fait écho à `X-Request-ID`. Mentionnez-le dans un rapport de bogue. |

Le statut HTTP se trouve sur la réponse, pas dans le corps. Effectuez vos branchements sur `code`, et non sur
`message` — les messages sont écrits pour des humains et sont susceptibles de changer.

Le SDK typé transforme chacune de ces erreurs en une `RebaseApiError` contenant
`status`, `code` et `details` — y compris les échecs qui n'ont jamais atteint un
serveur. Une connexion refusée, une erreur DNS, CORS ou une annulation arrive sous la forme
`status: 0`, `code: "NETWORK_ERROR"`, avec l'erreur propre au runtime dans `cause`,
plutôt que ce que `fetch` aurait décidé de renvoyer comme rejet. Une réponse sans
enveloppe — un code 413 d'un proxy, un 502 d'un équilibreur de charge — reçoit tout de même un `code` dérivé de son
statut (`PAYLOAD_TOO_LARGE`, `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR`, …), et un
client instancié hors d'un navigateur sans `baseUrl` échoue avec
`BASE_URL_REQUIRED` plutôt qu'avec une erreur réseau.
Une lecture qui réussit
sans avoir la forme attendue — un code `204`, un corps vide, une page sans liste
`data` — échoue avec `UNEXPECTED_RESPONSE` au lieu de se résoudre par "aucune ligne", et
`createMany`, `updateMany`, `deleteMany` ou `batch` recevant autre chose
qu'un tableau échoue avec `INVALID_BULK_BODY`, le code que le serveur utilise pour la même
erreur. Le code applicatif n'a donc qu'une seule classe à intercepter :

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
- **[Stockage](/docs/backend/storage)** — Stockage de fichiers local et S3
- **[Hooks de table](/docs/collections/callbacks)** — Hooks de cycle de vie et API `context.data`
- **[Historique des entités](/docs/backend/history)** — Piste d'audit
- **[Fonctions personnalisées](/docs/backend/custom-functions)** — Ajouter des points de terminaison d'API personnalisés
- **[Tâches Cron](/docs/backend/cron-jobs)** — Tâches d'arrière-plan planifiées
- **[Branching de base de données](/docs/backend/branching)** — Copies instantanées de base de données pour le dev/staging
- **[Déploiement](/docs/getting-started/deployment)** — Passer le backend en production
