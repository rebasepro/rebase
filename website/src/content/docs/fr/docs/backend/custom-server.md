---
sourceHash: b807a42cae57ce6e
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
et décidez quel processus démarre les minuteurs. La dernière section va un cran plus
loin et intègre le driver Postgres seul dans une application Express.

## Configuration de l'environnement

Rebase fournit un utilitaire centralisé `loadEnv()` dans `@rebasepro/server` qui valide vos variables d'environnement par rapport à un schéma Zod strict. Appelez-le **après** avoir chargé votre fichier `.env` :

```typescript
import dotenv from "dotenv";
import { loadEnv } from "@rebasepro/server";

dotenv.config({ path: "../../.env" });

// Basic — just Rebase env vars:
export const env = loadEnv();

// Extended — add your own typed vars:
import { z } from "@rebasepro/server";
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

:::caution[Le `z` utilisé pour étendre doit être le zod du runtime]
Avoir deux copies de zod chargées en même temps est la seule façon dont cet appel peut échouer, et cela échouait auparavant silencieusement. `.merge()` accepte un schéma provenant de l'autre copie — les structures sont identiques — puis `.parse()` rejette chaque champ comportant un `.default()`, car une valeur par défaut est reconnue par identité de classe. Le serveur démarrait, signalait un succès et n'exécutait aucune de ses tâches cron ; rien dans l'échec ne mentionnait zod.

Ne déclarez pas `zod` dans les dépendances de votre projet — le runtime le fournit déjà. Si vous devez le faire, faites correspondre sa version majeure et laissez votre bundler dédupliquer. `loadEnv` refuse désormais un schéma étranger au démarrage avec un message indiquant la solution, plutôt que de l'accepter et de n'en valider que la moitié.
:::

**Comportements clés :**
- Génère `JWT_SECRET` et `REBASE_SERVICE_KEY` en développement lorsqu'ils ne sont pas définis, pour que vous puissiez démarrer sans configuration manuelle, et les met en cache dans `.rebase-dev-secrets.json` afin qu'un redémarrage ne déconnecte personne.
- Bloque les secrets générés automatiquement en production — vous devez les définir explicitement.
- Valide que `CORS_ORIGINS` ou `FRONTEND_URL` est défini en production.
- Refuse un schéma `extend` construit par une copie différente de zod.

Consultez `.env.example` dans l'application échafaudée pour la liste complète des variables prises en charge.

## Un cran sous `initializeRebaseBackend`

<span class="since-badge" data-since="0.25">Depuis 0.25</span> Sur la 0.24,
`initializeRebaseBackend` est la seule entrée, et aucune des pièces ci-dessous n'est
exportée.

`initializeRebaseBackend` n'est que ces appels, et rien d'autre :

```typescript
import { createRebaseBackend, installUnhandledRejectionHandler, setDefaultBackend } from "@rebasepro/server";

installUnhandledRejectionHandler();
const backend = await createRebaseBackend({ ...options, provision: true });
setDefaultBackend(backend);
backend.mount(app, { basePath: "/api" });
await backend.attachRealtime(server);
backend.start();
```

Le `shutdown()` qu'il renvoie ferme aussi le serveur qu'on lui a donné. Voici la même
chose écrite dans un serveur à vous, prête à être modifiée :

```typescript
import { createServer } from "node:http";
import { Hono } from "hono";
import { getRequestListener } from "@hono/node-server";
import {
    createRebaseBackend,
    installShutdownHandlers,
    installUnhandledRejectionHandler,
    setDefaultBackend,
    type HonoEnv
} from "@rebasepro/server";
import { createPostgresAdapter, createPostgresDatabaseConnection } from "@rebasepro/server-postgres";
import { collections } from "./collections";

installUnhandledRejectionHandler();

const app = new Hono<HonoEnv>();
const server = createServer({ maxHeaderSize: 64 * 1024 }, getRequestListener(app.fetch));
const { db, pool, connectionString } = createPostgresDatabaseConnection(process.env.DATABASE_URL!);

