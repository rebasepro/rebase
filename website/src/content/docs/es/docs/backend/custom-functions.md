---
title: Funciones Personalizadas
sidebar_label: Funciones Personalizadas
description: Añada puntos finales de API Hono personalizados junto con sus rutas CRUD de Rebase. Auto-descubiertos desde un directorio, con acceso completo a la instancia de backend.
---

## Resumen

Las funciones personalizadas le permiten añadir **rutas de API Hono arbitrarias** junto con los puntos finales CRUD auto-generados de Rebase. Siguen el mismo patrón de **descubrimiento basado en archivos** que las colecciones y los trabajos cron: coloque un archivo TypeScript en su directorio `functions/`, y Rebase lo montará automáticamente.

Utilice funciones personalizadas para:

- **Puntos finales de lógica de negocio** — aprobaciones, promociones, flujos de trabajo personalizados
- **Integraciones de terceros** — webhooks de Stripe, comandos de Slack, proxies de APIs externas
- **Puntos finales públicos** — formularios de contacto, captación de clientes, comprobaciones de estado
- **Consultas agregadas** — estadísticas de paneles, informes, analíticas

## Definir una Función Personalizada

Cree un archivo en su directorio `backend/functions/` que exporte por defecto una aplicación Hono:

```typescript
// backend/functions/hello.ts
import { defineFunction } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/", (c) => c.json({ message: "Hello from custom function!" }));
});
```

Esto se monta en **`/api/functions/hello`**. El nombre del archivo (sin extensión) se convierte en el prefijo de la ruta.

:::important
Importe desde **`@rebasepro/server/functions`**, no desde `@rebasepro/server`.

Ambos funcionan. La subruta es la superficie de autoría *portable*: no arrastra nada que requiera Node, de modo que una función escrita contra ella puede ejecutarse en cualquier runtime de JavaScript. La raíz del paquete alcanza todo el framework — la secuencia de arranque, los cargadores de archivos, la capa WebSocket — lo cual es correcto para un punto de entrada de servidor y es más de lo que necesita un manejador de rutas. También le proporciona accesores de contexto tipados (`getUser`, `getDriver`) en lugar de convertir `c.get("user")` a mano.

