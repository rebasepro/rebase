/**
 * What a schema change would do, before it does it.
 *
 * The dialog exists because a schema change has three possible verdicts and two
 * of them are refusals. Without a preview, the only way to discover that a
 * change is refused is to press a button on a live database and read what comes
 * back — which is a fine way to learn and a poor way to work.
 *
 * ## What it shows, in the order somebody reads it
 *
 * The verdict first, in a sentence, because it decides whether the rest is
 * worth reading. Then the changes, each with what it does and — when it is
 * refused — what to do instead. Then the things that are easy to skip past and
 * expensive to have skipped: constraints the change asks for that the database
 * will not end up enforcing. The SQL and the file list come last, collapsed,
 * for the reader who wants them; they are the evidence, not the summary.
 *
 * ## Why the button says "Commit and apply"
 *
 * Because that is the order, and the order is the feature. The commit lands
 * first, so a failed apply leaves the repository ahead of the database — the
 * ordinary state of every project between an edit and a deploy, which the next
 * boot reconciles. A button labelled "Save" would be describing a different,
 * worse thing.
 */
import React, { useState } from "react";
import {
    Alert,
    Button,
    Chip,
    CircularProgress,
    cls,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Typography
} from "@rebasepro/ui";

import type { LiveSchemaPlan, LiveSchemaResult, WithheldConstraint } from "../../liveSchemaClient";

export interface SchemaChangeDialogProps {
    open: boolean;
    /** The collection being changed, for the title. */
    collectionId: string;
    /** `undefined` while the plan is still being fetched. */
    plan?: LiveSchemaPlan;
    /** Set when planning itself failed — a network error, a refusal, a 500. */
    planError?: string;
    /** Set once the change has been applied, which turns this into a receipt. */
    result?: LiveSchemaResult;
    applying: boolean;
    /** Set when the apply threw rather than returning a result. */
    applyError?: string;
    onConfirm: () => void;
    /**
     * Write the collection source and leave the database alone.
     *
     * Offered only when the change is refused, and it is what keeps the editor
     * usable while it is. Removing a property is the ordinary case: the ensure
     * path has no `DROP COLUMN`, so a removal can never be applied — and
     * refusing the whole save over it would mean a dev could no longer delete a
     * field from a collection they are still designing.
     *
     * This is exactly what the editor did before live editing existed, so it is
     * not a new hazard; the difference is that it now says what it leaves
     * behind instead of reporting success.
     */
    onSourceOnly?: () => void;
    onClose: () => void;
    /**
     * Why this caller may preview but not apply, when that is the case.
     *
     * A person signed in with an API key, most often. Shown next to a disabled
     * button so the refusal arrives while they are deciding rather than after
     * they have decided.
     */
    applyRefusedBecause?: string;
}

type Verdict = LiveSchemaPlan["verdict"];

/** What the verdict means, in the words the reader needs rather than the enum's. */
const VERDICT_COPY: Record<Verdict, { title: string; body: string; color: "info" | "warning" | "error" }> = {
    safe: {
        title: "Ready to apply",
        body: "Every change here can be made against the running database.",
        color: "info"
    },
    diverges: {
        title: "This would leave the database out of step",
        body: "The change can be written, but the database will not end up matching it. " +
            "The details below say which part, and what would make it applicable.",
        color: "warning"
    },
    "needs-migration": {
        title: "This needs a migration",
        body: "Some of this cannot be done to a running database at all — it drops or rewrites " +
            "something, and that belongs in a migration somebody has read.",
        color: "error"
    }
};

const VERDICT_CHIP: Record<Verdict, { label: string; scheme: "greenLighter" | "orangeLighter" | "redLighter" }> = {
    safe: { label: "safe", scheme: "greenLighter" },
    diverges: { label: "diverges", scheme: "orangeLighter" },
    "needs-migration": { label: "needs migration", scheme: "redLighter" }
};

const monospace = "font-mono text-xs leading-relaxed";
const codeBlock = cls(
    monospace,
    "bg-surface-100 dark:bg-surface-800 rounded-md p-3 overflow-x-auto whitespace-pre"
);

