---
sourceHash: 9240cd2dc83f4b7b
title: Funciones personalizadas
sidebar_label: Funciones personalizadas
description: Agrega endpoints de API de Hono personalizados junto con tus rutas CRUD de Rebase. Detección automática desde un directorio, con acceso completo a la instancia del backend.
---

## Descripción general

Las funciones personalizadas te permiten agregar **rutas de API de Hono arbitrarias** junto con los endpoints CRUD generados automáticamente por Rebase. Siguen el mismo patrón de **detección basada en archivos** que los cron jobs: coloca un archivo TypeScript en tu directorio `functions/`, y Rebase lo montará automáticamente.

Usa funciones personalizadas para:

- **Endpoints de lógica de negocio** — aprobaciones, promociones, flujos de trabajo personalizados
- **Integraciones de terceros** — webhooks de Stripe, comandos de Slack, proxies de API externas
- **Endpoints públicos** — formularios de contacto, captación de leads, health checks
- **Consultas agregadas** — estadísticas del panel de control, reportes, analíticas

## Definir una función personalizada

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

`POST`, porque eso es lo que envía el SDK de forma predeterminada — consulta [Invocar desde el cliente](#invocar-desde-el-cliente). Una ruta `GET` es igual de válida; en ese caso, el emisor de la llamada debe especificar `{ method: "GET" }`.

`rebase dev` observa el directorio de funciones, por lo que un archivo agregado mientras se está ejecutando se monta en la siguiente recarga — sin reiniciar. (Debe ser notificado: el directorio se escanea en lugar de importarse, por lo que el watcher no puede inferirlo).

## Invocar desde el cliente

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "http://localhost:3000" });

const { message } = await client.functions.invoke<{ message: string }>(
    "hello",                 // the filename, without extension — one path segment
    { name: "Ada" }          // JSON body; omitted for a GET
);
```

`invoke` construye la URL, adjunta el token del emisor y lanza un
`RebaseApiError` en caso de una respuesta no-2xx — de modo que la propia estructura de error de la función
llegue al emisor en lugar de un rechazo de `fetch` básico.

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
`client.call("functions/hello", payload)` también se comunica con una función. Siempre hace
`POST` y, al igual que `invoke`, devuelve el cuerpo literalmente — ninguno de los dos extrae una
clave `data`. Es preferible usar `functions.invoke`, que acepta un método, una subruta y un
`responseType`; `call` existe para rutas montadas fuera de `/api/functions`, las cuales
`invoke` no puede expresar.
:::

:::important
Importa desde **`@rebasepro/server/functions`**, no desde `@rebasepro/server`.

Ambos funcionan. La subruta es la superficie de autoría *portable*: no incluye nada que requiera Node, por lo que una función escrita con ella puede ejecutarse en cualquier runtime de JavaScript. La raíz del paquete abarca todo el framework — la secuencia de arranque, los cargadores de archivos, la capa de WebSocket — lo cual es adecuado para el punto de entrada de un servidor y más de lo que necesita un manejador de rutas. También te proporciona accesores de contexto tipados (`getUser`, `getDriver`) en lugar de hacer casting manual de `c.get("user")`.

Consulta [Portabilidad de runtime](#portabilidad-de-runtime) para ver el contrato completo.
:::

## Configuración

:::note[Dónde va esto]
**Runtime administrado:** nada que configurar — el runtime descubre `backend/functions/` por sí solo (`functions` en la entrada `rebase.json` de la aplicación de backend si lo moviste). `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE` limitan cuáles atiende un proceso con `REBASE_ROLE=functions`; cualquier otro rol se negará a arrancar si están configuradas.
**Expulsado (Ejected):** `initializeRebaseBackend({ functionsDir })`, o `functions` (más abajo), en `backend/src/index.ts`.
:::

Habilita las funciones personalizadas agregando `functionsDir` a la configuración de tu backend:

```typescript no-verify
import path from "path";

