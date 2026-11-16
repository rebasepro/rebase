import type {
    PushPayloadInput,
    PushSender,
    PushSendOptions,
    PushSendResult,
    PushService,
    PushSubscriptionInfo
} from "@rebasepro/types";
import { logger } from "../utils/logger";
import type { PushStore, StoredPushSubscription } from "./push-store";
import { isValidTopic } from "./subscription-input";
import { MAX_PAYLOAD_BYTES } from "./web-push-crypto";

/** A day: long enough for a phone that was off overnight. */
const DEFAULT_TTL_SECONDS = 86_400;
/** Push services hold a message for four weeks at most. */
const MAX_TTL_SECONDS = 2_419_200;
const URGENCIES = new Set(["very-low", "low", "normal", "high"]);
/** Sends in flight at once, so a send to thousands of browsers does not open thousands of sockets. */
const CONCURRENCY = 16;

type ResolvedOptions = { ttl: number; urgency: NonNullable<PushSendOptions["urgency"]>; topic?: string; tag?: string };

function resolveOptions(options: PushSendOptions = {}): ResolvedOptions {
    const ttl = options.ttl ?? DEFAULT_TTL_SECONDS;
    if (!Number.isInteger(ttl) || ttl < 0 || ttl > MAX_TTL_SECONDS) {
        throw new Error(`push: ttl must be a whole number of seconds from 0 to ${MAX_TTL_SECONDS}; got ${String(options.ttl)}.`);
    }
    const urgency = options.urgency ?? "normal";
    if (!URGENCIES.has(urgency)) {
        throw new Error(`push: urgency must be "very-low", "low", "normal" or "high"; got ${JSON.stringify(urgency)}.`);
    }
    if (options.topic !== undefined && !isValidTopic(options.topic)) {
        throw new Error(`push: topic must be 1 to 32 characters of A-Z, a-z, 0-9, "-" and "_"; got ${JSON.stringify(options.topic)}.`);
    }
    return { ttl, urgency, topic: options.topic, tag: options.tag };
}

/** Run `work` over `items`, at most `limit` at a time. */
async function eachLimited<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
    let next = 0;
    const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) await work(items[next++]);
    });
    await Promise.all(lanes);
}

export interface PushServiceDeps {
    store: PushStore;
    sender: PushSender;
    publicKey: string;
}

export function createPushService({ store, sender, publicKey }: PushServiceDeps): PushService {
    const deliver = async (subscriptions: StoredPushSubscription[], input: PushPayloadInput, options?: PushSendOptions): Promise<PushSendResult> => {
        const how = resolveOptions(options);
        // Every payload is written, and measured, before the first one is sent:
        // a payload too big for Web Push is the caller's mistake, and it must
        // not surface after half the browsers already got the message.
        const messages = subscriptions.map(subscription => {
            const payload = typeof input === "function" ? input(subscription.info) : input;
            const text = JSON.stringify(how.tag === undefined ? payload : { ...payload, tag: how.tag });
            const bytes = Buffer.byteLength(text, "utf8");
            if (bytes > MAX_PAYLOAD_BYTES) {
                throw new Error(`push: the payload is ${bytes} bytes as JSON; Web Push carries at most ${MAX_PAYLOAD_BYTES}.`);
            }
            return { subscription, text };
        });

        const result: PushSendResult = { sent: 0, removed: 0, failed: 0 };
        const delivered: string[] = [];
        await eachLimited(messages, CONCURRENCY, async ({ subscription, text }) => {
            const { info } = subscription;
            try {
                const answer = await sender.send(subscription, text, { ttl: how.ttl, urgency: how.urgency, topic: how.topic });
                if (answer.statusCode >= 200 && answer.statusCode < 300) {
                    result.sent++;
                    delivered.push(info.id);
                } else if (answer.statusCode === 404 || answer.statusCode === 410) {
                    // The browser unsubscribed, or its push service expired the
                    // subscription. It will never accept another message.
                    result.removed++;
                    await store.removeGone(info.id, subscription.p256dh);
                    logger.debug("[push] a subscription is gone; removed", { id: info.id, status: answer.statusCode, host: info.endpointHost });
                } else {
                    result.failed++;
                    logger.warn("[push] the push service refused a message", {
                        id: info.id, host: info.endpointHost, status: answer.statusCode, body: answer.body
                    });
                }
            } catch (error) {
                result.failed++;
                logger.warn("[push] could not reach the push service", { id: info.id, host: info.endpointHost, error });
            }
        });
        if (delivered.length > 0) {
            await store.markSent(delivered).catch((error: unknown) => logger.debug("[push] could not record last_sent_at", { error }));
        }
        return result;
    };

    return {
        isConfigured: () => true,
        publicKey: () => publicKey,
        async sendToUser(userId, payload, options) {
            return deliver(await store.listForUser(userId), payload, options);
        },
        async sendToSubscriptions(ids, payload, options) {
            return deliver(await store.listByIds(ids), payload, options);
        },
        async subscriptionsOf(userId): Promise<PushSubscriptionInfo[]> {
            return (await store.listForUser(userId)).map(s => s.info);
        }
    };
}

/**
 * `rebase.push` on a backend where push cannot send: off, or without keys.
 * Every call that would send throws `reason`, which names what to set.
 */
export function createUnconfiguredPushService(reason: string): PushService {
    const refuse = (): never => {
        throw new Error(reason);
    };
    return {
        isConfigured: () => false,
        publicKey: () => null,
        sendToUser: async () => refuse(),
        sendToSubscriptions: async () => refuse(),
        subscriptionsOf: async () => refuse()
    };
}
