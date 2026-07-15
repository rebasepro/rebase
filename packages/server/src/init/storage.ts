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
        if (isProduction && conf.type === "local") {
            logger.warn(`Storage backend "${label}" uses local filesystem in production. ` +
                "Files will be lost on container restart. " +
                "Configure S3-compatible storage or a custom StorageController.");
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
