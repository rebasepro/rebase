import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Command as CommandPrimitive } from "cmdk";
import {
    CheckIcon,
    Chip,
    CircularProgress,
    CloseIcon,
    cls,
    defaultBorderMixin,
    fieldBackgroundDisabledMixin,
    fieldBackgroundHoverMixin,
    fieldBackgroundInvisibleMixin,
    fieldBackgroundMixin,
    focusedDisabled,
    IconButton,
    KeyboardArrowDownIcon,
    KeyboardTabIcon,
    SearchIcon,
    Separator,
    Tooltip,
    useInjectStyles
} from "@rebasepro/ui";
import { Entity, EntityRelation, FilterValues, Relation } from "@rebasepro/types";
import { EntityPreviewData } from "./EntityPreview";
import { useData, useRelationSelector } from "@rebasepro/core";
import { useSideEntityController } from "../hooks/useSideEntityController";
import { normalizeToEntityRelation } from "@rebasepro/common";
import { EmptyValue } from "../preview";

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
    size?: "small" | "medium";
    useChips?: boolean;
    disabled?: boolean;
    error?: boolean; // kept for backwards compatibility (could be used for styling later)
    padding?: boolean; // legacy prop
    invisible?: boolean;

    relation: Relation;
    forceFilter?: FilterValues<string>;
    pageSize?: number;
    emptyPlaceholder?: string;
    searchPlaceholder?: string;
    noResultsText?: string;
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
            forceFilter,
            pageSize,
            emptyPlaceholder,
            searchPlaceholder = "Search...",
            noResultsText = "No relations found.",
            loadingText = "Loading..."
        },
        ref
    ) => {

        const collection = relation.target();
        const dataClient = useData();
        const sideEntityController = useSideEntityController();
        const multiple = relation.cardinality === "many";

        const [isPopoverOpen, setIsPopoverOpen] = useState(false);
        const [selectedItems, setSelectedItems] = useState<RelationItem[]>([]);
        const [isLoadingSelectedItems, setIsLoadingSelectedItems] = useState(false);
        const [searchString, setSearchString] = useState<string>("");

        const {
            items: availableItems,
            isLoading,
            hasMore,
            search,
            loadMore,
            entityToRelationItem
        } = useRelationSelector({
            path: collection.slug,
            collection,
            forceFilter,
            pageSize
        });

        const scrollContainerRef = useRef<HTMLDivElement>(null);
        const sentinelRef = useRef<HTMLDivElement>(null);
        const observerRef = useRef<IntersectionObserver | null>(null);
        const triggerRef = (ref as React.RefObject<HTMLButtonElement>) || useRef<HTMLButtonElement>(null);
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

        useEffect(() => {
            let active = true;

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

            // Check if every relation already has embedded data
            const allHaveData = relationsArray.length > 0 && relationsArray.every(rel => {
                if (typeof rel === "string" || typeof rel === "number") return false;
                return !!(rel as EntityRelation)?.data;
            });

            // If the IDs haven't changed and we already resolved them, skip entirely
            if (incomingIds === resolvedIdsRef.current && (allHaveData || hasResolvedItemsRef.current)) {
                return;
            }

            // MATCH PATH: selectedItems already cover all incoming IDs.
            // Happens when the user just picked from the dropdown and the server echoes back
            // the value without embedded .data — no need to re-fetch.
            const currentSelected = selectedItemsRef.current;
            if (currentSelected.length > 0 && currentSelected.length === relationsArray.length) {
                const currentIds = new Set(currentSelected.map(item => String(item.id)));
                const allCovered = relationsArray.every(rel => {
                    const isPrimitive = typeof rel === "string" || typeof rel === "number";
                    return currentIds.has(String(isPrimitive ? rel : (rel as EntityRelation).id));
                });
                if (allCovered) {
                    hasResolvedItemsRef.current = true;
                    resolvedIdsRef.current = incomingIds;
                    return;
                }
            }

            // FAST PATH: all data is embedded — resolve synchronously, no loading flash
            if (allHaveData) {
                const toRelationItem = entityToRelationItemRef.current;
                const resolved = relationsArray.map(rel => {
                    const r = rel as EntityRelation;
                    if (r.data) return toRelationItem(r.data, r);
                    return { id: r.id, label: String(r.id), relation: r } as RelationItem;
                });
                setSelectedItems(resolved);
                hasResolvedItemsRef.current = true;
                resolvedIdsRef.current = incomingIds;
                return;
            }

            // SLOW PATH: need to fetch missing data — show loading
            if (value && (!Array.isArray(value) || value.length > 0)) {
                setIsLoadingSelectedItems(true);
            }

            const slug = collectionSlugRef.current;
            const client = dataClientRef.current;
            const toRelationItem = entityToRelationItemRef.current;

            Promise.all(
                relationsArray.map(async (rel) => {
                    const isPrimitive = typeof rel === "string" || typeof rel === "number";
                    const relId = isPrimitive ? rel : (rel as EntityRelation).id;
                    const path = isPrimitive ? slug : (rel as EntityRelation).path;
                    try {
                        let entity = isPrimitive ? undefined : (rel as EntityRelation)?.data;
                        if (!entity) {
                            entity = await client.collection(path).findById(relId);
                        }
                        const relation = isPrimitive ? new EntityRelation(relId, path) : rel as EntityRelation;
                        if (entity) return toRelationItem(entity, relation);
                    } catch (e) {
                        console.warn("RelationSelector: could not fetch entity for relation", rel, e);
                    }
                    const relation = isPrimitive ? new EntityRelation(relId as string | number, path) : rel as EntityRelation;
                    return { id: relId, label: String(relId), relation } as RelationItem;
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
        }, [value]);

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
            }
            setSelectedItems(newSelected);
            emitValueChange(newSelected);
        }, [multiple, selectedItems, emitValueChange]);

        const handleClear = useCallback(() => {
            setSelectedItems([]);
            onValueChange?.(undefined);
        }, [onValueChange]);

        const handleRemoveItem = useCallback((itemToRemove: RelationItem) => {
            const newSelected = selectedItems.filter(v => String(v.id) !== String(itemToRemove.id));
            setSelectedItems(newSelected);
            emitValueChange(newSelected);
        }, [selectedItems, emitValueChange]);

        const handleRootOpenChange = useCallback((next: boolean) => {
            if (disabled) return;
            // We control open manually; only allow opening attempts from Radix (e.g. trigger press)
            if (next) setIsPopoverOpen(true);
            // Ignore close attempts here; outside click/Escape handled manually; single select closes explicitly on selection.
        }, [disabled]);

        // Outside click + Escape handling (simple and reliable)
        useEffect(() => {
            if (!isPopoverOpen) return;

            function handlePointerDown(ev: MouseEvent) {
                const target = ev.target as Node;
                const triggerEl = triggerRef.current;
                const contentEl = contentRef.current;
                if (triggerEl?.contains(target)) return;
                if (contentEl?.contains(target)) return;
                // Outside
                setIsPopoverOpen(false);
            }

            function handleKey(ev: KeyboardEvent) {
                if (ev.key === "Escape") setIsPopoverOpen(false);
            }

            document.addEventListener("mousedown", handlePointerDown, true);
            document.addEventListener("keydown", handleKey, true);
            return () => {
                document.removeEventListener("mousedown", handlePointerDown, true);
                document.removeEventListener("keydown", handleKey, true);
            };
        }, [isPopoverOpen]);

        useInjectStyles("RelationSelector", " [cmdk-group] { max-height: 40vh; overflow-y: auto; } ");

        const closePopover = useCallback(() => {
            setIsPopoverOpen(false);
        }, []);

        const resolvedPlaceholder = placeholder || emptyPlaceholder || <EmptyValue className={"ml-2"} />;

        // Use Sheet portal container if available, otherwise document.body
        const portalContainer = (typeof document !== "undefined" ? document.body : undefined);

        return (
            <>
                <PopoverPrimitive.Root open={isPopoverOpen} onOpenChange={handleRootOpenChange} modal={false}>
                    <PopoverPrimitive.Trigger asChild>
                        <button
                            ref={triggerRef as React.Ref<HTMLButtonElement>}
                            type="button"
                            aria-haspopup="listbox"
                            aria-expanded={isPopoverOpen}
                            data-relation-selector-trigger
                            disabled={disabled}
                            onClick={() => {
                                if (disabled) return;
                                setIsPopoverOpen(o => !o);
                            }}
                            className={cls(
                                {
                                    "min-h-[42px] py-1 px-2": size === "small",
                                    "min-h-[56px] py-2 px-4": size === "medium"
                                },
                                "w-full select-none rounded-md text-sm relative flex items-center",
                                invisible ? fieldBackgroundInvisibleMixin : fieldBackgroundMixin,
                                disabled ? fieldBackgroundDisabledMixin : fieldBackgroundHoverMixin,
                                className
                            )}
                        >
                            <div className="flex justify-between items-center w-full">
                                {isLoadingSelectedItems ? (
                                    <div className="flex items-center gap-2">
                                        <CircularProgress size="smallest" />
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
                                                            <EntityPreviewData size={"medium"}
                                                                entity={item.data}
                                                                includeEntityLink={false}
                                                                includeId={false}
                                                                onSideEntityClick={closePopover}
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
                                                        <EntityPreviewData size={"smallest"} entity={item.data}
                                                            includeEntityLink={false}
                                                            includeId={false} />
                                                    ) : (
                                                        <span className="text-sm truncate">{item.label}</span>
                                                    )}
                                                    <CloseIcon
                                                        size={"smallest"}
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
                                                    sideEntityController.open({
                                                        entityId: entity.id,
                                                        path: entity.path,
                                                        collection,
                                                        updateUrl: true
                                                    });
                                                }}>
                                                <KeyboardTabIcon size={"small"} />
                                            </IconButton>
                                        </Tooltip>
                                    )}
                                    <KeyboardArrowDownIcon
                                        size={size === "medium" ? "medium" : "small"}
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
                            className={cls("z-50 overflow-hidden border bg-white dark:bg-surface-900 rounded-lg min-w-72", defaultBorderMixin)}
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
                                            size="small" />
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
                                            <CircularProgress size="smallest" />
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
                                <Separator orientation="horizontal" className="my-0" />
                                <CommandPrimitive.List
                                    ref={scrollContainerRef}
                                    style={{
                                        maxHeight: "40vh",
                                        overflowY: "auto"
                                    }}
                                >
                                    {isLoading && availableItems.length === 0 && (
                                        <div className="flex items-center justify-center py-6">
                                            <CircularProgress size="small" />
                                            <span
                                                className="ml-2 text-sm text-text-secondary dark:text-text-secondary-dark">{loadingText}</span>
                                        </div>
                                    )}
                                    {!isLoading && availableItems.length === 0 && (
                                        <CommandPrimitive.Empty
                                            className="px-4 py-6 text-center text-text-secondary dark:text-text-secondary-dark">
                                            {noResultsText}
                                        </CommandPrimitive.Empty>
                                    )}
                                    <CommandPrimitive.Group>
                                        {availableItems.map((item) => {
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
                                                    {multiple && (<InnerCheckBox checked={isSelected} />)}
                                                    {item.data ? (
                                                        <div
                                                            className="flex flex-row items-center gap-2 min-w-0 w-full">
                                                            <EntityPreviewData
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
                                                style={{ visibility: "hidden" }} />
                                        )}
                                        {isLoading && availableItems.length > 0 && (
                                            <div className="flex items-center justify-center py-4">
                                                <CircularProgress size="smallest" />
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
                {checked && <CheckIcon size={16} className="absolute" />}
            </div>
        </div>
    );
}
