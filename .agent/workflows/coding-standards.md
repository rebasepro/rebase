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

## 5. NO HACKS (Strict Resolution of CI/CD & Logic Errors)
- **Fix the Root Cause**: Do NOT use shell-script interception (e.g., path hijacking or fake executables) or arbitrary environment manipulation hacks to bypass failing processes.
- **Find the Native Solution**: Always find the official, native way to resolve issues. For example, if a node process runs out of memory, increase `NODE_OPTIONS=--max_old_space_size=...`. If a lockfile fails, fix the config organically (e.g., `pnpm config set frozen-lockfile false`).
- **This is a serious project**: Infrastructure and CI instability must be repaired structurally to ensure long-term framework reliability. Duct-tape fixes are unacceptable.

*These rules were instated because lazy abstractions, dynamic requires, and infrastructure hacks have previously caused critical technical debt, CI instability, and runtime crashes in the framework.*
