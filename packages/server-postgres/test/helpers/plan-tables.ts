/**
 * Planner fixtures the plan oracles share: how a frozen legacy corpus set is
 * lifted into table definitions (the input adjustments a set needs first, the
 * directory defaults it carried), and compiled.
 *
 * `test/helpers/tables.ts` is the package's fixture helper for driver tests;
 * this file holds only what the planner's oracles add on top of it.
 */
import {
    compileSchema,
    relationalCollections
} from "@rebasepro/common";
import {
    collectionsToTableDefs,
    isLegacyPostgresCollection,
    type LegacyCollectionConfig,
    type LegacyPostgresCollectionConfig,
    type LegacyPostgresProperties
} from "@rebasepro/common/migrate";
import type {
    AnyTableDef,
    AnyViewDef,
    CompiledTable,
    DefaultRls,
    PostgresCollectionConfig,
    SecurityRule
} from "@rebasepro/types";
import { planSchema } from "../../src/schema/plan/plan-schema";
import { buildTableSearchColumnSpec, type SearchColumnSpec } from "../../src/schema/search-column";
import { buildTableIndexSpecs, type TableIndexSpec } from "../../src/schema/table-index";
import type { PlanOptions, SchemaPlan } from "../../src/schema/plan/types";

/**
 * A legacy field stripped from a set before it is converted, because the table
 * model cannot say it and the conversion refuses it — with why no golden
 * depends on it. Applied once, in place, before anything is planned (the
 * relation cache is per collection object).
 */
export const INPUT_ADJUSTMENTS: { set: string; reason: string; apply: (collections: LegacyCollectionConfig[]) => void }[] = [
    {
        set: "property-matrix",
        reason: "`arrs.ofTuple` declares a tuple (`of: [string, number]`), which no JSON shape of the table model can say. " +
            "The planner reads no `of` from a tuple — the column is `jsonb` either way — so dropping it changes no planned byte; " +
            "only the OpenAPI document described the tuple.",
        apply: collections => {
            const property = collections.find(c => c.slug === "arrs")?.properties.ofTuple;
            if (property?.type === "array") delete property.of;
        }
    },
    {
        set: "property-matrix",
        reason: "`authors.commentsVia` is a `via` relation written with `path` instead of `joinPath`, so it has no join path " +
            "and nothing can traverse it; the conversion refuses it. A `via` relation plans no column, constraint, junction " +
            "or Drizzle relation, so removing it (and the property addressing it) changes no planned byte.",
        apply: collections => {
            const authors = collections.find(c => c.slug === "authors");
            if (!authors || !isLegacyPostgresCollection(authors)) return;
            delete authors.properties.commentsVia;
            authors.relations = authors.relations?.filter(relation => relation.relationName !== "commentsVia");
        }
    }
];

/**
 * The directory's `defaultSecurityRules`, as the loader leaves them: the one
 * rules array several collections share by reference (the loader assigns the
 * same array to every collection that declares none).
 */
export function sharedDefaultRules(collections: readonly LegacyCollectionConfig[]): readonly SecurityRule[] | undefined {
    // Where the loader applied defaults, no collection is left without rules;
    // an in-memory fixture sharing a constant between some collections is not
    // a directory with defaults.
    if (collections.some(collection => !collection.securityRules?.length)) return undefined;
    const counts = new Map<readonly SecurityRule[], number>();
    for (const collection of collections) {
        const rules = collection.securityRules;
        if (rules && rules.length > 0) counts.set(rules, (counts.get(rules) ?? 0) + 1);
    }
    for (const [rules, count] of counts) if (count > 1) return rules;
    return undefined;
}

