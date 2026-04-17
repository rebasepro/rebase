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

*These rules were instated because lazy `any` abstractions previously caused critical technical debt in framework initialization logic.*
