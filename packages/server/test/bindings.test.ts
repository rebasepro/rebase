/**
 * Binding precedence, and the refusals that keep a half-bound deployment from
 * booting as if it were fine.
 */
import fs from "fs";
import os from "os";
import path from "path";
import {
    INFRA_CONFIG_ENV,
    INFRA_CONFIG_FILENAME,
    bindResources,
    bindingId,
    describeUnbound,
    loadInfraConfig,
    resolveInfraValue,
    unboundResources
} from "../src/boot/bindings";
import { DEFAULT_RESOURCE_KEY, buildResourceGraph, database, bucket, resetDeclaredResources } from "@rebasepro/types";

let root: string;

beforeEach(() => {
    resetDeclaredResources();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-infra-"));
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function writeInfra(config: unknown): void {
    fs.writeFileSync(path.join(root, INFRA_CONFIG_FILENAME), JSON.stringify(config, null, 2));
}

describe("resolving a value", () => {
    it("passes a literal through", () => {
        expect(resolveInfraValue("postgres://x", {}, "where")).toBe("postgres://x");
        expect(resolveInfraValue(5432, {}, "where")).toBe("5432");
    });

    it("reads an $env pointer", () => {
        expect(resolveInfraValue({ $env: "PW" }, { PW: "secret" }, "where")).toBe("secret");
    });

    it("refuses an $env pointer at an unset variable, naming it", () => {
        // An empty connection string fails much further away — a pool that
        // cannot connect, at first request — with nothing naming the variable.
        expect(() => resolveInfraValue({ $env: "PW" }, {}, "resources[db].password"))
            .toThrow(/resources\[db\]\.password points at environment variable PW, which is not set/);
    });

    it("treats an empty variable as unset", () => {
        expect(() => resolveInfraValue({ $env: "PW" }, { PW: "" }, "where")).toThrow(/not set/);
    });
});

describe("loading the file", () => {
    it("is absent, not an error, when a deployment supplies none", () => {
        expect(loadInfraConfig(root, {})).toBeNull();
    });

    it("reads the conventional filename", () => {
        writeInfra({ version: 1, resources: { "database:(default)": { DATABASE_URL: "postgres://x" } } });
        expect(loadInfraConfig(root, {})?.resources?.["database:(default)"]).toEqual({ DATABASE_URL: "postgres://x" });
    });

    it("follows the env pointer, which is how the cloud injects one", () => {
        const elsewhere = path.join(root, "injected.json");
        fs.writeFileSync(elsewhere, JSON.stringify({ version: 1, resources: {} }));
        expect(loadInfraConfig(root, { [INFRA_CONFIG_ENV]: elsewhere })).toEqual({ version: 1, resources: {} });
    });

    it("refuses a named file that is missing, rather than falling back silently", () => {
        expect(() => loadInfraConfig(root, { [INFRA_CONFIG_ENV]: path.join(root, "nope.json") }))
            .toThrow(/points at .*nope\.json, which does not exist/);
    });

    it("refuses a version it does not understand", () => {
        writeInfra({ version: 2, resources: {} });
        expect(() => loadInfraConfig(root, {}))
            .toThrow(/does not understand.*Refusing rather than binding the half/s);
    });

    it("says which file is bad JSON", () => {
        fs.writeFileSync(path.join(root, INFRA_CONFIG_FILENAME), "{ not json");
        expect(() => loadInfraConfig(root, {})).toThrow(/is not valid JSON/);
    });
});

describe("precedence", () => {
    it("prefers the infra file over the environment", () => {
        database("main");
        const bindings = bindResources({
            graph: buildResourceGraph(),
            env: { DATABASE_URL__MAIN: "from-env" },
            infra: { version: 1, resources: { "database:main": { DATABASE_URL: "from-file" } } }
        });
        expect(bindings[0].source).toBe("infra-file");
        expect(bindings[0].values.DATABASE_URL).toBe("from-file");
    });

    it("falls back to the environment, on the <BASE>__<KEY> convention", () => {
        database("analytics");
        const [binding] = bindResources({
            graph: buildResourceGraph(),
            env: { DATABASE_URL__ANALYTICS: "postgres://analytics" }
        });
        expect(binding.source).toBe("environment");
        expect(binding.values.DATABASE_URL).toBe("postgres://analytics");
    });

    it("leaves the default resource unsuffixed, so plain DATABASE_URL still binds", () => {
        database();
        const [binding] = bindResources({
            graph: buildResourceGraph(),
            env: { DATABASE_URL: "postgres://default" }
        });
        expect(binding.declaration.key).toBe(DEFAULT_RESOURCE_KEY);
        expect(binding.values.DATABASE_URL).toBe("postgres://default");
    });

    it("provisions locally only when nothing else bound", () => {
        database("main");
        bucket("media");
        // Looked up by key, not by position: the graph is sorted by kind for a
        // stable diff, so `bucket` comes before `database`.
        const bindings = bindResources({
            graph: buildResourceGraph(),
            env: { DATABASE_URL__MAIN: "postgres://real" },
            local: { provision: d => (d.kind === "bucket" ? { STORAGE_BUCKET: "/tmp/local" } : null) }
        });
        const byKey = (k: string) => bindings.find(b => b.declaration.key === k)!;
        expect(byKey("main").source).toBe("environment");
        expect(byKey("media").source).toBe("local-dev");
    });

    it("reports unbound rather than throwing, because whether it matters is the caller's question", () => {
        database("main");
        bucket("media");
        const bindings = bindResources({ graph: buildResourceGraph(), env: {} });
        expect(unboundResources(bindings).map(b => b.declaration.key).sort()).toEqual(["main", "media"]);
    });
});

describe("the unbound message", () => {
    it("names the variable and the file, not just the resource", () => {
        database("analytics");
        const [binding] = bindResources({ graph: buildResourceGraph(), env: {} });
        const message = describeUnbound(binding);
        expect(message).toContain('database "analytics"');
        expect(message).toContain("DATABASE_URL__ANALYTICS");
        expect(message).toContain(INFRA_CONFIG_FILENAME);
        expect(message).toContain(bindingId("database", "analytics"));
    });

    it("calls the default one the default, rather than printing its sentinel key", () => {
        database();
        const [binding] = bindResources({ graph: buildResourceGraph(), env: {} });
        // The prose names it; the infra-file key stays exact, because that is
        // what somebody has to paste.
        expect(describeUnbound(binding)).toContain("the default database");
        expect(describeUnbound(binding)).not.toMatch(/binds database "\(default\)"/);
        expect(describeUnbound(binding)).toContain('"database:(default)"');
    });
});
