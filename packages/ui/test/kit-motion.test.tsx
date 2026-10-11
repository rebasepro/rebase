import React from "react";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Collapse, ExpandablePanel, Popover, Tooltip } from "../src";

class NoopResizeObserver implements ResizeObserver {
    observe() { /* noop */ }
    unobserve() { /* noop */ }
    disconnect() { /* noop */ }
}
globalThis.ResizeObserver = NoopResizeObserver;

/**
 * The kit's injected animations:
 * - each component names its own keyframes. Popover and Tooltip both defined
 *   `slideUpAndFade` & co. with different distances (2px vs 4px), and Collapse
 *   and ExpandablePanel both defined `slideDown`/`slideUp`, so whichever
 *   stylesheet mounted last won for all of them (and any app keyframe of the
 *   same name);
 * - each stylesheet that animates turns its animation off under
 *   `prefers-reduced-motion: reduce`.
 */
describe("kit motion", () => {
    function injectedStyles(): string[] {
        return Array.from(document.querySelectorAll("style")).map((s) => s.innerHTML);
    }

    it("keyframe names are unique across kit stylesheets and every animating sheet honours reduced motion", () => {
        render(<>
            <Popover open trigger={<button>p</button>}><div>Panel</div></Popover>
            <Tooltip open title="Hello"><button>t</button></Tooltip>
            <Collapse in><div>c</div></Collapse>
            <ExpandablePanel title="Advanced"><div>e</div></ExpandablePanel>
        </>);
        const sheets = injectedStyles().filter((css) => /@keyframes/.test(css));
        expect(sheets.length).toBeGreaterThanOrEqual(4);

        const names = sheets.flatMap((css) => Array.from(css.matchAll(/@keyframes\s+([\w-]+)/g), (m) => m[1]));
        const duplicates = names.filter((name, i) => names.indexOf(name) !== i);
        expect(duplicates).toEqual([]);

        for (const css of sheets) {
            expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
        }
    });
});
