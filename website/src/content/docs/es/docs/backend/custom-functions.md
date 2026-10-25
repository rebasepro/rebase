---
sourceHash: 22d7c8bbab763065
title: Funciones personalizadas
sidebar_label: Funciones personalizadas
description: Añade endpoints de API de Hono personalizados junto a tus rutas CRUD de Rebase. Detección automática desde un directorio, con acceso total a la instancia del backend.
---

## Descripción general

Las funciones personalizadas te permiten añadir **rutas de API de Hono arbitrarias** junto a los endpoints CRUD autogenerados de Rebase. Siguen el mismo patrón de **detección basada en archivos** que las colecciones y las tareas cron: coloca un archivo TypeScript en tu directorio `functions/` y Rebase lo montará automáticamente.

Utiliza funciones personalizadas para:

- **Endpoints de lógica de negocio**: aprobaciones, promociones, flujos de trabajo personalizados
- **Integraciones de terceros**: webhooks de Stripe, comandos de Slack, proxies para APIs externas
- **Endpoints públicos**: formularios de contacto, captura de leads, health checks
- **Consultas de agregación**: estadísticas de dashboard, reportes, analíticas

## Definir una función personalizada

Crea un archivo en tu directorio `backend/functions/` que exporte por defecto (default export) una aplicación Hono:

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

`POST`, porque eso es lo que envía el SDK de forma predeterminada; consulta [Invocar desde el cliente](#invocar-desde-el-cliente). Una ruta `GET` es igual de válida; en ese caso, quien invoca debe especificar `{ method: "GET" }`.

`rebase dev` observa el directorio de funciones, por lo que un archivo añadido mientras se está ejecutando se monta en la siguiente recarga, sin necesidad de reiniciar. (Debe ser notificado: el directorio se escanea en lugar de importarse, por lo que el observador no puede inferirlo).

## Invocar desde el cliente

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "http://localhost:3000" });

const { message } = await client.functions.invoke<{ message: string }>(
    "hello",                 // the filename, without extension — one path segment
    { name: "Ada" }          // JSON body; omitted for a GET
);
```

`invoke` construye la URL, adjunta el token del emisor y lanza un `RebaseApiError` en respuestas que no sean 2xx, de modo que la estructura del propio error de la función llegue a quien llama en lugar de un simple rechazo de `fetch`.

Cuatro parámetros adicionales que admite más allá del nombre:

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
`client.call("functions/hello", payload)` también accede a una función. Siempre realiza un `POST` y, al igual que `invoke`, devuelve el cuerpo tal cual; ninguno intenta acceder a una clave `data`. Es preferible usar `functions.invoke`, que admite un método, una subruta y un `responseType`; `call` existe para rutas montadas fuera de `/api/functions`, las cuales `invoke` no puede expresar.
:::

:::important
Importa desde **`@rebasepro/server/functions`**, no desde `@rebasepro/server`.

Ambos funcionan. La subruta es la superficie de autoría *portable*: no incluye nada que requiera Node, por lo que una función escrita con ella puede ejecutarse en cualquier runtime de JavaScript. La raíz del paquete abarca todo el framework —la secuencia de arranque, los cargadores de archivos, la capa WebSocket—, lo cual es apropiado para el punto de entrada de un servidor, pero más de lo que necesita un manejador de rutas. También te proporciona accesores de contexto tipados (`getUser`, `getDriver`) en lugar de tener que hacer un cast manual de `c.get("user")`.

Consulta [Portabilidad en diferentes runtimes](#portabilidad-en-diferentes-runtimes) para ver el contrato completo.
:::

## Configuración

:::note[Dónde va esto]
**Runtime administrado:** nada que configurar; el runtime detecta `backend/functions/` automáticamente (`functions` en la entrada `rebase.json` de la app de backend si lo has movido). `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE` delimitan cuáles sirve un proceso `REBASE_ROLE=functions`; cualquier otro rol se niega a arrancar si están definidas.
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

Rebase realizará lo siguiente:

1. Escaneará el directorio en busca de archivos `.ts` / `.js`
2. Validará que cada exportación por defecto sea una app de Hono (verificación por duck-typing mediante `.fetch()` + `.routes`)
3. Montará cada app en `/api/functions/<filename>`
4. Aplicará el middleware de autenticación (ver [Autenticación](#autenticación-y-propagación-de-contexto) más abajo)

### Funciones como valores

En 0.24 las funciones provienen únicamente de un directorio.

Un directorio es una forma de generar lo que el servidor entrega: un registro que va desde el segmento de URL hasta la app de Hono. Pasa ese registro tú mismo como `functions`, o lee un directorio dentro de él con `loadFunctions`:

```typescript
import path from "path";
import { initializeRebaseBackend, loadFunctions } from "@rebasepro/server";
import sendInvoice from "../functions/send-invoice";

