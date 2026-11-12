import { canonicalSchemaPayload, computeSchemaVersion, LEGACY_SCHEMA_VERSION_PREFIX } from "../src/types/schema_version";
import type { TableDescriptor } from "../src/schema/descriptor";

/**
 * The schema version is computed from table descriptors. It must move exactly
 * when the compiled schema moves, and never because of the order tables were
 * exported in or what a hook's code does.
 */

const table = (slug: string, extra: Partial<TableDescriptor> = {}): TableDescriptor => ({
    name: slug,
    slug,
    table: slug,
    schema: "public",
    kind: "table",
    columns: [
        { key: "id", column: "id", type: { kind: "uuid" }, nullable: false, primaryKey: true },
        { key: "title", column: "title", type: { kind: "text" }, nullable: true }
    ],
    primaryKey: ["id"],
    relations: [],
    rls: { posture: "admin-only", rules: [], defaultPolicies: true },
    ...extra
});

describe("computeSchemaVersion", () => {
    it("is prefixed v2, which a v1 (collection) stamp can never equal", () => {
        const version = computeSchemaVersion([table("posts")]);
        expect(version).toMatch(/^v2:[0-9a-f]{16}$/);
        expect(version.startsWith(LEGACY_SCHEMA_VERSION_PREFIX)).toBe(false);
    });

    it("does not depend on the order the tables come in, or on key order", () => {
        const a = table("authors");
        const b = table("posts");
        expect(computeSchemaVersion([a, b])).toBe(computeSchemaVersion([b, a]));
        const { name, slug, ...rest } = b;
        const reordered: TableDescriptor = { ...rest, slug, name };
        expect(canonicalSchemaPayload([reordered])).toBe(canonicalSchemaPayload([b]));
    });

    it("moves when a column changes", () => {
        const base = table("posts");
        const changed = table("posts", {
            columns: [...base.columns, { key: "views", column: "views", type: { kind: "integer" }, nullable: true }]
        });
        expect(computeSchemaVersion([changed])).not.toBe(computeSchemaVersion([base]));
    });

    it("moves when a hook is added — hooks are presence flags, never code", () => {
        expect(computeSchemaVersion([table("posts", { hooks: { afterRead: true } })]))
            .not.toBe(computeSchemaVersion([table("posts")]));
        expect(canonicalSchemaPayload([table("posts", { hooks: { afterRead: true } })])).toContain("\"afterRead\":true");
    });

    it("moves when the row-level security posture changes", () => {
        const opened = table("posts", {
            rls: { posture: "rules", rules: [{ operation: "select", access: "public" }], defaultPolicies: true }
        });
        expect(computeSchemaVersion([opened])).not.toBe(computeSchemaVersion([table("posts")]));
    });

    it("of no tables is stable", () => {
        expect(computeSchemaVersion([])).toBe(computeSchemaVersion([]));
    });
});
