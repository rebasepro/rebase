/**
 * E2E: a scheduled backup covers the whole database, and restores.
 *
 * `createBackupCron` used to default `excludeSchemas` to `["rebase"]`, meant to
 * skip Atlas's revision table. That schema also holds the auth tables, API
 * keys, record history and the functions that every generated policy and CDC
 * trigger calls. So every nightly dump silently dropped every user account, and
 * could not be restored into an empty database either: the `public` tables
 * brought their policies, triggers and foreign keys, but the objects those
 * point at were missing. `rebase db backup` excludes nothing, so the manual
 * backup and the scheduled one captured two different databases.
 *
 * Nothing caught it because no test ran either function. This one runs the
 * cron's real handler against a real Postgres, reads the dump's table of
 * contents, then restores it into a fresh database with the restore's own
 * `--exit-on-error` default. The fixture includes what made the old dump
 * unrestorable: a `public` table with a foreign key into `rebase.users`, a
 * policy calling `rebase.uid()`, and the CDC trigger.
 *
 * `pg_dump` must be at least as new as the server it reads, and CI's runner
 * ships an older client than this suite's default image. So the server's major
 * version follows the client's rather than the other way round. What this
 * suite tests does not depend on the Postgres version.
 *
 * Requires Docker and the Postgres client tools (`pg_dump`, `pg_dumpall`,
 * `pg_restore`). A missing client fails the suite instead of skipping it,
 * because a skipped suite would report a pass.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { CronJobContext } from "@rebasepro/types";
import { DEFAULT_PG_IMAGE, startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { ensureAuthTablesExist } from "../../src/auth/ensure-tables.js";
import { buildCdcFunctionSql, buildCdcTriggerSql } from "../../src/services/cdc/trigger-cdc.js";
import { createBackupCron } from "../../src/backup/backup-cron.js";
import { applyGlobals, detectToolMajor, resolvePgBinary, restoreDump } from "../../src/backup/backup-service.js";
import { buildPgRestoreListArgs, globalsFileForDump } from "../../src/backup/pg-tools.js";

const SEEDED_EMAIL = "restored-admin@example.com";

/** The major `DEFAULT_PG_IMAGE` runs. A newer client is fine against it. */
const DEFAULT_IMAGE_MAJOR = 18;

async function imageForLocalClient(): Promise<string> {
    const bin = resolvePgBinary("pg_dump");
    const major = bin ? await detectToolMajor(bin) : null;
    if (!bin || major === null) {
        throw new Error(
            "pg_dump was not found (or its version could not be read), so this suite cannot take a backup. " +
            "Install the PostgreSQL client tools, or set PG_DUMP_PATH, PG_DUMPALL_PATH and PG_RESTORE_PATH."
        );
    }
    return major >= DEFAULT_IMAGE_MAJOR ? DEFAULT_PG_IMAGE : `postgres:${major}-alpine`;
}

const withDatabase = (url: string, db: string) => url.replace(/\/rebase\?/, `/${db}?`);

describe("createBackupCron with its default configuration", () => {
    let container: PgContainer;
    let outDir: string;
    let dumpFile: string;
    let seededUserId: string;

    beforeAll(async () => {
        container = await startPgContainer({ image: await imageForLocalClient() });

        const pool = new pg.Pool({ connectionString: container.connectionString });
        try {
            // The real auth provisioning: `rebase.users` and its satellites,
            // plus the RLS helper functions, all in the `rebase` schema.
            await ensureAuthTablesExist(drizzle(pool));

            const user = await pool.query<{ id: string }>(
                "INSERT INTO rebase.users (email, password_hash, roles) VALUES ($1, 'x', '{admin}') RETURNING id",
                [SEEDED_EMAIL]
            );
            seededUserId = user.rows[0].id;

            // A collection table as the runtime leaves it: a foreign key into
            // the auth table, RLS with a policy calling a `rebase` function,
            // and the CDC trigger. Each one points at an object in `rebase`.
            await pool.query(`
                CREATE TABLE public.posts (
                    id SERIAL PRIMARY KEY,
                    title TEXT NOT NULL,
                    author_id TEXT NOT NULL REFERENCES rebase.users(id)
                )
            `);
            await pool.query("ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY");
            await pool.query("CREATE POLICY posts_owner ON public.posts USING (author_id = rebase.uid())");
            await pool.query(buildCdcFunctionSql());
            await pool.query(buildCdcTriggerSql("public", "posts"));
            await pool.query("INSERT INTO public.posts (title, author_id) VALUES ('hello', $1)", [seededUserId]);
        } finally {
            await pool.end();
        }

        outDir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-scheduled-backup-"));

        // No `excludeSchemas`: the configuration `docs/backups.md` tells people
        // to write, and the one the old default broke.
        const job = createBackupCron({
            schedule: "0 3 * * *",
            connectionString: container.connectionString,
            destination: { kind: "local", path: outDir }
        });
        const result = await job.handler({
            jobId: "backup",
            scheduledAt: new Date(),
            log: () => {},
            signal: new AbortController().signal
        } as CronJobContext) as { backup: string };
        dumpFile = result.backup;
    }, 240_000);

    afterAll(async () => {
        if (outDir) fs.rmSync(outDir, { recursive: true, force: true });
        if (container) await stopPgContainer(container.containerName);
    });

    it("writes a dump and its roles sidecar", () => {
        expect(fs.existsSync(dumpFile)).toBe(true);
        expect(fs.existsSync(globalsFileForDump(dumpFile))).toBe(true);
    });

    it("dumps the rows of rebase.users", async () => {
        const bin = resolvePgBinary("pg_restore");
        expect(bin).not.toBeNull();
        const { stdout } = await execa(bin!, buildPgRestoreListArgs(dumpFile));
        // A TOC line reads `<id>; <oid> <oid> TABLE DATA <schema> <table> <owner>`.
        expect(stdout).toMatch(/\bTABLE DATA rebase users\b/);
        expect(stdout).toMatch(/\bFUNCTION rebase uid\(\)/);
    });

    it("restores into an empty database, users and all", async () => {
        const target = "restored_from_cron";
        const admin = new pg.Client({ connectionString: container.connectionString });
        await admin.connect();
        await admin.query(`CREATE DATABASE ${target}`);
        await admin.end();
        const targetUrl = withDatabase(container.connectionString, target);

        // What `rebase db restore` does: roles first, then the dump, stopping
        // at the first error. Nothing below is allowed to fail.
        await applyGlobals(targetUrl, fs.readFileSync(globalsFileForDump(dumpFile), "utf8"));
        await restoreDump({ connectionString: targetUrl, inputFile: dumpFile });

        const client = new pg.Client({ connectionString: targetUrl });
        await client.connect();
        try {
            const users = await client.query<{ id: string; email: string }>("SELECT id, email FROM rebase.users");
            expect(users.rows).toEqual([{ id: seededUserId, email: SEEDED_EMAIL }]);

            const posts = await client.query<{ author_id: string }>("SELECT author_id FROM public.posts");
            expect(posts.rows).toEqual([{ author_id: seededUserId }]);

            // The container's login role is called `rebase`, so `"$user"` puts
            // that schema on the default search path and the policy would print
            // as a bare `uid()`. Without it, Postgres has to qualify the name.
            await client.query("SET search_path = public");
            const policies = await client.query<{ qual: string }>(
                "SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'posts'"
            );
            expect(policies.rows.map(r => r.qual)).toEqual(["(author_id = rebase.uid())"]);
        } finally {
            await client.end();
        }
    });
});
