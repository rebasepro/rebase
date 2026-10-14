/**
 * What `rebase init` tells a reader it cannot prompt: run the same command
 * again with `--yes`.
 *
 * It used to print one fixed example, `rebase init <name> --yes --template
 * blog`, whatever was typed. headless.md's `init intro-app --headless
 * --database-url … --introspect --install`, run with no terminal, was told to
 * scaffold a blog — dropping every flag it had passed — and told so with a bare
 * `rebase`, which a reader who started with `pnpm dlx` does not have on PATH.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { stripVTControlCharacters } from "util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRebaseApp, initRerunCommand } from "./init";
import { cliVersion } from "../utils/version";

class Exit extends Error {
    constructor(readonly code: number | undefined) {
        super(`process.exit(${code})`);
    }
}

const DLX_BIN = "/Users/a/Library/Caches/pnpm/dlx/6e522544d6101487/1a1383c92c2-c0e1/node_modules/.bin";

describe("init with no terminal", () => {
    let cwd: string;
    let tmp: string;
    let err: string[];
    let tty: PropertyDescriptor | undefined;

    beforeEach(() => {
        cwd = process.cwd();
        tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-init-no-tty-")));
        process.chdir(tmp);
        err = [];
        vi.spyOn(console, "log").mockImplementation(() => undefined);
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { err.push(args.map(String).join(" ")); });
        vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
            throw new Exit(typeof code === "number" ? code : undefined);
        });
        tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
        Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    });

    afterEach(() => {
        if (tty) Object.defineProperty(process.stdin, "isTTY", tty);
        else Reflect.deleteProperty(process.stdin, "isTTY");
        process.chdir(cwd);
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    async function refusal(line: string[]): Promise<string> {
        await expect(createRebaseApp(["node", "rebase", "init", ...line])).rejects.toThrow("process.exit(1)");
        return stripVTControlCharacters(err.join("\n"));
    }

    it("repeats the flags it was given, with --yes, and nothing it was not", async () => {
        vi.stubEnv("npm_config_user_agent", "pnpm/11.4.0 npm/? node/v22.23.2 darwin arm64");
        vi.stubEnv("PATH", `${DLX_BIN}${path.delimiter}${process.env.PATH ?? ""}`);

        const text = await refusal(["intro-app", "--headless", "--database-url", "postgres://u2@127.0.0.1:55432/shop", "--introspect", "--install"]);

        expect(text).toContain(
            `pnpm dlx @rebasepro/cli@${cliVersion()} init intro-app --headless --database-url postgres://u2@127.0.0.1:55432/shop --introspect --install --yes`
        );
        expect(text).not.toContain("--template blog");
        expect(text).not.toMatch(/^\s*rebase init/m);
        expect(fs.readdirSync(tmp)).toEqual([]);
    });

    it("says rebase when that is how it was run", async () => {
        vi.stubEnv("npm_config_user_agent", "");
        const text = await refusal(["my-shop", "-t", "ecommerce"]);
        expect(text).toMatch(/^\s+rebase init my-shop -t ecommerce --yes$/m);
    });

    it("never repeats a password or a setup key", async () => {
        vi.stubEnv("npm_config_user_agent", "");
        const text = await refusal([
            "app", "--database-url", "postgres://u2:s3cret@127.0.0.1:55432/shop?sslmode=disable",
            "--setup-key=sk_live_123", "--project", "acme"
        ]);
        expect(text).not.toContain("s3cret");
        expect(text).not.toContain("sk_live_123");
        expect(text).toContain("rebase init app --database-url 'postgres://u2:<password>@127.0.0.1:55432/shop?sslmode=disable' --setup-key='<setup-key>' --project acme --yes");
        // And says what was left out, so the copy is not run as printed.
        expect(text).toMatch(/password.*setup key.*left out/i);
    });
});

describe("initRerunCommand", () => {
    it("quotes what a shell would split or expand", () => {
        expect(initRerunCommand(["node", "rebase", "init", "my app", "--database-url", "postgres://h/db?a=1&b=2"], ["rebase"]).command)
            .toBe("rebase init 'my app' --database-url 'postgres://h/db?a=1&b=2' --yes");
        expect(initRerunCommand(["node", "rebase", "init", "it's"], ["rebase"]).command)
            .toBe("rebase init 'it'\\''s' --yes");
    });

    it("keeps a flag the reader put before the command", () => {
        expect(initRerunCommand(["node", "rebase", "--debug", "init", "app"], ["rebase"]).command)
            .toBe("rebase init --debug app --yes");
    });
});
