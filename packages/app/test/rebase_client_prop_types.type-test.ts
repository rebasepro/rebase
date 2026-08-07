import type { RebaseClient, User } from "@rebasepro/types";
import type { RebaseProps } from "../src/core/RebaseProps";

/**
 * `<Rebase client={...}>` has to accept the client a project actually built.
 *
 * `RebaseProps` was generic over `USER` and not over the database, so its
 * `client` prop was pinned to `RebaseClient` — that is, `RebaseClient<unknown>`,
 * whose `data` is the untyped branch of `RebaseSdkData`: an index signature
 * `[slug: string]: SDKCollectionClient`. Reaching `data.products` through it
 * yields `SDKCollectionClient<Record<string, unknown>>`, so every row a project
 * generated types for came back untyped — and the saas console, which passes a
 * client built against a generated `Database`, could not compile at all.
 *
 * There is no runtime here on purpose. These are assertions tsc makes, and the
 * file is named `.type-test.ts` rather than `.test.ts` so jest does not try to
 * execute declarations that emit nothing. `tsconfig.tests.json` names it
 * individually — an unread type fixture asserts precisely nothing, which is the
 * failure mode this repo has been bitten by more than once.
 *
 * Written as assignments rather than `T extends U ? ... : never`: a conditional
 * type uses a laxer relation, and the first draft of this file went on
 * compiling with the bug put back. Verified by restoring `client?: RebaseClient`
 * and watching `pnpm typecheck` go red here.
 */

/** A generated `Database`, in the shape codegen emits. */
type Database = {
    products: {
        Row: { id: string; title: string; price: number };
        Insert: { title: string; price: number };
        Update: { title?: string; price?: number };
    };
    orders: {
        Row: { id: string; total: number };
    };
};

declare const typedClient: RebaseClient<Database>;
declare const untypedClient: RebaseClient;

/** The assignment a JSX prop performs, with and without a type argument. */
export const typedProp: RebaseProps<User, Database>["client"] = typedClient;
export const untypedProp: RebaseProps<User>["client"] = untypedClient;

/** `DB` defaults to `unknown`, so existing callers need no type argument. */
export const defaulted: RebaseProps<User, unknown>["client"] = untypedProp;

/**
 * The row type survives the trip through the prop.
 *
 * Asserted in both directions: a widening to `Record<string, unknown>` is
 * assignable *from* nothing useful but would otherwise pass as a supertype, so
 * only the round trip catches the regression. This is the line that goes red.
 */
type Products = NonNullable<RebaseProps<User, Database>["client"]>["data"]["products"];
type ProductRow = Awaited<ReturnType<Products["find"]>>["data"][number];
declare const productRow: ProductRow;

export const exactRow: { id: string; title: string; price: number } = productRow;
export const roundTrip: ProductRow = exactRow;
