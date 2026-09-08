/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";

import { CompactEntityCellField } from "../../src/components/CollectionTableBinding/fields/CompactEntityCellField";

/**
 * The selected reference cell in a text row. The value's inline line is the
 * children (its title opens the record on its own); this control adds the
 * prompt when empty, a pencil that opens the picker and a cross that clears.
 * The demo app has no dialog-widget column, so this is where the variant is
 * exercised.
 *
 * Without a translation provider `t()` returns the key, so labels are matched
 * case-insensitively ("edit" here, "Edit" in the app).
 */
const EDIT = /^edit$/i;
const CLEAR = /^clear$/i;

describe("CompactEntityCellField", () => {

    test("empty: the prompt opens the picker, and there is nothing to clear", () => {
        const onEdit = jest.fn();
        const onClear = jest.fn();
        render(<CompactEntityCellField empty disabled={false} onEdit={onEdit} onClear={onClear} emptyLabel={"Customer"}/>);
        fireEvent.click(screen.getByText("Customer"));
        expect(onEdit).toHaveBeenCalledTimes(1);
        expect(screen.getByLabelText(EDIT)).toBeTruthy();
        expect(screen.queryByLabelText(CLEAR)).toBeNull();
    });

    test("with a value: the line stays, the pencil edits, the cross clears", () => {
        const onEdit = jest.fn();
        const onClear = jest.fn();
        render(
            <CompactEntityCellField empty={false} disabled={false} onEdit={onEdit} onClear={onClear}>
                <span>Barbara Miller</span>
            </CompactEntityCellField>
        );
        expect(screen.getByText("Barbara Miller")).toBeTruthy();
        fireEvent.click(screen.getByLabelText(EDIT));
        expect(onEdit).toHaveBeenCalledTimes(1);
        expect(onClear).not.toHaveBeenCalled();
        fireEvent.click(screen.getByLabelText(CLEAR));
        expect(onClear).toHaveBeenCalledTimes(1);
    });

    test("disabled: the line is shown and no tool is offered", () => {
        render(
            <CompactEntityCellField empty={false} disabled onEdit={() => undefined} onClear={() => undefined}>
                <span>Barbara Miller</span>
            </CompactEntityCellField>
        );
        expect(screen.getByText("Barbara Miller")).toBeTruthy();
        expect(screen.queryByLabelText(EDIT)).toBeNull();
        expect(screen.queryByLabelText(CLEAR)).toBeNull();
    });
});
