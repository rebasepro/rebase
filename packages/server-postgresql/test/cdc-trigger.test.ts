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

describe("provisionTriggerCdc", () => {
    it("installs the function once and one trigger per unique table", async () => {
        const calls: string[] = [];
        const run = jest.fn(async (text: string) => { calls.push(text); return []; });

        const tables: CdcTableRef[] = [
            { schema: "public", table: "posts" },
            { schema: "public", table: "authors" },
            { schema: "public", table: "posts" } // duplicate — should be de-duped
        ];

        const result = await provisionTriggerCdc(run, tables);

        // 1 function + 2 unique triggers
        expect(run).toHaveBeenCalledTimes(3);
        expect(calls[0]).toContain("CREATE OR REPLACE FUNCTION");
        expect(result.installed).toHaveLength(2);
        expect(result.skipped).toHaveLength(0);
        expect(calls.filter((c) => c.includes("CREATE TRIGGER"))).toHaveLength(2);
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
