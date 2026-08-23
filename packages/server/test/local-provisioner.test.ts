/**
 * Local provisioning: enough to use a declared resource on a laptop, and
 * nothing at all in production.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { createLocalProvisioner, localProvisioningAllowed } from "../src/boot/local-provisioner";
import { bindResources } from "../src/boot/bindings";
import { DEFAULT_RESOURCE_KEY, buildResourceGraph, bucket, database, resetDeclaredResources, topic } from "@rebasepro/types";

let stateDir: string;

beforeEach(() => {
    resetDeclaredResources();
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-local-"));
});

afterEach(() => fs.rmSync(stateDir, { recursive: true, force: true }));

describe("buckets", () => {
    it("gets a real directory, so an upload works having configured nothing", () => {
        const provisioner = createLocalProvisioner({ stateDir });
        const values = provisioner.provision({
            kind: "bucket", key: "media", engine: "local", transport: "server", options: {}
        });
        expect(values?.REBASE_STORAGE_ENGINE).toBe("local");
        expect(fs.existsSync(values!.STORAGE_BUCKET)).toBe(true);
        expect(values!.STORAGE_BUCKET).toContain(path.join("storage", "media"));
    });

    it("names the default one readably rather than by its sentinel", () => {
        const values = createLocalProvisioner({ stateDir }).provision({
            kind: "bucket", key: DEFAULT_RESOURCE_KEY, engine: "local", transport: "server", options: {}
        });
        expect(values!.STORAGE_BUCKET).toContain(path.join("storage", "default"));
        expect(values!.STORAGE_BUCKET).not.toContain("(");
    });

    it("does not turn a key into a path traversal", () => {
        // Keys are validated at declaration, but this writes to a filesystem
        // and defence in depth is cheap here.
        const values = createLocalProvisioner({ stateDir }).provision({
            kind: "bucket", key: "../../etc", engine: "local", transport: "server", options: {}
        });
        expect(path.resolve(values!.STORAGE_BUCKET).startsWith(path.resolve(stateDir))).toBe(true);
    });

    it("leaves a direct-transport bucket unprovisioned", () => {
        // A provider SDK reaches it from the browser. Handing back a directory
        // would make it look configured while every client upload still failed.
        const values = createLocalProvisioner({ stateDir }).provision({
            kind: "bucket", key: "cdn", engine: "s3", transport: "direct", options: {}
        });
        expect(values).toBeNull();
    });

    it("announces what it made, so a developer knows where their files went", () => {
        const seen: string[] = [];
        createLocalProvisioner({ stateDir, onProvision: (d, detail) => seen.push(`${d.key}:${detail}`) })
            .provision({ kind: "bucket", key: "media", engine: "local", transport: "server", options: {} });
        expect(seen).toHaveLength(1);
        expect(seen[0]).toContain("media:");
    });
});

describe("other kinds", () => {
    it("binds a topic with no values, because it needs no address", () => {
        // Bound-with-nothing, not unbound: unbound reads as "nothing
        // configured this", and a topic needs nothing configured.
        const values = createLocalProvisioner({ stateDir }).provision({
            kind: "topic", key: "signups", engine: "jobs", transport: "server", options: {}
        });
        expect(values).toEqual({});
    });

    it("never invents a database", () => {
        // `rebase dev` already starts one and exports its connection string.
        // Inventing a second here would leave the backend talking to a
        // different database than the CLI just migrated.
        const values = createLocalProvisioner({ stateDir }).provision({
            kind: "database", key: "main", engine: "postgres", transport: "server", options: {}
        });
        expect(values).toBeNull();
    });
});

describe("when it is allowed", () => {
    it("is off in production", () => {
        expect(localProvisioningAllowed({ NODE_ENV: "production" })).toBe(false);
    });

    it("is off on the managed runtime regardless of NODE_ENV", () => {
        // A tenant's bundle runs with whatever NODE_ENV it was built with, and
        // one built carelessly would otherwise get a container-filesystem
        // bucket that looks fine until the pod is rescheduled.
        expect(localProvisioningAllowed({ NODE_ENV: "development", REBASE_MANAGED: "1" })).toBe(false);
        expect(localProvisioningAllowed({ REBASE_CLOUD: "1" })).toBe(false);
    });

    it("is on for an ordinary local run", () => {
        expect(localProvisioningAllowed({})).toBe(true);
        expect(localProvisioningAllowed({ NODE_ENV: "development" })).toBe(true);
    });
});

describe("through the binder", () => {
    it("fills only what the file and the environment left unbound", () => {
        database("main");
        bucket("media");
        topic("signups");

        const bindings = bindResources({
            graph: buildResourceGraph(),
            env: { DATABASE_URL__MAIN: "postgres://real" },
            local: createLocalProvisioner({ stateDir })
        });
        const byKey = (k: string) => bindings.find(b => b.declaration.key === k)!;

        expect(byKey("main").source).toBe("environment");
        expect(byKey("media").source).toBe("local-dev");
        expect(byKey("signups").source).toBe("local-dev");
    });

    it("leaves a database unbound rather than guessing at one", () => {
        database("analytics");
        const [binding] = bindResources({
            graph: buildResourceGraph(),
            env: {},
            local: createLocalProvisioner({ stateDir })
        });
        expect(binding.source).toBe("unbound");
    });
});
