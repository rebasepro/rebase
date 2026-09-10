import { ADMIN_COLLECTION_KEYS, ADMIN_PROPERTY_KEYS } from "@rebasepro/types";
import type { AnyCollectionConfig, CollectionConfig, PolicyExpression, PostgresCollectionConfig, FirebaseCollectionConfig, MongoDBCollectionConfig, Property, SecurityRule } from "@rebasepro/types";

import { getEffectiveSecurityRules, getTableName, isRelationalCollection, securityRuleToConditions } from "@rebasepro/common";
import type { DataSourceResolvable } from "@rebasepro/common";
import { suggestNearMiss } from "@rebasepro/utils";

import { logger } from "../utils/logger";

/**
 * A collection file the project wrote, and cannot work as written.
 *
 * Its own class so the boot's fatal path can tell it from a bug. A configuration
 * problem's message *is* the answer — it names the files, the keys and the fix,
 * composed over several lines to be read — and the fatal path used to hand a
 * plain `Error` to the structured logger, which rendered exactly that message as
 * an escaped JSON string with a stack through the bundled `dist/index.es.js`
 * beside it. Nothing in there helps: the frames are the framework's, and the
 * sentence the author needs is one `\n`-escaped field of a 3 KB blob.
 *
 * Same treatment as `BundleError`, and the same reason: the reader is looking at
 * a process that will not start, and the stack is noise when the answer is "two
 * of your collections claim the same slug".
 */
export class CollectionConfigError extends Error {
    constructor(message: string, readonly hint?: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "CollectionConfigError";
    }
}

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
    /**
     * Where each collection came from, parallel to the array being checked.
     *
     * Used only in messages, and only by the checks that compare two
     * collections: when two of them claim the same slug, "posts" names both, and
     * the one thing the author needs is which two *files* to open. The loader
     * has that and this module does not, so it is passed in rather than guessed
     * at. Absent, the messages fall back to the collection's index.
     */
    sources?: readonly (string | undefined)[];
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
    "softDelete",
    "tenant",
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
    "access",
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
    string: ["columnType", "isId", "enum", "storage", "userSelect", "email", "url", "autoValue"],
    number: ["columnType", "isId", "enum", "precision", "scale"],
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

/**
 * A key that moved or died, and what to do about it.
 *
 * There is no `codemod` field. Two of these messages used to end with "Run
 * `node <this repo>/codemod/relations-tagged-union.mjs` to migrate the whole
 * project" — a path inside the Rebase monorepo, which is the one place the
 * reader of the message never is. A project installs `@rebasepro/server` from
 * npm, and that directory is not in the package, so the single actionable
 * instruction the message offered was the one thing nobody could do. Every
 * `fix` below says what to write instead, per key, which is the part that
 * survives being read by somebody else.
 */
