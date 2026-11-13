---
sourceHash: bdf9409c94709498
title: Múltiples bases de datos y buckets
sidebar_label: Múltiples fuentes
description: Enruta tablas a diferentes bases de datos y columnas de almacenamiento a diferentes buckets, y configura cada una desde el entorno.
---

## Descripción general

Un proyecto no está limitado a una base de datos y un bucket. Cada elemento con nombre que un proyecto necesita — una base de datos, un bucket, un topic, una cola — se **declara con un constructor en `backend/resources.ts`**, y se configura desde el entorno mediante una variable derivada de su clave. Los crons y las funciones son archivos, y entran en el mismo grafo bajo el nombre del archivo.

Una sola regla, sea cual sea el tipo: no hay un segundo lugar donde buscar, ni nada que deba mantenerse sincronizado manualmente.

## Declaración de recursos

Colócalos en `backend/resources.ts`. Exportarlos es una buena práctica — te da algo que importar —, pero la declaración es lo que los registra.

```ts
// backend/resources.ts
import { bucket, database, queue, topic } from "@rebasepro/types";

/** The project's database. Reads DATABASE_URL, as it always did. */
export const main = database();

/** A second one. Reads DATABASE_URL__ANALYTICS. */
export const analytics = database("analytics", { label: "Analytics warehouse" });

/** A bucket. Reads S3_BUCKET__MEDIA. */
export const media = bucket("media", { engine: "s3", label: "Public media" });

/** A topic, delivered through the durable job queue. */
export const signups = topic<{ userId: string }>("signups");

signups.subscription("send-welcome", async (event) => {
    // …
});
```

`database()`, `bucket()` y `topic()` se pueden declarar desde la versión 0.17, y `queue()` desde la 0.18.

Luego apunta una tabla a uno de ellos mediante su handle — el mismo nombre, escrito una sola vez:

<span class="since-badge" data-since="0.31">Desde 0.31</span>

```ts
// backend/schema/page_views.ts
import { defineTable, col } from "@rebasepro/server/schema";
import { analytics, media } from "../resources";

export const pageViews = defineTable("page_views", {
    database: analytics,
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        path: col.text().notNull(),
        // A file column, stored in the `media` bucket.
        screenshot: col.storage({ path: "screenshots/", source: media, accept: ["image/*"] })
    },
    rls: "admin-only"
});
```

La tabla compilada registra la clave del handle, por lo que a partir de ese punto son simples datos: se serializa, se compara y llega al panel de administración a través de `GET /api/schema/tables`. La forma de cadena (`database: "analytics"`) también funciona; el handle es el que sigue un renombramiento y en el que aterriza «ir a la definición».

En una función, los mismos handles acceden al recurso:

```ts
import { defineFunction } from "@rebasepro/server/functions";
import { analytics, media } from "../resources";

export default defineFunction((app, { rebase }) => {
    app.post("/report", async (c) => {
        const rows = await rebase.sql("select count(*) from page_views", { database: analytics });
        const file = new File([JSON.stringify(rows)], "report.json", { type: "application/json" });
        await rebase.bucket(media).putObject({ key: "report.json", file });
        return c.json({ ok: true });
    });
});
```

`{ database: analytics }` ejecuta la consulta en la propia conexión de esa fuente — a lo que sea que apunte `DATABASE_URL__ANALYTICS`, en cualquier servidor — y no especificar ninguna opción la ejecuta en la predeterminada. Una clave que no nombre ninguna fuente configurada se rechaza con un error que lista las fuentes existentes.

