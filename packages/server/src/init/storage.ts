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
