/**
 * `rebase cloud domains`, against the control plane's per-host model.
 *
 * A project's hostnames are rows of `project_domains`, served by the `domains`
 * function the console uses. The Ingress is built from those rows, and reads
 * the single `projects.customDomain` column only for a project that has none.
 * The CLI wrote that column: on any project with a row, `domains remove`
 * reported the domain removed while the host stayed served, and `domains add`
 * followed by `verify` said "verified and live" for a host that was never
 * served — until the next console change overwrote the column and it vanished
 * from `domains list` as well.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./context", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./context")>();
    return {
        ...actual,
        requireClient: vi.fn(),
        requireProject: vi.fn(async () => "proj_1"),
        displayProjectRef: vi.fn(() => "shop")
    };
});

import * as context from "./context";
import { domainsCommand } from "./domains";

class Exited extends Error {
    constructor(readonly code: number) {
        super(`process.exit(${code})`);
    }
}

type Invoke = (name: string, body: unknown, opts?: { method?: string; path?: string }) => Promise<unknown>;

const instructions = {
    pointing: { type: "CNAME", name: "www.example.com", values: ["shop.rebase.website"] },
    ownership: { type: "TXT", name: "_rebase-challenge.www.example.com", values: ["rebase-verify=abc"] }
};

const shop = {
    id: "dom-1",
    host: "shop.example.com",
    primary: true,
    status: "verified",
    verifiedAt: "2026-09-12T10:00:00.000Z",
    isApex: false,
    tenantHost: "shop.rebase.website",
    instructions
};

const www = { ...shop, id: "dom-2", host: "www.example.com", primary: false, status: "pending", verifiedAt: null };

let invoke: ReturnType<typeof vi.fn<Invoke>>;
let update: ReturnType<typeof vi.fn>;
let stdout: string[];
let said: string[];

/** A control plane answering `domains` with these rows, and `verify-domain` with this column. */
function controlPlane(opts: {
    rows?: unknown[] | "no-function";
    column?: { domain: string | null; status: string };
    handle?: Invoke;
}): void {
    // The column as the control plane holds it, so a write to it reads back.
    let column = opts.column ?? { domain: null, status: "none" };
    invoke = vi.fn<Invoke>(async (name, body, o) => {
        const answered = await opts.handle?.(name, body, o);
        if (answered !== undefined) return answered;
        if (name === "domains" && o?.method === "GET") {
            if (opts.rows === "no-function") {
                throw Object.assign(new Error("No function named 'domains'."), { status: 404, code: "FUNCTION_NOT_FOUND" });
            }
            return { tenantHost: "shop.rebase.website", domains: opts.rows ?? [] };
        }
        if (name === "verify-domain" && o?.method === "GET") return column;
        throw new Error(`unexpected call ${name} ${o?.method ?? "POST"} ${o?.path ?? ""}`);
    });
    update = vi.fn(async (_id: string, values: { customDomain?: string }) => {
        if (values.customDomain !== undefined) {
            column = values.customDomain ? { domain: values.customDomain, status: "pending" } : { domain: null, status: "none" };
        }
        return {};
    });
    (context.requireClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        client: {
            functions: { invoke },
            data: { collection: () => ({ update }) }
        },
        url: "https://cp.example"
    });
}

/** The calls that were not reads. */
function writes(): Array<[string, unknown, { method?: string; path?: string } | undefined]> {
    return invoke.mock.calls.filter(([, , o]) => o?.method !== "GET");
}

beforeEach(() => {
    stdout = [];
    said = [];
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
        stdout.push(String(chunk));
        return true;
    }) as typeof process.stdout.write);
    const capture = (...args: unknown[]) => { said.push(args.map(String).join(" ")); };
    vi.spyOn(console, "log").mockImplementation(capture);
    vi.spyOn(console, "error").mockImplementation(capture);
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
        throw new Exited(code ?? 0);
    }) as never);
    context.setJsonModeForTest(true);
});

afterEach(() => {
    context.setJsonModeForTest(false);
    vi.restoreAllMocks();
});

const argv = (...words: string[]) => ["node", "rebase", "cloud", "domains", ...words];
const json = () => JSON.parse(stdout.join(""));

