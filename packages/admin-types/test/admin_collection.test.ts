import {
    ADMIN_COLLECTION_KEYS,
    defineCollection,
    resolveAdminCollection,
    toAdminCollectionConfig,
    type AdditionalFieldKey,
    type AdminCollection
} from "../src/admin_collection";
import { ADMIN_PROPERTY_KEYS } from "../src/types/property_options";
// There is no separate admin authoring type: `augment.ts` declares `admin` onto
// `CollectionConfig` itself, so core's type *is* the nested authoring shape.
import type { CollectionConfig } from "@rebasepro/types";

/**
 * `ADMIN_COLLECTION_KEYS` is the same list as `AdminCollectionOptions`, in data
 * form, because three runtime consumers need it: the serializer, the ts-morph
 * schema editor that rewrites collection files on disk, and the codemod.
 *
 * The type has a `satisfies readonly (keyof AdminCollectionOptions)[]` clause, so
 * a key that is *not* on the options is a compile error. The reverse — a key added
 * to the options and forgotten here — is not, and the consequence is quiet: the
 * schema editor would write that field to the top level of the collection file,
 * where the backend ignores it and the panel never finds it again.
 *
 * There is no type-level way to assert exhaustiveness over an optional-property
 * keyof, so this counts.
 */
describe("ADMIN_COLLECTION_KEYS", () => {
    it("lists every key exactly once", () => {
        expect(new Set(ADMIN_COLLECTION_KEYS).size).toBe(ADMIN_COLLECTION_KEYS.length);
    });

    it("is sorted, so a diff on it stays readable", () => {
        const sorted = [...ADMIN_COLLECTION_KEYS].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        expect([...ADMIN_COLLECTION_KEYS]).toEqual(sorted);
    });

    it("covers the 40 fields the split moved off the collection", () => {
        // A bare count, as a tripwire. If this number changes, either a field was
        // added to the admin block (add it above too) or one was moved back out to
        // the contract — and the second is a decision, not a refactor.
        // 40 since `display` joined; `titleProperty` is still listed because
        // it is still read, and the schema editor has to know where to write it.
        expect(ADMIN_COLLECTION_KEYS).toHaveLength(40);
    });

    it("names nothing that belongs to the BaaS contract", () => {
        const contractKeys = [
            "slug", "name", "singularName", "description", "properties", "table",
            "schema", "relations", "securityRules", "callbacks", "auth", "history",
            "strictWrites", "dataSource", "engine", "databaseId", "ownerId",
            "metadata", "disableDefaultPolicies", "childCollections", "admin"
        ];
        for (const key of contractKeys) {
            expect(ADMIN_COLLECTION_KEYS as readonly string[]).not.toContain(key);
        }
    });
});

/**
 * The property-level twin, for the same reason and with the same hole in the
 * type check: `satisfies` catches a key that is not an option, and nothing
 * catches an option that never made the list. Here the quiet consequence is the
 * boot-time validator in `@rebasepro/server` calling a real presentation key
 * left at the top of a property "unrecognised" — a warning instead of the
 * migration hint it should be printing.
 */
describe("ADMIN_PROPERTY_KEYS", () => {
    it("lists every key exactly once", () => {
        expect(new Set(ADMIN_PROPERTY_KEYS).size).toBe(ADMIN_PROPERTY_KEYS.length);
    });

    it("is sorted, case-insensitively, so a diff on it stays readable", () => {
        const sorted = [...ADMIN_PROPERTY_KEYS].sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0);
        expect([...ADMIN_PROPERTY_KEYS]).toEqual(sorted);
    });

    it("covers the base options and every per-type extension", () => {
        // Same tripwire as above. Bump it deliberately, alongside the list.
        // 25: `span` joined and `widthPercentage`, which it replaced, is gone.
        expect(ADMIN_PROPERTY_KEYS).toHaveLength(25);
    });

    it("names nothing that belongs to the property contract", () => {
        // These stay on the property itself. A duplicate here would make the
        // validator tell you to move a key that is already where it belongs.
        const contractKeys = [
            "type", "name", "description", "columnName", "columnType", "defaultValue",
            "validation", "excludeFromApi", "conditions", "callbacks", "metadata",
            "isId", "enum", "storage", "of", "oneOf", "properties", "relation",
            "propertiesOrder", "keyValue", "dimensions"
        ];
        // `sortable` was on this list and has moved: it is drag-to-reorder in
        // the form, read only by `RepeatFieldBinding`, and says nothing about
        // the data. `propertiesOrder` and `keyValue` look like the same case
        // and are not — `sortProperties` in `@rebasepro/common` reads the
        // first, and the OpenAPI generator reads the second.
        for (const key of contractKeys) {
            expect(ADMIN_PROPERTY_KEYS as readonly string[]).not.toContain(key);
        }
    });
});

