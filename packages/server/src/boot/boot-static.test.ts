/**
 * A real boot, serving two apps from one bundle.
 *
 * `serve-spa.test.ts` mounts apps the way boot mounts them; this one lets boot
 * do it, from a bundle on disk. It is the closest thing to the self-host
 * acceptance test (`docker compose up`, then load `/` and `/admin`) that runs
 * without a container: the static path deliberately needs no database and no JWT
 * secret, so the whole manifest → loader → mount → response chain is exercised
 * in-process.
 *
 * What it does not cover is the container starting and the backend half booting.
 * The compose run is still worth doing before this ships.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { BUNDLE_FORMAT_VERSION, RUNTIME_CONTRACT_VERSION } from "@rebasepro/types";
import { bootFromBundle } from "./boot";
import type { BootedRuntime } from "./boot";

let scratch: string;
let booted: BootedRuntime | undefined;

function writeTwoAppBundle(): string {
    const dir = path.join(scratch, "dist-bundle");
    fs.mkdirSync(dir, { recursive: true });

    const write = (relative: string, contents: string): void => {
        const full = path.join(dir, relative);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, contents);
    };

    write("static/site/index.html", "SITE_INDEX");
    write("static/site/assets/app.js", "SITE_ASSET");
    // Built for /admin, as `rebase build` asserts it must be.
    write("static/admin/index.html", '<script src="/admin/assets/app.js"></script>ADMIN_INDEX');
    write("static/admin/assets/app.js", "ADMIN_ASSET");

    write("manifest.json", JSON.stringify({
        bundleFormat: BUNDLE_FORMAT_VERSION,
        runtime: { range: "^1", builtAgainst: "1.0.0", contract: RUNTIME_CONTRACT_VERSION },
        schemaVersion: "",
        app: "web",
        kind: "static",
        entry: {
            static: [
                { path: "/", dir: "static/site", spa: true },
                { path: "/admin", dir: "static/admin", spa: true }
            ]
        },
        hooks: { native: false },
        deps: { declared: {} },
        build: { cli: "test", node: "22", createdAt: "2026-07-27T00:00:00Z" }
    }));

    return dir;
}

async function get(url: string): Promise<{ status: number; body: string }> {
    const res = await booted!.app.fetch(new Request(`http://localhost${url}`));
    return { status: res.status,
body: await res.text() };
}

beforeAll(async () => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-boot-static-"));
    booted = await bootFromBundle({
        bundleDir: writeTwoAppBundle(),
        listen: false,
        handleSignals: false
    });
});

afterAll(async () => {
    await booted?.shutdown().catch(() => {});
    fs.rmSync(scratch, { recursive: true, force: true });
});

describe("booting a two-app static bundle", () => {
    it("loads both apps, longest path first", () => {
        expect(booted!.bundle.staticApps.map(a => a.path)).toEqual(["/admin", "/"]);
    });

    it("serves the site at the root", async () => {
        expect((await get("/")).body).toBe("SITE_INDEX");
    });

    it("serves the admin at /admin", async () => {
        expect((await get("/admin")).body).toContain("ADMIN_INDEX");
    });

    it("serves each app's assets from its own build", async () => {
        expect((await get("/admin/assets/app.js")).body).toBe("ADMIN_ASSET");
        expect((await get("/assets/app.js")).body).toBe("SITE_ASSET");
    });

    it("answers a deep link under /admin with the admin's index", async () => {
        // The failure this exists for: the site's HTML served at the admin's
        // URL, which reads as an admin bug for a long time.
        const { body } = await get("/admin/collections/posts");
        expect(body).toContain("ADMIN_INDEX");
        expect(body).not.toBe("SITE_INDEX");
    });

    it("answers a deep link at the root with the site's index", async () => {
        expect((await get("/deep/link")).body).toBe("SITE_INDEX");
    });

    it("keeps the health probes the orchestrator needs", async () => {
        expect((await get("/livez")).status).toBe(200);
        expect(JSON.parse((await get("/health")).body).status).toBe("ok");
    });

    it("answers health under the API prefix too", async () => {
        // Every other route a developer touches is under `/api`, and a reverse
        // proxy that forwards only `/api` can reach nothing else — so
        // `/api/health` answering 404 reads as "the server is broken" rather
        // than "that is not where health lives". Both paths, one handler.
        expect(JSON.parse((await get("/api/health")).body).status).toBe("ok");
        // And the bare path an orchestrator is already configured with keeps
        // working — this pair is the whole point.
        expect((await get("/health")).status).toBe(200);
    });
});
