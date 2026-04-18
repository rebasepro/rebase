import { BranchService } from "../src/services/BranchService";
import { DatabasePoolManager } from "../src/databasePoolManager";
import { NodePgDatabase } from "drizzle-orm/node-postgres";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/** Create a minimal mock DrizzleClient with a configurable `execute` spy. */
function createMockDb() {
    return {
        execute: jest.fn().mockResolvedValue({ rows: [] }),
    } as unknown as jest.Mocked<NodePgDatabase>;
}

/** Create a minimal mock DatabasePoolManager. */
function createMockPoolManager(defaultDbName = "my_app_db") {
    return {
        defaultDatabaseName: defaultDbName,
        disconnectDatabase: jest.fn().mockResolvedValue(undefined),
        getDrizzle: jest.fn(),
        getPool: jest.fn(),
        hasPool: jest.fn(),
        shutdown: jest.fn().mockResolvedValue(undefined),
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

            // Two calls: one for the schema, one for the table
            expect(db.execute).toHaveBeenCalledTimes(2);

            const firstArg = (db.execute as jest.Mock).mock.calls[0][0];
            expect(firstArg).toBeDefined();

            const secondArg = (db.execute as jest.Mock).mock.calls[1][0];
            expect(secondArg).toBeDefined();
        });

        it("should be idempotent (safe to call multiple times)", async () => {
            await service.ensureBranchMetadataTable();
            await service.ensureBranchMetadataTable();

            // Each call issues 2 executes → total 4
            expect(db.execute).toHaveBeenCalledTimes(4);
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
                .mockResolvedValueOnce(undefined as never)    // disconnectDatabase (noop)
                .mockResolvedValueOnce(undefined as never)    // CREATE DATABASE
                .mockResolvedValueOnce(undefined as never);   // INSERT metadata

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

        it("should sanitize the branch name — stripping special characters", async () => {
            db.execute
                .mockResolvedValueOnce({ rows: [] } as never)
                .mockResolvedValueOnce(undefined as never)
                .mockResolvedValueOnce(undefined as never);

            const result = await service.createBranch("my-feature/branch!@#");

            expect(result.name).toBe("myfeaturebranch");
        });

        it("should throw when the branch already exists in metadata", async () => {
            db.execute.mockResolvedValueOnce({
                rows: [{ name: "staging" }],
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
                .mockRejectedValueOnce(new Error('database "rb_staging" already exists')); // CREATE DB fails

            await expect(service.createBranch("staging")).rejects.toThrow(
                'Database "rb_staging" already exists on the server'
            );
        });

        it("should throw a helpful error when CREATE DATABASE fails due to active connections", async () => {
            db.execute
                .mockResolvedValueOnce({ rows: [] } as never) // existence check
                .mockRejectedValueOnce(new Error("source database is being accessed by other users"));

            await expect(service.createBranch("staging")).rejects.toThrow(
                "Cannot create branch"
            );
        });

        it("should re-throw unknown CREATE DATABASE errors", async () => {
            const unknownError = new Error("disk full");
            db.execute
                .mockResolvedValueOnce({ rows: [] } as never)
                .mockRejectedValueOnce(unknownError);

            await expect(service.createBranch("staging")).rejects.toThrow("disk full");
        });

        it("should throw when branch name is entirely special characters", async () => {
            await expect(service.createBranch("---!!!")).rejects.toThrow(
                "Branch name must contain at least one alphanumeric character"
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
                .mockRejectedValueOnce(new Error("database is being accessed by other users")); // DROP fails

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
                    { name: "staging", parent_db: "my_app_db", created_at: now, size_bytes: 1048576 },
                    { name: "preview", parent_db: "my_app_db", created_at: now, size_bytes: null },
                ],
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
                    rows: [{ name: "staging", parent_db: "my_app_db", created_at: now }],
                } as never)
                .mockResolvedValueOnce({
                    rows: [{ size_bytes: 2097152 }],
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
                    rows: [{ name: "staging", parent_db: "my_app_db", created_at: now }],
                } as never)
                .mockRejectedValueOnce(new Error("database does not exist")); // size query fails

            const result = await service.getBranchInfo("staging");

            expect(result).toBeDefined();
            expect(result!.name).toBe("staging");
            expect(result!.sizeBytes).toBeUndefined();
        });

        it("should sanitize the branch name input", async () => {
            db.execute.mockResolvedValueOnce({ rows: [] } as never);

            await service.getBranchInfo("my-branch!");

            // Should still call execute (with sanitized name)
            expect(db.execute).toHaveBeenCalledTimes(1);
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

        it("should strip spaces, hyphens, dots, and other special chars", async () => {
            db.execute
                .mockResolvedValueOnce({ rows: [] } as never)
                .mockResolvedValueOnce(undefined as never)
                .mockResolvedValueOnce(undefined as never);

            const result = await service.createBranch("my branch.v2-rc1");

            expect(result.name).toBe("mybranchv2rc1");
        });
    });
});
