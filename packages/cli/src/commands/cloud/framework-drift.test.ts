/**
 * A platform upgrade that rebuilt the live app on a newer `@rebasepro` than
 * this checkout, said by `rebase cloud status` before the next deploy is
 * refused for it — and the custom domains `status` lists, with whether HTTPS
 * works on each.
 *
 * The deploy's own preflight is held in `deploy-source.test.ts`, beside the
 * intake refusal it moves earlier.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PROJECT_ID = "6f1c2a0e-1111-4222-8333-944445555666";

vi.mock("./context", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./context")>();
    return {
        ...actual,
        requireClient: vi.fn(),
        requireProject: vi.fn(async () => PROJECT_ID),
        displayProjectRef: vi.fn(() => "shop"),
        readLink: vi.fn(() => null)
    };
});

vi.mock("./framework-drift", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./framework-drift")>();
    return { ...actual, localFrameworkVersion: vi.fn(() => "0.33.2") };
});

import * as context from "./context";
import { fakeCloudClient } from "../../../test/helpers/cloud-client";
import { setCertificateCheckerForTest, type CertificateChecker } from "./certificate";
import { frameworkDrift, localFrameworkVersion, platformRebuiltVersionOf, driftSentence, deployFrameworkVersion } from "./framework-drift";
import { statusCommand } from "./resources";

const actualFrameworkDrift = await vi.importActual<typeof import("./framework-drift")>("./framework-drift");

let project: Record<string, unknown>;
let domains: unknown[];
let checked: string[];

function useClient(): void {
    vi.mocked(context.requireClient).mockResolvedValue({
        client: fakeCloudClient({
            invoke: (name, _body, opts) => {
                if (name === "domains" && opts?.method === "GET") return { tenantHost: "shop.rebase.website", domains };
                return undefined;
            },
            collection: (slug) => slug === "projects" ? { findById: () => project } : {}
        }),
        url: "https://cp.example"
    });
}

beforeEach(() => {
    context.setJsonModeForTest(true);
    project = { id: PROJECT_ID, name: "Shop", subdomain: "shop", status: "active", runtimeMode: "managed" };
    domains = [];
    checked = [];
    const checker: CertificateChecker = async (host) => {
        checked.push(host);
        return host === "new.example.com"
            ? { state: "pending", reason: "the ingress still serves its placeholder certificate" }
            : { state: "ready" };
    };
    setCertificateCheckerForTest(checker);
    vi.mocked(context.readLink).mockReturnValue(null);
    useClient();
});

afterEach(() => {
    context.setJsonModeForTest(false);
    setCertificateCheckerForTest();
    vi.clearAllMocks();
});

async function statusJson(): Promise<Record<string, unknown>> {
    const chunks: string[] = [];
    const write = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string) => {
        chunks.push(String(chunk));
        return true;
    }) as typeof process.stdout.write);
    try {
        await statusCommand(["node", "rebase", "cloud", "status"]);
    } finally {
        write.mockRestore();
    }
    return JSON.parse(chunks.join("")) as Record<string, unknown>;
}

describe("frameworkDrift", () => {
    it("is the live rebuild and the command, when the checkout is older", () => {
        expect(frameworkDrift("0.34.2", "0.33.2")).toEqual({ live: "0.34.2", local: "0.33.2", nextAction: "rebase upgrade --to 0.34.2" });
        expect(frameworkDrift("0.34.0", "0.34.0-canary.3")).toMatchObject({ live: "0.34.0" });
    });

    it("is nothing when the checkout is as new or newer, or either side is unknown", () => {
        expect(frameworkDrift("0.34.2", "0.34.2")).toBeUndefined();
        expect(frameworkDrift("0.34.2", "0.35.0")).toBeUndefined();
        expect(frameworkDrift(null, "0.33.2")).toBeUndefined();
        expect(frameworkDrift("0.34.2", undefined)).toBeUndefined();
    });

    it("says what will be refused and how past it", () => {
        const said = driftSentence({ live: "0.34.2", local: "0.33.2", nextAction: "rebase upgrade --to 0.34.2" });
        expect(said.message).toContain("@rebasepro 0.34.2");
        expect(said.message).toContain("0.33.2");
        expect(said.hint).toContain("`rebase upgrade --to 0.34.2`");
    });

    it("reads the field off a project row in either spelling", () => {
        expect(platformRebuiltVersionOf({ platformRebuiltVersion: "0.34.2" })).toBe("0.34.2");
        expect(platformRebuiltVersionOf({ platform_rebuilt_version: "0.34.2" })).toBe("0.34.2");
        expect(platformRebuiltVersionOf({ platformRebuiltVersion: null })).toBeUndefined();
        expect(platformRebuiltVersionOf(undefined)).toBeUndefined();
    });
});

describe("the local version", () => {
    let root: string;
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-drift-"));
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    function install(relative: string, version: string): void {
        const dir = path.join(root, relative);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version }));
    }

    it("is @rebasepro/server under backend/, read from a subdirectory as the build reads it", () => {
        install("backend/node_modules/@rebasepro/server", "0.33.2");
        fs.mkdirSync(path.join(root, "backend", "src"), { recursive: true });
        expect(actualFrameworkDrift.localFrameworkVersion(path.join(root, "backend", "src"))).toBe("0.33.2");
    });

    it("is a prebuilt bundle's builtAgainst under --bundle-dir", () => {
        install("node_modules/@rebasepro/server", "0.30.0");
        fs.mkdirSync(path.join(root, "out"));
        fs.writeFileSync(path.join(root, "out", "manifest.json"), JSON.stringify({ runtime: { builtAgainst: "0.31.1" } }));
        expect(deployFrameworkVersion("out", root)).toBe("0.31.1");
        expect(deployFrameworkVersion(undefined, root)).toBe("0.30.0");
    });

    it("is the stand-in here, so the status tests below control it", () => {
        expect(localFrameworkVersion("anywhere")).toBe("0.33.2");
    });
});

describe("rebase cloud status", () => {
    it("says the platform rebuilt the app past this checkout, and what to run", async () => {
        project.platformRebuiltVersion = "0.34.2";
        vi.mocked(context.readLink).mockReturnValue({ url: "https://cp.example", projectId: PROJECT_ID, slug: "shop" });

        const out = await statusJson();

        expect(out.frameworkDrift).toEqual({ live: "0.34.2", local: "0.33.2", nextAction: "rebase upgrade --to 0.34.2" });
        expect(out.runtime).toMatchObject({ platformRebuiltVersion: "0.34.2" });
    });

    it("reports the rebuild but no drift from a directory that is not this project's checkout", async () => {
        project.platformRebuiltVersion = "0.34.2";
        vi.mocked(context.readLink).mockReturnValue({ url: "https://cp.example", projectId: "another-project" });

        const out = await statusJson();

        expect(out.frameworkDrift).toBeNull();
        expect(out.runtime).toMatchObject({ platformRebuiltVersion: "0.34.2" });
    });

    it("lists custom domains, and a verified one whose certificate is not issued is not called ready", async () => {
        domains = [
            { id: "d1", host: "shop.example.com", primary: true, status: "verified", verifiedAt: "2026-11-20T10:00:00Z" },
            { id: "d2", host: "new.example.com", primary: false, status: "verified", verifiedAt: "2026-11-20T10:05:00Z" },
            { id: "d3", host: "later.example.com", primary: false, status: "pending", verifiedAt: null }
        ];

        const out = await statusJson();

        expect(out.domains).toEqual([
            { host: "shop.example.com", status: "verified", primary: true, certificate: { state: "ready" } },
            { host: "new.example.com", status: "verified", primary: false, certificate: { state: "pending", reason: "the ingress still serves its placeholder certificate" } },
            { host: "later.example.com", status: "pending", primary: false, certificate: null }
        ]);
        // A host that is not verified is not on the Ingress, so it is not asked.
        expect(checked.sort()).toEqual(["new.example.com", "shop.example.com"]);
    });
});
