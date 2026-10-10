import { createServer, request, type RequestListener, type Server } from "http";
import { readFileSync } from "fs";
import path from "path";
import type { AddressInfo } from "net";

import { createRuntimeHttpServer, RUNTIME_MAX_HEADER_SIZE } from "../src/boot/http-server";

/**
 * How long a URL the runtime's HTTP server takes.
 *
 * A vector search carries its embedding in `?vector=` as a JSON array, so the
 * URL grows with the model: 768 dimensions are 16.7 KB, 1,536 are 33 KB. Node
 * answers 431 to anything over its 16 KB default before a route sees it, and
 * the runtime kept that default — so `.vectorSearch()` failed for the common
 * embedding sizes. The SDK now sends a vector search as `POST …/query`; this is
 * the stopgap for a URL built by hand.
 */

/** The query string a 1,536-dimension vector search puts on the URL. */
function vectorSearchUrl(dims: number): string {
    const vector = Array.from({ length: dims }, (_, i) => Math.sin(i));
    return `/api/data/docs?vector_search=embedding&vector=${encodeURIComponent(JSON.stringify(vector))}&limit=10`;
}

const listener: RequestListener = (req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(String(req.url?.length ?? 0));
};

async function statusFor(server: Server, url: string): Promise<number> {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
        return await new Promise<number>((resolve, reject) => {
            const req = request({ host: "127.0.0.1", port, path: url, method: "GET" }, (res) => {
                res.resume();
                res.on("end", () => resolve(res.statusCode ?? 0));
            });
            req.on("error", reject);
            req.end();
        });
    } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
}

describe("the runtime's HTTP server", () => {
    it("answers a 1,536-dimension vector search in the URL", async () => {
        const url = vectorSearchUrl(1536);
        expect(url.length).toBeGreaterThan(30_000);
        expect(await statusFor(createRuntimeHttpServer(listener), url)).toBe(200);
    });

    it("where Node's own default refuses it — which is what this is guarding against", async () => {
        expect(await statusFor(createServer(listener), vectorSearchUrl(1536))).toBe(431);
    });

    it("still has a ceiling", async () => {
        expect(await statusFor(createRuntimeHttpServer(listener), `/x?q=${"a".repeat(RUNTIME_MAX_HEADER_SIZE)}`)).toBe(431);
    });

    it("is the server the runtime boots, on both its paths", () => {
        // The backend path and the static-app path each built their own with
        // a bare `createServer`, which is how the default stayed in place.
        const boot = readFileSync(path.join(__dirname, "../src/boot/boot.ts"), "utf8");
        expect(boot).not.toMatch(/\bcreateServer\(/);
        expect(boot.match(/createRuntimeHttpServer\(/g)).toHaveLength(2);
    });

    /**
     * The servers that do not boot through `boot.ts` build their own: the
     * backend `rebase eject` writes into a project, and this repository's
     * example app. Both called a bare `createServer`, so a hand-built
     * 768-dimension search URL that the runtime answers was a 431 there.
     * They cannot import the runtime's helper (it is internal), so each
     * spells the bound, and this holds the spelling to the runtime's.
     */
    it.each([
        ["the eject template", "../../cli/templates/eject/backend/src/index.ts"],
        ["the example app", "../../../app/backend/src/index.ts"]
    ])("is the bound %s's server is built with", (_name, file) => {
        expect(RUNTIME_MAX_HEADER_SIZE).toBe(64 * 1024);
        const source = readFileSync(path.join(__dirname, file), "utf8");
        const calls = source.match(/\bcreateServer\([^)]*\)/g) ?? [];
        expect(calls).toHaveLength(1);
        expect(calls[0]).toContain("{ maxHeaderSize: 64 * 1024 }");
    });
});
