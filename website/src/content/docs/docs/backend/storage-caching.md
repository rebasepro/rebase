---
title: Storage caching and CDNs
sidebar_label: Storage caching and CDNs
description: How Rebase serves stored files so browsers and CDNs can cache them — ETags and 304s, Cache-Control by who may read an object, byte ranges for seeking in audio and video, and what to configure on a CDN in front.
---

Every object is proxied through the server rather than redirected to a signed
URL — a signed URL breaks on mixed content (an HTTPS page, an HTTP MinIO) and on
endpoints only the cluster can reach. So the response headers are what make
caching work.

Each response carries a weak `ETag` and `Last-Modified`, built from the object's
size and modification time. A client that already holds the object sends
`If-None-Match` and gets **304 with no body**, so a repeat load costs a round
trip instead of a transfer.

`Cache-Control` depends on who may read the object:

| Object | Header |
|---|---|
| Under the `public/` prefix, or `publicRead: true` | `public, max-age=60, stale-while-revalidate=86400, must-revalidate` |
| Anything else | `private, max-age=60, must-revalidate` |
| Image transforms | the same, with `max-age=3600` |

`private` is deliberate: an object that needed credentials to fetch must not be
stored by a shared cache, or a CDN can hand one user's file to the next caller.
`Vary: Authorization` is sent for the same reason.

Nothing is ever marked `immutable`. A storage key can be overwritten — writing
to an existing key is an ordinary operation — so a promise never to revalidate
would make a replaced file invisible until the window lapsed.

## Seeking in audio and video

Every object response carries `Accept-Ranges: bytes`, and a `Range` request is
answered with `206 Partial Content` and a `Content-Range`. Without it a browser
will not offer to seek in a media element served from here — and Safari refuses
to play a `<video>` whose first response is not a `206` — so for media this is
the difference between a working player and a broken one.

- One range per request: `bytes=0-499`, `bytes=500-`, `bytes=-500`. That is what
  browsers send for playback.
- Multiple ranges in one header are answered with the whole object and a `200`,
  which is always legal. Nothing that matters sends them.
- A range starting past the end is a `416` with `Content-Range: bytes */<size>`,
  not a silent whole-file response.
- Revalidation wins over a range: a request carrying both `If-None-Match` and
  `Range` gets the `304`.

On local storage only the requested slice is read from disk. On S3 and GCS the
object is still fetched whole — a `StorageController` has no ranged read — so the
saving is on the response, not upstream.

## Putting a CDN in front

Because public objects are `public` with a `stale-while-revalidate` window and a
validator, any ordinary reverse proxy or CDN can cache them with no extra
configuration. Point it at the API origin and let it honour the headers.

Two things to configure on the CDN itself:

- **Respect `Vary: Authorization`**, or do not cache authenticated routes at all.
  A CDN that ignores `Vary` and caches `private` responses is the failure this
  header exists to prevent.
- **Expect revalidation.** The short `max-age` means the CDN will re-ask
  regularly; those requests are cheap 304s, and they are what keeps an
  overwritten object from being served stale.

## Related

- [Storage Configuration](/docs/backend/storage/) — the backends these headers are served from, and the `public/` prefix and `publicRead` that make an object `public`.
- [Per-object authorization](/docs/backend/storage/#per-object-authorization) — who may read an object, which is what decides between `public` and `private`.
- [File uploads](/docs/collections/file-uploads/) — the collection properties that store files.
