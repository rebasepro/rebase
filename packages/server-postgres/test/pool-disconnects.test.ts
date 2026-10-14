/**
 * The server ending a pool's idle connections is one line, not one per
 * connection.
 *
 * Fifteen `rebase db branch create --force` runs beside a running `rebase dev`
 * printed 220 `❌ [ERROR] [pg-pool] Unexpected pool error
 * {"detail":"terminating connection due to administrator command"}` lines: one
 * per idle connection, from every pool. The pool replaces them on the next
 * query, so it is a WARN, said once per burst for the process.
 */
import { DISCONNECT_BURST_MS, reportPoolError, serverEndedConnection } from "../src/pool-disconnects";

const terminated = (): Error => Object.assign(new Error("terminating connection due to administrator command"), { code: "57P01" });

function recorder() {
    const lines: { level: "warn" | "error" | "debug"; message: string }[] = [];
    return {
        lines,
        log: {
            warn: (message: string) => { lines.push({ level: "warn", message }); },
            error: (message: string) => { lines.push({ level: "error", message }); },
            debug: (message: string) => { lines.push({ level: "debug", message }); }
        }
    };
}

/** A clock far from every other test's, so the module's burst never carries over. */
let epoch = 1_000_000_000;
const freshClock = (): number => (epoch += 10 * DISCONNECT_BURST_MS);

describe("serverEndedConnection", () => {
    it.each(["57P01", "57P02", "57P03"])("knows %s", (code) => {
        expect(serverEndedConnection(Object.assign(new Error("x"), { code }))).toBe(true);
    });

    it("knows the sentence without a code", () => {
        expect(serverEndedConnection(new Error("terminating connection due to administrator command"))).toBe(true);
    });

    it("leaves every other failure alone", () => {
        expect(serverEndedConnection(Object.assign(new Error("connection timeout"), { code: "ETIMEDOUT" }))).toBe(false);
        expect(serverEndedConnection(new Error("Connection terminated unexpectedly"))).toBe(false);
    });
});

describe("reportPoolError", () => {
    it("says a burst of disconnects once, at WARN, across every pool", () => {
        const { lines, log } = recorder();
        const start = freshClock();
        for (let index = 0; index < 15; index += 1) {
            reportPoolError(index % 3 === 1 ? "pg-direct-pool" : "pg-pool", terminated(), log, () => start + index * 100);
        }

        expect(lines.filter(line => line.level === "warn")).toHaveLength(1);
        expect(lines.filter(line => line.level === "error")).toHaveLength(0);
        expect(lines[0].message).toBe(
            "[pg-pool] The database ended this server's idle connections " +
            "(terminating connection due to administrator command, 57P01). New ones open on the next query. " +
            "A database restart does this, and so does `rebase db branch create --force`, which closes the database it copies."
        );
        expect(lines.slice(1).every(line => line.level === "debug")).toBe(true);
    });

    it("says a later burst again", () => {
        const { lines, log } = recorder();
        const start = freshClock();
        reportPoolError("pg-pool", terminated(), log, () => start);
        reportPoolError("pg-pool", terminated(), log, () => start + DISCONNECT_BURST_MS - 1);
        reportPoolError("pg-pool", terminated(), log, () => start + DISCONNECT_BURST_MS);

        expect(lines.map(line => line.level)).toEqual(["warn", "debug", "warn"]);
    });

    it("keeps any other pool error an ERROR, every time", () => {
        const { lines, log } = recorder();
        const start = freshClock();
        reportPoolError("pg-pool", new Error("Connection terminated unexpectedly"), log, () => start);
        reportPoolError("pg-pool", new Error("Connection terminated unexpectedly"), log, () => start + 1);

        expect(lines).toEqual([
            { level: "error", message: "[pg-pool] Unexpected pool error" },
            { level: "error", message: "[pg-pool] Unexpected pool error" }
        ]);
    });
});
