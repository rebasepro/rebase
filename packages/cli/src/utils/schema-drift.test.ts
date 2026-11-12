/**
 * Every source file under `backend/schema` is a schema edit.
 *
 * The old watcher had to tell a Postgres collection from a Firestore one, and
 * a top-level collection file from a nested helper the flat loader never read.
 * Neither question exists any more: Firestore and presentation live in
 * `frontend/src/cms`, and the loader imports `index.ts`, which reaches every
 * file it imports at any depth.
 */
import path from "path";
import { describe, expect, it } from "vitest";

import { isSchemaSourceFile } from "./schema-drift";

describe("isSchemaSourceFile", () => {
    it("counts every module, index.ts included", () => {
        for (const file of ["posts.ts", "index.ts", "index.js", "users.mts", "legacy.mjs", "helpers.tsx"]) {
            expect(isSchemaSourceFile(file), file).toBe(true);
        }
    });

    it("counts a module in a subdirectory — index.ts can import it", () => {
        expect(isSchemaSourceFile("billing/invoices.ts")).toBe(true);
        expect(isSchemaSourceFile(path.join("billing", "lines", "items.ts"))).toBe(true);
    });

    it("ignores what no import of the schema reaches", () => {
        for (const file of ["posts.test.ts", "posts.spec.ts", "types.d.ts", "types.d.mts", ".posts.ts.swp", "._posts.ts", ".cache/posts.ts", "README.md", "seed.json"]) {
            expect(isSchemaSourceFile(file), file).toBe(false);
        }
    });
});
