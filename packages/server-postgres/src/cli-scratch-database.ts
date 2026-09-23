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
 * Two cases keep it. A command that fails leaves it as the state Atlas was
 * planning against, which is the one thing worth inspecting. And one this
 * process did not create — made by hand, the remedy for a role without
 * `CREATEDB` — is the user's, and dropping it would put them back at the same
 * refusal next time.
 */
export interface ScratchDatabaseOps {
    /** Create it if it is missing; `true` only when this call created it. */
    create(databaseUrl: string, devDatabaseUrl: string): Promise<boolean>;
    drop(databaseUrl: string, devDatabaseUrl: string): Promise<void>;
}

export class ScratchDatabase {
    private created: { databaseUrl: string; devDatabaseUrl: string } | undefined;

    constructor(private readonly ops: ScratchDatabaseOps) {}

    /** Make sure it exists before an Atlas call that plans against it. */
    async ensure(databaseUrl: string, devDatabaseUrl: string): Promise<void> {
        if (await this.ops.create(databaseUrl, devDatabaseUrl)) {
            this.created = { databaseUrl, devDatabaseUrl };
        }
    }

    /**
     * Run a command, then drop the scratch database if the command created it.
     * A command that throws skips the drop; one that exits the process never
     * returns here, which is the same thing.
     */
    async around<T>(command: () => Promise<T>): Promise<T> {
        const result = await command();
        const created = this.created;
        if (created) {
            this.created = undefined;
            await this.ops.drop(created.databaseUrl, created.devDatabaseUrl);
        }
        return result;
    }
}
