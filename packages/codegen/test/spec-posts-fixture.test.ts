import { describe, it, expect } from "@jest/globals";
import * as fs from "node:fs";
import * as path from "node:path";
import { compileTables } from "@rebasepro/common";
import { generateTypedefs } from "../src/generate-types";
import { defaultRls, posts, tags, users } from "../../types/test/schema/fixtures/spec-posts.schema";

/**
 * The generated `Database` the `DatabaseOf` agreement test
 * (`packages/types/test/schema/database-of.test.ts`) compares against is this
 * generator's output for the spec's §4.1 schema, checked in because a type
 * test cannot run the generator. To refresh it after a deliberate change:
 *
 *     REBASE_WRITE_FIXTURE=1 pnpm --filter @rebasepro/codegen exec jest test/spec-posts-fixture.test.ts
 */
const FIXTURE = path.resolve(__dirname, "../../types/test/schema/fixtures/spec-posts.database.ts");

describe("the spec §4.1 generated-Database fixture", () => {
    it("is what the generator emits for the spec's schema", () => {
        const generated = generateTypedefs(compileTables([users, tags, posts], { defaultRls }));
        if (process.env.REBASE_WRITE_FIXTURE === "1") fs.writeFileSync(FIXTURE, generated, "utf-8");
        expect(fs.existsSync(FIXTURE) ? fs.readFileSync(FIXTURE, "utf-8") : "").toBe(generated);
    });
});
