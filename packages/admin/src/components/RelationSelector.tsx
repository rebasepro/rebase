
import {
    ArrowRightToLineIcon,
    CheckIcon,
    ChevronDownIcon,
    Chip,
    CircularProgress,
    cls,
    defaultBorderMixin,
    fieldBackgroundDisabledMixin,
    fieldBackgroundHoverMixin,
    fieldBackgroundInvisibleMixin,
    fieldBackgroundMixin,
    focusedDisabled,
    IconButton,
    iconSize,
    PopoverPrimitive,
    SearchIcon,
    Separator,
    Tooltip,
    usePortalContainer,
    XIcon
} from "@rebasepro/ui";
import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Entity, EntityRelation, FilterValues, Relation, getCollectionDataPath } from "@rebasepro/types";
import { EntityPreviewBindingData } from "./EntityPreviewBinding";
import { useData, useRelationSelector } from "@rebasepro/app";
import { useSidePanel } from "../hooks/useSidePanel";
import { normalizeToEntityRelation } from "@rebasepro/common";

/** Whether an authored relation yields many rows. Derived from its kind. */
function relationCardinality(relation: { kind?: string; cardinality?: string } | undefined): "one" | "many" | undefined {
    if (!relation) return undefined;
    if (relation.kind === "via") return relation.cardinality as "one" | "many" | undefined;
    if (relation.kind === "hasMany" || relation.kind === "manyToMany") return "many";
    if (relation.kind === "belongsTo" || relation.kind === "hasOne") return "one";
    return relation.cardinality as "one" | "many" | undefined;
}


export interface RelationItem {
    id: string | number;
    label: string;
    description?: string;
    data?: Entity;
    relation: EntityRelation;
}

export interface RelationSelectorProps {
    className?: string;
    name?: string;
    id?: string;
    value?: EntityRelation | EntityRelation[] | null;
    /** Callback returning selected EntityRelation(s) */

    onValueChange?: (updatedValue: EntityRelation | EntityRelation[] | undefined) => void;
    placeholder?: React.ReactNode;
    /**
     * `large` is the form's size and is on the shared 28/32/40/48 control
     * scale, so a relation picker lines up with the text field beside it.
     *
     * `small` and `medium` predate that scale (42 and 56) and are kept as they
     * are because the table cells and the filter row are built around them.
     */
    size?: "small" | "medium" | "large";
    useChips?: boolean;
    disabled?: boolean;
    error?: boolean; // kept for backwards compatibility (could be used for styling later)
    padding?: boolean; // legacy prop
    invisible?: boolean;

    relation: Relation;
    /**
     * Whether the selector picks many rows or one.
     *
     * Defaults to what the relation implies — a `hasMany` or `manyToMany`
     * picks many — which is right wherever the selector *edits* the relation,
     * because there the cardinality is the shape of the stored value.
     *
     * A filter is the case where it is not. `tags == <one tag>` asks a single
     * question about a to-many link, and the operator is what decides how many
     * values it takes. Deriving multiplicity from the relation there meant a
     * to-many relation could only ever emit a list, so the filter field had to
     * hide every single-value operator to avoid handing `==` an array.
     */
    multiple?: boolean;
    fixedFilter?: FilterValues<string>;
    pageSize?: number;
    emptyPlaceholder?: string;
    searchPlaceholder?: string;
    /** Shown in the open list when a search matched nothing. */
    noResultsText?: string;
    /**
     * Shown on the closed trigger when nothing is selected. Says only that the
     * field is empty — see the note by `resolvedPlaceholder` for why it cannot
     * say whether there is anything to pick.
     */
    emptyText?: string;
    /**
     * Shown in the open list when the target collection turned out to hold no
     * rows at all, as opposed to a search simply not matching. Defaults to a
     * sentence naming the target collection.
     */
    emptyCollectionText?: string;
    loadingText?: string;
}

