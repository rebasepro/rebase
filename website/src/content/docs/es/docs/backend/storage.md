---
sourceHash: dde397d03ef58183
title: Configuración de almacenamiento
sidebar_label: Configuración de almacenamiento
description: Configure backends de almacenamiento de sistema de archivos local, compatibles con S3 o GCS/Firebase Storage para subidas de archivos, imágenes y medios.
---

## Descripción general

Rebase admite tres backends de almacenamiento:

- **Sistema de archivos local** — Archivos almacenados en disco (ideal para desarrollo)
- **Compatible con S3** — AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces
- **Google Cloud Storage / Firebase Storage** — Soporte nativo para GCS mediante `@google-cloud/storage`

## Configuración

:::note[Dónde va esto]
**Runtime administrado** — las variables `STORAGE_*` en `.env` (`STORAGE_TYPE`, `S3_BUCKET` / `GCS_BUCKET`, `STORAGE_PATH`, `STORAGE_PUBLIC_READ`, … — añade el sufijo `__<KEY>` a cualquiera de ellas para una fuente con nombre), más una declaración `bucket("<key>")` en `backend/resources.ts` para cada bucket además del predeterminado, y `export const storageAuthorize` desde `backend/storage.ts`. `storageAuthorize` no tiene forma de variable de entorno a propósito: ninguna variable puede expresar "este usuario puede leer esta clave".

**Ejected** — el bloque `storage` en `initializeRebaseBackend({ … })`. `storagePolicies` y `storageTriggers` son exclusivos de ejected.

