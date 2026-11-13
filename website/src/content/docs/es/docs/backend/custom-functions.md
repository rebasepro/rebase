---
sourceHash: 41e067cb49021d45
title: Funciones personalizadas
sidebar_label: Funciones personalizadas
description: Añade endpoints de API de Hono personalizados junto con tus rutas CRUD de Rebase. Descubiertos automáticamente desde un directorio, con acceso total a la instancia del backend.
---

## Visión general

Las funciones personalizadas te permiten añadir **rutas de API de Hono arbitrarias** junto a los endpoints CRUD autogenerados de Rebase. Siguen el mismo patrón de **descubrimiento basado en archivos** que los cron jobs: coloca un archivo TypeScript en tu directorio `functions/` y Rebase lo montará automáticamente.

Utiliza funciones personalizadas para:

- **Endpoints de lógica de negocio** — aprobaciones, promociones, flujos de trabajo personalizados
- **Integraciones de terceros** — webhooks de Stripe, comandos de Slack, proxies de API externas
- **Endpoints públicos** — formularios de contacto, captación de leads, comprobaciones de estado (health checks)
- **Consultas agregadas** — estadísticas de paneles (dashboards), informes, analíticas

## Definición de una función personalizada

Crea un archivo en tu directorio `backend/functions/` que exporte por defecto una aplicación de Hono:

```typescript
// backend/functions/hello.ts
import { defineFunction } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.post("/", async (c) => {
        const { name } = await c.req.json<{ name?: string }>().catch(() => ({ name: undefined }));
        return c.json({ message: `Hello, ${name ?? "world"}!` });
    });
});
```

Esto se monta en **`/api/functions/hello`**. El nombre del archivo (sin extensión) se convierte en el prefijo de la ruta.

`POST`, porque eso es lo que el SDK envía por defecto — consulta [Invocar desde el cliente](#invocar-desde-el-cliente). Una ruta `GET` es igualmente válida; en ese caso, el emisor de la llamada debe indicar `{ method: "GET" }`.

`rebase dev` observa el directorio de funciones, por lo que un archivo añadido mientras está en ejecución se monta en la siguiente recarga — sin necesidad de reiniciar. (Se le debe indicar: el directorio se escanea en lugar de importarse, por lo que el observador no puede inferirlo).

## Invocar desde el cliente

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "http://localhost:3000" });

const { message } = await client.functions.invoke<{ message: string }>(
    "hello",                 // the filename, without extension — one path segment
    { name: "Ada" }          // JSON body; omitted for a GET
);
```

`invoke` construye la URL, adjunta el token del emisor de la llamada y lanza un `RebaseApiError` en caso de una respuesta no 2xx — de modo que la estructura de error propia de la función llega al llamador en lugar de un simple rechazo de `fetch`.

Cuatro cosas que acepta además del nombre:

```typescript
// A different method. The payload is dropped for GET, since GET has no body.
await client.functions.invoke("hello", undefined, { method: "GET" });

// A sub-path — `/api/functions/hello/stats`. It goes here, never in the name:
// a name containing "/" is refused rather than percent-encoded into a 404.
await client.functions.invoke("hello", undefined, { method: "GET", path: "stats" });

// A query string. Passed as `path`, with no separator inserted before `?`.
await client.functions.invoke("reports", undefined, { method: "GET", path: "?days=30" });

// A function that answers text or a file (`c.text(csv)`, `c.body(pdf)`).
// The answer is read as JSON unless you say otherwise: "text" gives a string,
// "blob" a Blob, "response" the Response itself with its body unread.
const csv = await client.functions.invoke<string>("export-orders", undefined, { method: "GET", responseType: "text" });
```

:::note
`client.call("functions/hello", payload)` también accede a una función. Siempre hace `POST` y, al igual que `invoke`, devuelve el cuerpo literalmente — ninguno de los dos busca una clave `data`. Es preferible usar `functions.invoke`, que acepta un método, una subruta y un `responseType`; `call` existe para rutas montadas fuera de `/api/functions`, las cuales `invoke` no puede expresar.
:::

:::important
Importa desde **`@rebasepro/server/functions`**, no desde `@rebasepro/server`.

Ambos funcionan. La subruta es la superficie de autoría *portable*: no incluye nada que requiera Node, por lo que una función escrita con ella puede ejecutarse en cualquier runtime de JavaScript. La raíz del paquete accede a todo el framework — la secuencia de arranque, los cargadores de archivos, la capa de WebSocket —, lo cual es adecuado para el punto de entrada de un servidor pero más de lo que necesita un manejador de rutas. También te proporciona descriptores de acceso a contexto tipados (`getUser`, `getDriver`) en lugar de hacer un cast manual de `c.get("user")`.

Consulta [Portabilidad en tiempo de ejecución](#portabilidad-en-tiempo-de-ejecución) para ver el contrato completo.
:::

## Configuración

:::note[Dónde va esto]
**Runtime administrado:** nada que configurar — el runtime detecta `backend/functions/` por sí solo (`functions` en la entrada de la app del backend en `rebase.json` si lo has movido). `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE` restringen cuáles sirve un proceso con `REBASE_ROLE=functions`; cualquier otro rol se negará a arrancar si están definidos.
**Ejected:** `initializeRebaseBackend({ functionsDir })`, o `functions` (abajo), en `backend/src/index.ts`.
:::

Habilita las funciones personalizadas añadiendo `functionsDir` a la configuración de tu backend:

```typescript no-verify
import path from "path";

