import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
/**
 * The scheduled RLS audit.
 *
 * The checker itself is already tested in its own package; nothing here
 * re-tests a check. What is new, and what these cover, is everything around it:
 * that it runs on a timer, that a failed scan is reported rather than thrown,
 * that a run says something worth noticing at a level worth noticing it at, and
 * that it refuses clearly when it is missing what it needs.
 *
 * A scan that fails must not take the process down. Turning a security *check*
 * into an availability risk is a bad trade in both directions — the check is
 * there to reduce risk, not to add a new way for the server to die.
 */
import {
    createRlsAudit,
    summarize,
    type RlsScanResult,
    type RlsScanner
} from "../src/rls-audit";

const result = (over: Partial<RlsScanResult> = {}): RlsScanResult => ({
    scannedAt: "2026-08-22T02:00:00.000Z",
    database: { host: "db.internal", name: "app" },
    stats: { schemas: 1, tables: 12, policies: 20, tablesWithoutRls: 0, checksRun: 14 },
    findings: [],
    ...over
});

const finding = (severity: RlsScanResult["findings"][number]["severity"], id = "rls-disabled") => ({
    id,
    severity,
    title: `${id} on public.things`,
    target: { schema: "public", table: "things" }
});

describe("summarize", () => {
    it("reports a clean database at info, with what was actually checked", () => {
        const { level, message } = summarize(result(), "high");
        expect(level).toBe("info");
        expect(message).toContain("clean");
        expect(message).toContain("12 table(s)");
        expect(message).toContain("14 check(s)");
    });

    it("warns when the worst finding reaches the threshold", () => {
        const { level } = summarize(result({ findings: [finding("high")] }), "high");
        expect(level).toBe("warn");
    });

    it("stays at info when everything is below the threshold", () => {
        const { level } = summarize(result({ findings: [finding("low"), finding("medium")] }), "high");
        expect(level).toBe("info");
    });

    it("warns on anything above the threshold, not only at it", () => {
        expect(summarize(result({ findings: [finding("critical")] }), "high").level).toBe("warn");
    });

    it("counts by severity, worst first — the order it gets read in", () => {
        const findings = [finding("low"), finding("critical"), finding("low"), finding("medium")];
        const { message } = summarize(result({ findings }), "high");
        expect(message).toContain("4 issue(s)");
        expect(message.indexOf("1 critical")).toBeLessThan(message.indexOf("1 medium"));
        expect(message.indexOf("1 medium")).toBeLessThan(message.indexOf("2 low"));
    });

    it("says where to read the detail", () => {
        const { message } = summarize(result({ findings: [finding("high")] }), "high");
        expect(message).toContain("/api/admin/rls-audit");
    });

    it("does not fall over on a severity it has never heard of", () => {
        const odd = { ...finding("high"), severity: "spicy" as never };
        expect(() => summarize(result({ findings: [odd] }), "high")).not.toThrow();
    });
});

