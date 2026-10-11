import { describe, expect, it, jest } from "@jest/globals";
import { createFunctionsClient } from "../src/functions";
import { createTransport } from "../src/transport";

/** Captures the path the client asks the transport for. */
function transportSpy() {
    const calls: { path: string; init?: RequestInit }[] = [];
    const transport = {
        request: jest.fn(async (path: string, init?: RequestInit) => {
            calls.push({ path, init });
            return {} as unknown;
        })
    };
    return { transport, calls };
}

describe("functions.invoke — route construction", () => {

    // The regression: `path` was always joined with a `/`, so a bare query string
    // produced `/functions/dashboard-stats/?days=30`. The trailing slash misses the
    // route, so a function that is deployed and mounted answers 404 — which the UI
    // reports as the backend being unreachable, several layers from the real cause.
    it("appends a bare query string without inserting a separator", async () => {
        const { transport, calls } = transportSpy();
        const client = createFunctionsClient(transport as never);

        await client.invoke("dashboard-stats", undefined, { method: "GET", path: "?days=30" });

        expect(calls[0].path).toBe("/functions/dashboard-stats?days=30");
        expect(calls[0].path).not.toContain("/?");
    });

    it("appends a fragment the same way", async () => {
        const { transport, calls } = transportSpy();
        const client = createFunctionsClient(transport as never);

        await client.invoke("report", undefined, { method: "GET", path: "#section" });

        expect(calls[0].path).toBe("/functions/report#section");
    });

    // The behaviour that was already right, and has to stay right: a real sub-path
    // is separated, with or without a leading slash of its own.
    it("separates a real sub-path, normalising a leading slash", async () => {
        const { transport, calls } = transportSpy();
        const client = createFunctionsClient(transport as never);

        await client.invoke("report", undefined, { method: "GET", path: "monthly" });
        await client.invoke("report", undefined, { method: "GET", path: "/monthly" });

        expect(calls[0].path).toBe("/functions/report/monthly");
        expect(calls[1].path).toBe("/functions/report/monthly");
    });

    it("adds nothing when no path is given", async () => {
        const { transport, calls } = transportSpy();
        const client = createFunctionsClient(transport as never);

        await client.invoke("hello");

        expect(calls[0].path).toBe("/functions/hello");
    });
});

/**
 * A name is one path segment, and a sub-path folded into it is silently wrong.
 *
 * `invoke("storage-provision/<projectId>")` percent-encoded the slash into
 * `POST /api/functions/storage-provision%2F<projectId>`, which matches no route.
 * So the control plane answered a bare `404 Not Found` — no project, no reason —
 * and `rebase cloud storage create` looked like a feature that had never been
 * built, to its users and to its author. The route had been live for six weeks.
 *
 * The encoding is not the bug; refusing to encode a `/` would break nothing but
 * would also fix nothing, since the caller still has the wrong URL. What was
 * missing is the complaint.
 */
describe("functions.invoke — a name is one segment", () => {
    it("refuses a name containing a slash instead of encoding it into a 404", async () => {
        const { transport, calls } = transportSpy();
        const client = createFunctionsClient(transport as never);

        await expect(
            client.invoke("storage-provision/a9d4a559", undefined, { method: "POST" })
        ).rejects.toThrow(/single path segment/);

        // And it never reached the wire, so nothing has to be undone.
        expect(calls).toHaveLength(0);
    });

    it("names the call that would have worked", async () => {
        const { transport } = transportSpy();
        const client = createFunctionsClient(transport as never);

        await expect(
            client.invoke("storage-provision/a9d4a559", undefined, { method: "POST" })
        ).rejects.toThrow(/invoke\("storage-provision", payload, \{ path: "a9d4a559" \}\)/);
    });

    it("still encodes a name that needs it", async () => {
        const { transport, calls } = transportSpy();
        const client = createFunctionsClient(transport as never);

        await client.invoke("weird name", undefined, { method: "GET" });

        expect(calls[0].path).toBe("/functions/weird%20name");
    });
});

/**
 * A function is a Hono route, so it may answer `c.text(csv)` or `c.body(pdf)`.
 *
 * `invoke()` read every success as JSON, so such a function was unreadable from
 * the SDK: the call threw `INVALID_JSON_RESPONSE` and told the developer to check
 * `VITE_API_URL` — a misconfiguration that did not exist. `responseType` asks for
 * the body as text, a Blob or the raw `Response`, and the refusal for a non-JSON
 * body now names the content type it saw and the option that reads it.
 */
describe("functions.invoke — a function that does not answer JSON", () => {
    const csv = "id,total\n1,10\n2,20\n";

    function realTransportAnswering(body: string, contentType: string, status = 200) {
        const fetchFn = jest.fn(async () => new Response(body, { status, headers: { "Content-Type": contentType } }));
        const transport = createTransport({
            baseUrl: "https://api.example.com",
            token: "tok",
            fetch: fetchFn as unknown as typeof globalThis.fetch
        });
        return { transport, fetchFn };
    }

    it("reads the body as text when asked", async () => {
        const { transport } = realTransportAnswering(csv, "text/csv");
        const client = createFunctionsClient(transport);

        await expect(client.invoke("export-orders", undefined, { method: "GET", responseType: "text" }))
            .resolves.toBe(csv);
    });

    it("reads the body as a Blob when asked", async () => {
        const { transport } = realTransportAnswering(csv, "text/csv");
        const client = createFunctionsClient(transport);

        const blob = await client.invoke<Blob>("export-orders", undefined, { method: "GET", responseType: "blob" });
        expect(blob).toBeInstanceOf(Blob);
        await expect(blob.text()).resolves.toBe(csv);
    });

    it("hands back the raw Response when asked", async () => {
        const { transport } = realTransportAnswering(csv, "text/csv");
        const client = createFunctionsClient(transport);

        const res = await client.invoke<Response>("export-orders", undefined, { method: "GET", responseType: "response" });
        expect(res.headers.get("Content-Type")).toBe("text/csv");
        await expect(res.text()).resolves.toBe(csv);
    });

    it("still throws the API error for a failed call in a raw mode", async () => {
        const { transport } = realTransportAnswering(
            JSON.stringify({ error: { message: "nope", code: "FORBIDDEN" } }), "application/json", 403);
        const client = createFunctionsClient(transport);

        await expect(client.invoke("export-orders", undefined, { method: "GET", responseType: "text" }))
            .rejects.toMatchObject({ name: "RebaseApiError", status: 403, code: "FORBIDDEN" });
    });

    it("names the content type and the option instead of blaming the API URL", async () => {
        const { transport } = realTransportAnswering(csv, "text/csv");
        const client = createFunctionsClient(transport);

        const error = await client.invoke("export-orders", undefined, { method: "GET" }).catch((e: unknown) => e);
        expect(error).toMatchObject({ code: "INVALID_JSON_RESPONSE", status: 200 });
        expect(String((error as Error).message)).toMatch(/text\/csv/);
        expect(String((error as Error).message)).toMatch(/responseType/);
        expect(String((error as Error).message)).not.toMatch(/VITE_API_URL/);
    });
});
