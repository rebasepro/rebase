---
sourceHash: 14cb375a352ba487
title: Almacenamiento y Archivos
sidebar_label: Almacenamiento
description: Sube, descarga, lista y elimina archivos utilizando el módulo de almacenamiento del SDK tipado de Rebase.
---

## Visión general

El módulo `client.storage` proporciona métodos para la gestión de archivos: subida, descarga, listado y eliminación. Funciona tanto con disco local como con backends de almacenamiento compatibles con S3, según la configuración de tu servidor.

Todos los métodos de almacenamiento utilizan el transporte compartido, por lo que los tokens de autenticación se inyectan automáticamente.

## Subir un archivo

Utiliza `putObject()` para subir un archivo. Acepta un objeto `File` o `Blob` junto con una clave de almacenamiento opcional y metadatos:

```typescript
const result = await client.storage.putObject({
    file: fileObject,                   // File or Blob
    key: "products/images/camera.jpg",  // Storage path (optional)
    bucket: "uploads",                  // Bucket name (optional)
    public: false,                      // Store public (permanent token-less URL) — optional, default false
    metadata: {                         // Custom metadata (optional)
        description: "Product photo",
        uploadedBy: "user-123"
    }
});

// result: { key: string; bucket: string; storageUrl: string }
```

Un archivo de más de 8 MiB se sube a través del endpoint reanudable (TUS)
del servidor, a razón de 8 MiB por petición, en lugar de como una única petición
multipart que el servidor analiza por completo; de este modo, una subida grande
le cuesta al servidor un fragmento de memoria, no entre tres y cinco veces el
archivo. Un fragmento que falla en el camino se vuelve a enviar desde el punto en
el que se quedó el servidor. El resultado, el objeto almacenado y las comprobaciones
del servidor son los mismos en ambos casos. Cuando el endpoint reanudable no puede
aceptar el archivo (un servidor más antiguo o varias instancias que no comparten
subidas), se envía como un único `POST /api/storage/upload`, al igual que cualquier
archivo posterior de ese cliente. Consulta [Resumable uploads (TUS)](/docs/backend/storage-resumable-uploads/).

### Desde un input de archivo

```typescript
const input = document.querySelector<HTMLInputElement>("#file-input");
const file = input?.files?.[0];

if (file) {
    const result = await client.storage.putObject({
        file,
        key: `avatars/${userId}/${file.name}`
    });
    console.log("Uploaded to:", result.key);
}
```

## Obtener una URL firmada

Obtén una URL de descarga y metadatos para un archivo almacenado:

```typescript
const { url, metadata, fileNotFound } = await client.storage.getSignedUrl(
    "products/images/camera.jpg"
);

if (url) {
    console.log("Download URL:", url);
    console.log("Content type:", metadata?.contentType);
} else {
    console.log("File not found");
}
```

:::caution[El argumento `bucket` es actualmente un prefijo de ruta]
En `getSignedUrl`, `getObject` y `deleteObject`, el segundo argumento se incorpora a la clave del objeto (`<bucket>/<key>`) y nunca llega al servidor como un bucket, por lo que un nombre que el despliegue no sirve se reporta como un *archivo* inexistente, no como un bucket desconocido; y un archivo escrito con `putObject({ bucket: "media" })` no se recupera con `getSignedUrl(key, "media")`. Lee un archivo con la misma estructura de llamada con la que se escribió. En el lado del servidor ya se responde `404 UNKNOWN_STORAGE_SOURCE` para un bucket que no sirve en `/api/storage/list`, y también en S3 o GCS en las subidas; el argumento del SDK se está rediseñando para coincidir con esto.
:::

Con un bucket específico:

```typescript
const { url } = await client.storage.getSignedUrl(
    "camera.jpg",
    "product-images"   // bucket
);
```

El SDK almacena en caché las URL firmadas para evitar llamadas redundantes al
servidor, hasta que expire el token de descarga de cada una. Las búsquedas
realizadas juntas —una página de previsualizaciones que llama a `getSignedUrl()`
en el mismo ciclo— van al servidor como un único `POST /api/storage/metadata` por
cada 100 archivos, lo que el limitador de tasa cuenta como una décima parte de las
peticiones a las que reemplaza; un archivo que un llamador no puede leer solo
falla en esa llamada concreta. La caché pertenece a la credencial que la solicitó:
cuando el token de acceso cambia —un cierre de sesión, otro usuario que inicia sesión,
una actualización— se reinicia, de modo que nunca se entrega a un usuario una URL
generada para otro.

### URLs privadas vs. públicas

- **Los archivos privados** obtienen una URL con un **token de descarga de corta duración y delimitado a la ruta** (`?token=…`, 5 minutos a menos que el servidor configure `STORAGE_DOWNLOAD_TOKEN_TTL`, el cual la versión 0.23 no lee), nunca tu token de acceso. Debido a que caduca, **no persistas una URL privada**; almacena la **ruta** del archivo y vuelve a llamar a `getSignedUrl()` cuando lo renderices.
- **Los archivos públicos** (almacenados bajo el prefijo `public/`; define `storage: { public: true }` en la propiedad, o pasa `public: true` a `putObject`) obtienen una URL **estable, sin token, permanente y almacenable en CDN en caché** sin ida y vuelta al servidor. Es seguro almacenarlas en una base de datos y utilizarlas para enlaces directos.

