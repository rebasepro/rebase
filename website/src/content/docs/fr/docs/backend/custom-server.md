---
sourceHash: 93c74d4bdc0c12ea
title: Intégration d'un serveur personnalisé
sidebar_label: Serveur personnalisé
description: Construisez le backend Rebase à partir de composants publics dans votre propre serveur — createRebaseBackend, ses groupes de routes, mount, attachRealtime et start — ou intégrez le pilote Postgres dans Express.
---

# Intégration d'un serveur personnalisé

`initializeRebaseBackend` est un raccourci. Il construit l'ensemble du backend, le
monte sur votre application Hono sous `/api`, attache le socket temps réel à votre
serveur HTTP et démarre les tâches d'arrière-plan, le tout en un seul appel. Lorsque
c'est ce dont vous avez besoin, utilisez-le.

Lorsque ce n'est pas le cas, descendez d'un niveau. Chaque partie de cet appel est
un élément public que vous pouvez appeler vous-même : construisez le backend, puis
montez-le en totalité ou seulement les groupes de routes souhaités, aux chemins de
votre choix, et décidez quel processus démarre les timers. [Intégrer le pilote Postgres](/docs/backend/embedding-postgres-driver/)
va encore plus loin et initialise le pilote Postgres seul dans une application Express.

## Configuration de l'environnement

Rebase fournit un utilitaire centralisé `loadEnv()` dans `@rebasepro/server` qui valide vos variables d'environnement par rapport à un schéma Zod strict. Appelez-le **après** avoir chargé votre fichier `.env` :

```typescript
import dotenv from "dotenv";
import { loadEnv } from "@rebasepro/server";

// `rebase dev` and `rebase start` name the project's .env in DOTENV_CONFIG_PATH.
// Unset, dotenv reads `.env` in the working directory.
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH, quiet: true });

export const env = loadEnv();
```

Pour ajouter vos propres variables typées, étendez le schéma :

```typescript
import { loadEnv, z } from "@rebasepro/server";

export const env = loadEnv({
    extend: z.object({
        SMTP_HOST: z.string().optional(),
        SMTP_PORT: z.string().default("587").transform(Number),
        STRIPE_SECRET_KEY: z.string(),
    })
});
// env.SMTP_HOST  → string | undefined  (fully typed)
// env.STRIPE_SECRET_KEY → string        (validated, required)
```

:::caution[Deux copies de zod]
Deux copies de zod chargées en même temps cassaient auparavant cet appel de manière silencieuse. `loadEnv`
combinait les schémas avec `.merge()`, qui accepte un schéma provenant de l'autre copie
puis rejette chaque champ portant un `.default()`. Le serveur démarrait,
signalait le succès et n'exécutait aucun de ses crons ; rien dans l'échec ne mentionnait
zod.

`loadEnv` valide désormais le schéma de base et votre schéma `extend` chacun avec son
propre `.parse()`, de sorte qu'un schéma construit par une autre copie de zod fonctionne. Le runtime
fournit `zod`, et le `backend/package.json` généré le liste dans la plage
utilisée par `@rebasepro/server`, garantissant qu'une seule copie est installée : maintenez les deux identiques.
:::

**Comportements clés :**
- Génère `JWT_SECRET` et `REBASE_SERVICE_KEY` en développement lorsqu'ils ne sont pas définis, afin que vous puissiez démarrer sans configuration manuelle, et les met en cache dans `.rebase-dev-secrets.json` pour qu'un redémarrage ne déconnecte personne.
- Bloque les secrets générés automatiquement en production — vous devez les définir explicitement.
- Valide que `CORS_ORIGINS` ou `FRONTEND_URL` est défini en production.
- Refuse toute valeur pour `extend` qui n'est pas un schéma zod.
- Lève une `Error` nommant chaque variable manquante ou incorrecte, telle que `DATABASE_URL: is required`, avec les problèmes zod dans sa propriété `issues`.

Consultez le fichier `.env.example` dans l'application générée pour obtenir la liste complète des variables prises en charge.

## Un cran sous `initializeRebaseBackend`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`initializeRebaseBackend` se résume à ces appels, et rien d'autre :

```typescript
import { createRebaseBackend, installUnhandledRejectionHandler, setDefaultBackend } from "@rebasepro/server";

installUnhandledRejectionHandler();
const backend = await createRebaseBackend({
    ...options,
    // `false` or `{ tables: false, realtime: false }` in the cases
    // the `provision` section below lists.
    provision: true
});
setDefaultBackend(backend);
backend.mount(app, { basePath: "/api" });
await backend.attachRealtime(server);
backend.start();
```

