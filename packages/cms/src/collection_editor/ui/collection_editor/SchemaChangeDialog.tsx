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
import React from "react";
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
    ExpandablePanel,
    Typography
} from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";

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
     * Ask again, when planning failed.
     *
     * A dropped connection should cost a click, not the whole wizard. The form
     * is already filled in, and making somebody redo it for a transient failure
     * teaches them to distrust the preview rather than the network.
     */
    onRetry?: () => void;
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
    /**
     * Where a confirmation would land — `owner/repo` and a branch.
     *
     * On screen before the button, not in the receipt after it. A commit is
     * going somewhere, and which branch it is going to is the one fact somebody
     * cannot recover from being wrong about.
     */
    target?: { repository?: string; branch?: string };
}

type Verdict = LiveSchemaPlan["verdict"];

type Translate = ReturnType<typeof useTranslation>["t"];

/**
 * What the verdict means, in the words the reader needs rather than the enum's.
 *
 * `safe` is written twice because the two cases are genuinely different, and
 * saying "can be made against the running database" when nothing will be run is
 * the kind of small lie that teaches people to stop reading. A document
 * database has no table to alter, and a change that needs no DDL on a
 * relational one is in the same position: the commit *is* the change.
 */
const VERDICT_COPY: Record<Verdict, { titleKey: string; bodyKey: string; color: "info" | "warning" | "error" }> = {
    safe: {
        titleKey: "schema_change_verdict_safe_title",
        bodyKey: "schema_change_verdict_safe_body",
        color: "info"
    },
    diverges: {
        titleKey: "schema_change_verdict_diverges_title",
        bodyKey: "schema_change_verdict_diverges_body",
        color: "warning"
    },
    "needs-migration": {
        titleKey: "schema_change_verdict_migration_title",
        bodyKey: "schema_change_verdict_migration_body",
        color: "error"
    }
};

const VERDICT_CHIP: Record<Verdict, { labelKey: string; scheme: "greenLighter" | "orangeLighter" | "redLighter" }> = {
    safe: { labelKey: "schema_change_chip_safe", scheme: "greenLighter" },
    diverges: { labelKey: "schema_change_chip_diverges", scheme: "orangeLighter" },
    "needs-migration": { labelKey: "schema_change_chip_migration", scheme: "redLighter" }
};

const monospace = "font-mono text-xs leading-relaxed";
const codeBlock = cls(
    monospace,
    "bg-surface-raised rounded-md p-3 overflow-x-auto whitespace-pre"
);

