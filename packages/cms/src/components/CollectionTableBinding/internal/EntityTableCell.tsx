import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cls, Tooltip, iconSize } from "@rebasepro/ui";
import { ErrorBoundary, MinusCircleIcon } from "@rebasepro/ui";
import { getRowHeight, TableSize } from "@rebasepro/app";
import { ErrorTooltip } from "@rebasepro/app";
import { TableCellOpener, TableCellOpenerKind } from "./TableCellOpener";
import { RowEntityPreviewLayout } from "../../EntityPreviewNesting";

export interface EntityTableCellOpener {
    kind: TableCellOpenerKind;
    open: boolean;
    /** See {@link TableCellOpener}'s `focusOnSelect`. */
    focusOnSelect: boolean;
    label: string;
    /**
     * Whether the editor should now be open, and the cell's rect for editors
     * positioned against it. The cell is selected before this is called.
     */
    onToggle: (open: boolean, cellRect: DOMRect | undefined) => void;
}

export interface EntityTableCellProps {
    children: React.ReactNode;
    actions?: React.ReactNode;
    /**
     * The value is used only to check changes and force re-renders
     */
    value?: unknown;
    disabled: boolean;
    savedTimestamp?: number;
    error?: Error;
    allowScroll?: boolean;
    align: "right" | "left" | "center";
    size: TableSize;
    disabledTooltip?: string;
    width: number;
    showExpandIcon?: boolean;
    removePadding?: boolean;
    fullHeight?: boolean;
    selected?: boolean;
    hideOverflow?: boolean;
    /**
     * The control that opens the cell's editor, revealed on hover and kept
     * shown while the cell is selected. The cell keeps a slot for it at its
     * trailing edge either way, so it never moves the value.
     */
    opener?: EntityTableCellOpener;
    /** The cell's element, for editors that float and are positioned against it. */
    cellRef?: React.RefObject<HTMLDivElement | null>;
    onSelect?: (cellRect: DOMRect | undefined) => void;
    // Sortable props for dnd-kit integration
    sortableNodeRef?: (node: HTMLElement | null) => void;
    sortableStyle?: React.CSSProperties;
    sortableAttributes?: Record<string, string | number | undefined>;
    isDragging?: boolean;
    isDraggable?: boolean;
    frozen?: boolean;
}

/**
 * One ResizeObserver for every table cell, instead of one per cell.
 *
 * A cell measures its content only to know whether it overflows the row (to
 * fade it, or let it scroll). Each cell ran `react-use-measure` for that: a
 * ResizeObserver, two window listeners, a `getComputedStyle` walk up every
 * ancestor and an extra render once the first measurement landed — ~460 of
 * each for one screen of a 20-column table, and more with every row scrolled
 * in. The observer is created on first use and lives for the page; a cell
 * registers on mount and unregisters on unmount, so nothing is retained for
 * a cell that is gone.
 */
let sharedHeightObserver: ResizeObserver | undefined;
const heightListeners = new Map<Element, (height: number) => void>();

function observeHeight(element: Element, onHeight: (height: number) => void): () => void {
    if (typeof ResizeObserver === "undefined") return () => undefined;
    if (!sharedHeightObserver) {
        sharedHeightObserver = new ResizeObserver((entries) => {
            for (const entry of entries)
                heightListeners.get(entry.target)?.(entry.contentRect.height);
        });
    }
    heightListeners.set(element, onHeight);
    sharedHeightObserver.observe(element);
    return () => {
        heightListeners.delete(element);
        sharedHeightObserver?.unobserve(element);
    };
}

/** How many cells are being measured right now — for tests. */
export function measuredTableCellCount(): number {
    return heightListeners.size;
}

/**
 * Whether the element given to the returned ref is taller than `maxHeight`.
 * State changes only when the answer does, so a cell whose content fits is
 * never drawn again by its measurement.
 */
function useOverflowsHeight(maxHeight: number): [(element: HTMLDivElement | null) => void, boolean] {
    const [overflowing, setOverflowing] = useState(false);
    const heightRef = useRef(0);
    const maxHeightRef = useRef(maxHeight);
    const stopRef = useRef<(() => void) | undefined>(undefined);

    useEffect(() => {
        maxHeightRef.current = maxHeight;
        setOverflowing(heightRef.current > maxHeight);
    }, [maxHeight]);

    useEffect(() => () => {
        stopRef.current?.();
        stopRef.current = undefined;
    }, []);

    const ref = useCallback((element: HTMLDivElement | null) => {
        stopRef.current?.();
        stopRef.current = undefined;
        if (!element) return;
        stopRef.current = observeHeight(element, (height) => {
            heightRef.current = height;
            setOverflowing(height > maxHeightRef.current);
        });
    }, []);

    return [ref, overflowing];
}

