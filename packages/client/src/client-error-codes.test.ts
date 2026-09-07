import { createRebaseClient } from "./index";
import { RebaseApiError, RebaseClientError } from "@rebasepro/types";

/**
 * Every client-side failure carries a code.
 *
 * `RebaseClientError`'s constructor took a message and nothing else, so an
 * undefined filter value, an unknown accessor, `listen()` on a client built
 * with `realtime: false`, a function name with a `/` and `refreshSession()`
 * while signed out all arrived with `code === undefined` — and the `switch
 * (e.code)` the errors documentation shows fell to `default: throw e` for every
 * one of them. `OFFLINE` was the only client-side code that worked, because
 * that one path minted a `RebaseApiError` instead.
 */
describe("a client-side error", () => {
    beforeEach(() => { jest.spyOn(console, "warn").mockImplementation(() => undefined); });

    const fetchStub: typeof fetch = async () => new Response(JSON.stringify({ data: [] }), {
        status: 200, headers: { "Content-Type": "application/json" }
    });

    const client = (options: Record<string, unknown> = {}) => createRebaseClient({
        baseUrl: "http://localhost:9999",
        realtime: false,
        fetch: fetchStub,
        ...options
    });

    /** Run `fn`, and hand back the `RebaseClientError` it threw. */
    async function refusal(fn: () => unknown): Promise<RebaseClientError> {
        try {
            await fn();
        } catch (error) {
            expect(error).toBeInstanceOf(RebaseClientError);
            return error as RebaseClientError;
        }
        throw new Error("expected a refusal");
    }

    it("INVALID_FILTER — a filter value that is `undefined`", async () => {
        const error = await refusal(() =>
            client().data.collection("posts").find({ where: { title: ["==", undefined] } as never }));

        expect(error.code).toBe("INVALID_FILTER");
        expect(error.message).toContain("title");
        expect((error.details as { field?: string })?.field).toBe("title");
    });

    it("UNKNOWN_COLLECTION — an accessor that is not in the dictionary", async () => {
        const typed = client({ collections: { posts: "posts" } });
        const error = await refusal(() => (typed.data as unknown as Record<string, unknown>).postz);

        expect(error.code).toBe("UNKNOWN_COLLECTION");
        expect(error.message).toContain("postz");
    });

    it("REALTIME_DISABLED — a channel on a client built without realtime", async () => {
        const error = await refusal(() => client().realtime.channel("room"));

        expect(error.code).toBe("REALTIME_DISABLED");
        expect(error.message).toContain("realtime: false");
    });

    it("REALTIME_DISABLED — `listen` on a collection of the same client", async () => {
        const error = await refusal(() =>
            client().data.collection("posts").listen(() => undefined));

        expect(error.code).toBe("REALTIME_DISABLED");
    });

    it("NOT_SIGNED_IN — refreshing with no session", async () => {
        const error = await refusal(() => client().auth.refreshSession());

        expect(error.code).toBe("NOT_SIGNED_IN");
    });

    it("INVALID_FUNCTION_NAME — a name that is not a single path segment", async () => {
        const error = await refusal(() => client().functions.invoke("storage-provision/42"));

        expect(error.code).toBe("INVALID_FUNCTION_NAME");
        expect(error.message).toContain("options.path");
    });

    it("is catchable as a RebaseApiError, with no status", async () => {
        // The documented single `catch`: `RebaseClientError extends
        // RebaseApiError`, and the absent `status` is what says it never
        // reached the wire.
        const error = await refusal(() => client().functions.invoke("a/b"));

        expect(error).toBeInstanceOf(RebaseApiError);
        expect(error.status).toBeUndefined();
        expect(error.code).toBeTruthy();
    });
});
