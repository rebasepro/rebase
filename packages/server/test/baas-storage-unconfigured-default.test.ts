/**
 * The storage policy store does not take away a development project's default.
 *
 * Every SQL backend now builds `rebase.storage_policies` and routes storage
 * through it. The store denies everyone but admins when no policy matches,
 * which is right once a project has policies — and wrong for one that has
 * never configured storage access at all: in development that project let
 * every signed-in caller through (warning at boot), and with the store in
 * front every upload was refused. `storeBackedStorageAuthorize` keeps the old
 * answer until the first policy exists, and only where it was the answer.
 */
import { describe, expect, it } from "@jest/globals";
import type { StorageAuthorizeContext } from "@rebasepro/types";
import { storeBackedStorageAuthorize } from "../src/baas/storage-policies-store";

const member: StorageAuthorizeContext = {
    operation: "write",
    key: "misc/report.pdf",
    bucket: "default",
    user: { uid: "u1", roles: ["member"] }
};

/** A store that denies what no policy allows, holding `policies` policies. */
function store(policies: number) {
    return {
        hasEnabledPolicies: () => policies > 0,
        authorize: async () => false
    };
}

describe("storeBackedStorageAuthorize", () => {
    it("lets a signed-in caller through while nothing is configured in development", async () => {
        const authorize = storeBackedStorageAuthorize(store(0), { unconfiguredAllows: true });
        await expect(authorize(member)).resolves.toBe(true);
    });

    it("hands over to the store's deny-by-default once a policy exists", async () => {
        const authorize = storeBackedStorageAuthorize(store(1), { unconfiguredAllows: true });
        await expect(authorize(member)).resolves.toBe(false);
    });

    it("never opens up where the default was not the answer — production, or a project with its own rule", async () => {
        const authorize = storeBackedStorageAuthorize(store(0), { unconfiguredAllows: false });
        await expect(authorize(member)).resolves.toBe(false);
    });
});
