import { describe, expect, it } from "@jest/globals";
import { createFunctionsClient } from "./functions";
import { createTransport } from "./transport";

/**
 * `functions.invoke` refuses a `path` with a `.` or `..` segment, because
 * `fetch` resolves them and the request would leave `/functions/<name>` for
 * another route (`DELETE /api/admin/users/<uid>`).
 *
 * The check split the path on `/` alone. The URL parser `fetch` runs reads
 * `\` as `/` in an http(s) URL, and drops tabs and newlines before it looks
 * at the path at all — so `..\..\admin` and `.\t./.\t./admin` were not dot
 * segments to the check and were to the parser.
 */

function recordingTransport() {
    const resolved: string[] = [];
    const fetchFn: typeof fetch = async (input) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        resolved.push(new URL(url).pathname);
        return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const transport = createTransport({ baseUrl: "http://api.test", fetch: fetchFn, anonymous: true });
    return { transport, resolved };
}

describe("functions.invoke — a path that would leave the function", () => {
    it.each([
        ["..\\..\\admin\\users\\u1"],
        ["a\\..\\..\\..\\admin"],
        ["%2e%2e\\%2E%2E\\admin"],
        [".\t./.\n./admin/users/u1"],
        ["a/.\r./..\t/admin"]
    ])("is refused before any request (%j)", async (path) => {
        const { transport, resolved } = recordingTransport();
        const client = createFunctionsClient(transport);

        await expect(client.invoke("x", undefined, { method: "DELETE", path })).rejects.toThrow(/would leave/);
        expect(resolved).toHaveLength(0);
    });

    it("keeps a backslash or a tab that is not part of a dot segment", async () => {
        const { transport, resolved } = recordingTransport();
        const client = createFunctionsClient(transport);

        await client.invoke("files", undefined, { method: "GET", path: "a..b\\c.d?next=..\\x" });

        expect(resolved[0].startsWith("/api/functions/files/")).toBe(true);
    });
});
