/**
 * A project's `resources.ts` that does not evaluate.
 *
 * The generators import this module so `declaredDatabaseExtensions()` can
 * answer, and the shape that shipped was a template importing a symbol its
 * pinned `@rebasepro/types` did not export — "does not provide an export named
 * 'queue'". Thrown outright here instead: the failure under test is "step 1 of
 * `rebase db push` raised", and a hard throw is that without depending on which
 * symbols a given version of `@rebasepro/types` happens to export.
 */
throw new Error("resources.ts did not evaluate (fixture)");

export {};
