import { useTranslation } from "@rebasepro/app";
import type { FieldProps } from "../../types/fields";
import type { NumberProperty, StringProperty } from "@rebasepro/types";
import React, { useCallback, useId } from "react";

import { FieldHelperText } from "../components/FieldHelperText";
import { LabelWithIcon } from "../components/LabelWithIcon";
import { EnumValuesChip } from "../../preview";
import { getIconForProperty } from "../../util/property_utils";
import { cls, IconButton, InputLabel, Select, SelectItem, XIcon } from "@rebasepro/ui";
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
    const { t } = useTranslation();

    const enumValues = resolveEnumValues(property.enum ?? []);

    const handleClearClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        setValue(null);
    }, [setValue]);

    const triggerId = useId();
    const hasValue = value !== undefined && value !== null && value !== "";

    // `undefined` rather than an empty element, as in the text field: the box
    // only makes room for a label when there is one to draw.
    const label = hideLabel
        ? undefined
        : <LabelWithIcon
            icon={getIconForProperty(property, "small")}
            required={property.validation?.required}
            title={property.name ?? propertyKey}/>;
    // Inside the box at the form's size; a smaller select has no room for a
    // label in its top edge, and keeps it above as the kit draws it.
    const labelInside = Boolean(label) && size === "large";

    return (
        <>
            {/* The label goes INSIDE the box, as a text field's does: the kit's
                own floating label, shrunk into the top edge once there is a
                value and resting in the middle while there is none. `Select`
                can only put a label above its box, so it is laid over the box
                here — `top-[5px] left-px` is where a TextField's label lands,
                1px in from its border — and the value is pushed down under it.
                Same 64px as a text field, so two of them paired on a row line
                up. */}
            <div className={"relative"}>
                <Select
                    id={triggerId}
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
                    inputClassName={cls("w-full", labelInside && "min-h-[64px] pl-3")}
                    label={label && !labelInside
                        ? <LabelWithIcon
                            icon={getIconForProperty(property, "small")}
                            required={property.validation?.required}
                            title={property.name ?? propertyKey}
                            propertyKey={propertyKey}
                            className={"h-8 text-text-secondary dark:text-text-secondary-dark ml-3.5 my-0"}/>
                        : undefined}
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
                    renderValue={(enumKey: string) => {
                        const chip = <EnumValuesChip
                            enumKey={enumKey}
                            enumValues={enumValues}
                            size={size}/>;
                        // Pushed down under the label inside the value slot,
                        // not by padding the trigger: the chip lands on the line
                        // a text field's value sits on beside it, and the
                        // chevron stays centred in the box, where a text
                        // field's buttons are.
                        return labelInside ? <div className={"pt-6"}>{chip}</div> : chip;
                    }}
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
                {labelInside && (
                    <InputLabel htmlFor={triggerId}
                        shrink={hasValue}
                        className={cls(
                            "pointer-events-none absolute top-[5px] left-px",
                            disabled
                                ? "text-text-disabled dark:text-text-disabled-dark"
                                : showError && error
                                    ? "text-red-500 dark:text-red-600"
                                    : "text-text-secondary dark:text-text-secondary-dark"
                        )}>
                        {label}
                    </InputLabel>
                )}
            </div>

            <FieldHelperText includeDescription={includeDescription}
                showError={showError}
                error={error}
                disabled={disabled}
                property={property}/>

        </>
    );
}
