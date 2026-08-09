---
description: Strict TypeScript coding standards and type-safety rules
---
# Rebase Coding Standards and TypeScript Rules

When contributing to the Rebase monorepo, you MUST adhere strictly to the following engineering standards.

## 1. NEVER Use `as any` (ZERO TOLERANCE)
- **Lazy casting is forbidden**: Do NOT use `as any` to bypass the TypeScript compiler. It defeats the entire purpose of a strongly-typed framework.
- **Provide proper abstractions**: If an configuration object is dynamically passed (e.g., to a bootstrapper), define a rigorous interface (e.g., `RebaseAuthConfig` with an index signature `[key: string]: unknown` for extensibility) instead of leaving it as `unknown` and later casting it.
- **Narrow types safely**: Use type guards (`typeof`, `instanceof`, custom type predicates) rather than forcing assertions. If you must use assertions, cast to a specific, modeled interface representing reality, NEVER `any`.

## 2. Framework Configuration Completeness
- Provide exhaustive typings for all core modules (`init.ts`, routing, middlewares).
- Treat `RebaseBackendConfig` and similar orchestrating structures as first-class schemas. Avoid abstracting them too far unless strictly bounded by Generics.

## 3. Secure by Default, Delegation by Choice
- Rebase acts as a true Backend-as-a-Service (BaaS).
- **Secure by default**: All data routes require authentication unless the developer explicitly opts out with `requireAuth: false`. This prevents accidental public exposure when no Postgres RLS policies exist.
- **Delegation to RLS is opt-in**: Developers who want anonymous access must explicitly set `auth.requireAuth: false`, acknowledging that access control is fully delegated to Postgres RLS policies. The middleware still scopes the connection for an anonymous caller, so RLS policies can evaluate the request.
- **Fail closed**: The raw unscoped driver is never exposed to request handlers. Every code path is either scoped to the caller or rejects with an error. Silent fallbacks to unscoped access are forbidden.
- **Do not re-scope by hand.** `context.data` inside a collection callback is *already* user-scoped on a user request. `context.driver.withAuth(user)` exists and is declared, but it answers a problem that does not exist here; reach for it only when you know why `context.data` is wrong for your case.

## 4. Strict ES Modules (ESM) Only (NO `require`)
- **No dynamic `require()` statements**: Rebase handles monorepo build tools, Vite, and ESM environments. Using inline `require("@rebasepro/...")` inside logic blocks will trigger critical `ReferenceError: require is not defined` errors.
- **Top-level Imports Only**: Always use standard ES modules `import { Target } from "module"` syntax at the top of your files.
- If importing causes circular dependency issues, you must fix the architectural pattern (e.g. inject dependencies via constructors or refactor shared logic) rather than cheating with a dynamic `require()`.

## 5. NO HACKS EVER (Absolute Zero Tolerance)
- **Fix the Root Cause, Always**: Do NOT use hacks, workarounds, script interceptions, monkey patches, or arbitrary bypasses to fix *any* issue. This applies to application code, architecture, build tooling, CI/CD, and infrastructure.
- **Find the Native, Architectural Solution**: Always investigate until you find the true root cause. Solve it the proper way, even if it requires more effort, reading documentation, or deep architectural refactoring.
- **This is a serious project**: Duct-tape fixes are strictly prohibited. We build for long-term stability and reliability.

## 6. Foreign Keys and Relations
- **Principle of Least Astonishment**: When exposing relational data via APIs or SDKs, foreign key fields (e.g., `company_id`) MUST always return primitive scalars (`string` or `number`).
- **Simultaneous Access**: Do not strip the raw foreign key from the payload just because the relation is expanded. Both the primitive key (`company_id`) and the hydrated relation object (`company`) must co-exist to maintain backward compatibility and type safety.

## 7. Circular Dependency Prevention
- **No barrel-file cross-imports**: Replace barrel-file imports (`import { X } from "./index"`) with explicit direct imports (`import { X } from "./models/x"`).
- **Use `import type` for type-only references**: When a module only needs TypeScript types from another module, use `import type { ... }` to prevent runtime circular dependency chains.
- **Strictly acyclic dependency graph**: Cross-package type references must follow a one-way dependency flow. If two modules reference each other, the shared types must be extracted to a common base module.

## 8. No Hidden Side-Channels (Dunder Properties)
- **No `__xyz` dunder properties on data objects**: Never attach hidden metadata (e.g., `__junction_table_info`) to entity values that flow through the serialization pipeline. These can leak into database writes and corrupt data.
- **Use explicit variable transport**: Pass metadata through function parameters, context objects, or dedicated transport structures — never by mutating data payloads.

## 9. Localization (i18n)
- **All user-facing strings must use the `t()` hook**: Import `useTranslation` from `@rebasepro/app` and use the `t()` function it returns for all visible text (labels, messages, tooltips, placeholders). It takes i18next interpolation variables: `t("add_to_field", { fieldName: "Tags" })`.
- **Never hardcode English strings in UI components**: If a translation key is missing, add it to `packages/app/src/locales/en.ts` first, then use `t("your_key")`.
- **Locale files are the single source of truth**: All translation strings live in the locale files under `packages/app/src/locales/`.

## 10. No Process or Legacy Comments
- **Clean state documentation**: Documentation and comments must describe what the code *is* and what it *does*, not what it *used to be* or the *process* of how it evolved.
- **No legacy references**: Never include phrases like "this is the modern alternative to X", "this is the successor to Y", or "we migrated this because Z". 
- **Treat the codebase as new**: The user considers this a new project. Historical context about soft-deprecations or transitions should be kept out of inline source code comments.

## 11. NO POLLING FOR DATA SYNC (Use Realtime Sync)
- **Zero Tolerance for REST Polling**: Never use `setInterval` or background polling loops (`setInterval(fetchProjects, 5000)`) in React components to get live database updates. Rebase is built around a WebSocket real-time sync engine.
- **Use Subscriptions**: Always use `rebaseClient.data.<slug>.listen()` — or `.listenById()` to track one row — for live data. Use `rebaseClient.data.collection("<slug>")` when the slug is dynamic. It streams inserts, updates and deletes, respecting Postgres RLS rules.
- **Graceful Fallback**: Wrap subscription calls in support checks (e.g., `if (collection.listen)`) to handle environments where WebSockets are unavailable and fallback gracefully to one-time REST requests.
- **RPC Telemetry Polling**: Telemetry or metrics endpoints (which run custom server-side RPC functions) can be polled, but only when their respective tab/component is actively visible in the UI to minimize server overhead.

*These rules were instated because lazy abstractions, dynamic requires, REST polling on a real-time framework, and hacking around problems instead of fixing the root cause have previously caused critical technical debt and system instability.*
