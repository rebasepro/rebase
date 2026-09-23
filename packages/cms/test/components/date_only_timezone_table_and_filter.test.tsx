/**
 * @jest-environment jsdom
 */
import React from "react";
import { beforeAll, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import type { DateProperty, Entity, Property, WhereFilterOp } from "@rebasepro/types";

/**
 * The table's date cell and the date filter read and write a date the way the
 * record form does.
 *
 * A `columnType: "date"` column holds a calendar day with no zone: it travels
 * as that day's UTC midnight, and Postgres keeps the date part of whatever it
 * is given. The form reads and writes it in UTC; the table cell and the filter
 * worked in the browser's own zone, so west of Greenwich a stored 15th showed
 * as the 14th, and east of it a 15th picked in a cell was stored as the 14th
 * and a filter for the 15th asked for the 14th's evening. A property's
 * declared `timezone` reached neither of them.
 *
 * These run in whatever zone the machine is in, so each case pairs a value
 * that goes wrong to the west with one that goes wrong to the east: outside
 * UTC, a field working in the local zone fails one of them.
 */

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useCustomizationController: () => ({ plugins: [], propertyConfigs: {}, locale: undefined }),
        useTranslation: () => ({ t: (key: string) => key })
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

import { getTableBindingForProperty } from "../../src/components/CollectionTableBinding/table_bindings";
import { FilterFieldBinding } from "../../src/components/SelectableTable/filters/FilterFieldBinding";

beforeAll(() => {
    // Radix Select needs pointer capture and scrollIntoView; jsdom has neither.
    Object.assign(Element.prototype, {
        hasPointerCapture: () => false,
        setPointerCapture: () => undefined,
        releasePointerCapture: () => undefined,
        scrollIntoView: () => undefined
    });
});

const dateOnly = { type: "date", name: "Due", columnType: "date", mode: "date" } satisfies DateProperty;
const inTokyo = { type: "date", name: "Due", mode: "date_time", timezone: "Asia/Tokyo" } satisfies DateProperty;

/** The 15th's first minute and last half hour, in UTC. */
const startOfThe15th = new Date("2026-03-15T00:00:00.000Z");
const endOfThe15th = new Date("2026-03-15T23:30:00.000Z");

const entity: Entity<Record<string, unknown>> = { id: "1", path: "tasks", values: {} };

function renderCell(property: Property, value: Date | null, updateValue: (value: unknown) => void = () => undefined) {
    const binding = getTableBindingForProperty(property, true);
    if (!binding) throw new Error("no table binding for a date property");
    const { Component } = binding;
    return render(<Component propertyKey={"due"}
        property={property}
        internalValue={value}
        updateValue={updateValue}
        disabled={false}
        selected={true}
        size={"m"}
        align={"left"}
        entity={entity}
        path={"tasks"}/>);
}

function cellInput(): HTMLInputElement {
    return screen.getByLabelText("due") as HTMLInputElement;
}

function renderFilter(property: Property, value: Date | undefined, setValue: (value?: [WhereFilterOp, unknown]) => void = () => undefined) {
    const view = render(<FilterFieldBinding propertyKey={"due"}
        property={property}
        engine={"postgres"}
        value={value ? [">=", value] : undefined}
        setValue={setValue}/>);
    const input = view.container.querySelector("input[type=\"date\"], input[type=\"datetime-local\"]");
    if (!(input instanceof HTMLInputElement)) throw new Error("the date filter rendered no date input");
    return { view, input };
}

describe("the table cell of a date-only property", () => {

    it("shows the stored day", () => {
        const view = renderCell(dateOnly, startOfThe15th);
        expect(cellInput().value).toEqual("2026-03-15");
        view.unmount();

        renderCell(dateOnly, endOfThe15th);
        expect(cellInput().value).toEqual("2026-03-15");
    });

    it("is a day even when the property's mode says date_time", () => {
        renderCell({ ...dateOnly, mode: "date_time" }, endOfThe15th);
        expect(cellInput().type).toEqual("date");
        expect(cellInput().value).toEqual("2026-03-15");
    });

    it("writes the picked day as that day's UTC midnight", () => {
        const written: unknown[] = [];
        renderCell(dateOnly, null, (value) => written.push(value));
        fireEvent.change(cellInput(), { target: { value: "2026-03-15" } });
        expect(written).toEqual([new Date("2026-03-15T00:00:00.000Z")]);
    });
});

describe("the table cell of a property with a timezone", () => {

    it("is shown and entered in that zone", () => {
        const written: unknown[] = [];
        renderCell(inTokyo, startOfThe15th, (value) => written.push(value));
        expect(cellInput().value).toEqual("2026-03-15T09:00");

        fireEvent.change(cellInput(), { target: { value: "2026-03-15T10:00" } });
        expect(written).toEqual([new Date("2026-03-15T01:00:00.000Z")]);
    });
});

describe("the date filter", () => {

    it("shows a date-only filter value as the stored day", () => {
        const first = renderFilter(dateOnly, startOfThe15th);
        expect(first.input.value).toEqual("2026-03-15");
        first.view.unmount();

        const second = renderFilter(dateOnly, endOfThe15th);
        expect(second.input.value).toEqual("2026-03-15");
    });

    it("filters a date-only column by the picked day's UTC midnight", () => {
        const set: ([WhereFilterOp, unknown] | undefined)[] = [];
        const { input } = renderFilter(dateOnly, undefined, (value) => set.push(value));
        fireEvent.change(input, { target: { value: "2026-03-15" } });
        expect(set).toEqual([["==", new Date("2026-03-15T00:00:00.000Z")]]);
    });

    it("is entered in the property's timezone", () => {
        const set: ([WhereFilterOp, unknown] | undefined)[] = [];
        const { input } = renderFilter(inTokyo, startOfThe15th, (value) => set.push(value));
        expect(input.value).toEqual("2026-03-15T09:00");

        fireEvent.change(input, { target: { value: "2026-03-15T10:00" } });
        expect(set).toEqual([[">=", new Date("2026-03-15T01:00:00.000Z")]]);
    });
});
