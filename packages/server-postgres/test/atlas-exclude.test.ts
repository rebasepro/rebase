import type { CollectionConfig } from "@rebasepro/types";
import { atlasExcludePattern, atlasExcludeSegment, excludePatternParts } from "../src/schema/atlas-exclude";
import { getForeignIndexExcludes, getTableExcludes } from "../src/cli-helpers";
import { searchExcludePatterns, triggerExcludePatterns, vectorExcludePatterns } from "../src/schema/generate-postgres-ddl-logic";
import { undeclaredConstraintExcludes } from "../src/schema/undeclarable-constraints";
import { parseExcludePatterns, stripCarvedOutStatements } from "../src/schema/carved-out-migration";
import { partitionByOwnership } from "../src/schema/generated-column-conflicts";

/**
 * Every `--exclude` `db push` hands Atlas matches the object it names, whatever
 * the name holds.
 *
 * Atlas splits a pattern on `.` and globs each part. The lists passed names
 * through raw, so a hand-written index called `orders_idx[v1]` was excluded by
 * a pattern whose `[v1]` is a class matching `v` or `1`: it matched nothing,
 * said nothing, and the index was dropped by a push with no prompt. A `.` in a
 * name refused the whole push instead (`too many parts in pattern`).
 */

/** A name with every character that is not a name to Atlas. */
const ODD = "odd.name [v1]*";

/**
 * Does Atlas's exclude `pattern` match the object these names qualify? Read
 * the way Atlas reads it (measured on 1.2.3): split on `.`, then each part is
 * a Go `path.Match` glob — `*`, `?`, `[…]` classes, `\` escapes.
 */
function atlasMatches(pattern: string, names: string[]): boolean {
    const segments = pattern.split(".");
    if (segments.length !== names.length) return false;
    return segments.every((segment, i) => globToRegExp(segment).test(names[i]));
}

function globToRegExp(glob: string): RegExp {
    let source = "";
    for (let i = 0; i < glob.length; i++) {
        const ch = glob[i];
        if (ch === "\\" && i + 1 < glob.length) {
            source += escapeRegExp(glob[++i]);
        } else if (ch === "*") {
            source += ".*";
        } else if (ch === "?") {
            source += ".";
        } else if (ch === "[") {
            const end = glob.indexOf("]", i + 1);
            if (end === -1) return /$^/; // Atlas rejects it; it matches nothing.
            source += `[${glob.slice(i + 1, end).replace(/\\/g, "\\\\")}]`;
            i = end;
        } else {
            source += escapeRegExp(ch);
        }
    }
    return new RegExp(`^${source}$`, "s");
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

describe("atlasExcludePattern", () => {
    it("matches exactly the name, and reads back to it", () => {
        const pattern = atlasExcludePattern("public", "orders", ODD);
        expect(pattern).toBe("public.orders.odd?name \\[v1\\]\\*");
        expect(atlasMatches(pattern, ["public", "orders", ODD])).toBe(true);
        expect(atlasMatches(pattern, ["public", "orders", "odd.name v*"])).toBe(false);
        expect(excludePatternParts(pattern)).toEqual(["public", "orders", ODD]);
    });

    it("leaves an ordinary name as it is", () => {
        expect(atlasExcludePattern("public", "orders", "orders_total_idx")).toBe("public.orders.orders_total_idx");
        expect(atlasExcludeSegment("back\\slash?")).toBe("back\\\\slash\\?");
        expect(excludePatternParts(atlasExcludePattern("a\\b?", "c"))).toEqual(["a\\b?", "c"]);
    });

    it("reads a wildcard as no name", () => {
        expect(excludePatternParts("auth.*")).toBeUndefined();
    });
});

describe("each exclude list, for a name that is not a glob as it stands", () => {
    it("tables no collection backs", async () => {
        const excludes = await getTableExcludes("postgres://x/db", "/collections", {
            getIncludes: async () => ["public.orders"],
            queryExistingTables: async () => [{ schema: "public", table: "orders" }, { schema: "legacy", table: ODD }]
        });
        const pattern = excludes.find(p => atlasMatches(p, ["legacy", ODD]));
        expect(pattern).toBeDefined();
        expect(excludes.some(p => atlasMatches(p, ["public", "orders"]))).toBe(false);
    });

    it("hand-written indexes", async () => {
        const excludes = await getForeignIndexExcludes("postgres://x/db", "/collections", {
            queryExistingIndexes: async () => [
                { schema: "public", table: "orders", index: ODD },
                { schema: "public", table: "orders", index: "orders_idx[v1]" }
            ],
            getManagedIndexNames: async () => new Set<string>()
        });
        expect(excludes.some(p => atlasMatches(p, ["public", "orders", ODD]))).toBe(true);
        expect(excludes.some(p => atlasMatches(p, ["public", "orders", "orders_idx[v1]"]))).toBe(true);
    });

    it("an index of ours that is still declared is left to Atlas, whatever its name", async () => {
        const excludes = await getForeignIndexExcludes("postgres://x/db", "/collections", {
            queryExistingIndexes: async () => [{ schema: "public", table: "orders", index: ODD }],
            getManagedIndexNames: async () => new Set([ODD])
        });
        expect(excludes).toEqual([]);
    });

    // No `.` here: a collection's `table: "a.b"` names schema `a`, table `b`.
    const ODD_TABLE = "odd name [v1]*";
    const oddTable: CollectionConfig = {
        slug: "odd",
        table: ODD_TABLE,
        name: "Odd",
        properties: {
            id: { type: "string", isId: "uuid" },
            title: { type: "string" },
            embedding: { type: "vector", dimensions: 3 },
            updated_at: { type: "date", autoValue: "on_update" }
        },
        search: { fields: [{ path: "title", weight: "A" }] }
    };

    it.each([
        ["search", searchExcludePatterns],
        ["vector", vectorExcludePatterns],
        ["trigger", triggerExcludePatterns]
    ] as const)("Rebase's own %s objects", (_kind, patternsOf) => {
        const patterns = patternsOf([oddTable]);
        expect(patterns.length).toBeGreaterThan(0);
        for (const pattern of patterns) {
            const names = excludePatternParts(pattern);
            expect(names).toHaveLength(3);
            expect(names![1]).toBe(ODD_TABLE);
            expect(atlasMatches(pattern, names!)).toBe(true);
        }
    });

    it("CHECK and EXCLUDE constraints", () => {
        const [pattern] = undeclaredConstraintExcludes([{ schema: "public", table: ODD, name: ODD, kind: "check" }], "");
        expect(atlasMatches(pattern, ["public", ODD, ODD])).toBe(true);
    });
});

describe("the code that reads those patterns back", () => {
    const pattern = atlasExcludePattern("public", "orders", ODD);

    it("the migration stripper knows the carved-out object by its name", () => {
        expect(parseExcludePatterns([pattern])).toEqual([{ schema: "public", table: "orders", object: ODD }]);
        const { sql, removed } = stripCarvedOutStatements(
            `ALTER TABLE "public"."orders" DROP COLUMN "${ODD}", ADD COLUMN "note" text NULL;`, [pattern]
        );
        expect(removed).toHaveLength(1);
        expect(sql).not.toContain(ODD);
        expect(sql).toContain(`ADD COLUMN "note"`);
    });

    it("the generated-column ownership check finds Rebase's column", () => {
        const conflict = { schema: "public", table: "orders", column: ODD, blocking: [{ column: "title", kind: "type" as const }] };
        const { managed, foreign } = partitionByOwnership([conflict], [pattern]);
        expect(managed).toHaveLength(1);
        expect(foreign).toHaveLength(0);
    });
});
