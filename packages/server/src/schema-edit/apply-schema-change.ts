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
    /**
     * The current contents of one file, or `undefined` when it does not exist.
     *
     * Needed by a deployment whose source is not on the machine. The AST editor
     * rewrites a collection *file*, so a bundle — which ships compiled output —
     * has nothing for it to open; the file has to come from the repository
     * first. A missing file is not an error: a new collection has no source yet,
     * and the editor creates one.
     *
     * Also what {@link restore} is snapshotted from. The local working tree
     * implements it for that reason alone: the editor reads its files from
     * disk directly.
     */
    readFile?(path: string): Promise<string | undefined>;
    /**
     * Put these files back exactly as they were — `undefined` contents meaning
     * the file did not exist — and unstage them.
     *
     * Called when the commit is refused after the change was written: a
     * pre-commit hook, a missing git identity, a held `index.lock`. Without it
     * the refusal left the source and the generated schema rewritten and
     * staged — the panel reported failure while the source had changed — and
     * every retry met those leftovers as somebody else's work in progress.
     *
     * Optional: a repository that writes nothing locally (the GitHub one
     * stages in memory) has nothing to put back. Needs {@link readFile} to take
     * the snapshot it restores.
     */
    restore?(files: { path: string; contents: string | undefined }[]): Promise<void>;
}

/**
 * The commit was refused after the change had been written, and the tree was
 * put back. Nothing changed: not the source, not the database.
 */
export class CommitRefusedError extends Error {
    constructor(detail: string, readonly restored: boolean) {
        super(
            `Nothing was changed — the commit was refused: ${detail}` +
            (restored
                ? "\n  The collection source and the generated schema were put back as they were."
                : "\n  The files written for this change could not be put back; check `git status` before retrying.")
        );
        this.name = "CommitRefusedError";
    }
}

/**
 * Runs the DDL. Separate from the repository so neither knows about the other.
 *
 * Throws {@link StatementFailedError} when it can say how far it got.
 */
export type SchemaEditApply = (statements: string[]) => Promise<void>;

/**
 * Statement `appliedCount + 1` failed, after `appliedCount` statements had run.
 *
 * The statements run one at a time with no transaction around them —
 * `CREATE INDEX CONCURRENTLY` may not run inside one — so the ones before the
 * failure have already changed the database. A receipt that said "the database
 * was not changed" after an `ADD COLUMN` had landed and the `FOREIGN KEY` that
 * followed it had timed out described the state before the change.
 */
export class StatementFailedError extends Error {
    constructor(readonly appliedCount: number, readonly statement: string, cause: unknown) {
        super(cause instanceof Error ? cause.message : String(cause));
        this.name = "StatementFailedError";
    }
}

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
    /**
     * Rewrite the collection source, returning the files it touched.
     *
     * Called from **inside** this module, after the dirty-tree check and before
     * the commit. It has to be: the AST editor writes through the filesystem
     * rather than through {@link SchemaEditRepository}, so a caller that wrote
     * first and handed the files over would already have made the tree dirty,
     * and the check below would refuse the change on the evidence of its own
     * edit.
     *
     * That is not hypothetical — it is what `/apply` did. Every change was
     * refused with a dirty tree, because `git status --porcelain` reports
     * untracked files too and a new collection's source file is always
     * untracked. The rewritten file was left behind either way, so the retry
     * found a dirty tree as well and the surface could never succeed.
     *
     * Optional: a caller holding the contents already, with no disk to write
     * them through, puts them on `plan.files` and omits this.
     */
    writeSource?: () => Promise<SchemaChangeFile[]>;
    /**
     * The paths {@link writeSource} is going to touch.
     *
     * Needed *before* it runs so they can join the dirty check — the point of
     * which is to read the tree before this change has touched it. The caller
     * can derive them (`<collectionsDir>/<id>.ts`) without writing anything.
     */
    sourcePaths?: string[];
    /**
     * "Edit source only": commit the source and the generated schema for a
     * change the database cannot take, and run nothing. The plan is committed
     * whatever its verdict; the caller has checked that every refused change
     * says what it leaves behind.
     */
    sourceOnly?: boolean;
}

export interface SchemaEditResult {
    committed: {
        sha: string;
        branch: string;
        files: string[];
    };
    /** True when the DDL ran. False means committed and pending a boot. */
    applied: boolean;
    /** Committed as "Edit source only": nothing was meant to run. */
    sourceOnly?: boolean;
    /** Why the apply did not run, when it did not. Never a reason to fail. */
    applyError?: string;
    /**
     * How many statements ran before the one that failed, when the applier
     * could say. Equal to `statements.length` when everything ran; `undefined`
     * when the apply failed without saying how far it got.
     */
    appliedStatements?: number;
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

