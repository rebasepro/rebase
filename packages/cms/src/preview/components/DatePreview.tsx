import React from "react";

import { format } from "date-fns";
import { useCustomizationController } from "@rebasepro/app";
import { defaultDateFormat } from "@rebasepro/utils";
import { getLoadedDateFnsLocale, loadDateFnsLocale } from "./date_fns_locales";

export interface DatePreviewProps {
    date: Date;
    /**
     * Display mode: "date" for date-only, "date_time" for date and time,
     * "time" for a time of day (a `time` column) with no day at all
     */
    mode?: "date" | "date_time" | "time";
    /**
     * IANA timezone identifier (e.g., "America/New_York")
     * When specified, the date will be displayed in this timezone
     */
    timezone?: string;
}

/**
 * `Intl.DateTimeFormat`s already built, for dates shown in a fixed timezone.
 *
 * Building one is the expensive part of formatting (~90 µs, against ~6 µs to
 * format with it), and a table column of zoned dates used to build two per
 * cell per render. Key: locale, timezone and what is shown — everything the
 * options are made of, so a cached formatter formats exactly as a fresh one
 * would. Nothing invalidates an entry: a formatter is a pure function of its
 * key and holds no record data. Bounded anyway, since a timezone can come from
 * data: past the cap the map starts over.
 */
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();
const MAX_FORMATTERS = 200;

function cachedFormatter(key: string, build: () => Intl.DateTimeFormat): Intl.DateTimeFormat {
    const cached = FORMATTERS.get(key);
    if (cached) return cached;
    // Built before it is stored: an unknown timezone throws here exactly as it
    // did uncached, and leaves nothing behind.
    const formatter = build();
    if (FORMATTERS.size >= MAX_FORMATTERS) FORMATTERS.clear();
    FORMATTERS.set(key, formatter);
    return formatter;
}

/**
 * @group Preview components
 */
export function DatePreview({
    date,
    mode = "date_time",
    timezone
}: DatePreviewProps): React.ReactElement {

    const customizationController = useCustomizationController();
    const configuredLocale = customizationController?.locale;

    // The locale arrives asynchronously now (see `date_fns_locales`). Seed from
    // the cache so only the very first date on a page renders un-localised: by
    // the time a table of them mounts, the module is already resolved and there
    // is no second pass.
    const [dateUtilsLocale, setDateUtilsLocale] = React.useState(() => getLoadedDateFnsLocale(configuredLocale));
    React.useEffect(() => {
        let cancelled = false;
        loadDateFnsLocale(configuredLocale)
            .then(loaded => { if (!cancelled) setDateUtilsLocale(loaded); })
            .catch(error => console.error(`[rebase] could not load the "${configuredLocale}" date locale`, error));
        return () => { cancelled = true; };
    }, [configuredLocale]);

    if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
        return <></>;
    }

    // If timezone is specified, format in that timezone using Intl.DateTimeFormat
    if (timezone) {
        // A time of day travels on 1970-01-01; that day is not part of it.
        const options: Intl.DateTimeFormatOptions = mode === "time"
            ? { timeZone: timezone }
            : {
                year: "numeric",
                month: "short",
                day: "numeric",
                timeZone: timezone
            };

        if (mode === "date_time" || mode === "time") {
            options.hour = "2-digit";
            options.minute = "2-digit";
        }

        const locale = customizationController?.locale ?? "en-US";
        const formatter = cachedFormatter(`${locale}|${timezone}|${mode}`, () => new Intl.DateTimeFormat(locale, options));
        const formattedDate = formatter.format(date);

        // A day on its own has no time for a zone to qualify.
        const tzAbbrev = mode === "date_time"
            ? cachedFormatter(`en-US|${timezone}|zone`, () => new Intl.DateTimeFormat("en-US", {
                timeZone: timezone,
                timeZoneName: "short"
            })).formatToParts(date).find(p => p.type === "timeZoneName")?.value ?? ""
            : "";

        return (
            // A date is a measured value: the mono tier, tabular, so a column of
            // them lines up and a live one does not jitter. Size and colour are
            // inherited from where it sits — a table cell, a form value.
            <span className="flex items-center gap-1 font-mono tabular-nums">
                {formattedDate}
                {tzAbbrev && (
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                        ({tzAbbrev})
                    </span>
                )}
            </span>
        );
    }

    // No timezone specified: use local formatting with date-fns
    let dateFormat: string;
    if (mode === "time") {
        dateFormat = "p"; // e.g., "9:30 AM"
    } else if (mode === "date") {
        // Date-only format (no time)
        dateFormat = customizationController?.dateTimeFormat
            ? customizationController.dateTimeFormat.replace(/[, ]*[HhKk].*$/, "").trim()
            : "PP"; // e.g., "Apr 29, 2024"
    } else {
        // Full date-time format
        dateFormat = customizationController?.dateTimeFormat ?? defaultDateFormat;
    }

    const formattedDate = format(date, dateFormat, { locale: dateUtilsLocale });

    return (
        <span className="font-mono tabular-nums">
            {formattedDate}
        </span>
    );
}
