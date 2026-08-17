import React from "react";
import type { CollectionCustomViewParams } from "@rebasepro/admin-types";
import { Typography } from "@rebasepro/ui";

/**
 * A custom collection view mode, demonstrating the `admin.customViews` hook.
 *
 * It reads its rows from `tableController` rather than fetching, which is what
 * makes the toolbar above it honest: the search box, the filter presets and
 * the record count all drive this view exactly as they drive the table.
 */
export function ProductGalleryView({
    tableController,
    onEntityClick,
    emptyComponent
}: CollectionCustomViewParams) {

    const rows = tableController.data ?? [];

    if (!tableController.dataLoading && rows.length === 0) {
        return <>{emptyComponent}</>;
    }

    return (
        <div className="h-full overflow-y-auto p-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {rows.map((entity) => {
                    const values = entity.values as Record<string, unknown>;
                    const images = Array.isArray(values.images) ? values.images as string[] : [];
                    const price = typeof values.price === "number" ? values.price : undefined;
                    return (
                        <button
                            key={String(entity.id)}
                            onClick={() => onEntityClick?.(entity)}
                            className="text-left rounded-lg border border-surface-200 dark:border-surface-800 overflow-hidden hover:border-primary transition-colors"
                        >
                            <div className="aspect-square bg-surface-100 dark:bg-surface-800 flex items-center justify-center">
                                {images.length > 0
                                    ? <Typography variant="caption" color="secondary">{images.length} image(s)</Typography>
                                    : <Typography variant="caption" color="secondary">No image</Typography>}
                            </div>
                            <div className="p-2">
                                <Typography variant="body2" className="font-medium truncate">
                                    {String(values.name ?? entity.id)}
                                </Typography>
                                {price !== undefined && (
                                    <Typography variant="caption" color="secondary">
                                        {price.toFixed(2)}
                                    </Typography>
                                )}
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
