/**
 * What PGlite can and cannot do as a development database, measured rather
 * than assumed.
 *
 * Everything in this directory is shaped by four facts, each established by
 * running it against `@electric-sql/pglite` 0.5.6 and
 * `@electric-sql/pglite-socket` 0.2.9 rather than by reading their docs. They
 * are recorded here because two of them are silent failures — the kind that
 * make a developer lose an evening to a feature that reports success and does
 * nothing.
 *
 * 1. **It is really PostgreSQL 18.3.** `select version()` over the socket
 *    returns `PostgreSQL 18.3 (PGlite 0.5.6) on wasm32`, which is the same
 *    major as the `postgres:18-alpine` the eject template ships. So a dev
 *    database here and a compose database there are the same Postgres, and
 *    schema behaviour does not diverge between them.
 *
 * 2. **`pg_trgm` and `unaccent` are available**, which is what search
 *    collections need. They are not installed by a bare `CREATE EXTENSION`,
 *    though — PGlite ships them as separate bundles that must be passed to the
 *    constructor, and without that `CREATE EXTENSION pg_trgm` fails with
 *    `extension "pg_trgm" is not available`. {@link PGLITE_EXTENSIONS} is that
 *    list, and it has to stay in step with what the schema generator emits.
 *
 * 3. **RLS is enforced exactly as it is on a real server.** With
 *    `SET LOCAL ROLE "rebase_user"` inside a transaction — which is how
 *    `PostgresBackendDriver` isolates every request — `current_user` becomes
 *    the restricted role, `session_user` stays the owner, and a policy using
 *    `current_setting('app.tenant')` filters rows correctly, including under
 *    `FORCE ROW LEVEL SECURITY`. Measured: an owner saw 3 rows and the
 *    role-switched transaction saw 2, with the cross-tenant probe returning 0.
 *    This is the one that mattered most: a dev database that quietly failed to
 *    apply RLS would give false confidence about the product's central claim.
 *
 * 4. **Concurrency is the real limit, and it fails badly.** PGlite is a single
 *    session, and `PGLiteSocketServer` multiplexes connections onto it. Two
 *    pooled clients that hold *overlapping transactions* deadlock — not error,
 *    hang — which is precisely what a request-per-transaction server does under
 *    any concurrent load. {@link MANAGED_POOL_MAX} is the answer: one client
 *    connection, so requests queue in the pool instead of deadlocking in the
 *    multiplexer. Measured: with a pool of 1, four concurrent queries and a
 *    role-switched RLS transaction all pass; with a pool of 5 the same script
 *    hangs indefinitely.
 *
 * 5. **LISTEN/NOTIFY does not cross the socket, and says nothing about it.**
 *    A dedicated client can `LISTEN`, a pooled client can `NOTIFY`, both report
 *    success, and the notification is never delivered — the same for
 *    `pg_notify` fired from a trigger. Since the realtime engine is built on
 *    LISTEN/NOTIFY-based CDC, realtime cannot work against a managed PGlite
 *    database. It must be *reported*, never silently degraded; see
 *    {@link MANAGED_LIMITATIONS}.
 */

/**
 * Extensions to hand PGlite's constructor.
 *
 * `CREATE EXTENSION` alone cannot install these — PGlite resolves them from
 * bundles supplied at construction time, so anything missing here is missing
 * from the database no matter what the migration says.
 */
export const PGLITE_EXTENSION_NAMES = ["pg_trgm", "unaccent"] as const;

/**
 * Client connections the managed database tolerates: exactly one.
 *
 * Not a tuning choice. Two concurrent transactions over the socket
 * multiplexer deadlock, and a request-per-transaction server produces those
 * the moment two requests overlap. One connection converts that deadlock into
 * ordinary queueing, which is slower and correct.
 */
export const MANAGED_POOL_MAX = 1;

/**
 * Connections the socket server will accept.
 *
 * Above {@link MANAGED_POOL_MAX} so that a second *non-transactional* client —
 * `rebase db push` in another terminal while `rebase dev` runs — is refused
 * with a connection error rather than corrupting the multiplexer. The pool
 * limit is what prevents overlapping transactions; this only stops a stampede.
 */
export const MANAGED_SERVER_MAX_CONNECTIONS = 4;

/** What a managed PGlite database cannot do, in the words the user needs. */
export interface ManagedLimitation {
    /** Stable id, so a warning can be suppressed or tested for. */
    id: string;
    /** One line, naming the feature rather than the mechanism. */
    summary: string;
    /** What to do instead. Always a concrete command. */
    remedy: string;
}

/**
 * Announced at startup, every time, rather than discovered.
 *
 * A developer who does not know realtime is off will read the silence as a bug
 * in their own code, which is a worse outcome than not offering the managed
 * database at all.
 */
export const MANAGED_LIMITATIONS: readonly ManagedLimitation[] = [
    {
        id: "realtime",
        summary:
            "Realtime subscriptions, presence and broadcast are unavailable: LISTEN/NOTIFY " +
            "is not delivered across the PGlite socket, so change events never fire.",
        remedy: "Run against a real Postgres for realtime work: rebase dev --docker"
    },
    {
        id: "concurrency",
        summary:
            "Requests are served one at a time. Behaviour is correct but serialized, so " +
            "lock contention and job-queue concurrency cannot be reproduced here.",
        remedy: "Reproduce concurrency against a real Postgres: rebase dev --docker"
    }
] as const;
