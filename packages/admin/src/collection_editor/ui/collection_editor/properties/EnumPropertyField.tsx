import React, { useMemo } from "react";
import { getIn, useFormex } from "@rebasepro/forms";
import { useTranslation } from "@rebasepro/app";
import { useSafeSnackbarController } from "../../../useSafeSnackbarController";
import { EnumValueConfig, EnumValues } from "@rebasepro/types";
import { resolveEnumValues } from "@rebasepro/common";
import { Select, SelectItem } from "@rebasepro/ui";
import { EnumForm } from "../EnumForm";
import { StringPropertyValidation } from "./validation/StringPropertyValidation";
import { ArrayPropertyValidation } from "./validation/ArrayPropertyValidation";
import { ValidationPanel } from "./validation/ValidationPanel";
import type { PropertyWithId } from "../PropertyEditView";

export function EnumPropertyField({
    multiselect,
    updateIds,
    disabled,
    showErrors,
    allowDataInference,
    getData,
    propertyNamespace
}: {
    multiselect: boolean;
    updateIds: boolean;
    disabled: boolean;
    showErrors: boolean;
    allowDataInference?: boolean;
    getData?: () => Promise<object[]>;
    propertyNamespace?: string;
}) {

    const {
        values,
        setFieldError,
        setFieldValue
    } = useFormex<PropertyWithId>();

    const snackbarContext = useSafeSnackbarController();
    const { t } = useTranslation();

    const enumValuesPath = multiselect ? "of.enum" : "enum";

    const defaultValue = getIn(values, "defaultValue") as string | number | undefined;

    const valuesEnumValues = getIn(values, enumValuesPath) as EnumValues | undefined;
    const enumValues: EnumValueConfig[] = useMemo(() => {
        if (!valuesEnumValues || typeof valuesEnumValues === "boolean")
            return [] as EnumValueConfig[];
        return resolveEnumValues(valuesEnumValues) ?? [] as EnumValueConfig[];
    }, [valuesEnumValues]);

    const onValuesChanged = (value: EnumValueConfig[]) => {
        if (!values)
            return;
        setFieldValue(enumValuesPath, value);
        if (!multiselect) {
            const enumIds = value.filter(v => Boolean(v?.id)).map((v: EnumValueConfig) => v.id);
            if (defaultValue && !enumIds.includes(defaultValue)) {
                setFieldValue("defaultValue", undefined);
                snackbarContext?.open({
                    type: "warning",
                    message: "Default value was cleared"
                })
            }
        }
    };

    // Build full path including namespace for nested properties (e.g., "address.status")
    const fullPropertyPath = values.id
        ? (propertyNamespace ? `${propertyNamespace}.${values.id}` : values.id)
        : undefined;

    return (
        <>
            <div className={"col-span-12"}>
                <EnumForm enumValues={enumValues}
                    updateIds={updateIds}
                    disabled={disabled}
                    allowDataInference={allowDataInference}
                    onError={(hasError) => {
                        setFieldError(enumValuesPath, hasError ? "This enum property is missing some values" : undefined);
                    }}
                    getData={getData && fullPropertyPath
                        ? () => getData()
                            .then(res => res.map(entry => getIn(entry, fullPropertyPath) as string).filter(Boolean))
                        : undefined}
                    onValuesChanged={onValuesChanged}/>
            </div>

            <div className={"col-span-12"}>

                <ValidationPanel>
                    {!multiselect &&
                        <StringPropertyValidation disabled={disabled}
                            showErrors={showErrors}/>}
                    {multiselect &&
                        <ArrayPropertyValidation disabled={disabled}/>}
                </ValidationPanel>

            </div>

            {!multiselect && <div className={"col-span-12"}>

                <Select
                    disabled={disabled}
                    position={"item-aligned"}
                    fullWidth={true}
                    onValueChange={(value: string) => {
                        setFieldValue("defaultValue", value);
                    }}
                    label={t("default_value")}
                    value={defaultValue?.toString() ?? ""}>
                    {enumValues
                        .filter((enumValue) => Boolean(enumValue?.id))
                        .map((enumValue) => (
                            <SelectItem key={enumValue.id}
                                value={enumValue.id?.toString()}>
                                {enumValue.label}
                            </SelectItem>
                        ))}
                </Select>

            </div>}
        </>
    );
}
