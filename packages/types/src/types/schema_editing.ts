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
    | "change-primary-key"
    | "rename-table"
    /** A property key renamed while keeping its column: no data moves. */
    | "rename-property"
    /** A relation's kind, foreign key or link column changes. */
    | "change-relation"
    /** A UNIQUE constraint, an index or an update trigger appears or goes. */
    | "change-constraint"
    /** A column's DEFAULT is set, changed or dropped. */
    | "change-default"
    /** The proposed collections cannot be planned at all. */
    | "invalid-collection"
    /** A collection's row-level security policies change. */
    | "change-security-rules";

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
    /**
     * What "Edit source only" leaves behind for this change: the collection is
     * committed and the database is not touched. Absent on a change that may
     * not be written source-only at all — one that would leave a project that
     * does not start, or reads its data as the wrong type.
     */
    sourceOnly?: string;
    /** The same, in a few words for a commit subject: `column products.sku kept`. */
    kept?: string;
}

export interface ClassifiedSchemaChanges {
    changes: SchemaChange[];
    /** The worst verdict present, or `safe` for an empty diff. */
    verdict: SchemaChangeVerdict;
    /** True only when every change is `safe` — the one case an editor may apply. */
    applicable: boolean;
}

/**
 * Where a project's generated schema artifacts live, relative to the **project**
 * root — which is the repository root only when the project is the whole
 * repository.
 *
 * Here rather than in the Postgres package because it is a contract, not an
 * engine detail: `@rebasepro/server` has to derive these for a project in a
 * subdirectory, and it cannot import a driver to do it.
 */
export interface SchemaCommitPaths {
    /** Drizzle schema, imported by the backend. */
    schemaFile: string;
}

/**
 * The SQL `db push` and `db generate` render — `schema.sql`, `policies.sql` and
 * the rest — is not here, and must not come back. Both commands regenerate it
 * from the collections before reading it, so nothing ever read a committed
 * copy; it lives in the gitignored `.rebase/sql/`. When the commit carried it,
 * it carried a second copy besides: these paths are from the project root,
 * while the CLI writes beside the backend, so a live edit left `drizzle/` and
 * `backend/drizzle/` disagreeing about the schema.
 */
export const DEFAULT_COMMIT_PATHS: SchemaCommitPaths = {
    schemaFile: "backend/src/schema.generated.ts"
};

/** One file the commit writes, as content rather than as a path on a disk. */
export interface SchemaChangeFile {
    path: string;
    contents: string;
    /** The commit removes this file — a deleted collection. `contents` is ignored. */
    deleted?: boolean;
}

/**
 * Everything a change needs written and run.
 *
 * Computed without touching a disk or a network. The database is *read* — what
 * a change means depends on what is already there, and a plan that guessed
 * would be guessing about whether the statements it returns will be accepted.
 */
export interface SchemaChangePlan {
    /** Every file the commit writes — collection source and generated artifacts. */
    files: SchemaChangeFile[];
    /** The additive DDL this change adds, in dependency order. */
    statements: string[];
    classified: ClassifiedSchemaChanges;
    /** A commit message describing the change rather than announcing one. */
    message: string;
    /**
     * Constraints the configuration asks for that these statements do not
     * carry, and why.
     *
     * Almost always empty. When it is not, it is the part the person confirming
     * needs to read: the change will apply, and the database will still not
     * enforce something the configuration says — a required property over a
     * table that already holds rows with no value for it. Optional so a plan
     * from an engine that does not distinguish these cases stays valid.
     */
    withheldConstraints?: WithheldSchemaConstraint[];
}

/** A constraint a plan asks for and does not apply. */
export interface WithheldSchemaConstraint {
    /** `schema.table.column`. */
    target: string;
    kind: "not-null" | "unique";
    /** What is in the way, naming the obstacle rather than the rule. */
    reason: string;
    /** What would make it applicable. */
    remedy: string;
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
        options?: {
            paths?: Partial<SchemaCommitPaths>;
            /**
             * Plan a commit of the source alone — "Edit source only": never
             * rejects an unapplicable change, carries no statements, and its
             * message names what is left in the database.
             */
            sourceOnly?: boolean;
        }
    ): Promise<SchemaChangePlan>;

    /**
     * What it would take to bring the database's existing columns in line with
     * the collections, beyond what boot does on its own.
     *
     * Boot is additive: it never relaxes a constraint and never drops a column,
     * because nobody reads its plan. This is the reviewed counterpart. It
     * plans `DROP NOT NULL` for every column the collections declare optional
     * and the database still requires, lists every column no collection
     * declares, and drops only the ones named in `drop`. Read-only; applying
     * is `executeSql`, gated by the caller on the plan's `digest`.
     *
     * Optional so a driver that cannot answer stays a valid admin.
     */
    planSchemaReconcile?(
        collections: unknown[],
        options?: {
            /** Undeclared columns to drop, as `<collection slug>.<column>`. */
            drop?: string[];
        }
    ): Promise<SchemaReconcilePlan>;
}

/** A column that exists in a collection's table and that no property declares. */
export interface SchemaReconcileColumn {
    /** The collection slug whose table holds it. */
    collection: string;
    /** `schema.table`. */
    table: string;
    column: string;
    /** NOT NULL with no default: every insert through the API fails on it. */
    blocksInserts: boolean;
    /** Rows holding a value in it. Counted only for a column being dropped. */
    rowsWithValue?: number;
}

/**
 * The plan `planSchemaReconcile` returns.
 *
 * `digest` identifies exactly these statements. A caller applies a plan only
 * when handed back the digest the person reviewed, so what runs is what was
 * read, and a database that changed in between is planned and shown again.
 */
export interface SchemaReconcilePlan {
    /**
     * Columns whose NOT NULL this plan drops: those declared optional that the
     * database still requires, and those no property declares that block
     * every insert (`undeclared: true`) and are not being dropped. Their data
     * stays.
     */
    relaxed: Array<{ collection: string; table: string; column: string; undeclared?: boolean }>;
    /** Every column no collection declares, dropped or not. */
    undeclared: SchemaReconcileColumn[];
    /** The undeclared columns this plan drops: the ones `drop` named. */
    dropped: SchemaReconcileColumn[];
    /** In order: every `DROP NOT NULL`, then every `DROP COLUMN`. */
    statements: string[];
    /** Why a requested drop cannot be planned. A plan with problems is not applied. */
    problems: string[];
    digest: string;
}
