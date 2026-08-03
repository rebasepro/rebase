import type { AdminCollection } from "@rebasepro/admin-types";
import type { Entity } from "@rebasepro/types";
import type { FormContext } from "../types/fields";
import React, { lazy, Suspense, useEffect } from "react";
import {
    CircularProgressCenter,
    cls,
    defaultBorderMixin,
    ErrorBoundary,
    IconButton,
    iconSize,
    Tab,
    Tabs,
    XIcon
} from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";
import { JsonPreviewBinding } from "./JsonPreviewBinding";

const EntityHistoryView = lazy(() => import("./history").then(m => ({ default: m.EntityHistoryView })));

export type InspectorTab = "json" | "history";

export interface EntityInspectorProps {
    /** The open tab, or null when the panel is closed. */
    tab: InspectorTab | null;
    onTabChange: (tab: InspectorTab) => void;
    onClose: () => void;
    collection: AdminCollection;
    entity?: Entity<Record<string, unknown>>;
    formContext?: FormContext<Record<string, unknown>>;
    values?: Record<string, unknown>;
    /** History is only offered when the collection records it. */
    includeHistory: boolean;
    /**
     * Bumped once per save by the view that owns the form. The panel stays open
     * across a save — the bar's Save button sits above it — so without this the
     * history list would still be the one fetched when the panel opened.
     */
    refreshToken?: number;
}

/**
 * Raw values and revision history, as an inspector rather than as tabs.
 *
 * These were the first two entries in the entity tab strip — two icon-only tabs
 * with no label and no tooltip, sitting *before* the record you opened the page
 * to edit. They are developer tools, not places the record lives, so they belong
 * behind one affordance in the bar; a content editor should never meet `<>`.
 *
 * The panel sits below the identity bar and beside the record deliberately: you
 * keep seeing which record you are inspecting, and keep being able to edit it.
 */
export function EntityInspector({
    tab,
    onTabChange,
    onClose,
    collection,
    entity,
    formContext,
    values,
    includeHistory,
    refreshToken
}: EntityInspectorProps) {

    const { t } = useTranslation();
    const open = tab !== null;

    useEffect(() => {
        if (!open) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.stopPropagation();
                onClose();
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [open, onClose]);

    if (!open) return null;

    return (
        // Docked beside the record rather than over it. As an overlay with a
        // scrim this was modal in effect: the first click into the form went to
        // the scrim and closed the panel, so a revision list could never be
        // open while you edited the record it belongs to — which is the only
        // time watching it is worth anything.
        <div className={cls(
            "relative flex flex-col shrink-0 h-full w-full max-w-md border-l",
            "bg-white dark:bg-surface-800",
            defaultBorderMixin
        )}
        role={"complementary"}
        aria-label={t("inspect_record") ?? "Inspect record"}>

            <div className={cls("h-11 shrink-0 flex items-center gap-2 pl-4 pr-1.5 border-b", defaultBorderMixin)}>
                <span className={"text-sm font-semibold"}>{t("inspect") ?? "Inspect"}</span>

                <div className={"flex-1"}/>

                {includeHistory
                    ? <Tabs value={tab ?? "json"}
                        className={"!w-fit"}
                        onValueChange={(v) => onTabChange(v as InspectorTab)}>
                        <Tab value={"json"} className={"text-xs"}>{t("json")}</Tab>
                        <Tab value={"history"} className={"text-xs"}>
                            {t("record_history") ?? "History"}
                        </Tab>
                    </Tabs>
                    : null}

                <IconButton size={"small"} onClick={onClose}
                    aria-label={t("close_inspector") ?? "Close inspector"}>
                    <XIcon size={iconSize.smallest}/>
                </IconButton>
            </div>

            <div className={"flex-1 min-h-0 overflow-auto"}>
                <ErrorBoundary>
                    {tab === "json" && (
                        <JsonPreviewBinding values={values ?? entity?.values ?? {}}/>
                    )}
                    {tab === "history" && includeHistory && formContext && (
                        <Suspense fallback={<CircularProgressCenter/>}>
                            <EntityHistoryView
                                collection={collection}
                                entity={entity}
                                formContext={formContext}
                                refreshToken={refreshToken}
                                modifiedValues={values ?? entity?.values}/>
                        </Suspense>
                    )}
                </ErrorBoundary>
            </div>
        </div>
    );
}
