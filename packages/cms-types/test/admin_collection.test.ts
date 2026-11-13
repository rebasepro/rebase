import {
    resolveAdminCollection,
    toAdminCollectionConfig,
    type AdditionalFieldKey,
    type AdminCollection,
    type AdminCollectionOptions
} from "../src/admin_collection";
import { ADMIN_COLLECTION_KEYS, ADMIN_PROPERTY_KEYS } from "../src/admin_block";
// There is no separate admin authoring type: `augment.ts` declares `admin` onto
// `CollectionConfig` itself, so core's type *is* the nested authoring shape.
import type { CollectionConfig } from "@rebasepro/cms-types";

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

    it("covers the 41 fields the split moved off the collection", () => {
        // A bare count, as a tripwire. If this number changes, either a field was
        // added to the admin block (add it above too) or one was moved back out to
        // the contract — and the second is a decision, not a refactor.
        // 40 since `display` joined.
        // 41 since `hideFromEntityViews` split the drawer's answer from the
        // parent tab strip's; it is on the core list and sorted, so the count is
        // the only thing that was outstanding.
        // 42 since `customViews` opened the view switcher to app-supplied
        // renderings of a collection's rows.
        // 41 again since `titleProperty` was removed — `display.title` is the
        // only way to state it, so the schema editor has one place to write.
        // 42 since `browserCallbacks` — lifecycle callbacks that run in the
        // panel, for collections whose data source the browser talks to
        // directly. Deliberately not named `callbacks`: that key is the
        // contract's, it means "runs on the server", and the assertion below
        // keeps it off this list.
        expect(ADMIN_COLLECTION_KEYS).toHaveLength(42);
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
        // 27: `format` (AdminNumberOptions) and `renderInForm`
        // (AdminRelationOptions) had never been listed. That is no longer
        // something a count can be the first to notice — `property_options.ts`
        // now asserts the reverse direction at compile time, and this pair is
        // what the assertion found on its first run.
        // 28: `filledByServer`, a required field a server hook fills on create.
        expect(ADMIN_PROPERTY_KEYS).toHaveLength(28);
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

const nested = (): CollectionConfig => ({
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: { title: { name: "Title", type: "string" } },
    securityRules: [{ ownerField: "author_id" }],
    admin: { icon: "FileText", listProperties: ["title"], defaultViewMode: "table" }
});

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
        const bare: CollectionConfig = { slug: "tags", name: "Tags", table: "tags", properties: {} };
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
        const authoring = toAdminCollectionConfig(flat);
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
        const bare: AdminCollection = { slug: "tags", name: "Tags", table: "tags", properties: {} };
        expect("admin" in toAdminCollectionConfig(bare)).toBe(false);
    });

    it("keeps the edit the panel made, not the block it was loaded with", () => {
        // What the editor's forms actually do: flatten for display, bind to the
        // flat name (`setFieldValue("defaultViewMode", …)`), leave `values.admin`
        // holding the copy the collection was loaded with, then nest on save.
        // Resolving that conflict towards the block reverts every presentation
        // edit, and the schema editor in `@rebasepro/server` — a second copy of
        // this same nesting — used to do exactly that.
        const edited: AdminCollection = {
            ...resolveAdminCollection(nested()),
            defaultViewMode: "cards"
        };

        const authoring = toAdminCollectionConfig(edited);
        expect(authoring.admin?.defaultViewMode).toBe("cards");
        // The fields the user did not touch are still there.
        expect(authoring.admin?.icon).toBe("FileText");
    });

    /**
     * The two callback blocks are one flatten away from each other, and getting
     * this wrong swaps which runtime a callback belongs to: `browserCallbacks`
     * left at the top level is a field the backend ignores and the panel never
     * reads back, while `callbacks` pulled into `admin` would take a server
     * callback — the one that may hold an API key — and file it under the block
     * that ships to every visitor.
     */
    it("nests browserCallbacks and leaves the server's callbacks at the top", () => {
        const afterRead = () => ({});
        const beforeSave = () => ({});
        const flat: AdminCollection = {
            slug: "posts",
            name: "Posts",
            table: "posts",
            properties: {},
            callbacks: { beforeSave },
            browserCallbacks: { afterRead }
        };

        const authoring = toAdminCollectionConfig(flat);
        expect(authoring.callbacks).toEqual({ beforeSave });
        expect(authoring.admin).toEqual({ browserCallbacks: { afterRead } });
        expect("browserCallbacks" in authoring).toBe(false);
    });

    it("flattens browserCallbacks back out, so the panel reads one name", () => {
        const afterRead = () => ({});
        const nestedCollection: CollectionConfig = {
            slug: "posts",
            name: "Posts",
            table: "posts",
            properties: {},
            admin: { browserCallbacks: { afterRead } }
        };

        const flat = resolveAdminCollection(nestedCollection);
        expect(flat.browserCallbacks).toEqual({ afterRead });
        expect(toAdminCollectionConfig(flat)).toEqual(nestedCollection);
    });

    it("keeps a contract field that happens to sit next to admin fields", () => {
        const flat: AdminCollection = {
            slug: "posts",
            name: "Posts",
            table: "posts",
            properties: {},
            strictWrites: true,
            icon: "FileText"
        };
        const authoring = toAdminCollectionConfig(flat);
        expect(authoring.strictWrites).toBe(true);
        expect(authoring.admin).toEqual({ icon: "FileText" });
    });
});

/**
 * A typed collection's admin block has to stay usable as a generic one: every
 * consumer that takes a collection it did not author depends on
 * `AdminCollectionOptions<M>` being assignable to `AdminCollectionOptions`, and
 * so do `defineCollection`'s overloads. A callback written as an arrow property
 * (`resolve: (params: …<M>) => …`) takes `M` in parameter position and makes the
 * whole block invariant in `M`; method syntax is bivariant under
 * `strictFunctionTypes`. See `EntityDisplayResolver` in `types/entity_display.ts`.
 *
 * The assignment below is the assertion, and tsc is what runs it: this file is
 * in `tsconfig.tests.json`, so it fails `pnpm typecheck` the day a resolver is
 * written the other way.
 */
describe("a typed collection's admin block is usable as a generic one", () => {
    it("assigns AdminCollectionOptions<M>, display resolvers included, to AdminCollectionOptions", () => {
        type Post = { id: string; title: string; published: boolean };
        const typed: AdminCollectionOptions<Post> = {
            display: {
                title: ({ row }) => String(row.title),
                subtitle: "title"
            }
        };
        const generic: AdminCollectionOptions = typed;
        expect(generic).toBe(typed);
    });
});
