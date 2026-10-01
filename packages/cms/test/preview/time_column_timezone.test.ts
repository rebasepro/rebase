/**
 * A `columnType: "time"` value is a time of day on 1970-01-01 UTC (see
 * `server-postgres/test/e2e/time-column-e2e.test.ts`), so the form and the
 * table show it in UTC — in the browser's zone a stored 09:30 read as 10:30.
 */
import type { DateProperty } from "@rebasepro/types";
import { getDatePropertyTimezone } from "../../src/preview/util";

describe("the zone a date property is shown in", () => {
    it("is UTC for a time-of-day column, whatever the property declares", () => {
        expect(getDatePropertyTimezone({ type: "date", columnType: "time" } as DateProperty)).toBe("UTC");
        expect(getDatePropertyTimezone({ type: "date", columnType: "time", timezone: "Europe/Rome" } as DateProperty)).toBe("UTC");
    });
    it("is still the declared zone for a timestamp", () => {
        expect(getDatePropertyTimezone({ type: "date", timezone: "Europe/Rome" } as DateProperty)).toBe("Europe/Rome");
    });
});
