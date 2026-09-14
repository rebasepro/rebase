---
sourceHash: 65910bc3708c9f5d
title: Funciones personalizadas
sidebar_label: Funciones personalizadas
description: Añade endpoints de API de Hono personalizados junto a tus rutas CRUD de Rebase. Detección automática desde un directorio, con acceso completo a la instancia del backend.
---

## Visión general

Las funciones personalizadas te permiten añadir **rutas de API de Hono arbitrarias** junto a los endpoints CRUD autogenerados de Rebase. Siguen el mismo patrón de **detección basada en archivos** que las colecciones y las tareas cron: coloca un archivo TypeScript en tu directorio `functions/` y Rebase lo montará automáticamente.

Usa funciones personalizadas para:

- **Endpoints de lógica de negocio** — aprobaciones, promociones, flujos de trabajo personalizados
- **Integraciones con terceros** — webhooks de Stripe, comandos de Slack, proxies de API externas
- **Endpoints públicos** — formularios de contacto, captación de leads, comprobaciones de estado (*health checks*)
- **Consultas de agregación** — estadísticas de panel de control, informes, analíticas

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

`POST`, porque eso es lo que envía el SDK por defecto; consulta [Invocación desde el cliente](#invocación-desde-el-cliente). Una ruta `GET` es igual de válida; en ese caso, quien llama debe especificar `{ method: "GET" }`.

`rebase dev` vigila el directorio de funciones, por lo que un archivo añadido mientras se está ejecutando se monta en la siguiente recarga, sin necesidad de reiniciar. (Se le debe indicar: el directorio se escanea en lugar de importarse, por lo que el observador no puede inferirlo).

## Invocación desde el cliente

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "http://localhost:3000" });

const { message } = await client.functions.invoke<{ message: string }>(
    "hello",                 // the filename, without extension — one path segment
    { name: "Ada" }          // JSON body; omitted for a GET
);
```

`invoke` construye la URL, adjunta el token del emisor y lanza un `RebaseApiError` en caso de una respuesta distinta de 2xx, de modo que la estructura de error propia de la función llega a quien la llama en lugar de un simple rechazo de `fetch`.

Tres elementos que acepta además del nombre:

```typescript
// A different method. The payload is dropped for GET, since GET has no body.
await client.functions.invoke("hello", undefined, { method: "GET" });

// A sub-path — `/api/functions/hello/stats`. It goes here, never in the name:
// a name containing "/" is refused rather than percent-encoded into a 404.
await client.functions.invoke("hello", undefined, { method: "GET", path: "stats" });

