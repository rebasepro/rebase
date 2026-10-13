import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { StorageSourceDefinition } from "@rebasepro/types";
import fs from "fs";
import os from "os";
import path from "path";

import { logger } from "../src/utils/logger";
import { resolveStorageSources } from "../src/boot/sources";

/**
 * Where a named local bucket keeps its files: beside the directory the default
 * source uses, `STORAGE_PATH` included.
 *
 * The self-host compose file points the default at a volume with
 * `STORAGE_PATH`. A named source derived its directory from the runtime's
 * `defaultBasePath` instead — `<bundle>/uploads__media`, beside the bundle on
 * the container's own filesystem and outside every volume — so its uploads
 * vanished with the container.
 */
const local = (key: string): StorageSourceDefinition =>
    ({ key, engine: "local", transport: "server" }) as StorageSourceDefinition;
const declared = [local("(default)"), local("media")];

describe("a named local bucket's directory", () => {
    it("sits beside STORAGE_PATH, so one volume over their parent holds both", () => {
        const sources = resolveStorageSources({ STORAGE_PATH: "/storage/uploads" }, declared, "/bundle/uploads");
        expect(sources!["(default)"]).toMatchObject({ type: "local", basePath: "/storage/uploads" });
        expect(sources!["media"]).toMatchObject({ type: "local", basePath: "/storage/uploads__media" });
    });

    it("sits beside it, not inside it, when STORAGE_PATH ends in a separator", () => {
        const sources = resolveStorageSources({ STORAGE_PATH: "/storage/uploads/" }, declared, "/bundle/uploads");
        expect(sources!["media"]).toMatchObject({ basePath: "/storage/uploads__media" });
    });

    it("is still its own variable's when that is set", () => {
        const sources = resolveStorageSources(
            { STORAGE_PATH: "/storage/uploads", STORAGE_PATH__MEDIA: "/elsewhere/media" },
            declared,
            "/bundle/uploads"
        );
        expect(sources!["media"]).toMatchObject({ basePath: "/elsewhere/media" });
    });

    it("has not moved where STORAGE_PATH is unset", () => {
        const sources = resolveStorageSources({}, declared, "/bundle/uploads");
        expect(sources!["(default)"]).toMatchObject({ basePath: "/bundle/uploads" });
        expect(sources!["media"]).toMatchObject({ basePath: "/bundle/uploads__media" });
    });
});

describe("files a named local bucket left behind", () => {
    let scratch: string | undefined;
    afterEach(() => {
        if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
        scratch = undefined;
    });

    const warningsFor = (env: Record<string, string>, defaultBasePath: string): string => {
        const warned: string[] = [];
        const spy = jest.spyOn(logger, "warn").mockImplementation((message: string) => { warned.push(message); });
        try {
            resolveStorageSources(env, declared, defaultBasePath);
        } finally {
            spy.mockRestore();
        }
        return warned.join("\n");
    };

    it("are named at boot, with the variable that keeps serving them", () => {
        scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-left-behind-"));
        const before = path.join(scratch, "bundle", "uploads__media");
        fs.mkdirSync(before, { recursive: true });
        fs.writeFileSync(path.join(before, "cover.png"), "png");

        const said = warningsFor(
            { STORAGE_PATH: path.join(scratch, "storage", "uploads") },
            path.join(scratch, "bundle", "uploads")
        );
        expect(said).toContain(`"media" now keeps its files in ${path.join(scratch, "storage", "uploads__media")}`);
        expect(said).toContain(`STORAGE_PATH__MEDIA=${before}`);
    });

    it("say nothing when the old directory is empty, or is the same one", () => {
        scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-left-behind-"));
        fs.mkdirSync(path.join(scratch, "bundle", "uploads__media"), { recursive: true });
        expect(warningsFor(
            { STORAGE_PATH: path.join(scratch, "storage", "uploads") },
            path.join(scratch, "bundle", "uploads")
        )).not.toContain("now keeps its files");

        // `rebase dev` runs in the project root, where `./uploads` is the
        // default base path spelled relatively: nothing moved.
        fs.writeFileSync(path.join(scratch, "bundle", "uploads__media", "cover.png"), "png");
        const cwd = process.cwd();
        process.chdir(path.join(scratch, "bundle"));
        try {
            expect(warningsFor({ STORAGE_PATH: "./uploads" }, path.join(scratch, "bundle", "uploads")))
                .not.toContain("now keeps its files");
        } finally {
            process.chdir(cwd);
        }
    });
});
