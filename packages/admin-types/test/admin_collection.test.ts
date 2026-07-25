import {
    ADMIN_COLLECTION_KEYS,
    resolveAdminCollection,
    toAdminCollectionConfig,
    type AdminCollection
} from "../src/admin_collection";
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

    it("covers the 38 fields the split moved off the collection", () => {
        // A bare count, as a tripwire. If this number changes, either a field was
        // added to the admin block (add it above too) or one was moved back out to
        // the contract — and the second is a decision, not a refactor.
        expect(ADMIN_COLLECTION_KEYS).toHaveLength(38);
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
        const twice = resolveAdminCollection(once);
        expect(twice).toEqual(once);
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
