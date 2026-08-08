
import type { Properties, Property } from "@rebasepro/types";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Entity } from "@rebasepro/types";
import { CollectionSize, EntityAction, EntityTableController, SelectionController, AdminCollection } from "@rebasepro/admin-types";
import {
    ArrowDownIcon,
    ArrowUpIcon,
    Checkbox,
    Chip,
    cls,
    defaultBorderMixin,
    IconButton,
    Tooltip,
    Typography,
    ListView
} from "@rebasepro/ui";
import { PropertyPreview } from "../../preview";
import {
    useAuthController,
    useCustomizationController
} from "@rebasepro/app";
import { useAnalyticsController } from "@rebasepro/app";
import { IconForView } from "@rebasepro/app";
import { getIcon } from "@rebasepro/app";
import { hasDeclaredDisplay } from "@rebasepro/app";
import { formatRelativeTime, getValueInPath } from "@rebasepro/utils";
import { useCollectionSlotKeys, useEntitySlots, type CollectionSlotKeys, type EntityPreviewSlots } from "./usePreviewSlots";
import { SlotValue, TagChips } from "./SlotValue";
import { Highlighted } from "./SearchHighlight";
import { useSearchExplanation, MatchExplanation, fieldLabel } from "./SearchExplanation";
import { useAdminContext } from "../../hooks/useAdminContext";
import { resolveEntityAction } from "../../util/resolutions";
import { getSortablePropertyOptions } from "../CollectionTableBinding/column_utils";
import { getResolvedPropertyInPath } from "../../util/property_utils";

export type CollectionListViewBindingProps<M extends Record<string, unknown> = Record<string, unknown>> = {
    collection: AdminCollection<M>;
    tableController: EntityTableController<M>;
    onEntityClick?: (entity: Entity<M>) => void;
    selectionController?: SelectionController<M>;
    selectionEnabled?: boolean;
    highlightedEntities?: Entity<M>[];
    emptyComponent?: React.ReactNode;

    /**
     * Size of the list rows.
     * - "xs": Most compact, single-line rows
     * - "s": Compact with minimal info
     * - "m": Balanced (default) — title + subtitle
     * - "l": Spacious with more preview fields
     * - "xl": Full detail with all preview fields
     */
    size?: CollectionSize;
    /**
     * ID of the currently selected/active entity. When set, the matching
     * row is visually highlighted with a primary accent.
     */
    selectedEntityId?: string | number;

    /**
     * Callback to get entity actions for a given entity.
     * Only actions with `showActionsInListView: true` will be rendered.
     */
    getActionsForEntity?: (params: { entity?: Entity<M>, customEntityActions?: EntityAction[] }) => EntityAction[];

    /**
     * Full path of the collection, used as context for action handlers.
     */
    path?: string;

    /**
     * How entities open when an action triggers navigation.
     */
    openEntityMode?: "side_panel" | "full_screen" | "split" | "dialog";
};

/**
 * Which display slot fills a column, when a slot does rather than a property.
 * A status is an enum chip and a date a relative timestamp wherever they come
 * from, so the cell renders the slot; the column exists either way, because a
 * header needs something to sit over.
 */
type ListColumnSlot = "tags" | "status" | "date";

/**
 * One column of the list, in the header and in every row.
 *
 * The header and the cells read the same definition — the same width, the same
 * alignment, the same decision about being shown at this container width — so a
 * label cannot end up over a column that is not there, or over the wrong one.
 */
type ListColumn = {
    key: string;
    label: string;
    /** Set when a display slot fills the cell; absent when the record does. */
    slot?: ListColumnSlot;
    property?: Property;
    align: "left" | "center" | "right";
    width: string;
    /**
     * What {@link width} costs in pixels, so the fit calculation can budget in
     * the same units the row lays out in. A flat per-column estimate treated a
     * relation (w-64) as costing the same as a date (w-28), which is where a row
     * ran out of width for the title while still claiming everything fit.
     */
    widthPx: number;
    /** Whether clicking this header can order the collection by it. */
    sortable: boolean;
    /**
     * What survives when the row runs out of width: the lowest goes first.
     */
    priority: number;
};

// ── Column priorities ─────────────────────────────────────────────────
// Read as "what a narrowing row gives up first".
//
// Three bands. The sort or filter *in force* comes first: it is the reason the
// rows are in the order they are in, and hiding the column it names leaves that
// order unexplained. The collection's own columns come next — its `listProperties`,
// or the status and date it was read as having. A column left over from a
// request since cleared comes last: it is worth keeping while there is room for
// it, and it is not worth the collection's own status.

/** A column left over from a sort or filter that is no longer applied. */
const PRIORITY_STALE_REQUEST = 1000;
/** The collection's own columns. Slots sit just above it, in give-way order. */
const PRIORITY_DECLARED = 2000;
const PRIORITY_DATE = PRIORITY_DECLARED;
const PRIORITY_STATUS = PRIORITY_DECLARED + 1;
const PRIORITY_TAGS = PRIORITY_DECLARED + 2;
/** The sort or filter currently in force. */
const PRIORITY_ACTIVE_REQUEST = 3000;

/**
 * How wide a column of this property wants to be — the Tailwind class the cell
 * gets, and the pixel cost of that class. The two are returned together because
 * they must not drift: the budget is only meaningful if it describes the widths
 * actually rendered. `lg:` variants key off the viewport, not this panel, so a
 * narrow split on a wide screen gets the larger of the two — the cost we budget.
 */
function getIdealColumnWidth(prop: Property): { width: string, widthPx: number } {
    if (prop.type === "string" && "enum" in prop) return { width: "flex-shrink-0 w-32", widthPx: 128 };
    if (prop.type === "date" || prop.type === "number" || prop.type === "boolean") return { width: "flex-shrink-0 w-28", widthPx: 112 };
    if (prop.type === "reference" || prop.type === "relation") return { width: "flex-shrink-0 w-56 lg:w-64", widthPx: 256 };
    if (prop.type === "string") return { width: "flex-shrink-0 w-40 lg:w-48", widthPx: 192 };
    return { width: "flex-shrink-0 w-40", widthPx: 160 };
}

/**
 * Get row padding/spacing classes based on size
 */
