/**
 * `rebase skills install` — what actually reaches the target project.
 *
 * The regression this pins is quiet by construction: the installer used to read
 * exactly `<skill>/SKILL.md` and nothing else, so every `references/` file the
 * Agent Skills format uses for progressive disclosure was dropped on the floor.
 * Nothing failed — the skill installed, and only the agent following its
 * instructions found out, at which point the skill's own advice ("extend an
 * existing pattern; do not invent a layout") was unfollowable.
 *
 * So the assertion is not "assets are copied somewhere". It is that a link a
 * SKILL.md writes resolves, from where that agent's rule file was installed —
 * which differs between the subdirectory layouts (Claude, Gemini) and the flat
 * ones (Cursor, Windsurf).
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installForAgent, loadSkills, rewriteAssetLinks } from "./skills";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The bundle in this repository — `packages/cli/src/commands` → root. */
const BUNDLE_SKILLS = path.resolve(HERE, "../../../../rebase-agent-skills/skills");

/** Where each agent's rule file lands, and what a relative link resolves against. */
const LAYOUTS = {
    claude: { dir: ".claude/skills", ruleFile: (s: string) => `${s}/SKILL.md` },
    gemini: { dir: ".agents/skills", ruleFile: (s: string) => `${s}/SKILL.md` },
    cursor: { dir: ".cursor/rules", ruleFile: (s: string) => `${s}.mdc` },
    windsurf: { dir: ".windsurf/rules", ruleFile: (s: string) => `${s}.md` }
} as const;

let scratch: string;

beforeEach(() => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-skills-")));
});

afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
});

/** Build a source tree of skills without depending on the bundle's contents. */
function fixture(): string {
    const src = path.join(scratch, "src-skills");
    fs.mkdirSync(path.join(src, "demo-skill", "references"), { recursive: true });
    fs.writeFileSync(
        path.join(src, "demo-skill", "SKILL.md"),
        "# Demo\n\nRead `references/view-patterns.md` and copy the closest skeleton.\n"
    );
    fs.writeFileSync(path.join(src, "demo-skill", "references", "view-patterns.md"), "# Patterns\n");
    // An empty `references/` held open by .gitkeep must not install anything.
    fs.mkdirSync(path.join(src, "empty-skill", "references"), { recursive: true });
    fs.writeFileSync(path.join(src, "empty-skill", "SKILL.md"), "# Empty\n");
    fs.writeFileSync(path.join(src, "empty-skill", "references", ".gitkeep"), "");
    return src;
}

describe("loadSkills", () => {
    it("carries a skill's reference files alongside its SKILL.md", () => {
        const skills = loadSkills(fixture());
        const demo = skills.find(s => s.name === "demo-skill");
        expect(demo?.assets).toEqual([path.join("references", "view-patterns.md")]);
    });

    it("does not treat .gitkeep as an asset", () => {
        const skills = loadSkills(fixture());
        expect(skills.find(s => s.name === "empty-skill")?.assets).toEqual([]);
    });
});

describe("installForAgent", () => {
    for (const [agent, layout] of Object.entries(LAYOUTS)) {
        it(`leaves every reference link in the installed ${agent} rule file resolvable`, () => {
            const skills = loadSkills(fixture());
            const project = path.join(scratch, `project-${agent}`);
            fs.mkdirSync(project, { recursive: true });

            const result = installForAgent(agent as keyof typeof LAYOUTS, skills, project);
            expect(result).toEqual({ skills: 2, assets: 1 });

            const rulePath = path.join(project, layout.dir, layout.ruleFile("demo-skill"));
            const installed = fs.readFileSync(rulePath, "utf-8");

            const links = [...installed.matchAll(/`([^`]*references\/[^`]+)`/g)].map(m => m[1]);
            expect(links.length).toBeGreaterThan(0);
            for (const link of links) {
                expect(fs.existsSync(path.resolve(path.dirname(rulePath), link))).toBe(true);
            }
        });
    }
});

describe("rewriteAssetLinks", () => {
    it("only rewrites paths that name a file the skill ships", () => {
        const out = rewriteAssetLinks(
            "see references/a.md, but references/ghost.md is prose",
            [path.join("references", "a.md")],
            "demo"
        );
        expect(out).toBe("see demo/references/a.md, but references/ghost.md is prose");
    });

    it("does not rewrite a path that is already qualified", () => {
        const out = rewriteAssetLinks("skills/references/a.md", [path.join("references", "a.md")], "demo");
        expect(out).toBe("skills/references/a.md");
    });
});

describe("the bundle in this repository", () => {
    it("ships every references/ file its skills tell an agent to read", () => {
        const skills = loadSkills(BUNDLE_SKILLS);
        expect(skills.length).toBeGreaterThan(0);

        const missing: string[] = [];
        for (const skill of skills) {
            for (const m of skill.content.matchAll(/`(references\/[A-Za-z0-9._/-]+)`/g)) {
                if (!fs.existsSync(path.join(skill.dir, m[1]))) missing.push(`${skill.name}: ${m[1]}`);
            }
        }
        expect(missing).toEqual([]);
    });
});
