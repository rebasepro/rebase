/**
 * An edit to a collection's security rules is a change, and the commit says so.
 *
 * Tightening Posts' select rule from `access: "public"` to `roles: ["admin"]` in
 * the Studio RLS editor was planned with no changes and no statements, and
 * committed as `chore(schema): no change`. The policies changed only at the
 * next boot (`ensureTablePolicies`). The audit trail is the feature, and
 * it recorded the opposite of what happened.
 */
import type { CollectionConfig, SecurityRule } from "@rebasepro/types";
import { classifyEditedTables as classifyCompiledTables, commitMessage, generateSchemaCommit as generateCompiledCommit } from "../src/schema/generate-schema-commit";
import { compiledFromLegacy } from "./helpers/edited-tables";

/** The fixtures compiled, as the server hands the planner both sides. */
const classifyEditedTables = (before: Parameters<typeof compiledFromLegacy>[0], after: Parameters<typeof compiledFromLegacy>[0], facts?: Parameters<typeof classifyCompiledTables>[2]) =>
    classifyCompiledTables(compiledFromLegacy(before), compiledFromLegacy(after), facts);

/** {@link generateCompiledCommit} over the fixtures compiled, as the server hands the planner both sides. */
const generateSchemaCommit = (input: Omit<Parameters<typeof generateCompiledCommit>[0], "before" | "after"> & { before: Parameters<typeof compiledFromLegacy>[0]; after: Parameters<typeof compiledFromLegacy>[0] }) =>
    generateCompiledCommit({ ...input, before: compiledFromLegacy(input.before), after: compiledFromLegacy(input.after) });

const posts = (securityRules: SecurityRule[]): CollectionConfig => ({
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        id: { type: "string", name: "Id", isId: "uuid" },
        title: { type: "string", name: "Title" }
    },
    securityRules
});

const PUBLIC: SecurityRule[] = [{ name: "read", operation: "select", access: "public" }];
const ADMINS: SecurityRule[] = [{ name: "read", operation: "select", roles: ["admin"] }];

describe("a security-rules edit", () => {
    it("is classified, safe, naming the collection", () => {
        const classified = classifyEditedTables([posts(PUBLIC)], [posts(ADMINS)]);
        expect(classified.changes).toHaveLength(1);
        expect(classified.changes[0]).toMatchObject({
            kind: "change-security-rules",
            verdict: "safe",
            collection: "posts"
        });
        expect(classified.changes[0].detail).toMatch(/next start/);
    });

    it("is committed under a subject that names it", async () => {
        const commit = await generateSchemaCommit({ before: [posts(PUBLIC)], after: [posts(ADMINS)] });
        expect(commit.message).not.toMatch(/no change/);
        expect(commit.message.split("\n")[0]).toMatch(/rls of posts/);
    });

    it("is not a change when the rules are only re-spelled into the same policies", () => {
        const respelled: SecurityRule[] = [{ name: "read", operations: ["select"], access: "public" }];
        expect(classifyEditedTables([posts(PUBLIC)], [posts(respelled)]).changes).toEqual([]);
    });

    it("says what is in the commit when nothing else changed", () => {
        expect(commitMessage({
            changes: [{ kind: "change-security-rules", verdict: "safe", collection: "posts", detail: "x" }],
            verdict: "safe",
            applicable: true
        })).toMatch(/^feat\(schema\): change the rls of posts/);
    });
});
