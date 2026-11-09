import type { RealtimeProvider } from "@rebasepro/types";

/**
 * A realtime provider with nobody listening: every method a no-op.
 *
 * For a fake bootstrapper that has to hand the backend *a* provider — so the
 * realtime surface is wired — while the test never subscribes to anything.
 */
export function inertRealtimeProvider(): RealtimeProvider {
    return {
        subscribeToCollection: () => undefined,
        subscribeToOne: () => undefined,
        unsubscribe: () => undefined,
        notifyUpdate: async () => undefined
    };
}
