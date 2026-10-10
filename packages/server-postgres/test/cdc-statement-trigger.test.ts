/**
 * How many notifications a statement costs, and what each one names.
 *
 * The capture trigger used to fire once per row: a 1M-row UPDATE (a backfill,
 * a bulk status change) put a million notifications — ~80 MB — into Postgres's
 * shared notification queue, and every instance's listener read and parsed
 * each one. It now fires once per statement, reads the statement's transition
 * table, and names the changed rows in batches cut under the 8000-byte NOTIFY
 * limit: about a thousand integer ids per notification.
 *
 * The triggers are the database's, so during a rolling deploy an instance of
 * the previous version can be listening to triggers this version attached, and
 * the other way round. Its parser reads one row per notification; the last
 * block pins that every mix of the two delivers every row to both.
 */
import { PGlite } from "@electric-sql/pglite";

import {
    buildCdcFunctionSql,
    buildCdcTriggerSql,
    provisionTriggerCdc,
    CDC_ROW_COMPAT_MS,
    type CdcTableRef
} from "../src/services/cdc/trigger-cdc";
import { parseCdcPayload } from "../src/services/cdc/CdcListener";

const MAX_PAYLOAD = 8000;

/**
 * The previous version's parser, as it shipped: one row per notification, read
 * from `row`. Anything else in the payload is ignored, and a payload with no
 * `row` names no row.
 */
function parsePreviousVersion(payload: string): { schema: string; table: string; op: string; row: Record<string, unknown> } | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(payload);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.schema !== "string" || typeof obj.table !== "string") return null;
    if (obj.op !== "INSERT" && obj.op !== "UPDATE" && obj.op !== "DELETE") return null;
    const row = obj.row && typeof obj.row === "object" ? (obj.row as Record<string, unknown>) : {};
    return { schema: obj.schema, table: obj.table, op: obj.op, row };
}