await initializeRebaseBackend({ app, server, functions: { "send-invoice": sendInvoice } }); // → /api/functions/send-invoice
// the same as functionsDir:
await initializeRebaseBackend({ app, server, functions: await loadFunctions(path.resolve(__dirname, "../functions")) });
```

Proporciona `functions` o `functionsDir`, no ambos: el arranque rechazará el uso de ambos a la vez. `loadFunctions(dir, { onSkip })` te entrega cada archivo que omitió junto con el motivo. `loadFunctionsFromDirectory` y `loadFunctionsWithDiagnostics` todavía funcionan, están obsoletos y emiten una advertencia una sola vez. Por sí solo, el grupo de funciones se monta en cualquier ruta con `app.route("/hooks", backend.routes.functions())`, y `getUser(c)` y `getDriver(c)` funcionan dentro de él; consulta [Integración en servidor personalizado](/docs/backend/custom-server/#mounting-only-the-groups-you-want).

## Nombres de archivos y mapeo de rutas

| Archivo | Ruta de montaje |
|------|-----------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

Las funciones se detectan **únicamente en el nivel superior del directorio**; no hay recursión. `functions/admin/users.ts` es compilado por `rebase build` pero nunca se monta; aplana el nombre en su lugar (`functions/admin-users.ts`). Un subdirectorio se reporta en el arranque y se contabiliza en el endpoint de listado en lugar de ignorarse silenciosamente.

Archivos que se **omiten**:

- `index.ts` / `index.js` — reservados
- `*.test.ts` / `*.test.js` — archivos de pruebas
- `*.d.ts` — declaraciones de tipos
- Subdirectorios y archivos `.mts` / `.cts` / `.tsx` / `.jsx` / `.mjs` / `.cjs` — reportados como problemas, ya que la compilación compila más de lo que el runtime carga

El nombre también constituye la identidad de la función en todos los demás ámbitos: es el segmento de la URL, el destino del scope `functions:invoke:<name>` que una clave necesita para invocarla, y el valor por el cual selecciona `REBASE_FUNCTIONS_ONLY` cuando asignas a una función su propio proceso.

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

### Función fábrica (Factory Function)

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server/functions";

export default function () {
    const app = new Hono<HonoEnv>();
    app.get("/status", (c) => c.json({ ok: true }));
    return app;
}
```

`defineFunction` devuelve exactamente la app de Hono que estos construyen manualmente, por lo que los tres son intercambiables. Te ahorra declarar `Hono<HonoEnv>` y te entrega el singleton `rebase` en el callback.

---

## Bajo el capó: El cargador por duck-typing

En un monorepo tus funciones pueden resolver una copia de Hono diferente a la que usa Rebase, y en ese caso `exported instanceof Hono` resultará falso para un enrutador plenamente funcional. Por lo tanto, el cargador comprueba la forma en su lugar (`isHonoLike`): un objeto no nulo con un método `.fetch` y un array `.routes`.

### Escape del compilador de módulos ES

El cargador convierte cada ruta de archivo en una URL de archivo (`pathToFileURL(filePath).href`), de modo que se importa igual en Windows que en POSIX, y llama a `import(url)` a través de `new Function("url", "return import(url)")`, evitando así que una compilación de TypeScript pueda reescribirlo como un `require()` que falle bajo ESM.

---

## Autenticación y propagación de contexto

Las funciones personalizadas se montan con el **mismo middleware de autenticación** que las rutas de datos, pero con `requireAuth: false`. Esto significa que:

- El JWT del usuario se **analiza e inyecta** en el contexto si está presente
- Sin embargo, las solicitudes **no se rechazan** si no se proporciona ningún JWT
- Debes **proteger explícitamente** las rutas que requieran autenticación

Un llamador que presente un token *inválido* nunca llega a tu manejador: el propio middleware rechaza con un 401 un token que no se pueda verificar o que haya expirado, por lo que una sesión caducada nunca se degrada silenciosamente a una anónima.