/** A disclosure that starts closed. The evidence, for the reader who wants it. */
function Details({ summary, count, children }: {
    summary: string;
    count: number;
    children: React.ReactNode;
}) {
    const [open, setOpen] = useState(false);
    if (count === 0) return null;
    return (
        <div>
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="flex items-center gap-2 text-sm text-text-secondary dark:text-text-secondary-dark hover:underline"
            >
                <span className={cls("transition-transform", open && "rotate-90")}>›</span>
                {summary} ({count})
            </button>
            {open && <div className="mt-2">{children}</div>}
        </div>
    );
}

/**
 * What still has to happen after this lands.
 *
 * Above the evidence and below the changes, because it is not a refusal and not
 * a detail: the change will apply, and something outside this dialog still has
 * to be done or a later environment will differ from this one.
 */
function FollowUp({ items }: { items: string[] }) {
    if (items.length === 0) return null;
    return (
        <Alert color="info">
            <Typography variant="body2" className="font-medium mb-1">
                {items.length === 1 ? "One thing to do afterwards" : "To do afterwards"}
            </Typography>
            <ul className="space-y-2">
                {items.map(item => (
                    <li key={item} className="text-sm">{item}</li>
                ))}
            </ul>
        </Alert>
    );
}

function WithheldConstraints({ constraints }: { constraints: WithheldConstraint[] }) {
    if (constraints.length === 0) return null;
    return (
        <Alert color="warning">
            <Typography variant="body2" className="font-medium mb-1">
                {constraints.length === 1
                    ? "One constraint will not be enforced"
                    : `${constraints.length} constraints will not be enforced`}
            </Typography>
            <ul className="space-y-2">
                {constraints.map(constraint => (
                    <li key={constraint.target} className="text-sm">
                        <code className="bg-surface-200 dark:bg-surface-700 px-1 rounded">
                            {constraint.target}
                        </code>
                        <div className="mt-1">{constraint.reason}</div>
                        <div className="mt-1 text-text-secondary dark:text-text-secondary-dark">
                            {constraint.remedy}
                        </div>
                    </li>
                ))}
            </ul>
        </Alert>
    );
}

/** The receipt. Shown in place of the plan once the change has been applied. */
function Applied({ result }: { result: LiveSchemaResult }) {
    return (
        <div className="flex flex-col gap-4">
            <Alert color={result.applied ? "success" : "warning"}>
                <Typography variant="body2">{result.summary}</Typography>
            </Alert>

            {!result.applied && result.applyError && (
                // Deliberately not an error state. The commit landed, which is
                // the durable half; the database is now behind the repository,
                // which is where every project sits between an edit and a
                // deploy, and boot reconciles it.
                <Alert color="warning">
                    <Typography variant="body2" className="font-medium mb-1">
                        The database was not changed
                    </Typography>
                    <Typography variant="body2">{result.applyError}</Typography>
                    <Typography variant="body2" className="mt-2">
                        The commit is on <code>{result.committed.branch}</code> either way, so the
                        change will be applied on the next boot.
                    </Typography>
                </Alert>
            )}

            <WithheldConstraints constraints={result.withheldConstraints ?? []}/>
            <FollowUp items={result.followUp ?? []}/>

            <div>
                <Typography variant="label" color="secondary">Committed</Typography>
                <div className={cls(codeBlock, "mt-1")}>
                    {result.committed.sha.slice(0, 9)} on {result.committed.branch}
                    {"\n"}
                    {result.committed.files.map(file => `  ${file}`).join("\n")}
                </div>
            </div>
        </div>
    );
}

