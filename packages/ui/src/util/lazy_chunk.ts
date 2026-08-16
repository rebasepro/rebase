import React from "react";

/**
 * Dynamic imports that survive a redeploy.
 *
 * A built SPA names its chunks by content hash and a deploy replaces the whole
 * `assets/` directory, so a tab opened before the deploy still holds the *old*
 * entry chunk. The first lazy route that tab opens asks for a hash that no
 * longer exists on the server, the import rejects, and the view is dead until
 * the user thinks to reload — which nothing on screen tells them to do. The
 * browser's own wording ("Failed to fetch dynamically imported module: …") reads
 * like a build bug, so this is usually reported as one.
 *
 * `loadChunk` retries once — that covers a transient network failure — and then
 * gives up with an error tagged as a chunk load failure, so `ErrorBoundary` can
 * offer a reload instead of printing the browser's message.
 */

/**
 * Marker property set on the error thrown after a failed retry. Read by
 * `isChunkLoadError`, which is what the UI matches on.
 */
const CHUNK_LOAD_ERROR_FLAG = "rebaseChunkLoadError";

/**
 * Each engine words this differently, and the message is the only signal — none
 * of them use a distinguishable error type. The MIME variants matter as much as
 * the fetch ones: a server whose SPA fallback answers a missing `/assets/x.js`
 * with `index.html` returns 200 HTML, and the browser rejects it as a module.
 */
const CHUNK_ERROR_PATTERNS = [
    "failed to fetch dynamically imported module",
    "error loading dynamically imported module",
    "importing a module script failed",
    "failed to load module script",
    "expected a javascript",
    "unable to preload css"
];

/**
 * Does this error mean a chunk could not be loaded — rather than the chunk's
 * own code throwing once it did load?
 *
 * Errors raised anywhere are matched, not just ones `loadChunk` produced: React
 * `lazy()` calls that still import directly, and Vite's own CSS preloads, fail
 * the same way and deserve the same recovery.
 */
export function isChunkLoadError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    if ((error as Record<string, unknown>)[CHUNK_LOAD_ERROR_FLAG] === true) return true;
    const message = (error as { message?: unknown }).message;
    if (typeof message !== "string") return false;
    const lower = message.toLowerCase();
    return CHUNK_ERROR_PATTERNS.some(pattern => lower.includes(pattern));
}

function chunkLoadError(cause: unknown): Error {
    const error = new Error(
        "This app was updated while the tab was open, so part of it could not be loaded. Reload to continue."
    );
    Object.assign(error, { [CHUNK_LOAD_ERROR_FLAG]: true,
cause });
    return error;
}

/**
 * Run a dynamic import, retrying once before declaring the chunk unreachable.
 *
 * Errors that are not chunk load failures — the imported module throwing while
 * it evaluates, say — are re-thrown untouched and never retried: running a
 * module's side effects twice is worse than the original failure.
 */
export async function loadChunk<T>(loader: () => Promise<T>): Promise<T> {
    try {
        return await loader();
    } catch (error) {
        if (!isChunkLoadError(error)) throw error;
        // A blip resolves inside a few hundred ms; a stale hash never will.
        await new Promise(resolve => setTimeout(resolve, 250));
        try {
            return await loader();
        } catch (retryError) {
            throw chunkLoadError(retryError);
        }
    }
}

/**
 * `React.lazy` with the retry above. A drop-in replacement — use it for every
 * lazy route or dialog, since any one of them can be the first chunk a stale
 * tab reaches for.
 *
 * Note that React caches the rejection: once a lazy component has failed, later
 * renders re-throw without calling the loader again. Resetting an error boundary
 * therefore cannot recover it, which is why the boundary offers a reload.
 */
export function lazyChunk<T extends React.ComponentType<any>>(
    loader: () => Promise<{ default: T }>
): React.LazyExoticComponent<T> {
    return React.lazy(() => loadChunk(loader));
}
