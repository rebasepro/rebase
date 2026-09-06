/**
 * Tests for tenant hostname rendering in the `rebase cloud` commands.
 *
 * The CLI used to hardcode `<subdomain>.rebase.pro`, which stopped being true
 * when tenants moved to `rebase.website` — `projects create` then printed a URL
 * that resolves nowhere near the user's app. The host is per-deployment config,
 * so it can only come from the control plane (`platform-config`).
 */
import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
    fetchDeployTargets,
    fetchTenantBaseDomain,
    formatTenantHost,
    initOutputMode,
    projectHost,
    refuseDirectLink,
    resolveCloudUrl,
    setJsonModeForTest,
    type CloudClient
} from "./context";
import { printEnvHelp } from "./env";

/** A client whose only exercised surface is `functions.invoke`. */
function fakeClient(invoke: (name: string) => Promise<unknown>): CloudClient {
    return { functions: { invoke: vi.fn(invoke) } } as unknown as CloudClient;
}

describe("formatTenantHost", () => {
    it("joins the subdomain to the base domain the control plane reports", () => {
        expect(formatTenantHost("acme", "rebase.website")).toBe("acme.rebase.website");
    });

    it("does not assume a domain when the base domain is unknown", () => {
        // The bare subdomain is honest; `acme.rebase.pro` would look reachable
        // and send the user debugging a hostname we invented.
        expect(formatTenantHost("acme", undefined)).toBe("acme");
    });

    it("renders nothing for a project with no subdomain", () => {
        expect(formatTenantHost(undefined, "rebase.website")).toBeUndefined();
    });
});

describe("projectHost", () => {
    it("prefers the host the control plane resolved", () => {
        // The server reads the project's cluster (admin-only under RLS, so the
        // CLI cannot) and resolves the host the ingress actually serves.
        expect(projectHost(
            { subdomain: "acme",
host: "acme.europe-west1.rebase.website" },
            "rebase.website"
        )).toBe("acme.europe-west1.rebase.website");
    });

    it("falls back to the base domain against a control plane without the hook", () => {
        // Verified against production, which does not yet send `host`.
        expect(projectHost({ subdomain: "acme" }, "rebase.website")).toBe("acme.rebase.website");
    });

    it("falls back to the bare subdomain when neither is known", () => {
        expect(projectHost({ subdomain: "acme" }, undefined)).toBe("acme");
    });
});

describe("fetchTenantBaseDomain", () => {
    it("reads the base domain from platform-config", async () => {
        const client = fakeClient(async () => ({ tenantBaseDomain: "rebase.website" }));
        await expect(fetchTenantBaseDomain(client, "https://a.example")).resolves.toBe("rebase.website");
        expect(client.functions.invoke).toHaveBeenCalledWith("platform-config", undefined, { method: "GET" });
    });

    it("caches per host, so a 100-row project list costs one request", async () => {
        const client = fakeClient(async () => ({ tenantBaseDomain: "rebase.website" }));
        const url = "https://cached.example";
        await Promise.all([fetchTenantBaseDomain(client, url), fetchTenantBaseDomain(client, url)]);
        await fetchTenantBaseDomain(client, url);
        expect(client.functions.invoke).toHaveBeenCalledTimes(1);
    });

    it("falls back to undefined when the control plane has no platform-config", async () => {
        // An older control plane 404s here; the CLI must still list projects.
        const client = fakeClient(async () => {
            throw Object.assign(new Error("Not found"), { status: 404 });
        });
        await expect(fetchTenantBaseDomain(client, "https://old.example")).resolves.toBeUndefined();
    });

    it("treats a blank base domain as unknown rather than building `acme.`", async () => {
        const client = fakeClient(async () => ({ tenantBaseDomain: "   " }));
        await expect(fetchTenantBaseDomain(client, "https://blank.example")).resolves.toBeUndefined();
    });
});

