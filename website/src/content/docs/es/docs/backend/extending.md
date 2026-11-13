---
sourceHash: 8412da52cc99478c
title: Rebase no hace X
sidebar_label: Extender el servidor
description: La escala de extensiones del lado del servidor — declaración, hook de tabla, función personalizada, tus propias rutas, tu propio servidor, eject — con lo que cada uno puede y no puede alcanzar.
---

## Visión general

Algo que necesitas no está en la definición de la tabla. Esta página es el orden en
el que debes probar las cosas y —lo más útil— qué es lo que cada peldaño *no puede*
alcanzar, para que dejes de subir en el primero que pueda hacer el trabajo.

Hay una página equivalente para el panel de administración:
[Extender Rebase](/docs/frontend/extending) cubre plugins, slots, reemplazos de
componentes y vistas personalizadas. Esta se centra en el servidor.

La regla que codifica la escala: **cada peldaño te cuesta algo que el anterior
conservaba.** Una declaración es portable, actualizable y comprendida por el planificador
de esquemas, el SDK generado y el panel de administración. Para cuando llegas a
`rebase eject`, eres dueño de la secuencia de arranque y las actualizaciones del
entorno de ejecución de la plataforma ya no llegarán a tu proyecto. Así que sube solo hasta donde sea necesario.

## La escala

| # | Peldaño | Alcanza | **No** alcanza | Coste de estar aquí |
|---|---|---|---|---|
| 1 | **Declaración** — una columna, una relación, un índice, un bloque `search`, una regla `rls` | El esquema, el SDK generado, el panel de administración, el planificador de migraciones | Cualquier cosa que requiera ejecutar código | Ninguno. Este es el camino soportado |
| 2 | **Hook de tabla** — `beforeQuery`, `afterRead`, `beforeSave`, `afterSave`, `beforeDelete`, `afterDelete` | Cada lectura y escritura de una tabla, en cada transporte, dentro de la propia transacción de la petición | Peticiones que no tocan ninguna tabla; el envoltorio de la respuesta; cualquier cosa asíncrona a la escritura | Se ejecuta en la ruta crítica (hot path), manteniendo la transacción abierta |
| 3 | **Función personalizada** — una app Hono en `functions/` | Su propia URL, con la autenticación resuelta, el driver limitado al llamador y `rebase` disponible | Las rutas integradas `/api/data`. Se sitúa *al lado* de ellas, no delante | Una superficie más para autorizar; no se genera ningún método del SDK para ella |
| 4 | **Tus propias rutas y middleware** en la app Hono | Cualquier cosa HTTP, incluyendo rutas que se ejecutan *antes* de los enrutadores de Rebase | El driver y la identidad del llamador, a menos que protejas la ruta tú mismo | Fuera de todo enrutador de Rebase: no se ha ejecutado ningún middleware de autenticación |
| 5 | **Tu propio servidor** — construye el backend con `createRebaseBackend` y monta los grupos de rutas que desees, o integra el driver solo en Express, Fastify o `http` básico | Cada grupo de rutas, en la ruta que elijas, y qué proceso inicia los temporizadores; en el nivel más bajo, el adaptador de datos y realtime solos | Con el driver solo: todo lo demás, desde las rutas de autenticación y almacenamiento hasta cron y la API de administración | Invocas cada paso que `initializeRebaseBackend` hacía por ti |
| 6 | **`rebase eject`** | El punto de entrada y el `Dockerfile`, en tu repositorio | — | **Las actualizaciones del entorno de ejecución de la plataforma dejan de llegar a este proyecto.** CORS, configuración de autenticación, almacenamiento y apagado pasan a ser tu responsabilidad |

:::tip[Dos peldaños se omiten comúnmente sin motivo]
`beforeQuery` (peldaño 2) restringe una lectura *antes de que sea compilada*, que es
la razón por la que la gente suele recurrir al peldaño 3 o 5. Y un bloque `search` con
`mode: "hybrid"` (peldaño 1) es la razón por la que la gente suele recurrir a SQL puro. Ambos son
lo suficientemente recientes como para que las respuestas más antiguas en internet no los mencionen.
:::

