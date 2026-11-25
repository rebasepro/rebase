import React, { useCallback, useState } from "react";
import {
    Alert,
    Button,
    CircularProgress,
    cls,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Typography
} from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";
import type { LoadFailure } from "../load-failure";
import { LoadFailureView } from "../load-failure-view";

/** A section's heading row: title, one line on what it shows, and its controls. */
export function SectionHeader({ title, description, actions }: {
    title: string;
    description?: React.ReactNode;
    actions?: React.ReactNode;
}) {
    return (
        <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
                <Typography variant="subtitle1">{title}</Typography>
                {description && (
                    <Typography variant="caption" color="secondary" className="block">{description}</Typography>
                )}
            </div>
            {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
    );
}

/** SQL to read: an inset well in the monospace face. */
export function SqlBlock({ sql, className }: { sql: string; className?: string }) {
    return (
        <Typography
            variant="mono"
            component="pre"
            className={cls("bg-surface-field rounded-md p-3 text-xs whitespace-pre-wrap break-words overflow-auto max-h-80", className)}
        >
            {sql}
        </Typography>
    );
}

/** The canonical empty state: a centred message, and an icon above it. */
export function EmptyState({ icon, message }: { icon?: React.ReactNode; message: string }) {
    return (
        <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            {icon && <div className="text-text-disabled dark:text-text-disabled-dark">{icon}</div>}
            <Typography variant="label" className="px-4">{message}</Typography>
        </div>
    );
}

/**
 * A section that could not be read. With nothing on screen yet the failure is
 * the section — a refusal, a server without this route, or a read that failed,
 * told apart as every Studio pane tells them apart. Over rows read earlier it
 * is one line above them, so a failed refresh does not throw away what the
 * reader was looking at.
 */
export function SectionLoadFailure({ failure, stale, onRetry }: {
    failure: LoadFailure;
    /** Whether rows from an earlier read are still shown. */
    stale: boolean;
    onRetry: () => void;
}) {
    const { t } = useTranslation();
    if (stale) return <Alert color="error">{failure.detail}</Alert>;
    return (
        <LoadFailureView
            failure={failure}
            title={t("studio_database_load_failed")}
            deniedTitle={t("studio_database_denied_title")}
            deniedHint={t("studio_database_denied_hint")}
            onRetry={onRetry}
        />
    );
}

export function LoadingRow() {
    return <div className="flex justify-center py-12"><CircularProgress size="small"/></div>;
}

export interface ConfirmSqlRequest {
    title: string;
    body?: React.ReactNode;
    confirmLabel: string;
    /** The statements the action runs, as the server previews them (`dryRun: true`). */
    preview: () => Promise<string[]>;
    run: () => Promise<void>;
}

/**
 * A destructive action, confirmed against the SQL it runs.
 *
 * The statements shown are the server's own preview of the request, so what
 * the reader confirms is what the server will execute.
 */
export function useConfirmSql(): [React.ReactNode, (request: ConfirmSqlRequest) => void] {
    const { t } = useTranslation();
    const [request, setRequest] = useState<ConfirmSqlRequest | null>(null);
    const [statements, setStatements] = useState<string[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [running, setRunning] = useState(false);

    const ask = useCallback((next: ConfirmSqlRequest) => {
        setRequest(next);
        setStatements(null);
        setError(null);
        next.preview().then(setStatements, (err: unknown) => {
            setError(err instanceof Error ? err.message : String(err));
        });
    }, []);

    const close = () => {
        if (running) return;
        setRequest(null);
    };

    const confirm = async () => {
        if (!request) return;
        setRunning(true);
        setError(null);
        try {
            await request.run();
            setRequest(null);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setRunning(false);
        }
    };

    const dialog = (
        <Dialog open={request !== null} onOpenChange={(open) => { if (!open) close(); }} maxWidth="lg" fullWidth>
            <DialogTitle>{request?.title}</DialogTitle>
            <DialogContent className="flex flex-col gap-3">
                {typeof request?.body === "string" ? <Typography variant="body2">{request.body}</Typography> : request?.body}
                <Typography variant="caption" color="secondary">{t("studio_database_confirm_sql_label")}</Typography>
                {statements ? <SqlBlock sql={statements.join("\n")}/> : !error && <LoadingRow/>}
                {error && <Alert color="error">{error}</Alert>}
            </DialogContent>
            <DialogActions>
                <Button variant="text" onClick={close} disabled={running}>{t("cancel")}</Button>
                <Button
                    variant="filled"
                    color="error"
                    disabled={running || statements === null}
                    onClick={() => void confirm()}
                >
                    {running ? <CircularProgress size="smallest"/> : null}
                    {request?.confirmLabel}
                </Button>
            </DialogActions>
        </Dialog>
    );
    return [dialog, ask];
}

/** The statements a mutation response carries — what a `dryRun` previews. */
export function statementsOf(raw: unknown): string[] {
    if (typeof raw === "object" && raw !== null && "statements" in raw && Array.isArray(raw.statements)) {
        return raw.statements.filter((statement): statement is string => typeof statement === "string");
    }
    return [];
}
