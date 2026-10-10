import { useCellSelected, createSelectionStore } from "../SelectableTable/SelectionStore";
import type { ArrayProperty, NumberProperty, Property, ReferenceProperty, StringProperty } from "@rebasepro/types";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deepEqual as equal, shallowEqual } from "fast-equals"

import { Entity, EntityReference, EntityRelation } from "@rebasepro/types";

import { getTableBindingForProperty } from "./table_bindings";

import { PropertyPreview } from "../../preview";
import { getPreviewSizeFrom } from "../../preview/util";

import type { ZodTypeAny } from "zod";
import { applyValueTransforms, CustomFieldValidator, mapPropertyToZod } from "../../form/validation";

import { EntityTableCell } from "./internal/EntityTableCell";
import { EntityTableCellActions } from "./internal/EntityTableCellActions";

import { useSelectableTableController } from "../SelectableTable/SelectableTableContext";
import { getRowHeight, useTranslation } from "@rebasepro/app";
import { isDisabled, isReadOnly } from "@rebasepro/app";
import { EntityTableCellOpener } from "./internal/EntityTableCell";
import { TableCellOpenerKind } from "./internal/TableCellOpener";

export interface PropertyTableCellProps<T> {
    propertyKey: string;
    columnIndex: number;
    align: "right" | "left" | "center";
    customFieldValidator?: CustomFieldValidator;
    value: T;
    readonly: boolean;
    property: Property;
    height: number;
    width: number;
    entity: Entity<any>;
    path: string;
    disabled: boolean;
    enablePopupIcon?: boolean;
    // Sortable props for dnd-kit integration
    sortableNodeRef?: (node: HTMLElement | null) => void;
    sortableStyle?: React.CSSProperties;
    sortableAttributes?: Record<string, any>;
    isDragging?: boolean;
    isDraggable?: boolean;
    frozen?: boolean;
}


/**
 * One validation schema per column: keyed by the property object, the
 * property key and the field validator, and held as long as the property
 * object is (a WeakMap — a collection that changes brings new property objects
 * and so new schemas; nothing outlives the collection it was built for).
 *
 * The row id is deliberately not part of the key: `mapPropertyToZod` only
 * threads `entityId` through to nested properties and reads it nowhere, so the
 * schema built for one row is the schema of every row. It was built per cell
 * — 600 schemas, 15-28 ms, for a 30-row screen of 20 columns. A rule that
 * needs the row would have to read it at validation time, not at build time.
 */
const columnSchemas = new WeakMap<Property, Map<string, Map<CustomFieldValidator | undefined, ZodTypeAny>>>();

function getColumnSchema(property: Property, propertyKey: string, customFieldValidator?: CustomFieldValidator): ZodTypeAny {
    let byKey = columnSchemas.get(property);
    if (!byKey) {
        byKey = new Map();
        columnSchemas.set(property, byKey);
    }
    let byValidator = byKey.get(propertyKey);
    if (!byValidator) {
        byValidator = new Map();
        byKey.set(propertyKey, byValidator);
    }
    let schema = byValidator.get(customFieldValidator);
    if (!schema) {
        schema = mapPropertyToZod({
            property,
            customFieldValidator,
            name: propertyKey
        });
        byValidator.set(customFieldValidator, schema);
    }
    return schema;
}

