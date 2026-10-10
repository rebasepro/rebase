import {
    buildCdcFunctionSql,
    buildCdcTriggerSql,
    provisionTriggerCdc,
    refreshInstalledCdcFunction,
    CDC_CHANNEL,
    CDC_ROW_COMPAT_MS,
    CDC_STATEMENT_FUNCTION,
    CDC_STATEMENT_TRIGGERS,
    CDC_TRIGGER_NAME,
    CDC_TRIGGER_FUNCTION,
    type CdcTableRef
} from "../src/services/cdc/trigger-cdc";
import { parseCdcPayload } from "../src/services/cdc/CdcListener";
import { RealtimeService } from "../src/services/realtimeService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

describe("CDC trigger SQL", () => {
    it("creates the rebase schema and both CREATE OR REPLACE trigger functions on the channel", () => {
        const sql = buildCdcFunctionSql();
        expect(sql).toContain("CREATE SCHEMA IF NOT EXISTS rebase");
        expect(sql).toContain(`CREATE OR REPLACE FUNCTION ${CDC_TRIGGER_FUNCTION}()`);
        expect(sql).toContain(`CREATE OR REPLACE FUNCTION ${CDC_STATEMENT_FUNCTION}()`);
        expect(sql).toContain(`pg_notify('${CDC_CHANNEL}'`);
        // Overflow guard so a wide row can never abort the write.
        expect(sql).toContain("octet_length");
        expect(sql).toContain("'truncated', true");
        // No compatibility window unless one is asked for.
        expect(sql).toContain("compat_until CONSTANT timestamptz := '-infinity';");
        expect(buildCdcFunctionSql({ compatUntil: "2026-10-08T00:00:00.000Z" }))
            .toContain("compat_until CONSTANT timestamptz := '2026-10-08T00:00:00.000Z';");
    });

    it("attaches idempotent AFTER INSERT/UPDATE/DELETE/TRUNCATE statement triggers by default, safely quoted", () => {
        const sql = buildCdcTriggerSql("public", "posts", ["id"]);
        // Every trigger of either level is dropped first, so a table moves
        // between levels in one transaction.
        for (const name of [CDC_TRIGGER_NAME, ...CDC_STATEMENT_TRIGGERS.map((t) => t.name)]) {
            expect(sql).toContain(`DROP TRIGGER IF EXISTS "${name}" ON "public"."posts"`);
        }
        expect(sql).toContain(`CREATE TRIGGER "rebase_cdc_insert" AFTER INSERT ON "public"."posts" REFERENCING NEW TABLE AS rebase_cdc_new FOR EACH STATEMENT EXECUTE FUNCTION ${CDC_STATEMENT_FUNCTION}('id');`);
        expect(sql).toContain(`CREATE TRIGGER "rebase_cdc_update" AFTER UPDATE ON "public"."posts" REFERENCING NEW TABLE AS rebase_cdc_new FOR EACH STATEMENT`);
        expect(sql).toContain(`CREATE TRIGGER "rebase_cdc_delete" AFTER DELETE ON "public"."posts" REFERENCING OLD TABLE AS rebase_cdc_old FOR EACH STATEMENT`);
        expect(sql).toContain(`CREATE TRIGGER "rebase_cdc_truncate" AFTER TRUNCATE ON "public"."posts" FOR EACH STATEMENT`);
        expect(sql).not.toContain("FOR EACH ROW");
    });

    it("attaches the AFTER INSERT/UPDATE/DELETE row trigger at the row level", () => {
        const sql = buildCdcTriggerSql("public", "posts", [], "row");
        expect(sql).toContain(`DROP TRIGGER IF EXISTS "${CDC_TRIGGER_NAME}" ON "public"."posts"`);
        expect(sql).toContain(`CREATE TRIGGER "${CDC_TRIGGER_NAME}" AFTER INSERT OR UPDATE OR DELETE ON "public"."posts" FOR EACH ROW EXECUTE FUNCTION ${CDC_TRIGGER_FUNCTION}();`);
        expect(sql).not.toContain("FOR EACH STATEMENT");
    });

    it("quotes identifiers to resist injection via table/schema names", () => {
        const sql = buildCdcTriggerSql('we"ird', 'ta"ble');
        // Embedded quotes are doubled, never left to break out of the identifier.
        expect(sql).toContain('"we""ird"."ta""ble"');
    });
});

/** An installed trigger as the batched catalogue read describes it. */
type TriggerRow = {
    name: string; fn: "row" | "statement" | "other"; type: number; enabled: string; args: string;
    qualified: boolean; newTable: string | null; oldTable: string | null;
};