/** A legacy set as table definitions, with the `defaultRls` its directory defaults lift to. */
export function liftSet(collections: readonly LegacyCollectionConfig[]): { defs: (AnyTableDef | AnyViewDef)[]; defaultRls?: DefaultRls } {
    const defaultSecurityRules = sharedDefaultRules(collections);
    const { tables, defaultRls } = collectionsToTableDefs(collections, defaultSecurityRules ? { defaultSecurityRules } : {});
    return defaultRls ? { defs: tables, defaultRls } : { defs: tables };
}

/**
 * A legacy set lifted and compiled: what the backend runs on.
 *
 * Three things a collection literal can say that a table cannot are settled
 * first, so a test written against the legacy planner keeps testing the
 * Postgres tables it meant:
 * - a collection another engine stores (Firestore) is left out — the legacy
 *   planner left it out too, and no table can describe one;
 * - a relation target the literal reaches only through its `target()` thunk
 *   is added to the set, because the legacy planner resolved it there and a
 *   table's relation must point at a table being compiled;
 * - the {@link INPUT_ADJUSTMENTS} (legacy shapes no planned byte depends on)
 *   are applied wherever their collections appear.
 */
export function compileSet(collections: readonly LegacyCollectionConfig[]): CompiledTable[] {
    const postgres = relationalCollections(collections);
    for (const adjustment of INPUT_ADJUSTMENTS) adjustment.apply(postgres);
    const { defs, defaultRls } = liftSet(withRelationTargets(postgres));
    return compileSchema(defs, defaultRls ? { defaultRls } : {});
}

/**
 * The collections, then every relation target they reach and do not list, in
 * discovery order — copied, with every relation's target rebound to the
 * member of the set that has its slug. The legacy planner resolved a target by
 * slug among the collections it was given (a test swaps in a variant of one
 * table and the others' relations reach the variant); the lift resolves a
 * target by identity, so the copies point at each other.
 */
function withRelationTargets(collections: readonly LegacyCollectionConfig[]): LegacyCollectionConfig[] {
    const members = new Map<string, LegacyCollectionConfig>();
    const queue = [...collections];
    for (let index = 0; index < queue.length; index++) {
        const collection = queue[index];
        if (members.has(collection.slug)) continue;
        members.set(collection.slug, collection);
        for (const relation of relationsOf(collection)) queue.push(relation.target());
    }
    const copies = new Map<string, LegacyCollectionConfig>();
    const rebound = (target: LegacyCollectionConfig): LegacyCollectionConfig => copies.get(target.slug) ?? target;
    for (const [slug, collection] of members) {
        if (!isLegacyPostgresCollection(collection)) {
            copies.set(slug, collection);
            continue;
        }
        const properties: LegacyPostgresProperties = {};
        for (const [key, property] of Object.entries(collection.properties ?? {})) {
            if (property.type === "relation" && property.relation) {
                const target = property.relation.target;
                properties[key] = { ...property, relation: { ...property.relation, target: () => rebound(target()) } };
            } else {
                properties[key] = property;
            }
        }
        const copy: LegacyPostgresCollectionConfig = { ...collection, properties };
        if (collection.relations) {
            copy.relations = collection.relations.map(relation => {
                const target = relation.target;
                return { ...relation, target: () => rebound(target()) };
            });
        }
        copies.set(slug, copy);
    }
    return [...copies.values()];
}

/** Every relation a collection declares: its `relations` and its inline relation properties. */
function relationsOf(collection: LegacyCollectionConfig): { target: () => LegacyCollectionConfig }[] {
    if (!isLegacyPostgresCollection(collection)) return [];
    const inline = Object.values(collection.properties ?? {})
        .flatMap(property => (property.type === "relation" && property.relation ? [property.relation] : []));
    return [...(collection.relations ?? []), ...inline];
}

/**
 * The search column the planner builds for a fixture collection: lifted,
 * compiled, and read from its descriptor (`buildTableSearchColumnSpec`).
 * `undefined` when it declares no search; throws what the compiler or the
 * spec builder refuses.
 */
