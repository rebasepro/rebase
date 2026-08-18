/**
 * `rebase db` argument handling.
 *
 * The plugin CLI runs with `cwd: backendDir` — it must, because that is where
 * the plugin and its dependencies resolve from — while the developer types the
 * command at the project root. Every local path on the command line therefore
 * has to be resolved before the child is handed a different working directory.
 */
import { describe, it, expect } from "vitest";
import path from "path";
import { absolutizeLocalPathArgs } from "./db.js";

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