/** One table's row in the batched catalogue read `provisionTriggerCdc` makes. */
type CaptureRow = {
    key: string;
    relkind?: string | null;
    columns: Array<{ name: string; primary: boolean }>;
    triggers: TriggerRow[];
    row_function_current?: boolean;
    statement_code_current?: boolean;
    compat_until?: string | null;
};

/** `tgargs` as the catalogue read returns it: each argument NUL-terminated, hex-encoded. */
const tgargs = (...args: string[]): string => Buffer.from(args.map((a) => `${a}\0`).join(""), "utf8").toString("hex");

/** The statement triggers `buildCdcTriggerSql` creates, as the catalogue read describes them. */
const currentTriggers = (...args: string[]): TriggerRow[] => CDC_STATEMENT_TRIGGERS.map((spec) => ({
    name: spec.name, fn: "statement", type: spec.type, enabled: "O", args: tgargs(...args), qualified: false,
    newTable: spec.newTable, oldTable: spec.oldTable
}));

/** The row trigger an older version attached to every table, as the catalogue read describes it. */
const rowTrigger = (...args: string[]): TriggerRow => ({
    name: CDC_TRIGGER_NAME, fn: "row", type: 29, enabled: "O", args: tgargs(...args), qualified: false, newTable: null, oldTable: null
});

/** A runner that answers the batched catalogue read with `state` and records everything else. */
function captureRunner(state: Record<string, Omit<CaptureRow, "key">>) {
    const calls: string[] = [];
    const run = jest.fn(async (text: string): Promise<Record<string, unknown>[]> => {
        calls.push(text);
        if (/WITH target\(key, rel\)/.test(text)) {
            return Object.entries(state).map(([key, value]) => ({ key, relkind: "r", ...value }));
        }
        return [];
    });
    return { run, calls };
}

const idColumn = [{ name: "id", primary: true }];

