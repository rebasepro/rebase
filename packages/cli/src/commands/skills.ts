import chalk from "chalk";
import fs from "fs";
import path from "path";
import inquirer from "inquirer";
import { createRequire } from "module";
import { findProjectRoot } from "../utils/project";
import { wantsHelp } from "../utils/args";
import { unknownCommand } from "../utils/unknown-command";

const require = createRequire(import.meta.url);

/**
 * Supported agent environments and their target directories.
 *
 * Every agent `rebase init` writes a pointer file for has an entry here. That
 * was not true: `rebase init` writes `CLAUDE.md`, `AGENTS.md`, `.cursorrules`,
 * `.windsurfrules` and `.github/copilot-instructions.md`, and the installer
 * covered four of the five — so a Codex or Copilot user was told, by a file in
 * their own repository, to run an installer that had nothing to offer them.
 *
 * `flatLayout` marks the agents whose rules directory is loaded *whole*, into
 * every request. Writing 21 skills there put ~84,000 characters of always-on
 * context in front of every question a person asked Cursor — more than the task
 * itself, on every turn, most of it about parts of Rebase they were not
 * touching. Those agents get one short index rule instead, and the skill bodies
 * go in per-skill subdirectories the index names, which the agent reads when it
 * needs one. `indexFile` is the name of that rule.
 *
 * A subdirectory layout has no such problem: the rule file already sits beside
 * its own assets, so `references/x.md` resolves as written and nothing is
 * loaded until it is opened.
 */
const AGENTS = {
    cursor: {
        label: "Cursor",
        detectDir: ".cursor",
        targetDir: ".cursor/rules",
        flatLayout: true,
        indexFile: "rebase.mdc",
        /** The body is not a rule file here — `indexFile` is. */
        transformFile: (skillName: string, content: string) => ({
            fileName: path.join(skillName, "SKILL.md"),
            content
        })
    },
    claude: {
        label: "Claude Code",
        detectDir: ".claude",
        targetDir: ".claude/skills",
        flatLayout: false,
        /** Claude Code uses the standard SKILL.md format in subdirectories. */
        transformFile: (skillName: string, content: string) => ({
            fileName: path.join(skillName, "SKILL.md"),
            content
        })
    },
    windsurf: {
        label: "Windsurf",
        detectDir: ".windsurf",
        targetDir: ".windsurf/rules",
        flatLayout: true,
        indexFile: "rebase.md",
        /** The body is not a rule file here — `indexFile` is. */
        transformFile: (skillName: string, content: string) => ({
            fileName: path.join(skillName, "SKILL.md"),
            content
        })
    },
    gemini: {
        label: "Gemini CLI / Antigravity",
        detectDir: ".agents",
        targetDir: ".agents/skills",
        flatLayout: false,
        /** Gemini uses the standard SKILL.md format in subdirectories. */
        transformFile: (skillName: string, content: string) => ({
            fileName: path.join(skillName, "SKILL.md"),
            content
        })
    },
    codex: {
        label: "Codex CLI",
        detectDir: ".codex",
        targetDir: ".codex/skills",
        flatLayout: false,
        /** Codex reads AGENTS.md; the skills sit beside its own config. */
        transformFile: (skillName: string, content: string) => ({
            fileName: path.join(skillName, "SKILL.md"),
            content
        })
    },
    kiro: {
        label: "Kiro",
        detectDir: ".kiro",
        targetDir: ".kiro/steering",
        flatLayout: true,
        indexFile: "rebase.md",
        /** The body is not a rule file here — `indexFile` is. */
        transformFile: (skillName: string, content: string) => ({
            fileName: path.join(skillName, "SKILL.md"),
            content
        })
    },
    copilot: {
        label: "GitHub Copilot",
        // Deliberately undetectable. `.github/` is the one directory in this
        // table that is not evidence of an assistant: `rebase init` writes
        // `.github/copilot-instructions.md` into every scaffold, and half the
        // repositories on the internet have a `.github/` for workflows and
        // issue templates. Listing it made bare `rebase skills install` resolve
        // to `[copilot]` in every project — so a Claude Code user who ran the
        // command `rebase init` printed got a success message and nothing in
        // `.claude/skills`. Copilot is `--agent copilot`.
        detectDir: null,
        targetDir: ".github/instructions",
        flatLayout: true,
        indexFile: "rebase.instructions.md",
        /** The body is not a rule file here — `indexFile` is. */
        transformFile: (skillName: string, content: string) => ({
            fileName: path.join(skillName, "SKILL.md"),
            content
        })
    }
} as const;

