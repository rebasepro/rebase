import { describe, expect, it } from "@jest/globals";
import type { DateProperty } from "@rebasepro/types";

import { getDateColumnWidth } from "../../src/components/CollectionTableBinding/internal/common";
import { formatDatePreview } from "../../src/preview/components/DatePreview";

/**
 * A date column is as wide as its widest date, on one line, at every size.
 *
 * It was a flat 200px, and the default format ("November 06, 2026, 23:32:05",
 * 27 mono characters) needs 227px before the cell's padding: every date in a
 * read-only column wrapped after its year, and the row — one line tall at
 * xs, s and m — cut both lines in half.
 */

/** 14px JetBrains Mono advances 8.4px a character; the zone is 12px. */
const CHAR = 8.4;
/** Border and padding of the roomiest cell (xl): 2 × (4 + 16). */
const CHROME = 40;

const date = (extra: Partial<DateProperty> = {}): DateProperty => ({
    name: "Started",
    type: "date",
    ...extra
});

describe("date column width", () => {
    it("fits the default format's longest month on one line at xl", () => {
        const widest = "September 28, 2026, 23:58:58";
        expect(formatDatePreview(new Date(2026, 8, 28, 23, 58, 58), {}).text).toBe(widest);
        expect(getDateColumnWidth(date())).toBeGreaterThanOrEqual(widest.length * CHAR + CHROME);
    });

    it("fits a configured format, not the default", () => {
        const width = getDateColumnWidth(date(), { dateTimeFormat: "EEEE, MMMM do yyyy 'at' HH:mm" });
        expect(width).toBeGreaterThanOrEqual("Wednesday, September 23rd 2026 at 23:58".length * CHAR + CHROME);
    });

    it("shrinks for a short format, down to the header's minimum", () => {
        expect(getDateColumnWidth(date({ mode: "date" }))).toBeLessThan(200);
        expect(getDateColumnWidth(date({ columnType: "time" }))).toBe(140);
    });

    it("makes room for the zone after a zoned date", () => {
        const property = date({ timezone: "America/New_York" });
        const { text, zone } = formatDatePreview(new Date(2026, 8, 28, 23, 58), { timezone: "America/New_York" });
        expect(zone).toBeTruthy();
        expect(getDateColumnWidth(property))
            .toBeGreaterThanOrEqual(text.length * CHAR + 4 + `(${zone})`.length * 7.2 + CHROME);
    });

    it("keeps an editable cell at the input's width", () => {
        expect(getDateColumnWidth(date(), { editable: true })).toBe(200);
    });
});
