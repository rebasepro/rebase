/**
 * One save of the collection editor on a Firestore collection, as
 * {@link FirestoreCollectionPatch} operations — and those operations as the
 * edit the dev server's frontend source editor makes to the collection's
 * `defineFirestoreCollection({...})` call.
 *
 * A Firestore collection has no server schema: what the editor shows is the
 * frontend definition, normalised (`required` → `validation.required`, a
 * reference's `target` → `path`, the `admin` block flattened). A save is
 * therefore entirely an edit of that definition, written back in the
 * definition's own vocabulary, at the smallest path that changed, so every
 * key the person did not touch stays as written — functions and components
 * included, which are never part of an edit.
 *
 * The module is pure.
 *
 * @module
 */
import type { Properties, Property } from "@rebasepro/types";
import { nestAdminCollectionKeys, nestAdminPropertyKeys } from "@rebasepro/types";
import type { AdminCollection, FirestoreCollectionPatch, FirestorePatchValue } from "@rebasepro/cms-types";
import { SplitEditError } from "./split_edit_error";
import { sameValue } from "./split_edit";

/** The call a Firestore collection is declared with. */
export const FIRESTORE_COLLECTION_CALLEE = "defineFirestoreCollection";

/**
 * The frontend source editor's wire (`POST /admin/schema-editor/frontend/apply`):
 * operations on paths into the object argument of the call `target` names.
 */
export interface FrontendSourceEditRequest {
    target: { callee: string; key: string; value: string };
    /** The file's version as the panel read it: a file changed since is refused. */
    version?: string;
    operations: FrontendSourceOperation[];
}

/** One operation of a {@link FrontendSourceEditRequest}. */
export type FrontendSourceOperation =
    | { op: "set"; path: string[]; value: FirestorePatchValue; before?: string }
    | { op: "remove"; path: string[]; prune?: boolean }
    | { op: "rename"; path: string[]; to: string }
    | { op: "move"; path: string[]; before?: string };

// ── Values ──────────────────────────────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const isPlain = (value: unknown): value is Record<string, unknown> =>
    isRecord(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

/** `value` as JSON, `undefined` for absent; code and class instances are refused with where they are. */
function patchValue(value: unknown, where: string): FirestorePatchValue | undefined {
    if (value === undefined) return undefined;
    if (value === null || typeof value === "boolean" || typeof value === "string") return value;
    if (typeof value === "number") {
        if (Number.isFinite(value)) return value;
    } else if (Array.isArray(value)) {
        return value.map((item, index) => patchValue(item, `${where}[${index}]`) ?? null);
    } else if (isPlain(value)) {
        const out: { [key: string]: FirestorePatchValue } = {};
        for (const [key, item] of Object.entries(value)) {
            const converted = patchValue(item, `${where}.${key}`);
            if (converted !== undefined) out[key] = converted;
        }
        return out;
    }
    throw new SplitEditError("EDITED_IN_CODE",
        `\`${where}\` is ${typeof value === "function" ? "a function" : "a value with no literal form"}, which is edited in code: change it in the collection's file.`,
        where.split(".")[0]);
}

const isPatchObject = (value: FirestorePatchValue | undefined): value is { [key: string]: FirestorePatchValue } =>
    typeof value === "object" && value !== null && !Array.isArray(value);

/** Walk two values and emit every smallest path at which they differ. */
function diffInto(path: string[], before: unknown, after: unknown, emit: (path: string[], value: unknown) => void): void {
    if (sameValue(before, after)) return;
    if (isPlain(before) && isPlain(after)) {
        const keys = [...Object.keys(after), ...Object.keys(before).filter(key => !(key in after))];
        for (const key of keys) diffInto([...path, key], before[key], after[key], emit);
        return;
    }
    emit(path, after);
}

// ── The collection's own vocabulary ─────────────────────────────────────────

/**
 * A property as the field a `defineFirestoreCollection` call writes:
 * presentation keys under `admin`, `validation.required` as `required`, a
 * reference's `path` as `target`, nested fields the same way.
 */
export function firestoreFieldOf(property: Property): Record<string, unknown> {
    return fieldOf({ ...property });
}

function fieldOf(property: Record<string, unknown>): Record<string, unknown> {
    const field: Record<string, unknown> = { ...nestAdminPropertyKeys(property) };
    if (field.type === "reference" && "path" in field) {
        field.target = field.path;
        delete field.path;
    }
    if (isRecord(field.validation)) {
        const { required, ...rest } = field.validation;
        if (required === true) field.required = true;
        if (Object.keys(rest).length > 0) field.validation = rest;
        else delete field.validation;
    }
    if (field.type === "map" && isRecord(field.properties)) field.properties = fieldsOf(field.properties);
    if (field.type === "array") {
        if (Array.isArray(field.of)) field.of = field.of.map(item => (isRecord(item) ? fieldOf(item) : item));
        else if (isRecord(field.of)) field.of = fieldOf(field.of);
        if (isRecord(field.oneOf) && isRecord(field.oneOf.properties)) {
            field.oneOf = { ...field.oneOf, properties: fieldsOf(field.oneOf.properties) };
        }
    }
    return field;
}

function fieldsOf(properties: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, property] of Object.entries(properties)) out[key] = isRecord(property) ? fieldOf(property) : property;
    return out;
}

