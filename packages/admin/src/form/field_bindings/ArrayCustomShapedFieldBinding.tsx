import type { FieldProps } from "../../types/fields";
import type { ArrayProperty, Property } from "@rebasepro/types";
import React from "react";
;
import { FieldHelperText } from "../components/FieldHelperText";
import { LabelWithIconAndTooltip } from "../components/LabelWithIconAndTooltip";
import { PropertyFieldBinding } from "../PropertyFieldBinding";
import { ExpandablePanel, Typography } from "@rebasepro/ui";
import { getArrayResolvedProperties } from "@rebasepro/common";
import { isDisabled, isReadOnly } from "@rebasepro/app";
import { getIconForProperty } from "../../util/property_utils";
import { useClearRestoreValue } from "../useClearRestoreValue";
import { useAuthController } from "@rebasepro/app";

/**
 * Array field used for custom
 *
 * This is one of the internal components that get mapped natively inside forms
 * and tables to the specified properties.
 * @group Form fields
 */
export function ArrayCustomShapedFieldBinding({
    propertyKey,
    value,
    error,
    showError,
    isSubmitting,
    setValue,
    setFieldValue,
    customProps,
    minimalistView: minimalistViewProp,
    property,
    includeDescription,
    context,
    disabled
}: FieldProps<ArrayProperty | ArrayProperty>) {

    const authController = useAuthController();
    const minimalistView = minimalistViewProp || property.admin?.minimalistView;

    const resolvedProperties: Property[] | undefined = getArrayResolvedProperties({
        propertyValue: value,
        propertyKey,
        property,
        ignoreMissingFields: false,
        authController
    })

    const expanded = property.admin?.expanded === undefined ? true : property.admin?.expanded;

    useClearRestoreValue({
        property,
        value,
        setValue
    });

    const title = (<>
        <LabelWithIconAndTooltip
            propertyKey={propertyKey}
            icon={getIconForProperty(property, "small")}
            required={property.validation?.required}
            title={property.name ?? propertyKey}
            className={"h-8 grow text-text-secondary dark:text-text-secondary-dark"}/>
        {Array.isArray(value) && <Typography variant={"caption"} className={"px-4"}>({value.length})</Typography>}
    </>);

    const body = (resolvedProperties ?? []).map((childProperty, index) => {
        const thisDisabled = isReadOnly(childProperty) || isDisabled(childProperty);
        const fieldProps = {
            propertyKey: `${propertyKey}[${index}]`,
            disabled: disabled || thisDisabled,
            property: childProperty,
            includeDescription,
            context,
            partOfArray: true,
            minimalistView: false,
            autoFocus: false,
            value,
            setValue,
            setFieldValue,
            customProps
        } as FieldProps;
        return <div key={`custom_shaped_array_${index}`} className="pb-4">
            <PropertyFieldBinding {...fieldProps}/>
        </div>;
    });

    return (

        <>

            {!minimalistView &&
                <ExpandablePanel initiallyExpanded={expanded}
                    title={title}
                    innerClassName={"px-2 md:px-4 pb-2 md:pb-4 pt-1 md:pt-2"}>
                    {body}
                </ExpandablePanel>}

            {minimalistView && body}

            <FieldHelperText includeDescription={includeDescription}
                showError={showError}
                error={error}
                disabled={disabled}
                property={property}/>

        </>
    );
}