type AgentKey = keyof typeof AGENTS;

/**
 * Resolve the path to the skills directory from @rebasepro/agent-skills.
 * Works in both workspace (symlink) and published (real files) layouts.
 */
function getSkillsSourceDir(): string {
    const pkgJsonPath = require.resolve("@rebasepro/agent-skills/package.json");
    const pkgRoot = path.dirname(pkgJsonPath);
    const skillsDir = path.join(pkgRoot, "skills");

    if (!fs.existsSync(skillsDir)) {
        throw new Error(
            `Skills directory not found at ${skillsDir}. ` +
            "Make sure @rebasepro/agent-skills is installed."
        );
    }

    return skillsDir;
}

export interface LoadedSkill {
    name: string;
    /** Absolute path of the skill's source directory. */
    dir: string;
    content: string;
    /** Every file the skill ships besides SKILL.md, relative to `dir`. */
    assets: string[];
}

/**
 * Everything a skill ships alongside its SKILL.md — the `references/` tree the
 * Agent Skills format uses for progressive disclosure.
 *
 * These used to be dropped on install, because the installer read exactly
 * `<skill>/SKILL.md` and nothing else. That left `rebase-design-language`
 * telling the agent three separate times to read `references/view-patterns.md`
 * — 379 lines of view skeletons — in a project where the file had never
 * landed, and the instruction it carries is "extend an existing pattern; do not
 * invent a layout".
 */
function loadSkillAssets(skillDir: string): string[] {
    const found: string[] = [];

    const walk = (dir: string, prefix: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            // Dotfiles are bookkeeping — `.gitkeep` is what holds the empty
            // `references/` directories in git — and install nothing.
            if (entry.name.startsWith(".")) continue;
            const rel = prefix ? path.join(prefix, entry.name) : entry.name;
            if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
            else if (rel !== "SKILL.md") found.push(rel);
        }
    };

    walk(skillDir, "");
    return found.sort();
}

/** Read all skill directories and return their names, content and assets. */
export function loadSkills(skillsDir: string): LoadedSkill[] {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    const skills: LoadedSkill[] = [];

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillDir = path.join(skillsDir, entry.name);
        const skillMdPath = path.join(skillDir, "SKILL.md");
        if (!fs.existsSync(skillMdPath)) continue;
        skills.push({
            name: entry.name,
            dir: skillDir,
            content: fs.readFileSync(skillMdPath, "utf-8"),
            assets: loadSkillAssets(skillDir)
        });
    }

    return skills;
}

/**
 * The one always-on rule a flat-layout agent gets, in place of every skill.
 *
 * Cursor and Windsurf load their whole rules directory into each request. With
 * a rule file per skill that was ~84,000 characters of Rebase reference in
 * front of every question, whether or not the question was about Rebase — and
 * an instruction an assistant skims is an instruction it does not follow.
 *
 * So the always-on part is this: a table of what exists and where to read it.
 * `alwaysApply: true` because knowing the skills are there costs a few hundred
 * characters and is the whole point; the bodies stay on disk until the agent
 * opens one.
 */