/** Keys of the editor's view model that are not options of the call. */
const NOT_OPTIONS = new Set(["properties", "engine", "slug", "admin"]);

/** The call's options, nested as written: everything but the fields. */
function optionsOf(collection: AdminCollection): Record<string, unknown> {
    const nested = nestAdminCollectionKeys({ ...collection });
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(nested)) if (!NOT_OPTIONS.has(key)) out[key] = value;
    if (isRecord(nested.admin)) out.admin = nested.admin;
    return out;
}

// ── The patches ─────────────────────────────────────────────────────────────

/**
 * The patches that turn the Firestore collection `before` into `after`, as
 * the editor saves it.
 *
 * - Collection options (`name`, `path`, `description`, the `admin` block)
 *   are `setOption` / `removeOption` at the path that changed.
 * - A new field is `addField`, a removed one `removeField`; a changed field
 *   is `setFieldOption` / `removeFieldOption` at each path that changed
 *   inside it.
 * - The field order the editor shows becomes `moveField`s when the file has
 *   no `admin.propertiesOrder` of its own (which is set like any option).
 *
 * @throws {@link SplitEditError} `MIGRATION_REQUIRED` for a slug change (it is
 *   the collection's URL, its reference target and what the file is found
 *   by), `EDITED_IN_CODE` for a changed value that is code.
 */
export function firestoreCollectionPatches(before: AdminCollection, after: AdminCollection): FirestoreCollectionPatch[] {
    const collection = before.slug;
    if (after.slug !== before.slug) {
        throw new SplitEditError("MIGRATION_REQUIRED",
            `The slug of "${before.slug}" is its URL, the target of references to it and what its file is found by: rename it in code, with the references.`,
            "slug");
    }
    const patches: FirestoreCollectionPatch[] = [];

    // Options.
    const optionsBefore = optionsOf(before);
    const optionsAfter = optionsOf(after);
    const ownOrder = isRecord(optionsBefore.admin) && optionsBefore.admin.propertiesOrder !== undefined;
    const withoutOrder = (options: Record<string, unknown>): Record<string, unknown> => {
        if (ownOrder || !isRecord(options.admin) || !("propertiesOrder" in options.admin)) return options;
        const { propertiesOrder: _order, ...admin } = options.admin;
        void _order;
        return Object.keys(admin).length > 0 ? { ...options, admin } : Object.fromEntries(Object.entries(options).filter(([key]) => key !== "admin"));
    };
    diffInto([], withoutOrder(optionsBefore), withoutOrder(optionsAfter), (path, value) => {
        const converted = patchValue(value, path.join("."));
        patches.push(converted === undefined
            ? { op: "removeOption", collection, path }
            : { op: "setOption", collection, path, value: converted });
    });

    // Fields.
    const fieldsBefore: Properties = { ...before.properties };
    const fieldsAfter: Properties = { ...after.properties };
    for (const [key, property] of Object.entries(fieldsAfter)) {
        const previous = fieldsBefore[key];
        if (!previous) {
            const field = patchValue(firestoreFieldOf(property), key);
            if (isPatchObject(field)) patches.push({ op: "addField", collection, key, field });
            continue;
        }
        diffInto([], firestoreFieldOf(previous), firestoreFieldOf(property), (path, value) => {
            const converted = patchValue(value, [key, ...path].join("."));
            patches.push(converted === undefined
                ? { op: "removeFieldOption", collection, key, path }
                : { op: "setFieldOption", collection, key, path, value: converted });
        });
    }
    for (const key of Object.keys(fieldsBefore)) {
        if (!(key in fieldsAfter)) patches.push({ op: "removeField", collection, key });
    }

    // Field order, when the file states none of its own.
    if (!ownOrder) patches.push(...orderPatches(collection, Object.keys(fieldsBefore), fieldsAfter, after.propertiesOrder));
    return patches;
}

