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
 * SKILL.md writes resolves from where that skill's body was installed.
 *
 * The second regression pinned here is the one that made a flat layout
 * expensive. Cursor and Windsurf load their whole rules directory into every
 * request; a rule file per skill meant ~84,000 characters of Rebase reference
 * in front of every question a person asked, whether or not it was about
 * Rebase. Those agents now get one short always-on index and read a body when
 * they need it, so the size of what is always applied is a thing to assert.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installForAgent, loadSkills, renderSkillIndex } from "./skills";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The bundle in this repository — `packages/cli/src/commands` → root. */
const BUNDLE_ROOT = path.resolve(HERE, "../../../../tooling/rebase-agent-skills");
const BUNDLE_SKILLS = path.join(BUNDLE_ROOT, "skills");

/** Where each agent's rule file lands, and what a relative link resolves against. */
const LAYOUTS = {
    claude: { dir: ".claude/skills", index: null },
    gemini: { dir: ".agents/skills", index: null },
    cursor: { dir: ".cursor/rules", index: "rebase.mdc" },
    windsurf: { dir: ".windsurf/rules", index: "rebase.md" },
    codex: { dir: ".codex/skills", index: null },
    kiro: { dir: ".kiro/steering", index: "rebase.md" },
    copilot: { dir: ".github/instructions", index: "rebase.instructions.md" }
} as const;

/** Every layout writes the body at `<skill>/SKILL.md` under its target dir. */
const bodyOf = (s: string) => `${s}/SKILL.md`;

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
        it(`leaves every reference link in the installed ${agent} skill resolvable`, () => {
            const skills = loadSkills(fixture());
            const project = path.join(scratch, `project-${agent}`);
            fs.mkdirSync(project, { recursive: true });

            const result = installForAgent(agent as keyof typeof LAYOUTS, skills, project);
            expect(result).toEqual({ skills: 2, assets: 1 });

            const bodyPath = path.join(project, layout.dir, bodyOf("demo-skill"));
            const installed = fs.readFileSync(bodyPath, "utf-8");

            const links = [...installed.matchAll(/`([^`]*references\/[^`]+)`/g)].map(m => m[1]);
            expect(links.length).toBeGreaterThan(0);
            for (const link of links) {
                expect(fs.existsSync(path.resolve(path.dirname(bodyPath), link))).toBe(true);
            }
        });

        it(`installs no oversized always-applied rule for ${agent}`, () => {
            const skills = loadSkills(fixture());
            const project = path.join(scratch, `project-size-${agent}`);
            fs.mkdirSync(project, { recursive: true });
            installForAgent(agent as keyof typeof LAYOUTS, skills, project);

            const base = path.join(project, layout.dir);
            const topLevel = fs.readdirSync(base, { withFileTypes: true }).filter(e => e.isFile());
            if (layout.index) {
                // Exactly one file at the top level: the index. Everything a
                // flat-layout agent loads unconditionally is that one file.
                expect(topLevel.map(e => e.name)).toEqual([layout.index]);
            } else {
                expect(topLevel).toEqual([]);
            }
            for (const entry of topLevel) {
                expect(fs.readFileSync(path.join(base, entry.name), "utf-8").length).toBeLessThan(8000);
            }
        });
    }
});

