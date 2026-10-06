
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    closestCenter,
    DndContext,
    DragEndEvent,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";

import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
    Button,
    ChevronDownIcon,
    ChevronUpIcon,
    cls,
    CopyIcon,
    HandleIcon,
    IconButton,
    iconSize,
    Menu,
    MenuItem,
    MinusIcon,
    PlusIcon,
    Tooltip,
    useOutsideAlerter
} from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";
import { getHashValue } from "@rebasepro/utils";

export type ArrayEntryParams = {
    index: number;
    internalId: number;
    isDragging: boolean;
    storedProps?: object;
    storeProps: (props: object) => void;
};

export type ArrayEntryBuilder = (params: ArrayEntryParams) => React.ReactNode;

export interface ArrayContainerProps<T> {
    droppableId: string;
    value: T[];
    addLabel: string;
    buildEntry: ArrayEntryBuilder;
    disabled?: boolean;
    size?: "small" | "medium";
    onInternalIdAdded?: (id: number) => void;

    canAddElements?: boolean;
    sortable?: boolean;
    newDefaultEntry: T;
    onValueChange: (value: T[]) => void;
    className?: string;
    min?: number;
    max?: number;
}

/**
 * One internal id per item, keyed by the item's hash. Built once, at mount
 * (see the lazy initialiser below): it hashes every item, object-hash for
 * anything without an `id`.
 */
const buildIdsMap = (value: unknown[]): Record<string, number> => {
    const ids: Record<string, number> = {};
    if (!value || !Array.isArray(value)) return ids;
    value.forEach((v, index) => {
        if (!v) return;
        ids[getHashValue(v) ?? String(index) + index] = getRandomId();
    });
    return ids;
};

type SortableItemProps = {
    id: number;
    index: number;
    size?: "small" | "medium";
    disabled: boolean;
    buildEntry: ArrayEntryBuilder;
    remove: (index: number) => void;
    copy: (index: number) => void;
    addInIndex?: (index: number) => void;
    canAddElements?: boolean;
    sortable: boolean;
    storedProps?: object;
    updateItemCustomProps: (internalId: number, props: object) => void;
};

function SortableItem({
    id,
    index,
    size,
    disabled,
    buildEntry,
    remove,
    copy,
    addInIndex,
    canAddElements,
    sortable,
    storedProps,
    updateItemCustomProps
}: SortableItemProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id });

    const style = transform ? {
        transform: CSS.Transform.toString(transform),
        transition
    } : {};
    // dnd-kit memoises both; a fresh spread per render would re-draw the
    // item's options on every render of the list.
    const dragHandleProps = useMemo(() => ({ ...listeners,
        ...attributes }), [listeners, attributes]);

    return (
        <ArrayContainerItem
            nodeRef={setNodeRef}
            style={style}
            dragHandleProps={dragHandleProps}
            internalId={id}
            index={index}
            size={size}
            disabled={disabled}
            buildEntry={buildEntry}
            remove={remove}
            copy={copy}
            addInIndex={addInIndex}
            canAddElements={canAddElements}
            sortable={sortable}
            isDragging={isDragging}
            storedProps={storedProps}
            updateItemCustomProps={updateItemCustomProps}
        />
    );
}

type ArrayContainerItemProps = {
    nodeRef: (node: HTMLElement | null) => void;
    style: React.CSSProperties;
    dragHandleProps: Record<string, unknown>;
    index: number;
    internalId: number;
    size?: "small" | "medium";
    disabled: boolean;
    buildEntry: ArrayEntryBuilder;
    remove: (index: number) => void;
    copy: (index: number) => void;
    addInIndex?: (index: number) => void;
    canAddElements?: boolean;
    sortable: boolean;
    isDragging: boolean;
    storedProps?: object;
    updateItemCustomProps: (internalId: number, props: object) => void;
};