/** The `moveField`s that put the fields, as the file will hold them, in the order the editor shows. */
function orderPatches(collection: string, beforeKeys: string[], fieldsAfter: Properties, order: readonly string[] | undefined): FirestoreCollectionPatch[] {
    if (!order) return [];
    const current = [
        ...beforeKeys.filter(key => key in fieldsAfter),
        ...Object.keys(fieldsAfter).filter(key => !beforeKeys.includes(key))
    ];
    const listed = order.filter(key => current.includes(key));
    const desired = [...listed, ...current.filter(key => !listed.includes(key))];
    // The longest run already in order stays; every other field moves, from
    // the last, to just before the field that follows it.
    const positions = desired.map(key => current.indexOf(key));
    const stays = longestIncreasing(positions).map(index => desired[index]);
    const patches: FirestoreCollectionPatch[] = [];
    for (let index = desired.length - 1; index >= 0; index--) {
        const key = desired[index];
        if (stays.includes(key)) continue;
        const next = desired[index + 1];
        patches.push({ op: "moveField", collection, key, ...(next !== undefined ? { before: next } : {}) });
    }
    return patches;
}

/** The indexes of a longest strictly increasing subsequence of `values`. */
function longestIncreasing(values: readonly number[]): number[] {
    const length = values.map(() => 1);
    const previous = values.map(() => -1);
    for (let i = 0; i < values.length; i++) {
        for (let j = 0; j < i; j++) {
            if (values[j] < values[i] && length[j] + 1 > length[i]) {
                length[i] = length[j] + 1;
                previous[i] = j;
            }
        }
    }
    let end = length.indexOf(Math.max(0, ...length));
    const out: number[] = [];
    while (end !== -1) {
        out.unshift(end);
        end = previous[end];
    }
    return out;
}

// ── The source edit ─────────────────────────────────────────────────────────

/** Whether `path` (inside a field) names a field: the field itself, a map's sub-field, an array's `of`, a block. */
function isFieldPosition(path: readonly string[]): boolean {
    if (path.length === 0) return true;
    const last = path[path.length - 1];
    if (last === "of") return isFieldPosition(path.slice(0, -1));
    if (path.length >= 2 && path[path.length - 2] === "properties") {
        const parent = path.slice(0, -2);
        if (parent.length >= 1 && parent[parent.length - 1] === "oneOf") return isFieldPosition(parent.slice(0, -1));
        return isFieldPosition(parent);
    }
    return false;
}

/** `required` is `validation.required` written once: whatever is said of one is said of both. */
function requiredCompanion(fieldPath: readonly string[]): FrontendSourceOperation[] {
    const last = fieldPath[fieldPath.length - 1];
    const owner = fieldPath.slice(0, -1);
    if (last !== "required" || !isFieldPosition(owner.slice(2))) return [];
    return [{ op: "remove", path: [...owner, "validation", "required"], prune: true }];
}

/**
 * The frontend source edit that writes `patches` into the collection's
 * `defineFirestoreCollection` call, found by its slug.
 */
export function firestoreSourceEdit(slug: string, patches: readonly FirestoreCollectionPatch[], version?: string): FrontendSourceEditRequest {
    const operations: FrontendSourceOperation[] = [];
    for (const patch of patches) {
        switch (patch.op) {
            case "setOption":
                operations.push({ op: "set", path: [...patch.path], value: patch.value });
                break;
            case "removeOption":
                operations.push({ op: "remove", path: [...patch.path], ...(patch.path.length > 1 ? { prune: true } : {}) });
                break;
            case "addField":
                operations.push({ op: "set", path: ["fields", patch.key], value: patch.field, ...(patch.before !== undefined ? { before: patch.before } : {}) });
                break;
            case "setFieldOption": {
                const path = ["fields", patch.key, ...patch.path];
                operations.push(...requiredCompanion(path), { op: "set", path, value: patch.value });
                break;
            }
            case "removeFieldOption": {
                const path = ["fields", patch.key, ...patch.path];
                operations.push({ op: "remove", path, ...(patch.path.length > 1 ? { prune: true } : {}) }, ...requiredCompanion(path));
                break;
            }
            case "removeField":
                operations.push({ op: "remove", path: ["fields", patch.key] });
                break;
            case "renameField":
                operations.push({ op: "rename", path: ["fields", patch.key], to: patch.to });
                break;
            case "moveField":
                operations.push({ op: "move", path: ["fields", patch.key], ...(patch.before !== undefined ? { before: patch.before } : {}) });
                break;
        }
    }
    return {
        target: { callee: FIRESTORE_COLLECTION_CALLEE, key: "slug", value: slug },
        ...(version !== undefined ? { version } : {}),
        operations
    };
}
