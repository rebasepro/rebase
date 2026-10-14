/**
 * The line `rebase schema generate` ends on.
 *
 * It recommended `rebase db generate` unconditionally — a command the CLI
 * refuses outright on the managed development database, because Atlas plans by
 * diffing against a second empty database and PGlite serves exactly one. So
 * every stock scaffold was told, by the tool itself, to run something the same
 * tool would refuse two seconds later.
 */
import { nextStepAfterDbGenerate, nextStepAfterGenerate } from "../src/schema/generate-next-step";

const KIND = "REBASE_DEV_DATABASE_KIND";

describe("the next step after generating a schema", () => {
    const original = process.env[KIND];

    afterEach(() => {
        if (original === undefined) delete process.env[KIND];
        else process.env[KIND] = original;
    });

    it("does not recommend a command the managed database refuses", () => {
        process.env[KIND] = "managed";

        const line = nextStepAfterGenerate();
        expect(line).not.toContain("rebase db generate");
        expect(line).toContain("rebase dev");
        expect(line).toContain("managed development database");
    });

    it("keeps the migration workflow for a database that has one", () => {
        for (const kind of ["external", "docker"]) {
            process.env[KIND] = kind;
            expect(nextStepAfterGenerate()).toContain("rebase db generate");
        }
    });

    it("keeps the original wording when nothing says which database this is", () => {
        // The driver run directly, outside the CLI. It cannot decide for itself:
        // on the managed path DATABASE_URL is an ordinary connection string to a
        // Postgres on loopback.
        delete process.env[KIND];
        expect(nextStepAfterGenerate()).toContain("rebase db generate");
    });
});

/**
 * The lines `rebase db generate` ends on.
 *
 * "You can now run rebase db migrate" was the whole of it. On a database that
 * has booted, the first migration creates tables boot already made, so that
 * `db migrate` stops on `already exists` — every time, on the managed database
 * and on a server of your own. The way through is `--baseline`, which only
 * `db migrate --help` and the failure itself named.
 */
describe("the next step after generating a migration", () => {
    it("names db migrate, and the --baseline a booted database needs the first time, with the version", () => {
        const text = nextStepAfterDbGenerate("20261014000000").join("\n");
        expect(text).toContain("rebase db migrate");
        expect(text).toContain("booted");
        expect(text).toContain("rebase db migrate --baseline 20261014000000");
    });

    it("still prints a typeable shape when there is no migration on disk", () => {
        expect(nextStepAfterDbGenerate(null).join("\n")).toContain("rebase db migrate --baseline <version>");
    });
});
