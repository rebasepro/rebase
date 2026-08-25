/**
 * Storage triggers: run something when an object lands, or when one goes.
 *
 * Every other write in the product can be reacted to — a row has `beforeSave`
 * and `afterSave`, a schedule has a cron job, an outbound event has a webhook —
 * and an upload had nothing. So the ordinary things an upload implies (thumbnail
 * a photo, index a document, write a row recording what arrived, tell somebody)
 * had to be done by the client after the upload returned, which means they are
 * not done at all when the client goes away between the two calls.
 *
 * ```ts
 * storageTriggers: [
 *     {
 *         path: "uploads/:uid/**",
 *         events: ["finalize"],
 *         handler: async ({ key, params, size }) => {
 *             await jobs.enqueue("index-upload", { key, uid: params.uid, size });
 *         }
 *     }
 * ]
 * ```
 *
 * The pattern language is `storagePolicies`', to the letter — see
 * `path-pattern.ts`, which both compile through.
 *
 * ## What a handler can rely on
 *
 * **`finalize` fires after the object is durably written**, never before, and
 * never for a write that failed. **`delete` fires after the object is gone.**
 * Both carry the key exactly as the storage controller saw it — the canonical
 * one, the same string `storageAuthorize` was asked about.
 *
 * ## What a handler must not rely on
 *
 * **Delivery is best-effort, and a throwing handler does not fail the request.**
 * The object is already stored by the time a `finalize` handler runs; answering
 * the client with an error would say the upload failed when it did not, and
 * clients retry uploads. So a handler that throws is logged and the response is
 * unchanged. If the work must happen, the handler should enqueue a job — that
 * is durable, retried, and observable — rather than being the durable step
 * itself.
 *
 * **Handlers are awaited**, in declaration order, before the response is sent.
 * That is deliberate: firing and forgetting would leave a promise running after
 * the response, which a serverless runtime is free to freeze mid-flight. The
 * cost is that a slow handler is a slow upload, which is the other reason to
 * enqueue rather than to work here.
 *
 * **Renditions and other internal writes do not fire triggers.** Only a write
 * that came through the API does. The image-transform cache writes derived
 * objects straight to the controller, and a trigger firing on those would
 * recurse.
 */
import {
    compileStoragePattern,
    matchStoragePattern,
    StoragePatternError,
    type CompiledStoragePattern
} from "./path-pattern";
import { logger } from "../utils/logger";

/** What happened to the object. */
export type StorageTriggerEvent = "finalize" | "delete";

export interface StorageEventContext {
    /** Which event this is. */
    event: StorageTriggerEvent;
    /** The canonical storage key, as written. */
    key: string;
    /** The bucket, when the request named one. */
    bucket?: string;
    /** The storage source the object lives in. */
    storageId: string;
    /** Size in bytes. Present on `finalize`, absent on `delete`. */
    size?: number;
    /** The uploader's declared content type, when there was one. */
    contentType?: string;
    /** Segments captured by `:name` placeholders in the matched path. */
    params: Record<string, string>;
    /** Who made the request, when it was authenticated. */
    user?: { uid: string; email?: string; roles?: string[] } | null;
    /** When the event was raised, ISO 8601. */
    at: string;
}

export type StorageTriggerHandler = (ctx: StorageEventContext) => void | Promise<void>;

export interface StorageTrigger {
    /**
     * A key pattern, matched segment by segment against the canonical key.
     *
     * - a literal segment matches itself
     * - `*` matches exactly one segment
     * - `:name` matches one segment and captures it
     * - `**` matches the rest of the key, including nothing, and is only
     *   allowed as the final segment
     */
    path: string;
    /** Which events fire it. Defaults to `["finalize"]`. */
    events?: StorageTriggerEvent[];
    /** A name for the logs. Defaults to the pattern. */
    name?: string;
    handler: StorageTriggerHandler;
}

