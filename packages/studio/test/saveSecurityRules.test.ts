import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { saveSecurityRulesToCodebase } from "../src/components/RLSEditor/saveSecurityRules";
import { FakeResponse } from "./helpers/fakeResponse";

/**
 * The RLS editor's two writes into the codebase went out unauthenticated.
 *
 * The schema-editor routes are behind an admin gate that reads a bearer token
 * and has no cookie fallback, so "Create policy" and "Import to codebase" were
 * a 401 every time on every mapped table — reported to the user as a constant
 * "Failed to save policy", which says nothing about which of the several
 * possible failures it was.
 */
describe("saveSecurityRulesToCodebase", () => {
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

        await saveSecurityRulesToCodebase({
            apiBase: "http://localhost:3001/api",
            collectionId: "posts",
            securityRules: [{ operation: "select", ownerField: "author_id" }],
            getAuthToken: async () => "a-token"
        });

        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe("http://localhost:3001/api/admin/schema-editor/collection/save");
        expect(new Headers(calls[0].init.headers).get("Authorization")).toBe("Bearer a-token");
    });

    it("marks the write as partial — it carries one key, not a whole collection", async () => {
        const calls = captureRequest(ok());

        await saveSecurityRulesToCodebase({
            apiBase: "/api",
            collectionId: "posts",
            securityRules: [],
            getAuthToken: async () => "a-token"
        });

        expect(JSON.parse(String(calls[0].init.body))).toEqual({
            collectionId: "posts",
            collectionData: { securityRules: [] },
            partial: true
        });
    });

    it("reports what the backend said instead of a constant string", async () => {
        captureRequest(new FakeResponse({
            status: 401,
            text: JSON.stringify({ error: { message: "Admin role required." } })
        }));

        await expect(saveSecurityRulesToCodebase({
            apiBase: "/api",
            collectionId: "posts",
            securityRules: [],
            getAuthToken: async () => null
        })).rejects.toThrow("Admin role required.");
    });

    it("falls back to the status code when the body says nothing", async () => {
        captureRequest(new FakeResponse({ status: 501, text: "" }));

        await expect(saveSecurityRulesToCodebase({
            apiBase: "/api",
            collectionId: "posts",
            securityRules: []
        })).rejects.toThrow("HTTP 501");
    });
});
