/**
 * Turning `mode: "hybrid"` on is a deploy, not a table rewrite.
 *
 * Every other knob in a `search` block feeds the *stored* generated column, so
 * changing one after the column exists is refused at boot — rebuilding a STORED
 * generated column rewrites the whole table under an ACCESS EXCLUSIVE lock and
 * rebuilds its GIN index, which an unattended boot may not schedule on anyone's
 * behalf (`searchDriftMessage`). That refusal is what a new mode had to be
 * designed around: a search mode nobody with an existing collection can adopt
 * is a search mode for new databases only.
 *
 * So `mode` is query-side. It changes the WHERE clause and nothing about the
 * column — not its expression, not its fingerprint, not its index — and this
 * file is what holds that true. If someone later folds `mode` into the stored
 * expression (the obvious way to make the substring half index-backed), the
 * first two tests here fail and say why.
 *
 * What the switch *does* add to the database is the `unaccent` extension and
 * one IMMUTABLE helper function, because the substring half folds accents
 * whether or not `unaccent` is set. Both statements are idempotent and neither
 * touches a table, which the last two tests check.
 */
import { describe, it, expect } from "@jest/globals";
import type { CollectionConfig, PostgresCollectionConfig } from "@rebasepro/types";
import { planCollectionSchemaEnsure, type ExistingSchema } from "../src/schema/ensure-collection-tables";
import {
    buildSearchColumnSpec,
    searchColumnStamps,
    searchExtensionStatements,
    searchHelperFunctions,
    searchIndexStatements
} from "../src/schema/search-column";

const talents = (search: PostgresCollectionConfig["search"]): PostgresCollectionConfig => ({
    slug: "talents",
    table: "talents",
    name: "Talents",
    properties: {
        id: { type: "string", isId: "uuid" },
        full_name: { type: "string" },
        headline: { type: "string" }
    },
    search
});

/** What a collection that shipped before `mode` existed looks like. */
const fts = talents({ language: "spanish", fields: ["full_name", "headline"] });
/** The same collection with the mode switched on, and nothing else touched. */
const hybrid = talents({ language: "spanish", mode: "hybrid", fields: ["full_name", "headline"] });
/** For contrast: the change that genuinely *is* a column rebuild. */
const folded = talents({ language: "spanish", unaccent: true, fields: ["full_name", "headline"] });

const specOf = (c: CollectionConfig) => buildSearchColumnSpec(c)!;
const stampOf = (c: CollectionConfig) => searchColumnStamps(specOf(c))[0].fingerprint;

/** A database that already has the table and a column built from `stamp`. */
const existing = (stamp: string): ExistingSchema => ({
    tables: new Map([["public.talents", new Set(["id", "full_name", "headline", "search_vector"])]]),
    enums: new Set<string>(),
    constraints: new Set<string>(),
    columnComments: new Map([["public.talents.search_vector", stamp]])
});

describe("`mode` does not describe the column", () => {
    it("leaves the generation expression, the fingerprint and the index name identical", () => {
        const a = specOf(fts);
        const b = specOf(hybrid);

        expect(b.mode).toBe("hybrid");
        expect(b.expression).toBe(a.expression);
        expect(stampOf(hybrid)).toBe(stampOf(fts));
        expect(searchIndexStatements(b)).toEqual(searchIndexStatements(a));
    });

    it("is therefore not drift, so a live collection can switch with a deploy", () => {
        const plan = planCollectionSchemaEnsure([hybrid as CollectionConfig], existing(stampOf(fts)));

        expect(plan.searchDrift).toEqual([]);
        expect(plan.actions.filter(a => a.kind === "add-column")).toEqual([]);
    });

    it("unlike `unaccent`, which is a rebuild and is still refused", () => {
        // The contrast is what makes the test above mean something: if `mode`
        // were silently ignored by the planner rather than genuinely
        // column-neutral, both cases would come back clean.
        const plan = planCollectionSchemaEnsure([folded as CollectionConfig], existing(stampOf(fts)));

        expect(plan.searchDrift).toHaveLength(1);
        expect(plan.searchDrift[0].rebuild[0])
            .toBe(`ALTER TABLE "public"."talents" DROP COLUMN "search_vector";`);
    });
});

describe("what `mode: \"hybrid\"` does add", () => {
    it("asks for the unaccent extension and helper even when `unaccent` is off", () => {
        // The substring half folds accents on both sides, which is the whole
        // reason the switch buys anything without a rebuild.
        const spec = specOf(hybrid);

        expect(spec.extensions).toContain("unaccent");
        expect(searchExtensionStatements(spec))
            .toContain("CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;");
        expect(searchHelperFunctions(spec).join("\n")).toContain("rebase_search_unaccent");
    });

    it("asks for neither on the plain FTS block, so nothing changes for collections that do not opt in", () => {
        const spec = specOf(fts);

        expect(spec.extensions).toEqual([]);
        expect(searchHelperFunctions(spec).join("\n")).not.toContain("rebase_search_unaccent");
    });

    it("adds them with statements that are safe to replay", () => {
        const statements = [
            ...searchExtensionStatements(specOf(hybrid)),
            ...searchHelperFunctions(specOf(hybrid))
        ];

        // Idempotent, and none of them names a table: replaying the deploy is a
        // no-op and applying it takes no lock on `talents`.
        for (const statement of statements) {
            expect(statement).toMatch(/IF NOT EXISTS|CREATE OR REPLACE/);
            expect(statement).not.toContain("ALTER TABLE");
        }
    });
});
