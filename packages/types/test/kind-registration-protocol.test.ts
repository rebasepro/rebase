/**
 * A copy of this package that predates `revision` must be able to register
 * beside the current one — in either load order, running ITS OWN code.
 *
 * `shipped-kinds.test.ts` asserts that every published literal can meet the
 * current one, and it passed on 2026-09-07 while the bundle corpus failed on
 * the same commit. The reason is the thing this file exists to hold: that suite
 * calls the CURRENT `registerResourceKind` for both specs, and a pod does not.
 * A published driver inlines this package, so the comparison is run by whichever
 * copy registers SECOND — and the runtime registers at import, before it loads
 * a driver, so the second copy is always the driver's. Its code is frozen at its
 * release. 0.17.0–0.17.3 deep-equal the spec and throw; they have never heard of
 * `revision`, so no value of `revision` in this package can change what they do.
 *
 * What changed is where kinds live: copies that understand the protocol share
 * `KINDS_KEY`, and an older copy is left the legacy map, alone, where it finds
 * no competing entry and cannot throw.
 *
 * The old algorithm is reproduced verbatim below rather than imported. That is
 * the point — importing it would test this build against itself again, which is
 * exactly the hole that let the corpus fail on a green suite.
 */
import { registerResourceKind, resourceKind, resourceKinds, type ResourceKindSpec } from "../src/types/resources";
import "../src/types/resource_kinds";

const LEGACY_KEY = Symbol.for("@rebasepro/types.resourceRegistry");

interface LegacyRegistry {
    kinds: Map<string, ResourceKindSpec>;
    declarations: Map<string, unknown>;
}

function legacyRegistry(): LegacyRegistry {
    const g = globalThis as unknown as Record<symbol, LegacyRegistry | undefined>;
    let existing = g[LEGACY_KEY];
    if (!existing) {
        existing = { kinds: new Map(), declarations: new Map() };
        g[LEGACY_KEY] = existing;
    }
    return existing;
}

/**
 * `registerResourceKind` as published in v0.17.3, byte-for-byte in behaviour
 * including the message. This is the function a tenant's driver actually runs.
 */
function registerAsV0173(spec: ResourceKindSpec): void {
    const kinds = legacyRegistry().kinds;
    const existing = kinds.get(spec.kind);
    if (!existing) {
        kinds.set(spec.kind, spec);
        return;
    }
    if (JSON.stringify(existing) === JSON.stringify(spec)) return;
    throw new Error(
        `Resource kind "${spec.kind}" is already registered with a different definition. ` +
        "Two packages cannot define the same kind."
    );
}

/** The two `database` literals that are in the field. Neither may be edited. */
const DATABASE_0_17_0: ResourceKindSpec = {
    kind: "database",
    engines: ["postgres", "mongodb", "firestore", "sqlite"],
    defaultEngine: "postgres",
    envBases: ["DATABASE_URL", "REBASE_DRIVER", "REBASE_DB_POOL_MAX"],
    optionKeys: ["databaseId", "migrations"],
    implicitDefault: true
} as ResourceKindSpec;

const DATABASE_0_17_2: ResourceKindSpec = {
    ...DATABASE_0_17_0,
    optionKeys: ["databaseId", "migrations", "extensions"]
} as ResourceKindSpec;

describe("an old inlined copy registers beside the current one", () => {
    afterEach(() => {
        // The legacy map is process-global; leaving rows in it would make the
        // next test's "registers first" case a "registers second" case.
        legacyRegistry().kinds.clear();
    });

    /**
     * The production order: the runtime imported this package at boot, then the
     * bundle's driver loaded and registered its own copy's literal.
     */
    for (const [label, spec] of [
        ["0.17.0/0.17.1", DATABASE_0_17_0],
        ["0.17.2/0.17.3", DATABASE_0_17_2]
    ] as const) {
        it(`does not throw when a ${label} driver loads after the runtime`, () => {
            expect(() => registerAsV0173(spec)).not.toThrow();
        });
    }

    /** The reverse order, which a different entrypoint could produce. */
    it("does not throw when the driver loads first and the runtime registers after", () => {
        registerAsV0173(DATABASE_0_17_0);
        expect(() => registerResourceKind(DATABASE_0_17_2)).not.toThrow();
    });

    /**
     * Coexistence is not enough. A tenant must run on the definition this
     * runtime holds, not on one its driver froze in 2026 — including the
     * amendment, which is what the resolver reads variables from.
     */
    it("keeps the current definition, not the driver's", () => {
        registerAsV0173(DATABASE_0_17_0);
        const now = resourceKind("database");
        expect(now?.optionKeys).toContain("extensions");
        expect(now?.envBases).toContain("ADMIN_CONNECTION_STRING");
    });

    /**
     * The legacy map is not ignored, only deprioritised. A third-party driver
     * built against an older `@rebasepro/types` registers kinds of its own, and
     * dropping them would turn a registered kind into "unknown resource kind".
     */
    it("still sees a kind only a legacy copy registered", () => {
        registerAsV0173({
            kind: "cache",
            engines: ["redis"],
            defaultEngine: "redis",
            envBases: ["REDIS_URL"],
            optionKeys: [],
            implicitDefault: false
        } as ResourceKindSpec);
        expect(resourceKind("cache")?.engines).toContain("redis");
        expect(resourceKinds().map(k => k.kind)).toContain("cache");
    });

    /**
     * The guarantee that must NOT be softened by any of the above: two current
     * copies claiming one kind at the same revision is a real conflict, and
     * still fails loudly. Losing this would let a genuine double-definition
     * through as a warning.
     */
    it("still throws for two current-era specs at the same revision", () => {
        expect(() => registerResourceKind({
            ...DATABASE_0_17_2,
            revision: 1,
            engines: ["postgres"]
        } as ResourceKindSpec)).toThrow(/already registered with a different definition at revision 1/);
    });
});
