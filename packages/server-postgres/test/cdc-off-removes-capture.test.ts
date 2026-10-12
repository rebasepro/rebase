/**
 * `REALTIME_CDC=off` takes the change-capture triggers off the tables.
 *
 * Capture used to stay attached when it was switched off: every write to every
 * instrumented table kept running the trigger and sending a notification on a
 * channel nothing listened to (calls 2026-10-12, S3). Nothing else depends on
 * them once capture is off — a process without capture announces its own
 * writes on the cross-instance channel (33ebb79dc), triggers or not.
 *
 * Real triggers on PGlite: attached the way a boot with capture on attaches
 * them, then settled the way a boot with capture off does.
 */
import { PGlite } from "@electric-sql/pglite";

import {
    buildCdcFunctionSql,
    buildCdcTriggerSql,
    settleInstalledCapture,
    CDC_CHANNEL
} from "../src/services/cdc/trigger-cdc";

describe("a boot with change capture off", () => {
    let db: PGlite;
    let payloads: string[];
    const run = async (text: string) => {
        const results = await db.exec(text);
        return (results[results.length - 1]?.rows ?? []) as Record<string, unknown>[];
    };

    const captureTriggers = async (): Promise<string[]> => {
        const { rows } = await db.query<{ name: string }>(
            "SELECT tgrelid::regclass::text || '.' || tgname AS name FROM pg_trigger WHERE tgname LIKE 'rebase_cdc%' ORDER BY 1"
        );
        return rows.map(r => r.name);
    };
    const captureFunctions = async (): Promise<number> => {
        const { rows } = await db.query<{ n: number }>(
            "SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace " +
            "WHERE n.nspname = 'rebase' AND p.proname LIKE 'rebase_cdc_notify%'"
        );
        return rows[0].n;
    };

    beforeEach(async () => {
        db = new PGlite();
        await db.waitReady;
        await db.exec(buildCdcFunctionSql());
        await db.exec("CREATE TABLE public.posts (id int PRIMARY KEY, title text);");
        await db.exec("CREATE TABLE public.legacy (id int PRIMARY KEY, title text);");
        await db.exec(buildCdcTriggerSql("public", "posts", ["id"], "statement"));
        // A table an older version attached at the row level.
        await db.exec(buildCdcTriggerSql("public", "legacy", ["id"], "row"));
        payloads = [];
        await db.listen(CDC_CHANNEL, payload => { payloads.push(payload); });
    });

    afterEach(async () => {
        await db.close();
    });

    it("detaches every capture trigger and drops the functions, and says how many", async () => {
        expect(await captureTriggers()).toHaveLength(5);

        const settled = await settleInstalledCapture(run, { capture: "off" });

        expect(settled).toEqual({ removed: 5 });
        expect(await captureTriggers()).toEqual([]);
        expect(await captureFunctions()).toBe(0);

        // A write no longer announces itself, and is not refused for it.
        await db.exec("INSERT INTO public.posts VALUES (1, 'a'); INSERT INTO public.legacy VALUES (1, 'b');");
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(payloads).toEqual([]);
    });

    it("does nothing on a database that never had capture", async () => {
        await db.exec("DROP FUNCTION rebase.rebase_cdc_notify() CASCADE; DROP FUNCTION rebase.rebase_cdc_notify_statement() CASCADE;");
        expect(await settleInstalledCapture(run, { capture: "off" })).toEqual({ removed: 0 });
    });

    it("leaves the triggers attached when capture is merely not provisioned this boot", async () => {
        // No direct URL to LISTEN on, say: capture is still wanted, so the
        // functions are refreshed and nothing is detached.
        expect(await settleInstalledCapture(run, { capture: "not-provisioned" })).toEqual({ refreshed: true });
        expect(await captureTriggers()).toHaveLength(5);
    });
});
