/**
 * @jest-environment jsdom
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, render, screen } from "@testing-library/react";

/**
 * A collection toolbar too narrow for its labelled controls drew them over each
 * other. A relation tab beside the split list, at a 1280 px window, is a ~650 px
 * toolbar: the window said "large layout", so "Filters", the sort count,
 * "Add existing" and "Add Tag" all came labelled, the left group was squeezed,
 * and its controls were drawn over the search bar and the upload icon.
 *
 * The toolbar now decides from its own width: when its controls do not fit, it
 * asks them for their icon-only forms, and it asks for the labels back only
 * once there is room for what they took.
 */

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useTranslation: () => ({ t: (key: string) => key }),
        useLargeLayout: () => true
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

import {
    CollectionTableToolbar,
    useToolbarLabels
} from "../../src/components/CollectionTableBinding/internal/CollectionTableToolbar";

/** What a control in the toolbar is told. */
function Probe() {
    return <span>{useToolbarLabels() ? "labelled" : "icons"}</span>;
}

/** The room the toolbar has, and what its controls take at their natural width. */
const layout = { available: 1200, needed: 800 };
let observed: (() => void) | undefined;

class ResizeObserverStub {
    constructor(callback: () => void) { observed = callback; }
    observe() {}
    unobserve() {}
    disconnect() {}
}

let toolbar: HTMLElement;
let row: HTMLElement;

beforeEach(() => {
    Object.assign(global, { ResizeObserver: ResizeObserverStub });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
        configurable: true,
        get(this: HTMLElement) { return this === toolbar ? layout.available : 0; }
    });
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
        configurable: true,
        get(this: HTMLElement) { return this === row ? Math.max(layout.needed, layout.available) : 0; }
    });
});

afterEach(() => {
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
    observed = undefined;
});

/** Resize to `available`, with the controls taking `needed` while labelled. */
function resize(available: number, needed: number) {
    layout.available = available;
    layout.needed = needed;
    act(() => observed?.());
}

function renderToolbar() {
    const { container } = render(<CollectionTableToolbar loading={false} actionsStart={<Probe/>}/>);
    toolbar = container.firstElementChild as HTMLElement;
    row = toolbar.firstElementChild as HTMLElement;
    // The layout effect measured before the elements were known to the stub.
    act(() => observed?.());
}

describe("a collection toolbar's labels", () => {
    it("are kept while its controls fit", () => {
        renderToolbar();
        resize(1200, 800);
        expect(screen.getByText("labelled")).toBeTruthy();
    });

    it("give way to icons when its controls do not fit", () => {
        renderToolbar();
        resize(650, 820);
        expect(screen.getByText("icons")).toBeTruthy();
    });

    it("come back only when there is room for what they took", () => {
        renderToolbar();
        resize(650, 820);
        // Icon-only, the controls take 500: they would fit, but the labels
        // would not.
        resize(700, 500);
        expect(screen.getByText("icons")).toBeTruthy();

        resize(900, 500);
        expect(screen.getByText("labelled")).toBeTruthy();
    });
});