describe("statement-level change capture", () => {
    let db: PGlite;
    const payloads: string[] = [];

    const run = async (text: string): Promise<Record<string, unknown>[]> => {
        const results = await db.exec(text);
        return (results[results.length - 1]?.rows ?? []) as Record<string, unknown>[];
    };

    /** Run `sql` and return the notifications it caused. */
    const notificationsOf = async (sql: string): Promise<string[]> => {
        payloads.length = 0;
        await db.exec(sql);
        // PGlite delivers a statement's notifications together, after it.
        let seen = -1;
        for (let i = 0; i < 100 && seen !== payloads.length; i++) {
            seen = payloads.length;
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        return [...payloads];
    };

    /** Every row the new parser reads out of `notes`, as `table:key`. */
    const named = (notes: string[]): string[] =>
        notes.flatMap(p => parseCdcPayload(p) ?? []).map(e => `${e.op}:${e.table}:${JSON.stringify(e.row)}`).sort();

    const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
    const expectedRows = (op: string, table: string, keys: Array<Record<string, unknown>>) =>
        keys.map(k => `${op}:${table}:${JSON.stringify(k)}`).sort();

    const TABLES: CdcTableRef[] = [
        { schema: "public", table: "posts", identityColumns: ["id"] },
        { schema: "public", table: "members", identityColumns: ["project_id", "user_id"] },
        { schema: "public", table: "docs", identityColumns: ["slug"] },
        { schema: "public", table: "long_keys", identityColumns: ["key"] }
    ];

    beforeAll(async () => {
        db = new PGlite();
        await db.waitReady;
        await db.exec(`
            CREATE TABLE public.posts (id int PRIMARY KEY, status text, body text);
            INSERT INTO public.posts SELECT g, 'draft', repeat('x', 200) FROM generate_series(1, 5000) g;
            CREATE TABLE public.members (project_id text, user_id text, role text, PRIMARY KEY (project_id, user_id));
            INSERT INTO public.members SELECT 'p' || (g % 7), 'u' || g, 'viewer' FROM generate_series(1, 1500) g;
            CREATE TABLE public.docs (slug text PRIMARY KEY, body text);
            INSERT INTO public.docs SELECT 'doc-' || g, 'draft body' FROM generate_series(1, 1200) g;
            CREATE TABLE public.long_keys (key text PRIMARY KEY, n int);
            INSERT INTO public.long_keys SELECT g || '-' || repeat('k', 300), g FROM generate_series(1, 200) g;
        `);
        // A fresh database: no older version ever instrumented it.
        await provisionTriggerCdc(run, TABLES);
        await db.listen("rebase_cdc", payload => { payloads.push(payload); });
    }, 60_000);

    afterAll(async () => {
        await db.close();
    });

    it("announces a 5,000-row UPDATE in a handful of notifications, naming every row once", async () => {
        const notes = await notificationsOf("UPDATE public.posts SET status = 'published'");

        expect(notes.length).toBeLessThanOrEqual(5);
        for (const note of notes) expect(Buffer.byteLength(note)).toBeLessThan(MAX_PAYLOAD);
        expect(named(notes)).toEqual(expectedRows("UPDATE", "posts", range(1, 5000).map(id => ({ id }))));
    });

    it("does the same for an INSERT … SELECT and a DELETE", async () => {
        const inserted = await notificationsOf("INSERT INTO public.posts SELECT g, 'new', '' FROM generate_series(5001, 8000) g");
        expect(inserted.length).toBeLessThanOrEqual(3);
        expect(named(inserted)).toEqual(expectedRows("INSERT", "posts", range(5001, 8000).map(id => ({ id }))));

        const deleted = await notificationsOf("DELETE FROM public.posts WHERE id > 5000");
        expect(deleted.length).toBeLessThanOrEqual(3);
        expect(named(deleted)).toEqual(expectedRows("DELETE", "posts", range(5001, 8000).map(id => ({ id }))));
    });

    it("announces a one-row statement exactly as the row trigger did, and a no-row statement not at all", async () => {
        const one = await notificationsOf("UPDATE public.posts SET status = 'edited' WHERE id = 42");
        expect(one.map(p => JSON.parse(p))).toEqual([{ schema: "public", table: "posts", op: "UPDATE", row: { id: 42 } }]);

        expect(await notificationsOf("UPDATE public.posts SET status = 'none' WHERE id < 0")).toEqual([]);
    });

    it("names rows by a composite key and by a key that is not `id`, in batches", async () => {
        const members = await notificationsOf("UPDATE public.members SET role = 'editor'");
        expect(members.length).toBeLessThanOrEqual(5);
        const keys = (await db.query<{ project_id: string; user_id: string }>("SELECT project_id, user_id FROM public.members")).rows;
        expect(named(members)).toEqual(expectedRows("UPDATE", "members", keys.map(k => ({ project_id: k.project_id, user_id: k.user_id }))));

        const docs = await notificationsOf("UPDATE public.docs SET body = 'published body'");
        expect(docs.length).toBeLessThanOrEqual(5);
        expect(named(docs)).toEqual(expectedRows("UPDATE", "docs", range(1, 1200).map(g => ({ slug: `doc-${g}` }))));
        // The key and nothing else.
        for (const note of [...members, ...docs]) expect(note).not.toMatch(/editor|published body/);
    });

    it("keeps every notification under the NOTIFY limit when the keys are long", async () => {
        const notes = await notificationsOf("UPDATE public.long_keys SET n = n + 1");
        for (const note of notes) expect(Buffer.byteLength(note)).toBeLessThan(MAX_PAYLOAD);
        expect(named(notes)).toEqual(expectedRows("UPDATE", "long_keys", range(1, 200).map(g => ({ key: `${g}-${"k".repeat(300)}` }))));
    });

    it("announces a TRUNCATE, which the row trigger never saw", async () => {
        await db.exec("CREATE TABLE public.scratch (id int PRIMARY KEY); INSERT INTO public.scratch VALUES (1), (2);");
        await provisionTriggerCdc(run, [{ schema: "public", table: "scratch", identityColumns: ["id"] }]);
        const notes = await notificationsOf("TRUNCATE public.scratch");
        expect(notes.flatMap(p => parseCdcPayload(p) ?? [])).toEqual([
            { schema: "public", table: "scratch", op: "TRUNCATE", row: {}, truncated: false }
        ]);
    });

    it("still names the rows, and never fails the write, once the `id` it was attached by is renamed", async () => {
        await db.exec(`CREATE TABLE public.renamed (id int PRIMARY KEY, status text);
            INSERT INTO public.renamed SELECT g, 'draft' FROM generate_series(1, 300) g;`);
        await provisionTriggerCdc(run, [{ schema: "public", table: "renamed", identityColumns: ["id"] }]);
        await db.exec("ALTER TABLE public.renamed RENAME COLUMN id TO uid");

        const notes = await notificationsOf("UPDATE public.renamed SET status = 'published'");
        expect(named(notes)).toEqual(expectedRows("UPDATE", "renamed", range(1, 300).map(uid => ({ uid }))));
        const one = await notificationsOf("UPDATE public.renamed SET status = 'one' WHERE uid = 7");
        expect(one.map(p => JSON.parse(p))).toEqual([{ schema: "public", table: "renamed", op: "UPDATE", row: { uid: 7 } }]);
    });
});

describe("a rolling deploy: the previous version and this one on the same database", () => {
    let db: PGlite;
    const payloads: string[] = [];

    const run = async (text: string): Promise<Record<string, unknown>[]> => {
        const results = await db.exec(text);
        return (results[results.length - 1]?.rows ?? []) as Record<string, unknown>[];
    };

    const notificationsOf = async (sql: string): Promise<string[]> => {
        payloads.length = 0;
        await db.exec(sql);
        let seen = -1;
        for (let i = 0; i < 100 && seen !== payloads.length; i++) {
            seen = payloads.length;
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        return [...payloads];
    };

    const ROWS = 2000;
    const ALL = Array.from({ length: ROWS }, (_, i) => String(i + 1));
    const TABLES: CdcTableRef[] = [
        { schema: "public", table: "posts", identityColumns: ["id"] },
        { schema: "public", table: "posts_tags", identityColumns: ["post_id", "tag_id"] }
    ];

    /** The post ids each version's listener hears about. */
    const heardByPrevious = (notes: string[]) =>
        [...new Set(notes.map(parsePreviousVersion).filter(e => e?.table === "posts" && e.row.id !== undefined).map(e => String(e!.row.id)))].sort();
    const heardByThis = (notes: string[]) =>
        [...new Set(notes.flatMap(p => parseCdcPayload(p) ?? []).filter(e => e.table === "posts" && e.row.id !== undefined).map(e => String(e.row.id)))].sort();
    /** The junction links each version's listener hears about: what reaches `posts/:id/tags`. */
    const linksHeardByPrevious = (notes: string[]) =>
        notes.map(parsePreviousVersion).filter(e => e?.table === "posts_tags" && e.row.post_id !== undefined && e.row.tag_id !== undefined).length;

    /** What a boot of the previous version does: its row function, and a row trigger on every table that has none. */
    const bootPreviousVersion = async () => {
        await db.exec(buildCdcFunctionSql());
        for (const { table, identityColumns } of TABLES) {
            const has = await db.query<{ n: number }>(
                `SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = 'public.${table}'::regclass AND tgname = 'rebase_cdc_trigger'`
            );
            if (has.rows[0].n === 0) {
                // Its create-only path: no DROP.
                const sql = buildCdcTriggerSql("public", table, identityColumns, "row");
                await db.exec(sql.slice(sql.indexOf("CREATE TRIGGER")));
            }
        }
    };

    beforeEach(async () => {
        db = new PGlite();
        await db.waitReady;
        await db.exec(`
            CREATE TABLE public.posts (id int PRIMARY KEY, status text);
            INSERT INTO public.posts SELECT g, 'draft' FROM generate_series(1, ${ROWS}) g;
            CREATE TABLE public.posts_tags (post_id int, tag_id int, PRIMARY KEY (post_id, tag_id));
        `);
        await db.listen("rebase_cdc", payload => { payloads.push(payload); });
    }, 60_000);

    afterEach(async () => {
        await db.close();
    });

    it("the previous version's triggers, this version's listener: every row is heard", async () => {
        await bootPreviousVersion();
        const notes = await notificationsOf("UPDATE public.posts SET status = 'published'");
        expect(heardByThis(notes)).toEqual([...ALL].sort());
    });

    it("this version converts the triggers while the previous version still listens: both hear every row, links included", async () => {
        await bootPreviousVersion();
        await provisionTriggerCdc(run, TABLES);

        const notes = await notificationsOf("UPDATE public.posts SET status = 'published'");
        expect(heardByPrevious(notes)).toEqual([...ALL].sort());
        expect(heardByThis(notes)).toEqual([...ALL].sort());

        const links = await notificationsOf("INSERT INTO public.posts_tags SELECT g, 1 FROM generate_series(1, 50) g");
        expect(linksHeardByPrevious(links)).toBe(50);
    });

    it("once the window has passed, the same statement is batched — and this version still hears every row", async () => {
        await bootPreviousVersion();
        // Converted longer ago than the window.
        await provisionTriggerCdc(run, TABLES, { now: Date.now() - 2 * CDC_ROW_COMPAT_MS });

        const notes = await notificationsOf("UPDATE public.posts SET status = 'published'");
        expect(notes.length).toBeLessThanOrEqual(3);
        expect(heardByThis(notes)).toEqual([...ALL].sort());
    });

    it("a boot of the previous version after this one (a rollback): both hear every row, and the next boot of this one converts back", async () => {
        await provisionTriggerCdc(run, TABLES, { now: Date.now() - 2 * CDC_ROW_COMPAT_MS });
        await bootPreviousVersion();

        const notes = await notificationsOf("UPDATE public.posts SET status = 'published'");
        expect(heardByPrevious(notes)).toEqual([...ALL].sort());
        expect(heardByThis(notes)).toEqual([...ALL].sort());

        // Rolled forward again: the row trigger goes, and the window re-opens
        // for the instances of the previous version that may still be up.
        await provisionTriggerCdc(run, TABLES);
        const { rows } = await db.query<{ name: string }>(
            "SELECT tgname AS name FROM pg_trigger WHERE tgrelid = 'public.posts'::regclass AND NOT tgisinternal ORDER BY tgname"
        );
        expect(rows.map(r => r.name)).toEqual(["rebase_cdc_delete", "rebase_cdc_insert", "rebase_cdc_truncate", "rebase_cdc_update"]);
        const after = await notificationsOf("UPDATE public.posts SET status = 'again'");
        expect(heardByPrevious(after)).toEqual([...ALL].sort());
    });
});
