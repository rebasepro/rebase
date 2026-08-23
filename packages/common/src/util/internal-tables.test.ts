import {
    REBASE_INTERNAL_TABLES,
    REBASE_USER_ROLE,
    revokeInternalTableAccess,
    revokeInternalTableSql
} from "./internal-tables";

/**
 * The privilege boundary around Rebase's own tables.
 *
 * This module is the only thing keeping `rebase_user` away from refresh-token
 * hashes, TOTP secrets and API keys, and until now nothing tested it. Its
 * failure mode is the quiet kind: `revokeInternalTableAccess` swallows every
 * error into an `onError` callback, so a revoke that fails on all twenty tables
 * produces a boot that looks completely normal.
 *
 * The list membership assertions matter as much as the SQL ones. A table
 * revoked at creation but missing from `REBASE_INTERNAL_TABLES` is stranded on
 * every database provisioned before that revoke shipped — the boot-time sweep
 * in `ensureAppRole` iterates this list and nothing else can repair an
 * already-granted table.
 */
describe("internal table access", () => {

    // ─── The list itself ─────────────────────────────────────────────────────

    describe("REBASE_INTERNAL_TABLES", () => {

        it("covers every table a creator revokes at creation time", () => {
            // Kept in sync by hand with the `revokeInternalTableSql` call sites.
            // A creation-time revoke fires once, on the boot that first makes
            // the table; only the sweep can fix a database that predates it.
            const revokedAtCreation = [
                "api_keys",
                "branches",
                "channel_cursors",
                "channel_messages",
                "channel_presence",
                "cron_claims",
                "cron_logs",
                "entity_history",
                "idempotency_keys",
                "jobs",
                "rate_limit_hits"
            ];

            const missing = revokedAtCreation.filter((table) => !REBASE_INTERNAL_TABLES.includes(table));
            expect(missing).toEqual([]);
        });

        it("holds the auth tables whose rows no end user may ever address", () => {
            for (const table of [
                "refresh_tokens",
                "password_reset_tokens",
                "magic_link_tokens",
                "mfa_factors",
                "mfa_challenges",
                "recovery_codes",
                "user_identities"
            ]) {
                expect(REBASE_INTERNAL_TABLES).toContain(table);
            }
        });

        it("leaves `users` out, because revoking there breaks sign-in", () => {
            // The auth user table is also a collection: RLS enabled, policies
            // applied, and users read their own row through it.
            expect(REBASE_INTERNAL_TABLES).not.toContain("users");
        });

        it("has no duplicates", () => {
            expect(new Set(REBASE_INTERNAL_TABLES).size).toBe(REBASE_INTERNAL_TABLES.length);
        });
    });

    // ─── The statement ───────────────────────────────────────────────────────

    describe("revokeInternalTableSql", () => {

        it("revokes every privilege from the end-user role", () => {
            const sql = revokeInternalTableSql("rebase", "refresh_tokens");

            expect(sql).toContain(`REVOKE ALL ON "rebase"."refresh_tokens" FROM ${REBASE_USER_ROLE}`);
        });

        it("guards on the role existing, so an unprivileged install is a no-op", () => {
            // A bare REVOKE naming a missing role is an error, not a no-op, and
            // it would abort the boot it runs in.
            const sql = revokeInternalTableSql("rebase", "api_keys");

            expect(sql).toContain(`SELECT 1 FROM pg_roles WHERE rolname = '${REBASE_USER_ROLE}'`);
        });

        it("tolerates a table that does not exist yet", () => {
            // `cron_logs` never appears in a project with no cron jobs.
            expect(revokeInternalTableSql("rebase", "cron_logs")).toContain("to_regclass");
        });

        it("is a single statement, for handles that reject multi-statement strings", () => {
            // The semicolons inside the block are PL/pgSQL's, not the protocol's:
            // what matters is that the whole string is one dollar-quoted DO,
            // opened once and closed at the very end.
            const sql = revokeInternalTableSql("rebase", "jobs");

            expect(sql.startsWith("DO $rebase_revoke$")).toBe(true);
            expect(sql.endsWith("$rebase_revoke$;")).toBe(true);
            expect(sql.split("$rebase_revoke$")).toHaveLength(3);
        });

        it("refuses to interpolate an unsafe identifier", () => {
            expect(() => revokeInternalTableSql("rebase", 'x"; DROP TABLE users; --')).toThrow(/unsafe table name/);
            expect(() => revokeInternalTableSql('pub"lic', "api_keys")).toThrow(/unsafe schema name/);
        });
    });

    // ─── The sweep ───────────────────────────────────────────────────────────

    describe("revokeInternalTableAccess", () => {

        it("issues one statement per internal table", async () => {
            const executed: string[] = [];

            await revokeInternalTableAccess(async (sql) => { executed.push(sql); }, "rebase");

            expect(executed).toHaveLength(REBASE_INTERNAL_TABLES.length);
            for (const table of REBASE_INTERNAL_TABLES) {
                expect(executed.some((sql) => sql.includes(`"rebase"."${table}"`))).toBe(true);
            }
        });

        it("reports a failure rather than swallowing it", async () => {
            // The whole risk: an onError that no caller wires up turns twenty
            // failed revokes into a silent, apparently-clean boot.
            const seen: string[] = [];

            await revokeInternalTableAccess(
                async (sql) => {
                    if (sql.includes("refresh_tokens")) throw new Error("permission denied");
                },
                "rebase",
                { onError: (table) => seen.push(table) }
            );

            expect(seen).toEqual(["refresh_tokens"]);
        });

        it("keeps going after one table fails", async () => {
            const executed: string[] = [];

            await revokeInternalTableAccess(
                async (sql) => {
                    executed.push(sql);
                    if (sql.includes("user_identities")) throw new Error("not the owner");
                },
                "rebase",
                { onError: () => undefined }
            );

            // A connection that does not own one table must not strand the rest.
            expect(executed).toHaveLength(REBASE_INTERNAL_TABLES.length);
        });

        it("honours an explicit table list", async () => {
            const executed: string[] = [];

            await revokeInternalTableAccess(
                async (sql) => { executed.push(sql); },
                "rebase",
                { tables: ["api_keys"] }
            );

            expect(executed).toHaveLength(1);
            expect(executed[0]).toContain('"rebase"."api_keys"');
        });
    });
});