### Ver lo que has declarado

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if that file is stale
```

`rebase.resources.json` se **genera** y se incluye en el control de versiones. Es lo que lee un host para decidir qué aprovisionar *antes* de ejecutar nada — que es como una consola puede decir «este proyecto requiere un bucket `media` y no tiene ninguno» en un primer despliegue. Edita las declaraciones, nunca el archivo; `--check` hace fallar la compilación si los dos no coinciden.

Cada entrada también registra **quién la usa** — `table:page_views` en una base de datos, `column:posts.cover` en un bucket, `function:report` en lo que sea que la función importe de `resources.ts`. Ese es el mapa que necesita una consola para responder «qué se rompe si elimino esto».

`rebase status` va un paso más allá: para cada declaración indica si el entorno la vincula, utilizando los mismos resolvers que usa el arranque, por lo que no puede darte falsas seguridades sobre un despliegue que está a punto de negarse a iniciar.

### Un motor desconocido para la compilación

Cada tipo posee su propia lista de motores, y uno desconocido se rechaza en el punto de llamada en lugar de aceptarse y fallar más tarde. Algo genuinamente fuera de la lista se especifica con `custom:`:

```ts
export const objects = bucket("objects", { engine: "custom:minio" });
```

### Corregir un tipo que ya ha sido publicado

Para autores de drivers. La definición registrada de un tipo de recurso queda **congelada** una vez que se ha publicado un paquete que la incluye: cada driver publicado incluye en línea su propia copia de `@rebasepro/types`, y la copia compara la entrada del registro compartido con su propio literal y lanza un error ante cualquier diferencia. Por lo tanto, editar el literal rompe al cargar el driver cualquier bundle compilado con un driver anterior.

`amendResourceKind` corrige lo que un tipo *vincula* — sus bases de variables de entorno, sus claves de opciones — sin modificar el literal con el que se compara cualquier copia anterior:

```ts
import { amendResourceKind } from "@rebasepro/types";

amendResourceKind("database", {
    envBases: ["DATABASE_URL", "DATABASE_READ_URL", "ADMIN_CONNECTION_STRING"]
});
```

La modificación se aplica solo a las lecturas a través de esta copia, por lo que un driver más antiguo sigue vinculando de la misma forma en que lo hacía cuando se publicó. Úsalo para cada corrección de un tipo ya publicado; usa `registerResourceKind` únicamente para un tipo que nadie haya publicado todavía.

### Pasarlos al frontend

<span class="since-badge" data-since="0.31">Desde 0.31</span>

El frontend no importa `backend/resources.ts`: `pnpm check:frontend-backend-imports` rechaza cualquier importación de valores de algo bajo `backend/` desde `frontend/`, porque enviaría módulos del servidor al navegador. Y no es necesario que lo haga. El proveedor `<Rebase>` lee los buckets que sirve el backend desde `GET /api/storage/sources` y conecta cada uno, y cada tabla que sirve el backend, independientemente de la base de datos en la que resida, es accesible a través de la API.

Lo que el frontend declara por sí mismo es una fuente `direct` — una con la que el navegador se comunica sin pasar por el backend, como Firestore —, que se pasa a `<Rebase>` como una instancia activa a través de `dataSources` o `storageSources`. Consulta [Firebase](/docs/frontend/firebase/).

## Configuración de cada fuente

Los nombres de las variables de entorno se derivan de la clave del recurso, por lo que no hay nada que mantener sincronizado manualmente:

```
<VARIABLE>              the default resource   DATABASE_URL, S3_BUCKET
<VARIABLE>__<KEY>       a named resource       DATABASE_URL__ANALYTICS, S3_BUCKET__MEDIA
```

La clave se convierte a mayúsculas y los caracteres no alfanuméricos pasan a ser guiones bajos, por lo que `media-cdn` lee `S3_BUCKET__MEDIA_CDN`.

El separador es un **doble** guion bajo a propósito. Uno simple colisionaría con nombres de variables reales: `S3_BUCKET_NAME` se interpretaría como el bucket de una fuente llamada `name`.

### Bases de datos

```bash
DATABASE_URL=postgres://localhost/app
DATABASE_URL__ANALYTICS=postgres://warehouse.internal/analytics

