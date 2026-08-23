import { ADMIN_COLLECTION_KEYS, ADMIN_PROPERTY_KEYS } from "@rebasepro/types";
import type { PostgresCollectionConfig, FirebaseCollectionConfig, MongoDBCollectionConfig } from "@rebasepro/types";

import { logger } from "../utils/logger";

/**
 * A strict parse of every collection config, run at boot.
 *
 * Nothing used to check these files. A config written against an older version
 * loaded clean, and whichever keys had moved since were simply ignored — no
 * warning, no log line, no failed boot. The collection still served rows, so
 * the only signal was the feature quietly not being there: an icon that never
 * appeared, a relation that answered `[]`, a `readOnly` field the panel let you
 * edit. The renames are not the problem; a rename with no runtime signal is.
 *
 * Two severities, because two different things are being detected:
 *
 * - A **known-removed or known-renamed key** is high-confidence and actionable —
 *   we know what it used to mean and what replaced it. That is an error, and
 *   refusing to boot is the point. A minute of downtime beats a week of "where
 *   did my icons go".
 * - An **unrecognised key** is not. Configs legitimately carry extra metadata,
 *   and a key we do not know may simply be newer than this list. That warns,
 *   loudly, and escalates to an error only when asked
 *   (`REBASE_STRICT_COLLECTION_CONFIG=error`, or an explicit option).
 *
 * Everything is reported in one pass. Someone migrating a project wants the
 * whole list once, not fifty-five sequential boots.
 *
 * This is not `validateCollectionJson` in `@rebasepro/admin`. That one parses a
 * JSON string pasted into the panel's import dialog and checks value *shapes*
 * against the flat `AdminCollection` view model. This one checks key *identity*
 * against the authoring contract, on live objects, in a package that may not
 * import the admin. The two answer different questions about different types,
 * and merging them would mean the server depending on the admin panel.
 */

/** How an unrecognised key is treated. */
export type UnknownKeyPolicy = "warn" | "error" | "off";

export interface ConfigProblem {
    severity: "error" | "warning";
    /** Dotted path into the config, e.g. `posts.properties.author`. */
    path: string;
    message: string;
}

export interface ValidateCollectionConfigOptions {
    /**
     * What to do with a key that is in no known list. Defaults to the
     * `REBASE_STRICT_COLLECTION_CONFIG` environment variable, and to `"warn"`
     * when that is unset.
     */
    unknownKeys?: UnknownKeyPolicy;
}

/**
 * Read the unknown-key policy from the environment.
 *
 * `REBASE_STRICT_COLLECTION_CONFIG` accepts `error`/`strict`/`1`/`true` to
 * escalate, `off`/`0`/`false` to silence, and anything else warns.
 */
export function unknownKeyPolicyFromEnv(
    env: Record<string, string | undefined> = process.env
): UnknownKeyPolicy {
    const raw = env.REBASE_STRICT_COLLECTION_CONFIG?.trim().toLowerCase();
    if (!raw) return "warn";
    if (["error", "strict", "1", "true", "yes"].includes(raw)) return "error";
    if (["off", "0", "false", "no", "none"].includes(raw)) return "off";
    return "warn";
}

// ─────────────────────────────────────────────────────────────────────────────
// The contract, as data.
//
// Every list below is derived from `packages/types/src/types/*` at the version
// this file ships with. `ADMIN_COLLECTION_KEYS` and `ADMIN_PROPERTY_KEYS` are
// imported rather than copied — core owns them and `@rebasepro/admin-types`
// type-checks them against the option types, so those two cannot drift.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `BaseCollectionConfig`, plus every engine-specific field, plus the `admin`
 * block.
 *
 * A `as const` tuple rather than a bare `Set` so the compile-time assertion
 * below can compare it against the config types. It was a hand-maintained list
 * checked by nothing, and it drifted the first time a key was added: `search`
 * landed on `PostgresCollectionConfig`, typechecked everywhere, shipped, and
 * was then discarded at boot by this file with a warning nobody was watching —
 * a declared feature that silently did nothing in production.
 */
