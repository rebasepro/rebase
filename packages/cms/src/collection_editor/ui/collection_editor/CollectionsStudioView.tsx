
import { IconForView, UnsavedChangesDialog, useTranslation } from "@rebasepro/app";
import React, { useState, useEffect } from "react";
import {
    Alert,
    Button,
    cls,
    defaultBorderMixin,
    IconButton,
    iconSize,
    PlusIcon,
    ResizablePanels,
    surfaceActiveMixin,
    surfaceHoverMixin,
    Tooltip,
    Typography
} from "@rebasepro/ui";

import { CollectionsConfigController } from "../../types/config_controller";
import { CollectionStudioView } from "./CollectionStudioView";
import type { CollectionEditorExtensionProps } from "../../extensibility_types";
import type { AdminCollection } from "@rebasepro/cms-types";
import { readStoredString, writeStoredString } from "@rebasepro/utils";

export interface CollectionsStudioViewProps extends CollectionEditorExtensionProps {
    configController: CollectionsConfigController;

    /**
     * Collections to show in the sidebar.
     * When provided, overrides the collections from `configController`.
     * Use this to control exactly which collections the editor displays.
     */
    collections?: AdminCollection[];

    /**
     * Controlled active collection ID.
     * When provided together with `onActiveCollectionChange`,
     * navigation is fully external — no internal state is used.
     */
    activeCollectionId?: string;

    /**
     * Called when the user clicks a collection, "new", or navigates.
     * When provided, the component is fully controlled (no internal state).
     * When not provided, the component manages selection via internal state.
     *
     * Pass `"new"` to create a new collection. Pass `undefined` to deselect.
     */
    onActiveCollectionChange?: (collectionId: string | undefined) => void;
}

