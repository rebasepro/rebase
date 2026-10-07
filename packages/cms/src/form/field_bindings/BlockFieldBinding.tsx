import type { FieldProps, FormContext, PropertyFieldBindingProps } from "../../types/fields";
import type { ArrayProperty, Property } from "@rebasepro/types";
import React, { useCallback, useEffect, useState } from "react";

import { FormexController, getIn, useFormexGetter, useFormexSelector } from "@rebasepro/forms";

import { FieldHelperText } from "../components/FieldHelperText";
import { LabelWithIcon } from "../components/LabelWithIcon";
import { PropertyFieldBinding } from "../PropertyFieldBinding";
import { EnumValuesChip } from "../../preview";

;
import { DEFAULT_ONE_OF_TYPE, DEFAULT_ONE_OF_VALUE, getDefaultValueFor } from "@rebasepro/common";
import { getIconForProperty } from "../../util/property_utils";
import { cls, ExpandablePanel, paperMixin, Select, SelectItem, Typography } from "@rebasepro/ui";
import { isDisabled, useTranslation } from "@rebasepro/app";
import { useClearRestoreValue } from "../useClearRestoreValue";
import { ArrayContainer, ArrayEntryParams } from "../../components/ArrayContainer";
import { mergeDeep } from "@rebasepro/utils";

/**
 * If the `oneOf` property is specified, this fields render each array entry as
 * a `type` select and the corresponding field widget to the selected `type.
 *
 * This is one of the internal components that get mapped natively inside forms
 * and tables to the specified properties.
 * @group Form fields
 */
