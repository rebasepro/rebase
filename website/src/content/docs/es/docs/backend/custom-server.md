---
sourceHash: 93c74d4bdc0c12ea
title: Integración de servidor personalizado
sidebar_label: Servidor personalizado
description: Construya el backend de Rebase a partir de piezas públicas en su propio servidor — createRebaseBackend, sus grupos de rutas, mount, attachRealtime y start — o embeba el controlador de Postgres en Express.
---

# Integración de servidor personalizado

`initializeRebaseBackend` es un atajo. Construye todo el backend, lo monta
en su aplicación Hono bajo `/api`, conecta el socket de tiempo real a su servidor
HTTP e inicia el trabajo en segundo plano, todo en una sola llamada. Cuando eso es
lo que busca, utilícelo.

Cuando no lo sea, baje un nivel. Cada parte de esa llamada es una pieza pública
que puede invocar usted mismo: construya el backend y luego monte todo o solo los
grupos de rutas que desee, en las rutas que elija, y decida qué proceso inicia
los temporizadores. [Embeber el controlador de Postgres](/docs/backend/embedding-postgres-driver/)
va un paso más allá y abre el controlador de Postgres por sí solo en una aplicación Express.

## Configuración del entorno

Rebase proporciona una utilidad centralizada `loadEnv()` en `@rebasepro/server` que valida sus variables de entorno contra un esquema estricto de Zod. Llámela **después** de cargar su archivo `.env`:

```typescript
import dotenv from "dotenv";
import { loadEnv } from "@rebasepro/server";

// `rebase dev` and `rebase start` name the project's .env in DOTENV_CONFIG_PATH.
// Unset, dotenv reads `.env` in the working directory.
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH, quiet: true });

export const env = loadEnv();
```

Para añadir variables tipadas propias, extienda el esquema:

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

:::caution[Dos copias de zod]
Cargar dos copias de zod al mismo tiempo solía romper esta llamada silenciosamente. `loadEnv`
combinaba los esquemas con `.merge()`, el cual acepta un esquema de la otra copia
y luego rechaza cada campo que contenga un `.default()`. El servidor se iniciaba,
reportaba éxito y no ejecutaba ninguno de sus cron jobs; nada en el fallo mencionaba
a zod.

`loadEnv` ahora valida el esquema base y su esquema de `extend` cada uno con su
propio `.parse()`, de modo que un esquema construido por otra copia de zod funciona. El runtime
proporciona `zod`, y el archivo `backend/package.json` del scaffold lo incluye en el rango
que utiliza `@rebasepro/server`, por lo que se instala una sola copia: mantenga ambas iguales.
:::

**Comportamientos clave:**
- Genera `JWT_SECRET` y `REBASE_SERVICE_KEY` en desarrollo cuando no están definidos, lo que le permite comenzar sin configuración manual, y los almacena en caché en `.rebase-dev-secrets.json` para que un reinicio no cierre la sesión de nadie.
- Bloquea los secretos generados automáticamente en producción; debe definirlos explícitamente.
- Valida que `CORS_ORIGINS` o `FRONTEND_URL` esté configurado en producción.
- Rechaza un valor de `extend` que no sea un esquema de zod.
- Lanza un `Error` nombrando cada variable que falte o sea incorrecta, como `DATABASE_URL: is required`, con los errores de zod en su propiedad `issues`.

Consulte `.env.example` en la aplicación generada para ver la lista completa de variables compatibles.

## Un paso por debajo de `initializeRebaseBackend`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`initializeRebaseBackend` consiste en estas llamadas y nada más:

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

El método `shutdown()` que devuelve también cierra el servidor que se le proporcionó. Aquí está
lo mismo escrito como el archivo `backend/src/index.ts` de un proyecto, listo para ser modificado.
`rebase dev` ejecuta ese archivo cuando el proyecto tiene uno, en lugar del arranque
propio del runtime. Al pegarlo en un proyecto generado por el scaffold, sirve lo que servía el runtime:
la API en el puerto que `rebase dev` eligió, el inicio de sesión y registro con la
tabla de autenticación del proyecto, las tablas que exporta `backend/schema/index.ts`, los
hooks globales en `backend/hooks.ts`, las funciones en `backend/functions/`, los cron jobs
en `backend/crons/`, los buckets declarados en `backend/resources.ts` y el CORS
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

