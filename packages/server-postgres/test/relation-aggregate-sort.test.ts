import { describe, expect, it, beforeEach, jest } from "@jest/globals";
import { AnyPgColumn, integer, pgTable, PgDialect, primaryKey, serial, timestamp, varchar } from "drizzle-orm/pg-core";
import { SQL } from "drizzle-orm";
import { CollectionConfig, encodeRelationAggregateSort, parseRelationAggregateSort } from "@rebasepro/types";
import { ApiError } from "@rebasepro/server";
import { FetchService } from "../src/services/FetchService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { DrizzleConditionBuilder } from "../src/utils/drizzle-conditions";

/**
 * Ordering by an aggregate over a to-many relation — "candidates, oldest
 * waiting first".
 *
 * This is the half of a queue that cannot be worked around client-side. A
 * relation *filter* can be approximated by denormalising a flag onto the row;
 * an *ordering* cannot be approximated at all once the result set is paged,
 * because the client only ever holds one page and the page was chosen by the
 * wrong order.
 *
 * What these hold to:
 *
 *   - the sort compiles to a correlated scalar subquery, not a join;
 *   - rows the relation reaches nothing from land at a *defined* end — NULLS
 *     LAST ascending, NULLS FIRST descending — written out rather than
 *     inherited, because the keyset comparison encodes the same placement and
 *     the two have to agree;
 *   - the id stays the last key, so the order is total;
 *   - a cursor pages over it by recomputing the cursor row's value in SQL,
 *     since there is no stored value to carry.
 */

const dialect = new PgDialect();
const render = (expression: SQL) => dialect.sqlToQuery(expression);

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
    level: integer("level")
});

const talentsSkillsTable = pgTable("talents_skills", {
    talent_id: integer("talent_id").notNull(),
    skill_id: integer("skill_id").notNull()
}, (table) => ({
    pk: primaryKey({ columns: [table.talent_id, table.skill_id] })
}));

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
    properties: { level: { name: "Level", type: "number" } }
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
        }
    }
};

const createRegistry = () => {
    const registry = { getTable: jest.fn() } as unknown as PostgresCollectionRegistry;
    (registry.getTable as jest.Mock).mockImplementation((tableName: string) => ({
        talents: talentsTable,
        talent_applications: applicationsTable,
        skills: skillsTable,
        talents_skills: talentsSkillsTable
    } as Record<string, unknown>)[tableName as string]);
    return registry;
};

describe("the wire spelling of an aggregate sort key", () => {

    it("round-trips the object through its string form", () => {
        const spec = { relation: "applications", field: "created_at", agg: "min" } as const;
        expect(encodeRelationAggregateSort(spec)).toBe("min(applications.created_at)");
        expect(parseRelationAggregateSort("min(applications.created_at)")).toEqual(spec);
    });

    it("spells a bare count without a field", () => {
        expect(encodeRelationAggregateSort({ relation: "applications", agg: "count" }))
            .toBe("count(applications)");
        expect(parseRelationAggregateSort("count(applications)"))
            .toEqual({ relation: "applications", agg: "count" });
    });

    it("carries no `:` or `,`, which is what keeps it safe in the wire shorthand", () => {
        // `serializeOrderBy` spells a single key `"key:direction"`. A key
        // containing a colon would be split in the wrong place and arrive as a
        // different sort.
        const key = encodeRelationAggregateSort({ relation: "applications", field: "created_at", agg: "min" });
        expect(key).not.toContain(":");
        expect(key).not.toContain(",");
    });

    it("reads an ordinary column name as not an aggregate", () => {
        // Asked of every sort key to find out which kind it is, so a plain
        // column must not be an error.
        expect(parseRelationAggregateSort("created_at")).toBeUndefined();
        expect(parseRelationAggregateSort("_score")).toBeUndefined();
    });

    it("refuses a function with nothing to aggregate", () => {
        // A key that parsed to a half-built sort would resolve to no
        // expression and be dropped — leaving the rows unsorted while the
        // caller believes otherwise. `count` is the one that means something
        // on its own.
        expect(parseRelationAggregateSort("min(applications)")).toBeUndefined();
        expect(parseRelationAggregateSort("sum(applications)")).toBeUndefined();
        expect(parseRelationAggregateSort("count(applications)")).toBeDefined();
    });

    it("refuses a function it does not have", () => {
        expect(parseRelationAggregateSort("median(applications.score)")).toBeUndefined();
        expect(parseRelationAggregateSort("array_agg(applications.status)")).toBeUndefined();
    });
});

