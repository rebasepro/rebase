import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * The virtual collections module, through a real `vite build`.
 *
 * The unit tests in `vitePlugin.test.ts` stub `import.meta.glob`, which is
 * exactly the part that went wrong: what Vite does with the pattern the plugin
 * writes. Two ways it disagreed with the rest of the plugin and with the
 * backend's loader:
 *
 * - An absolute `collectionsDir` was written into the pattern as-is, and Vite
 *   reads a pattern starting with "/" as relative to the project root. The
 *   admin got no collections at all, with no error, while the transform hook
 *   and the watcher treated the same path as absolute.
 * - `*.ts` matched `posts.test.ts`, which the backend skips. The glob is eager,
 *   so the test file ran in the browser bundle and threw
 *   `describe is not defined` at boot: a blank admin.
 *
 * Vite is ESM-only, so the build runs in a child Node process.
 */

const appDir = path.resolve(__dirname, "..");

function buildAdmin(collectionsDir: (collections: string) => string): string[] {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-collections-"));
    try {
        const root = path.join(dir, "frontend");
        const collections = path.join(dir, "config", "collections");
        fs.mkdirSync(root, { recursive: true });
        fs.mkdirSync(collections, { recursive: true });
        // The child resolves `vite` from its own location.
        fs.symlinkSync(path.join(appDir, "node_modules"), path.join(dir, "node_modules"), "dir");

        fs.writeFileSync(path.join(root, "main.js"),
            "import { collections } from \"virtual:rebase-collections\";\n" +
            "export const slugs = collections.map((c) => c.slug);\n");
        fs.writeFileSync(path.join(collections, "posts.ts"), "export default { slug: \"posts\" };\n");
        fs.writeFileSync(path.join(collections, "authors.ts"), "export default { slug: \"authors\" };\n");
        fs.writeFileSync(path.join(collections, "posts.test.ts"),
            "describe(\"posts\", () => undefined);\nexport default { slug: \"from-a-test-file\" };\n");
        // Neither of these is a collection, as the backend's loader also says.
        fs.writeFileSync(path.join(collections, "env.d.ts"),
            "declare const shared: { slug: string };\nexport default shared;\n");
        // What macOS tar leaves beside every file (an AppleDouble sidecar).
        fs.writeFileSync(path.join(collections, "._posts.ts"), "export default { slug: \"from-a-dotfile\" };\n");

        const script = path.join(dir, "build.mjs");
        fs.writeFileSync(script, `
            import { build } from "vite";
            import { rebaseCollectionsPlugin } from ${JSON.stringify(path.join(appDir, "src", "vitePlugin.ts"))};
            const root = ${JSON.stringify(root)};
            const out = await build({
                root,
                logLevel: "silent",
                configFile: false,
                plugins: [rebaseCollectionsPlugin({ collectionsDir: ${JSON.stringify(collectionsDir(collections))} })],
                build: {
                    write: false,
                    minify: false,
                    lib: { entry: root + "/main.js", formats: ["es"], fileName: "admin" }
                }
            });
            const code = out[0].output[0].code;
            const admin = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
            process.stdout.write(JSON.stringify(admin.slugs));
        `);

        const stdout = execFileSync(process.execPath, [script], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        return (JSON.parse(stdout) as string[]).sort();
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

describe("rebaseCollectionsPlugin — the virtual module in a real build", () => {
    jest.setTimeout(60_000);

    it("finds the collections of a directory given relative to the root", () => {
        expect(buildAdmin(() => "../config/collections")).toEqual(["authors", "posts"]);
    });

    it("finds the collections of a directory given as an absolute path", () => {
        expect(buildAdmin((collections) => collections)).toEqual(["authors", "posts"]);
    });
});
