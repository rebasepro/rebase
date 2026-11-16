/**
 * The cloud commands that reach control-plane routes the CLI had no command
 * for, the confirmations added to destructive ones, and the `not_served`
 * refusal a command gives on a control plane without its route.
 *
 * Pinned, per command: the exact function, method, path and body it sends; that
 * `--json` is one value carrying what the control plane answered; that a usage
 * error is refused before any call; and, for each destructive action, that it
 * refuses off a terminal without `--yes` and sends nothing.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setJsonModeForTest } from "./context";

const PROJECT_ID = "6f1c2a0e-1111-4222-8333-944445555666";

vi.mock("./context", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./context")>();
    return {
        ...actual,
        requireClient: vi.fn(),
        requireSessionClient: vi.fn(),
        requireProject: vi.fn(async () => PROJECT_ID),
        displayProjectRef: vi.fn(() => "shop"),
        getContextOrg: vi.fn(() => "org-1"),
        setContextOrg: vi.fn()
    };
});

import * as context from "./context";
import { fakeCloudClient, type CollectionAnswers } from "../../../test/helpers/cloud-client";
import { deployHooksCommand } from "./deploy-hooks";
import { alertsCommand } from "./alerts";
import { metricsCommand, HISTORY_SERIES, statusCommand, computeCommand, billingCommand, clustersCommand } from "./resources";
import { domainsCommand } from "./domains";
import { settingsCommand } from "./settings";
import { orgsCommand } from "./orgs";
import { envCommand } from "./env";
import { dbAccessCommand } from "./db-access";
import { usageCommand } from "./usage";
import { appKeyCommand } from "./app-key";
import { computeWindowCommand } from "./maintenance";
import { deployCommand } from "./deploy";
import { isRouteNotServed } from "./not-served";

function argv(...words: string[]): string[] {
    return ["/usr/bin/node", "/x/y/rebase.js", "cloud", ...words];
}

type InvokeOptions = { method?: string; path?: string };
type Answer = (name: string, body: unknown, opts?: InvokeOptions) => unknown;

let answer: Answer = () => ({});
const invoke = vi.fn(async (name: string, body?: unknown, opts?: InvokeOptions) => answer(name, body, opts));
let tables: Record<string, CollectionAnswers> = {};
const updates: Array<{ table: string; id: string; data: Record<string, unknown> }> = [];
const deletes: Array<{ table: string; id: string }> = [];

function useClient(): void {
    const client = fakeCloudClient({
        invoke,
        collection: (slug) => ({
            update: (id, data) => {
                updates.push({ table: slug, id, data });
                return { id, ...data };
            },
            delete: (id) => {
                deletes.push({ table: slug, id });
                return { id };
            },
            ...tables[slug]
        })
    });
    vi.mocked(context.requireClient).mockResolvedValue({ client, url: "https://cp.example" });
    vi.mocked(context.requireSessionClient).mockResolvedValue({ client, url: "https://cp.example" });
}

beforeEach(() => {
    setJsonModeForTest(true);
    answer = () => ({});
    tables = {};
    updates.length = 0;
    deletes.length = 0;
    process.exitCode = undefined;
    useClient();
});
afterEach(() => {
    setJsonModeForTest(false);
    process.exitCode = undefined;
    vi.clearAllMocks();
});

/** Everything written to stdout while `run` runs; `process.exit` becomes a throw. */
async function stdoutOf(run: () => Promise<unknown>): Promise<{ out: string; exited: boolean; json: () => Record<string, unknown> }> {
    const chunks: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string) => {
        chunks.push(typeof s === "string" ? s : String(s));
        return true;
    };
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("__exit__");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let exited = false;
    try {
        await run();
    } catch (e) {
        if (!(e instanceof Error && e.message === "__exit__")) throw e;
        exited = true;
    } finally {
        process.stdout.write = orig;
        exit.mockRestore();
        warn.mockRestore();
    }
    const out = chunks.join("");
    return { out, exited, json: () => JSON.parse(out) as Record<string, unknown> };
}

/** The `{ error }` envelope a refusal prints. */
function errorOf(result: { json: () => Record<string, unknown> }): { code?: string; message?: string; hint?: string } {
    const error = result.json().error;
    return typeof error === "object" && error !== null ? error : {};
}

const notServed = () => Object.assign(new Error("No function 'credentials' is mounted."), { status: 404, code: "FUNCTION_NOT_FOUND" });

