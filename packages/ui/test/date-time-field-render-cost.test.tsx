/**
 * What a `DateTimeField` costs per render and per instance.
 *
 * It built a fresh `Intl.DateTimeFormat` on every render to format its value
 * (~33 µs, against ~3 µs for a formatter reused), and three more per
 * keystroke while typing in a field with a `timezone`. And each instance
 * rendered its own copy of the stylesheet that hides the native calendar
 * icon — in addition to the copy `useInjectStyles` already puts in the head
 * once — so a form or a table with ten date fields carried eleven identical
 * `<style>` elements.
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import { DateTimeField } from "../src/components/DateTimeField";

const RealDateTimeFormat = Intl.DateTimeFormat;
let constructed = 0;

beforeAll(() => {
    const Counting = function (this: unknown, ...args: ConstructorParameters<typeof Intl.DateTimeFormat>) {
        constructed++;
        return new RealDateTimeFormat(...args);
    } as unknown as typeof Intl.DateTimeFormat;
    Object.assign(Counting, { supportedLocalesOf: RealDateTimeFormat.supportedLocalesOf });
    Counting.prototype = RealDateTimeFormat.prototype;
    Intl.DateTimeFormat = Counting;
});

afterAll(() => {
    Intl.DateTimeFormat = RealDateTimeFormat;
});

beforeEach(() => {
    constructed = 0;
});

const value = new Date("2026-03-08T06:30:00Z");

function Field({ tick, timezone }: { tick: number, timezone?: string }) {
    void tick;
    return <DateTimeField label={"Published"}
        value={new Date(value.getTime())}
        onChange={() => undefined}
        mode={"date_time"}
        timezone={timezone}/>;
}

describe("DateTimeField", () => {
    it("does not build a date formatter when it re-renders with the same value", () => {
        const { rerender } = render(<Field tick={0}/>);
        constructed = 0;
        for (let tick = 1; tick <= 5; tick++) rerender(<Field tick={tick}/>);
        expect(constructed).toBe(0);
    });

    it("still shows the value in the field's timezone", () => {
        render(<Field tick={0} timezone={"America/New_York"}/>);
        expect((screen.getByLabelText("Published") as HTMLInputElement).value).toBe("2026-03-08T01:30");
    });

    it("reuses its formatters while the user types in a timezone", () => {
        const onChange = jest.fn();
        render(<DateTimeField label={"Published"} value={value} onChange={onChange} mode={"date_time"} timezone={"America/New_York"}/>);
        const input = screen.getByLabelText("Published");
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: "2026-03-08T03:30" } });
        constructed = 0;

        fireEvent.change(input, { target: { value: "2026-03-08T04:30" } });
        fireEvent.change(input, { target: { value: "2026-03-08T05:30" } });

        expect(constructed).toBe(0);
        // 05:30 EDT (after the 02:00 spring switch) is 09:30 UTC.
        expect(onChange).toHaveBeenLastCalledWith(new Date("2026-03-08T09:30:00Z"));
    });

    it("adds its stylesheet to the document once, however many fields are mounted", () => {
        render(<>{Array.from({ length: 10 }, (_, i) => <Field key={i} tick={0}/>)}</>);
        const copies = Array.from(document.querySelectorAll("style"))
            .filter(style => (style.textContent ?? "").includes("calendar-picker-indicator"));
        expect(copies).toHaveLength(1);
    });
});