type TableCellInnerProps = {
    justifyContent: string;
    scrollable: boolean;
    faded: boolean;
    fullHeight: boolean;
    children: React.ReactNode;
}

const TableCellInner = ({
    justifyContent,
    scrollable,
    faded,
    fullHeight,
    children
}: TableCellInnerProps) => {
    return (
        <div className={cls("flex flex-col max-h-full w-full",
            {
                "items-start": faded || scrollable
            })}
            style={{
                justifyContent,
                height: fullHeight ? "100%" : undefined,
                overflow: scrollable ? "auto" : undefined,
                WebkitMaskImage: faded
                    ? "linear-gradient(to bottom, black 60%, transparent 100%)"
                    : undefined,
                maskImage: faded
                    ? "linear-gradient(to bottom, black 60%, transparent 100%)"
                    : undefined
            }}
        >
            {children}
        </div>
    );
};

export const EntityTableCell = React.memo<EntityTableCellProps>(
    function EntityTableCell({
        children,
        actions,
        size,
        selected,
        disabled,
        disabledTooltip,
        savedTimestamp,
        error,
        align,
        allowScroll,
        removePadding,
        fullHeight,
        opener,
        cellRef,
        onSelect,
        width,
        hideOverflow = true,
        showExpandIcon = true,
        sortableNodeRef,
        sortableStyle,
        sortableAttributes,
        isDragging,
        isDraggable,
        frozen
    }: EntityTableCellProps) {

        const internalRef = useRef<HTMLDivElement>(null);
        const ref = cellRef ?? internalRef;

        const maxHeight = useMemo(() => getRowHeight(size), [size]);
        const [measureRef, isOverflowing] = useOverflowsHeight(maxHeight);

        const [onHover, setOnHover] = useState(false);
        const [showSaved, setShowSaved] = useState(false);

        const showError = !disabled && Boolean(error);

        useEffect(() => {
            if (savedTimestamp && savedTimestamp > 0) {
                setShowSaved(true);
                const handler = setTimeout(() => {
                    setShowSaved(false);
                }, 400);
                return () => {
                    clearTimeout(handler);
                };
            }
            return undefined;
        }, [savedTimestamp]);

        let p = 0;
        if (!removePadding) {
            switch (size) {
                case "l":
                case "xl":
                    p = 4;
                    break;
                case "m":
                    p = 2;
                    break;
                case "s":
                default:
                    p = 1;
                    break;
            }
        }

        let justifyContent;
        switch (align) {
            case "right":
                justifyContent = "flex-end";
                break;
            case "center":
                justifyContent = "center";
                break;
            case "left":
            default:
                justifyContent = "flex-start";
        }

        // const onClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        //     if (event.detail === 3) {
        //         doOpenPopup();
        //     }
        // }, [doOpenPopup]);

        const onSelectCallback = useCallback(() => {
            if (!onSelect) return;
            const cellRect = ref && ref?.current?.getBoundingClientRect();
            if (disabled) {
                onSelect(undefined);
            } else if (!selected && cellRect) {
                onSelect(cellRect);
            }
        }, [ref, onSelect, selected, disabled]);

        const onOpenerToggle = useCallback((open: boolean) => {
            if (!opener) return;
            const cellRect = ref.current?.getBoundingClientRect();
            if (open) onSelectCallback();
            opener.onToggle(open, cellRect);
        }, [opener, onSelectCallback, ref]);

        const onFocus = useCallback((event: React.SyntheticEvent<HTMLDivElement>) => {
            event.stopPropagation();
            event.preventDefault();
            onSelectCallback();
        }, [onSelectCallback]);

        const isSelected = !showError && selected;

        const scrollable = !disabled && allowScroll && isOverflowing;
        const faded = !disabled && !allowScroll && isOverflowing;

        const setOnHoverTrue = useCallback(() => setOnHover(true), []);
        const setOnHoverFalse = useCallback(() => setOnHover(false), []);

        const borderClass = showError
            ? "border-red-500"
            : isSelected
                ? "border-primary"
                : "border-transparent";

        // A reference or relation inside a cell is drawn as a line of its row,
        // never as the form's card, which is taller than any row.
        const content = <RowEntityPreviewLayout><ErrorBoundary>

            {fullHeight && !faded && children}

            {(!fullHeight || faded) && <TableCellInner
                fullHeight={fullHeight ?? false}
                justifyContent={justifyContent}
                scrollable={scrollable ?? false}
                faded={faded}>

                {!fullHeight && <div ref={measureRef}
                    style={{
                        display: "flex",
                        width: "100%",
                        justifyContent,
                        height: fullHeight ? "100%" : undefined
                    }}>
                    {children}
                </div>}

            </TableCellInner>}
        </ErrorBoundary></RowEntityPreviewLayout>;

        const result = <>
            <div
                className={cls(
                    "group/cell transition-colors duration-500",
                    `flex relative h-full rounded-md p-${p} border-4`,
                    showSaved ? "bg-primary/20 dark:bg-primary/20" : (onHover && !disabled ? "bg-surface-hover" : ""),
                    hideOverflow ? "overflow-hidden" : "",
                    isSelected && !showSaved ? "bg-surface-raised" : "",
                    borderClass
                )}
                ref={ref}
                style={{
                    justifyContent,
                    alignItems: disabled || !isOverflowing ? "center" : undefined,
                    width: width ?? "100%",
                    textAlign: align
                }}
                tabIndex={selected || disabled ? undefined : 0}
                onFocus={onFocus}
                onMouseEnter={setOnHoverTrue}
                onMouseMove={setOnHoverTrue}
                onMouseLeave={setOnHoverFalse}
            >

                {opener
                    // The value and the opener side by side. The wrapper takes
                    // over what the cell itself does for a cell without one:
                    // aligning the value, and centring it when it fits.
                    ? <div className={"flex flex-1 min-w-0 self-stretch"}
                        style={{
                            justifyContent,
                            alignItems: disabled || !isOverflowing ? "center" : undefined
                        }}>
                        {content}
                    </div>
                    : content}

                {opener && <div className={"shrink-0 self-center flex items-center pl-1"}>
                    <TableCellOpener kind={opener.kind}
                        open={opener.open}
                        selected={Boolean(selected)}
                        focusOnSelect={opener.focusOnSelect}
                        label={opener.label}
                        onToggle={onOpenerToggle}/>
                </div>}

                {actions}

                {/*{disabled && onHover && disabledTooltip &&*/}
                {/*    <div className="absolute top-1 right-1 text-xs">*/}
                {/*        <Tooltip title={disabledTooltip}>*/}
                {/*            <MinusCircleIcon size={iconSize.smallest} color={"disabled"} className={"text-text-disabled"} />*/}
                {/*        </Tooltip>*/}
                {/*    </div>}*/}

            </div>
        </>;

        // Wrap with sortable outer div when sortable props are provided
        // Remove tabIndex from attributes to avoid capturing focus before cell content
        const { tabIndex: _tabIndex, ...sortableAttrsWithoutTabIndex } = sortableAttributes ?? {};
        const sortableContent = sortableNodeRef ? (
            <div
                ref={sortableNodeRef}
                style={sortableStyle}
                className={cls(
                    "flex-shrink-0",
                    frozen && "sticky left-0 z-10 bg-surface-card"
                )}
                {...sortableAttrsWithoutTabIndex}
            >
                {showError ? (
                    <ErrorTooltip
                        className={"flex h-full w-full"}
                        align={"start"}
                        title={error?.message ?? "Error"}>
                        {result}
                    </ErrorTooltip>
                ) : result}
            </div>
        ) : (
            showError ? (
                <ErrorTooltip
                    className={"flex h-full w-full"}
                    align={"start"}
                    title={error?.message ?? "Error"}>
                    {result}
                </ErrorTooltip>
            ) : result
        );

        return sortableContent;
    }
    // Compared by every prop, its children included. It used to compare a
    // hand-picked list with `value` standing in for what the cell shows, so a
    // cell whose content changed without its value — a new preview for a
    // changed property, an additional column's new builder — kept showing the
    // old one. Its parents (`PropertyTableCell`, the table's cell renderer)
    // are memoised and draw it only when something changed.
) as React.FunctionComponent<EntityTableCellProps>;
