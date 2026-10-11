/**
 * `alwaysApplyDefaultValues` on a Postgres row.
 *
 * A Postgres row carries every column, an unset one as `null`. The flag merged
 * the declared defaults under the stored values, and `null` won, so the form
 * opened with `status: null` next to a `defaultValue: "draft"` and the flag did
 * nothing at all.
 */
import type { AdminCollection, AuthController } from "@rebasepro/cms-types";
import { getInitialEntityValues } from "../../src/form/form_utils";

const collection = (alwaysApplyDefaultValues: boolean) => ({
    slug: "posts",
    table: "posts",
    name: "Posts",
    alwaysApplyDefaultValues,
    properties: {
        id: { type: "string", isId: true },
        status: { type: "string", defaultValue: "draft" },
        views: { type: "number", defaultValue: 0 },
        featured: { type: "boolean", defaultValue: true },
        subtitle: { type: "string" },
        seo: {
            type: "map",
            properties: {
                robots: { type: "string", defaultValue: "index" },
                title: { type: "string" }
            }
        }
    }
} as unknown as AdminCollection);

const row = {
    id: "p-1",
    status: null,
    views: null,
    featured: false,
    subtitle: null,
    seo: { robots: null, title: "Kept" }
};

const open = (flag: boolean) => getInitialEntityValues({} as AuthController, collection(flag), "posts", "existing", {
    id: "p-1",
    path: "posts",
    values: row
});

describe("alwaysApplyDefaultValues", () => {
    it("fills a declared default into an empty stored value, nested maps included", () => {
        expect(open(true)).toEqual({
            id: "p-1",
            status: "draft",
            views: 0,
            featured: false,
            subtitle: null,
            seo: { robots: "index", title: "Kept" }
        });
    });

    it("keeps a stored value, false and 0 included", () => {
        const values = open(true);
        expect(values.featured).toBe(false);
        expect(values.seo).toMatchObject({ title: "Kept" });
    });

    it("leaves the stored row alone without the flag", () => {
        expect(open(false)).toEqual(row);
    });
});
