import { parseSanitizedHtml, sanitizeEditorHtml } from "../src/editor/sanitize-html";

/**
 * Three places in the editor assigned a string of HTML to `innerHTML` on an
 * element of the LIVE document: the loading decoration that renders an AI
 * completion as it streams, the final result of that completion, and the paste
 * transform. All three ran what they were given — `<img src=x onerror=…>` fires
 * during the assignment, before any later filtering gets a say.
 *
 * Inside the Cloud console that is the console's own origin, one fetch away
 * from the session, the project list and the deploy API.
 *
 * The completion is not "our AI's output" either: `autocomplete` is handed the
 * surrounding document as context, and the document is a customer's content —
 * often typed by somebody else. Put HTML in a record, ask the editor's AI to
 * continue near it, have the model repeat it back.
 */
describe("sanitizeEditorHtml", () => {
    /** Did anything actually execute? jsdom runs handlers, so this is real. */
    function withExecutionSpy(run: () => void): number {
        const before = (globalThis as { __xss?: number }).__xss ?? 0;
        (globalThis as { __xss?: number }).__xss = before;
        run();
        return ((globalThis as { __xss?: number }).__xss ?? 0) - before;
    }

    it("keeps ordinary rich text", () => {
        const html = "<p>Hello <strong>world</strong>, and <em>welcome</em>.</p>";
        expect(sanitizeEditorHtml(html)).toBe(html);
    });

    it("keeps lists, tables, quotes and code", () => {
        const out = sanitizeEditorHtml(
            "<ul><li>one</li></ul><table><tr><td colspan=\"2\">c</td></tr></table>" +
            "<blockquote>q</blockquote><pre><code>x</code></pre>"
        );
        expect(out).toContain("<li>one</li>");
        expect(out).toContain("colspan=\"2\"");
        expect(out).toContain("<blockquote>");
        expect(out).toContain("<code>");
    });

    it("removes a script outright", () => {
        const out = sanitizeEditorHtml("<p>before</p><script>globalThis.__xss = 1</script><p>after</p>");
        expect(out).not.toContain("script");
        expect(out).toContain("before");
        expect(out).toContain("after");
    });

    it("strips every event handler, not a list of remembered ones", () => {
        const out = sanitizeEditorHtml(
            "<img src=\"x.png\" onerror=\"globalThis.__xss = 1\">" +
            "<p onmouseover=\"globalThis.__xss = 1\" onfocus=\"x\" ONCLICK=\"y\">text</p>"
        );
        expect(out).not.toMatch(/on[a-z]+=/i);
        expect(out).toContain("text");
    });

    it("removes an iframe, an object and an embed", () => {
        const out = sanitizeEditorHtml(
            "<iframe src=\"https://evil.test\"></iframe>" +
            "<object data=\"x\"></object><embed src=\"x\">"
        );
        expect(out).not.toContain("iframe");
        expect(out).not.toContain("object");
        expect(out).not.toContain("embed");
    });

    /**
     * `<template>` contents are invisible to a `querySelectorAll("*")` sweep,
     * which makes it the place to hide something from a filter written that
     * way — the paste transform's filter is written that way.
     */
    it("removes a template rather than sweeping past it", () => {
        const out = sanitizeEditorHtml("<template><img src=x onerror=\"globalThis.__xss = 1\"></template>");
        expect(out).not.toContain("template");
        expect(out).not.toContain("onerror");
    });

    it("refuses a javascript: href and keeps the text of the link", () => {
        const out = sanitizeEditorHtml("<a href=\"javascript:globalThis.__xss = 1\">click</a>");
        expect(out).not.toContain("javascript");
        expect(out).toContain("click");
    });

    it("keeps a real link, and protects the opener when it opens elsewhere", () => {
        const out = sanitizeEditorHtml("<a href=\"https://example.com\" target=\"_blank\">x</a>");
        expect(out).toContain("https://example.com");
        expect(out).toContain("noopener");
    });

    it("drops a data: image, which is a document in disguise", () => {
        const out = sanitizeEditorHtml("<img src=\"data:text/html;base64,PHNjcmlwdD4x\">");
        expect(out).not.toContain("data:");
    });

    /** Somebody's writing is not lost to a tag they never chose. */
    it("unwraps an element it does not know, keeping the text", () => {
        const out = sanitizeEditorHtml("<article><p>kept</p></article>");
        expect(out).toBe("<p>kept</p>");
    });

    it("strips styles and classes the editor cannot represent", () => {
        const out = sanitizeEditorHtml("<p style=\"color:red\" class=\"x\">t</p>");
        expect(out).not.toContain("style");
        expect(out).not.toContain("class");
    });

    it("survives nothing at all", () => {
        expect(sanitizeEditorHtml("")).toBe("");
        expect(sanitizeEditorHtml("plain text")).toBe("plain text");
    });

    /**
     * The property the whole module exists for: parsing must not execute. jsdom
     * fires `onerror` for a broken image in a document WITH a browsing context,
     * so this distinguishes the two parsers rather than restating the filter.
     */
    it("does not run anything while deciding what to keep", () => {
        const payload = "<img src=\"x\" onerror=\"globalThis.__xss = (globalThis.__xss || 0) + 1\">";

        const fired = withExecutionSpy(() => {
            parseSanitizedHtml(payload);
            sanitizeEditorHtml(payload);
        });

        expect(fired).toBe(0);
    });
});

describe("parseSanitizedHtml", () => {
    it("returns nodes the caller can adopt", () => {
        const el = parseSanitizedHtml("<p>one</p><p>two</p>");
        expect(el.children.length).toBe(2);
        expect(el.textContent).toBe("onetwo");
    });

    it("belongs to an inert document until it is adopted", () => {
        const el = parseSanitizedHtml("<p>x</p>");
        expect(el.ownerDocument).not.toBe(document);
    });
});
