---
sourceHash: 49840b693028a89f
title: Funciones personalizadas
sidebar_label: Funciones personalizadas
description: Añade endpoints de API de Hono personalizados junto con tus rutas CRUD de Rebase. Detección automática desde un directorio, con acceso completo a la instancia del backend.
---

## Descripción general

Las funciones personalizadas te permiten añadir **rutas de API de Hono arbitrarias** junto a los endpoints CRUD generados automáticamente por Rebase. Siguen el mismo patrón de **detección basada en archivos** que las colecciones y las tareas cron: añade un archivo TypeScript en tu directorio `functions/` y Rebase lo montará automáticamente.

Utiliza funciones personalizadas para:

- **Endpoints de lógica de negocio**: aprobaciones, promociones, flujos de trabajo personalizados
- **Integraciones con terceros**: webhooks de Stripe, comandos de Slack, proxies para APIs externas
- **Endpoints públicos**: formularios de contacto, captación de leads, comprobaciones de estado (health checks)
- **Consultas de agregación**: estadísticas de paneles de control, informes, analítica

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

Se utiliza `POST` porque es lo que el SDK envía por defecto; consulta [Invocar desde el cliente](#invocar-desde-el-cliente). Una ruta `GET` es igualmente válida; en ese caso, el emisor de la llamada debe indicar `{ method: "GET" }`.

`rebase dev` observa el directorio de funciones, por lo que un archivo añadido mientras está en ejecución se monta en la siguiente recarga, sin necesidad de reiniciar. (Debe notificarse: el directorio se escanea en lugar de importarse, por lo que el observador no puede inferirlo de antemano).

## Invocar desde el cliente

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "http://localhost:3000" });

const { message } = await client.functions.invoke<{ message: string }>(
    "hello",                 // the filename, without extension — one path segment
    { name: "Ada" }          // JSON body; omitted for a GET
);
```

`invoke` construye la URL, adjunta el token del emisor y lanza un `RebaseApiError` en respuestas que no sean 2xx, de modo que la estructura de error propia de la función llega al emisor en lugar de un simple rechazo de `fetch`.

Acepta cuatro parámetros adicionales más allá del nombre:

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
`client.call("functions/hello", payload)` también se comunica con una función. Siempre realiza un `POST` y, al igual que `invoke`, devuelve el cuerpo tal cual; ninguno de los dos busca una clave `data` interna. Es preferible usar `functions.invoke`, que admite un método, una subruta y un `responseType`; `call` existe para rutas montadas fuera de `/api/functions`, las cuales `invoke` no puede expresar.
:::

:::important
Importa desde **`@rebasepro/server/functions`**, no desde `@rebasepro/server`.

Ambos funcionan. La subruta es la superficie de desarrollo *portable*: no incluye nada que requiera Node, por lo que una función escrita con ella puede ejecutarse en cualquier entorno de JavaScript. La raíz del paquete abarca todo el framework —la secuencia de arranque, los cargadores de archivos, la capa de WebSockets—, lo cual es adecuado para el punto de entrada de un servidor, pero excesivo para un manejador de rutas. También proporciona descriptores de acceso de contexto tipados (`getUser`, `getDriver`) en lugar de hacer casting manual de `c.get("user")`.

Consulta [Portabilidad del entorno de ejecución](#portabilidad-del-entorno-de-ejecución) para conocer el contrato completo.
:::

## Configuración

:::note[Dónde va esto]
**Entorno de ejecución gestionado:** no hay nada que configurar; el entorno descubre `backend/functions/` automáticamente (`entry.functions` en `rebase.json` si lo has movido). `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE` restringen cuáles sirve un proceso.
**Eyectado:** `initializeRebaseBackend({ functionsDir })`, o `functions` (a continuación), en `backend/src/index.ts`.
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
2. Validará que cada exportación por defecto sea una aplicación de Hono (mediante tipado estructural/duck-typing a través de `.fetch()` + `.routes`)
3. Montará cada aplicación en `/api/functions/<filename>`
4. Aplicará el middleware de autenticación (consulta [Autenticación](#autenticación-y-propagación-de-contexto) más adelante)

### Funciones como valores

En la versión 0.24 las funciones solo provienen de un directorio.

Un directorio es una de las formas de generar lo que el servidor sirve: un registro que asigna un segmento de URL a una aplicación de Hono. Pasa ese registro tú mismo como `functions`, o lee un directorio en él mediante `loadFunctions`:

```typescript
import path from "path";
import { initializeRebaseBackend, loadFunctions } from "@rebasepro/server";
import sendInvoice from "../functions/send-invoice";

