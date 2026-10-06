import { lazyChunk } from "@rebasepro/ui";

/**
 * The collection table, the record views and the side panel, loaded on demand.
 *
 * Together they are the heaviest part of the admin — the table, the entity
 * form with every field binding, the side panel, import/export — and neither
 * the login screen nor the home page shows any of them. The shell used to
 * import them statically (from `RebaseRoute` and the side-panel builder), so
 * all of it was modulepreloaded before the login form could paint.
 *
 * `prefetchRecordViews` starts the downloads once someone is signed in, when
 * the browser is idle, so the first collection they open does not wait on the
 * network. Guarded by test/shell-static-graph.test.ts.
 */
const loadCollectionView = () => import("./CollectionViewBinding/CollectionViewBinding");
const loadEditView = () => import("./EditViewBinding");
const loadDetailView = () => import("./DetailViewBinding");
const loadSidePanel = () => import("./SidePanelBinding");

export const LazyCollectionViewBinding = lazyChunk(() => loadCollectionView().then(m => ({ default: m.CollectionViewBinding })));
export const LazyEditViewBinding = lazyChunk(() => loadEditView().then(m => ({ default: m.EditViewBinding })));
export const LazyDetailViewBinding = lazyChunk(() => loadDetailView().then(m => ({ default: m.DetailViewBinding })));
export const LazySidePanelBinding = lazyChunk(() => loadSidePanel().then(m => ({ default: m.SidePanelBinding })));

/**
 * Fetch the chunks above in the background. A failure here is ignored: the
 * lazy component retries (and reports) the load when it is actually rendered.
 * Returns a cancel function for the effect that schedules it.
 */
export function prefetchRecordViews(): () => void {
    if (typeof window === "undefined") return () => undefined;
    const run = () => {
        for (const load of [loadCollectionView, loadEditView, loadDetailView, loadSidePanel]) {
            load().catch(() => undefined);
        }
    };
    if (typeof window.requestIdleCallback === "function") {
        const handle = window.requestIdleCallback(run, { timeout: 4000 });
        return () => window.cancelIdleCallback(handle);
    }
    const handle = window.setTimeout(run, 1500);
    return () => window.clearTimeout(handle);
}
