/**
 * E2E: the aged-database axis — an OLD schema meeting the CURRENT runtime.
 *
 * Every other suite in this repo starts from a database this code just created,
 * which is the one starting state that cannot contain an upgrade bug: the code
 * writes the new shape by definition. The expensive failures have all lived in
 * the other direction — a schema some earlier release left behind, met by a
 * runtime that assumes the migration already ran:
 *
 *   * `unique_device_session` survived the drop → every login and refresh 500s
 *     with SQLSTATE 42P10, behind a `/health` that answers 200.
 *   * `user_id` → `uid` went in as a rename → auth breaks on whichever side of
 *     a rolling deploy is out of step.
 *   * a back-fill silently misses → every live session is signed out by the
 *     release that was supposed to stop signing people out.
 *
 * Each file in `schema-snapshots/` is one such starting point. This restores it,
 * runs the current `ensureAuthTablesExist` over it, and asserts the *result*.
 *
 * That emphasis is load-bearing. The migration block in `ensure-tables.ts` is
 * wrapped in `try { … } catch { logger.warn(); }` and continues by design — a
 * limping boot beats a crash loop. The consequence is that a migration which
 * throws produces no exception for a test to catch, so "it booted" proves
 * nothing whatsoever. Every assertion below reads the catalogue or the data.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { ensureAuthTablesExist } from "../../src/auth/ensure-tables.js";
import {
    AUTH_SCHEMA_VERSION,
    probeAuthSchema,
    readAuthSchemaVersion
} from "../../src/auth/schema-version.js";

const SNAPSHOT_DIR = fileURLToPath(new URL("./schema-snapshots", import.meta.url));

/**
 * A floor, not an equality — the directory is meant to grow, one file per
 * release. It exists because this suite's failure mode is silence: point the
 * loop below at an empty directory and `describe.each([])` registers no tests
 * at all, the file passes in a few milliseconds, and CI reports a green
 * upgrade gate that ran against nothing. Two is the number of hand-written
 * eras that existed when this was written; a recorded snapshot only ever adds.
 */
const MINIMUM_SNAPSHOTS = 2;

const snapshots = readdirSync(SNAPSHOT_DIR)
    .filter(name => name.endsWith(".sql"))
    .sort();

/** Columns the current auth write path reads or writes on every refresh. */
const REQUIRED_REFRESH_TOKEN_COLUMNS = ["session_id", "revoked", "rotated_at", "session_started_at"];

/** Everything `userColumnBackfills` in ensure-tables.ts promises to add. */
const REQUIRED_USER_COLUMNS = [
    "display_name", "photo_url", "roles", "password_hash", "email_verified",
    "email_verification_token", "email_verification_sent_at", "is_anonymous",
    "metadata", "tokens_valid_after", "created_at", "updated_at"
];

/** Auth tables that carried `user_id` before the expand/contract migration. */
const UID_BEARING_TABLES = ["user_identities", "refresh_tokens"];

describe("schema snapshot inventory", () => {
    it(`has at least ${MINIMUM_SNAPSHOTS} snapshots to upgrade from`, () => {
        // Guards against the whole suite silently becoming a no-op.
        expect(snapshots.length).toBeGreaterThanOrEqual(MINIMUM_SNAPSHOTS);
    });
});

