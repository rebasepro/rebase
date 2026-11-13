---
name: rebase-sdk
description: Guide for using the Rebase generated TypeScript SDK and client library. Use this skill when the user needs to interact with a Rebase backend from client-side or server-side code, including CRUD operations, filtering, text and vector search, authentication, realtime subscriptions, live queries, offline support and local-first sync, file storage, custom functions, or admin operations.
---

# Rebase SDK

The Rebase SDK consists of two packages that work together to provide end-to-end type-safe access to a Rebase backend:

- **`@rebasepro/client`** — The runtime client with CRUD, auth, realtime, storage, and more
- **SDK Generator** — Generates TypeScript types from the tables in `backend/schema` (via CLI or MCP tool)

The generated types are passed as a generic parameter to the client, providing full type safety across all operations.

> **IMPORTANT FOR AGENTS:** Make sure the SDK types are current before writing client code. While `rebase dev` is running they are: it regenerates them on start and on every save under `backend/schema/`. Otherwise use the `rebase_generate_sdk` MCP tool or `npx @rebasepro/cli generate-sdk` CLI command. The generated types live at `./generated/sdk/database.types.ts` relative to the project root.

## SDK Generation

### How to Generate

**Under `rebase dev`:** nothing to run. It regenerates `./generated/sdk/` on start and on every save under `backend/schema/`. Generate it yourself in CI, in a frontend repository with no `backend/schema` (`generate-sdk --from link` or `--from <url>`), or when `rebase dev` is not running.

**Via MCP tool (preferred):**

Use the `rebase_generate_sdk` MCP tool — no parameters required. It compiles the tables `backend/schema/index.ts` exports and writes the output to `./generated/sdk/`.

**Via CLI:**

```bash
npx @rebasepro/cli generate-sdk
```

### What Gets Generated

