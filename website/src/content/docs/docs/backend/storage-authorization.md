---
title: Storage Authorization
sidebar_label: Storage Authorization
description: Decide who may read, write, delete or list each storage object with storagePolicies and the storageAuthorize hook, and which storage scopes an API key needs.
---

Collections are protected by row-level security; a bucket has no per-object
equivalent, so storage is authorized here. [Storage
Configuration](/docs/backend/storage/) covers the backends themselves.

## Policies

The declarative form. A list of path patterns, read without running anything:

```ts
storagePolicies: [
    { path: "public/**", operations: ["read"], allow: "public" },
    { path: "users/:uid/**", allow: ({ params, user }) => user?.uid === params.uid }
]
```

**A key matched by no policy is refused**, unless a `storageAuthorize` hook allows it: the hook is asked only when no policy matched, and neither can narrow the other. Every widening is an explicit line, and a mistake denies rather than grants.

Patterns match **by segment, never by substring** — `public/**` does not match
`publicity/secret.png`:

| Pattern | Matches |
|---|---|
| `avatars/logo.png` | that key exactly |
| `users/*/avatar.png` | exactly one segment where `*` is |
| `users/:uid/**` | one captured segment, then the rest — including nothing |

`**` is only legal as the final segment. `:name` captures one segment and never
spans a `/`; captures arrive as `params` on the predicate.

`allow` is `"public"` (anyone), `"authenticated"` (any caller with a uid), or a
predicate receiving the captured params, the user, the operation and the bucket.
`operations` defaults to all four — `read`, `write`, `delete`, `list`.

Policies satisfy the production boot guard on their own, and a malformed pattern
fails the boot rather than the first upload.

## The hook

`requireAuth` and `publicRead` are *global* switches: they decide whether a caller must be signed in, not what that caller may touch. Without an authorization hook, **any authenticated user can read any key they can name** — the only thing separating two tenants' files is key unguessability, which is not an access-control model. Worse, they can `GET /storage/list?prefix=` first, so the keys do not even have to be guessed.

:::caution[Storage will not boot in production without one]
Collections are protected by row-level security; storage is not. There is no
per-object equivalent in the bucket, so this hook *is* the model — and
`initializeRebaseBackend` **throws at startup** under `NODE_ENV=production` when
storage is configured and none of these is set:

- `storageAuthorize` — a hook, per object. Recommended.
- `storagePublicRead: true` — the bucket genuinely is a public read-only CDN.
- `storageInsecureAllowAnyAuthenticated: true` — a single-tenant app where every
  signed-in user is trusted with every file. Named to be read twice.

In development it logs a warning instead, so a project can be wrong about this and
work fine locally right up until it is deployed. A scaffolded project ships a hook in
`config/storage.ts` already — read it before you replace it, and note that it models
a CMS's *shared content library*, which is not the same shape as per-user files.
:::

`storageAuthorize` is the storage analogue of a collection's security rules, and runs after authentication on every storage route:

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

| Field | Description |
|-------|-------------|
| `key` | Object key, bucket prefix stripped and traversal sanitized |
| `bucket` | Resolved bucket (`"default"` when unspecified) |
| `operation` | `"read"`, `"write"`, `"delete"` or `"list"` |
| `user` | `{ uid, email?, roles? }`, or `null` where the route allows anonymous access |
| `storageId` | The named backend, when the request targeted one — its canonical key (`storageId=%20media` is `"media"`). Absent for the default source, however the request named it (no parameter, empty, or `(default)`) |
| `data` | Trusted, **RLS-bypassing** read access — `data.collection(slug).find(query)` / `.findById(id)`. Ownership lives in a row, not in a key prefix, so the hook needs a reader to answer "who owns this object?". It bypasses row-level security deliberately: this hook *is* the authorization decision, and making it through a reader already narrowed by the caller's own permissions would be circular. Read-only by design. |

Return `false` to deny with a **403**. Throwing also denies — an ownership lookup that fails does not fall open.

Worth knowing:

- **The metadata route is where read access is really decided.** It mints the short-lived path-scoped download token that the file route trusts, so the hook gates it there. Two reads skip the hook, by design. One carrying such a token: the hook approved it when the token was minted, for that path and source only, so a hook that would now refuse (a membership revoked since) does not stop it before the token runs out — `storageDownloadTokenTtl`, 300 seconds by default. And a read of a key under `public/` by a caller with no credential: the prefix is the declaration that anyone may read it, anonymous visitors and CDNs included. A signed-in caller's read of it is still asked about, but an anonymous one is not, so a hook cannot make a `public/` key private; store the file outside `public/` instead. Only those two reads skip it: a user your auth adapter happens to call `public` is asked about like anyone else.
- **One bucket, one name.** On S3 and GCS the hook's `bucket` is always `"default"`, also when a request names the provider's bucket, which reaches the same objects.
- **A path is public when the key it names is.** The `public/` prefix is tested on the canonical key the route serves — after a leading `default/` bucket segment is read off and `//`, `./` and a leading `/` are folded away — never on the URL as written. `/api/storage/file/notes://public/x.txt` names the private key `notes:/public/x.txt`, and the key `default/public/x.txt` (reached as `/api/storage/file/default/default/public/x.txt`) lies in a folder called `default`; neither is public. In a hook, test the `key` you are handed with `isPublicStorageKey` from `@rebasepro/types` — `isPublicStoragePath` reads a client-side path or URL, and reads both of those as public.
- **`list` is gated on the prefix.** Listing is how you discover keys nobody told you about.
- **Resumable (TUS) uploads are gated at create time**, so a denied upload leaves no temp file behind.
- Omitting the hook (and `storagePolicies`) leaves no per-object check, so production refuses to boot unless `storagePublicRead` or `storageInsecureAllowAnyAuthenticated` is set.

## API keys and tokens

A signed-in person holds every storage scope, so the hook and the policies above
decide for them. An [API key](/docs/backend/api-keys/) also needs the storage
scope for the operation, on the source the request names: `storage:read` for
downloads, metadata and listings, `storage:write` for uploads, folders and every
step of a resumable upload, `storage:delete` for deletes. The target is the
source id, and the default source's is `(default)`: `storage:read:(default)`,
`storage:write:avatars`. Without it the answer is `403 SCOPE_MISSING`. With it,
the hook still runs, as whoever the key acts as.

## Next Steps

- **[Storage Configuration](/docs/backend/storage/)** — backends, endpoints and limits
- **[API Keys](/docs/backend/api-keys/)** — the scopes a key carries
