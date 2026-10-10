/**
 * A second boot against an up-to-date auth schema changes nothing.
 *
 * `ensureAuthTablesExist` reconciles the auth tables on every boot, and every
 * reconciliation used to be issued unconditionally and left to Postgres to
 * find redundant: 29 `ALTER TABLE` statements on `users` and `refresh_tokens`
 * (each queueing for an ACCESS EXCLUSIVE lock on the two tables every sign-in
 * and every token refresh touches), two full-table `UPDATE … WHERE … IS NULL`
 * back-fills on `refresh_tokens`, and thirteen `CREATE INDEX IF NOT EXISTS`
 * (each taking a SHARE lock that blocks writers). Now the catalogue is read
 * first and only what is missing is issued — and what drifted is still
 * repaired, which the last test pins.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { ensureAuthTablesExist } from "../src/auth/ensure-tables";

describe("the auth ensure settles", () => {
    let pglite: PGlite;
    let statements: string[];
    let db: NodePgDatabase;

    beforeEach(async () => {
        pglite = new PGlite();
        await pglite.waitReady;
        statements = [];
        db = drizzle(pglite, { logger: { logQuery: (query: string) => { statements.push(query.trim()); } } }) as unknown as NodePgDatabase;
    });

    afterEach(async () => {
        await pglite.close();
    });

    const changes = () => statements.filter(s => /^(ALTER TABLE|UPDATE|CREATE (UNIQUE )?INDEX)/i.test(s));

    it("issues no ALTER TABLE, UPDATE or CREATE INDEX on the second boot", async () => {
        await ensureAuthTablesExist(db);
        expect(changes().length).toBeGreaterThan(0);

        statements.length = 0;
        await ensureAuthTablesExist(db);
        expect(changes()).toEqual([]);
    });

    it("still repairs what drifted", async () => {
        await ensureAuthTablesExist(db);
        // An older era's refresh_tokens: no `aal`, a nullable `session_id`
        // with no default and a NULL in it, the device-session constraint, no
        // session index. And a users table missing a column.
        await pglite.exec(`
            ALTER TABLE rebase.refresh_tokens DROP COLUMN aal;
            ALTER TABLE rebase.refresh_tokens ALTER COLUMN session_id DROP NOT NULL;
            ALTER TABLE rebase.refresh_tokens ALTER COLUMN session_id DROP DEFAULT;
            ALTER TABLE rebase.refresh_tokens ADD CONSTRAINT unique_device_session UNIQUE (uid, user_agent, ip_address);
            DROP INDEX rebase.idx_refresh_tokens_session;
            ALTER TABLE rebase.users DROP COLUMN photo_url;
            INSERT INTO rebase.users (id, email) VALUES ('u1', 'a@b.c');
            INSERT INTO rebase.refresh_tokens (uid, token_hash, expires_at, session_id) VALUES ('u1', 'h', now(), NULL);
        `);

        statements.length = 0;
        await ensureAuthTablesExist(db);
        const issued = changes().map(s => s.replace(/\s+/g, " "));
        expect(issued).toEqual(expect.arrayContaining([
            expect.stringMatching(/ALTER TABLE "rebase"."users" ADD COLUMN IF NOT EXISTS photo_url/),
            expect.stringMatching(/ADD COLUMN IF NOT EXISTS aal TEXT/),
            expect.stringMatching(/UPDATE "rebase"."refresh_tokens" SET session_id = gen_random_uuid\(\)::text WHERE session_id IS NULL/),
            expect.stringMatching(/ALTER COLUMN session_id SET DEFAULT gen_random_uuid\(\)::text/),
            expect.stringMatching(/ALTER COLUMN session_id SET NOT NULL/),
            expect.stringMatching(/CREATE INDEX IF NOT EXISTS idx_refresh_tokens_session/),
            expect.stringMatching(/DROP CONSTRAINT IF EXISTS unique_device_session/)
        ]));
        // Nothing that was already right was touched.
        expect(issued.filter(s => /session_started_at/.test(s))).toEqual([]);

        const { rows } = await pglite.query<{ column_name: string; is_nullable: string; column_default: string | null }>(
            `SELECT column_name, is_nullable, column_default FROM information_schema.columns
              WHERE table_schema = 'rebase' AND table_name = 'refresh_tokens' AND column_name IN ('aal', 'session_id')
              ORDER BY column_name`
        );
        expect(rows.map(r => [r.column_name, r.is_nullable, r.column_default !== null])).toEqual([
            ["aal", "YES", false],
            ["session_id", "NO", true]
        ]);
        const constraint = await pglite.query("SELECT 1 FROM pg_constraint WHERE conname = 'unique_device_session'");
        expect(constraint.rows).toEqual([]);

        // And having repaired it, the next boot is quiet again.
        statements.length = 0;
        await ensureAuthTablesExist(db);
        expect(changes()).toEqual([]);
    }, 30_000);
});