El mapa completo se encuentra en [Backend Overview](/docs/backend/#where-each-option-lives).
:::

El almacenamiento se configura en el bloque `storage` de `initializeRebaseBackend`:

### Almacenamiento local

```typescript no-verify
const backend = await initializeRebaseBackend({
    // ...
    storage: {
        type: "local",
        basePath: "./uploads"   // Directory for file storage
    }
});
```

El almacenamiento local guarda los metadatos de cada objeto junto a él, como `<key>.metadata.json`, por lo que una clave cuyo último segmento termine en `.metadata.json` se rechaza con `400 INVALID_STORAGE_KEY` en todas las rutas. S3 y GCS guardan los metadatos en el objeto y almacenan cualquier clave. En un sistema de archivos que no distingue entre mayúsculas y minúsculas (macOS y Windows por defecto), `Avatar.png` y `avatar.png` son un solo archivo local, pero dos objetos en S3, GCS o un disco Linux, por lo que el servidor advierte durante el arranque cuando la carpeta de almacenamiento está en uno de ellos.

### Almacenamiento S3

```typescript no-verify
const backend = await initializeRebaseBackend({
    // ...
    storage: {
        type: "s3",
        bucket: env.S3_BUCKET!,
        region: env.S3_REGION || "auto",
        accessKeyId: env.S3_ACCESS_KEY_ID || "",
        secretAccessKey: env.S3_SECRET_ACCESS_KEY || "",
        endpoint: env.S3_ENDPOINT,          // For MinIO, R2, etc.
        forcePathStyle: env.S3_FORCE_PATH_STYLE  // Required for MinIO
    }
});
```

### Almacenamiento GCS / Firebase

```typescript no-verify
const backend = await initializeRebaseBackend({
    // ...
    storage: {
        type: "gcs",
        bucket: env.GCS_BUCKET!,
        projectId: env.GCS_PROJECT_ID,
    }
});
```

En GCP (Cloud Run, GCE, GKE), las credenciales de la cuenta de servicio predeterminada se utilizan automáticamente. Fuera de GCP, configure la variable de entorno `GOOGLE_APPLICATION_CREDENTIALS` con la ruta del archivo de clave de su cuenta de servicio.

### Múltiples backends de almacenamiento

Puede configurar múltiples backends con nombre y enrutar diferentes campos a diferentes almacenamientos:

```typescript
storage: {
    "(default)": { type: "local", basePath: "./uploads" },
    "media": { type: "s3", bucket: "media-bucket", region: "us-east-1", ... }
}
```

Luego apunte una columna de almacenamiento a un backend específico con `source`:

```typescript
image: col.storage({ path: "products/", source: "media" }),  // Routes to the "media" S3 backend
```

## Endpoints de almacenamiento

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/storage/upload` | Subida directa de archivos, un único cuerpo `multipart/form-data`: `file` (obligatorio); `key`, la clave del objeto, carpetas incluidas (`author_pictures/ada.jpg`), de lo contrario el nombre del archivo en la raíz; `bucket`, de lo contrario el predeterminado; `storageId`; `collection` y `property`, que restringen el archivo al `maxSize` y `acceptedFiles` de esa propiedad; y `metadata_<name>` para metadatos personalizados. Cualquier otro campo se ignora: no hay campo `path` |
| `POST` | `/api/storage/upload?storageId=<key>` | Subir a un backend con nombre específico |
| `GET` | `/api/storage/file/*` | Recuperar un archivo — todo lo que sigue a `/file/` es la clave del objeto |
| `GET` | `/api/storage/file/*?storageId=<key>` | Recuperar un archivo de un backend específico |
| `GET` | `/api/storage/metadata/*` | Tamaño, tipo de contenido y metadatos personalizados de un objeto, sin sus bytes, más un token de descarga de corta duración si es privado |
| `POST` | `/api/storage/metadata` | Lo mismo para hasta 100 objetos de una fuente: cuerpo `{ keys, storageId? }` |
| `DELETE` | `/api/storage/file/*` | Eliminar un archivo |
| `GET` | `/api/storage/list` | Listar objetos bajo un prefijo (`prefix`, `bucket`, `maxResults`, `pageToken`, `storageId`). Un `maxResults` inferior a 1, o un `pageToken` que la fuente nunca emitió, devuelve `400 INVALID_LIST_OPTIONS` |
| `POST` | `/api/storage/folder` | Crear un marcador de carpeta vacía |
| `GET` | `/api/storage/sources` | Las fuentes de almacenamiento que este backend sirve, por clave |
| `OPTIONS` | `/api/storage/tus` | Consultar las capacidades admitidas del protocolo TUS |
| `POST` | `/api/storage/tus` | Iniciar una sesión de subida reanudable TUS |
| `HEAD` | `/api/storage/tus/:id` | Comprobar el progreso de subida (desplazamiento de bytes / byte offset) |
| `PATCH` | `/api/storage/tus/:id` | Anexar fragmento de datos al archivo temporal |
| `DELETE` | `/api/storage/tus/:id` | Terminar/cancelar sesión de subida TUS |

**Qué responden.** Una envoltura (envelope), la misma que usa `/api/data`: la carga útil está bajo `data`, y un fallo es `{ "error": { message, code, requestId } }` con los códigos en la [referencia de errores](/docs/backend/errors/). `/api/storage/file/*` es la excepción, porque su carga útil es el archivo — responde con los bytes, junto con `Content-Type`, `Content-Length` y las cabeceras de caché.

```json
// GET /api/storage/list?prefix=products/images/
{ "data": { "items": [ { "bucket": "default", "fullPath": "products/images/a.jpg", "name": "a.jpg",
  "size": 48213, "updated": "2026-10-01T12:00:00.000Z", "contentType": "image/jpeg" } ], "prefixes": [] } }
```

Un listado describe cada archivo que devuelve: su `size` en bytes y `updated`, cuándo se escribió por última vez, en almacenamiento local, S3 y GCS, y su `contentType` en almacenamiento local y GCS. Un listado de S3 no incluye el tipo, por lo que en S3 está ausente y `/api/storage/metadata/*` aún lo indica. Una carpeta en `prefixes` no incluye ninguno de ellos, ni tampoco un `StorageController` personalizado que no los configure.

`POST /api/storage/upload` responde `201` con el `{ key, bucket, storageUrl }` del objeto almacenado bajo `data`; `GET /api/storage/metadata/*` con los metadatos del objeto y, para un objeto privado, el `token` de corta duración; `POST /api/storage/metadata` con un objeto indexado por las rutas enviadas, conteniendo cada una lo que el `GET` habría respondido para ella (ver más abajo). Una carpeta no es un objeto: `/metadata` en una clave que termina en `/` devuelve `404` en cualquier almacenamiento, incluso donde S3 o GCS mantengan un marcador `folder/`, por lo que no se genera ningún token de descarga para un prefijo; `GET /api/storage/sources` devuelve el array de fuentes configuradas, con `configured: true`. En un despliegue sin almacenamiento alguno, responde `200 {"data": [], "configured": false}`, mientras que cualquier otra ruta responde `501 STORAGE_NOT_CONFIGURED`. `GET /api/auth/config` informa el mismo hecho como `storage: false`, para que un cliente pueda omitir la consulta. `GET /api/storage/sources` es público: responde sin un token incluso cuando `requireAuth` está activado. Nombra las fuentes (su clave, motor, transporte y etiqueta) y nunca un archivo, y el SDK cliente lo lee para configurar sus fuentes, lo que puede ocurrir antes de que alguien inicie sesión. Una aplicación que lee una fuente `direct` de forma anónima también lo necesita. Cada ruta que lista, lee o escribe un archivo conserva su autenticación. `DELETE /api/storage/file/*` y `POST /api/storage/folder` solo devuelven un `message`, ya que no hay nada más que retornar.

En S3 y GCS, un `bucket` debe ser uno de los que la fuente sirve, tanto en escrituras como en lecturas: una subida, un `POST /api/storage/folder` o una subida TUS que especifique cualquier otro bucket responderá `404 UNKNOWN_STORAGE_SOURCE`, al igual que el listado. El almacenamiento local sigue creando un bucket en su primera escritura.

**Muchos objetos a la vez.** `POST /api/storage/metadata` recibe `{ "keys": ["photos/a.png", "photos/b.png"], "storageId": "media" }` — hasta 100 rutas de objetos de una misma fuente, escritas como las recibe `GET /api/storage/metadata/<key>` — y responde con una entrada por clave:

```json
{ "data": {
  "photos/a.png": { "fullPath": "photos/a.png", "size": 48213, "contentType": "image/png", "token": "…", "tokenExpiresIn": 300 },
  "photos/b.png": { "error": { "code": "FORBIDDEN", "message": "Not authorized for this object", "status": 403 } }
} }
```

Cada clave se evalúa exactamente igual que en el `GET` — el mismo hook `storageAuthorize` y ámbito de almacenamiento, la misma regla pública, un token de descarga propio — y una clave que sea rechazada, falte o esté mal formada responde con su propio `error` sin fallar ni exponer a las demás. Un llamador sin sesión en un despliegue que la requiera recibe el `401` que respondería el `GET`, a menos que todas las claves sean públicas. Más de 100 claves, o un cuerpo sin `keys`, resulta en `400 BAD_REQUEST`. El limitador de tasa cuenta la solicitud como ⌈N/10⌉ solicitudes para N claves, por lo que una página de 100 miniaturas cuesta 10. `client.storage.getSignedUrl()` y el panel de administración envían las búsquedas que realiza una página juntas de esta manera, y recurren a un `GET` por archivo en un servidor sin esta ruta.

**Cómo se autoriza la lectura de un archivo.** Las rutas de lectura — `/api/storage/file/*` y `/api/storage/metadata/*` — aceptan el token firmado de corta duración que genera [`getSignedUrl()`](/docs/sdk/storage), pasado como `?token=<token>` o como `Bearer`. Un JWT de acceso ordinario es **rechazado** en `/file/*` con `401 Unauthorized: Access JWT not allowed on file routes`: el token que funciona en todas las demás rutas no funciona allí, a propósito, porque la URL de un archivo es algo que se entrega a un navegador, a una CDN o a una etiqueta `<img>`. Todas las demás filas anteriores aceptan el JWT de acceso como de costumbre.

## Transformaciones de imágenes al vuelo

Rebase incluye un pipeline integrado de procesamiento de imágenes impulsado por **Sharp**. Al servir activos de imagen desde el almacenamiento, puede aplicar operaciones dinámicas mediante parámetros de consulta:

```bash
# Serve image scaled to 300px width in webp format
GET /api/storage/file/products/laptop.jpg?width=300&format=webp
```

### Parámetros admitidos

- `width`, `height`: Límites de redimensionamiento, `1`–`4096` (la imagen nunca se amplía).
- `quality`: `1`–`100`.
- `format`: Convierte el formato de la imagen. Formatos admitidos: `webp`, `jpeg`, `png`, `avif`.
- `fit`: `cover`, `contain`, `fill`, `inside` u `outside`.

Un parámetro fuera de estos límites devuelve un **400**, no un valor ajustado silenciosamente — `?width=99999` solía devolver una imagen de 4096px y `?format=tiff` una en webp, y ninguno advertía sobre ello.

Las miniaturas de imágenes almacenadas en el panel de administración utilizan este endpoint: la vista previa de una tabla o tarjeta solicita una reproducción en webp de aproximadamente el doble de su tamaño renderizado (96–800px) en lugar del original. Los archivos SVG y GIF se muestran siempre tal cual son. `sharp` es opcional: sin él, una solicitud de transformación recibe el original y el backend emite una advertencia recomendando ejecutar `pnpm add sharp` en `backend/`.

### Rendimiento y caché LRU

La transformación consume mucha CPU y memoria, y en un objeto público se puede acceder al endpoint de forma anónima, por lo que el trabajo está limitado en lugar de solo almacenarse en caché:
- **Capacidad**: un LRU limitado a **500 entradas** globalmente, indexado por fuente de almacenamiento, bucket y clave canónica.
- **TTL (Tiempo de vida)**: Las variantes en caché caducan después de **1 hora**.
- Las solicitudes simultáneas para la misma variante no almacenada en caché producen **una sola** transformación, no una por cada una.
- Se ejecuta un número reducido de transformaciones a la vez; más allá de una acumulación limitada, el servidor responde **503 `TRANSFORM_OVERLOADED`** en lugar de aceptar trabajo que no podrá procesar.

Esa caché reside en el proceso, lo que significa que no se comparte entre instancias y no sobrevive a un reinicio. Dos réplicas calculan cada una cada variante, y un despliegue descarta todo su contenido.

### Reproducciones que sobreviven a un reinicio

`storageRenditionCache` escribe cada imagen derivada de vuelta en el mismo bucket que su fuente, por lo que el trabajo se realiza una sola vez para todo el despliegue en lugar de una vez por instancia y versión:

```ts
storageRenditionCache: { enabled: true }
```

o `STORAGE_RENDITION_CACHE=true` para un despliegue agrupado (bundle). Las reproducciones se almacenan bajo el prefijo reservado `_rebase/renditions/`, indexadas por la versión del objeto de origen — de modo que reemplazar una imagen sirve la nueva inmediatamente.

Tres aspectos que debe saber antes de activarlo:

- **Una lectura ahora escribe.** Cada nueva variante cuesta un `PUT` en su bucket. Está desactivado de forma predeterminada por esa razón.
- **Una escritura fallida no es una solicitud fallida.** Credenciales de solo lectura o una política de bucket que rechace el prefijo degradan a la caché en proceso; la imagen se sigue sirviendo y el motivo se registra en los logs una sola vez.
- **Las reproducciones reemplazadas no se recolectan.** Sustituir un objeto de origen abandona sus reproducciones antiguas. Configure una regla de ciclo de vida en `_rebase/renditions/` — ese prefijo es fijo y no configurable, precisamente para que una regla pueda hacer referencia a él.

El prefijo no es accesible desde la API. Leerlo o escribirlo directamente responde **400 `INVALID_STORAGE_KEY`**: cada regla de acceso en el producto — tanto `storageAuthorize` como las políticas declarativas — está escrita contra la clave de *origen*, y una reproducción servida bajo su propia ruta respondería a una pregunta que nadie hizo.

`_rebase/maintenance/` está reservado de la misma manera. `rebase storage orphans` guarda el registro de cada escaneo allí, en la fuente que escaneó, de modo que el proceso que ejecuta el escaneo y el que responde a su estado lean el mismo registro. Un llamador que pudiera escribir un registro podría elegir qué eliminará un borrado posterior, por lo que leer, escribir o listar este prefijo también responde 400. Los registros se eliminan 7 días después de haber sido escritos por última vez, cuando comienza el siguiente escaneo de esa fuente.

### Qué se sirve

El tipo de contenido almacenado es el que haya declarado quien lo subió — nada analiza (sniff) los bytes —, por lo que `/api/storage/file/*` solo renderizará en línea una **lista de permitidos reducida**: imágenes, vídeo, audio, `application/pdf` y `text/plain`. Cualquier otra cosa, incluyendo `text/html`, se sirve como `application/octet-stream` con `Content-Disposition: attachment`, y cada respuesta incluye `X-Content-Type-Options: nosniff`. El almacenamiento no es un servidor web de alojamiento: una página subida y renderizada en el origen de la API puede leer las cookies de ese origen y llamar a sus endpoints.

Un SVG es una imagen que también es un documento, y puede contener `<script>`. Se sirve como `image/svg+xml` — por lo que se renderiza en una etiqueta `<img>` y en las miniaturas del panel de administración — con `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` en cada respuesta, incluidas las URL transformadas y las URL con token de descarga. Al abrirse directamente, se renderiza con los scripts desactivados y un origen opaco, por lo que no puede acceder a las cookies ni a los endpoints de la API.

## Tamaño máximo de archivo

Cada fuente de almacenamiento acepta archivos hasta su propio límite: **50 MB**, a menos que `STORAGE_MAX_FILE_SIZE` (en bytes, con el sufijo `__<KEY>` para una fuente con nombre) o el `maxFileSize` de la fuente indiquen lo contrario. Cada vía de entrada restringe el archivo al mismo límite. `POST /api/storage/upload` responde `413 PAYLOAD_TOO_LARGE` si se excede; una subida reanudable se rechaza durante su creación, antes de su primer fragmento; y `OPTIONS /api/storage/tus` lo anuncia como `Tus-Max-Size` — para la fuente indicada por `?storageId=`, o para la predeterminada en su defecto.

```bash
STORAGE_MAX_FILE_SIZE=209715200          # (default): 200 MB
STORAGE_MAX_FILE_SIZE__MEDIA=1073741824  # media: 1 GB
```

La cantidad de archivo que el servidor mantiene en memoria a la vez depende de la vía de entrada. `POST /api/storage/upload` es un cuerpo multipart único, que el servidor analiza por completo: entre tres y cinco veces el tamaño del archivo en su memoria. Una subida reanudable (TUS) mantiene un fragmento a la vez. `client.storage.putObject()` y el panel de administración envían archivos de más de 8 MiB mediante subida reanudable. Consulte [Subidas reanudables (TUS)](/docs/backend/storage-resumable-uploads/) para ver el protocolo, qué responde y cómo se comporta entre instancias.

## Variables de entorno

| Variable | Descripción |
|----------|-------------|
| `STORAGE_TYPE` | `"local"`, `"s3"` o `"gcs"` |
| `STORAGE_PATH` | Directorio de almacenamiento local (por defecto: `<project>/uploads`, tanto bajo `rebase dev` como en un servidor generado por `rebase eject`). Una ruta relativa se lee desde el directorio en el que se ejecuta el servidor, que después de `rebase eject` es `backend/`. Un bucket local con nombre guarda sus archivos junto a él, en `<STORAGE_PATH>__<key>`, a menos que `STORAGE_PATH__<KEY>` especifique el suyo propio |
| `S3_BUCKET` | Nombre del bucket S3 |
| `S3_REGION` | Región de AWS (por defecto: `"auto"`) |
| `S3_ACCESS_KEY_ID` | Clave de acceso de AWS |
| `S3_SECRET_ACCESS_KEY` | Clave secreta de AWS |
| `S3_ENDPOINT` | Endpoint personalizado de S3 (para MinIO, R2) |
| `S3_FORCE_PATH_STYLE` | Usar URLs de estilo de ruta (path-style, obligatorio para MinIO) |
| `GCS_BUCKET` | Nombre del bucket de Google Cloud Storage |
| `GCS_PROJECT_ID` | ID de proyecto de GCP para GCS |
| `GCS_KEY_FILENAME` | Ruta a un archivo de clave de cuenta de servicio de GCP (omitir en GKE — Workload Identity/ADC proporciona las credenciales) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Variable estándar de ADC, leída por el propio SDK de Google (no es necesaria en GCP con credenciales predeterminadas) |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Tiempo durante el cual funciona la URL de descarga de un archivo privado, en segundos — la vida útil del token que genera `/api/storage/metadata/*` (por defecto `300`, como máximo `604800`, una semana). Auméntelo para vídeos y audios privados, que continúan solicitando rangos después de renderizar la página. La variante en variable de entorno de `storageDownloadTokenTtl` |
| `STORAGE_MAX_FILE_SIZE` | Archivo más grande que acepta la fuente, en bytes (por defecto `52428800`, 50 MB). Sufijo `__<KEY>` para una fuente con nombre. Un valor que no sea un número entero de bytes impedirá el arranque. Consulte [Tamaño máximo de archivo](#tamaño-máximo-de-archivo) |
| `FORCE_LOCAL_STORAGE` | Permitir `STORAGE_TYPE=local` en producción — ver más abajo |
| `STORAGE_PUBLIC_READ` | Servir objetos almacenados a lectores no autenticados. La variante en variable de entorno de `storagePublicRead`, y una de las tres formas de satisfacer la [protección de arranque en producción](#autorización-por-objeto). |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Desactivar la protección de arranque, restaurando el comportamiento donde cualquier usuario autenticado puede leer, sobrescribir, eliminar o listar cualquier clave. La variante en variable de entorno de `storageInsecureAllowAnyAuthenticated`. Solo justificable cuando se confía en todos los usuarios autenticados para cada archivo. |

## Múltiples buckets

Un proyecto puede tener más de un bucket. Declare cada uno en `backend/resources.ts` — el único lugar que la plataforma, el runtime y la consola leen:

```ts
import { bucket } from "@rebasepro/types";

export const uploads = bucket({ engine: "s3" });    // the default one
export const media = bucket("media", { engine: "s3", label: "Media" });
```

Luego ejecute `rebase resources --write`, lo que regenera `rebase.resources.json` para que un host pueda leer su topología sin ejecutar una compilación. Consulte [Múltiples fuentes](/docs/backend/multiple-sources) para bases de datos, buckets y topics en conjunto.

Cada fuente se configura a partir de los **mismos nombres de variables llevando su propio sufijo**. La fuente predeterminada no lleva sufijo, por lo que un proyecto con un solo bucket continúa usando los nombres simples anteriores y no necesita declarar nada en absoluto, y declarar buckets con nombre junto a ella no los altera ([detalles](/docs/backend/multiple-sources/#which-bucket-receives-an-unqualified-upload)):

```bash
S3_BUCKET=app-uploads             # (default)
S3_BUCKET__MEDIA=app-media        # media
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

El sufijo se deriva de la clave: en mayúsculas, los caracteres no alfanuméricos se convierten en guiones bajos, tras un guion bajo **doble** (`media-cdn` → `__MEDIA_CDN`). Un solo guion bajo colisionaría con nombres de variables reales — `S3_BUCKET_NAME` se interpretaría como el bucket `name`.

Enrute una columna a una fuente con `source`:

```ts
cover: col.storage({ path: "covers/", source: "media", accept: ["image/*"] }),
```

Una fuente que declare pero nunca configure se **omite**, no es un error fatal: las subidas dirigidas a ella responden `501 STORAGE_SOURCE_NOT_CONFIGURED`. La declaración de un bucket suele ocurrir antes de que se le asocie un almacenamiento, y un error de arranque en ese punto provocaría un bucle de reinicios en el backend hasta que se resolviera. Una fuente que el entorno configure de forma *incorrecta* — un tipo sin bucket, o un bucket sin credenciales — se rechaza en el arranque, ya que se trata de un error y no de una ausencia.

### Buckets que comparten una misma cuenta

Por lo general, las credenciales describen al **proveedor**, no al bucket. De lo contrario, quince buckets en una misma instalación de MinIO requerirían quince copias de la misma clave de acceso, y una rotación implicaría quince ediciones conjuntas. En su lugar, asigne un nombre a la cuenta:

```ts
export const media = bucket("media", { engine: "s3", account: "minio" });
export const avatars = bucket("avatars", { engine: "s3", account: "minio" });
```

```bash
S3_BUCKET__MEDIA=b-media          # per bucket, always
S3_BUCKET__AVATARS=b-avatars
S3_ACCESS_KEY_ID__MINIO=…         # shared by both
S3_SECRET_ACCESS_KEY__MINIO=…
S3_ENDPOINT__MINIO=https://minio.internal
```

Solo las variables con alcance de cuenta tienen valor de reserva (fallback) — `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`, `S3_FORCE_PATH_STYLE`, y el par de GCS `GCS_PROJECT_ID` / `GCS_KEY_FILENAME`. El nombre del bucket nunca lo hace: es lo que distingue una fuente de otra. El valor específico por bucket siempre tiene prioridad, lo que permite que una fuente cambie de proveedor sin afectar a las demás.

### Eliminación periódica programada de archivos que ninguna fila referencia

Al eliminar una fila, sus archivos permanecen en el bucket. Nada se elimina junto con la fila: otra fila, una versión en el [historial](/docs/backend/history/), o su propio código conservando la clave en una cadena simple aún pueden hacer referencia al archivo. En su lugar, un bucket puede solicitar una limpieza capaz de considerar todos estos casos:

```ts
export const voice = bucket("voice", { engine: "s3", orphanSweep: { olderThanHours: 72 } });
export const media = bucket("media", { orphanSweep: true }); // a week, daily at 04:17 UTC
```

Cada barrido declarado es una tarea programada cron, `storage-orphan-sweep-<bucket>` (`storage-orphan-sweep-default` para el bucket predeterminado). Ejecuta el escaneo subyacente de `rebase storage orphans --delete`. Dicho escaneo lee cada fila de cada tabla y cada entrada del historial, y conserva:

- cualquier archivo al que todavía se haga referencia;
- cualquier archivo más reciente que `olderThanHours` (al menos 24, una semana por defecto);
- todos los archivos, en esa ejecución, cuando no se pueda leer una tabla.

Luego vuelve a comprobar cada archivo justo antes de eliminarlo. Establezca `schedule` con una expresión cron (UTC) para cambiar cuándo se ejecuta. Al ser un trabajo cron, se ejecuta en una sola instancia por intervalo. Su historial de ejecuciones registra cuántos archivos eliminó y conservó, y puede pausarse o ejecutarse manualmente desde la lista de cron del administrador. Requiere un bucket servido por este backend: un bucket con `transport: "direct"` se rechaza en el arranque con una advertencia.

## Fuentes de almacenamiento en el frontend

El frontend obtiene las fuentes del servidor mediante `GET /api/storage/sources`, por lo que una fuente de tipo `server` no necesita ninguna entrada. Pase `storageSources` al proveedor `<Rebase>` para una fuente `direct`, que sube directamente a su proveedor, o para configurar usted mismo una etiqueta o transporte:

```tsx
import { Rebase } from "@rebasepro/app";

<Rebase
    apiUrl="https://api.example.com"
    storageSources={[
        // `engine` names the provider, `transport` says who talks to it:
        // "server" proxies through the Rebase backend, "direct" goes
        // client-to-provider (and needs a `source` implementation).
        { key: "media", engine: "s3", transport: "server", label: "Media CDN" },
        { key: "firebase", engine: "firebase", transport: "server", label: "Firebase Storage" },
    ]}
>
    {() => <MyApp />}
</Rebase>
```

La `key` de una fuente `server` debe coincidir con una clave de backend registrada en el mapa `storage` del servidor. El contexto de React `StorageSourcesContext` resuelve la fuente activa para cada campo de subida.

## Caché y CDNs

Cada objeto se redirige a través de un proxy en el servidor, con un `ETag` para una revalidación económica, un `Cache-Control` que depende de quién pueda leerlo y rangos de bytes para la reproducción y navegación en audio y vídeo. [Caché de almacenamiento y CDNs](/docs/backend/storage-caching/) detalla las cabeceras y qué configurar en una CDN intermediaria.

## Consejos para producción

:::caution
**En producción, `type: "local"` desactiva el almacenamiento de archivos en lugar de utilizarlo.** En una plataforma efímera (Cloud Run, Heroku, un pod de Kubernetes), el sistema de archivos se borra en cada despliegue, reinicio y expulsión (eviction), por lo que las subidas tendrían éxito, se leerían correctamente y desaparecerían en la siguiente actualización sin emitir ningún error.

Por tanto, el valor predeterminado local no se registra, y cualquier solicitud a `/api/storage/*` que no especifique una fuente de almacenamiento responde **`501 STORAGE_NOT_CONFIGURED`**, enumerando las fuentes que sí se sirven. Una fuente con nombre que esté configurada, como `bucket("media", { engine: "s3" })`, sigue funcionando con normalidad. Las subidas fallan de forma visible y recuperable; el resto de la aplicación continúa operando. El almacenamiento de archivos es opcional (opt-in) en producción: existe solo una vez que existe un bucket.

Configure `STORAGE_TYPE=s3` o `gcs`. Si un **volumen duradero** contiene realmente `STORAGE_PATH`, configure `FORCE_LOCAL_STORAGE=true` para indicarlo explícitamente. Móntelo sobre el directorio principal de `STORAGE_PATH`, de modo que el directorio `<STORAGE_PATH>__<key>` de cada bucket local con nombre también se encuentre en él.
:::

- Monte un **volumen persistente** sobre el directorio principal de `STORAGE_PATH` si usa almacenamiento local en Docker/Kubernetes, y configure `FORCE_LOCAL_STORAGE=true` — consulte [Autohospedaje](/docs/deployment/self-hosting/#file-storage)
- Utilice **S3** o compatible (R2, MinIO), o **GCS**, para despliegues en producción
- Configure una **CDN** (CloudFront, Cloudflare) delante para mejorar el rendimiento — consulte [Poner una CDN por delante](/docs/backend/storage-caching/#putting-a-cdn-in-front)
- **Cualquier aplicación con almacenamiento en producción debe declarar un modelo de acceso** — consulte [Autorización de almacenamiento](/docs/backend/storage-authorization/). No solo las multi-inquilino (multi-tenant): el servidor *se negará a arrancar* sin uno.

## Autorización por objeto

Quién puede leer, escribir, eliminar o listar cada clave se decide mediante `storagePolicies` y el hook `storageAuthorize`, y una clave de API también necesita el alcance de almacenamiento correspondiente para la operación. En producción, el servidor se negará a arrancar si hay almacenamiento configurado sin un modelo de acceso. Consulte [Autorización de almacenamiento](/docs/backend/storage-authorization/).

## Reaccionar a una subida

Cualquier otra escritura en Rebase permite reaccionar ante ella — una fila tiene `beforeSave` y `afterSave`, una programación tiene un trabajo cron —, mientras que una subida no tenía nada. Cualquier acción secundaria que una subida implicara debía ser realizada por el cliente en una segunda llamada, lo que significaba que no se ejecutaba si el cliente se desconectaba en el intervalo.

```ts
storageTriggers: [
    {
        path: "uploads/:uid/**",
        events: ["finalize"],
        handler: async ({ key, params, size, user }) => {
            await indexUpload.enqueue({ key, uid: params.uid, size }); // a `queue()` in backend/resources.ts
        }
    }
]
```

El lenguaje de patrones es el mismo que en `storagePolicies` — segmentos literales, `*` para un segmento, `:name` para capturar uno, `**` para el resto — y un patrón mal formado provoca un fallo en el arranque en lugar de omitir la coincidencia silenciosamente.

| Evento | Cuándo |
| --- | --- |
| `finalize` | después de que el objeto se haya escrito de forma duradera; nunca para una escritura que haya fallado |
| `delete` | después de que el objeto haya sido eliminado |

`finalize` se dispara tanto para las rutas multipart como para las reanudables (TUS) — una vez por subida, no una vez por fragmento —, y una subida reanudable reporta al usuario que la *creó*, ya que ese es el sujeto (principal) verificado durante la autorización.

Lo que un manejador no debe asumir:

- **Un manejador que lance un error no hace fallar la solicitud.** El objeto ya está almacenado en el momento en que se ejecuta, por lo que responder al cliente con un error indicaría que la subida falló cuando no fue así, y los clientes reintentan las subidas. Los fallos se registran en los logs y la respuesta permanece inalterada. Si el trabajo debe realizarse obligatoriamente, encole una tarea.
- **Los manejadores se esperan (await)**, en orden de declaración, antes de enviar la respuesta — disparar y olvidar (fire-and-forget) dejaría una promesa que un entorno serverless podría congelar a mitad de ejecución. Por tanto, un manejador lento se traduce en una subida lenta, lo que constituye otra razón para encolar trabajo en lugar de procesarlo aquí.
- **Las escrituras internas no disparan triggers.** La caché de reproducciones de imágenes escribe los objetos derivados directamente en el controlador de almacenamiento; un trigger con `**` que se activara con ellos se estaría disparando sobre su propia salida.

## Pasos siguientes

- **[Frontend Storage & File Uploads](/docs/frontend/storage)** — Campos de subida de archivos y hooks
- **[Columnas](/docs/schema/columns/#storage-columns)** — `col.storage()` y sus opciones