Consulte [Portabilidad entre runtimes](#portabilidad-entre-runtimes) para el contrato completo.
:::

## Configuración

Habilite las funciones personalizadas añadiendo `functionsDir` a su configuración de backend:

```typescript no-verify
import path from "path";

const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
});
```

Rebase hará lo siguiente:

1. Escanear el directorio en busca de archivos `.ts` / `.js`
2. Validar que cada exportación por defecto es una aplicación Hono (verificado por duck-typing con `.fetch()` + `.routes`)
3. Montar cada aplicación en `/api/functions/<filename>`
4. Aplicar el middleware de autenticación (ver [Autenticación](#autenticación-y-propagación-de-contexto) a continuación)

## Nombres de Archivo y Mapeo de Rutas

| Archivo | Ruta de Montaje |
|------|-----------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

Las funciones se descubren **únicamente en el nivel superior del directorio** — no hay recursión. `functions/admin/users.ts` es compilado por `rebase build` pero nunca se monta; aplane el nombre en su lugar (`functions/admin-users.ts`). Un subdirectorio se reporta durante el arranque y se contabiliza en el punto final de listado, en lugar de ignorarse en silencio.

Archivos que se **omiten**:

- `index.ts` / `index.js` — reservados
- `*.test.ts` / `*.test.js` — archivos de prueba
- `*.d.ts` — declaraciones de tipos
- Subdirectorios, y archivos `.mts` / `.cts` / `.tsx` / `.jsx` / `.mjs` / `.cjs` — se reportan como problemas, ya que la compilación abarca más de lo que el runtime carga

El nombre es también la identidad de la función en todos los demás lugares: es el segmento de la URL, el permiso `functions/<name>` de una clave de API, y el valor que `REBASE_FUNCTIONS_ONLY` selecciona cuando le da a una función su propio proceso.

## Formatos de Exportación

Además de `defineFunction`, el cargador acepta dos formatos de exportación:

### Aplicación Hono

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server/functions";

const app = new Hono<HonoEnv>();
app.get("/status", (c) => c.json({ ok: true }));
export default app;
```

### Función Fábrica

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server/functions";

export default function () {
    const app = new Hono<HonoEnv>();
    app.get("/status", (c) => c.json({ ok: true }));
    return app;
}
```

`defineFunction` devuelve exactamente la aplicación Hono que estas construyen a mano, así que las tres son intercambiables. Le ahorra declarar `Hono<HonoEnv>` y le entrega el singleton `rebase` en la retrollamada.

---

## Bajo el Capó: El Cargador con Duck-Typing

Al compilar bases de código con múltiples directorios anidados o en monorepos, puede encontrarse con **duplicación del paquete Hono**.

Si el framework Rebase depende de una versión de Hono y su directorio local de funciones resuelve otra, las comprobaciones estándar de herencia de clases (`exported instanceof Hono`) fallarán porque sus prototipos existen en espacios de memoria separados.

Para evitar falsos negativos y el rechazo de routers funcionales, Rebase utiliza un validador con duck-typing (`isHonoLike`):
- Verifica que el objeto exportado es un `object` no nulo.
- Comprueba que el objeto expone un método `.fetch` (necesario para enrutar peticiones).
- Verifica que `.routes` es un `array`.

```typescript no-verify
function isHonoLike(obj: unknown): boolean {
    if (!obj || typeof obj !== "object") return false;
    const record = obj as Record<string, unknown>;
    return typeof record.fetch === "function" && Array.isArray(record.routes);
}
```

### Escape del Compilador de Módulos ES

Para importar archivos TypeScript y JavaScript dinámicamente tanto en sistemas Windows como Posix, el cargador convierte las rutas de archivo a URIs de archivo estándar mediante `pathToFileURL(filePath).href`.

Para evitar que la compilación de TypeScript reescriba las importaciones dinámicas ESM nativas (`import(url)`) como llamadas `require()` de CommonJS (lo que lanzaría errores en tiempo de ejecución bajo runtimes ESM), Rebase ejecuta un escape del compilador en tiempo de ejecución:

```typescript no-verify
const dynamicImport = new Function("url", "return import(url)");
const mod = await dynamicImport(fileUrl);
```

---

## Autenticación y Propagación de Contexto

Las funciones personalizadas se montan con el **mismo middleware de autenticación** que las rutas de datos, pero con `requireAuth: false`. Esto significa que:

- El JWT del usuario se **analiza e inyecta** en el contexto si está presente
- Pero las peticiones **no se rechazan** si no se proporciona un JWT
- Usted debe **proteger explícitamente** las rutas que requieran autenticación

Quien presente un token *inválido* nunca llega a su manejador: un token no verificable o caducado es rechazado con 401 por el propio middleware, de modo que una sesión caducada nunca se degrada silenciosamente a una anónima.

### Leer al llamante

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

`getUser` devuelve un objeto acotado: `uid` es una cadena y `roles` es siempre un array, sea cual sea el método de autenticación que haya usado el llamante. `getUserId(c)` y `getRoles(c)` son atajos.

### Proteger Rutas

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

Coloque las protecciones en la **ranura de middleware de la propia ruta**, como arriba, en lugar de `app.use("/*", requireAuth)`. `use()` cubre únicamente las rutas declaradas *por debajo* de él, así que una ruta añadida más tarde — al final del archivo, dentro de unos meses — queda desprotegida en silencio.

:::important
Leer `getUser(c)` **no** es una protección. Un llamante anónimo obtiene `undefined` y su manejador se ejecuta igualmente. Solo una protección, o un `if (!user) return 401` explícito, detiene la petición.
:::

### Autenticación con Clave de Servicio

Rebase admite una `REBASE_SERVICE_KEY` estática definida en su `.env` para scripts o llamadas de servidor a servidor.

Cuando una petición externa pasa la clave de servicio mediante la cabecera Authorization (`Authorization: Bearer <service_key>`), el middleware de autenticación automáticamente:
1. Valida la clave usando comparación en tiempo constante para prevenir ataques de temporización.
2. Concede acceso de nivel administrador, estableciendo al llamante como `{ uid: "service", roles: ["admin"] }`.
3. Inyecta un `DataDriver` acotado a esa misma identidad de servicio. La Seguridad a Nivel de Fila sigue aplicándose — se evalúa como `{ uid: "service", roles: ["admin"] }`, no se omite.

### Auto-Autenticación Interna

Si no ha configurado una `REBASE_SERVICE_KEY`, Rebase genera una **clave interna aleatoria por arranque**. El singleton `rebase` usa esta clave automáticamente al llamar a las APIs del plano de control del propio servidor (como `rebase.auth` o `rebase.storage`). Esto significa que su lógica del lado del servidor siempre puede realizar tareas administrativas incluso sin una clave de servicio configurada manualmente.

## Acceder a la Base de Datos y a los Servicios

### 1. El driver acotado al usuario — para todo lo que sirva una petición

`getDriver(c)` devuelve el driver **acotado al llamante**, de modo que cada lectura y escritura se evalúa contra sus políticas de Seguridad a Nivel de Fila como ese usuario:

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

`requireDriver(c)` es `getDriver(c)` sin el `!` — lanza un mensaje que nombra el problema de montaje en lugar de fallar veinte líneas después sobre `undefined`.

### 2. `rebase.dataAsAdmin` — para trabajo de confianza en segundo plano

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

### Driver acotado por RLS vs. Singleton de Rebase

|                     | `getDriver(c)` (acotado a la petición)         | `rebase.dataAsAdmin` (identidad de servicio)                      |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **Se ejecuta como** | El llamante (`uid`, sus roles)                 | `{ uid: "service", roles: ["admin"] }`                            |
| **Aplicación de RLS** | ✅ Sí (evaluada contra el llamante)           | ✅ Sí (evaluada contra la identidad de servicio)                  |
| **Ideal para...**   | CRUD de usuario, búsquedas y consultas          | Trabajos en segundo plano, disparadores de sistema, webhooks      |
| **Estilo de API**   | Métodos del driver (`fetchCollection`, `save`)  | Accesores fluidos de colección (`rebase.dataAsAdmin.jobs.find`) |

#### Qué es `dataAsAdmin`, con precisión

`rebase.dataAsAdmin` está **acotado a administrador, no elude la RLS**. El driver se acota una sola vez, durante el arranque, con `withAuth({ uid: "service", roles: ["admin"] })`, de modo que cada lectura y escritura ocurre dentro de una transacción que ha cambiado al rol restringido `rebase_user` con `app.uid = 'service'`. Sus políticas se evalúan — contra esa identidad.

Para la mayoría de proyectos la distinción nunca aflora, porque las políticas por defecto que Rebase inyecta en cada colección admiten `serverContext() OR rolesOverlap(['admin'])`, y la identidad de servicio supera la segunda rama. Aflora en el momento en que usted escribe sus propias políticas:

- **`policy.serverContext()` es falso para ella.** Ese ayudante se compila a `rebase.uid() IS NULL`, y el `uid` de este accesor es `'service'`. Una colección con `disableDefaultPolicies: true` cuya única regla de escritura sea `serverContext()` rechazará una escritura de `dataAsAdmin` con el error de Postgres `42501`, y una lectura contra tal colección devuelve **cero filas con HTTP 200** — la dirección silenciosa. Escriba `rolesOverlap(["admin"])` (o añádalo junto a lo demás) cuando quiera decir "mi backend".
- **Su alcance equivale al de un usuario `admin`.** Conceder el rol `admin` a un usuario de la aplicación le concede exactamente las filas que ve este accesor. No es un canal privado.

### 3. `rebase.sql()` — SQL en crudo, y el único accesor exclusivo de Node

Si realmente necesita una elusión incondicional, `rebase.sql()` lo es: SQL en crudo sobre la conexión del propietario, sin políticas, todas las filas. Es lo más privilegiado del contexto de una función — más que el accesor que lleva "admin" en el nombre.

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

Se ejecuta sobre una conexión TCP a su base de datos, lo que lo convierte en el único accesor atado a un proceso Node. Eso no cuesta nada en ningún despliegue que exista hoy — simplemente es lo único que conviene saber si una función pudiera trasladarse más adelante. Vea [Portabilidad entre runtimes](#portabilidad-entre-runtimes).

:::caution[El acceso directo a Drizzle es exclusivo de Node]
También puede importar su propia instancia de Drizzle y consultarla directamente (`db.execute(sql\`…\`)`). Funciona, y en un despliegue Node auto-alojado o gestionado está bien.

Conviene saber lo que cuesta: una función que importa `drizzle-orm` y un pool de `pg` es permanentemente una función de Node, elude las retrollamadas y la validación de su colección, y toma su conexión de un lugar distinto del de la petición. `rebase.sql()` le da el mismo SQL en crudo a través de la propia conexión del framework. Prefiéralo.
:::

## Configuración y Secretos

Lea la configuración **dentro** del manejador, nunca en el ámbito del módulo:

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

Por qué esto importa en **cualquier** runtime, Node incluido:

```typescript no-verify
// Don't. If STRIPE_SECRET_KEY is unset, this throws while the file is being
// imported — and the loader reports that as a *skipped function*. The route
// 404s, with the reason buried in a boot log line.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

Una lectura en el ámbito del módulo se evalúa cuando el archivo se importa, antes de que exista petición alguna. En Node eso significa que una sola variable ausente derriba el archivo entero y con él todas sus rutas. En un host que adjunta la configuración a la petición en lugar de al proceso, sencillamente no hay nada que leer en tiempo de importación.

- `getEnv(c)` — todas las variables visibles para esta petición
- `env(c, "NAME")` — una variable, sin espacios sobrantes; en blanco cuenta como no definida
- `requireEnv(c, "NAME")` — lo mismo, pero lanza un mensaje que nombra la variable
- `lazyResource(factory)` — construye un cliente costoso una sola vez, en el primer uso

`rebase doctor` informa de las lecturas de `process.env` en el ámbito del módulo dentro de su directorio de funciones.

## Trabajo en Segundo Plano

El trabajo que deba sobrevivir a la respuesta va en `waitUntil`:

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

Una promesa sin `await` parece equivalente y no lo es. `waitUntil` aporta dos cosas:

- **En Node**, la promesa queda registrada, de modo que un apagado ordenado la espera en lugar de que el proceso salga por debajo de un webhook a medio enviar. Una promesa suelta en `SIGTERM` simplemente se pierde.
- **En un host basado en aislamientos**, se le indica al host que mantenga vivo el aislamiento hasta que la promesa se resuelva. Sin ello, el trabajo se descarta en cuanto se resuelve la respuesta — en silencio, con un 200 limpio en los registros.

Un rechazo se registra en lugar de dejarse al manejador de rechazos no capturados, de modo que el fallo nombra la ruta de la que vino.

## Portabilidad entre runtimes

Una función personalizada es una aplicación Hono, y Hono se ejecuta en todos los runtimes de servidor de JavaScript. Que *su* función pueda ejecutarse en algún lugar distinto de un proceso Node se reduce, por tanto, a lo que su propio archivo importe y toque.

Nada de esto restringe lo que puede escribir hoy. Todo despliegue de Rebase es un proceso Node, una función que lee un archivo o abre un socket es una función perfectamente válida, y ninguna compilación ni despliegue falla por nada de esto. Está escrito para que la respuesta se pueda conocer ahora en lugar de descubrirse archivo a archivo más tarde.

**Portable — funciona en cualquier runtime:**

- Todo lo exportado por `@rebasepro/server/functions`
- `getDriver(c)` y `rebase.dataAsAdmin` — ambos viajan por el mismo cable dondequiera que se ejecuten
- `rebase.auth`, `rebase.storage`, `rebase.email`
- `fetch`, `Request`/`Response`, `URL`, `crypto.subtle`, `TextEncoder` — la plataforma web
- Cualquier dependencia que no necesite Node

**Exclusivo de Node:**

- `rebase.sql()` — la conexión del propietario de la base de datos es un socket TCP
- Un cliente de Drizzle/`pg`/`mongodb` importado directamente, por la misma razón
- Módulos integrados de Node: `fs`, `path`, `crypto` (el módulo de Node — `globalThis.crypto` sí es portable), `child_process`, …
- Paquetes construidos sobre ellos: `jsonwebtoken`, `nodemailer`, `sharp`, `bcrypt`, …

**Errores latentes en todos los runtimes** — merece la pena corregirlos en cualquier caso:

- `process.env` leído en el ámbito del módulo (vea [Configuración y Secretos](#configuración-y-secretos))
- Promesas sin `await` en lugar de [`waitUntil`](#trabajo-en-segundo-plano)
- Confiar en que un manejador siga ejecutándose después de que su petición haya expirado. En Node lo hace; eso es una propiedad del proceso, no una promesa que haga el framework

### Comprobar sus propias funciones

`rebase build` imprime una línea por cada hallazgo accionable y registra el veredicto por función en el manifiesto del bundle:

```json
{
  "functions": [
    { "name": "hello", "file": "backend/functions/hello.js", "portable": true },
    { "name": "reports", "file": "backend/functions/reports.js", "portable": false,
      "requires": ["imports the Node built-in \"fs\""] }
  ]
}
```

`rebase doctor` informa de lo mismo sin compilar.

### Si necesita una vía específica del runtime

`runtimeKey()` devuelve `"node"`, `"workerd"`, `"deno"`, `"bun"`, `"edge-light"`, `"fastly"` u `"other"`; `isNodeRuntime()` es la comprobación habitual. Úselos para degradar, no para bifurcar una implementación — una función que necesita dos implementaciones son dos funciones.

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

## Orden de Registro de Rutas

Las funciones personalizadas se cargan y montan **después** de que `initializeRebaseBackend()` complete la configuración principal. El orden de inicialización es:

1. **Bootstrappers** — Conexiones de base de datos, tablas de autenticación, servicios de tiempo real
2. **Rutas de autenticación** — `/api/auth/*`, `/api/admin/*`
3. **Rutas de almacenamiento** — `/api/storage/*`
4. **Rutas de datos** — `/api/data/*` (CRUD de colecciones)
5. **Funciones personalizadas** ← `/api/functions/*`
6. **Trabajos cron** — `/api/cron/*`
7. **WebSocket** — Suscripciones en tiempo real

Esto significa que sus funciones personalizadas tienen acceso a todos los servicios inicializados. Registre cualquier ruta que deba ejecutarse **antes** que Rebase directamente en la aplicación Hono, antes de llamar a `initializeRebaseBackend()`:

```typescript no-verify
const app = new Hono<HonoEnv>();

// This runs BEFORE Rebase routes
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase initialization — registers all /api/* routes
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
Las rutas que añada de ese modo a su propia aplicación quedan **fuera** de todos los routers de Rebase, así que ningún middleware de autenticación se ha ejecutado sobre ellas y `getDriver(c)` no está definido. Proteja esas rutas con `requireAuth` / `requireAdmin` importados desde **`@rebasepro/server`** — la raíz del paquete — que verifican el token por sí mismos. Las protecciones de la subruta `/functions` leen una identidad que un router de Rebase ya ha resuelto, y responderán 500 en lugar de fingir que existe una.
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

Cuando una función se carga correctamente, verá:

```
⚡ Loaded function route: hello
```

Si la carga falla, el cargador ofrece un diagnóstico:

```
[functions] broken-function.ts: default export is not a Hono app or factory. Skipping.
  export type: object (SomeClass)
  prototype methods: constructor, someMethod
  Hint: ensure the function exports a Hono app created with the same hono version as the server.
```

El router se monta para el **directorio**, no para las funciones que contiene. Si todos los archivos fallan al importarse — una sola variable de entorno ausente en el ámbito del módulo basta para derribarlos todos — `GET /api/functions` sigue respondiendo `200` con una lista vacía más un recuento `skipped`, de modo que "no se cargó nada" es distinguible de "esta compilación no incluía funciones". Los motivos quedan en el registro de arranque.

## Tiempos de Espera y Límites de Tasa

Se aplican dos techos a `/api/functions/*`:

- **Tiempo de espera de la petición** — 30 segundos por defecto, respondiendo `504` con el código `FUNCTION_TIMEOUT`. Configúrelo con `functionsTimeoutMs` (o `REBASE_FUNCTIONS_TIMEOUT_MS`); `0` lo desactiva. El manejador no puede cancelarse desde fuera, así que dé un `AbortSignal` a las llamadas HTTP salientes — el tiempo de espera libera al cliente y el socket, no el trabajo. Que el manejador *siga ejecutándose* tras el 504 es una propiedad de un proceso Node de larga vida, no una garantía del contrato; todo lo que deba completarse pertenece a [`waitUntil`](#trabajo-en-segundo-plano).
- **Límite de tasa** — los llamantes con clave de API y los autenticados comparten los cubos de la API de datos. Los llamantes anónimos tienen su propia asignación, mucho más holgada (3000 por ventana), porque este router es público por defecto para receptores de webhooks. Sobrescríbalo con `rateLimit.anonymousFunctions`; `null` lo desactiva.

Los rechazos de promesas no capturados se registran en lugar de ser fatales: una llamada sin espera en una función terminaría de otro modo con el proceso entero. Establezca `REBASE_EXIT_ON_UNHANDLED_REJECTION=1` para el comportamiento por defecto de Node.

## Próximos Pasos

- **[Resumen del Backend](/docs/backend)** — Referencia completa de configuración del backend
- **[Retrollamadas de Entidad](/docs/collections/callbacks)** — Ejecutar lógica en cambios de datos
- **[Trabajos Cron](/docs/backend/cron-jobs)** — Tareas programadas en segundo plano