describe.each(snapshots)("upgrading a database left by %s", (snapshotFile) => {
    let container: PgContainer;
    let client: pg.Client;
    /** Connection string of the per-snapshot database, for opening fresh pools. */
    let dbUrl: string;
    /** Row counts and ids as the snapshot left them, read before the upgrade. */
    let before: {
        userIds: string[];
        tokenIds: string[];
        tokenCreatedAt: Map<string, Date>;
    };

    beforeAll(async () => {
        container = await startPgContainer();

        // Restore into its own database inside the shared container. `pg` runs a
        // multi-statement simple query in one implicit transaction, so a
        // snapshot with a syntax error fails here rather than half-applying and
        // failing later as a confusing missing-column error.
        const admin = new pg.Client({ connectionString: container.connectionString });
        await admin.connect();
        const dbName = `upgrade_${snapshotFile.replace(/[^a-z0-9]/gi, "_").toLowerCase()}`.slice(0, 60);
        await admin.query(`CREATE DATABASE ${dbName}`);
        await admin.end();

        dbUrl = container.connectionString.replace(/\/rebase\?/, `/${dbName}?`);
        client = new pg.Client({ connectionString: dbUrl });
        await client.connect();
        await client.query(readFileSync(join(SNAPSHOT_DIR, snapshotFile), "utf8"));

        const users = await client.query<{ id: string }>("SELECT id FROM rebase.users ORDER BY id");
        const tokens = await client.query<{ id: string; created_at: Date }>(
            "SELECT id, created_at FROM rebase.refresh_tokens ORDER BY id"
        );
        before = {
            userIds: users.rows.map(r => r.id),
            tokenIds: tokens.rows.map(r => r.id),
            tokenCreatedAt: new Map(tokens.rows.map(r => [r.id, r.created_at]))
        };

        // A snapshot that seeds nothing cannot catch a back-fill that drops
        // rows, which is half of what this suite is for. See the README.
        expect(before.userIds.length).toBeGreaterThan(0);
        expect(before.tokenIds.length).toBeGreaterThan(0);

        // ── The upgrade under test ───────────────────────────────────────────
        const pool = new pg.Pool({ connectionString: dbUrl });
        await ensureAuthTablesExist(drizzle(pool));
        await pool.end();
    }, 180_000);

    afterAll(async () => {
        await client?.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    });

    const columnsOf = async (table: string): Promise<Set<string>> => {
        const result = await client.query<{ column_name: string }>(
            "SELECT column_name FROM information_schema.columns WHERE table_schema = 'rebase' AND table_name = $1",
            [table]
        );
        return new Set(result.rows.map(r => r.column_name));
    };

    // ── Shape ────────────────────────────────────────────────────────────────

    it("adds every refresh_tokens column the rotation path writes", async () => {
        const columns = await columnsOf("refresh_tokens");
        const missing = REQUIRED_REFRESH_TOKEN_COLUMNS.filter(c => !columns.has(c));
        expect(missing).toEqual([]);
    });

    it("drops unique_device_session — the constraint that 42P10s every login", async () => {
        const result = await client.query(
            `SELECT 1 FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
             WHERE n.nspname = 'rebase' AND t.relname = 'refresh_tokens'
               AND c.conname = 'unique_device_session'`
        );
        expect(result.rows).toEqual([]);
    });

    it("back-fills every users column added since the snapshot's era", async () => {
        const columns = await columnsOf("users");
        const missing = REQUIRED_USER_COLUMNS.filter(c => !columns.has(c));
        expect(missing).toEqual([]);
    });

    it("gives every auth table a populated uid", async () => {
        for (const table of UID_BEARING_TABLES) {
            const columns = await columnsOf(table);
            expect(columns.has("uid"), `${table}.uid`).toBe(true);

            // Expand, not rename: a legacy user_id must survive alongside it,
            // because a rolling deploy still has old pods reading it.
            const orphans = await client.query(
                `SELECT count(*)::int AS n FROM rebase.${table} WHERE uid IS NULL`
            );
            expect(orphans.rows[0].n, `${table} rows with a null uid`).toBe(0);
        }
    });

    it("widens the inherited VARCHAR(n) string columns to TEXT", async () => {
        // Every one of these was a MySQL-shaped width that Postgres gained
        // nothing from, and two of them were live hazards: password_hash(255)
        // sat 62 characters in front of a 193-char scrypt string, and
        // photo_url(500) rejected the long signed URLs OAuth providers return.
        const result = await client.query<{ column_name: string; data_type: string }>(
            `SELECT column_name, data_type FROM information_schema.columns
             WHERE table_schema = 'rebase' AND table_name = 'users'
               AND column_name = ANY($1)`,
            [["email", "display_name", "photo_url", "password_hash", "email_verification_token"]]
        );
        const stillBounded = result.rows.filter(r => r.data_type === "character varying");
        expect(stillBounded.map(r => r.column_name)).toEqual([]);
    });

    it("makes email uniqueness case-insensitive", async () => {
        // The byte-exact UNIQUE this replaces could not see that Foo@x.com and
        // foo@x.com are one account, while every read path folded case — so the
        // mixed-case row existed and no lookup could reach it.
        const index = await client.query(
            `SELECT 1 FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'rebase' AND c.relname = 'users_email_lower_key' AND c.relkind = 'i'`
        );
        expect(index.rows.length).toBe(1);

        const { rows: [user] } = await client.query<{ email: string }>(
            "SELECT email FROM rebase.users LIMIT 1"
        );
        await expect(
            client.query("INSERT INTO rebase.users (id, email) VALUES ($1, $2)", [
                "case-collision-probe",
                user.email.toUpperCase()
            ])
        ).rejects.toThrow();
    });

    it("indexes the email verification token it used to sequentially scan", async () => {
        const index = await client.query(
            `SELECT 1 FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'rebase' AND c.relname = 'users_email_verification_token_idx'
               AND c.relkind = 'i'`
        );
        expect(index.rows.length).toBe(1);
    });

    it("bounds the email column with a CHECK rather than a type modifier", async () => {
        const constraint = await client.query(
            `SELECT 1 FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
             WHERE n.nspname = 'rebase' AND t.relname = 'users'
               AND c.conname = 'users_email_length_check'`
        );
        expect(constraint.rows.length).toBe(1);

        await expect(
            client.query("INSERT INTO rebase.users (id, email) VALUES ($1, $2)", [
                "long-email-probe",
                `${"a".repeat(320)}@example.test`
            ])
        ).rejects.toThrow();
    });

    it("stamps the auth schema version it migrated to", async () => {
        // An unstamped database reads as null and is treated as "upgrade me".
        // After the upgrade it must carry the current number, or the next
        // runtime cannot tell an era-1 database from a migrated one.
        const pool = new pg.Pool({ connectionString: dbUrl });
        try {
            expect(await readAuthSchemaVersion(drizzle(pool), "rebase")).toBe(AUTH_SCHEMA_VERSION);
        } finally {
            await pool.end();
        }
    });

    // ── Data survival ────────────────────────────────────────────────────────

    it("keeps every user", async () => {
        const users = await client.query<{ id: string }>("SELECT id FROM rebase.users ORDER BY id");
        expect(users.rows.map(r => r.id)).toEqual(before.userIds);
    });

    it("keeps every live session, unrevoked", async () => {
        const tokens = await client.query<{ id: string; revoked: boolean }>(
            "SELECT id, revoked FROM rebase.refresh_tokens ORDER BY id"
        );
        expect(tokens.rows.map(r => r.id)).toEqual(before.tokenIds);
        expect(tokens.rows.every(r => r.revoked === false)).toBe(true);
    });

    it("gives each adopted token its OWN session, not one shared uuid", async () => {
        // `gen_random_uuid()` in a single UPDATE is per-row, but adding the
        // column with the uuid as its DEFAULT would stamp every row alike on
        // some Postgres versions — merging every live session into one that a
        // single logout then wipes. This is the assertion that tells them apart.
        const result = await client.query<{ session_id: string }>(
            "SELECT session_id FROM rebase.refresh_tokens"
        );
        const distinct = new Set(result.rows.map(r => r.session_id));
        expect(result.rows.every(r => Boolean(r.session_id))).toBe(true);
        expect(distinct.size).toBe(before.tokenIds.length);
    });

    it("carries session_started_at back from created_at, not from NOW()", async () => {
        // `users.tokens_valid_after` is compared against session_started_at. If
        // the back-fill stamped NOW(), every pre-existing session silently
        // outruns a password-reset invalidation issued before the upgrade.
        const result = await client.query<{ id: string; session_started_at: Date }>(
            "SELECT id, session_started_at FROM rebase.refresh_tokens"
        );
        for (const row of result.rows) {
            const original = before.tokenCreatedAt.get(row.id);
            expect(original, `token ${row.id} was in the snapshot`).toBeDefined();
            expect(row.session_started_at.getTime()).toBe(original!.getTime());
        }
    });

    // ── The write path the old shape forbade ─────────────────────────────────

    it("accepts two live tokens for one session — the write 42P10 used to reject", async () => {
        const { rows: [user] } = await client.query<{ id: string }>(
            "SELECT id FROM rebase.users LIMIT 1"
        );
        const insert = (hash: string) => client.query(
            `INSERT INTO rebase.refresh_tokens (uid, session_id, token_hash, expires_at, user_agent, ip_address)
             VALUES ($1, 'rotation-probe-session', $2, NOW() + INTERVAL '1 day', 'probe/1.0', '192.0.2.1')`,
            [user.id, hash]
        );
        // Identical uid, user_agent and ip_address: exactly the tuple the old
        // constraint made unique, and exactly what a rotation in flight looks
        // like. This is the failure that a shape-only check cannot see.
        await insert("rotation-probe-old");
        await expect(insert("rotation-probe-new")).resolves.toBeDefined();
    });

    // ── Idempotency: the second boot, and the pod next to it ─────────────────

    it("is idempotent — a second run changes nothing and still reports healthy", async () => {
        const pool = new pg.Pool({ connectionString: dbUrl });
        await ensureAuthTablesExist(drizzle(pool));

        const db = drizzle(pool);
        expect(await readAuthSchemaVersion(db, "rebase")).toBe(AUTH_SCHEMA_VERSION);

        const probe = await probeAuthSchema(db, "rebase");
        expect(probe.problems).toEqual([]);
        expect(probe.healthy).toBe(true);

        const tokens = await client.query<{ id: string }>(
            "SELECT id FROM rebase.refresh_tokens WHERE id = ANY($1) ORDER BY id",
            [before.tokenIds]
        );
        expect(tokens.rows.map(r => r.id)).toEqual(before.tokenIds);

        await pool.end();
    });
});