/* ── deploy-hooks ──────────────────────────────────────────────── */

describe("rebase cloud deploy-hooks", () => {
    const HOOK = { id: "7", name: "github", branch: "main", createdAt: "2026-11-01T10:00:00Z", lastUsedAt: null };

    it("creates one through the deploy function and prints its URL once", async () => {
        answer = () => ({ success: true, hook: { id: "7", name: "github", branch: "main" }, token: "rdh_abc", path: "/api/functions/deploy/hooks/trigger/rdh_abc" });
        const r = await stdoutOf(() => deployHooksCommand("create", argv("deploy-hooks", "create", "--name", "github", "--branch", "main")));
        expect(invoke).toHaveBeenCalledWith("deploy", { projectId: PROJECT_ID, name: "github", branch: "main" }, { path: "hooks" });
        expect(r.json()).toMatchObject({
            url: "https://cp.example/api/functions/deploy/hooks/trigger/rdh_abc",
            token: "rdh_abc",
            hook: { id: "7", name: "github", branch: "main" }
        });
    });

    it("lists them, never with a token", async () => {
        answer = () => ({ success: true, hooks: [HOOK] });
        const r = await stdoutOf(() => deployHooksCommand(undefined, argv("deploy-hooks")));
        expect(invoke).toHaveBeenCalledWith("deploy", undefined, { method: "GET", path: `hooks?projectId=${PROJECT_ID}` });
        expect(r.json()).toEqual({ projectId: PROJECT_ID, hooks: [HOOK] });
    });

    it("asks before revoking: off a terminal without --yes it refuses and deletes nothing", async () => {
        answer = (_n, _b, opts) => (opts?.method === "GET" ? { hooks: [HOOK] } : { success: true });
        const refused = await stdoutOf(() => deployHooksCommand("revoke", argv("deploy-hooks", "revoke", "7")));
        expect(errorOf(refused).code).toBe("confirmation_required");
        expect(invoke).not.toHaveBeenCalledWith("deploy", undefined, expect.objectContaining({ method: "DELETE" }));

        const done = await stdoutOf(() => deployHooksCommand("revoke", argv("deploy-hooks", "revoke", "7", "--yes")));
        expect(invoke).toHaveBeenCalledWith("deploy", undefined, { method: "DELETE", path: "hooks/7" });
        expect(done.json()).toMatchObject({ revoked: { id: "7" } });
    });

    it("refuses an id that is not one of the project's hooks, and flags on the wrong action, before any write", async () => {
        answer = () => ({ hooks: [HOOK] });
        expect(errorOf(await stdoutOf(() => deployHooksCommand("revoke", argv("deploy-hooks", "revoke", "99", "--yes")))).code).toBe("not_found");
        expect(errorOf(await stdoutOf(() => deployHooksCommand("list", argv("deploy-hooks", "list", "--name", "x")))).code).toBe("usage");
        expect(errorOf(await stdoutOf(() => deployHooksCommand("revoke", argv("deploy-hooks", "revoke")))).code).toBe("usage");
        expect(errorOf(await stdoutOf(() => deployHooksCommand("revok", argv("deploy-hooks", "revok")))).code).toBe("unknown_command");
        expect(invoke).not.toHaveBeenCalledWith("deploy", undefined, expect.objectContaining({ method: "DELETE" }));
    });
});

/* ── alerts ────────────────────────────────────────────────────── */

