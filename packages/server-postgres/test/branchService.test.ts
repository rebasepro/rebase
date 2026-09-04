import { BranchService } from "../src/services/BranchService";
import { DatabasePoolManager } from "../src/databasePoolManager";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { PgDialect } from "drizzle-orm/pg-core";

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
function statementAt(db: jest.Mocked<NodePgDatabase>, index: number): { sql: string; params: unknown[] } {
    const chunk = (db.execute as jest.Mock).mock.calls[index][0];
    const query = dialect.sqlToQuery(chunk as never);
    return { sql: query.sql.replace(/\s+/g, " ").trim(),
        params: query.params };
}

/** Create a minimal mock DrizzleClient with a configurable `execute` spy. */
function createMockDb() {
    return {
        execute: jest.fn().mockResolvedValue({ rows: [] })
    } as unknown as jest.Mocked<NodePgDatabase>;
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

/** Create a minimal mock DatabasePoolManager. */
function createMockPoolManager(defaultDbName = "my_app_db") {
    return {
        defaultDatabaseName: defaultDbName,
        disconnectDatabase: jest.fn().mockResolvedValue(undefined),
        getDrizzle: jest.fn(),
        getPool: jest.fn(),
        hasPool: jest.fn(),
        shutdown: jest.fn().mockResolvedValue(undefined)
    } as unknown as jest.Mocked<DatabasePoolManager>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BranchService", () => {
    let db: jest.Mocked<NodePgDatabase>;
    let poolManager: jest.Mocked<DatabasePoolManager>;
    let service: BranchService;

    beforeEach(() => {
        db = createMockDb();
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
            expect(db.execute).toHaveBeenCalledTimes(3);

            expect(statementAt(db, 0).sql).toBe("CREATE SCHEMA IF NOT EXISTS rebase");

            // The metadata table has to land in the `rebase` schema, and every
            // column `createBranch`/`listBranches` later read or write has to
            // exist — an unqualified or under-specified CREATE TABLE only fails
            // at the next statement, on a real database.
            const table = statementAt(db, 1).sql;
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

            const revoke = statementAt(db, 2).sql;
            expect(revoke).toContain("REVOKE ALL ON \"rebase\".\"branches\" FROM rebase_user");
            // Guarded both ways: the role may not exist (unprivileged
            // connections never provision it) and a bare REVOKE would then error
            // rather than no-op.
            expect(revoke).toContain("FROM pg_roles WHERE rolname = 'rebase_user'");
        });

        it("should be idempotent (safe to call multiple times)", async () => {
            await service.ensureBranchMetadataTable();
            await service.ensureBranchMetadataTable();

            // Each call issues 3 executes → total 6
            expect(db.execute).toHaveBeenCalledTimes(6);

            // "Idempotent" is a property of the statements, not of the count:
            // the second run re-issues exactly the same DDL, and it is a no-op
            // only because every statement is guarded. Drop a guard and this
            // boot-time call starts throwing on every restart after the first.
            const run1 = [statementAt(db, 0), statementAt(db, 1), statementAt(db, 2)];
            const run2 = [statementAt(db, 3), statementAt(db, 4), statementAt(db, 5)];
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
            db.execute
                .mockResolvedValueOnce({ rows: [] } as never) // existence check
                .mockResolvedValueOnce(undefined as never) // disconnectDatabase (noop)
                .mockResolvedValueOnce(undefined as never) // CREATE DATABASE
                .mockResolvedValueOnce(undefined as never); // INSERT metadata

            const result = await service.createBranch("staging");

            expect(result.name).toBe("staging");
            expect(result.parentDatabase).toBe("my_app_db");
            expect(result.createdAt).toBeInstanceOf(Date);

            // poolManager.disconnectDatabase should be called with the source db
            expect(poolManager.disconnectDatabase).toHaveBeenCalledWith("my_app_db");

            // Should have 4 execute calls: existence-check, disconnect (on poolManager), CREATE DB, INSERT
            // The disconnect is on poolManager, not db, so db.execute has 3 calls
            expect(db.execute).toHaveBeenCalledTimes(3);
        });

        it("should use a custom source database when provided", async () => {
            db.execute
                .mockResolvedValueOnce({ rows: [] } as never)
                .mockResolvedValueOnce(undefined as never)
                .mockResolvedValueOnce(undefined as never);

            const result = await service.createBranch("preview", { source: "production_db" });

            expect(result.parentDatabase).toBe("production_db");
            expect(poolManager.disconnectDatabase).toHaveBeenCalledWith("production_db");
        });

        it("keeps the name it was given, hyphens and all", async () => {
            db.execute
                .mockResolvedValueOnce({ rows: [] } as never)
                .mockResolvedValueOnce(undefined as never)
                .mockResolvedValueOnce(undefined as never);

            const result = await service.createBranch("my-feature-branch");

            // Previously `myfeaturebranch`: the hyphens were stripped and the
            // caller was told a different name than it asked for.
            expect(result.name).toBe("my-feature-branch");

            // The returned name proves nothing about the statement: a database
            // name cannot be a bind parameter, so it is spliced into the DDL
            // text. Both identifiers must be double-quoted — that is what makes
            // a hyphen safe to keep, and what stops a name that merely *starts*
            // legal (`myfeature drop...`) parsing as more than one token.
            expect(statementAt(db, 1).sql).toBe(
                'CREATE DATABASE "rb_my-feature-branch" TEMPLATE "my_app_db"'
            );
            expect(statementAt(db, 1).params).toEqual([]);

            // The metadata row, by contrast, is fully parameterised.
            expect(statementAt(db, 2).params).toEqual([
                "my-feature-branch",
                "rb_my-feature-branch",
                "my_app_db",
                expect.any(String)
            ]);
        });

        it("refuses a name it cannot represent rather than quietly changing it", async () => {
            await expect(service.createBranch("my-feature/branch!@#")).rejects.toThrow(
                /only letters, digits, underscores, and hyphens/
            );

            // Refused before anything ran: no existence check, and above all no
            // CREATE DATABASE with a half-accepted name spliced into it.
            expect(db.execute).not.toHaveBeenCalled();
        });

        it("refuses a name Postgres would silently truncate", async () => {
            // 63 bytes is the identifier limit and "rb_" is part of the budget,
            // so 61 characters overflows by one. Postgres does not complain — it
            // just makes the database under a shorter name, which is the same
            // silent rename by another route.
            await expect(service.createBranch("a".repeat(61))).rejects.toThrow(/too long/);
            expect(db.execute).not.toHaveBeenCalled();
        });

        it("should throw when the branch already exists in metadata", async () => {
            db.execute.mockResolvedValueOnce({
                rows: [{ name: "staging" }]
            } as never);

            await expect(service.createBranch("staging")).rejects.toThrow(
                'Branch "staging" already exists.'
            );

            // Should not attempt to create a DB
            expect(poolManager.disconnectDatabase).not.toHaveBeenCalled();
        });

        it("should throw a helpful error when CREATE DATABASE fails due to existing DB", async () => {
            db.execute
                .mockResolvedValueOnce({ rows: [] } as never) // existence check
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
            db.execute
                .mockResolvedValueOnce({ rows: [] } as never) // existence check
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
            db.execute
                .mockResolvedValueOnce({ rows: [] } as never)
                .mockRejectedValueOnce(createDrizzleQueryError(
                    'CREATE DATABASE "rb_staging" TEMPLATE "my_app_db"',
                    "53100",
                    "could not write to file: No space left on device"
                ));

            // The user must see the reason; "Failed query: ..." alone is useless.
            const error = await service.createBranch("staging").catch((e: unknown) => e as Error);
            expect(error.message).toContain("could not write to file: No space left on device");
            expect(error.message).not.toMatch(/^Failed query:/);
        });

        it("should re-throw unknown CREATE DATABASE errors that are not query failures", async () => {
            const unknownError = new Error("disk full");
            db.execute
                .mockResolvedValueOnce({ rows: [] } as never)
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
            db.execute
                .mockResolvedValueOnce({ rows: [{ db_name: "rb_staging" }] } as never) // existence check
                .mockResolvedValueOnce(undefined as never) // DROP DATABASE
                .mockResolvedValueOnce(undefined as never); // DELETE metadata

            await service.deleteBranch("staging");

            expect(poolManager.disconnectDatabase).toHaveBeenCalledWith("rb_staging");
            // 3 execute calls: SELECT, DROP, DELETE
            expect(db.execute).toHaveBeenCalledTimes(3);
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
            expect(db.execute).not.toHaveBeenCalled();
        });

        it("should throw when the branch is not found in metadata", async () => {
            db.execute.mockResolvedValueOnce({ rows: [] } as never);

            await expect(service.deleteBranch("nonexistent")).rejects.toThrow(
                'Branch "nonexistent" not found.'
            );
        });

        it("should throw a helpful error when DROP DATABASE fails due to active connections", async () => {
            db.execute
                .mockResolvedValueOnce({ rows: [{ db_name: "rb_staging" }] } as never) // existence check
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
            db.execute
                .mockResolvedValueOnce({ rows: [{ db_name: "rb_staging" }] } as never)
                .mockRejectedValueOnce(new Error("permission denied"));

            await expect(service.deleteBranch("staging")).rejects.toThrow("permission denied");
        });
    });

    // -----------------------------------------------------------------------
    // listBranches
    // -----------------------------------------------------------------------
    describe("listBranches", () => {
        it("should return an empty array when no branches exist", async () => {
            db.execute.mockResolvedValueOnce({ rows: [] } as never);

            const result = await service.listBranches();

            expect(result).toEqual([]);
        });

        it("should map database rows to BranchInfo objects", async () => {
            const now = new Date().toISOString();
            db.execute.mockResolvedValueOnce({
                rows: [
                    { name: "staging",
parent_db: "my_app_db",
created_at: now,
size_bytes: 1048576 },
                    { name: "preview",
parent_db: "my_app_db",
created_at: now,
size_bytes: null }
                ]
            } as never);

            const result = await service.listBranches();

            expect(result).toHaveLength(2);

            expect(result[0].name).toBe("staging");
            expect(result[0].parentDatabase).toBe("my_app_db");
            expect(result[0].createdAt).toBeInstanceOf(Date);
            expect(result[0].sizeBytes).toBe(1048576);

            expect(result[1].name).toBe("preview");
            expect(result[1].sizeBytes).toBeUndefined();
        });
    });

    // -----------------------------------------------------------------------
    // getBranchInfo
    // -----------------------------------------------------------------------
    describe("getBranchInfo", () => {
        it("should return branch info when found", async () => {
            const now = new Date().toISOString();
            db.execute
                .mockResolvedValueOnce({
                    rows: [{ name: "staging",
parent_db: "my_app_db",
created_at: now }]
                } as never)
                .mockResolvedValueOnce({
                    rows: [{ size_bytes: 2097152 }]
                } as never);

            const result = await service.getBranchInfo("staging");

            expect(result).toBeDefined();
            expect(result!.name).toBe("staging");
            expect(result!.parentDatabase).toBe("my_app_db");
            expect(result!.sizeBytes).toBe(2097152);
            expect(result!.createdAt).toBeInstanceOf(Date);
        });

        it("should return undefined when branch is not found", async () => {
            db.execute.mockResolvedValueOnce({ rows: [] } as never);

            const result = await service.getBranchInfo("nonexistent");

            expect(result).toBeUndefined();
        });

        it("should gracefully handle size-fetch failure (externally dropped DB)", async () => {
            const now = new Date().toISOString();
            db.execute
                .mockResolvedValueOnce({
                    rows: [{ name: "staging",
parent_db: "my_app_db",
created_at: now }]
                } as never)
                .mockRejectedValueOnce(new Error("database does not exist")); // size query fails

            const result = await service.getBranchInfo("staging");

            expect(result).toBeDefined();
            expect(result!.name).toBe("staging");
            expect(result!.sizeBytes).toBeUndefined();
        });

        it("looks a branch up under exactly the name it was created with", async () => {
            db.execute.mockResolvedValueOnce({ rows: [] } as never);

            await service.getBranchInfo("my-branch");

            expect(db.execute).toHaveBeenCalledTimes(1);

            // The row is stored under the name as given, so this is the only
            // lookup that can find it. It used to query "mybranch", which
            // matched only because create had mangled the name the same way.
            const statement = statementAt(db, 0);
            expect(statement.params).toEqual(["my-branch"]);
            expect(statement.sql).toContain("b.name = $1");
        });

        it("rejects a name that could never have been created", async () => {
            await expect(service.getBranchInfo("my-branch!")).rejects.toThrow(
                /only letters, digits, underscores, and hyphens/
            );
            expect(db.execute).not.toHaveBeenCalled();
        });
    });

    // -----------------------------------------------------------------------
    // Name sanitization edge cases (exercised through public API)
    // -----------------------------------------------------------------------
    describe("branch name sanitization", () => {
        it("should preserve underscores", async () => {
            db.execute
                .mockResolvedValueOnce({ rows: [] } as never)
                .mockResolvedValueOnce(undefined as never)
                .mockResolvedValueOnce(undefined as never);

            const result = await service.createBranch("feature_auth_v2");

            expect(result.name).toBe("feature_auth_v2");
        });

        it("should preserve mixed-case alphanumerics", async () => {
            db.execute
                .mockResolvedValueOnce({ rows: [] } as never)
                .mockResolvedValueOnce(undefined as never)
                .mockResolvedValueOnce(undefined as never);

            const result = await service.createBranch("MyBranch123");

            expect(result.name).toBe("MyBranch123");
        });

        it("keeps hyphens, and refuses the characters it cannot keep", async () => {
            db.execute
                .mockResolvedValueOnce({ rows: [] } as never)
                .mockResolvedValueOnce(undefined as never)
                .mockResolvedValueOnce(undefined as never);

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
            (db.execute as jest.Mock)
                .mockResolvedValueOnce({ rows: [] })                       // existing-branch check
                .mockRejectedValueOnce(inUse("CREATE DATABASE"))           // the CREATE
                .mockResolvedValueOnce({ rows: [                           // pg_stat_activity
                    { app: "(unnamed)", n: 2 },
                    { app: "DBeaver", n: 1 }
                ] });

            await expect(service.createBranch("feature")).rejects.toThrow(/2 × \(unnamed\)/);
        });

        it("suggests the two things that actually work", async () => {
            (db.execute as jest.Mock)
                .mockResolvedValueOnce({ rows: [] })
                .mockRejectedValueOnce(inUse("CREATE DATABASE"))
                .mockResolvedValueOnce({ rows: [{ app: "(unnamed)", n: 1 }] });

            const error = await service.createBranch("feature").catch((e: Error) => e);

            expect(error.message).toContain("rebase dev");
            expect(error.message).toContain("--force");
        });

        it("says so plainly when the blocker disconnected in the meantime", async () => {
            (db.execute as jest.Mock)
                .mockResolvedValueOnce({ rows: [] })
                .mockRejectedValueOnce(inUse("CREATE DATABASE"))
                .mockResolvedValueOnce({ rows: [] });

            await expect(service.createBranch("feature")).rejects.toThrow(/since disconnected/);
        });

        it("still reports the failure when the diagnostic query itself fails", async () => {
            // A diagnostic that throws would replace a real error with its own.
            (db.execute as jest.Mock)
                .mockResolvedValueOnce({ rows: [] })
                .mockRejectedValueOnce(inUse("CREATE DATABASE"))
                .mockRejectedValueOnce(new Error("pg_stat_activity is not readable"));

            await expect(service.createBranch("feature")).rejects.toThrow(/active connections/);
        });

        it("reports the same way when a delete is blocked", async () => {
            (db.execute as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ db_name: "rb_feature" }] })  // the branch row
                .mockRejectedValueOnce(inUse("DROP DATABASE"))
                .mockResolvedValueOnce({ rows: [{ app: "psql", n: 1 }] });

            await expect(service.deleteBranch("feature")).rejects.toThrow(/1 × psql/);
        });
    });

    describe("--force", () => {
        it("terminates other sessions on the source before templating it", async () => {
            (db.execute as jest.Mock).mockResolvedValue({ rows: [] });

            await service.createBranch("feature", { force: true });

            const statements = (db.execute as jest.Mock).mock.calls
                .map((_call, index) => statementAt(db, index).sql);

            expect(statements.some(text => text.includes("pg_terminate_backend"))).toBe(true);
        });

        it("never terminates the session running the statement", async () => {
            // Terminating our own backend would abort the command that asked.
            (db.execute as jest.Mock).mockResolvedValue({ rows: [] });

            await service.createBranch("feature", { force: true });

            const terminate = (db.execute as jest.Mock).mock.calls
                .map((_call, index) => statementAt(db, index).sql)
                .find(text => text.includes("pg_terminate_backend"));

            expect(terminate).toContain("pid <> pg_backend_pid()");
        });

        it("terminates on the BRANCH when deleting, not on the main database", async () => {
            (db.execute as jest.Mock).mockResolvedValue({ rows: [{ db_name: "rb_feature" }] });

            await service.deleteBranch("feature", { force: true });

            const call = (db.execute as jest.Mock).mock.calls
                .map((_c, index) => statementAt(db, index))
                .find(statement => statement.sql.includes("pg_terminate_backend"));

            expect(call?.params).toContain("rb_feature");
        });

        it("does nothing of the sort without the flag", async () => {
            (db.execute as jest.Mock).mockResolvedValue({ rows: [] });

            await service.createBranch("feature");

            const statements = (db.execute as jest.Mock).mock.calls
                .map((_call, index) => statementAt(db, index).sql);

            expect(statements.some(text => text.includes("pg_terminate_backend"))).toBe(false);
        });
    });
});
