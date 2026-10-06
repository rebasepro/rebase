/**
 * @jest-environment jsdom
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";

/**
 * A date column with a `timezone` builds its formatters once, not per cell.
 *
 * `DatePreview` constructed two `Intl.DateTimeFormat`s on every render of every
 * cell — one for the date, one for the zone's abbreviation. Construction is the
 * expensive part (~90 µs each against ~6 µs to format with one built already),
 * and a screen of a table with two such columns re-ran it 60 times per render.
 */

const customization: { locale?: string; dateTimeFormat?: string } = {};

jest.mock("@rebasepro/app", () => ({
    useCustomizationController: () => customization
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatePreview } = require("../../src/preview/components/DatePreview") as typeof import("../../src/preview/components/DatePreview");

const NativeDateTimeFormat = Intl.DateTimeFormat;
let constructed = 0;

describe("DatePreview with a timezone", () => {

    beforeEach(() => {
        delete customization.locale;
        constructed = 0;
        const Counting = function (this: unknown, ...args: ConstructorParameters<typeof Intl.DateTimeFormat>) {
            constructed++;
            return new NativeDateTimeFormat(...args);
        } as unknown as typeof Intl.DateTimeFormat;
        Counting.supportedLocalesOf = NativeDateTimeFormat.supportedLocalesOf;
        Intl.DateTimeFormat = Counting;
    });

    afterEach(() => {
        Intl.DateTimeFormat = NativeDateTimeFormat;
    });

    it("builds its formatters once for a screen of cells, not twice per cell", () => {
        const dates = Array.from({ length: 60 }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i, 12, 30)));
        const { rerender } = render(<>
            {dates.map((date, i) => <DatePreview key={i} date={date} timezone={"America/New_York"}/>)}
        </>);
        rerender(<>
            {dates.map((date, i) => <DatePreview key={i} date={date} timezone={"America/New_York"}/>)}
        </>);

        // One for the date, one for the zone's abbreviation (another test file
        // in the same process may already have built them: at most two).
        expect(constructed).toBeLessThanOrEqual(2);
    });

    it("still formats in the zone, with its abbreviation", () => {
        render(<DatePreview date={new Date(Date.UTC(2026, 6, 4, 16, 0))} timezone={"America/New_York"}/>);
        expect(screen.getByText(/Jul 4, 2026/)).toBeTruthy();
        expect(screen.getByText("(EDT)")).toBeTruthy();
    });

    it("keeps a date-only column free of a zone abbreviation", () => {
        render(<DatePreview date={new Date(Date.UTC(2026, 6, 4, 16, 0))} timezone={"Europe/Madrid"} mode={"date"}/>);
        expect(screen.getByText(/Jul 4, 2026/)).toBeTruthy();
        expect(screen.queryByText(/CEST/)).toBeNull();
    });

    it("formats each zone in its own zone", () => {
        const date = new Date(Date.UTC(2026, 6, 4, 23, 30));
        render(<>
            <DatePreview date={date} timezone={"America/Los_Angeles"} mode={"date"}/>
            <DatePreview date={date} timezone={"Asia/Tokyo"} mode={"date"}/>
        </>);
        expect(screen.getByText(/Jul 4, 2026/)).toBeTruthy();
        expect(screen.getByText(/Jul 5, 2026/)).toBeTruthy();
    });
});
