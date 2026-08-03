import type { Properties } from "@rebasepro/types";

import React, { useCallback, useMemo, useState } from "react";
import { EntityTableController } from "@rebasepro/admin-types";
import {
    ArrowDownIcon,
    ArrowUpDownIcon,
    ArrowUpIcon,
    Button,
    cls,
    iconSize,
    IconButton,
    Popover,
    Typography
} from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";
import { getSortablePropertyOptions } from "../CollectionTableBinding/column_utils";
import { getIconForProperty } from "../../util/property_utils";

export type SortButtonProps<M extends Record<string, unknown>> = {
    tableController: EntityTableController<M>;
    /**
     * Resolved properties of the collection. The sortable ones among them are
     * the options offered.
     */
    properties: Properties;
};

/**
 * Toolbar control that orders the collection by one property.
 *
 * The table orders by clicking a column header, which leaves every other view
 * mode — list, cards, and either of them inside a split view — with no way to
 * order at all, even though the controller has always carried `sortBy` and the
 * query has always honoured it. This binds a control to it.
 *
 * Clicking the active property flips its direction, so ascending → descending
 * is one click rather than a trip through a direction selector; clicking a
 * different one starts it ascending. The popover stays open through both.
 */
export function SortButton<M extends Record<string, unknown>>({
    tableController,
    properties
}: SortButtonProps<M>) {

    const { t } = useTranslation();
    const [open, setOpen] = useState(false);

    const options = useMemo(() => getSortablePropertyOptions(properties), [properties]);

    const {
        sortBy,
        setSortBy,
        setItemCount,
        pageSize,
        filterValues,
        checkFilterCombination
    } = tableController;

    const activeKey = sortBy?.[0];
    const activeDirection = sortBy?.[1];

    const applySort = useCallback((next?: [string, "asc" | "desc"]) => {
        setSortBy?.(next);
        // Re-ordering a partially loaded collection is the same event as
        // clicking a table header: the rows already fetched are no longer the
        // ones the query answers with, so pagination starts over rather than
        // holding on to a page of the previous order (`SelectableTable` resets
        // it for the same reason).
        if (pageSize !== undefined)
            setItemCount?.(pageSize);
    }, [setSortBy, setItemCount, pageSize]);

    const onOptionClick = useCallback((key: string) => {
        if (key === activeKey) {
            applySort([key, activeDirection === "asc" ? "desc" : "asc"]);
        } else {
            applySort([key, "asc"]);
        }
    }, [activeKey, activeDirection, applySort]);

    if (!setSortBy || options.length === 0) {
        return null;
    }

    const activeOption = options.find(option => option.key === activeKey);
    const label = activeOption
        ? `${t("sort_by")}: ${activeOption.title}`
        : t("sort");

    // Icon only, at every width. The arrow says which way the order runs; which
    // property it runs on is in the popover, and in the tooltip for anyone who
    // wants it without opening one.
    //
    // No `onClick` here and no `Tooltip` wrapper: the popover is controlled in
    // this component, and Radix's trigger — which reaches the button through
    // `asChild` — is what toggles it. A handler of our own would toggle it a
    // second time in the same click and the popover would never open; a
    // `Tooltip` in between would swallow the trigger's ref.
    const trigger = (
        <IconButton
            size={"small"}
            aria-label={label}
            title={label}
            className={cls(activeOption && "text-primary")}
        >
            {activeDirection === "desc"
                ? <ArrowDownIcon size={iconSize.smallest}/>
                : activeDirection === "asc"
                    ? <ArrowUpIcon size={iconSize.smallest}/>
                    : <ArrowUpDownIcon size={iconSize.smallest}/>}
        </IconButton>
    );

    return (
        <Popover
            open={open}
            onOpenChange={setOpen}
            modal={false}
            side="bottom"
            align="start"
            trigger={trigger}
        >
            <div className="py-2 min-w-[240px] flex flex-col">
                <Typography
                    variant="caption"
                    color="secondary"
                    className="font-medium uppercase tracking-wider px-3 pb-1"
                >
                    {t("sort_by")}
                </Typography>

                <div className="max-h-[320px] overflow-y-auto flex flex-col">
                    {options.map(({ key, title, property }) => {
                        const active = key === activeKey;
                        // A driver may refuse a sort next to the filter that is
                        // already applied. Offering it would turn the click
                        // into a failed request, so it is disabled with the
                        // same authority the table headers ask.
                        const disabled = checkFilterCombination
                            ? !checkFilterCombination(filterValues ?? {}, [key, active && activeDirection === "asc" ? "desc" : "asc"])
                            : false;
                        return (
                            <button
                                key={key}
                                type="button"
                                role="menuitemradio"
                                aria-checked={active}
                                disabled={disabled}
                                onClick={() => onOptionClick(key)}
                                className={cls(
                                    "flex items-center gap-2 px-3 py-1.5 text-sm text-left w-full",
                                    disabled
                                        ? "opacity-50 cursor-not-allowed"
                                        : "cursor-pointer hover:bg-surface-accent-100 dark:hover:bg-surface-accent-900",
                                    active && "text-primary"
                                )}
                            >
                                <span className="flex-shrink-0 flex items-center">
                                    {getIconForProperty(property, "smallest")}
                                </span>
                                <span className="flex-grow truncate">{title}</span>
                                {active && (
                                    <span className="flex-shrink-0 flex items-center">
                                        {activeDirection === "desc"
                                            ? <ArrowDownIcon size={iconSize.smallest}/>
                                            : <ArrowUpIcon size={iconSize.smallest}/>}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>

                <div className="px-3 pt-2">
                    <Button
                        variant="text"
                        size="small"
                        className="w-full"
                        disabled={!activeOption}
                        onClick={() => applySort(undefined)}
                    >
                        {t("clear_sort")}
                    </Button>
                </div>
            </div>
        </Popover>
    );
}
