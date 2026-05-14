---
title: Almacenamiento
sidebar_label: Almacenamiento
description: Configure el almacenamiento de archivos con sistemas de archivos locales o backends compatibles con S3 para cargas de archivos, imágenes y medios.
---

## Resumen

Rebase proporciona almacenamiento de archivos integrado con dos opciones de backend:

- **Sistema de archivos local** — Archivos almacenados en disco (ideal para desarrollo)
- **Compatible con S3** — AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces

## Configuración del Backend

### Almacenamiento Local

```typescript
await initializeRebaseBackend({
    // ...
    storage: {
        type: "local",
        basePath: "./uploads"   // Directorio para el almacenamiento de archivos
    }
});
```

### Almacenamiento S3

```typescript
import { env } from "./env";

await initializeRebaseBackend({
    // ...
    storage: {
        type: "s3",
        bucket: env.S3_BUCKET!,
        region: env.S3_REGION || "us-east-1",
        accessKeyId: env.S3_ACCESS_KEY_ID!,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
        // Opcional: endpoint personalizado para MinIO, R2, etc.
        endpoint: env.S3_ENDPOINT
    }
});
```

### Múltiples Backends de Almacenamiento

Puede configurar múltiples backends de almacenamiento y enrutar diferentes campos a diferentes backends:

```typescript
storage: {
    "(default)": { type: "local", basePath: "./uploads" },
    "media": { type: "s3", bucket: "media-bucket", region: "us-east-1", ... }
}
```

## Endpoints de Almacenamiento

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/storage/upload` | Subir un archivo |
| `GET` | `/api/storage/files/:path` | Descargar/servir un archivo |
| `DELETE` | `/api/storage/files/:path` | Eliminar un archivo |

## Frontend: Campos de Carga de Archivos

Para añadir cargas de archivos a sus colecciones, use la propiedad `storage` en campos de tipo string:

```typescript
properties: {
    image: {
        type: "string",
        name: "Imagen del Producto",
        storage: {
            storagePath: "products",       // Subdirectorio en el almacenamiento
            acceptedFiles: ["image/*"],    // Filtro de tipo MIME
            maxSize: 5 * 1024 * 1024,      // 5MB máximo
            fileName: (context) => {        // Nombre de archivo personalizado
                return context.entityId + "_" + context.file.name;
            }
        }
    },
    documents: {
        type: "array",
        name: "Documentos",
        of: {
            type: "string",
            storage: {
                storagePath: "documents",
                acceptedFiles: ["application/pdf", "image/*"]
            }
        }
    }
}
```

![Campo de carga de archivos](/img/fields/File_upload.png)

### Opciones de Configuración de Almacenamiento

| Propiedad | Tipo | Descripción |
|----------|------|-------------|
| `storagePath` | `string` | Subdirectorio dentro del backend de almacenamiento |
| `acceptedFiles` | `string[]` | Tipos MIME permitidos (p. ej., `["image/*"]`, `["application/pdf"]`) |
| `maxSize` | `number` | Tamaño máximo de archivo en bytes |
| `fileName` | `function` | Generador de nombre de archivo personalizado |
| `metadata` | `object` | Metadatos adicionales para almacenar con el archivo |
| `storeUrl` | `boolean` | Almacena la URL completa en lugar de la ruta relativa |

### Cargas de Múltiples Archivos

Envuelva la propiedad storage en un array para cargas de múltiples archivos:

```typescript
photos: {
    type: "array",
    name: "Fotos",
    of: {
        type: "string",
        storage: {
            storagePath: "photos",
            acceptedFiles: ["image/*"]
        }
    }
}
```

![Carga de múltiples archivos](/img/fields/Multi_file_upload.png)

## Frontend: Hook useStorageSource

Para operaciones programáticas de archivos:

```typescript
import { useStorageSource } from "@rebasepro/core";

const storageSource = useStorageSource();

// Subir un archivo
const result = await storageSource.uploadFile({
    file,
    fileName: "my-file.pdf",
    path: "documents"
});

// Obtener URL de descarga
const url = await storageSource.getDownloadURL(result.path);
```

## Consejos de Producción

:::caution
**El almacenamiento local no es adecuado para despliegues de producción** en plataformas efímeras (Cloud Run, Heroku, etc.) donde el sistema de archivos se borra con cada despliegue. Use S3 para producción.
:::

- Monte un **volumen persistente** si usa almacenamiento local en Docker/Kubernetes
- Use **S3** o compatible (R2, MinIO) para despliegues de producción
- Configure una **CDN** (CloudFront, Cloudflare) delante de su bucket S3 para mejorar el rendimiento

## Siguientes Pasos

- **[SDK del Cliente](/docs/sdk)** — Operaciones programáticas de datos y archivos
- **[Propiedades](/docs/collections/properties)** — Todos los tipos de propiedad
