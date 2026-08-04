import chalk from "chalk";
import fs from "fs";
import path from "path";
import inquirer from "inquirer";
import { createRequire } from "module";
import { findProjectRoot } from "../utils/project";

const require = createRequire(import.meta.url);

/** Supported agent environments and their target directories. */
const AGENTS = {
    cursor: {
        label: "Cursor",
        detectDir: ".cursor",
        targetDir: ".cursor/rules",
        /** Cursor uses .mdc files (Markdown with Context). */
        transformFile: (skillName: string, content: string) => ({
            fileName: `${skillName}.mdc`,
            content
        })
    },
    claude: {
        label: "Claude Code",
        detectDir: ".claude",
        targetDir: ".claude/skills",
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
        /** Windsurf uses plain .md files. */
        transformFile: (skillName: string, content: string) => ({
            fileName: `${skillName}.md`,
            content
        })
    },
    gemini: {
        label: "Gemini CLI / Antigravity",
        detectDir: ".agents",
        targetDir: ".agents/skills",
        /** Gemini uses the standard SKILL.md format in subdirectories. */
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

/** Read all skill directories and return their names + content. */
function loadSkills(skillsDir: string): Array<{ name: string; content: string }> {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    const skills: Array<{ name: string; content: string }> = [];

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillMdPath = path.join(skillsDir, entry.name, "SKILL.md");
        if (!fs.existsSync(skillMdPath)) continue;
        skills.push({
            name: entry.name,
            content: fs.readFileSync(skillMdPath, "utf-8")
        });
    }

    return skills;
}

/** Detect which agent environments already exist in the project. */
function detectAgents(projectDir: string): AgentKey[] {
    const detected: AgentKey[] = [];
    for (const [key, agent] of Object.entries(AGENTS)) {
        if (fs.existsSync(path.join(projectDir, agent.detectDir))) {
            detected.push(key as AgentKey);
        }
    }
    return detected;
}

/** Install skills for a specific agent into the project directory. */
function installForAgent(
    agentKey: AgentKey,
    skills: Array<{ name: string; content: string }>,
    projectDir: string
): number {
    const agent = AGENTS[agentKey];
    const targetBase = path.join(projectDir, agent.targetDir);

    // Ensure the target directory exists
    fs.mkdirSync(targetBase, { recursive: true });

    let count = 0;
    for (const skill of skills) {
        const { fileName, content } = agent.transformFile(skill.name, skill.content);
        const targetPath = path.join(targetBase, fileName);

        // Ensure parent directory exists (for subdirectory-based formats)
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, content, "utf-8");
        count++;
    }

    return count;
}

export async function skillsCommand(subcommand: string | undefined, rawArgs: string[]) {
    switch (subcommand) {
        case "install":
            await skillsInstall(rawArgs);
            break;
        case "--help":
        case undefined:
            printSkillsHelp();
            break;
        default:
            console.error(chalk.red(`Unknown skills subcommand: ${subcommand}`));
            console.log("");
            printSkillsHelp();
            process.exit(1);
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
    // scaffolded project ships `.cursorrules`, `CLAUDE.md`, `.windsurfrules` and
    // `AGENTS.md` all at once, so every marker file is present and none of them
    // says which assistant the developer actually uses. Guessing from them would
    // install four agents' skills unasked; refusing leaves a scripted setup with
    // no way through. Naming `all` is the developer saying it out loud.
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
        // A scaffolded project ships `.cursorrules` / `CLAUDE.md` files but none
        // of the *directories* detectAgents looks for, so a fresh project always
        // lands here. On a non-TTY that used to abort with a raw ExitPromptError.
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
        const count = installForAgent(agentKey, skills, projectDir);
        // Relative to where the command was typed, now that the destination is
        // the project root rather than the cwd — otherwise `.claude/skills`
        // names a directory that is not the one it wrote to.
        const shown = path.relative(process.cwd(), path.join(projectDir, agent.targetDir)) || agent.targetDir;
        console.log(`  ${chalk.green("✓")} ${chalk.bold(agent.label)} — ${count} skills installed to ${chalk.gray(shown)}`);
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
               Supports: Cursor, Claude Code, Windsurf, Gemini CLI, Antigravity

${chalk.green.bold("Options")}
  ${chalk.blue("--agent, -a")}   Agent(s) to install for, skipping detection and the prompt.
                Repeat the flag or pass a comma-separated list, or ${chalk.bold("all")}.
                Required without a TTY: a scaffolded project carries a marker
                file for every agent, so detection cannot pick one for you.
                Available: ${Object.keys(AGENTS).join(", ")}, all

${chalk.green.bold("Examples")}
  ${chalk.cyan("rebase skills install")}
  ${chalk.cyan("rebase skills install --agent claude")}
  ${chalk.cyan("rebase skills install --agent claude,cursor")}
  ${chalk.cyan("rebase skills install --agent all")}   ${chalk.gray("# scripted / CI")}
`);
}
