---
name: rebase-storage
description: Guide for setting up and using file storage in Rebase. Use this skill when the user needs to configure S3, Google Cloud Storage (GCS), or local file storage, handle file uploads, TUS resumable uploads, image transformations, multi-backend frontend storage sources, or integrate the media manager.
---

# Rebase Storage

Rebase provides built-in file storage with support for local filesystem, S3-compatible services, and Google Cloud Storage (GCS), TUS v1.0.0 resumable uploads, on-the-fly image transformation, a multi-backend registry, and frontend storage sources.

> **IMPORTANT FOR AGENTS:** Always read the `rebase-basics` skill first before using this skill. Storage requires a running Rebase backend with `initializeRebaseBackend()`.

## Storage Configuration

The `storage` option in `initializeRebaseBackend()` accepts three forms:

| Form | Type | Description |
|------|------|-------------|
| Single config | `BackendStorageConfig` | `{ type: 'local' | 's3' | 'gcs', ... }` — creates a single `(default)` backend |
| Single controller | `StorageController` | A custom controller instance — registered as `(default)` |
| Multi-backend map | `Record<string, BackendStorageConfig \| StorageController>` | Named backends, first becomes `(default)` if no `(default)` key |

### LocalStorageConfig

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `type` | `"local"` | — | **Required.** Must be `"local"` |
| `basePath` | `string` | — | **Required.** Base directory for file storage (e.g., `"./uploads"`) |
| `maxFileSize` | `number` | `52428800` (50 MB) | Maximum file size in bytes |
| `allowedMimeTypes` | `string[]` | `undefined` (all allowed) | Restrict uploads to these MIME types |
| `baseUrl` | `string` | Auto-detected | Base URL for generating download URLs |

### S3StorageConfig

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `type` | `"s3"` | — | **Required.** Must be `"s3"` |
| `bucket` | `string` | — | **Required.** S3 bucket name |
| `accessKeyId` | `string` | — | **Required.** AWS access key ID |
| `secretAccessKey` | `string` | — | **Required.** AWS secret access key |
| `region` | `string` | `"us-east-1"` | AWS region |
| `endpoint` | `string` | `undefined` | Custom endpoint URL (required for MinIO, R2, Hetzner, etc.) |
| `forcePathStyle` | `boolean` | Auto-enabled when `endpoint` is set | Use path-style URLs (required for MinIO) |
| `maxFileSize` | `number` | `52428800` (50 MB) | Maximum file size in bytes |
| `allowedMimeTypes` | `string[]` | `undefined` (all allowed) | Restrict uploads to these MIME types |
| `signedUrlExpiration` | `number` | `3600` | Signed URL expiry in seconds |

### GCSStorageConfig

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `type` | `"gcs"` | — | **Required.** Must be `"gcs"` |
| `bucket` | `string` | — | **Required.** GCS bucket name |
| `projectId` | `string` | `undefined` | Google Cloud project ID (auto-detected from credentials if omitted) |
| `maxFileSize` | `number` | `52428800` (50 MB) | Maximum file size in bytes |
| `allowedMimeTypes` | `string[]` | `undefined` (all allowed) | Restrict uploads to these MIME types |
| `signedUrlExpiration` | `number` | `3600` | Signed URL expiry in seconds |

> **IMPORTANT FOR AGENTS:** GCS requires `@google-cloud/storage` as a peer dependency. Install it: `pnpm add @google-cloud/storage`. Authentication uses Application Default Credentials — set the `GOOGLE_APPLICATION_CREDENTIALS` environment variable to point to a service account key file, or rely on the default credentials when running on GCP.

### StorageRoutesConfig

These options are set internally when mounting routes but are derived from the backend config:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `controller` | `StorageController` | — | **Required.** The storage controller instance |
| `basePath` | `string` | `"/api/storage"` | Base path for storage routes |
| `requireAuth` | `boolean` | `true` | Require authentication for write operations |
| `publicRead` | `boolean` | `false` | Allow unauthenticated read access to stored files |
| `authorize` | `StorageAuthorize` | — | Per-object access control (see below) |

## Per-Object Authorization

> **REQUIRED FOR MULTI-TENANT APPS.** `requireAuth` and `publicRead` are *global* switches: they decide whether a caller must be signed in, not what that caller may touch. Without an `authorize` hook, **any authenticated user can read any key they can name** — the only thing separating two tenants' files is key unguessability, which is not an access-control model. Worse, they can `GET /storage/list?prefix=` first, so the keys need not even be guessed.

> **STORAGE REFUSES TO BOOT IN PRODUCTION WITHOUT ONE.** Collections are protected by row-level security; storage is not, and there is no per-object equivalent in the bucket — so this hook *is* the model. When storage is configured and `NODE_ENV=production`, `initializeRebaseBackend` **throws at startup** unless one of these is set:
>
> - `storageAuthorize` — a hook, per object. Recommended.
> - `storagePublicRead: true` — the bucket genuinely is a public read-only CDN.
> - `storageInsecureAllowAnyAuthenticated: true` — a single-tenant app where every signed-in user is trusted with every file. Named to be read twice.
>
> In development it logs a warning instead, so a project can be wrong about this and work fine locally right up until it is deployed. The environment spellings are `STORAGE_PUBLIC_READ` and `STORAGE_ALLOW_ANY_AUTHENTICATED`. A scaffolded project ships a hook in `config/storage.ts` already — read it before replacing it, and note that it models a CMS's *shared content library*, which is not the shape of per-user files.

