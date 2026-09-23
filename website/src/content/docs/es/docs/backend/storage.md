---
sourceHash: 68889c97cefde465
title: Configuración de almacenamiento
sidebar_label: Configuración de almacenamiento
description: Configure backends de sistema de archivos local, compatibles con S3 o GCS/Firebase Storage para la subida de archivos, imágenes y contenido multimedia.
---

## Descripción general

Rebase admite tres backends de almacenamiento:

- **Sistema de archivos local** — Archivos almacenados en disco (ideal para desarrollo)
- **Compatible con S3** — AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces
- **Google Cloud Storage / Firebase Storage** — Soporte nativo de GCS mediante `@google-cloud/storage`

## Configuración

:::note[Dónde va esto]
**Runtime administrado** — las variables `STORAGE_*` en `.env` (`STORAGE_TYPE`, `STORAGE_BUCKET` o `S3_BUCKET` / `GCS_BUCKET`, `STORAGE_PATH`, `STORAGE_PUBLIC_READ`, … — añade el sufijo `__<KEY>` a cualquiera de ellas para un origen con nombre), además de una declaración `bucket("<key>")` en `config/resources.ts` para cada bucket adicional al predeterminado, y `export const storageAuthorize` desde `config/index.ts`. `storageAuthorize` no tiene forma en variables de entorno a propósito: ninguna variable puede expresar "este usuario puede leer esta clave".

**Ejected** — el bloque `storage` en `initializeRebaseBackend({ … })`. `storagePolicies` y `storageTriggers` solo están disponibles en modo ejected.

