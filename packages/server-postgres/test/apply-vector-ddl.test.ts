/**
 * `rebase db push` has to explain a missing pgvector as well as the boot does.
 *
 * The boot ensure runs every statement through an applier that appends
 * `vectorExtensionHint`; `applyVectorDdl` runs the whole file through one
 * `client.query` and used to let the raw driver error out. Since installing the
 * extension is opt-in, the *likeliest* thing a developer meets is exactly that
 * error on their first push — `type "vector" does not exist`, which names
 * neither the option nor the extension.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { applyVectorDdl } from "../src/cli-helpers";

const mockQuery = jest.fn();
jest.mock("pg", () => ({
    Client: jest.fn().mockImplementation(() => ({
        connect: jest.fn(),
        query: (...args: unknown[]) => mockQuery(...args),
        end: jest.fn()
    }))
}));

let drizzleDir: string;

beforeEach(() => {
    jest.clearAllMocks();
    drizzleDir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-vector-"));
});

afterEach(() => {
    fs.rmSync(drizzleDir, { recursive: true, force: true });
});

const writeVectorSql = (): void => {
    fs.writeFileSync(
        path.join(drizzleDir, "vector.sql"),
        `ALTER TABLE "public"."obs" ADD COLUMN IF NOT EXISTS "embedding" VECTOR(384);\n`
    );
};

describe("applyVectorDdl", () => {
    it("does nothing at all when the project declares no vector", async () => {
        await applyVectorDdl("postgres://localhost/db", drizzleDir);
        expect(mockQuery).not.toHaveBeenCalled();
    });

    it("applies the file when there is one", async () => {
        writeVectorSql();
        mockQuery.mockResolvedValue({ rows: [] });
        await applyVectorDdl("postgres://localhost/db", drizzleDir);
        expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("ADD COLUMN IF NOT EXISTS"));
    });

    it("names the opt-in when the type is missing", async () => {
        writeVectorSql();
        mockQuery.mockRejectedValue(new Error(`type "vector" does not exist`));

        await expect(applyVectorDdl("postgres://localhost/db", drizzleDir))
            .rejects.toThrow(/database\(\{ extensions: \["vector"\] \}\)/);
        // The original text survives: it is what a search engine and a bug
        // report will both carry.
        await expect(applyVectorDdl("postgres://localhost/db", drizzleDir))
            .rejects.toThrow(/type "vector" does not exist/);
    });

    it("explains the image and the grant when the install itself was refused", async () => {
        writeVectorSql();
        mockQuery.mockRejectedValue(new Error(`extension "vector" is not available`));
        await expect(applyVectorDdl("postgres://localhost/db", drizzleDir))
            .rejects.toThrow(/pgvector was declared and could not be installed/);
    });

    /**
     * A failure that has nothing to do with pgvector must not be dressed up as
     * one. Attaching the hint to everything would send the reader to install an
     * extension they already have over a permissions problem on their table.
     */
    it("leaves an unrelated failure exactly as the driver worded it", async () => {
        writeVectorSql();
        const original = new Error("permission denied for table obs");
        mockQuery.mockRejectedValue(original);
        await expect(applyVectorDdl("postgres://localhost/db", drizzleDir)).rejects.toBe(original);
    });
});
