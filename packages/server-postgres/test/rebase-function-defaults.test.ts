/**
 * `db push` refuses, before Atlas, a column whose DEFAULT calls a `rebase.*`
 * function: Atlas cannot build one (see `rebaseFunctionDefaults`). End to end
 * in `e2e/db-push-safety.test.ts`.
 */
import { rebaseFunctionDefaults, rebaseFunctionDefaultsProblem } from "../src/schema/generate-files";

const ddl = `CREATE TABLE IF NOT EXISTS "public"."memos" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "author" text DEFAULT rebase.uid(),
    "tenant" text DEFAULT (rebase.jwt() ->> 'tenant'),
    "body" text
);

CREATE TABLE IF NOT EXISTS "public"."plain" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "note" text DEFAULT 'rebase.uid() is just text here'
);`;

describe("rebaseFunctionDefaults", () => {
    it("finds every column whose default calls a rebase function, and nothing else", () => {
        expect(rebaseFunctionDefaults(ddl)).toEqual([
            { table: "public.memos", column: "author", expression: "rebase.uid()" },
            { table: "public.memos", column: "tenant", expression: "(rebase.jwt() ->> 'tenant')" }
            // Not `plain.note`: its default only mentions the function in a string.
        ]);
    });

    it("names the column and the remedy, and says nothing when there is none", () => {
        const problem = rebaseFunctionDefaultsProblem(ddl) ?? "";
        expect(problem).toMatch(/public\.memos\.author {2}DEFAULT rebase\.uid\(\)/);
        expect(problem).toMatch(/onCreateUser/);
        expect(rebaseFunctionDefaultsProblem(`CREATE TABLE "public"."t" (\n    "id" uuid DEFAULT gen_random_uuid()\n);`)).toBeUndefined();
    });
});
