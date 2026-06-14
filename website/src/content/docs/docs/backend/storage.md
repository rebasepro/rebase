---
title: Storage Configuration
sidebar_label: Storage Configuration
description: Configure local filesystem or S3-compatible storage backends for file uploads, images, and media.
---

## Overview

Rebase supports two storage backends:

- **Local filesystem** — Files stored on disk (great for development)
- **S3-compatible** — AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces

## Configuration

Storage is configured in the `storage` block of `initializeRebaseBackend`:

### Local Storage

```typescript
const backend = await initializeRebaseBackend({
    // ...
    storage: {
        type: "local",
        basePath: "./uploads"   // Directory for file storage
    }
});
```

### S3 Storage

```typescript
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

### Multiple Storage Backends

You can configure multiple named backends and route different fields to different storage:

```typescript
storage: {
    "(default)": { type: "local", basePath: "./uploads" },
    "media": { type: "s3", bucket: "media-bucket", region: "us-east-1", ... }
}
```

Then in your collection properties, reference a specific backend:

```typescript
image: {
    type: "string",
    name: "Image",
    storage: {
        storagePath: "products",
        backend: "media"       // Routes to the "media" S3 backend
    }
}
```

## Storage Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/storage/upload` | Upload a file |
| `GET` | `/api/storage/files/:path` | Download/serve a file |
| `DELETE` | `/api/storage/files/:path` | Delete a file |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STORAGE_TYPE` | `"local"` or `"s3"` |
| `STORAGE_PATH` | Local storage directory (default: `./uploads`) |
| `S3_BUCKET` | S3 bucket name |
| `S3_REGION` | AWS region (default: `"auto"`) |
| `S3_ACCESS_KEY_ID` | AWS access key |
| `S3_SECRET_ACCESS_KEY` | AWS secret key |
| `S3_ENDPOINT` | Custom S3 endpoint (for MinIO, R2) |
| `S3_FORCE_PATH_STYLE` | Use path-style URLs (required for MinIO) |

## Production Tips

:::caution
**Local storage is not suitable for production deployments** on ephemeral platforms (Cloud Run, Heroku, etc.) where the filesystem is wiped on each deploy. Use S3 for production.
:::

- Mount a **persistent volume** if using local storage on Docker/Kubernetes
- Use **S3** or compatible (R2, MinIO) for production deployments
- Configure a **CDN** (CloudFront, Cloudflare) in front of your S3 bucket for performance

## Next Steps

- **[Frontend Storage & File Uploads](/docs/frontend/storage)** — File upload fields and hooks
- **[Properties](/docs/collections/properties)** — Storage property configuration
