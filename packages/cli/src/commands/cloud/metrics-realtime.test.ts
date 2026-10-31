/**
 * `rebase cloud metrics` shows what each instance's realtime side is carrying,
 * and stays useful when it can't be asked: the CPU and memory beside it come
 * from a different read.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as context from "./context";
import { setJsonModeForTest } from "./context";

vi.mock("./context", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./context")>();
    return {
        ...actual,
        requireClient: vi.fn(),
        requireProject: vi.fn(async () => "proj_1"),
        displayProjectRef: vi.fn(() => "proj-one")
    };
});

const { metricsCommand, realtimeTable } = await import("./resources");

const realtime = {
    instances: [
        { name: "rebase-backend-a", realtime: { sockets: 12, channels: 3, busFramesPublished: 40, busFramesSkipped: 900 } },
        { name: "rebase-backend-b", realtime: null }
    ]
};

function useControlPlane(answer: (path: string | undefined) => Promise<unknown>): ReturnType<typeof vi.fn> {
    const invoke = vi.fn(async (_name: string, _body: unknown, opts?: { path?: string }) => answer(opts?.path));
    vi.mocked(context.requireClient).mockResolvedValue({ client: { functions: { invoke } }, url: "https://cp.example" } as never);
    return invoke;
}

async function jsonOutput(run: () => Promise<void>): Promise<Record<string, unknown>> {
    const chunks: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => { chunks.push(String(chunk)); return true; }) as typeof process.stdout.write;
    try {
        await run();
    } finally {
        process.stdout.write = write;
    }
    return JSON.parse(chunks.join("").trim());
}

beforeEach(() => setJsonModeForTest(true));
afterEach(() => setJsonModeForTest(false));

describe("rebase cloud metrics, realtime", () => {
    it("asks the control plane for each instance's counts and passes them through in --json", async () => {
        const invoke = useControlPlane(async (path) => (path === "proj_1/realtime" ? realtime : { status: "running" }));

        const output = await jsonOutput(() => metricsCommand(["node", "rebase", "cloud", "metrics", "--json"]));

        expect(invoke).toHaveBeenCalledWith("metrics", undefined, { method: "GET", path: "proj_1/realtime" });
        expect(output.status).toBe("running");
        expect(output.realtime).toEqual(realtime.instances);
    });

    it("still answers when the realtime read fails, as an older control plane's would", async () => {
        useControlPlane(async (path) => {
            if (path === "proj_1/realtime") throw new Error("404");
            return { status: "running" };
        });

        const output = await jsonOutput(() => metricsCommand(["node", "rebase", "cloud", "metrics", "--json"]));

        expect(output.status).toBe("running");
        expect(output.realtime).toBeNull();
    });

    it("prints a row per instance, with a dash for one that didn't report", () => {
        const [header, reporting, silent] = realtimeTable(realtime.instances);

        expect(header).toMatch(/sockets\s+channels\s+to bus\s+skipped$/);
        expect(reporting).toMatch(/^rebase-backend-a\s+12\s+3\s+40\s+900$/);
        expect(silent).toMatch(/^rebase-backend-b\s+—\s+—\s+—\s+—$/);
    });
});
