/**
 * The browser's side of push, normally under `/api/push`:
 *
 *   GET    /key            the VAPID public key a browser subscribes with -> { key }
 *   POST   /subscriptions  { subscription, lang? }  this browser takes notifications, for the caller -> { id }
 *   DELETE /subscriptions  { endpoint }             it does not any more -> { removed }
 *
 * Every route needs a signed-in person. An API key or the service key is
 * refused: a subscription is a browser belonging to an account, and a script
 * has neither.
 */
import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { PushService } from "@rebasepro/types";
import { ApiError, errorHandler } from "../api/errors";
import type { HonoEnv } from "../api/types";
import type { PushStore } from "./push-store";
import { acceptAuthSecret, acceptEndpoint, acceptLang, acceptP256dh, subscriptionIdOf } from "./subscription-input";

export interface PushRouteOptions {
    /** `rebase.push`. When it is not configured, every route answers 503 `PUSH_NOT_CONFIGURED` with its reason. */
    service: PushService;
    /** Undefined when push is not configured. */
    store?: PushStore;
    /** Why push is not configured, for the 503. */
    unconfiguredReason?: string;
    /** Authenticates the request and sets `user`. */
    auth: MiddlewareHandler<HonoEnv>;
    /** Runs after auth, e.g. the data plane's rate limiter. */
    after?: MiddlewareHandler<HonoEnv>[];
    /** Hosts taken as push services beyond the known ones. */
    allowedHosts?: readonly string[];
}

function callerUid(c: Context<HonoEnv>): string {
    if (c.get("apiKey")) {
        throw ApiError.forbidden("Push subscriptions belong to a signed-in person, not an API key.", "PUSH_NEEDS_A_USER");
    }
    const user = c.get("user");
    const uid = user && typeof user === "object" && "uid" in user && typeof user.uid === "string" ? user.uid : undefined;
    if (!uid) throw ApiError.unauthenticated("Authentication required");
    if (uid === "service") {
        throw ApiError.forbidden("Push subscriptions belong to a signed-in person, not the service key.", "PUSH_NEEDS_A_USER");
    }
    return uid;
}

async function readObject(c: Context<HonoEnv>): Promise<Record<string, unknown>> {
    let body: unknown;
    try {
        body = await c.req.json();
    } catch {
        throw ApiError.badRequest("Request body must be JSON", "INVALID_INPUT");
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw ApiError.badRequest("Request body must be a JSON object", "INVALID_INPUT");
    }
    return Object.fromEntries(Object.entries(body));
}

function field(value: unknown, key: string): unknown {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? Reflect.get(value, key) : undefined;
}

export function createPushRoutes(options: PushRouteOptions): Hono<HonoEnv> {
    const { service, store, auth, allowedHosts = [] } = options;
    const router = new Hono<HonoEnv>();
    router.onError(errorHandler);
    router.use("/*", auth);
    for (const middleware of options.after ?? []) router.use("/*", middleware);

    const configuredStore = (): PushStore => {
        if (!store || !service.isConfigured()) {
            throw ApiError.serviceUnavailable(options.unconfiguredReason ?? "Push notifications are not configured on this server.", "PUSH_NOT_CONFIGURED");
        }
        return store;
    };

    router.get("/key", (c) => {
        callerUid(c);
        configuredStore();
        c.header("Cache-Control", "no-store");
        return c.json({ key: service.publicKey() });
    });

    router.post("/subscriptions", async (c) => {
        const userId = callerUid(c);
        const target = configuredStore();
        const body = await readObject(c);
        const subscription = body.subscription;
        const endpoint = acceptEndpoint(field(subscription, "endpoint"), allowedHosts);
        if (!endpoint) {
            throw ApiError.badRequest("subscription.endpoint is not on a known push service.", "PUSH_ENDPOINT_REFUSED");
        }
        const keys = field(subscription, "keys");
        const p256dh = acceptP256dh(field(keys, "p256dh"));
        const authSecret = acceptAuthSecret(field(keys, "auth"));
        if (!p256dh || !authSecret) {
            throw ApiError.badRequest("subscription.keys must carry the browser's p256dh and auth, as PushSubscription.toJSON() gives them.", "INVALID_INPUT");
        }
        const id = subscriptionIdOf(endpoint);
        await target.upsert({
            id,
            userId,
            endpoint,
            p256dh,
            auth: authSecret,
            lang: acceptLang(body.lang),
            userAgent: c.req.header("user-agent")?.slice(0, 300) ?? null
        });
        return c.json({ id });
    });

    router.delete("/subscriptions", async (c) => {
        const userId = callerUid(c);
        const target = configuredStore();
        const body = await readObject(c);
        const endpoint = acceptEndpoint(body.endpoint, allowedHosts);
        // An endpoint no subscription could have is not an error: there is
        // nothing of the caller's to remove, which is the state they asked for.
        const removed = endpoint ? await target.removeOwn(subscriptionIdOf(endpoint), userId) : false;
        return c.json({ removed });
    });

    return router;
}
