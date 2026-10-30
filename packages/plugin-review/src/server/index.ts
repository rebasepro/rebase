/**
 * `@rebasepro/plugin-review/server` — the review function and the store it
 * keeps proposals in.
 *
 * Register the function under the name your configuration uses (`review` by
 * default), and agents propose through it while reviewers decide in the admin
 * panel:
 *
 * ```ts
 * // functions/review.ts
 * import { reviewFunction } from "@rebasepro/plugin-review/server";
 * import { review } from "../config/review";
 *
 * export default reviewFunction(review);
 * ```
 *
 * @module
 */
export { reviewFunction } from "./function";
export type { ReviewFunctionOptions } from "./function";
export { createStagedChangeStore, isStagedChangeId } from "./store";
export type { NewStagedChange, SqlExecutor, StagedChangeFilter, StagedChangeStore } from "./store";
export * from "../config";
