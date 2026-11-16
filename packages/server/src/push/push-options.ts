import type { PushSender } from "@rebasepro/types";

/**
 * `push` in the backend options: Web Push notifications to browsers.
 *
 * `push: true` is the whole setup in development. The keys come from
 * `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` and
 * `REBASE_VAPID_SUBJECT`, and outside production a pair is generated and
 * kept when they are unset.
 */
export interface PushOptions {
    /** The VAPID keys and contact, in place of the environment variables. */
    vapid?: {
        publicKey?: string;
        privateKey?: string;
        /** A `mailto:` address or an `https://` URL the push services can contact. */
        subject?: string;
    };
    /**
     * Hostnames accepted as push services beyond the browsers' own (FCM,
     * Mozilla, Apple, Windows). Exact, https only; an entry may carry a port,
     * for a test push service on `127.0.0.1:8443`.
     */
    allowedHosts?: string[];
    /** Delivers each message, in place of the built-in sender. */
    sender?: PushSender;
}