const COLLECTION_KEY_LIST = [
    // BaseCollectionConfig
    "slug",
    "name",
    "singularName",
    "description",
    "childCollections",
    "dataSource",
    "engine",
    "databaseId",
    "properties",
    "auth",
    "disableDefaultPolicies",
    "callbacks",
    "ownerId",
    "metadata",
    "history",
    "strictWrites",
    "table",
    "relations",
    "securityRules",
    // PostgresCollectionConfig
    "schema",
    "search",
    // FirebaseCollectionConfig / MongoDBCollectionConfig
    "path",
    "subcollections",
    // Added back by @rebasepro/admin-types through declaration merging. Its
    // contents belong to the admin panel and are deliberately not checked here.
    "admin"
] as const;

const COLLECTION_KEYS = new Set<string>(COLLECTION_KEY_LIST);

// ── The list cannot drift from the types ─────────────────────────────────────
//
// Every key of every engine's config must appear above. If one does not,
// `MissingCollectionKeys` stops being `never` and `AssertNever` fails to
// compile — so adding a key to a config type and forgetting this list is a
// build error here rather than a silently ignored block in someone's project.
//
// `pnpm run typecheck` reads this file; a jest test could not, because ts-jest
// is transpile-only in this repo.

/** Compiles only when `T` is `never`. */
type AssertNever<T extends never = never> = T;

/** Keys the config types declare that {@link COLLECTION_KEY_LIST} does not. */
type MissingCollectionKeys = Exclude<
    | keyof PostgresCollectionConfig
    | keyof FirebaseCollectionConfig
    | keyof MongoDBCollectionConfig,
    typeof COLLECTION_KEY_LIST[number]
>;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _EveryCollectionKeyIsListed = AssertNever<MissingCollectionKeys>;

/** `BaseProperty` — legal on a property of any type. */
const BASE_PROPERTY_KEYS = [
    "type",
    "name",
    "description",
    "propertyConfig",
    "columnName",
    "defaultValue",
    "validation",
    "excludeFromApi",
    "dynamicProps",
    "conditions",
    "callbacks",
    "metadata",
    // as above: added by @rebasepro/admin-types, contents not checked here.
    "admin"
];

/**
 * Keys valid at the TOP LEVEL of a property, by type.
 *
 * Presentation is not among them. It moved into the property's `admin` block in
 * 0.11, and `PROPERTY_MIGRATIONS` carries a hint for every key in
 * `ADMIN_PROPERTY_KEYS` telling an author to move it — generated from that list,
 * so it cannot fall behind.
 *
 * Seven of those keys were nevertheless listed here, on the four types they used
 * to live on: `fixedFilter`, `includeId`, `includeEntityLink` (reference and
 * relation), `widget` (relation), `sortable`, `canAddElements` (array) and
 * `previewProperties` (map). This allowlist is consulted first, so on exactly
 * those types the key was accepted, the migration hint was never reached, and
 * nothing read the value — a config written against the pre-0.11 shape booted
 * clean with the option silently dropped, while the identical key on any other
 * type failed with a helpful message. The inconsistency is what made it hard to
 * see: it looked like the feature worked on the types it was documented for.
 *
 * The rule this file now keeps: nothing in `ADMIN_PROPERTY_KEYS` belongs in any
 * list here. `admin-keys-are-not-top-level.test.ts` asserts it for every key and
 * every type, so a key added to the admin block later cannot be added here too.
 */
const PROPERTY_KEYS_BY_TYPE: Record<string, string[]> = {
    string: ["columnType", "isId", "enum", "storage", "userSelect", "email", "url"],
    number: ["columnType", "isId", "enum"],
    boolean: [],
    date: ["columnType", "mode", "timezone", "autoValue"],
    geopoint: [],
    binary: [],
    vector: ["dimensions", "index"],
    reference: ["isId", "path"],
    relation: ["isId", "relation", "resolvedRelation"],
    array: ["columnType", "of", "oneOf"],
    map: ["columnType", "properties", "propertiesOrder", "keyValue"]
};

const PROPERTY_TYPES = Object.keys(PROPERTY_KEYS_BY_TYPE);