const backend = await createRebaseBackend({
    collections,
    database: createPostgresAdapter({ connection: db, connectionString }),
    auth: { jwtSecret: process.env.JWT_SECRET! },
    provision: true
});

setDefaultBackend(backend);
backend.mount(app, { basePath: "/api" });
await backend.attachRealtime(server);
backend.start();

server.listen(3000);
installShutdownHandlers(
    { shutdown: (timeoutMs) => backend.shutdown(timeoutMs, { server }) },
    { onCleanup: () => pool.end() }
);
```

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
`/api` final : `/api` donne `/` et `/x/api` donne `/x`. C'est là que le SDK se
connecte, car il se connecte à sa `baseUrl` tandis que ses requêtes HTTP vont vers
`${baseUrl}/api`. Une mise à niveau vers tout autre chemin est laissée aux autres
écouteurs `upgrade` du serveur, si bien que votre application peut faire tourner son
propre serveur WebSocket sur le même `http.Server`.

### Ce que la création d'un backend peut modifier : `provision`

<span class="since-badge" data-since="0.25">Depuis 0.25</span>

Créer un backend peut exécuter du DDL ; `createRebaseBackend` vous demande donc de trancher :

| `provision` | Crée | Pour |
|---|---|---|
| `true` | Tout ce que le backend sert : les tables des collections et leurs politiques RLS, la capture des changements pour le temps réel, le rôle sous lequel les requêtes s'exécutent, et les tables propres au framework (clés API, exécutions cron, jobs, métriques). | un déploiement à processus unique ; ce que passe `initializeRebaseBackend` |
| `false` | Rien. Le schéma doit déjà être en place, appliqué par `rebase db push`, une migration ou un autre processus. Une table manquante échoue au moment où elle est utilisée. | un script, un test, un REPL, un processus qui ne fait que lire |
| `{ collections: false, realtime: false }` | Les tables du framework et le rôle, mais ni le schéma des collections ni la capture des changements. | un processus qui ne possède pas le schéma dans un déploiement en processus séparés |

C'est une option plutôt qu'une étape ultérieure, et c'est voulu. Le driver lit les
tables à son ouverture et attache la capture des changements à celles qui existent à
ce moment-là. Un `provision()` appelé ensuite s'exécuterait après que le driver a déjà
décidé de ce qui existe. `REBASE_MIGRATE_ON_BOOT=none` désactive toujours le schéma
des collections pour n'importe quel backend du processus.

## Ne monter que les groupes voulus

<span class="since-badge" data-since="0.25">Depuis 0.25</span>

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

<span class="since-badge" data-since="0.25">Depuis 0.25</span>

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

<span class="since-badge" data-since="0.25">Depuis 0.25</span> Sur la 0.24, la
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

**Où va `rebase`.** Dans une requête, une exécution cron ou un job qu'un backend
sert, `rebase`, qu'il soit importé de `@rebasepro/server` ou reçu comme `ctx.rebase`,
est ce backend, de même que le `publish` d'un topic et l'`enqueue` d'une file. Partout
ailleurs (portée de module, script, test), ils visent le **défaut du processus**, que
règle `setDefaultBackend(backend)` et que `initializeRebaseBackend` règle sur son propre
backend. Le reste de l'API de niveau module fait de même : `verifyAccessToken` et les
autres helpers JWT, `getAccessModel`, `verifyCredential` et `extractUserFromToken`.

Trois pièces travaillent directement sur un backend donné, et une sur aucun backend :

```typescript
import { createJwtService, requireScope } from "@rebasepro/server";

// Mint a session for this backend, in a test or a login of your own.
const token = await backend.services.jwt.generateAccessToken("u1", ["editor"]);

// Check a session token or an rk_ API key against this backend, for a socket
// or a tunnel of your own: its uid, roles, scopes and kind, or null.
const caller = await backend.verifyCredential(token);

// A route of your own, outside the groups, judged by this backend.
app.post("/deploy", (c, next) => { c.set("services", backend.services); return next(); },
    requireScope("project:deploy"), (c) => c.json({ ok: true }));

