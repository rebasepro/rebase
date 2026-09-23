import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { createBackups } from "../src/backups";
import { createTransport } from "../src/transport";
import { RebaseApiError } from "@rebasepro/types";

/**
 * `backups.download()` answers an octet-stream, so it cannot go through the
 * JSON `request()` — and it used to go around the transport altogether: the
 * global `fetch` instead of the one the client was configured with, and none of
 * the client's own headers. A client built with a custom `fetch` (a Node
 * script, a proxy, a test harness) or with gateway headers had every other call
 * work and this one fail, or reach a different place.
 */
describe("backups.download()", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    function setup(response: Response) {
        const configured = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response);
        const global = jest.fn(async () => new Response("wrong door", { status: 418 }));
        globalThis.fetch = global as unknown as typeof fetch;
        const transport = createTransport({
            baseUrl: "http://api.test",
            fetch: configured as unknown as typeof fetch,
            token: "service-key",
            headers: { "X-Gateway-Key": "gw" }
        });
        return { backups: createBackups(transport), configured, global };
    }

    it("goes through the client's fetch, with the client's headers and token", async () => {
        const { backups, configured, global } = setup(new Response(new Blob(["dump"]), { status: 200 }));

        const blob = await backups.download("2026/09/nightly.dump");

        expect(await blob.text()).toBe("dump");
        expect(global).not.toHaveBeenCalled();
        expect(configured).toHaveBeenCalledTimes(1);
        const [url, init] = configured.mock.calls[0];
        expect(String(url)).toBe("http://api.test/api/admin/backups/download?key=2026%2F09%2Fnightly.dump");
        expect(init?.method).toBe("GET");
        expect(init?.headers).toMatchObject({ Authorization: "Bearer service-key", "X-Gateway-Key": "gw" });
    });

    it("refuses with the status, as every other call does", async () => {
        const { backups } = setup(new Response("{}", { status: 403 }));

        const error = await backups.download("k").catch((e: unknown) => e);

        expect(error).toBeInstanceOf(RebaseApiError);
        expect((error as RebaseApiError).status).toBe(403);
    });
});
