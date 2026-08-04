import { collapseToSingleLine, markdownToPlainText } from "../../src/preview/compact_text";

describe("markdownToPlainText", () => {

    it("takes the readable text out of a document, in reading order", () => {
        const source = [
            "# Welcome",
            "",
            "I'm a **product** engineer.",
            "",
            "## Philosophy",
            "",
            "- Ship fast",
            "- Measure everything"
        ].join("\n");

        expect(markdownToPlainText(source))
            .toBe("Welcome I'm a product engineer. Philosophy Ship fast Measure everything");
    });

    it("keeps link and image text, drops the targets", () => {
        expect(markdownToPlainText("See [the docs](https://example.com/docs) first"))
            .toBe("See the docs first");
        expect(markdownToPlainText("![a portrait](https://example.com/p.png)"))
            .toBe("a portrait");
        expect(markdownToPlainText("A [reference][1] link")).toBe("A reference link");
    });

    it("drops code fences, HTML and thematic breaks", () => {
        expect(markdownToPlainText("Before\n\n```js\nconst x = 1;\n```\n\nAfter"))
            .toBe("Before After");
        expect(markdownToPlainText("<div class=\"x\">Hello</div>")).toBe("Hello");
        expect(markdownToPlainText("One\n\n---\n\nTwo")).toBe("One Two");
    });

    it("strips emphasis without eating the words around it", () => {
        expect(markdownToPlainText("_italic_ and ~~struck~~ and `code`"))
            .toBe("italic and struck and code");
    });

    it("handles blockquotes and ordered lists", () => {
        expect(markdownToPlainText("> quoted\n\n1. first\n2. second"))
            .toBe("quoted first second");
    });

    it("returns an empty string for empty input", () => {
        expect(markdownToPlainText("")).toBe("");
        expect(markdownToPlainText(undefined as unknown as string)).toBe("");
    });
});

describe("collapseToSingleLine", () => {

    it("collapses the newlines that a `truncate` container cannot clamp", () => {
        expect(collapseToSingleLine("one\ntwo\n\n  three ")).toBe("one two three");
    });

    it("caps long text at a word boundary and marks the cut", () => {
        const source = "alpha bravo charlie delta echo foxtrot golf hotel india juliet";
        const result = collapseToSingleLine(source, 30);
        expect(result.length).toBeLessThanOrEqual(31);
        expect(result.endsWith("…")).toBe(true);
        expect(result).toBe("alpha bravo charlie delta echo…");
    });

    it("cuts mid-word rather than losing most of the line to one long word", () => {
        const result = collapseToSingleLine("a" + "b".repeat(40), 10);
        expect(result).toBe("abbbbbbbbb…");
    });

    it("leaves text that already fits untouched", () => {
        expect(collapseToSingleLine("short", 30)).toBe("short");
    });
});
