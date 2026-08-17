import {
    CollectionConfig,
    Relation,
    ResolvedRelation
} from "@rebasepro/types";
import { generateForeignKeyName, toSnakeCase } from "@rebasepro/utils";

import { getTableName } from "./relations";

/**
 * Fill in a relation's defaults.
 *
 * This replaces `sanitizeRelation`, which had to work out *which kind of link
 * you meant* from whichever optional fields happened to be set — 194 lines of
 * it, including a pass that inspected the target collection's own relations to
 * decide whether a `many`/`inverse` pair was a one-to-many or the far side of a
 * many-to-many, wrapped in a `try/catch` that fell through to the wrong answer
 * when it could not tell. Two consumers running that logic at different moments
 * could reach different conclusions about the same relation.
 *
 * With the kind declared there is nothing to work out. What remains is
 * defaulting — a table name, a column name — which is deterministic, depends
 * only on the relation and its two endpoints, and cannot fail. That is why this
 * function returns rather than throws, and why it needs no cache to be
 * consistent.
 */
export function resolveRelation(
    relation: Relation,
    sourceCollection: CollectionConfig,
    propertyKey?: string
): ResolvedRelation {
    const target = relation.target;
    if (typeof target !== "function") {
        throw new Error(
            `Relation${relation.relationName ? ` '${relation.relationName}'` : ""} on ` +
            `'${sourceCollection.slug}' has no \`target\`. Give it a thunk: \`target: () => otherCollection\`.`
        );
    }

    const targetCollection = callTarget(relation, sourceCollection, propertyKey, target);

    // The name is the address: the `include` key, the admin tab, and the
    // segment of a nested path. Declared name wins, then the declaring
    // property's key, then the target's slug.
    const relationName = relation.relationName ?? propertyKey ?? toSnakeCase(targetCollection.slug);

    const shared: Pick<ResolvedRelation, "relationName" | "target" | "targetSlug" | "onUpdate" | "onDelete" | "overrides" | "validation"> = {
        relationName,
        target,
        targetSlug: targetCollection.slug,
        onUpdate: relation.onUpdate,
        onDelete: relation.onDelete,
        overrides: relation.overrides,
        validation: relation.validation
    };

    const sourceName = toSnakeCase(sourceCollection.slug ?? sourceCollection.name);

    switch (relation.kind) {
        case "belongsTo":
            return {
                ...shared,
                kind: "belongsTo",
                cardinality: "one",
                writable: true,
                shared: false,
                localKey: relation.localKey ?? generateForeignKeyName(relationName)
            };

        case "hasOne":
            return {
                ...shared,
                kind: "hasOne",
                cardinality: "one",
                writable: true,
                shared: false,
                foreignKeyOnTarget: relation.foreignKeyOnTarget ?? generateForeignKeyName(sourceName),
                sourceKey: relation.sourceKey
            };

        case "hasMany":
            return {
                ...shared,
                kind: "hasMany",
                cardinality: "many",
                writable: true,
                shared: false,
                foreignKeyOnTarget: relation.foreignKeyOnTarget ?? generateForeignKeyName(sourceName),
                // Not defaulted: the source's primary key needs the driver's
                // schema to resolve, which resolution does not have. `undefined`
                // means "the primary key" — see `ResolvedHasMany.sourceKey`.
                sourceKey: relation.sourceKey
            };

        case "manyToMany": {
            const sourceTable = getTableName(sourceCollection);
            const targetTable = getTableName(targetCollection);
            return {
                ...shared,
                kind: "manyToMany",
                cardinality: "many",
                writable: true,
                shared: true,
                through: {
                    // Sorted so both sides of the same link derive the same
                    // table without having to agree in advance.
                    table: relation.through?.table ?? [sourceTable, targetTable].sort().join("_"),
                    sourceColumn: relation.through?.sourceColumn ?? generateForeignKeyName(sourceName),
                    targetColumn: relation.through?.targetColumn ?? generateForeignKeyName(relationName)
                }
            };
        }

        case "via":
            return {
                ...shared,
                kind: "via",
                cardinality: relation.cardinality,
                writable: false,
                // A join chain reaches rows that other parents reach too, and
                // Rebase does not know which hop, if any, is a link it owns.
                shared: true,
                joinPath: relation.joinPath
            };

        default: {
            // Exhaustive: a new kind is a compile error here, not a silent
            // fall-through to whatever shape happened to match first.
            const exhaustive: never = relation;
            throw new Error(`Unknown relation kind: ${JSON.stringify(exhaustive)}`);
        }
    }
}

/** How this relation is addressed in an error message, before it has a resolved name. */
function describe(relation: Relation, sourceCollection: CollectionConfig, propertyKey?: string): string {
    const name = relation.relationName ?? propertyKey;
    return `Relation${name ? ` '${name}'` : ""} on '${sourceCollection.slug}'`;
}

