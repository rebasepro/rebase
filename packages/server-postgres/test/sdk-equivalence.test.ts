/**
 * The typed SDK is generated from table descriptors, and for every plan-golden
 * corpus set it is what the collection generator wrote:
 *
 *     generateTypedefs(compileTables(collectionsToTableDefs(S)))  ≡  golden(S)
 *
 * One golden per set, `fixtures/sdk-golden/<set>.ts.txt` (the control plane's
 * beside its own plan goldens, in its private checkout), recorded from the
 * collection generator before it was replaced and never edited. Where a line
 * cannot be the same, a rule of `SDK_ALLOWED_DIFFERENCES`
 * (`packages/codegen/test/helpers/sdk-diff.ts`) must explain it from the
 * descriptor of its table — one reason per rule, never a list of lines — and
 * every rule must still be needed by some set.
 *
 * Sets are converted exactly as `helpers/plan-tables.ts` converts them for plan-golden,
 * including its two input adjustments.
 */
import fs from "node:fs";
import path from "node:path";

import { compileTables, toTableAccessor, type AnySchemaDef } from "@rebasepro/common";
import { collectionsToTableDefs } from "@rebasepro/common/migrate";
import { generateTypedefs } from "@rebasepro/codegen";
import {
    isPostgresCollectionConfig,
    isRelationDef,
    isTableDef,
    isViewDef,
    type CollectionConfig,
    type SecurityRule,
    type TableDescriptor
} from "@rebasepro/types";

import { compareSdk, unexplainedDifferences, SDK_ALLOWED_DIFFERENCES, type SdkDifference } from "../../codegen/test/helpers/sdk-diff";
import { PLAN_GOLDEN_DIR, SAAS_PLAN_GOLDEN_DIR, loadPlanCorpus, type PlanCorpus, type PlanCorpusSet } from "./helpers/plan-corpus";

/** Where a set's SDK golden lives: beside its plan goldens' root. */
function sdkGoldenPath(set: PlanCorpusSet): string {
    const root = set.goldenRoot === SAAS_PLAN_GOLDEN_DIR
        ? path.join(path.dirname(SAAS_PLAN_GOLDEN_DIR), "sdk-golden")
        : path.join(path.dirname(PLAN_GOLDEN_DIR), "sdk-golden");
    return path.join(root, `${set.id}.ts.txt`);
}

/**
 * The input adjustments of `helpers/plan-tables.ts` — fields the table model
 * cannot say, stripped before converting — with the keys each takes out of the
 * SDK.
 */
const INPUT_ADJUSTMENTS: { set: string; reason: string; apply: (collections: CollectionConfig[]) => void; removed: { table: string; keys: string[] }[] }[] = [
    {
        set: "property-matrix",
        reason: "`arrs.ofTuple` declares a tuple, which no JSON shape can say; without its `of` it is typed as it was (`Array<unknown>`).",
        apply: collections => {
            const property = collections.find(c => c.slug === "arrs")?.properties.ofTuple;
            if (property?.type === "array") delete property.of;
        },
        removed: []
    },
    {
        set: "property-matrix",
        reason: "`authors.commentsVia` is a `via` written with `path` instead of `joinPath`: nothing can traverse it, so the " +
            "conversion refuses it, and it leaves `Row` and `Relations`.",
        apply: collections => {
            const authors = collections.find(c => c.slug === "authors");
            if (!authors || !isPostgresCollectionConfig(authors)) return;
            delete authors.properties.commentsVia;
            authors.relations = authors.relations?.filter(relation => relation.relationName !== "commentsVia");
        },
        removed: [{ table: "authors", keys: ["commentsVia"] }]
    }
];