## 1. Declaración

La mayor parte de lo que necesita un backend es una declaración en la tabla, porque una
declaración es el único peldaño que el resto del sistema puede leer. El planificador de esquemas
la convierte en DDL, el generador de código la convierte en métodos del SDK, el panel de administración
la renderiza y `rebase doctor` la compara con la base de datos en vivo.

| Quiero… | Declarar | Referencia |
|---|---|---|
| Añadir una columna | una columna `col.*` | [Columnas](/docs/schema/columns/) |
| Vincular dos tablas | una relación `rel.*` | [Relaciones](/docs/collections/relations) |
| Acelerar una consulta | `indexes` | [Índices](/docs/backend/indexes) |
| Decidir quién puede leer o escribir una fila | `rls` | [Seguridad a nivel de fila (RLS)](/docs/collections/security-rules/) |
| Buscar texto adecuadamente — acentos, JSONB, ranking, subcadenas | un bloque `search` | [Búsqueda](/docs/backend/search) |
| Buscar filas por significado semántico | una columna `col.vector()` | [Búsqueda vectorial](/docs/backend/vector-search/) |
| Conservar filas eliminadas | `softDelete` | [Borrado suave](/docs/collections/soft-delete) |
| Registrar quién cambió qué | `history` | [Historial](/docs/backend/history) |
| Ejecutar algo de forma programada | un archivo de cron job | [Tareas cron](/docs/backend/cron-jobs) |
| Ejecutar algo tras una escritura, fuera de banda | un job | [Jobs](/docs/backend/jobs) |

**Lo que no puede alcanzar:** cualquier cosa que tenga que tomar una decisión en el momento de la petición.
Una declaración son datos. Si la respuesta depende de quién esté preguntando, pasa al peldaño 2.

## 2. Hooks de tabla

**Alcance:** una tabla, o todas las tablas cuando se exportan como `hooks` desde
`backend/hooks.ts` (`initializeRebaseBackend({ hooks })` al hacer eject).

Los hooks se activan en **cada** ruta de datos — REST, el SDK, suscripciones por
WebSocket y escrituras en el servidor mediante `rebase.dataAsAdmin` — y cada uno se ejecuta dentro de la
transacción abierta para esa petición. Ese es todo su valor: no hay forma de
acceder a las filas de una tabla esquivándolos.

| Hook | Se ejecuta | Úsalo para |
|---|---|---|
| `beforeQuery` | antes de que se compile una lectura | restringir **qué filas** solicita una lectura |
| `afterRead` | por cada fila, después de obtenerla | redacción, enmascaramiento de PII, campos calculados |
| `beforeSave` | tras la validación, antes de la escritura | valores por defecto, columnas derivadas, rechazar una escritura |
| `afterSave` | tras la escritura, antes del commit | efectos secundarios que deben revertirse con ella |
| `afterSaveError` | cuando un guardado lanza un error | notificación; `props.error` es lo que lanzó |
| `beforeDelete` | antes de la eliminación | rechazarla |
| `afterDelete` | tras la eliminación, antes del commit | limpieza en cascada |

→ [Hooks de tabla](/docs/collections/callbacks) ·
[Hooks globales](/docs/backend/hooks)

### Restringir una lectura con `beforeQuery`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`afterRead` ve las filas que ya han sido obtenidas, por lo que puede redactar un valor
pero no puede evitar que la fila sea leída. `beforeQuery` se ejecuta antes: recibe la
consulta procesada y devuelve condiciones para combinarlas con un **AND**.

