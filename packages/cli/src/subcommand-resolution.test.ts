/**
 * A flag's value is never the subcommand.
 *
 * `cli.ts` named the subcommand as the second word that is not a flag, and a
 * flag's value is such a word. So a group's own documented flags, written
 * before its subcommand, were refused as unknown subcommands:
 *
 *   rebase db --collections ./config/collections push   → db command "./config/collections"
 *   rebase api-keys --name ci create                    → api-keys command "ci"
 *   rebase skills --agent claude install                → skills command "claude"
 *
 * Which flags take a value is not known at this level (for `db` and `schema`,
 * only the database driver's CLI knows), so the subcommand is read against the
 * group's vocabulary. These drive the real `entry`, with the groups' handlers
 * stood in so nothing runs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./telemetry", async importOriginal => ({
    ...await importOriginal<typeof import("./telemetry")>(),
    recordEvent: async () => undefined
}));
vi.mock("./commands/api-keys", async importOriginal => ({
    ...await importOriginal<typeof import("./commands/api-keys")>(),
    apiKeysCommand: vi.fn()
}));
vi.mock("./commands/skills", async importOriginal => ({
    ...await importOriginal<typeof import("./commands/skills")>(),
    skillsCommand: vi.fn()
}));
vi.mock("./commands/db", async importOriginal => ({
    ...await importOriginal<typeof import("./commands/db")>(),
    dbCommand: vi.fn()
}));

import { entry, resolveSubcommand } from "./cli";
import { apiKeysCommand } from "./commands/api-keys";
import { skillsCommand } from "./commands/skills";
import { dbCommand } from "./commands/db";

const KNOWN = ["push", "pull", "status"];

describe("resolveSubcommand", () => {
    it.each([
        [["push"], "push"],
        [["--collections", "./c", "push"], "push"],
        [["--collections=./c", "push"], "push"],
        [["push", "--collections", "./c"], "push"],
        [["--dry-run", "push"], "push"],
        // A typo is still the subcommand, so the group refuses it by name.
        [["psuh"], "psuh"],
        [["--dry-run", "psuh"], "psuh"],
        [["--collections=./c", "psuh"], "psuh"],
        // Nothing known at all: the first word, as before.
        [["--collections", "./c"], "./c"],
        [[], undefined]
    ] as const)("reads %j as %j", (after, expected) => {
        expect(resolveSubcommand(after, KNOWN)).toBe(expected);
    });

    it("keeps the first word for a command with no subcommands", () => {
        expect(resolveSubcommand(["--template", "blank", "my-app"], [])).toBe("blank");
    });
});

describe("entry", () => {
    beforeEach(() => vi.clearAllMocks());

    it.each([
        ["api-keys --name ci create", apiKeysCommand, "create"],
        ["skills --agent claude install", skillsCommand, "install"],
        ["db --collections ./config/collections push", dbCommand, "push"]
    ] as const)("hands `rebase %s` to its group with the subcommand", async (line, handler, subcommand) => {
        await entry(["node", "rebase", ...line.split(" ")]);
        expect(handler).toHaveBeenCalledTimes(1);
        expect(vi.mocked(handler).mock.calls[0][0]).toBe(subcommand);
    });

    it("still hands a typo to the group, which refuses it", async () => {
        await entry(["node", "rebase", "db", "psuh"]);
        expect(vi.mocked(dbCommand).mock.calls[0][0]).toBe("psuh");
    });
});
