import { jest } from "@jest/globals";
import { createRebaseClient, RebaseApiError } from "./index";

/**
 * `upsert()` is sent as a one-row bulk write, and the bulk route names the row
 * a failure came from — "Row 0 of 1 (id 7) failed: …" — which is the whole
 * point for a 10,000-row import and noise for a call that wrote one row the
 * caller never thought of as a batch. `upsert()` drops the prefix; the code,
 * status and details are the server's. `createMany` keeps it: there the row
 * number is the information.
 */
function bulkFailure(): Response {
    return new Response(JSON.stringify({
        error: {
            message: "Row 0 of 1 (id 7) failed: duplicate key value violates unique constraint \"posts_slug_key\"",
            code: "UNIQUE_VIOLATION",
            details: { constraint: "posts_slug_key" }
        }
    }), { status: 409, headers: { "Content-Type": "application/json" } });
}

function clientAnswering(response: () => Response) {
    const fetchMock = jest.fn<typeof fetch>(async () => response());
    return createRebaseClient({
        baseUrl: "http://localhost:3000",
        fetch: fetchMock as typeof fetch,
        anonymous: true,
        realtime: false
    });
}

describe("a one-row upsert() failure", () => {
    it("rejects with the bare message, keeping code, status and details", async () => {
        const client = clientAnswering(bulkFailure);
        const error = await client.data.collection("posts").upsert({ id: 7, slug: "taken" }).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(RebaseApiError);
        const apiError = error as RebaseApiError;
        expect(apiError.message).toBe("duplicate key value violates unique constraint \"posts_slug_key\"");
        expect(apiError.code).toBe("UNIQUE_VIOLATION");
        expect(apiError.status).toBe(409);
        expect(apiError.details).toEqual({ constraint: "posts_slug_key" });
    });

    it("leaves createMany's row prefix alone", async () => {
        const client = clientAnswering(bulkFailure);
        const error = await client.data.collection("posts").createMany([{ id: 7, slug: "taken" }]).catch((e: unknown) => e);

        expect((error as RebaseApiError).message).toMatch(/^Row 0 of 1 \(id 7\) failed: /);
    });

    it("leaves a message without the prefix alone", async () => {
        const client = clientAnswering(() => new Response(JSON.stringify({
            error: { message: "Row-level security refused the write", code: "FORBIDDEN" }
        }), { status: 403, headers: { "Content-Type": "application/json" } }));
        const error = await client.data.collection("posts").upsert({ id: 7 }).catch((e: unknown) => e);

        expect((error as RebaseApiError).message).toBe("Row-level security refused the write");
    });
});
