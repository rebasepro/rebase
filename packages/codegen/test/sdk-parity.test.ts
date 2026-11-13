import { describe, it, expect, jest } from "@jest/globals";
import * as fs from "node:fs";
import * as path from "node:path";
import { isSchemaDefinitionError } from "@rebasepro/common";
import type { TableDescriptor } from "@rebasepro/types";
import type { LegacyAnyCollectionConfig, LegacyCollectionConfig } from "@rebasepro/common/migrate";
import { generateTypedefs } from "../src/generate-types";
import { toTableAccessor } from "../src/utils";
import { LEGACY_FIXTURES } from "./fixtures/legacy-collections";
import { collections as baasCollections } from "./fixtures/legacy-baas-collections";
import { descriptorsFromCollections } from "./helpers/from-collections";
import { compareSdk, unexplainedDifferences, type SdkDifference } from "./helpers/sdk-diff";

/**
 * The descriptor generator writes, for every codegen fixture set, what the
 * collection generator wrote for it:
 *
 *     generateTypedefs(compileTables(collectionsToTableDefs(S)))  ≡  golden(S)
 *
 * The goldens (`fixtures/sdk-golden/<set>.ts.txt`) were recorded from the
 * collection generator before it was replaced, and are never edited. A line
 * that differs must be explained by a rule of `SDK_ALLOWED_DIFFERENCES` from
 * the descriptor of its table; a set the lift refuses is listed in
 * {@link REFUSED} with why, and a set converted after an input adjustment says
 * which keys the adjustment took away.
 *
 * The plan-golden corpus is held to the same rules by
 * `packages/server-postgres/test/sdk-equivalence.test.ts`.
 */
const GOLDEN_DIR = path.resolve(__dirname, "fixtures", "sdk-golden");

const SETS: Record<string, () => LegacyCollectionConfig[]> = {
    ...LEGACY_FIXTURES,
    // `defineCollection` results each carry their own row type, which a bare
    // `CollectionConfig` (invariant in it) does not accept.
    "baas-typed-sdk": () => {
        const schema: LegacyAnyCollectionConfig[] = baasCollections;
        return schema;
    }
};

/**
 * Sets the table model cannot say, so the lift refuses them — each with the
 * refusal it must give. Their capabilities are covered over `defineTable` in
 * `sdk-generator.test.ts` and `generated-output-compiles.test.ts`.
 */
const REFUSED: Record<string, { pattern: RegExp; reason: string }> = {
    "unknown-property-type": {
        pattern: /something-weird property, which has no column/,
        reason: "a property type no collection model defines; there is no column to describe"
    },
    "firestore-reference": {
        pattern: /firestore collection\. Only Postgres collections become tables/,
        reason: "a Firestore collection is not a table; it becomes `defineFirestoreCollection` in the CMS"
    },
    "relation-shadows-its-key": {
        pattern: /declared only in `relations`, over the column "company_id", which no property declares/,
        reason: "the planner creates no column for a `belongsTo` only in `relations`, so the old SDK typed a column that does not exist"
    },
    "resolvable-relation": {
        pattern: /declared only in `relations`, over the column "author_id", which no property declares/,
        reason: "as above: the column the relation reads is not planned"
    },
    "hostile-foreign-key": {
        pattern: /declared only in `relations`, over the column/,
        reason: "as above; the escaping it was written for is covered over `defineTable`"
    },
    "relation-renamed-from-property": {
        pattern: /declares an inline relation named "author_rel" on the property "author"/,
        reason: "an inline relation named apart from its property plans no foreign key at all"
    },
    "separator-keys": {
        pattern: /"my_field" and "my-field" both resolve to the SQL column "my_field"/,
        reason: "two keys of one SQL column; the table would declare it twice"
    },
    "exclude-from-api": {
        pattern: /binds the column "legacyOwner" \(`text`\) as its foreign key, and `owners`'s key "id" is `uuid`|vault\.auditor/,
        reason: "`auditor` closes a relation property (the table model closes the foreign-key column), and `owner` stores a " +
            "uuid key in a text column, which no foreign key holds between"
    },
    "unresolvable-relation": {
        pattern: /has a relation that does not resolve: Cannot access 'users' before initialization/,
        reason: "a target that does not resolve is refused when the schema is compiled, naming the table and the relation"
    }
};

