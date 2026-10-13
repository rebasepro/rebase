import React from "react";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Table, TableBody, TableCell, TableRow } from "../src";

/**
 * A list row has no fill of its own (packages/ui/DESIGN.md): only the hovered,
 * selected or open row takes an alpha highlight. The kit's `TableRow` painted
 * every row with the card fill, so a list of rows on the sheet — Studio's
 * storage list — read as a stack of cards. `variant="list"` is that list; the
 * default stays the card table it always was.
 */
describe("Table list variant", () => {

    function rowOf(body: React.ReactElement) {
        const { container } = render(<Table>{body}</Table>);
        return { body: container.querySelector("tbody")!, row: container.querySelector("tbody tr")! };
    }

    it("keeps the card fill by default", () => {
        const { body, row } = rowOf(<TableBody><TableRow onClick={() => undefined}><TableCell>a</TableCell></TableRow></TableBody>);
        expect(body).toHaveClass("bg-surface-card");
        expect(row).toHaveClass("bg-surface-card");
        expect(row).toHaveClass("hover:bg-surface-card-hover");
    });

    it("a list body and its rows have no fill, and a clickable row takes the alpha hover", () => {
        const { body, row } = rowOf(<TableBody variant="list"><TableRow onClick={() => undefined}><TableCell>a</TableCell></TableRow></TableBody>);
        expect(body).not.toHaveClass("bg-surface-card");
        expect(row).not.toHaveClass("bg-surface-card");
        expect(row).not.toHaveClass("hover:bg-surface-card-hover");
        expect(row).toHaveClass("hover:bg-surface-hover");
    });

    it("a row can say it is a list row inside a default body", () => {
        const { row } = rowOf(<TableBody><TableRow variant="list"><TableCell>a</TableCell></TableRow></TableBody>);
        expect(row).not.toHaveClass("bg-surface-card");
    });

    it("keeps the hairline between list rows", () => {
        const { body } = rowOf(<TableBody variant="list"><TableRow><TableCell>a</TableCell></TableRow></TableBody>);
        expect(body).toHaveClass("divide-y");
    });
});
