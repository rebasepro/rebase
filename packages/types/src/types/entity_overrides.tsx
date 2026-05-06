import type { DataDriver } from "../controllers/data_driver";
import type { StorageSource } from "../controllers/storage";

export type EntityOverrides = {
    /**
     * Internal driver override for this collection.
     * Used by the CMS engine to route data operations.
     */
    driver?: DataDriver;
    storageSource?: StorageSource;
};
