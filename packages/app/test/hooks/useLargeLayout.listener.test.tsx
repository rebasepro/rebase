import React from "react";
import { act, render } from "@testing-library/react";
import { useLargeLayout } from "../../src/hooks/useLargeLayout";

/**
 * `useLargeLayout` used to add its `resize` listener to `window` when its
 * module was imported — before anything rendered, whether or not anything ever
 * would, and for the life of the page. Importing `@rebasepro/app` for one hook
 * left a listener behind; a test environment without `matchMedia` threw on the
 * import itself.
 *
 * The listener now belongs to the components that read the layout: the first
 * one to mount adds it, the last one to unmount removes it.
 */

function resizeCalls(spy: jest.SpyInstance): unknown[][] {
    return spy.mock.calls.filter((call: unknown[]) => call[0] === "resize");
}

let large = false;

beforeEach(() => {
    large = false;
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
        get matches() { return large; },
        media: query,
        onchange: null,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn()
    }));
});

/** A fresh copy of the module, evaluated now — what an import does. */
function importFresh(): void {
    jest.isolateModules(() => {
        jest.requireActual("../../src/hooks/useLargeLayout");
    });
}

describe("useLargeLayout's window listener", () => {
    it("is not added by importing the module", () => {
        const add = jest.spyOn(window, "addEventListener");
        try {
            importFresh();
            expect(resizeCalls(add)).toHaveLength(0);
        } finally {
            add.mockRestore();
        }
    });

    it("is added once for the first reader, and removed with the last one", () => {
        const add = jest.spyOn(window, "addEventListener");
        const remove = jest.spyOn(window, "removeEventListener");
        function Probe({ id }: { id: string }) {
            return <span data-testid={id}>{useLargeLayout() ? "large" : "small"}</span>;
        }
        try {
            const first = render(<Probe id={"a"}/>);
            const second = render(<Probe id={"b"}/>);
            expect(resizeCalls(add)).toHaveLength(1);

            first.unmount();
            expect(resizeCalls(remove)).toHaveLength(0);

            // Still listening for the one left.
            large = true;
            act(() => {
                window.dispatchEvent(new Event("resize"));
            });
            expect(second.getByTestId("b").textContent).toBe("large");

            second.unmount();
            expect(resizeCalls(remove)).toHaveLength(1);
            expect(resizeCalls(remove)[0][1]).toBe(resizeCalls(add)[0][1]);
        } finally {
            add.mockRestore();
            remove.mockRestore();
        }
    });

    it("reads the layout as it is when a reader mounts, not as it was at import", () => {
        large = true;
        function Probe() {
            return <span data-testid={"p"}>{useLargeLayout() ? "large" : "small"}</span>;
        }
        const view = render(<Probe/>);
        expect(view.getByTestId("p").textContent).toBe("large");
        view.unmount();
    });
});