describe("rebase cloud alerts", () => {
    const INCIDENT = {
        id: "inc-1", rule: "database.disk", title: "Database disk 91% full", summary: "postgres-1",
        severity: "critical", state: "firing", category: "database", openedAt: "2026-11-14T08:00:00Z"
    };

    it("lists the project's open incidents from the data API", async () => {
        tables["alert-incidents"] = { find: () => ({ data: [INCIDENT] }) };
        const r = await stdoutOf(() => alertsCommand(undefined, argv("alerts")));
        expect(r.json()).toMatchObject({ projectId: PROJECT_ID, all: false, incidents: [{ id: "inc-1", title: "Database disk 91% full", severity: "critical", state: "firing" }] });
    });

    it("acknowledges and snoozes through the alerts function", async () => {
        await stdoutOf(() => alertsCommand("ack", argv("alerts", "ack", "inc-1")));
        expect(invoke).toHaveBeenCalledWith("alerts", {}, { path: "incidents/inc-1/acknowledge" });

        answer = () => ({ ok: true, snoozedUntil: "2026-11-16T08:00:00Z" });
        const r = await stdoutOf(() => alertsCommand("snooze", argv("alerts", "snooze", "inc-1", "--hours", "24")));
        expect(invoke).toHaveBeenCalledWith("alerts", { hours: 24 }, { path: "incidents/inc-1/snooze" });
        expect(r.json()).toEqual({ id: "inc-1", hours: 24, snoozedUntil: "2026-11-16T08:00:00Z" });
    });

    it.each([
        [["alerts", "snooze", "inc-1"]],
        [["alerts", "snooze", "inc-1", "--hours", "0"]],
        [["alerts", "snooze", "inc-1", "--hours", "169"]],
        [["alerts", "snooze", "inc-1", "--hours", "1.5"]],
        [["alerts", "ack"]],
        [["alerts", "ack", "inc-1", "--hours", "2"]],
        [["alerts", "list", "inc-1"]]
    ])("refuses %j before any call", async (words) => {
        const r = await stdoutOf(() => alertsCommand(words[1], argv(...words)));
        expect(errorOf(r).code).toBe("usage");
        expect(invoke).not.toHaveBeenCalled();
    });
});

/* ── metrics ───────────────────────────────────────────────────── */

