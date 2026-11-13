import { describe, expect, it, beforeEach, afterEach, jest } from "@jest/globals";
import { Hono } from "hono";
import { createServer } from "node:http";
import type { BackendBootstrapper, DataDriver, InitializedDriver } from "@rebasepro/types";
import type { LegacyCollectionConfig, LegacyStringProperty } from "@rebasepro/common/migrate";
import type { HonoEnv } from "../src/api/types";
import { fakeDataDriver } from "./helpers/server-a-fakes";

import { initializeRebaseBackend } from "../src/init";
import { tablesFrom } from "./helpers/tables";

/**
 * WHEN the exclusion is applied, not just whether.
 *
 * `enforceAuthSecretExclusion` has its own unit tests and they always passed:
 * the function was correct. It was called too late. Boot builds each driver's
 * registry inside `initializeDriver`, and a registry copies every property it
 * is handed (`{ ...property }`), so a flag set afterwards reached the config
 * object and none of the copies that actually serve requests. The write path
 * validates against the server's own registry, registered later still, so it
 * refused a `password_hash` write exactly as documented — while every read of
 * the users collection returned the scrypt hash to whoever the select policy
 * admitted. Two paths, one flag, opposite answers, and every unit test green.
 *
 * So this asserts on the collections the driver is HANDED, which is the moment
 * the copies are made.
 */

/**
 * A string column carrying only the admin's "hide this" hints. `admin` is
 * declared by `@rebasepro/cms-types`, which the server does not load, so the
 * property is built apart from the collection literal: a collection file that
 * loads that package carries exactly this object.
 */
function hiddenColumn(name: string): LegacyStringProperty {
    const property = {
        name,
        type: "string" as const,
        admin: { hideFromCollection: true, disabled: { hidden: true } }
    };
    return property;
}

/** The shape that leaked: a redeclared users collection with admin hints only. */
function redeclaredUsersCollection(): LegacyCollectionConfig {
    return {
        name: "Usuarios",
        slug: "users",
        table: "users",
        auth: true,
        properties: {
            id: { name: "ID", type: "string", isId: "uuid" },
            email: { name: "Email", type: "string" },
            password_hash: hiddenColumn("Password Hash"),
            email_verification_token: hiddenColumn("Email Verification Token")
        }
    };
}

function stubDriver(): DataDriver {
    return fakeDataDriver({
        fetchCollection: async () => [],
        checkUniqueField: async () => true
    });
}

/**
 * Records the collections handed to `initializeDriver` — as a SNAPSHOT, not by
 * reference. The whole bug is a mutation that arrives late: keeping the live
 * objects would show them carrying the flag a driver never saw, which is
 * exactly the illusion that let this ship. A copy is what a registry takes.
 */
function capturingBootstrapper(seen: LegacyCollectionConfig[][]): BackendBootstrapper {
    return {
        type: "fake",
        isDefault: true,
        async initializeDriver({ collections }: { collections: LegacyCollectionConfig[] }): Promise<InitializedDriver> {
            seen.push(JSON.parse(JSON.stringify(collections)) as LegacyCollectionConfig[]);
            return {
                driver: stubDriver(),
                collections: undefined,
                internals: {}
            };
        }
    };
}

const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
    process.env.NODE_ENV = "development";
});

afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    jest.restoreAllMocks();
});

describe("auth secret exclusion at boot", () => {

    it("excludes the secrets before any driver reads the collections", async () => {
        jest.spyOn(console, "warn").mockImplementation(() => {});
        const seen: LegacyCollectionConfig[][] = [];

        await initializeRebaseBackend({
            app: new Hono<HonoEnv>(),
            server: createServer(),
            ...tablesFrom([redeclaredUsersCollection()]),
            bootstrappers: [capturingBootstrapper(seen)]
        });

        expect(seen).toHaveLength(1);
        const users = seen[0].find(c => c.slug === "users");
        const properties = users?.properties as Record<string, { excludeFromApi?: boolean }>;
        expect(properties.password_hash.excludeFromApi).toBe(true);
        expect(properties.email_verification_token.excludeFromApi).toBe(true);
        // The column the flag is not about, so a blanket exclusion would pass
        // the two assertions above and fail this one.
        expect(properties.email.excludeFromApi).toBeUndefined();
    });

    it("still says so, once, in the logs", async () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

        await initializeRebaseBackend({
            app: new Hono<HonoEnv>(),
            server: createServer(),
            ...tablesFrom([redeclaredUsersCollection()]),
            bootstrappers: [capturingBootstrapper([])]
        });

        // Moving the call earlier must not cost the developer the warning that
        // tells them to declare the flag themselves — nor repeat it, now that
        // the enforcement runs twice: the second pass exists for collections a
        // driver introspected, and finds nothing left to fix in these.
        const warnings = warn.mock.calls
            .map(call => call.join(" "))
            .filter(line => line.includes("without marking it private"));
        expect(warnings).toHaveLength(1);
    });
});