function getRowClasses(size: CollectionSize): string {
    switch (size) {
        case "xs": return "py-2 px-5";
        case "s": return "py-2.5 px-5";
        case "m": return "py-3 px-5";
        case "l": return "py-4 px-5";
        case "xl": return "py-5 px-5";
        default: return "py-3 px-5";
    }
}

// ── Row layout budget ─────────────────────────────────────────────────
// What the row spends before a single column is placed. These mirror the
// classes on the row itself (`px-5`, `gap-4`, `w-8` checkbox, `w-10` image);
// they are the same layout described twice, so a change to one is a change to
// the other.

/** `px-5` on both sides. */
const ROW_PADDING_WIDTH = 40;
/** The checkbox cell (`w-8`). */
const CHECKBOX_WIDTH = 32;
/** The thumbnail / icon square (`w-10`). */
const IMAGE_WIDTH = 40;
/** `gap-4` between every cell of the row. */
const COLUMN_GAP = 16;

/**
 * The title's share of a row, taken before any column bids for width.
 *
 * A title is a name, and a name truncated to "Lider Sr. en…" has stopped being
 * one. Columns are a scanner's convenience; the title is the row's identity, so
 * a narrow list spends its width on the title and simply shows fewer columns.
 */
const TITLE_COMFORTABLE_WIDTH = 320;

/** An `IconButton size="small"` (`w-8`), which is what a row action renders as. */
const ACTION_BUTTON_WIDTH = 32;
/** `gap-0.5` between row actions. */
const ACTION_BUTTON_GAP = 2;
/**
 * How many rows are read to size the actions cell.
 *
 * Actions are resolved per record, so the width they need is only knowable by
 * asking — and asking every loaded row would mean re-resolving thousands of
 * them on every page. The first rows are representative: a collection whose
 * actions vary at all varies within its first screenful.
 */
const ACTIONS_SAMPLE_SIZE = 20;

/** Stable empty array for when no list-view actions are available. */
const EMPTY_LIST_VIEW_ACTIONS: EntityAction[] = [];

/**
 * Returns true if a property type should NOT be rendered via
 * PropertyPreview in list row columns (because it would blow up height).
 */
function isComplexPropertyType(property: Property): boolean {
    if (property.type === "array") {
        const ofProp = "of" in property ? property.of : undefined;
        const innerProp = ofProp ? (Array.isArray(ofProp) ? ofProp[0] : ofProp) : undefined;
        if (innerProp && typeof innerProp === "object" && "enum" in innerProp && innerProp.enum) {
            return false;
        }
    }
    return property.type === "array"
        || property.type === "map"
        || property.type === "reference"
        || property.type === "relation";
}

/**
 * Render a complex value as a compact, single-line string.
 * - Arrays  → "Item, Item +3"
 * - Maps    → "4 fields"
 * - Refs    → entity ID
 * - Relations → entity ID or name
 */
function compactValueSummary(value: unknown, property: Property): string | null {
    if (value === undefined || value === null) return null;

    if (property.type === "array") {
        if (!Array.isArray(value)) return null;
        if (value.length === 0) return null;

        const of = "of" in property ? property.of : undefined;
        const innerProp = of ? (Array.isArray(of) ? of[0] : of) : undefined;

        // String/number arrays → join
        const labels = value.map((v: unknown) => {
            if (typeof v === "string") return v;
            if (typeof v === "number") return String(v);
            // Reference inside array
            if (v && typeof v === "object" && "id" in v) return String((v as Record<string, unknown>).id);
            // Enum label lookup
            if (innerProp && "enum" in innerProp && innerProp.enum && typeof v === "string") {
                const enumValues = innerProp.enum;
                if (Array.isArray(enumValues)) {
                    const match = enumValues.find((e: unknown) =>
                        typeof e === "object" && e !== null && "id" in e && (e as Record<string, unknown>).id === v
                    );
                    if (match && typeof match === "object" && "label" in match) return String((match as Record<string, unknown>).label);
                } else if (typeof enumValues === "object") {
                    const label = (enumValues as Record<string, unknown>)[v];
                    if (typeof label === "string") return label;
                    if (label && typeof label === "object" && "label" in label) return String((label as Record<string, unknown>).label);
                }
                return v;
            }
            return "•";
        });

        const MAX_SHOWN = 2;
        const shown = labels.slice(0, MAX_SHOWN).join(", ");
        const remaining = labels.length - MAX_SHOWN;
        return remaining > 0 ? `${shown} +${remaining}` : shown;
    }

    if (property.type === "map") {
        if (typeof value !== "object" || value === null) return null;
        const count = Object.keys(value).length;
        return count === 0 ? null : `${count} field${count !== 1 ? "s" : ""}`;
    }

    if (property.type === "reference") {
        if (typeof value === "string") return value;
        if (value && typeof value === "object" && "id" in value) return String((value as Record<string, unknown>).id);
        return null;
    }

    if (property.type === "relation") {
        if (typeof value === "string" || typeof value === "number") return String(value);
        if (value && typeof value === "object") {
            const obj = value as Record<string, unknown>;
            // EntityRelation.data is a Entity: { id, path, values: { name, ... } }
            if (obj.data && typeof obj.data === "object") {
                const data = obj.data as Record<string, unknown>;
                const values = (data.values && typeof data.values === "object")
                    ? data.values as Record<string, unknown>
                    : data;
                const name = values.name ?? values.title ?? values.display_name
                    ?? values.displayName ?? values.label ?? values.email;
                if (name && typeof name !== "object") return String(name);
            }
            if ("id" in obj) return String(obj.id);
        }
        return null;
    }

    return null;
}

/**
 * Format a date value for display in the list.
 *
 * A date column holds whatever the developer put in it, so the value is as
 * likely to be ahead of now as behind it. The relative phrase therefore comes
 * from {@link formatRelativeTime}, which reads the sign: a row due this
 * afternoon says "in 2h" rather than the "-1d ago" that flooring a negative
 * difference used to produce.
 */
