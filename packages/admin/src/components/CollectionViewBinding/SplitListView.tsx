
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Entity } from "@rebasepro/types";
import { CollectionSize, EntityTableController, SelectionController, AdminCollection } from "@rebasepro/admin-types";
import { EditViewBinding } from "../EditViewBinding";
import { DetailViewBinding } from "../DetailViewBinding";
import {
    cls,
    defaultBorderMixin,
    ResizablePanels
} from "@rebasepro/ui";
import { useLargeLayout, UnsavedChangesDialog, useNavigationBlocker } from "@rebasepro/app";
import { useCollectionRegistryController } from "../../hooks/navigation/contexts/CollectionRegistryContext";
import { useNavigate, useLocation } from "react-router";
import { useUrlController } from "../../hooks/navigation/contexts/UrlContext";
import { ErrorBoundary } from "@rebasepro/ui";
import { withViewMode } from "../../util/view_mode";
import { SplitViewProvider } from "./SplitViewContext";

export type SplitListViewProps<M extends Record<string, unknown> = Record<string, unknown>> = {
    collection: AdminCollection<M>;
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
    parentCollectionSlugs?: string[], parentEntityIds?: string[];
    /**
     * The entity ID to show in the detail panel.
     * Comes from the URL path (e.g. /c/authors/14 → selectedEntityId = "14").
     * When undefined, no detail panel is shown.
     */
    selectedEntityId?: string | number;
    /**
     * When provided, the detail panel will open this tab (e.g. a subcollection slug).
     * Used by the router to pass the subcollection tab from the URL.
     */
    selectedTab?: string;
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

/**
 * Whether the element accepts text, and therefore owns the keystroke.
 * Covers native fields plus the ARIA roles custom editors expose.
 */
function isTextEntryTarget(target: HTMLElement | null): boolean {
    if (!target) return false;
    const tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (target.isContentEditable) return true;
    return Boolean(target.closest('[contenteditable="true"], [role="textbox"], [role="combobox"], [role="searchbox"]'));
}

/**
 * Whether a bare letter shortcut may act on this target. Only the list side of
 * the split owns them — inside the detail panel a keystroke belongs to the form.
 */
function isListShortcutTarget(target: HTMLElement | null, detailPanel: HTMLElement | null): boolean {
    if (!target || target === document.body) return true;
    return !detailPanel?.contains(target);
}

/**
 * The list's share of the split, as a percentage, before anyone drags it.
 *
 * The list only has to identify a record — a title, a subtitle and a status
 * chip — while the detail beside it carries the whole record and its rail. At
 * 30% the list was taking width from the side that had four columns of fields
 * to lay out.
 *
 * A default, not a constraint: {@link savePanelSize} remembers the drag per
 * collection, so anyone who has already sized this list keeps their size.
 */
const DEFAULT_PANEL_SIZE = 26;

function getSavedPanelSize(path: string): number {
    try {
        const saved = localStorage.getItem(`${PANEL_SIZE_KEY}_${path}`);
        if (saved !== null) {
            const val = parseFloat(saved);
            if (!isNaN(val) && val > 0 && val < 100) return val;
        }
    } catch { /* ignore */ }
    return DEFAULT_PANEL_SIZE;
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
 * - Clicking a entity navigates to /c/authors/{id} via the standard onEntityClick handler.
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
    parentCollectionSlugs, parentEntityIds,
    selectedEntityId,
    selectedTab,
    toolbar,
    children
}: SplitListViewProps<M>) {
    const largeLayout = useLargeLayout();
    const collectionRegistryController = useCollectionRegistryController();
    const location = useLocation();
    const isEditMode = location.pathname.endsWith("/edit") || location.pathname.split("/").pop() === "edit";
    const navigate = useNavigate();
    const urlController = useUrlController();

    const showDetail = selectedEntityId !== undefined;

    // ── Unsaved changes ──
    // The detail form lives inside the split layout, so every way out of it
    // (Escape, j/k, clicking another row, the browser back button) is a plain
    // router navigation. A ref — not state — because the blocker predicate must
    // observe the change synchronously, before the navigation it is guarding.
    const dirty = useRef(false);
    const detailPanelRef = useRef<HTMLDivElement>(null);
    const setDirty = useCallback((modified: boolean) => {
        dirty.current = modified;
    }, []);

    // The form remounts per entity, so its dirty state must not leak into the
    // next one — and it has to be cleared here rather than left to the next
    // form's own first report, because that form spends the load in a skeleton
    // and a navigation during it would prompt about the record before it.
    //
    // On a *change* of record only, never on this view's own mount: a record
    // arriving from full screen carries its edit back in and opens dirty, and
    // the form says so from its first effect — which runs before this one, being
    // a child's. Clearing unconditionally overwrote that report with `false`,
    // and the way out of the split stopped asking about a live edit.
    const previousEntityId = useRef(selectedEntityId);
    useEffect(() => {
        if (previousEntityId.current === selectedEntityId) return;
        previousEntityId.current = selectedEntityId;
        dirty.current = false;
    }, [selectedEntityId]);

    const blocker = useNavigationBlocker(useCallback(({
        currentLocation,
        nextLocation
    }) => {
        if (!dirty.current) return false;
        if (currentLocation.pathname === nextLocation.pathname) return false;
        // Side panel overlays (e.g. following a relation) render above the form
        // and leave it mounted — nothing is lost in either direction.
        const nextHash = nextLocation.hash;
        if (nextHash === "#side" || nextHash === "#new_side") return false;
        const currentHash = currentLocation.hash;
        if (currentHash === "#side" || currentHash === "#new_side") return false;
        return true;
    }, []));

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

    // Build a URL below this collection, preserving the active view mode.
    const buildUrl = useCallback((subPath: string) => {
        return withViewMode(urlController.buildUrlCollectionPath(subPath));
    }, [urlController]);

    // Close the detail panel: navigate back to the collection path
    const handleCloseDetail = useCallback(() => {
        navigate(buildUrl(path));
    }, [navigate, buildUrl, path]);

    // ── Keyboard navigation ──
    const entityIds = useMemo(
        () => tableController.data.map((e: Entity<M>) => e.id),
        [tableController.data]
    );

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;

            // Radix overlays own the keyboard while they are open — including Escape.
            if (document.querySelector('[role="dialog"][data-state="open"]')) return;

            if (e.key === "Escape") {
                if (!selectedEntityId) return;
                // First Escape leaves the field (which may also be dismissing its
                // own dropdown), a second one closes the panel. Closing straight
                // from a focused field would discard an in-progress edit.
                if (isTextEntryTarget(target)) {
                    target?.blur();
                    e.preventDefault();
                    return;
                }
                handleCloseDetail();
                e.preventDefault();
                return;
            }

            // Record navigation only belongs to the list side. Inside the detail
            // panel these keys are the form's — arrows move between fields, and a
            // bare letter is input for widgets that aren't native fields (rich
            // text, code editors, comboboxes).
            if (!isListShortcutTarget(target, detailPanelRef.current)) return;
            if (isTextEntryTarget(target)) return;

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

    const usedParentCollectionIds = parentCollectionSlugs ?? collectionRegistryController.getParentCollectionSlugs(path);
    const usedParentEntityIds = parentEntityIds ?? collectionRegistryController.getParentEntityIds(path);

    const isDetailVisible = animationPhase !== "idle";

    // ── Unified Layout: animated split using ResizablePanels ──

    const listPanel = (
        <div
            className={cls(
                "flex flex-col h-full min-w-0 transition-all ease-out w-full",
                (!largeLayout && isDetailVisible)
                    ? "opacity-0 -translate-x-1/3 pointer-events-none"
                    : "opacity-100 translate-x-0"
            )}
            style={{ transitionDuration: `${TRANSITION_DURATION}ms` }}
        >
            {/* Toolbar stays fixed above the scrollable area */}
            {toolbar}
            {/* Scrollable content: title + insights + list rows */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
                {children}
            </div>
        </div>
    );

    const detailPanel = renderedEntityId !== undefined ? (
        <div
            ref={detailPanelRef}
            className={cls(
                "flex-1 flex flex-col min-w-0 h-full transition-all ease-out w-full",
                animationPhase === "entered"
                    ? "opacity-100 translate-x-0"
                    : (largeLayout ? "opacity-0 translate-x-8" : "opacity-0 translate-x-1/3")
            )}
            style={{ transitionDuration: `${TRANSITION_DURATION}ms` }}
        >
            <ErrorBoundary>
                {collection.defaultEntityAction === "view" && !isEditMode
                    ? <DetailViewBinding
                        key={String(renderedEntityId)}
                        path={path}
                        collection={collection as AdminCollection<Record<string, unknown>>}
                        entityId={renderedEntityId}
                        parentCollectionSlugs={usedParentCollectionIds}
                        parentEntityIds={usedParentEntityIds}
                        selectedTab={selectedTab}
                        layout="split"
                        onCloseRequest={handleCloseDetail}
                        onEditClick={() => {
                            navigate(buildUrl(`${path}/${renderedEntityId}/edit`));
                        }}
                        onTabChange={(params) => {
                            const newSelectedTab = params.selectedTab;
                            navigate(buildUrl(
                                newSelectedTab
                                    ? `${path}/${renderedEntityId}/${newSelectedTab}`
                                    : `${path}/${renderedEntityId}`
                            ));
                        }}
                    />
                    : <EditViewBinding
                        key={String(renderedEntityId)}
                        path={path}
                        collection={collection as AdminCollection<Record<string, unknown>>}
                        entityId={renderedEntityId}
                        parentCollectionSlugs={usedParentCollectionIds}
                        parentEntityIds={usedParentEntityIds}
                        selectedTab={selectedTab}
                        layout="split"
                        // The ✕, and where "save and close" lands. A plain
                        // navigation: `useNavigationBlocker` above already
                        // stands between it and an unsaved edit, so the ✕ asks
                        // exactly what Escape and the browser's Back ask.
                        onCloseRequest={handleCloseDetail}
                        onValuesModified={setDirty}
                        onSaved={() => {
                            setDirty(false);
                            navigate(buildUrl(`${path}/${renderedEntityId}`), { replace: true });
                        }}
                        navigateBack={() => {
                            navigate(buildUrl(`${path}/${renderedEntityId}`));
                        }}
                        onTabChange={(params) => {
                            const newSelectedTab = params.selectedTab;
                            navigate(buildUrl(
                                newSelectedTab
                                    ? `${path}/${renderedEntityId}/${newSelectedTab}`
                                    : `${path}/${renderedEntityId}`
                            ));
                        }}
                    />
                }
            </ErrorBoundary>
        </div>
    ) : <></>;

    // Closing the list is the full-screen entity route: the same `#full` the
    // entity pane's expand button used, so there is one way to give the record
    // the whole window and one way back out of it.
    const openFullScreen = useCallback(() => {
        if (selectedEntityId === undefined) return;
        const suffix = isEditMode ? "/edit" : "";
        navigate(`${buildUrl(`${path}/${selectedEntityId}${suffix}`)}#full`);
    }, [navigate, buildUrl, path, selectedEntityId, isEditMode]);

    const splitViewController = useMemo(() => ({
        detailOpen: selectedEntityId !== undefined,
        openFullScreen
    }), [selectedEntityId, openFullScreen]);

    return (
        <SplitViewProvider value={splitViewController}>
            <ResizablePanels
                stacked={!largeLayout}
                firstPanel={listPanel}
                secondPanel={detailPanel}
                showSecondPanel={isDetailVisible}
                panelSizePercent={animationPhase === "entering" ? 100 : panelSize}
                onPanelSizeChange={setPanelSize}
                minPanelSizePx={240}
            />

            <UnsavedChangesDialog
                open={blocker?.state === "blocked"}
                handleOk={() => {
                    dirty.current = false;
                    blocker?.proceed?.();
                }}
                handleCancel={() => blocker?.reset?.()}
                body={<>You have unsaved changes in this <b>{collection.singularName ?? collection.name}</b>.</>}/>
        </SplitViewProvider>
    );
}
