# @rebasepro/client

HTTP SDK client for the Rebase backend — typed CRUD, auth, storage, realtime WebSockets, offline / local-first sync, admin, cron, and custom functions.

## Installation

```bash
pnpm add @rebasepro/client
```

ESM-only: `"type": "module"` with no CommonJS build, so it is loaded with
`import`. It needs Node `>=22.22.0` (its `engines` floor), where `require()`
of it resolves too: Node has supported `require(esm)` since 22.12.

## What This Package Does

`@rebasepro/client` is the primary SDK for interacting with a Rebase backend from any JavaScript/TypeScript environment (browser, Node.js, edge). It creates a single client instance that provides:

- **Collection CRUD** with a fluent query builder (`.where()`, `.orderBy()`, `.limit()`, etc.)
- **Authentication** — email/password, Google, 10+ OAuth providers, session management, password reset
- **Admin** — user CRUD for admins
- **Storage** — file upload, download, delete, list
- **Realtime** — WebSocket subscriptions for collection and row changes
- **Offline / local-first sync** (opt-in) — a local row database, writes that apply instantly offline and replay when the connection returns, and live queries
- **Cron** — list, trigger, and manage cron jobs
- **Custom functions** — invoke server-side Hono route functions
- **Type-safe data proxy** — `client.data.products` auto-maps to the `products` collection

## Key Exports

### Client Factory

| Export | Description |
|---|---|
| `createRebaseClient<DB>(options)` | Create a client instance. Generic `DB` parameter enables type-safe `client.data.*` access. |
| `CreateRebaseClientResult<DB>` | The client type it returns (`RebaseClient<DB>` from `@rebasepro/types`, narrowed) — includes `auth`, `admin`, `cron`, `functions`, `storage`, `ws`, `data`, `call`, and token management methods. |
| `CreateRebaseClientOptions` | Extends `RebaseClientConfig` with the `auth`, `admin`, `cron`, `apiKeys` and `personalKeys` sub-configs, plus `storageSources`, `collections`, `offline` and `debug`. |

### Config

| Option | Type | Default | Description |
|---|---|---|---|
| `baseUrl` | `string` | `""` | Backend URL (e.g. `http://localhost:3001`) |
| `token` | `string` | — | Auth token, read each time one is needed (so it may be declared as a getter) until `setToken()` or a sign-in replaces it |
| `apiPath` | `string` | `"/api"` | API path prefix |
| `fetch` | `typeof fetch` | `globalThis.fetch` | Custom fetch implementation |
| `onUnauthorized` | `() => Promise<boolean>` | auto-refresh | Handler for a refused token, over HTTP (401) and on the realtime socket |
| `websocketUrl` | `string` | derived from `baseUrl` | WebSocket URL for realtime |
| `realtime` | `boolean` | `true` | Open the WebSocket — `false` lets a one-shot script exit |
| `collections` | `Record<string, string>` | — | Maps accessor names to collection slugs |
| `offline` | `boolean \| OfflineConfig` | `false` | Local-first sync — see [the docs](https://rebase.pro/docs/sdk/offline) |
| `debug` | `boolean` | `false` | Log the realtime connection's progress with `console.debug`. One browser can turn it on with `localStorage.setItem("rebase_debug", "1")` — see [Connection logging](https://rebase.pro/docs/sdk#connection-logging) |

### Tokens

| Method | Description |
|---|---|
| `setAuthTokenGetter(getter)` | Ask `getter` for the token each time one is needed: every HTTP request and every time the realtime socket authenticates. This is how a host signing users in with its own provider (Clerk, Firebase Auth, its own session) authenticates the client. It comes before the client's own session and the `token` option |
| `setToken(token)` | Send this token from now on, over HTTP and on the socket |
| `setOnUnauthorized(handler)` | Answer a refused token, on HTTP and the socket; resolve `true` to retry |
| `resolveToken()` | The token the next request would carry |

Installing a getter or calling `setToken()` rebuilds an open socket so it authenticates as the new credential. `client.ws.setAuthTokenGetter()` is deprecated: it still works, warns once, and reaches only the socket.

```ts
client.setAuthTokenGetter(() => clerk.session?.getToken() ?? Promise.resolve(null));
```

### Collection Client

`client.data.collection("slug")` or `client.data.myCollection` returns a `CollectionClient<M>`:

| Method | Description |
|---|---|
| `find(params?)` | Query with pagination. Returns `FindResult<M>` (`{ data, meta }`, flat rows) |
| `findById(id)` | Fetch a single row. Returns `M \| undefined` |
| `create(data, id?)` | Create a row. Returns `M` |
| `update(id, data)` | Update a row. Returns `M` |
| `delete(id)` | Delete a row |
| `count(params?)` | Count matching rows |
| `where(col, op, val)` | Start a fluent query — returns a query builder |
| `orderBy(col, dir?)` | Order results — returns a query builder |
| `limit(n)` / `offset(n)` | Pagination — returns a query builder |
| `search(str)` | Text search: a case-insensitive substring match by default, ranked full-text where the collection opts in — returns a query builder |
| `include(...rels)` | Include related rows — returns a query builder |
| `listen(params, onUpdate, onError?)` | Realtime subscription (requires WebSocket) |
| `listenById(id, onUpdate, onError?)` | Realtime single-row subscription |
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
| `listUsers(options?)` / `listUsersPaginated(options?)` | One page of users (25 by default; `limit`, `offset`, `search`, `orderBy`, `orderDir`) with `total` |
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
| `or`, `and`, `not`, `cond` | Logical-condition helpers for `.where(…)` |
| `FindResult`, `FindParams`, `User`, … | Re-exported from `@rebasepro/types` |

## Quick Start

```ts
import { createRebaseClient } from "@rebasepro/client";

// Without a type argument every row is `Record<string, unknown>`. Pass the
// `Database` type `rebase generate-sdk` writes — `createRebaseClient<Database>(…)`
// — and every row, filter and sort below is checked.
const client = createRebaseClient({
    baseUrl: "http://localhost:3001",
});

// Auth
await client.auth.signInWithEmail("user@example.com", "password");

// CRUD
const { data: products } = await client.data.products.find({ limit: 10 });
const product = await client.data.products.create({ name: "Camera", price: 299 });
await client.data.products.update(42, { price: 249 });
await client.data.products.delete(42);

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
- [`@rebasepro/types`](../types) — `Entity`, `FindResult`, `CollectionAccessor`, etc.
- [`@rebasepro/utils`](../utils) — `toSnakeCase` and other helpers
- [`@rebasepro/app`](../app) — React hook adapter that wraps `client.auth` for CMS integration
