/**
 * Both ends of a link must derive the same `relationName`.
 *
 * Drizzle pairs an owning `one()` with its inverse `many()` by that string and
 * by nothing else, and the two are computed by different callers holding
 * different tables — the schema generator writing a file, and the runtime
 * building relations from the live catalogue. If they ever disagree, the
 * relational query path throws "There is not enough information to infer
 * relation" or, worse, silently loads nothing.
 */
import { describe, expect, it } from "@jest/globals";
import { col, defineTable, rel, type TableDescriptor } from "@rebasepro/types";
import { compileSchema } from "@rebasepro/common";

import { servedKeyOf, tableRelationName } from "../src/schema/relation-names";

const companies = defineTable("companies", {
    columns: { id: col.uuid().primaryKey().defaultRandom() },
    relations: { jobs: rel.hasMany(() => jobs, { foreignKey: "company_id" }) },
    rls: "admin-only"
});

const jobs = defineTable("jobs", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        // The FK column, declared as its own column with an explicit SQL name
        // — the case where the key and the column differ.
        companyId: col.uuid("company_id")
    },
    relations: { employer: rel.belongsTo(() => companies, { localKey: "company_id" }) },
    rls: "admin-only"
});

const tags = defineTable("tags", {
    columns: { id: col.uuid().primaryKey().defaultRandom() },
    rls: "admin-only"
});

const posts = defineTable("posts", {
    columns: { id: col.uuid().primaryKey().defaultRandom() },
    relations: { tags: rel.manyToMany(() => tags) },
    rls: "admin-only"
});

const descriptors = compileSchema([companies, jobs, tags, posts]).map(table => table.descriptor);
const bySlug = new Map(descriptors.map(descriptor => [descriptor.slug, descriptor]));
const tableOf = (slug: string): TableDescriptor => {
    const found = bySlug.get(slug);
    if (!found) throw new Error(`no table ${slug}`);
    return found;
};
const nameOf = (slug: string, relation: string): string => {
    const source = tableOf(slug);
    const found = source.relations.find(r => r.name === relation);
    if (!found) throw new Error(`no relation ${slug}.${relation}`);
    return tableRelationName(found, source, tableOf);
};

describe("tableRelationName", () => {
    it("names a link after the table that carries the foreign key and its key", () => {
        expect(nameOf("jobs", "employer")).toBe("jobs_companyId");
    });

    it("derives the same name from the inverse side, which holds neither", () => {
        // `companies.jobs` knows only the column on the target. Reaching the
        // same string from there is the entire contract.
        expect(nameOf("companies", "jobs")).toBe(nameOf("jobs", "employer"));
    });

    it("uses the key, not the column, so an explicit SQL name cannot split the pair", () => {
        expect(nameOf("jobs", "employer")).not.toContain("company_id");
    });

    it("keeps the local name for a many-to-many, which is named through its junction", () => {
        expect(nameOf("posts", "tags")).toBe("tags");
    });
});

describe("servedKeyOf", () => {
    it("answers the column's key, and the camelCase of a column the table does not describe", () => {
        expect(servedKeyOf(tableOf("jobs"), "company_id")).toBe("companyId");
        expect(servedKeyOf(tableOf("jobs"), "legacy_note")).toBe("legacyNote");
    });
});
