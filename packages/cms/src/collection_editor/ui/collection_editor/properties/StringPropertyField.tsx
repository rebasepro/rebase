import { FieldCaption } from "../../../_cms_internals";
import React from "react";
import { StringPropertyValidation } from "./validation/StringPropertyValidation";
import { ValidationPanel } from "./validation/ValidationPanel";
import { getIn, useFormex } from "@rebasepro/forms";
import { useTranslation } from "@rebasepro/app";
;
import { Select, SelectItem, TextField } from "@rebasepro/ui";

export function StringPropertyField({
    widgetId,
    disabled,
    showErrors
}: {
    widgetId: "text_field" | "multiline" | "email" | "user_select";
    disabled: boolean;
    showErrors: boolean;
}) {

    const { values, setFieldValue, touched, errors } = useFormex();
    const { t } = useTranslation();

    const columnTypePath = "columnType";
    const columnTypeValue: string | undefined = getIn(values, columnTypePath) as string | undefined;
    const columnTypeError: string | undefined = (getIn(touched, columnTypePath) && getIn(errors, columnTypePath)) as string | undefined;

    const isIdPath = "isId";
    const isIdValue: string | boolean | undefined = getIn(values, isIdPath) as string | boolean | undefined;
    const isIdError: string | undefined = (getIn(touched, isIdPath) && getIn(errors, isIdPath)) as string | undefined;

    return (
        <>
            <div className={"col-span-12"}>

                <ValidationPanel>

                    {widgetId === "text_field" &&
                        <StringPropertyValidation disabled={disabled}
                            length={true}
                            lowercase={true}
                            matches={true}
                            max={true}
                            min={true}
                            trim={true}
                            uppercase={true}
                            showErrors={showErrors}/>}
                    {widgetId === "user_select" &&
                        <StringPropertyValidation disabled={disabled}
                            showErrors={showErrors}/>}

                    {widgetId === "multiline" &&
                        <StringPropertyValidation disabled={disabled}
                            length={true}
                            lowercase={true}
                            max={true}
                            min={true}
                            trim={true}
                            uppercase={true}
                            showErrors={showErrors}/>}

                    {widgetId === "email" &&
                        <StringPropertyValidation disabled={disabled}
                            max={true}
                            min={true}
                            trim={true}
                            showErrors={showErrors}/>}

                </ValidationPanel>

            </div>

            <div className={"col-span-12"}>
                <Select name={columnTypePath}
                    disabled={disabled || Boolean(isIdValue)}
                    fullWidth={true}
                    value={isIdValue === "uuid" ? "uuid" : (columnTypeValue ?? "_default_")}
                    onValueChange={(v) => setFieldValue(columnTypePath, v === "_default_" ? undefined : v)}
                    renderValue={(v) => {
                        if (isIdValue === "uuid") return t("column_type_uuid_forced");
                        switch (v) {
                            case "text": return t("column_type_text");
                            case "char": return t("column_type_char");
                            case "varchar": return t("column_type_varchar");
                            // No `columnType` is a TEXT column: what the schema
                            // planner creates for a string that names none.
                            case "_default_": return t("column_type_default", { type: "text" });
                            default: return t("column_type_default", { type: "text" });
                        }
                    }}
                    error={Boolean(columnTypeError)}
                    label={t("db_column_type")}>
                    {isIdValue === "uuid" && <SelectItem value={"uuid"}>{t("column_type_uuid_forced")}</SelectItem>}
                    <SelectItem value={"_default_"}>{t("column_type_default", { type: "text" })}</SelectItem>
                    <SelectItem value={"varchar"}>{t("column_type_varchar")}</SelectItem>
                    <SelectItem value={"text"}>{t("column_type_text")}</SelectItem>
                    <SelectItem value={"char"}>{t("column_type_char")}</SelectItem>
                </Select>
                <FieldCaption error={Boolean(columnTypeError)}>
                    {columnTypeError ?? t("column_type_caption_string")}
                </FieldCaption>
            </div>

            <div className={"col-span-12"}>
                <Select name={isIdPath}
                    disabled={disabled}
                    fullWidth={true}
                    value={isIdValue === true ? "true" : (isIdValue === false ? "false" : (isIdValue ?? "_default_"))}
                    onValueChange={(v) => {
                        if (v === "_default_" || v === "false") setFieldValue(isIdPath, undefined);
                        else if (v === "true") setFieldValue(isIdPath, true);
                        else setFieldValue(isIdPath, v);
                    }}
                    renderValue={(v) => {
                        switch (v) {
                            case "true": return t("primary_key_generated_string");
                            case "manual": return t("primary_key_manual");
                            case "uuid": return t("primary_key_strategy", { strategy: "UUID" });
                            case "cuid": return t("primary_key_strategy", { strategy: "CUID" });
                            case "false":
                            case "_default_": return t("no");
                            default: return t("primary_key_strategy", { strategy: v });
                        }
                    }}
                    error={Boolean(isIdError)}
                    label={t("primary_key_unique_id")}>
                    <SelectItem value={"_default_"}>{t("no")}</SelectItem>
                    <SelectItem value={"manual"}>{t("primary_key_manual")}</SelectItem>
                    <SelectItem value={"true"}>{t("primary_key_generated_string")}</SelectItem>
                    <SelectItem value={"uuid"}>{t("primary_key_strategy", { strategy: "UUID" })}</SelectItem>
                    <SelectItem value={"cuid"}>{t("primary_key_strategy", { strategy: "CUID" })}</SelectItem>
                </Select>
                <FieldCaption error={Boolean(isIdError)}>
                    {isIdError ?? t("primary_key_caption")}
                </FieldCaption>
            </div>

            <div className={"col-span-12"}>

                <TextField name={"defaultValue"}
                    disabled={disabled}
                    onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                        setFieldValue("defaultValue", e.target.value === "" ? undefined : e.target.value);
                    }}
                    label={t("default_value")}
                    value={(getIn(values, "defaultValue") as string | undefined) ?? ""}/>

            </div>
        </>
    );
}
