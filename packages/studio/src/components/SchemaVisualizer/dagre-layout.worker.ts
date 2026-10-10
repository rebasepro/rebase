/**
 * The schema visualizer's layout, off the main thread.
 *
 * Receives one {@link LayoutInput}, answers with its positions (or the error's
 * message). Bundled with dagre by the `?worker&inline` import in
 * `layout-runner.ts`, so it needs nothing from the page that starts it.
 */
import { runDagre, type LayoutInput, type LayoutPositions } from "./dagre-layout";

export type LayoutWorkerReply = { positions: LayoutPositions } | { error: string };

addEventListener("message", (event: MessageEvent<LayoutInput>) => {
    let reply: LayoutWorkerReply;
    try {
        reply = { positions: runDagre(event.data) };
    } catch (error) {
        reply = { error: error instanceof Error ? error.message : String(error) };
    }
    postMessage(reply);
});
