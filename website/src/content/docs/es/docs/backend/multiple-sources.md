---
sourceHash: 6eb6098e26cb24c0
title: Múltiples bases de datos y buckets
sidebar_label: Múltiples orígenes
description: Enrute colecciones a diferentes bases de datos y propiedades a diferentes buckets de almacenamiento, y configure cada uno desde el entorno.
---

## Visión general

Un proyecto no está limitado a una sola base de datos y un solo bucket. Cada elemento con nombre que
un proyecto necesita —una base de datos, un bucket, un topic, una cola— se **declara con un
constructor en su configuración**, y se configura desde el entorno mediante una variable
derivada de su clave. Los crons y las funciones son archivos, y entran en el mismo
grafo bajo el nombre del archivo.

Una sola regla, cualquiera que sea el tipo: no hay un segundo lugar donde buscar, y nada que
tenga que mantenerse sincronizado a mano.

## Declarar recursos

Colóquelos en `config/resources.ts`. Exportarlos es una buena práctica —le da
algo que importar—, pero la declaración es lo que los registra.

```ts
// config/resources.ts
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

`queue()` es nuevo. `database()`, `bucket()` y `topic()`
se pueden declarar desde la versión 0.17, por lo que un proyecto en la versión publicada declara
esos tres y accede al trabajo en segundo plano a través de `jobs.tasks` en su lugar.

Luego, apunte una colección a uno de ellos, por handle —el mismo nombre, escrito una sola vez:

```ts
import { defineCollection } from "@rebasepro/cms-types";
import { analytics } from "../resources";

const pageViewsCollection = defineCollection({
    name: "Page Views",
    slug: "page_views",
    table: "page_views",
    dataSource: analytics,
    properties: { /* … */ }
});
```

...o una propiedad de archivo:

```ts
import { media } from "../resources";

coverImage: {
    name: "Cover image",
    type: "string",
    storage: { storageSource: media, acceptedFiles: ["image/*"] }
}
```

`defineCollection` registra la clave del handle, por lo que a partir de ese punto una colección es
puro dato —se serializa, se compara, llega a la interfaz de administración. La forma
de cadena de texto (`dataSource: "analytics"`) sigue funcionando; el handle es el que sigue
un renombrado y al que apunta la acción de ir a la definición.

En una función, los mismos handles acceden al recurso:

```ts
import { defineFunction } from "@rebasepro/server/functions";
import { analytics, media } from "../../config/resources";

export default defineFunction((app, { rebase }) => {
    app.post("/report", async (c) => {
        const rows = await rebase.sql("select count(*) from page_views", { database: analytics });
        const file = new File([JSON.stringify(rows)], "report.json", { type: "application/json" });
        await rebase.bucket(media).putObject({ key: "report.json", file });
        return c.json({ ok: true });
    });
});
```

### Ver lo que ha declarado

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if that file is stale
```

`rebase.resources.json` es **generado** y se incluye en el control de versiones. Es lo que un host lee
para decidir qué aprovisionar *antes* de ejecutar cualquier cosa —así es como una consola
puede decir "este proyecto requiere un bucket `media` y no tiene ninguno" en un primer despliegue.
Edite las declaraciones, nunca el archivo; `--check` hace fallar la compilación si los dos
no coinciden.

Cada entrada también registra **quién la usa** —`collection:page_views` en una
base de datos, `property:posts.cover` en un bucket, `function:report` en cualquier cosa
que la función importe desde `resources.ts`. Ese es el mapa que necesita una consola para
responder a la pregunta "qué se rompe si elimino esto".

`rebase status` va un paso más allá: para cada declaración indica si
el entorno la vincula, utilizando los mismos métodos de resolución que usa el arranque, por lo que no puede
darle falsas garantías sobre un despliegue que está a punto de negarse a iniciar.

### Un motor del que la compilación nunca ha oído hablar

Cada tipo posee su lista de motores, y uno desconocido es rechazado en el punto de llamada
en lugar de ser aceptado y fallar más tarde. Algo genuinamente fuera de la lista se
escribe como `custom:`:

```ts
export const objects = bucket("objects", { engine: "custom:minio" });
```

### Corregir un tipo que ya ha sido publicado