```ts
// backend/schema/documents.ts
import { defineTable, col } from "@rebasepro/server/schema";

export const documents = defineTable("documents", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        tenantId: col.text(),
        body: col.text()
    },
    rls: "admin-only",
    hooks: {
        beforeQuery: ({ context }) => {
            if (context.user?.roles?.includes("admin")) return;        // no narrowing
            return { filter: { tenantId: ["==", context.user?.claims?.tenant ?? null] } };
        }
    }
});
```

Vale la pena conocer cuatro propiedades antes de confiar en él:

- **Solo puede restringir.** El valor de retorno es un filtro para combinar con AND, y no
  hay ninguna estructura que pueda devolver para ampliar la lectura. Esto es deliberado: si a un hook
  se le pasara la consulta y se le pidiera devolver una, podría omitir una condición, y en un
  plano de datos con seguridad a nivel de fila, una condición omitida devuelve cada fila que
  las políticas permitan por casualidad.
- **Se ejecuta en cada ruta de lectura.** El listado, la obtención individual, el conteo, la
  agregación, la búsqueda, la lectura vectorial, un listado de ruta anidada, la recarga en tiempo real
  que construye los frames de suscripción y las filas cargadas para una relación o
  un `?include=` — donde el hook que aplica es el de la tabla de **destino**.
  Un hook respetado por el listado pero no por el conteo genera una página que dice
  "1 de 4 resultados".
- **Un filtro que no pueda compilarse rechaza la petición.** Indicar una columna que la tabla
  no tiene devuelve un 400, no una condición descartada, independientemente de cómo
  esté configurado `configureUnknownFilterFields`.
- **Una escritura sobre una fila excluida devuelve un 404.** Una actualización o eliminación dirigida a
  una fila fuera del alcance se rechaza antes de escribir, con la misma respuesta
  "no row …" que da una lectura — de modo que un alcance es un alcance también para las escrituras, no solo
  para las lecturas. Lo que *no* filtra son los valores que se escriben: rechazar una escritura
  por su contenido corresponde a `beforeSave`.

Una lectura deliberadamente *no* se restringe: la comprobación de unicidad detrás
de `.unique()`. Pregunta si un valor existe en cualquier parte de la
tabla, y si estuviera restringida respondería "único" para un valor que una fila oculta ya
posee — provocando que la inserción falle en la restricción (constraint) de la base de datos.

**Lo que los hooks no pueden alcanzar:**

- Una petición que no toca ninguna tabla. No hay nada de lo que el hook
  pueda depender.
- El envoltorio de la respuesta — código de estado, cabeceras, formato de paginación. Un hook
  devuelve valores, no una respuesta.
- Trabajo que deba sobrevivir a la transacción. `afterSave` se ejecuta *antes* del commit,
  por lo que un error lanzado allí revierte la escritura. Cualquier cosa que deba sobrevivir a la
  anulación de la escritura no es parte de la escritura: colócala en la
  [cola de jobs](/docs/backend/jobs).
- Tareas lentas, en la práctica. Un hook mantiene la transacción abierta y una conexión
  del pool con ella. Cualquier cosa que se comunique con un tercero debe ir en la cola.

## 3. Funciones personalizadas

**Alcance:** una URL bajo `/api/functions`.

Una app Hono en `backend/functions/`, detectada por el nombre de archivo del mismo modo
que las tareas cron, o pasada como un valor (`functions: { promote }`). El middleware de autenticación ya se ha ejecutado cuando se alcanza tu manejador,
el driver está limitado al llamador y `rebase` está disponible para almacenamiento, correo electrónico,
jobs y `dataAsAdmin`.

```typescript
// backend/functions/promote.ts
import { defineFunction } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.post("/", async (c) => {
        const { id } = await c.req.json<{ id: string }>();
        await rebase.dataAsAdmin.table("products").update(id, { featured: true });
        return c.json({ ok: true });
    });
});
```

→ [Funciones personalizadas](/docs/backend/custom-functions)