export function SchemaChangeDialog({
    open,
    collectionId,
    plan,
    planError,
    result,
    applying,
    applyError,
    onConfirm,
    onSourceOnly,
    onClose,
    applyRefusedBecause
}: SchemaChangeDialogProps) {

    const verdict = plan?.verdict;
    const copy = verdict ? VERDICT_COPY[verdict] : undefined;

    return (
        <Dialog open={open} onOpenChange={value => { if (!value) onClose(); }} maxWidth="3xl">
            <DialogTitle className="flex items-center gap-2">
                {result ? "Schema change applied" : "Review schema change"}
                <code className="text-sm font-normal text-text-secondary dark:text-text-secondary-dark">
                    {collectionId}
                </code>
            </DialogTitle>

            <DialogContent className="flex flex-col gap-4">
                {planError && (
                    <Alert color="error">
                        <Typography variant="body2" className="font-medium mb-1">
                            The change could not be planned
                        </Typography>
                        <Typography variant="body2">{planError}</Typography>
                    </Alert>
                )}

                {!plan && !planError && !result && (
                    <div className="flex items-center gap-3 py-6">
                        <CircularProgress size="small"/>
                        <Typography variant="body2" color="secondary">
                            Working out what this change would do…
                        </Typography>
                    </div>
                )}

                {result && <Applied result={result}/>}

                {plan && !result && copy && (
                    <>
                        <Alert color={copy.color}>
                            <Typography variant="body2" className="font-medium mb-1">
                                {copy.title}
                            </Typography>
                            <Typography variant="body2">{copy.body}</Typography>
                        </Alert>

                        {applyError && (
                            <Alert color="error">
                                <Typography variant="body2">{applyError}</Typography>
                            </Alert>
                        )}

                        {plan.changes.length === 0 && (
                            <Typography variant="body2" color="secondary">
                                Nothing about the database changes. The collection source is still
                                rewritten and committed.
                            </Typography>
                        )}

                        {!plan.applicable && onSourceOnly && (
                            <Typography variant="body2" color="secondary">
                                You can still write the change to your collection source and leave
                                the database as it is — the editor’s behaviour before this preview
                                existed. The column stays, holding whatever is in it, and nothing
                                serves it.
                            </Typography>
                        )}

                        {plan.changes.length > 0 && (
                            <ul className="flex flex-col gap-3">
                                {plan.changes.map((change, index) => (
                                    <li
                                        key={`${change.collection}.${change.property ?? ""}.${index}`}
                                        className="flex gap-3"
                                    >
                                        <Chip
                                            size="smallest"
                                            colorScheme={VERDICT_CHIP[change.verdict].scheme}
                                            className="shrink-0 mt-0.5"
                                        >
                                            {VERDICT_CHIP[change.verdict].label}
                                        </Chip>
                                        <div className="min-w-0">
                                            <Typography variant="body2">{change.detail}</Typography>
                                            {change.remedy && (
                                                <Typography
                                                    variant="body2"
                                                    color="secondary"
                                                    className="mt-1"
                                                >
                                                    {change.remedy}
                                                </Typography>
                                            )}
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}

                        <WithheldConstraints constraints={plan.withheldConstraints ?? []}/>
                        <FollowUp items={plan.followUp ?? []}/>

                        {applyRefusedBecause && (
                            <Alert color="info">
                                <Typography variant="body2" className="font-medium mb-1">
                                    You can preview this change, but not apply it
                                </Typography>
                                <Typography variant="body2">{applyRefusedBecause}</Typography>
                            </Alert>
                        )}

                        <Details summary="SQL that will run" count={plan.statements.length}>
                            <div className={codeBlock}>{plan.statements.join("\n")}</div>
                        </Details>

                        <Details summary="Files that will be committed" count={plan.files.length}>
                            <div className={codeBlock}>{plan.files.join("\n")}</div>
                        </Details>

                        <Details summary="Commit message" count={plan.message ? 1 : 0}>
                            <div className={codeBlock}>{plan.message}</div>
                        </Details>
                    </>
                )}
            </DialogContent>

            <DialogActions>
                <Button variant="text" onClick={onClose} disabled={applying}>
                    {result ? "Close" : "Cancel"}
                </Button>
                {!result && plan && !plan.applicable && onSourceOnly && (
                    <Button variant="outlined" onClick={onSourceOnly} disabled={applying}>
                        Edit source only
                    </Button>
                )}
                {!result && (
                    <Button
                        variant="filled"
                        color="primary"
                        onClick={onConfirm}
                        // `applicable` is the server's word, not a
                        // re-derivation from the verdicts on screen:
                        // `applySchemaChange` re-checks it before it writes
                        // anything, so a button that disagreed would only
                        // produce the same refusal one click later. The same
                        // goes for the permission — `/apply` checks it too, and
                        // this only saves somebody the round trip.
                        disabled={!plan?.applicable || applying || Boolean(applyRefusedBecause)}
                    >
                        {applying ? "Applying…" : "Commit and apply"}
                    </Button>
                )}
            </DialogActions>
        </Dialog>
    );
}