Le `shutdown()` qu'il renvoie ferme également le serveur qui lui a été fourni. Voici
la même chose écrite sous la forme du fichier `backend/src/index.ts` d'un projet, prêt
à être modifié. `rebase dev` exécute ce fichier lorsqu'un projet en possède un, à la
place du démarrage propre au runtime. Collé dans un projet généré, il sert ce que le
runtime servait : l'API sur le port choisi par `rebase dev`, la connexion et l'inscription
avec la table d'authentification du projet, les tables exportées par `backend/schema/index.ts`,
les hooks globaux dans `backend/hooks.ts`, les fonctions dans `backend/functions/`, les
tâches cron dans `backend/crons/`, les buckets déclarés dans `backend/resources.ts` et la
configuration CORS nécessaire au panneau d'administration sur son propre port.

```typescript
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { getRequestListener } from "@hono/node-server";
import {
    CORS_EXPOSED_HEADERS,
    createRebaseBackend,
    installShutdownHandlers,
    installUnhandledRejectionHandler,
    isLocalhostOrigin,
    loadEnv,
    logger,
    resolveStorageSources,
    setDefaultBackend,
    type HonoEnv
} from "@rebasepro/server";
import {
    createPostgresAdapter,
    createPostgresDatabaseConnection,
    postgresDriverConfigFromEnv
} from "@rebasepro/server-postgres";
import { declaredStorageSources } from "@rebasepro/types";
import "../resources";
import { storageAuthorize } from "../storage";
import { hooks } from "../hooks";

// dotenv never overrides a variable already set, so what `rebase dev` sets wins.
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH, quiet: true });
const env = loadEnv();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cronsDir = path.join(root, "backend/crons");

installUnhandledRejectionHandler();

const app = new Hono<HonoEnv>();

// Localhost in development, and the origins in CORS_ORIGINS or FRONTEND_URL.
const origins = (env.CORS_ORIGINS || env.FRONTEND_URL || "").split(",").map((origin) => origin.trim());
app.use("/*", cors({
    origin: (origin) =>
        origins.includes(origin) || (env.NODE_ENV !== "production" && isLocalhostOrigin(origin)) ? origin : null,
    credentials: true,
    exposeHeaders: [...CORS_EXPOSED_HEADERS]
}));
app.use("/*", secureHeaders());

const server = createServer({ maxHeaderSize: 64 * 1024 }, getRequestListener(app.fetch));
const { db, pool, connectionString } = createPostgresDatabaseConnection(env.DATABASE_URL);

const backend = await createRebaseBackend({
    schemaDir: path.join(root, "backend/schema"),
    hooks,
    functionsDir: path.join(root, "backend/functions"),
    cronsDir: existsSync(cronsDir) ? cronsDir : undefined,
    database: createPostgresAdapter(postgresDriverConfigFromEnv({ connection: db, connectionString })),
    auth: {
        jwtSecret: env.JWT_SECRET,
        serviceKey: env.REBASE_SERVICE_KEY,
        allowRegistration: env.ALLOW_REGISTRATION,
        cookieAuth: { sameSite: "Lax" }
    },
    storage: resolveStorageSources(process.env, declaredStorageSources(), path.join(root, "uploads")),
    storageAuthorize,
    history: true,
    provision: true
});

setDefaultBackend(backend);
backend.mount(app, { basePath: "/api" });
await backend.attachRealtime(server);
backend.start();

// The runtime answers health on both paths; an orchestrator probes `/health`.
for (const healthPath of ["/health", "/api/health"]) {
    app.get(healthPath, async (c) => {
        const { healthy } = await backend.healthCheck();
        return c.json({ status: healthy ? "ok" : "degraded" }, healthy ? 200 : 503);
    });
}

// `rebase dev` reads this line to know the backend is up.
server.listen(env.PORT, () => logger.info(`Server running at http://localhost:${env.PORT}`));
installShutdownHandlers(
    { shutdown: (timeoutMs) => backend.shutdown(timeoutMs, { server }) },
    { onCleanup: () => pool.end() }
);
```

Les chemins sont ceux du scaffold ; omettez l'importation et l'option `hooks`
lorsque le projet ne possède pas de fichier `backend/hooks.ts`. Les utilisateurs
sont stockés dans la table déclarée par `backend/schema` avec `defineAuthTable`,
de sorte que `auth` ne nomme aucune table. Le fichier s'appuie sur ce que
définit `rebase dev` : le port qu'il a choisi dans `PORT`, la base de données
gérée dans `DATABASE_URL` et le fichier `.env` du projet dans `DOTENV_CONFIG_PATH`.
`loadEnv()` valide ce qu'il contient et génère `JWT_SECRET` en développement
lorsqu'il n'est pas défini. Écoutez sur un autre port et le panneau d'administration
ne pourra pas joindre le serveur ; omettez `loadEnv()` et, sans `JWT_SECRET`, la
connexion sera désactivée.
`rebase dev` attend également la ligne `Server running at http://localhost:<port>`
avant d'indiquer que le backend est prêt. Les options `auth` sont celles du scaffold ;
le runtime lit également les fournisseurs OAuth, l'e-mail et les autres variables
`AUTH_*`, passez donc celles que vous utilisez, comme décrit dans [Authentification](/docs/backend/authentication/).
Le fichier ne sert pas non plus le panneau d'administration compilé en production :
le point d'entrée généré par [`rebase eject`](/docs/cli/) le fait, avec `serveSPA`,
et ouvre une connexion par base de données déclarée dans `backend/resources.ts`.