// A query string. Passed as `path`, with no separator inserted before `?`.
await client.functions.invoke("reports", undefined, { method: "GET", path: "?days=30" });
```

:::note
`client.call("functions/hello", …)` también accede a una función y hace algo sutilmente diferente: desenvuelve `res.data` cuando la respuesta contiene uno. Tener dos formas de acceso con dos contratos de respuesta diferentes es una trampa: usa `functions.invoke`. `call` existe para rutas montadas fuera de `/api/functions`, las cuales `invoke` no puede expresar.
:::

:::important
Importa desde **`@rebasepro/server/functions`**, no desde `@rebasepro/server`.

Ambos funcionan. La subruta es la superficie de autoría *portable*: no incluye nada que requiera Node, por lo que una función escrita con ella puede ejecutarse en cualquier entorno de ejecución de JavaScript. La raíz del paquete accede a todo el framework (la secuencia de arranque, los cargadores de archivos, la capa de WebSocket), lo cual es adecuado para el punto de entrada de un servidor, pero más de lo que necesita un manejador de rutas. También te proporciona descriptores de acceso tipados al contexto (`getUser`, `getDriver`) en lugar de tener que hacer un cast manual de `c.get("user")`.

Consulta [Portabilidad en el entorno de ejecución](#portabilidad-en-el-entorno-de-ejecución) para ver el contrato completo.
:::

## Configuración

:::note[Dónde va esto]
**Entorno de ejecución administrado:** nada que configurar; el entorno descubre `backend/functions/` por su cuenta (`entry.functions` en `rebase.json` si lo moviste). `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE` limitan cuáles sirve un proceso.
**Eyectado (*ejected*):** `initializeRebaseBackend({ functionsDir })` en `backend/src/index.ts`.
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
2. Validará que cada exportación por defecto sea una aplicación de Hono (mediante tipado pato o *duck typing* a través de `.fetch()` + `.routes`)
3. Montará cada aplicación en `/api/functions/<filename>`
4. Aplicará el middleware de autenticación (consulta [Autenticación](#autenticación-y-propagación-de-contexto) más abajo)

## Nombres de archivo y mapeo de rutas

| Archivo | Ruta de montaje |
|------|-----------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

Las funciones se detectan **únicamente en el nivel superior del directorio**; no hay recursión. `functions/admin/users.ts` es compilado por `rebase build` pero nunca se monta; aplana el nombre en su lugar (`functions/admin-users.ts`). Si hay un subdirectorio, se reporta en el arranque y se contabiliza en el endpoint de listado en lugar de ignorarse silenciosamente.

Archivos que se **omiten**:

- `index.ts` / `index.js` — reservados
- `*.test.ts` / `*.test.js` — archivos de pruebas
- `*.d.ts` — declaraciones de tipos
- Subdirectorios y archivos `.mts` / `.cts` / `.tsx` / `.jsx` / `.mjs` / `.cjs` — se reportan como problemas, ya que la compilación procesa más de lo que el entorno de ejecución carga

El nombre también define la identidad de la función en todos los demás lugares: es el segmento de la URL, el permiso de clave de API `functions/<name>` y el valor por el cual `REBASE_FUNCTIONS_ONLY` filtra cuando asignas a una función su propio proceso.

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

### Función de fábrica (*Factory function*)

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server/functions";

export default function () {
    const app = new Hono<HonoEnv>();
    app.get("/status", (c) => c.json({ ok: true }));
    return app;
}
```

`defineFunction` devuelve exactamente la aplicación de Hono que estos crean manualmente, por lo que las tres opciones son intercambiables. Te ahorra declarar `Hono<HonoEnv>` y te entrega el singleton `rebase` en el callback.

---

## Bajo el capó: El cargador con tipado pato (*Duck-Typing*)

Al compilar bases de código con múltiples directorios anidados o en monorrepositorios, puedes encontrarte con una **duplicación de paquetes de Hono**.

Si el framework Rebase depende de una versión de Hono y tu directorio local de funciones resuelve otra, las comprobaciones estándar de herencia de clases (`exported instanceof Hono`) fallarán porque sus prototipos existen en espacios de memoria separados.

Para evitar falsos negativos y evitar rechazar la carga de enrutadores que funcionan, Rebase utiliza un validador basado en tipado pato (`isHonoLike`):
- Verifica que el objeto exportado sea un `object` no nulo.
- Comprueba que el objeto exponga un método `.fetch` (necesario para enrutar solicitudes).
- Verifica que `.routes` sea un `array`.

```typescript no-verify
function isHonoLike(obj: unknown): boolean {
    if (!obj || typeof obj !== "object") return false;
    const record = obj as Record<string, unknown>;
    return typeof record.fetch === "function" && Array.isArray(record.routes);
}
```

### Escape del compilador para módulos ES

Para importar archivos TypeScript y JavaScript dinámicamente tanto en sistemas Windows como Posix, el cargador convierte las rutas de archivo en URIs de archivo estándar mediante `pathToFileURL(filePath).href`.

Para evitar que la compilación de TypeScript reescriba las importaciones dinámicas nativas de ESM (`import(url)`) como llamadas `require()` de CommonJS (lo que generaría errores en tiempo de ejecución en entornos ESM), Rebase ejecuta un escape del compilador en tiempo de ejecución:

```typescript no-verify
const dynamicImport = new Function("url", "return import(url)");
const mod = await dynamicImport(fileUrl);
```

---

## Autenticación y propagación de contexto

Las funciones personalizadas se montan con el **mismo middleware de autenticación** que las rutas de datos, pero con `requireAuth: false`. Esto significa que:

- El JWT del usuario se **analiza e inyecta** en el contexto si está presente
- Pero las solicitudes **no se rechazan** si no se proporciona ningún JWT
- Debes **proteger explícitamente** las rutas que requieran autenticación

