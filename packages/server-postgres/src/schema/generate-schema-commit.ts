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
import type { CollectionConfig } from "@rebasepro/types";
import {
    generatePostgresDdl,
    generatePostgresPoliciesDdl,
    generatePostgresSearchDdl
} from "./generate-postgres-ddl-logic";
import { generateSchema } from "./generate-drizzle-schema-logic";
import { planCollectionSchemaEnsure } from "./ensure-collection-tables";
import { classifyCollectionChanges, type ClassifiedChanges } from "./classify-change";

/** Where each generated artifact lives in a scaffolded project. */
export interface SchemaCommitPaths {
    /** Drizzle schema, imported by the backend. */
    schemaFile: string;
    /** Declarative DDL, what `db push` applies and Atlas diffs against. */
    ddlFile: string;
    policiesFile: string;
    searchFile: string;
}

export const DEFAULT_COMMIT_PATHS: SchemaCommitPaths = {
    schemaFile: "backend/src/schema.generated.ts",
    ddlFile: "drizzle/schema.sql",
    policiesFile: "drizzle/policies.sql",
    searchFile: "drizzle/search.sql"
};

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
 * Both sides are planned against an empty database and the difference is taken
 * by exact statement text. That works because the planner is deterministic: the
 * same collections in the same order produce the same strings, so anything
 * present in the second plan and absent from the first is what the change adds.
 */
export function additiveStatements(before: CollectionConfig[], after: CollectionConfig[]): string[] {
    const previous = new Set(planCollectionSchemaEnsure(before, nothing()).statements);
    return planCollectionSchemaEnsure(after, nothing()).statements
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
    const classified = classifyCollectionChanges(input.before, input.after);

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

    const [schema, ddl, policies, search] = await Promise.all([
        generateSchema(input.after),
        generatePostgresDdl(input.after),
        Promise.resolve(generatePostgresPoliciesDdl(input.after)),
        Promise.resolve(generatePostgresSearchDdl(input.after))
    ]);

    const generated: SchemaCommitFile[] = [
        { path: paths.schemaFile, contents: schema },
        { path: paths.ddlFile, contents: ddl },
        { path: paths.policiesFile, contents: policies },
        { path: paths.searchFile, contents: search }
    ];

    return {
        files: [...(input.sourceFiles ?? []), ...generated],
        statements: additiveStatements(input.before, input.after),
        classified,
        message: commitMessage(classified)
    };
}
