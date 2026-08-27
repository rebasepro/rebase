import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The serializable mirror must not fall behind the types it mirrors.
 *
 * `serializable_types.ts` is a hand-written copy of the property and collection
 * types, and `serializable_utils.ts` copies field-by-field through a whitelist.
 * So a field added to core and not to the mirror is not a stale type — the
 * collection editor round-trips through this shape on the way to the ts-morph
 * writer, which means the field is silently unset the first time a user opens
 * that collection in the panel and saves.
 *
 * It fell behind three separate times before anything checked:
 * `excludeFromApi` (the guarantee that a password hash never reaches a
 * response), `url` (which feeds the generated OpenAPI contract), and the whole
 * collection-level `relations` array (so importing a table detected its foreign
 * keys, showed them, and dropped them on save).
 *
 * This compares *field names* rather than types, because the drift that matters
 * is a field going missing. Anything genuinely not serializable is named in
 * {@link NOT_SERIALIZABLE} with the reason, so dropping one is a decision
 * someone wrote down rather than an omission.
 */
const ROOT = path.resolve(__dirname, "../../../..");
const CORE = path.join(ROOT, "packages/types/src/types/properties.ts");
const ADMIN_OPTS = path.join(ROOT, "packages/cms-types/src/types/property_options.ts");
const MIRROR = path.join(ROOT, "packages/cms/src/collection_editor/serializable_types.ts");

/** Field names declared directly in `interface <name>`, ignoring nested braces. */
function fieldsOf(file: string, name: string): string[] {
    const source = readFileSync(file, "utf8");
    const start = source.search(new RegExp(`^export interface ${name}\\b[^{]*\\{`, "m"));
    if (start === -1) throw new Error(`no 'export interface ${name}' in ${path.basename(file)}`);

    let depth = 0;
    let i = source.indexOf("{", start);
    const body: string[] = [];
    let line = "";
    for (; i < source.length; i++) {
        const c = source[i];
        if (c === "{") depth++;
        else if (c === "}") { depth--; if (depth === 0) break; }
        if (c === "\n") { body.push(line); line = ""; } else line += c;
        // Only depth 1 is the interface's own members; deeper is a nested object.
        if (c === "\n" && depth > 1) body.pop();
    }
    return body
        .map(l => /^\s{4}(?:readonly\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\??\s*[:(]/.exec(l)?.[1])
        .filter((x): x is string => Boolean(x));
}

/**
 * Fields that deliberately do not survive `JSON.stringify`, with the reason.
 * Adding to this list is how you record a decision; the test failing is how you
 * find out you did not make one.
 */
const NOT_SERIALIZABLE: Record<string, string> = {
    dynamicProps: "a function",
    callbacks: "functions",
    Field: "a ComponentRef — a component, not data",
    Preview: "a ComponentRef",
    Filter: "a ComponentRef",
    customProps: "arbitrary, and typed as unknown in the mirror",
    admin: "narrowed to a Serializable* options type instead",
    validation: "narrowed per property type",
    defaultValue: "declared on the serializable base, not per type",
    relation: "a tagged union whose target is a thunk; mirrored as SerializableRelation",
    resolvedRelation: "derived at normalization, never authored",
    of: "recursive; mirrored as SerializableProperty",
    oneOf: "recursive",
    properties: "recursive",
    storage: "mirrored as SerializableStorageConfig",
    conditions: "already JSON by design",
    type: "the discriminant, always present"
};

const PAIRS: [string, string, string][] = [
    [CORE, "BaseProperty", "SerializableBaseProperty"],
    [CORE, "StringProperty", "SerializableStringProperty"],
    [CORE, "NumberProperty", "SerializableNumberProperty"],
    [CORE, "BooleanProperty", "SerializableBooleanProperty"],
    [CORE, "DateProperty", "SerializableDateProperty"],
    [CORE, "GeopointProperty", "SerializableGeopointProperty"],
    [CORE, "ReferenceProperty", "SerializableReferenceProperty"],
    [CORE, "ArrayProperty", "SerializableArrayProperty"],
    [CORE, "MapProperty", "SerializableMapProperty"],
    [ADMIN_OPTS, "AdminPropertyOptions", "SerializableAdminBaseOptions"],
    [ADMIN_OPTS, "AdminStringOptions", "SerializableAdminStringOptions"],
    [ADMIN_OPTS, "AdminReferenceOptions", "SerializableAdminReferenceOptions"],
    [ADMIN_OPTS, "AdminRelationOptions", "SerializableAdminRelationOptions"],
    [ADMIN_OPTS, "AdminArrayOptions", "SerializableAdminArrayOptions"],
    [ADMIN_OPTS, "AdminMapOptions", "SerializableAdminMapOptions"]
];

describe("the serializable mirror covers the types it mirrors", () => {

    it.each(PAIRS)("%s → %s", (file, coreName, mirrorName) => {
        const core = fieldsOf(file, coreName);
        const mirror = new Set(fieldsOf(MIRROR, mirrorName));

        const missing = core.filter(f => !mirror.has(f) && !(f in NOT_SERIALIZABLE));
        expect({ [coreName]: missing }).toEqual({ [coreName]: [] });
    });

    it("parses non-empty field lists, so a rename cannot pass vacuously", () => {
        // Without this, renaming an interface makes `fieldsOf` throw — caught
        // above as a failure — but an *emptied* one would compare equal to an
        // empty expectation and the guard would go quiet.
        expect(fieldsOf(CORE, "StringProperty").length).toBeGreaterThan(5);
        expect(fieldsOf(MIRROR, "SerializableStringProperty").length).toBeGreaterThan(5);
    });

    it("names every ComponentRef the serializer strips", () => {
        // The serializer drops components by naming them. `Filter` was missing
        // from that list while `Field` and `Preview` were named twice.
        const utils = readFileSync(
            path.join(ROOT, "packages/cms/src/collection_editor/serializable_utils.ts"), "utf8");
        const declared = /NON_SERIALIZABLE_ADMIN_KEYS = \[([^\]]*)\]/.exec(utils)?.[1] ?? "";
        const names = [...declared.matchAll(/"([A-Za-z]+)"/g)].map(m => m[1]);
        expect(names.sort()).toEqual(["Field", "Filter", "Preview"]);
    });
});
