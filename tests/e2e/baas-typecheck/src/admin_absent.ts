/**
 * The negative assertion: a BaaS project has no admin surface *at all*.
 *
 * Every other check in this fixture proves something works. This one proves something
 * is impossible, which is the harder half and the one that rots silently — a stray
 * re-export or a widened type would put `admin` back on the table model and nothing
 * else here would notice.
 *
 * `@ts-expect-error` is the assertion: it fails the build if the line it guards ever
 * *stops* being an error. So this file passing means the admin layer is genuinely
 * absent, not merely unused. Presentation lives in `frontend/src/cms` through
 * `customizeTable` from `@rebasepro/cms-types`, which a BaaS project does not install.
 */
import { col, defineTable } from "@rebasepro/types";

// A table has no `admin`.
export const posts = defineTable("posts", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.text()
    },
    rls: "admin-only",
    // @ts-expect-error — presentation is `customizeTable` in @rebasepro/cms-types,
    // which a BaaS project does not install. Writing it on the table must not compile.
    admin: { icon: "FileText" }
});

// Neither does a column builder.
// @ts-expect-error — same guarantee, one level down: there is no `.admin()`.
export const title = col.text().admin({ multiline: true });

// And the CMS layer itself is not reachable from core.
// @ts-expect-error — customizeTable lives in @rebasepro/cms-types.
import { customizeTable } from "@rebasepro/types";

// @ts-expect-error — AdminPropertyOptions lives in @rebasepro/cms-types.
import type { AdminPropertyOptions } from "@rebasepro/types";

// @ts-expect-error — as does AdminCollectionOptions.
import type { AdminCollectionOptions } from "@rebasepro/types";

export type { AdminPropertyOptions, AdminCollectionOptions };
export { customizeTable };