export function searchSpecOf(collection: LegacyCollectionConfig): SearchColumnSpec | undefined {
    const [table] = compileSet([collection]);
    return buildTableSearchColumnSpec(table.descriptor);
}

/**
 * The indexes the planner builds for a fixture collection: lifted, compiled,
 * and read from its descriptor (`buildTableIndexSpecs`).
 */
export function indexSpecsOf(collection: LegacyCollectionConfig): TableIndexSpec[] {
    const table = compileSet([collection]).find(candidate => candidate.descriptor.slug === collection.slug);
    if (!table) throw new Error(`the fixture "${collection.slug}" did not compile to a table`);
    return buildTableIndexSpecs(table.descriptor);
}

/**
 * A legacy set planned: lifted, compiled, and handed to `planSchema` — the
 * one door a test with collection literals plans through.
 */
export function planCollections(collections: readonly LegacyCollectionConfig[], options?: PlanOptions): SchemaPlan {
    return planSchema(compileSet(collections), options);
}

/**
 * A (set, output) whose recorded bytes the legacy corpus no longer reproduces
 * once lifted into the table model, and why. The goldens were recorded from
 * the legacy planner; the planner now takes compiled tables, so a corpus set
 * reaches it lifted (`collectionsToTableDefs` → `compileSchema`). Kept as
 * small as the table model allows; each entry is a reviewed difference, never
 * an edited golden.
 */
export const PLAN_GOLDEN_ALLOWED_DIFFERENCES: { set: string; output: string; reason: string }[] = [];

/**
 * A legacy `reference` property is a column holding the target's key with a
 * `FOREIGN KEY` and nothing else: no index, no relation. The table model
 * creates a constraint only through `rel.belongsTo`, so it lifts to the column
 * plus `rel.belongsTo(target, { localKey, index: false })` named
 * `<key>Relation`. Every DDL file and every policy is identical; what moves:
 * the Drizzle file gains that `one()` relation, the plan records the column's
 * source as a relation (and, where its key is not the camelCase of its SQL
 * name, as a property plus the relation's constraint-only entry), and a
 * reference whose target is not in the set — a plain column now — is added by
 * the boot plan in its scalar pass rather than its link pass.
 */
const REFERENCE = "a `reference` (FK without index or relation) lifts to a column + `rel.belongsTo({ index: false })` named `<key>Relation`; DDL and policies identical";

/**
 * A `belongsTo` whose foreign key the legacy planner serves under the
 * relation's own key (introspection writes `reportsTo` for a `reports_to`
 * column). A table keeps a column and a relation apart, so the column keeps
 * the key — it is on every row — and the relation is renamed `<key>Relation`,
 * its `localKey` pinned. The DDL is identical; the Drizzle relation's name, the
 * plan's `source.propName` and the include key change.
 */
const RENAMED = "a relation served under its own FK column's key is renamed `<key>Relation` (column and relation keys must differ); DDL identical";

/**
 * A relation property `required` over a property-owned column that is
 * nullable (introspection marks the relation, not the column). The table
 * model has one answer, the column's; only the OpenAPI document and the SDK
 * read the relation's. The plan's constraint-only entry takes the column's
 * nullability (and `relational-columns.json`, which reports the created
 * column, reads as the goldens do).
 */
const REQUIRED = "a relation `required` over a nullable property-owned column takes the column's nullability (the plan's constraint-only entry); DDL identical";

/**
 * `str_id_sql_bare` declares `id` with `isId: "gen_random_uuid()::text"`,
 * which is byte for byte the implicit key the planner gives a keyless
 * collection. The table model writes both as the same first column, and
 * lowering reads that column as the implicit key: the Drizzle file lists it
 * last, as it does every implicit key, and the plan's source says
 * `implicit-id`.
 */
const IMPLICIT_ID = "an explicit `id` key equal to the implicit `gen_random_uuid()::text` key lowers as the implicit key (Drizzle lists it last)";

