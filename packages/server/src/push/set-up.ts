import { isSQLAdmin, type DataDriver, type PushService } from "@rebasepro/types";
import { openDevSecretStore, shouldCacheDevSecrets } from "../dev-secrets";
import { logger } from "../utils/logger";
import type { PushOptions } from "./push-options";
import { createPushService, createUnconfiguredPushService } from "./push-service";
import { createPushStore, type PushStore } from "./push-store";
import { resolveVapid, VAPID_PRIVATE_ENV, VAPID_PUBLIC_ENV } from "./vapid-config";
import { createWebPushSender } from "./web-push-sender";

/** What boot gets back: `rebase.push`, and the store the routes write to when push can send. */
export interface PushSetUp {
    /** Whether `push` was switched on at all. Off, no routes are mounted. */
    enabled: boolean;
    service: PushService;
    store?: PushStore;
    /** Why push cannot send, when it cannot. */
    reason?: string;
    allowedHosts: string[];
}

const OFF_REASON = "Push notifications are off on this backend. Set `push: true` in the backend options to turn them on.";

/**
 * Turn `push` in the backend options into `rebase.push`: resolve the keys,
 * create (or, without provisioning, check) the table, and build the service.
 * Never throws: a backend that cannot push still serves everything else, and
 * the reason is logged once and carried by every refusal.
 */
export async function setUpPush(input: {
    push: boolean | PushOptions | undefined;
    driver: DataDriver;
    provision: boolean;
    env?: Record<string, string | undefined>;
}): Promise<PushSetUp> {
    if (!input.push) return { enabled: false, service: createUnconfiguredPushService(OFF_REASON), allowedHosts: [] };
    const options: PushOptions = input.push === true ? {} : input.push;
    const allowedHosts = options.allowedHosts ?? [];
    const env = input.env ?? process.env;
    const isProduction = env.NODE_ENV === "production";
    const unconfigured = (reason: string): PushSetUp => {
        logger.warn(`[push] ${reason}`);
        return { enabled: true, service: createUnconfiguredPushService(reason), reason, allowedHosts };
    };

    const admin = input.driver.admin;
    if (!isSQLAdmin(admin)) {
        return unconfigured("Push needs a SQL database for its subscriptions; this backend's database driver has none.");
    }

    const vapid = resolveVapid({
        vapid: options.vapid,
        env,
        isProduction,
        devStore: shouldCacheDevSecrets(env) ? openDevSecretStore() : undefined
    });
    if (!vapid.ok) return unconfigured(vapid.reason);
    if (vapid.source === "dev") {
        logger.info(
            `[push] No VAPID keys set, so this development server uses generated ones (kept in .rebase-dev-secrets.json). ` +
            `For production set ${VAPID_PUBLIC_ENV} and ${VAPID_PRIVATE_ENV}: \`npx web-push generate-vapid-keys\`.`
        );
    }

    const store = createPushStore((sql, params) => admin.executeSql(sql, params ? { params } : undefined));
    try {
        if (input.provision) await store.ensure();
        else await store.adopt();
    } catch (error) {
        logger.error("[push] could not prepare rebase.push_subscriptions", { error });
        return unconfigured(`Push could not prepare its subscription table: ${error instanceof Error ? error.message : String(error)}`);
    }

    const sender = options.sender ?? createWebPushSender(vapid.keys, vapid.subject);
    return { enabled: true, service: createPushService({ store, sender, publicKey: vapid.keys.publicKey }), store, allowedHosts };
}
