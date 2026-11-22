/**
 * What the stock backend needs from wherever it runs: its database, bound from
 * `DATABASE_URL` — implicit, and written out because a backend with no module
 * at all is not one `rebase build` will build.
 *
 * There is deliberately no `storage.ts` beside this. A stock project's storage
 * access model is its `STORAGE_POLICIES`: rules as data, seeded on the stock
 * deploy and edited in the console. Code here would answer for every key those
 * rules do not cover.
 */
import { database } from "@rebasepro/types";

export const main = database();
