/**
 * @jest-environment jsdom
 */
/**
 * A number field keeps the text being typed while it still reads as the same
 * number.
 *
 * The input is controlled by the stored number. Handed back to the input as a
 * string, it is compared with the typed text as a string: `"1.0"` is not
 * `"1"`, so React rewrote the box to `"1"` the moment the zero was typed, and
 * `1.05` or `0.05` could not be entered one keystroke at a time — the next
 * digit landed after `1` and made `15`.
 */
import React, { useState } from "react";
import { describe, expect, it } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import type { NumberProperty } from "@rebasepro/types";
import { RebaseI18nProvider } from "@rebasepro/app";
import { TextFieldBinding } from "../../src/form/field_bindings/TextFieldBinding";
import type { FieldProps } from "../../src/types/fields";
import { fakeFieldProps, fakeFormContext } from "../helpers/fakes";

const property: NumberProperty = { type: "number", name: "Price" };

function Harness({ onValue }: { onValue: (value: number | null) => void }) {
    const [value, setValue] = useState<number | null>(null);
    const props = fakeFieldProps(property, {
        propertyKey: "price",
        value,
        setValue: (next: number | null) => {
            onValue(next);
            setValue(next);
        },
        includeDescription: false,
        showError: false,
        isSubmitting: false,
        partOfArray: false,
        minimalistView: false,
        autoFocus: false,
        hideLabel: true,
        disabled: false,
        setFieldValue: () => undefined,
        context: fakeFormContext({})
    });
    return <TextFieldBinding {...props}/>;
}

describe("number field typing", () => {
    it("keeps a trailing decimal zero while the number is typed", () => {
        const written: Array<number | null> = [];
        render(<RebaseI18nProvider locale="en">
            <Harness onValue={(v) => written.push(v)}/>
        </RebaseI18nProvider>);
        const input = screen.getByLabelText("Price") as HTMLInputElement;

        fireEvent.change(input, { target: { value: "0" } });
        fireEvent.change(input, { target: { value: "0.0" } });
        expect(input.value).toBe("0.0");
        fireEvent.change(input, { target: { value: "0.05" } });
        expect(input.value).toBe("0.05");
        expect(written[written.length - 1]).toBe(0.05);

        fireEvent.change(input, { target: { value: "1.50" } });
        expect(input.value).toBe("1.50");
        expect(written[written.length - 1]).toBe(1.5);
    });

    it("writes 0 for a typed zero and null for an emptied box", () => {
        const written: Array<number | null> = [];
        render(<RebaseI18nProvider locale="en">
            <Harness onValue={(v) => written.push(v)}/>
        </RebaseI18nProvider>);
        const input = screen.getByLabelText("Price") as HTMLInputElement;
        fireEvent.change(input, { target: { value: "0" } });
        expect(written[written.length - 1]).toBe(0);
        fireEvent.change(input, { target: { value: "" } });
        expect(written[written.length - 1]).toBeNull();
        expect(input.value).toBe("");
    });
});
