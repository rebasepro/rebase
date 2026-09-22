---
sourceHash: 41183c8dc79d618d
title: Rebase no hace X
sidebar_label: Extender el servidor
description: La escalera de extensiones del lado del servidor — declaración, callback de colección, función personalizada, tus propias rutas, tu propio servidor, eject — con lo que cada uno puede y no puede alcanzar.
---

## Resumen general

Algo que necesitas no está en la configuración de la colección. Esta página presenta el orden en el que probar las opciones y —lo que es más útil— lo que cada peldaño *no puede* alcanzar, para que dejes de subir en el primero que pueda hacer el trabajo.

Hay una página equivalente para el panel de administración:
[Extending Rebase](/docs/frontend/extending) cubre plugins, slots, sobrescritura
de componentes y vistas personalizadas. Esta página trata sobre el servidor.

La regla que codifica la escalera: **cada peldaño te cuesta algo que el inferior
conservaba.** Una declaración es portable, actualizable y comprendida por el
planificador de esquemas, el SDK generado y el panel de administración. Para cuando
llegas a `rebase eject`, eres dueño de la secuencia de arranque y las actualizaciones
del runtime de la plataforma ya no llegarán a tu proyecto. Así que sube solo hasta
donde sea necesario.

## La escalera

| # | Peldaño | Alcanza | **No** alcanza | Costo de estar aquí |
|---|---|---|---|---|
| 1 | **Declaración** — una propiedad, una relación, un índice, un bloque `search`, una regla de seguridad | El esquema, el SDK generado, el panel de administración, el planificador de migraciones | Cualquier cosa que requiera ejecutar código | Ninguno. Este es el camino soportado |
| 2 | **Callback de colección** — `beforeQuery`, `afterRead`, `beforeSave`, `afterSave`, `beforeDelete`, `afterDelete` | Cada lectura y escritura de una colección, en cualquier transporte, dentro de la propia transacción de la petición | Peticiones que no tocan ninguna colección; la envoltura (envelope) de la respuesta; cualquier cosa asíncrona a la escritura | Se ejecuta en la ruta crítica (hot path), manteniendo la transacción abierta |
| 3 | **Función personalizada** — una app de Hono en `functions/` | Su propia URL, con la autenticación resuelta, el driver delimitado al llamador y `rebase` disponible | Las rutas `/api/data` integradas. Se sitúa *junto* a ellas, no delante | Una superficie más que autorizar; no se genera ningún método SDK para ella |
| 4 | **Tus propias rutas y middleware** en la app de Hono | Cualquier cosa HTTP, incluyendo rutas que se ejecutan *antes* que los enrutadores de Rebase | El driver y la identidad del llamador, a menos que protejas la ruta tú mismo | Fuera de todo enrutador de Rebase: no se ha ejecutado ningún middleware de autenticación |
| 5 | **Tu propio servidor** — incrustar el driver en Express, Fastify o `http` puro | El adaptador de datos y realtime, en un proceso escrito por ti | Todo lo que conecta `initializeRebaseBackend`: rutas de auth, almacenamiento, trabajos (jobs), cron, API de administración, el servidor MCP | Tú ensamblas el backend. Rebase actúa como una biblioteca aquí, no como un coordinador |
| 6 | **`rebase eject`** | El punto de entrada y el `Dockerfile`, en tu repositorio | — | **Las actualizaciones del runtime de la plataforma dejan de llegar a este proyecto.** CORS, configuración de autenticación, almacenamiento y el apagado pasan a ser tu responsabilidad |

:::tip[Dos peldaños se suelen omitir sin motivo]
`beforeQuery` (peldaño 2) restringe una lectura *antes de que sea compilada*, que es
para lo que la gente suele recurrir al peldaño 3 o 5. Y un bloque `search` con
`mode: "hybrid"` (peldaño 1) es para lo que la gente suele recurrir a SQL puro.
Ambos son lo suficientemente nuevos como para que las respuestas más antiguas en
internet no los mencionen.
:::

## 1. Declaración

La mayor parte de lo que necesita un backend es una declaración en la colección,
porque una declaración es el único peldaño que el resto del sistema puede leer.
El planificador de esquemas la convierte en DDL, el generador de código la
convierte en métodos del SDK, el panel de administración la renderiza y
`rebase doctor` la compara con la base de datos en vivo.

