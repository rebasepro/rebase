/**
 * Compile-time assertions about `PropertyConditions`.
 *
 * A plain module under `src`, imported by nothing, for the reason
 * `packages/client/src/query-contract.types.ts` gives: `pnpm typecheck` reads
 * `src`, and a type assertion in a jest test is checked by nothing.
 *
 * A dynamic bound is usually a constant. The evaluator returns a literal
 * number as it is, and the docs write `min: 0` — which the type, a JSON Logic
 * rule only, refused.
 */
import type { PropertyConditions } from "./properties";

export const literalBounds: PropertyConditions = { min: 0, max: 100 };
export const ruleBounds: PropertyConditions = { min: { var: "values.floor" }, max: { "+": [{ var: "values.floor" }, 10] } };
