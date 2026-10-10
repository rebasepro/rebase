/**
 * What the change-capture trigger reads to name a changed row.
 *
 * The trigger runs on every row of every write to an instrumented table, from
 * any writer, and the payload is the row's key and nothing else. It used to
 * get there through `to_jsonb(NEW)`: every column fetched from TOAST,
 * decompressed and serialised, to read one of them. On a CMS table with a
 * rich-text or JSON document per row, flipping `status` made the trigger read
 * the whole document — measured at 150–260 µs per row against 5 µs for the
 * write itself. A table attached by its `id` now has the key read straight off
 * the row, and the payload is the same text it always was.
 */
import { PGlite } from "@electric-sql/pglite";

import { buildCdcFunctionSql, buildCdcTriggerSql, type CdcTriggerLevel } from "../src/services/cdc/trigger-cdc";

const ROWS = 10;
/** ~200 KB of hard-to-compress JSON per row, so it lives in TOAST. */
const DOCUMENT = "(SELECT jsonb_agg(md5(g::text || ':' || i)) FROM generate_series(1, 5000) i)";

describe.each<CdcTriggerLevel>(["statement", "row"])("the change-capture trigger (%s)", (level) => {
    let db: PGlite;
    let payloads: string[];

    /** TOAST blocks read from `table`'s document so far. */
    const toastBlocksRead = async (table: string): Promise<number> => {
        await db.query("SELECT pg_stat_force_next_flush()");
        const { rows } = await db.query<{ n: string | number }>(
            "SELECT coalesce(toast_blks_hit, 0) + coalesce(toast_blks_read, 0) AS n FROM pg_statio_user_tables WHERE relname = $1",
            [table]
        );
        return Number(rows[0].n);
    };

    const drain = async (expected: number) => {
        for (let i = 0; i < 100 && payloads.length < expected; i++) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    };

    beforeAll(async () => {
        db = new PGlite();
        await db.waitReady;
        await db.exec(buildCdcFunctionSql());
        for (const table of ["articles", "articles_plain", "articles_general"]) {
            await db.exec(`CREATE TABLE public.${table} (id int PRIMARY KEY, status text, doc jsonb);
                INSERT INTO public.${table} SELECT g, 'draft', ${DOCUMENT} FROM generate_series(1, ${ROWS}) g;`);
        }
        // How provisioning attaches a collection keyed by `id`.
        await db.exec(buildCdcTriggerSql("public", "articles", ["id"], level));
        // Attached with no columns, as an older boot left a table: the general path.
        await db.exec(buildCdcTriggerSql("public", "articles_general", [], level));
        payloads = [];
        await db.listen("rebase_cdc", payload => { payloads.push(payload); });
    }, 60_000);

    afterAll(async () => {
        await db.close();
    });

    it("reads none of a row's document to name it", async () => {
        const plainBefore = await toastBlocksRead("articles_plain");
        const capturedBefore = await toastBlocksRead("articles");

        for (let i = 1; i <= ROWS; i++) {
            await db.exec(`UPDATE public.articles_plain SET status = 'published' WHERE id = ${i}`);
            await db.exec(`UPDATE public.articles SET status = 'published' WHERE id = ${i}`);
        }
        // And every row in one statement: a batch, at the statement level.
        await db.exec("UPDATE public.articles_plain SET status = 'archived'");
        await db.exec("UPDATE public.articles SET status = 'archived'");

        // The write itself reads no TOAST (the document is unchanged), so
        // anything read here is the trigger's.
        expect(await toastBlocksRead("articles_plain")).toBe(plainBefore);
        expect(await toastBlocksRead("articles")).toBe(capturedBefore);
    });

    it("sends the payload the general path sends, for every operation", async () => {
        payloads.length = 0;
        const writes = (table: string) => [
            `INSERT INTO public.${table} VALUES (100, 'new', '{}')`,
            `UPDATE public.${table} SET status = 'edited' WHERE id = 100`,
            `DELETE FROM public.${table} WHERE id = 100`
        ];
        for (const write of [...writes("articles"), ...writes("articles_general")]) await db.exec(write);
        await drain(6);

        const fast = payloads.filter(p => p.includes("\"articles\""));
        const general = payloads.filter(p => p.includes("\"articles_general\"")).map(p => p.replace("\"articles_general\"", "\"articles\""));
        expect(fast).toHaveLength(3);
        expect(fast).toEqual(general);
        expect(JSON.parse(fast[2])).toEqual({ schema: "public", table: "articles", op: "DELETE", row: { id: 100 } });
    });

    it("still names the row, and never fails the write, once the column it was attached by is gone", async () => {
        await db.exec(`CREATE TABLE public.renamed (id int PRIMARY KEY, status text);
            INSERT INTO public.renamed VALUES (1, 'draft');`);
        await db.exec(buildCdcTriggerSql("public", "renamed", ["id"], level));
        await db.exec("ALTER TABLE public.renamed RENAME COLUMN id TO uid");
        payloads.length = 0;

        await db.exec("UPDATE public.renamed SET status = 'published' WHERE uid = 1");
        await drain(1);

        expect(payloads.map(p => JSON.parse(p))).toEqual([
            { schema: "public", table: "renamed", op: "UPDATE", row: { uid: 1 } }
        ]);
    });
});
