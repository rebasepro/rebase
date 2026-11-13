/**
 * @jest-environment jsdom
 */
import React from "react";
import type { StringProperty } from "@rebasepro/cms-types";
import { describe, expect, it } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { SelectFieldBinding } from "../../src/form/field_bindings/SelectFieldBinding";
import { fakeFormContext } from "../helpers/fakes";

/**
 * A letter typed on a focused enum field picks the value whose label starts
 * with it, whatever the length of the list.
 *
 * Above 50 values a closed select no longer renders its options (a country or
 * time-zone field paid for its whole list on every render of the form). The
 * options are chips, which draw their label themselves, so the field hands
 * each option's label to the select to be matched against.
 */

const enumValues = Array.from({ length: 60 }, (_, i) => ({
    id: `c${i}`,
    label: i === 41 ? "Germany" : `Zone ${i}`
}));

const property: StringProperty = {
    type: "string",
    name: "Country",
    enum: enumValues
};

describe("an enum field with a long list", () => {

    it("picks the value whose label starts with the letter typed on the closed field", () => {
        const values: unknown[] = [];
        render(<SelectFieldBinding
            propertyKey={"country"}
            value={null}
            setValue={(value: unknown) => values.push(value)}
            setFieldValue={() => undefined}
            error={undefined}
            showError={false}
            disabled={false}
            autoFocus={false}
            touched={false}
            includeDescription={false}
            isSubmitting={false}
            partOfArray={false}
            context={fakeFormContext({})}
            property={property}/>);

        act(() => {
            fireEvent.keyDown(screen.getByRole("combobox"), { key: "g" });
        });

        expect(values).toEqual(["c41"]);
    });
});
