---
sourceHash: 5be4e3768bac692e
title: Configuración de Storage
sidebar_label: Configuración de Storage
description: Configura backends de sistema de archivos local, compatibles con S3 o GCS/Firebase Storage para subidas de archivos, imágenes y medios.
---

## Descripción general

Rebase admite tres backends de almacenamiento (storage):

- **Sistema de archivos local** — Archivos almacenados en disco (ideal para desarrollo)
- **Compatible con S3** — AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces
- **Google Cloud Storage / Firebase Storage** — Soporte nativo de GCS mediante `@google-cloud/storage`

## Configuración

:::note[Dónde va esto]
**Runtime gestionado** — las variables `STORAGE_*` en `.env` (`STORAGE_TYPE`, `STORAGE_BUCKET` o `S3_BUCKET` / `GCS_BUCKET`, `STORAGE_PATH`, `STORAGE_PUBLIC_READ`, … — añade el sufijo `__<KEY>` a cualquiera de ellas para un origen con nombre), más una declaración `bucket("<key>")` en `config/resources.ts` para cada bucket además del predeterminado, y `export const storageAuthorize` desde `config/index.ts`. `storageAuthorize` no tiene una variante en variable de entorno a propósito: ninguna variable puede expresar "este usuario puede leer esta clave".

**Ejected** — el bloque `storage` en `initializeRebaseBackend({ … })`. `storagePolicies` y `storageTriggers` son exclusivos del modo ejected.

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

El almacenamiento local guarda los metadatos de cada objeto junto a él, como `<key>.metadata.json`, por lo que una clave cuyo último segmento termine en `.metadata.json` se rechaza con `400 INVALID_STORAGE_KEY` en todas las rutas. S3 y GCS guardan los metadatos en el propio objeto y almacenan cualquier clave. En un sistema de archivos que no distingue mayúsculas de minúsculas (case-insensitive, como macOS y Windows por defecto), `Avatar.png` y `avatar.png` son un único archivo local pero dos objetos en S3, GCS o un disco Linux, por lo que el servidor advierte durante el arranque si la carpeta de almacenamiento se encuentra en uno de ellos.

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

### GCS / Firebase Storage

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

En GCP (Cloud Run, GCE, GKE), las credenciales de la cuenta de servicio predeterminada se utilizan automáticamente. Fuera de GCP, establece la variable de entorno `GOOGLE_APPLICATION_CREDENTIALS` con la ruta al archivo de clave de tu cuenta de servicio.

### Múltiples backends de almacenamiento

Puedes configurar múltiples backends con nombre y enrutar diferentes campos a diferentes almacenamientos:

```typescript
storage: {
    "(default)": { type: "local", basePath: "./uploads" },
    "media": { type: "s3", bucket: "media-bucket", region: "us-east-1", ... }
}
```

Luego, en las propiedades de tu colección, haz referencia a un backend específico:

```typescript
image: {
    type: "string",
    name: "Image",
    storage: {
        storagePath: "products",
        storageSource: "media"  // Routes to the "media" S3 backend
    }
}
```

