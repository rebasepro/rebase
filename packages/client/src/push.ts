import type { Transport } from "./transport";
import { RebaseClientError } from "@rebasepro/types";

/** Where the subscription is made: a service worker registration. */
export interface PushRegistrationOptions {
    /**
     * The service worker registration to subscribe through. Default: the one
     * controlling this page (`navigator.serviceWorker.getRegistration()`).
     */
    registration?: ServiceWorkerRegistration;
}

export interface PushSubscribeOptions extends PushRegistrationOptions {
    /**
     * The language notifications to this browser should be written in, handed
     * to the server's payload function as `subscription.lang`. Default
     * `navigator.language`.
     */
    lang?: string;
}

/**
 * Web Push from the browser, as `client.push`. Needs `push: true` on the
 * backend, a service worker that shows the notifications, and a signed-in user.
 */
export interface PushClient {
    /** Whether this browser can take push notifications at all (service workers, PushManager, Notification). */
    isSupported(): boolean;
    /**
     * Ask permission when it has not been given, subscribe this browser with the
     * server's VAPID key, and register the subscription for the signed-in user.
     * Call it from a click: Safari only asks for permission inside a user gesture.
     *
     * Resolves with the subscription's id (the server's key for this browser)
     * and the browser's `PushSubscription`. Calling it again is safe; it
     * refreshes the same subscription.
     *
     * Throws `PUSH_UNSUPPORTED`, `PUSH_PERMISSION_DENIED` or `PUSH_NO_SERVICE_WORKER`
     * from the browser side, and the server's `PUSH_NOT_CONFIGURED` when push is
     * off there.
     */
    subscribe(options?: PushSubscribeOptions): Promise<{ id: string; subscription: PushSubscription }>;
    /**
     * Stop notifications to this browser: removed on the server, then
     * unsubscribed in the browser. `false` when it was not subscribed.
     */
    unsubscribe(options?: PushRegistrationOptions): Promise<boolean>;
    /** This browser's current subscription, or `null`. */
    getSubscription(options?: PushRegistrationOptions): Promise<PushSubscription | null>;
}

/** A VAPID key, as base64url, in the form `PushManager.subscribe` takes. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
    const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64url.length / 4) * 4, "=");
    const binary = atob(base64);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function sameKey(current: ArrayBuffer | null | undefined, wanted: Uint8Array): boolean {
    if (!current) return false;
    const bytes = new Uint8Array(current);
    return bytes.length === wanted.length && bytes.every((byte, i) => byte === wanted[i]);
}

function supported(): boolean {
    return typeof navigator !== "undefined" && "serviceWorker" in navigator
        && typeof window !== "undefined" && "PushManager" in window && "Notification" in window;
}

export function createPushClient(transport: Transport, pushPath = "/push"): PushClient {
    const registrationOf = async (options?: PushRegistrationOptions): Promise<ServiceWorkerRegistration> => {
        if (!supported()) {
            throw new RebaseClientError("This browser does not support push notifications.", { code: "PUSH_UNSUPPORTED" });
        }
        const registration = options?.registration ?? await navigator.serviceWorker.getRegistration();
        if (!registration) {
            throw new RebaseClientError(
                "Push needs a service worker: register one first, e.g. navigator.serviceWorker.register(\"/sw.js\").",
                { code: "PUSH_NO_SERVICE_WORKER" }
            );
        }
        return registration;
    };

    return {
        isSupported: supported,

        async getSubscription(options) {
            if (!supported()) return null;
            const registration = options?.registration ?? await navigator.serviceWorker.getRegistration();
            return registration ? registration.pushManager.getSubscription() : null;
        },

        async subscribe(options) {
            const registration = await registrationOf(options);
            const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
            if (permission !== "granted") {
                throw new RebaseClientError("Notifications are blocked for this site.", { code: "PUSH_PERMISSION_DENIED" });
            }
            const { key } = await transport.request<{ key: string }>(`${pushPath}/key`, { method: "GET" });
            const applicationServerKey = keyBytes(key);

            let subscription = await registration.pushManager.getSubscription();
            // A subscription made with another key (the server's keys changed)
            // can never receive this server's messages, and subscribing over it
            // throws: it is replaced.
            if (subscription && !sameKey(subscription.options.applicationServerKey, applicationServerKey)) {
                await subscription.unsubscribe();
                subscription = null;
            }
            subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });

            const lang = options?.lang ?? (typeof navigator !== "undefined" ? navigator.language : undefined);
            const { id } = await transport.request<{ id: string }>(`${pushPath}/subscriptions`, {
                method: "POST",
                body: JSON.stringify({ subscription: subscription.toJSON(), lang })
            });
            return { id, subscription };
        },

        async unsubscribe(options) {
            const subscription = await this.getSubscription(options);
            if (!subscription) return false;
            await transport.request<{ removed: boolean }>(`${pushPath}/subscriptions`, {
                method: "DELETE",
                body: JSON.stringify({ endpoint: subscription.endpoint })
            });
            await subscription.unsubscribe();
            return true;
        }
    };
}
