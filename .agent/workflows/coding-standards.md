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

## 3. Delegation over Gatekeeping
- Rebase acts as a true Backend-as-a-Service (BaaS).
- **Let the DB Decide**: API routers should not blindly reject unauthenticated requests (`requireAuth: true`) if the endpoints represent database mutations or access. Pass the identity downward (even if it is the `"anon"` identity) and allow Postgres Row-Level Security (RLS) to evaluate the request.

## 4. Strict ES Modules (ESM) Only (NO `require`)
- **No dynamic `require()` statements**: Rebase handles monorepo build tools, Vite, and ESM environments. Using inline `require("@rebasepro/...")` inside logic blocks will trigger critical `ReferenceError: require is not defined` errors.
- **Top-level Imports Only**: Always use standard ES modules `import { Target } from "module"` syntax at the top of your files.
- If importing causes circular dependency issues, you must fix the architectural pattern (e.g. inject dependencies via constructors or refactor shared logic) rather than cheating with a dynamic `require()`.

## 5. NO HACKS EVER (Absolute Zero Tolerance)
- **Fix the Root Cause, Always**: Do NOT use hacks, workarounds, script interceptions, monkey patches, or arbitrary bypasses to fix *any* issue. This applies to application code, architecture, build tooling, CI/CD, and infrastructure.
- **Find the Native, Architectural Solution**: Always investigate until you find the true root cause. Solve it the proper way, even if it requires more effort, reading documentation, or deep architectural refactoring.
- **This is a serious project**: Duct-tape fixes are strictly prohibited. We build for long-term stability and reliability.

*These rules were instated because lazy abstractions, dynamic requires, and hacking around problems instead of fixing the root cause have previously caused critical technical debt and system instability.*