## Endpoints de Storage

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/storage/upload` | Subida directa de archivos |
| `POST` | `/api/storage/upload?storageId=<key>` | Subida a un backend específico con nombre |
| `GET` | `/api/storage/file/*` | Recuperar un archivo — todo lo que sigue a `/file/` es la clave del objeto |
| `GET` | `/api/storage/file/*?storageId=<key>` | Recuperar un archivo desde un backend específico |
| `GET` | `/api/storage/metadata/*` | Tamaño, tipo de contenido y metadatos personalizados de un objeto, sin sus bytes, más un token de descarga de corta duración cuando es privado |
| `POST` | `/api/storage/metadata` | <span class="since-badge" data-since="0.25">Desde 0.25</span> Lo mismo para hasta 100 objetos de un mismo origen: cuerpo `{ keys, storageId? }` |
| `DELETE` | `/api/storage/file/*` | Eliminar un archivo |
| `GET` | `/api/storage/list` | Listar objetos bajo un prefijo (`prefix`, `bucket`, `maxResults`, `pageToken`, `storageId`). Un `maxResults` menor a 1, o un `pageToken` que el origen nunca emitió, devuelve `400 INVALID_LIST_OPTIONS` |
| `POST` | `/api/storage/folder` | Crear un marcador de carpeta vacía |
| `GET` | `/api/storage/sources` | Los orígenes de almacenamiento que sirve este backend, por clave |
| `OPTIONS` | `/api/storage/tus` | Consultar las capacidades admitidas del protocolo TUS |
| `POST` | `/api/storage/tus` | Iniciar una sesión de subida reanudable con TUS |
| `HEAD` | `/api/storage/tus/:id` | Comprobar el progreso de subida (desplazamiento en bytes) |
| `PATCH` | `/api/storage/tus/:id` | Añadir un fragmento de datos al archivo temporal |
| `DELETE` | `/api/storage/tus/:id` | Terminar/cancelar la sesión de subida TUS |

**Qué devuelven.** Una única envoltura (envelope), la misma que utiliza `/api/data`: la carga útil
está bajo `data`, y un fallo es `{ "error": { message, code, requestId } }`
con los códigos de la [referencia de errores](/docs/backend/errors/). `/api/storage/file/*`
es la excepción, porque su carga útil es el archivo en sí: responde con los bytes, junto con
`Content-Type`, `Content-Length` y las cabeceras de caché.

```json
// GET /api/storage/list?prefix=products/images/
{ "data": { "items": [ { "bucket": "default", "fullPath": "products/images/a.jpg", "name": "a.jpg",
  "size": 48213, "updated": "2026-10-01T12:00:00.000Z", "contentType": "image/jpeg" } ], "prefixes": [] } }
```

<span class="since-badge" data-since="0.25">Desde 0.25</span> Un listado describe cada archivo que retorna: su `size` en bytes y
`updated`, cuándo se escribió por última vez, en almacenamiento local, S3 y GCS, y su
`contentType` en almacenamiento local y GCS. Un listado de S3 no incluye el tipo,
por lo que en S3 está ausente y `/api/storage/metadata/*` sigue indicándolo. Una carpeta en
`prefixes` no incluye ninguno de ellos, ni tampoco un `StorageController` personalizado que
no los establezca.

`POST /api/storage/upload` responde `201` con el `{ key, bucket, storageUrl }` del objeto almacenado bajo `data`;
`GET /api/storage/metadata/*` devuelve los metadatos del objeto y, para un objeto privado, el `token` de corta duración; `POST
/api/storage/metadata` devuelve un objeto cuyas claves son las rutas enviadas, conteniendo cada una lo que el `GET` habría respondido
para ella (ver más abajo). Una carpeta no es un objeto: `/metadata` en una clave que termina en `/` es `404` en todos los almacenamientos, incluso donde S3
o GCS mantienen un marcador `folder/`, por lo que no se genera ningún token de descarga para un prefijo; `GET /api/storage/sources` devuelve el array de
orígenes configurados, con `configured: true`. En un despliegue sin ningún almacenamiento configurado, responde `200 {"data": [],
"configured": false}`, mientras que cualquier otra ruta responde `501 STORAGE_NOT_CONFIGURED`. `GET /api/auth/config` reporta
el mismo hecho como `storage: false`, de modo que un cliente puede omitir la consulta. `GET /api/storage/sources` es público: responde
sin un token incluso cuando `requireAuth` está activado. Informa el nombre de los orígenes (su clave, motor, transporte y etiqueta) y nunca
un archivo, y el SDK del cliente lo lee para conectar sus orígenes, lo cual puede ocurrir antes de que alguien inicie sesión. Una aplicación que
lee un origen `direct` de forma anónima también lo necesita. Cada ruta que lista, lee o escribe un archivo conserva su autenticación.
`DELETE /api/storage/file/*` y `POST /api/storage/folder` devuelven únicamente un `message`, ya que no hay nada que retornar.

En S3 y GCS, un `bucket` debe ser uno de los que sirve el origen, tanto en escrituras
como en lecturas: una subida, un `POST /api/storage/folder` o una subida TUS que nombre cualquier otro
bucket responde `404 UNKNOWN_STORAGE_SOURCE`, tal como lo hace el listado. El almacenamiento local
sigue creando un bucket en su primera escritura.

**Muchos objetos a la vez.** <span class="since-badge" data-since="0.25">Desde 0.25</span> `POST /api/storage/metadata` recibe
`{ "keys": ["photos/a.png", "photos/b.png"], "storageId": "media" }` — hasta 100
rutas de objetos de un origen, cada una especificada como la recibe `GET /api/storage/metadata/<key>` —
y responde con una entrada por clave:

```json
{ "data": {
  "photos/a.png": { "fullPath": "photos/a.png", "size": 48213, "contentType": "image/png", "token": "…", "tokenExpiresIn": 300 },
  "photos/b.png": { "error": { "code": "FORBIDDEN", "message": "Not authorized for this object", "status": 403 } }
} }
```

Cada clave se evalúa exactamente igual a como la evalúa el `GET` — el mismo
hook `storageAuthorize` y ámbito de almacenamiento, la misma regla pública, un token de descarga propio — y una
clave que sea rechazada, inexistente o mal formada responde con su propio `error` sin fallar
ni revelar las demás. Un llamador sin sesión en un despliegue que requiere
una obtiene el `401` que respondería el `GET`, a menos que todas las claves sean públicas. Más de
100 claves, o un cuerpo sin `keys`, devuelve `400 BAD_REQUEST`. El limitador de tasa cuenta
la solicitud como ⌈N/10⌉ solicitudes para N claves, por lo que una página de 100 miniaturas cuesta 10.
`client.storage.getSignedUrl()` y el panel de administración envían las búsquedas que realiza una página
agrupadas de esta forma, recurriendo a un `GET` por archivo en un servidor sin esta ruta.

**Cómo se autoriza la lectura de un archivo.** Las rutas de lectura — `/api/storage/file/*` y
`/api/storage/metadata/*` — aceptan el token firmado de corta duración que
emite [`getSignedUrl()`](/docs/sdk/storage), pasado como `?token=<token>` o como
un `Bearer`. Un JWT de acceso ordinario es **rechazado** en `/file/*` con `401
Unauthorized: Access JWT not allowed on file routes`: el token que funciona en
todas las demás rutas no funciona allí, a propósito, porque la URL de un archivo es
algo que se entrega a un navegador, una CDN o una etiqueta `<img>`. Cada una de las demás filas anteriores
acepta el JWT de acceso como de costumbre.

## Transformaciones de imágenes al vuelo

Rebase incluye un pipeline de procesamiento de imágenes integrado impulsado por **Sharp**. Al servir recursos de imagen desde el almacenamiento, puedes aplicar operaciones dinámicas mediante parámetros de consulta:

```bash
# Serve image scaled to 300px width in webp format
GET /api/storage/file/products/laptop.jpg?width=300&format=webp
```

### Parámetros admitidos

- `width`, `height`: Límites de redimensionamiento, de `1` a `4096` (la imagen nunca se amplía).
- `quality`: `1`–`100`.
- `format`: Convierte el formato de la imagen. Formatos admitidos: `webp`, `jpeg`, `png`, `avif`.
- `fit`: `cover`, `contain`, `fill`, `inside` o `outside`.

Un parámetro fuera de estos límites devuelve un **400**, no un valor ajustado silenciosamente —
`?width=99999` solía retornar una imagen de 4096px y `?format=tiff` una en webp, y
ninguno lo advertía.

Las miniaturas de imágenes almacenadas en el panel de administración utilizan este endpoint: la vista previa
en tabla o tarjeta solicita una reproducción webp de aproximadamente el doble de su tamaño renderizado (96–800px)
en lugar del original. `sharp` es una dependencia opcional; sin ella, la
transformación responde 500, por lo que el panel comprueba una vez por carga de página, con una sola
solicitud de reproducción, y muestra los originales si el servidor no puede redimensionar. Los archivos
SVG y GIF siempre se muestran tal como son.

### Rendimiento y caché LRU

La transformación consume mucha CPU y memoria, y en un objeto público el endpoint es
accesible anónimamente, por lo que el trabajo está delimitado en lugar de simplemente almacenado en caché:
- **Capacidad**: una LRU limitada a **500 entradas** a nivel global, indexada por origen de almacenamiento,
  bucket y clave canónica.
- **TTL (Time to Live)**: Las variantes en caché caducan tras **1 hora**.
- Las solicitudes concurrentes para la misma variante no almacenada en caché producen **una** transformación,
  no una por cada solicitud.
- Se ejecuta un número reducido de transformaciones a la vez; más allá de un backlog delimitado, el servidor
  responde **503 `TRANSFORM_OVERLOADED`** en lugar de aceptar trabajo que no podrá atender.

Esa caché reside en el proceso, lo que significa que no se comparte entre instancias
y no sobrevive a un reinicio. Dos réplicas calculan cada una cada variante, y un
despliegue descarta todo su contenido.

### Rendiciones que sobreviven a un reinicio

`storageRenditionCache` vuelve a escribir cada imagen derivada en el mismo bucket que su
origen, de modo que el trabajo se realiza una vez para todo el despliegue en lugar de una vez por
instancia por release:

```ts
storageRenditionCache: { enabled: true }
```

o `STORAGE_RENDITION_CACHE=true` para un despliegue mediante bundle. Las rendiciones se almacenan
bajo el prefijo reservado `_rebase/renditions/`, indexadas por la versión del objeto de origen —
por lo que reemplazar una imagen sirve la nueva inmediatamente.

Tres cosas a tener en cuenta antes de activarlo:

- **Una lectura ahora escribe.** Cada nueva variante cuesta un `PUT` en tu bucket. Por
  esa razón está desactivado de forma predeterminada.
- **Una escritura fallida no es una solicitud fallida.** Credenciales de solo lectura, o una política
  de bucket que rechace el prefijo, degradan a la caché en proceso; la imagen
  se sigue sirviendo y el motivo se registra una sola vez en los logs.
- **Las rendiciones reemplazadas no se recolectan.** Reemplazar un objeto de origen
  deja huérfanas sus rendiciones anteriores. Configura una regla de ciclo de vida en `_rebase/renditions/`
  — ese prefijo es fijo y no configurable, precisamente para que una regla pueda nombrarlo.

El prefijo no es direccionable desde la API. Leerlo o escribirlo directamente
devuelve **400 `INVALID_STORAGE_KEY`**: cada regla de acceso en el producto —
tanto `storageAuthorize` como las políticas declarativas — se escribe contra la
clave de *origen*, y una rendición servida bajo su propia ruta respondería a una pregunta
que nadie hizo.

### Qué se sirve

El tipo de contenido almacenado es el que haya declarado quien realizó la subida — nada inspecciona
los bytes —, por lo que `/api/storage/file/*` solo renderizará en línea una **lista de permitidos reducida**:
imágenes, vídeo, audio, `application/pdf` y `text/plain`. Cualquier otra cosa,
incluyendo `text/html`, se sirve como `application/octet-stream` con
`Content-Disposition: attachment`, y cada respuesta incluye
`X-Content-Type-Options: nosniff`. Storage no es un alojamiento web: una página subida
renderizada en el origen de la API puede leer las cookies de ese origen y llamar a sus
endpoints.

Un SVG es una imagen que también es un documento, y puede contener `<script>`. Se sirve
como `image/svg+xml` — por lo que se renderiza en un `<img>` y en las miniaturas del
panel de administración — con
`Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`
en cada respuesta, incluyendo URLs transformadas y URLs con token de descarga. Al abrirse
directamente, se renderiza con los scripts desactivados y un origen opaco, por lo que no puede
acceder a las cookies ni a los endpoints de la API.

## Tamaño máximo permitido para un archivo

Cada origen de almacenamiento acepta archivos hasta su propio límite: **50 MB** a menos que
`STORAGE_MAX_FILE_SIZE` (en bytes, con el sufijo `__<KEY>` para un origen con nombre) o el
`maxFileSize` del origen especifiquen lo contrario. Todas las vías de entrada limitan un archivo al mismo
número. `POST /api/storage/upload` responde `413 PAYLOAD_TOO_LARGE` si se excede; una
subida reanudable se rechaza al crearse, antes de su primer fragmento; y
`OPTIONS /api/storage/tus` lo anuncia como `Tus-Max-Size` — para el origen
especificado por `?storageId=`, o el predeterminado en caso contrario.

Para `STORAGE_MAX_FILE_SIZE`: en la versión 0.23 solo el `maxFileSize` del origen define
el límite, y la variable no se lee.

```bash
STORAGE_MAX_FILE_SIZE=209715200          # (default): 200 MB
STORAGE_MAX_FILE_SIZE__MEDIA=1073741824  # media: 1 GB
```

La cantidad de archivo que el servidor retiene en memoria a la vez depende de la vía de entrada.
`POST /api/storage/upload` es un único cuerpo multipart que el servidor procesa por completo:
de tres a cinco veces el tamaño del archivo en su memoria. Una subida reanudable (TUS) retiene un
fragmento a la vez. <span class="since-badge" data-since="0.25">Desde 0.25</span> `client.storage.putObject()` y el panel de administración envían archivos
mayores a 8 MiB mediante el método reanudable. Consulta
[Subidas reanudables (TUS)](/docs/backend/storage-resumable-uploads/) para conocer el
protocolo, qué responde y cómo se comporta entre instancias.

## Variables de entorno

| Variable | Descripción |
|----------|-------------|
| `STORAGE_TYPE` | `"local"`, `"s3"`, o `"gcs"` |
| `STORAGE_PATH` | Directorio de almacenamiento local (por defecto: `./uploads`). Un bucket local con nombre guarda sus archivos junto a este, en `<STORAGE_PATH>__<key>`, a menos que `STORAGE_PATH__<KEY>` especifique el suyo propio |
| `S3_BUCKET` | Nombre del bucket de S3 |
| `S3_REGION` | Región de AWS (por defecto: `"auto"`) |
| `S3_ACCESS_KEY_ID` | Clave de acceso de AWS |
| `S3_SECRET_ACCESS_KEY` | Clave secreta de AWS |
| `S3_ENDPOINT` | Endpoint personalizado de S3 (para MinIO, R2) |
| `S3_FORCE_PATH_STYLE` | Utilizar URLs de estilo de ruta (path-style, requerido para MinIO) |
| `GCS_BUCKET` | Nombre del bucket de Google Cloud Storage |
| `GCS_PROJECT_ID` | ID del proyecto de GCP para GCS |
| `GCS_KEY_FILENAME` | Ruta a un archivo de clave de cuenta de servicio de GCP (omitir en GKE — Workload Identity/ADC suministra las credenciales) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Variable estándar de ADC, leída por el propio SDK de Google (no requerida en GCP con credenciales predeterminadas) |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Tiempo de validez de la URL de descarga de un archivo privado, en segundos — la vida útil del token que genera `/api/storage/metadata/*` (por defecto `300`, máximo `604800`, una semana). Increméntalo para audio y vídeo privados, que continúan solicitando rangos tras renderizarse la página. Representación en variable de entorno de `storageDownloadTokenTtl` |
| `STORAGE_MAX_FILE_SIZE` | Archivo más grande que acepta el origen, en bytes (por defecto `52428800`, 50 MB). Sufijo `__<KEY>` para un origen con nombre. Un valor que no sea un número entero de bytes rechaza el arranque. Consulta [Tamaño máximo permitido para un archivo](#tamaño-máximo-permitido-para-un-archivo) |
| `FORCE_LOCAL_STORAGE` | Permitir `STORAGE_TYPE=local` en producción — ver más abajo |
| `STORAGE_PUBLIC_READ` | Servir objetos almacenados a lectores no autenticados. Representación en variable de entorno de `storagePublicRead`, y una de las tres formas de satisfacer la [protección de arranque en producción](#autorización-por-objeto). |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Desactivar la protección de arranque, restaurando el comportamiento donde cualquier usuario autenticado puede leer, sobrescribir, eliminar o listar cualquier clave. Representación en variable de entorno de `storageInsecureAllowAnyAuthenticated`. Solo justificable cuando se confía plenamente en cada usuario autenticado para todos los archivos. |

## Varios Buckets

Un proyecto puede tener más de un bucket. Declara cada uno en `config/resources.ts`
— el único lugar que leen la plataforma, el runtime y la consola:

```ts
import { bucket } from "@rebasepro/types";

export const uploads = bucket({ engine: "s3" });    // the default one
export const media = bucket("media", { engine: "s3", label: "Media" });
```

Luego ejecuta `rebase resources --write`, lo que regenera `rebase.resources.json`
para que un host pueda leer tu topología sin necesidad de compilar. Consulta
[Múltiples orígenes](/docs/backend/multiple-sources) para bases de datos, buckets y
tópicos en conjunto.

Cada origen se configura a partir de los **mismos nombres de variable acompañados de su propio
sufijo**. El origen predeterminado no lleva sufijo, por lo que un proyecto con un solo bucket continúa
usando los nombres simples mostrados anteriormente y no necesita declarar absolutamente nada:

```bash
S3_BUCKET=app-uploads             # (default)
S3_BUCKET__MEDIA=app-media        # media
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

El sufijo se deriva de la clave: en mayúsculas, convirtiendo los caracteres no alfanuméricos en
guiones bajos, precedido por un **doble** guion bajo (`media-cdn` → `__MEDIA_CDN`). Un
solo guion bajo colisionaría con variables reales — `S3_BUCKET_NAME`
se interpretaría como el bucket `name`.

Enruta una propiedad a un origen con `storageSource`:

```ts
{
    name: "Cover",
    dataType: "string",
    storage: { storageSource: "media", acceptedFiles: ["image/*"] }
}
```

Un origen que declares pero nunca configures se **omite**, no es un error crítico: las subidas
enrutadas hacia él responden `501 STORAGE_SOURCE_NOT_CONFIGURED`. Declarar un bucket suele
ocurrir antes de que alguien le asigne almacenamiento real, y un error de arranque en ese punto
provocaría un bucle de reinicios en el backend hasta que se hiciese. Un origen que el entorno configure
*incorrectamente* —un tipo sin bucket, o un bucket sin credenciales— se rechaza
al arrancar, ya que eso constituye un error y no una simple ausencia.

### Buckets que comparten una misma cuenta

Las credenciales suelen describir al **proveedor**, no al bucket. Quince buckets en
una misma instalación de MinIO requerirían de lo contrario quince copias de la misma clave de acceso, y
rotarlas implicaría quince pares de modificaciones. Asigna un nombre a la cuenta en su lugar:

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

Solo las variables con ámbito de cuenta admiten el valor alternativo (fallback): `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`, `S3_FORCE_PATH_STYLE`, y
el par de GCS `GCS_PROJECT_ID` / `GCS_KEY_FILENAME`. El nombre del bucket nunca lo hace:
es lo que distingue a un origen de otro. Un valor a nivel de bucket sigue teniendo prioridad,
de modo que un origen puede cambiar de proveedor sin afectar a los demás.

## Orígenes de almacenamiento en el Frontend

Al usar múltiples backends de almacenamiento, pasa `storageSources` al proveedor `<Rebase>` para que el frontend sepa cómo enrutar las subidas directamente:

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

El `key` de cada origen debe coincidir con una clave de backend registrada en el mapa `storage` del servidor. El contexto de React `StorageSourcesContext` resuelve el origen activo para cada campo de subida.

## Caché y CDNs

Cada objeto se sirve a través del servidor como proxy, con un `ETag` para una
revalidación económica, un `Cache-Control` que depende de quién tiene permisos de lectura, y rangos de bytes
para permitir saltos en audio y vídeo. [Caché de Storage y CDNs](/docs/backend/storage-caching/)
detalla las cabeceras y qué configurar en una CDN colocada al frente.

## Consejos para producción

:::caution
**En producción, `type: "local"` desactiva el almacenamiento de archivos en lugar de usarlo.** En una plataforma efímera (Cloud Run, Heroku, un pod de Kubernetes) el sistema de archivos se borra en cada despliegue, reinicio o desalojo; por lo tanto, las subidas tendrían éxito, se leerían correctamente y desaparecerían en el siguiente rollout, sin mostrar ningún error en ningún momento.

Por ello, el valor predeterminado local no se registra, y una solicitud a `/api/storage/*` que no especifique ningún origen de almacenamiento responde **`501 STORAGE_NOT_CONFIGURED`**, indicando los orígenes disponibles. Un origen con nombre que esté configurado, como `bucket("media", { engine: "s3" })`, continúa funcionando. Las subidas fallan de manera evidente y recuperable; el resto de la aplicación sigue operando. El almacenamiento de archivos requiere activación explícita en producción: existe una vez que existe un bucket.

Establece `STORAGE_TYPE=s3` o `gcs`. Si un **volumen persistente** realmente contiene `STORAGE_PATH`, define `FORCE_LOCAL_STORAGE=true` para indicarlo de forma explícita. Móntalo en el directorio padre de `STORAGE_PATH`, de modo que el directorio `<STORAGE_PATH>__<key>` de cada bucket local con nombre también esté incluido en él.
:::

- Monta un **volumen persistente** sobre el directorio padre de `STORAGE_PATH` si utilizas almacenamiento local en Docker/Kubernetes, y define `FORCE_LOCAL_STORAGE=true` — consulta [Autohospedaje](/docs/deployment/self-hosting/#file-storage)
- Usa **S3** o compatible (R2, MinIO), o **GCS**, para despliegues en producción
- Configura una **CDN** (CloudFront, Cloudflare) al frente para mejorar el rendimiento — consulta [Poner una CDN al frente](/docs/backend/storage-caching/#putting-a-cdn-in-front)
- **Toda aplicación con almacenamiento en producción debe declarar un modelo de acceso** — ver más abajo.
  No solo las multi-tenant: el servidor *se niega a arrancar* sin uno.

## Autorización por objeto

### Políticas

La modalidad declarativa. Una lista de patrones de ruta, evaluada sin ejecutar código:

```ts
storagePolicies: [
    { path: "public/**", operations: ["read"], allow: "public" },
    { path: "users/:uid/**", allow: ({ params, user }) => user?.uid === params.uid }
]
```

**Cualquier clave que no coincida con ninguna política es rechazada.** Cada ampliación de permisos es una línea explícita,
y cualquier error deniega el acceso en lugar de concederlo.

Los patrones coinciden **por segmento, nunca por subcadena** — `public/**` no coincide con
`publicity/secret.png`:

| Patrón | Coincidencia |
|---|---|
| `avatars/logo.png` | esa clave exactamente |
| `users/*/avatar.png` | exactamente un segmento donde está `*` |
| `users/:uid/**` | un segmento capturado, y luego el resto — incluyendo nada |

`**` solo es válido como segmento final. `:name` captura un segmento y nunca
abarca una `/`; las capturas se entregan como `params` en el predicado.

`allow` puede ser `"public"` (cualquiera), `"authenticated"` (cualquier llamador con un uid), o un
predicado que recibe los parámetros capturados, el usuario, la operación y el bucket.
`operations` adopta por defecto las cuatro operaciones: `read`, `write`, `delete`, `list`.

Las políticas satisfacen la protección de arranque en producción por sí solas, y un patrón mal formado
hace fallar el arranque en lugar de la primera subida.

### El hook

`requireAuth` y `publicRead` son modificadores *globales*: deciden si un llamador debe estar autenticado o no, no qué puede manipular dicho llamador. Sin un hook de autorización, **cualquier usuario autenticado puede leer cualquier clave que pueda nombrar** — lo único que separa los archivos de dos tenants es la dificultad para adivinar la clave, lo cual no constituye un modelo de control de acceso. Peor aún, pueden ejecutar `GET /storage/list?prefix=` primero, por lo que ni siquiera necesitan adivinarlas.

:::caution[Storage no arrancará en producción sin esto]
Las colecciones están protegidas por seguridad a nivel de fila (RLS); el almacenamiento no. No existe un equivalente
por objeto en el bucket, por lo que este hook *es* el modelo — e
`initializeRebaseBackend` **lanza una excepción al iniciar** bajo `NODE_ENV=production` cuando
el almacenamiento está configurado y no se ha definido ninguna de estas opciones:

- `storageAuthorize` — un hook, por objeto. Recomendado.
- `storagePublicRead: true` — el bucket es genuinamente una CDN pública de solo lectura.
- `storageInsecureAllowAnyAuthenticated: true` — una aplicación single-tenant donde se confía
  en cada usuario autenticado para todos los archivos. Nombrado así para pensárselo dos veces.

En desarrollo, registra una advertencia en los logs en su lugar, lo que permite que un proyecto esté mal configurado en este aspecto y
funcione bien localmente hasta el momento de su despliegue. Un proyecto generado incluye ya un hook en
`config/storage.ts` — revísalo antes de reemplazarlo, y ten en cuenta que modela
una *biblioteca de contenido compartido* de un CMS, lo cual no tiene la misma estructura que los archivos por usuario.
:::

`storageAuthorize` es el análogo en storage a las reglas de seguridad de una colección, y se ejecuta tras la autenticación en cada ruta de almacenamiento:

```typescript no-verify
await initializeRebaseBackend({
    storage: { type: "s3", bucket: "app-files", /* ... */ },
    storageAuthorize: async ({ key, bucket, operation, user }) => {
        if (!user) return false;
        // Keys are laid out as `{teamId}/{docId}/...`
        const [teamId] = key.split("/");
        return isTeamMember(user.uid, teamId);
    }
});
```

| Campo | Descripción |
|-------|-------------|
| `key` | Clave del objeto, sin el prefijo del bucket y con la navegación de rutas saneada |
| `bucket` | Bucket resuelto (`"default"` cuando no se especifica) |
| `operation` | `"read"`, `"write"`, `"delete"` o `"list"` |
| `user` | `{ uid, email?, roles? }`, o `null` cuando la ruta permite acceso anónimo |
| `storageId` | El backend con nombre, cuando la solicitud apuntó a uno — su clave canónica (`storageId=%20media` es `"media"`). Ausente para el origen predeterminado, sin importar cómo lo haya nombrado la solicitud (sin parámetro, vacío o `(default)`) |
| `data` | Acceso de lectura de confianza, **omitiendo RLS** — `data.collection(slug).find(query)` / `.findById(id)`. La pertenencia reside en una fila, no en el prefijo de una clave, por lo que el hook necesita un lector para responder "¿a quién pertenece este objeto?". Omite deliberadamente la seguridad a nivel de fila: este hook *es* la decisión de autorización, y realizarla a través de un lector ya restringido por los permisos del propio llamador crearía una dependencia circular. Es de solo lectura por diseño. |

Devuelve `false` para denegar el acceso con un **403**. Lanzar una excepción también deniega — una búsqueda de pertenencia que falle no concede permisos por defecto.

Aspectos importantes a tener en cuenta:

- **La ruta de metadatos es donde realmente se decide el acceso de lectura.** Genera el token de descarga de corta duración limitado a la ruta en el que confía la ruta de archivo, por lo que el hook restringe el acceso allí. Dos lecturas omiten el hook, por diseño. Una que incluye dicho token: el hook la autorizó en el momento de generar el token, solo para esa ruta y origen, por lo que un hook que ahora rechazaría la petición (por ejemplo, si se revocó la membresía desde entonces) no la bloquea antes de que el token expire — `storageDownloadTokenTtl`, 300 segundos por defecto. Y la lectura de una clave bajo `public/` por parte de un llamador sin credenciales: el prefijo actúa como declaración de que cualquiera puede leerlo, incluidos visitantes anónimos y CDNs. La lectura de un usuario autenticado sobre ella sí se consulta, pero la anónima no, por lo que un hook no puede privatizar una clave dentro de `public/`; almacena el archivo fuera de `public/` en su lugar. Solo esas dos lecturas lo omiten: un usuario al que tu adaptador de autenticación denomine `public` será evaluado como cualquier otro.
- **Un bucket, un solo nombre.** En S3 y GCS el `bucket` en el hook es siempre `"default"`, incluso cuando una solicitud especifica el nombre del bucket del proveedor, que accede a los mismos objetos.
- **Una ruta es pública cuando la clave que nombra lo es.** El prefijo `public/` se evalúa sobre la clave canónica que sirve la ruta —después de extraer el segmento de bucket `default/` inicial y de simplificar `//`, `./` y una `/` inicial—, nunca sobre la URL tal como fue escrita. `/api/storage/file/notes://public/x.txt` nombra la clave privada `notes:/public/x.txt`, y la clave `default/public/x.txt` (a la que se accede como `/api/storage/file/default/default/public/x.txt`) reside en una carpeta llamada `default`; ninguna de ellas es pública. En un hook, evalúa la `key` recibida mediante `isPublicStorageKey` de `@rebasepro/types` — `isPublicStoragePath` interpreta una ruta o URL del lado del cliente, y consideraría ambas como públicas.
- **`list` se restringe según el prefijo.** Listar es la forma de descubrir claves que nadie te comunicó.
- **Las subidas reanudables (TUS) se restringen al momento de creación**, de modo que una subida rechazada no deja archivos temporales.
- Omitir el hook preserva el comportamiento previo, por lo que las aplicaciones single-tenant no se ven afectadas.