const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
});
```

Rebase hará lo siguiente:

1. Escaneará el directorio en busca de archivos `.ts` / `.js`
2. Validará que cada exportación por defecto sea una aplicación de Hono (duck-typed mediante `.fetch()` + `.routes`)
3. Montará cada aplicación en `/api/functions/<filename>`
4. Aplicará el middleware de autenticación (consulta [Autenticación](#autenticación-y-propagación-de-contexto) más abajo)

### Funciones como valores

Un directorio es una forma de producir lo que el servidor entrega: un registro que mapea un segmento de URL a una aplicación de Hono. Pasa ese registro tú mismo como `functions`, o lee un directorio hacia él con `loadFunctions`:

```typescript
import path from "path";
import { initializeRebaseBackend, loadFunctions } from "@rebasepro/server";
import sendInvoice from "../functions/send-invoice";

await initializeRebaseBackend({ app, server, functions: { "send-invoice": sendInvoice } }); // → /api/functions/send-invoice
// the same as functionsDir:
await initializeRebaseBackend({ app, server, functions: await loadFunctions(path.resolve(__dirname, "../functions")) });
```

Proporciona `functions` o `functionsDir`, no ambos: el arranque rechazará el par. `loadFunctions(dir, { onSkip })` te entrega cada archivo que omitió, junto con el motivo. `loadFunctionsFromDirectory` y `loadFunctionsWithDiagnostics` siguen funcionando, están en desuso (deprecated) y emiten una advertencia una sola vez. Por su cuenta, el grupo de funciones se monta en cualquier ruta con `app.route("/hooks", backend.routes.functions())`, y `getUser(c)` y `getDriver(c)` funcionan en su interior; consulta [Integración con servidor personalizado](/docs/backend/custom-server/#mounting-only-the-groups-you-want).

## Nomenclatura de archivos y mapeo de rutas

| Archivo | Ruta de montaje |
|------|-----------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

Las funciones se detectan **únicamente en el nivel superior del directorio** — no hay recursión. `functions/admin/users.ts` es compilado por `rebase build` pero nunca se monta; aplana el nombre en su lugar (`functions/admin-users.ts`). Los subdirectorios se reportan al arrancar y se contabilizan en el endpoint de listado en lugar de ignorarse silenciosamente.

Archivos que se **omiten**:

- `index.ts` / `index.js` — reservados
- `*.test.ts` / `*.test.js` — archivos de prueba
- `*.d.ts` — declaraciones de tipos
- Subdirectorios y archivos `.mts` / `.cts` / `.tsx` / `.jsx` / `.mjs` / `.cjs` — se reportan como problemas, ya que la compilación procesa más de lo que el runtime carga

El nombre también es la identidad de la función en todos los demás lugares: es el segmento de la URL, el objetivo del scope `functions:invoke:<name>` que una clave necesita para llamarla y el valor por el cual `REBASE_FUNCTIONS_ONLY` filtra cuando asignas a una función su propio proceso.

## Formatos de exportación

El cargador acepta dos formatos de exportación además de `defineFunction`:

### Aplicación de Hono

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server/functions";

const app = new Hono<HonoEnv>();
app.get("/status", (c) => c.json({ ok: true }));
export default app;
```

### Función de fábrica

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server/functions";

