/**
 * `rebase db` argument handling.
 *
 * The plugin CLI runs with `cwd: backendDir` — it must, because that is where
 * the plugin and its dependencies resolve from — while the developer types the
 * command at the project root. Every local path on the command line therefore
 * has to be resolved before the child is handed a different working directory.
 */
import { describe, it, expect, vi } from "vitest";
import path from "path";
import {
    absolutizeLocalPathArgs,
    databaseUrlOf,
    dbExamples,
    ManagedDatabaseRefusal,
    refuseAtlasOnManagedDatabase,
    refuseBranchOnManagedDatabase
} from "./db.js";

const ROOT = path.resolve("/projects/my-app");

/**
 * Every spelling the driver's backup spec accepts — `backup-cli.ts` aliases
 * `--output` and `-o` onto `--out`, and `rebase db backup --help` advertises
 * `--output`. The suite used to cover two of the three, and the uncovered one
 * was the one that was broken: `--output ./backups` reached the driver
 * unresolved and wrote under `backend/`.
 */
const DESTINATION_FLAGS = ["--out", "--output", "-o"];

describe("absolutizeLocalPathArgs", () => {
    it.each(DESTINATION_FLAGS)(
        "resolves a relative %s against the directory the user is standing in",
        flag => {
            /*
             * The reported bug: `rebase db backup --out ./backups` from the
             * project root wrote to `backend/backups` while the success line
             * echoed the path as typed, so the file existed and the location
             * printed was wrong. That exact invocation is in `rebase db
             * --help`'s own examples.
             */
            const out = absolutizeLocalPathArgs(["db", "backup", flag, "./backups"], ROOT);
            expect(out).toEqual(["db", "backup", flag, path.join(ROOT, "backups")]);
        }
    );

    it.each(DESTINATION_FLAGS)("handles the %s=<value> spelling", flag => {
        const out = absolutizeLocalPathArgs(["db", "backup", `${flag}=./backups`], ROOT);
        expect(out).toEqual(["db", "backup", `${flag}=${path.join(ROOT, "backups")}`]);
    });

    it.each(DESTINATION_FLAGS)("leaves an already-absolute %s path alone", flag => {
        const abs = path.resolve("/var/backups");
        expect(absolutizeLocalPathArgs(["db", "backup", flag, abs], ROOT))
            .toEqual(["db", "backup", flag, abs]);
    });

    it.each(DESTINATION_FLAGS)("never touches a remote %s destination", flag => {
        /*
         * The whole point of the fix is joining paths onto a cwd, and an
         * `s3://bucket/prefix` joined onto anything stops being a URL. Matched
         * as "scheme://" in general rather than a list of known schemes, so a
         * destination this build does not support yet still survives intact.
         */
        for (const url of ["s3://bucket/prefix", "gs://bucket/prefix", "https://example.com/x"]) {
            expect(absolutizeLocalPathArgs(["db", "backup", flag, url], ROOT))
                .toEqual(["db", "backup", flag, url]);
        }
    });

    it.each(DESTINATION_FLAGS)("does not mistake the next flag for the value of %s", flag => {
        const out = absolutizeLocalPathArgs(["db", "backup", flag, "--no-owner"], ROOT);
        expect(out).toEqual(["db", "backup", flag, "--no-owner"]);
    });

    it.each(DESTINATION_FLAGS)("does not treat %s's value as the restore positional", flag => {
        const out = absolutizeLocalPathArgs(
            ["db", "restore", flag, "./copy", "./backups/x.dump"],
            ROOT
        );
        expect(out).toEqual([
            "db", "restore", flag, path.join(ROOT, "copy"), path.join(ROOT, "backups/x.dump")
        ]);
    });

    it("resolves the dump file `db restore` reads", () => {
        // Otherwise the path printed by `db backup` could not be pasted into
        // `db restore` — the two commands would disagree about where it is.
        const out = absolutizeLocalPathArgs(
            ["db", "restore", "./backups/x.dump", "--create-db", "--target-db", "app_restored"],
            ROOT
        );
        expect(out).toEqual([
            "db", "restore", path.join(ROOT, "backups/x.dump"),
            "--create-db", "--target-db", "app_restored"
        ]);
    });

    it("does not treat a flag's value as the restore positional", () => {
        // `--target-db app_restored` must not have `app_restored` turned into a
        // path just because it is the first non-dash token after `restore`.
        const out = absolutizeLocalPathArgs(
            ["db", "restore", "--target-db", "app_restored", "./backups/x.dump"],
            ROOT
        );
        expect(out).toContain("app_restored");
        expect(out).toContain(path.join(ROOT, "backups/x.dump"));
    });

    it("leaves commands that carry no path untouched", () => {
        const args = ["db", "push", "--allow-destructive"];
        expect(absolutizeLocalPathArgs(args, ROOT)).toEqual(args);
    });

    it("does not mutate the array it was given", () => {
        const args = ["db", "backup", "--out", "./backups"];
        const copy = [...args];
        absolutizeLocalPathArgs(args, ROOT);
        expect(args).toEqual(copy);
    });
});

