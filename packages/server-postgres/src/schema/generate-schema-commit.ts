/**
 * Everything a schema change has to write, as file contents.
 *
 * A live schema editor that only edits the collection source produces a repo
 * that does not build: `backend/src/schema.generated.ts` is a committed
 * artifact, and a stale one has broken every deploy at least once. So the unit
 * of a schema change is not a file, it is a **commit** — and this module
 * produces one, without touching a disk, a database or a network.
 *
 * Pure on purpose. The risky half of "commit, then apply" is generating a
 * correct commit; keeping it a function from collections to file contents is
 * what lets that half be tested by building a database from the result and
 * comparing it to the one the change describes.
 *
 * ## Where the migration comes from, and why not from Atlas
 *
 * `rebase db generate` mints migrations by running Atlas over the generated
 * `schema.sql`. Atlas is an external binary, it wants a dev database, and it
 * maintains an `atlas.sum` integrity file whose hash this module would have to
 * reproduce byte-for-byte to stay valid.
 *
 * None of that is necessary here, because of what the editor is allowed to do.
 * `classify-change.ts` refuses anything the boot-time ensure path cannot
 * express, which leaves only additive statements — and those are computable as
 * a plain difference between two ensure plans:
 *
 *     plan(after, nothing) − plan(before, nothing)
 *
 * Both plans are pure functions of the collections, every statement is
 * idempotent, and the difference is exactly what the change adds. No diff
 * engine, no database, no binary.
 *
 * The statements are *returned* rather than written into a migration file. A
 * project provisioned by boot-ensure needs no migration at all — its
 * collections are the schema — while a project provisioned by migrations needs
 * the file to carry an Atlas hash, which only Atlas can mint. Writing a
 * migration this module cannot make valid would be worse than handing the
 * statements to a caller who knows which kind of project it is.
 */
import {
    DEFAULT_COMMIT_PATHS,
    declaredDatabaseExtensions,
    type CollectionConfig,
    type SchemaCommitPaths
} from "@rebasepro/types";
import {
    generatePostgresDdl,
    generatePostgresPoliciesDdl,
    generatePostgresSearchDdl,
    generatePostgresVectorDdl
} from "./generate-postgres-ddl-logic";
import { generateSchema } from "./generate-drizzle-schema-logic";
import {
    planCollectionSchemaEnsure,
    type EnsureOptions,
    type ExistingSchema,
    type WithheldConstraint
} from "./ensure-collection-tables";
import { classifyCollectionChanges, type ClassifiedChanges } from "./classify-change";

/**
 * Re-exported from the shared kernel. `@rebasepro/server` derives these for a
 * project in a subdirectory and cannot import a driver to do it, so the shape
 * and the defaults live in `@rebasepro/types`.
 */
export { DEFAULT_COMMIT_PATHS, type SchemaCommitPaths } from "@rebasepro/types";

export interface SchemaCommitFile {
    path: string;
    contents: string;
}

export interface SchemaCommitInput {
    /** What the running database was built from. */
    before: CollectionConfig[];
    /** What the editor is proposing. */
    after: CollectionConfig[];
    /**
     * Files the caller has already produced — in practice the rewritten
     * collection source from the AST editor. Carried through unchanged so the
     * commit is complete in one object.
     */
    sourceFiles?: SchemaCommitFile[];
    paths?: Partial<SchemaCommitPaths>;
    /**
     * What the database this change is destined for actually has.
     *
     * Supplied by the live editor, which read it a moment ago; omitted by the
     * pure callers, which have no database. It decides two things a plan cannot
     * know from the collections alone — whether a table holds rows, and which
     * values an enum type already carries — and both are the difference between
     * a statement that applies and one that is rejected.
     */
    existing?: ExistingSchema;
}

export interface SchemaCommit {
    /** Every file the commit writes, source and generated alike. */
    files: SchemaCommitFile[];
    /**
     * The additive statements this change adds, in dependency order.
     *
     * Empty when the change needs no DDL. Not written to a migration file —
     * see the module comment.
     */
    statements: string[];
    classified: ClassifiedChanges;
    /** A commit message describing the change in the terms a reader wants. */
    message: string;
    /**
     * Constraints this change asks for that the statements do not carry, and
     * why. Empty for almost every change; when it is not, it is the thing the
     * person confirming needs to read before they confirm.
     */
    withheldConstraints: WithheldConstraint[];
}

export class SchemaCommitError extends Error {
    constructor(message: string, readonly classified: ClassifiedChanges) {
        super(message);
        this.name = "SchemaCommitError";
    }
}

/** An `ExistingSchema` describing a database that has nothing in it. */
const nothing = () => ({ tables: new Map<string, Set<string>>(), enums: new Set<string>() });

/**
 * The statements that take `before` to `after`.
 *
 * Both sides are planned against the *same* database and the difference is
 * taken by exact statement text. That works because the planner is
 * deterministic: the same collections against the same schema produce the same
 * strings, so anything in the second plan and absent from the first is what
 * this change adds — and nothing else. Planning both sides is what keeps
 * pre-existing drift, which belongs to neither side of the edit, out of the
 * statements this change gets credited with.
 *
 * ## Why `existing` matters more than it looks
 *
 * Planned against `nothing()`, every table reads as one this plan is creating,
 * and the planner is then free to attach constraints that only hold on a table
 * with no rows: a new required property comes out as
 * `ADD COLUMN "x" TEXT NOT NULL`, which is right for a fresh table and fails
 * against a live one holding rows. Those statements would be generated,
 * committed, and then rejected by the very database they were written for.
 *
 * So a caller holding a real database passes it, and gets statements that
 * describe that database. `nothing()` stays the default for the pure uses —
 * generating a commit for inspection, and the tests that compare two plans —
 * where there is no database to describe.
 */
