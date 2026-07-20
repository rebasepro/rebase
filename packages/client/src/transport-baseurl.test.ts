import { describe, it, expect, afterEach } from "@jest/globals";
import { createTransport } from "./transport";

/**
 * `baseUrl` is optional because the common production shape is a Rebase backend
 * serving its own SPA: the API is the page's origin. These pin the resolution,
 * because getting it wrong pushes apps into baking an absolute host — which
 * breaks the moment a custom domain points at the same app, and which CORS
 * cannot repair (a SameSite=Lax auth cookie is not sent cross-site either).
 */
const setWindow = (origin?: string) => {
    if (origin === undefined) { delete (globalThis as never as { window?: unknown }).window; return; }
    (globalThis as never as { window: unknown }).window = { location: { origin, href: origin + "/" } };
};

afterEach(() => setWindow(undefined));

describe("transport baseUrl resolution", () => {
    it("uses the page origin when unset in a browser", () => {
        setWindow("https://dadaki.com");
        expect(createTransport({}).baseUrl).toBe("https://dadaki.com");
    });

    it("gives callers something they can build an absolute URL from", () => {
        setWindow("https://dadaki.com");
        const t = createTransport({});
        // The empty-string version of this threw, which is what drove apps to
        // bake a hostname into the bundle.
        expect(() => new URL(`${t.baseUrl}/api/functions/doc-content/get`)).not.toThrow();
    });

    it("follows the page, so a second hostname on the same app just works", () => {
        setWindow("https://dadaki.apps.rebase.pro");
        expect(createTransport({}).baseUrl).toBe("https://dadaki.apps.rebase.pro");
        setWindow("https://dadaki.com");
        expect(createTransport({}).baseUrl).toBe("https://dadaki.com");
    });

    it("still honours an explicit baseUrl, which is what dev needs", () => {
        setWindow("https://dadaki.com");
        expect(createTransport({ baseUrl: "http://localhost:3001" }).baseUrl).toBe("http://localhost:3001");
    });

    it("strips a trailing slash so joins do not double up", () => {
        setWindow(undefined);
        expect(createTransport({ baseUrl: "https://api.example.com/" }).baseUrl).toBe("https://api.example.com");
    });

    it("stays relative off-browser, where there is no origin to borrow", () => {
        setWindow(undefined);
        expect(createTransport({}).baseUrl).toBe("");
    });
});
