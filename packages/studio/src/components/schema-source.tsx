import React from "react";
import { ErrorView, useTranslation, type TableDescriptorsState } from "@rebasepro/app";
import { Alert, Button, Typography } from "@rebasepro/ui";

/**
 * Why Studio has no tables to render from, when it has none: the project's
 * runtime predates `GET /api/schema/tables`, the backend has no auth to
 * describe them to, or the request failed. `undefined` when the tables are
 * there (or still loading).
 *
 * The tables are the server's — `useTableDescriptors` from `@rebasepro/app`,
 * with or without a CMS on the page — and there is no other source to fall
 * back on: an older runtime is upgraded, not imitated.
 */
export type SchemaSourceProblem =
    | { kind: "outdated" }
    | { kind: "no-auth" }
    | { kind: "failed"; error: Error; retry: () => void };

/** The {@link SchemaSourceProblem} of a descriptors state, if there is one. */
export function schemaSourceProblem(state: TableDescriptorsState): SchemaSourceProblem | undefined {
    if (state.unavailable) {
        // A client with no `schema` is a client built before it existed: an
        // upgrade fixes it the same way.
        return state.unavailableReason === "no-auth" ? { kind: "no-auth" } : { kind: "outdated" };
    }
    if (state.status === "error" && state.error) return { kind: "failed", error: state.error, retry: state.reload };
    return undefined;
}

function useProblemText(problem: SchemaSourceProblem): { title: string; body: string } {
    const { t } = useTranslation();
    if (problem.kind === "no-auth") return { title: t("studio_schema_no_auth_title"), body: t("studio_schema_no_auth_body") };
    if (problem.kind === "outdated") return { title: t("studio_schema_outdated_title"), body: t("studio_schema_outdated_body") };
    return { title: t("studio_schema_load_failed"), body: problem.error.message };
}

/**
 * A whole pane's worth of "there is no schema to draw from, and why" — for a
 * view that renders nothing without the tables (the schema visualizer).
 */
export function SchemaSourceProblemView({ problem }: { problem: SchemaSourceProblem }) {
    const { title, body } = useProblemText(problem);
    if (problem.kind === "failed") {
        return (
            <div className="flex items-center justify-center h-full p-6 overflow-auto">
                <ErrorView title={title} error={body} onRetry={problem.retry}/>
            </div>
        );
    }
    return (
        <div className="flex items-center justify-center h-full p-6 overflow-auto">
            <div className="max-w-md text-center">
                <Typography variant="subtitle2" className="block">
                    {title}
                </Typography>
                <Typography variant="body2" color="secondary" className="block mt-2">
                    {body}
                </Typography>
            </div>
        </div>
    );
}

/**
 * The same, as a banner above a view that still works without the tables —
 * the RLS editor still lists what the database holds.
 */
export function SchemaSourceProblemAlert({ problem }: { problem: SchemaSourceProblem }) {
    const { title, body } = useProblemText(problem);
    return (
        <Alert color={problem.kind === "failed" ? "error" : "warning"} action={problem.kind === "failed" ? <RetryLink onRetry={problem.retry}/> : undefined}>
            <Typography variant="body2" className="font-semibold">{title}</Typography>
            <Typography variant="caption" className="block mt-0.5">{body}</Typography>
        </Alert>
    );
}

function RetryLink({ onRetry }: { onRetry: () => void }) {
    const { t } = useTranslation();
    return (
        <Button variant="text" size="small" onClick={onRetry}>
            {t("studio_schema_retry")}
        </Button>
    );
}
