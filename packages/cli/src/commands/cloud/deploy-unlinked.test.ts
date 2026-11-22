/**
 * `rebase cloud deploy` in a directory that is not linked to a project.
 *
 * A scaffold's last step is `pnpm run deploy`, which is `rebase cloud deploy`,
 * and on a fresh scaffold it ended there: "No project specified and this
 * directory is not linked", exit 1. On a terminal it now offers what `cloud
 * link` offers (a new project first, or an existing one), links, and the
 * deploy goes on. Off one it still refuses, naming the command that creates
 * and links a project first; signed out, it says to log in first.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./context", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./context")>();
    return {
        ...actual,
        requireClient: vi.fn(),
        hasCredentials: vi.fn(() => true),
        canPrompt: vi.fn(() => true),
        getContextOrg: vi.fn(() => "org_1")
    };
});

vi.mock("./projects", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./projects")>();
    return {
        ...actual,
        // `projects create --link` writes the link itself; that is all the
        // deploy needs from it here.
        createProject: vi.fn(async () => {
            const { writeLink } = await import("./context");
            writeLink({ url: "https://cp.example", projectId: "new_1", slug: "fresh" });
        })
    };
});

vi.mock("inquirer", () => ({ default: { prompt: vi.fn() } }));

import inquirer from "inquirer";
import * as context from "./context";
import * as projects from "./projects";
import { fakeCloudClient } from "../../../test/helpers/cloud-client";
import { CREATE_NEW_PROJECT, resolveDeployProjectRef } from "./link";

function argv(...words: string[]): string[] {
    return ["/usr/bin/node", "/x/y/rebase.js", "cloud", "deploy", ...words];
}

const existing = [{ id: "35e08cdc", name: "Shop", subdomain: "shop", organization: "org_1" }];

let output: string[];
let dir: string;
const startedIn = process.cwd();

afterEach(() => {
    process.chdir(startedIn);
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

beforeEach(() => {
    vi.clearAllMocks();
    // A scaffold that has never been linked: its own root, no .rebase/.
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-deploy-unlinked-"));
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "fresh", scripts: { deploy: "rebase cloud deploy" } }));
    process.chdir(dir);
    output = [];
    const capture = (...args: unknown[]) => { output.push(args.map(String).join(" ")); };
    vi.spyOn(console, "log").mockImplementation(capture);
    vi.spyOn(console, "error").mockImplementation(capture);
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
        output.push(String(chunk));
        return true;
    });
    vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("__exit__"); });
    context.setJsonModeForTest(false);
    vi.mocked(context.canPrompt).mockReturnValue(true);
    vi.mocked(context.hasCredentials).mockReturnValue(true);
    vi.mocked(context.requireClient).mockResolvedValue({
        client: fakeCloudClient({
            session: { accessToken: "t" },
            collection: (name) => ({ find: () => ({ data: name === "projects" ? existing : [] }) })
        }),
        url: "https://cp.example"
    });
});

describe("rebase cloud deploy in an unlinked directory", () => {
    it("deploys to --project without asking anything", async () => {
        await expect(resolveDeployProjectRef(argv("--project", "shop"))).resolves.toBe("shop");
        expect(inquirer.prompt).not.toHaveBeenCalled();
    });

    it("deploys to the linked project without asking anything", async () => {
        context.writeLink({ url: "https://cp.example", projectId: "linked_1" });
        await expect(resolveDeployProjectRef(argv())).resolves.toBe("linked_1");
        expect(inquirer.prompt).not.toHaveBeenCalled();
    });

    it("on a terminal, offers creating a project first, creates it with --link, and goes on", async () => {
        vi.mocked(inquirer.prompt).mockResolvedValue({ picked: CREATE_NEW_PROJECT });

        await expect(resolveDeployProjectRef(argv())).resolves.toBe("new_1");

        const asked: unknown = vi.mocked(inquirer.prompt).mock.calls[0][0];
        const first: unknown = Array.isArray(asked) ? asked[0] : undefined;
        expect(first).toMatchObject({ default: CREATE_NEW_PROJECT });
        expect(first).toMatchObject({ choices: expect.arrayContaining([expect.objectContaining({ value: CREATE_NEW_PROJECT })]) });
        const choices: unknown = typeof first === "object" && first !== null && "choices" in first ? first.choices : undefined;
        expect(Array.isArray(choices) ? choices[0] : undefined).toMatchObject({ value: CREATE_NEW_PROJECT });
        const [createArgs, opts] = vi.mocked(projects.createProject).mock.calls[0];
        expect(createArgs).toContain("--link");
        expect(createArgs.slice(2, 5)).toEqual(["cloud", "projects", "create"]);
        // The deploy that is about to run is not named again as the next step.
        expect(opts).toEqual({ thenDeploying: true });
    });

    it("on a terminal, links an existing project picked instead, and goes on", async () => {
        vi.mocked(inquirer.prompt).mockResolvedValue({ picked: existing[0] });

        await expect(resolveDeployProjectRef(argv())).resolves.toBe("35e08cdc");

        expect(context.readLink()).toMatchObject({ projectId: "35e08cdc", slug: "shop", orgId: "org_1" });
        expect(projects.createProject).not.toHaveBeenCalled();
    });

    it("off a terminal, refuses and names projects create --link first", async () => {
        vi.mocked(context.canPrompt).mockReturnValue(false);

        await expect(resolveDeployProjectRef(argv())).rejects.toThrow("__exit__");

        const said = output.join("\n");
        expect(said).toContain("this directory is not linked");
        const first = said.indexOf("rebase cloud projects create --name <n> --subdomain <s> --link");
        expect(first).toBeGreaterThan(-1);
        expect(first).toBeLessThan(said.indexOf("--project <slug>"));
        expect(first).toBeLessThan(said.indexOf("rebase cloud link"));
        expect(inquirer.prompt).not.toHaveBeenCalled();
    });

    it("signed out, says so and names rebase cloud login first", async () => {
        vi.mocked(context.hasCredentials).mockReturnValue(false);

        await expect(resolveDeployProjectRef(argv())).rejects.toThrow("__exit__");

        const said = output.join("\n");
        expect(said).toContain("Not logged in");
        expect(said).toContain("rebase cloud login");
        expect(context.requireClient).not.toHaveBeenCalled();
        expect(inquirer.prompt).not.toHaveBeenCalled();
    });
});
