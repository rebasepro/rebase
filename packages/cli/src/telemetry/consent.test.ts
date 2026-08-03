import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import inquirer from "inquirer";

/**
 * The consent mechanism.
 *
 * The file that implements asking had no tests, which is the wrong file in this
 * subsystem to leave uncovered — everything else is only defensible if the
 * question is asked honestly and its answer is recorded faithfully.
 *
 * The properties that matter:
 *
 *  - We ask **only** when nobody has answered, and only into a terminal.
 *  - The preview shown is built by the same function the sender uses, so it
 *    cannot become a comfortable fiction.
 *  - A prompt that fails is a decline that is **not persisted** — the user
 *    never saw the question, so they should still get to answer it another day.
 */

let home: string;
let previousHome: string | undefined;
let previousTTY: PropertyDescriptor | undefined;

function setTTY(value: boolean) {
    Object.defineProperty(process.stdin, "isTTY", { value,
configurable: true });
}

beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-consent-"));
    previousHome = process.env.HOME;
    process.env.HOME = home;
    vi.spyOn(os, "homedir").mockReturnValue(home);
    vi.resetModules();
    delete process.env.DO_NOT_TRACK;
    delete process.env.REBASE_TELEMETRY_DISABLED;
    delete process.env.CI;
    previousTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    setTTY(true);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousTTY) Object.defineProperty(process.stdin, "isTTY", previousTTY);
    fs.rmSync(home, { recursive: true,
force: true });
});

async function load() {
    return {
        consent: await import("./consent"),
        telemetry: await import("./index")
    };
}

describe("shouldPrompt", () => {

    it("asks when nobody has answered and we have a terminal", async () => {
        const { consent } = await load();
        expect(consent.shouldPrompt()).toBe(true);
    });

    it("never asks twice — a recorded yes is an answer", async () => {
        const { consent, telemetry } = await load();
        telemetry.setConsent(true);
        expect(consent.shouldPrompt()).toBe(false);
    });

    it("never re-asks someone who declined", async () => {
        // The property that stops this becoming nagware, which is how people
        // learn to accept reflexively.
        const { consent, telemetry } = await load();
        telemetry.setConsent(false);
        expect(consent.shouldPrompt()).toBe(false);
    });

    it("does not ask without a terminal, so a piped run never blocks", async () => {
        const { consent } = await load();
        setTTY(false);
        expect(consent.shouldPrompt()).toBe(false);
    });

    it("does not ask someone who set DO_NOT_TRACK — they already answered", async () => {
        const { consent } = await load();
        process.env.DO_NOT_TRACK = "1";
        expect(consent.shouldPrompt()).toBe(false);
    });

    it("does not ask on CI", async () => {
        const { consent } = await load();
        process.env.CI = "true";
        expect(consent.shouldPrompt()).toBe(false);
    });
});

describe("promptForConsent", () => {

    it("records a yes and reports it", async () => {
        const { consent, telemetry } = await load();
        vi.spyOn(inquirer, "prompt").mockResolvedValue({ accepted: true } as never);

        await expect(consent.promptForConsent("cli.init", { preset: "blog" })).resolves.toBe(true);
        expect(telemetry.readConfig().enabled).toBe(true);
        expect(telemetry.readConfig().machineId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("records a no, and mints no id", async () => {
        const { consent, telemetry } = await load();
        vi.spyOn(inquirer, "prompt").mockResolvedValue({ accepted: false } as never);

        await expect(consent.promptForConsent("cli.init", {})).resolves.toBe(false);
        expect(telemetry.readConfig().enabled).toBe(false);
        expect(telemetry.readConfig().machineId).toBeUndefined();
    });

    it("defaults to no, so a bare Enter does not enrol anyone", async () => {
        const { consent } = await load();
        const promptSpy = vi.spyOn(inquirer, "prompt").mockResolvedValue({ accepted: false } as never);

        await consent.promptForConsent("cli.init", {});

        const questions = promptSpy.mock.calls[0][0] as unknown as Array<{ default: unknown }>;
        expect(questions[0].default).toBe(false);
    });

    it("does not persist anything when the prompt itself fails", async () => {
        // Stdin went away mid-question. The user never saw it, so they must
        // still get to answer another day rather than being silently recorded
        // as having declined.
        const { consent, telemetry } = await load();
        vi.spyOn(inquirer, "prompt").mockRejectedValue(new Error("stdin closed"));

        await expect(consent.promptForConsent("cli.init", {})).resolves.toBe(false);
        expect(telemetry.readConfig().enabled).toBeUndefined();
        expect(fs.existsSync(telemetry.configPath())).toBe(false);
    });

    it("asks nothing, and writes nothing, when it must not ask", async () => {
        const { consent, telemetry } = await load();
        const promptSpy = vi.spyOn(inquirer, "prompt");
        setTTY(false);

        await expect(consent.promptForConsent("cli.init", {})).resolves.toBe(false);
        expect(promptSpy).not.toHaveBeenCalled();
        expect(fs.existsSync(telemetry.configPath())).toBe(false);
    });
});

describe("renderPreview", () => {

    it("shows the real payload shape, with placeholder ids", async () => {
        const { consent } = await load();
        const preview = JSON.parse(consent.renderPreview("cli.init", { preset: "blog",
headless: false }));

        expect(preview.event).toBe("cli.init");
        expect(preview.properties).toEqual({ preset: "blog",
headless: false });
        // The ids are described rather than generated — nothing exists yet.
        expect(preview.machineId).toMatch(/random uuid/);
    });

    it("shows values already reduced, so the preview cannot promise more than is sent", async () => {
        // If the preview showed a path and the sender dropped it, the preview
        // would be lying in the user's favour — but it would still be lying,
        // and the next change could make it lie the other way.
        const { consent } = await load();
        const preview = JSON.parse(consent.renderPreview("cli.error", {
            command: "dev",
            project_path: "/Users/francesco/clients/acme"
        }));

        expect(preview.properties).toEqual({ command: "dev" });
    });
});

describe("describeState", () => {

    it("explains every reason it could be off", async () => {
        const { consent, telemetry } = await load();

        expect(consent.describeState()).toMatch(/not configured/);

        telemetry.setConsent(false);
        expect(consent.describeState()).toMatch(/declined/);

        telemetry.setConsent(true);
        expect(consent.describeState()).toMatch(/enabled/);

        process.env.CI = "true";
        expect(consent.describeState()).toMatch(/CI/);
        delete process.env.CI;

        process.env.DO_NOT_TRACK = "1";
        expect(consent.describeState()).toMatch(/DO_NOT_TRACK/);
        delete process.env.DO_NOT_TRACK;

        process.env.REBASE_TELEMETRY_DISABLED = "1";
        expect(consent.describeState()).toMatch(/REBASE_TELEMETRY_DISABLED/);
    });

    it("names the project when a repository is what switched it off", async () => {
        const { consent, telemetry } = await load();
        telemetry.setConsent(true);

        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-proj-"));
        fs.writeFileSync(path.join(dir, "rebase.json"), '{"rebase":"^1","apps":{},"telemetry":false}', "utf-8");
        const previousCwd = process.cwd();
        try {
            process.chdir(dir);
            expect(consent.describeState()).toMatch(/rebase\.json/);
        } finally {
            process.chdir(previousCwd);
            fs.rmSync(dir, { recursive: true,
force: true });
        }
    });
});