export function renderSkillIndex(skills: LoadedSkill[], agentKey: AgentKey): string {
    const agent = AGENTS[agentKey];
    const bodyPath = (name: string) => agent.transformFile(name, "").fileName.split(path.sep).join("/");
    const rows = skills
        .map((skill) => `| \`${skill.name}\` | ${describe(skill)} | \`${bodyPath(skill.name)}\` |`)
        .join("\n");

    return [
        "---",
        "description: Rebase — the skills index. Read the file named for the task before writing Rebase code.",
        "alwaysApply: true",
        "---",
        "",
        "# Rebase skills",
        "",
        `This project uses [Rebase](https://rebase.pro). ${skills.length} reference skills are`,
        "installed beside this file. **Read the one that covers the task before writing",
        "code** — they are the difference between a collection that compiles and one that",
        "does not.",
        "",
        "| Skill | Covers | Read |",
        "|---|---|---|",
        rows,
        "",
        "Start with `rebase-basics` if you are not sure: it opens with the recipes for",
        "adding a collection, a function and an RLS rule, and names the commands.",
        ""
    ].join("\n");
}

/**
 * A skill's one-line summary, from its own front matter.
 *
 * Read rather than written here so a new skill needs no edit in this file, and
 * truncated because the index is only worth having while it stays short.
 */
function describe(skill: LoadedSkill): string {
    const described = /^description:\s*(.+)$/m.exec(skill.content.split("---")[1] ?? "");
    const text = (described?.[1] ?? "").trim().replace(/\|/g, "\\|");
    const firstSentence = /^.*?\.(?:\s|$)/.exec(text)?.[0]?.trim() ?? text;
    const fallback = skill.name.replace(/^rebase-/, "").replace(/-/g, " ");
    if (!firstSentence) return fallback;
    if (firstSentence.length <= 140) return firstSentence;
    // Cut at a word boundary. A description sliced mid-word ("using the collect")
    // reads as a corrupted file rather than as a summary.
    const cut = firstSentence.slice(0, 140);
    return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:]$/, "")}…`;
}

/**
 * Detect which agent environments already exist in the project.
 *
 * A `detectDir` has to be evidence *the user* created, not something a scaffold
 * ships. An agent whose only marker fails that test declares `detectDir: null`
 * and is reachable by `--agent` alone; guessing wrong here is worse than not
 * guessing, because the wrong guess installs 21 files and reports success.
 */
export function detectAgents(projectDir: string): AgentKey[] {
    const detected: AgentKey[] = [];
    for (const [key, agent] of Object.entries(AGENTS)) {
        if (!agent.detectDir) continue;
        if (fs.existsSync(path.join(projectDir, agent.detectDir))) {
            detected.push(key as AgentKey);
        }
    }
    return detected;
}

/** Install skills for a specific agent into the project directory. */
export function installForAgent(
    agentKey: AgentKey,
    skills: LoadedSkill[],
    projectDir: string
): { skills: number; assets: number } {
    const agent = AGENTS[agentKey];
    const targetBase = path.join(projectDir, agent.targetDir);

    // Ensure the target directory exists
    fs.mkdirSync(targetBase, { recursive: true });

    let count = 0;
    let assetCount = 0;
    for (const skill of skills) {
        // Every layout now writes the body into a per-skill subdirectory, so a
        // link the skill spells `references/x.md` resolves as written and no
        // rewriting is needed. What differs is whether that file is also the
        // agent's *rule* file (subdirectory layouts) or something the index
        // points at (flat ones).
        const { fileName, content } = agent.transformFile(skill.name, skill.content);
        const targetPath = path.join(targetBase, fileName);

        // Ensure parent directory exists (for subdirectory-based formats)
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, content, "utf-8");
        count++;

        // A skill's assets always land in a directory named after the skill,
        // whatever the rule file's layout, so two skills' `references/` trees
        // cannot collide in a flat target directory.
        for (const asset of skill.assets) {
            const assetTarget = path.join(targetBase, skill.name, asset);
            fs.mkdirSync(path.dirname(assetTarget), { recursive: true });
            fs.copyFileSync(path.join(skill.dir, asset), assetTarget);
            assetCount++;
        }
    }

    if (agent.flatLayout && agent.indexFile) {
        fs.writeFileSync(path.join(targetBase, agent.indexFile), renderSkillIndex(skills, agentKey), "utf-8");
    }

    return { skills: count, assets: assetCount };
}

/** Everything the switch below dispatches, for the did-you-mean. */
const SKILLS_SUBCOMMANDS = ["install"] as const;

export async function skillsCommand(subcommand: string | undefined, rawArgs: string[]) {
    // `--help` cannot reach `skillsInstall`. `cli.ts` only rewrites the
    // subcommand to `"--help"` when none was named, so `rebase skills install
    // --help` used to run the install: it detected the agents and overwrote
    // `.claude/skills/*/SKILL.md`, `.cursor/rules/*.mdc` and the rest. A flag
    // that prints text must not write files.
    if (wantsHelp(rawArgs)) {
        printSkillsHelp();
        return;
    }

    switch (subcommand) {
        case "install":
            await skillsInstall(rawArgs);
            break;
        case "--help":
        case undefined:
            printSkillsHelp();
            break;
        default:
            unknownCommand(subcommand, SKILLS_SUBCOMMANDS, "skills");
    }
}

