---
sourceHash: 7a0c74973860c714
title: Almacenamiento y Archivos
sidebar_label: Almacenamiento
description: Suba, descargue, liste y elimine archivos con el módulo de almacenamiento del SDK del Cliente de Rebase.
---

## Resumen

El módulo `client.storage` proporciona métodos para la gestión de archivos — subida, descarga, listado y eliminación. Funciona tanto con disco local como con backends de almacenamiento compatibles con S3, según la configuración de su servidor.

Todos los métodos de almacenamiento utilizan el transporte compartido, por lo que los tokens de autenticación se inyectan automáticamente.

## Subir un Archivo

Use `putObject()` para subir un archivo. Acepta un objeto `File` o `Blob` junto con una clave de almacenamiento y metadatos opcionales:

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

### Desde un Campo de Archivo

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

## Obtener una URL Firmada

Recupere una URL de descarga y los metadatos de un archivo almacenado:

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

:::caution[El argumento `bucket` es hoy un prefijo de ruta]
En `getSignedUrl`, `getObject` y `deleteObject`, el segundo argumento se pliega dentro de la clave del objeto (`<bucket>/<key>`) y nunca llega al servidor como bucket, así que un nombre que el despliegue no sirve se reporta como *archivo* ausente, no como bucket desconocido — y un archivo escrito con `putObject({ bucket: "media" })` no se lee de vuelta con `getSignedUrl(key, "media")`. Lea un archivo con la misma forma de llamada que lo escribió. El lado del servidor ya responde `404 UNKNOWN_STORAGE_SOURCE` en `/api/storage/list`; el argumento del SDK se está reelaborando para coincidir.
:::

Con un bucket específico:

```typescript
const { url } = await client.storage.getSignedUrl(
    "camera.jpg",
    "product-images"   // bucket
);
```

El SDK almacena en caché las URL firmadas para evitar llamadas redundantes al servidor.

### URL privadas vs. públicas

- **Los archivos privados** obtienen una URL con un **token de descarga de corta duración y limitado a la ruta** (`?token=…`, 5 min por defecto) — nunca su token de acceso. Como caduca, **no persista una URL privada**; almacene la **ruta** del archivo y vuelva a llamar a `getSignedUrl()` al renderizarlo.
- **Los archivos públicos** (almacenados bajo el prefijo `public/` — establezca `storage: { public: true }` en la propiedad, o pase `public: true` a `putObject`) obtienen una URL **estable, sin token, permanente y cacheable por CDN**, sin ida y vuelta al servidor. Son seguros para almacenar en una base de datos y enlazar directamente.

## Descargar un Archivo

Recupere un archivo como un objeto `File`:

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

## Eliminar un Archivo

```typescript
await client.storage.deleteObject("products/images/camera.jpg");

// With bucket
await client.storage.deleteObject("camera.jpg", "product-images");
```

Eliminar un archivo inexistente no lanza un error.

## Listar Archivos

Liste archivos por prefijo, con paginación opcional:

```typescript
const result = await client.storage.listObjects("products/images/", {
    bucket: "uploads",
    maxResults: 50,
    pageToken: undefined   // for pagination
});

for (const item of result.items) {
    console.log(item.fullPath, item.name);
}

// Paginate
if (result.nextPageToken) {
    const nextPage = await client.storage.listObjects("products/images/", {
        pageToken: result.nextPageToken
    });
}
```

## Formatos de Clave de Almacenamiento

El SDK gestiona de forma transparente los prefijos de las claves de almacenamiento. Puede pasar claves con o sin el prefijo de protocolo:

```typescript
// All equivalent — the SDK strips the prefix internally
await client.storage.getSignedUrl("local://products/image.jpg");
await client.storage.getSignedUrl("s3://products/image.jpg");
await client.storage.getSignedUrl("products/image.jpg");
```

## Referencia de la API

| Método | Descripción | Devuelve |
|--------|-------------|---------|
| `putObject({ file, key?, bucket?, metadata? })` | Subir un archivo | `UploadFileResult` |
| `getSignedUrl(key, bucket?)` | Obtener URL de descarga + metadatos | `DownloadConfig` |
| `getObject(key, bucket?)` | Descargar como objeto `File` | `File \| null` |
| `deleteObject(key, bucket?)` | Eliminar un archivo | `void` |
| `listObjects(prefix, options?)` | Listar archivos por prefijo | `StorageListResult` |

## Próximos Pasos

- **[Configuración de Almacenamiento](/docs/backend/storage)** — Configurar S3 o almacenamiento local en el servidor
- **[Consultar Datos](/docs/sdk/querying)** — Operaciones CRUD y constructor de consultas
- **[Autenticación](/docs/sdk/authentication)** — Inicio de sesión y gestión de sesiones
