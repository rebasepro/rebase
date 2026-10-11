import React from "react";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import { DateTimeField, MultiSelect, MultiSelectItem } from "../src";

/**
 * `DateTimeField` declared a `locale` that nothing read; five callers passed
 * the app's locale believing the field was localised. It is now the input's
 * `lang`, the one locale hint a native date input takes.
 */
describe("DateTimeField locale", () => {
    it("is the input's lang", () => {
        const { container } = render(<DateTimeField mode="date" value={null} onChange={() => { /* noop */ }} locale="de-DE" aria-label="Due"/>);
        expect(container.querySelector("input")).toHaveAttribute("lang", "de-DE");
    });
});

/**
 * `TextField` and `Select` mark an errored field `aria-invalid`; the date
 * field and the multi-select only turned their label red, so a screen reader
 * heard nothing wrong with them.
 */
describe("error state is announced", () => {
    it("DateTimeField", () => {
        const { container } = render(<DateTimeField mode="date" value={null} onChange={() => { /* noop */ }} error aria-label="Due"/>);
        expect(container.querySelector("input")).toHaveAttribute("aria-invalid", "true");
    });

    it("MultiSelect", () => {
        const { getByRole } = render(<MultiSelect error value={[]} onValueChange={() => { /* noop */ }} aria-label="tags">
            <MultiSelectItem value="a">A</MultiSelectItem>
        </MultiSelect>);
        expect(getByRole("button", { name: "tags" })).toHaveAttribute("aria-invalid", "true");
    });
});
