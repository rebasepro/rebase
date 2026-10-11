import React from "react";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import { DateTimeField } from "../src";

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
