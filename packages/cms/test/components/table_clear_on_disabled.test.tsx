/**
 * @jest-environment jsdom
 *
 * A table cell never writes a value nobody chose.
 *
 * `admin.disabled: { clearOnDisabled: true }` clears a form field's value so
 * a stale answer is not saved with the record — a change to the form's
 * values, written only when the user saves. The table cell ran the same hook
 * with its own setter, which saves at once: every row the table rendered had
 * the column written as null, with inline editing on or off, while the user
 * only scrolled.
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, render } from "@testing-library/react";
import type { Entity, Property, StringProperty } from "@rebasepro/types";
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

type Write = { propertyKey: string; value: unknown };

const clearedWhenDisabled: StringProperty = {
    type: "string",
    name: "Legacy code",
    admin: { disabled: { clearOnDisabled: true, disabledMessage: "Retired" } }
};

function Cell({ property, readonly, onValueChange }: {
    property: Property;
    readonly: boolean;
    onValueChange: (params: OnCellValueChangeParams<unknown, Record<string, unknown>>) => void;
}) {
    let selected: SelectedCellProps | undefined;
    const store = {
        getEntity: () => selected,
        subscribe: () => () => undefined,
        select: (cell?: SelectedCellProps) => { selected = cell; }
    };
    const controller: DataCollectionTableController<Record<string, unknown>> = {
        selectionStore: store,
        select: store.select,
        onValueChange,
        size: "m"
    };
    const entity: Entity<Record<string, unknown>> = { id: "1", path: "things", values: { legacy_code: "ABC-123" } };
    return <SelectableTableContext.Provider value={controller}>
        <PropertyTableCell propertyKey={"legacy_code"}
            columnIndex={1}
            align={"left"}
            value={"ABC-123"}
            readonly={readonly}
            property={property}
            height={40}
            width={200}
            entity={entity}
            path={"things"}
            disabled={false}/>
    </SelectableTableContext.Provider>;
}

const settle = () => act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
});

describe("a clearOnDisabled property in the table", () => {

    it("is not written when a read-only cell renders", async () => {
        const writes: Write[] = [];
        const view = render(<Cell property={clearedWhenDisabled} readonly={true}
            onValueChange={({ propertyKey, value }) => writes.push({ propertyKey, value })}/>);
        await settle();
        expect(writes).toEqual([]);
        expect(view.container.textContent).toContain("ABC-123");
    });

    it("is not written when an editable cell renders", async () => {
        const writes: Write[] = [];
        const view = render(<Cell property={clearedWhenDisabled} readonly={false}
            onValueChange={({ propertyKey, value }) => writes.push({ propertyKey, value })}/>);
        await settle();
        expect(writes).toEqual([]);
        expect(view.container.textContent).toContain("ABC-123");
    });

    it("is not written when the property becomes disabled, nor again when it is enabled", async () => {
        const writes: Write[] = [];
        const onValueChange = ({ propertyKey, value }: OnCellValueChangeParams<unknown, Record<string, unknown>>) =>
            writes.push({ propertyKey, value });
        const enabled: StringProperty = { type: "string", name: "Legacy code" };
        const view = render(<Cell property={enabled} readonly={false} onValueChange={onValueChange}/>);
        view.rerender(<Cell property={clearedWhenDisabled} readonly={false} onValueChange={onValueChange}/>);
        await settle();
        view.rerender(<Cell property={enabled} readonly={false} onValueChange={onValueChange}/>);
        await settle();
        expect(writes).toEqual([]);
    });
});