/**
 * Agents named explicitly on the command line, e.g. `--agent claude --agent cursor`
 * (also accepts a comma-separated list, and `all`). Returns null when none were
 * given.
 */
function parseAgentFlags(rawArgs: string[]): AgentKey[] | null {
    const requested: string[] = [];
    for (let i = 0; i < rawArgs.length; i++) {
        if (rawArgs[i] !== "--agent" && rawArgs[i] !== "-a") continue;
        const value = rawArgs[i + 1];
        if (value && !value.startsWith("-")) {
            requested.push(...value.split(",").map(v => v.trim()).filter(Boolean));
        }
    }
    if (requested.length === 0) return null;

    // `all` exists for the non-interactive case. Detection cannot help there: a
    // scaffolded project ships `.cursorrules`, `CLAUDE.md`, `.windsurfrules`,
    // `AGENTS.md` and `.github/copilot-instructions.md` all at once, so every
    // pointer file is present and none of them says which assistant the
    // developer actually uses. Guessing from them would install several agents'
    // skills unasked; refusing leaves a scripted setup with no way through.
    // Naming `all` is the developer saying it out loud.
    if (requested.includes("all")) return Object.keys(AGENTS) as AgentKey[];

    const valid = Object.keys(AGENTS);
    const unknown = requested.filter(a => !valid.includes(a));
    if (unknown.length > 0) {
        console.error(chalk.red(`Unknown agent(s): ${unknown.join(", ")}. Available: ${valid.join(", ")}`));
        process.exit(1);
    }
    return requested as AgentKey[];
}