| Quiero… | Declarar | Referencia |
|---|---|---|
| Añadir una columna | una propiedad | [Properties](/docs/collections/properties) |
| Enlazar dos colecciones | una propiedad `relation` | [Relations](/docs/collections/relations) |
| Hacer que una consulta sea rápida | `indexes` | [Indexes](/docs/backend/indexes) |
| Decidir quién puede leer o escribir una fila | `securityRules` | [Authentication](/docs/backend/authentication) |
| Buscar texto adecuadamente — acentos, JSONB, ranking, subcadenas | un bloque `search` | [Search](/docs/backend/search) |
| Encontrar filas por significado | una propiedad `vector` | [Search](/docs/backend/search) |
| Conservar filas eliminadas | `softDelete` | [Writes](/docs/backend/writes) |
| Registrar quién cambió qué | `history` | [History](/docs/backend/history) |
| Ejecutar algo de forma programada | un archivo de cron job | [Cron Jobs](/docs/backend/cron-jobs) |
| Ejecutar algo tras una escritura, fuera de banda | un trabajo (job) | [Jobs](/docs/backend/jobs) |

**Lo que no puede alcanzar:** cualquier cosa que deba tomar una decisión en tiempo de
petición. Una declaración son datos. Si la respuesta depende de quién esté
preguntando, ve al peldaño 2.

## 2. Callbacks de colección

**Alcance:** una colección, o cada colección cuando se registra globalmente en
`initializeRebaseBackend({ callbacks })`.

Los callbacks se disparan en **todas** las vías de datos — REST, el SDK, suscripciones
WebSocket y escrituras del lado del servidor a través de `rebase.dataAsAdmin` — y
cada uno se ejecuta dentro de la transacción abierta para esa petición. Ese es
todo su valor: no hay forma de acceder a las filas de una colección eludiéndolos.

| Callback | Se dispara | Úsalo para |
|---|---|---|
| `beforeQuery` | antes de que se compile una lectura | restringir **qué filas** solicita una lectura |
| `afterRead` | por fila, después de obtenerla | redacción/ocultación, enmascaramiento de PII, campos calculados |
| `beforeSave` | después de la validación, antes de la escritura | valores por defecto, columnas derivadas, rechazar una escritura |
| `afterSave` | después de la escritura, antes del commit | efectos secundarios que deben revertirse con ella |
| `afterSaveError` | cuando un guardado lanza un error | reporte; `props.error` es lo que lanzó |
| `beforeDelete` | antes de la eliminación | rechazarla |
| `afterDelete` | después de la eliminación, antes del commit | limpieza en cascada |

→ [Callbacks por colección](/docs/collections/callbacks) ·
[Hooks globales](/docs/backend/hooks)

### Restringir una lectura con `beforeQuery`

`afterRead` ve filas que ya han sido obtenidas, por lo que puede ocultar un valor
pero no puede evitar que la fila sea leída. `beforeQuery` se ejecuta antes: recibe
la consulta analizada y devuelve condiciones para combinarlas con **AND**.

```ts
// config/collections/documents.ts
callbacks: {
    beforeQuery: ({ context }) => {
        if (context.user?.roles?.includes("admin")) return;        // no narrowing
        return { filter: { tenant_id: ["==", context.user?.tenant ?? null] } };
    }
}
```

Vale la pena conocer tres propiedades antes de depender de él:

- **Solo puede restringir.** El valor de retorno es un filtro para combinar con AND,
  y no hay estructura que pueda devolver que amplíe la lectura. Esto es deliberado:
  a un hook al que se le entrega la consulta y se le pide que devuelva una podría
  omitir una condición, y en un plano de datos con seguridad a nivel de fila
  (row-level security), una condición omitida devuelve cada fila que las políticas
  permitan por casualidad.
- **Se dispara en cada vía de lectura.** El listado, la obtención individual, el
  conteo, la agregación, la búsqueda, la lectura vectorial, un listado de rutas
  anidadas, la reobtención en tiempo real que construye los frames de suscripción,
  y las filas cargadas para una relación o un `?include=` — donde se aplica el
  hook de la colección de **destino**. Un hook respetado por el listado y no por
  el conteo genera una página que dice "1 de 4 resultados".
