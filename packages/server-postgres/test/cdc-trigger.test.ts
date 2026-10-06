import {
    buildCdcFunctionSql,
    buildCdcTriggerSql,
    provisionTriggerCdc,
    CDC_CHANNEL,
    CDC_TRIGGER_NAME,
    CDC_TRIGGER_FUNCTION,
    type CdcTableRef
} from "../src/services/cdc/trigger-cdc";
import { parseCdcPayload } from "../src/services/cdc/CdcListener";
import { RealtimeService } from "../src/services/realtimeService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

describe("CDC trigger SQL", () => {
    it("creates the rebase schema and a CREATE OR REPLACE trigger function on the channel", () => {
        const sql = buildCdcFunctionSql();
        expect(sql).toContain("CREATE SCHEMA IF NOT EXISTS rebase");
        expect(sql).toContain(`CREATE OR REPLACE FUNCTION ${CDC_TRIGGER_FUNCTION}()`);
        expect(sql).toContain(`pg_notify('${CDC_CHANNEL}'`);
        // Overflow guard so a wide row can never abort the write.
        expect(sql).toContain("octet_length");
        expect(sql).toContain("'truncated', true");
    });

    it("attaches an idempotent AFTER INSERT/UPDATE/DELETE row trigger, safely quoted", () => {
        const sql = buildCdcTriggerSql("public", "posts");
        expect(sql).toContain(`DROP TRIGGER IF EXISTS "${CDC_TRIGGER_NAME}" ON "public"."posts"`);
        expect(sql).toContain(`CREATE TRIGGER "${CDC_TRIGGER_NAME}" AFTER INSERT OR UPDATE OR DELETE ON "public"."posts"`);
        expect(sql).toContain("FOR EACH ROW");
        expect(sql).toContain(`EXECUTE FUNCTION ${CDC_TRIGGER_FUNCTION}()`);
    });

    it("quotes identifiers to resist injection via table/schema names", () => {
        const sql = buildCdcTriggerSql('we"ird', 'ta"ble');
        // Embedded quotes are doubled, never left to break out of the identifier.
        expect(sql).toContain('"we""ird"."ta""ble"');
    });
});

/** One table's row in the batched catalogue read `provisionTriggerCdc` makes. */
type CaptureRow = {
    key: string;
    columns: Array<{ name: string; primary: boolean }>;
    trigger: { callsFunction: boolean; type: number; enabled: string; args: string; qualified: boolean } | null;
};

/** `tgargs` as the catalogue read returns it: each argument NUL-terminated, hex-encoded. */
const tgargs = (...args: string[]): string => Buffer.from(args.map((a) => `${a}\0`).join(""), "utf8").toString("hex");

/** The trigger `buildCdcTriggerSql` creates, as the catalogue read describes it. */
const currentTrigger = (...args: string[]): CaptureRow["trigger"] =>
    ({ callsFunction: true, type: 29, enabled: "O", args: tgargs(...args), qualified: false });

/** A runner that answers the batched catalogue read with `state` and records everything else. */
function captureRunner(state: Record<string, Omit<CaptureRow, "key">>) {
    const calls: string[] = [];
    const run = jest.fn(async (text: string): Promise<Record<string, unknown>[]> => {
        calls.push(text);
        if (/WITH target\(key, rel\)/.test(text)) {
            return Object.entries(state).map(([key, value]) => ({ key, ...value }));
        }
        return [];
    });
    return { run, calls };
}

const idColumn = [{ name: "id", primary: true }];