Set `storageAuthorize` on `initializeRebaseBackend`. It is the storage analogue of a collection's security rules, and runs after authentication on every storage route:

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

| Field | Type | Description |
|-------|------|-------------|
| `key` | `string` | Object key, bucket prefix stripped and traversal sanitized |
| `bucket` | `string` | Resolved bucket (`"default"` when unspecified) |
| `operation` | `"read" \| "write" \| "delete" \| "list"` | What the request is attempting |
| `user` | `{ uid, email?, roles? } \| null` | Resolved caller; `null` when the route allows anonymous access |
| `storageId` | `string \| undefined` | Named backend, when the request targeted one |
| `data` | `StorageAuthorizeData \| undefined` | Trusted, **RLS-bypassing** read access — `data.collection(slug).find(query)` / `.findById(id)`. Ownership lives in a row, not in a key prefix, so the hook needs a reader to answer "who owns this object?". It bypasses RLS deliberately: this hook *is* the authorization decision, and making it through a reader already narrowed by the caller's own permissions would be circular. Read-only by design |

Return `false` to deny with a **403**. Throwing also denies — an ownership lookup that fails does not fall open.

Notes:

- **`GET /metadata/*` is the important one.** It mints the short-lived path-scoped download token that `GET /file/*` trusts, so it is where read access is really decided. The hook gates it.
- Requests already carrying a valid scoped download token, or hitting a declared public path, **skip** the hook — the token was minted under it and is valid only for its own path.
- `list` is gated on the *prefix*. Listing is how you discover keys nobody told you about.
- TUS resumable uploads are gated at create time, so a denied upload leaves no temp file behind.
- Omitting the hook preserves the previous behaviour, so single-tenant apps are unaffected.

## Storage Providers

### Local Storage

Store files on the local filesystem. Best for development and simple single-server deployments.

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";

const backend = await initializeRebaseBackend({
    server, app,
    bootstrappers: [/* ... */],
    storage: {
        type: "local",
        basePath: "./uploads",
        maxFileSize: 50 * 1024 * 1024, // 50MB (default)
        allowedMimeTypes: ["image/jpeg", "image/png", "application/pdf"],
        baseUrl: "http://localhost:3001/api/storage",
    },
});
```

> **WARNING FOR AGENTS:** in production the local backend is **not registered at all**. The backend still boots — data, auth and realtime keep serving — but the storage routes answer `501 STORAGE_NOT_CONFIGURED`, because local storage is the container filesystem and every uploaded file is destroyed on the next restart or redeploy, silently, with no error at write or read time. (Dropping the backend rather than throwing is deliberate: a crash-looping rollout would take the whole app down over uploads.) Use S3/GCS in production. `FORCE_LOCAL_STORAGE=true` re-registers it, and is only correct when a durable volume really is mounted at the storage path.

Local storage uses a `{basePath}/{bucket}/{path}` directory structure. The default bucket is `"default"`, and it is applied consistently across `putObject`, `getObject`, `deleteObject` and `listObjects` — a bare key round-trips. Every uploaded file gets a sidecar `.metadata.json` file containing:

```json
{
  "contentType": "image/jpeg",
  "size": 204800,
  "uploadedAt": "2026-01-15T10:30:00.000Z"
}
```

Local storage includes **path traversal protection** — any resolved path that escapes the bucket directory throws an error.

### S3-Compatible Storage

Works with AWS S3, MinIO, DigitalOcean Spaces, Cloudflare R2, Hetzner Object Storage, Backblaze B2, and any S3-compatible service.

```typescript
const backend = await initializeRebaseBackend({
    server, app,
    bootstrappers: [/* ... */],
    storage: {
        type: "s3",
        bucket: process.env.S3_BUCKET!,
        region: process.env.S3_REGION,
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
        endpoint: process.env.S3_ENDPOINT,       // For MinIO, R2, etc.
        forcePathStyle: true,                     // Required for MinIO
        signedUrlExpiration: 3600,                // URL expiry in seconds
    },
});
```

The S3 controller:
- Auto-enables `forcePathStyle` when a custom `endpoint` is set
- Maps the logical bucket name `"default"` to the configured S3 bucket
- Supports `s3://` and `gs://` URL schemes in key parameters for backward compatibility
- Flattens nested metadata to string values (S3 requirement)

### Google Cloud Storage (GCS)
Native Google Cloud Storage support via the `@google-cloud/storage` SDK. This is the preferred approach for GCS — no S3 interop layer needed. (Also works with Firebase Storage buckets, which are GCS buckets under the hood).