- **Un filtro que no pueda compilar rechaza la petición.** Especificar una columna
  que la tabla no tiene resulta en un 400, no en una condición omitida, sin
  importar cómo esté configurado `configureUnknownFilterFields`.
- **Una escritura en una fila que excluye es un 404.** Una actualización o
  eliminación dirigida a una fila fuera del alcance se rechaza antes de la
  escritura, con la misma respuesta de "no hay fila…" que daría una lectura — por
  lo que un alcance es un alcance tanto para escrituras como para lecturas. Lo que
  *no* filtra son los valores que se están escribiendo: rechazar una escritura
  según su contenido corresponde a `beforeSave`.

Una lectura deliberadamente *no* se restringe: la comprobación de unicidad detrás
de `validation: { unique: true }`. Pregunta si un valor existe en cualquier parte
de la tabla, y si se restringiera respondería "único" para un valor que una fila
oculta ya posee — haciendo que la inserción falle en la restricción (constraint) de
la base de datos en su lugar.

`beforeQuery` está implementado por `@rebasepro/server-postgres`. Una colección
servida por otro motor que declare uno **falla en el arranque**, por nombre, en
lugar de servirse con el hook silenciosamente inerte. Lo mismo ocurre con uno
global junto a una fuente de datos que no sea Postgres. La redacción/ocultación
que funciona en todos los motores es `afterRead`.

**Lo que los callbacks no pueden alcanzar:**

- Una petición que no toca ninguna colección. No hay nada de lo que el callback
  pueda depender.
- La envoltura (envelope) de la respuesta — código de estado, encabezados,
  estructura de paginación. Un callback devuelve valores, no una respuesta.
- Trabajo que deba sobrevivir a la transacción. `afterSave` se ejecuta *antes*
  del commit, por lo que un error lanzado allí revierte la escritura. Cualquier
  cosa que deba sobrevivir a la anulación de la escritura no es parte de la misma:
  ponlo en la [cola de trabajos (job queue)](/docs/backend/jobs).
- Trabajo lento, en la práctica. Un callback mantiene abierta la transacción y
  una conexión del pool con ella. Cualquier cosa que se comunique con un tercero
  debe ir a la cola.

## 3. Funciones personalizadas

**Alcance:** una URL bajo `/api/functions`.

Una app de Hono en `backend/functions/`, descubierta por nombre de archivo de la
misma manera que las colecciones y los cron jobs. El middleware de autenticación ya
se ha ejecutado cuando se llega a tu controlador, el driver está delimitado al
llamador y `rebase` está disponible para almacenamiento, correo electrónico,
trabajos y `dataAsAdmin`.

```typescript
// backend/functions/promote.ts
import { defineFunction } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.post("/", async (c) => {
        const { id } = await c.req.json<{ id: string }>();
        await rebase.dataAsAdmin.collection("products").update(id, { featured: true });
        return c.json({ ok: true });
    });
});
```

→ [Funciones personalizadas](/docs/backend/custom-functions)

**Lo que no puede alcanzar:** las rutas integradas `/api/data`. Una función se
sitúa *junto* a ellas, no delante de ellas, por lo que no puede cambiar cómo se
filtra, pagina o estructura un listado — eso corresponde al peldaño 2. Tampoco
obtiene un método de SDK generado; los clientes acceden a ella mediante
`client.functions.invoke(...)` o `fetch` convencional.

## 4. Tus propias rutas y middleware

**Alcance:** la app de Hono, antes de que Rebase la toque.

