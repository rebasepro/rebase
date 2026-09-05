import { ADMIN_COLLECTION_KEYS, ADMIN_PROPERTY_KEYS } from "@rebasepro/types";
import type { PostgresCollectionConfig, FirebaseCollectionConfig, MongoDBCollectionConfig, Property } from "@rebasepro/types";

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
 * This is not `validateCollectionJson` in `@rebasepro/cms`. That one parses a
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
    /**
     * What kind of wrong this is, because the two read very differently and the
     * remedies differ.
     *
     * - `"key"` — a key this version does not read, whether renamed, removed or
     *   simply unrecognised. The feature it configures is absent; the config is
     *   otherwise coherent. `REBASE_STRICT_COLLECTION_CONFIG` governs how loud
     *   the unrecognised half of this is.
     * - `"incoherent"` — every key is recognised and the *combination* cannot do
     *   what it says. That policy has no bearing on these, and saying it did
     *   sent people to an environment variable that would not have helped.
     */
    kind: "key" | "incoherent";
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
// imported rather than copied — core owns them and `@rebasepro/cms-types`
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
    "indexes",
    // FirebaseCollectionConfig / MongoDBCollectionConfig
    "path",
    "subcollections",
    // Added back by @rebasepro/cms-types through declaration merging. Its
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
    // as above: added by @rebasepro/cms-types, contents not checked here.
    "admin"
] as const;

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
const PROPERTY_KEYS_BY_TYPE = {
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
} as const satisfies Record<Property["type"], readonly string[]>;

const PROPERTY_TYPES = Object.keys(PROPERTY_KEYS_BY_TYPE);

// ── This list cannot drift from the property types either ────────────────────
//
// The collection-level list above has had a compile-time assertion since a
// `search` block shipped, generated correct DDL, passed its tests and did
// nothing in production because the list had never heard of it. This one — one
// level down, on properties — did not, so the identical failure was still
// available: add an option to `VectorProperty`, document it, and watch it be
// stripped at boot with a warning nobody reads.
//
// `ADMIN_PROPERTY_KEYS` is excluded rather than listed. Those keys moved into
// the property's `admin` block, and `PROPERTY_MIGRATIONS` carries a hint for
// each one telling an author to move it. Listing them here again is exactly the
// bug the comment above describes: this allowlist is consulted first, so a
// listed key is accepted, the hint is never reached, and nothing reads the
// value. `admin-keys-are-not-top-level.test.ts` asserts the same thing from the
// other direction.

/** Keys a property type declares that neither list accepts. */
type MissingPropertyKeys<T extends Property["type"]> = Exclude<
    keyof Extract<Property, { type: T }>,
    | typeof BASE_PROPERTY_KEYS[number]
    | typeof PROPERTY_KEYS_BY_TYPE[T][number]
    | typeof ADMIN_PROPERTY_KEYS[number]
>;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _EveryPropertyKeyIsListed = AssertNever<{
    [T in Property["type"]]: MissingPropertyKeys<T>
}[Property["type"]]>;

