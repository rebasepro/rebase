/**
 * @jest-environment jsdom
 */
import React from "react";
import { render } from "@testing-library/react";
import { CollectionView } from "../src";

jest.mock("react-use-measure", () => () => [() => undefined, { width: 800, height: 600, top: 0, left: 0, bottom: 0, right: 0, x: 0, y: 0 }]);

global.ResizeObserver = class {
    observe() { /* noop */ }
    unobserve() { /* noop */ }
    disconnect() { /* noop */ }
};

/**
 * `CollectionView` is deprecated in favour of `CollectionPanel` from
 * `@rebasepro/cms`. It still renders, and says so once per page load, however
 * many times it renders.
 */
describe("CollectionView (deprecated)", () => {
    it("still renders its rows, and warns exactly once", () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        const rows = [{ id: "1", name: "Ada" }, { id: "2", name: "Grace" }];
        const view = (
            <CollectionView
                dataController={{ data: rows, loading: false, noMoreToLoad: true }}
                properties={{ name: { type: "string", name: "Name" } }}
                defaultViewMode="list"
                title="People"
            />
        );
        const { getByText, rerender, unmount } = render(view);
        expect(getByText("Ada")).toBeTruthy();
        rerender(view);
        unmount();
        render(view);

        const deprecations = warn.mock.calls.filter(([message]) => String(message).includes("Deprecated"));
        expect(deprecations).toHaveLength(1);
        expect(String(deprecations[0][0])).toBe("[Rebase] Deprecated: `CollectionView` from @rebasepro/ui is deprecated; use `CollectionPanel` from @rebasepro/cms instead.");
        warn.mockRestore();
    });
});
