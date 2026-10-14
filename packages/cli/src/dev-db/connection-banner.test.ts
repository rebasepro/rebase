/**
 * The banner the CLI's own database commands print when opening a database
 * fails: the three cases a reader can act on, each named, and never the
 * connection string, which carries the password.
 */
import { describe, expect, it } from "vitest";

import { connectionFailureBanner, connectionRefusedFixes } from "./connection-banner";

const URL = "postgresql://rebase_app:s3cret@127.0.0.1:5508/rebase?sslmode=disable";
const options = { consequence: "The password was not reset.", fixes: connectionRefusedFixes("last-dev") };
const pgError = (message: string, code: string) => Object.assign(new Error(message), { code });

describe("connectionFailureBanner", () => {
    it("names a server that does not answer, with the fixes for what named it", () => {
        const lines = connectionFailureBanner(URL, pgError("connect ECONNREFUSED 127.0.0.1:5508", "ECONNREFUSED"), options)!;
        const text = lines.join("\n");

        expect(text).toContain("❌  Cannot connect to PostgreSQL at 127.0.0.1:5508");
        expect(text).toContain("The driver said: connect ECONNREFUSED 127.0.0.1:5508");
        expect(text).toContain("The password was not reset.");
        expect(text).toContain("docker compose up -d db");
    });

    it("finds the refusal inside a dual-stack AggregateError", () => {
        const refused = new AggregateError([pgError("connect ECONNREFUSED ::1:5508", "ECONNREFUSED")], "");
        expect(connectionFailureBanner(URL, refused, options)?.join("\n")).toContain("Cannot connect to PostgreSQL at 127.0.0.1:5508");
    });

    it("names refused credentials and the user", () => {
        const text = connectionFailureBanner(URL, pgError("password authentication failed for user \"rebase_app\"", "28P01"), options)!.join("\n");
        expect(text).toContain("Authentication failed for user \"rebase_app\" at 127.0.0.1:5508");
    });

    it("names a database the server does not have", () => {
        const text = connectionFailureBanner(URL, pgError("database \"rebase\" does not exist", "3D000"), options)!.join("\n");
        expect(text).toContain("Database \"rebase\" does not exist at 127.0.0.1:5508");
    });

    it("leaves any other failure to the caller", () => {
        expect(connectionFailureBanner(URL, pgError("the server does not support SSL connections", "08P01"), options)).toBeNull();
    });

    it("never prints the password", () => {
        for (const error of [pgError("x", "ECONNREFUSED"), pgError("x", "28P01"), pgError("x", "3D000")]) {
            expect(connectionFailureBanner(URL, error, options)!.join("\n")).not.toContain("s3cret");
        }
    });
});
