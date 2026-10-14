/**
 * A backend that lost its database while booting is booted again.
 *
 * A `rebase db branch create --force` that landed while the backend booted
 * left it down: `Failed to start the Rebase runtime … terminating connection
 * due to administrator command (57P01)`, then "The backend did not come back
 * up after 30s. Fix the error above; the watcher restarts it on the next
 * change." Nothing needed fixing, and a second boot would have worked.
 */
import { describe, expect, it } from "vitest";

import { BootRetry } from "./boot-retry";

const HEADLINE = "❌ [ERROR] Failed to start the Rebase runtime: terminating connection due to administrator command";

describe("BootRetry", () => {
    it("plans on the first line of a failure that names a passing cause, once per failure", () => {
        const retry = new BootRetry(3, 1_000);

        expect(retry.line(HEADLINE)).toEqual({ attempt: 1, of: 3, delayMs: 1_000, reason: HEADLINE });
        expect(retry.line("  caused by: terminating connection due to administrator command (57P01)")).toBeNull();
        expect(retry.line(HEADLINE)).toMatchObject({ attempt: 2, delayMs: 2_000 });
        expect(retry.line(HEADLINE)).toMatchObject({ attempt: 3, delayMs: 4_000 });
        // Spent: the fourth failure is the dev server's to report.
        expect(retry.line(HEADLINE)).toBeNull();
    });

    it.each([
        "  caused by: database \"rebase\" is not currently accepting connections (55000)",
        "  caused by: the database system is starting up (57P03)",
        "  caused by: the database system is shutting down",
        "  caused by: terminating connection due to administrator command (57P01)",
        // `pg`'s own words for a client whose idle connection the server ended.
        "  caused by: Client has encountered a connection error and is not queryable"
    ])("reads the cause from a line after the headline: %s", (cause) => {
        const retry = new BootRetry();

        expect(retry.line("❌ [ERROR] Failed to start the Rebase runtime: Failed query: CREATE SCHEMA IF NOT EXISTS rebase")).toBeNull();
        expect(retry.line(cause)).toMatchObject({ attempt: 1 });
    });

    it.each([
        "  caused by: password authentication failed for user \"rebase_app\" (28P01)",
        "  caused by: connect ECONNREFUSED 127.0.0.1:5461",
        "  caused by: relation \"rebase.users\" does not exist (42P01)",
        "Two collections claim the slug \"posts\""
    ])("leaves a failure of the project's own alone: %s", (cause) => {
        const retry = new BootRetry();

        retry.line("❌ [ERROR] Failed to start the Rebase runtime: something");
        expect(retry.line(cause)).toBeNull();
    });

    it("ignores a passing cause outside a failing boot", () => {
        // A running backend's pool says this when a forced create closes its
        // connections; the backend is up, and nothing is to be restarted.
        expect(new BootRetry().line("⚠️ [WARN] [pg-pool] The database ended this server's idle connections (terminating connection due to administrator command, 57P01).")).toBeNull();
    });

    it("starts counting again once the backend has come up", () => {
        const retry = new BootRetry(1, 500);

        expect(retry.line(HEADLINE)).toMatchObject({ attempt: 1, delayMs: 500 });
        expect(retry.line(HEADLINE)).toBeNull();
        retry.up();
        expect(retry.line(HEADLINE)).toMatchObject({ attempt: 1, delayMs: 500 });
    });
});