export const RelationSelector = React.forwardRef<
    HTMLButtonElement,
    RelationSelectorProps
>(
    (
        {
            value,
            size = "medium",
            onValueChange,
            invisible,
            disabled,
            placeholder,
            useChips = true,
            className,
            relation,
            multiple: multipleOverride,
            fixedFilter,
            pageSize,
            emptyPlaceholder,
            searchPlaceholder = "Search...",
            noResultsText = "No matches.",
            emptyText = "Select…",
            emptyCollectionText,
            loadingText = "Loading..."
        },
        ref
    ) => {

        const collection = relation.target();
        const dataClient = useData();
        const sidePanelController = useSidePanel();
        const contextPortalContainer = usePortalContainer();
        const multiple = multipleOverride ?? relationCardinality(relation) === "many";

        const [isPopoverOpen, setIsPopoverOpen] = useState(false);
        const isPopoverOpenRef = useRef(false);
        // The list is only worth fetching once the picker has been opened. A
        // table cell mounts one of these per row, and the selected value is
        // resolved by its own effect below, not from the list. Latches on the
        // first open so a closed popover keeps its results.
        const [listRequested, setListRequested] = useState(false);
        const [selectedItems, setSelectedItems] = useState<RelationItem[]>([]);
        const [isLoadingSelectedItems, setIsLoadingSelectedItems] = useState(false);
        const [searchString, setSearchString] = useState<string>("");
        // Track IDs that were set via local user interaction (onItemClick / handleClear / handleRemoveItem).
        // When an incoming value change matches these IDs exactly, we skip async re-resolution.
        const localSelectionIdsRef = useRef<string | null>(null);
        // Entity of selected IDs captured when the popover opens.
        // Used to sort the dropdown list so selected items appear at the top.
        // Stays stable for the entire popover session so items don't jump around.
        const pinnedIdsRef = useRef<Set<string> | null>(null);

        const {
            items: availableItems,
            isLoading,
            hasMore,
            search,
            loadMore,
            entityToRelationItem
        } = useRelationSelector({
            path: getCollectionDataPath(collection),
            collection,
            fixedFilter,
            pageSize,
            enabled: listRequested
        });

        const scrollContainerRef = useRef<HTMLDivElement>(null);
        const sentinelRef = useRef<HTMLDivElement>(null);
        const observerRef = useRef<IntersectionObserver | null>(null);
        const localTriggerRef = useRef<HTMLButtonElement | null>(null);

        const handleButtonRef = useCallback((node: HTMLButtonElement | null) => {
            localTriggerRef.current = node;
            if (typeof ref === "function") {
                ref(node);
            } else if (ref) {
                ref.current = node;
            }
        }, [ref]);
        const contentRef = useRef<HTMLDivElement | null>(null);
        const searchInputRef = useRef<HTMLInputElement | null>(null);

        // Keep stable refs for dependencies used in the value-resolution effect
        // so the effect only re-fires when the actual `value` identity changes.
        const dataClientRef = useRef(dataClient);
        dataClientRef.current = dataClient;
        const entityToRelationItemRef = useRef(entityToRelationItem);
        entityToRelationItemRef.current = entityToRelationItem;
        const collectionSlugRef = useRef(collection.slug);
        collectionSlugRef.current = collection.slug;

        // Stable ref to track which IDs we've already resolved
        const resolvedIdsRef = useRef<string>("");
        // Track whether we have resolved items (used for skip guard without adding to deps)
        const hasResolvedItemsRef = useRef(false);

        const selectedItemsRef = useRef(selectedItems);
        selectedItemsRef.current = selectedItems;

        // Normalize incoming values — plain { __type: "relation" } objects
        // from the server are converted to proper EntityRelation instances.
        const rawArray = !value ? [] : Array.isArray(value) ? value : [value];
        const relationsArray = rawArray.map(rel => {
            if (typeof rel === "string" || typeof rel === "number") return rel;
            return normalizeToEntityRelation(rel) ?? rel;
        });

        // Build a fingerprint of the incoming value's IDs
        const incomingIds = relationsArray
            .map(rel => {
                const isPrimitive = typeof rel === "string" || typeof rel === "number";
                return String(isPrimitive ? rel : (rel as EntityRelation).id);
            })
            .sort()
            .join(",");

        // CheckIcon if every relation already has embedded data
        const allHaveData = relationsArray.length > 0 && relationsArray.every(rel => {
            if (typeof rel === "string" || typeof rel === "number") return false;
            return !!(rel as EntityRelation)?.data;
        });

        const relationsArrayRef = useRef(relationsArray);
        relationsArrayRef.current = relationsArray;

        useEffect(() => {
            let active = true;
            const currentRelationsArray = relationsArrayRef.current;

            // If the IDs haven't changed and we already resolved them, skip entirely
            if (incomingIds === resolvedIdsRef.current && (allHaveData || hasResolvedItemsRef.current)) {
                return;
            }

            // FAST PATH: If the incoming IDs match what we just set locally via user interaction,
            // our selectedItems already have the correct data — no re-resolution needed.
            if (localSelectionIdsRef.current !== null && incomingIds === localSelectionIdsRef.current) {
                resolvedIdsRef.current = incomingIds;
                hasResolvedItemsRef.current = true;
                // Do NOT call setSelectedItems or setIsLoadingSelectedItems — they are already correct.
                return;
            }

            const currentSelected = selectedItemsRef.current;
            const currentSelectedMap = new Map(currentSelected.map(item => [String(item.id), item]));

            let allCovered = true;
            const newResolvedItems: RelationItem[] = [];
            const toRelationItem = entityToRelationItemRef.current;
            const slug = collectionSlugRef.current;

            for (const rel of currentRelationsArray) {
                const isPrimitive = typeof rel === "string" || typeof rel === "number";
                const relId = String(isPrimitive ? rel : (rel as EntityRelation).id);
                const hasEmbeddedData = !isPrimitive && !!(rel as EntityRelation).data;

                if (hasEmbeddedData) {
                    const r = rel as EntityRelation;
                    // admin wire format embeds relation data as { id, path, values }
                    newResolvedItems.push(toRelationItem(r.data as unknown as Entity, r));
                } else if (currentSelectedMap.has(relId)) {
                    // We already have it in currentSelected
                    const existingItem = currentSelectedMap.get(relId)!;
                    newResolvedItems.push(existingItem);
                } else {
                    allCovered = false;
                    break;
                }
            }

            // FAST PATH: We have all necessary data embedded or in local cache
            if (allCovered) {
                setSelectedItems(newResolvedItems);
                hasResolvedItemsRef.current = true;
                resolvedIdsRef.current = incomingIds;
                setIsLoadingSelectedItems(false);
                return;
            }

            // SLOW PATH: fetch missing data — but don't show loading if popover is open
            // (user is actively interacting; showing a spinner is disruptive)
            if (!isPopoverOpenRef.current) {
                setIsLoadingSelectedItems(true);
            }
            const client = dataClientRef.current;

            Promise.all(
                currentRelationsArray.map(async (rel) => {
                    const isPrimitive = typeof rel === "string" || typeof rel === "number";
                    const relId = isPrimitive ? rel : (rel as EntityRelation).id;
                    const path = isPrimitive ? slug : (rel as EntityRelation).path;
                    const relation = isPrimitive ? new EntityRelation(relId, path) : rel as EntityRelation;

                    if (!isPrimitive && (rel as EntityRelation).data) {
                        // admin wire format embeds relation data as { id, path, values }
                        return toRelationItem((rel as EntityRelation).data as unknown as Entity, relation);
                    }
                    if (currentSelectedMap.has(String(relId))) {
                        return currentSelectedMap.get(String(relId))!;
                    }

                    try {
                        const entity = await client.collection(path).findById(relId);
                        if (entity) return toRelationItem(entity, relation);
                    } catch (e) {
                        console.warn("RelationSelector: could not fetch entity for relation", rel, e);
                    }
                    return { id: relId,
label: String(relId),
relation } as RelationItem;
                })
            ).then(resolved => {
                if (active) {
                    setSelectedItems(resolved);
                    setIsLoadingSelectedItems(false);
                    hasResolvedItemsRef.current = true;
                    resolvedIdsRef.current = incomingIds;
                }
            });

            return () => {
                active = false;
            };
        }, [incomingIds, allHaveData]);

        const sentinelCallbackRef = useCallback((node: HTMLDivElement | null) => {
            if (observerRef.current) {
                observerRef.current.disconnect();
                observerRef.current = null;
            }
            if (sentinelRef.current !== node) {
                (sentinelRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
            }
            if (!node || !hasMore || isLoading || !loadMore) return;
            const observer = new IntersectionObserver(
                (entries) => {
                    const entry = entries[0];
                    if (entry.isIntersecting && hasMore && !isLoading) loadMore();
                },
                {
                    root: scrollContainerRef.current,
                    rootMargin: "20px",
                    threshold: 0
                }
            );
            observer.observe(node);
            observerRef.current = observer;
        }, [hasMore, isLoading, loadMore]);

        useEffect(() => () => {
            if (observerRef.current) observerRef.current.disconnect();
        }, []);

        // Enhanced scroll event listener specifically for dialog contexts
        useEffect(() => {
            const scrollContainer = scrollContainerRef.current;
            if (!scrollContainer || !hasMore || isLoading || !isPopoverOpen) return;

            const handleScroll = () => {
                const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
                const isNearBottom = scrollTop + clientHeight >= scrollHeight - 100;

                if (isNearBottom && hasMore && !isLoading) {
                    loadMore();
                }
            };

            // Add scroll listener directly to the container
            scrollContainer.addEventListener("scroll", handleScroll, { passive: true });

            return () => {
                scrollContainer.removeEventListener("scroll", handleScroll);
            };
        }, [hasMore, isLoading, loadMore, isPopoverOpen]);

        const handleSearchChange = useCallback((newSearchString: string) => {
            setSearchString(newSearchString);
            search(newSearchString);
        }, [search]);

        const emitValueChange = useCallback((selected: RelationItem[]) => {
            if (multiple) onValueChange?.(selected.length ? selected.map(i => i.relation) : undefined);
            else onValueChange?.(selected[0]?.relation);
        }, [onValueChange, multiple]);

        // Helper: compute the "IDs fingerprint" for a set of RelationItems
        // so we can mark it in localSelectionIdsRef and skip re-resolution.
        const computeSelectionFingerprint = useCallback((items: RelationItem[]): string => {
            return items.map(i => String(i.id)).sort().join(",");
        }, []);

        const onItemClick = useCallback((item: RelationItem) => {
            let newSelected: RelationItem[];
            if (multiple) {
                const isSelected = selectedItems.some(v => String(v.id) === String(item.id));
                newSelected = isSelected
                    ? selectedItems.filter(v => String(v.id) !== String(item.id))
                    : [...selectedItems, item];
            } else {
                newSelected = [item];
                setIsPopoverOpen(false);
                isPopoverOpenRef.current = false;
                pinnedIdsRef.current = null;
            }
            setSelectedItems(newSelected);
            // Mark this fingerprint so the resolution effect skips async work
            // when the parent echoes the same IDs back via props.
            localSelectionIdsRef.current = computeSelectionFingerprint(newSelected);
            emitValueChange(newSelected);
        }, [multiple, selectedItems, emitValueChange, computeSelectionFingerprint]);

        const handleClear = useCallback(() => {
            setSelectedItems([]);
            localSelectionIdsRef.current = "";
            onValueChange?.(undefined);
        }, [onValueChange]);

        const handleRemoveItem = useCallback((itemToRemove: RelationItem) => {
            const newSelected = selectedItems.filter(v => String(v.id) !== String(itemToRemove.id));
            setSelectedItems(newSelected);
            localSelectionIdsRef.current = computeSelectionFingerprint(newSelected);
            emitValueChange(newSelected);
        }, [selectedItems, emitValueChange, computeSelectionFingerprint]);

        const handleRootOpenChange = useCallback((next: boolean) => {
            if (disabled) return;
            // We control open manually; only allow opening attempts from Radix (e.g. trigger press)
            if (next) {
                // Capture current selection so we can pin those items to the top of the list
                pinnedIdsRef.current = new Set(selectedItems.map(i => String(i.id)));
                setListRequested(true);
                setIsPopoverOpen(true);
                isPopoverOpenRef.current = true;
            }
            // Ignore close attempts here; outside click/Escape handled manually; single select closes explicitly on selection.
        }, [disabled, selectedItems]);

        // Outside click + Escape handling (simple and reliable)
        useEffect(() => {
            if (!isPopoverOpen) return;

            function handlePointerDown(ev: MouseEvent) {
                const target = ev.target as Node;
                const triggerEl = localTriggerRef.current;
                const contentEl = contentRef.current;
                if (triggerEl?.contains(target)) return;
                if (contentEl?.contains(target)) return;
                // Outside
                setIsPopoverOpen(false);
                isPopoverOpenRef.current = false;
                pinnedIdsRef.current = null;
            }

            function handleKey(ev: KeyboardEvent) {
                if (ev.key === "Escape") {
                    setIsPopoverOpen(false);
                    isPopoverOpenRef.current = false;
                    pinnedIdsRef.current = null;
                }
            }

            document.addEventListener("mousedown", handlePointerDown, true);
            document.addEventListener("keydown", handleKey, true);
            return () => {
                document.removeEventListener("mousedown", handlePointerDown, true);
                document.removeEventListener("keydown", handleKey, true);
            };
        }, [isPopoverOpen]);

        const closePopover = useCallback(() => {
            setIsPopoverOpen(false);
            isPopoverOpenRef.current = false;
            pinnedIdsRef.current = null;
        }, []);

        // Text, not `EmptyValue`. That component draws a small grey rounded bar
        // with no text in it, which is the same shape the `Skeleton` component
        // uses while data is in flight — so a relation you simply had not filled
        // in was indistinguishable from one that was still loading, and an empty
        // Author or Tags field read as permanently stuck. It also left the trigger
        // button with no accessible name, since the bar contains no text at all.
        //
        // This says "not filled in" rather than "nothing to choose from": which of
        // those it is cannot be known here. The list is deliberately not fetched
        // until the picker is first opened (`enabled: listRequested`, guarded by
        // relation_cell_picker_gating.test.tsx, because a table renders one of
        // these per row), so before that `availableItems` is empty because nobody
        // asked, not because the target collection is. The genuine "nothing to
        // pick yet" state is reported inside the popover below, where the fetch
        // has actually happened.
        const resolvedPlaceholder = placeholder || emptyPlaceholder || emptyText;

        // Whatever dialog, side dialog or sheet we are inside offers as its
        // portal host, falling back to `document.body`. This is not cosmetic:
        // those are modal, and a modal locks scrolling everywhere outside its
        // own content — a list portaled to the body opens and then refuses to
        // scroll, because every wheel event over it is cancelled.
        const portalContainer = (contextPortalContainer ?? (typeof document !== "undefined" ? document.body : undefined)) ?? undefined;

        return (
            <>
                <PopoverPrimitive.Root open={isPopoverOpen} onOpenChange={handleRootOpenChange} modal={false}>
                    <PopoverPrimitive.Trigger asChild>
                        <button
                            ref={handleButtonRef}
                            type="button"
                            aria-haspopup="listbox"
                            aria-expanded={isPopoverOpen}
                            data-relation-selector-trigger
                            disabled={disabled}
                            onClick={() => {
                                if (disabled) return;
                                // Unconditional: the toggle can only close a
                                // popover that was opened, which requested the
                                // list already.
                                setListRequested(true);
                                setIsPopoverOpen(o => {
                                    const next = !o;
                                    isPopoverOpenRef.current = next;
                                    if (next) {
                                        pinnedIdsRef.current = new Set(selectedItems.map(i => String(i.id)));
                                    } else {
                                        pinnedIdsRef.current = null;
                                    }
                                    return next;
                                });
                            }}
                            className={cls(
                                {
                                    "min-h-[42px] py-1 px-2": size === "small",
                                    "min-h-[56px] py-2 px-4": size === "medium",
                                    "min-h-[48px] py-1 px-4": size === "large"
                                },
                                // `rounded-lg` like every other field box —
                                // `rounded-md` made this the one control in a
                                // row with a different corner.
                                "w-full select-none rounded-lg text-sm relative flex items-center",
                                invisible ? fieldBackgroundInvisibleMixin : fieldBackgroundMixin,
                                disabled ? fieldBackgroundDisabledMixin : fieldBackgroundHoverMixin,
                                className
                            )}
                        >
                            <div className="flex justify-between items-center w-full">
                                {isLoadingSelectedItems ? (
                                    <div className="flex items-center gap-2">
                                        <CircularProgress size="smallest"/>
                                        <span className="text-sm text-text-secondary dark:text-text-secondary-dark">{loadingText}</span>
                                    </div>
                                ) : selectedItems.length > 0 ? (
                                    <div
                                        className="flex flex-wrap items-center gap-1.5 text-start flex-1 min-w-0 mr-2">
                                        {selectedItems.map((item) => {
                                            if (!useChips || !multiple) {

                                                return (
                                                    <div key={String(item.id)}
                                                        className="flex flex-row items-center gap-1 truncate">
                                                        {item.data ? (
                                                            <EntityPreviewBindingData size={"medium"}
                                                                entity={item.data}
                                                                includeEntityLink={false}
                                                                includeId={false}
                                                                onSidePanelClick={closePopover}
                                                            />
                                                        ) : (
                                                            <span className="text-sm truncate">{item.label}</span>
                                                        )}
                                                    </div>
                                                );
                                            }
                                            return (
                                                <Chip
                                                    size={"small"}
                                                    key={String(item.id)}
                                                    className={cls("flex flex-row items-center gap-1 truncate")}
                                                >
                                                    {item.data ? (
                                                        <EntityPreviewBindingData size={"smallest"} entity={item.data}
                                                            includeEntityLink={false}
                                                            includeId={false}/>
                                                    ) : (
                                                        <span className="text-sm truncate">{item.label}</span>
                                                    )}
                                                    <XIcon
                                                        size={iconSize.smallest}
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            handleRemoveItem(item);
                                                        }}
                                                    />
                                                </Chip>
                                            );
                                        })}
                                    </div>
                                ) :
                                    (
                                        <span className="text-sm text-text-secondary dark:text-text-secondary-dark">
                                            {resolvedPlaceholder}
                                        </span>
                                    )}

                                <div className="flex items-center flex-shrink-0">
                                    {!multiple && selectedItems.length === 1 && selectedItems[0]?.data && (
                                        <Tooltip title={`Open ${selectedItems[0].label}`}>
                                            <IconButton
                                                component={"div"}
                                                size={"small"}
                                                color={"inherit"}
                                                className="opacity-60 hover:opacity-100"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    e.preventDefault();
                                                    const entity = selectedItems[0].data!;
                                                    setIsPopoverOpen(false);
                                                    sidePanelController.open({
                                                        entityId: entity.id,
                                                        path: entity.path,
                                                        collection,
                                                        updateUrl: true
                                                    });
                                                }}>
                                                <ArrowRightToLineIcon size={iconSize.small}/>
                                            </IconButton>
                                        </Tooltip>
                                    )}
                                    <ChevronDownIcon
                                        size={size === "small" ? iconSize.small : iconSize.medium}
                                        className={cls("transition", isPopoverOpen ? "rotate-180" : "")}
                                    />
                                </div>
                            </div>

                        </button>
                    </PopoverPrimitive.Trigger>
                    <PopoverPrimitive.Portal container={portalContainer}>
                        <PopoverPrimitive.Content
                            ref={contentRef}
                            data-relation-selector-content
                            className={cls("z-50 overflow-hidden border bg-white dark:bg-surface-800 rounded-lg min-w-72", defaultBorderMixin)}
                            align="start"
                            sideOffset={8}
                            side="bottom"
                            avoidCollisions={true}
                            collisionPadding={16}
                            // Allow default auto focus (we manually refocus anyway)
                            onOpenAutoFocus={(_e) => { /* leave default or custom manual focus */
                            }}
                            onCloseAutoFocus={(e) => {
                                e.preventDefault();
                            }}
                            style={{ width: "var(--radix-popover-trigger-width)" }}
                        >
                            <CommandPrimitive shouldFilter={false}>
                                <div className="flex flex-row items-center">
                                    <div className="relative flex-1">
                                        <SearchIcon
                                            className="absolute left-3 top-1/2 transform -translate-y-1/2 text-text-secondary dark:text-text-secondary-dark"
                                            size={iconSize.smallest}/>
                                        <CommandPrimitive.Input
                                            ref={searchInputRef}
                                            className={cls(
                                                focusedDisabled,
                                                "bg-transparent outline-hidden flex-1 h-full w-full pl-10 pr-4 py-3 text-text-primary dark:text-text-primary-dark placeholder:text-text-secondary dark:placeholder:text-text-secondary-dark"
                                            )}
                                            placeholder={searchPlaceholder}
                                            value={searchString}
                                            onValueChange={handleSearchChange}
                                        />
                                    </div>
                                    {isLoading && (
                                        <div className="flex items-center justify-center px-3">
                                            <CircularProgress size="smallest"/>
                                        </div>
                                    )}
                                    {selectedItems.length > 0 && (
                                        <div
                                            onClick={handleClear}
                                            className="text-sm justify-center cursor-pointer py-3 px-4 text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark"
                                        >
                                            Clear
                                        </div>
                                    )}
                                </div>
                                <Separator orientation="horizontal" className="my-0"/>
                                <CommandPrimitive.List
                                    ref={scrollContainerRef}
                                    style={{
                                        maxHeight: "40vh",
                                        overflowY: "auto"
                                    }}
                                >
                                    {isLoading && availableItems.length === 0 && (
                                        <div className="flex items-center justify-center py-6">
                                            <CircularProgress size="small"/>
                                            <span
                                                className="ml-2 text-sm text-text-secondary dark:text-text-secondary-dark">{loadingText}</span>
                                        </div>
                                    )}
                                    {/* Two different nothings, which used to share one
                                        message ("No relations found.") even though the
                                        fix for each is the opposite: clear the search, or
                                        go and create the first row. With the fetch done,
                                        the search string is what tells them apart. */}
                                    {!isLoading && availableItems.length === 0 && (
                                        <CommandPrimitive.Empty
                                            className="px-4 py-6 text-center text-text-secondary dark:text-text-secondary-dark">
                                            {searchString
                                                ? noResultsText
                                                : (emptyCollectionText ?? `No ${collection.name ?? "entries"} yet.`)}
                                        </CommandPrimitive.Empty>
                                    )}
                                    <CommandPrimitive.Group>
                                        {(() => {
                                            // Sort items so that initially-selected (pinned) items appear first.
                                            // We use the entity taken when the popover opened so items don't
                                            // jump around as the user checks/unchecks.
                                            const pinned = pinnedIdsRef.current;
                                            const sortedItems = pinned && pinned.size > 0
                                                ? [...availableItems].sort((a, b) => {
                                                    const aP = pinned.has(String(a.id)) ? 0 : 1;
                                                    const bP = pinned.has(String(b.id)) ? 0 : 1;
                                                    return aP - bP;
                                                })
                                                : availableItems;
                                            return sortedItems;
                                        })().map((item) => {
                                            const isSelected = selectedItems.some(v => String(v.id) === String(item.id));
                                            return (
                                                <CommandPrimitive.Item
                                                    key={String(item.id)}
                                                    value={String(item.id)}
                                                    onMouseDown={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                    }}
                                                    onSelect={() => onItemClick(item)}
                                                    className={cls(
                                                        "flex flex-row items-center gap-1.5 m-1 p-1 rounded-xs cursor-pointer ring-offset-transparent",
                                                        isSelected && "bg-surface-accent-200 dark:bg-surface-accent-950",
                                                        "aria-selected:outline-hidden aria-selected:ring-2 aria-selected:ring-primary/75 aria-selected:ring-offset-2 aria-selected:bg-surface-accent-100 dark:aria-selected:bg-surface-accent-900"
                                                    )}
                                                >
                                                    {multiple && (<InnerCheckBox checked={isSelected}/>)}
                                                    {item.data ? (
                                                        <div
                                                            className="flex flex-row items-center gap-2 min-w-0 w-full">
                                                            <EntityPreviewBindingData
                                                                size={multiple ? "smallest" : "medium"}
                                                                entity={item.data}
                                                                includeId={false}
                                                                includeEntityLink={true}
                                                            />
                                                        </div>
                                                    ) : (
                                                        <div>
                                                            <div
                                                                className="text-sm font-medium text-text-primary dark:text-text-primary-dark">{item.label}</div>
                                                            {item.description && (
                                                                <div
                                                                    className="text-xs text-text-secondary dark:text-text-secondary-dark">{item.description}</div>
                                                            )}
                                                        </div>
                                                    )}
                                                </CommandPrimitive.Item>
                                            );
                                        })}
                                        {availableItems.length > 0 && hasMore && (
                                            <div ref={sentinelCallbackRef} className="h-1 w-full"
                                                style={{ visibility: "hidden" }}/>
                                        )}
                                        {isLoading && availableItems.length > 0 && (
                                            <div className="flex items-center justify-center py-4">
                                                <CircularProgress size="smallest"/>
                                                <span
                                                    className="ml-2 text-xs text-text-secondary dark:text-text-secondary-dark">Loading...</span>
                                            </div>
                                        )}
                                    </CommandPrimitive.Group>
                                </CommandPrimitive.List>
                            </CommandPrimitive>
                        </PopoverPrimitive.Content>
                    </PopoverPrimitive.Portal>
                </PopoverPrimitive.Root>
            </>
        );
    }
);

RelationSelector.displayName = "RelationSelector";

function InnerCheckBox({ checked }: { checked: boolean }) {
    return (
        <div className={cls(
            "p-2 w-8 h-8 inline-flex items-center justify-center text-sm font-medium focus:outline-hidden transition-colors ease-in-out duration-150"
        )}>
            <div
                className={cls(
                    "border-2 relative transition-colors ease-in-out duration-150 w-4 h-4 rounded-xs flex items-center justify-center",
                    checked ? "bg-primary text-surface-accent-100 dark:text-surface-accent-900 border-transparent" : "bg-white dark:bg-surface-accent-900 border-surface-accent-800 dark:border-surface-accent-200"
                )}
            >
                {checked && <CheckIcon size={iconSize.smallest} className="absolute"/>}
            </div>
        </div>
    );
}