# Optional, per source:
DB_POOL_MAX__ANALYTICS=5
REBASE_DRIVER__ANALYTICS=@rebasepro/server-postgres
```

El driver se elige a partir del `engine` declarado — `postgres` es aquel para el que Rebase incluye un driver de servidor, y el único al que se puede enrutar una tabla — y `REBASE_DRIVER__<KEY>` lo sobrescribe para usar un driver propio. Una base de datos Firestore no es un recurso del backend: el CMS la lee desde el navegador, a través de [`defineFirestoreCollection`](/docs/frontend/firebase/). `REBASE_DB_POOL_MAX` es un límite para todo el proceso, no una vinculación por fuente, por lo que no lleva sufijo.

En desarrollo no configuras nada de esto: `rebase dev` sirve cada base de datos declarada desde su Postgres gestionado — una segunda instancia para `analytics`, iniciada bajo demanda — y exporta `DATABASE_URL__ANALYTICS` automáticamente. Una variable configurada manualmente nunca se sobrescribe.

Las tablas y las políticas de seguridad a nivel de fila (row-level security) se aprovisionan **por fuente**: una tabla enrutada a `analytics` obtiene su tabla y sus políticas en la base de datos de analytics.

### Almacenamiento

```bash
S3_BUCKET__MEDIA=my-media-bucket
S3_REGION__MEDIA=eu-central-1
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

El motor proviene de la declaración, por lo que no hay que definir ningún `STORAGE_TYPE`.

#### Qué bucket recibe una subida no cualificada

Una columna de almacenamiento que no especifica ningún `source` escribe en el bucket **predeterminado**. Declarar buckets con nombre nunca lo traslada. El predeterminado conserva su propia configuración independientemente de lo que declare `backend/resources.ts`: `STORAGE_TYPE`, `STORAGE_PATH` (`<project>/uploads` cuando no se establece) y las variables `S3_*` / `GCS_*` sin sufijo. Añadir `bucket("media", { engine: "s3" })` a un proyecto que ya tiene archivos en `./uploads` los deja donde están y se siguen sirviendo. `media` lee sus propias variables `__MEDIA` y, en desarrollo, actúa como su propio directorio, `uploads__media`.

Para enviar subidas no cualificadas a un bucket con nombre en su lugar, márcalo:

```ts
export const media = bucket("media", { engine: "s3", default: true });
```

El predeterminado pasa entonces a *ser* `media`. Los archivos que el predeterminado contenía antes se quedan donde están y ya no se sirven a través de él, así que cópialos antes: `rebase storage move --from "(default)" --to media`.

Dos fuentes no pueden compartir una ubicación. Si un bucket con nombre resolviera al directorio del predeterminado (o a uno dentro de él), o al mismo bucket de almacenamiento de objetos en el mismo endpoint, el arranque lo rechazará e indicará la variable que se debe cambiar.

### Varios buckets en una sola cuenta

Cada variable se lee por clave, lo cual es correcto para el nombre del bucket pero inadecuado para las credenciales: quince buckets en una misma instalación de MinIO implicarían quince copias de la misma clave de acceso. Indica un `account` y las variables a nivel de proveedor se leerán una sola vez:

```ts
export const media   = bucket("media",   { engine: "s3", account: "minio" });
export const avatars = bucket("avatars", { engine: "s3", account: "minio" });
```

```bash
S3_BUCKET__MEDIA=project-media       # per bucket, never shared
S3_BUCKET__AVATARS=project-avatars
S3_ACCESS_KEY_ID__MINIO=…            # read once, by both
S3_SECRET_ACCESS_KEY__MINIO=…
S3_ENDPOINT__MINIO=https://minio.internal
```

La variante de cuenta cubre las variables que describen al *proveedor*: `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`, `S3_FORCE_PATH_STYLE`, `GCS_PROJECT_ID` y `GCS_KEY_FILENAME`. El nombre del bucket no es una de ellas y nunca tiene valor de respaldo (fallback); si lo tuviera, dos buckets en una misma cuenta se convertirían silenciosamente en uno.