export default function () {
    const app = new Hono<HonoEnv>();
    app.get("/status", (c) => c.json({ ok: true }));
    return app;
}
```

`defineFunction` devuelve exactamente la aplicación de Hono que estos construyen manualmente, por lo que los tres son intercambiables. Te ahorra declarar `Hono<HonoEnv>` y te entrega el singleton `rebase` en el callback.

---

## Bajo el capó: El cargador con Duck-Typing

En un monorepositorio, tus funciones pueden resolver una copia diferente de Hono a la que usa Rebase, y entonces `exported instanceof Hono` resultará falso para un router funcional. Por lo tanto, el cargador comprueba la estructura en su lugar (`isHonoLike`): un objeto no nulo con un método `.fetch` y un array `.routes`.

### Escape del compilador de módulos ES

El cargador convierte cada ruta de archivo en una URL de archivo (`pathToFileURL(filePath).href`), para que se importe tanto en Windows como en POSIX por igual, y llama a `import(url)` mediante `new Function("url", "return import(url)")`, evitando que una compilación de TypeScript lo reescriba como un `require()` que falle bajo ESM.

---

## Autenticación y propagación de contexto

Las funciones personalizadas se montan con el **mismo middleware de autenticación** que las rutas de datos, pero con `requireAuth: false`. Esto significa:

- El JWT del usuario se **analiza e inyecta** en el contexto si está presente
- Pero las solicitudes **no se rechazan** si no se proporciona ningún JWT
- Debes **proteger explícitamente** las rutas que requieran autenticación

Un emisor que presente un token *inválido* nunca llega a tu manejador: el propio middleware rechaza con 401 cualquier token que no se pueda verificar o que esté vencido, por lo que una sesión expirada nunca se degrada silenciosamente a una anónima.

### Leer el emisor de la llamada

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

`getUser` devuelve un objeto delimitado: `uid` es un string y `roles` siempre es un array, independientemente del método de autenticación utilizado por el emisor. `getUserId(c)` y `getRoles(c)` son atajos. `getScopes(c)` representa todo lo que el emisor tiene permitido hacer, como strings de [scope](/docs/backend/roles-and-scopes/): para una persona, el plano de datos, los scopes propios de la aplicación y los scopes de sus roles; para una clave de API, exactamente lo que contiene la clave.

### La cuenta del emisor

`getUser(c)` lee el token de acceso, y el token contiene el id, los roles y la dirección del emisor. No indica cómo inicia sesión la cuenta ni cuál es su nombre visible. `getUserProfile(c)` lee estos datos desde el almacén de autenticación:

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

`providers` enumera cómo puede iniciar sesión la cuenta: `"password"` cuando tiene una, y luego cada proveedor vinculado (`"google"`, `"apple"`, …) en el orden en que fue vinculado. Una cuenta de invitado, o una que inicia sesión únicamente con un código de un solo uso, tiene una lista vacía.

La lectura es fresca para cada solicitud: un proveedor que el emisor vinculó hace un momento se refleja en su siguiente solicitud, sin esperar a que el token se actualice. La primera llamada en una solicitud cuesta dos búsquedas indexadas (keyed lookups), realizadas conjuntamente. Las llamadas posteriores en la misma solicitud reutilizan el resultado, y una solicitud que nunca lo llama no tiene costo.

Devuelve `undefined` para un emisor anónimo, para llamadas con clave de servicio o clave de API que no actúan en nombre de ninguna cuenta, y para cuentas que ya no existen. También devuelve `undefined` en un backend cuyas cuentas residen en un [adaptador de autenticación](/docs/backend/auth-adapters/) externo: consulta a ese proveedor en su lugar. Cuando un administrador envía `x-rebase-impersonate`, devuelve la cuenta personificada.

### Proteger rutas

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

Coloca los guards en la **propia posición de middleware de la ruta**, como se muestra arriba, en lugar de usar `app.use("/*", requireAuth)`. `use()` solo cubre las rutas declaradas *debajo* de él, por lo que una ruta agregada posteriormente — al final del archivo, meses después — quedaría desprotegida silenciosamente.

:::important
Leer `getUser(c)` **no** es un guard. Un emisor anónimo obtiene `undefined` y tu manejador se ejecuta de todos modos. Solo un guard, o un `if (!user) return 401` explícito, detiene la solicitud.
:::

### Scopes y scopes de aplicación

`requireAdmin` admite el rol `admin` y a nadie más. Para una acción a la que deba acceder un rol más restringido o una clave de API, protege la ruta con `requireScope`. Acepta un [scope](/docs/backend/roles-and-scopes/) integrado, o uno que la aplicación declare en `auth.scopes` en la colección de usuarios, como `"project:deploy": { label: "Deploy projects", target: "project" }`:

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

Cualquier persona que haya iniciado sesión tiene todos los scopes de la aplicación, por lo que para una persona `requireScope` no decide nada: verifica en el manejador si esta persona puede desplegar este proyecto. Lo que aporta el scope es una forma de **restringir una clave**: una clave que contenga `project:deploy:p1` pasa solo para `p1`. Una clave también necesita `functions:invoke`, o `functions:invoke:<name>`, antes de poder llegar a la función. Consulta [Scopes de aplicación](/docs/backend/roles-and-scopes/#app-scopes).

### Límites de tasa (Rate limits)

Una ruta con costo por llamada puede usar el middleware `rateLimit`, el cual contabiliza entre réplicas. Consulta [Límites de tasa en funciones](/docs/backend/function-rate-limits/).

### Autenticación con clave de servicio

Rebase admite una variable estática `REBASE_SERVICE_KEY` definida en tu `.env` para llamadas mediante scripts o de servidor a servidor.

Cuando una solicitud externa envía la clave de servicio mediante el encabezado Authorization (`Authorization: Bearer <service_key>`), el middleware de autenticación automáticamente:
1. Valida la clave utilizando una comparación de tiempo constante para evitar ataques de temporización (timing attacks).
2. Concede acceso a nivel de administrador, asignando al emisor `{ uid: "service", roles: ["admin"] }`.
3. Inyecta un `DataDriver` con el alcance de esa misma identidad de servicio. La Seguridad a Nivel de Fila (RLS) sigue aplicando — se evalúa como `{ uid: "service", roles: ["admin"] }`, no se omite.

### Autoautenticación interna

Si no has configurado una `REBASE_SERVICE_KEY`, Rebase genera una **clave interna aleatoria por cada arranque**. El singleton `rebase` utiliza esta clave automáticamente al llamar a las APIs del plano de control propias del servidor (como `rebase.auth` o `rebase.storage`). Esto significa que tu lógica del lado del servidor siempre puede realizar tareas administrativas incluso sin una clave de servicio configurada manualmente.

## Acceso a la base de datos y servicios

### 1. El driver con alcance de usuario — para cualquier cosa que atienda una solicitud

`getDriver(c)` devuelve el driver **con el alcance del emisor**, por lo que cada lectura y escritura se evalúa frente a tus políticas de Seguridad a Nivel de Fila (RLS) como ese usuario:

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

`requireDriver(c)` es `getDriver(c)` sin el `!` — lanza un mensaje indicando el problema de configuración en lugar de fallar veinte líneas más tarde por un `undefined`.

`fetchCollection` y `fetchOne` devuelven las filas que devuelve `GET /api/data/<table>`: fechas como strings RFC 3339, una relación `belongsTo` como su clave foránea (`authorId`), y una fila relacionada solo cuando `include` la especifica — `driver.fetchOne({ path: "articles", id, include: ["author"] })`.

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

### Driver con alcance RLS vs. Singleton de Rebase

|                     | `getDriver(c)` (alcance de solicitud)          | `rebase.dataAsAdmin` (identidad de servicio)                     |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **Se ejecuta como** | El emisor (`uid`, sus roles)                   | `{ uid: "service", roles: ["admin"] }`                            |
| **Aplicación de RLS** | ✅ Sí (evaluado contra el emisor)            | ✅ Sí (evaluado contra la identidad de servicio)                 |
| **Ideal para...**   | CRUD general de usuarios, búsquedas y consultas | Trabajos en segundo plano, triggers del sistema, webhooks        |
| **Estilo de API**   | Métodos a nivel de driver (`fetchCollection`, `save`) | Accesores de tabla fluidos (`rebase.dataAsAdmin.jobs.find`)     |

#### Qué es exactamente `dataAsAdmin`

`rebase.dataAsAdmin` tiene **alcance de administrador, no omite RLS**. El driver se configura una vez, en el arranque, con `withAuth({ uid: "service", roles: ["admin"] })`, por lo que cada lectura y escritura se ejecuta dentro de una transacción que ha cambiado al rol restringido `rebase_user` con `app.uid = 'service'`. Tus políticas se evalúan — contra esa identidad.

Para la mayoría de los proyectos esta distinción nunca se nota, porque las políticas predeterminadas que Rebase inyecta en cada tabla admiten `serverContext() OR rolesOverlap(['admin'])`, y la identidad de servicio cumple con la segunda condición. Se hace evidente en el momento en que escribes tus propias políticas:

- **`policy.serverContext()` es falso para este.** Ese helper se compila como `rebase.uid() IS NULL`, y el `uid` de este accesor es `'service'`. Una tabla con `defaultPolicies: false` cuya única regla de escritura sea `serverContext()` rechazará una escritura de `dataAsAdmin` con el error de Postgres `42501`, y una lectura contra dicha tabla devolverá **cero filas con HTTP 200** — la variante silenciosa. Escribe `rolesOverlap(["admin"])` (o agrégalo junto a este) cuando te refieras a "mi backend".
- **Su alcance equivale al alcance de un usuario `admin`.** Otorgar el rol `admin` a un usuario de la aplicación le otorga exactamente las filas que este accesor puede ver. No es un canal privado.

### 3. `getSql(c)` — SQL como el emisor

Cuando el SDK no exprese una consulta o una escritura limpiamente — un upsert condicional, un compare-and-swap `UPDATE … WHERE rev = $3 RETURNING`, `count(*) FILTER (…)`, una CTE — escribe el SQL y ejecútalo como el emisor:

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
Los valores son los de Postgres, con dos expresados como los expresa `/api/data`: un `timestamptz` es RFC 3339 en UTC (`2026-11-18T10:52:23.500Z`), y un `bigint` es un número cuando cabe en un entero seguro (más allá de 2^53 se mantiene como dígitos, en formato string). Un `numeric` es un string, para no perder dígitos; haz un cast en la consulta (`total::float8`) cuando desees un número.

La sentencia se ejecuta en la propia transacción del emisor, como el rol restringido `rebase_user` con su identidad — la transacción que abre el driver con alcance de usuario —, por lo que las reglas `rls` de tus tablas determinan cada fila, exactamente igual que lo hacen para el SDK. Una consulta que pida todas las filas obtendrá únicamente las del emisor.

- **De solo lectura de forma predeterminada.** Pasa `{ write: true }` para insertar, actualizar o eliminar; las políticas de inserción y actualización siguen aplicando.
- **El texto de la consulta es tuyo; los valores van en `params`** (`$1`, `$2`, …). La identidad del emisor reside en la configuración de la transacción, la cual puede ser modificada por SQL, por lo que una sentencia que pueda hacerlo — `SET`, `RESET`, `set_config`, `pg_settings`, `DO`, más de una sentencia — es rechazada con `400 SQL_NOT_ALLOWED` antes de ejecutarse. Interpolar la entrada del usuario en el texto es la forma en que se pondría a prueba ese control; no lo hagas.
- **Lo que comparte con el SDK.** Las políticas y tres reglas que Postgres mantiene para ambos: una [vista materializada](/docs/collections/views/#materialized-views) entrega sus filas únicamente a sus `roles`, una fila de una tabla que declara `tenant` no puede moverse a otro tenant excepto por un emisor con `bypassRoles` (`TENANT_IMMUTABLE`), y las funciones propias del servidor (`rebase.record_history`, `rebase.enqueue_job`) son rechazadas. Una columna que el emisor no tenga permiso de leer — `.private()`, o un `.access({ read })` del que carezca — se descarta de las filas, tal como la API la descarta, cuando es una referencia simple a la columna (`SELECT *`, `password_hash AS h`); un valor *calculado* a partir de ella (`md5(password_hash)`) no se reconoce, así que no realices cálculos a partir de ella.
- **Lo que no comparte.** `beforeQuery` y `afterRead`, validación, hooks de guardado e historial residen en Node y no se ejecutan.

Desde un script, [`openRebase`](/docs/backend/embedding-postgres-driver/) te ofrece lo mismo: `(await rebase.withAuth(user)).sql(…)`.

#### `rebase.sqlAsAdmin()` — SQL como la identidad de servicio

Una función que aplica sus propias reglas (un ticket por día, una verificación de tiempo) sobre tablas que solo los administradores pueden leer no puede usar `getSql(c)`: el emisor necesitaría políticas que lo admitan, y esas mismas políticas abrirían las tablas en la API pública de datos también. `rebase.sqlAsAdmin` ejecuta la sentencia como `{ uid: "service", roles: ["admin"] }`, la identidad que utiliza `rebase.dataAsAdmin`, bajo la misma seguridad a nivel de fila:

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

Es `getSql(c)` con una identidad diferente: el rol restringido de solicitud, la rama de administrador de tus políticas, de solo lectura a menos que se especifique `{ write: true }`, y la misma protección `SQL_NOT_ALLOWED`. A diferencia del `rebase.sql()` del propietario, no puede ejecutar DDL, y del almacén de autenticación solo alcanza lo que un administrador alcanza mediante la colección de usuarios: las sesiones, claves y secretos de MFA quedan fuera del alcance del rol de solicitud, y los hashes de contraseñas se descartan de las filas. Una sentencia aislada cuesta un único viaje de ida y vuelta (round trip), al igual que `rebase.sql()`. Desde un script, `openRebase()` también cuenta con esto.

### 4. `rebase.sql()` — SQL de propietario, y el único accesor exclusivo de Node

Si realmente necesitas una omisión incondicional, `rebase.sql()` es la solución: SQL sin procesar en la conexión del propietario, sin políticas, todas las filas. Es el elemento con más privilegios en el contexto de una función — incluso más que el accesor con "admin" en su nombre.

No está diseñado para crear tablas. Una tabla se [declara](/docs/schema/) con `defineTable` en `backend/schema/` y se crea durante el arranque; una creada con `CREATE TABLE` dentro de una función no tiene validación, hooks, configuración de seguridad a nivel de fila, vista de administración ni tipado en el SDK. `rebase.sql()` ejecuta dicha sentencia y registra una advertencia indicando la tabla que debería declararse en su lugar.

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

Se ejecuta sobre una conexión TCP a tu base de datos, lo que lo convierte en el único accesor vinculado a un proceso de Node. Eso no implica ninguna desventaja en los despliegues actuales — es simplemente lo único a tener en cuenta si una función pudiera migrarse más adelante. Consulta [Portabilidad de runtime](#portabilidad-de-runtime).

:::caution[El acceso directo a Drizzle es exclusivo de Node]
También puedes importar tu propia instancia de Drizzle y consultarla directamente (`db.execute(sql\`…\`)`). Funciona, y en un despliegue de Node autohospedado o administrado está bien.

