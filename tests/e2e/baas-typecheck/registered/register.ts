/**
 * The one declaration a project writes to type its server-side data: its
 * generated `Database`, registered on `@rebasepro/types`' `Register`.
 *
 * Its schema module is registered too (`tables`), as a project that started
 * without codegen and then generated would have it: the generated `database`
 * wins — `probes.ts` asserts `RegisteredDatabase` is exactly `Database`.
 */
import type { Database } from "../src/typed-sdk/database.types";

declare module "@rebasepro/types" {
    interface Register {
        database: Database;
        tables: typeof import("../src/typed-sdk/schema");
    }
}
