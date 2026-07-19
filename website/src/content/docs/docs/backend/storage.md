---
title: Storage Configuration
sidebar_label: Storage Configuration
description: Configure local filesystem, S3-compatible, or GCS/Firebase Storage backends for file uploads, images, and media.
---

## Overview

Rebase supports three storage backends:

- **Local filesystem** — Files stored on disk (great for development)
- **S3-compatible** — AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces
- **Google Cloud Storage / Firebase Storage** — Native GCS support via `@google-cloud/storage`

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

### GCS / Firebase Storage

```typescript
const backend = await initializeRebaseBackend({
    // ...
    storage: {
        type: "gcs",
        bucket: env.GCS_BUCKET!,
        projectId: env.GCS_PROJECT_ID,
    }
});
```

On GCP (Cloud Run, GCE, GKE), the default service account credentials are used automatically. Outside GCP, set the `GOOGLE_APPLICATION_CREDENTIALS` environment variable to the path of your service account key file.

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
        storageSource: "media"  // Routes to the "media" S3 backend
    }
}
```

## Storage Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/storage/upload` | Direct file upload |
| `POST` | `/api/storage/upload?storageId=<key>` | Upload to a specific named backend |
| `GET` | `/api/storage/files/:path` | Retrieve a file |
| `GET` | `/api/storage/files/:path?storageId=<key>` | Retrieve a file from a specific backend |
| `DELETE` | `/api/storage/files/:path` | Delete a file |
| `OPTIONS` | `/api/storage/tus` | Query supported TUS protocol capabilities |
| `POST` | `/api/storage/tus` | Initiate a resumable TUS upload session |
| `HEAD` | `/api/storage/tus/:id` | Check upload progress (byte offset) |
| `PATCH` | `/api/storage/tus/:id` | Append data chunk to temporary file |
| `DELETE` | `/api/storage/tus/:id` | Terminate/abort TUS upload session |

## On-the-Fly Image Transformations

Rebase includes a built-in image processing pipeline powered by **Sharp**. When serving image assets from storage, you can apply dynamic operations using query parameters:

```bash
# Serve image scaled to 300px width in webp format
GET /api/storage/files/products/laptop.jpg?width=300&format=webp
```

### Supported Parameters

- `width`: Resizes the image to the specified width (maintaining aspect ratio).
- `format`: Converts the image format. Supported formats: `webp`, `jpeg`, `png`, `avif`.

### Performance & LRU Caching

To prevent high CPU utilization and scaling latency under heavy traffic, processed images are stored in a memory-backed **LRU Cache**:
- **Capacity**: Capped at **500 entries** globally.
- **TTL (Time to Live)**: Cached variants expire after **1 hour**.
- Subsequent requests for the same size/format combination hit the LRU cache instantly, preventing redundant file manipulation.

## TUS Resumable Upload Protocol

For uploading large files (up to **5GB**) or handling unstable network conditions, Rebase implements the **TUS v1.0.0** open protocol including the `Creation` and `Termination` extensions.

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

### Upload Lifecycle Mechanics

