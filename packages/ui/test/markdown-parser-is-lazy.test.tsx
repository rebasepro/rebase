/**
 * `Markdown` builds its parser the first time it renders, not when its module
 * is evaluated.
 *
 * It used to be `const md = new MarkdownIt(...)` at module scope. Every admin
 * imports this module on boot — it is in the kit's static graph — so every
 * page load, the login screen included, paid for constructing a parser most
 * sessions never use (~1.3 ms of main-thread time cold). And a constructor
 * call at the top of a module is a side effect no bundler may drop, which is
 * one of the things that kept the whole of markdown-it in a consumer's bundle
 * when the kit shipped as one file.
 */
import React from "react";
import { render } from "@testing-library/react";

const constructed = jest.fn();

jest.mock("markdown-it", () => {
    const actual = jest.requireActual("markdown-it");
    const Real = actual.default ?? actual;
    return {
        __esModule: true,
        default: function CountingMarkdownIt(options: unknown) {
            constructed(options);
            return new Real(options);
        }
    };
});

// After the mock (jest hoists `jest.mock` above the imports).
import { Markdown } from "../src/components/Markdown";

describe("Markdown", () => {
    it("does not build a parser when its module loads", () => {
        // The module was evaluated by the import above, and nothing has rendered yet.
        expect(constructed).not.toHaveBeenCalled();
    });

    it("builds one parser, on first render, and reuses it", () => {
        const first = render(<Markdown source={"**bold**"}/>);
        expect(first.container.querySelector("strong")?.textContent).toBe("bold");
        expect(constructed).toHaveBeenCalledTimes(1);
        // Raw HTML stays off, as before.
        expect(constructed).toHaveBeenCalledWith({ html: false });

        const second = render(<Markdown source={"# Title"}/>);
        expect(second.container.querySelector("h1")?.textContent).toBe("Title");
        expect(constructed).toHaveBeenCalledTimes(1);
    });
});