export function ArrayContainerItem({
    nodeRef,
    style,
    dragHandleProps,
    index,
    internalId,
    size,
    disabled,
    buildEntry,
    remove,
    copy,
    addInIndex,
    canAddElements,
    sortable,
    isDragging,
    storedProps,
    updateItemCustomProps
}: ArrayContainerItemProps) {
    // One function per item for as long as it lives, so the field it builds
    // does not see a new `onPropertyChange` on every render of the list.
    const storeProps = useCallback(
        (props: object) => updateItemCustomProps(internalId, props),
        [updateItemCustomProps, internalId]
    );
    return (
        <div
            ref={nodeRef}
            style={style}
            className={`relative ${!isDragging ? "hover:bg-surface-hover" : ""} rounded-md opacity-100`}
        >
            <div className="flex items-start">
                <div className="flex-grow w-[calc(100%-48px)] text-text-primary dark:text-text-primary-dark">
                    {buildEntry({
                        index,
                        internalId,
                        isDragging,
                        storedProps,
                        storeProps
                    })}
                </div>
                <ArrayItemOptions
                    dragHandleProps={dragHandleProps}
                    direction={size === "small" ? "row" : "column"}
                    disabled={disabled}
                    remove={remove}
                    index={index}
                    copy={copy}
                    canAddElements={canAddElements}
                    sortable={sortable}
                    addInIndex={addInIndex}
                />
            </div>
        </div>
    );
}

/**
 * The handle and menu beside each item. Memoised, and every prop the list hands
 * it is stable, so a list of 500 does not re-draw 500 tooltips, buttons and
 * menus on each of its renders — which in a record form was each keystroke in
 * the array.
 */
export const ArrayItemOptions = React.memo(function ArrayItemOptions({
    dragHandleProps,
    direction,
    disabled,
    remove,
    index,
    copy,
    canAddElements,
    sortable,
    addInIndex
}: {
    dragHandleProps: Record<string, unknown>;
    direction?: "row" | "column";
    disabled: boolean;
    remove: (index: number) => void;
    index: number;
    copy: (index: number) => void;
    sortable: boolean;
    canAddElements?: boolean;
    addInIndex?: (index: number) => void;
}) {
    const [menuOpen, setMenuOpen] = useState(false);
    const iconRef = useRef<HTMLDivElement>(null);
    const { t } = useTranslation();
    // Listening only while the menu is open. It listened always, with a new
    // callback per render: every item kept a `mousedown` listener on the
    // document, every click anywhere ran all of them, and every render of the
    // list removed and re-added each one.
    const closeMenu = useCallback(() => setMenuOpen(false), []);
    useOutsideAlerter(iconRef, closeMenu, menuOpen);

    const showMenu = canAddElements ?? false;

    const handleIconButtonClick = (e: React.MouseEvent) => {
        if (showMenu) {
            e.stopPropagation();
            e.preventDefault();
            setMenuOpen(o => !o);
        } else if (sortable) {
            // Allow drag to propagate if menu is not shown
        } else {
            e.stopPropagation();
            e.preventDefault();
        }
    };

    const title = !disabled && sortable && showMenu ? "Drag to move. Click for options" :
        !disabled && showMenu ? "Click for options" :
            !disabled && sortable ? "Drag to move" : undefined;

    return (
        <div ref={iconRef}
            className={`pl-2 pt-1 pb-1 flex ${direction === "row" ? "flex-row-reverse" : "flex-col"} items-center`}>
            <Tooltip
                delayDuration={400}
                open={menuOpen ? false : undefined}
                side={direction === "column" ? "left" : undefined}
                title={title}
            >
                <IconButton aria-label={title}
                    size="small"
                    disabled={disabled || (!showMenu && !sortable)}
                    {...(sortable ? dragHandleProps : {})}
                    onClick={handleIconButtonClick}
                    onFocus={() => {
                        if (sortable && menuOpen) setMenuOpen(false);
                    }}
                    className={cls(
                        (disabled || (!sortable && !showMenu)) ? "cursor-inherit" : "",
                        sortable && !disabled ? "cursor-grab" : "",
                        !sortable && showMenu && !disabled ? "cursor-pointer" : ""
                    )}
                >
                    <HandleIcon/>
                </IconButton>
            </Tooltip>
            {showMenu && (
                <Menu portalContainer={iconRef.current} open={menuOpen} trigger={<div tabIndex={-1}/>}>
                    <MenuItem
                        dense
                        onClick={(e: React.MouseEvent) => {
                            setMenuOpen(false);
                            remove(index);
                        }}
                    >
                        <MinusIcon size={iconSize.small}/>
                        {t("remove")}
                    </MenuItem>
                    <MenuItem
                        dense
                        onClick={() => {
                            setMenuOpen(false);
                            copy(index);
                        }}
                    >
                        <CopyIcon size={iconSize.small}/>
                        {t("copy")}
                    </MenuItem>
                    {addInIndex && (
                        <MenuItem
                            dense
                            onClick={() => {
                                setMenuOpen(false);
                                addInIndex(index);
                            }}
                        >
                            <ChevronUpIcon size={iconSize.small}/>
                            {t("add_on_top")}
                        </MenuItem>
                    )}
                    {addInIndex && (
                        <MenuItem
                            dense
                            onClick={() => {
                                setMenuOpen(false);
                                addInIndex(index + 1);
                            }}
                        >
                            <ChevronDownIcon size={iconSize.small}/>
                            {t("add_below")}
                        </MenuItem>
                    )}
                </Menu>
            )}
        </div>
    );
});

