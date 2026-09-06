/**
 * Storage Registry
 *
 * Manages multiple storage controllers for Rebase backend.
 * Allows different storage backends for different use cases.
 *
 * Usage:
 * - Single storage: Pass a single StorageController → maps to "(default)"
 * - Multiple storages: Pass a map of { storageId: StorageController }
 * - String properties use `storageId` in their config to specify which storage to use
 * - Properties without `storageId` fallback to "(default)"
 */

import { DEFAULT_STORAGE_SOURCE_KEY } from "@rebasepro/types";

import { StorageController } from "./types";
import { canonicalStorageId } from "./keys";
import { logger } from "../utils/logger";

/**
 * The default storage identifier used when:
 * - A single storage controller is provided (not a map)
 * - A property doesn't specify a storageId
 *
 * An alias rather than a second `"(default)"` literal: the same string is the
 * registry key here, the source key a project declares in `rebase.json`, and
 * the scope baked into a download token. Two literals that must stay equal are
 * a divergence waiting to happen — and this one would silently unscope tokens.
 */
export const DEFAULT_STORAGE_ID = DEFAULT_STORAGE_SOURCE_KEY;

/**
 * A request named a storage source that is not registered.
 *
 * This used to be a `logger.warn` and a fallback to the default source, which
 * is the wrong answer in a way that is hard to notice: the caller asks for
 * `media`, the `storageAuthorize` hook is asked about `media`, and the bytes
 * are read from — or written to — `(default)`. A hook that widens access for
 * one named source therefore widens it for the default one, and the object the
 * hook approved is not the object the request touched. That is the same shape
 * as the non-canonical-key bypass: the check and the read disagree about which
 * object is in play.
 *
 * The failure is silent by construction. Both sources hold the *same key*,
 * because that is what makes a caller reach for a second source in the first
 * place, so the fallback returns plausible bytes rather than an error.
 *
 * It is also reachable without an attacker: a source declared in `rebase.json`
 * but not configured by the environment is skipped at boot and never
 * registered, while `GET /sources` still advertises it. The client asks for a
 * source it was told exists and silently gets a different bucket's contents.
 *
 * Carries `knownKeys` so the route layer can tell a typo from a source that was
 * declared but never configured — two different answers to the caller. The
 * registry itself does not know what was *declared*, only what was registered,
 * so it does not make that decision.
 */
export class UnknownStorageSourceError extends Error {
    constructor(public readonly storageId: string, public readonly knownKeys: string[]) {
        super(
            `[StorageRegistry] Storage source "${storageId}" is not registered. ` +
            `Registered sources: ${knownKeys.length > 0 ? knownKeys.map((k) => `"${k}"`).join(", ") : "(none)"}.`
        );
        this.name = "UnknownStorageSourceError";
    }
}

/**
 * Registry for managing multiple storage controllers
 */
export interface StorageRegistry {
    /**
     * Register a storage controller with an ID
     * @param id - Unique identifier for this storage (e.g., "media", "backups")
     * @param controller - The StorageController instance
     */
    register(id: string, controller: StorageController): void;

    /**
     * Get the default storage controller (id = "(default)")
     * @throws Error if no default storage is registered
     */
    getDefault(): StorageController;

    /**
     * Get a storage controller by ID
     * @param id - Storage identifier, or undefined/null for default
     * @returns The StorageController, or undefined if not found
     */
    get(id: string | undefined | null): StorageController | undefined;

    /**
     * Get the storage controller the caller named, or the default if they
     * named none.
     *
     * "Or default" means *when no id was given* — not when the given id is
     * unknown. See {@link UnknownStorageSourceError} for why an unknown id is
     * refused rather than quietly redirected.
     *
     * @param id - Storage identifier, or undefined/null/empty for default
     * @throws UnknownStorageSourceError if `id` names no registered source
     * @throws Error if no default storage is registered
     */
    getOrDefault(id: string | undefined | null): StorageController;

    /**
     * Check if a storage with the given ID exists
     */
    has(id: string): boolean;

