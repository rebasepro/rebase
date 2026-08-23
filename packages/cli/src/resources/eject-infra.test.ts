/**
 * What `rebase eject infra` writes.
 *
 * The property under test is not "it produces JSON" — it is that the file
 * changes nothing on the day it is written. An escape hatch that hands you a
 * *different* configuration than the one you were running is worse than no
 * escape hatch, because the first thing it does is move you off a working
 * setup.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { buildInfraConfig, describeEjectedInfra, serializeInfraConfig } from "./eject-infra";
import {
    DEFAULT_RESOURCE_KEY,
    buildResourceGraph,
    bucket,
    database,
    registerResourceKind,
    declareResource,
    resetDeclaredResources,
    topic
} from "@rebasepro/types";

beforeEach(() => resetDeclaredResources());

describe("what it writes", () => {
    it("points every value at the variable the binder was already reading", () => {
        database("analytics");
        const config = buildInfraConfig(buildResourceGraph());
        expect(config.resources["database:analytics"]).toEqual({
            DATABASE_URL: { $env: "DATABASE_URL__ANALYTICS" },
            REBASE_DRIVER: { $env: "REBASE_DRIVER__ANALYTICS" },
            REBASE_DB_POOL_MAX: { $env: "REBASE_DB_POOL_MAX__ANALYTICS" }
        });
    });

    it("leaves the default resource's variables unsuffixed", () => {
        database();
        const config = buildInfraConfig(buildResourceGraph());
        expect(config.resources[`database:${DEFAULT_RESOURCE_KEY}`].DATABASE_URL)
            .toEqual({ $env: "DATABASE_URL" });
    });

    it("never inlines a value, because this file ends up in a config repo", () => {
        database("main");
        bucket("media", { engine: "s3" });
        const text = serializeInfraConfig(buildInfraConfig(buildResourceGraph()));
        // Every leaf is a pointer. A generator that inlined a password once
        // would teach everyone that inlining is normal.
        const parsed = JSON.parse(text) as { resources: Record<string, Record<string, unknown>> };
        for (const entry of Object.values(parsed.resources)) {
            for (const value of Object.values(entry)) {
                expect(value).toHaveProperty("$env");
            }
        }
    });

    it("covers every declared kind", () => {
        database("main");
        bucket("media");
        topic("signups");
        const config = buildInfraConfig(buildResourceGraph());
        expect(Object.keys(config.resources).sort())
            .toEqual(["bucket:media", "database:main", "topic:signups"]);
    });

    it("writes an empty entry for a kind that binds some other way, rather than dropping it", () => {
        // An absent entry reads as "needs nothing". An empty one reads as
        // "needs something and I do not know what", which is the true claim.
        registerResourceKind({ kind: "widget", engines: ["x"], defaultEngine: "x", envBases: [] });
        declareResource("widget", "thing");
        const config = buildInfraConfig(buildResourceGraph());
        expect(config.resources["widget:thing"]).toEqual({});
    });

    it("is stable, so re-ejecting does not churn a diff", () => {
        database("b");
        database("a");
        const once = serializeInfraConfig(buildInfraConfig(buildResourceGraph()));
        expect(serializeInfraConfig(buildInfraConfig(buildResourceGraph()))).toBe(once);
        expect(once.endsWith("\n")).toBe(true);
    });

    it("declares the version, so a runtime can refuse one it does not understand", () => {
        expect(buildInfraConfig(buildResourceGraph()).version).toBe(1);
    });
});

describe("what it tells you", () => {
    it("says it takes precedence and that nothing changes yet", () => {
        database("main");
        const message = describeEjectedInfra(buildInfraConfig(buildResourceGraph()), "rebase.infra.json");
        expect(message).toContain("BEFORE the environment");
        expect(message).toContain("nothing changes until you edit it");
    });

    it("counts what it wrote", () => {
        database("main");
        bucket("media");
        expect(describeEjectedInfra(buildInfraConfig(buildResourceGraph()), "f.json")).toContain("2 resources");
        resetDeclaredResources();
        database("only");
        expect(describeEjectedInfra(buildInfraConfig(buildResourceGraph()), "f.json")).toContain("1 resource.");
    });
});