/** `RelationBase` plus the fields of every `kind` in the tagged union. */
const RELATION_KEYS = new Set<string>([
    "kind",
    "relationName",
    "target",
    "onUpdate",
    "onDelete",
    "overrides",
    "validation",
    "localKey",
    "foreignKeyOnTarget",
    "sourceKey",
    "through",
    "joinPath",
    "cardinality"
]);

const RELATION_KINDS = ["belongsTo", "hasOne", "hasMany", "manyToMany", "via"];

/** Which link field each `kind` admits. Anything else is a leftover shape. */
const RELATION_FIELDS_BY_KIND: Record<string, string[]> = {
    belongsTo: ["localKey"],
    hasOne: ["foreignKeyOnTarget", "sourceKey"],
    hasMany: ["foreignKeyOnTarget", "sourceKey"],
    manyToMany: ["through"],
    via: ["joinPath", "cardinality"]
};

const RELATION_LINK_FIELDS = ["localKey", "foreignKeyOnTarget", "sourceKey", "through", "joinPath", "cardinality"];

// ─────────────────────────────────────────────────────────────────────────────
// What used to be legal, and is not.
//
// Sourced from the commits that made each change, not from recollection:
//   • 0.11 `def1195d1` + `e9eae2cf7` — the 38 presentation fields nest under
//     `admin`; the list is ADMIN_COLLECTION_KEYS in core.
//   • 0.11 `078798484` — a property's block is `admin`, not `ui`.
//   • 0.11 `7cee8f501` — the property's presentation fields nested in the first
//     place; the list is ADMIN_PROPERTY_KEYS in core.
//   • 0.11 `60c3a8ec7` — `Relation` becomes a tagged union, and every flat
//     relation field on `RelationProperty` moves into a nested `relation`.
//   • 0.10 `33d096cd5` — `editable` removed; everything is editable by default.
// ─────────────────────────────────────────────────────────────────────────────

interface Migration {
    /** What to do about it, in the imperative. */
    fix: string;
    /** The codemod that does it, if one exists. */
    codemod?: string;
}

/** Collection-level keys that no longer exist at the top level. */
const COLLECTION_MIGRATIONS: Record<string, Migration> = {
    editable: {
        fix: "`editable` was removed in 0.10 — collections are editable by default. Delete it, or use `admin.disableDefaultActions` to take actions away"
    }
};

for (const key of ADMIN_COLLECTION_KEYS) {
    COLLECTION_MIGRATIONS[key] = {
        fix: `\`${key}\` moved into the collection's \`admin\` block in 0.11 — write \`admin: { ${key}: … }\``,
        codemod: "node scripts/codemod/collections-admin-block.mjs"
    };
}

/** Property-level keys that no longer exist at the top level of a property. */
const PROPERTY_MIGRATIONS: Record<string, Migration> = {
    ui: {
        fix: "`ui` was renamed to `admin` in 0.11, to match the collection's block — rename the key"
    },
    editable: {
        fix: "`editable` was removed in 0.10 — properties are editable by default. Use `admin.readOnly` or `admin.disabled` instead"
    }
};

for (const key of ADMIN_PROPERTY_KEYS) {
    PROPERTY_MIGRATIONS[key] = {
        fix: `\`${key}\` belongs in the property's \`admin\` block — write \`admin: { ${key}: … }\``
    };
}

/**
 * The flat relation fields that `RelationProperty` used to carry.
 *
 * All of them moved into the nested `relation` object. Two of them do not
 * survive the move at all: `direction` and `inverseRelationName` were how the
 * old shape said which side owned the link, and the `kind` discriminant says it
 * now.
 */
