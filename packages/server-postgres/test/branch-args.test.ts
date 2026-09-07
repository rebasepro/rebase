/**
 * Words on a `db branch` command line that nothing accounts for.
 *
 * `rebase db branch create alpha beta` created `alpha` and discarded `beta`
 * silently — verified against a real Postgres. Every shape that produces is
 * quiet and wrong, and the branch name is the thing you type later to switch,
 * delete, or point a deploy at.
 */
import { unexpectedBranchArgs } from "../src/branch-argv";

describe("unexpectedBranchArgs", () => {
    it("accepts an action and a name", () => {
        expect(unexpectedBranchArgs(["create", "feature_auth"])).toEqual([]);
    });

    it("accepts an action with no name at all", () => {
        // `list`, and the missing-name errors the command raises itself.
        expect(unexpectedBranchArgs(["list"])).toEqual([]);
    });

    it("catches the second bare word", () => {
        expect(unexpectedBranchArgs(["create", "alpha", "beta"])).toEqual(["beta"]);
    });

    it("catches an unquoted name the shell split", () => {
        expect(unexpectedBranchArgs(["create", "my", "feature"])).toEqual(["feature"]);
    });

    it("catches a flag written without its dashes", () => {
        expect(unexpectedBranchArgs(["create", "feat", "from", "main"])).toEqual(["from", "main"]);
    });

    it("accepts --from and its value", () => {
        expect(unexpectedBranchArgs(["create", "staging", "--from", "production"])).toEqual([]);
    });

    it("accepts --from=value", () => {
        expect(unexpectedBranchArgs(["create", "staging", "--from=production"])).toEqual([]);
    });

    it("leaves flags it has never heard of alone", () => {
        // This runs on every branch subcommand, including ones added later.
        // Rejecting an unrecognised flag here would break them from a distance.
        expect(unexpectedBranchArgs(["create", "x", "--force", "--dry-run"])).toEqual([]);
    });

    it("still catches a bare word among flags", () => {
        expect(unexpectedBranchArgs(["create", "x", "--force", "oops"])).toEqual(["oops"]);
    });

    it("does not mistake a --from value for a stray word when more follows", () => {
        expect(unexpectedBranchArgs(["create", "x", "--from", "main", "extra"])).toEqual(["extra"]);
    });

    it("reports every extra, so one re-run fixes them all", () => {
        expect(unexpectedBranchArgs(["create", "a", "b", "c"])).toEqual(["b", "c"]);
    });

    it.each(["--database-url", "--older-than"])("accepts %s and its value", flag => {
        // `--from` was the only flag whose value was skipped, so `rebase db
        // branch list --database-url postgres://…` answered `✗ Unexpected
        // argument: postgres://…` — a line the CLI itself composes when the
        // checkout is on a branch, so `rebase.branches` is read in the parent
        // where it lives.
        expect(unexpectedBranchArgs(["list", flag, "value"])).toEqual([]);
        expect(unexpectedBranchArgs(["list", "x", flag, "value"])).toEqual([]);
    });

    it("accepts --database-url=value", () => {
        expect(unexpectedBranchArgs(["list", "--database-url=postgres://u@h/app"])).toEqual([]);
    });
});
