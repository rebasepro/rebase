/**
 * An edit to a collection's security rules is a change, and the commit says so.
 *
 * Tightening Posts' select rule from `access: "public"` to `roles: ["admin"]` in
 * the Studio RLS editor was planned with no changes and no statements, and
 * committed as `chore(schema): no change`. The policies changed only at the
 * next boot (`ensureCollectionPolicies`). The audit trail is the feature, and
 * it recorded the opposite of what happened.
 */
import type { CollectionConfig } from "@rebasepro/types";
import { classifyCollectionChanges } from "../src/schema/classify-change";
import { commitMessage, generateSchemaCommit } from "../src/schema/generate-schema-commit";

const posts = (securityRules: unknown[]): CollectionConfig => ({
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        id: { type: "string", name: "Id", isId: "uuid" },
        title: { type: "string", name: "Title" }
    },
    securityRules
}) as unknown as CollectionConfig;

const PUBLIC = [{ name: "read", operation: "select", access: "public" }];
const ADMINS = [{ name: "read", operation: "select", roles: ["admin"] }];

describe("a security-rules edit", () => {
    it("is classified, safe, naming the collection", () => {
        const classified = classifyCollectionChanges([posts(PUBLIC)], [posts(ADMINS)]);
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
        expect(commit.message.split("\n")[0]).toMatch(/security rules.*posts|posts.*security rules/);
    });

    it("is not a change when the rules are only re-spelled into the same policies", () => {
        const respelled = [{ name: "read", operations: ["select"], access: "public" }];
        expect(classifyCollectionChanges([posts(PUBLIC)], [posts(respelled)]).changes).toEqual([]);
    });

    it("says what is in the commit when nothing else changed", () => {
        expect(commitMessage({
            changes: [{ kind: "change-security-rules", verdict: "safe", collection: "posts", detail: "x" }],
            verdict: "safe",
            applicable: true
        })).toMatch(/^feat\(schema\): change the security rules of posts/);
    });
});
