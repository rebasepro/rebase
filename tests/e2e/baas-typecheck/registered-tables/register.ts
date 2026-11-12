/**
 * The one declaration a project writes to type its data with no codegen run:
 * its `backend/schema` module, registered on `@rebasepro/types`' `Register`.
 */
declare module "@rebasepro/types" {
    interface Register {
        tables: typeof import("../src/typed-sdk/schema");
    }
}

export {};