/** A disclosure that starts closed. The evidence, for the reader who wants it. */
function Details({ summary, count, children }: {
    summary: string;
    count: number;
    children: React.ReactNode;
}) {
    if (count === 0) return null;
    return (
        <ExpandablePanel
            initiallyExpanded={false}
            titleClassName="!min-h-0 !py-2 px-3"
            innerClassName="p-3"
            title={<Typography variant="body2" color="secondary">{summary} ({count})</Typography>}
        >
            {children}
        </ExpandablePanel>
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
    const { t } = useTranslation();
    if (items.length === 0) return null;
    return (
        <Alert color="info">
            <Typography variant="body2" className="font-medium mb-1">
                {items.length === 1 ? t("schema_change_follow_up_one") : t("schema_change_follow_up")}
            </Typography>
            <ul className="space-y-2">
                {items.map(item => (
                    <li key={item} className="text-sm">{item}</li>
                ))}
            </ul>
        </Alert>
    );
}

/**
 * The destination, short enough to read at a glance.
 *
 * A remote repository already reports itself as `owner/repo`, which is exactly
 * what somebody recognises. A local one reports an absolute path, and the
 * leading directories are the part nobody needs: what matters is which
 * checkout, and its name says that.
 */
function repositoryLabel(repository: string): string {
    if (!repository.startsWith("/")) return repository;
    return repository.split("/").filter(Boolean).pop() ?? repository;
}

function WithheldConstraints({ constraints }: { constraints: WithheldConstraint[] }) {
    const { t } = useTranslation();
    if (constraints.length === 0) return null;
    return (
        <Alert color="warning">
            <Typography variant="body2" className="font-medium mb-1">
                {constraints.length === 1
                    ? t("schema_change_withheld_one")
                    : t("schema_change_withheld_many", { count: constraints.length })}
            </Typography>
            <ul className="space-y-2">
                {constraints.map(constraint => (
                    <li key={constraint.target} className="text-sm">
                        <Typography component="code" variant="mono" className="bg-surface-raised px-1 rounded-md">
                            {constraint.target}
                        </Typography>
                        <Typography variant="body2" className="mt-1">{constraint.reason}</Typography>
                        <Typography variant="body2" color="secondary" className="mt-1">
                            {constraint.remedy}
                        </Typography>
                    </li>
                ))}
            </ul>
        </Alert>
    );
}

/**
 * How far a failed apply got, in a heading.
 *
 * The statements run one at a time with no transaction around them, so only
 * "none ran" means the database is as it was.
 */
function partialApplyHeading(result: LiveSchemaResult, t: Translate): string {
    const ran = result.appliedStatements;
    if (ran === 0) return t("schema_change_db_not_changed");
    if (ran === undefined) return t("schema_change_db_maybe_changed");
    return t("schema_change_statements_partial", { ran, total: result.statements.length });
}

/** The receipt. Shown in place of the plan once the change has been applied. */
function Applied({ result }: { result: LiveSchemaResult }) {
    const { t } = useTranslation();
    return (
        <div className="flex flex-col gap-4">
            <Alert color={result.applied || result.sourceOnly ? "success" : "warning"}>
                <Typography variant="body2">{result.summary}</Typography>
            </Alert>

            {!result.applied && !result.sourceOnly && result.applyError && (
                // Deliberately not an error state. The commit landed, which is
                // the durable half; the database is now behind the repository,
                // which is where every project sits between an edit and a
                // deploy, and boot reconciles it.
                <Alert color="warning">
                    <Typography variant="body2" className="font-medium mb-1">
                        {partialApplyHeading(result, t)}
                    </Typography>
                    <Typography variant="body2">{result.applyError}</Typography>
                    <Typography variant="body2" className="mt-2">
                        {t("schema_change_commit_holds", { branch: result.committed.branch })}
                    </Typography>
                </Alert>
            )}

            <WithheldConstraints constraints={result.withheldConstraints ?? []}/>
            <FollowUp items={result.followUp ?? []}/>

            <div>
                <Typography variant="label" color="secondary">{t("schema_change_committed")}</Typography>
                <div className={cls(codeBlock, "mt-1")}>
                    {t("schema_change_committed_on", { sha: result.committed.sha.slice(0, 9), branch: result.committed.branch })}
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
    onRetry,
    onSourceOnly,
    onClose,
    applyRefusedBecause,
    target
}: SchemaChangeDialogProps) {

    const { t } = useTranslation();
    const verdict = plan?.verdict;
    const statements = plan?.statements.length ?? 0;

    // "Commit" only when we positively know there is nothing to apply: a plan
    // that is going ahead and has no statements. A *refused* plan also has none
    // — because it will not run — and labelling that button "Commit" would be
    // describing the change it is refusing to make. Unknown reads as the fuller
    // action, which is the safer way to be wrong about a label.
    const commitOnly = Boolean(plan?.applicable) && statements === 0;

    // Described from the plan rather than from an assumption about the engine.
    // A document database runs nothing; so does a relational change that only
    // moves source. Both are a commit, and calling either one "apply" would be
    // describing something that does not happen.
    // A plan with changes and no statements still changes something — a
    // security rule takes effect when the server next starts — so "there is
    // no schema change to make" is said only when there is none.
    const copy = verdict === "safe" && commitOnly
        ? {
            title: t("schema_change_commit_only_title"),
            body: plan && plan.changes.length > 0
                ? t("schema_change_commit_only_body")
                : t("schema_change_commit_only_body_no_changes"),
            color: "info" as const
        }
        : verdict
            ? {
                title: t(VERDICT_COPY[verdict].titleKey),
                body: t(VERDICT_COPY[verdict].bodyKey),
                color: VERDICT_COPY[verdict].color
            }
            : undefined;

    return (
        <Dialog open={open} onOpenChange={value => { if (!value) onClose(); }} maxWidth="3xl">
            <DialogTitle className="flex items-center gap-2">
                {result
                    ? (result.sourceOnly ? t("schema_change_title_committed") : t("schema_change_title_applied"))
                    : t("schema_change_title_review")}
                <Typography component="code" variant="mono" color="secondary">
                    {collectionId}
                </Typography>
            </DialogTitle>

            <DialogContent className="flex flex-col gap-4">
                {planError && (
                    <Alert color="error">
                        <Typography variant="body2" className="font-medium mb-1">
                            {t("schema_change_plan_failed")}
                        </Typography>
                        <Typography variant="body2">{planError}</Typography>
                    </Alert>
                )}

                {!plan && !planError && !result && (
                    <div className="flex items-center gap-3 py-6">
                        <CircularProgress size="small"/>
                        <Typography variant="body2" color="secondary">
                            {t("schema_change_planning")}
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
                                {t("schema_change_source_only_changes")}
                            </Typography>
                        )}

                        {!plan.applicable && onSourceOnly && (
                            // Said per change: what a removal leaves behind is
                            // not what a type change or a new required field
                            // does, and the one that breaks every insert has to
                            // be on screen before the button is pressed.
                            <Alert color="warning">
                                <Typography variant="body2" className="font-medium mb-1">
                                    {t("schema_change_source_only_title")}
                                </Typography>
                                <ul className="space-y-1">
                                    {plan.changes.filter(change => change.verdict !== "safe" && change.sourceOnly).map((change, index) => (
                                        <li key={`${change.property ?? change.collection}.${index}`} className="text-sm">
                                            {change.sourceOnly}
                                        </li>
                                    ))}
                                </ul>
                            </Alert>
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
                                            {t(VERDICT_CHIP[change.verdict].labelKey)}
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
                                    {t("schema_change_preview_only")}
                                </Typography>
                                <Typography variant="body2">{applyRefusedBecause}</Typography>
                            </Alert>
                        )}

                        <Details summary={t("schema_change_statements")} count={plan.statements.length}>
                            <div className={codeBlock}>{plan.statements.join("\n")}</div>
                        </Details>

                        <Details summary={t("schema_change_files")} count={plan.files.length}>
                            <div className={codeBlock}>{plan.files.join("\n")}</div>
                        </Details>

                        <Details summary={t("schema_change_message")} count={plan.message ? 1 : 0}>
                            <div className={codeBlock}>{plan.message}</div>
                        </Details>
                    </>
                )}
            </DialogContent>

            <DialogActions>
                {!result && target?.repository && (
                    <Typography variant="caption" color="secondary" className={cls(monospace, "mr-auto truncate")}>
                        → {repositoryLabel(target.repository)}{target.branch ? ` · ${target.branch}` : ""}
                    </Typography>
                )}
                <Button variant="text" onClick={onClose} disabled={applying}>
                    {result ? t("close") : t("cancel")}
                </Button>
                {!result && planError && onRetry && (
                    <Button variant="outlined" onClick={onRetry}>
                        {t("retry")}
                    </Button>
                )}
                {!result && plan && !plan.applicable && onSourceOnly && (
                    <Button variant="outlined" onClick={onSourceOnly} disabled={applying}>
                        {t("schema_change_edit_source_only")}
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
                        {applying
                            ? (commitOnly ? t("schema_change_committing") : t("schema_change_applying"))
                            : (commitOnly ? t("schema_change_commit") : t("schema_change_commit_and_apply"))}
                    </Button>
                )}
            </DialogActions>
        </Dialog>
    );
}
