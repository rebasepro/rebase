/**
 * Compile-time assertion that what `createRebaseClient()` returns is a
 * `RebaseClient` — the type `<Rebase client={…}>` takes.
 *
 * A plain module under `src`, imported by nothing, for the reason
 * `query-contract.types.ts` gives: `pnpm typecheck` reads `src`, and a type
 * assertion in a jest test is checked by nothing.
 *
 * ## What went wrong that this exists to prevent
 *
 * 0.29.2 added `batch` to `RebaseSdkData`, and the typed data layer kept
 * picking `collection` alone. A `createRebaseClient<Database>()` stopped being
 * a `RebaseClient<Database>`, and every app passing one to `<Rebase>` — the
 * Cloud console among them — stopped compiling. Nothing in this repo passes a
 * typed client anywhere that wants a `RebaseClient`, so nothing here noticed.
 */
import type { RebaseClient } from "@rebasepro/types";
import type { CreateRebaseClientResult } from "./index";

/**
 * Shaped the way the generator writes one: an `interface` (no implicit index
 * signature, so the typed branch of `TypedDataLayer` is taken) whose entries
 * carry `Row`, `Insert`, `Update` and `Slug`.
 */
interface ContractDatabase {
    orders: {
        Row: { id: string; total: number };
        Insert: { total: number };
        Update: { total?: number };
        Slug: "orders";
    };
    orderItems: {
        Row: { id: string; order_id: string; sku: string };
        Insert: { order_id: string; sku: string };
        Update: { sku?: string };
        Slug: "order_items";
    };
}

declare const typedClient: CreateRebaseClientResult<ContractDatabase>;
declare const untypedClient: CreateRebaseClientResult;

export const typedIsARebaseClient: RebaseClient<ContractDatabase> = typedClient;
export const untypedIsARebaseClient: RebaseClient = untypedClient;

/** `data.batch` takes the accessor names, as `client.batch` does. */
export const typedDataBatch = () => typedClient.data.batch([
    { op: "create", table: "orders", values: { total: 40 }, ref: "order" },
    { op: "create", table: "orderItems", values: { order_id: { $ref: "order.id" }, sku: "A-1" } }
]);

/**
 * `data.table(slug)` is the by-slug accessor, typed from the generated
 * `Database` exactly as the accessor property is: `table("order_items")` is
 * `orderItems`, and a slug the `Database` does not declare falls through to
 * the untyped overload.
 */
export const typedTableBySlug = async () => {
    const { data } = await typedClient.data.table("order_items").find();
    const sku: string = data[0].sku;
    const byAccessor: typeof typedClient.data.orderItems = typedClient.data.table("order_items");
    const untyped = untypedClient.data.table("anything");
    return { sku, byAccessor, untyped };
};

/**
 * The backend's data is addressed as a table: `data.collection(slug)` and the
 * top-level `client.collection(slug)` are gone, with no alias left behind.
 */
export const noCollectionAccessor = () => {
    // @ts-expect-error — `data.collection(slug)` is `data.table(slug)`.
    typedClient.data.collection("orders");
    // @ts-expect-error — the untyped client's `data.collection` is the table named "collection", not a function.
    untypedClient.data.collection("orders");
    // @ts-expect-error — `client.collection(slug)` is `client.table(slug)`.
    typedClient.collection("orders");
};