Un emisor que presente un token *inválido* nunca llega a tu manejador: el propio middleware rechaza con un 401 cualquier token que no se pueda verificar o que haya expirado, por lo que una sesión expirada nunca se degrada silenciosamente a una anónima.

### Lectura del emisor de la solicitud

```typescript
import { defineFunction, getUser, getUserId, getRoles, isAdmin } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/me", (c) => {
        const user = getUser(c);          // { uid, roles, ...claims } | undefined
        if (!user) return c.json({ error: "Unauthorized" }, 401);
        return c.json({ uid: user.uid, roles: user.roles, admin: isAdmin(c) });
    });
});
```

`getUser` devuelve un objeto tipado de forma más específica: `uid` es un string y `roles` siempre es un array, independientemente del método de autenticación que haya utilizado el emisor. `getUserId(c)` y `getRoles(c)` son atajos.

### Protección de rutas

```typescript
import { defineFunction, requireAuth, requireAdmin, requireRole, getUserId } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    // Public endpoint — no guard, so anyone can call it.
    app.get("/public", (c) => c.json({ message: "Anyone can access this" }));

    // 401 for anonymous callers.
    app.post("/protected", requireAuth, (c) => c.json({ message: `Hello, ${getUserId(c)}` }));

    // 401 anonymous, 403 without an administrative role. Order matters.
    app.post("/admin-only", requireAuth, requireAdmin, (c) => c.json({ ok: true }));

    // Any one of the named roles.
    app.post("/publish", requireAuth, requireRole("editor", "admin"), (c) => c.json({ ok: true }));
});
```

Coloca las restricciones (*guards*) en la **propia posición de middleware de la ruta**, como se muestra arriba, en lugar de usar `app.use("/*", requireAuth)`. `use()` solo cubre las rutas declaradas *debajo* de él, por lo que una ruta agregada posteriormente (al final del archivo, meses después) quedaría desprotegida silenciosamente.

:::important
Leer `getUser(c)` **no** es un guardia de seguridad (*guard*). Un emisor anónimo obtiene `undefined` y tu manejador se ejecuta de todos modos. Solo un guard, o un `if (!user) return 401` explícito, detiene la solicitud.
:::

### Autenticación mediante Service Key

Rebase admite una clave estática `REBASE_SERVICE_KEY` definida en tu archivo `.env` para llamadas mediante scripts o de servidor a servidor.

Cuando una solicitud externa envía la service key mediante el encabezado Authorization (`Authorization: Bearer <service_key>`), el middleware de autenticación automáticamente:
1. Valida la clave mediante una comparación de tiempo constante para evitar ataques de temporización (*timing attacks*).
2. Otorga acceso de nivel de administrador, configurando al emisor como `{ uid: "service", roles: ["admin"] }`.
3. Inyecta un `DataDriver` con el alcance de esa misma identidad de servicio. La seguridad a nivel de fila (Row-Level Security) sigue aplicándose: se evalúa como `{ uid: "service", roles: ["admin"] }`, no se omite.

### Autoautenticación interna

Si no has configurado una `REBASE_SERVICE_KEY`, Rebase genera una **clave interna aleatoria por cada arranque**. El singleton `rebase` usa esta clave automáticamente al llamar a las APIs del plano de control del propio servidor (como `rebase.auth` o `rebase.storage`). Esto significa que la lógica de tu servidor siempre puede realizar tareas administrativas incluso sin una clave de servicio configurada manualmente.

## Acceso a la base de datos y servicios

### 1. El driver con alcance de usuario — para todo lo que atienda una solicitud

`getDriver(c)` devuelve el driver **con el alcance del emisor de la llamada**, por lo que cada lectura y escritura se evalúa contra tus políticas de Row-Level Security como ese usuario:

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

### RLS-Scoped Driver vs. Rebase Singleton

