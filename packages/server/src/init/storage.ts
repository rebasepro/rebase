import {
    BackendStorageConfig,
    createStorageController,
    DEFAULT_STORAGE_ID,
    DefaultStorageRegistry,
    StorageController,
    StorageRegistry
} from "../storage";
import { resourceEnvSuffix } from "@rebasepro/types";
import { logger } from "../utils/logger";

export async function initializeStorage(
    storageConfig: BackendStorageConfig | StorageController | Record<string, BackendStorageConfig | StorageController> | undefined,
    isProduction: boolean
): Promise<{ storageRegistry?: StorageRegistry; storageController?: StorageController }> {
    if (!storageConfig) return {};

    logger.debug("Configuring storage");
    const controllers: Record<string, StorageController> = {};

    const toController = async (entry: BackendStorageConfig | StorageController, label: string): Promise<StorageController | undefined> => {
        if (typeof (entry as StorageController).putObject === "function") {
            return entry as StorageController;
        }
        const conf = entry as BackendStorageConfig;
        // On a managed platform the local backend is a pod's ephemeral
        // filesystem, so every uploaded file disappears at the next restart —
        // with no error at write time, no error at read time, and a log line
        // nobody reads until the data is already gone.
        //
        // So in production this backend is not registered at all. Storage is
        // off until a bucket is configured: uploads are refused with
        // STORAGE_NOT_CONFIGURED (see the stub router in `init.ts`) instead of
        // succeeding into a filesystem that is about to be wiped. Dropping the
        // backend rather than throwing keeps the rest of the app — data, auth,
        // realtime — serving, which a crash-looping rollout would not.
        if (isProduction && conf.type === "local" && !process.env.FORCE_LOCAL_STORAGE) {
            logger.error(
                `Storage backend "${label}" is set to "local" in production — DISABLED. Local ` +
                "storage is the container filesystem, so uploaded files would be destroyed on the " +
                "next restart or redeploy. File uploads will be refused until storage is " +
                "configured: set S3-compatible storage (STORAGE_TYPE=s3) or GCS " +
                "(STORAGE_TYPE=gcs), or pass a custom StorageController. If this deployment " +
                "really does have a durable volume mounted at the storage path, set " +
                "FORCE_LOCAL_STORAGE=true."
            );
            return undefined;
        }
        if (conf.type === "local" && conf.standsInFor) {
            // Once, at info, naming the variable that ends it. This is a
            // development convenience standing in for a declared object store,
            // and the developer should never discover at deploy time that
            // production has no such fallback.
            logger.info(
                `Storage source "${label}" is declared as ${conf.standsInFor} and nothing binds it — ` +
                `using ${conf.basePath} in development. Production does not do this: set ` +
                `${conf.standsInFor.toUpperCase()}_BUCKET${resourceEnvSuffix(label)} ` +
                "there, or uploads to it answer 501."
            );
        }
        return await createStorageController(conf);
    };

    if (
        typeof storageConfig === "object" &&
        ("type" in storageConfig || typeof (storageConfig as StorageController).putObject === "function")
    ) {
        const controller = await toController(
            storageConfig as BackendStorageConfig | StorageController,
            DEFAULT_STORAGE_ID
        );
        if (controller) controllers[DEFAULT_STORAGE_ID] = controller;
    } else {
        for (const [storageId, entry] of Object.entries(
            storageConfig as Record<string, BackendStorageConfig | StorageController>
        )) {
            const controller = await toController(entry, storageId);
            if (controller) controllers[storageId] = controller;
        }
    }

    if (Object.keys(controllers).length > 0) {
        const storageRegistry = DefaultStorageRegistry.create(controllers);
        logger.info("Initialized storage backends", { count: Object.keys(controllers).length });
        // A missing default is not fatal here, and deliberately so. The one way
        // to reach this state from a declared project is the branch above:
        // production drops a `local` default so the rest of the app keeps
        // serving rather than crash-looping, and the named buckets survive it.
        // Nothing is promoted into the gap — that promotion is what made a
        // project write to local disk in development and into its media bucket
        // in production — so uploads that name no source answer
        // `STORAGE_NOT_CONFIGURED` until the project says which bucket they
        // belong in. `resolveStorageSources` refuses a project that never said.
        if (!storageRegistry.has(DEFAULT_STORAGE_ID)) {
            const named = storageRegistry.list();
            logger.error(
                `No default storage source: this process serves ${named.map(k => `"${k}"`).join(", ")} and ` +
                "none of them receives an upload that names no `storageSource`, so those uploads are " +
                "refused. In `config/resources.ts`, either mark one — " +
                `bucket("${named[0]}", { default: true }) — or declare the default bucket alongside them: ` +
                "export const uploads = bucket();"
            );
            return { storageRegistry };
        }
        return { storageRegistry, storageController: storageRegistry.getDefault() };
    }

    return {};
}

/** Inputs that decide whether storage has an access-control model at all. */
export interface StorageAccessControlState {
    /** A `storageAuthorize` hook was configured (per-object access control). */
    hasAuthorize: boolean;
    /** Reads are deliberately public (`storagePublicRead: true`). */
    publicRead: boolean;
    /** The legacy "any authenticated user may touch any key" behaviour was
     *  explicitly acknowledged (`storageInsecureAllowAnyAuthenticated: true`). */
    allowAnyAuthenticated: boolean;
}

/**
 * The one message the boot guard emits, factored out so the production throw
 * and the development warning say exactly the same thing.
 */
const STORAGE_NO_ACCESS_CONTROL_MESSAGE =
    "Storage is configured WITHOUT any access-control model. Keys share one flat " +
    "namespace and no `storageAuthorize` hook is set, so any authenticated user can " +
    "list every key (GET /storage/list?prefix=) and then read, overwrite or delete " +
    "any other user's files. Fix one of:\n" +
    "  • add a `storageAuthorize` hook that scopes access per user/tenant (recommended), or\n" +
    "  • set `storagePublicRead: true` if this bucket is genuinely a public read-only CDN, or\n" +
    "  • set `storageInsecureAllowAnyAuthenticated: true` to keep the legacy shared-namespace\n" +
    "    behaviour on purpose (single-tenant apps where every signed-in user is trusted).";

/**
 * Refuse to boot storage in production with no access-control model.
 *
 * Storage is not under RLS and its keys share one flat namespace, so with no
 * `storageAuthorize` hook the only thing separating two users' files is key
 * unguessability — which a `GET /list` defeats. This is the storage analogue of
 * the locked-by-default RLS on collections: rather than ship an allow-all
 * default silently, make the deployment state its intent.
 *
 * In production a bare allow-all config is refused (throws, so the rollout
 * fails loudly instead of serving everyone's files to everyone). Outside
 * production it is a loud warning, so local development is not blocked.
 *
 * Any one of the three explicit choices — a hook, public-read, or the insecure
 * opt-out — satisfies the guard.
 */
export function assertStorageAccessControlConfigured(
    state: StorageAccessControlState,
    isProduction: boolean
): void {
    if (state.hasAuthorize || state.publicRead || state.allowAnyAuthenticated) {
        return;
    }
    if (isProduction) {
        throw new Error(STORAGE_NO_ACCESS_CONTROL_MESSAGE);
    }
    logger.warn(STORAGE_NO_ACCESS_CONTROL_MESSAGE);
}
