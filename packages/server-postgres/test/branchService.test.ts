import { BranchService, BranchingUnsupportedError } from "../src/services/BranchService";
import { DatabasePoolManager } from "../src/databasePoolManager";
import { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { queryResult, spiedDrizzle, type SpiedDrizzle } from "./helpers/spg-a-db";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const dialect = new PgDialect();

/**
 * Compile the statement a given `db.execute` call actually issued.
 *
 * The mock swallows the SQL object whole, so counting calls says nothing about
 * what was run: a service that emitted the wrong DDL, dropped an
 * `IF NOT EXISTS`, or spliced a user-supplied name into an identifier would
 * produce exactly the same call count. Compiling through the real dialect is
 * what makes those visible — and it also shows which values were *bound* rather
 * than interpolated.
 */
function statementAt(execute: SpiedDrizzle["execute"], index: number): { sql: string; params: unknown[] } {
    const chunk = execute.mock.calls[index][0];
    if (!(chunk instanceof SQL)) throw new Error(`execute call ${index} was not given an SQL object`);
    const query = dialect.sqlToQuery(chunk);
    return { sql: query.sql.replace(/\s+/g, " ").trim(),
        params: query.params };
}

/**
 * Build an error shaped like the ones Drizzle actually throws.
 *
 * Drizzle reports the statement it ran and hides the PostgreSQL error in the
 * `cause` chain, so the top-level `message` never contains the reason. Tests
 * that throw a bare `new Error("...already exists")` describe a shape that
 * cannot occur, and would pass against code that only reads `err.message`.
 */
function createDrizzleQueryError(query: string, pgCode: string, pgMessage: string): Error {
    const pgError = Object.assign(new Error(pgMessage), { code: pgCode });
    return Object.assign(new Error(`Failed query: ${query}\nparams: `), { cause: pgError });
}

/**
 * Create a minimal mock DatabasePoolManager.
 *
 * `servesOneDatabase` defaults to `false` — a real Postgres — because that is
 * the connection every other test in this file describes. The managed database
 * answers `true`, and the branch mutations refuse there; see the block at the
 * bottom.
 */
function createMockPoolManager(defaultDbName = "my_app_db", servesOneDatabase = false): DatabasePoolManager {
    const manager = new DatabasePoolManager(`postgres://localhost/${defaultDbName}`);
    jest.spyOn(manager, "disconnectDatabase").mockResolvedValue(undefined);
    jest.spyOn(manager, "servesOneDatabase").mockResolvedValue(servesOneDatabase);
    // No maintenance database here: the paths that reach for one fall back.
    jest.spyOn(manager, "getPool").mockImplementation(() => {
        throw new Error("no maintenance pool in this test");
    });
    const maintenance = spiedDrizzle();
    maintenance.execute.mockRejectedValue(new Error("no maintenance database in this test"));
    jest.spyOn(manager, "getDrizzle").mockReturnValue(maintenance.db);
    return manager;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BranchService", () => {
    let db: SpiedDrizzle["db"];
    let execute: SpiedDrizzle["execute"];
    let poolManager: DatabasePoolManager;
    let service: BranchService;

    beforeEach(() => {
        ({ db, execute } = spiedDrizzle());
        poolManager = createMockPoolManager();
        service = new BranchService(db, poolManager);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    // -----------------------------------------------------------------------
    // ensureBranchMetadataTable
    // -----------------------------------------------------------------------
    describe("ensureBranchMetadataTable", () => {
        it("should execute CREATE SCHEMA and CREATE TABLE statements", async () => {
            await service.ensureBranchMetadataTable();

            // Three calls: the schema, the table, and the revoke that keeps the
            // authenticated role out of it.
            expect(execute).toHaveBeenCalledTimes(3);

            expect(statementAt(execute, 0).sql).toBe("CREATE SCHEMA IF NOT EXISTS rebase");

            // The metadata table has to land in the `rebase` schema, and every
            // column `createBranch`/`listBranches` later read or write has to
            // exist — an unqualified or under-specified CREATE TABLE only fails
            // at the next statement, on a real database.
            const table = statementAt(execute, 1).sql;
            expect(table).toContain("CREATE TABLE IF NOT EXISTS rebase.branches");
            expect(table).toContain("name TEXT PRIMARY KEY");
            expect(table).toContain("db_name TEXT NOT NULL UNIQUE");
            expect(table).toContain("parent_db TEXT NOT NULL");
            expect(table).toContain("created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()");
        });

        it("takes the authenticated role's grant back off the table it just made", async () => {
            // `rebase.branches` is not a collection, so it has no RLS — and the
            // driver grants `rebase_user` DML on every table in `rebase`,
            // including ones (like this) created after that grant ran. Without
            // this statement the branch list is readable and writable by every
            // signed-in user.
            await service.ensureBranchMetadataTable();

            const revoke = statementAt(execute, 2).sql;
            expect(revoke).toContain("format('REVOKE ALL ON \"rebase\".\"branches\" FROM %I', request_role)");
            // Guarded both ways: the role may not exist (unprivileged
            // connections never provision it) and a bare REVOKE would then error
            // rather than no-op.
            expect(revoke).toContain("FROM pg_roles WHERE rolname = request_role");
        });

        it("should be idempotent (safe to call multiple times)", async () => {
            await service.ensureBranchMetadataTable();
            await service.ensureBranchMetadataTable();

            // Each call issues 3 executes → total 6
            expect(execute).toHaveBeenCalledTimes(6);

            // "Idempotent" is a property of the statements, not of the count:
            // the second run re-issues exactly the same DDL, and it is a no-op
            // only because every statement is guarded. Drop a guard and this
            // boot-time call starts throwing on every restart after the first.
            const run1 = [statementAt(execute, 0), statementAt(execute, 1), statementAt(execute, 2)];
            const run2 = [statementAt(execute, 3), statementAt(execute, 4), statementAt(execute, 5)];
            expect(run2).toEqual(run1);
            for (const statement of run1.slice(0, 2)) {
                expect(statement.sql).toContain("IF NOT EXISTS");
                expect(statement.params).toEqual([]);
            }
            // The revoke's guard is a catalogue lookup rather than IF NOT EXISTS.
            expect(run1[2].sql).toContain("IF EXISTS (SELECT 1 FROM pg_roles");
            expect(run1[2].params).toEqual([]);
        });
    });

    // -----------------------------------------------------------------------
    // createBranch
    // -----------------------------------------------------------------------
    describe("createBranch", () => {
        it("should create a branch database and record metadata", async () => {
            // No existing branch
            execute
                .mockResolvedValueOnce(queryResult()) // existence check
                .mockResolvedValueOnce(queryResult()) // disconnectDatabase (noop)
                .mockResolvedValueOnce(queryResult([{ xid: "4242" }])) // the fork point
                .mockResolvedValueOnce(queryResult()) // the home comment
                .mockResolvedValueOnce(queryResult()); // INSERT metadata

            const result = await service.createBranch("staging");

            expect(result.name).toBe("staging");
            expect(result.database).toBe("rb_staging");
            expect(result.parentDatabase).toBe("my_app_db");
            expect(result.createdAt).toBeInstanceOf(Date);
            expect(result.forkXid).toBe("4242");

            // poolManager.disconnectDatabase should be called with the source db
            expect(poolManager.disconnectDatabase).toHaveBeenCalledWith("my_app_db");

            // existence check, CREATE DB, the fork point, the home comment,
            // INSERT. The disconnect is on poolManager, not db.
            expect(execute).toHaveBeenCalledTimes(5);
            // The fork point is read from the new database's catalog row right
            // after it is made, and kept: that row's xmin moves on any later
            // GRANT or ALTER DATABASE.
            expect(statementAt(execute, 2).sql).toBe("SELECT xmin::text AS xid FROM pg_database WHERE datname = $1");
            expect(statementAt(execute, 2).params).toEqual(["rb_staging"]);
            expect(statementAt(execute, 4).params[4]).toBe(JSON.stringify({ forkXid: "4242" }));
        });

        it("should use a custom source database when provided", async () => {
            execute
                .mockResolvedValueOnce(queryResult())
                .mockResolvedValueOnce(queryResult())
                .mockResolvedValueOnce(queryResult([{ xid: "4242" }])); // the fork point

            const result = await service.createBranch("preview", { source: "production_db" });

            expect(result.parentDatabase).toBe("production_db");
            expect(poolManager.disconnectDatabase).toHaveBeenCalledWith("production_db");
        });

        it("keeps the name it was given, hyphens and all", async () => {
            execute
                .mockResolvedValueOnce(queryResult())
                .mockResolvedValueOnce(queryResult())
                .mockResolvedValueOnce(queryResult([{ xid: "4242" }])); // the fork point

            const result = await service.createBranch("my-feature-branch");

            // Previously `myfeaturebranch`: the hyphens were stripped and the
            // caller was told a different name than it asked for.
            expect(result.name).toBe("my-feature-branch");

            // The returned name proves nothing about the statement: a database
            // name cannot be a bind parameter, so it is spliced into the DDL
            // text. Both identifiers must be double-quoted — that is what makes
            // a hyphen safe to keep, and what stops a name that merely *starts*
            // legal (`myfeature drop...`) parsing as more than one token.
            expect(statementAt(execute, 1).sql).toBe(
                'CREATE DATABASE "rb_my-feature-branch" TEMPLATE "my_app_db"'
            );
            expect(statementAt(execute, 1).params).toEqual([]);

            // The metadata row, by contrast, is fully parameterised.
            expect(statementAt(execute, 4).params).toEqual([
                "my-feature-branch",
                "rb_my-feature-branch",
                "my_app_db",
                expect.any(String),
                JSON.stringify({ forkXid: "4242" })
            ]);
        });

        it("names the missing registry instead of a raw 'relation does not exist'", async () => {
            // With REBASE_PROVISION=false the server never creates
            // rebase.branches, and the first statement that reads it failed
            // with Postgres's own words.
            execute.mockRejectedValueOnce(
                Object.assign(new Error('relation "rebase.branches" does not exist'), { code: "42P01" })
            );
            await expect(service.createBranch("staging")).rejects.toThrow(/rebase\.branches.*REBASE_PROVISION/s);
        });

        it("refuses a name it cannot represent rather than quietly changing it", async () => {
            await expect(service.createBranch("my-feature/branch!@#")).rejects.toThrow(
                /only letters, digits, underscores, and hyphens/
            );

            // Refused before anything ran: no existence check, and above all no
            // CREATE DATABASE with a half-accepted name spliced into it.
            expect(execute).not.toHaveBeenCalled();
        });

        it("refuses a name Postgres would silently truncate", async () => {
            // 63 bytes is the identifier limit and "rb_" is part of the budget,
            // so 61 characters overflows by one. Postgres does not complain — it
            // just makes the database under a shorter name, which is the same
            // silent rename by another route.
            await expect(service.createBranch("a".repeat(61))).rejects.toThrow(/too long/);
            expect(execute).not.toHaveBeenCalled();
        });

        it("should throw when the branch already exists in metadata", async () => {
            execute.mockResolvedValueOnce(queryResult([{ name: "staging" }]));

            await expect(service.createBranch("staging")).rejects.toThrow(
                'Branch "staging" already exists.'
            );

            // Should not attempt to create a DB
            expect(poolManager.disconnectDatabase).not.toHaveBeenCalled();
        });

        it("should throw a helpful error when CREATE DATABASE fails due to existing DB", async () => {
            execute
                .mockResolvedValueOnce(queryResult()) // existence check
                .mockRejectedValueOnce(createDrizzleQueryError(
                    'CREATE DATABASE "rb_staging" TEMPLATE "my_app_db"',
                    "42P04",
                    'database "rb_staging" already exists'
                ));

            await expect(service.createBranch("staging")).rejects.toThrow(
                'Database "rb_staging" already exists on the server'
            );
        });

        it("should throw a helpful error when CREATE DATABASE fails due to active connections", async () => {
            execute
                .mockResolvedValueOnce(queryResult()) // existence check
                .mockRejectedValueOnce(createDrizzleQueryError(
                    'CREATE DATABASE "rb_staging" TEMPLATE "my_app_db"',
                    "55006",
                    'source database "my_app_db" is being accessed by other users'
                ));

            await expect(service.createBranch("staging")).rejects.toThrow(
                "Cannot create branch"
            );
        });

        it("should surface the underlying reason, not the Drizzle wrapper, for unknown failures", async () => {
            execute
                .mockResolvedValueOnce(queryResult())
                .mockRejectedValueOnce(createDrizzleQueryError(
                    'CREATE DATABASE "rb_staging" TEMPLATE "my_app_db"',
                    "53100",
                    "could not write to file: No space left on device"
                ));

            // The user must see the reason; "Failed query: ..." alone is useless.
            const error = await service.createBranch("staging").catch((e: unknown) => e);
            if (!(error instanceof Error)) throw new Error("createBranch should have failed");
            expect(error.message).toContain("could not write to file: No space left on device");
            expect(error.message).not.toMatch(/^Failed query:/);
        });

        it("should re-throw unknown CREATE DATABASE errors that are not query failures", async () => {
            const unknownError = new Error("disk full");
            execute
                .mockResolvedValueOnce(queryResult())
                .mockRejectedValueOnce(unknownError);

            await expect(service.createBranch("staging")).rejects.toThrow("disk full");
        });

        it("should throw when branch name is entirely special characters", async () => {
            await expect(service.createBranch("---!!!")).rejects.toThrow(
                "Invalid branch name: only letters, digits, underscores, and hyphens are allowed."
            );
        });
    });

    // -----------------------------------------------------------------------
    // deleteBranch
    // -----------------------------------------------------------------------
    describe("deleteBranch", () => {
        it("should delete the branch database and remove metadata", async () => {
            execute
                .mockResolvedValueOnce(queryResult([{ db_name: "rb_staging" }])) // existence check
                .mockResolvedValueOnce(queryResult()) // DROP DATABASE
                .mockResolvedValueOnce(queryResult()); // DELETE metadata

            await service.deleteBranch("staging");

            expect(poolManager.disconnectDatabase).toHaveBeenCalledWith("rb_staging");
            // 3 execute calls: SELECT, DROP, DELETE
            expect(execute).toHaveBeenCalledTimes(3);
        });

        it("should throw when trying to delete the main database", async () => {
            // The branch name, after prefix, would need to match defaultDatabaseName.
            // Use a pool manager where defaultDatabaseName = "rb_main"
            const pm = createMockPoolManager("rb_main");
            const svc = new BranchService(db, pm);

            await expect(svc.deleteBranch("main")).rejects.toThrow(
                "Cannot delete the main database"
            );

            // Should not query metadata at all
            expect(execute).not.toHaveBeenCalled();
        });

        it("should throw when the branch is not found in metadata", async () => {
            execute.mockResolvedValueOnce(queryResult());

            await expect(service.deleteBranch("nonexistent")).rejects.toThrow(
                'Branch "nonexistent" not found.'
            );
        });

        it("should throw a helpful error when DROP DATABASE fails due to active connections", async () => {
            execute
                .mockResolvedValueOnce(queryResult([{ db_name: "rb_staging" }])) // existence check
                .mockRejectedValueOnce(createDrizzleQueryError(
                    'DROP DATABASE "rb_staging"',
                    "55006",
                    'database "rb_staging" is being accessed by other users'
                )); // DROP fails

            await expect(service.deleteBranch("staging")).rejects.toThrow(
                'Cannot delete branch "staging"'
            );
        });

        it("should re-throw unknown DROP DATABASE errors", async () => {
            execute
                .mockResolvedValueOnce(queryResult([{ db_name: "rb_staging" }]))
                .mockRejectedValueOnce(new Error("permission denied"));

            await expect(service.deleteBranch("staging")).rejects.toThrow("permission denied");
        });
    });

    // -----------------------------------------------------------------------
    // listBranches
    // -----------------------------------------------------------------------
    describe("listBranches", () => {
        it("should return an empty array when no branches exist", async () => {
            execute.mockResolvedValueOnce(queryResult());

            const result = await service.listBranches();

            expect(result).toEqual([]);
        });

        it("should map database rows to BranchInfo objects", async () => {
            const now = new Date().toISOString();
            execute.mockResolvedValueOnce(queryResult([
                    { name: "staging",
db_name: "rb_staging",
parent_db: "my_app_db",
created_at: now,
size_bytes: 1048576 },
                    { name: "preview",
db_name: "rb_preview",
parent_db: "my_app_db",
created_at: now,
size_bytes: null }
                ]));

            const result = await service.listBranches();

            expect(result).toHaveLength(2);

            expect(result[0].name).toBe("staging");
            expect(result[0].database).toBe("rb_staging");
            expect(result[0].parentDatabase).toBe("my_app_db");
            expect(result[0].createdAt).toBeInstanceOf(Date);
            expect(result[0].sizeBytes).toBe(1048576);

            expect(result[1].name).toBe("preview");
            expect(result[1].sizeBytes).toBeUndefined();
        });

        /**
         * A branch's database is the one its row names, not one derived from
         * its name again: Studio copies a branch by sending this as the
         * source, and a row written before names stopped being stripped says
         * `rb_myfeature` for `my-feature`.
         */
        it("says which database each branch is, as its row records it", async () => {
            execute.mockResolvedValueOnce(queryResult([{ name: "my-feature", db_name: "rb_myfeature", parent_db: "my_app_db", created_at: new Date().toISOString(), size_bytes: 1 }]));

            const [branch] = await service.listBranches();

            expect(statementAt(execute, 0).sql).toContain("b.db_name");
            expect(branch.database).toBe("rb_myfeature");
        });
    });

    // -----------------------------------------------------------------------
    // getBranchInfo
    // -----------------------------------------------------------------------
    describe("getBranchInfo", () => {
        it("should return branch info when found", async () => {
            const now = new Date().toISOString();
            execute
                .mockResolvedValueOnce(queryResult([{ name: "staging",
db_name: "rb_staging",
parent_db: "my_app_db",
created_at: now }]))
                .mockResolvedValueOnce(queryResult([{ size_bytes: 2097152 }]));

            const result = await service.getBranchInfo("staging");

            expect(result).toBeDefined();
            expect(result!.name).toBe("staging");
            expect(result!.database).toBe("rb_staging");
            expect(result!.parentDatabase).toBe("my_app_db");
            expect(result!.sizeBytes).toBe(2097152);
            expect(result!.createdAt).toBeInstanceOf(Date);
        });

        it("should return undefined when branch is not found", async () => {
            execute.mockResolvedValueOnce(queryResult());

            const result = await service.getBranchInfo("nonexistent");

            expect(result).toBeUndefined();
        });

        it("should gracefully handle size-fetch failure (externally dropped DB)", async () => {
            const now = new Date().toISOString();
            execute
                .mockResolvedValueOnce(queryResult([{ name: "staging",
parent_db: "my_app_db",
created_at: now }]))
                .mockRejectedValueOnce(new Error("database does not exist")); // size query fails

            const result = await service.getBranchInfo("staging");

            expect(result).toBeDefined();
            expect(result!.name).toBe("staging");
            expect(result!.sizeBytes).toBeUndefined();
        });

        it("looks a branch up under exactly the name it was created with", async () => {
            execute.mockResolvedValueOnce(queryResult());

            await service.getBranchInfo("my-branch");

            expect(execute).toHaveBeenCalledTimes(1);

            // The row is stored under the name as given, so this is the only
            // lookup that can find it. It used to query "mybranch", which
            // matched only because create had mangled the name the same way.
            const statement = statementAt(execute, 0);
            expect(statement.params).toEqual(["my-branch"]);
            expect(statement.sql).toContain("b.name = $1");
        });

        it("rejects a name that could never have been created", async () => {
            await expect(service.getBranchInfo("my-branch!")).rejects.toThrow(
                /only letters, digits, underscores, and hyphens/
            );
            expect(execute).not.toHaveBeenCalled();
        });
    });

    // -----------------------------------------------------------------------
    // Name sanitization edge cases (exercised through public API)
    // -----------------------------------------------------------------------
    describe("branch name sanitization", () => {
        it("should preserve underscores", async () => {
            execute
                .mockResolvedValueOnce(queryResult())
                .mockResolvedValueOnce(queryResult())
                .mockResolvedValueOnce(queryResult([{ xid: "4242" }])); // the fork point

            const result = await service.createBranch("feature_auth_v2");

            expect(result.name).toBe("feature_auth_v2");
        });

        it("should preserve mixed-case alphanumerics", async () => {
            execute
                .mockResolvedValueOnce(queryResult())
                .mockResolvedValueOnce(queryResult())
                .mockResolvedValueOnce(queryResult([{ xid: "4242" }])); // the fork point

            const result = await service.createBranch("MyBranch123");

            expect(result.name).toBe("MyBranch123");
        });

        it("keeps hyphens, and refuses the characters it cannot keep", async () => {
            execute
                .mockResolvedValueOnce(queryResult())
                .mockResolvedValueOnce(queryResult())
                .mockResolvedValueOnce(queryResult([{ xid: "4242" }])); // the fork point

            // A hyphen is representable, so it survives. `my branch.v2-rc1` used
            // to come back as `mybranchv2rc1` — three characters quietly gone.
            expect((await service.createBranch("v2-rc1")).name).toBe("v2-rc1");

            // A space and a dot are not, so the name is refused rather than
            // turned into a different one.
            await expect(service.createBranch("my branch.v2-rc1")).rejects.toThrow(
                /only letters, digits, underscores, and hyphens/
            );
        });
    });
    // -----------------------------------------------------------------------
    // Active connections — the most common reason branching fails
    // -----------------------------------------------------------------------
    describe("when something else is connected", () => {
        /**
         * `CREATE DATABASE ... TEMPLATE` and `DROP DATABASE` both require that
         * no other session is attached. `poolManager.disconnectDatabase` only
         * reaches pools in *this* process, and the CLI is its own process — so
         * a `rebase dev` in another terminal is untouched by it. Wanting a
         * branch and running the app are the same moment, which makes this the
         * common path rather than the edge case.
         */
        const inUse = (query: string) => createDrizzleQueryError(
            query, "55006", 'source database "my_app_db" is being accessed by other users'
        );

        it("names what is connected instead of saying \"close other clients\"", async () => {
            execute
                .mockResolvedValueOnce(queryResult())                       // existing-branch check
                .mockRejectedValueOnce(inUse("CREATE DATABASE"))           // the CREATE
                .mockResolvedValueOnce(queryResult([                        // pg_stat_activity
                    { app: "(unnamed)", n: 2 },
                    { app: "DBeaver", n: 1 }
                ]));

            await expect(service.createBranch("feature")).rejects.toThrow(/2 × \(unnamed\)/);
        });

        it("suggests the two things that actually work", async () => {
            execute
                .mockResolvedValueOnce(queryResult())
                .mockRejectedValueOnce(inUse("CREATE DATABASE"))
                .mockResolvedValueOnce(queryResult([{ app: "(unnamed)", n: 1 }]));

            const error = await service.createBranch("feature").catch((e: unknown) => e);
            if (!(error instanceof Error)) throw new Error("createBranch should have failed");

            expect(error.message).toContain("rebase dev");
            expect(error.message).toContain("--force");
        });

        it("says so plainly when the blocker disconnected in the meantime", async () => {
            execute
                .mockResolvedValueOnce(queryResult())
                .mockRejectedValueOnce(inUse("CREATE DATABASE"))
                .mockResolvedValueOnce(queryResult());

            await expect(service.createBranch("feature")).rejects.toThrow(/since disconnected/);
        });

        it("still reports the failure when the diagnostic query itself fails", async () => {
            // A diagnostic that throws would replace a real error with its own.
            execute
                .mockResolvedValueOnce(queryResult())
                .mockRejectedValueOnce(inUse("CREATE DATABASE"))
                .mockRejectedValueOnce(new Error("pg_stat_activity is not readable"));

            await expect(service.createBranch("feature")).rejects.toThrow(/active connections/);
        });

        it("reports the same way when a delete is blocked", async () => {
            execute
                .mockResolvedValueOnce(queryResult([{ db_name: "rb_feature" }]))  // the branch row
                .mockRejectedValueOnce(inUse("DROP DATABASE"))
                .mockResolvedValueOnce(queryResult([{ app: "psql", n: 1 }]));

            await expect(service.deleteBranch("feature")).rejects.toThrow(/1 × psql/);
        });
    });

    describe("--force", () => {
        it("terminates other sessions on the source before templating it", async () => {
            execute.mockResolvedValue(queryResult());

            await service.createBranch("feature", { force: true });

            const statements = execute.mock.calls
                .map((_call, index) => statementAt(execute, index).sql);

            expect(statements.some(text => text.includes("pg_terminate_backend"))).toBe(true);
        });

        it("never terminates the session running the statement", async () => {
            // Terminating our own backend would abort the command that asked.
            execute.mockResolvedValue(queryResult());

            await service.createBranch("feature", { force: true });

            const terminate = execute.mock.calls
                .map((_call, index) => statementAt(execute, index).sql)
                .find(text => text.includes("pg_terminate_backend"));

            expect(terminate).toContain("pid <> pg_backend_pid()");
        });

        it("terminates on the BRANCH when deleting, not on the main database", async () => {
            execute.mockResolvedValue(queryResult([{ db_name: "rb_feature" }]));

            await service.deleteBranch("feature", { force: true });

            const call = execute.mock.calls
                .map((_c, index) => statementAt(execute, index))
                .find(statement => statement.sql.includes("pg_terminate_backend"));

            expect(call?.params).toContain("rb_feature");
        });

        it("does nothing of the sort without the flag", async () => {
            execute.mockResolvedValue(queryResult());

            await service.createBranch("feature");

            const statements = execute.mock.calls
                .map((_call, index) => statementAt(execute, index).sql);

            expect(statements.some(text => text.includes("pg_terminate_backend"))).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // A server that serves exactly one database
    // -----------------------------------------------------------------------
    describe("on a server that serves one database", () => {
        let managed: DatabasePoolManager;
        let managedService: BranchService;

        beforeEach(() => {
            managed = createMockPoolManager("postgres", true);
            managedService = new BranchService(db, managed);
        });

        it("refuses createBranch instead of writing a catalogue row that lies", async () => {
            // On PGlite `CREATE DATABASE "rb_x" TEMPLATE "postgres"` succeeds,
            // is listable, and reports a size — and connecting to it lands you
            // in the parent. The CLI has always refused this; Studio reached
            // the service over the websocket and got a success toast.
            await expect(managedService.createBranch("sweep-branch"))
                .rejects.toBeInstanceOf(BranchingUnsupportedError);

            // Refused before anything ran, so no catalogue row exists to clean
            // up and no metadata row claims a branch that is the parent.
            expect(execute).not.toHaveBeenCalled();
            expect(managed.disconnectDatabase).not.toHaveBeenCalled();
        });

        it("refuses deleteBranch too — a DROP there would target the parent's name", async () => {
            await expect(managedService.deleteBranch("sweep-branch"))
                .rejects.toBeInstanceOf(BranchingUnsupportedError);

            expect(execute).not.toHaveBeenCalled();
        });

        it("says what to do instead, and carries a code the transports forward", async () => {
            const error = await managedService.createBranch("x").catch((e: unknown) => e);

            expect(error).toBeInstanceOf(BranchingUnsupportedError);
            if (!(error instanceof BranchingUnsupportedError)) throw error;
            expect(error.code).toBe("BRANCHING_UNSUPPORTED");
            // The message is the only part that tells the reader where
            // branching *does* work; `websocket.ts` forwards it verbatim.
            expect(error.message).toContain("rebase dev --docker");
            expect(error.message).toContain("DATABASE_URL");
        });

        it("still lists branches — an empty list is honest, a failure is not", async () => {
            execute.mockResolvedValue(queryResult());

            await expect(managedService.listBranches()).resolves.toEqual([]);
        });
    });
});
