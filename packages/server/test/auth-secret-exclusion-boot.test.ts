import { describe, expect, it, beforeEach, afterEach, jest } from "@jest/globals";
import { Hono } from "hono";
import { createServer } from "node:http";
import type { BackendBootstrapper, CompiledTable, DataDriver, InitializedDriver, TableDescriptor } from "@rebasepro/types";
import type { LegacyCollectionConfig, LegacyStringProperty } from "@rebasepro/common/migrate";
import type { HonoEnv } from "../src/api/types";
import { fakeDataDriver } from "./helpers/server-a-fakes";

import { initializeRebaseBackend } from "../src/init";
import { tablesFrom } from "./helpers/tables";

/**
 * WHEN the exclusion is applied, not just whether.
 *
 * The server-side exclusion this replaced had its own unit tests and they passed:
 * the function was correct. It was called too late. Boot builds each driver's
 * registry inside `initializeDriver`, and a registry copies every property it
 * is handed (`{ ...property }`), so a flag set afterwards reached the config
 * object and none of the copies that actually serve requests. The write path
 * validates against the server's own registry, registered later still, so it
 * refused a `password_hash` write exactly as documented — while every read of
 * the users collection returned the scrypt hash to whoever the select policy
 * admitted. Two paths, one flag, opposite answers, and every unit test green.
 *
 * The driver now reads the auth table's secrets off the descriptor it is
 * handed (`private`, set by the compiler), so this asserts on the tables the
 * driver is HANDED.
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
 * Records the descriptors of the tables handed to `initializeDriver` — as a
 * SNAPSHOT, not by reference: a flag that arrives late on the live objects is
 * exactly the illusion that let the leak ship.
 */
function capturingBootstrapper(seen: TableDescriptor[][]): BackendBootstrapper {
    return {
        type: "fake",
        isDefault: true,
        async initializeDriver({ tables }: { tables?: readonly CompiledTable[] }): Promise<InitializedDriver> {
            seen.push((tables ?? []).map(table => structuredClone(table.descriptor)));
            return {
                driver: stubDriver(),
                tables: undefined,
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

    it("hands the driver the secrets as private columns", async () => {
        jest.spyOn(console, "warn").mockImplementation(() => {});
        const seen: TableDescriptor[][] = [];

        await initializeRebaseBackend({
            app: new Hono<HonoEnv>(),
            server: createServer(),
            ...tablesFrom([redeclaredUsersCollection()]),
            bootstrappers: [capturingBootstrapper(seen)]
        });

        expect(seen).toHaveLength(1);
        const users = seen[0].find(table => table.slug === "users");
        const privacy = (key: string) => users?.columns.find(column => column.key === key)?.private;
        expect(privacy("password_hash")).toBe(true);
        expect(privacy("email_verification_token")).toBe(true);
        // The column the flag is not about, so a blanket exclusion would pass
        // the two assertions above and fail this one.
        expect(privacy("email")).toBeUndefined();
    });

    it("still says so, once, in the logs", async () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

        await initializeRebaseBackend({
            app: new Hono<HonoEnv>(),
            server: createServer(),
            ...tablesFrom([redeclaredUsersCollection()]),
            bootstrappers: [capturingBootstrapper([])]
        });

        // The developer is told to declare the flag themselves — once.
        const warnings = warn.mock.calls
            .map(call => call.join(" "))
            .filter(line => line.includes("without marking it private"));
        expect(warnings).toHaveLength(1);
    });
});