describe("renderSkillIndex", () => {
    it("names every skill, and where to read it", () => {
        const skills = loadSkills(BUNDLE_SKILLS);
        const index = renderSkillIndex(skills, "cursor");
        for (const skill of skills) {
            expect(index).toContain(`\`${skill.name}\``);
            expect(index).toContain(`${skill.name}/SKILL.md`);
        }
    });

    it("stays small enough to be worth applying always", () => {
        // The whole point: this is what replaces ~84,000 characters of
        // always-on rules. A version of it that grew past a few thousand would
        // be the same problem with an extra step.
        const index = renderSkillIndex(loadSkills(BUNDLE_SKILLS), "cursor");
        expect(index).toContain("alwaysApply: true");
        expect(index.length).toBeLessThan(8000);
    });

    it("summarises each skill from its own front matter", () => {
        const skills = loadSkills(fixture());
        // The fixture's skills have no front matter, so the fallback is the
        // skill name — never an empty cell.
        const index = renderSkillIndex(skills, "windsurf");
        expect(index).toContain("| `demo-skill` | demo skill |");
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

/**
 * What an npm consumer receives, as opposed to what a workspace checkout has.
 *
 * Every test above this point reads the bundle through the filesystem, which in
 * this repository is the source directory itself. That is not what a user
 * installs. `@rebasepro/agent-skills` publishes `files: ["skills/"]`, so
 * anything a skill grows *outside* that directory — and any edit to `files`
 * itself — is dropped at pack time while every assertion above stays green.
 *
 * This is a bug class the repository has already paid for once, in
 * `@rebasepro/client-postgres`: `files` did not list `src`, the package
 * published without the file its own `bin` pointed at, and nothing failed until
 * a stranger installed it. The installer reads `SKILL.md` and every asset
 * beside it, so those are exactly the files the tarball has to contain.
 */
describe("the published tarball", () => {
    /** Paths `npm pack` would ship, relative to the package root. */
    function packedFiles(): Set<string> {
        const out = execFileSync("npm", ["pack", "--dry-run", "--json"], {
            cwd: BUNDLE_ROOT,
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "ignore"]
        });
        // npm 12 changed this payload: up to npm 11 `pack --json` answered an
        // ARRAY of package entries, and from 12 it answers an OBJECT keyed by
        // package name. Reading only the array form made this test fail with
        // "object is not iterable" the moment npm was upgraded — a failure that
        // names nothing about the tarball it is checking. Accept both.
        const parsed = JSON.parse(out) as
            | { files: { path: string }[] }[]
            | Record<string, { files: { path: string }[] }>;
        const entry = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
        return new Set(entry.files.map(f => f.path.split(path.sep).join("/")));
    }

    it("contains every file the installer reads", { timeout: 60_000 }, () => {
        const packed = packedFiles();
        const skills = loadSkills(BUNDLE_SKILLS);
        expect(skills.length).toBeGreaterThan(0);

        const missing: string[] = [];
        for (const skill of skills) {
            const wanted = ["SKILL.md", ...skill.assets];
            for (const rel of wanted) {
                const posix = `skills/${skill.name}/${rel.split(path.sep).join("/")}`;
                if (!packed.has(posix)) missing.push(posix);
            }
        }
        expect(missing).toEqual([]);
    });
});

/**
 * The package's own export map, against the paths it promises.
 *
 * `exports` said `"./skills": "./skills/"` — a trailing-slash directory export.
 * Node deprecated that form (DEP0166) and never let it reach a file: resolving
 * `@rebasepro/agent-skills/skills/rebase-basics/SKILL.md` threw
 * `ERR_PACKAGE_PATH_NOT_EXPORTED`, so the one thing the subpath existed to do
 * was the one thing it could not do. The CLI installer never noticed, because
 * it resolves `package.json` and joins `skills` onto the directory — which is
 * why this needs its own test rather than falling out of an install.
 */
describe("the package export map", () => {
    const manifest = JSON.parse(
        fs.readFileSync(path.join(BUNDLE_ROOT, "package.json"), "utf-8")
    ) as { exports: Record<string, string> };

    it("has no trailing-slash directory export", () => {
        const deprecated = Object.entries(manifest.exports)
            .filter(([, target]) => target.endsWith("/"))
            .map(([subpath]) => subpath);
        expect(deprecated).toEqual([]);
    });

    it("resolves a real SKILL.md through the package specifier", async () => {
        const skills = loadSkills(BUNDLE_SKILLS);
        const name = skills[0].name;
        const resolved = import.meta.resolve(`@rebasepro/agent-skills/skills/${name}/SKILL.md`);
        expect(fs.existsSync(fileURLToPath(resolved))).toBe(true);
    });

    it("still resolves the package.json the installer locates the bundle by", () => {
        const resolved = import.meta.resolve("@rebasepro/agent-skills/package.json");
        expect(fs.existsSync(fileURLToPath(resolved))).toBe(true);
    });
});

/**
 * Skill frontmatter, which is how an agent addresses a skill at all.
 *
 * Claude Code and the Gemini CLI register a skill under the `name` in its
 * frontmatter, while the installer writes it to a directory named after the
 * *source directory*. When those disagree the skill installs, reports success,
 * and is then invoked — or not — under a name that does not match where it
 * lives. `description` is the only thing an agent reads before deciding whether
 * to load a skill, so an empty one makes the skill dead weight.
 */
describe("skill frontmatter", () => {
    /** The frontmatter keys, tolerant of `key: |` block scalars. */
    function frontmatter(content: string): Record<string, string> {
        const match = /^---\n([\s\S]*?)\n---/.exec(content);
        if (!match) return {};
        const fields: Record<string, string> = {};
        let key: string | null = null;
        for (const line of match[1].split("\n")) {
            const start = /^([A-Za-z][\w-]*):[ \t]*(.*)$/.exec(line);
            if (start) {
                key = start[1];
                fields[key] = start[2] === "|" || start[2] === ">" ? "" : start[2].trim();
            } else if (key && line.trim()) {
                fields[key] = `${fields[key]} ${line.trim()}`.trim();
            }
        }
        return fields;
    }

    const skills = loadSkills(BUNDLE_SKILLS);

    it("finds the bundle", () => {
        expect(skills.length).toBeGreaterThan(0);
    });

    it("names every skill after the directory it installs into", () => {
        const mismatched = skills
            .filter(s => frontmatter(s.content).name !== s.name)
            .map(s => `${s.name}: name=${JSON.stringify(frontmatter(s.content).name)}`);
        expect(mismatched).toEqual([]);
    });

    it("gives every skill a description an agent can select on", () => {
        const empty = skills
            .filter(s => (frontmatter(s.content).description ?? "").length < 20)
            .map(s => s.name);
        expect(empty).toEqual([]);
    });
});
