---
sourceHash: c544e032b6e1f8c2
title: Funciones personalizadas
sidebar_label: Funciones personalizadas
description: Añade endpoints de API de Hono personalizados junto a tus rutas CRUD de Rebase. Detección automática desde un directorio, con acceso completo a la instancia del backend.
---

## Visión general

Las funciones personalizadas te permiten añadir **rutas de API de Hono arbitrarias** junto a los endpoints CRUD autogenerados de Rebase. Siguen el mismo patrón de **detección basada en archivos** que las colecciones y las tareas cron: coloca un archivo TypeScript en tu directorio `functions/`, y Rebase lo montará automáticamente.

Utiliza funciones personalizadas para:

- **Endpoints de lógica de negocio** — aprobaciones, promociones, flujos de trabajo personalizados
- **Integraciones con terceros** — webhooks de Stripe, comandos de Slack, proxies de API externas
- **Endpoints públicos** — formularios de contacto, captación de leads, comprobaciones de estado (health checks)
- **Consultas de agregación** — estadísticas de panel de control, informes, analítica

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

Esto se monta en **`/api/functions/hello`**. El nombre del archivo (sin la extensión) se convierte en el prefijo de la ruta.

`POST`, porque eso es lo que el SDK envía de forma predeterminada — consulta [Invocar desde el cliente](#invocar-desde-el-cliente). Una ruta `GET` es igual de válida; en ese caso, el emisor debe indicar `{ method: "GET" }`.

`rebase dev` observa el directorio de funciones, por lo que un archivo añadido mientras se está
ejecutando se monta en la siguiente recarga — sin reinicio. (Es necesario indicárselo: el
directorio se escanea en lugar de importarse, por lo que el observador no puede inferirlo).

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
`RebaseApiError` si la respuesta no es 2xx — de modo que la propia estructura de error de la función llega al
emisor en lugar de un simple rechazo de `fetch`.

Cuatro cosas que admite además del nombre:

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
`client.call("functions/hello", payload)` también accede a una función. Siempre
hace un `POST` y, al igual que `invoke`, devuelve el cuerpo literalmente — ninguno accede
a una clave `data`. Es preferible usar `functions.invoke`, que admite un método, una subruta y un
`responseType`; `call` existe para rutas montadas fuera de `/api/functions`, lo cual
`invoke` no puede expresar.
:::

:::important
Importa desde **`@rebasepro/server/functions`**, no desde `@rebasepro/server`.

Ambos funcionan. La subruta es la superficie de autoría *portable*: no incluye nada que requiera Node, por lo que una función escrita con ella puede ejecutarse en cualquier runtime de JavaScript. La raíz del paquete accede a todo el framework —la secuencia de arranque, los cargadores de archivos, la capa de WebSockets—, lo cual es adecuado para el punto de entrada de un servidor y más de lo que necesita un manejador de rutas. También proporciona accesores de contexto tipados (`getUser`, `getDriver`) en lugar de tener que hacer un cast manual de `c.get("user")`.

Consulta [Portabilidad del runtime](#portabilidad-del-runtime) para ver el contrato completo.
:::

## Configuración

:::note[Dónde va esto]
**Runtime gestionado:** nada que configurar — el runtime detecta `backend/functions/` por sí mismo (`functions` en la entrada `rebase.json` de la app de backend si lo has movido). `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE` delimitan cuáles atiende un proceso con `REBASE_ROLE=functions`; cualquier otro rol rechazará arrancar si están definidos.
**Ejected:** `initializeRebaseBackend({ functionsDir })`, o `functions` (a continuación), en `backend/src/index.ts`.
:::

Habilita las funciones personalizadas añadiendo `functionsDir` a la configuración de tu backend:

```typescript no-verify
import path from "path";

const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
});
```

Rebase se encargará de:

1. Escanear el directorio en busca de archivos `.ts` / `.js`
2. Validar que cada exportación por defecto sea una app de Hono (mediante duck typing a través de `.fetch()` + `.routes`)
3. Montar cada app en `/api/functions/<filename>`
4. Aplicar el middleware de autenticación (consulta [Autenticación](#autenticación-y-propagación-de-contexto) más abajo)

### Funciones como valores

Un directorio es una forma de generar lo que el servidor atiende: un registro desde el segmento de URL hasta la app de Hono. Puedes pasar ese registro tú mismo como `functions`, o leer un directorio en él mediante `loadFunctions`:

```typescript
import path from "path";
import { initializeRebaseBackend, loadFunctions } from "@rebasepro/server";
import sendInvoice from "../functions/send-invoice";

await initializeRebaseBackend({ app, server, functions: { "send-invoice": sendInvoice } }); // → /api/functions/send-invoice
// the same as functionsDir:
await initializeRebaseBackend({ app, server, functions: await loadFunctions(path.resolve(__dirname, "../functions")) });
```

Pasa `functions` o `functionsDir`, no ambos: el proceso de arranque rechazará la combinación. `loadFunctions(dir, { onSkip })` te entrega cada archivo que omitió, junto con el motivo. `loadFunctionsFromDirectory` y `loadFunctionsWithDiagnostics` todavía funcionan, están obsoletos y emitirán una advertencia una sola vez. Por sí solo, el grupo de funciones se monta en cualquier ruta con `app.route("/hooks", backend.routes.functions())`, y `getUser(c)` y `getDriver(c)` funcionan dentro de él; consulta [Integración con servidor personalizado](/docs/backend/custom-server/#mounting-only-the-groups-you-want).

## Nomenclatura de archivos y mapeo de rutas

| Archivo | Ruta de montaje |
|------|-----------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

Las funciones se detectan **únicamente en el nivel superior del directorio** — no hay recursión. `functions/admin/users.ts` se compila con `rebase build` pero nunca se monta; simplifica el nombre en su lugar (`functions/admin-users.ts`). Si hay un subdirectorio, se notificará al arrancar y se contabilizará en el endpoint de listado en lugar de ignorarse silenciosamente.

Archivos que se **omiten**:

- `index.ts` / `index.js` — reservados
- `*.test.ts` / `*.test.js` — archivos de pruebas
- `*.d.ts` — declaraciones de tipos
- Subdirectorios y archivos `.mts` / `.cts` / `.tsx` / `.jsx` / `.mjs` / `.cjs` — se notifican como incidencias, ya que la compilación procesa más archivos de los que el runtime carga

El nombre representa la identidad de la función en todos los demás ámbitos: es el segmento de la URL, el objetivo del scope `functions:invoke:<name>` que una clave necesita para invocarla, y el valor por el cual selecciona `REBASE_FUNCTIONS_ONLY` cuando asignas a una función su propio proceso.

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

### Función factoría

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server/functions";

export default function () {
    const app = new Hono<HonoEnv>();
    app.get("/status", (c) => c.json({ ok: true }));
    return app;
}
```

`defineFunction` devuelve exactamente la app de Hono que estos crean a mano, por lo que los tres son intercambiables. Te ahorra declarar `Hono<HonoEnv>` y te entrega el singleton `rebase` en el callback.

---

## Bajo el capó: El cargador por duck typing

En un monorepositorio, tus funciones pueden resolver una copia diferente de Hono a la que usa Rebase, y entonces `exported instanceof Hono` resultará falso para un enrutador plenamente funcional. Por ello, el cargador comprueba la forma en su lugar (`isHonoLike`): un objeto no nulo con un método `.fetch` y un array `.routes`.

### Escape del compilador de módulos ES

El cargador convierte la ruta de cada archivo en una URL de archivo (`pathToFileURL(filePath).href`), de modo que se importa tanto en Windows como en POSIX, y llama a `import(url)` mediante `new Function("url", "return import(url)")`, evitando que una compilación de TypeScript pueda reescribirlo como un `require()` que falle bajo ESM.

---

## Autenticación y propagación de contexto

Las funciones personalizadas se montan con el **mismo middleware de autenticación** que las rutas de datos, pero con `requireAuth: false`. Esto significa que:

- El JWT del usuario se **analiza e inyecta** en el contexto si está presente
- Sin embargo, las peticiones **no se rechazan** si no se proporciona ningún JWT
- Debes **proteger explícitamente** las rutas que requieran autenticación

Un emisor que presente un token *inválido* nunca llega a tu manejador: el propio middleware rechaza con un 401 un token no verificable o caducado, de modo que una sesión expirada nunca se degrada silenciosamente a una anónima.

### Leer al emisor

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

`getUser` devuelve un objeto tipado: `uid` es una cadena y `roles` siempre es un array, independientemente del método de autenticación utilizado por el emisor. `getUserId(c)` y `getRoles(c)` son atajos. `getScopes(c)` contiene todo lo que el emisor tiene permitido hacer, como cadenas de [scope](/docs/backend/roles-and-scopes/): para una persona, el plano de datos, los scopes propios de la aplicación y los scopes de sus roles; para una API key, exactamente los que posea la clave.

### La cuenta del emisor

<span class="since-badge" data-since="0.30">Since 0.30</span>

`getUser(c)` lee el token de acceso, y el token contiene el id, los roles y la dirección de correo del emisor. No indica cómo inicia sesión la cuenta ni cuál es su nombre para mostrar. `getUserProfile(c)` lo lee del almacén de autenticación:

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

`providers` enumera las formas en que la cuenta puede iniciar sesión: `"password"` cuando tiene una, y después cada proveedor vinculado (`"google"`, `"apple"`, …) en el orden en que se vinculó. Una cuenta de invitado, o una que inicia sesión solo con un código de un solo uso, tiene una lista vacía.

La lectura es nueva en cada petición: un proveedor que el emisor vinculó hace un momento aparece en su siguiente petición, sin esperar a que el token se renueve. La primera llamada dentro de una petición cuesta dos búsquedas por clave, realizadas a la vez. Las llamadas posteriores en la misma petición reutilizan el resultado, y una petición que nunca la llama no cuesta nada.

Devuelve `undefined` para un emisor anónimo, para un emisor con service key o API key que no actúa como ninguna cuenta, y para una cuenta que ya no existe. También devuelve `undefined` en un backend cuyas cuentas viven en un [adaptador de autenticación](/docs/backend/auth-adapters/) externo: pregunta a ese proveedor. Cuando un administrador envía `x-rebase-impersonate`, devuelve la cuenta suplantada.

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

Coloca los guards en la **propia posición de middleware de la ruta**, como se muestra arriba, en lugar de usar `app.use("/*", requireAuth)`. `use()` solo cubre las rutas declaradas *por debajo* de él, por lo que una ruta añadida más adelante —al final del archivo, dentro de meses— quedaría desprotegida silenciosamente.

:::important
Leer `getUser(c)` **no** es un guard. Un emisor anónimo obtiene `undefined` y tu manejador se ejecutará igualmente. Solo un guard o un `if (!user) return 401` explícito detiene la petición.
:::

### Scopes y scopes de aplicación

`requireAdmin` da acceso al rol `admin` y a nadie más. Para una acción a la que deba acceder un rol más específico o una API key, protege la ruta con `requireScope`. Admite un [scope](/docs/backend/roles-and-scopes/) integrado, o uno que la app declare bajo `auth.scopes` en la colección de usuarios, como `"project:deploy": { label: "Deploy projects", target: "project" }`:

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

Toda persona autenticada dispone de todos los scopes de aplicación, por lo que para una persona `requireScope` no decide nada: comprueba en el manejador si esta persona tiene permitido desplegar este proyecto. Lo que aporta el scope es una forma de **restringir una clave**: una clave que tenga `project:deploy:p1` solo pasará para `p1`. Una clave también necesita `functions:invoke`, o `functions:invoke:<name>`, antes de poder llegar a la función. Consulta [Scopes de aplicación](/docs/backend/roles-and-scopes/#app-scopes).

### Autenticación mediante Service Key

Rebase admite una clave estática `REBASE_SERVICE_KEY` definida en tu `.env` para llamadas desde scripts o de servidor a servidor.

Cuando una petición externa envía la clave de servicio mediante la cabecera Authorization (`Authorization: Bearer <service_key>`), el middleware de autenticación automáticamente:
1. Valida la clave utilizando una comparación de tiempo constante para evitar ataques de temporización (timing attacks).
2. Concede acceso de nivel de administrador, asignando al emisor como `{ uid: "service", roles: ["admin"] }`.
3. Inyecta un `DataDriver` con el alcance de esa misma identidad de servicio. La seguridad a nivel de fila (Row-Level Security o RLS) sigue aplicándose — se evalúa como `{ uid: "service", roles: ["admin"] }`, no se omite.

### Autenticación interna automática

Si no has configurado una `REBASE_SERVICE_KEY`, Rebase genera una **clave interna aleatoria por cada arranque**. El singleton `rebase` utiliza esta clave automáticamente al llamar a las propias API del plano de control del servidor (como `rebase.auth` o `rebase.storage`). Esto significa que la lógica de tu servidor siempre puede realizar tareas administrativas incluso sin una clave de servicio configurada manualmente.

## Acceder a la base de datos y a los servicios

### 1. El driver con ámbito de usuario — para cualquier cosa que atienda una petición

`getDriver(c)` devuelve el driver **con el ámbito del emisor**, por lo que cada lectura y escritura se evalúa contra tus políticas de Row-Level Security como ese usuario:

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

`requireDriver(c)` es `getDriver(c)` sin el `!` — lanza un mensaje indicando el problema de configuración en lugar de fallar veinte líneas después por un `undefined`.

### 2. `rebase.dataAsAdmin` — para tareas en segundo plano de confianza

```typescript
import { defineFunction, requireAuth, requireAdmin } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.post("/:id/approve", requireAuth, requireAdmin, async (c) => {
        const id = c.req.param("id");
        await rebase.dataAsAdmin.collection<Record<string, unknown>>("jobs").update(id, {
            status: "published",
            approved_at: new Date().toISOString(),
        });
        return c.json({ success: true });
    });
});
```

`rebase.dataAsAdmin` no está tipado hasta que [registres tu `Database` generada](/docs/backend/typed-server-data).

### Driver con ámbito RLS vs. Singleton de Rebase

|                     | `getDriver(c)` (ámbito de la petición)         | `rebase.dataAsAdmin` (identidad de servicio)                     |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **Se ejecuta como** | El emisor (`uid`, sus roles)                   | `{ uid: "service", roles: ["admin"] }`                            |
| **Aplicación de RLS** | ✅ Sí (evaluado contra el emisor)             | ✅ Sí (evaluado contra la identidad de servicio)                 |
| **Ideal para...**   | CRUD general de usuario, búsquedas y consultas | Trabajos en segundo plano, triggers del sistema, webhooks        |
| **Estilo de API**   | Métodos a nivel de driver (`fetchCollection`, `save`) | Accesores fluidos de colección (`rebase.dataAsAdmin.jobs.find`) |

#### Qué es exactamente `dataAsAdmin`

`rebase.dataAsAdmin` tiene **ámbito de administrador, no omite RLS**. El driver se configura una sola vez, en el arranque, con `withAuth({ uid: "service", roles: ["admin"] })`, de modo que cada lectura y escritura se ejecuta dentro de una transacción que ha cambiado al rol restringido `rebase_user` con `app.uid = 'service'`. Tus políticas se evalúan — contra esa identidad.

Para la mayoría de los proyectos esta distinción nunca se nota, porque las políticas predeterminadas que Rebase inyecta en cada colección permiten `serverContext() OR rolesOverlap(['admin'])`, y la identidad de servicio cumple la segunda condición. Se hace evidente en el momento en que escribes tus propias políticas:

- **`policy.serverContext()` es falso para él.** Ese helper se compila como `rebase.uid() IS NULL`, y el `uid` de este accesor es `'service'`. Una colección con `disableDefaultPolicies: true` cuya única regla de escritura sea `serverContext()` rechazará una escritura de `dataAsAdmin` con el error de Postgres `42501`, y una lectura contra dicha colección devolverá **cero filas con HTTP 200** — la vía silenciosa. Escribe `rolesOverlap(["admin"])` (o añádelo junto a él) cuando te refieras a "mi backend".
- **Su alcance es igual al de un usuario `admin`.** Conceder el rol `admin` a un usuario de la aplicación le otorga acceso exactamente a las mismas filas que ve este accesor. No es un canal privado.

### 3. `getSql(c)` — SQL como el emisor

Cuando el SDK no expresa una consulta o una escritura con claridad —un upsert condicional, un `UPDATE … WHERE rev = $3 RETURNING` de comparar e intercambiar, `count(*) FILTER (…)`, una CTE—, escribe el SQL y ejecútalo como el emisor:

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

La sentencia se ejecuta en la propia transacción del emisor, como el rol restringido `rebase_user` y con su identidad —la transacción que abre el driver con ámbito de usuario—, así que las reglas de seguridad de tus colecciones deciden cada fila, exactamente igual que con el SDK. Una consulta que pide todas las filas obtiene las del emisor.

- **Solo lectura por defecto.** Pasa `{ write: true }` para insertar, actualizar o eliminar; las políticas de inserción y actualización siguen aplicándose.
- **El texto de la consulta es tuyo; los valores van en `params`** (`$1`, `$2`, …). La identidad del emisor vive en ajustes de la transacción, que el SQL puede cambiar, así que una sentencia que podría hacerlo —`SET`, `RESET`, `set_config`, `pg_settings`, `DO`, más de una sentencia— se rechaza con `400 SQL_NOT_ALLOWED` antes de ejecutarse. Interpolar la entrada del usuario en el texto es justo lo que pondría a prueba esa protección; no lo hagas.
- **Lo que comparte con el SDK.** Las políticas, y tres reglas que Postgres mantiene para ambos: una [vista materializada](/docs/collections/views/#materialized-views) sirve sus filas solo a sus `roles`, una fila de una colección que declara `tenant` no se puede trasladar a otro tenant salvo por un emisor de `bypassRoles` (`TENANT_IMMUTABLE`), y las funciones propias del servidor (`rebase.record_history`, `rebase.enqueue_job`) se rechazan. Una columna que el emisor no puede leer —`excludeFromApi`, o un `access.read` que no tiene— se elimina de las filas, igual que lo hace la API, cuando es una referencia simple a la columna (`SELECT *`, `password_hash AS h`); un valor *calculado* a partir de una (`md5(password_hash)`) no se reconoce, así que no calcules a partir de ella.
- **Lo que no comparte.** `beforeQuery` y `afterRead`, la validación, los callbacks de guardado y el historial viven en Node y no se ejecutan.

Desde un script, [`openRebase`](/docs/backend/embedding-postgres-driver/) te da lo mismo: `(await rebase.withAuth(user)).sql(…)`.

#### `rebase.sqlAsAdmin()` — SQL como la identidad de servicio

<span class="since-badge" data-since="0.30">Since 0.30</span>

Una función que aplica sus propias reglas (un ticket al día, una comprobación de tiempo) sobre tablas que solo los administradores pueden leer no puede usar `getSql(c)`: el emisor necesitaría políticas que lo admitieran, y esas mismas políticas abrirían también las tablas en la API de datos pública. `rebase.sqlAsAdmin` ejecuta la sentencia como `{ uid: "service", roles: ["admin"] }`, la identidad que usa `rebase.dataAsAdmin`, bajo la misma seguridad a nivel de fila:

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

Es `getSql(c)` con otra identidad: el rol restringido de las solicitudes, la rama de administrador de tus políticas, solo lectura salvo con `{ write: true }`, y la misma protección `SQL_NOT_ALLOWED`. A diferencia del `rebase.sql()` del propietario, no puede ejecutar DDL, y del almacén de autenticación solo alcanza lo que un administrador alcanza a través de la colección de usuarios: las sesiones, las claves y los secretos MFA quedan fuera del rol de las solicitudes, y un hash de contraseña se elimina de las filas. Una sentencia aislada cuesta un viaje de ida y vuelta, como `rebase.sql()`. Desde un script, `openRebase()` también lo tiene.

### 4. `rebase.sql()` — SQL del propietario, y el único accesor exclusivo de Node

Si realmente necesitas una omisión incondicional, `rebase.sql()` es la opción: SQL puro en la conexión del propietario, sin políticas, todas las filas. Es el elemento con más privilegios en el contexto de una función —más que el accesor que lleva "admin" en su nombre.

No está diseñado para crear tablas. Una tabla es una [colección](/docs/collections/), declarada en `config/collections/` y creada en el arranque; una creada con `CREATE TABLE` en una función carece de validación, callbacks, reglas de seguridad, vista de administración o tipo en el SDK. `rebase.sql()` ejecuta dicha sentencia y registra una advertencia indicando la colección que se debería declarar en su lugar.

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

Se ejecuta sobre una conexión TCP a tu base de datos, lo que lo convierte en el único accesor vinculado a un proceso de Node. Esto no supone ningún coste en ningún despliegue existente hoy en día —es simplemente el único factor a tener en cuenta si una función pudiera migrarse más adelante. Consulta [Portabilidad del runtime](#portabilidad-del-runtime).

:::caution[El acceso directo a Drizzle es solo para Node]
También puedes importar tu propia instancia de Drizzle y consultarla directamente (`db.execute(sql\`…\`)`). Funciona, y en un despliegue de Node autohospedado o gestionado es adecuado.

Conviene saber qué implica: una función que importa `drizzle-orm` y un pool de `pg` es permanentemente una función de Node, elude los callbacks de tus colecciones que `rebase.data` sí ejecuta (ninguno de los dos comprueba `validation`, la cual se aplica a [peticiones de API](/docs/collections/validation-and-conditions/#where-validation-runs)), y toma su conexión de un origen distinto al de la petición. `rebase.sql()` te ofrece el mismo SQL puro a través de la propia conexión del framework, y `getSql(c)` te lo ofrece bajo las políticas del emisor. Son las opciones recomendadas.
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

Por qué esto importa en **cualquier** runtime, incluido Node:

```typescript no-verify
// Don't. If STRIPE_SECRET_KEY is unset, this throws while the file is being
// imported — and the loader reports that as a *skipped function*. The route
// 404s, with the reason buried in a boot log line.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

Una lectura a nivel de módulo se evalúa cuando se importa el archivo, antes de que exista ninguna petición. En Node, eso significa que una sola variable ausente tumba el archivo entero y cada una de las rutas que contiene. En un proveedor de hosting que asocia la configuración a la petición en lugar de al proceso, no hay nada que leer en el momento de la importación.

- `getEnv(c)` — todas las variables visibles para esta petición
- `env(c, "NAME")` — una variable, sin espacios en blanco adicionales; un valor en blanco cuenta como no definido
- `requireEnv(c, "NAME")` — lo mismo, pero lanza un mensaje indicando el nombre de la variable
- `lazyResource(factory)` — construye un cliente costoso una sola vez, en el primer uso

`rebase doctor` advierte sobre las lecturas de `process.env` a nivel de módulo en tu directorio de funciones.

## Trabajo en segundo plano

Se ha movido a su propia página: [Trabajo en segundo plano](/docs/backend/background-work/).

## Portabilidad del runtime

Una función personalizada es una app de Hono, por lo que la posibilidad de ejecutarla fuera de un proceso de Node depende de lo que importe su propio archivo. `rebase.sql()`, un cliente de base de datos importado directamente y los módulos integrados de Node la vinculan a Node; el resto de `rebase` y la plataforma web no lo hacen, y nada falla hoy por ninguno de ellos. [Portabilidad del runtime](/docs/backend/runtime-portability/) enumera lo que es portable, cómo lo reportan `rebase build` y `rebase doctor`, y cómo aplicar condicionales según el runtime.

## Orden de registro de rutas

Las funciones personalizadas se cargan y montan **después** de que `initializeRebaseBackend()` complete la configuración básica. El orden de inicialización es:

1. **Bootstrappers** — Conexiones a bases de datos, tablas de autenticación, servicios en tiempo real
2. **Rutas de autenticación** — `/api/auth/*`, `/api/admin/*`
3. **Rutas de almacenamiento** — `/api/storage/*`
4. **Rutas de datos** — `/api/data/*` (CRUD para colecciones)
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
Las rutas que añadas a tu propia app de ese modo quedan **fuera** de cualquier enrutador de Rebase, por lo que ningún middleware de autenticación se habrá ejecutado en ellas y `getDriver(c)` no estará definido. Protege esas rutas con `requireAuth` / `requireAdmin` importados desde **`@rebasepro/server`** —la raíz del paquete—, que verifican el token por sí mismos. Los guards de la subruta `/functions` leen una identidad que un enrutador de Rebase ya ha resuelto, y responderán con un 500 en lugar de simular que existe una.
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
            await rebase.dataAsAdmin.collection("subscriptions").create({
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

Cuando se cargan las funciones, el arranque registra en los logs `Loaded custom functions` junto con su cantidad. La línea individual de cada función se registra a nivel `debug` (`LOG_LEVEL=debug`):

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

El enrutador se monta para el **directorio**, no para las funciones individuales que contiene. Si todos los archivos fallan al importarse —una sola variable de entorno ausente a nivel de módulo es suficiente para tumbarlos todos—, `GET /api/functions` responderá igualmente `200` con una lista vacía más el conteo de `skipped`, de modo que se puede distinguir entre "no se cargó nada" y "esta compilación no incluye funciones". El listado en sí requiere un emisor autenticado, una API key que posea el scope estándar `functions:invoke`, o la clave de servicio — las funciones permanecen invocables para quien cada una autorice, pero el inventario de las mismas no es público. Los motivos detallados permanecen en el log de arranque.

## Tiempos de espera y límites de tasa

Se aplican dos límites a `/api/functions/*`:

- **Tiempo de espera de la petición (Request timeout)** — 30 segundos por defecto, respondiendo `504` con el código `FUNCTION_TIMEOUT`. Se configura con `functionsTimeoutMs` (o `REBASE_FUNCTIONS_TIMEOUT_MS`); `0` lo desactiva. El manejador no se puede detener desde el exterior, pero sí se le notifica: `getSignal(c)` de `@rebasepro/server/functions` se aborta en el momento del 504, por lo que debes pasarlo a `fetch` y a cualquier otra función que admita una señal (`fetch(url, { signal: getSignal(c) })`). El trabajo al que no se le pase la señal continuará ejecutándose — el tiempo de espera libera al cliente y al socket, no al trabajo. Que el manejador *siga ejecutándose* después del 504 es una propiedad de un proceso de Node de larga duración, no una garantía del contrato; cualquier tarea que deba completarse obligatoriamente corresponde a [`waitUntil`](#trabajo-en-segundo-plano).
- **Límite de tasa (Rate limit)** — Los emisores autenticados y mediante API key comparten las cuotas de la API de datos. Los emisores anónimos obtienen una asignación propia mucho más permisiva (3000 por ventana) debido a que este enrutador es público por defecto para receptores de webhooks. Puedes anularlo con `rateLimit.anonymousFunctions`; `null` lo deshabilita.

Los rechazos de promesas no controlados se registran en los logs en lugar de ser fatales: de lo contrario, una llamada fire-and-forget en una función detendría todo el proceso. Establece `REBASE_EXIT_ON_UNHANDLED_REJECTION=1` para usar el comportamiento por defecto de Node.

En Rebase Cloud, el edge situado frente a tus funciones tiene sus propios límites, y
el estado a nivel de módulo, el sistema de archivos y los puertos de salida se comportan de maneras
que conviene conocer antes de diseñar en torno a ellos. Consulta
[Runtime de backend gestionado](/docs/deployment/managed-runtime/).

## Próximos pasos

- **[Visión general del backend](/docs/backend)** — Referencia completa de configuración del backend
- **[Callbacks de entidades](/docs/collections/callbacks)** — Ejecuta lógica ante cambios en los datos
- **[Cron Jobs](/docs/backend/cron-jobs)** — Tareas programadas en segundo plano