const nested = (): CollectionConfig =>
    ({
        slug: "posts",
        name: "Posts",
        table: "posts",
        properties: { title: { name: "Title", type: "string" } },
        securityRules: [{ ownerField: "author_id" }],
        admin: { icon: "FileText", listProperties: ["title"], defaultViewMode: "table" }
    }) as unknown as CollectionConfig;

describe("resolveAdminCollection", () => {
    it("flattens the block onto the collection", () => {
        const resolved = resolveAdminCollection(nested()) as Record<string, unknown>;
        expect(resolved.icon).toBe("FileText");
        expect(resolved.listProperties).toEqual(["title"]);
        expect(resolved.defaultViewMode).toBe("table");
    });

    it("keeps the block, so the collection editor can still write it back", () => {
        const resolved = resolveAdminCollection(nested()) as Record<string, unknown>;
        expect(resolved.admin).toEqual({
            icon: "FileText",
            listProperties: ["title"],
            defaultViewMode: "table"
        });
    });

    it("leaves the contract fields alone", () => {
        const resolved = resolveAdminCollection(nested()) as Record<string, unknown>;
        expect(resolved.slug).toBe("posts");
        expect(resolved.table).toBe("posts");
        expect(resolved.securityRules).toEqual([{ ownerField: "author_id" }]);
    });

    it("is idempotent — the panel resolves at more than one entry point", () => {
        const once = resolveAdminCollection(nested());
        const twice = resolveAdminCollection(once) as Record<string, unknown>;
        expect(twice).toEqual(once);
        // Comparing the two passes to each other holds just as well for a
        // resolver that flattened nothing on either — both sides come out of the
        // same function. Name the fields that have to survive the second round.
        expect(twice.icon).toBe("FileText");
        expect(twice.listProperties).toEqual(["title"]);
        expect(twice.admin).toEqual({
            icon: "FileText",
            listProperties: ["title"],
            defaultViewMode: "table"
        });
    });

    it("passes a collection with no block straight through", () => {
        const bare = { slug: "tags", name: "Tags", table: "tags", properties: {} } as unknown as CollectionConfig;
        expect(resolveAdminCollection(bare)).toBe(bare);
    });

    it("does not mutate its input", () => {
        const source = nested();
        resolveAdminCollection(source);
        expect("icon" in (source as object)).toBe(false);
    });
});

describe("toAdminCollectionConfig", () => {
    it("lifts flattened fields back into the block", () => {
        const flat = resolveAdminCollection(nested());
        const authoring = toAdminCollectionConfig(flat) as unknown as Record<string, unknown>;
        expect(authoring.admin).toEqual({
            icon: "FileText",
            listProperties: ["title"],
            defaultViewMode: "table"
        });
        expect("icon" in authoring).toBe(false);
        expect("listProperties" in authoring).toBe(false);
    });

    it("round-trips: nested -> flat -> nested is the original", () => {
        const original = nested();
        const roundTripped = toAdminCollectionConfig(resolveAdminCollection(original));
        expect(roundTripped).toEqual(original);
    });

    it("emits no block when there is nothing to put in it", () => {
        const bare = { slug: "tags", name: "Tags", table: "tags", properties: {} } as unknown as AdminCollection;
        expect("admin" in (toAdminCollectionConfig(bare) as object)).toBe(false);
    });

    it("keeps a contract field that happens to sit next to admin fields", () => {
        const flat = {
            slug: "posts",
            table: "posts",
            properties: {},
            strictWrites: true,
            icon: "FileText"
        } as unknown as AdminCollection;
        const authoring = toAdminCollectionConfig(flat) as unknown as Record<string, unknown>;
        expect(authoring.strictWrites).toBe(true);
        expect(authoring.admin).toEqual({ icon: "FileText" });
    });
});

/**
 * The admin block's key-shaped fields must be checked against the collection's
 * own properties.
 *
 * This is a *type* test — the assertions are the `@ts-expect-error` comments,
 * which `tsconfig.tests.json` verifies; the runtime body only exists to give
 * jest something to run. It is here because this guarantee was silently absent
 * for the entire life of the feature and nothing noticed: `augment.ts` declared
 * `admin?: AdminCollectionOptions` with no type arguments, so `M` fell back to
 * `Record<string, unknown>`, `Extract<keyof M, string>` widened to `string`, and
 * every field below accepted any string. `defineCollection` computed the
 * inference and it was dropped one line short of the field that needed it.
 *
 * Delete an argument from that declaration and the `@ts-expect-error`s below go
 * unused, which is itself an error — so the seam cannot reopen quietly.
 */
