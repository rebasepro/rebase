/**
 * @jest-environment jsdom
 */
import React from "react";
import { beforeAll, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import type { FilterValues, Property } from "@rebasepro/types";

/**
 * Filters → "Clear all" emptied the dialog's filters, and the count, but every
 * field went on showing the value it had: a field keeps what it shows in its
 * own state (it has to — an operator picked before any value is not a filter
 * yet), seeded once from the value it was given. Apply then removed every
 * filter the dialog still showed, and a filter added after "Clear all" was
 * applied alone while the dialog showed two.
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

import { FiltersDialog } from "../../src/components/CollectionViewBinding/FiltersDialog";

beforeAll(() => {
    // Radix Select needs pointer capture and scrollIntoView; jsdom has neither.
    Object.assign(Element.prototype, {
        hasPointerCapture: () => false,
        setPointerCapture: () => undefined,
        releasePointerCapture: () => undefined,
        scrollIntoView: () => undefined
    });
});

const properties: Record<string, Property> = {
    title: { type: "string", name: "Title" },
    status: {
        type: "string",
        name: "Status",
        enum: [{ id: "draft", label: "Draft" }, { id: "published", label: "Published" }]
    }
};

const applied: FilterValues<string> = {
    title: ["==", "Bernoulli"],
    status: ["==", "published"]
};

function renderDialog(setFilterValues: (filterValues?: FilterValues<string>) => void = () => undefined) {
    return render(<FiltersDialog
        open={true}
        onOpenChange={() => undefined}
        properties={properties}
        filterValues={applied}
        setFilterValues={setFilterValues}/>);
}

function titleField(): HTMLInputElement {
    return screen.getByLabelText("Title filter value") as HTMLInputElement;
}

describe("Filters → Clear all", () => {
    it("empties the fields as well as the filters", () => {
        renderDialog();
        expect(titleField().value).toBe("Bernoulli");
        expect(screen.getByText("Published")).toBeTruthy();

        fireEvent.click(screen.getByRole("button", { name: "clear_all" }));

        expect(titleField().value).toBe("");
        expect(screen.queryByText("Published")).toBeNull();
    });

    it("applies only what the dialog shows after it", () => {
        const setFilterValues = jest.fn<(filterValues?: FilterValues<string>) => void>();
        renderDialog(setFilterValues);

        fireEvent.click(screen.getByRole("button", { name: "clear_all" }));
        fireEvent.change(titleField(), { target: { value: "Euler" } });
        fireEvent.click(screen.getByRole("button", { name: "apply_filters" }));

        expect(setFilterValues).toHaveBeenCalledWith({ title: ["==", "Euler"] });
        expect(titleField().value).toBe("Euler");
        expect(screen.queryByText("Published")).toBeNull();
    });
});