/**
 * A request's principal, in the shape a trigger is documented to receive.
 *
 * Hono's `user` variable is typed `AuthResult`, which admits `true` — some
 * middleware sets a bare boolean to mean "authenticated, with no identity
 * attached". A trigger asking "who did this?" is better told `null` than
 * `true`, and better told `null` than a `{}` with no `uid`.
 */
export function triggerUser(raw: unknown): StorageEventContext["user"] {
    if (!raw || typeof raw !== "object") return null;
    const user = raw as { uid?: unknown; email?: unknown; roles?: unknown };
    if (typeof user.uid !== "string") return null;
    return {
        uid: user.uid,
        ...(typeof user.email === "string" ? { email: user.email } : {}),
        ...(Array.isArray(user.roles) ? { roles: user.roles as string[] } : {})
    };
}

export class StorageTriggerError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "StorageTriggerError";
    }
}

const ALL_EVENTS: StorageTriggerEvent[] = ["finalize", "delete"];

interface CompiledTrigger {
    pattern: CompiledStoragePattern;
    events: Set<StorageTriggerEvent>;
    name: string;
    handler: StorageTriggerHandler;
}

/** Fires the triggers a key and event match. Never throws. */
export type StorageTriggerDispatcher = (ctx: Omit<StorageEventContext, "params">) => Promise<void>;

/**
 * Compile a trigger list into a dispatcher, or throw
 * {@link StorageTriggerError}.
 *
 * Compiled at boot so a malformed pattern fails the start rather than the first
 * upload — and, worse, rather than failing *silently* by matching nothing.
 */
export function compileStorageTriggers(triggers: StorageTrigger[]): StorageTriggerDispatcher {
    if (!Array.isArray(triggers)) {
        throw new StorageTriggerError("`storageTriggers` must be an array.");
    }

    const compiled: CompiledTrigger[] = triggers.map((trigger, index) => {
        const label = `storageTriggers[${index}]`;

        if (typeof trigger?.handler !== "function") {
            throw new StorageTriggerError(
                `${label}: \`handler\` must be a function. A trigger with no handler runs nothing, ` +
                "which is never what was meant."
            );
        }

        if (trigger.events !== undefined) {
            if (!Array.isArray(trigger.events) || trigger.events.length === 0) {
                throw new StorageTriggerError(
                    `${label}: \`events\` is empty, so this trigger never fires. Remove it to take ` +
                    `the default, or name the events.`
                );
            }
            for (const event of trigger.events) {
                if (!ALL_EVENTS.includes(event)) {
                    throw new StorageTriggerError(
                        `${label}: \`events\` names "${event}", which is not a storage event. ` +
                        `Use ${ALL_EVENTS.map(e => `"${e}"`).join(" or ")}.`
                    );
                }
            }
        }

        let pattern: CompiledStoragePattern;
        try {
            pattern = compileStoragePattern(trigger.path, label);
        } catch (err) {
            throw err instanceof StoragePatternError ? new StorageTriggerError(err.message) : err;
        }

        return {
            pattern,
            // `finalize` alone by default: a trigger written without thinking
            // about deletes should not start deleting things when one arrives.
            events: new Set(trigger.events ?? ["finalize"]),
            name: trigger.name ?? trigger.path,
            handler: trigger.handler
        };
    });

    return async (ctx) => {
        for (const trigger of compiled) {
            if (!trigger.events.has(ctx.event)) continue;

            const params = matchStoragePattern(trigger.pattern, ctx.key);
            if (!params) continue;

            try {
                await trigger.handler({ ...ctx, params });
            } catch (err) {
                // Logged, never rethrown. The write already happened; failing
                // the response here would tell a client its upload failed and
                // invite it to repeat a write that succeeded.
                logger.error(
                    `[storage] Trigger "${trigger.name}" threw on ${ctx.event} of "${ctx.key}". ` +
                    "The object is unaffected and the request was not failed.",
                    { error: err instanceof Error ? err.message : String(err) }
                );
            }
        }
    };
}
