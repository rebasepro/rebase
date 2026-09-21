---
sourceHash: 89b27e051b61084c
title: Rebase no hace X
sidebar_label: Extender el servidor
description: La escala de extensión del lado del servidor — declaración, callback de colección, función personalizada, tus propias rutas, tu propio servidor, eject — con lo que cada uno puede y no puede alcanzar.
---

## Visión general

Algo que necesitas no está en la configuración de la colección. Esta página presenta el orden en el que probar las cosas y — más útil aún — lo que cada peldaño *no puede* alcanzar, para que dejes de subir en el primero que pueda hacer el trabajo.

Existe una página equivalente para el panel de administración:
[Extending Rebase](/docs/frontend/extending) cubre plugins, slots,
reemplazos de componentes y vistas personalizadas. Esta página trata sobre el servidor.

La regla que codifica la escala: **cada peldaño te cuesta algo que el inferior
conservaba.** Una declaración es portable, actualizable y comprendida por el
planificador de esquemas, el SDK generado y el panel de administración. Para
cuando llegas a `rebase eject`, tú eres el dueño de la secuencia de arranque, y
las actualizaciones del runtime de la plataforma ya no llegarán a tu proyecto.
Por lo tanto, sube solo hasta donde sea estrictamente necesario.

## La escala

| # | Peldaño | Alcanza | **No** alcanza | Costo de estar aquí |
|---|---|---|---|---|
| 1 | **Declaración** — una propiedad, una relación, un índice, un bloque `search`, una regla de seguridad | El esquema, el SDK generado, el panel de administración, el planificador de migraciones | Cualquier cosa que deba ejecutar código | Ninguno. Esta es la vía recomendada y soportada |
| 2 | **Callback de colección** — `beforeQuery`, `afterRead`, `beforeSave`, `afterSave`, `beforeDelete`, `afterDelete` | Cada lectura y escritura de una colección, en cada transporte, dentro de la propia transacción de la petición | Peticiones que no tocan ninguna colección; el envoltorio de la respuesta (envelope); cualquier cosa asíncrona a la escritura | Se ejecuta en la ruta crítica (hot path), manteniendo la transacción abierta |
| 3 | **Función personalizada** — una app de Hono en `functions/` | Su propia URL, con la autenticación resuelta, el driver limitado al ámbito del emisor y `rebase` a disposición | Las rutas integradas `/api/data`. Se sitúa *junto a* ellas, no delante | Una superficie más que autorizar; no se genera ningún método del SDK para ella |
| 4 | **Tus propias rutas y middleware** en la app de Hono | Cualquier cosa HTTP, incluyendo rutas que se ejecutan *antes* que los routers de Rebase | El driver y la identidad del emisor, a menos que protejas la ruta tú mismo | Fuera de todo router de Rebase: no se ha ejecutado ningún middleware de autenticación |
| 5 | **Tu propio servidor** — incrusta el driver en Express, Fastify o `http` puro | El adaptador de datos y realtime, en un proceso escrito por ti | Todo lo que `initializeRebaseBackend` conecta: rutas de autenticación, almacenamiento, jobs, cron, API de administración, el servidor MCP | Tú ensamblas el backend. En este punto, Rebase es una librería, no un coordinador |
| 6 | **`rebase eject`** | El punto de entrada y el `Dockerfile`, en tu repositorio | — | **Las actualizaciones del runtime de la plataforma dejan de llegar a este proyecto.** CORS, la configuración de autenticación, el almacenamiento y el apagado pasan a ser tu responsabilidad |

:::tip[Dos peldaños se omiten comúnmente sin motivo]
`beforeQuery` (peldaño 2) restringe una lectura *antes de que se compile*, que es el
motivo por el cual la gente suele acudir al peldaño 3 o 5. Y un bloque `search` con
`mode: "hybrid"` (peldaño 1) es la razón por la que la gente suele recurrir a SQL puro. Ambos son
lo suficientemente recientes como para que las respuestas más antiguas en internet no los mencionen.
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
| Vincular dos colecciones | una propiedad `relation` | [Relations](/docs/collections/relations) |
| Acelerar una consulta | `indexes` | [Indexes](/docs/backend/indexes) |
| Decidir quién puede leer o escribir una fila | `securityRules` | [Authentication](/docs/backend/authentication) |
| Buscar texto adecuadamente — acentos, JSONB, ranking, subcadenas | un bloque `search` | [Search](/docs/backend/search) |
| Encontrar filas por significado | una propiedad `vector` | [Search](/docs/backend/search) |
| Conservar filas eliminadas | `softDelete` | [Writes](/docs/backend/writes) |
| Registrar quién cambió qué | `history` | [History](/docs/backend/history) |
| Ejecutar algo de forma programada | un archivo de cron job | [Cron Jobs](/docs/backend/cron-jobs) |
| Ejecutar algo después de una escritura, fuera de banda | un job | [Jobs](/docs/backend/jobs) |

**Lo que no puede alcanzar:** cualquier cosa que deba tomar una decisión en
tiempo de petición. Una declaración son datos. Si la respuesta depende de quién
esté preguntando, pasa al peldaño 2.