const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
});
```

Rebase hará lo siguiente:

1. Escaneará el directorio en busca de archivos `.ts` / `.js`
2. Validará que cada exportación por defecto sea una app de Hono (mediante tipado pato o *duck-typing* con `.fetch()` + `.routes`)
3. Montará cada app en `/api/functions/<filename>`
4. Aplicará el middleware de autenticación (consulta [Autenticación](#autenticación-y-propagación-de-contexto) a continuación)

### Funciones como valores

Un directorio es una forma de generar lo que sirve el servidor: un registro que mapea un segmento de URL a una app de Hono. Pasa ese registro tú mismo como `functions`, o lee un directorio hacia él con `loadFunctions`:

```typescript
import path from "path";
import { initializeRebaseBackend, loadFunctions } from "@rebasepro/server";
import sendInvoice from "../functions/send-invoice";

await initializeRebaseBackend({ app, server, functions: { "send-invoice": sendInvoice } }); // → /api/functions/send-invoice
// the same as functionsDir:
await initializeRebaseBackend({ app, server, functions: await loadFunctions(path.resolve(__dirname, "../functions")) });
```

Indica `functions` o `functionsDir`, no ambos: el arranque rechazará el par. `loadFunctions(dir, { onSkip })` te entrega cada archivo que omitió, junto con el motivo. `loadFunctionsFromDirectory` y `loadFunctionsWithDiagnostics` siguen funcionando, están en desuso (deprecated) y emiten una advertencia una sola vez. Por sí solo, el grupo de funciones se monta en cualquier ruta con `app.route("/hooks", backend.routes.functions())`, y `getUser(c)` y `getDriver(c)` funcionan dentro de él; consulta [Integración de servidor personalizado](/docs/backend/custom-server/#mounting-only-the-groups-you-want).

## Nombres de archivo y mapeo de rutas

| Archivo | Ruta de montaje |
|------|-----------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

Las funciones se descubren **únicamente en el nivel superior del directorio** — no hay recursión. `functions/admin/users.ts` es compilado por `rebase build` pero nunca se monta; aplana el nombre en su lugar (`functions/admin-users.ts`). Los subdirectorios se reportan en el arranque y se contabilizan en el endpoint de listado en lugar de ignorarse silenciosamente.

Archivos que se **omiten**:

- `index.ts` / `index.js` — reservados
- `*.test.ts` / `*.test.js` — archivos de prueba
- `*.d.ts` — declaraciones de tipo
- Subdirectorios y archivos `.mts` / `.cts` / `.tsx` / `.jsx` / `.mjs` / `.cjs` — reportados como problemas, ya que la compilación procesa más de lo que carga el runtime

El nombre también constituye la identidad de la función en todos los demás lugares: es el segmento de la URL, el destino del scope `functions:invoke:<name>` que una clave necesita para invocarla y el valor por el cual `REBASE_FUNCTIONS_ONLY` filtra cuando le asignas a una función su propio proceso.

## Formatos de exportación

El cargador acepta dos formatos de exportación además de `defineFunction`:

### App de Hono

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server/functions";

const app = new Hono<HonoEnv>();
app.get("/status", (c) => c.json({ ok: true }));
export default app;
```

### Función factory

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server/functions";

