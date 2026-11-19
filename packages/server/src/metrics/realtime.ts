/**
 * What the realtime side of this process is carrying.
 *
 * `/metrics` is per process, so these answer per instance: how many sockets and
 * channels it holds, and how many frames it sent to the other instances on the
 * channel bus or held back because none of them had members. Those two together
 * say whether a group of clients stays on one instance: frames skipped rise
 * while frames published stay flat.
 *
 * And what its sockets did: opened, closed by whom (`closed_by`) and with
 * which code, frames and bytes in and pushed out, and frames refused by code
 * (rate limit, channel authorization, a broadcast too large for the bus).
 * Socket closes by `closed_by` are what to read when clients report dropped
 * connections: `network` and `client_watchdog` are the path to the client,
 * `no_pong` and `backlog` this server letting go, `shutdown` a deploy or a
 * scale-in.
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
export const REALTIME_OPENS_METRIC = "rebase_realtime_socket_opens_total";
export const REALTIME_CLOSES_METRIC = "rebase_realtime_socket_closes_total";
export const REALTIME_CLOSE_CODES_METRIC = "rebase_realtime_socket_close_codes_total";
export const REALTIME_FRAMES_IN_METRIC = "rebase_realtime_frames_in_total";
export const REALTIME_BYTES_IN_METRIC = "rebase_realtime_bytes_in_total";
export const REALTIME_FRAMES_OUT_METRIC = "rebase_realtime_frames_out_total";
export const REALTIME_BYTES_OUT_METRIC = "rebase_realtime_bytes_out_total";
export const REALTIME_REFUSED_METRIC = "rebase_realtime_frames_refused_total";

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
        const sockets = counts.socketTotals;
        if (!sockets) return;
        registry.setCounter(REALTIME_OPENS_METRIC, sockets.opened);
        for (const [closedBy, n] of Object.entries(sockets.closedBy)) {
            registry.setCounter(REALTIME_CLOSES_METRIC, n, { closed_by: closedBy });
        }
        for (const [code, n] of Object.entries(sockets.closeCodes)) {
            registry.setCounter(REALTIME_CLOSE_CODES_METRIC, n, { code });
        }
        registry.setCounter(REALTIME_FRAMES_IN_METRIC, sockets.framesIn);
        registry.setCounter(REALTIME_BYTES_IN_METRIC, sockets.bytesIn);
        registry.setCounter(REALTIME_FRAMES_OUT_METRIC, sockets.framesOut);
        registry.setCounter(REALTIME_BYTES_OUT_METRIC, sockets.bytesOut);
        for (const [code, n] of Object.entries(sockets.refused)) {
            registry.setCounter(REALTIME_REFUSED_METRIC, n, { code });
        }
    });
}
