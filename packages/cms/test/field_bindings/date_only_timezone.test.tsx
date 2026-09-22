/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";

/**
 * A `columnType: "date"` column holds a calendar day, with no zone. It travels
 * as that day's UTC midnight — Postgres returns `2026-03-15`, the data layer
 * reads it as `2026-03-15T00:00:00Z` — and on the way in Postgres keeps the
 * date part of whatever it is given.
 *
 * The picker and the preview both worked in the browser's own zone. West of
 * Greenwich, a stored 15th read as the 14th's evening and showed as the 14th.
 * East of it, picking the 15th produced the 14th's evening in UTC, and the 14th
 * is what was stored.
 *
 * These run in whatever zone the machine is in, so each case pairs a value
 * that goes wrong to the west with one that goes wrong to the east: outside
 * UTC, a field working in the local zone fails one of them.
 */

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useCustomizationController: () => ({ plugins: [], propertyConfigs: {}, locale: undefined }),
        useAuthController: () => ({ user: { uid: "u1" } })
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

import { DateTimeFieldBinding } from "../../src/form/field_bindings/DateTimeFieldBinding";
import { PropertyPreview } from "../../src/preview/PropertyPreview";

const dateOnly = { type: "date", name: "Due", columnType: "date", mode: "date" };

/** The 15th's first minute and last half hour, in UTC. */
const startOfThe15th = new Date("2026-03-15T00:00:00.000Z");
const endOfThe15th = new Date("2026-03-15T23:30:00.000Z");

function renderField(property: object, value: Date | null, setValue: (value: Date | null) => void = () => undefined) {
    return render(<DateTimeFieldBinding {...{
        propertyKey: "due",
        property,
        value,
        setValue,
        setFieldValue: () => undefined,
        error: undefined,
        showError: false,
        disabled: false,
        isSubmitting: false,
        autoFocus: false,
        touched: false,
        includeDescription: false,
        partOfArray: false,
        minimalistView: false,
        hideLabel: true,
        context: {}
    } as never}/>);
}

function input(): HTMLInputElement {
    return screen.getByLabelText("Due") as HTMLInputElement;
}

describe("a date-only property", () => {

    it("shows the stored day", () => {
        const view = renderField(dateOnly, startOfThe15th);
        expect(input().value).toEqual("2026-03-15");
        view.unmount();

        renderField(dateOnly, endOfThe15th);
        expect(input().value).toEqual("2026-03-15");
    });

    it("writes the picked day as that day's UTC midnight", () => {
        const written: (Date | null)[] = [];
        renderField(dateOnly, null, (value) => written.push(value));
        fireEvent.change(input(), { target: { value: "2026-03-15" } });
        expect(written).toHaveLength(1);
        expect(written[0]?.toISOString()).toEqual("2026-03-15T00:00:00.000Z");
    });

    it("previews the stored day, with no zone beside it", () => {
        const view = render(<PropertyPreview propertyKey={"due"}
            property={dateOnly as never}
            value={startOfThe15th}
            size={"medium"}/>);
        expect(screen.getByText(/Mar 15, 2026/)).toBeTruthy();
        expect(screen.queryByText(/UTC/)).toBeNull();
        view.unmount();

        render(<PropertyPreview propertyKey={"due"}
            property={dateOnly as never}
            value={endOfThe15th}
            size={"medium"}/>);
        expect(screen.getByText(/Mar 15, 2026/)).toBeTruthy();
    });

});

describe("a property with a timezone", () => {

    it("is shown and entered in that zone, as documented", () => {
        const written: (Date | null)[] = [];
        renderField({ type: "date", name: "Due", mode: "date_time", timezone: "Asia/Tokyo" },
            startOfThe15th, (value) => written.push(value));
        expect(input().value).toEqual("2026-03-15T09:00");

        fireEvent.change(input(), { target: { value: "2026-03-15T10:00" } });
        expect(written[0]?.toISOString()).toEqual("2026-03-15T01:00:00.000Z");
    });

    it("is previewed in that zone", () => {
        render(<PropertyPreview propertyKey={"due"}
            property={{ type: "date", name: "Due", mode: "date_time", timezone: "Asia/Tokyo" } as never}
            value={endOfThe15th}
            size={"medium"}/>);
        // 23:30 UTC on the 15th is 08:30 on the 16th in Tokyo.
        expect(screen.getByText(/Mar 16, 2026/)).toBeTruthy();
    });

});