/**
 * A module namespace, unwrapped to the collection it exports.
 *
 * A cycle transpiled to CommonJS does not hand the importing module the
 * *default export* — it hands it the module object, `{ __esModule: true,
 * default: … }`, captured before the exporting module finished evaluating. The
 * `default` slot fills in later, so by the time a lazy `target` thunk runs the
 * collection is sitting right there, one level down. Returning the namespace is
 * never a thing a thunk means to do, and there is exactly one reading of it.
 *
 * Only unwrapped when the inner value is itself a collection: a `default` that
 * is not one is a genuinely wrong thunk, and it should reach the error below
 * rather than be quietly swapped in.
 */
function unwrapModuleNamespace(value: unknown): unknown {
    if (!value || typeof value !== "object") return value;
    if ((value as { slug?: unknown }).slug) return value;
    const inner = (value as { default?: unknown }).default;
    return inner && typeof inner === "object" && (inner as { slug?: unknown }).slug ? inner : value;
}

/**
 * Call the `target` thunk, and translate the ways an import cycle breaks it into
 * an error that names the cause — or, where the value is recoverable, into the
 * collection the thunk meant.
 *
 * The thunk exists to defer the reference until every module has finished
 * evaluating, and for a cycle that closes at import time it does. Two cycles
 * leave the binding permanently unusable:
 *
 *  - **ESM/TDZ.** `const` and `class` bindings in a not-yet-evaluated module are
 *    in the temporal dead zone, so reading one throws `ReferenceError: x is not
 *    defined`. The stack points at the thunk — a one-line arrow function that is
 *    obviously fine — and says nothing about the cycle that made it throw.
 *  - **CJS interop, unresolved.** The half-initialised module object has no
 *    `default` yet, the import resolves to `undefined`, and the thunk returns it
 *    without complaint. That one used to surface here as "did not resolve to a
 *    collection", which is true and unhelpful.
 *
 * Both mean the same thing, and the fix for both is the same: break the cycle,
 * or move the relation into the collection that does not close it.
 *
 * A third shape is *not* an error, and used to be reported as one. A loader that
 * transpiles ESM to CJS — jiti, which is what `rebase generate-sdk` and
 * `rebase build` load collections with — gives the module entered second in a
 * cycle a namespace object rather than the default export, and never replaces it
 * with a live binding. The thunk then returns `{ __esModule: true, default: … }`
 * holding the fully-initialised collection. Native ESM resolves the same thunk
 * to the collection directly, so this was a loader artefact reported as an
 * authoring mistake, and the advice it gave — make the target a lazy thunk — was
 * already satisfied by the code it was rejecting. Bidirectional relations make
 * these cycles unavoidable, and the lazy thunk is this framework's own answer to
 * them, so {@link unwrapModuleNamespace} takes the collection and moves on.
 */
function callTarget(
    relation: Relation,
    sourceCollection: CollectionConfig,
    propertyKey: string | undefined,
    target: Relation["target"]
): ReturnType<Relation["target"]> {
    let targetCollection: ReturnType<Relation["target"]> | undefined;
    try {
        targetCollection = unwrapModuleNamespace(target()) as ReturnType<Relation["target"]>;
    } catch (error) {
        // A ReferenceError from inside the thunk is a binding that was never
        // initialised — nothing else in a one-expression arrow can raise one.
        if (error instanceof ReferenceError) {
            throw new Error(
                `${describe(relation, sourceCollection, propertyKey)} targets a collection that is not ` +
                `initialized yet — almost always an import cycle between the two collection files. ` +
                `Break the cycle (move the shared piece into a third module, or import the target ` +
                `lazily) so the target's module finishes evaluating before the registry is built.`,
                { cause: error }
            );
        }
        throw error;
    }

    if (!targetCollection?.slug) {
        throw new Error(
            `${describe(relation, sourceCollection, propertyKey)} has a \`target\` that resolved to ` +
            `${targetCollection === undefined ? "`undefined`" : "something that is not a collection"}. ` +
            (targetCollection === undefined
                ? "Under CommonJS interop an import cycle resolves the default import to `undefined`, " +
                  "so check whether this collection and its target import each other. Otherwise the thunk " +
                  "is returning the wrong value — it must return the collection itself, not a promise or a module."
                : typeof (targetCollection as { then?: unknown }).then === "function"
                    ? "The thunk returned a promise — `target: () => import(\"./other\")` is asynchronous. " +
                      "Import the collection at the top of the file and return the binding: " +
                      "`target: () => otherCollection`."
                    : "The thunk must return a collection config with a `slug`.")
        );
    }

    return targetCollection;
}
