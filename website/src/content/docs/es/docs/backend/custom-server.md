---
sourceHash: c42fc466c64146e7
title: Integración de servidor personalizado
sidebar_label: Servidor personalizado
description: Construye el backend de Rebase a partir de piezas públicas en tu propio servidor — createRebaseBackend, sus grupos de rutas, mount, attachRealtime y start — o integra el controlador de Postgres en Express.
---

# Integración de servidor personalizado

`initializeRebaseBackend` es un atajo. Construye todo el backend, lo monta
en tu aplicación Hono bajo `/api`, conecta el socket de tiempo real a tu servidor
HTTP e inicia las tareas en segundo plano, en una sola llamada. Cuando eso sea lo que buscas,
úsalo.

Cuando no sea así, baja un nivel. Cada parte de esa llamada es una pieza pública
que puedes invocar tú mismo: construye el backend, luego monta todo o solo los
grupos de rutas que quieras, en las rutas que desees, y decide qué proceso inicia
los temporizadores. [Integración del controlador de Postgres](/docs/backend/embedding-postgres-driver/)
va un paso más allá y abre únicamente el controlador de Postgres en una aplicación Express.

## Configuración del entorno

Rebase proporciona una utilidad centralizada `loadEnv()` en `@rebasepro/server` que valida tus variables de entorno contra un esquema estricto de Zod. Invócala **después** de cargar tu archivo `.env`:

```typescript
import dotenv from "dotenv";
import { loadEnv } from "@rebasepro/server";

// `rebase dev` y `rebase start` nombran el .env del proyecto en DOTENV_CONFIG_PATH.
// Si no está establecido, dotenv lee `.env` en el directorio de trabajo.
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH, quiet: true });

export const env = loadEnv();
```

Para añadir tus propias variables tipadas, extiende el esquema:

```typescript
import { loadEnv, z } from "@rebasepro/server";

export const env = loadEnv({
    extend: z.object({
        SMTP_HOST: z.string().optional(),
        SMTP_PORT: z.string().default("587").transform(Number),
        STRIPE_SECRET_KEY: z.string(),
    })
});
// env.SMTP_HOST  → string | undefined  (totalmente tipado)
// env.STRIPE_SECRET_KEY → string        (validado, requerido)
```

:::caution[Dos copias de zod]
Tener dos copias de zod cargadas al mismo tiempo solía romper esta llamada silenciosamente. `loadEnv`
combinaba los esquemas con `.merge()`, el cual acepta un esquema de la otra copia
y luego rechaza cada campo que contenga un `.default()`. El servidor se iniciaba,
reportaba éxito y no ejecutaba ninguno de sus cron jobs; nada en el fallo mencionaba
zod.

`loadEnv` ahora valida el esquema base y tu esquema `extend` cada uno con su
propio `.parse()`, de modo que un esquema construido por otra copia de zod funciona. El runtime
proporciona `zod`, y el `backend/package.json` del scaffold lo lista en el rango
que usa `@rebasepro/server`, por lo que se instala una sola copia: mantén ambas versiones iguales.
:::

**Comportamientos clave:**
- Genera `JWT_SECRET` y `REBASE_SERVICE_KEY` en desarrollo cuando no están establecidos, para que puedas comenzar sin configuración manual, y los almacena en caché en `.rebase-dev-secrets.json` para que un reinicio no cierre la sesión de nadie.
- Bloquea los secretos autogenerados en producción — debes establecerlos explícitamente.
- Valida que `CORS_ORIGINS` o `FRONTEND_URL` esté establecido en producción.
- Rechaza un valor de `extend` que no sea un esquema de zod.
- Lanza un `Error` nombrando cada variable que falte o sea incorrecta, como `DATABASE_URL: is required`, con los issues de zod en su propiedad `issues`.

Consulta `.env.example` en la aplicación generada por el scaffold para ver la lista completa de variables soportadas.

## Un paso por debajo de `initializeRebaseBackend`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`initializeRebaseBackend` consiste en estas llamadas, y nada más:

```typescript
import { createRebaseBackend, installUnhandledRejectionHandler, setDefaultBackend } from "@rebasepro/server";

installUnhandledRejectionHandler();
const backend = await createRebaseBackend({
    ...options,
    // `false` o `{ collections: false, realtime: false }` en los casos
    // que enumera la sección `provision` más abajo.
    provision: true
});
setDefaultBackend(backend);
backend.mount(app, { basePath: "/api" });
await backend.attachRealtime(server);
backend.start();
```

El `shutdown()` que devuelve también cierra el servidor que se le proporcionó. Aquí está
lo mismo escrito como el `backend/src/index.ts` de un proyecto, listo para ser modificado.
`rebase dev` ejecuta ese archivo cuando un proyecto dispone de uno, en lugar del propio
arranque del runtime. Pegado en un proyecto generado mediante scaffold, sirve lo que servía el runtime:
la API en el puerto que eligió `rebase dev`, inicio de sesión y registro con la
tabla de autenticación del proyecto, las tablas que exporta `backend/schema/index.ts`, los
hooks globales en `backend/hooks.ts`, las funciones en `backend/functions/`, los cron jobs
en `backend/crons/`, los buckets declarados en `backend/resources.ts`, y el CORS
que el panel de administración necesita en su propio puerto.

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

Las rutas son las del scaffold; omite la importación y la opción `hooks` cuando el
proyecto no tenga un `backend/hooks.ts`. Los usuarios se almacenan en la tabla que
`backend/schema` declara con `defineAuthTable`, por lo que `auth` no define ninguna tabla por nombre.
El archivo se basa en lo que establece `rebase dev`: el
puerto que eligió en `PORT`, la base de datos administrada en `DATABASE_URL`, y el
`.env` del proyecto en `DOTENV_CONFIG_PATH`. `loadEnv()` valida lo que contiene,
y genera `JWT_SECRET` en desarrollo cuando no está establecido. Escucha en
otro puerto y el panel de administración no podrá comunicarse con el servidor; omite `loadEnv()` y,
al no haber `JWT_SECRET`, el inicio de sesión estará desactivado.
`rebase dev` también espera a la línea `Server running at http://localhost:<port>`
antes de reportar que el backend está listo. Las opciones de `auth` son las del scaffold; el
runtime también lee los proveedores de OAuth, el correo electrónico y las demás variables `AUTH_*`,
así que pasa las que utilices, tal como describe [Autenticación](/docs/backend/authentication/).
El archivo tampoco sirve el panel de administración compilado en producción: el
punto de entrada que genera [`rebase eject`](/docs/cli/) sí lo hace, con `serveSPA`, y abre
una conexión por cada base de datos declarada en `backend/resources.ts`.

`createRebaseBackend` acepta las mismas opciones que `initializeRebaseBackend`,
sin `app`, `server` y `basePath`, y con `provision` como parámetro obligatorio.
Construye todo: abre la base de datos, configura la autenticación y el almacenamiento, carga las
funciones y los cron jobs, y construye cada grupo de rutas y el cliente
en el mismo proceso. No monta nada, no inicia ningún temporizador y no añade ningún listener de proceso. Cada
una de las acciones restantes es una llamada que tú realizas, u omites:

