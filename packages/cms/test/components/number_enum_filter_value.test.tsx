/**
 * @jest-environment jsdom
 */
import React from "react";
import { beforeAll, describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import type { EnumValueConfig } from "@rebasepro/types";

/**
 * A number-enum filter shows the value it is filtering by.
 *
 * The select read its value as `typeof internalValue === "string" ? … : ""`,
 * and a number enum stores the picked id as a number (`parseInt` of the
 * option). Pick priority 2: the filter applied, and the select went blank.
 * Priority 0 also lost its clear button, and rendered a stray "0" in its
 * place, because the button was guarded by the value's truthiness.
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
    // Radix Select needs pointer capture and scrollIntoView; jsdom has neither.
    Object.assign(Element.prototype, {
        hasPointerCapture: () => false,
        setPointerCapture: () => undefined,
        releasePointerCapture: () => undefined,
        scrollIntoView: () => undefined
    });
});

const priorities: EnumValueConfig[] = [
    { id: 0, label: "None" },
    { id: 1, label: "Low" },
    { id: 2, label: "High" }
];

function renderFilter(value: number) {
    return render(
        <StringNumberFilterField
            name="priority"
            type="number"
            enumValues={priorities}
            value={["==", value]}
            setValue={() => undefined}/>
    );
}

describe("StringNumberFilterField — a number enum", () => {

    it("shows the picked value", () => {
        renderFilter(2);
        expect(screen.getByText("High")).toBeTruthy();
    });

    it("shows a zero value, with its clear button and no stray 0", () => {
        const { container } = renderFilter(0);
        expect(screen.getByText("None")).toBeTruthy();
        expect(container.textContent).not.toContain("0");
        // The operator select, the value select, and the value's clear button.
        expect(container.querySelectorAll("button").length).toBe(3);
    });
});
