---
sourceHash: ec729d5ce6fb4036
title: Múltiples bases de datos y buckets
sidebar_label: Múltiples fuentes
description: Enruta colecciones a diferentes bases de datos y propiedades a diferentes buckets de almacenamiento, y configura cada uno desde el entorno.
---

## Descripción general

Un proyecto no se limita a una sola base de datos y un solo bucket. Todo lo que
un proyecto necesita y tiene nombre — una base de datos, un bucket, un topic,
una cola — se **declara con un constructor en tu configuración**, y se configura
desde el entorno con una variable derivada de su clave. Los crons y las
funciones son ficheros, y entran en el mismo grafo bajo el nombre del fichero.

Una sola regla, sea cual sea el tipo: no hay un segundo sitio donde mirar, ni
nada que haya que mantener sincronizado a mano.

## Declarar los recursos

Ponlos en `config/resources.ts`. Exportarlos es una buena práctica — te da algo
que importar —, pero lo que los registra es la declaración.

```ts
// config/resources.ts
import { bucket, database, queue, topic } from "@rebasepro/types";

/** La base de datos del proyecto. Lee DATABASE_URL, como siempre. */
export const main = database();

/** Una segunda. Lee DATABASE_URL__ANALYTICS. */
export const analytics = database("analytics", { label: "Analytics warehouse" });

/** Un bucket. Lee S3_BUCKET__MEDIA. */
export const media = bucket("media", { engine: "s3", label: "Public media" });

/** Un topic, entregado a través de la cola de trabajos duradera. */
export const signups = topic<{ userId: string }>("signups");

signups.subscription("send-welcome", async (event) => {
    // …
});
```

`queue()` es nuevo <span class="since-badge" data-since="0.18">Since 0.18</span>. `database()`, `bucket()` y `topic()`
se pueden declarar desde 0.17, así que un proyecto en la versión publicada
declara esos tres y llega al trabajo en segundo plano a través de `jobs.tasks`.

Luego apunta una colección a uno de ellos, por handle — el mismo nombre, escrito
una sola vez:

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

`defineCollection` registra la clave del handle, así que a partir de ahí una
colección son datos simples — se serializa, se compara, llega a la interfaz de
administración. La forma en cadena (`dataSource: "analytics"`) sigue
funcionando; el handle es el que sigue un renombrado y sobre el que aterriza
«ir a la definición».

En una función, esos mismos handles alcanzan el recurso:

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

### Ver lo que has declarado

<span class="since-badge" data-since="0.18">Since 0.18</span>

```bash
rebase resources            # enumerarlos
rebase resources --write    # regenerar rebase.resources.json
rebase resources --check    # fallar si ese fichero está obsoleto
```

`rebase.resources.json` se **genera** y se versiona. Es lo que un host lee para
decidir qué aprovisionar *antes* de ejecutar nada — así es como una consola
puede decir «este proyecto quiere un bucket `media` y no tiene ninguno» en el
primer despliegue. Edita las declaraciones, nunca el fichero; `--check` hace
fallar una build si ambos discrepan.

Cada entrada registra además **quién lo usa** — `collection:page_views` en una
base de datos, `property:posts.cover` en un bucket, `function:report` en lo que
la función importe de `resources.ts`. Ese es el mapa que una consola necesita
para responder «qué se rompe si quito esto».

`rebase status` va un paso más allá: para cada declaración dice si el entorno la
vincula, usando los mismos resolutores que usa el arranque, de modo que no puede
tranquilizarte sobre un despliegue que está a punto de negarse a arrancar.

### Un motor del que la build nunca ha oído hablar

Cada tipo posee su propia lista de motores, y uno desconocido se rechaza en el
punto de llamada en lugar de aceptarse y fallar más tarde. Algo genuinamente
fuera de la lista se escribe `custom:`:

```ts
export const objects = bucket("objects", { engine: "custom:minio" });
```

### Corregir un kind que ya se ha publicado

<span class="since-badge" data-since="0.18">Since 0.18</span>

