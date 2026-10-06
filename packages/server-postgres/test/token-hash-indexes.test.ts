/**
 * One index per token hash.
 *
 * The four token tables — refresh tokens, password resets, magic links, API
 * keys — each declare `UNIQUE (token_hash)` / `UNIQUE (key_hash)`, and every
 * era also created `idx_<table>_hash`, a plain btree on the same column. Every
 * lookup is `hash = $1`, which the unique index answers, so the second index
 * was pure write cost: each sign-in, refresh, reset and key paid two index
 * insertions and their WAL. It is no longer created, and boot drops it from a
 * database an older release built — but only while the unique index is there
 * to serve the lookups.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { DataDriver } from "@rebasepro/types";
import { ensureAuthTablesExist } from "../src/auth/ensure-tables";
import { createApiKeyStore } from "../../server/src/auth/api-keys/api-key-store";

const TOKEN_TABLES = { refresh_tokens: "token_hash", password_reset_tokens: "token_hash", magic_link_tokens: "token_hash", api_keys: "key_hash" };
const DUPLICATES = Object.keys(TOKEN_TABLES).map(table => `idx_${table}_hash`);

describe("the token tables carry one index on their hash", () => {
    let pglite: PGlite;
    let statements: string[];
    let db: NodePgDatabase;
    let driver: DataDriver;

    beforeEach(async () => {
        pglite = new PGlite();
        await pglite.waitReady;
        statements = [];
        db = drizzle(pglite, { logger: { logQuery: (query: string) => { statements.push(query.trim()); } } }) as unknown as NodePgDatabase;
        driver = {
            admin: {
                executeSql: async (text: string, options?: { params?: unknown[] }) => {
                    statements.push(text.trim());
                    return (await pglite.query<Record<string, unknown>>(text, options?.params)).rows;
                }
            }
        } as unknown as DataDriver;
    });

    afterEach(async () => {
        await pglite.close();
    });

    const boot = async () => {
        await ensureAuthTablesExist(db);
        await createApiKeyStore(driver)!.ensureTable();
    };

    /** `table → index names` of every index whose columns are exactly the hash column. */
    const hashIndexes = async (): Promise<Record<string, string[]>> => {
        const out: Record<string, string[]> = {};
        for (const [table, column] of Object.entries(TOKEN_TABLES)) {
            const { rows } = await pglite.query<{ name: string }>(
                `SELECT ic.relname AS name FROM pg_index i
                 JOIN pg_class ic ON ic.oid = i.indexrelid
                 JOIN pg_class t ON t.oid = i.indrelid
                 JOIN pg_namespace n ON n.oid = t.relnamespace
                 JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = i.indkey[0]
                 WHERE n.nspname = 'rebase' AND t.relname = $1 AND a.attname = $2 AND i.indnatts = 1
                 ORDER BY 1`,
                [table, column]
            );
            out[table] = rows.map(row => row.name);
        }
        return out;
    };

    /** The duplicates as every release before this one created them. */
    const recreateDuplicates = async () => {
        for (const [table, column] of Object.entries(TOKEN_TABLES)) {
            await pglite.exec(`CREATE INDEX idx_${table}_hash ON rebase.${table} (${column})`);
        }
    };

    it("are created with the unique index alone", async () => {
        await boot();
        expect(await hashIndexes()).toEqual({
            refresh_tokens: ["refresh_tokens_token_hash_key"],
            password_reset_tokens: ["password_reset_tokens_token_hash_key"],
            magic_link_tokens: ["magic_link_tokens_token_hash_key"],
            api_keys: ["api_keys_key_hash_key"]
        });
        expect(statements.filter(s => /CREATE INDEX[\s\S]*_hash\b/i.test(s) && DUPLICATES.some(d => s.includes(d)))).toEqual([]);
    });

    it("lose the duplicate an older release built, and the next boot leaves them alone", async () => {
        await boot();
        await recreateDuplicates();

        statements.length = 0;
        await boot();
        const all = await hashIndexes();
        for (const names of Object.values(all)) expect(names.some(name => DUPLICATES.includes(name))).toBe(false);
        for (const names of Object.values(all)) expect(names).toHaveLength(1);

        // The auth side reads the catalogue first and sends nothing once they are gone.
        statements.length = 0;
        await ensureAuthTablesExist(db);
        expect(statements.filter(s => /DROP INDEX|idx_[a-z_]+_hash/.test(s))).toEqual([]);
    });

    it("keep their plain index when no unique index covers the column", async () => {
        await boot();
        await recreateDuplicates();
        // An adopted table without the constraint: the plain index is the only
        // thing serving `token_hash = $1`, and dropping it would turn every
        // refresh into a sequential scan.
        await pglite.exec(`
            ALTER TABLE rebase.refresh_tokens DROP CONSTRAINT refresh_tokens_token_hash_key;
            ALTER TABLE rebase.api_keys DROP CONSTRAINT api_keys_key_hash_key;
        `);

        await boot();
        const all = await hashIndexes();
        expect(all.refresh_tokens).toEqual(["idx_refresh_tokens_hash"]);
        expect(all.api_keys).toEqual(["idx_api_keys_hash"]);
        expect(all.password_reset_tokens).toEqual(["password_reset_tokens_token_hash_key"]);
        expect(all.magic_link_tokens).toEqual(["magic_link_tokens_token_hash_key"]);
    });

    it("answer every hash lookup from the unique index", async () => {
        await boot();
        await pglite.exec(`
            INSERT INTO rebase.users (id, email) VALUES ('u1', 'a@b.c');
            INSERT INTO rebase.refresh_tokens (uid, token_hash, expires_at)
                SELECT 'u1', md5(g::text), now() + interval '1 day' FROM generate_series(1, 5000) g;
            INSERT INTO rebase.password_reset_tokens (uid, token_hash, expires_at)
                SELECT 'u1', md5(g::text), now() FROM generate_series(1, 5000) g;
            INSERT INTO rebase.magic_link_tokens (uid, token_hash, expires_at)
                SELECT 'u1', md5(g::text), now() FROM generate_series(1, 5000) g;
            INSERT INTO rebase.api_keys (name, key_prefix, key_hash, created_by)
                SELECT 'k', 'rk_', md5(g::text), 'u1' FROM generate_series(1, 5000) g;
            ANALYZE;
        `);
        for (const [table, column] of Object.entries(TOKEN_TABLES)) {
            const { rows } = await pglite.query<{ "QUERY PLAN": string }>(
                `EXPLAIN SELECT * FROM rebase.${table} WHERE ${column} = md5('42')`
            );
            const plan = rows.map(row => row["QUERY PLAN"]).join("\n");
            expect(plan).toMatch(new RegExp(`Index Scan using ${table}_${column}_key`));
        }
    });
});
