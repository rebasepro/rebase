import { describe, expect, it } from "vitest";

import { invokedRebaseCommand } from "./invoked-command";

/**
 * The environments below are the ones the two runners really produce, read off
 * pnpm 11 and npm 12 on macOS: `pnpm dlx` sets the user agent and prepends its
 * cache entry's bin directory but no `npm_command`; `npx` sets all three.
 */
const PNPM_DLX = {
    npm_config_user_agent: "pnpm/11.4.0 npm/? node/v22.23.2 darwin arm64",
    PATH: "/Users/a/Library/Caches/pnpm/dlx/6e522544d6101487f12952e3325d046f371bd6d36338c4a08462b9e9291b74f5/1a1383c92c2-c0e1/node_modules/.bin:/usr/bin:/bin"
};
const NPX = {
    npm_config_user_agent: "npm/12.0.2 node/v22.23.2 darwin arm64 workspaces/false",
    npm_command: "exec",
    PATH: "/Users/a/.npm/_npx/5148b4ef38e78a03/node_modules/.bin:/Users/a/work/node_modules/.bin:/usr/bin"
};

describe("invokedRebaseCommand", () => {
    it("repeats pnpm dlx, at the version that is running", () => {
        expect(invokedRebaseCommand(PNPM_DLX, "0.25.0")).toEqual(["pnpm", "dlx", "@rebasepro/cli@0.25.0"]);
        expect(invokedRebaseCommand(PNPM_DLX, "0.24.1-canary.g19596ef"))
            .toEqual(["pnpm", "dlx", "@rebasepro/cli@0.24.1-canary.g19596ef"]);
    });

    it("repeats npx", () => {
        expect(invokedRebaseCommand(NPX, "0.25.0")).toEqual(["npx", "-y", "@rebasepro/cli@0.25.0"]);
    });

    it("finds a Windows cache directory too", () => {
        const env = {
            npm_config_user_agent: "pnpm/11.4.0 npm/? node/v22.23.2 win32 x64",
            PATH: "C:\\Users\\a\\AppData\\Local\\pnpm-cache\\dlx\\6e52\\1a13-c0e1\\node_modules\\.bin"
        };
        // `path.delimiter` is `:` here, so a one-entry PATH stands in for the list.
        expect(invokedRebaseCommand(env, "0.25.0")[0]).toBe("pnpm");
    });

    it("names the package alone when the version cannot be read", () => {
        expect(invokedRebaseCommand(PNPM_DLX, "unknown")).toEqual(["pnpm", "dlx", "@rebasepro/cli"]);
    });

    it("says rebase for everything else", () => {
        // A global install: no package manager in sight.
        expect(invokedRebaseCommand({ PATH: "/usr/local/bin:/usr/bin" }, "0.25.0")).toEqual(["rebase"]);
        // `pnpm exec rebase` in a project: pnpm, but no dlx cache on PATH.
        expect(invokedRebaseCommand({
            npm_config_user_agent: PNPM_DLX.npm_config_user_agent,
            npm_command: "exec",
            PATH: "/Users/a/work/node_modules/.bin:/usr/bin"
        }, "0.25.0")).toEqual(["rebase"]);
        // A dlx cache on PATH inherited by something npm started is not pnpm dlx.
        expect(invokedRebaseCommand({ ...PNPM_DLX, npm_config_user_agent: NPX.npm_config_user_agent }, "0.25.0"))
            .toEqual(["rebase"]);
        // `npm run` in a project with an npx cache on PATH from further up.
        expect(invokedRebaseCommand({ ...NPX, npm_command: "run-script" }, "0.25.0")).toEqual(["rebase"]);
    });
});
