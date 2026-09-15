import type { FieldProps } from "../../types/fields";
import type { NumberProperty, StringProperty } from "@rebasepro/types";
import React, { useCallback } from "react";

;
import { FieldHelperText } from "../components/FieldHelperText";
import { LabelWithIcon } from "../components/LabelWithIcon";
import { EnumValuesChip } from "../../preview";
import { getIconForProperty } from "../../util/property_utils";
import { cls, IconButton, Select, SelectItem, XIcon } from "@rebasepro/ui";
import { useClearRestoreValue } from "../useClearRestoreValue";
import { PropertyIdCopyTooltip } from "../../components/PropertyIdCopyTooltip";
import { resolveEnumValues } from "@rebasepro/common";

/**
 * If `enumValues` are set in the string config, this field renders a select
 * where each option is a colored chip.
 *
 * This is one of the internal components that get mapped natively inside forms
 * and tables to the specified properties.
 * @group Form fields
 */
export function SelectFieldBinding({
    propertyKey,
    value,
    setValue,
    error,
    showError,
    disabled,
    autoFocus,
    touched,
    property,
    includeDescription,
    hideLabel,
    size = "large"
}: FieldProps<StringProperty | NumberProperty>) {

    const enumValues = resolveEnumValues(property.enum ?? []);

    useClearRestoreValue({
        property,
        value,
        setValue
    });

    const handleClearClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        setValue(null);
    }, [setValue]);

    return (
        <>

            <Select
                value={value !== undefined && value != null ? value.toString() : ""}
                // The visible label is an element (icon + tooltip), which the
                // control cannot read a name from, so it announced itself as
                // "Select an option" — the same name for every enum field in
                // every form. Named here, where the property is.
                aria-label={property.name ?? propertyKey}
                disabled={disabled}
                size={size}
                fullWidth={true}
                position="item-aligned"
                inputClassName={cls("w-full")}
                label={hideLabel ? undefined : (
                    <PropertyIdCopyTooltip propertyKey={propertyKey}>
                        <LabelWithIcon
                            icon={getIconForProperty(property, "small")}
                            required={property.validation?.required}
                            title={property.name ?? propertyKey}
                            className={"h-8 text-text-secondary dark:text-text-secondary-dark ml-3.5 my-0"}
                        />
                    </PropertyIdCopyTooltip>)}
                endAdornment={
                    property.admin?.clearable && !disabled && <IconButton
                        size="small"
                        onClick={handleClearClick}>
                        <XIcon/>
                    </IconButton>
                }
                onValueChange={(updatedValue: string) => {
                    const newValue = updatedValue
                        ? (property.type === "number" ? parseFloat(updatedValue) : updatedValue)
                        : null;
                    return setValue(newValue);
                }}
                renderValue={(enumKey: string) => {
                    return <EnumValuesChip
                        enumKey={enumKey}
                        enumValues={enumValues}
                        size={size}/>;
                }}
            >
                {enumValues && enumValues.map((option) => {
                    return <SelectItem
                        key={option.id}
                        value={String(option.id)}>
                        <EnumValuesChip
                            enumKey={String(option.id)}
                            enumValues={enumValues}
                            size={size}/>
                    </SelectItem>
                })}
            </Select>

            <FieldHelperText includeDescription={includeDescription}
                showError={showError}
                error={error}
                disabled={disabled}
                property={property}/>

        </>
    );
}
