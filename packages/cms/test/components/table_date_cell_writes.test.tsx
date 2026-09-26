/**
 * @jest-environment jsdom
 *
 * A typed date reaches the row once, when it is complete.
 *
 * A date cell can be typed into at rest, and the native input reports every
 * keystroke: retyping the year of 2025-05-12 as 2026 passes through
 * 0002-05-12, 0020-05-12 and 0202-05-12 (the first two read as 1902 and 1920
 * by `new Date(year, …)`). The cell saved each of them — four writes, each
 * running the collection's callbacks and recording history, and able to land
 * out of order and leave 0202 behind. Text and number cells wait for the
 * typing to pause and write when they are left; the date cell did neither.
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render } from "@testing-library/react";
import type { DateProperty, Entity } from "@rebasepro/types";
import type { SelectedCellProps } from "@rebasepro/cms-types";
import type { DataCollectionTableController, OnCellValueChangeParams } from "@rebasepro/app";

if (typeof globalThis.ResizeObserver === "undefined") {
    class NoopResizeObserver {
        observe() { /* nothing to observe in jsdom */ }
        unobserve() { /* nothing to observe in jsdom */ }
        disconnect() { /* nothing to observe in jsdom */ }
    }
    Object.defineProperty(globalThis, "ResizeObserver", { value: NoopResizeObserver, configurable: true });
}

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useRebaseContext: () => ({}),
        useAuthController: () => ({ user: null }),
        useCustomizationController: () => ({ plugins: [], propertyConfigs: {}, locale: undefined }),
        useData: () => ({ collection: () => ({}) }),
        useTranslation: () => ({ t: (key: string) => key })
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});
jest.mock("../../src/form", () => ({
    PropertyFieldBinding: () => null,
    zodToFormErrors: () => ({})
}));

import { PropertyTableCell } from "../../src/components/CollectionTableBinding/PropertyTableCell";
import { SelectableTableContext } from "../../src/components/SelectableTable/SelectableTableContext";

const published: DateProperty = { type: "date", name: "Published", mode: "date" };

/** Renders a date cell holding 2025-05-12 and returns its input and the days it writes. */
function renderDateCell() {
    const writes: string[] = [];
    let selected: SelectedCellProps | undefined;
    const store = {
        getEntity: () => selected,
        subscribe: () => () => undefined,
        select: (cell?: SelectedCellProps) => { selected = cell; }
    };
    const controller: DataCollectionTableController<Record<string, unknown>> = {
        selectionStore: store,
        select: store.select,
        onValueChange: ({ value }: OnCellValueChangeParams<unknown, Record<string, unknown>>) => {
            if (!(value instanceof Date)) {
                writes.push(String(value));
                return;
            }
            const pad = (n: number, width = 2) => String(n).padStart(width, "0");
            writes.push(`${pad(value.getFullYear(), 4)}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`);
        },
        size: "m"
    };
    const value = new Date(2025, 4, 12);
    const entity: Entity<Record<string, unknown>> = { id: "1", path: "posts", values: { published: value } };
    const view = render(<SelectableTableContext.Provider value={controller}>
        <PropertyTableCell propertyKey={"published"}
            columnIndex={1}
            align={"left"}
            value={value}
            readonly={false}
            property={published}
            height={40}
            width={200}
            entity={entity}
            path={"posts"}
            disabled={false}/>
    </SelectableTableContext.Provider>);
    const input = view.container.querySelector("input[type=date]");
    if (!(input instanceof HTMLInputElement)) throw new Error("the date cell has no date input");
    return { input, writes };
}

/** What Chrome's date input reports while the year segment is retyped as 2026. */
const typingTheYear = ["0002-05-12", "0020-05-12", "0202-05-12", "2026-05-12"];

const wait = (ms: number) => act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
});

describe("typing a date into a table cell", () => {

    it("writes the date once, when the cell is left", async () => {
        const { input, writes } = renderDateCell();
        fireEvent.focus(input);
        for (const typed of typingTheYear) fireEvent.change(input, { target: { value: typed } });
        await wait(50);
        expect(writes).toEqual([]);

        fireEvent.blur(input);
        await wait(0);
        expect(writes).toEqual(["2026-05-12"]);
    });

    it("writes the date once the typing pauses, and never a year still being typed", async () => {
        const { input, writes } = renderDateCell();
        fireEvent.focus(input);
        for (const typed of typingTheYear) {
            fireEvent.change(input, { target: { value: typed } });
            await wait(500);
        }
        expect(writes).toEqual(["2026-05-12"]);

        fireEvent.blur(input);
        await wait(0);
        expect(writes).toEqual(["2026-05-12"]);
    });

    it("writes a date picked without focusing the input at once", async () => {
        const { input, writes } = renderDateCell();
        fireEvent.change(input, { target: { value: "2026-06-01" } });
        await wait(0);
        expect(writes).toEqual(["2026-06-01"]);
    });
});