Para autores de drivers. La definición registrada de un kind de recurso queda
**congelada** en cuanto se publica un paquete que la lleva: cada driver
publicado incorpora su propia copia de `@rebasepro/types`, y esa copia compara
la entrada del registro compartido con su propio literal y lanza un error ante
cualquier diferencia. Editar el literal mata, por tanto, todo bundle construido
con un driver más antiguo al cargar el driver.

`amendResourceKind` corrige a qué se *vincula* un kind — sus bases de variables
de entorno, sus claves de opciones — sin tocar el literal que compara cualquier
copia más antigua:

```ts
import { amendResourceKind } from "@rebasepro/types";

amendResourceKind("database", {
    envBases: ["DATABASE_URL", "DATABASE_READ_URL", "ADMIN_CONNECTION_STRING"]
});
```

La corrección solo se aplica a las lecturas a través de esta copia, así que un
driver antiguo sigue vinculando como lo hacía cuando se publicó. Úsala para
cualquier corrección a un kind ya publicado; usa `registerResourceKind` solo
para un kind que nadie ha publicado.

### Entregárselos al frontend

El proveedor `<Rebase>` necesita saber qué fuentes existen y cómo se alcanza
cada una — una fuente `direct` es aquella con la que habla el propio navegador.
Importa el mismo paquete de configuración que el backend, así que puede
reutilizar las declaraciones en lugar de repetirlas:

```tsx
import "../config/resources";                 // las registra
import { declaredDataSources, declaredStorageSources } from "@rebasepro/types";

<Rebase
    dataSources={declaredDataSources()}
    storageSources={declaredStorageSources()}
>
    {children}
</Rebase>
```

El import por efecto secundario es deliberado: declarar es lo que registra, así
que un bundler que descartara un módulo sin usar dejaría ambas listas vacías.

## Configuración de cada fuente

Los nombres de las variables de entorno se derivan de la clave del recurso, por lo que no hay nada
que mantener sincronizado manualmente:

```
<VARIABLE>              the default resource   DATABASE_URL, S3_BUCKET
<VARIABLE>__<KEY>       a named resource       DATABASE_URL__ANALYTICS, S3_BUCKET__MEDIA
```

La clave se convierte a mayúsculas y los caracteres no alfanuméricos se convierten en guiones bajos, por lo que
`media-cdn` lee `S3_BUCKET__MEDIA_CDN`.

El separador es un **doble** guion bajo a propósito. Uno solo colisionaría
con nombres de variables reales: `S3_BUCKET_NAME` se interpretaría como el bucket para una
fuente llamada `name`.

### Bases de datos

```bash
DATABASE_URL=postgres://localhost/app
DATABASE_URL__ANALYTICS=postgres://warehouse.internal/analytics

# Optional, per source:
DB_POOL_MAX__ANALYTICS=5
REBASE_DRIVER__ANALYTICS=@rebasepro/server-postgres
```

El controlador (driver) se elige a partir del `engine` declarado (se conocen `postgres` y
`mongodb`), y `REBASE_DRIVER__<KEY>` lo anula para cualquier otra cosa.
`REBASE_DB_POOL_MAX` es un techo para todo el proceso, no una vinculación por
fuente, así que no lleva sufijo.

En desarrollo no configuras nada de esto: `rebase dev` sirve cada base de datos
declarada desde su Postgres gestionado — una segunda instancia para `analytics`,
arrancada bajo demanda — y exporta `DATABASE_URL__ANALYTICS` por sí mismo. Una
variable que definas a mano nunca se sobrescribe.

Las tablas y las políticas de seguridad a nivel de fila se aprovisionan **por
fuente**: una colección enrutada a `analytics` obtiene su tabla, y sus
políticas, en la base de datos de analytics.

### Almacenamiento

