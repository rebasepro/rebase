---
sourceHash: 81774bf42418ed00
title: Configuración de Almacenamiento
sidebar_label: Configuración de Almacenamiento
description: Configure backends de almacenamiento en el sistema de archivos local, compatibles con S3 o GCS/Firebase Storage para subidas de archivos, imágenes y medios.
---

## Resumen

Rebase admite tres backends de almacenamiento:

- **Sistema de archivos local** — Archivos almacenados en disco (ideal para desarrollo)
- **Compatible con S3** — AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces
- **Google Cloud Storage / Firebase Storage** — Soporte nativo de GCS mediante `@google-cloud/storage`

## Configuración

El almacenamiento se configura en el bloque `storage` de `initializeRebaseBackend`:

### Almacenamiento Local

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

En GCP (Cloud Run, GCE, GKE), las credenciales de la cuenta de servicio predeterminada se usan automáticamente. Fuera de GCP, establezca la variable de entorno `GOOGLE_APPLICATION_CREDENTIALS` con la ruta al archivo de clave de su cuenta de servicio.

### Múltiples Backends de Almacenamiento

Puede configurar varios backends con nombre y enrutar distintos campos a distintos almacenamientos:

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

## Endpoints de Almacenamiento

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/storage/upload` | Subida directa de archivos |
| `POST` | `/api/storage/upload?storageId=<key>` | Subir a un backend con nombre específico |
| `GET` | `/api/storage/files/:path` | Recuperar un archivo |
| `GET` | `/api/storage/files/:path?storageId=<key>` | Recuperar un archivo de un backend específico |
| `DELETE` | `/api/storage/files/:path` | Eliminar un archivo |
| `OPTIONS` | `/api/storage/tus` | Consultar las capacidades soportadas del protocolo TUS |
| `POST` | `/api/storage/tus` | Iniciar una sesión de subida reanudable TUS |
| `HEAD` | `/api/storage/tus/:id` | Comprobar el progreso de la subida (offset de bytes) |
| `PATCH` | `/api/storage/tus/:id` | Añadir un fragmento de datos al archivo temporal |
| `DELETE` | `/api/storage/tus/:id` | Terminar/abortar la sesión de subida TUS |

## Transformaciones de Imagen al Vuelo

Rebase incluye un pipeline de procesamiento de imágenes integrado impulsado por **Sharp**. Al servir recursos de imagen desde el almacenamiento, puede aplicar operaciones dinámicas usando parámetros de consulta:

```bash
# Serve image scaled to 300px width in webp format
GET /api/storage/files/products/laptop.jpg?width=300&format=webp
```

### Parámetros Soportados

- `width`: Redimensiona la imagen al ancho especificado (manteniendo la relación de aspecto).
- `format`: Convierte el formato de la imagen. Formatos soportados: `webp`, `jpeg`, `png`, `avif`.

### Rendimiento y Caché LRU

Para evitar un uso elevado de CPU y latencia de escalado bajo tráfico intenso, las imágenes procesadas se almacenan en una **caché LRU** respaldada por memoria:
- **Capacidad**: Limitada a **500 entradas** globalmente.
- **TTL (tiempo de vida)**: Las variantes en caché expiran después de **1 hora**.
- Las peticiones posteriores para la misma combinación de tamaño/formato aciertan en la caché LRU al instante, evitando la manipulación redundante de archivos.

## Protocolo de Subida Reanudable TUS

Para subir archivos grandes (hasta **5 GB**) o gestionar condiciones de red inestables, Rebase implementa el protocolo abierto **TUS v1.0.0**, incluidas las extensiones `Creation` y `Termination`.

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

### Mecánica del Ciclo de Vida de la Subida

1. **Inicialización de la sesión (`POST`)**: El cliente envía el tamaño total del archivo en la cabecera `Upload-Length` y los metadatos en base64 mediante `Upload-Metadata`. El servidor crea un archivo marcador de posición vacío bajo un directorio temporal oculto `.tus-uploads/` y devuelve la URL de subida.
2. **Consultas de progreso (`HEAD`)**: Si una subida se interrumpe, el cliente consulta la URL de subida mediante una petición `HEAD`. El servidor devuelve la posición actual de bytes en la cabecera `Upload-Offset`.
3. **Adición de datos (`PATCH`)**: El cliente reanuda el envío de datos binarios comenzando en el offset devuelto con `Content-Type: application/offset+octet-stream`. El servidor escribe los fragmentos entrantes directamente en el archivo temporal usando las APIs de bajo nivel `open` y `write` de Node en el offset de bytes especificado.
4. **Finalización**: Cuando el `Upload-Offset` acumulado coincide con el `Upload-Length` declarado, Rebase lee el archivo temporal completado, lo envuelve como un objeto `File` estándar de JavaScript y lo guarda en el backend de almacenamiento configurado (disco local o S3). El archivo temporal se elimina a continuación.
5. **Barrido periódico**: Un limpiador en segundo plano se ejecuta cada **60 segundos** para eliminar las subidas temporales incompletas y huérfanas que hayan superado el umbral de retención de **24 horas**.

## Variables de Entorno

| Variable | Descripción |
|----------|-------------|
| `STORAGE_TYPE` | `"local"`, `"s3"` o `"gcs"` |
| `STORAGE_PATH` | Directorio de almacenamiento local (por defecto: `./uploads`) |
| `S3_BUCKET` | Nombre del bucket de S3 |
| `S3_REGION` | Región de AWS (por defecto: `"auto"`) |
| `S3_ACCESS_KEY_ID` | Clave de acceso de AWS |
| `S3_SECRET_ACCESS_KEY` | Clave secreta de AWS |
| `S3_ENDPOINT` | Endpoint S3 personalizado (para MinIO, R2) |
| `S3_FORCE_PATH_STYLE` | Usar URL de estilo path (requerido para MinIO) |
| `GCS_BUCKET` | Nombre del bucket de Google Cloud Storage |
| `GCS_PROJECT_ID` | ID del proyecto de GCP para GCS |
| `GOOGLE_APPLICATION_CREDENTIALS` | Ruta al archivo de clave de la cuenta de servicio de GCP (no necesario en GCP con credenciales predeterminadas) |

## Fuentes de Almacenamiento del Frontend

Cuando use varios backends de almacenamiento, pase `storageSources` al proveedor `<Rebase>` para que el frontend sepa cómo enrutar las subidas directamente:

```tsx
import { Rebase } from "@rebasepro/app";

