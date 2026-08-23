/**
 * Storage keys in a URL path.
 *
 * Every call in `storage.ts` interpolated the key raw, and the server decodes
 * what it receives. Three ordinary filenames did three different wrong things,
 * all measured against a real Hono route before this was written:
 *
 *   `Invoice #12.pdf`  the `#` began the fragment, so the server saw
 *                      `default/Invoice ` — a key that is not the file — and a
 *                      scoped `?token=` after it was swallowed with it
 *   `100% done.png`    `decodeURIComponent` threw URIError, answered 500
 *   `a%2Fb.png`        decoded to `a/b.png`, silently resolving a DIFFERENT
 *                      object
 *
 * The last is the one worth the test: no error, no log, the wrong bytes.
 */
import { encodeStorageKey } from "./storage";

describe("encodeStorageKey", () => {
    it("leaves an ordinary key untouched", () => {
        // The no-op property: every key that already worked still produces the
        // same URL, so nothing cached or CDN-fronted moves.
        expect(encodeStorageKey("default/photo.png")).toBe("default/photo.png");
        expect(encodeStorageKey("public/a/b/c.jpg")).toBe("public/a/b/c.jpg");
    });

    it("keeps the key's own separator", () => {
        // `/` separates bucket from path and folder from file. Encoding it
        // would make every existing key unresolvable.
        expect(encodeStorageKey("a/b/c")).toBe("a/b/c");
    });

    it.each([
        ["default/Invoice #12.pdf", "default/Invoice%20%2312.pdf"],
        ["default/100% done.png", "default/100%25%20done.png"],
        ["default/a%2Fb.png", "default/a%252Fb.png"],
        ["default/a+b.png", "default/a%2Bb.png"],
        ["default/naïve café.png", "default/na%C3%AFve%20caf%C3%A9.png"]
    ])("encodes %s", (input, expected) => {
        expect(encodeStorageKey(input)).toBe(expected);
    });

    it("keeps a key containing an encoded slash distinct from a real one", () => {
        // The silent one. `a%2Fb.png` is a legal object name and it is not
        // `a/b.png`; before this they resolved to the same object.
        expect(encodeStorageKey("default/a%2Fb.png"))
            .not.toBe(encodeStorageKey("default/a/b.png"));
    });

    it("survives a round trip through the server's decode", () => {
        // The server runs `decodeURIComponent` over the whole path. Anything
        // that does not come back unchanged is a key that resolves to the
        // wrong object, or a 500.
        for (const key of [
            "default/photo.png",
            "default/Invoice #12.pdf",
            "default/100% done.png",
            "default/a%2Fb.png",
            "default/50%.png",
            "default/naïve café.png"
        ]) {
            expect(decodeURIComponent(encodeStorageKey(key))).toBe(key);
        }
    });
});
