/**
 * The negative assertion: a BaaS project has no admin surface *at all*.
 *
 * Every other check in this fixture proves something works. This one proves something
 * is impossible, which is the harder half and the one that rots silently — a stray
 * re-export or a widened type would put `admin` back on the property model and nothing
 * else here would notice.
 *
 * `@ts-expect-error` is the assertion: it fails the build if the line it guards ever
 * *stops* being an error. So this file passing means the admin block is genuinely
 * absent, not merely unused.
 */
import type { PostgresCollectionConfig, StringProperty } from "@rebasepro/types";

// A property has no `admin`.
const property: StringProperty = {
    name: "Title",
    type: "string",
    // @ts-expect-error — `admin` is declared by @rebasepro/admin-types, which a BaaS
    // project does not install. Writing one here must not compile.
    admin: { multiline: true }
};

// Neither does a collection.
const collection: PostgresCollectionConfig = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {},
    // @ts-expect-error — same guarantee, one level up.
    admin: { icon: "FileText" }
};

// And the option types themselves are not reachable from core.
// @ts-expect-error — AdminPropertyOptions lives in @rebasepro/admin-types now.
import type { AdminPropertyOptions } from "@rebasepro/types";

// @ts-expect-error — as does AdminCollectionOptions.
import type { AdminCollectionOptions } from "@rebasepro/types";

export type { AdminPropertyOptions, AdminCollectionOptions };
export { property, collection };
