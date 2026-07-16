import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { warnOnAuthCollectionDataCallbacks } from "../src/auth/collection-callback-warning";
import { logger } from "../src/utils/logger";

/**
 * Auth writes bypass the collection save pipeline deliberately: that path owns
 * password hashing and its own transaction, and a `beforeSave` able to rewrite
 * `password_hash` on its way to the database would be a footgun. The auth hooks
 * exist for the same purpose with a contract that fits.
 *
 * What the decision costs is a reasonable expectation quietly not being met —
 * `afterSave` on the users collection fires when the admin creates a user, and
 * not when someone signs up. This warning is the whole mitigation, so its
 * failure mode is silence, and nothing was pinning it.
 */
describe("warnOnAuthCollectionDataCallbacks", () => {
    let warn: jest.SpiedFunction<typeof logger.warn>;

    beforeEach(() => {
        jest.restoreAllMocks();
        warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    });

    it("names the callbacks that will not fire, and the hooks that will", () => {
        warnOnAuthCollectionDataCallbacks({
            slug: "users",
            callbacks: { afterSave: () => undefined }
        });

        expect(warn).toHaveBeenCalledTimes(1);
        const message = warn.mock.calls[0][0] as string;
        expect(message).toContain("users");
        expect(message).toContain("afterSave");
        expect(message).toContain("afterUserCreate");
    });

    it("names every data callback declared, not just the first", () => {
        warnOnAuthCollectionDataCallbacks({
            slug: "users",
            callbacks: {
                beforeSave: () => undefined,
                afterSave: () => undefined,
                afterDelete: () => undefined
            }
        });

        const message = warn.mock.calls[0][0] as string;
        expect(message).toContain("beforeSave/afterSave/afterDelete");
    });

    it("says nothing about callbacks the auth path does run", () => {
        // `afterRead` is a read-path callback and fires normally; warning about
        // it would train people to ignore the warning that matters.
        warnOnAuthCollectionDataCallbacks({
            slug: "users",
            callbacks: { afterRead: ({ row }: { row: unknown }) => row }
        });

        expect(warn).not.toHaveBeenCalled();
    });

    it("says nothing when the collection has no callbacks", () => {
        warnOnAuthCollectionDataCallbacks({ slug: "users" });
        warnOnAuthCollectionDataCallbacks({ slug: "users",
callbacks: {} });
        warnOnAuthCollectionDataCallbacks(undefined);

        expect(warn).not.toHaveBeenCalled();
    });

    it("ignores a non-function under a callback's name", () => {
        warnOnAuthCollectionDataCallbacks({
            slug: "users",
            callbacks: { afterSave: "not a function" }
        });

        expect(warn).not.toHaveBeenCalled();
    });
});
