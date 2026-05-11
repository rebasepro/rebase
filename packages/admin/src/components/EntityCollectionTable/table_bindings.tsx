import React from "react";
import { ArrayProperty, Entity, EntityReference, EntityRelation, NumberProperty, Property, StringProperty } from "@rebasepro/types";

import { VirtualTableInput } from "./fields/VirtualTableInput";
import { VirtualTableSelect } from "./fields/VirtualTableSelect";
import { VirtualTableNumberInput } from "./fields/VirtualTableNumberInput";
import { VirtualTableSwitch } from "./fields/VirtualTableSwitch";
import { VirtualTableDateField } from "./fields/VirtualTableDateField";
import { VirtualTableUserSelect } from "./fields/VirtualTableUserSelect";
import { TableStorageUpload } from "./fields/TableStorageUpload";
import { TableReferenceField } from "./fields/TableReferenceField";
import { TableRelationField } from "./fields/TableRelationField";
import { TableRelationSelectorField } from "./fields/TableRelationSelectorField";

import { getPreviewSizeFrom } from "../../preview/util";

export interface TableFieldBindingProps<T = any> {
    propertyKey: string;
    property: Property;
    internalValue: T;
    updateValue: (newValue: T | null) => void;
    error?: Error;
    validationError?: Error;
    disabled: boolean;
    selected: boolean;
    size: any;
    align: "left" | "center" | "right";
    entity: Entity<any>;
    path: string;
    openPopup?: (cellRect: DOMRect | undefined) => void;
}

export interface TableFieldConfig {
    Component: React.ComponentType<TableFieldBindingProps>;
    fullHeight?: boolean;
    allowScroll?: boolean;
    removePadding?: boolean;
    showExpandIcon?: boolean;
    hideOverflow?: boolean;
    includeActions?: boolean;
}