### Claves de API y tokens

Un usuario autenticado posee todos los ámbitos de almacenamiento, por lo que el hook y las políticas anteriores
deciden por él. Una [clave de API](/docs/backend/api-keys/) también necesita el ámbito de
almacenamiento para la operación, en el origen especificado en la solicitud: `storage:read` para
descargas, metadatos y listados; `storage:write` para subidas, carpetas y cada
paso de una subida reanudable; `storage:delete` para eliminaciones. El destino es el
id del origen, siendo el del origen predeterminado `(default)`: `storage:read:(default)`,
`storage:write:avatars`. Sin él, la respuesta es `403 SCOPE_MISSING`. Con él,
el hook sigue ejecutándose, actuando bajo la identidad que represente la clave.

## Reaccionar a una subida

Cualquier otra escritura en Rebase permite reaccionar ante ella —una fila tiene `beforeSave` y
`afterSave`, una programación tiene una tarea cron— pero una subida no tenía nada. Cualquier acción que
implicara una subida debía ser realizada por el cliente en una segunda llamada, lo que significaba que
no se ejecutaba en absoluto si el cliente se desconectaba entre medias.

```ts
storageTriggers: [
    {
        path: "uploads/:uid/**",
        events: ["finalize"],
        handler: async ({ key, params, size, user }) => {
            await indexUpload.enqueue({ key, uid: params.uid, size }); // a `queue()` in config/resources.ts
        }
    }
]
```

