/**
 * `rebase cloud compute` prints every dial, as the docs say it does.
 *
 * It printed the CPU, memory, replicas, capacity and the database's dials, and
 * left out the two autoscale ones — the replica ceiling and the CPU target —
 * which `compute set` writes and which decide most of what a busy project
 * costs. A project autoscaling to 16 replicas read as one with a fixed count.
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

const { computeCommand } = await import("./resources");

const project = {
    id: "proj_1",
    name: "Shop",
    subdomain: "shop",
    cpu: "500m",
    memory: "1Gi",
    replicaCount: 2,
    autoscaleMaxReplicas: 8,
    autoscaleTargetCpuPercent: 60
};

function useProject(row: Record<string, unknown>): void {
    const client = {
        functions: { invoke: vi.fn(async () => { throw new Error("no quote"); }) },
        data: { collection: () => ({ findById: async () => row }) }
    };
    vi.mocked(context.requireClient).mockResolvedValue({ client, url: "https://cp.example" } as never);
}

beforeEach(() => setJsonModeForTest(true));
afterEach(() => setJsonModeForTest(false));

describe("rebase cloud compute", () => {
    it("reports the autoscale dials in --json", async () => {
        useProject(project);
        const chunks: string[] = [];
        const write = vi.spyOn(process.stdout, "write").mockImplementation((s: string | Uint8Array) => {
            chunks.push(String(s));
            return true;
        });
        try {
            await computeCommand(undefined, ["node", "rebase", "cloud", "compute", "--json"]);
        } finally {
            write.mockRestore();
        }
        const parsed = JSON.parse(chunks.join("").trim());
        expect(parsed.autoscaleMaxReplicas).toBe(8);
        expect(parsed.autoscaleTargetCpuPercent).toBe(60);
    });

    it("prints them for a person too", async () => {
        setJsonModeForTest(false);
        useProject(project);
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        try {
            await computeCommand(undefined, ["node", "rebase", "cloud", "compute"]);
            const printed = log.mock.calls.map(call => call.map(String).join(" ")).join("\n");
            expect(printed).toMatch(/Autoscale ceiling[\s\S]*8/);
            expect(printed).toMatch(/Autoscale CPU target[\s\S]*60/);
        } finally {
            log.mockRestore();
        }
    });
});
