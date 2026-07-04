
import { IconForView } from "@rebasepro/core";
import React, { useState, useEffect } from "react";
import {
    Button,
    cls,
    defaultBorderMixin,
    IconButton,
    iconSize,
    PlusIcon,
    ResizablePanels,
    Tooltip,
    Typography
} from "@rebasepro/ui";
import type { CollectionConfig } from "@rebasepro/types";
import { CollectionsConfigController } from "../../types/config_controller";
import { CollectionStudioView } from "./CollectionStudioView";
import type { CollectionEditorExtensionProps } from "../../extensibility_types";

export interface CollectionsStudioViewProps extends CollectionEditorExtensionProps {
    configController: CollectionsConfigController;

    /**
     * Collections to show in the sidebar.
     * When provided, overrides the collections from `configController`.
     * Use this to control exactly which collections the editor displays.
     */
    collections?: CollectionConfig[];

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

    // ── Collections list ────────────────────────────────────────────────
    const collections = collectionsProp ?? configController.collections ?? [];

    // ── Sidebar sizing ──────────────────────────────────────────────────
    const [sidebarSize, setSidebarSize] = useState(() => {
        try {
            const saved = localStorage.getItem("rebase_collections_editor_sidebar_size");
            return saved !== null ? parseFloat(saved) : 25;
        } catch (e) {
            return 25;
        }
    });

    useEffect(() => {
        try {
            localStorage.setItem("rebase_collections_editor_sidebar_size", sidebarSize.toString());
        } catch (e) {
            // ignore local storage error
        }
    }, [sidebarSize]);

    return (
        <div className="flex h-full w-full bg-surface-50 dark:bg-surface-800 overflow-hidden text-text-primary dark:text-text-primary-dark">
            <ResizablePanels
                orientation="horizontal"
                panelSizePercent={sidebarSize}
                onPanelSizeChange={setSidebarSize}
                minPanelSizePx={220}
                firstPanel={
                    <div className={cls("flex flex-col h-full w-full bg-surface-50 dark:bg-surface-800 border-r", defaultBorderMixin)}>
                        <div className={cls("flex items-center justify-between px-3 py-2 border-b bg-surface-50 dark:bg-surface-900 min-h-[48px]", defaultBorderMixin)}>
                            <Typography variant="caption" className="font-semibold text-[11px] uppercase tracking-wider text-surface-400 dark:text-surface-400">
                                Collections
                            </Typography>
                            <Tooltip title={configController.readOnly ? configController.readOnlyReason || "Read only" : "Add collection"}>
                                <div>
                                    <IconButton
                                        size="small"
                                        disabled={configController.readOnly}
                                        onClick={() => setActiveCollectionId("new")}
                                        className={activeCollectionId === "new" ? "text-primary dark:text-primary-dark" : "text-text-secondary dark:text-text-secondary-dark"}
                                    >
                                        <PlusIcon size={iconSize.smallest}/>
                                    </IconButton>
                                </div>
                            </Tooltip>
                        </div>

                        <div className="flex-grow overflow-y-auto w-full no-scrollbar p-2 space-y-0.5">
                            {collections.length === 0 && (
                                <div className="p-4 text-center">
                                    <Typography variant="caption" className="text-text-disabled dark:text-text-disabled-dark italic">
                                        No collections yet.
                                    </Typography>
                                </div>
                            )}
                            {collections.map((collection) => {
                                const collectionKey = collection.slug;
                                const isSelected = activeCollectionId === collectionKey;
                                return (
                                    <div
                                        key={collectionKey}
                                        onClick={() => setActiveCollectionId(collectionKey)}
                                        className={cls(
                                            "flex items-center gap-2.5 px-3 h-[30px] cursor-pointer rounded-lg text-[13px] font-medium transition-colors",
                                            isSelected
                                                ? "bg-primary/8 text-primary dark:bg-primary/10 dark:text-primary-light font-semibold"
                                                : "hover:bg-primary/5 dark:hover:bg-primary/5 text-surface-700 dark:text-surface-300 hover:text-surface-900 dark:hover:text-white"
                                        )}
                                    >
                                        <IconForView collectionOrView={collection} size={"smallest"} className={cls(
                                            isSelected
                                                ? "text-primary dark:text-primary-light"
                                                : "text-surface-500 dark:text-text-secondary-dark"
                                        )}/>
                                        <span className="truncate flex-1">
                                            {collection.name || collection.slug}
                                        </span>
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
                                onCancel={() => setActiveCollectionId(undefined)}
                                propertyTypePresets={propertyTypePresets}
                                hiddenPropertyTypes={hiddenPropertyTypes}
                                renderExtraPropertyFields={renderExtraPropertyFields}
                                renderExtraCollectionFields={renderExtraCollectionFields}
                                visibleTabs={visibleTabs}
                                standalone={standalone}
                            />
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full gap-4">
                                <Typography variant="label">
                                    Select a collection or create a new one to start editing
                                </Typography>
                                <Button
                                    disabled={configController.readOnly}
                                    onClick={() => setActiveCollectionId("new")}
                                >
                                    <PlusIcon/>
                                    Add new collection
                                </Button>
                            </div>
                        )}
                    </div>
                }
            />
        </div>
    );
}