await initializeRebaseBackend({ app, server, functions: { "send-invoice": sendInvoice } }); // → /api/functions/send-invoice
// the same as functionsDir:
await initializeRebaseBackend({ app, server, functions: await loadFunctions(path.resolve(__dirname, "../functions")) });
```

Proporciona `functions` o `functionsDir`, no ambos: el proceso de arranque rechazará la combinación de los dos. `loadFunctions(dir, { onSkip })` te entrega cada archivo omitido junto con el motivo. `loadFunctionsFromDirectory` y `loadFunctionsWithDiagnostics` siguen funcionando, están obsoletas y emitirán una advertencia una sola vez. Por sí solo, el grupo de funciones se monta en cualquier ruta con `app.route("/hooks", backend.routes.functions())`, y `getUser(c)` y `getDriver(c)` funcionan dentro de él; consulta [Integración con servidor personalizado](/docs/backend/custom-server/#mounting-only-the-groups-you-want).

## Nombres de archivos y mapeo de rutas

| Archivo | Ruta de montaje |
|---------|-----------------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

Las funciones se descubren **únicamente en el nivel superior del directorio**; no hay recursión. `functions/admin/users.ts` se compila mediante `rebase build` pero nunca se monta; aplana el nombre en su lugar (`functions/admin-users.ts`). Si hay un subdirectorio, se notificará al arrancar y se contabilizará en el endpoint de listado en lugar de ignorarse silenciosamente.

Archivos que se **omiten**:

- `index.ts` / `index.js` — reservados
- `*.test.ts` / `*.test.js` — archivos de prueba
- `*.d.ts` — declaraciones de tipos
- Subdirectorios y archivos `.mts` / `.cts` / `.tsx` / `.jsx` / `.mjs` / `.cjs` — se reportan como problemas, ya que la compilación procesa más de lo que el entorno de ejecución carga

El nombre es también la identidad de la función en cualquier otro lugar: es el segmento de la URL, el objetivo del scope `functions:invoke:<name>` que necesita una clave para invocarla, y el valor por el cual `REBASE_FUNCTIONS_ONLY` filtra cuando asignas a una función su propio proceso.

## Formatos de exportación

El cargador acepta dos formatos de exportación además de `defineFunction`:

### Aplicación Hono

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

`defineFunction` devuelve exactamente la aplicación Hono que estas opciones construyen manualmente, por lo que las tres son intercambiables. Te ahorra declarar `Hono<HonoEnv>` y te entrega el singleton `rebase` en el callback.

---

## Bajo el capó: el cargador basado en Duck-Typing

En un monorepositorio, tus funciones pueden resolver una copia de Hono diferente a la que usa Rebase, en cuyo caso `exported instanceof Hono` resulta falso para un enrutador perfectamente válido. Por ello, el cargador comprueba la estructura (`isHonoLike`): un objeto no nulo con un método `.fetch` y un array `.routes`.

### Escape del compilador de módulos ES

El cargador convierte la ruta de cada archivo en una URL de archivo (`pathToFileURL(filePath).href`), de forma que se importe de la misma manera en Windows y en POSIX, y llama a `import(url)` a través de `new Function("url", "return import(url)")`, evitando que una compilación de TypeScript lo transforme en un `require()` que falle bajo ESM.

---

## Autenticación y propagación de contexto

Las funciones personalizadas se montan con el **mismo middleware de autenticación** que las rutas de datos, pero con `requireAuth: false`. Esto significa que:

- El JWT del usuario se **analiza e inyecta** en el contexto si está presente
- Sin embargo, las peticiones **no se rechazan** si no se proporciona un JWT
- Debes **proteger explícitamente** las rutas que requieran autenticación

Un emisor que presente un token *inválido* nunca llega a tu manejador: el middleware rechaza con un 401 un token que no se pueda verificar o que haya expirado, de modo que una sesión caducada nunca se degrada silenciosamente a una anónima.

### Leer los datos del emisor

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

`getUser` devuelve un objeto restringido: `uid` es un string y `roles` es siempre un array, sin importar el método de autenticación utilizado por el emisor. `getUserId(c)` y `getRoles(c)` son accesos directos. `getScopes(c)` contiene todo lo que el emisor tiene permitido hacer, en formato de cadenas de [scope](/docs/backend/roles-and-scopes/): para una persona, el plano de datos, los propios scopes de la aplicación y los scopes de sus roles; para una API key, exactamente lo que dicha clave contiene.

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

Coloca los protectores (guards) en el **espacio de middleware propio de la ruta**, como se muestra arriba, en lugar de utilizar `app.use("/*", requireAuth)`. `use()` solo cubre las rutas declaradas *por debajo* de él, por lo que una ruta añadida más tarde (al final del archivo, dentro de unos meses) quedaría desprotegida silenciosamente.

:::important
Leer `getUser(c)` **no** es un protector. Un llamador anónimo obtiene `undefined` y tu manejador se ejecuta de todos modos. Solo un protector, o un `if (!user) return 401` explícito, detiene la petición.
:::

### Scopes y app scopes

`requireAdmin` admite el rol `admin` y a nadie más. Para una acción a la que deba acceder un rol más específico o una API key, protege la ruta con `requireScope`. Acepta un [scope](/docs/backend/roles-and-scopes/) integrado o uno declarado por la aplicación en `auth.scopes` dentro de la colección de usuarios, como `"project:deploy": { label: "Deploy projects", target: "project" }`:

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

Cualquier persona autenticada posee todos los scopes de la aplicación, por lo que para un usuario `requireScope` no decide nada: comprueba dentro del manejador si esa persona puede desplegar ese proyecto. Lo que aporta el scope es una forma de **restringir una clave**: una clave que contenga `project:deploy:p1` solo tendrá permiso para `p1`. Una clave también necesita `functions:invoke`, o `functions:invoke:<name>`, antes de poder llegar a la función. Consulta [App scopes](/docs/backend/roles-and-scopes/#app-scopes).

### Autenticación mediante Service Key

Rebase admite una `REBASE_SERVICE_KEY` estática definida en tu `.env` para llamadas de scripts o de servidor a servidor.

Cuando una petición externa incluye la service key a través del encabezado Authorization (`Authorization: Bearer <service_key>`), el middleware de autenticación automáticamente:
1. Valida la clave utilizando una comparación en tiempo constante para evitar ataques de temporización.
2. Otorga acceso a nivel de administrador, asignando al emisor `{ uid: "service", roles: ["admin"] }`.
3. Inyecta un `DataDriver` configurado con esa misma identidad de servicio. La seguridad a nivel de fila (Row-Level Security o RLS) sigue aplicándose: se evalúa como `{ uid: "service", roles: ["admin"] }`, no se omite.

### Autoautenticación interna

Si no has configurado una `REBASE_SERVICE_KEY`, Rebase genera una **clave interna aleatoria por cada arranque**. El singleton `rebase` utiliza esta clave de forma automática cuando llama a las APIs del plano de control del propio servidor (como `rebase.auth` o `rebase.storage`). Esto significa que tu lógica del lado del servidor siempre puede realizar tareas administrativas incluso sin una service key configurada manualmente.

## Acceso a la base de datos y servicios

### 1. El driver con ámbito de usuario: para todo lo que atienda una petición

`getDriver(c)` devuelve el driver **con el ámbito del emisor**, de modo que cada lectura y escritura se evalúa contra tus políticas de Row-Level Security en nombre de ese usuario:

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

`requireDriver(c)` es `getDriver(c)` sin el operador `!`: lanza un mensaje indicando el problema de configuración en lugar de fallar veinte líneas más adelante con un error de `undefined`.

### 2. `rebase.dataAsAdmin`: para tareas en segundo plano de confianza

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

`rebase.dataAsAdmin` no tiene tipos hasta que [registres tu `Database` generada](/docs/backend/typed-server-data).

### Driver con ámbito de RLS vs. Singleton de Rebase

|                     | `getDriver(c)` (ámbito de petición)            | `rebase.dataAsAdmin` (identidad de servicio)                     |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **Se ejecuta como** | El emisor (`uid`, sus roles)                   | `{ uid: "service", roles: ["admin"] }`                            |
| **Aplicación de RLS** | ✅ Sí (se evalúa contra el emisor)            | ✅ Sí (se evalúa contra la identidad de servicio)                |
| **Ideal para...**   | Operaciones CRUD de usuario general, búsquedas y consultas | Trabajos en segundo plano, triggers del sistema, webhooks |
| **Estilo de API**   | Métodos a nivel de driver (`fetchCollection`, `save`) | Descriptores fluidos de colecciones (`rebase.dataAsAdmin.jobs.find`) |

#### Qué es `dataAsAdmin`, exactamente

`rebase.dataAsAdmin` tiene **ámbito de administrador, no omite RLS**. El driver se configura una sola vez, en el arranque, con `withAuth({ uid: "service", roles: ["admin"] })`, por lo que cada lectura y escritura se ejecuta dentro de una transacción que ha cambiado al rol restringido `rebase_user` con `app.uid = 'service'`. Tus políticas se evalúan: contra esa identidad.

Para la mayoría de los proyectos esta distinción nunca se nota, porque las políticas predeterminadas que Rebase inyecta en cada colección permiten `serverContext() OR rolesOverlap(['admin'])`, y la identidad de servicio cumple con la segunda condición. Se hace evidente en el momento en que escribes tus propias políticas:

- **`policy.serverContext()` es falso para él.** Ese helper compila a `rebase.uid() IS NULL`, y el `uid` de este descriptor de acceso es `'service'`. Una colección con `disableDefaultPolicies: true` cuya única regla de escritura sea `serverContext()` rechazará una escritura de `dataAsAdmin` con el error de Postgres `42501`, y una lectura contra dicha colección devolverá **cero filas con HTTP 200** (el comportamiento silencioso). Escribe `rolesOverlap(["admin"])` (o añádelo junto a ella) cuando quieras indicar "mi backend".
- **Su alcance equivale al alcance de un usuario `admin`.** Conceder el rol `admin` a un usuario de la aplicación le otorga acceso exactamente a las mismas filas que ve este descriptor de acceso. No es un canal privado.

### 3. `rebase.sql()`: SQL sin procesar y el único descriptor de acceso exclusivo de Node

Si realmente necesitas una omisión incondicional, `rebase.sql()` es la solución: SQL sin procesar sobre la conexión propietaria, sin políticas, con acceso a cada fila. Es el elemento con más privilegios en el contexto de una función, incluso más que el descriptor que lleva "admin" en su nombre.

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

Se ejecuta sobre una conexión TCP a tu base de datos, lo que lo convierte en el único descriptor de acceso vinculado a un proceso de Node. Esto no supone ninguna desventaja en los despliegues actuales; es simplemente el aspecto a tener en cuenta si una función pudiera trasladarse en el futuro. Consulta [Portabilidad del entorno de ejecución](#portabilidad-del-entorno-de-ejecución).

:::caution[El acceso directo con Drizzle es exclusivo de Node]
También puedes importar tu propia instancia de Drizzle y consultarla directamente (`db.execute(sql\`…\`)`). Funciona, y en un despliegue de Node autohospedado o gestionado no hay ningún problema.