describe("fetchDeployTargets", () => {
    it("reads the infrastructure the control plane says exists", async () => {
        const client = fakeClient(async () => ({
            tenantBaseDomain: "rebase.website",
            deployTargets: [{ clusterId: null,
provider: "gcp",
region: "europe-west1" }]
        }));
        await expect(fetchDeployTargets(client, "https://t.example")).resolves.toEqual([
            { clusterId: null,
provider: "gcp",
region: "europe-west1" }
        ]);
    });

    it("shares one request with the base-domain lookup", async () => {
        // Both read the same `platform-config` document, and `projects create`
        // needs both. Two round trips for one document would be one too many.
        const client = fakeClient(async () => ({ tenantBaseDomain: "rebase.website",
deployTargets: [] }));
        const url = "https://shared.example";
        await Promise.all([fetchTenantBaseDomain(client, url), fetchDeployTargets(client, url)]);
        expect(client.functions.invoke).toHaveBeenCalledTimes(1);
    });

    it("distinguishes an empty list from a control plane that cannot answer", async () => {
        // `[]` is an answer — no infrastructure configured — and `undefined` is
        // a gap. `projects create` treats them differently: it refuses on the
        // first and keeps its historical default on the second.
        const empty = fakeClient(async () => ({ deployTargets: [] }));
        await expect(fetchDeployTargets(empty, "https://empty.example")).resolves.toEqual([]);

        const old = fakeClient(async () => {
            throw Object.assign(new Error("Not found"), { status: 404 });
        });
        await expect(fetchDeployTargets(old, "https://old-targets.example")).resolves.toBeUndefined();
    });

    it("treats a non-array `deployTargets` as no answer at all", async () => {
        const client = fakeClient(async () => ({ deployTargets: "gcp" }));
        await expect(fetchDeployTargets(client, "https://junk.example")).resolves.toBeUndefined();
    });
});

/**
 * Which language `--help` answers in.
 *
 * "stdout is not a TTY" is the right rule for a RESULT and the wrong one for a
 * help page: `rebase cloud db --help | less` is a person asking for the page.
 * There was no way to say so — `--json` could only turn the mode on, and
 * `REBASE_JSON` was tested against the literal `"1"`, so every other value
 * including `"0"` fell through to the TTY test and set it anyway.
 */
describe("initOutputMode", () => {
    const before = process.env.REBASE_JSON;
    afterEach(() => {
        if (before === undefined) delete process.env.REBASE_JSON;
        else process.env.REBASE_JSON = before;
        setJsonModeForTest(false);
    });

    it("honours REBASE_JSON=0 against a pipe", () => {
        process.env.REBASE_JSON = "0";
        expect(initOutputMode(["node", "rebase", "cloud", "env", "--help"])).toBe(false);
    });

    it("still lets --json win over REBASE_JSON=0", () => {
        // Most explicit wins: the flag is on the line the caller just typed.
        process.env.REBASE_JSON = "0";
        expect(initOutputMode(["node", "rebase", "cloud", "env", "--json"])).toBe(true);
    });

    it("takes REBASE_JSON=1 on a terminal", () => {
        process.env.REBASE_JSON = "1";
        expect(initOutputMode(["node", "rebase", "cloud", "env"])).toBe(true);
    });
});

/**
 * A piped group page carries the same content as the terminal one.
 *
 * It did not. `emitHelp` was handed a list of action WORDS, so
 * `rebase cloud env --help | cat` answered
 * `{"command":"env","actions":["list","set","unset","reveal","pull"]}` — no
 * descriptions, no flags, and not the paragraph about build-time variables that
 * is the reason the page exists. This family forces JSON mode off a TTY, so that
 * was every scripted and every agent-driven read of it. One description now,
 * rendered twice.
 */
describe("printGroupHelp", () => {
    afterEach(() => setJsonModeForTest(false));

    function pipedPage(print: () => void): Record<string, unknown> {
        setJsonModeForTest(true);
        const chunks: string[] = [];
        const original = process.stdout.write.bind(process.stdout);
        process.stdout.write = (chunk: string) => {
            chunks.push(String(chunk));
            return true;
        };
        try {
            print();
        } finally {
            process.stdout.write = original;
        }
        return JSON.parse(chunks.join("")) as Record<string, unknown>;
    }

    it("carries every action's description and flags", () => {
        const page = pipedPage(printEnvHelp) as {
            command: string;
            actions: Array<{ action: string; description: string; flags: Array<{ flag: string }> }>;
            notes: string[];
        };

        expect(page.command).toBe("cloud env");
        const set = page.actions.find(a => a.action === "set");
        expect(set?.description).toBeTruthy();
        expect(set?.flags.map(f => f.flag)).toContain("--secret");
        // The paragraph that only existed in the terminal rendering.
        expect(page.notes.join(" ")).toContain("BUILD time");
    });

    it("names the globals, so a reader does not have to find the index page", () => {
        const page = pipedPage(printEnvHelp) as { globalFlags: Array<{ flag: string }> };
        expect(page.globalFlags.map(f => f.flag)).toContain("--json");
    });
});

