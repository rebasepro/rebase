import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import type { TableHooks } from "@rebasepro/types";
import { warnOnAuthTableDataHooks } from "../src/auth/auth-table-hooks-warning";
import { logger } from "../src/utils/logger";

/**
 * Auth writes bypass the table's save pipeline deliberately: that path owns
 * password hashing and its own transaction, and a `beforeSave` able to rewrite
 * `password_hash` on its way to the database would be a footgun. The auth hooks
 * exist for the same purpose with a contract that fits.
 *
 * What the decision costs is a reasonable expectation quietly not being met —
 * `afterSave` on the users table fires when the admin creates a user, and
 * not when someone signs up. This warning is the whole mitigation, so its
 * failure mode is silence, and nothing else pins it.
 */
const users = (hooks?: TableHooks) => ({ descriptor: { slug: "users" }, ...(hooks ? { hooks } : {}) });

describe("warnOnAuthTableDataHooks", () => {
    let warn: jest.SpiedFunction<typeof logger.warn>;

    beforeEach(() => {
        jest.restoreAllMocks();
        warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    });

    it("names the hooks that will not fire, and the auth hooks that will", () => {
        warnOnAuthTableDataHooks(users({ afterSave: () => undefined }));

        expect(warn).toHaveBeenCalledTimes(1);
        const message = warn.mock.calls[0][0] as string;
        expect(message).toContain("users");
        expect(message).toContain("afterSave");
        expect(message).toContain("afterUserCreate");
    });

    it("names every data hook declared, not just the first", () => {
        warnOnAuthTableDataHooks(users({
            beforeSave: ({ values }) => values,
            afterSave: () => undefined,
            afterDelete: () => undefined
        }));

        const message = warn.mock.calls[0][0] as string;
        expect(message).toContain("beforeSave/afterSave/afterDelete");
    });

    it("says nothing about hooks the auth path does run", () => {
        // `afterRead` is a read-path hook and fires normally; warning about
        // it would train people to ignore the warning that matters.
        warnOnAuthTableDataHooks(users({ afterRead: ({ values }) => values }));

        expect(warn).not.toHaveBeenCalled();
    });

    it("says nothing when the table has no hooks, or there is no auth table", () => {
        warnOnAuthTableDataHooks(users());
        warnOnAuthTableDataHooks(users({}));
        warnOnAuthTableDataHooks(undefined);

        expect(warn).not.toHaveBeenCalled();
    });
});