`createRebaseBackend` prend les mêmes options que `initializeRebaseBackend`,
sans `app`, `server` et `basePath`, et avec `provision` requis. Il construit tout :
il ouvre la base de données, configure l'authentification et le stockage, charge les
fonctions et les tâches cron, et construit chaque groupe de routes ainsi que le client
in-process. Il ne monte rien, ne démarre aucun timer et n'ajoute aucun écouteur de processus.
Tout le reste est un appel que vous effectuez, ou que vous omettez :

| Appel | Ce qu'il fait | Omettez-le et |
|---|---|---|
| `installUnhandledRejectionHandler()` | Enregistre dans les logs un rejet de promesse non géré, tel qu'un appel "fire-and-forget" dans une fonction personnalisée, au lieu de laisser Node terminer le processus. S'applique à l'ensemble du processus, c'est donc la décision du processus, pas celle d'un backend. Renvoie une fonction qui le désinstalle, ou `undefined` si un gestionnaire était déjà installé ou si `REBASE_EXIT_ON_UNHANDLED_REJECTION` est défini. | un rejet non géré termine le processus, comportement par défaut de Node |
| `setDefaultBackend(backend)` | Fait de ce backend le [backend par défaut du processus](#plusieurs-backends-dans-un-seul-processus) : ce à quoi répondent `import { rebase }` et le reste de l'API au niveau du module en dehors des requêtes, exécutions cron et jobs qu'un backend traite | cette API n'a aucun backend auquel répondre à cet endroit |
| `backend.mount(app, { basePath })` | Monte chaque groupe de routes sous `basePath` (`/api` par défaut), derrière les middlewares à l'échelle du processus : identifiants de requête, limite de taille du corps, compression, CSRF, journal des requêtes et enveloppe JSON pour les erreurs et les chemins inconnus. Inclut également le document JWKS, le serveur MCP, la documentation OpenAPI et les alias de routes existants. | rien n'est servi via HTTP ; `backend.rebase` et `backend.fetch` fonctionnent toujours |
| `backend.attachRealtime(server, { path })` | Attache le socket temps réel sur `server`, répondant aux requêtes d'upgrade uniquement sur `path` | il n'y a pas de requêtes en direct (live queries) |
| `backend.start()` | Démarre le planificateur de tâches cron, les workers de jobs, les purges de jetons expirés et de rétention d'historique, l'échantillonneur de métriques et l'audit RLS planifié, chacun là où `ownership` l'attribue à ce processus. Peut être appelé deux fois en toute sécurité. | aucun d'entre eux ne s'exécute, ce qui est souhaité pour un processus traitant les requêtes dans un [déploiement scindé](/docs/deployment/split-processes/) |
| `backend.shutdown(timeoutMs, { server })` | Arrête ce que `start()` et `attachRealtime()` ont démarré, en attendant la fin des exécutions cron et des jobs en cours. Ne ferme `server` que si vous le transmettez. | |

Le `path` par défaut du socket est le chemin de base fourni à `mount()` sans le
`/api` final ; ainsi, `/api` donne `/` et `/x/api` donne `/x` ; un chemin de base ne
se terminant pas par `/api` donne `/`. C'est là que le SDK se connecte, car il se
connecte à son `baseUrl` tandis que ses requêtes HTTP vont vers `${baseUrl}/api`.
Une mise à niveau (upgrade) vers tout autre chemin est laissée aux autres écouteurs
`upgrade` du serveur, de sorte que votre application peut exécuter son propre serveur
WebSocket sur le même `http.Server`.

### Ce que la création d'un backend peut modifier : `provision`

La création d'un backend pouvant exécuter du DDL, `createRebaseBackend` vous demande de choisir :

| `provision` | Crée | Pour |
|---|---|---|
| `true` | Tout ce que le backend dessert : les tables déclarées et leurs politiques RLS, la capture de changements (change capture) pour le temps réel, le rôle sous lequel s'exécutent les requêtes, ainsi que les tables propres au framework (clés d'API, exécutions de cron, jobs, métriques). | un déploiement à processus unique ; ce que transmet `initializeRebaseBackend` |
| `false` | Rien, au démarrage ou ultérieurement : les tables que d'autres backends créent lors de la première utilisation (clés d'idempotence, réservations de cron) ne sont pas créées non plus. Le schéma doit déjà être présent, appliqué par `rebase db push`, une migration ou un autre processus. Des tables d'authentification manquantes provoquent un refus au démarrage ; une table optionnelle manquante désactive sa fonctionnalité correspondante, mentionnée dans les logs. | un script, un test, un REPL, un processus en lecture seule, une base de données que seul votre processus de changement peut modifier |
| `{ tables: false, realtime: false }` | Les tables du framework et le rôle, mais pas le schéma des tables déclarées ni la capture de changements. | un processus qui ne possède pas le schéma dans un déploiement scindé |