export const PropertyTableCell = React.memo<PropertyTableCellProps<any>>(
    function PropertyTableCell<T, M extends Record<string, any>>({
        propertyKey,
        customFieldValidator,
        value,
        property,
        align,
        width,
        height,
        path,
        entity,
        readonly,
        disabled: disabledProp,
        enablePopupIcon = true,
        sortableNodeRef,
        sortableStyle,
        sortableAttributes,
        isDragging,
        isDraggable,
        frozen
    }: PropertyTableCellProps<T>) {

        const {
            onValueChange,
            size,
            selectionStore,
            select,
            setPopupCell
        } = useSelectableTableController();
        const { t } = useTranslation();

        const dummySelectionStore = useMemo(() => createSelectionStore(), []);
        const activeSelectionStore = selectionStore || dummySelectionStore;
        const selected = useCellSelected(activeSelectionStore, propertyKey, entity.path, entity.id);

        const [internalValue, setInternalValue] = useState<any | null>(value);
        const internalValueRef = useRef(value);

        const [error, setError] = useState<Error | undefined>();
        const [validationError, setValidationError] = useState<Error | undefined>();
        const [savedTimestamp, setSavedTimestamp] = useState<number>(0);

        const onValueUpdated = useCallback(() => {
            setSavedTimestamp(Date.now());
        }, []);

        const customField = Boolean(property.admin?.Field);
        const customPreview = Boolean(property.admin?.Preview);
        const readOnlyProperty = isReadOnly(property);
        const disabledTooltip: string | undefined = typeof property.admin?.disabled === "object" ? property.admin?.disabled.disabledMessage : undefined;
        const disabled = readonly || disabledProp || isDisabled(property);

        const validation = useMemo(
            () => getColumnSchema(property, propertyKey, customFieldValidator),
            [property, propertyKey, customFieldValidator]);

        useEffect(
            () => {
                if (!equal(value, internalValueRef.current)) {
                    setValidationError(undefined);
                    setInternalValue(value);
                    internalValueRef.current = value;
                    onValueUpdated();
                }
            },
            [onValueUpdated, value]
        );

        // What a save writes: the value with the string transforms the
        // property declares (`trim`, `lowercase`, `uppercase`) applied, as the
        // form writes it. Validation judges the same transformed value.
        const toWrittenValue = useCallback((typed: unknown): unknown =>
            applyValueTransforms({ value: typed }, { value: property }).value, [property]);

        // The editor keeps what was typed while the cell is edited — trimming
        // under the cursor would eat the space before the next word — and the
        // cell shows what was written once it is left.
        const [transformedWrite, setTransformedWrite] = useState<{ value: unknown }>();
        useEffect(() => {
            if (selected || !transformedWrite) return;
            if (equal(toWrittenValue(internalValue), transformedWrite.value))
                setInternalValue(transformedWrite.value);
            setTransformedWrite(undefined);
        }, [selected, transformedWrite, internalValue, toWrittenValue]);

        const saveValues = async (value: unknown) => {
            const writtenValue = toWrittenValue(value);
            if (equal(writtenValue, internalValueRef.current))
                return;
            const result = await validation.safeParseAsync(value);
            if (result.success) {
                    setValidationError(undefined);
                    internalValueRef.current = writtenValue as T;
                    if (!equal(writtenValue, value))
                        setTransformedWrite({ value: writtenValue });
                    if (onValueChange) {
                        try {
                            onValueChange({
                                value: writtenValue,
                                propertyKey,
                                setError,
                                onValueUpdated,
                                data: entity
                            });
                        } catch (e: unknown) {
                            console.error("onValueChange error", e);
                            setError(e instanceof Error ? e : new Error(String(e)));
                        }

                    }
            } else {
                    setValidationError(result.error);
            }
        };

        // What the cell holds, judged by its column's schema — the only two
        // things the result depends on. It also re-ran for every new row
        // object a realtime frame brought, changed or not.
        useEffect(() => {
            validation
                .safeParseAsync(internalValue)
                .then((result) => {
                    if (result.success) {
                        setValidationError(undefined);
                    } else {
                        setValidationError(result.error);
                    }
                });
        }, [internalValue, validation]);

        // Saves the row at once, so only an edit may call it. The table shows
        // what is stored: a disabled property's `clearOnDisabled` belongs to
        // the form, whose values are written only when the user saves.
        const updateValue = (newValue: unknown | null) => {

            let updatedValue: unknown;
            if (newValue === undefined) {
                updatedValue = null;
            } else {
                updatedValue = newValue;
            }
            setInternalValue(updatedValue);
            saveValues(updatedValue);
        };

        const onSelect = useCallback((cellRect: DOMRect | undefined) => {
            if (!cellRect) {
                select(undefined);
            } else {
                select({
                    width,
                    height,
                    entityPath: entity.path,
                    entityId: entity.id,
                    cellRect,
                    propertyKey: propertyKey as Extract<keyof M, string>
                });
            }
        }, [entity, height, propertyKey, select, width]);

        const openPopup = (cellRect: DOMRect | undefined) => {
            if (!setPopupCell)
                return;
            if (!cellRect) {
                setPopupCell(undefined);
            } else {
                setPopupCell({
                    width,
                    height,
                    entityPath: entity.path,
                    entityId: entity.id,
                    cellRect,
                    propertyKey: propertyKey as Extract<keyof M, string>
                });
            }
        };

        // `getTableBindingForProperty` builds its `Component` as a fresh inline
        // arrow function on every call. Calling it during render therefore gave
        // React a new component *type* each pass, so the cell was unmounted and
        // remounted instead of updated — which is why a BooleanSwitch in the
        // table never animated (a replaced element cannot run a CSS transition)
        // and why every cell re-created its subtree on unrelated renders.
        const tableBinding = useMemo(
            () => getTableBindingForProperty(property, selected),
            [property, selected]);

        // The editor the cell opens, whether or not it is mounted yet. A picker
        // is only mounted once its cell is selected (see table_bindings), but
        // the opener that reveals it is there from rest.
        const editorBinding = useMemo(
            () => getTableBindingForProperty(property, true),
            [property]);

        // Whether the cell's floating editor is open: the dropdown, the picker
        // dialog, the date picker. Held here rather than inside the editor so
        // the opener can open it in the same click that selects the cell —
        // before the editor exists.
        const [editorOpen, setEditorOpen] = useState(false);
        useEffect(() => {
            if (!selected) setEditorOpen(false);
        }, [selected]);

        // What a floating editor is positioned against: the cell, not the
        // editor's own trigger, which the cell may clip.
        const cellRef = useRef<HTMLDivElement>(null);

        // What the cell shows at rest. A picker renders the same node as its
        // trigger, so selecting the cell changes its frame and nothing else.
        const preview = <PropertyPreview width={width}
            height={height}
            propertyKey={propertyKey as string}
            value={internalValue}
            property={property}
            size={getPreviewSizeFrom(size)}
        />;

        let openerKind: TableCellOpenerKind | undefined;
        if (!disabled && !readOnlyProperty) {
            if (!customField && editorBinding)
                openerKind = editorBinding.opener;
            else if (enablePopupIcon && setPopupCell)
                openerKind = "expand";
        }

        const onOpenerToggleRef = useRef<(open: boolean, cellRect: DOMRect | undefined) => void>(() => undefined);
        onOpenerToggleRef.current = (open, cellRect) => {
            if (openerKind === "expand") {
                if (open) openPopup(cellRect);
            } else {
                setEditorOpen(open);
            }
        };
        // Stable: `EntityTableCell` compares its props field by field and would
        // otherwise hold on to the first one it was given.
        const onOpenerToggle = useCallback((open: boolean, cellRect: DOMRect | undefined) =>
            onOpenerToggleRef.current(open, cellRect), []);

        const opener: EntityTableCellOpener | undefined = openerKind
            ? {
                kind: openerKind,
                open: editorOpen,
                // A dropdown's own trigger takes the focus, and Enter opens it.
                // The rest have no trigger in the cell; the opener stands in.
                focusOnSelect: openerKind !== "dropdown",
                label: openerKind === "expand"
                    ? t("expand")
                    : t("edit_name", { name: property.name ?? propertyKey }),
                onToggle: onOpenerToggle
            }
            : undefined;

        let innerComponent: React.ReactNode | undefined;
        let allowScroll = false;
        let showExpandIcon = false;
        let hideOverflow = true;
        let removePadding = false;
        let fullHeight = false;
        let includeActions = true;
        const showError = !disabled && error;

        if (readonly || readOnlyProperty) {
            return <EntityTableCell
                size={size}
                width={width}
                savedTimestamp={savedTimestamp}
                key={`${propertyKey}_${entity.path}_${entity.id}`}
                value={internalValue}
                align={align ?? "left"}
                fullHeight={false}
                disabledTooltip={disabledTooltip ?? (readOnlyProperty ? "Read only" : undefined)}
                disabled={true}
                sortableNodeRef={sortableNodeRef}
                sortableStyle={sortableStyle}
                sortableAttributes={sortableAttributes}
                isDragging={isDragging}
                isDraggable={isDraggable}
                frozen={frozen}>
                <PropertyPreview
                    width={width}
                    height={getRowHeight(size)}
                    propertyKey={propertyKey}
                    property={property}
                    value={internalValue}
                    size={getPreviewSizeFrom(size)}
                />
            </EntityTableCell>;
        }

        if (!customField && (!customPreview || selected)) {
            if (tableBinding) {
                const Component = tableBinding.Component;
                innerComponent = <Component
                    propertyKey={propertyKey}
                    property={property}
                    internalValue={internalValue}
                    updateValue={updateValue}
                    error={error}
                    validationError={validationError}
                    disabled={disabled}
                    selected={selected}
                    size={size}
                    align={align}
                    entity={entity}
                    path={path}
                    openPopup={setPopupCell ? openPopup : undefined}
                    open={editorOpen}
                    onOpenChange={setEditorOpen}
                    preview={preview}
                    anchorRef={cellRef}
                />;

                allowScroll = tableBinding.allowScroll ?? false;
                includeActions = tableBinding.includeActions ?? true;
                showExpandIcon = tableBinding.showExpandIcon ?? false;
                fullHeight = tableBinding.fullHeight ?? false;
                removePadding = tableBinding.removePadding ?? false;
                if (tableBinding.hideOverflow !== undefined) hideOverflow = tableBinding.hideOverflow;
            }
        }

        if (!innerComponent) {
            allowScroll = false;
            innerComponent = preview;
        }

        return (
            <EntityTableCell
                key={`cell_${propertyKey}_${entity.path}_${entity.id}`}
                size={size}
                width={width}
                onSelect={onSelect}
                selected={selected}
                disabled={disabled || readOnlyProperty}
                disabledTooltip={disabledTooltip ?? "Disabled"}
                removePadding={removePadding}
                fullHeight={fullHeight}
                savedTimestamp={savedTimestamp}
                error={validationError ?? error}
                align={align}
                allowScroll={allowScroll}
                showExpandIcon={showExpandIcon}
                value={internalValue}
                hideOverflow={hideOverflow}
                opener={opener}
                cellRef={cellRef}
                sortableNodeRef={sortableNodeRef}
                sortableStyle={sortableStyle}
                sortableAttributes={sortableAttributes}
                isDragging={isDragging}
                isDraggable={isDraggable}
                frozen={frozen}
                actions={includeActions && <EntityTableCellActions
                    showError={showError}
                    disabled={disabled}
                    showExpandIcon={showExpandIcon}
                    selected={selected}
                    openPopup={!disabled ? openPopup : undefined}/>}
            >

                {innerComponent}

            </EntityTableCell>
        );

    },
    areEqual) as React.FunctionComponent<PropertyTableCellProps<any>>;

