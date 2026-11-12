import React from "react";
import { Alert, Button, Typography } from "@rebasepro/ui";
import { ErrorView, useTranslation } from "@rebasepro/app";

import { SchemaEditRefused } from "../../useLocalCollectionsConfigController";
import { SplitEditError } from "../../split_edit_error";
import type { SchemaEditProblem } from "../../liveSchemaClient";

/**
 * Why a save of the collection editor did not happen, as more than a line.
 *
 * - An edit whose result does not compile lists every problem the server
 *   found against the table and field it names.
 * - A file that changed on disk since the edit was prepared offers to reload:
 *   the edit has to be made again against the file as it is now.
 * - A slug or table rename, a collection defined in the frontend, a field with
 *   no column equivalent, redacted rules: what to do instead.
 *
 * Anything else falls back to the panel's error view.
 */
export function SchemaEditRefusalView({ error, onReload }: { error: Error; onReload?: () => void }) {
    const { t } = useTranslation();

    if (error instanceof SplitEditError) {
        return (
            <Alert color={error.code === "MIGRATION_REQUIRED" || error.code === "EXTERNAL_COLLECTION" ? "warning" : "error"} size="small">
                {error.message}
            </Alert>
        );
    }

    if (error instanceof SchemaEditRefused) {
        if (isStaleFile(error)) {
            return (
                <Alert color="warning" size="small"
                       action={onReload && <Button size="small" variant="text" onClick={onReload}>{t("schema_edit_reload")}</Button>}>
                    {t("schema_edit_file_changed")}
                </Alert>
            );
        }
        return (
            <Alert color="error" size="small">
                <Typography variant="body2">{error.code === "SCHEMA_EDIT_DOES_NOT_COMPILE" ? t("schema_edit_does_not_compile") : error.message}</Typography>
                {error.problems.length > 0 && <ProblemList problems={error.problems}/>}
            </Alert>
        );
    }

    return <ErrorView error={error}/>;
}

/** The server's problems, each against the table and field it names. */
function ProblemList({ problems }: { problems: readonly SchemaEditProblem[] }) {
    return (
        <ul className="mt-1 list-disc pl-5">
            {problems.map((problem, index) => (
                <li key={index}>
                    <Typography variant="caption">
                        <code className="font-mono">{problem.key ? `${problem.table}.${problem.key}` : problem.table}</code>
                        {" — "}{problem.message}
                    </Typography>
                </li>
            ))}
        </ul>
    );
}

/**
 * The server refuses an apply whose file changed since the preview read it.
 * It says so in its message, under the general refusal code: matched by that
 * sentence until the server gives it a code of its own.
 */
function isStaleFile(error: SchemaEditRefused): boolean {
    return error.code === "SCHEMA_EDIT_REFUSED" && /changed since the edit was prepared/.test(error.message);
}

/** The problems a refusal names for one field, for drawing beside that field. */
export function problemsForField(error: Error | undefined, field: string): SchemaEditProblem[] {
    if (!(error instanceof SchemaEditRefused)) return [];
    return error.problems.filter(problem => problem.key === field || problem.key?.startsWith(`${field}.`));
}