    /**
     * List all registered storage IDs
     */
    list(): string[];

    /**
     * Get the number of registered storage controllers
     */
    size(): number;
}

/**
 * Default implementation of StorageRegistry
 */
export class DefaultStorageRegistry implements StorageRegistry {
    private controllers = new Map<string, StorageController>();

    /**
     * Create a StorageRegistry from either a single controller or a map
     * @param input - Single StorageController (maps to "(default)") or Record<string, StorageController>
     */
    static create(
        input: StorageController | Record<string, StorageController>
    ): DefaultStorageRegistry {
        const registry = new DefaultStorageRegistry();

        if (isStorageController(input)) {
            // Single controller → register as "(default)"
            registry.register(DEFAULT_STORAGE_ID, input);
        } else {
            // Map of controllers → register each
            for (const [id, controller] of Object.entries(input)) {
                if (isStorageController(controller)) {
                    registry.register(id, controller);
                }
            }
            // Deliberately no promotion. This used to register whichever
            // backend came first under `(default)` with a warning — where a
            // user's uploaded files land, decided by declaration order — and
            // the answer differed either side of a deploy, because the
            // synthesized local default is dropped in production and the
            // promotion was not. A project declaring only `bucket("media")`
            // therefore wrote to local disk in development and to the media
            // bucket in production, with nothing failing in either.
            //
            // The refusal lives at the declaration, in `resolveStorageSources`,
            // where the project's own buckets can be named. Here there may
            // legitimately be no default: in production a `local` default is
            // dropped so the rest of the app keeps serving, and uploads answer
            // `STORAGE_NOT_CONFIGURED` rather than crash-looping the rollout.
        }

        return registry;
    }

    register(id: string, controller: StorageController): void {
        if (this.controllers.has(id)) {
            logger.warn(`[StorageRegistry] Overwriting storage with id "${id}"`);
        }
        this.controllers.set(id, controller);
    }

    getDefault(): StorageController {
        const controller = this.controllers.get(DEFAULT_STORAGE_ID);
        if (!controller) {
            const others = this.list();
            throw new Error(
                "[StorageRegistry] No default storage registered, so an upload that names no " +
                "`storageSource` has nowhere to go." +
                (others.length > 0
                    ? ` This process has ${others.map(k => `"${k}"`).join(", ")}. In \`config/resources.ts\`, ` +
                      `either mark one — bucket("${others[0]}", { default: true }) — or declare the default ` +
                      "bucket alongside them: export const uploads = bucket();"
                    : ` Register one with id "${DEFAULT_STORAGE_ID}" or pass a single StorageController.`)
            );
        }
        return controller;
    }

    get(id: string | undefined | null): StorageController | undefined {
        // Canonicalized on the same rule as `getOrDefault`, so the two cannot
        // disagree about which ids mean "the default source".
        return this.controllers.get(canonicalStorageId(id));
    }

    getOrDefault(id: string | undefined | null): StorageController {
        const key = canonicalStorageId(id);
        if (key === DEFAULT_STORAGE_ID) {
            return this.getDefault();
        }

        const controller = this.controllers.get(key);
        if (controller) {
            return controller;
        }

        throw new UnknownStorageSourceError(key, this.list());
    }

    has(id: string): boolean {
        return this.controllers.has(canonicalStorageId(id));
    }

    list(): string[] {
        return Array.from(this.controllers.keys());
    }

    size(): number {
        return this.controllers.size;
    }
}

/**
 * Type guard to check if an object is a StorageController
 * vs a Record<string, StorageController> (multiple storages)
 */
function isStorageController(obj: unknown): obj is StorageController {
    if (typeof obj !== "object" || obj === null) {
        return false;
    }
    const controller = obj as StorageController;
    // Check for required StorageController properties
    return (
        typeof controller.putObject === "function" &&
        typeof controller.getSignedUrl === "function" &&
        typeof controller.deleteObject === "function" &&
        typeof controller.listObjects === "function" &&
        typeof controller.getType === "function"
    );
}
