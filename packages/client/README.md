# @rebasepro/client

HTTP SDK client for the Rebase backend — typed CRUD, auth, storage, realtime WebSockets, offline / local-first sync, admin, cron, and custom functions.

## Installation

```bash
pnpm add @rebasepro/client
```

ESM-only: `"type": "module"` with no CommonJS build, so it is loaded with
`import`. `require()` of it resolves only on Node 22.12+, which supports
`require(esm)`.

## What This Package Does

`@rebasepro/client` is the primary SDK for interacting with a Rebase backend from any JavaScript/TypeScript environment (browser, Node.js, edge). It creates a single client instance that provides:

- **Collection CRUD** with a fluent query builder (`.where()`, `.orderBy()`, `.limit()`, etc.)
- **Authentication** — email/password, Google, 10+ OAuth providers, session management, password reset
- **Admin** — user CRUD for admins
- **Storage** — file upload, download, delete, list
- **Realtime** — WebSocket subscriptions for collection and snapshot changes
- **Offline / local-first sync** (opt-in) — a local row database, writes that apply instantly offline and replay when the connection returns, and live queries
- **Cron** — list, trigger, and manage cron jobs
- **Custom functions** — invoke server-side Hono route functions
- **Type-safe data proxy** — `client.data.products` auto-maps to the `products` collection

## Key Exports

### Client Factory

| Export | Description |
|---|---|
| `createRebaseClient<DB>(options)` | Create a `RebaseClient` instance. Generic `DB` parameter enables type-safe `client.data.*` access. |
| `RebaseClient<DB>` | The client type — includes `auth`, `admin`, `cron`, `functions`, `storage`, `ws`, `data`, `call`, and token management methods. |
| `CreateRebaseClientOptions` | Extends `RebaseClientConfig` with `auth`, `admin`, and `cron` sub-configs. |

### Config