El mapa completo se encuentra en [Descripción general del backend](/docs/backend/#where-each-option-lives).
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

En GCP (Cloud Run, GCE, GKE), las credenciales de la cuenta de servicio predeterminada se utilizan automáticamente. Fuera de GCP, configure la variable de entorno `GOOGLE_APPLICATION_CREDENTIALS` con la ruta al archivo de clave de su cuenta de servicio.

### Múltiples backends de almacenamiento

Puede configurar múltiples backends con nombre y enrutar diferentes campos a distintos almacenamientos:

```typescript
storage: {
    "(default)": { type: "local", basePath: "./uploads" },
    "media": { type: "s3", bucket: "media-bucket", region: "us-east-1", ... }
}
```

Luego, en las propiedades de su colección, haga referencia a un backend específico:

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

## Endpoints de almacenamiento

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/storage/upload` | Subida directa de archivos |
| `POST` | `/api/storage/upload?storageId=<key>` | Subir a un backend con nombre específico |
| `GET` | `/api/storage/file/*` | Recuperar un archivo — todo lo que va después de `/file/` es la clave del objeto |
| `GET` | `/api/storage/file/*?storageId=<key>` | Recuperar un archivo de un backend específico |
| `GET` | `/api/storage/metadata/*` | Tamaño, tipo de contenido y última modificación de un objeto, sin sus bytes |
| `DELETE` | `/api/storage/file/*` | Eliminar un archivo |
| `GET` | `/api/storage/list` | Listar objetos bajo un prefijo (`prefix`, `bucket`, `maxResults`, `pageToken`, `storageId`). Un `maxResults` menor que 1, o un `pageToken` que el origen nunca emitió, es `400 INVALID_LIST_OPTIONS` |
| `POST` | `/api/storage/folder` | Crear un marcador de carpeta vacía |
| `GET` | `/api/storage/sources` | Los orígenes de almacenamiento que sirve este backend, por clave |
| `OPTIONS` | `/api/storage/tus` | Consultar las capacidades admitidas del protocolo TUS |
| `POST` | `/api/storage/tus` | Iniciar una sesión de subida reanudable TUS |
| `HEAD` | `/api/storage/tus/:id` | Comprobar el progreso de la subida (desplazamiento en bytes / byte offset) |
| `PATCH` | `/api/storage/tus/:id` | Añadir un fragmento de datos al archivo temporal |
| `DELETE` | `/api/storage/tus/:id` | Terminar/cancelar la sesión de subida TUS |

**Qué responden.** Un único envoltorio, el mismo que utiliza `/api/data`: la carga útil
está bajo `data`, y un fallo es `{ "error": { message, code, requestId } }`
con los códigos de la [referencia de errores](/docs/backend/errors/). `/api/storage/file/*`
es la excepción, porque su carga útil es el archivo en sí: responde con los bytes, con
`Content-Type`, `Content-Length` y las cabeceras de almacenamiento en caché.

```json
// GET /api/storage/list?prefix=products/images/
{ "data": { "items": [ { "bucket": "default", "fullPath": "products/images/a.jpg", "name": "a.jpg" } ], "prefixes": [] } }
```

`POST /api/storage/upload` responde `201` con `{ key, bucket, storageUrl }`
del objeto almacenado bajo `data`; `GET /api/storage/metadata/*` devuelve los metadatos
del objeto y, para un objeto privado, el `token` de corta duración;
`GET /api/storage/sources` devuelve el array de orígenes configurados.
`DELETE /api/storage/file/*` y `POST /api/storage/folder` solo contienen un
`message`, ya que no hay nada que devolver.

En S3 y GCS, un `bucket` tiene que ser uno que el origen sirva, tanto en
escrituras como en lecturas: una subida, un `POST /api/storage/folder` o una
subida TUS que nombre cualquier otro bucket responde
`404 UNKNOWN_STORAGE_SOURCE`, igual que el listado. El almacenamiento local
sigue creando un bucket en su primera escritura.

**Cómo se autoriza la lectura de un archivo.** Las rutas de lectura — `/api/storage/file/*` y
`/api/storage/metadata/*` — aceptan el token firmado de corta duración que
emite [`getSignedUrl()`](/docs/sdk/storage), pasado como `?token=<token>` o como
un `Bearer`. Un JWT de acceso ordinario se **rechaza** en `/file/*` con `401
Unauthorized: Access JWT not allowed on file routes`: el token que funciona en
cualquier otra ruta no funciona allí, a propósito, porque la URL de un archivo es
algo que se entrega a un navegador, a una CDN o a una etiqueta `<img>`. Cada una de las demás filas anteriores
acepta el JWT de acceso de forma habitual.

## Transformaciones de imágenes al vuelo

Rebase incluye una canalización de procesamiento de imágenes integrada impulsada por **Sharp**. Al servir recursos de imagen desde el almacenamiento, puede aplicar operaciones dinámicas mediante parámetros de consulta:

```bash
# Serve image scaled to 300px width in webp format
GET /api/storage/file/products/laptop.jpg?width=300&format=webp
```

### Parámetros admitidos

- `width`, `height`: Límites de cambio de tamaño, `1`–`4096` (la imagen nunca se amplía).
- `quality`: `1`–`100`.
- `format`: Convierte el formato de la imagen. Formatos admitidos: `webp`, `jpeg`, `png`, `avif`.
- `fit`: `cover`, `contain`, `fill`, `inside` o `outside`.

Un parámetro fuera de estos límites devuelve un **400**, en lugar de ajustarse silenciosamente:
anteriormente, `?width=99999` devolvía una imagen de 4096px y `?format=tiff` una en webp, sin
indicarlo explícitamente.

### Rendimiento y almacenamiento en caché LRU

La transformación consume mucha CPU y memoria, y en un objeto público se puede acceder al endpoint
de forma anónima, por lo que el trabajo está acotado en lugar de simplemente almacenado en caché:
- **Capacidad**: una caché LRU limitada a **500 entradas** globalmente, identificadas por
  origen de almacenamiento, bucket y clave canónica.
- **TTL (Tiempo de vida)**: Las variantes en caché expiran después de **1 hora**.
- Las solicitudes simultáneas para la misma variante no almacenada en caché producen **una sola** transformación,
  no una por cada solicitud.
- Se ejecuta un número reducido de transformaciones al mismo tiempo; más allá de una cola acumulada limitada, el servidor
  responde **503 `TRANSFORM_OVERLOADED`** en lugar de aceptar trabajo que no podrá
  procesar.

Esa caché reside en el proceso, lo que significa que no se comparte entre instancias
y no sobrevive a un reinicio. Dos réplicas calculan cada una todas las variantes, y un
despliegue descarta todo.

### Rendiciones que sobreviven a un reinicio

`storageRenditionCache` vuelve a escribir cada imagen derivada en el mismo bucket que su
origen, por lo que el trabajo se realiza una sola vez para todo el despliegue en lugar de una vez por
instancia y por lanzamiento:

```ts
storageRenditionCache: { enabled: true }
```

o `STORAGE_RENDITION_CACHE=true` para un despliegue de bundle. Las rendiciones se almacenan
bajo el prefijo reservado `_rebase/renditions/`, identificadas por la versión
del objeto de origen; por lo tanto, reemplazar una imagen sirve la nueva de inmediato.

Tres cosas que debe saber antes de activarlo:

- **Una lectura ahora escribe.** Cada nueva variante cuesta un `PUT` en su bucket. Por esa
  razón está desactivado por defecto.
- **Una escritura fallida no es una solicitud fallida.** Las credenciales de solo lectura, o una política
  de bucket que rechace el prefijo, recurren a la caché en proceso; la imagen
  se sigue sirviendo y el motivo se registra en los logs una sola vez.
- **Las rendiciones sustituidas no se recolectan automáticamente.** Reemplazar un objeto de origen
  deja huérfanas sus antiguas rendiciones. Configure una regla de ciclo de vida en `_rebase/renditions/`
  — ese prefijo es fijo, no configurable, precisamente para que una regla pueda nombrarlo.

El prefijo no es direccionable desde la API. Leerlo o escribirlo directamente
responde **400 `INVALID_STORAGE_KEY`**: cada regla de acceso en el producto —
tanto `storageAuthorize` como las políticas declarativas — está escrita contra la
clave de *origen*, y una rendición servida bajo su propia ruta respondería a una pregunta
que nadie hizo.

### Qué se sirve

El tipo de contenido almacenado es el que haya declarado quien lo subió — nada analiza los
bytes internamente —, por lo que `/api/storage/file/*` solo representará en línea una **lista de permitidos estricta**:
imágenes (excepto SVG), vídeo, audio, `application/pdf` y `text/plain`. Todo lo
demás, incluidos `text/html` e `image/svg+xml`, se sirve como
`application/octet-stream` con `Content-Disposition: attachment`, y cada
respuesta incluye `X-Content-Type-Options: nosniff`. El almacenamiento no es un alojamiento web:
una página subida que se procese en el origen de la API puede leer las cookies de ese origen y
llamar a sus endpoints.

## Protocolo de subidas reanudables TUS

Para subir archivos grandes (de hasta **5GB**) o manejar condiciones de red inestables, Rebase implementa el protocolo abierto **TUS v1.0.0**, incluidas las extensiones `Creation` y `Termination`.

```
Client                                                   Rebase Server
  │                                                           │
  │─── POST /api/storage/tus (Upload-Length: 50000000) ──────>│ (Generates session ID)
  │<── 201 Created (Location: /api/storage/tus/uuid-abc) ────│
  │                                                           │
  │─── PATCH /api/storage/tus/uuid-abc (Upload-Offset: 0) ───>│ (Appends chunk via open/write)
  │<── 204 No Content (Upload-Offset: 1500000) ───────────────│
  │                                                           │
  │─── PATCH /api/storage/tus/uuid-abc (Upload-Offset: 1.5M) ─>│ (Upload finishes)
  │<── 204 No Content (Upload-Offset: 50000000) ──────────────│ (Copies to storage, unlinks temp)
```

### Mecánica del ciclo de vida de la subida

1. **Inicialización de la sesión (`POST`)**: El cliente envía el tamaño total del archivo en la cabecera `Upload-Length` y metadatos en base64 mediante `Upload-Metadata`. El servidor crea un archivo marcador de posición vacío en un directorio temporal oculto `.tus-uploads/` y devuelve la URL de subida.
2. **Consultas de progreso (`HEAD`)**: Si una subida se interrumpe, el cliente consulta la URL de subida mediante una solicitud `HEAD`. El servidor devuelve la posición actual en bytes en la cabecera `Upload-Offset`.
3. **Anexión de datos (`PATCH`)**: El cliente reanuda el envío de datos binarios comenzando en el desplazamiento devuelto con `Content-Type: application/offset+octet-stream`. El servidor escribe los fragmentos entrantes directamente en el archivo temporal utilizando las API de bajo nivel del sistema de archivos de Node `open` y `write` en el desplazamiento de bytes especificado.
4. **Finalización**: Cuando el `Upload-Offset` acumulado coincide con el `Upload-Length` declarado, Rebase lee el archivo temporal completado, lo envuelve como un objeto estándar `File` de JavaScript y lo guarda en el backend de almacenamiento configurado (disco local o S3). A continuación, se elimina el archivo temporal.
5. **Limpieza periódica**: Un limpiador en segundo plano se ejecuta cada **60 segundos** para eliminar subidas temporales huérfanas e incompletas que hayan superado el umbral de retención de **24 horas**.

## Variables de entorno

| Variable | Descripción |
|----------|-------------|
| `STORAGE_TYPE` | `"local"`, `"s3"` o `"gcs"` |
| `STORAGE_PATH` | Directorio de almacenamiento local (por defecto: `./uploads`) |
| `S3_BUCKET` | Nombre del bucket S3 |
| `S3_REGION` | Región de AWS (por defecto: `"auto"`) |
| `S3_ACCESS_KEY_ID` | Clave de acceso de AWS |
| `S3_SECRET_ACCESS_KEY` | Clave secreta de AWS |
| `S3_ENDPOINT` | Endpoint S3 personalizado (para MinIO, R2) |
| `S3_FORCE_PATH_STYLE` | Usar URLs de estilo de ruta (path-style) (obligatorio para MinIO) |
| `GCS_BUCKET` | Nombre del bucket de Google Cloud Storage |
| `GCS_PROJECT_ID` | ID de proyecto de GCP para GCS |
| `GCS_KEY_FILENAME` | Ruta a un archivo de clave de cuenta de servicio de GCP (omitir en GKE; Workload Identity/ADC proporciona las credenciales) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Variable estándar de ADC, leída por el propio SDK de Google (no es necesaria en GCP con credenciales predeterminadas) |
| `FORCE_LOCAL_STORAGE` | Permitir `STORAGE_TYPE=local` en producción — ver a continuación |
| `STORAGE_PUBLIC_READ` | Servir objetos almacenados a lectores no autenticados. La variante en variable de entorno de `storagePublicRead`, y una de las tres formas de satisfacer la [protección de arranque en producción](#autorización-por-objeto). |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Desactivar la protección de arranque, restaurando el comportamiento en el que cualquier usuario autenticado puede leer, sobrescribir, eliminar o listar cualquier clave. La variante en variable de entorno de `storageInsecureAllowAnyAuthenticated`. Solo justificable cuando se confía cada archivo a cada usuario autenticado. |

## Varios buckets

Un proyecto puede tener más de un bucket. Declare cada uno en `config/resources.ts`
— el único lugar que leen la plataforma, el runtime y la consola:

```ts
import { bucket } from "@rebasepro/types";

export const uploads = bucket({ engine: "s3" });    // the default one
export const media = bucket("media", { engine: "s3", label: "Media" });
```

Luego ejecute `rebase resources --write`, lo que regenera `rebase.resources.json`
para que un host pueda leer su topología sin ejecutar una compilación. Consulte
[Múltiples orígenes](/docs/backend/multiple-sources) para bases de datos, buckets y
temas en conjunto.

Cada origen se configura a partir de los **mismos nombres de variable que llevan su propio
sufijo**. El origen predeterminado no lleva sufijo, por lo que un proyecto con un solo bucket sigue
utilizando los nombres simples anteriores y no necesita declarar nada en absoluto:

```bash
S3_BUCKET=app-uploads             # (default)
S3_BUCKET__MEDIA=app-media        # media
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

El sufijo se deriva de la clave: en mayúsculas, los caracteres no alfanuméricos se convierten en
guiones bajos, tras un **doble** guion bajo (`media-cdn` → `__MEDIA_CDN`). Un
guion bajo simple colisionaría con nombres de variables reales — `S3_BUCKET_NAME`
se interpretaría como el bucket `name`.

Enrute una propiedad a un origen con `storageSource`:

```ts
{
    name: "Cover",
    dataType: "string",
    storage: { storageSource: "media", acceptedFiles: ["image/*"] }
}
```

Un origen que usted declare pero nunca configure se **omite**, no es fatal: las subidas
enrutadas hacia él responden `501 STORAGE_SOURCE_NOT_CONFIGURED`. Declarar un bucket suele
ocurrir antes de que alguien le asocie almacenamiento, y un error de arranque en ese punto
provocaría un bucle de reinicios en el backend hasta que alguien lo hiciera. Un origen que el entorno configure
*incorrectamente* —un tipo sin bucket, o un bucket sin credenciales— se rechaza
en el arranque, porque se trata de un error y no de una ausencia.

### Buckets que comparten una cuenta

Las credenciales suelen describir al **proveedor**, no al bucket. De lo contrario, quince buckets en
una sola instalación de MinIO supondrían quince copias de la misma clave de acceso, y
una rotación requeriría quince ediciones dobles. En su lugar, asigne un nombre a una cuenta:

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

Solo las variables con ámbito de cuenta se reutilizan como valor alternativo: `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`, `S3_FORCE_PATH_STYLE`, y
el par de GCS `GCS_PROJECT_ID` / `GCS_KEY_FILENAME`. El nombre del bucket nunca lo hace:
es lo que distingue a un origen de otro. Un valor específico por bucket sigue teniendo prioridad,
por lo que un origen puede cambiar de proveedor sin afectar al resto.

## Fuentes de almacenamiento del frontend

Cuando utilice múltiples backends de almacenamiento, pase `storageSources` al proveedor `<Rebase>` para que el frontend sepa cómo enrutar las subidas directamente:

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

La propiedad `key` de cada origen debe coincidir con una clave de backend registrada en el mapa `storage` del servidor. El contexto de React `StorageSourcesContext` resuelve el origen activo para cada campo de subida.

## Caché y CDN

Cada objeto se reenvía a través del servidor mediante proxy en lugar de redirigirse a una
URL firmada — una URL firmada falla con contenido mixto (una página HTTPS, un MinIO por HTTP) y en
endpoints a los que solo puede acceder el clúster. Por lo tanto, las cabeceras de respuesta son las que hacen
que la caché funcione.

Cada respuesta incluye un `ETag` débil y `Last-Modified`, generados a partir del
tamaño del objeto y la hora de modificación. Un cliente que ya tiene el objeto envía
`If-None-Match` y recibe un **304 sin cuerpo**, por lo que una carga repetida cuesta un
viaje de ida y vuelta en lugar de una transferencia completa.

`Cache-Control` depende de quién puede leer el objeto:

| Objeto | Cabecera |
|---|---|
| Bajo el prefijo `public/`, o `publicRead: true` | `public, max-age=60, stale-while-revalidate=86400, must-revalidate` |
| Cualquier otro caso | `private, max-age=60, must-revalidate` |
| Transformaciones de imágenes | lo mismo, con `max-age=3600` |

`private` es deliberado: un objeto que requirió credenciales para recuperarse no debe ser
almacenado por una caché compartida, o una CDN podría entregar el archivo de un usuario al siguiente solicitante.
`Vary: Authorization` se envía por la misma razón.

Nunca se marca nada como `immutable`. Una clave de almacenamiento se puede sobrescribir — escribir
en una clave existente es una operación ordinaria —, por lo que prometer no volver a validar nunca
haría que un archivo reemplazado fuera invisible hasta que expirase la ventana de tiempo.

### Búsqueda y desplazamiento (seeking) en audio y vídeo

Cada respuesta de objeto incluye `Accept-Ranges: bytes`, y una solicitud `Range` se
responde con `206 Partial Content` y un `Content-Range`. Sin esto, un navegador
no permitirá desplazarse en un elemento multimedia servido desde aquí —y Safari se niega
a reproducir un `<video>` cuya primera respuesta no sea un `206`—, por lo que para el contenido multimedia esta es
la diferencia entre un reproductor que funciona y uno roto.

- Un rango por solicitud: `bytes=0-499`, `bytes=500-`, `bytes=-500`. Eso es lo que
  envían los navegadores para la reproducción.
- Múltiples rangos en una sola cabecera se responden con el objeto completo y un `200`,
  lo cual siempre es válido. Ningún cliente relevante los envía.
- Un rango que comienza más allá del final devuelve un `416` con `Content-Range: bytes */<size>`,
  no una respuesta silenciosa con el archivo completo.
- La revalidación prevalece sobre un rango: una solicitud que lleve tanto `If-None-Match` como
  `Range` recibe el `304`.

En el almacenamiento local solo se lee del disco la porción solicitada. En S3 y GCS, el
objeto se sigue recuperando por completo —un `StorageController` no tiene lectura por rangos—, por lo que el
ahorro se produce en la respuesta, no aguas arriba.

### Colocar una CDN por delante

Dado que los objetos públicos son `public` con una ventana de `stale-while-revalidate` y un
validador, cualquier proxy inverso o CDN ordinario puede almacenarlos en caché sin ninguna
configuración adicional. Apúntelo al origen de la API y deje que respete las cabeceras.

Dos cosas que debe configurar en la propia CDN:

- **Respetar `Vary: Authorization`**, o no almacenar en caché las rutas autenticadas en absoluto.
  Una CDN que ignore `Vary` y almacene en caché respuestas `private` es el fallo que
  esta cabecera busca prevenir.
- **Esperar revalidación.** El valor corto de `max-age` significa que la CDN volverá a preguntar
  periódicamente; esas solicitudes son 304 económicos, y son lo que evita que un
  objeto sobrescrito se sirva desactualizado.

## Consejos para producción

:::caution
**En producción, `type: "local"` deshabilita el almacenamiento de archivos en lugar de utilizarlo.** En una plataforma efímera (Cloud Run, Heroku, un pod de Kubernetes), el sistema de archivos se borra en cada despliegue, reinicio y desalojo — por lo que las subidas tendrían éxito, se leerían bien y desaparecerían en el siguiente rollout, sin ningún error en ningún momento.

Por lo tanto, no se registra el valor predeterminado local, y una solicitud a `/api/storage/*` que no nombra ningún origen de almacenamiento responde **`501 STORAGE_NOT_CONFIGURED`**, indicando los orígenes que sí se sirven. Un origen con nombre que está configurado, como `bucket("media", { engine: "s3" })`, sigue funcionando. Las subidas fallan de forma ruidosa y recuperable; el resto de la aplicación sigue funcionando. El almacenamiento de archivos requiere confirmación explícita en producción: existe una vez que existe un bucket.

Configure `STORAGE_TYPE=s3` o `gcs`. Si realmente hay montado un **volumen duradero** en `STORAGE_PATH`, configure `FORCE_LOCAL_STORAGE=true` para indicarlo explícitamente.
:::

- Monte un **volumen persistente** si utiliza almacenamiento local en Docker/Kubernetes y configure `FORCE_LOCAL_STORAGE=true`
- Utilice **S3** o compatibles (R2, MinIO), o **GCS**, para despliegues en producción
- Configure una **CDN** (CloudFront, Cloudflare) delante de su bucket para mejorar el rendimiento
- **Cualquier aplicación con almacenamiento en producción debe declarar un modelo de acceso** — consulte a continuación.
  No solo las aplicaciones multitenant: el servidor *se niega a arrancar* sin uno.

## Autorización por objeto

### Políticas

La forma declarativa. Una lista de patrones de ruta, evaluados sin ejecutar código:

```ts
storagePolicies: [
    { path: "public/**", operations: ["read"], allow: "public" },
    { path: "users/:uid/**", allow: ({ params, user }) => user?.uid === params.uid }
]
```

**Una clave que no coincida con ninguna política se rechaza.** Cada ampliación de permisos es una línea explícita,
y un error deniega el acceso en lugar de concederlo.

Los patrones coinciden **por segmento, nunca por subcadena** — `public/**` no coincide con
`publicity/secret.png`:

| Patrón | Coincide con |
|---|---|
| `avatars/logo.png` | esa clave exactamente |
| `users/*/avatar.png` | exactamente un segmento donde se encuentra `*` |
| `users/:uid/**` | un segmento capturado y luego el resto — incluso nada |

`**` solo es válido como el segmento final. `:name` captura un segmento y nunca
abarca una `/`; las capturas llegan como `params` en el predicado.

`allow` puede ser `"public"` (cualquiera), `"authenticated"` (cualquier usuario con un uid) o un
predicado que recibe los parámetros capturados, el usuario, la operación y el bucket.
`operations` toma por defecto las cuatro operaciones — `read`, `write`, `delete`, `list`.

Las políticas satisfacen la protección de arranque en producción por sí solas, y un patrón mal formado
hace fallar el arranque en lugar de la primera subida.

### El hook


`requireAuth` y `publicRead` son modificadores *globales*: deciden si quien llama debe haber iniciado sesión, no qué puede tocar. Sin un hook de autorización, **cualquier usuario autenticado puede leer cualquier clave que pueda nombrar** — lo único que separa los archivos de dos inquilinos es la imposibilidad de adivinar la clave, lo cual no es un modelo de control de acceso. Peor aún, pueden ejecutar `GET /storage/list?prefix=` primero, de modo que ni siquiera necesitan adivinar las claves.

:::caution[El almacenamiento no arrancará en producción sin uno]
Las colecciones están protegidas por seguridad a nivel de fila (RLS); el almacenamiento no. No hay
un equivalente por objeto en el bucket, por lo que este hook *es* el modelo — y
`initializeRebaseBackend` **lanza un error al iniciar** bajo `NODE_ENV=production` cuando
el almacenamiento está configurado y no se ha establecido ninguno de los siguientes:

- `storageAuthorize` — un hook, por objeto. Recomendado.
- `storagePublicRead: true` — el bucket es genuinamente una CDN pública de solo lectura.
- `storageInsecureAllowAnyAuthenticated: true` — una aplicación de un solo inquilino donde se confía
  cada archivo a cada usuario autenticado. Nombrado así para leerse dos veces.

En desarrollo, registra una advertencia en su lugar, por lo que un proyecto puede estar equivocado al respecto y
funcionar bien localmente hasta que se despliega. Un proyecto generado mediante scaffolding ya incluye un hook en
`config/storage.ts` — léalo antes de reemplazarlo, y tenga en cuenta que modela
la *biblioteca de contenido compartido* de un CMS, que no tiene la misma estructura que los archivos por usuario.
:::

`storageAuthorize` es el equivalente en almacenamiento de las reglas de seguridad de una colección, y se ejecuta tras la autenticación en cada ruta de almacenamiento:

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
| `key` | Clave del objeto, con el prefijo del bucket eliminado y el recorrido de directorios saneado |
| `bucket` | Bucket resuelto (`"default"` cuando no se especifica) |
| `operation` | `"read"`, `"write"`, `"delete"` o `"list"` |
| `user` | `{ uid, email?, roles? }`, o `null` donde la ruta permite acceso anónimo |
| `storageId` | El backend con nombre, cuando la solicitud apuntaba a uno |
| `data` | Acceso de lectura de confianza que **omite RLS** — `data.collection(slug).find(query)` / `.findById(id)`. La propiedad reside en una fila, no en el prefijo de una clave, por lo que el hook necesita un mecanismo de lectura para responder "¿a quién pertenece este objeto?". Omite la seguridad a nivel de fila deliberadamente: este hook *es* la decisión de autorización, y tomarla a través de un lector ya restringido por los permisos del propio solicitante sería circular. De solo lectura por diseño. |

Devuelva `false` para denegar con un **403**. Lanzar una excepción también deniega el acceso — una búsqueda de propiedad que falla no queda abierta por defecto.

Conviene saber:

- **La ruta de metadatos es donde realmente se decide el acceso de lectura.** Esta emite el token de descarga de corta duración y delimitado a la ruta en el que confía la ruta del archivo, por lo que el hook lo restringe allí. Las solicitudes que ya llevan dicho token, o que acceden a una ruta declarada pública, omiten el hook: el token se emitió bajo su control y solo es válido para su propia ruta.
- **`list` se restringe en función del prefijo.** Listar es la forma de descubrir claves de las que nadie le informó.
- **Las subidas reanudables (TUS) se restringen en el momento de la creación**, de modo que una subida denegada no deja ningún archivo temporal atrás.
- Omitir el hook conserva el comportamiento anterior, por lo que las aplicaciones de inquilino único no se ven afectadas.

## Reaccionar a una subida

Cualquier otra escritura en Rebase admite reacciones — una fila tiene `beforeSave` y
`afterSave`, una programación tiene una tarea cron —, mientras que una subida no tenía nada. Cualquier acción que
implicara una subida debía ser realizada por el cliente en una segunda llamada, lo que significa que
no se ejecutaba en absoluto si el cliente se desconectaba entre medias.

```ts
storageTriggers: [
    {
        path: "uploads/:uid/**",
        events: ["finalize"],
        handler: async ({ key, params, size, user }) => {
            await jobs.enqueue("index-upload", { key, uid: params.uid, size });
        }
    }
]
```

El lenguaje de patrones es el mismo que en `storagePolicies` — segmentos literales, `*`
para un segmento, `:name` para capturar uno, `**` para el resto —, y un patrón
mal formado hace fallar el arranque en lugar de no coincidir silenciosamente con nada.

| Evento | Cuándo |
| --- | --- |
| `finalize` | después de que el objeto se haya escrito de forma duradera; nunca para una escritura que haya fallado |
| `delete` | después de que el objeto haya sido eliminado |

`finalize` se dispara tanto para la vía multipart como para la reanudable (TUS) — una vez
por subida, no una vez por fragmento —, y una subida reanudable reporta al usuario que
la *creó*, ya que ese es el sujeto que comprobó la autorización.

Lo que un handler no debe asumir:

- **Un handler que lanza una excepción no hace fallar la solicitud.** El objeto ya está almacenado
  para cuando se ejecuta, por lo que responder al cliente con un error indicaría que
  la subida falló cuando no fue así, y los clientes reintentan las subidas. Los fallos se registran
  y la respuesta permanece inalterada. Si el trabajo debe realizarse obligatoriamente, póngalo en cola como un job.
- **Los handlers se esperan con await**, en orden de declaración, antes de que se envíe la respuesta;
  ejecutar en modo "disparar y olvidar" dejaría una promesa que un runtime serverless
  podría congelar en mitad de la ejecución. Por lo tanto, un handler lento es una subida lenta, que es la
  otra razón para encolar tareas en lugar de procesarlas aquí.
- **Las escrituras internas no disparan triggers.** La caché de rendiciones de imágenes escribe
  los objetos derivados directamente en el controlador de almacenamiento; un trigger `**` que se disparase sobre
  esos objetos estaría disparándose sobre su propia salida.

## Próximos pasos

- **[Almacenamiento en frontend y subida de archivos](/docs/frontend/storage)** — Campos y hooks para la subida de archivos
- **[Propiedades](/docs/collections/properties)** — Configuración de propiedades de almacenamiento
