import type { AdminCollection } from "@rebasepro/admin-types";
import type { Entity } from "@rebasepro/types";
import type { FormContext } from "../types/fields";
import React, { lazy, Suspense, useEffect, useState } from "react";
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
import { JsonPreviewBinding } from "./JsonPreviewBinding";

const EntityHistoryView = lazy(() => import("./history").then(m => ({ default: m.EntityHistoryView })));

export type InspectorTab = "json" | "history";

export interface EntityInspectorProps {
    open: boolean;
    onClose: () => void;
    collection: AdminCollection;
    entity?: Entity<Record<string, unknown>>;
    formContext?: FormContext<Record<string, unknown>>;
    values?: Record<string, unknown>;
    /** History is only offered when the collection records it. */
    includeHistory: boolean;
}

/**
 * Raw values and revision history, as an inspector rather than as tabs.
 *
 * These were the first two entries in the entity tab strip — two icon-only tabs
 * with no label and no tooltip, sitting *before* the record you opened the page
 * to edit. They are developer tools, not places the record lives, so they belong
 * behind one affordance in the bar; a content editor should never meet `<>`.
 *
 * The panel starts below the identity bar deliberately: you keep seeing which
 * record you are inspecting while you inspect it.
 */
export function EntityInspector({
    open,
    onClose,
    collection,
    entity,
    formContext,
    values,
    includeHistory
}: EntityInspectorProps) {

    const [tab, setTab] = useState<InspectorTab>("json");

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
        // Starts below the 52px identity bar, so the record you are inspecting
        // stays named and its actions stay reachable while the panel is open.
        <div className={"absolute inset-x-0 bottom-0 top-[52px] z-30 flex justify-end"}
            role={"dialog"}
            aria-label={"Inspect record"}>

            <div className={"absolute inset-0 bg-black/25"}
                onClick={onClose}
                aria-hidden={true}/>

            <div className={cls(
                "relative flex flex-col w-full max-w-md border-l shadow-xl",
                "bg-white dark:bg-surface-800",
                defaultBorderMixin
            )}>
                <div className={cls("h-11 shrink-0 flex items-center gap-2 pl-4 pr-1.5 border-b", defaultBorderMixin)}>
                    <span className={"text-sm font-semibold"}>Inspect</span>

                    <div className={"flex-1"}/>

                    {includeHistory
                        ? <Tabs value={tab}
                            className={"!w-fit"}
                            onValueChange={(v) => setTab(v as InspectorTab)}>
                            <Tab value={"json"} className={"text-xs"}>JSON</Tab>
                            <Tab value={"history"} className={"text-xs"}>History</Tab>
                        </Tabs>
                        : null}

                    <IconButton size={"small"} onClick={onClose} aria-label={"Close inspector"}>
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
                                    modifiedValues={values ?? entity?.values}/>
                            </Suspense>
                        )}
                    </ErrorBoundary>
                </div>
            </div>
        </div>
    );
}
