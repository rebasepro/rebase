/**
 * The policy compiler's collection-shaped entry points, for tests that state
 * their tables as 0.30 collection literals.
 *
 * The kernel compiles rules against compiled tables only; the collection
 * view of them moved to `@rebasepro/cms-types` with the CMS view model. A
 * fixture goes the way a migrated project goes: lifted
 * (`collectionsToTableDefs`), compiled (`compileTables`), and compiled to
 * policies from its descriptor (`policyTableFromDescriptor` through
 * `policyTableResolver`) — the path `db push` takes.
 */
import { collectionsToTableDefs, type LegacyCollectionConfig } from "../../src/migrate";
import { compileTables } from "../../src/schema/compile-tables";
import { compilePolicyExpression } from "../../src/util/policy/policyToPostgres";
import { compileTableRulePolicies, type CompiledRulePolicy, type RulePolicySwitches } from "../../src/util/policy/compileRulePolicies";
import { policyTableResolver, type PolicyTable, type ResolvePolicyTable } from "../../src/util/policy/policy-table";
import { tableEffectiveRules, tableGeneratedPolicyNames, tableInjectedRules } from "../../src/util/auth-default-policies";
import type { PolicyExpression, SecurityRule } from "@rebasepro/types";

/** The other collections a rule may name (`existsIn` targets, relation targets). */
export interface LegacyPolicyOptions {
    collections?: readonly LegacyCollectionConfig[];
}

/** `collection` lifted and compiled with `collections`, viewed as the policy compiler's table. */
export function liftedPolicyTable(
    collection: LegacyCollectionConfig,
    options?: LegacyPolicyOptions
): { table: PolicyTable; resolveTable: ResolvePolicyTable } {
    const set = [collection, ...(options?.collections ?? []).filter(c => c.slug !== collection.slug)];
    const { tables, defaultRls } = collectionsToTableDefs(set);
    const resolveTable = policyTableResolver(compileTables(tables, defaultRls ? { defaultRls } : {}));
    const table = resolveTable(collection.slug);
    if (!table) throw new Error(`The lift produced no table for "${collection.slug}".`);
    return { table, resolveTable };
}

/** `compilePolicyExpression` against a lifted collection (or no table at all). */
export function policyToPostgres(expr: PolicyExpression, collection?: LegacyCollectionConfig, options?: LegacyPolicyOptions): string {
    if (!collection) {
        const { tables, defaultRls } = collectionsToTableDefs([...(options?.collections ?? [])]);
        return compilePolicyExpression(expr, undefined, {
            resolveTable: policyTableResolver(compileTables(tables, defaultRls ? { defaultRls } : {}))
        });
    }
    const { table, resolveTable } = liftedPolicyTable(collection, options);
    return compilePolicyExpression(expr, table, { resolveTable });
}

/** `compileTableRulePolicies` against a lifted collection. */
export function compileRulePolicies(
    collection: LegacyCollectionConfig,
    rule: SecurityRule,
    options?: LegacyPolicyOptions & RulePolicySwitches
): CompiledRulePolicy[] {
    const { table, resolveTable } = liftedPolicyTable(collection, options);
    return compileTableRulePolicies(table, rule, {
        resolveTable,
        ...(options?.adminRole !== undefined ? { adminRole: options.adminRole } : {}),
        ...(options?.adminRequestRole !== undefined ? { adminRequestRole: options.adminRequestRole } : {})
    });
}

/** `tableEffectiveRules` of a lifted collection. */
export function getEffectiveSecurityRules(collection: LegacyCollectionConfig): SecurityRule[] {
    return tableEffectiveRules(liftedPolicyTable(collection).table);
}

/** `tableInjectedRules` of a lifted collection. */
export function getInjectedSecurityRules(collection: LegacyCollectionConfig): SecurityRule[] {
    return tableInjectedRules(liftedPolicyTable(collection).table);
}

/** `tableGeneratedPolicyNames` of a lifted collection. */
export function getGeneratedPolicyNames(collection: LegacyCollectionConfig): Set<string> {
    return tableGeneratedPolicyNames(liftedPolicyTable(collection).table);
}
