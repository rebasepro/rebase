import React, { useEffect, useRef } from "react";
import { ArrayProperty, DateProperty, Entity, EntityReference, EntityRelation, NumberProperty, Property, ReferenceProperty, RelationProperty, StringProperty } from "@rebasepro/types";
import { TableSize, useCustomizationController } from "@rebasepro/app";
import {
    VirtualTableInput,
    VirtualTableNumberInput,
    VirtualTableSwitch,
    VirtualTableDateField
} from "@rebasepro/ui";

import { VirtualTableSelect } from "./fields/VirtualTableSelect";
import { VirtualTableUserSelect } from "./fields/VirtualTableUserSelect";
import { TableStorageUpload } from "./fields/TableStorageUpload";
import { TableReferenceField } from "./fields/TableReferenceField";
import { TableRelationField } from "./fields/TableRelationField";
import { TableRelationSelectorField } from "./fields/TableRelationSelectorField";

import { getDatePropertyMode, getDatePropertyTimezone, getPreviewSizeFrom } from "../../preview/util";
import { TableCellOpenerKind } from "./internal/TableCellOpener";

export interface TableFieldBindingProps<T = unknown> {
    propertyKey: string;
    property: Property;
    internalValue: T;
    updateValue: (newValue: T | null) => void;
    error?: Error;
    validationError?: Error;
    disabled: boolean;
    selected: boolean;
    size: TableSize;
    align: "left" | "center" | "right";
    entity: Entity<Record<string, unknown>>;
    path: string;
    openPopup?: (cellRect: DOMRect | undefined) => void;
    /**
     * Whether the cell's floating editor is open — its dropdown, its selection
     * dialog, its date picker. The cell's opener sets it as well as the
     * editor's own trigger, and it can be set before the editor has mounted.
     */
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    /**
     * What the cell shows at rest. An editor with a trigger shows this same
     * node in it, so selecting the cell changes its frame and nothing else.
     */
    preview?: React.ReactNode;
    /**
     * The cell's element. A floating editor opens against it rather than
     * against its own trigger, which can be taller than the cell clipping it.
     */
    anchorRef?: React.RefObject<HTMLElement | null>;
}

export interface TableFieldConfig {
    Component: React.ComponentType<TableFieldBindingProps>;
    /**
     * The opener the cell reveals on hover, and keeps shown while selected,
     * to open this editor in one click. None for editors that are the value
     * itself (a text input, a switch) or that draw their own (storage).
     */
    opener?: TableCellOpenerKind;
    fullHeight?: boolean;
    allowScroll?: boolean;
    removePadding?: boolean;
    showExpandIcon?: boolean;
    hideOverflow?: boolean;
    includeActions?: boolean;
}

export function isStorageProperty(property: Property) {
    if (property.type === "string" && property.admin?.markdown)
        return false;
    if (property.type === "string" && (property as StringProperty).storage)
        return true;
    if (property.type === "array") {
        if (Array.isArray(property.of)) {
            return false;
        } else {
            return ((property as ArrayProperty).of as Property)?.type === "string" &&
                ((property as ArrayProperty).of as StringProperty)?.storage
        }
    }
    return false;
}

