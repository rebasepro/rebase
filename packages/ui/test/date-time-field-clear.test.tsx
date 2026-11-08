import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { DateTimeField } from "../src";

/**
 * "Clear date" empties the input as well as the value.
 *
 * The click bubbled to the field's frame, which focuses the input, and focusing
 * filled the typing buffer from the value of that render — the date just
 * cleared. The form saved null while the input went on drawing the old date.
 */
describe("DateTimeField clear", () => {

    function Controlled({ onChange }: { onChange: (date: Date | null) => void }) {
        const [value, setValue] = useState<Date | null>(new Date("2026-02-01T12:00:00Z"));
        return <DateTimeField
            label="Shipped"
            mode="date_time"
            timezone="UTC"
            clearable
            value={value}
            onChange={(date) => {
                setValue(date);
                onChange(date);
            }}/>;
    }

    it("leaves the input empty", () => {
        const onChange = jest.fn();
        render(<Controlled onChange={onChange}/>);
        const input = screen.getByLabelText("Shipped") as HTMLInputElement;
        expect(input.value).toBe("2026-02-01T12:00");

        fireEvent.click(screen.getByRole("button", { name: "Clear date" }));

        expect(onChange).toHaveBeenCalledWith(null);
        expect(input.value).toBe("");
        expect(screen.queryByRole("button", { name: "Clear date" })).toBeNull();
    });
});
