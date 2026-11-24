import React from "react";
import { cls, TextField, ToggleButtonGroup, Typography } from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";
import type { SqlParameterValue } from "../../utils/sql_params";

export interface SqlParamsPanelProps {
    /** The placeholders in the editor's text, in the order they appear. */
    names: string[];
    values: Readonly<Record<string, SqlParameterValue>>;
    onChange: (name: string, value: SqlParameterValue) => void;
    /** The names a run was refused for, drawn as errors until filled in. */
    missing: readonly string[];
}

const EMPTY: SqlParameterValue = { mode: "text", value: "" };

/**
 * The values the editor's `:name` placeholders are filled in with when the
 * SQL runs: a value quoted as a string literal, the value as written (a
 * number, an expression), or NULL.
 */
export const SqlParamsPanel: React.FC<SqlParamsPanelProps> = ({ names, values, onChange, missing }) => {
    const { t } = useTranslation();
    if (names.length === 0) return null;
    return (
        <div className="px-3 py-2 bg-surface-sheet shrink-0 flex flex-col gap-2 max-h-48 overflow-y-auto">
            <Typography variant="caption" color="secondary">{t("studio_sql_params_title")}</Typography>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
                {names.map(name => {
                    const value = values[name] ?? EMPTY;
                    const isMissing = missing.includes(name);
                    return (
                        <div key={name} className="flex items-center gap-2 min-w-0">
                            <Typography variant="mono" className={cls("text-[13px] shrink-0", isMissing && "text-red-500 dark:text-red-400")}>{`:${name}`}</Typography>
                            <TextField
                                size="small"
                                className="w-44"
                                aria-label={t("studio_sql_params_value_for", { name })}
                                placeholder={value.mode === "raw" ? t("studio_sql_params_raw_placeholder") : t("studio_sql_params_text_placeholder")}
                                disabled={value.mode === "null"}
                                error={isMissing}
                                value={value.mode === "null" ? "" : value.value}
                                onChange={(event) => onChange(name, { ...value, value: event.target.value })}
                            />
                            <ToggleButtonGroup<SqlParameterValue["mode"]>
                                aria-label={t("studio_sql_params_mode_for", { name })}
                                value={value.mode}
                                onValueChange={(mode) => onChange(name, { ...value, mode })}
                                options={[
                                    { value: "text", label: t("studio_sql_params_mode_text") },
                                    { value: "raw", label: t("studio_sql_params_mode_raw") },
                                    { value: "null", label: "NULL" }
                                ]}
                            />
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