A `database.types.ts` file (written beside `schema.meta.ts`, which exports the `SCHEMA_VERSION` to pass as the client's `schemaVersion` option, and a `README.md`) containing:

| Export | Description |
|--------|-------------|
| `Database` | Interface with a key per table *accessor*, each containing `Row`, `Insert`, and `Update` sub-types |
| `TableName` | Union of the accessor names (`keyof Database`) — not the slugs |
| `tablesDictionary` | Runtime constant mapping each accessor to the slug the wire uses |
| `TablesDictionary` | The type of that constant |

**Sub-type semantics:**

| Sub-type | Purpose | Primary key | Other fields |
|----------|---------|-------------|--------------|
| `Row` | Read type — what a query returns | Always present | Required ones present; the rest are `T \| null` |
| `Insert` | Create type — for new records | Optional when the server assigns it | Required fields stay required |
| `Update` | Partial update type | Not settable | All optional |

A column marked `.private()` is absent from all three — the API surface
does not mention it, in either direction. A write naming one is refused for
every caller, with `VALIDATION_EXCLUDED_FIELDS`; server code sets it through
`context.data` in a hook or `rebase.dataAsAdmin`. A `.readOnly()` or stamped
column is in `Row` but not in `Insert` / `Update`.

**A field's wire name is its column key, and the API is camelCase throughout.**
A `createdAt` column key stored in a `created_at` column is `row.createdAt`; a
relation's foreign key is `authorId` while the column stays `author_id`. The
table accessor is turned into a property name the same way (`my-notes` →
`data.myNotes`). A column key *you* wrote is your key, whatever its shape —
only the two derived keys, a relation's foreign key and an introspected column,
are camel-cased. `where` and `orderBy` are keyed off `Row`, so the generated name
is the one the backend answers to.

### Column Type Mapping

| Column | TypeScript Type |
|--------|-----------------|
| `col.text()`, `col.varchar({ length })`, `col.uuid()` | `string` |
| `col.enum([...])`, a `pgEnum`, `col.text({ enum: [...] })`, `.oneOf([...])` | the union of the values |
| `col.integer()`, `col.bigint({ mode: "number" })`, `col.numeric()`, … | `number` |
| `col.boolean()` | `boolean` |
| `col.timestamp({ withTimezone: true })`, `col.date()`, `col.time()` | `string` (ISO 8601) |
| `col.geopoint()` | `{ latitude: number; longitude: number }` |
| `col.jsonb(shape)` / `col.jsonb().$type<T>()` | the shape's type / `T` |
| `<builder>.array()`, e.g. `col.text().array()` | `Array<inner>` |
| `col.vector({ dimensions })` | `number[]` |
| `col.bytea()` | `string` (base64) |
| `col.storage()` | `string` (`string[]` with `.multiple()`) |

A column without `.notNull()` is `T | null` on `Row`. The same types are
available from the table itself with `InferRow<typeof posts>` (see
`rebase-tables`).

A relation is typed as the **target's own `Row`, inlined** — that is what
`include` serves. It is optional on every read, because it is only loaded when
the query names it in `include`. No read returns a `{ __type }` envelope —
not REST, the SDK, the socket or a driver's `fetchOne` — and the client does
not turn one into a class: a value is the JSON the server sent.

On writes, a `belongsTo` target can be named either way: `{ author: 5 }` (the
relation) or `{ authorId: 5 }` (its foreign key). Both are in `Insert`
and `Update`.

## Client Initialization

```typescript
import { createRebaseClient } from '@rebasepro/client';
import { tablesDictionary, type Database } from './generated/sdk/database.types';

const rebase = createRebaseClient<Database>({
    baseUrl: 'http://localhost:3001',
    // Maps each accessor back to its slug. Without it, a slug that is not a
    // valid property name cannot be resolved and the request 404s.
    tables: tablesDictionary,
});
```

### Typed SDK Return Type

The `createRebaseClient<DB>()` factory returns a reconciled client type of `CreateRebaseClientResult<DB>` (which extends the base `RebaseClient` from `@rebasepro/types`). 

Passing your generated `Database` type maps camelCase table names (e.g. `posts`) to their database schemas (`Row`, `Insert`, and `Update` types), providing autocomplete and type safety across the entire `data` layer.

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `baseUrl` | `string` | Same origin (browser only) | Backend origin — scheme, host and port only. Never include `/api`: `apiPath` is appended, so `.../api` builds `/api/api/…` and every request 404s |
| `token` | `string` | — | Static JWT token (e.g., service key for server-side scripts) |
| `apiPath` | `string` | `'/api'` | API path prefix |
| `websocketUrl` | `string` | Auto-derived from `baseUrl` | WebSocket URL for realtime |
| `fetch` | `typeof fetch` | Global `fetch` | Custom fetch implementation |
| `onUnauthorized` | `() => Promise<boolean>` | The client's own session refresh | Handler called on 401 responses and socket auth errors; resolve `true` to retry with the token resolved again |
| `realtime` | `boolean` | `true` | Open the WebSocket. Set `false` in one-shot scripts, or the process will not exit |
| `tables` | `Record<string, string>` | — | Maps accessor names to table slugs. **Required for a typed client**: pass the generated `tablesDictionary` |
| `offline` | `boolean \| OfflineConfig` | `false` | Local-first sync — see **Offline & Local-First Sync** below |

### Server-Side Usage

For server-side scripts or service-to-service calls, pass a service key as the `token`:

```typescript
const rebase = createRebaseClient<Database>({
    baseUrl: 'https://api.myapp.com',
    tables: tablesDictionary,
    token: process.env.REBASE_SERVICE_KEY,
});
```

## CRUD Operations

> **IMPORTANT FOR AGENTS:** There are two access patterns for tables. Both are fully typed when using the `Database` generic. Prefer the property-style access for better readability.

### Access Patterns

```typescript
// 1. Property-style access (the `tables` dictionary resolves each accessor to its slug)
const { data: posts } = await rebase.data.posts.find();

// 2. Table method (explicit slug — for a slug held in a variable)
const { data: posts } = await rebase.data.table('posts').find();
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
| `createMany` | `createMany(rows, { upsert? })` | `Entity[]` | Insert many rows in one transaction |
| `updateMany` | `updateMany([{ id, data }])` | `Entity[]` | Update many rows in one transaction |
| `deleteMany` | `deleteMany(ids)` | `void` | Delete many rows by id |
| `findAll` | `findAll(params?)` | `Entity[]` | Every matching row, paging internally |
| `iterate` | `iterate(params?)` | `AsyncIterable<Entity>` | Stream matching rows page by page |
| `upsert` | `upsert(data, { onConflict? })` | `Entity` | Insert, or update the row matching on the primary key (or `onConflict` columns) |
| `aggregate` | `aggregate({ select, groupBy?, where?, … })` | rows (+ `meta`) | `count`/`sum`/`avg`/`min`/`max`/`countDistinct`/`mode`/`percentile`/`distinct`/`fingerprint` — see **Aggregates** |
| `refresh` | `refresh({ concurrently? })` | `void` | Recompute a materialized view (`defineView(…, { materialized: true })`) |

### Bulk writes

```typescript
await rebase.data.orders.createMany([{ total: 10 }, { total: 20 }]);

// Update names the address separately from the values
await rebase.data.orders.updateMany([
    { id: 'o-1', data: { status: 'shipped' } },
    { id: 'o-2', data: { status: 'shipped' } },
]);

await rebase.data.sessions.deleteMany(['s-1', 's-2']);
```

On a table with no `beforeSave`/`afterSave`/`afterSaveError` hook, no
`history` and no `tenant`, `createMany` (upsert too) and `updateMany` are a few
multi-row statements, not one per row — 1,000 rows is one `INSERT … RETURNING`.
Prefer them, and `updateMany` with a value per row, over a loop of single
writes or raw `UPDATE … FROM (VALUES …)`.

`createMany` takes flat rows because a row being created *is* its columns.
`updateMany` takes `{ id, data }` because on a table keyed on something other
than `id` — a `sku`, a composite key — a flat row cannot say which column is the
address and which is a value to write.

**To write by a condition, use `updateWhere` / `deleteWhere`, never a read then
`deleteMany`.** One statement, atomic, one round trip; matching nothing is `[]` /
`0`, not an error. A filter naming the version you read is a compare-and-set. An
empty filter is refused (`FILTER_REQUIRED`):

```typescript
await rebase.data.sessions.deleteWhere({ where: { expiresAt: ['<', cutoff] } });

const [saved] = await rebase.data.saves.updateWhere(
    { where: { player: ['==', player], rev: ['==', rev] } },
    { body, rev: { $inc: 1 } },
); // undefined: somebody saved first
```

**Insert-or-skip and keep-the-best are upsert options, not a read first:**
`upsert(row, { ignoreDuplicates: true })` (`ON CONFLICT DO NOTHING`) and
`upsert(row, { where: { score: ['<', score] } })` (`ON CONFLICT DO UPDATE …
WHERE`). Both resolve to `undefined` when the stored row was kept.

**Several counts are one aggregate:** give each `{ fn: 'count', as: 'live',
where: { … } }` (`FILTER (WHERE …)`). Case-insensitive membership is
`{ 'lower(artist)': ['in', names] }`, not an OR of `ilike`s.

### Never hand-roll a paging loop

`findAll()` returns every matching row; `iterate()` yields them page by page so a
large result never lands in memory at once. Both page internally.

```typescript
for await (const order of rebase.data.orders.iterate({ where: { status: ['==', 'paid'] } })) {
    await handleOrder(order);
}
```

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
    where: { status: ['==', 'published'] },
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
    orderBy: ['createdAt', 'desc'],
    searchString: 'search term',
    include: ['tags', 'author'],   // or ['*'] for all relations
    where: {
        status: ['==', 'published'],
        price: ['>=', 100],
        category: ['in', ['electronics', 'books']],
    },
});
```

### Filter Operators (Tuple Syntax)

Every filter is a `[operator, value]` tuple. The bare-string and
`'eq.published'` wire formats are **not** part of the public API: they are
`WireFilterValues`, marked `@internal`, and `serializeFilter` passes such a
string straight through to PostgREST unchanged — so an operator-less value
silently produces a malformed query rather than an error.

| Operator | Description | Example |
|----------|-------------|---------|
| `==` | Equal | `['==', 'published']` |
| `!=` | Not equal | `['!=', 'draft']` |
| `>` | Greater than | `['>', 100]` |
| `>=` | Greater than or equal | `['>=', 100]` |
| `<` | Less than | `['<', 50]` |
| `<=` | Less than or equal | `['<=', 50]` |
| `in` | In list | `['in', ['electronics', 'books']]` |
| `not-in` | Not in list | `['not-in', ['archived', 'deleted']]` |
| `array-contains` | Array contains | `['array-contains', 'tag1']` |
| `array-contains-any` | Array contains any | `['array-contains-any', ['tag1', 'tag2']]` |
| `array-contains-all` | Array contains all | `['array-contains-all', ['tag1', 'tag2']]` |
| `array-contained-by` | Array holds nothing outside the list | `['array-contained-by', ['tag1', 'tag2']]` |
| `like` / `ilike` | Pattern match (SQL wildcards) | `['ilike', '%john%']` |
| `not-like` / `not-ilike` | Negated pattern match | `['not-ilike', '%test%']` |
| `is-null` / `is-not-null` | Null checks (value ignored) | `['is-null', null]` |

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

### Sorting by more than one column

A sort is a list of keys: the second decides between rows the first calls equal.
Both spellings mean the same query.

```typescript
// Params: a list of [field, direction] pairs.
await rebase.data.posts.find({
    orderBy: [['category', 'asc'], ['createdAt', 'desc']],
});

// Fluent: each call ADDS a key under the ones before it.
await rebase.data.posts
    .orderBy('category')             // primary
    .orderBy('createdAt', 'desc')   // tie-breaker
    .find();
```

Rules an agent needs before writing one:

- A missing direction is `'asc'`, on every driver.
- Every sort ends on the row id descending, whether asked for or not — that is
  what makes the order total, and paging over a non-total order repeats and
  skips rows. Do not add an id key yourself unless you want a different
  direction or rank for it.
- `iterate()`/`findAll()` seek with the server's `meta.nextCursor` on their
  own, multi-key sorts included, and fall back to `offset` only where the server
  issues no cursor. `cursor` makes seeking a requirement: a listing with no
  cursor throws `RebasePaginationError` with code `cursor-missing`.
- `orderBy('_score')` cannot key a cursor either, for the same reason: relevance
  is computed per query rather than stored.
- A field the table does not have is a 400, not a silently unsorted 200.

### Filtering and sorting by a related row

A filter key may reach through a relation to a *column* of the related row — not
just its id, which is all a relation filter could compare before:

```typescript
await rebase.data.talents.find({
    where: {
        'applications.status': ['in', ['applied', 'reviewing']],
        'applications.createdAt': ['<', '2026-01-01'],
    },
});
```

A sort key may be an aggregate over a to-many relation — `min`, `max`, `count`,
`sum`, `avg`. This is the half that cannot be worked around in the client,
because once a result is paged the page was already chosen by the wrong order:

```typescript
// Longest-waiting first
await rebase.data.talents.find({
    orderBy: [[{ relation: 'applications', field: 'createdAt', agg: 'min' }, 'asc']],
});
```

The object form is the authoring surface; on the wire the key is a single string,
`min(applications.createdAt)`.

Rules an agent needs before writing one:

- **Both are driver capabilities**, `supportsRelationFieldFilters` and
  `relationAggregateSorts`, and both default to **false** for an unclaimed
  driver. Firestore declares neither. Postgres has both.
- **The offline overlay refuses both** rather than answering them wrongly — a
  dotted key resolves to `undefined` on a cached row, which would exclude every
  row and read as "nothing matched".
- `!=` on a relation column is `NOT EXISTS` of the **positive** predicate, never
  `EXISTS` of a negated one. "Has no hired application" is the question a queue
  asks; "has some application that differs from hired" is true of nearly
  everyone and answers nothing.
- `is-null` and `is-not-null` are **not** a complementary pair here. They mean
  "has a related row whose column is unset" and "has one where it is set" — both
  true of a candidate with two applications, one of each.
- A relation that does not exist, or a column the target lacks, is a 400 naming
  the target's real columns — never a dropped condition, which would widen the
  read.

### Aggregates

`count`, `sum`, `avg`, `min` and `max` over the rows a filter selects, without
fetching them. From the SDK, `aggregate()` on a table — never a `findAll()`
and a reduce, which is wrong under a `limit` and unaffordable without one:

```typescript
const byStatus = await rebase.data.orders.aggregate({
    select: [{ fn: 'count' }, { fn: 'sum', field: 'total' }],
    groupBy: ['status'],
    where: { createdAt: ['>=', '2026-01-01'] },
});
// byStatus.meta → { limit, offset, hasMore } for a grouped aggregate
```

Over HTTP it is `GET /api/data/orders/aggregate?select=count(),sum(total)&groupBy=status`.

Results are keyed by function and field: `count()` becomes `count`, `sum(total)`
becomes `sum_total`. It takes the same filters as the list endpoint. Groups page
like a listing's rows — a grouped aggregate with no `limit` is cut at the
listing default (50 groups) — so read `meta.hasMore`.

Beyond those five: `countDistinct(f)` → `count_distinct_f`, `mode(f)` →
`mode_f`, `percentile(f, p)` (`{ fn: 'percentile', field, p: 0.95 }`) →
`p95_f`, `distinct(f)` (sorted distinct values as an array) → `distinct_f`, and
`fingerprint()` → `fingerprint`. A `groupBy` entry may transform its column —
`{ field: 'artist', transform: 'lower' }`, also `upper`, `year`/`month`/`day`
(UTC) and `unnest` (one group per element of an array column) — and comes back
as `<transform>_<field>` (`lower_artist`, `unnest_tags`). Over HTTP:
`?select=percentile(price,0.9)&groupBy=unnest(tags)`.

These replace the raw SQL apps used to write for them:

- distinct elements of an array → `groupBy: [{ field: 'tags', transform: 'unnest' }]`, not `SELECT DISTINCT unnest(tags)`;
- "has this table changed?" → `aggregate({ select: [{ fn: 'fingerprint' }] })` and compare strings, not `md5(string_agg(...))` over every row;
- `count(DISTINCT x)`, `mode() WITHIN GROUP`, `percentile_cont`, `GROUP BY lower(x)` / `date_trunc('day', …)` → the functions and transforms above.

What none of these cover is still SQL, run as the caller on the server: `getSql(c)` in a function, under the same row-level security as this SDK (see `rebase-custom-functions`).

Row-level security applies to the rows being aggregated — an aggregate is an
efficient way to learn about rows you cannot read, so someone who can select
nothing counts nothing. A driver without aggregate support answers **501**,
not an empty result.

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
| `.orderBy(field, direction?)` | Sort results (`'asc'` or `'desc'`, default `'asc'`). Calling it again **adds a tie-breaker** — it does not replace the first key |
| `.limit(n)` | Limit number of results |
| `.offset(n)` | Skip first `n` results |
| `.search(term)` | Text search — substring by default, ranked full-text if the table opted in |
| `.vectorSearch(column, vector, opts?)` | Nearest-neighbour search over a `col.vector()` column |
| `.include(...relations)` | Include related entities |
| `.find()` | Execute the query |
| `.listen(callback, errorCallback?)` | Subscribe to realtime updates |

### Searching

`.search(term)` behaves in one of two ways, and an agent must know which before
promising anything:

**Default (no `search` block on the table).** A case-insensitive substring
match, OR-ed across the table's *top-level* text columns. It cannot
see inside `jsonb` or array columns, does not rank, and cannot use an
index. If a user reports that search "finds nothing" for content they can see on
the record, this is almost always why — the content is in a JSON column.

**Opted in (the table declares `search`).** Ranked full-text matching over
exactly the fields named in the block, including paths into JSONB. Rows come
back with `_score`, which is sortable:

```typescript
const { data } = await client.data.talents
    .search("auditor iso 14001")
    .orderBy("_score", "desc")
    .find();
```

`orderBy("_score")` is a 400 on a table that has not opted in, or on a
query with no search string. Do not add it speculatively.

**Explaining a result.** `search(term, { explain: true })` adds `_matches` to
each row — `{ field, snippet }` per matching field, with hits wrapped in
`<mark>`. Use it when a user needs to know *why* a row is in the list; skip it
for bulk reads, since it costs a `ts_headline` per field per row. The snippet
carries markup and user-typed text: split on `<mark>` and render the parts
rather than injecting it as HTML.

To make a table searchable, add `search` to its `defineTable` — see the `rebase-tables`
skill. `where` + `like` is not the workaround it looks like: the operator does
exist, but a pattern beginning with `%` cannot use an index and scans the table.

### Vector search

For a table with a `col.vector()` column:

```typescript
const { data } = await client.data.docs
    .vectorSearch("embedding", queryVector, { threshold: 0.35 })
    .where("status", "==", "published")
    .limit(10)
    .find();
```

Rows come back closest-first with a `_distance`. `where` filters *before* the
ordering. Rebase does not compute embeddings — the caller supplies `queryVector`
from whatever model produced the stored ones.

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
// Apple also has a browser popup and a native-app form:
//   signInWithApplePopup({ clientId }), signInWithApple({ code, bundleId })
// ... same pattern for all providers, except Twitter, which also takes the
// PKCE verifier: signInWithTwitter(code, redirectUri, codeVerifier)

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
- Sessions are persisted to `localStorage` by default, in memory where there is none (configurable with `auth: { storage }` — `createMemoryStorage()`, `createCookieStorage()`, or any `{ getItem, setItem, removeItem }`)
- Tokens auto-refresh 120 seconds before expiry
- All requests automatically include the auth token
- On 401 responses, the client auto-refreshes the session and retries the request

## Realtime Subscriptions

### Listen to Table Changes

```typescript
// Via the table client
const unsubscribe = rebase.data.posts.listen(
    { where: { status: ['==', 'published'] }, limit: 50 },
    (response) => {
        // response: FindResult — `data` is flat rows, `meta` the pagination
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
    (row) => {
        // row: the flat row, or undefined once it is deleted
        console.log('Post updated:', row);
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
- Auto-reconnect with jittered exponential backoff (2s step doubling to 30s); it never gives up while a subscription or channel is live, and stops after 5 failed attempts only when nothing is registered
- Subscription deduplication
- Client-side entity caching with structural merge
- Every update is a debounced refetch under the subscriber's own scope (no instant row patches — they were removed)
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

## Offline & Local-First Sync

Opt in with one option. It is **off by default**, so nothing below applies unless you enable it:

```typescript
const rebase = createRebaseClient<Database>({
    baseUrl: API_URL,
    tables: tablesDictionary,
    offline: true,
});
```

With it on, the data layer keeps a **normalized local database of rows** (IndexedDB in the browser, memory elsewhere) and evaluates queries against it — filters, sorting and pagination included. Nothing in the CRUD API changes shape; the calls simply stop failing when the network does.

| Behaviour | What it means when writing code |
|-----------|--------------------------------|
| Reads fall back locally | `find()` offline returns the matching cached rows instead of throwing. `findById()` answers for a row only ever seen inside a `find()` |
| Writes apply immediately | `create()`/`update()`/`delete()` offline return right away and queue. Rows created offline get a client-generated id |
| Local writes join their lists | An offline create shows up in every filtered query it matches, and disappears from one an offline edit moves it out of |
| Rejections roll back | A write the server refuses (400/403/404) is undone locally and reported via `onSyncError` |
| Retries are automatic | Network failures and 429/503 replay on an exponential backoff; the `online` event and a sign-in also trigger one |
| Per-user and per-tab-safe | Local rows and the outbox are partitioned by signed-in uid, shared across tabs, and replayed by one tab at a time. Until auth has restored the session (`auth.isInitialized()`), offline reads and writes wait for it |
| Signed-out writes stay signed out | Writes queued while nobody was signed in are never replayed as whoever signs in. `pending({ orphaned: true })` lists them; the app re-issues or `clear({ orphaned: true })`s them |

### Live queries — prefer these in a UI

`observe()` is the reactive read. It emits from the local database **before** any request, de-duplicates, and re-emits on local writes, replays, rollbacks and realtime events:

```typescript
const unsubscribe = rebase.data.products.observe(
    { where: { active: ['==', true] }, orderBy: ['createdAt', 'desc'] },
    (result) => {
        render(result.data);          // same shape as find()
        setSaving(result.hasPendingWrites);
        setStale(result.fromCache);
    },
    (error) => console.error(error),
    { realtime: true }                // default when realtime is enabled
);

// Single row; the callback receives undefined when it is deleted.
const stopOne = rebase.data.products.observeById('p1', (row, meta) => { /* ... */ });
```

Each result carries `fromCache`, `hasPendingWrites`, `partial` (the local database may not hold every matching row) and `error`. `observe()` exists without offline too — it is then `find()` + `listen()` with all three flags `false`.

### Sync state

```typescript
rebase.offline!.onStatusChange(({ online, syncing, pending, lastSyncedAt, lastError }) => {
    // Drive an offline badge / "N unsaved" counter / spinner.
});

await rebase.offline!.sync();      // "retry now" — resolves { flushed, remaining }
await rebase.offline!.pending();   // the queued mutations themselves
await rebase.offline!.clear();     // DESTRUCTIVE: drops queued writes and local rows
await rebase.offline!.pending({ orphaned: true });  // writes queued while signed out, held back from the signed-in user
```

`isOfflineError(error)` distinguishes "offline with nothing local to answer with" from a request that genuinely failed:

```typescript
import { isOfflineError } from '@rebasepro/client';

try {
    await rebase.data.products.find();
} catch (error) {
    if (isOfflineError(error)) showOfflinePlaceholder();
    else throw error;
}
```

### Limits agents must not paper over

- **The client is not a replica.** Only rows the app has read or written are local, so a query answered from the cache may be missing rows. Live results flag this as `partial` — surface it rather than presenting it as complete.
- **`searchString` is approximated** locally as a case-insensitive substring scan. On the server it is *also* a substring scan unless the table declares a `search` block — do not tell a user they have full-text search until you have checked the collection.
- **A vector query is never answered from the cache.** The client holds no vectors, and the nearest of what happens to be cached looks exactly like the nearest that exist.
- **`include`d relations cannot be evaluated locally** — such a query is always `partial` when answered from the cache.
- **Replay is at-least-once.** Prefer idempotent writes (`createMany` with `upsert`) where a duplicate would matter.
- **Do not enable `offline` in a server-side script.** It is for interactive clients; a one-shot script wants `realtime: false` and a plain client.

Full reference: [rebase.pro/docs/sdk/offline](https://rebase.pro/docs/sdk/offline).

## File Storage

```typescript
// Upload file
const result = await rebase.storage.putObject({
    file: myFile,              // a File (`UploadFileProps.file` is typed `File`)
    key: 'path/to/file.png',   // Storage key (required)
    bucket: 'my-bucket',       // Optional bucket
    metadata: { ... },         // Optional metadata
    public: false,             // Optional: true → token-less permanent URL
});
// result → { key, bucket, storageUrl }

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

`rebase.storage` accesses the **default** storage source. For multi-backend setups (e.g. S3 + GCS/Firebase), a `col.storage({ source: "<key>" })` column routes its uploads to a bucket declared in `backend/resources.ts`.

On the frontend, register direct storage sources via the `storageSources` prop on `<Rebase>`:

```tsx
import { useFirebaseStorageSource } from "@rebasepro/firebase";

// Inside a component. `source` must implement `StorageSource`; a bare
// `getStorage()` handle has none of its methods, and the first upload throws.
const firebaseStorageSource = useFirebaseStorageSource({ firebaseApp });

<Rebase
    client={rebaseClient}
    storageSources={[
        { key: "firebase", engine: "firebase", transport: "direct", source: firebaseStorageSource }
    ]}
>
    {children}
</Rebase>
```

The system resolves the correct source per-field via `StorageSourcesContext` (mirroring `DataSourcesContext`). Fields bound to a `direct` storage source bypass the Rebase backend and upload/download directly to the provider (e.g. Firebase Storage), while `server` sources route through the Rebase API with a `?storageId` query parameter for backend routing.

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

// Bootstrap (initial admin setup): promotes the signed-in caller, who must be the
// earliest registered user, while no admin exists — 403 BOOTSTRAP_COMPLETED after
// that, and 403 SETUP_REQUIRED when NODE_ENV=production
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
import { tablesDictionary, type Database } from './generated/sdk/database.types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
export const rebase = createRebaseClient<Database>({ baseUrl: API_URL, tables: tablesDictionary });
```

```typescript
// src/hooks/useTable.ts
import { useState, useEffect } from 'react';
import type { FindParams } from '@rebasepro/client';
import { rebase } from '../client';

export function useTable<T extends keyof Database>(
    slug: T,
    // Tuples (`{ status: ['==', 'published'] }`), never bare strings
    options?: { limit?: number; where?: FindParams['where'] }
) {
    const [data, setData] = useState<Database[T]['Row'][]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = rebase.data.table(slug).listen(
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
- **Query builder source:** the in-process one in `packages/common/src/data/sdk-data.ts` (`SdkQueryBuilder`); `or` / `and` / `cond` in `packages/common/src/data/query_builder.ts`
- **Offline sync engine source:** `packages/client/src/offline.ts` (and `offline-query.ts`, `offline-store.ts`)
- **SDK demo example:** `examples/sdk-demo/`
