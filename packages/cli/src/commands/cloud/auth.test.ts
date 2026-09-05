/**
 * `rebase cloud login --password` says what it just did.
 *
 * A password written as an argument is in the shell's history file and in the
 * process table for as long as the command runs, and neither is something this
 * CLI can redact afterwards. The flag stays — there is no machine token yet, so
 * a non-interactive login genuinely needs the password from somewhere — but it
 * warns, once, BEFORE the request: by the time a login succeeds the password is
 * already written down, and a warning after that is advice about something that
 * has already happened.
 *
 * `REBASE_CLOUD_EMAIL` / `REBASE_CLOUD_PASSWORD` are the route that does not
 * touch the command line. The same stance `rls-check` takes for its connection
 * string, which carries a password too.
 */
import { describe, it, expect } from "vitest";
import { passwordOnTheCommandLine, LOGIN_FLAGS, PASSWORD_ENV, EMAIL_ENV } from "./auth";
import { ACTION_HELP } from "./action-help";

describe("passwordOnTheCommandLine", () => {
    it("is true for a password written as a flag", () => {
        expect(passwordOnTheCommandLine({ "--password": "hunter2" })).toBe(true);
    });

    it("is false when the flag was not used", () => {
        expect(passwordOnTheCommandLine({})).toBe(false);
        expect(passwordOnTheCommandLine({ "--password": undefined })).toBe(false);
    });

    it("is false for an empty value, which put nothing in the history", () => {
        expect(passwordOnTheCommandLine({ "--password": "" })).toBe(false);
    });
});

describe("the login page", () => {
    it("carries the warning, so it is read before the flag is used", () => {
        const page = ACTION_HELP.login;
        const text = [...page.flags.map(([, d]) => d), ...(page.notes ?? [])].join(" ");
        expect(text).toContain("shell history");
        expect(text).toContain(PASSWORD_ENV);
        expect(text).toContain(EMAIL_ENV);
    });

    it("still documents the flag it discourages", () => {
        // Discouraged is not removed: CI has no other route today, and a flag
        // that exists and is undocumented is worse than one with a caveat.
        expect(Object.keys(LOGIN_FLAGS)).toContain("--password");
        expect(page(ACTION_HELP.login)).toContain("--password");
    });
});

function page(entry: { flags: Array<[string, string]> }): string {
    return entry.flags.map(([flag]) => flag).join(" ");
}
