import { sanitizeUrl } from "../src/preview/util";

/**
 * What a preview link may navigate to.
 *
 * This used to be a blocklist of three scheme names, and the ways around it are
 * not exotic: a browser strips tabs, newlines, carriage returns and other
 * control characters from a URL *before* it decides what the scheme is, so a
 * `javascript:` with a tab wedged into the word navigates exactly as the plain
 * one does while matching none of the names being blocked. Turned around into
 * an allowlist, none of that matters — the string is one of four schemes or it
 * is not a link.
 */
describe("sanitizeUrl", () => {
    it.each([
        ["https://example.com/x"],
        ["http://example.com/x"],
        ["mailto:someone@example.com"],
        ["tel:+31201234567"],
        ["/uploads/photo.png"],
        ["photo.png"],
        ["//cdn.example.com/photo.png"]
    ])("passes %s through", (url) => {
        expect(sanitizeUrl(url)).toBe(url);
    });

    it.each([
        ["javascript:alert(1)"],
        ["JaVaScRiPt:alert(1)"],
        ["  javascript:alert(1)  "],
        ["data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="],
        ["vbscript:msgbox(1)"],
        ["file:///etc/passwd"],
        ["chrome://settings"]
    ])("refuses %s", (url) => {
        expect(sanitizeUrl(url)).toBe("about:blank");
    });

    /**
     * The variants a blocklist on scheme names cannot see. Written with escape
     * sequences rather than literal control characters, so the fixture survives
     * a copy, a diff view, and an editor that trims whitespace.
     */
    it.each([
        ["a tab inside the scheme", "java\tscript:alert(1)"],
        ["a newline inside the scheme", "java\nscript:alert(1)"],
        ["a carriage return inside the scheme", "java\rscript:alert(1)"],
        ["a NUL inside the scheme", "java\u0000script:alert(1)"],
        ["a leading control character", "\u0001javascript:alert(1)"]
    ])("refuses %s", (_label, url) => {
        expect(sanitizeUrl(url)).toBe("about:blank");
    });

    /**
     * Deliberately NOT refused. A browser does not percent-decode before it
     * parses a scheme, so `javascript%3A…` in an href is a relative path with
     * an odd name and navigates nowhere interesting. Refusing it would be this
     * function inventing a threat and breaking a legitimate filename to do it.
     */
    it("treats a percent-encoded colon as part of a relative path", () => {
        expect(sanitizeUrl("javascript%3Aalert(1)")).toBe("javascript%3Aalert(1)");
    });

    it("refuses nothing at all", () => {
        expect(sanitizeUrl(undefined)).toBe("about:blank");
        expect(sanitizeUrl("")).toBe("about:blank");
        expect(sanitizeUrl("   ")).toBe("about:blank");
    });
});
