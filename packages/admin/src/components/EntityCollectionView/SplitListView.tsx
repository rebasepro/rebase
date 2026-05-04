import type { EntityCollection } from "@rebasepro/types";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CollectionSize, Entity, EntityTableController, SelectionController } from "@rebasepro/types";
import { EntityEditView } from "../EntityEditView";
import {
    cls,
    defaultBorderMixin,
    ResizablePanels
} from "@rebasepro/ui";
import { useLargeLayout } from "@rebasepro/core";
import { useCollectionRegistryController } from "../../index";
import { useNavigate } from "react-router-dom";
import { useUrlController } from "../../index";
import { ErrorBoundary } from "@rebasepro/ui";

export type SplitListViewProps<M extends Record<string, unknown> = Record<string, unknown>> = {
    collection: EntityCollection<M>;
    tableController: EntityTableController<M>;
    onEntityClick?: (entity: Entity<M>) => void;
    onNewClick?: () => void;
    selectionController?: SelectionController<M>;
    selectionEnabled?: boolean;
    highlightedEntities?: Entity<M>[];
    emptyComponent?: React.ReactNode;
    onScroll?: (props: {
        scrollDirection: "forward" | "backward";
        scrollOffset: number;
        scrollUpdateWasRequested: boolean;
    }) => void;
    initialScroll?: number;
    size?: CollectionSize;
    path: string;
    parentCollectionIds?: string[];
    /**
     * The entity ID to show in the detail panel.
     * Comes from the URL path (e.g. /c/authors/14 → selectedEntityId = "14").
     * When undefined, no detail panel is shown.
     */
    selectedEntityId?: string | number;
    /**
     * Toolbar to render above the content in the left panel.
     */
    toolbar?: React.ReactNode;
    /**
     * The collection view to render on the left side.
     */
    children: React.ReactNode;
};

const PANEL_SIZE_KEY = "rebase_split_list_panel_size";

function getSavedPanelSize(path: string): number {
    try {
        const saved = localStorage.getItem(`${PANEL_SIZE_KEY}_${path}`);
        if (saved !== null) {
            const val = parseFloat(saved);
            if (!isNaN(val) && val > 0 && val < 100) return val;
        }
    } catch { /* ignore */ }
    return 30;
}

function savePanelSize(path: string, size: number) {
    try {
        localStorage.setItem(`${PANEL_SIZE_KEY}_${path}`, size.toString());
    } catch { /* ignore */ }
}

/**
 * Master-detail split view.
 * Shows the list on the left and the entity edit view on the right.
 *
 * Animation approach:
 * - The list always renders at full width.
 * - When a detail opens, the list shrinks to `panelSize%` and the detail slides in.
 * - On close, the reverse plays.
 *
 * State management:
 * - The selected entity is driven by the URL path (e.g. /c/authors/14).
 *   `selectedEntityId` comes from props via RebaseRoute, NOT from internal state.
 * - Clicking an entity navigates to /c/authors/{id} via the standard onEntityClick handler.
 * - Closing the detail navigates back to /c/authors.
 */
