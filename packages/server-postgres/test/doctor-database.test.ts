/**
 * `rebase doctor --database`: which tables it treats as Rebase's, and how it
 * prints what the preflight found.
 */
import type { CollectionConfig } from "@rebasepro/types";
import { managedTablesOf, preflightSchemasOf, preflightStatus, renderPreflightFindings } from "../src/schema/doctor-database";
import type { PreflightFinding } from "../src/security/database-preflight";

// eslint-disable-next-line no-control-regex
const plain = (lines: string[]): string => lines.join("\n").replace(/\u001b\[[0-9;]*m/g, "");

const tags = {
    slug: "tags",
    name: "Tags",
    properties: { id: { name: "ID", type: "string", isId: "uuid" } }
} as unknown as CollectionConfig;

const posts = {
    slug: "blog_posts",
    table: "posts",
    schema: "content",
    name: "Posts",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        tags: {
            name: "Tags",
            type: "relation",
            relation: {
                kind: "manyToMany",
                target: () => tags,
                relationName: "tags",
                through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" }
            }
        }
    }
} as unknown as CollectionConfig;

describe("managedTablesOf", () => {
    it("lists each collection's table in its schema, and the junctions", () => {
        expect(managedTablesOf([posts, tags])).toEqual([
            { schema: "content", table: "posts" },
            { schema: "public", table: "tags" },
            { schema: "public", table: "posts_tags" }
        ]);
    });

    it("is empty for a project with no collections", () => {
        expect(managedTablesOf([])).toEqual([]);
    });
});

describe("preflightSchemasOf", () => {
    it("is public, rebase and every schema a collection names", () => {
        expect(preflightSchemasOf([posts, tags])).toEqual(["public", "rebase", "content"]);
        expect(preflightSchemasOf([])).toEqual(["public", "rebase"]);
    });
});

describe("renderPreflightFindings", () => {
    const findings: PreflightFinding[] = [
        { level: "ok", check: "Request role \"rebase_user\"", detail: "Exists." },
        { level: "warn", check: "Tables Rebase does not serve", detail: "3 table(s).", setting: "rls.grants = \"managed\"" },
        { level: "fail", check: "Request role \"x\"", detail: "Does not exist.", sql: "CREATE ROLE x;\nGRANT x TO app;" },
        { level: "warn", check: "Who can connect", detail: "PUBLIC holds CONNECT.", sql: "REVOKE CONNECT ON DATABASE \"d\" FROM PUBLIC;", setting: "rls.sharedRole = \"refuse\"" }
    ];

    it("groups failures first, then warnings, then what is fine", () => {
        const text = plain(renderPreflightFindings(findings, { roles: ["rebase_user"], nonDefaults: [] }));
        const fail = text.indexOf("Needs fixing");
        const warn = text.indexOf("Worth a look");
        const ok = text.indexOf("Fine");
        expect(fail).toBeGreaterThan(-1);
        expect(fail).toBeLessThan(warn);
        expect(warn).toBeLessThan(ok);
        expect(text).toContain("The other rls settings are at their defaults.");
    });

    it("shows the SQL under its finding, and the setting as the other way out", () => {
        const text = plain(renderPreflightFindings(findings, { roles: ["x"], nonDefaults: ["requestRole=x"] }));
        expect(text).toContain("✗ Request role \"x\": Does not exist.\n      CREATE ROLE x;\n      GRANT x TO app;");
        expect(text).toContain("REVOKE CONNECT ON DATABASE \"d\" FROM PUBLIC;\n      or set: rls.sharedRole = \"refuse\"");
        expect(text).toContain("3 table(s).\n      set: rls.grants = \"managed\"");
        expect(text).toContain("Non-default settings: requestRole=x.");
    });
});

describe("preflightStatus", () => {
    it("fails only on a failure", () => {
        expect(preflightStatus([{ level: "warn", check: "a", detail: "b" }])).toBe("ok");
        expect(preflightStatus([{ level: "fail", check: "a", detail: "b" }, { level: "ok", check: "c", detail: "d" }])).toBe("problems");
        expect(preflightStatus([])).toBe("ok");
    });
});
