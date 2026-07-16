import { CollectionConfig } from "@rebasepro/types";
import { resolvePrimaryKeys } from "@rebasepro/common";
import {
    findUnresolvableKeyCollections,
    getPrimaryKeys,
    requirePrimaryKeys,
    warnOnKeysTheAdminCannotResolve
} from "../src/services/collection-helpers";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

/**
 * The admin and this driver must resolve the same key, or the addresses one
 * builds are not the addresses the other parses.
 *
 * They resolve from different evidence: the driver reads `isId`, then the
 * drizzle schema, then a column named `id`; the admin shares the collection
 * config but never the drizzle schema — it compiles the same collection files
 * into its bundle, and nothing serves it one. So the middle tier is the
 * disagreement, and no runtime normalization can close it: only the config can,
 * which is why this reports instead of repairing.
 */
describe("key resolution — where the admin and the driver disagree", () => {
    const registry = new PostgresCollectionRegistry();

    const table = (name: string, columns: { name: string; primary?: boolean; columnType?: string; dataType?: string }[]) => {
        const t: Record<string, unknown> = { _def: { tableName: name } };
        for (const c of columns) {
            t[c.name] = {
                name: c.name,
                primary: c.primary ?? false,
                columnType: c.columnType ?? "PgText",
                dataType: c.dataType ?? "string"
            };
        }
        return t;
    };

    beforeEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(registry, "getTable").mockImplementation(name => {
            if (name === "declared") return table("declared", [{ name: "sku",
primary: true }, { name: "label" }]) as any;
            if (name === "drizzle_only") return table("drizzle_only", [{ name: "sku",
primary: true }, { name: "label" }]) as any;
            if (name === "shadowed") return table("shadowed", [{ name: "sku",
primary: true }, { name: "id" }, { name: "label" }]) as any;
            if (name === "plain_id") return table("plain_id", [
                { name: "id",
primary: true,
columnType: "PgSerial",
dataType: "number" },
                { name: "name" }
            ]) as any;
            return undefined;
        });
    });

    const declared: CollectionConfig = {
        slug: "declared",
        name: "Declared",
        table: "declared",
        properties: {
            sku: { type: "string",
isId: true },
            label: { type: "string" }
        }
    };

    // The key is `sku` in the drizzle schema, and the config never says so.
    const drizzleOnly: CollectionConfig = {
        slug: "drizzle_only",
        name: "Drizzle Only",
        table: "drizzle_only",
        properties: {
            sku: { type: "string" },
            label: { type: "string" }
        }
    };

    // The dangerous one: key is `sku`, but an unrelated `id` property exists,
    // so the admin resolves `id` and is confident about it.
    const shadowed: CollectionConfig = {
        slug: "shadowed",
        name: "Shadowed",
        table: "shadowed",
        properties: {
            sku: { type: "string" },
            id: { type: "string" },
            label: { type: "string" }
        }
    };

    const plainId: CollectionConfig = {
        slug: "plain_id",
        name: "Plain Id",
        table: "plain_id",
        properties: {
            id: { type: "number" },
            name: { type: "string" }
        }
    };

    describe("getPrimaryKeys — the tiers, and what 'no keys' means", () => {
        const noTable: CollectionConfig = {
            slug: "elsewhere",
            name: "Elsewhere",
            table: "not_registered",
            properties: {
                sku: { type: "string",
isId: true },
                label: { type: "string" }
            }
        };

        it("resolves a declared key without needing a registered table", () => {
            // The `isId` tier reads the config and nothing else. This used to
            // throw: the table was resolved first, so the one tier that needs
            // no table was unreachable for a collection that has none — which
            // is exactly the collection most likely to be in that state.
            expect(getPrimaryKeys(noTable, registry).map(k => k.fieldName)).toEqual(["sku"]);
        });

        it("returns no keys, rather than throwing, when nothing resolves", () => {
            const opaque: CollectionConfig = {
                slug: "opaque",
                name: "Opaque",
                table: "not_registered",
                properties: { label: { type: "string" } }
            };

            expect(getPrimaryKeys(opaque, registry)).toEqual([]);
        });

        it("requirePrimaryKeys names the collection it cannot address", () => {
            // Callers building a WHERE cannot proceed without a key, and
            // `[0]` of an empty array is a TypeError three frames away.
            const opaque: CollectionConfig = {
                slug: "opaque",
                name: "Opaque",
                table: "not_registered",
                properties: { label: { type: "string" } }
            };

            expect(() => requirePrimaryKeys(opaque, registry)).toThrow(/opaque.*no primary key/);
        });

        it("requirePrimaryKeys returns the keys when there are some", () => {
            expect(requirePrimaryKeys(declared, registry).map(k => k.fieldName)).toEqual(["sku"]);
        });
    });

    describe("findUnresolvableKeyCollections", () => {
        it("says nothing about a collection that declares its key", () => {
            expect(findUnresolvableKeyCollections([declared], registry)).toEqual([]);
        });

        it("says nothing about a plain `id` key — the last tier agrees on both sides", () => {
            // Neither side needs the drizzle schema to land on `id`.
            expect(resolvePrimaryKeys(plainId).map(k => k.fieldName)).toEqual(["id"]);
            expect(getPrimaryKeys(plainId, registry).map(k => k.fieldName)).toEqual(["id"]);
            expect(findUnresolvableKeyCollections([plainId], registry)).toEqual([]);
        });

        it("reports a key only drizzle knows, and that the admin resolves nothing", () => {
            expect(resolvePrimaryKeys(drizzleOnly)).toEqual([]);

            const [finding] = findUnresolvableKeyCollections([drizzleOnly], registry);
            expect(finding.collection.slug).toBe("drizzle_only");
            expect(finding.keys.map(k => k.fieldName)).toEqual(["sku"]);
            expect(finding.shadowedByIdProperty).toBe(false);
        });

        it("flags the shadowed case, where the admin resolves a different key", () => {
            // This is the disagreement: `id` here, `sku` on the server.
            expect(resolvePrimaryKeys(shadowed).map(k => k.fieldName)).toEqual(["id"]);
            expect(getPrimaryKeys(shadowed, registry).map(k => k.fieldName)).toEqual(["sku"]);

            const [finding] = findUnresolvableKeyCollections([shadowed], registry);
            expect(finding.shadowedByIdProperty).toBe(true);
        });

        it("says nothing about a collection whose table is not registered", () => {
            const orphan: CollectionConfig = {
                slug: "ghosts",
                name: "Ghosts",
                table: "ghosts",
                properties: { name: { type: "string" } }
            };
            expect(findUnresolvableKeyCollections([orphan], registry)).toEqual([]);
        });
    });

    describe("warnOnKeysTheAdminCannotResolve", () => {
        it("is silent when every collection agrees", () => {
            const warn = jest.fn();
            jest.spyOn(require("@rebasepro/server").logger, "warn").mockImplementation(warn);

            warnOnKeysTheAdminCannotResolve([declared, plainId], registry);

            expect(warn).not.toHaveBeenCalled();
        });

        it("names the column and the `isId` to add", () => {
            const warn = jest.fn();
            jest.spyOn(require("@rebasepro/server").logger, "warn").mockImplementation(warn);

            warnOnKeysTheAdminCannotResolve([drizzleOnly], registry);

            expect(warn).toHaveBeenCalledTimes(1);
            const message = warn.mock.calls[0][0] as string;
            expect(message).toContain("drizzle_only");
            expect(message).toContain("`sku`");
            expect(message).toContain("isId: true");
        });

        it("reports the shadowed case separately, as routing wrong rather than missing", () => {
            const warn = jest.fn();
            jest.spyOn(require("@rebasepro/server").logger, "warn").mockImplementation(warn);

            warnOnKeysTheAdminCannotResolve([shadowed, drizzleOnly], registry);

            expect(warn).toHaveBeenCalledTimes(2);
            const shadowedMessage = warn.mock.calls[0][0] as string;
            expect(shadowedMessage).toContain("route wrong");
            expect(shadowedMessage).toContain("shadowed");
            expect(shadowedMessage).not.toContain("drizzle_only");
        });
    });
});