Para autores de drivers. La definición registrada de un tipo de recurso queda **congelada** una vez que
se ha publicado un paquete que la incluye: cada driver publicado incluye su propia
copia de `@rebasepro/types`, y la copia compara la entrada del registro compartido
contra su propio literal y lanza un error ante cualquier diferencia. Por lo tanto, editar el literal
inutiliza cada bundle compilado con un driver anterior al momento de cargar el driver.

`amendResourceKind` corrige lo que un tipo *vincula* —sus bases de entorno, sus
claves de opciones— sin tocar el literal contra el que se compara cualquier copia anterior:

```ts
import { amendResourceKind } from "@rebasepro/types";

amendResourceKind("database", {
    envBases: ["DATABASE_URL", "DATABASE_READ_URL", "ADMIN_CONNECTION_STRING"]
});
```

La modificación se aplica únicamente a las lecturas a través de esta copia, de modo que un driver anterior continúa
vinculándose de la forma en que lo hacía cuando fue publicado. Utilícelo para cada corrección de un
tipo ya distribuido; utilice `registerResourceKind` solo para un tipo que nadie haya publicado aún.

### Pasarlos al frontend

El proveedor `<Rebase>` necesita saber qué orígenes existen y cómo se accede a cada uno —un
origen `direct` es aquel con el que el navegador se comunica por sí mismo. Importa el
mismo paquete de configuración que el backend, por lo que puede reutilizar las declaraciones en
lugar de repetirlas:

```tsx
import "../config/resources";                 // registers them
import { declaredDataSources, declaredStorageSources } from "@rebasepro/types";

<Rebase
    dataSources={declaredDataSources()}
    storageSources={declaredStorageSources()}
>
    {children}
</Rebase>
```

La importación con efectos secundarios es deliberada: declarar es lo que registra, por lo que un empaquetador
que descartara un módulo no utilizado dejaría ambas listas vacías.

## Configurar cada origen

Los nombres de las variables de entorno se derivan de la clave del recurso, por lo que no hay
nada que mantener sincronizado a mano:

```
<VARIABLE>              the default resource   DATABASE_URL, S3_BUCKET
<VARIABLE>__<KEY>       a named resource       DATABASE_URL__ANALYTICS, S3_BUCKET__MEDIA
```

La clave se pasa a mayúsculas y los caracteres no alfanuméricos se convierten en guiones bajos, por lo que
`media-cdn` lee `S3_BUCKET__MEDIA_CDN`.

El separador es un **doble** guion bajo a propósito. Uno simple colisionaría
con nombres de variables reales —`S3_BUCKET_NAME` se interpretaría como el bucket para un
origen llamado `name`.

### Bases de datos

```bash
DATABASE_URL=postgres://localhost/app
DATABASE_URL__ANALYTICS=postgres://warehouse.internal/analytics

# Optional, per source:
DB_POOL_MAX__ANALYTICS=5
REBASE_DRIVER__ANALYTICS=@rebasepro/server-postgres
```

El driver se elige a partir del `engine` declarado (`postgres` y `mongodb` son
conocidos), y `REBASE_DRIVER__<KEY>` lo sobrescribe para cualquier otro caso.
`REBASE_DB_POOL_MAX` es un límite para todo el proceso, no una vinculación por origen, por lo que
no lleva sufijo.

En desarrollo no es necesario configurar nada de esto: `rebase dev` sirve cada base de datos declarada
desde su Postgres administrado —una segunda instancia para `analytics`, iniciada
bajo demanda— y exporta `DATABASE_URL__ANALYTICS` por sí mismo. Una variable que usted configure
manualmente nunca se sobrescribe.

Las tablas y las políticas de seguridad a nivel de fila (RLS) se aprovisionan **por origen**: una
colección enrutada a `analytics` obtiene su tabla, y sus políticas, en la
base de datos de analytics.

### Almacenamiento

