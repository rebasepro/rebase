/**
 * What `rebase api-keys create` and `revoke` are actually about to do.
 *
 * Both read a positional — the key's name, and the id of the key to delete —
 * and both parsed the line the way `auth reset-password` used to: `arg` in
 * permissive mode over `rawArgs.slice(4)`. That is wrong twice.
 *
 *   rebase api-keys revoke --foo          → DELETE /api/admin/api-keys/--foo
 *   rebase api-keys create --debug …      → a key named "--debug"
 *   rebase --debug api-keys revoke <id>   → revokes the key named "revoke"
 *
 * None of these are hypothetical: `--debug` is what `bin/rebase.js` prints
 * after every failure as the thing to re-run with, so it is the likeliest token
 * to be appended to a command that has just failed — and on `create` it names a
 * credential that is then handed out.
 */
import { describe, expect, it, vi } from "vitest";
import {
    apiKeysCommand,
    CREATE_KEY_FLAGS,
    REVOKE_KEY_FLAGS,
    resolveCreateKeyArgs,
    resolveRevokeKeyArgs
} from "./api-keys";

/** A full `process.argv`, the way `cli.ts` hands it to a command. */
function argv(...line: string[]): string[] {
    return ["/usr/bin/node", "/usr/local/bin/rebase", ...line];
}

describe("resolveRevokeKeyArgs", () => {
    it("reads the id as a positional or as --id", () => {
        expect(resolveRevokeKeyArgs(argv("api-keys", "revoke", "key_123"))).toEqual({ id: "key_123" });
        expect(resolveRevokeKeyArgs(argv("api-keys", "revoke", "--id", "key_123"))).toEqual({ id: "key_123" });
    });

    it("refuses an undeclared flag rather than sending a DELETE for it", () => {
        expect(() => resolveRevokeKeyArgs(argv("api-keys", "revoke", "--foo")))
            .toThrow(/unknown or unexpected option/);
    });

    it("does not take --debug for the key to revoke", () => {
        expect(resolveRevokeKeyArgs(argv("api-keys", "revoke", "--debug"))).toEqual({ id: undefined });
    });

    it("is not shifted by a flag placed before the command", () => {
        // `slice(4)` started at "revoke", so the id was the word "revoke".
        expect(resolveRevokeKeyArgs(argv("--debug", "api-keys", "revoke", "key_123")))
            .toEqual({ id: "key_123" });
    });

    it("refuses more arguments than it takes", () => {
        expect(() => resolveRevokeKeyArgs(argv("api-keys", "revoke", "key_123", "key_456")))
            .toThrow(/takes 1 argument/);
    });

    it("names the command's help in the error", () => {
        expect(() => resolveRevokeKeyArgs(argv("api-keys", "revoke", "--wat")))
            .toThrow(/rebase api-keys revoke --help/);
    });
});

describe("resolveCreateKeyArgs", () => {
    it("reads the name as a positional, as --name, or as -n", () => {
        expect(resolveCreateKeyArgs(argv("api-keys", "create", "Analytics")).name).toBe("Analytics");
        expect(resolveCreateKeyArgs(argv("api-keys", "create", "--name", "Analytics")).name).toBe("Analytics");
        expect(resolveCreateKeyArgs(argv("api-keys", "create", "-n", "Analytics")).name).toBe("Analytics");
    });

    it("does not name a credential after a flag", () => {
        expect(resolveCreateKeyArgs(argv("api-keys", "create", "--debug", "--full-access")).name)
            .toBeUndefined();
        expect(() => resolveCreateKeyArgs(argv("api-keys", "create", "--foo", "--full-access")))
            .toThrow(/unknown or unexpected option/);
    });

    it("is not shifted by a flag placed before the command", () => {
        expect(resolveCreateKeyArgs(argv("--debug", "api-keys", "create", "Analytics")).name)
            .toBe("Analytics");
    });

    it("keeps the flags the command acts on", () => {
        const { flags } = resolveCreateKeyArgs(argv(
            "api-keys", "create", "CI", "--full-access", "--admin", "--rate-limit", "50", "--expires", "90d"
        ));

        expect(flags["--full-access"]).toBe(true);
        expect(flags["--admin"]).toBe(true);
        expect(flags["--rate-limit"]).toBe(50);
        expect(flags["--expires"]).toBe("90d");
    });
});

describe("the help and the flag specs", () => {
    it("advertises only aliases the specs declare", async () => {
        // The other half of the `auth` bug: its help offered `-p` that the spec
        // never declared, so following the help was what triggered the misparse.
        const printed: string[] = [];
        const spy = vi.spyOn(console, "log").mockImplementation(message => {
            printed.push(String(message));
        });
        try {
            await apiKeysCommand(undefined, []);
        } finally {
            spy.mockRestore();
        }

        // eslint-disable-next-line no-control-regex
        const help = printed.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
        const advertised = [...help.matchAll(/--[a-z-]+, (-[a-zA-Z])/g)].map(match => match[1]);
        const declared = [...Object.keys(CREATE_KEY_FLAGS), ...Object.keys(REVOKE_KEY_FLAGS)];

        expect(advertised.length).toBeGreaterThan(0);
        for (const alias of advertised) {
            expect(declared).toContain(alias);
        }
    });

    it("declares every long flag the help lists", () => {
        // And the reverse direction: a flag documented for `create` that the
        // spec drops is now rejected outright rather than ignored, so the two
        // lists have to agree.
        for (const flag of ["--name", "--permissions", "--full-access", "--admin", "--rate-limit", "--expires"]) {
            expect(Object.keys(CREATE_KEY_FLAGS)).toContain(flag);
        }
        expect(Object.keys(REVOKE_KEY_FLAGS)).toContain("--id");
    });
});