const RELATION_PROPERTY_MIGRATIONS: Record<string, Migration> = {
    target: { fix: "move `target` inside `relation` — `relation: { kind: …, target: … }`" },
    cardinality: { fix: "`cardinality` is implied by the relation's `kind` (`belongsTo`/`hasOne` are one, `hasMany`/`manyToMany` are many); it survives only on `relation: { kind: \"via\" }`" },
    direction: { fix: "`direction` was removed — the `kind` says which side owns the link. `owning` + one is `belongsTo`, `inverse` + one is `hasOne`, `inverse` + many is `hasMany`, `owning` + many is `manyToMany`" },
    inverseRelationName: { fix: "`inverseRelationName` was removed — name the far side with `relation: { kind: \"hasMany\", foreignKeyOnTarget: … }` instead of pointing at it" },
    localKey: { fix: "move `localKey` inside `relation` — `relation: { kind: \"belongsTo\", localKey: … }`" },
    foreignKeyOnTarget: { fix: "move `foreignKeyOnTarget` inside `relation` — `relation: { kind: \"hasOne\" | \"hasMany\", foreignKeyOnTarget: … }`" },
    through: { fix: "move `through` inside `relation` — `relation: { kind: \"manyToMany\", through: … }`" },
    joinPath: { fix: "move `joinPath` inside `relation` — `relation: { kind: \"via\", joinPath: … }`" },
    onUpdate: { fix: "move `onUpdate` inside `relation`" },
    onDelete: { fix: "move `onDelete` inside `relation`" },
    overrides: { fix: "move `overrides` inside `relation`" },
    relationName: { fix: "move `relationName` inside `relation` — `relation: { kind: …, relationName: … }`" }
};

const RELATION_UNION_CODEMOD = "node scripts/codemod/relations-tagged-union.mjs";

/** Fields the old flat `Relation` carried that the tagged union does not. */
const RELATION_MIGRATIONS: Record<string, Migration> = {
    direction: { fix: RELATION_PROPERTY_MIGRATIONS.direction.fix, codemod: RELATION_UNION_CODEMOD },
    inverseRelationName: { fix: RELATION_PROPERTY_MIGRATIONS.inverseRelationName.fix, codemod: RELATION_UNION_CODEMOD }
};

// ─────────────────────────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

class ProblemCollector {
    readonly problems: ConfigProblem[] = [];

    constructor(private readonly unknownKeys: UnknownKeyPolicy) {
    }

    error(path: string, message: string): void {
        this.problems.push({ severity: "error", path, message });
    }

    /** A key we know moved or died. Always fatal — we know exactly what to do. */
    migrated(path: string, key: string, migration: Migration): void {
        this.error(
            path,
            `\`${key}\` is no longer read here. ${migration.fix}.` +
            (migration.codemod ? ` Run \`${migration.codemod}\` to migrate the whole project.` : "")
        );
    }

    /** A key nobody recognises. Might be metadata, might be newer than us. */
    unknown(path: string, key: string, context: string): void {
        if (this.unknownKeys === "off") return;
        this.problems.push({
            severity: this.unknownKeys === "error" ? "error" : "warning",
            path,
            message:
                `\`${key}\` is not a known ${context} key and is being ignored. ` +
                "If it is deliberate metadata this is safe; if it is a typo or a key from an older " +
                "version, the feature it configures is silently absent."
        });
    }
}