// A JWT service on its own.
const jwt = createJwtService({ secret: process.env.JWT_SECRET!, accessExpiresIn: "15m" });
const payload = await jwt.verifyAccessToken(token);
```

Chaque groupe de routes renseigne lui-même `c.var.services`. Une route extérieure aux
groupes qui utilise `requireAuth`, `requireScope` ou un autre garde de
`@rebasepro/server` l'y lit, et se rabat sur le défaut du processus lorsqu'il n'est
pas défini.

## Arrêt

<span class="since-badge" data-since="0.25">Depuis 0.25</span> Un backend issu de
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

## Intégrer le driver Postgres dans Express

Un cran plus bas encore, `@rebasepro/server-postgres` fonctionne sans le serveur
Rebase du tout. Il dépend de Drizzle et du `http.Server` de Node, de sorte que vous
pouvez ouvrir le driver de données et le socket temps réel dans Express, Fastify ou du
simple Node. À ce niveau, vous assemblez vous-même le backend : il n'y a ni routes
d'authentification, ni stockage, ni API d'administration, sauf si vous les construisez.

### 1. Installation

```bash
npm install @rebasepro/server-postgres @rebasepro/types express pg
```

### 2. Ouvrir le driver et le socket

<span class="since-badge" data-since="0.25">Depuis 0.25</span> `openPostgresDriver`
et `postgresDriverConfigFromEnv` sont exportés. Sur la 0.24, ouvrez le driver avec
`createPostgresBootstrapper(pgConfig).initializeDriver(…)`, dont `internals` n'est pas
typé.

```typescript
import express from "express";
import { createServer } from "node:http";
import { sql } from "drizzle-orm";
import {
    createPostgresDatabaseConnection,
    createPostgresWebSocket,
    openPostgresDriver,
    postgresDriverConfigFromEnv
} from "@rebasepro/server-postgres";
import { collections } from "./collections";

async function startServer() {
    const app = express();

    // The socket needs the raw http.Server, so listen on it, not on app.listen.
    // 64 KB of headers, as the Rebase runtime takes: a vector search in the URL
    // outgrows Node's 16 KB.
    const server = createServer({ maxHeaderSize: 64 * 1024 }, app);

    const { db, pool, connectionString } = createPostgresDatabaseConnection(process.env.DATABASE_URL!);

    // The environment, read the way the Rebase server's boot reads it:
    // DATABASE_READ_URL, DATABASE_DIRECT_URL and the REALTIME_* variables.
    // Leave this call out and the driver reads no environment variable at all.
    const pgConfig = postgresDriverConfigFromEnv({ connection: db, connectionString });

    // `provision: false` if the schema is applied elsewhere (`rebase db push`).
    const { driver, internals } = await openPostgresDriver(pgConfig, { collections });

    // The realtime socket. It answers upgrades on `path` only, so a WebSocket
    // server of your own can share the same http.Server.
    createPostgresWebSocket(
        server,
        internals.realtimeService,
        internals.driver,
        { requireAuth: true, jwtSecret: process.env.JWT_SECRET },
        undefined,
        { path: "/" }
    );

    app.use(express.json());

    app.get("/api/health", (req, res) => {
        res.json({ status: "healthy" });
    });

    // A write through the driver
    app.post("/api/products", async (req, res) => {
        try {
            const result = await driver.save({
                path: "products",
                values: req.body,
                status: "new"   // required: "new" | "existing" | "copy"
            });
            res.status(201).json({ success: true, data: result });
        } catch (error) {
            res.status(500).json({ error: error instanceof Error ? error.message : "Internal Server Error" });
        }
    });

    // Drizzle directly, typed: `internals.db`, and `internals.readDb` when a
    // read replica is configured.
    app.get("/api/stats", async (req, res) => {
        const result = await internals.db.execute(sql`select count(*) from products`);
        res.json(result.rows);
    });

    const port = process.env.PORT || 3000;
    server.listen(port);

    // Graceful shutdown: stop listening, stop the LISTEN client, evict branch
    // pools, then end the main pool.
    const handleShutdown = (signal: string) => {
        console.log(`Shutdown triggered via ${signal}.`);
        server.close(async () => {
            try {
                await internals.realtimeService.stopListening();
                await internals.poolManager?.shutdown();
                await pool.end();
                process.exit(0);
            } catch (err) {
                console.error("Error during graceful shutdown:", err);
                process.exit(1);
            }
        });
    };

    process.on("SIGTERM", () => handleShutdown("SIGTERM"));
    process.on("SIGINT", () => handleShutdown("SIGINT"));
}

