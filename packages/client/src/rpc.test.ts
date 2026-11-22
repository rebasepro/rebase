import { describe, expect, it } from "@jest/globals";
import { createRpcCall } from "./rpc";
import { createTransport } from "./transport";
import { createRebaseClient } from "./index";

/**
 * `client.rpc(name, args)` posts the named arguments to `/rpc/<name>` and
 * resolves to the function's result, verbatim.
 */

function recordingTransport(answer: unknown = [{ id: 1 }]) {
    const requests: Array<{ method: string; path: string; body: string | null; contentType: string | null }> = [];
    const fetchFn: typeof fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const headers = new Headers(init?.headers);
        requests.push({
            method: init?.method ?? "GET",
            path: new URL(url).pathname,
            body: typeof init?.body === "string" ? init.body : null,
            contentType: headers.get("content-type")
        });
        return new Response(JSON.stringify(answer), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    return { transport: createTransport({ baseUrl: "http://api.test", fetch: fetchFn, anonymous: true }), requests, fetchFn };
}

describe("client.rpc", () => {
    it("posts the arguments as a JSON object to /rpc/<name>", async () => {
        const { transport, requests } = recordingTransport([{ id: 7 }]);
        const rpc = createRpcCall(transport);
        const rows = await rpc<Array<{ id: number }>>("get_public_proposal", { token: "t-1" });
        expect(rows).toEqual([{ id: 7 }]);
        expect(requests).toEqual([{
            method: "POST",
            path: "/api/rpc/get_public_proposal",
            body: "{\"token\":\"t-1\"}",
            contentType: "application/json"
        }]);
    });

    it("sends an empty object when there are no arguments, and returns a scalar or null as is", async () => {
        const scalar = recordingTransport(42);
        expect(await createRpcCall(scalar.transport)("count_items")).toBe(42);
        expect(scalar.requests[0].body).toBe("{}");
        const nothing = recordingTransport(null);
        expect(await createRpcCall(nothing.transport)("noop")).toBeNull();
    });

    it("refuses a name that is not a SQL identifier, before any request", async () => {
        const { transport, requests } = recordingTransport();
        const rpc = createRpcCall(transport);
        expect(() => rpc("../admin/users")).toThrow(expect.objectContaining({ code: "INVALID_RPC_NAME" }));
        expect(() => rpc("get-proposal")).toThrow(/Invalid RPC name/);
        expect(requests).toHaveLength(0);
    });

    it("is on the client createRebaseClient returns", async () => {
        const { fetchFn } = recordingTransport({ ok: true });
        const client = createRebaseClient({ baseUrl: "http://api.test", fetch: fetchFn, realtime: false, anonymous: true });
        expect(await client.rpc("ping")).toEqual({ ok: true });
        client.close();
    });
});