export function CollectionsStudioView({
    configController,
    collections: collectionsProp,
    activeCollectionId: controlledActiveId,
    onActiveCollectionChange,
    propertyTypePresets,
    hiddenPropertyTypes,
    renderExtraPropertyFields,
    renderExtraCollectionFields,
    visibleTabs,
    standalone,
}: CollectionsStudioViewProps) {

    const { t } = useTranslation();
    /** Why nothing can be added or saved here, when that is so. */
    const readOnlyReason = configController.readOnly
        ? configController.readOnlyReason || t("studio_collections_editor_read_only")
        : undefined;

    // ── Navigation state ────────────────────────────────────────────────
    // If onActiveCollectionChange is provided, the component is controlled.
    // Otherwise, use internal state.
    const [internalActiveId, setInternalActiveId] = useState<string | undefined>(undefined);
    const isControlled = onActiveCollectionChange !== undefined;
    const activeCollectionId = isControlled ? controlledActiveId : internalActiveId;

    const setActiveCollectionId = (id: string | undefined) => {
        if (isControlled) {
            onActiveCollectionChange?.(id);
        } else {
            setInternalActiveId(id);
        }
    };

    // ── Unsaved edits ───────────────────────────────────────────────────
    // The editor is keyed by the active id, so selecting another collection
    // remounts it and drops whatever was typed into the one on screen.
    // Controlled, the selection is the caller's navigation and the caller
    // guards it — `RouterCollectionsStudioView` is a route change, which the
    // editor's own navigation blocker asks about. Uncontrolled, it is state
    // this component owns, and nothing else would ask.
    const [editorDirty, setEditorDirty] = useState(false);
    const [pendingSelection, setPendingSelection] = useState<{ id: string | undefined } | null>(null);

    const selectCollection = (id: string | undefined) => {
        if (!isControlled && editorDirty && id !== activeCollectionId) {
            setPendingSelection({ id });
            return;
        }
        setActiveCollectionId(id);
    };

    // ── Collections list ────────────────────────────────────────────────
    const collections = collectionsProp ?? configController.collections ?? [];

    // ── Sidebar sizing ──────────────────────────────────────────────────
    // Checked, not just parsed: `parseFloat` answers NaN for anything it cannot
    // read, and a NaN pane size lays the sidebar out to nothing — with the bad
    // value still in storage on reload. `SplitListView.getSavedPanelSize` is the
    // same read, done this way.
    const [sidebarSize, setSidebarSize] = useState(() => {
        const saved = readStoredString("rebase_collections_editor_sidebar_size");
        const parsed = saved === null ? NaN : parseFloat(saved);
        return Number.isFinite(parsed) && parsed > 0 && parsed < 100 ? parsed : 25;
    });

    useEffect(() => {
        writeStoredString("rebase_collections_editor_sidebar_size", sidebarSize.toString());
    }, [sidebarSize]);

    return (
        <div className="flex h-full w-full bg-surface-sheet overflow-hidden">
            <ResizablePanels
                orientation="horizontal"
                panelSizePercent={sidebarSize}
                onPanelSizeChange={setSidebarSize}
                minPanelSizePx={220}
                firstPanel={
                    <div className={cls("flex flex-col h-full w-full bg-surface-sheet border-r", defaultBorderMixin)}>
                        <div className="flex items-center justify-between px-3 py-2 min-h-[48px]">
                            <Typography variant="subtitle2">
                                {t("studio_tool_schema")}
                            </Typography>
                            <Tooltip title={readOnlyReason ?? t("add_new_collection")}>
                                <div>
                                    <IconButton
                                        size="small"
                                        aria-label={t("add_new_collection")}
                                        disabled={configController.readOnly}
                                        onClick={() => selectCollection("new")}
                                        toggled={activeCollectionId === "new"}
                                    >
                                        <PlusIcon size={iconSize.smallest}/>
                                    </IconButton>
                                </div>
                            </Tooltip>
                        </div>

                        <div className="flex-grow overflow-y-auto w-full no-scrollbar p-2 space-y-0.5">
                            {collections.length === 0 && (
                                <div className="p-4 text-center">
                                    <Typography variant="caption" color="secondary">
                                        {t("studio_collections_editor_empty")}
                                    </Typography>
                                </div>
                            )}
                            {collections.map((collection) => {
                                const collectionKey = collection.slug;
                                const isSelected = activeCollectionId === collectionKey;
                                return (
                                    <div
                                        key={collectionKey}
                                        role="button"
                                        tabIndex={0}
                                        aria-current={isSelected ? "true" : undefined}
                                        onClick={() => selectCollection(collectionKey)}
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter" || event.key === " ") {
                                                event.preventDefault();
                                                selectCollection(collectionKey);
                                            }
                                        }}
                                        className={cls(
                                            "flex items-center gap-2.5 px-3 h-[30px] cursor-pointer rounded-lg",
                                            isSelected ? surfaceActiveMixin : surfaceHoverMixin
                                        )}
                                    >
                                        <IconForView collectionOrView={collection} size={"smallest"}
                                                     className="text-text-secondary dark:text-text-secondary-dark"/>
                                        <Typography variant="body2" component="span"
                                                    className={cls("truncate flex-1", isSelected && "font-medium")}>
                                            {collection.name || collection.slug}
                                        </Typography>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                }
                secondPanel={
                    <div className="flex-grow flex flex-col min-w-0 h-full w-full">
                        {/* We use key to force unmount when switching collections, preventing stale state */}
                        {activeCollectionId ? (
                            <CollectionStudioView
                                key={activeCollectionId}
                                configController={configController}
                                collectionId={activeCollectionId}
                                onSave={(savedCollection) => {
                                    // After creating a new collection, switch to it
                                    if (activeCollectionId === "new" && savedCollection?.slug) {
                                        setActiveCollectionId(savedCollection.slug);
                                    }
                                }}
                                onDirtyChange={setEditorDirty}
                                // Not through the guard: the editor has already
                                // asked about its own edits before cancelling.
                                onCancel={() => setActiveCollectionId(undefined)}
                                propertyTypePresets={propertyTypePresets}
                                hiddenPropertyTypes={hiddenPropertyTypes}
                                renderExtraPropertyFields={renderExtraPropertyFields}
                                renderExtraCollectionFields={renderExtraCollectionFields}
                                visibleTabs={visibleTabs}
                                standalone={standalone}
                            />
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full gap-4 px-4">
                                <Typography variant="label">
                                    {t("studio_collections_editor_pick")}
                                </Typography>
                                {readOnlyReason
                                    // Not a button that does nothing: why nothing
                                    // can be added, where the button would be.
                                    ? <Alert color="info" className="max-w-lg">{readOnlyReason}</Alert>
                                    : <Button onClick={() => setActiveCollectionId("new")}>
                                        <PlusIcon/>
                                        {t("add_new_collection")}
                                    </Button>}
                            </div>
                        )}
                    </div>
                }
            />
            <UnsavedChangesDialog
                open={pendingSelection !== null}
                body={t("studio_collections_editor_unsaved")}
                handleOk={() => {
                    const next = pendingSelection;
                    setPendingSelection(null);
                    setEditorDirty(false);
                    if (next) setActiveCollectionId(next.id);
                }}
                handleCancel={() => setPendingSelection(null)}
            />
        </div>
    );
}
