---
sourceHash: 8935b1e530b1bfb3
title: Intégration de serveur personnalisé
sidebar_label: Serveur personnalisé
description: Construisez le backend Rebase à partir de pièces publiques dans votre propre serveur — createRebaseBackend, ses groupes de routes, mount, attachRealtime et start — ou intégrez le driver Postgres dans Express.
---

# Intégration de serveur personnalisé

`initializeRebaseBackend` est un raccourci. Il construit tout le backend, le monte
sur votre application Hono sous `/api`, attache le socket temps réel à votre serveur
HTTP et démarre le travail en arrière-plan, en un seul appel. Quand c'est ce que
vous voulez, utilisez-le.

Quand ce n'est pas le cas, descendez d'un cran. Chaque partie de cet appel est une
pièce publique que vous pouvez appeler vous-même : construisez le backend, puis
montez-le en entier ou seulement les groupes de routes voulus, aux chemins voulus,
et décidez quel processus démarre les minuteurs. [Intégrer le driver Postgres](/docs/backend/embedding-postgres-driver/)
va un cran plus loin et ouvre le driver Postgres seul dans une application Express.

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

L'importation de `z` depuis `@rebasepro/server` est récente. Sur la version 0.17 et les versions antérieures, le package n'exportait aucun `z` : importez-le depuis `zod`, en faisant correspondre la version majeure utilisée par le runtime, et laissez votre bundler dédupliquer les deux copies.

:::caution[Deux copies de zod]
Avoir deux copies de zod chargées en même temps faisait auparavant échouer cet appel silencieusement. `loadEnv` combinait les schémas avec `.merge()`, qui accepte un schéma provenant de l'autre copie, puis rejette chaque champ comportant un `.default()`. Le serveur démarrait, signalait un succès et n'exécutait aucune de ses tâches cron ; rien dans l'échec ne mentionnait zod.

`loadEnv` valide désormais le schéma de base et votre schéma `extend` chacun avec son propre `.parse()`, de sorte qu'un schéma construit par une autre copie de zod fonctionne. Le runtime fournit `zod`, et le `backend/package.json` du scaffold le déclare dans la plage qu'utilise `@rebasepro/server`, de sorte qu'une seule copie est installée : gardez les deux égales.
:::

**Comportements clés :**
- Génère `JWT_SECRET` et `REBASE_SERVICE_KEY` en développement lorsqu'ils ne sont pas définis, pour que vous puissiez démarrer sans configuration manuelle, et les met en cache dans `.rebase-dev-secrets.json` afin qu'un redémarrage ne déconnecte personne.
- Bloque les secrets générés automatiquement en production — vous devez les définir explicitement.
- Valide que `CORS_ORIGINS` ou `FRONTEND_URL` est défini en production.
- Refuse une valeur `extend` qui n'est pas un schéma zod.
- Lève une `Error` qui nomme chaque variable manquante ou incorrecte, par exemple `DATABASE_URL: is required`, avec les problèmes relevés par zod dans sa propriété `issues`. Sur la 0.24, il lève le `ZodError` de zod lui-même, qui ne nomme aucune variable quand rien ne l'intercepte.

Consultez `.env.example` dans l'application échafaudée pour la liste complète des variables prises en charge.

## Un cran sous `initializeRebaseBackend`

Sur la 0.24,
`initializeRebaseBackend` est la seule entrée, et aucune des pièces ci-dessous n'est
exportée.

`initializeRebaseBackend` n'est que ces appels, et rien d'autre :

```typescript
import { createRebaseBackend, installUnhandledRejectionHandler, setDefaultBackend } from "@rebasepro/server";

installUnhandledRejectionHandler();
const backend = await createRebaseBackend({
    ...options,
    // `false` or `{ collections: false, realtime: false }` in the cases
    // the `provision` section below lists.
    provision: true
});
setDefaultBackend(backend);
backend.mount(app, { basePath: "/api" });
await backend.attachRealtime(server);
backend.start();
```