function checkRelation(
    relation: unknown,
    path: string,
    collect: ProblemCollector
): void {
    if (!isPlainObject(relation)) return;

    const kind = relation.kind;
    if (typeof kind !== "string") {
        collect.error(
            path,
            "a relation has no `kind`. Relations became a tagged union in 0.11 — pick one of " +
            `${RELATION_KINDS.join(", ")}. Run \`${RELATION_UNION_CODEMOD}\` to migrate the whole project.`
        );
    } else if (!RELATION_KINDS.includes(kind)) {
        collect.error(path, `\`kind: "${kind}"\` is not a relation kind. Expected one of ${RELATION_KINDS.join(", ")}.`);
    }

    for (const key of Object.keys(relation)) {
        const migration = RELATION_MIGRATIONS[key];
        if (migration) {
            collect.migrated(`${path}.${key}`, key, migration);
            continue;
        }
        if (!RELATION_KEYS.has(key)) {
            collect.unknown(`${path}.${key}`, key, "relation");
        }
    }

    // Each kind admits exactly one link field. A leftover from another shape
    // typechecks against nothing and is honoured by whichever consumer reads it
    // first — which is how a `many` relation carrying a `localKey` corrupted
    // writes before the union closed the door.
    if (typeof kind === "string" && RELATION_FIELDS_BY_KIND[kind]) {
        const allowed = RELATION_FIELDS_BY_KIND[kind];
        for (const field of RELATION_LINK_FIELDS) {
            if (relation[field] !== undefined && !allowed.includes(field)) {
                collect.error(
                    `${path}.${field}`,
                    `\`${field}\` is not valid on a "${kind}" relation. ` +
                    `A "${kind}" takes ${allowed.length ? allowed.map(a => `\`${a}\``).join(" and ") : "no link field"}.`
                );
            }
        }
    }
}

/**
 * `validation.matches`, checked by compiling it.
 *
 * This file is about key *identity* and this is a value — but it is a value
 * with the property the file exists for: no runtime signal. `toPattern` in
 * `write-validation.ts` builds the `RegExp` per request and answers `undefined`
 * when the pattern will not compile, and the caller reads
 * `if (pattern && !pattern.test(value))` — so a pattern with an unclosed
 * bracket does not reject the write, it removes the rule. Every value passes,
 * for the lifetime of the deployment, and the only trace is that the author
 * believes a validation is running.
 *
 * Fatal for the reason a renamed key is fatal: the author wrote a rule to keep
 * something out of their database, and a minute of downtime beats finding out
 * from the data.
 *
 * A `RegExp` literal cannot be wrong here — the engine already compiled it — so
 * only strings are checked.
 */
function checkValidationPattern(
    validation: unknown,
    path: string,
    collect: ProblemCollector
): void {
    if (!isPlainObject(validation)) return;
    const matches = validation.matches;
    if (typeof matches !== "string") return;

    try {
        new RegExp(matches);
    } catch (e) {
        collect.error(
            `${path}.matches`,
            `\`matches: ${JSON.stringify(matches)}\` is not a valid regular expression ` +
            `(${e instanceof Error ? e.message : String(e)}). It would compile to nothing at ` +
            "write time, which does not reject values — it silently drops the rule, and every " +
            "value passes."
        );
    }
}

function checkProperty(
    property: unknown,
    path: string,
    collect: ProblemCollector
): void {
    // A property may be a builder function in some authoring styles; there is
    // nothing to inspect statically, and guessing would be worse than silence.
    if (typeof property === "function") return;

    if (!isPlainObject(property)) {
        collect.error(path, "a property must be an object.");
        return;
    }

    const type = property.type;
    if (typeof type !== "string") {
        collect.error(path, "a property has no `type`.");
    } else if (!PROPERTY_TYPES.includes(type)) {
        collect.error(path, `\`type: "${type}"\` is not a property type. Expected one of ${PROPERTY_TYPES.join(", ")}.`);
    }

    const allowed = new Set<string>([
        ...BASE_PROPERTY_KEYS,
        ...(typeof type === "string" ? PROPERTY_KEYS_BY_TYPE[type] ?? [] : [])
    ]);

    for (const key of Object.keys(property)) {
        if (allowed.has(key)) continue;

        // A relation's flat fields are checked first: `localKey` at the top of a
        // property is a 0.10 config, not an unknown key.
        if (type === "relation" && RELATION_PROPERTY_MIGRATIONS[key]) {
            collect.migrated(`${path}.${key}`, key, { ...RELATION_PROPERTY_MIGRATIONS[key], codemod: RELATION_UNION_CODEMOD });
            continue;
        }

        const migration = PROPERTY_MIGRATIONS[key];
        if (migration) {
            collect.migrated(`${path}.${key}`, key, migration);
            continue;
        }

        collect.unknown(`${path}.${key}`, key, `property (\`${String(type)}\`)`);
    }

    if (type === "relation" && property.relation !== undefined) {
        checkRelation(property.relation, `${path}.relation`, collect);
    }

    checkValidationPattern(property.validation, `${path}.validation`, collect);

    // Recurse into the two composites. `of` may be one property or an array of
    // them; `oneOf.properties` is a record like a map's.
    if (type === "array") {
        const of = property.of;
        if (Array.isArray(of)) {
            of.forEach((entry, index) => checkProperty(entry, `${path}.of[${index}]`, collect));
        } else if (of !== undefined) {
            checkProperty(of, `${path}.of`, collect);
        }
        const oneOf = property.oneOf;
        if (isPlainObject(oneOf) && isPlainObject(oneOf.properties)) {
            checkProperties(oneOf.properties, `${path}.oneOf.properties`, collect);
        }
    }

    if (type === "map" && isPlainObject(property.properties)) {
        checkProperties(property.properties, `${path}.properties`, collect);
    }
}

