import { ADMIN_REQUEST_POLICY_SUFFIX } from "@rebasepro/utils";
import { atlasExcludePattern, excludePatternParts } from "./atlas-exclude";
import { isGeneratedPolicyName } from "../security/policy-drift";

export interface ExistingChild {
    schema: string;
    table: string;
    name: string;
}

const key = (...parts: string[]): string => JSON.stringify(parts);

const IDENT = '(?:"(?:[^"]|"")*"|[A-Za-z_][\\w$]*)';
const RELATION = `(${IDENT})(?:\\s*\\.\\s*(${IDENT}))?`;
const POLICY = new RegExp(`\\bCREATE\\s+POLICY\\s+(${IDENT})\\s+ON\\s+${RELATION}`, "gi");
const TRIGGER = new RegExp(`\\bCREATE\\s+(?:CONSTRAINT\\s+)?TRIGGER\\s+(${IDENT})[^;]*?\\bON\\s+${RELATION}`, "gi");
const INDEX = new RegExp(`^\\s*CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?(${IDENT})\\s+ON\\s+(?:ONLY\\s+)?${RELATION}`, "gim");

const identifier = (value: string): string => value.startsWith('"')
    ? value.slice(1, -1).replace(/""/g, '"')
    : value.toLowerCase();

/**
 * Collect literal children from migration history. A developer may generate
 * another migration before applying the previous one to the live database.
 * Those children are absent from the live catalog but present in Ptah's
 * replayed source. Only names matter here: later DROP statements can leave an
 * unmatched exclude, which the planning command explicitly permits.
 */
export function historicalChildren(sql: string): { policies: ExistingChild[]; triggers: ExistingChild[]; indexes: ExistingChild[] } {
    const collect = (pattern: RegExp): ExistingChild[] => Array.from(sql.matchAll(pattern), match => ({
        schema: match[3] ? identifier(match[2]) : "public",
        table: identifier(match[3] ?? match[2]),
        name: identifier(match[1])
    }));
    return { policies: collect(POLICY), triggers: collect(TRIGGER), indexes: collect(INDEX) };
}

/**
 * Protect policies and triggers that Rebase does not declare on selected
 * tables. Ptah includes child objects with a selected table, so a foreign
 * child must be excluded by its own name. A superseded generated policy is
 * left in scope so Ptah can remove it. Admin-request companions belong to
 * runtime provisioning and remain outside the declarative plan.
 */
export function unmanagedChildExcludes(
    policies: readonly ExistingChild[],
    triggers: readonly ExistingChild[],
    includes: readonly string[],
    declaredPolicies: ReadonlySet<string>,
    declaredTriggers: ReadonlySet<string>
): string[] {
    const relations = new Set(includes
        .map(excludePatternParts)
        .filter((parts): parts is string[] => parts !== undefined && parts.length === 2)
        .map(parts => key(...parts)));
    return [...new Set([
        ...policies
            .filter(p => relations.has(key(p.schema, p.table)))
            .filter(p => !declaredPolicies.has(key(p.schema, p.table, p.name)))
            .filter(p => ADMIN_REQUEST_POLICY_SUFFIX.test(p.name) || !isGeneratedPolicyName(p.name, p.table))
            .map(p => `${atlasExcludePattern(p.schema, p.table, p.name)}[type=policy]`),
        ...triggers
            .filter(t => relations.has(key(t.schema, t.table)))
            .filter(t => !declaredTriggers.has(key(t.schema, t.table, t.name)))
            .map(t => `${atlasExcludePattern(t.schema, t.table, t.name)}[type=trigger]`)
    ])];
}
