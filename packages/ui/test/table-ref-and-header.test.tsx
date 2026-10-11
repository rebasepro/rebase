import React, { createRef } from "react";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import { HeartIcon, Table, TableBody, TableCell, TableHeader, TableRow } from "../src";

/**
 * `TableRow` hands its `<tr>` to a ref (an IntersectionObserver needs the row
 * element, which is why Studio's storage list stayed a raw table), and a cell
 * inside `TableHeader` is a column header (`th`) without having to say so.
 */
describe("Table", () => {

    it("TableRow forwards its ref to the <tr>", () => {
        const ref = createRef<HTMLTableRowElement>();
        render(<Table><TableBody><TableRow ref={ref}><TableCell>a</TableCell></TableRow></TableBody></Table>);
        expect(ref.current).toBeInstanceOf(HTMLTableRowElement);
    });

    it("TableRow accepts a callback ref", () => {
        const seen: Array<HTMLTableRowElement | null> = [];
        render(<Table><TableBody><TableRow ref={(el) => { seen.push(el); }}><TableCell>a</TableCell></TableRow></TableBody></Table>);
        expect(seen[0]).toBeInstanceOf(HTMLTableRowElement);
    });

    it("a cell inside TableHeader is a th, a body cell a td, and neither gets an empty scope", () => {
        const { container } = render(
            <Table>
                <TableHeader><TableCell>Name</TableCell><TableCell>Size</TableCell></TableHeader>
                <TableBody><TableRow><TableCell>a</TableCell><TableCell>1</TableCell></TableRow></TableBody>
            </Table>
        );
        expect(container.querySelectorAll("thead th")).toHaveLength(2);
        expect(container.querySelectorAll("thead td")).toHaveLength(0);
        expect(container.querySelectorAll("tbody td")).toHaveLength(2);
        expect(container.querySelectorAll("tbody th")).toHaveLength(0);
        container.querySelectorAll("th, td").forEach((cell) => expect(cell.getAttribute("scope")).not.toBe(""));
        expect(container.querySelector("thead th")).toHaveAttribute("scope", "col");
    });

    it("exports a heart icon", () => {
        const { container } = render(<HeartIcon size={16}/>);
        expect(container.querySelector("svg")).not.toBeNull();
    });
});
