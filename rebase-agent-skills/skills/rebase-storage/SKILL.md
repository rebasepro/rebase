---
name: rebase-storage
description: Guide for setting up and using file storage in Rebase. Use this skill when the user needs to configure S3 or local file storage, handle file uploads, or integrate the media manager.
---

# Rebase Storage

Rebase provides built-in file storage with support for S3-compatible services and local filesystem storage.

## Storage Providers

### Local Storage

Store files on the local filesystem. Best for development and simple deployments.

```typescript
import { initializeRebaseBackend, HonoEnv } from "@rebasepro/server-core";
import { createPostgresDatabaseConnection, createPostgresBootstrapper } from "@rebasepro/server-postgresql";

const { db, connectionString } = createPostgresDatabaseConnection(process.env.DATABASE_URL!);

const backend = await initializeRebaseBackend({
    server, app,
    bootstrappers: [
        createPostgresBootstrapper({
            connection: db,
            schema: { tables, enums, relations },
            adminConnectionString: process.env.DATABASE_URL,
            connectionString
        })
    ],
    storage: {
        type: "local",
        basePath: "./uploads",
        maxFileSize: 50 * 1024 * 1024, // 50MB (default)
        baseUrl: "http://localhost:3001/api/storage",
    },
});
```

> [!TIP]
> In production, the backend will log a warning if you use local storage without setting `FORCE_LOCAL_STORAGE=true`. Local files will be lost if the container restarts — use S3 for production.

### S3-Compatible Storage

Works with AWS S3, MinIO, DigitalOcean Spaces, Cloudflare R2, and any S3-compatible service.

```typescript
const backend = await initializeRebaseBackend({
    server, app,
    bootstrappers: [
        createPostgresBootstrapper({
            connection: db,
            schema: { tables, enums, relations },
            adminConnectionString: process.env.DATABASE_URL,
            connectionString
        })
    ],
    storage: {
        type: "s3",
        bucket: process.env.S3_BUCKET!,
        region: process.env.S3_REGION,
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
        endpoint: process.env.S3_ENDPOINT,       // For MinIO, R2, etc.
        forcePathStyle: true,                     // Required for MinIO
        signedUrlExpiration: 3600,                // URL expiry (seconds)
    },
});
```

### Multiple Storage Backends

Rebase supports multiple storage backends simultaneously:

```typescript
const backend = await initializeRebaseBackend({
    server, app,
    bootstrappers: [
        createPostgresBootstrapper({
            connection: db,
            schema: { tables, enums, relations },
            adminConnectionString: process.env.DATABASE_URL,
            connectionString
        })
    ],
    storage: {
        "(default)": { type: "local", basePath: "./uploads" },
        "media": { type: "s3", bucket: "my-media-bucket", accessKeyId: "...", secretAccessKey: "..." },
    },
});
```

### Environment-Based Configuration

The backend uses a Zod-validated env schema for storage. When `STORAGE_TYPE=s3`, all S3 variables are expected:

```env
STORAGE_TYPE=s3
S3_BUCKET=my-bucket
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=AKIA...
S3_SECRET_ACCESS_KEY=...
S3_ENDPOINT=https://minio.example.com    # Optional: for MinIO, R2, etc.
S3_FORCE_PATH_STYLE=true                 # Optional: for MinIO
```

## File Upload Properties

Define file upload fields in your collections using the `storage` option on string properties:

```typescript
import { PostgresCollection } from "@rebasepro/types";

const productsCollection: PostgresCollection = {
    name: "Products",
    table: "products",
    properties: {
        image: {
            name: "Product Image",
            type: "string",
            storage: {
                storagePath: "products/images",
                acceptedFiles: ["image/*"],
                maxSize: 5 * 1024 * 1024, // 5MB
            }
        },
        documents: {
            name: "Documents",
            type: "array",
            of: {
                type: "string",
                storage: {
                    storagePath: "products/documents",
                    acceptedFiles: ["application/pdf", "application/msword"],
                }
            }
        }
    }
};
```

## Storage Browser

The `@rebasepro/studio` package includes a built-in `StorageView` component in the Studio:
- Browse uploaded files and folders with a tree sidebar
- Drag-and-drop file uploads
- Image, video, and audio previews with metadata
- File search and filtering
- Grid and list view modes

## Storage API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/storage/upload` | Upload a file |
| `GET` | `/api/storage/:path` | Download a file |
| `DELETE` | `/api/storage/:path` | Delete a file |

## References

- **Documentation:** [rebase.pro/docs](https://rebase.pro/docs)
- **GitHub:** [github.com/rebasepro/rebase](https://github.com/rebasepro/rebase)