Las rutas son las del scaffold; omita la importación y la opción de `hooks` cuando el
proyecto no tenga un `backend/hooks.ts`. Los usuarios se almacenan en la tabla que
`backend/schema` declara con `defineAuthTable`, por lo que `auth` no especifica ninguna tabla.
El archivo se basa en lo que `rebase dev` establece: el
puerto que eligió en `PORT`, la base de datos gestionada en `DATABASE_URL` y el
archivo `.env` del proyecto en `DOTENV_CONFIG_PATH`. `loadEnv()` valida lo que este
contiene y genera `JWT_SECRET` en desarrollo cuando no está definido. Si escucha en
otro puerto, el panel de administración no podrá comunicarse con el servidor; si omite `loadEnv()` y,
sin `JWT_SECRET`, el inicio de sesión estará deshabilitado.
`rebase dev` también espera la línea `Server running at http://localhost:<port>`
antes de reportar que el backend está listo. Las opciones de `auth` son las del scaffold; el
runtime también lee los proveedores de OAuth, el correo electrónico y las demás variables `AUTH_*`,
así que pase las que utilice, como se describe en [Autenticación](/docs/backend/authentication/).
El archivo tampoco sirve el panel de administración compilado en producción: el
punto de entrada generado por [`rebase eject`](/docs/cli/) sí lo hace, con `serveSPA`, y abre
una conexión por cada base de datos declarada en `backend/resources.ts`.

`createRebaseBackend` acepta las mismas opciones que `initializeRebaseBackend`,
sin `app`, `server` ni `basePath`, y con `provision` obligatorio.
Construye todo: abre la base de datos, configura la autenticación y el almacenamiento, carga las
funciones y los cron jobs, y construye cada grupo de rutas y el cliente
en proceso. No monta nada, no inicia ningún temporizador y no añade ningún listener al proceso. Cada
una de las acciones restantes es una llamada que usted realiza o decide omitir:

| Llamada | Qué hace | Si la omite |
|---|---|---|
| `installUnhandledRejectionHandler()` | Registra en los logs un rechazo de promesa no controlado, como una llamada fire-and-forget en una función personalizada, en lugar de permitir que Node detenga el proceso. Se aplica a todo el proceso, por lo que es decisión del proceso, no del backend. Devuelve una función que lo desinstala, o `undefined` si ya se instaló uno o si `REBASE_EXIT_ON_UNHANDLED_REJECTION` está establecido. | un rechazo no controlado termina el proceso, que es el comportamiento predeterminado de Node |
| `setDefaultBackend(backend)` | Hace que este backend sea el [valor predeterminado del proceso](#varios-backends-en-un-mismo-proceso): a lo que responden `import { rebase }` y el resto de la API a nivel de módulo fuera de las solicitudes, ejecuciones de cron y trabajos que atiende un backend | esa API no tiene ningún backend al que responder en esos contextos |
| `backend.mount(app, { basePath })` | Monta cada grupo de rutas bajo `basePath` (por defecto `/api`), detrás del middleware para todo el proceso: IDs de solicitud, límite de tamaño del cuerpo, compresión, CSRF, registro de solicitudes y la envoltura JSON para errores y rutas desconocidas. También el documento JWKS, el servidor MCP, los documentos de OpenAPI y los alias de rutas heredadas. | no se sirve nada a través de HTTP; `backend.rebase` y `backend.fetch` siguen funcionando |
| `backend.attachRealtime(server, { path })` | Monta el socket de tiempo real en `server`, respondiendo únicamente a las actualizaciones (upgrades) en `path` | no habrá consultas en tiempo real (live queries) |
| `backend.start()` | Inicia el programador de cron, los workers de trabajos, las limpiezas de tokens expirados y de retención de historial, el muestreador de métricas y la auditoría programada de RLS, cada uno donde `ownership` lo asigne a este proceso. Es seguro llamarlo dos veces. | ninguno de ellos se ejecuta, lo cual es lo deseado para un proceso que sirve solicitudes en un [despliegue dividido](/docs/deployment/split-processes/) |
| `backend.shutdown(timeoutMs, { server })` | Detiene lo iniciado por `start()` y `attachRealtime()`, esperando las ejecuciones de cron y los trabajos en curso. Cierra `server` solo cuando se lo pasa como argumento. | |

La ruta (`path`) predeterminada del socket es la ruta base proporcionada a `mount()` sin el
`/api` final, por lo que `/api` resulta en `/` y `/x/api` resulta en `/x`; una ruta base que
no termine en `/api` produce `/`. Ahí es donde el
SDK se conecta, ya que se comunica con su `baseUrl` mientras que sus solicitudes HTTP van a
`${baseUrl}/api`. Una actualización (upgrade) a cualquier otra ruta se deja a los demás listeners
de `upgrade` del servidor, por lo que su aplicación puede ejecutar su propio servidor WebSocket en el mismo
`http.Server`.

### Qué puede modificar la creación de un backend: `provision`

Crear un backend puede ejecutar DDL, por lo que `createRebaseBackend` le pide que decida:

| `provision` | Crea | Destinado a |
|---|---|---|
| `true` | Todo lo que sirve el backend: las tablas declaradas y sus políticas RLS, la captura de cambios para tiempo real, el rol con el que se ejecutan las solicitudes y las tablas propias del framework (claves de API, ejecuciones de cron, trabajos, métricas). | un despliegue de proceso único; lo que pasa `initializeRebaseBackend` |
| `false` | Nada, ni en el arranque ni después: las tablas que otros backends crean en el primer uso (claves de idempotencia, reclamaciones de cron) tampoco se crean. El esquema ya debe estar ahí, aplicado mediante `rebase db push`, una migración u otro proceso. Si faltan tablas de autenticación, se rechaza en el arranque; si falta una tabla opcional, su función se desactiva y se indica en el log. | un script, una prueba, un REPL, un proceso de solo lectura, una base de datos que solo su proceso de cambios puede modificar |
| `{ tables: false, realtime: false }` | Las tablas del framework y el rol, pero no el esquema de las tablas declaradas ni la captura de cambios. | un proceso que no es propietario del esquema en un despliegue dividido |

Es una opción en lugar de un paso posterior de forma deliberada. El controlador lee las
tablas a medida que se abre y vincula la captura de cambios a las que existen en ese momento.
Un `provision()` invocado después se ejecutaría luego de que el controlador ya hubiera
determinado qué existe. `REBASE_MIGRATE_ON_BOOT=none` sigue desactivando el esquema de
tablas para cualquier backend en el proceso. `initializeRebaseBackend` pasa
`false` cuando `REBASE_PROVISION=false`.

## Montar únicamente los grupos que desee

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`backend.routes` contiene los grupos de rutas. Cada uno es una subaplicación de Hono que puede
montar por separado, en cualquier ruta:

```typescript
import { Hono } from "hono";
import { createRebaseBackend, type HonoEnv } from "@rebasepro/server";

const app = new Hono<HonoEnv>();
const backend = await createRebaseBackend({ database: adapter, auth, tables, defaultRls, functions, provision: true });

app.route("/v2/data", backend.routes.data());      // the data API, at a path of your own
app.route("/hooks", backend.routes.functions());   // getUser(c) and getDriver(c) work inside
```

`tables` es una lista de resultados de `defineTable`, `defineAuthTable` y `defineView` —normalmente todo lo que exporta `backend/schema/index.ts`— y `defaultRls` es lo que adoptan sus tablas con `rls: "inherit"`, el `defaultRls` que exporta dicho índice. Cada tabla se compila cuando se crea el backend, y un problema en cualquiera de ellas (sin `rls`, `"inherit"` sin `defaultRls`, una relación con una tabla que no está en la lista) la rechaza con un `SchemaDefinitionError` detallando cada caso. Pase `schemaDir` en su lugar para cargar el directorio tal como lo hace el runtime, incluidas las exportaciones del índice y `defaultRls`; pase ambos y `tables` será lo que se sirva, mientras que `schemaDir` será donde escriba el editor de esquemas.

```typescript no-verify
import * as schema from "../schema";

const tables = [schema.users, schema.posts];
const defaultRls = schema.defaultRls;
```

| Grupo | Normalmente en | Sirve |
|---|---|---|
| `routes.auth()` | `/api/auth` | inicio de sesión, sesiones, OAuth, restablecimiento de contraseña, `GET /config`, las claves de API propias del invocador y el catálogo de alcances (scopes) |
| `routes.data()` | `/api/data` | las rutas REST de las tablas y su historial |
| `routes.storage()` | `/api/storage` | almacenamiento de archivos, o el enrutador que responde `STORAGE_NOT_CONFIGURED` |
| `routes.functions()` | `/api/functions` | sus [funciones personalizadas](/docs/backend/custom-functions/), o el reenviador al proceso que las sirve |
| `routes.admin()` | `/api/admin` | usuarios y roles, claves de servicio, edición de esquemas, mantenimiento de almacenamiento, copias de seguridad, auditoría de RLS, exportación SQL, el buzón de correo de desarrollo y los logs |
| `routes.cron()` | `/api/admin/cron` | la interfaz de administración de cron |
| `routes.meta()` | `/api/meta` | el contrato del proyecto que lee un SDK generado |
| `routes.schema()` | `/api/schema` | `GET /tables`: los descriptores de tabla a partir de los cuales se renderizan el CMS y el Studio — consulte [Endpoints](/docs/backend/endpoints/#schema) |

Cada grupo incluye el middleware que necesita: el contexto de autenticación que sitúa el
`user`, `driver` y `scopes` del solicitante en la petición, sus límites de velocidad y su
control de acceso de administrador. Por lo tanto, responde de la misma manera dondequiera que se monte, incluso
bajo una ruta parametrizada como `/:tenant/data`. Un grupo también identifica dónde fue
montado, de modo que la API de datos sigue enrutando cada tabla a su base de datos y
el listado de funciones indica las rutas en las que realmente se sirve.

Un grupo también rechaza `x-rebase-impersonate` y `x-rebase-simulate-*` por sí mismo
(`400 IMPERSONATION_UNSUPPORTED` / `SIMULATION_UNSUPPORTED`), a menos que sea el grupo
de datos o de funciones, que sí los respetan. `refuseUnhonouredImpersonation(honouredMounts)`
de `@rebasepro/server` hace lo mismo para sus propias rutas.

Lo que un grupo no incluye es el middleware para todo el proceso que `mount()` coloca delante
de todo. Al montar los grupos uno a uno, añada lo que desee por su cuenta:
un límite de tamaño del cuerpo (`bodyLimit` de `hono/body-limit`), compresión y
la envoltura de errores en JSON:

```typescript
import { errorHandler } from "@rebasepro/server";

app.onError(errorHandler);
```

Cada llamada devuelve un enrutador nuevo sobre los mismos controladores, por lo que puede montar un grupo en dos ubicaciones. Solicitar un grupo cuya superficie no fue incluida al crear el backend (`surfaces: { data: false }`) lanza una excepción, porque el backend nunca lo construyó. Los documentos de OpenAPI y el servidor MCP no tienen un grupo: describen las URLs de la estructura de `mount()`, por lo que solo `mount()` los sirve.

## El backend sin servidor

Un backend que haya construido se puede utilizar sin montar nada.
`backend.rebase` es su cliente en proceso, y `backend.fetch(request)`
responde a una `Request` tal como lo haría `mount()` en `/api`:

```typescript
const backend = await createRebaseBackend({ database: adapter, schemaDir, provision: false });

const { data } = await backend.rebase.dataAsAdmin.posts.find({ limit: 5 });
const res = await backend.fetch(new Request("http://local/api/meta/schema-version"));

await backend.shutdown();
```

Las llamadas del plano de control en ese cliente (`rebase.auth`, `rebase.admin`,
`rebase.functions` y `rebase.cron`) acceden a las rutas propias del backend
en proceso. Funcionan sin importar dónde, o si acaso, montó los grupos, y
los middlewares que haya añadido a su propia aplicación no se ejecutan sobre ellas.

Para un script que solo necesita los datos, [`openRebase`](/docs/backend/scripts/)
abre la base de datos sin necesidad de construir un backend en absoluto.

## Varios backends en un mismo proceso

`createRebaseBackend` no escribe variables globales en el proceso. Cada backend mantiene su propio
estado en `backend.services`, de modo que dos de ellos en un mismo proceso se mantienen independientes: cada uno
firma y verifica sesiones con sus propias claves, evalúa alcances según sus propios roles,
comprueba claves de API en su propio almacén y contabiliza los límites de velocidad en su propio registro.

```typescript
const a = await createRebaseBackend({ database: adapterA, auth: { jwtSecret: SECRET_A }, tables, provision: true });
const b = await createRebaseBackend({ database: adapterB, auth: { jwtSecret: SECRET_B }, tables, provision: true });

app.route("/a/data", a.routes.data());
app.route("/b/data", b.routes.data());   // a session from `a` is a 401 here
```

| `backend.services` | Qué es |
|---|---|
| `jwt` | El servicio JWT del backend: firma y verifica sesiones, enlaces de descarga y sus demás tokens, y sirve su JWKS |
| `access` | Su modelo de acceso (de roles a alcances) y el solucionador para el propietario de una clave personal |
| `apiKeyStore` | Donde se verifican sus claves de API |
| `rateLimitStore`, `authLimiters` | Sus contadores de límite de velocidad y los limitadores de sus rutas de autenticación |
| `tables()` | Los descriptores compilados de las tablas que sirve |
| `topics`, `queues` | Sus entornos de ejecución para tópicos y colas |

Un backend al que no se le asigne `auth.jwtSecret`, como uno cuya `auth` sea un adaptador,
no firma nada propio, por lo que su `services.jwt` sigue el valor predeterminado del proceso.

**Los recursos pertenecen al proceso.** Las declaraciones de `database()`, `bucket()`, `topic()` y
`queue()` en `backend/resources.ts` son valores a nivel de módulo, y
cada backend en el proceso los lee todos: un backend cuyo propio proyecto
no declare ningún tópico aun así activará su cola de trabajos para el tópico de otro proyecto,
y se negará a iniciar si su controlador no puede admitir uno. Ejecute los recursos de un solo
proyecto por proceso. Varios backends de ese único proyecto, cada uno en su propia
base de datos, funcionan sin problemas.

**Hacia dónde apunta `rebase`.** Dentro de una solicitud, una ejecución de cron o un trabajo que atiende
un backend, `rebase`, ya sea importado desde `@rebasepro/server` o recibido como
`ctx.rebase`, es ese backend, al igual que el `publish` de tópicos y el `enqueue` de colas.
En cualquier otro lugar (ámbito de módulo, un script, una prueba) responden por el **valor
predeterminado del proceso**, que establece `setDefaultBackend(backend)`, y que
`initializeRebaseBackend` define para su propio backend. Lo mismo ocurre con el resto de la
API a nivel de módulo: `verifyAccessToken` y los demás helpers de JWT,
`getAccessModel`, `verifyCredential` y `extractUserFromToken`.

Tres componentes operan directamente sobre un backend, y uno sobre ningún backend:

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

Una sesión generada se valida como cualquier otra en cada solicitud, por lo que su uid debe corresponder a un usuario que exista: para un uid sin usuario, la solicitud es rechazada.

`verifyCredential` emite el mismo veredicto que las rutas: una sesión en la que su propietario cerró sesión, un uid sin usuario y una cuenta deshabilitada devuelven null, y los roles son los que la cuenta posee actualmente. Lanza un error cuando no se puede acceder a la base de datos.

Cada grupo de rutas define `c.var.services` por sí mismo. Una ruta fuera de los grupos que utilice `requireAuth`, `requireScope` u otro guard de `@rebasepro/server` lo lee allí, y recurre al valor predeterminado del proceso si no está establecido. `requireScope` evalúa al solicitante identificado por `requireAuth`, por lo que va después de `requireAuth`: por sí solo rechaza cualquier solicitud con un 401. Acepta un alcance integrado o un alcance de aplicación que el backend declare en `auth.scopes` en su tabla de autenticación, como en el comentario anterior.

Un nombre que no sea un alcance, o uno integrado mal escrito como `data:raed`, lanza un error en el momento en que se registra la ruta. Un alcance de aplicación que el backend que responde no declara responderá a cualquier solicitante, incluso a un administrador, con `500 SCOPE_NOT_DECLARED`.

## Apagado

A partir de `initializeRebaseBackend`, entregue el backend al helper integrado en
lugar de escribir un manejador de señales manual. Este drena el tráfico HTTP, detiene el programador de cron,
desconecta el tiempo real, cierra el pool SMTP una vez que ya nada pueda enviar mensajes, protege contra
señales repetidas y fuerza el cierre si el apagado se bloquea:

```typescript
import { initializeRebaseBackend, installShutdownHandlers } from "@rebasepro/server";

const backend = await initializeRebaseBackend({ app, server, database: adapter, tables });
installShutdownHandlers(backend, { onCleanup: () => pool.end() });
```

**No** lo combine con su propio `server.close()`: el método `shutdown()` de ese backend
ya cierra el servidor que se le proporcionó, y un segundo cierre provocará un
bloqueo mutuo (deadlock). Un backend creado con `createRebaseBackend` cierra un servidor solo cuando se lo
pasa explícitamente, `backend.shutdown(timeoutMs, { server })`, como en el ejemplo al
inicio de esta página.

## Embeber el controlador de Postgres

Un paso más abajo, `@rebasepro/server-postgres` funciona sin el servidor de Rebase
en absoluto: abra su controlador de datos y su socket de tiempo real dentro de Express, Fastify
o Node puro, y ensamble el resto usted mismo. Consulte
[Embeber el controlador de Postgres](/docs/backend/embedding-postgres-driver/).

## CORS para un frontend de navegador

Un servidor personalizado gestiona su propia configuración de CORS, y un frontend en otro origen solo
puede leer los encabezados de respuesta que este exponga. Exponga los que el SDK lee, o
`etagOf(row)` siempre será `undefined` allí —una escritura con `ifMatch` se enviará
entonces sin `If-Match`— y una respuesta 429 perderá su `Retry-After`:

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

`CORS_EXPOSED_HEADERS` es la lista que el propio runtime expone, por lo que un
encabezado que el SDK comience a leer en una versión posterior llegará a su frontend sin
necesidad de hacer cambios aquí. Incluye `ETag`, `Retry-After`, `X-Request-ID`, los tres
encabezados `X-RateLimit-*` y `Preference-Applied`, además de `Location`,
`Upload-Offset` y `Rebase-Upload-Result`, con los cuales responde una subida reanudable (archivos de más de
8 MiB), y `X-Rebase-Simulated-Context`, que indica con qué identidad se ejecutó la solicitud simulada de un
administrador. Sin los tres encabezados de subida, el SDK no puede dar seguimiento a una subida desde otro origen
y envía cada archivo como una única solicitud multipart en su lugar.

El runtime de Rebase y el backend generado mediante eject ya envían esta lista.

## Relacionado

- [Embeber el controlador de Postgres](/docs/backend/embedding-postgres-driver/) — el controlador de datos y el socket de tiempo real por sí solos, en Express
- [Scripts y la consola](/docs/backend/scripts/) — los datos del proyecto desde un script, una prueba o un REPL, sin servidor
- [Información general del backend](/docs/backend/) — dónde reside cada opción cuando el runtime arranca de forma predeterminada
- [Procesos divididos](/docs/deployment/split-processes/) — los roles que un servidor personalizado debe reproducir
- [Configuración del almacenamiento](/docs/backend/storage/) — los orígenes que un servidor personalizado debe resolver por sí mismo
