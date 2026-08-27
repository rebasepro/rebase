import React from "react";

import { Field, FormexFieldProps, getIn, useFormex } from "@rebasepro/forms";
import { DebouncedTextField } from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";
import { GeneralPropertyValidation } from "./GeneralPropertyValidation";
import { SwitchControl } from "../../SwitchControl";

export function NumberPropertyValidation({ disabled }: {
    disabled: boolean;
}) {

    const {
        values,
        handleChange
    } = useFormex();
    const { t } = useTranslation();

    const validationMin = "validation.min";
    const validationMax = "validation.max";
    const validationLessThan = "validation.lessThan";
    const validationMoreThan = "validation.moreThan";
    const validationPositive = "validation.positive";
    const validationNegative = "validation.negative";
    const validationInteger = "validation.integer";

    return (

        <div className={"grid grid-cols-12 gap-2"}>
            <GeneralPropertyValidation disabled={disabled}/>


            <div className={"col-span-6"}>
                <DebouncedTextField value={getIn(values, validationMin) as number | undefined}
                    label={t("min_value")}
                    name={validationMin}
                    type="number"
                    size="small"
                    disabled={disabled}
                    onChange={handleChange}/>
            </div>

            <div className={"col-span-6"}>
                <DebouncedTextField value={getIn(values, validationMax) as number | undefined}
                    label={t("max_value")}
                    name={validationMax}
                    type="number"
                    size="small"
                    disabled={disabled}
                    onChange={handleChange}/>
            </div>


            <div className={"col-span-6"}>
                <DebouncedTextField
                    value={getIn(values, validationLessThan) as number | undefined}
                    label={t("less_than")}
                    name={validationLessThan}
                    type="number"
                    size="small"
                    disabled={disabled}
                    onChange={handleChange}/>
            </div>

            <div className={"col-span-6"}>
                <DebouncedTextField
                    value={getIn(values, validationMoreThan) as number | undefined}
                    label={t("more_than")}
                    name={validationMoreThan}
                    type="number"
                    size="small"
                    disabled={disabled}
                    onChange={handleChange}/>
            </div>

            <div className={"col-span-4"}>
                <Field name={validationPositive}
                    type="checkbox">
                    {({ field, form }: FormexFieldProps) => {
                        return <SwitchControl
                            label={t("positive_value")}
                            disabled={disabled}
                            form={form}
                            field={field}/>
                    }}
                </Field>
            </div>
            <div className={"col-span-4"}>
                <Field name={validationNegative}
                    type="checkbox">
                    {({ field, form }: FormexFieldProps) => {
                        return <SwitchControl
                            label={t("negative_value")}
                            disabled={disabled}
                            form={form}
                            field={field}/>
                    }}
                </Field>
            </div>
            <div className={"col-span-4"}>
                <Field name={validationInteger}
                    type="checkbox">
                    {({ field, form }: FormexFieldProps) => {
                        return <SwitchControl
                            label={t("integer_value")}
                            disabled={disabled}
                            form={form}
                            field={field}/>
                    }}
                </Field>
            </div>
        </div>
    );
}
