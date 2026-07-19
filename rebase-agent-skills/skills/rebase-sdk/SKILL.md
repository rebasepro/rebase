---
name: rebase-sdk
description: Guide for using the Rebase generated TypeScript SDK and client library. Use this skill when the user needs to interact with a Rebase backend from client-side or server-side code, including CRUD operations, filtering, authentication, realtime subscriptions, file storage, custom functions, or admin operations.
---

# Rebase SDK

The Rebase SDK consists of two packages that work together to provide end-to-end type-safe access to a Rebase backend:

- **`@rebasepro/client`** — The runtime client with CRUD, auth, realtime, storage, and more
- **SDK Generator** — Generates TypeScript types from your collection definitions (via CLI or MCP tool)

The generated types are passed as a generic parameter to the client, providing full type safety across all operations.

> **IMPORTANT FOR AGENTS:** Always generate the SDK types first before writing client code. Use the `rebase_generate_sdk` MCP tool or `npx rebase generate-sdk` CLI command. The generated types live at `./generated/sdk/database.types.ts` relative to the project root.

## SDK Generation

### How to Generate

**Via MCP tool (preferred):**

Use the `rebase_generate_sdk` MCP tool — no parameters required. It reads collections from `./config/collections` and writes the output to `./generated/sdk/`.

**Via CLI:**

```bash
npx rebase generate-sdk
```

### What Gets Generated

A single `database.types.ts` file containing:

| Export | Description |
|--------|-------------|
| `Database` | Interface with a key per collection, each containing `Row`, `Insert`, and `Update` sub-types |
| `CollectionName` | Union type of all collection slug strings |
| `CollectionsDictionary` | Runtime constant mapping camelCase names to snake_case slugs |

**Sub-type semantics:**

| Sub-type | Purpose | ID fields | Required fields |
|----------|---------|-----------|-----------------|
| `Row` | Read type — what you get back from queries | Required | All present |
| `Insert` | Create type — for new records | Optional (auto-generated) | Required fields stay required |
| `Update` | Partial update type | N/A | All optional |

### Property Type Mapping

| Rebase Type | TypeScript Type |
|-------------|-----------------|
| `string` | `string` (or string literal union if `enum` defined) |
| `number` | `number` (or number literal union if `enum` defined) |
| `boolean` | `boolean` |
| `date` | `string` (ISO 8601) |
| `geopoint` | `{ latitude: number; longitude: number }` |
| `reference` | `string \| number` |
| `map` | Nested `{ ... }` or `Record<string, any>` |
| `array` | `Array<T>` or `Array<any>` |
| `vector` | `number[]` |
| `binary` | `string` |

Relations are typed as `{ id: string; path: string; __type: "relation"; data?: RelatedRow }`.

## Client Initialization

```typescript
import { createRebaseClient } from '@rebasepro/client';
import type { Database } from './generated/sdk/database.types';

const rebase = createRebaseClient<Database>({
    baseUrl: 'http://localhost:3001',
});
```

### Typed SDK Return Type

The `createRebaseClient<DB>()` factory returns a reconciled client type of `CreateRebaseClientResult<DB>` (which extends the base `RebaseClient` from `@rebasepro/types`). 

Passing your generated `Database` type maps camelCase collection names (e.g. `posts`) to their database schemas (`Row`, `Insert`, and `Update` types), providing autocomplete and type safety across the entire `data` layer.

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `baseUrl` | `string` | — | Backend URL (required) |
| `token` | `string` | — | Static JWT token (e.g., service key for server-side scripts) |
| `apiPath` | `string` | `'/api'` | API path prefix |
| `websocketUrl` | `string` | Auto-derived from `baseUrl` | WebSocket URL for realtime |
| `fetch` | `typeof fetch` | Global `fetch` | Custom fetch implementation |
| `onUnauthorized` | `() => void` | — | Handler called on 401 responses |

### Server-Side Usage

For server-side scripts or service-to-service calls, pass a service key as the `token`:

```typescript
const rebase = createRebaseClient<Database>({
    baseUrl: 'https://api.myapp.com',
    token: process.env.REBASE_SERVICE_KEY,
});
```

## CRUD Operations

> **IMPORTANT FOR AGENTS:** There are two access patterns for collections. Both are fully typed when using the `Database` generic. Prefer the property-style access for better readability.

### Access Patterns

```typescript
// 1. Property-style access (camelCase — auto-converted to snake_case slug)
const { data: posts } = await rebase.data.posts.find();

// 2. Collection method (explicit slug)
const { data: posts } = await rebase.data.collection('posts').find();
```

### Available Operations

| Method | Signature | Returns | Description |
|--------|-----------|---------|-------------|
| `find` | `find(params?)` | `{ data: Entity[], meta }` | List documents with filtering/pagination |
| `findById` | `findById(id)` | `Entity \| undefined` | Get a single document by ID |
| `create` | `create(data, id?)` | `Entity` | Create a new document |
| `update` | `update(id, data)` | `Entity` | Update an existing document |
| `delete` | `delete(id)` | `void` | Delete a document |
| `count` | `count(params?)` | `number` | Count matching documents |

### Examples

```typescript
// Create
const post = await rebase.data.posts.create({
    title: 'Hello World',
    status: 'draft',
    content: 'My first post',
});

// Read
const post = await rebase.data.posts.findById('post-123');

// Update
const updated = await rebase.data.posts.update('post-123', {
    status: 'published',
});

// Delete
await rebase.data.posts.delete('post-123');

// Count
const total = await rebase.data.posts.count({
    where: { status: 'eq.published' },
});
```

### Response Format

The `find()` method returns a response with data and pagination metadata:

```typescript
const response = await rebase.data.posts.find({ limit: 20, offset: 0 });

// response.data  → Entity[]
// response.meta  → { total: number, limit: number, offset: number, hasMore: boolean }
```

## Filtering, Sorting & Pagination

There are two approaches to querying: **FindParams objects** and the **fluent QueryBuilder**.

### Approach 1: FindParams Object

Pass a params object directly to `.find()`:

```typescript
const result = await rebase.data.posts.find({
    limit: 20,
    offset: 0,
    orderBy: 'createdAt:desc',
    searchString: 'search term',
    include: ['tags', 'author'],   // or ['*'] for all relations
    where: {
        status: 'eq.published',
        price: 'gte.100',
        category: 'in.(electronics,books)',
    },
});
```

### Filter Operators (String Syntax)

| Operator | Description | Example |
|----------|-------------|---------|
| `eq` | Equal | `'eq.published'` |
| `neq` | Not equal | `'neq.draft'` |
| `gt` | Greater than | `'gt.100'` |
| `gte` | Greater than or equal | `'gte.100'` |
| `lt` | Less than | `'lt.50'` |
| `lte` | Less than or equal | `'lte.50'` |
| `in` | In list | `'in.(electronics,books)'` |
| `nin` | Not in list | `'nin.(archived,deleted)'` |
| `cs` | Array contains | `'cs.tag1'` |
| `csa` | Array contains any | `'csa.(tag1,tag2)'` |

### Approach 2: Fluent QueryBuilder

Chain methods for a more readable query API:

```typescript
const result = await rebase.data.posts
    .where('status', '==', 'published')
    .where('price', '>=', 100)
    .orderBy('createdAt', 'desc')
    .limit(20)
    .offset(0)
    .search('keyword')
    .include('tags', 'author')
    .find();
```

### Complex Logical Conditions

Use `or`, `and`, and `cond` helpers for complex filters:

```typescript
import { or, and, cond } from '@rebasepro/client';

const result = await rebase.data.posts
    .where(or(
        cond('status', '==', 'published'),
        and(
            cond('status', '==', 'draft'),
            cond('authorId', '==', currentUserId)
        )
    ))
    .find();
```

### QueryBuilder Methods

