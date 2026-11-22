/**
 * What `rebase cloud projects create` says.
 *
 * Its confirmation read "Create project Shop at shop in org c2926495-805c-…":
 * the organization's id, for a person to recognise. And with `--link` it ended
 * on "Deploy it with: rebase cloud deploy --project shop" — a flag the linked
 * directory does not need, in a scaffold whose README says `pnpm run deploy`.
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
        confirmDestructive: vi.fn(async () => undefined),
        getContextOrg: vi.fn(() => "c2926495-805c-4c1e-9d55-0b1a2c3d4e5f"),
        fetchTenantBaseDomain: vi.fn(async () => "rebase.website"),
        fetchDeployTargets: vi.fn(async () => [{ clusterId: null, provider: "gcp", region: "europe-west1" }]),
        writeLink: vi.fn()
    };
});

import * as context from "./context";
import { fakeCloudClient } from "../../../test/helpers/cloud-client";
import { createProject, deployHint } from "./projects";

const ORG_ID = "c2926495-805c-4c1e-9d55-0b1a2c3d4e5f";

function argv(...words: string[]): string[] {
    return ["/usr/bin/node", "/x/y/rebase.js", "cloud", "projects", "create", ...words];
}

let said: string[];
let dir: string;
const startedIn = process.cwd();

function client(orgRow: Record<string, unknown> | undefined) {
    return fakeCloudClient({
        user: { uid: "user_1" },
        session: { accessToken: "t" },
        collection: (name) => ({
            create: (data) => ({ id: `${name}_1`, ...data }),
            find: () => ({ data: [] }),
            findById: () => (name === "organizations" ? orgRow : undefined)
        }),
        invoke: vi.fn(async () => ({ available: true }))
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-projects-create-")));
    process.chdir(dir);
    said = [];
    const capture = (...args: unknown[]) => { said.push(args.map(String).join(" ")); };
    vi.spyOn(console, "log").mockImplementation(capture);
    vi.spyOn(console, "error").mockImplementation(capture);
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
        said.push(String(chunk));
        return true;
    });
    context.setJsonModeForTest(false);
});

afterEach(() => {
    process.chdir(startedIn);
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

describe("the projects create confirmation", () => {
    it("names the organization, not its id", async () => {
        vi.mocked(context.requireClient).mockResolvedValue({ client: client({ id: ORG_ID, name: "Camberi" }), url: "https://cp.example" });

        await createProject(argv("--name", "Shop", "--subdomain", "shop"));

        const prompt = vi.mocked(context.confirmDestructive).mock.calls[0][0].prompt;
        expect(prompt).toContain("in org Camberi");
        expect(prompt).not.toContain(ORG_ID);
    });

    it("falls back to the id when the organization cannot be read", async () => {
        vi.mocked(context.requireClient).mockResolvedValue({ client: client(undefined), url: "https://cp.example" });

        await createProject(argv("--name", "Shop", "--subdomain", "shop"));

        expect(vi.mocked(context.confirmDestructive).mock.calls[0][0].prompt).toContain(`in org ${ORG_ID}`);
    });
});

describe("the line projects create ends on", () => {
    it("names --project when the directory was not linked", async () => {
        vi.mocked(context.requireClient).mockResolvedValue({ client: client({ name: "Camberi" }), url: "https://cp.example" });

        await createProject(argv("--name", "Shop", "--subdomain", "shop", "--yes"));

        expect(said.join("\n")).toContain("rebase cloud deploy --project shop");
    });

    it("with --link, names the scaffold's own deploy script, with no --project", async () => {
        fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "shop", scripts: { deploy: "rebase cloud deploy" } }));
        fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
        fs.writeFileSync(path.join(dir, "rebase.json"), JSON.stringify({ rebase: "^1", apps: { backend: { type: "backend" } } }));
        vi.mocked(context.requireClient).mockResolvedValue({ client: client({ name: "Camberi" }), url: "https://cp.example" });

        await createProject(argv("--name", "Shop", "--subdomain", "shop", "--link", "--yes"));

        const out = said.join("\n");
        expect(out).toContain("pnpm run deploy");
        expect(out).not.toContain("--project shop");
    });

    it("says nothing about deploying when deploy itself created the project", async () => {
        vi.mocked(context.requireClient).mockResolvedValue({ client: client({ name: "Camberi" }), url: "https://cp.example" });

        await createProject(argv("--name", "Shop", "--subdomain", "shop", "--link", "--yes"), { thenDeploying: true });

        const out = said.join("\n");
        expect(out).not.toContain("Deploy it with");
        expect(out).toContain("Deploying it now.");
    });
});

describe("deployHint", () => {
    it("is the bare command for a linked directory with no deploy script", () => {
        fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "shop" }));
        expect(deployHint({ linked: true, slug: "shop", projectRoot: dir })).toBe("rebase cloud deploy");
    });

    it("is npm's script runner under an npm lockfile", () => {
        fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "shop", scripts: { deploy: "rebase cloud deploy" } }));
        fs.writeFileSync(path.join(dir, "package-lock.json"), "{}");
        expect(deployHint({ linked: true, slug: "shop", projectRoot: dir })).toBe("npm run deploy");
    });
});
