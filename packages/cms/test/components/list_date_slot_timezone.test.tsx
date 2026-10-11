/**
 * @jest-environment ./test/helpers/los-angeles-tz-environment.cjs
 */
import { describe, expect, it } from "@jest/globals";
import type { DateProperty, Entity } from "@rebasepro/types";
import type { AdminCollection } from "@rebasepro/cms-types";

import { resolveEntitySlots, type CollectionSlotKeys } from "../../src/components/CollectionViewBinding/usePreviewSlots";
import { formatCollectionDate } from "../../src/util/format_collection_date";

/**
 * The list, card and board date slot, and the list view's date column, show a
 * date the way the table cell and the form do.
 *
 * They formatted with `toLocaleDateString(undefined, …)` in the browser's
 * zone, so west of Greenwich a `columnType: "date"` 15th (stored as the 15th's
 * UTC midnight) read "Mar 14", and a declared `timezone` was ignored. The file
 * pins America/Los_Angeles (see the docblock) so a regression fails in CI,
 * which runs in UTC.
 */

const dateOnly = { type: "date", name: "Due", columnType: "date", mode: "date" } satisfies DateProperty;
const inTokyo = { type: "date", name: "Starts", mode: "date_time", timezone: "Asia/Tokyo" } satisfies DateProperty;
const timeOnly = { type: "date", name: "Opens", columnType: "time" } satisfies DateProperty;

const now = new Date("2026-10-11T12:00:00Z");

function slotKeys(dateKey: string): CollectionSlotKeys {
    return {
        titleKey: undefined,
        titleKeyCandidates: [],
        imageKey: undefined,
        subtitleKey: undefined,
        relationKeys: [],
        statusKey: undefined,
        dateKey,
        tagsKey: undefined
    } as CollectionSlotKeys;
}

function collectionWith(key: string, property: DateProperty): AdminCollection<Record<string, unknown>> {
    return { slug: "orders", name: "Orders", properties: { [key]: property } } as AdminCollection<Record<string, unknown>>;
}

describe("collection date slot and list date column", () => {
    it("runs west of Greenwich", () => {
        expect(new Date("2024-03-15T00:00:00Z").getDate()).toBe(14);
    });

    it("shows a date-only 15th as the 15th in the date slot", () => {
        const entity = { id: 1, path: "orders", values: { due: new Date("2024-03-15T00:00:00Z") } } as Entity<Record<string, unknown>>;
        const slots = resolveEntitySlots(entity, collectionWith("due", dateOnly), slotKeys("due"));
        expect(slots.date?.formatted).toMatch(/Mar 15, 2024/);
    });

    it("shows a date-only value as a day, never as a time or a relative phrase", () => {
        // Today's date-only value used to read as a clock time east of UTC, or "12h ago" here.
        expect(formatCollectionDate(new Date("2026-10-11T00:00:00Z"), dateOnly, { now })).toBe("Oct 11");
        expect(formatCollectionDate(new Date("2026-10-10T00:00:00Z"), dateOnly, { now })).toBe("Oct 10");
    });

    it("shows a date in its declared timezone", () => {
        // 20:00 UTC on the 15th is the 16th in Tokyo.
        const entity = { id: 1, path: "orders", values: { starts: "2024-03-15T20:00:00Z" } } as Entity<Record<string, unknown>>;
        const slots = resolveEntitySlots(entity, collectionWith("starts", inTokyo), slotKeys("starts"));
        expect(slots.date?.formatted).toMatch(/Mar 16, 2024/);
    });

    it("shows a time-only value as that time in UTC", () => {
        expect(formatCollectionDate(new Date("1970-01-01T09:30:00Z"), timeOnly, { now })).toMatch(/09:30/);
    });

    it("keeps the relative phrase for a recent instant", () => {
        expect(formatCollectionDate(new Date("2026-10-11T09:00:00Z"), inTokyo, { now })).toBe("3h ago");
        expect(formatCollectionDate(new Date("2026-10-11T09:00:00Z"), undefined, { now })).toBe("3h ago");
    });

    it("says the relative phrase in the labels' language", () => {
        const relativeTimeLabels = { hoursAgo: (n: number) => `${n} h fa` };
        expect(formatCollectionDate(new Date("2026-10-11T09:00:00Z"), inTokyo, { now, relativeTimeLabels })).toBe("3 h fa");
    });

    it("has nothing to say about an empty or unreadable value", () => {
        expect(formatCollectionDate(null, dateOnly, { now })).toBeNull();
        expect(formatCollectionDate("not a date", dateOnly, { now })).toBeNull();
    });
});