Un valor por bucket sigue teniendo prioridad si lo defines, por lo que una fuente individual se puede mover a otro proveedor sin desconectar a las demás de su cuenta compartida. Deliberadamente no hay valor de respaldo a la variable sin sufijo: esa pertenece a la fuente predeterminada, y permitir que un bucket con nombre la herede implicaría que una clave mal escrita firmara con las credenciales de otra fuente.

## Topics y colas

Un topic se entrega a través de la cola de trabajos persistente: publicar escribe **una fila por suscripción**, de modo que cada suscriptor reintenta según su propio cronograma y uno que falle ni bloquea a los demás ni hace que se ejecuten de nuevo.

```ts
await signups.publish({ userId });
```

Una cola es la otra forma de trabajo en segundo plano: una lista de trabajo con **un único manejador (handler)**, donde quien llama conserva el ID del trabajo. Las colas se introdujeron en la versión 0.18 y los topics en la 0.17.

```ts
export const thumbnails = queue<{ key: string }>("thumbnails");
thumbnails.handler(async ({ key }, { attempt }) => { /* … */ });

const { id } = await thumbnails.enqueue({ key }, { runAt: new Date(Date.now() + 60_000) });
```

Ambos son de tipo **al menos una vez (at-least-once)**. Un worker que falle mientras procesa un trabajo lo libera y el siguiente inicia el handler desde el principio, por lo que un handler debe tolerar recibir un evento dos veces. Publicar o encolar dentro de una transacción que hace rollback nunca ocurrió: se trata de una inserción de fila.

Declarar cualquiera de los dos activa la cola de trabajos automáticamente en todas las rutas de arranque; un proyecto en el entorno de ejecución gestionado (managed runtime), que no tiene un punto de entrada para pasar `jobs.tasks`, obtiene sus handlers de esta forma. Publicar en un topic que nada declara, o encolar en una cola sin handler, lanza una excepción en lugar de escribir filas que ningún worker procesará.

## Crons y funciones

Ambos son archivos — `backend/crons/<name>.ts`, `backend/functions/<name>.ts` — y ambos entran en el grafo con el nombre del archivo, que también es el ID con el que el programador ejecuta un cron y la ruta en la que se monta una función. Ninguno se vincula desde el entorno; están en el grafo para que el host conozca las programaciones del proyecto antes de ejecutar nada.

```ts
export default defineCron({
    name: "Nightly cleanup",
    schedule: "0 3 * * *",
    timezone: "Europe/Madrid",
    async handler({ rebase }) { /* … */ }
});
```

Sin `timezone`, la programación se interpreta en la zona horaria del propio host — UTC en casi todos los contenedores, la tuya en un portátil —, por lo que `0 3 * * *` representaría una hora diferente antes y después de un despliegue. Si la zona no es reconocida, se rechazará al cargar el trabajo.

## Comportamiento ante fallos

Una fuente de datos declarada con transporte de servidor sin cadena de conexión **hace fallar el arranque**, indicando la variable que se debe configurar. Esto es deliberado y conviene entenderlo: la alternativa es que las tablas enrutadas a la fuente faltante recurran silenciosamente a la base de datos predeterminada. Eso implicaría que los datos terminen en el lugar equivocado detrás de un servidor que informa estar saludable, algo mucho peor que un contenedor que se niega a iniciar.

También se rechazan dos claves que deriven en el mismo nombre de variable, ya que una de ellas leería silenciosamente la configuración de la otra.

Las fuentes declaradas con `transport: "direct"` se omiten por completo: el cliente se comunica con ellas directamente, por lo que el backend no mantiene ninguna conexión ni exige configuración para ellas.

## Control de acceso al almacenamiento

Las claves de almacenamiento comparten un único espacio de nombres plano y no están sujetas a la seguridad a nivel de fila, por lo que sin un modelo explícito de control de acceso, el valor predeterminado sería «cualquier usuario autenticado puede leer, sobrescribir, eliminar o listar cualquier objeto». En producción se rehúsa el arranque antes que asumir eso.