// ── Era-specific: what only one snapshot can prove ───────────────────────────

describe("era-1a — the legacy roles junction", () => {
    const snapshot = "era-1a-user-id-legacy-roles.sql";
    let container: PgContainer;
    let client: pg.Client;

    beforeAll(async () => {
        expect(snapshots).toContain(snapshot);
        container = await startPgContainer();
        client = new pg.Client({ connectionString: container.connectionString });
        await client.connect();
        await client.query(readFileSync(join(SNAPSHOT_DIR, snapshot), "utf8"));

        const pool = new pg.Pool({ connectionString: container.connectionString });
        await ensureAuthTablesExist(drizzle(pool));
        await pool.end();
    }, 180_000);

    afterAll(async () => {
        await client?.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    });

    it("moves roles onto the inline column, per user", async () => {
        const result = await client.query<{ id: string; roles: string[] }>(
            "SELECT id, roles FROM rebase.users ORDER BY id"
        );
        const byId = new Map(result.rows.map(r => [r.id, r.roles]));
        // Sorted: array_agg has no ordering guarantee, and the ordering is not
        // what this is about.
        expect([...(byId.get("user-era1a-admin") ?? [])].sort()).toEqual(["admin", "editor"]);
        // The user with no junction rows must end up empty — not null, and
        // emphatically not carrying the admin's roles.
        expect(byId.get("user-era1a-reader")).toEqual([]);
    });

    it("drops the junction tables once their contents are inline", async () => {
        const result = await client.query<{ table_name: string }>(
            `SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'rebase' AND table_name IN ('user_roles', 'roles')`
        );
        expect(result.rows).toEqual([]);
    });

    it("keeps the legacy user_id column readable for old pods mid-deploy", async () => {
        // Expand/contract: a rename would break whichever half of a rolling
        // deploy is out of step. `tooling/scripts/drop-legacy-auth-user-id.sql` is the
        // contract phase, run by hand once no old pod remains.
        const columns = await client.query<{ column_name: string; is_nullable: string }>(
            `SELECT column_name, is_nullable FROM information_schema.columns
             WHERE table_schema = 'rebase' AND table_name = 'refresh_tokens'
               AND column_name IN ('uid', 'user_id')`
        );
        const byName = new Map(columns.rows.map(r => [r.column_name, r.is_nullable]));
        expect(byName.has("uid")).toBe(true);
        expect(byName.has("user_id")).toBe(true);
        // New code writes uid only, so the legacy column can no longer be NOT
        // NULL — the trigger back-fills it, but the constraint is checked first.
        expect(byName.get("user_id")).toBe("YES");
    });

    it("keeps the two columns in sync both ways, for either era of pod", async () => {
        const { rows: [user] } = await client.query<{ id: string }>(
            "SELECT id FROM rebase.users LIMIT 1"
        );
        // A new pod writes uid; an old pod reading user_id must still see it.
        await client.query(
            `INSERT INTO rebase.refresh_tokens (uid, token_hash, expires_at)
             VALUES ($1, 'sync-probe-new-pod', NOW() + INTERVAL '1 day')`,
            [user.id]
        );
        // An old pod writes user_id; a new pod reading uid must still see it.
        await client.query(
            `INSERT INTO rebase.refresh_tokens (user_id, token_hash, expires_at)
             VALUES ($1, 'sync-probe-old-pod', NOW() + INTERVAL '1 day')`,
            [user.id]
        );
        const result = await client.query<{ token_hash: string; uid: string; user_id: string }>(
            `SELECT token_hash, uid, user_id FROM rebase.refresh_tokens
             WHERE token_hash IN ('sync-probe-new-pod', 'sync-probe-old-pod')`
        );
        expect(result.rows).toHaveLength(2);
        for (const row of result.rows) {
            expect(row.uid, `${row.token_hash}.uid`).toBe(user.id);
            expect(row.user_id, `${row.token_hash}.user_id`).toBe(user.id);
        }
    });
});

