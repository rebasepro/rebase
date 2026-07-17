/**
 * Tests for tenant hostname rendering in the `rebase cloud` commands.
 *
 * The CLI used to hardcode `<subdomain>.rebase.pro`, which stopped being true
 * when tenants moved to `apps.rebase.pro` — `projects create` then printed a URL
 * that resolves nowhere near the user's app. The host is per-deployment config,
 * so it can only come from the control plane (`platform-config`).
 */
import { describe, it, expect, vi } from "vitest";
import { fetchTenantBaseDomain, formatTenantHost, projectHost, type CloudClient } from "./context";

/** A client whose only exercised surface is `functions.invoke`. */
function fakeClient(invoke: (name: string) => Promise<unknown>): CloudClient {
    return { functions: { invoke: vi.fn(invoke) } } as unknown as CloudClient;
}

describe("formatTenantHost", () => {
    it("joins the subdomain to the base domain the control plane reports", () => {
        expect(formatTenantHost("acme", "apps.rebase.pro")).toBe("acme.apps.rebase.pro");
    });

    it("does not assume a domain when the base domain is unknown", () => {
        // The bare subdomain is honest; `acme.rebase.pro` would look reachable
        // and send the user debugging a hostname we invented.
        expect(formatTenantHost("acme", undefined)).toBe("acme");
    });

    it("renders nothing for a project with no subdomain", () => {
        expect(formatTenantHost(undefined, "apps.rebase.pro")).toBeUndefined();
    });
});

describe("projectHost", () => {
    it("prefers the host the control plane resolved", () => {
        // The server reads the project's cluster (admin-only under RLS, so the
        // CLI cannot) and resolves the host the ingress actually serves.
        expect(projectHost(
            { subdomain: "acme", host: "acme.apps-europe-west1.rebase.pro" },
            "apps.rebase.pro"
        )).toBe("acme.apps-europe-west1.rebase.pro");
    });

    it("falls back to the base domain against a control plane without the hook", () => {
        // Verified against production, which does not yet send `host`.
        expect(projectHost({ subdomain: "acme" }, "apps.rebase.pro")).toBe("acme.apps.rebase.pro");
    });

    it("falls back to the bare subdomain when neither is known", () => {
        expect(projectHost({ subdomain: "acme" }, undefined)).toBe("acme");
    });
});

describe("fetchTenantBaseDomain", () => {
    it("reads the base domain from platform-config", async () => {
        const client = fakeClient(async () => ({ tenantBaseDomain: "apps.rebase.pro" }));
        await expect(fetchTenantBaseDomain(client, "https://a.example")).resolves.toBe("apps.rebase.pro");
        expect(client.functions.invoke).toHaveBeenCalledWith("platform-config", undefined, { method: "GET" });
    });

    it("caches per host, so a 100-row project list costs one request", async () => {
        const client = fakeClient(async () => ({ tenantBaseDomain: "apps.rebase.pro" }));
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