Vale la pena conocer sus implicaciones: una función que importa `drizzle-orm` y un pool de `pg` se convierte permanentemente en una función de Node, elude los callbacks de tus colecciones que `rebase.data` sí ejecuta (ninguno de los dos comprueba `validation`, que solo aplica a las [peticiones de API](/docs/collections/validation-and-conditions/#where-validation-runs)) y obtiene su conexión desde un lugar distinto a la petición. `rebase.sql()` te ofrece el mismo SQL directo a través de la propia conexión del framework. Es la opción preferida.
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

Por qué esto importa en **cualquier** entorno de ejecución, incluido Node:

```typescript no-verify
// Don't. If STRIPE_SECRET_KEY is unset, this throws while the file is being
// imported — and the loader reports that as a *skipped function*. The route
// 404s, with the reason buried in a boot log line.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

Una lectura en el ámbito del módulo se evalúa cuando el archivo se importa, antes de que exista petición alguna. En Node, eso significa que una variable ausente invalida todo el archivo y, con él, todas las rutas que contenga. En una plataforma que vincula la configuración a la petición en lugar de al proceso, no hay nada disponible para leer en el momento de la importación.

- `getEnv(c)` — todas las variables visibles para esta petición
- `env(c, "NAME")` — una variable, sin espacios en blanco; un valor vacío se considera no definido
- `requireEnv(c, "NAME")` — lo mismo, pero lanza un mensaje indicando el nombre de la variable
- `lazyResource(factory)` — construye un cliente costoso una sola vez, en su primer uso

`rebase doctor` reporta las lecturas de `process.env` en el ámbito del módulo dentro de tu directorio de funciones.

## Tareas en segundo plano

Las tareas que deban continuar tras enviar la respuesta deben colocarse en `waitUntil`:

```typescript
import { defineFunction, requireAuth, waitUntil } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.post("/orders", requireAuth, async (c) => {
        const order = await c.req.json();
        // The caller does not wait for this, but shutdown does.
        waitUntil(c, rebase.email.send({
            to: "warehouse@example.com",
            subject: "New order",
            html: "<p>Pick and pack</p>"
        }));
        return c.json({ received: true });
    });
});
```

Una promesa a la que no se le aplica `await` parece equivalente, pero no lo es. `waitUntil` aporta dos ventajas:

- **En Node**, se realiza un seguimiento de la promesa, por lo que un apagado ordenado (graceful shutdown) esperará a que finalice en lugar de que el proceso termine interrumpiendo un webhook a medio enviar. Una promesa flotante durante un `SIGTERM` simplemente se pierde.
- **En un proveedor basado en isolates**, se le indica a la plataforma que mantenga vivo el isolate hasta que la promesa se resuelva. Sin esto, la tarea se descarta en el instante en que la respuesta se resuelve (silenciosamente, dejando un código 200 en los registros).

Cualquier rechazo se registra en los logs en lugar de dejarse en manos del manejador de rechazos no controlados, por lo que un fallo indicará la ruta de la que provino.

## Portabilidad del entorno de ejecución

Una función personalizada es una aplicación de Hono, y Hono funciona en todos los entornos de ejecución de servidores JavaScript. Por lo tanto, el que *tu* función pueda ejecutarse en un entorno distinto a un proceso de Node depende exclusivamente de lo que su archivo importe y utilice.

Nada de esto representa una restricción sobre lo que puedes escribir hoy en día. Cada despliegue de Rebase es un proceso de Node, una función que lee un archivo o abre un socket es totalmente válida, y ninguna compilación o despliegue fallará por este motivo. Se documenta para que se conozca de antemano en lugar de descubrirlo archivo por archivo más adelante.

**Portable: funciona en cualquier entorno de ejecución:**

- Todo lo exportado desde `@rebasepro/server/functions`
- `getDriver(c)` y `rebase.dataAsAdmin`: ambos funcionan mediante el mismo protocolo dondequiera que se ejecuten
- `rebase.auth`, `rebase.storage`, `rebase.email`
- `fetch`, `Request`/`Response`, `URL`, `crypto.subtle`, `TextEncoder`: la plataforma web estándar
- Cualquier dependencia que no requiera Node

**Exclusivo de Node:**

- `rebase.sql()`: la conexión propietaria a la base de datos es un socket TCP
- Un cliente de Drizzle/`pg`/`mongodb` importado directamente, por el mismo motivo
- Módulos integrados de Node: `fs`, `path`, `crypto` (el módulo de Node; `globalThis.crypto` es portable), `child_process`, …
- Paquetes construidos sobre ellos: `jsonwebtoken`, `nodemailer`, `sharp`, `bcrypt`, …

**Errores latentes en todos los entornos de ejecución** (conviene corregirlos en cualquier caso):

- Lectura de `process.env` en el ámbito del módulo (consulta [Configuración y secretos](#configuración-y-secretos))
- Promesas de tipo "fire-and-forget" en lugar de [`waitUntil`](#tareas-en-segundo-plano)
- Asumir que un manejador continuará ejecutándose después de que su petición haya expirado por timeout. En Node lo hace; esa es una propiedad del proceso, no una garantía del framework

### Comprobar tus propias funciones

`rebase build` imprime una línea por cada hallazgo relevante y registra el veredicto por función en el manifiesto del bundle:

```json
{
  "functions": [
    { "name": "hello", "file": "backend/functions/hello.js", "portable": true },
    { "name": "reports", "file": "backend/functions/reports.js", "portable": false,
      "requires": ["imports the Node built-in \"fs\""] }
  ]
}
```

`rebase doctor` informa de lo mismo sin necesidad de compilar.

### Si necesitas una ruta específica según el entorno de ejecución

`runtimeKey()` devuelve `"node"`, `"workerd"`, `"deno"`, `"bun"`, `"edge-light"`, `"fastly"` o `"other"`; `isNodeRuntime()` es la comprobación habitual. Utilízalos para degradar funcionalidades, no para bifurcar una implementación: una función que necesita dos implementaciones distintas son dos funciones.

```typescript
import { defineFunction, isNodeRuntime } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.get("/stats", async (c) => {
        if (!isNodeRuntime()) return c.json({ error: "Not available here" }, 501);
        const rows = await rebase.sql("SELECT count(*) AS total FROM jobs");
        return c.json({ totalJobs: Number(rows[0]?.total ?? 0) });
    });
});
```

## Orden de registro de rutas

Las funciones personalizadas se cargan y se montan **después** de que `initializeRebaseBackend()` complete la configuración básica. El orden de inicialización es el siguiente:

1. **Iniciadores (bootstrappers)**: conexiones a bases de datos, tablas de autenticación, servicios en tiempo real
2. **Rutas de autenticación**: `/api/auth/*`, `/api/admin/*`
3. **Rutas de almacenamiento**: `/api/storage/*`
4. **Rutas de datos**: `/api/data/*` (CRUD para colecciones)
5. **Funciones personalizadas** ← `/api/functions/*`
6. **Tareas cron**: `/api/admin/cron/*`
7. **WebSocket**: suscripciones en tiempo real

Esto significa que tus funciones personalizadas tienen acceso a todos los servicios inicializados. Registra cualquier ruta que deba ejecutarse **antes** de Rebase directamente en la aplicación Hono, antes de llamar a `initializeRebaseBackend()`:

```typescript no-verify
const app = new Hono<HonoEnv>();

// This runs BEFORE Rebase routes
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase initialization — registers all /api/* routes
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
Las rutas que agregues a tu propia aplicación de esa manera quedan **fuera** de cualquier enrutador de Rebase, por lo que no se habrá ejecutado ningún middleware de autenticación sobre ellas y `getDriver(c)` no estará definido. Protege esas rutas con `requireAuth` / `requireAdmin` importados desde **`@rebasepro/server`** (la raíz del paquete), los cuales verifican el token por sí mismos. Los protectores de la subruta `/functions` leen una identidad que un enrutador de Rebase ya ha resuelto, y devolverán un error 500 en lugar de simular que existe una.
:::

## Ejemplo: Controlador de webhooks

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

Cuando una función se carga correctamente, verás:

```
⚡ Loaded function route: hello
```

Si la carga falla, el cargador proporciona información de diagnóstico:

```
[functions] broken-function.ts: default export is not a Hono app or factory. Skipping.
  export type: object (SomeClass)
  prototype methods: constructor, someMethod
  Hint: ensure the function exports a Hono app created with the same hono version as the server.
```

El enrutador se monta para el **directorio**, no individualmente para las funciones que contiene. Si todos los archivos fallan al importarse (una sola variable de entorno faltante a nivel de módulo es suficiente para derribarlos a todos), `GET /api/functions` seguirá respondiendo `200` con una lista vacía más un contador `skipped`, lo que permite distinguir entre "no se pudo cargar nada" y "esta compilación no incluye funciones". El listado en sí requiere un llamador autenticado, una API key con el scope general `functions:invoke` o la service key: las funciones siguen siendo invocables por quien cada una admita, pero el inventario de las mismas no es público. Los motivos se conservan en el registro de arranque.

## Tiempos de espera y límites de velocidad

Se aplican dos límites a `/api/functions/*`:

- **Tiempo de espera de la petición (Request timeout)**: 30 segundos por defecto, respondiendo `504` con el código `FUNCTION_TIMEOUT`. Se configura con `functionsTimeoutMs` (o `REBASE_FUNCTIONS_TIMEOUT_MS`); `0` lo desactiva. El manejador no puede detenerse desde el exterior, pero se le notifica: `getSignal(c)` de `@rebasepro/server/functions` se aborta en el momento del 504, así que pásalo a `fetch` y a cualquier otra función que acepte una señal (`fetch(url, { signal: getSignal(c) })`). El trabajo al que no se le pase la señal continuará: el timeout libera al cliente y al socket, no al proceso en ejecución. Que el manejador *continúe ejecutándose* tras el 504 es una propiedad de un proceso persistente de Node, no una garantía del contrato; cualquier cosa que deba completarse obligatoriamente debe colocarse en [`waitUntil`](#tareas-en-segundo-plano).
- **Límite de velocidad (Rate limit)**: las API keys y los llamadores autenticados comparten los límites de la API de datos. Los llamadores anónimos reciben su propia cuota, mucho más permisiva (3000 por ventana), ya que este enrutador es público por defecto para los receptores de webhooks. Modifícalo con `rateLimit.anonymousFunctions`; un valor `null` lo desactiva.

Los rechazos de promesas no controlados se registran en los logs en lugar de ser fatales: de lo contrario, una llamada de tipo "fire-and-forget" en una sola función terminaría con todo el proceso. Establece `REBASE_EXIT_ON_UNHANDLED_REJECTION=1` para mantener el comportamiento predeterminado de Node.

En Rebase Cloud, el edge situado frente a tus funciones tiene sus propios límites, y el estado a nivel de módulo, el sistema de archivos y los puertos de salida se comportan de formas que conviene conocer antes de diseñar en torno a ellos. Consulta [Entorno de backend gestionado](/docs/deployment/managed-runtime/).

## Próximos pasos

- **[Descripción general del backend](/docs/backend)** — Referencia completa de configuración del backend
- **[Callbacks de entidades](/docs/collections/callbacks)** — Ejecuta lógica ante cambios en los datos
- **[Tareas cron](/docs/backend/cron-jobs)** — Tareas programadas en segundo plano
