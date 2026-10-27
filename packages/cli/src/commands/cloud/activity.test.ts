/**
 * `rebase cloud activity`: the organization's audit log, read from the control
 * plane — what the console's Activity page shows, for a terminal or an agent.
 *
 * Pinned: it reads the selected org's route (and only reads it), passes each
 * filter through, `--json` is exactly one JSON value carrying the events
 * unchanged, a bad `--limit` is refused before any call, a project id is sent
 * as it is (a deleted project does not resolve) while a slug is resolved, and
 * the human output says who did what to which target.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setJsonModeForTest } from "./context";

vi.mock("./context", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./context")>();
    return {
        ...actual,
        requireClient: vi.fn(),
        requireProject: vi.fn(async () => "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
        getContextOrg: vi.fn(() => "org-1")
    };
});

import * as context from "./context";
import { activityCommand, actorText, detailText, type CliAuditEvent } from "./activity";

const EVENT: CliAuditEvent = {
    id: "e1",
    createdAt: "2026-10-25T10:00:00.000Z",
    action: "env.set",
    target: "STRIPE_KEY",
    projectId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    projectLabel: "storefront",
    actorKind: "token",
    actorLabel: "github-ci (ana@acme.test)",
    actorUserId: "u1",
    metadata: {}
};

function argv(...words: string[]): string[] {
    return ["/usr/bin/node", "/x/y/rebase.js", "cloud", ...words];
}

const invoke = vi.fn(async (_name: string, _body: unknown, _opts?: { method?: string; path?: string }) =>
    ({ events: [EVENT], nextCursor: "c1" }));

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

describe("rebase cloud activity", () => {
    it("--json is one JSON value with the events unchanged, read from the org's route", async () => {
        const { out, exited } = await stdoutOf(() => activityCommand(argv("activity", "--json")));
        expect(exited).toBe(false);
        expect(JSON.parse(out)).toEqual({ org: "org-1", events: [EVENT], nextCursor: "c1" });
        expect(invoke).toHaveBeenCalledTimes(1);
        expect(invoke).toHaveBeenCalledWith("audit", undefined, { method: "GET", path: "org/org-1" });
    });

    it("passes every filter, the page size and the cursor through", async () => {
        await stdoutOf(() => activityCommand(argv(
            "activity", "--action", "env", "--actor", "ana@acme.test", "--limit", "10", "--before", "c1", "--org", "org-2"
        )));
        expect(invoke).toHaveBeenCalledWith("audit", undefined, {
            method: "GET",
            path: "org/org-2?action=env&actor=ana%40acme.test&limit=10&before=c1"
        });
    });

    it("sends a project id as it is, and resolves a slug", async () => {
        await stdoutOf(() => activityCommand(argv("activity", "--project", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")));
        expect(context.requireProject).not.toHaveBeenCalled();
        expect(invoke).toHaveBeenLastCalledWith("audit", undefined, { method: "GET", path: "org/org-1?project=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" });

        await stdoutOf(() => activityCommand(argv("activity", "--project", "shop")));
        expect(context.requireProject).toHaveBeenCalledTimes(1);
        expect(invoke).toHaveBeenLastCalledWith("audit", undefined, { method: "GET", path: "org/org-1?project=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" });
    });

    it("refuses a bad --limit before any call", async () => {
        for (const bad of ["0", "101", "ten"]) {
            const { out, exited } = await stdoutOf(() => activityCommand(argv("activity", "--limit", bad)));
            expect(exited).toBe(true);
            expect(JSON.parse(out).error.code).toBe("usage");
        }
        expect(invoke).not.toHaveBeenCalled();
    });

    it("refuses a positional rather than ignoring it", async () => {
        const { exited } = await stdoutOf(() => activityCommand(argv("activity", "everything")));
        expect(exited).toBe(true);
        expect(invoke).not.toHaveBeenCalled();
    });

    it("prints who did what to which target, and how to get the next page", async () => {
        setJsonModeForTest(false);
        const lines: string[] = [];
        const log = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(" ")); });
        const err = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(" ")); });
        try {
            await activityCommand(argv("activity"));
        } finally {
            log.mockRestore();
            err.mockRestore();
        }
        // eslint-disable-next-line no-control-regex
        const text = lines.join("\n").replace(/\u001b\[[0-9;]*m/g, "");
        expect(text).toContain("2026-10-25 10:00 UTC");
        expect(text).toContain("env.set STRIPE_KEY");
        expect(text).toContain("storefront");
        expect(text).toContain("by github-ci (ana@acme.test) [token]");
        expect(text).toContain("--before c1");
    });
});

describe("activity text", () => {
    it("names a token as a token, and a person by their label", () => {
        expect(actorText(EVENT)).toBe("github-ci (ana@acme.test) [token]");
        expect(actorText({ ...EVENT, actorKind: "user", actorLabel: "ana@acme.test" })).toBe("ana@acme.test");
    });

    it("details what changed", () => {
        expect(detailText({ ...EVENT, action: "project.dials", metadata: { changes: { cpu: { from: 0.5, to: 1 } } } })).toBe("cpu: 0.5 → 1");
        expect(detailText({ ...EVENT, action: "member.role", metadata: { from: "member", to: "admin" } })).toBe("member → admin");
        expect(detailText({ ...EVENT, action: "backup.restore", metadata: { succeeded: false } })).toMatch(/failed part way/);
        expect(detailText(EVENT)).toBe("");
    });
});
