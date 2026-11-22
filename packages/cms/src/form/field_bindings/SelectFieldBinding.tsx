import { useTranslation } from "@rebasepro/app";
import type { FieldProps } from "../../types/fields";
import type { NumberProperty, StringProperty } from "@rebasepro/cms-types";
import React, { useCallback } from "react";

import { FieldHelperText } from "../components/FieldHelperText";
import { LabelWithIcon } from "../components/LabelWithIcon";
import { EnumValuesChip } from "../../preview";
import { getIconForProperty } from "../../util/property_utils";
import { cls, IconButton, Select, SelectItem, XIcon } from "@rebasepro/ui";
import { resolveEnumValues } from "@rebasepro/cms-types";

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
    const { t } = useTranslation();

    const enumValues = resolveEnumValues(property.enum ?? []);

    const handleClearClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        setValue(null);
    }, [setValue]);

    // `undefined` rather than an empty element, as in the text field: the box
    // only makes room for a label when there is one to draw. `Select` puts it
    // inside the box at every size a form field takes, as the text field does.
    const label = hideLabel
        ? undefined
        : <LabelWithIcon
            icon={getIconForProperty(property, "small")}
            required={property.validation?.required}
            title={property.name ?? propertyKey}/>;

    return (
        <>
            <Select
                value={value !== undefined && value != null ? value.toString() : ""}
                // The visible label is an element (icon + tooltip), so the
                // trigger is named here, where the property is, rather than
                // from the label's text, which would read the icon's title too.
                aria-label={property.name ?? propertyKey}
                disabled={disabled}
                error={Boolean(showError && error)}
                size={size}
                fullWidth={true}
                position="item-aligned"
                // 64px at the form's size, the height of a text field beside it,
                // whose value is a 16px line where the kit's is 14px.
                inputClassName={cls("w-full", label && size === "large" && "min-h-[64px]")}
                label={label}
                endAdornment={
                    property.admin?.clearable && !disabled && <IconButton aria-label={t("clear")}
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
                renderValue={(enumKey: string) => <EnumValuesChip
                    enumKey={enumKey}
                    enumValues={enumValues}
                    size={size}/>}
            >
                {enumValues && enumValues.map((option) => {
                    return <SelectItem
                        key={option.id}
                        value={String(option.id)}
                        textValue={option.label}>
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
