/**
 * The Atlas scratch database is made only when Atlas needs it, and removed
 * after every db command that made it and succeeded.
 *
 * `<db>_dev_diff` is a full copy of the schema that `CREATE DATABASE` makes
 * beside the real one. Only a successful, applied `db push` dropped it:
 * `db push --dry-run` — described as "nothing was applied" — returned before
 * that line, `db generate` never reached one, and `db migrate` created it for
 * an Atlas call that never uses it. Each left a database on the server, which
 * on a provider that bills per database is a silent cost. A failed command
 * still keeps it: there it holds the state Atlas was planning against.
 */
import { buildAtlasArgs, takesDevUrl } from "../src/schema/atlas-argv";
import { ScratchDatabase } from "../src/cli-scratch-database";

const URL = "postgres://u:p@localhost:5432/app";
const DEV_URL = "postgres://u:p@localhost:5432/app_dev_diff";

function scratch(createsIt: boolean) {
    const create = jest.fn(async () => createsIt);
    const drop = jest.fn(async () => {});
    return { create, drop, database: new ScratchDatabase({ create, drop }) };
}

describe("the scratch database around a db command", () => {
    it("is dropped after a command that created it succeeds", async () => {
        const { database, drop } = scratch(true);

        await database.around(async () => {
            await database.ensure(URL, DEV_URL);
        });

        expect(drop).toHaveBeenCalledWith(URL, DEV_URL);
    });

    it("is dropped after a dry run, which returns early and applies nothing", async () => {
        const { database, drop } = scratch(true);
        const dryRun = async (): Promise<void> => {
            await database.ensure(URL, DEV_URL);
            return;
        };

        await database.around(dryRun);

        expect(drop).toHaveBeenCalledTimes(1);
    });

    it("is kept after a command that fails, as the evidence", async () => {
        const { database, drop } = scratch(true);

        await expect(database.around(async () => {
            await database.ensure(URL, DEV_URL);
            throw new Error("atlas exited 1");
        })).rejects.toThrow("atlas exited 1");

        expect(drop).not.toHaveBeenCalled();
    });

    it("is left alone when it was already there — somebody made it by hand", async () => {
        const { database, drop } = scratch(false);

        await database.around(async () => {
            await database.ensure(URL, DEV_URL);
        });

        expect(drop).not.toHaveBeenCalled();
    });

    it("is created once however many Atlas calls need it", async () => {
        const { database, create, drop } = scratch(true);

        await database.around(async () => {
            await database.ensure(URL, DEV_URL);
            await database.ensure(URL, DEV_URL);
        });

        expect(create).toHaveBeenCalledTimes(2);
        expect(drop).toHaveBeenCalledTimes(1);
    });
});

describe("which Atlas calls need the scratch database", () => {
    const invocations: [string, string[]][] = [
        ["schema", ["apply", "--to", "file://drizzle/schema.sql", "--dry-run"]],
        ["schema", ["apply", "--to", "file://drizzle/schema.sql", "--auto-approve"]],
        ["migrate", ["diff", "migration", "--dir", "file://drizzle/migrations", "--to", "file://drizzle/schema.sql"]],
        ["migrate", ["apply", "--dir", "file://drizzle/migrations"]],
        ["migrate", ["hash", "--dir", "file://drizzle/migrations"]],
        ["migrate", ["status", "--dir", "file://drizzle/migrations"]],
        ["schema", ["inspect"]]
    ];

    it.each(invocations)("%s %j agrees with the argv it is given", (domain, args) => {
        const argv = buildAtlasArgs({ domain, args, url: URL, devUrl: DEV_URL });
        expect(takesDevUrl(domain, args)).toBe(argv.includes("--dev-url"));
    });

    it("is not needed by `migrate apply`, which `db migrate` runs", () => {
        expect(takesDevUrl("migrate", ["apply", "--dir", "file://drizzle/migrations"])).toBe(false);
    });
});