async function skillsInstall(rawArgs: string[] = []) {
    // The project root, not the cwd. Agent skills belong beside the repository's
    // other agent configuration — `.claude/`, `.cursor/` — which is both what
    // `detectAgents` looks for and where an assistant reads them from. Resolving
    // against wherever the command happened to be typed put them in
    // `backend/.claude/skills` when run from `backend/`, detected no agent
    // there, and left the skills somewhere nothing would look. Outside a project
    // the cwd is still the honest answer: this command is useful in a repository
    // that is not a Rebase one.
    const projectDir = findProjectRoot() ?? process.cwd();

    // 1. Load skills from @rebasepro/agent-skills
    let skillsDir: string;
    try {
        skillsDir = getSkillsSourceDir();
    } catch (err) {
        console.error(`${chalk.red.bold("ERROR")} ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }

    const skills = loadSkills(skillsDir);
    if (skills.length === 0) {
        console.error(`${chalk.red.bold("ERROR")} No skills found in ${skillsDir}`);
        process.exit(1);
    }

    // 2. Explicit --agent wins; otherwise detect existing agent environments
    let agents = parseAgentFlags(rawArgs) ?? detectAgents(projectDir);

    // 3. If none detected, ask the user
    if (agents.length === 0) {
        // A scaffolded project ships `.cursorrules`, `CLAUDE.md`, `AGENTS.md`
        // and `.github/copilot-instructions.md`, but none of the *directories*
        // detectAgents looks for, so a fresh project always lands here — which
        // is correct: those files say what `rebase init` writes, not what the
        // developer uses. On a non-TTY that used to abort with a raw
        // ExitPromptError.
        if (!process.stdin.isTTY) {
            console.error(chalk.red("Cannot prompt: this is a non-interactive terminal (no TTY)."));
            console.error(chalk.yellow(`  Name the agents explicitly, e.g. rebase skills install --agent ${Object.keys(AGENTS)[0]}`));
            console.error(chalk.yellow("  Or install for every supported agent:  rebase skills install --agent all"));
            console.error(chalk.gray(`  Available: ${Object.keys(AGENTS).join(", ")}`));
            process.exit(1);
        }

        const choices = Object.entries(AGENTS).map(([key, agent]) => ({
            name: agent.label,
            value: key,
            checked: false
        }));

        const { selectedAgents } = await inquirer.prompt([{
            type: "checkbox",
            name: "selectedAgents",
            message: "No AI agent configuration detected. Which agents do you use?",
            choices,
            validate: (input: string[]) => {
                if (input.length === 0) return "Please select at least one agent.";
                return true;
            }
        }]);

        agents = selectedAgents as AgentKey[];
    }

    // 4. Install skills for each agent
    console.log("");
    console.log(chalk.gray(`  Found ${chalk.white(skills.length)} Rebase skills`));
    console.log("");

    for (const agentKey of agents) {
        const agent = AGENTS[agentKey];
        const { skills: count, assets } = installForAgent(agentKey, skills, projectDir);
        // Relative to where the command was typed, now that the destination is
        // the project root rather than the cwd — otherwise `.claude/skills`
        // names a directory that is not the one it wrote to.
        const shown = path.relative(process.cwd(), path.join(projectDir, agent.targetDir)) || agent.targetDir;
        const withAssets = assets > 0 ? ` (+ ${assets} reference file${assets === 1 ? "" : "s"})` : "";
        console.log(`  ${chalk.green("✓")} ${chalk.bold(agent.label)} — ${count} skills installed${withAssets} to ${chalk.gray(shown)}`);
    }

    console.log("");
    console.log(chalk.gray("  Skills are project-local. Commit them to share with your team."));
    console.log(chalk.gray("  Re-run this command anytime to update to the latest skills."));
    console.log("");
}

function printSkillsHelp() {
    console.log(`
${chalk.bold("rebase skills")} — Manage AI agent skills

${chalk.green.bold("Usage")}
  rebase skills ${chalk.blue("<subcommand>")}

${chalk.green.bold("Subcommands")}
  ${chalk.blue.bold("install")}    Install Rebase agent skills for your AI coding assistant
               Supports: ${Object.values(AGENTS).map(a => a.label).join(", ")}

${chalk.green.bold("Options")}
  ${chalk.blue("--agent, -a")}   Agent(s) to install for, skipping detection and the prompt.
                Repeat the flag or pass a comma-separated list, or ${chalk.bold("all")}.
                Required without a TTY: detection looks for an agent's own
                directory (${Object.values(AGENTS).filter(a => a.detectDir).map(a => a.detectDir).join(", ")}),
                and a fresh scaffold has none. GitHub Copilot is never detected
                — ${chalk.gray(".github/")} is not evidence anyone uses it — so name it.
                Available: ${Object.keys(AGENTS).join(", ")}, all

${chalk.green.bold("Examples")}
  ${chalk.cyan("rebase skills install")}
  ${chalk.cyan("rebase skills install --agent claude")}
  ${chalk.cyan("rebase skills install --agent claude,cursor")}
  ${chalk.cyan("rebase skills install --agent all")}   ${chalk.gray("# scripted / CI")}
`);
}
