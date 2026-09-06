/**
 * Tests for the dev command's deterministic port logic.
 *
 * These verify that `getProjectPort` produces stable, non-colliding ports
 * and that the port resolution strategy (flag → env → file → hash) works
 * correctly.
 *
 * They used to reproduce `getProjectPort` locally, on the grounds that it was
 * not exported — so every assertion exercised the copy in this file and dev.ts
 * could have been deleted without a failure. `resolveStartPort`, which the
 * docblock claimed to cover, was never called at all. Both are exported now and
 * imported here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import { DEV_FLAGS, DEV_PORT_FILENAME, devCommand, devWatchIncludes, getProjectPort, readEnvValue, resolveStartPort, portMovedNotice, SCAFFOLD_DEFAULT_PORT, schemaPushArgv } from "./dev";

/**
 * `rebase dev` must notice a function or cron that did not exist when it
 * started.
 *
 * tsx restarts on changes to what the entrypoint imports, and the runtime does
 * not import these — it scans their directories at boot. So a brand-new
 * `backend/functions/new.ts` was invisible until somebody restarted by hand,
 * which is the opposite of what a watch mode is for. The `config/` case is
 * older and worse: the flag meant to watch it, `--watch=<glob>`, is not a tsx
 * flag at all, so tsx dropped it and the directory was never watched.
 */
describe("devWatchIncludes", () => {
    const paths = {
        REBASE_DEV_FUNCTIONS: "backend/functions",
        REBASE_DEV_CRONS: "backend/crons"
    };

    it("watches the functions and crons directories, absolute", () => {
        expect(devWatchIncludes("/srv/app", paths, false)).toEqual([
            path.join("/srv/app", "backend", "functions"),
            path.join("/srv/app", "backend", "crons")
        ]);
    });

    it("adds config/ only when auto-generation is off", () => {
        expect(devWatchIncludes("/srv/app", paths, true))
            .toContain(path.join("/srv/app", "config"));
        expect(devWatchIncludes("/srv/app", paths, false))
            .not.toContain(path.join("/srv/app", "config"));
    });

    it("honours a manifest that moved the directories", () => {
        expect(devWatchIncludes("/srv/app", {
            REBASE_DEV_FUNCTIONS: "services/api/handlers",
            REBASE_DEV_CRONS: "services/api/schedules"
        }, false)).toEqual([
            path.join("/srv/app", "services", "api", "handlers"),
            path.join("/srv/app", "services", "api", "schedules")
        ]);
    });

    it("drops an entry the manifest did not resolve", () => {
        expect(devWatchIncludes("/srv/app", { REBASE_DEV_FUNCTIONS: "backend/functions" }, false))
            .toEqual([path.join("/srv/app", "backend", "functions")]);
    });
});

describe("getProjectPort", () => {
    it("returns a port in the range 3001–3999", () => {
        const paths = [
            "/Users/dev/project-a",
            "/Users/dev/project-b",
            "/home/user/apps/my-rebase-app",
            "/tmp/test",
            "C:\\Users\\dev\\my-app"
        ];

        for (const p of paths) {
            const port = getProjectPort(p);
            expect(port).toBeGreaterThanOrEqual(3001);
            expect(port).toBeLessThanOrEqual(3999);
        }
    });

    it("is deterministic — same path always returns same port", () => {
        const p = "/Users/francesco/rebase/app";
        expect(getProjectPort(p)).toBe(getProjectPort(p));
    });

    it("produces different ports for different directories", () => {
        const portA = getProjectPort("/Users/dev/project-alpha");
        const portB = getProjectPort("/Users/dev/project-beta");
        // Not guaranteed by a hash, but extremely likely for distinct strings
        expect(portA).not.toBe(portB);
    });

    it("handles deeply nested paths", () => {
        const port = getProjectPort("/a/very/deeply/nested/path/to/project");
        expect(port).toBeGreaterThanOrEqual(3001);
        expect(port).toBeLessThanOrEqual(3999);
    });

    it("handles single-character paths", () => {
        const port = getProjectPort("/");
        expect(port).toBeGreaterThanOrEqual(3001);
        expect(port).toBeLessThanOrEqual(3999);
    });
});

describe("port collision resistance", () => {
    it("produces at least 50 unique ports from 100 random-looking paths", () => {
        const ports = new Set<number>();
        for (let i = 0; i < 100; i++) {
            ports.add(getProjectPort(`/Users/dev/project-${i}`));
        }
        // With 999 possible values and 100 inputs, collisions are possible
        // but having fewer than 50 unique values would indicate a broken hash
        expect(ports.size).toBeGreaterThan(50);
    });
});