```bash
S3_BUCKET__MEDIA=my-media-bucket
S3_REGION__MEDIA=eu-central-1
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

El motor viene de la declaración, así que no hay ningún `STORAGE_TYPE` que
definir.

#### Qué bucket recibe una subida sin cualificar

Una propiedad de almacenamiento que no nombra ninguna `storageSource` escribe en
el bucket **por defecto**, y un proyecto con buckets nombrados tiene que decir
cuál es. O declaras el bucket con la clave por defecto — `export const uploads =
bucket();` — o marcas uno de los nombrados:

```ts
export const media = bucket("media", { engine: "s3", default: true });
```

Sin ninguna de las dos, el arranque promueve el primer bucket nombrado que se
declara y avisa, nombrando ambas soluciones. Tome una de ellas: una promoción
decide dónde acaban los archivos de un usuario por orden de declaración, y da
respuestas distintas a cada lado de un despliegue, porque el bucket local con el
que el desarrollo hace de suplente se descarta en producción y la promoción no.

### Varios buckets en una sola cuenta

Cada variable se lee por clave: eso es correcto para el *nombre* del bucket y
equivocado para las credenciales — quince buckets en la misma instalación de
MinIO supondrían quince copias de la misma access key. Indica una `account` y
las variables de nivel de proveedor se leen una sola vez:

```ts
export const media   = bucket("media",   { engine: "s3", account: "minio" });
export const avatars = bucket("avatars", { engine: "s3", account: "minio" });
```

```bash
S3_BUCKET__MEDIA=project-media       # por bucket, nunca compartido
S3_BUCKET__AVATARS=project-avatars
S3_ACCESS_KEY_ID__MINIO=…            # leída una vez, por ambos
S3_SECRET_ACCESS_KEY__MINIO=…
S3_ENDPOINT__MINIO=https://minio.internal
```

La forma con cuenta cubre las variables que describen el *proveedor*:
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`,
`S3_FORCE_PATH_STYLE`, `GCS_PROJECT_ID` y `GCS_KEY_FILENAME`. El nombre del
bucket no es una de ellas y nunca recurre a la cuenta: si lo hiciera, dos buckets
en una misma cuenta se convertirían silenciosamente en uno.

Un valor por bucket sigue teniendo prioridad, así que una fuente puede moverse a
otro proveedor sin desconectar las demás de su cuenta compartida. No existe
deliberadamente ningún respaldo a la variable sin sufijo: esa pertenece a la
fuente por defecto, y dejar que un bucket con nombre la herede significaría que
una clave mal escrita firma con las credenciales de otra fuente.

## Topics y colas

Un topic se entrega a través de la cola de trabajos duradera: publicar escribe
**una fila por suscripción**, de modo que cada suscriptor reintenta según su
propio calendario y uno averiado ni bloquea a los demás ni los hace ejecutarse
de nuevo.

```ts
await signups.publish({ userId });
```

Una cola es la otra forma del trabajo en segundo plano: una lista de tareas con
**un solo handler**, en la que quien llama se queda con el id del trabajo. Las
colas son nuevas <span class="since-badge" data-since="0.18">Since 0.18</span> — los topics llegaron en 0.17.

```ts
export const thumbnails = queue<{ key: string }>("thumbnails");
thumbnails.handler(async ({ key }, { attempt }) => { /* … */ });

const { id } = await thumbnails.enqueue({ key }, { runAt: new Date(Date.now() + 60_000) });
```

Ambos son **at-least-once**. Un worker que muere sosteniendo un trabajo lo
libera y el siguiente empieza el handler desde arriba, así que un handler debe
tolerar ver un evento dos veces. Publicar o encolar dentro de una transacción
que se revierte nunca ocurrió: es la inserción de una fila.

Declarar cualquiera de los dos enciende la cola de trabajos por sí solo, en
todas las rutas de arranque — un proyecto en el runtime gestionado, que no tiene
punto de entrada por el que pasar `jobs.tasks`, recibe sus handlers así.
Publicar en un topic que nadie declara, o encolar en una cola sin handler, lanza
un error en lugar de escribir filas que ningún worker atiende.

## Crons y funciones

Ambos son ficheros — `backend/crons/<name>.ts`, `backend/functions/<name>.ts` —
y ambos entran en el grafo bajo el nombre del fichero, que es también el id con
el que el planificador ejecuta un cron y la ruta en la que se monta una función.
Ninguno se vincula desde el entorno; están en el grafo para que un host conozca
los calendarios de un proyecto antes de ejecutar nada.

```ts
export default defineCron({
    name: "Nightly cleanup",
    schedule: "0 3 * * *",
    timezone: "Europe/Madrid",
    async handler({ rebase }) { /* … */ }
});
```