/** `RelationBase` plus the fields of every `kind` in the tagged union. */
const RELATION_KEYS = new Set<string>([
    "kind",
    "relationName",
    "target",
    "onUpdate",
    "onDelete",
    "overrides",
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

/**
 * Keys that no longer exist *inside* the `admin` block.
 *
 * Checked by name, not by completeness — see `checkCollection`.
 */
const ADMIN_BLOCK_MIGRATIONS: Record<string, Migration> = {
    titleProperty: {
        fix: "`titleProperty` was replaced by `admin.display.title` — the same string works there, and `display.title` also takes a resolver for a title the record does not carry"
    }
};

/** Collection-level keys that no longer exist at the top level. */
const COLLECTION_MIGRATIONS: Record<string, Migration> = {
    editable: {
        fix: "`editable` was removed in 0.10 — collections are editable by default. Delete it, or use `admin.disableDefaultActions` to take actions away"
    },
    ...ADMIN_BLOCK_MIGRATIONS
};

for (const key of ADMIN_COLLECTION_KEYS) {
    COLLECTION_MIGRATIONS[key] = {
        fix: `\`${key}\` moved into the collection's \`admin\` block in 0.11 — write \`admin: { ${key}: … }\``,
        codemod: "node tooling/scripts/codemod/collections-admin-block.mjs"
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

const RELATION_UNION_CODEMOD = "node tooling/scripts/codemod/relations-tagged-union.mjs";

/** Fields the old flat `Relation` carried that the tagged union does not. */
const RELATION_MIGRATIONS: Record<string, Migration> = {
    direction: { fix: RELATION_PROPERTY_MIGRATIONS.direction.fix, codemod: RELATION_UNION_CODEMOD },
    inverseRelationName: { fix: RELATION_PROPERTY_MIGRATIONS.inverseRelationName.fix, codemod: RELATION_UNION_CODEMOD },
    // Not a rename: the key already existed one level up, and the two answers
    // were read by different generators. Silence here would leave the surviving
    // one — the property's — unset, and a required relation would quietly
    // become optional in the generated types and nullable in the column.
    validation: {
        fix: "a relation no longer carries its own `validation` — `required` moved to the property's `validation.required`, " +
            "beside every other field's. Write `{ type: \"relation\", validation: { required: true }, relation: { kind: … } }`"
    }
};

// ─────────────────────────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

class ProblemCollector {
    readonly problems: ConfigProblem[] = [];

    constructor(private readonly unknownKeys: UnknownKeyPolicy) {
    }

    error(path: string, message: string, kind: ConfigProblem["kind"] = "incoherent"): void {
        this.problems.push({ severity: "error", kind, path, message });
    }

    /**
     * Config that parses but cannot do what it says.
     *
     * Not gated on `unknownKeys`: that policy is about keys this version has
     * never heard of, where silence is defensible. This is the opposite —
     * every key is recognised, and the combination is known to be wrong.
     */
    warn(path: string, message: string): void {
        this.problems.push({ severity: "warning", kind: "incoherent", path, message });
    }

    /** A key we know moved or died. Always fatal — we know exactly what to do. */
    migrated(path: string, key: string, migration: Migration): void {
        this.error(
            path,
            `\`${key}\` is no longer read here. ${migration.fix}.` +
            (migration.codemod ? ` Run \`${migration.codemod}\` to migrate the whole project.` : ""),
            "key"
        );
    }

    /** A key nobody recognises. Might be metadata, might be newer than us. */
    unknown(path: string, key: string, context: string): void {
        if (this.unknownKeys === "off") return;
        this.problems.push({
            severity: this.unknownKeys === "error" ? "error" : "warning",
            kind: "key",
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

/**
 * An enum's ids and labels, which become a Postgres type and a dropdown.
 *
 * The ids are the enum's SQL labels — `CREATE TYPE "posts_status" AS ENUM
 * ('draft', 'published')` — so a duplicate id is a statement Postgres refuses:
 * `23505` on `pg_enum_typid_label_index`. Boot read that as a lost race with a
 * peer (every `pg_catalog` index violation was one), skipped it, and carried on;
 * the type was never created and the column silently became `TEXT`. The config
 * said "one of these three", the database said "any string", and nothing said
 * anything.
 *
 * A blank id is the same statement with an empty label. A duplicate or blank
 * *label* is not a database error at all — it is a dropdown with two identical
 * options, or one with no text, which is a bug the author cannot see from the
 * config. Both are reported here, where the property has a name.
 *
 * Both forms are checked: the array of `{ id, label }`, and the record whose
 * keys are the ids. The record form cannot have duplicate keys, so only blanks
 * apply to it.
 */
function checkEnumValues(
    values: unknown,
    path: string,
    collect: ProblemCollector
): void {
    const blank = (value: unknown): boolean =>
        typeof value === "string" ? value.trim() === "" : value === undefined || value === null;

    const seenIds = new Map<string, number>();
    const seenLabels = new Map<string, number>();

    const check = (id: unknown, label: unknown, at: string, describe: string): void => {
        if (blank(id)) {
            collect.error(at, `${describe} has a blank \`id\`. The id is the value stored in the column and the label of the Postgres enum type; neither can be empty.`);
        } else if (typeof id === "string" || typeof id === "number") {
            const key = String(id);
            const first = seenIds.get(key);
            if (first !== undefined) {
                collect.error(
                    at,
                    `${describe} repeats the id \`${key}\`, already used at index ${first}. ` +
                    "The ids become the labels of one Postgres enum type, which cannot hold the same label twice — " +
                    "so the `CREATE TYPE` fails and the column falls back to plain text with no enum behind it."
                );
            } else {
                seenIds.set(key, seenIds.size);
            }
        } else {
            collect.error(at, `${describe} has an \`id\` that is neither a string nor a number.`);
        }

        if (blank(label)) {
            collect.error(at, `${describe} has a blank \`label\`, so it renders as an empty option nobody can read.`);
        } else if (typeof label === "string") {
            const first = seenLabels.get(label);
            if (first !== undefined) {
                collect.warn(at, `${describe} repeats the label "${label}", already used at index ${first}. Two options that read identically cannot be told apart in the panel.`);
            } else {
                seenLabels.set(label, seenLabels.size);
            }
        }
    };

    if (Array.isArray(values)) {
        values.forEach((entry, index) => {
            if (!isPlainObject(entry)) {
                collect.error(`${path}[${index}]`, "an enum entry must be an object with `id` and `label`.");
                return;
            }
            check(entry.id, entry.label, `${path}[${index}]`, `enum entry ${index}`);
        });
        return;
    }

    if (isPlainObject(values)) {
        for (const [id, entry] of Object.entries(values)) {
            const label = isPlainObject(entry) ? entry.label : entry;
            check(id, label, `${path}.${id}`, `enum entry \`${id}\``);
        }
        return;
    }

    collect.error(path, "`enum` must be an array of `{ id, label }` or a record of id → label.");
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
        // The narrow index is what makes the compile-time assertion above
        // possible: a `Record<string, string[]>` erases the literals it needs.
        // An unknown `type` is already reported above; here it simply adds no
        // per-type keys.
        ...(typeof type === "string" && type in PROPERTY_KEYS_BY_TYPE
            ? PROPERTY_KEYS_BY_TYPE[type as Property["type"]]
            : [])
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

    if (property.enum !== undefined) {
        checkEnumValues(property.enum, `${path}.enum`, collect);
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

/**
 * A board's two halves, checked against each other and against `properties`.
 *
 * Every failure here parses cleanly, boots, serves rows and renders a board.
 * The only symptom is that dragging does not stick — which no test, no
 * typecheck and no config review catches, because the config is *valid*, just
 * incoherent. The panel says so in an amber bar, but only to whoever opens the
 * board; this says it to whoever starts the server.
 *
 * The order key is a `fractional-indexing` key in the base36, lower-case
 * alphabet (`"i0"`, `"i1"`, `"i0i"`) — a string, always. Postgres does the
 * sorting and its default collation is not byte ordering, which is why the
 * alphabet is single-case; see `useKanbanDragAndDrop.ts` in the admin.
 */
function checkBoardConfig(
    collection: Record<string, unknown>,
    at: string,
    collect: ProblemCollector
): void {
    const admin = isPlainObject(collection.admin) ? collection.admin : undefined;
    if (!admin) return;

    const orderProperty = admin.orderProperty;
    const hasBoard = isPlainObject(admin.kanban)
        || (Array.isArray(admin.enabledViews) && admin.enabledViews.includes("kanban"))
        || admin.defaultViewMode === "kanban";

    if (hasBoard && orderProperty === undefined) {
        collect.warn(
            `${at}.admin.orderProperty`,
            "this collection renders a Kanban board but declares no `orderProperty`, so a card's " +
            "position within a column has nowhere to be stored and resets on the next read. " +
            "(Moving a card *between* columns still works — that writes `kanban.columnProperty`.) " +
            "Add a hidden string property and name it here: " +
            "`__order: { name: \"Order\", type: \"string\", admin: { disabled: true, hideFromCollection: true } }`."
        );
    }

    if (orderProperty === undefined) return;

    if (typeof orderProperty !== "string" || !orderProperty) {
        collect.error(
            `${at}.admin.orderProperty`,
            "`orderProperty` must be the key of a property in this collection."
        );
        return;
    }

    // Only checkable when the collection declares its properties inline. Some
    // authoring styles build them elsewhere, and guessing would be worse than
    // silence — the same rule `checkProperty` applies to builder functions.
    if (!isPlainObject(collection.properties)) return;

    const target = collection.properties[orderProperty];
    if (target === undefined) {
        collect.error(
            `${at}.admin.orderProperty`,
            `\`orderProperty: "${orderProperty}"\` names no property in this collection. ` +
            "Nothing reads or writes it, so the board cannot be reordered at all."
        );
        return;
    }

    if (typeof target === "function") return;
    if (!isPlainObject(target)) return;

    if (target.type !== "string") {
        collect.error(
            `${at}.properties.${orderProperty}`,
            `\`orderProperty\` names a \`${String(target.type)}\` property, and an order key is a string ` +
            "— a `fractional-indexing` key such as \"i0\" or \"i0i\", not an index. Stored values can " +
            "never be valid, so the board asks to be initialised forever and the initialisation itself " +
            "fails writing a string into this column. Change it to `type: \"string\"`."
        );
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

    // Only the keys that were *removed* from the block, never the ones it does
    // not recognise: the block belongs to `@rebasepro/cms-types` and the panel
    // adds to it, so a completeness check here would reject valid config. A
    // removal is different — nothing will read the key again, and a title that
    // silently reverts to the derived one is the failure this prevents.
    if (isPlainObject(collection.admin)) {
        for (const [key, migration] of Object.entries(ADMIN_BLOCK_MIGRATIONS)) {
            if (key in collection.admin) collect.migrated(`${at}.admin.${key}`, key, migration);
        }
    }

    if (isPlainObject(collection.properties)) {
        checkProperties(collection.properties, `${at}.properties`, collect);
    } else if (collection.properties !== undefined) {
        collect.error(`${at}.properties`, "`properties` must be an object keyed by property name.");
    }

    checkBoardConfig(collection, at, collect);

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

    const unknownWarnings = warnings.filter(p => p.kind === "key");
    const incoherentWarnings = warnings.filter(p => p.kind === "incoherent");

    if (unknownWarnings.length > 0) {
        logger.warn(
            `[collections] ${unknownWarnings.length} unrecognised key(s) in the collection config, ignored:\n\n` +
            render(unknownWarnings) +
            "\n\nSet REBASE_STRICT_COLLECTION_CONFIG=error to make these fail the boot.\n"
        );
    }

    // Deliberately not offered the strict-mode escalation: that variable governs
    // unrecognised keys, and pointing at it here would send someone to a switch
    // that does nothing for their problem.
    if (incoherentWarnings.length > 0) {
        logger.warn(
            `[collections] ${incoherentWarnings.length} collection(s) configured for something they cannot do:\n\n` +
            render(incoherentWarnings) + "\n"
        );
    }

    if (errors.length === 0) return;

    const deadKeys = errors.filter(p => p.kind === "key");
    const incoherent = errors.filter(p => p.kind === "incoherent");

    const sections = [
        deadKeys.length > 0
            ? "These keys are not read by this version. Nothing would have failed at runtime — " +
              "whatever they configure would simply be absent — so they are fatal at boot instead.\n\n" +
              render(deadKeys)
            : undefined,
        incoherent.length > 0
            ? "These parse, and cannot do what they say. Nothing would have failed at runtime — " +
              "the feature would simply not work — so they are fatal at boot instead.\n\n" +
              render(incoherent)
            : undefined
    ].filter(Boolean);

    throw new Error(
        `${errors.length} problem(s) in the collection config.\n\n` +
        sections.join("\n\n") + "\n"
    );
}