function formatDateValue(value: unknown, now: Date = new Date()): string | null {
    if (!value) return null;
    let date: Date | null = null;
    if (value instanceof Date) {
        date = value;
    } else if (typeof value === "string" || typeof value === "number") {
        date = new Date(value);
    }
    if (!date || isNaN(date.getTime())) return null;

    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    // Today and yesterday get their own wording; both are strictly in the past,
    // because a negative difference floors to -1 and falls through to below.
    if (diffDays === 0) {
        return date.toLocaleTimeString(undefined, { hour: "2-digit",
minute: "2-digit" });
    }
    if (diffDays === 1) return "Yesterday";

    const relative = formatRelativeTime(date, { now });
    if (relative) return relative;

    // Comparing years rather than counting days: a date six weeks back across a
    // new year needs the year, and one 400 days ahead needs it just as much.
    return date.toLocaleDateString(undefined, { month: "short",
day: "numeric",
year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
}

/**
 * Classic admin list view for displaying entities.
 * Designed to be the most familiar, stereotypical admin content management view:
 * - Clean rows with checkbox, icon/avatar, title, metadata, and actions
 * - Column-sortable headers
 * - Infinite scroll
 */
export function CollectionListViewBinding<M extends Record<string, unknown> = Record<string, unknown>>({
    collection,
    tableController,
    onEntityClick,
    selectionController,
    selectionEnabled = true,
    highlightedEntities,
    emptyComponent,

    size = "m",
    selectedEntityId,
    getActionsForEntity,
    path,
    openEntityMode
}: CollectionListViewBindingProps<M>) {
    const authController = useAuthController();
    const customizationController = useCustomizationController();
    const analyticsController = useAnalyticsController();
    const context = useAdminContext();

    const containerRef = useRef<HTMLDivElement>(null);
    // `undefined` is "not measured yet", and it renders the title alone. The
    // seed used to be a 1200px guess, which is a claim about a list that may be
    // a 300px column of a split — and, because the ref below was never attached
    // to anything, a guess nothing ever corrected.
    const [containerWidth, setContainerWidth] = useState<number | undefined>(undefined);

    // Track container width for responsive column visibility
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const measure = (width: number) => setContainerWidth(width > 0 ? width : undefined);
        measure(el.getBoundingClientRect().width);
        if (typeof ResizeObserver === "undefined") return;
        const ro = new ResizeObserver(([entry]) => {
            if (entry) measure(entry.contentRect.width);
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const {
        data,
        dataLoading,
        noMoreToLoad,
        dataLoadingError,
        itemCount,
        setItemCount,
        pageSize = 50,
        paginationEnabled,
        sortBy,
        setSortBy,
        filterValues,
        checkFilterCombination,
        searchString
    } = tableController;

    const resolvedCollection = collection;

    // ── Shared slot resolution (replaces 4 individual useMemo calls) ──
    const slotKeys = useCollectionSlotKeys(
        resolvedCollection as AdminCollection<Record<string, unknown>>,
        authController,
        customizationController.propertyConfigs
    );
    const { titleKey: titlePropertyKey, imageKey: imagePropertyKey, subtitleKey, statusKey: statusPropertyKey, dateKey: datePropertyKey } = slotKeys;

    const columnMode = !!resolvedCollection.listProperties && resolvedCollection.listProperties.length > 0;

    /**
     * The properties an `ORDER BY` can be written for, under the same authority
     * the table headers and the sort menu ask — so a header that offers a sort
     * here offers it there, and none of the three invents one the driver would
     * silently drop.
     */
    const sortableKeys = useMemo(
        () => new Set(getSortablePropertyOptions(resolvedCollection.properties as Properties).map(option => option.key)),
        [resolvedCollection.properties]
    );

    /** The row's identity cell: the leading column, or the title slot. */
    const titleColumn = useMemo<ListColumn | undefined>(() => {
        const key = columnMode ? resolvedCollection.listProperties?.[0] : titlePropertyKey;
        if (!key) return undefined;
        const property = resolvedCollection.properties[key] as Property | undefined;
        return {
            key,
            label: property?.name || (columnMode ? key : "Name"),
            property,
            align: "left",
            width: "flex-1 min-w-0",
            widthPx: TITLE_COMFORTABLE_WIDTH,
            sortable: sortableKeys.has(key),
            priority: Number.MAX_SAFE_INTEGER
        };
    }, [columnMode, resolvedCollection, titlePropertyKey, sortableKeys]);

    /**
     * The trailing columns the collection itself implies: the developer's
     * `listProperties` when there are any, otherwise the display slots the row
     * has always shown to the right of the title.
     */
    const declaredColumns = useMemo<ListColumn[]>(() => {
        if (columnMode) {
            const keys = resolvedCollection.listProperties!.slice(1);
            return keys.flatMap((key, index) => {
                const property = resolvedCollection.properties[key] as Property | undefined;
                if (!property) return [];
                return [{
                    key,
                    label: property.name || key,
                    property,
                    align: (property.type === "number" || property.type === "date" ? "right" : "left") as ListColumn["align"],
                    ...getIdealColumnWidth(property),
                    sortable: sortableKeys.has(key),
                    // Declared order is a statement of importance: the first
                    // column after the title outlives the last one.
                    priority: PRIORITY_DECLARED + (keys.length - index)
                }];
            });
        }

        const cols: ListColumn[] = [];

        // A slot column exists when the collection has something to put in it —
        // a property to read, or a resolver that computes one. Whether a given
        // record fills it is a per-row question, and the wrong one to ask here:
        // a column that came and went with the values under it would leave its
        // header over a different cell on every row.
        const slotColumn = (
            slot: ListColumnSlot,
            key: string | undefined,
            fallbackLabel: string,
            layout: { align: ListColumn["align"], width: string, widthPx: number },
            priority: number
        ): ListColumn | undefined => {
            const declared = hasDeclaredDisplay(resolvedCollection, slot);
            if (!key && !declared) return undefined;
            const property = key ? resolvedCollection.properties[key] as Property | undefined : undefined;
            return {
                key: key ?? `display:${slot}`,
                label: property?.name || fallbackLabel,
                slot,
                property,
                ...layout,
                // A computed slot has no column to order by, whatever it renders.
                sortable: !!key && sortableKeys.has(key),
                priority
            };
        };

        const tags = slotColumn(
            "tags",
            slotKeys.tagsKey,
            "Tags",
            { align: "left", width: "flex-shrink-0 w-40", widthPx: 160 },
            PRIORITY_TAGS
        );
        if (tags) cols.push(tags);

        const status = slotColumn(
            "status",
            statusPropertyKey,
            "Status",
            { align: "left", width: "flex-shrink-0 w-32", widthPx: 128 },
            PRIORITY_STATUS
        );
        if (status) cols.push(status);

        const date = slotColumn(
            "date",
            datePropertyKey,
            "Modified",
            { align: "right", width: "flex-shrink-0 w-20", widthPx: 80 },
            PRIORITY_DATE
        );
        if (date) cols.push(date);

        return cols;
    }, [columnMode, resolvedCollection, slotKeys.tagsKey, statusPropertyKey, datePropertyKey, sortableKeys]);

    /** What the row already shows without a column of its own. */
    const shownKeys = useMemo(() => new Set<string | undefined>([
        titleColumn?.key,
        imagePropertyKey,
        subtitleKey,
        ...declaredColumns.map(col => col.key),
        // The relation chips under the title are as visible as any column.
        ...(columnMode ? [] : slotKeys.relationKeys)
    ]), [titleColumn, imagePropertyKey, subtitleKey, declaredColumns, columnMode, slotKeys.relationKeys]);

    /** The property the sort names, when no cell already shows it. */
    const sortedKey = useMemo(() => {
        const key = sortBy?.[0];
        return key && !shownKeys.has(key) ? key : undefined;
    }, [sortBy, shownKeys]);

    /** The properties the filters name, minus the ones a cell already shows. */
    const filteredKeys = useMemo(
        () => Object.keys(filterValues ?? {}).filter(key => !shownKeys.has(key)),
        [filterValues, shownKeys]
    );

    /**
     * The last property the sort named, and the last set the filters named.
     *
     * A column earns its place when a sort or a filter names it, and keeps it
     * once that sort or filter is cleared: taking it back would move every
     * column right of it at the moment the user is comparing values across rows,
     * and clearing a sort says nothing about wanting to stop seeing the property
     * it sorted on.
     *
     * What it does *not* do is accumulate. There is only ever one sort, so
     * ordering by four properties in turn is changing one's mind four times, not
     * asking for four columns — and asking for four is how the row lost its
     * status and its date to a wall of numbers. A new sort therefore replaces
     * the property the last one left behind, and a new set of filters replaces
     * the set before it. At most one sort column and one set of filter columns
     * outlive their request.
     *
     * The list remounts per collection (it is keyed by path), so this is the
     * memory of one visit to one collection, not a preference.
     */
    const [lastSortedKey, setLastSortedKey] = useState<string | undefined>(undefined);
    const [lastFilteredKeys, setLastFilteredKeys] = useState<string[]>([]);

    useEffect(() => {
        if (sortedKey) setLastSortedKey(sortedKey);
    }, [sortedKey]);

    useEffect(() => {
        if (filteredKeys.length === 0) return;
        // Same members, same array: `filteredKeys` is rebuilt every render, and
        // storing an equal copy would re-render every consumer of the columns.
        setLastFilteredKeys(previous =>
            previous.length === filteredKeys.length && previous.every((key, i) => key === filteredKeys[i])
                ? previous
                : filteredKeys);
    }, [filteredKeys]);

    /**
     * Columns for what the user asked to sort or filter by and cannot see.
     *
     * Ordering a list by a property no cell shows produces a shuffle with no
     * explanation in it — the rows move and nothing on screen says why. So the
     * property joins the row as its own column, last: the filters' first, in
     * their own order, then the sort's.
     */
    const requestedColumns = useMemo<ListColumn[]>(() => {
        // The live request where there is one, the remembered one otherwise —
        // read in that order rather than from state alone, because the effects
        // above have not run yet on the render that first sees a request, and
        // waiting a frame would flash the row without its new column.
        const active = new Set([...filteredKeys, ...(sortedKey ? [sortedKey] : [])]);
        const keys: string[] = [];
        const request = (key: string | undefined) => {
            if (!key || keys.includes(key) || shownKeys.has(key)) return;
            keys.push(key);
        };
        (filteredKeys.length > 0 ? filteredKeys : lastFilteredKeys).forEach(request);
        request(sortedKey ?? lastSortedKey);

        return keys.flatMap((key, index) => {
            const property = getResolvedPropertyInPath(resolvedCollection.properties, key) as Property | undefined;
            if (!property) return [];
            return [{
                key,
                label: property.name || key,
                property,
                align: (property.type === "number" || property.type === "date" ? "right" : "left") as ListColumn["align"],
                ...getIdealColumnWidth(property),
                sortable: sortableKeys.has(key),
                priority: (active.has(key) ? PRIORITY_ACTIVE_REQUEST : PRIORITY_STALE_REQUEST) - index
            }];
        });
    }, [filteredKeys, sortedKey, lastFilteredKeys, lastSortedKey, shownKeys, resolvedCollection, sortableKeys]);

    // ── Compute list-view-visible actions per entity ──
    const getListViewActions = useCallback((entity: Entity<M>): EntityAction[] => {
        if (!getActionsForEntity) return EMPTY_LIST_VIEW_ACTIONS;
        const customEntityActions = (collection.entityActions ?? [])
            .map(action => resolveEntityAction(action, customizationController.entityActions))
            .filter(Boolean) as EntityAction<M>[];
        const allActions = getActionsForEntity({ entity,
customEntityActions });
        return allActions.filter(a => a.showActionsInListView);
    }, [getActionsForEntity, collection.entityActions, customizationController.entityActions]);

    const showImage = size !== "xs";

    /**
     * Does the checkbox ride on the thumbnail rather than sit beside it?
     *
     * Only in the split's compact list — the one layout where the list is a
     * column beside a record rather than the page itself, and where the 48px of
     * checkbox cell is 48px the title does not get. Everywhere else the list has
     * the room, and a checkbox that is always there is easier to find than one
     * that appears under the pointer.
     *
     * Needs a thumbnail to ride on: at `xs` there is none, so the checkbox keeps
     * its cell.
     */
    const combineSelection = openEntityMode === "split" && selectedEntityId !== undefined && showImage;

    /**
     * How much room the action buttons take, reserved identically in the header
     * and in every row so the columns line up above one another whether or not a
     * given record has actions.
     */
    const actionsWidth = useMemo(() => {
        if (!getActionsForEntity) return 0;
        let most = 0;
        for (const entity of data.slice(0, ACTIONS_SAMPLE_SIZE)) {
            most = Math.max(most, getListViewActions(entity).length);
        }
        return most === 0 ? 0 : most * ACTION_BUTTON_WIDTH + (most - 1) * ACTION_BUTTON_GAP;
    }, [data, getActionsForEntity, getListViewActions]);

    // Responsive: keep only the columns the row can actually pay for.
    //
    // The title is what a row is *for* — it is the one cell that identifies the
    // record — so it is not one competitor among the columns: it takes its
    // comfortable share off the top, and the columns divide what is left. What
    // gives way when there is not enough is decided by `priority` rather than by
    // position, so the column the user just sorted by outlives the inferred
    // ones; the survivors keep their declared order, because a row that
    // reordered itself as it resized would be unreadable.
    const visibleColumns = useMemo(() => {
        const columns = [...declaredColumns, ...requestedColumns];
        if (columns.length === 0) return columns;

        // Unmeasured: the title alone, which is the answer we would rather flash
        // than a row of columns squeezing it down to an ellipsis.
        if (containerWidth === undefined) return [];

        const chrome = ROW_PADDING_WIDTH
            + (selectionEnabled && !combineSelection ? CHECKBOX_WIDTH + COLUMN_GAP : 0)
            + (showImage ? IMAGE_WIDTH + COLUMN_GAP : 0)
            + (actionsWidth > 0 ? actionsWidth + COLUMN_GAP : 0);
        const available = containerWidth - chrome - TITLE_COMFORTABLE_WIDTH;

        const cost = (col: ListColumn) => col.widthPx + COLUMN_GAP;
        let total = columns.reduce((acc, col) => acc + cost(col), 0);
        if (total <= available) return columns;

        const dropped = new Set<string>();
        for (const col of [...columns].sort((a, b) => a.priority - b.priority)) {
            if (total <= available) break;
            dropped.add(col.key);
            total -= cost(col);
        }
        return columns.filter(col => !dropped.has(col.key));
    }, [declaredColumns, requestedColumns, containerWidth, selectionEnabled, combineSelection, showImage, actionsWidth]);

    const handleEntityClick = useCallback((entity: Entity<M>) => {
        analyticsController.onAnalyticsEvent?.("entity_click", {
            path: entity.path,
            entityId: entity.id
        });
        onEntityClick?.(entity);
    }, [onEntityClick, analyticsController]);

    const handleSelectionChange = useCallback((entity: Entity<M>, selected: boolean) => {
        selectionController?.toggleEntitySelection(entity, selected);
    }, [selectionController]);

    const isEntitySelected = useCallback((entity: Entity<M>) => {
        return selectionController?.isEntitySelected(entity) ?? false;
    }, [selectionController]);

    const isEntityHighlighted = useCallback((entity: Entity<M>) => {
        return highlightedEntities?.some(e => e.id === entity.id && e.path === entity.path) ?? false;
    }, [highlightedEntities]);


    const rowClasses = getRowClasses(size);

    const selectedIds = useMemo(() => new Set(selectionController?.selectedEntities.map(e => e.id)), [selectionController?.selectedEntities]);
    const highlightedIds = useMemo(() => new Set(highlightedEntities?.map(e => e.id)), [highlightedEntities]);

    const handleRowSelectionChange = useCallback((entity: Entity<M>, selected: boolean) => {
        handleSelectionChange(entity, selected);
    }, [handleSelectionChange]);

    /**
     * Order by a column, on the same cycle a table header runs: unordered →
     * ascending → descending → unordered. Clicking a header here and clicking it
     * in the table view have to mean the same thing, because they are the same
     * collection under the same controller.
     */
    const onColumnSort = useCallback((key: string) => {
        if (!setSortBy) return;
        const active = sortBy?.[0] === key ? sortBy[1] : undefined;
        const next: [string, "asc" | "desc"] | undefined = active === "asc"
            ? [key, "desc"]
            : active === "desc"
                ? undefined
                : [key, "asc"];
        setSortBy(next);
        // Re-ordering a partially loaded collection invalidates the pages
        // already fetched — they are no longer the rows the query answers with —
        // so pagination starts over, as it does for the table and the sort menu.
        setItemCount?.(pageSize);
    }, [setSortBy, sortBy, setItemCount, pageSize]);

    /**
     * Whether a sort can be offered at all next to the filter already applied.
     * A driver may refuse the combination; the table clears the filter to make
     * room, which is a heavier answer than a header click asks for, so the
     * header simply stops offering it — the same choice the sort menu makes.
     */
    const sortIsAvailable = useCallback((key: string) => {
        if (!setSortBy) return false;
        if (!checkFilterCombination) return true;
        const active = sortBy?.[0] === key ? sortBy[1] : undefined;
        // Clearing the sort is always available: it asks nothing of the driver.
        if (active === "desc") return true;
        return checkFilterCombination(filterValues ?? {}, [key, active === "asc" ? "desc" : "asc"]);
    }, [setSortBy, checkFilterCombination, filterValues, sortBy]);

    const header = (titleColumn || visibleColumns.length > 0) && (
        <ListHeader
            titleColumn={titleColumn}
            columns={visibleColumns}
            selectionEnabled={selectionEnabled && !combineSelection}
            showImage={showImage}
            actionsWidth={actionsWidth}
            sortBy={sortBy as [string, "asc" | "desc"] | undefined}
            onColumnSort={onColumnSort}
            sortIsAvailable={sortIsAvailable}
        />
    );

    return (
        <div ref={containerRef} className="w-full">
            <ListView<Entity<M>>
                data={data}
                dataLoading={dataLoading}
                noMoreToLoad={noMoreToLoad}
                dataLoadingError={dataLoadingError}
                itemCount={itemCount}
                setItemCount={setItemCount}
                pageSize={pageSize}
                paginationEnabled={paginationEnabled}
                onItemClick={handleEntityClick}
                selectedIds={selectedIds}
                highlightedIds={highlightedIds}
                selectionEnabled={selectionEnabled}
                emptyComponent={emptyComponent}
                size={size}
                selectedEntityId={selectedEntityId}
                header={header}
                renderRow={useCallback(({ item: entity, style, className, selected, highlighted, isLast, onClick, onSelectionChange }) => {
                    return (
                        <div
                            key={entity.id}
                            style={style}
                            className={className}
                        >
                            <ListRow
                                entity={entity}
                                collection={resolvedCollection}
                                searchString={searchString}
                                onClick={handleEntityClick}
                                selected={selected}
                                highlighted={highlighted}
                                onSelectionChange={handleRowSelectionChange}
                                selectionEnabled={selectionEnabled}
                                combineSelection={combineSelection}
                                columns={visibleColumns}
                                slotKeys={slotKeys}
                                rowClasses={rowClasses}
                                showImage={showImage}
                                size={size}
                                isLast={isLast}
                                isActive={selectedEntityId !== undefined && entity.id === selectedEntityId}
                                listViewActions={getListViewActions(entity)}
                                actionsWidth={actionsWidth}
                                context={context}
                                path={path}
                                selectionController={selectionController}
                                openEntityMode={openEntityMode}
                            />
                        </div>
                    );
                }, [resolvedCollection, selectionEnabled, combineSelection, visibleColumns, slotKeys, rowClasses, showImage, size, selectedEntityId, getListViewActions, actionsWidth, context, path, selectionController, openEntityMode, handleRowSelectionChange, handleEntityClick, searchString])}
            />
        </div>
    );
}

/**
 * Single row in the list view.
 * Uses the shared slot system for a fixed editorial layout:
 *   [Checkbox] [Image] [Title + Subtitle] → spacer → [Status] [Date]
 *
 * When collection.listProperties is explicitly set, falls back to
 * the column system for developer-defined table layouts.
 */
const ListRow = React.memo(function ListRow<M extends Record<string, unknown>>({
    entity,
    collection,
    onClick,
    selected,
    highlighted,
    onSelectionChange,
    selectionEnabled,
    combineSelection = false,
    columns,
    slotKeys,
    rowClasses,
    showImage,
    size,
    isLast,
    isActive = false,
    listViewActions = [],
    actionsWidth = 0,
    context,
    path,
    selectionController,
    openEntityMode,
    searchString
}: {
    entity: Entity<M>;
    /** The active search, so a row can show where it matched. */
    searchString?: string;
    collection: AdminCollection<M>;
    onClick?: (entity: Entity<M>) => void;
    selected?: boolean;
    highlighted?: boolean;
    onSelectionChange?: (entity: Entity<M>, selected: boolean) => void;
    selectionEnabled?: boolean;
    /**
     * Fold the selection checkbox onto the thumbnail instead of giving it a cell
     * of its own, buying the row back 48px for its title. Set where the row is
     * paying for width it does not have — see the split's compact list in
     * {@link CollectionListViewBinding}.
     */
    combineSelection?: boolean;
    columns: ListColumn[];
    slotKeys: CollectionSlotKeys;
    rowClasses: string;
    showImage: boolean;
    size: CollectionSize;
    isLast: boolean;
    isActive?: boolean;
    listViewActions?: EntityAction[];
    /** Reserved width of the actions cell, shared with the header. */
    actionsWidth?: number;
    context?: ReturnType<typeof useAdminContext>;
    path?: string;
    selectionController?: SelectionController<M>;
    openEntityMode?: "side_panel" | "full_screen" | "split" | "dialog";
}) {
    // ── Resolve slots ──
    // A hook now, not a pure call: a `display` resolver may have to fetch what
    // fills a slot, so the row subscribes to the result and re-renders when it
    // lands. `ListRow` is memoized, which is what keeps that to the one row.
    const slots = useEntitySlots(
        entity as Entity<Record<string, unknown>>,
        collection as AdminCollection<Record<string, unknown>>,
        slotKeys
    );

    // Why is this row here? Shared with cards and board — see SearchExplanation.
    const { terms, offSlot } = useSearchExplanation(
        entity,
        collection.properties as Record<string, unknown>,
        [slotKeys.titleKey, slotKeys.subtitleKey],
        searchString
    );

    const handleClick = useCallback((e: React.MouseEvent) => {
        // Cmd+click (Mac) or Ctrl+click (Windows) toggles selection
        if ((e.metaKey || e.ctrlKey) && selectionEnabled) {
            e.preventDefault();
            onSelectionChange?.(entity, !selected);
            return;
        }
        onClick?.(entity);
    }, [entity, onClick, selected, selectionEnabled, onSelectionChange]);

    const handleCheckboxClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
    }, []);

    const handleCheckboxChange = useCallback((checked: boolean) => {
        onSelectionChange?.(entity, checked);
    }, [entity, onSelectionChange]);

    /** The thumbnail-as-checkbox cell: the square toggles, and never opens the record. */
    const handleSelectionCellClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        onSelectionChange?.(entity, !selected);
    }, [entity, onSelectionChange, selected]);

    // Developer-defined column mode (listProperties is explicitly set)
    const useColumnMode = !!collection.listProperties && collection.listProperties.length > 0;

    return (
        <div
            className={cls(
                "@container flex items-center gap-4 cursor-pointer group transition-colors duration-200 relative h-full",
                rowClasses,
                isActive
                    ? "bg-surface-accent-100 dark:bg-surface-accent-950 hover:bg-surface-accent-200 dark:hover:bg-surface-accent-950"
                    : selected
                        ? "bg-surface-accent-50 dark:bg-surface-accent-900 hover:bg-surface-accent-100 dark:hover:bg-surface-accent-950"
                        : highlighted
                            ? "bg-surface-accent-50 dark:bg-surface-accent-900 hover:bg-surface-50 dark:hover:bg-surface-800/40"
                            : "bg-white dark:bg-surface-900 hover:bg-surface-50 dark:hover:bg-surface-800/40"
            )}
            onClick={handleClick}
        >
            {/* Selection indicator line */}
            {selected && !isActive && (
                <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary-500 rounded-r-full"/>
            )}

            {/* Selection Checkbox — its own cell only when it is not riding on
                the thumbnail. See {@link ListRowProps.combineSelection}. */}
            {selectionEnabled && !combineSelection && (
                <div
                    className="flex-shrink-0 w-8"
                    onClick={handleCheckboxClick}
                >
                    <Checkbox
                        checked={selected ?? false}
                        onCheckedChange={handleCheckboxChange}
                        size="smallest"
                    />
                </div>
            )}

            {/* MEDIA slot → Image / Icon */}
            {showImage && (
                <div className="flex-shrink-0 relative w-10 h-10">
                    {slots.image ? (
                        <div className={cls("w-10 h-10 rounded-lg border relative overflow-hidden bg-surface-100 dark:bg-surface-900", defaultBorderMixin)}>
                            <SlotValue slot={slots.image} size="small" fill={true}/>
                        </div>
                    ) : (
                        <div className={cls("w-10 h-10 rounded-lg bg-surface-100 dark:bg-surface-900 flex items-center justify-center border", defaultBorderMixin)}>
                            <IconForView
                                collectionOrView={collection}
                                className="text-surface-500 dark:text-surface-400"
                                size="small"
                            />
                        </div>
                    )}

                    {/* The checkbox, over the thumbnail rather than beside it.
                        Hidden until the row is hovered or the record is already
                        selected: at rest the cell is the picture it was, and the
                        row spends the reclaimed width on its title instead. The
                        scrim is what makes an unchecked box legible over a photo. */}
                    {selectionEnabled && combineSelection && (
                        <div
                            className={cls(
                                "absolute inset-0 flex items-center justify-center rounded-lg transition-opacity duration-150",
                                "bg-surface-950/55",
                                selected
                                    ? "opacity-100"
                                    : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"
                            )}
                            // The whole square toggles, not just the box drawn in
                            // it: at 40px the cell is the target the pointer is
                            // already over, and a click that lands beside a 16px
                            // checkbox and does nothing reads as a broken row.
                            // The box itself takes no pointer events, so one
                            // click is one toggle — it stays focusable, and space
                            // still works, for the keyboard.
                            onClick={handleSelectionCellClick}
                        >
                            <div className="pointer-events-none">
                                <Checkbox
                                    checked={selected ?? false}
                                    onCheckedChange={handleCheckboxChange}
                                    size="smallest"
                                />
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* PRIMARY slot → Title + subtitle + byline */}
            <div className="flex-1 min-w-0 overflow-hidden">
                <div className="truncate">
                    {slots.title?.value !== undefined ? (
                        <Typography component="div" variant="body2" className="font-semibold text-surface-900 dark:text-surface-50 truncate transition-colors group-hover:text-primary-600 dark:group-hover:text-primary-400">
                            {terms.length > 0 && typeof slots.title?.value === "string"
                                ? <Highlighted text={slots.title.value} terms={terms}/>
                                : <SlotValue slot={slots.title} size="small"/>}
                        </Typography>
                    ) : (
                        <Typography component="div" variant="body2" className="font-semibold text-surface-500 dark:text-surface-400 font-mono text-xs transition-colors group-hover:text-primary-600 dark:group-hover:text-primary-400">
                            {entity.id}
                        </Typography>
                    )}
                </div>

                {/* SUBTITLE slot — or, while searching, where the match was.
                    A hit in a field the row does not display makes the row look
                    arbitrary; the subtitle is the one line already reserved for
                    secondary context, so it carries the explanation instead. */}
                {offSlot ? (
                    <MatchExplanation
                        match={offSlot}
                        label={fieldLabel(collection.properties as Record<string, unknown>, offSlot.field)}
                    />
                ) : slots.subtitle && (
                    <div className="truncate mt-0.5">
                        <Typography variant="caption" component="div" className="text-surface-500 dark:text-surface-400 truncate">
                            {terms.length > 0 && typeof slots.subtitle.value === "string"
                                ? <Highlighted text={slots.subtitle.value} terms={terms}/>
                                : <SlotValue slot={slots.subtitle} size="small"/>}
                        </Typography>
                    </div>
                )}

                {/* RELATION CHIPS slot — compact chips for all relations */}
                {!useColumnMode && slots.relations.length > 0 && (
                    <div className="flex items-center gap-1 mt-1 overflow-hidden max-w-full @max-[350px]:hidden">
                        {slots.relations.map((rel) => (
                            rel.items.map((item) => (
                                <Chip
                                    key={`${rel.propertyKey}-${item.id}`}
                                    size="smallest"
                                    colorScheme={rel.colorScheme}
                                    className="!text-[10px] !leading-tight !py-0 shrink-0 max-w-[120px] truncate"
                                >
                                    {item.displayName}
                                </Chip>
                            ))
                        ))}
                        {slots.relations.some(r => r.totalCount > r.items.length) && (
                            <span className="text-[10px] text-surface-400 dark:text-surface-500 shrink-0">
                                +{slots.relations.reduce((acc, r) => acc + Math.max(0, r.totalCount - r.items.length), 0)}
                            </span>
                        )}
                    </div>
                )}
            </div>

            {/* TRAILING COLUMNS — the same definitions the header labels, in the
                same order and at the same widths, so a label and the values
                under it cannot come apart. */}
            {columns.length > 0 && (
                <div className="flex items-center gap-4 flex-shrink-0 ml-auto">
                    {columns.map((col) => (
                        <div
                            key={col.key}
                            className={cls(
                                col.width,
                                "flex items-center overflow-hidden",
                                col.align === "center" ? "justify-center" : col.align === "right" ? "justify-end" : "justify-start"
                            )}
                        >
                            <ListCell column={col} entity={entity} slots={slots}/>
                        </div>
                    ))}
                </div>
            )}

            {/* LIST VIEW ACTIONS — always visible on each row.
                Width is reserved from the widest row rather than taken from
                this one, so a record with fewer actions does not slide its
                columns out from under the header. */}
            {actionsWidth > 0 && (
                <div className="flex items-center justify-end gap-0.5 flex-shrink-0 ml-auto"
                    style={{ minWidth: actionsWidth }}
                    onClick={(e) => e.stopPropagation()}>
                    {listViewActions.map((action, index) => (
                        <Tooltip key={action.key ?? index} title={action.name} asChild>
                            <IconButton
                                size="small"
                                onClick={(e: React.MouseEvent) => {
                                    e.stopPropagation();
                                    action.onClick({
                                        view: "collection",
                                        entity,
                                        path,
                                        collection,
                                        context: context!,
                                        sidePanelController: context?.sidePanelController,
                                        selectionController,
                                        openEntityMode: openEntityMode ?? collection?.openEntityMode ?? "full_screen"
                                    });
                                }}>
                                {getIcon(action.icon, undefined, undefined, "smallest")}
                            </IconButton>
                        </Tooltip>
                    ))}
                </div>
            )}
        </div>
    );
}) as <M extends Record<string, unknown>>(props: {
    entity: Entity<M>;
    collection: AdminCollection<M>;
    /** The active search, so a row can show where it matched. */
    searchString?: string;
    onClick?: (entity: Entity<M>) => void;
    selected?: boolean;
    highlighted?: boolean;
    onSelectionChange?: (entity: Entity<M>, selected: boolean) => void;
    selectionEnabled?: boolean;
    combineSelection?: boolean;
    columns: ListColumn[];
    slotKeys: CollectionSlotKeys;
    rowClasses: string;
    showImage: boolean;
    size: CollectionSize;
    isLast: boolean;
    isActive?: boolean;
    listViewActions?: EntityAction[];
    /** Reserved width of the actions cell, shared with the header. */
    actionsWidth?: number;
    context?: ReturnType<typeof useAdminContext>;
    path?: string;
    selectionController?: SelectionController<M>;
    openEntityMode?: "side_panel" | "full_screen" | "split" | "dialog";
}) => React.ReactElement;

/**
 * One cell of one row: whatever the column says fills it.
 *
 * A slot column renders the slot — a status keeps its coloured chip and a date
 * its relative wording wherever the value came from — and a property column
 * reads the record. Both go through here so the header above them is labelling
 * one thing, not two that happen to line up.
 */
function ListCell<M extends Record<string, unknown>>({
    column,
    entity,
    slots
}: {
    column: ListColumn;
    entity: Entity<M>;
    slots: EntityPreviewSlots;
}) {
    if (column.slot === "tags") {
        if (!slots.tags) return null;
        return (
            <div className="flex items-center gap-1 overflow-hidden">
                <TagChips slot={slots.tags} max={3}/>
            </div>
        );
    }

    if (column.slot === "status") {
        if (!slots.status) return <EmptyCell/>;
        return <SlotValue slot={slots.status} size="small"/>;
    }

    if (column.slot === "date") {
        return (
            <Typography variant="caption" className="whitespace-nowrap text-surface-400 dark:text-surface-500 font-medium">
                {slots.date?.formatted ?? "—"}
            </Typography>
        );
    }

    const property = column.property;
    if (!property) return null;

    const value = getValueInPath(entity.values, column.key);

    if (property.type === "date") {
        return (
            <Typography variant="caption" className="whitespace-nowrap text-surface-400 dark:text-surface-500 font-medium">
                {formatDateValue(value) ?? "—"}
            </Typography>
        );
    }

    // Complex types → compact single-line summary, so a row keeps its height.
    if (isComplexPropertyType(property)) {
        const summary = compactValueSummary(value, property);
        return (
            <Typography variant="caption" className="text-surface-500 dark:text-surface-400 truncate">
                {summary ?? "—"}
            </Typography>
        );
    }

    if (value === undefined || value === null) return <EmptyCell/>;

    return (
        <Typography component="div" variant="body2" className="text-surface-600 dark:text-surface-300 truncate">
            <PropertyPreview propertyKey={column.key} value={value} property={property} size="small"/>
        </Typography>
    );
}

/** What a column shows for a record that has nothing in it. */
function EmptyCell() {
    return <span className="text-surface-400 dark:text-surface-600">—</span>;
}

/**
 * The list's column header.
 *
 * Quiet by design: a list is read row by row, and the header is there to name
 * the columns and to be clicked, not to compete with the rows. It lays out
 * against the same widths the rows do, and skips the checkbox and the image —
 * neither is a column, and neither has anything to be called.
 */
function ListHeader({
    titleColumn,
    columns,
    selectionEnabled,
    showImage,
    actionsWidth,
    sortBy,
    onColumnSort,
    sortIsAvailable
}: {
    titleColumn?: ListColumn;
    columns: ListColumn[];
    selectionEnabled?: boolean;
    showImage: boolean;
    actionsWidth: number;
    sortBy?: [string, "asc" | "desc"];
    onColumnSort: (key: string) => void;
    sortIsAvailable: (key: string) => boolean;
}) {
    const headerCell = (column: ListColumn) => (
        <ListHeaderLabel
            column={column}
            direction={sortBy?.[0] === column.key ? sortBy[1] : undefined}
            onSort={column.sortable && sortIsAvailable(column.key) ? () => onColumnSort(column.key) : undefined}
        />
    );

    return (
        <div className={cls(
            "flex items-center gap-4 px-5 py-1.5 select-none border-b bg-surface-50 dark:bg-surface-900",
            defaultBorderMixin
        )}>
            {selectionEnabled && <div className="flex-shrink-0 w-8"/>}
            {showImage && <div className="flex-shrink-0 w-10"/>}

            <div className="flex-1 min-w-0 flex items-center">
                {titleColumn && headerCell(titleColumn)}
            </div>

            {columns.length > 0 && (
                <div className="flex items-center gap-4 flex-shrink-0 ml-auto">
                    {columns.map(column => (
                        <div
                            key={column.key}
                            className={cls(
                                column.width,
                                "flex items-center overflow-hidden",
                                column.align === "center" ? "justify-center" : column.align === "right" ? "justify-end" : "justify-start"
                            )}
                        >
                            {headerCell(column)}
                        </div>
                    ))}
                </div>
            )}

            {actionsWidth > 0 && <div className="flex-shrink-0 ml-auto" style={{ minWidth: actionsWidth }}/>}
        </div>
    );
}

/**
 * One header label, clickable when the collection can be ordered by it.
 *
 * The arrow shows only on the column currently ordering the list: three arrows
 * in a header row are three invitations, and only one of them is ever the
 * answer to "how is this sorted".
 */
function ListHeaderLabel({
    column,
    direction,
    onSort
}: {
    column: ListColumn;
    direction?: "asc" | "desc";
    onSort?: () => void;
}) {
    const content = (
        <>
            <span className="truncate">{column.label}</span>
            {direction === "asc" && <ArrowUpIcon size={12} className="flex-shrink-0"/>}
            {direction === "desc" && <ArrowDownIcon size={12} className="flex-shrink-0"/>}
        </>
    );

    const base = "inline-flex items-center gap-1 max-w-full text-[11px] leading-none uppercase tracking-wider font-medium";
    const tone = direction
        ? "text-surface-600 dark:text-surface-300"
        : "text-surface-400 dark:text-surface-500";

    if (!onSort) {
        return <span className={cls(base, tone)}>{content}</span>;
    }

    return (
        <button
            type="button"
            title={`Sort by ${column.label}`}
            onClick={onSort}
            className={cls(base, tone, "cursor-pointer hover:text-surface-700 dark:hover:text-surface-200 transition-colors")}
        >
            {content}
        </button>
    );
}
