import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { DateTimeField } from "../src";

/**
 * A disabled date field is read-only, adornments included.
 *
 * Its clear button was neither disabled nor guarded, so a read-only date
 * property with `admin.clearable` could be set to null with one click; its
 * calendar button called `showPicker()` on a disabled input, which throws
 * ("cannot be used on immutable controls"). Both buttons were also unnamed.
 */
describe("DateTimeField disabled", () => {

    const value = new Date("2026-01-15T10:00:00Z");

    it("cannot be cleared", () => {
        const onChange = jest.fn();
        render(<DateTimeField label="Published" value={value} onChange={onChange} disabled clearable/>);
        const clear = screen.getByRole("button", { name: "Clear date" });
        expect(clear).toBeDisabled();
        fireEvent.click(clear);
        expect(onChange).not.toHaveBeenCalled();
    });

    it("does not offer its calendar", () => {
        render(<DateTimeField label="Published" value={value} onChange={() => undefined} disabled/>);
        expect(screen.getByRole("button", { name: "Open calendar" })).toBeDisabled();
    });

    it("still clears and opens when enabled", () => {
        const onChange = jest.fn();
        render(<DateTimeField label="Published" value={value} onChange={onChange} clearable/>);
        fireEvent.click(screen.getByRole("button", { name: "Clear date" }));
        expect(onChange).toHaveBeenCalledWith(null);
        expect(screen.getByRole("button", { name: "Open calendar" })).toBeEnabled();
    });

    it("a picker the browser refuses to open does not throw out of the click", () => {
        render(<DateTimeField label="Published" value={value} onChange={() => undefined}/>);
        const input = screen.getByLabelText("Published") as HTMLInputElement;
        input.showPicker = () => {
            throw new DOMException("showPicker() cannot be used on immutable controls", "InvalidStateError");
        };
        expect(() => fireEvent.click(screen.getByRole("button", { name: "Open calendar" }))).not.toThrow();
    });
});
