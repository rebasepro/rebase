
import type { ViewMode, AdminCollection } from "@rebasepro/cms-types";
import React, { useMemo } from "react";
import { CollectionViewBinding } from "./CollectionViewBinding/CollectionViewBinding";
import { useCollectionRegistryController } from "../hooks/navigation/contexts/CollectionRegistryContext";
import { Typography } from "@rebasepro/ui";
import { useComponentOverride, CollectionScopeProvider } from "@rebasepro/app";

/**
 * Props for the {@link CollectionPanel} component.
 *
 * This is a high-level, consumer-friendly wrapper around {@link CollectionViewBinding}
 * designed for embedding collection views inside custom pages (home pages,
 * dashboards, entity detail views, etc.).
 *
 * At minimum, provide the `path` (collection slug). All other props are optional
 * overrides that take precedence over the collection's default configuration.
 *
 * @group Components
 */
export type CollectionPanelProps = {
    /**
     * The collection slug / path to display (e.g. "tasks", "clients").
     * The collection must be registered in the Rebase context.
     */
    path: string;

    /**
     * Optional title displayed above the collection.
     * Set to `false` to hide the title entirely.
     * Defaults to the collection's `name`.
     */
    title?: string | false;

    /**
     * Force a specific view mode, overriding the collection's default.
     */
    viewMode?: ViewMode;

    /**
     * Override the sort field.
     */
    sort?: [string, "asc" | "desc"];

    /**
     * Maximum number of entities to display.
     */
    limit?: number;

    /**
     * Whether to sync filter/sort state with URL query params.
     * Defaults to `false` (embedded panels shouldn't hijack the URL).
     */
    updateUrl?: boolean;

    /**
     * Override the entity open mode when clicking a entity.
     */
    openEntityMode?: "side_panel" | "full_screen" | "split" | "dialog";

    /**
     * Additional CSS class name for the container.
     */
    className?: string;

    /**
     * Any additional collection-level overrides (e.g. `previewProperties`,
     * `enabledViews`, `entityActions`, `defaultFilter`, etc.).
     */
    collectionOverrides?: Partial<AdminCollection>;
};

/**
 * A high-level, reusable wrapper for embedding a Rebase collection view
 * inside custom pages (dashboards, home pages, entity detail views, etc.).
 *
 * Usage:
 * ```tsx
 * import { CollectionPanel } from "@rebasepro/cms";
 *
 * function MyDashboard() {
 *     return (
 *         <div>
 *             <CollectionPanel path="tasks" title="Pending Tasks" />
 *             <CollectionPanel
 *                 path="clients"
 *                 viewMode="table"
 *                 collectionOverrides={{
 *                     defaultFilter: { status: ["!=", "completed"] }
 *                 }}
 *             />
 *         </div>
 *     );
 * }
 * ```
 *
 * @group Components
 */
function CollectionPanelInner({
    mergedCollection,
    path,
    title,
    updateUrl,
    className
}: CollectionPanelProps & { mergedCollection: AdminCollection }) {
    const ResolvedCollectionView = useComponentOverride("Collection.View", CollectionViewBinding);

    return (
        <div className={className}>
            {title !== false && (
                <Typography
                    variant="subtitle2"
                    className="font-semibold mb-2 text-surface-700 dark:text-surface-300"
                >
                    {title ?? mergedCollection.name}
                </Typography>
            )}
            <ResolvedCollectionView
                {...mergedCollection}
                path={path}
                updateUrl={updateUrl}
            />
        </div>
    );
}

export function CollectionPanel(props: CollectionPanelProps) {
    const {
        path,
        viewMode,
        sort,
        limit,
        openEntityMode,
        className,
        collectionOverrides
    } = props;
    const collectionRegistry = useCollectionRegistryController();
    const registeredCollection = collectionRegistry.getCollection(path);

    const mergedCollection = useMemo(() => {
        if (!registeredCollection) return undefined;

        // Build overrides object from shorthand props + explicit overrides
        const propOverrides: Record<string, unknown> = {};
        if (viewMode) propOverrides.defaultViewMode = viewMode;
        if (sort) propOverrides.sort = sort;
        if (limit) propOverrides.pagination = limit;
        if (openEntityMode) propOverrides.openEntityMode = openEntityMode;

        return {
            ...registeredCollection,
            ...(collectionOverrides ?? {}),
            ...propOverrides
        } as AdminCollection;
    }, [registeredCollection, collectionOverrides, viewMode, sort, limit, openEntityMode]);

    if (!mergedCollection) {
        return (
            <div className={className}>
                <Typography variant="body2" color="secondary">
                    Collection &quot;{path}&quot; not found.
                </Typography>
            </div>
        );
    }

    const content = (
        <CollectionPanelInner
            {...props}
            mergedCollection={mergedCollection}
        />
    );

    return (
        <CollectionScopeProvider collection={mergedCollection}>
            {content}
        </CollectionScopeProvider>
    );
}
