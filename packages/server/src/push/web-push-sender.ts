import type { PushDelivery, PushSender, PushTarget } from "@rebasepro/types";
import { encryptPayload, vapidAuthorization, type VapidKeys } from "./web-push-crypto";

/** How long one push service gets to answer. */
const SEND_TIMEOUT_MS = 15_000;

/**
 * The default {@link PushSender}: signs with this backend's VAPID keys,
 * encrypts to the browser's key and posts the message with `fetch`.
 *
 * Redirects are not followed. A push service answers a message itself, and
 * following a `Location` would let an allowed host send this server anywhere.
 */
export function createWebPushSender(keys: VapidKeys, subject: string): PushSender {
    return {
        async send(target: PushTarget, payload: string, options): Promise<PushDelivery> {
            const body = encryptPayload(Buffer.from(payload, "utf8"), target.p256dh, target.auth);
            const headers: Record<string, string> = {
                "Content-Type": "application/octet-stream",
                "Content-Encoding": "aes128gcm",
                TTL: String(options.ttl),
                Urgency: options.urgency,
                Authorization: vapidAuthorization(target.endpoint, keys, subject)
            };
            if (options.topic) headers.Topic = options.topic;
            const response = await fetch(target.endpoint, {
                method: "POST",
                headers,
                body: new Uint8Array(body),
                redirect: "manual",
                signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
            });
            const text = await response.text().catch(() => "");
            return { statusCode: response.status, body: text ? text.slice(0, 500) : undefined };
        }
    };
}