/* ══════════════════════════════════════════════════════════════════
   A direct link is a tenant, not a control plane
   ══════════════════════════════════════════════════════════════════ */

/**
 * `rebase cloud link <url>` writes `{ mode: "direct" }` and points this checkout
 * at ONE running backend — "no control plane, no login", per its own help page.
 * `resolveCloudUrl` used to hand that URL to the whole `cloud` family whatever
 * the mode, which made the customer's own server the control plane: `whoami`
 * reported "Not logged in to https://example.com", and following that printed
 * remedy POSTed the user's control-plane email and password to the tenant host.
 */
describe("a direct link never becomes the control plane", () => {
    /** `rebase cloud <words…>` as `process.argv`. */
    function argv(...words: string[]): string[] {
        return ["/usr/bin/node", "/x/y/rebase.js", "cloud", ...words];
    }

    /**
     * A scratch directory holding `.rebase/cloud.json`, with `HOME` inside it.
     *
     * The home redirect matters: a stored `current` context would answer before
     * the default control plane does, and what is under test is what happens
     * with nothing but the link file.
     */
    function linkedDirectory(link: Record<string, unknown>): string {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-link-"));
        fs.mkdirSync(path.join(root, ".rebase"), { recursive: true });
        fs.writeFileSync(path.join(root, ".rebase", "cloud.json"), JSON.stringify(link));
        vi.spyOn(process, "cwd").mockReturnValue(root);
        vi.spyOn(os, "homedir").mockReturnValue(path.join(root, "home"));
        return root;
    }

    /** Run something that must `fail`, and return the parsed `{error}` payload. */
    function refusalOf(run: () => unknown): { message: string; code: string | null } {
        const chunks: string[] = [];
        const originalWrite = process.stdout.write.bind(process.stdout);
        process.stdout.write = (s: string) => {
            chunks.push(typeof s === "string" ? s : String(s));
            return true;
        };
        const exit = vi.spyOn(process, "exit").mockImplementation(((): never => {
            throw new Error("__exit__");
        }) as never);
        let exited = false;
        try {
            run();
        } catch (e) {
            exited = e instanceof Error && e.message === "__exit__";
            if (!exited) throw e;
        } finally {
            process.stdout.write = originalWrite;
            exit.mockRestore();
        }
        expect(exited).toBe(true);
        return JSON.parse(chunks.join("").trim()).error;
    }

    afterEach(() => {
        vi.restoreAllMocks();
        delete process.env.REBASE_CLOUD_URL;
    });

    it("resolves the default control plane, not the linked backend", () => {
        linkedDirectory({ url: "https://example.com",
projectId: "",
apiUrl: "https://example.com",
mode: "direct" });
        expect(resolveCloudUrl(argv("whoami"))).toBe("https://app.rebase.pro");
    });

    it("still resolves a cloud link, which is a control plane", () => {
        linkedDirectory({ url: "https://console.example.com",
projectId: "42",
mode: "cloud" });
        expect(resolveCloudUrl(argv("whoami"))).toBe("https://console.example.com");
    });

    /** Every link written before `mode` existed is a cloud link. */
    it("treats a link with no mode as a cloud link", () => {
        linkedDirectory({ url: "https://console.example.com",
projectId: "42" });
        expect(resolveCloudUrl(argv("whoami"))).toBe("https://console.example.com");
    });

    it("refuses a control-plane command, naming the link and both ways out", () => {
        linkedDirectory({ url: "https://example.com",
projectId: "",
mode: "direct" });
        setJsonModeForTest(true);
        try {
            const error = refusalOf(() => refuseDirectLink(argv("whoami")));
            expect(error.code).toBe("direct_link");
            expect(error.message).toContain("https://example.com");
            expect(error.message).toContain("rebase cloud unlink");
            expect(error.message).toContain("--project");
        } finally {
            setJsonModeForTest(false);
        }
    });

    it("lets through a line that says which control-plane subject it means", () => {
        linkedDirectory({ url: "https://example.com",
projectId: "",
mode: "direct" });
        expect(() => refuseDirectLink(argv("logs", "--project", "shop"))).not.toThrow();
        expect(() => refuseDirectLink(argv("whoami", "--url", "https://app.rebase.pro"))).not.toThrow();
    });

    it("says nothing in a cloud-linked directory", () => {
        linkedDirectory({ url: "https://console.example.com",
projectId: "42",
mode: "cloud" });
        expect(() => refuseDirectLink(argv("whoami"))).not.toThrow();
    });
});
