/**
 * `fingerprint()` changes when the stored rows change.
 *
 * It used to be `md5(count || sum(xmin))`, which is linear in the xmins: a
 * transaction that deletes one row, updates another and inserts a third keeps
 * the count, and keeps the sum whenever the two xmins it removed add up to
 * twice its own — reachable with two concurrent sessions (the transaction that
 * writes took its xid before the deleted row's writer committed). Same
 * fingerprint, different rows, and a cache keyed on it served stale data.
 *
 * Each row version now also contributes a hash of its xmin, which no such
 * arithmetic cancels. The expression is evaluated over chosen xmins, since a
 * two-session xid replay is not something PGlite can stage.
 */
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { rowVersionsFingerprint } from "../src/services/FetchService";

let client: PGlite;
let db: ReturnType<typeof drizzle>;

beforeAll(() => {
    client = new PGlite();
    db = drizzle(client);
});

afterAll(async () => {
    await client.close();
});

/** The fingerprint of row versions with these xmins. */
async function fingerprintOf(xmins: number[]): Promise<string> {
    const rows = sql.join(xmins.map(xmin => sql`(${String(xmin)}::xid)`), sql`, `);
    const result = await db.execute<{ f: string }>(
        sql`SELECT ${rowVersionsFingerprint(sql.raw("v.x"))} AS f FROM (VALUES ${rows}) AS v(x)`
    );
    return result.rows[0].f;
}

describe("fingerprint()", () => {
    // Row A (xmin 100) and row R (xmin 104); transaction 102 deletes R,
    // updates A and inserts S. Two rows before, two after, and 100 + 104 =
    // 102 + 102: the count and the xmin sum are both unchanged.
    const before = [100, 104];
    const after = [102, 102];

    it("differs where the count and the xmin sum are the same", async () => {
        expect(await fingerprintOf(before)).not.toBe(await fingerprintOf(after));
    });

    it("is the same for the same row versions, whatever order they are read in", async () => {
        expect(await fingerprintOf([...before].reverse())).toBe(await fingerprintOf(before));
    });

    it("is defined for a table with no rows", async () => {
        const empty = await db.execute<{ f: string }>(
            sql`SELECT ${rowVersionsFingerprint(sql.raw("v.x"))} AS f FROM (SELECT '1'::xid AS x) v WHERE false`
        );
        expect(empty.rows[0].f).toMatch(/^[0-9a-f]{32}$/);
    });
});
