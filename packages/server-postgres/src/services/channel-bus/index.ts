/**
 * Resolution of the channel bus from config, environment, or a supplied instance.
 *
 * Opt-in, like every other cross-cutting realtime switch here: with nothing
 * configured a deployment gets the memory bus and behaves exactly as it did
 * before this existed. Unlike `REALTIME_CDC=auto`, there is no "try it and see"
 * default — a bus changes where messages go, and quietly turning on a Postgres
 * NOTIFY per broadcast because a direct URL happened to be set is not a
 * decision to make on the user's behalf.
 *
 * Two transports ship, and neither adds a service to a deployment. A third is
 * not a code change here: `realtime.bus` also accepts an already-constructed
 * {@link ChannelBus}, so a transport published as its own package plugs in
 * without this file learning about it. See `@rebasepro/types` →
 * `types/channel_bus.ts` for the contract such a package implements.
 */

import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { isChannelBusInstance, type ChannelBus, type ChannelBusConfig, type ChannelBusSetting } from "@rebasepro/types";
import { logger } from "@rebasepro/server";
import { MemoryChannelBus } from "./ChannelBus";
import { PostgresChannelBus } from "./PostgresChannelBus";

export * from "./ChannelBus";
export {
    PostgresChannelBus,
    CHANNEL_BUS_NOTIFY_CHANNEL,
    PG_NOTIFY_MAX_PAYLOAD_BYTES,
    DEFAULT_BATCH_WINDOW_MS,
    parseChannelBusFrame,
    parseChannelBusPayload
} from "./PostgresChannelBus";

export interface ChannelBusDeps {
    db: NodePgDatabase<Record<string, unknown>>;
    /**
     * Direct (non-pooled) Postgres URL for the LISTEN client. `LISTEN` is
     * session state, so behind PgBouncer in transaction mode this must be the
     * database itself and not the pooler.
     */
    directUrl?: string;
}

/**
 * Merge `REALTIME_CHANNEL_BUS` into the configured bus.
 *
 * The environment wins over a *named* built-in, so the transport can be changed
 * per deployment without a rebuild — the same reason `REALTIME_CDC` is an env
 * var. It does **not** win over a supplied instance: the env var can only name
 * transports this package knows how to construct, so honouring it there would
 * mean silently discarding the object the application handed us.
 */
export function resolveChannelBusSetting(configured?: ChannelBusSetting): ChannelBusSetting {
    const raw = (process.env.REALTIME_CHANNEL_BUS || "").trim().toLowerCase();

    if (isChannelBusInstance(configured)) {
        if (raw && raw !== configured.kind) {
            logger.warn(
                `⚠️ [ChannelBus] REALTIME_CHANNEL_BUS="${raw}" is ignored because realtime.bus was given a ` +
                `"${configured.kind}" transport instance directly. Remove one of the two to make the intent clear.`
            );
        }
        return configured;
    }

    if (!raw) return configured ?? { type: "memory" };

    if (raw !== "memory" && raw !== "postgres") {
        logger.warn(
            `⚠️ [ChannelBus] Unknown REALTIME_CHANNEL_BUS value "${raw}" — expected memory|postgres, or pass a ` +
            "ChannelBus instance as realtime.bus for a transport that ships separately. Falling back to the " +
            "configured bus."
        );
        return configured ?? { type: "memory" };
    }

    // Keep the configured options (an explicit connection string) when the env
    // var only restates the type it was already set to.
    if (configured?.type === raw) return configured;
    return raw === "memory" ? { type: "memory" } : { type: "postgres" };
}

/**
 * @deprecated Use {@link resolveChannelBusSetting}, which also accepts a
 * supplied {@link ChannelBus} instance. Kept as a narrow alias so existing
 * config-only callers keep their exact types.
 */
export function resolveChannelBusConfig(configured?: ChannelBusConfig): ChannelBusConfig {
    return resolveChannelBusSetting(configured) as ChannelBusConfig;
}

/**
 * Produce the bus a setting asks for.
 *
 * An instance is handed straight back — constructing it was the application's
 * job, and this function has nothing to add. A named built-in that turns out to
 * be unusable degrades to the memory bus, with the reason logged, rather than
 * throwing: a misconfigured bus should cost a deployment its cross-instance
 * fan-out, not its ability to boot.
 */
export function createChannelBus(setting: ChannelBusSetting, deps: ChannelBusDeps): ChannelBus {
    if (isChannelBusInstance(setting)) return setting;

    switch (setting.type) {
        case "postgres": {
            const connectionString = setting.connectionString || deps.directUrl;
            if (!connectionString) {
                logger.warn(
                    "⚠️ [ChannelBus] realtime.bus is \"postgres\" but no direct database URL is available " +
                    "(set DATABASE_DIRECT_URL or realtime.bus.connectionString) — channel broadcast and presence " +
                    "stay per-instance."
                );
                return new MemoryChannelBus();
            }
            return new PostgresChannelBus(deps.db, connectionString, {
                batchWindowMs: setting.batchWindowMs
            });
        }
        case "memory":
        default:
            return new MemoryChannelBus();
    }
}