describe("provisionTriggerCdc", () => {
    it("installs the function once and one trigger per unique table", async () => {
        const { run, calls } = captureRunner({
            "public.posts": { columns: idColumn, trigger: null },
            "public.authors": { columns: idColumn, trigger: null }
        });

        const tables: CdcTableRef[] = [
            { schema: "public", table: "posts" },
            { schema: "public", table: "authors" },
            { schema: "public", table: "posts" } // duplicate — should be de-duped
        ];

        const result = await provisionTriggerCdc(run, tables);

        // 1 function + 1 catalogue read for every table + 1 trigger per unique table
        expect(run).toHaveBeenCalledTimes(4);
        expect(calls[0]).toContain("CREATE OR REPLACE FUNCTION");
        expect(result.installed).toHaveLength(2);
        expect(result.skipped).toHaveLength(0);
        expect(calls.filter((c) => c.includes("CREATE TRIGGER"))).toHaveLength(2);
        // Nothing to drop on a table that has no trigger, and DROP TRIGGER
        // locks the table even when it drops nothing.
        expect(calls.filter((c) => c.includes("DROP TRIGGER"))).toHaveLength(0);
    });

    it("attaches each table with its primary key and the requested identity columns it has, once per table", async () => {
        const { run, calls } = captureRunner({
            "public.posts_tags": {
                columns: [
                    { name: "id", primary: true },
                    { name: "post_id", primary: false },
                    { name: "tag_id", primary: false },
                    { name: "note", primary: false }
                ],
                trigger: null
            }
        });

        await provisionTriggerCdc(run, [
            // A junction is listed once per direction of its relation.
            { schema: "public", table: "posts_tags", identityColumns: ["post_id", "tag_id"] },
            { schema: "public", table: "posts_tags", identityColumns: ["tag_id", "post_id", "gone"] }
        ]);

        const triggers = calls.filter((c) => c.includes("CREATE TRIGGER"));
        expect(triggers).toHaveLength(1);
        // The key, then the two ids; never `note`, and never a column the
        // table does not have.
        expect(triggers[0]).toContain(`EXECUTE FUNCTION ${CDC_TRIGGER_FUNCTION}('id', 'post_id', 'tag_id');`);
    });

    it("skips (does not abort) a table whose trigger install fails", async () => {
        const run = jest.fn(async (text: string) => {
            if (text.includes('"missing"')) throw new Error('relation "missing" does not exist');
            return [];
        });

        const result = await provisionTriggerCdc(run, [
            { schema: "public", table: "posts" },
            { schema: "public", table: "missing" }
        ]);

        expect(result.installed.map((t) => t.table)).toEqual(["posts"]);
        expect(result.skipped).toHaveLength(1);
        expect(result.skipped[0].table).toBe("missing");
        expect(result.skipped[0].reason).toContain("does not exist");
    });

    /**
     * Every boot used to drop and re-create every table's trigger: 2N round
     * trips, N commits and N ACCESS EXCLUSIVE locks, one of which held a live
     * `SELECT` behind the boot for 4.4 s while a report read the table.
     */
    describe("on a boot that changes nothing", () => {
        it("issues the function and one catalogue read, and no trigger DDL", async () => {
            const { run, calls } = captureRunner({
                "public.posts": { columns: idColumn, trigger: currentTrigger("id") },
                "public.authors": { columns: idColumn, trigger: currentTrigger("id") },
                "public.posts_tags": {
                    columns: [{ name: "post_id", primary: true }, { name: "tag_id", primary: true }],
                    trigger: currentTrigger("post_id", "tag_id")
                }
            });
            const result = await provisionTriggerCdc(run, [
                { schema: "public", table: "posts" },
                { schema: "public", table: "authors" },
                { schema: "public", table: "posts_tags", identityColumns: ["post_id", "tag_id"] }
            ]);

            expect(calls).toHaveLength(2);
            expect(calls.filter((c) => /DROP TRIGGER|CREATE TRIGGER/.test(c))).toEqual([]);
            expect(result.installed).toHaveLength(3);
            expect(result.skipped).toEqual([]);
        });

        it.each([
            ["disabled by hand", { ...currentTrigger("id")!, enabled: "D" }],
            ["attached with other columns", currentTrigger("id", "slug")],
            ["calling another function", { ...currentTrigger("id")!, callsFunction: false }],
            ["firing BEFORE", { ...currentTrigger("id")!, type: 31 }],
            ["carrying a WHEN clause", { ...currentTrigger("id")!, qualified: true }]
        ])("re-attaches a trigger %s", async (_label, trigger) => {
            const { run, calls } = captureRunner({ "public.posts": { columns: idColumn, trigger } });
            await provisionTriggerCdc(run, [{ schema: "public", table: "posts" }]);

            const ddl = calls.filter((c) => /DROP TRIGGER|CREATE TRIGGER/.test(c));
            expect(ddl).toHaveLength(1);
            expect(ddl[0]).toContain(`DROP TRIGGER IF EXISTS "${CDC_TRIGGER_NAME}" ON "public"."posts"`);
            expect(ddl[0]).toContain(`EXECUTE FUNCTION ${CDC_TRIGGER_FUNCTION}('id');`);
            // With a lock budget: a held table costs live traffic a second, not
            // the statement timeout.
            expect(ddl[0]).toMatch(/^SET LOCAL lock_timeout = '\d+ms';/);
        });

        it("retries a table whose lock is held, then reports it skipped", async () => {
            const calls: string[] = [];
            const run = jest.fn(async (text: string): Promise<Record<string, unknown>[]> => {
                calls.push(text);
                if (/WITH target/.test(text)) return [{ key: "public.posts", columns: idColumn, trigger: null }];
                if (/CREATE TRIGGER/.test(text)) {
                    throw Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" });
                }
                return [];
            });
            jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
            try {
                const pending = provisionTriggerCdc(run, [{ schema: "public", table: "posts" }]);
                await jest.runAllTimersAsync();
                const result = await pending;
                expect(calls.filter((c) => /CREATE TRIGGER/.test(c))).toHaveLength(3);
                expect(result.skipped.map((t) => t.table)).toEqual(["posts"]);
            } finally {
                jest.useRealTimers();
            }
        });

        it("leaves a real database's triggers alone on the second run", async () => {
            const { PGlite } = await import("@electric-sql/pglite");
            const db = new PGlite();
            try {
                await db.exec(
                    "CREATE TABLE public.posts (id text PRIMARY KEY, title text);" +
                    "CREATE TABLE public.posts_tags (post_id text, tag_id text, PRIMARY KEY (post_id, tag_id));"
                );
                const calls: string[] = [];
                const run = async (text: string): Promise<Record<string, unknown>[]> => {
                    calls.push(text);
                    const results = await db.exec(text);
                    return (results[results.length - 1]?.rows ?? []) as Record<string, unknown>[];
                };
                const tables: CdcTableRef[] = [
                    { schema: "public", table: "posts", identityColumns: ["id"] },
                    { schema: "public", table: "posts_tags", identityColumns: ["post_id", "tag_id"] }
                ];
                await provisionTriggerCdc(run, tables);
                expect(calls.filter((c) => /CREATE TRIGGER/.test(c))).toHaveLength(2);

                calls.length = 0;
                const second = await provisionTriggerCdc(run, tables);
                expect(calls.filter((c) => /DROP TRIGGER|CREATE TRIGGER/.test(c))).toEqual([]);
                expect(second.installed).toHaveLength(2);

                // Switched off by hand: the next boot switches it back on.
                await db.exec(`ALTER TABLE public.posts DISABLE TRIGGER "${CDC_TRIGGER_NAME}"`);
                calls.length = 0;
                await provisionTriggerCdc(run, tables);
                expect(calls.filter((c) => /CREATE TRIGGER/.test(c)).map((c) => /ON "public"\."(\w+)"/.exec(c)?.[1]))
                    .toEqual(["posts"]);
                const { rows } = await db.query<{ enabled: string }>(
                    `SELECT tgenabled::text AS enabled FROM pg_trigger WHERE tgname = '${CDC_TRIGGER_NAME}' AND tgrelid = 'public.posts'::regclass`
                );
                expect(rows).toEqual([{ enabled: "O" }]);
            } finally {
                await db.close();
            }
        }, 30_000);
    });
});

