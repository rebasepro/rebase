/**
 * A collection served by another engine is not this engine's to provision.
 *
 * Firestore and MongoDB collections are declared in the same
 * `config/collections` directory as the Postgres ones — that is what
 * `dataSource` routing is for — and every stage of the SQL toolchain used to
 * read "the collections" as all of them. So a Firestore collection got a
 * `pgTable` in the generated schema, a `CREATE TABLE` at boot, RLS policies,
 * and an entry in the `db push` include list, while the app went on reading its
 * documents from Firestore.
 *
 * The include list is the one that can lose data: a name on it is a name Atlas
 * is *allowed to drop*, so a Firestore collection called `exercises` removed a
 * real, unrelated `public.exercises` table's protection from the next
 * auto-approved `db push`.
 */
import { describe, expect, it } from "@jest/globals";
import type { CollectionConfig } from "@rebasepro/types";

import { generateSchema } from "./generate-drizzle-schema-logic";
import {
    generatePostgresDdl,
    generatePostgresPoliciesDdl,
    planCollectionPolicies
} from "./generate-postgres-ddl-logic";
import { planCollectionSchemaEnsure, type ExistingSchema } from "./ensure-collection-tables";
import { getTableIncludesFromCollections } from "../cli-helpers";

const sqlCollection = {
    name: "Customers",
    slug: "customers",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        email: { name: "Email", type: "string" }
    },
    securityRules: [{ operation: "read", policy: "true" }]
} as unknown as CollectionConfig;

const firestoreCollection = {
    name: "Exercises",
    slug: "exercises",
    engine: "firestore",
    dataSource: "firestore",
    properties: {
        id: { name: "ID", type: "string" },
        title: { name: "Title", type: "string" },
        difficulty: {
            name: "Difficulty",
            type: "string",
            enum: [{ id: "easy", label: "Easy" }, { id: "hard", label: "Hard" }]
        }
    }
} as unknown as CollectionConfig;

const mongoCollection = {
    name: "Events",
    slug: "events",
    engine: "mongodb",
    properties: { id: { name: "ID", type: "string" } }
} as unknown as CollectionConfig;

/** Routed by `dataSource` alone — no `engine` field to read. */
const dataSourceOnlyCollection = {
    name: "Articles",
    slug: "articles",
    dataSource: "firestore",
    properties: { id: { name: "ID", type: "string" } }
} as unknown as CollectionConfig;

const all = [sqlCollection, firestoreCollection, mongoCollection, dataSourceOnlyCollection];

describe("the Drizzle schema generator", () => {
    it("emits a table for the Postgres collection only", async () => {
        const schema = await generateSchema(all);

        expect(schema).toContain("customers");
        expect(schema).not.toContain("exercises");
        expect(schema).not.toContain("events");
        expect(schema).not.toContain("articles");
    });

    it("does not emit enum types for a document store's fields", async () => {
        const schema = await generateSchema(all);
        expect(schema).not.toContain("difficulty");
    });
});

describe("the Postgres DDL generator", () => {
    it("creates no table for a non-SQL collection", async () => {
        const ddl = await generatePostgresDdl(all, { includePolicies: false });

        expect(ddl).toContain('CREATE TABLE "public"."customers"');
        expect(ddl).not.toContain("exercises");
        expect(ddl).not.toContain("events");
    });

    it("plans no RLS for a store that has none", () => {
        const policies = generatePostgresPoliciesDdl(all);
        expect(policies).not.toContain("exercises");

        const plans = planCollectionPolicies(all);
        expect(plans.map(p => p.qualified)).toEqual(["public.customers"]);
    });
});

describe("the boot-time schema ensure", () => {
    const empty = (): ExistingSchema => ({ tables: new Map(), enums: new Set() });

    it("creates nothing for collections another engine stores", () => {
        const plan = planCollectionSchemaEnsure(all, empty());

        expect(plan.actions.map(a => a.target)).toEqual(
            expect.arrayContaining(["public.customers"])
        );
        for (const action of plan.actions) {
            expect(action.target).not.toContain("exercises");
            expect(action.target).not.toContain("events");
            expect(action.target).not.toContain("articles");
        }
    });
});

describe("the db push include list", () => {
    it("does not claim a table for a Firestore collection", async () => {
        // Anything absent from this list is *excluded* from the declarative
        // apply, which is what protects it from being dropped.
        const includes = await getTableIncludesFromCollections(all);

        expect(includes).toEqual(["public.customers"]);
    });
});