describe("resolveStartPort", () => {

    let projectRoot: string;
    let savedPortEnv: string | undefined;

    beforeEach(() => {
        projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-dev-port-"));
        savedPortEnv = process.env.PORT;
        delete process.env.PORT;
    });

    afterEach(() => {
        if (savedPortEnv === undefined) delete process.env.PORT;
        else process.env.PORT = savedPortEnv;
        fs.rmSync(projectRoot, { recursive: true,
force: true });
    });

    const writePortFile = (port: string) =>
        fs.writeFileSync(path.join(projectRoot, DEV_PORT_FILENAME), port, "utf-8");

    it("falls back to the project hash when nothing else says otherwise", () => {
        expect(resolveStartPort(projectRoot)).toBe(getProjectPort(projectRoot));
    });

    it("prefers the saved port file over the hash", () => {
        writePortFile("4321");
        expect(resolveStartPort(projectRoot)).toBe(4321);
    });

    it("prefers PORT over the saved port file", () => {
        writePortFile("4321");
        process.env.PORT = "5555";
        expect(resolveStartPort(projectRoot)).toBe(5555);
    });

    it("prefers the explicit flag over everything", () => {
        writePortFile("4321");
        process.env.PORT = "5555";
        expect(resolveStartPort(projectRoot, 6006)).toBe(6006);
    });

    it("ignores a port file holding an out-of-range or unparseable value", () => {
        const hashed = getProjectPort(projectRoot);
        for (const bad of ["0", "-1", "65536", "999999", "not-a-port", ""]) {
            writePortFile(bad);
            expect(resolveStartPort(projectRoot)).toBe(hashed);
        }
    });

    it("tolerates trailing whitespace in the port file", () => {
        writePortFile("4321\n");
        expect(resolveStartPort(projectRoot)).toBe(4321);
    });

    // The twin of the port-file case above. It was the branch without the
    // check: `PORT=oops` reached `parseInt` and came back `NaN`, which was
    // returned as the port to start from.
    it("ignores a PORT holding an out-of-range or unparseable value", () => {
        const hashed = getProjectPort(projectRoot);
        for (const bad of ["0", "-1", "65536", "999999", "not-a-port", "80.5", "  "]) {
            process.env.PORT = bad;
            const resolved = resolveStartPort(projectRoot);
            expect(Number.isInteger(resolved)).toBe(true);
            expect(resolved).toBe(hashed);
        }
    });

    it("falls back to the port file, not the hash, when PORT is unusable", () => {
        writePortFile("4321");
        process.env.PORT = "not-a-port";
        expect(resolveStartPort(projectRoot)).toBe(4321);
    });

    it("tolerates surrounding whitespace in PORT", () => {
        process.env.PORT = " 5555 ";
        expect(resolveStartPort(projectRoot)).toBe(5555);
    });

    it("falls back to the hash when the project directory does not exist", () => {
        const missing = path.join(projectRoot, "gone");
        expect(resolveStartPort(missing)).toBe(getProjectPort(missing));
    });
});

/**
 * The help is an instruction, so a flag it names has to exist.
 *
 * This page advertised `--port, -p` while the spec has only ever declared `-P`
 * — the same shape as the `auth` bug, where a `-p` that was documented and
 * undeclared was pushed into the positionals. Here it was silent rather than
 * destructive: `rebase dev -p 4000`, typed straight off this page, started on
 * the project's default port and said nothing about the flag it ignored.
 */
describe("readEnvValue", () => {
    it("returns undefined for a variable that is set to nothing", () => {
        // The scaffold ships `VITE_API_URL=` empty and a commented line right
        // under it. The old `\\s*(.+?)\\s*$` let the leading `\\s*` eat the
        // newline, so this returned "# VITE_GOOGLE_CLIENT_ID=" — and every
        // first `rebase dev` warned that a variable nobody had set was being
        // ignored.
        const env = [
            "VITE_API_URL=",
            "# VITE_GOOGLE_CLIENT_ID=",
            ""
        ].join("\n");

        expect(readEnvValue(env, "VITE_API_URL")).toBeUndefined();
    });

    it("reads a value on its own line", () => {
        expect(readEnvValue("PORT=3001\nNODE_ENV=development\n", "PORT")).toBe("3001");
    });

    it("strips surrounding quotes", () => {
        expect(readEnvValue('FRONTEND_URL="http://localhost:5173"\n', "FRONTEND_URL"))
            .toBe("http://localhost:5173");
    });

    it("is undefined for a key that is not there", () => {
        expect(readEnvValue("PORT=3001\n", "DATABASE_URL")).toBeUndefined();
    });

    it("does not read a commented-out line as a value", () => {
        // `# DATABASE_URL=…` is how the scaffold says "not this one".
        expect(readEnvValue("# DATABASE_URL=postgres://x\n", "DATABASE_URL")).toBeUndefined();
    });

    it("names the port the scaffold ships", () => {
        expect(SCAFFOLD_DEFAULT_PORT).toBe(3001);
    });
});

