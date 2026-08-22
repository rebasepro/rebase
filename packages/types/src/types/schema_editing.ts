/**
 * The vocabulary a live schema change is described in.
 *
 * Declared here, and nowhere else, because two packages that must not import
 * each other both need it: `@rebasepro/server-postgres` decides what a change
 * means and renders the files it needs, while `@rebasepro/server` commits those
 * files and serves the routes. Neither can reach the other — the server is
 * engine-agnostic by design — so the shared kernel holds the shapes and the
 * driver is detected structurally through {@link SchemaEditingAdmin}.
 *
 * Nothing here executes anything. These are the nouns.
 */

/**
 * What a change will do to a live database.
 *
 * - `safe` — the boot-time ensure path expresses it, and the result matches the
 *   configuration.
 * - `diverges` — the ensure path applies *something*, but the database will not
 *   match what the configuration declares, and nothing reports it. This is the
 *   category worth having: adding a required property to a populated table
 *   yields a nullable column, and adding a value to an existing enum yields
 *   nothing at all. Both read as success.
 * - `needs-migration` — the ensure path cannot express it. Dropping anything,
 *   changing a type, moving a primary key.
 */
export type SchemaChangeVerdict = "safe" | "diverges" | "needs-migration";

export type SchemaChangeKind =
    | "add-collection"
    | "remove-collection"
    | "add-property"
    | "remove-property"
    | "change-property-type"
    | "rename-column"
    | "add-enum-value"
    | "remove-enum-value"
    | "change-required"
    | "change-primary-key";

export interface SchemaChange {
    kind: SchemaChangeKind;
    verdict: SchemaChangeVerdict;
    /** Collection slug. */
    collection: string;
    /** Property name, where the change is to one. */
    property?: string;
    /** One line, specific: what changed and what it will do. */
    detail: string;
    /** What to do instead, when the verdict is not `safe`. */
    remedy?: string;
}

export interface ClassifiedSchemaChanges {
    changes: SchemaChange[];
    /** The worst verdict present, or `safe` for an empty diff. */
    verdict: SchemaChangeVerdict;
    /** True only when every change is `safe` — the one case an editor may apply. */
    applicable: boolean;
}

/** One file the commit writes, as content rather than as a path on a disk. */
export interface SchemaChangeFile {
    path: string;
    contents: string;
}

/**
 * Everything a change needs written and run, computed without touching a disk,
 * a database or a network.
 */
export interface SchemaChangePlan {
    /** Every file the commit writes — collection source and generated artifacts. */
    files: SchemaChangeFile[];
    /** The additive DDL this change adds, in dependency order. */
    statements: string[];
    classified: ClassifiedSchemaChanges;
    /** A commit message describing the change rather than announcing one. */
    message: string;
}

/**
 * An admin that can plan a schema change.
 *
 * Planning only. Applying is `executeSql`, which every SQL admin already has,
 * and committing belongs to whatever holds the repository — keeping those three
 * apart is what lets the same plan be committed locally on a developer's machine
 * and through a GitHub App from a cloud tenant.
 *
 * @group Admin
 */
export interface SchemaEditingAdmin {
    /**
     * Decide what the change means and render everything it needs.
     *
     * Rejects when the change is not applicable, carrying the classification so
     * a caller can say which change was the problem.
     */
    planSchemaChange(
        before: unknown[],
        after: unknown[],
        options?: { paths?: Partial<Record<"schemaFile" | "ddlFile" | "policiesFile" | "searchFile", string>> }
    ): Promise<SchemaChangePlan>;
}