| Method | Description |
|--------|-------------|
| `.where(field, op, value)` | Add a filter condition |
| `.where(logicalCondition)` | Add complex `or`/`and`/`cond` filter |
| `.orderBy(field, direction?)` | Sort results (`'asc'` or `'desc'`) |
| `.limit(n)` | Limit number of results |
| `.offset(n)` | Skip first `n` results |
| `.search(term)` | Full-text search |
| `.include(...relations)` | Include related entities |
| `.find()` | Execute the query |
| `.listen(callback, errorCallback?)` | Subscribe to realtime updates |

## Authentication

### Email / Password

```typescript
// Sign up
await rebase.auth.signUp('user@example.com', 'password', 'Display Name');

// Sign in
await rebase.auth.signInWithEmail('user@example.com', 'password');

// Sign out
await rebase.auth.signOut();
```

### OAuth Providers

Twelve providers are supported with dedicated methods:

```typescript
// Google (ID token or authorization code flow)
await rebase.auth.signInWithGoogle({ idToken });
await rebase.auth.signInWithGoogle({ code, redirectUri });

// GitHub, Microsoft, Apple, Facebook, Twitter, Discord,
// GitLab, Bitbucket, Slack, Spotify, LinkedIn
await rebase.auth.signInWithGitHub(code, redirectUri);
await rebase.auth.signInWithMicrosoft(code, redirectUri);
await rebase.auth.signInWithApple(code, redirectUri);
// ... same pattern for all providers

// Generic OAuth (for custom providers)
await rebase.auth.signInWithOAuth('custom-provider', payload);
```

### Session Management

```typescript
// Get current session
const session = rebase.auth.getSession();

// Get current user
const user = await rebase.auth.getUser();

// Refresh session manually
await rebase.auth.refreshSession();

// Update user profile
await rebase.auth.updateUser({ displayName: 'New Name' });

// List active sessions
const sessions = await rebase.auth.getSessions();

// Revoke sessions
await rebase.auth.revokeSession(sessionId);
await rebase.auth.revokeAllSessions();
```

### Password Management

```typescript
// Forgot password flow
await rebase.auth.resetPasswordForEmail('user@example.com');
await rebase.auth.resetPassword(token, newPassword);

// Change password (while logged in)
await rebase.auth.changePassword(oldPassword, newPassword);
```

### Email Verification

```typescript
await rebase.auth.sendVerificationEmail();
await rebase.auth.verifyEmail(token);
```

### Auth State Listener

```typescript
const unsubscribe = rebase.auth.onAuthStateChange((event, session) => {
    // event: 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED'
    console.log('Auth event:', event);
});

// Clean up
unsubscribe();
```

**Session behavior:**
- Sessions are persisted to `localStorage` by default (configurable: `localStorage`, `memoryStorage`, `cookieStorage`)
- Tokens auto-refresh 120 seconds before expiry
- All requests automatically include the auth token
- On 401 responses, the client auto-refreshes the session and retries the request

## Realtime Subscriptions

### Listen to Collection Changes

```typescript
// Via CollectionClient
const unsubscribe = rebase.data.posts.listen(
    { where: { status: 'published' }, limit: 50 },
    (response) => {
        // response: FindResponse with updated data
        console.log('Updated posts:', response.data);
    },
    (error) => {
        console.error('Subscription error:', error);
    }
);
```

### Listen to a Single Entity

```typescript
const unsubscribe = rebase.data.posts.listenById(
    'post-123',
    (entity) => {
        // entity: Entity | undefined
        console.log('Post updated:', entity);
    },
    (error) => {
        console.error('Error:', error);
    }
);
```

### Listen via QueryBuilder

```typescript
const unsubscribe = rebase.data.posts
    .where('status', '==', 'published')
    .orderBy('createdAt', 'desc')
    .limit(20)
    .listen((response) => {
        console.log('Realtime updates:', response.data);
    });
```

### WebSocket Events

```typescript
rebase.ws?.on('connect', () => { console.log('Connected'); });
rebase.ws?.on('disconnect', () => { console.log('Disconnected'); });
rebase.ws?.on('reconnect', () => { console.log('Reconnected'); });
rebase.ws?.on('error', (err) => { console.error('WS error:', err); });

// Disconnect manually
rebase.ws?.disconnect();
```

