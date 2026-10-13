/**
 * The one declaration a project writes to type its server-side data: its
 * generated `Database`, registered on `@rebasepro/types`' `Register`.
 */
import type { Database } from "../src/typed-sdk/database.types";

declare module "@rebasepro/types" {
    interface Register {
        database: Database;
    }
}