Vale la pena saber lo que implica: una función que importa `drizzle-orm` y un pool de `pg` es permanentemente una función de Node, elude los hooks de tu tabla que `rebase.data` sí ejecuta (ninguno de los dos verifica `.validate()`, que aplica a las [solicitudes de API](/docs/collections/validation-and-conditions/#where-validation-runs)), y toma su conexión de un lugar ajeno a la solicitud. `rebase.sql()` te proporciona el mismo SQL directo a través de la propia conexión del framework, y `getSql(c)` te lo ofrece bajo las políticas del emisor. Es preferible utilizar estas opciones.
:::

## Configuración y secretos

Lee la configuración **dentro** del manejador, nunca a nivel de módulo:

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

Una lectura a nivel de módulo se evalúa cuando se importa el archivo, antes de que exista cualquier solicitud. En Node, eso significa que una variable faltante derriba todo el archivo y todas las rutas en él. En un host que adjunta la configuración a la solicitud en lugar de al proceso, no hay nada que leer en el momento de la importación.

- `getEnv(c)` — todas las variables visibles para esta solicitud
- `env(c, "NAME")` — una variable, recortada (trimmed); un valor en blanco se considera no establecido
- `requireEnv(c, "NAME")` — lo mismo, pero lanza un mensaje indicando el nombre de la variable
- `lazyResource(factory)` — construye un cliente costoso una sola vez, en el primer uso

`rebase doctor` reporta lecturas de `process.env` a nivel de módulo en tu directorio de funciones.

## Trabajo en segundo plano

Trasladado a su propia página: [Trabajo en segundo plano](/docs/backend/background-work/).

## Portabilidad de runtime

Una función personalizada es una aplicación de Hono, por lo que el hecho de que pueda ejecutarse en un entorno distinto a un proceso de Node se reduce a lo que importa su propio archivo. `rebase.sql()`, un cliente de base de datos importado directamente y los módulos integrados de Node la atan a Node; el resto de `rebase` y la plataforma web no lo hacen, y nada falla hoy por causa de ninguno de los dos. [Portabilidad de runtime](/docs/backend/runtime-portability/) enumera lo que es portable, cómo lo reportan `rebase build` y `rebase doctor`, y cómo crear ramas según el runtime.

## Orden de registro de rutas

Las funciones personalizadas se cargan y montan **después** de que `initializeRebaseBackend()` completa la configuración inicial. El orden de inicialización es:

1. **Inicializadores (Bootstrappers)** — Conexiones a base de datos, tablas de autenticación, servicios en tiempo real
2. **Rutas de autenticación** — `/api/auth/*`, `/api/admin/*`
3. **Rutas de almacenamiento** — `/api/storage/*`
4. **Rutas de datos** — `/api/data/*` (CRUD para tablas)
5. **Funciones personalizadas** ← `/api/functions/*`
6. **Cron jobs** — `/api/admin/cron/*`
7. **WebSocket** — Suscripciones en tiempo real

Esto significa que tus funciones personalizadas tienen acceso a todos los servicios inicializados. Registra cualquier ruta que deba ejecutarse **antes** de Rebase directamente en la aplicación de Hono, previo a invocar `initializeRebaseBackend()`:

```typescript no-verify
const app = new Hono<HonoEnv>();

// This runs BEFORE Rebase routes
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase initialization — registers all /api/* routes
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
Las rutas que agregas a tu propia aplicación de esa manera están **fuera** de cualquier router de Rebase, por lo que ningún middleware de autenticación se ha ejecutado en ellas y `getDriver(c)` no está establecido. Protege esas rutas con `requireAuth` / `requireAdmin` importados desde **`@rebasepro/server`** — la raíz del paquete —, los cuales verifican el token por sí mismos. Los guards en la subruta `/functions` leen una identidad que un router de Rebase ya ha resuelto, y responderán 500 en lugar de fingir que existe una.
:::

## Ejemplo: Manejador de webhooks

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

Registra desde una función con `logger` de `@rebasepro/server/functions`, no con `console.log`: consulta [Logging](/docs/backend/logging/). Cuando las funciones se cargan, el arranque registra `Loaded custom functions` con su cantidad. La línea correspondiente a cada función se registra en el nivel `debug` (`LOG_LEVEL=debug`):

```
Loaded function route: hello
```

Si la carga falla, el cargador proporciona una salida de diagnóstico:

```
[functions] broken-function.ts: default export is not a Hono app or factory. Skipping.
  export type: object (SomeClass)
  prototype methods: constructor, someMethod
  Hint: ensure the function exports a Hono app created with the same hono version as the server.
  Author with `defineFunction(...)` from @rebasepro/server/functions for a typed, checked contract.
  The loader checks for .fetch() and .routes — any Hono-compatible app will work.
```

El router se monta para el **directorio**, no para las funciones dentro de él. Si la importación de cada archivo falla — una variable de entorno faltante a nivel de módulo es suficiente para derribarlos a todos —, `GET /api/functions` seguirá respondiendo `200` con una lista vacía más un contador de `skipped`, de modo que "nada se cargó" se distinga de "esta compilación no incluía funciones". El listado en sí requiere un emisor que haya iniciado sesión, una clave de API que contenga el scope simple `functions:invoke`, o la clave de servicio — las funciones siguen siendo invocables por quienquiera que cada una admita, pero el inventario de las mismas no es público. Los motivos permanecen en el registro de arranque.

## Tiempos de espera y límites de tasa

Se aplican dos límites máximos a `/api/functions/*`:

- **Tiempo de espera de la solicitud (Request timeout)** — 30 segundos de forma predeterminada, respondiendo `504` con el código `FUNCTION_TIMEOUT`. Configúralo para todas las funciones con `functionsTimeoutMs` (o `REBASE_FUNCTIONS_TIMEOUT_MS`); `0` lo desactiva. Una función que espere a un servicio lento, como un LLM, declara el suyo propio como segundo argumento de `defineFunction`: `defineFunction((app) => { … }, { timeoutMs: 150_000 })`. Esto reemplaza el tiempo de espera global del servidor solo para esa función, ya sea mayor o menor, se cuenta desde el momento en que la solicitud llega al router de funciones, y aplica incluso cuando el global del servidor sea `0`; el servidor lo limita a `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` (300000, 5 minutos, de forma predeterminada) y no puede ser `0`. El mensaje del 504 indica qué límite se aplicó y dónde se configuró, y `error.details` lo incluye como `{ timeoutMs, source }` (`source` puede ser `default`, `env`, `option` o `function`). El manejador no puede ser detenido desde el exterior, pero se le notifica: el `getSignal(c)` de `@rebasepro/server/functions` se aborta en el momento del 504, por lo que debes pasarlo a `fetch` y a cualquier otra llamada que acepte una señal (`fetch(url, { signal: getSignal(c) })`). El trabajo al que no se le pase la señal continuará ejecutándose — el tiempo de espera libera al cliente y al socket, no al trabajo. El hecho de que el manejador *continúe ejecutándose* después del 504 es una propiedad de un proceso de Node de larga duración, no una garantía del contrato; cualquier tarea que deba completarse pertenece a [`waitUntil`](#trabajo-en-segundo-plano).
- **Límite de tasa (Rate limit)** — Los emisores con clave de API y los que han iniciado sesión comparten los buckets de la API de datos. Los emisores anónimos obtienen su propia cuota, mucho más permisiva (3000 por ventana), debido a que este router es público de forma predeterminada para los receptores de webhooks. Sobrescribe esto con `rateLimit.anonymousFunctions`; `null` lo desactiva.

Los rechazos de promesas no controlados (unhandled promise rejections) se registran en los logs en lugar de ser fatales: de lo contrario, una llamada de tipo fire-and-forget en una función terminaría con todo el proceso. Establece `REBASE_EXIT_ON_UNHANDLED_REJECTION=1` para el comportamiento predeterminado de Node.

En Rebase Cloud, el edge frente a tus funciones tiene sus propios límites, y el estado a nivel de módulo, el sistema de archivos y los puertos de salida se comportan de maneras que vale la pena conocer antes de diseñar en torno a ellos. Consulta [Runtime de backend administrado](/docs/deployment/managed-runtime/).

## Próximos pasos

- **[Descripción general del backend](/docs/backend)** — Referencia completa de configuración del backend
- **[Hooks de tabla](/docs/collections/callbacks)** — Ejecuta lógica ante cambios en los datos
- **[Cron Jobs](/docs/backend/cron-jobs)** — Tareas programadas en segundo plano