Sin `timezone` el calendario se lee en la zona del propio host — UTC en casi
todos los contenedores, la tuya en un portátil —, así que `0 3 * * *` significa
una hora distinta a cada lado de un despliegue. Una zona desconocida se rechaza
cuando el trabajo se carga.

## Comportamiento ante fallos

Una fuente de datos declarada con transporte de servidor sin cadena de conexión **hace fallar el inicio**,
indicando el nombre de la variable que se debe definir. Esto es deliberado y vale la pena comprenderlo:
la alternativa es que las colecciones enrutadas a la fuente faltante recurran silenciosamente a la base de datos predeterminada.
Eso significa que los datos terminan en el lugar equivocado detrás de un servidor que se reporta como saludable,
lo cual es mucho peor que un contenedor que se niega a iniciar.

También se rechazan dos claves que derivarían en el mismo nombre de variable, porque una
de ellas leería silenciosamente la configuración de la otra.

Las fuentes declaradas con `transport: "direct"` se omiten por completo: el cliente
se comunica directamente con ellas, por lo que el backend no mantiene ninguna conexión y no exige
ninguna configuración para ellas.

## Control de acceso al almacenamiento

Las claves de almacenamiento comparten un único espacio de nombres plano y no están bajo seguridad a nivel de fila, por lo
que sin un modelo explícito de control de acceso, el comportamiento predeterminado sería "cualquier usuario autenticado
puede leer, sobrescribir, eliminar o listar cualquier objeto". En producción se niega a iniciar
antes que asumir eso.

La forma de definir lo que significa el acceso para tu proyecto es exportando `storageAuthorize`
desde el paquete de configuración — una función, porque ninguna variable de entorno puede expresar
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

Existen dos opciones de escape por entorno para los casos en que ese realmente sea el modelo:

- `STORAGE_PUBLIC_READ=true` — el bucket es una CDN pública de solo lectura. Las escrituras,
  eliminaciones y listados aún requieren autenticación.
- `STORAGE_ALLOW_ANY_AUTHENTICATED=true` — se confía en todos los usuarios autenticados para
  cada archivo. Defendible para una aplicación de un solo inquilino (single-tenant), nunca para una de múltiples inquilinos (multi-tenant).

## Almacenamiento en producción

Sin un bucket configurado, el almacenamiento está **desactivado** en producción y las cargas de archivos responden
`501`. El disco local es el sistema de archivos del contenedor, por lo que los archivos escritos allí desaparecen en
el siguiente reinicio: una carga que falla ruidosamente se puede reintentar, mientras que una que tuvo éxito
en un disco a punto de ser borrado, no. Establece `FORCE_LOCAL_STORAGE=true` solo cuando realmente
haya un volumen durable montado.

Una consecuencia que vale la pena conocer si declaras buckets explícitamente: no
se inventa ningún bucket por defecto para ti. Declarar solo `bucket("media")`
significa que no hay bucket por defecto, y una propiedad que no nombre ninguno
no tendrá adónde ir — deliberadamente, y de forma idéntica en desarrollo y
producción. Añade también `bucket()` si quieres uno.

En desarrollo, un bucket declarado que nada vincula es un directorio local —
`uploads__media` junto al `uploads` por defecto — sea cual sea el motor que
declare, así que `bucket("media", { engine: "s3" })` más `rebase dev` basta para
subir un archivo. El arranque dice de qué motor está haciendo de suplente el
directorio, y `rebase status` lo muestra en amarillo junto al visto bueno. Eso
no ocurre nunca en producción ni en el runtime gestionado: un bucket inventado
allí escribiría las subidas en un sistema de archivos de contenedor que
desaparece en el siguiente despliegue, así que un bucket sin vincular sigue sin
vincular y responde 501.

## Relacionado

- [Descripción general del backend](/docs/backend/) — `dataSources` y dónde vive la declaración
- [Configuración del almacenamiento](/docs/backend/storage/) — la misma forma para los buckets
- [Entorno y configuración](/docs/getting-started/configuration/) — la convención `__SUFFIX` que vincula una fuente a sus variables

---