1. **Session Initialisation (`POST`)**: The client sends the total file size in the `Upload-Length` header and base64 metadata via `Upload-Metadata`. The server creates an empty placeholder file under a hidden temporary directory `.tus-uploads/` and returns the upload URL.
2. **Progress Inquiries (`HEAD`)**: If an upload is interrupted, the client queries the upload URL using a `HEAD` request. The server returns the current byte position in the `Upload-Offset` header.
3. **Data Appending (`PATCH`)**: The client resumes sending binary data starting at the returned offset with `Content-Type: application/offset+octet-stream`. The server writes incoming chunks directly to the temporary file using Node's low-level `open` and `write` file system APIs at the specified byte offset.
4. **Finalisation**: When the accumulated `Upload-Offset` matches the declared `Upload-Length`, Rebase reads the completed temporary file, wraps it as a standard JavaScript `File` object, and saves it to the configured storage backend (local disk or S3). The temporary file is then deleted.
5. **Periodic Sweep**: A background cleaner runs every **60 seconds** to delete orphaned, incomplete temporary uploads that have exceeded the **24-hour** retention threshold.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STORAGE_TYPE` | `"local"`, `"s3"`, or `"gcs"` |
| `STORAGE_PATH` | Local storage directory (default: `./uploads`) |
| `S3_BUCKET` | S3 bucket name |
| `S3_REGION` | AWS region (default: `"auto"`) |
| `S3_ACCESS_KEY_ID` | AWS access key |
| `S3_SECRET_ACCESS_KEY` | AWS secret key |
| `S3_ENDPOINT` | Custom S3 endpoint (for MinIO, R2) |
| `S3_FORCE_PATH_STYLE` | Use path-style URLs (required for MinIO) |
| `GCS_BUCKET` | Google Cloud Storage bucket name |
| `GCS_PROJECT_ID` | GCP project ID for GCS |
| `GCS_KEY_FILENAME` | Path to a GCP service account key file (omit on GKE — Workload Identity/ADC supplies credentials) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Standard ADC variable, read by the Google SDK itself (not needed on GCP with default credentials) |
| `FORCE_LOCAL_STORAGE` | Allow `STORAGE_TYPE=local` in production — see below |

## Frontend Storage Sources

When using multiple storage backends, pass `storageSources` to the `<Rebase>` provider so the frontend knows how to route uploads directly:

```tsx
import { Rebase } from "@rebasepro/admin";

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

Each source's `key` must match a backend key registered in the server's `storage` map. The `StorageSourcesContext` React context resolves the active source for each upload field.

## Production Tips

:::caution
**In production the backend refuses to boot on `type: "local"`.** On an ephemeral platform (Cloud Run, Heroku, a Kubernetes pod) the filesystem is wiped on every deploy, restart and eviction — so uploads succeed, read back fine, and are gone at the next rollout, with no error at any point. A failed boot is recoverable; lost user files are not.

Set `STORAGE_TYPE=s3` or `gcs`. If a **durable volume** really is mounted at `STORAGE_PATH`, set `FORCE_LOCAL_STORAGE=true` to say so explicitly.
:::

- Mount a **persistent volume** if using local storage on Docker/Kubernetes, and set `FORCE_LOCAL_STORAGE=true`
- Use **S3** or compatible (R2, MinIO), or **GCS**, for production deployments
- Configure a **CDN** (CloudFront, Cloudflare) in front of your bucket for performance
- **Multi-tenant apps must set `storageAuthorize`** — see below

## Per-Object Authorization

`requireAuth` and `publicRead` are *global* switches: they decide whether a caller must be signed in, not what that caller may touch. Without an authorization hook, **any authenticated user can read any key they can name** — the only thing separating two tenants' files is key unguessability, which is not an access-control model.

`storageAuthorize` is the storage analogue of a collection's security rules, and runs after authentication on every storage route:

```typescript
await initializeRebaseBackend({
    storage: { type: "s3", bucket: "app-files", /* ... */ },
    storageAuthorize: async ({ key, bucket, operation, user }) => {
        if (!user) return false;
        // Keys are laid out as `{teamId}/{docId}/...`
        const [teamId] = key.split("/");
        return isTeamMember(user.userId, teamId);
    }
});
```

| Field | Description |
|-------|-------------|
| `key` | Object key, bucket prefix stripped and traversal sanitized |
| `bucket` | Resolved bucket (`"default"` when unspecified) |
| `operation` | `"read"`, `"write"`, `"delete"` or `"list"` |
| `user` | `{ userId, email?, roles? }`, or `null` where the route allows anonymous access |
| `storageId` | The named backend, when the request targeted one |

Return `false` to deny with a **403**. Throwing also denies — an ownership lookup that fails does not fall open.

Worth knowing:

- **The metadata route is where read access is really decided.** It mints the short-lived path-scoped download token that the file route trusts, so the hook gates it there. Requests already carrying such a token, or hitting a declared public path, skip the hook — the token was minted under it and is valid only for its own path.
- **`list` is gated on the prefix.** Listing is how you discover keys nobody told you about.
- **Resumable (TUS) uploads are gated at create time**, so a denied upload leaves no temp file behind.
- Omitting the hook preserves the previous behaviour, so single-tenant apps are unaffected.

## Next Steps

- **[Frontend Storage & File Uploads](/docs/frontend/storage)** — File upload fields and hooks
- **[Properties](/docs/collections/properties)** — Storage property configuration
