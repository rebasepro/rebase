/**
 * `rebase cloud projects transfer <slug> --to-org <id|slug>`: moving a project
 * into another organization through the control plane's `project-transfer`
 * function.
 *
 * Pinned: the destination is required and refused before any call; a slug
 * resolves to the organization's id, which is what the control plane is sent;
 * the move is a POST to the project's path, and `--json` reports both
 * organizations; moving into the organization it is already in is refused
 * locally; and a control plane without the function says so instead of a bare
 * 404.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setJsonModeForTest } from "./context";

vi.mock("./context", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./context")>();
    return {
        ...actual,
        requireClient: vi.fn(),
        resolveProjectRef: vi.fn(async () => PROJECT_ID)
    };
});

import * as context from "./context";
import { fakeCloudClient } from "../../../test/helpers/cloud-client";
import { transferProject } from "./projects";

const PROJECT_ID = "35e08cdc-95d7-4bd0-b6ee-de609716b691";
const FROM = "a1fc3437-add1-4172-9968-dc6a0a1afb75";
const TO = "0b6f2a4e-1111-4222-8333-944455556666";

function argv(...words: string[]): string[] {
    return ["/usr/bin/node", "/x/y/rebase.js", "cloud", "projects", "transfer", ...words];
}

let invoke = vi.fn(async (_name: string, _body?: unknown, _opts?: { method?: string; path?: string }): Promise<unknown> => ({
    projectId: PROJECT_ID,
    slug: "triptelier",
    fromOrganizationId: FROM,
    toOrganizationId: TO
}));

function install(): void {
    vi.mocked(context.requireClient).mockResolvedValue({
        client: fakeCloudClient({
            invoke: (name, payload, options) => invoke(name, payload, options),
            collection: (slug) => slug === "projects"
                ? { findById: () => ({ id: PROJECT_ID,
name: "Triptelier",
subdomain: "triptelier",
organization: FROM }) }
                : slug === "organizations"
                    ? {
                        findById: (id) => (id === TO ? { id: TO,
name: "Triptelier",
slug: "triptelier-x1" } : id === FROM ? { id: FROM,
name: "Clients" } : undefined),
                        find: () => ({ data: [{ id: TO,
name: "Triptelier",
slug: "triptelier-x1" }] })
                    }
                    : {}
        }),
        url: "https://cp.example"
    });
}

beforeEach(() => {
    setJsonModeForTest(true);
    install();
});
afterEach(() => {
    setJsonModeForTest(false);
    vi.clearAllMocks();
});

async function run(args: string[]): Promise<{ out: string; err: string; exited: boolean }> {
    const out: string[] = [];
    const err: string[] = [];
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = (s: string) => { out.push(String(s)); return true; };
    process.stderr.write = (s: string) => { err.push(String(s)); return true; };
    const exit = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("__exit__"); });
    let exited = false;
    try {
        await transferProject(args, "triptelier");
    } catch (e) {
        if (!(e instanceof Error && e.message === "__exit__")) throw e;
        exited = true;
    } finally {
        process.stdout.write = origOut;
        process.stderr.write = origErr;
        exit.mockRestore();
    }
    return { out: out.join(""),
err: err.join(""),
exited };
}

describe("rebase cloud projects transfer", () => {
    it("POSTs the destination's id to the project's path and reports both organizations", async () => {
        const { out, exited } = await run(argv("triptelier", "--to-org", TO, "--yes", "--json"));
        expect(exited).toBe(false);
        expect(invoke).toHaveBeenCalledTimes(1);
        expect(invoke).toHaveBeenCalledWith("project-transfer", { organizationId: TO }, { path: PROJECT_ID });
        expect(JSON.parse(out)).toMatchObject({ success: true,
id: PROJECT_ID,
slug: "triptelier",
fromOrg: FROM,
toOrg: TO,
toOrgName: "Triptelier" });
    });

    it("resolves an organization slug to its id", async () => {
        const { exited } = await run(argv("triptelier", "--to-org", "triptelier-x1", "--yes", "--json"));
        expect(exited).toBe(false);
        expect(invoke).toHaveBeenCalledWith("project-transfer", { organizationId: TO }, { path: PROJECT_ID });
    });

    it("refuses without --to-org, before any call", async () => {
        const { exited } = await run(argv("triptelier", "--yes", "--json"));
        expect(exited).toBe(true);
        expect(invoke).not.toHaveBeenCalled();
        expect(context.requireClient).not.toHaveBeenCalled();
    });

    it("refuses the organization the project is already in", async () => {
        const { exited } = await run(argv("triptelier", "--to-org", FROM, "--yes", "--json"));
        expect(exited).toBe(true);
        expect(invoke).not.toHaveBeenCalled();
    });

    it("refuses without --yes off a terminal, and moves nothing", async () => {
        const { exited } = await run(argv("triptelier", "--to-org", TO, "--json"));
        expect(exited).toBe(true);
        expect(invoke).not.toHaveBeenCalled();
    });

    it("says the control plane cannot move projects when it has no such function", async () => {
        invoke = vi.fn(async () => {
            throw Object.assign(new Error("Not Found"), { status: 404,
code: "not_found" });
        });
        const { out, err, exited } = await run(argv("triptelier", "--to-org", TO, "--yes", "--json"));
        expect(exited).toBe(true);
        expect(out + err).toMatch(/moving a project to another organization/i);
    });
});
