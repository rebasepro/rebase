/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";

import { CompactEntityCellField } from "../../src/components/CollectionTableBinding/fields/CompactEntityCellField";

/**
 * A reference or dialog-relation cell in a text row. The value's inline line
 * is the children (each title opens its record on its own); the dialog is
 * opened by the cell's opener, not by anything in here, and this control adds
 * a cross that clears. The demo app has no dialog-widget column, so this is
 * where the variant is exercised.
 *
 * Without a translation provider `t()` returns the key, so labels are matched
 * case-insensitively ("clear" here, "Clear" in the app).
 */
const EDIT = /^edit$/i;
const CLEAR = /^clear$/i;

describe("CompactEntityCellField", () => {

    test("empty: the empty marker, and nothing to clear or edit", () => {
        const onClear = jest.fn();
        const { container } = render(<CompactEntityCellField empty disabled={false} onClear={onClear}/>);
        // The same grey bar every other empty cell shows, not a prompt
        // repeated down the column.
        expect(container.textContent).toBe("");
        expect(container.querySelector(".rounded-full")).toBeTruthy();
        expect(screen.queryByLabelText(CLEAR)).toBeNull();
        // The cell's opener opens the dialog; a pencil here would be a second.
        expect(screen.queryByLabelText(EDIT)).toBeNull();
    });

    test("with a value: the line stays and the cross clears", () => {
        const onClear = jest.fn();
        render(
            <CompactEntityCellField empty={false} disabled={false} onClear={onClear}>
                <span>Barbara Miller</span>
            </CompactEntityCellField>
        );
        expect(screen.getByText("Barbara Miller")).toBeTruthy();
        expect(screen.queryByLabelText(EDIT)).toBeNull();
        fireEvent.click(screen.getByLabelText(CLEAR));
        expect(onClear).toHaveBeenCalledTimes(1);
    });

    test("the cross is revealed with the opener: on hover, or while the cell is selected", () => {
        const { rerender } = render(
            <CompactEntityCellField empty={false} disabled={false} onClear={() => undefined}>
                <span>Barbara Miller</span>
            </CompactEntityCellField>
        );
        expect(screen.getByLabelText(CLEAR).className).toContain("opacity-0");
        expect(screen.getByLabelText(CLEAR).className).toContain("group-hover/cell:opacity-100");
        rerender(
            <CompactEntityCellField empty={false} disabled={false} selected onClear={() => undefined}>
                <span>Barbara Miller</span>
            </CompactEntityCellField>
        );
        expect(screen.getByLabelText(CLEAR).className).toContain("opacity-100");
        expect(screen.getByLabelText(CLEAR).className).not.toContain("opacity-0");
    });

    test("disabled: the line is shown and no tool is offered", () => {
        render(
            <CompactEntityCellField empty={false} disabled onClear={() => undefined}>
                <span>Barbara Miller</span>
            </CompactEntityCellField>
        );
        expect(screen.getByText("Barbara Miller")).toBeTruthy();
        expect(screen.queryByLabelText(EDIT)).toBeNull();
        expect(screen.queryByLabelText(CLEAR)).toBeNull();
    });
});
