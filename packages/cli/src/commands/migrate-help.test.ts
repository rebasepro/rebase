/**
 * `rebase migrate` is findable and says what it does, through the real entry
 * point (`entry`, what the bin runs): the top-level help lists both
 * subcommands, `rebase migrate --help` and each subcommand's `--help` say when
 * to use `--check` / `--dry-run` / `--force` and what "manual steps" are, and a
 * word that is not a subcommand is answered with the two that are.
 *
 * Another agent once got `Unknown command "migrate"` from a stale `dist`; the
 * source of truth is held here.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { entry } from "../cli";
import { MIGRATE_SUBCOMMANDS } from "./migrate";

class ExitCalled extends Error {
    constructor(readonly code: string | number | null | undefined) {
        super(`process.exit(${code})`);
    }
}

let log: MockInstance<typeof console.log>;
let error: MockInstance<typeof console.error>;
let exit: MockInstance<typeof process.exit>;

beforeEach(() => {
    log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    exit = vi.spyOn(process, "exit").mockImplementation((code) => {
        throw new ExitCalled(code);
    });
});

afterEach(() => {
    vi.restoreAllMocks();
});

const printed = (spy: MockInstance<typeof console.log>) => spy.mock.calls.map(call => call.map(String).join(" ")).join("\n");

describe("rebase migrate: discoverability", () => {
    it("is registered with exactly the two subcommands", () => {
        expect([...MIGRATE_SUBCOMMANDS]).toEqual(["collections-to-tables", "sdk-calls"]);
    });

    it("rebase --help lists both subcommands", async () => {
        await entry(["node", "rebase", "--help"]);
        const out = printed(log);
        expect(out).toContain("migrate collections-to-tables");
        expect(out).toContain("migrate sdk-calls");
    });

    it.each([["migrate"], ["migrate", "--help"], ["migrate", "help"]])("rebase %s explains both subcommands, the flags and manual steps", async (...words) => {
        await entry(["node", "rebase", ...words]);
        const out = printed(log);
        for (const subcommand of MIGRATE_SUBCOMMANDS) expect(out).toContain(subcommand);
        for (const flag of ["--dry-run", "--check", "--force", "--json"]) expect(out).toContain(flag);
        expect(out).toContain("Manual steps");
        expect(out).toContain("uncommitted changes");
        expect(exit).not.toHaveBeenCalled();
    });

    it("collections-to-tables --help says when to use it, each flag, and what manual steps are", async () => {
        await entry(["node", "rebase", "migrate", "collections-to-tables", "--help"]);
        const out = printed(log);
        expect(out).toContain("When to use it");
        expect(out).toMatch(/--check\s+On a project already migrated/);
        expect(out).toMatch(/--dry-run\s+Print the plan/);
        expect(out).toMatch(/--force\s+Run on a dirty git tree/);
        expect(out).toContain("--skip-sdk-calls");
        expect(out).toContain("Manual steps");
        expect(exit).not.toHaveBeenCalled();
    });

    it("sdk-calls --help says when to use it, its flags, the rule keys and manual steps", async () => {
        await entry(["node", "rebase", "migrate", "sdk-calls", "--help"]);
        const out = printed(log);
        expect(out).toContain("When to use it");
        expect(out).toContain("existsIn({ collection: X })");
        for (const flag of ["--dry-run", "--json", "--force"]) expect(out).toContain(flag);
        expect(out).toContain("Manual steps");
        expect(exit).not.toHaveBeenCalled();
    });

    it("answers a near miss with the correction and names both subcommands", async () => {
        await expect(entry(["node", "rebase", "migrate", "colections-to-tables"])).rejects.toBeInstanceOf(ExitCalled);
        const err = printed(error);
        expect(err).toContain("did you mean `collections-to-tables`");
        expect(err).toContain("The subcommands are collections-to-tables and sdk-calls.");
        expect(exit).toHaveBeenCalledWith(1);
    });

    it("answers an unknown word with the two subcommands that exist", async () => {
        await expect(entry(["node", "rebase", "migrate", "frobnicate"])).rejects.toBeInstanceOf(ExitCalled);
        const err = printed(error);
        expect(err).toContain("Unknown migrate command \"frobnicate\"");
        expect(err).toContain("The subcommands are collections-to-tables and sdk-calls.");
    });
});