export default function () {
    const app = new Hono<HonoEnv>();
    app.get("/status", (c) => c.json({ ok: true }));
    return app;
}
```

`defineFunction` devuelve exactamente la app de Hono que estos construyen manualmente, por lo que las tres opciones son intercambiables. Te ahorra declarar `Hono<HonoEnv>` y te entrega el singleton `rebase` en el callback.

---

## Entre bambalinas: El cargador por duck-typing

En un monorepo, tus funciones pueden resolver una copia diferente de Hono a la que utiliza Rebase, haciendo que `exported instanceof Hono` sea falso para un enrutador que funciona perfectamente. Por ello, el cargador comprueba la estructura en su lugar (`isHonoLike`): un objeto no nulo con un método `.fetch` y un array `.routes`.

### Escape del compilador de ES Modules

El cargador convierte cada ruta de archivo en una URL de archivo (`pathToFileURL(filePath).href`), de modo que se importa igual en Windows y en POSIX, y llama a `import(url)` mediante `new Function("url", "return import(url)")`, para que una compilación de TypeScript no pueda reescribirlo como un `require()` que falle bajo ESM.

---

## Autenticación y propagación de contexto

Las funciones personalizadas se montan con el **mismo middleware de autenticación** que las rutas de datos, pero con `requireAuth: false`. Esto significa que:

- El JWT del usuario se **analiza e inyecta** en el contexto si está presente
- Pero las solicitudes **no se rechazan** si no se proporciona ningún JWT
- Debes **proteger explícitamente** las rutas que requieran autenticación

Un emisor que presente un token *inválido* nunca llegará a tu manejador: un token no verificable o expirado es rechazado con un 401 por el propio middleware, por lo que una sesión expirada nunca se degrada silenciosamente a una anónima.

### Lectura del emisor de la llamada

```typescript
import { defineFunction, getUser, getUserId, getRoles, getScopes, isAdmin } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/me", (c) => {
        const user = getUser(c);          // { uid, roles, ...claims } | undefined
        if (!user) return c.json({ error: "Unauthorized" }, 401);
        return c.json({ uid: user.uid, roles: user.roles, admin: isAdmin(c), scopes: getScopes(c) });
    });
});
```

`getUser` devuelve un objeto restringido: `uid` es un string y `roles` siempre es un array, independientemente del método de autenticación utilizado por el emisor. `getUserId(c)` y `getRoles(c)` son atajos. `getScopes(c)` representa todo lo que el llamador puede hacer, como cadenas de [scope](/docs/backend/roles-and-scopes/): para una persona, el plano de datos, los scopes propios de la aplicación y los scopes de sus roles; para una clave de API, exactamente lo que contiene la clave.

### La cuenta del emisor

`getUser(c)` lee el token de acceso, y el token contiene el id, los roles y la dirección del emisor. No indica cómo inicia sesión la cuenta ni cuál es su nombre visible. `getUserProfile(c)` lee esos datos del almacén de autenticación:

```typescript
import { defineFunction, getUserProfile } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/whoami", async (c) => {
        const profile = await getUserProfile(c);
        if (!profile) return c.json({ error: "Unauthorized" }, 401);
        // { uid, email?, displayName?, photoURL?, emailVerified, isAnonymous, providers }
        return c.json({ name: profile.displayName ?? null, social: profile.providers.some(p => p !== "password") });
    });
});
```

`providers` lista cómo puede iniciar sesión la cuenta: `"password"` cuando tiene una, y luego cada proveedor vinculado (`"google"`, `"apple"`, …) en el orden en que fue vinculado. Una cuenta de invitado, o una que inicia sesión solo con un código de un solo uso, tiene una lista vacía.

La lectura es fresca para cada solicitud: un proveedor que el llamador haya vinculado hace un momento se muestra en su siguiente solicitud, sin esperar a que el token se actualice. La primera llamada en una solicitud cuesta dos búsquedas por clave, realizadas conjuntamente. Las llamadas posteriores en la misma solicitud reutilizan el resultado, y una solicitud que nunca lo invoque no tiene coste alguno.

Devuelve `undefined` para un emisor anónimo, para un llamador con clave de servicio o clave de API que no actúa como ninguna cuenta, y para una cuenta que ya no existe. También devuelve `undefined` en un backend cuyas cuentas residen en un [adaptador de autenticación](/docs/backend/auth-adapters/) externo: consulta a ese proveedor en su lugar. Cuando un administrador envía `x-rebase-impersonate`, devuelve la cuenta personificada.

### Protección de rutas

```typescript
import { defineFunction, requireAuth, requireAdmin, requireRole, getUserId } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    // Public endpoint — no guard, so anyone can call it.
    app.get("/public", (c) => c.json({ message: "Anyone can access this" }));

    // 401 for anonymous callers.
    app.post("/protected", requireAuth, (c) => c.json({ message: `Hello, ${getUserId(c)}` }));

    // 401 anonymous, 403 without the admin role. Order matters.
    app.post("/admin-only", requireAuth, requireAdmin, (c) => c.json({ ok: true }));

    // Any one of the named roles.
    app.post("/publish", requireAuth, requireRole("editor", "admin"), (c) => c.json({ ok: true }));
});
```

Coloca los guardas en la **propia ranura de middleware de la ruta**, como se muestra arriba, en lugar de `app.use("/*", requireAuth)`. `use()` cubre únicamente las rutas declaradas *por debajo* de él, por lo que una ruta añadida más adelante — al final del archivo, dentro de unos meses — quedaría desprotegida silenciosamente.

:::important
Leer `getUser(c)` **no** es un guarda. Un emisor anónimo obtiene `undefined` y tu manejador se ejecuta de todos modos. Solo un guarda, o un `if (!user) return 401` explícito, detiene la solicitud.
:::

### Scopes y scopes de aplicación

`requireAdmin` admite el rol `admin` y a nadie más. Para una acción a la que deba acceder un rol más específico o una clave de API, protege la ruta con `requireScope`. Acepta un [scope](/docs/backend/roles-and-scopes/) integrado, o uno que la app declare bajo `auth.scopes` en la colección de usuarios, como `"project:deploy": { label: "Deploy projects", target: "project" }`:

```typescript
import { defineFunction, requireAuth, requireScope, hasScope } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    // 403 SCOPE_MISSING unless the caller holds project:deploy, or project:deploy:<this project>.
    app.post("/:project", requireAuth, requireScope("project:deploy", c => c.req.param("project")), (c) => {
        return c.json({ deploying: c.req.param("project") });
    });

    // The same question inside a handler.
    app.get("/:project/can-deploy", requireAuth, (c) => c.json({ allowed: hasScope(c, "project:deploy", c.req.param("project")) }));
});
```

Cada persona que ha iniciado sesión posee todos los scopes de la app, por lo que para una persona `requireScope` no decide nada: comprueba en el manejador si esta persona puede desplegar este proyecto. Lo que aporta el scope es una forma de **restringir una clave**: una clave que contenga `project:deploy:p1` solo será válida para `p1`. Una clave también necesita `functions:invoke`, o `functions:invoke:<name>`, antes de poder acceder a la función en absoluto. Consulta [Scopes de aplicación](/docs/backend/roles-and-scopes/#app-scopes).

### Autenticación mediante Service Key

Rebase admite una `REBASE_SERVICE_KEY` estática definida en tu `.env` para llamadas desde scripts o de servidor a servidor.

Cuando una solicitud externa envía la clave de servicio a través del encabezado Authorization (`Authorization: Bearer <service_key>`), el middleware de autenticación automáticamente:
1. Valida la clave utilizando una comparación de tiempo constante para prevenir ataques de temporización (timing attacks).
2. Otorga acceso de nivel de administrador, estableciendo al emisor como `{ uid: "service", roles: ["admin"] }`.
3. Inyecta un `DataDriver` con el alcance de esa misma identidad de servicio. La seguridad a nivel de fila (Row-Level Security o RLS) se sigue aplicando — se evalúa como `{ uid: "service", roles: ["admin"] }`, no se omite.

### Autoautenticación interna

Si no has configurado una `REBASE_SERVICE_KEY`, Rebase genera una **clave interna aleatoria por cada arranque**. El singleton `rebase` utiliza esta clave automáticamente al invocar las API del plano de control del propio servidor (como `rebase.auth` o `rebase.storage`). Esto significa que la lógica de tu servidor siempre puede realizar tareas administrativas incluso sin una clave de servicio configurada manualmente.

## Acceso a la base de datos y servicios

### 1. El driver con alcance de usuario — para cualquier cosa que atienda una solicitud

`getDriver(c)` devuelve el driver **con el alcance del emisor**, de modo que cada lectura y escritura se evalúa contra tus políticas de Row-Level Security como ese usuario:

```typescript
import { defineFunction, requireAuth, requireDriver } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/", requireAuth, async (c) => {
        const driver = requireDriver(c);
        const myProducts = await driver.fetchCollection({ path: "products", limit: 10 });
        return c.json(myProducts);
    });
});
```

`requireDriver(c)` es `getDriver(c)` sin el `!` — lanza un mensaje indicando el problema de configuración en lugar de fallar veinte líneas más adelante por un `undefined`.

<span class="since-badge" data-since="0.31">Desde 0.31</span> `fetchCollection` y `fetchOne` devuelven las filas que devuelve `GET /api/data/<table>`: fechas como cadenas RFC 3339, un `belongsTo` como su clave foránea (`authorId`), y una fila relacionada solo cuando `include` la especifica — `driver.fetchOne({ path: "articles", id, include: ["author"] })`.

### 2. `rebase.dataAsAdmin` — para trabajo en segundo plano de confianza

```typescript
import { defineFunction, requireAuth, requireAdmin } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.post("/:id/approve", requireAuth, requireAdmin, async (c) => {
        const id = c.req.param("id");
        await rebase.dataAsAdmin.table<Record<string, unknown>>("jobs").update(id, {
            status: "published",
            approved_at: new Date().toISOString(),
        });
        return c.json({ success: true });
    });
});
```

`rebase.dataAsAdmin` no tiene tipos hasta que [registres tu `Database` generada](/docs/backend/typed-server-data).

### Driver con alcance de RLS vs. Singleton de Rebase

|                     | `getDriver(c)` (alcance de solicitud)          | `rebase.dataAsAdmin` (identidad de servicio)                     |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **Se ejecuta como** | El emisor (`uid`, sus roles)                   | `{ uid: "service", roles: ["admin"] }`                            |
| **Aplicación de RLS**| ✅ Sí (evaluado contra el emisor)              | ✅ Sí (evaluado contra la identidad de servicio)                 |
| **Ideal para...**   | CRUD de usuario general, búsquedas y consultas | Trabajos en segundo plano, triggers del sistema, webhooks        |
| **Estilo de API**   | Métodos a nivel de driver (`fetchCollection`, `save`) | Descriptores fluidos de tablas (`rebase.dataAsAdmin.jobs.find`) |

#### Qué es `dataAsAdmin`, exactamente

`rebase.dataAsAdmin` tiene **alcance de administrador, no omite RLS**. El driver se contextualiza una sola vez, en el arranque, con `withAuth({ uid: "service", roles: ["admin"] })`, por lo que cada lectura y escritura se ejecuta dentro de una transacción que ha cambiado al rol restringido `rebase_user` con `app.uid = 'service'`. Tus políticas se evalúan — contra esa identidad.

Para la mayoría de los proyectos la distinción nunca se manifiesta, porque las políticas predeterminadas que Rebase inyecta en cada tabla admiten `serverContext() OR rolesOverlap(['admin'])`, y la identidad de servicio satisface la segunda parte. Se manifiesta en el momento en que escribes tus propias políticas:

- **`policy.serverContext()` es falso para él.** Ese helper se compila como `rebase.uid() IS NULL`, y el `uid` de este descriptor de acceso es `'service'`. Una tabla con `disableDefaultPolicies: true` cuya única regla de escritura sea `serverContext()` rechazará una escritura de `dataAsAdmin` con el error de Postgres `42501`, y una lectura contra dicha colección devolverá **cero filas con HTTP 200** — la dirección silenciosa. Escribe `rolesOverlap(["admin"])` (o añádelo junto a él) cuando te refieras a "mi backend".
- **Su alcance equivale al alcance de un usuario `admin`.** Otorgar el rol `admin` a un usuario de la aplicación le otorga exactamente las filas que este descriptor ve. No es un canal privado.

### 3. `getSql(c)` — SQL como el emisor de la llamada

Cuando el SDK no exprese una consulta o una escritura de forma limpia — un upsert condicional, un compare-and-swap `UPDATE … WHERE rev = $3 RETURNING`, `count(*) FILTER (…)`, una CTE —, escribe el código SQL y ejecútalo como el emisor de la llamada:

```typescript
import { defineFunction, getSql, requireAuth } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/my-stats", requireAuth, async (c) => {
        const sql = getSql(c);
        const rows = await sql(
            "SELECT lower(artist) AS artist, count(*) FILTER (WHERE liked) AS likes FROM songs WHERE lang = $1 GROUP BY 1",
            { params: [c.req.query("lang") ?? "en"] }
        );
        return c.json(rows);
    });
});
```

La sentencia se ejecuta en la propia transacción del emisor, como el rol restringido `rebase_user` con su identidad — la transacción que abre el driver con alcance de usuario —, por lo que las reglas de `rls` de tus tablas deciden cada fila, exactamente igual que lo hacen para el SDK. Una consulta que solicite todas las filas obtendrá únicamente las del emisor.

- **De solo lectura por defecto.** Pasa `{ write: true }` para insertar, actualizar o eliminar; las políticas de inserción y actualización siguen aplicando.
- **El texto de la consulta es tuyo; los valores van en `params`** (`$1`, `$2`, …). La identidad del llamador reside en la configuración de la transacción, la cual SQL puede alterar; por tanto, cualquier sentencia que pudiera hacerlo — `SET`, `RESET`, `set_config`, `pg_settings`, `DO`, o más de una sentencia — es rechazada con `400 SQL_NOT_ALLOWED` antes de ejecutarse. Interpolar entradas del usuario en el texto es la forma en que se pondría a prueba esa protección; no lo hagas.
- **Lo que comparte con el SDK.** Las políticas y tres reglas que Postgres mantiene para ambos: una [vista materializada](/docs/collections/views/#materialized-views) sirve sus filas únicamente a sus `roles`, una fila de una tabla que declare `tenant` no puede ser movida a otro inquilino excepto por un llamador con `bypassRoles` (`TENANT_IMMUTABLE`), y las funciones propias del servidor (`rebase.record_history`, `rebase.enqueue_job`) son rechazadas. Una columna que el emisor no pueda leer — `.private()`, o un `.access({ read })` del que carezca — se descarta de las filas, tal como la API la descarta, cuando es una referencia directa a la columna (`SELECT *`, `password_hash AS h`); un valor *calculado* a partir de una (`md5(password_hash)`) no se reconoce, así que no realices cálculos a partir de ella.
- **Lo que no comparte.** `beforeQuery` y `afterRead`, la validación, los hooks de guardado y el historial residen en Node y no se ejecutan.

Desde un script, [`openRebase`](/docs/backend/embedding-postgres-driver/) te proporciona lo mismo: `(await rebase.withAuth(user)).sql(…)`.

#### `rebase.sqlAsAdmin()` — SQL como la identidad de servicio

Una función que aplica sus propias reglas (un ticket al día, una comprobación de tiempo) sobre tablas que solo los administradores pueden leer no puede usar `getSql(c)`: el llamador necesitaría políticas que lo admitan, y esas mismas políticas abrirían las tablas en la API pública de datos también. `rebase.sqlAsAdmin` ejecuta la sentencia como `{ uid: "service", roles: ["admin"] }`, la identidad que utiliza `rebase.dataAsAdmin`, bajo la misma seguridad a nivel de fila:

```typescript
import { defineFunction, rebase } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.post("/claim", async (c) => {
        const { device } = await c.req.json();
        const rows = await rebase.sqlAsAdmin(
            "INSERT INTO tickets (device, day) VALUES ($1, current_date) ON CONFLICT DO NOTHING RETURNING id",
            { params: [device], write: true }
        );
        return c.json({ claimed: rows.length === 1 });
    });
});
```

Es `getSql(c)` con una identidad diferente: el rol de solicitud restringido, la rama de administrador de tus políticas, de solo lectura a menos que se indique `{ write: true }`, y la misma protección `SQL_NOT_ALLOWED`. A diferencia del `rebase.sql()` del propietario, no puede ejecutar DDL, y del almacén de autenticación solo alcanza lo que un admin alcanza a través de la colección de usuarios: las sesiones, claves y secretos de MFA se ocultan al rol de solicitud, y los hashes de contraseña se eliminan de las filas. Una sentencia individual cuesta un viaje de ida y vuelta (round trip), al igual que `rebase.sql()`. Desde un script, `openRebase()` también dispone de él.

### 4. `rebase.sql()` — SQL de propietario, y el único descriptor exclusivo de Node

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Si realmente necesitas una omisión incondicional, `rebase.sql()` es la solución: SQL sin procesar en la conexión del propietario, sin políticas, todas las filas. Es el elemento con más privilegios en el contexto de una función — incluso más que el descriptor que lleva "admin" en su nombre.

No está pensado para crear tablas. Una tabla se [declara](/docs/schema/) con `defineTable` en `backend/schema/` y se crea en el arranque; una creada con `CREATE TABLE` en una función no tiene validación, hooks, postura de seguridad a nivel de fila, vista de administración ni tipo en el SDK. `rebase.sql()` ejecuta dicha sentencia y registra una advertencia indicando la tabla que debería declararse en su lugar.

```typescript
import { defineFunction, requireAuth, requireAdmin } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.get("/stats", requireAuth, requireAdmin, async (c) => {
        const rows = await rebase.sql(
            "SELECT count(*) AS total FROM jobs WHERE status = $1",
            { params: ["published"] }
        );
        return c.json({ totalJobs: Number(rows[0]?.total ?? 0) });
    });
});
```

Se ejecuta sobre una conexión TCP a tu base de datos, lo que lo convierte en el único descriptor de acceso vinculado a un proceso de Node. Eso no supone ningún inconveniente en ningún despliegue existente hoy en día — simplemente es el único aspecto a tener en cuenta si una función pudiera migrarse más adelante. Consulta [Portabilidad en tiempo de ejecución](#portabilidad-en-tiempo-de-ejecución).

:::caution[El acceso directo a Drizzle es exclusivo de Node]
También puedes importar tu propia instancia de Drizzle y consultarla directamente (`db.execute(sql\`…\`)`). Funciona, y en un despliegue de Node autohospedado o administrado es perfectamente válido.