describe("createRlsAudit", () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    const scanner = (r: RlsScanResult = result()): jest.MockedFunction<RlsScanner> =>
        jest.fn(async () => r) as unknown as jest.MockedFunction<RlsScanner>;

    it("does nothing at all when disabled", () => {
        const scan = scanner();
        const audit = createRlsAudit({ scan, connectionString: "postgres://x/y" });
        audit.start();
        jest.advanceTimersByTime(48 * 60 * 60 * 1000);
        expect(scan).not.toHaveBeenCalled();
        expect(audit.status().enabled).toBe(false);
    });

    it("runs once on boot and then on the interval", async () => {
        const scan = scanner();
        const audit = createRlsAudit({
            enabled: true, scan, connectionString: "postgres://x/y", intervalMs: 1000
        });
        audit.start();
        await Promise.resolve();
        expect(scan).toHaveBeenCalledTimes(1);

        jest.advanceTimersByTime(3000);
        expect(scan).toHaveBeenCalledTimes(4);
        audit.stop();
    });

    it("skips the boot run when asked", async () => {
        const scan = scanner();
        const audit = createRlsAudit({
            enabled: true, scan, connectionString: "postgres://x/y", runOnBoot: false, intervalMs: 1000
        });
        audit.start();
        await Promise.resolve();
        expect(scan).not.toHaveBeenCalled();

        jest.advanceTimersByTime(1000);
        expect(scan).toHaveBeenCalledTimes(1);
        audit.stop();
    });

    it("stops firing after stop()", async () => {
        const scan = scanner();
        const audit = createRlsAudit({
            enabled: true, scan, connectionString: "postgres://x/y", runOnBoot: false, intervalMs: 1000
        });
        audit.start();
        jest.advanceTimersByTime(1000);
        expect(scan).toHaveBeenCalledTimes(1);

        audit.stop();
        jest.advanceTimersByTime(10_000);
        expect(scan).toHaveBeenCalledTimes(1);
    });

    it("starting twice does not double the schedule", async () => {
        const scan = scanner();
        const audit = createRlsAudit({
            enabled: true, scan, connectionString: "postgres://x/y", runOnBoot: false, intervalMs: 1000
        });
        audit.start();
        audit.start();
        jest.advanceTimersByTime(1000);
        expect(scan).toHaveBeenCalledTimes(1);
        audit.stop();
    });

    it("passes the scan its options", async () => {
        const scan = scanner();
        const audit = createRlsAudit({
            enabled: true,
            scan,
            connectionString: "postgres://x/y",
            schemas: ["public", "app"],
            statementTimeoutMs: 5000
        });
        await audit.runNow();
        expect(scan).toHaveBeenCalledWith({
            connectionString: "postgres://x/y",
            schemas: ["public", "app"],
            statementTimeoutMs: 5000
        });
    });

    it("exposes the last result, which carries no credentials", async () => {
        const audit = createRlsAudit({
            enabled: true, scan: scanner(), connectionString: "postgres://u:p@db.internal/app"
        });
        await audit.runNow();

        const status = audit.status();
        expect(status.result?.database).toEqual({ host: "db.internal", name: "app" });
        expect(JSON.stringify(status)).not.toContain("u:p@");
        expect(status.lastRunAt).toBe("2026-08-22T02:00:00.000Z");
    });

    it("reports a failed scan instead of throwing it", async () => {
        const scan = jest.fn(async () => { throw new Error("connection refused"); }) as unknown as RlsScanner;
        const audit = createRlsAudit({ enabled: true, scan, connectionString: "postgres://x/y" });

        await expect(audit.runNow()).resolves.toBeUndefined();
        expect(audit.status().lastError).toContain("connection refused");
    });

    it("keeps scheduling after a failure", async () => {
        let calls = 0;
        const scan = jest.fn(async () => {
            calls++;
            if (calls === 1) throw new Error("transient");
            return result();
        }) as unknown as RlsScanner;

        const audit = createRlsAudit({
            enabled: true, scan, connectionString: "postgres://x/y", runOnBoot: false, intervalMs: 1000
        });
        audit.start();

        jest.advanceTimersByTime(1000);
        await Promise.resolve();
        jest.advanceTimersByTime(1000);
        await Promise.resolve();

        expect(calls).toBe(2);
        audit.stop();
    });

    it("refuses clearly when enabled without a scanner", () => {
        const audit = createRlsAudit({ enabled: true, connectionString: "postgres://x/y" });
        audit.start();
        expect(audit.status().enabled).toBe(false);
        expect(audit.status().reason).toContain("@rebasepro/rls-check");
    });

    it("refuses clearly when enabled without a connection string", () => {
        const previous = process.env.DATABASE_URL;
        delete process.env.DATABASE_URL;
        try {
            const audit = createRlsAudit({ enabled: true, scan: scanner() });
            audit.start();
            expect(audit.status().enabled).toBe(false);
            expect(audit.status().reason).toContain("DATABASE_URL");
        } finally {
            if (previous !== undefined) process.env.DATABASE_URL = previous;
        }
    });

    it("falls back to DATABASE_URL", async () => {
        const previous = process.env.DATABASE_URL;
        process.env.DATABASE_URL = "postgres://from-env/db";
        try {
            const scan = scanner();
            await createRlsAudit({ enabled: true, scan }).runNow();
            expect(scan).toHaveBeenCalledWith(expect.objectContaining({
                connectionString: "postgres://from-env/db"
            }));
        } finally {
            if (previous === undefined) delete process.env.DATABASE_URL;
            else process.env.DATABASE_URL = previous;
        }
    });
});
