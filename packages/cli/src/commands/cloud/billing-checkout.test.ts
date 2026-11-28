/**
 * Regression tests for `rebase cloud billing checkout` when checkout is skipped
 * (card on file / already paid) and `rebase cloud access-token` piped output.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { billingCommand } from "./resources";
import { setJsonModeForTest, initOutputMode, isJsonMode } from "./context";
import * as context from "./context";
import { fakeCloudClient } from "../../../test/helpers/cloud-client";

describe("rebase cloud billing checkout — skipped checkout responses", () => {
    let stdout: string[];
    let stderr: string[];

    beforeEach(() => {
        stdout = [];
        stderr = [];
        vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
            stdout.push(String(chunk));
            return true;
        }) as typeof process.stdout.write);
        vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
            stderr.push(String(chunk));
            return true;
        }) as typeof process.stderr.write);
        vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
            stdout.push(args.map(String).join(" ") + "\n");
        });
        vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
            stderr.push(args.map(String).join(" ") + "\n");
        });
        vi.spyOn(process, "exit").mockImplementation((code) => {
            throw new Error(`__exit_${Number(code ?? 0)}`);
        });
        setJsonModeForTest(false);
    });

    afterEach(() => {
        setJsonModeForTest(false);
        vi.restoreAllMocks();
    });

    function mockClient(sessionResponse: { url: string; skipped?: string }) {
        const fakeClient = fakeCloudClient({
            invoke: () => sessionResponse,
            collection: (slug) => ({
                findById: () => {
                    if (slug === "projects") return { id: "proj-1", subdomain: "acme", organization: "org-1" };
                    if (slug === "organizations") return { id: "org-1", slug: "acme-org" };
                    return undefined;
                }
            })
        });

        vi.spyOn(context, "requireClient").mockResolvedValue({
            client: fakeClient,
            url: "https://app.rebase.pro"
        });
        vi.spyOn(context, "requireProject").mockResolvedValue("proj-1");
    }

    it("resolves the relative setup URL and reports card_on_file clearly", async () => {
        mockClient({ url: "/p/acme/setup", skipped: "card_on_file" });

        await billingCommand(["node", "rebase", "cloud", "billing", "checkout", "--project", "acme"]);

        const out = stdout.join("") + stderr.join("");
        expect(out).toContain("Billed card on file");
        expect(out).toContain("https://app.rebase.pro/o/acme-org/p/acme/setup");
        expect(out).not.toContain("Complete checkout in your browser");
    });

    it("emits resolved full URL and skipped reason in JSON mode for already_paid", async () => {
        setJsonModeForTest(true);
        mockClient({ url: "/p/acme/setup", skipped: "already_paid" });

        await billingCommand(["node", "rebase", "cloud", "billing", "checkout", "--project", "acme", "--json"]);

        const parsed = JSON.parse(stdout.join("")) as { url: string; projectId: string; skipped: string };
        expect(parsed).toEqual({
            url: "https://app.rebase.pro/o/acme-org/p/acme/setup",
            projectId: "proj-1",
            skipped: "already_paid"
        });
    });

    it("prints the Stripe Checkout URL verbatim when checkout is not skipped", async () => {
        mockClient({ url: "https://checkout.stripe.com/c/pay/cs_test_123" });

        await billingCommand(["node", "rebase", "cloud", "billing", "checkout", "--project", "acme"]);

        const out = stdout.join("");
        expect(out).toContain("Complete checkout in your browser:");
        expect(out).toContain("https://checkout.stripe.com/c/pay/cs_test_123");
    });
});

describe("access-token output mode when piped", () => {
    afterEach(() => {
        setJsonModeForTest(false);
        delete process.env.REBASE_JSON;
    });

    it("stays in human (bare token) mode when piped unless --json is passed", () => {
        initOutputMode(["node", "rebase", "cloud", "access-token"], { whenPiped: "human" });
        expect(isJsonMode()).toBe(false);

        initOutputMode(["node", "rebase", "cloud", "access-token", "--json"], { whenPiped: "human" });
        expect(isJsonMode()).toBe(true);
    });
});
