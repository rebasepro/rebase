/**
 * @jest-environment jsdom
 */
import React from "react";
import type { ArrayProperty, StringProperty } from "@rebasepro/cms-types";
import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react";

import { SelectFieldBinding } from "../../src/form/field_bindings/SelectFieldBinding";
import { MultiSelectFieldBinding } from "../../src/form/field_bindings/MultiSelectFieldBinding";
import { fakeFormContext } from "../helpers/fakes";

/**
 * A form control announces itself by the property it edits.
 *
 * Every enum field in every entity form was announced as **"Select an option"**
 * — a hard-coded English literal in `Select.tsx`, reached because the visible
 * label is an *element* (it carries the property's type icon and a tooltip) and
 * the component only derives a name from a `label` that is a string. The label
 * is a `<div>` with no `id`, so there was no `for`/`aria-labelledby` either:
 * three enum fields on one form were three controls with one name between them.
 *
 * `Status`, not `Select an option`, and not the currently selected value.
 */

const props = {
    propertyKey: "status",
    value: null,
    setValue: () => undefined,
    setFieldValue: () => undefined,
    error: undefined,
    showError: false,
    disabled: false,
    autoFocus: false,
    touched: false,
    includeDescription: false,
    isSubmitting: false,
    partOfArray: false,
    context: fakeFormContext({})
};

const enumProperty: StringProperty = {
    type: "string",
    name: "Status",
    enum: [
        { id: "draft", label: "Draft" },
        { id: "published", label: "Published" }
    ]
};

const arrayEnumProperty: ArrayProperty = {
    type: "array",
    name: "Tags",
    of: {
        type: "string",
        enum: [
            { id: "news", label: "News" },
            { id: "sport", label: "Sport" }
        ]
    }
};

describe("a field binding's control is named after its property", () => {

    it("names the enum select `Status`, not `Select an option`", () => {
        render(<SelectFieldBinding {...props} property={enumProperty}/>);

        const control = screen.getByRole("combobox");

        expect(control.getAttribute("aria-label")).toBe("Status");
        expect(control.getAttribute("aria-label")).not.toBe("Select an option");
    });

    it("names the multi-select after its property, on an empty field", () => {
        // The trigger's name would otherwise be whatever chips are selected —
        // so an empty field had no name at all, and a filled one changed name
        // as the reader edited it.
        render(
            <MultiSelectFieldBinding
                {...props}
                propertyKey="tags"
                value={[]}
                property={arrayEnumProperty}
            />
        );

        expect(screen.getByRole("button", { name: "Tags" })).toBeTruthy();
    });

    it("falls back to the property key when the property has no name", () => {
        const unnamed: StringProperty = { ...enumProperty, name: undefined };

        render(<SelectFieldBinding {...props} property={unnamed}/>);

        expect(screen.getByRole("combobox").getAttribute("aria-label")).toBe("status");
    });
});
