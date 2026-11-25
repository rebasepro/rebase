import { describe, it, expect, vi, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { agentSkillsDir, createServer, loadRebaseSkills } from "../src/index";
import { rawHandler } from "./helpers/server-handlers";

// The project registry lives under the home directory; keep the suite off the real one.
vi.mock("node:os", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:os")>();
    return {
        ...actual,
        homedir: () => `${actual.tmpdir()}/rebase-mcp-test-home`
    };
});

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

/** The skill folders `@rebasepro/agent-skills` ships. */
function shippedSkills(): string[] {
    const dir = agentSkillsDir();
    return readdirSync(dir).filter((name) => existsSync(join(dir, name, "SKILL.md"))).sort();
}

describe("the Rebase agent skills over the skills extension", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("lists every shipped skill, each SKILL.md with its digest", async () => {
        const catalog = await loadRebaseSkills();
        expect(catalog).toBeDefined();
        const send = rawHandler(createServer(catalog).server);

        const listed = await send({ method: "skills/list",
params: {} });
        if (!isRecord(listed) || !Array.isArray(listed.skills)) throw new Error(`Not a skill list: ${JSON.stringify(listed)}`);
        const uris = listed.skills.map((skill: unknown) => (isRecord(skill) ? skill.uri : undefined));
        expect(uris).toEqual(shippedSkills().map((name) => `skill://${name}/SKILL.md`));
    });

    it("serves a skill's files byte for byte, matching the published digest", async () => {
        const catalog = await loadRebaseSkills();
        const send = rawHandler(createServer(catalog).server);
        const uri = "skill://rebase-basics/SKILL.md";

        const entry = await send({ method: "skills/get",
params: { uri } });
        if (!isRecord(entry) || !isRecord(entry.skill)) throw new Error(`Not a skill: ${JSON.stringify(entry)}`);
        const resources = entry.skill.resources;
        if (!isRecord(resources)) throw new Error(`No resources: ${JSON.stringify(entry)}`);

        for (const path of ["SKILL.md", "references/cli-commands.md"]) {
            const file = await send({ method: "resources/read",
params: { uri: `skill://rebase-basics/${path}` } });
            if (!isRecord(file) || !Array.isArray(file.contents) || !isRecord(file.contents[0])) {
                throw new Error(`Not a resource: ${JSON.stringify(file)}`);
            }
            const text = file.contents[0].text;
            if (typeof text !== "string") throw new Error(`Not text: ${JSON.stringify(file)}`);
            expect(text).toBe(readFileSync(join(agentSkillsDir(), "rebase-basics", path), "utf8"));
            const published = JSON.stringify(resources);
            expect(published).toContain(`sha256:${createHash("sha256").update(text).digest("hex")}`);
        }
    });

    it("keeps the Rebase resources beside the skills", async () => {
        const catalog = await loadRebaseSkills();
        const send = rawHandler(createServer(catalog).server);
        const templates = await send({ method: "resources/templates/list",
params: {} });
        expect(JSON.stringify(templates)).toContain("rebase://tables/{+name}");
        expect(JSON.stringify(templates)).toContain("skill://");
    });

    it("starts without skills when they cannot be loaded, reporting on stderr only", async () => {
        const stdout = vi.spyOn(process.stdout, "write");
        const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
        const catalog = await loadRebaseSkills(join(tmpdir(), "rebase-mcp-no-such-skills-dir"));
        expect(catalog).toBeUndefined();
        expect(stdout).not.toHaveBeenCalled();
        expect(stderr).toHaveBeenCalledWith(expect.stringContaining("serving without agent skills"));
    });
});
