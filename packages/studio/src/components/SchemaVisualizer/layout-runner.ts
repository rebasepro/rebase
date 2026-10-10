/// <reference types="vite/client" />
import { runDagre, type LayoutInput, type LayoutPositions } from "./dagre-layout";
import type { LayoutWorkerReply } from "./dagre-layout.worker";

/**
 * Whether this environment can start the layout worker.
 *
 * No in tests (jsdom has no `Worker`) and on a server render; there the
 * layout runs where it is asked for, as it always did.
 */
export const canLayOutOffThread = (): boolean =>
    typeof Worker !== "undefined" &&
    typeof Blob !== "undefined" &&
    typeof URL !== "undefined" &&
    typeof URL.createObjectURL === "function";

/**
 * Lay a graph out in a worker of its own, which ends with the layout.
 *
 * The worker is inlined into the bundle (`?worker&inline`) rather than emitted
 * as a file beside it: `@rebasepro/studio` is a library, and a worker file
 * would be found only by an app bundler that rewrites
 * `new URL(…, import.meta.url)` inside dependencies, which Vite's dependency
 * pre-bundling does not. Imported on first use, so a page that never lays a
 * graph out never decodes it.
 *
 * A worker that cannot be started or loaded — a Content-Security-Policy
 * without `blob:` in `worker-src`, say — is not a broken diagram: the layout
 * runs on the main thread instead, as it did before there was a worker.
 */
export async function layOutOffThread(input: LayoutInput): Promise<LayoutPositions> {
    const { default: LayoutWorker } = await import("./dagre-layout.worker?worker&inline");
    let worker: Worker;
    try {
        worker = new LayoutWorker({ name: "rebase-schema-layout" });
    } catch {
        return runDagre(input);
    }
    return new Promise<LayoutPositions>((resolve, reject) => {
        worker.addEventListener("message", (event: MessageEvent<LayoutWorkerReply>) => {
            worker.terminate();
            const reply = event.data;
            if ("positions" in reply) resolve(reply.positions);
            else reject(new Error(reply.error));
        });
        // Only a worker that never ran gets here: the layout's own errors come
        // back as a reply.
        worker.addEventListener("error", (event) => {
            event.preventDefault();
            worker.terminate();
            try {
                resolve(runDagre(input));
            } catch (error) {
                reject(error);
            }
        });
        worker.postMessage(input);
    });
}
