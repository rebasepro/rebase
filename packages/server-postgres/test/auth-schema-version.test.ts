import type { QueryResult } from "pg";
import {
    AUTH_SCHEMA_VERSION,
    AuthSchemaVersionError,
    assertAuthSchemaCompatible,
    probeAuthSchema,
    readAuthSchemaVersion,
    resolveAuthSchema
} from "../src/auth/schema-version";
import { authUidSqlType, ensureAuthTablesExist } from "../src/auth/ensure-tables";
import { col, defineAuthTable, type AnyColumn, type TableDescriptor } from "@rebasepro/types";
import { compileTables } from "@rebasepro/common";
import type { PgSqlDatabase } from "../src/interfaces";
import { answerStatements, queryResult, spiedDrizzle } from "./helpers/spg-a-db";

/**
 * The stamp exists because dropping `unique_device_session` was a one-way door.
 * A runtime from before that migration boots fine against a migrated database,
 * logs `✅ Auth tables ready`, serves `/health` 200 — and 500s every login and
 * refresh with SQLSTATE 42P10, because its `ON CONFLICT` names a constraint the
 * newer runtime removed. These tests pin the two halves of the guard: refusing
 * that boot, and reporting the drift through health.
 */

/** A db whose `execute` returns queued rows in call order. */
function fakeDb(...responses: QueryResult<Record<string, unknown>>[]): PgSqlDatabase {
    const queue = [...responses];
    return answering(async () => queue.shift() ?? queryResult());
}

/** A db whose every statement is answered by `handler`. */
function answering(handler: () => Promise<QueryResult<Record<string, unknown>>>): PgSqlDatabase {
    const { db, execute } = spiedDrizzle();
    answerStatements(execute, handler);
    return db;
}

const present = (value: boolean) => queryResult([{ present: value }]);
const stamped = (version: string) => queryResult([{ value: version }]);
const allColumns = queryResult([
    { column_name: "session_id" },
    { column_name: "revoked" },
    { column_name: "rotated_at" },
    { column_name: "session_started_at" }
]);
const noRows = queryResult();

/** The descriptor of a `defineAuthTable` keyed by `id`, in `schema` when given. */
function usersTable(id: AnyColumn, schema?: string): TableDescriptor {
    return compileTables([defineAuthTable("users", {
        ...(schema ? { schema } : {}),
        columns: { id, email: col.text() },
        rls: "admin-only"
    })])[0];
}

describe("resolveAuthSchema", () => {
    // Drift between this and the derivation inside `ensureAuthTablesExist` would
    // write the stamp to one schema and read it from another — which reads as
    // "never stamped" forever, silently disabling the guard.
    it("defaults to rebase when there is no auth table", () => {
        expect(resolveAuthSchema()).toBe("rebase");
    });

    it("puts auth tables in rebase when the users table is in public", () => {
        expect(resolveAuthSchema(usersTable(col.uuid().primaryKey(), "public"))).toBe("rebase");
        expect(resolveAuthSchema(usersTable(col.uuid().primaryKey()))).toBe("rebase");
    });

    it("follows the users table into a custom schema", () => {
        expect(resolveAuthSchema(usersTable(col.uuid().primaryKey(), "tenant_a"))).toBe("tenant_a");
    });
});

describe("authUidSqlType", () => {
    // Read from the auth table's key column. It used to be read from `isId` on
    // a property named `id`, so any other key spelling typed every `uid`
    // foreign key TEXT.
    it("is UUID for a uuid key", () => {
        expect(authUidSqlType(usersTable(col.uuid().primaryKey().defaultRandom()))).toBe("UUID");
    });

    it("is INTEGER for the integer family, given or generated", () => {
        expect(authUidSqlType(usersTable(col.integer().primaryKey().identity()))).toBe("INTEGER");
        expect(authUidSqlType(usersTable(col.integer().primaryKey()))).toBe("INTEGER");
        expect(authUidSqlType(usersTable(col.bigserial().primaryKey()))).toBe("INTEGER");
    });

    it("is TEXT for a text key, and with no auth table", () => {
        expect(authUidSqlType(usersTable(col.text().primaryKey()))).toBe("TEXT");
        expect(authUidSqlType(undefined)).toBe("TEXT");
    });
});

describe("readAuthSchemaVersion", () => {
    it("returns null on a database that has never been stamped", async () => {
        // Every database provisioned before this file existed is unstamped, and
        // so is every fresh one. Null must not read as version 0.
        expect(await readAuthSchemaVersion(fakeDb(present(false)), "rebase")).toBeNull();
    });

    it("returns null when the meta table exists but holds no version row", async () => {
        expect(await readAuthSchemaVersion(fakeDb(present(true), noRows), "rebase")).toBeNull();
    });

    it("reads a stamped version", async () => {
        expect(await readAuthSchemaVersion(fakeDb(present(true), stamped("2")), "rebase")).toBe(2);
    });

    it("treats an unparseable stamp as unstamped rather than as version 0", async () => {
        // Refusing to boot over a garbled string would be a worse failure than
        // the drift the guard is meant to catch.
        expect(await readAuthSchemaVersion(fakeDb(present(true), stamped("banana")), "rebase")).toBeNull();
    });
});

