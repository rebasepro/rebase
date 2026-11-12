import { describe, expect, it } from "@jest/globals";
import { createTableClient } from "./table";
import { createTransport } from "./transport";

/**
 * A collection path and a row id stay under `/data/<path>`.
 *
 * The path was spliced into `/data/${slug}` as it came, and a row id was
 * encoded — which leaves `.` and `..` as they are. `fetch` resolves dot
 * segments before the request leaves, so a collection named
 * `../admin/users` (an agent tool takes the name as an argument) read the
 * admin route with this client's token, and an id of `..` deleted at the
 * collection's own address.
 */

function recordingTransport() {
    const resolved: string[] = [];
    const fetchFn: typeof fetch = async (input) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        resolved.push(new URL(url).pathname);
        return new Response(JSON.stringify({ data: [], meta: { total: 0, limit: 20, offset: 0, hasMore: false } }), {
            status: 200, headers: { "Content-Type": "application/json" }
        });
    };
    const transport = createTransport({ baseUrl: "http://api.test", fetch: fetchFn, anonymous: true });
    return { transport, resolved };
}

describe("a collection path that would leave /data", () => {
    it.each([
        ["../admin/users"],
        ["posts/../../admin"],
        ["%2e%2e/admin"],
        ["..\\admin"],
        [".\t./admin"]
    ])("is refused before any request (%j)", (slug) => {
        const { transport, resolved } = recordingTransport();
        expect(() => createTableClient(transport, slug)).toThrow(/would leave \/data/);
        expect(resolved).toHaveLength(0);
    });

    it("still reads a nested collection path", async () => {
        const { transport, resolved } = recordingTransport();
        await createTableClient(transport, "posts/1/comments").find();
        expect(resolved[0]).toBe("/api/data/posts/1/comments");
    });
});

describe("a row id that would address the collection", () => {
    it.each([["."], [".."]])("is refused before any request (%j)", async (id) => {
        const { transport, resolved } = recordingTransport();
        await expect(createTableClient(transport, "posts").delete(id)).rejects.toThrow(/not a row/);
        expect(resolved).toHaveLength(0);
    });

    it("still encodes an ordinary id into one segment", async () => {
        const { transport, resolved } = recordingTransport();
        await createTableClient(transport, "posts").findById("a/b?c").catch(() => undefined);
        expect(resolved[0]).toBe("/api/data/posts/a%2Fb%3Fc");
    });
});
