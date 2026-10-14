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

    it("accepts the flags each action takes", () => {
        expect(unexpectedBranchArgs(["create", "x", "--force", "--from", "main"])).toEqual([]);
        expect(unexpectedBranchArgs(["delete", "x", "--force"])).toEqual([]);
        expect(unexpectedBranchArgs(["delete", "x", "--yes"])).toEqual([]);
        expect(unexpectedBranchArgs(["prune", "--older-than", "2w", "--include-dev-diff", "-y"])).toEqual([]);
        expect(unexpectedBranchArgs(["prune", "--yes"])).toEqual([]);
    });

    it("accepts what the CLI relays on every line", () => {
        // `--database-url` is how the CLI points a registry action at the
        // parent database; `--docker` and `--debug` are relayed as typed.
        expect(unexpectedBranchArgs(["list", "--database-url", "postgres://u@h/app", "--docker", "--debug"])).toEqual([]);
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

    it.each([["list", "--database-url"], ["prune", "--older-than"]])("accepts %s %s and its value", (action, flag) => {
        // `--from` was the only flag whose value was skipped, so `rebase db
        // branch list --database-url postgres://…` answered `✗ Unexpected
        // argument: postgres://…` — a line the CLI itself composes when the
        // checkout is on a branch, so `rebase.branches` is read in the parent
        // where it lives.
        expect(unexpectedBranchArgs([action, flag, "value"])).toEqual([]);
        expect(unexpectedBranchArgs([action, "x", flag, "value"])).toEqual([]);
    });

    it("accepts --database-url=value", () => {
        expect(unexpectedBranchArgs(["list", "--database-url=postgres://u@h/app"])).toEqual([]);
    });
});

/**
 * A typo'd flag on a `db branch` line is refused, naming the flag it was.
 *
 * Every other `db` command refuses one; `branch` accepted anything starting
 * with `-`, so the typo was dropped and the command ran without it:
 * `prune --older-then 1d --yes` pruned by no age ("Nothing to prune."),
 * `create x --froce` ran without --force, `list --jsn` listed.
 */
describe("a flag the branch action does not take", () => {
    const refusal = (words: string[]): string => {
        try {
            unexpectedBranchArgs(words);
        } catch (error) {
            return error instanceof Error ? error.message : String(error);
        }
        throw new Error(`accepted: ${words.join(" ")}`);
    };

    it("names the flag it is one edit from", () => {
        const message = refusal(["prune", "--older-then", "1d", "--yes"]);

        expect(message).toContain("`rebase db branch prune` has no option --older-then");
        expect(message).toContain("did you mean --older-than?");
        expect(message).toContain("Nothing was run.");
    });

    it("names the flag whose letters were swapped", () => {
        expect(refusal(["create", "x", "--froce"])).toContain("did you mean --force?");
    });

    it("says an action that takes no options takes none", () => {
        expect(refusal(["list", "--jsn"])).toMatch(/`rebase db branch list` has no option --jsn — it takes no options of its own\./);
    });

    it("lists what the action takes when nothing is close", () => {
        expect(refusal(["create", "x", "--dry-run"])).toContain("it takes --from, --force");
    });

    it("refuses a flag another action takes", () => {
        // `--older-than` belongs to prune; on `create` it changed nothing.
        expect(refusal(["create", "x", "--older-than", "1d"])).toContain("has no option --older-than");
    });

    it("judges the --flag=value form by its flag", () => {
        expect(refusal(["create", "x", "--frm=main"])).toContain("did you mean --from?");
    });
});
