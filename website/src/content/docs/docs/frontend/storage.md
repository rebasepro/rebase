---
title: Storage & File Uploads
sidebar_label: Storage & File Uploads
description: Add file upload fields to your collections and manage files programmatically with the storage hooks.
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
                return context.entityId + "_" + context.file.name;
            }
        }
    }
}
```

### Storage Config Options

| Property | Type | Description |
|----------|------|-------------|
| `storagePath` | `string` | Subdirectory within the storage backend |
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

## useStorageSource Hook

For programmatic file operations outside of collection forms:

```typescript
import { useStorageSource } from "@rebasepro/core";

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

## Next Steps

- **[Backend Storage Configuration](/docs/backend/storage)** — S3 and local storage setup
- **[Properties](/docs/collections/properties)** — All property types including storage