export function SplitListView<M extends Record<string, unknown> = Record<string, unknown>>({
    collection,
    tableController,
    onEntityClick: externalOnEntityClick,
    onNewClick: externalOnNewClick,
    selectionController,
    selectionEnabled = true,
    highlightedEntities,
    emptyComponent,
    onScroll,
    initialScroll,
    size = "m",
    path,
    parentCollectionIds,
    selectedEntityId,
    toolbar,
    children
}: SplitListViewProps<M>) {
    const largeLayout = useLargeLayout();
    const collectionRegistryController = useCollectionRegistryController();
    const navigate = useNavigate();
    const urlController = useUrlController();

    const showDetail = selectedEntityId !== undefined;

    // Panel size state with persistence
    const [panelSize, setPanelSize] = useState(() => getSavedPanelSize(path));

    useEffect(() => {
        savePanelSize(path, panelSize);
    }, [panelSize, path]);

    // ── Animation state ──
    // We track the "rendered" entity to keep the detail panel mounted during the exit animation.
    const [renderedEntityId, setRenderedEntityId] = useState<string | number | undefined>(selectedEntityId);
    const [animationPhase, setAnimationPhase] = useState<"idle" | "entering" | "entered" | "exiting">(
        selectedEntityId !== undefined ? "entered" : "idle"
    );
    const animationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Transition duration (ms) — keep in sync with CSS
    const TRANSITION_DURATION = 150;

    useEffect(() => {
        if (animationTimer.current) {
            clearTimeout(animationTimer.current);
            animationTimer.current = null;
        }

        if (selectedEntityId !== undefined) {
            // Opening or switching entity
            setRenderedEntityId(selectedEntityId);
            if (animationPhase === "idle" || animationPhase === "exiting") {
                // Fresh open — trigger enter
                setAnimationPhase("entering");
                // Use requestAnimationFrame to ensure the "entering" class is painted
                // before transitioning to "entered".
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        setAnimationPhase("entered");
                    });
                });
            }
            // If already entered (switching entities), keep "entered"
        } else {
            // Closing
            if (animationPhase === "entered" || animationPhase === "entering") {
                setAnimationPhase("exiting");
                animationTimer.current = setTimeout(() => {
                    setAnimationPhase("idle");
                    setRenderedEntityId(undefined);
                }, TRANSITION_DURATION);
            }
        }

        return () => {
            if (animationTimer.current) clearTimeout(animationTimer.current);
        };
    }, [selectedEntityId]); // Intentionally only depend on selectedEntityId

    // Close the detail panel: navigate back to the collection path
    const handleCloseDetail = useCallback(() => {
        const collectionUrl = urlController.buildUrlCollectionPath(path);
        navigate(collectionUrl);
    }, [navigate, urlController, path]);

    // ── Keyboard navigation ──
    const entityIds = useMemo(
        () => tableController.data.map((e: Entity<M>) => e.id),
        [tableController.data]
    );

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Don't intercept when user is typing in an input/textarea
            const tag = (e.target as HTMLElement)?.tagName;
            if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target as HTMLElement)?.isContentEditable) {
                // Only intercept Escape when inside the detail panel
                if (e.key === "Escape" && selectedEntityId) {
                    handleCloseDetail();
                    e.preventDefault();
                }
                return;
            }

            if (e.key === "Escape" && selectedEntityId) {
                handleCloseDetail();
                e.preventDefault();
                return;
            }

            // Arrow down / j → next entity
            if ((e.key === "ArrowDown" || e.key === "j") && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                if (entityIds.length === 0) return;

                if (selectedEntityId === undefined) {
                    const firstEntity = tableController.data[0];
                    if (firstEntity) externalOnEntityClick?.(firstEntity);
                } else {
                    const currentIndex = entityIds.indexOf(selectedEntityId);
                    if (currentIndex >= 0 && currentIndex < entityIds.length - 1) {
                        const nextEntity = tableController.data[currentIndex + 1];
                        if (nextEntity) externalOnEntityClick?.(nextEntity);
                    }
                }
                return;
            }

            // Arrow up / k → previous entity
            if ((e.key === "ArrowUp" || e.key === "k") && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                if (entityIds.length === 0) return;

                if (selectedEntityId === undefined) {
                    const lastEntity = tableController.data[tableController.data.length - 1];
                    if (lastEntity) externalOnEntityClick?.(lastEntity);
                } else {
                    const currentIndex = entityIds.indexOf(selectedEntityId);
                    if (currentIndex > 0) {
                        const prevEntity = tableController.data[currentIndex - 1];
                        if (prevEntity) externalOnEntityClick?.(prevEntity);
                    }
                }
                return;
            }

            // n → new entity
            if (e.key === "n" && !e.metaKey && !e.ctrlKey && !e.altKey) {
                externalOnNewClick?.();
                e.preventDefault();
                return;
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [selectedEntityId, handleCloseDetail, externalOnEntityClick, externalOnNewClick, entityIds, tableController.data]);

    const usedParentCollectionIds = parentCollectionIds ?? collectionRegistryController.getParentCollectionIds(path);

    const isDetailVisible = animationPhase !== "idle";

    // On small screens: show entity form when selected, otherwise show the list
    if (!largeLayout) {
        return (
            <div className="relative flex-grow flex flex-col min-w-0 h-full w-full overflow-hidden">
                {/* List — slides left and fades when detail is open */}
                <div
                    className={cls(
                        "absolute inset-0 transition-all ease-out",
                        isDetailVisible
                            ? "opacity-0 -translate-x-1/3 pointer-events-none"
                            : "opacity-100 translate-x-0"
                    )}
                    style={{ transitionDuration: `${TRANSITION_DURATION}ms` }}
                >
                    {toolbar}
                    {children}
                </div>

                {/* Detail — slides in from right */}
                {renderedEntityId !== undefined && (
                    <div
                        className={cls(
                            "absolute inset-0 transition-all ease-out",
                            animationPhase === "entered"
                                ? "opacity-100 translate-x-0"
                                : "opacity-0 translate-x-1/3"
                        )}
                        style={{ transitionDuration: `${TRANSITION_DURATION}ms` }}
                    >
                        <ErrorBoundary>
                            <EntityEditView
                                key={String(renderedEntityId)}
                                path={path}
                                collection={collection as EntityCollection<Record<string, unknown>>}
                                entityId={renderedEntityId}
                                parentCollectionIds={usedParentCollectionIds}
                                layout="split"
                            />
                        </ErrorBoundary>
                    </div>
                )}
            </div>
        );
    }

    // ── Large layout: animated split using ResizablePanels ──

    const listPanel = (
        <div className="flex flex-col h-full overflow-hidden min-w-0">
            {toolbar}
            {children}
        </div>
    );

    const detailPanel = isDetailVisible && renderedEntityId !== undefined ? (
        <div
            className={cls(
                "flex-1 flex flex-col min-w-0 h-full transition-all ease-out",
                animationPhase === "entered"
                    ? "opacity-100 translate-x-0"
                    : "opacity-0 translate-x-8"
            )}
            style={{ transitionDuration: `${TRANSITION_DURATION}ms` }}
        >
            <ErrorBoundary>
                <EntityEditView
                    key={String(renderedEntityId)}
                    path={path}
                    collection={collection as EntityCollection<Record<string, unknown>>}
                    entityId={renderedEntityId!}
                    parentCollectionIds={usedParentCollectionIds}
                    layout="split"
                />
            </ErrorBoundary>
        </div>
    ) : <></>;

    return (
        <ResizablePanels
            firstPanel={listPanel}
            secondPanel={detailPanel}
            showSecondPanel={isDetailVisible}
            panelSizePercent={animationPhase === "entering" ? 100 : panelSize}
            onPanelSizeChange={setPanelSize}
            minPanelSizePx={240}
        />
    );
}
