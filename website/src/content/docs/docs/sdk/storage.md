---
title: Storage & Files
sidebar_label: Storage
description: Upload, download, list, and delete files using the Rebase Client SDK's storage module.
---

## Overview

The `client.storage` module provides methods for file management — upload, download, listing, and deletion. It works with both local disk and S3-compatible storage backends, depending on your server configuration.

All storage methods use the shared transport, so authentication tokens are injected automatically.

## Upload a File

Use `putObject()` to upload a file. It accepts a `File` or `Blob` object along with an optional storage key and metadata:

```typescript
const result = await client.storage.putObject({
    file: fileObject,                   // File or Blob
    key: "products/images/camera.jpg",  // Storage path (optional)
    bucket: "uploads",                  // Bucket name (optional)
    public: false,                      // Store public (permanent token-less URL) — optional, default false
    metadata: {                         // Custom metadata (optional)
        description: "Product photo",
        uploadedBy: "user-123"
    }
});

// result: { key: string; bucket: string; storageUrl: string }
```

### From a File Input

```typescript
const input = document.querySelector<HTMLInputElement>("#file-input");
const file = input?.files?.[0];

if (file) {
    const result = await client.storage.putObject({
        file,
        key: `avatars/${userId}/${file.name}`
    });
    console.log("Uploaded to:", result.key);
}
```

## Get a Signed URL

Retrieve a download URL and metadata for a stored file:

```typescript
const { url, metadata, fileNotFound } = await client.storage.getSignedUrl(
    "products/images/camera.jpg"
);

if (url) {
    console.log("Download URL:", url);
    console.log("Content type:", metadata?.contentType);
} else {
    console.log("File not found");
}
```

With a specific bucket:

```typescript
const { url } = await client.storage.getSignedUrl(
    "camera.jpg",
    "product-images"   // bucket
);
```

The SDK caches signed URLs to avoid redundant server calls.

### Private vs. public URLs

- **Private files** get a URL with a **short-lived, path-scoped download token** (`?token=…`, default 5 min) — never your access token. Because it expires, **don't persist a private URL**; store the file **path** and call `getSignedUrl()` again when you render it.
- **Public files** (stored under the `public/` prefix — set `storage: { public: true }` on the property, or pass `public: true` to `putObject`) get a **stable, token-less, permanent, CDN-cacheable** URL with no server round-trip. These are safe to store in a database and hotlink.

## Download a File

Retrieve a file as a `File` object:

```typescript
const file = await client.storage.getObject("products/images/camera.jpg");

if (file) {
    console.log("File name:", file.name);
    console.log("File type:", file.type);
    console.log("File size:", file.size);

    // Create a download link
    const url = URL.createObjectURL(file);
    window.open(url);
} else {
    console.log("File not found");
}
```

With a specific bucket:

```typescript
const file = await client.storage.getObject("camera.jpg", "product-images");
```

## Delete a File

```typescript
await client.storage.deleteObject("products/images/camera.jpg");

// With bucket
await client.storage.deleteObject("camera.jpg", "product-images");
```

Deleting a non-existent file does not throw an error.

## List Files

List files by prefix, with optional pagination:

```typescript
const result = await client.storage.listObjects("products/images/", {
    bucket: "uploads",
    maxResults: 50,
    pageToken: undefined   // for pagination
});

for (const item of result.items) {
    console.log(item.fullPath, item.name);
}

// Paginate
if (result.nextPageToken) {
    const nextPage = await client.storage.listObjects("products/images/", {
        pageToken: result.nextPageToken
    });
}
```

## Storage Key Formats

The SDK transparently handles storage key prefixes. You can pass keys with or without the protocol prefix:

```typescript
// All equivalent — the SDK strips the prefix internally
await client.storage.getSignedUrl("local://products/image.jpg");
await client.storage.getSignedUrl("s3://products/image.jpg");
await client.storage.getSignedUrl("products/image.jpg");
```

## API Reference

| Method | Description | Returns |
|--------|-------------|---------|
| `putObject({ file, key?, bucket?, metadata? })` | Upload a file | `UploadFileResult` |
| `getSignedUrl(key, bucket?)` | Get download URL + metadata | `DownloadConfig` |
| `getObject(key, bucket?)` | Download as `File` object | `File \| null` |
| `deleteObject(key, bucket?)` | Delete a file | `void` |
| `listObjects(prefix, options?)` | List files by prefix | `StorageListResult` |

## Next Steps

- **[Storage Configuration](/docs/backend/storage)** — Configure S3 or local storage on the server
- **[Querying Data](/docs/sdk/querying)** — CRUD operations and query builder
- **[Authentication](/docs/sdk/authentication)** — Sign in and session management