export function ArrayContainer<T>({
    droppableId,
    addLabel,
    value,
    disabled = false,
    buildEntry,
    size = "medium",
    onInternalIdAdded,
    canAddElements: canAddElementsProp = true,
    sortable = true,
    newDefaultEntry,
    onValueChange,
    className,
    min = 0,
    max = Infinity
}: ArrayContainerProps<T>) {
    const canAddElements = canAddElementsProp;

    const hasValue = value && Array.isArray(value) && value.length > 0;
    // Built by a lazy initialiser: `useRef(buildIdsMap(value))` evaluated its
    // argument on every render and discarded it, hashing every item each time.
    const [initialIdsMap] = useState(() => buildIdsMap(value));
    const internalIdsRef = useRef<Record<string, number>>(initialIdsMap);
    const [internalIds, setInternalIds] = useState<number[]>(
        () => hasValue ? Object.values(initialIdsMap) : []
    );
    const itemCustomPropsRef = useRef<Record<number, object>>({});

    const updateItemCustomProps = useCallback((internalId: number, customProps: object) => {
        itemCustomPropsRef.current[internalId] = customProps;
    }, []);

    // Options hoisted: dnd-kit memoises sensors on their options' identity, and
    // a new object per render gave every drag handle new listeners each time.
    const pointerSensor = useSensor(PointerSensor, POINTER_SENSOR_OPTIONS);
    const keyboardSensor = useSensor(KeyboardSensor, KEYBOARD_SENSOR_OPTIONS);
    const sensors = useSensors(pointerSensor, keyboardSensor);

    useEffect(() => {
        if (hasValue && value && value.length !== internalIds.length) {
            const newInternalIds = value.map((v, index) => {
                const hashValue = (getHashValue(v) ?? String(index)) + index;
                if (hashValue in internalIdsRef.current) {
                    return internalIdsRef.current[hashValue];
                } else {
                    const newInternalId = getRandomId();
                    internalIdsRef.current[hashValue] = newInternalId;
                    return newInternalId;
                }
            });
            setInternalIds(newInternalIds);
        }
    }, [hasValue, internalIds.length, value]);

    const insertInEnd = (e: React.SyntheticEvent) => {
        e.preventDefault();
        if (disabled || (value ?? []).length >= max) return;
        const id = getRandomId();
        const newIds: number[] = [...internalIds, id];
        if (onInternalIdAdded) onInternalIdAdded(id);
        setInternalIds(newIds);
        onValueChange([...(value ?? []), newDefaultEntry]);
    };

    // The item actions read the list as it is when they run, through a ref,
    // so they keep one identity and the memoised item options stay put.
    const latestRef = useRef({ value, internalIds, onValueChange, onInternalIdAdded, newDefaultEntry, min, max });
    latestRef.current = { value, internalIds, onValueChange, onInternalIdAdded, newDefaultEntry, min, max };

    const remove = useCallback((index: number) => {
        const { value, internalIds, onValueChange, min } = latestRef.current;
        if ((value ?? []).length <= min) return;
        const newIds = [...internalIds];
        newIds.splice(index, 1);
        setInternalIds(newIds);
        onValueChange((value ?? []).filter((_, i) => i !== index));
    }, []);

    const copy = useCallback((index: number) => {
        const { value, internalIds, onValueChange, onInternalIdAdded, max } = latestRef.current;
        if ((value ?? []).length >= max) return;
        const id = getRandomId();
        const copyingItem = (value ?? [])[index];
        const newIds: number[] = [
            ...internalIds.slice(0, index + 1),
            id,
            ...internalIds.slice(index + 1)
        ];
        if (onInternalIdAdded) onInternalIdAdded(id);
        setInternalIds(newIds);
        onValueChange([...(value ?? []).slice(0, index + 1), copyingItem, ...(value ?? []).slice(index + 1)]);
    }, []);

    const addInIndex = useCallback((index: number) => {
        const { value, internalIds, onValueChange, onInternalIdAdded, newDefaultEntry, max } = latestRef.current;
        if ((value ?? []).length >= max) return;
        const id = getRandomId();
        const newIds: number[] = [
            ...internalIds.slice(0, index),
            id,
            ...internalIds.slice(index)
        ];
        if (onInternalIdAdded) onInternalIdAdded(id);
        setInternalIds(newIds);
        onValueChange([...(value ?? []).slice(0, index), newDefaultEntry, ...(value ?? []).slice(index)]);
    }, []);

    const onDragEnd = (event: DragEndEvent) => {
        const {
            active,
            over
        } = event;
        if (!over || active.id === over.id) return;

        const oldIndex = internalIds.indexOf(active.id as number);
        const newIndex = internalIds.indexOf(over.id as number);
        if (oldIndex === -1 || newIndex === -1) return;
        const newIds = arrayMove(internalIds, oldIndex, newIndex);
        setInternalIds(newIds);
        onValueChange(arrayMove(value ?? [], oldIndex, newIndex));
    };

    return sortable ? (
        <DndContext sensors={sensors}
            modifiers={[restrictToVerticalAxis]}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}>
            <SortableContext items={internalIds} strategy={verticalListSortingStrategy}>
                <div className={cls("space-y-1", className)} id={droppableId}>
                    {hasValue &&
                        internalIds.map((internalId: number, index: number) => (
                            <SortableItem
                                key={`array_field_${internalId}`}
                                id={internalId}
                                index={index}
                                size={size}
                                disabled={disabled}
                                buildEntry={buildEntry}
                                remove={remove}
                                copy={copy}
                                addInIndex={addInIndex}
                                canAddElements={canAddElements}
                                sortable={sortable}
                                storedProps={itemCustomPropsRef.current[internalId]}
                                updateItemCustomProps={updateItemCustomProps}
                            />
                        ))}
                    {canAddElements && (
                        <div className="my-4 justify-center text-left">
                            <Button
                                variant={"text"}
                                size={size === "small" ? "small" : "medium"}
                                disabled={disabled || (value?.length ?? 0) >= max}
                                startIcon={<PlusIcon/>}
                                onClick={insertInEnd}
                            >
                                {addLabel ?? "Add"}
                            </Button>
                        </div>
                    )}
                </div>
            </SortableContext>
        </DndContext>
    ) : (
        <div className={cls("space-y-1", className)} id={droppableId}>
            {hasValue &&
                internalIds.map((internalId: number, index: number) => (
                    <ArrayContainerItem
                        key={`array_field_${internalId}`}
                        nodeRef={NO_NODE_REF}
                        style={NO_STYLE}
                        dragHandleProps={NO_DRAG_HANDLE}
                        internalId={internalId}
                        index={index}
                        size={size}
                        disabled={disabled}
                        buildEntry={buildEntry}
                        remove={remove}
                        copy={copy}
                        addInIndex={addInIndex}
                        canAddElements={canAddElements}
                        sortable={false}
                        isDragging={false}
                        storedProps={itemCustomPropsRef.current[internalId]}
                        updateItemCustomProps={updateItemCustomProps}
                    />
                ))}
            {canAddElements && (
                <div className="my-4 justify-center text-left">
                    <Button
                        variant={"text"}
                        size={size === "small" ? "small" : "medium"}
                        disabled={disabled || (value?.length ?? 0) >= max}
                        startIcon={<PlusIcon/>}
                        onClick={insertInEnd}
                    >
                        {addLabel ?? "Add"}
                    </Button>
                </div>
            )}
        </div>
    );
}

const POINTER_SENSOR_OPTIONS = {
    activationConstraint: {
        distance: 5
    }
};
const KEYBOARD_SENSOR_OPTIONS = {};
const NO_NODE_REF = (_node: HTMLElement | null) => undefined;
const NO_STYLE: React.CSSProperties = {};
const NO_DRAG_HANDLE: Record<string, unknown> = {};

function arrayMove<T>(value: T[], sourceIndex: number, destinationIndex: number): T[] {
    const result = Array.from(value);
    const [removed] = result.splice(sourceIndex, 1);
    result.splice(destinationIndex, 0, removed);
    return result;
}

export function getRandomId() {
    return Math.floor(Math.random() * Math.floor(Number.MAX_SAFE_INTEGER));
}
