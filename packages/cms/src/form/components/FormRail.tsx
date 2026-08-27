import type { Entity } from "@rebasepro/types";
import type { ResolvedFormField } from "@rebasepro/app";
import React from "react";
import { CheckIcon, cls, CopyIcon, defaultBorderMixin, IconButton, iconSize, Tooltip, Typography } from "@rebasepro/ui";

export interface FormRailProps {
    fields: ResolvedFormField[];
    showRecordMeta: boolean;
    entity?: Entity<Record<string, unknown>>;
    renderField: (field: ResolvedFormField) => React.ReactNode;
}

/**
 * The metadata column beside the form.
 *
 * This replaces a `w-80 2xl:w-96` rail that held a Save button and several
 * hundred pixels of nothing. It renders only when it has something to say, and
 * the actions it used to hold now live in the identity bar, where they stay
 * visible while you scroll.
 */
export function FormRail({
    fields,
    showRecordMeta,
    entity,
    renderField
}: FormRailProps) {

    if (!fields.length && !showRecordMeta) return null;

    return (
        <aside className={cls(
            // No responsive hiding here. The caller decides whether the rail is
            // shown, by measuring; a CSS `hidden` would leave the fields the
            // resolver moved in here unreachable rather than folding them back.
            //
            // `w-76` (304px), between the old 288 and a full `w-80`. The rail
            // holds real controls — a status select, a date picker — plus a
            // record block whose id is a 36-character UUID, so 288 left the
            // select tighter than the identical select in the column.
            //
            // 304 is the floor rather than the answer everywhere. It was chosen
            // against the *narrow* end, where 320 took more than it gave back —
            // past about 300px the extra went to the gap beside a chip. That
            // stops being true once the form is genuinely wide: `@7xl/form`
            // (1280px of form) is the same signal the column widens on, and by
            // then 32px is coming out of gutters, not out of the column.
            //
            // Container, not viewport, for the reason the whole rail is
            // measured rather than breakpointed: a side panel inside a large
            // window is not a wide form. Both surfaces that render a rail —
            // `EntityForm` and `EntityViewBinding` — name their form element
            // `@container/form`, so a panel that never gets that wide keeps 304.
            "flex flex-col gap-6 shrink-0 w-76 @7xl/form:w-84 border-l overflow-y-auto",
            "px-5 py-6 bg-surface-50 dark:bg-surface-900",
            defaultBorderMixin
        )}>
            {fields.length > 0 && (
                <div className={"flex flex-col gap-5"}>
                    {fields.map(renderField)}
                </div>
            )}

            {showRecordMeta && entity && <RecordMeta entity={entity}/>}
        </aside>
    );
}

/**
 * The record's id and audit timestamps.
 *
 * Exported because the rail is not the only place it renders. The rail is shown
 * only when it has been *measured* to fit, and every layout narrower than that —
 * the split pane, the side panel, the dialog — folds its contents back into the
 * column. The fields folded back but this block did not, so on three of the four
 * layouts a record simply had no id on screen: the only copy of it was the
 * truncated `e166a394…b422` chip in the identity bar.
 */
export function RecordMeta({ entity }: { entity: Entity<Record<string, unknown>> }) {

    const createdAt = pickDate(entity.values, ["created_at", "createdAt", "created_on"]);
    const updatedAt = pickDate(entity.values, ["updated_at", "updatedAt", "modified_at"]);

    return (
        <div className={"flex flex-col gap-2.5"}>
            <Typography variant={"caption"}
                className={"text-xs font-semibold uppercase tracking-wider text-text-disabled dark:text-text-disabled-dark"}>
                Record
            </Typography>

            <MetaRow label={"ID"} value={String(entity.id)} copyable/>
            {createdAt && <MetaRow label={"Created"} value={createdAt}/>}
            {updatedAt && <MetaRow label={"Updated"} value={updatedAt}/>}
        </div>
    );
}

function MetaRow({
    label,
    value,
    copyable
}: {
    label: string;
    value: string;
    copyable?: boolean;
}) {
    const [copied, setCopied] = React.useState(false);

    const copy = () => {
        navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
        }, () => undefined);
    };

    return (
        <div className={"flex items-baseline justify-between gap-3 min-w-0"}>
            <span className={"text-xs text-text-disabled dark:text-text-disabled-dark shrink-0"}>
                {label}
            </span>
            <span className={"flex items-center gap-1 min-w-0"}>
                <span className={"font-mono text-xs text-text-secondary dark:text-text-secondary-dark truncate"}
                    title={value}>
                    {value}
                </span>
                {copyable && (
                    <Tooltip title={copied ? "Copied" : "Copy"}>
                        <IconButton size={"smallest"} onClick={copy}>
                            {copied ? <CheckIcon size={iconSize.smallest}/> : <CopyIcon size={iconSize.smallest}/>}
                        </IconButton>
                    </Tooltip>
                )}
            </span>
        </div>
    );
}

/**
 * Audit timestamps are a convention, not a contract — a collection may name them
 * anything or not have them at all — so this reads the values it recognises and
 * stays quiet otherwise rather than rendering an empty row.
 */
function pickDate(values: Record<string, unknown> | undefined, keys: string[]): string | undefined {
    if (!values) return undefined;
    for (const key of keys) {
        const value = values[key];
        if (value instanceof Date) return value.toLocaleDateString();
        if (typeof value === "string" && value) {
            const parsed = new Date(value);
            if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleDateString();
        }
    }
    return undefined;
}
