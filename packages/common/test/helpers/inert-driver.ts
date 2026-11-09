import type { DataDriver, SDKCollectionClient } from "@rebasepro/types";
import { buildSdkData } from "../../src/data/buildRebaseData";

const notUsed = async (): Promise<never> => {
    throw new Error("not used by this test");
};

/**
 * A complete driver whose every required method throws, naming itself as
 * unused. A test passes the methods it exercises in `overrides`.
 */
export function inertDriver(overrides: Partial<DataDriver> = {}): DataDriver {
    return {
        fetchCollection: notUsed,
        fetchOne: notUsed,
        save: notUsed,
        delete: notUsed,
        checkUniqueField: notUsed,
        ...overrides
    };
}

/**
 * A real flat client over {@link inertDriver}, with the methods a test
 * exercises put in place of the ones it inherits.
 */
export function sdkClient(overrides: Partial<SDKCollectionClient>): SDKCollectionClient {
    return { ...buildSdkData(inertDriver()).collection("items"), ...overrides };
}
