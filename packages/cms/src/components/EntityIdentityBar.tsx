import type { AdminCollection } from "@rebasepro/cms-types";
import type { EntityStatus } from "@rebasepro/types";
import React, { useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link } from "react-router";
import { useTranslation } from "@rebasepro/app";
import {
    Button,
    CheckIcon,
    CircularProgress,
    ChevronDownIcon,
    cls,
    CodeIcon,
    CopyIcon,
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
    Typography,
    XIcon
} from "@rebasepro/ui";
import type { PlacedEntityActions } from "../util/entity_actions";
import { fitInlineActions, type InlineActionsFit } from "../util/fit_inline_actions";

/**
 * One of the record's own actions, resolved and ready to run — what the bar
 * needs to draw it as a button or as a menu item.
 */
export interface RecordActionItem {
    key: string;
    name: string;
    icon?: React.ReactNode;
    enabled: boolean;
    /**
     * Runs the action, reporting its own failure. Returns a promise only when
     * the action is asynchronous, which is what keeps a button's spinner up.
     */
    run: () => Promise<void> | undefined;
}

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

    /**
     * Where {@link onSaveAndClose} is offered.
     *
     * `"button"` — its own filled button, and Save demotes to text. For the
     * overlays, where you opened the record to do one thing to it and closing is
     * the dominant intent.
     *
     * `"menu"` — a `▾` welded to the Save button. For the split, where the list
     * is right there and `j`/`k` walk from record to record: there, saving and
     * *staying* is the common case, so it keeps the filled button and dismissing
     * is one step further in. The gesture still exists, so muscle memory carried
     * over from the side panel finds it.
     */
    saveAndClosePlacement?: "button" | "menu";

    /**
     * Dismiss this record, from the ✕ at the bar's trailing edge.
     *
     * Fenced off from Save by a separator: it is chrome, not the last item in
     * the action row. The panel that supplies it decides what dismissing means —
     * in the split it is a navigation, which the layout's unsaved-changes
     * blocker already guards, so the ✕ cannot drop an edit without asking.
     */
    onClose?: () => void;

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
     * adds — already placed: `inline` ones are buttons ahead of Save, folding
     * into the overflow menu when the bar runs short of room, and the rest are
     * menu groups. They live here rather than in a footer, which is what let
     * the footer go away entirely.
     */
    recordActions?: PlacedEntityActions<RecordActionItem>;

    /**
     * The read-only view's Edit: its main button, drawn where Save stands on
     * the edit view — after the record's own buttons, ahead of the menu.
     */
    primaryAction?: React.ReactNode;

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
    saveAndClosePlacement = "button",
    onClose,
    onBack,
    onInspect,
    onViewHistory,
    externalLink,
    recordActions,
    primaryAction,
    pluginActions,
    trailing,
    leading
}: EntityIdentityBarProps) {

    const { t } = useTranslation();

    const inline = recordActions?.inline ?? NO_ACTIONS;
    const inlineRef = useRef<HTMLDivElement>(null);
    const labelledRef = useRef<HTMLDivElement>(null);
    const compactRef = useRef<HTMLDivElement>(null);
    const fit = useInlineActionsFit(inlineRef, labelledRef, compactRef, inline);

    // What did not fit leads the menu, ahead of the actions that were always
    // there: it is what the developer ranked highest.
    const ownActions = [...inline.slice(fit.count), ...(recordActions?.own ?? NO_ACTIONS)];
    const genericActions = recordActions?.generic ?? NO_ACTIONS;
    const destructiveActions = recordActions?.destructive ?? NO_ACTIONS;
    const hasUtilities = genericActions.length > 0 || Boolean(externalLink) || Boolean(onViewHistory) || Boolean(onInspect);
    const menuGroups = [ownActions.length > 0, hasUtilities, destructiveActions.length > 0];
    const hasMenu = menuGroups.some(Boolean);
    // A rule between two groups that are both there, never at an edge.
    const ruleBefore = (group: number) => menuGroups[group] && menuGroups.slice(0, group).some(Boolean);

    return (
        <div className={cls(
            // No line under it: the bar and the tab strip below are one band on
            // the sheet, and the strip already carries the edge the folder tab
            // sits on. Regions meet with a step, not a rule.
            "h-[52px] shrink-0 flex items-center gap-2 pl-1.5 pr-2",
            "bg-surface-sheet"
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

            <span className={cls(
                "font-headers font-semibold text-[15px] tracking-tight truncate min-w-0",
                // The title takes the room it needs and the actions get what is
                // left, so a long one would fold every action away. Capped, it
                // truncates first — only where there are actions to make room for.
                inline.length > 0 && "max-w-[40%]"
            )}
                title={title}>
                {title}
            </span>

            {entityId !== undefined && <IdChip value={String(entityId)}/>}

            {/* The bar's free space, and the actions that fit in it. Always
                rendered: it is the spacer, and the observer measures it. */}
            <div ref={inlineRef}
                className={"flex-1 min-w-0 flex items-center justify-end gap-1"}>
                {inline.slice(0, fit.count).map(action =>
                    <RecordActionButton key={action.key} action={action} compact={fit.compact}/>)}
                {inline.length > 0 && (
                    // Every action in both of its forms, laid out at its natural
                    // width and never seen, so a fit can be decided without
                    // first drawing the bar wrong. A zero-size clipping box: it
                    // takes no room and cannot widen anything it sits in.
                    <div aria-hidden={true}
                        className={"absolute w-0 h-0 overflow-hidden invisible pointer-events-none"}>
                        <div ref={labelledRef} className={"flex w-max"}>
                            {inline.map(action =>
                                <RecordActionButton key={action.key} action={action} compact={false}/>)}
                        </div>
                        <div ref={compactRef} className={"flex w-max"}>
                            {inline.map(action =>
                                <RecordActionButton key={action.key} action={action} compact={true}/>)}
                        </div>
                    </div>
                )}
            </div>

            {pluginActions}

            <EntitySaveActions status={status}
                dirty={dirty}
                saving={saving}
                onSave={onSave}
                onDiscard={onDiscard}
                saveDisabled={saveDisabled}
                hasErrors={hasErrors}
                onSaveAndClose={onSaveAndClose}
                saveAndClosePlacement={saveAndClosePlacement}/>

            {primaryAction}

            {hasMenu && (
                <Menu align={"end"}
                    trigger={
                        <IconButton size={"small"} aria-label={t("more_actions") ?? "More actions"}>
                            <MoreVerticalIcon size={iconSize.smallest}/>
                        </IconButton>
                    }>
                    {/* The collection's own operations first — the reason
                        someone opened this record — then the ones every record
                        has, then Delete, last and apart. */}
                    {ownActions.map(action => <RecordActionMenuItem key={action.key} action={action}/>)}
                    {ruleBefore(1) && <Separator orientation={"horizontal"}/>}
                    {genericActions.map(action => <RecordActionMenuItem key={action.key} action={action}/>)}
                    {externalLink && (
                        <MenuItem onClick={() => window.open(externalLink, "_blank", "noopener,noreferrer")}>
                            <ExternalLinkIcon size={iconSize.smallest}/>
                            {t("open_in_live_site") ?? "Open in the live site"}
                        </MenuItem>
                    )}
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
                    {ruleBefore(2) && <Separator orientation={"horizontal"}/>}
                    {destructiveActions.map(action => <RecordActionMenuItem key={action.key} action={action}/>)}
                </Menu>
            )}

            {trailing}

            {/* Last, and set apart by space rather than a rule. A ✕ flush against
                Save reads as the next item in the action row, and the two
                adjacent controls are then "commit this edit" and "abandon it";
                the vertical separator that used to fence it off was the one
                line on the bar, and a line marks an object, not a gap. */}
            {onClose && (
                <Tooltip title={`${t("close")} · Esc`}>
                    <IconButton size={"small"} onClick={onClose} aria-label={t("close")} className={"ml-2"}>
                        <XIcon size={iconSize.smallest}/>
                    </IconButton>
                </Tooltip>
            )}
        </div>
    );
}

const NO_ACTIONS: RecordActionItem[] = [];

/** `gap-1`, between the inline actions. */
const INLINE_ACTIONS_GAP = 4;

/**
 * Which of the inline actions fit in the bar's free space, and whether they
 * keep their labels — decided from the measuring copies before the bar is
 * painted, and again whenever the space or the buttons change size: a resize,
 * Discard appearing beside Save, a web font arriving, a language switch.
 */
function useInlineActionsFit(
    containerRef: React.RefObject<HTMLDivElement | null>,
    labelledRef: React.RefObject<HTMLDivElement | null>,
    compactRef: React.RefObject<HTMLDivElement | null>,
    actions: RecordActionItem[]
): InlineActionsFit {

    const [fit, setFit] = useState<InlineActionsFit>({ count: actions.length, compact: false });
    const actionKeys = actions.map(action => action.key).join("\u0000");

    useLayoutEffect(() => {
        const container = containerRef.current;
        const labelled = labelledRef.current;
        const compact = compactRef.current;
        if (!container || !labelled || !compact) {
            setFit(previous => previous.count === 0 && !previous.compact ? previous : { count: 0, compact: false });
            return;
        }
        const widths = (row: HTMLElement) =>
            Array.from(row.children).map(child => child.getBoundingClientRect().width);
        const measure = () => {
            const next = fitInlineActions(container.clientWidth, widths(labelled), widths(compact), INLINE_ACTIONS_GAP);
            setFit(previous => previous.count === next.count && previous.compact === next.compact ? previous : next);
        };
        measure();
        if (typeof ResizeObserver === "undefined") return;
        // Synchronously: the observer reports after layout and before paint,
        // and an ordinary update would render after that paint — one frame
        // with the old buttons drawn over the title whenever Discard appeared.
        const observer = new ResizeObserver(() => flushSync(measure));
        observer.observe(container);
        observer.observe(labelled);
        observer.observe(compact);
        return () => observer.disconnect();
    }, [containerRef, labelledRef, compactRef, actionKeys]);

    return fit;
}

/**
 * An action promoted out of the menu: a text button with its icon, as the
 * collection toolbar draws Filter and Sort, or the icon alone with its name in
 * a tooltip where the bar is short of room. It shows a spinner while the work
 * it started is running, and cannot be pressed twice meanwhile.
 */
function RecordActionButton({ action, compact }: { action: RecordActionItem, compact: boolean }) {

    const [running, setRunning] = useState(false);

    const onClick = () => {
        const pending = action.run();
        if (!pending) return;
        setRunning(true);
        pending.finally(() => setRunning(false));
    };

    if (compact && action.icon) {
        return (
            <Tooltip title={action.name}>
                <IconButton size={"small"}
                    aria-label={action.name}
                    disabled={!action.enabled || running}
                    onClick={onClick}>
                    {running ? <CircularProgress size={"smallest"}/> : action.icon}
                </IconButton>
            </Tooltip>
        );
    }

    return (
        <LoadingButton variant={"text"}
            size={"small"}
            startIcon={action.icon}
            loading={running}
            disabled={!action.enabled}
            onClick={onClick}>
            {action.name}
        </LoadingButton>
    );
}

function RecordActionMenuItem({ action }: { action: RecordActionItem }) {
    return (
        <MenuItem disabled={!action.enabled} onClick={() => void action.run()}>
            {action.icon}
            {action.name}
        </MenuItem>
    );
}

export type EntitySaveActionsProps = Pick<EntityIdentityBarProps,
    "status" | "dirty" | "saving" | "onSave" | "onDiscard" | "saveDisabled" | "hasErrors"
    | "onSaveAndClose" | "saveAndClosePlacement">;

/**
 * Save, "save and close", Discard, and the words saying where the edit stands.
 *
 * Its own component because it has two homes. On a page and in the side panel
 * it sits in the identity bar, where it stays in view while the form scrolls. In
 * the dialog it sits in a footer under the form: a dialog is read top to bottom
 * and finished at the bottom, where every other dialog in the app keeps its
 * buttons, and the bar at its top is left to say what the record is.
 */
export function EntitySaveActions({
    status,
    dirty,
    saving,
    onSave,
    onDiscard,
    saveDisabled,
    hasErrors,
    onSaveAndClose,
    saveAndClosePlacement = "button"
}: EntitySaveActionsProps) {

    const { t } = useTranslation();

    const saveLabel = status === "existing"
        ? t("save")
        : status === "copy" ? t("create_copy") : t("create");
    const closeLabel = status === "existing"
        ? t("save_and_close")
        : status === "copy" ? t("create_copy_and_close") : t("create_and_close");

    // The two shapes "save and close" takes, so the Save button next to it knows
    // whether it is still the primary action.
    const saveAndCloseButton = Boolean(onSaveAndClose) && saveAndClosePlacement === "button";
    const saveAndCloseMenu = Boolean(onSaveAndClose) && saveAndClosePlacement === "menu";

    const saveTooltip = hasErrors
        ? (t("fix_errors_before_saving") ?? "Fix highlighted errors before saving")
        : undefined;

    return <>
        {/* Only where there is something to save. The read-only detail
            view has no Save button, and reporting "Saved" there implies an
            editing session the user never started. */}
        {onSave && <SaveState dirty={dirty} saving={saving} status={status} t={t}/>}

        {onDiscard && dirty && !saving && (
            <Button variant={"text"} size={"small"} onClick={onDiscard}>
                {status === "existing" ? t("discard") : t("clear")}
            </Button>
        )}

        {onSave && (
            // `rounded-lg overflow-hidden`: the two halves of the split
            // button are square inside and the group carries the radius, so
            // there is one control with a seam rather than two buttons that
            // happen to touch. Their borders match their own fill, so the
            // seam has to be drawn — see the `▾` half for where and in what.
            <div className={"flex items-stretch rounded-lg overflow-hidden"}>
                <Tooltip title={saveTooltip}>
                    <LoadingButton
                        // Where a separate close button carries it, closing
                        // is the dominant intent and takes the filled
                        // treatment. Under the `▾` the record is staying
                        // open, so Save keeps it.
                        variant={saveAndCloseButton ? "text" : "filled"}
                        color={"primary"}
                        size={"small"}
                        loading={saving && !saveAndCloseButton}
                        disabled={saveDisabled}
                        onClick={onSave}
                        className={saveAndCloseMenu ? "rounded-none" : undefined}>
                        {saveLabel}
                    </LoadingButton>
                </Tooltip>

                {saveAndCloseMenu && <>
                    <Menu align={"end"}
                        trigger={
                            <Button variant={"filled"}
                                color={"primary"}
                                size={"small"}
                                disabled={saveDisabled}
                                aria-label={closeLabel}
                                // The seam is this half's own left border,
                                // tinted from `currentColor` — the ink the
                                // label is drawn in — so it holds on any
                                // button colour and dims with the control
                                // rather than needing a case per state. It
                                // was a `bg-white/25` span between the
                                // halves: a bright hairline scratched over a
                                // saturated blue, and, being a sibling of
                                // the buttons rather than part of one, it
                                // stayed at full strength while `disabled`
                                // dropped both halves to `opacity-40` — a
                                // rule brighter than the button it bisected.
                                // Inline because it has to beat the
                                // variant's `border-<color>` on one edge.
                                style={{ borderLeftColor: "color-mix(in oklab, currentColor 15%, transparent)" }}
                                className={"rounded-none px-1.5"}>
                                <ChevronDownIcon size={iconSize.smallest}/>
                            </Button>
                        }>
                        <MenuItem onClick={onSaveAndClose}>
                            <CheckIcon size={iconSize.smallest}/>
                            {closeLabel}
                        </MenuItem>
                    </Menu>
                </>}
            </div>
        )}

        {saveAndCloseButton && (
            <LoadingButton variant={"filled"}
                color={"primary"}
                size={"small"}
                loading={saving}
                disabled={saveDisabled}
                onClick={onSaveAndClose}>
                {closeLabel}
            </LoadingButton>
        )}
    </>;
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
                    // `whitespace-nowrap`: the middle of the id is elided with a
                    // `…`, and a line break is allowed after one. In the dialog,
                    // where the bar is narrow and every button is on it, the
                    // chip broke across two lines inside a 52px row.
                    "hidden md:inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap px-2 py-0.5 rounded-md",
                    "font-mono text-[11px] text-text-secondary dark:text-text-secondary-dark",
                    "bg-surface-field",
                    "hover:bg-surface-field-hover transition-colors"
                )}>
                {truncated}
                {copied ? <CheckIcon size={iconSize.smallest}/> : <CopyIcon size={iconSize.smallest}/>}
            </button>
        </Tooltip>
    );
}