describe("the dev help and the dev flag spec", () => {
    it("advertises only short aliases the spec declares", async () => {
        const printed: string[] = [];
        const spy = vi.spyOn(console, "log").mockImplementation(message => {
            printed.push(String(message));
        });
        try {
            await devCommand(["node", "rebase", "dev", "--help"]);
        } finally {
            spy.mockRestore();
        }

        // eslint-disable-next-line no-control-regex
        const help = printed.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
        const advertised = [...help.matchAll(/--[a-z-]+, (-[a-zA-Z])/g)].map(match => match[1]);

        expect(advertised.length).toBeGreaterThan(0);
        for (const alias of advertised) {
            expect(Object.keys(DEV_FLAGS)).toContain(alias);
        }
    });

    it("documents every flag the spec accepts", async () => {
        // The other direction, and the one that was broken: `--database-url`
        // and `--docker` were both accepted and neither appeared in --help, so
        // the only way to learn that `dev` can use your own Postgres was to
        // read resolve.ts.
        const printed: string[] = [];
        const spy = vi.spyOn(console, "log").mockImplementation(message => {
            printed.push(String(message));
        });
        try {
            await devCommand(["node", "rebase", "dev", "--help"]);
        } finally {
            spy.mockRestore();
        }

        // eslint-disable-next-line no-control-regex
        const help = printed.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
        const longFlags = Object.entries(DEV_FLAGS)
            .filter(([name, spec]) => name.startsWith("--") && typeof spec !== "string")
            .map(([name]) => name);

        expect(longFlags).toEqual(expect.arrayContaining(["--docker", "--database-url"]));
        for (const flag of longFlags) {
            expect(help, `${flag} is accepted by the parser but missing from --help`).toContain(flag);
        }
    });

    it("reads --no-db in exactly one place", () => {
        // The flag used to be read twice: once to disable the preflight, once
        // not at all for the managed database, which starts on the *other*
        // branch. So `rebase dev --no-db` wrote .rebase/pglite/, booted a
        // daemon and served against it — the one database a scaffolded project
        // would otherwise get, started by the flag that asks for none. Two
        // reads of the same flag are two things that have to agree; one is not.
        const source = fs.readFileSync(
            path.join(import.meta.dirname, "dev.ts"),
            "utf8"
        );

        const reads = source.match(/args\["--no-db"\]/g) ?? [];
        expect(reads).toHaveLength(1);
        expect(source).toContain("const noDb =");
    });

    it("no longer claims a docker-compose db service is started first", async () => {
        // It is started only for `--docker`, or for a DATABASE_URL that already
        // points at this machine. A scaffolded project sets neither and runs on
        // the managed database, so the old description described a path the
        // documented first run never takes.
        const printed: string[] = [];
        const spy = vi.spyOn(console, "log").mockImplementation(message => {
            printed.push(String(message));
        });
        try {
            await devCommand(["node", "rebase", "dev", "--help"]);
        } finally {
            spy.mockRestore();
        }

        // eslint-disable-next-line no-control-regex
        const help = printed.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
        expect(help).not.toContain("service is started first");
        expect(help).toContain("the managed development database");
    });
});

describe("portMovedNotice", () => {
    /**
     * The banner prints `↳ PORT = 3014` before the server binds, because the
     * backend's environment is fixed when it spawns. When the port is taken the
     * server moves and says so — and the banner is then wrong, with the true
     * number appearing in a `[backend]` line a hundred lines of DDL later.
     */
    it("reads both ports out of the backend's own warning", () => {
        expect(portMovedNotice("⚠️ [WARN] Port 4017 is in use — trying 4018."))
            .toEqual({ from: "4017", to: "4018" });
    });

    it("reads it through the colour the logger writes", () => {
        expect(portMovedNotice("[33m⚠️ Port 3013 is in use — trying 3014.[0m"))
            .toEqual({ from: "3013", to: "3014" });
    });

    it("says nothing about the last port, which is not a move", () => {
        // "Port N is in use, and it was the last one to try." — there is no new
        // number to correct the banner with.
        expect(portMovedNotice("Port 3013 is in use, and it was the last one to try.")).toBeNull();
    });

    it("says nothing about an ordinary log line", () => {
        expect(portMovedNotice("Server running at http://localhost:3001")).toBeNull();
        expect(portMovedNotice("[INFO] Port scanning is disabled")).toBeNull();
    });
});

describe("schemaPushArgv", () => {
    /**
     * The first `rebase dev --docker` of a fresh scaffold used to start the
     * container and then kill itself. The push ran in-process with
     * `["node","rebase","db","push"]` — an argv naming no database — so
     * `runDriverDbCommand` re-resolved from a `.env` whose `DATABASE_URL` is
     * commented out, decided "managed PGlite", and refused a command that was
     * never meant for PGlite. The container it had just started was two lines
     * above in the same transcript.
     */
    it("names the database the preflight resolved", () => {
        const url = "postgresql://rebase_app:pw@127.0.0.1:5435/rebase";

        expect(schemaPushArgv(url)).toEqual(["node", "rebase", "db", "push", "--database-url", url]);
    });

    it("says nothing when there is no database to name", () => {
        // `ensureDevDatabase` never reaches a push in this state; the argv stays
        // the plain one rather than carrying an empty flag value.
        expect(schemaPushArgv(undefined)).toEqual(["node", "rebase", "db", "push"]);
    });

    it("keeps the argv shape every command in this CLI receives", () => {
        // The driver slices the process argument vector, so the first two
        // entries are not decoration.
        expect(schemaPushArgv("postgres://u@127.0.0.1:5432/db").slice(0, 2)).toEqual(["node", "rebase"]);
    });
});
