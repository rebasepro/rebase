/**
 * Web Push: the server's side of browser notifications.
 *
 * The interfaces live here, beside {@link EmailService}, so the server client
 * type can carry `push` without importing the server. The implementation —
 * VAPID signing, payload encryption, the subscription table — is in
 * `@rebasepro/server`.
 */

/**
 * What a notification carries: any JSON object. The service worker that
 * receives it decides what to show, so the keys are the application's —
 * `{ title, body, url }` is the usual shape and the one the documented
 * service worker reads.
 */
export type PushPayload = Record<string, unknown>;

/** A browser that turned notifications on, as application code sees it. */
export interface PushSubscriptionInfo {
    /** Stable id: a hash of the endpoint. Key your own per-browser rows by it. */
    id: string;
    /** The account the browser was signed in to when it subscribed. */
    userId: string;
    /** The push service's host, which says which browser it is (`fcm.googleapis.com`, `web.push.apple.com`, …). */
    endpointHost: string;
    /** The language the browser asked for notifications in, when it said. */
    lang: string | null;
    createdAt: Date;
    /** When a notification was last accepted by its push service. */
    lastSentAt: Date | null;
}

/** How a notification travels. All optional. */
export interface PushSendOptions {
    /**
     * Seconds the push service keeps trying to deliver it to a browser that is
     * offline. Default 86400 (a day). `0`: deliver now or never.
     */
    ttl?: number;
    /** How hard the push service and the device try to deliver it. Default `"normal"`. */
    urgency?: "very-low" | "low" | "normal" | "high";
    /**
     * A newer message with the same topic replaces one the push service has not
     * delivered yet. At most 32 characters of `A-Z a-z 0-9 - _`.
     */
    topic?: string;
    /**
     * Copied into the payload as `tag`. A service worker that passes it to
     * `showNotification` makes a newer notification replace an older one with
     * the same tag on the device.
     */
    tag?: string;
}

/** What a send did, per subscription. */
export interface PushSendResult {
    /** Subscriptions whose push service accepted the message. */
    sent: number;
    /** Subscriptions the push service said are gone (404, 410). Their rows were deleted. */
    removed: number;
    /** Subscriptions that failed for another reason (rate limit, push service error, network). Kept. */
    failed: number;
}

/**
 * A payload, or a function that writes one per subscription — for a message in
 * each browser's own language: `(s) => words[s.lang ?? "en"] ?? words.en`.
 */
export type PushPayloadInput = PushPayload | ((subscription: PushSubscriptionInfo) => PushPayload);

/** Server-side Web Push, as `rebase.push`. */
export interface PushService {
    /**
     * `true` when push is switched on and has VAPID keys. When `false`, every
     * send throws a message naming what to set.
     */
    isConfigured(): boolean;
    /** The VAPID public key browsers subscribe with, or `null` when push is not configured. */
    publicKey(): string | null;
    /** Send to every browser the user turned notifications on in. */
    sendToUser(userId: string, payload: PushPayloadInput, options?: PushSendOptions): Promise<PushSendResult>;
    /** Send to these subscriptions, by {@link PushSubscriptionInfo.id}. Unknown ids are skipped. */
    sendToSubscriptions(ids: readonly string[], payload: PushPayloadInput, options?: PushSendOptions): Promise<PushSendResult>;
    /** The browsers a user turned notifications on in. */
    subscriptionsOf(userId: string): Promise<PushSubscriptionInfo[]>;
}

/** A subscription as a push sender needs it: where to post, and the browser's keys. */
export interface PushTarget {
    endpoint: string;
    /** The browser's P-256 public key, base64url. */
    p256dh: string;
    /** The browser's auth secret, base64url. */
    auth: string;
}

/** What a push service answered. */
export interface PushDelivery {
    /** The HTTP status. 201 is accepted; 404 and 410 mean the subscription is gone. */
    statusCode: number;
    /** The response body, when the push service sent one, for the log. */
    body?: string;
}

/**
 * Delivers one message to one push service. The default signs with the
 * backend's VAPID keys, encrypts with `aes128gcm` and posts with `fetch`;
 * another implementation (a relay, a test double) goes in `push.sender`.
 *
 * Resolves with the push service's answer, whatever the status. Rejects only
 * when no answer came (network failure).
 */
export interface PushSender {
    send(target: PushTarget, payload: string, options: Required<Pick<PushSendOptions, "ttl" | "urgency">> & Pick<PushSendOptions, "topic">): Promise<PushDelivery>;
}
