/**
 * `rebase cloud env set KEY --prompt`: the value is typed at a hidden prompt on
 * this terminal, so an agent can hand a person the command and the secret never
 * passes through the chat, the command line or the shell history.
 *
 * Pinned: the prompt hides what is typed (no mask, nothing echoed) and is
 * written to stderr; the value is stored as a secret, as `--stdin --secret`
 * stores it; it is asked for only after the project and key are accepted; and
 * without a terminal it refuses before anything is sent, pointing at `--stdin`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./context", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./context")>();
    return {
        ...actual,
        requireClient: vi.fn(),
        requireProject: vi.fn(async () => "proj_1"),
        displayProjectRef: vi.fn(() => "shop")
    };
});

const asked: Array<{ questions: unknown; output: unknown }> = [];
let typed = "sk_live_typed";
vi.mock("inquirer", () => ({
    default: {
        createPromptModule: (opts: { output?: unknown }) => async (questions: unknown) => {
            asked.push({ questions, output: opts.output });
            return { value: typed };
        }
    }
}));

import * as context from "./context";
import { fakeCloudClient } from "../../../test/helpers/cloud-client";
import { envCommand, envKeyForPrompt, envValueFromPrompt } from "./env";

class Exited extends Error {
    constructor(readonly code: number) {
        super(`process.exit(${code})`);
    }
}

const invoke = vi.fn(async (_name: string, body: unknown) => ({
    success: true,
    var: { key: (body as { key: string }).key, secret: (body as { secret?: boolean }).secret === true, valueSet: true },
    pendingRedeploy: true
}));

let stdout: string[];
let savedIsTTY: boolean | undefined;

beforeEach(() => {
    vi.clearAllMocks();
    asked.length = 0;
    typed = "sk_live_typed";
    stdout = [];
    savedIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = true;
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string) => {
        stdout.push(String(chunk));
        return true;
    }) as typeof process.stdout.write);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((code) => {
        throw new Exited(Number(code ?? 0));
    });
    vi.mocked(context.requireClient).mockResolvedValue({ client: fakeCloudClient({ invoke }), url: "https://cp.example" });
    context.setJsonModeForTest(true);
});

afterEach(() => {
    process.stdin.isTTY = savedIsTTY as boolean;
    context.setJsonModeForTest(false);
    vi.restoreAllMocks();
    invoke.mockClear();
});

const set = (...words: string[]) => envCommand("set", ["node", "rebase", "cloud", "env", "set", ...words]);
const out = () => JSON.parse(stdout.join(""));

describe("env set --prompt", () => {
    it("stores the typed value as a secret, and never prints it", async () => {
        await set("STRIPE_KEY", "--prompt");

        expect(invoke.mock.calls).toEqual([["env-vars", { key: "STRIPE_KEY", value: "sk_live_typed", secret: true }, { path: "proj_1" }]]);
        expect(stdout.join("")).not.toContain("sk_live_typed");
        expect(out()).toMatchObject({ success: true, key: "STRIPE_KEY", secret: true });
    });

    it("asks with a hidden prompt on stderr: no mask, nothing echoed", async () => {
        await set("--prompt", "DATABASE_URL");

        expect(asked).toHaveLength(1);
        expect(asked[0].output).toBe(process.stderr);
        const [question] = asked[0].questions as Array<Record<string, unknown>>;
        expect(question).toMatchObject({ type: "password", name: "value" });
        expect(question.mask).toBeUndefined();
        expect(String(question.message)).toContain("DATABASE_URL");
    });

    it("sets a preview's own secret with --preview", async () => {
        await set("STRIPE_KEY", "--prompt", "--preview");

        expect(invoke.mock.calls[0]).toEqual(["previews", { key: "STRIPE_KEY", value: "sk_live_typed", secret: true }, { method: "POST", path: "proj_1/env" }]);
    });

    it("refuses without a terminal before asking or sending anything, and points at --stdin", async () => {
        process.stdin.isTTY = false;

        await expect(set("STRIPE_KEY", "--prompt")).rejects.toMatchObject({ code: 1 });

        expect(asked).toEqual([]);
        expect(invoke).not.toHaveBeenCalled();
        expect(context.requireClient).not.toHaveBeenCalled();
        const error = out().error;
        expect(error.code).toBe("input_required");
        expect(error.hint).toContain("--stdin");
    });

    it("refuses a build-time key before the value is typed", async () => {
        await expect(set("VITE_API_URL", "--prompt")).rejects.toMatchObject({ code: 1 });

        expect(asked).toEqual([]);
        expect(out().error.code).toBe("build_time_variable");
    });
});

describe("envKeyForPrompt", () => {
    it.each([
        [["K=v"], {}, "usage"],
        [["K", "v"], {}, "usage"],
        [[], {}, "usage"],
        [["K"], { "--stdin": true }, "usage"]
    ])("refuses %j %j", (operands, flags, code) => {
        expect(() => envKeyForPrompt(operands, flags, true)).toThrow(Exited);
        expect(out().error.code).toBe(code);
    });

    it("names the key on a terminal", () => {
        expect(envKeyForPrompt([" STRIPE_KEY "], {}, true)).toBe("STRIPE_KEY");
    });
});

describe("envValueFromPrompt", () => {
    it("returns what the injected prompt was typed", async () => {
        const ask = vi.fn(async () => "typed value");
        expect(await envValueFromPrompt("K", ask)).toEqual({ key: "K", value: "typed value" });
        expect(ask).toHaveBeenCalledWith(expect.stringContaining("K"));
    });
});
