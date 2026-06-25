import chalk from "chalk";
import fs from "fs";
import path from "path";
import inquirer from "inquirer";
import { createRequire } from "module";

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
            `Make sure @rebasepro/agent-skills is installed.`
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

export async function skillsCommand(subcommand: string | undefined, _args: string[]) {
    switch (subcommand) {
        case "install":
            await skillsInstall();
            break;
        case "--help":
        case undefined:
            printSkillsHelp();
            break;
        default:
            console.log(chalk.red(`Unknown skills subcommand: ${subcommand}`));
            console.log("");
            printSkillsHelp();
    }
}

async function skillsInstall() {
    const projectDir = process.cwd();

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

    // 2. Detect existing agent environments
    let agents = detectAgents(projectDir);

    // 3. If none detected, ask the user
    if (agents.length === 0) {
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
        console.log(`  ${chalk.green("✓")} ${chalk.bold(agent.label)} — ${count} skills installed to ${chalk.gray(agent.targetDir)}`);
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

${chalk.green.bold("Examples")}
  ${chalk.cyan("rebase skills install")}
`);
}
