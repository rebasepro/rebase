import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { VirtualTableInput } from "../src/components/VirtualTable/fields/VirtualTableInput";
import { VirtualTableDateField } from "../src/components/VirtualTable/fields/VirtualTableDateField";

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

});