```bash
S3_BUCKET__MEDIA=my-media-bucket
S3_REGION__MEDIA=eu-central-1
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

El motor proviene de la declaración, por lo que no hay ningún `STORAGE_TYPE` que configurar.

#### Qué bucket recibe una subida no calificada

Una propiedad de almacenamiento que no especifica ningún `storageSource` escribe en el bucket
**predeterminado**, y un proyecto con buckets con nombre debe indicar cuál es ese bucket. Puede
declarar el bucket con la clave predeterminada —`export const uploads = bucket();`— o marcar
uno de los buckets con nombre:

```ts
export const media = bucket("media", { engine: "s3", default: true });
```

Sin ninguna de las dos opciones, el arranque promueve el primer bucket con nombre declarado y muestra una advertencia,
indicando ambas soluciones. Elija una de ellas: una promoción decide dónde terminan los archivos de un usuario
según el orden de declaración, y da respuestas diferentes a cada lado de un despliegue,
debido a que el bucket local que development usa de sustituto se descarta en producción
y la promoción no.

### Múltiples buckets en una sola cuenta

Cada variable se lee por clave, lo cual es correcto para el nombre del bucket pero erróneo para
las credenciales —quince buckets en una sola instalación de MinIO implicarían quince copias
de la misma clave de acceso. Indique un `account` y las variables a nivel de proveedor se
leerán una sola vez:

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

La forma de cuenta cubre las variables que describen al *proveedor*:
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`,
`S3_FORCE_PATH_STYLE`, `GCS_PROJECT_ID` y `GCS_KEY_FILENAME`. El nombre del bucket
no es una de ellas y nunca recurre a un valor por defecto —si lo hiciera, dos buckets en una misma cuenta
se convertirían silenciosamente en uno solo.

Un valor definido por bucket sigue teniendo prioridad cuando se configura, de modo que un único origen puede
trasladarse a otro proveedor sin desconectar a los demás de su cuenta compartida. De forma deliberada,
no hay retroceso (fallback) a la variable sin sufijo: esa pertenece al
origen predeterminado, y permitir que un bucket con nombre la heredara significaría que una clave mal escrita
firmaría con las credenciales de otro origen.

## Topics y colas

Un topic se entrega a través de la cola de trabajos duradera: publicar escribe **una fila
por suscripción**, por lo que cada suscriptor reintenta según su propio cronograma y uno que
falle ni bloquea a los demás ni hace que se ejecuten de nuevo.

```ts
await signups.publish({ userId });
```

Una cola es la otra variante de trabajo en segundo plano: una lista de trabajo con **un solo
manejador**, donde el emisor conserva el id del trabajo. Las colas son nuevas
 —los topics se introdujeron en la versión 0.17.

```ts
export const thumbnails = queue<{ key: string }>("thumbnails");
thumbnails.handler(async ({ key }, { attempt }) => { /* … */ });

const { id } = await thumbnails.enqueue({ key }, { runAt: new Date(Date.now() + 60_000) });
```

Ambos son de tipo **al menos una vez (at-least-once)**. Un worker que falle mientras procesa un trabajo lo libera y
el siguiente inicia el manejador desde el principio, por lo que un manejador debe tolerar ver
un evento dos veces. Publicar o encolar dentro de una transacción que luego se revierte
nunca ocurrió —se trata de una inserción de fila.

Declarar cualquiera de los dos activa la cola de trabajos por sí misma, en cualquier flujo de arranque —un
proyecto en el runtime administrado, que no tiene un punto de entrada para pasar
`jobs.tasks`, obtiene sus manejadores de esta manera. Publicar en un topic que nada declara, o
encolar en una cola sin manejador, lanza un error en lugar de escribir filas que ningún
worker procesará.

## Crons y funciones

Ambos son archivos —`backend/crons/<name>.ts`, `backend/functions/<name>.ts`—
y ambos entran en el grafo bajo el nombre del archivo, que es también el id con el que el
programador ejecuta un cron y la ruta en la que se monta una función. Ninguno se vincula desde
el entorno; están en el grafo para que un host conozca las programaciones de un proyecto
antes de ejecutar cualquier cosa.

```ts
export default defineCron({
    name: "Nightly cleanup",
    schedule: "0 3 * * *",
    timezone: "Europe/Madrid",
    async handler({ rebase }) { /* … */ }
});
```

Sin `timezone`, la programación se interpreta en la propia zona horaria del host —UTC en casi
todos los contenedores, la suya en una laptop— por lo que `0 3 * * *` significa una hora diferente
a cada lado de un despliegue. Una zona desconocida se rechaza cuando el trabajo se carga.

## Comportamiento ante fallos

Un origen de datos declarado con transporte por servidor que no tenga cadena de conexión **hace fallar el
arranque**, indicando el nombre de la variable que debe configurarse. Esto es deliberado y conviene entenderlo:
la alternativa es que las colecciones enrutadas al origen faltante recurran silenciosamente
a la base de datos predeterminada. Eso implicaría datos guardándose en el lugar incorrecto detrás de un
servidor que reporta estar saludable —mucho peor que un contenedor que se niega a
iniciar.

