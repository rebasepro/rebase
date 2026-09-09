import React from "react";
import type { CollectionCustomViewParams } from "@rebasepro/cms-types";
import type { Property } from "@rebasepro/types";
import { PropertyPreview } from "@rebasepro/cms";
import { cls, Typography } from "@rebasepro/ui";

/**
 * A custom collection view mode, demonstrating the `admin.customViews` hook.
 *
 * It reads its rows from `tableController` rather than fetching, which is what
 * makes the toolbar above it honest: the search box, the filter presets and
 * the record count all drive this view exactly as they drive the table.
 *
 * One tile per row, not per image — a product with five photos is still one
 * record, and a tile per image would leave the count in the toolbar describing
 * a different set of things than the grid below it. The extra frames are a
 * badge instead.
 *
 * The picture itself is drawn by {@link PropertyPreview}, handed the array
 * property's `of` — the same component every built-in view uses for a storage
 * property. That is what mints the signed URL, dedupes it across the tiles
 * sharing a file, and falls back when the object is gone. A custom view that
 * rendered its own `<img src={path}>` would show 434 broken frames: what is
 * stored in `images` is a storage path, not a URL.
 */
/**
 * `28.9` → `US$28.90`. The same formatting the card grid gets from the
 * collection's `display.subtitle`, which lives in the config package and is
 * not on this app's import graph — a gallery tile reading a bare `28.90`
 * beside a card grid reading `US$28.90` looks like two different products.
 */
const PRICE = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
});

export function ProductGalleryView({
    collection,
    tableController,
    onEntityClick,
    highlightedEntities,
    emptyComponent
}: CollectionCustomViewParams) {

    const rows = tableController.data ?? [];

    // The inner property of `images`, which is what carries the storage config.
    const imageProperty = React.useMemo((): Property | undefined => {
        const images = (collection.properties as Record<string, Property | undefined>).images;
        if (!images || images.type !== "array") return undefined;
        const of = (images as { of?: Property | Property[] }).of;
        return of && !Array.isArray(of) ? of : undefined;
    }, [collection.properties]);

    const {
        dataLoading,
        noMoreToLoad,
        paginationEnabled,
        itemCount,
        setItemCount,
        pageSize = 50
    } = tableController;

    // Same contract as the built-in views: the query holds one page and grows
    // by one more each time the end of the grid comes into view. Without this
    // the gallery is the only view in the panel that stops at 50 rows while the
    // toolbar above it counts 200.
    const loadNextPage = React.useCallback(() => {
        if (!paginationEnabled || dataLoading || noMoreToLoad) return;
        if (itemCount !== undefined) setItemCount?.(itemCount + pageSize);
    }, [paginationEnabled, dataLoading, noMoreToLoad, itemCount, pageSize, setItemCount]);

    // The grid scrolls inside this view rather than in the page, so "near the
    // end" is measured against this element, not the window.
    const scroller = React.useRef<HTMLDivElement>(null);
    const maybeLoadMore = React.useCallback(() => {
        const node = scroller.current;
        if (!node) return;
        if (node.scrollHeight - node.scrollTop - node.clientHeight < 600) loadNextPage();
    }, [loadNextPage]);

    // A page that does not fill the container never scrolls, and so would never
    // ask for the next one — a wide window fits more than fifty tiles. Checking
    // again whenever the row count changes keeps loading until it does scroll
    // (or until `noMoreToLoad` stops it).
    React.useEffect(maybeLoadMore, [maybeLoadMore, rows.length]);

    if (!dataLoading && rows.length === 0) {
        return <>{emptyComponent}</>;
    }

    return (
        <div ref={scroller} onScroll={maybeLoadMore} className="h-full overflow-y-auto p-4">
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
                {rows.map((entity) => {
                    const values = entity.values as Record<string, unknown>;
                    const images = Array.isArray(values.images) ? values.images as string[] : [];
                    const cover = images[0];
                    const price = typeof values.price === "number"
                        ? values.price
                        : (typeof values.price === "string" ? Number(values.price) : undefined);
                    const highlighted = highlightedEntities?.some(e => e.id === entity.id);

                    return (
                        <button
                            key={String(entity.id)}
                            onClick={() => onEntityClick?.(entity)}
                            className={cls(
                                "text-left rounded-lg border bg-surface-card overflow-hidden",
                                "transition-colors focus:outline-none focus-visible:border-primary",
                                highlighted ? "border-primary" : "border-hairline hover:border-hairline-strong"
                            )}
                        >
                            {/* A tile inside a card: lifted one step, no line of
                                its own. It is also the frame the picture is
                                cropped to, so it holds the aspect ratio. */}
                            <div className="relative aspect-square bg-surface-raised">
                                {cover && imageProperty
                                    ? <PropertyPreview property={imageProperty}
                                        propertyKey="images"
                                        value={cover}
                                        size="large"
                                        fill={true}/>
                                    : <div className="w-full h-full flex items-center justify-center">
                                        <Typography variant="caption" color="secondary">No image</Typography>
                                    </div>}

                                {images.length > 1 && (
                                    <span className="absolute top-2 right-2 rounded-full bg-surface-900/70 text-white text-xs font-medium px-2 py-0.5 backdrop-blur-sm">
                                        +{images.length - 1}
                                    </span>
                                )}
                            </div>

                            <div className="p-3">
                                <Typography variant="body2" className="font-medium truncate">
                                    {String(values.name ?? entity.id)}
                                </Typography>
                                {price !== undefined && !Number.isNaN(price) && (
                                    <Typography variant="caption" color="secondary">
                                        {PRICE.format(price)}
                                    </Typography>
                                )}
                            </div>
                        </button>
                    );
                })}
            </div>

            {dataLoading && (
                <div className="py-6 text-center">
                    <Typography variant="caption" color="secondary">Loading…</Typography>
                </div>
            )}
        </div>
    );
}