export function getTableBindingForProperty(
    property: Property,
    selected: boolean
): TableFieldConfig | undefined {
    const isAStorageProperty = isStorageProperty(property);

    if (isAStorageProperty) {
        return {
            Component: ({ validationError, error, disabled, selected, openPopup, property, entity, path, internalValue, size, updateValue, propertyKey }: TableFieldBindingProps) => (
                <TableStorageUpload
                    error={validationError ?? error}
                    disabled={disabled}
                    focused={selected}
                    selected={selected}
                    openPopup={openPopup}
                    property={property as StringProperty | ArrayProperty}
                    entity={entity}
                    path={path}
                    value={internalValue as string | string[] | null}
                    previewSize={getPreviewSizeFrom(size)}
                    updateValue={updateValue}
                    propertyKey={propertyKey}
                />
            ),
            includeActions: false,
            showExpandIcon: true,
            fullHeight: true,
            removePadding: true
        };
    } else if (selected && property.type === "number") {
        const numberProperty = property as NumberProperty;
        if (numberProperty.enum) {
            return {
                Component: ({ propertyKey, disabled, selected, size, error, validationError, internalValue, updateValue, open, onOpenChange, preview, anchorRef }: TableFieldBindingProps) => (
                    <VirtualTableSelect
                        name={propertyKey}
                        multiple={false}
                        disabled={disabled}
                        focused={selected}
                        valueType={"number"}
                        small={getPreviewSizeFrom(size) !== "medium"}
                        enumValues={numberProperty.enum!}
                        error={validationError ?? error}
                        internalValue={internalValue as string | number}
                        updateValue={updateValue}
                        open={open}
                        onOpenChange={onOpenChange}
                        preview={preview}
                        anchorRef={anchorRef}
                    />
                ),
                opener: "dropdown"
            };
        } else {
            return {
                Component: ({ align, error, validationError, selected, disabled, internalValue, updateValue }: TableFieldBindingProps) => (
                    <VirtualTableNumberInput
                        align={align}
                        error={validationError ?? error}
                        focused={selected}
                        disabled={disabled}
                        value={internalValue as number}
                        updateValue={updateValue}
                    />
                ),
                allowScroll: true
            };
        }
    } else if (selected && property.type === "string") {
        const stringProperty = property as StringProperty;
        if (stringProperty.enum) {
            return {
                Component: ({ propertyKey, disabled, selected, size, error, validationError, internalValue, updateValue, open, onOpenChange, preview, anchorRef }: TableFieldBindingProps) => (
                    <VirtualTableSelect
                        name={propertyKey}
                        multiple={false}
                        focused={selected}
                        disabled={disabled}
                        valueType={"string"}
                        small={getPreviewSizeFrom(size) !== "medium"}
                        enumValues={stringProperty.enum!}
                        error={validationError ?? error}
                        internalValue={internalValue as string | number}
                        updateValue={updateValue}
                        open={open}
                        onOpenChange={onOpenChange}
                        preview={preview}
                        anchorRef={anchorRef}
                    />
                ),
                opener: "dropdown"
            };
        } else if (stringProperty.userSelect) {
            return {
                Component: ({ propertyKey, disabled, selected, size, error, validationError, internalValue, updateValue, open, onOpenChange, preview, anchorRef }: TableFieldBindingProps) => (
                    <VirtualTableUserSelect
                        name={propertyKey}
                        multiple={false}
                        focused={selected}
                        disabled={disabled}
                        small={getPreviewSizeFrom(size) !== "medium"}
                        error={validationError ?? error}
                        internalValue={internalValue as string}
                        updateValue={updateValue}
                        open={open}
                        onOpenChange={onOpenChange}
                        preview={preview}
                        anchorRef={anchorRef}
                    />
                ),
                opener: "dropdown"
            };
        } else if (stringProperty.admin?.markdown || !stringProperty.storage) {
            const multiline = Boolean(stringProperty.admin?.multiline) || Boolean(stringProperty.admin?.markdown);
            return {
                Component: ({ error, validationError, disabled, selected, internalValue, updateValue }: TableFieldBindingProps) => (
                    <VirtualTableInput
                        error={validationError ?? error}
                        disabled={disabled}
                        multiline={multiline}
                        focused={selected}
                        value={internalValue as string}
                        updateValue={updateValue}
                    />
                ),
                allowScroll: true
            };
        }
    } else if (property.type === "boolean") {
        return {
            Component: ({ error, validationError, disabled, selected, internalValue, updateValue }: TableFieldBindingProps) => (
                <VirtualTableSwitch
                    error={validationError ?? error}
                    disabled={disabled}
                    focused={selected}
                    internalValue={internalValue as boolean}
                    updateValue={updateValue}
                />
            )
        };
    } else if (property.type === "date") {
        return {
            Component: DateBindingComponent,
            opener: "calendar",
            fullHeight: true,
            hideOverflow: false,
            allowScroll: false
        };
    } else if (property.type === "reference") {
        if ((property as ReferenceProperty).path) {
            return {
                Component: ({ propertyKey, internalValue, updateValue, disabled, size, property, selected, open, onOpenChange }: TableFieldBindingProps) => {
                    return (
                    <TableReferenceField
                        name={propertyKey}
                        selected={selected}
                        open={open}
                        onOpenChange={onOpenChange}
                        internalValue={internalValue as EntityReference}
                        updateValue={updateValue}
                        disabled={disabled}
                        size={size}
                        path={(property as ReferenceProperty).path!}
                        multiselect={false}
                        previewProperties={(property as ReferenceProperty).admin?.previewProperties}
                        includeId={(property as ReferenceProperty).admin?.includeId}
                        includeEntityLink={(property as ReferenceProperty).admin?.includeEntityLink}
                        title={property.name ?? propertyKey}
                        fixedFilter={(property as ReferenceProperty).admin?.fixedFilter}
                    />
                    );
                },
                opener: "dialog",
                allowScroll: false
            };
        }
    } else if (property.type === "relation") {
        if ((property as RelationProperty).relation) {
            if ((property as RelationProperty).admin?.widget === "dialog") {
                return {
                    Component: RelationDialogBindingComponent,
                    opener: "dialog",
                    allowScroll: false
                };
            } else if (selected) {
                // Gated on `selected`, like the number and string editors above.
                // This one mounts a live picker against the *target* collection,
                // and the cell is rendered once per visible row: ungated, opening
                // a table with one relation column fired a request — or, on the
                // realtime path, a subscription — per row, for data nobody had
                // asked to see. Unselected cells fall through to PropertyPreview.
                return {
                    Component: RelationSelectorBindingComponent,
                    opener: "dropdown",
                    allowScroll: false
                };
            }
        }
    } else if (property.type === "array") {
        const arrayProperty = (property as ArrayProperty);

        if (!arrayProperty.of && !arrayProperty.oneOf) {
            throw Error("You need to specify an 'of' or 'oneOf' prop (or specify a custom field) in your array property");
        } else if (arrayProperty.of && !Array.isArray(arrayProperty.of)) {
            const ofProp = arrayProperty.of as Property;
            if (ofProp.type === "string" || ofProp.type === "number") {
                if (selected && ofProp.enum) {
                    return {
                        Component: ({ propertyKey, disabled, selected, size, error, validationError, internalValue, updateValue, open, onOpenChange, preview, anchorRef }: TableFieldBindingProps) => (
                            <VirtualTableSelect
                                name={propertyKey}
                                multiple={true}
                                disabled={disabled}
                                focused={selected}
                                small={getPreviewSizeFrom(size) !== "medium"}
                                valueType={ofProp.type}
                                enumValues={ofProp.enum!}
                                error={validationError ?? error}
                                internalValue={internalValue as string | number}
                                updateValue={updateValue}
                                open={open}
                                onOpenChange={onOpenChange}
                                preview={preview}
                                anchorRef={anchorRef}
                            />
                        ),
                        opener: "dropdown"
                    };
                }
            } else if (ofProp.type === "reference") {
                const refOfProp = ofProp as ReferenceProperty;
                if (refOfProp.path) {
                    return {
                        Component: ({ propertyKey, disabled, internalValue, updateValue, size, selected, open, onOpenChange }: TableFieldBindingProps) => (
                            <TableReferenceField
                                name={propertyKey}
                                selected={selected}
                                open={open}
                                onOpenChange={onOpenChange}
                                disabled={disabled}
                                internalValue={internalValue as EntityReference[]}
                                updateValue={updateValue}
                                size={size}
                                multiselect={true}
                                path={refOfProp.path!}
                                previewProperties={refOfProp.admin?.previewProperties}
                                title={arrayProperty.name}
                                fixedFilter={refOfProp.admin?.fixedFilter}
                                includeId={refOfProp.admin?.includeId}
                                includeEntityLink={refOfProp.admin?.includeEntityLink}
                            />
                        ),
                        opener: "dialog",
                        allowScroll: false
                    };
                }
            }
        }
    }

    return undefined;
}

