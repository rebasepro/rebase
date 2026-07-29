import { describe, expect, it, jest } from "@jest/globals";
import { createFunctionsClient } from "../src/functions";

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