/**
 * Sets converted after taking away what the lift refuses: a relation property
 * that closes itself (`excludeFromApi` / `access`). The table model closes the
 * foreign-key *column* instead, and a relation follows its column — covered
 * over `defineTable`. Every other line of the set is still held to the golden.
 */
const ADJUSTED: Record<string, { reason: string; apply: (collections: LegacyCollectionConfig[]) => void; removed: { table: string; keys: string[] }[] }> = {
    "baas-typed-sdk": {
        reason: "`comments.moderator` (excludeFromApi) and `comments.reviewer` (access.write: []) close a relation property",
        apply: collections => dropProperties(collections, "comments", ["moderator", "reviewer"]),
        removed: [{ table: "comments", keys: ["moderator", "moderatorId", "reviewer", "reviewerId"] }]
    },
    "write-types-graph": {
        reason: "`posts.moderator` (excludeFromApi) and `posts.reviewer` (access.write: []) close a relation property",
        apply: collections => dropProperties(collections, "posts", ["moderator", "reviewer"]),
        removed: [{ table: "posts", keys: ["moderator", "moderatorId", "reviewer", "reviewerId"] }]
    },
};

function dropProperties(collections: LegacyCollectionConfig[], slug: string, keys: string[]): void {
    const collection = collections.find(candidate => candidate.slug === slug);
    if (!collection?.properties) throw new Error(`No collection "${slug}" to adjust.`);
    for (const key of keys) delete collection.properties[key];
}

function quietly<T>(run: () => T): T {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
        return run();
    } finally {
        warn.mockRestore();
    }
}

/** Whether an adjustment explains a difference: a key it took away, or an order once those keys are left out. */
function adjustedAway(difference: SdkDifference, removed: { table: string; keys: string[] }[]): boolean {
    const entry = removed.find(candidate => candidate.table === difference.table);
    if (!entry) return false;
    if (difference.kind === "order") {
        const keep = (list: string | undefined): string => (list ?? "").split(", ").filter(key => !entry.keys.includes(key)).join(", ");
        return keep(difference.golden) === keep(difference.generated);
    }
    // A table whose only relations were taken away lists none.
    if (difference.block === "Relations" && difference.key === "=" && difference.kind === "added") return true;
    return difference.key !== undefined && entry.keys.includes(difference.key) && difference.kind === "removed";
}

describe("the descriptor generator reproduces the collection generator's goldens", () => {
    it.each(Object.keys(SETS))("%s", name => {
        const golden = fs.readFileSync(path.join(GOLDEN_DIR, `${name}.ts.txt`), "utf-8");
        const collections = SETS[name]();
        const refused = REFUSED[name];
        if (refused) {
            let message: string | undefined;
            try {
                quietly(() => descriptorsFromCollections(collections));
            } catch (error) {
                message = isSchemaDefinitionError(error) ? error.problems.map(problem => problem.message).join("\n") : String(error);
            }
            expect({ set: name, message }).toEqual({ set: name, message: expect.stringMatching(refused.pattern) });
            return;
        }
        const adjustment = ADJUSTED[name];
        adjustment?.apply(collections);
        let tables: TableDescriptor[] = [];
        let generated: string;
        try {
            tables = quietly(() => descriptorsFromCollections(collections));
            generated = quietly(() => generateTypedefs(tables));
        } catch (error) {
            // A schema the generator refuses is refused by both: the golden
            // recorded the collection generator's refusal.
            generated = `THROWS: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}\n`;
            expect(golden.startsWith("THROWS: CodegenError")).toBe(true);
            expect(generated.startsWith("THROWS: CodegenError")).toBe(true);
            return;
        }
        const byAccessor = new Map(tables.map(table => [toTableAccessor(table.slug), table]));
        const differences = compareSdk(golden, generated)
            .filter(difference => !(adjustment && adjustedAway(difference, adjustment.removed)));
        const { unexplained } = unexplainedDifferences(differences, byAccessor);
        expect({ set: name, unexplained }).toEqual({ set: name, unexplained: [] });
    });

});