describe("admin key fields are checked against the collection's properties", () => {
    const properties = {
        title: { name: "Title", type: "string" },
        score: { name: "Score", type: "number" },
        profile: { name: "Profile", type: "map", properties: {} }
    } as const;

    const base = { name: "Posts", slug: "posts", table: "posts", properties } as const;

    it("checks a display path against the collection's own properties", () => {
        const good = defineCollection({
            ...base,
            admin: {
                display: {
                    title: "title",
                    subtitle: "profile.displayName",   // dotted path into a map
                    status: "score" as never           // any property, any type
                }
            }
        });
        expect(good.admin?.display?.title).toBe("title");
    });

    it("rejects a misspelled display path", () => {
        // The reason this block is worth having at all: `titleProperty: "titel"`
        // used to be caught, and every other role was unchecked because it could
        // not be declared.
        // @ts-expect-error — "titel" is not a property of this collection
        defineCollection({ ...base, admin: { display: { title: "titel" } } });
    });

    it("accepts a resolver in any role, sync or async", () => {
        const good = defineCollection({
            ...base,
            admin: {
                display: {
                    title: ({ entity }) => String(entity.values.title ?? ""),
                    subtitle: async ({ entity, context }) => {
                        void context;
                        return String(entity.id);
                    },
                    tags: () => ["one", "two"]
                }
            }
        });
        expect(typeof good.admin?.display?.title).toBe("function");
    });

    it("accepts every legitimate form", () => {
        const good = defineCollection({
            ...base,
            admin: {
                titleProperty: "title",
                sort: ["score", "desc"],
                propertiesOrder: [
                    "title",
                    "profile.displayName",              // dotted path into a map
                    "subcollection:comments",           // child-collection column
                    "computed" as AdditionalFieldKey    // additionalFields[].key
                ],
                listProperties: ["title", "score"]
            }
        });
        expect(good.admin?.titleProperty).toBe("title");
    });

    // One bad key per call, deliberately. With several in one object literal,
    // overload resolution reports a single TS2769 against the *call* and the
    // per-property directives below it all read as unused — so the assertions
    // would pass for the wrong reason.
    it("rejects a misspelled titleProperty", () => {
        // @ts-expect-error — "titel" is not a property of this collection
        defineCollection({ ...base, admin: { titleProperty: "titel" } });
    });

    it("rejects a misspelled sort key", () => {
        // @ts-expect-error — "scoer" is not a property of this collection
        defineCollection({ ...base, admin: { sort: ["scoer", "desc"] } });
    });

    it("rejects a propertiesOrder entry that is not a property, path, or cast", () => {
        // @ts-expect-error — "nope" is neither a property, a dotted path, a
        // subcollection id, nor cast as an AdditionalFieldKey
        defineCollection({ ...base, admin: { propertiesOrder: ["title", "nope"] } });
    });

    it("rejects a misspelled listProperties entry", () => {
        // @ts-expect-error — "titel" is not a property of this collection
        defineCollection({ ...base, admin: { listProperties: ["titel"] } });
    });

    it("rejects a misspelled orderProperty", () => {
        // @ts-expect-error — the reorder handler *writes* to this property
        defineCollection({ ...base, admin: { orderProperty: "oder" } });
    });

    it("rejects a misspelled filter key", () => {
        // @ts-expect-error — "titl" is not a property of this collection
        defineCollection({ ...base, admin: { fixedFilter: { titl: ["==", "x"] } } });
    });

    it("rejects a misspelled defaultFilter key", () => {
        // @ts-expect-error — "scor" is not a property of this collection
        defineCollection({ ...base, admin: { defaultFilter: { scor: [">", 1] } } });
    });

    it("rejects a misspelled filterPreset key", () => {
        defineCollection({
            ...base,
            admin: {
                filterPresets: [{
                    label: "Bad",
                    // @ts-expect-error — "stauts" is not a property of this collection
                    filterValues: { stauts: ["==", "published"] }
                }]
            }
        });
    });

    it("accepts a dotted filter path into a map property", () => {
        const ok = defineCollection({
            ...base,
            admin: { fixedFilter: { "profile.city": ["==", "Berlin"] } }
        });
        expect(ok.admin?.fixedFilter).toEqual({ "profile.city": ["==", "Berlin"] });
    });

    // `columnProperty` is deliberately NOT checked — it is a required field, so a
    // generic-dependent type breaks `AdminCollection<M>` -> `AdminCollection`
    // assignability across ~15 call sites in the admin package. Documented as
    // remaining work rather than left looking like an oversight.
    it("does not yet check kanban columnProperty", () => {
        const loose = defineCollection({
            ...base,
            admin: { kanban: { columnProperty: "not_a_property" } }
        });
        expect(loose.admin?.kanban?.columnProperty).toBe("not_a_property");
    });
});