/** The directory's `defaultSecurityRules`, as the loader leaves them (see `helpers/plan-tables.ts`). */
function sharedDefaultRules(collections: readonly CollectionConfig[]): readonly SecurityRule[] | undefined {
    if (collections.some(collection => !collection.securityRules?.length)) return undefined;
    const counts = new Map<readonly SecurityRule[], number>();
    for (const collection of collections) {
        const rules = collection.securityRules;
        if (rules && rules.length > 0) counts.set(rules, (counts.get(rules) ?? 0) + 1);
    }
    for (const [rules, count] of counts) if (count > 1) return rules;
    return undefined;
}

/**
 * A set as descriptors: lifted, compiled with the relation targets the lift
 * converted on the side (a relation must resolve), and those left out again.
 */
function descriptorsOf(collections: readonly CollectionConfig[]): TableDescriptor[] {
    const defaultSecurityRules = sharedDefaultRules(collections);
    const { tables, defaultRls } = collectionsToTableDefs(collections, defaultSecurityRules ? { defaultSecurityRules } : {});
    const all: AnySchemaDef[] = [...tables];
    for (let index = 0; index < all.length; index++) {
        for (const relation of Object.values(all[index].config.relations ?? {})) {
            if (!isRelationDef(relation)) continue;
            const target = relation.target();
            if ((isTableDef(target) || isViewDef(target)) && !all.includes(target)) all.push(target);
        }
    }
    return compileTables(all, defaultRls ? { defaultRls } : {}).slice(0, tables.length);
}

function quietly<T>(run: () => T): T {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
        return run();
    } finally {
        warn.mockRestore();
    }
}

describe("sdk equivalence: generateTypedefs(compileTables(collectionsToTableDefs(S))) writes the recorded SDK", () => {
    let corpus: PlanCorpus;

    beforeAll(async () => {
        corpus = await loadPlanCorpus();
        for (const adjustment of INPUT_ADJUSTMENTS) {
            const set = corpus.sets.find(candidate => candidate.id === adjustment.set);
            if (!set) throw new Error(`An input adjustment names the set "${adjustment.set}", which the corpus does not have.`);
            adjustment.apply(set.collections);
        }
    }, 180_000);

    afterAll(() => corpus?.dispose());

    it("reproduces every set's golden, every difference explained by a rule", () => {
        const failures: { set: string; unexplained: SdkDifference[] }[] = [];
        const used = new Set<string>();
        for (const set of corpus.sets) {
            const golden = fs.readFileSync(sdkGoldenPath(set), "utf-8");
            let tables: TableDescriptor[];
            let generated: string;
            try {
                tables = quietly(() => descriptorsOf(set.collections));
                generated = quietly(() => generateTypedefs(tables));
            } catch (error) {
                failures.push({ set: set.id, unexplained: [{ table: "(file)", block: "(refused)", kind: "changed", generated: String(error) }] });
                continue;
            }
            const removed = INPUT_ADJUSTMENTS.filter(adjustment => adjustment.set === set.id).flatMap(adjustment => adjustment.removed);
            const differences = compareSdk(golden, generated).filter(difference =>
                !(difference.kind === "removed" && difference.key !== undefined
                    && removed.some(entry => entry.table === difference.table && entry.keys.includes(difference.key ?? ""))));
            const byAccessor = new Map(tables.map(table => [toTableAccessor(table.slug), table]));
            const { unexplained, used: rules } = unexplainedDifferences(differences, byAccessor);
            for (const rule of rules) used.add(rule);
            if (unexplained.length > 0) failures.push({ set: set.id, unexplained });
        }
        expect(failures).toEqual([]);
        // A rule no set needs is a difference that went away: drop it.
        expect(SDK_ALLOWED_DIFFERENCES.map(rule => rule.id).filter(id => !used.has(id))).toEqual([]);
    });

    it("does not depend on the order the tables arrive in", () => {
        for (const set of corpus.sets) {
            const tables = quietly(() => descriptorsOf(set.collections));
            const forward = quietly(() => generateTypedefs(tables));
            const backward = quietly(() => generateTypedefs([...tables].reverse()));
            expect({ set: set.id, output: backward }).toEqual({ set: set.id, output: forward });
        }
    });
});