export function BlockFieldBinding({
                                      propertyKey,
                                      value,
                                      error,
                                      showError,
                                      isSubmitting,
                                      setValue,
                                      setFieldValue,
                                      minimalistView: minimalistViewProp,
                                      property,
                                      includeDescription,
                                      underlyingValueHasChanged,
                                      context,
                                      disabled
                                  }: FieldProps<ArrayProperty>) {

    const minimalistView = minimalistViewProp || property.admin?.minimalistView;
    const { t } = useTranslation();

    if (!property.oneOf)
        throw Error("ArrayOneOfField misconfiguration. Property `oneOf` not set");

    const expanded = property.admin?.expanded === undefined ? true : property.admin?.expanded;
    useClearRestoreValue({
        property,
        value,
        setValue
    });

    const [lastAddedId, setLastAddedId] = useState<number | undefined>();

    const buildEntry = ({
                            index,
                            internalId,
                            storedProps,
                            storeProps
                        }: ArrayEntryParams) => {

        return <BlockEntry
            key={`array_one_of_${internalId}`}
            name={`${propertyKey}.${index}`}
            index={index}
            value={value[index]}
            typeField={property.oneOf!.typeField ?? DEFAULT_ONE_OF_TYPE}
            valueField={property.oneOf!.valueField ?? DEFAULT_ONE_OF_VALUE}
            properties={property.oneOf!.properties}
            autoFocus={internalId === lastAddedId}
            context={context}
            storeProps={storeProps}
            storedProps={storedProps}/>;
    };

    const title = (
        <LabelWithIcon
            propertyKey={propertyKey}
            icon={getIconForProperty(property, "small")}
            required={property.validation?.required}
            title={property.name ?? propertyKey}
            className={"text-text-secondary dark:text-text-secondary-dark"}/>
    );

    const firstOneOfKey = Object.keys(property.oneOf.properties)[0];
    const body = <ArrayContainer value={value}
                                 className={"flex flex-col gap-3"}
                                 droppableId={propertyKey}
                                 addLabel={property.name ? t("add_to_field", { fieldName: property.name }) : t("add_entry")}
                                 buildEntry={buildEntry}
                                 onInternalIdAdded={setLastAddedId}
                                 disabled={isSubmitting || isDisabled(property)}
                                 canAddElements={!isDisabled(property)}
                                 onValueChange={(value) => setFieldValue(propertyKey, value)}
                                 newDefaultEntry={{
                                     [property.oneOf!.typeField ?? DEFAULT_ONE_OF_TYPE]: firstOneOfKey,
                                     [property.oneOf!.valueField ?? DEFAULT_ONE_OF_VALUE]: getDefaultValueFor(property.oneOf.properties[firstOneOfKey])
                                 }}/>;
    return (

        <>

            {!minimalistView &&
                <ExpandablePanel
                    innerClassName={"px-2 md:px-4 pb-2 md:pb-4 pt-1 md:pt-2"}
                    initiallyExpanded={expanded}
                    title={title}>
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

interface BlockEntryProps {
    name: string;
    index: number;
    value: Record<string, unknown>;
    /**
     * Name of the field to use as the discriminator for type
     * Defaults to `type`
     */
    typeField: string;
    /**
     * Name of the  field to use as the value
     * Defaults to `value`
     */
    valueField: string;

    autoFocus: boolean;
    /**
     * Record of properties, where the key is the `type` and the value
     * is the corresponding property
     */
    properties: Record<string, Property>;

    /**
     * Additional values related to the state of the form or the entity
     */
    context: FormContext;

    storedProps?: object,
    storeProps: (props: object) => void

}

function BlockEntry({
                        name,
                        index,
                        value,
                        typeField,
                        valueField,
                        properties,
                        autoFocus,
                        context,
                        storedProps,
                        storeProps
                    }: BlockEntryProps) {

    const type = value && (value[typeField] as string | undefined);
    const [typeInternal, setTypeInternal] = useState<string | undefined>(type ?? undefined);

    const typeFieldName = `${name}.${typeField}`;
    const valueFieldName = `${name}.${valueField}`;

    // The picked type, and nothing else of the form: through `useFormex` every
    // entry of every block array — its type picker included — re-rendered on
    // every keystroke anywhere in the record.
    const selectType = useCallback((formex: FormexController) => getIn(formex.values, typeFieldName), [typeFieldName]);
    const typeValue = useFormexSelector(selectType);
    const getFormex = useFormexGetter();
    const { t } = useTranslation();

    useEffect(() => {
        if (!type) {
            // Auto-fix empty blocks silently — set the default type WITHOUT
            // marking as touched so the form doesn't become dirty on mount.
            const defaultType = Object.keys(properties)[0];
            const newSelectedProperty = defaultType ? properties[defaultType] : undefined;
            setTypeInternal(defaultType);
            const formex = getFormex();
            formex.setFieldValue(typeFieldName, defaultType);
            formex.setFieldValue(valueFieldName, newSelectedProperty ? getDefaultValueFor(newSelectedProperty) : null);
        }
    }, []);

    useEffect(() => {
        if (type !== typeInternal) {
            setTypeInternal(type);
        }
    }, [type]);

    const propertyInternal = typeInternal ? properties[typeInternal] : undefined;

    const property = storedProps && typeof propertyInternal === "object" ? mergeDeep(propertyInternal, storedProps) : propertyInternal;

    const enumValuesConfigs = Object.entries(properties)
        .map(([key, property]) => ({
            id: key,
            label: property.name ?? key
        }));

    const fieldProps: PropertyFieldBindingProps | undefined = property
        ? {
            propertyKey: valueFieldName,
            property,
            context,
            autoFocus,
            partOfArray: false,
            partOfBlock: true,
            minimalistView: true,
            onPropertyChange: storeProps
        }
        : undefined;

    const updateType = (newType: string | undefined) => {
        const newSelectedProperty = newType ? properties[newType] : undefined;
        setTypeInternal(newType);
        const formex = getFormex();
        formex.setFieldTouched(typeFieldName, true);
        formex.setFieldValue(typeFieldName, newType);
        formex.setFieldValue(valueFieldName, newSelectedProperty ? getDefaultValueFor(newSelectedProperty) : null);
    };

    return (
        <div className={cls(paperMixin, "bg-transparent p-2")}>

            <Select
                className="mb-2"
                // The placeholder is an element, so this
                // control had no name of its own either.
                aria-label={t("type")}
                placeholder={<Typography variant={"caption"}
                                         className={"px-4 py-2 font-medium"}>{t("type")}</Typography>}
                size={"medium"}
                fullWidth={true}
                position={"item-aligned"}
                value={typeValue !== undefined && typeValue !== null ? typeValue as string : ""}
                renderValue={(enumKey: string) =>
                    <EnumValuesChip
                        enumKey={enumKey}
                        enumValues={enumValuesConfigs}
                        size={"small"}/>
                }
                onValueChange={(value) => {
                    updateType(value);
                }}>
                {enumValuesConfigs.map((enumConfig) => (
                    <SelectItem
                        key={enumConfig.id}
                        value={String(enumConfig.id)}>
                        <EnumValuesChip
                            enumKey={enumConfig.id}
                            enumValues={enumValuesConfigs}
                            size={"small"}/>
                    </SelectItem>)
                )}
            </Select>

            {fieldProps && (
                // It is important to use this key to force a re-render of the field on type change
                <PropertyFieldBinding key={`form_control_${name}_${typeInternal}`} {...fieldProps}/>
            )}

        </div>
    );
}