|                     | `getDriver(c)` (alcance de solicitud)          | `rebase.dataAsAdmin` (identidad de servicio)                     |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **Se ejecuta como** | El emisor (`uid`, sus roles)                   | `{ uid: "service", roles: ["admin"] }`                            |
| **Aplicación de RLS** | ✅ Sí (se evalúa contra el emisor)            | ✅ Sí (se evalúa contra la identidad de servicio)                |
| **Ideal para...**    | CRUD general de usuarios, búsquedas y consultas| Trabajos en segundo plano, disparadores del sistema, webhooks    |
| **Estilo de API**   | Métodos a nivel de driver (`fetchCollection`, `save`) | Descriptores fluidos de colecciones (`rebase.dataAsAdmin.jobs.find`) |

#### Qué es `dataAsAdmin`, con precisión

`rebase.dataAsAdmin` **tiene alcance de administrador, no elude RLS**. El driver se configura una vez, en el arranque, con `withAuth({ uid: "service", roles: ["admin"] })`, por lo que cada lectura y escritura se ejecuta dentro de una transacción que ha cambiado al rol restringido `rebase_user` con `app.uid = 'service'`. Tus políticas se evalúan: contra esa identidad.

Para la mayoría de los proyectos, la diferencia nunca se nota, porque las políticas predeterminadas que Rebase inyecta en cada colección admiten `serverContext() OR rolesOverlap(['admin'])`, y la identidad de servicio cumple con la segunda condición. Se hace evidente en el momento en que escribes tus propias políticas:

- **`policy.serverContext()` es falso para él.** Ese helper compila a `rebase.uid() IS NULL`, y el `uid` de este descriptor de acceso es `'service'`. Una colección con `disableDefaultPolicies: true` cuya única regla de escritura sea `serverContext()` rechazará una escritura con `dataAsAdmin` con el error de Postgres `42501`, y una lectura contra dicha colección devolverá **cero filas con HTTP 200** — la dirección silenciosa. Escribe `rolesOverlap(["admin"])` (o añádelo junto a él) cuando te refieras a "mi backend".
- **Su alcance equivale al alcance de un usuario `admin`.** Conceder el rol `admin` a un usuario de la aplicación le otorga exactamente las filas que ve este descriptor de acceso. No es un canal privado.

### 3. `rebase.sql()` — SQL puro y el único descriptor de acceso exclusivo de Node

Si realmente necesitas una omisión incondicional, `rebase.sql()` es la solución: SQL puro en la conexión propietaria (*owner*), sin políticas, todas las filas. Es el elemento con más privilegios en el contexto de una función, más incluso que el descriptor de acceso que lleva "admin" en su nombre.

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

