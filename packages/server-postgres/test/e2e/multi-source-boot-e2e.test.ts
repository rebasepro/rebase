/**
 * E2E: two declared data sources, one collection routed to the second.
 *
 * ## What this pins
 *
 * `database("analytics")` in `config/resources.ts` opens a second Postgres and
 * routes some collections to it. The bootstrapper runs once PER SOURCE, and it
 * is handed the whole project's collections both times — relations resolve
 * across sources and the API routes by slug, so that part is correct. What was
 * not correct is that three provisioning-adjacent passes read that list
 * unfiltered:
 *
 *   - the drift check, which then reported the DEFAULT database's tables as
 *     missing from the analytics one ("⚠️ SCHEMA DRIFT … Otherwise this is a
 *     bug worth reporting" — against a project where every table existed),
 *   - the change-capture attach, which tried to instrument the default's
 *     tables and junctions in the analytics database ("[CDC] Could not attach
 *     change-capture trigger to public.posts_tags"), and
 *   - the RLS/grants pass, which validated the default's policies against the
 *     analytics catalogue.
 *
 * And one ordering invariant: `CREATE POLICY` validates the functions its USING
 * clause calls, so `rebase.roles()` has to exist on a source before its first
 * policy. On the default source it arrives with the auth tables; a second
 * database has no auth tables, so every policy on it was refused and the table
 * was left RLS-enabled and unreachable — permanently, since the next boot did
 * exactly the same thing.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import type { CollectionConfig } from "@rebasepro/types";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresBootstrapper } from "../../src/PostgresBootstrapper.js";
import { createPostgresDatabaseConnection } from "../../src/connection.js";
import { ensureCollectionTables, type Queryable } from "../../src/schema/ensure-collection-tables.js";

// ── The project's collections ────────────────────────────────────────────────
//
// `posts` and `tags` stay on the default source and are joined through
// `posts_tags` — the junction is what produced the CDC warning, because nothing
// maps it to a collection and it was collected from the whole registry.
// `events` is the one routed elsewhere.
const postsCollection: CollectionConfig = {
    name: "Posts",
    slug: "posts",
    table: "posts",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        title: { name: "Title", type: "string" }
    }
} as unknown as CollectionConfig;

const tagsCollection: CollectionConfig = {
    name: "Tags",
    slug: "tags",
    table: "tags",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        label: { name: "Label", type: "string" }
    },
    relations: [
        {
            kind: "manyToMany",
            relationName: "posts",
            target: () => postsCollection,
            through: { table: "posts_tags", sourceColumn: "tag_id", targetColumn: "post_id" }
        }
    ]
} as unknown as CollectionConfig;

const eventsCollection: CollectionConfig = {
    name: "Events",
    slug: "events",
    table: "events",
    dataSource: "analytics",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        kind: { name: "Kind", type: "string" }
    },
    securityRules: [
        { operation: "select", access: "public" },
        { operation: "insert", access: "authenticated" }
    ]
} as unknown as CollectionConfig;

const ALL_COLLECTIONS = [postsCollection, tagsCollection, eventsCollection];

function queryableFor(db: { execute: (q: unknown) => Promise<unknown> }): Queryable {
    return {
        async query<T>(text: string): Promise<{ rows: T[] }> {
            const { sql } = await import("drizzle-orm");
            const result = await db.execute(sql.raw(text)) as { rows?: T[] };
            return { rows: result.rows ?? [] };
        }
    } as unknown as Queryable;
}

describe("Two data sources, one routed collection (E2E)", () => {
    let container: PgContainer;
    let defaultUrl: string;
    let analyticsUrl: string;
    let defaultConn: ReturnType<typeof createPostgresDatabaseConnection>;
    let analyticsConn: ReturnType<typeof createPostgresDatabaseConnection>;
    /** Everything the loggers wrote while the two drivers initialized. */
    let transcript: string[] = [];

    beforeAll(async () => {
        container = await startPgContainer();
        defaultUrl = container.connectionString;

        // One container, two databases — the shape a `database("analytics")`
        // project has in development.
        const admin = new pg.Client({ connectionString: defaultUrl });
        await admin.connect();
        await admin.query("CREATE DATABASE analytics");
        await admin.end();
        analyticsUrl = defaultUrl.replace("/rebase?", "/analytics?");

        defaultConn = createPostgresDatabaseConnection(defaultUrl);
        analyticsConn = createPostgresDatabaseConnection(analyticsUrl);

        // Provisioning, exactly as boot does it: each source is handed only the
        // collections routed to it.
        await ensureCollectionTables(
            queryableFor(defaultConn.db as never),
            [postsCollection, tagsCollection] as never
        );
        await ensureCollectionTables(
            queryableFor(analyticsConn.db as never),
            [eventsCollection] as never
        );

        // ── Boot both drivers, capturing everything they say ────────────────
        const capture = (...args: unknown[]) => {
            transcript.push(args.map(a => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
        };
        const spies = [
            vi.spyOn(console, "log").mockImplementation(capture),
            vi.spyOn(console, "warn").mockImplementation(capture),
            vi.spyOn(console, "error").mockImplementation(capture),
            vi.spyOn(console, "debug").mockImplementation(capture)
        ];
        // Change capture is what the junction warning came from, so it has to
        // actually run — it needs a direct (non-pooled) URL to LISTEN on.
        const previousDirect = process.env.DATABASE_DIRECT_URL;
        try {
            process.env.DATABASE_DIRECT_URL = defaultUrl;
            const defaultBootstrapper = createPostgresBootstrapper({
                connectionString: defaultUrl,
                connection: defaultConn.db as never
            });
            await defaultBootstrapper.initializeDriver!({
                collections: ALL_COLLECTIONS,
                dataSourceKey: "(default)",
                realtime: { subscribe: false, provision: true }
            });

            process.env.DATABASE_DIRECT_URL = analyticsUrl;
            const analyticsBootstrapper = createPostgresBootstrapper({
                connectionString: analyticsUrl,
                connection: analyticsConn.db as never
            });
            await analyticsBootstrapper.initializeDriver!({
                collections: ALL_COLLECTIONS,
                dataSourceKey: "analytics",
                realtime: { subscribe: false, provision: true }
            });
        } finally {
            if (previousDirect === undefined) delete process.env.DATABASE_DIRECT_URL;
            else process.env.DATABASE_DIRECT_URL = previousDirect;
            for (const spy of spies) spy.mockRestore();
        }
    }, 180_000);

    afterAll(async () => {
        await defaultConn?.pool.end().catch(() => {});
        await analyticsConn?.pool.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    it("reports no schema drift on either source", () => {
        const drift = transcript.filter(line => line.includes("SCHEMA DRIFT"));
        expect(drift, drift.join("\n")).toHaveLength(0);
    });

    it("attaches change capture only to the tables its own source holds", () => {
        const failed = transcript.filter(line => line.includes("Could not attach"));
        expect(failed, failed.join("\n")).toHaveLength(0);
    });

    it("does not look for the default source's tables in the second database", () => {
        // The registry-level message the read-back path emits. `posts` and
        // `tags` are not the analytics database's to be missing.
        const missing = transcript.filter(line => line.includes("has no table yet for"));
        expect(missing, missing.join("\n")).toHaveLength(0);
    });

    // ── The ordering invariant ──────────────────────────────────────────────
    //
    // Deliberately calls the policy hook with NO preceding `ensureRlsRuntime`:
    // the guard being pinned is that the helpers exist before the first
    // `CREATE POLICY` on this source whatever the caller's order, because the
    // failure mode is a table that is RLS-enabled with no policy at all — it
    // denies every request and no later boot repairs it.
    it("creates rebase.roles() before the first CREATE POLICY on a second source", async () => {
        // A database of its own, so "the helpers are not there yet" is a fact
        // rather than an assumption about what the boot above left behind.
        const admin = new pg.Client({ connectionString: defaultUrl });
        await admin.connect();
        await admin.query("CREATE DATABASE ordering");
        await admin.end();
        const orderingUrl = defaultUrl.replace("/rebase?", "/ordering?");
        const conn = createPostgresDatabaseConnection(orderingUrl);
        const probe = new pg.Client({ connectionString: orderingUrl });
        await probe.connect();
        try {
            await ensureCollectionTables(queryableFor(conn.db as never), [eventsCollection] as never);

            const before = await probe.query(
                "SELECT to_regprocedure('rebase.roles()') IS NOT NULL AS present"
            );
            expect(before.rows[0].present).toBe(false);

            const bootstrapper = createPostgresBootstrapper({
                connectionString: orderingUrl,
                connection: conn.db as never
            });
            const outcome = await bootstrapper.ensureCollectionPolicies!(
                [eventsCollection],
                undefined
            );
            expect(outcome.applied).toBeGreaterThan(0);

            const after = await probe.query(
                "SELECT to_regprocedure('rebase.roles()') IS NOT NULL AS present"
            );
            expect(after.rows[0].present).toBe(true);

            // The whole point: the policies actually landed, rather than the
            // table being left enabled-and-empty.
            const policies = await probe.query(
                "SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'events'"
            );
            expect(policies.rows.length).toBeGreaterThan(0);
        } finally {
            await probe.end().catch(() => {});
            await conn.pool.end().catch(() => {});
        }
    }, 120_000);
});