describe("provisionTriggerCdc", () => {
    it("installs the function once and one trigger per unique table", async () => {
        const { run, calls } = captureRunner({
            "public.posts": { columns: idColumn, triggers: [] },
            "public.authors": { columns: idColumn, triggers: [] }
        });

        const tables: CdcTableRef[] = [
            { schema: "public", table: "posts" },
            { schema: "public", table: "authors" },
            { schema: "public", table: "posts" } // duplicate — should be de-duped
        ];

        const result = await provisionTriggerCdc(run, tables);

        // 1 catalogue read for every table + the functions + 1 trigger batch per unique table
        expect(run).toHaveBeenCalledTimes(4);
        expect(calls[1]).toContain("CREATE OR REPLACE FUNCTION");
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
                triggers: []
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
        expect(triggers[0]).toContain(`EXECUTE FUNCTION ${CDC_STATEMENT_FUNCTION}('id', 'post_id', 'tag_id');`);
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
                "public.posts": { columns: idColumn, triggers: currentTriggers("id") },
                "public.authors": { columns: idColumn, triggers: currentTriggers("id") },
                "public.posts_tags": {
                    columns: [{ name: "post_id", primary: true }, { name: "tag_id", primary: true }],
                    triggers: currentTriggers("post_id", "tag_id")
                },
                // A partitioned table is current with the row trigger.
                "public.events": { relkind: "p", columns: idColumn, triggers: [rowTrigger("id")] }
            });
            const result = await provisionTriggerCdc(run, [
                { schema: "public", table: "posts" },
                { schema: "public", table: "authors" },
                { schema: "public", table: "posts_tags", identityColumns: ["post_id", "tag_id"] },
                { schema: "public", table: "events" }
            ]);

            expect(calls).toHaveLength(2);
            expect(calls.filter((c) => /DROP TRIGGER|CREATE TRIGGER/.test(c))).toEqual([]);
            expect(result.installed).toHaveLength(4);
            expect(result.skipped).toEqual([]);
            // Nothing converted, so no compatibility window.
            expect(calls[1]).toContain("compat_until CONSTANT timestamptz := '-infinity';");
        });

        it("rewrites neither function when both are already the current ones", async () => {
            const { run, calls } = captureRunner({
                "public.posts": {
                    columns: idColumn, triggers: currentTriggers("id"),
                    row_function_current: true, statement_code_current: true, compat_until: "-infinity"
                }
            });
            await provisionTriggerCdc(run, [{ schema: "public", table: "posts" }]);
            expect(calls).toHaveLength(1);
            expect(calls.filter((c) => c.includes("CREATE OR REPLACE FUNCTION"))).toEqual([]);
        });

        it.each([
            ["the row function is not current", { row_function_current: false }, [CDC_TRIGGER_FUNCTION]],
            ["the statement function's code is not current", { statement_code_current: false }, [CDC_STATEMENT_FUNCTION]],
            // A conversion opens the compatibility window, which lives in the body.
            ["a table is converted from the row trigger", { triggers: [rowTrigger("id")] }, [CDC_STATEMENT_FUNCTION]]
        ])("rewrites only what differs when %s", async (_label, patch, rewritten) => {
            const { run, calls } = captureRunner({
                "public.posts": {
                    columns: idColumn, triggers: currentTriggers("id"),
                    row_function_current: true, statement_code_current: true, compat_until: "-infinity", ...patch
                }
            });
            await provisionTriggerCdc(run, [{ schema: "public", table: "posts" }]);
            const ddl = calls.filter((c) => c.includes("CREATE OR REPLACE FUNCTION"));
            expect(ddl).toHaveLength(1);
            for (const fn of [CDC_TRIGGER_FUNCTION, CDC_STATEMENT_FUNCTION]) {
                expect(ddl[0].includes(`CREATE OR REPLACE FUNCTION ${fn}()`)).toBe(rewritten.includes(fn));
            }
        });

        const withOne = (patch: Partial<TriggerRow>): TriggerRow[] =>
            currentTriggers("id").map((t) => (t.name === "rebase_cdc_update" ? { ...t, ...patch } : t));

        it.each([
            ["disabled by hand", withOne({ enabled: "D" })],
            ["attached with other columns", withOne({ args: tgargs("id", "slug") })],
            ["calling another function", withOne({ fn: "other" })],
            ["calling the row function", withOne({ fn: "row" })],
            ["firing BEFORE", withOne({ type: 18 })],
            ["carrying a WHEN clause", withOne({ qualified: true })],
            ["capturing no transition table", withOne({ newTable: null })],
            ["missing", currentTriggers("id").filter((t) => t.name !== "rebase_cdc_truncate")]
        ])("re-attaches a set with one trigger %s", async (_label, triggers) => {
            const { run, calls } = captureRunner({ "public.posts": { columns: idColumn, triggers } });
            await provisionTriggerCdc(run, [{ schema: "public", table: "posts" }]);

            const ddl = calls.filter((c) => /DROP TRIGGER|CREATE TRIGGER/.test(c));
            expect(ddl).toHaveLength(1);
            expect(ddl[0]).toContain(`DROP TRIGGER IF EXISTS "rebase_cdc_update" ON "public"."posts"`);
            expect(ddl[0].match(/CREATE TRIGGER/g)).toHaveLength(4);
            expect(ddl[0]).toContain(`EXECUTE FUNCTION ${CDC_STATEMENT_FUNCTION}('id');`);
            // With a lock budget: a held table costs live traffic a second, not
            // the statement timeout.
            expect(ddl[0]).toMatch(/^SET LOCAL lock_timeout = '\d+ms';/);
        });

        it("converts a table from the row trigger an older version attached, in one batch, and opens the compatibility window", async () => {
            const now = Date.parse("2026-10-07T12:00:00.000Z");
            const { run, calls } = captureRunner({ "public.posts": { columns: idColumn, triggers: [rowTrigger("id")] } });
            await provisionTriggerCdc(run, [{ schema: "public", table: "posts" }], { now });

            const ddl = calls.filter((c) => /DROP TRIGGER|CREATE TRIGGER/.test(c));
            expect(ddl).toHaveLength(1);
            expect(ddl[0]).toContain(`DROP TRIGGER IF EXISTS "${CDC_TRIGGER_NAME}" ON "public"."posts"`);
            expect(ddl[0].match(/CREATE TRIGGER/g)).toHaveLength(4);
            expect(ddl[0]).not.toContain("FOR EACH ROW");
            const until = new Date(now + CDC_ROW_COMPAT_MS).toISOString();
            expect(calls.find((c) => c.includes("CREATE OR REPLACE FUNCTION"))).toContain(`compat_until CONSTANT timestamptz := '${until}';`);
        });

        it("keeps a compatibility window an earlier boot opened, and never shortens it", async () => {
            const now = Date.parse("2026-10-07T12:00:00.000Z");
            const opened = "2026-10-08T06:00:00.000Z";
            const { run, calls } = captureRunner({ "public.posts": { columns: idColumn, triggers: currentTriggers("id"), compat_until: opened } });
            await provisionTriggerCdc(run, [{ schema: "public", table: "posts" }], { now });
            expect(calls[1]).toContain(`compat_until CONSTANT timestamptz := '${opened}';`);
        });

        it("gives a partitioned table the row trigger, and converts it back from statement triggers", async () => {
            const { run, calls } = captureRunner({ "public.events": { relkind: "p", columns: idColumn, triggers: currentTriggers("id") } });
            await provisionTriggerCdc(run, [{ schema: "public", table: "events" }]);

            const ddl = calls.filter((c) => /DROP TRIGGER|CREATE TRIGGER/.test(c));
            expect(ddl).toHaveLength(1);
            expect(ddl[0]).toContain(`CREATE TRIGGER "${CDC_TRIGGER_NAME}" AFTER INSERT OR UPDATE OR DELETE ON "public"."events" FOR EACH ROW EXECUTE FUNCTION ${CDC_TRIGGER_FUNCTION}('id');`);
            expect(ddl[0]).not.toContain("FOR EACH STATEMENT");
        });

        it("retries a table whose lock is held, then reports it skipped", async () => {
            const calls: string[] = [];
            const run = jest.fn(async (text: string): Promise<Record<string, unknown>[]> => {
                calls.push(text);
                if (/WITH target/.test(text)) return [{ key: "public.posts", relkind: "r", columns: idColumn, triggers: [] }];
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
                // A boot that changes nothing writes nothing: one catalogue read.
                expect(calls.filter((c) => /DROP TRIGGER|CREATE TRIGGER|CREATE OR REPLACE FUNCTION/.test(c))).toEqual([]);
                expect(calls).toHaveLength(1);
                expect(second.installed).toHaveLength(2);

                // Switched off by hand: the next boot switches it back on.
                await db.exec(`ALTER TABLE public.posts DISABLE TRIGGER "rebase_cdc_update"`);
                calls.length = 0;
                await provisionTriggerCdc(run, tables);
                expect(calls.filter((c) => /CREATE TRIGGER/.test(c)).map((c) => /ON "public"\."(\w+)"/.exec(c)?.[1]))
                    .toEqual(["posts"]);
                const { rows } = await db.query<{ name: string; enabled: string }>(
                    "SELECT tgname AS name, tgenabled::text AS enabled FROM pg_trigger WHERE tgrelid = 'public.posts'::regclass AND NOT tgisinternal ORDER BY tgname"
                );
                expect(rows).toEqual(CDC_STATEMENT_TRIGGERS.map((t) => ({ name: t.name, enabled: "O" })).sort((a, b) => a.name.localeCompare(b.name)));

                // A database an older version instrumented: converted once, then left alone.
                await db.exec(buildCdcTriggerSql("public", "posts", ["id"], "row"));
                calls.length = 0;
                await provisionTriggerCdc(run, tables);
                expect(calls.filter((c) => /CREATE TRIGGER/.test(c))).toHaveLength(1);
                calls.length = 0;
                await provisionTriggerCdc(run, tables);
                expect(calls.filter((c) => /DROP TRIGGER|CREATE TRIGGER|CREATE OR REPLACE FUNCTION/.test(c))).toEqual([]);
                // An older body is replaced, and nothing else.
                await db.exec(`CREATE OR REPLACE FUNCTION ${CDC_TRIGGER_FUNCTION}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$`);
                calls.length = 0;
                await provisionTriggerCdc(run, tables);
                const rewritten = calls.filter((c) => c.includes("CREATE OR REPLACE FUNCTION"));
                expect(rewritten).toHaveLength(1);
                expect(rewritten[0]).toContain(`CREATE OR REPLACE FUNCTION ${CDC_TRIGGER_FUNCTION}()`);
                expect(rewritten[0]).not.toContain(`CREATE OR REPLACE FUNCTION ${CDC_STATEMENT_FUNCTION}()`);
                // The window the conversion opened is kept by the boots after it.
                const { rows: fn } = await db.query<{ src: string }>(
                    "SELECT prosrc AS src FROM pg_proc WHERE proname = 'rebase_cdc_notify_statement'"
                );
                const until = /compat_until CONSTANT timestamptz := '([^']*)'/.exec(fn[0].src)?.[1];
                expect(Date.parse(until ?? "")).toBeGreaterThan(Date.now());
            } finally {
                await db.close();
            }
        }, 30_000);
    });
});

