import { describe, expect, it } from "@jest/globals";
import path from "node:path";
import type { CollectionConfig, Property } from "@rebasepro/types";

import { generateOpenApiSpec } from "../src/api/openapi-generator";

/**
 * What the published document is allowed to name.
 *
 * `/api/docs` is registered on the app, not on the data router, so it carries
 * none of the middleware `{basePath}/data` does: the document is readable by
 * anyone who can reach the service. `excludeFromApi` is the one property flag
 * that is a server-side guarantee — the row pipeline's `stripExcluded` removes
 * the column from every row the API serves, for every caller, admins and
 * service keys included — and the generator consulted it nowhere. Three loops
 * (read schema, input schema, filter parameters) each skipped `relation` and
 * nothing else, so every project scaffolded by `rebase init` published its
 * `users` collection's `passwordHash` and `emailVerificationToken` by name,
 * described as readable, writable and filterable.
 *
 * These tests assert the *rule*, over every place a property name can reach the
 * document, rather than the two column names that were found — the sibling
 * defect in the SDK generator was fixed one loop at a time, which is how it
 * came to survive here.
 */

const vaults = {
    slug: "vaults", name: "Vaults", singularName: "Vault", table: "vaults",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        label: { name: "Label", type: "string" },
        secretDigest: { name: "Secret Digest", type: "string", excludeFromApi: true },
        recoveryCode: { name: "Recovery Code", type: "number", excludeFromApi: true },
        rotatedAt: { name: "Rotated At", type: "date", excludeFromApi: true },
        auditTrail: { name: "Audit Trail", type: "array", of: { type: "string" }, excludeFromApi: true }
    }
} as unknown as CollectionConfig;

const excludedKeys = Object.entries(vaults.properties as Record<string, Property>)
    .filter(([, property]) => property.excludeFromApi)
    .map(([key]) => key);

const spec = generateOpenApiSpec([vaults]) as Record<string, any>;

const schemaProperties = (name: string): string[] =>
    Object.keys(spec.components.schemas[name].properties as Record<string, unknown>);

const filterNames = (): string[] =>
    (spec.paths["/data/vaults"].get.parameters as { name: string }[]).map(p => p.name);

describe("a property marked excludeFromApi", () => {
    it("has more than one to check, and they are not all of them", () => {
        // Guards the fixture: a rule tested against an empty set passes for the
        // wrong reason, and one tested against a collection with nothing left
        // would pass even if the generator emitted no properties at all.
        expect(excludedKeys.length).toBeGreaterThan(1);
        expect(schemaProperties("Vault")).toEqual(expect.arrayContaining(["label"]));
        expect(schemaProperties("VaultInput")).toEqual(expect.arrayContaining(["label"]));
        expect(filterNames()).toEqual(expect.arrayContaining(["label"]));
    });

    it("appears nowhere in the document at all", () => {
        // The blunt assertion on purpose: schemas, request bodies, parameters,
        // descriptions and examples are all places a column name has leaked
        // from, and the guarantee is about the name being absent, not about
        // which builder put it there.
        const serialized = JSON.stringify(spec);

        for (const key of excludedKeys) {
            expect(serialized).not.toContain(key);
        }
    });

    it("is not in the read schema — no response can ever contain it", () => {
        expect(schemaProperties("Vault")).not.toEqual(expect.arrayContaining(excludedKeys));
    });

    it("is not offered on create or update", () => {
        expect(schemaProperties("VaultInput")).not.toEqual(expect.arrayContaining(excludedKeys));
        expect(schemaProperties("VaultUpdate")).not.toEqual(expect.arrayContaining(excludedKeys));
    });

    it("is not offered as a filter — that would answer questions one row at a time", () => {
        expect(filterNames()).not.toEqual(expect.arrayContaining(excludedKeys));
    });

    it("does not take the ordinary columns with it", () => {
        // The rule is one flag, not "hide anything that looks sensitive".
        expect(schemaProperties("Vault")).toEqual(["id", "label"]);
    });
});

describe("relation properties", () => {
    // The exclusion the three loops did have, folded into the same predicate:
    // a relation is virtual, the row carries the owning side's foreign key.
    const authors = {
        slug: "authors", name: "Authors", singularName: "Author", table: "authors",
        properties: { id: { type: "string", isId: "uuid" }, name: { type: "string" } }
    } as unknown as CollectionConfig;
    const posts = {
        slug: "posts", name: "Posts", singularName: "Post", table: "posts",
        properties: {
            id: { type: "string", isId: "uuid" },
            title: { type: "string" },
            author: { name: "Author", type: "relation", relation: { kind: "belongsTo", target: () => authors } }
        }
    } as unknown as CollectionConfig;

    it("stay out of the schemas and the filters", () => {
        const relSpec = generateOpenApiSpec([posts, authors]) as Record<string, any>;

        expect(Object.keys(relSpec.components.schemas.Post.properties)).toEqual(["id", "title"]);
        expect(Object.keys(relSpec.components.schemas.PostInput.properties)).toEqual(["title", "id"]);
        expect((relSpec.paths["/data/posts"].get.parameters as { name: string }[])
            .map(p => p.name)).not.toContain("author");
    });
});

describe("the scaffolded users collection", () => {
    // The collection every `rebase init` project starts with, through the
    // generator that publishes it. Loaded from the template itself so a rename
    // there cannot quietly retire the test.
    const templateUsers = path.resolve(
        __dirname, "../../cli/templates/template/config/collections/users.ts"
    );

    it("keeps its password hash and verification token out of the document", async () => {
        const users = (await import(templateUsers)).default as CollectionConfig;
        const properties = users.properties as Record<string, Property>;

        expect(properties.passwordHash?.excludeFromApi).toBe(true);
        expect(properties.emailVerificationToken?.excludeFromApi).toBe(true);

        const serialized = JSON.stringify(generateOpenApiSpec([users]));

        expect(serialized).not.toContain("passwordHash");
        expect(serialized).not.toContain("password_hash");
        expect(serialized).not.toContain("emailVerificationToken");
        expect(serialized).not.toContain("Password Hash");
        // Still a usable document for the columns that are served.
        expect(serialized).toContain("email");
    });
});