### Leer los datos del llamador

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

`getUser` devuelve un objeto delimitado: `uid` es un string y `roles` es siempre un array, sin importar el método de autenticación utilizado por el llamador. `getUserId(c)` y `getRoles(c)` son accesos directos. `getScopes(c)` representa todo lo que el llamador puede hacer, como cadenas de [scope](/docs/backend/roles-and-scopes/): para una persona, el plano de datos, los scopes propios de la app y los scopes de sus roles; para una clave de API, exactamente lo que la clave contiene.

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

Coloca los guards en la **ranura de middleware propia de la ruta**, como se muestra arriba, en lugar de usar `app.use("/*", requireAuth)`. `use()` cubre únicamente las rutas declaradas *por debajo* de él, por lo que una ruta agregada posteriormente —al final del archivo, meses después— quedaría desprotegida de forma silenciosa.

:::important
Leer `getUser(c)` **no** es un guard. Un llamador anónimo obtiene `undefined` y tu manejador se ejecutará de todos modos. Solo un guard, o un `if (!user) return 401` explícito, detiene la solicitud.
:::

### Scopes y scopes de aplicación

`requireAdmin` admite el rol `admin` y a nadie más. Para una acción a la que deba acceder un rol más específico o una clave de API, protege la ruta con `requireScope`. Acepta un [scope](/docs/backend/roles-and-scopes/) integrado o uno que la app declare bajo `auth.scopes` en la colección de usuarios, como `"project:deploy": { label: "Deploy projects", target: "project" }`:

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