`initializeRebaseBackend` recibe la app que le pasas, por lo que cualquier cosa que
registres en esa app *antes* de llamarlo se ejecutará antes de cualquier enrutador
de Rebase — consulta [Orden de registro de rutas](/docs/backend/custom-functions#route-registration-order)
para ver la estructura.

:::caution[Ningún middleware de autenticación se ha ejecutado allí]
Una ruta registrada de esta manera queda **fuera** de cualquier enrutador de Rebase,
por lo que `getDriver(c)` no está establecido y nada ha verificado un token. Protégela
con `requireAuth` / `requireAdmin` importados desde **`@rebasepro/server`** —la raíz
del paquete—, los cuales verifican el token por sí mismos. Los guards exportados
desde `@rebasepro/server/functions` leen una identidad que un enrutador de Rebase ya
ha resuelto, y responden con un 500 en lugar de fingir que existe una.
:::

Una trampa de Hono que vale la pena mencionar, porque es silenciosa:
`app.use("/*", guard)` cubre únicamente las rutas declaradas *debajo* de ella. Una
ruta añadida posteriormente —al final del archivo, dentro de unos meses— quedará
desprotegida. Coloca los guards en la propia ranura de middleware de la ruta.

**Lo que no puede alcanzar:** la identidad, el driver delimitado y la envoltura de
errores — a menos que conectes cada uno por tu cuenta. Todo lo que un enrutador de
Rebase le proporciona a un controlador es algo que hizo un enrutador de Rebase.

## 5. Tu propio servidor

**Alcance:** el proceso.

`@rebasepro/server-postgres` es agnóstico del framework: depende de Drizzle y de
`http.Server` de Node y de nada más. Por lo tanto, puedes incrustar el adaptador de
datos y realtime en Express, Fastify o simplemente Node y omitir el coordinador por
completo.

→ [Integración con servidor personalizado](/docs/backend/custom-server)

**Lo que no puede alcanzar:** todo lo que `initializeRebaseBackend` conecta, que es
la mayor parte del backend: las rutas de autenticación y renovación de tokens, el
almacenamiento, la cola de trabajos, cron, la API de administración con la que se
comunica Studio, el servidor MCP, la envoltura de errores y la pila de middleware.
Cada uno de ellos está disponible para ensamblarse manualmente; ninguno se ensambla
solo. Rebase es una biblioteca en este peldaño, no un coordinador.

Recurre a él cuando tengas un servidor existente que deba seguir siendo el punto
de entrada. Si lo que realmente quieres es una ruta personalizada, eso corresponde
al peldaño 3 o 4, con una fracción de la superficie expuesta.

## 6. `rebase eject`

**Alcance:** el repositorio.

Escribe el punto de entrada del backend y un `Dockerfile` en el proyecto y cambia la
configuración de su backend, de modo que el repositorio construya su propia imagen
en lugar de ejecutar el runtime publicado.

```bash
rebase eject --dry-run   # lists what would change, changes nothing
rebase eject
```

→ [`rebase eject`](/docs/cli#rebase-eject)

**Lo que cuesta:** **las actualizaciones del runtime de la plataforma dejan de
llegar al proyecto.** CORS, la configuración de autenticación, el almacenamiento y
el apagado pasan a ser tu responsabilidad de configurar y mantener funcionando.
Este es el único peldaño de la escalera del que es difícil retroceder.

Previsualízalo primero. `--force` reemplaza un `backend/src/index.ts` o `env.ts`
existente, guardando el archivo actual como `<name>.bak`.

## Cuando ninguna de estas es la respuesta

Vale la pena mencionar dos casos, porque la escalera no se ajusta a ellos.

**SQL puro.** No necesitas abandonar el framework para escribir una consulta que el
constructor de consultas no puede expresar. Delimita `driver.admin` con `isSQLAdmin`
y usa `executeSql`, desde una función personalizada o un callback:

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

`driver` es lo que te entrega el contexto de una función personalizada
(`c.get("driver")`), o `context.driver` dentro de un callback. Delimítalo con
`isSQLAdmin` en lugar de hacer un cast: el guard es la diferencia entre que un driver
que no puede ejecutar SQL lo indique formalmente o que lance
`admin.executeSql is not a function` en el punto de llamada.

**Algo que el framework debería hacer y no hace.** Si te encuentras parcheando
`@rebasepro/server-postgres` o haciendo un eject por un único comportamiento,
vale la pena abrir un issue en lugar de hacer un fork —
[github.com/rebasepro/rebase/issues](https://github.com/rebasepro/rebase/issues).
Tanto `beforeQuery` como `search.mode: "hybrid"` existen porque la única
alternativa era un driver parcheado.

## Relacionado

- [Extender Rebase (frontend)](/docs/frontend/extending) — la misma escalera para el panel de administración
- [Callbacks por colección](/docs/collections/callbacks)
- [Hooks globales](/docs/backend/hooks)
- [Funciones personalizadas](/docs/backend/custom-functions)
- [Integración con servidor personalizado](/docs/backend/custom-server)
- [Búsqueda](/docs/backend/search)
- [Índice de endpoints](/docs/backend/endpoints) — cada ruta que monta el servidor