| Option | Type | Default | Description |
|---|---|---|---|
| `baseUrl` | `string` | `""` | Backend URL (e.g. `http://localhost:3001`) |
| `token` | `string` | — | Static auth token |
| `apiPath` | `string` | `"/api"` | API path prefix |
| `fetch` | `typeof fetch` | `globalThis.fetch` | Custom fetch implementation |
| `onUnauthorized` | `() => Promise<boolean>` | auto-refresh | Handler for 401 responses |
| `websocketUrl` | `string` | derived from `baseUrl` | WebSocket URL for realtime |
| `realtime` | `boolean` | `true` | Open the WebSocket — `false` lets a one-shot script exit |
| `collections` | `Record<string, string>` | — | Maps accessor names to collection slugs |
| `offline` | `boolean \| OfflineConfig` | `false` | Local-first sync — see [the docs](https://rebase.pro/docs/sdk/offline) |

### Collection Client

`client.data.collection("slug")` or `client.data.myCollection` returns a `CollectionClient<M>`:

| Method | Description |
|---|---|
| `find(params?)` | Query with pagination. Returns `FindResponse<M>` (`{ data, meta }`) |
| `findById(id)` | Fetch a single snapshot. Returns `Snapshot<M> \| undefined` |
| `create(data, id?)` | Create snapshot. Returns `Snapshot<M>` |
| `update(id, data)` | Update snapshot. Returns `Snapshot<M>` |
| `delete(id)` | Delete snapshot |
| `count(params?)` | Count matching snapshots |
| `where(col, op, val)` | Start a fluent query — returns `QueryBuilder` |
| `orderBy(col, dir?)` | Order results — returns `QueryBuilder` |
| `limit(n)` / `offset(n)` | Pagination — returns `QueryBuilder` |
| `search(str)` | Full-text search — returns `QueryBuilder` |
| `include(...rels)` | Include related snapshots — returns `QueryBuilder` |
| `listen(params, onUpdate, onError?)` | Realtime subscription (requires WebSocket) |
| `listenById(id, onUpdate, onError?)` | Realtime single-snapshot subscription |
| `observe(params, onResult, onError?, options?)` | Live query — local-first when `offline` is on, otherwise fetch + `listen` |
| `observeById(id, onResult, onError?, options?)` | Live query for a single row |

### Auth Module (`client.auth`)

| Method | Description |
|---|---|
| `signInWithEmail(email, password)` | Email/password login |
| `signUp(email, password, displayName?)` | Register new user |
| `signInWithGoogle(payload)` | Google OAuth (ID token, access token, or auth code) |
| `signInWithOAuth(providerId, payload)` | Generic OAuth for any provider |
| `signInWithGitHub/Microsoft/Apple/Facebook/Twitter/Discord/GitLab/Bitbucket/Slack/Spotify` | Provider-specific convenience methods |
| `signOut()` | Sign out and invalidate refresh token |
| `refreshSession()` | Refresh the access token |
| `getUser()` / `updateUser(updates)` | Current user profile |
| `resetPasswordForEmail(email)` | Request password reset |
| `resetPassword(token, password)` | Complete password reset |
| `changePassword(old, new)` | Change password (authenticated) |
| `sendVerificationEmail()` / `verifyEmail(token)` | Email verification |
| `getSessions()` / `revokeSession(id)` / `revokeAllSessions()` | Session management |
| `getAuthConfig()` | Fetch backend auth configuration |
| `getSession()` | Get current session (sync) |
| `onAuthStateChange(callback)` | Subscribe to auth events (`SIGNED_IN`, `SIGNED_OUT`, `TOKEN_REFRESHED`, `USER_UPDATED`) |

### Storage Module (`client.storage`)

| Method | Description |
|---|---|
| `putObject({ file, key, metadata, bucket })` | Upload a file |
| `getSignedUrl(key, bucket?)` | Get download URL + metadata |
| `getObject(key, bucket?)` | Download file as `File` object |
| `deleteObject(key, bucket?)` | Delete a file |
| `listObjects(prefix, options?)` | List files with optional pagination |

### Admin Module (`client.admin`)

| Method | Description |
|---|---|
| `listUsers()` / `listUsersPaginated(options?)` | List all users |
| `getUser(userId)` | Get a single user |
| `createUser(data)` | Create a user |
| `updateUser(userId, data)` | Update a user |
| `deleteUser(userId)` | Delete a user |
| `bootstrap()` | First-user bootstrap |

### Functions Module (`client.functions`)

| Method | Description |
|---|---|
| `invoke<T>(name, payload?, options?)` | Call a custom backend function at `/api/functions/{name}` |

### Other Exports

| Export | Description |
|---|---|
| `RebaseApiError` | Error class with `status`, `message`, `code`, `details` |
| `RebaseWebSocketClient` | WebSocket client for realtime subscriptions |
| `isOfflineError(error)` | True when a read failed with no network *and* nothing cached |
| `MemoryOfflineStore` | Reference `OfflineStore`; the IndexedDB one is wired automatically |
| `createCookieStorage(options?)` | Cookie-based auth storage adapter |
| `createMemoryStorage()` | In-memory auth storage adapter |
| `QueryBuilder` | Fluent query builder (also re-exported from `@rebasepro/common`) |
| `Snapshot`, `FindResponse` | Re-exported from `@rebasepro/types` |

## Quick Start

```ts
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({
    baseUrl: "http://localhost:3001",
});

// Auth
await client.auth.signInWithEmail("user@example.com", "password");

// CRUD
const { data: products } = await client.data.products.find({ limit: 10 });
const product = await client.data.products.create({ name: "Camera", price: 299 });
await client.data.products.update(product.id, { price: 249 });
await client.data.products.delete(product.id);

// Fluent queries
const { data: expensive } = await client.data.products
    .where("price", ">=", 100)
    .orderBy("price", "desc")
    .limit(5)
    .find();

// Custom function
const result = await client.functions.invoke("process-order", { orderId: "123" });

// Realtime
const unsubscribe = client.data.products.listen(
    { limit: 50 },
    (response) => console.log("Update:", response.data)
);
```

## Related Packages

- [`@rebasepro/common`](../common) — `QueryBuilder`, `buildRebaseData`, shared utilities
- [`@rebasepro/types`](../types) — `Snapshot`, `FindResponse`, `CollectionAccessor`, etc.
- [`@rebasepro/utils`](../utils) — `toSnakeCase` and other helpers
- [`@rebasepro/app`](../auth) — React hook adapter that wraps `client.auth` for CMS integration
