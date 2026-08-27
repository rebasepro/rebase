import React from "react";

import { format } from "date-fns";
import { useCustomizationController } from "@rebasepro/app";
import { defaultDateFormat } from "@rebasepro/utils";
import { getLoadedDateFnsLocale, loadDateFnsLocale } from "./date_fns_locales";

export interface DatePreviewProps {
    date: Date;
    /**
     * Display mode: "date" for date-only, "date_time" for date and time
     */
    mode?: "date" | "date_time";
    /**
     * IANA timezone identifier (e.g., "America/New_York")
     * When specified, the date will be displayed in this timezone
     */
    timezone?: string;
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
        const options: Intl.DateTimeFormatOptions = {
            year: "numeric",
            month: "short",
            day: "numeric",
            timeZone: timezone
        };

        if (mode === "date_time") {
            options.hour = "2-digit";
            options.minute = "2-digit";
        }

        const formatter = new Intl.DateTimeFormat(customizationController?.locale ?? "en-US", options);
        const formattedDate = formatter.format(date);

        // Get timezone abbreviation
        const tzFormatter = new Intl.DateTimeFormat("en-US", {
            timeZone: timezone,
            timeZoneName: "short"
        });
        const parts = tzFormatter.formatToParts(date);
        const tzAbbrev = parts.find(p => p.type === "timeZoneName")?.value ?? "";

        return (
            <span className="flex items-center gap-1">
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
    if (mode === "date") {
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
        <>
            {formattedDate}
        </>
    );
}