La sintaxis de patrones es la misma que en `storagePolicies` —segmentos literales, `*`
para un segmento, `:name` para capturar uno, `**` para el resto— y un patrón
mal formado invalida el arranque en lugar de fallar silenciosamente sin coincidir con nada.

| Evento | Cuándo |
| --- | --- |
| `finalize` | tras escribirse el objeto de forma persistente; nunca ante una escritura fallida |
| `delete` | tras eliminarse el objeto |

`finalize` se dispara tanto para la subida multipart como para la reanudable (TUS) —una sola
vez por subida, no una vez por fragmento— y una subida reanudable reporta al usuario que la
*creó*, ya que ese fue el sujeto validado durante la autorización.

Lo que un handler no debe asumir:

- **Un handler que lance un error no hace fallar la solicitud.** El objeto ya está almacenado
  para cuando este se ejecuta, por lo que responder al cliente con un error indicaría que la
  subida falló cuando no fue así, provocando que los clientes reintenten subidas. Los fallos se registran en los logs
  y la respuesta no se altera. Si el trabajo debe realizarse obligatoriamente, encola una tarea.
- **Los handlers se esperan con await**, en orden de declaración, antes de enviar la respuesta —
  ejecutar en segundo plano sin esperar dejaría una promesa que un runtime serverless podría
  congelar a mitad de ejecución. Un handler lento se traduce por tanto en una subida lenta, siendo esta la
  otra razón para encolar en lugar de procesar aquí directamente.
- **Las escrituras internas no disparan triggers.** La caché de rendiciones de imagen escribe
  los objetos derivados directamente al controlador de almacenamiento; un trigger con `**` que respondiera a
  ellas se estaría disparando sobre su propia salida.

## Próximos pasos

- **[Frontend Storage y subidas de archivos](/docs/frontend/storage)** — Campos y hooks para subida de archivos
- **[Propiedades](/docs/collections/properties)** — Configuración de propiedades de storage
