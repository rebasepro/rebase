---
sourceHash: 3e810cd447c9dd8a
title: Almacenamiento y subida de archivos
sidebar_label: Almacenamiento y subida de archivos
description: Añade campos de subida de archivos a tus colecciones, gestiona archivos de forma programática y enruta las subidas a diferentes backends de almacenamiento.
---

## Descripción general

Rebase proporciona soporte integrado para la subida de archivos en los formularios de colecciones:

- Campos de subida de archivos con **arrastrar y soltar**
- **Vistas previas de imágenes** en formularios y celdas de tabla
- **Subida de múltiples archivos** mediante propiedades de tipo array
- **Filtrado por tipo MIME** y límites de tamaño
- **Nombres de archivo personalizados** mediante funciones callback

## Campos de subida de archivos

Un campo de archivo es una propiedad de tipo string con un bloque `storage`, o un array de ellos para varios archivos. [Campos de subida de archivos](/docs/collections/file-uploads/) explica cómo declarar uno: cada opción de `storage` y cuáles de ellas hace cumplir el servidor en lugar de solo el cargador del panel.

## Almacenamiento multi-backend

Cuando tu backend tiene múltiples backends de almacenamiento configurados (por ejemplo, local + S3 + GCS), puedes enrutar propiedades individuales a backends específicos usando `storageSource`:

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

### Fuentes directas de frontend

Para backends de almacenamiento **directos** (por ejemplo, Firebase Storage, donde el navegador sube directamente a la nube), regístralos a través de la prop `storageSources` en `<Rebase>`:

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
| `key` | `string` | Identificador único — debe coincidir con `storageSource` en las configuraciones de propiedades |
| `engine` | `string` | Nombre del motor de almacenamiento (por ejemplo, `"firebase"`, `"gcs"`, `"s3"`) |
| `transport` | `"server" \| "direct"` | `"server"` actúa como proxy a través del backend; `"direct"` sube desde el navegador |
| `source` | `StorageSource` | Implementación de `StorageSource` en el lado del cliente (requerida para el transporte `"direct"`) |

El sistema resuelve automáticamente la fuente correcta por propiedad: las propiedades de colección con `storageSource: "firebase"` usarán la fuente directa coincidente, mientras que las propiedades sin `storageSource` (o con `transport: "server"`) se canalizarán a través del backend de Rebase.

## Hook useStorageSource

Para operaciones programáticas de archivos fuera de los formularios de colecciones:

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
`useStorageSource()` devuelve la fuente de almacenamiento **predeterminada**. Para configuraciones multi-backend, la resolución por propiedad se maneja automáticamente mediante las vinculaciones de campos de formulario y el `StorageSourcesContext`. En la mayoría de los casos, no necesitas resolver las fuentes manualmente.
:::

## Próximos pasos

- **[Configuración de almacenamiento del backend](/docs/backend/storage)** — Configuración de S3, GCS y almacenamiento local
- **[Propiedades](/docs/collections/properties)** — Todos los tipos de propiedades, incluido el almacenamiento