**Lo que no puede alcanzar:** las rutas integradas `/api/data`. Una función se sitúa
*al lado* de ellas, no delante de ellas, por lo que no puede cambiar cómo se
filtra, pagina o estructura un listado — eso corresponde al peldaño 2. Tampoco recibe un método
generado en el SDK; los llamadores acceden a ella con `client.functions.invoke(...)` o un simple `fetch`.

## 4. Tus propias rutas y middleware

**Alcance:** la app Hono, antes de que Rebase la modifique.

`initializeRebaseBackend` toma la app que le pasas, por lo que todo lo que registres en
esa app *antes* de llamarlo se ejecutará antes de cualquier enrutador de Rebase — consulta
[Orden de registro de rutas](/docs/backend/custom-functions#route-registration-order)
para ver la estructura. Un grupo de rutas que montes tú mismo desde `backend.routes` (peldaño 5)
no es una de estas rutas: lleva su propio middleware de autenticación.

:::caution[Allí no se ha ejecutado ningún middleware de autenticación]
Una ruta registrada de esta manera queda **fuera** de cualquier enrutador de Rebase, por lo que
`getDriver(c)` no está establecido y nada ha verificado un token. Protégela con
`requireAuth` importado desde **`@rebasepro/server`** —la raíz del paquete—, el cual
verifica el token por sí mismo, y luego usa `requireAdmin` o `requireScope` desde la misma
importación para decidir qué puede hacer el llamador. Los guards exportados desde
`@rebasepro/server/functions` leen una identidad que un enrutador de Rebase ya ha
resuelto, y responderán con un 500 en lugar de fingir que existe una.
:::

Una trampa de Hono que vale la pena mencionar, porque es silenciosa: `app.use("/*", guard)` cubre
únicamente las rutas declaradas *debajo* de él. Una ruta agregada más tarde —al final del
archivo, meses después— quedará desprotegida. Coloca los guards en la propia ranura de
middleware de la ruta.

**Lo que no puede alcanzar:** la identidad, el driver con alcance y el envoltorio de error,
a menos que los configures tú mismo. Todo lo que un enrutador de Rebase proporciona a un manejador es
algo que dicho enrutador realizó previamente.

## 5. Tu propio servidor

**Alcance:** el proceso.

`initializeRebaseBackend` es un atajo sobre unas pocas llamadas públicas, y este peldaño
consiste en llamarlas tú mismo. `createRebaseBackend` construye el backend y no monta,
inicia ni escucha nada por defecto. `backend.routes` contiene cada grupo de rutas como
una sub-app de Hono que puedes montar de forma aislada, en cualquier ruta. `mount`, `attachRealtime` y
`start` hacen el resto, si los necesitas:

```typescript
const backend = await createRebaseBackend({ database: adapter, auth, schemaDir, provision: true });

app.route("/v2/data", backend.routes.data());   // only the parts you want,
app.route("/v2/auth", backend.routes.auth());   // at the paths you want
await backend.attachRealtime(server);
backend.start();                                // cron, job workers, sweeps
```

Un grupo lleva su propio contexto de autenticación, límites de tasa y control de administración, y rechaza
las cabeceras de suplantación y simulación a menos que sea el grupo de datos o de funciones,
por lo que `getDriver(c)` funciona en un grupo montado en cualquier lugar. Lo que no incluye es el
middleware de ámbito global del proceso que añade `mount()`: el límite de tamaño del cuerpo, compresión, CSRF y
el envoltorio de error son tu responsabilidad al montar los grupos uno a uno.

Un paso más allá, `@rebasepro/server-postgres` es agnóstico del framework: solo depende
de Drizzle y del `http.Server` de Node y nada más, por lo que puedes incrustar
el driver de datos y realtime en Express, Fastify o Node simple y prescindir
del servidor Rebase por completo.

→ [Integración de servidor personalizado](/docs/backend/custom-server)

**Lo que no puede alcanzar:** con `createRebaseBackend`, nada queda fuera de alcance;
asumes el control del orden de las llamadas. Con el driver solo, todo lo que el
servidor configura pasa a ser tu responsabilidad: las rutas de autenticación y renovación de tokens, almacenamiento,
la cola de jobs, cron, la API de administración con la que se comunica el Studio, el servidor MCP, el
envoltorio de error y la pila de middleware.

Recurre a esto cuando tengas un servidor existente que deba seguir siendo el punto de entrada, o
cuando solo una parte del backend deba residir en este proceso. Si lo que realmente
quieres es una ruta personalizada, eso corresponde al peldaño 3 o 4, con una fracción de la superficie.

## 6. `rebase eject`

**Alcance:** el repositorio.

Escribe el punto de entrada del backend y un `Dockerfile` en el proyecto y cambia la configuración de su
backend, de modo que el repositorio construya su propia imagen en lugar de ejecutar el
runtime publicado.

```bash
rebase eject --dry-run   # lists what would change, changes nothing
rebase eject
```

→ [`rebase eject`](/docs/cli#rebase-eject)

**Lo que cuesta:** **las actualizaciones del entorno de ejecución de la plataforma dejan de llegar al proyecto.**
CORS, configuración de autenticación, almacenamiento y apagado pasan a ser tu responsabilidad para configurar y
mantener en funcionamiento. Este es el único peldaño de la escala del que es difícil retroceder.

Previsualízalo primero. `--force` reemplaza un `backend/src/index.ts` o
`env.ts` existente, conservando el archivo actual como `<nombre>.bak`.

## Cuando ninguna de estas es la respuesta

Vale la pena mencionar dos casos porque la escala no se adapta a ellos.

**SQL puro.** No necesitas abandonar el framework para escribir una consulta que el
constructor de consultas no pueda expresar. Limita `driver.admin` con `isSQLAdmin` y usa
`executeSql`, desde una función personalizada o un hook:

```typescript
import { isSQLAdmin, type DataDriver } from "@rebasepro/types";

async function topSellers(driver: DataDriver, since: string) {
    const admin = driver.admin;
    if (!isSQLAdmin(admin)) throw new Error("Native SQL is not available on this driver.");
    return admin.executeSql(
        "select product_id, sum(qty) from order_lines where created_at > $1 group by 1",
        { params: [since] }
    );
}
```

`driver` es lo que te entrega el contexto de una función personalizada (`c.get("driver")`), o
`context.driver` dentro de un hook. Limítalo con `isSQLAdmin` en lugar de
hacer un casting: esta guarda marca la diferencia entre un driver que no puede ejecutar SQL avisándolo
y uno que lanza `admin.executeSql is not a function` en el punto de invocación.

`executeSql` devuelve
cada fila que lee. Para sentencias SQL cuyo tamaño no controles, pasa `maxResultBytes`:
un resultado cuyas filas ocupen más bytes de los indicados será rechazado con un error cuyo
`code` es `RESULT_TOO_LARGE`, nunca devuelto parcialmente. El socket de tiempo real
`EXECUTE_SQL`, a través del cual pasa el `executeSql` de un cliente administrador, establece 128 MB para
todos los llamadores.

**Algo que el framework debería hacer y no hace.** Si te encuentras
parcheando `@rebasepro/server-postgres`, o haciendo eject por un solo comportamiento, vale
más la pena abrir un issue en lugar de un fork —
[github.com/rebasepro/rebase/issues](https://github.com/rebasepro/rebase/issues).
Tanto `beforeQuery` como `search.mode: "hybrid"` existen porque un driver parcheado
era la única alternativa.

## Relacionado

- [Extender Rebase (frontend)](/docs/frontend/extending) — la misma escala para el panel de administración
- [Hooks de tabla](/docs/collections/callbacks)
- [Hooks globales](/docs/backend/hooks)
- [Funciones personalizadas](/docs/backend/custom-functions)
- [Integración de servidor personalizado](/docs/backend/custom-server)
- [Búsqueda](/docs/backend/search)
- [Índice de endpoints](/docs/backend/endpoints) — cada ruta que monta el servidor