describe("rebase cloud metrics --runtime / --history", () => {
    it("reads the runtime rollup and reports the error rate", async () => {
        const rollup = { uptimeSeconds: 600, heapBytes: 1, rssBytes: 2, totalRequests: 200, totalErrors: 5, meanLatencyMs: 12.5, surfaces: [] };
        answer = () => ({ projectId: PROJECT_ID, at: "2026-11-15T10:00:00Z", rollup });
        const r = await stdoutOf(() => metricsCommand(argv("metrics", "--runtime")));
        expect(invoke).toHaveBeenCalledWith("metrics", undefined, { method: "GET", path: `${PROJECT_ID}/runtime` });
        expect(r.json()).toMatchObject({ rollup, errorRate: 0.025 });
    });

    it("says no data rather than zeroes when the app could not be read", async () => {
        answer = () => ({ projectId: PROJECT_ID, rollup: null });
        const r = await stdoutOf(() => metricsCommand(argv("metrics", "--runtime")));
        expect(r.json()).toMatchObject({ rollup: null, errorRate: null });
    });

    it("reads one series' history, and exits 1 with the reason when there is none", async () => {
        const points = [{ at: "a", value: 100, instances: 1 }, { at: "b", value: 300, instances: 1 }];
        answer = () => ({ series: "memory_bytes", minutes: 120, points });
        const r = await stdoutOf(() => metricsCommand(argv("metrics", "--history", "--series", "memory_bytes", "--minutes", "120")));
        expect(invoke).toHaveBeenCalledWith("metrics", undefined, { method: "GET", path: `${PROJECT_ID}/history?series=memory_bytes&minutes=120` });
        expect(r.json()).toMatchObject({ points, summary: { min: 100, max: 300, mean: 200, latest: 300 } });
        expect(process.exitCode).toBeUndefined();

        answer = () => ({ series: "cpu_millicores", minutes: 60, points: null, reason: "This project's runtime keeps no metric history.", retryable: false });
        const none = await stdoutOf(() => metricsCommand(argv("metrics", "--history")));
        expect(none.json()).toMatchObject({ points: null, reason: "This project's runtime keeps no metric history.", retryable: false });
        expect(process.exitCode).toBe(1);
    });

    it.each([
        [["metrics", "--series", "memory_bytes"]],
        [["metrics", "--runtime", "--history"]],
        [["metrics", "--history", "--series", "disk"]],
        [["metrics", "--history", "--minutes", "20161"]]
    ])("refuses %j before any call", async (words) => {
        const r = await stdoutOf(() => metricsCommand(argv(...words)));
        expect(errorOf(r).code).toBe("usage");
        expect(invoke).not.toHaveBeenCalled();
    });

    it("offers exactly the series the runtime records", () => {
        const source = fs.readFileSync(path.resolve(__dirname, "../../../../server/src/metrics/history-store.ts"), "utf8");
        const declared = /METRIC_SERIES\s*=\s*\[([^\]]*)\]/.exec(source);
        expect(declared).not.toBeNull();
        const names = [...(declared?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map(m => m[1]);
        expect([...HISTORY_SERIES].sort()).toEqual(names.sort());
    });
});

/* ── domains primary ───────────────────────────────────────────── */

describe("rebase cloud domains primary", () => {
    const DOMAINS = {
        tenantHost: "shop.rebase.website",
        domains: [
            { id: "d1", host: "app.example.com", primary: true, status: "verified" },
            { id: "d2", host: "www.example.com", primary: false, status: "verified" },
            { id: "d3", host: "new.example.com", primary: false, status: "pending" }
        ]
    };

    it("makes a verified host primary through the domains function", async () => {
        answer = (_n, _b, opts) => (opts?.method === "GET" ? DOMAINS : { id: "d2", host: "www.example.com", primary: true, status: "verified" });
        const r = await stdoutOf(() => domainsCommand("primary", argv("domains", "primary", "www.example.com")));
        expect(invoke).toHaveBeenCalledWith("domains", {}, { path: `${PROJECT_ID}/d2/primary` });
        expect(r.json()).toMatchObject({ host: "www.example.com", primary: true, changed: true });
    });

    it("refuses an unverified host, and a missing one, before the call", async () => {
        answer = () => DOMAINS;
        expect(errorOf(await stdoutOf(() => domainsCommand("primary", argv("domains", "primary", "new.example.com")))).code).toBe("domain_not_verified");
        expect(errorOf(await stdoutOf(() => domainsCommand("primary", argv("domains", "primary")))).code).toBe("usage");
        expect(invoke).not.toHaveBeenCalledWith("domains", {}, expect.anything());
    });
});

/* ── domains redirect ──────────────────────────────────────────── */

describe("rebase cloud domains redirect", () => {
    const DOMAINS = {
        tenantHost: "songbuzz.rebase.website",
        domains: [
            { id: "d1", host: "songbuzz.tv", primary: true, status: "verified" },
            { id: "d2", host: "www.songbuzz.tv", primary: false, status: "verified" }
        ]
    };

    it("asks the domains function to redirect the host, and says where it goes", async () => {
        answer = (_n, _b, opts) => (opts?.method === "GET"
            ? DOMAINS
            : { id: "d2", host: "www.songbuzz.tv", primary: false, status: "verified", redirectToPrimary: true, redirectsTo: "songbuzz.tv" });
        const r = await stdoutOf(() => domainsCommand("redirect", argv("domains", "redirect", "www.songbuzz.tv")));
        expect(invoke).toHaveBeenCalledWith("domains", { redirect: true }, { path: `${PROJECT_ID}/d2/redirect` });
        expect(r.json()).toMatchObject({ host: "www.songbuzz.tv", redirectToPrimary: true, redirectsTo: "songbuzz.tv" });
    });

    it("serves the host again with --off", async () => {
        answer = (_n, _b, opts) => (opts?.method === "GET" ? DOMAINS : { id: "d2", host: "www.songbuzz.tv", redirectsTo: null });
        const r = await stdoutOf(() => domainsCommand("redirect", argv("domains", "redirect", "www.songbuzz.tv", "--off")));
        expect(invoke).toHaveBeenCalledWith("domains", { redirect: false }, { path: `${PROJECT_ID}/d2/redirect` });
        expect(r.json()).toMatchObject({ redirectToPrimary: false, redirectsTo: null });
    });

    it("refuses the primary, and a missing domain, before the call", async () => {
        answer = () => DOMAINS;
        expect(errorOf(await stdoutOf(() => domainsCommand("redirect", argv("domains", "redirect", "songbuzz.tv")))).code).toBe("domain_is_primary");
        expect(errorOf(await stdoutOf(() => domainsCommand("redirect", argv("domains", "redirect")))).code).toBe("usage");
        expect(invoke).not.toHaveBeenCalledWith("domains", expect.objectContaining({ redirect: expect.anything() }), expect.anything());
    });
});

/* ── settings ──────────────────────────────────────────────────── */

describe("rebase cloud settings set", () => {
    beforeEach(() => {
        tables.projects = { findById: () => ({ id: PROJECT_ID, subdomain: "shop" }) };
        answer = () => ({ available: true });
    });

    it("turns Studio access off with --studio off", async () => {
        const r = await stdoutOf(() => settingsCommand("set", argv("settings", "set", "--studio", "off")));
        expect(updates).toEqual([{ table: "projects", id: PROJECT_ID, data: { studioEnabled: false } }]);
        expect(r.json()).toMatchObject({ updated: { studioEnabled: false } });
    });

    it("refuses a --studio that is not on or off", async () => {
        expect(errorOf(await stdoutOf(() => settingsCommand("set", argv("settings", "set", "--studio", "maybe")))).code).toBe("usage");
        expect(updates).toEqual([]);
    });

    it("asks before moving the subdomain, and not when it stays", async () => {
        const refused = await stdoutOf(() => settingsCommand("set", argv("settings", "set", "--subdomain", "store")));
        expect(errorOf(refused).code).toBe("confirmation_required");
        expect(updates).toEqual([]);

        await stdoutOf(() => settingsCommand("set", argv("settings", "set", "--subdomain", "store", "--yes")));
        expect(updates).toEqual([{ table: "projects", id: PROJECT_ID, data: { subdomain: "store" } }]);

        updates.length = 0;
        await stdoutOf(() => settingsCommand("set", argv("settings", "set", "--subdomain", "SHOP", "--name", "Shop")));
        expect(updates).toEqual([{ table: "projects", id: PROJECT_ID, data: { name: "Shop", subdomain: "shop" } }]);
    });
});

/* ── orgs rename / delete ──────────────────────────────────────── */

describe("rebase cloud orgs rename / delete", () => {
    it("renames the active organization, and its slug with --slug", async () => {
        const r = await stdoutOf(() => orgsCommand("rename", argv("orgs", "rename", "Acme Inc", "--slug", "acme")));
        expect(updates).toEqual([{ table: "organizations", id: "org-1", data: { name: "Acme Inc", slug: "acme" } }]);
        expect(r.json()).toMatchObject({ id: "org-1", name: "Acme Inc", slug: "acme" });
        expect(errorOf(await stdoutOf(() => orgsCommand("rename", argv("orgs", "rename", "X", "--slug", "Not A Slug")))).code).toBe("usage");
    });

    it("refuses to delete an organization that still has projects, naming them", async () => {
        tables.organizations = { findById: () => ({ id: "org-1", name: "Acme" }) };
        tables.projects = { find: () => ({ data: [{ id: "p1", subdomain: "shop" }] }) };
        const r = await stdoutOf(() => orgsCommand("delete", argv("orgs", "delete", "--yes")));
        expect(errorOf(r).code).toBe("org_not_empty");
        expect(errorOf(r).message).toContain("shop");
        expect(deletes).toEqual([]);
    });

    it("asks before deleting an empty one, then forgets it as the active organization", async () => {
        tables.organizations = { findById: () => ({ id: "org-1", name: "Acme" }) };
        tables.projects = { find: () => ({ data: [] }) };
        expect(errorOf(await stdoutOf(() => orgsCommand("delete", argv("orgs", "delete")))).code).toBe("confirmation_required");
        expect(deletes).toEqual([]);

        const r = await stdoutOf(() => orgsCommand("delete", argv("orgs", "delete", "--yes")));
        expect(deletes).toEqual([{ table: "organizations", id: "org-1" }]);
        expect(context.setContextOrg).toHaveBeenCalledWith("https://cp.example", undefined);
        expect(r.json()).toMatchObject({ deleted: "org-1", wasActive: true });
    });
});

/* ── billing email, clusters baseline ──────────────────────────── */

describe("rebase cloud billing email", () => {
    it("sets the billing email through stripe-billing", async () => {
        answer = () => ({ success: true, billingEmail: "billing@acme.test" });
        const r = await stdoutOf(() => billingCommand(argv("billing", "email", "billing@acme.test")));
        expect(invoke).toHaveBeenCalledWith("stripe-billing", { organizationId: "org-1", billingEmail: "billing@acme.test" }, { path: "billing-email" });
        expect(r.json()).toEqual({ org: "org-1", billingEmail: "billing@acme.test" });
    });

    it("refuses a missing address, and an address on another action", async () => {
        expect(errorOf(await stdoutOf(() => billingCommand(argv("billing", "email")))).code).toBe("usage");
        expect(errorOf(await stdoutOf(() => billingCommand(argv("billing", "setup", "x@y.z")))).code).toBe("usage");
        expect(invoke).not.toHaveBeenCalled();
    });

    it("says not_served when the control plane has no invoice route", async () => {
        answer = () => {
            throw Object.assign(new Error("The function 'stripe-billing' is served, and has no GET route at '/invoices/org-1'."), {
                status: 404, code: "FUNCTION_NOT_FOUND"
            });
        };
        const r = await stdoutOf(() => billingCommand(argv("billing", "invoices")));
        expect(errorOf(r)).toMatchObject({ code: "not_served", message: "This control plane does not serve invoices yet." });
    });
});

describe("rebase cloud clusters baseline", () => {
    it("reports the components, and installs only with confirmation", async () => {
        answer = (_n, _b, opts) => (opts?.method === "POST"
            ? { started: true, clusterId: "c1" }
            : { ready: false, components: [{ name: "ingress-nginx", installed: true, ready: true }, { name: "cert-manager", installed: false, ready: false }] });
        tables.clusters = { findById: () => ({ id: "c1", baselineStatus: "failed", baselineMessage: "x" }) };

        const report = await stdoutOf(() => clustersCommand("baseline", argv("clusters", "baseline", "c1")));
        expect(invoke).toHaveBeenCalledWith("cluster-baseline", undefined, { method: "GET", path: "c1" });
        expect(report.json()).toMatchObject({ clusterId: "c1", ready: false, install: { baselineStatus: "failed" } });

        expect(errorOf(await stdoutOf(() => clustersCommand("baseline", argv("clusters", "baseline", "c1", "--install")))).code).toBe("confirmation_required");
        expect(invoke).not.toHaveBeenCalledWith("cluster-baseline", {}, expect.anything());

        const started = await stdoutOf(() => clustersCommand("baseline", argv("clusters", "baseline", "c1", "--install", "--yes")));
        expect(invoke).toHaveBeenCalledWith("cluster-baseline", {}, { method: "POST", path: "c1" });
        expect(started.json()).toEqual({ clusterId: "c1", started: true });
    });
});

/* ── deploy --git ──────────────────────────────────────────────── */

describe("rebase cloud deploy --git", () => {
    const REPO_PROJECT = { id: PROJECT_ID, subdomain: "shop", gitRepoUrl: "https://github.com/acme/shop", gitBranch: "main", runtimeMode: "custom" };

    beforeEach(() => {
        tables.deployments = { find: () => ({ data: [] }) };
        answer = (name) => (name === "deploy" ? { success: true, deployment: { id: "d9" } } : {});
    });

    it("asks the control plane to build the connected repository at the branch named", async () => {
        tables.projects = { findById: () => REPO_PROJECT };
        const r = await stdoutOf(() => deployCommand(argv("deploy", "--git", "release", "--no-follow", "--json"), PROJECT_ID));
        expect(invoke).toHaveBeenCalledWith("deploy", { projectId: PROJECT_ID, client: "cli", branch: "release" });
        expect(r.json()).toMatchObject({ deploymentId: "d9", source: "git", branch: "release", following: false });
    });

    it("refuses a flag that describes a local build, before anything is called", async () => {
        const r = await stdoutOf(() => deployCommand(argv("deploy", "--git", "--bundle"), PROJECT_ID));
        expect(errorOf(r).code).toBe("usage");
        expect(errorOf(r).message).toContain("--bundle");
        expect(context.requireClient).not.toHaveBeenCalled();
    });

    it("refuses a project with no repository connected", async () => {
        tables.projects = { findById: () => ({ ...REPO_PROJECT, gitRepoUrl: "" }) };
        const r = await stdoutOf(() => deployCommand(argv("deploy", "--git"), PROJECT_ID));
        expect(errorOf(r).code).toBe("no_git_repository");
        expect(invoke).not.toHaveBeenCalledWith("deploy", expect.anything());
    });

    it("refuses to eject a managed project without --eject", async () => {
        tables.projects = { findById: () => ({ ...REPO_PROJECT, runtimeMode: "managed" }) };
        const r = await stdoutOf(() => deployCommand(argv("deploy", "--git"), PROJECT_ID));
        expect(errorOf(r).code).toBe("managed_project");
        expect(invoke).not.toHaveBeenCalledWith("deploy", expect.anything());
    });
});

/* ── confirmations on destructive commands ─────────────────────── */

describe("destructive commands ask first", () => {
    it("env unset: refuses without --yes and removes nothing; removes with it", async () => {
        const refused = await stdoutOf(() => envCommand("unset", argv("env", "unset", "STRIPE_KEY")));
        expect(errorOf(refused).code).toBe("confirmation_required");
        expect(invoke).not.toHaveBeenCalled();

        answer = () => ({ success: true, pendingRedeploy: true });
        await stdoutOf(() => envCommand("unset", argv("env", "unset", "STRIPE_KEY", "--yes")));
        expect(invoke).toHaveBeenCalledWith("env-vars", undefined, { method: "DELETE", path: `${PROJECT_ID}/STRIPE_KEY` });
    });

    it("compute set: refuses without --yes and changes nothing; changes with it", async () => {
        tables.projects = { findById: () => ({ id: PROJECT_ID, cpu: "250m" }) };
        answer = (name) => (name === "pricing" ? { lines: [], totalEur: 12 } : undefined);
        const refused = await stdoutOf(() => computeCommand("set", argv("compute", "set", "--cpu", "500m")));
        expect(errorOf(refused).code).toBe("confirmation_required");
        expect(updates).toEqual([]);
        // The quote for the new dials was asked before the question.
        expect(invoke).toHaveBeenCalledWith("pricing", expect.objectContaining({ cpu: "500m" }), { method: "POST", path: "quote" });

        await stdoutOf(() => computeCommand("set", argv("compute", "set", "--cpu", "500m", "--yes")));
        expect(updates).toEqual([{ table: "projects", id: PROJECT_ID, data: { cpu: "500m" } }]);
    });

    it("db access enable: refuses without --yes and opens nothing", async () => {
        const refused = await stdoutOf(() => dbAccessCommand(argv("db", "access", "enable", "--allow", "34.89.253.13")));
        expect(errorOf(refused).code).toBe("confirmation_required");
        expect(invoke).not.toHaveBeenCalled();
    });
});

/* ── not_served ────────────────────────────────────────────────── */

describe("a control plane without the route", () => {
    it("is told apart from a route refusing the request", () => {
        expect(isRouteNotServed(notServed())).toBe(true);
        expect(isRouteNotServed(Object.assign(new Error("Not Found"), { status: 404 }))).toBe(true);
        expect(isRouteNotServed(Object.assign(new Error("No route for GET /api/functions/usage/p on this backend."), { status: 404, code: "NOT_FOUND" }))).toBe(true);
        expect(isRouteNotServed(Object.assign(new Error("Project not found"), { status: 404, code: "not_found" }))).toBe(false);
        expect(isRouteNotServed(Object.assign(new Error("Not Found"), { status: 500 }))).toBe(false);
        expect(isRouteNotServed("Not Found")).toBe(false);
    });

    it("answers not_served from a command whose function is not mounted", async () => {
        answer = () => {
            throw notServed();
        };
        const usage = await stdoutOf(() => usageCommand(argv("usage")));
        expect(errorOf(usage)).toMatchObject({ code: "not_served", message: "This control plane does not serve usage reports yet." });

        const window = await stdoutOf(() => computeWindowCommand(argv("compute", "window")));
        expect(errorOf(window).code).toBe("not_served");
    });

    it("answers a project's own 404 as it always did", async () => {
        answer = () => {
            throw Object.assign(new Error("Project not found"), { status: 404, code: "not_found" });
        };
        const r = await stdoutOf(() => usageCommand(argv("usage")));
        expect(errorOf(r).code).not.toBe("not_served");
    });

    it("app-key: not_served on a bare 404, which a control plane from before the envelope sends", async () => {
        answer = () => {
            throw Object.assign(new Error("Not Found"), { status: 404 });
        };
        const r = await stdoutOf(() => appKeyCommand(argv("app-key")));
        expect(errorOf(r)).toMatchObject({ code: "not_served", message: "This control plane does not serve app keys yet." });
    });

    it("leaves the maintenance section out of status, and says which", async () => {
        tables.projects = { findById: () => ({ id: PROJECT_ID, name: "Shop", subdomain: "shop", status: "active" }) };
        answer = (name) => {
            if (name === "maintenance") throw Object.assign(new Error("No function 'maintenance'."), { status: 404, code: "FUNCTION_NOT_FOUND" });
            return undefined;
        };
        const r = await stdoutOf(() => statusCommand(argv("status")));
        expect(r.json()).toMatchObject({ maintenance: null, notServed: ["maintenance"] });
    });
});
