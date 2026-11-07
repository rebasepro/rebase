
import type { ArrayProperty, DateProperty, Property } from "@rebasepro/types";
import type { AdminCollection } from "@rebasepro/cms-types";
import { DatePreviewFormatOptions, formatDatePreview } from "../../../preview/components/DatePreview";
import { getDatePropertyMode, getDatePropertyTimezone } from "../../../preview/util";

/**
 * What a date cell is formatted with, beyond the property itself: the admin's
 * locale and format. Without it a column is sized for the defaults.
 */
export type DateColumnFormatting = Pick<DatePreviewFormatOptions, "locale" | "dateTimeFormat" | "dateFnsLocale"> & {
    /**
     * Whether the cell is the date input (inline editing on, property not
     * read-only) rather than the formatted preview. The input draws the
     * browser's short numeric form, whatever the admin's format says.
     */
    editable?: boolean;
};

export function getTableCellAlignment(property: Property): "right" | "left" | "center" {
    if (property.type === "boolean") {
        return "center";
    } else if (property.type === "number") {
        if (property.enum)
            return "left";
        return "right";
    } else if (property.type === "date") {
        return "right";
    } else {
        return "left";
    }
}

export function getTablePropertyColumnWidth(property: Property, dateFormatting?: DateColumnFormatting): number {

    if (property.admin?.columnWidth) {
        return property.admin?.columnWidth;
    }

    if (property.type === "string") {
        if (property.admin?.urlPreview) {
            return 280;
        } else if (property.storage) {
            return 160;
        } else if (property.enum) {
            return 200;
        } else if (property.admin?.multiline) {
            return 300;
        } else if (property.admin?.markdown) {
            return 300;
        } else if (property.email) {
            return 200;
        } else {
            return 200;
        }
    } else if (property.type === "array") {
        const arrayProperty = property as ArrayProperty;
        if (arrayProperty.of) {
            if (Array.isArray(property.of)) {
                return 300;
            } else {
                return getTablePropertyColumnWidth(arrayProperty.of as Property, dateFormatting);
            }
        } else {
            return 300;
        }
    } else if (property.type === "number") {
        if (property.enum) {
            return 200;
        }
        return 140;
    } else if (property.type === "map") {
        return 360;
    } else if (property.type === "date") {
        return getDateColumnWidth(property, dateFormatting);
    } else if (property.type === "reference") {
        return 220;
    } else if (property.type === "relation") {
        return 280;
    } else if (property.type === "boolean") {
        return 140;
    } else {
        return 200;
    }
}

/**
 * What a table cell spends around its content at the roomiest size: the 4px
 * border plus `p-4` (l and xl), on both sides. Sized for the roomiest so a
 * column fits at every size without changing width when the size does.
 */
const CELL_CHROME_WIDTH = 2 * (4 + 16);
/** An editable cell's native input: `dd/mm/yyyy, --:--` and the picker. */
const EDITABLE_DATE_COLUMN_WIDTH = 200;
/** Never narrower than this: the header's title, sort and filter need room too. */
const MIN_DATE_COLUMN_WIDTH = 140;
/** A row's text (`text-sm`) and the zone after a zoned date (`text-xs`). */
const CELL_FONT_SIZE = 14;
const ZONE_FONT_SIZE = 12;
/** `gap-1` between a zoned date and its zone. */
const ZONE_GAP = 4;
/** Every mono face in `--font-mono` advances 0.6em per character. */
const MONO_ADVANCE = 0.6;

let measureContext: CanvasRenderingContext2D | null | undefined;

/**
 * The width of `text` in the mono tier, as the browser will draw it.
 *
 * Measured, not counted, where a canvas exists: a locale's month names may be
 * in a script the mono face does not cover, and the fallback face it lands in
 * is not 0.6em wide. Counted elsewhere (tests, SSR).
 */
function measureMonoText(text: string, fontSize: number): number {
    if (measureContext === undefined) {
        measureContext = typeof document !== "undefined"
            ? document.createElement("canvas").getContext("2d")
            : null;
    }
    if (!measureContext) return text.length * fontSize * MONO_ADVANCE;
    const family = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() || "monospace";
    measureContext.font = `${fontSize}px ${family}`;
    return measureContext.measureText(text).width;
}

/**
 * Dates covering every month and weekday, at a two-digit day and the
 * two-digit hours of both clocks (23:58, 11:58 PM): the widest a format can
 * get is the widest of these, whatever its locale names the months and days.
 */
const WIDEST_DATE_SAMPLES: Date[] = Array.from({ length: 12 * 7 }, (_, i) =>
    new Date(2026, Math.floor(i / 7), 22 + i % 7, 23, 58, 58));

const dateColumnWidths = new Map<string, number>();

/**
 * A date column wide enough for its widest value on one line.
 *
 * It used to be a flat 200px, and the default format — "November 06, 2026,
 * 23:32:05", 27 mono characters at 8.4px — needs 227px before the cell's own
 * padding. Every date wrapped after its year, and at the text sizes (xs–m) the
 * row has room for one line, so what showed was the bottom of one line and
 * the top of the next. The width now comes from formatting real dates exactly
 * as the cell will (`formatDatePreview`), in the admin's locale and format.
 */
export function getDateColumnWidth(property: DateProperty, formatting?: DateColumnFormatting): number {
    if (formatting?.editable) return EDITABLE_DATE_COLUMN_WIDTH;
    const options: DatePreviewFormatOptions = {
        locale: formatting?.locale,
        dateTimeFormat: formatting?.dateTimeFormat,
        dateFnsLocale: formatting?.dateFnsLocale,
        mode: getDatePropertyMode(property),
        timezone: getDatePropertyTimezone(property)
    };
    const key = [options.mode, options.timezone, options.locale, options.dateTimeFormat, options.dateFnsLocale?.code].join("|");
    const cached = dateColumnWidths.get(key);
    if (cached !== undefined) return cached;

    let widest = 0;
    try {
        for (const date of WIDEST_DATE_SAMPLES) {
            const { text, zone } = formatDatePreview(date, options);
            const width = measureMonoText(text, CELL_FONT_SIZE)
                + (zone ? ZONE_GAP + measureMonoText(`(${zone})`, ZONE_FONT_SIZE) : 0);
            widest = Math.max(widest, width);
        }
    } catch (error) {
        // An unknown timezone or a malformed format throws here exactly as it
        // does in the cell, which reports it; the column keeps its old width.
        console.warn("Could not measure a date column", error);
        return 200;
    }

    // Rounded up to the 4px grid, with a pixel of slack for subpixel glyphs.
    const width = Math.max(MIN_DATE_COLUMN_WIDTH, Math.ceil((widest + 1 + CELL_CHROME_WIDTH) / 4) * 4);
    dateColumnWidths.set(key, width);
    return width;
}

export function getSubcollectionColumnId(collection: AdminCollection) {
    return `subcollection:${collection.slug}`;
}
