/**
 * Derived image renditions, kept in the storage source rather than in memory.
 *
 * ## The problem this solves
 *
 * A transform — `?width=400&format=webp` — is a decode, a resize and an encode.
 * The result is held in an in-process LRU, which makes it free for the second
 * request that asks the same instance for the same variant, and free for
 * nothing else. Two consequences follow, and both are the ordinary case rather
 * than an edge one:
 *
 *  - **per-instance.** Two replicas behind a load balancer each compute every
 *    variant, and a third replica added under load starts by recomputing all of
 *    them — at exactly the moment there is least CPU to spare;
 *  - **cold after a deploy.** The cache does not survive a restart, so every
 *    release re-does the entire catalogue's worth of work.
 *
 * Writing the rendition back to the storage source fixes both, because the
 * storage source is the one thing every instance already shares and no deploy
 * touches.
 *
 * ## Why it is opt-in
 *
 * This makes a `GET` write to the operator's bucket. That costs money per
 * object, it puts files somebody did not upload into a place they own, and on a
 * bucket whose credentials are read-only it cannot work at all. None of those
 * is a decision to make on an operator's behalf while they are not looking, so
 * it is off unless asked for — and when a write does fail, the request still
 * succeeds from memory and the failure is reported once rather than per request.
 *
 * ## What is stored, and where
 *
 * One object per (source object, transform, source version), under a reserved
 * prefix in the same bucket as the source. The key is the SHA-256 of the same
 * cache key the in-memory cache uses, so it already carries the source's
 * version: replacing an image changes its key, and the old rendition is
 * abandoned rather than served. Abandoned renditions are not collected — set a
 * lifecycle rule on the prefix, which is why the prefix is a single fixed one.
 *
 * The prefix is refused as a caller-supplied key at the route layer. Without
 * that, a rendition is an object at a path nobody authorized: `storageAuthorize`
 * and the declarative policies both reason about the *source* key, and a
 * rendition sits under a different one.
 */
import { createHash } from "node:crypto";

import type { StorageController } from "./types";
import { logger } from "../utils/logger";

/**
 * Where renditions live inside the source bucket.
 *
 * Fixed rather than configurable: it is the target of a lifecycle rule and of
 * the route-layer refusal below, and both of those are worth being able to
 * write down once, in the documentation, for every deployment.
 */
export const RENDITION_PREFIX = "_rebase/renditions/";

/** True for a key that names the reserved rendition space. */
export function isRenditionKey(key: string): boolean {
    return key.startsWith(RENDITION_PREFIX);
}

export interface RenditionCacheConfig {
    /** Off unless set. See the module comment for why. */
    enabled?: boolean;
}

export interface DurableRendition {
    data: Buffer;
    contentType: string;
}

export interface DurableRenditionCache {
    /** The stored rendition for this cache key, or null. Never throws. */
    get(
        controller: StorageController,
        cacheKey: string,
        bucket: string | undefined
    ): Promise<DurableRendition | null>;
    /** Store a rendition. Never throws: a failed write is a slower cache. */
    put(
        controller: StorageController,
        cacheKey: string,
        bucket: string | undefined,
        rendition: DurableRendition
    ): Promise<void>;
}

/**
 * Extensions for what `transformImage` can emit.
 *
 * The extension is cosmetic — the content type is read back from the object's
 * own metadata — but an unreadable bucket listing is a bucket nobody can reason
 * about, and `…-a3f9.webp` is the difference.
 */
const EXTENSIONS: Record<string, string> = {
    "image/webp": "webp",
    "image/avif": "avif",
    "image/jpeg": "jpg",
    "image/png": "png"
};

/**
 * The object key for a rendition.
 *
 * Hashed rather than derived from the source path: the source key can be up to
 * 1024 characters and the transform options are a JSON object, so a readable
 * composition would exceed key limits on exactly the paths people use — deep
 * per-user prefixes. The source key is kept in the object's metadata, where it
 * is available to anyone auditing the prefix and to nothing on the hot path.
 */
export function renditionKey(cacheKey: string, contentType: string): string {
    const digest = createHash("sha256").update(cacheKey).digest("hex");
    const extension = EXTENSIONS[contentType];
    return `${RENDITION_PREFIX}${digest}${extension ? `.${extension}` : ""}`;
}

/**
 * A rendition's key when reading, where the content type is not yet known.
 *
 * Reads try the known extensions rather than storing an index: four `getObject`
 * calls at worst is still one round trip in the common case — the first
 * candidate is the format the request asked for — and an index is a second
 * thing to keep consistent with the objects it describes.
 */
export function renditionKeyCandidates(cacheKey: string, preferred?: string): string[] {
    const digest = createHash("sha256").update(cacheKey).digest("hex");
    const extensions = Object.values(EXTENSIONS);
    const ordered = preferred && EXTENSIONS[preferred]
        ? [EXTENSIONS[preferred], ...extensions.filter(e => e !== EXTENSIONS[preferred])]
        : extensions;
    return ordered.map(extension => `${RENDITION_PREFIX}${digest}.${extension}`);
}

export function createDurableRenditionCache(): DurableRenditionCache {
    // Said once per process, not per request. A read-only bucket fails every
    // write, and a warning per transform would bury the log it is trying to be
    // noticed in.
    let writeFailureAnnounced = false;

    return {
        async get(controller, cacheKey, bucket) {
            for (const key of renditionKeyCandidates(cacheKey)) {
                try {
                    const object = await controller.getObject(key, bucket);
                    if (!object) continue;
                    return {
                        data: Buffer.from(await object.arrayBuffer()),
                        // The type the rendition was written with. Falling back
                        // to the extension would be guessing at the one fact
                        // the object already carries.
                        contentType: object.type || "application/octet-stream"
                    };
                } catch {
                    // A miss and an unreachable bucket are the same answer here:
                    // compute it. The source read that follows will report a
                    // genuinely broken source for itself.
                    continue;
                }
            }
            return null;
        },

        async put(controller, cacheKey, bucket, rendition) {
            const key = renditionKey(cacheKey, rendition.contentType);
            try {
                await controller.putObject({
                    file: new File([new Uint8Array(rendition.data)], key.split("/").pop()!, {
                        type: rendition.contentType
                    }),
                    key,
                    bucket,
                    metadata: { contentType: rendition.contentType, rebaseRendition: "1" },
                    // Never public. A rendition inherits the source object's
                    // access, and the source is checked on the way in; placing
                    // it under the public prefix would publish a derivative of
                    // a private object at a stable URL.
                    public: false
                });
            } catch (err) {
                if (!writeFailureAnnounced) {
                    writeFailureAnnounced = true;
                    logger.warn(
                        "[storage] Could not write an image rendition to the storage source, so " +
                        "transforms stay in the per-instance memory cache. Check that the bucket " +
                        `credentials permit writes under "${RENDITION_PREFIX}".`,
                        { error: err instanceof Error ? err.message : String(err) }
                    );
                }
            }
        }
    };
}
