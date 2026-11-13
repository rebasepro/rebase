import { describe, expect, it } from "@jest/globals";
import type { TableDescriptor } from "@rebasepro/types";
import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";

import { introspectedDescriptors } from "../src/schema/introspected-tables";

/**
 * The descriptors an introspecting driver reports are what the server serves
 * for a project with no `backend/schema` — taken as they are, checked against
 * the collections served beside them, with the auth secrets made private.
 */

const descriptor = (slug: string, keys: string[] = ["id"]): TableDescriptor => ({
    name: slug, slug, table: slug, schema: "public", kind: "table",
    columns: keys.map((key, index) => ({ key, column: key, type: { kind: "text" }, nullable: index !== 0, ...(index === 0 ? { primaryKey: true as const } : {}) })),
    primaryKey: [keys[0]],
    relations: [],
    rls: { posture: "rules", rules: [], defaultPolicies: false }
});

const collection = (slug: string): LegacyCollectionConfig => ({ slug, name: slug, properties: {} });

describe("introspectedDescriptors", () => {
    it("takes every driver's descriptors as they are", () => {
        const users = descriptor("users");
        const posts = descriptor("posts");
        const out = introspectedDescriptors([
            { driver: "a", collections: [collection("users")], tables: [users] },
            { driver: "b", collections: [collection("posts")], tables: [posts] }
        ]);
        expect(out).toEqual([users, posts]);
    });

    it("makes the columns the auth-secret exclusion stripped private", () => {
        const out = introspectedDescriptors(
            [{ driver: "a", collections: [collection("users")], tables: [descriptor("users", ["id", "email", "password_hash"])] }],
            [{ slug: "users", columns: ["password_hash"] }]
        );
        expect(out[0].columns.map(column => [column.key, column.private ?? false])).toEqual([
            ["id", false],
            ["email", false],
            ["password_hash", true]
        ]);
    });

    it("refuses a driver that serves tables it did not describe, naming it", () => {
        expect(() => introspectedDescriptors([{ driver: "pg", collections: [collection("a")], tables: undefined }]))
            .toThrow(/Driver "pg" introspected 1 table\(s\) and described none of them/);
        expect(() => introspectedDescriptors([{ driver: "pg", collections: [collection("a"), collection("b")], tables: [descriptor("a"), descriptor("c")] }]))
            .toThrow(/served without a descriptor: b; described but not served: c/);
    });

    it("skips a driver that found nothing", () => {
        expect(introspectedDescriptors([{ driver: "pg", collections: [], tables: undefined }])).toEqual([]);
    });
});
