import { useCellSelected, createSelectionStore } from "../SelectableTable/SelectionStore";
import type { ArrayProperty, NumberProperty, Property, ReferenceProperty, StringProperty } from "@rebasepro/types";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deepEqual as equal } from "fast-equals"

import { Entity, EntityReference, EntityRelation } from "@rebasepro/types";

import { getTableBindingForProperty } from "./table_bindings";

import { PropertyPreview } from "../../preview";
import { getPreviewSizeFrom } from "../../preview/util";

import { CustomFieldValidator, mapPropertyToZod } from "../../form/validation";

import { EntityTableCell } from "./internal/EntityTableCell";
import { EntityTableCellActions } from "./internal/EntityTableCellActions";

import { useSelectableTableController } from "../SelectableTable/SelectableTableContext";
import { useClearRestoreValue } from "../../form/useClearRestoreValue";
import { getRowHeight } from "@rebasepro/app";
import { isDisabled, isReadOnly } from "@rebasepro/app";
import { TableRelationField } from "./fields/TableRelationField";
import { TableRelationSelectorField } from "./fields/TableRelationSelectorField";

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

        const validation = useMemo(() => mapPropertyToZod({
            property,
            entityId: entity.id,
            customFieldValidator,
            name: propertyKey
        }), [entity.id, property, propertyKey]);

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

        const saveValues = async (value: unknown) => {
            if (equal(value, internalValueRef.current))
                return;
            const result = await validation.safeParseAsync(value);
            if (result.success) {
                    setValidationError(undefined);
                    internalValueRef.current = value as T;
                    if (onValueChange) {
                        try {
                            onValueChange({
                                value,
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
        }, [internalValue, validation, propertyKey, property, entity]);

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

        useClearRestoreValue<unknown>({
            property,
            value: internalValue,
            setValue: updateValue
        });

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
            showExpandIcon = enablePopupIcon && selected && !innerComponent && !disabled && !readOnlyProperty;
            innerComponent = (
                <PropertyPreview width={width}
                    height={height}
                    propertyKey={propertyKey as string}
                    value={internalValue}
                    property={property}
                    size={getPreviewSizeFrom(size)}
                />
            );
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

function areEqual(prevProps: PropertyTableCellProps<any>, nextProps: PropertyTableCellProps<any>) {
    return prevProps.height === nextProps.height &&
        prevProps.propertyKey === nextProps.propertyKey &&
        prevProps.align === nextProps.align &&
        prevProps.width === nextProps.width &&
        equal(prevProps.property, nextProps.property) &&
        equal(prevProps.value, nextProps.value) &&
        prevProps.entity.id === nextProps.entity.id &&
        prevProps.entity.path === nextProps.entity.path &&
        prevProps.isDragging === nextProps.isDragging &&
        prevProps.isDraggable === nextProps.isDraggable &&
        prevProps.frozen === nextProps.frozen
        ;
}