describe("parseCdcPayload", () => {
    it("parses a well-formed insert/update payload", () => {
        const events = parseCdcPayload(JSON.stringify({
            schema: "public", table: "posts", op: "UPDATE", row: { id: 7, title: "Hi" }
        }));
        expect(events).toEqual([{
            schema: "public", table: "posts", op: "UPDATE", row: { id: 7, title: "Hi" }, truncated: false
        }]);
    });

    it("parses a delete payload (row is the OLD tuple)", () => {
        const [event] = parseCdcPayload(JSON.stringify({
            schema: "public", table: "posts", op: "DELETE", row: { id: 7 }
        })) ?? [];
        expect(event?.op).toBe("DELETE");
        expect(event?.row).toEqual({ id: 7 });
    });

    it("flags a truncated (oversized) payload", () => {
        const [event] = parseCdcPayload(JSON.stringify({
            schema: "public", table: "posts", op: "INSERT", row: { id: 7 }, truncated: true
        })) ?? [];
        expect(event?.truncated).toBe(true);
    });

    it("reads a statement's batch as one change per key", () => {
        expect(parseCdcPayload(JSON.stringify({
            schema: "public", table: "posts", op: "UPDATE", cols: ["id"], keys: [1, 2, "x"]
        }))?.map((e) => e.row)).toEqual([{ id: 1 }, { id: 2 }, { id: "x" }]);
        expect(parseCdcPayload(JSON.stringify({
            schema: "public", table: "posts_tags", op: "DELETE", cols: ["post_id", "tag_id"], keys: [[1, 2], [1, 3]]
        }))).toEqual([
            { schema: "public", table: "posts_tags", op: "DELETE", row: { post_id: 1, tag_id: 2 }, truncated: false },
            { schema: "public", table: "posts_tags", op: "DELETE", row: { post_id: 1, tag_id: 3 }, truncated: false }
        ]);
    });

    it("reads a TRUNCATE as a change to every row", () => {
        expect(parseCdcPayload(JSON.stringify({ schema: "public", table: "posts", op: "TRUNCATE" })))
            .toEqual([{ schema: "public", table: "posts", op: "TRUNCATE", row: {}, truncated: false }]);
    });

    it("returns null for malformed JSON, missing fields, an unknown op or a malformed batch", () => {
        expect(parseCdcPayload("not json")).toBeNull();
        expect(parseCdcPayload(JSON.stringify({ table: "posts", op: "UPDATE" }))).toBeNull();
        expect(parseCdcPayload(JSON.stringify({ schema: "public", table: "posts", op: "MERGE" }))).toBeNull();
        expect(parseCdcPayload(JSON.stringify([1, 2, 3]))).toBeNull();
        expect(parseCdcPayload(JSON.stringify({ schema: "public", table: "t", op: "UPDATE", keys: [1] }))).toBeNull();
        expect(parseCdcPayload(JSON.stringify({ schema: "public", table: "t", op: "UPDATE", cols: ["a", "b"], keys: [[1]] }))).toBeNull();
    });
});

