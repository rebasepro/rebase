import React from "react";
import { useCustomizationController } from "@rebasepro/app";
import { Property } from "@rebasepro/types";
import { getFieldConfig } from "../../components/field_configs";
import { PropertyConfigBadge } from "../../components/PropertyConfigBadge";
import { ErrorBoundary, IconButton, PencilIcon, TextField } from "@rebasepro/ui";

export function ImportNewPropertyFieldPreview({
    propertyKey,
    property,
    onEditClick,
    includeName = true,
    onPropertyNameChanged,
    propertyTypeView
}: {
    propertyKey: string | null,
    property: Property | null
    includeName?: boolean,
    onEditClick?: () => void,
    onPropertyNameChanged?: (propertyKey: string, value: string) => void,
    propertyTypeView?: any
}) {

    const { propertyConfigs } = useCustomizationController();
    const widget = property ? getFieldConfig(property, propertyConfigs) : null;

    return <ErrorBoundary>
        <div
            className="flex flex-row w-full items-center">

            <div className={"mx-4"}>
                {propertyTypeView ?? <PropertyConfigBadge propertyConfig={widget ?? undefined}/>}
            </div>

            <div className="w-full flex flex-col grow">

                <div className={"flex flex-row items-center gap-2"}>
                    {includeName &&
                        <TextField
                            size={"medium"}
                            aria-label={propertyKey ? `Name of property ${propertyKey}` : "Property name"}
                            className={"text-base grow"}
                            value={property?.name ?? ""}
                            onChange={(e) => {
                                if (onPropertyNameChanged && propertyKey)
                                    onPropertyNameChanged(propertyKey, e.target.value);
                            }}/>}

                    <IconButton onClick={onEditClick} size={"small"}>
                        <PencilIcon/>
                    </IconButton>
                </div>

            </div>

        </div>
    </ErrorBoundary>
}