describe("refuseAtlasOnManagedDatabase", () => {
    /**
     * PGlite serves one database; Atlas needs a second empty one to diff
     * against. `CREATE DATABASE` against PGlite reports success and creates
     * nothing, so Atlas compares the project's database with itself and stops
     * on "connected database is not clean" — verified on a fresh scaffold, so
     * no reset fixes it.
     *
     * The guard has to fire BEFORE the driver runs, because the first error the
     * reader used to hit told them to edit a DATABASE_URL that `rebase init`
     * deliberately leaves unset.
     */
    const call = (args: string[], kind: string) => {
        const exit = vi.spyOn(process, "exit").mockImplementation((() => {
            throw new Error("the guard must not exit the process");
        }) as never);
        try {
            refuseAtlasOnManagedDatabase(args, kind);
        } catch (error) {
            // The type is the assertion: an exit here would be the bug this
            // guard caused in `rebase dev`, which runs `db push` in-process.
            expect(error).toBeInstanceOf(ManagedDatabaseRefusal);
            const refusal = error as ManagedDatabaseRefusal;
            return { refused: true, output: refusal.lines.join("\n"), message: refusal.message };
        } finally {
            exit.mockRestore();
        }
        return { refused: false, output: "", message: "" };
    };

    it.each(["push", "generate", "migrate"])("refuses db %s on the managed database", (sub) => {
        const { refused, output } = call(["node", "rebase", "db", sub], "managed");
        expect(refused).toBe(true);
        // It must name something that works, not merely decline.
        expect(output).toContain("rebase dev");
        expect(output).toContain("DATABASE_URL");
    });

    it("allows the same subcommands against a real Postgres", () => {
        expect(call(["node", "rebase", "db", "push"], "url").refused).toBe(false);
        expect(call(["node", "rebase", "db", "push"], "docker").refused).toBe(false);
    });

    it("leaves subcommands that do not use Atlas alone", () => {
        // Backups and branches reach the database directly; nothing here is
        // planned by a diff, so the managed database serves them fine.
        for (const sub of ["backup", "restore", "backups", "branch", "pull"]) {
            expect(call(["node", "rebase", "db", sub], "managed").refused).toBe(false);
        }
    });
});

describe("refuseBranchOnManagedDatabase", () => {
    /**
     * Measured on a fresh `rebase init` scaffold: `branch create` answered
     * `✓ Branch "feature_x" created successfully.`, `branch list` showed it at
     * 7.1 MB, and connecting to `rb_feature_x` reported `current_database()` =
     * `postgres`. A table created "in the branch" appeared in the parent.
     *
     * PGlite serves one database, so `CREATE DATABASE ... TEMPLATE` writes a
     * catalog row and nothing else — and the catalog row is what makes the
     * listing's `JOIN pg_database` corroborate it.
     */
    const call = (args: string[], kind: string) => {
        const exit = vi.spyOn(process, "exit").mockImplementation((() => {
            throw new Error("the guard must not exit the process");
        }) as never);
        try {
            refuseBranchOnManagedDatabase(args, kind);
        } catch (error) {
            expect(error).toBeInstanceOf(ManagedDatabaseRefusal);
            return { refused: true, output: (error as ManagedDatabaseRefusal).lines.join("\n") };
        } finally {
            exit.mockRestore();
        }
        return { refused: false, output: "" };
    };

    it("refuses db branch on the managed database", () => {
        const { refused, output } = call(["node", "rebase", "db", "branch", "create", "x"], "managed");
        expect(refused).toBe(true);
        expect(output).toContain("does not work on the managed development database");
    });

    it.each(["create", "list", "info", "delete"])("refuses branch %s, not create alone", (action) => {
        // `list` used to end with "Create one with: rebase db branch create",
        // which is an invitation to do the broken thing.
        const { refused } = call(["node", "rebase", "db", "branch", action], "managed");
        expect(refused).toBe(true);
    });

    it("says why, in terms of what would actually happen to the data", () => {
        const { output } = call(["node", "rebase", "db", "branch", "create", "x"], "managed");
        expect(output).toContain("the copy would be the");
        expect(output).toContain("PGlite");
    });

    it("names something that works rather than merely declining", () => {
        const { output } = call(["node", "rebase", "db", "branch", "create", "x"], "managed");
        expect(output).toContain("rebase dev --docker");
        expect(output).toContain("DATABASE_URL");
    });

    it.each(["external", "docker"])("allows branching on a real Postgres (%s)", (kind) => {
        const { refused } = call(["node", "rebase", "db", "branch", "create", "x"], kind);
        expect(refused).toBe(false);
    });

    it("leaves the other db subcommands alone", () => {
        // push/generate/migrate are refused by refuseAtlasOnManagedDatabase,
        // with a different message; backup and restore are not refused at all.
        for (const sub of ["push", "backup", "restore", "pull"]) {
            expect(call(["node", "rebase", "db", sub], "managed").refused).toBe(false);
        }
    });
});

