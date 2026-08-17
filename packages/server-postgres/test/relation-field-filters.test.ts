import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { integer, pgTable, PgDialect, primaryKey, serial, timestamp, varchar } from "drizzle-orm/pg-core";
import { CollectionConfig } from "@rebasepro/types";
import { ApiError } from "@rebasepro/server";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { DrizzleConditionBuilder } from "../src/utils/drizzle-conditions";

/**
 * Filtering by a *column of the related row* — `applications.status`.
 *
 * The sibling suite, `relation-filters.test.ts`, pins the filter that compares
 * the related row's **id**. This one pins the filter that compares one of its
 * columns, which is the shape every "who is waiting" queue is written in and
 * the one that previously could not be said at all.
 *
 * What these hold to:
 *
 *   - the predicate moves onto the target's column, and everything else about
 *     the subquery — correlation direction, local alias, no top-level join —
 *     stays exactly as the id filter has it;
 *   - a many-to-many reaches one table further than the id filter does, so its
 *     subquery joins the target to the junction *inside* the `EXISTS`;
 *   - the negative operators are `NOT EXISTS` of the **positive** predicate, so
 *     `==` and `!=` partition the rows;
 *   - a column the target does not have is a 400 naming the target's columns,
 *     never a dropped condition.
 */

const dialect = new PgDialect();
const render = (condition: { queryChunks: unknown[] } | any) => dialect.sqlToQuery(condition);

const talentsTable = pgTable("talents", {
    id: serial("id").primaryKey(),
    name: varchar("name").notNull()
});

const applicationsTable = pgTable("talent_applications", {
    id: serial("id").primaryKey(),
    status: varchar("status").notNull(),
    createdAt: timestamp("created_at"),
    talentId: integer("talent_id")
});

const skillsTable = pgTable("skills", {
    id: serial("id").primaryKey(),
    name: varchar("name").notNull(),
    level: integer("level")
});

const talentsSkillsTable = pgTable("talents_skills", {
    talent_id: integer("talent_id").notNull(),
    skill_id: integer("skill_id").notNull()
}, (table) => ({
    pk: primaryKey({ columns: [table.talent_id, table.skill_id] })
}));

const agenciesTable = pgTable("agencies", {
    id: serial("id").primaryKey(),
    name: varchar("name").notNull()
});

const applicationsCollection = {
    slug: "talent_applications",
    name: "Applications",
    properties: {
        status: { name: "Status", type: "string" },
        createdAt: { name: "Created", type: "date", columnName: "created_at" }
    }
} as unknown as CollectionConfig;

const skillsCollection = {
    slug: "skills",
    name: "Skills",
    properties: {
        name: { name: "Name", type: "string" },
        level: { name: "Level", type: "number" }
    }
} as unknown as CollectionConfig;

const agenciesCollection = {
    slug: "agencies",
    name: "Agencies",
    properties: { name: { name: "Name", type: "string" } }
} as unknown as CollectionConfig;

const talentsCollection: CollectionConfig = {
    slug: "talents",
    name: "Talents",
    properties: {
        name: { name: "Name", type: "string" },
        applications: {
            name: "Applications",
            type: "relation",
            relation: {
                kind: "hasMany",
                target: () => applicationsCollection,
                foreignKeyOnTarget: "talent_id"
            }
        },
        skills: {
            name: "Skills",
            type: "relation",
            relation: {
                kind: "manyToMany",
                target: () => skillsCollection,
                through: { table: "talents_skills", sourceColumn: "talent_id", targetColumn: "skill_id" }
            }
        },
        agency: {
            name: "Agency",
            type: "relation",
            relation: { kind: "belongsTo", target: () => agenciesCollection, localKey: "agency_id" }
        }
    }
};

// `belongsTo` puts its key on this row, so the table needs the column.
const talentsWithAgencyTable = pgTable("talents", {
    id: serial("id").primaryKey(),
    name: varchar("name").notNull(),
    agencyId: integer("agency_id")
});

const createRegistry = () => {
    const registry = { getTable: jest.fn() } as unknown as PostgresCollectionRegistry;
    (registry.getTable as jest.Mock).mockImplementation((tableName: string) => ({
        talents: talentsTable,
        talent_applications: applicationsTable,
        skills: skillsTable,
        talents_skills: talentsSkillsTable,
        agencies: agenciesTable
    } as Record<string, unknown>)[tableName as string]);
    return registry;
};

