/**
 * @jest-environment jsdom
 */
import React from "react";
import { beforeAll, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import type { EnumValueConfig } from "@rebasepro/cms-types";

/**
 * What a filter value typed by hand turns into.
 *
 * Text typed and then deleted is no filter: emitted as `["==", ""]`, the
 * column filtered for empty strings, and the table emptied behind a value
 * field that looked blank. A number enum's ids are read as numbers, a
 * fraction included: `parseInt("1.5")` filtered for `1`.
 */

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useTranslation: () => ({ t: (key: string) => key })
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

import { StringNumberFilterField } from "../../src/components/SelectableTable/filters/StringNumberFilterField";

beforeAll(() => {
    Object.assign(Element.prototype, {
        hasPointerCapture: () => false,
        setPointerCapture: () => undefined,
        releasePointerCapture: () => undefined,
        scrollIntoView: () => undefined
    });
});

describe("StringNumberFilterField — typed values", () => {

    it("clears the filter when the typed text is deleted", () => {
        const setValue = jest.fn();
        render(<StringNumberFilterField name="name" type="string" value={["==", "Bob"]} setValue={setValue}/>);
        const input = screen.getByLabelText("name filter value");
        fireEvent.change(input, { target: { value: "Bo" } });
        expect(setValue).toHaveBeenLastCalledWith(["==", "Bo"]);
        fireEvent.change(input, { target: { value: "" } });
        expect(setValue).toHaveBeenLastCalledWith(undefined);
    });

    it("reads a fractional number enum id whole", () => {
        const ratings: EnumValueConfig[] = [
            { id: 1, label: "One" },
            { id: 1.5, label: "One and a half" }
        ];
        const setValue = jest.fn();
        render(<StringNumberFilterField name="rating" type="number" enumValues={ratings} value={["==", 1]} setValue={setValue}/>);
        // The value select is the second combobox, after the operator.
        const valueSelect = screen.getAllByRole("combobox")[1];
        fireEvent.click(valueSelect);
        fireEvent.keyDown(valueSelect, { key: "Enter" });
        fireEvent.click(screen.getByRole("option", { name: "One and a half" }));
        expect(setValue).toHaveBeenLastCalledWith(["==", 1.5]);
    });
});
