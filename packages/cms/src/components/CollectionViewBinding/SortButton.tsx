import type { OrderByTuple, Properties } from "@rebasepro/types";

import React, { useCallback, useMemo, useState } from "react";
import { EntityTableController } from "@rebasepro/cms-types";
import {
    ArrowDownIcon,
    ArrowUpDownIcon,
    ArrowUpIcon,
    Button,
    ChevronDownIcon,
    ChevronUpIcon,
    cls,
    defaultBorderMixin,
    iconSize,
    IconButton,
    Popover,
    Typography,
    XIcon
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
    /**
     * Toolbar showing icon-only controls (split view, or a layout too narrow
     * for the filters button's label). Only decides the icon size, which
     * follows that button — see `CollectionViewStartActions`.
     */
    compact?: boolean;
};

/**
 * Toolbar control that orders the collection.
 *
 * The table orders by clicking a column header, which leaves every other view
 * mode — list, cards, and either of them inside a split view — with no way to
 * order at all, even though the controller has always carried `sortBy` and the
 * query has always honoured it. This binds a control to it.
 *
 * It edits the *whole* order rather than a single key. A sort can have several
 * keys, applied in the order shown: the second decides between rows the first
 * calls equal, the third between rows the first two do. So the active keys sit
 * at the top, numbered and movable, and the properties below them are the ones
 * that can still be added under the last. Shift-clicking a column header does
 * the same thing from the table; this is the view for the modes that have no
 * headers, and the only place the order between keys can be changed.
 *
 * Clicking an active key flips its direction, so ascending → descending is one
 * click rather than a trip through a direction selector; clicking an inactive
 * one appends it ascending. The popover stays open through all of it — building
 * a two-key order out of a control that closes on every click is four round
 * trips through a button.
 */
