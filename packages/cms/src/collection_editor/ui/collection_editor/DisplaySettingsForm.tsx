
import { FieldCaption } from "../../_cms_internals";
import React, { useMemo, useState } from "react";
import { useCustomizationController } from "@rebasepro/app";
import { getFieldConfig } from "../../../components/field_configs";
import { PropertyConfigBadge } from "../../../components/PropertyConfigBadge";
import { Property } from "@rebasepro/types";
import {
    BooleanSwitchWithLabel,
    Button,
    Container,
    IconButton,
    iconSize,
    Select,
    SelectItem,
    TextField,
    Typography,
    XIcon
} from "@rebasepro/ui";

import { useFormex } from "@rebasepro/forms";
import { LayoutModeSwitch } from "./LayoutModeSwitch";
import { ViewModeSwitch } from "./ViewModeSwitch";
import { KanbanConfigSection } from "./KanbanConfigSection";
import { PropertyFormDialog } from "./PropertyEditView";
import { useCollectionsConfigController } from "../../useCollectionsConfigController";
import { unslugify } from "@rebasepro/utils";
import type { AdminCollection } from "@rebasepro/cms-types";

export function DisplaySettingsForm({
    expandKanban,
    standalone,
}: {
    expandKanban?: boolean;
    standalone?: boolean;
}) {

    const {
        values,
        setFieldValue,
        handleChange,
        submitCount
    } = useFormex<AdminCollection>();

    const [orderPropertyDialogOpen, setOrderPropertyDialogOpen] = useState(false);

    const customizationController = useCustomizationController();
    const configControllerFromContext = useCollectionsConfigController();
    const configController = standalone ? { readOnly: false } : configControllerFromContext;

    // Get text properties (for orderProperty - uses string fractional indexing keys)
    const textProperties = useMemo(() => {
        const result: { key: string; label: string; property: Property; }[] = [];
        if (!values.properties) return result;

        Object.entries(values.properties).forEach(([key, prop]) => {
            if (prop && "type" in prop && prop.type === "string") {
                result.push({
                    key,
                    label: (prop as Property).name || key,
                    property: prop as Property
                });
            }
        });
        return result;
    }, [values.properties]);

    const showErrors = submitCount > 0;

    return (
        <div className={"overflow-auto my-auto"}>
            <Container maxWidth={"4xl"} className={"flex flex-col gap-4 p-8 m-auto"}>

                <div>
                    <Typography variant={"h5"} className={"flex-grow"}>
                        Display settings
                    </Typography>
                </div>

                <fieldset disabled={configController?.readOnly} className="contents">
                    <div className={"grid grid-cols-12 gap-4"}>

                        {/* Layout Mode (Side dialog vs Full screen) */}
                        <LayoutModeSwitch
                            className={"col-span-12"}
                            value={values.openEntityMode ?? "side_panel"}
                            onChange={(value) => setFieldValue("openEntityMode", value)}/>

                        {/* View Mode (Table/Cards/Kanban) */}
                        <ViewModeSwitch
                            className={"col-span-12"}
                            value={values.defaultViewMode ?? "table"}
                            onChange={(value) => setFieldValue("defaultViewMode", value)}/>

                        {/* Kanban Column Property */}
                        <KanbanConfigSection className={"col-span-12"} forceExpanded={expandKanban}/>

                        {/* Order Property */}
                        <div className={"col-span-12 mt-4"}>
                            {(() => {
                                const orderPropertyMissing = Boolean(values.orderProperty) &&
                                    !textProperties.some(p => p.key === values.orderProperty);

                                return (
                                    <>
                                        <Select
                                            key={`order-select-${textProperties.length}`}
                                            name="orderProperty"
                                            label="Order Property"
                                            fullWidth={true}
                                            position={"item-aligned"}
                                            disabled={textProperties.length === 0}
                                            error={orderPropertyMissing}
                                            value={values.orderProperty ?? ""}
                                            onValueChange={(v) => {
                                                setFieldValue("orderProperty", v || undefined);
                                            }}
                                            renderValue={(value) => {
                                                if (orderPropertyMissing) {
                                                    return <span className="text-red-500">{value} (not found)</span>;
                                                }
                                                const prop = textProperties.find(p => p.key === value);
                                                if (!prop) return "Select a property";
                                                const fieldConfig = getFieldConfig(prop.property, customizationController?.propertyConfigs ?? {});
                                                return (
                                                    <div className="flex items-center gap-2">
                                                        <PropertyConfigBadge propertyConfig={fieldConfig}/>
                                                        <span>{prop.label}</span>
                                                    </div>
                                                );
                                            }}
                                            endAdornment={values.orderProperty ? (
                                                <IconButton
                                                    size="small"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setFieldValue("orderProperty", undefined);
                                                    }}
                                                >
                                                    <XIcon size={iconSize.smallest}/>
                                                </IconButton>
                                            ) : undefined}
                                        >
                                            {textProperties.map((prop) => {
                                                const fieldConfig = getFieldConfig(prop.property, customizationController?.propertyConfigs ?? {});
                                                return (
                                                    <SelectItem key={prop.key} value={prop.key}>
                                                        <div className="flex items-center gap-3">
                                                            <PropertyConfigBadge propertyConfig={fieldConfig}/>
                                                            <div>
                                                                <div>{prop.label}</div>
                                                                <Typography variant="caption" color="secondary">
                                                                    {fieldConfig?.name || "Text"}
                                                                </Typography>
                                                            </div>
                                                        </div>
                                                    </SelectItem>
                                                );
                                            })}
                                        </Select>
                                        <FieldCaption error={orderPropertyMissing}>
                                            {orderPropertyMissing
                                                ? `Property "${values.orderProperty}" does not exist or is not a text property. Please select a valid property or clear the selection.`
                                                : textProperties.length === 0
                                                    ? "No text properties found. Add a text property to enable ordering."
                                                    : "Select a text property to persist the order of items"
                                            }
                                        </FieldCaption>
                                    </>
                                );
                            })()}
                            {(() => {
                                const orderPropertyMissing = Boolean(values.orderProperty) &&
                                    !textProperties.some(p => p.key === values.orderProperty);
                                const showCreateButton = !values.orderProperty || orderPropertyMissing;

                                const dialogPropertyKey = orderPropertyMissing && values.orderProperty
                                    ? values.orderProperty
                                    : "__order";
                                const dialogPropertyName = orderPropertyMissing && values.orderProperty
                                    ? unslugify(values.orderProperty)
                                    : "Order";

                                if (!showCreateButton) return null;

                                return (
                                    <>
                                        <Button
                                            variant="text"
                                            size="small"
                                            className="ml-3.5 mt-2"
                                            onClick={() => setOrderPropertyDialogOpen(true)}
                                        >
                                            + Create &quot;{dialogPropertyKey}&quot; property
                                        </Button>
                                        <PropertyFormDialog
                                            open={orderPropertyDialogOpen}
                                            onCancel={() => setOrderPropertyDialogOpen(false)}
                                            property={{
                                                type: "string",
                                                name: dialogPropertyName,
                                                admin: { disabled: true,
hideFromCollection: true }
                                            }}
                                            propertyKey={dialogPropertyKey}
                                            existingProperty={false}
                                            autoOpenTypeSelect={false}
                                            autoUpdateId={false}
                                            inArray={false}
                                            allowDataInference={false}
                                            propertyConfigs={customizationController?.propertyConfigs ?? {}}

                                            existingPropertyKeys={Object.keys(values.properties ?? {})}
                                            onPropertyChanged={({ id, property }) => {
                                                const newProperties = {
                                                    ...values.properties,
                                                    [id!]: property
                                                };
                                                const newPropertiesOrder = [...(values.propertiesOrder ?? Object.keys(values.properties ?? {})), id];
                                                setFieldValue("properties", newProperties);
                                                setFieldValue("propertiesOrder", newPropertiesOrder);
                                                setFieldValue("orderProperty", id);
                                                setOrderPropertyDialogOpen(false);
                                            }}
                                        />
                                    </>
                                );
                            })()}
                        </div>

                        {/* Default row size */}
                        <div className={"col-span-12"}>
                            <Select
                                name="defaultSize"
                                fullWidth={true}
                                label="Default row size"
                                position={"item-aligned"}
                                onChange={handleChange}
                                value={values.defaultSize ?? ""}
                                renderValue={(value: string) => value.toUpperCase()}
                            >
                                {["xs", "s", "m", "l", "xl"].map((value) => (
                                    <SelectItem
                                        key={`size-select-${value}`}
                                        value={value}>
                                        {value.toUpperCase()}
                                    </SelectItem>
                                ))}
                            </Select>
                        </div>

                        {/* Side dialog width */}
                        <div className={"col-span-12"}>
                            <TextField
                                name={"sideDialogWidth"}
                                type={"number"}
                                aria-describedby={"sideDialogWidth-helper"}
                                onChange={(e) => {
                                    const value = e.target.value;
                                    if (!value) {
                                        setFieldValue("sideDialogWidth", null);
                                    } else if (!isNaN(Number(value))) {
                                        setFieldValue("sideDialogWidth", Number(value));
                                    }
                                }}
                                endAdornment={<IconButton
                                    size={"small"}
                                    onClick={() => {
                                        setFieldValue("sideDialogWidth", null);
                                    }}
                                    disabled={!values.sideDialogWidth}>
                                    <XIcon size={iconSize.small}/>
                                </IconButton>}
                                value={values.sideDialogWidth ?? ""}
                                label={"Side dialog width"}/>
                            <FieldCaption>
                                Optionally define the width (in pixels) of entities side dialog. Default is 768px
                            </FieldCaption>
                        </div>

                        {/* Inline editing */}
                        <div className={"col-span-12"}>
                            <BooleanSwitchWithLabel
                                position={"start"}
                                label={values.inlineEditing === undefined || values.inlineEditing ? "Data can be edited directly in the table view" : "Data can be edited only in the form view"}
                                onValueChange={(v) => setFieldValue("inlineEditing", v)}
                                value={values.inlineEditing === undefined ? true : values.inlineEditing}
                            />
                            <FieldCaption>
                                Allow editing data directly in the table view, without opening the form view.
                            </FieldCaption>
                        </div>

                        {/* Include JSON view */}
                        <div className={"col-span-12"}>
                            <BooleanSwitchWithLabel
                                position={"start"}
                                label={values.includeJsonView === undefined || values.includeJsonView ? "Include JSON view" : "Do not include JSON view"}
                                onValueChange={(v) => setFieldValue("includeJsonView", v)}
                                value={values.includeJsonView === undefined ? true : values.includeJsonView}
                            />
                            <FieldCaption>
                                Allows removing the form view JSON tab if you think it is confusing for your users.
                            </FieldCaption>
                        </div>

                    </div>
                </fieldset>

                <div style={{ height: "52px" }}/>

            </Container>
        </div>
    );
}
