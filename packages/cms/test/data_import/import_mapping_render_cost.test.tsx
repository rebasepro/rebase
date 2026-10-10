/**
 * @jest-environment jsdom
 */
import React from "react";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * What the import's mapping step renders.
 *
 * One property picker per file column, each listing every property of the
 * collection. A closed picker rendered its whole list anyway, so the step drew
 * columns × properties entries — each a tooltip, a badge and a field-config
 * lookup — at mount and again on every remap: 30 columns × 60 properties was
 * 1,800 entries and half a second per change (dev). A list longer than 50 now
 * renders only the entry it shows while closed, and every list is built once
 * per collection, so a remap redraws only the pickers it changed.
 */

// Every property entry looks its field config up once per render, so the
// lookups count the entries drawn.
let entryRenders = 0;
jest.mock("../../src/components/field_configs", () => {
    const actual = jest.requireActual("../../src/components/field_configs") as Record<string, unknown>;
    const getFieldConfig = actual.getFieldConfig as (...args: unknown[]) => unknown;
    return {
        ...actual,
        getFieldConfig: (...args: unknown[]) => {
            entryRenders++;
            return getFieldConfig(...args);
        }
    };
});

jest.mock("@rebasepro/app", () => {
    const customization = { plugins: [], propertyConfigs: {}, entityActions: [], entityViews: [], resolvedSlots: [] };
    const snackbar = { open: () => undefined, close: () => undefined };
    const translation = { t: (key: string) => key };
    const overrides: Record<string, unknown> = {
        useCustomizationController: () => customization,
        useSnackbarController: () => snackbar,
        useAuthController: () => ({ user: { uid: "u1" } }),
        useTranslation: () => translation
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

// The file is read elsewhere; this hands the step its rows directly.
let rows: object[] = [];
jest.mock("../../src/data_import/components/ImportFileUpload", () => ({
    ImportFileUpload: ({ onDataAdded }: { onDataAdded: (data: object[]) => void }) =>
        <button onClick={() => onDataAdded(rows)}>load file</button>
}));

import { ImportCollectionAction } from "../../src/data_import/import/ImportCollectionAction";

if (typeof globalThis.ResizeObserver === "undefined") {
    class NoopResizeObserver {
        observe() { /* no layout in jsdom */ }
        unobserve() { /* no layout in jsdom */ }
        disconnect() { /* no layout in jsdom */ }
    }
    Object.defineProperty(globalThis, "ResizeObserver", { value: NoopResizeObserver, configurable: true });
}

function collectionOf(propertyCount: number) {
    const properties: Record<string, unknown> = {};
    for (let i = 0; i < propertyCount; i++) {
        properties[`prop_${i}`] = { type: "string", name: `Field ${i}` };
    }
    return { slug: "items", name: "Items", properties } as never;
}

/** Opens the import on a file whose columns are named after the first `columns` properties. */
async function openMapping(columns: number, properties: number) {
    rows = [Object.fromEntries(Array.from({ length: columns }, (_, i) => [`prop_${i}`, `value ${i}`]))];
    render(<ImportCollectionAction collection={collectionOf(properties)} path={"items"} {...({} as never)}/>);
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    jest.useFakeTimers();
    await act(async () => {
        fireEvent.click(screen.getByText("load file"));
    });
    await act(async () => {
        jest.advanceTimersByTime(200);
    });
    jest.useRealTimers();
    // The id picker and one picker per column.
    expect(screen.getAllByRole("combobox")).toHaveLength(columns + 1);
}

/** Remaps the first column by typing on its closed picker: "Field 1" takes it over from column 2. */
function remapFirstColumn() {
    const firstColumnPicker = screen.getAllByRole("combobox")[1];
    act(() => {
        fireEvent.keyDown(firstColumnPicker, { key: "f" });
    });
}

afterEach(() => {
    cleanup();
    entryRenders = 0;
});

describe("the import mapping step", () => {

    it("30 columns × 60 properties: one entry per column at mount, not the whole list", async () => {
        entryRenders = 0;
        await openMapping(30, 60);
        // The entry each picker shows, in its trigger and as its one hidden option.
        expect(entryRenders).toBeLessThanOrEqual(30 * 3);
    });

    it("20 columns × 20 properties: a remap redraws the pickers it changed, not every list", async () => {
        await openMapping(20, 20);
        entryRenders = 0;
        remapFirstColumn();
        // Two pickers changed (the column remapped, and the one that held the
        // property before); every other list stays as it was drawn.
        expect(entryRenders).toBeLessThanOrEqual(2 * 22);
    });
});