**Realtime features:**
- Auto-reconnect with exponential backoff (max 5 attempts)
- Subscription deduplication
- Client-side entity caching with structural merge
- Instant entity patches across subscriptions
- Auto-authentication and re-authentication on token refresh

### The socket connects lazily

Creating a client opens **no** WebSocket. It is dialled on the first operation that needs one — a `.listen(...)` or any channel operation. Creating a client, obtaining a channel, and reading data over HTTP all stay socket-free.

This matters for apps with signed-out traffic (marketing pages, docs, public views, anonymous-first tools): they no longer pay a connection per page load just to have realtime available. `realtime: false` remains a hard opt-out — no socket ever, and `client.realtime.channel()` throws.

Signing in does not by itself open a socket; a socket opened later authenticates itself, and one already open is re-authenticated on `SIGNED_IN` / `TOKEN_REFRESHED`. `client.close()` is final — nothing queued afterwards redials.

### Broadcast channels & presence

For client-to-client messaging and online status, use `client.realtime.channel(name)` rather than reaching for `client.ws`:

```typescript
const channel = rebase.realtime.channel("document-42");

// Publish your own presence — call again to update it (e.g. a moving cursor).
await channel.track({ name: "Alice", cursor: { line: 10, col: 5 } });

// The full roster, plus the diff that caused the change.
channel.onPresence((presences, diff) => {
    console.log(Object.keys(presences).length, "people here");
});

// Broadcasts — the sender never receives its own message.
await channel.broadcast("typing", { userId: "u1" });
channel.onBroadcast("typing", (payload) => { /* ... */ });

await channel.leave(); // releases handlers and the presence heartbeat
```

Channels are per-name singletons, so two components asking for `"document-42"` share one object and neither can cut the other off by leaving.

