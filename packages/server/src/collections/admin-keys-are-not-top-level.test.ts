/**
 * Admin-block keys written at the top level of a property.
 *
 * `PROPERTY_MIGRATIONS` carries a hint for every key in `ADMIN_PROPERTY_KEYS`
 * — "`x` belongs in the property's `admin` block" — and it is generated from
 * that list, so it cannot fall behind it.
 *
 * `PROPERTY_KEYS_BY_TYPE` listed seven of those same keys as *valid* on the
 * four property types they used to live on before 0.11 moved them. The
 * allowlist is consulted first, so on exactly those types the key was accepted,
 * the migration hint was never reached, and nothing read the value — a config
 * written against the old shape booted clean with the option silently dropped,
 * while the identical key on any other type failed with a helpful message.
 */
import { findCollectionConfigProblems } from "./validate-config";
import { ADMIN_PROPERTY_KEYS } from "@rebasepro/types";

/**
 * The four types whose allowlists carried admin keys, each a property that is
 * otherwise valid.
 *
 * The first version of this file used `id:` and `dataType:` — the shape from
 * before the rename to `slug:` and `type:`. Every fixture then failed
 * validation for its own reasons, so all hundred "is reported" cases passed
 * whether or not the bug existed. The two control cases below are what caught
 * it, and they are the reason they are here.
 */
const BASES: Record<string, Record<string, unknown>> = {
    reference: { type: "reference", name: "Ref", path: "users" },
    relation: { type: "relation", name: "Rel", relation: { kind: "belongsTo", target: "users" } },
    array: { type: "array", name: "Arr", of: { type: "string", name: "Item" } },
    map: { type: "map", name: "Map", properties: {} }
};

function problemsFor(type: string, extra: Record<string, unknown>) {
    return findCollectionConfigProblems([{
        slug: "posts",
        table: "posts",
        name: "Posts",
        singularName: "Post",
        properties: { subject: { ...BASES[type], ...extra } }
    }] as never);
}

describe("an admin key at the top level of a property", () => {
    for (const type of Object.keys(BASES)) {
        // Every admin key, not the seven that were wrong — so a key added to
        // ADMIN_PROPERTY_KEYS later cannot be quietly allowed here too.
        it.each(ADMIN_PROPERTY_KEYS as readonly string[])(
            `is reported on a ${type} property: %s`,
            (key) => {
                const problems = problemsFor(type, { [key]: true });
                expect(problems.length).toBeGreaterThan(0);
                expect(JSON.stringify(problems)).toContain("admin");
            }
        );
    }

    it("still accepts the key inside the admin block", () => {
        // The other direction. A guard that rejects the correct shape too would
        // pass the test above and break every project.
        for (const type of Object.keys(BASES)) {
            const problems = problemsFor(type, { admin: { includeId: true } });
            expect(problems).toEqual([]);
        }
    });

    it("still accepts a property that carries no admin keys at all", () => {
        for (const type of Object.keys(BASES)) {
            expect(problemsFor(type, {})).toEqual([]);
        }
    });
});
