import type { FieldProps, PropertyFieldBindingProps } from "../../types/fields";
import type { MapProperty } from "@rebasepro/types";
import React from "react";
;
import { useTranslation } from "@rebasepro/app";

import { ErrorBoundary } from "@rebasepro/ui";
import { getIconForProperty } from "../../util/property_utils";
import { isDisabled, isHidden, isReadOnly } from "@rebasepro/app";
import { FieldHelperText } from "../components/FieldHelperText";
import { LabelWithIconAndTooltip } from "../components/LabelWithIconAndTooltip";
import { PropertyFieldBinding } from "../PropertyFieldBinding";
import { cls, ExpandablePanel } from "@rebasepro/ui";

/**
 * Field that renders the children property fields
 *
 * This is one of the internal components that get mapped natively inside forms
 * and tables to the specified properties.
 * @group Form fields
 */
export function MapFieldBinding({
    propertyKey,
    value,
    showError,
    error,
    disabled,
    property,
    partOfArray,
    minimalistView: minimalistViewProp,
    includeDescription,
    autoFocus,
    context,
    onPropertyChange
}: FieldProps<MapProperty>) {

    const expanded = property.admin?.expanded === undefined ? true : property.admin?.expanded;
    const minimalistView = minimalistViewProp || property.admin?.minimalistView;
    const { t } = useTranslation();

    if (!property.properties) {
        throw Error(`You need to specify a 'properties' prop (or specify a custom field) in your map property '${propertyKey}'${property.name ? ` ("${property.name}")` : ""}`);
    }

    const mapProperties = property.properties;

    const mapFormView = <>
        <div
            className={"py-1 flex flex-col space-y-2"}>
            {Object.entries(mapProperties)
                .filter(([_, property]) => !isHidden(property))
                .map(([entryKey, childProperty], index) => {
                    const thisDisabled = isReadOnly(childProperty) || isDisabled(childProperty);
                    const fieldBindingProps: PropertyFieldBindingProps<Record<string, unknown>> = {
                        propertyKey: `${propertyKey}.${entryKey}`,
                        disabled: disabled || thisDisabled,
                        property: childProperty,
                        includeDescription,
                        context,
                        partOfArray: false,
                        minimalistView: false,
                        autoFocus: autoFocus && index === 0,
                        onPropertyChange: function (updatedProperty) {
                            onPropertyChange?.({
                                properties: {
                                    [entryKey]: updatedProperty
                                }
                            } as Partial<MapProperty>);
                        }
                    };

                    return (
                        <div key={`map-${propertyKey}-${index}`} className={"relative"}>
                            <ErrorBoundary>
                                <PropertyFieldBinding
                                    {...fieldBindingProps}/>
                            </ErrorBoundary>
                        </div>
                    );
                }
                )
            }
        </div>


    </>
        ;

    return (
        <ErrorBoundary>

            {!minimalistView && <ExpandablePanel initiallyExpanded={expanded}
                onExpandedChange={(expanded: boolean) => {
                    onPropertyChange?.({
                        admin: { ...property.admin,
expanded }
                    });
                }}
                innerClassName={"px-2 md:px-4 pb-2 md:pb-4 pt-1 md:pt-2 bg-white dark:bg-surface-900"}
                title={<LabelWithIconAndTooltip
                    propertyKey={propertyKey}
                    icon={getIconForProperty(property, "small")}
                    required={property.validation?.required}
                    title={property.name ?? propertyKey}
                    className={"text-text-secondary dark:text-text-secondary-dark"}/>}>
                {mapFormView}
            </ExpandablePanel>}

            {minimalistView && mapFormView}

            <FieldHelperText includeDescription={includeDescription}
                showError={showError ?? false}
                error={error && !partOfArray ? error : undefined}
                disabled={disabled}
                property={property}/>

        </ErrorBoundary>
    );
}