// The row is compared as well as the cell's own value: a save is built from
// `entity.values` — a key inside a map is written as the whole map — and hands
// them to `beforeSave` as the previous values, so a cell must not hold on to a
// row that has since changed in another column or in a sibling key.
//
// Every prop is compared. Leaving `readonly`, `disabled` and `enablePopupIcon`
// out meant switching inline editing off, or a permission changing, did not
// reach a cell already drawn until its row changed.
function areEqual(prevProps: PropertyTableCellProps<any>, nextProps: PropertyTableCellProps<any>) {
    return prevProps.height === nextProps.height &&
        prevProps.propertyKey === nextProps.propertyKey &&
        prevProps.columnIndex === nextProps.columnIndex &&
        prevProps.align === nextProps.align &&
        prevProps.width === nextProps.width &&
        prevProps.readonly === nextProps.readonly &&
        prevProps.disabled === nextProps.disabled &&
        prevProps.enablePopupIcon === nextProps.enablePopupIcon &&
        prevProps.customFieldValidator === nextProps.customFieldValidator &&
        prevProps.path === nextProps.path &&
        equal(prevProps.property, nextProps.property) &&
        equal(prevProps.value, nextProps.value) &&
        prevProps.entity.id === nextProps.entity.id &&
        prevProps.entity.path === nextProps.entity.path &&
        (prevProps.entity === nextProps.entity || equal(prevProps.entity.values, nextProps.entity.values)) &&
        prevProps.isDragging === nextProps.isDragging &&
        prevProps.isDraggable === nextProps.isDraggable &&
        prevProps.frozen === nextProps.frozen &&
        prevProps.sortableNodeRef === nextProps.sortableNodeRef &&
        shallowEqual(prevProps.sortableStyle ?? NO_STYLE, nextProps.sortableStyle ?? NO_STYLE) &&
        shallowEqual(prevProps.sortableAttributes ?? NO_ATTRIBUTES, nextProps.sortableAttributes ?? NO_ATTRIBUTES)
        ;
}

const NO_STYLE: React.CSSProperties = {};
const NO_ATTRIBUTES: Record<string, unknown> = {};
