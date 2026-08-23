/**
 * The panel's client for live schema editing.
 *
 * The interesting behaviour is in the failures, not the successes. A schema
 * change has three verdicts and two of them are refusals, so this client's job
 * is largely to keep three different unhappy outcomes distinguishable:
 *
 * - the change is **refused** — the user needs to read why, and what to do;
 * - the feature is **unavailable** — a Mongo backend, or a bundle deployment
 *   with no source. Nothing about the change is wrong;
 * - the request **broke** — everything else.
 *
 * Collapsing the second into the first would tell somebody their perfectly good
 * change was rejected; collapsing the first into the second would hide the
 * explanation they need.
 */
import {
    createLiveSchemaClient,
    asUnavailable,
    LiveSchemaError
} from "../../src/collection_editor/liveSchemaClient";

const CHANGE = { collectionId: "posts", collection: { name: "Posts", properties: {} } };

function stub(response: {
    ok?: boolean;
    status?: number;
    body?: unknown;
    text?: string;
}) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return {
            ok: response.ok ?? true,
            status: response.status ?? 200,
            json: async () => {
                if (response.body === undefined) throw new Error("not json");
                return response.body;
            },
            text: async () => response.text ?? ""
        } as unknown as Response;
    }) as unknown as typeof fetch;
    return { fetchImpl, calls };
}

const client = (s: ReturnType<typeof stub>, getAuthToken?: () => string | null) =>
    createLiveSchemaClient({
        baseUrl: "https://api.example.com/api/schema/",
        fetchImpl: s.fetchImpl,
        getAuthToken
    });

describe("requests", () => {
    it("posts the change to /plan and returns the plan", async () => {
        const s = stub({ body: { applicable: true, verdict: "safe", changes: [], statements: [], files: [], message: "m" } });
        const plan = await client(s).plan(CHANGE);

        expect(plan.applicable).toBe(true);
        expect(s.calls[0].url).toBe("https://api.example.com/api/schema/plan");
        expect(JSON.parse(s.calls[0].init.body as string)).toEqual(CHANGE);
    });

    it("posts to /apply and returns the result", async () => {
        const s = stub({ body: { applied: true, committed: { sha: "abc", branch: "main", files: [] }, statements: [], summary: "done" } });
        const result = await client(s).apply(CHANGE);

        expect(result.applied).toBe(true);
        expect(s.calls[0].url).toBe("https://api.example.com/api/schema/apply");
    });

    it("trims a trailing slash rather than producing a double one", async () => {
        const s = stub({ body: {} });
        await client(s).plan(CHANGE);
        expect(s.calls[0].url).not.toContain("//plan");
    });

    it("sends the auth token when there is one", async () => {
        const s = stub({ body: {} });
        await client(s, () => "tok").plan(CHANGE);
        expect((s.calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    });

    it("omits the header when there is no token, rather than sending `Bearer null`", async () => {
        const s = stub({ body: {} });
        await client(s, () => null).plan(CHANGE);
        expect((s.calls[0].init.headers as Record<string, string>).Authorization).toBeUndefined();
    });
});

describe("a refused change", () => {
    const refusal = {
        ok: false,
        status: 400,
        body: {
            error: {
                code: "SCHEMA_CHANGE_UNAPPLICABLE",
                message: "This change cannot be applied:\n  • \"subtitle\" was removed…",
                details: {
                    changes: [{
                        kind: "remove-property",
                        verdict: "needs-migration",
                        collection: "posts",
                        property: "subtitle",
                        detail: "\"subtitle\" was removed",
                        remedy: "Remove it in a migration you have read."
                    }]
                }
            }
        }
    };

    it("throws with the server's explanation, not a status code", async () => {
        await expect(client(stub(refusal)).apply(CHANGE)).rejects.toThrow(/subtitle/);
    });

    it("carries the individual changes, so a UI can list them", async () => {
        const err = await client(stub(refusal)).apply(CHANGE).catch(e => e as LiveSchemaError);
        expect(err.code).toBe("SCHEMA_CHANGE_UNAPPLICABLE");
        expect(err.changes).toHaveLength(1);
        expect(err.changes![0].remedy).toContain("migration");
    });

    it("is NOT reported as the feature being unavailable", async () => {
        const err = await client(stub(refusal)).apply(CHANGE).catch(e => e);
        expect(asUnavailable(err)).toBeUndefined();
    });
});

describe("the feature being unavailable", () => {
    const unavailable = (code: string, message: string) => ({
        ok: false, status: 503, body: { error: { code, message } }
    });

    it("recognises a driver that cannot plan", async () => {
        const err = await client(stub(unavailable(
            "SCHEMA_EDITING_UNSUPPORTED", "This backend's driver cannot plan schema changes."
        ))).plan(CHANGE).catch(e => e);

        expect(asUnavailable(err)).toEqual({
            reason: "unsupported",
            message: "This backend's driver cannot plan schema changes."
        });
    });

    it("recognises a deployment with no repository", async () => {
        const err = await client(stub(unavailable(
            "SCHEMA_EDITING_NO_REPOSITORY", "There is no repository to commit to."
        ))).apply(CHANGE).catch(e => e);

        expect(asUnavailable(err)?.reason).toBe("no-repository");
    });

    it("does not treat an arbitrary error as unavailable", async () => {
        expect(asUnavailable(new Error("network"))).toBeUndefined();
        expect(asUnavailable(new LiveSchemaError("boom", undefined))).toBeUndefined();
        expect(asUnavailable(new LiveSchemaError("boom", "SOMETHING_ELSE"))).toBeUndefined();
    });
});

describe("a broken response", () => {
    it("falls back to the body text when the error is not JSON", async () => {
        const s = stub({ ok: false, status: 502, text: "upstream reset" });
        await expect(client(s).plan(CHANGE)).rejects.toThrow(/upstream reset/);
    });

    it("names the status when there is nothing else to say", async () => {
        const s = stub({ ok: false, status: 500, text: "" });
        await expect(client(s).plan(CHANGE)).rejects.toThrow(/500/);
    });
});