describe("the examples in `rebase db --help`", () => {
    /**
     * Every command the help used to lead with — `db push`, `db generate`,
     * `db migrate`, `db branch` — is refused on the managed development
     * database, by the two guards above, in this same file. So on the project
     * the CLI had just scaffolded, the first thing `rebase db --help` offered
     * was a command that answers with a refusal.
     */
    // eslint-disable-next-line no-control-regex
    const plain = (kind: Parameters<typeof dbExamples>[0]) => dbExamples(kind).replace(/\x1b\[[0-9;]*m/g, "");

    const REFUSED_ON_MANAGED = ["rebase db push", "rebase db generate", "rebase db migrate", "rebase db branch"];

    it("offers nothing the managed database refuses", () => {
        const examples = plain("managed");
        for (const command of REFUSED_ON_MANAGED) {
            expect(examples, `${command} is refused on the managed database`).not.toContain(command);
        }
    });

    it("leads with something that works there", () => {
        const first = plain("managed").split("\n").find(l => l.trim() && !l.trim().startsWith("#"))!;
        expect(first).toContain("rebase schema generate");
    });

    it("names how to get a database those commands do work on", () => {
        // Declining without naming the alternative is how a reader concludes
        // their install is broken.
        const examples = plain("managed");
        expect(examples).toContain("rebase dev --docker");
        expect(examples).toContain("DATABASE_URL");
    });

    it.each(["external", "docker", null] as const)("keeps the full workflow for %s", (kind) => {
        const examples = plain(kind);
        for (const command of REFUSED_ON_MANAGED) expect(examples).toContain(command);
    });
});

/**
 * `db pull` and `db url` answer the same question about the same project.
 *
 * They did not. `prepareDatabaseEnv` returns `env: {}` for a plain external
 * database — the connection string is already in a place the child reads — so
 * `db pull`, which read only `prepared.env.DATABASE_URL ?? process.env
 * .DATABASE_URL`, answered `✗ No local database to pull into.` on the standard
 * configuration: `DATABASE_URL` in `.env` and nowhere else. `rebase db url` on
 * the same project printed the URL. Exporting it in the shell made the pull
 * work, which is how a broken command comes to look like a user error.
 */
describe("databaseUrlOf", () => {
    const external = (url: string) => ({ kind: "external", url, source: "env-file" } as const);

    it("finds the URL that is only in .env", () => {
        expect(databaseUrlOf(
            { env: {}, database: external("postgres://u@h/app") },
            { DATABASE_URL: "postgres://u@h/app" }
        )).toBe("postgres://u@h/app");
    });

    it("prefers the prepared environment, which is where a branch URL lives", () => {
        expect(databaseUrlOf(
            { env: { DATABASE_URL: "postgres://u@h/rb_feature" }, database: external("postgres://u@h/app") },
            { DATABASE_URL: "postgres://u@h/app" }
        )).toBe("postgres://u@h/rb_feature");
    });

    it("does not invent a URL for the managed database", () => {
        // The managed variant carries no `url` at all: it is served by a daemon
        // the caller may not have started. `prepareDatabaseEnv` puts the real
        // one in `env` when it does start it.
        expect(databaseUrlOf({ env: {}, database: { kind: "managed", source: "managed" } }, {}))
            .toBeUndefined();
    });

    it("still answers for a project that configured nothing anywhere", () => {
        expect(databaseUrlOf({ env: {}, database: external("") }, {})).toBeUndefined();
    });
});
