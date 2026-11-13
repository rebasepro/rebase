/**
 * The bootstrapper's auth step reads the auth table off the registry's
 * descriptors, never off a collection the server hands over.
 *
 * The lowered auth collection carried no `schema` for a public users table,
 * and the step defaulted it to "rebase": change capture was attached to
 * `rebase.users` — a table that does not exist, so the trigger never landed —
 * while auth's own tables (refresh tokens, identities, …) were read from
 * "rebase", where `ensureAuthTablesExist` creates them. The descriptor says
 * "public": capture now goes on the real users table, and auth's own tables
 * stay exactly where an existing project has them (`resolveAuthSchema`).
 */
import { jest } from "@jest/globals";
import { col, defineAuthTable, type InitializedDriver } from "@rebasepro/types";
import { compileSchema } from "@rebasepro/common";
import { buildTableRegistry } from "../src/model/build-registry";
import { unreadDriver } from "./helpers/spg-a-driver";

const ensured: unknown[] = [];
const authSchemas: string[] = [];

jest.mock("../src/auth/ensure-tables", () => ({
    ...jest.requireActual<typeof import("../src/auth/ensure-tables")>("../src/auth/ensure-tables"),
    ensureAuthTablesExist: async (_db: unknown, table: unknown) => { ensured.push(table); }
}));
jest.mock("../src/schema/auth-schema", () => {
    const actual = jest.requireActual<typeof import("../src/schema/auth-schema")>("../src/schema/auth-schema");
    return {
        ...actual,
        createAuthSchema: (schema: string) => { authSchemas.push(schema); return actual.createAuthSchema(schema); }
    };
});

// Imported after the mocks, so the bootstrapper sees them.
const { createPostgresBootstrapper } = jest.requireActual<typeof import("../src/PostgresBootstrapper")>("../src/PostgresBootstrapper");

function bootWith(schema?: string) {
    const users = defineAuthTable("users", {
        ...(schema ? { schema } : {}),
        columns: { id: col.uuid().primaryKey(), email: col.text() },
        rls: "admin-only"
    });
    const registry = buildTableRegistry({ compiledTables: compileSchema([users]) });
    const captured: { schema: string; table: string; identityColumns: string[] }[] = [];
    const db = { execute: async () => ({ rows: [] }) };
    const bootstrapper = createPostgresBootstrapper({ connection: db });
    const driverResult: InitializedDriver = {
        driver: unreadDriver(),
        internals: {
            db,
            registry,
            provisionCdcForTables: async (tables: typeof captured) => { captured.push(...tables); }
        }
    };
    return { bootstrapper, driverResult, captured };
}

describe("the auth step reads the auth table's descriptor", () => {
    beforeEach(() => {
        ensured.length = 0;
        authSchemas.length = 0;
    });

    it("captures changes on the public users table and keeps auth's own tables in rebase", async () => {
        const { bootstrapper, driverResult, captured } = bootWith();
        // No `collection` in the config: the registry names the auth table.
        await bootstrapper.initializeAuth!({}, driverResult);
        expect(captured).toEqual([{ schema: "public", table: "users", identityColumns: ["id"] }]);
        expect(authSchemas).toEqual(["rebase"]);
        expect(ensured).toHaveLength(1);
    });

    it("follows a users table into its own schema", async () => {
        const { bootstrapper, driverResult, captured } = bootWith("tenant_a");
        await bootstrapper.initializeAuth!({}, driverResult);
        expect(captured).toEqual([{ schema: "tenant_a", table: "users", identityColumns: ["id"] }]);
        expect(authSchemas).toEqual(["tenant_a"]);
    });
});
