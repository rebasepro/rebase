import type { AdminCollection } from "@rebasepro/admin-types";
import type { EntityStatus } from "@rebasepro/types";
import React, { useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "@rebasepro/app";
import {
    Button,
    CheckIcon,
    cls,
    CodeIcon,
    CopyIcon,
    defaultBorderMixin,
    ExternalLinkIcon,
    HistoryIcon,
    IconButton,
    iconSize,
    LoadingButton,
    ArrowLeftIcon,
    Menu,
    MenuItem,
    MoreVerticalIcon,
    Separator,
    Tooltip,
    Typography
} from "@rebasepro/ui";

export interface EntityIdentityBarProps {
    /** Plural collection name, shown as the breadcrumb ahead of the title. */
    collection: AdminCollection;
    /**
     * Where the breadcrumb points. Without it the collection name is inert text
     * that still reads as a breadcrumb — worse than no breadcrumb at all, and
     * the only way back once a layout drops its back arrow.
     *
     * Left unset by the overlays (side panel, dialog), where the collection is
     * already underneath and navigating would dismiss the record instead.
     */
    collectionUrl?: string;
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

    /**
     * Save and dismiss, for the side panel and the dialog where the dominant
     * action is "done with this record" rather than "keep editing".
     */
    onSaveAndClose?: () => void;

    onBack?: () => void;
    onInspect?: () => void;
    /** Opens the inspector straight on its history tab. */
    onViewHistory?: () => void;

    /**
     * Where this record appears on the live site, from `entityLinkBuilder`.
     *
     * Here rather than above the record, where it used to be a single unlabelled
     * icon alone on its own right-aligned row — the only thing between the bar
     * and the first field, and the only control in the view that did not say
     * what it was. It is a thing you do *to* a record, so it belongs with the
     * others.
     */
    externalLink?: string;

    /**
     * Actions performed *on* the record — copy, delete, whatever the collection
     * adds — as menu items under the overflow button. They live here rather
     * than in a footer, which is what let the footer go away entirely.
     */
    recordActions?: React.ReactNode;

    /** Plugin-contributed actions, rendered inline before Save. */
    pluginActions?: React.ReactNode;

    /** Close / full-screen buttons supplied by the panel that owns this view. */
    trailing?: React.ReactNode;

    /**
     * Controls the owning panel puts at the bar's leading edge, ahead of the
     * breadcrumb — where the side panel's close button lives.
     */
    leading?: React.ReactNode;
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
    collectionUrl,
    title,
    entityId,
    status,
    dirty,
    saving,
    onSave,
    onDiscard,
    saveDisabled,
    hasErrors,
    onSaveAndClose,
    onBack,
    onInspect,
    onViewHistory,
    externalLink,
    recordActions,
    pluginActions,
    trailing,
    leading
}: EntityIdentityBarProps) {

    const { t } = useTranslation();

    const saveLabel = status === "existing"
        ? t("save")
        : status === "copy" ? t("create_copy") : t("create");
    const closeLabel = status === "existing"
        ? t("save_and_close")
        : status === "copy" ? t("create_copy_and_close") : t("create_and_close");
    const hasMenu = Boolean(recordActions) || Boolean(onInspect) || Boolean(onViewHistory)
        || Boolean(externalLink);

    return (
        <div className={cls(
            "h-[52px] shrink-0 flex items-center gap-2 pl-1.5 pr-2 border-b",
            "bg-surface-50 dark:bg-surface-900",
            defaultBorderMixin
        )}>
            {leading}

            {onBack && (
                <Tooltip title={t("back")}>
                    <IconButton size={"small"} onClick={onBack} aria-label={t("back")}>
                        <ArrowLeftIcon size={iconSize.smallest}/>
                    </IconButton>
                </Tooltip>
            )}

            {collectionUrl
                ? <Link to={collectionUrl}
                    className={"visited:text-inherit dark:visited:text-inherit hidden sm:block"}>
                    <Typography variant={"caption"}
                        className={cls(
                            "text-text-disabled dark:text-text-disabled-dark whitespace-nowrap",
                            "hover:text-text-primary dark:hover:text-text-primary-dark transition-colors"
                        )}>
                        {collection.name}&nbsp;/
                    </Typography>
                </Link>
                : <Typography variant={"caption"}
                    className={"text-text-disabled dark:text-text-disabled-dark whitespace-nowrap hidden sm:block"}>
                    {collection.name}&nbsp;/
                </Typography>}

            <span className={"font-headers font-semibold text-[15px] tracking-tight truncate min-w-0"}
                title={title}>
                {title}
            </span>

            {entityId !== undefined && <IdChip value={String(entityId)}/>}

            <div className={"flex-1"}/>

            {/* Only where there is something to save. The read-only detail
                view has no Save button, and reporting "Saved" there implies an
                editing session the user never started. */}
            {onSave && <SaveState dirty={dirty} saving={saving} status={status} t={t}/>}

            {pluginActions}

            {onDiscard && dirty && !saving && (
                <Button variant={"text"} size={"small"} onClick={onDiscard}>
                    {status === "existing" ? t("discard") : t("clear")}
                </Button>
            )}

            {onSave && (
                <Tooltip title={hasErrors
                    ? (t("fix_errors_before_saving") ?? "Fix highlighted errors before saving")
                    : undefined}>
                    <LoadingButton
                        // Where there is something to close, closing is the
                        // dominant intent and takes the filled treatment.
                        variant={onSaveAndClose ? "text" : "filled"}
                        color={"primary"}
                        size={"small"}
                        loading={saving && !onSaveAndClose}
                        disabled={saveDisabled}
                        onClick={onSave}>
                        {saveLabel}
                    </LoadingButton>
                </Tooltip>
            )}

            {onSaveAndClose && (
                <LoadingButton variant={"filled"}
                    color={"primary"}
                    size={"small"}
                    loading={saving}
                    disabled={saveDisabled}
                    onClick={onSaveAndClose}>
                    {closeLabel}
                </LoadingButton>
            )}

            {hasMenu && (
                <Menu align={"end"}
                    trigger={
                        <IconButton size={"small"} aria-label={t("more_actions") ?? "More actions"}>
                            <MoreVerticalIcon size={iconSize.smallest}/>
                        </IconButton>
                    }>
                    {externalLink && (
                        <MenuItem onClick={() => window.open(externalLink, "_blank", "noopener,noreferrer")}>
                            <ExternalLinkIcon size={iconSize.smallest}/>
                            {t("open_in_live_site") ?? "Open in the live site"}
                        </MenuItem>
                    )}
                    {externalLink && (recordActions || onInspect || onViewHistory) &&
                        <Separator orientation={"horizontal"}/>}
                    {recordActions}
                    {recordActions && (onInspect || onViewHistory) && <Separator orientation={"horizontal"}/>}
                    {onViewHistory && (
                        <MenuItem onClick={onViewHistory}>
                            <HistoryIcon size={iconSize.smallest}/>
                            {t("record_history") ?? "History"}
                        </MenuItem>
                    )}
                    {onInspect && (
                        <MenuItem onClick={onInspect}>
                            <CodeIcon size={iconSize.smallest}/>
                            {t("inspect_record") ?? "Inspect record"}
                        </MenuItem>
                    )}
                </Menu>
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
    status,
    t
}: {
    dirty: boolean;
    saving: boolean;
    status: EntityStatus;
    t: (key: string) => string;
}) {
    if (saving) {
        return <StateText>{t("saving")}</StateText>;
    }
    if (dirty) {
        return <StateText>{t("unsaved_changes_title")}</StateText>;
    }
    if (status === "existing") {
        return <StateText>{t("entity_saved") ?? "Saved"}</StateText>;
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

    const { t } = useTranslation();
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
        <Tooltip title={copied ? t("copied") : value}>
            <button type={"button"}
                onClick={copy}
                aria-label={`${t("copy_id")} ${value}`}
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