export function SortButton<M extends Record<string, unknown>>({
    tableController,
    properties,
    compact
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

    const keys = useMemo(() => (sortBy ?? []) as OrderByTuple[], [sortBy]);
    const activeIndex = useMemo(() => {
        const index = new Map<string, { direction: "asc" | "desc"; position: number }>();
        keys.forEach(([key, direction], position) => {
            if (!index.has(key)) index.set(key, { direction,
position });
        });
        return index;
    }, [keys]);

    const applySort = useCallback((next?: OrderByTuple[]) => {
        setSortBy?.((next && next.length > 0 ? next : undefined) as Parameters<NonNullable<typeof setSortBy>>[0]);
        // Re-ordering a partially loaded collection is the same event as
        // clicking a table header: the rows already fetched are no longer the
        // ones the query answers with, so pagination starts over rather than
        // holding on to a page of the previous order (`SelectableTable` resets
        // it for the same reason).
        if (pageSize !== undefined)
            setItemCount?.(pageSize);
    }, [setSortBy, setItemCount, pageSize]);

    /** Flip an active key's direction, or append an inactive one ascending. */
    const onOptionClick = useCallback((key: string) => {
        const active = activeIndex.get(key);
        if (!active) {
            applySort([...keys, [key, "asc"]]);
            return;
        }
        applySort(keys.map(entry => entry[0] === key
            ? [key, active.direction === "asc" ? "desc" : "asc"] as OrderByTuple
            : entry));
    }, [activeIndex, applySort, keys]);

    const removeKey = useCallback((key: string) => {
        applySort(keys.filter(([existing]) => existing !== key));
    }, [applySort, keys]);

    /** What a click on an active key will do to it, for the tooltip and the label. */
    const flipLabel = useCallback(
        (direction: "asc" | "desc") => direction === "asc" ? t("sort_descending") : t("sort_ascending"),
        [t]
    );

    /** Swap a key with its neighbour, which is what changes which one decides. */
    const moveKey = useCallback((position: number, delta: -1 | 1) => {
        const target = position + delta;
        if (target < 0 || target >= keys.length) return;
        const next = [...keys];
        [next[position], next[target]] = [next[target], next[position]];
        applySort(next);
    }, [applySort, keys]);

    if (!setSortBy || options.length === 0) {
        return null;
    }

    const primary = keys[0];
    // The key's own name when it has no option to be titled by — a sort can
    // outlive the column it names (a property hidden since, a `collection.sort`
    // on something the panel does not render). Falling back to "Sort" there
    // showed the neutral icon and the inactive label over a collection that
    // *was* sorted, which is the one thing this control exists to report.
    const primaryTitle = primary
        ? options.find(option => option.key === primary[0])?.title ?? primary[0]
        : undefined;
    const label = primaryTitle
        ? keys.length > 1
            ? `${t("sort_by")}: ${primaryTitle} +${keys.length - 1}`
            : `${t("sort_by")}: ${primaryTitle}`
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
    const arrowSize = compact ? iconSize.smallest : iconSize.small;
    const primaryDirection = primary?.[1];

    const trigger = (
        <IconButton
            size={"small"}
            aria-label={label}
            title={label}
            className={cls(primaryTitle && "text-primary")}
        >
            {/* Same icon size as the filter controls it sits between: 16 in the
                split view's narrow toolbar, 20 everywhere else. It was a flat
                16, which read as a smaller button next to them. */}
            {primaryDirection === "desc"
                ? <ArrowDownIcon size={arrowSize}/>
                : primaryDirection === "asc"
                    ? <ArrowUpIcon size={arrowSize}/>
                    : <ArrowUpDownIcon size={arrowSize}/>}
        </IconButton>
    );

    const inactiveOptions = options.filter(option => !activeIndex.has(option.key));

    return (
        <Popover
            open={open}
            onOpenChange={setOpen}
            modal={false}
            side="bottom"
            align="start"
            trigger={trigger}
        >
            <div className="py-2 min-w-[280px] max-w-[360px] flex flex-col">
                <Typography
                    variant="caption"
                    color="secondary"
                    className="font-medium uppercase tracking-wider px-3 pb-1"
                >
                    {t("sort_by")}
                </Typography>

                {keys.length > 0 && (
                    // Bounded for the same reason the option list below is: the
                    // active keys are as many as the collection has sortable
                    // columns, and an unbounded column pushed "Clear sort" off
                    // the bottom of the screen on a wide collection.
                    <div className="flex flex-col max-h-[200px] overflow-y-auto">
                        {keys.map(([key, direction], position) => {
                            const option = options.find(o => o.key === key);
                            return (
                                <div
                                    key={key}
                                    className="flex items-center gap-1 pl-3 pr-2 py-1 text-sm text-primary"
                                >
                                    {/* The rank, not decoration: it is the only
                                        thing on screen saying which key wins. */}
                                    <span className="flex-shrink-0 w-4 text-xs tabular-nums text-text-secondary dark:text-text-secondary-dark">
                                        {position + 1}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => onOptionClick(key)}
                                        title={flipLabel(direction)}
                                        aria-label={`${option?.title ?? key} — ${t("sort_key_position", { position: position + 1 })}. ${flipLabel(direction)}`}
                                        className="flex items-center gap-2 flex-grow min-w-0 text-left cursor-pointer"
                                    >
                                        {option && (
                                            <span className="flex-shrink-0 flex items-center">
                                                {getIconForProperty(option.property, "smallest")}
                                            </span>
                                        )}
                                        <span className="flex-grow truncate">{option?.title ?? key}</span>
                                        <span className="flex-shrink-0 flex items-center">
                                            {direction === "desc"
                                                ? <ArrowDownIcon size={iconSize.smallest}/>
                                                : <ArrowUpIcon size={iconSize.smallest}/>}
                                        </span>
                                    </button>
                                    {/* Ruled off from the key itself. The row
                                        carries two arrows that mean different
                                        things — the direction this key runs, and
                                        which key outranks which — and side by
                                        side at 14px they read as one control
                                        with a stutter. The rule says where the
                                        key ends and the controls on it begin. */}
                                    <div className={cls(
                                        "flex-shrink-0 flex items-center gap-0.5 ml-1 pl-1 border-l",
                                        defaultBorderMixin
                                    )}>
                                        {keys.length > 1 && (
                                            <>
                                                <IconButton
                                                    size="smallest"
                                                    aria-label={t("sort_move_up")}
                                                    title={t("sort_move_up")}
                                                    disabled={position === 0}
                                                    onClick={() => moveKey(position, -1)}
                                                >
                                                    <ChevronUpIcon size={iconSize.smallest}/>
                                                </IconButton>
                                                <IconButton
                                                    size="smallest"
                                                    aria-label={t("sort_move_down")}
                                                    title={t("sort_move_down")}
                                                    disabled={position === keys.length - 1}
                                                    onClick={() => moveKey(position, 1)}
                                                >
                                                    <ChevronDownIcon size={iconSize.smallest}/>
                                                </IconButton>
                                            </>
                                        )}
                                        <IconButton
                                            size="smallest"
                                            aria-label={t("sort_remove_key")}
                                            title={t("sort_remove_key")}
                                            onClick={() => removeKey(key)}
                                        >
                                            <XIcon size={iconSize.smallest}/>
                                        </IconButton>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Only once there is a key to come *after*. With none, the
                    "Sort by" heading above already names the list, and an empty
                    caption here left a band of padding that read as a divider
                    between two groups where there was only one. */}
                {keys.length > 0 && inactiveOptions.length > 0 && (
                    <Typography
                        variant="caption"
                        color="secondary"
                        className="font-medium uppercase tracking-wider px-3 pt-2 pb-1"
                    >
                        {t("sort_then_by")}
                    </Typography>
                )}

                <div className="max-h-[280px] overflow-y-auto flex flex-col">
                    {inactiveOptions.map(({ key, title, property }) => {
                        // A driver may refuse a sort next to the filter that is
                        // already applied. Offering it would turn the click
                        // into a failed request, so it is disabled with the
                        // same authority the table headers ask.
                        const disabled = checkFilterCombination
                            ? !checkFilterCombination(filterValues ?? {}, [...keys, [key, "asc"]])
                            : false;
                        return (
                            <button
                                key={key}
                                type="button"
                                // Not `menuitemradio`: a sort is a *list* of
                                // keys, so picking one does not unpick another,
                                // and the role announced the opposite. There is
                                // no `role="menu"` around this either, which
                                // left the radio orphaned as well as wrong.
                                aria-label={keys.length > 0
                                    ? `${t("sort_then_by")} ${title}`
                                    : `${t("sort_by")} ${title}`}
                                disabled={disabled}
                                onClick={() => onOptionClick(key)}
                                className={cls(
                                    "flex items-center gap-2 px-3 py-1.5 text-sm text-left w-full",
                                    disabled
                                        ? "opacity-50 cursor-not-allowed"
                                        : "cursor-pointer hover:bg-surface-accent-100 dark:hover:bg-surface-accent-900"
                                )}
                            >
                                <span className="flex-shrink-0 flex items-center">
                                    {getIconForProperty(property, "smallest")}
                                </span>
                                <span className="flex-grow truncate">{title}</span>
                            </button>
                        );
                    })}
                </div>

                <div className="px-3 pt-2">
                    <Button
                        variant="text"
                        size="small"
                        className="w-full"
                        disabled={keys.length === 0}
                        onClick={() => applySort(undefined)}
                    >
                        {t("clear_sort")}
                    </Button>
                </div>
            </div>
        </Popover>
    );
}
