/**
 * `Markdown` fetches markdown-it the first time one mounts, not when the admin
 * boots.
 *
 * It used to `import MarkdownIt from "markdown-it"` and build the parser at
 * module scope. Every admin evaluates this module on boot, so markdown-it and
 * its dependencies (~100 kB minified, 44 kB gzipped) sat in the chunk the
 * login screen preloads, and every page load built a parser most sessions
 * never use. Now the parser is imported on demand; until it lands the source
 * shows as plain text, and once loaded every render is synchronous again.
 */
import React from "react";
import { render, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";

const mockLoads = jest.fn();
const mockConstructed = jest.fn();

jest.mock("markdown-it", () => {
    mockLoads();
    const actual = jest.requireActual("markdown-it");
    const Real = actual.default ?? actual;
    return {
        __esModule: true,
        default: function CountingMarkdownIt(options: unknown) {
            mockConstructed(options);
            return new Real(options);
        }
    };
});

// After the mock (jest hoists `jest.mock` above the imports).
import { Markdown } from "../src/components/Markdown";

describe("Markdown", () => {
    it("does not load markdown-it when its module loads", () => {
        // The module was evaluated by the import above, and nothing has rendered yet.
        expect(mockLoads).not.toHaveBeenCalled();
        expect(mockConstructed).not.toHaveBeenCalled();
    });

    it("renders on the server as plain text, without loading the parser", () => {
        const html = renderToString(<Markdown source={"**bold**"}/>);
        expect(html).toContain("**bold**");
        expect(html).not.toContain("<strong>");
        expect(mockLoads).not.toHaveBeenCalled();
    });

    it("shows the source as text until the parser arrives, then the rendered markdown", async () => {
        const { container } = render(<Markdown source={"**bold**"}/>);
        expect(container.textContent).toBe("**bold**");
        expect(container.querySelector("strong")).toBeNull();

        await waitFor(() => expect(container.querySelector("strong")?.textContent).toBe("bold"));
        expect(mockLoads).toHaveBeenCalledTimes(1);
        expect(mockConstructed).toHaveBeenCalledTimes(1);
        // Raw HTML stays off, as before.
        expect(mockConstructed).toHaveBeenCalledWith({ html: false });
    });

    it("renders at once with the same parser after that", () => {
        const { container } = render(<Markdown source={"# Title"}/>);
        expect(container.querySelector("h1")?.textContent).toBe("Title");
        expect(mockConstructed).toHaveBeenCalledTimes(1);
    });
});
