/**
 * Commit the schema change, then apply it.
 *
 * The order is the load-bearing part of this module and the reason it exists as
 * a unit rather than as two calls a caller makes in whichever order.
 *
 * The two failure directions are not symmetric:
 *
 * - **Apply first, commit fails.** The database has a column the repository does
 *   not describe. The ensure path is strictly additive — it never drops
 *   anything — so the next deploy neither removes the column nor mentions it. It
 *   sits there, absent from the collections and invisible to the API, until
 *   somebody goes looking. Nothing in the system detects this state.
 * - **Commit first, apply fails.** The repository describes a column the
 *   database does not have. That is the ordinary state of every project between
 *   an edit and a deploy, and boot's ensure reconciles it on the next start.
 *
 * So: commit, then apply. The bad half of the dual write lands in the direction
 * the system already handles, and a failed apply is reported as a *state* rather
 * than thrown as an error — because "committed, will apply on next boot" is not
 * a failure, it is a slower success.
 *
 * ## Both dependencies are injected
 *
 * `git` and `apply` are interfaces, not imports. That keeps this testable
 * without a repository or a database — which matters, because the thing worth
 * testing here is the ordering and what happens when half of it fails, and both
 * are impossible to exercise against real infrastructure on demand.
 */
import type {
    SchemaChangeFile,
    SchemaChangePlan,
    ClassifiedSchemaChanges
} from "@rebasepro/types";

/** The working tree the commit lands in. */
export interface SchemaEditRepository {
    /** Absolute path, for reporting. */
    root: string;
    /** The branch the commit will land on. */
    currentBranch(): Promise<string>;
    /**
     * Paths that are already modified and not ours.
     *
     * A commit that sweeps up somebody's half-finished work is worse than a
     * refusal, and this is the one thing a schema editor cannot see coming.
     */
    dirtyPaths(): Promise<string[]>;
    /** Write every file, creating directories as needed. */
    writeFiles(files: SchemaChangeFile[]): Promise<void>;
    /** Stage exactly these paths and commit them. Returns the new sha. */
    commit(paths: string[], message: string): Promise<string>;
}

/** Runs the DDL. Separate from the repository so neither knows about the other. */
export type SchemaEditApply = (statements: string[]) => Promise<void>;

export interface SchemaEditInput {
    /**
     * What to write and run, from `admin.planSchemaChange`.
     *
     * Taken as a plan rather than as collections because planning is
     * engine-specific and this module is not: it commits files and runs
     * statements, and does not care which database rendered them.
     */
    plan: SchemaChangePlan;
    repository: SchemaEditRepository;
    apply: SchemaEditApply;
}

export interface SchemaEditResult {
    committed: {
        sha: string;
        branch: string;
        files: string[];
    };
    /** True when the DDL ran. False means committed and pending a boot. */
    applied: boolean;
    /** Why the apply did not run, when it did not. Never a reason to fail. */
    applyError?: string;
    statements: string[];
    classified: ClassifiedSchemaChanges;
    /** What to tell the person who pressed the button. */
    summary: string;
}

/**
 * The plan says the change is not applicable.
 *
 * Re-checked here rather than trusted from the planner: this module is the one
 * that writes and runs things, so the guarantee belongs where the consequence
 * is. A caller that built a plan by hand cannot route around it.
 */
export class UnapplicableChangeError extends Error {
    constructor(message: string, readonly classified: ClassifiedSchemaChanges) {
        super(message);
        this.name = "UnapplicableChangeError";
    }
}

export class DirtyWorkingTreeError extends Error {
    constructor(readonly paths: string[]) {
        super(
            "The working tree has uncommitted changes to files this would commit:\n" +
            paths.map(p => `  • ${p}`).join("\n") +
            "\n  Commit or stash them first. A schema change must not sweep up work in progress."
        );
        this.name = "DirtyWorkingTreeError";
    }
}

/**
 * Generate the commit, land it, then run the DDL.
 *
 * Throws only for things that mean *nothing happened*: a change the ensure path
 * cannot express, a dirty tree, or a failed commit. Once the commit lands,
 * every outcome is a result.
 */
export async function applySchemaChange(input: SchemaEditInput): Promise<SchemaEditResult> {
    const commit = input.plan;

    if (!commit.classified.applicable) {
        const blocking = commit.classified.changes.filter(change => change.verdict !== "safe");
        throw new UnapplicableChangeError(
            "This change cannot be applied to a running database:\n" +
            blocking.map(change =>
                `  • ${change.detail}${change.remedy ? `\n    ${change.remedy}` : ""}`
            ).join("\n"),
            commit.classified
        );
    }

    const paths = commit.files.map(file => file.path);

    // Checked before anything is written, so a refusal leaves the tree exactly
    // as it was found.
    const dirty = (await input.repository.dirtyPaths()).filter(path => paths.includes(path));
    if (dirty.length > 0) throw new DirtyWorkingTreeError(dirty);

    const branch = await input.repository.currentBranch();
    await input.repository.writeFiles(commit.files);
    const sha = await input.repository.commit(paths, commit.message);

    const committed = { sha, branch, files: paths };

    if (commit.statements.length === 0) {
        return {
            committed,
            applied: true,
            statements: [],
            classified: commit.classified,
            summary: `Committed ${sha.slice(0, 9)} on ${branch}. No DDL was needed.`
        };
    }

    try {
        await input.apply(commit.statements);
        return {
            committed,
            applied: true,
            statements: commit.statements,
            classified: commit.classified,
            summary:
                `Committed ${sha.slice(0, 9)} on ${branch} and applied ` +
                `${commit.statements.length} statement(s).`
        };
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        // Not a throw. The commit is the durable half and it landed; the
        // database is now behind the repository, which is the state every
        // project is in between an edit and a deploy, and which boot fixes.
        return {
            committed,
            applied: false,
            applyError: detail,
            statements: commit.statements,
            classified: commit.classified,
            summary:
                `Committed ${sha.slice(0, 9)} on ${branch}, but the database was not changed: ` +
                `${detail}. The change will be applied on the next boot.`
        };
    }
}