Le `shutdown()` qu'il renvoie ferme aussi le serveur qu'on lui a donné. Voici la même
chose écrite comme le `backend/src/index.ts` d'un projet, prête à être modifiée.
`rebase dev` exécute ce fichier lorsqu'un projet en a un, à la place du démarrage
propre au runtime. Collé dans un projet issu d'un scaffold, il sert ce que servait
le runtime : l'API sur le port choisi par `rebase dev`, la connexion et l'inscription
avec la collection d'utilisateurs du projet, les fonctions de `backend/functions/`,
les tâches cron de `backend/crons/`, les buckets déclarés dans `config/resources.ts`,
et le CORS dont le panneau d'administration a besoin sur son propre port.

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
import "../../config/resources";
import usersCollection from "../../config/collections/users";
import { storageAuthorize } from "../../config/storage";

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
    collectionsDir: path.join(root, "config/collections"),
    functionsDir: path.join(root, "backend/functions"),
    cronsDir: existsSync(cronsDir) ? cronsDir : undefined,
    database: createPostgresAdapter(postgresDriverConfigFromEnv({ connection: db, connectionString })),
    auth: {
        collection: usersCollection,
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

Les chemins sont ceux du scaffold. Le fichier s'appuie sur ce que définit `rebase dev` :
le port qu'il a choisi dans `PORT`, la base de données gérée dans `DATABASE_URL`, et le
`.env` du projet dans `DOTENV_CONFIG_PATH`. `loadEnv()` valide ce que cela contient, et
génère `JWT_SECRET` en développement lorsqu'il n'est pas défini. Écoutez sur un autre
port et le panneau d'administration ne peut plus joindre le serveur ; omettez `loadEnv()` et,
sans `JWT_SECRET`, la connexion est désactivée.
`rebase dev` attend aussi la ligne `Server running at http://localhost:<port>` avant
d'annoncer que le backend est démarré. Les options `auth` sont celles du scaffold ; le
runtime lit aussi les fournisseurs OAuth, l'e-mail et les autres variables `AUTH_*`,
passez donc celles que vous utilisez, comme le décrit
[Authentification](/docs/backend/authentication/). Le fichier ne sert pas non plus le
panneau d'administration compilé en production : l'entrypoint qu'écrit
[`rebase eject`](/docs/cli/) le fait, avec `serveSPA`, et ouvre une connexion par base de
données déclarée dans `config/resources.ts`.

`createRebaseBackend` prend les mêmes options que `initializeRebaseBackend`, sans
`app`, `server` ni `basePath`, et avec `provision` obligatoire. Il construit tout : il
ouvre la base de données, met en place l'authentification et le stockage, charge les
fonctions et les tâches cron, et construit chaque groupe de routes ainsi que le client
en processus. Il ne monte rien, ne démarre aucun minuteur et n'ajoute aucun écouteur
de processus. Chacun des autres éléments est un appel que vous faites, ou que vous
omettez :

| Appel | Ce qu'il fait | Si vous l'omettez |
|---|---|---|
| `installUnhandledRejectionHandler()` | Journalise un rejet de promesse que rien n'a géré, comme un appel sans attente (fire-and-forget) dans une fonction personnalisée, au lieu de laisser Node mettre fin au processus. Valable pour tout le processus : c'est donc la décision du processus, pas celle d'un backend. Renvoie une fonction qui le désinstalle, ou `undefined` lorsqu'un gestionnaire était déjà installé ou que `REBASE_EXIT_ON_UNHANDLED_REJECTION` est défini. | un rejet non géré met fin au processus, comportement par défaut de Node |
| `setDefaultBackend(backend)` | Fait de ce backend le [défaut du processus](#plusieurs-backends-dans-un-même-processus) : celui que visent `import { rebase }` et le reste de l'API de niveau module en dehors des requêtes, des exécutions cron et des jobs qu'un backend sert | cette API n'a alors aucun backend à viser |
| `backend.mount(app, { basePath })` | Chaque groupe de routes sous `basePath` (par défaut `/api`), derrière le middleware global du processus : identifiants de requête, limite de taille du corps, compression, CSRF, journal des requêtes, et l'enveloppe JSON pour les erreurs et les chemins inconnus. Aussi le document JWKS, le serveur MCP, la documentation OpenAPI et les alias de routes hérités. | rien n'est servi en HTTP ; `backend.rebase` et `backend.fetch` fonctionnent toujours |
| `backend.attachRealtime(server, { path })` | Le socket temps réel, sur `server`, qui ne répond aux mises à niveau (upgrade) que sur `path` | il n'y a pas de requêtes en direct |
| `backend.start()` | Le planificateur cron, les workers de jobs, les balayages des jetons expirés et de la rétention de l'historique, l'échantillonneur de métriques et l'audit RLS planifié, chacun là où `ownership` le confie à ce processus. Peut être appelé deux fois sans risque. | aucun ne s'exécute, ce que veut un processus qui sert des requêtes dans un [déploiement en processus séparés](/docs/deployment/split-processes/) |
| `backend.shutdown(timeoutMs, { server })` | Arrête ce que `start()` et `attachRealtime()` ont démarré, en attendant les exécutions cron et les jobs en cours. Ne ferme `server` que si vous le passez. | |

Le `path` par défaut du socket est le chemin de base donné à `mount()`, privé d'un
`/api` final : `/api` donne `/` et `/x/api` donne `/x` ; un chemin de base qui ne
se termine pas par `/api` donne `/`. C'est là que le SDK se
connecte, car il se connecte à sa `baseUrl` tandis que ses requêtes HTTP vont vers
`${baseUrl}/api`. Une mise à niveau vers tout autre chemin est laissée aux autres
écouteurs `upgrade` du serveur, si bien que votre application peut faire tourner son
propre serveur WebSocket sur le même `http.Server`.

### Ce que la création d'un backend peut modifier : `provision`

Créer un backend peut exécuter du DDL ; `createRebaseBackend` vous demande donc de trancher :

| `provision` | Crée | Pour |
|---|---|---|
| `true` | Tout ce que le backend sert : les tables des collections et leurs politiques RLS, la capture des changements pour le temps réel, le rôle sous lequel les requêtes s'exécutent, et les tables propres au framework (clés API, exécutions cron, jobs, métriques). | un déploiement à processus unique ; ce que passe `initializeRebaseBackend` |
| `false` | Rien, ni au démarrage ni ensuite : les tables que d'autres backends créent à la première utilisation (clés d'idempotence, claims de cron) ne sont pas créées non plus. Le schéma doit déjà être en place, appliqué par `rebase db push`, une migration ou un autre processus. Des tables d'auth manquantes font refuser le démarrage ; une table optionnelle manquante désactive sa fonctionnalité, nommée dans le log. | un script, un test, un REPL, un processus qui ne fait que lire, une base de données que seul votre processus de changement peut modifier |
| `{ collections: false, realtime: false }` | Les tables du framework et le rôle, mais ni le schéma des collections ni la capture des changements. | un processus qui ne possède pas le schéma dans un déploiement en processus séparés |

C'est une option plutôt qu'une étape ultérieure, et c'est voulu. Le driver lit les
tables à son ouverture et attache la capture des changements à celles qui existent à
ce moment-là. Un `provision()` appelé ensuite s'exécuterait après que le driver a déjà
décidé de ce qui existe. `REBASE_MIGRATE_ON_BOOT=none` désactive toujours le schéma
des collections pour n'importe quel backend du processus. <span class="since-badge" data-since="0.26">Depuis 0.26</span> `initializeRebaseBackend` passe `false` quand `REBASE_PROVISION=false`.

## Ne monter que les groupes voulus

`backend.routes` contient les groupes de routes. Chacun est une sous-application Hono
que vous pouvez monter seule, à n'importe quel chemin :

```typescript
import { Hono } from "hono";
import { createRebaseBackend, type HonoEnv } from "@rebasepro/server";

const app = new Hono<HonoEnv>();
const backend = await createRebaseBackend({ database: adapter, auth, collections, functions, provision: true });

app.route("/v2/data", backend.routes.data());      // the data API, at a path of your own
app.route("/hooks", backend.routes.functions());   // getUser(c) and getDriver(c) work inside
```

`collections` est le tableau qu'exporte le `config/collections/index.ts` d'un scaffold. Il porte les `defaultSecurityRules` de cet index, comme le fait `collectionsDir`, de sorte que le backend provisionne les politiques que provisionnerait `rebase db push`. Un tableau à vous ne porte que les règles que déclarent ses collections, et `provision: true` rend réservée aux administrateurs une collection qui n'en déclare aucune, en supprimant les politiques que Rebase avait générées pour elle auparavant, sur chaque serveur qui partage la base de données.

L'index du scaffold applique les valeurs par défaut à son tableau. Dans un projet créé par le scaffold de la 0.24, copiez cette boucle depuis le `config/collections/index.ts` d'un nouveau scaffold, ou passez `collectionsDir`.

| Groupe | Normalement à | Sert |
|---|---|---|
| `routes.auth()` | `/api/auth` | la connexion, les sessions, OAuth, la réinitialisation de mot de passe, `GET /config`, les propres clés API de l'appelant et le catalogue des portées |
| `routes.data()` | `/api/data` | les routes REST des collections et leur historique |
| `routes.storage()` | `/api/storage` | le stockage de fichiers, ou le routeur qui répond `STORAGE_NOT_CONFIGURED` |
| `routes.functions()` | `/api/functions` | vos [fonctions personnalisées](/docs/backend/custom-functions/), ou le relais vers le processus qui les sert |
| `routes.admin()` | `/api/admin` | les utilisateurs et les rôles, les clés de service, l'édition du schéma, la maintenance du stockage, les sauvegardes, l'audit RLS, l'export SQL, la boîte de réception de développement et les journaux |
| `routes.cron()` | `/api/admin/cron` | la surface d'administration cron |
| `routes.meta()` | `/api/meta` | le contrat du projet que lit un SDK généré |

Chaque groupe porte le middleware dont il a besoin : le contexte d'authentification
qui place sur la requête l'utilisateur de l'appelant (`user`), son `driver` et ses
`scopes`, ses limites de débit et sa barrière d'administration. Il répond donc de la
même façon où qu'il soit monté, y compris sous un chemin paramétré tel que
`/:tenant/data`. Un groupe lit aussi l'endroit où il a été monté, de sorte que l'API
de données route toujours chaque collection vers sa source de données et que la liste
des fonctions nomme les chemins auxquels elles sont réellement servies.

Un groupe refuse aussi lui-même `x-rebase-impersonate` et `x-rebase-simulate-*`
(`400 IMPERSONATION_UNSUPPORTED` / `SIMULATION_UNSUPPORTED`), sauf s'il s'agit du
groupe de données ou de fonctions, qui les honorent ; sur la 0.25, un groupe monté seul
répondait en tant qu'administrateur. `refuseUnhonouredImpersonation(honouredMounts)`
de `@rebasepro/server` fait de même pour vos propres routes.

Ce qu'un groupe ne porte pas, c'est le middleware global du processus que `mount()`
place devant tout le reste. En montant les groupes un par un, ajoutez vous-même ce que
vous en voulez : une limite de taille du corps (`bodyLimit` de `hono/body-limit`), la
compression et l'enveloppe d'erreur JSON :

```typescript
import { errorHandler } from "@rebasepro/server";

app.onError(errorHandler);
```

Chaque appel renvoie un routeur neuf au-dessus des mêmes gestionnaires, ce qui permet
de monter un groupe à deux endroits. Demander un groupe dont la surface a été exclue à
la création de ce backend (`surfaces: { data: false }`) lève une exception, car le
backend ne l'a jamais construit. La documentation OpenAPI et le serveur MCP n'ont pas
de groupe : ils décrivent les URL de la disposition de `mount()`, donc seul `mount()`
les sert.

## Le backend sans serveur

Un backend que vous avez construit peut s'utiliser sans rien monter.
`backend.rebase` est son client en processus, et `backend.fetch(request)`
répond à une `Request` comme le ferait `mount()` à `/api` :

```typescript
const backend = await createRebaseBackend({ database: adapter, collections, provision: false });

const { data } = await backend.rebase.dataAsAdmin.posts.find({ limit: 5 });
const res = await backend.fetch(new Request("http://local/api/meta/schema-version"));

await backend.shutdown();
```

Les appels du plan de contrôle sur ce client (`rebase.auth`, `rebase.admin`,
`rebase.functions` et `rebase.cron`) atteignent en processus les propres routes du
backend. Ils fonctionnent où que vous ayez monté les groupes, ou même si vous ne les
avez pas montés, et le middleware que vous avez ajouté à votre propre application ne
s'exécute pas dessus.

Pour un script qui n'a besoin que des données, [`openRebase`](/docs/backend/scripts/)
ouvre la base de données sans construire de backend du tout.

## Plusieurs backends dans un même processus

Sur la 0.24, la
configuration JWT, le modèle d'accès, le magasin de clés API, le magasin des limites de
débit et `rebase` sont des globales du processus, et le dernier backend construit les
emporte toutes.

`createRebaseBackend` n'écrit aucune globale de processus. Chaque backend garde son
propre état dans `backend.services`, si bien que deux backends dans un même processus
restent deux : chacun signe et vérifie les sessions avec ses propres clés, juge les
portées selon ses propres rôles, vérifie les clés API dans son propre magasin et compte
les limites de débit dans son propre magasin.

```typescript
const a = await createRebaseBackend({ database: adapterA, auth: { jwtSecret: SECRET_A }, collections, provision: true });
const b = await createRebaseBackend({ database: adapterB, auth: { jwtSecret: SECRET_B }, collections, provision: true });

app.route("/a/data", a.routes.data());
app.route("/b/data", b.routes.data());   // a session from `a` is a 401 here
```

| `backend.services` | Ce que c'est |
|---|---|
| `jwt` | Le service JWT du backend : il signe et vérifie les sessions, les liens de téléchargement et ses autres jetons, et sert son JWKS |
| `access` | Son modèle d'accès (des rôles vers les portées) et le résolveur du propriétaire d'une clé personnelle |
| `apiKeyStore` | L'endroit où ses clés API sont vérifiées |
| `rateLimitStore`, `authLimiters` | Ses compteurs de limites de débit, et les limiteurs de ses routes d'authentification |
| `collections()` | Les collections qu'il sert |
| `topics`, `queues` | Ses runtimes de topics et de files |

Un backend auquel aucun `auth.jwtSecret` n'est donné, comme celui dont l'`auth` est un
adaptateur, ne signe rien de lui-même ; son `services.jwt` suit donc le défaut du
processus.

**Les ressources appartiennent au processus.** Les déclarations `database()`, `bucket()`,
`topic()` et `queue()` de `config/resources.ts` sont des valeurs de niveau module, et
chaque backend du processus les lit toutes : un backend dont le projet ne déclare
aucun topic active tout de même sa file de jobs pour le topic d'un autre projet,
et refuse de démarrer si son driver ne peut pas en porter un. Exécutez les ressources d'un seul
projet par processus. Plusieurs backends de ce même projet, chacun sur sa propre
base de données, ne posent pas de problème.

**Où va `rebase`.** Dans une requête, une exécution cron ou un job qu'un backend
sert, `rebase`, qu'il soit importé de `@rebasepro/server` ou reçu comme `ctx.rebase`,
est ce backend, de même que le `publish` d'un topic et l'`enqueue` d'une file. Partout
ailleurs (portée de module, script, test), ils visent le **défaut du processus**, que
règle `setDefaultBackend(backend)` et que `initializeRebaseBackend` règle sur son propre
backend. Le reste de l'API de niveau module fait de même : `verifyAccessToken` et les
autres helpers JWT, `getAccessModel`, `verifyCredential` et `extractUserFromToken`.

Trois pièces travaillent directement sur un backend donné, et une sur aucun backend :

```typescript
import { createJwtService, requireAuth, requireScope } from "@rebasepro/server";

// Mint a session for one of this backend's users, in a test or a login of your
// own. `userId` is the user's id in the users collection.
const token = await backend.services.jwt.generateAccessToken(userId, ["editor"]);

// Check a session token, an rk_ API key or the service key for a socket or a tunnel of your
// own, as this backend's routes judge it: its uid, roles, scopes and kind, or null.
const caller = await backend.verifyCredential(token);

// A route of your own, outside the groups, judged by this backend. The users collection
// declares the app scope: auth: { scopes: { "project:deploy": { label: "Deploy projects" } } }.
app.post("/deploy", (c, next) => { c.set("services", backend.services); return next(); },
    requireAuth, requireScope("project:deploy"), (c) => c.json({ ok: true }));

// A JWT service on its own.
const jwt = createJwtService({ secret: process.env.JWT_SECRET!, accessExpiresIn: "15m" });
const payload = await jwt.verifyAccessToken(token);
```

Une session émise est vérifiée comme toute autre à chaque requête : son uid doit donc
être celui d'un utilisateur qui existe, et pour un uid sans utilisateur la requête est
refusée.

`verifyCredential` rend le verdict que rendent les routes : une session dont son propriétaire s'est déconnecté, un uid sans utilisateur et un compte désactivé donnent null, et les rôles sont ceux que le compte détient à cet instant. Il lève une exception quand la base de données est injoignable. Sur la 0.24, il ne vérifie que la signature, et lit les rôles dans le jeton.

Chaque groupe de routes renseigne lui-même `c.var.services`. Une route extérieure aux
groupes qui utilise `requireAuth`, `requireScope` ou un autre garde de
`@rebasepro/server` l'y lit, et se rabat sur le défaut du processus lorsqu'il n'est
pas défini. `requireScope` juge l'appelant qu'a identifié `requireAuth`, il vient donc
après `requireAuth` : seul, il refuse chaque requête par un 401. Il accepte une portée
intégrée, ou une portée d'application que le backend déclare sous `auth.scopes` dans sa
collection des utilisateurs, comme dans le commentaire ci-dessus.

Un nom qui n'est pas une portée, ou une portée intégrée mal orthographiée comme `data:raed`, lève une exception là où la route est enregistrée. Une portée d'application que le backend qui répond ne déclare pas renvoie `500 SCOPE_NOT_DECLARED` à chaque appelant, administrateur compris. Sur la 0.24, les deux renvoient `403 SCOPE_MISSING` à chaque appelant.

## Arrêt

Un backend issu de
`createRebaseBackend` est nouveau ; le reste de cette section vaut aussi pour la 0.24.

Avec `initializeRebaseBackend`, confiez le backend au helper intégré plutôt que
d'écrire un gestionnaire de signaux. Il vide les connexions HTTP, arrête le planificateur
cron, démonte le temps réel, ferme le pool SMTP une fois que plus rien ne peut envoyer,
protège contre les signaux répétés et force la sortie si l'arrêt se bloque :

```typescript
import { initializeRebaseBackend, installShutdownHandlers } from "@rebasepro/server";

const backend = await initializeRebaseBackend({ app, server, database: adapter, collections });
installShutdownHandlers(backend, { onCleanup: () => pool.end() });
```

Ne le combinez **pas** avec votre propre `server.close()` : le `shutdown()` de ce backend
ferme déjà le serveur qu'on lui a donné, et une seconde fermeture provoque un
interblocage (deadlock). Un backend issu de `createRebaseBackend` ne ferme un serveur
que si vous le lui passez, `backend.shutdown(timeoutMs, { server })`, comme dans
l'exemple en haut de cette page.

## Intégrer le driver Postgres

Un cran plus bas encore, `@rebasepro/server-postgres` fonctionne sans le serveur
Rebase du tout : ouvrez son driver de données et son socket temps réel dans Express,
Fastify ou du simple Node, et assemblez vous-même le reste. Voir
[Intégrer le driver Postgres](/docs/backend/embedding-postgres-driver/).

## CORS pour un frontend navigateur

Un serveur personnalisé possède sa propre configuration CORS, et un frontend sur une
autre origine ne peut lire que les en-têtes de réponse qu'elle expose. Exposez ceux
que le SDK lit, sans quoi `etagOf(row)` y vaut toujours `undefined` — une écriture
`ifMatch` part alors sans `If-Match` — et un 429 perd son `Retry-After` :

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

`CORS_EXPOSED_HEADERS` est la liste que le runtime expose lui-même : un en-tête que
le SDK se met à lire dans une version ultérieure parvient ainsi à votre frontend sans
modification ici. Elle contient `ETag`, `Retry-After`, `X-Request-ID`, les trois
en-têtes `X-RateLimit-*` et `Preference-Applied`, plus `Location`,
`Upload-Offset` et `Rebase-Upload-Result`, dans lesquels répond un téléversement
reprenable (fichiers de plus de 8 MiB), et `X-Rebase-Simulated-Context`, qui nomme
l'identité sous laquelle s'est exécutée la requête simulée d'un administrateur. Sans les
trois en-têtes de téléversement, le SDK ne peut pas suivre un téléversement depuis une
autre origine et envoie chaque fichier en une seule requête multipart. Sur la 0.24,
écrivez la liste à la main.

Le runtime Rebase et le backend éjecté envoient déjà cette liste. Sur la 0.23
ils n'exposent aucun de ces en-têtes, si bien qu'un frontend sur une autre origine ne lit aucun `ETag`.

## Liens connexes

- [Intégrer le driver Postgres](/docs/backend/embedding-postgres-driver/) — le driver de données et le socket temps réel seuls, dans Express
- [Scripts et console](/docs/backend/scripts/) — les données du projet depuis un script, un test ou un REPL, sans serveur
- [Backend Overview](/docs/backend/) — où réside chaque option lorsque le runtime démarre à la place
- [Split Processes](/docs/deployment/split-processes/) — les rôles qu'un serveur personnalisé doit reproduire
- [Storage Configuration](/docs/backend/storage/) — les sources qu'un serveur personnalisé doit résoudre lui-même
