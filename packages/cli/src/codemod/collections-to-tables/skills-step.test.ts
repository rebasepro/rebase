/**
 * The migration's last manual step: refresh the agent skills a project holds,
 * which still teach `defineCollection` after the move.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { SKILLS_MANIFEST } from "../../commands/skills";
import { refreshSkillsStep } from "./skills-step";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codemod-skills-"));
    roots.push(root);
    for (const [file, text] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), text);
    }
    return root;
}

describe("the refresh-skills manual step", () => {
    it("is not added to a project with no installed skills, even with a .claude directory", () => {
        expect(refreshSkillsStep(project({ ".claude/settings.json": "{}", ".claude/hooks/post-edit-collection.sh": "" }))).toBeUndefined();
    });

    it("names every agent directory that holds Rebase skills, and the command that replaces them", () => {
        const root = project({
            [`.claude/skills/${SKILLS_MANIFEST}`]: "{}",
            ".claude/skills/rebase-collections/SKILL.md": "defineCollection",
            ".cursor/rules/rebase.mdc": "",
            ".cursor/rules/team.mdc": ""
        });
        const step = refreshSkillsStep(root);
        expect(step?.title).toBe("Refresh the project's agent skills");
        expect(step?.snippet).toBe("rebase skills install --agent cursor,claude");
        expect(step?.detail).toContain(".cursor/rules, .claude/skills hold copies");
        expect(step?.detail).toContain("--force");
    });

    it("finds an install from before skills manifests by its rebase-* entries, for every agent reading that directory", () => {
        expect(refreshSkillsStep(project({ ".agents/skills/rebase-collections/SKILL.md": "" }))?.snippet).toMatch(/^rebase skills install --agent [a-z,]+$/);
    });
});