describe("refreshInstalledCdcFunction", () => {
    it("rewrites nothing when the installed functions are current", async () => {
        const calls: string[] = [];
        const run = async (text: string): Promise<Record<string, unknown>[]> => {
            calls.push(text);
            return [{ installed: true, statement_installed: true, row_function_current: true, statement_code_current: true, compat_until: "-infinity" }];
        };
        expect(await refreshInstalledCdcFunction(run)).toBe(true);
        expect(calls).toHaveLength(1);
    });

    it("replaces only the functions that are installed, keeping the statement function's window", async () => {
        const calls: string[] = [];
        const run = async (text: string): Promise<Record<string, unknown>[]> => {
            calls.push(text);
            return calls.length === 1 ? [{ installed: false, statement_installed: true, compat_until: "2026-10-08T06:00:00.000Z" }] : [];
        };
        expect(await refreshInstalledCdcFunction(run)).toBe(true);
        expect(calls[1]).toContain(`CREATE OR REPLACE FUNCTION ${CDC_STATEMENT_FUNCTION}()`);
        expect(calls[1]).not.toContain(`CREATE OR REPLACE FUNCTION ${CDC_TRIGGER_FUNCTION}()`);
        expect(calls[1]).toContain("compat_until CONSTANT timestamptz := '2026-10-08T06:00:00.000Z';");
    });

    it("installs nothing where nothing is installed", async () => {
        const calls: string[] = [];
        const run = async (text: string): Promise<Record<string, unknown>[]> => {
            calls.push(text);
            return [{ installed: false, statement_installed: false, compat_until: null }];
        };
        expect(await refreshInstalledCdcFunction(run)).toBe(false);
        expect(calls).toHaveLength(1);
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
