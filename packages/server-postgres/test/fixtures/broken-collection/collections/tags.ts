/**
 * A collection module that does not evaluate.
 *
 * The shape that shipped was a collection importing a symbol its pinned
 * dependency did not export. The Drizzle generator reads collections and
 * nothing else — it never evaluates `resources.ts` — so this is the failure
 * that reaches it. Thrown outright so the test does not depend on which
 * symbols a given version happens to export.
 */
throw new Error("tags.ts did not evaluate (fixture)");

export {};
