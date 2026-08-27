import type { FieldProps } from "../../types/fields";
import type { StringProperty } from "@rebasepro/types";
import React from "react";

import { FieldHelperText } from "../components/FieldHelperText";
import { LabelWithIcon } from "../components/LabelWithIcon";
import { getIconForProperty } from "../../util/property_utils";
import { PropertyIdCopyTooltip } from "../../components/PropertyIdCopyTooltip";
import { UserSelector } from "../../components/UserSelector";

type UserSelectProps = FieldProps<StringProperty>;

/**
 * Field binding for selecting a user from the internal user management system.
 * Renders a searchable popover dropdown with user information including name and email,
 * with server-side search and pagination support.
 *
 * This is one of the internal components that get mapped natively inside forms
 * and tables to the specified properties.
 * @group Form fields
 */
export function UserSelectFieldBinding({
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
                                       }: UserSelectProps) {

    // Passed straight through. Mapping the form's `large` onto the selector's
    // `medium` produced a 56px box next to 48px text fields — the labels lined
    // up and the boxes did not.
    const selectorSize = size;

    return (
        <>
            {!hideLabel && <PropertyIdCopyTooltip propertyKey={propertyKey}>
                <LabelWithIcon
                    icon={getIconForProperty(property, "small")}
                    required={property.validation?.required}
                    title={property.name}
                    className={"h-8 text-text-secondary dark:text-text-secondary-dark ml-3.5 my-0"}
                />
            </PropertyIdCopyTooltip>}

            <UserSelector
                value={value as string | null | undefined}
                onValueChange={(userId) => {
                    setValue(userId);
                }}
                disabled={disabled}
                clearable={property.admin?.clearable}
                size={selectorSize}
            />

            <FieldHelperText includeDescription={includeDescription}
                             showError={showError}
                             error={error}
                             disabled={disabled}
                             property={property}/>

        </>
    );
}
