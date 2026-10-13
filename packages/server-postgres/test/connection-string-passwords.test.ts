/**
 * No connection-string password reaches a command line, a terminal or a log.
 *
 * `db restore` with a mistyped flag failed with execa's
 * `Command failed with exit code 1: pg_restore … '--dbname=postgresql://rebase_app:f8bd0240…@127.0.0.1:5433/rebase'`,
 * printed whole into the terminal, and the scheduled backup records the same
 * message in its run history. The client tools now take the password from
 * `PGPASSWORD`, and whatever the driver CLI prints is redacted on the way out.
 */
import { redactConnectionPasswords, splitPassword } from "../src/utils/connection-string";
import { reportCommandFailure } from "../src/cli-errors";
import { CommandStopped } from "../src/cli-scratch-database";

describe("splitPassword", () => {
    it("takes the password out of the user info", () => {
        expect(splitPassword("postgresql://rebase_app:s3cret@127.0.0.1:5433/rebase?sslmode=disable")).toEqual({
            connectionString: "postgresql://rebase_app@127.0.0.1:5433/rebase?sslmode=disable",
            password: "s3cret"
        });
    });

    it("percent-decodes it, because PGPASSWORD is read literally", () => {
        expect(splitPassword("postgres://u:p%40ss%2Fw%3Ard@h/db").password).toBe("p@ss/w:rd");
    });

    it("takes a `password` parameter out too, keeping the others encoded", () => {
        expect(splitPassword("postgres://u@h/db?password=pw&options=-c%20search_path%3Dpublic")).toEqual({
            connectionString: "postgres://u@h/db?options=-c%20search_path%3Dpublic",
            password: "pw"
        });
    });

    it("leaves a URL with no password, a key/value DSN and other schemes alone", () => {
        for (const value of ["postgres://u@h/db", "host=h user=u password=pw dbname=db", "mysql://u:p@h/db"]) {
            expect(splitPassword(value)).toEqual({ connectionString: value, password: null });
        }
    });
});

describe("redactConnectionPasswords", () => {
    it("redacts the password execa's error repeats from the command line", () => {
        const message = "Command failed with exit code 1: /opt/homebrew/bin/pg_restore '--format=custom' --no-password " +
            "'--dbname=postgresql://rebase_app:f8bd0240abc@127.0.0.1:5433/rebase?sslmode=disable' --exit-on-error x.dump";
        const redacted = redactConnectionPasswords(message);
        expect(redacted).not.toContain("f8bd0240abc");
        expect(redacted).toContain("postgresql://rebase_app:***@127.0.0.1:5433/rebase?sslmode=disable");
    });

    it("redacts a password with a raw @ in it, up to the host", () => {
        expect(redactConnectionPasswords("postgres://u:p@ss@db.internal/app")).toBe("postgres://u:***@db.internal/app");
    });

    it("redacts `password=` in a query string and in a key/value DSN", () => {
        expect(redactConnectionPasswords("postgres://u@h/db?password=pw&sslmode=require"))
            .toBe("postgres://u@h/db?password=***&sslmode=require");
        expect(redactConnectionPasswords("host=h password='a b' dbname=db")).toBe("host=h password=*** dbname=db");
    });

    it("leaves text with no password unchanged", () => {
        for (const text of ["postgres://u@h/db", "see https://rebase.pro/docs", "write to a@b.c"]) {
            expect(redactConnectionPasswords(text)).toBe(text);
        }
    });
});

describe("reportCommandFailure", () => {
    let stderr: string[];
    let spy: jest.SpyInstance;

    beforeEach(() => {
        stderr = [];
        spy = jest.spyOn(console, "error").mockImplementation((line?: unknown) => {
            stderr.push(String(line ?? ""));
        });
    });
    afterEach(() => spy.mockRestore());

    it("redacts a password in the message and in its cause", () => {
        const error = new Error("could not connect to postgres://app:hunter2@db/app");
        error.cause = new Error("password=hunter2 rejected");

        reportCommandFailure(error);

        expect(stderr.join("\n")).not.toContain("hunter2");
        expect(stderr.join("\n")).toContain("postgres://app:***@db/app");
    });

    it("adds nothing to a CommandStopped, which has already said why", () => {
        reportCommandFailure(new CommandStopped("The destructive push was declined."));

        expect(stderr).toHaveLength(0);
    });
});