Cada persona autenticada posee todos los scopes de la aplicación, por lo que para una persona `requireScope` no decide nada: comprueba en el manejador si esta persona puede desplegar este proyecto. Lo que añade el scope es una forma de **delimitar una clave**: una clave que contenga `project:deploy:p1` solo pasará para `p1`. Una clave también necesita `functions:invoke`, o `functions:invoke:<name>`, antes de poder llegar a la función. Consulta [Scopes de aplicación](/docs/backend/roles-and-scopes/#app-scopes).

### Autenticación con clave de servicio (Service Key)

Rebase admite una variable estática `REBASE_SERVICE_KEY` definida en tu `.env` para llamadas de scripts o comunicación entre servidores.

Cuando una solicitud externa envía la clave de servicio mediante la cabecera Authorization (`Authorization: Bearer <service_key>`), el middleware de autenticación automáticamente:
1. Valida la clave mediante comparación en tiempo constante para evitar ataques de temporización (timing attacks).
2. Concede acceso de nivel admin, configurando al llamador como `{ uid: "service", roles: ["admin"] }`.
3. Inyecta un `DataDriver` con el alcance de esa misma identidad de servicio. La seguridad a nivel de fila (Row-Level Security o RLS) sigue aplicándose: se evalúa como `{ uid: "service", roles: ["admin"] }`, no se omite.

### Autenticación interna automática

Si no has configurado una `REBASE_SERVICE_KEY`, Rebase genera una **clave interna aleatoria por cada arranque**. El singleton `rebase` utiliza esta clave automáticamente al llamar a las APIs del plano de control del propio servidor (como `rebase.auth` o `rebase.storage`). Esto significa que tu lógica del lado del servidor siempre puede realizar tareas administrativas incluso sin una clave de servicio configurada manualmente.

## Acceder a la base de datos y servicios

### 1. El driver con ámbito de usuario: para cualquier cosa que responda a una solicitud

`getDriver(c)` devuelve el driver **con el ámbito del llamador**, por lo que cada lectura y escritura se evalúa contra tus políticas de Row-Level Security como ese usuario:

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

`requireDriver(c)` es `getDriver(c)` sin el `!` — lanza un mensaje indicando el problema de configuración en lugar de fallar veinte líneas después con un `undefined`.

### 2. `rebase.dataAsAdmin`: para tareas en segundo plano confiables

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

|                     | `getDriver(c)` (ámbito de solicitud)           | `rebase.dataAsAdmin` (identidad de servicio)                     |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **Se ejecuta como** | El emisor (`uid`, sus roles)                   | `{ uid: "service", roles: ["admin"] }`                            |
| **Aplicación de RLS** | ✅ Sí (evaluado contra el emisor)            | ✅ Sí (evaluado contra la identidad de servicio)                 |
| **Ideal para...**   | CRUD general de usuarios, búsquedas y consultas| Tareas en segundo plano, triggers del sistema, webhooks          |
| **Estilo de API**   | Métodos a nivel de driver (`fetchCollection`, `save`) | Accesores fluidos de colecciones (`rebase.dataAsAdmin.jobs.find`) |

#### Qué es exactamente `dataAsAdmin`

`rebase.dataAsAdmin` está **delimitado para administradores, no elude RLS**. El driver se configura una vez, al arrancar, con `withAuth({ uid: "service", roles: ["admin"] })`, de modo que cada lectura y escritura se ejecuta dentro de una transacción que ha cambiado al rol restringido `rebase_user` con `app.uid = 'service'`. Tus políticas se evalúan — contra esa identidad.

Para la mayoría de los proyectos esta distinción nunca sale a la luz, porque las políticas predeterminadas que Rebase inyecta en cada colección admiten `serverContext() OR rolesOverlap(['admin'])`, y la identidad de servicio cumple con la segunda condición. Sale a la luz en el momento en que escribes tus propias políticas:

- **`policy.serverContext()` es falso para él.** Ese helper se compila como `rebase.uid() IS NULL`, y el `uid` de este accesor es `'service'`. Una colección con `disableDefaultPolicies: true` cuya única regla de escritura sea `serverContext()` rechazará una escritura de `dataAsAdmin` con el error de Postgres `42501`, y una lectura contra dicha colección devolverá **cero filas con HTTP 200** — la dirección silenciosa. Escribe `rolesOverlap(["admin"])` (o añádelo junto a él) cuando te refieras a "mi backend".
- **Su alcance equivale al alcance de un usuario `admin`.** Otorgar el rol `admin` a un usuario de la aplicación le otorga exactamente las filas que ve este accesor. No es un canal privado.

### 3. `rebase.sql()`: SQL en bruto, y el único accesor exclusivo de Node

Si realmente necesitas omitir las políticas de manera incondicional, `rebase.sql()` es la solución: SQL en bruto sobre la conexión del propietario, sin políticas, todas las filas. Es el elemento con más privilegios en el contexto de una función —más que el accesor con "admin" en su nombre.

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

Se ejecuta en una conexión TCP con tu base de datos, lo que lo convierte en el único accesor vinculado a un proceso de Node. Eso no cuesta nada en ningún despliegue existente hoy en día; es simplemente lo único a tener en cuenta si una función pudiera migrarse más adelante. Consulta [Portabilidad en diferentes runtimes](#portabilidad-en-diferentes-runtimes).

:::caution[El acceso directo a Drizzle es exclusivo de Node]
También puedes importar tu propia instancia de Drizzle y consultarla directamente (`db.execute(sql\`…\`)`). Funciona, y en un despliegue de Node autoalojado o administrado está bien.

Vale la pena conocer lo que implica: una función que importa `drizzle-orm` y un pool de `pg` es permanentemente una función de Node, elude los callbacks de tus colecciones que `rebase.data` sí ejecuta (ninguno de los dos comprueba `validation`, que se aplica a [solicitudes de API](/docs/collections/validation-and-conditions/#where-validation-runs)), y obtiene su conexión desde un lugar distinto a la solicitud. `rebase.sql()` te ofrece el mismo SQL en bruto mediante la conexión propia del framework. Es la opción recomendada.
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

Por qué esto importa en **cualquier** runtime, incluido Node:

```typescript no-verify
// Don't. If STRIPE_SECRET_KEY is unset, this throws while the file is being
// imported — and the loader reports that as a *skipped function*. The route
// 404s, with the reason buried in a boot log line.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

Una lectura en el ámbito del módulo se evalúa cuando se importa el archivo, antes de que exista solicitud alguna. En Node, eso significa que una variable faltante hace caer todo el archivo y todas las rutas contenidas en él. En un host que adjunta la configuración a la solicitud en lugar de al proceso, no hay absolutamente nada que leer en el momento de la importación.

- `getEnv(c)` — todas las variables visibles para esta solicitud
- `env(c, "NAME")` — una variable, recortada; en blanco cuenta como no establecida
- `requireEnv(c, "NAME")` — lo mismo, pero lanza un mensaje indicando el nombre de la variable
- `lazyResource(factory)` — construye un cliente costoso una sola vez, en el primer uso

`rebase doctor` reporta lecturas de `process.env` en el ámbito del módulo dentro de tu directorio de funciones.

## Trabajo en segundo plano

El trabajo que deba sobrevivir a la respuesta se coloca en `waitUntil`:

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

Una promesa sin await parece equivalente pero no lo es. `waitUntil` aporta dos ventajas:

- **En Node**, se rastrea la promesa, por lo que un apagado controlado (graceful shutdown) la espera en lugar de que el proceso termine interrumpiendo un webhook enviado a medias. Una promesa flotante durante un `SIGTERM` simplemente se pierde.
- **En un host basado en isolates**, se indica al host que mantenga vivo el isolate hasta que la promesa se resuelva. Sin esto, el trabajo se descarta en el instante en que la respuesta se resuelve —silenciosamente, con un 200 limpio en los registros.

Un rechazo se registra en los logs en lugar de dejarse al manejador de rechazos no controlados, por lo que un fallo especifica la ruta de donde provino.

## Portabilidad en diferentes runtimes

Una función personalizada es una app de Hono, y Hono se ejecuta en cualquier runtime de servidor de JavaScript. Por lo tanto, el hecho de que *tu* función pueda ejecutarse fuera de un proceso de Node depende de lo que su propio archivo importe y utilice.

Nada de lo mencionado aquí restringe lo que puedes escribir hoy. Todo despliegue de Rebase es un proceso de Node, una función que lee un archivo o abre un socket es perfectamente válida, y ninguna compilación o despliegue fallará por nada de esto. Se documenta para que la respuesta pueda conocerse desde ahora en lugar de descubrirse archivo por archivo más adelante.

**Portable — funciona en cualquier runtime:**

- Todo lo exportado desde `@rebasepro/server/functions`
- `getDriver(c)` y `rebase.dataAsAdmin` — ambos operan a través del mismo canal dondequiera que se ejecuten
- `rebase.auth`, `rebase.storage`, `rebase.email`
- `fetch`, `Request`/`Response`, `URL`, `crypto.subtle`, `TextEncoder` — la plataforma web
- Cualquier dependencia que no requiera Node

**Exclusivo de Node:**

- `rebase.sql()` — la conexión de propietario de la base de datos es un socket TCP
- Un cliente de Drizzle/`pg`/`mongodb` importado directamente, por la misma razón
- Módulos integrados de Node: `fs`, `path`, `crypto` (el módulo de Node; `globalThis.crypto` es portable), `child_process`, …
- Paquetes construidos sobre ellos: `jsonwebtoken`, `nodemailer`, `sharp`, `bcrypt`, …

**Errores latentes en cualquier runtime** — vale la pena corregirlos independientemente del entorno:

- Lectura de `process.env` en el ámbito del módulo (ver [Configuración y secretos](#configuración-y-secretos))
- Promesas de tipo "disparar y olvidar" (fire-and-forget) en lugar de [`waitUntil`](#trabajo-en-segundo-plano)
- Confiar en que un manejador continúe ejecutándose después de que su solicitud haya expirado. En Node lo hace; esa es una propiedad del proceso, no una garantía del framework

### Comprobar tus propias funciones

`rebase build` imprime una línea por cada hallazgo procesable y registra el veredicto por función en el manifiesto del bundle:

```json
{
  "functions": [
    { "name": "hello", "file": "backend/functions/hello.js", "portable": true },
    { "name": "reports", "file": "backend/functions/reports.js", "portable": false,
      "requires": ["imports the Node built-in \"fs\""] }
  ]
}
```

`rebase doctor` reporta lo mismo sin necesidad de compilar.

### Si necesitas una ruta específica según el runtime

`runtimeKey()` devuelve `"node"`, `"workerd"`, `"deno"`, `"bun"`, `"edge-light"`, `"fastly"` u `"other"`; `isNodeRuntime()` es la comprobación habitual. Utilízalos para degradar funcionalidades, no para bifurcar una implementación — una función que necesita dos implementaciones son dos funciones.

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

Las funciones personalizadas se cargan y montan **después** de que `initializeRebaseBackend()` complete la configuración principal. El orden de inicialización es el siguiente:

1. **Bootstrappers**: conexiones a bases de datos, tablas de autenticación, servicios en tiempo real
2. **Rutas de autenticación**: `/api/auth/*`, `/api/admin/*`
3. **Rutas de almacenamiento**: `/api/storage/*`
4. **Rutas de datos**: `/api/data/*` (CRUD para colecciones)
5. **Funciones personalizadas** ← `/api/functions/*`
6. **Tareas cron**: `/api/admin/cron/*`
7. **WebSocket**: suscripciones en tiempo real

Esto significa que tus funciones personalizadas tienen acceso a todos los servicios inicializados. Registra cualquier ruta que deba ejecutarse **antes** de Rebase directamente en la app de Hono, antes de llamar a `initializeRebaseBackend()`:

```typescript no-verify
const app = new Hono<HonoEnv>();

// This runs BEFORE Rebase routes
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase initialization — registers all /api/* routes
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
Las rutas que agregas a tu propia app de esa manera quedan **fuera** de cualquier enrutador de Rebase, por lo que ningún middleware de autenticación se habrá ejecutado en ellas y `getDriver(c)` no estará definido. Protege esas rutas con `requireAuth` / `requireAdmin` importados desde **`@rebasepro/server`** —la raíz del paquete—, los cuales verifican el token por sí mismos. Los guards en la subruta `/functions` leen una identidad que un enrutador de Rebase ya ha resuelto, y devolverán un 500 en lugar de simular que existe una.
:::

## Ejemplo: Manejador de Webhooks

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

Cuando se cargan las funciones, el arranque registra `Loaded custom functions` con su número. La línea de cada función se registra en el nivel `debug` (`LOG_LEVEL=debug`):

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

El enrutador se monta para el **directorio**, no para las funciones individuales que contiene. Si falla la importación de cada uno de los archivos —una sola variable de entorno faltante en el ámbito del módulo es suficiente para derribarlos a todos—, `GET /api/functions` responderá igualmente con un `200` y una lista vacía más un contador `skipped`, de modo que "no se cargó nada" se distingue de "esta compilación no incluyó funciones". El listado en sí requiere un llamador autenticado, una clave de API con el scope básico `functions:invoke` o la clave de servicio; las funciones siguen siendo invocables por quien admita cada una, pero el inventario de las mismas no es público. Los motivos permanecen en el registro de arranque.

## Límites de tiempo (Timeouts) y límites de tasa (Rate Limits)

Se aplican dos límites a `/api/functions/*`:

- **Tiempo de espera de solicitud (Request timeout)**: 30 segundos por defecto, respondiendo `504` con el código `FUNCTION_TIMEOUT`. Configúralo con `functionsTimeoutMs` (o `REBASE_FUNCTIONS_TIMEOUT_MS`); `0` lo desactiva. El manejador no puede detenerse desde el exterior, pero se le notifica: `getSignal(c)` de `@rebasepro/server/functions` se aborta en el momento del 504, así que pásalo a `fetch` y a cualquier otra llamada que acepte una señal (`fetch(url, { signal: getSignal(c) })`). El trabajo al que no se le pase la señal continuará ejecutándose: el tiempo de espera libera al cliente y al socket, no al procesamiento en sí. Que el manejador *continúe ejecutándose* tras el 504 es una característica de un proceso persistente de Node, no una garantía del contrato; cualquier tarea que deba completarse obligatoriamente corresponde a [`waitUntil`](#trabajo-en-segundo-plano).
- **Límite de tasa (Rate limit)**: los llamadores autenticados y mediante clave de API comparten los límites asignados de la API de datos. Los llamadores anónimos obtienen una cuota propia y mucho más flexible (3000 por ventana) debido a que este enrutador es público de manera predeterminada para receptores de webhooks. Sobrescríbelo con `rateLimit.anonymousFunctions`; `null` lo deshabilita.

Los rechazos de promesas no controlados se registran en los logs en lugar de ser fatales: de lo contrario, una llamada fire-and-forget en una función terminaría todo el proceso. Establece `REBASE_EXIT_ON_UNHANDLED_REJECTION=1` para mantener el comportamiento predeterminado de Node.

En Rebase Cloud, el edge situado delante de tus funciones cuenta con sus propios límites, y el estado a nivel de módulo, el sistema de archivos y los puertos de salida se comportan de formas que conviene conocer antes de diseñar en torno a ellos. Consulta [Runtime de backend administrado](/docs/deployment/managed-runtime/).

## Próximos pasos

- **[Descripción general del backend](/docs/backend)** — Referencia completa de configuración del backend
- **[Callbacks de entidades](/docs/collections/callbacks)** — Ejecuta lógica ante cambios en los datos
- **[Tareas cron](/docs/backend/cron-jobs)** — Tareas programadas en segundo plano