### Archivos dentro de texto

El texto que incrusta un archivo —las imágenes en un campo markdown— tampoco
puede contener una URL privada, por lo que en su lugar contiene una **referencia
de almacenamiento**: `rebase-storage:posts/cover.png`, con `?storageId=media`
cuando el archivo está en una fuente con nombre. Eso es lo que el editor markdown
del panel de administración escribe para una imagen subida. Intercambia las
referencias por URLs cuando renderices el texto:

```typescript
import { resolveStorageReferences } from "@rebasepro/client";

const post = await client.data.table("posts").findById("post-1");
const body = await resolveStorageReferences(String(post?.body ?? ""), client);
// `body` is the same markdown, each reference replaced by a fresh URL.
```

Cada objeto se firma una vez por llamada, desde su propia fuente, por lo que una
imagen privada sigue funcionando sin importar cuánto tiempo hace que se subió.
Una referencia que apunta a un objeto que ya no existe se deja tal como está.
`storageReference(key, storageId?)` construye una, para el texto que escribas tú
mismo.

El texto guardado antes de que existieran las referencias contiene directamente
la URL de descarga de un archivo privado, `…/storage/file/posts/cover.png?token=…`,
cuyo token expiró minutos después de haberse escrito. `resolveStorageReferences`
también renueva esas: el token todavía nombra el objeto, por lo que la URL se
reemplaza por una nueva. Para almacenar referencias en su lugar, reescribe el
texto una vez con `storageReferencesForDownloadUrls(text)`, lo cual deja intacta
cualquier otra URL.

## Descargar un archivo

Recupera un archivo como un objeto `File`:

```typescript
const file = await client.storage.getObject("products/images/camera.jpg");

if (file) {
    console.log("File name:", file.name);
    console.log("File type:", file.type);
    console.log("File size:", file.size);

    // Create a download link
    const url = URL.createObjectURL(file);
    window.open(url);
} else {
    console.log("File not found");
}
```

Con un bucket específico:

```typescript
const file = await client.storage.getObject("camera.jpg", "product-images");
```

## Eliminar un archivo

```typescript
await client.storage.deleteObject("products/images/camera.jpg");

// With bucket
await client.storage.deleteObject("camera.jpg", "product-images");
```

Eliminar un archivo inexistente no genera ningún error.

## Listar archivos

Lista archivos por prefijo, con paginación opcional:

```typescript
const result = await client.storage.listObjects("products/images/", {
    bucket: "uploads",
    maxResults: 50,
    pageToken: undefined   // for pagination
});

for (const item of result.items) {
    console.log(item.fullPath, item.name, item.size, item.updated, item.contentType);
}

// Paginate
if (result.nextPageToken) {
    const nextPage = await client.storage.listObjects("products/images/", {
        pageToken: result.nextPageToken
    });
}
```

Cada elemento contiene su `size` en bytes y `updated` (una marca de tiempo ISO 8601)
en almacenamiento local, S3 y GCS, y su `contentType` en almacenamiento local y GCS;
suficiente para mostrar una carpeta sin necesidad de un `getSignedUrl()` por archivo.
Un listado de S3 no tiene tipo de contenido; las carpetas (`result.prefixes`) no
contienen ninguno de los tres.

## Formatos de claves de almacenamiento

El SDK gestiona los prefijos de las claves de almacenamiento de forma transparente. Puedes pasar claves con o sin el prefijo del protocolo:

```typescript
// All equivalent — the SDK strips the prefix internally
await client.storage.getSignedUrl("local://products/image.jpg");
await client.storage.getSignedUrl("s3://products/image.jpg");
await client.storage.getSignedUrl("products/image.jpg");
```

## Referencia de la API

| Método | Descripción | Retorna |
|--------|-------------|---------|
| `putObject({ file, key?, bucket?, metadata? })` | Subir un archivo | `UploadFileResult` |
| `getSignedUrl(key, bucket?)` | Obtener URL de descarga + metadatos | `DownloadConfig` |
| `getObject(key, bucket?)` | Descargar como objeto `File` | `File \| null` |
| `deleteObject(key, bucket?)` | Eliminar un archivo | `void` |
| `listObjects(prefix, options?)` | Listar archivos por prefijo | `StorageListResult` |

## Próximos pasos

- **[Configuración de almacenamiento](/docs/backend/storage)** — Configura S3 o almacenamiento local en el servidor
- **[Consulta de datos](/docs/sdk/querying)** — Operaciones CRUD y constructor de consultas
- **[Autenticación](/docs/sdk/authentication)** — Inicio de sesión y gestión de sesiones