```typescript
const backend = await initializeRebaseBackend({
    server, app,
    bootstrappers: [/* ... */],
    storage: {
        type: "gcs",
        bucket: process.env.GCS_BUCKET!,
        projectId: process.env.GCS_PROJECT_ID, // optional, auto-detected on GCP
    },
});
```

The GCS controller:
- Uses `@google-cloud/storage` natively (no S3 interop overhead)
- Authenticates via Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`)
- Maps the logical bucket name `"default"` to the configured GCS bucket
- Supports `gs://` URL scheme in key parameters
- Generates signed URLs using GCS's native signed URL mechanism

### Multiple Storage Backends

Rebase supports multiple storage backends simultaneously via the `StorageRegistry`:

```typescript
const backend = await initializeRebaseBackend({
    server, app,
    bootstrappers: [/* ... */],
    storage: {
        "(default)": { type: "local", basePath: "./uploads" },
        "media": {
            type: "s3",
            bucket: "my-media-bucket",
            accessKeyId: "...",
            secretAccessKey: "...",
        },
    },
});
```

> **IMPORTANT FOR AGENTS:** If no `"(default)"` key is provided, the first entry is automatically registered as the default (with a console warning). The REST API routes use the default controller unless a `?storageId=<key>` query parameter is provided (see [REST API Endpoints](#rest-api-endpoints)). Use `storageRegistry.get("media")` or `storageRegistry.getOrDefault("media")` to access named backends programmatically.

### StorageRegistry API

The `StorageRegistry` interface:

| Method | Signature | Description |
|--------|-----------|-------------|
| `register` | `(id: string, controller: StorageController) => void` | Register a controller with an ID |
| `getDefault` | `() => StorageController` | Get the `(default)` controller (throws if none) |
| `get` | `(id: string \| undefined \| null) => StorageController \| undefined` | Get by ID, returns `undefined` if not found |
| `getOrDefault` | `(id: string \| undefined \| null) => StorageController` | Get by ID with fallback to default (throws if neither exists) |
| `has` | `(id: string) => boolean` | Check if a storage ID exists |
| `list` | `() => string[]` | List all registered storage IDs |
| `size` | `() => number` | Number of registered controllers |

### Custom Storage Providers

GCS is now built-in (see [Google Cloud Storage (GCS)](#google-cloud-storage-gcs)). Implement the `StorageController` interface for other unsupported providers (Azure Blob, etc.):

```typescript
interface StorageController {
    putObject(props: UploadFileProps): Promise<UploadFileResult>;
    getSignedUrl(key: string, bucket?: string): Promise<DownloadConfig>;
    getObject(key: string, bucket?: string): Promise<File | null>;
    deleteObject(key: string, bucket?: string): Promise<void>;
    listObjects(prefix: string, options?: {
        bucket?: string;
        maxResults?: number;
        pageToken?: string;
    }): Promise<StorageListResult>;
    getType(): string;  // e.g. "gcs", "azure"
}
```

Pass the instance directly to `storage`:

```typescript
storage: new MyGCSStorageController({ projectId: "...", bucket: "..." }),
```

## Environment Variables

The backend validates storage-related environment variables via a Zod schema:

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `STORAGE_TYPE` | `"local" \| "s3" \| "gcs"` | `"local"` | Storage provider type |
| `STORAGE_PATH` | `string` | `"./uploads"` | Base path for local storage / TUS temp directory |
| `FORCE_LOCAL_STORAGE` | `"true" \| "false"` | `false` | Allow local storage in production. Without it the local backend is not registered and uploads answer `501 STORAGE_NOT_CONFIGURED` — the backend still boots |
| `S3_BUCKET` | `string` | — | S3 bucket name |
| `S3_REGION` | `string` | — | S3 region |
| `S3_ACCESS_KEY_ID` | `string` | — | S3 access key ID |
| `S3_SECRET_ACCESS_KEY` | `string` | — | S3 secret access key |
| `S3_ENDPOINT` | `string` (URL) | — | Custom S3-compatible endpoint |
| `S3_FORCE_PATH_STYLE` | `"true" \| "false"` | — | Enable path-style URLs |
| `GCS_BUCKET` | `string` | — | GCS bucket name |
| `GCS_PROJECT_ID` | `string` | — | Google Cloud project ID (auto-detected on GCP) |
| `GOOGLE_APPLICATION_CREDENTIALS` | `string` (path) | — | Path to GCP service account key JSON file |

```env
# S3 example
STORAGE_TYPE=s3
S3_BUCKET=my-bucket
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=AKIA...
S3_SECRET_ACCESS_KEY=...
S3_ENDPOINT=https://minio.example.com    # Optional: for MinIO, R2, etc.
S3_FORCE_PATH_STYLE=true                 # Optional: for MinIO

# GCS example
STORAGE_TYPE=gcs
GCS_BUCKET=my-gcs-bucket
GCS_PROJECT_ID=my-gcp-project             # Optional: auto-detected on GCP
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

## Server-Side Storage (custom functions, hooks, jobs)

> **🚨 CRITICAL FOR AGENTS — do NOT hand-roll a cloud SDK.** Inside a custom
> function, collection hook, or cron job, use the configured storage controller
> at **`rebase.storage`**. **Never** `import "@aws-sdk/client-s3"` or
> `import "@google-cloud/storage"` (or `new S3Client`, `new Storage()`) directly.
> Doing so hardcodes one backend, bypasses the `storage` config, duplicates the
> adapter layer, and breaks the local↔s3↔gcs swap. The backend is a **config
> choice** (`STORAGE_TYPE`), not something you wire up per feature.

`rebase.storage` is the same `StorageController` interface documented above
(`putObject`, `getObject`, `getSignedUrl`, `deleteObject`, `listObjects`,
`getType`). It is `undefined` only if no `storage` is configured — guard for that.

```typescript
import { rebase } from "@rebasepro/server";

// Store bytes (e.g. a generated report, an uploaded build context, a thumbnail)
if (!rebase.storage) throw new Error("Object storage is not configured");
const file = new File([buffer], "report.pdf", { type: "application/pdf" });
const { key, bucket, storageUrl } = await rebase.storage.putObject({
    key: "reports/2026/q1.pdf",   // your object key
    file,                          // a web File (Node 20+ has global File)
});
// storageUrl is scheme-qualified and matches the CONFIGURED backend:
//   local://<bucket>/<key>  |  s3://<bucket>/<key>  |  gs://<bucket>/<key>

// Read it back (accepts a key or a full gs://…/s3://… storageUrl)
const back = await rebase.storage.getObject(key);
const bytes = back ? Buffer.from(await back.arrayBuffer()) : null;
```

**Why `storageUrl` matters:** it is the portable, backend-correct URI. Hand it to
anything that reads object storage directly (a Kaniko build context, an external
worker, a signed-URL flow) — on GCS it's `gs://…` (read via Workload Identity on
GKE, no keys), on S3 it's `s3://…`. You never branch on the provider yourself.

**Switching backend is env only** — no code change:
```env
STORAGE_TYPE=gcs           # was: local (or s3)
STORAGE_GCS_BUCKET=my-bucket
# creds via Workload Identity/ADC on GCP, or GOOGLE_APPLICATION_CREDENTIALS
```

❌ **Anti-pattern (never do this in app/backend code):**
```typescript no-verify
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";   // ❌
const s3 = new S3Client({ region, endpoint });                     // ❌ hardcodes S3
await s3.send(new PutObjectCommand({ Bucket, Key, Body }));        // ❌ bypasses rebase.storage
```
✅ **Correct:** `await rebase.storage.putObject({ key, file })` (above).

*(The only place a cloud SDK is imported directly is inside the storage
controllers in `@rebasepro/server` themselves — application code always goes
through `rebase.storage`.)*

## REST API Endpoints

All storage routes are mounted at `/api/storage` by default. Write operations require authentication when `requireAuth` is `true` (the default). Read operations also require authentication unless `publicRead` is `true`.

### Multi-Backend Routing (`storageId`)

All storage endpoints accept a `?storageId=<key>` query parameter that routes the request to a specific named backend in the `StorageRegistry`. For multipart uploads (`POST /api/storage/upload`), the `storageId` can also be sent as a form field.

If `storageId` is omitted, the request is routed to the `(default)` backend.

```
# Upload to the "media" backend
POST /api/storage/upload?storageId=media

# Download from the "media" backend
GET /api/storage/file/images/photo.jpg?storageId=media

# List files in the "media" backend
GET /api/storage/list?prefix=images/&storageId=media
```

### Standard Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/storage/upload` | Write | Upload a file (multipart/form-data) |
| `GET` | `/api/storage/file/*` | Read | Download / serve a file (supports image transforms) |
| `DELETE` | `/api/storage/file/*` | Write | Delete a file |
| `GET` | `/api/storage/metadata/*` | Read | Get file metadata |
| `GET` | `/api/storage/list` | Write | List files in a prefix |
| `POST` | `/api/storage/folder` | Write | Create a new folder |

### TUS Resumable Upload Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `OPTIONS` | `/api/storage/tus` | None | TUS capability discovery |
| `POST` | `/api/storage/tus` | Write | Create a new resumable upload |
| `HEAD` | `/api/storage/tus/:id` | Read | Query upload progress |
| `PATCH` | `/api/storage/tus/:id` | Write | Append data to an upload |
| `DELETE` | `/api/storage/tus/:id` | Write | Cancel and remove an upload |

### POST /api/storage/upload

Upload a file via `multipart/form-data`.

**Request body fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | `File` | Yes | The file to upload |
| `key` | `string` | No | Storage key/path. Falls back to original filename, then `"unnamed"` |
| `bucket` | `string` | No | Target bucket name |
| `storageId` | `string` | No | Route to a named backend (alternative to `?storageId` query param) |
| `metadata_*` | `string` | No | Custom metadata keys prefixed with `metadata_` |

**Response** (201):

```json
{
  "success": true,
  "data": {
    "key": "products/images/photo.jpg",
    "bucket": "default",
    "storageUrl": "local://default/products/images/photo.jpg"
  }
}
```

The `storageUrl` format is `local://{bucket}/{key}` for local storage and `s3://{bucket}/{key}` for S3.

**Error responses:**

| Status | Condition |
|--------|-----------|
| 400 | No file provided in request body |
| 413 | File exceeds `maxFileSize` (body limit middleware) |

### GET /api/storage/file/{path}

Download or serve a file. The path can include a bucket prefix (e.g., `/file/default/images/photo.jpg`) or omit it to use the default bucket.

For **local storage**, files are served directly from disk with content type read from the `.metadata.json` sidecar file.

For **S3 storage**, files are proxied through the backend (not redirected to signed URLs). This avoids mixed-content issues and unreachable internal VPC endpoints.

**Image transformation query parameters** can be appended — see [Image Transformation](#image-transformation).

**Response headers:**
- `Content-Type` — from metadata or inferred
- `Cache-Control: public, max-age=31536000, immutable` (when image transforms are applied)
- `Cache-Control: public, max-age=3600, immutable` (for S3-proxied files without transforms)

### GET /api/storage/metadata/{path}

Get metadata for a file without downloading it.

**Response** (200):

```json
{
  "success": true,
  "data": {
    "bucket": "default",
    "fullPath": "products/images/photo.jpg",
    "name": "photo.jpg",
    "size": 204800,
    "contentType": "image/jpeg",
    "customMetadata": {}
  }
}
```

### GET /api/storage/list

List files and folders in a given prefix.

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `prefix` | `string` | `""` | Path prefix to list (also accepts `path` for backward compat) |
| `bucket` | `string` | `"default"` (local) | Bucket name |
| `maxResults` | `number` | `1000` | Maximum number of results |
| `pageToken` | `string` | — | Pagination token from previous response |

> Listing is **one level deep**: files land in `items`, immediate subfolders in `prefixes`. "Everything under this prefix" needs an explicit recursive walk over `prefixes`.

**Response** (200):

```json
{
  "success": true,
  "data": {
    "items": [
      { "bucket": "default", "fullPath": "images/photo.jpg", "name": "photo.jpg" }
    ],
    "prefixes": [
      { "bucket": "default", "fullPath": "images/thumbnails", "name": "thumbnails" }
    ],
    "nextPageToken": "25"
  }
}
```

- `items` — files in the prefix
- `prefixes` — subdirectories/folders in the prefix
- `nextPageToken` — pass to the next request for pagination (only present if more results exist)

For S3, listing uses the `Delimiter: "/"` for folder-like behavior via `ListObjectsV2Command`.

### POST /api/storage/folder

Create a new folder.

**Request body:**

```json
{
  "path": "products/images/thumbnails",
  "bucket": "default"
}
```

For **local storage**, creates the directory on disk. For **S3**, creates a zero-byte marker object with a trailing `/` and content type `application/x-directory`.

**Response** (201):

```json
{ "success": true, "message": "Folder created" }
```

### DELETE /api/storage/file/{path}

Delete a file. For local storage, also deletes the `.metadata.json` sidecar file. Directories can only be deleted if empty (ENOTEMPTY errors are silently ignored).

**Response** (200):

```json
{ "success": true, "message": "File deleted" }
```

## TUS Resumable Uploads

Rebase implements [TUS v1.0.0](https://tus.io/protocols/resumable-upload) with the **Creation** and **Termination** extensions. This allows reliable upload of large files (up to 5 GB) with automatic resume on network failure.

### TUS Configuration

| Setting | Value |
|---------|-------|
| TUS version | `1.0.0` |
| Extensions | `creation`, `termination` |
| Max upload size | 5 GB (`5 * 1024 * 1024 * 1024` bytes) |
| Stale upload expiry | 24 hours |
| Cleanup interval | Every 60 seconds |
| Temp directory | `{storageBasePath}/.tus-uploads` |

TUS uploads are stored in a temporary directory and automatically moved to the final storage backend (via `putObject`) when the upload completes.

### TUS Protocol Flow

```
1. OPTIONS /api/storage/tus          → Discover capabilities
2. POST    /api/storage/tus          → Create upload, get Location header
3. PATCH   /api/storage/tus/:id      → Send chunks (repeat until done)
4. (auto)  Upload finalized → moved to storage controller
```

### OPTIONS /api/storage/tus

Returns TUS server capabilities.

**Response headers:**

```
Tus-Resumable: 1.0.0
Tus-Version: 1.0.0
Tus-Extension: creation,termination
Tus-Max-Size: 5368709120
```

### POST /api/storage/tus (Create)

Create a new resumable upload.

**Required request headers:**

| Header | Description |
|--------|-------------|
| `Upload-Length` | Total file size in bytes (must be > 0 and ≤ 5 GB) |
| `Upload-Metadata` | TUS metadata as `key base64value,key2 base64value2` |

**Supported metadata keys:**

| Key | Description |
|-----|-------------|
| `filename` | Original file name (used as storage key if no `key` provided) |
| `key` | Explicit storage key/path |
| `bucket` | Target bucket |
| `contentType` | File MIME type |
| `filetype` | Alternative MIME type key (fallback) |

**Response** (201):

```
Location: http://localhost:3001/api/storage/tus/550e8400-e29b-41d4-a716-446655440000
Tus-Resumable: 1.0.0
Upload-Offset: 0
```

### HEAD /api/storage/tus/:id (Progress)

Query the current upload progress.

**Response** (200):

```
Tus-Resumable: 1.0.0
Upload-Offset: 1048576
Upload-Length: 10485760
Cache-Control: no-store
```

### PATCH /api/storage/tus/:id (Append)

Append data to an in-progress upload.

**Required request headers:**

| Header | Value |
|--------|-------|
| `Content-Type` | `application/offset+octet-stream` |
| `Upload-Offset` | Must match the server's current offset |

**Error responses:**

| Status | Condition |
|--------|-----------|
| 400 | Missing `Upload-Offset` header, or upload already completed |
| 409 | Offset mismatch (client offset ≠ server offset) |
| 413 | Chunk would exceed declared `Upload-Length` |
| 415 | Wrong `Content-Type` (must be `application/offset+octet-stream`) |

When `Upload-Offset` reaches `Upload-Length`, the upload is **automatically finalized**: the temp file is read, a `File` object is created with the metadata-derived MIME type, `putObject` is called on the storage controller, and the temp file is cleaned up.

### DELETE /api/storage/tus/:id (Terminate)

Cancel and remove an in-progress upload. Deletes the temp file and removes the upload from the in-memory registry.

### TUS Client Example

```typescript
// Using tus-js-client (npm install tus-js-client)
import { Upload } from "tus-js-client";

const file = document.querySelector<HTMLInputElement>("#fileInput")!.files![0];

const upload = new Upload(file, {
    endpoint: "http://localhost:3001/api/storage/tus",
    retryDelays: [0, 1000, 3000, 5000],
    metadata: {
        filename: file.name,
        filetype: file.type,
        key: `uploads/${file.name}`,
        bucket: "default",
    },
    headers: {
        Authorization: `Bearer ${accessToken}`,
    },
    onError: (error) => console.error("Upload failed:", error),
    onProgress: (bytesUploaded, bytesTotal) => {
        const pct = ((bytesUploaded / bytesTotal) * 100).toFixed(1);
        console.log(`${pct}%`);
    },
    onSuccess: () => console.log("Upload complete:", upload.url),
});

upload.start();
```

## Image Transformation

Rebase provides on-the-fly image resize, crop, format conversion, and quality adjustment. Transformations are applied by adding query parameters to the `GET /api/storage/file/*` endpoint.

> **IMPORTANT FOR AGENTS:** Image transformation requires the `sharp` npm package as an **optional peer dependency**. Install it: `pnpm add sharp`. If `sharp` is not installed, requesting a transform will throw an error.

### Transform Query Parameters

| Parameter | Type | Range | Default | Description |
|-----------|------|-------|---------|-------------|
| `width` | `number` | 1–4096 | — | Target width in pixels |
| `height` | `number` | 1–4096 | — | Target height in pixels |
| `quality` | `number` | 1–100 | `80` | Output quality |
| `format` | `string` | `webp`, `avif`, `jpeg`, `png` | `webp` | Output format |
| `fit` | `string` | `cover`, `contain`, `fill`, `inside`, `outside` | `cover` | Resize fit mode |

All dimensions are capped at **4096 px** to prevent abuse. `withoutEnlargement` is enabled — images are never upscaled.

### Transform Examples

```
# Resize to 300px wide, auto height, WebP format
GET /api/storage/file/default/images/photo.jpg?width=300

# Resize to 800x600, JPEG at 90% quality
GET /api/storage/file/default/images/photo.jpg?width=800&height=600&format=jpeg&quality=90

# Convert to AVIF with contain fit
GET /api/storage/file/default/images/photo.jpg?format=avif&fit=contain&width=500&height=500
```

### Transformable Image Types

Only raster images are transformable. SVG and GIF are **excluded**:

```
✅  image/jpeg, image/png, image/webp, image/bmp, image/tiff
❌  image/svg+xml, image/gif
```

### Transform Cache

Transformed images are cached in an **LRU in-memory cache** to avoid redundant processing:

| Setting | Value |
|---------|-------|
| Max entries | 500 |
| TTL | 1 hour (3,600,000 ms) |
| Cache key | `{filePath}::{JSON.stringify(options)}` |
| Eviction policy | LRU (oldest entry evicted when at capacity) |

Transformed responses include `Cache-Control: public, max-age=31536000, immutable`.

## Client SDK Methods

The `@rebasepro/client` package provides a `StorageSource` interface via `createStorage(transport)`. These methods are available on `client.storage` (or through the React/Studio hooks).

All SDK methods accept an optional `storageId` parameter (passed as a query parameter) to route the request to a specific named backend:

```typescript
// Upload to a specific backend
// `client.storage` is the default source. Pick a named backend from the registry.
const media = client.storageRegistry.get("media") ?? client.storage;

const result = await media.putObject({
    file: myFile,
    key: "products/images/photo.jpg"
});

// Get a signed URL from that same backend (second argument is the bucket)
const config = await media.getSignedUrl("products/images/photo.jpg", "default");
```

### putObject

Upload a file.

```typescript
const result = await client.storage.putObject({
    file: myFile,                              // File object
    key: "products/images/photo.jpg",          // Storage key/path
    bucket: "default",                         // Optional bucket
    metadata: { category: "product" },         // Optional custom metadata
});
// result: { key: "products/images/photo.jpg", bucket: "default", storageUrl: "local://..." }
```

The SDK sends a `multipart/form-data` request to `POST /api/storage/upload`. Custom metadata keys are prefixed with `metadata_` in the form data.

### getSignedUrl

Get a download URL and metadata for a file. Results are cached in-memory on the client.

```typescript
const config = await client.storage.getSignedUrl(
    "products/images/photo.jpg",   // key or storageUrl (local:// or s3://)
    "default"                       // optional bucket
);

if (config.fileNotFound) {
    console.log("File does not exist");
} else {
    console.log(config.url);       // Private: short-lived scoped token appended. Public: clean permanent URL.
    console.log(config.metadata);  // { bucket, fullPath, name, size, contentType, customMetadata }
}
```

**URL model — never contains the access token:**

- **Private files** → `{baseUrl}/api/storage/file/{path}?token={scopedDownloadToken}`. The token is a **short-lived, path-scoped** download token (default 5 min), signed by the server and valid only for that object — never the caller's full access JWT. Because it expires, **do not persist a private URL**: store the file **path** and call `getSignedUrl()` again at render time.
- **Public files** → `{baseUrl}/api/storage/file/{path}` with **no token**. A file is public when it lives under the `public/` prefix — set `storage: { public: true }` on the property, or pass `public: true` to `putObject`. Public URLs are **stable, permanent, and CDN-cacheable**, so they are safe to store in a database and hotlink. For public paths, `getSignedUrl()` returns the URL immediately with no server round-trip.

Protocol prefixes (`local://`, `s3://`) are automatically stripped from the key.

### getObject

Download a file as a `File` object.

```typescript
const file = await client.storage.getObject(
    "products/images/photo.jpg",   // key or storageUrl
    "default"                       // optional bucket
);

if (file) {
    console.log(file.name);  // "photo.jpg"
    console.log(file.type);  // "image/jpeg"
    const blob = new Blob([file]);
    // use blob for display, further processing, etc.
}
```

> **IMPORTANT FOR AGENTS:** `getObject` uses raw `fetch` (not the JSON transport) because the response is a binary blob, not JSON.

### deleteObject

Delete a file. Silently ignores 404 errors (file already deleted).

```typescript
await client.storage.deleteObject(
    "products/images/photo.jpg",   // key or storageUrl
    "default"                       // optional bucket
);
```

### listObjects

List files and folders in a prefix with pagination.

```typescript
const result = await client.storage.listObjects("products/images", {
    bucket: "default",
    maxResults: 50,
    pageToken: undefined,  // from previous result.nextPageToken
});

console.log(result.items);       // files: StorageReference[]
console.log(result.prefixes);    // folders: StorageReference[]
console.log(result.nextPageToken); // for next page, or undefined
```

## Collection File Upload Properties

Define file upload fields in your collections using the `storage` option on string properties:

```typescript
import { PostgresCollectionConfig } from "@rebasepro/types";

const productsCollection: PostgresCollectionConfig = {
    name: "Products",
    slug: "products",
    table: "products",
    properties: {
        image: {
            name: "Product Image",
            type: "string",
            storage: {
                storageSource: "external-source",
                storagePath: "products/{entityId}",
                acceptedFiles: ["image/*"],
                maxSize: 5 * 1024 * 1024, // 5MB
            }
        },
        documents: {
            name: "Documents",
            type: "array",
            of: {
                name: "Document",
                type: "string",
                storage: {
                    storageSource: "media",              // routes to the "media" backend
                    storagePath: "products/documents",
                    acceptedFiles: ["application/pdf", "application/msword"],
                }
            }
        }
    }
};
```

The `storageSource` field maps to a named backend registered in the `StorageRegistry` (server-side) or in the `storageSources` prop (client-side). When omitted, the `(default)` backend is used.

### StorageConfig Properties

| Property | Type | Description |
|----------|------|-------------|
| `storageSource` | `string` | Named backend to route uploads to (optional, defaults to `(default)`) |
| `storagePath` | `string` | Path template for uploaded files. Supports `{entityId}` placeholder |
| `acceptedFiles` | `string[]` | Accepted MIME types or globs (e.g., `["image/*"]`) |
| `maxSize` | `number` | Maximum file size in bytes |
| `public` | `boolean` | Store files under the `public/` prefix and serve them via stable, token-less, permanent, CDN-cacheable URLs (safe to persist/hotlink). Defaults to `false` (private, short-lived signed URLs). |

## Frontend Storage Sources

The `<Rebase>` component accepts a `storageSources` prop to register client-side storage sources, following the same pattern as `dataSources` for databases. This enables **direct** (client-to-provider) file operations, bypassing the Rebase backend.

### Registering Storage Sources

```tsx
import type { RebaseStorageSource } from "@rebasepro/app";
import { myExternalStorageSource } from "./my-external-storage";

<Rebase
    client={rebaseClient}
    storageSources={[
        {
            key: "external",
            engine: "external",
            transport: "direct",
            source: myExternalStorageSource,
        },
        {
            key: "media",
            engine: "s3",
            transport: "server",   // proxied through the Rebase backend
            label: "Media Storage",
        },
    ]}
>
    {children}
</Rebase>
```

### StorageSourceDefinition

| Property | Type | Description |
|----------|------|-------------|
| `key` | `string` | **Required.** Unique identifier for this storage source |
| `engine` | `string` | **Required.** Storage engine type (e.g., `"firebase"`, `"s3"`, `"gcs"`, `"local"`) |
| `transport` | `"server" \| "direct"` | **Required.** `"server"` routes through the backend; `"direct"` talks to the provider from the client |
| `source` | `StorageSource` | The client-side `StorageSource` implementation (required when `transport` is `"direct"`) |
| `label` | `string` | Optional human-readable label for the UI |

### StorageSourcesContext

Registered storage sources are exposed to the component tree via `StorageSourcesContext`, mirroring the `DataSourcesContext` pattern:

```typescript
import { useStorageSources } from "@rebasepro/app";

function MyUploadComponent() {
    // `registry` holds the definitions, `sources` the live clients — both keyed by
    // the source key, so this is a lookup rather than a search.
    const { sources } = useStorageSources();

    const upload = async (file: File) => {
        const external = sources["external"];
        if (external) {
            await external.putObject({ file, key: "photos/image.jpg" });
        }
    };
}
```

### Direct vs Server Transport

| Transport | Description | Use Case |
|-----------|-------------|----------|
| `"server"` | File operations are proxied through the Rebase backend REST API | S3, GCS, or local backends managed by the server |
| `"direct"` | File operations go directly from the client to the storage provider | External cloud storage, or any provider with client-side SDKs |

> **IMPORTANT FOR AGENTS:** Direct transport sources must provide a `source` property implementing the `StorageSource` interface. Server transport sources use the built-in SDK transport and only need `key` and `engine`.

## Storage Browser (Studio)

The `@rebasepro/studio` package includes a built-in `StorageView` component:
- Browse uploaded files and folders with a tree sidebar
- Drag-and-drop file uploads
- Image, video, and audio previews with metadata
- File search and filtering
- Grid and list view modes

## Validation and Error Handling

### File Size Validation

File size is validated at two levels:

1. **Hono body limit middleware** — returns `413` with `PAYLOAD_TOO_LARGE` before the file reaches the controller. The limit is derived from `maxFileSize` in the storage config (default 50 MB).
2. **Controller-level validation** — the controller's `validateFile()` checks `file.size` against `maxFileSize` and throws an `Error` if exceeded.

### MIME Type Validation

When `allowedMimeTypes` is set in the storage config, uploads with disallowed MIME types are rejected with an error:

```
File type application/zip is not allowed. Allowed types: image/jpeg, image/png
```

### Common MIME Type Constants

The storage module exports two convenience arrays:

```typescript
import { IMAGE_MIME_TYPES, DOCUMENT_MIME_TYPES } from "@rebasepro/server";

// IMAGE_MIME_TYPES:
// ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml", "image/bmp", "image/tiff"]

// DOCUMENT_MIME_TYPES:
// ["application/pdf", "application/msword",
//  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
//  "application/vnd.ms-excel",
//  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
//  "application/vnd.ms-powerpoint",
//  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
//  "text/plain", "text/csv"]
```

### TUS Error Codes

| HTTP Status | Condition |
|-------------|-----------|
| 400 | Missing/invalid `Upload-Length` header, missing `Upload-Offset`, upload already completed |
| 404 | Upload ID not found |
| 409 | `Upload-Offset` mismatch (client offset ≠ server offset) |
| 413 | `Upload-Length` exceeds 5 GB max, or chunk exceeds declared length |
| 415 | `Content-Type` is not `application/offset+octet-stream` |

## Metadata Sidecar Files (Local Storage)

For local storage, every uploaded file has a companion `.metadata.json` file saved alongside it. This sidecar file stores:

```json
{
  "contentType": "image/jpeg",
  "size": 204800,
  "uploadedAt": "2026-01-15T10:30:00.000Z",
  "category": "product"
}
```

- `contentType` and `size` are always present
- Custom metadata from the upload request is merged in
- The content type from this file is used when serving files via `GET /file/*`
- When a file is deleted, its `.metadata.json` is also deleted
- Metadata files are skipped when listing directory contents (filtered out by name pattern)

## References

- **Documentation:** [rebase.pro/docs](https://rebase.pro/docs)
- **GitHub:** [github.com/rebasepro/rebase](https://github.com/rebasepro/rebase)
- **TUS Protocol:** [tus.io/protocols/resumable-upload](https://tus.io/protocols/resumable-upload)
- **Sharp (image transforms):** [sharp.pixelplumbing.com](https://sharp.pixelplumbing.com)
