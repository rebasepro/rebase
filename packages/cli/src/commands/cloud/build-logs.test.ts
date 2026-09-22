/**
 * Following a deployment's build log.
 *
 * The control plane proves a build is alive by rewriting a heartbeat line at
 * the END of the `logs` column every 30 seconds (`heartbeatSuffix` in the
 * control plane's `functions/deploy.ts`), and drops it on the terminal write.
 * The follower read that column as append-only — print `logs.slice(printed)`,
 * remember `logs.length` — so every new chunk lost its first ~70 characters to
 * the heartbeat that had been there, and heartbeat fragments were printed in
 * their place. A failed managed deploy printed the second half of its reason.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./context", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./context")>();
    return {
        ...actual,
        requireClient: vi.fn(),
        resolveProjectRef: vi.fn(async () => "proj_1")
    };
});

import * as context from "./context";
import { BUILD_HEARTBEAT_MARKER, logsCommand, nextLogChunk, withoutHeartbeat } from "./deploy";

/** The control plane's heartbeat suffix, byte for byte. */
const beat = (at: string): string => `\n${BUILD_HEARTBEAT_MARKER}${at}\n`;

/** The control plane's own `stripHeartbeat`, which the reaper and a cancel apply to the row. */
const controlPlaneStrip = (logs: string): string => {
    const i = logs.lastIndexOf(`\n${BUILD_HEARTBEAT_MARKER}`);
    return i < 0 ? logs : logs.slice(0, i + 1);
};

/** Everything a follower prints, reading these rows in turn. */
function follow(rows: string[]): string {
    let printed = "";
    let out = "";
    for (const row of rows) {
        const next = nextLogChunk(printed, row);
        out += next.chunk;
        printed = next.printed;
    }
    return out;
}

const L1 = "[10:00:00] 📦 Managed deploy — runtime 1.22.0\n";
const L2 = "[10:00:05] Applying the runtime to the tenant namespace...\n";
const FAILED = "\n❌ Deployment Failed: the bundle's @rebasepro/server-postgres@0.19.0 is below this "
    + "runtime's floor 0.21.0 — run `rebase upgrade`.\n";

describe("nextLogChunk", () => {
    it("prints the whole log once, with no heartbeat, however often the heartbeat is rewritten", () => {
        const out = follow([
            L1 + beat("2026-09-23T10:00:00.000Z"),
            L1 + beat("2026-09-23T10:00:30.000Z"),
            L1 + L2 + beat("2026-09-23T10:01:00.000Z"),
            // The terminal write: the log without the marker, plus the reason.
            L1 + L2 + FAILED
        ]);

        expect(out).toBe(L1 + L2 + FAILED);
    });

    it("prints a reaped build's last line, written over the control plane's own strip", () => {
        const row = L1 + beat("2026-09-23T10:00:00.000Z");
        const interrupted = "❌ Deployment Failed: the control plane restarted while this build was running.";

        const out = follow([row, `${controlPlaneStrip(row)}\n${interrupted}\n`]);

        expect(out).toBe(`${L1}\n\n${interrupted}\n`);
    });

    it("starts again, on a line of its own, when the log is replaced rather than extended", () => {
        // A static deploy that fails writes a log of one line in place of its first.
        const started = "[10:00:00] 🌐 Static deploy — publishing frontend/dist as \"web\"\n";
        const failed = "[10:00:02] ❌ Static deploy failed: the output directory is empty\n";

        expect(follow([started, failed])).toBe(started + failed);
        expect(follow(["[10:00:00] building", "[10:00:00] failed\n"])).toBe("[10:00:00] building\n[10:00:00] failed\n");
    });

    it("prints nothing new while nothing but the heartbeat changes", () => {
        const first = nextLogChunk("", L1 + beat("2026-09-23T10:00:00.000Z"));
        expect(nextLogChunk(first.printed, L1 + beat("2026-09-23T10:00:30.000Z")).chunk).toBe("");
    });
});

describe("withoutHeartbeat", () => {
    it("drops the trailing heartbeat line and nothing else", () => {
        expect(withoutHeartbeat(L1 + beat("2026-09-23T10:00:00.000Z"))).toBe(L1);
        expect(withoutHeartbeat(L1)).toBe(L1);
        expect(withoutHeartbeat("")).toBe("");
    });

    it("keeps a line quoting the marker in the middle of the log", () => {
        const quoted = `${L1}\n${BUILD_HEARTBEAT_MARKER}is what the control plane writes\n${L2}`;
        expect(withoutHeartbeat(quoted)).toBe(quoted);
    });
});

class Exited extends Error {
    constructor(readonly code: number) {
        super(`process.exit(${code})`);
    }
}

describe("rebase cloud logs --follow", () => {
    let written: string[];

    beforeEach(() => {
        vi.useFakeTimers();
        written = [];
        vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
            written.push(String(chunk));
            return true;
        }) as typeof process.stdout.write);
        vi.spyOn(console, "log").mockImplementation(() => undefined);
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
            throw new Exited(code ?? 0);
        }) as never);
        context.setJsonModeForTest(false);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("streams the log as the control plane writes it, heartbeat and all", async () => {
        const rows = [
            { id: "d1", status: "deploying", logs: L1 + beat("2026-09-23T10:00:00.000Z") },
            { id: "d1", status: "deploying", logs: L1 + L2 + beat("2026-09-23T10:00:30.000Z") },
            { id: "d1", status: "failed", logs: L1 + L2 + FAILED }
        ];
        let read = 0;
        (context.requireClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
            client: {
                data: {
                    collection: () => ({
                        find: async () => ({ data: [rows[0]] }),
                        findById: async () => rows[Math.min(read++, rows.length - 1)]
                    })
                }
            },
            url: "https://cp.example"
        });

        const done = logsCommand(["node", "rebase", "cloud", "logs", "--follow"], "shop").catch((e: unknown) => e);
        await vi.advanceTimersByTimeAsync(10_000);

        expect(await done).toMatchObject({ code: 1 });
        expect(written.join("")).toBe(L1 + L2 + FAILED);
    });
});