export function isStorageProperty(property: Property) {
    if (property.type === "string" && property.ui?.markdown)
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

    if (property.type === "string" && (property as StringProperty).reference?.path) {
        return {
            Component: ({ propertyKey, property, internalValue, updateValue, disabled, size, path }) => {
                const referenceProperty = (property as StringProperty).reference as any;
                const referenceValue = internalValue ? new EntityReference({ id: internalValue as string,
path: referenceProperty.path as string }) : undefined;
                return (
                    <TableReferenceField
                        name={propertyKey}
                        internalValue={referenceValue}
                        updateValue={(v) => updateValue(v ? (v as EntityReference).id : null)}
                        disabled={disabled}
                        size={size}
                        path={referenceProperty.path as string}
                        multiselect={false}
                        previewProperties={referenceProperty.previewProperties}
                        includeId={referenceProperty.includeId}
                        includeEntityLink={referenceProperty.includeEntityLink}
                        title={property.name}
                        fixedFilter={referenceProperty.fixedFilter}
                    />
                );
            },
            allowScroll: false
        };
    } else if (isAStorageProperty) {
        return {
            Component: ({ validationError, error, disabled, selected, openPopup, property, entity, path, internalValue, size, updateValue, propertyKey }: any) => (
                <TableStorageUpload
                    error={validationError ?? error}
                    disabled={disabled}
                    focused={selected}
                    selected={selected}
                    openPopup={openPopup}
                    property={property as any}
                    entity={entity}
                    path={path}
                    value={internalValue}
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
                Component: ({ propertyKey, disabled, selected, size, error, validationError, internalValue, updateValue }: any) => (
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
                    />
                ),
                fullHeight: true
            };
        } else {
            return {
                Component: ({ align, error, validationError, selected, disabled, internalValue, updateValue }: any) => (
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
                Component: ({ propertyKey, disabled, selected, size, error, validationError, internalValue, updateValue }: any) => (
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
                    />
                ),
                fullHeight: true
            };
        } else if (stringProperty.userSelect) {
            return {
                Component: ({ propertyKey, disabled, selected, size, error, validationError, internalValue, updateValue }: any) => (
                    <VirtualTableUserSelect
                        name={propertyKey}
                        multiple={false}
                        focused={selected}
                        disabled={disabled}
                        small={getPreviewSizeFrom(size) !== "medium"}
                        error={validationError ?? error}
                        internalValue={internalValue as string}
                        updateValue={updateValue}
                    />
                ),
                fullHeight: true
            };
        } else if (stringProperty.ui?.markdown || !stringProperty.storage || !stringProperty.reference) {
            const multiline = Boolean(stringProperty.ui?.multiline) || Boolean(stringProperty.ui?.markdown);
            return {
                Component: ({ error, validationError, disabled, selected, internalValue, updateValue }: any) => (
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
            Component: ({ error, validationError, disabled, selected, internalValue, updateValue }: any) => (
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
            Component: ({ propertyKey, error, validationError, disabled, selected, property, internalValue, updateValue }: any) => (
                <VirtualTableDateField
                    name={propertyKey}
                    error={validationError ?? error}
                    disabled={disabled}
                    mode={property.mode}
                    focused={selected}
                    internalValue={internalValue as Date}
                    updateValue={updateValue}
                />
            ),
            fullHeight: true,
            hideOverflow: false,
            allowScroll: false
        };
    } else if (property.type === "reference") {
        if (typeof property.path === "string") {
            return {
                Component: ({ propertyKey, internalValue, updateValue, disabled, size, property }: any) => (
                    <TableReferenceField
                        name={propertyKey}
                        internalValue={internalValue as EntityReference}
                        updateValue={updateValue}
                        disabled={disabled}
                        size={size}
                        path={property.path}
                        multiselect={false}
                        previewProperties={property.ui?.previewProperties}
                        includeId={property.includeId}
                        includeEntityLink={property.includeEntityLink}
                        title={property.name ?? propertyKey}
                        fixedFilter={property.fixedFilter}
                    />
                ),
                allowScroll: false
            };
        }
    } else if (property.type === "relation") {
        if (property.relation) {
            if (property.ui?.widget === "dialog") {
                return {
                    Component: ({ propertyKey, internalValue, updateValue, disabled, size, property }: any) => (
                        <TableRelationField
                            name={propertyKey}
                            internalValue={internalValue as EntityRelation}
                            updateValue={updateValue}
                            disabled={disabled}
                            size={size}
                            multiselect={false}
                            relation={property.relation}
                            previewProperties={property.ui?.previewProperties}
                            includeId={property.includeId}
                            includeEntityLink={property.includeEntityLink}
                            title={property.name ?? propertyKey}
                            fixedFilter={property.fixedFilter}
                        />
                    ),
                    allowScroll: false
                };
            } else {
                return {
                    Component: ({ propertyKey, internalValue, updateValue, disabled, property }: any) => (
                        <TableRelationSelectorField
                            name={propertyKey}
                            internalValue={internalValue as EntityRelation}
                            updateValue={updateValue}
                            disabled={disabled}
                            size={"small"}
                            relation={property.relation!}
                            fixedFilter={property.fixedFilter}
                        />
                    ),
                    allowScroll: false
                };
            }
        }
    } else if (property.type === "array") {
        const arrayProperty = (property as ArrayProperty);

        if (!arrayProperty.of && !arrayProperty.oneOf) {
            throw Error("You need to specify an 'of' or 'oneOf' prop (or specify a custom field) in your array property");
        } else if (arrayProperty.of && !Array.isArray(arrayProperty.of)) {
            const ofProp = arrayProperty.of as any;
            if (ofProp.type === "string" || ofProp.type === "number") {
                if (selected && ofProp.enum) {
                    return {
                        Component: ({ propertyKey, disabled, selected, size, error, validationError, internalValue, updateValue }: any) => (
                            <VirtualTableSelect
                                name={propertyKey}
                                multiple={true}
                                disabled={disabled}
                                focused={selected}
                                small={getPreviewSizeFrom(size) !== "medium"}
                                valueType={ofProp.type}
                                enumValues={ofProp.enum}
                                error={validationError ?? error}
                                internalValue={internalValue as string | number}
                                updateValue={updateValue}
                            />
                        ),
                        allowScroll: true,
                        fullHeight: true,
                        hideOverflow: false
                    };
                }
            } else if (ofProp.type === "reference") {
                if (typeof ofProp.path === "string") {
                    return {
                        Component: ({ propertyKey, disabled, internalValue, updateValue, size }: any) => (
                            <TableReferenceField
                                name={propertyKey}
                                disabled={disabled}
                                internalValue={internalValue as EntityReference[]}
                                updateValue={updateValue}
                                size={size}
                                multiselect={true}
                                path={ofProp.path}
                                previewProperties={ofProp.previewProperties}
                                title={arrayProperty.name}
                                fixedFilter={ofProp.fixedFilter}
                                includeId={ofProp.includeId}
                                includeEntityLink={ofProp.includeEntityLink}
                            />
                        ),
                        allowScroll: false
                    };
                }
            }
        }
    }

    return undefined;
}
