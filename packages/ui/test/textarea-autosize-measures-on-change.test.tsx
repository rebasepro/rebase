/**
 * `TextareaAutosize` measures itself — `getComputedStyle` plus two
 * `scrollHeight` reads on a shadow textarea it has just written to, which is a
 * forced synchronous layout — when something that decides its height changes,
 * not on every render.
 *
 * It used to run that measurement in a layout effect with no dependency list,
 * so a record form with a few multiline fields paid a forced layout per field
 * every time the form re-rendered for any reason. Width changes still re-sync
 * through the component's ResizeObserver, as before.
 */
import React from "react";
import { render } from "@testing-library/react";

import { TextareaAutosize } from "../src/components/TextareaAutosize";

function Field({ value, className = "w-full", parentTick = 0 }: { value: string, className?: string, parentTick?: number }) {
    // `parentTick` only stands for "the parent re-rendered": it does not reach
    // the textarea. The inline style is a new object each render, as every
    // caller in the repo writes it.
    void parentTick;
    return <TextareaAutosize value={value}
        onChange={() => undefined}
        className={className}
        style={{
            padding: 0,
            resize: "none"
        }}/>;
}

describe("TextareaAutosize", () => {
    let measure: jest.SpyInstance;

    beforeEach(() => {
        measure = jest.spyOn(window, "getComputedStyle");
    });

    afterEach(() => {
        measure.mockRestore();
    });

    it("does not measure again when its parent re-renders with the same props", () => {
        const { rerender } = render(<Field value={"hello"} parentTick={0}/>);
        measure.mockClear();

        for (let tick = 1; tick <= 5; tick++) rerender(<Field value={"hello"} parentTick={tick}/>);

        expect(measure).not.toHaveBeenCalled();
    });

    it("measures again when its value changes", () => {
        const { rerender } = render(<Field value={"hello"}/>);
        measure.mockClear();

        rerender(<Field value={"hello\nworld"}/>);

        expect(measure).toHaveBeenCalled();
    });

    it("measures again when its class changes, which can change its font", () => {
        const { rerender } = render(<Field value={"hello"}/>);
        measure.mockClear();

        rerender(<Field value={"hello"} className={"w-full text-2xl"}/>);

        expect(measure).toHaveBeenCalled();
    });
});
