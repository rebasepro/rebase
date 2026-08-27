import type { FieldProps } from "../../types/fields";
import type { BooleanProperty } from "@rebasepro/types";
import React from "react";

;
import { getIconForProperty } from "../../util/property_utils";
import { FieldHelperText } from "../components/FieldHelperText";
import { LabelWithIcon } from "../components/LabelWithIcon";
import { BooleanSwitchWithLabel } from "@rebasepro/ui";
import { useClearRestoreValue } from "../useClearRestoreValue";
import { PropertyIdCopyTooltip } from "../../components/PropertyIdCopyTooltip";

/**
 * Simple boolean switch biding to a boolean property.
 *
 * This is one of the internal components that get mapped natively inside forms
 * and tables to the specified properties.
 * @group Form fields
 */
export const SwitchFieldBinding = function SwitchFieldBinding({
                                                                  propertyKey,
                                                                  value,
                                                                  setValue,
                                                                  error,
                                                                  showError,
                                                                  autoFocus,
                                                                  disabled,
                                                                  size = "large",
                                                                  property,
                                                                  includeDescription,
                                                                  hideLabel
                                                              }: FieldProps<BooleanProperty>) {

    useClearRestoreValue({
        property,
        value,
        setValue
    });

    return (
        <>

            <PropertyIdCopyTooltip propertyKey={propertyKey}>
                <BooleanSwitchWithLabel
                    value={value as boolean | null}
                    onValueChange={(v) => setValue(v)}
                    error={showError}
                    // The control is `justify-between`, so with the label lifted
                    // out the switch would drift to the far edge of an otherwise
                    // empty box. Anchor it to the start instead.
                    position={hideLabel ? "start" : undefined}
                    label={hideLabel ? undefined : <LabelWithIcon
                        icon={getIconForProperty(property, "small")}
                        required={property.validation?.required}
                        title={property.name ?? propertyKey}/>}
                    disabled={disabled}
                    autoFocus={autoFocus}
                    size={size}
                />
            </PropertyIdCopyTooltip>

            <FieldHelperText includeDescription={includeDescription}
                             showError={showError}
                             error={error}
                             disabled={disabled}
                             property={property}/>
        </>

    );
};