Vale la pena conocer sus implicaciones: una función que importa `drizzle-orm` y un pool de `pg` es permanentemente una función de Node, elude los hooks de tus tablas (los cuales `rebase.data` sí ejecuta; ninguno de los dos comprueba `.validate()`, que se aplica a las [solicitudes de API](/docs/collections/validation-and-conditions/#where-validation-runs)), y obtiene su conexión de un lugar distinto al de la solicitud. `rebase.sql()` te ofrece el mismo SQL directo a través de la propia conexión del framework, y `getSql(c)` te lo ofrece bajo las políticas del emisor. Es preferible utilizar estos últimos.
:::

## Configuración y secretos

Lee la configuración **dentro** del manejador, nunca en el ámbito del módulo:

```typescript
import { defineFunction, requireEnv, lazyResource } from "@rebasepro/server/functions";

// Built once, on the first request that needs it — not at import time.
const apiKey = lazyResource((env) => env.PRICING_API_KEY ?? "");

export default defineFunction((app) => {
    app.get("/price", async (c) => {
        const endpoint = requireEnv(c, "PRICING_API_URL");
        const response = await fetch(endpoint, {
            headers: { authorization: `Bearer ${apiKey(c)}` }
        });
        return c.json(await response.json());
    });
});
```

Por qué esto es importante en **cualquier** runtime, incluido Node:

```typescript no-verify
// Don't. If STRIPE_SECRET_KEY is unset, this throws while the file is being
// imported — and the loader reports that as a *skipped function*. The route
// 404s, with the reason buried in a boot log line.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

Una lectura a nivel de módulo se evalúa cuando se importa el archivo, antes de que exista cualquier solicitud. En Node, esto significa que una variable ausente echa abajo todo el archivo y todas las rutas que contiene con él. En un proveedor que adjunta la configuración a la solicitud en lugar de al proceso, no hay nada que leer en el momento de la importación.

- `getEnv(c)` — cada variable visible para esta solicitud
- `env(c, "NAME")` — una variable, recortada (trimmed); si está en blanco cuenta como no establecida
- `requireEnv(c, "NAME")` — lo mismo, pero lanza un mensaje indicando el nombre de la variable
- `lazyResource(factory)` — construye un cliente costoso una sola vez, en el primer uso

`rebase doctor` reporta las lecturas de `process.env` a nivel de módulo en tu directorio de funciones.

## Trabajo en segundo plano

Trasladado a su propia página: [Trabajo en segundo plano](/docs/backend/background-work/).

## Portabilidad en tiempo de ejecución

Una función personalizada es una aplicación de Hono, por lo que la posibilidad de ejecutarla en un entorno distinto a un proceso de Node se reduce a lo que importa su propio archivo. `rebase.sql()`, un cliente de base de datos importado directamente y los módulos nativos de Node la vinculan a Node; el resto de `rebase` y la plataforma web no lo hacen, y nada falla hoy en día por causa de ninguno de los dos. [Portabilidad en tiempo de ejecución](/docs/backend/runtime-portability/) detalla qué es portable, cómo lo reportan `rebase build` y `rebase doctor`, y cómo crear ramas según el runtime.

## Orden de registro de rutas

Las funciones personalizadas se cargan y montan **después** de que `initializeRebaseBackend()` complete la configuración inicial. El orden de inicialización es:

1. **Bootstrappers** — Conexiones de base de datos, tablas de autenticación, servicios en tiempo real
2. **Rutas de autenticación** — `/api/auth/*`, `/api/admin/*`
3. **Rutas de almacenamiento** — `/api/storage/*`
4. **Rutas de datos** — `/api/data/*` (CRUD para tablas)
5. **Funciones personalizadas** ← `/api/functions/*`
6. **Cron jobs** — `/api/admin/cron/*`
7. **WebSocket** — Suscripciones en tiempo real

Esto significa que tus funciones personalizadas tienen acceso a todos los servicios inicializados. Registra cualquier ruta que deba ejecutarse **antes** de Rebase directamente en la app de Hono, antes de llamar a `initializeRebaseBackend()`:

```typescript no-verify
const app = new Hono<HonoEnv>();

// This runs BEFORE Rebase routes
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase initialization — registers all /api/* routes
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
Las rutas que agregues a tu propia app de esa manera quedan **fuera** de cualquier enrutador de Rebase, por lo que no se ha ejecutado ningún middleware de autenticación en ellas y `getDriver(c)` no estará establecido. Protege esas rutas con `requireAuth` / `requireAdmin` importados desde **`@rebasepro/server`** — la raíz del paquete —, los cuales verifican el token por sí mismos. Los guardas en la subruta `/functions` leen una identidad que un enrutador de Rebase ya ha resuelto, y responderán con un 500 en lugar de fingir que existe una.
:::

## Ejemplo: Manejador de Webhook

```typescript
import { defineFunction, requireEnv, waitUntil, lazyResource } from "@rebasepro/server/functions";

/** Constructed on the first request, from that request's configuration. */
const secret = lazyResource((env) => env.STRIPE_WEBHOOK_SECRET ?? "");

export default defineFunction((app, { rebase }) => {
    // Deliberately public: Stripe has no token to send. The signature is the
    // authentication, so verify it before doing anything else.
    app.post("/", async (c) => {
        const signature = c.req.header("stripe-signature");
        const body = await c.req.text();

        if (!signature || !verifySignature(body, signature, secret(c))) {
            return c.json({ error: "Bad signature" }, 400);
        }

        const event = JSON.parse(body) as { type: string; data: { object: Record<string, string> } };

        if (event.type === "checkout.session.completed") {
            const session = event.data.object;
            await rebase.dataAsAdmin.table("subscriptions").create({
                user_id: session.client_reference_id,
                stripe_id: session.subscription,
                status: "active",
            });
            // Fulfilment can outlive the response; the 200 tells Stripe to stop retrying.
            waitUntil(c, notifyFulfilment(requireEnv(c, "FULFILMENT_URL"), session));
        }

        return c.json({ received: true });
    });
});

declare function verifySignature(body: string, signature: string, secret: string): boolean;
declare function notifyFulfilment(url: string, session: Record<string, string>): Promise<void>;
```

## Depuración

Cuando las funciones se cargan, los registros de arranque muestran `Loaded custom functions` con su cantidad. La línea individual de cada función se registra en el nivel `debug` (`LOG_LEVEL=debug`):

```
⚡ Loaded function route: hello
```

Si la carga falla, el cargador proporciona información de diagnóstico:

```
[functions] broken-function.ts: default export is not a Hono app or factory. Skipping.
  export type: object (SomeClass)
  prototype methods: constructor, someMethod
  Hint: ensure the function exports a Hono app created with the same hono version as the server.
  Author with `defineFunction(...)` from @rebasepro/server/functions for a typed, checked contract.
  The loader checks for .fetch() and .routes — any Hono-compatible app will work.
```

El enrutador se monta para el **directorio**, no para las funciones individuales en él. Si todos los archivos fallan al importarse — una variable de entorno ausente a nivel de módulo basta para hacer caer a todos —, `GET /api/functions` seguirá respondiendo `200` con una lista vacía más un recuento de `skipped`, de modo que "no se cargó nada" se distinga de "esta compilación no incluía ninguna función". El listado en sí requiere un llamador autenticado, una clave de API que contenga el scope básico `functions:invoke`, o la clave de servicio — las funciones siguen siendo invocables por quienquiera que cada una admita, pero el inventario de las mismas no es público. Los motivos quedan registrados en el log de arranque.

## Timeouts y límites de tasa

Dos límites aplican a `/api/functions/*`:

- **Tiempo de espera de la solicitud (Request timeout)** — 30 segundos por defecto, respondiendo `504` con el código `FUNCTION_TIMEOUT`. Configúralo con `functionsTimeoutMs` (o `REBASE_FUNCTIONS_TIMEOUT_MS`); `0` lo deshabilita. El manejador no se puede detener desde el exterior, pero se le notifica: `getSignal(c)` de `@rebasepro/server/functions` se aborta en el momento del 504, así que pásalo a `fetch` y a cualquier otra función que acepte una señal (`fetch(url, { signal: getSignal(c) })`). El trabajo al que no se le pase la señal continuará — el timeout libera al cliente y al socket, no al trabajo. Que el manejador *siga ejecutándose* tras el 504 es una propiedad de un proceso de Node de larga duración, no una garantía del contrato; cualquier tarea que deba completarse pertenece a [`waitUntil`](#trabajo-en-segundo-plano).
- **Límite de tasa (Rate limit)** — Los emisores autenticados y con clave de API comparten los buckets de la API de datos. Los emisores anónimos obtienen su propio límite, mucho más holgado (3000 por ventana), porque este enrutador es público por defecto para receptores de webhooks. Sobrescríbelo con `rateLimit.anonymousFunctions`; `null` lo desactiva.

Los rechazos de promesas no controlados (unhandled promise rejections) se registran en lugar de ser fatales: de lo contrario, una llamada de tipo fire-and-forget en una función terminaría todo el proceso. Establece `REBASE_EXIT_ON_UNHANDLED_REJECTION=1` para mantener el comportamiento predeterminado de Node.

En Rebase Cloud, el edge situado frente a tus funciones cuenta con sus propios límites, y el estado a nivel de módulo, el sistema de archivos y los puertos salientes se comportan de formas que conviene conocer antes de diseñar a partir de ellos. Consulta [Runtime administrado de backend](/docs/deployment/managed-runtime/).

## Próximos pasos

- **[Visión general del backend](/docs/backend)** — Referencia completa de configuración del backend
- **[Hooks de tabla](/docs/collections/callbacks)** — Ejecuta lógica en cambios de datos
- **[Cron Jobs](/docs/backend/cron-jobs)** — Tareas programadas en segundo plano
