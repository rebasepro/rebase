import { RebaseApiError } from "./transport";

/**
 * True when a read failed because there was neither network nor local data.
 *
 * The code is `OFFLINE`. It was `"offline"`, the one lowercase code in a
 * surface whose every other code is `SCREAMING_SNAKE_CASE` — including the
 * `NETWORK_ERROR` it sits next to — so `e.code === "OFFLINE"`, which is what
 * anyone writes, never matched.
 */
export function isOfflineError(error: unknown): boolean {
    return error instanceof RebaseApiError && error.code === "OFFLINE";
}