Dos claves que deriven en el mismo nombre de variable también son rechazadas, porque una
de ellas leería silenciosamente la configuración de la otra.

Los orígenes declarados con `transport: "direct"` se omiten por completo: el cliente
se comunica directamente con ellos, por lo que el backend no mantiene ninguna conexión ni exige
ninguna configuración para ellos.

## Control de acceso al almacenamiento

Las claves de almacenamiento comparten un único espacio de nombres plano y no están sujetas a seguridad a nivel de fila, por lo que,
sin un modelo explícito de control de acceso, el valor predeterminado sería "cualquier usuario autenticado
puede leer, sobrescribir, eliminar o listar cualquier objeto". En producción, el sistema se niega a arrancar
en lugar de asumir eso.

La forma de definir qué significa el acceso para su proyecto es exportar `storageAuthorize`
desde el paquete de configuración —una función, porque ninguna variable de entorno puede expresar
"este usuario puede leer esta clave":

```ts
// config/index.ts
import type { StorageAuthorize } from "@rebasepro/types";

export const storageAuthorize: StorageAuthorize = async ({ key, user, operation }) => {
    if (!user) return false;
    const [ownerId] = key.split("/");
    return ownerId === user.uid || operation === "read";
};
```

Existen dos vías de escape por variables de entorno para los casos en que ese sea realmente el modelo:

- `STORAGE_PUBLIC_READ=true` — el bucket es una CDN pública de solo lectura. Las operaciones de escritura,
  eliminación y listado siguen requiriendo autenticación.
- `STORAGE_ALLOW_ANY_AUTHENTICATED=true` — se confía en todo usuario autenticado para
  cualquier archivo. Defendible para una aplicación de un solo inquilino (single-tenant), nunca para una multi-tenant.

## Almacenamiento en producción

Si no hay ningún bucket configurado, el almacenamiento está **desactivado** en producción y las subidas devuelven
`501`. El disco local es el sistema de archivos del contenedor, por lo que los archivos escritos allí desaparecen en
el siguiente reinicio —una subida que falla de manera evidente puede reintentarse, pero una que tuvo éxito
en un disco que está a punto de borrarse, no. Establezca `FORCE_LOCAL_STORAGE=true` únicamente cuando
realmente haya montado un volumen duradero.

Ese volumen debe contener cada bucket local, no solo el predeterminado. El directorio de un bucket
local con nombre se sitúa junto al predeterminado, `<STORAGE_PATH>__<key>`.
Con `STORAGE_PATH=/storage/uploads`, `bucket("media", { engine: "local" })`
escribe en `/storage/uploads__media`. Monte el volumen en su directorio padre,
`/storage`, tal como lo hace el archivo compose que genera `rebase init`, y no directamente en
`STORAGE_PATH`. `STORAGE_PATH__MEDIA` define el directorio de un bucket
de forma explícita. Consulte [Autoalojamiento](/docs/deployment/self-hosting/#file-storage).

Una consecuencia que conviene conocer si declara buckets explícitamente: no se inventa ningún bucket
predeterminado para usted. Declarar únicamente `bucket("media")` significa que no hay ningún
bucket predeterminado, y una propiedad que no especifique uno no tendrá a dónde ir —de forma
deliberada, e idéntica en desarrollo y en producción. Añada también `bucket()`
si desea tener uno.

En desarrollo, un bucket declarado que no esté vinculado a nada es un directorio local —`uploads__media`
junto al `uploads` predeterminado— sin importar el motor que declare, por lo que
`bucket("media", { engine: "s3" })` junto con `rebase dev` es suficiente para subir un
archivo. El arranque indica qué motor está sustituyendo el directorio, y `rebase status`
lo muestra en amarillo junto a la marca de verificación. Eso nunca sucede en producción,
ni en el runtime administrado: un bucket inventado allí escribiría las subidas en el
sistema de archivos de un contenedor que desaparece en el próximo despliegue, por lo que un bucket no vinculado
permanece sin vincular y devuelve 501.

## Relacionado

- [Visión general del backend](/docs/backend/) — `dataSources` y dónde reside la declaración
- [Configuración de almacenamiento](/docs/backend/storage/) — la misma estructura para buckets
- [Entorno y configuración](/docs/getting-started/configuration/) — la convención `__SUFFIX` que vincula un origen con sus variables
