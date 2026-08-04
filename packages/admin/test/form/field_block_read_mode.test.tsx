/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, test } from "@jest/globals";
import { render, screen } from "@testing-library/react";

import { FieldBlock } from "../../src/form/components/FieldBlock";

/**
 * The read-only record shares the form's grid *and* its labels, so a field sits
 * in the same place, at the same width, under the same label whether or not you
 * are editing it. A record that restyles itself under Edit reads as two screens.
 *
 * The one thing read mode drops is the per-field description, which is not part
 * of the label: it is input help. "Sum of all line items before tax and
 * shipping" under a number that is visibly a sum tells a reader nothing, and a
 * line of it under every field is what a record has instead of room.
 */
const property = {
    type: "number",
    name: "Subtotal",
    description: "Sum of all line items before tax and shipping",
    validation: { required: true }
} as never;

function renderBlock(mode: "edit" | "read") {
    return render(
        <FieldBlock propertyKey={"subtotal"} property={property} showLabel mode={mode}>
            <span>185.11</span>
        </FieldBlock>
    );
}

/** The label row is the parent of the name — the block's first child is the
 *  copy-the-property-id tooltip wrapper, which carries no classes. */
function labelRow(mode: "edit" | "read") {
    const { unmount } = renderBlock(mode);
    const className = screen.getByText("Subtotal").parentElement?.className ?? "";
    unmount();
    return className;
}

describe("FieldBlock", () => {

    test("the label is identical in both modes: icon, name and required marker", () => {
        for (const mode of ["edit", "read"] as const) {
            const { container, unmount } = renderBlock(mode);
            expect(screen.getByText("Subtotal")).toBeTruthy();
            expect(screen.getByText("*")).toBeTruthy();
            expect(container.querySelector("svg")).toBeTruthy();
            unmount();
        }
    });

    test("the label is styled identically in both modes", () => {
        expect(labelRow("read")).toEqual(labelRow("edit"));
    });

    test("the label sits one size below the body, with its icon matched to it", () => {
        // Labels are scaffolding: you read them to find the value, then read the
        // value. At body size a column of records scanned as a column of field
        // names with data attached.
        expect(labelRow("edit")).toContain("text-[13px]");

        const { container } = renderBlock("edit");
        expect(container.querySelector("svg")?.getAttribute("width")).toBe("14");
    });

    test("only the form carries the description", () => {
        const edit = renderBlock("edit");
        expect(screen.getByText("Sum of all line items before tax and shipping")).toBeTruthy();
        edit.unmount();

        renderBlock("read");
        expect(screen.queryByText("Sum of all line items before tax and shipping")).toBeNull();
        expect(screen.getByText("185.11")).toBeTruthy();
    });

    test("defaults to the form, so nothing changes for a caller that says nothing", () => {
        const { container } = render(
            <FieldBlock propertyKey={"subtotal"} property={property} showLabel>
                <span>185.11</span>
            </FieldBlock>
        );
        expect(screen.getByText("Sum of all line items before tax and shipping")).toBeTruthy();
        expect(container.querySelector("svg")).toBeTruthy();
    });

    test("an unlabelled block renders neither label nor description in either mode", () => {
        for (const mode of ["edit", "read"] as const) {
            const { unmount } = render(
                <FieldBlock propertyKey={"subtotal"}
                    property={property}
                    showLabel={false}
                    mode={mode}>
                    <span>185.11</span>
                </FieldBlock>
            );
            expect(screen.queryByText("Subtotal")).toBeNull();
            expect(screen.queryByText("Sum of all line items before tax and shipping")).toBeNull();
            unmount();
        }
    });
});
