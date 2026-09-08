/**
 * Both ends of a link must derive the same `relationName`.
 *
 * Drizzle pairs an owning `one()` with its inverse `many()` by that string and
 * by nothing else, and the two are computed by different callers holding
 * different collections — the schema generator writing a file, and the runtime
 * building relations from the live catalogue. If they ever disagree, the
 * relational query path throws "There is not enough information to infer
 * relation" or, worse, silently loads nothing.
 */
import { describe, expect, it } from "@jest/globals";
import type { CollectionConfig } from "@rebasepro/types";
import { resolveCollectionRelations } from "@rebasepro/common";

import { sharedRelationName } from "../src/schema/relation-names";

const companies = {
    slug: "companies",
    table: "companies",
    name: "Companies",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        jobs: {
            type: "relation",
            name: "Jobs",
            relation: { kind: "hasMany", target: () => jobs, relationName: "jobs" }
        }
    }
} as unknown as CollectionConfig;

const jobs = {
    slug: "jobs",
    table: "jobs",
    name: "Jobs",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        // The FK column, declared as its own property with an explicit column
        // name — the case where the wire name and the column differ.
        companyId: { name: "Company", type: "string", columnName: "company_id" },
        employer: {
            type: "relation",
            name: "Employer",
            relation: { kind: "belongsTo", target: () => companies, relationName: "employer", localKey: "company_id" }
        }
    }
} as unknown as CollectionConfig;

const relationOf = (collection: CollectionConfig, key: string) =>
    resolveCollectionRelations(collection)[key];

describe("sharedRelationName", () => {
    it("names a link after the table that carries the foreign key and its wire name", () => {
        expect(sharedRelationName(relationOf(jobs, "employer"), jobs)).toBe("jobs_companyId");
    });

    it("derives the same name from the inverse side, which holds neither", () => {
        // `companies.jobs` knows only the column on the target. Reaching the
        // same string from there is the entire contract.
        expect(sharedRelationName(relationOf(companies, "jobs"), companies))
            .toBe(sharedRelationName(relationOf(jobs, "employer"), jobs));
    });

    it("uses the wire name, not the column, so `columnName` cannot split the pair", () => {
        // Built from `company_id` the two sides would still agree — but the
        // Drizzle object is keyed by the wire name, and a name derived from the
        // column would differ between two collections describing one link where
        // only one of them declares `columnName`.
        expect(sharedRelationName(relationOf(jobs, "employer"), jobs)).not.toContain("company_id");
    });

    it("keeps the local name for a many-to-many, which is named through its junction", () => {
        const tags = {
            slug: "tags", table: "tags", name: "Tags",
            properties: { id: { name: "ID", type: "string", isId: "uuid" } }
        } as unknown as CollectionConfig;
        const posts = {
            slug: "posts", table: "posts", name: "Posts",
            properties: {
                id: { name: "ID", type: "string", isId: "uuid" },
                tags: { type: "relation", name: "Tags", relation: { kind: "manyToMany", target: () => tags, relationName: "tags" } }
            }
        } as unknown as CollectionConfig;

        expect(sharedRelationName(relationOf(posts, "tags"), posts)).toBe("tags");
    });

    it("falls back to the local name when the target cannot be resolved", () => {
        const broken = {
            slug: "broken", table: "broken", name: "Broken",
            properties: { id: { name: "ID", type: "string", isId: "uuid" } }
        } as unknown as CollectionConfig;

        const relation = {
            kind: "hasMany" as const,
            relationName: "orphans",
            foreignKeyOnTarget: "broken_id",
            target: () => { throw new Error("circular import"); }
        };

        expect(sharedRelationName(relation as never, broken)).toBe("orphans");
    });
});
