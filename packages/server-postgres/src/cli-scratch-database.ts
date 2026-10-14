/**
 * The scratch database Atlas plans against, for the length of one db command.
 *
 * `atlas schema apply` and `atlas migrate diff` need a `--dev-url`: an empty
 * database they build the desired state in, made as `<db>_dev_diff` beside the
 * real one. It is a full copy of the schema, so it is removed again once the
 * command that made it has succeeded — every such command, not only an applied
 * `db push`: a `--dry-run` that left one behind while saying nothing was
 * applied, and `db generate`, left one per target on the server.
 *
 * It is dropped on every way out of the command: success, a destructive push
 * the user declined or that had no terminal to ask, and a crash. A crash that
 * kept it left it for good, because the next push finds it already there and
 * takes it for one made by hand.
 *
 * Two cases keep it. An Atlas run that failed while planning against it leaves
 * the state Atlas was planning, which is the one thing worth inspecting. And
 * one this process did not create (made by hand, the remedy for a role without
 * `CREATEDB`) is the user's, and dropping it would put them back at the same
 * refusal next time. An Atlas run that failed before planning (see
 * {@link atlasFailedBeforePlanning}) left nothing in it, and it is dropped.
 */
export interface ScratchDatabaseOps {
    /** Create it if it is missing; `true` only when this call created it. */
    create(databaseUrl: string, devDatabaseUrl: string): Promise<boolean>;
    drop(databaseUrl: string, devDatabaseUrl: string): Promise<void>;
}

export class ScratchDatabase {
    private created: { databaseUrl: string; devDatabaseUrl: string } | undefined;
    private keptAsEvidence = false;

    constructor(private readonly ops: ScratchDatabaseOps) {}

    /** Make sure it exists before an Atlas call that plans against it. */
    async ensure(databaseUrl: string, devDatabaseUrl: string): Promise<void> {
        if (await this.ops.create(databaseUrl, devDatabaseUrl)) {
            this.created = { databaseUrl, devDatabaseUrl };
        }
    }

    /** An Atlas run against it failed: keep it, whatever the command does next. */
    keepAsEvidence(): void {
        this.keptAsEvidence = true;
    }

    /**
     * An Atlas run failed with `stderr`. Failing before it planned, it left
     * nothing here to read, so the database is dropped now — before the
     * command exits, which may not unwind through {@link around}. Otherwise
     * it is kept as the evidence.
     */
    async afterAtlasFailure(stderr: string): Promise<void> {
        if (atlasFailedBeforePlanning(stderr)) await this.release();
        else this.keepAsEvidence();
    }

    /**
     * Run a command, then drop the scratch database if the command created it,
     * whether the command returned or threw. A throw after
     * {@link keepAsEvidence} keeps it. A command that wants to stop with exit 1
     * throws {@link CommandStopped} rather than calling `process.exit`, which
     * would skip this.
     */
    async around<T>(command: () => Promise<T>): Promise<T> {
        let result: T;
        try {
            result = await command();
        } catch (err) {
            if (!this.keptAsEvidence) await this.release();
            throw err;
        }
        await this.release();
        return result;
    }

    /** Drop it now if this process created it. Safe to call twice. */
    async release(): Promise<void> {
        const created = this.created;
        if (!created) return;
        this.created = undefined;
        await this.ops.drop(created.databaseUrl, created.devDatabaseUrl);
    }
}

/**
 * Whether Atlas failed before it planned anything: on connecting, which it
 * reports as `querying system variables: …` — SSL the server does not offer, a
 * login refused, a socket that closed or never opened.
 */
export function atlasFailedBeforePlanning(stderr: string): boolean {
    return /querying system variables:/.test(stderr);
}

/**
 * A db command stopping with exit 1 after it has said why: a destructive push
 * the user declined, or one with no terminal to ask on.
 *
 * Thrown instead of `process.exit(1)`, so it unwinds through
 * {@link ScratchDatabase.around} and the scratch database is dropped on the way
 * out. `alreadyReported` tells `reportCommandFailure` the explanation is on the
 * terminal already; the entry point sets the exit code.
 */
export class CommandStopped extends Error {
    readonly alreadyReported = true;

    constructor(reason: string) {
        super(reason);
        this.name = "CommandStopped";
    }
}