// ── The case-fold migration, which needs a database that predates the rule ────

describe("a database carrying mixed-case emails", () => {
    const snapshot = "era-1a-user-id-legacy-roles.sql";
    let container: PgContainer;
    let client: pg.Client;

    beforeAll(async () => {
        expect(snapshots).toContain(snapshot);
        container = await startPgContainer();
        client = new pg.Client({ connectionString: container.connectionString });
        await client.connect();
        await client.query(readFileSync(join(SNAPSHOT_DIR, snapshot), "utf8"));

        // The state the old write path could produce and the old read path
        // could not reach: the byte-exact UNIQUE allowed it in, and
        // `getUserByEmail` searched lower(email), so this account was
        // unreachable by every sign-in, reset and lookup the framework has.
        await client.query(
            "INSERT INTO rebase.users (id, email) VALUES ($1, $2)",
            ["user-mixed-case", "Mixed.Case@Era1a.TEST"]
        );

        const pool = new pg.Pool({ connectionString: container.connectionString });
        await ensureAuthTablesExist(drizzle(pool));
        await pool.end();
    }, 180_000);

    afterAll(async () => {
        await client?.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    });

    it("folds the existing rows rather than leaving them unreachable", async () => {
        const { rows: [user] } = await client.query<{ email: string }>(
            "SELECT email FROM rebase.users WHERE id = 'user-mixed-case'"
        );
        expect(user.email).toBe("mixed.case@era1a.test");
    });

    it("builds the unique index over the folded rows", async () => {
        const index = await client.query(
            `SELECT 1 FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'rebase' AND c.relname = 'users_email_lower_key' AND c.relkind = 'i'`
        );
        expect(index.rows.length).toBe(1);
    });
});