<Rebase
    apiUrl="https://api.example.com"
    storageSources={[
        { key: "media", label: "Media CDN" },
        { key: "firebase", label: "Firebase Storage" },
    ]}
>
    {/* ... */}
</Rebase>
```

La `key` de cada fuente debe coincidir con una clave de backend registrada en el mapa `storage` del servidor. El contexto de React `StorageSourcesContext` resuelve la fuente activa para cada campo de subida.

## Consejos para Producción

:::caution
**En producción, `type: "local"` desactiva el almacenamiento de archivos en lugar de usarlo.** En plataformas efímeras (Cloud Run, Heroku, un pod de Kubernetes) el sistema de archivos se borra en cada despliegue, reinicio y desalojo: las subidas funcionarían, se leerían bien y desaparecerían en el siguiente despliegue, sin ningún error.

Por eso no se registra ningún backend de almacenamiento y `/api/storage/*` responde **`501 STORAGE_NOT_CONFIGURED`**. Las subidas fallan de forma visible y recuperable, y el resto de la aplicación sigue funcionando.

Configure `STORAGE_TYPE=s3` o `gcs`. Si realmente hay un **volumen duradero** montado en `STORAGE_PATH`, indíquelo explícitamente con `FORCE_LOCAL_STORAGE=true`.
:::

- Monte un **volumen persistente** si usa almacenamiento local en Docker/Kubernetes, y configure `FORCE_LOCAL_STORAGE=true`
- Use **S3** o compatible (R2, MinIO) para despliegues en producción
- Configure una **CDN** (CloudFront, Cloudflare) delante de su bucket de S3 para rendimiento

## Próximos Pasos

- **[Almacenamiento y Subida de Archivos en el Frontend](/docs/frontend/storage)** — Campos y hooks para subir archivos
- **[Propiedades](/docs/collections/properties)** — Configuración de la propiedad de almacenamiento
