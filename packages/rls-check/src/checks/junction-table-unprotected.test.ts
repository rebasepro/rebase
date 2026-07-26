import { describe, expect, it } from "vitest";

import { foreignKey, snapshot, table, type TableSpec } from "../../test/fixtures/snapshot";
import { junctionTableUnprotected } from "./junction-table-unprotected";

const endpoints = [
    table("public", "posts", { rlsEnabled: true }),
    table("public", "tags", { rlsEnabled: true })
];

const joinTable = (columns: NonNullable<TableSpec["columns"]>) => table("public", "posts_tags", { columns });

const fks = [
    foreignKey("public", "posts_tags", ["post_id"], "public", "posts"),
    foreignKey("public", "posts_tags", ["tag_id"], "public", "tags")
];

describe("junction-table-unprotected", () => {
    it("flags a two-key join table between two protected tables", () => {
        const findings = junctionTableUnprotected.run(
            snapshot({
                relations: [...endpoints, joinTable(["post_id", "tag_id"])],
                foreignKeys: fks
            })
        );

        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("high");
        expect(findings[0].confidence).toBe("heuristic");
        expect(findings[0].title).toContain("public.posts");
        expect(findings[0].title).toContain("public.tags");
        expect(findings[0].fix).toContain(
            'ALTER TABLE "public"."posts_tags" ENABLE ROW LEVEL SECURITY;'
        );
    });

    it("tolerates a surrogate key and timestamps", () => {
        const findings = junctionTableUnprotected.run(
            snapshot({
                relations: [
                    ...endpoints,
                    joinTable([
                        "id",
                        "post_id",
                        "tag_id",
                        "created_at",
                        { name: "expires", type: "timestamp with time zone" }
                    ])
                ],
                foreignKeys: fks
            })
        );

        expect(findings).toHaveLength(1);
    });

    it("does NOT flag a domain table that merely has two foreign keys", () => {
        const findings = junctionTableUnprotected.run(
            snapshot({
                relations: [
                    ...endpoints,
                    joinTable(["id", "post_id", "tag_id", "relevance_score", "note"])
                ],
                foreignKeys: fks
            })
        );

        expect(findings).toEqual([]);
    });

    it("does NOT flag when the join table already has RLS", () => {
        const findings = junctionTableUnprotected.run(
            snapshot({
                relations: [
                    ...endpoints,
                    table("public", "posts_tags", {
                        rlsEnabled: true,
                        columns: ["post_id", "tag_id"]
                    })
                ],
                foreignKeys: fks
            })
        );

        expect(findings).toEqual([]);
    });

    it("does NOT flag when an endpoint has no RLS — nothing is being circumvented", () => {
        const findings = junctionTableUnprotected.run(
            snapshot({
                relations: [
                    table("public", "posts", { rlsEnabled: true }),
                    table("public", "tags"),
                    joinTable(["post_id", "tag_id"])
                ],
                foreignKeys: fks
            })
        );

        expect(findings).toEqual([]);
    });

    it("does NOT flag a table with one foreign key, or three", () => {
        const one = junctionTableUnprotected.run(
            snapshot({
                relations: [...endpoints, joinTable(["post_id"])],
                foreignKeys: [fks[0]]
            })
        );
        expect(one).toEqual([]);

        const three = junctionTableUnprotected.run(
            snapshot({
                relations: [
                    ...endpoints,
                    table("public", "authors", { rlsEnabled: true }),
                    joinTable(["post_id", "tag_id", "author_id"])
                ],
                foreignKeys: [
                    ...fks,
                    foreignKey("public", "posts_tags", ["author_id"], "public", "authors")
                ]
            })
        );
        expect(three).toEqual([]);
    });

    it("does NOT flag a self-referencing edge table", () => {
        const findings = junctionTableUnprotected.run(
            snapshot({
                relations: [
                    table("public", "users", { rlsEnabled: true }),
                    table("public", "follows", { columns: ["follower_id", "followee_id"] })
                ],
                foreignKeys: [
                    foreignKey("public", "follows", ["follower_id"], "public", "users"),
                    foreignKey("public", "follows", ["followee_id"], "public", "users")
                ]
            })
        );

        expect(findings).toEqual([]);
    });
});
