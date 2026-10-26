/**
 * `rebase cloud usage [org] [--month]`: a project's (or the org's) usage this
 * month, read from the control plane — what the console's usage panel shows,
 * for a terminal or an agent.
 *
 * Pinned: each form reads its own route (and only reads), `--json` is exactly
 * one JSON value carrying the control plane's fields unchanged (caveats
 * included), the human output prints the caveats with the numbers, and a
 * malformed `--month` or an unknown action is refused before anything is read.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setJsonModeForTest } from "./context";

vi.mock("./context", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./context")>();
    return {
        ...actual,
        requireClient: vi.fn(),
        requireProject: vi.fn(async () => "p1"),
        getContextOrg: vi.fn(() => "org-1")
    };
});

import * as context from "./context";
import { usageCommand, usageBar } from "./usage";

const CAVEATS = [
    { code: "storage_not_measured", message: "Object storage is not measured yet: it reads 0 and no storage overage is billed." },
    { code: "multi_pod_undercount", message: "This project can run more than one app pod." }
];

const PROJECT = {
    projectId: "p1",
    month: "2026-10",
    complete: false,
    days: [{ day: "2026-10-01", requests: 1_250_000, errors: 3, missedSamples: 0 }],
    totals: { requests: 1_250_000, errors: 3, daysRecorded: 1, daysWithGaps: 0 },
    quotas: { requestsPerMonth: 1_000_000 },
    fraction: 1.25,
    warn: true,
    overageEur: 0.5,
    billed: true,
    projection: { requests: 3_000_000, fraction: 3, overageEur: 4 },
    enforcement: { kind: "bill", message: "Over the monthly allowance." },
    caveats: CAVEATS
};

const ORG = {
    organizationId: "org-1",
    month: "2026-10",
    complete: false,
    projects: [{ ...PROJECT, name: "Storefront" }],
    totals: { requests: 1_250_000, errors: 3, overageEur: 0.5, projectedOverageEur: 4 },
    truncated: false
};

function argv(...words: string[]): string[] {
    return ["/usr/bin/node", "/x/y/rebase.js", "cloud", ...words];
}

const invoke = vi.fn(async (_name: string, _body: unknown, opts?: { method?: string; path?: string }) => {
    if (opts?.path?.startsWith("org/")) return ORG;
    if (opts?.path?.startsWith("p1")) return PROJECT;
    throw new Error(`unexpected call ${opts?.path}`);
});

/** Everything written to stdout while `run` runs; `process.exit` becomes a throw. */
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

async function humanOutput(words: string[]): Promise<string> {
    setJsonModeForTest(false);
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(" ")); });
    try {
        await usageCommand(argv(...words));
    } finally {
        spy.mockRestore();
    }
    // eslint-disable-next-line no-control-regex
    return lines.join("\n").replace(/\u001b\[[0-9;]*m/g, "");
}

beforeEach(() => {
    setJsonModeForTest(true);
    (context.requireClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        client: { functions: { invoke } },
        url: "https://cp.example"
    });
});
afterEach(() => {
    setJsonModeForTest(false);
    vi.clearAllMocks();
});

describe("rebase cloud usage", () => {
    it("--json is one JSON value: the project's usage as the control plane sent it", async () => {
        const { out, exited } = await stdoutOf(() => usageCommand(argv("usage", "--json")));
        expect(exited).toBe(false);
        expect(JSON.parse(out)).toEqual(PROJECT);
        expect(invoke).toHaveBeenCalledTimes(1);
        expect(invoke).toHaveBeenCalledWith("usage", undefined, { method: "GET", path: "p1" });
    });

    it("passes --month to the control plane", async () => {
        await stdoutOf(() => usageCommand(argv("usage", "--month", "2026-09")));
        expect(invoke).toHaveBeenCalledWith("usage", undefined, { method: "GET", path: "p1?month=2026-09" });
    });

    it("refuses a --month that is not YYYY-MM before reading anything", async () => {
        for (const bad of ["2026-9", "september", "2026-13"]) {
            const { out, exited } = await stdoutOf(() => usageCommand(argv("usage", "--month", bad)));
            expect(exited).toBe(true);
            expect(JSON.parse(out).error.code).toBe("usage");
        }
        expect(invoke).not.toHaveBeenCalled();
    });

    it("refuses an unknown action rather than printing the project's usage", async () => {
        const { out, exited } = await stdoutOf(() => usageCommand(argv("usage", "orgs")));
        expect(exited).toBe(true);
        expect(JSON.parse(out).error.code).toBe("unknown_command");
        expect(invoke).not.toHaveBeenCalled();
    });

    it("prints the requests, the allowance, the overage and the caveats for a person", async () => {
        const text = await humanOutput(["usage"]);
        expect(text).toContain("1,250,000 of 1,000,000 included");
        expect(text).toContain("125%");
        expect(text).toContain("€0.50");
        expect(text).toContain("an estimate");
        expect(text).toContain("Object storage is not measured yet");
        expect(text).toContain("more than one app pod");
    });
});

describe("rebase cloud usage org", () => {
    it("--json carries every project and the org's total, read from the selected org's route", async () => {
        const { out } = await stdoutOf(() => usageCommand(argv("usage", "org", "--json")));
        expect(JSON.parse(out)).toEqual(ORG);
        expect(invoke).toHaveBeenCalledWith("usage", undefined, { method: "GET", path: "org/org-1" });
    });

    it("prints one row per project, the total and the caveats", async () => {
        const text = await humanOutput(["usage", "org"]);
        expect(text).toContain("Storefront");
        expect(text).toContain("Total");
        expect(text).toContain("Object storage is not measured yet");
        expect(text).toContain("Storefront: This project can run more than one app pod.");
    });

    it("needs a selected organization", async () => {
        (context.getContextOrg as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(undefined);
        const { out, exited } = await stdoutOf(() => usageCommand(argv("usage", "org")));
        expect(exited).toBe(true);
        expect(JSON.parse(out).error.code).toBe("no_org");
    });
});

describe("usageBar", () => {
    it("fills with the allowance and stops at full past it", () => {
        // eslint-disable-next-line no-control-regex
        const plain = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");
        expect(plain(usageBar(0.5))).toBe("█".repeat(10) + "░".repeat(10));
        expect(plain(usageBar(3))).toBe("█".repeat(20));
        expect(plain(usageBar(0))).toBe("░".repeat(20));
    });
});