describe("a database whose emails already collide", () => {
    const snapshot = "era-1a-user-id-legacy-roles.sql";
    let container: PgContainer;
    let client: pg.Client;

    beforeAll(async () => {
        container = await startPgContainer();
        client = new pg.Client({ connectionString: container.connectionString });
        await client.connect();
        await client.query(readFileSync(join(SNAPSHOT_DIR, snapshot), "utf8"));

        // Two accounts that differ only in case. Folding them would make the
        // unique index impossible to build, and picking a survivor is not a
        // migration's call to make.
        await client.query(
            "INSERT INTO rebase.users (id, email) VALUES ($1, $2), ($3, $4)",
            ["user-dup-lower", "dup@era1a.test", "user-dup-upper", "DUP@era1a.test"]
        );

        const pool = new pg.Pool({ connectionString: container.connectionString });
        await ensureAuthTablesExist(drizzle(pool));
        await pool.end();
    }, 180_000);

    afterAll(async () => {
        await client?.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    });

    it("boots, leaving both rows untouched", async () => {
        // The whole migration block is best-effort by design. What must not
        // happen is a half-applied fold that silently merges two accounts.
        const result = await client.query<{ id: string; email: string }>(
            "SELECT id, email FROM rebase.users WHERE id LIKE 'user-dup-%' ORDER BY id"
        );
        expect(result.rows).toEqual([
            { id: "user-dup-lower", email: "dup@era1a.test" },
            { id: "user-dup-upper", email: "DUP@era1a.test" }
        ]);
    });

    it("does not create the index it could not honestly build", async () => {
        const index = await client.query(
            `SELECT 1 FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'rebase' AND c.relname = 'users_email_lower_key' AND c.relkind = 'i'`
        );
        expect(index.rows.length).toBe(0);
    });

    it("still completes the rest of the upgrade", async () => {
        // A skipped index must not abort the migrations after it — this is the
        // failure mode the surrounding try/catch makes invisible.
        const columns = await client.query<{ column_name: string }>(
            `SELECT column_name FROM information_schema.columns
             WHERE table_schema = 'rebase' AND table_name = 'refresh_tokens'`
        );
        const names = new Set(columns.rows.map(r => r.column_name));
        for (const required of REQUIRED_REFRESH_TOKEN_COLUMNS) {
            expect(names.has(required), `refresh_tokens.${required}`).toBe(true);
        }
    });
});