Il s'agit délibérément d'une option plutôt que d'une étape ultérieure. Le pilote lit les
tables au moment de son ouverture et attache la capture de changements à celles qui existent alors.
Un appel à `provision()` effectué après coup s'exécuterait après que le pilote a déjà
déterminé ce qui existe. `REBASE_MIGRATE_ON_BOOT=none` désactive toujours le schéma
de table pour tout backend du processus. `initializeRebaseBackend` passe
`false` lorsque `REBASE_PROVISION=false`.

## Monter uniquement les groupes souhaités

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`backend.routes` contient les groupes de routes. Chacun est une sous-application Hono
que vous pouvez monter indépendamment, sur n'importe quel chemin :

```typescript
import { Hono } from "hono";
import { createRebaseBackend, type HonoEnv } from "@rebasepro/server";

const app = new Hono<HonoEnv>();
const backend = await createRebaseBackend({ database: adapter, auth, tables, defaultRls, functions, provision: true });

app.route("/v2/data", backend.routes.data());      // the data API, at a path of your own
app.route("/hooks", backend.routes.functions());   // getUser(c) and getDriver(c) work inside
```

`tables` est une liste de résultats de `defineTable`, `defineAuthTable` et `defineView` — généralement tout ce que `backend/schema/index.ts` exporte — et `defaultRls` correspond à ce que prennent ses tables avec `rls: "inherit"`, le `defaultRls` exporté par cet index. Chaque table est compilée lors de la création du backend, et un problème dans l'une d'elles (absence de `rls`, `"inherit"` sans `defaultRls`, une relation vers une table absente de la liste) la refuse avec une `SchemaDefinitionError` précisant chaque erreur. Passez plutôt `schemaDir` pour charger le répertoire comme le fait le runtime, exports de l'index et `defaultRls` inclus ; passez les deux et `tables` sera ce qui est servi tandis que `schemaDir` sera ce dans quoi l'éditeur de schéma écrit.

```typescript no-verify
import * as schema from "../schema";

const tables = [schema.users, schema.posts];
const defaultRls = schema.defaultRls;
```

