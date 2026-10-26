/**
 * `rebase cloud service-key [rotate]`: reading the service key's state and
 * rotating it. Pinned: the status read never carries the key; `rotate` asks
 * first (refused without `--yes` where it cannot ask) and calls the rotate
 * route once; `--json` is the control plane's answer; an unknown action is
 * refused before any call; it is a signed-in person's act.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setJsonModeForTest } from "./context";

vi.mock("./context", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./context")>();
    return {
        ...actual,
        requireSessionClient: vi.fn(),
        requireProject: vi.fn(async () => "p1")
    };
});

import * as context from "./context";
import { serviceKeyCommand } from "./service-key";

const STATUS = { generation: 2, liveGeneration: 1, rotatedAt: "2026-10-25T10:00:00.000Z", pending: true };
const ROTATION = { generation: 3, state: "restarting" };

function argv(...words: string[]): string[] {
    return ["/usr/bin/node", "/x/y/rebase.js", "cloud", ...words];
}

const invoke = vi.fn(async (_name: string, _body: unknown, opts?: { method?: string; path?: string }) => {
    if (opts?.path === "p1/service-key/rotate") return ROTATION;
    if (opts?.path === "p1/service-key") return STATUS;
    throw new Error(`unexpected call ${opts?.path}`);
});

async function stdoutOf(run: () => Promise<unknown>): Promise<{ out: string; exited: boolean }> {
    const chunks: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string) => {
        chunks.push(typeof s === "string" ? s : String(s));
        return true;
    };
    const exit = vi.spyOn(process, "exit").mockImplementation(((): never => {
        throw new Error("__exit__");
    }) as never);
    let exited = false;
    try {
        await run();
    } catch (e) {
        if (!(e instanceof Error && e.message === "__exit__")) throw e;
        exited = true;
    } finally {
        process.stdout.write = orig;
        exit.mockRestore();
    }
    return { out: chunks.join(""), exited };
}

beforeEach(() => {
    setJsonModeForTest(true);
    (context.requireSessionClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        client: { functions: { invoke } },
        url: "https://cp.example"
    });
});
afterEach(() => {
    setJsonModeForTest(false);
    vi.clearAllMocks();
});

describe("rebase cloud service-key", () => {
    it("reads the state, which never carries the key", async () => {
        const { out, exited } = await stdoutOf(() => serviceKeyCommand(argv("service-key", "--json")));
        expect(exited).toBe(false);
        expect(JSON.parse(out)).toEqual(STATUS);
        expect(out).not.toMatch(/rsk_/);
        expect(invoke).toHaveBeenCalledWith("credentials", undefined, { method: "GET", path: "p1/service-key" });
        expect(context.requireSessionClient).toHaveBeenCalledWith(expect.any(Array), "rotate a project's service key");
    });

    it("refuses to rotate without --yes where it cannot ask, and calls nothing", async () => {
        const { out, exited } = await stdoutOf(() => serviceKeyCommand(argv("service-key", "rotate", "--json")));
        expect(exited).toBe(true);
        expect(JSON.parse(out).error.code).toBe("confirmation_required");
        expect(invoke).not.toHaveBeenCalled();
    });

    it("rotates once with --yes, answering the control plane's rotation", async () => {
        const { out, exited } = await stdoutOf(() => serviceKeyCommand(argv("service-key", "rotate", "--yes", "--json")));
        expect(exited).toBe(false);
        expect(JSON.parse(out)).toEqual(ROTATION);
        expect(invoke).toHaveBeenCalledTimes(1);
        expect(invoke).toHaveBeenCalledWith("credentials", {}, { path: "p1/service-key/rotate" });
    });

    it("refuses an unknown action before any call", async () => {
        const { out, exited } = await stdoutOf(() => serviceKeyCommand(argv("service-key", "reveal", "--json")));
        expect(exited).toBe(true);
        expect(JSON.parse(out).error.code).toBe("unknown_command");
        expect(context.requireSessionClient).not.toHaveBeenCalled();
    });
});
