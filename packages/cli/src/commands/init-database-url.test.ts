/**
 * `rebase init` takes only a PostgreSQL connection string as the database.
 *
 * Typing `n` at the connection-string prompt (answering the yes/no question
 * the reader thought it was) wrote `DATABASE_URL=n` and then offered to
 * introspect it, and `--database-url notaurl --yes` wrote `DATABASE_URL=notaurl`.
 * Both failed only at the first `rebase dev`, on "DATABASE_URL must be a valid
 * URL", in a project that had already been scaffolded around it.
 *
 * And a directory that already holds files was refused only after every
 * question had been answered, when the name was known from the first.
 */
import fs from "fs";
import os from "os";
import path from "path";
import inquirer from "inquirer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildInitQuestions, createRebaseApp, databaseUrlProblem, resolveInteractiveDatabase } from "./init";

class Exit extends Error {
    constructor(readonly code: number | undefined) {
        super(`process.exit(${code})`);
    }
}

// eslint-disable-next-line no-control-regex
const plain = (text: string): string => text.replace(/\u001b\[[0-9;]*m/g, "");

describe("databaseUrlProblem", () => {
    it("accepts a postgres:// or postgresql:// connection string", () => {
        expect(databaseUrlProblem("postgresql://user:pass@db.example.com:5432/app")).toBeNull();
        expect(databaseUrlProblem("postgres://user@localhost/app?sslmode=require")).toBeNull();
        expect(databaseUrlProblem("  postgresql://user@localhost:5432/app  ")).toBeNull();
    });

    it("refuses what is not a URL at all, such as an answer to a yes/no question", () => {
        for (const input of ["n", "no", "y", "notaurl", "localhost:5432/app"]) {
            expect(databaseUrlProblem(input), input).toMatch(/not a PostgreSQL connection string/);
        }
    });

    it("refuses a URL for another database", () => {
        expect(databaseUrlProblem("mysql://root@localhost:3306/app")).toMatch(/mysql:/);
        expect(databaseUrlProblem("https://db.example.com")).toMatch(/https:/);
    });

    it("says what a connection string looks like", () => {
        expect(databaseUrlProblem("n")).toContain("postgresql://user:password@host:5432/database");
    });
});

describe("the connection-string prompt", () => {
    const question = () => {
        const found = buildInitQuestions({ hasGitFlag: false, hasInstallFlag: false, pm: "pnpm" })
            .find(q => q.name === "databaseUrl");
        if (!found || found.type !== "input" || !found.validate) throw new Error("no databaseUrl input question");
        return found.validate;
    };

    it("asks again after `n`, rather than writing DATABASE_URL=n", () => {
        expect(question()("n")).toMatch(/not a PostgreSQL connection string/);
    });

    it("takes blank as the managed database, and a real connection string as given", () => {
        expect(question()("")).toBe(true);
        expect(question()("   ")).toBe(true);
        expect(question()("postgresql://u:p@localhost:5432/app")).toBe(true);
    });
});

describe("rebase init", () => {
    let tmp: string;
    let cwd: string;
    let err: string[];

    beforeEach(() => {
        cwd = process.cwd();
        tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-init-db-url-")));
        process.chdir(tmp);
        vi.stubEnv("REBASE_E2E", "1");
        err = [];
        vi.spyOn(console, "log").mockImplementation(() => undefined);
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { err.push(args.map(String).join(" ")); });
        vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
            throw new Exit(typeof code === "number" ? code : undefined);
        });
    });

    afterEach(() => {
        process.chdir(cwd);
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it("refuses --database-url that is not a connection string, and scaffolds nothing", async () => {
        await expect(createRebaseApp(["node", "rebase", "init", "app", "--yes", "--database-url", "notaurl"]))
            .rejects.toThrow("process.exit(1)");

        expect(plain(err.join("\n"))).toMatch(/--database-url is not a PostgreSQL connection string/);
        expect(fs.existsSync(path.join(tmp, "app"))).toBe(false);
    });

    it("still scaffolds with a real one", async () => {
        await createRebaseApp(["node", "rebase", "init", "app", "--yes", "--database-url", "postgresql://u:p@localhost:5432/app"]);

        expect(fs.readFileSync(path.join(tmp, "app", ".env"), "utf8")).toMatch(/^DATABASE_URL=postgresql:\/\/u:p@localhost:5432\/app/m);
    }, 60_000);

    it("refuses a directory that already holds files before asking anything", async () => {
        fs.mkdirSync(path.join(tmp, "taken"));
        fs.writeFileSync(path.join(tmp, "taken", "notes.txt"), "mine\n");
        const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
        Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
        const prompt = vi.spyOn(inquirer, "prompt").mockImplementation(() => {
            throw new Error("asked a question about a directory it was going to refuse");
        });
        try {
            await expect(createRebaseApp(["node", "rebase", "init", "taken"])).rejects.toThrow("process.exit(1)");
        } finally {
            if (tty) Object.defineProperty(process.stdin, "isTTY", tty);
            else Reflect.deleteProperty(process.stdin, "isTTY");
        }

        expect(prompt).not.toHaveBeenCalled();
        expect(plain(err.join("\n"))).toMatch(/already holds files.*notes\.txt/);
    });

    it("re-asks a typed project name whose directory already holds files", () => {
        fs.mkdirSync(path.join(tmp, "taken"));
        fs.writeFileSync(path.join(tmp, "taken", "notes.txt"), "mine\n");
        const name = buildInitQuestions({ hasGitFlag: false, hasInstallFlag: false, pm: "pnpm" })
            .find(q => q.name === "projectName");
        if (!name || name.type !== "input" || !name.validate) throw new Error("no projectName input question");

        expect(name.validate("taken")).toMatch(/already holds files.*notes\.txt/);
        expect(name.validate("fresh")).toBe(true);
    });
});