export function additiveStatements(
    before: CollectionConfig[],
    after: CollectionConfig[],
    existing: ExistingSchema = nothing(),
    options: EnsureOptions = {}
): string[] {
    const previous = new Set(planCollectionSchemaEnsure(before, existing, options).statements);
    return planCollectionSchemaEnsure(after, existing, options).statements
        .filter(statement => !previous.has(statement));
}

/** A commit message that says what changed rather than that something did. */
export function commitMessage(classified: ClassifiedChanges): string {
    const { changes } = classified;
    if (changes.length === 0) return "chore(schema): no change";

    const collections = [...new Set(changes.map(change => change.collection))].sort();
    const added = changes.filter(c => c.kind === "add-collection").map(c => c.collection);
    const properties = changes.filter(c => c.kind === "add-property");

    let subject: string;
    if (added.length === 1 && changes.length === 1) {
        subject = `add the ${added[0]} collection`;
    } else if (properties.length === 1 && changes.length === 1) {
        subject = `add ${properties[0].property} to ${properties[0].collection}`;
    } else if (collections.length === 1) {
        subject = `${changes.length} change(s) to ${collections[0]}`;
    } else {
        subject = `${changes.length} change(s) across ${collections.length} collections`;
    }

    const body = changes.map(change => `- ${change.detail}`).join("\n");
    return `feat(schema): ${subject}\n\n${body}\n`;
}

/**
 * Build the commit.
 *
 * Refuses when the change is not applicable — a commit describing a schema the
 * ensure path will not produce is a commit that makes the repository lie about
 * the database. The classification travels on the error so a caller can show
 * exactly which change was the problem.
 */
export async function generateSchemaCommit(input: SchemaCommitInput): Promise<SchemaCommit> {
    const paths = { ...DEFAULT_COMMIT_PATHS, ...input.paths };
    const existing = input.existing ?? nothing();
    // `converge` because every statement this produces is shown to somebody
    // before it runs. See `ConstraintPolicy` for why the unattended boot does
    // not get the same latitude.
    const options: EnsureOptions = { constraints: "converge" };
    const classified = classifyCollectionChanges(input.before, input.after, input.existing);

    if (!classified.applicable) {
        const blocking = classified.changes.filter(change => change.verdict !== "safe");
        throw new SchemaCommitError(
            `This change cannot be applied to a running database:\n` +
            blocking.map(change =>
                `  • ${change.detail}${change.remedy ? `\n    ${change.remedy}` : ""}`
            ).join("\n"),
            classified
        );
    }

    // The same split `rebase db generate` writes, and it has to be the same:
    // these files land in the repository, and the next `db push` runs Atlas
    // against `schema.sql`. Generated whole, it carries the RLS policies (which
    // Atlas would then own and drop), the search helpers (which its free tier
    // refuses to parse at all) and `VECTOR(n)` (which its dev database cannot
    // resolve) — so a live schema edit used to leave behind a desired-state
    // file that `db push` chokes on.
    const [schema, ddl, policies, search, vector] = await Promise.all([
        generateSchema(input.after),
        generatePostgresDdl(input.after, {
            includePolicies: false,
            includeSearch: false,
            includeVector: false
        }),
        Promise.resolve(generatePostgresPoliciesDdl(input.after)),
        Promise.resolve(generatePostgresSearchDdl(input.after)),
        // The registry, because this runs inside the booted server, which has
        // already evaluated the project's `resources.ts`. A commit that wrote a
        // `vector.sql` disagreeing with the one `rebase db generate` produces
        // would show up as drift in the repository the moment anyone regenerated.
        Promise.resolve(generatePostgresVectorDdl(input.after, {
            extensions: declaredDatabaseExtensions()
        }))
    ]);

    const generated: SchemaCommitFile[] = [
        { path: paths.schemaFile, contents: schema },
        { path: paths.ddlFile, contents: ddl },
        { path: paths.policiesFile, contents: policies },
        { path: paths.searchFile, contents: search },
        { path: paths.vectorFile, contents: vector }
    ];

    // Both sides planned once, here, rather than through `additiveStatements` —
    // which would plan `after` a second time for the withheld constraints. The
    // planner is pure, so a second call is only wasted work rather than a
    // correctness problem, but this runs on every `/plan` keystroke in the panel.
    const previous = planCollectionSchemaEnsure(input.before, existing, options);
    const next = planCollectionSchemaEnsure(input.after, existing, options);
    const already = new Set(previous.statements);

    return {
        files: [...(input.sourceFiles ?? []), ...generated],
        statements: next.statements.filter(statement => !already.has(statement)),
        classified,
        message: commitMessage(classified),
        // From the `after` plan alone rather than differenced against `before`:
        // a constraint that was already unenforceable is still something the
        // person confirming this change should see named.
        withheldConstraints: next.withheldConstraints
    };
}
