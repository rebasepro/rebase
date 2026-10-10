---
title: Resumable uploads (TUS)
sidebar_label: Resumable uploads (TUS)
description: The TUS v1.0.0 endpoint under /api/storage/tus — how a large file goes up a chunk at a time, what each request answers, how the SDK and the admin panel use it, and how it behaves across restarts and instances.
---

For uploading large files or handling unstable network conditions, Rebase implements the **TUS v1.0.0** open protocol including the `Creation` and `Termination` extensions.
Its limits are the source's, as for every upload — see
[How large a file may be](/docs/backend/storage/#how-large-a-file-may-be).

## Why large files go this way

`POST /api/storage/upload` is one multipart body, which the server parses whole
before it stores it: three to five times the file in its memory (about 340 MB
for a 100 MB file). A resumable upload holds one chunk at a time — each `PATCH`
is under the global body limit, 10 MB by default — and is written to the store
from disk: about 50 MB for that file, and 80 MB for a 400 MB one. So size the
source's limit to the server's memory if clients use `POST /api/storage/upload`
for large files, and not otherwise.

<span class="since-badge" data-since="0.25">Since 0.25</span> `client.storage.putObject()` and the admin panel send a file over
8 MiB through the resumable endpoint, in 8 MiB chunks, and resume a chunk that
fails on the way from the offset the server holds. The file lands as
`POST /api/storage/upload` would store it — the same key, bucket, type, custom
metadata, limits, `storageAuthorize` check and `finalize` trigger — and the
call returns the same `{ key, bucket, storageUrl }`. When the resumable route
cannot carry it — a server without the endpoint, a chunk over the server's body
limit, or an instance that does not hold the upload (see
[Running several instances](/docs/deployment/multiple-instances/#files)) — the
file goes through `POST /api/storage/upload` instead, and that source sends
every later file that way too.

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

## Upload lifecycle

1. **Session Initialisation (`POST`)**: The client sends the total file size in the `Upload-Length` header and base64 metadata via `Upload-Metadata`: `key` (or `filename`), `filetype`, `bucket`, `storageId`, `collection` and `property`, as `POST /api/storage/upload` takes them as form fields, and <span class="since-badge" data-since="0.25">Since 0.25</span> `metadata_<name>` entries, which become the object's custom metadata as `metadata_<name>` fields do. The server creates an empty placeholder file under a hidden temporary directory `.tus-uploads/`, <span class="since-badge" data-since="0.25">Since 0.25</span> with a record of the upload beside it (`<id>.json`: its key, bucket, source, type, size and owner), and returns the upload URL. <span class="since-badge" data-since="0.25">Since 0.25</span> It also answers `Rebase-Upload-Result: on-complete`: this server reports what it stored when the upload finishes. The upload lives in that directory, not in the process: a restarted server resumes it, and every instance that shares `STORAGE_PATH` serves it — see [Running several instances](/docs/deployment/multiple-instances/#files).
2. **Progress Inquiries (`HEAD`)**: If an upload is interrupted, the client queries the upload URL using a `HEAD` request. The server returns the current byte position in the `Upload-Offset` header.
3. **Data Appending (`PATCH`)**: The client resumes sending binary data starting at the returned offset with `Content-Type: application/offset+octet-stream`. The server writes each chunk to the temporary file at the byte offset the request declares, which must be the offset the server holds (`409` otherwise). One chunk is received at a time: a `PATCH` that arrives while another for the same upload is still being received — typically a client re-sending a chunk that stalled — is answered `423 UPLOAD_LOCKED`, and the client resumes from the offset `HEAD` reports.
4. **Finalisation**: When the accumulated `Upload-Offset` matches the declared `Upload-Length`, Rebase reads the completed temporary file, wraps it as a standard JavaScript `File` object, and saves it to the configured storage backend (local disk or S3). The temporary file is then deleted. <span class="since-badge" data-since="0.25">Since 0.25</span> That last `PATCH` answers `Rebase-Upload-Result` with the stored object — `{ key, bucket, storageUrl }`, what `POST /api/storage/upload` answers under `data` — as URI-encoded JSON. A frontend on another origin can read it, and `Location` and `Upload-Offset`, only when the server exposes them in `Access-Control-Expose-Headers`: the Rebase runtime and the ejected backend do; a [custom server](/docs/backend/custom-server/) has to.
5. **Periodic Sweep**: A background cleaner runs every **60 seconds** to delete orphaned, incomplete temporary uploads that have exceeded the **24-hour** retention threshold — those another process started too, read from the directory.

## Related

- [Storage Configuration](/docs/backend/storage/) — sources, limits, endpoints and authorization
- [Running several instances](/docs/deployment/multiple-instances/#files) — where an upload in progress lives
- [Storage SDK](/docs/sdk/storage/) — `putObject()`, which uses this endpoint for files over 8 MiB
