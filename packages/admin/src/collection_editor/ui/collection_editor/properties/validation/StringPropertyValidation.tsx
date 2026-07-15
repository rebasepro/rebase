import { FieldCaption } from "../../../../_cms_internals";
import React from "react";

import { Field, FormexFieldProps, getIn, useFormex } from "@rebasepro/forms";
;
import { DebouncedTextField } from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";
import { GeneralPropertyValidation } from "./GeneralPropertyValidation";
import { SwitchControl } from "../../SwitchControl";
import { serializeRegExp } from "@rebasepro/utils";

export function StringPropertyValidation({
    length,
    lowercase,
    matches,
    max,
    min,
    trim,
    uppercase,
    disabled,
    showErrors
}: {
    length?: boolean;
    min?: boolean;
    max?: boolean;
    trim?: boolean;
    matches?: boolean;
    lowercase?: boolean;
    uppercase?: boolean;
    disabled: boolean;
    showErrors: boolean;
}) {

    const {
        values,
        handleChange,
        errors
    } = useFormex();
    const { t } = useTranslation();

    const validationLength = "validation.length";
    const validationMin = "validation.min";
    const validationMax = "validation.max";
    const validationTrim = "validation.trim";
    const validationMatches = "validation.matches";
    const validationLowercase = "validation.lowercase";
    const validationUppercase = "validation.uppercase";

    const matchesError = getIn(errors, validationMatches);

    const matchesValue = getIn(values, validationMatches);
    const matchesStringValue = typeof matchesValue === "string" ? matchesValue : serializeRegExp(matchesValue as RegExp);
    return (
        <div className={"grid grid-cols-12 gap-2"}>

            <GeneralPropertyValidation disabled={disabled}/>

            <div className={"grid grid-cols-12 gap-2 col-span-12"}>

                {lowercase && <div className={"col-span-4"}>
                    <Field name={validationLowercase}
                        type="checkbox">
                        {({ field, form }: FormexFieldProps) => {
                            return <SwitchControl
                                label={t("lowercase")}
                                disabled={disabled}
                                form={form}
                                field={field}/>
                        }}
                    </Field>
                </div>}

                {uppercase && <div className={"col-span-4"}>
                    <Field name={validationUppercase}
                        type="checkbox">
                        {({ field, form }: FormexFieldProps) => {
                            return <SwitchControl
                                label={t("uppercase")}
                                disabled={disabled}
                                form={form}
                                field={field}/>
                        }}
                    </Field>
                </div>}

                {trim && <div className={"col-span-4"}>
                    <Field name={validationTrim}
                        type="checkbox">
                        {({ field, form }: FormexFieldProps) => {
                            return <SwitchControl
                                label={t("trim")}
                                disabled={disabled}
                                form={form}
                                field={field}/>
                        }}
                    </Field>
                </div>}

            </div>

            <div className={"grid grid-cols-12 gap-2 col-span-12"}>
                {length && <div className={"col-span-4"}>
                    <DebouncedTextField
                        value={getIn(values, validationLength) as number | undefined}
                        label={t("exact_length")}
                        name={validationLength}
                        type="number"
                        size="small"

                        disabled={disabled}
                        onChange={handleChange}/>
                </div>}

                {min && <div className={"col-span-4"}>
                    <DebouncedTextField value={getIn(values, validationMin) as number | undefined}
                        label={t("min_length")}
                        name={validationMin}
                        type="number"
                        size="small"

                        disabled={disabled}
                        onChange={handleChange}/>
                </div>}

                {max && <div className={"col-span-4"}>
                    <DebouncedTextField value={getIn(values, validationMax) as number | undefined}
                        label={t("max_length")}
                        name={validationMax}
                        type="number"
                        size="small"

                        disabled={disabled}
                        onChange={handleChange}/>
                </div>}

            </div>

            {matches && <div className={"col-span-12"}>
                <Field name={validationMatches}
                    as={DebouncedTextField}
                    label={t("matches_regex")}
                    size="small"
                    disabled={disabled}
                    value={matchesStringValue}
                    error={Boolean(matchesError)}/>
                <FieldCaption error={Boolean(matchesError)}>
                    {matchesError ? t("not_valid_regexp") : t("regex_helper")}
                </FieldCaption>
            </div>}

        </div>
    );

}