describe("compiling an aggregate sort to SQL", () => {

    let registry: PostgresCollectionRegistry;

    beforeEach(() => {
        registry = createRegistry();
    });

    const expression = (key: string, cursorId?: unknown) =>
        DrizzleConditionBuilder.buildRelationAggregateExpression(
            parseRelationAggregateSort(key)!,
            talentsTable,
            talentsCollection,
            registry,
            talentsTable.id,
            "talents",
            cursorId
        );

    it("compiles `min(applications.created_at)` into a correlated scalar subquery", () => {
        const query = render(expression("min(applications.created_at)"));
        expect(query.sql).toBe(
            '(SELECT min("__rel_agg"."created_at") FROM "talent_applications" AS "__rel_agg" ' +
            'WHERE "__rel_agg"."talent_id" = "talents"."id")'
        );
    });

    it("compiles a bare count over the related rows", () => {
        const query = render(expression("count(applications)"));
        expect(query.sql).toBe(
            '(SELECT count(*) FROM "talent_applications" AS "__rel_agg" ' +
            'WHERE "__rel_agg"."talent_id" = "talents"."id")'
        );
    });

    it("counts non-null values when a column is named", () => {
        const query = render(expression("count(applications.status)"));
        expect(query.sql).toContain('count("__rel_agg"."status")');
    });

    it("joins the junction for a many-to-many", () => {
        const query = render(expression("avg(skills.level)"));
        expect(query.sql).toBe(
            '(SELECT avg("__rel_agg"."level") FROM "skills" AS "__rel_agg" ' +
            'INNER JOIN "talents_skills" AS "__rel_agg_junction" ' +
            'ON "__rel_agg_junction"."skill_id" = "__rel_agg"."id" ' +
            'WHERE "__rel_agg_junction"."talent_id" = "talents"."id")'
        );
    });

    it("resolves a column by its wire name", () => {
        const query = render(expression("max(applications.createdAt)"));
        expect(query.sql).toContain('max("__rel_agg"."created_at")');
    });

    it("never interpolates the function name from the key", () => {
        // The function comes off a five-member union the parser validated, and
        // is written out as a constant rather than spliced from the request.
        const query = render(expression("min(applications.created_at)"));
        expect(query.params).toEqual([]);
    });

    describe("pinned to a cursor id", () => {

        it("stops being correlated, so it references no outer column", () => {
            const query = render(expression("min(applications.created_at)", 42));
            expect(query.sql).toBe(
                '(SELECT min("__rel_agg"."created_at") FROM "talent_applications" AS "__rel_agg" ' +
                'WHERE "__rel_agg"."talent_id" = $1)'
            );
            expect(query.params).toEqual([42]);
            // No reference to the outer row at all — which is what lets
            // Postgres evaluate it once for the whole statement.
            expect(query.sql).not.toContain('"talents"."id"');
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

        it("a relation the collection does not have", () => {
            expectBadRequest(
                () => expression("min(nonsense.created_at)"),
                "UNKNOWN_ORDER_BY_FIELD"
            );
        });

        it("a column the target does not have, naming the target's columns", () => {
            expectBadRequest(
                () => expression("min(applications.creaetd_at)"),
                "UNKNOWN_ORDER_BY_FIELD"
            );
            try {
                expression("min(applications.creaetd_at)");
            } catch (error) {
                expect((error as ApiError).message).toContain("talent_applications");
                // The list is of *wire* keys, which is what a caller writes —
                // `createdAt`, not the `created_at` the column is called.
                expect((error as ApiError).message).toContain("createdAt");
            }
        });
    });
});

describe("where the rows with nothing to aggregate land", () => {

    const service = new FetchService({} as never, new PostgresCollectionRegistry());
    const orderExpressions = (
        keys: { field: string; direction: "asc" | "desc"; target: AnyPgColumn | SQL }[]
    ): SQL[] => (service as unknown as {
        buildOrderExpressions(k: unknown[], idField: AnyPgColumn): SQL[]
    }).buildOrderExpressions(keys, talentsTable.id);

    it("puts NULLs last ascending and first descending, explicitly", () => {
        // Postgres already defaults this way, so the clause changes no query —
        // but `buildKeysetComparison` encodes the same placement, and an
        // invariant two functions depend on is stated in both.
        const [ascending] = orderExpressions([
            { field: "min(applications.created_at)", direction: "asc", target: talentsTable.name }
        ]);
        expect(render(ascending).sql).toContain("ASC NULLS LAST");

        const [descending] = orderExpressions([
            { field: "min(applications.created_at)", direction: "desc", target: talentsTable.name }
        ]);
        expect(render(descending).sql).toContain("DESC NULLS FIRST");
    });

    it("keeps the id as the final key, so the order is total", () => {
        const expressions = orderExpressions([
            { field: "min(applications.created_at)", direction: "asc", target: talentsTable.name }
        ]);
        // Two keys: the caller's, then the id. A cursor over a non-total order
        // repeats and skips rows among the ties.
        expect(expressions).toHaveLength(2);
        expect(render(expressions[1]).sql).toContain('"talents"."id" desc');
    });
});

describe("paging over an aggregate sort", () => {

    let registry: PostgresCollectionRegistry;

    beforeEach(() => {
        registry = createRegistry();
    });

    const keysetFor = (direction: "asc" | "desc") => {
        const service = new FetchService({} as never, registry);
        const spec = parseRelationAggregateSort("min(applications.created_at)")!;
        const target = DrizzleConditionBuilder.buildRelationAggregateExpression(
            spec, talentsTable, talentsCollection, registry, talentsTable.id, "talents"
        );
        const cursorTarget = DrizzleConditionBuilder.buildRelationAggregateExpression(
            spec, talentsTable, talentsCollection, registry, talentsTable.id, "talents", 42
        );
        return render((service as unknown as {
            buildKeysetComparison(
                keys: unknown[], values: unknown[], idField: AnyPgColumn, cursorId: unknown
            ): SQL
        }).buildKeysetComparison(
            [{ field: "min(applications.created_at)", direction, target, cursorTarget }],
            [null],
            talentsTable.id,
            42
        ));
    };

    it("recomputes the cursor row's value in SQL rather than reading it off the cursor", () => {
        const query = keysetFor("asc");
        // The aggregate is not stored on the row, so the cursor never carried
        // it and never could. Both the outer expression and the pinned one
        // appear in the comparison.
        expect(query.sql).toContain('"__rel_agg"."talent_id" = "talents"."id"');
        expect(query.sql).toContain('"__rel_agg"."talent_id" = $');
    });

    it("keeps both branches of the null test in the statement, ascending", () => {
        const query = keysetFor("asc");
        // Whether the cursor row's aggregate is NULL is a question only SQL can
        // answer, so the comparison cannot choose a branch in JavaScript the
        // way a stored value lets it.
        expect(query.sql).toContain("is null");
        expect(query.sql).toContain("is not null");
        expect(query.sql).toContain(">");
        // NULLS LAST: a non-null cursor row still has the NULLs ahead of it.
        expect(query.sql).toContain("or");
    });

    it("ends on the id, descending, matching the ORDER BY", () => {
        const query = keysetFor("desc");
        expect(query.sql).toContain('"talents"."id" < $');
    });

    it("compares with `<` descending and `>` ascending", () => {
        expect(keysetFor("asc").sql).toContain(">");
        expect(keysetFor("desc").sql).toContain("<");
    });
});
