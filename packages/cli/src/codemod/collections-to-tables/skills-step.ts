/**
 * The manual step that refreshes a migrated project's agent skills.
 *
 * `rebase skills install` copies the Rebase skills into each agent's own
 * directory (`.claude/skills`, `.cursor/rules`, …), where they stay frozen at
 * the release that wrote them. After the migration those copies still teach
 * `defineCollection` and `config/collections`, so the next agent session
 * writes the old layout back. The codemod does not rewrite them — the skills
 * command owns those files and knows which ones the user edited — it names
 * the command to run instead.
 */
import fs from "node:fs";
import path from "node:path";

import { AGENTS, SKILLS_MANIFEST, isAgentKey, type AgentKey } from "../../commands/skills";
import type { ManualStep } from "./types";

/** The agents whose directory in the project holds Rebase skills: a skills manifest, or a `rebase…` entry from an older install. */
export function agentsWithInstalledSkills(projectRoot: string): { agent: AgentKey; dir: string }[] {
    const found: { agent: AgentKey; dir: string }[] = [];
    for (const [key, agent] of Object.entries(AGENTS)) {
        if (!isAgentKey(key)) continue;
        const dir = path.join(projectRoot, agent.targetDir);
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
        const entries = fs.readdirSync(dir);
        if (entries.includes(SKILLS_MANIFEST) || entries.some(entry => entry.startsWith("rebase"))) {
            found.push({ agent: key, dir: agent.targetDir });
        }
    }
    return found;
}

/**
 * The step, or `undefined` when the project holds no installed Rebase skills.
 *
 * @param projectRoot the project being migrated
 */
export function refreshSkillsStep(projectRoot: string): ManualStep | undefined {
    const installed = agentsWithInstalledSkills(projectRoot);
    if (installed.length === 0) return undefined;
    const dirs = installed.map(entry => entry.dir);
    const command = `rebase skills install --agent ${installed.map(entry => entry.agent).join(",")}`;
    return {
        title: "Refresh the project's agent skills",
        detail: `${dirs.join(", ")} ${dirs.length > 1 ? "hold copies" : "holds a copy"} of the Rebase agent skills from before the migration, ` +
            "which still teach `defineCollection` and `config/collections`: an agent reading them writes the old layout back. " +
            `Run \`${command}\` to replace them with the skills this release ships; it removes the skills the release no longer ships ` +
            "(`rebase-collections` became `rebase-tables`). Files you edited are kept and listed — add `--force` to replace those too.",
        snippet: command
    };
}
