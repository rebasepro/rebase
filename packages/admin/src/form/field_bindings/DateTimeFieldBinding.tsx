import type { FieldProps } from "../../types/fields";
import type { DateProperty } from "@rebasepro/types";
import React from "react";

;

import { FieldHelperText } from "../components/FieldHelperText";
import { LabelWithIcon } from "../components/LabelWithIcon";
import { useCustomizationController } from "@rebasepro/app";
import { getIconForProperty } from "../../util/property_utils";
import { DateTimeField } from "@rebasepro/ui";
import { useClearRestoreValue } from "../useClearRestoreValue";
import { PropertyIdCopyTooltip } from "../../components/PropertyIdCopyTooltip";

type DateTimeFieldProps = FieldProps<DateProperty>;

/**
 * Field that allows selecting a date
 *
 * This is one of the internal components that get mapped natively inside forms
 * and tables to the specified properties.
 * @group Form fields
 */
export function DateTimeFieldBinding({
    propertyKey,
    value,
    setValue,
    autoFocus,
    error,
    showError,
    disabled,
    touched,
    property,
    includeDescription,
    hideLabel
}: DateTimeFieldProps) {

    const { locale } = useCustomizationController();
    const internalValue = value || null;

    useClearRestoreValue({
        property,
        value,
        setValue
    });

    return (
        <>
            <PropertyIdCopyTooltip propertyKey={propertyKey}>
                <DateTimeField
                    value={internalValue}
                    onChange={(dateValue) => setValue(dateValue)}
                    mode={property.mode}
                    clearable={property.admin?.clearable}
                    locale={locale}
                    error={showError}
                    disabled={disabled}
                    label={hideLabel ? undefined : <LabelWithIcon
                        icon={getIconForProperty(property, "small")}
                        required={property.validation?.required}
                        className={showError ? "text-red-500 dark:text-red-500" : "text-text-secondary dark:text-text-secondary-dark"}
                        title={property.name ?? propertyKey}/>}
                    // The entity form sets `hideLabel` for every field FieldBlock
                    // labels on its behalf, and FieldBlock's label is a <span> that
                    // points at nothing — so without this the control is nameless.
                    aria-label={hideLabel ? (property.name ?? propertyKey) : undefined}
                />
            </PropertyIdCopyTooltip>

            <FieldHelperText includeDescription={includeDescription}
                showError={showError}
                error={error}
                disabled={disabled}
                property={property}/>

        </>
    );
}