La forma de definir qué significa el acceso en tu proyecto es mediante una exportación `storageAuthorize` desde `backend/storage.ts` — una función, ya que ninguna variable de entorno puede expresar «este usuario puede leer esta clave»:

```ts
// backend/storage.ts
import type { StorageAuthorize } from "@rebasepro/types";

export const storageAuthorize: StorageAuthorize = async ({ key, user, operation }) => {
    if (!user) return false;
    const [ownerId] = key.split("/");
    return ownerId === user.uid || operation === "read";
};
```

Existen dos opciones de escape por entorno para los casos en que ese sea verdaderamente el modelo:

- `STORAGE_PUBLIC_READ=true` — el bucket es una CDN pública de solo lectura. Sin un hook `storageAuthorize`, las escrituras, eliminaciones y listados quedan reservados únicamente para administradores.
- `STORAGE_ALLOW_ANY_AUTHENTICATED=true` — se confía en cualquier usuario autenticado para cualquier archivo. Defendible en una aplicación single-tenant, nunca en una multi-tenant.

## Almacenamiento en producción

Sin ningún bucket configurado, el almacenamiento está **desactivado** en producción y las subidas responden `501`. El disco local es el sistema de archivos del contenedor, por lo que los archivos escritos allí desaparecen en el siguiente reinicio: una subida que falla de forma evidente se puede reintentar, pero una que tuvo éxito en un disco a punto de borrarse, no. Establece `FORCE_LOCAL_STORAGE=true` solo cuando realmente haya un volumen persistente montado.

Ese volumen debe albergar todos los buckets locales, no solo el predeterminado. El directorio de un bucket local con nombre se ubica junto al del predeterminado, `<STORAGE_PATH>__<key>`. Con `STORAGE_PATH=/storage/uploads`, `bucket("media", { engine: "local" })` escribe en `/storage/uploads__media`. Monta el volumen en su directorio padre, `/storage`, tal como lo hace el archivo compose generado por `rebase init`, y no en el propio `STORAGE_PATH`. `STORAGE_PATH__MEDIA` establece explícitamente el directorio de un bucket. Consulta [Self-hosting](/docs/deployment/self-hosting/#file-storage).

Declarar buckets no cambia el bucket predeterminado. Con solo `bucket("media")` declarado, el predeterminado sigue leyendo sus propias variables. En desarrollo es `./uploads`. En producción, al no estar vinculado, está desactivado como cualquier bucket no vinculado: las subidas que no especifiquen ningún `source` responden `501 STORAGE_NOT_CONFIGURED`. El arranque lo indica una vez, con ambas soluciones: vincularlo (`STORAGE_TYPE=s3` y `S3_BUCKET`, o `STORAGE_TYPE=gcs` y `GCS_BUCKET`), o marcar un bucket con nombre como `default: true`.

En desarrollo, un bucket declarado que nada vincula es un directorio local — `uploads__media` junto al `uploads` predeterminado —, independientemente del motor que declare, por lo que `bucket("media", { engine: "s3" })` junto con `rebase dev` es suficiente para subir un archivo. El arranque indica qué motor está sustituyendo el directorio, y `rebase status` lo muestra en amarillo junto a la marca de verificación. Eso nunca ocurre en producción ni en el runtime gestionado: un bucket simulado allí escribiría las subidas en el sistema de archivos del contenedor que desaparece en el siguiente despliegue, por lo que un bucket no vinculado permanece no vinculado y responde 501.

## Relacionado

- [Descripción general del backend](/docs/backend/) — dónde reside cada declaración
- [Configuración de almacenamiento](/docs/backend/storage/) — la misma estructura para buckets
- [Entorno y configuración](/docs/getting-started/configuration/) — la convención `__SUFFIX` que vincula una fuente con sus variables
