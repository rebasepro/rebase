/**
 * The host-side machinery that serves custom functions.
 *
 * Kept apart from `./index.ts` on purpose. That file is the package's
 * `@rebasepro/server/functions` entry point — the surface a user's function
 * file imports — and it must stay importable on a runtime with no Node
 * built-ins. This one reads directories, spawns proxy requests and holds
 * timers, so it is imported by the package root and by `init.ts`, never by
 * application code.
 *
 * The split is enforced, not merely intended: `portability.test.ts` walks the
 * import graph of `./index.ts` and fails on the first module that reaches a
 * Node built-in. Re-export anything from this file there and that test goes red
 * immediately, which is the point — the boundary is worth more than any single
 * convenience export placed across it.
 *
 * @module
 */
export { loadFunctionsFromDirectory, loadFunctionsWithDiagnostics } from "./function-loader";
export type { LoadedFunction, LoadedFunctions } from "./function-loader";
export { createFunctionRoutes } from "./function-routes";
export { createFunctionsProxy } from "./proxy";
export type { FunctionsProxyOptions } from "./proxy";
export { createFunctionsRequestTimeout, resolveFunctionsTimeoutMs, DEFAULT_FUNCTIONS_TIMEOUT_MS } from "./request-timeout";
export { selectFunctions, FunctionSelectionError } from "./selection";
export type { FunctionSelection } from "./selection";