| Llamada | Qué hace | Si la omites |
|---|---|---|
| `installUnhandledRejectionHandler()` | Registra un rechazo de promesa no manejado, como una llamada tipo fire-and-forget en una función personalizada, en lugar de permitir que Node termine el proceso. Aplica a nivel de proceso, por lo que es decisión del proceso, no de un backend. Devuelve una función que lo desinstala, o `undefined` si ya se había instalado uno o si `REBASE_EXIT_ON_UNHANDLED_REJECTION` está establecido. | un rechazo no manejado termina el proceso, el comportamiento por defecto de Node |
| `setDefaultBackend(backend)` | Convierte este backend en el [predeterminado del proceso](#varios-backends-en-un-proceso): lo que `import { rebase }` y el resto de la API a nivel de módulo responden fuera de las peticiones, ejecuciones de cron y trabajos que sirve un backend | esa API no tiene ningún backend al que responder allí |
| `backend.mount(app, { basePath })` | Cada grupo de rutas bajo `basePath` (por defecto `/api`), detrás del middleware para todo el proceso: identificadores de petición, límite del cuerpo, compresión, CSRF, registro de peticiones y la envoltura JSON para errores y rutas desconocidas. También el documento JWKS, el servidor MCP, la documentación OpenAPI y los alias de rutas heredadas. | no se sirve nada a través de HTTP; `backend.rebase` y `backend.fetch` siguen funcionando |
| `backend.attachRealtime(server, { path })` | El socket en tiempo real, en `server`, respondiendo únicamente a las actualizaciones (upgrades) en `path` | no hay consultas en vivo (live queries) |
| `backend.start()` | El programador de cron, los workers de tareas, las limpiezas periódicas de tokens expirados y retención de historial, el muestreador de métricas y la auditoría programada de RLS, cada uno donde `ownership` lo asigne a este proceso. Es seguro llamarlo dos veces. | ninguno de ellos se ejecuta, que es lo que busca un proceso que sirve peticiones en un [despliegue dividido](/docs/deployment/split-processes/) |
| `backend.shutdown(timeoutMs, { server })` | Detiene lo que iniciaron `start()` y `attachRealtime()`, esperando a que finalicen las ejecuciones de cron y los trabajos en curso. Cierra `server` solo cuando se lo pasas. | |

El `path` por defecto del socket es la ruta base proporcionada a `mount()` eliminando
`/api` al final, de modo que `/api` da `/` y `/x/api` da `/x`; una ruta base que
no termine en `/api` da `/`. Ahí es donde se conecta el
SDK, ya que se conecta a su `baseUrl` mientras que sus peticiones HTTP van a
`${baseUrl}/api`. Una actualización hacia cualquier otra ruta se delega a los otros listeners
de `upgrade` del servidor, por lo que tu aplicación puede ejecutar su propio servidor WebSocket en el mismo
`http.Server`.

### Qué puede cambiar la creación de un backend: `provision`

Crear un backend puede ejecutar DDL, por lo que `createRebaseBackend` te pide que decidas:

| `provision` | Crea | Para |
|---|---|---|
| `true` | Todo lo que sirve el backend: las tablas declaradas y sus políticas RLS, captura de cambios para tiempo real, el rol bajo el que se ejecutan las peticiones y las tablas propias del framework (claves de API, ejecuciones de cron, trabajos, métricas). | un despliegue de un solo proceso; lo que pasa `initializeRebaseBackend` |
| `false` | Nada, ni en el arranque ni más adelante: las tablas que otros backends crean en el primer uso (claves de idempotencia, bloqueos de cron) tampoco se crean. El esquema ya debe existir, aplicado mediante `rebase db push`, una migración u otro proceso. Si faltan tablas de autenticación se rechaza en el arranque; si falta una tabla opcional se desactiva su función, indicándolo en los registros. | un script, una prueba, un REPL, un proceso de solo lectura, una base de datos que solo tu proceso de cambios puede modificar |
| `{ collections: false, realtime: false }` | Las tablas del framework y el rol, pero no el esquema ni la captura de cambios de las tablas declaradas. La clave mantiene su nombre anterior. | un proceso que no es propietario del esquema en un despliegue dividido |

Es una opción deliberada en lugar de un paso posterior. El controlador lee las
tablas a medida que se abre y adjunta la captura de cambios a las que existen en ese momento.
Un `provision()` invocado después se ejecutaría cuando el controlador ya hubiese
determinado qué existe. `REBASE_MIGRATE_ON_BOOT=none` sigue desactivando el esquema
de tablas para cualquier backend en el proceso. `initializeRebaseBackend` pasa
`false` cuando `REBASE_PROVISION=false`.

## Montar solo los grupos que desees

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`backend.routes` contiene los grupos de rutas. Cada uno es una subaplicación de Hono que puedes
montar por separado, en cualquier ruta:

```typescript
import { Hono } from "hono";
import { createRebaseBackend, type HonoEnv } from "@rebasepro/server";

const app = new Hono<HonoEnv>();
const backend = await createRebaseBackend({ database: adapter, auth, tables, defaultRls, functions, provision: true });

app.route("/v2/data", backend.routes.data());      // the data API, at a path of your own
app.route("/hooks", backend.routes.functions());   // getUser(c) and getDriver(c) work inside
```

`tables` es una lista de resultados de `defineTable`, `defineAuthTable` y `defineView` — típicamente todo lo que exporta `backend/schema/index.ts` — y `defaultRls` es lo que toman sus tablas con `rls: "inherit"`, el `defaultRls` que exporta dicho index. Cada tabla se compila cuando se crea el backend, y cualquier problema en alguna de ellas (sin `rls`, `"inherit"` sin `defaultRls`, una relación hacia una tabla que no está en la lista) la rechazará con un `SchemaDefinitionError` detallando cada uno. Pasa `schemaDir` en su lugar para cargar el directorio como lo hace el runtime, incluyendo las exportaciones del index y `defaultRls`; si pasas ambos, `tables` es lo que se sirve mientras que `schemaDir` es donde escribe el editor de esquemas.

```typescript no-verify
import * as schema from "../schema";

const tables = [schema.users, schema.posts];
const defaultRls = schema.defaultRls;
```

| Grupo | Normalmente en | Sirve |
|---|---|---|
| `routes.auth()` | `/api/auth` | inicio de sesión, sesiones, OAuth, restablecimiento de contraseña, `GET /config`, las claves de API del propio llamador y el catálogo de scopes |
| `routes.data()` | `/api/data` | las rutas REST de las tablas y su historial |
| `routes.storage()` | `/api/storage` | almacenamiento de archivos, o el router que responde `STORAGE_NOT_CONFIGURED` |
| `routes.functions()` | `/api/functions` | tus [funciones personalizadas](/docs/backend/custom-functions/), o el reenviador al proceso que las sirve |
| `routes.admin()` | `/api/admin` | usuarios y roles, claves de servicio, edición de esquemas, mantenimiento de almacenamiento, copias de seguridad, auditoría de RLS, exportación SQL, el buzón de correo de desarrollo y los registros |
| `routes.cron()` | `/api/admin/cron` | la interfaz de administración de cron |
| `routes.meta()` | `/api/meta` | el contrato del proyecto que lee un SDK generado |
| `routes.schema()` | `/api/schema` | `GET /tables`: los descriptores de tabla a partir de los cuales renderizan el CMS y el Studio — consulta [Endpoints](/docs/backend/endpoints/#schema) |

Cada grupo incluye el middleware que necesita: el contexto de autenticación que sitúa el
`user`, `driver` y `scopes` del llamador en la petición, sus límites de tasa (rate limits) y su
control de acceso de administrador. Por lo tanto, responde de la misma manera dondequiera que se monte, incluso bajo una
ruta parametrizada como `/:tenant/data`. Un grupo también detecta dónde fue
montado, de modo que la API de datos sigue enrutando cada tabla a su base de datos y
el listado de funciones indica las rutas en las que realmente se sirve.

Un grupo también rechaza `x-rebase-impersonate` y `x-rebase-simulate-*` por sí mismo
(`400 IMPERSONATION_UNSUPPORTED` / `SIMULATION_UNSUPPORTED`), a menos que sea el
grupo de datos o de funciones, que sí los admiten. `refuseUnhonouredImpersonation(honouredMounts)`
de `@rebasepro/server` hace lo mismo para tus propias rutas.

Lo que un grupo no incluye es el middleware global del proceso que `mount()` coloca al
frente de todo. Al montar grupos uno por uno, añade por tu cuenta lo que desees
de este: un límite de cuerpo (`bodyLimit` de `hono/body-limit`), compresión y
la envoltura JSON para errores:

```typescript
import { errorHandler } from "@rebasepro/server";

app.onError(errorHandler);
```

Cada llamada devuelve un nuevo router sobre los mismos manejadores, por lo que puedes montar un grupo en dos lugares. Solicitar un grupo cuya superficie no fue incluida al crear este backend (`surfaces: { data: false }`) lanza un error, porque el backend nunca lo construyó. La documentación OpenAPI y el servidor MCP no tienen grupo: describen las URLs de la estructura de `mount()`, por lo que solo `mount()` los sirve.

## El backend sin un servidor

Un backend que has construido se puede usar sin montar nada.
`backend.rebase` es su cliente dentro del proceso, y `backend.fetch(request)`
responde a una `Request` tal como lo haría `mount()` en `/api`:

```typescript
const backend = await createRebaseBackend({ database: adapter, schemaDir, provision: false });

const { data } = await backend.rebase.dataAsAdmin.posts.find({ limit: 5 });
const res = await backend.fetch(new Request("http://local/api/meta/schema-version"));

await backend.shutdown();
```

Las llamadas del plano de control en ese cliente (`rebase.auth`, `rebase.admin`,
`rebase.functions` y `rebase.cron`) acceden a las rutas propias del backend
dentro del proceso. Funcionan en cualquier lugar donde hayas montado los grupos (o incluso si no los montaste), y
el middleware que agregues a tu propia aplicación no se ejecuta sobre ellas.

Para un script que solo necesita los datos, [`openRebase`](/docs/backend/scripts/)
abre la base de datos sin construir un backend en absoluto.

## Varios backends en un proceso

`createRebaseBackend` no escribe variables globales en el proceso. Cada backend mantiene su propio
estado en `backend.services`, por lo que dos de ellos en un mismo proceso se mantienen independientes: cada uno
firma y verifica sesiones con sus propias claves, evalúa los scopes según sus propios roles,
comprueba las claves de API en su propio almacén y contabiliza los límites de tasa en su propio almacén.

```typescript
const a = await createRebaseBackend({ database: adapterA, auth: { jwtSecret: SECRET_A }, tables, provision: true });
const b = await createRebaseBackend({ database: adapterB, auth: { jwtSecret: SECRET_B }, tables, provision: true });

app.route("/a/data", a.routes.data());
app.route("/b/data", b.routes.data());   // a session from `a` is a 401 here
```

| `backend.services` | Qué es |
|---|---|
| `jwt` | El servicio JWT del backend: firma y verifica sesiones, enlaces de descarga y sus otros tokens, y sirve su JWKS |
| `access` | Su modelo de acceso (roles a scopes) y el resolver para el propietario de una clave personal |
| `apiKeyStore` | Donde se validan sus claves de API |
| `rateLimitStore`, `authLimiters` | Sus contadores de límite de tasa, y los limitadores en sus rutas de autenticación |
| `tables()` | Los descriptores compilados de las tablas que sirve |
| `topics`, `queues` | Sus runtimes de topics y colas (queues) |

Un backend al que no se le asigne `auth.jwtSecret`, como uno cuya `auth` sea un adaptador,
no firma nada propio, por lo que su `services.jwt` sigue el valor predeterminado del proceso.

**Los recursos pertenecen al proceso.** Las declaraciones de `database()`, `bucket()`, `topic()` y
`queue()` en `backend/resources.ts` son valores a nivel de módulo, y
cada backend en el proceso lee todas ellas: un backend cuyo propio proyecto
no declare ningún topic activará de todas formas su cola de trabajos para el topic de otro proyecto,
y rehusará arrancar si su controlador no puede soportarlo. Ejecuta los recursos de un solo
proyecto por proceso. Varios backends de ese mismo proyecto, cada uno en su propia
base de datos, funcionan sin problemas.

**Hacia dónde apunta `rebase`.** Dentro de una petición, una ejecución de cron o un trabajo que sirve
un backend, `rebase`, ya sea importado desde `@rebasepro/server` o recibido como
`ctx.rebase`, es ese backend, al igual que el `publish` de topics y el `enqueue` de colas.
En cualquier otro lugar (ámbito de módulo, un script, un test) responden por el **predeterminado
del proceso**, el cual se define mediante `setDefaultBackend(backend)`, y que
`initializeRebaseBackend` asigna a su propio backend. Lo mismo ocurre con el resto de la
API a nivel de módulo: `verifyAccessToken` y los demás helpers de JWT,
`getAccessModel`, `verifyCredential` y `extractUserFromToken`.

Tres piezas funcionan directamente sobre un backend, y una sin ningún backend:

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

Una sesión generada se valida como cualquier otra en cada petición, por lo que su uid debe corresponder a un usuario existente: para un uid sin usuario, la petición es rechazada.

`verifyCredential` llega a la misma conclusión que las rutas: una sesión en la que su propietario cerró sesión, un uid sin usuario y una cuenta deshabilitada devuelven null, y los roles son los que la cuenta posee actualmente. Lanza un error cuando no se puede alcanzar la base de datos.

Cada grupo de rutas define `c.var.services` por sí mismo. Una ruta fuera de los grupos que utilice `requireAuth`, `requireScope` u otro guard de `@rebasepro/server` lo lee de allí, y recurre al predeterminado del proceso cuando no está definido. `requireScope` evalúa al llamador identificado por `requireAuth`, por lo que va después de `requireAuth`: por sí solo rechaza cualquier petición con un 401. Acepta un scope integrado, o un scope de la aplicación que el backend declare bajo `auth.scopes` en su tabla de autenticación, tal como se muestra en el comentario anterior.

Un nombre que no sea un scope, o uno integrado mal escrito como `data:raed`, lanza un error en el momento en que se registra la ruta. Un scope de aplicación que el backend que responde no declara responderá a cualquier llamador, incluso a un administrador, con `500 SCOPE_NOT_DECLARED`.

## Apagado (Shutdown)

Desde `initializeRebaseBackend`, pasa el backend al helper integrado en lugar
de escribir un manejador de señales manualmente. Este drena el tráfico HTTP, detiene el programador de cron,
desconecta el tiempo real, cierra el pool de SMTP una vez que ya nada pueda enviar mensajes,
protege contra señales repetidas y fuerza la salida si el apagado se bloquea:

```typescript
import { initializeRebaseBackend, installShutdownHandlers } from "@rebasepro/server";

const backend = await initializeRebaseBackend({ app, server, database: adapter, tables });
installShutdownHandlers(backend, { onCleanup: () => pool.end() });
```

**No** lo combines con tu propio `server.close()`: el método `shutdown()` de ese backend
ya cierra el servidor que recibió, y un segundo cierre causará
un interbloqueo (deadlock). Un backend proveniente de `createRebaseBackend` cierra un servidor solo cuando
se lo pasas explícitamente, `backend.shutdown(timeoutMs, { server })`, como en el ejemplo al
inicio de esta página.

## Integrar el controlador de Postgres

Un nivel más abajo, `@rebasepro/server-postgres` funciona sin el servidor
de Rebase en absoluto: abre su controlador de datos y socket de tiempo real dentro de Express, Fastify
o Node puro, y ensambla el resto por tu cuenta. Consulta
[Integración del controlador de Postgres](/docs/backend/embedding-postgres-driver/).

## CORS para un frontend en el navegador

Un servidor personalizado administra su propia configuración de CORS, y un frontend en otro origen
solo puede leer las cabeceras de respuesta que este expone. Expón aquellas que lee el SDK, o de lo
contrario `etagOf(row)` siempre será `undefined` allí — y una escritura con `ifMatch` saldrá
sin `If-Match` — y un error 429 perderá su `Retry-After`:

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

`CORS_EXPOSED_HEADERS` es la lista que el propio runtime expone, de modo que una
cabecera que el SDK comience a leer en una versión posterior llegará a tu frontend sin
necesidad de cambios aquí. Incluye `ETag`, `Retry-After`, `X-Request-ID`, las tres
cabeceras `X-RateLimit-*` y `Preference-Applied`, además de `Location`,
`Upload-Offset` y `Rebase-Upload-Result`, que se devuelven en subidas reanudables (archivos de más
de 8 MiB), y `X-Rebase-Simulated-Context`, que indica bajo qué contexto se ejecutó la petición
simulada de un administrador. Sin las tres cabeceras de subida, el SDK no puede rastrear
una subida desde otro origen y, en su lugar, envía cada archivo como una única petición multipart.

El runtime de Rebase y el backend generado con eject ya envían esta lista.

## Temas relacionados

- [Integración del controlador de Postgres](/docs/backend/embedding-postgres-driver/) — el controlador de datos y el socket de tiempo real por sí solos, en Express
- [Scripts y la Consola](/docs/backend/scripts/) — los datos del proyecto desde un script, una prueba o un REPL, sin un servidor
- [Descripción general del backend](/docs/backend/) — dónde reside cada opción cuando el runtime arranca directamente
- [Procesos divididos](/docs/deployment/split-processes/) — los roles que un servidor personalizado debe reproducir
- [Configuración del almacenamiento](/docs/backend/storage/) — los orígenes que un servidor personalizado debe resolver por sí mismo
