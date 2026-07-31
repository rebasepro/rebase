import type { AdminCollection } from "@rebasepro/admin-types";
import type { EntityStatus } from "@rebasepro/types";
import React, { useState } from "react";
import {
    Button,
    CheckIcon,
    cls,
    CopyIcon,
    defaultBorderMixin,
    IconButton,
    iconSize,
    LoadingButton,
    ArrowLeftIcon,
    MoreVerticalIcon,
    Tooltip,
    Typography
} from "@rebasepro/ui";

export interface EntityIdentityBarProps {
    /** Plural collection name, shown as the breadcrumb ahead of the title. */
    collection: AdminCollection;
    /** Resolved record title, already guarded against showing a field default. */
    title: string;
    entityId?: string | number;
    status: EntityStatus;

    dirty: boolean;
    saving: boolean;
    /** Undefined hides the Save button — read-only views, or a custom form. */
    onSave?: () => void;
    onDiscard?: () => void;
    saveDisabled?: boolean;
    hasErrors?: boolean;

    onBack?: () => void;
    onInspect?: () => void;
    /** Close / full-screen buttons supplied by the panel that owns this view. */
    trailing?: React.ReactNode;
}

/**
 * The persistent header of an entity view: who this record is, and what you can
 * do to it.
 *
 * The title and the id used to live inside the scrolling form, above 72px of
 * empty space — 219px of chrome that carried nothing and scrolled away the
 * moment you touched the wheel, leaving no indication of which record you were
 * editing. They live here instead, and the left half of a bar that was
 * previously empty now does the work.
 */
export function EntityIdentityBar({
    collection,
    title,
    entityId,
    status,
    dirty,
    saving,
    onSave,
    onDiscard,
    saveDisabled,
    hasErrors,
    onBack,
    onInspect,
    trailing
}: EntityIdentityBarProps) {

    const saveLabel = status === "existing" ? "Save" : status === "copy" ? "Create copy" : "Create";

    return (
        <div className={cls(
            "h-[52px] shrink-0 flex items-center gap-2 pl-1.5 pr-2 border-b",
            "bg-surface-50 dark:bg-surface-900",
            defaultBorderMixin
        )}>
            {onBack && (
                <Tooltip title={"Back"}>
                    <IconButton size={"small"} onClick={onBack} aria-label={"Back"}>
                        <ArrowLeftIcon size={iconSize.smallest}/>
                    </IconButton>
                </Tooltip>
            )}

            <Typography variant={"caption"}
                className={"text-text-disabled dark:text-text-disabled-dark whitespace-nowrap hidden sm:block"}>
                {collection.name}&nbsp;/
            </Typography>

            <span className={"font-headers font-semibold text-[15px] tracking-tight truncate min-w-0"}
                title={title}>
                {title}
            </span>

            {entityId !== undefined && <IdChip value={String(entityId)}/>}

            <div className={"flex-1"}/>

            <SaveState dirty={dirty} saving={saving} status={status}/>

            {onDiscard && dirty && !saving && (
                <Button variant={"text"} size={"small"} onClick={onDiscard}>
                    {status === "existing" ? "Discard" : "Clear"}
                </Button>
            )}

            {onSave && (
                <Tooltip title={hasErrors ? "Fix highlighted errors before saving" : undefined}>
                    <LoadingButton variant={"filled"}
                        color={"primary"}
                        size={"small"}
                        loading={saving}
                        disabled={saveDisabled}
                        onClick={onSave}>
                        {saveLabel}
                    </LoadingButton>
                </Tooltip>
            )}

            {onInspect && (
                <Tooltip title={"Inspect — raw values and history"}>
                    <IconButton size={"small"} onClick={onInspect} aria-label={"Inspect"}>
                        <MoreVerticalIcon size={iconSize.smallest}/>
                    </IconButton>
                </Tooltip>
            )}

            {trailing}
        </div>
    );
}

/**
 * The words the unlabelled floating circle never said.
 *
 * That indicator was a ✓ / pencil / spinner chip stuck to the top-right of the
 * scroll area in an `h-0 overflow-visible` container, so it drifted across
 * field values as you scrolled — and it duplicated what the Save button was
 * already able to tell you.
 */
function SaveState({
    dirty,
    saving,
    status
}: {
    dirty: boolean;
    saving: boolean;
    status: EntityStatus;
}) {
    if (saving) {
        return <StateText>Saving…</StateText>;
    }
    if (dirty) {
        return <StateText>Unsaved changes</StateText>;
    }
    if (status === "existing") {
        return <StateText>Saved</StateText>;
    }
    return null;
}

function StateText({ children }: { children: React.ReactNode }) {
    return (
        <span className={"text-xs text-text-disabled dark:text-text-disabled-dark whitespace-nowrap hidden md:inline"}>
            {children}
        </span>
    );
}

/**
 * The id, as a chip you can copy rather than a full-width alert holding a UUID.
 */
function IdChip({ value }: { value: string }) {

    const [copied, setCopied] = useState(false);

    const truncated = value.length > 14
        ? `${value.slice(0, 8)}…${value.slice(-4)}`
        : value;

    const copy = () => {
        navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
        }, () => undefined);
    };

    return (
        <Tooltip title={copied ? "Copied" : value}>
            <button type={"button"}
                onClick={copy}
                aria-label={`Copy id ${value}`}
                className={cls(
                    "hidden md:inline-flex items-center gap-1.5 shrink-0 px-2 py-0.5 rounded-md",
                    "font-mono text-[11px] text-text-secondary dark:text-text-secondary-dark",
                    "bg-surface-accent-200/50 dark:bg-white/[0.055]",
                    "hover:bg-surface-accent-200/75 dark:hover:bg-white/[0.09] transition-colors"
                )}>
                {truncated}
                {copied ? <CheckIcon size={iconSize.smallest}/> : <CopyIcon size={iconSize.smallest}/>}
            </button>
        </Tooltip>
    );
}
