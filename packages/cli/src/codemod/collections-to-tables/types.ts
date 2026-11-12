/**
 * The vocabulary of the collections-to-tables codemod: what it was asked to
 * do, and what it reports back. The report is the machine-readable answer
 * (`--json`) and the source of the human one.
 */

/** Where a construct the codemod looked at lives in the legacy source. */
export interface SourceLocation {
    /** The file, relative to the project root. */
    file: string;
    /** 1-based line, when the construct has one. */
    line?: number;
}

/**
 * Something the codemod could not convert without guessing. Any refusal
 * blocks the write: nothing is written, and each one names what to change.
 */
export interface Refusal extends SourceLocation {
    /** The collection's slug, when the refusal is about one collection. */
    collection?: string;
    /** The property or field it is about. */
    key?: string;
    /** Why, and what to write instead. */
    reason: string;
}

/**
 * A step the codemod leaves to the user, with the exact text to apply. A
 * manual step does not block the write: the migrated project fails loudly
 * (a type error, a refusal at boot) until the step is done.
 */
export interface ManualStep {
    /** A short title: "Mount the table customizations". */
    title: string;
    /** What to do, in full. */
    detail: string;
    /** Code to paste, when there is some. */
    snippet?: string;
    /** The file it is about, relative to the project root. */
    file?: string;
}

/**
 * A fact worth reading that needs no action: a carried construct, a
 * post-declaration assignment that evaluation resolved, a dropped default.
 */
export interface Note extends SourceLocation {
    collection?: string;
    message: string;
}

/** One file the codemod writes, as planned. */
export interface PlannedFile {
    /** Relative to the project root, `/`-separated. */
    path: string;
    /** The full content. */
    content: string;
    /** `create` for a new file, `update` when it replaces one, `unchanged` when the file already holds exactly this. */
    action: "create" | "update" | "unchanged";
    /** Why it is written: "table posts", "customization posts", "rebase.json"… */
    role: string;
}

/** What one legacy collection became. */
export interface CollectionOutcome {
    slug: string;
    /** The collection file, relative to the project root. */
    file: string;
    /** `table`, `auth-table`, `view`, `firestore`, or `refused`. */
    kind: "table" | "auth-table" | "view" | "firestore" | "refused";
    /** The backend module written for it. */
    backendFile?: string;
    /** The `customizeTable` / `defineFirestoreCollection` module written for it, when its presentation was not the default. */
    frontendFile?: string;
}

/** The outcome of the SQL-identity check. */
export interface VerificationResult {
    /** Whether every rendered output was byte-identical. */
    identical: boolean;
    /** How many outputs were compared. */
    compared: number;
    /** The outputs that differ, each with a unified diff. */
    differences: { output: string; diff: string }[];
    /** Set when the check could not run at all. */
    error?: string;
}

/** The whole report. */
export interface MigrationReport {
    /** The project root, absolute. */
    projectRoot: string;
    /** `migrated` (written and verified), `planned` (dry run), `checked` (`--check`), `already-migrated`, `blocked` (refusals), `failed` (verification). */
    status: "migrated" | "planned" | "checked" | "already-migrated" | "blocked" | "failed";
    collections: CollectionOutcome[];
    files: PlannedFile[];
    refusals: Refusal[];
    notes: Note[];
    manualSteps: ManualStep[];
    verification?: VerificationResult;
    /** The `git rm -r` line to run once verification passed: deleting the legacy files is the user's step. */
    removeCommand?: string;
}

/** The modes of one run. */
export interface MigrateOptions {
    /** The project root: the directory holding `rebase.json` and `config/`. */
    projectRoot: string;
    /** Plan and print; write nothing. */
    dryRun?: boolean;
    /** Verify an already migrated tree against the legacy collections; write nothing. */
    check?: boolean;
    /** Run on a dirty (or absent) git tree, and replace files that differ from what the codemod writes. */
    force?: boolean;
    /**
     * Module specifiers mapped to files for evaluating the project's modules
     * (`@rebasepro/types` → its source). Tests and the in-repo corpora use it;
     * a user's project resolves through its own `node_modules`.
     */
    moduleAliases?: Record<string, string>;
}
