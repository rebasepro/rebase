---
sourceHash: 1134b2a4207579d3
title: Almacenamiento y Subida de Archivos
sidebar_label: Almacenamiento y Subida de Archivos
description: Añada campos de subida de archivos a sus colecciones, gestione archivos programáticamente y enrute las subidas a distintos backends de almacenamiento.
---

## Resumen

Rebase proporciona soporte integrado de subida de archivos en los formularios de colección:

- Campos de subida de archivos **arrastrar y soltar**
- **Vistas previas de imágenes** en formularios y celdas de tabla
- **Subidas de múltiples archivos** mediante propiedades de array
- **Filtrado por tipo MIME** y límites de tamaño
- **Nombres de archivo personalizados** mediante funciones de callback

## Campos de Subida de Archivos

Para añadir subidas de archivos a una colección, use la configuración `storage` en una propiedad de tipo string:

```typescript
properties: {
    image: {
        type: "string",
        name: "Product Image",
        storage: {
            storagePath: "products",       // Subdirectory in storage
            acceptedFiles: ["image/*"],    // MIME type filter
            maxSize: 5 * 1024 * 1024,      // 5MB max
            fileName: (context) => {        // Custom filename
                return context.entityId + "_" + context.file.name;
            }
        }
    }
}
```

### Opciones de Configuración de Storage

| Propiedad | Tipo | Descripción |
|----------|------|-------------|
| `storagePath` | `string` | Subdirectorio dentro del backend de almacenamiento |
| `storageSource` | `string` | Fuente de almacenamiento con nombre — enruta las subidas a un backend específico (p. ej., `"firebase"`, `"media"`). Consulte [Almacenamiento Multi-Backend](#almacenamiento-multi-backend). |
| `public` | `boolean` | Almacena los archivos bajo el prefijo `public/` y los sirve mediante URL estables, sin token, permanentes y cacheables por CDN (seguras para persistir y enlazar directamente). El valor predeterminado es `false` (los archivos privados usan URL firmadas de corta duración). |
| `acceptedFiles` | `string[]` | Tipos MIME permitidos (p. ej., `["image/*"]`, `["application/pdf"]`) |
| `maxSize` | `number` | Tamaño máximo de archivo en bytes |
| `fileName` | `function` | Generador de nombres de archivo personalizado |
| `metadata` | `object` | Metadatos adicionales para almacenar con el archivo |
| `storeUrl` | `boolean` | Almacena la URL completa en lugar de la ruta relativa |

## Subidas de Múltiples Archivos

Envuelva la propiedad de storage en un array para subir varios archivos:

```typescript
photos: {
    type: "array",
    name: "Photos",
    of: {
        type: "string",
        storage: {
            storagePath: "photos",
            acceptedFiles: ["image/*"]
        }
    }
}
```

## Subidas de Documentos

Suba archivos que no sean imágenes, como PDFs:

```typescript
documents: {
    type: "array",
    name: "Documents",
    of: {
        type: "string",
        storage: {
            storagePath: "documents",
            acceptedFiles: ["application/pdf", "image/*"]
        }
    }
}
```

## Almacenamiento Multi-Backend

Cuando su backend tiene varios backends de almacenamiento configurados (p. ej., local + S3 + GCS), puede enrutar propiedades individuales a backends específicos usando `storageSource`:

```typescript
image: {
    type: "string",
    name: "Product Image",
    storage: {
        storageSource: "firebase",     // Routes to the "firebase" backend
        storagePath: "products/{entityId}",
        acceptedFiles: ["image/*"],
    }
}
```

### Fuentes Directas del Frontend

Para backends de almacenamiento **directos** (p. ej., Firebase Storage, donde el navegador sube directamente a la nube), regístrelos mediante la prop `storageSources` en `<Rebase>`:

```tsx
import type { RebaseStorageSource } from "@rebasepro/app";

<Rebase
    client={rebaseClient}
    storageSources={[
        { key: "firebase", engine: "firebase", transport: "direct", source: firebaseStorageSource }
    ]}
>
    {/* your app */}
    …
</Rebase>
```

| Propiedad | Tipo | Descripción |
|----------|------|-------------|
| `key` | `string` | Identificador único — debe coincidir con `storageSource` en las configuraciones de propiedad |
| `engine` | `string` | Nombre del motor de almacenamiento (p. ej., `"firebase"`, `"gcs"`, `"s3"`) |
| `transport` | `"server" \| "direct"` | `"server"` hace de proxy a través del backend; `"direct"` sube desde el navegador |
| `source` | `StorageSource` | Implementación `StorageSource` del lado del cliente (requerida para el transporte `"direct"`) |

El sistema resuelve automáticamente la fuente correcta por propiedad — las propiedades de colección con `storageSource: "firebase"` usarán la fuente directa coincidente, mientras que las propiedades sin `storageSource` (o con `transport: "server"`) harán de proxy a través del backend de Rebase.

## Hook useStorageSource

Para operaciones de archivo programáticas fuera de los formularios de colección:

```typescript
import { useStorageSource } from "@rebasepro/app";

// Returns the default storage source
const storageSource = useStorageSource();

// Upload a file — the object is addressed by `key`
const result = await storageSource.putObject({
    file,
    key: "documents/my-file.pdf"
});

// Get a download URL
const { url } = await storageSource.getSignedUrl(result.key);
```

:::tip
`useStorageSource()` devuelve la fuente de almacenamiento **predeterminada**. Para configuraciones multi-backend, la resolución por propiedad la gestionan automáticamente los bindings de campo de formulario y el `StorageSourcesContext`. En la mayoría de los casos no necesita resolver las fuentes manualmente.
:::

## Próximos Pasos

- **[Configuración de Almacenamiento del Backend](/docs/backend/storage)** — Configuración de S3, GCS y almacenamiento local
- **[Propiedades](/docs/collections/properties)** — Todos los tipos de propiedad, incluido storage
