---
sourceHash: 0360050a2596e8b1
title: Integración de servidor personalizado
sidebar_label: Servidor personalizado
description: Construye el backend de Rebase a partir de piezas públicas en tu propio servidor — createRebaseBackend, sus grupos de rutas, mount, attachRealtime y start — o integra el driver de Postgres en Express.
---

# Integración de servidor personalizado

`initializeRebaseBackend` es un atajo. Construye todo el backend, lo monta en tu app
de Hono bajo `/api`, adjunta el socket de realtime a tu servidor HTTP e inicia el
trabajo en segundo plano, todo en una sola llamada. Cuando eso es lo que quieres,
úsala.

Cuando no lo es, baja un paso. Cada parte de esa llamada es una pieza pública a la
que puedes llamar tú mismo: construye el backend y luego monta todo o solo los
grupos de rutas que quieras, en las rutas que quieras, y decide qué proceso inicia
los temporizadores. La última sección va un paso más allá e integra el driver de
Postgres por sí solo en una app de Express.

## Configuración del entorno

Rebase proporciona una utilidad centralizada `loadEnv()` en `@rebasepro/server` que valida tus variables de entorno contra un esquema estricto de Zod. Invócala **después** de cargar tu archivo `.env`:

```typescript
import dotenv from "dotenv";
import { loadEnv } from "@rebasepro/server";

// `rebase dev` and `rebase start` name the project's .env in DOTENV_CONFIG_PATH.
// Unset, dotenv reads `.env` in the working directory.
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH, quiet: true });

export const env = loadEnv();
```

Para añadir tus propias variables tipadas, amplía el esquema:

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

Importar `z` desde `@rebasepro/server` es una novedad. En la versión 0.17 y anteriores, el paquete no exportaba ningún `z`: impórtalo desde `zod`, haciendo coincidir la versión principal (major) que utiliza el runtime, y deja que tu empaquetador elimine duplicados entre las dos copias.

:::caution[El `z` con el que extiendes debe ser el zod del runtime]
Cargar dos copias de zod a la vez es la única forma en que esta llamada falla, y solía fallar silenciosamente. `.merge()` acepta un esquema de la otra copia —las estructuras son idénticas— y luego `.parse()` rechaza cada campo que tenga un `.default()`, porque un valor por defecto se reconoce por la identidad de la clase. El servidor se iniciaba, reportaba éxito y no ejecutaba ninguno de sus crons; nada en el fallo mencionaba zod.

El runtime proporciona `zod`. El `backend/package.json` del scaffold lo lista en el rango que usa `@rebasepro/server`, así que se instala una sola copia: mantén ambos iguales. Ahora `loadEnv` rechaza un esquema externo durante el arranque con un mensaje que indica la solución, en lugar de aceptarlo y validar solo la mitad de él.
:::

**Comportamientos clave:**
- Genera `JWT_SECRET` y `REBASE_SERVICE_KEY` en desarrollo cuando no están definidos, para que puedas comenzar sin configuración manual, y los guarda en caché en `.rebase-dev-secrets.json` para que un reinicio no cierre la sesión de nadie.
- Bloquea los secretos generados automáticamente en producción; debes definirlos explícitamente.
- Valida que `CORS_ORIGINS` o `FRONTEND_URL` estén configurados en producción.
- Rechaza un esquema `extend` creado por una copia diferente de zod.
- Lanza un `Error` que nombra cada variable que falta o es incorrecta, como `DATABASE_URL: is required`, con los issues de zod en su propiedad `issues`. <span class="since-badge" data-since="0.25">Desde 0.25</span> En la 0.24 lanza el propio `ZodError` de zod, que no nombra ninguna variable cuando nada lo captura.

Consulta `.env.example` en la aplicación generada para ver la lista completa de variables admitidas.

## Un paso por debajo de `initializeRebaseBackend`

<span class="since-badge" data-since="0.25">Desde 0.25</span> En la 0.24,
`initializeRebaseBackend` es la única vía de entrada, y ninguna de las piezas
siguientes se exporta.

`initializeRebaseBackend` son estas llamadas, y nada más:

```typescript
import { createRebaseBackend, installUnhandledRejectionHandler, setDefaultBackend } from "@rebasepro/server";

installUnhandledRejectionHandler();
const backend = await createRebaseBackend({ ...options, provision: true });
setDefaultBackend(backend);
backend.mount(app, { basePath: "/api" });
await backend.attachRealtime(server);
backend.start();
```