interface Migration {
    /** What to do about it, in the imperative. */
    fix: string;
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
        fix: `\`${key}\` moved into the collection's \`admin\` block in 0.11 — write \`admin: { ${key}: … }\``
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

/** Fields the old flat `Relation` carried that the tagged union does not. */
const RELATION_MIGRATIONS: Record<string, Migration> = {
    direction: { fix: RELATION_PROPERTY_MIGRATIONS.direction.fix },
    inverseRelationName: { fix: RELATION_PROPERTY_MIGRATIONS.inverseRelationName.fix },
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
            `\`${key}\` is no longer read here. ${migration.fix}.`,
            "key"
        );
    }

    /**
     * A key nobody recognises. Might be metadata, might be newer than us.
     *
     * `known` is the list this key was checked against, when there is one. The
     * near-miss out of it is what turns "something is wrong somewhere in this
     * file" into a one-line fix — `multilne` is not a key anybody will spot by
     * re-reading the config, because it looks exactly like the key it is not.
     */
    unknown(path: string, key: string, context: string, known?: readonly string[]): void {
        if (this.unknownKeys === "off") return;
        const suggestion = known ? suggestNearMiss(known, key) : undefined;
        this.problems.push({
            severity: this.unknownKeys === "error" ? "error" : "warning",
            kind: "key",
            path,
            message:
                `\`${key}\` is not a known ${context} key and is being ignored. ` +
                (suggestion
                    ? `Did you mean \`${suggestion}\`?`
                    : "If it is deliberate metadata this is safe; if it is a typo or a key from an older " +
                      "version, the feature it configures is silently absent.")
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
            `${RELATION_KINDS.join(", ")}. Which one: the side that holds the foreign key is ` +
            "`belongsTo`; the side that is pointed at is `hasOne` for one row and `hasMany` for " +
            "many; a junction table is `manyToMany`; anything else is a read-only `via` with a `joinPath`."
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
            collect.unknown(`${path}.${key}`, key, "relation", [...RELATION_KEYS]);
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
 * The per-field `access` block: shape, and its one incompatibility.
 *
 * Three failures, all of which boot cleanly and all of which are silent:
 *
 * - **`access` beside `excludeFromApi`.** They are one mechanism — the flag is
 *   sugar for `access: { read: [], write: [] }` and `effectiveAccess` expands it
 *   *before* looking at `access`, so the flag wins and the block is dead. An
 *   author who wrote `excludeFromApi: true, access: { read: ["admin"] }` meant
 *   the second line to do something, and it does nothing. Refused rather than
 *   merged, because there is no reading of the pair that is obviously right.
 * - **A non-array `read` or `write`.** `access: { read: "admin" }` is the shape
 *   an author reaches for first, and it is not an empty list — it is a *string*,
 *   whose `.length` is 5, so it reads as "some roles are allowed" and then
 *   matches none of them. Every caller loses the field, including the admin.
 * - **A role that is not a non-empty string.** `[""]`, `[null]`, `[0]` — a list
 *   entry nothing can hold, which is `[]` written the long way round.
 *
 * Nothing checks role *names* against a set: roles are application data, live in
 * the users table, and are created and deleted while the server runs. A typo in
 * one is a field nobody can read, which is the safe direction to fail.
 */
function checkFieldAccess(
    property: Record<string, unknown>,
    path: string,
    collect: ProblemCollector
): void {
    const access = property.access;
    if (access === undefined) return;

    if (property.excludeFromApi) {
        collect.error(
            `${path}.access`,
            "`access` and `excludeFromApi` cannot both be set. `excludeFromApi: true` IS " +
            "`access: { read: [], write: [] }` — one mechanism, two spellings — so the block " +
            "beside it is never read. Keep whichever says what you mean and delete the other."
        );
        return;
    }

    if (!isPlainObject(access)) {
        collect.error(
            `${path}.access`,
            "`access` must be an object with optional `read` and `write` role lists, " +
            "e.g. `access: { read: [\"hr\"], write: [] }`."
        );
        return;
    }

    for (const direction of ["read", "write"] as const) {
        const roles = access[direction];
        if (roles === undefined) continue;
        if (!Array.isArray(roles)) {
            collect.error(
                `${path}.access.${direction}`,
                `\`access.${direction}\` must be an array of role ids. ` +
                `\`${JSON.stringify(roles)}\` is not one — a bare string is read as a non-empty ` +
                "rule that no caller can satisfy, so the field would disappear for everybody. " +
                `Write \`[${JSON.stringify(roles)}]\`, or \`[]\` if you mean nobody.`
            );
            continue;
        }
        const bad = roles.filter(role => typeof role !== "string" || role.trim() === "");
        if (bad.length > 0) {
            collect.error(
                `${path}.access.${direction}`,
                `\`access.${direction}\` contains ${bad.map(r => JSON.stringify(r)).join(", ")}, ` +
                "which no caller's roles can hold. A role id is a non-empty string; an empty " +
                "list is how you say nobody."
            );
        }
    }

    const unknownKeys = Object.keys(access).filter(key => key !== "read" && key !== "write");
    if (unknownKeys.length > 0) {
        collect.unknown(`${path}.access.${unknownKeys[0]}`, unknownKeys[0], "`access` block", ["read", "write"]);
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

    // An `enum` with nothing in it is not an under-specified dropdown; it is a
    // column with a Postgres type nobody creates. `CREATE TYPE … AS ENUM ()` is
    // not valid SQL, so all three emitters "handled" it by skipping the type and
    // typing the column with it anyway: the generated Drizzle file referenced an
    // enum variable it never declared (so the file does not compile), the DDL
    // named a type nothing creates, and boot-ensure's `ADD COLUMN` failed —
    // which is not a survivable action, so the boot died. Said here, where the
    // property has a name, rather than in a Postgres error later.
    const empty = Array.isArray(values)
        ? values.length === 0
        : isPlainObject(values) && Object.keys(values).length === 0;
    if (empty) {
        collect.error(
            path,
            "`enum` is empty. The values become the labels of one Postgres enum type, and a type with " +
            "no labels cannot be created — so the column would reference a type nothing creates and the " +
            "schema fails to build. List the values, or drop the `enum` for a plain column."
        );
        return;
    }

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

/**
 * The keys inside an `admin` block, against the list core owns.
 *
 * This block used to be checked for *removed* keys only, on the reasoning that
 * it belongs to `@rebasepro/cms-types` and a completeness check here would
 * reject options the panel had added. That reasoning had one flaw: the lists it
 * would be checked against, `ADMIN_COLLECTION_KEYS` and `ADMIN_PROPERTY_KEYS`,
 * live in core precisely so that core can read them, and `@rebasepro/cms-types`
 * type-checks both against the option types in both directions. They cannot fall
 * behind the panel.
 *
 * So the block was the one place in a collection where a typo cost nothing to
 * make and produced no signal at all. `admin: { multilne: true }` booted clean
 * and rendered a single-line input, and the config said otherwise.
 *
 * A warning, not an error, and it goes through {@link ProblemCollector.unknown}:
 * the `REBASE_STRICT_COLLECTION_CONFIG` policy governs it like every other
 * unrecognised key, so a project that wants these fatal can have them, and one
 * running an older server against a newer panel is not blocked from booting.
 */
function checkAdminBlock(
    block: Record<string, unknown>,
    path: string,
    known: readonly string[],
    context: string,
    collect: ProblemCollector
): void {
    const allowed = new Set<string>(known);
    for (const key of Object.keys(block)) {
        if (allowed.has(key)) continue;
        // A key that moved *out* of the block has already been reported by its
        // migration, which says where it went; saying "unknown" after that
        // would be a second, worse message for the same key.
        if (ADMIN_BLOCK_MIGRATIONS[key]) continue;
        collect.unknown(`${path}.${key}`, key, context, known);
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
            collect.migrated(`${path}.${key}`, key, RELATION_PROPERTY_MIGRATIONS[key]);
            continue;
        }

        const migration = PROPERTY_MIGRATIONS[key];
        if (migration) {
            collect.migrated(`${path}.${key}`, key, migration);
            continue;
        }

        collect.unknown(`${path}.${key}`, key, `property (\`${String(type)}\`)`, [...allowed]);
    }

    // The property's own `admin` block. Checked against every key any property
    // type's options declare, not the per-type subset: `ADMIN_PROPERTY_KEYS` is
    // the union, and narrowing it here would reject a valid key on a type this
    // file has no per-type list for.
    if (isPlainObject(property.admin)) {
        checkAdminBlock(property.admin, `${path}.admin`, ADMIN_PROPERTY_KEYS, "property `admin`", collect);
    }

    if (type === "relation" && property.relation !== undefined) {
        checkRelation(property.relation, `${path}.relation`, collect);
    }

    if (property.enum !== undefined) {
        checkEnumValues(property.enum, `${path}.enum`, collect);
    }

    if (type === "number") {
        checkNumericPrecision(property, path, collect);
    }

    checkValidationPattern(property.validation, `${path}.validation`, collect);

    checkFieldAccess(property, path, collect);

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

/**
 * A `type: "relation"` property has to name a link that exists.
 *
 * There are two legal ways to say which: the `relation` block on the property,
 * or an entry in the collection's `relations` array whose `relationName` is the
 * property's key. A property with neither names nothing.
 *
 * `CollectionRegistry.normalizeCollection` already noticed and answered with a
 * `console.warn` — one line, on stdout, at the moment the panel builds its
 * registry, which in a deployed backend nobody is reading. Everything downstream
 * then behaved as if the field were not a relation: the form rendered no picker,
 * the DDL generator emitted no foreign key, and `include()` answered nothing.
 * The field existed everywhere and pointed nowhere.
 *
 * `relation` stays optional on the type, because the second form is real — the
 * check is that *one* of the two is present, which is not a shape a single
 * optional field can express.
 */
function checkRelationPropertiesResolve(
    collection: Record<string, unknown>,
    at: string,
    collect: ProblemCollector
): void {
    const properties = collection.properties;
    if (!isPlainObject(properties)) return;

    const declaredNames = new Set<string>();
    if (Array.isArray(collection.relations)) {
        for (const relation of collection.relations) {
            if (isPlainObject(relation) && typeof relation.relationName === "string") {
                declaredNames.add(relation.relationName);
            }
        }
    }

    for (const [key, property] of Object.entries(properties)) {
        // A builder function has nothing to inspect, as everywhere else here.
        if (typeof property === "function") continue;
        if (!isPlainObject(property) || property.type !== "relation") continue;
        if (property.relation !== undefined) continue;
        if (declaredNames.has(key)) continue;
        // A pre-0.11 flat relation — `target` and `localKey` at the top of the
        // property — names no `relation` block by construction, and every one of
        // those keys already has its own message saying to move it inside one.
        // Adding "this names no relation" on top would be a second, vaguer
        // sentence about the same edit.
        if (Object.keys(property).some(k => RELATION_PROPERTY_MIGRATIONS[k])) continue;

        collect.error(
            `${at}.properties.${key}`,
            `\`${key}\` is a relation property that names no relation. Either give it a ` +
            "`relation: { kind: …, target: … }` block, or add an entry to the collection's " +
            `\`relations\` array with \`relationName: "${key}"\`. Without one the field is a ` +
            "relation in name only: no picker in the form, no foreign key in the schema, and " +
            "`include()` returns nothing for it.",
            "incoherent"
        );
    }
}

/** The field `softDelete: true` means, when the object form names none. */
const DEFAULT_SOFT_DELETE_FIELD = "deletedAt";

/**
 * `softDelete` says what a column *means*. It does not create the column.
 *
 * So the collection has to declare it, as a `date`, and a config that turns the
 * flag on without one has to be refused here rather than at the first delete —
 * where the failure would be a 500 landing on whoever pressed the button, on a
 * row that then either vanished or did not depending on which half of the
 * feature was reached. Both halves need the column: the delete writes it and
 * every read filters on it.
 *
 * A wrong *type* is refused for the same reason. `deletedAt: { type: "boolean" }`
 * would let the delete write `now()` into a boolean column and fail at the
 * database, which is the same failure one layer further from the cause.
 */
function checkSoftDelete(
    collection: Record<string, unknown>,
    at: string,
    collect: ProblemCollector
): void {
    const declared = collection.softDelete;
    if (declared === undefined || declared === false) return;

    if (declared !== true && !isPlainObject(declared)) {
        collect.error(`${at}.softDelete`, "`softDelete` must be `true` or `{ field }`.");
        return;
    }

    const field = isPlainObject(declared) && typeof declared.field === "string" && declared.field
        ? declared.field
        : DEFAULT_SOFT_DELETE_FIELD;

    const properties = isPlainObject(collection.properties) ? collection.properties : undefined;
    const property = properties?.[field];

    if (!property) {
        collect.error(
            `${at}.softDelete`,
            `\`softDelete\` records the deletion in '${field}', and '${at}' has no such property. ` +
            `Declare it — \`${field}: { type: "date" }\` — or name an existing date property with ` +
            "`softDelete: { field: \"…\" }`. The flag says what a column means; it does not add one."
        );
        return;
    }

    const type = isPlainObject(property) ? property.type : undefined;
    if (type !== "date") {
        collect.error(
            `${at}.softDelete`,
            `\`softDelete\` stamps '${field}' with a timestamp, and that property is a ` +
            `\`${String(type)}\`. It has to be a \`date\`.`
        );
    }
}

/** Claims a token's own identity owns; a tenancy claim may not name one. */
const RESERVED_TOKEN_CLAIMS = new Set(["uid", "sub", "roles", "aal", "isAnonymous", "iat", "exp", "purpose"]);

/** Property types that can hold a tenant id. */
const TENANT_FIELD_TYPES = new Set(["string", "number", "reference", "relation"]);

/**
 * `tenant`, against what the schema, the policy and the write path can honour.
 *
 * Every one of these lands somewhere worse if it is not caught here, and all of
 * them land *late*: the schema planner sees the declaration at `db push` time,
 * and the policy it compiles reaches the database at boot on a managed tenant
 * with nobody in the loop. A tenancy policy that fails to apply is not a
 * collection missing a feature — RLS stays enabled with no policy, and the
 * table denies every row to everyone.
 *
 * - **A field that is not declared.** `tenant` says what a column *means*, the
 *   same way `softDelete` does; it does not add one.
 * - **A field of the wrong type.** A tenant id is a `string`, a `number`, or a
 *   link to the tenants collection. A `boolean` tenant column compiles to a
 *   comparison Postgres refuses.
 * - **A field the API withholds.** `excludeFromApi` and `access.read: []` take
 *   the field out of every response, and a client that cannot read which tenant
 *   a row is in cannot render or filter by it — while the column is still
 *   `NOT NULL` and still stamped. The two declarations contradict each other.
 * - **A claim naming an identity claim.** `uid`, `roles` and friends are
 *   written *after* the custom claims when a token is minted, precisely so a
 *   claims hook cannot assert them. A tenancy rule reading `uid` as a tenant
 *   would compile and would mean something nobody intended.
 */
/**
 * The collection object read as a config, for the two helpers that want a whole
 * one.
 *
 * This module runs *before* anything has turned the user's config into a
 * `CollectionConfig` — that is what it is for — so what it holds is an open
 * record, and `getTableName` and `getEffectiveSecurityRules` are both typed on
 * the finished type. Nothing structural bridges the two, so the conversion is
 * irreducible here; what it should not be is scattered, which is how two call
 * sites came to spell it `as unknown as CollectionConfig` independently.
 *
 * Both helpers read fields this module has already checked by the time they are
 * called, and both are total on a record that is missing them — `getTableName`
 * falls back through `slug` to `name` to `""`, and an absent `securityRules` is
 * an empty rule list. Prefer {@link dataSourceOf} where only the routing fields
 * are wanted: it checks them instead of claiming them.
 */
function asCollectionConfig(collection: Record<string, unknown>): AnyCollectionConfig {
    return collection as unknown as AnyCollectionConfig;
}

/**
 * The three fields {@link isRelationalCollection} reads, taken off a collection
 * object this module has not finished validating.
 *
 * `isRelationalCollection` wants a `DataSourceResolvable` —
 * `{ dataSource?: string; engine?: string; databaseId?: string }` — and what
 * this file holds is a `Record<string, unknown>` straight out of the user's
 * config, whose values are `unknown`. The call sites answered that mismatch
 * with `collection as unknown as CollectionConfig`, which names a type nothing
 * here asks for and asserts far more than the question needs: a config
 * declaring `engine: 42` was read as an engine and routed on.
 *
 * Checking the three is what this module is for.
 */
function dataSourceOf(collection: Record<string, unknown>): DataSourceResolvable {
    const text = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;
    return {
        dataSource: text(collection.dataSource),
        engine: text(collection.engine),
        databaseId: text(collection.databaseId)
    };
}

function checkTenant(
    collection: Record<string, unknown>,
    at: string,
    collect: ProblemCollector
): void {
    const declared = collection.tenant;
    if (declared === undefined) return;

    if (!isPlainObject(declared)) {
        collect.error(`${at}.tenant`, "`tenant` must be an object — `{ field, from }`.");
        return;
    }

    if (!isRelationalCollection(dataSourceOf(collection))) {
        collect.error(
            `${at}.tenant`,
            "`tenant` is Postgres-only: row-level security is what enforces the boundary, and an " +
            "application-layer filter on an engine without it is one a raw query goes around. Remove " +
            "`tenant`, or move this collection to a Postgres data source."
        );
        return;
    }

    const field = declared.field;
    if (typeof field !== "string" || !field) {
        collect.error(`${at}.tenant.field`, "`tenant.field` must name the property holding the tenant id.");
    } else {
        const properties = isPlainObject(collection.properties) ? collection.properties : undefined;
        const property = properties?.[field];
        if (!isPlainObject(property)) {
            collect.error(
                `${at}.tenant.field`,
                `\`tenant\` scopes rows by '${field}', and '${at}' has no such property. Declare it — ` +
                `\`${field}: { type: "string" }\`, or a \`relation\` to the tenants collection — or name ` +
                "the property that already holds the tenant id. The flag says what a column means; it " +
                "does not add one."
            );
        } else {
            const type = String(property.type);
            if (!TENANT_FIELD_TYPES.has(type)) {
                collect.error(
                    `${at}.tenant.field`,
                    `'${field}' is a \`${type}\`, which cannot hold a tenant id. Use a \`string\`, a ` +
                    "`number`, or a `relation` / `reference` to the collection of tenants."
                );
            }
            const access = isPlainObject(property.access) ? property.access : undefined;
            const withheld = property.excludeFromApi === true
                || (Array.isArray(access?.read) && access.read.length === 0);
            if (withheld) {
                collect.error(
                    `${at}.tenant.field`,
                    `'${field}' is the tenant every row of '${at}' belongs to, and it is also hidden from ` +
                    `the API by \`${property.excludeFromApi === true ? "excludeFromApi" : "access.read: []"}\`. ` +
                    "The column is still NOT NULL and still stamped on every write, so the only effect is " +
                    "that a client can never see which tenant a row it just wrote is in. Drop the " +
                    "restriction, or drop `tenant`.",
                    "incoherent"
                );
            }
        }
    }

    if (declared.bypassRoles !== undefined
        && (!Array.isArray(declared.bypassRoles) || declared.bypassRoles.some(r => typeof r !== "string"))) {
        collect.error(`${at}.tenant.bypassRoles`, "`tenant.bypassRoles` must be an array of role ids.");
    }

    const from = declared.from;
    if (!isPlainObject(from)) {
        collect.error(
            `${at}.tenant.from`,
            "`tenant.from` says where the caller's tenant comes from: `{ claim: \"org_id\" }` for a claim " +
            "on their token, or `{ membership: { collection, userField, tenantField } }` for a table of " +
            "memberships."
        );
        return;
    }

    const hasClaim = from.claim !== undefined;
    const hasMembership = from.membership !== undefined;
    if (hasClaim && hasMembership) {
        collect.error(
            `${at}.tenant.from`,
            "`tenant.from` names both `claim` and `membership`. They are two answers to one question — " +
            "which tenant is this caller in — and only one policy is generated. Keep one."
        );
        return;
    }

    if (hasClaim) {
        if (typeof from.claim !== "string" || !from.claim) {
            collect.error(`${at}.tenant.from.claim`, "`claim` must be the claim's name on the access token.");
        } else if (RESERVED_TOKEN_CLAIMS.has(from.claim)) {
            collect.error(
                `${at}.tenant.from.claim`,
                `'${from.claim}' is an identity claim the server writes itself — it is set after the ` +
                "custom claims precisely so a claims hook cannot assert it, and it does not mean a tenant. " +
                "Name the custom claim your identity provider puts the organization in, e.g. `\"org_id\"`."
            );
        }
        return;
    }

    if (!hasMembership) {
        collect.error(
            `${at}.tenant.from`,
            "`tenant.from` is empty. It takes either `{ claim: \"org_id\" }` or " +
            "`{ membership: { collection, userField, tenantField } }`."
        );
        return;
    }

    if (!isPlainObject(from.membership)) {
        collect.error(
            `${at}.tenant.from.membership`,
            "`membership` must be `{ collection, userField, tenantField }` — the table of memberships, the " +
            "property on it holding the user, and the property holding the tenant."
        );
        return;
    }

    for (const key of ["collection", "userField", "tenantField"] as const) {
        const value = from.membership[key];
        if (typeof value !== "string" || !value) {
            collect.error(
                `${at}.tenant.from.membership.${key}`,
                `\`membership.${key}\` is required and must be a non-empty string.`
            );
        }
    }
}

/**
 * The primary key, against what a SQL store can actually be given.
 *
 * Three claims a collection can make that no generator can honour, each of
 * which used to be discovered somewhere worse:
 *
 * - **Two `isId` properties.** Rebase does not model a composite primary key,
 *   and the three emitters each invented a different wrong answer: two
 *   `.primaryKey()` columns in the generated Drizzle file, two inline
 *   `PRIMARY KEY` clauses in one `CREATE TABLE` (which Postgres refuses), and a
 *   boot-time ensure that created the table with the *first* id and silently
 *   never added the second column at all.
 * - **`isId: "cuid"`.** It has always emitted `DEFAULT cuid()` against a
 *   function Rebase has never created — not by a generator, not at boot, not in
 *   a migration — so the column has never had a working default on Postgres and
 *   the first insert relying on it failed with `function cuid() does not exist`.
 * - **`columnType` beside `isId: "increment"`.** An identity key is INTEGER,
 *   because every column that points at a numeric primary key is INTEGER; a
 *   BIGINT one would be referenced by int4 foreign keys. The width is ignored
 *   rather than honoured, so this warns instead of failing a boot that has been
 *   working — but it says so, which is the part that was missing.
 *
 * Only for collections a SQL toolchain owns: a Firestore or MongoDB collection
 * has no `CREATE TABLE` for any of this to be wrong in.
 */
function checkPrimaryKeyStrategy(
    collection: Record<string, unknown>,
    at: string,
    collect: ProblemCollector
): void {
    if (!isPlainObject(collection.properties)) return;
    if (!isRelationalCollection(dataSourceOf(collection))) return;

    const ids = Object.entries(collection.properties)
        .filter(([, property]) => isPlainObject(property) && Boolean(property.isId))
        .map(([key, property]) => [key, property as Record<string, unknown>] as const);

    if (ids.length > 1) {
        collect.error(
            `${at}.properties`,
            `${ids.length} properties are marked \`isId\` (${ids.map(([key]) => `\`${key}\``).join(", ")}), ` +
            "and composite primary keys are not supported: the generated table would carry two PRIMARY KEY " +
            "clauses, which Postgres refuses, and the boot-time schema ensure would create the table without " +
            "the second column. Give exactly one property `isId`, and express the second key with " +
            "`indexes: [{ on: [...], unique: true, reason: \"…\" }]`."
        );
    }

    for (const [key, property] of ids) {
        if (property.isId === "cuid") {
            collect.error(
                `${at}.properties.${key}.isId`,
                "`isId: \"cuid\"` cannot be honoured on Postgres: the generated column gets " +
                "`DEFAULT cuid()`, and no `cuid()` function is ever created, so every insert that relies " +
                "on it fails. Use `isId: \"uuid\"`, or give the strategy as SQL — " +
                "``isId: \"sql`my_id()`\"`` — and create that function in a migration."
            );
        }
        if (property.isId === "increment" && property.columnType !== undefined) {
            collect.warn(
                `${at}.properties.${key}.columnType`,
                `\`columnType: "${String(property.columnType)}"\` is not read beside \`isId: "increment"\`. ` +
                "An increment key is `INTEGER GENERATED BY DEFAULT AS IDENTITY` on every path, because every " +
                "foreign key and junction column that points at a numeric primary key is INTEGER — a wider " +
                "key would be referenced by narrower columns. Remove the `columnType`."
            );
        }
    }
}

/**
 * A field the API withholds must not be in the collection's search index.
 *
 * `search` compiles to ONE generated `tsvector` column, built by the database
 * from the named fields and shared by every caller — there is no per-role
 * variant of it and there cannot be. So a field with a read rule that is also a
 * search field is still *matched*: the value never appears in a response, and a
 * caller can still recover it a term at a time by watching which searches return
 * the row. That is the whole of the disclosure the read rule exists to prevent,
 * reached by a different door.
 *
 * Refused at boot rather than warned about, because the two declarations
 * contradict each other and the author has to say which one they meant. The
 * fallback ILIKE search (no `search` block) has no such problem — it is built
 * per query and skips the fields the caller cannot read.
 */
function checkSearchFieldsAreReadable(
    collection: Record<string, unknown>,
    at: string,
    collect: ProblemCollector
): void {
    const search = collection.search;
    if (!isPlainObject(search) || !Array.isArray(search.fields)) return;
    const properties = collection.properties;
    if (!isPlainObject(properties)) return;

    for (const entry of search.fields) {
        const path = typeof entry === "string"
            ? entry
            : isPlainObject(entry) && typeof entry.path === "string" ? entry.path : undefined;
        if (!path) continue;

        // A path into a map addresses the map property; a rule on that property
        // covers everything underneath it, which is what the row strip does too.
        const property = properties[path.split(".")[0]];
        if (!isPlainObject(property)) continue;

        const access = isPlainObject(property.access) ? property.access : undefined;
        const restricted = property.excludeFromApi === true || Array.isArray(access?.read);
        if (!restricted) continue;

        collect.error(
            `${at}.search.fields`,
            `\`${path}\` is named in \`search.fields\` and also restricted by ` +
            `\`${property.excludeFromApi === true ? "excludeFromApi" : "access.read"}\`. ` +
            "The search index is one generated column shared by every caller, so the field would " +
            "stay matchable to callers who can never see its value — recoverable a term at a time. " +
            "Remove it from `search.fields`, or drop the read restriction."
        );
    }
}

/**
 * `precision` and `scale` only mean something on a `numeric` column.
 *
 * They are the difference between a price the database rounds and a price that
 * keeps whatever the caller sent — which is exactly the kind of rule that is
 * silently ignored rather than enforced, so the two ways of writing it wrong are
 * caught here where the property has a path.
 *
 * `scale` alone is refused: `NUMERIC(precision, scale)` has no form that states
 * the second without the first, so the declaration cannot reach the column at
 * all. `precision` on a type that has no modifier — an integer, a float, a
 * serial — is a warning rather than an error: the column is valid, it just does
 * not do what the line says.
 */
const NUMERIC_TYPES_WITHOUT_A_MODIFIER = new Set([
    "integer", "real", "double precision", "bigint", "serial", "bigserial"
]);

function checkNumericPrecision(
    property: Record<string, unknown>,
    path: string,
    collect: ProblemCollector
): void {
    const { precision, scale, columnType } = property as {
        precision?: unknown;
        scale?: unknown;
        columnType?: unknown;
    };
    if (precision === undefined && scale === undefined) return;

    if (scale !== undefined && precision === undefined) {
        collect.error(
            `${path}.scale`,
            "`scale` needs a `precision` beside it: a Postgres column is `NUMERIC(precision, scale)` and " +
            "there is no form that states the second without the first, so this one reaches the column as " +
            "an unbounded `NUMERIC`."
        );
    }
    if (typeof columnType === "string" && NUMERIC_TYPES_WITHOUT_A_MODIFIER.has(columnType)) {
        collect.warn(
            `${path}.precision`,
            `\`precision\`/\`scale\` are not read beside \`columnType: "${columnType}"\` — only a \`numeric\` ` +
            "column takes them. Drop the `columnType` to get `NUMERIC(precision, scale)`, or drop the " +
            "precision."
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

        collect.unknown(`${at}.${key}`, key, "collection", [...COLLECTION_KEYS]);
    }

    if (isPlainObject(collection.admin)) {
        for (const [key, migration] of Object.entries(ADMIN_BLOCK_MIGRATIONS)) {
            if (key in collection.admin) collect.migrated(`${at}.admin.${key}`, key, migration);
        }
        checkAdminBlock(collection.admin, `${at}.admin`, ADMIN_COLLECTION_KEYS, "collection `admin`", collect);
    }

    if (isPlainObject(collection.properties)) {
        checkProperties(collection.properties, `${at}.properties`, collect);
        checkRelationPropertiesResolve(collection, at, collect);
        checkPrimaryKeyStrategy(collection, at, collect);
    } else if (collection.properties !== undefined) {
        collect.error(`${at}.properties`, "`properties` must be an object keyed by property name.");
    }

    checkBoardConfig(collection, at, collect);
    checkSoftDelete(collection, at, collect);
    checkTenant(collection, at, collect);
    checkSearchFieldsAreReadable(collection, at, collect);

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
    checkCollectionsTogether(collections, options.sources, collect);
    checkTenantMemberships(collections, collect);
    return collect.problems;
}

/**
 * The two questions no single collection can answer about itself.
 *
 * A `slug` is an identity — the URL, the API path, and the key every relation's
 * `target()` resolves to. A table is where the rows are. Both were registered
 * into a `Map`, and `CollectionRegistry._registerRecursively` returns early when
 * the table name is already there, so the second collection to claim either one
 * was **dropped without a word**: its routes did not exist, its relations
 * resolved to the other collection's rows, and the config file sat in the
 * directory looking loaded.
 *
 * Reported here rather than in the registry because this is where a config
 * problem is *rendered* — with a path, alongside every other one, in a single
 * pass — and because the registry has one collection at a time by then.
 *
 * The table is resolved through {@link getTableName}, the same function the
 * registry and both generators use, so "duplicate" means the same thing here as
 * it does to the database. A collection that declares no `table` still has one.
 */
function checkCollectionsTogether(
    collections: readonly unknown[],
    sources: readonly (string | undefined)[] | undefined,
    collect: ProblemCollector
): void {
    /** How to name collection `i` to somebody who has to go and open it. */
    const describe = (i: number): string => {
        const source = sources?.[i];
        if (source) return source;
        const collection = collections[i];
        const name = isPlainObject(collection) && typeof collection.name === "string" ? collection.name : undefined;
        return name ? `collection[${i}] ("${name}")` : `collection[${i}]`;
    };

    const bySlug = new Map<string, number[]>();
    const byTable = new Map<string, number[]>();

    collections.forEach((collection, index) => {
        if (!isPlainObject(collection)) return;

        const slug = typeof collection.slug === "string" && collection.slug ? collection.slug : undefined;
        if (slug) {
            const seen = bySlug.get(slug);
            if (seen) seen.push(index); else bySlug.set(slug, [index]);
        }

        const table = getTableName(asCollectionConfig(collection));
        if (!table) return;
        const schema = typeof collection.schema === "string" && collection.schema ? collection.schema : "public";
        const qualified = `${schema}.${table}`;
        const seen = byTable.get(qualified);
        if (seen) seen.push(index); else byTable.set(qualified, [index]);
    });

    for (const [slug, indexes] of bySlug) {
        if (indexes.length < 2) continue;
        collect.error(
            slug,
            `${indexes.length} collections declare \`slug: "${slug}"\`: ${indexes.map(describe).join(", ")}. ` +
            "The slug is the collection's identity — its URL, its API path, and what every relation's " +
            "`target()` resolves to — so only the first is registered and the rest are dropped silently. " +
            "Give each one its own slug."
        );
    }

    for (const [qualified, indexes] of byTable) {
        if (indexes.length < 2) continue;
        // A duplicate slug already produced a message for these; saying it twice
        // about the table the slug derives adds nothing.
        const slugs = new Set(indexes.map(i => {
            const c = collections[i];
            return isPlainObject(c) && typeof c.slug === "string" ? c.slug : undefined;
        }));
        if (slugs.size < indexes.length) continue;

        collect.error(
            qualified,
            `${indexes.length} collections resolve to the table \`${qualified}\`: ${indexes.map(describe).join(", ")}. ` +
            "A table has one owner: only the first is registered, and the others' routes, policies and " +
            "generated columns never exist. Set `table` on each, or rename a slug — the table defaults to " +
            "`toSnakeCase(slug)`."
        );
    }
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

    throw new CollectionConfigError(
        `${errors.length} problem(s) in the collection config.\n\n` +
        sections.join("\n\n") + "\n"
    );
}

/**
 * The half of a `membership` tenancy declaration no single collection can check.
 *
 * `tenant.from.membership` points at *another* collection, and three things
 * about that collection have to hold. The first two are ordinary: it must
 * exist, and it must declare the two properties the policy reads.
 *
 * The third is the one nobody expects, and it is why this check exists at all.
 * The generated policy is a correlated `EXISTS` over the membership table, and
 * **a policy expression is evaluated as the querying user** — so the membership
 * table's own RLS applies inside it. Every Rebase table has RLS enabled and a
 * baseline granting only the server context and `admin`. A membership
 * collection with no rule of its own is therefore invisible to the very caller
 * the subquery is asking about: the `EXISTS` is false for everyone, and the
 * tenant-scoped collection returns zero rows to every non-admin, forever, with
 * nothing anywhere saying why.
 *
 * So: the membership collection has to grant the caller read of their own rows,
 * and the check is deliberately generous — a raw clause or a nested `existsIn`
 * this cannot read counts as "might". A false negative costs a boot; a false
 * positive costs nothing that was not already the author's to get right.
 */
function checkTenantMemberships(
    collections: readonly unknown[],
    collect: ProblemCollector
): void {
    const bySlug = new Map<string, Record<string, unknown>>();
    for (const collection of collections) {
        if (!isPlainObject(collection)) continue;
        if (typeof collection.slug === "string" && collection.slug) bySlug.set(collection.slug, collection);
    }

    for (const collection of collections) {
        if (!isPlainObject(collection)) continue;
        const tenant = collection.tenant;
        if (!isPlainObject(tenant) || !isPlainObject(tenant.from)) continue;
        const membership = tenant.from.membership;
        if (!isPlainObject(membership)) continue;

        const at = typeof collection.slug === "string" ? collection.slug : "collection";
        const path = `${at}.tenant.from.membership`;
        const slug = membership.collection;
        const userField = membership.userField;
        const tenantField = membership.tenantField;
        // Shape already reported by `checkTenant`; nothing to add here.
        if (typeof slug !== "string" || typeof userField !== "string" || typeof tenantField !== "string") continue;

        const target = bySlug.get(slug);
        if (!target) {
            collect.error(
                `${path}.collection`,
                `\`membership.collection: "${slug}"\` names no collection in this project. The policy ` +
                "compiles to a subquery over its table, so a slug nothing resolves to is a policy over a " +
                "table that does not exist — which fails to apply and leaves the collection denying " +
                "every row."
            );
            continue;
        }

        if (!isRelationalCollection(dataSourceOf(target))) {
            collect.error(
                `${path}.collection`,
                `'${slug}' is not stored in Postgres, so there is no table for the tenancy policy's ` +
                "subquery to read. Both collections have to live in the same SQL database."
            );
            continue;
        }

        const targetProperties = isPlainObject(target.properties) ? target.properties : {};
        for (const [key, name] of [["userField", userField], ["tenantField", tenantField]] as const) {
            if (isPlainObject(targetProperties[name])) continue;
            collect.error(
                `${path}.${key}`,
                `'${slug}' has no property '${name}'. The tenancy policy reads it inside a subquery, and ` +
                "a policy naming a column that does not exist fails to apply — which leaves the table " +
                "with RLS enabled and no policy, denying every row."
            );
        }

        if (!grantsSelfRead(asCollectionConfig(target), userField)) {
            collect.error(
                `${path}.collection`,
                `'${slug}' does not let a signed-in caller read their own membership rows, and the ` +
                `tenancy policy on '${at}' is a subquery over it — evaluated as the caller, so ` +
                `'${slug}'s own RLS applies inside it. Every Rebase table denies by default, so as ` +
                `written that subquery is false for everybody and '${at}' returns no rows to anyone but ` +
                "`admin`. Add the rule that makes it readable:\n" +
                `      securityRules: [{ name: "${slug}_self_read", operations: ["select"], ownerField: "${userField}" }]`,
                "incoherent"
            );
        }
    }
}

/**
 * Could any of `collection`'s rules let a signed-in caller read a row of their
 * own — one whose `userField` is them?
 *
 * A "might", not a proof. Anything this cannot read — raw SQL, a nested
 * `existsIn` — counts as yes, because being wrong in that direction costs
 * nothing and being wrong in the other refuses a boot over a rule that works.
 */
function grantsSelfRead(collection: CollectionConfig, userField: string): boolean {
    return getEffectiveSecurityRules(collection)
        .filter(coversSelect)
        .some(rule => {
            const { usingExpr } = securityRuleToConditions(rule);
            return usingExpr !== null && couldMatchSelf(usingExpr, userField);
        });
}

function coversSelect(rule: SecurityRule): boolean {
    // A restrictive rule narrows and never grants, so it cannot be what makes
    // the membership table readable.
    if (rule.mode === "restrictive") return false;
    const ops = rule.operations && rule.operations.length > 0 ? rule.operations : [rule.operation ?? "all"];
    return ops.includes("select") || ops.includes("all");
}

function couldMatchSelf(expr: PolicyExpression, userField: string): boolean {
    switch (expr.kind) {
        case "true":
            return true;
        case "compare": {
            const pair = [expr.left, expr.right];
            const namesUser = pair.some(o => (o.kind === "field" || o.kind === "outerField") && o.name === userField);
            return namesUser && pair.some(o => o.kind === "authUid");
        }
        case "and":
        case "or":
            return expr.operands.some(o => couldMatchSelf(o, userField));
        case "not":
            return couldMatchSelf(expr.operand, userField);
        case "existsIn":
        case "raw":
            // Unreadable from here. Assume the author knows what they wrote.
            return true;
        default:
            return false;
    }
}
