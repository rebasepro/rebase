import { saveSecurityRulesToCodebase } from "../src/components/RLSEditor/saveSecurityRules";

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
        global.fetch = jest.fn(async (url: unknown, init: unknown) => {
            calls.push({ url: String(url), init: init as RequestInit });
            return response;
        }) as unknown as typeof fetch;
        return calls;
    };

    const ok = () => ({ ok: true, status: 200, text: async () => "" }) as unknown as Response;

    it("sends the bearer token the admin gate requires", async () => {
        const calls = captureRequest(ok());

        await saveSecurityRulesToCodebase({
            apiBase: "http://localhost:3001/api",
            collectionId: "posts",
            securityRules: [{ operation: "select", ownerField: "author_id" }],
            getAuthToken: async () => "a-token"
        });

        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe("http://localhost:3001/api/schema-editor/collection/save");
        expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer a-token");
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
        captureRequest({
            ok: false,
            status: 401,
            text: async () => JSON.stringify({ error: { message: "Admin role required." } })
        } as unknown as Response);

        await expect(saveSecurityRulesToCodebase({
            apiBase: "/api",
            collectionId: "posts",
            securityRules: [],
            getAuthToken: async () => null
        })).rejects.toThrow("Admin role required.");
    });

    it("falls back to the status code when the body says nothing", async () => {
        captureRequest({ ok: false, status: 501, text: async () => "" } as unknown as Response);

        await expect(saveSecurityRulesToCodebase({
            apiBase: "/api",
            collectionId: "posts",
            securityRules: []
        })).rejects.toThrow("HTTP 501");
    });
});