/**
 * Stable component for date cells. The input is always there, at rest too, so
 * a date can be typed into; the cell's opener shows the picker through it.
 */
function DateBindingComponent({ propertyKey, error, validationError, disabled, selected, size, property, internalValue, updateValue, open, onOpenChange }: TableFieldBindingProps) {
    const { locale } = useCustomizationController();
    const inputRef = useRef<HTMLInputElement>(null);

    // The native picker has no open state to report back: showing it is a
    // one-off request, handed straight back as closed. `showPicker` needs the
    // click that asked for it, which is still the current task here.
    useEffect(() => {
        if (!open) return;
        onOpenChange?.(false);
        const input = inputRef.current;
        if (!input) return;
        try {
            input.showPicker();
        } catch {
            input.focus();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    return (
        <VirtualTableDateField
            name={propertyKey}
            error={validationError ?? error}
            disabled={disabled}
            small={getPreviewSizeFrom(size) !== "medium"}
            mode={getDatePropertyMode(property as DateProperty)}
            timezone={getDatePropertyTimezone(property as DateProperty)}
            focused={selected}
            internalValue={internalValue as Date}
            updateValue={updateValue}
            locale={locale}
            pickerButton={onOpenChange === undefined}
            inputRef={inputRef}
        />
    );
}

/** Stable component for relation fields rendered with the dialog widget */
function RelationDialogBindingComponent({ propertyKey, internalValue, updateValue, disabled, size, property, selected, open, onOpenChange }: TableFieldBindingProps) {
    const relProp = property as RelationProperty;
    return (
        <TableRelationField
            name={propertyKey}
            selected={selected}
            open={open}
            onOpenChange={onOpenChange}
            internalValue={internalValue as EntityRelation}
            updateValue={updateValue}
            disabled={disabled}
            size={size}
            multiselect={false}
            relation={relProp.relation!}
            previewProperties={relProp.admin?.previewProperties}
            includeId={relProp.admin?.includeId}
            includeEntityLink={relProp.admin?.includeEntityLink}
            title={relProp.name ?? propertyKey}
            fixedFilter={relProp.admin?.fixedFilter}
        />
    );
}

/** Stable component for relation fields rendered with the inline selector */
function RelationSelectorBindingComponent({ propertyKey, internalValue, updateValue, disabled, property, selected, open, onOpenChange, preview, anchorRef }: TableFieldBindingProps) {
    const relProp = property as RelationProperty;
    return (
        <TableRelationSelectorField
            name={propertyKey}
            internalValue={internalValue as EntityRelation}
            updateValue={updateValue}
            disabled={disabled}
            relation={relProp.relation!}
            fixedFilter={relProp.admin?.fixedFilter}
            focused={selected}
            open={open}
            onOpenChange={onOpenChange}
            preview={preview}
            anchorRef={anchorRef}
        />
    );
}