describe("assertAuthSchemaCompatible", () => {
    it("refuses to boot when the database was migrated by a newer runtime", async () => {
        const db = fakeDb(present(true), stamped(String(AUTH_SCHEMA_VERSION + 1)));

        await expect(assertAuthSchemaCompatible(db, "rebase")).rejects.toThrow(AuthSchemaVersionError);
    });

    it("names both versions in the error, so the fix is obvious from the crash log", async () => {
        const db = fakeDb(present(true), stamped("7"));

        const error = await assertAuthSchemaCompatible(db, "rebase").catch(e => e);
        expect(error).toBeInstanceOf(AuthSchemaVersionError);
        expect(error.databaseVersion).toBe(7);
        expect(error.runtimeVersion).toBe(AUTH_SCHEMA_VERSION);
        expect(error.message).toContain("7");
        expect(error.message).toContain(String(AUTH_SCHEMA_VERSION));
    });

    it("allows a database at exactly this version", async () => {
        const db = fakeDb(present(true), stamped(String(AUTH_SCHEMA_VERSION)));

        await expect(assertAuthSchemaCompatible(db, "rebase")).resolves.toBeUndefined();
    });

    it("allows an OLDER database — that is the upgrade path, not an error", async () => {
        // The migrations in `ensureAuthTablesExist` are about to bring it
        // forward. Only the reverse direction is unrecoverable.
        const db = fakeDb(present(true), stamped("1"));

        await expect(assertAuthSchemaCompatible(db, "rebase")).resolves.toBeUndefined();
    });

    it("allows an unstamped database", async () => {
        await expect(assertAuthSchemaCompatible(fakeDb(present(false)), "rebase")).resolves.toBeUndefined();
    });
});

describe("ensureAuthTablesExist — where the guard sits", () => {
    /**
     * The whole fix hinges on placement. Everything inside `ensureAuthTablesExist`
     * is wrapped in a catch that logs and continues — deliberately, because every
     * other failure there is better survived than crashed on. If the version
     * guard were inside that catch it would be logged and swallowed, the server
     * would finish booting, and we would be back to a green `/health` in front
     * of a total auth outage. So: it must reject.
     */
    it("rejects rather than logging-and-continuing when the database is newer", async () => {
        const db = fakeDb(present(true), stamped(String(AUTH_SCHEMA_VERSION + 1)));

        await expect(ensureAuthTablesExist(db)).rejects.toThrow(AuthSchemaVersionError);
    });

    it("survives an ordinary migration failure, as it always did", async () => {
        // The guard must not turn every DDL hiccup into a failed boot. An
        // unstamped database whose very next statement explodes still resolves.
        let call = 0;
        const db = answering(async () => {
            call++;
            if (call === 1) return present(false);
            throw new Error("permission denied for schema rebase");
        });

        await expect(ensureAuthTablesExist(db)).resolves.toBeUndefined();
    });
});

describe("probeAuthSchema", () => {
    it("is healthy when the stamp matches and the table has the migrated shape", async () => {
        const db = fakeDb(
            present(true), stamped(String(AUTH_SCHEMA_VERSION)),
            present(true), allColumns, noRows
        );

        const result = await probeAuthSchema(db, "rebase");

        expect(result.healthy).toBe(true);
        expect(result.problems).toEqual([]);
        expect(result.databaseVersion).toBe(AUTH_SCHEMA_VERSION);
        expect(result.runtimeVersion).toBe(AUTH_SCHEMA_VERSION);
    });

    it("is healthy on an unstamped database whose structure is correct", async () => {
        // The structural half is what makes this useful today rather than one
        // upgrade cycle from now: no existing database carries a stamp yet.
        const db = fakeDb(present(false), present(true), allColumns, noRows);

        const result = await probeAuthSchema(db, "rebase");

        expect(result.healthy).toBe(true);
        expect(result.databaseVersion).toBeNull();
    });

    it("reports drift when the database is newer than the runtime", async () => {
        const db = fakeDb(
            present(true), stamped("9"),
            present(true), allColumns, noRows
        );

        const result = await probeAuthSchema(db, "rebase");

        expect(result.healthy).toBe(false);
        expect(result.problems.join(" ")).toContain("migrated by a newer framework version");
    });

    it("reports an unmigrated database — the columns rotation needs are absent", async () => {
        const db = fakeDb(
            present(false),
            present(true),
            queryResult([{ column_name: "revoked" }]),
            noRows
        );

        const result = await probeAuthSchema(db, "rebase");

        expect(result.healthy).toBe(false);
        const problems = result.problems.join(" ");
        expect(problems).toContain("session_id");
        expect(problems).toContain("rotated_at");
        expect(problems).toContain("session_started_at");
        expect(problems).not.toContain("revoked,");
    });

    it("reports a surviving unique_device_session, which breaks concurrent rotation", async () => {
        const db = fakeDb(
            present(false),
            present(true), allColumns,
            queryResult([{ "?column?": 1 }])
        );

        const result = await probeAuthSchema(db, "rebase");

        expect(result.healthy).toBe(false);
        expect(result.problems.join(" ")).toContain("unique_device_session");
    });

    it("is healthy when refresh_tokens does not exist — auth may simply not be configured", async () => {
        const db = fakeDb(present(false), present(false));

        expect((await probeAuthSchema(db, "rebase")).healthy).toBe(true);
    });

    it("does not throw when refresh_tokens is missing but the stamp is ahead", async () => {
        const db = fakeDb(present(true), stamped("9"), present(false));

        const result = await probeAuthSchema(db, "rebase");

        expect(result.healthy).toBe(false);
        expect(result.problems).toHaveLength(1);
    });

    it("never throws — a probe that cannot run reports unhealthy instead of 500ing /health", async () => {
        const exploding = answering(async () => {
            throw new Error("connection terminated");
        });

        const result = await probeAuthSchema(exploding, "rebase");

        expect(result.healthy).toBe(false);
        expect(result.problems.join(" ")).toContain("connection terminated");
    });
});
