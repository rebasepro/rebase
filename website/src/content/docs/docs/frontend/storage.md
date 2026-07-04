---
title: Storage & File Uploads
sidebar_label: Storage & File Uploads
description: Add file upload fields to your collections, manage files programmatically, and route uploads to different storage backends.
---

## Overview

Rebase provides built-in file upload support in collection forms:

- **Drag-and-drop** file upload fields
- **Image previews** in forms and table cells
- **Multiple file uploads** via array properties
- **MIME type filtering** and size limits
- **Custom filenames** via callback functions

## File Upload Fields

To add file uploads to a collection, use the `storage` config on a string property:

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
                return context.snapshotId + "_" + context.file.name;
            }
        }
    }
}
```

### Storage Config Options

| Property | Type | Description |
|----------|------|-------------|
| `storagePath` | `string` | Subdirectory within the storage backend |
| `storageSource` | `string` | Named storage source — routes uploads to a specific backend (e.g., `"firebase"`, `"media"`). See [Multi-Backend Storage](#multi-backend-storage). |
| `acceptedFiles` | `string[]` | Allowed MIME types (e.g., `["image/*"]`, `["application/pdf"]`) |
| `maxSize` | `number` | Maximum file size in bytes |
| `fileName` | `function` | Custom filename generator |
| `metadata` | `object` | Additional metadata to store with the file |
| `storeUrl` | `boolean` | Store the full URL instead of the relative path |

## Multiple File Uploads

Wrap the storage property in an array for multiple file uploads:

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

## Document Uploads

Upload non-image files like PDFs:

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

## Multi-Backend Storage

When your backend has multiple storage backends configured (e.g., local + S3 + GCS), you can route individual properties to specific backends using `storageSource`:

```typescript
image: {
    type: "string",
    name: "Product Image",
    storage: {
        storageSource: "firebase",     // Routes to the "firebase" backend
        storagePath: "products/{snapshotId}",
        acceptedFiles: ["image/*"],
    }
}
```

### Frontend Direct Sources

For **direct** storage backends (e.g., Firebase Storage where the browser uploads straight to the cloud), register them via the `storageSources` prop on `<Rebase>`:

```tsx
import type { RebaseStorageSource } from "@rebasepro/core";

<Rebase
    client={rebaseClient}
    storageSources={[
        { key: "firebase", engine: "firebase", transport: "direct", source: firebaseStorageSource }
    ]}
>
```

| Property | Type | Description |
|----------|------|-------------|
| `key` | `string` | Unique identifier — must match `storageSource` in property configs |
| `engine` | `string` | Storage engine name (e.g., `"firebase"`, `"gcs"`, `"s3"`) |
| `transport` | `"server" \| "direct"` | `"server"` proxies through the backend; `"direct"` uploads from the browser |
| `source` | `StorageSource` | Client-side `StorageSource` implementation (required for `"direct"` transport) |

The system automatically resolves the correct source per-property — collection properties with `storageSource: "firebase"` will use the matching direct source, while properties without `storageSource` (or with `transport: "server"`) will proxy through the Rebase backend.

## useStorageSource Hook

For programmatic file operations outside of collection forms:

```typescript
import { useStorageSource } from "@rebasepro/core";

// Returns the default storage source
const storageSource = useStorageSource();

// Upload a file
const result = await storageSource.uploadFile({
    file,
    fileName: "my-file.pdf",
    path: "documents"
});

// Get download URL
const url = await storageSource.getDownloadURL(result.path);
```

:::tip
`useStorageSource()` returns the **default** storage source. For multi-backend setups, the per-property resolution is handled automatically by the form field bindings and the `StorageSourcesContext`. You don't need to manually resolve sources in most cases.
:::

## Next Steps

- **[Backend Storage Configuration](/docs/backend/storage)** — S3, GCS, and local storage setup
- **[Properties](/docs/collections/properties)** — All property types including storage