Se ejecuta sobre una conexión TCP a tu base de datos, lo que lo convierte en el único descriptor de acceso vinculado a un proceso de Node. Eso no supone ningún problema en ninguna implementación existente hoy en día; simplemente es lo único que debes tener en cuenta si una función pudiera trasladarse más adelante. Consulta [Portabilidad en el entorno de ejecución](#portabilidad-en-el-entorno-de-ejecución).

:::caution[El acceso directo a Drizzle es exclusivo de Node]
También puedes importar tu propia instancia de Drizzle y consultarla directamente (`db.execute(sql\`…\`)`). Funciona, y en un despliegue autohospedado o administrado en Node no hay ningún inconveniente.

Vale la pena saber lo que implica: una función que importa `drizzle-orm` y un pool de `pg` se convierte permanentemente en una función exclusiva de Node, elude las validaciones y callbacks de tus colecciones, y obtiene su conexión de un lugar ajeno a la solicitud. `rebase.sql()` te proporciona el mismo SQL puro a través de la propia conexión del framework. Es la opción preferible.
:::

## Configuración y secretos

Lee la configuración **dentro** del manejador, nunca en el alcance del módulo:

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

Por qué esto es importante en **cualquier** entorno de ejecución, incluido Node:

```typescript no-verify
// Don't. If STRIPE_SECRET_KEY is unset, this throws while the file is being
// imported — and the loader reports that as a *skipped function*. The route
// 404s, with the reason buried in a boot log line.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

Una lectura en el alcance del módulo se evalúa cuando se importa el archivo, antes de que exista cualquier solicitud. En Node, eso significa que una sola variable faltante hace caer todo el archivo y todas las rutas que contiene. En un host que adjunta la configuración a la solicitud en lugar de al proceso, no hay nada que leer en el momento de la importación.

- `getEnv(c)` — cada variable visible para esta solicitud
- `env(c, "NAME")` — una variable, recortada (*trimmed*); vacía cuenta como no definida
- `requireEnv(c, "NAME")` — lo mismo, pero lanza un mensaje indicando el nombre de la variable
- `lazyResource(factory)` — construye un cliente costoso una sola vez, en el primer uso

`rebase doctor` reporta lecturas de `process.env` en el alcance del módulo dentro de tu directorio de funciones.

## Trabajo en segundo plano

El trabajo que debe continuar tras enviar la respuesta debe ir en `waitUntil`:

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

Una promesa sin `await` parece equivalente pero no lo es. `waitUntil` aporta dos cosas:

- **En Node**, se hace un seguimiento de la promesa, por lo que un apagado ordenado (*graceful shutdown*) la espera en lugar de que el proceso termine dejando un webhook a medio enviar. Una promesa flotante durante un `SIGTERM` simplemente se pierde.
- **En un host basado en aislados (*isolates*)**, se le indica al host que mantenga activo el aislado hasta que la promesa se resuelva. Sin esto, el trabajo se interrumpe en el momento en que se resuelve la respuesta, de forma silenciosa y con un 200 limpio en los registros.

Cualquier rechazo se registra en los logs en lugar de dejarse al manejador de rechazos no controlados, por lo que el error indicará el nombre de la ruta de la que provino.

## Portabilidad en el entorno de ejecución

Una función personalizada es una aplicación de Hono, y Hono se ejecuta en cualquier entorno de ejecución de servidor de JavaScript. Por lo tanto, el hecho de que *tu* función pueda ejecutarse en un lugar distinto a un proceso de Node depende de lo que su propio archivo importe y utilice.

Nada de lo que se menciona aquí representa una restricción sobre lo que puedes escribir hoy. Cada despliegue de Rebase es un proceso de Node; una función que lee un archivo o abre un socket es una función perfectamente válida, y ninguna compilación o despliegue fallará por nada de esto. Se documenta para que se conozca de antemano en lugar de descubrirlo archivo por archivo más adelante.

**Portable — funciona en cualquier entorno de ejecución:**

- Todo lo exportado desde `@rebasepro/server/functions`
- `getDriver(c)` y `rebase.dataAsAdmin` — ambos utilizan la misma conexión independientemente de dónde se ejecuten
- `rebase.auth`, `rebase.storage`, `rebase.email`
- `fetch`, `Request`/`Response`, `URL`, `crypto.subtle`, `TextEncoder` — la plataforma web
- Cualquier dependencia que no requiera Node

**Exclusivo de Node:**

- `rebase.sql()` — la conexión propietaria de la base de datos es un socket TCP
- Un cliente de Drizzle/`pg`/`mongodb` importado directamente, por la misma razón
- Módulos integrados de Node: `fs`, `path`, `crypto` (el módulo de Node — `globalThis.crypto` es portable), `child_process`, …
- Paquetes basados en ellos: `jsonwebtoken`, `nodemailer`, `sharp`, `bcrypt`, …

**Errores latentes en cualquier entorno de ejecución** — vale la pena corregirlos en cualquier caso:

- Lectura de `process.env` en el alcance del módulo (consulta [Configuración y secretos](#configuración-y-secretos))
- Promesas de tipo 'lanzar y olvidar' (*fire-and-forget*) en lugar de [`waitUntil`](#trabajo-en-segundo-plano)
- Depender de que un manejador continúe ejecutándose después de que su solicitud haya agotado el tiempo de espera. En Node lo hace; esa es una propiedad del proceso, no una garantía garantizada por el framework

### Comprobación de tus propias funciones

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

`rebase doctor` reporta lo mismo sin necesidad de compilar.

### Si necesitas una ruta específica para un entorno de ejecución

`runtimeKey()` devuelve `"node"`, `"workerd"`, `"deno"`, `"bun"`, `"edge-light"`, `"fastly"` u `"other"`; `isNodeRuntime()` es la comprobación habitual. Úsalos para degradar de forma controlada, no para bifurcar una implementación: una función que requiere dos implementaciones son en realidad dos funciones.

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

Las funciones personalizadas se cargan y montan **después** de que `initializeRebaseBackend()` complete la configuración principal. El orden de inicialización es:

1. **Inicializadores (*bootstrappers*)** — Conexiones a bases de datos, tablas de autenticación, servicios en tiempo real
2. **Rutas de autenticación** — `/api/auth/*`, `/api/admin/*`
3. **Rutas de almacenamiento** — `/api/storage/*`
4. **Rutas de datos** — `/api/data/*` (CRUD para colecciones)
5. **Funciones personalizadas** ← `/api/functions/*`
6. **Tareas cron** — `/api/cron/*`
7. **WebSocket** — Suscripciones en tiempo real

Esto significa que tus funciones personalizadas tienen acceso a todos los servicios inicializados. Registra directamente en la aplicación de Hono cualquier ruta que deba ejecutarse **antes** de Rebase, previo a la llamada a `initializeRebaseBackend()`:

```typescript no-verify
const app = new Hono<HonoEnv>();

// This runs BEFORE Rebase routes
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase initialization — registers all /api/* routes
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
Las rutas que agregas a tu propia aplicación de esa manera están **fuera** de cualquier enrutador de Rebase, por lo que ningún middleware de autenticación se ha ejecutado en ellas y `getDriver(c)` no estará definido. Protege esas rutas con `requireAuth` / `requireAdmin` importados desde **`@rebasepro/server`** (la raíz del paquete), los cuales verifican el token por sí mismos. Las restricciones en la subruta `/functions` leen una identidad que un enrutador de Rebase ya ha resuelto y responderán con un 500 en lugar de fingir que existe una.
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

El enrutador se monta para el **directorio**, no para las funciones individuales dentro de él. Si todos los archivos fallan al importarse (una sola variable de entorno faltante en el alcance del módulo es suficiente para derribarlos a todos), `GET /api/functions` responderá igualmente con un `200` con una lista vacía más un contador de `skipped`, de modo que "nada cargado" se pueda distinguir de "esta compilación no incluía funciones". El listado en sí requiere un emisor autenticado, una clave de API o la service key; las funciones siguen siendo invocables por quien cada una admita, pero el inventario de las mismas no es público. Los motivos permanecen en el registro de arranque.

## Tiempos de espera y límites de tasa (*Rate Limits*)

Se aplican dos límites a `/api/functions/*`:

- **Tiempo de espera de solicitud (*request timeout*)** — 30 segundos por defecto, respondiendo `504` con el código `FUNCTION_TIMEOUT`. Configúralo con `functionsTimeoutMs` (o `REBASE_FUNCTIONS_TIMEOUT_MS`); `0` lo desactiva. El manejador no se puede cancelar desde el exterior, así que asigna un `AbortSignal` a las llamadas HTTP salientes: el tiempo de espera libera al cliente y al socket, no la tarea en ejecución. Que el manejador *siga ejecutándose* después del 504 es una propiedad de un proceso de Node de larga duración, no una garantía del contrato; cualquier cosa que deba completarse obligatoriamente corresponde a [`waitUntil`](#trabajo-en-segundo-plano).
- **Límite de tasa (*rate limit*)** — Los emisores con clave de API y autenticados comparten los límites de la API de datos. Los emisores anónimos obtienen su propia asignación, mucho más flexible (3000 por ventana), ya que este enrutador es público de forma predeterminada para receptores de webhooks. Modifícalo con `rateLimit.anonymousFunctions`; `null` lo desactiva.

Los rechazos de promesas no controlados se registran en los logs en lugar de ser fatales: de lo contrario, una llamada de tipo fire-and-forget en una función terminaría con todo el proceso. Establece `REBASE_EXIT_ON_UNHANDLED_REJECTION=1` para el comportamiento predeterminado de Node.

## Próximos pasos

- **[Visión general del backend](/docs/backend)** — Referencia completa de configuración del backend
- **[Callbacks de entidades](/docs/collections/callbacks)** — Ejecuta lógica ante cambios en los datos
- **[Tareas cron](/docs/backend/cron-jobs)** — Tareas programadas en segundo plano