The SDK handles two protocol details that are easy to get wrong by hand: **the roster is not pushed on join** (a joining client's `presence_diff` contains only itself, so the full state must be requested), and **presence expires after 30 seconds** unless re-sent — the SDK heartbeats at 20s. Channel and presence frames do not require an account, so anonymous visitors can join public channels; the server still authorizes them. See the **rebase-realtime** skill for the raw protocol.

## File Storage

```typescript
// Upload file
const result = await rebase.storage.putObject({
    file: fileBlob,        // File or Blob
    key: 'path/to/file',   // Optional custom key
    bucket: 'my-bucket',   // Optional bucket
    metadata: { ... },     // Optional metadata
});

// Get signed download URL
const { url, metadata } = await rebase.storage.getSignedUrl('path/to/file', 'bucket');

// Download file
const file = await rebase.storage.getObject('path/to/file', 'bucket');

// Delete file
await rebase.storage.deleteObject('path/to/file', 'bucket');

// List files
const { items, nextPageToken } = await rebase.storage.listObjects('prefix/', {
    bucket: 'my-bucket',
    maxResults: 100,
    pageToken: 'next-page-token',
});
```

### Multi-Backend Storage

`rebase.storage` accesses the **default** storage source. For multi-backend setups (e.g. S3 + GCS/Firebase), collection properties can specify `storage.storageSource` in their schema to route uploads to a named backend.

On the frontend, register direct storage sources via the `storageSources` prop on `<Rebase>`:

```tsx
import { getStorage } from "firebase/storage";

const firebaseStorageSource = getStorage(firebaseApp);

<Rebase
    client={rebaseClient}
    storageSources={[
        { key: "firebase", engine: "firebase", transport: "direct", source: firebaseStorageSource }
    ]}
>
    {children}
</Rebase>
```

The system resolves the correct source per-property via `StorageSourcesContext` (mirroring `DataSourcesContext`). Properties bound to a `direct` storage source bypass the Rebase backend and upload/download directly to the provider (e.g. Firebase Storage), while `server` sources route through the Rebase API with a `?storageId` query parameter for backend routing.

## Custom Functions

Invoke custom server-side functions defined in the backend:

```typescript
// Basic invocation
const result = await rebase.functions.invoke<{ job: Job }>('extract-job', {
    url: 'https://example.com/posting',
    html: htmlContent,
});

// With additional options
await rebase.functions.invoke('my-function', payload, {
    method: 'GET',
    path: 'sub-path/123',
    headers: { 'X-Custom': 'value' },
});
```

## Admin Operations

> **IMPORTANT FOR AGENTS:** Admin operations require a service key or admin-level JWT token. These should only be used in server-side scripts or admin panels — never expose them in client-side code.

```typescript
// List users
const users = await rebase.admin.listUsers();

// Paginated user listing
const result = await rebase.admin.listUsersPaginated({
    search: 'john',
    limit: 20,
    offset: 0,
    orderBy: 'createdAt',
    orderDir: 'desc',
});

// CRUD operations
const user = await rebase.admin.getUser(userId);
const newUser = await rebase.admin.createUser({
    email: 'new@example.com',
    displayName: 'New User',
    password: 'securePassword',
    roles: ['editor'],
});
await rebase.admin.updateUser(userId, { displayName: 'Updated Name', roles: ['admin'] });
await rebase.admin.deleteUser(userId);

// Bootstrap (initial admin setup)
await rebase.admin.bootstrap();
```

## Cron Jobs

Manage scheduled background tasks from the client:

```typescript
// List all cron jobs
const jobs = await rebase.cron.listJobs();

// Get a specific job
const job = await rebase.cron.getJob(jobId);

// Trigger a job manually
await rebase.cron.triggerJob(jobId);

// Get job execution logs
const logs = await rebase.cron.getJobLogs(jobId, { limit: 50 });

// Enable/disable a job
await rebase.cron.toggleJob(jobId, true);   // enable
await rebase.cron.toggleJob(jobId, false);  // disable
```

## Generic Endpoint Call

Call any custom API endpoint directly:

```typescript
const result = await rebase.call<MyResponseType>('/my-endpoint', payload);
```

## React Integration Example

A common pattern for using the SDK in a React application:

```typescript
// src/client.ts
import { createRebaseClient } from '@rebasepro/client';
import type { Database } from './generated/sdk/database.types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
export const rebase = createRebaseClient<Database>({ baseUrl: API_URL });
```

```typescript
// src/hooks/useCollection.ts
import { useState, useEffect } from 'react';
import { rebase } from '../client';

export function useCollection<T extends keyof Database>(
    slug: T,
    options?: { limit?: number; where?: Record<string, string> }
) {
    const [data, setData] = useState<Database[T]['Row'][]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = rebase.data.collection(slug).listen(
            { limit: options?.limit, where: options?.where },
            (response) => {
                setData(response.data);
                setLoading(false);
            }
        );
        return unsubscribe;
    }, [slug]);

    return { data, loading };
}
```

```typescript
// src/hooks/useAuth.ts
import { useState, useEffect } from 'react';
import { rebase } from '../client';

export function useAuth() {
    const [user, setUser] = useState(null);

    useEffect(() => {
        const unsubscribe = rebase.auth.onAuthStateChange((event, session) => {
            setUser(session?.user ?? null);
        });
        return unsubscribe;
    }, []);

    return {
        user,
        signIn: (email: string, password: string) =>
            rebase.auth.signInWithEmail(email, password),
        signUp: (email: string, password: string, name: string) =>
            rebase.auth.signUp(email, password, name),
        signOut: () => rebase.auth.signOut(),
    };
}
```

## References

- **Documentation:** [rebase.pro/docs](https://rebase.pro/docs)
- **GitHub:** [github.com/rebasepro/rebase](https://github.com/rebasepro/rebase)
- **Client package source:** `packages/client/src/`
- **SDK generator source:** `packages/codegen/src/`
- **QueryBuilder source:** `packages/common/src/data/query_builder.ts`
- **SDK demo example:** `examples/sdk-demo/`