| Groupe | Normalement sur | Sert |
|---|---|---|
| `routes.auth()` | `/api/auth` | la connexion, les sessions, OAuth, la réinitialisation de mot de passe, `GET /config`, les clés d'API propres à l'appelant et le catalogue de portées (scopes) |
| `routes.data()` | `/api/data` | les routes REST des tables et leur historique |
| `routes.storage()` | `/api/storage` | le stockage de fichiers, ou le routeur qui renvoie `STORAGE_NOT_CONFIGURED` |
| `routes.functions()` | `/api/functions` | vos [fonctions personnalisées](/docs/backend/custom-functions/), ou le relais vers le processus qui les sert |
| `routes.admin()` | `/api/admin` | les utilisateurs et rôles, les clés de service, l'édition de schéma, la maintenance du stockage, les sauvegardes, l'audit RLS, l'export SQL, la boîte de messagerie de développement et les logs |
| `routes.cron()` | `/api/admin/cron` | la surface d'administration des tâches cron |
| `routes.meta()` | `/api/meta` | le contrat du projet lu par un SDK généré |
| `routes.schema()` | `/api/schema` | `GET /tables` : les descripteurs de tables à partir desquels le CMS et le Studio effectuent le rendu — voir [Points de terminaison](/docs/backend/endpoints/#schema) |

Chaque groupe intègre les middlewares nécessaires : le contexte d'authentification qui
injecte `user`, `driver` et `scopes` de l'appelant sur la requête, ses limites de débit (rate limits)
et sa barrière d'administration. Il répond donc de la même manière quel que soit l'endroit
où il est monté, y compris sous un chemin paramétré comme `/:tenant/data`. Un groupe lit
également l'endroit où il a été monté, de sorte que l'API de données achemine toujours
chaque table vers sa base de données et que la liste des fonctions mentionne les chemins
sur lesquels elle est réellement servie.

Un groupe refuse également `x-rebase-impersonate` et `x-rebase-simulate-*` de lui-même
(`400 IMPERSONATION_UNSUPPORTED` / `SIMULATION_UNSUPPORTED`), sauf s'il s'agit du
groupe data ou functions, qui les honorent. `refuseUnhonouredImpersonation(honouredMounts)`
issu de `@rebasepro/server` fait de même pour vos propres routes.

Ce qu'un groupe n'intègre pas, ce sont les middlewares à l'échelle du processus que
`mount()` place devant tout le reste. En montant les groupes un par un, ajoutez
vous-même les éléments souhaités : une limite de taille de corps (`bodyLimit` de `hono/body-limit`),
la compression et l'enveloppe d'erreur JSON :

```typescript
import { errorHandler } from "@rebasepro/server";

app.onError(errorHandler);
```

Chaque appel renvoie un nouveau routeur sur les mêmes gestionnaires, vous pouvez donc monter un groupe à deux endroits différents. Demander un groupe dont la surface a été exclue lors de la création de ce backend (`surfaces: { data: false }`) lève une exception, car le backend ne l'a jamais construit. La documentation OpenAPI et le serveur MCP ne possèdent aucun groupe : ils décrivent les URL de la structure de `mount()`, donc seul `mount()` les dessert.

## Le backend sans serveur

Un backend construit peut être utilisé sans rien monter.
`backend.rebase` est son client in-process, et `backend.fetch(request)`
répond à une `Request` comme le ferait `mount()` sous `/api` :

```typescript
const backend = await createRebaseBackend({ database: adapter, schemaDir, provision: false });

const { data } = await backend.rebase.dataAsAdmin.posts.find({ limit: 5 });
const res = await backend.fetch(new Request("http://local/api/meta/schema-version"));

await backend.shutdown();
```

Les appels du plan de contrôle sur ce client (`rebase.auth`, `rebase.admin`,
`rebase.functions` et `rebase.cron`) atteignent les propres routes du backend
in-process. Ils fonctionnent quel que soit l'endroit où vous avez monté les groupes,
ou même si vous ne les avez pas montés, et les middlewares ajoutés à votre propre
application ne s'exécutent pas sur eux.

Pour un script qui n'a besoin que des données, [`openRebase`](/docs/backend/scripts/)
ouvre la base de données sans construire de backend du tout.

## Plusieurs backends dans un seul processus

`createRebaseBackend` n'écrit aucune variable globale au niveau du processus. Chaque backend
conserve son propre état dans `backend.services`, de sorte que deux d'entre eux dans
un même processus restent distincts : chacun signe et vérifie les sessions avec ses propres
clés, évalue les portées selon ses propres rôles, vérifie les clés d'API dans son propre
magasin et compte les limites de débit dans son propre magasin.

```typescript
const a = await createRebaseBackend({ database: adapterA, auth: { jwtSecret: SECRET_A }, tables, provision: true });
const b = await createRebaseBackend({ database: adapterB, auth: { jwtSecret: SECRET_B }, tables, provision: true });

app.route("/a/data", a.routes.data());
app.route("/b/data", b.routes.data());   // a session from `a` is a 401 here
```

| `backend.services` | Ce que c'est |
|---|---|
| `jwt` | Le service JWT du backend : signe et vérifie les sessions, les liens de téléchargement et ses autres jetons, et sert son JWKS |
| `access` | Son modèle d'accès (des rôles aux portées) et le résolveur pour le propriétaire d'une clé personnelle |
| `apiKeyStore` | L'endroit où ses clés d'API sont vérifiées |
| `rateLimitStore`, `authLimiters` | Ses compteurs de limite de débit et les limiteurs sur ses routes d'authentification |
| `tables()` | Les descripteurs compilés des tables qu'il sert |
| `topics`, `queues` | Ses environnements d'exécution de topics et de files d'attente (queues) |

Un backend ne recevant aucun `auth.jwtSecret`, tel qu'un backend dont `auth` est un
adaptateur, ne signe rien qui lui soit propre ; son `services.jwt` suit donc la configuration
par défaut du processus.

**Les ressources appartiennent au processus.** Les déclarations `database()`, `bucket()`,
`topic()` et `queue()` dans `backend/resources.ts` sont des valeurs au niveau du module,
et chaque backend du processus les lit toutes : un backend dont le projet ne déclare
aucun topic activera quand même sa file de jobs pour le topic d'un autre projet,
et refusera de démarrer si son pilote ne peut pas en prendre en charge. Exécutez les
ressources d'un seul projet par processus. Plusieurs backends de ce même projet,
chacun sur sa propre base de données, ne posent aucun problème.

**Où va `rebase`.** Au sein d'une requête, d'une exécution cron ou d'un job servi par
un backend, `rebase`, qu'il soit importé depuis `@rebasepro/server` ou reçu en tant que
`ctx.rebase`, correspond à ce backend, tout comme le `publish` de topic et le `enqueue`
de file d'attente. N'importe où ailleurs (portée du module, un script, un test), ils
répondent pour le **backend par défaut du processus**, défini par `setDefaultBackend(backend)`,
et que `initializeRebaseBackend` définit sur son propre backend. Il en va de même pour
le reste de l'API au niveau du module : `verifyAccessToken` et les autres utilitaires JWT,
`getAccessModel`, `verifyCredential` et `extractUserFromToken`.

Trois composants fonctionnent directement sur un backend, et un ne fonctionne sur aucun backend :

```typescript
import { createJwtService, requireAuth, requireScope } from "@rebasepro/server";

// Mint a session for one of this backend's users, in a test or a login of your
// own. `userId` is the user's id in the auth table.
const token = await backend.services.jwt.generateAccessToken(userId, ["editor"]);

// Check a session token, an rk_ API key or the service key for a socket or a tunnel of your
// own, as this backend's routes judge it: its uid, roles, scopes and kind, or null.
const caller = await backend.verifyCredential(token);

// A route of your own, outside the groups, judged by this backend. The auth table
// declares the app scope: auth: { scopes: { "project:deploy": { label: "Deploy projects" } } }.
app.post("/deploy", (c, next) => { c.set("services", backend.services); return next(); },
    requireAuth, requireScope("project:deploy"), (c) => c.json({ ok: true }));

// A JWT service on its own.
const jwt = createJwtService({ secret: process.env.JWT_SECRET!, accessExpiresIn: "15m" });
const payload = await jwt.verifyAccessToken(token);
```

Une session émise est vérifiée comme n'importe quelle autre à chaque requête, son uid doit donc correspondre à un utilisateur existant : pour un uid sans utilisateur correspondant, la requête est rejetée.

`verifyCredential` parvient au même verdict que les routes : une session dont le propriétaire s'est déconnecté, un uid sans utilisateur et un compte désactivé renvoient null, et les rôles sont ceux que détient le compte actuellement. Il lève une exception lorsque la base de données est inaccessible.

Chaque groupe de routes définit `c.var.services` lui-même. Une route en dehors des groupes qui utilise `requireAuth`, `requireScope` ou un autre guard de `@rebasepro/server` le lit à cet endroit et se rabat sur la valeur par défaut du processus s'il n'est pas défini. `requireScope` évalue l'appelant identifié par `requireAuth`, il se place donc après `requireAuth` : utilisé seul, il refuse chaque requête avec un 401. Il prend une portée intégrée ou une portée d'application déclarée par le backend sous `auth.scopes` sur sa table d'authentification, comme dans le commentaire ci-dessus.

Un nom qui n'est pas une portée, ou une portée intégrée mal orthographiée comme `data:raed`, lève une erreur là où la route est enregistrée. Une portée d'application que le backend sollicité ne déclare pas renvoie une erreur `500 SCOPE_NOT_DECLARED` à tout appelant, y compris un administrateur.

## Arrêt

Depuis `initializeRebaseBackend`, transmettez le backend à l'utilitaire intégré
plutôt que d'écrire un gestionnaire de signal. Il vide les requêtes HTTP (drain),
arrête le planificateur cron, démonte le temps réel, ferme le pool SMTP dès que
plus rien ne peut envoyer d'e-mails, protège contre les signaux répétés et force
la fermeture si l'arrêt se bloque :

```typescript
import { initializeRebaseBackend, installShutdownHandlers } from "@rebasepro/server";

const backend = await initializeRebaseBackend({ app, server, database: adapter, tables });
installShutdownHandlers(backend, { onCleanup: () => pool.end() });
```

Ne le combinez **pas** avec votre propre `server.close()` : le `shutdown()` de ce
backend ferme déjà le serveur qui lui a été transmis, et une seconde fermeture
provoque un interblocage (deadlock). Un backend issu de `createRebaseBackend` ne
ferme un serveur que si vous le lui passez, `backend.shutdown(timeoutMs, { server })`,
comme dans l'exemple en haut de cette page.

## Intégration du pilote Postgres

Encore un cran plus bas, `@rebasepro/server-postgres` fonctionne sans le serveur Rebase
du tout : ouvrez son pilote de données et son socket temps réel dans Express, Fastify
ou Node pur, et assemblez le reste vous-même. Voir
[Intégrer le pilote Postgres](/docs/backend/embedding-postgres-driver/).

## CORS pour un frontend de navigateur

Un serveur personnalisé gère sa propre configuration CORS, et un frontend situé
sur une autre origine ne peut lire que les en-têtes de réponse qu'il expose. Exposez
ceux que le SDK lit, sinon `etagOf(row)` vaudra toujours `undefined` à cet endroit — une
écriture `ifMatch` partira alors sans en-tête `If-Match` — et une réponse 429
perdra son en-tête `Retry-After` :

```typescript
import express from "express";
import cors from "cors";
import { CORS_EXPOSED_HEADERS } from "@rebasepro/server";

const app = express();
app.use(cors({
    origin: ["https://app.example.com"],
    credentials: true,
    exposedHeaders: [...CORS_EXPOSED_HEADERS]
}));
```

`CORS_EXPOSED_HEADERS` est la liste que le runtime expose lui-même, de sorte
qu'un en-tête que le SDK commence à lire dans une version ultérieure parvienne
à votre frontend sans modification ici. Elle comprend `ETag`, `Retry-After`,
`X-Request-ID`, les trois en-têtes `X-RateLimit-*` et `Preference-Applied`, ainsi
que `Location`, `Upload-Offset` et `Rebase-Upload-Result`, avec lesquels répond un
téléversement avec reprise (fichiers de plus de 8 Mio), et `X-Rebase-Simulated-Context`,
qui indique sous quelle identité s'est exécutée la requête simulée d'un administrateur.
Sans les trois en-têtes de téléversement, le SDK ne peut pas suivre un téléversement
depuis une autre origine et envoie chaque fichier sous la forme d'une requête multipart
unique à la place.

Le runtime Rebase et le backend éjecté envoient déjà cette liste.

## En savoir plus

- [Intégrer le pilote Postgres](/docs/backend/embedding-postgres-driver/) — le pilote de données et le socket temps réel seuls, dans Express
- [Scripts et la Console](/docs/backend/scripts/) — les données du projet depuis un script, un test ou un REPL, sans serveur
- [Vue d'ensemble du backend](/docs/backend/) — où réside chaque option lorsque le runtime démarre à la place
- [Processus scindés](/docs/deployment/split-processes/) — les rôles qu'un serveur personnalisé doit reproduire
- [Configuration du stockage](/docs/backend/storage/) — les sources qu'un serveur personnalisé doit résoudre lui-même
