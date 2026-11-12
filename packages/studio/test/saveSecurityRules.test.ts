import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { postTablePatches } from "../src/components/RLSEditor/saveSecurityRules";
import { FakeResponse } from "./helpers/fakeResponse";

/**
 * The RLS editor's writes into the codebase: `{ patches }`, authenticated.
 *
 * They once went out unauthenticated.
 *
 * The schema-editor routes are behind an admin gate that reads a bearer token
 * and has no cookie fallback, so "Create policy" and "Import to codebase" were
 * a 401 every time on every mapped table — reported to the user as a constant
 * "Failed to save policy", which says nothing about which of the several
 * possible failures it was.
 */
describe("postTablePatches", () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
    });

    const captureRequest = (response: Response) => {
        const calls: { url: string, init: RequestInit }[] = [];
        global.fetch = jest.fn<typeof fetch>(async (url, init) => {
            calls.push({ url: String(url), init: init ?? {} });
            return response;
        });
        return calls;
    };

    const ok = () => new FakeResponse({ text: "" });

    it("sends the bearer token the admin gate requires", async () => {
        const calls = captureRequest(ok());

        await postTablePatches({
            apiBase: "http://localhost:3001/api",
            patches: [{ op: "addRule", table: "posts", rule: { operation: "select", ownerField: "author_id" } }],
            getAuthToken: async () => "a-token"
        });

        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe("http://localhost:3001/api/admin/schema-editor/apply");
        expect(new Headers(calls[0].init.headers).get("Authorization")).toBe("Bearer a-token");
    });

    it("sends the operations and nothing else — the rest of the table stays as written", async () => {
        const calls = captureRequest(ok());

        await postTablePatches({
            apiBase: "/api",
            patches: [{ op: "replaceRule", table: "posts", index: 1, rule: { operation: "select", roles: ["editor"] } }],
            getAuthToken: async () => "a-token"
        });

        expect(JSON.parse(String(calls[0].init.body))).toEqual({
            patches: [{ op: "replaceRule", table: "posts", index: 1, rule: { operation: "select", roles: ["editor"] } }]
        });
    });

    it("reports what the backend said instead of a constant string", async () => {
        captureRequest(new FakeResponse({
            status: 401,
            text: JSON.stringify({ error: { message: "Admin role required." } })
        }));

        await expect(postTablePatches({
            apiBase: "/api",
            patches: [{ op: "setRls", table: "posts", rls: "admin-only" }],
            getAuthToken: async () => null
        })).rejects.toThrow("Admin role required.");
    });

    it("falls back to the status code when the body says nothing", async () => {
        captureRequest(new FakeResponse({ status: 501, text: "" }));

        await expect(postTablePatches({
            apiBase: "/api",
            patches: [{ op: "setRls", table: "posts", rls: "admin-only" }]
        })).rejects.toThrow("HTTP 501");
    });
});