function checkProperties(
    properties: Record<string, unknown>,
    path: string,
    collect: ProblemCollector
): void {
    for (const [key, property] of Object.entries(properties)) {
        checkProperty(property, `${path}.${key}`, collect);
    }
}

function checkCollection(
    collection: unknown,
    index: number,
    collect: ProblemCollector
): void {
    if (!isPlainObject(collection)) {
        collect.error(`collection[${index}]`, "a collection must be an object.");
        return;
    }

    const slug = typeof collection.slug === "string" && collection.slug ? collection.slug : undefined;
    const at = slug ?? `collection[${index}]`;

    if (!slug) {
        collect.error(
            at,
            "a collection has no `slug`. It is the collection's identity — the URL, the API path and " +
            "the key every relation targets."
        );
    }

    for (const key of Object.keys(collection)) {
        if (COLLECTION_KEYS.has(key)) continue;

        const migration = COLLECTION_MIGRATIONS[key];
        if (migration) {
            collect.migrated(`${at}.${key}`, key, migration);
            continue;
        }

        collect.unknown(`${at}.${key}`, key, "collection");
    }

    if (isPlainObject(collection.properties)) {
        checkProperties(collection.properties, `${at}.properties`, collect);
    } else if (collection.properties !== undefined) {
        collect.error(`${at}.properties`, "`properties` must be an object keyed by property name.");
    }

    if (Array.isArray(collection.relations)) {
        collection.relations.forEach((relation, i) => {
            const name = isPlainObject(relation) && typeof relation.relationName === "string"
                ? relation.relationName
                : String(i);
            checkRelation(relation, `${at}.relations[${name}]`, collect);
        });
    }
}

/**
 * Every problem across every collection, in one pass.
 *
 * Pure: it logs nothing and throws nothing, so callers that want to render the
 * list themselves (the doctor, a test) can.
 */
export function findCollectionConfigProblems(
    collections: readonly unknown[],
    options: ValidateCollectionConfigOptions = {}
): ConfigProblem[] {
    const collect = new ProblemCollector(options.unknownKeys ?? unknownKeyPolicyFromEnv());
    collections.forEach((collection, index) => checkCollection(collection, index, collect));
    return collect.problems;
}

function render(problems: ConfigProblem[]): string {
    return problems.map(p => `  • ${p.path}\n      ${p.message}`).join("\n\n");
}

/**
 * Warn about everything questionable, then refuse to boot if anything is wrong.
 *
 * Warnings are logged even when there are errors: someone migrating wants the
 * whole picture in one run, and the second-most annoying thing after a broken
 * boot is a boot that breaks again on something it could have told you the
 * first time.
 */
export function assertCollectionConfigs(
    collections: readonly unknown[],
    options: ValidateCollectionConfigOptions = {}
): void {
    const problems = findCollectionConfigProblems(collections, options);
    if (problems.length === 0) return;

    const warnings = problems.filter(p => p.severity === "warning");
    const errors = problems.filter(p => p.severity === "error");

    if (warnings.length > 0) {
        logger.warn(
            `[collections] ${warnings.length} unrecognised key(s) in the collection config, ignored:\n\n` +
            render(warnings) +
            "\n\nSet REBASE_STRICT_COLLECTION_CONFIG=error to make these fail the boot.\n"
        );
    }

    if (errors.length === 0) return;

    throw new Error(
        `${errors.length} problem(s) in the collection config.\n\n` +
        "These keys are not read by this version. Nothing would have failed at runtime — " +
        "whatever they configure would simply be absent — so they are fatal at boot instead.\n\n" +
        render(errors) + "\n"
    );
}
