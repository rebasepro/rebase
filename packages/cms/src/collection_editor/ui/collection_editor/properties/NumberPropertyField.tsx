import { FieldCaption } from "../../../_cms_internals";
import React from "react";
import { NumberPropertyValidation } from "./validation/NumberPropertyValidation";
import { ValidationPanel } from "./validation/ValidationPanel";
;
import { Select, SelectItem, TextField } from "@rebasepro/ui";
import { getIn, useFormex } from "@rebasepro/forms";
import { useTranslation } from "@rebasepro/app";

export function NumberPropertyField({ disabled }: {
    disabled: boolean;
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
                    <NumberPropertyValidation disabled={disabled}/>
                </ValidationPanel>

            </div>

            <div className={"col-span-12"}>
                <Select name={columnTypePath}
                    disabled={disabled || Boolean(isIdValue)}
                    fullWidth={true}
                    value={columnTypeValue ?? "_default_"}
                    onValueChange={(v) => setFieldValue(columnTypePath, v === "_default_" ? undefined : v)}
                    renderValue={(v) => {
                        switch (v) {
                            case "integer": return "integer";
                            case "real": return "real (float4)";
                            case "double precision": return "double precision (float8)";
                            case "numeric": return "numeric / decimal";
                            case "bigint": return "bigint";
                            case "serial": return "serial";
                            case "bigserial": return "bigserial";
                            case "_default_": return t("column_type_default", { type: "integer/numeric" });
                            default: return t("column_type_default", { type: "integer/numeric" });
                        }
                    }}
                    error={Boolean(columnTypeError)}
                    label={t("db_column_type")}>
                    <SelectItem value={"_default_"}>{t("column_type_default", { type: "integer/numeric" })}</SelectItem>
                    <SelectItem value={"integer"}> integer </SelectItem>
                    <SelectItem value={"real"}> real (float4) </SelectItem>
                    <SelectItem value={"double precision"}> double precision (float8) </SelectItem>
                    <SelectItem value={"numeric"}> numeric / decimal </SelectItem>
                    <SelectItem value={"bigint"}> bigint </SelectItem>
                    <SelectItem value={"serial"}> serial </SelectItem>
                    <SelectItem value={"bigserial"}> bigserial </SelectItem>
                </Select>
                <FieldCaption error={Boolean(columnTypeError)}>
                    {columnTypeError ?? t("column_type_caption_number")}
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
                            case "true": return t("primary_key_identity");
                            case "increment": return t("primary_key_increment");
                            case "manual": return t("primary_key_manual");
                            case "false":
                            case "_default_": return t("no");
                            default: return t("primary_key_strategy", { strategy: v });
                        }
                    }}
                    error={Boolean(isIdError)}
                    label={t("primary_key_unique_id")}>
                    <SelectItem value={"_default_"}>{t("no")}</SelectItem>
                    <SelectItem value={"manual"}>{t("primary_key_manual")}</SelectItem>
                    <SelectItem value={"true"}>{t("primary_key_identity")}</SelectItem>
                    <SelectItem value={"increment"}>{t("primary_key_increment")}</SelectItem>
                </Select>
                <FieldCaption error={Boolean(isIdError)}>
                    {isIdError ?? t("primary_key_caption")}
                </FieldCaption>
            </div>

            <div className={"col-span-12"}>

                <TextField name={"defaultValue"}
                    disabled={disabled}
                    type={"number"}
                    onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                        setFieldValue("defaultValue", e.target.value === "" ? undefined : parseFloat(e.target.value));
                    }}
                    label={t("default_value")}
                    value={(getIn(values, "defaultValue") as string | number | undefined) ?? ""}/>

            </div>
        </>
    );
}