El `shutdown()` que devuelve también cierra el servidor que se le dio. Aquí está
lo mismo escrito por completo como el `backend/src/index.ts` de un proyecto, listo
para cambiar. `rebase dev` ejecuta ese archivo cuando un proyecto lo tiene, en lugar
del arranque propio del runtime. Pegado en un proyecto scaffold, sirve lo que
servía el runtime: la API en el puerto que eligió `rebase dev`, el inicio de sesión
y el registro con la colección de usuarios del proyecto, las funciones de
`backend/functions/`, los trabajos cron de `backend/crons/`, los buckets declarados
en `config/resources.ts` y el CORS que el panel de administración necesita en su
propio puerto.

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

Las rutas son las del scaffold. El archivo depende de lo que fija `rebase dev`: el
puerto que eligió en `PORT`, la base de datos gestionada en `DATABASE_URL` y el
`.env` del proyecto en `DOTENV_CONFIG_PATH`. `loadEnv()` valida lo que eso contiene
y genera `JWT_SECRET` en desarrollo cuando no está definido. Si escuchas en otro
puerto, el panel de administración no puede llegar al servidor; si omites
`loadEnv()` y no hay `JWT_SECRET`, el inicio de sesión queda desactivado.
`rebase dev` también espera la línea `Server running at http://localhost:<port>`
antes de informar de que el backend está en marcha. Las opciones de `auth` son las
del scaffold; el runtime también lee los proveedores OAuth, el correo y las demás
variables `AUTH_*`, así que pasa las que uses, como describe
[Autenticación](/docs/backend/authentication/). Tampoco sirve el archivo el panel de
administración compilado en producción: lo hace el punto de entrada que escribe
[`rebase eject`](/docs/cli/), con `serveSPA`, y abre una conexión por cada base de
datos declarada en `config/resources.ts`.

`createRebaseBackend` recibe las mismas opciones que `initializeRebaseBackend`,
sin `app`, `server` ni `basePath`, y con `provision` obligatorio. Lo construye
todo: abre la base de datos, configura la autenticación y el almacenamiento,
carga las funciones y los trabajos cron, y construye cada grupo de rutas y el
cliente en el proceso. No monta nada, no inicia ningún temporizador y no añade
ningún listener al proceso. Cada una de las demás es una llamada que haces tú, o
dejas fuera:

| Llamada | Qué hace | Si la omites |
|---|---|---|
| `installUnhandledRejectionHandler()` | Escribe en el registro un rechazo de promesa que nadie manejó, como una llamada sin esperar su resultado (fire-and-forget) en una función personalizada, en lugar de dejar que Node termine el proceso. Afecta a todo el proceso, así que es decisión del proceso, no de un backend. Devuelve una función que lo desinstala, o `undefined` cuando ya había uno instalado o `REBASE_EXIT_ON_UNHANDLED_REJECTION` está definida. | un rechazo no manejado termina el proceso, el comportamiento por defecto de Node |
| `setDefaultBackend(backend)` | Hace de este backend el [valor por defecto del proceso](#varios-backends-en-un-mismo-proceso): aquel por el que responden `import { rebase }` y el resto de la API a nivel de módulo fuera de las solicitudes, las ejecuciones de cron y los trabajos que sirve un backend | esa API no tiene ningún backend por el que responder ahí |
| `backend.mount(app, { basePath })` | Cada grupo de rutas bajo `basePath` (por defecto `/api`), detrás del middleware de todo el proceso: ids de solicitud, el límite del cuerpo, la compresión, CSRF, el registro de solicitudes y la envoltura JSON para errores y rutas desconocidas. También el documento JWKS, el servidor MCP, la documentación OpenAPI y los alias de rutas heredados. | no se sirve nada por HTTP; `backend.rebase` y `backend.fetch` siguen funcionando |
| `backend.attachRealtime(server, { path })` | El socket de realtime, en `server`, que responde a los upgrades solo en `path` | no hay consultas en vivo |
| `backend.start()` | El programador de crons, los workers de trabajos, los barridos de tokens caducados y de retención del historial, el muestreador de métricas y la auditoría RLS programada, cada uno donde `ownership` se lo asigna a este proceso. Se puede llamar dos veces sin problema. | ninguno se ejecuta, que es lo que quiere un proceso que sirve solicitudes en un [despliegue dividido](/docs/deployment/split-processes/) |
| `backend.shutdown(timeoutMs, { server })` | Detiene lo que iniciaron `start()` y `attachRealtime()`, esperando a las ejecuciones de cron y los trabajos en curso. Cierra `server` solo cuando se lo pasas. | |

El `path` por defecto del socket es la ruta base que se pasa a `mount()` sin un
`/api` final, así que `/api` da `/` y `/x/api` da `/x`. Ahí es donde se conecta el
SDK, porque se conecta a su `baseUrl` mientras que sus solicitudes HTTP van a
`${baseUrl}/api`. Un upgrade a cualquier otra ruta se deja a los demás listeners de
`upgrade` del servidor, así que tu app puede ejecutar su propio servidor WebSocket
en el mismo `http.Server`.

### Qué puede cambiar crear un backend: `provision`

<span class="since-badge" data-since="0.25">Desde 0.25</span>

Crear un backend puede ejecutar DDL, así que `createRebaseBackend` te pide que lo
decidas:

| `provision` | Crea | Para |
|---|---|---|
| `true` | Todo lo que sirve el backend: las tablas de las colecciones y sus políticas RLS, la captura de cambios para realtime, el rol con el que se ejecutan las solicitudes y las tablas propias del framework (claves de API, ejecuciones de cron, trabajos, métricas). | un despliegue de un solo proceso; lo que pasa `initializeRebaseBackend` |
| `false` | Nada. El esquema ya debe existir, aplicado por `rebase db push`, una migración u otro proceso. Una tabla que falta falla cuando se usa. | un script, una prueba, un REPL, un proceso que solo lee |
| `{ collections: false, realtime: false }` | Las tablas del framework y el rol, pero no el esquema de las colecciones ni la captura de cambios. | un proceso que no es dueño del esquema en un despliegue dividido |

Es una opción y no un paso posterior a propósito. El driver lee las tablas al
abrirse y adjunta la captura de cambios a las que existen en ese momento. Un
`provision()` llamado después se ejecutaría cuando el driver ya habría decidido
qué existe. `REBASE_MIGRATE_ON_BOOT=none` sigue desactivando el esquema de las
colecciones para cualquier backend del proceso.

## Montar solo los grupos que quieras

<span class="since-badge" data-since="0.25">Desde 0.25</span>

`backend.routes` contiene los grupos de rutas. Cada uno es una sub-app de Hono que
puedes montar por separado, en cualquier ruta:

```typescript
import { Hono } from "hono";
import { createRebaseBackend, type HonoEnv } from "@rebasepro/server";

const app = new Hono<HonoEnv>();
const backend = await createRebaseBackend({ database: adapter, auth, collections, functions, provision: true });

app.route("/v2/data", backend.routes.data());      // the data API, at a path of your own
app.route("/hooks", backend.routes.functions());   // getUser(c) and getDriver(c) work inside
```

`collections` es el array que exporta el `config/collections/index.ts` de un scaffold. Lleva las `defaultSecurityRules` de ese índice, igual que `collectionsDir`, así que el backend aprovisiona las políticas que aprovisionaría `rebase db push`. Un array propio lleva solo las reglas que declaran sus colecciones, y `provision: true` deja solo para administradores una que no declara ninguna, eliminando las políticas que Rebase generó antes para ella, en todos los servidores que comparten la base de datos.

<span class="since-badge" data-since="0.25">Desde 0.25</span> El índice del scaffold aplica los valores por defecto a su array. En un proyecto generado con la 0.24, copia ese bucle del `config/collections/index.ts` de un scaffold nuevo, o pasa `collectionsDir`.

| Grupo | Normalmente en | Sirve |
|---|---|---|
| `routes.auth()` | `/api/auth` | inicio de sesión, sesiones, OAuth, restablecimiento de contraseña, `GET /config`, las claves de API propias de quien llama y el catálogo de scopes |
| `routes.data()` | `/api/data` | las rutas REST de las colecciones y su historial |
| `routes.storage()` | `/api/storage` | el almacenamiento de archivos, o el router que responde `STORAGE_NOT_CONFIGURED` |
| `routes.functions()` | `/api/functions` | tus [funciones personalizadas](/docs/backend/custom-functions/), o el reenviador al proceso que las sirve |
| `routes.admin()` | `/api/admin` | usuarios y roles, claves de servicio, edición del esquema, mantenimiento del almacenamiento, copias de seguridad, la auditoría RLS, la exportación SQL, el buzón de desarrollo y los registros |
| `routes.cron()` | `/api/admin/cron` | la superficie de administración de cron |
| `routes.meta()` | `/api/meta` | el contrato del proyecto que lee un SDK generado |

Cada grupo lleva el middleware que necesita: el contexto de autenticación que pone
el `user`, el `driver` y los `scopes` de quien llama en la solicitud, sus límites de
tasa y su control de acceso de administración. Por eso responde igual dondequiera
que se monte, también bajo una ruta parametrizada como `/:tenant/data`. Un grupo
también lee dónde se montó, así que la API de datos sigue enrutando cada colección a
su fuente de datos y el listado de funciones nombra las rutas en las que realmente
se sirve.

Lo que un grupo no lleva es el middleware de todo el proceso que `mount()` pone
delante de todo. Al montar los grupos uno por uno, añade tú lo que quieras de él: un
límite del cuerpo (`bodyLimit` de `hono/body-limit`), compresión y la envoltura JSON
de errores:

```typescript
import { errorHandler } from "@rebasepro/server";

app.onError(errorHandler);
```

Cada llamada devuelve un router nuevo sobre los mismos handlers, así que puedes
montar un grupo en dos sitios. Pedir un grupo cuya superficie se desactivó al crear
este backend (`surfaces: { data: false }`) lanza un error, porque el backend nunca
lo construyó. La documentación OpenAPI y el servidor MCP no tienen grupo: describen
las URLs de la disposición de `mount()`, así que solo `mount()` los sirve.

## El backend sin servidor

<span class="since-badge" data-since="0.25">Desde 0.25</span>

Un backend ya construido se puede usar sin montar nada. `backend.rebase` es su
cliente en el proceso, y `backend.fetch(request)` responde a un `Request` como lo
haría `mount()` en `/api`:

```typescript
const backend = await createRebaseBackend({ database: adapter, collections, provision: false });

const { data } = await backend.rebase.dataAsAdmin.posts.find({ limit: 5 });
const res = await backend.fetch(new Request("http://local/api/meta/schema-version"));

await backend.shutdown();
```

Las llamadas del plano de control de ese cliente (`rebase.auth`, `rebase.admin`,
`rebase.functions` y `rebase.cron`) llegan a las rutas del propio backend dentro del
proceso. Funcionan dondequiera que hayas montado los grupos, o aunque no los hayas
montado, y el middleware que añadiste a tu propia app no se ejecuta en ellas.

Para un script que solo necesita los datos, [`openRebase`](/docs/backend/scripts/)
abre la base de datos sin construir ningún backend.

## Varios backends en un mismo proceso

<span class="since-badge" data-since="0.25">Desde 0.25</span> En la 0.24 la
configuración JWT, el modelo de acceso, el almacén de claves de API, el almacén de
límites de tasa y `rebase` son globales del proceso, y el último backend construido
se queda con todos.

`createRebaseBackend` no escribe ningún global del proceso. Cada backend guarda su
propio estado en `backend.services`, así que dos en un mismo proceso siguen siendo
dos: cada uno firma y verifica sesiones con sus propias claves, juzga los scopes por
sus propios roles, comprueba las claves de API en su propio almacén y cuenta los
límites de tasa en su propio almacén.

```typescript
const a = await createRebaseBackend({ database: adapterA, auth: { jwtSecret: SECRET_A }, collections, provision: true });
const b = await createRebaseBackend({ database: adapterB, auth: { jwtSecret: SECRET_B }, collections, provision: true });

app.route("/a/data", a.routes.data());
app.route("/b/data", b.routes.data());   // a session from `a` is a 401 here
```

| `backend.services` | Qué es |
|---|---|
| `jwt` | El servicio JWT del backend: firma y verifica sesiones, enlaces de descarga y sus demás tokens, y sirve su JWKS |
| `access` | Su modelo de acceso (roles a scopes) y el resolvedor del propietario de una clave personal |
| `apiKeyStore` | Dónde se comprueban sus claves de API |
| `rateLimitStore`, `authLimiters` | Sus contadores de límite de tasa, y los limitadores de sus rutas de autenticación |
| `collections()` | Las colecciones que sirve |
| `topics`, `queues` | Sus runtimes de topics y de colas |

Un backend al que no se le da `auth.jwtSecret`, como uno cuyo `auth` es un
adaptador, no firma nada por sí mismo, así que su `services.jwt` sigue el valor por
defecto del proceso.

**A qué backend responde `rebase`.** Dentro de una solicitud, una ejecución de cron
o un trabajo que sirve un backend, `rebase`, ya se importe de `@rebasepro/server` o
se reciba como `ctx.rebase`, es ese backend, y también lo son el `publish` de un
topic y el `enqueue` de una cola. En cualquier otro lugar (el ámbito del módulo, un
script, una prueba) responden por el **valor por defecto del proceso**, que
establece `setDefaultBackend(backend)` y que `initializeRebaseBackend` fija en su
propio backend. Lo mismo ocurre con el resto de la API a nivel de módulo:
`verifyAccessToken` y los demás helpers de JWT, `getAccessModel`, `verifyCredential`
y `extractUserFromToken`.

Tres piezas funcionan directamente sobre un backend, y una sobre ninguno:

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

Una sesión generada se comprueba como cualquier otra en cada solicitud, así que su
uid tiene que ser un usuario que exista: para un uid sin usuario, la solicitud se
rechaza.

<span class="since-badge" data-since="0.25">Desde 0.25</span> `verifyCredential` llega al mismo veredicto que las rutas: una sesión que su dueño cerró, un uid sin usuario y una cuenta desactivada devuelven null, y los roles son los que la cuenta tiene ahora. Lanza un error cuando no se puede llegar a la base de datos. En la 0.24 solo comprueba la firma, y lee los roles del token.

Cada grupo de rutas establece `c.var.services` por sí mismo. Una ruta fuera de los
grupos que usa `requireAuth`, `requireScope` u otro guard de `@rebasepro/server` lo
lee ahí, y recurre al valor por defecto del proceso cuando no está definido.
`requireScope` juzga a quien identificó `requireAuth`, así que va después de
`requireAuth`: por sí solo rechaza cada solicitud con un 401. Acepta un scope
integrado, o un scope de la aplicación que el backend declara bajo `auth.scopes` en
su colección de usuarios, como en el comentario de arriba.

<span class="since-badge" data-since="0.25">Desde 0.25</span> Un nombre que no es un scope, o uno integrado mal escrito como `data:raed`, lanza un error donde se registra la ruta. Un scope de la aplicación que el backend que responde no declara responde a todos los que llaman, también a un administrador, `500 SCOPE_NOT_DECLARED`. En la 0.24 ambos responden a todos los que llaman `403 SCOPE_MISSING`.

## Apagado

<span class="since-badge" data-since="0.25">Desde 0.25</span> Un backend de
`createRebaseBackend` es nuevo; el resto de esta sección vale también para la 0.24.

Con `initializeRebaseBackend`, entrega el backend al helper integrado en lugar de
escribir un manejador de señales. Drena HTTP, detiene el programador de crons,
desconecta realtime, cierra el pool de SMTP cuando ya nada puede enviar, protege
contra señales repetidas y fuerza la salida si el apagado se bloquea:

```typescript
import { initializeRebaseBackend, installShutdownHandlers } from "@rebasepro/server";

const backend = await initializeRebaseBackend({ app, server, database: adapter, collections });
installShutdownHandlers(backend, { onCleanup: () => pool.end() });
```

**No** lo combines con tu propio `server.close()`: el `shutdown()` de ese backend ya
cierra el servidor que se le dio, y un segundo cierre provoca un bloqueo mutuo
(deadlock). Un backend de `createRebaseBackend` cierra un servidor solo cuando se lo
pasas, `backend.shutdown(timeoutMs, { server })`, como en el ejemplo al principio de
esta página.

## Integrar el driver de Postgres en Express

Un paso más abajo, `@rebasepro/server-postgres` funciona sin el servidor de Rebase.
Depende de Drizzle y del `http.Server` de Node, así que puedes abrir el driver de
datos y el socket de realtime dentro de Express, Fastify o Node puro. En este nivel
ensamblas tú mismo el backend: no hay rutas de autenticación, ni almacenamiento, ni
API de administración a menos que las construyas.

### 1. Instalación

```bash
npm install @rebasepro/server-postgres @rebasepro/types express pg drizzle-orm
```

### 2. Apertura del driver y del socket

<span class="since-badge" data-since="0.25">Desde 0.25</span> `openPostgresDriver`
y `postgresDriverConfigFromEnv` se exportan. En la 0.24, abre el driver con
`createPostgresBootstrapper(pgConfig).initializeDriver(…)`, cuyo `internals` no
tiene tipo.

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

    // The collections' tables must already exist: the driver serves them and never creates them.
    // `provision` (default true) is the rest of its DDL: the role requests run as, branch metadata,
    // channel history and change capture. `provision: false` when none of that may run here.
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

`openPostgresDriver` es lo que ejecuta `createPostgresAdapter` cuando arranca el
servidor de Rebase, después de que `postgresDriverConfigFromEnv` haya leído el
entorno en la configuración. Su segundo argumento dice qué abrir: las `collections`,
si abrir puede ejecutar su propio DDL (`provision`, por defecto `true`) y qué
papel tiene este proceso en realtime (`realtime: false` para ninguno).

No crea ninguna tabla de colección, así que contra una base de datos sin ellas `POST /api/products` responde `500` "Table not found for collection 'products'". Crea las tablas primero. `rebase db push` lo hace desde un proyecto de Rebase cuyo `config/collections` las declara. En este servidor, `await createPostgresAdapter(pgConfig).ensureCollectionSchema?.(collections)` antes de `openPostgresDriver` añade las tablas y columnas que le faltan a la base de datos, como hace el arranque del servidor de Rebase, y no cambia nada de lo que ya existe.

---

## Conceptos clave del backend

### Conexiones de réplica de lectura
Define `readConnectionString` en la configuración del driver, o la variable de entorno `DATABASE_READ_URL`, que el arranque del servidor y `postgresDriverConfigFromEnv` leen en ella, y el driver abre un segundo pool de conexiones contra tu réplica de lectura, bajo `internals.readDb`. Las lecturas van a la réplica; las escrituras se quedan en la principal.

<span class="since-badge" data-since="0.25">Desde 0.25</span> Se respeta la opción `readConnectionString`. En la 0.24 se declaraba y se ignoraba, y solo funcionaba `DATABASE_READ_URL`.

### Integración con Drizzle
No tienes que elegir entre Rebase y Drizzle. El driver compila tus esquemas dinámicamente, y `internals.db` es el cliente `NodePgDatabase` de Drizzle, tipado, para SQL directo o builders de Drizzle con seguridad de tipos junto con los servicios REST de Rebase.

### Drenado ordenado de conexiones
En entornos serverless u orquestadores (como Kubernetes), la finalización de pods puede provocar conexiones interrumpidas. Implementa siempre manejadores de señales que llamen a `internals.realtimeService.stopListening()` (que finaliza el cliente dedicado de pg LISTEN) y `pool.end()`, para no dejar fugas de conexiones en tu servidor de base de datos.

### CORS para un frontend en el navegador
Un servidor personalizado tiene su propia configuración de CORS, y un frontend
en otro origen solo puede leer las cabeceras de respuesta que ese servidor
expone. Expón las que lee el SDK, o `etagOf(row)` será siempre `undefined` ahí
— una escritura con `ifMatch` sale entonces sin `If-Match` — y un 429 pierde su
`Retry-After`:

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

<span class="since-badge" data-since="0.25">Desde 0.25</span> `CORS_EXPOSED_HEADERS` es la lista que expone el propio runtime, así que una
cabecera que el SDK empiece a leer en una versión posterior llega a tu frontend sin
cambiar nada aquí. Son `ETag`, `Retry-After`, `X-Request-ID`, las tres cabeceras
`X-RateLimit-*` y `Preference-Applied`, más `Location`, `Upload-Offset` y
`Rebase-Upload-Result`, con las que responde una subida reanudable (archivos de más de
8 MiB). Sin esas tres, el SDK no puede continuar una subida desde otro origen, y envía
cada archivo como una sola solicitud multipart. En la 0.24, escribe la lista a mano.

El runtime de Rebase y el backend generado por `eject` ya envían esta lista. En la 0.23
no exponen ninguna de estas cabeceras, así que un frontend en otro origen no lee ningún `ETag`.

## Relacionado

- [Scripts y la consola](/docs/backend/scripts/) — los datos del proyecto desde un script, una prueba o un REPL, sin servidor
- [Descripción general del backend](/docs/backend/) — dónde se ubica cada opción cuando el runtime arranca en su lugar
- [Procesos divididos](/docs/deployment/split-processes/) — los roles que un servidor personalizado debe reproducir
- [Configuración de almacenamiento](/docs/backend/storage/) — las fuentes que un servidor personalizado debe resolver por sí mismo
