import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { hasSeenStarNudge, initRepoLine, markStarNudgeSeen, starNudgePath, type StarNudgeContext } from "./star-nudge";

const tty: StarNudgeContext = {
    isTTY: true,
    env: {}
};
const piped: StarNudgeContext = {
    isTTY: false,
    env: {}
};
const ci: StarNudgeContext = {
    isTTY: true,
    env: { CI: "true" }
};

describe("the one-time star line init closes on", () => {
    it("asks for a star the first time a person scaffolds", () => {
        const result = initRepoLine(false, tty);
        expect(result.nudge).toBe(true);
        expect(result.line).toContain("a star helps");
        expect(result.line).toContain("https://github.com/rebasepro/rebase");
    });

    it("prints the plain GitHub link every time after that", () => {
        const result = initRepoLine(true, tty);
        expect(result.nudge).toBe(false);
        expect(result.line).toBe("GitHub: https://github.com/rebasepro/rebase");
    });

    it("does not use up the one showing when nobody is reading", () => {
        expect(initRepoLine(false, piped).nudge).toBe(false);
        expect(initRepoLine(false, ci).nudge).toBe(false);
    });

    it("remembers it was shown, per machine", () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), "star-nudge-"));
        const file = starNudgePath(home);
        expect(hasSeenStarNudge(file)).toBe(false);
        markStarNudgeSeen(file, new Date("2026-11-16T00:00:00Z"));
        expect(hasSeenStarNudge(file)).toBe(true);
        expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ shownAt: "2026-11-16T00:00:00.000Z" });
        fs.rmSync(home, {
            recursive: true,
            force: true
        });
    });
});
