/**
 * The correction is the whole answer for a mistyped command, and none of the
 * six families offered one. Five printed an error and then a screen of help —
 * which pushes the one line that says what happened off the top of a CI log —
 * and `telemetry` printed only the help, so a typo was indistinguishable from
 * `rebase telemetry --help` apart from an exit code nobody reads at a prompt.
 */
import { describe, expect, it } from "vitest";
import { suggestCommand, unknownCommandMessage } from "./unknown-command";

const TOP_LEVEL = ["init", "schema", "db", "dev", "build", "start", "auth", "doctor",
    "skills", "api-keys", "cloud", "apps", "eject", "generate-sdk", "telemetry",
    "resources", "status"];

describe("suggestCommand", () => {
    it("catches a transposition", () => {
        // Two adjacent keys in the wrong order is the most common typing error
        // there is, and plain Levenshtein scores it 2 — the same as two
        // unrelated edits, which is too far to suggest anything.
        expect(suggestCommand("statsu", TOP_LEVEL)).toBe("status");
        expect(suggestCommand("craete", ["create", "list", "delete"])).toBe("create");
    });

    it("catches a dropped and a doubled letter", () => {
        expect(suggestCommand("dbb", TOP_LEVEL)).toBe("db");
        expect(suggestCommand("instal", ["install"])).toBe("install");
        expect(suggestCommand("reset-pasword", ["reset-password"])).toBe("reset-password");
    });

    it("completes an unambiguous abbreviation", () => {
        expect(suggestCommand("dep", ["deploy", "link", "login"])).toBe("deploy");
    });

    it("refuses an ambiguous one rather than tossing a coin", () => {
        // `res` prefixes both. Picking whichever came first in the list would
        // be a guess presented as an answer — and one of these two deletes a
        // database.
        expect(suggestCommand("res", ["reset", "restore"])).toBeUndefined();
    });

    it("says nothing when nothing is close", () => {
        expect(suggestCommand("zzzz", TOP_LEVEL)).toBeUndefined();
        expect(suggestCommand("deploy", TOP_LEVEL)).toBeUndefined();
    });

    it("keeps a short word to a single edit", () => {
        // `push` and `pull` are two edits apart, and one of them is the
        // destructive neighbour of the other. A budget of 2 on four-letter
        // words would let a typo for one confidently propose the other.
        expect(suggestCommand("puxh", ["push", "pull"])).toBe("push");
        expect(suggestCommand("pxxh", ["push", "pull"])).toBeUndefined();
    });
});

describe("unknownCommandMessage", () => {
    it("is one line, with the correction and where to read the rest", () => {
        expect(unknownCommandMessage("statsu", TOP_LEVEL)).toBe(
            'Unknown command "statsu" — did you mean `status`? Run `rebase --help` for the rest.'
        );
    });

    it("names the family when there is one", () => {
        expect(unknownCommandMessage("reset-pasword", ["reset-password"], "auth")).toBe(
            'Unknown auth command "reset-pasword" — did you mean `reset-password`? '
            + "Run `rebase auth --help` for the rest."
        );
    });

    it("still points at the help when it has nothing to suggest", () => {
        expect(unknownCommandMessage("zzzz", TOP_LEVEL)).toBe(
            'Unknown command "zzzz". Run `rebase --help` for the ones there are.'
        );
    });

    it("never breaks across lines — a CI log buries anything that does", () => {
        for (const message of [
            unknownCommandMessage("statsu", TOP_LEVEL),
            unknownCommandMessage("zzzz", TOP_LEVEL),
            unknownCommandMessage(undefined, TOP_LEVEL, "apps")
        ]) {
            expect(message).not.toContain("\n");
        }
    });
});
