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
    { op: "create", collection: "orders", values: { total: 40 }, ref: "order" },
    { op: "create", collection: "orderItems", values: { order_id: { $ref: "order.id" }, sku: "A-1" } }
]);