/**
 * On a terminal, `init app --database-url … --introspect` asked for the
 * connection string anyway, and the blank default replaced the flag: the
 * project got the Blog template on the managed database and nothing was
 * introspected. The --yes path read the flags; the interactive one did not.
 */
describe("interactive init honours --database-url and --introspect", () => {
    const url = "postgresql://postgres@127.0.0.1:55432/library";
    const names = (params: Partial<Parameters<typeof buildInitQuestions>[0]>) =>
        buildInitQuestions({ hasGitFlag: false, hasInstallFlag: false, pm: "pnpm", ...params }).map(q => q.name);

    it("does not ask for a connection string that was passed", () => {
        expect(names({ databaseUrlArg: url })).not.toContain("databaseUrl");
    });

    it("still offers to introspect the database that was passed", () => {
        const introspect = buildInitQuestions({ hasGitFlag: false, hasInstallFlag: false, pm: "pnpm", databaseUrlArg: url })
            .find(q => q.name === "introspect");
        if (!introspect || !("when" in introspect) || typeof introspect.when !== "function") throw new Error("no conditional introspect question");
        expect(introspect.when({})).toBe(true);
    });

    it("asks neither the introspect nor the template question under --introspect", () => {
        const questions = buildInitQuestions({ hasGitFlag: false, hasInstallFlag: false, pm: "pnpm", databaseUrlArg: url, introspectArg: true });
        expect(questions.map(q => q.name)).not.toContain("introspect");
        const preset = questions.find(q => q.name === "preset");
        if (!preset || !("when" in preset) || typeof preset.when !== "function") throw new Error("no conditional preset question");
        expect(preset.when({ headless: false })).toBe(false);
    });

    it("lets the flags win over the answers", () => {
        expect(resolveInteractiveDatabase({ databaseUrlArg: url, introspectArg: true, answers: {} }))
            .toEqual({ databaseUrl: url, introspect: true });
        expect(resolveInteractiveDatabase({ databaseUrlArg: url, answers: { introspect: false } }))
            .toEqual({ databaseUrl: url, introspect: false });
    });

    it("keeps the prompted answers when no flag was passed", () => {
        expect(resolveInteractiveDatabase({ answers: { databaseUrl: `  ${url}  `, introspect: true } }))
            .toEqual({ databaseUrl: url, introspect: true });
        expect(resolveInteractiveDatabase({ answers: { databaseUrl: "" } }))
            .toEqual({ databaseUrl: undefined, introspect: false });
    });

    it("introspects nothing when --introspect meets a blank connection string", () => {
        expect(resolveInteractiveDatabase({ introspectArg: true, answers: { databaseUrl: "" } }))
            .toEqual({ databaseUrl: undefined, introspect: false });
    });
});