describe("parseCdcPayload", () => {
    it("parses a well-formed insert/update payload", () => {
        const event = parseCdcPayload(JSON.stringify({
            schema: "public", table: "posts", op: "UPDATE", row: { id: 7, title: "Hi" }
        }));
        expect(event).toEqual({
            schema: "public", table: "posts", op: "UPDATE", row: { id: 7, title: "Hi" }, truncated: false
        });
    });

    it("parses a delete payload (row is the OLD tuple)", () => {
        const event = parseCdcPayload(JSON.stringify({
            schema: "public", table: "posts", op: "DELETE", row: { id: 7 }
        }));
        expect(event?.op).toBe("DELETE");
        expect(event?.row).toEqual({ id: 7 });
    });

    it("flags a truncated (oversized) payload", () => {
        const event = parseCdcPayload(JSON.stringify({
            schema: "public", table: "posts", op: "INSERT", row: { id: 7 }, truncated: true
        }));
        expect(event?.truncated).toBe(true);
    });

    it("returns null for malformed JSON, missing fields, or unknown op", () => {
        expect(parseCdcPayload("not json")).toBeNull();
        expect(parseCdcPayload(JSON.stringify({ table: "posts", op: "UPDATE" }))).toBeNull();
        expect(parseCdcPayload(JSON.stringify({ schema: "public", table: "posts", op: "TRUNCATE" }))).toBeNull();
        expect(parseCdcPayload(JSON.stringify([1, 2, 3]))).toBeNull();
    });
});

describe("enableCdc capability detection (drives REALTIME_CDC=auto fallback)", () => {
    it("rejects and stays inactive when the LISTEN connection cannot be established", async () => {
        const registry = new PostgresCollectionRegistry();
        const service = new RealtimeService({} as never, registry);

        // Port 1 refuses immediately → start() surfaces the failure so `auto`
        // can fall back to app-level realtime instead of silently dropping events.
        await expect(
            service.enableCdc("postgresql://rebase@127.0.0.1:1/nonexistent")
        ).rejects.toBeTruthy();

        expect(service.isCdcActive()).toBe(false);
    });
});