describe("filtering by a column of a related row", () => {

    let registry: PostgresCollectionRegistry;

    beforeEach(() => {
        registry = createRegistry();
    });

    const filterTalents = (filter: Record<string, unknown>, table = talentsTable) =>
        DrizzleConditionBuilder.buildFilterConditions(
            filter as never,
            table,
            "talents",
            { collection: talentsCollection, registry, sourceIdColumn: table.id }
        );

    describe("hasMany — the queue shape", () => {

        it("compiles `applications.status in [...]` into an EXISTS over the target", () => {
            const [condition] = filterTalents({
                "applications.status": ["in", ["applied", "reviewing", "interview"]]
            });
            const query = render(condition);
            expect(query.sql).toBe(
                'EXISTS (SELECT 1 FROM "talent_applications" AS "__rel_field" ' +
                'WHERE "__rel_field"."talent_id" = "talents"."id" ' +
                'AND "__rel_field"."status" IN ($1, $2, $3))'
            );
            expect(query.params).toEqual(["applied", "reviewing", "interview"]);
        });

        it("correlates to the outer row and qualifies the target with a local alias", () => {
            const query = render(filterTalents({ "applications.status": ["==", "applied"] })[0]);
            // The outer row's key stays qualified with its own table; everything
            // inside the subquery is qualified with the alias. Getting this
            // backwards compiles and returns plausible nonsense.
            expect(query.sql).toContain('"__rel_field"."talent_id" = "talents"."id"');
            expect(query.sql).toContain('"__rel_field"."status" = $1');
        });

        it("never joins at the top level — a join multiplies the outer rows", () => {
            const query = render(filterTalents({ "applications.status": ["==", "applied"] })[0]);
            expect(query.sql.startsWith("EXISTS (")).toBe(true);
        });

        it("resolves a column by its wire name when the column is named differently", () => {
            const query = render(filterTalents({ "applications.createdAt": [">=", "2026-01-01"] })[0]);
            expect(query.sql).toContain('"__rel_field"."created_at" >= $1');
        });

        it("accepts the ordering operators, which the id filter has no use for", () => {
            const query = render(filterTalents({ "applications.createdAt": ["<", "2026-06-01"] })[0]);
            expect(query.sql).toContain('"__rel_field"."created_at" < $1');
            expect(query.params).toEqual(["2026-06-01"]);
        });
    });

    describe("negation is NOT EXISTS of the positive predicate", () => {

        it("`!=` asks whether the value is absent, not whether some row differs", () => {
            const query = render(filterTalents({ "applications.status": ["!=", "hired"] })[0]);
            expect(query.sql).toBe(
                'NOT EXISTS (SELECT 1 FROM "talent_applications" AS "__rel_field" ' +
                'WHERE "__rel_field"."talent_id" = "talents"."id" AND "__rel_field"."status" = $1)'
            );
            // The wrong reading — `EXISTS (… AND status != 'hired')` — is true
            // of nearly every candidate with more than one application.
            expect(query.sql).not.toContain("!=");
        });

        it("`==` and `!=` partition the rows", () => {
            const positive = render(filterTalents({ "applications.status": ["==", "hired"] })[0]);
            const negative = render(filterTalents({ "applications.status": ["!=", "hired"] })[0]);
            expect(`NOT ${positive.sql}`).toBe(negative.sql);
        });

        it("`not-in` is NOT EXISTS of the membership test", () => {
            const query = render(filterTalents({ "applications.status": ["not-in", ["hired", "rejected"]] })[0]);
            expect(query.sql).toBe(
                'NOT EXISTS (SELECT 1 FROM "talent_applications" AS "__rel_field" ' +
                'WHERE "__rel_field"."talent_id" = "talents"."id" ' +
                'AND "__rel_field"."status" IN ($1, $2))'
            );
        });

        it("`not-like` is NOT EXISTS of the positive pattern", () => {
            const query = render(filterTalents({ "applications.status": ["not-like", "rejec%"] })[0]);
            expect(query.sql).toContain("NOT EXISTS");
            expect(query.sql).toContain('"__rel_field"."status" LIKE $1');
            expect(query.sql).not.toContain("NOT LIKE");
        });
    });

    describe("the empty list fails closed", () => {

        it("`in []` matches nothing rather than everything", () => {
            const query = render(filterTalents({ "applications.status": ["in", []] })[0]);
            // Dropping the condition would match every row — the inversion the
            // whole resolution path exists to prevent.
            expect(query.sql).toContain("AND FALSE");
            expect(query.sql.startsWith("EXISTS (")).toBe(true);
        });

        it("`not-in []` excludes nothing, which is every row", () => {
            const query = render(filterTalents({ "applications.status": ["not-in", []] })[0]);
            // `NOT EXISTS (… AND FALSE)` is true of every row, which is what
            // excluding nothing means.
            expect(query.sql.startsWith("NOT EXISTS (")).toBe(true);
            expect(query.sql).toContain("AND FALSE");
        });
    });

    describe("null on a related column", () => {

        it("`is-null` asks for a related row whose column is unset", () => {
            const query = render(filterTalents({ "applications.status": ["is-null", null] })[0]);
            expect(query.sql).toBe(
                'EXISTS (SELECT 1 FROM "talent_applications" AS "__rel_field" ' +
                'WHERE "__rel_field"."talent_id" = "talents"."id" AND "__rel_field"."status" IS NULL)'
            );
        });

        it("`is-not-null` asks for one where it is set — not the negation", () => {
            // Deliberately not complementary. The negation would be "no
            // application has an unset status", which is true of a candidate
            // with no applications at all — the very rows a queue excludes.
            const query = render(filterTalents({ "applications.status": ["is-not-null", null] })[0]);
            expect(query.sql.startsWith("EXISTS (")).toBe(true);
            expect(query.sql).toContain('"__rel_field"."status" IS NOT NULL');
        });
    });

    describe("manyToMany reaches one table further", () => {

        it("joins the target to the junction inside the EXISTS", () => {
            const query = render(filterTalents({ "skills.name": ["==", "welding"] })[0]);
            expect(query.sql).toBe(
                'EXISTS (SELECT 1 FROM "skills" AS "__rel_field" ' +
                'INNER JOIN "talents_skills" AS "__rel_field_junction" ' +
                'ON "__rel_field_junction"."skill_id" = "__rel_field"."id" ' +
                'WHERE "__rel_field_junction"."talent_id" = "talents"."id" ' +
                'AND "__rel_field"."name" = $1)'
            );
        });

        it("correlates from the junction, not from the target", () => {
            const query = render(filterTalents({ "skills.level": [">=", 3] })[0]);
            expect(query.sql).toContain('"__rel_field_junction"."talent_id" = "talents"."id"');
            expect(query.sql).toContain('"__rel_field"."level" >= $1');
        });

        it("negates the whole subquery, join and all", () => {
            const query = render(filterTalents({ "skills.name": ["!=", "welding"] })[0]);
            expect(query.sql.startsWith("NOT EXISTS (")).toBe(true);
            expect(query.sql).toContain("INNER JOIN");
        });
    });

    describe("belongsTo", () => {

        it("reaches the owner through its own foreign key", () => {
            const query = render(filterTalents(
                { "agency.name": ["ilike", "%staff%"] },
                talentsWithAgencyTable
            )[0]);
            expect(query.sql).toBe(
                'EXISTS (SELECT 1 FROM "agencies" AS "__rel_field" ' +
                'WHERE "__rel_field"."id" = "talents"."agency_id" ' +
                'AND "__rel_field"."name" ILIKE $1)'
            );
        });
    });

    describe("what is refused", () => {

        const expectBadRequest = (run: () => unknown, code: string) => {
            try {
                run();
                throw new Error("expected a bad request");
            } catch (error) {
                expect(error).toBeInstanceOf(ApiError);
                expect((error as ApiError).code).toBe(code);
            }
        };

        it("a column the target does not have is a 400 naming the target's columns", () => {
            expectBadRequest(
                () => filterTalents({ "applications.stauts": ["==", "applied"] }),
                "UNKNOWN_FILTER_FIELD"
            );
            try {
                filterTalents({ "applications.stauts": ["==", "applied"] });
            } catch (error) {
                // The message has to name the *target*, not the collection
                // being filtered — otherwise it sends the reader looking for a
                // column on the wrong table.
                expect((error as ApiError).message).toContain("talent_applications");
                expect((error as ApiError).message).toContain("status");
            }
        });

        it("a first segment that names no relation falls through to unknown-field", () => {
            // Not a relation path at all, so it gets the answer a typo gets.
            expectBadRequest(
                () => filterTalents({ "nonsense.status": ["==", "x"] }),
                "UNKNOWN_FILTER_FIELD"
            );
        });

        it("`ilike` on a non-text column is refused rather than left to fail at execution", () => {
            expectBadRequest(
                () => filterTalents({ "skills.level": ["ilike", "%3%"] }),
                "UNSUPPORTED_RELATION_FILTER_OPERATOR"
            );
        });

        it("a second hop is refused rather than read as a column with a dot in it", () => {
            expectBadRequest(
                () => filterTalents({ "applications.job.title": ["==", "welder"] }),
                "UNKNOWN_FILTER_FIELD"
            );
        });
    });

    describe("the id filter is untouched", () => {

        it("still compiles a bare relation key against the target's id", () => {
            const query = render(filterTalents({ applications: ["==", 7] })[0]);
            expect(query.sql).toContain('"__rel_filter"."id" = $1');
        });
    });
});
