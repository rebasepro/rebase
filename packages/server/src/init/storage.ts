import {
    BackendStorageConfig,
    createStorageController,
    DEFAULT_STORAGE_ID,
    DefaultStorageRegistry,
    StorageController,
    StorageRegistry
} from "../storage";
import { logger } from "../utils/logger";

export async function initializeStorage(
    storageConfig: BackendStorageConfig | StorageController | Record<string, BackendStorageConfig | StorageController> | undefined,
    isProduction: boolean
): Promise<{ storageRegistry?: StorageRegistry; storageController?: StorageController }> {
    if (!storageConfig) return {};

    logger.info("Configuring storage");
    const controllers: Record<string, StorageController> = {};

    const toController = async (entry: BackendStorageConfig | StorageController, label: string): Promise<StorageController> => {
        if (typeof (entry as StorageController).putObject === "function") {
            return entry as StorageController;
        }
        const conf = entry as BackendStorageConfig;
        // A warning was not enough. On a managed platform the local backend is a
        // pod's ephemeral filesystem, so every uploaded file disappears at the
        // next restart — with no error at write time, no error at read time, and
        // a log line nobody reads until the data is already gone. Refusing to
        // boot trades that for a failure the deploy actually surfaces: a crashed
        // rollout is recoverable, deleted user files are not.
        if (isProduction && conf.type === "local" && !process.env.FORCE_LOCAL_STORAGE) {
            throw new Error(
                `Storage backend "${label}" is set to "local" in production. Local storage is the ` +
                "container filesystem, so uploaded files are destroyed on the next restart or " +
                "redeploy. Configure S3-compatible storage (STORAGE_TYPE=s3) or GCS " +
                "(STORAGE_TYPE=gcs), or pass a custom StorageController. If this deployment " +
                "really does have a durable volume mounted at the storage path, set " +
                "FORCE_LOCAL_STORAGE=true to proceed."
            );
        }
        return await createStorageController(conf);
    };

    if (
        typeof storageConfig === "object" &&
        ("type" in storageConfig || typeof (storageConfig as StorageController).putObject === "function")
    ) {
        controllers[DEFAULT_STORAGE_ID] = await toController(
            storageConfig as BackendStorageConfig | StorageController,
            DEFAULT_STORAGE_ID
        );
    } else {
        for (const [storageId, entry] of Object.entries(
            storageConfig as Record<string, BackendStorageConfig | StorageController>
        )) {
            controllers[storageId] = await toController(entry, storageId);
        }
    }

    if (Object.keys(controllers).length > 0) {
        const storageRegistry = DefaultStorageRegistry.create(controllers);
        const storageController = storageRegistry.getDefault();
        logger.info("Initialized storage backends", { count: Object.keys(controllers).length });
        return { storageRegistry, storageController };
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
