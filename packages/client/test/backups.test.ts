import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { createBackups } from "../src/backups";
import { createTransport } from "../src/transport";
import { RebaseApiError } from "@rebasepro/types";

const KEY = "2026/09/nightly.dump";
const LINK = { url: "/api/admin/backups/download?key=x&token=t0k", token: "t0k", expiresIn: 60 };

function setup(...responses: Response[]) {
    const configured = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
        const next = responses.shift();
        if (!next) throw new Error("no more responses");
        return next;
    });
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

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" }
});

/** Just enough of a browser for `download()`: the anchors it clicks. */
function fakeDocument() {
    const clicked: { href: string; download: string }[] = [];
    const doc = {
        createElement: () => {
            const a = { href: "", download: "", rel: "", click: () => clicked.push({ href: a.href, download: a.download }), remove: () => {} };
            return a;
        },
        body: { appendChild: () => {} }
    };
    (globalThis as { document?: unknown }).document = doc;
    return clicked;
}

const originalFetch = globalThis.fetch;
afterEach(() => {
    globalThis.fetch = originalFetch;
    delete (globalThis as { document?: unknown }).document;
    jest.restoreAllMocks();
});

/**
 * A backup downloads through a 60-second link, so the browser streams it to
 * disk. It used to be fetched into a Blob: the whole dump in the tab's memory,
 * and in Node a 5 GB dump ran out of memory.
 */
describe("backups.download() in a browser", () => {
    it("sends the browser to a link and never reads the bytes", async () => {
        const clicked = fakeDocument();
        const blob = jest.spyOn(Response.prototype, "blob");
        const { backups, configured } = setup(json(LINK));

        await backups.download(KEY);

        expect(configured).toHaveBeenCalledTimes(1);
        const [url, init] = configured.mock.calls[0];
        expect(String(url)).toBe("http://api.test/api/admin/backups/download-url");
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({ key: KEY });
        expect(init?.headers).toMatchObject({ Authorization: "Bearer service-key", "X-Gateway-Key": "gw" });
        expect(clicked).toEqual([{
            href: "http://api.test/api/admin/backups/download?key=2026%2F09%2Fnightly.dump&token=t0k",
            download: "nightly.dump"
        }]);
        expect(blob).not.toHaveBeenCalled();
    });

    it("falls back to reading the bytes on a server that cannot mint links", async () => {
        const clicked = fakeDocument();
        const { backups, configured } = setup(
            json({ error: { code: "NOT_FOUND" } }, 404),
            new Response("dump", { status: 200, headers: { "Content-Disposition": "attachment; filename=\"nightly.dump\"" } })
        );

        await backups.download(KEY);

        expect(configured).toHaveBeenCalledTimes(2);
        expect(String(configured.mock.calls[1][0])).toBe("http://api.test/api/admin/backups/download?key=2026%2F09%2Fnightly.dump");
        expect(clicked).toHaveLength(1);
        expect(clicked[0].href).toMatch(/^blob:/);
        expect(clicked[0].download).toBe("nightly.dump");
    });

    it("refuses with the status, as every other call does", async () => {
        fakeDocument();
        const { backups } = setup(json({}, 403));

        const error = await backups.download("k").catch((e: unknown) => e);

        expect(error).toBeInstanceOf(RebaseApiError);
        expect((error as RebaseApiError).status).toBe(403);
    });

    it("says what to use instead outside a browser", async () => {
        const { backups, configured } = setup();
        await expect(backups.download(KEY)).rejects.toThrow(/backups\.stream\(key\)/);
        expect(configured).not.toHaveBeenCalled();
    });
});

describe("backups.downloadUrl()", () => {
    it("answers an absolute link on the client's own base URL", async () => {
        const { backups } = setup(json(LINK));
        await expect(backups.downloadUrl(KEY)).resolves.toEqual({
            url: "http://api.test/api/admin/backups/download?key=2026%2F09%2Fnightly.dump&token=t0k",
            token: "t0k",
            expiresIn: 60
        });
    });
});

/**
 * `stream()` answers an octet-stream, so it cannot go through the JSON
 * `request()` — and the download it replaces used to go around the transport
 * altogether: the global `fetch` instead of the one the client was configured
 * with, and none of the client's own headers.
 */
describe("backups.stream()", () => {
    it("goes through the client's fetch, with the client's headers and token, and hands back the body unread", async () => {
        const blob = jest.spyOn(Response.prototype, "blob");
        const { backups, configured, global } = setup(new Response("dump", {
            status: 200, headers: { "Content-Length": "4", "Content-Disposition": "attachment; filename=\"nightly.dump\"" }
        }));

        const { stream, size, name } = await backups.stream(KEY);

        expect(await new Response(stream).text()).toBe("dump");
        expect(size).toBe(4);
        expect(name).toBe("nightly.dump");
        expect(blob).not.toHaveBeenCalled();
        expect(global).not.toHaveBeenCalled();
        const [url, init] = configured.mock.calls[0];
        expect(String(url)).toBe("http://api.test/api/admin/backups/download?key=2026%2F09%2Fnightly.dump");
        expect(init?.method).toBe("GET");
        expect(init?.headers).toMatchObject({ Authorization: "Bearer service-key", "X-Gateway-Key": "gw" });
    });

    it("refuses with the status", async () => {
        const { backups } = setup(new Response("{}", { status: 403 }));
        const error = await backups.stream("k").catch((e: unknown) => e);
        expect(error).toBeInstanceOf(RebaseApiError);
        expect((error as RebaseApiError).status).toBe(403);
    });
});
