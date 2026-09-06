---
sourceHash: b2263faa9ec92398
title: Múltiples bases de datos y buckets
sidebar_label: Múltiples fuentes
description: Enruta colecciones a diferentes bases de datos y propiedades a diferentes buckets de almacenamiento, y configura cada uno desde el entorno.
---

## Descripción general

Un proyecto no se limita a una sola base de datos y un solo bucket. Las colecciones ya
se enrutan por `dataSource`, y las propiedades de archivo se enrutan por `storageSource`; esta página
trata sobre cómo obtiene su configuración cada fuente con nombre.

Dos pasos: **declarar** las fuentes en tu paquete de configuración, luego **configurar**
cada una con variables de entorno derivadas de su clave.

## Declarar los recursos

Todo lo que un proyecto necesita y tiene nombre — una base de datos, un bucket,
un topic — se **declara con un constructor**, en `config/resources.ts`. Una
sola regla, sea cual sea el tipo: no hay un segundo sitio donde mirar.

```ts
// config/resources.ts
import { bucket, database, topic } from "@rebasepro/types";

/** La base de datos del proyecto. Lee DATABASE_URL, como siempre. */
export const main = database();

/** Una segunda. Lee DATABASE_URL__ANALYTICS. */
export const analytics = database("analytics", { label: "Analytics warehouse" });

/** Un bucket. Lee S3_BUCKET__MEDIA. */
export const media = bucket("media", { engine: "s3", label: "Public media" });

/** Un topic, entregado a través de la cola de trabajos duradera. */
export const signups = topic<{ userId: string }>("signups");
```

`rebase resources` enumera lo que un proyecto declara, `--write` regenera
`rebase.resources.json` y `--check` falla si ese fichero está obsoleto. Ese
fichero se **genera** y se versiona: es lo que un host lee para decidir qué
aprovisionar *antes* de ejecutar nada.

Un motor desconocido se rechaza en el punto de llamada, no más tarde. Para uno
que esta build no conoce se escribe `custom:` — por ejemplo
`bucket("objects", { engine: "custom:minio" })`.

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

### Qué bucket recibe una subida sin cualificar

Una propiedad de almacenamiento que no nombra ninguna `storageSource` escribe en
el bucket **por defecto**, y un proyecto con buckets nombrados tiene que decir
cuál es. O declaras el bucket por defecto — `export const uploads = bucket();` —
o marcas uno de los nombrados:

```ts
export const media = bucket("media", { engine: "s3", default: true });
```

El arranque rechaza un proyecto con buckets nombrados y sin ninguno por defecto,
y nombra las dos soluciones. Antes elegía el primero declarado, con un aviso:
eso decidía dónde acaban los archivos de un usuario por orden de declaración, y
daba respuestas distintas a cada lado de un despliegue, porque el bucket local
con el que el desarrollo hace de suplente se descarta en producción y la
promoción no.

Luego, apunta una colección a una de ellas:

```ts
import { defineCollection } from "@rebasepro/cms-types";
const pageViewsCollection = defineCollection({
    name: "Page Views",
    slug: "page_views",
    table: "page_views",
    dataSource: "analytics",
    properties: { /* … */ }
});
```

...o una propiedad de archivo:

```ts
coverImage: {
    name: "Cover image",
    type: "string",
    storage: { storageSource: "media", acceptedFiles: ["image/*"] }
}
```

## Configuración de cada fuente

Los nombres de las variables de entorno se derivan de la clave de la fuente, por lo que no hay nada
que mantener sincronizado manualmente:

```
<VARIABLE>              the default source     DATABASE_URL, S3_BUCKET
<VARIABLE>__<KEY>       a named source         DATABASE_URL__ANALYTICS, S3_BUCKET__MEDIA
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
ADMIN_CONNECTION_STRING__ANALYTICS=postgres://…
REBASE_DRIVER__ANALYTICS=@rebasepro/server-postgres
```

El controlador (driver) se elige a partir del `engine` declarado (se conocen `postgres` y
`mongodb`), y `REBASE_DRIVER__<KEY>` lo anula para cualquier otra cosa.

### Almacenamiento

```bash
STORAGE_TYPE__MEDIA=s3
S3_BUCKET__MEDIA=my-media-bucket
S3_REGION__MEDIA=eu-central-1
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

`STORAGE_TYPE__<KEY>` se puede omitir cuando la declaración ya nombra el motor (`engine`).

### Varios buckets en una sola cuenta

Cada variable se lee por clave: eso es correcto para el *nombre* del bucket y
equivocado para las credenciales — quince buckets en la misma instalación de
MinIO supondrían quince copias de la misma access key. Indica una `account` y
las variables de nivel de proveedor se leen una sola vez:

```ts
export const media   = bucket("media",   { engine: "s3", account: "minio" });
export const avatars = bucket("avatars", { engine: "s3", account: "minio" });
```

```
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

Una consecuencia que vale la pena conocer si declaras explícitamente las fuentes de almacenamiento: no
se inventa un bucket predeterminado para ti. Declarar solo una fuente `media` significa que no
hay una fuente `(default)`, y una propiedad que no nombre ninguna no tendrá adónde ir, deliberadamente
y de forma idéntica en desarrollo y producción. Declara `(default)` también si deseas tener una.

---
