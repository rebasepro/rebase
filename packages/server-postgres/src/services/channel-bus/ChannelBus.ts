/**
 * Runtime pieces of the channel bus that are not the contract itself.
 *
 * The interface, the frame shape and the implementer's contract live in
 * `@rebasepro/types` (`types/channel_bus.ts`), so a transport shipped as its own
 * package — a Redis one, say — depends on the contract and not on this database
 * adapter. They are re-exported here for convenience: code already importing
 * from the adapter should not have to know where the types are declared.
 */

import type { ChannelBusFrame } from "@rebasepro/types";

export type {
    ChannelBus,
    ChannelBusFrame,
    ChannelBusHandler,
    ChannelBusConfig,
    ChannelBusSetting
} from "@rebasepro/types";
export { isChannelBusInstance } from "@rebasepro/types";

/**
 * The default: no cross-instance delivery at all.
 *
 * This is what every deployment ran before the bus existed, and what a
 * single-instance deployment should keep running — `publish` resolves without
 * touching the network, so the broadcast path is the same handful of `ws.send`
 * calls it always was.
 */
export class MemoryChannelBus {
    readonly kind = "memory" as const;
    readonly maxFrameBytes = Infinity;

    async start(): Promise<void> { /* nothing to connect */ }

    async publish(): Promise<void> { /* nowhere to publish to */ }

    async stop(): Promise<void> { /* nothing to release */ }
}

/** Encoded size of a frame, for a transport's size check. */
export function frameByteLength(frame: ChannelBusFrame): number {
    return Buffer.byteLength(JSON.stringify(frame), "utf8");
}