## 2. Callbacks de colección

**Ámbito:** una colección, o todas las colecciones cuando se registran
globalmente en `initializeRebaseBackend({ callbacks })`.

Los callbacks se disparan en **cada** ruta de datos — REST, el SDK,
suscripciones por WebSocket y escrituras del lado del servidor a través de
`rebase.dataAsAdmin` — y cada uno se ejecuta dentro de la transacción abierta
para esa petición. Ese es todo su valor: no hay forma de acceder a las filas de
una colección eludiéndolos.

| Callback | Se dispara | Úsalo para |
|---|---|---|
| `beforeQuery` | antes de que se compile una lectura | restringir **qué filas** solicita una lectura |
| `afterRead` | por fila, después de obtenerla | censura/ofuscación, enmascaramiento de PII, campos calculados |
| `beforeSave` | después de la validación, antes de la escritura | valores predeterminados, columnas derivadas, rechazar una escritura |
| `afterSave` | después de la escritura, antes del commit | efectos secundarios que deban deshacerse junto con ella |
| `afterSaveError` | cuando un guardado lanza una excepción | reporte; `props.error` es lo que lanzó |
| `beforeDelete` | antes de la eliminación | rechazarla |
| `afterDelete` | después de la eliminación, antes del commit | limpieza en cascada |

→ [Callbacks por colección](/docs/collections/callbacks) ·
[Hooks globales](/docs/backend/hooks)

### Restringir una lectura con `beforeQuery`

`afterRead` ve filas que ya han sido obtenidas, por lo que puede censurar un valor
pero no puede evitar que la fila sea leída. `beforeQuery` se ejecuta antes: recibe
la consulta analizada y devuelve condiciones para combinarlas con un **AND** en ella.

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

- **Solo puede restringir.** El valor de retorno es un filtro para combinar con
  AND, y no hay estructura que pueda devolver que amplíe la lectura. Esto es
  deliberado: un hook al que se le entrega la consulta y se le pide que devuelva
  una podría descartar una condición, y en un plano de datos con seguridad a
  nivel de fila (row-level security), una condición descartada devuelve cada
  fila que las políticas permitan.
- **Se dispara en cada ruta de lectura.** El listado, la obtención individual,
  el conteo, la agregación, la búsqueda, la lectura vectorial, un listado de ruta
  anidada, la recarga en tiempo real que construye los frames de suscripción y
  las filas cargadas para una relación o un `?include=` — donde es el hook de la
  colección **de destino** el que aplica. Un hook respetado por el listado pero
  no por el conteo genera una página que dice "1 of 4 results".
- **Un filtro que no pueda compilar rechaza la petición.** Indicar una columna
  que la tabla no tiene resulta en un error 400, no en una condición omitida,
  sin importar cómo esté configurado `configureUnknownFilterFields`.

Hay una lectura que deliberadamente *no* se restringe: la comprobación de unicidad
detrás de `validation: { unique: true }`. Esta consulta si un valor existe en
cualquier parte de la tabla, y de ser restringida respondería "único" para un
valor que una fila oculta ya posee — provocando que la inserción falle en la
restricción en su lugar.

`beforeQuery` está implementado por `@rebasepro/server-postgres`. Una colección
servida por otro motor que declare uno **falla en el arranque**, por su nombre,
en lugar de servirse con el hook silenciosamente inerte. Lo mismo ocurre con uno
global junto a una fuente de datos que no sea Postgres. La ofuscación de datos
que funciona en todos los motores es `afterRead`.

**Lo que los callbacks no pueden alcanzar:**

- Una petición que no toque ninguna colección. No hay nada de lo que el callback
  pueda colgarse.
- El envoltorio de la respuesta — código de estado, cabeceras, estructura de
  paginación. Un callback devuelve valores, no una respuesta.
- Trabajo que deba sobrevivir a la transacción. `afterSave` se ejecuta *antes*
  del commit, por lo que un error lanzado allí revierte la escritura. Cualquier
  cosa que deba sobrevivir a la anulación de la escritura no es parte de la
  escritura: ponlo en la [cola de jobs](/docs/backend/jobs).
- Trabajo lento, en la práctica. Un callback mantiene abierta la transacción y
  con ella una conexión del pool. Cualquier cosa que se comunique con un tercero
  debe ir a la cola.

## 3. Funciones personalizadas

**Ámbito:** una URL bajo `/api/functions`.

Una app de Hono en `backend/functions/`, descubierta por nombre de archivo del
mismo modo que las colecciones y los cron jobs. El middleware de autenticación
ya se ha ejecutado cuando se alcanza tu handler, el driver está limitado al
ámbito del emisor y se dispone de `rebase` para almacenamiento, correo
electrónico, jobs y `dataAsAdmin`.

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
sitúa *junto a* ellas, no delante, por lo que no puede cambiar cómo se filtra,
pagina o da formato a un listado — eso corresponde al peldaño 2. Tampoco obtiene
un método generado en el SDK; quienes la consuman la invocan mediante
`client.functions.invoke(...)` o `fetch` básico.

## 4. Tus propias rutas y middleware

