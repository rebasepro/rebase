/**
 * The policy compiler reads compiled tables exactly as it read the collections
 * they were lowered into.
 *
 * For every corpus set (`helpers/plan-corpus.ts`), each table's policies —
 * its effective rules (declared + the injected baseline, auth and tenant
 * rules), each compiled by `compileTableRulePolicies` against
 * `policyTableFromDescriptor` — equal what `compileRulePolicies` compiled from
 * the lowered collection: names, clauses, roles, admin targets and companions.
 * The same for every junction: `resolveTableJunctions` + `tableJunctionRules`
 * against `resolveJunctionSpecs` + `getJunctionSecurityRules`.
 *
 * Policy names hash the rules as written, so equal policies here mean no
 * policy is renamed when the planner moves onto descriptors.
 */
import {
    compileRulePolicies,
    compileTableRulePolicies,
    getEffectiveSecurityRules,
    getJunctionCollectionConfig,
    getJunctionSecurityRules,
    getTableName,
    junctionPolicyTable,
    policyTableFromDescriptor,
    policyTableResolver,
    resolveJunctionSpecs,
    resolveTableJunctions,
    tableEffectiveRules,
    tableJunctionRules,
    type CompiledRulePolicy
} from "@rebasepro/common";
import type { SecurityRule } from "@rebasepro/types";
import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";

import { loadPlanCorpus, withPinnedPlannerWorld, type PlanCorpus } from "./helpers/plan-corpus";
import { INPUT_ADJUSTMENTS, compileSet, lowerSet } from "./helpers/plan-tables";

const SWITCHES = { adminRole: true, adminRequestRole: true } as const;

/** Each rule's policies, or the message it was refused with. */
function compileEach(rules: readonly SecurityRule[], compile: (rule: SecurityRule) => CompiledRulePolicy[]): (CompiledRulePolicy[] | string)[] {
    return rules.map(rule => {
        try {
            return compile(rule);
        } catch (error) {
            return `THROWS: ${error instanceof Error ? error.message : String(error)}`;
        }
    });
}

describe("the policy compiler reads compiled tables as it read lowered collections", () => {
    let corpus: PlanCorpus;

    beforeAll(async () => {
        corpus = await loadPlanCorpus();
        for (const adjustment of INPUT_ADJUSTMENTS) {
            const set = corpus.sets.find(candidate => candidate.id === adjustment.set);
            if (set) adjustment.apply(set.collections);
        }
    }, 180_000);

    afterAll(() => corpus?.dispose());

    it("compiles every table's policies identically, on every set", () => {
        let compared = 0;
        withPinnedPlannerWorld(() => {
            for (const set of corpus.sets) {
                const lowered = lowerSet(set.collections);
                const descriptors = compileSet(set.collections).map(table => table.descriptor);
                const resolveTable = policyTableResolver(descriptors);
                const resolveCollection = (slug: string): LegacyCollectionConfig | undefined =>
                    lowered.find(c => c.slug === slug) ?? lowered.find(c => getTableName(c) === slug);
                for (const descriptor of descriptors) {
                    if (descriptor.kind === "view") continue;
                    const collection = lowered.find(c => c.slug === descriptor.slug);
                    if (!collection) throw new Error(`${set.id}: "${descriptor.slug}" was not lowered`);
                    const table = policyTableFromDescriptor(descriptor);
                    const legacy = compileEach(getEffectiveSecurityRules(collection),
                        rule => compileRulePolicies(collection, rule, { resolveCollection, ...SWITCHES }));
                    const native = compileEach(tableEffectiveRules(table),
                        rule => compileTableRulePolicies(table, rule, { resolveTable, ...SWITCHES }));
                    expect({ set: set.id, table: descriptor.slug, policies: native })
                        .toEqual({ set: set.id, table: descriptor.slug, policies: legacy });
                    compared++;
                }
            }
        });
        expect(compared).toBeGreaterThan(100);
    });

    it("derives every junction's rules and policies identically, on every set", () => {
        let compared = 0;
        withPinnedPlannerWorld(() => {
            for (const set of corpus.sets) {
                const lowered = lowerSet(set.collections);
                const descriptors = compileSet(set.collections).map(table => table.descriptor);
                const resolveTable = policyTableResolver(descriptors);
                const resolveCollection = (slug: string): LegacyCollectionConfig | undefined =>
                    lowered.find(c => c.slug === slug) ?? lowered.find(c => getTableName(c) === slug);
                const specs = resolveJunctionSpecs(lowered);
                const junctions = resolveTableJunctions(descriptors);
                expect({ set: set.id, junctions: [...junctions.keys()] }).toEqual({ set: set.id, junctions: [...specs.keys()] });
                for (const [name, spec] of specs) {
                    const junction = junctions.get(name);
                    if (!junction) continue;
                    expect({
                        set: set.id,
                        junction: name,
                        sides: junction.declaringSides.map(side => side.descriptor.slug)
                    }).toEqual({ set: set.id, junction: name, sides: spec.declaringSides.map(side => side.collection.slug) });
                    const legacyTable = getJunctionCollectionConfig(spec);
                    const nativeTable = junctionPolicyTable(junction);
                    const legacy = compileEach(getJunctionSecurityRules(spec),
                        rule => compileRulePolicies(legacyTable, rule, { resolveCollection, ...SWITCHES }));
                    const native = compileEach(tableJunctionRules(junction),
                        rule => compileTableRulePolicies(nativeTable, rule, { resolveTable, ...SWITCHES }));
                    expect({ set: set.id, junction: name, policies: native })
                        .toEqual({ set: set.id, junction: name, policies: legacy });
                    compared++;
                }
            }
        });
        expect(compared).toBeGreaterThan(0);
    });
});
