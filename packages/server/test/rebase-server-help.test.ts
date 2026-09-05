import fs from "node:fs";
import path from "node:path";

/**
 * `rebase-server --help` is the only reference a VPS deployment has.
 *
 * There is no CLI in the runtime image and none on a box that installed
 * `@rebasepro/server` from npm, so this text is where an operator finds out
 * what the process reads. It had drifted twice over: it did not mention
 * REBASE_SERVICE_KEY, it did not mention the admin seed — the one thing a
 * production deployment cannot recover from omitting — and its
 * REBASE_MIGRATE_ON_BOOT line said collection tables need `rebase db push`,
 * which stopped being true when `ensure` started provisioning them at boot.
 *
 * Read from the source rather than spawned: the bin imports the built
 * `dist/index.es.js` at module load, so running it would make this test depend
 * on a build.
 */
const BIN = path.join(__dirname, "..", "bin", "rebase-server.js");
const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const SELF_HOSTING_DOC = path.join(
    REPO_ROOT, "website/src/content/docs/docs/deployment/self-hosting.md"
);

const help = (() => {
    const source = fs.readFileSync(BIN, "utf8");
    const start = source.indexOf("rebase-server — run a built Rebase project bundle");
    const end = source.indexOf("Docs: https://rebase.pro", start);
    return source.slice(start, end);
})();

describe("rebase-server --help", () => {
    it("names every variable a production deployment cannot start without", () => {
        for (const name of [
            "NODE_ENV",
            "DATABASE_URL",
            "JWT_SECRET",
            "REBASE_SERVICE_KEY",
            "CORS_ORIGINS",
            "REBASE_ADMIN_EMAIL",
            "REBASE_ADMIN_PASSWORD"
        ]) {
            expect(help).toContain(name);
        }
    });

    it("says boot provisions collection tables, not that `db push` does", () => {
        const migrate = help.slice(help.indexOf("REBASE_MIGRATE_ON_BOOT"));
        // The claim the self-hosting page makes, and the one this line
        // contradicted: `ensure` creates the project's tables too.
        expect(migrate).toMatch(/collections/i);
        expect(migrate).toMatch(/additive/i);
        // `db push` still has a job, and the help has to say which one.
        expect(migrate).toMatch(/junction/i);
    });

    it("covers every variable the documented systemd unit sets", () => {
        // The VPS recipe in self-hosting.md is the deployment shape this help
        // text serves. An `Environment=` line the help does not explain is a
        // variable the reader has to find somewhere else.
        if (!fs.existsSync(SELF_HOSTING_DOC)) return; // published-package checkout
        const doc = fs.readFileSync(SELF_HOSTING_DOC, "utf8");
        const names = [...doc.matchAll(/^Environment=([A-Z0-9_]+)=/gm)].map(m => m[1]);
        expect(names.length).toBeGreaterThan(0);
        for (const name of new Set(names)) {
            expect(help).toContain(name);
        }
    });
});