describe("domains on a project with host rows", () => {
    it("remove deletes that host's row, and never writes the project's domain column", async () => {
        controlPlane({
            rows: [shop, www],
            handle: async (name, _b, o) =>
                name === "domains" && o?.method === "DELETE" ? { removed: true, host: "shop.example.com" } : undefined
        });

        await domainsCommand("remove", argv("remove", "shop.example.com", "--yes"));

        expect(writes()).toEqual([["domains", undefined, { method: "DELETE", path: "proj_1/dom-1" }]]);
        expect(update).not.toHaveBeenCalled();
        expect(json()).toMatchObject({ success: true, projectId: "proj_1", host: "shop.example.com", removed: true });
    });

    it("add registers a new host row", async () => {
        controlPlane({
            rows: [shop],
            handle: async (name, body, o) =>
                name === "domains" && o?.method === undefined && o?.path === "proj_1" ? { ...www, ...(body as object) } : undefined
        });

        await domainsCommand("add", argv("add", "www.example.com"));

        expect(writes()).toEqual([["domains", { host: "www.example.com" }, { path: "proj_1" }]]);
        expect(update).not.toHaveBeenCalled();
        expect(json()).toMatchObject({ success: true, projectId: "proj_1", host: "www.example.com", status: "pending" });
    });

    it("verify checks the named host's row", async () => {
        controlPlane({
            rows: [shop, www],
            handle: async (name, _b, o) =>
                name === "domains" && o?.path === "proj_1/dom-2/verify"
                    ? {
                        ...www,
                        status: "verified",
                        verified: true,
                        checks: {
                            ownership: { ok: true, expected: ["rebase-verify=abc"], observed: ["rebase-verify=abc"] },
                            pointing: { ok: true, expected: ["shop.rebase.website"], observed: ["shop.rebase.website"] }
                        }
                    }
                    : undefined
        });

        await domainsCommand("verify", argv("verify", "www.example.com"));

        expect(writes()).toEqual([["domains", {}, { path: "proj_1/dom-2/verify" }]]);
        expect(json()).toMatchObject({ projectId: "proj_1", host: "www.example.com", verified: true, status: "verified" });
    });

    it("list shows every host", async () => {
        controlPlane({ rows: [shop, www] });

        await domainsCommand("list", argv("list"));

        expect(json()).toMatchObject({
            projectId: "proj_1",
            tenantHost: "shop.rebase.website",
            domains: [
                { host: "shop.example.com", status: "verified", primary: true },
                { host: "www.example.com", status: "pending", primary: false }
            ]
        });
    });

    it("refuses to guess which host to remove when there are several", async () => {
        controlPlane({ rows: [shop, www] });

        await expect(domainsCommand("remove", argv("remove", "--yes"))).rejects.toMatchObject({ code: 1 });

        expect(writes()).toEqual([]);
        expect(json()).toMatchObject({ error: { code: "usage" } });
    });

    it("refuses a host the project does not have", async () => {
        controlPlane({ rows: [shop] });

        await expect(domainsCommand("remove", argv("remove", "other.example.com", "--yes")))
            .rejects.toMatchObject({ code: 1 });

        expect(writes()).toEqual([]);
        expect(json()).toMatchObject({ error: { code: "not_found" } });
    });
});

/**
 * A project with no rows is served from its single domain column, which the
 * control plane still honours — so that domain is shown, verified and removed
 * the way it was set.
 */
describe("domains on a project whose one domain predates host rows", () => {
    const column = { domain: "legacy.example.com", status: "verified", tenantHost: "shop.rebase.website", instructions };

    it("list shows the column's domain", async () => {
        controlPlane({ rows: [], column });

        await domainsCommand("list", argv("list"));

        expect(json()).toMatchObject({ domains: [{ host: "legacy.example.com", status: "verified" }] });
    });

    it("remove clears the column", async () => {
        controlPlane({ rows: [], column });

        await domainsCommand("remove", argv("remove", "legacy.example.com", "--yes"));

        expect(update).toHaveBeenCalledWith("proj_1", { customDomain: "" });
        expect(writes()).toEqual([]);
    });
});

describe("domains on a control plane without the domains function", () => {
    it("registers the domain in the single column", async () => {
        controlPlane({ rows: "no-function", column: { domain: null, status: "none" } });

        await domainsCommand("add", argv("add", "www.example.com"));

        expect(update).toHaveBeenCalledWith("proj_1", { customDomain: "www.example.com" });
        expect(writes()).toEqual([]);
        expect(json()).toMatchObject({ success: true, host: "www.example.com", status: "pending" });
    });

    it("lists the column's domain", async () => {
        controlPlane({ rows: "no-function", column: { domain: "www.example.com", status: "verified" } });

        await domainsCommand("list", argv("list"));

        expect(json()).toMatchObject({ domains: [{ id: null, host: "www.example.com", status: "verified" }] });
    });
});
