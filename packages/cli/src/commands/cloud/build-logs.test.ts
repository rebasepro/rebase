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

/**
 * `rebase cloud logs --json` printed the human page (emoji header, raw log),
 * so `rebase cloud logs --json | jq` failed on every run, and piping the
 * command at all turns JSON mode on.
 */
describe("rebase cloud logs in JSON mode", () => {
    let stdout: string[];

    function client(rows: Array<Record<string, unknown>>, runtime?: { logs?: string }): void {
        let read = 0;
        (context.requireClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
            client: {
                data: {
                    collection: () => ({
                        find: async () => ({ data: rows.slice(0, 1) }),
                        findById: async () => rows[Math.min(read++, rows.length - 1)]
                    })
                },
                functions: { invoke: vi.fn(async () => runtime ?? {}) }
            },
            url: "https://cp.example"
        });
    }

    /** Everything written to stdout, as the one JSON value it has to be. */
    const result = (): unknown => JSON.parse(stdout.join(""));

    beforeEach(() => {
        vi.useFakeTimers();
        stdout = [];
        vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
            stdout.push(String(chunk));
            return true;
        }) as typeof process.stdout.write);
        vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
            stdout.push(`${args.map(String).join(" ")}\n`);
        });
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
            throw new Exited(code ?? 0);
        }) as never);
        context.setJsonModeForTest(true);
    });

    afterEach(() => {
        context.setJsonModeForTest(false);
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("prints the latest deployment's log as one object", async () => {
        client([{ id: "d1", status: "failed", logs: L1 + L2 + FAILED }]);

        await logsCommand(["node", "rebase", "cloud", "logs", "--json"], "shop");

        expect(result()).toEqual({ deploymentId: "d1", status: "failed", logs: L1 + L2 + FAILED });
    });

    it("leaves the heartbeat out of a build still running", async () => {
        client([{ id: "d1", status: "deploying", logs: L1 + beat("2026-09-23T10:00:00.000Z") }]);

        await logsCommand(["node", "rebase", "cloud", "logs", "--json"], "shop");

        expect(result()).toEqual({ deploymentId: "d1", status: "deploying", logs: L1 });
    });

    it("follows a running build and prints the finished one", async () => {
        client([
            { id: "d1", status: "deploying", logs: L1 + beat("2026-09-23T10:00:00.000Z") },
            { id: "d1", status: "success", logs: `${L1 + L2}\n🎉 Managed deploy complete.\n` }
        ]);

        const done = logsCommand(["node", "rebase", "cloud", "logs", "--json", "--follow"], "shop");
        await vi.advanceTimersByTimeAsync(5_000);
        await done;

        expect(result()).toEqual({
            deploymentId: "d1",
            status: "success",
            logs: `${L1 + L2}\n🎉 Managed deploy complete.\n`
        });
    });

    it("says there is no deployment yet", async () => {
        client([]);

        await logsCommand(["node", "rebase", "cloud", "logs", "--json"], "shop");

        expect(result()).toEqual({ deploymentId: null, status: null, logs: null });
    });

    it("prints the runtime log as one object", async () => {
        client([], { logs: "GET /api/health 200\n" });

        await logsCommand(["node", "rebase", "cloud", "logs", "--json", "--runtime"], "shop");

        expect(result()).toEqual({ runtime: true, logs: "GET /api/health 200\n" });
    });
});

/**
 * A follow polls every 1.5 seconds for up to fifteen minutes, and a control
 * plane rolling out answers a request or two with a 502 on the way. One failed
 * read ended the follow with exit 1 while the deployment carried on and
 * succeeded — and a deploy's exit code is documented as the deploy's verdict.
 */
describe("a follow that cannot read the status for a moment", () => {
    let stdout: string[];

    /** A client whose status reads answer, in turn, with these — an Error is thrown. */
    function reads(answers: Array<Record<string, unknown> | Error>): ReturnType<typeof vi.fn> {
        let read = 0;
        const findById = vi.fn(async () => {
            const answer = answers[Math.min(read++, answers.length - 1)];
            if (answer instanceof Error) throw answer;
            return answer;
        });
        (context.requireClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
            client: {
                data: { collection: () => ({ find: async () => ({ data: [{ id: "d1", status: "deploying", logs: L1 }] }), findById }) }
            },
            url: "https://cp.example"
        });
        return findById;
    }

    const status = (code: number | undefined) => Object.assign(new Error(`HTTP ${code}`), code === undefined ? {} : { status: code });

    beforeEach(() => {
        vi.useFakeTimers();
        stdout = [];
        vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
            stdout.push(String(chunk));
            return true;
        }) as typeof process.stdout.write);
        vi.spyOn(console, "log").mockImplementation(() => undefined);
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
            throw new Exited(code ?? 0);
        }) as never);
        context.setJsonModeForTest(true);
    });

    afterEach(() => {
        context.setJsonModeForTest(false);
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("keeps following through a 502 and a dropped connection, and reports the build's own verdict", async () => {
        reads([
            status(502),
            status(undefined),
            { id: "d1", status: "success", logs: L1 + L2 }
        ]);

        const done = logsCommand(["node", "rebase", "cloud", "logs", "--json", "--follow"], "shop");
        await vi.advanceTimersByTimeAsync(10_000);
        await done;

        expect(JSON.parse(stdout.join(""))).toEqual({ deploymentId: "d1", status: "success", logs: L1 + L2 });
    });

    it("stops on a refusal that another read will not change", async () => {
        const findById = reads([status(403), { id: "d1", status: "success", logs: L1 }]);

        const done = logsCommand(["node", "rebase", "cloud", "logs", "--json", "--follow"], "shop").catch((e: unknown) => e);
        await vi.advanceTimersByTimeAsync(10_000);

        expect(await done).toMatchObject({ code: 1 });
        expect(findById).toHaveBeenCalledTimes(1);
    });

    it("gives up when the status stays unreadable, saying the build may still be running", async () => {
        reads([status(503)]);

        const done = logsCommand(["node", "rebase", "cloud", "logs", "--json", "--follow"], "shop").catch((e: unknown) => e);
        await vi.advanceTimersByTimeAsync(5 * 60_000);

        expect(await done).toMatchObject({ code: 1 });
        // The first value: with `process.exit` stood in, the command's own
        // catch reports the stand-in's throw as well.
        expect(JSON.parse(stdout[0])).toMatchObject({
            error: { code: "status_unreadable", hint: expect.stringContaining("may still be running") }
        });
    });
});
