import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { DateTimeField, UiLabelsProvider } from "../src";

/**
 * A time of day — a `columnType: "time"` column — travels as that time on
 * 1970-01-01 UTC. The field had a day and a day-and-time mode only, so such a
 * column was picked as a date and a time, the date part a meaningless
 * 01/01/1970. `mode="time"` picks the time alone and keeps the day 1970-01-01.
 */
describe("DateTimeField time mode", () => {

    const nineThirty = new Date("1970-01-01T09:30:00.000Z");

    function field(onChange: (date: Date | null) => void = () => undefined, value: Date | null = nineThirty) {
        render(<DateTimeField aria-label="Opens at" mode="time" timezone="UTC" value={value} onChange={onChange}/>);
        return screen.getByLabelText("Opens at") as HTMLInputElement;
    }

    it("is a time input showing the time of day", () => {
        const input = field();
        expect(input.type).toBe("time");
        expect(input.value).toBe("09:30");
    });

    it("writes a typed time on 1970-01-01, in the field's zone", () => {
        const onChange = jest.fn();
        const input = field(onChange, null);
        fireEvent.change(input, { target: { value: "14:05" } });
        expect(onChange).toHaveBeenLastCalledWith(new Date("1970-01-01T14:05:00.000Z"));
    });

    it("clears to null", () => {
        const onChange = jest.fn();
        const input = field(onChange);
        fireEvent.change(input, { target: { value: "" } });
        expect(onChange).toHaveBeenLastCalledWith(null);
    });

    it("names its picker button for a time, in the admin language", () => {
        field();
        expect(screen.getByRole("button", { name: "Open time picker" })).toBeInTheDocument();
        render(<UiLabelsProvider labels={{ openTimePicker: "Apri selettore orario" }}>
            <DateTimeField aria-label="Chiude" mode="time" timezone="UTC" value={nineThirty} onChange={() => undefined}/>
        </UiLabelsProvider>);
        expect(screen.getByRole("button", { name: "Apri selettore orario" })).toBeInTheDocument();
    });

    it("leaves the date modes as they were", () => {
        render(<DateTimeField aria-label="Due" mode="date" timezone="UTC" value={new Date("2026-03-15T00:00:00Z")} onChange={() => undefined}/>);
        const input = screen.getByLabelText("Due") as HTMLInputElement;
        expect(input.type).toBe("date");
        expect(input.value).toBe("2026-03-15");
    });
});
