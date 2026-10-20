import React from "react";
import { cls, defaultBorderMixin, Typography } from "@rebasepro/ui";
import { diffStagedChange, type FieldChange } from "../config/diff";
import type { StagedChange } from "../config/types";
import { useReviewTranslation } from "../i18n";

/** How long a rendered value may get before it is cut. */
const MAX_VALUE_LENGTH = 240;

/** A field value as one line of text, or undefined for no value. */
export function formatReviewValue(value: unknown): string | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    let text: string;
    if (typeof value === "string") text = value;
    else if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") text = String(value);
    else {
        try {
            text = JSON.stringify(value);
        } catch {
            text = String(value);
        }
    }
    return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text;
}

function Value({ value, kind }: { value: unknown; kind: "before" | "after" }) {
    const { t } = useReviewTranslation();
    const text = formatReviewValue(value);
    if (text === undefined) {
        return <Typography variant="caption" color="secondary" className="italic">{t("review_empty_value")}</Typography>;
    }
    return kind === "before"
        ? <del className="text-surface-500 line-through break-words">{text}</del>
        : <ins className="text-emerald-400 no-underline break-words">{text}</ins>;
}

function FieldRow({ change }: { change: FieldChange }) {
    return (
        <div className="grid grid-cols-[minmax(6rem,10rem)_1fr] gap-x-3 py-1.5 items-baseline" data-field={change.field} data-kind={change.kind}>
            <Typography variant="caption" className="font-mono truncate" color="secondary">{change.field}</Typography>
            <Typography variant="body2" component="div" className="flex flex-wrap items-baseline gap-x-2 min-w-0">
                {change.kind === "unchanged" && <Value value={change.after} kind="after"/>}
                {change.kind === "added" && <Value value={change.after} kind="after"/>}
                {change.kind === "removed" && <Value value={change.before} kind="before"/>}
                {change.kind === "changed" && <>
                    <Value value={change.before} kind="before"/>
                    <span aria-hidden className="text-surface-500">→</span>
                    <Value value={change.after} kind="after"/>
                </>}
            </Typography>
        </div>
    );
}

/**
 * A staged change, field by field: what each field held, struck through, and
 * what it will hold. An update lists only the fields it writes, unchanged ones
 * last.
 */
export function StagedChangeDiff({ change }: { change: Pick<StagedChange, "operation" | "before_data" | "proposed_data"> }) {
    const { t } = useReviewTranslation();
    const fields = diffStagedChange(change);
    const changed = fields.filter(field => field.kind !== "unchanged");
    const unchanged = fields.filter(field => field.kind === "unchanged");
    if (changed.length === 0) {
        return <Typography variant="caption" color="secondary">{t("review_no_changes")}</Typography>;
    }
    return (
        <div className={cls("rounded-lg border px-3 py-1 bg-surface-field", defaultBorderMixin)}>
            {[...changed, ...unchanged].map(field => <FieldRow key={field.field} change={field}/>)}
        </div>
    );
}
