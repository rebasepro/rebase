/**
 * Every `Chip` follows the theme through `useIsDarkMode`, and the theme is an
 * attribute on `<html>`. One observer of that attribute is enough for a page;
 * it used to be one per subscriber, so a table showing 500 enum chips held
 * 500 `MutationObserver`s on the same element, built and torn down on every
 * virtualised scroll step, and a theme switch ran 500 callbacks.
 */
import React from "react";
import { act, render } from "@testing-library/react";

import { Chip } from "../src/components/Chip";

const RealMutationObserver = window.MutationObserver;
let created = 0;
let live = 0;

class CountingMutationObserver extends RealMutationObserver {
    private connected = false;

    constructor(callback: MutationCallback) {
        super(callback);
        created++;
    }

    observe(target: Node, options?: MutationObserverInit) {
        if (!this.connected) live++;
        this.connected = true;
        super.observe(target, options);
    }

    disconnect() {
        if (this.connected) live--;
        this.connected = false;
        super.disconnect();
    }
}

beforeAll(() => {
    window.MutationObserver = CountingMutationObserver;
});

afterAll(() => {
    window.MutationObserver = RealMutationObserver;
});

beforeEach(() => {
    created = 0;
    document.documentElement.classList.remove("dark");
});

function Chips({ count }: { count: number }) {
    return <>
        {Array.from({ length: count }, (_, i) => <Chip key={i} colorScheme={"blueLighter"}>{`chip ${i}`}</Chip>)}
    </>;
}

describe("useIsDarkMode", () => {
    it("watches <html> with one observer however many chips are mounted, and lets go of it when they unmount", () => {
        const { unmount } = render(<Chips count={100}/>);
        expect(created).toBe(1);
        expect(live).toBe(1);

        unmount();
        expect(live).toBe(0);
    });

    it("still re-renders every chip on a theme switch", async () => {
        const { container } = render(<Chips count={3}/>);
        const before = Array.from(container.querySelectorAll("div,span")).map(el => el.getAttribute("style")).join("|");

        await act(async () => {
            document.documentElement.classList.add("dark");
            // MutationObserver callbacks are microtasks.
            await Promise.resolve();
        });
        const after = Array.from(container.querySelectorAll("div,span")).map(el => el.getAttribute("style")).join("|");

        expect(after).not.toBe(before);
    });
});
