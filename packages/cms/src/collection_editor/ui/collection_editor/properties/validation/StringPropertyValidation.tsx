import { FieldCaption } from "../../../../_cms_internals";
import React from "react";

import { Field, FormexFieldProps, getIn, useFormex } from "@rebasepro/forms";
;
import { Alert, DebouncedTextField } from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";
import { GeneralPropertyValidation } from "./GeneralPropertyValidation";
import { SwitchControl } from "../../SwitchControl";
import { serializeRegExp } from "@rebasepro/utils";

/** The column types whose width `validation.max` sets. */
const SIZED_COLUMN_TYPES = ["varchar", "char"];

const widthOf = (value: unknown): number | undefined => {
    const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
    return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;
};

/**
 * The narrower width an edit gives an existing `varchar` or `char` column, or
 * `undefined` when it gives none.
 *
 * On those column types `max` is the column's width, so a smaller one — or a
 * first one on an unbounded `varchar` — is a DDL change on a table that may
 * hold longer values. A property the form did not start from (a new one) has
 * no column yet, and a `text` column's `max` is a form rule only.
 */
export function narrowedColumnWidth(initialValues: unknown, values: unknown): number | undefined {
    const initialType = getIn(initialValues, "columnType");
    const columnType = getIn(values, "columnType");
    if (typeof columnType !== "string" || !SIZED_COLUMN_TYPES.includes(columnType)) return undefined;
    if (initialType !== columnType) return undefined;
    const to = widthOf(getIn(values, "validation.max"));
    if (to === undefined) return undefined;
    const from = widthOf(getIn(initialValues, "validation.max"));
    if (from === undefined) return columnType === "varchar" ? to : undefined;
    return to < from ? to : undefined;
}

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
        initialValues,
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
    const narrowedWidth = max ? narrowedColumnWidth(initialValues, values) : undefined;

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

                {narrowedWidth !== undefined && <div className={"col-span-12"}>
                    <Alert color="warning" size="small">
                        {t("varchar_narrowing_warning", {
                            columnType: getIn(values, "columnType") as string,
                            max: narrowedWidth
                        })}
                    </Alert>
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
