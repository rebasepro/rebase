/**
 * A kind literal that has shipped is a wire contract with every published copy.
 *
 * A published driver — `@rebasepro/server-postgres` and friends — inlines this
 * package into its `dist`. When a tenant's bundle brings its own driver to a
 * runtime that has its own copy, both call `registerResourceKind` against one
 * shared registry, and two differing specs at the same revision throw. The
 * driver then fails to load and the process refuses to boot.
 *
 * `revision` exists to make that survivable, and the rule that came with it —
 * never edit a shipped literal, correct through `amendResourceKind` — was
 * written after `database` had already been edited. 0.17.0 and 0.17.1 shipped
 * one `optionKeys`; 0.17.2 shipped another. Two objects were already in the
 * field, no literal could equal both, and a comment declaring the newer one
 * FROZEN did not make the older one go away. Two tenants crash-looped for six
 * and a half days.
 *
 * So the rule cannot be the whole control: a literal can be wrong the moment it
 * is written, against copies that shipped before anyone thought to freeze it.
 * What has to hold is weaker and checkable — **every spec this package has ever
 * published must be able to meet the current one without throwing.** These are
 * those specs.
 */
import { registerResourceKind, resourceKind, type ResourceKindSpec } from "../src/types/resources";
import "../src/types/resource_kinds";

/**
 * Kind literals as published, verbatim.
 *
 * Add a row when a literal changes; never edit one. A row is what some copy in
 * the field is holding, and rewriting it here does not rewrite it there.
 */
const SHIPPED: { versions: string; spec: ResourceKindSpec }[] = [
    {
        versions: "0.17.0, 0.17.1",
        spec: {
            kind: "database",
            engines: ["postgres", "mongodb", "firestore", "sqlite"],
            defaultEngine: "postgres",
            envBases: ["DATABASE_URL", "REBASE_DRIVER", "REBASE_DB_POOL_MAX"],
            optionKeys: ["databaseId", "migrations"],
            implicitDefault: true
        } as ResourceKindSpec
    },
    {
        // "extensions" added to the literal rather than through an amendment.
        // This is the spec that would not load beside the one above.
        versions: "0.17.2, 0.17.3",
        spec: {
            kind: "database",
            engines: ["postgres", "mongodb", "firestore", "sqlite"],
            defaultEngine: "postgres",
            envBases: ["DATABASE_URL", "REBASE_DRIVER", "REBASE_DB_POOL_MAX"],
            optionKeys: ["databaseId", "migrations", "extensions"],
            implicitDefault: true
        } as ResourceKindSpec
    },
    {
        // Unchanged since it first shipped. Here so a future edit to it has to
        // come past this file rather than past a comment.
        versions: "0.17.0 onwards",
        spec: {
            kind: "topic",
            engines: ["jobs"],
            defaultEngine: "jobs",
            envBases: ["REBASE_TOPIC_URL"],
            optionKeys: ["delivery", "maxAttempts"],
            implicitDefault: false
        } as ResourceKindSpec
    }
];

describe("a published copy of this package can always meet the current one", () => {
    /**
     * The production failure, reproduced. Importing `resource_kinds` has already
     * registered the current literals into the process-global registry; this is
     * an older driver's copy arriving second, which is what the tenant's bundle
     * did.
     */
    for (const { versions, spec } of SHIPPED) {
        it(`loads the ${spec.kind} spec shipped in ${versions} beside the current one`, () => {
            const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
            try {
                expect(() => registerResourceKind(spec)).not.toThrow();
            } finally {
                warn.mockRestore();
            }
        });
    }

    /**
     * A revision that the current literal did not actually earn would let this
     * suite pass while the field still broke: the older copy has to LOSE, not
     * merely coexist, or a tenant runs on a definition its driver shipped in
     * 2026 and the runtime has since corrected.
     */
    it("keeps the current definition, not the one an older copy brought", () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            const older = SHIPPED.find(s => s.spec.kind === "database")!.spec;
            registerResourceKind(older);
            const now = resourceKind("database");
            expect(now?.optionKeys).toContain("extensions");
            // The amendment, which is what the resolver actually reads from.
            expect(now?.envBases).toContain("ADMIN_CONNECTION_STRING");
        } finally {
            warn.mockRestore();
        }
    });

    /**
     * The rule this file cannot enforce on its own: once two literals for one
     * kind exist, only a revision above every published one keeps them apart.
     * `database` has two, so it must carry one.
     */
    it("carries a revision on every kind that has shipped more than one literal", () => {
        const counts = new Map<string, number>();
        for (const { spec } of SHIPPED) {
            counts.set(spec.kind, (counts.get(spec.kind) ?? 0) + 1);
        }
        for (const [kind, n] of counts) {
            if (n < 2) continue;
            const current = resourceKind(kind);
            expect(current).toBeDefined();
            // `n` literals in the field means a copy holding any of them must be
            // able to lose to the current definition, which needs a revision > 0.
            expect(current!.revision ?? 0).toBeGreaterThan(0);
        }
    });
});