    if (!commit.classified.applicable && !input.sourceOnly) {
        const blocking = commit.classified.changes.filter(change => change.verdict !== "safe");
        throw new UnapplicableChangeError(
            "This change cannot be applied to a running database:\n" +
            blocking.map(change =>
                `  • ${change.detail}${change.remedy ? `\n    ${change.remedy}` : ""}`
            ).join("\n"),
            commit.classified
        );
    }

    // Every path this change will touch, including the ones `writeSource` is
    // about to create. Assembled before it runs, because the check below is
    // about what somebody *else* left in the tree.
    const plannedPaths = [
        ...commit.files.map(file => file.path),
        ...(input.sourcePaths ?? [])
    ];

    // Checked before anything is written, so a refusal leaves the tree exactly
    // as it was found — and so this cannot refuse on the evidence of its own
    // edit, which is what happened when the source was written first.
    const dirty = (await input.repository.dirtyPaths()).filter(path => plannedPaths.includes(path));
    if (dirty.length > 0) throw new DirtyWorkingTreeError(dirty);

    const branch = await input.repository.currentBranch();

    // What every planned path holds now, so a refused commit can put it back.
    // Taken after the dirty check: the tree is clean for these paths, so this
    // is also what HEAD holds.
    const { repository } = input;
    const snapshot = repository.readFile && repository.restore
        ? await Promise.all(plannedPaths.map(async path => ({ path, contents: await repository.readFile!(path) })))
        : undefined;

    let files: SchemaChangeFile[] = [];
    let sha: string;
    let committing = false;
    try {
        // Now the tree may be touched. The AST editor writes through the
        // filesystem, so this is the first moment at which doing so is safe.
        const written = input.writeSource ? await input.writeSource() : [];
        files = [...written, ...commit.files];
        committing = true;
        await repository.writeFiles(files);
        sha = await repository.commit(files.map(file => file.path), commit.message);
    } catch (err) {
        if (!snapshot) throw err;
        if (!committing) {
            // The source editor refused — it says why, and its message is
            // the useful one. Whatever it managed to write still goes back.
            await repository.restore!(snapshot).catch(() => undefined);
            throw err;
        }
        const detail = err instanceof Error ? err.message : String(err);
        // A path written that was not planned has no snapshot to restore
        // from, so it cannot be put back — say so rather than claim a clean
        // tree.
        const unplanned = files.map(file => file.path).filter(path => !plannedPaths.includes(path));
        let restored = unplanned.length === 0;
        try {
            await repository.restore!(snapshot);
        } catch {
            restored = false;
        }
        throw new CommitRefusedError(detail, restored);
    }
    const paths = files.map(file => file.path);

    const committed = { sha, branch, files: paths };

    if (input.sourceOnly) {
        const kept = commit.classified.changes.map(change => change.kept).filter(Boolean).join("; ");
        return {
            committed,
            applied: false,
            sourceOnly: true,
            appliedStatements: 0,
            statements: [],
            classified: commit.classified,
            summary:
                `Committed ${sha.slice(0, 9)} on ${branch} — source only. Nothing ran against the database` +
                (kept ? `: ${kept}.` : ".")
        };
    }

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
            appliedStatements: commit.statements.length,
            statements: commit.statements,
            classified: commit.classified,
            summary:
                `Committed ${sha.slice(0, 9)} on ${branch} and applied ` +
                `${commit.statements.length} statement(s).`
        };
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        const appliedStatements = err instanceof StatementFailedError ? err.appliedCount : undefined;
        const total = commit.statements.length;
        const head = `Committed ${sha.slice(0, 9)} on ${branch}`;
        // Worded from how far it got. Only "none of them ran" is "not changed".
        const summary = appliedStatements === 0
            ? `${head}, but the database was not changed: ${detail}. The change will be applied on the next boot.`
            : appliedStatements !== undefined
                ? `${head} and applied ${appliedStatements} of ${total} statement(s); the next one failed: ` +
                  `${detail}. The rest will be applied on the next boot.`
                : `${head}, but applying it failed: ${detail}. Some of its ${total} statement(s) may have run; ` +
                  "the rest will be applied on the next boot.";
        // Not a throw. The commit is the durable half and it landed; the
        // database is now behind the repository, which is the state every
        // project is in between an edit and a deploy, and which boot fixes.
        return {
            committed,
            applied: false,
            applyError: detail,
            appliedStatements,
            statements: commit.statements,
            classified: commit.classified,
            summary
        };
    }
}