PLAN_GOLDEN_ALLOWED_DIFFERENCES.push(
    { set: "derived-names", output: "plan.json", reason: REFERENCE },
    { set: "derived-names", output: "relational-columns.json", reason: REFERENCE },
    { set: "derived-names", output: "boot-ensure.json", reason: REFERENCE },
    { set: "derived-names", output: "schema.generated.ts", reason: REFERENCE },
    { set: "derived-names", output: "schema.generated.no-policies.ts", reason: REFERENCE },
    { set: "property-matrix", output: "plan.json", reason: `${REFERENCE}; ${IMPLICIT_ID}` },
    { set: "property-matrix", output: "relational-columns.json", reason: REFERENCE },
    { set: "property-matrix", output: "boot-ensure.json", reason: REFERENCE },
    { set: "property-matrix", output: "schema.generated.ts", reason: `${REFERENCE}; ${IMPLICIT_ID}` },
    { set: "property-matrix", output: "schema.generated.no-policies.ts", reason: `${REFERENCE}; ${IMPLICIT_ID}` },
    { set: "real-schema.chinook", output: "plan.json", reason: RENAMED },
    { set: "real-schema.chinook", output: "schema.generated.ts", reason: RENAMED },
    { set: "real-schema.chinook", output: "schema.generated.no-policies.ts", reason: RENAMED },
    { set: "real-schema.musicbrainz", output: "plan.json", reason: `${RENAMED}; ${REQUIRED}` },
    { set: "real-schema.musicbrainz", output: "schema.generated.ts", reason: RENAMED },
    { set: "real-schema.musicbrainz", output: "schema.generated.no-policies.ts", reason: RENAMED },
    { set: "real-schema.northwind", output: "plan.json", reason: `${RENAMED}; ${REQUIRED}` },
    { set: "real-schema.northwind", output: "schema.generated.ts", reason: RENAMED },
    { set: "real-schema.northwind", output: "schema.generated.no-policies.ts", reason: RENAMED },
    { set: "real-schema.openstreetmap", output: "plan.json", reason: `${RENAMED}; ${REQUIRED}` },
    { set: "real-schema.openstreetmap", output: "schema.generated.ts", reason: RENAMED },
    { set: "real-schema.openstreetmap", output: "schema.generated.no-policies.ts", reason: RENAMED }
);

/**
 * A recorded refusal whose message moved, and why. Every configuration the
 * legacy planner refused is still refused; these are now refused before the
 * planner — by the lift (`collectionsToTableDefs`) or by `compileTables` — in
 * the table model's vocabulary, so the recorded legacy message cannot match
 * byte for byte. `pattern` is what the new message must say instead.
 */
export const PLAN_REFUSAL_ALLOWED_MESSAGES: { id: string; pattern: RegExp; reason: string }[] = [
    { id: "property-matrix.empty_enum", pattern: /declares an empty `enum`/, reason: "refused by the lift, before the planner" },
    { id: "property-matrix.empty_enum_num", pattern: /`\.oneOf\(\[\]\)` accepts no value at all/, reason: "a number enum lifts to `.oneOf([])`, which `compileTables` refuses; the legacy planner said `empty \`enum\``" },
    { id: "property-matrix.str_id_cuid", pattern: /isId: "cuid"/, reason: "refused by the lift, before the planner" },
    { id: "property-matrix.str_id_increment", pattern: /`isId: "increment"` needs a number property/, reason: "refused by the lift, before the planner" },
    { id: "property-matrix.num_id_uuid", pattern: /`isId: "uuid"` needs a string property/, reason: "refused by the lift, before the planner" },
    { id: "property-matrix.link_into_composite", pattern: /one column cannot reference a composite key/, reason: "refused by `compileTables`, before the planner" },
    { id: "property-matrix.link-into-composite-set", pattern: /one column cannot reference a composite key/, reason: "refused by `compileTables`, before the planner" }
];
