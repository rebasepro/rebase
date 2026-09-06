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
    dbExamples,
    ManagedDatabaseRefusal,
    refuseAtlasOnManagedDatabase,
    refuseBranchOnManagedDatabase
} from "./db.js";

const ROOT = path.resolve("/projects/my-app");

describe("absolutizeLocalPathArgs", () => {
    it("resolves a relative --out against the directory the user is standing in", () => {
        /*
         * The reported bug: `rebase db backup --out ./backups` from the project
         * root wrote to `backend/backups` while the success line echoed the path
         * as typed, so the file existed and the location printed was wrong. That
         * exact invocation is in `rebase db --help`'s own examples.
         */
        const out = absolutizeLocalPathArgs(["db", "backup", "--out", "./backups"], ROOT);
        expect(out).toEqual(["db", "backup", "--out", path.join(ROOT, "backups")]);
    });

    it("handles the --out=<value> spelling", () => {
        const out = absolutizeLocalPathArgs(["db", "backup", "--out=./backups"], ROOT);
        expect(out).toEqual(["db", "backup", `--out=${path.join(ROOT, "backups")}`]);
    });

    it("handles the -o alias", () => {
        const out = absolutizeLocalPathArgs(["db", "backup", "-o", "backups"], ROOT);
        expect(out).toEqual(["db", "backup", "-o", path.join(ROOT, "backups")]);
    });

    it("leaves an already-absolute path alone", () => {
        const abs = path.resolve("/var/backups");
        expect(absolutizeLocalPathArgs(["db", "backup", "--out", abs], ROOT))
            .toEqual(["db", "backup", "--out", abs]);
    });

    it("never touches a remote destination", () => {
        /*
         * The whole point of the fix is joining paths onto a cwd, and an
         * `s3://bucket/prefix` joined onto anything stops being a URL. Matched
         * as "scheme://" in general rather than a list of known schemes, so a
         * destination this build does not support yet still survives intact.
         */
        for (const url of ["s3://bucket/prefix", "gs://bucket/prefix", "https://example.com/x"]) {
            expect(absolutizeLocalPathArgs(["db", "backup", "--out", url], ROOT))
                .toEqual(["db", "backup", "--out", url]);
        }
    });

    it("does not mistake the next flag for the value of --out", () => {
        const out = absolutizeLocalPathArgs(["db", "backup", "--out", "--no-owner"], ROOT);
        expect(out).toEqual(["db", "backup", "--out", "--no-owner"]);
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