startServer();
```

`openPostgresDriver` est ce que `createPostgresAdapter` exécute au démarrage du serveur
Rebase, une fois que `postgresDriverConfigFromEnv` a lu l'environnement dans la
configuration. Son second argument dit quoi ouvrir : les `collections`, si l'ouverture
peut modifier la base de données (`provision`, `true` par défaut), et la part que ce
processus prend au temps réel (`realtime: false` pour aucune).

---

## Concepts clés du backend

### Connexions aux répliques de lecture (Read Replicas)
Définissez `readConnectionString` dans la configuration du driver, ou la variable d'environnement `DATABASE_READ_URL`, que le démarrage du serveur et `postgresDriverConfigFromEnv` y lisent, et le driver ouvre un second pool de connexions vers votre réplique de lecture, sous `internals.readDb`. Les lectures vont à la réplique ; les écritures restent sur le primaire.

<span class="since-badge" data-since="0.25">Depuis 0.25</span> L'option `readConnectionString` est prise en compte. Sur la 0.24, elle était déclarée et ignorée, et seul `DATABASE_READ_URL` fonctionnait.

### Intégration de Drizzle
Vous n'avez pas à choisir entre Rebase et Drizzle. Le driver compile vos schémas de manière dynamique, et `internals.db` est le client Drizzle `NodePgDatabase`, typé, pour du SQL brut ou les constructeurs Drizzle typés aux côtés des services REST de Rebase.

### Vidange propre des connexions (Graceful Connection Draining)
Dans les environnements serverless ou les orchestrateurs (comme Kubernetes), la terminaison de pods peut entraîner des connexions interrompues. Implémentez toujours des gestionnaires de signaux qui appellent `internals.realtimeService.stopListening()` (ce qui met fin au client pg LISTEN dédié) et `pool.end()` afin d'éviter la fuite d'emplacements de connexion sur votre serveur de base de données.

### CORS pour un frontend navigateur
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

<span class="since-badge" data-since="0.25">Depuis 0.25</span> `CORS_EXPOSED_HEADERS` est la liste que le runtime expose lui-même : un en-tête que
le SDK se met à lire dans une version ultérieure parvient ainsi à votre frontend sans
modification ici. Elle contient `ETag`, `Retry-After`, `X-Request-ID`, les trois
en-têtes `X-RateLimit-*` et `Preference-Applied`, plus `Location`,
`Upload-Offset` et `Rebase-Upload-Result`, dans lesquels répond un téléversement
reprenable (fichiers de plus de 8 MiB). Sans ces trois-là, le SDK ne peut pas suivre un
téléversement depuis une autre origine et envoie chaque fichier en une seule requête
multipart. Sur la 0.24, écrivez la liste à la main.

Le runtime Rebase et le backend éjecté envoient déjà cette liste. Sur la 0.23
ils n'exposent aucun de ces en-têtes, si bien qu'un frontend sur une autre origine ne lit aucun `ETag`.

## Liens connexes

- [Scripts et console](/docs/backend/scripts/) — les données du projet depuis un script, un test ou un REPL, sans serveur
- [Backend Overview](/docs/backend/) — où réside chaque option lorsque le runtime démarre à la place
- [Split Processes](/docs/deployment/split-processes/) — les rôles qu'un serveur personnalisé doit reproduire
- [Storage Configuration](/docs/backend/storage/) — les sources qu'un serveur personnalisé doit résoudre lui-même