**Ámbito:** la app de Hono, antes de que Rebase la toque.

`initializeRebaseBackend` recibe la app que le pasas, por lo que cualquier cosa
que registres en esa app *antes* de llamarlo se ejecuta antes de cualquier router
de Rebase — consulta el
[Orden de registro de rutas](/docs/backend/custom-functions#route-registration-order)
para ver la estructura.

:::caution[No se ha ejecutado ningún middleware de autenticación allí]
Una ruta registrada de este modo está **fuera** de cualquier router de Rebase,
por lo que `getDriver(c)` no está definido y nada ha verificado un token.
Protégela con `requireAuth` / `requireAdmin` importados desde
**`@rebasepro/server`** — la raíz del paquete —, los cuales verifican el token
por sí mismos. Los guards exportados desde `@rebasepro/server/functions` leen una
identidad que un router de Rebase ya ha resuelto, y responden 500 en lugar de
fingir que existe una.
:::

Una trampa de Hono que vale la pena mencionar, porque es silenciosa:
`app.use("/*", guard)` solo cubre las rutas declaradas *debajo* de él. Una ruta
agregada más tarde — al final del archivo, dentro de unos meses — quedará
desprotegida. Coloca los guards en la posición de middleware propia de la ruta.

**Lo que no puede alcanzar:** la identidad, el driver con ámbito y el
envoltorio de errores — a menos que conectes cada uno por tu cuenta. Todo lo que
un router de Rebase le proporciona a un handler es algo que un router de Rebase
hizo.

## 5. Tu propio servidor

**Ámbito:** el proceso.

`@rebasepro/server-postgres` es agnóstico del framework: depende de Drizzle y
de `http.Server` de Node y nada más. Por tanto, puedes incrustar el adaptador de
datos y realtime en Express, Fastify o Node puro y omitir el coordinador por
completo.

→ [Integración de servidor personalizado](/docs/backend/custom-server)

**Lo que no puede alcanzar:** todo lo que `initializeRebaseBackend` conecta, que
es la mayor parte del backend — las rutas de autenticación y renovación de
tokens, almacenamiento, la cola de jobs, cron, la API de administración con la
que se comunica el Studio, el servidor MCP, el envoltorio de errores, la pila de
middlewares. Cada uno de ellos está disponible para ensamblarse a mano; ninguno
se ensambla solo. En este peldaño, Rebase es una librería, no un coordinador.

Recurre a él cuando tengas un servidor existente que deba seguir siendo el
punto de entrada. Si lo que realmente deseas es una ruta personalizada, eso
corresponde al peldaño 3 o 4, con una fracción de la superficie.

## 6. `rebase eject`

**Ámbito:** el repositorio.

Escribe el punto de entrada del backend y un `Dockerfile` en el proyecto y cambia
la configuración del backend para que el repositorio construya su propia imagen
en lugar de ejecutar el runtime publicado.

```bash
rebase eject --dry-run   # lists what would change, changes nothing
rebase eject
```

→ [`rebase eject`](/docs/cli#rebase-eject)

**Lo que cuesta:** **las actualizaciones del runtime de la plataforma ya no
llegarán al proyecto.** La configuración de CORS, de autenticación, el
almacenamiento y el apagado pasan a ser tu responsabilidad para configurar y
mantener en funcionamiento. Este es el único peldaño de la escala del que es
difícil retroceder.

Previsualízalo primero. `--force` reemplaza un `backend/src/index.ts` o
`env.ts` existente, conservando el archivo actual como `<name>.bak`.

## Cuando ninguna de estas es la respuesta

Vale la pena mencionar dos casos, ya que la escala no se ajusta a ellos.

**SQL puro (Raw SQL).** No necesitas salir del framework para escribir una
consulta que el constructor de consultas no pueda expresar. Restringe
`driver.admin` con `isSQLAdmin` y usa `executeSql`, desde una función
personalizada o un callback:

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
(`c.get("driver")`), o `context.driver` dentro de un callback. Restríngelo con
`isSQLAdmin` en lugar de hacer un cast: el guard es la diferencia entre un driver
que no puede ejecutar SQL avisándolo y uno lanzando
`admin.executeSql is not a function` en el punto de llamada.

**Algo que el framework debería hacer y no hace.** Si te encuentras parcheando
`@rebasepro/server-postgres`, o haciendo eject por un solo comportamiento, vale
la pena abrir un issue en lugar de hacer un fork —
[github.com/rebasepro/rebase/issues](https://github.com/rebasepro/rebase/issues).
tanto `beforeQuery` como `search.mode: "hybrid"` existen porque un driver parcheado
era la única alternativa.

## Relacionado

- [Extender Rebase (frontend)](/docs/frontend/extending) — la misma escala para el panel de administración
- [Callbacks por colección](/docs/collections/callbacks)
- [Hooks globales](/docs/backend/hooks)
- [Funciones personalizadas](/docs/backend/custom-functions)
- [Integración de servidor personalizado](/docs/backend/custom-server)
- [Búsqueda](/docs/backend/search)
- [Índice de endpoints](/docs/backend/endpoints) — cada ruta que monta el servidor
