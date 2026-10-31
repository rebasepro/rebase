/**
 * What the realtime side of this process is carrying.
 *
 * `/metrics` is per process, so these answer per instance: how many sockets and
 * channels it holds, and how many frames it sent to the other instances on the
 * channel bus or held back because none of them had members. Those two together
 * say whether a group of clients stays on one instance: frames skipped rise
 * while frames published stay flat.
 *
 * Counts only. A channel name is customer data, and a label per channel is
 * unbounded.
 *
 * @module
 */
import type { RealtimeProvider } from "@rebasepro/types";
import type { MetricsRegistry } from "./index.js";

export const REALTIME_SOCKETS_METRIC = "rebase_realtime_sockets";
export const REALTIME_CHANNELS_METRIC = "rebase_realtime_channels";
export const REALTIME_BUS_PUBLISHED_METRIC = "rebase_realtime_bus_frames_published_total";
export const REALTIME_BUS_SKIPPED_METRIC = "rebase_realtime_bus_frames_skipped_total";

/**
 * Report `provider`'s counts in `registry` at each render. A deployment with no
 * realtime, or a provider that keeps no counts, emits none of these series.
 */
export function recordRealtimeCounts(registry: MetricsRegistry, provider: Pick<RealtimeProvider, "counts"> | undefined): void {
    if (!provider?.counts) return;
    registry.onRender(() => {
        const counts = provider.counts?.();
        if (!counts) return;
        registry.setGauge(REALTIME_SOCKETS_METRIC, counts.sockets);
        registry.setGauge(REALTIME_CHANNELS_METRIC, counts.channels);
        for (const [kind, frames] of Object.entries(counts.busFramesPublished)) {
            registry.setCounter(REALTIME_BUS_PUBLISHED_METRIC, frames, { kind });
        }
        registry.setCounter(REALTIME_BUS_SKIPPED_METRIC, counts.busFramesSkipped);
    });
}
