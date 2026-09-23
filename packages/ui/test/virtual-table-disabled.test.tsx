import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { VirtualTableInput } from "../src/components/VirtualTable/fields/VirtualTableInput";
import { VirtualTableDateField } from "../src/components/VirtualTable/fields/VirtualTableDateField";
import { VirtualTableSwitch } from "../src/components/VirtualTable/fields/VirtualTableSwitch";
import { VirtualTableNumberInput } from "../src/components/VirtualTable/fields/VirtualTableNumberInput";

/**
 * `admin: { disabled: true }` on a property, in the table's inline editor.
 *
 * It is a public, documented option — `PropertyDisabledConfig` carries a
 * `disabledMessage` explaining *why* a field is disabled, so it is a
 * first-class feature rather than an internal flag. The table cell computes it
 * (`readonly || disabledProp || Boolean(property.admin?.disabled)`) and hands
 * it to the field binding, which hands it to these two components, which
 * destructured it and passed it to nothing.
 *
 * A property that is `readOnly` takes a different branch and renders a preview,
 * so that case was covered. A property that is merely *disabled* took the
 * editable branch and stayed editable: you could type into it, and the debounced
 * write fired on blur.
 */
describe("inline table fields honour `disabled`", () => {
    it("does not accept typing into a disabled string cell", () => {
        const updateValue = jest.fn();
        render(<VirtualTableInput
            value="hello"
            focused={false}
            disabled={true}
            updateValue={updateValue}
        />);

        const field = screen.getByRole("textbox");
        expect(field).toBeDisabled();
    });

    it("still accepts typing when it is not disabled", () => {
        const updateValue = jest.fn();
        render(<VirtualTableInput
            value="hello"
            focused={false}
            disabled={false}
            updateValue={updateValue}
        />);

        const field = screen.getByRole("textbox");
        expect(field).not.toBeDisabled();
        fireEvent.change(field, { target: { value: "hello there" } });
        expect((field as HTMLTextAreaElement).value).toBe("hello there");
    });

    it("disables a date cell too", () => {
        // Queried by tag rather than by role: a disabled input is removed from
        // the accessibility tree, so `getByRole("textbox")` cannot find the very
        // state this asserts.
        const { container } = render(<VirtualTableDateField
            internalValue={new Date("2026-01-01T00:00:00Z")}
            updateValue={() => { /* noop */ }}
            focused={false}
            disabled={true}
        />);

        // `DateTimeField` accepts `disabled` and dims and blocks itself with it;
        // the wrapper simply never forwarded it.
        expect(container.querySelector("input")).toBeDisabled();
    });

    it("leaves an enabled date cell editable", () => {
        const { container } = render(<VirtualTableDateField
            internalValue={new Date("2026-01-01T00:00:00Z")}
            updateValue={() => { /* noop */ }}
            focused={false}
            disabled={false}
        />);

        expect(container.querySelector("input")).not.toBeDisabled();
    });

    // The boolean cell renders its switch whether or not the cell is selected,
    // and refusing to select a disabled cell does not stop the button's own
    // click, so one click on a disabled boolean saved the flipped value.
    it("does not flip a disabled boolean cell", () => {
        const updateValue = jest.fn();
        render(<VirtualTableSwitch
            internalValue={false}
            focused={false}
            disabled={true}
            updateValue={updateValue}
        />);

        const toggle = screen.getByRole("switch");
        fireEvent.click(toggle);
        expect(updateValue).not.toHaveBeenCalled();
        expect(toggle).toHaveAttribute("aria-disabled", "true");
    });

    it("flips an enabled boolean cell", () => {
        const updateValue = jest.fn();
        render(<VirtualTableSwitch
            internalValue={false}
            focused={false}
            disabled={false}
            updateValue={updateValue}
        />);

        fireEvent.click(screen.getByRole("switch"));
        expect(updateValue).toHaveBeenCalledWith(true);
    });

    it("disables a number cell", () => {
        const { container } = render(<VirtualTableNumberInput
            value={3}
            focused={false}
            disabled={true}
            updateValue={() => { /* noop */ }}
        />);

        expect(container.querySelector("input")).toBeDisabled();
    });

});

/**
 * The number cell read its value with `value && …` and `value ? … : null`, so a
 * selected cell holding 0 showed an empty box: the stock of zero someone had
 * entered looked like no stock at all.
 */
describe("the inline number cell", () => {
    it.each([true, false])("shows 0 as 0 (focused: %s)", (focused) => {
        const { container } = render(<VirtualTableNumberInput
            value={0}
            focused={focused}
            disabled={false}
            updateValue={() => { /* noop */ }}
        />);

        expect(container.querySelector("input")).toHaveValue("0");
    });

    it("shows 0 when the value changes to it", () => {
        const updateValue = jest.fn();
        const { container, rerender } = render(<VirtualTableNumberInput
            value={5}
            focused={true}
            disabled={false}
            updateValue={updateValue}
        />);
        rerender(<VirtualTableNumberInput
            value={0}
            focused={true}
            disabled={false}
            updateValue={updateValue}
        />);

        expect(container.querySelector("input")).toHaveValue("0");
    });
});
