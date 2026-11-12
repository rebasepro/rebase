import type { StudioSchemaEditing } from "@rebasepro/app";
import type { RlsDescriptor, SecurityRule, SecurityRuleBase, TablePatch } from "@rebasepro/types";
import { rulePatches } from "@rebasepro/types";

import { postTablePatches } from "./saveSecurityRules";
import type { PolicyRule } from "./policyRules";

/**
 * Where a table's security rules go when the RLS editor saves them — the one
 * function every RLS-editor write to the source goes through.
 *
 * The edit is sent as the rule operations it is (`TablePatch`): the rules the
 * table declares, compared with the rules it should declare, by
 * {@link rulePatches} — one `replaceRule` for an edited rule, one `addRule`
 * for an imported one. A policy's name is a hash of its rule as written, so a
 * rule the edit did not touch is never rewritten. A posture is `setRls`:
 * removing the last rule is `"admin-only"`, never an empty list.
 *
 * A table whose rules are inherited from `defaultRls` keeps `"inherit"`
 * unless the person deliberately detaches it: `confirmDetach` asks (naming
 * what happens), and saying no writes nothing.
 *
 * There are two doors onto one file. With a collection editor mounted, the
 * write goes through its plan/apply flow — planned, shown as SQL, confirmed,
 * applied to the database — arriving over the Studio bridge as
 * {@link StudioSchemaEditing} (`@rebasepro/cms` is a *peer* of
 * `@rebasepro/studio`, which has to run without it). Without one, it goes to
 * the source-only schema editor directly.
 *
 * A separate module from the component so the decision can be asserted
 * without a database and a rendered editor.
 */
export async function saveRules(
    schemaEditing: StudioSchemaEditing,
    transport: { apiBase: string; getAuthToken?: () => Promise<string | null | undefined> },
    table: { slug: string; rls: RlsDescriptor },
    rules: readonly PolicyRule[],
    options: {
        /** Asked before a table on `defaultRls` gets rules of its own; `false` keeps `"inherit"`. */
        confirmDetach: (slug: string) => Promise<boolean>;
    }
): Promise<void> {
    const patches = await rlsEdit(table, rules.map(asSecurityRule), options.confirmDetach);
    if (patches.length === 0) return;
    if (schemaEditing.available) {
        await schemaEditing.applyTablePatches(table.slug, patches);
        return;
    }
    await postTablePatches({ apiBase: transport.apiBase, patches, getAuthToken: transport.getAuthToken });
}

/**
 * A rule the policy editor built — its fields assigned one at a time, so
 * wider than any one variant — as the `SecurityRule` variant its fields make
 * it. Which fields go together is the variants' rule; the editor never sets
 * two that exclude each other ({@link PolicyRule}).
 */
export function asSecurityRule(rule: PolicyRule): SecurityRule {
    const { using, withCheck, ownerField, access, condition, check, redacted, ...rest } = rule;
    const base: SecurityRuleBase = rest;
    if (redacted) return { ...base, redacted, ...(access !== undefined ? { access } : {}) };
    if (using !== undefined) return { ...base, using, ...(withCheck !== undefined ? { withCheck } : {}) };
    if (withCheck !== undefined) return { ...base, withCheck };
    if (ownerField !== undefined) return { ...base, ownerField };
    if (access !== undefined) {
        if (condition !== undefined) return { ...base, access, condition, ...(check !== undefined ? { check } : {}) };
        if (check !== undefined) return { ...base, access, check };
        return access === "public" ? { ...base, access: "public" } : { ...base, access: "authenticated" };
    }
    if (condition !== undefined) return { ...base, condition, ...(check !== undefined ? { check } : {}) };
    return base;
}

/** The person kept `"inherit"`: an answer, matched like the plan dialog's cancellation. */
class DetachDeclined extends Error {
    constructor() {
        super("The table keeps its inherited rules.");
        this.name = "SchemaChangeCancelled";
    }
}

/**
 * The operations that make `table` declare `rules`.
 *
 * Exported for the tests: the decision is the whole of what this module adds.
 */
export async function rlsEdit(
    table: { slug: string; rls: RlsDescriptor },
    rules: readonly SecurityRule[],
    confirmDetach: (slug: string) => Promise<boolean>
): Promise<TablePatch[]> {
    const declared = table.rls.posture === "rules" ? table.rls.rules : [];
    if (table.rls.inherited) {
        if (rules.length === 0 || JSON.stringify(rules) === JSON.stringify(declared)) return [];
        if (!await confirmDetach(table.slug)) throw new DetachDeclined();
        return [{ op: "setRls", table: table.slug, rls: [rules[0], ...rules.slice(1)] }];
    }
    if (rules.length === 0) {
        return declared.length === 0 ? [] : [{ op: "setRls", table: table.slug, rls: "admin-only" }];
    }
    if (declared.length === 0) return [{ op: "setRls", table: table.slug, rls: [rules[0], ...rules.slice(1)] }];
    return rulePatches(table.slug, declared, rules);
}

/**
 * Was this rejection the person closing the plan dialog, or keeping a table's
 * inherited rules?
 *
 * Either is an answer, not a failure, and a caller that treats every
 * rejection as an error reports someone's own choice back to them in red — as
 * the collection editor once did, with "Error persisting collection: The schema
 * change was not applied."
 *
 * Matched by name rather than `instanceof`: `SchemaChangeCancelled` is declared
 * in `@rebasepro/cms`, which this package cannot import, and two copies of a
 * class in one bundle make `instanceof` silently false anyway.
 */
export function isCancellation(err: unknown): boolean {
    return err instanceof Error && err.name === "SchemaChangeCancelled";
}
