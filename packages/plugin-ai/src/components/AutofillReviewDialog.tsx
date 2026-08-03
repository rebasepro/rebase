import React from "react";

import {
    Button,
    Checkbox,
    CircularProgress,
    cls,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Separator,
    Typography
} from "@rebasepro/ui";

import { ProposedField } from "../types/data_enhancement_controller";
import { useDataEnhancementController } from "./DataEnhancementControllerProvider";

/**
 * The review step.
 *
 * Autofill used to write generated text into the live form as it streamed —
 * fields mutating under the cursor, half-written sentences that looked like
 * bugs, and a pile of heuristics deciding whether each token should append to
 * or replace what the operator had already typed. Getting the old value back
 * meant retyping it.
 *
 * So the generated values land here instead. Streaming still happens, and is
 * still worth having — rows appear and fill in as the model works, so a long
 * run shows progress — but it happens in a surface that owns nothing. The
 * record changes on **Apply**, once, for the rows still ticked.
 */
export function AutofillReviewDialog() {

    const controller = useDataEnhancementController();
    const review = controller?.review;

    if (!review) return null;

    const generating = review.status === "generating";
    const applicable = review.fields.filter((f) => !f.pending && f.selected);
    const allSelected = review.fields.length > 0 && review.fields.every((f) => f.selected);

    return (
        <Dialog
            open={true}
            maxWidth={"2xl"}
            onOpenChange={(open) => {
                if (!open) controller.dismissReview();
            }}>

            <DialogTitle variant={"subtitle1"} gutterBottom={false}>
                Review autofill
            </DialogTitle>

            <DialogContent className={"flex flex-col gap-2"}>

                {review.instructions && (
                    <Typography variant={"body2"} color={"secondary"} className={"italic"}>
                        “{review.instructions}”
                    </Typography>
                )}

                {review.fields.length > 1 && (
                    <>
                        <label className={"flex items-center gap-3 py-1 cursor-pointer select-none"}>
                            <Checkbox
                                checked={allSelected}
                                size={"small"}
                                onCheckedChange={() => controller.toggleAll(!allSelected)}
                            />
                            {/* `component="span"`: the Typography `label`
                                variant renders a <label> element, and this sits
                                inside the row's own <label>. Nested labels are
                                invalid HTML and stop the text toggling the
                                checkbox — clicking "Select all" did nothing. */}
                            <Typography variant={"label"} component={"span"} color={"secondary"}>
                                {allSelected ? "Deselect all" : "Select all"}
                            </Typography>
                        </label>
                        <Separator orientation={"horizontal"} className={"my-0"}/>
                    </>
                )}

                <div className={"flex flex-col divide-y divide-surface-accent-100 dark:divide-surface-accent-800"}>
                    {review.fields.map((field) => (
                        <ProposedFieldRow
                            key={field.key}
                            field={field}
                            onToggle={() => controller.toggleField(field.key)}
                        />
                    ))}
                </div>

                {generating && (
                    <div className={"flex items-center gap-3 py-4 text-text-secondary dark:text-text-secondary-dark"}>
                        <CircularProgress size={"smallest"}/>
                        <Typography variant={"body2"} color={"secondary"}>
                            {review.fields.length === 0 ? "Thinking…" : "Writing the remaining fields…"}
                        </Typography>
                    </div>
                )}

                {review.status === "failed" && (
                    <Typography variant={"body2"} className={"py-2 text-red-600 dark:text-red-400"}>
                        {review.error}
                        {review.fields.length > 0 && " You can still apply what was written before it stopped."}
                    </Typography>
                )}

                {!generating && review.fields.length === 0 && review.status !== "failed" && (
                    <Typography variant={"body2"} color={"secondary"} className={"py-4"}>
                        Nothing to fill in — every field either already has a value the model would not
                        improve on, or is not one it can write.
                    </Typography>
                )}

            </DialogContent>

            <DialogActions>
                <Button variant={"text"}
                    color={"neutral"}
                    onClick={controller.dismissReview}>
                    {/* Named for what it does to the record, not to the dialog:
                        nothing has been written, so there is nothing to undo. */}
                    Discard
                </Button>
                <Button variant={"filled"}
                    disabled={applicable.length === 0}
                    onClick={controller.applyReview}>
                    {applicable.length === 1 ? "Apply 1 field" : `Apply ${applicable.length} fields`}
                </Button>
            </DialogActions>

        </Dialog>
    );
}

function ProposedFieldRow({ field, onToggle }: { field: ProposedField, onToggle: () => void }) {

    const replaces = hasValue(field.currentValue) && !isSameValue(field.currentValue, field.proposed);

    return (
        <label className={cls(
            "flex items-start gap-3 py-3 cursor-pointer",
            !field.selected && "opacity-50"
        )}>
            <div className={"mt-0.5 shrink-0"}>
                <Checkbox
                    checked={field.selected}
                    size={"small"}
                    onCheckedChange={onToggle}
                />
            </div>

            <div className={"flex flex-col gap-1 min-w-0 grow"}>
                <div className={"flex items-center gap-2"}>
                    {/* See the note above: never a bare `label` variant inside a <label>. */}
                    <Typography variant={"label"} component={"span"}>{field.label}</Typography>
                    {replaces && (
                        <Typography variant={"caption"} color={"secondary"}>
                            replaces the current value
                        </Typography>
                    )}
                    {field.pending && <CircularProgress size={"smallest"}/>}
                </div>

                {replaces && (
                    <Typography
                        variant={"body2"}
                        color={"secondary"}
                        className={"line-through whitespace-pre-wrap break-words"}>
                        {renderValue(field.currentValue)}
                    </Typography>
                )}

                <Typography variant={"body2"} className={"whitespace-pre-wrap break-words"}>
                    {renderValue(field.proposed)}
                </Typography>
            </div>
        </label>
    );
}

function hasValue(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
}

function isSameValue(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((v, i) => isSameValue(v, b[i]));
    }
    return false;
}

/** Values are shown, never edited here — so a readable string is all that is needed. */
function renderValue(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (value instanceof Date) return value.toLocaleString();
    if (Array.isArray(value)) return value.map((v) => renderValue(v)).join(", ");
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
}
