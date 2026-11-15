/**
 * `REALTIME_CDC=auto` streams from the WAL where it can, and a WAL-streaming
 * process takes the capture triggers off — but only once nobody else is still
 * hearing changes through them. A replica that fell back to trigger capture,
 * or an older version mid-rollout, would otherwise go deaf to every write made
 * elsewhere.
 */
import { PGlite } from "@electric-sql/pglite";

import {
    countTriggerCaptureConsumers,
    isTriggerCaptureConsumer,
    realtimeListenerApplicationName,
    retireTriggerCaptureIfUnused,
    type ListenerSession
} from "../src/services/cdc/capture-consumers";
import { buildCdcFunctionSql, buildCdcTriggerSql } from "../src/services/cdc/trigger-cdc";
import { walFallbackNotice } from "../src/services/cdc/wal-cdc";

const OWN = "rebase-realtime:inst_aaaaaaaa";
const session = (applicationName: string | null, backendType: string | null = "client backend"): ListenerSession =>
    ({ applicationName, backendType });

describe("who may depend on the capture triggers", () => {
    it("counts another instance's trigger LISTEN", () => {
        expect(isTriggerCaptureConsumer(session("rebase-realtime:inst_bbbbbbbb:cdc"), OWN)).toBe(true);
    });

    it("counts an older version's connection, which does not say what it is for", () => {
        expect(isTriggerCaptureConsumer(session("rebase-realtime:inst_bbbbbbbb"), OWN)).toBe(true);
    });

    it("does not count the legacy entity channel or a WAL stream", () => {
        expect(isTriggerCaptureConsumer(session("rebase-realtime:inst_bbbbbbbb:entity"), OWN)).toBe(false);
        expect(isTriggerCaptureConsumer(session("rebase-realtime:inst_bbbbbbbb:wal"), OWN)).toBe(false);
        // An older version's WAL stream carries the bare name; the backend type gives it away.
        expect(isTriggerCaptureConsumer(session("rebase-realtime:inst_bbbbbbbb", "walsender"), OWN)).toBe(false);
    });

    it("never counts this instance's own connections", () => {
        expect(isTriggerCaptureConsumer(session(realtimeListenerApplicationName(OWN, "cdc")), OWN)).toBe(false);
        expect(isTriggerCaptureConsumer(session(OWN), OWN)).toBe(false);
    });

    it("ignores sessions that are not realtime connections", () => {
        expect(isTriggerCaptureConsumer(session("psql"), OWN)).toBe(false);
        expect(isTriggerCaptureConsumer(session(null), OWN)).toBe(false);
        expect(isTriggerCaptureConsumer(session(""), OWN)).toBe(false);
    });

    it("counts a role it does not know, since it may be listening", () => {
        expect(isTriggerCaptureConsumer(session("rebase-realtime:inst_bbbbbbbb:presence"), OWN)).toBe(true);
    });

    it("reads the sessions from pg_stat_activity and keeps only the consumers", async () => {
        const run = async () => [
            { application_name: "rebase-realtime:inst_bbbbbbbb:cdc", backend_type: "client backend" },
            { application_name: "rebase-realtime:inst_cccccccc:wal", backend_type: "walsender" },
            { application_name: `${OWN}:entity`, backend_type: "client backend" }
        ];
        expect(await countTriggerCaptureConsumers(run, OWN)).toBe(1);
    });

    it("answers undefined when the question cannot be asked", async () => {
        const run = async (): Promise<Record<string, unknown>[]> => { throw new Error("permission denied"); };
        expect(await countTriggerCaptureConsumers(run, OWN)).toBeUndefined();
    });
});

describe("retiring the capture triggers from a WAL-streaming process", () => {
    let db: PGlite;
    const exec = async (text: string) => {
        const results = await db.exec(text);
        return (results[results.length - 1]?.rows ?? []) as Record<string, unknown>[];
    };
    const captureTriggers = async (): Promise<number> => {
        const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_trigger WHERE tgname LIKE 'rebase_cdc%'");
        return rows[0].n;
    };
    /** Real catalogue reads and DDL; pg_stat_activity answered with `sessions`. */
    const runWith = (sessions: Array<{ application_name: string; backend_type: string }>) =>
        async (text: string) => text.includes("pg_stat_activity") ? sessions : exec(text);

    beforeEach(async () => {
        db = new PGlite();
        await db.waitReady;
        await db.exec(buildCdcFunctionSql());
        await db.exec("CREATE TABLE public.posts (id int PRIMARY KEY, title text);");
        await db.exec(buildCdcTriggerSql("public", "posts", ["id"], "statement"));
    });

    afterEach(async () => {
        await db.close();
    });

    it("takes them off when nobody else listens on them", async () => {
        const before = await captureTriggers();
        expect(before).toBeGreaterThan(0);
        expect(await retireTriggerCaptureIfUnused(runWith([]), OWN)).toEqual({ removed: before });
        expect(await captureTriggers()).toBe(0);
    });

    it("keeps them while another instance listens on them", async () => {
        const before = await captureTriggers();
        const run = runWith([{ application_name: "rebase-realtime:inst_bbbbbbbb:cdc", backend_type: "client backend" }]);
        expect(await retireTriggerCaptureIfUnused(run, OWN)).toEqual({ kept: true, consumers: 1 });
        expect(await captureTriggers()).toBe(before);
    });

    it("keeps them when it cannot tell", async () => {
        const before = await captureTriggers();
        const run = async (text: string) => {
            if (text.includes("pg_stat_activity")) throw new Error("permission denied");
            return exec(text);
        };
        expect(await retireTriggerCaptureIfUnused(run, OWN)).toEqual({ kept: true, consumers: undefined });
        expect(await captureTriggers()).toBe(before);
    });

    it("asks pg_stat_activity in a form Postgres accepts", async () => {
        // PGlite has no other sessions, so the real query answers zero consumers.
        expect(await countTriggerCaptureConsumers(exec, OWN)).toBe(0);
    });
});

describe("falling back from the WAL", () => {
    it("is a warning when REALTIME_CDC=wal asked for it", () => {
        expect(walFallbackNotice("wal").level).toBe("warn");
    });

    it("is an info line under the default, where most databases cannot stream", () => {
        const notice = walFallbackNotice("auto");
        expect(notice.level).toBe("info");
        expect(notice.message).toContain("REALTIME_CDC=auto");
    });
});
